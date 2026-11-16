import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as gaz from '../src/places.js'

const json = readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8')
globalThis.fetch = async () => ({ json: async () => JSON.parse(json) })
await gaz.load()

test('finds towns by name, biggest first, ignoring accents', () => {
  const r = gaz.search('kyoto')
  assert.equal(r[0].name, 'Kyoto'); assert.equal(r[0].kind, 'town'); assert.match(r[0].sub, /Japan/)
  assert.ok(gaz.search('sao paulo').some(p => p.name === 'São Paulo'))
})
test('countries come first when they match', () => {
  const r = gaz.search('japan')
  assert.equal(r[0].kind, 'country'); assert.ok(r[0].radius > 1)
})
test('names the spot you tap', () => {
  assert.equal(gaz.describe(35.0116, 135.7681).name, 'Kyoto')
  assert.match(gaz.describe(35.2, 135.76).name, /^Near /)
  assert.match(gaz.describe(-40, -30).name, /°S/)                 // the middle of the South Atlantic
})
