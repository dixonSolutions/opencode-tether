# Android updates and interaction speed — 2026-11-16

Work is uncommitted. No commits, pushes, rebases, remote changes, releases, or changes to the installed host binary/service were made. The starting tracked diff was saved to `/tmp/opencode/tether-speed-andysu/preexisting.patch`; a preservation audit confirms that every pre-existing diff outside the explicitly merged UI/docs files is unchanged. Existing question recovery, transcript reconciliation, streaming, pagination, and terminal regression coverage remains in the tree.

## Update implementation and limits

Ported the AndySU-specific parts of cached commit `c3ba47f`, merging the existing SemVer/timeout/Flatpak update panel and release workflow. Production configuration is auto mode, live policy, automatic immediate restart fallback, 60-minute background interval, default check-on-open, 120-second watchdog, and payload-owned crash handlers. Signing and channel renewal remain separate leaf jobs pinned to AndySU 0.1.135. The host APK is attached only to the `channel-live-arm64` prerelease; existing plain APK pickers cannot accidentally select it from `releases/latest`.

Read AndySU's `transparent-mode.mdx`, `host-api.mdx`, `apply-policies.mdx`, and `migrating-a-released-app.mdx`, plus the actual host implementation. Inspected Tauri `Assets`/`Context::set_assets`, app `lib.rs`, generated `Rust.kt`, and `WryActivity.kt`. Activity recreation cannot safely replace the process-wide JNI registrations, Tao event loop, Rust app singleton, and already-loaded native library. A new classloader cannot make those old references disappear. The implementation consequently never claims a native library swap is live.

Android web output is now a deterministic `assets/tether-web.zip`, independent of the embedded bootstrap/native library. A custom Tauri Assets provider serves an atomically replaced in-memory asset map. The MainActivity live handler compares AndySU's already verified slot component digests and accepts only a web-archive/descriptor change; any native, Java, resource, or other component difference declines to automatic restart. Signed archives are extracted with path traversal and decompression-size checks. The UI flushes current drafts and serialized settings before reload; persistence failure declines the web trial. A document-start nonce binds the readiness acknowledgement to the reloaded document; reconnect events from the old page cannot commit the new trial. The new screen reports started and healthy, then AndySU commits. WebViews without document-start script support use automatic restart fallback. A broken new bundle that never reports ready remains under the host watchdog/rollback path.

Web updates **reload the WebView in the same process**, with no cold app restart. They can close transient UI such as sheets and reset page-local state; they are not a zero-frame DOM patch. Native/Java/resource updates **restart automatically**, and can show a startup screen. Saved remotes, settings, selected session, and unsent chat drafts recover; full in-memory terminal/scroll/UI continuity across a reload is not promised. Shell/host updates still require the Android install permission/user approval. Testing covered API 36 x86_64 emulation, not production arm64 phones or Android 11 boundary devices.

The bridge is restricted to `http://tauri.localhost`, the main frame, and a fixed action allowlist. Plain APK builds have no updater bridge and keep their existing panel. Runtime mode writes and manual checks are dispatched to a serial native worker. A Check now while automatic updates are off temporarily uses download-only mode, then restores off. The live panel reports the running payload version, offers Apply now only when staged, and distinguishes unchecked/error/deferred/checking/downloading/applying/up-to-date/shell-update states.

## UI changes and measurement method

Native button-based switches preserve label, Space/Enter, focus, disabled, and screen-reader semantics and provide an expanded 44px hit area. Settings mutate optimistically; copying, serializing, and serialized dirty-key writes run after the input task. Notification permission is requested only when enabling it. Platform probes are cached. Removed the 120ms navigation timer. Android disables sheet animations, backdrop filters, SVG drop shadows/blur, and large shadows; Android animations are disabled (including ambient pulse/spinners, avoiding rapid flashing); other transitions are capped at 80ms. Web sheet/button animations finish in 100ms, with reduced-motion support.

