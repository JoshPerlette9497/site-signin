const CACHE_NAME = 'sitesignin-v5';
const APP_SHELL = [
  './index.html', './manifest.json', './icon-192.png', './icon-512.png', './style.css',
  './js/modal.js', './js/storage.js', './js/app.js', './js/admin-view.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell so updates show up quickly; cache is just an offline fallback.
// Supabase API calls are never cached — they always go to the network.
//
// `fetch(event.request)` alone still let the browser's own HTTP cache answer
// without touching the network at all — GitHub Pages' Cache-Control header
// let a page keep serving a stale js/*.js for several minutes after a new
// version was pushed, with no error and no visible sign anything was stale
// (this is what made a freshly-deployed form/PDF change look like it hadn't
// taken effect, while an incognito window — no HTTP cache yet — got the new
// version immediately). `cache: 'no-store'` forces every own-origin request
// through this service worker to actually hit the network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin.includes('supabase.co')) return; // never intercept data calls

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
