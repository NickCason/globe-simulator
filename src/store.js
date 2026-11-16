// Everything is kept on this device, in IndexedDB: places, entries, photos (as Blobs) and fetched street maps.
// Backups are a single file you export and import (gzip-compressed JSON, photos inside as base64).
//
// place: { id, lat, lon, name, sub, prec: 'exact' | 'town' | 'area', radius (degrees, areas only), created, updated }
// entry: { id, placeId, kind: 'note' | 'photo' | 'post', title, text, photos: [photoId], tags: [], links: [],
//          when: 'YYYY-MM-DD', been: true (I was there) | false (I read about it), created, updated }
// photo: { id, blob, thumb, w, h, taken, lat, lon }

const DB = 'globe-journal', VERSION = 1
let dbp = null

function open() {
  if (dbp) return dbp
  dbp = new Promise((ok, no) => {
    const r = indexedDB.open(DB, VERSION)
    r.onupgradeneeded = () => {
      const db = r.result
      db.createObjectStore('places', { keyPath: 'id' })
      const e = db.createObjectStore('entries', { keyPath: 'id' })
      e.createIndex('placeId', 'placeId'); e.createIndex('created', 'created')
      db.createObjectStore('photos', { keyPath: 'id' })
      db.createObjectStore('streets', { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
  })
  return dbp
}
const done = req => new Promise((ok, no) => { req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error) })
async function tx(stores, mode, fn) {
  const db = await open()
  const t = db.transaction(stores, mode)
  const out = await fn(...[].concat(stores).map(s => t.objectStore(s)))
  await new Promise((ok, no) => { t.oncomplete = ok; t.onerror = () => no(t.error); t.onabort = () => no(t.error) })
  return out
}

export const id = prefix => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const now = () => Date.now()

export const places = {
  all: () => tx('places', 'readonly', s => done(s.getAll())),
  get: pid => tx('places', 'readonly', s => done(s.get(pid))),
  put: p => tx('places', 'readwrite', s => done(s.put({ ...p, updated: now(), created: p.created || now() }))).then(() => p),
  // a place and everything in it
  remove: pid => tx(['places', 'entries', 'photos', 'streets'], 'readwrite', async (P, E, Ph, S) => {
    const list = await done(E.index('placeId').getAll(pid))
    for (const e of list) { for (const ph of e.photos || []) Ph.delete(ph); E.delete(e.id) }
    S.delete(pid); P.delete(pid)
  }),
}
export const entries = {
  all: () => tx('entries', 'readonly', s => done(s.getAll())),
  of: pid => tx('entries', 'readonly', s => done(s.index('placeId').getAll(pid))),
  get: eid => tx('entries', 'readonly', s => done(s.get(eid))),
  put: e => tx('entries', 'readwrite', s => done(s.put({ ...e, updated: now(), created: e.created || now() }))).then(() => e),
  remove: e => tx(['entries', 'photos'], 'readwrite', (E, Ph) => { for (const ph of e.photos || []) Ph.delete(ph); E.delete(e.id) }),
}
export const photos = {
  get: pid => tx('photos', 'readonly', s => done(s.get(pid))),
  put: p => tx('photos', 'readwrite', s => done(s.put(p))).then(() => p),
  remove: pid => tx('photos', 'readwrite', s => done(s.delete(pid))),
}
export const streets = {
  get: pid => tx('streets', 'readonly', s => done(s.get(pid))),
  put: (pid, data) => tx('streets', 'readwrite', s => done(s.put({ id: pid, data, fetched: now() }))),
}

// Photos as object URLs, made once and reused (thumbs for lists, full size for the viewer).
const urls = new Map()
export async function photoURL(pid, which = 'thumb') {
  const key = pid + ':' + which
  if (urls.has(key)) return urls.get(key)
  const p = await photos.get(pid)
  if (!p) return ''
  const u = URL.createObjectURL(which === 'thumb' ? p.thumb : p.blob)
  urls.set(key, u)
  return u
}

// Ask the browser to keep this data (not evict it under storage pressure). Safe to call often.
export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false } catch { return false }
}
export async function usage() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null } catch { return null }
}

const b64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob) })
const unb64 = (s, type = 'image/jpeg') => new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type })

// The whole journal as one file. Compressed when the browser can (CompressionStream).
export async function exportAll() {
  const [P, E] = await Promise.all([places.all(), entries.all()])
  const ids = [...new Set(E.flatMap(e => e.photos || []))]
  const out = []
  for (const pid of ids) {
    const p = await photos.get(pid)
    if (p) out.push({ ...p, blob: await b64(p.blob), thumb: await b64(p.thumb) })
  }
  const json = JSON.stringify({ app: 'globe-simulator', version: 1, exported: new Date().toISOString(), places: P, entries: E, photos: out })
  if (typeof CompressionStream === 'undefined') return new Blob([json], { type: 'application/json' })
  const gz = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(gz, { headers: { 'Content-Type': 'application/gzip' } }).blob()
}
// Merges a backup in: anything newer in the file wins; nothing here is deleted.
export async function importAll(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const gz = head[0] === 0x1f && head[1] === 0x8b
  const text = gz ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text()
  const data = JSON.parse(text)
  if (data.app !== 'globe-simulator') throw new Error('That isn’t a Globe Simulator backup.')
  let n = 0
  for (const p of data.photos || []) { await photos.put({ ...p, blob: unb64(p.blob), thumb: unb64(p.thumb) }) }
  for (const p of data.places || []) {
    const mine = await places.get(p.id)
    if (!mine || (p.updated || 0) > (mine.updated || 0)) { await tx('places', 'readwrite', s => done(s.put(p))); n++ }
  }
  for (const e of data.entries || []) {
    const mine = await entries.get(e.id)
    if (!mine || (e.updated || 0) > (mine.updated || 0)) { await tx('entries', 'readwrite', s => done(s.put(e))); n++ }
  }
  return n
}
