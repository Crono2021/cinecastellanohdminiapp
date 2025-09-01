
function pixeldrainDirectUrl(link){
  if (!link) return null;
  try{
    const u = new URL(link);
    const segs = u.pathname.split('/').filter(Boolean);
    let id = null;
    const idx = segs.findIndex(s => s==='u' || s==='d' || s==='file');
    if (idx >= 0 && segs[idx+1]) id = segs[idx+1];
    if (!id && segs.length) id = segs[segs.length-1];
    if (segs.includes('api') && segs.includes('file')) return link;
    if (!id) return null;
    return `https://pixeldrain.com/api/file/${id}?download`;
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
    const res = await fetch('/api/movies?' + params.toString());
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
          <div class="year">${item.year || ''}</div>
        </div>
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
    const endpoint = (state.actor && !state.clientGenreItems) ? '/api/movies/by-actor?name=' + encodeURIComponent(state.actor) + '&' + params.toString() : '/api/movies?' + params.toString();
  const res = await fetch(endpoint);
  const data = await res.json();

  grid.innerHTML = data.items.map(item => `
    <div class="card" data-id="${item.tmdb_id}">
      <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${item.title}</div>
        <div class="year">${item.year || ''}</div>
      </div>
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
  const playerWrap = document.getElementById('playerWrap');
  const pxVideo = document.getElementById('pxVideo');
  const playerNote = document.getElementById('playerNote');
  if (d.link) { link.href = d.link; link.style.display='inline-flex';
    const direct = pixeldrainDirectUrl(d.link);
    if (direct){ pxVideo.src = direct; playerWrap.style.display='block'; playerNote.style.display='none'; }
    else { playerWrap.style.display='none'; playerNote.style.display='block'; }
  } else { link.style.display='none'; playerWrap.style.display='none'; }
  document.getElementById('modal').classList.add('open');
}

function closeModal(){ document.getElementById('modal').classList.remove('open'); const v=document.getElementById('pxVideo'); if(v){ v.pause(); v.removeAttribute('src'); v.load(); } }

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
  state.genre = e.target.value || '';
  if (state.genre){
    // Build the aggregated list across all pages
    document.getElementById('pageInfo').textContent = 'Cargando…';
    state.clientGenreItems = await fetchAllPagesForGenre(state.genre);
  } else {
    state.clientGenreItems = null;
  }
  load();
});
fetchGenres().then(load);


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
