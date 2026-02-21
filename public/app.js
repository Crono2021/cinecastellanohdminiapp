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
// "random" is used for the Home explore grid so users see new titles every time.
let state = { page: 1, pageSize: 30, q: '', actor: '', genre: '', letter: '', random: true, view: 'home' };
state.genres = [];
state.clientGenreItems = null; // legacy (no longer used)
state.totalPages = 1;

// Auth state
let auth = { user: null };

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

async function fetchBestApp(limit = 10){
  const p = new URLSearchParams({ limit: String(limit) });
  const r = await fetch('/api/app-top-rated?' + p.toString());
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

// --- UI helpers ---

function showToast(message, kind = 'success'){
  const host = el('toastHost');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  const icon = kind === 'error' ? '⚠' : (kind === 'success' ? '✓' : 'ℹ');
  t.innerHTML = `<span class="ticon">${icon}</span><span class="tmsg">${esc(message)}</span>`;
  host.innerHTML = '';
  host.appendChild(t);
  // next tick for animation
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(showToast.__t);
  showToast.__t = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
  }, 2200);
}

async function markPendingWatched(tmdbId){
  if (!auth.user){ openAuth(); return; }
  try{
    await apiJson('/api/pending/' + encodeURIComponent(tmdbId), { method:'DELETE' });
    showToast('Marcada como vista');
    if (state.view === 'pending') loadExplore();
  }catch(_){ }
}

async function removeFavoriteFromList(tmdbId){
  if (!auth.user){ openAuth(); return; }
  try{
    await apiJson('/api/favorites/' + encodeURIComponent(tmdbId), { method:'DELETE' });
    showToast('Quitada de favoritos');
    if (state.view === 'favorites') loadExplore();
  }catch(_){ }
}

async function removeRatingFromList(tmdbId){
  if (!auth.user){ openAuth(); return; }
  try{
    await apiJson('/api/ratings/' + encodeURIComponent(tmdbId), { method:'DELETE' });
    showToast('Valoración eliminada');
    if (state.view === 'myratings'){
      loadExplore();
      // Actualiza también el carrusel global de mejor valoradas
      try{ loadBestAppRow(); }catch(_){ }
    }
  }catch(_){ }
}

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function apiJson(url, opts){
  const r = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw Object.assign(new Error(j?.error || 'API_ERROR'), { status: r.status, payload: j });
  return j;
}

async function refreshMe(){
  try{
    const j = await apiJson('/api/auth/me');
    auth.user = j?.user || null;
  }catch(_){ auth.user = null; }
  syncAuthUi();
}

function syncAuthUi(){
  const loginBtn = el('authBtn');
  const menuBtn = el('userMenuBtn');
  if (auth.user){
    if (loginBtn) loginBtn.style.display = 'none';
    if (menuBtn){
      menuBtn.style.display = '';
      menuBtn.textContent = `Menú personal (${auth.user.username})`;
    }
  } else {
    if (loginBtn){
      loginBtn.style.display = '';
      loginBtn.textContent = 'Login';
    }
    if (menuBtn) menuBtn.style.display = 'none';
  }
}


// --- User menu (Menú personal) ---
function buildUserMenu(){
  const menu = el('userMenu');
  if (!menu) return;
  menu.innerHTML = [
    `<button class="menu-item" type="button" data-action="myratings" role="menuitem">Mis valoraciones</button>`,
    `<button class="menu-item" type="button" data-action="recommended" role="menuitem">Recomendado para ti</button>`,
    `<button class="menu-item" type="button" data-action="favorites" role="menuitem">Favoritos</button>`,
    `<button class="menu-item" type="button" data-action="pending" role="menuitem">Pendientes</button>`,
    `<div class="menu-divider"></div>`,
    `<button class="menu-item" type="button" data-action="logout" role="menuitem">Salir</button>`
  ].join('');
}

