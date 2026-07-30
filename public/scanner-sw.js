const CACHE = 'gate-scanner-v2';
const OFFLINE_LAUNCHER = '/offline-scanner';
const OPTIONAL = ['/manifest.webmanifest', '/scanner-icon-192.svg', '/scanner-icon-512.svg'];

function launcherAssetPaths(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], location.origin);
    if (url.origin === location.origin && url.pathname.startsWith('/_next/static/')) {
      paths.add(`${url.pathname}${url.search}`);
    }
  }
  return [...paths];
}

async function cacheOfflineLauncher(cache) {
  const response = await fetch(OFFLINE_LAUNCHER, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Offline launcher request failed (${response.status})`);
  const assets = launcherAssetPaths(await response.clone().text());
  if (assets.length === 0) throw new Error('Offline launcher has no cacheable application assets');
  await cache.addAll(assets);
  await cache.put(OFFLINE_LAUNCHER, response);
}

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(async cache => {
    await cacheOfflineLauncher(cache);
    await Promise.allSettled(OPTIONAL.map(path => cache.add(path)));
  })
));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
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
