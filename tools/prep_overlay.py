"""Builds the globe's map layers from Natural Earth 1:50m (public domain):

  public/data/countries.png  4096x2048, each pixel the country's number (1-255, 0 = none), for coloured fills
  public/data/overlay.json   countries (name, ISO code, continent, subregion, map colours, label point and rank),
                             land borders (simplified), rivers, and labels for continents, oceans and seas, and
                             physical features (mountain ranges, deserts, plateaus...)

Run: python3 tools/prep_overlay.py   (needs numpy and pillow; downloads cached in tools/.cache)
"""
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE.parent / "public" / "data"
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"


def ne(name):
    p = CACHE / f"{name}.geojson"
    if not p.exists():
        subprocess.run(["curl", "-s", "-o", str(p), BASE + name + ".geojson"], check=True)
    return json.loads(p.read_text())


def rings(g):
    for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
        yield poly[0], poly[1:]


def lines(g):
    return g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]


def simplify(pts, tol):
    """Douglas-Peucker, in degrees."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        n = math.hypot(dx, dy) or 1e-12
        best, idx = 0, None
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / n
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def flat(pts, tol=0.025):
    out = []
    for x, y in simplify(pts, tol):
        out += [round(x, 2), round(y, 2)]
    return out


def deepest(geom, w=1440, h=720):
    """The point deepest inside a polygon (far from every edge): where its label reads best."""
    img = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(img)
    for outer, holes in rings(geom):
        d.polygon([((x + 180) / 360 * w, (90 - y) / 180 * h) for x, y in outer], fill=1)
        for hole in holes:
            d.polygon([((x + 180) / 360 * w, (90 - y) / 180 * h) for x, y in hole], fill=0)
    inside = np.asarray(img, dtype=bool)
    if not inside.any():
        return None
    depth = np.zeros(inside.shape, dtype=np.int32)
    cur = inside.copy()
    for i in range(1, 200):                         # peel the shape away a pixel at a time
        nxt = cur & np.roll(cur, 1, 0) & np.roll(cur, -1, 0) & np.roll(cur, 1, 1) & np.roll(cur, -1, 1)
        depth[cur & ~nxt] = i
        if not nxt.any():
            break
        cur = nxt
    depth[cur] = i
    y, x = np.unravel_index(np.argmax(depth), depth.shape)
    return round(90 - (y + 0.5) * 180 / h, 2), round((x + 0.5) * 360 / w - 180, 2)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    feats = ne("ne_50m_admin_0_countries")["features"]
    # biggest first, so enclaves (Lesotho in South Africa) are drawn over the country around them
    def area(f):
        return sum(abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(o, o[1:] + o[:1]))) / 2 for o, _ in rings(f["geometry"]))
    feats.sort(key=area, reverse=True)
    W, H = 4096, 2048
    ids = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(ids)
    countries = []
    for i, f in enumerate(feats[:255], start=1):
        p = f["properties"]
        for outer, holes in rings(f["geometry"]):
            d.polygon([((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in outer], fill=i)
            for hole in holes:
                d.polygon([((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in hole], fill=0)
        cc = p.get("ISO_A2_EH") or p.get("ISO_A2") or ""
        countries.append([p.get("NAME") or p.get("ADMIN"), "" if cc == "-99" else cc, p.get("CONTINENT", ""), p.get("SUBREGION", ""),
                          p.get("MAPCOLOR7", 1), p.get("MAPCOLOR9", 1), p.get("LABELRANK", 5),
                          round(p.get("LABEL_Y") or 0, 2), round(p.get("LABEL_X") or 0, 2), p.get("MIN_LABEL", 5)])
    ids.save(OUT / "countries.png", optimize=True)

    borders = []
    for f in ne("ne_50m_admin_0_boundary_lines_land")["features"]:
        cls = (f["properties"].get("FEATURECLA") or "").lower()
        kind = 0 if cls.startswith("international") else 1          # disputed, indefinite, lines of control: dashed
        for ln in lines(f["geometry"]):
            borders.append([kind, flat(ln)])
    rivers = []
    for f in ne("ne_50m_rivers_lake_centerlines")["features"]:
        p = f["properties"]
        if (p.get("scalerank") or 9) > 8:
            continue
        for ln in lines(f["geometry"]):
            rivers.append([p.get("name_en") or p.get("name") or "", p.get("min_label") or 6, flat(ln, 0.03)])
    def title(n):                                   # "INDIAN OCEAN" -> "Indian Ocean"
        if not n.isupper():
            return n
        small = {"of", "the", "and", "de", "la", "del"}
        return " ".join(w.lower() if i and w.lower() in small else w.capitalize() for i, w in enumerate(n.split()))
    marine = []
    for f in ne("ne_50m_geography_marine_polys")["features"]:
        p = f["properties"]
        at = deepest(f["geometry"])
        if at and p.get("name"):
            marine.append([title(p["name"]), p.get("featurecla", ""), p.get("scalerank", 5), p.get("min_label", 5), at[0], at[1]])
    regions = []                                     # mountain ranges, deserts, plateaus, basins, deltas, island groups…
    for f in ne("ne_50m_geography_regions_polys")["features"]:
        p = f["properties"]
        cls = (p.get("FEATURECLA") or "").lower()
        if not p.get("NAME") or cls in ("continent", "coast"):
            continue
        at = deepest(f["geometry"])
        if at:
            regions.append([title(p["NAME"]), cls, p.get("SCALERANK", 5), p.get("MIN_LABEL", 5), at[0], at[1]])
    for f in ne("ne_50m_geography_regions_points")["features"]:   # and a few points: waterfalls, capes, the poles
        p = f["properties"]
        if p.get("name") and p.get("featurecla") in ("waterfall", "cape", "pole"):
            regions.append([p["name"], p["featurecla"], p.get("scalerank", 5), p.get("min_zoom", 5), round(p["lat_y"], 2), round(p["long_x"], 2)])
    continents = [["North America", 47, -100], ["South America", -14, -59], ["Europe", 53, 17], ["Africa", 6, 20],
                  ["Asia", 46, 92], ["Oceania", -24, 134], ["Antarctica", -81, 25]]
    data = {"v": 1, "countries": countries, "borders": borders, "rivers": rivers, "marine": marine, "regions": regions,
            "continents": continents, "credit": "Natural Earth (public domain)"}
    (OUT / "overlay.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    for n in ("countries.png", "overlay.json"):
        print(n, (OUT / n).stat().st_size // 1024, "KB")
    print(len(countries), "countries,", len(borders), "border lines,", len(rivers), "rivers,", len(marine), "seas,", len(regions), "regions")


if __name__ == "__main__":
    main()
