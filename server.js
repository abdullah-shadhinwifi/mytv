/**
 * TV Channel Web App — zero-dependency Node server
 *
 * Serves:
 *  - static front-end (public/)
 *  - /api/channels   -> parsed channel list from configured M3U sources
 *  - /api/source     -> GET (current sources) / POST (add or update a source)
 *  - /api/stream     -> same-origin HLS proxy with manifest re-writing
 *  - /api/img        -> image proxy so http logos work on an https page
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { Readable } = require('stream');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const APP_VERSION = '4.0'; // TV + Movies (FTP), password hidden, instant play

// ---------------------------------------------------------------------------
// Admin auth (in-memory token store) + viewer presence store
// ---------------------------------------------------------------------------
const ADMIN_TOKENS = new Map(); // token -> expiresAt
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 h
const VIEWERS = new Map(); // viewerId -> { last, channelId, name, source, ip }
const VIEWER_TTL = 60 * 1000; // considered offline after 60 s of silence

const PORT = process.env.PORT || 8080;

const FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------------------------------------------------------------------
// The playlist URL the user provided (ad-protected "link locker")
// ---------------------------------------------------------------------------
// iptv-org's open, directly-fetchable public country playlists
const IPTV_ORG_BD = 'https://iptv-org.github.io/iptv/countries/bd.m3u';
const IPTV_ORG_IN = 'https://iptv-org.github.io/iptv/countries/in.m3u';

const LOGO = (d) => 'https://www.google.com/s2/favicons?domain=' + d + '&sz=128';

// Curated working channels — tested via /api/stream proxy (2026-09-11)
// These are shown FIRST and are the only ones in the default mobile view.
// BD channels via aynaott/sonarbangla work reliably through the proxy.
const VERIFIED_RAW = [
  '#EXTM3U',
  // --- Bangladesh — verified working via proxy ---
  '#EXTINF:-1 tvg-id="ATNBangla.bd" tvg-logo="' + LOGO('atnbangla.tv') + '" group-title="Bangladesh",ATN Bangla HD',
  'https://tvsen5.aynaott.com/atnbangla/index.m3u8',
  '#EXTINF:-1 tvg-id="BanglaVision.bd" tvg-logo="' + LOGO('banglavision.tv') + '" group-title="Bangladesh",Bangla Vision HD',
  'https://tvsen5.aynaott.com/banglavision/index.m3u8',
  '#EXTINF:-1 tvg-id="BoishakhiTV.bd" tvg-logo="' + LOGO('boishakhi.tv') + '" group-title="Bangladesh",Boishakhi TV',
  'https://boishakhi.sonarbanglatv.com/boishakhi/boishakhitv/index.m3u8',
  '#EXTINF:-1 tvg-id="NTV.bd" tvg-logo="' + LOGO('ntvbd.com') + '" group-title="Bangladesh",NTV Bangladesh HD',
  'https://tvsen5.aynaott.com/xV4jEKf3D9zc/index.m3u8',
  '#EXTINF:-1 tvg-id="RTV.bd" tvg-logo="' + LOGO('rtvonline.com') + '" group-title="Bangladesh",RTV HD',
  'https://tvsen5.aynaott.com/RtvHD/index.m3u8',
  '#EXTINF:-1 tvg-id="TSports.bd" tvg-logo="' + LOGO('tsports.com') + '" group-title="Sports",T Sports HD',
  'https://tvsen5.aynaott.com/TnMn5kZz8aLm/index.m3u8',
  '#EXTINF:-1 tvg-id="EkusheyTV.bd" tvg-logo="' + LOGO('ekushey-tv.com') + '" group-title="Bangladesh",Ekushey TV',
  'https://ekusheyserver.com/etvlivesn.m3u8',
  '#EXTINF:-1 tvg-id="DBCNews.bd" tvg-logo="' + LOGO('dbcnews.tv') + '" group-title="News",DBC News',
  'http://tvn3.chowdhury-shaheb.com/dbc/index.m3u8',
  '#EXTINF:-1 tvg-id="MaasrangaTV.bd" tvg-logo="' + LOGO('maasranga.tv') + '" group-title="Entertainment",Maasranga TV',
  'http://tvsen5.aynascope.net/maasrangatv/index.m3u8',
  '#EXTINF:-1 tvg-id="GaziTV.bd" tvg-logo="' + LOGO('gtvbd.com') + '" group-title="Sports",Gazi TV (GTV)',
  'http://tvn1.chowdhury-shaheb.com/gazitv/index.m3u8',
  // --- International — verified working ---
  '#EXTINF:-1 tvg-id="dw" tvg-logo="' + LOGO('dw.com') + '" group-title="News",DW News English',
  'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
  '#EXTINF:-1 tvg-id="redbull" tvg-logo="' + LOGO('redbull.com') + '" group-title="Sports",Red Bull TV',
  'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
  '#EXTINF:-1 tvg-id="euronews" tvg-logo="' + LOGO('euronews.com') + '" group-title="News",Euronews English',
  'https://euronews-euronews-1-eu.rakuten.wurl.tv/playlist.m3u8',
  '#EXTINF:-1 tvg-id="aljazeera" tvg-logo="' + LOGO('aljazeera.com') + '" group-title="News",Al Jazeera English (backup)',
  'https://live-hls-audio-web-aje.getaj.net/AJE/index.m3u8',
  '#EXTINF:-1 tvg-id="france24" tvg-logo="' + LOGO('france24.com') + '" group-title="News",France 24 English',
  'https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8',
  '#EXTINF:-1 tvg-id="nasa" tvg-logo="' + LOGO('nasa.gov') + '" group-title="Science",NASA TV Public',
  'https://nasa-nasatv.wurl.tv/playlist.m3u8',
  '#EXTINF:-1 tvg-id="bloomberg" tvg-logo="' + LOGO('bloomberg.com') + '" group-title="Business",Bloomberg Quicktake',
  'https://bloomberg-bloomberg-3-us.plex.wurl.tv/playlist.m3u8',
  '#EXTINF:-1 tvg-id="rt" tvg-logo="' + LOGO('rt.com') + '" group-title="News",RT News (Documentary)',
  'https://rt-glb.rttv.com/live/rtnews/playlist.m3u8',
  '#EXTINF:-1 tvg-id="fashiontv" tvg-logo="' + LOGO('fashiontv.com') + '" group-title="Entertainment",Fashion TV',
  'https://fashiontv-fashiontv-1-eu.rakuten.wurl.tv/playlist.m3u8',
  '',
].join('\n');

const DEMO_RAW = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="akamai" tvg-logo="' + LOGO('akamai.com') + '" group-title="Test",Akamai Live Test',
  'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  '',
].join('\n');

function defaultState() {
  const sources = [];
  // Primary: curated working channels — shown first, mobile-friendly, instant play
  sources.push({
    id: 'verified',
    name: '✅ Verified Working — Bangladesh + International (20+)',
    type: 'raw',
    raw: VERIFIED_RAW,
  });
  // Bangladesh — iptv-org (41 channels, many work via proxy)
  sources.push({
    id: 'bd',
    name: '🇧🇩 Bangladesh — iptv-org (41+)',
    type: 'url',
    url: IPTV_ORG_BD,
    enabled: true,
  });
  // Bangladesh Extra — Mrgify BDIX mix (180+ channels, aynaott/sonarbangla/tsports work globally)
  sources.push({
    id: 'bd-mix',
    name: '🇧🇩 Bangladesh Mix — Mrgify (180+ inc. T Sports, Deepto, MyTV)',
    type: 'url',
    url: 'https://raw.githubusercontent.com/abusaeeidx/Mrgify-BDIX-IPTV/main/playlist.m3u',
    enabled: true,
  });
  // India — keep disabled by default (700+), user can enable from admin if needed
  sources.push({
    id: 'in',
    name: '🇮🇳 India — iptv-org (700+)',
    type: 'url',
    url: IPTV_ORG_IN,
    enabled: false,
  });
  sources.push({
    id: 'demo',
    name: 'Free official demo channels',
    type: 'raw',
    raw: DEMO_RAW,
    enabled: true,
  });
  applyEnvSources(sources);

  // Standard Movies — always working HTTP + FTP demo
  // These are built-in, so even on Render free tier they never disappear
  const movies = [
    {
      id: 'mov-bbb',
      name: 'Big Buck Bunny — Demo Movie (HD)',
      group: 'Demo',
      logo: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
      url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
      enabled: true,
    },
    {
      id: 'mov-sintel',
      name: 'Sintel — Open Movie (HD)',
      group: 'Demo',
      logo: 'https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg',
      url: 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4',
      enabled: true,
    },
    {
      id: 'mov-jelly',
      name: 'Jellyfish — Nature Demo (HD)',
      group: 'Demo',
      logo: '',
      url: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',
      enabled: true,
    },
    {
      id: 'mov-ftp-standard',
      name: 'FTP Standard — Big Buck Bunny (FTP)',
      group: 'FTP',
      logo: '',
      url: 'ftp://ftp.nluug.nl/pub/graphics/blender/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4',
      enabled: true,
    },
  ];

  return { sources, movies, updated: Date.now() };
}

// PLAYLIST_URL="https://a.m3u,https://b.m3u" -> extra sources (kept across
// restarts; handy on hosts like Render where the file system is ephemeral).
function envPlaylistUrls() {
  const v = (process.env.PLAYLIST_URL || '').trim();
  if (!v) return [];
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function applyEnvSources(sources) {
  envPlaylistUrls().forEach((url, i) => {
    const id = 'env-' + i;
    if (!sources.some((s) => s.id === id)) {
      sources.push({ id, name: 'Playlist #' + (i + 1), type: 'url', url });
    }
  });
}

function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      const s = defaultState();
      fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
      return s;
    }
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    s.sources = s.sources || [];
    // movies: if file exists but empty, fill with default standard movies
    const def = defaultState();
    if (!s.movies || !Array.isArray(s.movies) || s.movies.length === 0) {
      s.movies = def.movies;
    }
    applyEnvSources(s.sources); // make sure env playlists are always present
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    return s;
  } catch (e) {
    return defaultState();
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    state.updated = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Admin config (password stored hashed in data/config.json)
// On Render the file-system is ephemeral, so we also respect ADMIN_PASSWORD env.
// ---------------------------------------------------------------------------
let config = null;
function hashPw(pw) {
  return crypto.createHash('sha256').update('mytv::' + pw).digest('hex');
}
function loadConfig() {
  const envPw = (process.env.ADMIN_PASSWORD || '').trim();
  const fallbackHash = hashPw(envPw || 'admin123');
  const fallback = { adminPassHash: fallbackHash, createdAt: Date.now(), fromEnv: !!envPw };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(fallback, null, 2));
      config = fallback;
      console.log('[config] created with ' + (envPw ? 'ADMIN_PASSWORD env' : 'default admin123'));
      return config;
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // If file exists, it is the source of truth — even if env var is set,
    // we keep the file so that a UI password change persists locally.
    // On Render the file disappears on restart, so env var becomes source again.
    config = {
      adminPassHash: parsed.adminPassHash || fallbackHash,
      createdAt: parsed.createdAt || Date.now(),
      fromEnv: !!envPw && parsed.fromEnv !== false && parsed.adminPassHash === fallbackHash,
    };
    // If ADMIN_PASSWORD env is set and file still has the old default hash,
    // upgrade it to env hash so that Render env change takes effect.
    if (envPw && parsed.adminPassHash === hashPw('admin123')) {
      config.adminPassHash = fallbackHash;
      config.fromEnv = true;
      try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
    }
    return config;
  } catch (e) {
    console.error('[config] load failed, using fallback:', e.message);
    config = fallback;
    return config;
  }
}
function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('[config] saved');
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
}
function issueToken() {
  const tok = crypto.randomBytes(24).toString('hex');
  ADMIN_TOKENS.set(tok, Date.now() + TOKEN_TTL);
  for (const [k, exp] of ADMIN_TOKENS) if (exp < Date.now()) ADMIN_TOKENS.delete(k);
  return tok;
}
function clientToken(req) {
  const h = req.headers['authorization'] || '';
  let tok = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-admin-token'] || '');
  if (!tok) {
    const u = new URL(req.url, 'http://localhost');
    tok = u.searchParams.get('token') || '';
  }
  return tok;
}
function isAdmin(req) {
  const tok = clientToken(req);
  const exp = ADMIN_TOKENS.get(tok);
  if (!exp) return false;
  if (exp < Date.now()) { ADMIN_TOKENS.delete(tok); return false; }
  return true;
}
function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '?'
  );
}
function pruneViewers() {
  const now = Date.now();
  for (const [id, v] of VIEWERS) if (now - v.last > VIEWER_TTL) VIEWERS.delete(id);
}
// only viewers currently "playing" something count as live
function liveViewerList() {
  pruneViewers();
  const now = Date.now();
  const list = [];
  for (const [id, v] of VIEWERS) {
    if (v.playing && now - v.last <= VIEWER_TTL) list.push(v);
  }
  return list;
}

loadConfig();

let state = loadState();

// ---------------------------------------------------------------------------
// M3U parsing
// ---------------------------------------------------------------------------
function parseM3U(text, sourceId, sourceName) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let pending = null; // { meta attrs, name, group }
  let extGrp = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#EXTINF:')) {
      const attrs = {};
      // attributes come in key="value" form inside the extinf line
      const attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
      let m;
      while ((m = attrRe.exec(line)) !== null) attrs[m[1].toLowerCase()] = m[2];

      const commaIdx = line.lastIndexOf(',');
      let name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      if (!name && attrs['tvg-name']) name = attrs['tvg-name'];
      if (!name) name = 'Channel';

      pending = {
        name,
        group: attrs['group-title'] || extGrp || 'Ungrouped',
        logo: attrs['tvg-logo'] || attrs.logo || '',
        tvgId: attrs['tvg-id'] || '',
        url: '',
      };
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      extGrp = line.slice('#EXTGRP:'.length).trim() || 'Ungrouped';
      continue;
    }

    if (line.startsWith('#')) continue; // other directives / comments

    // A stream URL line
    if (pending) {
      pending.url = line;
      channels.push({
        ...pending,
        source: sourceName,
        sourceId,
      });
      pending = null;
    }
  }
  return channels;
}

// ---------------------------------------------------------------------------
// Fetching sources
// ---------------------------------------------------------------------------
const cache = new Map();

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(url, {
    headers: {
      'user-agent': FETCH_UA,
      accept: '*/*',
    },
    redirect: 'follow',
    signal: ctrl.signal,
  });
  clearTimeout(t);
  const buf = await res.arrayBuffer();
  return { status: res.status, text: Buffer.from(buf).toString('utf8') };
}

