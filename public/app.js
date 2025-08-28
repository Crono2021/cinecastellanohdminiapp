const imgBase = 'https://image.tmdb.org/t/p/w342';

let state = {
  q: '',
  actor: '',
  genre: '',
  year: '',
  allItems: [],
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

function render(){
  let items = state.allItems || [];
  if (state.year && /^\\d{4}$/.test(state.year)) {
    items = items.filter(it => String(it.year || '') === state.year);
  }
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

  const info = document.getElementById('info');
  info.textContent = `${items.length} película(s) mostradas` + (state.year ? ` · año ${state.year}` : '');
}

async function fetchAllItems(){
  const base = new URLSearchParams();
  if (state.q) base.set('q', state.q);
  if (state.actor) base.set('actor', state.actor);
  if (state.genre) base.set('genre', state.genre);

  const pageSize = 60;
  let page = 1;
  const all = [];

  while (true) {
    const p = new URLSearchParams(base);
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    const res = await fetch('/api/movies?' + p.toString());
    if (!res.ok) break;
    const dat = await res.json();
    const items = dat.items || [];
    all.push(...items);
    if (items.length < pageSize) break;
    page += 1;
    if (page > 200) break;
  }

  state.allItems = all;
}

async function loadAllAndRender(){
  try {
    await fetchAllItems();
    render();
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
  state.q = q.value.trim();
  state.actor = actor.value.trim();
  state.genre = genre.value;
  await loadAllAndRender();
  state.year = yearSelect.value;
  render();
});
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  state = { q:'', actor:'', genre:'', year:'', allItems:[] };
  q.value=''; actor.value=''; genre.value=''; yearSelect.value='';
  await loadAllAndRender();
});
yearSelect.addEventListener('change', ()=>{
  state.year = yearSelect.value;
  render();
});

populateYears();
fetchGenres().then(loadAllAndRender);