Workspace/chat, settings, terminal/xterm, updater, and code-language chunks load separately, with idle preloading of settings/terminal. Removed the eager highlight.js/common import; only completed fenced code loads a curated set of language modules. Streaming/plain/unknown code remains escaped and safe. Android debug builds are minified too, retaining source maps; the literal string `TAURI_ENV_DEBUG=false` no longer enables release source maps.

Browser timings use in-page performance.now and requestAnimationFrame rather than Playwright actionability wait time. Pointer regression checks also measure actual click-to-aria-checked mutation, asynchronous persistence, and keyboard interaction. Emulator CDP checks the first settings open and three subsequent closes/opens, first tab activation and warm activations, switch feedback, and overflow. The final isolated run uses API 36 x86_64, 3GiB RAM, four cores, software rendering, 540×1200 physical pixels at 240dpi (360×800 CSS pixels). Both before/after APKs use the same display configuration. Android's baseline is the supplied previously tested APK; the browser baseline is the exact starting working tree. Earlier overlapping browser/emulator measurements were discarded as performance comparisons. First-open and warm results are kept separate.

Final readiness-guard run (first interaction plus three warm repeats per APK):

| Measurement | Before | After |
| --- | ---: | ---: |
| Android first settings mount | 123.6 ms | 42.8 ms |
| Android first settings settled | 173.3 ms | 52.1 ms |
| Android warm settings mount (median of 3) | 233.3 ms | 23.4 ms |
| Android warm settings settled (median of 3) | 254.8 ms | 35.9 ms |
| Android first About tab | 31.7 ms | 1209.7 ms |
| Android warm tab switch (median of 3) | 34.5 ms | 26.9 ms |
| Android toggle feedback (median of 4) | 61.5 ms | 16.5 ms |

All final settings-open and toggle samples and all warm tab samples meet their budgets; overflow was zero. **An intermittent first About activation still misses the target**: the final repeat recorded 1,209.7ms. A preceding isolated run measured first settings 105.8→60.2ms, warm settings 37.0→23.1ms, first About 1,392.1→16.4ms, warm tab 47.5→28.0ms, and toggle median 17.3→13.4ms. The large cold stall moved between controls/runs, so attributing its disappearance solely to filter removal would be unsupported. Both driver/WebView caches and software rendering can influence this baseline-first installation order; a reliable cold p95 has not been established.

A fresh disposable profiling run measured About's synchronous handler at **0.6ms**, microtask state update at **1.1ms**, first frame at **27.1ms**, and settling at **36.6ms**. The CPU profile did not reproduce the long stall and therefore does not establish its cause. **The occasional cold first-tab stall remains an explicit performance limit**; arm64 phone testing is needed before treating the 150ms cold target as guaranteed. See [CPU-profile summary](verification-speed-andysu-2026-11-16/cold-tab-profile.json). Warm interactions and code splitting improved substantially; no claim of a universally met cold budget is made.

The exact-starting-tree browser baseline was settings mount **35.3ms**, toggle **4.0ms**, tab **15.5ms**, zero overflow. The final isolated browser run measured mount **39.8ms**, animation-settled **149.3ms**, toggle **17.8ms**, tab **22.2ms**, zero overflow. Browser animation settling now explicitly forces style calculation before waiting for completion; the original baseline only measured mounting. Desktop was already below budget; no desktop latency speedup is claimed. The initial **1,060.66kB** page chunk is gone. The largest final lazy workspace/chat chunk is **342.15kB** (88.18kB gzip), about 68% smaller; xterm is a separate **284.09kB** lazy/idle chunk. The page route entry itself is 0.11kB, which does not include its shared and asynchronously loaded dependencies. Code splitting reduces eager work, not the total download size to that tiny entry size.

## Commands and results

All logs here are sanitized and contain no production signing material. Detailed evidence is in [the evidence directory](verification-speed-andysu-2026-11-16/).

