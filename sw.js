/* sw.js -- offline support.
 *
 * Every file the app needs is served from this origin, so one pass at install
 * time makes the whole tool work with no connection: on a plane, in a
 * basement, or in a building with no signal.
 *
 * Two strategies, chosen so that publishing a fix reaches every installed copy
 * without anyone having to remember to bump a version:
 *   - the app's own code and page are fetched from the network first, and the
 *     cache answers only when the network does not (offline, or too slow);
 *   - the bundled libraries, fonts and icons never change under the same name
 *     (the libraries carry their version in the file name), so they are
 *     answered from the cache first.
 *
 * CACHE carries the app's version, and the test suite fails unless it matches
 * the version in package.json and app/exporters.js. So every release changes
 * this file, which makes every installed copy install afresh: it downloads
 * the whole set again in one pass (bypassing the HTTP cache), so the modules
 * it holds offline always belong to the same release, never a mix of the old
 * and the new. The old cache is dropped on activate. The test suite also
 * checks this list against the files on disk. */
const VERSION = '3.1.0';
const CACHE = `comp-loader-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/ui.js',
  'app/costar.js',
  'app/layout.js',
  'app/pdftext.js',
  'app/stats.js',
  'app/workbook.js',
  'app/charts.js',
  'app/package.js',
  'app/zoning.js',
  'app/sample.js',
  'app/store.js',
  'app/glance.js',
  'app/exporters.js',
  'app/kit.js',
  'app/om.js',
  'app/deal.js',
  'app/dealui.js',
  'app/brief.js',
  'app/tools.js',
  'app/toolsui.js',
  'app/template.js',
  'vendor/pdf-4.7.76-legacy.min.js',
  'vendor/pdf-4.7.76-legacy.worker.min.js',
  'vendor/exceljs-4.4.0.min.js',
  'vendor/fflate-0.8.3.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'icons/icon-maskable-512.png',
  'fonts/public-sans-latin-400-normal.woff2',
  'fonts/public-sans-latin-600-normal.woff2',
  'fonts/public-sans-latin-700-normal.woff2',
];

const IMMUTABLE = /\/(vendor|fonts|icons)\//;
const NETWORK_WAIT_MS = 3500;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages lets it keep a
  // file for ten minutes), so a fresh install never stores a stale copy
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fromNetwork(request) {
  return fetch(request).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
}

/* Network first, with a time limit: a phone on one bar of signal should not
 * sit waiting when a good copy is already on the device. */
function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: true })
      .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined));
    const timer = setTimeout(() => {
      fallback().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NETWORK_WAIT_MS);
    fromNetwork(request).then((res) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then((hit) => {
        if (!settled) { settled = true; resolve(hit || new Response('Offline', { status: 503, statusText: 'Offline' })); }
      });
    });
  });
}

function cacheFirst(request) {
  return caches.match(request, { ignoreSearch: true }).then((hit) => hit || fromNetwork(request));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(IMMUTABLE.test(url.pathname) ? cacheFirst(e.request) : networkFirst(e.request));
});
