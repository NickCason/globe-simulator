// A hand-drawn globe: chunky stepped relief, ink contours and coastlines, water-lining like an old map, hatched
// shadows, and lines that "boil" a little as if redrawn by hand. three.js draws the world; pins, routes and soft
// "somewhere around here" glows are drawn on top (DOM and a 2D canvas), so they stay crisp and easy to style.
import {
  ClampToEdgeWrapping, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, Matrix3, Mesh, NearestFilter, PerspectiveCamera,
  RGBAFormat, RepeatWrapping, Scene, ShaderMaterial, SphereGeometry, Texture, Vector3, WebGLRenderer,
} from 'three'

const D2R = Math.PI / 180
export const DEFAULTS = {
  exaggeration: 0.062,   // tallest ground as a share of the radius (Earth's real relief is about 0.14%)
  levels: 8,             // land terraces
  hatch: true,           // shade with pen strokes
  waterlines: true,      // ripples along the coasts
  graticule: true,       // lines of latitude and longitude
  boil: true,            // redraw the lines' wobble ~7 times a second
  spin: true,            // drift slowly until touched
  fitRatio: 0.43,        // the whole world fills this share of the shorter side
  segments: 576,         // sphere detail (east-west); half that north-south
  calm: false,           // no motion: flights jump, nothing boils or spins
  light: [-0.38, 0.46, 0.80],
  wobble: 1,             // how loose the hand is: 0 draws clean lines
  grain: 1,              // paper tooth
  contours: true,        // ink lines at each terrace
  minDist: 1.3,          // the closest the camera comes; zooming in past it calls onDive
}
// Map layers drawn over the world (see setLayers). Each is independent and can be changed while it runs.
export const LAYERS = {
  countries: 'off',      // 'off' | 'borders' | 'fill' (fill draws the borders too)
  palette: 'political',  // 'political' | 'continents' | 'tint' | 'pastel'
  fill: 0.5,             // how strongly countries are coloured, 0-1
  borderWidth: 1.2,      // px
  borderAlpha: 0.75,
  borderDash: false,     // every border dashed (disputed ones always are)
  countryLabels: true,
  continentLabels: true,
  seaLabels: 'oceans',   // 'off' | 'oceans' | 'seas' (oceans, seas, gulfs, bays…)
  regionLabels: false,   // mountain ranges, deserts, plateaus, basins, island groups…
  rivers: false,
  labelSize: 1,          // 0.7-1.6
  density: 0,            // -1 fewer labels … +2 more
}
const LIFT = 0.012       // pins and routes float this far above the ground

// Our sphere's frame, matching SphereGeometry's texture mapping (lon 0 on +x, north on +y).
export function ll(lat, lon, r = 1) {
  const phi = (lon + 180) * D2R, th = (90 - lat) * D2R
  return new Vector3(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r)
}
export function toLatLon(v) {
  const n = v.clone().normalize()
  return { lat: Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R, lon: wrap(Math.atan2(n.z, -n.x) / D2R - 180) }
}
export const wrap = a => ((((a + 180) % 360) + 360) % 360) - 180
export function distanceKm(a, b) {
  const x = Math.sin((b.lat - a.lat) * D2R / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin((b.lon - a.lon) * D2R / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(x))
}
// Great-circle points from a to b ({lat, lon}), lifted into an arc as high as the trip is long (lift 0 hugs the ground).
export function arc(a, b, n = 64, lift = 0.22, base = 1 + LIFT) {
  const A = ll(a.lat, a.lon), B = ll(b.lat, b.lon), ang = A.angleTo(B), out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = Math.sin(ang)
    const p = s < 1e-6 ? A.clone() : A.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(B.clone().multiplyScalar(Math.sin(t * ang) / s))
    out.push(p.normalize().multiplyScalar(base + Math.sin(Math.PI * t) * ang * lift))
  }
  return out
}

const VERT = /* glsl */`
uniform sampler2D uElev; uniform sampler2D uMask; uniform float uExag; uniform float uLevels;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vObj; varying vec3 vSphereN;
float terrain(vec2 uv) {
  float m = texture2D(uMask, uv).r, v = texture2D(uElev, uv).r;
  float land = clamp((v - 0.5) * 2.0, 0.0, 1.0), sea = clamp((0.5 - v) * 2.0, 0.0, 1.0);
  float h = m > 0.5 ? mix(land, floor(land * uLevels + 0.2) / uLevels, 0.72)        // soft steps: chunky, not blocky
                    : -floor(sea * 3.0 + 0.5) / 3.0 * 0.22;
  return h * smoothstep(0.0, 0.03, uv.y) * smoothstep(1.0, 0.97, uv.y);              // no spikes at the poles
}
void main() {
  vUv = uv; vObj = position;
  vec3 p = position * (1.0 + uExag * terrain(uv));
  vSphereN = normalize(mat3(modelMatrix) * position);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const FRAG = /* glsl */`
uniform sampler2D uElev; uniform sampler2D uMask; uniform sampler2D uCoast;
uniform vec3 uInk; uniform vec3 uLand; uniform vec3 uSea; uniform vec3 uCamPos; uniform vec3 uLight;
uniform float uLevels; uniform float uBoil; uniform float uPx; uniform float uDark; uniform float uReveal;
uniform float uHatchOn; uniform float uWaterOn; uniform float uGridOn; uniform mat3 uInvRot;
uniform sampler2D uIds; uniform sampler2D uPal; uniform float uFillOn; uniform float uWobble; uniform float uGrain; uniform float uContour;
varying vec2 vUv; varying vec3 vWorld; varying vec3 vObj; varying vec3 vSphereN;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float penW(float s, float fw, float w) {            // a pen line at every whole step of s (fw: how fast s changes per pixel)
  float d = abs(fract(s - 0.5) - 0.5) / max(fw, 1e-5);
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, d);
}
float pen(float s, float w) { return penW(s, fwidth(s), w); }   // w pixels wide
float strokes(vec3 dir, float px, float w, float wob) {   // parallel strokes ~6 px apart at any zoom
  float lv = log2(max(px, 1.0) / 6.0), f0 = exp2(floor(lv)), t = fract(lv);
  float s = dot(vObj, normalize(dir));
  return mix(pen(s * f0 + wob, w), pen(s * f0 * 2.0 + wob * 2.0, w), t);
}
float H(vec2 uv) { return clamp((texture2D(uElev, uv).r - 0.5) * 2.0, 0.0, 1.0); }
float level(float h) { return floor(h * uLevels + 0.2); }

