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

const APP_VERSION = '2.0'; // admin panel + live viewer counter release

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
const DEMO_RAW = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="nasa" tvg-logo="' + LOGO('nasa.gov') + '" group-title="Space & Science",NASA TV',
  'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
  '#EXTINF:-1 tvg-id="dw" tvg-logo="' + LOGO('dw.com') + '" group-title="News",DW News English',
  'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
  '#EXTINF:-1 tvg-id="bloomberg" tvg-logo="' + LOGO('bloomberg.com') + '" group-title="Business",Bloomberg Television',
  'https://www.bloomberg.com/media-manifest/streams/us.m3u8',
  '#EXTINF:-1 tvg-id="redbull" tvg-logo="' + LOGO('redbull.com') + '" group-title="Sports & Adventure",Red Bull TV',
  'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
  '#EXTINF:-1 tvg-id="akamai" tvg-logo="' + LOGO('akamai.com') + '" group-title="Tech & Test",Akamai Live Test',
  'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  '',
].join('\n');

function defaultState() {
  const sources = [];
  // skym3u "etud" playlists are ad-protected (link-locker): they only serve the
  // playlist to the exact browser session that completed the ads, so a server
  // can never fetch them. We keep the demo + large public lists instead.
  sources.push({
    id: 'bd',
    name: 'Public TV — Bangladesh (iptv-org, 41+)',
    type: 'url',
    url: IPTV_ORG_BD,
  });
  sources.push({
    id: 'in',
    name: 'Public TV — India (iptv-org, 700+)',
    type: 'url',
    url: IPTV_ORG_IN,
  });
  sources.push({
    id: 'demo',
    name: 'Free official demo channels',
    type: 'raw',
    raw: DEMO_RAW,
  });
  applyEnvSources(sources);
  return { sources, updated: Date.now() };
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
// ---------------------------------------------------------------------------
let config = null;
function hashPw(pw) {
  return crypto.createHash('sha256').update('mytv::' + pw).digest('hex');
}
function loadConfig() {
  const fallback = { adminPassHash: hashPw(process.env.ADMIN_PASSWORD || 'admin123'), createdAt: Date.now() };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(fallback, null, 2));
      config = fallback;
      return config;
    }
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!config.adminPassHash) config.adminPassHash = fallback.adminPassHash;
    return config;
  } catch (e) {
    config = fallback;
    return config;
  }
}
function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    /* ignore */
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
      // the built-in demo list always comes from code so we can improve it anytime
      text = src.id === 'demo' ? DEMO_RAW : src.raw || '';
    } else {
      const cached = cache.get(src.url);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        return { ok: true, channels: cached.channels, name: src.name, id: src.id };
      }
      const fetched = await fetchText(src.url);
      text = fetched.text;

      const head = text.slice(0, 400).toLowerCase();
      const looksHtml =
        head.includes('<!doctype') ||
        head.includes('<html') ||
        head.includes('<!DOCTYPE') ||
        (fetched.status === 403 && !head.startsWith('#extm3u')) ||
        head.includes('ad-blocker') ||
        head.includes('ublock') ||
        head.includes('link-locker') ||
        (fetched.status === 200 && !head.startsWith('#extm3u') && !head.includes('#extinf'));

      if (looksHtml) {
        let reason = 'Ad-protected page returned instead of a playlist (link-locker).';
        if (head.includes('ad-blocker') || head.includes('ublock')) {
          reason =
            'The playlist provider shows an “disable ad-blocker” page. It must be unlocked in a real browser first.';
        } else if (fetched.status === 403) {
          reason =
            'The provider returned HTTP 403 / an anti-scraping page — the link is protected for browser use only.';
        }
        return { ok: false, id: src.id, name: src.name, reason, status: fetched.status };
      }

      if (!head.startsWith('#extm3u') && !head.includes('#extinf')) {
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
  const up = await fetch(target, {
    headers: {
      'user-agent': FETCH_UA,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: ctrl.signal,
  });
  clearTimeout(t);

  if (up.status >= 400 && up.status !== 416) {
    res.writeHead(up.status, { 'content-type': 'text/plain' });
    res.end('Upstream error ' + up.status);
    return;
  }

  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  };
  const ct = up.headers.get('content-type');

  // If the upstream response is an HLS manifest, rewrite every absolute URL
  // inside it so segments & keys flow through our same-origin proxy too.
  if (up.body && looksLikeManifest(ct, target)) {
    const text = await up.text();
    const rewritten = rewriteManifest(target, text);
    headers['content-type'] = 'application/vnd.apple.mpegurl';
    headers['cache-control'] = 'no-store';
    res.writeHead(up.status, headers);
    res.end(rewritten, 'utf8');
    return;
  }

  if (ct) headers['content-type'] = ct;
  if (up.status === 206) headers['content-range'] = up.headers.get('content-range');

  res.writeHead(up.status, headers);
  if (up.body) {
    const nodeStream = Readable.fromWeb(up.body);
    // if the viewer stops / switches channel, free the upstream connection too
    res.on('close', () => nodeStream.destroy());
    nodeStream.on('error', () => res.destroy());
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
      return json(res, 200, {
        ok: true,
        admin: isAdmin(req),
        defaultPassword: process.env.ADMIN_PASSWORD ? false : hashPw('admin123') === config.adminPassHash,
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
      saveConfig();
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
        state.sources = state.sources.filter((s) => s.id !== body.id);
        saveState(state);
        return json(res, 200, { ok: true });
      }
      if (body.action === 'toggle' && body.id) {
        const s = find();
        if (s) {
          s.enabled = body.enabled === false ? false : true;
          saveState(state);
          return json(res, 200, { ok: true, enabled: s.enabled !== false });
        }
        return json(res, 404, { ok: false, error: 'Source not found' });
      }
      if (body.action === 'update' && body.id) {
        const s = find();
        if (!s) return json(res, 404, { ok: false, error: 'Source not found' });
        if (body.name !== undefined) s.name = String(body.name).slice(0, 120);
        if (body.url !== undefined && String(body.url).trim()) {
          const url = String(body.url).trim();
          if (!/^https?:\/\//i.test(url)) return json(res, 400, { ok: false, error: 'URL must start with http:// or https://' });
          if (s.id !== 'demo') s.url = url;
        }
        if (body.raw !== undefined && s.id !== 'demo') s.raw = String(body.raw);
        saveState(state);
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
        return json(res, 200, { ok: true, id });
      }
      if (body.url !== undefined && String(body.url).trim()) {
        const url = String(body.url).trim();
        if (!/^https?:\/\//i.test(url)) {
          return json(res, 400, { ok: false, error: 'URL must start with http:// or https://' });
        }
        const id = body.id || 'src-' + Date.now().toString(36);
        const entry = { id, name, type: 'url', url, enabled: true };
        // quick reachability probe
        const probe = await resolveSource(entry).catch(() => null);
        const exists = state.sources.find((s) => s.id === id);
        if (exists) Object.assign(exists, entry);
        else state.sources.push(entry);
        saveState(state);
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
