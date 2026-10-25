/**
 * UX fix wave — IS-11 (P0) replay: no frequency for a signal that is not
 * periodic, and no flicker to the analog estimate after 自動設定
 * (docs/ux/UX_VERIFY.md V-06, findings E2-04, AN2-14, AN2-07).
 *
 * The audit tasks, through the real interface (examples opened from the
 * library's 範例 tab, ▶ 執行模擬, the tray tabs; the scope probe is placed
 * with the probe menu's own action, addScopeProbeFor, and the timebase set
 * through the scope's settings store):
 *   1. 「UART 問候與回音」, a scope probe on PA9 (USART1 TX): the logic
 *      analyzer and the scope both read 「115 200 Bd · 8N1（由 USART1 設定）」,
 *      never a kHz value;
 *   2. 「I²C 匯流排掃描」: PB6 SCL reads 「時脈 … kHz（突發）」 in the auto
 *      window and after ⤢ 顯示全部記錄;
 *   3. 「PWM 呼吸燈」 at 1 µs/格 → 自動設定: 120 readings over 3 s, every
 *      one 「1.000 kHz（數位精確）」, none from the analog path (≈);
 *   4. the same PWM at all 20 timebases (1 µs … 2 s/格): never another
 *      frequency (IS-2 regression).
 *
 *   UX_E2E_URL=http://localhost:5325/ node scripts/ux-e2e/instruments-IS-11.mjs
 *
 * Needs a dev server WITHOUT hot reload (UX_E2E_URL; the probe action and the
 * scope settings are imported from its /src modules). msedge, headless,
 * zh-TW, desktop workspace 1440×900. Exit 1 on failure.
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

/** import one of the dev server's source modules (the instance the app runs) and call `fn(m, arg)` */
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