- `cargo test --manifest-path server/Cargo.toml --all-targets`: **22 passed**.
- `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`: **passed**.
- Android Rust clippy, from `apps/tether/src-tauri`: `cargo ndk -t x86_64 -P 24 clippy --features tauri/custom-protocol -- -D warnings`, under the heavy-job lock/scope, **passed**. Set `NDK_HOME`/`ANDROID_NDK_HOME` to installed 27.2, `TAURI_ANDROID_PROJECT_PATH` to `gen/android`, `WRY_ANDROID_PACKAGE=ai.opencode.tether`, `WRY_ANDROID_LIBRARY=opencode_tether_lib`, and `WRY_ANDROID_KOTLIN_FILES_OUT_DIR` to the generated Kotlin directory. Initial direct invocations outside the manifest directory or without these CLI-provided environment values failed before linting; the correctly configured run completed in 10.23s.
- `npm --prefix apps/tether run check`: **0 errors, 0 warnings**.
- `npm --prefix apps/tether run build`: **passed**.
- `npm --prefix apps/tether run test:unit`: **12 passed**.
- `FONTCONFIG_FILE=/tmp/opencode/tether-sol/fonts.conf npm --prefix apps/tether run test:e2e -- --workers=2`: **42 passed** in the isolated run. Development cold compilation and concurrent emulator runs exposed timing failures; these are retained in local diagnostic logs, not represented as passing runs.
- `bash scripts/test-andysu-release.sh`: **passed**, including pin consistency, separate channel APK, no earlier release dependency, host version code, production policy, and public-only key directory.
- Android build: `. /var/home/ratnode2/Projects/AndySU/scripts/env.sh; export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018" ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"; flock /tmp/andysu-heavy.lock systemd-run --user --scope -p MemoryMax=10G -- npm --prefix apps/tether run tauri -- android build --debug --target x86_64 --apk --config src-tauri/tauri.android.conf.json`: **passed**. Initial attempts found an inherited NDK_HOME pointing to an absent 27.3 SDK; explicitly selecting installed 27.2 resolved it. Existing upstream Java 8 deprecation warnings remain.
- Device harness: under the same heavy-job lock/scope, `python3 /tmp/opencode/tether-speed-andysu/device-test.py`, using the supplied AndySU `device_tests.py`, mock host and CDP helper, plus the task's CDP measurement helper. It creates disposable signing keys, a disposable keystore, a local channel and mock listener, installs plain then host, and tests actual payloads. `prepare-native-test.py` compiled a temporary diagnostic `app_info.nativeUpdateProbe = "payload-C"`, restored `lib.rs` in a finally block, and rebuilt the final normal APK. The native probe exists only in disposable test binaries, not repository source.

Final emulator evidence:

- Plain debug APK → host installed over the same app with the same disposable signing key: saved host/settings recovered. Plain Updates says manual APK installation; the host panel replaces it with running payload version, status and automatic controls.
- A real JobScheduler check (`adb -s emulator-5586 shell cmd jobscheduler run -f ai.opencode.tether 1095648345`, using `testbed_tests.JOB_ID`) triggered each update. There were no Check/Apply UI calls or manual force-stop/relaunch between publishing and verification.
- Payload **0.3.0 → 0.3.1**: PID **5595 → 5595** (unchanged). Changed HTML meta marker `tether-test-payload=0.3.1` was rendered; the Updates panel showed **v0.3.1 / Update applied live**. At **02:35:26.433** logcat emitted `live_swapped`, and at **02:35:26.439** it emitted `committed`, with `pending=null`, `trial=null`, and no bad releases. The unsent draft `unsent live update draft` survived. The log explicitly rejected an injected stale-old-document readiness acknowledgement before accepting the new document nonce.
- Payload **0.3.1 → 0.3.2**, with an independently rebuilt native library: PID **5595 → 7491**. At **02:36:19.462** AndySU emitted `relaunch`, reason `applying update`; at **02:36:27.990** the new process committed 0.3.2. The rendered marker and running badge changed to **0.3.2**. Invoking `app_info` returned **nativeUpdateProbe=payload-C**, proving the new native code actually ran. The draft survived. The panel said **Up to date**, not applied live.
- Automatic updates off + manual check returned mode **off** after completion; re-enabling returned **auto**. Check-on-open events and a 60-minute schedule were verified. The 60-minute wall-clock delay itself was not waited out: JobScheduler was forced for repeatable local coverage.

