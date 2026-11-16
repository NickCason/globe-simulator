// Reading about a place: a listing put together from open sources, with no keys. Wikipedia (the article), Wikivoyage
// (the travel guide), Wikidata (facts), Wikimedia Commons (photos), Open-Meteo (weather, climate, the time zone) and
// Panoramax (open street-level photos). Answers are kept in the browser's cache, so a place you've read about reads
// again offline. The parsers below are plain functions (test/read.test.js).

const CACHE = 'terralogue-read-v1', LANG = 'en'
const WP = `https://${LANG}.wikipedia.org`, WV = `https://${LANG}.wikivoyage.org`, WD = 'https://www.wikidata.org', CM = 'https://commons.wikimedia.org'
const DAY = 864e5
export const api = (host, params) => `${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: 2, origin: '*', ...params })
export const IMPERIAL = typeof navigator !== 'undefined' && /^en-(US|LR|MM)/.test(navigator.language || '')

// fetch with a time limit, kept for `ttl`; when the network fails, what we had (however old) is better than nothing
export async function get(url, { ttl = 14 * DAY, as = 'json', timeout = 12000 } = {}) {
  let box = null
  try { box = await caches.open(CACHE) } catch { /* private mode: no cache */ }
  const hit = box && await box.match(url)
  if (hit && Date.now() - (+hit.headers.get('x-at') || 0) < ttl) return as === 'json' ? hit.json() : hit.text()
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
    const text = await res.text()
    if (box) box.put(url, new Response(text, { headers: { 'x-at': String(Date.now()) } })).catch(() => {})
    return as === 'json' ? JSON.parse(text) : text
  } catch (err) {
    if (hit) return as === 'json' ? hit.json() : hit.text()
    throw err
  } finally { clearTimeout(timer) }
}

const R = 6371, rad = Math.PI / 180
export const km = (a, b) => {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// ---- which article: a name, checked against where it should be ----------------------------------------------------------
/** The Wikipedia page for a named place near (lat, lon): "Toledo", then "Toledo, Ohio", "Toledo, United States"…
 *  The first that exists, isn't a disambiguation page, and (for towns) is within maxKm. Else the nearest page that
 *  starts with the name. Resolves to a page title or null. */
export async function findTitle(name, { lat, lon, sub = '', maxKm = 40, city = false } = {}) {
  name = String(name || '').replace(/^Near /, '').trim()
  if (!name) return null
  const parts = sub.split(',').map(s => s.trim()).filter(Boolean)
  const bare = name.replace(/[- ](shi|ku|machi|chō|cho|mura|son|gun|si|gu|eup|myeon|dong|xian|qu|zhen)$/i, '')   // Nara-shi -> Nara
  const tries = [...new Set([name, bare, ...parts.map(p => `${name}, ${p}`), ...parts.map(p => `${bare}, ${p}`)])].slice(0, 6)
  const q = await get(api(WP, { action: 'query', titles: tries.join('|'), redirects: 1, prop: 'coordinates|pageprops', ppprop: 'disambiguation' }))
  const map = t => {
    for (const n of q.query?.normalized || []) if (n.from === t) t = n.to
    for (const r of q.query?.redirects || []) if (r.from === t) t = r.to
    return (q.query?.pages || []).find(p => p.title === t)
  }
  for (const t of tries) {
    const p = map(t)
    if (!p || p.missing || p.invalid || p.pageprops?.disambiguation !== undefined) continue
    const c = p.coordinates?.[0]
    if (lat == null || maxKm === Infinity || (c && km({ lat, lon }, c) <= maxKm)) return p.title
  }
  if (lat == null) return null
  const near = await nearby(lat, lon, 10000, 50).catch(() => [])
  const hit = near.find(p => p.title.toLowerCase().startsWith(bare.toLowerCase()))
  if (hit) return hit.title
  if (!city) return null
  // a town by another name ("Kyōto-shi"): the nearest article Wikipedia marks as a city
  const g = await get(api(WP, { action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: 10000, gslimit: 50, gsprop: 'type' })).catch(() => null)
  const town = (g?.query?.geosearch || []).find(x => x.type === 'city')
  return town ? town.title : null
}

// ---- Wikipedia ----------------------------------------------------------------------------------------------------------------
/** The article: its lead and sections (plain text), picture, description, coordinates and Wikidata id. */
export async function article(title) {
  const q = await get(api(WP, { action: 'query', titles: title, redirects: 1, prop: 'extracts|pageimages|description|coordinates|pageprops|info',
    explaintext: 1, exsectionformat: 'wiki', piprop: 'thumbnail|name', pithumbsize: 1200, ppprop: 'wikibase_item', inprop: 'url' }))
  const p = q.query?.pages?.[0]
  if (!p || p.missing) return null
  return { title: p.title, description: p.description || '', url: p.fullurl, qid: p.pageprops?.wikibase_item || null,
           image: p.thumbnail ? { src: p.thumbnail.source, file: p.pageimage } : null, coords: p.coordinates?.[0] || null,
           sections: sections(p.extract || '') }
}
// what plain-text extracts leave of pronunciations and empty templates: "( EYE-fəl; French: …)", "()", " ,"
export const tidy = line => line.trim().replace(/\s*\[[^\[\]]{1,60}\]/g, '').replace(/[;,]\s*\)/g, ')').replace(/\s*\(\s+[^()]*\)/g, '').replace(/\(\s*[;,]\s*/g, '(').replace(/\s*\(\s*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ')
const SKIP = /^(See also|References|Notes|External links|Further reading|Bibliography|Sources|Citations|Footnotes|Gallery|Explanatory notes|Notes and references|Works cited|Literature)$/i
/** Plain-text article -> [{ title, paras: [string | {h}] }]: the lead first (title ''), subsections folded into their section. */
export function sections(text) {
  const out = [{ title: '', paras: [] }]
  let skipping = false
  for (const line of String(text || '').split('\n')) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/)
    if (h) {
      if (h[1].length === 2) { skipping = SKIP.test(h[2]); if (!skipping) out.push({ title: h[2], paras: [] }) }
      else if (!skipping) out[out.length - 1].paras.push({ h: h[2] })
      continue
    }
    const t = tidy(line)
    if (t && !skipping) out[out.length - 1].paras.push(t)
  }
  for (const s of out) while (s.paras.length && typeof s.paras[s.paras.length - 1] === 'object') s.paras.pop()   // a heading with nothing under it
  return out.filter(s => s.paras.some(x => typeof x === 'string'))
}
/** Things with articles near a point (radius in metres, at most 10 km), nearest first: not events, and not the
 *  districts and regions the point is in. */
export async function nearby(lat, lon, radius = 10000, limit = 30) {
  const g = await get(api(WP, { action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: Math.min(10000, radius), gslimit: Math.min(100, limit * 2), gsprop: 'type' }))
  const hits = (g.query?.geosearch || []).filter(x => !/^(event|adm|country|state)/.test(x.type || '')).slice(0, limit)
  if (!hits.length) return []
  const q = await get(api(WP, { action: 'query', titles: hits.map(h => h.title).join('|'), prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: 240 }))
  const by = Object.fromEntries((q.query?.pages || []).map(p => [p.title, p]))
  return hits.map(h => ({ title: h.title, description: by[h.title]?.description || '', thumb: by[h.title]?.thumbnail?.source || null, lat: h.lat, lon: h.lon,
                          km: km({ lat, lon }, h), type: h.type || '' }))
    .filter(x => !/^(former |battle|siege|bombing|massacre)/i.test(x.description))
    .sort((a, b) => a.km - b.km)
}
const NOT_PHOTO = /\b(logo|flag|map|coat[ _]of[ _]arms|seal|icon|locator|location|diagram|chart|graph|symbol|emblem|signature|plan|blank|svg)\b/i
const info = p => {
  const ii = p.imageinfo?.[0], m = ii?.extmetadata || {}, txt = s => strip(s?.value || '')
  return ii && { file: p.title.replace(/^File:/, ''), thumb: ii.thumburl, full: ii.url, w: ii.thumbwidth, h: ii.thumbheight, page: ii.descriptionurl,
                 author: txt(m.Artist).slice(0, 80), license: txt(m.LicenseShortName), caption: txt(m.ImageDescription).slice(0, 200) }
}
const photoish = p => { const ii = p.imageinfo?.[0]; return ii && /jpeg|png|webp/.test(ii.mime) && ii.width >= 500 && !NOT_PHOTO.test(p.title) }
/** The photographs in an article (not its maps, flags and logos). */
export async function articlePhotos(title) {
  const q = await get(api(WP, { action: 'query', generator: 'images', titles: title, redirects: 1, gimlimit: 50, prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata', iiurlwidth: 640, iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription' }))
  return (q.query?.pages || []).filter(photoish).map(info)
}
/** Photos taken near a point (Wikimedia Commons). */
export async function photosNear(lat, lon, radius = 2000) {
  const q = await get(api(CM, { action: 'query', generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: Math.min(10000, radius), ggslimit: 40,
    ggsnamespace: 6, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: 640, iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription' }))
  return (q.query?.pages || []).filter(photoish).map(info)
}
/** Who made a picture and under what licence (for the picture at the top). */
export async function credit(file) {
  const q = await get(api(WP, { action: 'query', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName' }))
  const p = q.query?.pages?.[0], ii = p?.imageinfo?.[0], m = ii?.extmetadata || {}
  return ii ? { author: strip(m.Artist?.value || '').slice(0, 80), license: strip(m.LicenseShortName?.value || ''), page: ii.descriptionurl } : null
}
export function strip(html) {                                // text from a little HTML, without running any of it
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

// ---- Wikidata: the facts ----------------------------------------------------------------------------------------------------
const P = { population: 'P1082', area: 'P2046', elevation: 'P2044', height: 'P2048', founded: 'P571', opened: 'P1619', country: 'P17', in: 'P131',
            capital: 'P36', languages: 'P37', currency: 'P38', demonym: 'P1549', native: 'P1705', official: 'P1448', website: 'P856', flag: 'P41',
            arms: 'P94', leader: 'P6', driving: 'P1622', calling: 'P474', plugs: 'P2853', voltage: 'P2884', emergency: 'P2852', unesco: 'P757',
            heritage: 'P1435', kind: 'P31', architect: 'P84', image: 'P18', highest: 'P610' }
const UNIT = { Q712226: 1, Q25343: 1e-6, Q35852: 0.01, Q232291: 2.589988, Q81292: 0.00404686,       // to km²
               Q11573: 1, Q3710: 0.3048, Q174728: 0.01, Q828224: 1000 }                              // to metres
/** Facts about a Wikidata item, ready to show: [{ k, label, value, url? }], plus the travel guide's title and images. */
export async function facts(qid) {
  const q = await get(api(WD, { action: 'wbgetentities', ids: qid, props: 'claims|sitelinks|labels|descriptions', languages: LANG,
    sitefilter: `${LANG}wiki|${LANG}wikivoyage|commonswiki` }), { ttl: 30 * DAY })
  const e = q.entities?.[qid]
  if (!e) return null
  const ids = new Set()
  for (const k of ['country', 'in', 'capital', 'languages', 'currency', 'leader', 'driving', 'plugs', 'emergency', 'heritage', 'kind', 'architect', 'highest'])
    for (const c of current(e, P[k]).slice(0, 4)) { const v = value(c); if (v?.id) ids.add(v.id) }
  let labels = {}
  if (ids.size) {
    const l = await get(api(WD, { action: 'wbgetentities', ids: [...ids].slice(0, 50).join('|'), props: 'labels', languages: LANG }), { ttl: 30 * DAY })
    for (const [id, x] of Object.entries(l.entities || {})) labels[id] = x.labels?.[LANG]?.value
  }
  return pickFacts(e, labels)
}
const claims = (e, p) => (e.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value')
const current = (e, p) => {                                  // still true (no end date), the preferred ones first
  const cs = claims(e, p).filter(c => !c.qualifiers?.P582), pref = cs.filter(c => c.rank === 'preferred')
  return pref.length ? pref : cs
}
const value = c => c?.mainsnak?.datavalue?.value
function latest(e, p) {                                      // the preferred one, else the newest
  const t = c => c.qualifiers?.P585?.[0]?.datavalue?.value?.time || ''
  return claims(e, p).sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred') || t(b).localeCompare(t(a)))[0]
}
const amount = (c, to) => { const v = value(c); if (!v) return null; const f = to[v.unit?.split('/').pop()] ?? (v.unit === '1' ? 1 : null); return f == null ? null : +v.amount * f }
export function year(time) {                                  // "+1889-03-31T00:00:00Z" -> "1889"; "-0043-…" -> "43 BC"
  const m = String(time || '').match(/^([+-])0*(\d+)-/); if (!m) return ''
  return m[1] === '-' ? `${m[2]} BC` : m[2]
}
const n0 = n => Math.round(n).toLocaleString()
const nice = n => n >= 100 ? n0(n) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '')
export function pickFacts(e, labels = {}) {
  const L = id => labels[id] || null, out = []
  const items = (k, n = 3) => current(e, P[k]).map(value).filter(v => v?.id && v.id !== e.id).map(v => L(v.id)).filter(Boolean).slice(0, n)
  const nation = current(e, P.kind).some(c => ['Q3624078', 'Q6256', 'Q7275', 'Q112099'].includes(value(c)?.id))   // a country
  const add = (k, label, value, url) => { if (value) out.push({ k, label, value, url }) }
  const pop = latest(e, P.population)
  if (pop) add('population', 'Population', n0(+value(pop).amount) + (year(pop.qualifiers?.P585?.[0]?.datavalue?.value?.time) ? ` (${year(pop.qualifiers.P585[0].datavalue.value.time)})` : ''))
  const area = amount(latest(e, P.area), UNIT)
  if (area) add('area', 'Area', `${nice(area)} km²` + (IMPERIAL ? ` · ${nice(area / 2.589988)} sq mi` : ''))
  const el = amount(latest(e, P.elevation), UNIT)
  if (el != null && !isNaN(el)) add('elevation', 'Elevation', `${n0(el)} m` + (IMPERIAL ? ` · ${n0(el / 0.3048)} ft` : ''))
  const ht = amount(latest(e, P.height), UNIT)
  if (ht) add('height', 'Height', `${n0(ht)} m` + (IMPERIAL ? ` · ${n0(ht / 0.3048)} ft` : ''))
  const born = value(latest(e, P.founded)) || value(latest(e, P.opened))
  if (born?.time && !nation) add('founded', claims(e, P.founded).length ? 'Founded' : 'Opened', year(born.time))
  add('kind', 'What it is', items('kind', 1)[0])
  add('capital', 'Capital', items('capital', 1)[0])
  add('in', 'In', items('in', 1)[0])
  add('country', 'Country', items('country', 1)[0])
  add('languages', 'Languages', items('languages', 3).join(', '))
  add('currency', 'Currency', items('currency', 1)[0])
  const dem = claims(e, P.demonym).map(value).find(v => v?.language === LANG)
  if (dem) add('demonym', 'People', dem.text)
  add('leader', 'Led by', items('leader', 1)[0])
  const drive = items('driving', 1)[0]
  if (drive) add('driving', 'Drives on the', drive.replace(/-hand traffic$/i, '').replace(/^right$/i, 'right').toLowerCase())
  add('plugs', 'Plugs', items('plugs', 4).map(s => s.replace(/^(?:AC power plugs and sockets: )?(?:type|Type)\s*/, '')).join(', '))
  const volts = amount(latest(e, P.voltage), { Q25250: 1 })
  if (volts) add('voltage', 'Mains', `${n0(volts)} V`)
  const call = value(claims(e, P.calling)[0]); if (typeof call === 'string') add('calling', 'Dialling code', call)
  add('emergency', 'Emergency', items('emergency', 2).join(', '))
  add('architect', 'Architect', items('architect', 2).join(', '))
  add('highest', 'Highest point', items('highest', 1)[0])
  if (claims(e, P.unesco).length) add('unesco', 'Heritage', 'UNESCO World Heritage Site')
  else add('heritage', 'Heritage', items('heritage', 1)[0])
  const web = value(claims(e, P.website)[0]); if (typeof web === 'string') add('website', 'Website', web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), web)
  const nat = claims(e, P.native).map(value)[0] || claims(e, P.official).map(value).find(v => v?.language !== LANG)
  const file = f => f && `${CM}/wiki/Special:FilePath/${encodeURIComponent(f)}?width=240`
  return { list: out, native: nat && nat.text !== e.labels?.[LANG]?.value ? nat.text : '', description: e.descriptions?.[LANG]?.value || '',
           people: pop ? +value(pop).amount : null, nation,
           voyage: e.sitelinks?.[`${LANG}wikivoyage`]?.title || null, commons: e.sitelinks?.commonswiki?.title || null,
           flag: file(value(claims(e, P.flag)[0])), arms: file(value(claims(e, P.arms)[0])), image: value(claims(e, P.image)[0]) || null }
}

// ---- Wikivoyage: the travel guide ----------------------------------------------------------------------------------------------
export async function voyage(title) {
  const q = await get(api(WV, { action: 'query', titles: title, redirects: 1, prop: 'revisions|info', rvprop: 'content', rvslots: 'main', inprop: 'url' }))
  const p = q.query?.pages?.[0], text = p?.revisions?.[0]?.slots?.main?.content
  return text ? { title: p.title, url: p.fullurl, ...guideFrom(text) } : null
}
const CATS = ['see', 'do', 'buy', 'eat', 'drink', 'sleep']
/** A Wikivoyage article's wikitext -> { lead, understand, prose: {see: [...]}, listings: {see: [...]...}, places: [{name, text}] } */
export function guideFrom(text) {
  const heads = [...text.matchAll(/^==\s*([^=].*?)\s*==\s*$/gm)].map(m => ({ name: m[1].trim(), at: m.index, end: m.index + m[0].length }))
  const body = (i) => text.slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].at : text.length)
  const sectionAt = pos => { let s = ''; for (const h of heads) if (h.at < pos) s = h.name.toLowerCase(); return s }
  const lead = paras(heads.length ? text.slice(0, heads[0].at) : text)
  const out = { lead, understand: [], prose: {}, listings: Object.fromEntries(CATS.map(c => [c, []])), places: [] }
  heads.forEach((h, i) => {
    const name = h.name.toLowerCase()
    if (name === 'understand') out.understand = paras(body(i))
    if (CATS.includes(name)) out.prose[name] = paras(body(i)).slice(0, 3)
    if (/^(cities|other destinations|regions|districts)$/.test(name)) {
      for (const line of body(i).split('\n')) {
        const m = line.match(/^\*+\s*(?:\{\{marker[^}]*?name\s*=\s*)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\][^—–-]*(?:[—–-]\s*(.*))?$/)
        if (m) out.places.push({ title: m[1].trim(), name: (m[2] || m[1]).trim(), text: cleanWiki(m[3] || ''), group: h.name })
      }
    }
  })
  for (const t of templates(text, ['see', 'do', 'buy', 'eat', 'drink', 'sleep', 'listing'])) {
    const p = t.params, cat = CATS.includes(t.name) ? t.name : CATS.includes((p.type || '').toLowerCase()) ? p.type.toLowerCase() : sectionAt(t.at)
    if (!CATS.includes(cat) || !p.name) continue
    const lat = parseFloat(p.lat), lon = parseFloat(p.long)
    out.listings[cat].push({ name: cleanWiki(p.name), alt: cleanWiki(p.alt || ''), text: cleanWiki(p.content || p.description || ''),
      address: cleanWiki(p.address || ''), hours: cleanWiki(p.hours || ''), price: cleanWiki(p.price || ''), url: /^https?:/.test(p.url || '') ? p.url : '',
      lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null })
  }
  return out
}
export function templates(text, names) {                    // {{name | k=v | …}}, nesting and [[links|with pipes]] allowed
  const out = [], re = new RegExp(`\\{\\{\\s*(${names.join('|')})\\s*(?=[|}\\n])`, 'gi')
  let m
  while ((m = re.exec(text))) {
    let j = m.index + 2, depth = 1
    while (j < text.length && depth) {
      if (text.startsWith('{{', j)) { depth++; j += 2 } else if (text.startsWith('}}', j)) { depth--; j += 2 } else j++
    }
    out.push({ name: m[1].toLowerCase(), params: params(text.slice(m.index + 2, j - 2)), at: m.index })
    re.lastIndex = j
  }
  return out
}
function params(body) {
  const parts = []
  let depth = 0, cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue }
    if ((two === '}}' || two === ']]') && depth) { depth--; cur += two; i++; continue }
    if (body[i] === '|' && !depth) { parts.push(cur); cur = ''; continue }
    cur += body[i]
  }
  parts.push(cur)
  const out = {}
  for (const p of parts.slice(1)) { const k = p.indexOf('='); if (k > 0) out[p.slice(0, k).trim().toLowerCase()] = p.slice(k + 1).trim() }
  return out
}
/** Wiki markup -> plain text: links keep their words, templates, references, files and formatting go. */
export function cleanWiki(s) {
  let t = String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '')
  t = t.replace(/\[\[(?:File|Image):(?:[^[\]]|\[\[[^\]]*\]\])*\]\]/gi, '')
       .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
       .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/[^\]\s]+\]/g, '')
       .replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
       .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&')
  return t.replace(/[ \t]+/g, ' ').replace(/ ([,.;:])/g, '$1').trim()
}
function paras(wiki) {                                        // the prose paragraphs of a stretch of wikitext
  const out = []
  for (const block of wiki.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(l => !/^\s*([*#:;=|!]|\{\||\{\{|\[\[(File|Image):|__)/i.test(l))
    const t = cleanWiki(lines.join(' '))
    if (t.length > 40) out.push(t)
  }
  return out
}

// ---- the weather, the climate, the sun and the time there ------------------------------------------------------------------------
const OM = 'https://api.open-meteo.com/v1', OMA = 'https://archive-api.open-meteo.com/v1'
const units = () => IMPERIAL ? { temperature_unit: 'fahrenheit', precipitation_unit: 'inch', wind_speed_unit: 'mph' } : {}
/** The last five whole years, day by day, made into twelve months; also the place's time zone and elevation. */
export async function climate(lat, lon) {
  const y = new Date().getUTCFullYear() - 1
  const q = await get(`${OMA}/archive?` + new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), start_date: `${y - 4}-01-01`, end_date: `${y}-12-31`,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone: 'auto', ...units() }), { ttl: 120 * DAY, timeout: 15000 })
  return { months: monthly(q), tz: q.timezone || null, elevation: q.elevation ?? null, unit: q.daily_units?.temperature_2m_max || '°C',
           rainUnit: q.daily_units?.precipitation_sum || 'mm' }
}
export function monthly(q) {
  const d = q.daily || {}, m = Array.from({ length: 12 }, () => ({ hi: 0, lo: 0, rain: 0, n: 0, years: new Set() }))
  ;(d.time || []).forEach((t, i) => {
    const hi = d.temperature_2m_max?.[i], lo = d.temperature_2m_min?.[i]
    if (hi == null || lo == null) return
    const x = m[+t.slice(5, 7) - 1]
    x.hi += hi; x.lo += lo; x.rain += d.precipitation_sum?.[i] || 0; x.n++; x.years.add(t.slice(0, 4))
  })
  return m.map(x => x.n ? { hi: x.hi / x.n, lo: x.lo / x.n, rain: x.rain / x.years.size } : null)
}
/** The weather now and today. */
export async function weather(lat, lon) {
  const q = await get(`${OM}/forecast?` + new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), timezone: 'auto', forecast_days: 1,
    current: 'temperature_2m,weather_code,is_day,wind_speed_10m', daily: 'temperature_2m_max,temperature_2m_min', ...units() }), { ttl: 20 * 60000, timeout: 7000 })
  return { temp: q.current?.temperature_2m, code: q.current?.weather_code, day: !!q.current?.is_day, wind: q.current?.wind_speed_10m,
           hi: q.daily?.temperature_2m_max?.[0], lo: q.daily?.temperature_2m_min?.[0], unit: q.current_units?.temperature_2m || '°C', tz: q.timezone }
}
export const SKY = c => c == null ? '' : c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Overcast' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle'
  : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : c <= 86 ? 'Snow showers' : 'Thunderstorms'
/** Sunrise and sunset (the sunrise equation; a minute or two either way). */
export function sun(lat, lon, date = new Date()) {
  const n = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY) + 2440587.5 - 2451545 + 0.0008)
  const Js = n - lon / 360, M = ((357.5291 + 0.98560028 * Js) % 360 + 360) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const L = (M + C + 180 + 102.9372) % 360
  const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad)
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad))
  const cw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec))
  if (cw > 1) return { polar: 'night' }
  if (cw < -1) return { polar: 'day' }
  const w = Math.acos(cw) / rad, at = J => new Date((J - 2440587.5) * DAY)
  return { rise: at(Jt - w / 360), set: at(Jt + w / 360) }
}

// ---- street level: Panoramax (open photos, many of them 360°) -------------------------------------------------------------------
export async function streetPhoto(lat, lon) {
  for (const d of [0.0015, 0.006]) {
    const q = await get('https://api.panoramax.xyz/api/search?' + new URLSearchParams({ bbox: [lon - d, lat - d, lon + d, lat + d].map(v => v.toFixed(5)).join(','), limit: 20 }),
      { ttl: 30 * DAY, timeout: 9000 })
    const f = (q.features || []).filter(f => f.assets?.sd?.href).map(f => ({ f, km: km({ lat, lon }, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }) }))
      .sort((a, b) => a.km - b.km)[0]
    if (f) {
      const p = f.f.properties, io = p['pers:interior_orientation']
      const fov = typeof io === 'object' ? io?.field_of_view : +(String(io || '').match(/field_of_view'?:\s*(\d+)/)?.[1] || 0)
      return { id: f.f.id, src: f.f.assets.sd.href, thumb: f.f.assets.thumb?.href, pano: fov >= 359, heading: p['view:azimuth'] || 0, when: p.datetime,
               by: f.f.providers?.[0]?.name || '', license: p.license || '', m: Math.round(f.km * 1000), lat: f.f.geometry.coordinates[1], lon: f.f.geometry.coordinates[0] }
    }
  }
  return null
}
export const googleStreetView = (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
export const googleEmbed = (key, lat, lon) => `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${lat.toFixed(6)},${lon.toFixed(6)}&fov=80`
export const appleMaps = (lat, lon, name) => `https://maps.apple.com/?ll=${lat.toFixed(6)},${lon.toFixed(6)}&q=${encodeURIComponent(name || 'Here')}`
export const panoramaxViewer = (id, lat, lon) => `https://api.panoramax.xyz/#focus=pic&pic=${id}&map=17/${lat.toFixed(5)}/${lon.toFixed(5)}`
