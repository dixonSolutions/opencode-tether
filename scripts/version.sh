#!/usr/bin/env bash
# Print the version used for builds. Override with TETHER_VERSION.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=${TETHER_VERSION:-$(node -p "require('$ROOT/apps/tether/package.json').version")}
BUILD_ID=${TETHER_BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}
if [ -n "${GITHUB_RUN_NUMBER:-}" ] && [ -z "${TETHER_VERSION:-}" ]; then
  BUILD_ID=${GITHUB_RUN_NUMBER}
fi
printf 'TETHER_BASE_VERSION=%s\n' "$BASE"
printf 'TETHER_BUILD_ID=%s\n' "$BUILD_ID"
