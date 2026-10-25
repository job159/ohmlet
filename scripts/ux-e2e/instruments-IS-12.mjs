/**
 * UX fix wave — IS-12 (P0) replay: what a net is doing (helper H4,
 * docs/ux/UX_VERIFY.md V-19, findings AN2-01 / AN2-02 / AN-11).
 *
 *   1. 「PWM 呼吸燈」 running: getNetLive on U1 PA6 reads a PWM of 1.000 kHz
 *      in every one of 16 samples over 5 s while the LED breathes (also at
 *      the 0 % / 100 % turns of the sweep) — the same frequency the logic
 *      analyzer's footer prints for PA6;
 *   2. 「SPI 74HC595 跑馬燈」 running: hasActivity on the SRCLK net (U2
 *      SRCLK at e39, driven by PA5 SCK) after 0.1 s of simulated time is
 *      true, and the net never reads as a PWM (SPI bursts are not periodic).
 *
 * The examples are opened from the library's 範例 tab and run with
 * ▶ 執行模擬; H4 is read through the dev server's own module instance (it is
 * the helper the hover chip / pin rows / problems call).
 *
 *   UX_E2E_URL=http://localhost:5325/ node scripts/ux-e2e/instruments-IS-12.mjs
 *
 * Needs a dev server WITHOUT hot reload. msedge, headless, zh-TW, desktop
 * workspace 1440×900. Exit 1 on failure.
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

const NET = '/src/ui/embedded/instruments/net-activity.ts'
const withModule = (page, path, fn, arg) =>
  page.evaluate(
    async ([p, src, a]) => {
      const m = await import(p)
      return await new Function('m', 'a', `return (async () => { ${src} })()`)(m, a)
    },
    [path, fn, arg],
  )

/**
 * The example card's 開啟 pill: one click from the library list to the board.
 * Its accessible name says the whole action — 「開啟範例：…」 since the release
 * QA round (SC-F4, the same pattern as instruments-IS-15), 「開啟「…」」 before.
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const examplePill = (page, title) =>
  page.getByRole('button', { name: new RegExp(`^開啟(範例：${esc(title)}|「${esc(title)}」)$`) }).first()

async function openAndRun(page, title, seconds) {
  await page.getByRole('radio', { name: '範例' }).click()
  await examplePill(page, title).click()
  await page.waitForFunction(() => {
    const st = window.__e2e.state()
    return (st.layout.components ?? []).some((c) => c.id === 'U1') && !!st.firmware?.U1
  }, null, { timeout: 120000 })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /執行模擬/ }).first().click()
  await waitSim(page, seconds)
}

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'PWM 呼吸燈（TIM3）', 0.3)
    // the first ask starts the ≤ 4 Hz poll; the answer follows within a poll
    await withModule(page, NET, "return m.getNetLive({ componentId: 'U1', pin: 'PA6' })")
    let first = null
    for (let i = 0; i < 40 && first?.kind !== 'pwm'; i++) {
      await page.waitForTimeout(250)
      first = await withModule(page, NET, "return m.getNetLive({ componentId: 'U1', pin: 'PA6' })")
    }
    const samples = []
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(300)
      samples.push(await withModule(page, NET, "const l = m.getNetLive({ componentId: 'U1', pin: 'PA6' }); return { kind: l?.kind, f: l?.f ?? null, text: m.netLiveText(l) }"))
    }
    const pwm = samples.filter((s) => s.kind === 'pwm' && Math.abs(s.f - 1000) < 0.5)
    check('pwm-fade PA6: getNetLive → pwm 1.000 kHz in 16 / 16 samples', pwm.length === samples.length, samples.filter((s) => !pwm.includes(s)))
    check('pwm-fade PA6: the text reads 「PWM 1.000 kHz · …」', samples.every((s) => /^PWM 1\.000 kHz · /.test(s.text)), samples.slice(0, 2).map((s) => s.text))
    check('pwm-fade: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'SPI 74HC595 跑馬燈', 0.05)
    await withModule(page, NET, "return m.hasActivity('e39', 0.1)")
    await waitSim(page, 0.6)
    let active = false
    let live = null
    for (let i = 0; i < 20 && !active; i++) {
      await page.waitForTimeout(250)
      active = await withModule(page, NET, "return m.hasActivity('e39', 0.1)")
      live = await withModule(page, NET, "return m.getNetLive('e39')")
    }
    check('spi-595 SRCLK net (e39): hasActivity after 0.1 s → true', active === true, { active, live })
    check('spi-595 SRCLK net: never a PWM (SPI bursts are not periodic)', live?.kind !== 'pwm', live)
    check('spi-595: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\nIS-12: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
