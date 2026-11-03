/**
 * Release QA, clarity round — the instruments' analysis panels (QA clarity
 * items LA-AXIS, LA-FIT, UART-RX, UART-TIMESTAMPS, DECODE-SUMMARY,
 * SCOPE-READOUT-TRIGGER, SCOPE-CURSORS, FG-RAIL, MEASURE-COHERENCE,
 * GLOSSARY-IN-INSTRUMENTS, PERF-ORDER-VERDICT, ANALYSIS-LAYOUT-SPACE):
 *
 *   1. LA-AXIS: spi-595 at 1 µs/格 (1440 px) and uart-hello on a 390 px phone —
 *      an absolute anchor, then 「+1 µs」 offsets; the label boxes are disjoint;
 *   2. GLOSSARY: the tray of uart-hello (terminal, analyzer), pwm-fade (scope,
 *      analyzer) and i2c-scan (analyzer) holds at least one term each;
 *   3. UART-RX / TIMESTAMPS: the send box says the bytes go out through the USB-TTL
 *      adapter as UART frames on PA10 (115 200 Bd · 8N1); typing 「hi」 in uart-hello
 *      gives the real 解碼結果 row 「UART · PA10 RX "hi…" OK」 before the firmware's
 *      「UART · PA9 TX "echo: hi…"」; the row centres the PA10 lane on the frames;
 *      「在邏輯分析儀中檢視」 on the sent (echoed) line reveals those RX frames;
 *      tick 1 is stamped 1.001 420 s; one decimal count;
 *   4. DECODE-SUMMARY: i2c-scan shows the three answering addresses above the table;
 *   5. rc-lowpass: FG1 輸出 and R1 第 1 腳 read 「方波 100 Hz · 0–5.00 V」, 量測
 *      lists FG1; the scope's CH2 reads 上升時間 ≈ 2.2 ms and no 工作週期; one
 *      trigger chip; the A / B cursors read every channel;
 *   6. blink in the analysis layout opens 各通道量測 by itself: 週期 1.002 s ·
 *      高電位時間 501 ms;
 *   7. PERF: the diagnostics card leads with the verdict, 模擬 first.
 *
 *   UX_E2E_URL=http://localhost:5385/ node scripts/ux-e2e/instruments-clarity.mjs
 *
 * Needs a dev server WITHOUT hot reload (view state is read from /src
 * modules). msedge, headless, zh-TW. Exit 1 on failure.
 */
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

async function boot(browser, { phone = false, extra = {} } = {}) {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([phone, extra]) => {
      if (sessionStorage.getItem('ux-e2e-seeded')) return
      sessionStorage.setItem('ux-e2e-seeded', '1')
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.layout', JSON.stringify({ version: 1, components: [], wires: [] }))
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: !phone }))
      localStorage.setItem('bb.lang', 'zh-TW')
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
    },
    [phone, extra],
  )
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

const withModule = (page, path, fn, arg) =>
  page.evaluate(
    async ([p, src, a]) => {
      const m = await import(p)
      return await new Function('m', 'a', `return (async () => { ${src} })()`)(m, a)
    },
    [path, fn, arg],
  )
