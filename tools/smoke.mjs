// A walk through the app in a real browser (Playwright + Chromium with software WebGL): makes places, writes, adds
// photos, reads the journal, finds a country, changes the ink, draws streets from a cached map, and checks a backup
// round-trips. Screenshots go to shots/. Fails on any page error.   Run: npm run build && npm run smoke
// The street tiles come from a saved fixture; "read about it" reads the live open web (Wikipedia, Open-Meteo…).
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'

const PORT = 5199, URL_ = `http://127.0.0.1:${PORT}/`
mkdirSync('shots', { recursive: true })
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < 60; i++) { try { await fetch(URL_); break } catch { await sleep(250) } }

const errors = []
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true,
                                       geolocation: { latitude: 48.8584, longitude: 2.2945 }, permissions: ['geolocation'] })
// street tiles: the saved Toledo tile answers every request, so the walk needs no network
const TILE = readFileSync('test/fixtures/toledo-14-4389-6102.pbf')
await ctx.route('https://tiles.openfreemap.org/**', route => route.request().url().endsWith('/planet')
  ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'] }) })
  : route.fulfill({ contentType: 'application/vnd.mapbox-vector-tile', body: TILE }))
const pg = await ctx.newPage()
pg.on('pageerror', e => errors.push('pageerror: ' + e.message))
pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
const shot = n => pg.screenshot({ path: `shots/${n}.png` })
const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(`${name}: ${e.message.split('\n').slice(0, 4).join(' | ')}`) } }
const count = () => pg.evaluate(() => new Promise(ok => { const r = indexedDB.open('globe-journal'); r.onsuccess = () => {
  const t = r.result.transaction(['places', 'entries'], 'readonly'); const a = t.objectStore('places').count(), b = t.objectStore('entries').count()
  t.oncomplete = () => ok([a.result, b.result]) } }))

