function getToken(){ return localStorage.getItem('cchd_admin_token') || ''; }
function setToken(v){ localStorage.setItem('cchd_admin_token', v); }

function getContentType(){
  const el = document.querySelector('input[name="contentType"]:checked');
  return el ? el.value : 'movie';
}

function refreshBulkBoxes(){
  const t = getContentType();
  const tvBox = document.getElementById('bulkTv')?.closest('.box');
  const movieBox = document.getElementById('bulk')?.closest('.box');
  if (tvBox) tvBox.style.display = (t === 'tv') ? '' : 'none';
  if (movieBox) movieBox.style.display = (t === 'movie') ? '' : 'none';
}


const tokenInput = document.getElementById('token');
tokenInput.value = getToken();
document.getElementById('saveToken').onclick = ()=>{ setToken(tokenInput.value.trim()); alert('Token guardado'); };

document.querySelectorAll('input[name="contentType"]').forEach(r => {
  r.addEventListener('change', refreshBulkBoxes);
});
refreshBulkBoxes();

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
    const r = await post('/api/admin/add', { title, year: year?parseInt(year):undefined, link, type: getContentType() });
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
    const r = await post('/api/admin/add', { tmdbId, link, type: getContentType() });
    out.textContent = `OK · ${r.title} (${r.year}) – TMDB ${r.tmdb_id}`;
  }catch(e){ out.textContent = 'Error: ' + e.message; }
};

document.getElementById('doBulk').onclick = async ()=>{
  const text = document.getElementById('bulk').value;
  const out = document.getElementById('bulkOut');
  out.textContent = 'Importando...';
  try{
    const r = await post('/api/admin/bulkImport', { text, type: getContentType() });
    out.textContent = `Importadas: ${r.imported}. Errores: ${r.errors.length}`;
    console.log(r);
  }catch(e){ out.textContent = 'Error: ' + e.message; }
};

// Import TV (Titulo (año) | Payload)
(function(){
  const btn = document.getElementById('doBulkTv');
  if (!btn) return;
  btn.onclick = async ()=>{
    const text = document.getElementById('bulkTv').value;
    const out = document.getElementById('bulkTvOut');
    out.textContent = 'Importando series...';
    try{
      const r = await post('/api/admin/bulkImport', { text, type: 'tv' });
      out.textContent = `Importadas: ${r.imported}. Errores: ${r.errors.length}`;
      console.log(r);
    }catch(e){
      out.textContent = 'Error: ' + e.message;
    }
  };
})();

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
    const r = await post('/api/admin/delete', {  title, year: year || null, type: getContentType() });
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
      const r = await post('/api/admin/deleteById', {  tmdb_id: id, type: getContentType() });
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
