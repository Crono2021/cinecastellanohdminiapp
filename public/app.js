
// --- Build direct PixelDrain URL using /api for fullscreen (no server-side proxy) ---
function toWatchUrl(link){
  if (!link) return null;
  try{
    const u = new URL(link);
    const host = (u.hostname || '').replace(/^www\./,'');
    if (!/pixeldrain\.(net|com)$/i.test(host)) return null;
    const segs = (u.pathname || '').split('/').filter(Boolean);
    let id = null;
    const idx = segs.findIndex(s => s==='u' || s==='d' || s==='file');
    if (idx >= 0 && segs[idx+1]) id = segs[idx+1];
    if (!id && segs.length) id = segs[segs.length-1];
    if (!id) return null;
    return `https://${host}/api/file/${id}`;
  }catch(_){ return null; }
}

const imgBase = 'https://image.tmdb.org/t/p/w342';
let state = { page: 1, pageSize: 24, q: '', actor: '', genre: '' };

// --- Client-side aggregation for full-catalog genre filtering ---
state.clientGenreItems = null;

async function fetchAllPagesForGenre(genreId, maxPages=200){
  const collected = [];
  const seen = new Set();
  let consecutiveEmpty = 0;

  for (let p=1; p<=maxPages; p++){
    const params = new URLSearchParams({ page: p, pageSize: state.pageSize, genre: genreId });
    if (type==='movie' || type==='tv') params.set('type', type);
    const res = await fetch('/api/catalog?' + params.toString());
    if (!res.ok) break;
    const data = await res.json();
    const before = collected.length;

    (data.items || []).forEach(it => {
      const id = it.tmdb_id ?? it.id ?? JSON.stringify(it);
      if (!seen.has(id)){
        seen.add(id);
        collected.push(it);
      }
    });

    if ((data.items||[]).length === 0){
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break; // assume we've reached the end
    } else {
      consecutiveEmpty = 0;
    }

    // Heuristic: if no new items were added in last 5 pages, stop early
    if (p % 5 === 0 && collected.length === before){
      break;
    }
  }
  return collected;
}


async function fetchGenres(){
  const res = await fetch('/api/genres');
  const data = await res.json();
  const sel = document.getElementById('genre');
  sel.innerHTML = '<option value="">Todos los géneros</option>' + data.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}


async function load(){
  const pageInfo = document.getElementById('pageInfo');
  const grid = document.getElementById('grid');

  if (state.clientGenreItems && Array.isArray(state.clientGenreItems)){
    // Client-side paginated render from the aggregated list
    const start = (state.page - 1) * state.pageSize;
    const end = start + state.pageSize;
    const slice = state.clientGenreItems.slice(start, end);

    grid.innerHTML = slice.map(item => `
      <div class="card" data-id="${item.tmdb_id}">
        
        <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
        <div class="meta">
          <div class="title">${item.title}</div>
          <div class="year">${item.year || ''} 
        ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
      </div>
        </div>
      
      ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
    </div>
    `).join('');

    document.querySelectorAll('.card').forEach(el => {
      el.addEventListener('click', () => openDetails(el.dataset.id));
    });

    const totalPages = Math.max(1, Math.ceil(state.clientGenreItems.length / state.pageSize));
    pageInfo.textContent = `Página ${state.page} de ${totalPages} · ${state.clientGenreItems.length} resultados`;
    return;
  }

  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  if (state.q) params.set('q', state.q);
  if (state.actor) params.set('actor', state.actor);
  if (state.genre) params.set('genre', state.genre);
    const endpoint = (state.actor && !state.clientGenreItems) ? '/api/movies/by-actor?name=' + encodeURIComponent(state.actor) + '&' + params.toString() : '/api/catalog?' + params.toString();
  const res = await fetch(endpoint);
  const data = await res.json();

  grid.innerHTML = data.items.map(item => `
    <div class="card" data-id="${item.tmdb_id}">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${item.title}</div>
        <div class="year">${item.year || ''} </div>
      </div>
    
      ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
    </div>
  `).join('');

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetails(el.dataset.id));
  });

  pageInfo.textContent = `Página ${data.page}`;
}

