/* MyTV — channel grid + live player
 * Loads /api/channels (M3U parsed server-side), plays HLS via hls.js
 * through the same-origin proxy /api/stream.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const FAV_KEY = 'mytv.favs.v1';

  const state = {
    data: null,            // /api/channels payload
    channels: [],
    query: '',
    category: 'all',
    active: null,          // currently playing channel object
    hls: null,
  };

  /* ---------------- helpers ---------------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function proxied(u) { return '/api/stream?url=' + encodeURIComponent(u); }
  function img(u) { return '/api/img?url=' + encodeURIComponent(u); }

  function getFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; }
  }
  function isFav(id) { return getFavs().includes(id); }
  function toggleFav(id) {
    const f = getFavs();
    const i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch (e) { /* private/strict mode */ }
    rerenderGridOnly();
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }

  function copyText(txt, okMsg) {
    const done = () => toast(okMsg || 'Copied to clipboard ✓');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
    ta.remove();
  }

  /* ---------------- data ---------------- */
  async function loadChannels(silent) {
    if (!silent) setLoading(true);
    try {
      const r = await fetch('/api/channels');
      const data = await r.json();
      state.data = data;
      state.channels = data.channels || [];
      setLoading(false);
      renderNotice();
      renderChips();
      renderGrid();
      renderSourceBadge();
      const live = state.channels.length;
      $('#liveCount').textContent = live;
      return data;
    } catch (e) {
      setLoading(false);
      showNotice('Could not load channel list from the server. Is the server running?', 'error');
    }
  }

  function setLoading(v) {
    $('#reloadBtn').disabled = v;
    if (v) $('#reloadBtn').classList.add('busy');
    else $('#reloadBtn').classList.remove('busy');
  }

  /* ---------------- notices ---------------- */
  function renderNotice() {
    const bar = $('#noticeBar');
    if (!state.data) { bar.classList.add('hidden'); return; }
    const bad = (state.data.sources || []).filter((s) => !s.reachable);
    if (!bad.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.classList.add('error');
    bar.innerHTML =
      '<div style="flex:1;min-width:0">' + bad.map((s) =>
        '<div style="margin-bottom:5px"><b>' + esc(s.name) + ':</b> ' + esc(s.reason || 'unreachable') + '</div>'
      ).join('') + '</div>';
  }

  function showNotice(msg, kind) {
    const bar = $('#noticeBar');
    bar.classList.remove('hidden', 'error', 'ok');
    if (kind) bar.classList.add(kind);
    bar.innerHTML = '<div style="flex:1">' + esc(msg) + '</div>';
  }

  /* ---------------- category chips ---------------- */
  function renderChips() {
    const wrap = $('#catChips');
    const counts = {};
    for (const c of state.channels) counts[c.group] = (counts[c.group] || 0) + 1;
    const groups = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    let html =
      '<button class="chip ' + (state.category === 'all' ? 'active' : '') + '" data-cat="all">All <span class="n">' + state.channels.length + '</span></button>';
    for (const g of groups) {
      html += '<button class="chip ' + (state.category === g ? 'active' : '') + '" data-cat="' + esc(g) + '">' +
        esc(g) + ' <span class="n">' + counts[g] + '</span></button>';
    }
    wrap.innerHTML = html;
    $$('.chip', wrap).forEach((el) =>
      el.addEventListener('click', () => {
        state.category = el.dataset.cat;
        state.query = $('#searchInput').value = '';
        renderChips();
        renderGrid();
      })
    );
  }

  function visibleChannels() {
    let list = state.channels;
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
    }
    if (state.category !== 'all') list = list.filter((c) => c.group === state.category);
    // favorites-first when a real query exists
    if (state.query) {
      const favs = getFavs();
      list = [...list].sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0));
    }
    return list;
  }

  /* ---------------- channel cards ---------------- */
  function initials(name) {
    const parts = (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2);
    let s = parts.map((p) => p[0]).join('');
    if (!s) s = '?';
    return s.toUpperCase().slice(0, 2);
  }

  function cardHTML(c) {
    const fav = isFav(c.id) ? 'on' : '';
    const playable = /^https?:/i.test(c.url || '');
    const isActive = state.active && state.active.id === c.id;
    const logo = c.logo
      ? '<img class="logo-img" src="' + esc(img(c.logo)) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'" alt=""/><div class="logo-fallback" style="display:none">' + esc(initials(c.name)) + '</div>'
      : '<div class="logo-fallback">' + esc(initials(c.name)) + '</div>';
    const manySources = (state.data && state.data.sources.filter((s) => s.reachable).length > 1) || (state.channels.some((ch) => ch.sourceId !== c.sourceId));
    const srcBadge = (state.data && state.data.sources.length > 1 && manySources)
      ? '<span class="badge-source" title="Playlist source">' + esc(c.sourceId === 'etud-sky' ? 'Etud' : c.sourceId === 'demo' ? 'Demo' : c.sourceId.slice(0, 10)) + '</span>'
      : '';
    return (
      '<div class="card ' + (isActive ? 'active' : '') + '" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' +
        '<div class="card-art">' +
          srcBadge + logo +
          '<div class="play-hover"><span class="pbtn"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="#fff" d="M8 5v14l11-7z"/></svg></span></div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-name" title="' + esc(c.name) + '">' + esc(c.name) + '</div>' +
          '<div class="card-meta">' +
            '<span class="card-group">' + esc(c.group) + '</span>' +
            '<button class="fav ' + fav + '" data-fav="1" data-id="' + esc(c.id) + '" title="Favourite">' + (fav ? '★' : '☆') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function rerenderGridOnly() {
    const grid = $('#channelGrid');
    const els = grid.children;
    for (const el of els) {
      const id = el.dataset.id;
      const c = state.channels.find((x) => x.id === id);
      if (!c) continue;
      const favBtn = el.querySelector('.fav');
      if (favBtn) {
        const on = isFav(id);
        favBtn.classList.toggle('on', on);
        favBtn.textContent = on ? '★' : '☆';
      }
    }
  }

  function renderGrid() {
    const grid = $('#channelGrid');
    const empty = $('#emptyState');
    const list = visibleChannels();

    const favMode = state.query && state.category === 'all';
    let shown = favMode
      ? [...list.filter((c) => isFav(c.id)), ...list.filter((c) => !isFav(c.id))]
      : list;

    if (!state.query && state.category === 'all' && getFavs().length > 0) {
      shown = [...list.filter((c) => isFav(c.id)), ...list.filter((c) => !isFav(c.id))];
    }

    empty.classList.toggle('hidden', shown.length > 0);
    grid.innerHTML = shown.map(cardHTML).join('');

    $('#gridCount').textContent = shown.length + ' of ' + state.channels.length;
    $('#gridHeading').textContent = state.query
      ? 'Results for “' + state.query + '”'
      : state.category === 'all'
        ? (getFavs().length ? '⭐ Favourites first · All channels' : 'All channels')
        : state.category;

    // bind events
    $$('.card', grid).forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.fav')) return;
        const c = state.channels.find((x) => x.id === el.dataset.id);
        if (c) playChannel(c);
      });
    });
    $$('.fav', grid).forEach((el) =>
      el.addEventListener('click', () => toggleFav(el.dataset.id))
    );
  }

  /* ---------------- player ---------------- */
  function kindOf(c) {
    const u = (c.url || '').toLowerCase();
    const m = /^([a-z][a-z0-9+.-]*):/.exec(c.url || '');
    const scheme = m ? m[1] : '';
    if (scheme && !/^https?$/.test(scheme)) return { type: 'external', scheme };
    if (u.includes('.m3u8') || u.includes('mpegurl')) return { type: 'hls' };
    if (/\.(mp4|m4v|webm|ogv|ogg|mov|mkv)(\?|$)/.test(u)) return { type: 'direct' };
    if (/\.(ts|m2ts|mts|mp2t|aac)(\?|$)/.test(u)) return { type: 'rawts' };
    return { type: 'hls' }; // best guess; error UI will guide
  }

  async function playChannel(c) {
    stopPlayback();
    state.active = c;

    const shell = $('#playerShell');
    shell.classList.remove('hidden');
    const kind = kindOf(c);
    $('#playerTitle').textContent = c.name;
    $('#playerGroup').textContent = c.group || '';
    $('#playerSource').textContent = 'Playlist: ' + c.source;
    renderGrid();

    const video = $('#tvVideo');
    const stateBox = $('#videoState');
    const notBox = $('#notPlayableBox');

    if (kind.type === 'external' || kind.type === 'rawts') {
      // Show guidance instead of trying an unplayable stream
      const why =
        kind.type === 'external'
          ? 'This channel uses the <b>' + esc(kind.scheme) + '://</b> protocol, which browsers cannot play.'
          : 'This channel is a raw MPEG-TS link, which browsers cannot play directly.';
      stateBox.innerHTML = '';
      stateBox.classList.remove('hidden');
      stateBox.innerHTML =
        '<div style="text-align:center;max-width:460px;padding:0 16px">' +
        '<div style="font-size:42px;margin-bottom:8px">📺</div>' +
        '<p style="color:#dfe6fb;font-weight:700;margin-bottom:6px">Cannot preview this stream type</p>' +
        '<p style="font-size:13px;line-height:1.6">' + why +
        '<br>Use it in <b>VLC</b>, <b>TiviMate</b>, <b>IPTV Smarters</b> or another IPTV player.</p></div>';
      notBox.innerHTML =
        '<button class="btn primary sm" id="extCopyBtn">Copy stream URL</button>' +
        '<a class="btn ghost sm" href="vlc://' + esc(c.url) + '">Open in VLC</a>';
      $('#extCopyBtn').onclick = () => copyText(c.url, 'Stream URL copied ✓');
      shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // normal web-playable path
    notBox.innerHTML = '';
    stateBox.classList.remove('hidden');
    $('#videoStateText').textContent = 'Connecting to live stream…';

    const src = proxied(c.url);
    const tryNative = () => {
      video.src = src;
      video.load();
    };

    if (kind.type === 'hls' && window.Hls && window.Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 40,
        liveSyncDurationCount: 5,
        fragLoadingMaxRetry: 5,
        manifestLoadingMaxRetry: 3,
        capLevelToPlayerSize: true,
      });
      state.hls = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          showVideoError('Stream URL is not reachable (network error).');
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad(); // transient
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          showVideoError('The stream could not be played in the browser.');
        }
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data && data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          // already handled above
        }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      tryNative();
      video.addEventListener('error', () => showVideoError('The stream could not be played in the browser.'), { once: true });
    }

    video.addEventListener('playing', () => {
      stateBox.classList.add('hidden');
      Heart.start(); // count this viewer as live-watching
    });

    shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const started = video.play();
    if (started) started.catch(() => {/* user will press play */});
  }

  function showVideoError(msg) {
    const stateBox = $('#videoState');
    const video = $('#tvVideo');
    stateBox.innerHTML =
      '<div style="text-align:center;max-width:460px;padding:0 16px">' +
      '<div style="font-size:40px;margin-bottom:8px">⚠️</div>' +
      '<p style="color:#ffd3e5;font-weight:700;margin-bottom:4px">Playback failed</p>' +
      '<p style="font-size:13px">' + esc(msg) + '</p>' +
      '<button class="btn primary sm" id="retryBtn" style="margin-top:12px">Try again</button>' +
      '<button class="btn ghost sm" id="errCopyBtn" style="margin-top:12px;margin-left:6px">Copy URL</button>' +
      '</div>';
    stateBox.classList.remove('hidden');
    video.pause();
    const retry = $('#retryBtn');
    if (retry) retry.onclick = () => { if (state.active) playChannel(state.active); };
    const cp = $('#errCopyBtn');
    if (cp) cp.onclick = () => state.active && copyText(state.active.url, 'Stream URL copied ✓');
  }

  function stopPlayback() {
    Heart.stop();
    if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
    const video = $('#tvVideo');
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  /* ---------------- viewer presence (for the admin live counter) ----------------
   * While a channel is actually playing, this browser tells the server “I’m
   * watching channel X” every 15 s. The admin dashboard counts those viewers.
   * Viewers never see or touch any settings.
   */
  const Heart = (function () {
    let vid = '';
    try {
      vid = localStorage.getItem('mytv.viewer') || '';
      if (!vid) {
        vid = 'v-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
        localStorage.setItem('mytv.viewer', vid);
      }
    } catch (e) { vid = 'v-' + Date.now(); }

    let timer = null;
    function report(playing) {
      const ch = state.active;
      const body = JSON.stringify({
        viewerId: vid,
        playing: !!playing && !!ch,
        channelId: ch ? ch.id : '',
        name: ch ? ch.name : '',
        source: ch ? ch.source : '',
        t: Date.now(),
      });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/heartbeat', new Blob([body], { type: 'application/json' }));
        else fetch('/api/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
      } catch (e) {}
    }
    return {
      start() { report(true); if (!timer) timer = setInterval(() => report(true), 15000); },
      stop() { if (timer) { clearInterval(timer); timer = null; } report(false); },
    };
  })();

  /* ---------------- UI wiring ---------------- */
  function bind() {
    $('#searchInput').addEventListener('input', (e) => {
      state.query = e.target.value.trim();
      renderChips();
      renderGrid();
      $('#clearSearch').classList.toggle('hidden', !state.query);
    });
    $('#clearSearch').addEventListener('click', () => {
      $('#searchInput').value = '';
      state.query = '';
      $('#clearSearch').classList.add('hidden');
      renderChips();
      renderGrid();
      $('#searchInput').focus();
    });
    $('#reloadBtn').addEventListener('click', () => loadChannels(true));

    $('#closePlayerBtn').addEventListener('click', () => {
      stopPlayback();
      state.active = null;
      $('#playerShell').classList.add('hidden');
      renderGrid();
    });
    $('#cinemaBtn').addEventListener('click', toggleCinema);
    const vw = $('#videoWrap');
    vw.addEventListener('dblclick', toggleCinema);
    $('#copyUrlBtn').addEventListener('click', () => {
      if (state.active) copyText(state.active.url, 'Stream URL copied ✓');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        $('#searchInput').focus();
      }
    });
  }

  function toggleCinema() {
    const vw = $('#videoWrap');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (vw.requestFullscreen) vw.requestFullscreen().catch(() => toast('Fullscreen not allowed'));
    else toast('Fullscreen not supported here');
  }

  function renderSourceBadge() {}

  /* ---------------- boot ---------------- */
  bind();
  window.addEventListener('pagehide', () => Heart.stop());
  loadChannels();
  window.App = { goHome: () => { $('#searchInput').value=''; state.query=''; state.category='all'; renderChips(); renderGrid(); window.scrollTo({top:0,behavior:'smooth'}); } };
})();
