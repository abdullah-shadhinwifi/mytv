/* MyTV v4.0 — TV + Movies (FTP), instant play, password hidden in admin */
(function(){
  'use strict';
  const $ = s => document.querySelector(s);
  const FAV_KEY = 'mytv.favs.v4';

  const state = {
    data: null,
    all: [],
    filtered: [],
    movies: [],
    filteredMovies: [],
    active: null, // channel or movie
    activeType: 'tv', // tv | movie
    hls: null,
    category: 'all',
    movieCategory: 'all',
    query: '',
    mainTab: 'tv',
    retry: 0,
  };

  const CAT_MAP = [
    { id: 'all', label: 'সব', match: () => true },
    { id: 'bangladesh', label: '🇧🇩 বাংলাদেশ', match: c => /bangladesh|bangla|bd|atn|ntv|rtv|somoy|jamuna|channel|ekushey|dbc|maasranga|gazi/i.test((c.name+' '+c.group+' '+c.source).toLowerCase()) || c.sourceId==='verified' },
    { id: 'news', label: '📰 খবর', match: c => /news|খবর|dbc|somoy|jamuna|ekattor/i.test((c.group+' '+c.name).toLowerCase()) },
    { id: 'sports', label: '⚽ খেলা', match: c => /sport|tsports|gazi|gtv|cricket|football/i.test((c.group+' '+c.name).toLowerCase()) },
    { id: 'entertainment', label: '🎬 বিনোদন', match: c => /entertainment|general|movie|drama|natok|vision|boishakhi/i.test((c.group).toLowerCase()) },
    { id: 'kids', label: '👶 কিডস', match: c => /kids|cartoon|children|duronto/i.test((c.group+' '+c.name).toLowerCase()) },
  ];

  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  const proxied = u => '/api/stream?url='+encodeURIComponent(u);
  const imgProxy = u => '/api/img?url='+encodeURIComponent(u);

  function favs(){ try{return JSON.parse(localStorage.getItem(FAV_KEY))||[];}catch(e){return [];} }
  function isFav(id){return favs().includes(id);}
  function toggleFav(id){
    let f=favs(); const i=f.indexOf(id);
    if(i>=0) f.splice(i,1); else f.unshift(id);
    try{localStorage.setItem(FAV_KEY,JSON.stringify(f.slice(0,150)));}catch(e){}
    renderGrid(); renderMovieGrid();
  }

  function toast(msg, ms){
    const t=$('#toast'); if(!t) return;
    t.textContent=msg; t.classList.remove('hidden');
    clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.add('hidden'), ms||3200);
  }

  async function loadChannels(){
    try{
      const r=await fetch('/api/channels',{cache:'no-store'});
      const data=await r.json();
      state.data=data;
      const all = data.channels||[];
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
      const bar=$('#noticeBar'); if(bar){ bar.textContent='চ্যানেল লিস্ট লোড হয়নি'; bar.classList.remove('hidden'); }
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
      const mgc=$('#movieGridCount'); if(mgc) mgc.textContent=state.movies.length;
    }catch(e){
      state.movies=[]; renderMovieGrid();
    }
  }

  function applyFilter(){
    let list=state.all;
    const q=state.query.toLowerCase().trim();
    if(q) list=list.filter(c=> (c.name||'').toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q));
    if(state.category!=='all'){
      const cat=CAT_MAP.find(c=>c.id===state.category);
      if(cat) list=list.filter(cat.match);
    }
    state.filtered=list;
  }

  function applyMovieFilter(){
    let list=state.movies;
    const q=state.query.toLowerCase().trim();
    if(q) list=list.filter(m=> (m.name||'').toLowerCase().includes(q) || (m.group||'').toLowerCase().includes(q));
    if(state.movieCategory!=='all'){
      const qcat=state.movieCategory.toLowerCase();
      list=list.filter(m=> (m.group||'').toLowerCase().includes(qcat));
    }
    state.filteredMovies=list;
  }

  function renderChips(){
    const wrap=$('#catChips'); if(!wrap) return;
    if(state.mainTab!=='tv') return;
    const counts={};
    for(const cat of CAT_MAP) counts[cat.id]= state.all.filter(cat.match).length;
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
    // movie categories from data
    const groups={};
    for(const m of state.movies) groups[m.group||'Movies']=(groups[m.group||'Movies']||0)+1;
    const cats=['all', ...Object.keys(groups).sort()];
    wrap.innerHTML=cats.map(g=>{
      const id=g==='all'?'all':g;
      const label=g==='all'?'সব মুভি':g;
      const active=state.movieCategory===id?'active':'';
      const n=g==='all'?state.movies.length:(groups[g]||0);
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
    const logo=c.logo?`<img class="logo-img" src="${esc(imgProxy(c.logo))}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" alt=""><div class="logo-fallback" style="display:none">${esc(initials(c.name))}</div>`:`<div class="logo-fallback">${esc(initials(c.name))}</div>`;
    const verified=c.verified?`<div class="verified-dot" title="Verified">✓</div>`:'';
    return `<div class="card ${active}" data-id="${esc(c.id)}"><div class="card-art">${logo}<div class="play-badge"><span>▶</span></div>${verified}</div><div class="card-body"><div class="card-name" title="${esc(c.name)}">${esc(c.name)}</div><div class="card-meta"><span class="card-group">${esc(c.group||'Live')}</span><button class="fav-btn ${fav}" data-fav="${esc(c.id)}">${fav?'★':'☆'}</button></div></div></div>`;
  }

  function movieCardHTML(m){
    const fav=isFav(m.id)?'on':'';
    const active=state.active && state.active.id===m.id && state.activeType==='movie'?'active':'';
    const poster=m.logo?`<img class="logo-img" src="${esc(imgProxy(m.logo))}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" alt="" style="object-fit:cover;padding:0"><div class="logo-fallback" style="display:none">${esc(initials(m.name))}</div>`:`<div class="logo-fallback">🎬</div>`;
    const isFtp=m.scheme==='ftp' ? '<span style="position:absolute;top:6px;left:6px;background:rgba(245,178,58,.9);color:#000;font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px">FTP</span>' : '';
    return `<div class="card ${active}" data-mid="${esc(m.id)}"><div class="card-art" style="aspect-ratio:2/3;background:#0d1122">${poster}<div class="play-badge"><span>▶</span></div>${isFtp}<div class="verified-dot" style="background:#f5b23a;color:#000">🎬</div></div><div class="card-body"><div class="card-name" title="${esc(m.name)}">${esc(m.name)}</div><div class="card-meta"><span class="card-group">${esc(m.group||'Movies')}</span><button class="fav-btn ${fav}" data-fav="${esc(m.id)}">${fav?'★':'☆'}</button></div></div></div>`;
  }

  function renderGrid(){
    const grid=$('#channelGrid'); const empty=$('#emptyState');
    const gc=$('#gridCount'); const gh=$('#gridHeading');
    if(!grid) return;
    if(state.mainTab!=='tv') return;
    const list=state.filtered;
    if(gc) gc.textContent=list.length;
    if(gh){
      const cat=CAT_MAP.find(c=>c.id===state.category);
      if(state.query) gh.textContent=`"${state.query}" — ${list.length}টি`;
      else gh.textContent=cat?cat.label+' চ্যানেল':`সব চ্যানেল (${list.length})`;
      if(state.category==='all' && !state.query) gh.textContent=`✅ চলছে এমন চ্যানেল (${list.length})`;
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
      else if(state.movieCategory==='all') gh.textContent=`🎬 মুভি কালেকশন (${list.length})`;
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
    if(loadSub) loadSub.textContent=sub||'';
  }
  function hideLoading(){ const {loading}=playerEls(); if(loading) loading.classList.add('hidden'); }
  function showErrorAuto(msg){
    const {loading, err, errSub}=playerEls();
    if(loading) loading.classList.add('hidden');
    if(err){ err.classList.remove('hidden'); if(errSub) errSub.textContent=msg||'পরেরটায় যাচ্ছি...'; }
  }

  function stopPlayback(){
    Heart.stop();
    const {video}=playerEls();
    if(state.hls){ try{state.hls.destroy();}catch(e){} state.hls=null; }
    if(video){ try{ video.pause(); video.removeAttribute('src'); video.load(); }catch(e){} }
  }

  function nextChannel(){
    if(!state.filtered.length) return null;
    const idx=state.filtered.findIndex(c=>state.active && c.id===state.active.id);
    if(idx>=0 && idx < state.filtered.length-1) return state.filtered[idx+1];
    return state.filtered[0];
  }

  async function playChannel(c){
    stopPlayback();
    state.active=c; state.activeType='tv'; state.retry=0;
    const {wrap, video, title, group, badge}=playerEls();
    if(!wrap || !video) return;
    wrap.classList.remove('hidden');
    if(title) title.textContent=c.name;
    if(group) group.textContent=c.group||'Live';
    if(badge) badge.innerHTML='<span class="pulse"></span> LIVE';
    showLoading(c.name,'লোড হচ্ছে...');
    renderGrid();
    if(window.innerWidth<768) wrap.scrollIntoView({behavior:'smooth', block:'start'});
    const src=proxied(c.url);
    let played=false;
    const onPlaying=()=>{ if(played) return; played=true; hideLoading(); Heart.start(); };
    const onError=()=>{
      if(played) return;
      if(state.retry<1){
        state.retry++; showLoading(c.name,'আবার চেষ্টা...');
        setTimeout(()=>{ if(state.active && state.active.id===c.id) playChannel(c); },1200);
      }else{
        toast(`⚠️ ${c.name} অফলাইন, পরেরটা...`,2500);
        showErrorAuto('পরের চ্যানেলে যাচ্ছি...');
        const nxt=nextChannel();
        if(nxt && nxt.id!==c.id) setTimeout(()=>playChannel(nxt),1200);
      }
    };
    video.addEventListener('playing', onPlaying, {once:true});
    video.addEventListener('error', onError, {once:true});
    setTimeout(()=>{ if(!played && state.active && state.active.id===c.id) onError(); },8000);
    try{
      if(window.Hls && window.Hls.isSupported()){
        const hls=new Hls({enableWorker:true, maxBufferLength:30, backBufferLength:60, fragLoadingMaxRetry:3, manifestLoadingMaxRetry:2});
        state.hls=hls;
        hls.on(Hls.Events.MANIFEST_PARSED, ()=>{
          const p=video.play(); if(p) p.catch(()=>{ showLoading(c.name,'▶️ ট্যাপ করে চালু করুন'); });
        });
        hls.on(Hls.Events.ERROR, (e,data)=>{
          if(!data || !data.fatal) return;
          if(data.type===Hls.ErrorTypes.NETWORK_ERROR){ try{hls.startLoad();}catch(e){} if(!played) setTimeout(()=>{ if(!played) onError(); },1500); }
          else if(data.type===Hls.ErrorTypes.MEDIA_ERROR){ try{hls.recoverMediaError();}catch(e){ onError(); } }
          else onError();
        });
        hls.loadSource(src); hls.attachMedia(video);
      }else{
        video.src=src; video.load();
        const p=video.play(); if(p) p.catch(()=>{ showLoading(c.name,'▶️ ট্যাপ করে চালু করুন'); });
      }
    }catch(e){ onError(); }
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
    const scheme=(url.match(/^([a-z]+):/i)||[,''])[1].toLowerCase();

    if(scheme==='ftp' || scheme==='ftps'){
      // FTP cannot play directly in browser — show guidance, try proxy if http fallback available
      showLoading(m.name,'FTP লিংক — VLC তে ভালো চলবে');
      // Try to proxy via /api/stream if it's ftp? Our proxy only allows http/https, so we show options
      setTimeout(()=>{
        hideLoading();
        toast('FTP লিংক ব্রাউজারে সরাসরি চলে না — VLC তে খুলুন বা Copy URL করুন', 4000);
        // Still try to set src via proxy? If url is ftp, proxy will reject with 400, so we show blocked UI
        const {err, errSub, loading}=playerEls();
        if(loading) loading.classList.add('hidden');
        if(err){
          err.classList.remove('hidden');
          err.querySelector('.v-title').textContent='FTP মুভি';
          if(errSub) errSub.innerHTML=`এই মুভি <b>FTP</b> সার্ভারে।<br>ব্রাউজারে সরাসরি না চললে <b>VLC</b> তে খুলুন।<br><br><button class="pill-btn" onclick="navigator.clipboard.writeText('${esc(url)}').then(()=>{document.getElementById('toast').textContent='URL কপি হয়েছে';document.getElementById('toast').classList.remove('hidden');setTimeout(()=>document.getElementById('toast').classList.add('hidden'),2000)})">📋 Copy FTP URL</button> <a class="pill-btn" href="${esc(url)}" target="_blank" style="text-decoration:none">↗️ Open</a>`;
        }
      }, 800);
      return;
    }

    // HTTP movie — try proxy to avoid CORS
    const src = /^https?:\/\//i.test(url) ? proxied(url) : url;
    showLoading(m.name,'মুভি লোড হচ্ছে...');

    let played=false;
    const onPlaying=()=>{ if(played) return; played=true; hideLoading(); };
    const onError=()=>{ if(played) return; toast('মুভি চালানো যায়নি — লিংক চেক করুন', 3000); showErrorAuto('মুভি লিংক কাজ করছে না'); };

    video.addEventListener('playing', onPlaying, {once:true});
    video.addEventListener('error', onError, {once:true});

    try{
      if(url.includes('.m3u8') && window.Hls && window.Hls.isSupported()){
        const hls=new Hls({enableWorker:true});
        state.hls=hls;
        hls.on(Hls.Events.MANIFEST_PARSED, ()=>{ const p=video.play(); if(p) p.catch(()=>{}); });
        hls.on(Hls.Events.ERROR, (e,d)=>{ if(d && d.fatal) onError(); });
        hls.loadSource(src); hls.attachMedia(video);
      }else{
        video.src=src; video.load();
        const p=video.play(); if(p) p.catch(()=>{ showLoading(m.name,'▶️ ট্যাপ করে চালু করুন'); });
      }
    }catch(e){ onError(); }
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
        if(state.mainTab==='tv'){ applyFilter(); renderGrid(); }
        else { applyMovieFilter(); renderMovieGrid(); }
      });
    }
    if(cs){
      cs.addEventListener('click',()=>{
        if(si) si.value=''; state.query=''; cs.classList.add('hidden');
        if(state.mainTab==='tv'){ applyFilter(); renderGrid(); } else { applyMovieFilter(); renderMovieGrid(); }
        if(si) si.focus();
      });
    }
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

    // auto play from URL
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
      setTimeout(tryPlay, 1000);
    }
  }

  bind();
  window.addEventListener('pagehide',()=>Heart.stop());
  loadChannels();
  loadMovies();

  window.App={
    goHome(){
      state.query=''; state.category='all'; state.movieCategory='all';
      const si=$('#searchInput'); if(si) si.value='';
      const cs=$('#clearSearch'); if(cs) cs.classList.add('hidden');
      applyFilter(); applyMovieFilter(); renderChips(); renderMovieChips(); renderGrid(); renderMovieGrid();
      window.scrollTo({top:0,behavior:'smooth'});
    }
  };
})();