async function openDetails(id){
  const res = await fetch(`/api/movie/${id}`);
  const d = await res.json();
  document.getElementById('modalTitle').textContent = `${d.title} ${d.release_date ? '('+d.release_date.slice(0,4)+')':''}`;
  const poster = document.getElementById('modalPoster');
  poster.src = d.poster_path ? (imgBase + d.poster_path) : '';
  document.getElementById('modalOverview').textContent = d.overview || 'Sin sinopsis disponible.';
  document.getElementById('modalMeta').textContent = `${d.runtime ? d.runtime+' min · ':''}Puntuación TMDB: ${d.vote_average ?? '—'}`;
  document.getElementById('modalGenres').innerHTML = (d.genres||[]).map(g => `<span class="badge">${g.name}</span>`).join('');
  document.getElementById('modalCast').innerHTML = (d.cast||[]).map(p => `<span class="badge">${p.name}</span>`).join('');
  const link = document.getElementById('watchLink');
  if (d.link) { const w = toWatchUrl(d.link); link.href = w || d.link; link.style.display='inline-flex'; }
  else { link.style.display='none'; }
  document.getElementById('modal').classList.add('open');
}

function closeModal(){ document.getElementById('modal').classList.remove('open'); }

document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });

const q = document.getElementById('q');
const actor = document.getElementById('actor');
const genre = document.getElementById('genre');

document.getElementById('searchBtn').addEventListener('click', ()=>{ state.page=1; state.q=q.value.trim(); state.actor=actor.value.trim(); state.genre=genre.value; load(); });
document.getElementById('resetBtn').addEventListener('click', ()=>{
  state.clientGenreItems = null; state={ page:1, pageSize:24, q:'', actor:'', genre:''}; q.value=''; actor.value=''; genre.value=''; load(); });

document.getElementById('prev').addEventListener('click', ()=>{ if(state.page>1){ state.page--; load(); }});
document.getElementById('next').addEventListener('click', ()=>{ state.page++; load(); });



// === Client cache of full catalog ===
const CatalogCache = {
  key: 'catalogCache_v1',
  async getServerVersion(){
    try{
      const r = await fetch('/api/catalog-version');
      if (!r.ok) return null;
      return await r.json();
    }catch(_){ return null; }
  },
  read(){
    try{
      const s = localStorage.getItem(this.key);
      if (!s) return null;
      return JSON.parse(s);
    }catch(_){ return null; }
  },
  write(payload){
    try{ localStorage.setItem(this.key, JSON.stringify(payload)); }catch(_){}
  },
  clear(){ try{ localStorage.removeItem(this.key); }catch(_){ } }
};

async function tryLoadFromCache(){
  const cache = CatalogCache.read();
  if (cache && Array.isArray(cache.items)){
    // Use cached aggregated items for instant render
    state.clientGenreItems = cache.items;
    state.page = 1;
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = 'Usando caché local · ' + cache.items.length + ' ítems';
    // Render immediately
    render();
  }
  // In background, verify server version and refresh cache if needed
  (async ()=>{
    const v = await CatalogCache.getServerVersion();
    const cachedV = (cache && cache.version) || null;
    if (!v || !v.version) return;
    if (!cache || cachedV !== v.version){
      // Recolecta TODO el catálogo enriquecido usando la función existente
      const all = await fetchAllPagesWithOptionalFilters({});
      CatalogCache.write({ version: v.version, saved_at: new Date().toISOString(), items: all });
      // Si el usuario no ha cambiado filtro, actualiza la vista a partir de la nueva caché
      if (!state.q && !state.actor && (!state.genre || state.genre==='TYPE_MOVIE' || state.genre==='TYPE_TV')){
        state.clientGenreItems = all;
        state.page = 1;
        render();
      }
    }
  })();
}

// React to genre changes immediately and query the full catalog via the API


