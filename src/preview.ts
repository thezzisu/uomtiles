// Inline HTML for the /preview route.
//
// Architecture (WGS-84 native + reverse-correction for GCJ-02 basemaps):
//
//   Leaflet runs in EPSG:3857 / WGS-84 (default). Our UOM raster + DJI
//   overlay are WGS-84 → align perfectly.
//
//   For Chinese basemaps that use GCJ-02 (高德, 腾讯, 百度, Google.cn),
//   we use:
//     - Leaflet.ChineseTmsProviders : URL templates + L.tileLayer.chinaProvider
//     - Leaflet.InternetMapCorrection : auto-intercepts tile fetches and applies
//       reverse WGS-84 → GCJ-02 lat/lon transformation when computing tile coords,
//       so the basemap shifts to match the WGS-84 map view.
//
//   This is the canonical, smooth, jitter-free fix. See
//   https://github.com/htoooth/Leaflet.ChineseTmsProviders
//   https://github.com/gisarmory/Leaflet.InternetMapCorrection

export function buildPreviewHtml(tiandituToken: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>UOM 适飞空域预览</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html,body,#map{height:100%;margin:0;background:#111;color:#ddd;font:13px/1.5 system-ui,sans-serif;overscroll-behavior:none}
    button,input,select,a{touch-action:manipulation}
    .uom-crisp img.leaflet-tile{image-rendering:pixelated;image-rendering:crisp-edges}
    #zlabel{position:absolute;top:8px;left:60px;z-index:1000;padding:4px 10px;background:#000a;color:#fff;border-radius:4px;font:13px system-ui;pointer-events:none}
    .leaflet-control-attribution{font-size:9px;background:#000a !important;color:#bbb}
    .leaflet-control-attribution a{color:#9cc}
    .dji-tip{font-size:12px;line-height:1.4}
    .legend{position:absolute;bottom:24px;left:8px;z-index:1000;padding:8px 12px;background:#000c;color:#fff;border-radius:6px;max-width:240px;font-size:11px}
    .legend h4{margin:0 0 4px;font-size:12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
    .legend h4 .toggle{font-size:10px;opacity:.7}
    .legend.collapsed .legend-body{display:none}
    .legend p{margin:2px 0;font-size:11px}
    .legend .swatch{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;margin-right:4px}
    #controls{position:absolute;top:8px;right:8px;z-index:1000;padding:10px;background:#000c;color:#fff;border-radius:6px;display:flex;flex-direction:column;gap:8px;min-width:170px;font-size:12px}
    #controls .ctrl-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;font-weight:bold;font-size:12px}
    #controls.collapsed .ctrl-body{display:none}
    #controls label{display:flex;align-items:center;gap:6px;line-height:1.6}
    #controls input[type=range]{flex:1;min-width:60px}
    #controls input[type=color]{width:36px;height:28px;border:0;padding:0;background:transparent;cursor:pointer}
    #controls input[type=checkbox]{width:18px;height:18px;cursor:pointer}
    .leaflet-bar a{background:#fff;width:34px;height:34px;line-height:34px;font-size:16px}
    .locate-btn{font-size:18px}
    .me-marker{filter:drop-shadow(0 0 4px #4a90e2)}
    .leaflet-control-layers{font-size:13px;background:#fff !important;color:#222}
    .leaflet-control-layers-expanded{padding:6px 10px}
    .leaflet-control-layers label{padding:3px 0}

    @media (max-width: 640px) {
      #zlabel{font-size:11px;padding:3px 8px}
      #controls{top:auto;right:8px;bottom:64px;min-width:0;padding:8px}
      #controls input[type=range]{width:100px}
      .legend{bottom:8px;left:8px;font-size:10px;padding:6px 10px;max-width:60vw}
      .legend p{font-size:10px}
      .leaflet-bar a{width:38px;height:38px;line-height:38px;font-size:18px}
      #search-wrap{left:8px;right:8px;top:8px;max-width:none}
      #search-wrap.collapsed input{display:none}
      #search-wrap.collapsed{width:38px}
    }
    /* Search bar + dropdown */
    #search-wrap{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:1000;width:min(420px,90vw);display:flex;align-items:center;gap:6px;background:#fff;border-radius:6px;padding:4px 8px;box-shadow:0 2px 8px #0006}
    #search-wrap.hidden{display:none}
    #search-wrap input{flex:1;border:0;outline:0;font:14px system-ui;padding:6px 4px;background:transparent;color:#222}
    #search-icon{font-size:16px;color:#666;cursor:pointer;user-select:none;padding:2px 4px}
    #search-results{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:#fff;border-radius:6px;box-shadow:0 4px 12px #0006;max-height:60vh;overflow:auto;display:none}
    #search-results.open{display:block}
    #search-results .item{padding:8px 12px;border-bottom:1px solid #eee;cursor:pointer;color:#222}
    #search-results .item:last-child{border-bottom:0}
    #search-results .item:hover,#search-results .item.active{background:#eef}
    #search-results .item .name{font-size:14px;font-weight:500}
    #search-results .item .addr{font-size:11px;color:#888;margin-top:2px}
    #search-results .empty{padding:8px 12px;color:#888;font-size:12px}
    /* Settings dialog */
    #settings-overlay{position:absolute;inset:0;background:#000a;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px}
    #settings-overlay.open{display:flex}
    #settings-panel{background:#222;color:#fff;border-radius:8px;padding:20px;max-width:480px;width:100%;box-shadow:0 8px 32px #0009}
    #settings-panel h3{margin:0 0 12px;font-size:16px}
    #settings-panel p{font-size:12px;line-height:1.5;color:#bbb;margin:8px 0}
    #settings-panel a{color:#69c}
    #settings-panel input{width:100%;box-sizing:border-box;padding:8px 10px;font:13px monospace;border:1px solid #555;background:#111;color:#fff;border-radius:4px;margin-top:4px}
    #settings-panel .btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
    #settings-panel button{padding:8px 16px;border:0;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500}
    #settings-panel .save{background:#4a90e2;color:#fff}
    #settings-panel .clear{background:#444;color:#fff}
    #settings-panel .cancel{background:transparent;color:#888;margin-left:auto}
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="zlabel"></div>
  <div id="controls">
    <div class="ctrl-head" id="ctrl-head"><span>设置</span><span class="toggle">▾</span></div>
    <div class="ctrl-body">
      <label>颜色 <input type="color" id="uom-color" value="#2980b9"></label>
      <label>透明度 <input type="range" id="uom-alpha" min="0" max="255" value="153"><span id="alpha-val">153</span></label>
      <label><input type="checkbox" id="dji-toggle" checked> DJI 限飞</label>
    </div>
  </div>
  <div class="legend" id="legend">
    <h4 id="legend-head"><span>图层说明</span><span class="toggle">▾</span></h4>
    <div class="legend-body">
      <p><span class="swatch" style="background:#2980b9"></span>UOM 适飞空域</p>
      <p><span class="swatch" style="background:#ff6b6b"></span>DJI Restricted</p>
      <p><span class="swatch" style="background:#feca57"></span>DJI Warning / Auth</p>
      <p><span class="swatch" style="background:#48dbfb"></span>DJI Recommended</p>
      <p style="font-size:10px;color:#aaa;margin-top:6px">底图均纠偏到 WGS-84, 与 UOM 数据精确对齐</p>
    </div>
  </div>
  <div id="search-wrap" class="hidden">
    <span id="search-icon">🔍</span>
    <input id="search-input" type="search" placeholder="搜索 POI (高德)" autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div id="settings-overlay">
    <div id="settings-panel">
      <h3>POI 搜索设置</h3>
      <p>需要高德 Web Service Key (免费, <a href="https://lbs.amap.com/api/webservice/create-project-and-key" target="_blank" rel="noopener">点此申请</a>). 创建应用 → 选择 <b>Web 服务</b> → 拿 Key.</p>
      <p>Key 仅存储在你浏览器 localStorage, 不会上传服务端.</p>
      <label style="font-size:12px;color:#bbb">高德 Web Service Key
        <input id="amap-key-input" type="text" placeholder="例如 abcd1234...32位" autocomplete="off">
      </label>
      <div class="btns">
        <button class="save" id="amap-key-save">保存</button>
        <button class="clear" id="amap-key-clear">清除</button>
        <button class="cancel" id="amap-key-cancel">取消</button>
      </div>
    </div>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/htoooth/Leaflet.ChineseTmsProviders/src/leaflet.ChineseTmsProviders.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/gisarmory/Leaflet.InternetMapCorrection/dist/leaflet.mapCorrection.min.js"></script>
  <script>
const TDT_TOKEN = ${JSON.stringify(tiandituToken)};
const isMobile = window.matchMedia('(max-width: 640px)').matches;
const map = L.map('map', {minZoom:2, maxZoom:18, attributionControl:true, zoomControl:true, tap:true, tapTolerance:15}).setView([35, 105], 5);

// WGS-84 native basemaps (no shift)
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OSM'});
const cartoVoy = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'© Esri'});
const opentopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom:17, attribution:'© OpenTopoMap (CC-BY-SA)'});

// Chinese basemaps via chinaProvider + mapCorrection (auto WGS-84 ↔ GCJ-02 inverse transform)
const gaodeVec = L.tileLayer.chinaProvider('GaoDe.Normal.Map', {maxZoom:18, attribution:'© 高德'});
const gaodeSat = L.layerGroup([
  L.tileLayer.chinaProvider('GaoDe.Satellite.Map', {maxZoom:18}),
  L.tileLayer.chinaProvider('GaoDe.Satellite.Annotion', {maxZoom:18}),
], {attribution:'© 高德'});

const baseMaps = {
  'OSM (默认)': osm,
  'CARTO Voyager': cartoVoy,
  'CARTO Dark': cartoDark,
  'ESRI 卫星': esriSat,
  'OpenTopo 地形': opentopo,
  '高德矢量': gaodeVec,
  '高德卫星': gaodeSat,
};

if (TDT_TOKEN) {
  const tdtVec = L.layerGroup([
    L.tileLayer.chinaProvider('TianDiTu.Normal.Map', {key: TDT_TOKEN, maxZoom:18}),
    L.tileLayer.chinaProvider('TianDiTu.Normal.Annotion', {key: TDT_TOKEN, maxZoom:18}),
  ], {attribution:'© 天地图'});
  const tdtSat = L.layerGroup([
    L.tileLayer.chinaProvider('TianDiTu.Satellite.Map', {key: TDT_TOKEN, maxZoom:18}),
    L.tileLayer.chinaProvider('TianDiTu.Satellite.Annotion', {key: TDT_TOKEN, maxZoom:18}),
  ], {attribution:'© 天地图'});
  const tdtTer = L.layerGroup([
    L.tileLayer.chinaProvider('TianDiTu.Terrain.Map', {key: TDT_TOKEN, maxZoom:18}),
    L.tileLayer.chinaProvider('TianDiTu.Terrain.Annotion', {key: TDT_TOKEN, maxZoom:18}),
  ], {attribution:'© 天地图'});
  baseMaps['天地图 矢量'] = tdtVec;
  baseMaps['天地图 卫星'] = tdtSat;
  baseMaps['天地图 地形'] = tdtTer;
}

osm.addTo(map);

// UOM 适飞 overlay
const uom = L.tileLayer('/xyz/{z}/{x}/{y}.png', {minZoom:2, maxZoom:18, maxNativeZoom:13, opacity:1.0, className:'uom-crisp', attribution:'UOM 适飞'}).addTo(map);

// DJI overlay
let djiLayer;
fetch('/dji.geojson').then(r => r.json()).then(geo => {
  const styleByType = {
    warning: {color:'#feca57', weight:1, fillColor:'#feca57', fillOpacity:0.15},
    restricted: {color:'#ff6b6b', weight:1, fillColor:'#ff6b6b', fillOpacity:0.20},
    auth: {color:'#feca57', weight:1, fillColor:'#feca57', fillOpacity:0.15},
    recommended: {color:'#48dbfb', weight:1, fillColor:'#48dbfb', fillOpacity:0.10},
  };
  djiLayer = L.geoJSON(geo, {
    style: f => styleByType[f.properties.type] || {color:'#888',weight:1,fillOpacity:0.1},
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      layer.bindTooltip('<b>'+(p.name||'(unnamed)')+'</b><br>type='+(p.type||'?')+(p.sub_type?'<br>sub='+p.sub_type:''), {sticky:true, className:'dji-tip'});
    }
  }).addTo(map);
}).catch(e => console.warn('DJI load failed', e));

// Layer switcher — collapsed on mobile by default
L.control.layers(baseMaps, {'UOM 适飞': uom}, {collapsed: isMobile, position:'topleft'}).addTo(map);

// Geolocate control
const locateBtn = L.control({position:'topleft'});
locateBtn.onAdd = function() {
  const div = L.DomUtil.create('div', 'leaflet-bar');
  const a = L.DomUtil.create('a', 'locate-btn', div);
  a.href = '#';
  a.title = '定位到当前位置';
  a.innerHTML = '📍';
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.on(a, 'click', L.DomEvent.preventDefault).on(a, 'click', () => {
    map.locate({setView:true, maxZoom:15, enableHighAccuracy:true, timeout:10000});
  });
  return div;
};
locateBtn.addTo(map);

let meMarker, meCircle;
map.on('locationfound', e => {
  if (meMarker) { meMarker.remove(); meCircle.remove(); }
  meCircle = L.circle(e.latlng, {radius: e.accuracy, color:'#4a90e2', fillColor:'#4a90e2', fillOpacity:0.1, weight:1}).addTo(map);
  meMarker = L.circleMarker(e.latlng, {radius:6, color:'#fff', fillColor:'#4a90e2', fillOpacity:1, weight:2, className:'me-marker'}).addTo(map);
  meMarker.bindPopup('你在这里<br>精度 ±' + Math.round(e.accuracy) + 'm').openPopup();
});
map.on('locationerror', e => alert('定位失败: ' + e.message));

function updateZ() { document.getElementById('zlabel').textContent = 'z=' + map.getZoom().toFixed(0); }
map.on('zoomend', updateZ); updateZ();

function refreshUom() {
  const c = document.getElementById('uom-color').value.replace(/^#/, '');
  const a = document.getElementById('uom-alpha').value;
  document.getElementById('alpha-val').textContent = a;
  uom.setUrl('/xyz/{z}/{x}/{y}.png?color=' + c + '&alpha=' + a);
}
document.getElementById('uom-color').addEventListener('input', refreshUom);
document.getElementById('uom-alpha').addEventListener('input', refreshUom);
document.getElementById('dji-toggle').addEventListener('change', e => {
  if (!djiLayer) return;
  if (e.target.checked) djiLayer.addTo(map); else djiLayer.remove();
});

// Collapse controls + legend on mobile by default
const controls = document.getElementById('controls');
const legend = document.getElementById('legend');
if (isMobile) {
  controls.classList.add('collapsed');
  legend.classList.add('collapsed');
}
document.getElementById('ctrl-head').addEventListener('click', () => controls.classList.toggle('collapsed'));
document.getElementById('legend-head').addEventListener('click', () => legend.classList.toggle('collapsed'));
[...document.querySelectorAll('#controls,#legend,#search-wrap,#settings-overlay')].forEach(el => {
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
});

// ----- POI search (高德 Web Service, client-side, user-supplied key) -----
const AMAP_KEY_LS = 'uomtiles.amapKey';
const searchWrap = document.getElementById('search-wrap');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchIcon = document.getElementById('search-icon');
const settingsOverlay = document.getElementById('settings-overlay');
const keyInput = document.getElementById('amap-key-input');

function getAmapKey() { return localStorage.getItem(AMAP_KEY_LS) || ''; }
function setAmapKey(k) { if (k) localStorage.setItem(AMAP_KEY_LS, k); else localStorage.removeItem(AMAP_KEY_LS); refreshSearchVisibility(); }
function refreshSearchVisibility() {
  const has = !!getAmapKey();
  searchWrap.classList.toggle('hidden', !has);
}
refreshSearchVisibility();

// Settings button (gear) in toolbar
const settingsBtn = L.control({position:'topleft'});
settingsBtn.onAdd = function() {
  const div = L.DomUtil.create('div', 'leaflet-bar');
  const a = L.DomUtil.create('a', '', div);
  a.href = '#';
  a.title = 'POI 搜索设置';
  a.innerHTML = '⚙';
  a.style.fontSize = '18px';
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.on(a, 'click', L.DomEvent.preventDefault).on(a, 'click', () => {
    keyInput.value = getAmapKey();
    settingsOverlay.classList.add('open');
    setTimeout(() => keyInput.focus(), 50);
  });
  return div;
};
settingsBtn.addTo(map);

document.getElementById('amap-key-save').addEventListener('click', () => {
  setAmapKey(keyInput.value.trim());
  settingsOverlay.classList.remove('open');
});
document.getElementById('amap-key-clear').addEventListener('click', () => {
  keyInput.value = '';
  setAmapKey('');
  settingsOverlay.classList.remove('open');
});
document.getElementById('amap-key-cancel').addEventListener('click', () => settingsOverlay.classList.remove('open'));
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('open'); });

// Mobile: collapsed search expands on icon tap
if (isMobile) searchWrap.classList.add('collapsed');
searchIcon.addEventListener('click', () => {
  if (searchWrap.classList.contains('collapsed')) {
    searchWrap.classList.remove('collapsed');
    setTimeout(() => searchInput.focus(), 50);
  } else if (!searchInput.value) {
    searchWrap.classList.add('collapsed');
  }
});

let searchTimer;
let searchAbort;
let searchHighlight = -1;
let lastResults = [];

async function doSearch(q) {
  const key = getAmapKey();
  if (!key || !q || q.length < 1) {
    searchResults.classList.remove('open');
    return;
  }
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  // Amap inputtips: returns POI suggestions near map center
  const c = map.getCenter();
  // map center is WGS-84; amap expects GCJ-02 location for "location" bias param
  const gcj = wgs84ToGcj02(c.lng, c.lat);
  const url = 'https://restapi.amap.com/v3/assistant/inputtips' +
    '?key=' + encodeURIComponent(key) +
    '&keywords=' + encodeURIComponent(q) +
    '&location=' + gcj.lng.toFixed(6) + ',' + gcj.lat.toFixed(6) +
    '&output=json' +
    '&datatype=poi';
  try {
    const r = await fetch(url, {signal: searchAbort.signal});
    const j = await r.json();
    if (j.status !== '1') {
      renderResults([], j.info || '请求失败 (' + (j.infocode || '?') + ')');
      return;
    }
    const tips = (j.tips || []).filter(t => t.location && typeof t.location === 'string');
    const items = tips.slice(0, 8).map(t => {
      const [lon, lat] = t.location.split(',').map(Number);
      const wgs = gcj02ToWgs84(lon, lat);
      return {name: t.name, addr: (t.district || '') + (t.address ? ' ' + t.address : ''), lat: wgs.lat, lon: wgs.lng};
    });
    lastResults = items;
    renderResults(items);
  } catch (e) {
    if (e.name !== 'AbortError') renderResults([], '网络错误: ' + e.message);
  }
}

function renderResults(items, errMsg) {
  searchResults.innerHTML = '';
  searchHighlight = -1;
  if (errMsg) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = errMsg;
    searchResults.appendChild(d);
    searchResults.classList.add('open');
    return;
  }
  if (items.length === 0) {
    searchResults.classList.remove('open');
    return;
  }
  items.forEach((it, idx) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<div class="name"></div><div class="addr"></div>';
    d.querySelector('.name').textContent = it.name;
    d.querySelector('.addr').textContent = it.addr;
    d.addEventListener('click', () => pickResult(idx));
    searchResults.appendChild(d);
  });
  searchResults.classList.add('open');
}

let searchMarker;
function pickResult(idx) {
  const it = lastResults[idx];
  if (!it) return;
  map.flyTo([it.lat, it.lon], Math.max(map.getZoom(), 15), {duration: 0.8});
  if (searchMarker) searchMarker.remove();
  searchMarker = L.marker([it.lat, it.lon]).addTo(map).bindPopup('<b>' + escapeHtml(it.name) + '</b><br>' + escapeHtml(it.addr)).openPopup();
  searchResults.classList.remove('open');
  if (isMobile) {
    searchInput.blur();
    searchWrap.classList.add('collapsed');
  }
}
function escapeHtml(s) { return (s || '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.remove('open'); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
});
searchInput.addEventListener('focus', () => { if (lastResults.length) searchResults.classList.add('open'); });
searchInput.addEventListener('keydown', e => {
  const items = searchResults.querySelectorAll('.item');
  if (e.key === 'Escape') { searchInput.blur(); searchResults.classList.remove('open'); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); searchHighlight = Math.min(items.length-1, searchHighlight+1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchHighlight = Math.max(0, searchHighlight-1); }
  else if (e.key === 'Enter') { e.preventDefault(); pickResult(searchHighlight < 0 ? 0 : searchHighlight); return; }
  else return;
  items.forEach((it, i) => it.classList.toggle('active', i === searchHighlight));
});
document.addEventListener('click', e => {
  if (!searchWrap.contains(e.target)) searchResults.classList.remove('open');
});

// WGS-84 ↔ GCJ-02 (closed-form, public-domain port of eviltransform)
function wgs84ToGcj02(lon, lat) {
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return {lng: lon, lat: lat};
  const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2 / 3;
    return r;
  };
  const tLon = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
    return r;
  };
  let dLat = tLat(lon - 105.0, lat - 35.0);
  let dLon = tLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat); magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return {lng: lon + dLon, lat: lat + dLat};
}
function gcj02ToWgs84(lon, lat) {
  const gcj = wgs84ToGcj02(lon, lat);
  return {lng: lon * 2 - gcj.lng, lat: lat * 2 - gcj.lat};
}
  </script>
</body>
</html>`;
}
