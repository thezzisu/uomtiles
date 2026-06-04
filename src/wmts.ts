// WMTS 1.0.0 GetCapabilities + GetTile.
// Compatible with QGIS, 奥维互动地图, GIS desktops.

import type { Context } from "hono";
import type { Env } from "./pmtiles-r2";
import { getPMT } from "./pmtiles-r2";
import { serveTile } from "./wms";

const LAYER = "uom_shifei";
const STYLE = "default";
const TMS = "GoogleMapsCompatible";
const TITLE = "UOM 适飞空域 (CAAC airspace)";

// Standard GoogleMapsCompatible scale denominators (mercator)
const SCALE_DENOMS = [
  559082264.0287178, 279541132.0143589, 139770566.00717944, 69885283.00358972,
  34942641.50179486, 17471320.75089743, 8735660.375448715, 4367830.187724357,
  2183915.0938621787, 1091957.5469310894, 545978.7734655447, 272989.38673277234,
  136494.69336638617, 68247.34668319309, 34123.67334159654, 17061.83667079827,
  8530.918335399136, 4265.459167699568, 2132.729583849784,
];

export async function handleWmts(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const qs = Object.fromEntries(url.searchParams.entries());
  const q = Object.fromEntries(Object.entries(qs).map(([k, v]) => [k.toLowerCase(), v]));
  if (q.request === "getcapabilities" || q.request?.toLowerCase() === "getcapabilities") {
    return wmtsGetCapabilities(c);
  }
  if (q.request === "gettile" || q.request?.toLowerCase() === "gettile") {
    const z = parseInt(q.tilematrix ?? "0", 10);
    const x = parseInt(q.tilecol ?? "0", 10);
    const y = parseInt(q.tilerow ?? "0", 10);
    return serveTile(c.env, z, x, y);
  }
  return new Response("unsupported WMTS request", { status: 400 });
}

async function wmtsGetCapabilities(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const base = `${url.protocol}//${url.host}/wmts`;
  const xyzBase = `${url.protocol}//${url.host}/xyz`;

  // Read native zoom range from PMTiles header so clients overzoom natively
  // for z > maxZoom instead of requesting tiles we'd have to synthesize.
  const pmt = getPMT(c.env);
  const header = await pmt.getHeader();
  const zMin = header.minZoom;
  const zMax = header.maxZoom;

  const tileMatrix = [];
  for (let z = zMin; z <= zMax; z++) {
    const m = 1 << z;
    tileMatrix.push(`      <TileMatrix>
        <ows:Identifier>${z}</ows:Identifier>
        <ScaleDenominator>${SCALE_DENOMS[z]}</ScaleDenominator>
        <TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>${m}</MatrixWidth>
        <MatrixHeight>${m}</MatrixHeight>
      </TileMatrix>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0"
              xmlns:ows="http://www.opengis.net/ows/1.1"
              xmlns:xlink="http://www.w3.org/1999/xlink"
              version="1.0.0">
  <ows:ServiceIdentification>
    <ows:Title>${TITLE}</ows:Title>
    <ows:ServiceType>OGC WMTS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
  </ows:ServiceIdentification>
  <Contents>
    <Layer>
      <ows:Title>${TITLE}</ows:Title>
      <ows:Identifier>${LAYER}</ows:Identifier>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>73 17.5</ows:LowerCorner>
        <ows:UpperCorner>135.5 54</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <Style isDefault="true"><ows:Identifier>${STYLE}</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>${TMS}</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile"
        template="${xyzBase}/{TileMatrix}/{TileCol}/{TileRow}.png"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>${TMS}</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
${tileMatrix.join("\n")}
    </TileMatrixSet>
  </Contents>
  <ServiceMetadataURL xlink:href="${base}?service=WMTS&amp;request=GetCapabilities"/>
</Capabilities>`;
  return new Response(xml, {
    headers: { "content-type": "application/xml;charset=utf-8" },
  });
}
