# Testing

This is a hobby project, but it was tested against real hosts, not only mocks.

## Environments

| Target | Environment | Result |
| --- | --- | --- |
| Web | Chromium, 1440×900, 1280×800, 820×1180, 390×844, 320×640, 844×390 | pass |
| Android | Android 13 x86_64 VM, 1280×800 landscape and 800×1280 portrait, release APK | pass |
| Desktop | Tauri debug build under Xvfb, 1440×900 and 1280×800 | pass |
| Host | opencode 1.19.5, Rust host on loopback, live opencode upstream with Basic auth | pass |
| Packages | Ubuntu/Fedora containers: `.deb` build/install, `.rpm` build/install, signed APT repo, signed DNF metadata | pass |
| Flatpak | Signed remote add, install, launch (GNOME host) | pass |
| Android signing | release APK verified with `apksigner`; versionCode 1017 for v0.1.0 | pass |
| CI | web check/build, Rust tests, clippy, cross builds, Android, Flatpak, repos | configured |

The live host used for testing was opencode 1.19.5 with a password-protected `opencode serve`. The demo data used for screenshots was a separate opencode data directory so no real session data is published.

## Web coverage

- Onboarding: add host, password/API key/none, test connection, save, error handling.
- Host login: wrong password, successful login, cookie set, host mode hides remotes.
- Remote manager: health checks, latency, version, busy count, default star, last-used selection, edit, delete.
- Sessions: list grouping, search, create, rename, delete, deep link, selection persistence.
- Chat: user and assistant messages, markdown, code highlight, reasoning collapse, tool cards, tool expansion, patches, attachments, copy, delete.
- Composer: Enter/Shift+Enter, send key setting, slash commands, `!` shell, attachments, drafts per session, stop.
- Models/agents: provider list, search, favorites, selection, persist.
- Permissions: allow once/always/deny callback path.
- Questions: multi-select, custom answer, dismiss.
- Panel: todos, changed files, diff expansion, session stats.
- Terminal: shell creation, input/output, resize, close cleanup.
- Settings: theme (dark/light/system), toggles, notifications, reset, updates, about.
- Responsive: safe-area classes, mobile header, bottom sheets, 320 px width, landscape.

## Android coverage

```sh
adb -s 127.0.0.1:5555 install -r app-universal-release.apk
adb shell am start -n ai.opencode.tether/.MainActivity
adb reverse tcp:5195 tcp:5195
adb shell wm user-rotation lock 1   # portrait
adb shell wm user-rotation lock 0   # landscape
adb exec-out screencap -p > shot.png
```

- Launch, onboarding, sign in with a remote host over `adb reverse`.
- Session list, chat, tools, model/agent selection, terminal.
- Landscape and portrait rotation.
- Status bar and navigation bar safe areas.
- Release signing: `apksigner verify --print-certs`.
- App storage: `tether-settings.json` in the app data dir persists hosts.

## Host/security coverage

- `/api/tether/info` unauthenticated; `/api/tether/health` and all API paths authenticated.
- Basic auth success/failure.
- Login sets a signed HttpOnly cookie; cookie authorizes API calls.
- Cookie-auth writes with a cross-origin `Origin` are rejected (403); same-origin writes succeed.
- Static path traversal (`/../Cargo.toml`) rejected.
- Upstream Basic auth injection.
- SSE live stream through the proxy.
- WebSocket PTY through the proxy using a connect ticket.
- Upstream command substitution, startup readiness, shutdown, and child cleanup.
- `init` writes Argon2 hash + 0600 config; `config show` redacts hashes, cookie secret, and upstream password.
- `doctor`, `status`, `service install/uninstall`.
- `update --check` against the published v0.1.0 release.
- Published APT repository installed with `signed-by`; published DNF repository installed with signed metadata; published Flatpak remote installed with the project key.

## Rust tests

```sh
cargo test --manifest-path server/Cargo.toml --all-targets
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
```

Covered: password hashing/verification, cookie token round trip and tamper detection, Basic parsing, config defaults/redaction, API path classification, version comparison, static embedding, traversal rejection.

## Reproducing the UI tests

