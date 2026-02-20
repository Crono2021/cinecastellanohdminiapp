/* eslint-disable */

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
    return `https://${host}/u/${id}`;
  }catch(_){ return null; }
}

const imgBase = 'https://image.tmdb.org/t/p/w342';

// Explore state (grid)
let state = { page: 1, pageSize: 24, q: '', actor: '', genre: '' };
state.clientGenreItems = null; // (kept for compatibility with genre aggregator)

// --- "Más vistas hoy" (client-only) ---
function ymdLocal(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function viewsKey(){
  return `cchd_views_${ymdLocal()}`;
}

function readViews(){
  try{
    const raw = localStorage.getItem(viewsKey());
    return raw ? JSON.parse(raw) : {};
  }catch(_){ return {}; }
}

function writeViews(obj){
  try{ localStorage.setItem(viewsKey(), JSON.stringify(obj || {})); }catch(_){ }
}

function trackView(id, type){
  try{
    const k = `${type || 'movie'}:${id}`;
    const v = readViews();
    v[k] = (v[k] || 0) + 1;
    writeViews(v);
  }catch(_){ }
}

function getTopToday(limit = 10){
  const v = readViews();
  const arr = Object.entries(v)
    .map(([k,count]) => {
      const [type,id] = k.split(':');
      return { type, id, count };
    })
    .sort((a,b)=> (b.count||0) - (a.count||0))
    .slice(0, limit);
  return arr;
}

// --- UI helpers ---
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function renderRow(container, items, { top10 = false } = {}){
  if (!container) return;
  container.innerHTML = (items || []).map((it, idx) => {
    const title = esc(it.title || it.name || '');
    const year = it.year || (it.release_date ? String(it.release_date).slice(0,4) : '');
    const poster = it.poster_path ? `${imgBase}${it.poster_path}` : '';
    const type = it.type || 'movie';
    const id = it.tmdb_id || it.id;

    return `
      <div class="row-card" data-id="${id}" data-type="${type}">
        ${top10 ? `<div class="rank-num">${idx+1}</div>` : ''}
        <img class="row-poster" src="${poster}" onerror="this.src='';this.style.background='#222'" />
        <div class="row-meta">
          <div class="row-title">${title}</div>
          <div class="row-sub">${year || ''}${type==='tv' ? ' · SERIE' : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.row-card').forEach(card => {
    card.addEventListener('click', () => openDetails(card.dataset.id, card.dataset.type));
  });
}

function wireRowButtons(){
  document.querySelectorAll('.row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.dataset.row;
      const dir = parseInt(btn.dataset.dir || '1', 10);
      const target = row === 'top' ? el('topRow') : (row === 'recent' ? el('recentRow') : null);
      if (!target) return;
      const amount = Math.floor(target.clientWidth * 0.85) * dir;
      target.scrollBy({ left: amount, behavior: 'smooth' });
    });
  });
}

// --- Data fetchers ---
async function fetchGenres(){
  const res = await fetch('/api/genres');
  const data = await res.json();
  const sel = el('genre');
  sel.innerHTML = '<option value="">Todos los géneros</option>' + data.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  prependTypeOptions();
}

// Minimal additions: prepend Películas/Series options
function prependTypeOptions(){
  const sel = el('genre');
  if (!sel) return;
  if ([...sel.options].some(o => o.value === 'TYPE_MOVIE')) return;
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
    const params = new URLSearchParams({ page: p, pageSize: state.pageSize });
    if (genreId) params.set('genre', genreId);
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

async function loadRecentRow(){
  const res = await fetch('/api/catalog?' + new URLSearchParams({ page: 1, pageSize: 30 }).toString());
  const data = await res.json();
  renderRow(el('recentRow'), data.items || []);
}

async function loadTopRow(){
  const top = getTopToday(10);
  const empty = el('topEmpty');
  const row = el('topRow');

  if (!top.length){
    if (row) row.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Fetch details for each (10 calls max). Keeps server simple.
  const items = await Promise.all(top.map(async (t) => {
    try{
      const r = await fetch(t.type === 'tv' ? `/api/tv/${t.id}` : `/api/movie/${t.id}`);
      const d = await r.json();
      return {
        id: d.id,
        tmdb_id: d.id,
        type: t.type,
        title: d.title,
        year: d.release_date ? String(d.release_date).slice(0,4) : '',
        poster_path: d.poster_path,
      };
    }catch(_){
      return { tmdb_id: t.id, id: t.id, type: t.type, title: `#${t.id}`, poster_path: null, year:'' };
    }
  }));

  renderRow(row, items, { top10: true });
}

