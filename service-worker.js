const CACHE_NAME='ledger-shell-v5';
const BASE_URL=new URL('./',self.location.href);
const INDEX_URL=new URL('index.html',BASE_URL).href;
const APP_SHELL=[
  INDEX_URL,
  new URL('app/manifest.webmanifest',BASE_URL).href,
  new URL('app/icon-180.png',BASE_URL).href,
  new URL('app/icon-192.png',BASE_URL).href,
  new URL('app/icon-512.png',BASE_URL).href,
];

function isCacheable(response){
  if(!response || !response.ok || response.type!=='basic') return false;
  try{ return new URL(response.url).origin===self.location.origin; }
  catch{ return false; }
}

self.addEventListener('install',(event)=>{
  const requests=APP_SHELL.map((url)=>new Request(url,{cache:'reload'}));
  event.waitUntil(caches.open(CACHE_NAME).then((cache)=>Promise.allSettled(requests.map(async(request)=>{
    const response=await fetch(request);
    if(isCacheable(response)) await cache.put(request,response);
  }))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',(event)=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then((response)=>{
      if(isCacheable(response) && response.headers.get('Content-Type')?.includes('text/html')){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache)=>cache.put(INDEX_URL,copy)));
      }
      return response;
    }).catch(async()=>await caches.match(INDEX_URL)||new Response('Ledger is offline. Reconnect once to finish loading the app.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  event.respondWith(caches.match(request).then((cached)=>cached||fetch(request).then((response)=>{
    if(isCacheable(response)){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy)));
    }
    return response;
  })));
});
