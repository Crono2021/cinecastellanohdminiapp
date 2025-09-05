
(function(){
  const STORAGE_KEY = 'cc_hd_currentType';
  const valid = ['movie','tv'];
  function getType(){ const t = localStorage.getItem(STORAGE_KEY) || 'movie'; return valid.includes(t) ? t : 'movie'; }
  function setType(t){ if (valid.includes(t)) localStorage.setItem(STORAGE_KEY, t); updateButton(); }
  function updateButton(){
    const btn = document.getElementById('typeToggle');
    if (btn) btn.textContent = (getType()==='movie') ? 'Series' : 'Películas';
  }
  function setup(){
    const btn = document.getElementById('typeToggle');
    if (btn){
      btn.addEventListener('click', ()=>{ setType(getType()==='movie'?'tv':'movie'); if (typeof window.load==='function') window.load(); else { const b=document.getElementById('searchBtn'); if (b&&b.click) b.click(); } });
      updateButton();
    }
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
