/* MyTV v5.0 — Unique Aurora, Instant Play, FTP Functional, Small-Medium Icons */
(function(){
  'use strict';
  const $ = s => document.querySelector(s);
  const FAV_KEY = 'mytv.favs.v5';

  const state = {
    data: null,
    all: [],
    filtered: [],
    movies: [],
    filteredMovies: [],
    active: null,
    activeType: 'tv',
    hls: null,
    category: 'all',
    movieCategory: 'all',
    query: '',
    mainTab: 'tv',
    ftpFilter: 'all', // all | live | ftp | http
  };

  const CAT_MAP = [
    { id: 'all', label: 'সব', match: () => true },
    { id: 'bangladesh', label: '🇧🇩 BD', match: c => /bangladesh|bangla|bd|atn|ntv|rtv|somoy|jamuna|channel|ekushey|dbc|maasranga|gazi|boishakhi|my tv|deepto|t sports/i.test((c.name+' '+c.group+' '+c.source).toLowerCase()) || c.sourceId==='verified' },
    { id: 'news', label: '📰 খবর', match: c => /news|খবর|dbc|somoy|jamuna|ekattor/i.test((c.group+' '+c.name).toLowerCase()) },
    { id: 'sports', label: '⚽ খেলা', match: c => /sport|tsports|gazi|gtv|cricket|football/i.test((c.group+' '+c.name).toLowerCase()) },
    { id: 'entertainment', label: '🎬 বিনোদন', match: c => /entertainment|general|movie|drama|vision|boishakhi/i.test((c.group).toLowerCase()) },
    { id: 'kids', label: '👶 কিডস', match: c => /kids|cartoon|duronto/i.test((c.group+' '+c.name).toLowerCase()) },
  ];

  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  const proxied = u => '/api/stream?url='+encodeURIComponent(u);
  const ftpProxied = u => '/api/ftp-stream?url='+encodeURIComponent(u);
  const imgProxy = u => '/api/img?url='+encodeURIComponent(u);

  function favs(){ try{return JSON.parse(localStorage.getItem(FAV_KEY))||[];}catch(e){return [];} }
  function isFav(id){return favs().includes(id);}
  function toggleFav(id){
    let f=favs(); const i=f.indexOf(id);
    if(i>=0) f.splice(i,1); else f.unshift(id);
    try{localStorage.setItem(FAV_KEY,JSON.stringify(f.slice(0,200)));}catch(e){}
    renderGrid(); renderMovieGrid();
  }

  function toast(msg, ms){
    const t=$('#toast'); if(!t) return;
    t.textContent=msg; t.classList.remove('hidden');
    clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.add('hidden'), ms||3000);
  }

  async function loadChannels(){
    try{
      const r=await fetch('/api/channels',{cache:'no-store'});
      const data=await r.json();
      state.data=data;
      const all = (data.channels||[]).slice();
      all.sort((a,b)=>{
        if(a.verified && !b.verified) return -1;
        if(!a.verified && b.verified) return 1;
        const af=isFav(a.id), bf=isFav(b.id);
        if(af && !bf) return -1;
        if(!af && bf) return 1;
        return a.name.localeCompare(b.name);
      });
      state.all=all;
      applyFilter();
      renderChips();
      renderGrid();
      const lc=$('#liveCount'); if(lc) lc.textContent=all.length;
    }catch(e){
      const bar=$('#noticeBar'); if(bar){ bar.textContent='চ্যানেল লোড হয়নি - refresh করুন'; bar.classList.remove('hidden'); }
    }
  }

  async function loadMovies(){
    try{
      const r=await fetch('/api/movies',{cache:'no-store'});
      const data=await r.json();
      state.movies = data.movies||[];
      applyMovieFilter();
      renderMovieChips();
      renderMovieGrid();
      const mc=$('#movieCount'); if(mc) mc.textContent=state.movies.length;
    }catch(e){ state.movies=[]; renderMovieGrid(); }
  }

  function matchFtpFilter(item){
    if(state.ftpFilter==='all') return true;
    const sc=(item.scheme||'').toLowerCase();
    const url=(item.url||'').toLowerCase();
    const isFtp = sc==='ftp' || sc==='ftps' || url.startsWith('ftp://');
    const isLive = sc==='http' || sc==='https' || url.includes('.m3u8');
    if(state.ftpFilter==='ftp') return isFtp;
    if(state.ftpFilter==='http') return !isFtp;
    if(state.ftpFilter==='live') return isLive || !isFtp;
    return true;
  }

  function applyFilter(){
    let list=state.all;
    const q=state.query.toLowerCase().trim();
    if(q) list=list.filter(c=> (c.name||'').toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q));
    if(state.category!=='all'){
      const cat=CAT_MAP.find(c=>c.id===state.category);
      if(cat) list=list.filter(cat.match);
    }
    list=list.filter(matchFtpFilter);
    state.filtered=list;
  }

  function applyMovieFilter(){
    let list=state.movies;
    const q=state.query.toLowerCase().trim();
    if(q) list=list.filter(m=> (m.name||'').toLowerCase().includes(q) || (m.group||'').toLowerCase().includes(q));
    if(state.movieCategory!=='all'){
      const qc=state.movieCategory.toLowerCase();
      list=list.filter(m=> (m.group||'').toLowerCase().includes(qc));
    }
    list=list.filter(matchFtpFilter);
    state.filteredMovies=list;
  }

  function renderChips(){
    const wrap=$('#catChips'); if(!wrap) return;
    if(state.mainTab!=='tv') return;
    const counts={};
    for(const cat of CAT_MAP) counts[cat.id]= state.all.filter(cat.match).filter(matchFtpFilter).length;
    wrap.innerHTML=CAT_MAP.map(cat=>{
      const active=state.category===cat.id?'active':'';
      const n=counts[cat.id]||0;
      return `<button class="chip ${active}" data-cat="${cat.id}">${cat.label} <span class="n">${n}</span></button>`;
    }).join('');
    wrap.querySelectorAll('.chip').forEach(el=>{
      el.addEventListener('click',()=>{
        state.category=el.dataset.cat;
        applyFilter(); renderChips(); renderGrid();
      });
    });
  }

  function renderMovieChips(){
    const wrap=$('#catChips'); if(!wrap) return;
    if(state.mainTab!=='movies') return;
    const groups={};
    for(const m of state.movies) if(matchFtpFilter(m)) groups[m.group||'Movies']=(groups[m.group||'Movies']||0)+1;
    const cats=['all', ...Object.keys(groups).sort()];
    wrap.innerHTML=cats.map(g=>{
      const id=g==='all'?'all':g;
      const label=g==='all'?'সব মুভি':g;
      const active=state.movieCategory===id?'active':'';
      const n=g==='all'?state.movies.filter(matchFtpFilter).length:(groups[g]||0);
      return `<button class="chip ${active}" data-mcat="${esc(id)}">${esc(label)} <span class="n">${n}</span></button>`;
    }).join('');
    wrap.querySelectorAll('.chip').forEach(el=>{
      el.addEventListener('click',()=>{
        state.movieCategory=el.dataset.mcat;
        applyMovieFilter(); renderMovieChips(); renderMovieGrid();
      });
    });
  }

  function initials(name){
    const p=(name||'?').replace(/[^\p{L}\p{N} ]/gu,'').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('');
    return (p||'?').toUpperCase().slice(0,2);
  }

  function cardHTML(c){
    const fav=isFav(c.id)?'on':'';
    const active=state.active && state.active.id===c.id && state.activeType==='tv'?'active':'';
    const isFtp = (c.scheme==='ftp' || c.url.startsWith('ftp://'));
    const schemeBadge = isFtp ? `<span class="scheme-badge">FTP</span>` : `<span class="scheme-badge http">LIVE</span>`;
    const logo=c.logo?`<img class="logo-img" src="${esc(imgProxy(c.logo))}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" alt=""><div class="logo-fallback" style="display:none">${esc(initials(c.name))}</div>`:`<div class="logo-fallback">${esc(initials(c.name))}</div>`;
    const verified=c.verified?`<div class="verified-dot" title="Verified">✓</div>`:'';
    return `<div class="card ${active}" data-id="${esc(c.id)}"><div class="card-art">${logo}<div class="play-badge"><span>▶</span></div>${schemeBadge}${verified}</div><div class="card-body"><div class="card-name" title="${esc(c.name)}">${esc(c.name)}</div><div class="card-meta"><span class="card-group">${esc(c.group||'Live')}</span><button class="fav-btn ${fav}" data-fav="${esc(c.id)}">${fav?'★':'☆'}</button></div></div></div>`;
  }

  function movieCardHTML(m){
    const fav=isFav(m.id)?'on':'';
    const active=state.active && state.active.id===m.id && state.activeType==='movie'?'active':'';
    const isFtp = m.scheme==='ftp' || m.url.startsWith('ftp://');
    const poster=m.logo?`<img class="logo-img" src="${esc(imgProxy(m.logo))}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" alt="" style="object-fit:cover;padding:0"><div class="logo-fallback" style="display:none">${esc(initials(m.name))}</div>`:`<div class="logo-fallback" style="font-size:28px">🎬</div>`;
    const badge = isFtp ? `<span class="scheme-badge">FTP</span>` : `<span class="scheme-badge http">HD</span>`;
    return `<div class="card ${active}" data-mid="${esc(m.id)}"><div class="card-art">${poster}<div class="play-badge"><span>▶</span></div>${badge}</div><div class="card-body"><div class="card-name" title="${esc(m.name)}">${esc(m.name)}</div><div class="card-meta"><span class="card-group">${esc(m.group||'Movies')}</span><button class="fav-btn ${fav}" data-fav="${esc(m.id)}">${fav?'★':'☆'}</button></div></div></div>`;
  }

  function renderGrid(){
    const grid=$('#channelGrid'); const empty=$('#emptyState');
    const gc=$('#gridCount'); const gh=$('#gridHeading');
    if(!grid) return;
    if(state.mainTab!=='tv') return;
    const list=state.filtered;
    if(gc) gc.textContent=list.length;
    if(gh){
      if(state.query) gh.textContent=`"${state.query}" — ${list.length}টি`;
      else if(state.ftpFilter==='ftp') gh.textContent=`📁 FTP — ${list.length}টি`;
      else if(state.ftpFilter==='live') gh.textContent=`⚡ Live — ${list.length}টি`;
      else {
        const cat=CAT_MAP.find(c=>c.id===state.category);
        gh.textContent=cat && state.category!=='all' ? `${cat.label} — ${list.length}টি` : `⚡ Instant — ${list.length}টি চ্যানেল`;
      }
    }
    if(!list.length){ grid.innerHTML=''; if(empty) empty.classList.remove('hidden'); return; }
    if(empty) empty.classList.add('hidden');
    grid.innerHTML=list.map(cardHTML).join('');
    grid.querySelectorAll('.card').forEach(el=>{
      el.addEventListener('click',e=>{
        if(e.target.closest('.fav-btn')) return;
        const c=state.all.find(x=>x.id===el.dataset.id);
        if(c) playChannel(c);
      });
    });
    grid.querySelectorAll('.fav-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{ e.stopPropagation(); toggleFav(btn.dataset.fav); });
    });
  }

  function renderMovieGrid(){
    const grid=$('#movieGrid'); const empty=$('#movieEmpty');
    const gc=$('#movieGridCount'); const gh=$('#movieHeading');
    if(!grid) return;
    if(state.mainTab!=='movies') return;
    const list=state.filteredMovies;
    if(gc) gc.textContent=list.length;
    if(gh){
      if(state.query) gh.textContent=`"${state.query}" — ${list.length}টি মুভি`;
      else if(state.ftpFilter==='ftp') gh.textContent=`📁 FTP Movies — ${list.length}টি (Functional)`;
      else if(state.movieCategory==='all') gh.textContent=`🎬 FTP Movies — ${list.length}টি`;
      else gh.textContent=`${state.movieCategory} — ${list.length}টি`;
    }
    if(!list.length){ grid.innerHTML=''; if(empty) empty.classList.remove('hidden'); return; }
    if(empty) empty.classList.add('hidden');
    grid.innerHTML=list.map(movieCardHTML).join('');
    grid.querySelectorAll('.card').forEach(el=>{
      el.addEventListener('click',e=>{
        if(e.target.closest('.fav-btn')) return;
        const m=state.movies.find(x=>x.id===el.dataset.mid);
        if(m) playMovie(m);
      });
    });
    grid.querySelectorAll('.fav-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{ e.stopPropagation(); toggleFav(btn.dataset.fav); });
    });
  }

  function playerEls(){
    return {
      wrap: $('#playerWrap'),
      video: $('#tvVideo'),
      loading: $('#vLoading'),
      loadTitle: $('#vLoadingTitle'),
      loadSub: $('#vLoadingSub'),
      err: $('#vError'),
      errSub: $('#vErrorSub'),
      title: $('#playerTitle'),
      group: $('#playerGroup'),
      badge: $('#playerBadge'),
    };
  }

  function showLoading(name, sub){
    const {wrap, loading, loadTitle, loadSub, err}=playerEls();
    if(wrap) wrap.classList.remove('hidden');
    if(loading) loading.classList.remove('hidden');
    if(err) err.classList.add('hidden');
    if(loadTitle) loadTitle.textContent=name||'চালু হচ্ছে...';
    if(loadSub) loadSub.textContent=sub||'⚡ Instant';
  }
  function hideLoading(){ const {loading}=playerEls(); if(loading) loading.classList.add('hidden'); }

  function stopPlayback(){
    Heart.stop();
    const {video}=playerEls();
    if(state.hls){ try{state.hls.destroy();}catch(e){} state.hls=null; }
    if(video){ try{ video.pause(); video.removeAttribute('src'); video.load(); }catch(e){} }
  }

  // Instant play - no lag, low latency HLS
  async function playChannel(c){
    stopPlayback();
    state.active=c; state.activeType='tv';
    const {wrap, video, title, group, badge}=playerEls();
    if(!wrap || !video) return;
    wrap.classList.remove('hidden');
    if(title) title.textContent=c.name;
    if(group) group.textContent=c.group||'Live';
    if(badge) badge.innerHTML='<span class="pulse"></span> LIVE';
    renderGrid();
    if(window.innerWidth<768) wrap.scrollIntoView({behavior:'smooth', block:'start'});

    const isFtp = c.scheme==='ftp' || c.url.startsWith('ftp://');
    const src = isFtp ? ftpProxied(c.url) : proxied(c.url);

    // instant - don't show loading spinner long, try to play immediately
    showLoading(c.name,'⚡');
    let played=false;
    const onPlaying=()=>{ if(played) return; played=true; hideLoading(); Heart.start(); };
    const onError=()=>{
      if(played) return;
      toast(`⚠️ ${c.name} offline`,2000);
      hideLoading();
    };
    video.addEventListener('playing', onPlaying, {once:true});
    video.addEventListener('error', onError, {once:true});

    try{
      if(c.url.includes('.m3u8') && window.Hls && window.Hls.isSupported()){
        const hls=new Hls({
          enableWorker:true,
          lowLatencyMode:true,
          backBufferLength:20,
          maxBufferLength:15,
          maxMaxBufferLength:30,
          liveSyncDuration:2,
          liveMaxLatencyDuration:6,
          fragLoadingMaxRetry:2,
          manifestLoadingMaxRetry:2,
          levelLoadingMaxRetry:2,
        });
        state.hls=hls;
        hls.on(Hls.Events.MANIFEST_PARSED, ()=>{
          video.play().catch(()=>{ hideLoading(); });
        });
        hls.on(Hls.Events.ERROR, (e,data)=>{
          if(!data || !data.fatal) return;
          if(data.type===Hls.ErrorTypes.NETWORK_ERROR){ try{hls.startLoad();}catch(e){} }
          else if(data.type===Hls.ErrorTypes.MEDIA_ERROR){ try{hls.recoverMediaError();}catch(e){ onError(); } }
          else onError();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      }else{
        video.src=src;
        video.load();
        video.play().then(()=>{ hideLoading(); }).catch(()=>{ hideLoading(); });
      }
    }catch(e){ onError(); }
    // hide loading quickly even if not playing yet - instant feel
    setTimeout(()=>{ if(!played) hideLoading(); }, 600);
  }

  async function playMovie(m){
    stopPlayback();
    state.active=m; state.activeType='movie';
    const {wrap, video, title, group, badge}=playerEls();
    if(!wrap || !video) return;
    wrap.classList.remove('hidden');
    if(title) title.textContent=m.name;
    if(group) group.textContent=m.group||'Movies';
    if(badge) badge.innerHTML='🎬 MOVIE';
    renderMovieGrid();
    if(window.innerWidth<768) wrap.scrollIntoView({behavior:'smooth', block:'start'});

    const url=m.url||'';
    const isFtp = url.startsWith('ftp://') || (m.scheme==='ftp');
    const src = isFtp ? ftpProxied(url) : ( /^https?:\/\//i.test(url) ? proxied(url) : url );

    showLoading(m.name, isFtp ? '📁 FTP → HTTP proxy' : '🎬 Loading');
    let played=false;
    const onPlaying=()=>{ if(played) return; played=true; hideLoading(); };
    const onError=()=>{ if(played) return; toast('মুভি চালানো যায়নি', 2500); hideLoading(); };

    video.addEventListener('playing', onPlaying, {once:true});
    video.addEventListener('error', onError, {once:true});

    try{
      if(url.includes('.m3u8') && window.Hls && window.Hls.isSupported()){
        const hls=new Hls({enableWorker:true, lowLatencyMode:true});
        state.hls=hls;
        hls.on(Hls.Events.MANIFEST_PARSED, ()=>{ video.play().catch(()=>{}); });
        hls.on(Hls.Events.ERROR, (e,d)=>{ if(d && d.fatal) onError(); });
        hls.loadSource(src);
        hls.attachMedia(video);
      }else{
        video.src=src;
        video.load();
        video.play().then(()=>hideLoading()).catch(()=>hideLoading());
      }
    }catch(e){ onError(); }
    setTimeout(()=>{ if(!played) hideLoading(); }, 800);
  }

  const Heart=(function(){
    let vid=''; try{ vid=localStorage.getItem('mytv.viewer')||''; if(!vid){ vid='v-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)); localStorage.setItem('mytv.viewer',vid);} }catch(e){vid='v-'+Date.now();}
    let t=null;
    function report(play){
      const ch=state.active;
      const body=JSON.stringify({viewerId:vid, playing:!!play && !!ch, channelId:ch?ch.id:'', name:ch?ch.name:'', source:ch?ch.source:'', t:Date.now()});
      try{ if(navigator.sendBeacon) navigator.sendBeacon('/api/heartbeat', new Blob([body],{type:'application/json'})); else fetch('/api/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body}).catch(()=>{});}catch(e){}
    }
    return {start(){report(true); if(!t) t=setInterval(()=>report(true),15000);}, stop(){ if(t){clearInterval(t); t=null;} report(false);} };
  })();

  function bind(){
    const si=$('#searchInput'); const cs=$('#clearSearch');
    if(si){
      si.addEventListener('input',e=>{
        state.query=e.target.value.trim();
        if(cs) cs.classList.toggle('hidden', !state.query);
        if(state.mainTab==='tv'){ applyFilter(); renderChips(); renderGrid(); }
        else { applyMovieFilter(); renderMovieChips(); renderMovieGrid(); }
      });
    }
    if(cs){
      cs.addEventListener('click',()=>{
        if(si) si.value=''; state.query=''; cs.classList.add('hidden');
        if(state.mainTab==='tv'){ applyFilter(); renderChips(); renderGrid(); } else { applyMovieFilter(); renderMovieChips(); renderMovieGrid(); }
        if(si) si.focus();
      });
    }
    // FTP filter beside search bar - functional
    document.querySelectorAll('.fbtn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.ftpFilter=btn.dataset.ftp;
        if(state.mainTab==='tv'){ applyFilter(); renderChips(); renderGrid(); }
        else { applyMovieFilter(); renderMovieChips(); renderMovieGrid(); }
        toast(btn.dataset.ftp==='ftp' ? '📁 FTP filter active - FTP now functional' : btn.dataset.ftp==='live' ? '⚡ Live only' : 'All showing', 2000);
      });
    });

    const close=$('#closePlayerBtn');
    if(close) close.addEventListener('click',()=>{
      stopPlayback(); state.active=null;
      const w=$('#playerWrap'); if(w) w.classList.add('hidden');
      renderGrid(); renderMovieGrid();
    });
    const share=$('#shareBtn');
    if(share) share.addEventListener('click',()=>{
      if(!state.active) return;
      const url=location.origin+'/?play='+encodeURIComponent(state.active.id)+'&type='+state.activeType;
      if(navigator.share){ navigator.share({title:state.active.name, url}).catch(()=>{}); }
      else { navigator.clipboard.writeText(url).then(()=>toast('লিংক কপি ✓')); }
    });
    const ftpBtn=$('#ftpActionBtn');
    if(ftpBtn) ftpBtn.addEventListener('click',()=>{
      if(!state.active) return;
      const url=state.active.url||'';
      navigator.clipboard.writeText(url).then(()=>toast('📁 FTP URL copied: '+url.slice(0,60), 3500));
    });

    // main tabs
    document.querySelectorAll('.mtab').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const tab=btn.dataset.mtab;
        state.mainTab=tab;
        document.querySelectorAll('.mtab').forEach(b=>b.classList.toggle('active', b.dataset.mtab===tab));
        const tvMain=$('#tvMain'); const movMain=$('#moviesMain'); const catNav=$('#catNav');
        if(tab==='tv'){
          if(tvMain) tvMain.classList.remove('hidden');
          if(movMain) movMain.classList.add('hidden');
          if(catNav) catNav.classList.remove('hidden');
          renderChips(); renderGrid();
        }else{
          if(tvMain) tvMain.classList.add('hidden');
          if(movMain) movMain.classList.remove('hidden');
          if(catNav) catNav.classList.remove('hidden');
          renderMovieChips(); renderMovieGrid();
        }
        window.scrollTo({top:0,behavior:'smooth'});
      });
    });

    const params=new URLSearchParams(location.search);
    const pid=params.get('play'); const ptype=params.get('type')||'tv';
    if(pid){
      const tryPlay=()=>{
        if(ptype==='movie'){
          const m=state.movies.find(x=>x.id===pid); if(m){ state.mainTab='movies'; document.querySelectorAll('.mtab').forEach(b=>b.classList.toggle('active', b.dataset.mtab==='movies')); $('#tvMain').classList.add('hidden'); $('#moviesMain').classList.remove('hidden'); playMovie(m); }
        }else{
          const c=state.all.find(x=>x.id===pid); if(c) playChannel(c);
        }
      };
      setTimeout(tryPlay, 800);
    }
  }

  bind();
  window.addEventListener('pagehide',()=>Heart.stop());
  loadChannels();
  loadMovies();

  window.App={
    goHome(){
      state.query=''; state.category='all'; state.movieCategory='all'; state.ftpFilter='all';
      document.querySelectorAll('.fbtn').forEach((b,i)=>b.classList.toggle('active', i===0));
      const si=$('#searchInput'); if(si) si.value='';
      const cs=$('#clearSearch'); if(cs) cs.classList.add('hidden');
      applyFilter(); applyMovieFilter(); renderChips(); renderMovieChips(); renderGrid(); renderMovieGrid();
      window.scrollTo({top:0,behavior:'smooth'});
    }
  };
})();
