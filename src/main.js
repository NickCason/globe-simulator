// Terralogue (globe-simulator): a visual journal of the world. Pin photos, notes and posts to any place on a hand-drawn globe.
// Everything stays on this device (src/store.js).
import { create, LAYERS } from './globe.js'
import { openStreetView } from './streetview.js'
import * as store from './store.js'
import { prepare } from './photos.js'
import * as gaz from './places.js'
import { makeGuide } from './guide.js'
import { searchOnline } from './geocode.js'

const INKS = {
  parchment: { name: 'Parchment', paper: '#F3E8D2', ink: '#2B231D', accent: '#B4532F', muted: '#7A6450', park: '#6B7041', water: '#3F6E8C' },
  slate: { name: 'Slate', paper: '#1B1612', ink: '#F1E6D2', accent: '#E07A4F', muted: '#B3A085', park: '#A9B06E', water: '#7FB2CC', dark: true },
  blueprint: { name: 'Blueprint', paper: '#163A5F', ink: '#E8F1FA', accent: '#FFD166', muted: '#A9C3DD', park: '#8FD3B6', water: '#9FD3F0', dark: true },
  sepia: { name: 'Sepia', paper: '#FBF5E8', ink: '#5A3A22', accent: '#8C2F1B', muted: '#8A6F55', park: '#6F7A3A', water: '#4C6B7A' },
}
const LOOK = [['hatch', 'Hatching'], ['waterlines', 'Water lines'], ['contours', 'Contour lines'], ['graticule', 'Graticule'], ['boil', 'Line boil'], ['spin', 'Drift']]
// Looks: each is just settings. Sketch is the hand-drawn globe; Clean draws the same world without the hand.
const STYLES = {
  sketch: { name: 'Sketch', set: { hatch: true, waterlines: true, contours: true, wobble: 1, grain: 1, boil: !calm } },
  clean: { name: 'Clean', set: { hatch: false, waterlines: false, contours: true, wobble: 0, grain: 0, boil: false } },
}
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = (s, r = document) => r.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const today = () => new Date().toISOString().slice(0, 10)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fold = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const S = {
  g: null, places: [], entries: [], open: null, temp: null, street: null, picking: null, pending: null,
  look: (() => {
    const saved = JSON.parse(localStorage.getItem('globe-look') || '{}')
    if (saved.v !== 2) delete saved.spin                 // drift used to be on by default; now the globe comes to rest
    return { ink: 'parchment', style: 'sketch', exaggeration: 0.062, levels: 8, hatch: true, waterlines: true, contours: true, graticule: true,
             wobble: 1, grain: 1, boil: !calm, spin: false, ...saved, v: 2,
             layers: { ...LAYERS, countries: 'borders', ...(saved.layers || {}) } }
  })(),
}
const saveLook = () => localStorage.setItem('globe-look', JSON.stringify(S.look))
if (new URLSearchParams(location.search).has('debug')) window.terralogue = S      // for tests: ?debug

