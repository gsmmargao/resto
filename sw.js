const CACHE_NAME = 'resto-pos-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/assets/css/output.css',
  '/assets/js/app.js',
  '/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Do NOT intercept API calls (Supabase, Print, etc.) or non-GET requests
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET requests for JS/HTML/CSS
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(async () => {
        // Offline fallback
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        // If not in cache, return a valid empty Response so SW doesn't crash
        return new Response('', { status: 404, statusText: 'Offline and not cached' });
      })
  );
});