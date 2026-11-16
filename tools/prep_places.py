"""Builds public/data/places.json, the offline gazetteer for search and for naming a spot you tap:

  - every town of 15,000 people or more, from GeoNames (cities15000, CC BY 4.0), with its region and country;
  - every country, at Natural Earth's label point (public domain), with a rough radius for drawing it as an area.

Rows are compact: [name, ascii name, lat*100, lon*100, country code, region, population in thousands] for towns and
[name, lat*100, lon*100, radius in degrees, country code] for countries.   Run: python3 tools/prep_places.py
"""
import io
import json
import math
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE.parent / "public" / "data" / "places.json"
UA = {"User-Agent": "globe-simulator/0.1 (one-off data prep; github.com/NickCason/globe-simulator)"}


def get(url, name):
    f = CACHE / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read())
    return f.read_bytes()


def main():
    CACHE.mkdir(exist_ok=True)
    gn = "https://download.geonames.org/export/dump/"
    countries = {}
    for line in get(gn + "countryInfo.txt", "countryInfo.txt").decode("utf-8").splitlines():
        if line and not line.startswith("#"):
            f = line.split("\t")
            countries[f[0]] = f[4]
    regions = {}
    for line in get(gn + "admin1CodesASCII.txt", "admin1CodesASCII.txt").decode("utf-8").splitlines():
        code, name = line.split("\t")[:2]
        regions[code] = name
    z = zipfile.ZipFile(io.BytesIO(get(gn + "cities15000.zip", "cities15000.zip")))
    towns = []
    for line in z.read("cities15000.txt").decode("utf-8").splitlines():
        f = line.split("\t")
        name, ascii_, lat, lon, cc, a1, pop = f[1], f[2], float(f[4]), float(f[5]), f[8], f[10], int(f[14] or 0)
        towns.append([name, ascii_ if ascii_ != name else "", round(lat * 100), round(lon * 100), cc,
                      regions.get(f"{cc}.{a1}", ""), max(1, round(pop / 1000))])
    towns.sort(key=lambda r: -r[6])
    ne = json.loads(get("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
                        "ne_50m_admin_0_countries.geojson"))
    lands = []
    for feat in ne["features"]:
        p = feat["properties"]
        name, cc = p.get("NAME_LONG") or p.get("NAME"), p.get("ISO_A2_EH") or p.get("ISO_A2")
        lat, lon = p.get("LABEL_Y"), p.get("LABEL_X")
        if not name or lat is None or lon is None:
            continue
        # a radius from the outline's extent, so a country reads as an area of about the right size
        ring = []
        g = feat["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            ring.extend(poly[0])
        lats = [y for _, y in ring]; lons = [x for x, _ in ring]
        span = max(max(lats) - min(lats), (max(lons) - min(lons)) * math.cos(math.radians(lat)))
        lands.append([name, round(lat * 100), round(lon * 100), round(min(14, max(0.6, span / 3.2)), 1), cc if cc != "-99" else ""])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"v": 1, "countries": countries, "towns": towns, "lands": lands,
                               "credit": "Towns: GeoNames (CC BY 4.0). Countries: Natural Earth (public domain)."},
                              separators=(",", ":"), ensure_ascii=False))
    print(OUT, OUT.stat().st_size // 1024, "KB:", len(towns), "towns,", len(lands), "countries")


if __name__ == "__main__":
    main()
