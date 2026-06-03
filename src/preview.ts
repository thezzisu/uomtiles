// Inline HTML for the /preview route.
// Leaflet + 7 basemaps (OSM, CARTO Voyager/Dark, ESRI Sat, AMap vec/sat GCJ-02 fix, OpenTopoMap)
// UOM 适飞 overlay + DJI flysafe overlay.

export const PREVIEW_HTML = `<!DOCTYPE html>
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
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
${gcj02Lib()}

const map = L.map('map', {minZoom:2, maxZoom:18, attributionControl:true, zoomControl:true}).setView([35, 105], 5);

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OSM'});
const cartoVoy = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'© CARTO © OSM'});
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'© Esri'});
const opentopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom:17, attribution:'© OpenTopoMap (CC-BY-SA)'});

// 高德 vector + sat with GCJ-02 correction
const amapVec = L.tileLayer.gcj02('https://webst0{s}.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}', {maxZoom:18, subdomains:'1234', attribution:'© 高德'});
const amapSat = L.tileLayer.gcj02('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {maxZoom:18, subdomains:'1234', attribution:'© 高德'});

cartoVoy.addTo(map);

// UOM overlay (from same origin)
let uomUrl = '/xyz/{z}/{x}/{y}.png';
const uom = L.tileLayer(uomUrl, {minZoom:2, maxZoom:18, maxNativeZoom:13, opacity:1.0, className:'uom-crisp', attribution:'UOM 适飞'}).addTo(map);

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

// Layer switcher
const baseMaps = {
  'CARTO Voyager (默认)': cartoVoy,
  'OSM': osm,
  'CARTO Dark': cartoDark,
  'ESRI 卫星': esriSat,
  'OpenTopo 地形': opentopo,
  '高德矢量 (GCJ02 fix)': amapVec,
  '高德卫星 (GCJ02 fix)': amapSat,
};
const overlayMaps = {
  'UOM 适飞': uom,
};
L.control.layers(baseMaps, overlayMaps, {collapsed:false, position:'topleft'}).addTo(map);

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

function gcj02Lib() {
  return `
// GCJ-02 ⇄ WGS-84 (China datum offset, ~50-500m)
// Public-domain JS port of standard 'eviltransform' algorithm.
(function() {
  const PI = Math.PI;
  const A = 6378245.0;
  const EE = 0.00669342162296594323;
  function outOfChina(lon, lat) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function tLat(x, y) {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2 / 3;
    return r;
  }
  function tLon(x, y) {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
    return r;
  }
  function wgs2gcj(lat, lon) {
    if (outOfChina(lon, lat)) return [lat, lon];
    let dLat = tLat(lon - 105, lat - 35);
    let dLon = tLon(lon - 105, lat - 35);
    const radLat = lat / 180 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqM = Math.sqrt(magic);
    dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqM) * PI);
    dLon = (dLon * 180) / (A / sqM * Math.cos(radLat) * PI);
    return [lat + dLat, lon + dLon];
  }
  // Project lat to tile-y (Web Mercator)
  function latToTileY(lat, z) {
    const r = lat * PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / PI) / 2 * Math.pow(2, z));
  }
  function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  }
  function tileLat(y, z) {
    const n = PI - 2 * PI * y / Math.pow(2, z);
    return 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function tileLon(x, z) {
    return x / Math.pow(2, z) * 360 - 180;
  }
  // Override TileLayer with GCJ-02 url resolution
  L.TileLayer.GCJ02 = L.TileLayer.extend({
    getTileUrl: function(coords) {
      // coords = WGS-84 tile (z,x,y); compute WGS center, convert to GCJ, get GCJ tile
      const z = this._getZoomForUrl();
      const lat = (tileLat(coords.y, z) + tileLat(coords.y + 1, z)) / 2;
      const lon = (tileLon(coords.x, z) + tileLon(coords.x + 1, z)) / 2;
      const [gLat, gLon] = wgs2gcj(lat, lon);
      const gx = lonToTileX(gLon, z);
      const gy = latToTileY(gLat, z);
      const data = {r: L.Browser.retina ? '@2x' : '', s: this._getSubdomain(coords), x: gx, y: gy, z};
      return L.Util.template(this._url, L.Util.extend(data, this.options));
    }
  });
  L.tileLayer.gcj02 = (url, opts) => new L.TileLayer.GCJ02(url, opts);
})();`;
}
