// Down to the street: a sketched map of OpenStreetMap tiles on a canvas you can pan and pinch. Roads are inked as
// double lines and spread outward from where you came down; buildings are hatched; parks and water are washed in.
// It opens as a circle growing from a point (where the globe was) and closes back into the middle when you zoom
// out far enough (onExit), so the globe and the streets read as one zoom.
//
// Dense cities have tens of thousands of buildings, so the map is drawn once into three pictures (ground, ink, text)
// and those are moved and scaled while you pan or pinch; when you stop, they're drawn again, sharp, for the new view.
// The pictures reach past the screen's edges, and the map loads ahead of you: first a light, wide layer (the main
// roads, water and parks, three screens out), then the detail, nearest first. Where the detail stops it fades into
// the light layer, and where everything stops it fades into the paper, so nothing loads in as a hard square.
import { Z, COARSE, loadTile, tilesAround } from './tiles.js'

const WIDTH = { motorway: 22, trunk: 20, primary: 17, secondary: 15, tertiary: 12, minor: 9, raceway: 9, busway: 8, service: 5.5, track: 3, path: 2 }
const ORDER = ['path', 'track', 'service', 'minor', 'busway', 'raceway', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']
const ease = t => 1 - Math.pow(1 - t, 3)
const OV = 1.7                                       // the pictures are this much bigger than the screen (a third of a screen each side)
const FEATHER = 22                                   // css px: how soft the edge of what's loaded is
const k01 = v => Math.max(0, Math.min(1, v))

export function openStreetView(container, o) {
  const origin = { lat: o.lat, lon: o.lon }
  const kx = 111320 * Math.cos(origin.lat * Math.PI / 180), ky = 110540
  const el = document.createElement('div'); el.className = 'street'
  const cv = document.createElement('canvas'); el.appendChild(cv)
  // the map's credit: in full for the first moments, then folded into a small ⓘ in the corner that opens again on a tap
  const credit = document.createElement('button'); credit.className = 'osm open'; credit.type = 'button'
  credit.innerHTML = '<i>i</i><span>© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></span>'
  credit.addEventListener('pointerdown', e => e.stopPropagation())
  credit.addEventListener('click', e => { if (!e.target.closest('a')) credit.classList.toggle('open') })
  setTimeout(() => credit.classList.remove('open'), 5000)
  el.appendChild(credit)
  el.style.setProperty('--x', Math.round(o.at?.x ?? 0) + 'px'); el.style.setProperty('--y', Math.round(o.at?.y ?? 0) + 'px')
  container.appendChild(el)
  const g = cv.getContext('2d')
  let W = 1, H = 1, dpr = 1, base = 0
  let theme = o.theme, style = { hatch: true, ...o.style }, places = o.places || []
  const view = { cx: 0, cy: 0, ppm: 1 }
  const tiles = new Map()                             // "x/y" -> null while loading, then { data, paths, born }
  const t0 = performance.now()
  let alive = true, needs = true, revealDone = false, closing = null, opening = true, firstBorn = 0
  let snap = null, dirty = true, lastTouch = 0, lastTile = 0, hatchPat = null, patFor = ''
  let SW = 1, SH = 1, sdpr = 1, lastSnap = 0, lastEnsure = 0, lastErr = 0, inflight = 0, queue = [], tmp = null

  function resize() {
    const r = el.getBoundingClientRect()
    W = Math.max(1, r.width); H = Math.max(1, r.height); dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'
    SW = Math.round(W * OV); SH = Math.round(H * OV)
    sdpr = Math.min(dpr, Math.sqrt(7e6 / (SW * SH)))      // each picture stays under about seven million pixels
    const was = base
    base = Math.min(W, H) / 1100                       // about 1.1 km across the narrow side
    view.ppm = was ? view.ppm * base / was : base * (o.startScale ?? 0.3)
    dirty = needs = true
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize()

  // ---- data ------------------------------------------------------------------------------------------------------
  function build(d) {
    const poly = list => { const p = new Path2D(); for (const parts of list) for (const ring of parts) ring.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); return p }
    const line = pts => { const p = new Path2D(); pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); return p }
    const byClass = {}
    for (const r of d.roads) { const k = WIDTH[r.k] ? r.k : 'minor'; (byClass[k + (r.tunnel ? ':t' : '')] ||= new Path2D()).addPath(line(r.p)) }
    const rail = new Path2D(); for (const p of d.rail) rail.addPath(line(p))
    const streams = new Path2D(); for (const p of d.streams) streams.addPath(line(p))
    return { water: poly(d.water), parks: poly(d.parks), buildings: poly(d.buildings), byClass, rail, streams }
  }
  const centreLatLon = () => ({ lat: origin.lat - view.cy / ky, lon: origin.lon + view.cx / kx })
  // What to load: the light layer three screens out (a few big tiles), then the detail nearest first, out to about two
  // screens, so that by the time you pan there it's arrived. Tiles far behind you are let go.
  function ensureTiles() {
    const ppm = opening ? base : view.ppm                // opening: load for the view it will settle on
    const c = opening ? origin : centreLatLon(), hx = W / 2 / ppm, hy = H / 2 / ppm
    const n = 2 ** Z, tx = (c.lon + 180) / 360 * n
    const ty = (1 - Math.log(Math.tan(c.lat * Math.PI / 180) + 1 / Math.cos(c.lat * Math.PI / 180)) / Math.PI) / 2 * n
    const dist = (z, x, y) => { const f = 2 ** (Z - z); return Math.hypot((x + 0.5) * f - tx, (y + 0.5) * f - ty) }
    const near = (a, b) => dist(...a) - dist(...b)
    const coarse = tilesAround(c.lat, c.lon, hx * 3, hy * 3, COARSE).map(([x, y]) => [COARSE, x, y]).sort(near)
    const fine = tilesAround(c.lat, c.lon, hx * 1.9, hy * 1.9, Z).map(([x, y]) => [Z, x, y]).sort(near).slice(0, 40)
    const want = [...coarse, ...fine], keep = new Set(want.map(t => t.join('/')))
    queue = want.filter(t => !tiles.has(t.join('/')))
    pump()
    if (tiles.size > 90) for (const [k, tl] of tiles) if (tl && !keep.has(k) && tiles.size > 70) tiles.delete(k)
  }
  function pump() {                                    // a few at a time, so the nearest arrive first
    while (inflight < 8 && queue.length) {
      const [z, x, y] = queue.shift(), key = `${z}/${x}/${y}`
      if (tiles.has(key)) continue
      tiles.set(key, null); inflight++
      loadTile(x, y, origin, z).then(data => {
        if (!alive) return
        const now = performance.now()
        tiles.set(key, { z, data, paths: build(data), born: now })
        if (!firstBorn) firstBorn = now
        lastTile = now
        if (!snap || covers(data.bounds)) dirty = needs = true   // redraw only for tiles the pictures reach
      }).catch(err => {
        tiles.delete(key)
        if (performance.now() - lastErr > 15000) { lastErr = performance.now(); o.onError && o.onError(err) }
      }).finally(() => { inflight--; if (alive) pump() })
    }
  }
  const covers = ([x0, y0, x1, y1]) => {
    const hw = SW / 2 / snap.ppm, hh = SH / 2 / snap.ppm
    return x1 > snap.cx - hw && x0 < snap.cx + hw && y1 > snap.cy - hh && y0 < snap.cy + hh
  }

  // ---- drawing: the three pictures -------------------------------------------------------------------------------
  function pattern() {
    const key = theme.ink + theme.paper
    if (patFor === key) return hatchPat
    const c = document.createElement('canvas'); c.width = c.height = 8
    const p = c.getContext('2d'); p.strokeStyle = theme.ink; p.globalAlpha = 0.42; p.lineWidth = 1
    p.beginPath(); p.moveTo(0, 8); p.lineTo(8, 0); p.moveTo(-2, 2); p.lineTo(2, -2); p.moveTo(6, 10); p.lineTo(10, 6); p.stroke()
    hatchPat = g.createPattern(c, 'repeat'); patFor = key
    return hatchPat
  }
  const mix = (a, b, t) => {
    const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)), [x, y] = [h(a), h(b)]
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
  }
  const toScreen = (mx, my, v = view) => [(mx - v.cx) * v.ppm + W / 2, (my - v.cy) * v.ppm + H / 2]
  function halo(x, text, px, py) { x.lineWidth = 4; x.strokeStyle = theme.paper; x.strokeText(text, px, py); x.fillText(text, px, py) }

  // Where tiles are, as a tiny picture (a cell per FEATHER px) that, stretched smoothly over a big one, makes soft edges.
  // Its outermost ring is left empty, so the pictures themselves fade out at their edges too.
  function mask(list, v) {
    const m = document.createElement('canvas'); m.width = Math.ceil(SW / FEATHER); m.height = Math.ceil(SH / FEATHER)
    const x = m.getContext('2d'), s = v.ppm / FEATHER, ox = SW / 2 / FEATHER, oy = SH / 2 / FEATHER
    x.beginPath()                                        // one path, so tiles side by side leave no seam
    for (const tl of list) { const [x0, y0, x1, y1] = tl.data.bounds; x.rect((x0 - v.cx) * s + ox, (y0 - v.cy) * s + oy, (x1 - x0) * s, (y1 - y0) * s) }
    x.fillStyle = '#fff'; x.fill()
    x.clearRect(0, 0, m.width, 1); x.clearRect(0, m.height - 1, m.width, 1); x.clearRect(0, 0, 1, m.height); x.clearRect(m.width - 1, 0, 1, m.height)
    return m
  }
  function apply(ctx, m, op) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = op; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true
    ctx.drawImage(m, 0, 0, m.width * FEATHER * sdpr, m.height * FEATHER * sdpr); ctx.restore()
  }
  function scratch(pw, ph) {
    tmp ||= document.createElement('canvas')
    if (tmp.width !== pw || tmp.height !== ph) { tmp.width = pw; tmp.height = ph }
    const t = tmp.getContext('2d'); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.clearRect(0, 0, pw, ph)
    return t
  }
  function paint(c, which, v, masks) {
    const over = which !== 'text', cw = over ? SW : W, ch = over ? SH : H, r = over ? sdpr : dpr
    const pw = Math.round(cw * r), ph = Math.round(ch * r)
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph }
    const x = c.getContext('2d'), s = v.ppm, all = [...tiles.values()].filter(Boolean)
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, pw, ph)
    if (!over) { x.setTransform(dpr, 0, 0, dpr, 0, 0); labels(x, all, v); numbers(x, all.filter(t => t.z === Z), v); return }
    const fine = all.filter(t => t.z === Z), coarse = all.filter(t => t.z !== Z)
    const each = (ctx, list, fn) => {
      for (const tl of list) {
        const [x0, y0, x1, y1] = tl.data.bounds
        ctx.save(); ctx.setTransform(r * s, 0, 0, r * s, r * (cw / 2 - v.cx * s), r * (ch / 2 - v.cy * s))
        ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip(); fn(tl.paths, ctx); ctx.restore()
      }
    }
    const t = scratch(pw, ph)
    if (which === 'ground') {
      ground(x, coarse, each, s)
      each(t, fine, (p, cx) => { cx.fillStyle = theme.paper; cx.fillRect(-1e7, -1e7, 2e7, 2e7) })   // a clean sheet under the detail
      ground(t, fine, each, s)
    } else {
      ink(x, coarse, each, s)
      apply(x, masks.detail, 'destination-out')           // the light layer's lines give way where the detail is
      ink(t, fine, each, s)
    }
    apply(t, masks.detail, 'destination-in')              // the detail, soft at its edges
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(t.canvas, 0, 0)
    apply(x, masks.edge, 'destination-in')                // and everything fades into the paper where nothing's loaded yet
  }
  function ground(x, list, each, s) {
    const water = mix(theme.paper, theme.water, theme.dark ? 0.32 : 0.24), park = mix(theme.paper, theme.park, theme.dark ? 0.22 : 0.17)
    each(x, list, (p, c) => { c.fillStyle = water; c.fill(p.water, 'evenodd'); c.strokeStyle = mix(theme.paper, theme.water, 0.7); c.lineWidth = 1.4 / s; c.stroke(p.water)
                              c.lineWidth = 1.6 / s; c.stroke(p.streams) })
    each(x, list, (p, c) => { c.fillStyle = park; c.fill(p.parks, 'evenodd') })
    const pat = style.hatch ? pattern() : null
    if (pat) pat.setTransform?.(new DOMMatrix().scale(1 / s))
    each(x, list, (p, c) => {
      c.fillStyle = pat || mix(theme.paper, theme.ink, 0.13); c.fill(p.buildings)
      if (s > base * 0.5) { c.strokeStyle = theme.ink; c.globalAlpha = 0.85; c.lineWidth = 1 / s; c.stroke(p.buildings) }
    })
  }
  function ink(x, list, each, s) {
    const casing = 2.6 / s
    each(x, list, (p, c) => {
      c.lineCap = 'round'; c.lineJoin = 'round'
      for (const pass of [0, 1]) for (const k of ORDER) for (const tun of ['', ':t']) {
        const path = p.byClass[k + tun]; if (!path) continue
        if (k === 'path' || k === 'track') {
          if (pass) { c.strokeStyle = theme.ink; c.globalAlpha = 0.6; c.lineWidth = 1.2 / s; c.setLineDash([4 / s, 3 / s]); c.stroke(path); c.setLineDash([]); c.globalAlpha = 1 }
          continue
        }
        if (tun && !pass) c.setLineDash([5 / s, 4 / s])
        c.strokeStyle = pass ? theme.paper : theme.ink; c.lineWidth = pass ? WIDTH[k] : WIDTH[k] + casing
        c.stroke(path); c.setLineDash([])
      }
      c.strokeStyle = theme.ink; c.lineWidth = 1.6 / s; c.setLineDash([7 / s, 5 / s]); c.stroke(p.rail); c.setLineDash([])
    })
  }
  function labels(x, list, v) {
    x.font = 'italic 13.5px Georgia, "Iowan Old Style", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = theme.muted
    const boxes = [], seen = new Map()
    for (const tl of list) for (const nm of tl.data.names) {
      let best = null
      for (let i = 1; i < nm.p.length; i++) {
        const [ax, ay] = toScreen(...nm.p[i - 1], v), [bx, by] = toScreen(...nm.p[i], v)
        const len = Math.hypot(bx - ax, by - ay), mx = (ax + bx) / 2, my = (ay + by) / 2
        if (mx < 20 || mx > W - 20 || my < 40 || my > H - 60) continue
        if (!best || len > best.len) best = { len, mx, my, ang: Math.atan2(by - ay, bx - ax) }
      }
      if (!best) continue
      const w = x.measureText(nm.n).width
      if (best.len < w + 24) continue
      const prev = seen.get(nm.n)
      if (prev && Math.hypot(prev[0] - best.mx, prev[1] - best.my) < 260) continue
      const box = [best.mx - w / 2 - 4, best.my - 10, best.mx + w / 2 + 4, best.my + 10]
      if (boxes.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue
      boxes.push(box); seen.set(nm.n, [best.mx, best.my])
      let a = best.ang; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI
      x.save(); x.translate(best.mx, best.my); x.rotate(a); halo(x, nm.n, 0, 0); x.restore()
    }
  }
  function numbers(x, list, v) {
    if (v.ppm < base * 2.2) return                    // house numbers only when you're close
    x.font = '600 10px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = theme.ink
    const grid = new Set()
    for (const tl of list) for (const h of tl.data.numbers) {
      const [px, py] = toScreen(...h.p, v)
      if (px < 0 || px > W || py < 0 || py > H) continue
      const cell = Math.floor(px / 26) + ':' + Math.floor(py / 14)
      if (grid.has(cell)) continue
      grid.add(cell); halo(x, h.n, px, py)
    }
  }
  function snapshot() {
    const t = performance.now()
    const v = opening ? { cx: 0, cy: 0, ppm: base } : { ...view }
    const s = snap || { ground: document.createElement('canvas'), ink: document.createElement('canvas'), text: document.createElement('canvas') }
    const all = [...tiles.values()].filter(Boolean), masks = { detail: mask(all.filter(t => t.z === Z), v), edge: mask(all, v) }
    paint(s.ground, 'ground', v, masks); paint(s.ink, 'ink', v, masks); paint(s.text, 'text', v)
    snap = Object.assign(s, v); dirty = false
    el.dataset.snapMs = Math.round(performance.now() - t); lastSnap = performance.now()   // how long a redraw takes (tests read it)
  }

  // ---- each frame: the pictures, placed for the current view, then the live things on top ------------------------
  function render(now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
    if (!firstBorn) {                                  // waiting for the first streets: a ring pulses where you're landing
      const [x, y] = toScreen(0, 0), q = (now % 1200) / 1200
      g.beginPath(); g.arc(x, y, 10 + q * 26, 0, Math.PI * 2); g.strokeStyle = theme.accent; g.globalAlpha = 1 - q; g.lineWidth = 2.5; g.stroke(); g.globalAlpha = 1
      chrome(); return true
    }
    if (!snap || (dirty && now - lastTouch > 180 && now - lastTile > 60 && now - lastSnap > 500 && !closing)) snapshot()
    const tr = now - firstBorn, k = view.ppm / snap.ppm
    const far = Math.hypot(W / 2, H / 2) / view.ppm + Math.hypot(view.cx, view.cy)
    const reach = lag => revealDone ? null : far * ease(k01((tr - 60 - lag) / 1300))
    const put = (img, R, alpha = 1, over = true) => {    // a picture, placed for the view (the big ones centred on theirs)
      if (R === 0 || alpha <= 0) return
      g.save(); g.globalAlpha = alpha
      if (R != null) { const [cx, cy] = toScreen(0, 0); g.beginPath(); g.arc(cx, cy, R * view.ppm, 0, Math.PI * 2); g.clip() }
      const cw = over ? SW : W, ch = over ? SH : H
      g.setTransform(dpr * k, 0, 0, dpr * k, dpr * (W / 2 + (snap.cx - view.cx) * view.ppm - cw / 2 * k), dpr * (H / 2 + (snap.cy - view.cy) * view.ppm - ch / 2 * k))
      g.drawImage(img, 0, 0, cw, ch); g.restore()
    }
    g.fillStyle = theme.paper; g.fillRect(0, 0, W, H)
    put(snap.ground, reach(380))                       // the reveal: inked outward from where you came down,
    put(snap.ink, reach(0))                            // roads first, the buildings just behind
    put(snap.text, null, k01((tr - 1150) / 500), false)
    if (!revealDone && tr > 1900) revealDone = true
    pins(k01((tr - 1400) / 500))
    callout(k01((tr - 1500) / 500))
    chrome()
    return !revealDone || opening || !!closing || dirty || tr < 2000
  }
  function pins(a) {
    if (a <= 0) return
    g.globalAlpha = a
    for (const p of places) {
      const [x, y] = toScreen((p.lon - origin.lon) * kx, -(p.lat - origin.lat) * ky)
      if (x < -20 || x > W + 20 || y < -40 || y > H + 20) continue
      g.save(); g.translate(x, y)
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-3, -9, -11, -14, -11, -21); g.arc(0, -21, 11, Math.PI, 0); g.bezierCurveTo(11, -14, 3, -9, 0, 0)
      g.fillStyle = p.been ? theme.accent : theme.paper; g.strokeStyle = theme.ink; g.lineWidth = 1.6; g.fill(); g.stroke()
      g.beginPath(); g.arc(0, -21, 4, 0, Math.PI * 2); g.fillStyle = p.been ? theme.paper : theme.ink; g.fill()
      g.font = '650 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = theme.ink; halo(g, p.name, 0, 4)
      g.restore()
    }
    g.globalAlpha = 1
  }
  function callout(a) {                              // the place you came down to, with its name
    if (a <= 0 || !o.title) return
    const [x, y] = toScreen(0, 0)
    if (x < 0 || x > W || y < 0 || y > H) return
    g.globalAlpha = a
    g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fillStyle = theme.accent + '33'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = theme.accent; g.stroke()
    g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = theme.accent; g.fill()
    g.font = '400 22px Georgia, "Iowan Old Style", serif'
    const w1 = g.measureText(o.title).width; g.font = '600 12px system-ui, sans-serif'
    const w2 = o.subtitle ? g.measureText(o.subtitle).width : 0, bw = Math.max(w1, w2) + 28
    const bx = Math.max(10, Math.min(W - bw - 10, x - bw / 2 - 30)), by = Math.max(60, y - 130)
    g.beginPath(); g.moveTo(x - 2, y - 16); g.bezierCurveTo(x - 12, y - 50, x - 20, by + 90, bx + bw / 2, by + 66)
    g.strokeStyle = theme.accent; g.lineWidth = 2.5; g.lineCap = 'round'; g.stroke()
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, o.subtitle ? 62 : 44, 10) : g.rect(bx, by, bw, o.subtitle ? 62 : 44)
    g.fillStyle = theme.paper; g.fill(); g.strokeStyle = theme.ink; g.lineWidth = 1.5; g.stroke()
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = theme.ink; g.font = '400 22px Georgia, "Iowan Old Style", serif'; g.fillText(o.title, bx + 14, by + 30)
    if (o.subtitle) { g.font = '600 12px system-ui, sans-serif'; g.fillStyle = theme.muted; g.fillText(o.subtitle, bx + 14, by + 50) }
    g.globalAlpha = 1
  }
  function chrome() {                                // a scale bar and a north arrow
    const top = (o.top || 16) + 8
    const metres = [20, 50, 100, 200, 500, 1000, 2000, 5000].find(m => m * view.ppm > 70) || 5000
    const len = metres * view.ppm, x = 18, y = top + 14
    g.strokeStyle = theme.ink; g.lineWidth = 2.5; g.lineCap = 'butt'
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.moveTo(x + len, y - 6); g.lineTo(x + len, y + 6); g.stroke()
    g.font = '600 12px system-ui, sans-serif'; g.fillStyle = theme.ink; g.textAlign = 'center'; g.textBaseline = 'bottom'
    halo(g, metres >= 1000 ? metres / 1000 + ' km' : metres + ' m', x + len / 2, y - 6)
    const nx = W - 30, ny = top + 64
    g.beginPath(); g.moveTo(nx, ny - 22); g.lineTo(nx + 8, ny + 6); g.lineTo(nx, ny + 1); g.lineTo(nx - 8, ny + 6); g.closePath(); g.fillStyle = theme.ink; g.fill()
    g.font = '700 12px system-ui, sans-serif'; g.textBaseline = 'top'; halo(g, 'N', nx, ny + 9)
  }
  let timer = null
  function frame(now) {
    if (!alive) return
    if (closing) {
      const q = Math.min(1, (now - closing.t0) / closing.ms)
      view.ppm = closing.from * (1 - 0.7 * ease(q)); needs = true
      if (q >= 1) { closing.done(); return }
    } else if (opening) {
      const q = Math.min(1, (now - t0) / 1000), s0 = o.startScale ?? 0.3
      view.ppm = base * (s0 + (1 - s0) * ease(q)); needs = true
      if (q >= 1) { opening = false; dirty = true }
    }
    if (needs || dirty) {
      needs = render(now)
      if (!opening && !closing) {
        if (now - lastEnsure > 220) { lastEnsure = now; ensureTiles() }      // while you move, not only once you stop
        clearTimeout(timer); timer = setTimeout(ensureTiles, 160)
      }
    }
    requestAnimationFrame(frame)
  }
  ensureTiles(); requestAnimationFrame(frame)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')))

  // ---- hands --------------------------------------------------------------------------------------------------------
  const pts = new Map(); let pinch0 = null, down = null, pressure = 0
  const minPPM = () => base * 0.42, maxPPM = () => base * 9
  const touched = () => { lastTouch = performance.now(); dirty = needs = true; opening = false }
  function zoomAt(f, sx, sy) {
    const before = view.ppm, ppm = Math.max(minPPM(), Math.min(maxPPM(), before * f))
    const mx = view.cx + (sx - W / 2) / before, my = view.cy + (sy - H / 2) / before
    view.ppm = ppm; view.cx = mx - (sx - W / 2) / ppm; view.cy = my - (sy - H / 2) / ppm; touched()
  }
  cv.addEventListener('pointerdown', e => {
    if (closing) return
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); touched()
    down = pts.size === 1 ? [e.clientX, e.clientY, performance.now()] : null
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), ppm: view.ppm } }
  })
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || closing) return
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY])
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()], r = el.getBoundingClientRect()
      const want = pinch0.ppm * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0.d
      if (want < minPPM() * 0.8) { exit(); return }
      zoomAt(want / view.ppm, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top)
    } else {
      view.cx -= (e.clientX - prev[0]) / view.ppm; view.cy -= (e.clientY - prev[1]) / view.ppm; touched()
    }
  })
  const up = e => {
    const was = pts.get(e.pointerId); pts.delete(e.pointerId)
    if (pts.size < 2) pinch0 = null
    if (e.type === 'pointerup' && down && was && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 7 && performance.now() - down[2] < 400) tap(e)
    down = null
  }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up)
  cv.addEventListener('wheel', e => {
    e.preventDefault()
    const r = el.getBoundingClientRect()
    if (e.deltaY > 0 && view.ppm <= minPPM() * 1.01) { if (++pressure >= 3) exit(); return }
    pressure = 0
    zoomAt(e.deltaY > 0 ? 0.9 : 1.11, e.clientX - r.left, e.clientY - r.top)
  }, { passive: false })
  function tap(e) {
    const r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top
    for (const p of places) {
      const [x, y] = toScreen((p.lon - origin.lon) * kx, -(p.lat - origin.lat) * ky)
      if (Math.hypot(x - sx, y - 12 - sy) < 24) return o.onPlace && o.onPlace(p.id)
    }
    const mx = view.cx + (sx - W / 2) / view.ppm, my = view.cy + (sy - H / 2) / view.ppm
    o.onTap && o.onTap({ lat: origin.lat - my / ky, lon: origin.lon + mx / kx, address: address(mx, my) })
  }
  // A spot's address from the map itself: the nearest house number and the street it's on.
  function address(mx, my) {
    let num = null, nd = 30, street = null, sd = 70
    for (const tl of tiles.values()) {
      if (!tl) continue
      for (const h of tl.data.numbers) { const d = Math.hypot(h.p[0] - mx, h.p[1] - my); if (d < nd) { nd = d; num = h.n } }
      for (const nm of tl.data.names) for (let i = 1; i < nm.p.length; i++) {
        const [ax, ay] = nm.p[i - 1], [bx, by] = nm.p[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1
        const q = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / L)), d = Math.hypot(ax + q * dx - mx, ay + q * dy - my)
        if (d < sd) { sd = d; street = nm.n }
      }
    }
    return num && street ? `${num} ${street}` : street ? `On ${street}` : null
  }
  let exited = false
  function exit() { if (exited || closing) return; exited = true; o.onExit && o.onExit(centreLatLon()) }

  return {
    el,
    centre: centreLatLon,
    setTheme(t) { theme = t; patFor = ''; dirty = needs = true },
    setStyle(s) { style = { ...style, ...s }; patFor = ''; dirty = needs = true },
    setPlaces(list) { places = list; needs = true },
    close() {                                        // shrink back into the middle, as the globe comes up
      return new Promise(done => {
        closing = { t0: performance.now(), ms: 600, from: view.ppm, done: () => { alive = false; ro.disconnect(); el.remove(); done() } }
        el.style.setProperty('--x', W / 2 + 'px'); el.style.setProperty('--y', H / 2 + 'px')
        el.classList.remove('on'); el.classList.add('off'); needs = true
      })
    },
  }
}
