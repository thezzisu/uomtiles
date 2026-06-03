# uomtiles

中国民航局 UOM 适飞空域 (CAAC airspace) 公共 raster tile 服务, 部署在 Cloudflare Workers + R2.

## 功能

- `GET /xyz/{z}/{x}/{y}.png` — XYZ tile (z=0..13 native, z=14..18 overzoom)
- `GET /wms?...` — OGC WMS 1.1.1 (GetMap / GetCapabilities)
- `GET /wmts?...` — OGC WMTS 1.0.0 (GetTile / GetCapabilities)
- `GET /dji.geojson` — DJI flysafe airspace (warning / restricted / auth / recommended)
- `GET /preview` — 交互式 Leaflet 预览, 7 个底图 (含高德 GCJ-02 修正), UOM + DJI overlay

## 数据来源

- UOM 适飞 raster: z=0..13 全量 crawl + tip-only corner fix + max-pool 重建, 由 [private `uomfetcher` submodule](https://github.com/thezzisu/uomfetcher) 生成
- DJI flysafe: [fly-safe.dji.com](https://fly-safe.dji.com) airspace API ingest
- 数据文件 (`*.mbtiles`, `*.pmtiles`, `dji.geojson`) 通过 GitHub Releases 分发, 不进 repo

## 部署到 Cloudflare Workers

```bash
# 1. 安装
npm install
wrangler login

# 2. 创建 R2 bucket (one-time)
wrangler r2 bucket create uomtiles

# 3. 上传数据 + 发布 release (需 go-pmtiles, gh CLI)
#    bash scripts/upload.sh tiles.mbtiles dji.geojson v1.0.0
#    （会把 mbtiles 转 pmtiles, 上 R2, 发 GH release）

# 4. 部署 Worker
wrangler deploy

# 5. 访问
open https://uomtiles.<your-account>.workers.dev/preview
```

## 配置 (wrangler.toml)

```toml
[vars]
TILE_COLOR = "2980b9"        # 默认 hex 色
TILE_ALPHA = "153"           # 默认 alpha 0-255
PMTILES_KEY = "uom-shifei.pmtiles"
DJI_KEY = "dji.geojson"
ALLOWED_ORIGINS = "*"
CACHE_CONTROL = "public, max-age=86400, s-maxage=604800"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "uomtiles"     # 改成你的
```

无需配置 `account_id`, wrangler 从 `wrangler login` 或 `CLOUDFLARE_ACCOUNT_ID` env 自动取.

## 使用

### 奥维互动地图 / OruxMaps

XYZ 自定义图源:
```
URL 模板: https://your-worker.workers.dev/xyz/{z}/{x}/{y}.png
zoom: 0-18
```

### QGIS / 桌面 GIS

WMTS:
```
https://your-worker.workers.dev/wmts?service=WMTS&request=GetCapabilities
```

### Web

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map').setView([35, 105], 5);
  L.tileLayer('https://your-worker.workers.dev/xyz/{z}/{x}/{y}.png', {
    maxZoom: 18, opacity: 0.6, className: 'crisp'
  }).addTo(map);
</script>
<style>.crisp img{image-rendering:pixelated}</style>
```

## 自部署 (Fork)

1. Fork 这个 repo
2. 改 `wrangler.toml` 的 `bucket_name`
3. 自己跑 `uomfetcher` (need UOM 账号) 或下载我们的 release
4. `bash scripts/upload.sh` + `wrangler deploy`

## License

MIT — 代码层. 数据 (UOM raster, DJI flysafe) 版权归原服务商所有, 本项目仅作技术验证.
