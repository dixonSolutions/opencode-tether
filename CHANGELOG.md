# Changelog

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
