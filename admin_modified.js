
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

window.onpopstate = function(event) {
    if (window.location.hash === "#ficha") {
        window.history.pushState(null, "", "#menu");
        showMenu();
    }
};

function showMenu() {
    document.getElementById('menu').style.display = 'block';
    document.getElementById('ficha').style.display = 'none';
}

function goBackToMenu() {
    window.history.pushState(null, "", "#menu");
    showMenu();
}

function goToFicha() {
    window.history.pushState(null, "", "#ficha");
    document.getElementById('ficha').style.display = 'block';
    document.getElementById('menu').style.display = 'none';
}
