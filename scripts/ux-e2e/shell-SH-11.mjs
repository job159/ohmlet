/**
 * UX fix SH-11 — replay of the audit task (docs/ux/UX_VERIFY.md V-13;
 * finding F-08): a refused placement names the REAL reason.
 *
 *   UX_E2E_URL=http://localhost:5321/ node scripts/ux-e2e/shell-SH-11.mjs
 *
 * Fresh profile, zh-TW, desktop workspace (1440×900, mouse), empty board.
 * Arms the Blue Pill from the library (real click on its card), then clicks
 * real breadboard holes (aimed through the `?shotrig` camera, exactly where
 * the scene draws them):
 *   - e10 (wrong row) → the toast names row h (「h 列」, 「PB12 對齊那個孔」)
 *     and never sends the student to the XL board;
 *   - h60 on the 63-column board (right row, runs off the edge) →
 *     「右邊超出麵包板——請往左移…」;
 *   - h10 → placed (U1).
 * Exit code 1 on any failed check.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  if (sessionStorage.getItem('sh11.seeded')) return
  localStorage.clear()
  localStorage.setItem('bb.onboarded', '1')
  localStorage.setItem('bb.renderMode', 'performance')
  localStorage.setItem('bb.lang', 'zh-TW')
  localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
  localStorage.setItem('bb.layout', JSON.stringify({ version: 1, name: 'empty', components: [], wires: [] }))
  sessionStorage.setItem('sh11.seeded', '1')
})
await page.goto(`${URL}?e2e&shotrig`)
await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120000 })
await page.evaluate(() => window.__e2e.ready())
await sleep(800)

/** park the camera over a hole and click it (a real mouse click where the scene draws it) */
async function clickHole(ref) {
  const w = await page.evaluate((r) => window.__e2e.endpointWorld(r), ref)
  const dist = 9
  await page.evaluate((c) => window.__shotRig.setCamera(...c), [w.x + 0.12 * dist, w.y + 1.25 * dist, w.z + 0.22 * dist, w.x, w.y, w.z])
  await sleep(300)
  const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
  const covered = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
  if (covered !== 'CANVAS') throw new Error(`${ref} is under ${covered}`)
  await page.mouse.move(p.x - 3, p.y - 3)
  await page.mouse.move(p.x, p.y, { steps: 3 })
  await sleep(120)
  await page.mouse.click(p.x, p.y)
  await sleep(450)
}
const toasts = () => page.$$eval('.lg-toast', (els) => els.map((e) => e.textContent ?? ''))
const refusal = async () => (await toasts()).find((t) => t.startsWith('這裡放不下')) ?? ''

// arm the Blue Pill from the library
const search = page.locator('.ws-left input[type="search"]')
if (!(await search.isVisible())) await page.locator('.lg-dock').getByText('元件').click()
await search.fill('Blue Pill')
await sleep(500)
await page.locator('.ws-left .ws-part-main').first().click()
await sleep(500)
check((await page.evaluate(() => window.__e2e.state().mode)).kind === 'place', 'the Blue Pill is armed from its library card')

await clickHole('e10')
const wrongRow = await refusal()
check(wrongRow.includes('h 列'), 'e10: the toast names row h', wrongRow)
check(wrongRow.includes('PB12 對齊那個孔'), 'e10: … and which pin lands on the clicked hole')
check(!wrongRow.includes('XL'), 'e10: … never the XL board')

await clickHole('h60')
const offEdge = await refusal()
check(offEdge.includes('往左移') && offEdge.includes('右邊超出麵包板'), 'h60 on the 63-column board: 「右邊超出麵包板——請往左移」', offEdge)

await clickHole('h10')
const comps = (await page.evaluate(() => window.__e2e.state().layout.components)).map((c) => `${c.id}@${c.at}`)
check(comps.includes('U1@h10'), 'h10: the Blue Pill is placed', comps.join(', '))

check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' / '))
await browser.close()
console.log(failures === 0 ? 'SH-11: all checks passed' : `SH-11: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