await pg.goto(URL_); await pg.waitForTimeout(700)
await shot('00-splash')
await step('the splash hands over', async () => {
  await pg.waitForSelector('#splash', { state: 'detached', timeout: 25000 })
  await pg.waitForSelector('text=Start', { timeout: 10000 })
})
await shot('01-start')
await step('start', () => pg.click('text=Start'))
await pg.waitForTimeout(1500)
await step('tap a spot', async () => { await pg.mouse.click(195, 380); await pg.waitForTimeout(1500); await shot('02-spot'); await pg.click('text=Make it a place') })
await pg.waitForTimeout(1200); await shot('03-place')
await step('write a note', async () => {
  await pg.click('[data-act=newEntry][data-kind=note]'); await pg.fill('#fText', 'Read about this coast: the fishermen dry squid on the rooftops in spring.')
  await pg.fill('#fTags', 'coast, food'); await pg.click('text=Save'); await pg.waitForTimeout(900)
})
await shot('04-note')
await step('a photo that knows where it was taken', async () => {
  await pg.click('[data-act=close]').catch(() => {})
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.setInputFiles('#pickPhotos', 'test/fixtures/kyoto.jpg'); await pg.waitForTimeout(2500)
  await pg.fill('#fText', 'Morning at the shrine, before the crowds.'); await shot('05-kyoto-editor'); await pg.click('text=Save'); await pg.waitForTimeout(1500)
})
await shot('06-kyoto')
await step('a photo that doesn’t', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.setInputFiles('#pickPhotos', 'test/fixtures/plain.jpg'); await pg.waitForTimeout(1500)
  await shot('07-where'); await pg.click('text=Look it up'); await pg.fill('#fq', 'reykjav'); await pg.waitForTimeout(1500)
  await pg.click('.res >> nth=0'); await pg.waitForTimeout(2200); await pg.click('text=Save'); await pg.waitForTimeout(1200)
})
await step('press and hold for an exact spot', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.mouse.move(150, 330); await pg.mouse.down(); await pg.waitForTimeout(900)
  await pg.mouse.move(160, 340, { steps: 4 }); await pg.waitForTimeout(500)
  if (!(await pg.locator('.lens.on').count())) throw new Error('no lens while holding')
  await shot('07b-lens')
  await pg.mouse.up(); await pg.waitForTimeout(1000)
  const eyebrow = await pg.locator('#sheet.on .eyebrow').first().innerText()
  if (!/right here/i.test(eyebrow)) throw new Error('holding should offer the exact spot, got ' + eyebrow)
  await shot('07c-held'); await pg.click('text=Make it a place'); await pg.waitForTimeout(800)
})
await step('here', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('[data-do=here]'); await pg.waitForTimeout(2600); await shot('08-here')
  await pg.click('text=Make it a place'); await pg.waitForTimeout(800)
})
await step('the journal', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('[data-do=journal]'); await pg.waitForTimeout(900); await shot('09-journal')
  await pg.click('[data-act=jfilter][data-f=photo]'); await pg.waitForTimeout(500)
  await pg.click('.entry >> nth=0'); await pg.waitForTimeout(1500); await shot('10-entry')
})
await step('find a country', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('[data-do=find]'); await pg.waitForTimeout(300); await pg.fill('#fq', 'lond'); await pg.waitForTimeout(500); await shot('11a-search')
  await pg.fill('#fq', '48.8566, 2.3522'); await pg.waitForTimeout(300); await shot('11b-coords')
  if (!/48\.857°N/.test(await pg.locator('.res >> nth=0').innerText())) throw new Error('coordinates should be a result')
  await pg.fill('#fq', 'japan'); await pg.waitForTimeout(600); await pg.click('.res[data-kind=country] >> nth=0'); await pg.waitForTimeout(2200)
  await pg.click('text=Make it a place'); await pg.waitForTimeout(1500)
  await shot('11-area')
})
await step('down to the streets and back', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300)
  await pg.click('[data-do=find]'); await pg.fill('#fq', 'toledo'); await pg.waitForTimeout(900)
  await pg.locator('.res[data-kind=town]').filter({ hasText: 'Ohio' }).first().click(); await pg.waitForTimeout(2200)
  await pg.click('[data-act=streets]'); await pg.waitForTimeout(6000); await shot('12-streets')
  if (!(await pg.locator('.street canvas').count())) throw new Error('no street map')
  await pg.mouse.click(200, 420); await pg.waitForTimeout(1200)
  const name = await pg.locator('#sheet.on h2').innerText()
  if (!/^(\d+\S* |On )/.test(name)) throw new Error('a street-level place should be named by its address, got ' + name)
  await pg.click('text=Make it a place'); await pg.waitForTimeout(900); await shot('12b-street-place')
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('#globeback'); await pg.waitForTimeout(2200)
  if (await pg.locator('.street').count()) throw new Error('still in the streets after Globe')
})
await step('pins too close to tell apart', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300)
  await pg.click('[data-do=find]'); await pg.fill('#fq', 'versailles'); await pg.waitForTimeout(500)
  await pg.locator('.res[data-kind=town]').filter({ hasText: 'France' }).first().click(); await pg.waitForTimeout(2000)
  await pg.click('text=Make it a place'); await pg.waitForTimeout(800)
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(600)
  await pg.mouse.move(195, 300)
  for (let i = 0; i < 14; i++) { await pg.mouse.wheel(0, 300); await pg.waitForTimeout(60) }
  await pg.waitForTimeout(900); await shot('12e-merged')
  const lead = pg.locator('.gpin:has(b:not(:empty))').first()
  if (!(await lead.count())) throw new Error('no merged pin')
  await lead.evaluate(el => el.click()); await pg.waitForTimeout(700)
  const asked = await pg.locator('#sheet.on .eyebrow').first().innerText()
  if (!/close together/i.test(asked)) throw new Error('a merged pin should ask which one, got ' + asked)
  await shot('12f-which')
  const tags = await pg.evaluate(() => [...document.querySelectorAll('.gpin.near span')].map(s => s.getBoundingClientRect()).filter(r => r.width))
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    const a = tags[i], b = tags[j]
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) throw new Error('two name tags overlap')
  }
})
await step('read about it', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('[data-do=find]'); await pg.fill('#fq', 'nara'); await pg.waitForTimeout(500)
  await pg.locator('.res[data-kind=town]').filter({ hasText: 'Japan' }).first().click(); await pg.waitForTimeout(1500)
  await pg.click('[data-act=read]'); await pg.waitForSelector('#gs-about .g-prose', { timeout: 25000 }); await pg.waitForTimeout(1500)
  await shot('12g-read')
  const title = await pg.locator('.g-title').innerText()
  if (!/Nara/.test(title)) throw new Error('the listing should be about Nara, got ' + title)
  await pg.click('.g-keep >> nth=0'); await pg.waitForTimeout(1500)
  await pg.evaluate(() => document.querySelector('#gs-climate').scrollIntoView()); await pg.waitForTimeout(2500); await shot('12h-read-climate')
})
await step('map layers and style', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(500)
  await pg.click('#mapbtn'); await pg.waitForTimeout(500)
  await pg.click('[data-act=lseg][data-k=countries][data-v=fill]'); await pg.click('[data-act=lseg][data-k=seaLabels][data-v=seas]')
  await pg.click('[data-act=style][data-v=clean]'); await pg.waitForTimeout(400); await shot('12c-mapsheet')
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(1500); await shot('12d-clean-coloured')
  await pg.click('#mapbtn'); await pg.waitForTimeout(400); await pg.click('[data-act=resetMap]'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(500)
})
await step('slate ink', async () => {
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
  await pg.click('#mapbtn'); await pg.waitForTimeout(500); await pg.click('[data-ink=slate]'); await pg.waitForTimeout(1200); await shot('13-mapsheet')
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(1200); await shot('14-slate')
})
const before = await count()
await step('backup round-trip', async () => {
  await pg.click('#settings'); await pg.waitForTimeout(500)
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('text=Export a backup')])
  const file = await dl.path()
  await pg.evaluate(() => new Promise(ok => { const r = indexedDB.deleteDatabase('globe-journal'); r.onsuccess = r.onerror = r.onblocked = ok }))
  await pg.goto(URL_); await pg.waitForTimeout(3000)
  await shot('15-fresh')                                           // a new phone: the welcome offers the restore
  const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('text=Restore a backup')])
  await chooser.setFiles(file); await pg.waitForTimeout(2500)
})
const after = await count()
console.log('places/entries before', before, 'after restore', after)
if (JSON.stringify(before) !== JSON.stringify(after)) errors.push(`backup lost something: ${before} -> ${after}`)
await shot('16-restored')
await browser.close(); server.kill()
console.log(errors.length ? 'FAILED\n' + errors.join('\n') : 'ok: no errors')
process.exit(errors.length ? 1 : 0)
