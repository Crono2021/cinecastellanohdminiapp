const imgBase = 'https://image.tmdb.org/t/p/w342';
let state = { page: 1, pageSize: 24, q: '', actor: '', genre: '', year: '' };

async function fetchGenres(){
  const res = await fetch('/api/genres');
  const data = await res.json();
  const sel = document.getElementById('genre');
  sel.innerHTML = '<option value="">Todos los géneros</option>' + data.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

async function load(){
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  if (state.q) params.set('q', state.q);
  if (state.actor) params.set('actor', state.actor);
  if (state.genre) params.set('genre', state.genre);
  if (state.year && /^\d{4}$/.test(state.year)) params.set('year', state.year);
  const res = await fetch('/api/movies?' + params.toString());
  const data = await res.json();

  const grid = document.getElementById('grid');
  grid.innerHTML = data.items.map(item => `
    <div class="card" data-id="${item.tmdb_id}">
      <div class="card-media">
        <img class="poster" src="${imgBase}${item.poster_path || ''}" onerror="this.src='';this.style.background='#222'" />
        ${item.link ? `<a class="play" href="${item.link}" target="_blank" onclick="event.stopPropagation()" title="Reproducir">▶</a>` : ""}
      </div>
      <div class="meta">
        <div class="title">${item.title}</div>
        <div class="year">${item.year || ''}</div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetails(el.dataset.id));
  });

  document.getElementById('pageInfo').textContent = `Página ${data.page}`;
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
const yearSelect = document.getElementById('yearSelect');

document.getElementById('searchBtn').addEventListener('click', ()=>{ state.page=1; state.q=q.value.trim(); state.actor=actor.value.trim(); state.genre=genre.value; state.year=yearSelect ? yearSelect.value : ''; load(); });
document.getElementById('resetBtn').addEventListener('click', ()=>{ state={ page:1, pageSize:24, q:'', actor:'', genre:''}; q.value=''; actor.value=''; genre.value=''; if(yearSelect) yearSelect.value=''; state.year=''; load(); });

document.getElementById('prev').addEventListener('click', ()=>{ if(state.page>1){ state.page--; load(); }});
document.getElementById('next').addEventListener('click', ()=>{ state.page++; load(); });

populateYears();
fetchGenres().then(load);