/* Service Worker: App offline verfügbar halten.
   Bei JEDER Änderung an den Dateien CACHE hochzählen, sonst liefert der
   Worker die alte Fassung weiter. Fehlt eine Datei aus ASSETS auf dem
   Server, scheitert die Installation ganz: neue Dateien hier eintragen,
   entfernte austragen. */
const CACHE = 'schach-v5';
const ASSETS = [
  './', './index.html', './tokens.css', './style.css', './charts.js', './sync.js', './app.js',
  './fonts/inter-latin-wght-normal.woff2', './fonts/space-grotesk-latin-wght-normal.woff2',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' erzwingt frische Dateien vom Server. Ohne das kämen sie aus
  // dem HTTP-Cache des Browsers (GitHub Pages sendet max-age=600), und der
  // neue Cache enthielte die alte Version.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Nur eigene alte Caches löschen: Alle Apps unter <name>.github.io teilen sich
  // einen Cache-Speicher, ohne den Präfix-Filter flöge deren Offline-Fassung mit raus.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('schach-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  /* Fremde Server nie anfassen: api.chess.com muss frisch antworten, aus dem
     Cache käme sonst ein altes Rating. */
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  /* Nur die eigenen Dateien anfassen. Andere Apps auf derselben Domain
     (…/reader/, …/dashboard/) liegen außerhalb des eigenen Ordners. */
  const own = new URL(self.registration.scope);
  if (!url.pathname.startsWith(own.pathname)) return;
  const key = url.pathname === own.pathname ? './' : e.request;

  /* Stale-while-revalidate: sofort aus dem Cache liefern, im Hintergrund
     aktualisieren. */
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(key, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        // Umgeleitete Antworten nicht cachen: Chrome lehnt sie für Seitenaufrufe ab
        if (res && res.ok && !res.redirected && !url.search) c.put(key, res.clone());
        return res;
      });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }))
  );
});
