/**
 * UX fix LS-9 (P0) — replay of audit task RV-02 (T6): replacing the circuit
 * ends the guide.
 *
 *   UX_E2E_URL=http://localhost:5323/ node scripts/ux-e2e/lessons-LS-9.mjs
 *
 * A fresh zh-TW profile with the desktop workspace (1440×900) starts lesson
 * b1 (its starting circuit and the coach on step 1), then opens the 「Blue
 * Pill 閃爍 LED」 example from the 範例 tab. Asserts:
 *   - the coach is gone within 300 ms of the click and the toast says why
 *     (「已結束「LED 與限流電阻」的步驟引導——電路板上換成了別的電路」);
 *   - the status pill is no longer silenced: 「電路已就緒（空白鍵）」 + 〔執行模擬〕
 *     (the button carries the verb once — release QA SH-F10);
 *   - after a reload no coach comes back (bb.lessons guiding is cleared).
 * The page boots with `autorun=0` (round 5): with auto-run the opened example
 * runs at once and the ready line (still shown after a paused simulation is
 * reset) never appears, so the pill check needs auto-run off.
 * Exit code 1 on any failed assertion. UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const browser = await chromium.launch({ channel: process.env.UX_E2E_CHANNEL ?? 'msedge', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-TW' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ux.seeded')) return
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.lang', 'zh-TW')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    sessionStorage.setItem('ux.seeded', '1')
  })
  const shot = async (name) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `LS-9-${name}.png`) })
  }
  const boot = async () => {
    await page.waitForFunction(() => !!window.__e2e, null, { timeout: 90_000 })
    await page.evaluate(() => window.__e2e.ready())
    await sleep(800)
  }
  // autorun=0: the idle pill under test (auto-run would start the opened example at once)
  await page.goto(`${URL}?e2e&autorun=0`, { timeout: 180_000 })
  await boot()

  // 課程 → b1 → 載入起始電路: the coach guides step 1
  await page.locator('.ws-tabs').getByText('課程', { exact: true }).click()
  await page.locator('.lsn-card', { hasText: 'LED 與限流電阻' }).click()
  await page.locator('.lsn-actions').getByRole('button', { name: /載入起始電路/ }).click()
  await sleep(400)
  const confirm = page.locator('[role="dialog"]').getByRole('button', { name: '載入起始電路' })
  if (await confirm.count()) await confirm.first().click()
  const coach = page.locator('.lsn-coach')
  await coach.waitFor({ state: 'visible', timeout: 20_000 })
  await sleep(1000)
  check((await coach.innerText()).includes('步驟 1/'), 'the b1 coach guides step 1')
  await shot('01-b1-guiding')

  // 範例 → Blue Pill 閃爍 LED → 開啟
  await page.locator('.ws-tabs').getByText('範例', { exact: true }).click()
  await sleep(400)
  const open = page.locator('[data-example="blink"] .ws-open-pill')
  await open.scrollIntoViewIfNeeded()
  // the board's replacement and the coach's disappearance, timed per frame in the page.
  // The example's board is recognised by its Blue Pill U1 with the lesson's
  // DMM1 gone (b1 has no MCU; both circuits name their LED 「LED1」 since the
  // release QA refdes round, so the LED alone no longer tells them apart).
  await page.evaluate(() => {
    window.__ls9Board = () => {
      const comps = window.__e2e.state().layout?.components ?? []
      return comps.some((c) => c.id === 'U1' && c.type === 'stm32_bluepill') && !comps.some((c) => c.id === 'DMM1')
    }
    window.__ls9 = { clicked: 0, replaced: 0, gone: 0 }
    document
      .querySelector('[data-example="blink"] .ws-open-pill')
      ?.addEventListener('click', () => (window.__ls9.clicked = performance.now()), { capture: true, once: true })
    const tick = () => {
      const now = performance.now()
      const s = window.__ls9
      if (!s.replaced && window.__ls9Board()) s.replaced = now
      if (s.clicked && !s.gone && !document.querySelector('.lsn-coach')) s.gone = now
      if (!s.gone || !s.replaced) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await open.click()
  await sleep(300)
  const sheetConfirm = page.locator('[role="dialog"] button.is-destructive, [role="dialog"] [data-destructive]')
  if (await sheetConfirm.count()) await sheetConfirm.first().click()
  await page.waitForFunction(() => window.__ls9Board(), null, { timeout: 30_000 })
  await page.waitForFunction(() => !document.querySelector('.lsn-coach'), null, { timeout: 5_000 }).catch(() => {})
  await sleep(200)
  const tm = await page.evaluate(() => window.__ls9)
  console.log(`  click → board replaced ${Math.round(tm.replaced - tm.clicked)} ms, → coach gone ${Math.round(tm.gone - tm.clicked)} ms`)
  check((await coach.count()) === 0, 'the coach is gone after the example opened')
  check(tm.gone > 0 && tm.replaced > 0 && tm.gone - tm.replaced <= 300, `the coach goes within 300 ms of the board change (${Math.round(tm.gone - tm.replaced)} ms)`)
  // the example's own toasts follow the replace; the reason stays readable on screen after that burst
  await sleep(1200)
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.lg-toast:not(.is-leaving)')].map((x) => x.textContent ?? ''))
  check(
    toasts.some((x) => x.includes('已結束「LED 與限流電阻」的步驟引導——電路板上換成了別的電路')),
    `the toast on screen says why the guide ended ${JSON.stringify(toasts)}`,
  )
  await shot('02-example-opened')

  // the status pill speaks again
  const pillOk = await page
    .waitForFunction(() => /電路已就緒（空白鍵）.*執行模擬/.test(document.querySelector('.app-status-pill')?.textContent ?? ''), null, {
      timeout: 15_000,
    })
    .then(() => true)
    .catch(() => false)
  const pillText = await page.evaluate(() => document.querySelector('.app-status-pill')?.textContent ?? '(no pill)')
  check(pillOk, `the pill reads 「電路已就緒（空白鍵）」 + 〔執行模擬〕 (${pillText})`)
  await shot('03-pill-ready')

  const guiding = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('bb.lessons') ?? '{}').guiding ?? null
    } catch {
      return 'unreadable'
    }
  })
  check(guiding === null, `the guided lesson is forgotten (bb.lessons guiding = ${guiding})`)

  // a reload resumes no coach
  await page.reload({ timeout: 180_000 })
  await boot()
  await sleep(2500)
  check((await page.locator('.lsn-coach').count()) === 0, 'after a reload no coach comes back')
  await shot('04-reloaded')
  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`)
} catch (err) {
  failures.push(String(err))
  console.log('FAIL', err)
} finally {
  await browser.close()
}
console.log(failures.length === 0 ? 'LS-9: all assertions passed' : `LS-9: ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