// ---- start --------------------------------------------------------------------------------------------------------
const ICONSHOT = new URLSearchParams(location.search).has('icon')     // for making the app icon: just the globe
async function boot() {
  paint(INKS[S.look.ink])
  const sp = window.__splash
  if (ICONSHOT) { document.body.classList.add('iconshot'); Object.assign(S.look, { spin: false, boil: false }) }
  sp?.progress(0.3)
  const { ink, layers, style, ...look } = S.look
  S.g = await create($('#globe'), {
    textures: { elev: 'data/elev.jpg', mask: 'data/mask.png', coast: 'data/coast.png' }, theme: INKS[ink], calm, ...look,
    deferReveal: !!sp?.alive,
    onPick: (p, members) => picked(p, members),
    onTap: at => tapped(at),
    onDive: at => dive(at),
    onHold: at => lensName(at), onHoldMove: at => lensName(at), onHoldEnd: at => tapped(at, { exact: true }),
    onView: v => keepView(v),
  })
  sp?.progress(0.75)
  await reload()
  if (ICONSHOT) return S.g.flyTo({ lat: 28, lon: -38, dist: S.g.fit() * (new URLSearchParams(location.search).get('icon') === 'mask' ? 1.12 : 0.9) }, 10)
  await Promise.race([Promise.all([S.g.drawn(), loadLayers()]), sleep(5000)])      // the map layers too, if they come quickly
  sp?.progress(1)
  await land()
  gaz.load()                                           // names for taps, the lens and search, in the background
  makeGuideHere()
  if (!S.places.length) setTimeout(hint, calm ? 0 : 1500)
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {})
}
// The splash hands over: its wire globe fades as the real one draws itself in at the same size, taking the same turn at
// the same speed, and comes gently to rest; the name flies up into the corner and the controls come in.
async function land() {
  const sp = window.__splash, g = S.g, body = document.body
  if (!sp?.alive) { g.reveal(); body.classList.remove('booting'); return }
  sp.handing = true
  const wait = 1500 - (performance.now() - sp.t0)
  if (wait > 0) await sleep(wait)
  const rest = sp.rest, from = sp.lon(performance.now())
  let T = 60, d = (((from - rest.lon - T) % 30) + 30) % 30       // the real meridians land on the wire ones (every 30°)
  if (d > 15) d -= 30
  T += d
  g.reveal(calm ? 1 : 1100)
  sp.follow = () => { const v = g.view(); return { lon: v.lon, lat: v.lat, R: g.radiusAt(v.dist) } }   // the wire rides the real globe as it fades
  g.spinDown({ lat: rest.lat, lon: rest.lon, dist: g.fit(), turns: T / 360, ms: 3000 * T / sp.speed, fromLat: sp.tilt, fromDist: g.distFor(sp.R) })
    .then(() => S.look.spin && g.spin(true))           // if you like it drifting, it drifts on from rest
  const el = $('#splash'), h = el.querySelector('h1'), to = $('.title h1')
  const a = h.getBoundingClientRect(), b = to.getBoundingClientRect()
  h.style.animation = 'none'
  body.classList.replace('booting', 'landing'); body.classList.add('entering')
  el.classList.add('out')
  requestAnimationFrame(() => {
    h.style.transition = `transform ${calm ? 0.01 : 1}s cubic-bezier(.6, 0, .25, 1)`
    h.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`
  })
  await sleep(calm ? 60 : 1050)
  body.classList.remove('landing')
  el.classList.add('gone'); sp.alive = false
  setTimeout(() => el.remove(), 700)
  setTimeout(() => body.classList.remove('entering'), 1400)
}
function keepView(v) {                                  // where you leave the globe is where it comes to rest next time
  if (S.street || window.__splash?.alive) return
  clearTimeout(S.vt)
  S.vt = setTimeout(() => localStorage.setItem('globe-view', JSON.stringify({ lat: Math.max(-60, Math.min(60, Math.round(v.lat * 10) / 10)), lon: Math.round(v.lon * 10) / 10 })), 700)
}
async function reload() {
  ;[S.places, S.entries] = await Promise.all([store.places.all(), store.entries.all()])
  pins()
  const been = new Set(S.entries.filter(e => e.been).map(e => e.placeId))
  $('#tally').textContent = S.places.length
    ? `${S.places.length} ${S.places.length === 1 ? 'place' : 'places'} · ${S.entries.length} ${S.entries.length === 1 ? 'entry' : 'entries'} · been to ${been.size}`
    : 'a visual journal of the world'
}
const beenTo = pid => S.entries.some(e => e.placeId === pid && e.been)
async function loadLayers() {                          // the map layers' data, in the background
  try {
    const [data, img] = await Promise.all([fetch('data/overlay.json').then(r => r.json()),
      new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data/countries.png' })])
    S.g.setOverlay(data, img); S.g.setLayers(S.look.layers)
    S.overlay = data; S.countryImg = img
  } catch { /* offline on the very first visit: the layers arrive next time */ }
}
function pins() {
  const list = S.places.map(p => p.prec === 'area'
    ? { id: p.id, lat: p.lat, lon: p.lon, prec: 'country', label: p.name, glow: true, glowR: p.radius || 3 }
    : { id: p.id, lat: p.lat, lon: p.lon, prec: beenTo(p.id) ? 'address' : 'read', label: p.name })
  if (S.temp) list.push({ id: 'temp', lat: S.temp.lat, lon: S.temp.lon, prec: 'town', label: S.temp.name, always: true, blank: true })
  for (const g of S.glance || []) list.push({ id: g.id, lat: g.lat, lon: g.lon, prec: 'poi', label: g.label })
  S.g.setPins(list)
  const sel = S.open?.place?.id || (S.temp && 'temp')
  if (sel) S.g.select(sel)
}
function paint(t) {
  const r = document.documentElement.style
  for (const [k, v] of Object.entries({ paper: t.paper, ink: t.ink, accent: t.accent, muted: t.muted, water: t.water })) r.setProperty('--' + k, v)
  document.documentElement.classList.toggle('dark', !!t.dark)
  document.querySelector('meta[name=theme-color]').content = t.paper
}

// ---- toasts and the sheet -------------------------------------------------------------------------------------------
function toast(text, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text
  $('#toasts').appendChild(t)
  requestAnimationFrame(() => t.classList.add('on'))
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400) }, ms)
}
function sheet(html, { size = 'half', state } = {}) {
  const el = $('#sheet'), prev = S.open
  if (prev?.cleanup && prev !== state) { const c = prev.cleanup; prev.cleanup = null; c() }   // e.g. photos from an unsaved draft
  $('#sheetBody').innerHTML = html
  $('#sheetBody').scrollTop = 0
  el.dataset.size = size
  document.body.dataset.sheet = size
  if (size === 'peek') document.body.style.setProperty('--peek-h', el.offsetHeight + 'px')   // the globe sits above it
  if (!el.classList.contains('on')) { el.classList.add('on'); document.body.classList.add('sheeted'); history.pushState({ sheet: 1 }, '') }
  S.open = state || {}
}
function closeSheet(fromHistory) {
  const el = $('#sheet')
  if (!el.classList.contains('on')) return
  el.classList.remove('on'); document.body.classList.remove('sheeted'); delete document.body.dataset.sheet
  if (S.open?.cleanup) S.open.cleanup()
  S.open = null; S.temp = null; S.glance = null; pins(); S.g.select(null)
  if (!fromHistory && history.state?.sheet) { S.ownBack = true; history.back() }   // our own step back: don't act on it
}
addEventListener('popstate', () => {
  if (S.ownBack) { S.ownBack = false; const ok = S.afterBack; S.afterBack = null; ok && ok(); return }
  if (!$('#search').hidden) return closeSearch(true)
  if ($('#sheet').classList.contains('on')) return closeSheet(true)
  if (S.street) rise()
})
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  if (!$('#search').hidden) closeSearch()
  else if ($('#sheet').classList.contains('on')) closeSheet()
  else if (S.street) rise()
})
{   // drag the grab handle: up for more, down to close
  let y0 = null, size = null
  const grab = $('#grab')
  grab.addEventListener('pointerdown', e => { y0 = e.clientY; size = $('#sheet').dataset.size; grab.setPointerCapture(e.pointerId) })
  grab.addEventListener('pointerup', e => {
    if (y0 === null) return
    const dy = e.clientY - y0; y0 = null
    const to = s => { $('#sheet').dataset.size = s; document.body.dataset.sheet = s }
    if (Math.abs(dy) < 8) return to(size === 'full' ? 'half' : 'full')
    if (dy < -40) to('full')
    else if (dy > 60) size === 'full' ? to('half') : closeSheet()
  })
}
function hint() {
  if ($('#sheet').classList.contains('on') || S.street) return
  sheet(`<p class="eyebrow">Welcome to Terralogue</p><h2>Begin anywhere</h2>
    <p class="lede">A journal of the world: the places you go, and the places you read about.</p>
    <div class="steps">
      <div>${ICON.tap}<span><b>Tap the globe</b> to make a place there</span></div>
      <div>${ICON.hold}<span><b>Press and hold</b> to put it exactly where you mean</span></div>
      <div>${ICON.photo}<span><b>Add photos</b>: they find their own place when they know where they were taken</span></div>
    </div>
    <p class="muted small">Everything stays on this device. Back it up from the settings now and then.</p>
    <div class="row"><button class="btn primary" data-act="close">Start</button><button class="btn" data-act="import">Restore a backup</button></div>`, { size: 'half' })
}

// ---- making places --------------------------------------------------------------------------------------------------
async function tapped({ lat, lon }, { exact } = {}) {
  if (S.street) return
  if (S.picking) { const job = S.picking; S.picking = null; return job({ lat, lon }) }
  await gaz.load()
  const d = gaz.describe(lat, lon)
  offer({ lat, lon, name: d.name, sub: d.sub, prec: 'exact', kind: exact ? 'exact' : 'spot' }, { fly: false })
}
// A spot that could be a place: a pin that pulses, and a short sheet. Nothing is kept until you say so.
function offer(spot, { fly = true } = {}) {
  S.temp = { lat: spot.lat, lon: spot.lon, name: spot.name }
  pins()
  if (fly) S.g.flyTo({ lat: spot.lat - (spot.prec === 'area' ? 0 : 1), lon: spot.lon, dist: S.g.fit() * (spot.prec === 'area' ? 0.62 : 0.36) }, 1500)
  const eyebrow = { country: 'A country', town: 'A town', coords: 'Coordinates', exact: 'Right here' }[spot.kind] || 'A new place?'
  sheet(`<p class="eyebrow">${eyebrow}</p><h2>${esc(spot.name)}</h2><p class="muted small">${esc(spot.sub)}${spot.sub ? ' · ' : ''}${gaz.coords(spot.lat, spot.lon)}</p>
    <div class="row"><button class="btn primary" data-act="keepSpot">${ICON.pin} Make it a place</button>
      <button class="btn" data-act="read">${ICON.read} Read about it</button>
      ${spot.prec === 'area' ? '' : `<button class="btn" data-act="streets">${ICON.streets} Streets</button>`}</div>`,
  { size: 'peek', state: { spot } })
  S.g.select('temp')
}
async function makePlace({ lat, lon, name, sub, prec = 'exact', radius }) {
  const p = { id: store.id('pl'), lat, lon, name, sub: sub || '', prec, radius }
  await store.places.put(p)
  await store.persist()
  await reload()
  return p
}
async function placeNear(lat, lon, within = 0.3) {      // an existing place this close, or a new one named for the spot
  const hit = S.places.filter(p => p.prec !== 'area').map(p => [gaz.km(p, { lat, lon }), p]).sort((a, b) => a[0] - b[0])[0]
  if (hit && hit[0] <= within) return hit[1]
  await gaz.load()
  const d = gaz.describe(lat, lon)
  return makePlace({ lat, lon, name: d.name, sub: d.sub })
}
function locate() {
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error('This browser can’t tell where you are.'))
    navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => no(new Error(e.code === 1 ? 'Location is switched off for this site.' : 'Couldn’t find where you are just now.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
  })
}

function picked(p, members) {
  if (String(p.id).startsWith('g:')) return S.guide?.focus(p.id)
  const list = (members || [p]).filter(m => m.id !== 'temp' && !String(m.id).startsWith('g:'))
  if (list.length > 1) return chooser(list)
  if (list.length) openPlace(list[0].id)
}
function chooser(members) {
  const list = members.map(m => S.places.find(p => p.id === m.id)).filter(Boolean)
  const lat = list.reduce((t, p) => t + p.lat, 0) / list.length
  const lon = list[0].lon + list.reduce((t, p) => t + (((p.lon - list[0].lon + 540) % 360) - 180), 0) / list.length
  S.g.select(null)
  sheet(`<p class="eyebrow">${list.length} places, close together</p><h2>Which one?</h2>
    <div class="results">${list.map(placeRow).join('')}</div>
    <div class="row"><button class="btn" data-act="zoomIn" data-lat="${lat}" data-lon="${lon}">${ICON.zoom} Zoom in to see them apart</button></div>`,
  { size: 'half', state: {} })
}
function placeRow(p) {
  const n = S.entries.filter(e => e.placeId === p.id).length
  return `<button class="res" data-act="openPlace" data-id="${p.id}"><i class="ico ${p.prec === 'area' ? 'area' : beenTo(p.id) ? 'been' : ''}">${p.prec === 'area' ? ICON.area : ICON.pin}</i>
    <span><b>${esc(p.name)}</b><small>${esc(p.sub || gaz.coords(p.lat, p.lon))}${n ? ` · ${n} ${n === 1 ? 'entry' : 'entries'}` : ''}</small></span></button>`
}
function lensName(at) {
  if (!at) return
  clearTimeout(S.lensT)
  const say = () => { S.lensAt = performance.now(); S.g.setLensLabel(gaz.ready() ? gaz.describe(at.lat, at.lon).name : gaz.coords(at.lat, at.lon)) }
  performance.now() - (S.lensAt || 0) > 90 ? say() : (S.lensT = setTimeout(say, 90))
}

// ---- reading about a place (src/guide.js): what it needs from the app ------------------------------------------------------
function countryAt(lat, lon) {                          // the country raster, one pixel at a time
  if (!S.countryImg || !S.overlay) return null
  const c = S.cpx ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), g = c.getContext('2d', { willReadFrequently: true })
  const W = S.countryImg.naturalWidth, H = S.countryImg.naturalHeight
  g.imageSmoothingEnabled = false; g.clearRect(0, 0, 1, 1)
  g.drawImage(S.countryImg, Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * W), Math.floor((90 - lat) / 180 * H), 1, 1, 0, 0, 1, 1)
  const i = g.getImageData(0, 0, 1, 1).data[0], row = S.overlay.countries[i - 1]
  return i && row ? { name: row[0], cc: row[1], continent: row[2], lat: row[7], lon: row[8] } : null
}
function seaAt(lat, lon) {                              // the sea or ocean around a spot: the nearest named one
  let best = null, bd = Infinity
  for (const [name, cls, , , la, lo] of S.overlay?.marine || []) {
    const d = gaz.km({ lat, lon }, { lat: la, lon: lo }) * (cls === 'ocean' ? 1.6 : 1)
    if (d < bd) { bd = d; best = { name, lat: la, lon: lo } }
  }
  return best
}
const subjectName = s => s.kind === 'landmark' ? s.title || s.name : s.name
function placeFor(s) {                                  // a place you already have for what you're reading about
  const name = subjectName(s).replace(/^Near /, '').toLowerCase(), far = { spot: 0.4, landmark: 1, town: 20, sea: 3000, country: 5000 }[s.kind] ?? 5
  return S.places.find(p => p.name.replace(/^Near /, '').toLowerCase() === name && gaz.km(p, s) <= far) || null
}
async function placeOf(s, { quiet } = {}) {
  const have = placeFor(s); if (have) return have
  const p = await makePlace({ lat: s.lat, lon: s.lon, name: subjectName(s), sub: s.kind === 'country' || s.kind === 'sea' ? '' : s.sub || '',
    prec: s.kind === 'country' || s.kind === 'sea' ? 'area' : s.kind === 'town' ? 'town' : 'exact', radius: s.kind === 'country' ? 4 : s.kind === 'sea' ? 6 : undefined })
  if (!quiet) toast(`${p.name} is a place in your journal now.`)
  return p
}
function makeGuideHere() {
  S.guide = makeGuide({
    esc, gaz, toast,
    sheet: (html, o) => sheet(html, o),
    land: (lat, lon) => S.g.land(lat, lon), countryAt, seaAt,
    placeFor: s => placeFor(s), makePlace: s => placeOf(s), openPlace: id => openPlace(id),
    dive: s => diveTo({ lat: s.lat, lon: s.lon, name: subjectName(s), sub: s.sub || '' }),
    fly: (s, show) => {                                 // show: on a phone, lower the listing so the globe can be seen
      if (show && innerWidth < 900) { $('#sheet').dataset.size = 'half'; document.body.dataset.sheet = 'half' }
      const k = { country: 0.62, sea: 0.7, town: 0.3, landmark: 0.2, spot: 0.2 }[s.kind] ?? 0.3
      S.g.flyTo({ lat: s.lat, lon: s.lon, dist: Math.max(S.g.options().minDist, S.g.fit() * k) }, 1400)
    },
    setGlance: list => { S.glance = list; pins() },
    googleKey: () => localStorage.getItem('terralogue-google-key') || '',
    keep: async (s, { kind, title = '', text = '', links = [], files = [] }) => {
      const place = await placeOf(s, { quiet: true })
      const prepared = []
      for (const f of files) prepared.push(await prepare(f))
      const ids = prepared.length ? await savePhotos(prepared) : []
      await store.entries.put({ id: store.id('en'), placeId: place.id, kind, title, text, links, tags: ['read'], photos: ids, when: today(), been: false })
      await store.persist(); await reload()
      toast(`Kept in your journal, under ${place.name}.`)
    },
  })
}

// ---- a place ----------------------------------------------------------------------------------------------------------
async function openPlace(pid, { fly = true } = {}) {
  const p = S.places.find(x => x.id === pid) || await store.places.get(pid)
  if (!p) return
  S.temp = null
  if (fly) S.g.flyTo({ lat: p.lat - 2, lon: p.lon, dist: Math.min(S.g.view().dist, S.g.fit() * (p.prec === 'area' ? 0.6 : 0.42)) }, 1400)
  const list = (await store.entries.of(pid)).sort(byWhen)
  const been = list.some(e => e.been)
  sheet(`<p class="eyebrow">${p.prec === 'area' ? 'An area' : been ? 'Been there' : list.length ? 'Read about' : 'A place'}</p>
    <h2 class="pname">${esc(p.name)}</h2><p class="muted small">${esc(p.sub)}${p.sub ? ' · ' : ''}${gaz.coords(p.lat, p.lon)}</p>
    <div class="tools">
      <button data-act="read">${ICON.read}<span>Read</span></button>
      <button data-act="newEntry" data-kind="note">${ICON.note}<span>Note</span></button>
      <button data-act="placePhotos">${ICON.photo}<span>Photos</span></button>
      <button data-act="newEntry" data-kind="post">${ICON.post}<span>Post</span></button>
      ${p.prec === 'area' ? '' : `<button data-act="streets">${ICON.streets}<span>Streets</span></button>`}
      <button data-act="placeMenu">${ICON.edit}<span>Edit</span></button>
    </div>
    <div class="entries">${list.length ? (await Promise.all(list.map(entryCard))).join('') : '<p class="muted empty">Nothing here yet. Write what you know about it, or what you saw.</p>'}</div>`,
  { size: list.length ? 'half' : 'peek', state: { place: p } })
  pins()
}
const byWhen = (a, b) => (b.when || '').localeCompare(a.when || '') || (b.created || 0) - (a.created || 0)
const excerpt = (t, n = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
async function entryCard(e, withPlace) {
  const thumbs = await Promise.all((e.photos || []).slice(0, 4).map(id => store.photoURL(id)))
  const place = withPlace ? S.places.find(p => p.id === e.placeId) : null
  return `<button class="card entry ${e.kind}" data-act="viewEntry" data-id="${e.id}">
    ${thumbs.length ? `<span class="thumbs n${thumbs.length}">${thumbs.map(u => `<img src="${u}" alt="" loading="lazy">`).join('')}</span>` : ''}
    <span class="txt">${e.title ? `<b>${esc(e.title)}</b>` : ''}${e.text ? `<span>${esc(excerpt(e.text))}</span>` : ''}
      <small>${place ? esc(place.name) + ' · ' : ''}${fmtDate(e.when)}${e.been ? ' · been there' : ' · read about'}${(e.tags || []).map(t => ` · #${esc(t)}`).join('')}</small></span></button>`
}

// ---- writing an entry -------------------------------------------------------------------------------------------------
function editor(e, { fresh = [] } = {}) {
  const place = S.places.find(p => p.id === e.placeId)
  S.editing = { ...e, photos: [...(e.photos || [])], fresh: [...fresh] }
  sheet(`<p class="eyebrow">${e.created ? 'Edit' : 'New'} · ${esc(place?.name || '')}</p>
    <div class="seg" id="kind">${['note', 'photo', 'post'].map(k => `<button data-act="kind" data-k="${k}" class="${e.kind === k ? 'on' : ''}">${{ note: 'Note', photo: 'Photos', post: 'Post' }[k]}</button>`).join('')}</div>
    <input id="fTitle" class="field title" placeholder="Title" value="${esc(e.title || '')}" ${e.kind === 'post' ? '' : 'hidden'}>
    <textarea id="fText" class="field" rows="${e.kind === 'post' ? 9 : 4}" placeholder="${e.kind === 'photo' ? 'A caption, if you like' : 'What you saw, read, or want to remember…'}">${esc(e.text || '')}</textarea>
    <div class="ephotos" id="ephotos"></div>
    <div class="grid2">
      <label class="lbl">When<input id="fWhen" class="field" type="date" value="${esc(e.when || today())}"></label>
      <label class="sw tight"><span>I was there</span><input id="fBeen" type="checkbox" ${e.been ? 'checked' : ''}><i></i></label>
    </div>
    <input id="fTags" class="field" placeholder="Tags, separated by commas" value="${esc((e.tags || []).join(', '))}">
    <textarea id="fLinks" class="field" rows="2" placeholder="Links: sources, articles, maps (one per line)">${esc((e.links || []).join('\n'))}</textarea>
    <div class="row stick"><button class="btn primary" data-act="saveEntry">Save</button><button class="btn" data-act="cancelEntry">Cancel</button>
      ${e.created ? '<button class="btn ghost danger" data-act="deleteEntry">Delete</button>' : ''}</div>`,
  { size: 'full', state: { place, editing: true, cleanup: () => dropFresh() } })
  drawEditorPhotos()
}
async function drawEditorPhotos() {
  const box = $('#ephotos'); if (!box || !S.editing) return
  const urls = await Promise.all(S.editing.photos.map(id => store.photoURL(id)))
  box.innerHTML = urls.map((u, i) => `<span class="ph"><img src="${u}" alt=""><button data-act="dropPhoto" data-i="${i}" aria-label="Remove">×</button></span>`).join('') +
    `<button class="ph add" data-act="editorAddPhotos">${ICON.photo}<small>Add</small></button>`
}
async function dropFresh() {                               // photos added in an editor that was never saved
  const ed = S.editing; S.editing = null
  if (ed && !ed.saved) for (const id of ed.fresh) await store.photos.remove(id)
}
async function savePhotos(prepared) {
  const ids = []
  for (const p of prepared) { const id = store.id('ph'); await store.photos.put({ id, ...p }); ids.push(id) }
  return ids
}

// ---- photos: they find their own place when they can ----------------------------------------------------------------
async function photosPicked(files, { place, intoEditor } = {}) {
  if (!files.length) return
  toast(files.length === 1 ? 'Reading the photo…' : `Reading ${files.length} photos…`, 1600)
  const prepared = []
  for (const f of files) { try { prepared.push(await prepare(f)) } catch (err) { toast(err.message, 4000) } }
  if (!prepared.length) return
  const ids = await savePhotos(prepared)
  if (intoEditor && S.editing) { S.editing.photos.push(...ids); S.editing.fresh.push(...ids); return drawEditorPhotos() }
  const taken = prepared.map(p => p.taken).filter(Boolean).sort()[0]
  const start = async target => {
    S.g.flyTo({ lat: target.lat - 1, lon: target.lon, dist: S.g.fit() * 0.42 }, 1400)
    editor({ id: store.id('en'), placeId: target.id, kind: 'photo', photos: ids, when: taken || today(), been: true }, { fresh: ids })
  }
  if (place) return start(place)
  const gps = prepared.find(p => p.lat != null)
  if (gps) return start(await placeNear(gps.lat, gps.lon))
  S.pending = ids
  sheet(`<p class="eyebrow">${ids.length === 1 ? 'A photo' : ids.length + ' photos'}</p><h2>Where was ${ids.length === 1 ? 'it' : 'this'} taken?</h2>
    <p class="muted">The ${ids.length === 1 ? 'photo doesn’t' : 'photos don’t'} say. (Phones often leave the location out when you pick photos in a browser.)</p>
    <div class="row"><button class="btn primary" data-act="pendingHere">${ICON.here} Here, where I am</button><button class="btn" data-act="pendingFind">${ICON.search} Look it up</button>
      <button class="btn" data-act="pendingPick">${ICON.tap} Tap it on the globe</button></div>`,
  { size: 'peek', state: { cleanup: async () => { if (S.pending) { for (const id of S.pending) await store.photos.remove(id); S.pending = null } } } })
  S.whenPlaced = start
}
async function pendingTo(place) {
  const ids = S.pending, start = S.whenPlaced; S.pending = null
  if (ids && start) { S.open = null; await start(place) }
}

// ---- reading an entry ---------------------------------------------------------------------------------------------------
function md(text) {                                       // a little markdown: paragraphs, **bold**, *italic*, links
  return esc(text).split(/\n{2,}/).map(par => '<p>' + par
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\n/g, '<br>') + '</p>').join('')
}
async function viewEntry(eid) {
  const e = await store.entries.get(eid); if (!e) return
  const place = S.places.find(p => p.id === e.placeId)
  const urls = await Promise.all((e.photos || []).map(id => store.photoURL(id)))
  sheet(`<p class="eyebrow"><button class="link" data-act="openPlace" data-id="${e.placeId}">${esc(place?.name || '')}</button> · ${fmtDate(e.when)} · ${e.been ? 'been there' : 'read about'}</p>
    ${e.title ? `<h2>${esc(e.title)}</h2>` : ''}
    ${urls.length ? `<div class="gallery n${Math.min(urls.length, 3)}">${urls.map((u, i) => `<button data-act="lightbox" data-id="${e.id}" data-i="${i}"><img src="${u}" alt=""></button>`).join('')}</div>` : ''}
    <div class="prose">${md(e.text || '')}</div>
    ${(e.tags || []).length ? `<p class="tags">${e.tags.map(t => `<span>#${esc(t)}</span>`).join(' ')}</p>` : ''}
    ${(e.links || []).length ? `<ul class="links">${e.links.map(l => `<li><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, ''))}</a></li>`).join('')}</ul>` : ''}
    <div class="row"><button class="btn" data-act="editEntry" data-id="${e.id}">Edit</button><button class="btn ghost" data-act="openPlace" data-id="${e.placeId}">Back to ${esc(place?.name || 'the place')}</button></div>`,
  { size: 'full', state: { place, entry: e } })
  if (place) { S.g.flyTo({ lat: place.lat - 2, lon: place.lon, dist: Math.min(S.g.view().dist, S.g.fit() * 0.5) }, 1400); S.g.select(place.id) }
}
async function lightbox(eid, i) {
  const e = await store.entries.get(eid)
  const urls = await Promise.all(e.photos.map(id => store.photoURL(id, 'full')))
  const box = document.createElement('div'); box.className = 'lightbox'
  let at = i
  const draw = () => { box.innerHTML = `<img src="${urls[at]}" alt=""><span class="count">${at + 1} / ${urls.length}</span><button class="x" aria-label="Close">×</button>` }
  draw(); document.body.appendChild(box)
  requestAnimationFrame(() => box.classList.add('on'))
  let x0 = null
  box.addEventListener('pointerdown', ev => { x0 = ev.clientX })
  box.addEventListener('pointerup', ev => {
    const dx = x0 === null ? 0 : ev.clientX - x0; x0 = null
    if (Math.abs(dx) > 40 && urls.length > 1) { at = (at + (dx < 0 ? 1 : -1) + urls.length) % urls.length; draw(); return }
    if (ev.target.closest('.x') || !ev.target.closest('img')) { box.classList.remove('on'); setTimeout(() => box.remove(), 300) }
  })
}

// ---- the journal --------------------------------------------------------------------------------------------------------
const JFILTERS = [['all', 'All'], ['been', 'Been there'], ['read', 'Read about'], ['photo', 'Photos'], ['post', 'Posts'], ['note', 'Notes']]
function journal() {
  S.jfilter ||= 'all'
  sheet(`<div class="jhead"><h2>Journal</h2>
      <label class="sfield">${ICON.search}<input id="jq" type="search" placeholder="Search entries, places and #tags" value="${esc(S.jq || '')}" autocomplete="off" enterkeyhint="search"></label>
      <div class="chips">${JFILTERS.map(([k, l]) => `<button data-act="jfilter" data-f="${k}" class="${k === S.jfilter ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="entries" id="jlist"></div>`, { size: 'full', state: { journal: true } })
  $('#jq').oninput = () => { clearTimeout(S.jt); S.jt = setTimeout(journalList, 180) }
  $('#jq').onkeydown = e => { if (e.key === 'Enter') e.target.blur() }
  journalList()
}
async function journalList() {
  const box = $('#jlist'); if (!box) return
  const filter = S.jfilter, q = S.jq = $('#jq')?.value || '', words = fold(q).split(/\s+/).filter(Boolean), tok = S.jtok = (S.jtok || 0) + 1
  const match = e => {
    const place = S.places.find(p => p.id === e.placeId)
    const ok = filter === 'all' || (filter === 'been' && e.been) || (filter === 'read' && !e.been) || e.kind === filter
    const hay = fold([e.title, e.text, (e.tags || []).map(t => '#' + t).join(' '), place?.name, place?.sub].join(' '))
    return ok && words.every(w => hay.includes(w))
  }
  const list = S.entries.filter(match).sort(byWhen)
  let month = '', parts = []
  for (const e of list) {
    const m = e.when ? new Date(e.when + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Undated'
    if (m !== month) { parts.push(`<h3 class="month">${m}</h3>`); month = m }
    parts.push(await entryCard(e, true))
  }
  if (tok !== S.jtok || !$('#jlist')) return               // typed again while this one was drawing
  $('#jlist').innerHTML = parts.join('') || `<p class="muted empty">${S.entries.length ? 'Nothing matches.' : 'No entries yet. Make a place, then write or add photos.'}</p>`
}

// ---- find: a search bar at the top, its results above the keyboard ---------------------------------------------------------
// Your places first, then towns and countries from the offline gazetteer; coordinates too ("48.85, 2.35", "33.9° S 18.4° E");
// then, online, anywhere else: villages of any size, streets, landmarks (src/geocode.js), as "More places".
// mode 'find' offers what you pick (or opens your place); mode 'photo' puts waiting photos there.
const SR = { mode: 'find', hits: [], at: 0 }
function openSearch(mode = 'find') {
  SR.mode = mode
  const box = $('#search'), q = $('#fq')
  q.value = ''; $('#sclear').hidden = true
  q.placeholder = mode === 'photo' ? 'Where was it taken?' : 'A place, or coordinates'
  box.hidden = false
  q.focus()                                              // in the same tap, or a phone won't raise its keyboard
  requestAnimationFrame(() => box.classList.add('on'))
  document.body.classList.add('searching')
  if (!history.state?.search) history.pushState({ search: 1 }, '')
  results()
  if (!gaz.ready()) gaz.load().then(() => !box.hidden && results())
}
function closeSearch(fromHistory) {
  const box = $('#search')
  if (box.hidden) return Promise.resolve()
  $('#fq').blur(); box.classList.remove('on'); document.body.classList.remove('searching')
  setTimeout(() => { if (!box.classList.contains('on')) box.hidden = true; scrollTo(0, 0) }, 260)
  if (fromHistory || !history.state?.search) return Promise.resolve()
  return new Promise(ok => { S.ownBack = true; S.afterBack = ok; history.back(); setTimeout(ok, 400) })   // our own step back
}
function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i)
  if (!m) return null
  let lat = +m[1], lon = +m[3]
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat)
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon)
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}
const lastWhen = pid => S.entries.filter(e => e.placeId === pid).map(e => e.when || '').sort().pop() || ''
function mark(text, q) {                                  // the part you typed, in bold
  const i = q ? String(text).toLowerCase().indexOf(q.toLowerCase()) : -1
  return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length))
}
function results() {
  const q = $('#fq').value.trim(), k = fold(q), co = parseCoords(q)
  $('#sclear').hidden = !q
  const mine = (k ? S.places.filter(p => fold(p.name + ' ' + p.sub).includes(k))
    .sort((a, b) => fold(b.name).startsWith(k) - fold(a.name).startsWith(k))
    : [...S.places].sort((a, b) => lastWhen(b.id).localeCompare(lastWhen(a.id)))).slice(0, k ? 6 : 8)
  const world = k && !co ? gaz.search(q, 14).filter(h => !S.places.some(p => p.name === h.name && gaz.km(p, h) < 15)).slice(0, 12) : []
  const known = [...S.places, ...world]
  const more = SR.online?.q === q ? SR.online.list.filter(h => !known.some(w => fold(w.name) === fold(h.name) && gaz.km(w, h) < 15)) : []
  SR.hits = [...(co ? [{ kind: 'coords', ...co }] : []), ...mine.map(p => ({ kind: 'mine', place: p })), ...world, ...more]
  SR.at = 0
  let i = 0, html = ''
  const row = (icon, cls, name, sub) => `<button class="res${i === 0 ? ' on' : ''}" data-i="${i}" data-kind="${SR.hits[i++].kind}"><i class="ico ${cls}">${icon}</i><span><b>${name}</b><small>${sub}</small></span></button>`
  if (co) {
    const d = gaz.ready() ? gaz.describe(co.lat, co.lon) : null
    html += `<p class="eyebrow">Go to</p>` + row(ICON.target, '', gaz.coords(co.lat, co.lon), esc(d ? [d.name, d.sub].filter(Boolean).join(', ') : 'Coordinates'))
  }
  if (mine.length) html += `<p class="eyebrow">${k ? 'Your places' : 'Your places, latest first'}</p>` +
    mine.map(p => row(p.prec === 'area' ? ICON.area : ICON.pin, beenTo(p.id) ? 'been' : 'mine', mark(p.name, q), esc(p.sub || gaz.coords(p.lat, p.lon)))).join('')
  if (world.length) html += `<p class="eyebrow">The world</p>` +
    world.map(h => row(h.kind === 'country' ? ICON.area : ICON.town, '', mark(h.name, q), esc(h.kind === 'country' ? 'A country' : h.sub))).join('')
  if (more.length) html += `<p class="eyebrow">More places</p>` +
    more.map(h => row(h.place ? ICON.town : ICON.pin, '', mark(h.name, q), esc([h.label, h.sub].filter(Boolean).join(' · ')))).join('')
  else if (SR.looking === q) html += `<p class="looking"><i></i>Looking further afield…</p>`
  if (!html) html = q ? `<p class="none">${gaz.ready() ? `Nothing called “${esc(q)}”.` : 'Looking…'}<br><span>${navigator.onLine
      ? 'Try another spelling, or press and hold on the globe to put a place exactly where you mean.'
      : 'Offline, only towns of 15,000 people or more and the countries are here. Press and hold on the globe for anywhere else.'}</span></p>`
    : `<p class="none">Find any town or village, a street, a landmark, or type coordinates.<br><span>Or press and hold on the globe to put a place exactly where you mean.</span></p>`
  $('#results').innerHTML = html
}
// After the offline answers, ask further afield (debounced; only the latest question's answer is shown).
function further() {
  clearTimeout(SR.timer)
  const q = $('#fq').value.trim()
  if (q.length < 2 || parseCoords(q) || SR.online?.q === q) return
  SR.timer = setTimeout(() => {
    SR.looking = q; results()
    searchOnline(q)
      .then(list => { SR.online = { q, list } })
      .catch(() => {})
      .finally(() => { if (SR.looking === q) SR.looking = null; if ($('#fq').value.trim() === q && !$('#search').hidden) results() })
  }, 320)
}
function highlight(n) {
  const rows = [...$('#results').querySelectorAll('.res')]; if (!rows.length) return
  SR.at = (n + rows.length) % rows.length
  rows.forEach((r, j) => r.classList.toggle('on', j === SR.at)); rows[SR.at].scrollIntoView({ block: 'nearest' })
}
async function choose(i) {
  const h = SR.hits[i]; if (!h) return
  const mode = SR.mode
  await closeSearch()
  if (S.street) await rise()
  const spot = h.kind === 'country' ? { lat: h.lat, lon: h.lon, name: h.name, sub: '', prec: 'area', radius: h.radius, kind: 'country' }
    : h.kind === 'coords' ? { lat: h.lat, lon: h.lon, ...(await gaz.load(), gaz.describe(h.lat, h.lon)), prec: 'exact', kind: 'coords' }
    : h.kind === 'town' ? { lat: h.lat, lon: h.lon, name: h.name, sub: h.sub, prec: 'town', kind: 'town' }
    : h.kind === 'online' ? { lat: h.lat, lon: h.lon, name: h.name, sub: h.sub, prec: h.prec, kind: h.prec === 'town' ? 'town' : 'exact' } : null
  if (mode === 'photo') {
    if (!S.pending) return
    return pendingTo(h.kind === 'mine' ? h.place : await makePlace(spot))
  }
  if (h.kind === 'mine') return openPlace(h.place.id)
  offer(spot)
}
{
  const q = $('#fq')
  q.addEventListener('input', () => { results(); further() })
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); highlight(SR.at + (e.key === 'ArrowDown' ? 1 : -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(SR.at) }
  })
  $('#results').addEventListener('click', e => { const b = e.target.closest('.res'); if (b) choose(+b.dataset.i) })
  $('#results').addEventListener('touchstart', () => q.blur(), { passive: true })     // scrolling the results puts the keyboard away
  $('#sclear').onclick = () => { q.value = ''; results(); q.focus() }
  $('#scancel').onclick = () => closeSearch()
  if (window.visualViewport) {                           // the overlay fits the space above the keyboard
    const vv = visualViewport, fit = () => {
      document.documentElement.style.setProperty('--vvh', vv.height + 'px'); document.documentElement.style.setProperty('--vvt', vv.offsetTop + 'px')
    }
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit()
  }
}