```sh
# host
cargo run --manifest-path server/Cargo.toml -- init --config /tmp/tether.toml --username demo --password demo
# edit /tmp/tether.toml to point at your opencode, then:
cargo run --manifest-path server/Cargo.toml -- serve --config /tmp/tether.toml

# web
npm --prefix apps/tether run dev
# open http://127.0.0.1:5173, add http://127.0.0.1:4096 as a remote, sign in
```

The checked-in Playwright suite uses a mocked host and does not contain personal hosts or credentials:

```sh
npm --prefix apps/tether run test:e2e
```

It starts a development server on 4173 (or a production preview under CI). Coverage includes real HTTP response-body cancellation/timeouts, chunk-split SSE, global stream envelopes, event-ID replay, ordered 10,000-delta reduction, a 1,500-delta browser burst with composer interaction, EOF and silent-stream recovery, 500-message legacy transcripts, paginated history, directory-scoped permission replies, deep links outside the initial session list, 160,000-character reasoning, external permission/question replies, terminal lifecycle races, same-PTY reconnect and Unicode cursor resume, missing/exited PTYs, release version ordering, and responsive layouts.

If local fontconfig returns no fonts and Chromium crashes in `SkFontMgr_FontConfigInterface`, run with a test-only `FONTCONFIG_FILE` pointing at available font directories; no system font settings need to change. Browser tests must run against the changed source or a newly built preview.

The host updater tests replace only disposable temporary files and cover exact checksum filenames, missing/invalid checksum handling, prereleases, atomic replacement, and preserving the original on staging failure. They do not install a release or change the running service.

## Screenshots

- [Web desktop](screenshots/web-desktop.png)
- [Web phone](screenshots/web-phone.png)
- [Web tablet](screenshots/web-tablet.png)
- [Host login](screenshots/host-login.png)
- [Host workspace](screenshots/host-desktop.png)
- [Android portrait](screenshots/android-portrait.png)
- [Android landscape](screenshots/android-landscape.png)
- [Desktop app](screenshots/desktop-app.png)
- [Terminal](screenshots/terminal.png)


Question recovery regressions in `e2e/streaming.spec.ts` cover pending multi-question deep links outside capped lists, reload, dropped SSE/reconciliation, background directory discovery, session switching, legacy/global events, request-ID reply/reject clearing, option/custom/multiple answer payloads, stale snapshots after replies, and running-tool navigation to the answer panel. See [the question verification record](verification-question-2026-11-16.md) for real-agent browser checks and cleanup.


## AndySU and interaction performance

Run `npm --prefix apps/tether run test:unit` and `bash scripts/test-andysu-release.sh` in addition to the existing server/check/build/E2E commands. `e2e/andysu.spec.ts` checks host-only controls and status transitions; `e2e/performance.spec.ts` checks switch acknowledgement, asynchronous persisted state, settings/tab latency, and horizontal overflow. Performance budgets are 50 ms for toggle feedback and 150 ms for sheet/tab interaction. Production-build measurements should be compared separately from Vite's cold development-module compilation. Run browser benchmarks separately from the emulator to avoid software-renderer contention.

The Android config builds a deterministic `assets/tether-web.zip`. For an emulator update test, split the debug APK with a disposable keystore and AndySU keypair, install a plain APK, seed test settings, then install its host over it. Publish a second payload with changed HTML and unchanged native/dex/resources; trigger JobScheduler and assert the PID survives, the new HTML appears, the running payload version changes, the unsent draft survives, and AndySU emits `live_swapped` plus `committed`. Publish a native-different payload next and assert automatic PID replacement, recovered state, and commit. Never manually reopen between publishing and checking the result. Test the Updates tab on plain, host, live-updated, and automatically-restarted builds.

Use `flock /tmp/andysu-heavy.lock systemd-run --user --scope -p MemoryMax=10G -- <command>` for Gradle/emulator/cargo-release work, only one emulator, and check memory first. Use disposable signing material, local test channels, and listeners. Stop Gradle and the emulator, remove forwards/reverses, wipe disposable emulator data, and delete test keys/sites/APKs after testing; retain sanitized evidence. The exact local commands, results, measurements, and limits are in [the verification report](verification-speed-andysu-2026-11-16.md).