async function resolveSource(src) {
  try {
    let text = '';
    if (src.type === 'raw') {
      // built-in lists always come from code so we can improve them anytime
      if (src.id === 'verified') text = VERIFIED_RAW;
      else if (src.id === 'demo') text = DEMO_RAW;
      else text = src.raw || '';
    } else {
      const cached = cache.get(src.url);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        return { ok: true, channels: cached.channels, name: src.name, id: src.id };
      }
      const fetched = await fetchText(src.url);
      text = fetched.text;

      const head400 = text.slice(0, 400).toLowerCase();
      const head1000 = text.slice(0, 2000).toLowerCase();
      const hasExtM3U = head1000.includes('#extm3u');
      const hasExtInf = text.toLowerCase().includes('#extinf');
      const looksHtml =
        head400.includes('<!doctype') ||
        head400.includes('<html') ||
        head400.includes('<!DOCTYPE') ||
        head400.includes('ad-blocker') ||
        head400.includes('ublock') ||
        head400.includes('link-locker') ||
        (fetched.status === 403 && !hasExtM3U) ||
        (fetched.status === 200 && !hasExtM3U && !hasExtInf);

      if (looksHtml) {
        let reason = 'Ad-protected page returned instead of a playlist (link-locker).';
        if (head400.includes('ad-blocker') || head400.includes('ublock')) {
          reason =
            'The playlist provider shows an “disable ad-blocker” page. It must be unlocked in a real browser first.';
        } else if (fetched.status === 403) {
          reason =
            'The provider returned HTTP 403 / an anti-scraping page — the link is protected for browser use only.';
        }
        return { ok: false, id: src.id, name: src.name, reason, status: fetched.status };
      }

      if (!hasExtM3U && !hasExtInf) {
        return {
          ok: false,
          id: src.id,
          name: src.name,
          reason: 'The response does not look like an M3U playlist.',
          status: fetched.status,
        };
      }
      const channels = parseM3U(text, src.id, src.name);
      cache.set(src.url, { channels, at: Date.now() });
      return { ok: true, channels, name: src.name, id: src.id };
    }
    const channels = parseM3U(text, src.id, src.name);
    return { ok: true, channels, name: src.name, id: src.id };
  } catch (e) {
    return {
      ok: false,
      id: src.id,
      name: src.name,
      reason: 'Could not reach the source: ' + (e.message || 'network error'),
    };
  }
}

