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


// Fallback: if server-side filtered sweep returns 0, sweep full catalog and filter by TMDB details client-side
async function fallbackCollectByDetails(genreId){
  const collected = [];
  const seen = new Set();

  // Discover catalog size & pageSize real del servidor
  const probeRes = await fetch('/api/movies?page=1&pageSize=1');
  if (!probeRes.ok) return collected;
  const probe = await probeRes.json();
  const total = Number(probe.total) || 0;
  const effPageSize = Number(probe.pageSize) || 24;
  const pages = Math.max(1, Math.ceil(total / effPageSize));

  // 1) Recolecta todos los items (solo id básicos) sin filtrar por género
  const allItems = [];
  for (let p=1; p<=pages; p++){
    const res = await fetch(`/api/movies?page=${p}&pageSize=${effPageSize}`);
    if (!res.ok) break;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const it of items){
      const id = it.tmdb_id ?? it.id ?? null;
      if (id && !seen.has(id)){ seen.add(id); allItems.push({ id, base: it }); }
    }
  }

  // 2) Trae detalles por lotes y filtra por genreId (TMDB)
  const batchSize = 8; // requests en paralelo
  for (let i=0; i<allItems.length; i+=batchSize){
    const batch = allItems.slice(i, i+batchSize);
    const promises = batch.map(({id}) => fetch(`/api/movie/${id}`).then(r=>r.ok?r.json():null).catch(()=>null));
    const detailsList = await Promise.all(promises);
    detailsList.forEach((d, idx) => {
      if (!d) return;
      const has = (d.genres||[]).some(g => String(g.id) === String(genreId));
      if (has){
        // reconstruir item mínimo para el grid
        collected.push({
          tmdb_id: d.id,
          title: d.title,
          year: d.release_date ? Number(String(d.release_date).slice(0,4)) : (d.year||''),
          poster_path: d.poster_path || '',
        });
      }
    });
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
  const res = await fetch('/api/movies?' + params.toString());
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
  if (d.link) { link.href = d.link; link.style.display='inline-flex'; }
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


// React to genre changes immediately and query the full catalog via the API

document.getElementById('genre').addEventListener('change', async (e)=>{
  state.page = 1;
  state.genre = e.target.value || '';
  if (state.genre){
    document.getElementById('pageInfo').textContent = 'Cargando…';
    // 1º intento: barrido con filtro del servidor (rápido)
    let items = await fetchAllPagesForGenre(state.genre);
    // Fallback si no hay resultados: barrido total + filtro por detalles TMDB en cliente
    if (!items || items.length === 0){
      items = await fallbackCollectByDetails(state.genre);
    }
    state.clientGenreItems = items;
  } else {
    state.clientGenreItems = null;
  }
  load();
});
fetchGenres().then(load);