function closeUserMenu(){
  const menu = el('userMenu');
  const btn = el('userMenuBtn');
  if (!menu || !btn) return;
  menu.classList.remove('open');
  btn.setAttribute('aria-expanded','false');
}
function toggleUserMenu(){
  const menu = el('userMenu');
  const btn = el('userMenuBtn');
  if (!menu || !btn) return;
  const open = !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

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
      const target = row === 'top' ? el('topRow') : (row === 'bestapp' ? el('bestAppRow') : (row === 'premieres' ? el('premieresRow') : (row === 'recent' ? el('recentRow') : null)));
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

async function loadBestAppRow(){
  const row = el('bestAppRow');
  const empty = el('bestAppEmpty');
  if (!row) return;
  try{
    const items = await fetchBestApp(10);
    if (!items.length){
      row.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    renderRow(row, items, { top10: false });
  }catch(_){
    row.innerHTML = '';
    if (empty) empty.style.display = '';
  }
}


// --- Collections ---
function openCollectionsModal(title, html){
  const m = el('collectionsModal');
  const t = el('collectionsTitle');
  const b = el('collectionsBody');
  if (t) t.textContent = title || 'Colecciones';
  if (b) b.innerHTML = html || '';
  if (m) m.classList.add('open');
}
function closeCollectionsModal(){
  const m = el('collectionsModal');
  if (m) m.classList.remove('open');
}

async function fileToSmallWebpDataUrl(file){
  // Requirements: optional image, max 320x180, WEBP, <= 40KB (approx)
  const maxW = 320, maxH = 180;
  const blob = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
  const img = blob;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxW / w, maxH / h);
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // Try a couple of qualities to keep small
  const qualities = [0.75, 0.6, 0.5, 0.4];
  for (const q of qualities){
    const dataUrl = canvas.toDataURL('image/webp', q);
    // Rough base64 size check
    const b64 = dataUrl.split(',')[1] || '';
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes <= 40000) return dataUrl;
  }
  // last resort
  return canvas.toDataURL('image/webp', 0.35);
}