void main() {
  vec3 V = normalize(uCamPos - vWorld), S = normalize(vSphereN);
  float lit = clamp(dot(S, normalize(uLight)), 0.0, 1.0);
  float rim = 1.0 - clamp(dot(S, V), 0.0, 1.0);

  float m = texture2D(uMask, vUv).r;
  float e = texture2D(uElev, vUv).r;
  float h = H(vUv), seaD = clamp((0.5 - e) * 2.0, 0.0, 1.0);
  float coast = texture2D(uCoast, vUv).r;
  float land = smoothstep(0.42, 0.58, m);
  vec2 q = vUv * vec2(160.0, 80.0);
  float wob = (noise(q + uBoil * 13.7) - 0.5) * uWobble, wob2 = (noise(q * 0.5 - uBoil * 7.9) - 0.5) * uWobble;

  // light from the north-west, as on printed maps: south-east slopes, and the ground just below a step, in shadow
  vec2 tx = vec2(1.0 / 1024.0, 1.0 / 512.0);
  float hx = H(vUv + vec2(tx.x, 0.0)) - H(vUv - vec2(tx.x, 0.0));
  float hy = H(vUv + vec2(0.0, tx.y)) - H(vUv - vec2(0.0, tx.y));
  float slope = clamp((hy - hx) * 6.0, 0.0, 1.0) * land;
  float lv = level(h);
  float under = step(lv + 0.5, level(H(vUv + vec2(-1.6, 1.6) * tx))) * land;

  vec3 col = mix(uSea, uLand, land);
  if (uFillOn > 0.5) {                                                    // countries, coloured from the palette
    vec4 pc = texture2D(uPal, vec2((texture2D(uIds, vUv).r * 255.0 + 0.5) / 256.0, 0.5));
    col = mix(col, pc.rgb, pc.a * land);
  }
  col = mix(col, uInk, (0.03 + 0.024 * lv) * land);                     // layer on layer, like cut card
  col = mix(col, uInk, 0.06 * floor(seaD * 3.0 + 0.5) / 3.0 * (1.0 - land));
  col = mix(col, uInk, 0.10 * under);

  float ink = 0.0;
  float cd = abs(m - 0.5) / max(fwidth(m), 1e-5);                         // the coast, drawn twice by a loose hand
  ink = max(ink, 1.0 - smoothstep(0.8, 1.9, cd + wob * 1.6));
  ink = max(ink, 0.45 * (1.0 - smoothstep(0.6, 1.5, abs(cd - 2.4 - wob2 * 2.0))));
  ink = max(ink, mix(0.32, 0.6, step(1.5, lv)) * pen(h * uLevels + 0.2 + wob2 * 0.1, 0.95) * land * step(0.03, h) * uContour);   // contours
  float ripple = pen(coast * 7.0 + wob * 0.3, 0.8) * (1.0 - smoothstep(0.1, 0.5, coast)) * (1.0 - land);
  ink = max(ink, 0.42 * ripple * uWaterOn);                                // water-lining

  float shade = clamp((1.0 - lit) * 1.15 + rim * 0.25 - 0.18, 0.0, 1.0);    // the globe's own shadow side
  shade = max(shade, max(slope * 0.55, under * 0.45));
  float hw = 0.8;
  float h1 = strokes(vec3(1.0, 0.85, 0.35), uPx, hw, wob * 0.4) * smoothstep(0.28, 0.40, shade);
  float h2 = strokes(vec3(-0.75, 1.0, 0.2), uPx, hw, wob2 * 0.4) * smoothstep(0.52, 0.66, shade);
  float h3 = strokes(vec3(0.2, 0.3, 1.0), uPx * 0.7, hw, wob * 0.4) * smoothstep(0.76, 0.9, shade);
  ink = max(ink, mix(0.38, 0.6, land) * max(h1, max(h2, h3)) * uHatchOn);
  col = mix(col, uInk, (1.0 - uHatchOn) * 0.22 * shade);                  // without strokes, a plain wash

  // The graticule, faintly, drawn where the line of sight meets the sea-level sphere: it runs on unbroken over the
  // (exaggerated) mountains instead of riding up and down them, which near the edge broke lines into offset pieces.
  vec3 rd = normalize(vWorld - uCamPos);
  float rb = dot(uCamPos, rd), disc = rb * rb - (dot(uCamPos, uCamPos) - 1.0);
  vec3 gp = uInvRot * (uCamPos + rd * (-rb - sqrt(max(disc, 0.0))));
  float lat = degrees(asin(clamp(gp.y, -1.0, 1.0))), glon = degrees(atan(gp.z, -gp.x));
  float flon = min(fwidth(glon), fwidth(mod(glon + 360.0, 360.0)));          // no false line where atan wraps
  float g = max(pen(lat / 15.0, 0.7), penW(glon / 15.0, flon / 15.0, 0.7) * step(abs(lat), 76.0)) * step(0.0, disc);
  ink = max(ink, 0.15 * g * (1.0 - land * 0.6) * uGridOn);
  ink = max(ink, smoothstep(0.82, 0.97, rim + wob * 0.05));               // the outline

  ink *= 1.0 - 0.18 * uWobble * (1.0 - noise(gl_FragCoord.xy * 0.45 + uBoil * 31.0));   // a pen that skips a little
  float unseen = smoothstep(uReveal * 1.3 - 0.3, uReveal * 1.3, rim + noise(q * 0.2) * 0.25);   // drawn from the middle out
  col = mix(col, uSea, unseen); ink *= 1.0 - unseen * (1.0 - smoothstep(0.82, 0.97, rim));
  float grain = (noise(gl_FragCoord.xy * 0.8) - 0.5) * 0.06 * uGrain;      // paper tooth
  col += grain * (uDark > 0.5 ? 1.0 : -1.0);
  gl_FragColor = vec4(mix(col, uInk, clamp(ink, 0.0, 1.0) * 0.9), 1.0);
}`

function loadImage(src) {
  return new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src })
}
function texture(image, mip) {
  const t = new Texture(image)
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping
  t.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter; t.magFilter = LinearFilter
  t.generateMipmaps = !!mip; t.anisotropy = 4; t.needsUpdate = true
  return t
}
function pixels(image) {
  const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(image, 0, 0)
  return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * create(el, { textures: {elev, mask, coast}, theme: {paper, ink, accent, dark}, onPick(pin), onTap({lat, lon}),
 *              onView(view), ...DEFAULTS }) -> a handle (see the end of this function)
 */
export async function create(el, options = {}) {
  const opt = { ...DEFAULTS, ...options }
  const { textures, onPick, onTap, onView } = opt
  const [iElev, iMask, iCoast] = await Promise.all([loadImage(textures.elev), loadImage(textures.mask), loadImage(textures.coast)])
  const E = pixels(iElev), M = pixels(iMask)
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.domElement.className = 'gl'
  const overlay = document.createElement('canvas'); overlay.className = 'ink'
  const pinLayer = document.createElement('div'); pinLayer.className = 'pins'
  el.append(renderer.domElement, overlay, pinLayer)
  const g2 = overlay.getContext('2d')

  const palette = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat)
  palette.minFilter = palette.magFilter = NearestFilter; palette.needsUpdate = true
  function blank() { const t = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat); t.needsUpdate = true; return t }
  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.01, 100)
  const uniforms = {
    uElev: { value: texture(iElev, false) }, uMask: { value: texture(iMask, true) }, uCoast: { value: texture(iCoast, true) },
    uExag: { value: opt.exaggeration }, uLevels: { value: opt.levels }, uBoil: { value: 0 }, uPx: { value: 200 }, uDark: { value: 0 },
    uReveal: { value: opt.calm ? 1 : 0 }, uHatchOn: { value: 1 }, uWaterOn: { value: 1 }, uGridOn: { value: 1 },
    uIds: { value: blank() }, uPal: { value: palette }, uFillOn: { value: 0 }, uWobble: { value: 1 }, uGrain: { value: 1 }, uContour: { value: 1 },
    uInk: { value: new Color() }, uLand: { value: new Color() }, uSea: { value: new Color() },
    uCamPos: { value: new Vector3() }, uLight: { value: new Vector3(...opt.light) }, uInvRot: { value: new Matrix3() },
  }
  const globe = new Mesh(new SphereGeometry(1, opt.segments, opt.segments / 2), new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }))
  scene.add(globe)
  renderer.compile(scene, camera)                      // build the shaders now, not on the first frame

  const view = { lat: 30, lon: -40, dist: 0 }
  let fit = 4, W = 1, H = 1, accent = '#B4532F', inkCss = '#2B231D', paperCss = '#F3E8D2'
  let pins = [], routes = [], spin = opt.spin && !opt.calm, vel = { lat: 0, lon: 0 }, flying = null, dragging = false, alive = true
  let boilT = 0, needs = true, ready = false
  let layers = { ...LAYERS }, mapData = null, lifted = null, water = '#4A7A96'   // map layers (see setLayers)

  function set(o) {                          // change the look while it runs
    Object.assign(opt, o)
    uniforms.uExag.value = opt.exaggeration; uniforms.uLevels.value = opt.levels
    uniforms.uHatchOn.value = opt.hatch ? 1 : 0; uniforms.uWaterOn.value = opt.waterlines ? 1 : 0; uniforms.uGridOn.value = opt.graticule ? 1 : 0
    uniforms.uWobble.value = opt.wobble; uniforms.uGrain.value = opt.grain; uniforms.uContour.value = opt.contours ? 1 : 0
    if (!opt.boil) uniforms.uBoil.value = 0
    if ('spin' in o) spin = o.spin && !opt.calm
    if ('exaggeration' in o || 'levels' in o) lifted = null           // map lines follow the ground: re-lift them
    needs = true
  }
  function setTheme(t) {
    const c = new Color(t.paper), ink = new Color(t.ink)
    uniforms.uInk.value.set(t.ink)
    uniforms.uLand.value.copy(c.clone().lerp(ink, t.dark ? 0.10 : 0.07))
    uniforms.uSea.value.copy(c.clone().lerp(new Color(t.dark ? '#000000' : '#FFFFFF'), t.dark ? 0.15 : 0.35))
    uniforms.uDark.value = t.dark ? 1 : 0
    accent = t.accent; inkCss = t.ink; paperCss = t.paper
    water = t.water || (t.dark ? '#7FB2CC' : '#3F6E8C')
    if (typeof paintPalette === 'function' && mapData) paintPalette()
    needs = true
  }
  setTheme(opt.theme || { paper: '#F3E8D2', ink: '#2B231D', accent: '#B4532F' })
  set({})

  // the height under a place, for pins: the same soft terraces the globe is drawn with
  function ground(lat, lon) {
    const u = (lon + 180) / 360, v = (90 - lat) / 180
    const ex = Math.min(E.w - 1, Math.max(0, Math.floor(u * E.w))), ey = Math.min(E.h - 1, Math.max(0, Math.floor(v * E.h)))
    const mx = Math.min(M.w - 1, Math.max(0, Math.floor(u * M.w))), my = Math.min(M.h - 1, Math.max(0, Math.floor(v * M.h)))
    const e = E.d[(ey * E.w + ex) * 4] / 255, m = M.d[(my * M.w + mx) * 4] / 255
    if (m <= 0.5) return 0
    const land = Math.max(0, Math.min(1, (e - 0.5) * 2))
    return (land + (Math.floor(land * opt.levels + 0.2) / opt.levels - land) * 0.72) * opt.exaggeration
  }

  function resize() {
    const r = el.getBoundingClientRect()
    W = Math.max(1, r.width); H = Math.max(1, r.height)
    renderer.setSize(W, H, false)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    overlay.width = W * dpr; overlay.height = H * dpr; g2.setTransform(dpr, 0, 0, dpr, 0, 0)
    camera.aspect = W / H; camera.updateProjectionMatrix()
    const alpha = Math.atan(opt.fitRatio * Math.min(W, H) * Math.tan(camera.fov * D2R / 2) / (H / 2))   // the whole world, with room
    const was = fit
    fit = 1 / Math.sin(alpha)
    if (!view.dist) view.dist = fit
    else if (was !== fit) view.dist = 1 + (view.dist - 1) * (fit - 1) / (was - 1)        // same zoom when the space changes size
    view.dist = Math.min(view.dist, fit * 1.25)
    needs = true
    if (ready && !paused) draw()          // now, not next frame: a resized canvas is blank until it's drawn again
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize()

  function place() {
    globe.rotation.set(view.lat * D2R, Math.PI / 2 - (view.lon + 180) * D2R, 0, 'XYZ')
    camera.position.set(0, 0, view.dist); camera.lookAt(0, 0, 0)
    uniforms.uCamPos.value.copy(camera.position)
    uniforms.uPx.value = (H / 2) / Math.tan(camera.fov * D2R / 2) / (view.dist - 1)    // px per unit at the nearest point
    globe.updateMatrixWorld()
    uniforms.uInvRot.value.setFromMatrix4(globe.matrixWorld).transpose()          // world -> globe (it only turns)
  }
  const tmp = new Vector3()
  function screen(v) {                       // object-space point -> {x, y, front}
    tmp.copy(v).applyMatrix4(globe.matrixWorld)
    const front = tmp.clone().normalize().dot(camera.position.clone().normalize())
    const p = tmp.clone().project(camera)
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, front, world: tmp.clone() }
  }
  function hidden(world) {                   // behind the globe, seen from the camera?
    const c = camera.position, d = world.clone().sub(c), len = d.length(); d.normalize()
    const b = c.dot(d), disc = b * b - (c.lengthSq() - 1.0)
    if (disc < 0) return false
    const t = -b - Math.sqrt(disc)
    return t > 0 && t < len - 1e-3
  }
  // the place under a point on the screen (client coordinates), or null off the globe
  function pickWorld(cx, cy) {
    const r = el.getBoundingClientRect()
    const ndc = new Vector3(((cx - r.left) / W) * 2 - 1, -((cy - r.top) / H) * 2 + 1, 0.5).unproject(camera)
    const dir = ndc.sub(camera.position).normalize(), c = camera.position
    const b = c.dot(dir), disc = b * b - (c.lengthSq() - 1.0)
    if (disc < 0) return null
    const world = c.clone().add(dir.multiplyScalar(-b - Math.sqrt(disc)))
    return { ...toLatLon(globe.worldToLocal(world.clone())), world }
  }
  function pick(cx, cy) { const h = pickWorld(cx, cy); return h && { lat: h.lat, lon: h.lon } }

  // ---- drawn on top: the sketched rim, soft glows, routes --------------------------------------------------------
  const jitter = seed => Math.sin(seed * 91.7 + boilT * 3.1) * 0.5
  function hexA(hex, a) { const c = new Color(hex); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})` }
  function drawOverlay() {
    g2.clearRect(0, 0, W, H)
    const cx = W / 2, cy = H / 2
    const R = (H / 2) * Math.tan(Math.asin(1 / view.dist)) / Math.tan(camera.fov * D2R / 2)
    g2.lineCap = 'round'; g2.strokeStyle = inkCss
    for (let k = 0; k < 2; k++) {            // two loose circles round the world, like a sketch's construction lines
      g2.globalAlpha = k ? 0.22 : 0.35; g2.lineWidth = k ? 1 : 1.4
      g2.beginPath()
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2, r = R * (1.035 + k * 0.025) + jitter(i + k * 7) * 1.6
        i ? g2.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g2.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      }
      g2.stroke()
    }
    g2.globalAlpha = 1
    drawLayers()
    for (const p of pins) {
      if (!p.glow || p.glowR <= 0.001) continue
      const c = screen(ll(p.lat, p.lon, 1 + opt.exaggeration * 0.5))
      if (c.front < 0.05) continue
      const edge = screen(ll(p.lat + p.glowR, p.lon, 1 + opt.exaggeration * 0.5))
      const r = Math.max(6, Math.hypot(edge.x - c.x, edge.y - c.y))
      const grad = g2.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
      grad.addColorStop(0, hexA(accent, 0.38)); grad.addColorStop(0.7, hexA(accent, 0.16)); grad.addColorStop(1, hexA(accent, 0))
      g2.globalAlpha = Math.min(1, c.front * 4)
      g2.fillStyle = grad; g2.beginPath(); g2.arc(c.x, c.y, r, 0, Math.PI * 2); g2.fill()
      g2.setLineDash([4, 5]); g2.lineWidth = 1.2; g2.strokeStyle = hexA(accent, 0.8)
      g2.beginPath(); g2.arc(c.x, c.y, r * 0.82 + jitter(p.lat) * 1.2, 0, Math.PI * 2); g2.stroke(); g2.setLineDash([])
    }
    g2.globalAlpha = 1
    for (const r of routes) {
      const n = Math.floor(r.pts.length * r.drawn)
      if (n < 2) continue
      g2.strokeStyle = r.color || accent; g2.lineWidth = r.width || 2.4; g2.setLineDash(r.dash || [])
      g2.beginPath()
      let down = false, head = null, prev = null
      for (let i = 0; i < n; i++) {
        const s = screen(r.pts[i])
        if (hidden(s.world)) { down = false; continue }
        const jx = jitter(i * 0.37 + r.seed) * 0.7, jy = jitter(i * 0.53 - r.seed) * 0.7
        down ? g2.lineTo(s.x + jx, s.y + jy) : g2.moveTo(s.x + jx, s.y + jy)
        down = true; head = s; if (i > 0) prev = screen(r.pts[i - 1])
      }
      g2.stroke(); g2.setLineDash([])
      if (head && prev && r.drawn < 1 && r.ship) {           // a little ship (or anything) rides the head of the line
        const a = Math.atan2(head.y - prev.y, head.x - prev.x)
        g2.save(); g2.translate(head.x, head.y); g2.rotate(a); g2.fillStyle = inkCss; g2.strokeStyle = paperCss; g2.lineWidth = 1.5
        g2.beginPath(); g2.moveTo(9, 0); g2.lineTo(-7, -4.5); g2.lineTo(-4, 0); g2.lineTo(-7, 4.5); g2.closePath()
        g2.stroke(); g2.fill(); g2.restore()
      }
    }
  }

  // ---- map layers: country fills (in the shader), borders, rivers and labels (drawn here) ------------------------
  const CONT = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America', 'Seven seas (open ocean)']
  const SCHEMES = {
    political: ['#E9C77F', '#C8D79C', '#E8A98A', '#A8C6D9', '#D7B3D3', '#F1D98A', '#B5D4BF'],
    continents: ['#E7B07A', '#DDE6EE', '#E9C77F', '#A8C6D9', '#C8A2C8', '#9CCB9B', '#E39A88', '#BBBBBB'],
  }
  function paintPalette() {
    const d = palette.image.data
    d.fill(0)
    if (mapData && layers.countries === 'fill') {
      const theme = new Color(accent), a = Math.round(Math.max(0, Math.min(1, layers.fill)) * 255)
      mapData.countries.forEach((c, i) => {
        const id = i + 1
        let col
        if (layers.palette === 'continents') col = new Color(SCHEMES.continents[Math.max(0, CONT.indexOf(c[2]))])
        else if (layers.palette === 'tint') col = theme
        else if (layers.palette === 'pastel') { let h = 0; for (const ch of c[0]) h = (h * 31 + ch.charCodeAt(0)) >>> 0; col = new Color().setHSL((h % 360) / 360, 0.55, 0.72) }
        else col = new Color(SCHEMES.political[(c[4] - 1) % 7])
        d.set([Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255), a], id * 4)
      })
    }
    palette.needsUpdate = true
    uniforms.uFillOn.value = mapData && layers.countries === 'fill' ? 1 : 0
  }
  function setOverlay(data, idsImage) {
    mapData = data
    const t = new Texture(idsImage); t.minFilter = t.magFilter = NearestFilter; t.generateMipmaps = false
    t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true
    uniforms.uIds.value = t
    lifted = null; paintPalette(); needs = true
  }
  function setLayers(o) { layers = { ...layers, ...o }; paintPalette(); needs = true }
  function lift() {                          // every line and label, as points on (just above) the ground
    const line = (flat, up) => {
      const out = new Float32Array(flat.length / 2 * 3)
      for (let i = 0, j = 0; i < flat.length; i += 2, j += 3) {
        const v = ll(flat[i + 1], flat[i], 1 + ground(flat[i + 1], flat[i]) + up)
        out[j] = v.x; out[j + 1] = v.y; out[j + 2] = v.z
      }
      return out
    }
    const at = (lat, lon) => ll(lat, lon, 1 + ground(lat, lon) + 0.004)
    const labels = []
    for (const [n, lat, lon] of mapData.continents) labels.push({ t: n.toUpperCase(), kind: 'continent', min: 0, max: 2.7, v: at(lat, lon), pri: 0 })
    for (const [n, cls, rank, min, lat, lon] of mapData.marine) {
      const ocean = cls === 'ocean'
      labels.push({ t: ocean ? n.toUpperCase() : n, kind: ocean ? 'ocean' : 'sea', min: ocean ? 0 : Math.max(1.8, min), v: at(lat, lon), pri: ocean ? 1 : 3 + rank })
    }
    for (const c of mapData.countries) labels.push({ t: c[0].toUpperCase(), kind: 'country', min: Math.max(1.4, c[9]), v: at(c[7], c[8]), pri: 2 + c[6] / 10, rank: c[6] })
    for (const [n, cls, rank, min, lat, lon] of mapData.regions) labels.push({ t: n, kind: 'region', min: Math.max(2.4, min), v: at(lat, lon), pri: 5 + rank, cls })
    labels.sort((a, b) => a.pri - b.pri)
    lifted = { borders: mapData.borders.map(([kind, flat]) => ({ kind, p: line(flat, 0.003) })),
               rivers: mapData.rivers.map(([n, min, flat]) => ({ min, p: line(flat, 0.002) })), labels }
  }
  function drawLayers() {
    if (!mapData) return
    const showBorders = layers.countries !== 'off', anyLabels = layers.countryLabels || layers.continentLabels || layers.seaLabels !== 'off' || layers.regionLabels
    if (!showBorders && !layers.rivers && !anyLabels) return
    if (!lifted) lift()
    const e = new Float32Array(16)
    const M = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(globe.matrixWorld).elements
    const R = globe.matrixWorld.elements
    const zl = 1 + Math.log2(Math.max(0.05, (fit - 1) / (view.dist - 1)))       // 1 = the whole world; ~5 = closest
    const wob = opt.wobble
    const strokeLines = (list, test) => {
      for (const ln of list) {
        if (test && !test(ln)) continue
        const p = ln.p; let down = false
        g2.beginPath()
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2]
          const front = (R[2] * x + R[6] * y + R[10] * z)
          if (front < 0.02) { down = false; continue }
          const w = M[3] * x + M[7] * y + M[11] * z + M[15]
          const sx = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w + 1) / 2 * W, sy = (1 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / w) / 2 * H
          const j = wob ? jitter(i * 0.13) * 0.6 * wob : 0
          down ? g2.lineTo(sx + j, sy - j) : g2.moveTo(sx + j, sy - j); down = true
        }
        g2.stroke()
      }
    }
    g2.lineCap = 'round'; g2.lineJoin = 'round'
    if (layers.rivers) {
      g2.strokeStyle = water; g2.globalAlpha = 0.75; g2.lineWidth = 1.1
      strokeLines(lifted.rivers, r => r.min <= zl + 3 + layers.density)
    }
    if (showBorders) {
      g2.strokeStyle = inkCss; g2.globalAlpha = layers.borderAlpha; g2.lineWidth = layers.borderWidth
      g2.setLineDash(layers.borderDash ? [5, 4] : []); strokeLines(lifted.borders, b => b.kind === 0)
      g2.setLineDash([3, 4]); strokeLines(lifted.borders, b => b.kind === 1); g2.setLineDash([])
    }
    g2.globalAlpha = 1
    if (!anyLabels) return
    // labels grow with the globe: about half size when the whole world fits on a phone, full size once you're closer
    const Rpx = (H / 2) * Math.tan(Math.asin(Math.min(1, 1 / view.dist))) / Math.tan(camera.fov * D2R / 2)
    const placed = [...pinBoxes], zs = Math.max(0.5, Math.min(1, Rpx / 330)), k = layers.labelSize * zs   // pins and their tags first
    const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', SANS = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif'
    for (const L of lifted.labels) {
      if (L.kind === 'continent' && (!layers.continentLabels || zl > L.max)) continue
      if (L.kind === 'country' && !layers.countryLabels) continue
      if ((L.kind === 'ocean' && layers.seaLabels === 'off') || (L.kind === 'sea' && layers.seaLabels !== 'seas')) continue
      if (L.kind === 'region' && !layers.regionLabels) continue
      if (L.min > zl + 0.6 + layers.density) continue
      const v = L.v, front = R[2] * v.x + R[6] * v.y + R[10] * v.z
      if (front < 0.3) continue
      const w = M[3] * v.x + M[7] * v.y + M[11] * v.z + M[15]
      const x = ((M[0] * v.x + M[4] * v.y + M[8] * v.z + M[12]) / w + 1) / 2 * W, y = (1 - (M[1] * v.x + M[5] * v.y + M[9] * v.z + M[13]) / w) / 2 * H
      let font, color = inkCss, spacing = '0px', alpha = Math.min(1, (front - 0.3) * 5)
      if (L.kind === 'continent') { font = `600 ${15 * k}px ${SANS}`; spacing = `${4 * k}px`; alpha *= 0.55 * Math.min(1, (L.max - zl) * 2) }
      else if (L.kind === 'ocean') { font = `italic ${15 * k}px ${SERIF}`; color = water; spacing = `${3 * k}px` }
      else if (L.kind === 'sea') { font = `italic ${12 * k}px ${SERIF}`; color = water }
      else if (L.kind === 'country') { font = `650 ${(L.rank <= 2 ? 12 : L.rank <= 4 ? 11 : 10) * k}px ${SANS}`; spacing = `${1 * k}px` }
      else { font = `italic ${11 * k}px ${SERIF}`; color = inkCss; alpha *= 0.75 }
      g2.font = font; if ('letterSpacing' in g2) g2.letterSpacing = spacing
      const tw = g2.measureText(L.t).width, th = parseFloat(font.match(/(\d+(\.\d+)?)px/)[1])
      const box = [x - tw / 2 - 3, y - th / 2 - 2, x + tw / 2 + 3, y + th / 2 + 2]
      if (placed.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue
      placed.push(box)
      g2.globalAlpha = alpha; g2.textAlign = 'center'; g2.textBaseline = 'middle'
      g2.lineWidth = 3.5 * zs; g2.strokeStyle = paperCss; g2.strokeText(L.t, x, y); g2.fillStyle = color; g2.fillText(L.t, x, y)
    }
    g2.globalAlpha = 1; if ('letterSpacing' in g2) g2.letterSpacing = '0px'
  }

  // ---- pins: DOM buttons, so they can be tapped and styled with CSS -----------------------------------------------
  // a pin: {id, lat, lon, label, prec: 'address'|'street'|'town'|'county'|'state'|'country', glow, glowR (degrees), always}
  const measure = document.createElement('canvas').getContext('2d')
  let pinBoxes = []
  function setPins(list) {
    pinLayer.innerHTML = ''
    measure.font = '600 11.5px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif'
    pins = list.map(p => {
      const node = document.createElement('button')
      node.className = `gpin ${p.prec || 'town'}${p.blank ? ' blank' : ''}`
      node.innerHTML = p.prec === 'address' || p.prec === 'street'
        ? `<svg viewBox="0 0 24 32" width="24" height="32"><path d="M12 31c-1-6-10-12-10-19a10 10 0 0 1 20 0c0 7-9 13-10 19z"/><circle cx="12" cy="12" r="3.6"/></svg><b></b><span>${p.label || ''}</span>`
        : p.glow ? `<span>${p.label || ''}</span>` : `<i></i><b></b><span>${p.label || ''}</span>`
      const pin = { ...p, node, tagW: measure.measureText(p.label || '').width + 16 }
      node.addEventListener('click', e => { e.stopPropagation(); onPick && onPick(pin, pin.members) })
      pinLayer.appendChild(node)
      return pin
    })
    needs = true
  }
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  const tall = p => p.prec === 'address' || p.prec === 'street'
  const markBox = p => tall(p) ? [p.s.x - 12, p.s.y - (p.members ? 40 : 32), p.s.x + (p.members ? 28 : 12), p.s.y + 2]
    : [p.s.x - 8, p.s.y - (p.members ? 18 : 8), p.s.x + (p.members ? 26 : 8), p.s.y + 8]
  function layoutPins() {
    const vis = []
    for (const p of pins) {
      p.s = screen(ll(p.lat, p.lon, 1 + ground(p.lat, p.lon) + LIFT))
      p.shown = p.s.front > 0.08 && !(hold?.active && hold.lens && Math.hypot(p.s.x - hold.lens.x, p.s.y - hold.lens.y) < hold.lens.r + 24)
      p.members = null; p.merged = false; p.tag = false
      if (p.shown) vis.push(p)
    }
    const rank = p => (p.sel ? 0 : 2) + (tall(p) ? 0 : 1) + (p.glow ? 4 : 0)
    vis.sort((a, b) => rank(a) - rank(b))
    const leads = []
    for (const p of vis) {                          // too close to tap apart: one pin, with a count
      const lead = !p.glow && leads.find(q => !q.glow && Math.hypot(q.s.x - p.s.x, q.s.y - p.s.y) < 22)
      if (lead) { (lead.members ||= [lead]).push(p); p.merged = true } else leads.push(p)
    }
    pinBoxes = leads.filter(p => !p.glow).map(markBox)
    const near = view.dist < fit * 0.42
    for (const p of leads) {                        // name tags, most important first; never on top of another tag or pin
      if (!(p.sel || p.always || near || p.glow)) continue
      const top = p.glow ? -9 : tall(p) ? 5 : 10
      const box = [p.s.x - p.tagW / 2, p.s.y + top, p.s.x + p.tagW / 2, p.s.y + top + 19]
      if (!p.sel && pinBoxes.some(b => overlaps(b, box))) continue    // the chosen pin's name always shows; the rest make way
      p.tag = true; pinBoxes.push(box)
    }
  }
  function applyPins() {
    for (const p of pins) {
      const show = p.shown && !p.merged
      p.node.style.opacity = show ? Math.min(1, (p.s.front - 0.08) * 6) : 0
      p.node.style.pointerEvents = show ? '' : 'none'
      p.node.style.transform = `translate(${p.s.x}px, ${p.s.y}px)`
      p.node.classList.toggle('near', p.tag)
      const b = p.node.querySelector('b'); if (b) b.textContent = p.members ? p.members.length : ''
    }
  }

  // ---- the lens: press and hold, and a magnified view of the spot under your finger follows it --------------------
  const MAG = 4, LENS = 132
  const cam2 = new PerspectiveCamera(30, 1, 0.01, 100)
  const lensEl = document.createElement('div'); lensEl.className = 'lens'
  lensEl.innerHTML = '<div class="glass"><canvas></canvas><i></i></div><span></span>'
  el.appendChild(lensEl)
  const lensCv = lensEl.querySelector('canvas'), lensG = lensCv.getContext('2d')
  let hold = null
  function drawLens() {                            // render the zoomed view into a corner, copy it out, then the real frame
    const h = pickWorld(hold.x, hold.y)
    if (!h) { lensEl.classList.remove('on'); hold.at = null; return }
    hold.at = h
    const r = el.getBoundingClientRect(), dpr = renderer.getPixelRatio()
    let x = hold.x - r.left, y = hold.y - r.top - 120
    if (y < LENS / 2 + 8) { y = hold.y - r.top; x += x > W / 2 ? -120 : 120 }   // no room above the finger: beside it
    x = Math.max(LENS / 2 + 8, Math.min(W - LENS / 2 - 8, x)); y = Math.max(LENS / 2 + 8, Math.min(H - LENS / 2 - 30, y))
    hold.lens = { x, y, r: LENS / 2 }
    cam2.position.copy(camera.position); cam2.up.set(0, 1, 0); cam2.fov = camera.fov / MAG; cam2.aspect = 1
    cam2.updateProjectionMatrix(); cam2.lookAt(h.world)
    renderer.setScissorTest(true); renderer.setScissor(0, H - LENS, LENS, LENS); renderer.setViewport(0, H - LENS, LENS, LENS)
    renderer.setClearColor(paperCss, 1); renderer.clear()
    const px = uniforms.uPx.value; uniforms.uPx.value = px * MAG
    renderer.autoClear = false; renderer.render(scene, cam2); renderer.autoClear = true
    uniforms.uPx.value = px
    const n = Math.round(LENS * dpr)
    if (lensCv.width !== n) { lensCv.width = lensCv.height = n }
    lensG.drawImage(renderer.domElement, 0, 0, n, n, 0, 0, n, n)
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(0x000000, 0)
    lensEl.style.transform = `translate(${x - LENS / 2}px, ${y - LENS / 2}px)`
    lensEl.classList.add('on')
  }

  // ---- motion: idle drift, inertia, flights, routes -------------------------------------------------------------
  let last = performance.now(), born = opt.deferReveal ? 0 : last, revealMs = 1500
  let paused = false, spinning = null, drawnFirst
  const drawn = new Promise(r => { drawnFirst = r })
  const settleEase = t => 1 - Math.pow(1 - t, 3)
  function frame(now) {
    if (!alive) return
    if (paused) { requestAnimationFrame(frame); return }
    const dt = Math.min(50, now - last); last = now
    if (spinning) {                                     // spinning in, and coming gently to rest
      const s2 = spinning, t = Math.min(1, (now - s2.t0) / s2.ms), q = settleEase(t)
      view.lon = wrap(s2.to.lon + s2.turns * 360 * (1 - q))
      view.lat = s2.from.lat + (s2.to.lat - s2.from.lat) * q
      view.dist = fit * (s2.from.k + (s2.to.k - s2.from.k) * q)
      needs = true
      if (t >= 1) { spinning = null; s2.done() }
    } else if (flying) {
      const f = flying, t = Math.min(1, (now - f.t0) / f.ms), k = ease(t)
      view.lat = f.a.lat + (f.b.lat - f.a.lat) * k
      view.lon = wrap(f.a.lon + wrap(f.b.lon - f.a.lon) * k)
      view.dist = f.a.dist + (f.b.dist - f.a.dist) * k + f.hop * Math.sin(Math.PI * t)
      needs = true
      if (t >= 1) { flying = null; f.done() }
    } else if (!dragging && (Math.abs(vel.lat) > 0.002 || Math.abs(vel.lon) > 0.002)) {
      view.lat = Math.max(-75, Math.min(75, view.lat + vel.lat)); view.lon = wrap(view.lon + vel.lon)
      vel.lat *= 0.93; vel.lon *= 0.93; needs = true
    } else if (spin && !dragging) {
      view.lon = wrap(view.lon - dt * 0.004); needs = true
    }
    for (const r of routes) if (r.anim) {
      const t = Math.min(1, (now - r.t0) / r.ms); r.drawn = t
      if (r.follow) {                                   // the camera rides along with the line's head
        const i = Math.min(r.pts.length - 1, Math.floor(t * (r.pts.length - 1)))
        Object.assign(view, toLatLon(r.pts[i]))
      }
      needs = true
      if (t >= 1) { r.anim = false; r.done && r.done() }
    }
    if (uniforms.uReveal.value < 1 && born) { uniforms.uReveal.value = Math.max(0, Math.min(1, (now - born) / revealMs)); needs = true }
    const step = Math.floor(now / 140)                   // the lines boil, about seven times a second
    if (opt.boil && !opt.calm && step !== boilT) { boilT = step; uniforms.uBoil.value = (step % 97) / 97; needs = true }
    if (needs || hold?.active) draw()
    requestAnimationFrame(frame)
  }
  function draw() {
    place()
    if (hold?.active) drawLens()
    renderer.render(scene, camera); layoutPins(); drawOverlay(); applyPins(); needs = false
    drawnFirst()
    onView && onView({ ...view, fit })
  }
  ready = true
  requestAnimationFrame(frame)

  function flyTo(to, ms = 1600) {
    spin = false; vel = { lat: 0, lon: 0 }
    const b = { lat: to.lat ?? view.lat, lon: to.lon ?? view.lon, dist: to.dist ?? view.dist }
    if (opt.calm) { Object.assign(view, b); needs = true; return Promise.resolve() }
    const a = { ...view }, far = Math.hypot(b.lat - a.lat, wrap(b.lon - a.lon))
    return new Promise(done => { flying = { a, b, ms, t0: performance.now(), hop: Math.min(1.4, far / 90) * (b.dist < 2 ? 1 : 0.4), done } })
  }
  function route(points, { ms = 4200, follow = true, dash, ship = false, lift = 0.22, color, width } = {}) {
    spin = false
    let pts = []
    for (let i = 1; i < points.length; i++) {
      pts = pts.concat(arc(points[i - 1], points[i], 64, lift, 1 + LIFT + (lift ? opt.exaggeration * 0.6 : 0)).slice(i > 1 ? 1 : 0))
    }
    const r = { pts, drawn: opt.calm ? 1 : 0, anim: !opt.calm, t0: performance.now(), ms, follow, dash, ship, color, width, seed: Math.random() * 10 }
    routes.push(r); needs = true
    return new Promise(done => { r.done = done; if (opt.calm) done() })
  }
  function clearRoutes() { routes = []; needs = true }
  // A vague place becomes a precise one (or a smaller area): the glow gathers in, and the pin moves to where it belongs.
  function settle(id, to, ms = 900) {
    const p = pins.find(x => x.id === id); if (!p) return Promise.resolve()
    const t0 = performance.now(), from = { lat: p.lat, lon: p.lon, r: p.glowR || 0 }
    return new Promise(done => {
      const step = now => {
        const t = opt.calm ? 1 : Math.min(1, (now - t0) / ms), k = ease(t)
        p.lat = from.lat + (to.lat - from.lat) * k; p.lon = from.lon + (to.lon - from.lon) * k
        p.glowR = from.r + ((to.glowR ?? 0) - from.r) * k; needs = true
        if (t < 1) requestAnimationFrame(step); else { p.glow = !!to.glow; Object.assign(p, to); done() }
      }
      requestAnimationFrame(step)
    })
  }

  // ---- hands: drag to turn (with a throw), pinch or wheel to zoom, tap to ask where ----------------------------
  const pts = new Map(); let pinch0 = null, lastMove = null, downAt = null, press = 0
  const k = () => 0.18 * (view.dist - 1) / 1.6
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.gpin')) return
    el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY])
    if (spinning) { const d = spinning.done; spinning = null; d() }
    dragging = true; spin = false; flying = null; vel = { lat: 0, lon: 0 }; lastMove = [e.clientX, e.clientY, performance.now()]
    downAt = pts.size === 1 ? [e.clientX, e.clientY, performance.now()] : null
    if (hold?.active) { lensEl.classList.remove('on'); needs = true }
    clearTimeout(hold?.timer); hold = null
    if (pts.size === 1 && opt.onHoldEnd) {
      hold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        if (!hold) return
        hold.active = true; dragging = false; vel = { lat: 0, lon: 0 }; needs = true
        navigator.vibrate?.(12)
        const at = pick(hold.x, hold.y); opt.onHold && opt.onHold(at)
      }, 430) }
    }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: view.dist } }
  })
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return
    if (hold?.active) {                                  // holding: the finger moves the lens, not the world
      hold.x = e.clientX; hold.y = e.clientY; needs = true
      const at = pick(hold.x, hold.y); opt.onHoldMove && at && opt.onHoldMove(at)
      return
    }
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) { clearTimeout(hold.timer); hold = null }
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY])
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()]
      const want = pinch0.dist * pinch0.d / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1]))
      if (want < opt.minDist * 0.93 && opt.onDive) { pts.clear(); pinch0 = null; dragging = false; return opt.onDive({ lat: view.lat, lon: view.lon }) }
      view.dist = Math.max(opt.minDist, Math.min(fit * 1.25, want))
    } else {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]
      view.lon = wrap(view.lon - dx * k()); view.lat = Math.max(-75, Math.min(75, view.lat + dy * k()))
      const now = performance.now(), dtm = Math.max(8, now - lastMove[2])
      vel = { lon: -(e.clientX - lastMove[0]) * k() * 16 / dtm, lat: (e.clientY - lastMove[1]) * k() * 16 / dtm }
      lastMove = [e.clientX, e.clientY, now]
    }
    needs = true
  })
  const up = e => {
    if (hold?.active) {
      const at = hold.at ? { lat: hold.at.lat, lon: hold.at.lon } : null
      hold = null; pts.delete(e.pointerId); dragging = false; downAt = null
      lensEl.classList.remove('on'); needs = true
      if (e.type === 'pointerup' && at) opt.onHoldEnd(at)
      return
    }
    clearTimeout(hold?.timer); hold = null
    const was = pts.get(e.pointerId); pts.delete(e.pointerId)
    if (pts.size < 2) pinch0 = null
    if (!pts.size) dragging = false
    if (e.type === 'pointerup' && downAt && was && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6 && performance.now() - downAt[2] < 350) {
      vel = { lat: 0, lon: 0 }
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
      let best = null, bd = 24
      for (const p of pins) {
        if (!p.shown || p.merged || p.glow) continue
        const d = Math.hypot(p.s.x - x, p.s.y - (tall(p) ? 16 : 0) - y)
        if (d < bd) { bd = d; best = p }
      }
      if (best) onPick && onPick(best, best.members)
      else { const at = pick(e.clientX, e.clientY); if (at && onTap) onTap(at) }
    }
    downAt = null
  }
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  el.addEventListener('wheel', e => {
    e.preventDefault(); spin = false
    if (e.deltaY < 0 && view.dist <= opt.minDist * 1.005 && opt.onDive) { if (++press >= 3) { press = 0; opt.onDive({ lat: view.lat, lon: view.lon }) } return }
    press = 0
    view.dist = Math.max(opt.minDist, Math.min(fit * 1.25, view.dist * (e.deltaY > 0 ? 1.08 : 0.93))); needs = true
  }, { passive: false })

  return {
    set, setTheme, setPins, flyTo, route, clearRoutes, settle, pick, setOverlay, setLayers,
    layers: () => ({ ...layers }),
    pause() { paused = true }, resume() { paused = false; needs = true },
    drawn: () => drawn,                               // resolves once the first frame is on screen
    setLensLabel(text) { lensEl.querySelector('span').textContent = text || '' },
    // spin in from turns of a revolution away, settling at the view asked for
    spinDown({ lat = view.lat, lon = view.lon, dist = view.dist, turns = 0.2, ms = 3000, fromLat = lat + 10, fromDist = dist * 1.2 } = {}) {
      spin = false; vel = { lat: 0, lon: 0 }; flying = null
      if (opt.calm) { Object.assign(view, { lat, lon, dist }); needs = true; return Promise.resolve() }
      return new Promise(done => {
        spinning = { t0: performance.now(), ms, turns, to: { lat, lon, k: dist / fit }, from: { lat: fromLat, k: fromDist / fit }, done }
        Object.assign(view, { lat: fromLat, lon: wrap(lon + turns * 360), dist: fromDist }); needs = true
      })
    },
    // the drawing-in, from the middle out (with deferReveal it waits for this)
    reveal(ms = 1500) { born = performance.now(); revealMs = ms; uniforms.uReveal.value = opt.calm ? 1 : 0; needs = true },
    // the globe's radius on screen at a distance, and the distance for a radius (px)
    radiusAt: d => (H / 2) * Math.tan(Math.asin(1 / d)) / Math.tan(camera.fov * D2R / 2),
    distFor: px => 1 / Math.sin(Math.atan(px * Math.tan(camera.fov * D2R / 2) / (H / 2))),
    jump(v) { Object.assign(view, v); flying = null; vel = { lat: 0, lon: 0 }; needs = true },
    pins: () => pins, view: () => ({ ...view }), fit: () => fit, options: () => ({ ...opt }),
    land: (lat, lon) => {                             // is there land at a point (the coast mask)?
      const mx = Math.min(M.w - 1, Math.max(0, Math.floor((lon + 180) / 360 * M.w))), my = Math.min(M.h - 1, Math.max(0, Math.floor((90 - lat) / 180 * M.h)))
      return M.d[(my * M.w + mx) * 4] > 127
    },
    where: (lat, lon) => { const s = screen(ll(lat, lon, 1 + ground(lat, lon) + LIFT)); return { x: s.x, y: s.y, front: s.front } },
    select(id) { for (const p of pins) { p.sel = p.id === id; p.node.classList.toggle('sel', p.sel) } needs = true },
    spin(on) { spin = on && !opt.calm },
    dispose() {
      alive = false; ro.disconnect(); globe.geometry.dispose(); globe.material.dispose()
      for (const u of ['uElev', 'uMask', 'uCoast']) uniforms[u].value.dispose()
      renderer.dispose(); renderer.forceContextLoss(); el.innerHTML = ''
    },
  }
}
