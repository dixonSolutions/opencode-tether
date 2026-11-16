# Changelog

## Unreleased

- Android AndySU hosts now check on open and hourly, download automatically, and apply web content live with a WebView reload. Native, Java, or resource changes fall back to an automatic restart. Host builds show the running payload version and truthful update status; plain builds retain their APK updater.
- Split Android web content from the JNI library, preserve drafts/settings before live apply, and commit only after the new UI boots. Added signed-channel release/renewal jobs using a public root key only.
- Faster settings and switches: native accessible switch buttons, deferred serialized settings writes, cached platform checks, no navigation delay, and no Android sheet blur/animation. Lazy settings, terminal, workspace/chat, updater, and code-language bundles replace the 1 MB page chunk.

- Recover pending questions on connect, deep links, session switches, periodic health checks, and SSE reconnects across known project directories. Retain sessions omitted by capped lists, preserve request scope and concurrent events, and prevent stale snapshots from restoring answered questions. Running question tools link to the answer panel; failed submissions keep the card available.

- Switched to global events so sessions outside the host’s default directory stay live, with a directory-scoped fallback for older hosts. Session actions, agent/model discovery, permission replies, and terminal lifecycle calls use the correct project directory.
- Fixed SSE cancellation after headers, response-body timeouts, split CRLF frames, and keepalive activity tracking. Silent streams now reconnect after 45 seconds, with resume/online recovery and accurate connection indicators.
- Added text/reasoning delta events, ordered 16 ms transcript batches, event-ID replay dedupe, and snapshot reconciliation so refreshes preserve concurrent live changes and deletions. Permission/question replies from other clients clear the correct request cards.
- Bounded initial transcript requests and rendering to 60 messages with upstream pagination with anchored earlier-message loading. Large markdown falls back to complete escaped text, streaming reasoning is throttled, and unlabelled/large code avoids synchronous auto-highlighting.
- Added automatic same-PTY reconnect with cursor resume and refreshed tickets; fixed terminal startup/close races, orphan PTY cleanup, startup retry loops, and narrow-screen overflow. Live tool output now displays while tools are running.
- Fixed startup deep links and saved sessions that fall outside the initial session list by fetching the requested session directly.
- Fixed stale provider catalogs when switching hosts and restored the saved agent selection.
- Hardened host updates with strict release version comparison, mandatory SHA-256 verification even with `--force`, exact checksum filenames, exclusive staging, durable atomic replacement, and failure cleanup. The update panel handles prereleases, host versions, timeouts, and Flatpak commands correctly.
- Host WebSocket authentication keeps host credentials separate from configured upstream credentials and rejects arbitrary tickets as host authorization.

- Faster host: API JSON and the web bundle are gzip/brotli compressed; event streams are never compressed, so output still streams as it is written.
- Folder search runs on the host in one request (`/api/tether/folders/search`) instead of one request per folder from the browser. Hosts without the endpoint fall back to the browser walk.
- Event stream watchdog: a stream that goes silent is probed, then reconnected, and state is reloaded after a reconnect, so agents no longer look stuck until the page is reopened.
- The folder picker lists recently chosen folders per host, and Enter in the search opens the first match.
- Sessions waiting on a permission or question are pinned under "Needs you" in the sidebar.
- Fixed a per-request memory leak when serving uncommon file types, and duplicated event-stream headers.

## 0.3.0 — 2026-11-03

Comfortable, adaptive UI release.

- Raised typography and control sizes across the app; controls now meet 44 px touch targets on coarse pointers, with comfortable desktop sizing.
- One left-side mobile menu for sessions, settings, remotes, and session details; every drawer has a labelled, reachable Close button.
- Refreshed the shell for phones, tablets, landscape, and wide desktops, including a non-overlapping jump-to-latest button, safer composer wrapping, and safe-area padding.
- Rewrote the project picker as a folder browser: starts at the host home, browses directories through opencode, searches subfolders, supports typed/absolute/`~` paths, and reports permission errors clearly.
- Removed worktree and sandbox entries from directory selection; new sessions use the selected folder or the host default.
- Added Playwright UI coverage (menus, close buttons, folder search and selection, touch targets, overflow) and wired it into CI.
- Fixed settings switches, model favourite buttons, message action menus, markdown copy buttons, and streaming markdown performance.

## 0.2.0 — 2026-11-03

- Added project and directory selection, native swipe gestures, and Android notifications.
- Used the opencode brand icon for Android and desktop.

## 0.1.0 — 2026-10-29

First public build.

- SvelteKit + shadcn-svelte remote UI with Claude-Code-like session layout.
- Remote manager: saved hosts, password/key auth, default and last-used selection, health/latency/busy indicators.
- Host mode served by the Rust shim: single login, embedded web app, remotes disabled.
- Sessions, streaming chat, reasoning, tool cards, patches, permissions, questions, todos, diffs.
- Model/agent picker, commands, shell, attachments, session fork/share/summarize.
- Terminal over opencode PTY with ticket auth.
- Rust host: reverse proxy, SSE, WebSocket PTY, Argon2 auth, CSRF checks, rate limiting, upstream process supervisor, self-update, systemd units.
- Tauri v2 Android and desktop shells, branded icons, safe areas, native storage.
- Flatpak, signed Android release, deb/rpm packages, APT/DNF/Flatpak repositories, main-branch and tag release workflows.
- Responsive tests from 320 px to 1440 px, Android 13 VM portrait/landscape, Tauri desktop under Xvfb.
