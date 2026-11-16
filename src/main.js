// Globe Simulator: a visual journal of the world. Pin photos, notes and posts to any place on a hand-drawn globe.
// Everything stays on this device (src/store.js).
import { create } from './globe.js'
import { openStreets } from './streetmap.js'
import * as store from './store.js'
import { prepare } from './photos.js'
import * as gaz from './places.js'

const INKS = {
  parchment: { name: 'Parchment', paper: '#F3E8D2', ink: '#2B231D', accent: '#B4532F', muted: '#7A6450', park: '#6B7041' },
  slate: { name: 'Slate', paper: '#1B1612', ink: '#F1E6D2', accent: '#E07A4F', muted: '#B3A085', park: '#A9B06E', dark: true },
  blueprint: { name: 'Blueprint', paper: '#163A5F', ink: '#E8F1FA', accent: '#FFD166', muted: '#A9C3DD', park: '#8FD3B6', dark: true },
  sepia: { name: 'Sepia', paper: '#FBF5E8', ink: '#5A3A22', accent: '#8C2F1B', muted: '#8A6F55', park: '#6F7A3A' },
}
const LOOK = [['hatch', 'Hatching'], ['waterlines', 'Water lines'], ['graticule', 'Graticule'], ['boil', 'Line boil'], ['spin', 'Drift']]
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = (s, r = document) => r.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const S = {
  g: null, places: [], entries: [], open: null, temp: null, street: null, picking: null, pending: null,
  look: { ink: 'parchment', exaggeration: 0.062, levels: 8, hatch: true, waterlines: true, graticule: true, boil: !calm, spin: !calm,
          ...JSON.parse(localStorage.getItem('globe-look') || '{}') },
}
const saveLook = () => localStorage.setItem('globe-look', JSON.stringify(S.look))

// ---- start --------------------------------------------------------------------------------------------------------
const ICONSHOT = new URLSearchParams(location.search).has('icon')     // for making the app icon: just the globe
async function boot() {
  paint(INKS[S.look.ink])
  if (ICONSHOT) { document.body.classList.add('iconshot'); Object.assign(S.look, { spin: false, boil: false }) }
  const { ink, ...look } = S.look
  S.g = await create($('#globe'), {
    textures: { elev: 'data/elev.jpg', mask: 'data/mask.png', coast: 'data/coast.png' }, theme: INKS[ink], calm, ...look,
    onPick: p => p.id === 'temp' ? null : openPlace(p.id),
    onTap: at => tapped(at),
  })
  await reload()
  if (ICONSHOT) return S.g.flyTo({ lat: 28, lon: -38, dist: S.g.fit() * (new URLSearchParams(location.search).get('icon') === 'mask' ? 1.12 : 0.9) }, 10)
  if (!S.places.length) hint()
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {})
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
function pins() {
  const list = S.places.map(p => p.prec === 'area'
    ? { id: p.id, lat: p.lat, lon: p.lon, prec: 'country', label: p.name, glow: true, glowR: p.radius || 3 }
    : { id: p.id, lat: p.lat, lon: p.lon, prec: beenTo(p.id) ? 'address' : 'read', label: p.name })
  if (S.temp) list.push({ id: 'temp', lat: S.temp.lat, lon: S.temp.lon, prec: 'town', label: S.temp.name, always: true, blank: true })
  S.g.setPins(list)
  const sel = S.open?.place?.id || (S.temp && 'temp')
  if (sel) S.g.select(sel)
}
function paint(t) {
  const r = document.documentElement.style
  for (const [k, v] of Object.entries({ paper: t.paper, ink: t.ink, accent: t.accent, muted: t.muted })) r.setProperty('--' + k, v)
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
  S.open = null; S.temp = null; pins(); S.g.select(null)
  if (!fromHistory && history.state?.sheet) history.back()
}
addEventListener('popstate', () => { if (S.street) return closeStreets(); closeSheet(true) })
addEventListener('keydown', e => { if (e.key === 'Escape') S.street ? closeStreets() : closeSheet() })
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
  sheet(`<h2>Your globe is empty</h2><p class="lede">Make a place anywhere: tap the globe, or use <b>Here</b> where you stand, <b>Find</b> to look a place up,
    or <b>Photo</b> to add pictures (they find their own place when they know where they were taken).</p>
    <p class="muted small">Everything you add stays on this device. Back it up from the settings (top right) now and then.</p>
    <div class="row"><button class="btn primary" data-act="close">Start</button><button class="btn" data-act="import">Restore a backup</button></div>`, { size: 'half' })
}

