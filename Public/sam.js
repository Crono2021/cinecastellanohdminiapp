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
