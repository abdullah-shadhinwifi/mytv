# MyTV — Live Channel Web Player (Admin + User panels)

A simple, attractive single-page **live-TV website**: loads M3U playlists, lets viewers
watch channels in the browser. Two roles:

- 👀 **User panel (`/`)** — watch only. Viewers cannot change any setting.
- 🛡️ **Admin panel (`/admin`)** — manage playlists/sources, change the admin
  password, and see a **live counter of how many users are watching right now**
  (total + per channel + per source).

## Quick start (local)
```bash
cd tv-player
node server.js
```
- User TV:  **http://localhost:8080/**
- Admin:     **http://localhost:8080/admin**  (default password `admin123` → change it!)
- Windows: double-click `start.bat` · Mac/Linux: `bash start.sh`

No dependencies, Node 18+.

## Default channels (ships ready)
- 🇧🇩 Public TV — Bangladesh (iptv-org, ~41)
- 🇮🇳 Public TV — India (iptv-org, ~700)
- 🧪 Official demo channels (NASA, DW, Bloomberg, Red Bull, Akamai)

## Admin panel features
| Area | What you can do |
|---|---|
| 📊 Dashboard | **Live viewers now** (auto-refresh 10 s), which channels are being watched, per-source viewers, source health & channel counts, refresh lists |
| 📡 Sources | add M3U URL, paste raw M3U, edit name/URL, disable/enable, delete |
| ⚙️ Settings | change admin password, public-access instructions |

Users only ever see the TV grid + player; all `/api/source*`, `/api/stats` routes return
`401` without an admin token. Passwords are stored hashed in `data/config.json`; the
default `admin123` is used unless the `ADMIN_PASSWORD` env var is set.

## "How many people are watching?"
Each viewer's browser sends a heartbeat to `/api/heartbeat` every 15 s **while a video is
actually playing** (and reports stop/close). `/api/stats` (admin) shows the current count.
Viewers more than ~60 s silent are dropped automatically.

## Show it outside the local network — for free
The server already listens on `0.0.0.0`. To give people a **free public URL**:

1. Keep `node server.js` running (or use `start-online.bat` / `bash start-online.sh`
   which starts the server *and* a free tunnel for you).
2. Then use **one** of these:
   - **Cloudflare Tunnel (free, reliable):** install `cloudflared`
     (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
     then: `cloudflared tunnel --url http://localhost:8080`
     → gives an `https://….trycloudflare.com` URL.
   - **localtunnel (zero install, Node only):** `npx -y localtunnel --port 8080`
     → gives an `https://….loca.lt` URL.
   - **Render free hosting** (proper hosting, sleeps after ~15 min idle):
     push to GitHub → render.com → New → Web Service → repo → Start command
     `node server.js`. Optional env `PLAYLIST_URL` to preload playlists.
3. Share the public URL. **Before sharing, change the admin password** (Settings) —
   otherwise anyone on the public link can log into the admin panel.

> ⚠️ Free tunnels give a *random* URL each restart. For a permanent free URL use
> Render/Koyeb or a paid domain + Cloudflare tunnel.

## Notes / legality
- Only use playlists you have rights to. Demo channels are official public streams.
- iptv-org indexes publicly accessible streams; availability varies.
- skym3u "Etud" links (`go.skym3u.dev/….m3u`) are ad-"link locker" pages — they only
  serve a playlist to the exact browser session that completed their ad steps, so no
  server can load them. The app therefore ships with directly loadable public lists,
  which you can replace from the admin panel.
- On hosted (Render-like) servers the file system is ephemeral — use the `PLAYLIST_URL`
  env var for sources you want to survive redeploys.

## API (quick)
| Route | Access | Purpose |
|---|---|---|
| `/api/channels` | public | channel list |
| `/api/heartbeat` | public | viewer presence while playing |
| `/api/admin/login` · `/status` · `/logout` · `/password` | – / admin | auth |
| `/api/source` GET/POST | **admin** | list / add / edit / toggle / delete sources |
| `/api/stats` | **admin** | live viewer counter |
| `/api/stream?url=` / `/api/img?url=` | public | HLS & image proxy |

Files: `server.js`, `public/` (index.html, admin.html, style.css, app.js, hls.min.js),
`data/` (state.json + config.json, created on first run).
