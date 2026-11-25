const CACHE='shin-diet-v22-3-prompt-first';
const SUPABASE_LIB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const APP_SHELL=['./index.html','./manifest.json','./icon.svg','./supabase-config.js','./workout-engine.js','./workout-ui.js','./science/evidence.json','./assets/ai-coach-niece-anime-v2.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL).then(()=>c.add(SUPABASE_LIB).catch(()=>{}))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll({type:'window'})).then(clients=>clients.forEach(client=>client.postMessage({type:'APP_UPDATED',version:'22.3'})))));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(url.href===SUPABASE_LIB){
    // クラウド接続ライブラリは通信できる時は最新、オフライン時は保存版を使う
    e.respondWith(fetch(e.request).then(res=>{if(res&&(res.ok||res.type==='opaque')){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return res}).catch(()=>caches.match(e.request)));
    return;
  }
  if(url.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(caches.match('./index.html').then(cached=>cached||fetch(e.request,{cache:'no-store'})));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