async function collectChannels() {
  const active = state.sources.filter((s) => s.enabled !== false);
  const results = await Promise.all(active.map(resolveSource));
  const sources = [];
  const channels = [];
  for (const r of results) {
    if (r.ok) {
      sources.push({ id: r.id, name: r.name, reachable: true, count: r.channels.length });
      channels.push(...r.channels);
    } else {
      sources.push({ id: r.id, name: r.name, reachable: false, reason: r.reason });
    }
  }
  const categories = {};
  for (const c of channels) categories[c.group] = (categories[c.group] || 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    sources,
    channels: channels.map((c, i) => ({
      id: c.sourceId + ':' + i,
      sourceId: c.sourceId,
      source: c.source,
      name: c.name,
      group: c.group,
      logo: c.logo,
      tvgId: c.tvgId,
      url: c.url,
      scheme: (c.url.match(/^([a-z][a-z0-9+.-]*):/i) || [, ''])[1].toLowerCase(),
      verified: c.sourceId === 'verified' || c.sourceId === 'demo',
    })),
    stats: {
      total: channels.length,
      categories: Object.keys(categories).length,
      byCategory: categories,
    },
  };
}

// ---------------------------------------------------------------------------
// URL / proxy helpers
// ---------------------------------------------------------------------------
function validHttpUrl(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const h = parsed.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '::1' ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function looksLikeManifest(contentType, url) {
  return (
    /mpegurl|m3u8/i.test(contentType || '') || /\.m3u8(?:$|\?)/i.test(url || '')
  );
}

// Rewrite every fetchable URL inside an HLS manifest so it flows through our
// same-origin proxy. Handles absolute URLs, relative URLs (resolved against the
// manifest's own URL) and URI="..." attributes (EXT-X-KEY / EXT-X-MAP / …).
function rewriteManifest(manifestUrl, text) {
  const proxyOf = (u) => '/api/stream?url=' + encodeURIComponent(u);
  const abs = (u) => {
    try { return new URL(u, manifestUrl).href; } catch (e) { return null; }
  };

  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw;

    // URI="..." attributes (relative or absolute)
    line = line.replace(/(URI\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, val) => {
      const target = abs(val);
      return target ? pre + q + proxyOf(target) + q : m;
    });

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.includes('URI=')) {
      const target = abs(trimmed);
      if (target) line = proxyOf(target);
    }
    out.push(line);
  }
  return out.join('\n');
}

