# Changelog

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
