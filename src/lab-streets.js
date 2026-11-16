// A draft (lab/index.html, at terralogue.app/lab): the street map drawn on the globe itself, not in a separate view. Around a city, the
// OpenFreeMap tiles are inked into two pictures in the sketch style (a wide one with the main roads, a close one with
// every street and building) and laid on the globe's surface as curved patches that turn with it. They come in as
// you come down; the relief's exaggeration eases off near the ground, so a few km up the city lies flat beneath you.
// The real build will do this for the whole world, tile by tile, at every zoom (the street mode goes away).
import { BufferAttribute, BufferGeometry, CanvasTexture, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { create, ll } from './globe.js'
import { COARSE, Z, loadTile, tilesAround } from './tiles.js'

const THEME = { paper: '#F3E8D2', ink: '#2B231D', accent: '#B4532F', water: '#3F6E8C', park: '#6B7041' }
const CITIES = {
  paris: { name: 'Paris', lat: 48.8566, lon: 2.3522 }, toledo: { name: 'Toledo, Ohio', lat: 41.6528, lon: -83.5379 },
  kyoto: { name: 'Kyoto', lat: 35.0116, lon: 135.7681 }, newyork: { name: 'New York', lat: 40.7128, lon: -74.006 },
  sf: { name: 'San Francisco', lat: 37.7793, lon: -122.4193 },
}
const EXAG = 0.062, D2R = Math.PI / 180
const WIDTH = { motorway: 22, trunk: 20, primary: 17, secondary: 15, tertiary: 12, minor: 9, raceway: 9, busway: 8, service: 5.5, track: 3, path: 2 }
const ORDER = ['path', 'track', 'service', 'minor', 'busway', 'raceway', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']
const $ = s => document.querySelector(s)
const mix = (a, b, t) => {
  const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)), [x, y] = [h(a), h(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
}

let g = null, patches = [], city = null, busy = false

async function boot() {
  g = await create($('#globe'), {
    textures: { elev: '../data/elev.jpg', mask: '../data/mask.png', coast: '../data/coast.png' }, theme: THEME,
    minDist: 1.00035, spin: false, onView: v => viewed(v),
  })
}

// ---- inking a set of tiles into one picture --------------------------------------------------------------------------
function hatch(g2, s) {
  const c = document.createElement('canvas'); c.width = c.height = 8
  const p = c.getContext('2d'); p.strokeStyle = THEME.ink; p.globalAlpha = 0.45; p.lineWidth = 1
  p.beginPath(); p.moveTo(0, 8); p.lineTo(8, 0); p.moveTo(-2, 2); p.lineTo(2, -2); p.moveTo(6, 10); p.lineTo(10, 6); p.stroke()
  const pat = g2.createPattern(c, 'repeat'); pat.setTransform?.(new DOMMatrix().scale(1 / s))
  return pat
}
function ink(canvas, tiles, b, opts) {
  const { detail } = opts
  const g2 = canvas.getContext('2d'), W = canvas.width, H = canvas.height, s = W / (b[2] - b[0])
  g2.clearRect(0, 0, W, H)
  g2.setTransform(s, 0, 0, s, -b[0] * s, -b[1] * s)
  const each = fn => { for (const t of tiles) { const [x0, y0, x1, y1] = t.bounds; g2.save(); g2.beginPath(); g2.rect(x0, y0, x1 - x0, y1 - y0); g2.clip(); fn(t); g2.restore() } }
  const poly = list => { const p = new Path2D(); for (const parts of list) for (const ring of parts) ring.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); return p }
  const line = pts => { const p = new Path2D(); pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); return p }
  g2.fillStyle = mix(THEME.paper, THEME.ink, 0.07); g2.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1])   // the globe's own land colour
  each(t => {
    g2.fillStyle = mix(THEME.paper, THEME.water, 0.26); g2.fill(poly(t.water), 'evenodd')
    g2.strokeStyle = mix(THEME.paper, THEME.water, 0.7); g2.lineWidth = 1.4 / s; g2.stroke(poly(t.water))
    if (detail) { g2.fillStyle = mix(THEME.paper, THEME.park, 0.18); g2.fill(poly(t.parks), 'evenodd') }   // coarse woods and grass come as tile-sized squares
  })
  if (detail) {
    const pat = hatch(g2, s)
    each(t => { const p = poly(t.buildings); g2.fillStyle = pat; g2.fill(p); g2.strokeStyle = THEME.ink; g2.globalAlpha = 0.8; g2.lineWidth = 0.8 / s; g2.stroke(p); g2.globalAlpha = 1 })
  }
  g2.lineCap = 'round'; g2.lineJoin = 'round'
  const wide = opts.wide || 1                         // the wider pictures are seen from higher up: their roads drawn bolder
  for (const pass of [0, 1]) for (const k of ORDER) {
    if (!detail && (k === 'path' || k === 'track' || k === 'service')) continue
    each(t => {
      const p = new Path2D()
      for (const r of t.roads) if ((WIDTH[r.k] ? r.k : 'minor') === k) p.addPath(line(r.p))
      if (k === 'path' || k === 'track') {
        if (pass) { g2.strokeStyle = THEME.ink; g2.globalAlpha = 0.55; g2.lineWidth = 1.1 / s; g2.setLineDash([4 / s, 3 / s]); g2.stroke(p); g2.setLineDash([]); g2.globalAlpha = 1 }
        return
      }
      g2.strokeStyle = pass ? THEME.paper : THEME.ink
      g2.lineWidth = (pass ? WIDTH[k] : WIDTH[k] + 2.6 / s) * wide
      g2.stroke(p)
    })
  }
  each(t => { const p = new Path2D(); for (const r of t.rail) p.addPath(line(r)); g2.strokeStyle = THEME.ink; g2.lineWidth = 1.6 / s * wide; g2.setLineDash([7 / s, 5 / s]); g2.stroke(p); g2.setLineDash([]) })
  // soft edges: the picture fades into the globe round its rim
  g2.setTransform(1, 0, 0, 1, 0, 0)
  const fade = g2.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.5)
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)')
  g2.globalCompositeOperation = 'destination-in'; g2.fillStyle = fade; g2.fillRect(0, 0, W, H); g2.globalCompositeOperation = 'source-over'
}

