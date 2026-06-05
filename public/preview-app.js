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

// ---------- Layer ordering invariant ----------
// Stack from bottom: bg-fallback → basemap-* → uom-overlay → dji-fill → dji-line.
// Call pinTopLayers() any time layers are added or basemap is swapped.
function pinTopLayers() {
  const order = ["uom-overlay", "dji-fill", "dji-line"];
  order.forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
}

// ---------- Basemap matrix (provider rows × variant chips) ----------
let currentBasemapId = initialBasemapId;
function applyBasemap(id) {
  // Always remove existing basemap layers (id=null leaves us with bg-fallback only).
  map.getStyle().layers
    .filter(l => l.metadata && l.metadata.basemap)
    .forEach(l => map.removeLayer(l.id));
  if (id) {
    const cfg = basemaps.find(b => b.id === id);
    if (cfg) {
      cfg.sources.forEach((src, i) => {
        map.addLayer(
          { id: "basemap-" + i, type: "raster", source: src, metadata: { basemap: true } },
          "uom-overlay",
        );
      });
    }
  }
  currentBasemapId = id;
  document.querySelectorAll(".bm-row .chip").forEach(c => {
    c.setAttribute("aria-pressed", c.dataset.id === id ? "true" : "false");
  });
  pinTopLayers();
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
    btn.addEventListener("click", () => {
      const isSelected = btn.getAttribute("aria-pressed") === "true";
      applyBasemap(isSelected ? null : it.id);
    });
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
    let data;
    if (window.__uomOffline) {
      data = await window.__uomOffline.getCachedDji().catch(() => null);
    }
    if (!data) {
      const res = await fetch("/dji.geojson");
      if (!res.ok) return;
      data = await res.json();
    }
    if (!map.getSource("dji")) map.addSource("dji", { type: "geojson", data });
    const fillSpec = ["match", ["get", "type"], "restricted", "#ff6b6b", "warning", "#feca57", "auth", "#feca57", "recommended", "#48dbfb", "#888"];
    const opacitySpec = ["match", ["get", "type"], "restricted", 0.20, "warning", 0.15, "auth", 0.15, "recommended", 0.10, 0.10];
    if (!map.getLayer("dji-fill")) {
      map.addLayer({ id: "dji-fill", type: "fill", source: "dji", paint: { "fill-color": fillSpec, "fill-opacity": opacitySpec }, metadata: { dji: true } });
    }
    if (!map.getLayer("dji-line")) {
      map.addLayer({ id: "dji-line", type: "line", source: "dji", paint: { "line-color": fillSpec, "line-width": 1 }, metadata: { dji: true } });
    }
    pinTopLayers();
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
function applyBgColor() {
  const c = window.__uomTheme && window.__uomTheme.bgColorForTheme();
  if (c && map.getLayer("bg-fallback")) map.setPaintProperty("bg-fallback", "background-color", c);
}
function setTheme(t) {
  localStorage.setItem("uomtiles.theme", t);
  document.documentElement.dataset.theme = t;
  applyBgColor();
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
// React to OS-level theme change when in "system" mode
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (getTheme() === "system") applyBgColor();
});

// ---------- Panels collapse ----------
const controls = document.getElementById("controls");
const ctrlHead = document.getElementById("ctrl-head");
const ctrlBody = document.querySelector("#controls .ctrl-body");
// Initial collapsed state is set via inline script in preview.html (FOUC-free).