async function pipeUpstream(res, target) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  let up;
  try {
    up = await fetch(target, {
      headers: {
        'user-agent': FETCH_UA,
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'referer': new URL(target).origin + '/',
        'origin': new URL(target).origin,
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    }
    res.end('Upstream fetch failed: ' + (e.message || e));
    return;
  }
  clearTimeout(t);

  if (up.status >= 400 && up.status !== 416) {
    // Try to give a helpful body instead of empty
    let body = '';
    try { body = await up.text(); } catch (e) {}
    if (!res.headersSent) {
      res.writeHead(up.status, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    }
    res.end('Upstream error ' + up.status + (body ? ': ' + body.slice(0, 500) : ''));
    return;
  }

  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'access-control-allow-headers': '*',
  };
  const ct = up.headers.get('content-type');

  // If the upstream response is an HLS manifest, rewrite every absolute URL
  // inside it so segments & keys flow through our same-origin proxy too.
  if (up.body && looksLikeManifest(ct, target)) {
    let text = '';
    try { text = await up.text(); } catch (e) { text = ''; }
    if (!text) {
      if (!res.headersSent) res.writeHead(502, headers);
      return res.end('Empty manifest from upstream');
    }
    const rewritten = rewriteManifest(target, text);
    headers['content-type'] = 'application/vnd.apple.mpegurl';
    headers['cache-control'] = 'no-store';
    if (!res.headersSent) res.writeHead(up.status, headers);
    res.end(rewritten, 'utf8');
    return;
  }

  if (ct) headers['content-type'] = ct;
  else headers['content-type'] = 'application/octet-stream';
  if (up.headers.get('content-length')) headers['content-length'] = up.headers.get('content-length');
  if (up.status === 206) {
    const cr = up.headers.get('content-range');
    if (cr) headers['content-range'] = cr;
  }
  // Some CDNs need CORS for media
  headers['access-control-expose-headers'] = 'content-length, content-range';

  if (!res.headersSent) res.writeHead(up.status, headers);
  if (up.body) {
    const nodeStream = Readable.fromWeb(up.body);
    // if the viewer stops / switches channel, free the upstream connection too
    res.on('close', () => { try { nodeStream.destroy(); } catch (e) {} });
    nodeStream.on('error', (err) => {
      console.error('[proxy] stream error for', target, err.message);
      try { res.destroy(); } catch (e) {}
    });
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Tiny router / static server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  try {
    // ----- Admin: login / logout / status / password -----
    if (p === '/api/admin/login' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (hashPw(String(body.password || '')) === config.adminPassHash) {
        const token = issueToken();
        return json(res, 200, { ok: true, token });
      }
      return json(res, 401, { ok: false, error: 'Wrong password' });
    }
    if (p === '/api/admin/status' && req.method === 'GET') {
      const envSet = !!(process.env.ADMIN_PASSWORD || '').trim();
      const isDefault = hashPw('admin123') === config.adminPassHash && !envSet;
      return json(res, 200, {
        ok: true,
        admin: isAdmin(req),
        defaultPassword: isDefault,
        envPasswordSet: envSet,
      });
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      const tok = clientToken(req);
      if (tok) ADMIN_TOKENS.delete(tok);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/password' && req.method === 'POST') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      const body = JSON.parse(await readBody(req));
      if (hashPw(String(body.current || '')) !== config.adminPassHash) {
        return json(res, 403, { ok: false, error: 'Current password is wrong' });
      }
      const npw = String(body.new || '');
      if (npw.length < 4) return json(res, 400, { ok: false, error: 'New password must be at least 4 characters' });
      config.adminPassHash = hashPw(npw);
      config.fromEnv = false;
      saveConfig();
      const envSet = !!(process.env.ADMIN_PASSWORD || '').trim();
      // On Render free tier the file disappears on restart, so warn the user
      if (envSet) {
        return json(res, 200, {
          ok: true,
          warning: 'Password changed for this instance, but ADMIN_PASSWORD env var is set on Render — after a restart it will revert to the env value. Update the env var in Render dashboard for permanent change.',
        });
      }
      return json(res, 200, { ok: true });
    }

    // ----- API: channels (public read — users need the list to watch) -----
    if (p === '/api/channels' && req.method === 'GET') {
      const data = await collectChannels();
      return json(res, 200, { ok: true, ...data });
    }

    // ----- Heartbeat: every open viewer reports what it is playing -----
    if (p === '/api/heartbeat' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 50000));
        const id = String(body.viewerId || '').slice(0, 64);
        if (!id) return json(res, 200, { ok: true });
        const playing = !!body.playing;
        const ip = clientIp(req);
        if (playing && body.channelId) {
          VIEWERS.set(id, {
            last: Date.now(),
            playing: true,
            channelId: String(body.channelId).slice(0, 120),
            name: String(body.name || 'Unknown').slice(0, 120),
            source: String(body.source || '').slice(0, 80),
            ip,
          });
        } else {
          const v = VIEWERS.get(id);
          if (v) {
            if (playing === false) VIEWERS.delete(id);
            else v.last = Date.now();
          } else {
            VIEWERS.set(id, { last: Date.now(), playing: false, ip });
          }
        }
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 200, { ok: true });
      }
    }

    // ----- Admin: live dashboard stats -----
    if (p === '/api/stats' && req.method === 'GET') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      const list = liveViewerList();
      const perChannel = {};
      const perSource = {};
      for (const v of list) {
        const key = v.name || v.channelId || 'Unknown';
        perChannel[key] = (perChannel[key] || 0) + 1;
        perSource[v.source || '—'] = (perSource[v.source || '—'] || 0) + 1;
      }
      const byChannel = Object.entries(perChannel)
        .map(([channel, viewers]) => ({ channel, viewers }))
        .sort((a, b) => b.viewers - a.viewers);
      const bySource = Object.entries(perSource)
        .map(([source, viewers]) => ({ source, viewers }))
        .sort((a, b) => b.viewers - a.viewers);
      return json(res, 200, {
        ok: true,
        live: { total: list.length, byChannel, bySource },
        server: { uptimeSec: Math.round(process.uptime()), now: new Date().toISOString() },
      });
    }

    // ----- Admin: current sources (admin only) -----
    if (p === '/api/source' && req.method === 'GET') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      return json(res, 200, {
        ok: true,
        sources: state.sources.map(({ id, name, type, url, raw, note, enabled }) => ({
          id,
          name,
          type,
          url,
          hasRaw: type === 'raw',
          enabled: enabled !== false,
          builtin: id === 'demo',
          note,
        })),
      });
    }

    // ----- Admin: add / update / enable / disable / delete source -----
    if (p === '/api/source' && req.method === 'POST') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      const body = JSON.parse(await readBody(req));
      const find = () => state.sources.find((s) => s.id === body.id);

      if (body.action === 'delete' && body.id) {
        const del = state.sources.find((s) => s.id === body.id);
        if (del && del.url) cache.delete(del.url);
        state.sources = state.sources.filter((s) => s.id !== body.id);
        saveState(state);
        cache.clear();
        return json(res, 200, { ok: true });
      }
      if (body.action === 'toggle' && body.id) {
        const s = find();
        if (s) {
          s.enabled = body.enabled === false ? false : true;
          if (s.url) cache.delete(s.url);
          saveState(state);
          cache.clear();
          return json(res, 200, { ok: true, enabled: s.enabled !== false });
        }
        return json(res, 404, { ok: false, error: 'Source not found' });
      }
      if (body.action === 'update' && body.id) {
        const s = find();
        if (!s) return json(res, 404, { ok: false, error: 'Source not found' });
        if (s.url) cache.delete(s.url);
        if (body.name !== undefined) s.name = String(body.name).slice(0, 120);
        if (body.url !== undefined && String(body.url).trim()) {
          const url = String(body.url).trim();
          if (!/^https?:\/\//i.test(url)) return json(res, 400, { ok: false, error: 'URL must start with http:// or https://' });
          if (s.id !== 'demo') s.url = url;
        }
        if (body.raw !== undefined && s.id !== 'demo') s.raw = String(body.raw);
        saveState(state);
        cache.clear();
        return json(res, 200, { ok: true });
      }

      const name = String(body.name || 'Custom playlist').slice(0, 120);
      if (body.raw !== undefined && String(body.raw).trim()) {
        const id = body.id || 'raw-' + Date.now().toString(36);
        const exists = state.sources.find((s) => s.id === id);
        const entry = { id, name, type: 'raw', raw: String(body.raw), enabled: true };
        if (exists) Object.assign(exists, entry);
        else state.sources.push(entry);
        saveState(state);
        cache.clear();
        return json(res, 200, { ok: true, id });
      }
      if (body.url !== undefined && String(body.url).trim()) {
        const url = String(body.url).trim();
        if (!/^https?:\/\//i.test(url)) {
          return json(res, 400, { ok: false, error: 'URL must start with http:// or https://' });
        }
        const id = body.id || 'src-' + Date.now().toString(36);
        const entry = { id, name, type: 'url', url, enabled: true };
        // quick reachability probe — clear cache first so we fetch fresh
        cache.delete(url);
        const probe = await resolveSource(entry).catch(() => null);
        const exists = state.sources.find((s) => s.id === id);
        if (exists) Object.assign(exists, entry);
        else state.sources.push(entry);
        saveState(state);
        cache.clear();
        if (probe && !probe.ok) {
          return json(res, 200, {
            ok: true,
            id,
            added: true,
            warning: 'Saved, but this source could not be read right now: ' + probe.reason,
          });
        }
        return json(res, 200, {
          ok: true,
          id,
          added: true,
          channels: probe && probe.ok ? probe.channels.length : null,
        });
      }
      return json(res, 400, { ok: false, error: 'Provide a url or raw m3u text.' });
    }

    // ----- API: movies (public) -----
    if (p === '/api/movies' && req.method === 'GET') {
      const movies = (state.movies || []).filter(m => m.enabled !== false).map(m => ({
        id: m.id,
        name: m.name,
        group: m.group || 'Movies',
        logo: m.logo || '',
        url: m.url,
        scheme: (m.url.match(/^([a-z][a-z0-9+.-]*):/i) || [, ''])[1].toLowerCase(),
      }));
      return json(res, 200, { ok: true, movies, total: movies.length });
    }

    // ----- Admin: movie sources -----
    if (p === '/api/movie-source' && req.method === 'GET') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      return json(res, 200, {
        ok: true,
        movies: (state.movies || []).map(m => ({
          id: m.id,
          name: m.name,
          group: m.group || 'Movies',
          logo: m.logo || '',
          url: m.url,
          enabled: m.enabled !== false,
        })),
      });
    }
    if (p === '/api/movie-source' && req.method === 'POST') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'Admin only' });
      const body = JSON.parse(await readBody(req));
      const findM = () => (state.movies || []).find(m => m.id === body.id);
      if (!state.movies) state.movies = [];

      if (body.action === 'delete' && body.id) {
        state.movies = state.movies.filter(m => m.id !== body.id);
        saveState(state);
        return json(res, 200, { ok: true });
      }
      if (body.action === 'toggle' && body.id) {
        const m = findM();
        if (m) {
          m.enabled = body.enabled === false ? false : true;
          saveState(state);
          return json(res, 200, { ok: true, enabled: m.enabled !== false });
        }
        return json(res, 404, { ok: false, error: 'Movie not found' });
      }
      if (body.action === 'update' && body.id) {
        const m = findM();
        if (!m) return json(res, 404, { ok: false, error: 'Movie not found' });
        if (body.name !== undefined) m.name = String(body.name).slice(0, 150);
        if (body.group !== undefined) m.group = String(body.group).slice(0, 80);
        if (body.logo !== undefined) m.logo = String(body.logo).slice(0, 500);
        if (body.url !== undefined && String(body.url).trim()) {
          const url = String(body.url).trim();
          if (!/^(https?|ftp):\/\//i.test(url)) return json(res, 400, { ok: false, error: 'URL must start with http://, https:// or ftp://' });
          m.url = url;
        }
        saveState(state);
        return json(res, 200, { ok: true });
      }

      // add new movie
      const name = String(body.name || 'Untitled Movie').slice(0, 150);
      const url = String(body.url || '').trim();
      if (!url) return json(res, 400, { ok: false, error: 'Movie URL required' });
      if (!/^(https?|ftp):\/\//i.test(url)) return json(res, 400, { ok: false, error: 'URL must start with http://, https:// or ftp://' });
      const id = body.id || 'mov-' + Date.now().toString(36);
      const entry = {
        id,
        name,
        group: String(body.group || 'Movies').slice(0, 80),
        logo: String(body.logo || '').slice(0, 500),
        url,
        enabled: true,
      };
      const exists = state.movies.find(m => m.id === id);
      if (exists) Object.assign(exists, entry);
      else state.movies.push(entry);
      saveState(state);
      return json(res, 200, { ok: true, id });
    }

    // ----- API: proxy an HLS/media url -----
    if (p === '/api/stream' && req.method === 'GET') {
      const target = u.searchParams.get('url');
      if (!target || !validHttpUrl(target)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return res.end('bad url');
      }
      // proxy the stream; HLS manifests are detected & rewritten automatically
      return pipeUpstream(res, target).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
        }
        res.end('proxy error: ' + (e.message || e));
      });
    }

    // ----- API: image proxy -----
    if (p === '/api/img' && req.method === 'GET') {
      const target = u.searchParams.get('url');
      if (!target || !validHttpUrl(target)) {
        res.writeHead(404, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      }
      const up = await fetch(target, {
        headers: { 'user-agent': FETCH_UA, accept: 'image/*' },
        redirect: 'follow',
      });
      if (!up.ok || !up.body) {
        res.writeHead(404, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      }
      const ct = up.headers.get('content-type');
      res.writeHead(200, {
        'content-type': ct || 'image/*',
        'cache-control': 'public, max-age=86400',
      });
      const nodeStream = Readable.fromWeb(up.body);
      nodeStream.on('error', () => res.destroy());
      return nodeStream.pipe(res);
    }

    // ----- static files -----
    let rel = p === '/' ? '/index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    // /admin and anything below it -> admin panel page
    if (p === '/admin' || p === '/admin/') rel = 'admin.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>404</title></head>' +
          '<body style="font-family:Segoe UI,Arial;background:#0b1020;color:#e9eefc;display:grid;place-items:center;min-height:100vh;margin:0">' +
          '<div style="text-align:center"><h1 style="font-size:60px;margin:0">404</h1>' +
          '<p style="color:#8b95b0">পেজটা পাওয়া যায়নি (পুরনো ভার্সন চললে Admin পেজ দেখাতে পারে না)</p>' +
          '<a href="/" style="color:#22d3ee;margin-right:14px">📺 ইউজার টিভি</a>' +
          '<a href="/admin" style="color:#22d3ee">🛡️ অ্যাডমিন প্যানেল</a></div></body></html>'
        );
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) {
    if (!res.headersSent) {
      json(res, 500, { ok: false, error: String((e && e.message) || e) });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`  MyTV v${APP_VERSION} running`);
  console.log(`  User TV page : http://localhost:${PORT}/`);
  console.log(`  Admin panel  : http://localhost:${PORT}/admin`);
  console.log(`  Admin password: ${process.env.ADMIN_PASSWORD ? '(set via ADMIN_PASSWORD env)' : 'admin123  <- CHANGE IT after login'}`);
  console.log('  (If /admin shows Not found, you are running an OLD');
  console.log('   version — replace the folder with the new tv-player.zip)');
  console.log('====================================================');
});
