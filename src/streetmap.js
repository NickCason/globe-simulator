// Down to the street: a sketched map drawn from an OpenStreetMap extract (see tools/prep_streets.py). Roads are
// inked as double lines and draw outward from the middle; buildings are hatched; one place can be highlighted with a
// callout. It opens as a circle growing from a point on the screen (where the globe's pin was).
//
// data: { center: [lat, lon], half: metres, roads: [{k: highway kind, n: name, p: [[x, y]…]}], buildings: [[[x, y]…]],
//         parks: [[[x, y]…]], here: { n: name, rings: [[[x, y]…]…] } }  (x east, y south, in metres from the centre)

const CSS = `
.gs-street { position: absolute; inset: 0; z-index: 4; background: var(--paper); clip-path: circle(0px at var(--x) var(--y));
             transition: clip-path 1s cubic-bezier(.65,0,.35,1); }
.gs-street.on { clip-path: circle(150% at var(--x) var(--y)); }
.gs-street.off { clip-path: circle(0px at var(--x) var(--y)); transition-duration: .6s; }
.gs-street svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.gs-street .pk { fill: color-mix(in srgb, var(--park) 16%, transparent); stroke: color-mix(in srgb, var(--park) 55%, transparent); stroke-width: 2; }
.gs-street .rc path, .gs-street .rf path { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.gs-street .rc path { stroke: var(--ink); } .gs-street .rf path { stroke: var(--paper); }
.gs-street.on .rc path, .gs-street.on .rf path { animation: gs-draw .9s cubic-bezier(.16,1,.3,1) forwards; animation-delay: var(--d); }
.gs-street .bd path { fill: url(#gsHatchB); stroke: var(--ink); stroke-width: 1.4; opacity: 0; }
.gs-street.on .bd path { animation: gs-fade .6s ease-out forwards; animation-delay: var(--d); }
.gs-street .hb { stroke: var(--ink); stroke-width: 1.2; opacity: .45; }
.gs-street .hh { stroke: var(--accent); stroke-width: 2; }
.gs-street .here { fill: url(#gsHatchH); fill-rule: evenodd; stroke: var(--accent); stroke-width: 4; opacity: 0; }
.gs-street .spot { opacity: 0; } .gs-street.on .spot { animation: gs-show .5s ease-out 1.4s forwards; }
.gs-street .spot circle:first-child { fill: color-mix(in srgb, var(--accent) 25%, transparent); stroke: var(--accent); stroke-width: 3; }
.gs-street .spot circle:last-child { fill: var(--accent); }
.gs-street.on .here { animation: gs-show .6s ease-out 1.4s forwards; }
.gs-street .rl { font: italic 21px Georgia, serif; fill: var(--muted); text-anchor: middle; paint-order: stroke; stroke: var(--paper); stroke-width: 6px; opacity: 0; }
.gs-street.on .rl { animation: gs-show .6s ease-out 1.6s forwards; }
.gs-street .callout path { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.gs-street.on .callout path { animation: gs-draw .8s cubic-bezier(.16,1,.3,1) 1.9s forwards; }
.gs-street .tag { opacity: 0; } .gs-street.on .tag { animation: gs-show .5s ease-out 2.4s forwards; }
.gs-street .tag rect { fill: var(--paper); stroke: var(--ink); stroke-width: 2; }
.gs-street .tag .t1 { font: 30px Georgia, serif; fill: var(--ink); }
.gs-street .tag .t2 { font: 600 17px system-ui, sans-serif; fill: var(--muted); }
.gs-street .north path { fill: var(--ink); } .gs-street .north text { font: 700 19px system-ui, sans-serif; fill: var(--ink); }
.gs-street .scale path { stroke: var(--ink); stroke-width: 4; fill: none; } .gs-street .scale text { font: 600 18px system-ui, sans-serif; fill: var(--ink); }
.gs-street .osm { position: absolute; right: 10px; top: 10px; font: 10.5px system-ui, sans-serif; color: var(--muted);
                  background: color-mix(in srgb, var(--paper) 85%, transparent); padding: 2px 6px; border-radius: 6px; }
@keyframes gs-draw { to { stroke-dashoffset: 0; } }
@keyframes gs-fade { to { opacity: .6; } }
@keyframes gs-show { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .gs-street, .gs-street * { animation-duration: 1ms !important; animation-delay: 0s !important; transition-duration: 1ms !important; } }
`
const WIDTH = { motorway: 20, trunk: 18, primary: 16, secondary: 14, tertiary: 11, residential: 8, unclassified: 7, living_street: 6,
                pedestrian: 6, service: 4 }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const path = pts => 'M' + pts.map(p => p.join(' ')).join('L')

function injectCss() {
  if (document.getElementById('gs-street-css')) return
  const s = document.createElement('style'); s.id = 'gs-street-css'; s.textContent = CSS; document.head.appendChild(s)
}

