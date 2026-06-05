// preview.js — MapLibre GL JS client for UOM 适飞 + DJI flysafe + POI search
// Loaded after maplibre-gl from CDN. Reads /config.json for runtime config.

(async () => {
"use strict";

// ---------- Config ----------
const cfgRes = await fetch("/config.json").catch(() => null);
const cfg = (cfgRes && cfgRes.ok) ? await cfgRes.json() : {};
const TDT_TOKEN = cfg.tiandituToken || "";
const isMobile = window.matchMedia("(max-width: 640px)").matches;

// ---------- Boot gate: ensure offline pmtiles is installed before showing the map ----------
const boot = (() => {
  const overlay = document.getElementById("boot-overlay");
  const status = document.getElementById("boot-status");
  const fillEl = document.getElementById("boot-fill");
  const pctEl = document.getElementById("boot-pct");
  const speedEl = document.getElementById("boot-speed");
  const bytesEl = document.getElementById("boot-bytes");
  const retryEl = document.getElementById("boot-retry");
  function fmtMB(b) { return (b / 1024 / 1024).toFixed(1) + " MB"; }
  function fmtSpeed(bps) {
    if (!bps) return "— MB/s";
    if (bps > 1024*1024) return (bps / 1024 / 1024).toFixed(1) + " MB/s";
    return (bps / 1024).toFixed(0) + " KB/s";
  }
  return {
    update(p, recv, total, bps) {
      const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
      fillEl.style.width = pct + "%";
      pctEl.textContent = pct + "%";
      speedEl.textContent = fmtSpeed(bps);
      if (total) bytesEl.textContent = fmtMB(recv) + " / " + fmtMB(total);
    },
    setStatus(text, isError) {
      status.textContent = text;
      status.classList.toggle("err", !!isError);
    },
    showRetry(onClick) {
      retryEl.classList.remove("hidden");
      retryEl.onclick = onClick;
    },
    hideRetry() {
      retryEl.classList.add("hidden");
      retryEl.onclick = null;
    },
    finish() {
      if (overlay.classList.contains("hidden")) return;
      overlay.classList.add("fade-out");
      setTimeout(() => overlay.classList.add("hidden"), 280);
    },
  };
})();

async function ensureOfflineData() {
  const off = window.__uomOffline;
  if (!off) {
    boot.setStatus("offline.js 未加载", true);
    throw new Error("offline.js missing");
  }
  const status0 = await off.getStatus();
  if (status0.installed) {
    boot.update(1, status0.pmtilesSize, status0.pmtilesSize, 0);
    await off.init();
    return;
  }
  while (true) {
    boot.hideRetry();
    boot.setStatus("正在下载离线数据…");
    try {
      await off.download((p, recv, total, bps) => boot.update(p, recv, total, bps));
      return;
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      boot.setStatus("下载失败：" + msg, true);
      await new Promise(resolve => boot.showRetry(resolve));
    }
  }
}

await ensureOfflineData();
boot.finish();



// ---------- WGS-84 ↔ GCJ-02 (closed-form, public-domain) ----------
function wgs84ToGcj02(lon, lat) {
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lon, lat];
  const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
  const x = lon - 105.0, y = lat - 35.0;
  let dLat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  dLat += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
  dLat += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30.0))*2/3;
  let dLon = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  dLon += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  dLon += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
  dLon += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI))*2/3;
  const radLat = lat/180.0*PI;
  let magic = Math.sin(radLat); magic = 1 - EE*magic*magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat*180.0)/((A*(1-EE))/(magic*sqrtMagic)*PI);
  dLon = (dLon*180.0)/(A/sqrtMagic*Math.cos(radLat)*PI);
  return [lon + dLon, lat + dLat];
}
function gcj02ToWgs84(lon, lat) {
  const [glon, glat] = wgs84ToGcj02(lon, lat);
  return [lon*2 - glon, lat*2 - glat];
}

