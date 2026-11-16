// "Read about it": a listing for anywhere, laid out like a page of a good guidebook. Everything the open web knows about
// a spot, its town, its country (or its sea): the article, the travel guide, the facts, photographs, the street, what's
// around, the weather and the climate. Sections arrive as their sources answer; the slower ones load as you scroll to
// them. Anything worth keeping goes into your journal with its source.
import * as R from './read.js'
import { WebGLRenderer, Scene, PerspectiveCamera, SphereGeometry, Mesh, MeshBasicMaterial, TextureLoader, SRGBColorSpace } from 'three'

const I = {
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  sky: '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M9 2.5v1.3M2.5 9h1.3M4.4 4.4l.9.9M13.6 4.4l-.9.9"/><path d="M8 19h9.5a3.5 3.5 0 0 0 .2-7 5 5 0 0 0-9.5 1.4A2.8 2.8 0 0 0 8 19z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 6v2.5M5.6 9.6l1.7 1.7M18.4 9.6l-1.7 1.7M3 21h18"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.6M17.5 14a5 5 0 0 1 3 5"/></svg>',
  peak: '<svg viewBox="0 0 24 24"><path d="M3 19 9.5 8l3.5 6 2.5-3.5L21 19z"/></svg>',
  area: '<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z" stroke-dasharray="3 2.5"/></svg>',
  since: '<svg viewBox="0 0 24 24"><path d="M5 20V9l7-5 7 5v11M9 20v-6h6v6M3 20h18"/></svg>',
  keep: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>',
  kept: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.5L7 20z" fill="currentColor"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21c-.7-4.2-7-8-7-13a7 7 0 0 1 14 0c0 5-6.3 8.8-7 13z"/><circle cx="12" cy="8.5" r="2.4"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-3 2.5-3 14.5 0 17M12 3.5c3 2.5 3 14.5 0 17"/></svg>',
  streets: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 16h18M8 3v18M16 3v18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  look: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><circle cx="12" cy="12" r="2.5"/></svg>',
}
const KIND = { spot: 'This spot', landmark: 'A landmark', town: 'A town', country: 'A country', sea: 'A sea' }
const CAT = { see: 'See', do: 'Do', eat: 'Eat', drink: 'Drink', buy: 'Buy', sleep: 'Sleep' }
const MONTHS = 'JFMAMJJASOND'

