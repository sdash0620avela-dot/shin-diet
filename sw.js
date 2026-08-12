const CACHE='shin-diet-v14-white-screen-recovery-1';
const APP_SHELL=['./index.html','./manifest.json','./icon.svg','./supabase-config.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{
      const type=r.headers.get('content-type')||'';
      if(r.ok&&type.includes('text/html')){
        const copy=r.clone(),text=await copy.text();
        if(text.includes('<body')&&text.includes('AI Diet'))caches.open(CACHE).then(c=>c.put('./index.html',r.clone()));
      }
      return r;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
