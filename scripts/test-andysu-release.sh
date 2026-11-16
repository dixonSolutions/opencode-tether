#!/usr/bin/env bash
# Checks the AndySU wiring that cannot break at runtime but can break a release: the pinned
# version, where the live APK is attached, that the existing release does not wait on the live
# job, and that no private key is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
import re
workflow = Path('.github/workflows/release.yml').read_text()
resign = Path('.github/workflows/andysu-resign.yml').read_text()
live = workflow[workflow.index('\n  andysu-live:'):]
before = workflow[:workflow.index('\n  andysu-live:')]
# The live job is a leaf: nothing waits on it and it cannot fail the run.
assert 'andysu-live' not in before, 'an earlier job depends on the live job'
assert 'continue-on-error: true' in live
# Old clients take the first .apk of releases/latest: the live APK goes to the channel release only.
uploads = re.findall(r'gh release upload (\S+)', live)
assert uploads and all(u == 'channel-live-arm64' for u in uploads), uploads
assert '--prerelease --latest=false' in live
assert 'softprops/action-gh-release' not in live
pins = set(re.findall(r'AndySU/releases/download/v([0-9.]+)/', workflow + resign))
pins |= set(re.findall(r'actions/publish@v([0-9.]+)', workflow))
pins |= set(re.findall(r'andysu-version: ([0-9.]+)', workflow))
pins |= set(re.findall(r'andysu-host-template-([0-9.]+)\.zip', workflow))
assert len(pins) == 1, f'AndySU pins disagree: {pins}'
assert 'ANDYSU_SIGNING_KEY' in workflow and 'skipping live release' in workflow
# Host versionCode must not be below the plain APK's.
assert '"$host_code" -ge "$plain_code"' in live
toml = re.sub(r'#.*', '', Path('andysu.toml').read_text())
assert 'crash_signals' not in toml
for want in ('host_api = 3', 'mode = "auto"', 'apply = "live"', 'live_fallback = "restart"', 'check_interval_minutes = 60', 'watchdog_ms = 120000', 'channel = "live-arm64"', 'app = "ai.opencode.tether"'):
    assert want in toml, want
for pem in Path('keys').iterdir():
    assert 'PRIVATE' not in pem.read_text(), pem
print('AndySU release wiring ok: pin', pins.pop())
PY
