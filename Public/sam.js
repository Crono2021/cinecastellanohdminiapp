function getToken(){ return localStorage.getItem('cchd_sam_token') || ''; }
function setToken(v){ localStorage.setItem('cchd_sam_token', v); }

const tokenInput = document.getElementById('token');
if (tokenInput) tokenInput.value = getToken();

document.getElementById('saveToken').onclick = ()=>{
  setToken((tokenInput?.value || '').trim());
  alert('Token guardado');
};

async function post(url, body){
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken(),
    },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const e = await res.json().catch(()=>({error:'Error desconocido'}));
    throw new Error(e.error || ('HTTP '+res.status));
  }
  return res.json();
}

(function(){
  const btn = document.getElementById('doBulkTv');
  if (!btn) return;
  btn.onclick = async ()=>{
    const text = document.getElementById('bulkTv').value;
    const out = document.getElementById('bulkTvOut');
    out.textContent = 'Importando series...';
    try{
      const r = await post('/api/sam/bulkImport', { text });
      out.textContent = `Importadas: ${r.imported}. Errores: ${r.errors.length}`;
      console.log(r);
    }catch(e){
      out.textContent = 'Error: ' + e.message;
    }
  };
})();



async function samDeleteSeries(title, year){
  const token = getToken();
  const r = await fetch('/api/sam/deleteSeries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ title, year })
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(j?.error || ('HTTP ' + r.status));
  return j;
}

const delBtn = document.getElementById('doDeleteTv');
if (delBtn){
  delBtn.onclick = async ()=>{
    const out = document.getElementById('deleteOut');
    const title = (document.getElementById('delTitle')?.value || '').trim();
    const yearStr = (document.getElementById('delYear')?.value || '').trim();
    const year = parseInt(yearStr, 10);

    if (!title || !yearStr || !Number.isFinite(year)){
      if (out) out.textContent = 'Pon título y año válidos.';
      return;
    }

    if (!confirm(`¿Borrar la serie "${title}" (${year})?`)) return;

    try{
      if (out) out.textContent = 'Borrando...';
      const res = await samDeleteSeries(title, year);
      if (out) out.textContent = res.deleted ? `OK: borrada (${res.deleted}).` : 'No se encontró ninguna serie con ese título y año.';
    }catch(e){
      if (out) out.textContent = 'Error: ' + (e?.message || e);
    }
  };
}
