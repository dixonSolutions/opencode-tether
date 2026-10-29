# Security

opencode-tether is an unofficial hobby project. It is designed for personal use on machines you control.

## Reporting

Open a private security advisory on GitHub (Security → Advisories → Report a vulnerability) or contact the maintainer through the repository. Do not open a public issue for an unpatched vulnerability.

## Threat model

The host is a single-user gateway to an opencode server. The app is a remote control for that server. The most important boundary is: **do not expose a host to the public internet without HTTPS and a strong password.**

### Host

- Host passwords are stored as Argon2 hashes. The config is written with mode 0600 by `init`.
- Sessions are signed HttpOnly cookies (HMAC-SHA256, 30 days by default) and/or HTTP Basic. The cookie secret is random per install.
- Login attempts are rate-limited per IP (20 failures / 5 minutes).
- Username comparison is constant-time via SHA-256 digests; password verification uses Argon2.
- Cookie-authenticated state-changing requests with a cross-origin `Origin` are rejected.
- The host strips its own `Authorization` and `Cookie` headers before proxying.
- The upstream opencode process is expected to bind loopback. The default command does.
- Static file serving rejects path traversal and only serves files under `web.root` when a disk override is configured.
- WebSocket PTY connections require tether auth, a valid short-lived opencode connect ticket, or a verified `auth_token`. Tickets are minted by an authenticated request and validated by opencode.
- The terminal runs as the user that runs the host/opencode. It is not a sandbox.

### App

- Browser remotes store credentials in `localStorage`.
- Native remotes store credentials in Tauri's app data file (`tether-settings.json`).
- Credentials are not encrypted at rest. Anyone with access to the unlocked device/browser profile can read them.
- Use a host-specific password or bearer key, not a reused password.
- The app does not send telemetry.
- Markdown is sanitized with DOMPurify; links open externally; code is highlighted locally.

## Hardening checklist

- [ ] Bind the host behind a TLS reverse proxy or a tailnet.
- [ ] Set `secure_cookies = true` for HTTPS.
- [ ] Use a long, unique host password.
- [ ] Keep opencode bound to loopback.
- [ ] Restrict the host port with a firewall.
- [ ] Do not save credentials on shared devices.
- [ ] Update the host and apps.
- [ ] Review the systemd unit before enabling it.
- [ ] Use a dedicated user/VM if the projects are sensitive.

## Known limitations

- No multi-user accounts or per-user permissions.
- No TOTP/WebAuthn yet.
- No encryption of saved remote credentials at rest.
- The Android release is side-loaded; verify the SHA-256 and the signing certificate.
- Unsigned package/Flatpak repositories are a development convenience, not a trust model.
