# Verification — 2026-11-16

Changes remain in the working tree. During the agent run, the installed host binary and user service were not replaced or restarted. No update was installed, and no existing user session or PTY was modified. Every disposable integration session and shell was cleaned up.

## Post-verification install

After the agent run, the release binary built from this working tree was installed to `/var/home/ratnode2/.local/bin/opencode-tether`, with the previous binary backed up at `/var/home/ratnode2/.cache/opencode-tether.bak-20261116-121958`. The user service was restarted as PID 277400. `/api/tether/info` returned 200 with upstream opencode 1.19.5 healthy, and the live smoke suite passed. Reload any open tether tab to pick up the new frontend.

## Changes and root causes

- `apps/tether/src/lib/api/client.ts`: cancellation now lasts through response-body reads; request timeouts cover bodies; SSE handles split CRLF, comment activity, global envelopes, explicit event IDs and bounded replay dedupe. Burst parsing yields after 8 ms. Pagination reads the opaque `X-Next-Cursor` header.
- `apps/tether/src/lib/state/app.svelte.ts` and new `transcript.ts`: global events with a directory-local fallback, ordered 16 ms transcript batches, text/reasoning deltas, concurrent snapshot reconciliation, watchdog/backoff/resync, resume/online recovery, scoped project APIs, pending-request/status reconciliation, provider cache invalidation, saved agent restoration, and direct lookup of deep-linked sessions missing from the initial list.
- `ChatView.svelte`, `Markdown.svelte`, `MessageView.svelte`, `PartView.svelte`, `ToolCall.svelte`, and `app.css`: paginated history, 60 initial mounted messages, anchored older-message loading, ResizeObserver scroll follow, throttled reasoning, bounded highlighting/markdown parsing, running tool output, and terminal overflow constraints. Very large parts retain their complete text through an escaped plain-text view.
- `TerminalSheet.svelte`: lifecycle fencing, orphan cleanup, captured directory context, same-PTY reconnect with refreshed tickets and Unicode-safe cursor offsets, bounded retries, foreground/network recovery, and explicit missing/exited/auth-failed states. Cursor semantics follow the [upstream PTY implementation](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/pty.ts).
- `server/src/proxy.rs`: host credentials are not forwarded upstream; arbitrary upstream tickets no longer authorize access to the tether host.
- `server/src/update.rs`, `server/src/main.rs`, `UpdatePanel.svelte`, and new `api/version.ts`: correct SemVer precedence, mandatory SHA-256 verification even with `--force`, exact checksum filenames, exclusive staging and durable atomic replacement, cleanup on failure, correct host version comparison, request timeout, and Flatpak update command behavior.
- `e2e/helpers.ts`, `streaming.spec.ts`, `terminal-layout.spec.ts`, `update-flow.spec.ts`, `version.spec.ts`, and `tether.spec.ts`: shared fixtures and regression coverage. CHANGELOG and architecture/host/releases/testing docs describe the behavior.

## Measurements

- The 500-message browser fixture initially mounts 60 messages: 88% fewer message components. Supported upstreams also limit the initial fetch to 60 messages; earlier history uses opaque cursor pagination.
- The silent-stream cancellation deadline is 45 seconds, checked every 5 seconds, instead of the previous 120-second deadline checked every 15 seconds. Cancellation now actually interrupts an established body read.
- The 10,000 ordered-delta regression completed in approximately 14 ms on this machine. The browser remained editable during a 1,500-delta burst and rendered a 160,000-character reasoning part at 320 px without horizontal page overflow.
- Disposable live `noReply` prompts produced their first message-part event in 9 ms through both port 4096 and the installed proxy on 5190. A separate real agent response through 5190 produced its first assistant part in 1,374 ms, emitted seven part events, and completed with the expected text. These are single-run observations, not a before/after model-speed benchmark.

## Commands and results

| Command | Result |
| --- | --- |
| `cargo test --manifest-path server/Cargo.toml --all-targets` | 22 passed |
| `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings` | passed |
| `cargo build --release --manifest-path server/Cargo.toml` | passed; embeds the rebuilt web app |
| `npm --prefix apps/tether run check` | 0 errors, 0 warnings |
| `npm --prefix apps/tether run build` | passed |
| `FONTCONFIG_FILE=/tmp/opencode/tether-sol/fonts.conf npm --prefix apps/tether run test:e2e -- --workers=2` | 32 passed in 29.6 seconds |
| `server/target/release/opencode-tether update --check` | current/latest 0.3.0; no installation |
| `git diff --check` | passed |

Local fontconfig returned no usable fonts and crashed Chromium. A temporary test-only font configuration points to installed font directories; system settings were left unchanged. One intermediate browser run overlapped a web build, which reloaded the dev page and invalidated its stream fixtures; the final runs execute sequentially.

## Live integration

`python3 /tmp/opencode/tether-sol/live-smoke.py` verified authenticated health/session/agent/provider/config endpoints on 4096 and 5190, permission/question lists, and two SSE connections. An isolated source-built host on 5198 used a memory-only config and random test credentials: login succeeded, its cookie authenticated requests, wrong login failed, and disposable PTYs through both the proxy and upstream executed a marker and were deleted.

`python3 /tmp/opencode/tether-sol/live-pagination.py` and `TETHER_SMOKE_PROXY=1 python3 /tmp/opencode/tether-sol/live-pagination.py` created disposable sessions, stored three `noReply` messages, confirmed selected agent/model fields and global part events, and advanced pagination with the actual opaque response cursor. Both sessions were deleted.

`python3 /tmp/opencode/tether-sol/live-generation.py` verified real assistant generation through the installed 5190 proxy. `python3 /tmp/opencode/tether-sol/run-live-browser.py` exercised the changed frontend against real 4096 APIs, forced its SSE connection to fail during assistant output, and observed automatic recovery to two stream connections, two unique messages, and the expected assistant text. Its session was deleted. The temporary frontend server on 4180 was stopped afterwards.

Scripts read credentials into memory and report only test outcomes. Existing permission/question requests were left untouched; permission replies and concurrent external permission/question events are covered by browser mocks.

## Remaining limits

Legacy SSE streams without IDs have no durable replay/exactly-once guarantee; reconciliation uses API snapshots. PTY recovery is limited to output retained upstream. Older servers without cursor headers may load full history when earlier messages are requested. Native Android/Tauri device tests and replacement of an installed release were not performed. Updater replacement tests use disposable files. The baseline preview did not provide a usable comparison, so no measured before/after wall-clock speedup is claimed.
