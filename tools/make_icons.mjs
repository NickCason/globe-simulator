// The app icons are the globe itself: rendered with ?icon (just the globe, no drift or boil) and screenshotted.
// Run: npm run build && node tools/make_icons.mjs   ->   public/icons/*.png
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = 5198, URL_ = `http://127.0.0.1:${PORT}/`
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < 60; i++) { try { await fetch(URL_); break } catch { await sleep(250) } }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const [file, size, mode] of [['icon-512', 512, ''], ['icon-192', 192, ''], ['icon-maskable-512', 512, 'mask'], ['apple-touch-icon', 180, '']]) {
  const pg = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await pg.goto(URL_ + '?icon=' + mode); await pg.waitForTimeout(3500)
  await pg.screenshot({ path: `public/icons/${file}.png` })
  await pg.close()
}
await browser.close(); server.kill()
console.log('icons written')
