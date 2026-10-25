/**
 * UX fix wave — IS-10 (P0) replay: the logic analyzer's channel picker never
 * labels an I²C pin as USART (docs/ux/UX_VERIFY.md V-07, finding E2-02).
 *
 * The audit task, through the real interface: open the example 「I²C 匯流排
 * 掃描」 from the library's 範例 tab, press ▶ 執行模擬, open the logic
 * analyzer and its 「＋通道…」 menu:
 *   - 使用中的腳位 lists PB6 / PB7 as I2C1_SCL / I2C1_SDA (or by mode only),
 *     never 「USART1_TX / RX」;
 *   - the bus group suggests 「I2C1（PB6 SCL／PB7 SDA）」, never
 *     「USART1（PB6 TX／PB7 RX）」;
 * and the same menu on 「UART 問候與回音」 still names PA9 USART1_TX.
 *
 *   UX_E2E_URL=http://localhost:5325/ node scripts/ux-e2e/instruments-IS-10.mjs
 *
 * Needs a dev server WITHOUT hot reload (UX_E2E_URL). msedge, headless,
 * zh-TW, desktop workspace 1440×900, fresh profile per case. Exit 1 on failure.
 */
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ux-e2e-seeded')) return
    sessionStorage.setItem('ux-e2e-seeded', '1')
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.layout', JSON.stringify({ version: 1, components: [], wires: [] }))
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    localStorage.setItem('bb.lang', 'zh-TW')
  })
  // the app's boot is not under test: on a loaded machine (several dev servers and browsers)
  // the 'load' event took 3–116 s (measured in the release triage), past goto's 30 s default
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}e2e`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 60000 })
  await page.evaluate(() => window.__e2e.ready())
  return { ctx, page, errors }
}

/**
 * Wait until the run reaches `s` seconds of SIMULATED time. Bounded by progress,
 * not by wall time: on a loaded machine the same run went 0.008–0.09× real time
 * and its first simulated tick came 15 s to over 90 s after ▶ (release triage),
 * so a fixed 180 s budget failed healthy runs. A run that never starts within
 * `startMs`, or stops advancing for `stallMs`, still fails — naming where it
 * stopped and whether the store says it is running.
 */
async function waitSim(page, s, stallMs = 90000, startMs = 300000) {
  const t0 = await page.evaluate(() => window.__e2e.state().simTime)
  let last = t0
  let since = Date.now()
  for (;;) {
    const st = await page.evaluate(() => {
      const x = window.__e2e.state()
      return { t: x.simTime, running: x.running }
    })
    if (st.t >= s) return st.t
    if (st.t > last) {
      last = st.t
      since = Date.now()
    } else {
      const limit = last === t0 ? startMs : stallMs
      if (Date.now() - since > limit) {
        throw new Error(`simulated time stayed at ${st.t} s for ${limit / 1000} s (waiting for ${s} s; running: ${st.running})`)
      }
    }
    await page.waitForTimeout(250)
  }
}

/**
 * The example card's 開啟 pill: one click from the library list to the board.
 * Its accessible name says the whole action — 「開啟範例：…」 since the release
 * QA round (SC-F4, the same pattern as instruments-IS-15), 「開啟「…」」 before.
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const examplePill = (page, title) =>
  page.getByRole('button', { name: new RegExp(`^開啟(範例：${esc(title)}|「${esc(title)}」)$`) }).first()

/** Library → 範例 → 開啟 (開啟範例：title), then ▶ 執行模擬 and wait for `seconds` of simulated time. */
async function openAndRun(page, title, seconds) {
  await page.getByRole('radio', { name: '範例' }).click()
  await examplePill(page, title).click()
  // the example's board is in and its firmware bound
  await page.waitForFunction(() => {
    const st = window.__e2e.state()
    return (st.layout.components ?? []).some((c) => c.id === 'U1') && !!st.firmware?.U1
  }, null, { timeout: 120000 })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /執行模擬/ }).first().click()
  await waitSim(page, seconds)
}

/** The logic analyzer's 「＋通道…」 option groups (label → option texts). */
async function pickerGroups(page) {
  await page.getByRole('radio', { name: /邏輯分析儀/ }).click()
  const sel = page.locator('.lai-add-ch select')
  await sel.waitFor({ timeout: 20000 })
  await sel.focus() // the menu is rebuilt with the live pin modes when it is about to open
  await page.waitForTimeout(500)
  return sel.evaluate((el) =>
    Object.fromEntries([...el.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)])),
  )
}

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'I²C 匯流排掃描', 0.6)
    const g = await pickerGroups(page)
    const pins = g['使用中的腳位'] ?? []
    const buses = Object.entries(g).find(([k]) => /匯流排/.test(k))?.[1] ?? []
    check('i2c-scan: 使用中的腳位 lists PB6 and PB7', pins.some((o) => /^PB6 /.test(o)) && pins.some((o) => /^PB7 /.test(o)), pins)
    check('i2c-scan: PB6 / PB7 are never labelled USART', !pins.some((o) => /^PB[67] /.test(o) && /USART/.test(o)), pins)
    check('i2c-scan: PB6 reads I2C1_SCL', pins.includes('PB6 · I2C1_SCL · 複用開汲極'), pins)
    check('i2c-scan: the bus group suggests I2C1（PB6 SCL／PB7 SDA）', buses.some((o) => /^I2C1（PB6 SCL／PB7 SDA）/.test(o)), buses)
    check('i2c-scan: never USART1（PB6 TX／PB7 RX）', !buses.some((o) => /USART1（PB6/.test(o)), buses)
    check('i2c-scan: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'UART 問候與回音（終端機）', 0.3)
    const g = await pickerGroups(page)
    const pins = g['使用中的腳位'] ?? []
    check('uart-hello: PA9 still reads USART1_TX', pins.some((o) => /^PA9 · USART1_TX/.test(o)), pins)
    check('uart-hello: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\nIS-10: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
