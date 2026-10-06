// App-shell service worker: hashed assets are cached forever, navigations are
// network-first with cache fallback so the app still opens with zero signal.
// API calls pass through untouched — offline data handling lives in the app
// (persisted query cache + score queue in localStorage).
//
// Bump CACHE whenever the caching rules change: `activate` deletes every other
// cache, which is also how a bad entry gets cleared from phones in the field.
// v2 fixes a cache-poisoning bug — see isUsableAsset below.
const CACHE = 'yob-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Is this response really the asset it claims to be?
 *
 * A request for a hashed asset that no longer exists on the server used to come
 * back as the SPA fallback: index.html, with a 200. Caching that under a .css
 * or .js URL poisons it permanently (assets are served cache-first and never
 * revalidated), and the app loads with no styles. The server now 404s those,
 * but the cache outlives any one deploy, so refuse HTML here too.
 */
function isUsableAsset(res) {
  if (!res || !res.ok || res.type === 'opaqueredirect') return false;
  const type = res.headers.get('content-type') || '';
  return !type.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    // Hashed, immutable — cache first.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (isUsableAsset(hit)) return hit;
        // Drop anything unusable that a previous version stored here.
        if (hit) await cache.delete(event.request);
        const res = await fetch(event.request);
        if (isUsableAsset(res)) cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigations and root files — network first, fall back to cache.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((hit) => hit || caches.match('/'))
          .then((hit) => hit || Response.error()),
      ),
  );
});

// A tapped "match closed" notification brings the app forward on the Cup page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/cup');
    }),
  );
});
