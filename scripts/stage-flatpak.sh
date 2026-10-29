#!/usr/bin/env bash
# Stage the prebuilt desktop binary and assets, then (optionally) build the Flatpak repo.
#   scripts/stage-flatpak.sh <desktop-binary> [--build]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BINARY=${1:?usage: stage-flatpak.sh <desktop-binary> [--build]}
BUILD=${2:-}
DIR="$ROOT/packaging/flatpak"

install -m 755 "$BINARY" "$DIR/opencode-tether"
install -m 644 "$ROOT/branding/icon-512.png" "$DIR/ai.opencode.tether.png"

if [ "$BUILD" = "--build" ]; then
  if ! command -v flatpak-builder >/dev/null 2>&1; then
    echo "stage-flatpak: flatpak-builder is required for --build" >&2
    exit 1
  fi
  OUT="$ROOT/public/repo/flatpak"
  mkdir -p "$OUT"
  (cd "$DIR" && flatpak-builder --force-clean --repo "$OUT" build-dir ai.opencode.tether.yml)
  flatpak build-update-repo --prune --generate-static-deltas "$OUT"
  install -m 644 "$DIR/ai.opencode.tether.flatpakref" "$ROOT/public/ai.opencode.tether.flatpakref"
  echo "stage-flatpak: repo at $OUT"
else
  echo "stage-flatpak: staged in $DIR"
fi