async function openExample(page, title) {
  await page.getByRole('radio', { name: '範例' }).click()
  await examplePill(page, title).click()
  await page.waitForFunction(() => {
    const st = window.__e2e.state()
    return (st.layout.components ?? []).some((c) => c.id === 'U1') && !!st.firmware?.U1
  }, null, { timeout: 120000 })
  await page.waitForTimeout(800)
}
const runTo = async (page, seconds) => {
  await page.getByRole('button', { name: /執行模擬/ }).first().click()
  await waitSim(page, seconds)
}
const trayTab = async (page, name) => {
  await page.getByRole('radio', { name }).click()
  await page.waitForTimeout(1500)
}
/** hover the first trace row of the analyzer, so its footer reads that channel */
async function hoverRow(page, row = 0) {
  const box = await page.locator('.emb-la-plot').boundingBox()
  const labels = page.locator('.emb-la-label:not(.is-ann)')
  const lb = await labels.nth(row).boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, lb.y + lb.height / 2)
  await page.waitForTimeout(500)
}

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  // ---- 1. UART TX: the baud line, never a kHz value --------------------------------------
  {
    const { ctx, page, errors } = await boot(browser)
    await openExample(page, 'UART 問候與回音（終端機）')
    await withModule(page, '/src/ui/embedded/probe-actions.ts', "await m.addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA9' })")
    await runTo(page, 1.2)
    await trayTab(page, /邏輯分析儀/)
    await hoverRow(page, 0)
    const foot = (await page.locator('.lai-foot').innerText()).replace(/\n/g, ' ')
    check('UART TX — logic analyzer: 鮑率 115 200 Bd · 8N1（由 USART1 設定）', /115 200 Bd · 8N1（由 USART1 設定）/.test(foot), foot)
    check('UART TX — logic analyzer: no kHz, no 工作週期', !/kHz/.test(foot) && !/工作週期/.test(foot), foot)
    await trayTab(page, /示波器/)
    await page.waitForTimeout(1500)
    const meas = (await page.locator('.sco-meas').innerText()).replace(/\n/g, ' ')
    check('UART TX — scope: the same baud line', /115 200 Bd · 8N1（由 USART1 設定）/.test(meas), meas)
    check('UART TX — scope: never a kHz frequency', !/kHz/.test(meas), meas)
    check('UART: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ---- 2. I²C SCL: the burst clock in every window -----------------------------------------
  {
    const { ctx, page, errors } = await boot(browser)
    await openExample(page, 'I²C 匯流排掃描')
    await runTo(page, 1.0)
    await trayTab(page, /邏輯分析儀/)
    await page.waitForTimeout(1500)
    await hoverRow(page, 0)
    const auto = (await page.locator('.lai-foot').innerText()).replace(/\n/g, ' ')
    // 「時脈 ⓘ 100.0 kHz（突發）」: since the release QA clarity round every instrument
    // term carries its glossary ⓘ (InstrumentTerm) between the name and the value
    const BURST_CLOCK = /時脈\s*(?:ⓘ\s*)?(99|100)\.\d+ kHz（突發）/
    check('I²C SCL (auto window): 時脈 … kHz（突發）', /PB6 SCL/.test(auto) && BURST_CLOCK.test(auto), auto)
    await page.getByRole('button', { name: '顯示全部記錄' }).click()
    await page.waitForTimeout(1500)
    await hoverRow(page, 0)
    const all = (await page.locator('.lai-foot').innerText()).replace(/\n/g, ' ')
    check('I²C SCL (⤢ 全部): 時脈 … kHz（突發）', BURST_CLOCK.test(all), all)
    check('I²C: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ---- 3 + 4. pwm-fade: 自動設定 from 1 µs/格, then every timebase --------------------------
  {
    const { ctx, page, errors } = await boot(browser)
    await openExample(page, 'PWM 呼吸燈（TIM3）')
    await withModule(page, '/src/ui/embedded/instruments/scope-settings.ts', 'm.useScopeSettings.getState().set({ tdiv: 1e-6, autoPending: false })')
    await runTo(page, 0.4)
    await trayTab(page, /示波器/)
    await page.getByRole('button', { name: '自動設定' }).click()
    const samples = await page.evaluate(async () => {
      const out = []
      // 120 readings, 25 ms apart (longer than 3 s when the page is busy simulating;
      // on a loaded machine — runs measured 0.008–0.09× real time — the timers fire late,
      // so the wall cap is generous: still 120 readings from the 自動設定 click on, all checked)
      const end = performance.now() + 60000
      while (performance.now() < end && out.length < 120) {
        out.push(document.querySelector('.sco-meas')?.textContent ?? '')
        await new Promise((r) => setTimeout(r, 25))
      }
      return out
    })
    const exact = samples.filter((s) => /1\.000 kHz（數位精確）/.test(s)).length
    const analog = samples.filter((s) => /頻率\s*≈/.test(s)).length
    check(`pwm-fade 自動設定 from 1 µs/格: ${samples.length} readings, all 1.000 kHz（數位精確）, 0 analog`, samples.length >= 120 && exact === samples.length && analog === 0, {
      n: samples.length,
      exact,
      analog,
      odd: samples.filter((s) => !/1\.000 kHz（數位精確）/.test(s)).slice(0, 2),
    })
    const tdivs = await withModule(page, '/src/ui/embedded/instruments/scope-settings.ts', 'return m.TDIVS')
    const bad = []
    for (const td of tdivs) {
      await withModule(page, '/src/ui/embedded/instruments/scope-settings.ts', 'm.useScopeSettings.getState().set({ tdiv: a })', td)
      await page.waitForTimeout(td >= 0.5 ? 1500 : 800)
      const txt = (await page.locator('.sco-meas').innerText()).replace(/\n/g, ' ')
      // the exact reading, or nothing — never another frequency
      const freqs = [...txt.matchAll(/(\d+(?:\.\d+)?) (k?Hz)/g)].map((x) => x[0])
      if (!/1\.000 kHz（數位精確）/.test(txt) || freqs.some((f) => f !== '1.000 kHz')) bad.push({ td, txt })
    }
    check(`pwm-fade at all ${tdivs.length} timebases: 1.000 kHz（數位精確）, never another frequency`, bad.length === 0, bad)
    check('pwm-fade: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\nIS-11: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
