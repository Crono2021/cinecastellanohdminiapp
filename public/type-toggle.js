
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

  // Intercept fetch ONLY for /api/catalog to filter items client-side
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    const isString = (typeof input === 'string');
    const url = isString ? input : (input && input.url) || '';
    const isCatalog = typeof url === 'string' && /\/api\/catalog(\?|$)/.test(url);

    const p = origFetch(input, init);
    if (!isCatalog) return p;

    return p.then(async (resp) => {
      try{
        const clone = resp.clone();
        const data = await clone.json();
        if (!data || !Array.isArray(data.items)) return resp;

        const t = getType();
        let filtered;
        if (t === 'tv'){
          filtered = data.items.filter(it => it && it.type === 'tv');
        }else{
          // movie mode: keep items that are not TV; tolerate missing type
          filtered = data.items.filter(it => it && it.type !== 'tv');
        }

        const newData = { ...data, items: filtered, total: (typeof data.total==='number' ? data.total : filtered.length) };
        const body = JSON.stringify(newData);
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }catch(_){
        return resp;
      }
    });
  };

  function setup(){
    const btn = document.getElementById('typeToggle');
    if (btn){
      btn.addEventListener('click', () => {
        const next = (getType() === 'movie') ? 'tv' : 'movie';
        setType(next);
        // Trigger a refresh via the existing search button or load()
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
