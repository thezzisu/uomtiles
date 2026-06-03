# `data/`

数据文件 (mbtiles, pmtiles, dji.geojson) **不在 repo** 内, 通过以下两种方式获取:

## A. 从 GitHub Release 下载

```bash
gh release download v1.0.0 \
  --repo thezzisu/uomtiles \
  --pattern '*.pmtiles' \
  --pattern 'dji.geojson' \
  --dir data/
```

## B. 自己生成 (需私有 `uomfetcher` submodule)

```bash
cd uomfetcher
# Refresh tokens, run crawl, binarise, rebuild-pyramid, tip-fix (full pipeline)
# See uomfetcher/README.md
cd ..
# Convert mbtiles to pmtiles
pmtiles convert uomfetcher/tiles.mbtiles data/uom-shifei.pmtiles
```

## 然后上传 R2 + GitHub release

```bash
bash scripts/upload.sh data/uom-shifei.pmtiles data/dji.geojson
```
