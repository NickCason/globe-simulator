// Photos: where and when they were taken (read from the JPEG's EXIF), and copies small enough to keep on a phone.
// Phones often strip a photo's location when it's picked in a browser; then the journal asks where it was.

/** Reads a JPEG's EXIF: { lat, lon, taken: 'YYYY-MM-DD' } (fields present only if found). Pure: takes an ArrayBuffer. */
export function readExif(buf) {
  const v = new DataView(buf), out = {}
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return out
  let off = 2
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off), size = v.getUint16(off + 2)
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) { parseTiff(v, off + 10, out); break }   // "Exif"
    if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break                                        // start of scan
    off += 2 + size
  }
  return out
}
function parseTiff(v, t, out) {
  const le = v.getUint16(t) === 0x4949
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le)
  const rational = o => { const d = u32(o + 4); return d ? u32(o) / d : 0 }
  const ifd = (o, fn) => {
    if (!o || t + o + 2 > v.byteLength) return
    const n = u16(o)
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12
      if (t + e + 12 > v.byteLength) return
      fn(u16(e), u16(e + 2), u32(e + 4), e + 8)
    }
  }
  const ascii = (count, at) => { let s = ''; const o = count > 4 ? u32(at) : at; for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i)); return s }
  let exif = 0, gps = 0
  ifd(u32(4), (tag, type, count, at) => { if (tag === 0x8769) exif = u32(at); if (tag === 0x8825) gps = u32(at); if (tag === 0x0132 && !out.taken) out.taken = ascii(count, at) })
  ifd(exif, (tag, type, count, at) => { if (tag === 0x9003) out.taken = ascii(count, at) })
  if (out.taken) out.taken = out.taken.slice(0, 10).replace(/:/g, '-')
  const g = {}
  ifd(gps, (tag, type, count, at) => {
    if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(t + at))
    if ((tag === 2 || tag === 4) && type === 5 && count === 3) { const o = u32(at); g[tag] = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600 }
  })
  if (g[2] != null && g[4] != null && (g[2] || g[4])) {
    out.lat = g[1] === 'S' ? -g[2] : g[2]
    out.lon = g[3] === 'W' ? -g[4] : g[4]
  }
}

// Draws an image file (rotated as the camera meant it) into a JPEG no wider or taller than max.
async function scaled(file, max, quality) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file isn’t a picture this browser can read.')); i.src = url })
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', quality))
    return { blob, w, h }
  } finally { URL.revokeObjectURL(url) }
}

/** A picked file -> { blob (≤2048 px), thumb (≤420 px), w, h, taken, lat, lon } */
export async function prepare(file) {
  const meta = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? readExif(await file.slice(0, 256 * 1024).arrayBuffer()) : {}
  const [big, small] = await Promise.all([scaled(file, 2048, 0.86), scaled(file, 420, 0.8)])
  return { blob: big.blob, thumb: small.blob, w: big.w, h: big.h, ...meta }
}
