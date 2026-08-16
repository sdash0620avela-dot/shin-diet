const CACHE='shin-diet-v19-9-iphone-install-guide';
const APP_SHELL=['./index.html','./manifest.json','./icon.svg','./supabase-config.js','./assets/ai-coach-sprite.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll({type:'window'})).then(clients=>clients.forEach(client=>client.postMessage({type:'APP_UPDATED',version:'19.9'})))));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
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
