// The offline gazetteer (public/data/places.json, made by tools/prep_places.py): every town of 15,000 people or
// more, and every country. Loaded the first time it's needed. Search by name; name the spot nearest a point.

let data = null, loading = null
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function load(url = 'data/places.json') {
  if (data) return Promise.resolve(data)
  return loading || (loading = fetch(url).then(r => r.json()).then(d => {
    d.townKeys = d.towns.map(t => fold(t[1] || t[0]))
    d.landKeys = d.lands.map(l => fold(l[0]))
    return (data = d)
  }))
}
export const ready = () => !!data

const town = (d, t) => ({ kind: 'town', name: t[0], lat: t[2] / 100, lon: t[3] / 100, cc: t[4],
                          sub: [t[5], d.countries[t[4]] || t[4]].filter(Boolean).join(', '), pop: t[6] * 1000 })
const land = l => ({ kind: 'country', name: l[0], lat: l[1] / 100, lon: l[2] / 100, radius: l[3], cc: l[4], sub: 'a country' })

/** Places whose names start with (then contain) the query: countries first when they match, then towns by size. */
export function search(q, limit = 12) {
  if (!data) return []
  const k = fold(q).trim()
  if (!k) return []
  const out = []
  data.landKeys.forEach((n, i) => { if (n.startsWith(k)) out.push(land(data.lands[i])) })
  for (let pass = 0; pass < 2 && out.length < limit; pass++) {
    for (let i = 0; i < data.towns.length && out.length < limit; i++) {
      const n = data.townKeys[i], hit = pass === 0 ? n.startsWith(k) : !n.startsWith(k) && n.includes(k)
      if (hit) out.push(town(data, data.towns[i]))
    }
  }
  return out.slice(0, limit)
}

const R = 6371
export function km(a, b) {
  const r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** The nearest town to a point, and how far: { place, km }. Within `limit` km, else the country it's probably in. */
export function nearest(lat, lon, limit = 120) {
  if (!data) return null
  let best = null, bd = Infinity
  const cos = Math.cos(lat * Math.PI / 180)
  for (const t of data.towns) {
    const dy = t[2] / 100 - lat, dx = (((t[3] / 100 - lon + 540) % 360) - 180) * cos
    const d = dx * dx + dy * dy
    if (d < bd) { bd = d; best = t }
  }
  const place = best && town(data, best), d = place ? km({ lat, lon }, place) : Infinity
  if (d <= limit) return { place, km: d }
  return { place: null, km: d }
}

// The biggest town within r km (inside a big city, its districts and suburbs are nearer than its centre).
function biggest(lat, lon, r) {
  let best = null
  for (const t of data.towns) {                     // towns are sorted biggest first: the first one in reach wins
    if (Math.abs(t[2] / 100 - lat) > r / 111) continue
    const p = town(data, t)
    if (km({ lat, lon }, p) <= r) { best = p; break }
  }
  return best
}

/** A short name for a spot: "Lyon", "Near Lyon", or its coordinates when no town is close. */
export function describe(lat, lon) {
  const n = nearest(lat, lon)
  if (!n?.place) return { name: coords(lat, lon), sub: '' }
  const big = biggest(lat, lon, Math.max(8, n.km * 1.5))
  const p = big && big.pop > n.place.pop * 3 ? big : n.place, d = km({ lat, lon }, p)
  return { name: d < 6 || (p === big && d < 12) ? p.name : `Near ${p.name}`, sub: p.sub }
}
export const coords = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`
