"""Builds the globe's closer-in map detail from Natural Earth 1:10m (public domain), loaded after the main layers:

  public/data/detail.json   states and provinces (the lines between them, and their names) and cities, each with the
                            zoom at which Natural Earth's own cartographers would show it (web-map zoom levels; the
                            globe maps them onto its own scale)

Rows: states [minZoom, [lon, lat, lon, lat, ...]], stateNames [name, minZoom, lat, lon],
      cities [name, minZoom, lat, lon, population in thousands, 1 if a national capital].

Run: python3 tools/prep_detail.py   (downloads cached in tools/.cache, shared with prep_overlay.py)
"""
import json
from pathlib import Path

from prep_overlay import lines, ne, simplify

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "detail.json"
UP_TO = 6.8          # the closest the globe goes is about web zoom 7; nothing finer is ever drawn


def join(group):
    """Joins polylines that share endpoints into longer chains (greedily, in either direction)."""
    ends = {}
    for i, ln in enumerate(group):
        ends.setdefault(ln[0], []).append(i)
        ends.setdefault(ln[-1], []).append(i)
    used = [False] * len(group)
    out = []
    for i in range(len(group)):
        if used[i]:
            continue
        used[i] = True
        chain = list(group[i])
        for front in (False, True):
            while True:
                tip = chain[0] if front else chain[-1]
                nxt = next((j for j in ends.get(tip, []) if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                ln = group[nxt]
                if front:
                    chain = (ln if ln[-1] == tip else ln[::-1])[:-1] + chain
                else:
                    chain += (ln if ln[0] == tip else ln[::-1])[1:]
        out.append(chain)
    return out


def main():
    # The lines come in thousands of short pieces: join the ones that meet end to end (per zoom), then simplify.
    pieces = {}
    for f in ne("ne_10m_admin_1_states_provinces_lines")["features"]:
        z = f["properties"].get("MIN_ZOOM") or 99
        if z > UP_TO or not f.get("geometry"):
            continue
        for ln in lines(f["geometry"]):
            pts = [(round(x, 2), round(y, 2)) for x, y in ln]
            if len(pts) >= 2:
                pieces.setdefault(round(z, 1), []).append(pts)
    states = []
    for z, group in sorted(pieces.items()):
        for chain in join(group):
            pts = simplify(chain, 0.02)                                       # ~1 km: finer than the globe draws
            if len(pts) > 2 or (len(pts) == 2 and pts[0] != pts[1]):
                states.append([z, [v for p in pts for v in p]])

    names = []
    for f in ne("ne_10m_admin_1_states_provinces")["features"]:
        p = f["properties"]
        z = p.get("min_label") or 99
        if z <= UP_TO and p.get("name") and p.get("latitude") is not None:
            names.append([p["name"], round(z, 1), round(p["latitude"], 2), round(p["longitude"], 2)])

    cities = []
    for f in ne("ne_10m_populated_places_simple")["features"]:
        p = f["properties"]
        z = p.get("min_zoom") or 99
        if z <= UP_TO:
            cities.append([p["name"], round(z, 1), round(p["latitude"], 2), round(p["longitude"], 2),
                           max(1, round((p.get("pop_max") or 0) / 1000)), 1 if p.get("adm0cap") else 0])
    cities.sort(key=lambda c: (c[1], -c[4]))

    OUT.write_text(json.dumps({"v": 1, "states": states, "stateNames": names, "cities": cities,
                               "credit": "Natural Earth (public domain)"}, separators=(",", ":"), ensure_ascii=False))
    print(OUT, OUT.stat().st_size // 1024, "KB:", len(states), "state lines,", len(names), "state names,", len(cities), "cities")


if __name__ == "__main__":
    main()
