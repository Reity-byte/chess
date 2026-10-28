// ─── SERVICE WORKER (offline app) ──────────────────────────────────────────────
// Makes the installed app work without a connection. On install it caches every
// file of the site (the list in precache.js, written by `npm run release`);
// pages are then served network-first (so a new version shows up as soon as
// you're online) and everything else cache-first — CSS and JS URLs carry the
// ?v= release number, so a new release means new URLs, never stale files.
// Same-origin files missing from the list are cached the first time they load.
importScripts('precache.js?v=39');

const CACHE = `chess-${PRECACHE_VERSION}`;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('chess-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
    if (req.mode === 'navigate') {
        // Pages: the network first, the cached copy when offline.
        event.respondWith(
            fetch(req)
                .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
                .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('site.html'))),
        );
        return;
    }
    event.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        })),
    );
});
