/**
 * TruckPaper service worker.
 *
 * Goals, in priority order:
 *   1. Never break normal browsing. Every request goes to the network first
 *      unless it is in the precache (the app shell) or we are offline.
 *   2. Make the shell openable offline and installable to the home screen.
 *   3. Cut repeat traffic on ~1.9 GB of listing photography.
 *
 * Deliberate non-goals:
 *   - js/data.js is the listing dataset (3.7 MB, regenerated whenever listings
 *     change). It is network-first with a cache fallback so an online user
 *     always sees fresh inventory, while an offline user still gets the last
 *     known set rather than an empty page.
 *   - /api/* is never cached. It carries credentials and password-reset flows;
 *     a stale auth response would be worse than a failure.
 *   - Images are not precached. There are 1,001 gallery folders totalling
 *     ~1.9 GB; they are cached lazily as they are viewed, with a bounded
 *     cache so the origin quota is never exhausted.
 */
const VERSION = 'tp-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-img`;
const RUNTIME_CACHE = `${VERSION}-rt`;

/** Largest cache we allow for lazily-viewed photography. */
const IMAGE_CACHE_LIMIT = 300;

/** The app shell: everything needed to paint the site chrome offline. */
const SHELL = [
  '/truckpaper/',
  '/truckpaper/index.html',
  '/truckpaper/css/styles.css',
  '/truckpaper/js/app.js',
  '/truckpaper/js/router.js',
  '/truckpaper/js/auth.js',
  '/truckpaper/js/config.js',
  '/truckpaper/manifest.webmanifest',
  '/truckpaper/assets/logo.svg',
  '/truckpaper/assets/pwa/icon-192.png',
  '/truckpaper/assets/pwa/icon-512.png',
  '/truckpaper/assets/pwa/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      /* addAll() rejects the whole install if any single request fails, so
       * add entries individually and tolerate misses. */
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('tp-') && !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch the auth API.
  if (url.pathname.startsWith('/truckpaper/api/') || url.pathname.startsWith('/truckpaper/admin/')) return;

  // Navigations: network first so routing and deploys are always live,
  // falling back to the cached shell when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/truckpaper/index.html', copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match('/truckpaper/index.html')
            .then((hit) => hit || caches.match('/truckpaper/'))
            .then((hit) => hit || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  // Listing data: network first, stale copy only if the network fails.
  if (url.pathname === '/truckpaper/js/data.js') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Photography: serve from cache immediately, refresh in the background.
  if (/\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(IMAGE_CACHE).then((c) => {
                c.put(request, copy);
                trim(IMAGE_CACHE, IMAGE_CACHE_LIMIT);
              });
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
    return;
  }

  // Everything else: network first with a runtime cache fallback.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok && url.pathname.startsWith('/truckpaper/js/')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

/** Keep a cache under its limit by evicting oldest entries first. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) {
    await cache.delete(key);
  }
}