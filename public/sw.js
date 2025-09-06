
const CACHE = 'cine-static-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/back-handler.js'];
self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // Cache posters aggressively
  const isPoster = /image\.tmdb\.org\/t\/p\//.test(url.href);
  if (isPoster){
    e.respondWith(
      caches.open('posters-v1').then(async cache=>{
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request).then(resp=>{ cache.put(e.request, resp.clone()); return resp; }).catch(()=>null);
        return cached || fresh || fetch(e.request);
      })
    );
    return;
  }
  // App shell: stale-while-revalidate
  if (url.origin === location.origin){
    e.respondWith(
      caches.open(CACHE).then(async cache=>{
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request).then(resp=>{ cache.put(e.request, resp.clone()); return resp; }).catch(()=>null);
        return cached || fresh || fetch(e.request);
      })
    );
  }
});