// ---- a curved patch of the globe's surface, carrying a picture -------------------------------------------------------
function patch(b, c, canvas, lift) {
  const kx = 111320 * Math.cos(c.lat * D2R), ky = 110540, N = 40, pts = []
  const pos = new Float32Array((N + 1) ** 2 * 3), uv = new Float32Array((N + 1) ** 2 * 2), idx = []
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const mx = b[0] + (b[2] - b[0]) * i / N, my = b[1] + (b[3] - b[1]) * j / N
    pts.push([c.lat - my / ky, c.lon + mx / kx])
    uv.set([i / N, 1 - j / N], (j * (N + 1) + i) * 2)
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2) }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('uv', new BufferAttribute(uv, 2)); geo.setIndex(idx)
  const tex = new CanvasTexture(canvas); tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
  const mesh = new Mesh(geo, mat); mesh.renderOrder = 2
  const place = () => {                                 // on the ground, as high as the (eased) relief puts it
    pts.forEach(([lat, lon], k) => { const v = ll(lat, lon, 1 + g.groundAt(lat, lon) + lift); pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z })
    geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere()
  }
  place()
  return { mesh, mat, place, drop: g.addObject(mesh), free() { geo.dispose(); tex.dispose(); mat.dispose() } }
}

async function load(key) {
  if (busy) return
  busy = true
  for (const b of $('#chips').querySelectorAll('[data-c]')) b.classList.toggle('on', b.dataset.c === key)
  for (const p of patches) { p.drop(); p.free() }
  patches = []
  city = CITIES[key]
  $('#hud').innerHTML = `Inking <b>${city.name}</b>…`
  g.flyTo({ lat: city.lat, lon: city.lon, dist: 1.08 }, 1800)
  try {
    const sets = [
      { z: 10, half: 40000, size: 2048, lift: 1e-6, detail: false, wide: 2.2, show: [0.12, 0.05], order: 2 },     // ~80 km: the big roads
      { z: COARSE, half: 11000, size: 2048, lift: 2e-6, detail: false, wide: 1.4, show: [0.03, 0.011], order: 3 }, // ~22 km: the main roads
      { z: Z, half: 3200, size: 2048, lift: 4e-6, detail: true, wide: 1, show: [0.0045, 0.0016], order: 4 },       // ~6 km: every street
    ]
    for (const set of sets) {
      const want = tilesAround(city.lat, city.lon, set.half, set.half, set.z)
      const tiles = (await Promise.all(want.map(([x, y]) => loadTile(x, y, city, set.z).catch(() => null)))).filter(Boolean)
      const b = [-set.half, -set.half, set.half, set.half]
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = set.size
      ink(canvas, tiles, b, set)
      const p = patch(b, city, canvas, set.lift)
      p.mesh.renderOrder = set.order                 // the finer picture always over the coarser one
      patches.push({ ...p, show: set.show })
    }
    viewed(g.view())
  } catch (err) { $('#hud').textContent = 'Couldn’t reach the street maps just now.' }
  busy = false
}

// Coming down: the patches come in, the relief's exaggeration eases off (in steps, so the ground is moved rarely).
let exag = EXAG
function viewed(v) {
  const alt = v.dist - 1
  const e = Math.round(EXAG * Math.max(0, Math.min(1, (alt - 0.0015) / 0.2)) * 400) / 400
  if (e !== exag) { exag = e; g.set({ exaggeration: e }); for (const p of patches) p.place() }
  for (const p of patches) {
    const [from, to] = p.show, o = Math.max(0, Math.min(1, (from - alt) / (from - to)))
    if (Math.abs(p.mat.opacity - o) > 0.01) { p.mat.opacity = o; p.mesh.visible = o > 0.01; g.redraw() }
  }
  const km = alt * 6371
  if (city && !busy) $('#hud').innerHTML = `<b>${city.name}</b> · ${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(km < 10 ? 1 : 0)} km up`
}

// Dive: straight down at an even rate of zoom (the height halves at a steady beat), from wherever you are to 4 km up.
function dive() {
  const v = g.view(), a0 = Math.max(1e-4, v.dist - 1), a1 = 0.0006, ms = 6500, t0 = performance.now()
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    const lat = v.lat + (city.lat - v.lat) * Math.min(1, k * 3), lon = v.lon + (((city.lon - v.lon + 540) % 360) - 180) * Math.min(1, k * 3)
    g.jump({ lat, lon, dist: 1 + Math.exp(Math.log(a0) + (Math.log(a1) - Math.log(a0)) * k) })
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !g) return
  if (b.id === 'dive') return city ? dive() : load('paris').then(dive)
  load(b.dataset.c)
})
boot().then(() => { window.lab = { g, load }; return load('paris') })        // window.lab: for tests and poking around
