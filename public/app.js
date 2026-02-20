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
    return `https://${host}/api/file/${id}`;
  }catch(_){ return null; }
}

const imgBase = 'https://image.tmdb.org/t/p/w342';

// Explore state (grid)
let state = { page: 1, pageSize: 24, q: '', actor: '', genre: '', letter: '' };
state.genres = [];
state.clientGenreItems = null; // legacy (no longer used)
state.totalPages = 1;

// Current modal context (used to track "reproducir" as a real view)
let currentDetail = { id: null, type: 'movie' };

// --- "Más vistas hoy" (global, server-side) ---
function trackView(id, type){
  // Fire & forget (shared by all users)
  try{
    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb_id: Number(id), type: type || 'movie' })
    }).catch(()=>{});
  }catch(_){ }
}

async function fetchTopToday(limit = 10){
  const p = new URLSearchParams({ limit: String(limit) });
  const r = await fetch('/api/top?' + p.toString());
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

// --- UI helpers ---
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function renderRow(container, items, { top10 = false } = {}){
  if (!container) return;
  // Ocultamos series: solo mostramos películas
  const moviesOnly = (items || []).filter(it => (it?.type || 'movie') !== 'tv');
  container.innerHTML = moviesOnly.map((it, idx) => {
    const title = esc(it.title || it.name || '');
    const year = it.year || (it.release_date ? String(it.release_date).slice(0,4) : '');
    const poster = it.poster_path ? `${imgBase}${it.poster_path}` : '';
    const type = 'movie';
    const id = it.tmdb_id || it.id;

    return `
      <div class="row-card" data-id="${id}" data-type="${type}">
        ${top10 ? `<div class="rank-num">${idx+1}</div>` : ''}
        <img class="row-poster" src="${poster}" onerror="this.src='';this.style.background='#222'" />
        <div class="row-meta">
          <div class="row-title">${title}</div>
          <div class="row-sub">${year || ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // Avoid native image drag on desktop
  container.querySelectorAll('img').forEach(img => img.setAttribute('draggable','false'));

  // Click handling via event delegation (works even when the scroller is handling pointer events)
  if (!container.__rowClickBound){
    container.__rowClickBound = true;
    container.addEventListener('click', (e) => {
      if (container.__justDragged) return;
      const card = e.target?.closest?.('.row-card');
      if (!card || !container.contains(card)) return;
      openDetails(card.dataset.id, card.dataset.type);
    });
  }
}

function wireRowButtons(){
  document.querySelectorAll('.row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.dataset.row;
      const dir = parseInt(btn.dataset.dir || '1', 10);
      const target = row === 'top' ? el('topRow') : (row === 'premieres' ? el('premieresRow') : (row === 'recent' ? el('recentRow') : null));
      if (!target) return;
      const amount = Math.floor(target.clientWidth * 0.85) * dir;
      target.scrollBy({ left: amount, behavior: 'smooth' });
    });
  });
}

// Drag-to-scroll for horizontal rows (mouse + touch)
function enableDragScroll(scroller){
  if (!scroller) return;
  if (scroller.__dragBound) return;
  scroller.__dragBound = true;

  let isDown = false;
  let startX = 0;
  let startLeft = 0;
  let moved = 0;

  function onDown(e){
    // Only left click, but allow touch/pen
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    isDown = true;
    moved = 0;
    startX = e.clientX;
    startLeft = scroller.scrollLeft;
    scroller.classList.add('dragging');
  }

  function onMove(e){
    if (!isDown) return;
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    scroller.scrollLeft = startLeft - dx;
    if (moved > 6) e.preventDefault?.();
  }

  function onUp(){
    isDown = false;
    scroller.classList.remove('dragging');
    // If we dragged, avoid accidental clicks right after
    if (moved > 6){
      scroller.__justDragged = true;
      setTimeout(()=>{ scroller.__justDragged = false; }, 200);
    }
  }

  scroller.addEventListener('pointerdown', onDown, { passive: true });
  scroller.addEventListener('pointermove', onMove, { passive: false });
  scroller.addEventListener('pointerup', onUp, { passive: true });
  scroller.addEventListener('pointercancel', onUp, { passive: true });
  scroller.addEventListener('mouseleave', onUp, { passive: true });

  // Prevent image dragging ghost on desktop
  scroller.querySelectorAll('img').forEach(img => {
    img.setAttribute('draggable', 'false');
  });
}

// --- Data fetchers ---
async function fetchGenres(){
  const res = await fetch('/api/genres');
  const data = await res.json();
  state.genres = Array.isArray(data) ? data : [];
  buildGenreMenu();
}

function buildGenreMenu(){
  const menu = el('genreMenu');
  if (!menu) return;

  const items = [{ id: '', name: 'Todas las categorías' }, ...(state.genres || [])];
  menu.innerHTML = `
    <input id="genreSearch" class="menu-search" type="search" placeholder="Buscar categoría…" />
    <div class="menu-divider"></div>
    <div id="genreItems"></div>
  `;

  const itemsWrap = menu.querySelector('#genreItems');
  const search = menu.querySelector('#genreSearch');

  function render(filterText){
    const ft = String(filterText || '').trim().toLowerCase();
    const visible = items.filter(g => {
      if (!ft) return true;
      return String(g.name || '').toLowerCase().includes(ft);
    });
    itemsWrap.innerHTML = visible.map(g => {
      const active = String(state.genre || '') === String(g.id || '');
      return `<button type="button" class="menu-item ${active ? 'active' : ''}" data-genre="${esc(g.id)}" role="menuitem">${esc(g.name)}</button>`;
    }).join('');
  }

  render('');
  if (search){
    search.addEventListener('input', ()=> render(search.value));
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

async function loadPremieresRow(){
  const res = await fetch('/api/estrenos?' + new URLSearchParams({ limit: 30 }).toString());
  const data = await res.json();
  const movies = (data.items || []).filter(it => (it?.type || 'movie') !== 'tv');
  renderRow(el('premieresRow'), movies);
}

async function loadRecentRow(){
  const res = await fetch('/api/catalog?' + new URLSearchParams({ page: 1, pageSize: 30 }).toString());
  const data = await res.json();
  const movies = (data.items || []).filter(it => (it?.type || 'movie') !== 'tv');
  renderRow(el('recentRow'), movies);
}

async function loadTopRow(){
  // Pedimos más y luego filtramos para quedarnos SOLO con películas
  const topRaw = await fetchTopToday(50);
  const top = topRaw.filter(t => (t?.type || 'movie') !== 'tv').slice(0, 10);
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
      const id = t.id || t.tmdb_id;
      const type = 'movie';
      const r = await fetch(`/api/movie/${id}`);
      const d = await r.json();
      return {
        id: d.id,
        tmdb_id: d.id,
        type,
        title: d.title,
        year: d.release_date ? String(d.release_date).slice(0,4) : '',
        poster_path: d.poster_path,
      };
    }catch(_){
      const id = t.id || t.tmdb_id;
      return { tmdb_id: id, id, type: 'movie', title: `#${id}`, poster_path: null, year:'' };
    }
  }));

  renderRow(row, items, { top10: true });
}

