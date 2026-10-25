/**
 * UX fix SH-10 — replay of the audit task (docs/ux/UX_VERIFY.md V-12;
 * findings RV-03, RV-07): the classic chrome (English, workspace off) looks
 * and behaves exactly as before the UX wave (commit 6d01968).
 *
 *   UX_E2E_URL=http://localhost:5321/ node scripts/ux-e2e/shell-SH-10.mjs
 *
 * Fresh profile, bb.lang = 'en', workspace off (1440×900, mouse):
 *   - the first run shows the pre-wave tour: Look around → Place parts →
 *     Or just ask, finishing with 「Get started」 (never "This is an STM32
 *     electronics lab" / "Start lesson 1");
 *   - the empty state is "Build your first circuit" with Browse parts / Ask AI;
 *   - on the blink circuit: F5 is left to the browser (reload — never
 *     preventDefault), Ctrl+S is the browser's Save page, '?' opens nothing,
 *     Space runs / pauses;
 * and the zh-TW chrome is unchanged: '?' opens 「鍵盤快速鍵」, F5 with an MCU
 * never reaches the browser, Ctrl+S saves the project.
 * The pixels are pinned by the visual scenes desktop-onboarding,
 * phone-onboarding, phone-empty and phone-properties-mcu (baselines from
 * 6d01968 — scripts/visual-regression.mjs). Exit code 1 on any failed check.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BLINK = JSON.stringify(JSON.parse(readFileSync(path.join(ROOT, 'examples', 'embedded', 'blink.ohmlet.json'), 'utf8')).layout)
const EMPTY = JSON.stringify({ version: 1, name: 'empty', components: [], wires: [] })

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ lang, workspace = false, onboarded = true, layout = EMPTY }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([lang, ws, onboarded, layout]) => {
      if (sessionStorage.getItem('sh10.seeded')) return
      localStorage.clear()
      if (onboarded) localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.layout', layout)
      sessionStorage.setItem('sh10.seeded', '1')
    },
    [lang, workspace, onboarded, layout],
  )
  await page.goto(`${URL}?shotrig`)
  await page.waitForSelector('canvas')
  await sleep(2200)
  // what the app did with each key: a capture listener added after the app's sees defaultPrevented
  await page.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', (e) => window.__keys.push(`${e.ctrlKey ? 'Ctrl+' : ''}${e.key}:${e.defaultPrevented}`), true)
  })
  return { ctx, page, errors }
}
const prevented = (page, key) => page.evaluate((k) => window.__keys.filter((x) => x.startsWith(`${k}:`)).map((x) => x.endsWith('true')), key)
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'))

// ---- classic first run ----
{
  const { ctx, page, errors } = await open({ lang: 'en', onboarded: false })
  const card = () => page.$eval('.app-onboard-card', (e) => e.innerText)
  const titles = await page.$$eval('.app-onboard-step .lg-title', (els) => els.map((e) => e.textContent))
  check(JSON.stringify(titles) === JSON.stringify(['Look around', 'Place parts', 'Or just ask']), 'classic tour: Look around → Place parts → Or just ask', titles.join(' / '))
  const text = await card()
  check(!/STM32 electronics lab|Start lesson 1|See an example first/.test(text), 'classic tour: none of the new chrome’s cards')
  await page.getByRole('button', { name: 'Next' }).click()
  await sleep(500)
  await page.getByRole('button', { name: 'Next' }).click()
  await sleep(500)
  check(await page.getByRole('button', { name: 'Get started' }).isVisible(), 'classic tour ends with 「Get started」')
  await page.getByRole('button', { name: 'Get started' }).click()
  await sleep(800)
  const empty = await page.$eval('.app-empty', (e) => e.innerText).catch(() => '')
  check(empty.includes('Build your first circuit') && empty.includes('Browse parts') && empty.includes('Ask AI'), 'classic empty state: Build your first circuit · Browse parts · Ask AI')
  check(errors.length === 0, 'no page errors (classic first run)', errors.join(' / '))
  await ctx.close()
}

// ---- classic keys on the blink circuit ----
{
  const { ctx, page, errors } = await open({ lang: 'en', layout: BLINK })
  await page.mouse.click(720, 120) // the 3D view (empty bench)
  await sleep(300)
  await page.keyboard.press('Control+s')
  await page.keyboard.press('?')
  await sleep(400)
  check(!(await dialogOpen(page)), "classic: '?' opens nothing")
  await page.keyboard.press('F5')
  await page.keyboard.press('Shift+F5')
  await page.keyboard.press('F10')
  await sleep(400)
  check((await prevented(page, 'Ctrl+s')).every((x) => !x), 'classic: Ctrl+S is left to the browser (Save page)')
  check((await prevented(page, '?')).every((x) => !x), "classic: '?' is not taken")
  const f5 = await prevented(page, 'F5')
  check(f5.length === 2 && f5.every((x) => !x), 'classic: F5 / Shift+F5 are left to the browser (reload)')
  check((await prevented(page, 'F10')).every((x) => !x), 'classic: F10 is not taken')
  const capsule = () => page.$eval('.lg-capsule', (e) => e.textContent)
  check(/Paused/.test(await capsule()), 'classic: F5 did not start the simulation', await capsule())
  await page.keyboard.press('Space')
  await sleep(900)
  check(/Running/.test(await capsule()), 'classic: Space runs (capsule 「Running」)', await capsule())
  await page.keyboard.press('Space')
  await sleep(600)
  check(/Paused/.test(await capsule()), 'classic: Space pauses again', await capsule())
  check(errors.length === 0, 'no page errors (classic keys)', errors.join(' / '))
  await ctx.close()
}

// ---- the zh-TW chrome keeps its keys ----
{
  const { ctx, page, errors } = await open({ lang: 'zh-TW', workspace: true, layout: BLINK })
  await page.mouse.click(720, 120)
  await sleep(300)
  await page.keyboard.press('?')
  await sleep(500)
  check(await page.getByRole('dialog', { name: '鍵盤快速鍵' }).isVisible(), "zh-TW: '?' opens 「鍵盤快速鍵」")
  await page.keyboard.press('F5') // under the modal: swallowed, never a reload
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.keyboard.press('F5')
  await sleep(600)
  const f5 = await prevented(page, 'F5')
  check(f5.length === 2 && f5.every(Boolean), 'zh-TW: F5 with an MCU never reaches the browser')
  check(errors.length === 0, 'no page errors (zh-TW keys)', errors.join(' / '))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? 'SH-10: all checks passed' : `SH-10: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