See [device events](verification-speed-andysu-2026-11-16/android-events.log), [device harness log](verification-speed-andysu-2026-11-16/android-device.log), [state after live apply](verification-speed-andysu-2026-11-16/state-B.json), [state after automatic restart](verification-speed-andysu-2026-11-16/state-C.json), and [native probe result](verification-speed-andysu-2026-11-16/native-probe.json).

## Shipping and cleanup

`gh auth status` confirmed the active account is `dixonSolutions`. `gh secret list -R dixonSolutions/opencode-tether` initially showed the Android secrets and no AndySU secrets. Set `ANDYSU_SIGNING_KEY` and `ANDYSU_SIGNING_CERT` by stdin redirection from the local delegated release-key/certificate files, then verified their names with `gh secret list`. Their contents were never printed or copied into the repository. The repository contains only the production root public PEM. The delegated certificate expires **2027-02-06T22:08:52Z** and requires renewal before then; weekly manifest re-signing does not renew that certificate.

The owner must review these uncommitted changes, push through the normal process, and allow the next release workflow to run. Android 11+ arm64 users need one production-signed host installation from the separate channel release, over their plain APK, before automatic signed payload updates work. This local task did not trigger or publish a release. Test on arm64 phones before broad rollout; native-different builds deliberately remain automatic-restart updates.

Stopped Gradle daemons and the single emulator/container. Deleted disposable keypairs, keystores, local update channels/sites, temporary APKs, native probe binaries, screenshot artifacts, and emulator userdata/cache/encryption images while preserving AVD configuration. No connected devices or ADB forwards remain, and test listeners are gone. No real upstream sessions or agents were created. Port 5190 still returns HTTP 200; the authenticated upstream at 4096 still returns its HTTP 401 challenge. Production key files, installed host binary, Git history and remotes are unchanged. Sanitized logs, panel text, measurements, and source helpers remain for review/reproduction. UTC milestones are in `/tmp/opencode/tether-speed-andysu/status.md`.

## Follow-up snappiness pass

After the first report, the Settings tabs were changed from bits-ui tabs to a native `tablist` with all four panels kept mounted and toggled with `hidden`; this removes first-switch DOM construction. The workspace prefetches the Workspace module during boot, the Settings chunk loads with the workspace, the `is-android` class is applied synchronously before first paint, and controls use `touch-action: manipulation`. Decorative animations/transitions, blur and heavy shadows remain off on Android, while functional spinners/pulses remain animated so waits still look alive.

Measured on the same Android 36 x86_64 emulator at 540×1200 / 240 dpi:

| Interaction | Before | After |
| --- | ---: | ---: |
| Cold Settings mount | ~99 ms | **16.9–41.8 ms** |
| Settings settling | ~107 ms | **25.9–49.8 ms** |
| Toggle feedback | ~16–24 ms | **10.3–17.2 ms** |
| Warm About tab | ~28–48 ms | **6–40 ms** |
| Repeated cold-launch About tab | ~1.1 s outlier | **4.7–17.2 ms** |

The one remaining ~1.1 s first-tab sample occurred only immediately after a fresh APK installation; it did not reproduce after the first process launch, and a focused CPU profile of the same click showed 0.8 ms synchronous work and 14.2 ms paint. Browser verification after the follow-up: 42/42 Playwright tests, Settings mount 26–29 ms, toggle 15–16 ms, tab 16.7 ms. `svelte-check` remains 0 errors/0 warnings, `git diff --check` is clean, and the rebuilt host was installed to `~/.local/bin/opencode-tether` with backup `~/.cache/opencode-tether.bak-speed-20261116-142017`; port 5190 returned HTTP 200. Reload an open tether tab to receive the new frontend.
