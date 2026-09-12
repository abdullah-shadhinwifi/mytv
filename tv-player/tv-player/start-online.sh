#!/usr/bin/env bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found. Install from https://nodejs.org"
  read -r -p "Press Enter to exit..." x
  exit 1
fi

echo "Starting MyTV server on http://localhost:8080 (admin: /admin)"
node server.js &
SRV=$!
sleep 3

echo
echo "============================================================"
echo "  NOW CREATING A FREE PUBLIC LINK..."
echo "  Copy the URL that prints below (https://....loca.lt or"
echo "  https://....trycloudflare.com) - anyone anywhere can open it."
echo "  Press Ctrl+C to stop."
echo "============================================================"
echo

if command -v cloudflared &>/dev/null; then
  echo "[using cloudflared]"
  cloudflared tunnel --url http://localhost:8080
else
  echo "[using localtunnel]"
  npx -y localtunnel --port 8080
fi

kill "$SRV" 2>/dev/null
