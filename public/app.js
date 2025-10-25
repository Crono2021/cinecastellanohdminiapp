
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

// --- Telegram helpers (public posts only) ---
function parseTelegramPost(link){
  try{
    if(!link) return null;
    const u = new URL(link);
    const host = (u.hostname||'').replace(/^www\./,'');
    if (host !== 't.me') return null;
    const segs = (u.pathname||'').split('/').filter(Boolean);
    // Format: /<channel>/<postId>
    if (segs.length >= 2 && /^\d+$/.test(segs[1])){
      return segs[0] + '/' + segs[1];
    }
    return null;
  }catch(_){ return null; }
}

function renderTelegramEmbed(container, tmeUrl){
  const post = parseTelegramPost(tmeUrl);
  if (!post) return false;
  container.innerHTML = '';
  const bq = document.createElement('blockquote');
  bq.className = 'telegram-post';
  bq.setAttribute('data-telegram-post', post);
  bq.setAttribute('data-width', '100%');

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://telegram.org/js/telegram-widget.js?22';
  s.setAttribute('data-telegram-post', post);
  s.setAttribute('data-width', '100%');

  container.appendChild(bq);
  container.appendChild(s);
  return true;
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
      <div class="card" data-id="${item.tmdb_id}" data-type="${item.type||'movie'}">
        
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
      el.addEventListener('click', () => openDetails(el.dataset.id, el.dataset.type));
    });

    const totalPages = Math.max(1, Math.ceil(state.clientGenreItems.length / state.pageSize));
    pageInfo.textContent = `Página ${state.page} de ${totalPages} · ${state.clientGenreItems.length} resultados`;
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

  grid.innerHTML = data.items.map(item => `
    <div class="card" data-id="${item.tmdb_id}" data-type="${item.type||'movie'}">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${item.title}</div>
        <div class="year">${item.year || ''} </div>
      </div>
    
      ${item.type === 'tv' ? '<span class="serie-badge">SERIE</span>' : ''}
    </div>
  `).join('');

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetails(el.dataset.id, el.dataset.type));
  });

  pageInfo.textContent = `Página ${data.page}`;
}

async function openDetails(id, type){
  const res = await fetch(type==='tv' ? `/api/tv/${id}` : `/api/movie/${id}`);
  const d = await res.json();
  document.getElementById('modalTitle').textContent = `${(d.title||d.name||'')} ${d.release_date ? '('+d.release_date.slice(0,4)+')':''}`;
  const poster = document.getElementById('modalPoster');
  poster.src = d.poster_path ? (imgBase + d.poster_path) : '';
  document.getElementById('modalOverview').textContent = d.overview || 'Sin sinopsis disponible.';
  document.getElementById('modalMeta').textContent = `${d.runtime ? d.runtime+' min · ':''}Puntuación TMDB: ${d.vote_average ?? '—'}`;
  document.getElementById('modalGenres').innerHTML = (d.genres||[]).map(g => `<span class="badge">${g.name}</span>`).join('');
  document.getElementById('modalCast').innerHTML = (d.cast||[]).map(p => `<span class="badge">${p.name}</span>`).join('');
  const link = document.getElementById('watchLink');
  const embed = document.getElementById('embedContainer');
  if (embed) embed.innerHTML = '';
  if (d.link) {
    // Telegram public post? render embed and disable external link
    if (parseTelegramPost(d.link)){
      link.style.display='none';
      if (embed) renderTelegramEmbed(embed, d.link);
    } else {
      const w = toWatchUrl(d.link);
      link.href = w || d.link;
      link.style.display='inline-flex';
    }
  } else {
    link.style.display='none';
    if (embed) embed.innerHTML = '';
  }
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


// React to genre changes immediately and query the full catalog via the API


document.getElementById('genre').addEventListener('change', async (e)=>{
  state.page = 1;
  const val = (e && e.target && e.target.value) || '';
  if (val === 'TYPE_MOVIE' || val === 'TYPE_TV'){
    const type = (val === 'TYPE_MOVIE') ? 'movie' : 'tv';
    state.clientGenreItems = null;
    state.genre = val;
  } else {
    // Comportamiento original para géneros TMDB
    document.getElementById('pageInfo').textContent = 'Cargando…';
    state.clientGenreItems = await fetchAllPagesForGenre(val);
    state.genre = val;
  }
  load();
});

fetchGenres().then(()=>{ try{ prependTypeOptions(); }catch(_){} load(); });


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

