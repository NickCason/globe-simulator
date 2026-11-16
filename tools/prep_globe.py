"""Builds the globe's three textures in public/data/ (all from public data; downloads are cached in tools/.cache):

  elev.jpg   1024x512 equirectangular, 128 = sea level; above it land height ((m / 5000) ** 0.62), below it sea depth
             (sqrt(m / 8000)). From AWS Terrain Tiles (Mapzen "terrarium" encoding) at zoom 3, which is ETOPO1 and
             GMTED2010 at this scale, reprojected from Web Mercator. Lightly blurred so terraces don't squiggle.
  mask.png   2048x1024 land (white) and water (black), with soft edges: Natural Earth 1:50m land, minus lakes larger
             than about 0.6 square degrees. Drawn at twice the size and averaged down so coasts stay smooth zoomed in.
  coast.png  1024x512 distance from the nearest land across the sea, up to 20 pixels at the equator (east-west steps
             shrink with latitude), for the water-lining.

Needs: python3 with numpy and pillow.   Run: python3 tools/prep_globe.py
"""
import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE.parent / "public" / "data"
UA = {"User-Agent": "globe-simulator/0.1 (one-off data prep; github.com/NickCason/globe-simulator)"}


def get(url, name):
    f = CACHE / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
    return f.read_bytes()


def elevation(w=1024, h=512, z=3):
    n = 2 ** z
    merc = np.zeros((256 * n, 256 * n), dtype=np.float32)
    for x in range(n):
        for y in range(n):
            png = get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", f"t{z}_{x}_{y}.png")
            a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.float32)
            merc[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    lat = np.clip(90 - (np.arange(h) + 0.5) * 180 / h, -85.05, 85.05)
    my = (1 - np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) / np.pi) / 2 * merc.shape[0]
    mx = (-180 + (np.arange(w) + 0.5) * 360 / w + 180) / 360 * merc.shape[1]
    return merc[np.clip(my.astype(int), 0, merc.shape[0] - 1)[:, None], np.clip(mx.astype(int), 0, merc.shape[1] - 1)[None, :]]


def rings(geom):
    for poly in (geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]):
        yield poly[0], poly[1:]


def mask(w, h):
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    xy = lambda ring: [((x + 180) / 360 * w, (90 - y) / 180 * h) for x, y in ring]   # noqa: E731
    base = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    for f in json.loads(get(base + "ne_50m_land.geojson", "ne_50m_land.geojson"))["features"]:
        for outer, holes in rings(f["geometry"]):
            d.polygon(xy(outer), fill=255)
            for hole in holes:
                d.polygon(xy(hole), fill=0)
    for f in json.loads(get(base + "ne_50m_lakes.geojson", "ne_50m_lakes.geojson"))["features"]:
        for outer, _ in rings(f["geometry"]):
            lat = sum(p[1] for p in outer) / len(outer)
            area = abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(outer, outer[1:] + outer[:1]))) / 2
            if area * math.cos(math.radians(lat)) >= 0.6:          # big lakes only: small ones read as specks
                d.polygon(xy(outer), fill=0)
    return img


def coast_distance(land, reach=20):
    h, w = land.shape
    coslat = np.cos(np.radians(90 - (np.arange(h) + 0.5) * 180 / h))[:, None]
    dist = np.full(land.shape, float(reach), dtype=np.float32)
    dist[land] = 0
    for dy in range(-reach, reach + 1):
        sy = np.roll(land, dy, axis=0)
        if dy > 0:
            sy[:dy] = False
        elif dy < 0:
            sy[dy:] = False
        for dx in range(-2 * reach, 2 * reach + 1):
            d = np.sqrt((dx * coslat) ** 2 + dy * dy)
            if d.min() >= reach:
                continue
            np.minimum(dist, np.where(np.roll(sy, dx, axis=1), d, reach), out=dist)
    return dist


if __name__ == "__main__":
    CACHE.mkdir(exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    e = elevation()
    big = mask(4096, 2048).resize((2048, 1024), Image.BOX)
    big.save(OUT / "mask.png", optimize=True)
    small = np.asarray(big.resize((1024, 512), Image.BILINEAR)) > 127
    land_h = (np.clip(e, 0, 5000) / 5000) ** 0.62
    sea_d = np.sqrt(np.clip(-e, 0, 8000) / 8000)
    sea_d[(~small) & (e > 0)] = 0.15                 # lakes: their beds sit above sea level; give them a shallow floor
    v = np.where(small, 128 + land_h * 127, 128 - sea_d * 127)
    Image.fromarray(v.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)).save(OUT / "elev.jpg", quality=90, optimize=True)
    Image.fromarray((np.clip(coast_distance(small) / 20, 0, 1) * 255).astype(np.uint8)).save(OUT / "coast.png", optimize=True)
    for f in ("elev.jpg", "mask.png", "coast.png"):
        print(f, (OUT / f).stat().st_size // 1024, "KB")
