var CACHE_NAME = 'ponto-v10.3-master';
var ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== CACHE_NAME) return caches.delete(k);
    }));
  }));
  self.clients.claim();
});

// Estratégia: Network First (Tenta sempre a internet primeiro, se falhar, usa o cache)
self.addEventListener('fetch', function (e) {
  if (e.request.url.indexOf('script.google.com') !== -1) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request).then(function(response) {
      return caches.open(CACHE_NAME).then(function(cache) {
        cache.put(e.request, response.clone());
        return response;
      });
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});

