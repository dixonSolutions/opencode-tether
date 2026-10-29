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
    let release: Release = response.json().await.context("invalid GitHub release response")?;
    let latest = release.tag_name.trim_start_matches('v');
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
    match expected {
        Some(expected) => {
            if expected != actual {
                bail!("checksum mismatch: expected {expected}, got {actual}");
            }
            info!("sha256 verified: {actual}");
        }
        None if !force => {
            bail!("release has no checksum for this asset; re-run with --force to install anyway");
        }
        None => {
            println!("warning: no checksum available, installing without verification");
        }
    }

    let exe = std::env::current_exe().context("could not locate the running binary")?;
    let exe = exe.canonicalize().unwrap_or(exe);
    let temp = exe.with_extension(format!("update-{}", std::process::id()));
    {
        let mut file = std::fs::File::create(&temp)
            .with_context(|| format!("could not write {} (try sudo)", temp.display()))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755))?;
    }
    if let Err(error) = std::fs::rename(&temp, &exe) {
        let _ = std::fs::remove_file(&temp);
        bail!(
            "could not replace {}: {error}. Re-run with sudo, or move the binary into place manually.",
            exe.display()
        );
    }

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
            return Ok(Some(value.to_ascii_lowercase()));
        }
    }
    let sidecar_names = [
        format!("{}.sha256", asset.name),
        format!("opencode-tether-{latest}-{triple}.sha256"),
        "SHA256SUMS".to_string(),
    ];
    for name in sidecar_names {
        let Some(sidecar) = release.assets.iter().find(|candidate| candidate.name == name) else {
            continue;
        };
        let text = client
            .get(&sidecar.browser_download_url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let needle = if name == "SHA256SUMS" { Some(asset.name.as_str()) } else { None };
        for line in text.lines() {
            let mut parts = line.split_whitespace();
            let Some(hash) = parts.next() else { continue };
            let file = parts.next().unwrap_or("");
            if hash.len() == 64
                && hash.chars().all(|c| c.is_ascii_hexdigit())
                && needle.map(|needle| file.trim_start_matches('*').ends_with(needle)).unwrap_or(true)
            {
                return Ok(Some(hash.to_ascii_lowercase()));
            }
        }
    }
    Ok(None)
}

fn is_newer(latest: &str, current: &str) -> bool {
    let Ok(latest) = semver::Version::parse(latest) else {
        return latest != current;
    };
    let Ok(current) = semver::Version::parse(current) else {
        return latest.to_string() != current;
    };
    latest > current
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
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("1.0.0", "0.99.99"));
    }
}
