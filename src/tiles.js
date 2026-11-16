// Street data: OpenStreetMap vector tiles from OpenFreeMap (free, no key; © OpenMapTiles, © OpenStreetMap
// contributors). Tiles are kept in the browser's cache, so a street map you've seen opens again offline.
import { decodeTile } from './mvt.js'

export const Z = 14                                    // OpenFreeMap's deepest zoom: every building and road is here
export const COARSE = 12                               // a light, wide layer beneath: main roads, water and parks, no buildings
const TILEJSON = 'https://tiles.openfreemap.org/planet'
const CACHE = 'terralogue-tiles-v1'
const LAYERS = ['water', 'park', 'landcover', 'landuse', 'building', 'transportation', 'transportation_name', 'housenumber', 'waterway']
let template = null

async function getTemplate() {
  if (template) return template
  const res = await cached(TILEJSON)
  template = (await res.json()).tiles[0]
  return template
}
async function cached(url) {
  let box = null
  try { box = await caches.open(CACHE) } catch { /* no Cache API (private mode): just fetch */ }
  const hit = box && await box.match(url)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The map tiles answered ${res.status}.`)
  if (box) box.put(url, res.clone()).catch(() => {})
  return res
}

// Which tiles (of zoom z) cover a box of `half` metres round a point.
export function tilesAround(lat, lon, halfX, halfY = halfX, z = Z) {
  const n = 2 ** z, k = 111320 * Math.cos(lat * Math.PI / 180)
  const tx = l => Math.floor((l + 180) / 360 * n)
  const ty = a => Math.floor((1 - Math.log(Math.tan(a * Math.PI / 180) + 1 / Math.cos(a * Math.PI / 180)) / Math.PI) / 2 * n)
  const x0 = tx(lon - halfX / k), x1 = tx(lon + halfX / k), y0 = ty(lat + halfY / 110540), y1 = ty(lat - halfY / 110540)
  const out = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y])
  return out
}
export const tileLatLon = (x, y, fx = 0, fy = 0, z = Z) => {      // a point inside tile (x, y), as fractions of the tile
  const n = 2 ** z, wx = (x + fx) / n, wy = (y + fy) / n
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, lon: wx * 360 - 180 }
}

/** Loads one tile and turns it into features in metres east (x) and south (y) of `origin` ({lat, lon}). */
export async function loadTile(x, y, origin, z = Z) {
  const url = (await getTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y)
  const res = await cached(url)
  const layers = decodeTile(new Uint8Array(await res.arrayBuffer()), LAYERS)
  const kx = 111320 * Math.cos(origin.lat * Math.PI / 180), ky = 110540
  const n = 2 ** z
  const toM = (ext) => ([px, py]) => {
    const wy = (y + py / ext) / n, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI
    const lon = (x + px / ext) / n * 360 - 180
    return [(lon - origin.lon) * kx, -(lat - origin.lat) * ky]
  }
  const nw = tileLatLon(x, y, 0, 0, z), se = tileLatLon(x, y, 1, 1, z)
  const out = { x, y, z, bounds: [(nw.lon - origin.lon) * kx, -(nw.lat - origin.lat) * ky, (se.lon - origin.lon) * kx, -(se.lat - origin.lat) * ky],
                water: [], parks: [], buildings: [], roads: [], rail: [], names: [], numbers: [], streams: [] }
  for (const [name, layer] of Object.entries(layers)) {
    const m = toM(layer.extent)
    for (const f of layer.features) {
      const parts = f.geom.map(p => p.map(m)), c = f.props.class
      if (name === 'water' && f.type === 3) out.water.push(parts)
      else if (name === 'waterway' && f.type === 2) out.streams.push(...parts)
      else if ((name === 'park' || (name === 'landcover' && /grass|wood|forest|wetland/.test(c)) || (name === 'landuse' && /cemetery|stadium|pitch|park/.test(c))) && f.type === 3) out.parks.push(parts)
      else if (name === 'building' && f.type === 3) out.buildings.push(parts)
      else if (name === 'transportation' && f.type === 2) {
        if (c === 'rail' || c === 'transit') out.rail.push(...parts)
        else if (c !== 'ferry' && c !== 'aerialway') for (const p of parts) out.roads.push({ k: c, sub: f.props.subclass, tunnel: f.props.brunnel === 'tunnel', p })
      } else if (name === 'transportation_name' && f.type === 2 && (f.props.name || f.props['name:latin'])) {
        for (const p of parts) out.names.push({ n: f.props.name || f.props['name:latin'], k: c, p })
      } else if (name === 'housenumber' && f.type === 1) {
        for (const p of parts) out.numbers.push({ n: String(f.props.housenumber), p: p[0] })
      }
    }
  }
  return out
}
