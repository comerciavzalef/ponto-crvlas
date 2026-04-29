// ══════════════════════════════════════════════════════════════
//  SERVICE WORKER — Grupo Carlos Vaz
//  Cache inteligente + Offline-first para PWA real
//  Usar em: /ponto/sw.js  /estoque/sw.js  /requisicoes/sw.js
// ══════════════════════════════════════════════════════════════

var CACHE_NAME = 'cv-app-v5.1';

var STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap'
];

// ── Install: cachear arquivos estáticos ──────────────────────
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate: limpar caches antigos ──────────────────────────
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

// ── Fetch: Network-first para API, Cache-first para assets ──
self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // Chamadas à API do Google Apps Script → sempre tenta rede primeiro
  if (url.indexOf('script.google.com') > -1) {
    e.respondWith(
      fetch(e.request)
        .then(function (response) {
          // Cachear resposta GET da API
          if (e.request.method === 'GET' && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          // Offline: retorna do cache se disponível
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

  // Assets estáticos → Cache-first, fallback pra rede
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) {
        // Atualiza cache em background (stale-while-revalidate)
        fetch(e.request).then(function (response) {
          if (response.status === 200) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(e.request, response);
            });
          }
        }).catch(function () { /* silencioso */ });
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
