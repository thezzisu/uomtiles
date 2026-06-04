// sw.js — minimal stale-while-revalidate cache for the static shell.
// pmtiles + DJI are stored in IndexedDB by offline.js, NOT here.

const VERSION = "v2";
const CACHE = "uom-shell-" + VERSION;
const SHELL = [
  "/preview",
  "/preview.html",
  "/preview.css",
  "/preview.js",
  "/preview-app.js",
  "/offline.js",
  "/reproj-worker.js",
  "/manifest.json",
  "/config.json",
  "/icon-192.png",
  "/icon-512.png",
  "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css",
  "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js",
  "https://unpkg.com/maplibre-gl-raster-reprojection@1.0.4/dist/maplibre-gl-raster-reprojection.umd.cjs",
  "https://unpkg.com/pmtiles@4.3.0/dist/pmtiles.js",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(u => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Never intercept the heavy assets (pmtiles, geojson, tiles) — IDB owns them.
  if (url.pathname.endsWith(".pmtiles") || url.pathname.endsWith("dji.geojson") || url.pathname.startsWith("/xyz/")) {
    return;
  }
  // Only handle GET requests.
  if (e.request.method !== "GET") return;
  // Same origin OR known CDN: stale-while-revalidate.
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.host === "unpkg.com" || url.host === "cdn.jsdelivr.net";
  if (!sameOrigin && !isCdn) return;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const cached = await c.match(e.request);
      const network = fetch(e.request).then(r => {
        if (r && r.status === 200 && (r.type === "basic" || r.type === "cors")) {
          c.put(e.request, r.clone()).catch(() => {});
        }
        return r;
      }).catch(() => null);
      return cached || (await network) || new Response("offline", { status: 503 });
    })
  );
});