if (!isMobile) {
  ctrlHead.addEventListener("click", e => {
    if (e.target.closest(".ico-btn")) return;
    controls.classList.toggle("collapsed");
  });
} else {
  // Mobile drawer drag (only via .ctrl-head):
  //  - During drag: temporarily expand (no transition) so head+body move as one unit.
  //  - On release: clean up transform, let CSS class transition (grid-rows) animate.
  let dragState = null;

  ctrlHead.addEventListener("pointerdown", e => {
    if (e.target.closest(".ico-btn")) return;
    e.preventDefault();
    e.stopPropagation();

    const startCollapsed = controls.classList.contains("collapsed");

    // Disable all transitions for drag.
    controls.style.transition = "none";
    ctrlBody.style.transition = "none";

    // If starting collapsed, expand instantly so we can drag the full sheet,
    // then offset it by bodyHeight so it visually still looks collapsed.
    if (startCollapsed) controls.classList.remove("collapsed");
    void controls.offsetHeight; // force reflow
    const bodyH = ctrlBody.offsetHeight;
    if (startCollapsed) controls.style.transform = `translateY(${bodyH}px)`;
    void controls.offsetHeight;

    dragState = {
      startY: e.clientY,
      lastY: e.clientY,
      startTime: Date.now(),
      moved: false,
      startCollapsed,
      bodyH,
    };

    const onMove = ev => {
      if (!dragState) return;
      ev.preventDefault();
      dragState.lastY = ev.clientY;
      const dy = dragState.lastY - dragState.startY;
      if (Math.abs(dy) > 4) dragState.moved = true;

      const baseOffset = dragState.startCollapsed ? dragState.bodyH : 0;
      const translate = Math.min(dragState.bodyH, Math.max(0, baseOffset + dy));
      controls.style.transform = `translateY(${translate}px)`;
    };

    const onUp = () => {
      if (!dragState) return;
      const { startY, lastY, startTime, moved, startCollapsed, bodyH } = dragState;
      dragState = null;

      const dy = lastY - startY;
      const dt = Date.now() - startTime || 1;
      const velocity = dy / dt;
      const fastFlick = Math.abs(velocity) > 0.5;

      let finalCollapsed;
      if (!moved && !fastFlick) {
        finalCollapsed = !startCollapsed;
      } else if (startCollapsed) {
        finalCollapsed = !(dy < -30 || (fastFlick && velocity < 0));
      } else {
        finalCollapsed = (dy > 60 || (fastFlick && velocity > 0));
      }

      // Two-phase animation to eliminate flicker:
      //  1. Animate transform to its final visual position (no class change yet).
      //  2. After the transform animation ends, snap class + clear transform
      //     atomically with NO transition — body height changes invisibly.
      const targetTranslate = finalCollapsed ? bodyH : 0;
      controls.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
      controls.style.transform = `translateY(${targetTranslate}px)`;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        controls.removeEventListener("transitionend", onTrans);
        // Freeze all transitions during the swap.
        controls.style.transition = "none";
        ctrlBody.style.transition = "none";
        controls.classList.toggle("collapsed", finalCollapsed);
        controls.style.transform = "";
        // Force reflow so the class change takes effect at the frozen state.
        void controls.offsetHeight;
        // Restore transitions on next frame so future toggles animate.
        requestAnimationFrame(() => {
          controls.style.transition = "";
          ctrlBody.style.transition = "";
        });
      };
      const onTrans = ev => {
        if (ev.propertyName !== "transform") return;
        finish();
      };
      controls.addEventListener("transitionend", onTrans);
      setTimeout(finish, 260); // safety fallback

      window.removeEventListener("pointermove", onMove, { passive: false });
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  controls.addEventListener("pointerdown", e => e.stopPropagation());

  // Outside tap collapses the drawer (only when expanded).
  document.addEventListener("pointerdown", e => {
    if (controls.classList.contains("collapsed")) return;
    if (e.target.closest("#controls")) return;
    if (e.target.closest("#settings-overlay")) return;
    if (e.target.closest("#search-wrap")) return;
    controls.classList.add("collapsed");
  }, true);
}

window.__uomApp = { applyBasemap, applyColor, applyAlpha, COLOR_PRESETS, colorToHueRotate };

// ---------- Offline / PWA ----------
(function(){
  const off = window.__uomOffline;
  if (!off) return;

  const AUTO_KEY = "uomtiles.autoOffline";
  function autoEnabled() { return localStorage.getItem(AUTO_KEY) !== "false"; }
  function setAuto(v) { localStorage.setItem(AUTO_KEY, v ? "true" : "false"); }

  const statusEl = document.getElementById("offline-status");
  const progEl = document.getElementById("offline-progress");
  const barEl = document.getElementById("offline-bar");
  const pctEl = document.getElementById("offline-pct");
  const autoToggle = document.getElementById("offline-auto");
  const btnRetry = document.getElementById("offline-retry");
  const btnPurge = document.getElementById("offline-purge");
  const btnInstall = document.getElementById("offline-install");

  let downloading = false;
  let lastError = null;

  function fmt(bytes) {
    if (!bytes) return "0";
    if (bytes >= 1024*1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024).toFixed(0) + " KB";
  }

  async function refresh() {
    autoToggle.checked = autoEnabled();
    const s = await off.getStatus();
    if (downloading) {
      progEl.classList.remove("hidden");
      statusEl.textContent = "下载中…";
      btnRetry.classList.add("hidden");
      btnPurge.classList.add("hidden");
      return;
    }
    progEl.classList.add("hidden");
    if (s.installed) {
      statusEl.innerHTML = `已离线 <span class="ok">✓ ${fmt(s.pmtilesSize)}</span>`;
      btnRetry.classList.add("hidden");
      btnPurge.classList.remove("hidden");
    } else if (lastError) {
      statusEl.innerHTML = `<span class="err">下载失败: ${lastError}</span>`;
      btnRetry.classList.remove("hidden");
      btnPurge.classList.add("hidden");
    } else if (autoEnabled()) {
      statusEl.textContent = "正在准备离线…";
      btnRetry.classList.add("hidden");
      btnPurge.classList.add("hidden");
    } else {
      statusEl.textContent = "在线模式（自动离线已关闭）";
      btnRetry.classList.add("hidden");
      btnPurge.classList.add("hidden");
    }
  }

  async function swapToOfflineSources() {
    if (window.__uomOfflinePM) {
      const newSrc = { type: "raster", url: "pmtiles://uom-pmtiles", tileSize: 256, attribution: "UOM 适飞" };
      const layers = map.getStyle().layers.filter(l => l.source === "uom").map(l => ({...l}));
      layers.forEach(l => map.getLayer(l.id) && map.removeLayer(l.id));
      if (map.getSource("uom")) map.removeSource("uom");
      map.addSource("uom", newSrc);
      layers.forEach(l => map.addLayer(l));
    }
    const dji = await off.getCachedDji();
    if (dji && map.getSource("dji")) {
      map.getSource("dji").setData(dji);
    }
    pinTopLayers();
  }

  async function runDownload() {
    if (downloading) return;
    downloading = true;
    lastError = null;
    refresh();
    barEl.style.width = "0%";
    pctEl.textContent = "0%";
    try {
      await off.download((p) => {
        const pct = Math.round(p * 100);
        barEl.style.width = pct + "%";
        pctEl.textContent = pct + "%";
      });
      await swapToOfflineSources();
    } catch (e) {
      lastError = (e && e.message) ? e.message : String(e);
    } finally {
      downloading = false;
      refresh();
    }
  }

  function scheduleIdle(fn) {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(fn, { timeout: 5000 });
    } else {
      setTimeout(fn, 500);
    }
  }

  async function maybeAutoDownload() {
    if (!autoEnabled() || downloading) return;
    const s = await off.getStatus();
    if (s.installed) return;
    scheduleIdle(runDownload);
  }

  autoToggle.addEventListener("change", () => {
    setAuto(autoToggle.checked);
    refresh();
    if (autoToggle.checked) maybeAutoDownload();
  });

  btnRetry.addEventListener("click", () => {
    lastError = null;
    runDownload();
  });

  btnPurge.addEventListener("click", async () => {
    if (!confirm("删除离线数据？已下载的瓦片将无法离线访问。\n（如果保持「自动离线」开启，下次访问会自动重新下载）")) return;
    await off.purge();
    refresh();
    setTimeout(() => location.reload(), 500);
  });

  btnInstall.addEventListener("click", async () => {
    const dp = window.__uomDeferredPrompt;
    if (!dp) {
      alert("当前浏览器不支持安装提示。\niOS Safari: 分享 → 添加到主屏幕");
      return;
    }
    dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === "accepted") btnInstall.classList.add("hidden");
    window.__uomDeferredPrompt = null;
  });

  // Init: wire pmtiles protocol if blob already in IDB; then maybe auto-download.
  off.init().then(({ installed }) => {
    refresh();
    if (installed) {
      if (map.loaded()) swapToOfflineSources();
      else map.once("load", swapToOfflineSources);
    } else {
      maybeAutoDownload();
    }
  });
})();

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
