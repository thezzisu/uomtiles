import { Hono } from "hono";
import { cors } from "hono/cors";
import { cache } from "hono/cache";
import type { Env } from "./pmtiles-r2";
import { serveTile, handleGetMap, getCapabilities as wmsCaps } from "./wms";
import { handleWmts } from "./wmts";

type AppEnv = Env & {
  TIANDITU_TOKEN?: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
};

const app = new Hono<{ Bindings: AppEnv }>();

app.use("*", cors({ origin: "*", maxAge: 86400 }));

app.get("/", c => c.redirect("/preview"));

// Serve preview HTML/CSS/JS as static assets via the [assets] binding.
// /preview returns public/index.html.
app.get("/preview", async c => {
  if (!c.env.ASSETS) return c.text("static assets binding missing", 500);
  const url = new URL(c.req.url);
  url.pathname = "/preview.html";
  const r = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  // Pass through but rewrite caching: HTML should be short-cache so updates roll out.
  const h = new Headers(r.headers);
  h.set("cache-control", "public, max-age=300, s-maxage=600");
  return new Response(r.body, { status: r.status, headers: h });
});

// Runtime config (TDT token) consumed by preview.js
app.get("/config.json", c => c.json({ tiandituToken: c.env.TIANDITU_TOKEN || "" }));

// Tile endpoint: no query strings; cache key is just (z, x, y).
app.get(
  "/xyz/:z{[0-9]+}/:x{[0-9]+}/:y{[0-9]+\\.png}",
  cache({ cacheName: "uomtiles", cacheControl: "public, max-age=31536000, immutable" }),
  async c => {
    const z = parseInt(c.req.param("z"), 10);
    const x = parseInt(c.req.param("x"), 10);
    const y = parseInt(c.req.param("y"), 10);
    return serveTile(c.env, z, x, y);
  },
);

app.get("/wms", async c => {
  const req = c.req.query("request") ?? c.req.query("REQUEST") ?? "";
  if (req.toLowerCase() === "getcapabilities") return wmsCaps(c);
  return handleGetMap(c);
});

app.get("/wmts", async c => handleWmts(c));

app.get("/dji.geojson", async c => {
  const key = c.env.DJI_KEY || "dji.geojson";
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "dji.geojson not in R2; upload via scripts/upload.sh" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/geo+json",
      "content-length": String(obj.size),
      "cache-control": "public, max-age=86400",
    },
  });
});

// Raw pmtiles download for offline mode.
app.get("/uom-shifei.pmtiles", async c => {
  const key = c.env.PMTILES_KEY || "uom-shifei.pmtiles";
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "pmtiles not in R2" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "public, max-age=86400",
    },
  });
});

app.get("/health", c => c.json({ ok: true, ts: Date.now() }));

// Fallback: try static assets (e.g. /preview.css, /preview.js, /preview-app.js)
app.notFound(async c => {
  if (c.env.ASSETS) {
    const r = await c.env.ASSETS.fetch(c.req.raw);
    if (r.status !== 404) return r;
  }
  return c.json(
    {
      error: "not found",
      routes: [
        "/preview",
        "/xyz/{z}/{x}/{y}.png",
        "/wms",
        "/wmts",
        "/dji.geojson",
        "/config.json",
        "/health",
      ],
    },
    404,
  );
});

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: err.message }, 500);
});

export default app;