// ---- down to the streets, and back up -----------------------------------------------------------------------------------
// Zoom in past the globe's closest view (or tap Streets on a place) and the globe pushes in and fades while the street
// map opens as a circle from the same spot; zoom the street map out far enough and it closes into the middle as the
// globe comes back. One continuous zoom.
const streetTheme = () => ({ ...INKS[S.look.ink], dark: !!INKS[S.look.ink].dark })
const nearbyPlaces = (lat, lon, skip) => S.places.filter(p => p.prec !== 'area' && p.id !== skip && gaz.km(p, { lat, lon }) < 6)
  .map(p => ({ id: p.id, lat: p.lat, lon: p.lon, name: p.name, been: beenTo(p.id) }))
async function dive(at, { title, subtitle, placeId } = {}) {
  if (S.street || S.diving) return
  S.diving = true; S.streetSkip = placeId        // the place you dived to has its own callout, not a pin
  if ($('#sheet').classList.contains('on')) closeSheet(true)   // not via history: its back-step would land after we've dived
  const g = S.g, el = $('#globe'), stage = $('#stage')
  const where = g.where(at.lat, at.lon), r = el.getBoundingClientRect()
  el.classList.add('diving')
  if (!calm) g.flyTo({ lat: at.lat, lon: at.lon, dist: g.options().minDist * 0.86 }, 800)
  S.street = openStreetView(stage, {
    lat: at.lat, lon: at.lon, at: { x: where.x + r.left, y: where.y + r.top }, theme: streetTheme(), style: { hatch: S.look.hatch },
    title, subtitle, places: nearbyPlaces(at.lat, at.lon, placeId), top: parseFloat(getComputedStyle(document.body).getPropertyValue('--st')) || 10,
    startScale: calm ? 1 : 0.3,
    onPlace: pid => openPlace(pid, { fly: false }),
    onTap: spot => streetTapped(spot),
    onExit: () => rise(),
    onError: () => toast('Couldn’t reach the street maps. Are you offline?', 3500),
  })
  document.body.classList.add('streeting')
  history.pushState({ street: 1 }, '')
  setTimeout(() => { if (S.street) g.pause(); S.diving = false }, calm ? 50 : 1000)
}
async function rise() {
  if (!S.street) return
  const s = S.street, c = s.centre(), g = S.g
  S.street = null
  g.resume(); g.jump({ lat: c.lat, lon: c.lon, dist: g.options().minDist * 0.9 })
  $('#globe').classList.remove('diving')
  document.body.classList.remove('streeting')
  g.flyTo({ dist: g.fit() * 0.32 }, calm ? 10 : 1500)
  await s.close()
}
async function diveTo(p) {
  closeSheet()
  await S.g.flyTo({ lat: p.lat, lon: p.lon, dist: S.g.options().minDist }, 1600)
  const n = S.entries.filter(e => e.placeId === p.id).length
  dive({ lat: p.lat, lon: p.lon }, { title: p.name, subtitle: n ? `${n} ${n === 1 ? 'entry' : 'entries'} here` : p.sub, placeId: p.id })
}
async function streetTapped({ lat, lon, address }) {
  await gaz.load()
  const d = gaz.describe(lat, lon)
  const name = address || d.name
  sheet(`<p class="eyebrow">A new place?</p><h2>${esc(name)}</h2><p class="muted">${esc(address ? [d.name.replace(/^Near /, ''), d.sub].filter(Boolean).join(', ') : d.sub)} · ${gaz.coords(lat, lon)}</p>
    <div class="row"><button class="btn primary" data-act="keepSpot">Make it a place</button><button class="btn" data-act="close">Not now</button></div>`,
  { size: 'peek', state: { spot: { lat, lon, name, sub: address ? [d.name.replace(/^Near /, ''), d.sub].filter(Boolean).join(', ') : d.sub, prec: 'exact' } } })
}

