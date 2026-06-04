// reproj-worker.js — Web Worker for GCJ-02 → WGS-84 raster tile reprojection.
// Receives destination (z, x, y, bbox-EPSG:3857) + URL template, fetches GCJ-02
// source tiles, slices+draws onto an OffscreenCanvas, returns PNG ArrayBuffer.

"use strict";

const PI = Math.PI, D2R = PI/180, R2D = 180/PI;
const EARTH_RADIUS = 6378137;
const ORIGIN_SHIFT = PI * EARTH_RADIUS;
const EARTH_CIRCUMFERENCE = 2 * ORIGIN_SHIFT;

function metersToLngLat([mx, my]) {
  const lng = (mx / ORIGIN_SHIFT) * 180;
  let lat = (my / ORIGIN_SHIFT) * 180;
  lat = R2D * (2 * Math.atan(Math.exp(lat * D2R)) - PI/2);
  return [lng, lat];
}
function lngLatToMeters([lng, lat]) {
  const mx = (lng * ORIGIN_SHIFT) / 180;
  let my = Math.log(Math.tan((90 + lat) * (PI/360))) / D2R;
  my = (my * ORIGIN_SHIFT) / 180;
  return [mx, my];
}
function getRes(z, ts) { return EARTH_CIRCUMFERENCE / ts / (1 << z); }
function metersToPixels([mx, my], z, ts) {
  const r = getRes(z, ts);
  return [(mx + ORIGIN_SHIFT) / r, (my + ORIGIN_SHIFT) / r];
}
function pixelsToMeters([px, py], z, ts) {
  const r = getRes(z, ts);
  return [px * r - ORIGIN_SHIFT, py * r - ORIGIN_SHIFT];
}
function pixelsToScreen([px, py], z, ts) { return [px, (ts << z) - py]; }

function wgs84ToGcj02(lon, lat) {
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lon, lat];
  const A = 6378245.0, EE = 0.00669342162296594323;
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

// Source tiles needed to cover destination tile bbox (mercator).
function destTilesToSourceTiles(destBbox, destZ) {
  const [xmin, ymin, xmax, ymax] = destBbox;
  const corners = [[xmin, ymin], [xmax, ymin], [xmin, ymax], [xmax, ymax]];
  const gm = corners.map(([mx, my]) => {
    const [wLng, wLat] = metersToLngLat([mx, my]);
    const g = wgs84ToGcj02(wLng, wLat);
    return lngLatToMeters(g);
  });
  const gxs = gm.map(p => p[0]), gys = gm.map(p => p[1]);
  const gMinX = Math.min(...gxs), gMaxX = Math.max(...gxs);
  const gMinY = Math.min(...gys), gMaxY = Math.max(...gys);
  const z = destZ, ts = 256;
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
      const tyXyz = (1 << z) - 1 - tyT;
      out.push({ tile: [tx, tyXyz, z], bboxMeters: [bMinX, bMinY, bMaxX, bMaxY] });
    }
  }
  return out;
}

function destinationToSourceCoords(mx, my) {
  const [wLng, wLat] = metersToLngLat([mx, my]);
  return wgs84ToGcj02(wLng, wLat);
}
function sourceToPixel(gLng, gLat, z, ts) {
  const m = lngLatToMeters([gLng, gLat]);
  const p = metersToPixels(m, z, ts);
  return pixelsToScreen(p, z, ts);
}

const cache = new Map();
const MAX_CACHE = 80;
async function fetchBitmap(url) {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url); cache.set(url, hit);
    return hit;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob);
  cache.set(url, bmp);
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    const old = cache.get(firstKey);
    if (old && old.close) old.close();
    cache.delete(firstKey);
  }
  return bmp;
}

