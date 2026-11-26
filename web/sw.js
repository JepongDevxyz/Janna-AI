/* Offline shell only. Never cache API responses, projects, tokens or conversations. */
const CACHE = 'janna-app-native-phone-v70';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/run-stream.js', '/mobile.js',
  '/theme.js', '/mark-clean.png', '/vibe.js', '/icon-192.png', '/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});
