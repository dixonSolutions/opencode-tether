use std::io::Write;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::info;

const USER_AGENT: &str = concat!("opencode-tether/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    body: Option<String>,
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

pub async fn run(repo: &str, check_only: bool, force: bool) -> Result<()> {
    if std::path::Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some() {
        bail!("this binary is running inside Flatpak; update it with `flatpak update ai.opencode.tether`");
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .user_agent(USER_AGENT)
        .build()?;

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("could not reach GitHub")?;
    if !response.status().is_success() {
        bail!("GitHub returned HTTP {} for {url}", response.status());
    }
    let release: Release = response
        .json()
        .await
        .context("invalid GitHub release response")?;
    let latest = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    semver::Version::parse(latest).with_context(|| {
        format!(
            "GitHub returned an invalid release tag: {}",
            release.tag_name
        )
    })?;
    let current = env!("CARGO_PKG_VERSION");
    let newer = is_newer(latest, current);

    println!("current: {current}");
    println!("latest:  {latest}");
    if !newer && !force {
        println!("opencode-tether is up to date.");
        return Ok(());
    }
    if check_only {
        if newer {
            println!("update available: {current} → {latest}");
            if let Some(body) = &release.body {
                println!("\n{}", body.lines().take(20).collect::<Vec<_>>().join("\n"));
            }
        }
        return Ok(());
    }

    let triple = current_triple();
    let asset = release
        .assets
        .iter()
        .find(|asset| {
            asset.name == format!("opencode-tether-{latest}-{triple}")
                || asset.name == format!("opencode-tether-{triple}")
                || asset.name == format!("opencode-tether-{latest}-{triple}.bin")
        })
        .with_context(|| format!("release {latest} has no binary for {triple}"))?;

    info!("downloading {}", asset.browser_download_url);
    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    if bytes.len() < 1024 * 1024 {
        bail!("downloaded binary looks too small ({} bytes)", bytes.len());
    }

    let expected = expected_sha256(&client, &release, asset, latest, triple).await?;
    let actual = hex::encode(Sha256::digest(&bytes));
    let expected = expected.context("release has no usable SHA-256 checksum for this asset")?;
    if expected != actual {
        bail!("checksum mismatch: expected {expected}, got {actual}");
    }
    info!("sha256 verified: {actual}");

    let exe = std::env::current_exe().context("could not locate the running binary")?;
    let exe = exe.canonicalize().unwrap_or(exe);
    replace_binary_atomically(&exe, &bytes)?;

    println!("updated {} to {latest}", exe.display());
    if std::path::Path::new("/run/systemd/system").exists() {
        println!("restart the service to use it: sudo systemctl restart opencode-tether");
    }
    Ok(())
}

async fn expected_sha256(
    client: &reqwest::Client,
    release: &Release,
    asset: &Asset,
    latest: &str,
    triple: &str,
) -> Result<Option<String>> {
    if let Some(digest) = &asset.digest {
        if let Some(value) = digest.strip_prefix("sha256:") {
            if valid_sha256(value) {
                return Ok(Some(value.to_ascii_lowercase()));
            }
            bail!(
                "GitHub returned an invalid SHA-256 digest for {}",
                asset.name
            );
        }
    }
    let sidecar_names = [
        format!("{}.sha256", asset.name),
        format!("opencode-tether-{latest}-{triple}.sha256"),
        "SHA256SUMS".to_string(),
    ];
    for name in sidecar_names {
        let Some(sidecar) = release
            .assets
            .iter()
            .find(|candidate| candidate.name == name)
        else {
            continue;
        };
        let text = client
            .get(&sidecar.browser_download_url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        if let Some(hash) = checksum_for_asset(&text, &asset.name, name != "SHA256SUMS") {
            return Ok(Some(hash));
        }
    }
    Ok(None)
}

fn is_newer(latest: &str, current: &str) -> bool {
    let latest = latest.strip_prefix('v').unwrap_or(latest);
    let current = current.strip_prefix('v').unwrap_or(current);
    match (
        semver::Version::parse(latest),
        semver::Version::parse(current),
    ) {
        (Ok(latest), Ok(current)) => latest.cmp_precedence(&current).is_gt(),
        _ => false,
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn checksum_for_asset(text: &str, asset_name: &str, allow_bare_hash: bool) -> Option<String> {
    text.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let file = parts.next().map(|file| file.trim_start_matches('*'));
        (valid_sha256(hash) && (file == Some(asset_name) || (allow_bare_hash && file.is_none())))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn replace_binary_atomically(exe: &std::path::Path, bytes: &[u8]) -> Result<()> {
    let temp = exe.with_extension(format!("update-{}", std::process::id()));
    let mut created_temp = false;
    let result = (|| -> Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .with_context(|| format!("could not create {} (try sudo)", temp.display()))?;
        created_temp = true;
        file.write_all(bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o755))?;
        }
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, exe).with_context(|| {
            format!(
                "could not replace {}. Re-run with sudo, or move the binary into place manually.",
                exe.display()
            )
        })?;
        if let Some(parent) = exe.parent() {
            std::fs::File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() && created_temp {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn current_triple() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => "x86_64-unknown-linux-musl",
        ("linux", "aarch64") => "aarch64-unknown-linux-musl",
        ("linux", "arm") => "armv7-unknown-linux-musleabihf",
        ("linux", "x86") => "i686-unknown-linux-musl",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        (os, arch) => Box::leak(format!("{arch}-unknown-{os}").into_boxed_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.3.0+build.2", "0.3.0+build.1"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("v0.3.1", "0.3.0"));
        assert!(is_newer("1.0.0", "1.0.0-rc.1"));
        assert!(!is_newer("1.0.0-rc.1", "1.0.0"));
        assert!(!is_newer("not-a-version", "0.3.0"));
        assert!(!is_newer("0.3.1", "not-a-version"));
    }

    #[test]
    fn validates_sha256_shape() {
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(!valid_sha256(&"a".repeat(63)));
        assert!(!valid_sha256(&format!("{}z", "a".repeat(63))));
    }

    #[test]
    fn checksum_sums_must_name_the_requested_asset() {
        let sums = format!(
            "{}  other-binary\n{}  opencode-tether-x86_64\n",
            "a".repeat(64),
            "B".repeat(64)
        );
        assert_eq!(
            checksum_for_asset(&sums, "opencode-tether-x86_64", false),
            Some("b".repeat(64))
        );
        assert_eq!(checksum_for_asset(&sums, "missing-binary", false), None);
        assert_eq!(
            checksum_for_asset(&"c".repeat(64), "opencode-tether-x86_64", true),
            Some("c".repeat(64))
        );
        assert_eq!(
            checksum_for_asset(&"c".repeat(64), "opencode-tether-x86_64", false),
            None
        );
    }

    #[test]
    fn atomic_replace_replaces_only_the_requested_file() {
        let dir = std::env::temp_dir().join(format!("tether-update-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("host");
        std::fs::write(&target, b"old").unwrap();
        replace_binary_atomically(&target, b"new binary").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new binary");
        assert!(!target
            .with_extension(format!("update-{}", std::process::id()))
            .exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_staging_preserves_target_and_existing_temp_file() {
        let dir =
            std::env::temp_dir().join(format!("tether-update-failure-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("host");
        let temp = target.with_extension(format!("update-{}", std::process::id()));
        std::fs::write(&target, b"original executable").unwrap();
        std::fs::write(&temp, b"preexisting staging file").unwrap();

        assert!(replace_binary_atomically(&target, b"replacement").is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original executable");
        assert_eq!(std::fs::read(&temp).unwrap(), b"preexisting staging file");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