async function loadExplore(){
  const pageInfo = el('pageInfo');
  const grid = el('grid');

  // Immediate feedback so the UI doesn't look "stuck"
  if (pageInfo) pageInfo.textContent = 'Cargando…';
  if (grid) grid.innerHTML = '';

  // Letter filter mode (server-side, alphabetic, 30 per page)
  if (state.letter){
    const params = new URLSearchParams({
      letter: state.letter,
      page: String(state.page),
      pageSize: String(state.pageSize || 30)
    });

    const res = await fetch('/api/catalog/by-letter?' + params.toString());
    const data = await res.json();

    const movies = (data.items || []).filter(item => (item?.type || 'movie') !== 'tv');
    grid.innerHTML = movies.map(item => `
      <div class="card" data-id="${item.tmdb_id}" data-type="movie">
        <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
        <div class="meta">
          <div class="title">${esc(item.title)}</div>
          <div class="year">${item.year || ''}</div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.card').forEach(elc => {
      elc.addEventListener('click', () => openDetails(elc.dataset.id, elc.dataset.type));
    });

    state.totalPages = Math.max(1, Number(data.totalPages) || 1);
    state.page = Math.min(Math.max(1, Number(data.page) || state.page), state.totalPages);
    if (pageInfo){
      const bucket = (data.letter || state.letter) === '#' ? '#' : (data.letter || state.letter);
      pageInfo.textContent = `Letra ${bucket} · Página ${state.page} de ${state.totalPages} · ${Number(data.total||0)} resultados`;
    }
    return;
  }

  // (legacy client-side genre mode removed: now server-side for correctness)

  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  if (state.q) params.set('q', state.q);
  if (state.actor) params.set('actor', state.actor);
  if (state.genre) params.set('genre', state.genre);

  const endpoint = (state.actor && !state.clientGenreItems)
    ? (function(){
        const p = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
        if (state.q) p.set('q', state.q);
        if (state.genre) p.set('genre', state.genre);
        return '/api/movies/by-actor?name=' + encodeURIComponent(state.actor) + '&' + p.toString();
      })()
    : (state.q && state.q.length > 0 ? '/api/catalog?' + params.toString()
       : '/api/movies?' + params.toString());

  let data;
  try{
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  }catch(e){
    if (pageInfo) pageInfo.textContent = 'Error cargando el catálogo';
    console.error(e);
    return;
  }

  const movies = (data.items || []).filter(item => (item?.type || 'movie') !== 'tv');
  grid.innerHTML = movies.map(item => `
    <div class="card" data-id="${item.tmdb_id}" data-type="movie">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${esc(item.title)}</div>
        <div class="year">${item.year || ''}</div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.card').forEach(elc => {
    elc.addEventListener('click', () => openDetails(elc.dataset.id, elc.dataset.type));
  });

  const total = Number(data.total || 0);
  const totalPages = Math.max(1, Number(data.totalPages) || Math.ceil(total / state.pageSize) || 1);
  state.totalPages = totalPages;
  state.page = Math.min(Math.max(1, Number(data.page) || state.page), totalPages);
  if (pageInfo){
    const parts = [];
    if (state.genre){
      const g = (state.genres || []).find(x => String(x.id) === String(state.genre));
      parts.push(g ? `Categoría: ${g.name}` : 'Categoría');
    }
    if (state.q) parts.push(`Búsqueda: “${state.q}”`);
    if (state.actor) parts.push(`Actor: ${state.actor}`);
    const prefix = parts.length ? (parts.join(' · ') + ' · ') : '';
    pageInfo.textContent = `${prefix}Página ${state.page} de ${totalPages} · ${total} resultados`;
  }
}

