/* GaforCast service worker.
 * App shell: cache first. Reports and weather: network first with a cache
 * fallback, so the last state stays readable without a connection.
 * Bump VERSION on every deploy so installed clients pick up the new shell.
 */
const VERSION = 'gaforcast-v1.2.0';   // muss APP.cache in js/version.js entsprechen
const SHELL = [
  './', './index.html',
  './css/base.css', './css/app.css',
  './js/version.js', './js/util.js', './js/gafor.js', './js/geo.js', './js/dwd.js',
  './js/metar.js', './js/openmeteo.js', './js/mapview.js', './js/app.js',
  './js/vendor/leaflet/leaflet.js', './js/vendor/leaflet/leaflet.css',
  './data/gafor-areas.geojson', './data/gafor-meta.json',
  './manifest.webmanifest',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './img/wicki-logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // tiles: cache first, they never change
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(VERSION + '-tiles').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // data (own reports, weather APIs): network first
  const isData = url.pathname.includes('/data/dwd/') ||
                 /aviationweather\.gov|open-meteo\.com|openstreetmap\.org\/reverse/.test(req.url);
  if (isData) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(VERSION + '-data')).put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  // shell: cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
