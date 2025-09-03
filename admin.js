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

document.getElementById('importCatalog').onclick = async () => {
  const fileInput = document.getElementById('jsonFile');
  const file = fileInput.files[0];
  if (!file) {
    alert('Por favor, selecciona un archivo JSON.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const jsonContent = JSON.parse(reader.result);
    try {
      const res = await post('/api/admin/importCatalog', { json: jsonContent });
      document.getElementById('importStatus').textContent = 'Catálogo importado con éxito';
    } catch (e) {
      document.getElementById('importStatus').textContent = 'Error al importar el catálogo: ' + e.message;
    }
  };
  reader.readAsText(file);
};
