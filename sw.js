/* Service worker: שומר את האפליקציה לשימוש גם בלי קליטה.
 * אחרי עדכון קבצים בגיט, העלו את מספר הגרסה כדי לרענן את המטמון. */
const CACHE = 'nyc-trip-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'firebase-config.js', 'cloud.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first לקבצי האתר (כדי לקבל עדכונים מהגיט), נפילה למטמון כשאין רשת
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (!sameOrigin && !isFont) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
