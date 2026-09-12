/* MyTV v7.0 - Beautiful Links Instant Open */
(function(){
  'use strict';
  const $=s=>document.querySelector(s);
  const FAV_KEY='mytv.favs.v70';
  const state={all:[],filtered:[],movies:[],filteredMovies:[],active:null,hls:null,category:'all',query:'',mainTab:'tv',ftpFilter:'all'};
  const CAT_MAP=[
    {id:'all',label:'সব',match:()=>true},
    {id:'bangladesh',label:'🇧🇩 BD',match:c=>/bangladesh|bangla|bd|atn|ntv|rtv|somoy|jamuna|ekushey|dbc|maasranga|gazi/i.test((c.name+' '+c.group).toLowerCase())||c.verified},
    {id:'news',label:'📰 খবর',match:c=>/news|dbc|somoy|jamuna/i.test((c.group+' '+c.name).toLowerCase())},
    {id:'sports',label:'⚽ খেলা',match:c=>/sport|tsports|gazi/i.test((c.group+' '+c.name).toLowerCase())},
  ];
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  const BDIX=['discoveryftp.net','cdn1.discoveryftp.net','cdn2.discoveryftp.net'];
  const isBdix=u=>{try{const h=new URL(u).hostname.toLowerCase();return BDIX.some(d=>h.includes(d));}catch(e){return false;}};
  const proxied=u=>isBdix(u)?u:'/api/stream?url='+encodeURIComponent(u);
  const imgProxy=u=>isBdix(u)?u:'/api/img?url='+encodeURIComponent(u);
  function favs(){try{return JSON.parse(localStorage.getItem(FAV_KEY))||[];}catch(e){return [];}}
  function isFav(id){return favs().includes(id);}
  function toggleFav(id){let f=favs();const i=f.indexOf(id);if(i>=0)f.splice(i,1);else f.unshift(id);try{localStorage.setItem(FAV_KEY,JSON.stringify(f.slice(0,200)));}catch(e){}renderGrid();renderLinks();}
  function toast(m,ms){const t=$('#toast');if(!t)return;t.textContent=m;t.classList.remove('hidden');clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.add('hidden'),ms||2500);}

  async function loadChannels(){
    try{
      const r=await fetch('/api/channels',{cache:'no-store'});const d=await r.json();
      state.all=(d.channels||[]).sort((a,b)=>{
        if(a.verified&&!b.verified)return-1;
        if(!a.verified&&b.verified)return 1;
        const af=isFav(a.id),bf=isFav(b.id);
        if(af&&!bf)return-1;if(!af&&bf)return 1;
        return a.name.localeCompare(b.name);
      });
      applyFilter();renderChips();renderGrid();
      $('#liveCount').textContent=state.all.length;
    }catch(e){}
  }
  async function loadMovies(){
    try{
      const r=await fetch('/api/movies',{cache:'no-store'});const d=await r.json();
      state.movies=d.movies||[];
      applyMovieFilter();renderLinks();
      $('#movieCount').textContent=state.movies.length;
    }catch(e){state.movies=[];renderLinks();}
  }

  function matchFilter(item){
    if(state.ftpFilter==='all')return true;
    const url=(item.url||'').toLowerCase();
    const isFtp=url.startsWith('ftp://')||isBdix(item.url||'')||(item.group||'').toLowerCase()==='ftp';
    const isWeb=(item.group||'').toLowerCase()==='web movies';
    if(state.ftpFilter==='ftp')return isFtp;
    if(state.ftpFilter==='web')return isWeb;
    if(state.ftpFilter==='live')return !isFtp&&!isWeb;
    return true;
  }
  function applyFilter(){
    let l=state.all;
    const q=state.query.toLowerCase().trim();
    if(q)l=l.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.group||'').toLowerCase().includes(q));
    if(state.category!=='all'){const cat=CAT_MAP.find(c=>c.id===state.category);if(cat)l=l.filter(cat.match);}
    l=l.filter(matchFilter);
    state.filtered=l;
  }
  function applyMovieFilter(){
    let l=state.movies;
    const q=state.query.toLowerCase().trim();
    if(q)l=l.filter(m=>(m.name||'').toLowerCase().includes(q)||(m.group||'').toLowerCase().includes(q)||(m.url||'').toLowerCase().includes(q));
    l=l.filter(matchFilter);
    state.filteredMovies=l;
  }

  function renderChips(){
    const w=$('#catChips');if(!w||state.mainTab!=='tv')return;
    w.innerHTML=CAT_MAP.map(cat=>{
      const active=state.category===cat.id?'active':'';
      return `<button class="chip ${active}" data-cat="${cat.id}">${cat.label}</button>`;
    }).join('');
    w.querySelectorAll('.chip').forEach(el=>el.addEventListener('click',()=>{
      state.category=el.dataset.cat;applyFilter();renderChips();renderGrid();
    }));
  }

  function initials(n){const p=(n||'?').replace(/[^\p{L}\p{N} ]/gu,'').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('');return (p||'?').toUpperCase().slice(0,2);}

  function cardHTML(c){
    const fav=isFav(c.id)?'on':'';const active=state.active&&state.active.id===c.id?'active':'';
    const logo=c.logo?`<img class="logo-img" src="${esc(imgProxy(c.logo))}" loading="lazy" onerror="this.style.display='none'" alt=""><div class="fallback" style="display:none">${esc(initials(c.name))}</div>`:`<div class="fallback">${esc(initials(c.name))}</div>`;
    return `<div class="card ${active}" data-id="${esc(c.id)}"><div class="card-art">${logo}<div class="play"><span>▶</span></div></div><div class="card-body"><div class="card-name">${esc(c.name)}</div><div class="card-meta"><span class="group">${esc(c.group||'Live')}</span><button class="fav ${fav}" data-fav="${esc(c.id)}">${fav?'★':'☆'}</button></div></div></div>`;
  }
  function renderGrid(){
    const grid=$('#channelGrid');const gc=$('#gridCount');
    if(!grid||state.mainTab!=='tv')return;
    const list=state.filtered;
    if(gc)gc.textContent=list.length;
    if(!list.length){grid.innerHTML='<div class="empty"><p>No channels</p></div>';return;}
    grid.innerHTML=list.map(cardHTML).join('');
    grid.querySelectorAll('.card').forEach(el=>el.addEventListener('click',e=>{
      if(e.target.closest('.fav'))return;
      const c=state.all.find(x=>x.id===el.dataset.id);
      if(c)playChannel(c);
    }));
    grid.querySelectorAll('.fav').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();toggleFav(b.dataset.fav);}));
  }

  function linkCardHTML(m){
    const fav=isFav(m.id)?'on':'';
    const icons={RidoMovies:'🎬',MoviePlex:'🍿',TheFlixBay:'🎥',RedFlix:'🔴',MoviesJoy:'😊','HD Today':'📺',AZMovies:'🎞️'};
    let ic='🔗';for(const k in icons){if(m.name.includes(k)){ic=icons[k];break;}}
    const domain=(()=>{try{return new URL(m.url).hostname.replace('www.','');}catch(e){return m.url.slice(0,24);}})();
    const logo=m.logo?`<img src="${esc(m.logo)}" alt="" onerror="this.style.display='none'">`:`${ic}`;
    return `<div class="link-card" data-mid="${esc(m.id)}">
      <div class="link-logo">${logo}</div>
      <div class="link-info">
        <div class="link-title">${esc(m.name)}</div>
        <div class="link-domain">${esc(domain)}</div>
        <span class="link-tag">${esc(m.group||'Web')} • Click to Open</span>
      </div>
      <div class="link-go">↗️</div>
      <button class="fav ${fav}" data-fav="${esc(m.id)}" style="margin-left:8px">${fav?'★':'☆'}</button>
    </div>`;
  }
  function renderLinks(){
    const view=$('#movieListView');const gc=$('#movieGridCount');
    if(!view||state.mainTab!=='movies')return;
    const list=state.filteredMovies;
    if(gc)gc.textContent=list.length;
    if(!list.length){view.innerHTML='<div class="empty"><p>No links — add in Admin</p></div>';return;}
    view.innerHTML=list.map(linkCardHTML).join('');
    view.querySelectorAll('.link-card').forEach(el=>{
      el.addEventListener('click',e=>{
        if(e.target.closest('.fav'))return;
        const m=state.movies.find(x=>x.id===el.dataset.mid);
        if(m){
          // Instant open
          window.open(m.url,'_blank');
          toast('↗️ Opening '+m.name,2000);
        }
      });
    });
    view.querySelectorAll('.fav').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();toggleFav(b.dataset.fav);}));
  }

  function playerEls(){return{wrap:$('#playerWrap'),video:$('#tvVideo'),title:$('#playerTitle'),group:$('#playerGroup'),badge:$('#playerBadge')};}
  function stop(){const {video}=playerEls();if(state.hls){try{state.hls.destroy();}catch(e){}state.hls=null;}if(video){try{video.pause();video.removeAttribute('src');video.load();}catch(e){}}}

  async function playChannel(c){
    stop();state.active=c;
    const {wrap,video,title,group,badge}=playerEls();
    if(!wrap||!video)return;
    wrap.classList.remove('hidden');
    if(title)title.textContent=c.name;
    if(group)group.textContent=c.group||'Live';
    if(badge)badge.textContent='LIVE • LOW PING';
    renderGrid();
    if(window.innerWidth<768)wrap.scrollIntoView({behavior:'smooth'});
    const src=proxied(c.url);
    try{
      if(c.url.includes('.m3u8')&&window.Hls&&Hls.isSupported()){
        const hls=new Hls({
          enableWorker:true,lowLatencyMode:true,
          backBufferLength:8,maxBufferLength:5,maxMaxBufferLength:10,
          liveSyncDuration:0.8,liveMaxLatencyDuration:2.5,
          startLevel:-1,capLevelToPlayerSize:true,abrEwmaDefaultEstimate:600000
        });
        state.hls=hls;
        hls.on(Hls.Events.LEVEL_SWITCHED,(e,d)=>{
          const lvl=hls.levels[d.level];
          if(lvl&&badge)badge.textContent=`LIVE • ${lvl.height||'?'}p • Low Ping`;
        });
        hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
        hls.loadSource(src);hls.attachMedia(video);
      }else{video.src=src;video.load();video.play().catch(()=>{});}
    }catch(e){}
  }

  function bind(){
    const si=$('#searchInput');const cs=$('#clearSearch');
    if(si)si.addEventListener('input',e=>{
      state.query=e.target.value.trim();
      if(cs)cs.classList.toggle('hidden',!state.query);
      if(state.mainTab==='tv'){applyFilter();renderChips();renderGrid();}
      else{applyMovieFilter();renderLinks();}
    });
    if(cs)cs.addEventListener('click',()=>{if(si)si.value='';state.query='';cs.classList.add('hidden');if(state.mainTab==='tv'){applyFilter();renderChips();renderGrid();}else{applyMovieFilter();renderLinks();}});
    document.querySelectorAll('.fbtn').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.ftpFilter=b.dataset.ftp;
      if(state.mainTab==='tv'){applyFilter();renderChips();renderGrid();}
      else{applyMovieFilter();renderLinks();}
    }));
    $('#closePlayerBtn').addEventListener('click',()=>{stop();state.active=null;$('#playerWrap').classList.add('hidden');renderGrid();});
    $('#shareBtn').addEventListener('click',()=>{
      if(!state.active)return;
      const url=location.origin+'/?play='+encodeURIComponent(state.active.id);
      if(navigator.share){navigator.share({title:state.active.name,url}).catch(()=>{});}
      else{navigator.clipboard.writeText(url).then(()=>toast('Link copied ✓'));}
    });
    document.querySelectorAll('.mtab').forEach(b=>b.addEventListener('click',()=>{
      const tab=b.dataset.mtab;
      state.mainTab=tab;
      document.querySelectorAll('.mtab').forEach(x=>x.classList.toggle('active',x.dataset.mtab===tab));
      const tv=$('#tvMain'),mv=$('#moviesMain'),cat=$('#catNav'),pw=$('#playerWrap');
      if(tab==='tv'){
        tv.classList.remove('hidden');mv.classList.add('hidden');cat.classList.remove('hidden');
        renderChips();renderGrid();
      }else{
        tv.classList.add('hidden');mv.classList.remove('hidden');cat.classList.add('hidden');
        pw.classList.add('hidden');
        renderLinks();
      }
      window.scrollTo({top:0,behavior:'smooth'});
    }));
  }
  bind();loadChannels();loadMovies();
  window.App={goHome(){state.query='';state.category='all';state.ftpFilter='all';document.querySelectorAll('.fbtn').forEach((b,i)=>b.classList.toggle('active',i===0));const si=$('#searchInput');if(si)si.value='';$('#clearSearch').classList.add('hidden');applyFilter();applyMovieFilter();renderChips();renderGrid();renderLinks();window.scrollTo({top:0,behavior:'smooth'});}};
})();
