#!/usr/bin/env bash
# Build the APT repository from .deb files.
#   scripts/apt-repo.sh [dist-dir] [output-dir]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST=${1:-$ROOT/dist}
OUT=${2:-$ROOT/public/repo/apt}
SUITE=stable
COMPONENT=main
POOL="$OUT/pool/main/o/opencode-tether"

mkdir -p "$POOL"
shopt -s nullglob
debs=("$DIST"/*.deb)
if [ ${#debs[@]} -eq 0 ]; then
  echo "apt-repo: no .deb files in $DIST" >&2
  exit 1
fi
cp -f "${debs[@]}" "$POOL"/

ARCHES="amd64 arm64 armhf"
for arch in $ARCHES; do
  dir="$OUT/dists/$SUITE/$COMPONENT/binary-$arch"
  mkdir -p "$dir"
  (cd "$OUT" && dpkg-scanpackages --multiversion pool /dev/null 2>/dev/null > "$dir/Packages")
  gzip -9c "$dir/Packages" > "$dir/Packages.gz"
done

if command -v apt-ftparchive >/dev/null 2>&1; then
  (cd "$OUT/dists/$SUITE" && apt-ftparchive release . > Release)
else
  {
    echo "Origin: opencode-tether"
    echo "Label: opencode-tether"
    echo "Suite: $SUITE"
    echo "Codename: $SUITE"
    echo "Architectures: $ARCHES"
    echo "Components: $COMPONENT"
    echo "Description: opencode-tether host packages"
    echo "Date: $(date -Ru)"
  } > "$OUT/dists/$SUITE/Release"
fi

if [ -n "${GPG_KEY_ID:-}" ] && command -v gpg >/dev/null 2>&1; then
  gpg --batch --yes --armor --detach-sign --local-user "$GPG_KEY_ID" -o "$OUT/dists/$SUITE/Release.gpg" "$OUT/dists/$SUITE/Release"
  gpg --batch --yes --armor --clearsign --local-user "$GPG_KEY_ID" -o "$OUT/dists/$SUITE/InRelease" "$OUT/dists/$SUITE/Release"
  echo "apt-repo: signed with $GPG_KEY_ID"
else
  echo "apt-repo: unsigned (set GPG_KEY_ID to sign); clients must use [trusted=yes]" >&2
fi

echo "apt-repo: wrote $OUT"
