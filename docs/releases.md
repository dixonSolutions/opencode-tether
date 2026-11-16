# Releases and updates

## Channels

| Trigger | Version | GitHub release | Purpose |
| --- | --- | --- | --- |
| push to `main` | `0.3.0-main.<run>` | pre-release | latest development build |
| tag `v*` | tag without `v` | stable | recommended release |
| manual dispatch | same as main | pre-release | rebuild |

Every release attaches:

- `opencode-tether-<version>-x86_64-unknown-linux-musl`
- `opencode-tether-<version>-aarch64-unknown-linux-musl`
- `opencode-tether-<version>-armv7-unknown-linux-musleabihf`
- `opencode-tether_<pkg-version>_amd64.deb`, `_arm64.deb`, `_armhf.deb`
- `opencode-tether-<pkg-version>-1.x86_64.rpm`, `.aarch64.rpm`, `.armv7hl.rpm`
- `opencode-tether-<version>-android-universal.apk`
- `ai.opencode.tether-<version>.flatpak` (when the Flatpak bundle step succeeds)
- `SHA256SUMS`

Host binaries are built with `cross` for static musl. The Android APK is release-signed when `ANDROID_KEYSTORE_BASE64` is configured, otherwise debug-signed and labelled as such.

## Update behavior

### Host

```sh
opencode-tether update --check
sudo opencode-tether update
sudo systemctl restart opencode-tether
```

`update` resolves the latest GitHub release, picks the asset for the current OS/arch, downloads it, verifies the digest (asset `digest`, sidecar `.sha256`, or `SHA256SUMS`), writes a sibling temp file, and atomically renames it over the running binary. The staged file and containing directory are synced. Checksums are mandatory, including with `--force`; that flag only permits reinstalling or downgrading deliberately. `--check` never replaces the executable. Stable release versions use SemVer precedence, including prereleases. It refuses to run inside Flatpak.

### APT / DNF

The `gh-pages` branch contains:

```
repo/apt/        APT repository (dists/stable, pool)
repo/rpm/        DNF repository (repodata, .rpm)
repo/flatpak/    Flatpak OSTree repository
repo/key.asc     optional signing key
install.sh
```

`apt update && apt upgrade` and `dnf upgrade` pick up new packages. Main pre-releases use the base package version (e.g. `0.3.0`), so package managers may not treat consecutive main builds as an upgrade. Stable tags use the tag version.

### Android

Plain APK builds keep **Settings → Updates → Download APK**. Android 11+ users can install the production-signed `opencode-tether-live-arm64.apk` from the `channel-live-arm64` prerelease once, over the plain APK, preserving application data. It must use the same application ID/signing certificate and an equal or greater Android version code. Older Android versions keep the plain APK.

Under the AndySU host, updates check on open and every 60 minutes. `mode = "auto"`, `apply = "live"`, `live_fallback = "restart"`, and `restart_when = "now"` are required. **Update automatically** persists the user's choice. A manual **Check now** while disabled performs one download-only check; **Apply now** appears only for a staged release. A host-shell replacement still requires Android installation approval.

Web-only releases reload the WebView in the same process using a separate `assets/tether-web.zip` and Tauri `Context::set_assets`. They qualify only when every other host-verified component digest is unchanged (except the payload descriptor). Native/JVM/resource changes apply by automatic restart. No in-process JNI/Rust replacement is attempted. Build Android with `npx tauri android build --config src-tauri/tauri.android.conf.json --apk`; the platform config packages web assets and keeps them out of the native library. Do not use `--hot` for this archive: transparent mode must run the trial/health handler.

The independent `andysu-live` job splits the signed universal APK for arm64 and publishes the signed `live-arm64` channel. Its host APK belongs only on the channel prerelease, never the version release: older clients pick the first APK from `releases/latest`. Weekly `andysu-resign.yml` renews the manifest. Both jobs pin AndySU 0.1.135. Production signing needs `ANDYSU_SIGNING_KEY` and `ANDYSU_SIGNING_CERT` in addition to the Android keystore secrets; these were provisioned on 2026-11-16. Only the root public PEM is in the repository. Renew the delegated release certificate before expiry using the offline root; never put private keys in this tree.

Local verification does not publish anything. Shipping still requires owner review, pushing the changes, and the normal release workflow. See [the verification report](verification-speed-andysu-2026-11-16.md).

### Flatpak

```sh
flatpak update ai.opencode.tether
```

The app's Updates panel shows this command and can open the Flatpak remote page. Flatpak handles signing, deltas, and the portal integration.

## Repository signing

The workflows sign with `GPG_PRIVATE_KEY` and `GPG_KEY_ID` when both secrets exist:

- APT: `Release.gpg` and `InRelease` are detached/clear-signed.
- DNF: `repomd.xml.asc` is created and packages are signed with `rpmsign` when available.
- Flatpak: `flatpak build-update-repo --gpg-sign=<key>`.

Without those secrets the repositories are unsigned. The install docs use `[trusted=yes]`, `gpgcheck=0`, and `--no-gpg-verify` for that case; that is a development convenience, not a recommendation for production.

## Maintainer setup

Required repository secrets for the full pipeline:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of the release `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |
| `GPG_PRIVATE_KEY` | ASCII-armored private key |
| `GPG_KEY_ID` | key id/fingerprint used for signing |

`GITHUB_TOKEN` is provided by Actions. Enable GitHub Pages for the repository with the `gh-pages` branch as the source (or workflow-based Pages) so `https://<owner>.github.io/opencode-tether/` serves the repositories.

## Version bumping

The base version lives in:

- `apps/tether/package.json`
- `apps/tether/src-tauri/tauri.conf.json`
- `apps/tether/src-tauri/Cargo.toml`
- `server/Cargo.toml`
- `apps/tether/src/lib/constants.ts`

Bump all of them together, commit, then push a `v<version>` tag to publish a stable release. Main builds do not change the base version.
