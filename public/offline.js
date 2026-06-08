// offline.js — IDB blob store + pmtiles addProtocol + DJI cache for full offline.
// Loaded after pmtiles.js. Exposes window.__uomOffline.

(() => {
"use strict";

const DB = "uomtiles-offline";
const STORE = "blobs";
const KEY_PMTILES = "uom-pmtiles";
const KEY_OSM = "osm-base-pmtiles";
const KEY_DJI = "dji-geojson";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getStatus() {
  try {
    const [pm, osm, dji] = await Promise.all([
      idbGet(KEY_PMTILES), idbGet(KEY_OSM), idbGet(KEY_DJI),
    ]);
    return {
      installed: !!pm,
      pmtilesSize: pm ? pm.size : 0,
      osmSize: osm ? osm.size : 0,
      djiSize: dji ? (dji.byteLength || dji.size || 0) : 0,
      osmAvailable: !!osm,
    };
  } catch (_) {
    return { installed: false, pmtilesSize: 0, osmSize: 0, djiSize: 0, osmAvailable: false };
  }
}

// Stream-fetch a URL into a Blob, reporting progress { ratio, received, total, bps }.
async function downloadBlob(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastT = performance.now();
  let lastBytes = 0;
  let bps = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = performance.now();
    const dt = now - lastT;
    if (dt >= 250) {
      const inst = ((received - lastBytes) * 1000) / dt;
      bps = bps ? (bps * 0.6 + inst * 0.4) : inst; // EWMA
      lastT = now;
      lastBytes = received;
    }
    if (onProgress && total) onProgress(received / total, received, total, bps);
  }
  return new Blob(chunks);
}

let pmtilesProtocolRegistered = false;
let pmtilesProtocolInstance = null;
function makeBlobSource(blob, name) {
  return new window.pmtiles.FileSource({
    name,
    slice: (a, b) => blob.slice(a, b),
    arrayBuffer: () => blob.arrayBuffer(),
  });
}
function ensureProtocol() {
  if (pmtilesProtocolRegistered) return;
  pmtilesProtocolInstance = new window.pmtiles.Protocol();
  window.maplibregl.addProtocol("pmtiles", pmtilesProtocolInstance.tile.bind(pmtilesProtocolInstance));
  pmtilesProtocolRegistered = true;
}
async function installPmtilesProtocol(blob) {
  if (!window.pmtiles || !window.maplibregl) return false;
  const pm = new window.pmtiles.PMTiles(makeBlobSource(blob, KEY_PMTILES));
  ensureProtocol();
  pmtilesProtocolInstance.add(pm);
  window.__uomOfflinePM = pm;
  return true;
}
async function installOsmBaseProtocol(blob) {
  if (!window.pmtiles || !window.maplibregl) return false;
  const pm = new window.pmtiles.PMTiles(makeBlobSource(blob, KEY_OSM));
  ensureProtocol();
  pmtilesProtocolInstance.add(pm);
  window.__uomOfflineOsmPM = pm;
  return true;
}

async function init() {
  const blob = await idbGet(KEY_PMTILES).catch(() => null);
  if (blob) {
    try { localStorage.setItem("uomtiles.installed", "1"); } catch (_) {}
    await installPmtilesProtocol(blob).catch(e => console.warn("pmtiles install failed", e));
  }
  const osm = await idbGet(KEY_OSM).catch(() => null);
  if (osm) {
    await installOsmBaseProtocol(osm).catch(e => console.warn("osm-base install failed", e));
  }
  return { installed: !!blob, osmAvailable: !!osm };
}

async function download(onProgress) {
  // Probe content-length for all three assets so we can show a single,
  // accurate progress meter covering UOM + OSM base + DJI.
  const probe = async url => {
    try {
      const r = await fetch(url, { method: "HEAD" });
      const cl = parseInt(r.headers.get("content-length") || "0", 10);
      return cl > 0 ? cl : 0;
    } catch (_) { return 0; }
  };
  let [pmTotal, osmTotal, djiTotal] = await Promise.all([
    probe("/uom-shifei.pmtiles"),
    probe("/osm-base.pmtiles"),
    probe("/dji.geojson"),
  ]);
  // Fallback estimates; will be tightened from streaming content-length.
  if (!osmTotal) osmTotal = 25 * 1024 * 1024;
  if (!djiTotal) djiTotal = 6 * 1024 * 1024;
  let grandTotal = pmTotal + osmTotal + djiTotal;

  let baseBytes = 0;
  let phase = "pm"; // "pm" | "osm" | "dji"
  const onChunk = (recv, total, bps) => {
    if (!onProgress) return;
    if (total) {
      // Tighten the grand total using the live content-length of the in-flight asset.
      let expected;
      if (phase === "pm") expected = total + osmTotal + djiTotal;
      else if (phase === "osm") expected = pmTotal + total + djiTotal;
      else expected = pmTotal + osmTotal + total;
      if (expected > grandTotal) grandTotal = expected;
    }
    const merged = baseBytes + recv;
    const ratio = grandTotal ? Math.min(1, merged / grandTotal) : 0;
    onProgress(ratio, merged, grandTotal, bps);
  };

  // 1. UOM pmtiles
  phase = "pm";
  const pmBlob = await downloadBlob(
    "/uom-shifei.pmtiles",
    (_p, recv, total, bps) => onChunk(recv, total, bps)
  );
  await idbPut(KEY_PMTILES, pmBlob);
  baseBytes += pmBlob.size;
  if (pmBlob.size > pmTotal) pmTotal = pmBlob.size;

  // 2. OSM base pmtiles (best-effort; if missing on the server we silently skip)
  phase = "osm";
  try {
    const osmBlob = await downloadBlob(
      "/osm-base.pmtiles",
      (_p, recv, total, bps) => onChunk(recv, total, bps)
    );
    await idbPut(KEY_OSM, osmBlob);
    baseBytes += osmBlob.size;
    osmTotal = osmBlob.size;
  } catch (e) {
    console.warn("osm-base download failed (will retry next time)", e);
    osmTotal = 0;
  }

  // 3. DJI geojson
  phase = "dji";
  try {
    const djiBlob = await downloadBlob(
      "/dji.geojson",
      (_p, recv, total, bps) => onChunk(recv, total, bps)
    );
    const buf = await djiBlob.arrayBuffer();
    await idbPut(KEY_DJI, buf);
    baseBytes += buf.byteLength;
    djiTotal = buf.byteLength;
  } catch (e) {
    console.warn("dji download failed", e);
  }

  grandTotal = pmTotal + osmTotal + djiTotal;
  await installPmtilesProtocol(pmBlob).catch(e => console.warn("pmtiles install failed", e));
  const osmInIdb = await idbGet(KEY_OSM).catch(() => null);
  if (osmInIdb) {
    await installOsmBaseProtocol(osmInIdb).catch(e => console.warn("osm-base install failed", e));
  }
  if (onProgress) onProgress(1, baseBytes, grandTotal, 0);
  try { localStorage.setItem("uomtiles.installed", "1"); } catch (_) {}
  return await getStatus();
}

async function purge() {
  await Promise.all([idbDel(KEY_PMTILES), idbDel(KEY_OSM), idbDel(KEY_DJI)]);
  try { localStorage.removeItem("uomtiles.installed"); } catch (_) {}
  // Best-effort: clear caches and unregister SW.
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (_) {}
  window.__uomOfflinePM = null;
  window.__uomOfflineOsmPM = null;
  pmtilesProtocolRegistered = false;
  if (window.maplibregl && window.maplibregl.removeProtocol) {
    try { window.maplibregl.removeProtocol("pmtiles"); } catch (_) {}
  }
}

async function getCachedDji() {
  const buf = await idbGet(KEY_DJI).catch(() => null);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (_) { return null; }
}

window.__uomOffline = {
  init, download, purge, getStatus,
  installPmtilesProtocol, installOsmBaseProtocol, getCachedDji,
  KEY_PMTILES, KEY_OSM, KEY_DJI,
};
})();