async function loadExplore(){
  const pageInfo = el('pageInfo');
  const grid = el('grid');

  // Client-side paginated render from aggregated list (genre mode)
  if (state.clientGenreItems && Array.isArray(state.clientGenreItems)){
    const start = (state.page - 1) * state.pageSize;
    const end = start + state.pageSize;
    const slice = state.clientGenreItems.slice(start, end);

    grid.innerHTML = slice.map(item => `
      <div class="card" data-id="${item.tmdb_id}" data-type="${item.type||'movie'}">
        <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
        <div class="meta">
          <div class="title">${esc(item.title)}</div>
          <div class="year">${item.year || ''}</div>
        </div>
        ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
      </div>
    `).join('');

    grid.querySelectorAll('.card').forEach(elc => {
      elc.addEventListener('click', () => openDetails(elc.dataset.id, elc.dataset.type));
    });

    const totalPages = Math.max(1, Math.ceil(state.clientGenreItems.length / state.pageSize));
    if (pageInfo) pageInfo.textContent = `Página ${state.page} de ${totalPages} · ${state.clientGenreItems.length} resultados`;
    return;
  }

  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  if (state.q) params.set('q', state.q);
  if (state.actor) params.set('actor', state.actor);
  if (state.genre && state.genre !== 'TYPE_MOVIE' && state.genre !== 'TYPE_TV') params.set('genre', state.genre);

  const endpoint = (state.actor && !state.clientGenreItems)
    ? (function(){
        const p = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
        if (state.q) p.set('q', state.q);
        if (state.genre && state.genre !== 'TYPE_MOVIE' && state.genre !== 'TYPE_TV') p.set('genre', state.genre);
        return '/api/movies/by-actor?name=' + encodeURIComponent(state.actor) + '&' + p.toString();
      })()
    : (state.q && state.q.length > 0 ? '/api/catalog?' + params.toString()
       : (state.genre === 'TYPE_MOVIE' ? '/api/movies?' + params.toString()
          : (state.genre === 'TYPE_TV' ? '/api/series?' + params.toString() : '/api/catalog?' + params.toString())));

  const res = await fetch(endpoint);
  const data = await res.json();

  grid.innerHTML = (data.items || []).map(item => `
    <div class="card" data-id="${item.tmdb_id}" data-type="${item.type||'movie'}">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${esc(item.title)}</div>
        <div class="year">${item.year || ''}</div>
      </div>
      ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
    </div>
  `).join('');

  grid.querySelectorAll('.card').forEach(elc => {
    elc.addEventListener('click', () => openDetails(elc.dataset.id, elc.dataset.type));
  });

  if (pageInfo) pageInfo.textContent = `Página ${data.page || state.page}`;
}

// --- Modal details ---
async function openDetails(id, type){
  // Track view as soon as the user opens the ficha
  trackView(id, type);
  // Refresh Top row (fast enough)
  try{ loadTopRow(); }catch(_){ }

  const res = await fetch(type==='tv' ? `/api/tv/${id}` : `/api/movie/${id}`);
  const d = await res.json();

  el('modalTitle').textContent = `${(d.title||d.name||'')} ${d.release_date ? '('+String(d.release_date).slice(0,4)+')':''}`;
  const poster = el('modalPoster');
  poster.src = d.poster_path ? (imgBase + d.poster_path) : '';
  el('modalOverview').textContent = d.overview || 'Sin sinopsis disponible.';
  el('modalMeta').textContent = `${d.runtime ? d.runtime+' min · ':''}Puntuación TMDB: ${d.vote_average ?? '—'}`;
  el('modalGenres').innerHTML = (d.genres||[]).map(g => `<span class="badge">${esc(g.name)}</span>`).join('');
  el('modalCast').innerHTML = (d.cast||[]).map(p => `<span class="badge">${esc(p.name)}</span>`).join('');

  const link = el('watchLink');
  if (d.link) {
    const w = toWatchUrl(d.link);
    link.href = w || d.link;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }

  el('modal').classList.add('open');
}

function closeModal(){ el('modal').classList.remove('open'); }

// --- Events ---
function wireEvents(){
  el('closeModal').addEventListener('click', closeModal);
  el('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });

  const q = el('q');
  const actor = el('actor');
  const genre = el('genre');

  el('searchBtn').addEventListener('click', ()=>{
    state.page = 1;
    state.q = q.value.trim();
    state.actor = actor.value.trim();
    state.genre = genre.value;
    state.clientGenreItems = null;
    // Scroll to Explore on search
    try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
    loadExplore();
  });

  el('resetBtn').addEventListener('click', ()=>{
    state = { page:1, pageSize:24, q:'', actor:'', genre:'', clientGenreItems: null };
    q.value=''; actor.value=''; genre.value='';
    loadTopRow();
    loadRecentRow();
    loadExplore();
    try{ window.scrollTo({ top: 0, behavior:'smooth' }); }catch(_){ }
  });

  el('prev').addEventListener('click', ()=>{ if(state.page>1){ state.page--; loadExplore(); }});
  el('next').addEventListener('click', ()=>{ state.page++; loadExplore(); });

  // Genre change: keep previous smart behavior
  genre.addEventListener('change', async (e)=>{
    state.page = 1;
    const val = (e && e.target && e.target.value) || '';
    if (val === 'TYPE_MOVIE' || val === 'TYPE_TV'){
      state.clientGenreItems = null;
      state.genre = val;
    } else if (val){
      el('pageInfo').textContent = 'Cargando…';
      state.clientGenreItems = await fetchAllPagesWithOptionalFilters({ genreId: val });
      state.genre = val;
    } else {
      state.clientGenreItems = null;
      state.genre = '';
    }
    try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
    loadExplore();
  });

  // Enter-to-search helper
  function onEnter(e){
    if (e.key === 'Enter'){
      e.preventDefault();
      el('searchBtn').click();
    }
  }
  q.addEventListener('keydown', onEnter, { passive:false });
  actor.addEventListener('keydown', onEnter, { passive:false });

  wireRowButtons();
}

// --- Boot ---
(async function init(){
  await fetchGenres();
  wireEvents();
  await Promise.all([
    loadTopRow(),
    loadRecentRow(),
    loadExplore(),
  ]);
})();
