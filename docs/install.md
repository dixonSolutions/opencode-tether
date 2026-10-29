# Install

There are three things you can install:

1. **The host** — a Rust binary that serves the web app and proxies opencode. Recommended for remote access.
2. **The Linux desktop app** — a Flatpak of the Tauri build.
3. **The Android app** — a signed APK.

The web app needs no install; it is served by the host.

## APT (Debian, Ubuntu, derivatives)

When the repository is signed:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://dixonSolutions.github.io/opencode-tether/repo/key.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/opencode-tether.gpg
echo "deb [signed-by=/etc/apt/keyrings/opencode-tether.gpg] https://dixonSolutions.github.io/opencode-tether/repo/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/opencode-tether.list
sudo apt update
sudo apt install opencode-tether
```

If `key.asc` is not published yet, the repository is unsigned. Use `[trusted=yes]`:

```sh
echo "deb [trusted=yes] https://dixonSolutions.github.io/opencode-tether/repo/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/opencode-tether.list
```

The package contains `/usr/bin/opencode-tether`, a user systemd unit, the config example, and docs. It does not create a host config for you.

## DNF (Fedora, RHEL, CentOS Stream)

```sh
sudo curl -fsSL https://dixonSolutions.github.io/opencode-tether/repo/rpm/opencode-tether.repo \
  -o /etc/yum.repos.d/opencode-tether.repo
sudo dnf install opencode-tether
```

If the repository is signed, the `.repo` file has `repo_gpgcheck=1` and references `repo/key.asc`. Package payloads are not individually signed; the repository metadata is.

## Standalone host binary

Release assets:

```
opencode-tether-x86_64-unknown-linux-musl
opencode-tether-aarch64-unknown-linux-musl
opencode-tether-armv7-unknown-linux-musleabihf
```

```sh
sudo install -m 0755 opencode-tether-x86_64-unknown-linux-musl /usr/local/bin/opencode-tether
opencode-tether init
opencode-tether serve
```

Self-update works with standalone binaries when the release includes a matching asset and checksum.

## Flatpak

Add the remote (unsigned fallback):

```sh
flatpak remote-add --if-not-exists --user --no-gpg-verify tether \
  https://dixonSolutions.github.io/opencode-tether/repo/flatpak
flatpak install --user tether ai.opencode.tether
flatpak run ai.opencode.tether
```

Signed:

```sh
curl -fsSL https://dixonSolutions.github.io/opencode-tether/repo/key.asc -o /tmp/tether.asc
flatpak remote-add --if-not-exists --user --gpg-import=/tmp/tether.asc tether \
  https://dixonSolutions.github.io/opencode-tether/repo/flatpak
flatpak install --user tether ai.opencode.tether
```

Updates are managed by Flatpak:

```sh
flatpak update ai.opencode.tether
```

The Flatpak has network access, Wayland/X11, and the desktop portal. It does not bundle opencode; it connects to a host over the network. To use a local opencode on the same machine, run the host as a service and point the app at it.

## Android

1. Download `opencode-tether-<version>-android-universal.apk` (or an ABI-specific APK if published) from Releases.
2. Allow installation from your browser/file manager.
3. Install.
4. Add a host or sign in to a host.

**Updates are manual.** Side-loaded Android apps cannot silently update. Download the newer APK and install it over the app; settings and saved hosts are retained.

The release APK is signed with the project keystore. If a build was produced without signing secrets, the release notes say so and the APK is debug-signed.

## Browser / PWA

Open the host URL. To install:

- Chromium: address bar → Install.
- Safari iOS: Share → Add to Home Screen.
- Firefox Android: menu → Install.

The app uses a dark theme by default; switch to light or system in Settings.

## Verify downloads

Every release includes `SHA256SUMS`:

```sh
sha256sum -c SHA256SUMS --ignore-missing
```
