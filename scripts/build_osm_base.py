#!/usr/bin/env python3
"""
build_osm_base.py — Download CARTO Voyager z=0-5 tiles, assemble as MBTiles,
ready to convert with `pmtiles convert` for offline basemap bundle.
"""
import os, sys, sqlite3, urllib.request, concurrent.futures, time

OUT = os.path.expanduser("/tmp/osm-base.mbtiles")
MAX_Z = 5  # 1 + 4 + 16 + 64 + 256 + 1024 = 1365 tiles
SUBS = ["a", "b", "c"]
URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
HEADERS = {"User-Agent": "uomtiles-offline-bundle/1.0 (https://uom.zzi.su)"}
CONCURRENCY = 8

def fetch_tile(z, x, y):
    sub = SUBS[(x + y) % len(SUBS)]
    url = URL.format(s=sub, z=z, x=x, y=y)
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return (z, x, y, r.read())
        except Exception as e:
            if attempt == 2:
                print(f"  ! z={z} x={x} y={y}: {e}", file=sys.stderr)
                return (z, x, y, None)
            time.sleep(0.5 * (attempt + 1))

def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    con = sqlite3.connect(OUT)
    cur = con.cursor()
    cur.executescript("""
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER,
                            tile_row INTEGER, tile_data BLOB,
                            PRIMARY KEY (zoom_level, tile_column, tile_row));
    """)
    meta = [
        ("name", "OSM Offline Base"),
        ("type", "baselayer"),
        ("version", "1.0"),
        ("description", "CARTO Voyager z=0-5 worldwide offline bundle"),
        ("format", "png"),
        ("minzoom", "0"),
        ("maxzoom", str(MAX_Z)),
        ("bounds", "-180,-85.05113,180,85.05113"),
        ("attribution", "© OpenStreetMap, © CARTO"),
    ]
    cur.executemany("INSERT INTO metadata (name, value) VALUES (?, ?)", meta)

    # Compute task list
    tasks = []
    for z in range(MAX_Z + 1):
        n = 2 ** z
        for x in range(n):
            for y in range(n):
                tasks.append((z, x, y))
    total = len(tasks)
    print(f"Fetching {total} tiles, concurrency={CONCURRENCY}…")

    done = 0
    saved = 0
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = [ex.submit(fetch_tile, *t) for t in tasks]
        for fut in concurrent.futures.as_completed(futures):
            z, x, y, data = fut.result()
            done += 1
            if data:
                tms_y = (2 ** z - 1) - y  # MBTiles uses TMS y
                cur.execute(
                    "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    (z, x, tms_y, data),
                )
                saved += 1
            if done % 100 == 0 or done == total:
                rate = done / (time.time() - t0)
                print(f"  [{done}/{total}] saved={saved} rate={rate:.0f}/s")
                con.commit()
    con.commit()
    con.close()
    sz = os.path.getsize(OUT) / 1024 / 1024
    print(f"\nWrote {OUT} ({sz:.1f} MB, {saved} tiles)")

if __name__ == "__main__":
    main()