// ---- settings and backup ----------------------------------------------------------------------------------------------
async function settings() {
  const u = await store.usage()
  const mb = n => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1)
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false
  const photos = S.entries.reduce((n, e) => n + (e.photos || []).length, 0)
  sheet(`<h2>Settings</h2>
    <section class="group"><h3>Your journal</h3>
      <div class="stats"><span><b>${S.places.length}</b>${S.places.length === 1 ? 'place' : 'places'}</span><span><b>${S.entries.length}</b>${S.entries.length === 1 ? 'entry' : 'entries'}</span><span><b>${photos}</b>${photos === 1 ? 'photo' : 'photos'}</span>${u ? `<span><b>${mb(u.usage || 0)}</b>MB</span>` : ''}</div>
      <p class="small">Everything stays on this device. ${persisted ? 'The browser has agreed to keep it.' : 'Back it up now and then: a browser can clear a site’s data.'}</p>
      <div class="row"><button class="btn" data-act="export">${ICON.down} Export a backup</button><button class="btn" data-act="import">${ICON.up} Import a backup</button></div></section>
    <section class="group"><h3>Street View in listings</h3>
      <p class="small">Listings show open street photos (Panoramax) and a button that opens Google Street View. To see Google’s Street View inside a
        listing, paste a Google Maps key here (Maps Embed API; Google asks for a billing account but doesn’t charge for it). It stays on this device and isn’t in backups.</p>
      <input id="gkey" class="field" placeholder="Google Maps key (optional)" value="${esc(localStorage.getItem('terralogue-google-key') || '')}" autocomplete="off" spellcheck="false">
      <div class="row"><button class="btn small" data-act="saveKey">Save</button></div></section>
    <section class="group"><h3>About</h3>
      <p class="small muted">A hand-drawn globe for keeping notes, photos and posts about anywhere. Relief: ETOPO1 and GMTED2010 (AWS Terrain Tiles).
      Coasts, countries and map labels: Natural Earth. Towns: GeoNames (CC BY 4.0). Streets: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Search beyond the towns on board: Open-Meteo (GeoNames) and Photon (OpenStreetMap). Listings: Wikipedia, Wikivoyage, Wikidata and Wikimedia Commons (CC BY-SA, CC0, as credited),
      Open-Meteo (CC BY 4.0), Panoramax. Built with three.js.</p></section>`,
  { size: 'full', state: { settings: true } })
}

