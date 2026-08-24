const CACHE='shin-diet-v20-1-realistic-average';
const APP_SHELL=['./index.html','./manifest.json','./icon.svg','./supabase-config.js','./assets/ai-coach-sprite.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll({type:'window'})).then(clients=>clients.forEach(client=>client.postMessage({type:'APP_UPDATED',version:'20.1'})))));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(caches.match('./index.html').then(cached=>cached||fetch(e.request,{cache:'no-store'})));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