document.getElementById('genre').addEventListener('change', async (e)=>{
  state.page = 1;
  const val = (e && e.target && e.target.value) || '';
  const pageInfo = document.getElementById('pageInfo'); if (pageInfo) pageInfo.textContent = 'Cargando…';
  if (val === 'TYPE_MOVIE' || val === 'TYPE_TV'){
    const type = (val === 'TYPE_MOVIE') ? 'movie' : 'tv';
    state.clientGenreItems = await fetchAllPagesWithOptionalFilters({ genreId: '', type });
    state.genre = val;
  } else if (val){
    // Optimized genre fetch (pageSize=200) to minimize calls
    state.clientGenreItems = await fetchAllPagesForGenreOptimized(val);
    state.genre = val;
  } else {
    state.clientGenreItems = null;
    state.genre = '';
  }
  load();
});
    // Mantén el value seleccionado para el UI
    state.genre = val;
  } else {
    // Comportamiento original para géneros TMDB
    state.genre = val;
    if (state.genre){
      document.getElementById('pageInfo').textContent = 'Cargando…';
      // Usa el agregador original página a página
      state.clientGenreItems = await fetchAllPagesForGenre(state.genre);
    } else {
      state.clientGenreItems = null;
    }
  }
  load();
});

tryLoadFromCache();
fetchGenres().then(()=>{ try{ prependTypeOptions(); }catch(_){} load(); backgroundPrefetchAllIfNeeded(); });


/* Enter on actor triggers search */
(function(){
  const actor = document.getElementById('actor');
  const btn = document.getElementById('searchBtn');
  if (actor && btn){
    actor.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ btn.click(); } });
  }
})();


// --- Enter-to-search helper (desktop & mobile) ---
(function(){
  const qEl = document.getElementById('q');
  const actorEl = document.getElementById('actor');
  const genreEl = document.getElementById('genre');
  const btn = document.getElementById('searchBtn');

  function triggerSearch(){
    if (!btn) return;
    // Mirror the search click behavior
    state.page = 1;
    state.q = qEl ? qEl.value.trim() : '';
    state.actor = actorEl ? actorEl.value.trim() : '';
    state.genre = genreEl ? genreEl.value : (state.genre||'');
    state.clientGenreItems = null; // rely on backend pagination when doing a search
    btn.click ? btn.click() : load();
  }

  function handleEnter(e){
    if (e.key === 'Enter'){
      // prevent default form submits or unwanted line breaks
      e.preventDefault();
      triggerSearch();
    }
  }

  // Desktop & Mobile soft keyboards
  if (qEl)    qEl.addEventListener('keydown', handleEnter, { passive: false });
  if (actorEl)actorEl.addEventListener('keydown', handleEnter, { passive: false });

  // If the inputs are inside a form, catch submit too
  const form = (qEl && qEl.form) || (actorEl && actorEl.form) || document.getElementById('searchForm');
  if (form){
    form.addEventListener('submit', function(e){ e.preventDefault(); triggerSearch(); }, { passive: false });
  }
})();


// --- Minimal additions: prepend Películas/Series options & robust client-side aggregator ---
function prependTypeOptions(){
  const sel = document.getElementById('genre');
  if (!sel) return;
  // Avoid duplicating if already added
  if ([...sel.options].some(o => o.value === 'TYPE_MOVIE')) return;
  const frag = document.createDocumentFragment();
  const optMovie = document.createElement('option');
  optMovie.value = 'TYPE_MOVIE';
  optMovie.textContent = 'Películas';
  const optTV = document.createElement('option');
  optTV.value = 'TYPE_TV';
  optTV.textContent = 'Series';
  const sep = document.createElement('option');
  sep.value = '';
  sep.textContent = '──────────';
  sep.disabled = true;
  // Insert after the first option ("Todos los géneros") if exists
  if (sel.firstChild){
    sel.insertBefore(sep, sel.firstChild.nextSibling || null);
    sel.insertBefore(optTV, sep);
    sel.insertBefore(optMovie, optTV);
  } else {
    sel.appendChild(optMovie); sel.appendChild(optTV); sel.appendChild(sep);
  }
}

