#!/usr/bin/env bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo
  echo "  [ERROR] Node.js not found."
  echo "  Install the LTS version from https://nodejs.org then run this again."
  echo
  read -r -p "Press Enter to exit..."
  exit 1
fi

echo "  Starting MyTV on http://localhost:8080"
echo "  (Ctrl+C to stop the server)"
echo
node server.js