// ---- the map: ink, style and layers, every part adjustable --------------------------------------------------------------
const seg = (key, opts, cur, act = 'lseg') => `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-k="${key}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`
const fill = (v, min, max) => `--p:${((v - min) / (max - min) * 100).toFixed(1)}%`
const range = (id, label, min, max, step, val, show) => `<label class="lbl rng">${label} <output id="${id}v">${show(val)}</output><input data-range="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" style="${fill(val, min, max)}"></label>`
const sw = (attr, key, label, on) => `<label class="sw"><span>${label}</span><input type="checkbox" ${attr}="${key}" ${on ? 'checked' : ''}><i></i></label>`
const RANGES = {
  ex: { get: () => S.look.exaggeration, set: v => { S.look.exaggeration = v; S.g.set({ exaggeration: v }) }, show: v => '×' + Math.round(v / 0.0014) },
  lv: { get: () => S.look.levels, set: v => { S.look.levels = v; S.g.set({ levels: v }) }, show: v => v },
  wb: { get: () => S.look.wobble, set: v => { S.look.wobble = v; S.g.set({ wobble: v }) }, show: v => Math.round(v * 100) + '%' },
  gr: { get: () => S.look.grain, set: v => { S.look.grain = v; S.g.set({ grain: v }) }, show: v => Math.round(v * 100) + '%' },
  fs: { get: () => S.look.layers.fill, set: v => layer({ fill: v }), show: v => Math.round(v * 100) + '%' },
  bw: { get: () => S.look.layers.borderWidth, set: v => layer({ borderWidth: v }), show: v => v.toFixed(1) + ' px' },
  ba: { get: () => S.look.layers.borderAlpha, set: v => layer({ borderAlpha: v }), show: v => Math.round(v * 100) + '%' },
  ls: { get: () => S.look.layers.labelSize, set: v => layer({ labelSize: v }), show: v => Math.round(v * 100) + '%' },
  dn: { get: () => S.look.layers.density, set: v => layer({ density: v }), show: v => (v > 0 ? '+' : '') + v },
}
function layer(o) { Object.assign(S.look.layers, o); S.g.setLayers(o); saveLook() }
function mapSheet() {
  const L = S.look.layers
  const r = (id, label, min, max, step) => range(id, label, min, max, step, RANGES[id].get(), RANGES[id].show)
  sheet(`<h2>The map</h2>
    <section class="group"><h3>Ink</h3><div class="inks">${Object.entries(INKS).map(([k, t]) => `<button data-act="ink" data-ink="${k}" class="${k === S.look.ink ? 'on' : ''}" style="--p:${t.paper};--i:${t.ink};--a:${t.accent}"><i></i>${t.name}</button>`).join('')}</div></section>
    <section class="group"><h3>Style</h3>${seg('style', Object.entries(STYLES).map(([k, v]) => [k, v.name]), S.look.style, 'style')}
      ${r('wb', 'Wobble', 0, 1.5, 0.05)}${r('gr', 'Paper grain', 0, 1.5, 0.05)}
      <div class="sws">${LOOK.map(([k, l]) => sw('data-look', k, l, S.look[k])).join('')}</div></section>
    <section class="group"><h3>Relief</h3>${r('ex', 'Height', 0, 0.14, 0.002)}${r('lv', 'Terraces', 2, 16, 1)}</section>
    <section class="group"><h3>Countries</h3>${seg('countries', [['off', 'Off'], ['borders', 'Borders'], ['fill', 'Coloured']], L.countries)}
      <div class="chips pal" ${L.countries === 'fill' ? '' : 'hidden'}>${[['political', 'Political'], ['continents', 'By continent'], ['tint', 'One tint'], ['pastel', 'Pastel']].map(([k, l]) => `<button data-act="lseg" data-k="palette" data-v="${k}" class="${L.palette === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div ${L.countries === 'fill' ? '' : 'hidden'} class="palopt">${r('fs', 'Colour strength', 0.1, 1, 0.05)}</div>
      <div ${L.countries === 'off' ? 'hidden' : ''} class="bopt">${r('bw', 'Border width', 0.4, 4, 0.1)}${r('ba', 'Border ink', 0.1, 1, 0.05)}
        <div class="sws">${sw('data-layer', 'borderDash', 'Dashed borders', L.borderDash)}</div></div></section>
    <section class="group"><h3>Labels</h3>
      <div class="sws">${sw('data-layer', 'continentLabels', 'Continents', L.continentLabels)}${sw('data-layer', 'countryLabels', 'Countries', L.countryLabels)}
        ${sw('data-layer', 'regionLabels', 'Ranges, deserts…', L.regionLabels)}${sw('data-layer', 'rivers', 'Rivers', L.rivers)}</div>
      <span class="lbl">Seas</span>${seg('seaLabels', [['off', 'Off'], ['oceans', 'Oceans'], ['seas', 'Oceans & seas']], L.seaLabels)}
      ${r('ls', 'Label size', 0.7, 1.6, 0.05)}${r('dn', 'How many labels', -1, 2, 0.5)}</section>
    <div class="row"><button class="btn ghost" data-act="resetMap">Reset the map</button></div>`,
  { size: 'full', state: { map: true } })
  const body = $('#sheetBody')
  body.oninput = e => {
    const id = e.target.dataset.range; if (!id) return
    const v = +e.target.value; RANGES[id].set(v); $('#' + id + 'v').textContent = RANGES[id].show(v); saveLook()
    e.target.style.cssText = fill(v, +e.target.min, +e.target.max)
  }
  body.onchange = e => {
    const k = e.target.dataset.look, l = e.target.dataset.layer
    if (k) { S.look[k] = e.target.checked; S.g.set({ [k]: e.target.checked }); if (k === 'hatch') S.street?.setStyle({ hatch: e.target.checked }); saveLook() }
    if (l) layer({ [l]: e.target.checked })
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------------
const ICON = {
  note: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  post: '<svg viewBox="0 0 24 24"><path d="M5 5h14M5 10h14M5 15h9M5 20h6"/></svg>',
  streets: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 16h18M8 3v18M16 3v18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  read: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21c-.7-4.2-7-8-7-13a7 7 0 0 1 14 0c0 5-6.3 8.8-7 13z"/><circle cx="12" cy="8.5" r="2.4"/></svg>',
  area: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 3"/><circle cx="12" cy="12" r="2.2"/></svg>',
  town: '<svg viewBox="0 0 24 24"><path d="M4 20V10l5-3v13M9 20V5l7-2v17M16 20v-9l4 2v7M3 20h18"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  here: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
  tap: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="2.5"/><path d="M12 3.5v-1M17.5 9h1M6.5 9h-1M15.9 5.1l.7-.7M8.1 5.1l-.7-.7"/><path d="M10 21l-1.5-5.5a1.4 1.4 0 0 1 2.6-1l.9 1.8V11a1.3 1.3 0 0 1 2.6 0v3l2.3.6a2 2 0 0 1 1.5 2.3L17.6 21"/></svg>',
  hold: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"/><path d="M14.7 14.7 20 20M10 7v6M7 10h6"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 15.5V4.5M7 9l5-5 5 5M5 20h14"/></svg>',
}
const ACT = {
  close: () => closeSheet(),
  keepSpot: async () => {
    const s = S.open.spot; S.temp = null
    const p = await makePlace({ lat: s.lat, lon: s.lon, name: s.name, sub: s.sub, prec: s.prec, radius: s.radius })
    if (S.street) S.street.setPlaces(nearbyPlaces(s.lat, s.lon, S.streetSkip))
    openPlace(p.id, { fly: !S.street })
  },
  openPlace: el => openPlace(el.dataset.id),
  newEntry: el => { const p = S.open.place; editor({ id: store.id('en'), placeId: p.id, kind: el.dataset.kind, photos: [], when: today(), been: beenTo(p.id) }) },
  placePhotos: () => { S.pickFor = { place: S.open.place }; $('#pickPhotos').click() },
  editorAddPhotos: () => { S.pickFor = { intoEditor: true }; $('#pickPhotos').click() },
  dropPhoto: el => { const id = S.editing.photos.splice(+el.dataset.i, 1)[0]; if (S.editing.fresh.includes(id)) store.photos.remove(id); drawEditorPhotos() },
  kind: el => {
    for (const b of el.parentElement.children) b.classList.toggle('on', b === el)
    S.editing.kind = el.dataset.k; $('#fTitle').hidden = el.dataset.k !== 'post'; $('#fText').rows = el.dataset.k === 'post' ? 9 : 4
  },
  saveEntry: async () => {
    const ed = S.editing
    const e = { ...ed, title: $('#fTitle').value.trim(), text: $('#fText').value.trim(), when: $('#fWhen').value || today(), been: $('#fBeen').checked,
                tags: $('#fTags').value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean),
                links: $('#fLinks').value.split('\n').map(t => t.trim()).filter(Boolean) }
    if (!e.text && !e.title && !e.photos.length) return toast('Write something, or add a photo.')
    if (e.kind === 'post' && !e.title) e.title = excerpt(e.text, 60)
    delete e.fresh; delete e.saved
    ed.saved = true
    await store.entries.put(e); await store.persist(); await reload()
    toast(e.been ? 'Saved. Been there.' : 'Saved.')
    openPlace(e.placeId, { fly: false })
  },
  cancelEntry: () => { const pid = S.editing?.placeId; dropFresh(); pid ? openPlace(pid, { fly: false }) : closeSheet() },
  deleteEntry: async () => {
    if (!confirm('Delete this entry and its photos?')) return
    const e = await store.entries.get(S.editing.id); S.editing.saved = true
    if (e) await store.entries.remove(e)
    await reload(); toast('Deleted.'); openPlace(S.editing?.placeId || e.placeId, { fly: false })
  },
  viewEntry: el => viewEntry(el.dataset.id),
  editEntry: async el => editor(await store.entries.get(el.dataset.id)),
  lightbox: el => lightbox(el.dataset.id, +el.dataset.i),
  streets: () => diveTo(S.open.place || S.open.spot),
  read: () => {
    const p = S.open.place, sp = S.open.spot
    S.temp = null
    S.guide.open(p ? { lat: p.lat, lon: p.lon, name: p.name, sub: p.sub, prec: p.prec === 'area' || p.prec === 'town' ? p.prec : 'exact' } : { ...sp })
  },
  saveKey: () => {
    const k = $('#gkey').value.trim()
    k ? localStorage.setItem('terralogue-google-key', k) : localStorage.removeItem('terralogue-google-key')
    toast(k ? 'Saved on this device. Street View shows inside listings now.' : 'Removed.')
  },
  zoomIn: el => {
    closeSheet()
    const v = S.g.view()
    S.g.flyTo({ lat: +el.dataset.lat, lon: +el.dataset.lon, dist: Math.max(S.g.options().minDist, 1 + (v.dist - 1) / 3.5) }, 1300)
  },
  lseg: el => {
    for (const b of el.parentElement.children) b.classList.toggle('on', b === el)
    layer({ [el.dataset.k]: el.dataset.v })
    if (el.dataset.k === 'countries') { const L = S.look.layers; $('.pal').hidden = $('.palopt').hidden = L.countries !== 'fill'; $('.bopt').hidden = L.countries === 'off' }
  },
  style: el => {
    for (const b of el.parentElement.children) b.classList.toggle('on', b === el)
    const st = STYLES[el.dataset.v]; Object.assign(S.look, st.set, { style: el.dataset.v }); S.g.set(st.set); S.street?.setStyle({ hatch: S.look.hatch }); saveLook()
    mapSheet()
  },
  resetMap: () => {
    Object.assign(S.look, STYLES.sketch.set, { style: 'sketch', exaggeration: 0.062, levels: 8, graticule: true, spin: false, layers: { ...LAYERS, countries: 'borders' } })
    S.g.set(S.look); S.g.setLayers(S.look.layers); saveLook(); mapSheet()
  },
  placeMenu: () => {
    const p = S.open.place
    sheet(`<p class="eyebrow">${esc(p.name)}</p><h2>This place</h2>
      <label class="lbl">Name<input id="pName" class="field" value="${esc(p.name)}"></label>
      <label class="lbl">Where (region, country)<input id="pSub" class="field" value="${esc(p.sub)}"></label>
      <div class="row"><button class="btn primary" data-act="renamePlace">Save</button><button class="btn" data-act="openPlace" data-id="${p.id}">Cancel</button>
        <button class="btn ghost danger" data-act="deletePlace">Delete the place</button></div>`, { size: 'half', state: { place: p } })
  },
  renamePlace: async () => { const p = { ...S.open.place, name: $('#pName').value.trim() || S.open.place.name, sub: $('#pSub').value.trim() }; await store.places.put(p); await reload(); openPlace(p.id, { fly: false }) },
  deletePlace: async () => {
    const p = S.open.place, n = S.entries.filter(e => e.placeId === p.id).length
    if (!confirm(n ? `Delete ${p.name} and its ${n} ${n === 1 ? 'entry' : 'entries'}? This can’t be undone.` : `Delete ${p.name}?`)) return
    await store.places.remove(p.id); await reload(); closeSheet(); toast('Deleted.')
  },
  jfilter: el => {
    S.jfilter = el.dataset.f
    for (const b of el.parentElement.children) b.classList.toggle('on', b === el)
    journalList()
  },
  pendingHere: async () => { try { toast('Finding you…', 1500); const at = await locate(); pendingTo(await placeNear(at.lat, at.lon)) } catch (err) { toast(err.message, 4000) } },
  pendingPick: () => { $('#sheet').classList.remove('on'); document.body.classList.remove('sheeted'); toast('Tap where it was taken.', 4000); S.picking = async at => pendingTo(await placeNear(at.lat, at.lon, 0.5)) },
  pendingFind: () => openSearch('photo'),
  ink: el => {
    S.look.ink = el.dataset.ink; saveLook()
    const t = INKS[S.look.ink], run = () => { S.g.setTheme(t); paint(t); S.street?.setTheme(streetTheme()); for (const b of el.parentElement.children) b.classList.toggle('on', b === el) }
    document.startViewTransition && !calm ? document.startViewTransition(run) : run()
  },
  export: async () => {
    toast('Packing up your journal…', 2000)
    const blob = await store.exportAll(), a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `terralogue-${today()}.json${blob.type === 'application/gzip' ? '.gz' : ''}`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  },
  import: () => $('#pickBackup').click(),
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return
  const fn = ACT[a.dataset.act]; if (fn) { e.preventDefault(); fn(a, e) }
})
$('#dock').addEventListener('click', async e => {
  const b = e.target.closest('[data-do]'); if (!b) return
  const what = b.dataset.do
  if (S.street && what === 'here') await rise()
  if (what === 'find') return openSearch()
  if (what === 'journal') return journal()
  if (what === 'photo') { S.pickFor = S.open?.place ? { place: S.open.place } : {}; return $('#pickPhotos').click() }
  if (what === 'here') {
    try {
      toast('Finding you…', 1500)
      const at = await locate()
      await gaz.load()
      const p = S.places.filter(x => x.prec !== 'area').map(x => [gaz.km(x, at), x]).sort((a, b) => a[0] - b[0])[0]
      if (p && p[0] < 0.3) return openPlace(p[1].id)
      S.g.flyTo({ lat: at.lat - 1, lon: at.lon, dist: S.g.fit() * 0.36 }, 1600)
      tapped(at)
    } catch (err) { toast(err.message, 4000) }
  }
})
$('#settings').onclick = () => settings()
$('#mapbtn').onclick = () => mapSheet()
$('#globeback').onclick = () => rise()
$('#pickPhotos').onchange = e => { const files = [...e.target.files]; e.target.value = ''; photosPicked(files, S.pickFor || {}); S.pickFor = null }
$('#pickBackup').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''
  if (!f) return
  try { const n = await store.importAll(f); await reload(); toast(`Imported ${n} ${n === 1 ? 'thing' : 'things'}.`, 3000); closeSheet() } catch (err) { toast(err.message || 'That backup couldn’t be read.', 4000) }
}

boot().catch(err => {
  if (window.__splash) window.__splash.alive = false
  $('#splash')?.remove(); document.body.classList.remove('booting')
  $('#globe').innerHTML = `<p class="nogl">This browser can’t draw the globe (it needs WebGL 2).<br><small>${esc(err.message || err)}</small></p>` })