// Aggregate across catalog pages optionally filtering by type on client side
async function fetchAllPagesWithOptionalFilters({ genreId = '', type = '', maxPages = 200 }){
  const collected = [];
  const seen = new Set();
  let consecutiveEmpty = 0;

  for (let p = 1; p <= maxPages; p++){
    const params = new URLSearchParams({ page: p, pageSize: 200 });
    if (genreId) params.set('genre', genreId);
    if (type==='movie' || type==='tv') params.set('type', type);
    const res = await fetch('/api/catalog?' + params.toString());
    if (!res.ok) break;
    const data = await res.json();
    const pageItems = (data.items || []);

    let filtered = pageItems;
    if (type === 'movie' || type === 'tv'){
      filtered = pageItems.filter(it => it && it.type === type);
    }

    for (const it of filtered){
      const id = (it && (it.tmdb_id ?? it.id)) ?? JSON.stringify(it);
      if (!seen.has(id)){ seen.add(id); collected.push(it); }
    }

    if (pageItems.length === 0){
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
    } else {
      consecutiveEmpty = 0;
    }

    if (p % 5 === 0 && filtered.length === 0){
      break;
    }
  }
  return collected;
}



// === IndexedDB tiny helper ===
const IDB = {
  db: null,
  name: 'cine-cache',
  store: 'kv',
  async open(){
    if (this.db) return this.db;
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.store)){
          db.createObjectStore(this.store);
        }
      };
      req.onsuccess = (e)=>{ this.db = e.target.result; resolve(this.db); };
      req.onerror = (e)=> reject(e.target.error);
    });
  },
  async get(key){
    const db = await this.open();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction([this.store], 'readonly');
      const st = tx.objectStore(this.store);
      const r = st.get(key);
      r.onsuccess = ()=> resolve(r.result || null);
      r.onerror = ()=> reject(r.error);
    });
  },
  async set(key, val){
    const db = await this.open();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction([this.store], 'readwrite');
      const st = tx.objectStore(this.store);
      const r = st.put(val, key);
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    });
  }
};

const FullCatalogKey = 'fullCatalog_v2'; // bump if structure changes

async function backgroundPrefetchAllIfNeeded(){
  try{
    const serverV = await CatalogCache.getServerVersion();
    if (!serverV || !serverV.version) return;
    const existing = await IDB.get(FullCatalogKey);
    if (existing && existing.version === serverV.version){
      // Already up-to-date; also hydrate state for instant filters
      if (!state.clientGenreItems){
        state.clientGenreItems = existing.items || [];
      }
      return;
    }
    // Prefetch both movies and tv in large pages, merging in client
    async function fetchAllByType(type){
      const batch = [];
      const pageSize = 200;
      for (let p=1; p<=999; p++){
        const params = new URLSearchParams({ page: p, pageSize, type });
        const res = await fetch('/api/catalog?' + params.toString());
        if (!res.ok) break;
        const data = await res.json();
        const items = data.items || [];
        batch.push(...items.map(it => ({ ...it, type })));
        if (items.length < pageSize) break;
      }
      return batch;
    }
    const [allMovies, allTv] = await Promise.all([ fetchAllByType('movie'), fetchAllByType('tv') ]);
    const all = [...allMovies, ...allTv];
    // Sort similar to server
    all.sort((a,b)=>{
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const db = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (db !== da) return db - da;
      return (b.tmdb_id||0) - (a.tmdb_id||0);
    });
    await IDB.set(FullCatalogKey, { version: serverV.version, saved_at: new Date().toISOString(), items: all });
    // Si el usuario está en vista global o filtro por tipo, podemos actualizar al vuelo
    if (!state.q && !state.actor){
      state.clientGenreItems = all;
      render();
    }
  }catch(e){
    // silencioso
  }
}

// Intentar hidratar desde IndexedDB antes de la caché simple
(async ()=>{
  try{
    const cached = await IDB.get(FullCatalogKey);
    if (cached && Array.isArray(cached.items)){
      state.clientGenreItems = cached.items;
      render();
    }
  }catch(_){}
})();


// === Optimized genre aggregator: same idea as type-optimized, but for any TMDB genre ===
async function fetchAllPagesForGenreOptimized(genreId, maxPages = 200){
  const collected = [];
  const seen = new Set();
  const pageSize = 200;
  for (let p = 1; p <= maxPages; p++){
    const params = new URLSearchParams({ page: p, pageSize, genre: genreId });
    const res = await fetch('/api/catalog?' + params.toString());
    if (!res.ok) break;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const it of items){
      const id = (it && (it.tmdb_id ?? it.id)) ?? JSON.stringify(it);
      if (!seen.has(id)){ seen.add(id); collected.push(it); }
    }
    if (items.length < pageSize) break; // last page
  }
  return collected;
}
