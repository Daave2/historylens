const CACHE_NAME = 'historylens-static-v2';
const BASE_PATH = (() => {
  const path = new URL(self.registration.scope).pathname;
  return path.endsWith('/') ? path : `${path}/`;
})();

function withBase(path) {
  if (!path) return BASE_PATH;
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_PATH}${trimmed}`.replace(/\/{2,}/g, '/');
}

const APP_SHELL = [
  withBase('manifest.json'),
  withBase('favicon.svg')
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(withBase('index.html')) || caches.match(withBase('')))
    );
    return;
  }

  if (!/\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|json)$/i.test(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        return response;
      });
    })
  );
});
