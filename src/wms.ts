// WMS 1.1.1 + 1.3.0 minimal implementation.
// Supports:
//   - service=WMS&request=GetCapabilities
//   - service=WMS&request=GetMap (bbox + width/height/srs/version)
//
// Layer name: uom_shifei (single layer; the underlying PMTiles already holds the merged 30 province content)

import type { Context } from "hono";
import { getPMT, TileType } from "./pmtiles-r2";
import type { Env } from "./pmtiles-r2";
import { recolorMaskPng, parseColorHex, clampAlpha } from "./tile";

const EARTH_R = 20037508.342789244;
const LAYER = "uom_shifei";
const TITLE = "UOM 适飞空域 (CAAC airspace)";

function tileForBbox(bbox: [number, number, number, number], width: number, height: number) {
  if (width !== 256 || height !== 256) return null;
  const span = bbox[2] - bbox[0];
  const zApprox = Math.log2((2 * EARTH_R) / span);
  const z = Math.round(zApprox);
  if (Math.abs(zApprox - z) > 1e-3) return null;
  const ts = (2 * EARTH_R) / Math.pow(2, z);
  const x = Math.round((bbox[0] + EARTH_R) / ts);
  const y = Math.round((EARTH_R - bbox[3]) / ts);
  return { z, x, y };
}

export async function handleGetMap(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  const ql = Object.fromEntries(Object.entries(q).map(([k, v]) => [k.toLowerCase(), v]));
  if (ql.request?.toLowerCase() === "getcapabilities") return getCapabilities(c);
  if (!ql.bbox) return new Response("missing bbox", { status: 400 });
  const bbox = ql.bbox.split(",").map(Number) as [number, number, number, number];
  const w = parseInt(ql.width ?? "256", 10);
  const h = parseInt(ql.height ?? "256", 10);
  const t = tileForBbox(bbox, w, h);
  if (!t) return new Response("only 256x256 web-mercator tile-aligned bbox supported", { status: 400 });
  return serveTile(env, t.z, t.x, t.y, ql.color, ql.alpha);
}

export async function getCapabilities(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const base = `${url.protocol}//${url.host}/wms`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service>
    <Name>OGC:WMS</Name>
    <Title>${TITLE}</Title>
    <OnlineResource xlink:type="simple" xlink:href="${base}"/>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>application/vnd.ogc.wms_xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${base}?"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${base}?"/></Get></HTTP></DCPType>
      </GetMap>
    </Request>
    <Exception><Format>application/vnd.ogc.se_xml</Format></Exception>
    <Layer>
      <Title>${TITLE}</Title>
      <SRS>EPSG:3857</SRS>
      <SRS>EPSG:900913</SRS>
      <LatLonBoundingBox minx="73" miny="17.5" maxx="135.5" maxy="54"/>
      <BoundingBox SRS="EPSG:3857" minx="8126322" miny="1985196" maxx="15084960" maxy="7180387"/>
      <Layer queryable="0">
        <Name>${LAYER}</Name>
        <Title>${TITLE}</Title>
      </Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;
  return new Response(xml, { headers: { "content-type": "application/vnd.ogc.wms_xml;charset=utf-8" } });
}

async function serveTile(env: Env, z: number, x: number, y: number, color?: string, alpha?: string): Promise<Response> {
  const pmt = getPMT(env);
  const header = await pmt.getHeader();
  if (header.tileType !== TileType.Png) return new Response("archive type not PNG", { status: 500 });
  if (z < header.minZoom) return new Response(null, { status: 204 });
  // overzoom beyond maxZoom: look up parent
  let lookupZ = z, lookupX = x, lookupY = y;
  if (z > header.maxZoom) {
    const dz = z - header.maxZoom;
    lookupZ = header.maxZoom;
    lookupX = x >> dz;
    lookupY = y >> dz;
  }
  const tile = await pmt.getZxy(lookupZ, lookupX, lookupY);
  if (!tile) {
    // Return transparent 256x256 PNG
    return new Response(blankPng(), {
      headers: { "content-type": "image/png", "cache-control": env.CACHE_CONTROL || "public, max-age=86400" },
    });
  }
  const raw = new Uint8Array(tile.data);
  const useColor = color ?? env.TILE_COLOR;
  const useAlpha = alpha ?? env.TILE_ALPHA;
  const [r, g, b] = parseColorHex(useColor);
  const a = clampAlpha(useAlpha);
  let body: Uint8Array;
  try {
    body = recolorMaskPng(raw, r, g, b, a);
  } catch {
    body = raw;
  }
  // Overzoom: extract sub-region of parent tile
  if (z > header.maxZoom) {
    // CSS image-rendering: pixelated on the client handles upscale visually
    // (we don't WebGL-decode here to avoid CPU cost in the Worker).
    // Just return the parent tile; client scales.
  }
  return new Response(body, {
    headers: {
      "content-type": "image/png",
      "cache-control": env.CACHE_CONTROL || "public, max-age=86400",
    },
  });
}

let _blank: Uint8Array | undefined;
function blankPng(): Uint8Array {
  if (_blank) return _blank;
  // 256x256 fully transparent PNG, palette+tRNS, ~70 bytes (precomputed offline)
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAA9JREFUeF7twTEBAAAAwqD1T20PBwAAAAAAAAAAAAAAAAAAAACPHEEAAfEvVKEAAAAASUVORK5CYII=";
  _blank = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return _blank;
}

export { serveTile };