async function reproject({ destTile, destBbox, urlTemplate, tileSize = 256, interval = 32 }) {
  const [dx, dy, dz] = destTile;
  const sources = destTilesToSourceTiles(destBbox, dz).map(s => ({
    ...s,
    url: urlTemplate
      .replace("{sx}", s.tile[0]).replace("{sy}", s.tile[1]).replace("{sz}", s.tile[2])
  }));

  // Parallel fetch all needed source tiles.
  const fetched = await Promise.all(sources.map(async s => {
    try { return { ...s, bmp: await fetchBitmap(s.url) }; }
    catch { return { ...s, bmp: null }; }
  }));
  const ok = fetched.filter(s => s.bmp);
  if (!ok.length) return null;

  // Build a working canvas covering all source tiles (in source-pixel space).
  const ts = tileSize;
  const sBboxLngLat = ok.map(s => {
    const [bMinX, bMinY, bMaxX, bMaxY] = s.bboxMeters;
    return [
      ...metersToLngLat([bMinX, bMinY]),
      ...metersToLngLat([bMaxX, bMaxY]),
    ];
  });
  const sZ = ok[0].tile[2];
  const sps = sBboxLngLat.map(b => {
    const p0 = sourceToPixel(b[0], b[1], sZ, ts);
    const p1 = sourceToPixel(b[2], b[3], sZ, ts);
    return [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
  });
  const sMinX = Math.min(...sps.map(p => p[0]));
  const sMinY = Math.min(...sps.map(p => p[1]));
  const sMaxX = Math.max(...sps.map(p => p[2]));
  const sMaxY = Math.max(...sps.map(p => p[3]));

  const workW = Math.ceil(sMaxX - sMinX);
  const workH = Math.ceil(sMaxY - sMinY);
  const work = new OffscreenCanvas(workW, workH);
  const wctx = work.getContext("2d");
  ok.forEach((s, i) => {
    const [pxMin, pyMin] = sps[i];
    wctx.drawImage(s.bmp, Math.round(pxMin - sMinX), Math.round(pyMin - sMinY));
  });

  // Reproject in `interval`-px slices into destination canvas.
  const dst = new OffscreenCanvas(ts, ts);
  const dctx = dst.getContext("2d");

  // Destination pixel origin in mercator-meters.
  const [dpx0, dpy0] = (() => {
    const xRes = (destBbox[2] - destBbox[0]) / ts;
    const yRes = (destBbox[3] - destBbox[1]) / ts;
    return [destBbox[0], destBbox[3], xRes, yRes];
  })();
  const xRes = (destBbox[2] - destBbox[0]) / ts;
  const yRes = (destBbox[3] - destBbox[1]) / ts;

  for (let py = 0; py < ts; py += interval) {
    const dh = Math.min(interval, ts - py);
    for (let px = 0; px < ts; px += interval) {
      const dw = Math.min(interval, ts - px);
      // Destination pixel patch corners in mercator-meters.
      const m0x = destBbox[0] + px * xRes;
      const m0y = destBbox[3] - py * yRes;
      const m1x = destBbox[0] + (px + dw) * xRes;
      const m1y = destBbox[3] - (py + dh) * yRes;
      // Map each corner to source-pixel space.
      const [g0Lng, g0Lat] = destinationToSourceCoords(m0x, m0y);
      const [g1Lng, g1Lat] = destinationToSourceCoords(m1x, m1y);
      const sp0 = sourceToPixel(g0Lng, g0Lat, sZ, ts);
      const sp1 = sourceToPixel(g1Lng, g1Lat, sZ, ts);
      const sxMin = Math.min(sp0[0], sp1[0]);
      const syMin = Math.min(sp0[1], sp1[1]);
      const sxMax = Math.max(sp0[0], sp1[0]);
      const syMax = Math.max(sp0[1], sp1[1]);
      dctx.drawImage(
        work,
        sxMin - sMinX, syMin - sMinY, sxMax - sxMin, syMax - syMin,
        px, py, dw, dh
      );
    }
  }
  const blob = await dst.convertToBlob({ type: "image/png" });
  const buf = await blob.arrayBuffer();
  return buf;
}

self.addEventListener("message", async (ev) => {
  const { id, type, data } = ev.data;
  if (type !== "reproject") return;
  try {
    const buf = await reproject(data);
    self.postMessage({ id, ok: true, buf }, buf ? [buf] : []);
  } catch (e) {
    self.postMessage({ id, ok: false, err: String(e && e.message || e) });
  }
});