/** Builds the map's SVG markup. opts: { title, subtitle, labels: how many street names (5) } */
export function streetSVG(S, { title = '', subtitle = '', labels = 5 } = {}) {
  const near = pts => Math.min(...pts.map(p => Math.hypot(p[0], p[1])))
  const roads = S.roads.filter(r => r.p.length > 1).sort((a, b) => (WIDTH[a.k] || 5) - (WIDTH[b.k] || 5))
  const delay = r => Math.round(Math.min(1, near(r.p) / S.half) * 1100 + 250)
  const named = {}
  for (const r of S.roads) if (r.n && ['primary', 'secondary', 'tertiary', 'residential', 'pedestrian'].includes(r.k) && r.p.length > 1) {
    let best = null
    for (let i = 1; i < r.p.length; i++) {
      const [a, b] = [r.p[i - 1], r.p[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (len > 110 && Math.hypot(...mid) < S.half * 0.75 && (!best || len > best.len)) best = { len, mid, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI }
    }
    if (best && (!named[r.n] || best.len > named[r.n].len)) named[r.n] = best
  }
  const names = Object.entries(named).sort((a, b) => b[1].len - a[1].len).slice(0, labels).map(([n, b]) => {
    const ang = b.ang > 90 ? b.ang - 180 : b.ang < -90 ? b.ang + 180 : b.ang
    return `<text class="rl" transform="translate(${b.mid[0].toFixed(1)} ${b.mid[1].toFixed(1)}) rotate(${ang.toFixed(1)})" dy="7">${esc(n)}</text>`
  })
  const rings = S.here ? (S.here.rings || [S.here.p]) : []
  const all = rings.flat()
  const box = all.length ? all.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]) : [-16, -16, 16, 16]
  const cx = (box[0] + box[2]) / 2, top = box[1]
  const tagW = Math.max(240, 17 * Math.max(title.length * 1.05, subtitle.length * 0.56)), tagX = cx - tagW / 2 - 40, tagY = top - 150
  const s = S.half
  return `<svg viewBox="${-s} ${-s} ${s * 2} ${s * 2}" preserveAspectRatio="xMidYMid slice">
    <defs><pattern id="gsHatchB" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><path d="M0 0v7" class="hb"/></pattern>
      <pattern id="gsHatchH" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 0v5" class="hh"/></pattern></defs>
    ${S.parks.map(p => `<path class="pk" d="${path(p)}Z"/>`).join('')}
    <g class="rc">${roads.map(r => `<path pathLength="1" style="--d:${delay(r)}ms;stroke-width:${(WIDTH[r.k] || 5) + 4}" d="${path(r.p)}"/>`).join('')}</g>
    <g class="rf">${roads.map(r => `<path pathLength="1" style="--d:${delay(r) + 120}ms;stroke-width:${WIDTH[r.k] || 5}" d="${path(r.p)}"/>`).join('')}</g>
    <g class="bd">${S.buildings.map((b, i) => `<path style="--d:${900 + (i % 40) * 18}ms" d="${path(b)}Z"/>`).join('')}</g>
    ${rings.length ? `<path class="here" d="${rings.map(r => path(r) + 'Z').join('')}"/>` : '<g class="spot"><circle r="15"/><circle r="5"/></g>'}
    ${names.join('')}
    ${title ? `<g class="callout"><path pathLength="1" d="M${cx} ${top - 6}C${cx - 10} ${top - 40} ${cx - 34} ${top - 60} ${cx - 40} ${tagY + 52}"/>
      <path pathLength="1" d="M${cx} ${top - 6}l-15 -14M${cx} ${top - 6}l5 -20"/></g>
    <g class="tag" transform="translate(${tagX} ${tagY})"><rect x="-12" y="-30" width="${tagW + 24}" height="80" rx="12"/>
      <text y="0" class="t1">${esc(title)}</text><text y="26" class="t2">${esc(subtitle)}</text></g>` : ''}
    <g class="north" transform="translate(205 ${-s + 250})"><path d="M0 -36L12 10 0 2 -12 10Z"/><text y="34" text-anchor="middle">N</text></g>
    <g class="scale" transform="translate(-235 ${-s + 250})"><path d="M0 0h200M0 -8v16M200 -8v16"/><text x="100" y="-14" text-anchor="middle">200 m</text></g>
  </svg><span class="osm">© OpenStreetMap contributors</span>`
}

/**
 * Opens the street map over `container`, growing from screen point `at` ({x, y}, relative to the container).
 * theme: {paper, ink, accent, muted, park}. Returns { close() } (close shrinks it back and removes it).
 */
export function openStreets(container, data, { at = { x: 0, y: 0 }, theme = {}, ...opts } = {}) {
  injectCss()
  const el = document.createElement('div')
  el.className = 'gs-street'
  const t = { paper: '#F3E8D2', ink: '#2B231D', accent: '#B4532F', muted: '#7A6450', park: '#6B7041', ...theme }
  for (const [k, v] of Object.entries(t)) el.style.setProperty('--' + k, v)
  el.style.setProperty('--x', Math.round(at.x) + 'px'); el.style.setProperty('--y', Math.round(at.y) + 'px')
  el.innerHTML = streetSVG(data, opts)
  container.appendChild(el)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')))
  return {
    el,
    close() {
      return new Promise(done => { el.classList.remove('on'); el.classList.add('off'); setTimeout(() => { el.remove(); done() }, 650) })
    },
  }
}
