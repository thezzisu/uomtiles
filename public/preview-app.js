// preview-app.js — UI bindings: layer switcher, opacity, color presets,
// DJI overlay, POI search via Amap inputtips. Runs after preview.js.
(() => {
"use strict";

const { map, basemaps, initialBasemapId } = window.__uomState;
const { wgs84ToGcj02, gcj02ToWgs84 } = window.__uomCoord;
const isMobile = window.matchMedia("(max-width: 640px)").matches;

const COLOR_PRESETS = [
  { name: "蓝", hex: "#2980b9" },
  { name: "青", hex: "#1abc9c" },
  { name: "绿", hex: "#27ae60" },
  { name: "黄", hex: "#f1c40f" },
  { name: "橙", hex: "#e67e22" },
  { name: "红", hex: "#e74c3c" },
  { name: "粉", hex: "#e91e63" },
  { name: "紫", hex: "#9b59b6" },
];
const SRC_HUE = 205;
function hexToHue(hex) {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hh;
  if (max === r) hh = ((g - b) / d) % 6;
  else if (max === g) hh = (b - r) / d + 2;
  else hh = (r - g) / d + 4;
  hh *= 60;
  if (hh < 0) hh += 360;
  return hh;
}
function colorToHueRotate(hex) {
  return ((hexToHue(hex) - SRC_HUE + 720) % 360);
}

// ---------- Basemap matrix (provider rows × variant chips) ----------
let currentBasemapId = initialBasemapId;
function applyBasemap(id) {
  const cfg = basemaps.find(b => b.id === id);
  if (!cfg) return;
  map.getStyle().layers
    .filter(l => l.metadata && l.metadata.basemap)
    .forEach(l => map.removeLayer(l.id));
  cfg.sources.forEach((src, i) => {
    map.addLayer(
      { id: "basemap-" + i, type: "raster", source: src, metadata: { basemap: true } },
      "uom-overlay",
    );
  });
  currentBasemapId = id;
  document.querySelectorAll(".bm-row .chip").forEach(c => {
    c.setAttribute("aria-pressed", c.dataset.id === id ? "true" : "false");
  });
}

const basemapList = document.getElementById("basemap-list");
const byProvider = new Map();
basemaps.forEach(b => {
  if (!byProvider.has(b.provider)) byProvider.set(b.provider, []);
  byProvider.get(b.provider).push(b);
});
byProvider.forEach((items, provider) => {
  const row = document.createElement("div");
  row.className = "bm-row";
  const lbl = document.createElement("span");
  lbl.className = "label";
  lbl.textContent = provider;
  const chips = document.createElement("div");
  chips.className = "chips";
  items.forEach(it => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = it.name;
    btn.dataset.id = it.id;
    btn.setAttribute("aria-pressed", it.id === initialBasemapId ? "true" : "false");
    btn.addEventListener("click", () => applyBasemap(it.id));
    chips.appendChild(btn);
  });
  row.appendChild(lbl);
  row.appendChild(chips);
  basemapList.appendChild(row);
});

// ---------- Color swatches + opacity ----------
const swatchesEl = document.getElementById("color-swatches");
let activeColor = "#2980b9";
function applyColor(hex) {
  activeColor = hex;
  const deg = colorToHueRotate(hex);
  if (map.getLayer("uom-overlay")) map.setPaintProperty("uom-overlay", "raster-hue-rotate", deg);
  swatchesEl.querySelectorAll("button").forEach(s => s.setAttribute("aria-pressed", s.dataset.hex === hex ? "true" : "false"));
}
COLOR_PRESETS.forEach(c => {
  const s = document.createElement("button");
  s.type = "button";
  s.title = c.name;
  s.dataset.hex = c.hex;
  s.style.color = c.hex;
  s.setAttribute("aria-pressed", c.hex === activeColor ? "true" : "false");
  s.addEventListener("click", () => applyColor(c.hex));
  swatchesEl.appendChild(s);
});

const alphaInp = document.getElementById("uom-alpha");
const alphaVal = document.getElementById("alpha-val");
function applyAlpha(v) {
  alphaVal.textContent = String(v);
  if (map.getLayer("uom-overlay")) map.setPaintProperty("uom-overlay", "raster-opacity", v / 100);
}
alphaInp.addEventListener("input", e => applyAlpha(+e.target.value));

// ---------- UOM toggle ----------
document.getElementById("uom-toggle").addEventListener("change", e => {
  if (!map.getLayer("uom-overlay")) return;
  map.setLayoutProperty("uom-overlay", "visibility", e.target.checked ? "visible" : "none");
});

// ---------- DJI overlay ----------
let djiVisible = true;
async function loadDji() {
  try {
    const res = await fetch("/dji.geojson");
    if (!res.ok) return;
    const data = await res.json();
    if (!map.getSource("dji")) map.addSource("dji", { type: "geojson", data });
    const fillSpec = ["match", ["get", "type"], "restricted", "#ff6b6b", "warning", "#feca57", "auth", "#feca57", "recommended", "#48dbfb", "#888"];
    const opacitySpec = ["match", ["get", "type"], "restricted", 0.20, "warning", 0.15, "auth", 0.15, "recommended", 0.10, 0.10];
    if (!map.getLayer("dji-fill")) {
      map.addLayer({ id: "dji-fill", type: "fill", source: "dji", paint: { "fill-color": fillSpec, "fill-opacity": opacitySpec } });
    }
    if (!map.getLayer("dji-line")) {
      map.addLayer({ id: "dji-line", type: "line", source: "dji", paint: { "line-color": fillSpec, "line-width": 1 } });
    }
    map.on("click", "dji-fill", e => {
      if (!e.features || e.features.length === 0) return;
      const f = e.features[0];
      const p = f.properties || {};
      const html = `<b>${escapeHtml(p.name || "(unnamed)")}</b><br>type=${escapeHtml(p.type || "?")}` + (p.sub_type ? `<br>sub=${escapeHtml(p.sub_type)}` : "");
      new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on("mouseenter", "dji-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "dji-fill", () => { map.getCanvas().style.cursor = ""; });
  } catch (e) { console.warn("DJI load", e); }
}
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }

map.on("load", () => {
  loadDji();
  applyAlpha(60);
  applyColor(activeColor);
});

document.getElementById("dji-toggle").addEventListener("change", e => {
  djiVisible = e.target.checked;
  ["dji-fill", "dji-line"].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", djiVisible ? "visible" : "none");
  });
});

// ---------- Z label ----------
// (handled by LevelControl in preview.js)

// ---------- Theme cycle (system → light → dark → system) ----------
const THEMES = ["system", "light", "dark"];
function getTheme() { return localStorage.getItem("uomtiles.theme") || "system"; }
function setTheme(t) {
  localStorage.setItem("uomtiles.theme", t);
  document.documentElement.dataset.theme = t;
}
const themeBtn = document.getElementById("theme-toggle");
if (themeBtn) {
  themeBtn.addEventListener("click", e => {
    e.stopPropagation();
    const cur = getTheme();
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    setTheme(next);
  });
}

// ---------- Panels collapse ----------
const controls = document.getElementById("controls");
const ctrlHead = document.getElementById("ctrl-head");
if (isMobile) controls.classList.add("collapsed");

if (!isMobile) {
  ctrlHead.addEventListener("click", e => {
    if (e.target.closest(".ico-btn")) return;
    controls.classList.toggle("collapsed");
  });
} else {
  // Mobile: tap toggles, drag (down=close, up=open) with live transform preview.
  let startY = 0, lastY = 0, dragging = false, moved = false, startCollapsed = false;
  let onMove = null, onUp = null;

  const onDown = e => {
    if (e.target.closest(".ico-btn")) return;
    startY = lastY = e.clientY;
    dragging = true;
    moved = false;
    startCollapsed = controls.classList.contains("collapsed");
    controls.style.transition = "none";
    e.preventDefault();
    onMove = ev => {
      if (!dragging) return;
      lastY = ev.clientY;
      const dy = lastY - startY;
      if (Math.abs(dy) > 4) moved = true;
      if (!startCollapsed && dy > 0) {
        controls.style.transform = `translateY(${Math.min(dy, controls.scrollHeight)}px)`;
      } else if (startCollapsed && dy < 0) {
        // Show a slight pull-up cue.
        controls.style.transform = `translateY(${Math.max(dy, -40)}px)`;
      }
      ev.preventDefault();
    };
    onUp = () => {
      if (!dragging) return;
      dragging = false;
      controls.style.transition = "";
      controls.style.transform = "";
      const dy = lastY - startY;
      if (!moved) {
        controls.classList.toggle("collapsed");
      } else if (!startCollapsed && dy > 60) {
        controls.classList.add("collapsed");
      } else if (startCollapsed && dy < -30) {
        controls.classList.remove("collapsed");
      }
      window.removeEventListener("pointermove", onMove, { passive: false });
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  ctrlHead.addEventListener("pointerdown", onDown);
}

window.__uomApp = { applyBasemap, applyColor, applyAlpha, COLOR_PRESETS, colorToHueRotate };

// ---------- Settings dialog ----------
const settingsOverlay = document.getElementById("settings-overlay");
const keyInput = document.getElementById("amap-key-input");
function getAmapKey() { return localStorage.getItem("uomtiles.amapKey") || ""; }
function setAmapKey(k) { if (k) localStorage.setItem("uomtiles.amapKey", k); else localStorage.removeItem("uomtiles.amapKey"); refreshSearchVisibility(); }
function openSettings() {
  keyInput.value = getAmapKey();
  settingsOverlay.classList.add("open");
  setTimeout(() => keyInput.focus(), 50);
}
document.getElementById("open-settings").addEventListener("click", openSettings);
document.getElementById("amap-key-save").addEventListener("click", () => { setAmapKey(keyInput.value.trim()); settingsOverlay.classList.remove("open"); });
document.getElementById("amap-key-clear").addEventListener("click", () => { keyInput.value = ""; setAmapKey(""); settingsOverlay.classList.remove("open"); });
document.getElementById("amap-key-cancel").addEventListener("click", () => settingsOverlay.classList.remove("open"));
settingsOverlay.addEventListener("click", e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove("open"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") settingsOverlay.classList.remove("open"); });

// ---------- POI search (Amap inputtips, client-side, key in localStorage) ----------
const searchWrap = document.getElementById("search-wrap");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchIcon = document.getElementById("search-icon");
function refreshSearchVisibility() { searchWrap.classList.toggle("hidden", !getAmapKey()); }
refreshSearchVisibility();
if (isMobile) searchWrap.dataset.collapsed = "true";
searchIcon.addEventListener("click", () => {
  if (searchWrap.dataset.collapsed === "true") {
    searchWrap.dataset.collapsed = "false";
    setTimeout(() => searchInput.focus(), 50);
  } else if (!searchInput.value) {
    if (isMobile) searchWrap.dataset.collapsed = "true";
  }
});

let searchTimer, searchAbort, searchHighlight = -1, lastResults = [], searchMarker;
async function doSearch(q) {
  const key = getAmapKey();
  if (!key || !q) { searchResults.classList.remove("open"); return; }
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const c = map.getCenter();
  const [gLon, gLat] = wgs84ToGcj02(c.lng, c.lat);
  const url = "https://restapi.amap.com/v3/assistant/inputtips?key=" + encodeURIComponent(key)
    + "&keywords=" + encodeURIComponent(q)
    + "&location=" + gLon.toFixed(6) + "," + gLat.toFixed(6)
    + "&output=json&datatype=poi";
  try {
    const r = await fetch(url, { signal: searchAbort.signal });
    const j = await r.json();
    if (j.status !== "1") { renderResults([], j.info || ("请求失败 " + (j.infocode || "?"))); return; }
    const tips = (j.tips || []).filter(t => t.location && typeof t.location === "string");
    const items = tips.slice(0, 8).map(t => {
      const [lon, lat] = t.location.split(",").map(Number);
      const [wLon, wLat] = gcj02ToWgs84(lon, lat);
      return { name: t.name, addr: (t.district || "") + (t.address ? " " + t.address : ""), lat: wLat, lon: wLon };
    });
    lastResults = items;
    renderResults(items);
  } catch (e) { if (e.name !== "AbortError") renderResults([], "网络错误: " + e.message); }
}
function renderResults(items, errMsg) {
  searchResults.innerHTML = "";
  searchHighlight = -1;
  if (errMsg) {
    const d = document.createElement("div"); d.className = "empty"; d.textContent = errMsg;
    searchResults.appendChild(d); searchResults.classList.add("open"); return;
  }
  if (items.length === 0) { searchResults.classList.remove("open"); return; }
  items.forEach((it, idx) => {
    const d = document.createElement("div");
    d.className = "item";
    const n = document.createElement("div"); n.className = "name"; n.textContent = it.name;
    const a = document.createElement("div"); a.className = "addr"; a.textContent = it.addr;
    d.appendChild(n); d.appendChild(a);
    d.addEventListener("click", () => pickResult(idx));
    searchResults.appendChild(d);
  });
  searchResults.classList.add("open");
}
function pickResult(idx) {
  const it = lastResults[idx]; if (!it) return;
  map.flyTo({ center: [it.lon, it.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  if (searchMarker) searchMarker.remove();
  searchMarker = new maplibregl.Marker().setLngLat([it.lon, it.lat])
    .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML("<b>" + escapeHtml(it.name) + "</b><br>" + escapeHtml(it.addr)))
    .addTo(map);
  searchMarker.togglePopup();
  searchResults.classList.remove("open");
  if (isMobile) { searchInput.blur(); searchWrap.dataset.collapsed = "true"; }
}
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.remove("open"); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
});
searchInput.addEventListener("focus", () => { if (lastResults.length) searchResults.classList.add("open"); });
searchInput.addEventListener("keydown", e => {
  const items = searchResults.querySelectorAll(".item");
  if (e.key === "Escape") { searchInput.blur(); searchResults.classList.remove("open"); return; }
  if (!items.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); searchHighlight = Math.min(items.length - 1, searchHighlight + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); searchHighlight = Math.max(0, searchHighlight - 1); }
  else if (e.key === "Enter") { e.preventDefault(); pickResult(searchHighlight < 0 ? 0 : searchHighlight); return; }
  else return;
  items.forEach((it, i) => it.classList.toggle("active", i === searchHighlight));
});
document.addEventListener("click", e => { if (!searchWrap.contains(e.target)) searchResults.classList.remove("open"); });
})();
