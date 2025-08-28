const imgBase = 'https://image.tmdb.org/t/p/w342';

let state = {
  page: 1,
  pageSize: 24,
  q: '',
  actor: '',
  genre: '',
  year: '',
  allItems: [],
  totalPages: 1,
  totalFiltered: 0
};

function populateYears(){
  const sel = document.getElementById('yearSelect');
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Todos los años';
  sel.appendChild(optAll);
  const current = new Date().getFullYear();
  for (let y = current; y >= 1850; y--) {
    const o = document.createElement('option');
    o.value = String(y);
    o.textContent = y;
    sel.appendChild(o);
  }
}

async function fetchGenres(){
  try{
    const res = await fetch('/api/genres');
    if(!res.ok) return;
    const data = await res.json();
    const sel = document.getElementById('genre');
    sel.innerHTML =
      '<option value=\"\">Todos los géneros</option>' +
      data.map(g => `<option value=\"${g.id}\">${g.name}</option>`).join('');
  }catch(_){ /* ignore */ }
}

function sortItems(items){
  return items.slice().sort((a, b) => {
    const ay = a.year ?? 0;
    const by = b.year ?? 0;
    if (by !== ay) return by - ay;
    return (a.title || '').localeCompare(b.title || '');
  });
}

function renderSlice(items){
  const grid = document.getElementById('grid');
  grid.innerHTML = items.map(item => `
    <div class=\"card\" data-id=\"${item.tmdb_id}\">
      <div class=\"card-media\">
        <img class=\"poster\" src=\"${imgBase}${item.poster_path || ''}\"
             onerror=\"this.src='';this.style.background='#222'\" />
        ${item.link ? `<a class=\"play\" href=\"${item.link}\" target=\"_blank\"
             onclick=\"event.stopPropagation()\" title=\"Reproducir\">▶</a>` : ""}
      </div>
      <div class=\"meta\">
        <div class=\"title\">${item.title || ''}</div>
        <div class=\"year\">${item.year || ''}</div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetails(el.dataset.id));
  });

  document.getElementById('pageInfo').textContent =
    `Página ${state.page} de ${state.totalPages} · ${state.totalFiltered} películas`;
}

function applyClientFiltersAndRender(){
  let items = state.allItems || [];
  if (state.year && /^\\d{4}$/.test(state.year)) {
    items = items.filter(it => String(it.year || '') === state.year);
  }
  items = sortItems(items);
  state.totalFiltered = items.length;
  state.totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
  if (state.page > state.totalPages) state.page = state.totalPages;
  const start = (state.page - 1) * state.pageSize;
  const slice = items.slice(start, start + state.pageSize);
  renderSlice(slice);
}

async function fetchAllPages(){
  const base = new URLSearchParams();
  if (state.q) base.set('q', state.q);
  if (state.actor) base.set('actor', state.actor);
  if (state.genre) base.set('genre', state.genre);

  let page = 1;
  const pageSize = state.pageSize;
  let total = 0, pages = 1;
  const all = [];

  const p1 = new URLSearchParams(base);
  p1.set('page', String(page));
  p1.set('pageSize', String(pageSize));
  const res1 = await fetch('/api/movies?' + p1.toString());
  if (!res1.ok) throw new Error('No se pudo cargar el catálogo');
  const d1 = await res1.json();
  total = d1.total || (d1.items?.length || 0);
  all.push(...(d1.items || []));
  pages = Math.max(1, Math.ceil(total / pageSize));

  while (page < pages) {
    page += 1;
    const p = new URLSearchParams(base);
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    const res = await fetch('/api/movies?' + p.toString());
    if (!res.ok) break;
    const dat = await res.json();
    all.push(...(dat.items || []));
  }

  state.allItems = all;
}

async function loadGlobal(){
  try {
    await fetchAllPages();
    applyClientFiltersAndRender();
  } catch (e) {
    document.getElementById('grid').innerHTML = '<div class=\"mute\">Error cargando catálogo.</div>';
  }
}

async function openDetails(id){
  const res = await fetch(`/api/movie/${id}`);
  const d = await res.json();
  document.getElementById('modalTitle').textContent =
    `${d.title} ${d.release_date ? '('+d.release_date.slice(0,4)+')':''}`;
  const poster = document.getElementById('modalPoster');
  poster.src = d.poster_path ? (imgBase + d.poster_path) : '';
  document.getElementById('modalOverview').textContent = d.overview || 'Sin sinopsis disponible.';
  document.getElementById('modalMeta').textContent =
    `${d.runtime ? d.runtime+' min · ' : ''}Puntuación TMDB: ${d.vote_average ?? '—'}`;
  document.getElementById('modalGenres').innerHTML =
    (d.genres||[]).map(g => `<span class=\"badge\">${g.name}</span>`).join('');
  document.getElementById('modalCast').innerHTML =
    (d.cast||[]).map(p => `<span class=\"badge\">${p.name}</span>`).join('');
  const link = document.getElementById('watchLink');
  if (d.link) { link.href = d.link; link.style.display = 'inline-flex'; }
  else { link.style.display = 'none'; }
  document.getElementById('modal').classList.add('open');
}

function closeModal(){ document.getElementById('modal').classList.remove('open'); }
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', (e)=>{
  if (e.target.id === 'modal') closeModal();
});

const q = document.getElementById('q');
const actor = document.getElementById('actor');
const genre = document.getElementById('genre');
const yearSelect = document.getElementById('yearSelect');

document.getElementById('searchBtn').addEventListener('click', async ()=>{
  state.page = 1;
  state.q = q.value.trim();
  state.actor = actor.value.trim();
  state.genre = genre.value;
  await loadGlobal();          // recargar todo según q/actor/genre
  state.year = yearSelect.value;
  applyClientFiltersAndRender();
});
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  state = { page:1, pageSize:24, q:'', actor:'', genre:'', year:'', allItems:[], totalPages:1, totalFiltered:0 };
  q.value=''; actor.value=''; genre.value=''; yearSelect.value='';
  await loadGlobal();
});
yearSelect.addEventListener('change', ()=>{
  state.page = 1;
  state.year = yearSelect.value;
  applyClientFiltersAndRender(); // no recarga del server, solo re-filtrar orden global
});
document.getElementById('prev').addEventListener('click', ()=>{
  if (state.page > 1) { state.page--; applyClientFiltersAndRender(); }
});
document.getElementById('next').addEventListener('click', ()=>{
  if (state.page < state.totalPages) { state.page++; applyClientFiltersAndRender(); }
});

populateYears();
fetchGenres().then(loadGlobal);
