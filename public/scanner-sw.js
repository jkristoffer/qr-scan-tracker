const CACHE = 'gate-scanner-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline-scanner', '/manifest.webmanifest', '/scanner-icon-192.svg', '/scanner-icon-512.svg']))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  const scannerNavigation = request.mode === 'navigate' && (url.pathname.startsWith('/scan/') || url.pathname === '/offline-scanner');
  if (!scannerNavigation && url.origin !== location.origin) return;
  event.respondWith(fetch(request).then(response => { if (response.ok && (scannerNavigation || request.destination === 'script' || request.destination === 'style' || request.destination === 'font')) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; }).catch(() => caches.match(request).then(cached => cached || (scannerNavigation ? caches.match('/offline-scanner') : Response.error()))));
});