async function loadCollections(){
  const grid = el('grid');
  const pageInfo = el('pageInfo');
  if (!grid) return;

  const res = await fetch('/api/collections');
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items || []);

  const canCreate = !!auth.user;
  const head = `
    <div class="collections-head">
      <div class="collections-title">Colecciones</div>
      ${canCreate ? `<button id="createCollectionBtn">Crear colección</button>` : `<small class="mute">Regístrate para crear colecciones</small>`}
    </div>
  `;

  const cards = items.map(c => {
    const cover = c.cover_image || '';
    const img = cover ? `<img class="collection-cover" src="${cover}" />` : `<div class="collection-cover placeholder"></div>`;
    return `
      <div class="collection-card" data-id="${c.id}">
        ${img}
        <div class="collection-meta">
          <div class="collection-name">${esc(c.name)}</div>
          <div class="collection-user">por ${esc(c.username || '')}</div>
          <div class="collection-count">${Number(c.items_count||0)} películas</div>
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = head + `<div class="collections-grid">${cards || '<div class="mute">Aún no hay colecciones.</div>'}</div>`;
  if (pageInfo) pageInfo.textContent = 'Colecciones';

  const btn = el('createCollectionBtn');
  if (btn){
    btn.addEventListener('click', () => openCreateCollectionFlow());
  }

  grid.querySelectorAll('.collection-card').forEach(card => {
    card.addEventListener('click', async ()=>{
      const id = card.dataset.id;
      try{
        const d = await apiJson('/api/collections/' + encodeURIComponent(id), { method:'GET', headers:{} });
        const list = (d.items || []).map(it => `
          <div class="col-item" data-id="${it.tmdb_id}">
            <img class="col-item-poster" src="${imgBase}${it.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
            <div class="col-item-text">
              <div class="col-item-title">${esc(it.title)}</div>
              <div class="mute">${it.year || ''}</div>
            </div>
          </div>
        `).join('');
        openCollectionsModal(d.name, `
          <div class="col-modal-meta"><small class="mute">por ${esc(d.username || '')} · ${Number(d.items_count||0)} películas</small></div>
          <div class="col-items">${list || '<div class="mute">Colección vacía.</div>'}</div>
        `);
        const body = el('collectionsBody');
        body?.querySelectorAll?.('.col-item')?.forEach(row=>{
          row.addEventListener('click', ()=> openDetails(row.dataset.id, 'movie'));
        });
      }catch(_){
        showToast('No se pudo abrir la colección', 'error');
      }
    });
  });
}

function openCreateCollectionFlow(){
  if (!auth.user){ openAuth(); return; }

  // Step 1: name + optional image
  const modalHtml = `
    <div class="form-row">
      <label>Nombre de la colección</label>
      <input id="colNameInput" placeholder="Ej. Cine clásico" />
    </div>
    <div class="form-row">
      <label>Imagen (opcional)</label>
      <div class="inline">
        <input id="colImageFile" type="file" accept="image/*" />
        <small class="mute">Se convertirá a WEBP (máx. 320×180) para ocupar muy poco.</small>
      </div>
      <div id="colImagePreview" class="image-preview"></div>
    </div>
    <div class="modal-actions">
      <button id="colCancel1" class="ghost" type="button">Cancelar</button>
      <button id="colNext1" type="button">OK</button>
    </div>
  `;
  openCollectionsModal('Crear colección', modalHtml);

  let imageDataUrl = '';

  const fileInput = el('colImageFile');
  if (fileInput){
    fileInput.addEventListener('change', async ()=>{
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try{
        const dataUrl = await fileToSmallWebpDataUrl(f);
        imageDataUrl = dataUrl;
        const prev = el('colImagePreview');
        if (prev) prev.innerHTML = `<img src="${dataUrl}" alt="preview" />`;
      }catch(_){
        showToast('No se pudo procesar la imagen', 'error');
      }
    });
  }

  el('colCancel1')?.addEventListener('click', ()=> closeCollectionsModal());

  el('colNext1')?.addEventListener('click', ()=>{
    const name = (el('colNameInput')?.value || '').trim();
    if (!name || name.length < 2){
      showToast('Pon un nombre (mín. 2 caracteres)', 'error');
      return;
    }
    openPickMoviesStep(name, imageDataUrl);
  });
}

function openPickMoviesStep(colName, coverImage){
  const html = `
    <div class="form-row">
      <label>Añadir películas</label>
      <input id="colSearchInput" placeholder="Introduce el título de la película" />
      <div id="colSearchResults" class="search-results"></div>
      <div class="selected-box">
        <div class="selected-title">Seleccionadas:</div>
        <div id="colSelectedList" class="selected-list"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="colBack2" class="ghost" type="button">Atrás</button>
      <button id="colFinish2" type="button">Finalizar</button>
    </div>
  `;
  openCollectionsModal('Añadir películas', html);

  const selected = new Map(); // tmdb_id -> {title, year}
  const renderSelected = ()=>{
    const box = el('colSelectedList');
    if (!box) return;
    const arr = Array.from(selected.values());
    box.innerHTML = arr.length ? arr.map(it => `<span class="pill">${esc(it.title)}${it.year?` (${it.year})`:''}</span>`).join('') : `<span class="mute">Ninguna</span>`;
  };
  renderSelected();

  el('colBack2')?.addEventListener('click', ()=> openCreateCollectionFlow());

  // Live search (debounced)
  const input = el('colSearchInput');
  const results = el('colSearchResults');
  let t;
  async function doSearch(){
    const q = (input?.value || '').trim();
    if (!results) return;
    if (!q){
      results.innerHTML = '';
      return;
    }
    try{
      const r = await fetch('/api/movies/search-lite?q=' + encodeURIComponent(q) + '&limit=20');
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.items || []);
      results.innerHTML = list.map(it => {
        const inSel = selected.has(String(it.tmdb_id));
        return `
          <div class="result-row" data-id="${it.tmdb_id}" data-title="${esc(it.title)}" data-year="${it.year||''}">
            <div class="result-text">${esc(it.title)}${it.year?` (${it.year})`:''}</div>
            <div class="result-actions">
              <button class="iconbtn" data-action="add" title="Añadir">+</button>
              <button class="iconbtn" data-action="del" title="Eliminar">−</button>
            </div>
          </div>
        `;
      }).join('') || `<div class="mute">Sin resultados</div>`;
    }catch(_){
      results.innerHTML = `<div class="mute">Error buscando</div>`;
    }
  }
  if (input){
    input.addEventListener('input', ()=>{
      clearTimeout(t);
      t = setTimeout(doSearch, 120);
    });
  }

  if (results){
    results.addEventListener('click', (e)=>{
      const row = e.target?.closest?.('.result-row');
      if (!row) return;
      const id = String(row.dataset.id);
      const title = row.dataset.title || '';
      const year = row.dataset.year || '';
      const act = e.target?.closest?.('button')?.dataset?.action;
      if (act === 'add'){
        selected.set(id, { tmdb_id: Number(id), title, year });
        renderSelected();
      } else if (act === 'del'){
        selected.delete(id);
        renderSelected();
      }
    });
  }

  el('colFinish2')?.addEventListener('click', async ()=>{
    const items = Array.from(selected.values()).map(x => Number(x.tmdb_id));
    try{
      await apiJson('/api/collections', {
        method:'POST',
        body: JSON.stringify({ name: colName, cover_image: coverImage || null, items })
      });
      closeCollectionsModal();
      showToast('Colección creada');
      state.view = 'collections';
      loadExplore();
    }catch(err){
      const code = err?.payload?.error || 'ERROR';
      const map = {
        NAME_INVALID: 'Nombre inválido.',
        ITEMS_INVALID: 'Selecciona al menos una película.',
        IMAGE_TOO_LARGE: 'Imagen demasiado grande.',
        NO_AUTH: 'Necesitas estar logueado.'
      };
      showToast(map[code] || 'No se pudo crear la colección', 'error');
    }
  });

  // Trigger initial empty state
  doSearch();
}


async function loadExplore(){
  const pageInfo = el('pageInfo');
  const grid = el('grid');

  // Show/hide carousels depending on filters
  updateHomeVisibility();

  // Immediate feedback so the UI doesn't look "stuck"
  if (pageInfo) pageInfo.textContent = 'Cargando…';
  if (grid) grid.innerHTML = '';


  // Special view: Collections
  if (state.view === 'collections'){
    updateHomeVisibility();
    try{
      await loadCollections();
      if (pageInfo) pageInfo.textContent = 'Colecciones';
    }catch(_){
      if (pageInfo) pageInfo.textContent = 'Error cargando colecciones';
    }
    return;
  }

  // Special views: Recommended / My Ratings / Pending / Favorites
  if (state.view === 'recommended' || state.view === 'myratings' || state.view === 'pending' || state.view === 'favorites'){
    updateHomeVisibility();
    const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize || 30) });
    const endpoint = state.view === 'recommended'
      ? ('/api/recommended?' + params.toString())
      : (state.view === 'myratings'
        ? ('/api/my-ratings?' + params.toString())
        : (state.view === 'pending'
          ? ('/api/pending?' + params.toString())
          : ('/api/favorites?' + params.toString())));
    try{
      const data = await apiJson(endpoint, { method:'GET', headers: {} });
      const items = data?.results || [];
      grid.innerHTML = items.map(item => {
        const extra = (state.view === 'myratings' && item.user_rating)
          ? `<div class="year">Tu nota: ${item.user_rating}/10</div>`
          : (state.view === 'pending'
            ? `<div class="year">Pendiente</div>`
            : (state.view === 'favorites'
              ? `<div class="year">Favorita</div>`
              : `<div class="year">${item.year || ''}</div>`));
        const actions = (state.view === 'pending')
          ? `<div class="card-actions"><button class="ghost" data-action="watched" data-id="${item.tmdb_id}">Marcar como vista</button></div>`
          : (state.view === 'favorites')
            ? `<div class="card-actions"><button class="ghost" data-action="unfav" data-id="${item.tmdb_id}">Quitar</button></div>`
            : (state.view === 'myratings')
              ? `<div class="card-actions"><button class="ghost" data-action="delrating" data-id="${item.tmdb_id}">Eliminar</button></div>`
              : '';
        return `
          <div class="card" data-id="${item.tmdb_id}" data-type="movie">
            <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
            <div class="meta">
              <div class="title">${esc(item.title)}</div>
              ${extra}
            </div>
            ${actions}
          </div>
        `;
      }).join('');

      // Click handling (open ficha vs marcar como vista)
      grid.querySelectorAll('.card').forEach(elc => {
        elc.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[data-action="watched"]');
          if (btn){
            e.preventDefault();
            e.stopPropagation();
            markPendingWatched(btn.dataset.id);
            return;
          }
          const btn2 = e.target?.closest?.('button[data-action="unfav"]');
          if (btn2){
            e.preventDefault();
            e.stopPropagation();
            removeFavoriteFromList(btn2.dataset.id);
            return;
          }
          const btn3 = e.target?.closest?.('button[data-action="delrating"]');
          if (btn3){
            e.preventDefault();
            e.stopPropagation();
            removeRatingFromList(btn3.dataset.id);
            return;
          }
          openDetails(elc.dataset.id, 'movie');
        });
      });
      state.totalPages = Math.max(1, Number(data.totalPages) || 1);
      if (pageInfo){
        const label = state.view === 'recommended'
          ? 'Recomendado para ti'
          : (state.view === 'myratings'
            ? 'Mis valoraciones'
            : (state.view === 'pending'
              ? 'Pendientes'
              : 'Favoritos'));
        pageInfo.textContent = `${label} · Página ${state.page} de ${state.totalPages} · ${Number(data.totalResults||0)} resultados`;
      }
    }catch(e){
      if (pageInfo) pageInfo.textContent = 'Error cargando la lista';
    }
    return;
  }

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

  // Home: show random movies by default so the grid always feels fresh
  const isHomeNoFilters = !state.q && !state.actor && !state.genre && !state.letter;
  if (isHomeNoFilters && state.random){
    params.set('random', '1');
  }

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
  // In the main explore grid we don't show per-card action buttons.
  const actions = '';
  grid.innerHTML = movies.map(item => `
    <div class="card" data-id="${item.tmdb_id}" data-type="movie">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${esc(item.title)}</div>
        <div class="year">${item.year || ''}</div>
      </div>
      ${actions}
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
  // "Todas" clears the letter filter and returns to the general catalog.
  const letters = [''];
  // # bucket for titles that start with numbers/symbols
  letters.push('#');
  for (let i=65;i<=90;i++) letters.push(String.fromCharCode(i));
  menu.innerHTML = letters.map(ch => {
    const label = ch === '' ? 'Todas' : ch;
    return `<button class="letter-item" type="button" data-letter="${ch}" role="menuitem">${label}</button>`;
  }).join('');
}

function setLetterFilter(letter){
  const btn = el('letterFilterBtn');
  state.letter = String(letter || '').trim();
  state.page = 1;
  state.pageSize = 30;
  state.view = 'home';
  // If user picks "Todas", return to Home-style explore (random titles)
  state.random = state.letter ? false : true;
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

function updateHomeVisibility(){
  const hasFilter = !!(state.genre || state.letter || state.q || state.actor);
  const show = !hasFilter && (state.view === 'home');
  const top = el('rowTop');
  const best = el('rowBestApp');
  const prem = el('rowPremieres');
  const rec = el('rowRecent');
  if (top) top.style.display = show ? '' : 'none';
  if (best) best.style.display = show ? '' : 'none';
  if (prem) prem.style.display = show ? '' : 'none';
  if (rec) rec.style.display = show ? '' : 'none';
}

async function refreshPendingInModal(tmdbId){
  const box = el('pendingBox');
  const btn = el('pendingToggleBtn');
  if (!box || !btn) return;
  if (!auth.user){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  try{
    const j = await apiJson('/api/pending/' + encodeURIComponent(tmdbId));
    const isPending = !!j?.pending;
    btn.dataset.pending = isPending ? '1' : '0';
    btn.classList.toggle('active', isPending);
    // Icon only
    const icon = el('pendingIcon');
    if (icon) icon.textContent = '🕒';
  }catch(_){
    btn.dataset.pending = '0';
    btn.classList.remove('active');
    const icon = el('pendingIcon');
    if (icon) icon.textContent = '🕒';
  }
}

async function togglePendingFromModal(){
  if (!auth.user){ openAuth(); return; }
  const id = currentDetail?.id;
  if (!id) return;
  const btn = el('pendingToggleBtn');
  const isPending = btn && btn.dataset.pending === '1';
  try{
    if (isPending){
      await apiJson('/api/pending/' + encodeURIComponent(id), { method:'DELETE' });
      showToast('Quitada de pendientes');
    } else {
      await apiJson('/api/pending', { method:'POST', body: JSON.stringify({ tmdb_id: Number(id) }) });
      showToast('Añadida a pendientes');
    }
    await refreshPendingInModal(id);
  }catch(_){ }
}

async function refreshFavoriteInModal(tmdbId){
  const box = el('favoriteBox');
  const btn = el('favoriteToggleBtn');
  if (!box || !btn) return;
  if (!auth.user){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  try{
    const j = await apiJson('/api/favorites/' + encodeURIComponent(tmdbId));
    const isFav = !!j?.favorite;
    btn.dataset.favorite = isFav ? '1' : '0';
    btn.classList.toggle('active', isFav);
    const icon = el('favoriteIcon');
    if (icon) icon.textContent = '❤';
  }catch(_){
    btn.dataset.favorite = '0';
    btn.classList.remove('active');
    const icon = el('favoriteIcon');
    if (icon) icon.textContent = '❤';
  }
}

async function toggleFavoriteFromModal(){
  if (!auth.user){ openAuth(); return; }
  const id = currentDetail?.id;
  if (!id) return;
  const btn = el('favoriteToggleBtn');
  const isFav = btn && btn.dataset.favorite === '1';
  try{
    if (isFav){
      await apiJson('/api/favorites/' + encodeURIComponent(id), { method:'DELETE' });
      showToast('Quitada de favoritos');
    } else {
      await apiJson('/api/favorites', { method:'POST', body: JSON.stringify({ tmdb_id: Number(id) }) });
      showToast('Añadida a favoritos');
    }
    await refreshFavoriteInModal(id);
  }catch(_){ }
}

function renderStars(current){
  const starRow = el('starRow');
  if (!starRow) return;
  starRow.innerHTML = '';
  for (let i=1;i<=10;i++){
    const b = document.createElement('button');
    b.className = 'star' + (i <= (current||0) ? ' active' : '');
    b.type = 'button';
    b.textContent = '★';
    b.dataset.val = String(i);
    starRow.appendChild(b);
  }
}

async function loadUserRatingIntoModal(tmdbId){
  const box = el('userRatingBox');
  const hint = el('ratingHint');
  if (!box) return;
  if (!auth.user){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  hint.textContent = 'Pulsa una estrella para valorar del 1 al 10.';
  let current = 0;
  try{
    const j = await apiJson(`/api/ratings/${tmdbId}`);
    current = j?.rating || 0;
  }catch(_){ }
  renderStars(current);
  const starRow = el('starRow');
  if (starRow && !starRow.__bound){
    starRow.__bound = true;
    starRow.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.('.star');
      if (!btn) return;
      const val = Number(btn.dataset.val);
      if (!Number.isFinite(val)) return;
      try{
        await apiJson('/api/ratings', { method:'POST', body: JSON.stringify({ tmdb_id: Number(currentDetail.id), rating: val }) });
        renderStars(val);
        if (hint) hint.textContent = `Guardado: ${val}/10`;
      }catch(err){
        if (hint) hint.textContent = 'No se pudo guardar. Inicia sesión otra vez.';
      }
    });
  }
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

  // Load user rating widget (if logged)
  try{ await loadUserRatingIntoModal(Number(id)); }catch(_){ }

  // Load pending button state (if logged)
  try{ await refreshPendingInModal(Number(id)); }catch(_){ }

  // Load favorite button state (if logged)
  try{ await refreshFavoriteInModal(Number(id)); }catch(_){ }
}

function closeModal(){ el('modal').classList.remove('open'); }

// --- Auth modal ---
let authMode = 'login';
function openAuth(){
  const m = el('authModal');
  if (!m) return;
  el('authMsg').textContent = '';
  setAuthMode(authMode);
  m.classList.add('open');
}
function closeAuth(){
  const m = el('authModal');
  if (!m) return;
  m.classList.remove('open');
}
function setAuthMode(mode){
  authMode = mode === 'register' ? 'register' : 'login';
  const t1 = el('tabLogin');
  const t2 = el('tabRegister');
  if (t1) t1.classList.toggle('active', authMode === 'login');
  if (t2) t2.classList.toggle('active', authMode === 'register');
  const btn = el('authSubmit');
  if (btn) btn.textContent = authMode === 'login' ? 'Login' : 'Crear cuenta';
  const pass = el('authPass');
  if (pass) pass.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}

// --- Events ---
function wireEvents(){
  el('closeModal').addEventListener('click', closeModal);
  const pt = el('pendingToggleBtn');
  if (pt && !pt.__bound){ pt.__bound = true; pt.addEventListener('click', (e)=>{ e.preventDefault(); togglePendingFromModal(); }); }
  const ft = el('favoriteToggleBtn');
  if (ft && !ft.__bound){ ft.__bound = true; ft.addEventListener('click', (e)=>{ e.preventDefault(); toggleFavoriteFromModal(); }); }
  el('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });

  // Auth modal events
  const closeA = el('closeAuth');
  const authModal = el('authModal');
  if (closeA) closeA.addEventListener('click', closeAuth);
  if (authModal) authModal.addEventListener('click', (e)=>{ if(e.target.id==='authModal') closeAuth(); });

// Collections modal events
const closeC = el('closeCollections');
const colModal = el('collectionsModal');
if (closeC) closeC.addEventListener('click', closeCollectionsModal);
if (colModal) colModal.addEventListener('click', (e)=>{ if(e.target.id==='collectionsModal') closeCollectionsModal(); });

  const tabLogin = el('tabLogin');
  const tabReg = el('tabRegister');
  if (tabLogin) tabLogin.addEventListener('click', ()=>setAuthMode('login'));
  if (tabReg) tabReg.addEventListener('click', ()=>setAuthMode('register'));
  const submit = el('authSubmit');
  if (submit){
    submit.addEventListener('click', async ()=>{
      const u = String(el('authUser')?.value || '').trim();
      const p = String(el('authPass')?.value || '');
      const msg = el('authMsg');
      if (!u || !p){ if(msg) msg.textContent = 'Escribe usuario y contraseña.'; return; }
      try{
        const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const j = await apiJson(endpoint, { method:'POST', body: JSON.stringify({ username: u, password: p }) });
        auth.user = j?.user || null;
        syncAuthUi();
        closeAuth();
        // Refresh rating widget if modal open
        if (el('modal')?.classList?.contains('open') && currentDetail?.id){
          try{ await loadUserRatingIntoModal(Number(currentDetail.id)); }catch(_){ }
          try{ await refreshPendingInModal(Number(currentDetail.id)); }catch(_){ }
          try{ await refreshFavoriteInModal(Number(currentDetail.id)); }catch(_){ }
        }
      }catch(err){
        const code = err?.payload?.error || 'ERROR';
        const map = {
          USERNAME_TAKEN: 'Ese usuario ya existe.',
          INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
          USERNAME_INVALID: 'Usuario inválido (3–20).',
          PASSWORD_INVALID: 'Contraseña inválida (mín. 6).'
        };
        if (msg) msg.textContent = map[code] || 'No se pudo acceder.';
      }
    });
  }

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
    state.random = false;
    state.pageSize = 30;
    state.view = 'home';
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
    state = { page:1, pageSize:30, q:'', actor:'', genre:'', letter:'', random: true, view:'home', clientGenreItems: null, totalPages: 1 };
    state.genres = keepGenres;
    q.value=''; actor.value='';
    if (genreBtn) genreBtn.textContent = 'Categorías';
    const lbtn = el('letterFilterBtn');
    if (lbtn) lbtn.textContent = 'Filtrar letra';
    loadTopRow();
    loadBestAppRow();
    loadRecentRow();
    loadExplore();
    try{ window.scrollTo({ top: 0, behavior:'smooth' }); }catch(_){ }
  });


  const collectionsBtn = el('collectionsBtn');
  if (collectionsBtn){
    collectionsBtn.addEventListener('click', ()=>{
      state.view = 'collections';
      state.page = 1;
      state.pageSize = 30;
      state.q = ''; state.actor=''; state.genre=''; state.letter='';
      state.random = false;
      state.totalPages = 1;
      updateHomeVisibility();
      try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
      loadExplore();
    });
  }

  // Auth + User menu  // Auth + User menu
  const authBtn = el('authBtn');
  const userMenuBtn = el('userMenuBtn');
  const userMenu = el('userMenu');
  buildUserMenu();

  if (authBtn){
    authBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      openAuth();
    });
  }

  if (userMenuBtn){
    userMenuBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      toggleUserMenu();
    });
  }

  if (userMenu){
    userMenu.addEventListener('click', async (e)=>{
      const item = e.target?.closest?.('.menu-item');
      if (!item) return;
      const act = item.dataset.action;
      closeUserMenu();
      if (act === 'myratings'){
        if (!auth.user){ openAuth(); return; }
        state.view = 'myratings';
        state.page = 1;
        state.pageSize = 30;
        state.q = ''; state.actor = ''; state.genre=''; state.letter='';
        state.random = false;
        try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
        loadExplore();
      } else if (act === 'recommended'){
        if (!auth.user){ openAuth(); return; }
        state.view = 'recommended';
        state.page = 1;
        state.pageSize = 30;
        state.q = ''; state.actor = ''; state.genre=''; state.letter='';
        state.random = false;
        try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
        loadExplore();
      } else if (act === 'pending'){
        if (!auth.user){ openAuth(); return; }
        state.view = 'pending';
        state.page = 1;
        state.pageSize = 30;
        state.q = ''; state.actor = ''; state.genre=''; state.letter='';
        state.random = false;
        try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
        loadExplore();
      } else if (act === 'favorites'){
        if (!auth.user){ openAuth(); return; }
        state.view = 'favorites';
        state.page = 1;
        state.pageSize = 30;
        state.q = ''; state.actor = ''; state.genre=''; state.letter='';
        state.random = false;
        try{ el('rowExplore').scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ }
        loadExplore();
      } else if (act === 'logout'){
        try{ await apiJson('/api/auth/logout', { method:'POST', body: '{}' }); }catch(_){ }
        auth.user = null;
        syncAuthUi();
        if (state.view !== 'home') el('resetBtn').click();
      }
    });
  }

  document.addEventListener('click', (e)=>{
    if (!userMenu || !userMenuBtn) return;
    if (userMenu.classList.contains('open') && !userMenu.contains(e.target) && !userMenuBtn.contains(e.target)) closeUserMenu();
  });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeUserMenu(); });

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
      state.pageSize = 30;
      state.letter = '';
      state.clientGenreItems = null;
      state.genre = val;
      state.random = val ? false : true;
      state.view = 'home';
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
  await refreshMe();
  await fetchGenres();
  wireEvents();
  enableDragScroll(el('topRow'));
  enableDragScroll(el('bestAppRow'));
  enableDragScroll(el('premieresRow'));
  enableDragScroll(el('recentRow'));
  await Promise.all([
    loadTopRow(),
    loadBestAppRow(),
    loadPremieresRow(),
    loadRecentRow(),
    loadExplore(),
  ]);
})();