function buildLetterMenu(){
  const menu = el('letterMenu');
  if (!menu) return;
  const letters = ['#'];
  for (let i=65;i<=90;i++) letters.push(String.fromCharCode(i));
  menu.innerHTML = letters.map(ch => `<button class="letter-item" type="button" data-letter="${ch}" role="menuitem">${ch}</button>`).join('');
}

function setLetterFilter(letter){
  const btn = el('letterFilterBtn');
  state.letter = String(letter || '').trim();
  state.page = 1;
  state.pageSize = 30;
  state.q = '';
  state.actor = '';
  state.genre = '';
  state.clientGenreItems = null;
  const q = el('q');
  const actor = el('actor');
  if (q) q.value = '';
  if (actor) actor.value = '';
  const gbtn = el('genreBtn');
  if (gbtn) gbtn.textContent = 'Categorías';
  if (btn){
    btn.textContent = state.letter ? `Filtrar letra: ${state.letter}` : 'Filtrar letra';
  }
  // Visual active state in menu
  const menu = el('letterMenu');
  if (menu){
    menu.querySelectorAll('.letter-item').forEach(b => {
      b.classList.toggle('active', b.dataset.letter === state.letter);
    });
  }
  loadExplore();
}

// --- Modal details ---
async function openDetails(id, type){
  // Opening the ficha should NOT count as a view.
  // We only count a view when the user presses "Reproducir".
  // Esta app ahora muestra SOLO películas
  currentDetail = { id: String(id), type: 'movie' };

  const res = await fetch(`/api/movie/${id}`);
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

  // Count a "view" only when the user clicks "Reproducir"
  const watch = el('watchLink');
  if (watch && !watch.__trackBound){
    watch.__trackBound = true;
    watch.addEventListener('click', () => {
      if (!currentDetail?.id) return;
      trackView(currentDetail.id, 'movie');
      // Refresh the Top row shortly after the play is recorded
      setTimeout(() => { try{ loadTopRow(); }catch(_){ } }, 250);
    });
  }

  const q = el('q');
  const actor = el('actor');
  const genreBtn = el('genreBtn');
  const genreMenu = el('genreMenu');

  el('searchBtn').addEventListener('click', ()=>{
    state.page = 1;
    state.q = q.value.trim();
    state.actor = actor.value.trim();
    // state.genre is managed by the Categorías dropdown
    state.letter = '';
    state.pageSize = 24;
    state.clientGenreItems = null;
    state.totalPages = 1;
    const lbtn2 = el('letterFilterBtn');
    if (lbtn2) lbtn2.textContent = 'Filtrar letra';
    // Scroll to Explore on search
    try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
    loadExplore();
  });

  el('resetBtn').addEventListener('click', ()=>{
    const keepGenres = state.genres || [];
    state = { page:1, pageSize:24, q:'', actor:'', genre:'', letter:'', clientGenreItems: null, totalPages: 1 };
    state.genres = keepGenres;
    q.value=''; actor.value='';
    if (genreBtn) genreBtn.textContent = 'Categorías';
    const lbtn = el('letterFilterBtn');
    if (lbtn) lbtn.textContent = 'Filtrar letra';
    loadTopRow();
    loadRecentRow();
    loadExplore();
    try{ window.scrollTo({ top: 0, behavior:'smooth' }); }catch(_){ }
  });

  el('prev').addEventListener('click', ()=>{ if(state.page>1){ state.page--; loadExplore(); }});
  el('next').addEventListener('click', ()=>{
    if (state.totalPages && Number.isFinite(state.totalPages) && state.totalPages !== 9999){
      if (state.page >= state.totalPages) return;
    }
    state.page++;
    loadExplore();
  });

  // Letter filter UI
  buildLetterMenu();
  const lbtn = el('letterFilterBtn');
  const lmenu = el('letterMenu');
  function closeLetterMenu(){
    if (!lmenu || !lbtn) return;
    lmenu.classList.remove('open');
    lbtn.setAttribute('aria-expanded', 'false');
  }
  function toggleLetterMenu(){
    if (!lmenu || !lbtn) return;
    const open = !lmenu.classList.contains('open');
    lmenu.classList.toggle('open', open);
    lbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (lbtn){
    lbtn.addEventListener('click', (e)=>{
      e.preventDefault();
      toggleLetterMenu();
    });
  }
  if (lmenu){
    lmenu.addEventListener('click', (e)=>{
      const b = e.target?.closest?.('.letter-item');
      if (!b) return;
      setLetterFilter(b.dataset.letter);
      closeLetterMenu();
      try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
    });
  }
  document.addEventListener('click', (e)=>{
    if (!lmenu || !lbtn) return;
    if (lmenu.classList.contains('open') && !lmenu.contains(e.target) && !lbtn.contains(e.target)) closeLetterMenu();
  });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeLetterMenu(); });

  // Categorías dropdown (TMDB genres)
  function closeGenreMenu(){
    if (!genreMenu || !genreBtn) return;
    genreMenu.classList.remove('open');
    genreBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleGenreMenu(){
    if (!genreMenu || !genreBtn) return;
    const open = !genreMenu.classList.contains('open');
    genreMenu.classList.toggle('open', open);
    genreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open){
      const s = genreMenu.querySelector('#genreSearch');
      setTimeout(()=>{ try{ s && s.focus(); }catch(_){ } }, 0);
    }
  }
  if (genreBtn){
    genreBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggleGenreMenu(); });
  }
  if (genreMenu){
    genreMenu.addEventListener('click', (e)=>{
      const b = e.target?.closest?.('.menu-item');
      if (!b) return;
      const val = b.dataset.genre || '';
      state.page = 1;
      state.pageSize = 24;
      state.letter = '';
      state.clientGenreItems = null;
      state.genre = val;
      const g = (state.genres || []).find(x => String(x.id) === String(val));
      if (genreBtn) genreBtn.textContent = val ? `Categorías: ${g ? g.name : 'Seleccionada'}` : 'Categorías';
      const lbtn3 = el('letterFilterBtn');
      if (lbtn3) lbtn3.textContent = 'Filtrar letra';
      closeGenreMenu();
      try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
      loadExplore();
    });
  }
  document.addEventListener('click', (e)=>{
    if (!genreMenu || !genreBtn) return;
    if (genreMenu.classList.contains('open') && !genreMenu.contains(e.target) && !genreBtn.contains(e.target)) closeGenreMenu();
  });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeGenreMenu(); });

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
  enableDragScroll(el('topRow'));
  enableDragScroll(el('premieresRow'));
  enableDragScroll(el('recentRow'));
  await Promise.all([
    loadTopRow(),
    loadPremieresRow(),
    loadRecentRow(),
    loadExplore(),
  ]);
})();