// ---------- GCJ-02 raster reprojection preset for maplibre-gl-raster-reprojection ----------
// Source: amap web mercator tiles where pixel lng/lat is GCJ-02 datum
// Destination: maplibre EPSG:3857 (WGS-84 datum)
function makeGcj02Preset() {
  const PI = Math.PI, D2R = PI/180, R2D = 180/PI;
  const EARTH_RADIUS = 6378137;
  const ORIGIN_SHIFT = PI * EARTH_RADIUS;
  const EARTH_CIRCUMFERENCE = 2 * ORIGIN_SHIFT;

  const lngLatToMeters = ([lng, lat]) => {
    const mx = (lng * ORIGIN_SHIFT) / 180;
    let my = Math.log(Math.tan((90 + lat) * (PI/360))) / D2R;
    my = (my * ORIGIN_SHIFT) / 180;
    return [mx, my];
  };
  const metersToLngLat = ([mx, my]) => {
    const lng = (mx / ORIGIN_SHIFT) * 180;
    let lat = (my / ORIGIN_SHIFT) * 180;
    lat = R2D * (2 * Math.atan(Math.exp(lat * D2R)) - PI/2);
    return [lng, lat];
  };
  const getRes = (z, ts) => EARTH_CIRCUMFERENCE / ts / (1 << z);
  const metersToPixels = ([mx, my], z, ts) => {
    const r = getRes(z, ts);
    return [(mx + ORIGIN_SHIFT) / r, (my + ORIGIN_SHIFT) / r];
  };
  const pixelsToMeters = ([px, py], z, ts) => {
    const r = getRes(z, ts);
    return [px * r - ORIGIN_SHIFT, py * r - ORIGIN_SHIFT];
  };
  const pixelsToScreen = ([px, py], z, ts) => [px, (ts << z) - py];

  return {
    zoomOffset: 0,
    destinationToPixel: (xy, z, ts) => pixelsToScreen(metersToPixels(xy, z, ts), z, ts),
    pixelToDestination: (xy, z, ts) => pixelsToMeters(pixelsToScreen(xy, z, ts), z, ts),
    destinationToSource: ([mx, my]) => {
      const [wLng, wLat] = metersToLngLat([mx, my]);
      return wgs84ToGcj02(wLng, wLat);
    },
    sourceToPixel: ([gLng, gLat], z, ts) => {
      const m = lngLatToMeters([gLng, gLat]);
      const p = metersToPixels(m, z, ts);
      return pixelsToScreen(p, z, ts);
    },
    destinationTileToSourceTiles: ({ tile, bbox }, zoomOffset = 0) => {
      const [xmin, ymin, xmax, ymax] = bbox;
      const corners = [[xmin, ymin], [xmax, ymin], [xmin, ymax], [xmax, ymax]];
      const gm = corners.map(([mx, my]) => {
        const [wLng, wLat] = metersToLngLat([mx, my]);
        const g = wgs84ToGcj02(wLng, wLat);
        return lngLatToMeters(g);
      });
      const gxs = gm.map(p => p[0]), gys = gm.map(p => p[1]);
      const gMinX = Math.min(...gxs), gMaxX = Math.max(...gxs);
      const gMinY = Math.min(...gys), gMaxY = Math.max(...gys);
      const z = tile[2] + zoomOffset, ts = 256;
      const [pxMin, pyMin] = metersToPixels([gMinX, gMinY], z, ts);
      const [pxMax, pyMax] = metersToPixels([gMaxX, gMaxY], z, ts);
      const txMin = Math.max(0, Math.ceil(pxMin / ts) - 1);
      const txMax = Math.min((1 << z) - 1, Math.ceil(pxMax / ts) - 1);
      const tyMinTms = Math.max(0, Math.ceil(pyMin / ts) - 1);
      const tyMaxTms = Math.min((1 << z) - 1, Math.ceil(pyMax / ts) - 1);
      const out = [];
      for (let tx = txMin; tx <= txMax; tx++) {
        for (let tyT = tyMinTms; tyT <= tyMaxTms; tyT++) {
          const [bMinX, bMinY] = pixelsToMeters([tx * ts, tyT * ts], z, ts);
          const [bMaxX, bMaxY] = pixelsToMeters([(tx + 1) * ts, (tyT + 1) * ts], z, ts);
          const [bLngW, bLatS] = metersToLngLat([bMinX, bMinY]);
          const [bLngE, bLatN] = metersToLngLat([bMaxX, bMaxY]);
          const tyXyz = (1 << z) - 1 - tyT;
          out.push({ tile: [tx, tyXyz, z], bbox: [bLngW, bLatS, bLngE, bLatN] });
        }
      }
      return out;
    },
  };
}

