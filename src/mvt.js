// A small reader for Mapbox Vector Tiles (protobuf): just what the street view needs, no dependencies.
// decodeTile(bytes, ['building', 'transportation', …]) -> { layerName: { extent, features: [{ type, props, geom }] } }
// type: 1 point, 2 line, 3 polygon. geom: an array of parts, each an array of [x, y] in tile units (0…extent).

class Reader {
  constructor(buf) { this.b = buf; this.pos = 0 }
  varint() {
    let x = 0, shift = 0, byte
    do {
      byte = this.b[this.pos++]
      x += (byte & 0x7f) * 2 ** shift                 // arithmetic, not bit ops: values can pass 32 bits
      shift += 7
    } while (byte & 0x80)
    return x
  }
  bytes() { const n = this.varint(), s = this.b.subarray(this.pos, this.pos + n); this.pos += n; return s }
  string() { return new TextDecoder().decode(this.bytes()) }
  skip(wire) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.pos += 8
    else if (wire === 2) this.pos += this.varint()
    else if (wire === 5) this.pos += 4
    else throw new Error('unknown protobuf wire type ' + wire)
  }
  get done() { return this.pos >= this.b.length }
}
const zigzag = n => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)

function value(buf) {
  const r = new Reader(buf), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let v = null
  while (!r.done) {
    const tag = r.varint(), f = Math.floor(tag / 8), w = tag & 7
    if (f === 1) v = r.string()
    else if (f === 2) { v = dv.getFloat32(r.pos, true); r.pos += 4 }
    else if (f === 3) { v = dv.getFloat64(r.pos, true); r.pos += 8 }
    else if (f === 4 || f === 5) v = r.varint()
    else if (f === 6) v = zigzag(r.varint())
    else if (f === 7) v = !!r.varint()
    else r.skip(w)
  }
  return v
}

function packed(buf) {
  const r = new Reader(buf), out = []
  while (!r.done) out.push(r.varint())
  return out
}

function geometry(cmds) {
  const parts = []
  let x = 0, y = 0, part = null, i = 0
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, count = c >> 3
    if (id === 1 || id === 2) {                       // MoveTo, LineTo
      for (let k = 0; k < count; k++) {
        x += zigzag(cmds[i++]); y += zigzag(cmds[i++])
        if (id === 1) { part = []; parts.push(part) }
        part.push([x, y])
      }
    } else if (id === 7 && part && part.length) {     // ClosePath
      part.push([part[0][0], part[0][1]])
    }
  }
  return parts
}

function feature(buf, keys, values) {
  const r = new Reader(buf)
  let type = 0, tags = [], geom = []
  while (!r.done) {
    const tag = r.varint(), f = Math.floor(tag / 8), w = tag & 7
    if (f === 2) tags = packed(r.bytes())
    else if (f === 3) type = r.varint()
    else if (f === 4) geom = packed(r.bytes())
    else r.skip(w)
  }
  const props = {}
  for (let k = 0; k + 1 < tags.length; k += 2) props[keys[tags[k]]] = values[tags[k + 1]]
  return { type, props, geom: geometry(geom) }
}

export function decodeTile(bytes, want) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const wanted = want ? new Set(want) : null
  const out = {}, r = new Reader(buf)
  while (!r.done) {
    const tag = r.varint(), f = Math.floor(tag / 8), w = tag & 7
    if (f !== 3) { r.skip(w); continue }
    const lr = new Reader(r.bytes())
    let name = '', extent = 4096
    const keys = [], values = [], feats = []
    while (!lr.done) {
      const t = lr.varint(), lf = Math.floor(t / 8), lw = t & 7
      if (lf === 1) name = lr.string()
      else if (lf === 2) feats.push(lr.bytes())
      else if (lf === 3) keys.push(lr.string())
      else if (lf === 4) values.push(value(lr.bytes()))
      else if (lf === 5) extent = lr.varint()
      else lr.skip(lw)
    }
    if (wanted && !wanted.has(name)) continue
    out[name] = { extent, features: feats.map(fb => feature(fb, keys, values)) }
  }
  return out
}