// ---- making places --------------------------------------------------------------------------------------------------
async function tapped({ lat, lon }) {
  if (S.street) return
  if (S.picking) { const job = S.picking; S.picking = null; return job({ lat, lon }) }
  await gaz.load()
  const d = gaz.describe(lat, lon)
  S.temp = { lat, lon, name: d.name }
  pins()
  sheet(`<p class="eyebrow">A new place?</p><h2>${esc(d.name)}</h2><p class="muted">${esc(d.sub)}${d.sub ? ' · ' : ''}${gaz.coords(lat, lon)}</p>
    <div class="row"><button class="btn primary" data-act="keepSpot">Make it a place</button><button class="btn" data-act="close">Not now</button></div>`,
  { size: 'peek', state: { spot: { lat, lon, ...d } } })
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

// ---- a place ----------------------------------------------------------------------------------------------------------
async function openPlace(pid, { fly = true } = {}) {
  const p = S.places.find(x => x.id === pid) || await store.places.get(pid)
  if (!p) return
  S.temp = null
  if (fly) S.g.flyTo({ lat: p.lat - 2, lon: p.lon, dist: Math.min(S.g.view().dist, S.g.fit() * (p.prec === 'area' ? 0.6 : 0.42)) }, 1400)
  const list = (await store.entries.of(pid)).sort(byWhen)
  const been = list.some(e => e.been)
  sheet(`<p class="eyebrow">${p.prec === 'area' ? 'An area' : been ? 'Been there' : list.length ? 'Read about' : 'A place'}</p>
    <h2 class="pname">${esc(p.name)}</h2><p class="muted">${esc(p.sub)}${p.sub ? ' · ' : ''}${gaz.coords(p.lat, p.lon)}</p>
    <div class="acts">
      <button class="btn small" data-act="newEntry" data-kind="note">${ICON.note} Note</button>
      <button class="btn small" data-act="placePhotos">${ICON.photo} Photos</button>
      <button class="btn small" data-act="newEntry" data-kind="post">${ICON.post} Post</button>
      ${p.prec === 'area' ? '' : `<button class="btn small" data-act="streets">${ICON.streets} Streets</button>`}
      <button class="btn small ghost" data-act="placeMenu" aria-label="More">⋯</button>
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
      <label class="lbl check"><input id="fBeen" type="checkbox" ${e.been ? 'checked' : ''}> I was there</label>
    </div>
    <input id="fTags" class="field" placeholder="Tags, separated by commas" value="${esc((e.tags || []).join(', '))}">
    <textarea id="fLinks" class="field" rows="2" placeholder="Links: sources, articles, maps (one per line)">${esc((e.links || []).join('\n'))}</textarea>
    <div class="row"><button class="btn primary" data-act="saveEntry">Save</button><button class="btn" data-act="cancelEntry">Cancel</button>
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
    <div class="row"><button class="btn primary" data-act="pendingHere">Here, where I am</button><button class="btn" data-act="pendingPick">Tap it on the globe</button>
      <button class="btn" data-act="pendingFind">Look it up</button></div>`,
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
async function journal(filter = S.jfilter || 'all', q = S.jq || '') {
  S.jfilter = filter; S.jq = q
  const match = e => {
    const place = S.places.find(p => p.id === e.placeId)
    const ok = filter === 'all' || (filter === 'been' && e.been) || (filter === 'read' && !e.been) || e.kind === filter
    const hay = [e.title, e.text, (e.tags || []).join(' '), place?.name, place?.sub].join(' ').toLowerCase()
    return ok && (!q || q.toLowerCase().split(/\s+/).every(w => hay.includes(w)))
  }
  const list = S.entries.filter(match).sort(byWhen)
  let month = '', parts = []
  for (const e of list) {
    const m = e.when ? new Date(e.when + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Undated'
    if (m !== month) { parts.push(`<h3 class="month">${m}</h3>`); month = m }
    parts.push(await entryCard(e, true))
  }
  const html = `<h2>Journal</h2>
    <input id="jq" class="field" type="search" placeholder="Search entries, places and #tags" value="${esc(q)}" autocomplete="off">
    <div class="chips">${[['all', 'All'], ['been', 'Been there'], ['read', 'Read about'], ['photo', 'Photos'], ['post', 'Posts'], ['note', 'Notes']]
      .map(([k, l]) => `<button data-act="jfilter" data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="entries">${parts.join('') || `<p class="muted empty">${S.entries.length ? 'Nothing matches.' : 'No entries yet. Make a place, then write or add photos.'}</p>`}</div>`
  if (S.open?.journal) { $('#sheetBody').innerHTML = html } else sheet(html, { size: 'full', state: { journal: true } })
  const box = $('#jq'); box.oninput = () => { clearTimeout(S.jt); S.jt = setTimeout(() => journal(S.jfilter, box.value).then(() => { const b = $('#jq'); b.focus(); b.setSelectionRange(b.value.length, b.value.length) }), 250) }
}

// ---- find ----------------------------------------------------------------------------------------------------------------
function find() {
  sheet(`<h2>Find a place</h2><input id="fq" class="field" type="search" placeholder="A town, a city, a country…" autocomplete="off">
    <div class="results" id="results"><p class="muted small">Towns of 15,000 people or more, and every country. Smaller places: tap them on the globe.</p></div>`,
  { size: 'full', state: { find: true } })
  const box = $('#fq'); box.focus()
  gaz.load()
  box.oninput = async () => {
    await gaz.load()
    const q = box.value.trim(), k = q.toLowerCase()
    const mine = q ? S.places.filter(p => p.name.toLowerCase().includes(k)).slice(0, 5) : []
    const hits = gaz.search(q)
    $('#results').innerHTML = (mine.length ? `<p class="eyebrow">Your places</p>${mine.map(p => `<button class="res" data-act="openPlace" data-id="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></button>`).join('')}` : '') +
      (hits.length ? `<p class="eyebrow">The world</p>${hits.map((h, i) => `<button class="res" data-act="pickResult" data-i="${i}"><b>${esc(h.name)}</b><small>${esc(h.sub)}</small></button>`).join('')}` : q ? '<p class="muted small">Nothing by that name. Try tapping it on the globe.</p>' : '')
    S.hits = hits
  }
}

// ---- streets ---------------------------------------------------------------------------------------------------------------
async function fetchStreets(lat, lon, half = 650) {
  const dlat = half / 110540, dlon = half / (111320 * Math.cos(lat * Math.PI / 180))
  const box = `${lat - dlat},${lon - dlon},${lat + dlat},${lon + dlon}`
  const near = `${lat - dlat / 2.6},${lon - dlon / 2.6},${lat + dlat / 2.6},${lon + dlon / 2.6}`
  const q = `[out:json][timeout:60];(way["highway"](${box});way["building"](${near});way["leisure"="park"](${box}););out geom;`
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q),
                                                                     headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!r.ok) throw new Error('The map server is busy. Try again in a minute.')
  const osm = await r.json()
  const P = p => [Math.round((p.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180) * 10) / 10, Math.round(-(p.lat - lat) * 110540 * 10) / 10]
  const skip = new Set(['footway', 'path', 'steps', 'cycleway', 'corridor', 'track', 'bridleway', 'proposed', 'construction'])
  const out = { center: [lat, lon], half, roads: [], buildings: [], parks: [] }
  for (const el of osm.elements) {
    const t = el.tags || {}, pts = (el.geometry || []).map(P)
    if (t.highway && !skip.has(t.highway) && pts.length > 1) out.roads.push({ k: t.highway, n: t.name || '', p: pts })
    else if (t.leisure === 'park' && pts.length) out.parks.push(pts)
    else if (t.building && pts.length) out.buildings.push(pts)
  }
  return out
}
async function streetsFor(p) {
  let cached = await store.streets.get(p.id), data = cached?.data
  if (!data) {
    if (!navigator.onLine) return toast('Streets need a connection the first time.', 3500)
    toast('Drawing the streets…', 2500)
    try { data = await fetchStreets(p.lat, p.lon); await store.streets.put(p.id, data) } catch (err) { return toast(err.message || 'Couldn’t fetch the streets.', 4000) }
  }
  if (!data.roads.length) return toast('No streets mapped here.', 3000)
  closeSheet()
  await S.g.flyTo({ lat: p.lat, lon: p.lon, dist: 1.3 }, 2200)
  const at = S.g.where(p.lat, p.lon)
  const n = S.entries.filter(e => e.placeId === p.id).length
  S.street = openStreets($('#stage'), data, { at, theme: INKS[S.look.ink], title: p.name, subtitle: n ? `${n} ${n === 1 ? 'entry' : 'entries'} here` : gaz.coords(p.lat, p.lon) })
  const back = document.createElement('button'); back.className = 'btn primary streetback'; back.textContent = 'Back to the globe'
  back.onclick = () => closeStreets(); S.street.el.appendChild(back)
  S.streetPlace = p
  document.body.classList.add('streeting')
  history.pushState({ street: 1 }, '')
}
async function closeStreets() {
  if (!S.street) return
  const s = S.street; S.street = null
  document.body.classList.remove('streeting')
  await s.close()
  S.g.flyTo({ dist: S.g.fit() * 0.42 }, 1600)
  if (S.streetPlace) openPlace(S.streetPlace.id, { fly: false })
}

// ---- settings and backup ----------------------------------------------------------------------------------------------
async function settings() {
  const u = await store.usage()
  const mb = n => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1)
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false
  sheet(`<h2>Settings</h2>
    <p class="eyebrow">Ink</p><div class="inks">${Object.entries(INKS).map(([k, t]) => `<button data-act="ink" data-ink="${k}" class="${k === S.look.ink ? 'on' : ''}" style="--p:${t.paper};--i:${t.ink};--a:${t.accent}"><i></i>${t.name}</button>`).join('')}</div>
    <p class="eyebrow">The globe</p>
    <label class="lbl">Relief <output id="exv">×${Math.round(S.look.exaggeration / 0.0014)}</output><input id="ex" type="range" min="0" max="0.14" step="0.002" value="${S.look.exaggeration}"></label>
    <label class="lbl">Terraces <output id="lvv">${S.look.levels}</output><input id="lv" type="range" min="2" max="16" step="1" value="${S.look.levels}"></label>
    <div class="toggles">${LOOK.map(([k, l]) => `<label><input type="checkbox" data-look="${k}" ${S.look[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <p class="eyebrow">Your journal</p>
    <p class="small">Everything stays on this device${u ? `: about ${mb(u.usage || 0)} MB used` : ''}. ${persisted ? 'The browser has agreed to keep it.' : 'Back it up now and then: a browser can clear a site’s data.'}</p>
    <div class="row"><button class="btn" data-act="export">Export a backup</button><button class="btn" data-act="import">Import a backup</button></div>
    <p class="eyebrow">About</p>
    <p class="small muted">A hand-drawn globe for keeping notes, photos and posts about anywhere. Relief: ETOPO1 and GMTED2010 (AWS Terrain Tiles). Coasts and countries: Natural Earth. Towns: GeoNames (CC BY 4.0). Streets: © OpenStreetMap contributors. Built with three.js.</p>`,
  { size: 'full', state: { settings: true } })
  $('#ex').oninput = e => { S.look.exaggeration = +e.target.value; S.g.set({ exaggeration: S.look.exaggeration }); $('#exv').textContent = '×' + Math.round(S.look.exaggeration / 0.0014); saveLook() }
  $('#lv').oninput = e => { S.look.levels = +e.target.value; S.g.set({ levels: S.look.levels }); $('#lvv').textContent = S.look.levels; saveLook() }
  $('#sheetBody').onchange = e => { const k = e.target.dataset?.look; if (k) { S.look[k] = e.target.checked; S.g.set({ [k]: e.target.checked }); saveLook() } }
}

// ---- actions ---------------------------------------------------------------------------------------------------------------
const ICON = {
  note: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  post: '<svg viewBox="0 0 24 24"><path d="M5 5h14M5 10h14M5 15h9M5 20h6"/></svg>',
  streets: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 16h18M8 3v18M16 3v18"/></svg>',
}
const ACT = {
  close: () => closeSheet(),
  keepSpot: async () => { const s = S.open.spot; S.temp = null; const p = await makePlace({ lat: s.lat, lon: s.lon, name: s.name, sub: s.sub }); openPlace(p.id, { fly: false }) },
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
  streets: () => streetsFor(S.open.place),
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
  jfilter: el => journal(el.dataset.f, $('#jq')?.value || ''),
  pickResult: async el => {
    const h = S.hits[+el.dataset.i]
    const same = S.places.find(p => p.name === h.name && gaz.km(p, h) < 15)
    if (same) return openPlace(same.id)
    const p = await makePlace({ lat: h.lat, lon: h.lon, name: h.name, sub: h.kind === 'country' ? '' : h.sub, prec: h.kind === 'country' ? 'area' : 'town', radius: h.radius })
    if (S.pending) return pendingTo(p)
    openPlace(p.id)
  },
  pendingHere: async () => { try { toast('Finding you…', 1500); const at = await locate(); pendingTo(await placeNear(at.lat, at.lon)) } catch (err) { toast(err.message, 4000) } },
  pendingPick: () => { $('#sheet').classList.remove('on'); document.body.classList.remove('sheeted'); toast('Tap where it was taken.', 4000); S.picking = async at => pendingTo(await placeNear(at.lat, at.lon, 0.5)) },
  pendingFind: () => { const keep = S.pending; S.open.cleanup = null; find(); S.pending = keep },
  ink: el => {
    S.look.ink = el.dataset.ink; saveLook()
    const t = INKS[S.look.ink], run = () => { S.g.setTheme(t); paint(t); for (const b of el.parentElement.children) b.classList.toggle('on', b === el) }
    document.startViewTransition && !calm ? document.startViewTransition(run) : run()
  },
  export: async () => {
    toast('Packing up your journal…', 2000)
    const blob = await store.exportAll(), a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `globe-journal-${today()}.json${blob.type === 'application/gzip' ? '.gz' : ''}`
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
  if (S.street) await closeStreets()
  const what = b.dataset.do
  if (what === 'find') return find()
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
$('#pickPhotos').onchange = e => { const files = [...e.target.files]; e.target.value = ''; photosPicked(files, S.pickFor || {}); S.pickFor = null }
$('#pickBackup').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''
  if (!f) return
  try { const n = await store.importAll(f); await reload(); toast(`Imported ${n} ${n === 1 ? 'thing' : 'things'}.`, 3000); closeSheet() } catch (err) { toast(err.message || 'That backup couldn’t be read.', 4000) }
}

boot().catch(err => { $('#globe').innerHTML = `<p class="nogl">This browser can’t draw the globe (it needs WebGL 2).<br><small>${esc(err.message || err)}</small></p>` })