// ---------- Register reprojection protocol for 高德 (GCJ-02 → WGS-84) ----------
// Note: lib has bug — passing `protocol` is ignored, always becomes "reproject"
const AMAP_SUBS = ["1","2","3","4"];
const lib = window.maplibreglRasterReprojection;
if (!lib || !lib.createProtocol) {
  console.error("maplibre-gl-raster-reprojection not loaded");
} else {
  // Prefer a Web Worker (OffscreenCanvas) for the heavy slice+canvas work,
  // falling back to the main-thread library when unavailable.
  const canUseWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  if (canUseWorker) {
    const w = new Worker("/reproj-worker.js");
    let nextId = 1;
    const pending = new Map();
    w.addEventListener("message", (ev) => {
      const { id, ok, buf, err } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(buf ? { data: buf } : { data: new ArrayBuffer(0) });
      else p.reject(new Error(err));
    });

    const REPROJ_URL_RE = /^reproject:\/\/([^:]+):\/\/(.+)$/;

    maplibregl.addProtocol("reproject", (params, abort) => {
      const m = params.url.match(REPROJ_URL_RE);
      if (!m) return Promise.reject(new Error("bad url"));
      const qs = new URLSearchParams(m[1]);
      const bbox = (qs.get("bbox") || "").split(",").map(Number);
      const z = +qs.get("z"), x = +qs.get("x"), y = +qs.get("y");
      const sts = +qs.get("sts") || 256;
      const urlTemplate = m[2];

      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        if (abort && abort.signal) {
          abort.signal.addEventListener("abort", () => {
            const p = pending.get(id);
            if (p) { pending.delete(id); p.reject(new DOMException("aborted","AbortError")); }
          });
        }
        w.postMessage({
          id, type: "reproject",
          data: { destTile: [x, y, z], destBbox: bbox, urlTemplate, tileSize: 512, sourceTileSize: sts, interval: 32 },
        });
      });
    });
  } else {
    const { protocol, loader } = lib.createProtocol({
      cacheSize: 64,
      interval: [32, 32],
      ...makeGcj02Preset(),
    });
    maplibregl.addProtocol(protocol, loader);
  }
}

function amapTiles(pathQuery, sts = 512) {
  return AMAP_SUBS.map(s =>
    `reproject://bbox={bbox-epsg-3857}&z={z}&x={x}&y={y}&sts=${sts}://` +
    `https://wprd0${s}.is.autonavi.com/${pathQuery}`
  );
}
function amapStTiles(pathQuery, sts = 256) {
  return AMAP_SUBS.map(s =>
    `reproject://bbox={bbox-epsg-3857}&z={z}&x={x}&y={y}&sts=${sts}://` +
    `https://webst0${s}.is.autonavi.com/${pathQuery}`
  );
}

// ---------- Sources & basemap configs ----------
function tdtTiles(layer) {
  if (!TDT_TOKEN) return null;
  const subs = ["0","1","2","3","4","5","6","7"];
  return subs.map(s => "https://t" + s + ".tianditu.gov.cn/DataServer?T=" + layer + "&X={x}&Y={y}&L={z}&tk=" + TDT_TOKEN);
}

const sources = {
  uom: { type: "raster", url: "pmtiles://uom-pmtiles", tileSize: 256, attribution: "UOM 适飞" },
  osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 0, maxzoom: 19, attribution: "© OSM" },
  cartoVoy: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 0, maxzoom: 19, attribution: "© CARTO" },
  cartoDark: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 0, maxzoom: 19, attribution: "© CARTO" },
  esriSat: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, minzoom: 0, maxzoom: 19, attribution: "© Esri" },
  opentopo: { type: "raster", tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 0, maxzoom: 17, attribution: "© OpenTopoMap" },
  amapVec: { type: "raster", tiles: amapTiles("appmaptile?lang=zh_cn&size=1&scl=2&style=8&x={sx}&y={sy}&z={sz}"), tileSize: 256, minzoom: 0, maxzoom: 18, attribution: "© 高德" },
  amapSat: { type: "raster", tiles: amapStTiles("appmaptile?style=6&x={sx}&y={sy}&z={sz}", 256), tileSize: 256, minzoom: 0, maxzoom: 18, attribution: "© 高德" },
  amapSatAnno: { type: "raster", tiles: amapStTiles("appmaptile?style=8&scl=2&size=2&x={sx}&y={sy}&z={sz}", 512), tileSize: 256, minzoom: 0, maxzoom: 18 },
};

