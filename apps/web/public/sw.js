/* CafeFlow service worker (phase 7).
 *
 * Rules that matter:
 *  - API responses are never cached: money and order state must always come
 *    from the server, and a stale 200 would be worse than an error.
 *  - Navigations are network-first with an offline page fallback, so a staff
 *    member who loses connectivity sees an honest Persian page instead of the
 *    browser's error.
 *  - Hashed build assets are cache-first; they are immutable by filename.
 */
// Bump this whenever a cached response shape changes: activation deletes every
// cache that does not start with the new version.
const VERSION = 'cafeflow-v3';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/* Device notifications: tapping one focuses an open tab and opens the target
 * route, or opens a new window when the site is closed. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || '/';
  const target = new URL(href, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const exact = windows.find((client) => client.url === target);
      if (exact) return exact.focus();
      const reusable = windows.find((client) => 'navigate' in client);
      if (reusable) {
        await reusable.navigate(target);
        return reusable.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? new Response('آفلاین هستید.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Photos are the one thing a phone in a café hits over and over. Cache them
  // only when the server really sent an image: a 200 that is actually the SPA
  // fallback must never be stored, or the picture stays broken until the cache
  // is cleared by hand.
  if (request.destination === 'image' || /^\/(images|scenes|videos)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            const type = response.headers.get('content-type') || '';
            if (response.ok && type.startsWith('image/')) {
              const copy = response.clone();
              void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => Response.error());
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
