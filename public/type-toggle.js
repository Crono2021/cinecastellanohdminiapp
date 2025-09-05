
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

  // Intercept fetch to filter /api/catalog responses on the client
  const origFetch = window.fetch;
  window.fetch = function(input, init){
    const isString = (typeof input === 'string');
    const url = isString ? input : (input && input.url) || '';
    const isCatalog = /\/api\/catalog(\?|$)/.test(url);
    const t = getType();

    const p = origFetch.apply(this, [input, init]);
    if (!isCatalog) return p;

    return p.then(async (resp) => {
      try{
        // Clone response and read JSON
        const data = await resp.clone().json();
        if (Array.isArray(data.items)){
          const filtered = (t === 'tv') ? data.items.filter(it => it.type === 'tv')
                                        : data.items.filter(it => it.type !== 'tv');
          const newData = { ...data, items: filtered, total: filtered.length };
          const blob = new Blob([JSON.stringify(newData)], { type: 'application/json' });
          return new Response(blob, { status: 200, statusText: 'OK', headers: resp.headers });
        }
      }catch(_){ /* fallthrough, return original response */ }
      return resp;
    });
  };

  // Wire up the toggle button
  function setup(){
    const btn = document.getElementById('typeToggle');
    if (btn){
      btn.addEventListener('click', () => {
        const next = (getType() === 'movie') ? 'tv' : 'movie';
        setType(next);
        // Trigger refresh
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
