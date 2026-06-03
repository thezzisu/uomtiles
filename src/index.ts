import { Hono } from "hono";
import { cors } from "hono/cors";
import { cache } from "hono/cache";
import type { Env } from "./pmtiles-r2";
import { serveTile, handleGetMap, getCapabilities as wmsCaps } from "./wms";
import { handleWmts } from "./wmts";
import { PREVIEW_HTML } from "./preview";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", maxAge: 86400 }));

app.get("/", c => c.redirect("/preview"));

app.get("/preview", c => c.html(PREVIEW_HTML));

app.get(
  "/xyz/:z{[0-9]+}/:x{[0-9]+}/:y{[0-9]+}.png",
  cache({ cacheName: "uomtiles", cacheControl: "public, max-age=86400, s-maxage=604800" }),
  async c => {
    const z = parseInt(c.req.param("z"), 10);
    const x = parseInt(c.req.param("x"), 10);
    const y = parseInt(c.req.param("y"), 10);
    const color = c.req.query("color");
    const alpha = c.req.query("alpha");
    return serveTile(c.env, z, x, y, color, alpha);
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
      "cache-control": "public, max-age=3600",
    },
  });
});

app.get("/health", c => c.json({ ok: true, ts: Date.now() }));

app.notFound(c =>
  c.json(
    {
      error: "not found",
      routes: ["/preview", "/xyz/{z}/{x}/{y}.png", "/wms", "/wmts", "/dji.geojson", "/health"],
    },
    404,
  ),
);

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: err.message }, 500);
});

export default app;
