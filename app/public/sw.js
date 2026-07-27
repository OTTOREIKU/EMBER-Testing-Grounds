/* ---------- offline cache ---------- */

const ASSET_CACHE = 'ember-assets-v1';
const RUNTIME_CACHE = 'ember-runtime-v1';
const KEEP = [ASSET_CACHE, RUNTIME_CACHE];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return url.pathname.includes('/assets/') && /\.(webp|png|jpe?g|svg|avif)$/i.test(url.pathname);
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('version.json')) return;

  if (isAsset(url)) {
    e.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  e.respondWith(networkFirst(req, RUNTIME_CACHE));
});

self.addEventListener('message', (e) => {
  if (e.data !== 'ember-cache-stats') return;
  e.waitUntil(
    (async () => {
      const counts = {};
      for (const name of KEEP) {
        const cache = await caches.open(name);
        counts[name] = (await cache.keys()).length;
      }
      for (const client of await self.clients.matchAll()) {
        client.postMessage({ type: 'ember-cache-stats', counts });
      }
    })(),
  );
});
