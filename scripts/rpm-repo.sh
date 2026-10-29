#!/usr/bin/env bash
# Build the DNF/YUM repository from .rpm files.
#   scripts/rpm-repo.sh [dist-dir] [output-dir]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST=${1:-$ROOT/dist}
OUT=${2:-$ROOT/public/repo/rpm}

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
shopt -s nullglob
rpms=("$DIST"/*.rpm)
if [ ${#rpms[@]} -eq 0 ]; then
  echo "rpm-repo: no .rpm files in $DIST" >&2
  exit 1
fi
cp -f "${rpms[@]}" "$OUT"/
cp -f "$ROOT/packaging/rpm/opencode-tether.repo" "$OUT/opencode-tether.repo" 2>/dev/null || true

if command -v createrepo_c >/dev/null 2>&1; then
  createrepo_c --database --update --pretty "$OUT"
else
  echo "rpm-repo: createrepo_c is required" >&2
  exit 1
fi

if [ -n "${GPG_KEY_ID:-}" ] && command -v gpg >/dev/null 2>&1; then
  gpg --batch --yes --armor --detach-sign --local-user "$GPG_KEY_ID" "$OUT/repodata/repomd.xml"
  # Metadata is signed; package payloads remain unchanged so repository metadata stays accurate.
  sed -i 's/^repo_gpgcheck=0/repo_gpgcheck=1/' "$OUT/opencode-tether.repo" 2>/dev/null || true
  echo "rpm-repo: signed with $GPG_KEY_ID"
else
  echo "rpm-repo: unsigned (set GPG_KEY_ID to sign)" >&2
fi

echo "rpm-repo: wrote $OUT"