const tdtVec = tdtTiles("vec_w");
if (tdtVec) {
  const TS = 256;
  const opts = (att) => ({ type: "raster", tileSize: TS, minzoom: 0, maxzoom: 18, attribution: att });
  sources.tdtVec = { ...opts("© 天地图"), tiles: tdtVec };
  sources.tdtVecAnno = { ...opts(""), tiles: tdtTiles("cva_w") };
  sources.tdtSat = { ...opts("© 天地图"), tiles: tdtTiles("img_w") };
  sources.tdtSatAnno = { ...opts(""), tiles: tdtTiles("cia_w") };
  sources.tdtTer = { ...opts("© 天地图"), tiles: tdtTiles("ter_w") };
  sources.tdtTerAnno = { ...opts(""), tiles: tdtTiles("cta_w") };
}

const basemaps = [
  { id: "osm", name: "街道", provider: "OSM", sources: ["osm"] },
  { id: "cartoVoy", name: "矢量", provider: "CARTO", sources: ["cartoVoy"] },
  { id: "cartoDark", name: "暗色", provider: "CARTO", sources: ["cartoDark"] },
  { id: "esriSat", name: "影像", provider: "ESRI", sources: ["esriSat"] },
  { id: "opentopo", name: "地形", provider: "OpenTopo", sources: ["opentopo"] },
  { id: "amapVec", name: "矢量", provider: "高德", sources: ["amapVec"] },
  { id: "amapSat", name: "影像", provider: "高德", sources: ["amapSat", "amapSatAnno"] },
];
if (TDT_TOKEN) {
  basemaps.push(
    { id: "tdtVec", name: "矢量", provider: "天地图", sources: ["tdtVec", "tdtVecAnno"] },
    { id: "tdtSat", name: "影像", provider: "天地图", sources: ["tdtSat", "tdtSatAnno"] },
    { id: "tdtTer", name: "地形", provider: "天地图", sources: ["tdtTer", "tdtTerAnno"] },
  );
}

// Initial style: background fallback + OSM basemap; UOM overlay; DJI added after fetch.
const initial = basemaps[0];
function bgColorForTheme() {
  const dt = document.documentElement.dataset.theme;
  let isLight = dt === "light";
  if (dt === "system") isLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  return isLight ? "#e8eaee" : "#1a1d22";
}
const style = {
  version: 8,
  sources,
  layers: [
    {
      id: "bg-fallback",
      type: "background",
      paint: { "background-color": bgColorForTheme() },
    },
    ...initial.sources.map((s, i) => ({
      id: "basemap-" + i,
      type: "raster",
      source: s,
      metadata: { basemap: true },
    })),
    {
      id: "uom-overlay",
      type: "raster",
      source: "uom",
      paint: {
        "raster-opacity": 0.6,
        "raster-hue-rotate": 0,
        "raster-resampling": "nearest",
        "raster-fade-duration": 0,
      },
    },
  ],
};

const map = new maplibregl.Map({
  container: "map",
  style,
  center: [105, 35],
  zoom: 4,
  minZoom: 2,
  maxZoom: 18,
  pitchWithRotate: false,
  dragRotate: false,
  touchPitch: false,
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true, timeout: 10000 },
  trackUserLocation: false,
  showAccuracyCircle: true,
}), "top-left");

// Level chip — shows the integer XYZ z used by UOM (capped at 13).
class LevelControl {
  onAdd(m) {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const cell = document.createElement("div");
    cell.className = "level-chip";
    cell.title = "当前请求层级 (UOM 最高 13)";
    div.appendChild(cell);
    this._cell = cell;
    this._m = m;
    this._update = () => {
      const z = Math.max(0, Math.min(13, Math.round(m.getZoom())));
      cell.textContent = String(z);
    };
    m.on("zoom", this._update);
    m.on("zoomend", this._update);
    this._update();
    return div;
  }
  onRemove() {
    if (this._m && this._update) {
      this._m.off("zoom", this._update);
      this._m.off("zoomend", this._update);
    }
  }
}
map.addControl(new LevelControl(), "top-left");

map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");

window.__uomState = { map, basemaps, sources, initialBasemapId: initial.id };
window.__uomCoord = { wgs84ToGcj02, gcj02ToWgs84 };
window.__uomTheme = { bgColorForTheme };

// ===== Bootstrap continues in preview-app.js =====
function getAmapKey() { return localStorage.getItem("uomtiles.amapKey") || ""; }

// (rest of init runs after map.load via preview-app.js)
const appScript = document.createElement("script");
appScript.src = "/preview-app.js";
document.body.appendChild(appScript);
})();
