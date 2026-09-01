#!/bin/bash
# Works from any working directory (cd's to this script's own folder first)
# and from any POSIX shell that supports `cd "$(dirname ...)"` -- no
# bash-only features are used beyond the shebang itself, so this also runs
# fine invoked as `sh start_demo.sh`.
cd "$(dirname "$0")" || exit 1

echo "=========================================================="
echo "  ORCA INSIGHT — Multi-Agent Marine Intelligence Platform  "
echo "  SIH 2026 . PS 26176 . ISRO . Team SavioursX              "
echo "=========================================================="
echo ""

# Prefer python3 (macOS/Linux always ship it under this name); fall back to
# `python` for systems where that alias already points at Python 3.
PYCMD=""
if command -v python3 >/dev/null 2>&1; then
  PYCMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYCMD="python"
fi

if [ -z "$PYCMD" ]; then
  echo "ERROR: No Python 3 interpreter found on PATH."
  echo "Install Python 3 (https://www.python.org/downloads/) and re-run this script."
  exit 1
fi

echo "Starting local demo web server on port 3000 (using '$PYCMD')..."
echo "Open in your browser: http://localhost:3000"
echo "On the same Wi-Fi from a phone, use this machine's LAN IP instead of"
echo "localhost -- see the README's 'Mobile / LAN access' section."
echo "Press Ctrl+C to stop the server."
echo ""
exec "$PYCMD" -m http.server 3000
