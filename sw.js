/* ============================================================
   PONTO DIGITAL — SERVICE WORKER v4 (Bypass API)
   ============================================================ */

var CACHE_NAME = 'ponto-v5';
var ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE_NAME; })
                    .map(function (k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function (e) {
    // 🚨 A MÁGICA ESTÁ AQUI: Ignorar chamadas para o script do Google 🚨
    if (e.request.url.indexOf('script.google.com') !== -1 || e.request.url.indexOf('script.googleusercontent.com') !== -1) {
        e.respondWith(fetch(e.request));
        return;
    }

    e.respondWith(
        caches.match(e.request).then(function (cached) {
            return cached || fetch(e.request).then(function (response) {
                return caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(e.request, response.clone());
                    return response;
                });
            });
        })
    );
});
