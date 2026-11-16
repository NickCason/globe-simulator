// Finding anywhere, beyond the offline gazetteer: towns and villages of every size (Open-Meteo's place search, made from
// GeoNames), and streets, landmarks, peaks, parks and the rest (Photon, from OpenStreetMap). Both are free and need no
// key; they're asked only as you search, after the offline list has answered, and each answer is remembered for the
// visit. Offline, search simply stays with the offline list.
const seen = new Map()
const R = 6371, rad = Math.PI / 180
export const km = (a, b) => {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
async function json(url, ms = 6000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(res.status)
    return await res.json()
  } finally { clearTimeout(timer) }
}

const SETTLEMENT = { city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', suburb: 'District', quarter: 'District',
                     neighbourhood: 'Neighbourhood', borough: 'District', locality: 'Place', isolated_dwelling: 'Place', island: 'Island',
                     islet: 'Island', municipality: 'Town' }
const fold = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const nice = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** A town or village from Open-Meteo's search (GeoNames). */
export function fromGeoNames(r) {
  const pop = r.population || 0
  return { kind: 'online', name: r.name, sub: [r.admin1 !== r.name && r.admin1, r.country].filter(Boolean).join(', '),
           label: r.feature_code === 'PPLC' ? 'Capital' : pop >= 100000 ? 'City' : pop >= 10000 ? 'Town' : 'Village',
           lat: r.latitude, lon: r.longitude, pop, prec: 'town', place: true, code: r.feature_code || '' }
}
// Things too small to be a place in a journal: stops, platforms, parking, benches…
const NOISE = /^(information:.*|tourism:information|highway:(bus_stop|platform|stop|street_lamp|crossing|traffic_signals|turning_circle|give_way|speed_camera)|public_transport:.*|railway:(platform|stop|halt|switch|signal|crossing|level_crossing)|amenity:(parking|parking_space|bench|bicycle_parking|waste_basket|vending_machine|atm|toilets|post_box|telephone|charging_station)|barrier:.*|power:.*|man_made:(pole|mast|manhole))$/
/** Anything from Photon (OpenStreetMap): a settlement, a street, an address, a landmark… */
export function fromOSM(f) {
  const p = f.properties || {}, [lon, lat] = f.geometry?.coordinates || []
  if (lat == null || NOISE.test(`${p.osm_key}:${p.osm_value}`)) return null
  const name = p.name || (p.street ? `${p.housenumber ? p.housenumber + ' ' : ''}${p.street}` : null)
  if (!name) return null
  const place = p.osm_key === 'place' && SETTLEMENT[p.osm_value], area = p.osm_key === 'boundary'
  // an address is a plain building or door; a tower, a museum or a monument with an address is still that
  const plain = !p.name || p.osm_key === 'building' || (p.osm_key === 'place' && p.osm_value === 'house')
  const label = place || (area ? 'Area' : p.type === 'street' || p.osm_key === 'highway' ? 'Street' : plain && p.type === 'house' ? 'Address' : nice(p.osm_value || p.type))
  const sub = [p.city !== name && (p.city || p.district), p.state !== name && p.state, p.country].filter(Boolean)
  return { kind: 'online', name, sub: [...new Set(sub)].join(', '), label, lat, lon, prec: place || area ? 'town' : 'exact', place: !!place, area }
}

/** Places anywhere called q, the best known first (the Eiffel Tower in Paris before the one in Texas). */
export async function searchOnline(q) {
  q = q.trim()
  if (q.length < 2) return []
  const key = q.toLowerCase()
  if (seen.has(key)) return seen.get(key)
  const [towns, things] = await Promise.all([
    json('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: 12, language: 'en', format: 'json' }))
      .then(r => (r.results || []).filter(x => /^PPL/.test(x.feature_code || 'PPL')).map(fromGeoNames)).catch(() => null),
    json('https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: 15, lang: 'en' }))
      .then(r => (r.features || []).map(fromOSM).filter(Boolean)).catch(() => null),
  ])
  if (!towns && !things) throw new Error('offline')                      // neither answered: don't remember that
  // OpenStreetMap's order first (it ranks by how well known a thing is: the tower in Paris before the one in Texas),
  // then towns and villages only GeoNames knew. One of each thing: a town beats the boundary drawn round it.
  const out = [], typed = /\d/.test(q)
  const add = t => {
    const twin = out.findIndex(o => fold(o.name) === fold(t.name) && km(o, t) < (o.place || o.area || t.place || t.area ? 30 : 2))
    if (twin < 0) out.push(t)
    else if (out[twin].area && t.place) out[twin] = t
  }
  for (const t of things || []) if (t.label !== 'Address' || typed) add(t)   // addresses when you type a number
  for (const t of towns || []) add(t)
  const list = out.slice(0, 16)
  seen.set(key, list)
  return list
}
