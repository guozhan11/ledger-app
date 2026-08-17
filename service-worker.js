const CACHE_NAME='ledger-shell-v14';
const BASE_URL=new URL('./',self.location.href);
// The HTML is deliberately absent: it carries the whole app, so a cached copy
// silently pins every deploy behind. Only static assets that change with a new
// filename are worth holding on to.
const APP_SHELL=[
  new URL('app/manifest.webmanifest',BASE_URL).href,
  new URL('app/icon-180.png',BASE_URL).href,
  new URL('app/icon-192.png',BASE_URL).href,
  new URL('app/icon-512.png',BASE_URL).href,
];

function isCacheable(response){
  if(!response || !response.ok || response.type!=='basic') return false;
  // Never hold HTML, whatever asked for it. Requests for '/' can arrive without
  // navigate mode (manifest start_url checks, prefetches), and one cached copy
  // is enough to pin the app on an old deploy.
  if(response.headers.get('Content-Type')?.includes('text/html')) return false;
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
  // Navigations go straight to the network, with no cache to fall back on, so a
  // deploy is always what loads. Offline shows the browser's own error page.
  if(request.mode==='navigate' || request.destination==='document') return;
  event.respondWith(caches.match(request).then((cached)=>cached||fetch(request).then((response)=>{
    if(isCacheable(response)){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy)));
    }
    return response;
  })));
});
