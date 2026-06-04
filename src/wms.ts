// WMS 1.1.1 minimal implementation + canonical-only tile serving.
//
// Worker now returns the *canonical* PNG (#2980b9 α=255) byte-for-byte
// from PMTiles. No query-string handling, no recoloring, no overzoom
// processing. This maximizes Cloudflare edge cache hit rate.
//
// Clients can recolor / over-zoom on the client side (MapLibre uses GPU
// raster-hue-rotate and raster-resampling: nearest).

import type { Context } from "hono";
import { getPMT, TileType } from "./pmtiles-r2";
import type { Env } from "./pmtiles-r2";

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
  const ql = Object.fromEntries(
    [...url.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v])
  );
  if (ql.request?.toLowerCase() === "getcapabilities") return getCapabilities(c);
  if (!ql.bbox) return new Response("missing bbox", { status: 400 });
  const bbox = ql.bbox.split(",").map(Number) as [number, number, number, number];
  const w = parseInt(ql.width ?? "256", 10);
  const h = parseInt(ql.height ?? "256", 10);
  const t = tileForBbox(bbox, w, h);
  if (!t) return new Response("only 256x256 web-mercator tile-aligned bbox supported", { status: 400 });
  return serveTile(env, t.z, t.x, t.y);
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
  return new Response(xml, {
    headers: { "content-type": "application/vnd.ogc.wms_xml;charset=utf-8" },
  });
}

/**
 * Serve a tile from PMTiles, byte-for-byte canonical.
 *
 * - z < minZoom        → 204 (caller may render blank)
 * - z > maxZoom        → 204 (caller does GPU upscale, e.g. MapLibre maxzoom + overscaledZ)
 * - tile not present    → tiny transparent PNG
 * - otherwise           → raw PNG bytes from PMTiles
 *
 * No query-string handling; cache key is just (z, x, y).
 */
export async function serveTile(env: Env, z: number, x: number, y: number): Promise<Response> {
  const pmt = getPMT(env);
  const header = await pmt.getHeader();
  if (header.tileType !== TileType.Png) return new Response("archive type not PNG", { status: 500 });
  if (z < header.minZoom || z > header.maxZoom) {
    return new Response(null, { status: 204 });
  }
  const tile = await pmt.getZxy(z, x, y);
  if (!tile) {
    return new Response(blankPng() as unknown as BodyInit, {
      headers: {
        "content-type": "image/png",
        "cache-control": env.CACHE_CONTROL || "public, max-age=31536000, immutable",
      },
    });
  }
  return new Response(tile.data, {
    headers: {
      "content-type": "image/png",
      "cache-control": env.CACHE_CONTROL || "public, max-age=31536000, immutable",
    },
  });
}

let _blank: Uint8Array | undefined;
function blankPng(): Uint8Array {
  if (_blank) return _blank;
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAA9JREFUeF7twTEBAAAAwqD1T20PBwAAAAAAAAAAAAAAAAAAAACPHEEAAfEvVKEAAAAASUVORK5CYII=";
  _blank = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return _blank;
}