const simTime = (page) => page.evaluate(() => window.__e2e.state().simTime)
async function openAndRun(page, id, seconds) {
  await withModule(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await page.waitForTimeout(1200)
  await withModule(page, '/src/state/store.ts', 'm.useStore.getState().startSim()')
  await waitSim(page, seconds)
}
const showTab = (page, tab) => withModule(page, '/src/ui/embedded/lab.ts', `const l = m.useLab.getState(); l.setWorkspace({ tray: { ...l.workspace.tray, open: true, tab: ${JSON.stringify(tab)} } })`)
const stop = (page) => withModule(page, '/src/state/store.ts', 'm.useStore.getState().stopSim()')
/** the axis label boxes the analyzer drew (its canvas' data-axis: x:w:text|…) */
async function axisBoxes(page) {
  const a = await page.evaluate(() => [...document.querySelectorAll('canvas.emb-la-canvas')].find((x) => x.offsetParent !== null)?.dataset.axis ?? '')
  return a
    .split('|')
    .filter(Boolean)
    .map((s) => {
      const [x, w, ...t] = s.split(':')
      return { x: Number(x), w: Number(w), t: t.join(':') }
    })
}
const disjoint = (b) => b.length >= 2 && b.every((x, i) => i === 0 || x.x >= b[i - 1].x + b[i - 1].w)

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  // ---- 1. LA-AXIS
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'spi-595', 1.2)
    await showTab(page, 'logic')
    await stop(page)
    const now = await simTime(page)
    await withModule(page, '/src/ui/embedded/instruments/la-view.ts', `m.manualLaView({ span: 1e-5, end: ${now} })`)
    await page.waitForTimeout(1500)
    const b = await axisBoxes(page)
    check('LA-AXIS spi-595 1 µs/格: anchor + 「+n µs」 offsets, label boxes disjoint', disjoint(b) && / s$/.test(b[0].t) && b.slice(1).every((x) => /^\+\d+ µs$/.test(x.t)), b.map((x) => x.t))
    check('LA-AXIS spi-595: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser, { phone: true })
    await openAndRun(page, 'uart-hello', 1.2)
    await withModule(page, '/src/ui/chrome/instrument-sheet.ts', `m.showInstrument('logic')`)
    await page.waitForTimeout(2500)
    const b = await axisBoxes(page)
    check('LA-AXIS uart-hello phone 390 px: label boxes disjoint', disjoint(b) && b.slice(1).every((x) => x.t.startsWith('+')), b.map((x) => `${x.x}+${x.w} ${x.t}`))
    check('LA-AXIS phone: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- 2. GLOSSARY: terms per instrument
  for (const [id, tab] of [
    ['uart-hello', 'uart'],
    ['uart-hello', 'logic'],
    ['pwm-fade', 'scope'],
    ['pwm-fade', 'logic'],
    ['i2c-scan', 'logic'],
  ]) {
    const { ctx, page } = await boot(browser)
    await openAndRun(page, id, 1.0)
    await showTab(page, tab)
    await page.waitForTimeout(2500)
    if (tab === 'scope') await withModule(page, '/src/ui/embedded/instruments/scope-autoset.ts', 'await m.runScopeAutoSetup()')
    await page.waitForTimeout(1200)
    const labels = await page.locator('.ws-tray .insp-term').allInnerTexts()
    check(`GLOSSARY ${id} · ${tab}: at least one explained term`, labels.length >= 1, labels.map((x) => x.replace(/\s+/g, '')).slice(0, 8))
    await ctx.close()
  }
  // ---- 3. UART-RX / UART-TIMESTAMPS
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'uart-hello', 4.5)
    await showTab(page, 'uart')
    // the sent line shows in the transcript (local echo) — 「在邏輯分析儀中檢視」 on it reads the RX wire
    await withModule(page, '/src/ui/embedded/lab.ts', 'm.useLab.getState().setTerminal({ timestamps: true, localEcho: true })')
    const FREE = '輸入的文字會經 USB 轉 TTL 轉接器（3.3 V），以 UART 訊框送上 PA10（115 200 Bd · 8N1）'
    await page.waitForFunction((s) => document.querySelector('.emb-term-hint')?.textContent === s, FREE, { timeout: 20000 }).catch(() => {})
    const hint = await page.locator('.emb-term-hint').innerText().catch(() => '')
    check('UART-RX the send box says the bytes go out as frames on PA10 through the USB-TTL adapter', hint === FREE, hint)
    await page.locator('.emb-term-input').fill('hi')
    await page.locator('.emb-term-input').press('Enter')
    const t0 = await simTime(page)
    await waitSim(page, t0 + 0.6)
    await page.waitForTimeout(2200)
    const tick1 = (await page.locator('.emb-term-line').allInnerTexts()).find((x) => /tick 1\b/.test(x)) ?? ''
    check('UART-TIMESTAMPS tick 1 at 1.001 420 s (or ≈ 1.00 s), never ≈ 0.997 s', /(1\.001 420 s|≈ 1\.00 s)/.test(tick1) && !/0\.997/.test(tick1), tick1)
    const stamps = await page.locator('.emb-term-line:not(.is-echo) .emb-term-ts').allInnerTexts()
    check('UART-TIMESTAMPS one decimal count for every line', new Set(stamps.map((s) => /\.([\d ]+) s/.exec(s)?.[1].replace(/ /g, '').length)).size === 1, stamps.slice(0, 4))
    await showTab(page, 'logic')
    await stop(page)
    await withModule(page, '/src/ui/embedded/instruments/la-view.ts', 'm.setLaView({ results: true })')
    await page.waitForTimeout(2500)
    await page.locator('.lai-results-search').fill('hi')
    await page.waitForTimeout(800)
    const rows = (await page.locator('.lai-results-list').innerText()).replace(/\n+/g, ' ¦ ')
    const rx = rows.search(/UART · PA10 RX ¦ "hi\\n" ¦ OK/)
    const echo = rows.search(/UART · PA9 TX ¦ "echo: hi/)
    check('UART-RX 解碼結果: the real 「UART · PA10 RX "hi\\n" OK」 row before the firmware’s 「UART · PA9 TX "echo: hi…"」', rx >= 0 && echo > rx && !/直接送入|終端機 ¦/.test(rows), rows.slice(0, 240))
    // the RX row centres the waveform on its frames: the PA10 lane holds them (no 「還沒有訊框」 note)
    const rxT = await page.locator('.lai-results-row', { hasText: 'PA10 RX' }).first().locator('.lai-results-t').innerText()
    await page.locator('.lai-results-row', { hasText: 'PA10 RX' }).first().click()
    await page.waitForTimeout(1500)
    const at = Number(rxT.replace(/[\s s]/g, ''))
    const view = await withModule(page, '/src/ui/embedded/instruments/la-view.ts', 'const v = m.useLaView.getState(); return { a: v.markers.a, t0: v.end - v.span, t1: v.end }')
    check('UART-RX the PA10 RX row centres the lane on its frames, marker A on the first start bit', Math.abs(view.a - at) < 2e-6 && view.t0 < at && view.t1 > at && (await page.locator('.lai-thr.is-rx').count()) === 0, { rxT, view })
    const sum = (await page.locator('.lai-results-sum').innerText()).replace(/\n+/g, ' ')
    check('DECODE-SUMMARY UART: 「PA9 TX n 行 · PA10 RX 1 行」', /PA9 TX \d+ 行 · PA10 RX 1 行/.test(sum), sum)
    // 「在邏輯分析儀中檢視」 on the sent line: the frames the adapter put on PA10, marker A on their first start bit
    // (the function the terminal's reveal button calls — uart-reveal.ts revealUartLine with echo)
    await withModule(page, '/src/ui/embedded/instruments/la-view.ts', "m.manualLaView({ span: 1, end: 1 }); m.setLaView({ markers: { a: null, b: null } })")
    const sent = await withModule(
      page,
      '/src/ui/embedded/instruments/uart-sent.ts',
      'const s = m.useUartSends.getState().sends.at(-1); return s ? { t: s.t, bytes: s.bytes } : null',
    )
    const config = await withModule(page, '/src/ui/embedded/lab.ts', "return m.useLab.getState().mcus.U1?.uarts.find((u) => u.name === 'USART1')?.config ?? null")
    await withModule(
      page,
      '/src/ui/embedded/instruments/uart-reveal.ts',
      "await m.revealUartLine({ t0: a.t, t1: a.t, bytes: a.bytes.filter((b) => b !== 10 && b !== 13), echo: true }, { componentId: 'U1', port: 'USART1', config: a.config })",
      { ...sent, config },
    )
    await page.waitForTimeout(1200)
    const shown = await withModule(page, '/src/ui/embedded/instruments/la-view.ts', 'const v = m.useLaView.getState(); return { a: v.markers.a, t0: v.end - v.span, t1: v.end }')
    check('UART-RX 「在邏輯分析儀中檢視」 on the sent line reveals its PA10 RX frames (marker A on the first start bit)', !!sent && Math.abs(shown.a - at) < 2e-6 && shown.t0 < at && shown.t1 > at, { sent: sent?.t, shown, at })
    check('UART: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- 4. DECODE-SUMMARY i2c-scan
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'i2c-scan', 1.2)
    await showTab(page, 'logic')
    await stop(page)
    await withModule(page, '/src/ui/embedded/instruments/la-view.ts', 'm.setLaView({ results: true })')
    await page.waitForTimeout(3000)
    const addrs = await page.locator('.lai-results-addr').allInnerTexts()
    const visible = await page.locator('.lai-results-addr').first().isVisible().catch(() => false)
    check('DECODE-SUMMARY i2c-scan: the 3 answering addresses visible without scrolling', addrs.join(',') === '0x3C,0x50,0x76' && visible, addrs)
    check('DECODE-SUMMARY i2c-scan: 內容 reads 「位址 0x… 寫」', /位址 0x[0-9A-F]+ 寫/.test(await page.locator('.lai-results-list').innerText()))
    check('i2c-scan: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- 5. rc-lowpass
  {
    const { ctx, page, errors } = await boot(browser)
    await withModule(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById('rc-lowpass')`)
    await page.waitForTimeout(1200)
    // auto-run (round 5) starts the opened example at once: the scope's 「尚未執行」 is what a
    // learner sees after pausing and resetting it (a paused simulation that is reset stays idle)
    await page.waitForFunction(() => window.__e2e.state().running === true, null, { timeout: 60000 })
    await stop(page)
    await withModule(page, '/src/state/store.ts', 'm.useStore.getState().resetSim()')
    await page.waitForTimeout(500)
    await showTab(page, 'scope')
    await page.waitForTimeout(1200)
    const before = await page.locator('.sco-meas').innerText().catch(() => '')
    check('SCOPE before ▶: 「尚未執行」, not 「取樣不足」', /尚未執行/.test(before) && !/取樣不足/.test(before), before.replace(/\n/g, ' '))
    await withModule(page, '/src/state/store.ts', 'm.useStore.getState().startSim()')
    await waitSim(page, 1)
    await withModule(page, '/src/ui/embedded/problems.ts', `m.focusInspector('FG1', {})`)
    await page.waitForTimeout(1200)
    const fg = (await page.locator('#pin-FG1-out').innerText().catch(() => '')).replace(/\n/g, ' ')
    check('FG-RAIL FG1 輸出: 「方波 100 Hz · 0–5.00 V」', /方波 100 Hz · 0–5\.00 V/.test(fg), fg)
    await withModule(page, '/src/ui/embedded/problems.ts', `m.focusInspector('R1', {})`)
    await page.waitForTimeout(1200)
    const r1 = (await page.locator('[id^="pin-R1-"]').first().innerText().catch(() => '')).replace(/\n/g, ' ')
    check('FG-RAIL R1 第 1 腳: 「方波 100 Hz · 0–5.00 V」', /方波 100 Hz · 0–5\.00 V/.test(r1), r1)
    await showTab(page, 'measure')
    await page.waitForTimeout(2000)
    const meas = (await page.locator('.meas-view').innerText()).replace(/\n/g, ' | ')
    check('MEASURE-COHERENCE 量測 lists FG1 and the probes', /FG1 \| 函數產生器 \| 方波 100 Hz/.test(meas) && /PRB1/.test(meas), meas.slice(0, 220))
    await showTab(page, 'scope')
    await withModule(page, '/src/ui/embedded/instruments/scope-autoset.ts', 'await m.runScopeAutoSetup()')
    await page.waitForTimeout(2500)
    const ch2 = ((await page.locator('.sco-meas').innerText()).replace(/\n/g, ' ').split('CH2')[1] ?? '')
    check('SCOPE-READOUT-TRIGGER CH2: 上升時間 ≈ 2.2 ms, no 工作週期', /上升時間（10–90 %）\s*ⓘ?\s*≈ 2\.[12]\d? ms/.test(ch2) && !/工作週期/.test(ch2), ch2)
    const chip = (await page.locator('.sco-bar .lai-chip-text').innerText().catch(() => '')).trim()
    check('SCOPE-READOUT-TRIGGER one trigger chip with every field named', /^觸發：CH1 ↑ 上升緣 · 準位 [\d.]+ V · 自動/.test(chip), chip)
    await stop(page)
    await withModule(page, '/src/ui/embedded/instruments/scope-settings.ts', "m.useScopeSettings.getState().set({ cursors: 'time' })")
    await page.waitForTimeout(1000)
    const cur = (await page.locator('.sco-cursor-line').innerText()).replace(/\n/g, ' ')
    check('SCOPE-CURSORS 「A −… · CH1 · CH2 ｜ B … ｜ Δt · 1/Δt」', /A\s*−[\d.]+ m?s.*CH1.*CH2.*B\s*[\d.]+ m?s.*Δt.*1\/Δt/.test(cur), cur)
    check('rc-lowpass: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- 6. blink in the analysis layout
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'blink', 6)
    await showTab(page, 'logic')
    await page.mouse.click(700, 300)
    await page.keyboard.press('Shift+A')
    await page.waitForTimeout(2500)
    check('ANALYSIS-LAYOUT-SPACE blink: 各通道量測 opens by itself', await page.locator('.lai-meas').isVisible().catch(() => false))
    const rows = await page.locator('.lai-meas-row:not(.is-head):not(.is-ann)').allInnerTexts()
    check('LA-MEAS-NAMES blink: 週期 1.002 s · 高電位時間 501 ms', rows.some((r) => /1\.002 s/.test(r) && /501 ms/.test(r)), rows)
    check('blink: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- 7. PERF
  {
    const { ctx, page, errors } = await boot(browser, { extra: { 'bb.perfDiag': '1', 'bb.perfDiag.folded': '0' } })
    await openAndRun(page, 'blink', 1)
    await showTab(page, 'logic')
    await page.waitForTimeout(3000)
    const ok = await page.evaluate(() => {
      const card = document.querySelector('.perf-ov')?.getBoundingClientRect()
      const inCard = (el) => {
        const r = el?.getBoundingClientRect()
        return !!card && !!r && r.height > 0 && r.top >= card.top - 1 && r.bottom <= card.bottom + 1
      }
      const row = (txt) => [...document.querySelectorAll('.perf-ov-row')].find((e) => e.textContent?.includes(txt))
      return { verdict: inCard(document.querySelector('.perf-ov-verdict')), speed: inCard(row('模擬速度')), load: inCard(row('執行緒負載')), first: document.querySelector('.perf-ov-h')?.textContent }
    })
    check('PERF the capped card shows the verdict, 模擬速度 and the thread load without scrolling; 模擬 first', ok.verdict && ok.speed && ok.load && ok.first === '模擬', ok)
    check('PERF: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
