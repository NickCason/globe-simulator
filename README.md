# Terralogue

A visual journal of the world, kept on a hand-drawn globe. Pick any place, from somewhere you're standing to somewhere you've only read about, and keep notes, photos and posts about it. It builds into your own knowledge base of the world, one place at a time.

**Live:** https://terralogue.app (add it to your home screen; it works offline). The repo is `globe-simulator`.

## What it does

- **A sketched globe.** Chunky stepped relief, ink contours, coastlines drawn twice by a loose hand, water-lining like an old map, hatched shadows, and lines that "boil" a little as if redrawn. Drag, throw, pinch, scroll. Four inks: Parchment, Slate, Blueprint, Sepia.
- **Places, four ways.**
  - Tap the globe anywhere.
  - **Here** uses your location.
  - **Find** searches every town of 15,000 people or more, and every country. It works offline.
  - **Photo** reads where a picture was taken from its EXIF. If the phone left that out, it asks.
  - A country becomes an *area*, drawn as a soft glow rather than a pin.
- **Entries.** Notes, photo sets and posts, each with a date, tags and links. Each is marked **been there** (solid pin) or **read about** (hollow pin).
- **The Journal.** Everything, newest first, grouped by month. Search it, or filter by been there, read about, photos, posts or notes.
- **Down to the street, in one zoom.** Keep zooming in past the globe's closest view and it dives into a sketched street map of the spot underneath. **Streets** on a place does the same.
  - The globe pushes in and fades while the map opens as a circle from the same point. Roads ink outward and hatched buildings follow.
  - Pan and pinch; house numbers appear when you're close.
  - Tap a building to make a place named by its address ("2025 Scottwood Avenue").
  - Zoom back out, or tap **Globe**, and the map closes into the middle as the globe comes back.
  - Streets are OpenStreetMap vector tiles from OpenFreeMap, kept in the browser's cache, so places you've seen open offline.
- **Map layers, all adjustable** (the **Map** button):
  - countries as borders or colour (political, by continent, one tint, pastel), with colour strength, border width, ink and dashes;
  - labels for continents, countries, oceans and seas, and mountain ranges, deserts and other features;
  - rivers;
  - label size and how many labels to show.
- **Looks.** Sketch (the hand-drawn globe) or Clean (the same world without the hand), and every knob behind them: wobble, paper grain, hatching, water lines, contour lines, graticule, line boil, drift, relief height, terraces. Four inks.
- **Yours, on your device.** Everything lives in the browser (IndexedDB). Back up to a single file, and restore it on any device. Nothing you write leaves the device. The only outside requests are for street-map tiles, by map position, when you go down to street level.

## Develop

```sh
npm install
npm run dev        # http://localhost:5192
npm test           # unit tests: globe maths, EXIF, the gazetteer
npm run build      # dist/, with a service worker for offline use
npm run smoke      # walks through the app in Chromium (software WebGL); screenshots in shots/
```

Data tools need `python3` with `numpy` and `pillow`. Downloads are cached in `tools/.cache/`:

| Script | Makes |
|---|---|
| `tools/prep_globe.py` | `public/data/elev.jpg`, `mask.png`, `coast.png`: the globe's textures |
| `tools/prep_places.py` | `public/data/places.json`: the offline gazetteer |
| `tools/prep_overlay.py` | `public/data/countries.png` and `overlay.json`: country map, borders, rivers and labels |
| `tools/make_fixtures.py` | the test photos |
| `tools/make_icons.mjs` | the app icons, rendered from the globe itself (`?icon`) |

## The globe, as a module

`src/globe.js` is independent of the journal:

```js
import { create } from './globe.js'
const g = await create(element, {
  textures: { elev, mask, coast },
  theme: { paper, ink, accent, dark },
  onPick: pin => {}, onTap: ({ lat, lon }) => {},
  exaggeration: 0.062, levels: 8, hatch: true, waterlines: true, graticule: true, boil: true, spin: true, calm: false,
})
```

The handle's methods:
- `g.setPins([{ id, lat, lon, label, prec: 'address' | 'town' | 'read' | 'country', glow, glowR }])`
- `g.flyTo({ lat, lon, dist }, ms)`
- `g.route([{ lat, lon }, …], { ms, lift, dash, ship })`
- `g.settle(id, to)`: a vague place shrinks into a precise one.
- `g.set({ exaggeration, levels, hatch, … })`, `g.setTheme(theme)`
- `g.pick(x, y)`, `g.where(lat, lon)`, `g.select(id)`, `g.fit()`, `g.dispose()`

The handle also has:
- `g.setOverlay(data, countriesImage)`;
- `g.setLayers({ countries, palette, fill, borderWidth, … })` (see `LAYERS`);
- `g.pause()` and `g.resume()`.

The `onDive({ lat, lon })` option fires when you zoom in past `minDist`.

`src/streetview.js`, `openStreetView(container, { lat, lon, theme, … })`, draws the street map from vector tiles (`src/tiles.js`, decoded by `src/mvt.js`).

## Credits

- **Relief:** ETOPO1 and GMTED2010, via AWS Terrain Tiles (Mapzen).
- **Coastlines, lakes and countries:** Natural Earth (public domain).
- **Towns:** GeoNames (CC BY 4.0).
- **Streets:** OpenFreeMap; © OpenMapTiles; © OpenStreetMap contributors (ODbL). The test tile `test/fixtures/toledo-14-4389-6102.pbf` comes from the same source.
- **Map layers:** Natural Earth (public domain).
- **Rendering:** three.js (MIT).
