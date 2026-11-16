import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeTile } from '../src/mvt.js'
import { loadTile, tilesAround, tileLatLon } from '../src/tiles.js'

const TILE = readFileSync(new URL('./fixtures/toledo-14-4389-6102.pbf', import.meta.url))   // OpenFreeMap, Toledo, z14

test('decodes a vector tile: layers, features, properties, geometry', () => {
  const t = decodeTile(TILE)
  for (const layer of ['building', 'transportation', 'transportation_name', 'housenumber', 'water']) assert.ok(t[layer], layer)
  assert.equal(t.building.extent, 4096)
  const names = new Set(t.transportation_name.features.map(f => f.props.name))
  assert.ok(names.has('Collingwood Boulevard'))
  const n = t.housenumber.features.find(f => f.props.housenumber === '2055')
  assert.equal(n.type, 1); assert.deepEqual(n.geom[0][0], [485, 2772])
  const b = t.building.features[0]
  assert.equal(b.type, 3); assert.ok(b.geom.length > 0 && b.geom[0].length > 3)
})
test('only the layers asked for', () => {
  assert.deepEqual(Object.keys(decodeTile(TILE, ['water'])), ['water'])
})
test('finds the tiles round a place, and where a tile is', () => {
  const want = tilesAround(41.6726, -83.5561, 400)
  assert.ok(want.some(([x, y]) => x === 4389 && y === 6102), JSON.stringify(want))
  const nw = tileLatLon(4389, 6102), se = tileLatLon(4389, 6102, 1, 1)
  assert.ok(nw.lat > 41.6726 && se.lat < 41.6726 && nw.lon < -83.5561 && se.lon > -83.5561)
})
test('turns a tile into streets in metres round the place', async () => {
  globalThis.fetch = async url => String(url).endsWith('/planet')
    ? new Response(JSON.stringify({ tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'] }))
    : new Response(TILE)
  const d = await loadTile(4389, 6102, { lat: 41.6726, lon: -83.5561 })
  assert.ok(d.buildings.length > 0 && d.roads.length > 50 && d.water.length > 0)
  assert.ok(d.names.some(n => n.n === 'Collingwood Boulevard'))
  assert.ok(d.numbers.some(n => n.n === '2055'))
  const [x0, y0, x1, y1] = d.bounds                    // the tile's corners, in metres from the place
  assert.ok(x0 < 0 && x1 > 0 && y0 < 0 && y1 > 0 && x1 - x0 > 1000 && x1 - x0 < 2000)
})
