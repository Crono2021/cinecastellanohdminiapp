
(function(){
  const STORAGE_KEY = 'cc_hd_currentType';
  const valid = ['movie','tv'];

  function getType(){
    const t = localStorage.getItem(STORAGE_KEY) || 'movie';
    return valid.includes(t) ? t : 'movie';
  }
  function setType(t){
    if (!valid.includes(t)) return;
    localStorage.setItem(STORAGE_KEY, t);
    updateButton();
  }
  function updateButton(){
    const btn = document.getElementById('typeToggle');
    if (!btn) return;
    const t = getType();
    btn.textContent = (t === 'movie') ? 'Series' : 'Películas';
  }

  function setup(){
    const btn = document.getElementById('typeToggle');
    if (btn){
      btn.addEventListener('click', () => {
        const next = (getType() === 'movie') ? 'tv' : 'movie';
        setType(next);
        // Trigger reload
        if (typeof window.load === 'function') window.load();
        else { const searchBtn = document.getElementById('searchBtn'); if (searchBtn && searchBtn.click) searchBtn.click(); }
      });
      updateButton();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setup);
  }else{
    setup();
  }
})();
