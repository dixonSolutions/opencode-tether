# Architecture

opencode-tether is deliberately small and additive. It does not fork opencode or reimplement its agent runtime.

## Pieces

### Web app (`apps/tether`)

- SvelteKit 2 with `adapter-static` in SPA mode (`ssr = false`, `fallback = index.html`).
- Svelte 5 runes for state.
- shadcn-svelte (bits-ui) for every UI primitive: dialogs, sheets, menus, popovers, inputs, tabs, switches, command palette, tooltips, badges, cards, progress, alerts, skeletons.
- Tailwind CSS v4 with the project's token set in `src/app.css`.
- `marked` + `highlight.js` + DOMPurify for message markdown.
- `xterm.js` for the PTY terminal.
- No telemetry, no analytics, no remote fonts.

The app has one state object (`src/lib/state/app.svelte.ts`) that owns:

- remotes and the active host
- the health/connection state
- sessions, messages, parts, statuses, permissions, questions, todos, diffs
- the SSE event loop, reconnection/backoff, and health polling

The opencode client (`src/lib/api/client.ts`) is a thin typed fetch wrapper. WebSocket/SSE use native browser APIs. All requests go to the same paths as the opencode web app.

### Native shell (`apps/tether/src-tauri`)

- Tauri v2.
- Plugins: store, os, opener, dialog, clipboard manager. No updater plugin is bundled; updates are manual/package-manager driven.
- Settings and credentials use `tauri-plugin-store` on native (`tether-settings.json` in the app data dir); the web uses `localStorage`.
- Android: x86_64, aarch64, armv7, i686; minSdk 24; cleartext HTTP allowed so local/private-network hosts work. HTTPS is still recommended.
- Desktop: WebKitGTK 4.1 through the Flatpak runtime, or the distro packages when building locally.

### Host (`server`)

- Rust, `axum` 0.8, `tokio`, `reqwest`.
- `rust-embed` embeds `apps/tether/build` into the binary. A `web.root` config can override it from disk for development.
- Argon2 password hashing, signed HttpOnly cookies, optional Basic auth, constant-time username checks, and a login rate limiter.
- Reverse proxy for the opencode HTTP API, including streaming SSE.
- PTY WebSocket proxy with ticket or Basic-derived upstream auth.
- Upstream process supervisor: expands the command, starts it, waits for `/global/health`, logs, and stops it on shutdown.
- GitHub release self-updater with SHA-256 verification.
- Systemd user/system service generation.

## Request flow

### Host mode

1. Browser requests `/`.
2. The host serves the embedded `index.html` with `<meta name="opencode-tether-host">`.
3. The app sees the marker, calls `/api/tether/info`, and enters host mode.
4. The user signs in. The app stores the host credentials locally, calls `/api/tether/login` for the cookie, and uses Basic for its own fetches.
5. API calls go to `/session`, `/event`, `/pty/...`, etc. The host authenticates them and proxies to `http://127.0.0.1:<upstream>`.
6. SSE is streamed through without buffering; WebSockets are bridged frame by frame.
7. The UI never sees the upstream auth credentials.

### Remote mode

1. The app is loaded from a static host, a PWA, or bundled in Tauri.
2. It reads the remote list from local/native storage.
3. It selects the last used host, or the default, and calls `/global/health` with Basic/bearer auth.
4. Sessions and events come directly from `opencode serve` (or from a tether host, same protocol).
5. CORS is handled by opencode/tether. WebSocket PTY auth uses a connect ticket or `auth_token` query when the browser cannot set an Authorization header.

## Event handling

The app subscribes to `/event` and handles the legacy event stream:

- `server.connected`
- `message.updated`
- `message.part.updated` / `removed`
- `message.removed`
- `session.created` / `updated` / `deleted` / `status` / `idle` / `error` / `diff` / `compacted`
- `permission.asked` / `replied`
- `question.asked` / `replied` / `rejected`
- `todo.updated`
- `installation.update-available`

Message parts are merged by ID into the selected session. Events for other sessions update the session list and status dots but not the open transcript. A throttled refresh repairs missed frames.

## Updates

| Platform | Mechanism |
| --- | --- |
| Host deb/rpm/standalone | `opencode-tether update` (GitHub release + SHA-256 + atomic replace) |
| Host Flatpak | n/a (the host is not the Flatpak) |
| Desktop Flatpak | `flatpak update ai.opencode.tether` via the Flatpak remote |
| Android | manual APK download/install |
| Web/PWA | reload after the host is updated |

## Security boundaries

- The opencode upstream should bind loopback only. The host is the public surface.
- The host's auth is independent of opencode's auth.
- Browser-hosted remote mode trusts the browser's local storage with remote credentials. A compromised browser profile can read them. Use unique host passwords or keys.
- The host does not expose a shell by default. The terminal is an explicit user action inside an already-authenticated session, and it runs on the opencode host under the user opencode runs as.
