// BookReader Service Worker — Offline caching for PWA

const CACHE_NAME = 'bookreader-v1';

// Detect base path dynamically (works on both localhost and GitHub Pages)
const BASE = self.registration.scope;

const RELATIVE_ASSETS = [
  '',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/pdf-renderer.js',
  'js/library.js',
  'js/annotations.js',
  'js/bookmarks.js',
  'js/search.js',
  'js/settings.js',
  'manifest.json',
  'assets/icon-192.png',
  'assets/icon-512.png',
];

const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'
];

const ASSETS_TO_CACHE = [
  ...RELATIVE_ASSETS.map(a => BASE + a),
  ...CDN_ASSETS
];

// Install — cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — serve from cache first, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful GET responses for fonts/CDN assets
        if (response.ok && event.request.method === 'GET') {
          const url = new URL(event.request.url);
          const shouldCache = url.origin === self.location.origin ||
            url.hostname === 'fonts.googleapis.com' ||
            url.hostname === 'fonts.gstatic.com' ||
            url.hostname === 'cdnjs.cloudflare.com';
          if (shouldCache) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
