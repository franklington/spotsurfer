/* SpotSurfer Service Worker – Cache-first with network fallback */
const CACHE = 'spotsurfer-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/audio.js',
  './js/game.js',
  './js/spotify.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  /* Pass through Spotify API / auth calls – never cache those */
  try {
    const reqHost = new URL(event.request.url).hostname;
    if (reqHost === 'api.spotify.com' || reqHost === 'accounts.spotify.com') return;
  } catch {
    /* Relative URL or invalid URL – let it fall through to cache logic */
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        /* Cache successful same-origin GET responses */
        if (
          response.ok &&
          event.request.method === 'GET' &&
          new URL(event.request.url).origin === location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
