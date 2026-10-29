#!/bin/sh
# Convenience installer for the opencode-tether host packages.
# Prefer reading the README and adding the repository yourself.
set -eu

BASE="https://dixonSolutions.github.io/opencode-tether"
REPO="$BASE/repo"
KEYRING=/usr/share/keyrings/opencode-tether.gpg

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: curl -fsSL $BASE/install.sh | sudo sh" >&2
  exit 1
fi

. /etc/os-release
family="${ID_LIKE:-$ID}"

case "$family" in
  *debian*|*ubuntu*)
    command -v apt-get >/dev/null || { echo "apt-get not found" >&2; exit 1; }
    command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
    if curl -fsSL "$BASE/repo/key.asc" -o /tmp/opencode-tether.asc 2>/dev/null; then
      gpg --dearmor < /tmp/opencode-tether.asc > "$KEYRING"
      echo "deb [signed-by=$KEYRING] $REPO/apt stable main" > /etc/apt/sources.list.d/opencode-tether.list
    else
      echo "deb [trusted=yes] $REPO/apt stable main" > /etc/apt/sources.list.d/opencode-tether.list
    fi
    apt-get update
    apt-get install -y opencode-tether
    ;;
  *fedora*|*rhel*|*centos*)
    command -v dnf >/dev/null || { echo "dnf not found" >&2; exit 1; }
    curl -fsSL "$REPO/rpm/opencode-tether.repo" -o /etc/yum.repos.d/opencode-tether.repo
    dnf install -y opencode-tether
    ;;
  *)
    echo "Unsupported distribution: $ID. See $BASE for manual packages." >&2
    exit 1
    ;;
esac

cat <<'EOF'

opencode-tether is installed. Create a host configuration with:

  opencode-tether init
  opencode-tether serve

Then open the printed address. Docs:
  https://github.com/dixonSolutions/opencode-tether
EOF
