/* Cluck's Feed service worker: makes the app installable and readable offline.
 *
 * Strategy per request type:
 * - Article bodies (/api/feed/item/*): network-first, cached copy when offline.
 *   The Today screen prefetches the top of the queue so it is all on-device.
 * - Build assets (/_next/static/*): cache-first; filenames are content-hashed.
 * - Page navigations: network-first, falling back to the last cached copy of
 *   that page, then to the cached Today shell.
 * - Everything else (auth, inbox lists, writes): straight to the network.
 *   Today keeps its own last-loaded list in localStorage.
 */
const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const ARTICLES = `articles-${VERSION}`;
const MAX_ARTICLES = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/today"]).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      if (cacheName === ARTICLES) trim(ARTICLES, MAX_ARTICLES);
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(request, { ignoreSearch: false })) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/feed/item/")) {
    event.respondWith(networkFirst(request, ARTICLES));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(request, res.clone()));
            return res;
          })
      )
    );
    return;
  }
  if (request.mode === "navigate" && !url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, PAGES, "/today"));
  }
});
