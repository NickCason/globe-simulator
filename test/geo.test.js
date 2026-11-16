import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ll, toLatLon, wrap, distanceKm, arc } from '../src/globe.js'

test('a place survives the trip to 3D and back', () => {
  for (const [lat, lon] of [[0, 0], [35.01, 135.77], [-33.86, 151.21], [64.15, -21.94], [-54.8, -68.3]]) {
    const p = toLatLon(ll(lat, lon))
    assert.ok(Math.abs(p.lat - lat) < 1e-9 && Math.abs(wrap(p.lon - lon)) < 1e-9, `${lat},${lon} -> ${p.lat},${p.lon}`)
  }
})
test('longitudes wrap', () => {
  assert.equal(wrap(190), -170); assert.equal(wrap(-190), 170); assert.equal(wrap(540), -180)
})
test('distances are great-circle', () => {
  const d = distanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })   // London to Paris
  assert.ok(Math.abs(d - 344) < 3, `${d}`)
})
test('an arc starts and ends where it should, and lifts in the middle', () => {
  const a = { lat: 51.85, lon: -8.3 }, b = { lat: 40.7, lon: -74.0 }
  const pts = arc(a, b, 32, 0.2, 1)
  const s = toLatLon(pts[0]), e = toLatLon(pts.at(-1))
  assert.ok(Math.abs(s.lat - a.lat) < 1e-6 && Math.abs(e.lon - b.lon) < 1e-6)
  assert.ok(pts[16].length() > 1.05 && Math.abs(pts[0].length() - 1) < 1e-9)
})
