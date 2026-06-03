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
    }
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
[...document.querySelectorAll('#controls,#legend')].forEach(el => {
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
});
  </script>
</body>
</html>`;
}
