/* eslint-disable */
const imgBase = 'https://image.tmdb.org/t/p/w342';

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// State
const state = {
  q: '',
  page: 1,
  pageSize: 24,
  totalPages: 1,
  current: { id: null }
};

async function fetchSeries(){
  const grid = el('grid');
  const pageInfo = el('pageInfo');
  if (pageInfo) pageInfo.textContent = 'Cargando…';
  if (grid) grid.innerHTML = '';

  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.q) params.set('q', state.q);

  const res = await fetch('/api/series?' + params.toString());
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();

  const items = (data.items || []).map(it => ({
    tmdb_id: it.tmdb_id,
    title: it.title,
    year: it.year,
    poster_path: it.poster_path
  }));

  const total = Number(data.total || 0);
  state.totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(1, Number(data.page || state.page)), state.totalPages);

  if (pageInfo){
    pageInfo.textContent = `Página ${state.page} de ${state.totalPages} · ${total} series`;
  }

  if (!grid) return;
  grid.innerHTML = items.map(item => `
    <div class="card" data-id="${item.tmdb_id}">
      <img class="poster" src="${item.poster_path ? (imgBase + item.poster_path) : ''}" onerror="this.src='';this.style.background='#222'" />
      <div class="meta">
        <div class="title">${esc(item.title)}</div>
        <div class="year">${item.year || ''}</div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openDetails(card.dataset.id));
  });
}

async function trackView(id){
  try{
    await fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb_id: Number(id), type: 'tv' })
    });
  }catch(_){ }
}

async function openDetails(id){
  state.current.id = String(id);

  const res = await fetch('/api/tv/' + encodeURIComponent(String(id)));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();

  const year = d.release_date ? String(d.release_date).slice(0,4) : '';
  el('modalTitle').textContent = `${(d.title||d.name||'')}${year ? ' ('+year+')' : ''}`;
  const poster = el('modalPoster');
  poster.src = d.poster_path ? (imgBase + d.poster_path) : '';
  el('modalOverview').textContent = d.overview || 'Sin sinopsis disponible.';
  el('modalMeta').textContent = `Puntuación TMDB: ${d.vote_average ?? '—'}`;
  el('modalGenres').innerHTML = (d.genres||[]).map(g => `<span class="badge">${esc(g.name)}</span>`).join('');
  el('modalCast').innerHTML = (d.cast||[]).map(p => `<span class="badge">${esc(p.name)}</span>`).join('');

  const link = el('watchLink');
  if (d.link) {
    link.href = d.link;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }

  el('modal').classList.add('open');
}

function closeModal(){ el('modal').classList.remove('open'); }

function wire(){
  el('closeModal').addEventListener('click', closeModal);
  el('modal').addEventListener('click', (e)=>{ if(e.target && e.target.id==='modal') closeModal(); });

  el('searchBtn').addEventListener('click', async ()=>{
    state.q = String(el('q')?.value || '').trim();
    state.page = 1;
    await safeLoad();
  });
  el('resetBtn').addEventListener('click', async ()=>{
    el('q').value = '';
    state.q = '';
    state.page = 1;
    await safeLoad();
  });

  el('prev').addEventListener('click', async ()=>{
    if (state.page <= 1) return;
    state.page -= 1;
    await safeLoad();
  });
  el('next').addEventListener('click', async ()=>{
    if (state.page >= state.totalPages) return;
    state.page += 1;
    await safeLoad();
  });

  // Track views only when pressing "Reproducir"
  el('watchLink').addEventListener('click', ()=>{
    if (state.current.id) trackView(state.current.id);
  });
}

async function safeLoad(){
  try{ await fetchSeries(); }
  catch(e){
    console.error(e);
    const pageInfo = el('pageInfo');
    if (pageInfo) pageInfo.textContent = 'Error cargando el catálogo de series';
  }
}

wire();
safeLoad();
