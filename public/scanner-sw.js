const CACHE = 'gate-scanner-v2';
const PRECACHE = ['/offline-scanner', '/manifest.webmanifest', '/scanner-icon-192.svg', '/scanner-icon-512.svg'];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => Promise.allSettled(PRECACHE.map(path => cache.add(path))))
));
self.addEventListener('activate', event => event.waitUntil(
  Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gate-scanner-') && key !== CACHE).map(key => caches.delete(key)))),
  ])
));
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  const scannerNavigation = request.mode === 'navigate' && (url.pathname.startsWith('/scan/') || url.pathname === '/offline-scanner');
  if (!scannerNavigation && url.origin !== location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && (scannerNavigation || request.destination === 'script' || request.destination === 'style' || request.destination === 'font')) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => undefined));
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || (scannerNavigation ? caches.match('/offline-scanner') : Response.error()))));
});