export function makeGuide(app) {
  const { esc, gaz } = app
  const $ = s => document.querySelector(s)
  let cur = null, seq = 0

  // ---- what a spot is in: here (or the landmark here), its town, the sea, the country --------------------------------------
  async function trailFor(spot) {
    const out = [], { lat, lon } = spot
    await gaz.load().catch(() => {})
    const land = app.land(lat, lon), c = app.countryAt(lat, lon)
    const country = c && { kind: 'country', name: gaz.countryName?.(c.cc) || c.name, lat: c.lat ?? lat, lon: c.lon ?? lon, cont: c.continent }
    if (spot.prec === 'area') return { trail: [{ kind: 'country', name: spot.name, lat, lon, cont: c?.continent }], at: 0 }
    if (spot.prec === 'town') out.push({ kind: 'town', name: spot.name, sub: spot.sub, lat, lon })
    else {
      out.push({ kind: 'spot', name: spot.name, sub: spot.sub, lat, lon })
      const lm = await landmark(lat, lon)
      if (lm) out.push(lm)
      const n = gaz.ready() ? gaz.townAt(lat, lon, 40) : null
      if (n?.place) out.push({ kind: 'town', name: n.place.name, sub: n.place.sub, lat: n.place.lat, lon: n.place.lon })
    }
    if (!land) { const sea = app.seaAt(lat, lon); if (sea) out.push({ kind: 'sea', name: sea.name, lat: sea.lat, lon: sea.lon }) }
    if (country) out.push(country)
    let at = out.findIndex(s => s.kind === 'landmark')
    if (at < 0 && !land) at = out.findIndex(s => s.kind === 'sea')        // out at sea: the sea
    if (at < 0) at = Math.max(0, out.findIndex(s => s.kind === 'town' && s.name === spot.name.replace(/^Near /, '') && !spot.name.startsWith('Near ')))
    return { trail: out, at }
  }
  async function landmark(lat, lon) {                         // an article right here (within ~120 m) that's a thing, not an event
    try {
      const q = await R.get(R.api('https://en.wikipedia.org', { action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: 120, gslimit: 10, gsprop: 'type' }), { timeout: 4000 })
      const hit = (q.query?.geosearch || []).find(g => g.dist <= 80 && !/^(event|city|adm|country|state)/.test(g.type || ''))
      return hit ? { kind: 'landmark', name: hit.title, title: hit.title, lat: hit.lat, lon: hit.lon } : null
    } catch { return null }
  }

  // ---- open, and move about ------------------------------------------------------------------------------------------------
  async function open(spot) {
    teardown()
    const token = ++seq
    app.sheet(`<div class="guide"><div class="g-hero skel"></div><p class="eyebrow">Reading about</p><h2 class="g-title">${esc(spot.name)}</h2>
      <div class="g-lines"><i></i><i></i><i></i></div></div>`, { size: 'full', state: { guide: true, cleanup: () => { teardown(); app.setGlance([]) } } })
    const { trail, at } = await trailFor(spot)
    if (token !== seq) return
    cur = { spot, trail, at, history: [], live: [] }
    show()
  }
  function go(subject, push = true) {                        // read something else: a crumb, or a place around here
    if (!cur) return
    if (push) cur.history.push({ trail: cur.trail, at: cur.at })
    const i = cur.trail.findIndex(s => s.kind === subject.kind && s.name === subject.name)
    if (i >= 0) cur.at = i
    else { cur.trail = [subject, ...cur.trail.filter(s => s.kind === 'town' || s.kind === 'country' || s.kind === 'sea')]; cur.at = 0 }
    show()
  }
  function back() { const h = cur?.history.pop(); if (h) { cur.trail = h.trail; cur.at = h.at; show() } }
  function teardown() {
    if (!cur) return
    for (const f of cur.live) try { f() } catch { /* already gone */ }
    cur.live = []
  }

  // ---- one subject's page ---------------------------------------------------------------------------------------------------
  function show() {
    teardown()
    const token = ++seq, s = cur.trail[cur.at], body = $('#sheetBody')
    const wet = s.kind === 'spot' && !app.land(s.lat, s.lon)
    const secs = { spot: wet ? ['photos', 'climate'] : ['street', 'around', 'photos', 'intown', 'climate'], landmark: ['about', 'street', 'photos', 'around', 'facts', 'climate'],
                   town: ['about', 'guide', 'photos', 'street', 'around', 'climate', 'facts'], country: ['about', 'guide', 'places', 'photos', 'facts', 'climate'],
                   sea: ['about', 'photos', 'facts', 'climate'] }[s.kind]
    const TITLE = { about: 'About', guide: 'Travel guide', places: 'Where to go', photos: 'Photos', street: 'Street level', around: 'Around here', intown: 'Nearby', climate: 'Climate', facts: 'Facts' }
    const crumbs = cur.trail.map((t, i) => `<button data-g="crumb" data-i="${i}" class="${i === cur.at ? 'on' : ''}">${t.kind === 'spot' ? I.pin : t.kind === 'country' ? I.globe : ''}${esc(t.kind === 'spot' ? 'This spot' : t.name.replace(/ \(.*\)$/, ''))}</button>`).join('<span>›</span>')
    cur.article = cur.voyage = cur.around = cur.photos = null
    body.innerHTML = `<div class="guide" data-kind="${s.kind}">
      ${cur.history.length ? `<button class="g-back" data-g="back">${I.back} Back</button>` : ''}
      <nav class="g-crumbs">${crumbs}</nav>
      <figure class="g-hero skel" id="gHero"></figure>
      <p class="eyebrow" id="gEyebrow">${esc(KIND[s.kind])}${s.sub ? ' · ' + esc(s.sub) : ''}</p>
      <h2 class="g-title">${esc(s.kind === 'spot' ? s.name : s.title || s.name)}</h2>
      <p class="g-native" id="gNative" hidden></p>
      <p class="g-desc" id="gDesc">${s.kind === 'spot' && s.name !== gaz.coords(s.lat, s.lon) ? esc(gaz.coords(s.lat, s.lon)) : ''}</p>
      <div class="g-quick" id="gQuick"></div>
      <div class="g-acts">${acts(s)}</div>
      <nav class="g-tabs" id="gTabs">${secs.map(k => `<button data-g="tab" data-s="${k}">${TITLE[k]}</button>`).join('')}</nav>
      ${secs.map(k => `<section class="g-sec" id="gs-${k}" data-s="${k}"><h3>${TITLE[k]}</h3><div class="g-body"><div class="g-lines"><i></i><i></i></div></div></section>`).join('')}
      <footer class="g-sources" id="gSources"></footer>
    </div>`
    body.scrollTop = 0
    const lazy = {}
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue
        const k = e.target.dataset.s
        if (lazy[k]) { const f = lazy[k]; lazy[k] = null; io.unobserve(e.target); f() }
      }
    }, { root: body, rootMargin: '0px 0px 500px 0px' })
    const live = fn => { if (token === seq) cur.live.push(fn) }
    live(() => io.disconnect())
    const alive = () => token === seq && cur && $('#sheetBody .guide')
    const used = new Set()
    const sources = () => { const el = $('#gSources'); if (el) el.innerHTML = sourceList(used) }
    const fill = (k, html) => { const el = $(`#gs-${k} .g-body`); if (el && alive()) el.innerHTML = html }
    const hide = k => { if (!alive()) return; $(`#gs-${k}`)?.setAttribute('hidden', ''); $(`#gTabs [data-s="${k}"]`)?.setAttribute('hidden', '') }
    const fail = (k, err) => fill(k, `<p class="g-none">Couldn’t load this just now${navigator.onLine ? '' : ' (you’re offline)'}. <button class="link" data-g="retry">Try again</button></p>`) || console.warn(k, err)
    app.fly(s)

    // the clock, the weather and the sun, for everywhere
    const quick = { }
    const drawQuick = () => {
      const el = $('#gQuick'); if (!el || !alive()) return
      const cards = []
      if (quick.tz) cards.push(card(I.clock, 'Local time', time(new Date(), quick.tz), quick.zone))
      if (quick.w) cards.push(card(I.sky, R.SKY(quick.w.code) || 'Weather', `${Math.round(quick.w.temp)}°`, quick.w.hi != null ? `H ${Math.round(quick.w.hi)}° · L ${Math.round(quick.w.lo)}°` : ''))
      const sun = R.sun(s.lat, s.lon)
      if (quick.tz || cards.length) cards.push(sun.polar ? card(I.sun, 'The sun', sun.polar === 'day' ? 'Up all day' : 'Down all day', '')
        : card(I.sun, 'Sunrise · sunset', `${time(sun.rise, quick.tz)}`, time(sun.set, quick.tz)))
      for (const f of quick.facts || []) cards.push(card({ population: I.people, elevation: I.peak, height: I.peak, area: I.area, founded: I.since }[f.k], f.label, f.value.replace(/ \(.*\)$/, ''), f.value.match(/\((.*)\)$/)?.[1] || ''))
      if (!quick.facts && quick.elevation != null && s.kind !== 'sea') cards.push(card(I.peak, 'Elevation', `${Math.round(R.IMPERIAL ? quick.elevation / 0.3048 : quick.elevation)} ${R.IMPERIAL ? 'ft' : 'm'}`, ''))
      el.innerHTML = cards.join('')
    }
    const tick = setInterval(() => alive() ? drawQuick() : clearInterval(tick), 30000)
    live(() => clearInterval(tick))
    R.climate(s.lat, s.lon).then(c => {
      if (!alive()) return
      quick.tz = c.tz; quick.zone = zoneName(c.tz); quick.elevation = c.elevation; drawQuick()
      used.add('meteo'); sources()
      if (c.months.every(Boolean)) fill('climate', climateChart(c)); else hide('climate')
    }).catch(err => { if (alive()) { drawQuick(); fail('climate', err) } })
    R.weather(s.lat, s.lon).then(w => { if (alive() && w.temp != null) { quick.w = w; quick.tz ||= w.tz; drawQuick() } }).catch(() => {})

    // the article, then its facts, then its travel guide
    const wantsArticle = s.kind !== 'spot'
    if (wantsArticle) (async () => {
      const title = s.title || await R.findTitle(s.name, { lat: s.lat, lon: s.lon, sub: s.sub || '', maxKm: s.kind === 'town' ? 40 : s.kind === 'landmark' ? 2 : Infinity, city: s.kind === 'town' })
      if (!alive()) return
      if (!title) { ['about', 'guide', 'places', 'facts'].forEach(hide); hero(null); return lazyPhotos(null) }
      s.title = title
      const a = await R.article(title)
      if (!alive()) return
      if (!a) { ['about', 'guide', 'places', 'facts'].forEach(hide); hero(null); return lazyPhotos(null) }
      used.add('wikipedia'); sources()
      cur.article = a
      $('.g-title').textContent = a.title.replace(/ \(.*\)$/, '')
      if (s.kind === 'town') { const c = $('.g-crumbs button.on'); if (c) c.textContent = a.title.replace(/ \(.*\)$/, '').replace(/,.*/, '') }
      if (a.description) $('#gDesc').textContent = a.description[0].toUpperCase() + a.description.slice(1)
      hero(/flag|coat|emblem|seal|locator|map/i.test(a.image?.file || '') ? null : a.image, true)
      fill('about', about(a))
      lazyPhotos(a.title)
      if (a.coords && s.kind !== 'country' && km(a.coords, s) > 1) { s.lat = a.coords.lat; s.lon = a.coords.lon; app.fly(s) }
      if (!a.qid) { $('#gHero:not(:has(img))')?.remove(); hide('facts'); hide('guide'); hide('places'); return }
      const f = await R.facts(a.qid)
      if (!alive() || !f) return
      used.add('wikidata'); sources()
      if (f.native) { const n = $('#gNative'); n.textContent = f.native; n.hidden = false }
      quick.facts = f.list.filter(x => ['population', 'elevation', 'height', 'area', 'founded'].includes(x.k)).slice(0, 4); drawQuick()
      if (s.kind === 'town' && f.people) $('#gEyebrow').textContent = (f.people >= 100000 ? 'A city' : f.people >= 8000 ? 'A town' : 'A village') + (s.sub ? ' · ' + s.sub : '')
      if (!$('#gHero img') && f.image && !/flag|coat|emblem|seal|locator|map/i.test(f.image)) hero({ src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f.image)}?width=1280`, file: f.image })
      if (!$('#gHero img')) $('#gHero')?.remove()
      const rest = f.list.filter(x => !['population', 'elevation', 'height', 'area'].includes(x.k))
      rest.length || f.flag ? fill('facts', factList(rest, f)) : hide('facts')
      if (!f.voyage) { hide('guide'); hide('places'); return }
      const v = await R.voyage(f.voyage)
      if (!alive()) return
      if (!v) { hide('guide'); hide('places'); return }
      used.add('wikivoyage'); sources()
      cur.voyage = v
      const g = guideHtml(v)
      g ? fill('guide', g) : hide('guide')
      v.places.length && s.kind === 'country' ? fill('places', placesHtml(v)) : hide('places')
      glance()
    })().catch(err => { if (alive()) { fail('about', err); hero(null) } })
    else { hero(null); lazyPhotos(null) }

    // a spot: what its town is, in a few lines
    if (s.kind === 'spot') {
      const town = cur.trail.find(t => t.kind === 'town')
      if (!town) hide('intown')
      else (async () => {
        const title = town.title || await R.findTitle(town.name, { lat: town.lat, lon: town.lon, sub: town.sub || '', maxKm: 40, city: true })
        const a = title && await R.article(title)
        if (!alive()) return
        if (!a) return fill('intown', `<p class="g-none">In ${esc(town.name)}${town.sub ? ', ' + esc(town.sub) : ''}.</p>`)
        town.title = title; used.add('wikipedia'); sources()
        const lead = a.sections[0]?.paras.filter(p => typeof p === 'string')[0] || ''
        fill('intown', `<div class="g-town">${a.image ? `<img src="${esc(a.image.src)}" alt="" loading="lazy">` : ''}<div><b>${esc(a.title)}</b>
          <p>${esc(sentences(lead, 2))}</p><button class="link" data-g="crumbName" data-name="${esc(town.name)}">Read about ${esc(a.title.replace(/,.*/, ''))} ›</button></div></div>`)
      })().catch(err => fail('intown', err))
    }

    // the slower ones, as you come to them (photos wait for the article, to know which it is)
    function lazyPhotos(title) { lazy.photos = () => photos(title); const el = $('#gs-photos'); if (el && alive()) io.observe(el) }
    lazy.street = () => street()
    lazy.around = () => around()
    if (wet) { lazy.street = lazy.around = null; lazyPhotos(null) }
    for (const k of ['street', 'around']) { const el = $(`#gs-${k}`); if (el) io.observe(el) }

    async function photos(title) {
      try {
        const [mine, near] = await Promise.all([title ? R.articlePhotos(title).catch(() => []) : [],
          s.kind === 'country' ? [] : R.photosNear(s.lat, s.lon, { spot: 800, landmark: 600, town: 3000, sea: 10000 }[s.kind] || 2000).catch(() => [])])
        if (!alive()) return
        const seen = new Set(), list = [...mine, ...near].filter(p => p && !seen.has(p.file) && seen.add(p.file)).slice(0, 30)
        if (!list.length) return hide('photos')
        used.add('commons'); sources()
        cur.photos = list
        fill('photos', `<div class="g-grid">${list.map((p, i) => `<button data-g="photo" data-i="${i}"><img src="${esc(p.thumb)}" alt="${esc(p.caption)}" loading="lazy"></button>`).join('')}</div>
          <p class="g-note">${mine.length ? 'From the article' : ''}${mine.length && near.length ? ', and ' : ''}${near.length ? 'taken nearby' : ''}. Tap one to see who took it, or to keep it.</p>`)
      } catch (err) { fail('photos', err) }
    }
    async function street() {
      const key = app.googleKey()
      const google = key ? `<div class="g-frame"><iframe src="${esc(R.googleEmbed(key, s.lat, s.lon))}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''
      const links = `<div class="row"><a class="btn small" href="${R.googleStreetView(s.lat, s.lon)}" target="_blank" rel="noopener">${I.look} Google Street View</a>
        ${/Mac|iPhone|iPad/.test(navigator.userAgent) ? `<a class="btn small" href="${R.appleMaps(s.lat, s.lon, s.title || s.name)}" target="_blank" rel="noopener">${I.out} Apple Maps</a>` : ''}</div>`
      fill('street', google + `<div id="gPano"><div class="g-lines"><i></i></div></div>` + links)
      try {
        const p = await R.streetPhoto(s.lat, s.lon)
        if (!alive()) return
        const box = $('#gPano')
        if (!p) { box.innerHTML = google ? '' : `<p class="g-note">No open street-level photos here yet. Google’s Street View may have some.</p>`; return }
        used.add('panoramax'); sources()
        box.innerHTML = `<div class="g-pano${p.pano ? ' is360' : ''}"></div><p class="g-note">${p.pano ? 'Drag to look around. ' : ''}${p.m} m away · ${p.when ? new Date(p.when).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''}${p.by ? ' · ' + esc(p.by) : ''}${p.license ? ' · ' + esc(p.license) : ''} ·
          <a href="${R.panoramaxViewer(p.id, p.lat, p.lon)}" target="_blank" rel="noopener">Panoramax</a></p>`
        const el = box.querySelector('.g-pano')
        if (p.pano) live(panorama(el, p.src))
        else el.innerHTML = `<img src="${esc(p.src)}" alt="The street here" loading="lazy">`
      } catch (err) { const box = $('#gPano'); if (box && alive()) box.innerHTML = google ? '' : `<p class="g-note">Couldn’t reach the street photos just now.</p>` }
    }
    async function around() {
      try {
        const list = (await R.nearby(s.lat, s.lon, s.kind === 'town' ? 8000 : 3000, 30)).filter(p => p.title !== s.title && p.title !== cur.article?.title && p.km > 0.02).slice(0, 14)
        if (!alive()) return
        if (!list.length) return hide('around')
        used.add('wikipedia'); sources()
        cur.around = list
        fill('around', `<div class="g-list">${list.map((p, i) => `<button class="g-item" data-g="aroundRead" data-i="${i}">
          ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : `<i>${I.pin}</i>`}
          <span><b>${esc(p.title)}</b><small>${esc(p.description ? p.description[0].toUpperCase() + p.description.slice(1) : '')}</small></span>
          <em>${p.km < 1 ? Math.round(p.km * 1000 / 10) * 10 + ' m' : (R.IMPERIAL ? (p.km / 1.609).toFixed(1) + ' mi' : p.km.toFixed(1) + ' km')}</em></button>`).join('')}</div>`)
        glance()
      } catch (err) { fail('around', err) }
    }
    function glance() {                                     // things to see, and what's around, as little pins on the globe
      const pins = []
      for (const [i, l] of (cur.voyage?.listings.see || []).entries()) if (l.lat != null && pins.length < 18) pins.push({ id: `g:see:${i}`, lat: l.lat, lon: l.lon, label: l.name })
      for (const [i, p] of (cur.around || []).entries()) if (pins.length < 30) pins.push({ id: `g:around:${i}`, lat: p.lat, lon: p.lon, label: p.title })
      app.setGlance(pins)
    }
    function hero(img, wait) {                             // wait: there may be a better picture coming (a country's, from its facts)
      const el = $('#gHero'); if (!el || !alive()) return
      if (!img) { if (!wait) el.remove(); return }
      el.classList.remove('skel')
      el.innerHTML = `<img src="${esc(img.src)}" alt="">${img.file ? `<figcaption id="gCredit"></figcaption>` : ''}`
      const im = el.querySelector('img')
      im.onload = () => el.classList.add('in')
      im.onerror = () => el.remove()
      if (img.file) R.credit(img.file).then(c => { const f = $('#gCredit'); if (f && c) f.innerHTML = `<a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.author || 'Photo')}${c.license ? ' · ' + esc(c.license) : ''}</a>` }).catch(() => {})
    }
  }
  const km = (a, b) => R.km(a, b)
  function acts(s) {
    const saved = app.placeFor(s, { find: true })
    return `${saved ? `<button class="btn small" data-g="openPlace" data-id="${saved.id}">${I.kept} In your journal</button>` : `<button class="btn small primary" data-g="makePlace">${I.pin} Make it a place</button>`}
      ${s.kind !== 'country' && s.kind !== 'sea' ? `<button class="btn small" data-g="streets">${I.streets} Streets</button>` : ''}`
  }

  // ---- pieces ------------------------------------------------------------------------------------------------------------------
  const card = (icon, label, value, note) => `<div class="g-card">${icon || ''}<small>${esc(label)}</small><b>${esc(value)}</b>${note ? `<em>${esc(note)}</em>` : ''}</div>`
  const time = (d, tz) => { try { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }) } catch { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) } }
  const zoneName = tz => { try { return new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '' } catch { return '' } }
  const sentences = (t, n) => (String(t).match(/[^.!?]+[.!?]+(\s|$)/g) || [t]).slice(0, n).join('').trim()
  function about(a) {
    const lead = a.sections[0]?.title === '' ? a.sections[0] : null, rest = a.sections.filter(s => s !== lead)
    const ps = (s, si) => s.paras.map((p, pi) => typeof p === 'string'
      ? `<p>${esc(p)}<button class="g-keep" data-g="keepText" data-k="${si}:${pi}" aria-label="Keep this in your journal">${I.keep}</button></p>` : `<h4>${esc(p.h)}</h4>`).join('')
    return (lead ? `<div class="g-prose">${ps(lead, 0)}</div>` : '') +
      (rest.length ? `<div class="g-more">${rest.map((s, i) => `<details><summary>${esc(s.title)}${I.more}</summary><div class="g-prose">${ps(s, a.sections.indexOf(s))}</div></details>`).join('')}</div>` : '') +
      `<p class="g-note"><a href="${esc(a.url)}" target="_blank" rel="noopener">The whole article on Wikipedia ›</a></p>`
  }
  function guideHtml(v) {
    let html = ''
    const blurb = v.lead.slice(0, 2), under = v.understand.slice(0, 3)
    if (blurb.length) html += `<div class="g-prose">${blurb.map(p => `<p>${esc(p)}</p>`).join('')}</div>`
    if (under.length) html += `<details><summary>Understand${I.more}</summary><div class="g-prose">${under.map(p => `<p>${esc(p)}</p>`).join('')}</div></details>`
    for (const [k, label] of Object.entries(CAT)) {
      const list = v.listings[k].filter(l => l.text || l.address).slice(0, 12), prose = v.prose[k] || []
      if (!list.length && !prose.length) continue
      html += `<h4 class="g-cat">${label}</h4>`
      if (!list.length) { html += `<div class="g-prose">${prose.slice(0, 1).map(p => `<p>${esc(p)}</p>`).join('')}</div>`; continue }
      html += `<div class="g-cards">${list.map((l, i) => `<article class="g-listing" id="g-${k}-${i}">
        <b>${esc(l.name)}</b>${l.alt ? `<small class="alt">${esc(l.alt)}</small>` : ''}
        ${l.text ? `<p>${esc(sentences(l.text, 3))}</p>` : ''}
        ${l.address || l.hours || l.price ? `<small>${[l.address, l.hours, l.price].filter(Boolean).map(esc).join(' · ')}</small>` : ''}
        <span class="g-row">
          <button data-g="keepListing" data-c="${k}" data-i="${i}">${I.keep} Keep</button>
          ${l.lat != null ? `<button data-g="listingGlobe" data-c="${k}" data-i="${i}">${I.pin} On the globe</button>` : ''}
          ${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${I.out} Website</a>` : ''}</span></article>`).join('')}</div>`
    }
    if (html) html += `<p class="g-note"><a href="${esc(v.url)}" target="_blank" rel="noopener">The whole guide on Wikivoyage ›</a></p>`
    return html
  }
  function placesHtml(v) {
    const groups = {}
    for (const p of v.places) (groups[p.group] ||= []).push(p)
    return Object.entries(groups).map(([g, list]) => `<h4 class="g-cat">${esc(g)}</h4><div class="g-list">${list.slice(0, 12).map(p =>
      `<button class="g-item" data-g="readTitle" data-t="${esc(p.title)}"><i>${I.pin}</i><span><b>${esc(p.name)}</b><small>${esc(sentences(p.text, 1))}</small></span></button>`).join('')}</div>`).join('')
  }
  function factList(list, f) {
    return `${f.flag || f.arms ? `<div class="g-flags">${f.flag ? `<img src="${esc(f.flag)}" alt="Flag">` : ''}${f.arms ? `<img src="${esc(f.arms)}" alt="Coat of arms">` : ''}</div>` : ''}
      <dl class="g-facts">${list.map(x => `<div><dt>${esc(x.label)}</dt><dd>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.value)}</a>` : esc(x.value)}</dd></div>`).join('')}</dl>`
  }
  function climateChart(c) {
    const m = c.months, W = 340, H = 168, l = 26, r = 10, t = 14, b = 22, w = (W - l - r) / 12
    const his = m.map(x => x.hi), los = m.map(x => x.lo), rains = m.map(x => x.rain)
    const tmin = Math.floor(Math.min(...los) / 5) * 5, tmax = Math.ceil(Math.max(...his) / 5) * 5, rmax = Math.max(...rains, 1e-6)
    const y = v => t + (H - t - b) * (1 - (v - tmin) / Math.max(1, tmax - tmin)), x = i => l + w * (i + 0.5)
    const line = vs => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
    const bars = rains.map((v, i) => { const h = (H - t - b) * 0.55 * v / rmax; return `<rect x="${(x(i) - w * 0.3).toFixed(1)}" y="${(H - b - h).toFixed(1)}" width="${(w * 0.6).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>` }).join('')
    const grid = []; for (let v = tmin; v <= tmax; v += (tmax - tmin > 30 ? 10 : 5)) grid.push(`<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 5}" y="${y(v) + 3.5}">${v}°</text>`)
    const hot = his.indexOf(Math.max(...his)), cold = los.indexOf(Math.min(...los)), wet = rains.indexOf(Math.max(...rains)), dry = rains.indexOf(Math.min(...rains))
    const mon = i => new Date(2001, i, 1).toLocaleDateString(undefined, { month: 'long' })
    const rain = v => c.rainUnit === 'inch' ? v.toFixed(1) + ' in' : Math.round(v) + ' mm'
    return `<svg class="g-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average highs, lows and rain by month">
        <g class="grid">${grid.join('')}</g><g class="rain">${bars}</g>
        <path class="lo" d="${line(los)}"/><path class="hi" d="${line(his)}"/>
        ${his.map((v, i) => `<circle class="hi" cx="${x(i)}" cy="${y(v)}" r="2.4"/>`).join('')}${los.map((v, i) => `<circle class="lo" cx="${x(i)}" cy="${y(v)}" r="2.2"/>`).join('')}
        ${[...MONTHS].map((ch, i) => `<text class="mon" x="${x(i)}" y="${H - 6}">${ch}</text>`).join('')}</svg>
      <p class="g-legend"><span class="hi">Average high</span><span class="lo">Average low</span><span class="rain">Rain</span></p>
      <p class="g-prose-s">Warmest in ${mon(hot)} (highs around ${Math.round(his[hot])}°), coldest in ${mon(cold)} (lows around ${Math.round(los[cold])}°).
        Wettest in ${mon(wet)} (${rain(rains[wet])}), driest in ${mon(dry)} (${rain(rains[dry])}).</p>
      <p class="g-note">From the last five years of weather here.</p>`
  }
  const SOURCES = {
    wikipedia: ['Wikipedia', 'the article', 'CC BY-SA 4.0'], wikivoyage: ['Wikivoyage', 'the travel guide', 'CC BY-SA 4.0'], wikidata: ['Wikidata', 'the facts', 'CC0'],
    commons: ['Wikimedia Commons', 'the photos (each credited)', 'various'], meteo: ['Open-Meteo', 'weather, climate and time zone', 'CC BY 4.0'],
    panoramax: ['Panoramax', 'the street photo', 'as credited'],
  }
  const sourceList = used => used.size ? `<p class="eyebrow">Sources</p><p class="g-note">${[...used].map(k => `${SOURCES[k][0]}: ${SOURCES[k][1]} (${SOURCES[k][2]})`).join(' · ')}.
    Everything here is read live from the open web and kept on this device so it reads again offline.</p>` : ''

  // ---- a 360° street photo you can drag around ----------------------------------------------------------------------------------
  function panorama(el, src) {
    const r = new WebGLRenderer({ antialias: true }); r.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    el.appendChild(r.domElement)
    const scene = new Scene(), cam = new PerspectiveCamera(70, 1, 0.1, 50)
    const geo = new SphereGeometry(10, 64, 40); geo.scale(-1, 1, 1)
    const tex = new TextureLoader().load(src, () => { el.classList.add('in'); draw() }); tex.colorSpace = SRGBColorSpace
    scene.add(new Mesh(geo, new MeshBasicMaterial({ map: tex })))
    let a = Math.PI, pitch = 0, drag = null, spin = true, raf = 0, seen = true
    function draw() {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix()
      cam.lookAt(Math.cos(a), Math.tan(pitch), Math.sin(a)); r.render(scene, cam)
    }
    const loop = () => { if (spin && seen) { a += 0.0016; draw() } raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    el.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, a, pitch]; spin = false; el.setPointerCapture(e.pointerId) })
    el.addEventListener('pointermove', e => {
      if (!drag) return
      const k = cam.fov * Math.PI / 180 / el.clientHeight
      a = drag[2] - (e.clientX - drag[0]) * k; pitch = Math.max(-1.1, Math.min(1.1, drag[3] + (e.clientY - drag[1]) * k)); draw()
    })
    el.addEventListener('pointerup', () => { drag = null })
    el.addEventListener('wheel', e => { e.preventDefault(); cam.fov = Math.max(30, Math.min(95, cam.fov + e.deltaY * 0.05)); draw() }, { passive: false })
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting })
    io.observe(el)
    return () => { cancelAnimationFrame(raf); io.disconnect(); geo.dispose(); tex.dispose(); r.dispose(); r.forceContextLoss?.() }
  }

  // ---- a photo, large, with its credit ----------------------------------------------------------------------------------------
  function viewPhoto(i) {
    const p = cur.photos[i]; if (!p) return
    const box = document.createElement('div'); box.className = 'lightbox g-lb'
    const big = p.thumb.replace(/\/\d+px-/, '/1280px-')
    box.innerHTML = `<img src="${esc(big)}" alt="${esc(p.caption)}"><div class="g-lbbar"><span>${p.caption ? `<b>${esc(sentences(p.caption, 1))}</b>` : ''}
      <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.author || 'Unknown')}${p.license ? ' · ' + esc(p.license) : ''}</a></span>
      <button class="btn small" data-k="keep">${I.keep} Keep</button></div><button class="x" aria-label="Close">×</button>`
    box.querySelector('img').onerror = e => { if (e.target.src !== p.thumb) e.target.src = p.thumb }
    document.body.appendChild(box)
    requestAnimationFrame(() => box.classList.add('on'))
    const shut = () => { box.classList.remove('on'); setTimeout(() => box.remove(), 300) }
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-k=keep]')) { e.target.closest('button').disabled = true; await keepPhoto(p); return shut() }
      if (e.target.closest('.x') || e.target === box) shut()
    })
  }

  // ---- keeping things: they go into your journal, under this place, with where they came from ------------------------------------
  const subject = () => cur.trail[cur.at]
  async function keepText(text, { title = '', link, source }) {
    await app.keep(subject(), { kind: 'note', title, text: `${text}\n\n— ${source}`, links: link ? [link] : [] })
    const el = $('.g-acts'); if (el) el.innerHTML = acts(subject())       // it's in your journal now
  }
  async function keepPhoto(p) {
    try {
      app.toast('Keeping the photo…', 1500)
      const res = await fetch(p.thumb.replace(/\/\d+px-/, '/1280px-')).then(r => r.ok ? r : fetch(p.thumb))
      const file = new File([await res.blob()], p.file, { type: 'image/jpeg' })
      await app.keep(subject(), { kind: 'photo', text: `${p.caption ? sentences(p.caption, 1) + '\n\n' : ''}Photo: ${p.author || 'unknown'}${p.license ? ', ' + p.license : ''}, via Wikimedia Commons`,
                                  links: [p.page], files: [file] })
    } catch (err) { app.toast('Couldn’t keep that photo: ' + err.message, 3500) }
  }

  // ---- taps inside the listing --------------------------------------------------------------------------------------------------
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-g]'); if (!b || !b.closest('.guide') || !cur) return
    e.preventDefault()
    const s = subject(), d = b.dataset
    switch (d.g) {
      case 'crumb': return go(cur.trail[+d.i], true)
      case 'crumbName': { const t = cur.trail.find(x => x.name === d.name); return t && go(t, true) }
      case 'back': return back()
      case 'tab': return $(`#gs-${d.s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      case 'retry': return show()
      case 'makePlace': { b.disabled = true; await app.makePlace(s); const el = $('.g-acts'); if (el) el.innerHTML = acts(s); return }
      case 'openPlace': return app.openPlace(d.id)
      case 'streets': return app.dive(s)
      case 'photo': return viewPhoto(+d.i)
      case 'aroundRead': { const p = cur.around[+d.i]; return go({ kind: 'landmark', name: p.title, title: p.title, lat: p.lat, lon: p.lon }) }
      case 'readTitle': { const a = await R.article(d.t).catch(() => null); return go({ kind: 'town', name: d.t, title: a?.title || d.t, lat: a?.coords?.lat ?? s.lat, lon: a?.coords?.lon ?? s.lon }) }
      case 'keepText': {
        const [si, pi] = d.k.split(':').map(Number), a = cur.article, p = a?.sections[si]?.paras[pi]
        if (!p) return
        b.innerHTML = I.kept; b.disabled = true
        return keepText(p, { title: a.sections[si].title ? `${a.title}: ${a.sections[si].title}` : a.title, link: a.url, source: `Wikipedia, “${a.title}”` })
      }
      case 'keepListing': {
        const l = cur.voyage.listings[d.c][+d.i]
        b.innerHTML = `${I.kept} Kept`; b.disabled = true
        return keepText([l.text, [l.address, l.hours, l.price].filter(Boolean).join(' · ')].filter(Boolean).join('\n\n'),
          { title: `${CAT[d.c]}: ${l.name}`, link: l.url || cur.voyage.url, source: `Wikivoyage, “${cur.voyage.title}”` })
      }
      case 'listingGlobe': { const l = cur.voyage.listings[d.c][+d.i]; return app.fly({ kind: 'landmark', lat: l.lat, lon: l.lon }, true) }
    }
  })
  /** A glance pin was tapped on the globe: show its card. */
  function focus(id) {
    if (!cur) return
    const [, kind, i] = id.split(':')
    if (kind === 'around') { const p = cur.around?.[+i]; if (p) go({ kind: 'landmark', name: p.title, title: p.title, lat: p.lat, lon: p.lon }) }
    else { const el = $(`#g-${kind}-${i}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') } }
  }
  return { open, focus, isOpen: () => !!cur && !!$('#sheetBody .guide') }
}
