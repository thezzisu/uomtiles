#!/usr/bin/env bash
# upload.sh — convert mbtiles → pmtiles, upload to R2, create GitHub release
#
# Prerequisites:
#   - go-pmtiles: install via `go install github.com/protomaps/go-pmtiles@latest` or download from https://github.com/protomaps/go-pmtiles/releases
#   - wrangler: `npm i -g wrangler` + `wrangler login`
#   - gh: GitHub CLI, authenticated (`gh auth login`)
#   - R2 bucket created: `wrangler r2 bucket create uomtiles`
#
# Usage:
#   bash scripts/upload.sh path/to/tiles.mbtiles path/to/dji.geojson [release-tag]
#
# Outputs:
#   - data/uom-shifei.pmtiles (local cache)
#   - R2: uom-shifei.pmtiles, dji.geojson
#   - GH release with both artifacts
set -euo pipefail

MBTILES="${1:?usage: upload.sh <mbtiles> <dji.geojson> [tag]}"
DJI="${2:?usage: upload.sh <mbtiles> <dji.geojson> [tag]}"
TAG="${3:-v1.0.0}"
PMTILES="data/uom-shifei.pmtiles"
BUCKET="${R2_BUCKET:-uomtiles}"
REPO="${GH_REPO:-thezzisu/uomtiles}"

echo "[1/4] Converting mbtiles → pmtiles..."
mkdir -p data
if [[ ! -f "$PMTILES" ]]; then
  pmtiles convert "$MBTILES" "$PMTILES"
else
  echo "  $PMTILES already exists, skipping convert"
fi

echo "[2/4] Uploading to R2 (bucket=$BUCKET)..."
wrangler r2 object put "${BUCKET}/uom-shifei.pmtiles" --file "$PMTILES" --remote
wrangler r2 object put "${BUCKET}/dji.geojson" --file "$DJI" --content-type "application/geo+json" --remote

echo "[3/4] Publishing GitHub release ($TAG → $REPO)..."
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "  Release $TAG exists, uploading additional assets..."
  gh release upload "$TAG" "$MBTILES" "$PMTILES" "$DJI" --repo "$REPO" --clobber
else
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "UOM 适飞空域 $TAG" \
    --notes "Raster tile pyramid z=0..13 + DJI flysafe overlay. Crawled from CAAC UOM with retry-on-blank fetcher; tip-only corner fix applied; max-pool rebuilt z<13. See uomfetcher submodule." \
    "$MBTILES" "$PMTILES" "$DJI"
fi

echo "[4/4] Done. Now run: wrangler deploy"
