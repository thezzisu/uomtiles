// offline.js — IDB blob store + pmtiles addProtocol + DJI cache for full offline.
// Loaded after pmtiles.js. Exposes window.__uomOffline.

(() => {
"use strict";

const DB = "uomtiles-offline";
const STORE = "blobs";
const KEY_PMTILES = "uom-pmtiles";
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
    const [pm, dji] = await Promise.all([idbGet(KEY_PMTILES), idbGet(KEY_DJI)]);
    return {
      installed: !!pm,
      pmtilesSize: pm ? pm.size : 0,
      djiSize: dji ? (dji.byteLength || dji.size || 0) : 0,
    };
  } catch (_) {
    return { installed: false, pmtilesSize: 0, djiSize: 0 };
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
async function installPmtilesProtocol(blob) {
  if (!window.pmtiles || !window.maplibregl) return false;
  // Duck-typed FileSource: needs `name` (key) + `slice(o, o+l).arrayBuffer()`.
  const fakeFile = {
    name: KEY_PMTILES,
    slice: (a, b) => blob.slice(a, b),
    arrayBuffer: () => blob.arrayBuffer(),
  };
  const source = new window.pmtiles.FileSource(fakeFile);
  const pm = new window.pmtiles.PMTiles(source);
  if (!pmtilesProtocolRegistered) {
    pmtilesProtocolInstance = new window.pmtiles.Protocol();
    window.maplibregl.addProtocol("pmtiles", pmtilesProtocolInstance.tile.bind(pmtilesProtocolInstance));
    pmtilesProtocolRegistered = true;
  }
  pmtilesProtocolInstance.add(pm);
  window.__uomOfflinePM = pm;
  return true;
}

async function init() {
  const blob = await idbGet(KEY_PMTILES).catch(() => null);
  if (blob) {
    try { localStorage.setItem("uomtiles.installed", "1"); } catch (_) {}
    await installPmtilesProtocol(blob).catch(e => console.warn("pmtiles install failed", e));
  }
  return { installed: !!blob };
}

async function download(onProgress) {
  // Probe content-length for both assets so we can show a single, accurate
  // progress meter that covers UOM (pmtiles) + DJI (geojson).
  const probe = async url => {
    try {
      const r = await fetch(url, { method: "HEAD" });
      const cl = parseInt(r.headers.get("content-length") || "0", 10);
      return cl > 0 ? cl : 0;
    } catch (_) { return 0; }
  };
  let [pmTotal, djiTotal] = await Promise.all([
    probe("/uom-shifei.pmtiles"),
    probe("/dji.geojson"),
  ]);
  // DJI fallback estimate: 6 MB is a safe upper bound for the geojson;
  // real value will overwrite this once the first chunk arrives.
  if (!djiTotal) djiTotal = 6 * 1024 * 1024;
  let grandTotal = pmTotal + djiTotal;

  let baseBytes = 0;
  const onChunk = (recv, total, bps) => {
    if (!onProgress) return;
    const merged = baseBytes + recv;
    // If a stream reports a more accurate total than our probe, adopt it.
    if (total) {
      const expected = baseBytes ? pmTotal + total : total + djiTotal;
      if (expected > grandTotal) grandTotal = expected;
    }
    const ratio = grandTotal ? Math.min(1, merged / grandTotal) : 0;
    onProgress(ratio, merged, grandTotal, bps);
  };

  const pmBlob = await downloadBlob(
    "/uom-shifei.pmtiles",
    (_p, recv, total, bps) => onChunk(recv, total, bps)
  );
  await idbPut(KEY_PMTILES, pmBlob);
  baseBytes += pmBlob.size;
  if (pmBlob.size > pmTotal) pmTotal = pmBlob.size;

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

  grandTotal = pmTotal + djiTotal;
  await installPmtilesProtocol(pmBlob).catch(e => console.warn("pmtiles install failed", e));
  if (onProgress) onProgress(1, baseBytes, grandTotal, 0);
  try { localStorage.setItem("uomtiles.installed", "1"); } catch (_) {}
  return await getStatus();
}

async function purge() {
  await Promise.all([idbDel(KEY_PMTILES), idbDel(KEY_DJI)]);
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
  init, download, purge, getStatus, installPmtilesProtocol, getCachedDji,
  KEY_PMTILES, KEY_DJI,
};
})();
