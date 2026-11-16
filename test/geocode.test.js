import test from 'node:test'
import assert from 'node:assert/strict'
import { fromGeoNames, fromOSM } from '../src/geocode.js'

test('a village from GeoNames reads as a village, with where it is', () => {
  const h = fromGeoNames({ name: 'Bad Hindelang', latitude: 47.506, longitude: 10.372, feature_code: 'PPL', admin1: 'Bavaria', country: 'Germany', population: 4985 })
  assert.deepEqual([h.name, h.label, h.sub, h.prec, h.place], ['Bad Hindelang', 'Village', 'Bavaria, Germany', 'town', true])
  assert.equal(fromGeoNames({ name: 'Paris', latitude: 48.85, longitude: 2.35, feature_code: 'PPLC', country: 'France', population: 2138551 }).label, 'Capital')
})

test('OpenStreetMap answers: a landmark, a street, a settlement; nameless ones are dropped', () => {
  const lm = fromOSM({ geometry: { coordinates: [2.2945, 48.8584] }, properties: { name: 'Eiffel Tower', osm_key: 'tourism', osm_value: 'attraction', city: 'Paris', state: 'Ile-de-France', country: 'France' } })
  assert.deepEqual([lm.label, lm.sub, lm.prec, lm.lat], ['Attraction', 'Paris, Ile-de-France, France', 'exact', 48.8584])
  const st = fromOSM({ geometry: { coordinates: [-0.1779, 51.5321] }, properties: { name: 'Abbey Road', osm_key: 'highway', osm_value: 'residential', type: 'street', city: 'London', country: 'United Kingdom' } })
  assert.equal(st.label, 'Street')
  const v = fromOSM({ geometry: { coordinates: [10.37, 47.5] }, properties: { name: 'Hinterstein', osm_key: 'place', osm_value: 'village', state: 'Bavaria', country: 'Germany' } })
  assert.deepEqual([v.label, v.prec, v.place], ['Village', 'town', true])
  assert.equal(fromOSM({ geometry: { coordinates: [0, 0] }, properties: { osm_key: 'natural', osm_value: 'water' } }), null)
  // the Eiffel Tower has a street address, but it's a tower, not "an address"
  const et = fromOSM({ geometry: { coordinates: [2.2945, 48.8583] }, properties: { name: 'Eiffel Tower', osm_key: 'man_made', osm_value: 'tower', type: 'house', housenumber: '5', street: 'Avenue Anatole France', city: 'Paris', country: 'France' } })
  assert.equal(et.label, 'Tower')
  const door = fromOSM({ geometry: { coordinates: [-0.1276, 51.5034] }, properties: { osm_key: 'building', osm_value: 'yes', type: 'house', housenumber: '10', street: 'Downing Street', city: 'London', country: 'United Kingdom' } })
  assert.deepEqual([door.name, door.label], ['10 Downing Street', 'Address'])
  assert.equal(fromOSM({ geometry: { coordinates: [10, 47] }, properties: { name: 'Bad Hindelang, Hennenmühle', osm_key: 'highway', osm_value: 'bus_stop' } }), null)
})
