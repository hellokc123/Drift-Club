// Drift Club service worker: keeps the app shell cached so the game opens fast (and offline for solo).
// Network-first for everything, so new versions arrive as soon as you're online; the cache is only
// a fallback. Never touches the multiplayer socket (/ws) or live data (/records, /health).
const CACHE = 'driftclub-shell-v1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/ai.js', 'js/audio.js', 'js/camera.js', 'js/cars.js', 'js/carstats.js', 'js/compmodes.js', 'js/config.js',
  'js/effects.js', 'js/game.js', 'js/input.js', 'js/judge.js', 'js/maps.js', 'js/minimap.js', 'js/net.js', 'js/physics.js',
  'js/scoring.js', 'js/secret.js', 'js/settings.js', 'js/showroom.js', 'js/touch.js', 'js/tracks.js', 'js/tuning.js', 'js/ui.js',
  'js/engine/geometry.js', 'js/engine/math.js', 'js/engine/renderer.js',
];
const LIVE = /\/(ws|records|health)(\/|$|\?)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'no-cache' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('driftclub-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || LIVE.test(url.pathname) || req.headers.get('upgrade')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await caches.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
