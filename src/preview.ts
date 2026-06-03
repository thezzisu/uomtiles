// Inline HTML for the /preview route.
// Basemaps:
//   - WGS-84 (perfect alignment): OSM, CARTO Voyager/Dark, ESRI Sat, OpenTopoMap, 天地图 vec/sat
//   - GCJ-02 (intentionally excluded): Gaode/Baidu/Tencent have ~500m offset.
//     Per-tile lat/lon correction causes zoom-time jitter because rounding
//     varies by zoom level. The only correct fix is server-side reprojection.
//
// 天地图 needs a free key from https://lbs.tianditu.gov.cn — pass via TIANDITU_TOKEN env var.

export function buildPreviewHtml(tiandituToken: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>UOM 适飞空域预览</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html,body,#map{height:100%;margin:0;background:#111;color:#ddd;font:13px/1.5 system-ui,sans-serif}
    .uom-crisp img.leaflet-tile{image-rendering:pixelated;image-rendering:crisp-edges}
    #zlabel{position:absolute;top:8px;left:50px;z-index:1000;padding:4px 8px;background:#000a;color:#fff;border-radius:4px;font:13px system-ui}
    .leaflet-control-attribution{font-size:10px}
    .dji-tip{font-size:11px;line-height:1.4}
    .legend{position:absolute;bottom:24px;left:8px;z-index:1000;padding:8px 12px;background:#000c;color:#fff;border-radius:4px;max-width:240px}
    .legend h4{margin:0 0 4px;font-size:12px}
    .legend p{margin:2px 0;font-size:11px}
    .legend .swatch{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;margin-right:4px}
    #controls{position:absolute;top:48px;right:8px;z-index:1000;padding:8px;background:#000c;color:#fff;border-radius:4px;display:flex;flex-direction:column;gap:6px}
    #controls label{font-size:11px;display:flex;align-items:center;gap:4px}
    #controls input[type=range]{width:120px}
    #controls input[type=color]{width:36px;height:22px;border:0;padding:0;background:transparent}
    .leaflet-touch .leaflet-bar a, .leaflet-bar a {background:#fff}
    .locate-btn{font-size:18px;line-height:30px}
    .me-marker{filter:drop-shadow(0 0 4px #4a90e2)}
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="zlabel"></div>
  <div id="controls">
    <label>颜色 <input type="color" id="uom-color" value="#2980b9"></label>
    <label>透明度 <input type="range" id="uom-alpha" min="0" max="255" value="153"><span id="alpha-val">153</span></label>
    <label><input type="checkbox" id="dji-toggle" checked> DJI 限飞</label>
  </div>
  <div class="legend">
    <h4>图层</h4>
    <p><span class="swatch" style="background:#2980b9"></span>UOM 适飞空域</p>
    <p><span class="swatch" style="background:#ff6b6b"></span>DJI Restricted</p>
    <p><span class="swatch" style="background:#feca57"></span>DJI Warning / Auth</p>
    <p><span class="swatch" style="background:#48dbfb"></span>DJI Recommended</p>
    <p style="font-size:10px;color:#aaa;margin-top:6px">底图均为 WGS-84, 与 UOM 数据完美对齐</p>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
const TDT_TOKEN = ${JSON.stringify(tiandituToken)};
const map = L.map('map', {minZoom:2, maxZoom:18, attributionControl:true, zoomControl:true}).setView([35, 105], 5);

// All WGS-84 basemaps (no GCJ-02 shift, perfect alignment with UOM data)
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OSM'});
const cartoVoy = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'© Esri'});
const opentopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom:17, attribution:'© OpenTopoMap (CC-BY-SA)'});

const baseMaps = {
  'CARTO Voyager (默认)': cartoVoy,
  'OSM': osm,
  'CARTO Dark': cartoDark,
  'ESRI 卫星': esriSat,
  'OpenTopo 地形': opentopo,
};

if (TDT_TOKEN) {
  // 天地图: WGS-84 native (CGCS2000 ≈ WGS-84), 中国境内权威矢量+卫星
  const tdtVec = L.layerGroup([
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=cva_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
  ], {attribution:'© 天地图'});
  const tdtSat = L.layerGroup([
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=img_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
  ], {attribution:'© 天地图'});
  const tdtTer = L.layerGroup([
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=ter_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
    L.tileLayer('https://t{s}.tianditu.gov.cn/DataServer?T=cta_w&X={x}&Y={y}&L={z}&tk='+TDT_TOKEN, {maxZoom:18, subdomains:'01234567'}),
  ], {attribution:'© 天地图'});
  baseMaps['天地图 矢量'] = tdtVec;
  baseMaps['天地图 卫星'] = tdtSat;
  baseMaps['天地图 地形'] = tdtTer;
}

cartoVoy.addTo(map);

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

const overlayMaps = {'UOM 适飞': uom};
L.control.layers(baseMaps, overlayMaps, {collapsed:false, position:'topleft'}).addTo(map);

// Geolocate control: native browser geolocation (HTTPS required by browsers)
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
map.on('locationerror', e => {
  alert('定位失败: ' + e.message + '\\n\\n需要 HTTPS 协议 + 浏览器位置权限');
});

function updateZ() { document.getElementById('zlabel').textContent = 'z=' + map.getZoom(); }
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
  </script>
</body>
</html>`;
}
