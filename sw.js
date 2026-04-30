// ══════════════════════════════════════════════════════════════
//  SERVICE WORKER — Ponto Digital CRV/LAS
// ══════════════════════════════════════════════════════════════

var CACHE_NAME = 'ponto-v2'; // <-- Mude o número da versão aqui!

var STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  if (url.indexOf('script.google.com') > -1) {
    e.respondWith(
      fetch(e.request)
        .then(function (response) {
          if (e.request.method === 'GET' && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(e.request).then(function (cached) {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ erro: 'Sem conexão', offline: true }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) {
        fetch(e.request).then(function (response) {
          if (response.status === 200) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(e.request, response);
            });
          }
        }).catch(function () {});
        return cached;
      }
      return fetch(e.request).then(function (response) {
        if (response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      });
    })
  );
});
