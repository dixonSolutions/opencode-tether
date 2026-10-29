#!/usr/bin/env bash
# Build one deb or rpm from a server binary.
#   VERSION=0.1.0 ARCH=amd64 BINARY=dist/opencode-tether-x86_64 scripts/package.sh deb dist/pkg.deb
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGER=${1:?usage: package.sh <deb|rpm> <target>}
TARGET=${2:?usage: package.sh <deb|rpm> <target>}
: "${VERSION:?VERSION is required}"
: "${ARCH:?ARCH is required}"
: "${BINARY:?BINARY is required}"
case "$BINARY" in
  /*) BIN_PATH=$BINARY ;;
  *) BIN_PATH="$ROOT/$BINARY" ;;
esac
TMP="$ROOT/.nfpm-resolved.$$.yaml"
trap 'rm -f "$TMP"' EXIT
python3 - "$ROOT/packaging/nfpm.yaml" "$TMP" <<'PY'
import os, sys
source, target = sys.argv[1], sys.argv[2]
text = open(source).read()
for key in ("VERSION", "ARCH", "BINARY"):
    text = text.replace("${" + key + "}", os.environ[key])
open(target, "w").write(text)
PY
cd "$ROOT"
VERSION="$VERSION" ARCH="$ARCH" BINARY="$BIN_PATH" nfpm package --config "$TMP" --packager "$PACKAGER" --target "$TARGET"
