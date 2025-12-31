const CACHE_NAME = 'devocional-v8';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/index.tsx'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_URLS);
      })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strategy: Stale-While-Revalidate for external scripts (esm.sh, tailwind, google fonts)
  if (url.origin.includes('esm.sh') || 
      url.origin.includes('cdn.tailwindcss.com') ||
      url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
          return response || fetchPromise;
        });
      })
    );
    return;
  }

  // Strategy: Cache First for everything else (local assets)
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});