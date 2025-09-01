function getToken(){ return localStorage.getItem('cchd_admin_token') || ''; }
function setToken(v){ localStorage.setItem('cchd_admin_token', v); }

const tokenInput = document.getElementById('token');
tokenInput.value = getToken();
document.getElementById('saveToken').onclick = ()=>{ setToken(tokenInput.value.trim()); alert('Token guardado'); };

async function post(url, body){
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const e = await res.json().catch(()=>({error:'Error desconocido'}));
    throw new Error(e.error||('HTTP '+res.status));
  }
  return res.json();
}

document.getElementById('addOne').onclick = async ()=>{
  const title = document.getElementById('title').value.trim();
  const year = document.getElementById('year').value.trim();
  const link = document.getElementById('link').value.trim();
  const out = document.getElementById('oneOut');
  out.textContent = 'Añadiendo...';
  try{
    const r = await post('/api/admin/add', { title, year: year?parseInt(year):undefined, link });
    out.textContent = `OK · ${r.title} (${r.year}) – TMDB ${r.tmdb_id}`;
  }catch(e){ out.textContent = 'Error: ' + e.message; }
};

document.getElementById('addById').onclick = async ()=>{
  const tmdbId = parseInt(document.getElementById('tmdbId').value.trim());
  const link = document.getElementById('link').value.trim();
  const out = document.getElementById('oneOut');
  if (!tmdbId) return alert('TMDB ID requerido');
  if (!link) return alert('Link requerido');
  out.textContent = 'Añadiendo por ID...';
  try{
    const r = await post('/api/admin/add', { tmdbId, link });
    out.textContent = `OK · ${r.title} (${r.year}) – TMDB ${r.tmdb_id}`;
  }catch(e){ out.textContent = 'Error: ' + e.message; }
};

document.getElementById('doBulk').onclick = async ()=>{
  const text = document.getElementById('bulk').value;
  const out = document.getElementById('bulkOut');
  out.textContent = 'Importando...';
  try{
    const r = await post('/api/admin/bulkImport', { text });
    out.textContent = `Importadas: ${r.imported}. Errores: ${r.errors.length}`;
    console.log(r);
  }catch(e){ out.textContent = 'Error: ' + e.message; }
};

document.getElementById('exportBtn').onclick = async ()=>{
  const res = await fetch('/api/admin/export', { headers: { 'Authorization': 'Bearer '+getToken() }});
  if(!res.ok) return alert('Error exportando');
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cchd_export.json'; a.click();
  URL.revokeObjectURL(url);
};


document.getElementById('deleteBtn').onclick = async ()=>{
  const title = document.getElementById('delTitle').value.trim();
  const year = document.getElementById('delYear').value.trim();
  const out = document.getElementById('deleteOut');
  if (!title) { out.textContent = 'Escribe un título'; return; }
  out.textContent = 'Eliminando...';
  try{
    const r = await post('/api/admin/delete', { title, year: year || null });
    if (r.deleted > 0){
      out.textContent = `Eliminadas: ${r.deleted}. (${r.matches.map(m=>m.title + (m.year? ' ('+m.year+')':'' )).join(' · ')})`;
    }else{
      out.textContent = 'No se encontraron coincidencias';
    }
  }catch(e){
    out.textContent = 'Error: ' + e.message;
  }
};


/* Delete by TMDB ID */
(function(){
  const btn = document.getElementById('deleteByIdBtn');
  if (!btn) return;
  btn.onclick = async ()=>{
    const out = document.getElementById('deleteByIdOut');
    const input = document.getElementById('delIdInput');
    const raw = input ? input.value.trim() : '';
    const id = Number(raw);
    if (!raw || Number.isNaN(id)){ out.textContent = 'Introduce un TMDB ID válido'; return; }
    out.textContent = 'Eliminando...';
    try{
      const r = await post('/api/admin/deleteById', { tmdb_id: id });
      if (r.deleted > 0){
        const label = r.match ? (r.match.title + (r.match.year ? ' ('+r.match.year+')' : '')) : ('ID ' + id);
        out.textContent = `Eliminado: ${label}`;
      }else{
        out.textContent = 'No se encontró ninguna película con ese ID';
      }
    }catch(e){
      out.textContent = 'Error: ' + (e?.message || e);
    }
  };
})();



// ===== TV (Series) Admin =====
document.getElementById('addOneTv')?.addEventListener('click', async ()=>{
  const title = document.getElementById('tvTitle').value.trim();
  const year = document.getElementById('tvYear').value.trim();
  const link = document.getElementById('tvLink').value.trim();
  const out = document.getElementById('tvOneOut');
  if (!link) return alert('Link requerido');
  out.textContent = 'Añadiendo serie...';
  try {
    const r = await post('/api/admin/tv/add', { title, year, link });
    out.textContent = `OK · ${r.title} (${r.year || 's/f'}) – TMDB ${r.tmdb_id}`;
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
});

document.getElementById('addTvById')?.addEventListener('click', async ()=>{
  const tmdbId = parseInt(document.getElementById('tvTmdbId').value.trim());
  const link = document.getElementById('tvLink').value.trim();
  const out = document.getElementById('tvOneOut');
  if (!tmdbId) return alert('TMDB ID requerido');
  if (!link) return alert('Link requerido');
  out.textContent = 'Añadiendo serie por ID...';
  try{
    const r = await post('/api/admin/tv/addById', { tmdbId, link });
    out.textContent = `OK · ${r.title} (${r.year || 's/f'}) – TMDB ${r.tmdb_id}`;
  }catch(e){ out.textContent = 'Error: ' + e.message; }
});

document.getElementById('deleteTvByIdBtn')?.addEventListener('click', async ()=>{
  const tmdbId = parseInt(document.getElementById('delTvIdInput').value.trim());
  const out = document.getElementById('deleteTvByIdOut');
  if (!tmdbId) return alert('TMDB ID requerido');
  out.textContent = 'Eliminando...';
  try{
    await post('/api/admin/tv/deleteById', { tmdbId });
    out.textContent = `Eliminada · TMDB ${tmdbId}`;
  }catch(e){ out.textContent = 'Error: ' + e.message; }
});
