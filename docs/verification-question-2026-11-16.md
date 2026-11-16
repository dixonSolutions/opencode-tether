# Question recovery verification — 2026-11-16

All original uncommitted work was preserved. No commits, pushes, history changes, existing agent/config edits, or user-session mutations were made. Two read-only `gpt-6-luna` audits checked event/merge behavior and the live harness; the primary agent made all edits and performed deployment/testing.

## Root cause and changes

The reported screenshot predates the prior 12:20 deployment. Before new edits, a fresh browser running the existing working tree already rendered the user's pending four-question request. The remaining recovery gaps were verified in source and regression fixtures: snapshots depended on the current capped session list to infer scope, could replace selected-session metadata, and health polling reconciled statuses without recovering missed questions. Since `/question` is directory-local, refreshing just one directory also misses background requests during an SSE outage. A running `question` tool with empty input offered no route to the answer panel.

- `apps/tether/src/lib/state/app.svelte.ts`: capture scope at fetch time; record event-envelope/request directories; preserve requests with unknown session metadata; hydrate their sessions directly; retain selected/pending sessions through capped refreshes; restore directory before initial fetch; reconcile questions at startup, switch, health poll, and reconnect across known/default/recent directories with at most four directory fetches in flight. Retain concurrent events during snapshots and fence replied/rejected request IDs against stale snapshots and duplicate legacy asks. Keep the answer card through failed submission; refresh transcript/status after success. Guard asynchronous session selection against an older lookup winning a switch.
- `apps/tether/src/lib/components/tether/ToolCall.svelte`: running questions show answer-panel guidance and a focus/scroll link, or a reload action when the request is not loaded yet.
- `apps/tether/src/lib/components/tether/QuestionCard.svelte`: identifiable accessible answer region; selecting a multi-option answer clears a prior custom answer consistently.
- `apps/tether/e2e/streaming.spec.ts`: six new browser regressions cover pending multi-question deep links/reload/reconnect outside capped lists, answer payload/scope, missed-event polling, both event envelopes, request-ID reply/reject and duplicate asks, stale snapshots, background-directory discovery, session switching, and tool-to-panel navigation.
- `CHANGELOG.md`, `docs/architecture.md`, and `docs/testing.md`: document recovery behavior and verification.

## Checks

| Exact command | Result |
| --- | --- |
| `cargo test --manifest-path server/Cargo.toml --all-targets` | 22 passed |
| `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings` | passed |
| `npm --prefix apps/tether run check` | 0 errors, 0 warnings |
| `FONTCONFIG_FILE=/tmp/opencode/tether-sol/fonts.conf npm --prefix apps/tether run test:e2e -- --workers=2` | 38 passed in 37.1 seconds, including streaming, terminal, pagination and updater tests |
| `git diff --check` | passed |

Intermediate fixture failures were corrected (auto-reconnect disabled by the shared seed, a reply-route glob that did not match nested paths, and clock installation timing). Final full checks above passed. The web build reports its existing large-chunk advisory.

## Real agent/browser testing

`python3 /tmp/opencode/tether-question/live.py` created a uniquely named Markdown agent with the built-in question tool allowed and other tools denied. It used a disposable directory instance and real `deepseek/deepseek-flash` generation on 4096. Playwright used the actual frontend and real APIs; credentials remained in memory.

The source frontend passed:

1. A real three-question call pending before fresh connection rendered all headers, text, options and custom inputs.
2. Reload/deep link retained the card.
3. A real UI answer submitted one option, a custom answer, and two multiple-choice options; exact payload was checked. The question tool completed, the completion marker appeared, and API/UI returned to idle.
4. The browser deliberately dropped SSE and held reconnection until the agent had asked another real question. On automatic reconnect, the missed request was fetched, rendered, answered, and completed.
5. The user's existing request `que_1e1788aac001woSi2MgZy1LTAX` rendered all four questions and every option after deep link and reload. All non-GET requests were blocked during that inspection. It remained pending.

Source-run cleanup removed exactly:

- `/var/home/ratnode2/.config/opencode/agent/tether-question-sample-20261116012715.md`
- Session `ses_e1e08d206ffeLY1dWCSXsMYquH`, including all its messages/tool parts.
- `/tmp/opencode/tether-question/workspace-20261116012715` and its disposable opencode instance.
- The empty `~/.config/opencode/agent` directory created by the harness.
- The temporary frontend listener on 4180 (PIDs 279663 and 279613).

No PTYs or temporary config files were created by the question harness. Browser contexts and SSE readers were closed. Sanitized logs, scripts, and timestamped milestones remain under `/tmp/opencode/tether-question/`; prior reusable scripts/font configuration were preserved.

## Limits

Directory discovery uses the server default, selected/deep-linked session, recent folders, and session/event/request metadata observed by the client. An entirely unknown directory absent from all these sources has no process-wide pending-question listing API; opening its deep link discovers it. Polling adds one question-list request per known directory, bounded to four concurrent requests. Legacy streams provide no durable replay guarantee; snapshots supply recovery. Native mobile/device testing was not performed.

## Deployment and installed-host verification

`npm --prefix apps/tether run build` and `cargo build --release --manifest-path server/Cargo.toml` passed. The release executable was atomically installed to `~/.local/bin/opencode-tether` after backing up the prior live binary at `/var/home/ratnode2/.cache/opencode-tether.bak-question-20261116-013258`. `systemctl --user restart opencode-tether.service` succeeded; the health probe returned HTTP 200 after the listening socket became ready. The service remained active.

`python3 /tmp/opencode/tether-sol/live-smoke.py` passed all checks against 5190/4096 and its isolated 5198 host: authenticated health, session/agent/provider/config payloads, SSE connect/reconnect, login/cookie checks, and disposable PTY execution/deletion. Its memory-only host/config and 5198 listener were stopped; both created PTYs were deleted.

The first installed-browser attempt reached the frontend's saved-login screen because host boot prompts for credentials even with a valid cookie when saved credentials are absent. It timed out before any answer, and removed its agent `tether-question-sample-20261116013309.md`, session `ses_e1e036bdbffe74mBi60RUdpLwU` (all messages), disposable workspace `workspace-20261116013309`, and the empty agent directory. The retry verifies its signed cookie against the real `/api/tether/session`, then changes only the public host-info `requiresAuth` hint in the browser test to skip that login prompt. The installed frontend assets and every question/session/status/SSE endpoint use the actual host/proxy; no lifecycle responses are mocked. Cookie-only boot behavior is pre-existing and remains outside this question fix.

The installed-host retry passed the complete real-agent lifecycle above, including two actual tool calls and answer payloads, fresh connection, reload/deep link, forced SSE outage before the second question, automatic recovery, completion/idle, and read-only rendering of all four existing user questions/options. No browser runtime errors occurred.

Installed retry cleanup removed exactly:

- `/var/home/ratnode2/.config/opencode/agent/tether-question-sample-20261116013423.md`
- Session `ses_e1e02492cffeh0AxqMGSalfx57`, including all messages/tool parts.
- `/tmp/opencode/tether-question/workspace-20261116013423`, its disposable instance, and the newly created empty agent directory.

Final cleanup probes confirmed HTTP 404 for all three disposable session IDs, absence of all three agent files/workspaces, and closed ports 4180/5198. The smoke harness deleted exactly two `/bin/sh` PTYs titled `tether disposable smoke` (one via 5198, one directly via 4096); its DELETE requests returned success. The reused harness did not retain their random IDs. No existing PTYs were modified. The existing four-question request remained pending. The installed executable's SHA-256 matched the release build, the user service was active, and `git diff --check` passed. No rate limit was encountered.
