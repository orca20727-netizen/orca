// ORCA INSIGHT Service Worker - Offline Marine Caching
const CACHE_NAME = 'orca-insight-v1.4.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './data/satellites.json',
  './data/pfz_zones.json',
  './data/imbl_boundaries.json',
  './data/mpas.json',
  './data/harbours.json',
  './data/simulated_vessels.json',
  './data/bulletins.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('ORCA Service Worker: Pre-caching offline marine assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept anything but simple same-origin GETs. In particular:
  //  - The FastAPI backend lives on a different origin/port (see
  //    BACKEND_CONFIG in app.js), so its requests are cross-origin here
  //    anyway and this check is belt-and-suspenders.
  //  - POST/PUT/etc. (e.g. /api/advisory/synthesize) can't be cached by
  //    the Cache API at all, and must never be served stale.
  //  - GET calls under /api/ (health checks, any future live-data routes)
  //    carry live telemetry -- wave heights, PFZ rankings, advisory
  //    text -- that must never be replayed from cache once stale, so they
  //    always go straight to the network.
  const isSameOrigin = url.origin === self.location.origin;
  const isApiPath = url.pathname.startsWith('/api/');

  if (req.method !== 'GET' || !isSameOrigin || isApiPath) {
    event.respondWith(fetch(req));
    return;
  }

  // Stale-While-Revalidate for the static app shell + bundled offline
  // fallback data only.
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails (at sea), return cached response
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
