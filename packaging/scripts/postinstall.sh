#!/bin/sh
set -e

echo ""
echo "opencode-tether installed."
echo ""
echo "  1. Create your host config:"
echo "       opencode-tether init"
echo "  2. Start it for a first run:"
echo "       opencode-tether serve"
echo "  3. Enable the user service (optional):"
echo "       systemctl --user daemon-reload"
echo "       systemctl --user enable --now opencode-tether"
echo "       loginctl enable-linger \"$USER\""
echo ""
echo "opencode must be installed and available on PATH."
echo "Docs: https://github.com/dixonSolutions/opencode-tether"
echo ""
