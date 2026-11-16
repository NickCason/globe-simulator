import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readExif } from '../src/photos.js'

const buf = f => { const b = readFileSync(new URL('./fixtures/' + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

test('reads where and when a photo was taken', () => {
  const x = readExif(buf('kyoto.jpg'))
  assert.equal(x.taken, '2026-04-03')
  assert.ok(Math.abs(x.lat - 35.0116) < 1e-3, `lat ${x.lat}`)
  assert.ok(Math.abs(x.lon - 135.7681) < 1e-3, `lon ${x.lon}`)
})
test('a photo without EXIF gives nothing', () => {
  assert.deepEqual(readExif(buf('plain.jpg')), {})
})
test('not a JPEG at all gives nothing', () => {
  assert.deepEqual(readExif(new Uint8Array([1, 2, 3, 4, 5]).buffer), {})
})
