
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
    try{
      const btn = document.getElementById('typeToggle');
      if (!btn) return;
      const t = getType();
      // When showing movies, the button invites to switch to series
      btn.textContent = (t === 'movie') ? 'Series' : 'Películas';
    }catch(_){}
  }

  // Intercept fetch to inject &type=
  const origFetch = window.fetch;
  window.fetch = function(input, init){
    try{
      let url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (/\/api\/catalog(\?|$)/.test(url)){
        const t = getType();
        if (typeof input === 'string'){
          const u = new URL(url, location.origin);
          // Avoid overwriting if already present
          if (!u.searchParams.has('type')){
            u.searchParams.set('type', t);
            input = u.pathname + u.search;
          }
        }else if (input && input.url){
          const u = new URL(input.url, location.origin);
          if (!u.searchParams.has('type')){
            u.searchParams.set('type', getType());
            const newUrl = u.pathname + u.search;
            // Clone the Request while keeping init
            input = new Request(newUrl, input);
          }
        }
      }
    }catch(_){ /* ignore */ }
    return origFetch.apply(this, [input, init]);
  };

  // Wire up the toggle button
  function setup(){
    const btn = document.getElementById('typeToggle');
    if (btn){
      btn.addEventListener('click', () => {
        const next = (getType() === 'movie') ? 'tv' : 'movie';
        setType(next);
        // Trigger a reload via the existing search button or load()
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn && searchBtn.click) searchBtn.click();
        else if (typeof window.load === 'function') window.load();
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
