const CACHE_PREFIX = 'historylens';
const CACHE_VERSION = 'v3';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${CACHE_VERSION}`;

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
  withBase(''),
  withBase('index.html'),
  withBase('manifest.json'),
  withBase('favicon.svg')
];

const ASSET_RE = /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/i;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== ASSET_CACHE)
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
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(withBase('index.html'), responseToCache));
          }
          return response;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match(withBase('index.html')) || caches.match(withBase(''))))
    );
    return;
  }

  if (!ASSET_RE.test(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(ASSET_CACHE).then((cache) => cache.put(request, responseToCache));
        return response;
      });
    })
  );
});
