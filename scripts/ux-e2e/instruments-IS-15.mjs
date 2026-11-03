/**
 * UX fix wave — IS-15 (P1) replay: the analysis flow is not interrupted by
 * the UI (docs/ux/UX_VERIFY.md V-24, findings AN2-09, E2-06, F-13).
 *
 *   1. 「SPI 74HC595 跑馬燈」 in auto mode: clicking two markers stops the
 *      following window — 2.5 s later the window has not moved and A and B
 *      are both still on screen;
 *   2. 「I²C 匯流排掃描」: ⤢ 顯示全部記錄, then ⏭ moves to the FIRST decoded
 *      frame (marker A on it);
 *   3. 「Blue Pill 閃爍 LED」: clicks 10 px beside two edges snap to them —
 *      「Δt 501.0 ms」, both markers 「已對齊邊緣」;
 *   4. at 1440 × 900 with the library open, the decode results never overlap
 *      the analyzer's footer (bounding boxes).
 *
 *   UX_E2E_URL=http://localhost:5325/ node scripts/ux-e2e/instruments-IS-15.mjs
 *
 * Needs a dev server WITHOUT hot reload (the analyzer's view state is read
 * from its /src module). msedge, headless, zh-TW, workspace. Exit 1 on failure.
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

const withModule = (page, path, fn, arg) =>
  page.evaluate(
    async ([p, src, a]) => {
      const m = await import(p)
      return await new Function('m', 'a', `return (async () => { ${src} })()`)(m, a)
    },
    [path, fn, arg],
  )
const view = (page) =>
  withModule(page, '/src/ui/embedded/instruments/la-view.ts', 'const v = m.useLaView.getState(); return { span: v.span, end: v.end, auto: v.auto, markers: v.markers }')

async function openAndRun(page, title, seconds) {
  await page.getByRole('radio', { name: '範例' }).click()
  // the card's open pill by its accessible name (「開啟範例：…」; older builds 「開啟「…」」)
  const pill = page.getByRole('button', { name: new RegExp(`^開啟(範例：${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|「${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}」)$`) }).first()
  await pill.click()
  await page.waitForFunction(() => {
    const st = window.__e2e.state()
    return (st.layout.components ?? []).some((c) => c.id === 'U1') && !!st.firmware?.U1
  }, null, { timeout: 120000 })
  await page.waitForTimeout(800)
  // auto-run (round 5): the opened example simulates by itself once its firmware is bound —
  // nothing to press (a click on 執行模擬 / the capsule would PAUSE it now)
  await page.waitForFunction(() => window.__e2e.state().running === true, null, { timeout: 60000 })
  await waitSim(page, seconds)
  await page.locator('.ws-tray-tabs').getByText('邏輯分析儀', { exact: true }).click()
  await page.waitForTimeout(2500)
}
const rowY = async (page, i = 0) => {
  const b = await page.locator('.emb-la-label:not(.is-ann)').nth(i).boundingBox()
  return b.y + b.height / 2
}
/** client x of sim time t on the plot */
async function xOf(page, t) {
  const v = await view(page)
  const st = await page.evaluate(() => window.__e2e.state().simTime)
  const end = v.end ?? st
  const box = await page.locator('.emb-la-plot').boundingBox()
  return box.x + ((t - (end - v.span)) / v.span) * box.width
}

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'SPI 74HC595 跑馬燈', 0.6)
    const before = await view(page)
    const box = await page.locator('.emb-la-plot').boundingBox()
    const y = await rowY(page)
    await page.mouse.click(box.x + box.width * 0.4, y)
    await page.mouse.click(box.x + box.width * 0.6, y)
    const placed = await view(page)
    await page.waitForTimeout(2500)
    const later = await view(page)
    const inside = (t) => t !== null && t >= later.end - later.span && t <= later.end
    check('spi-595: the analyzer was following before the markers', before.auto === true)
    check('spi-595: 2.5 s after placing A and B the window stays and both markers are on screen', later.auto === false && later.end === placed.end && inside(later.markers.a) && inside(later.markers.b), { placed, later })
    check('spi-595: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'I²C 匯流排掃描', 1.0)
    await page.getByRole('button', { name: '顯示全部記錄' }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '下一個解碼訊框' }).click()
    await page.waitForTimeout(1500)
    const v = await view(page)
    // the scan's first transfer starts within the first few milliseconds of the run
    check('i2c-scan: ⤢ then ⏭ moves to the first decoded frame (marker A on it)', v.markers.a !== null && v.markers.a < 0.05 && v.end - v.span < 0.05, v)
    check('i2c-scan: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  // ---- QA IS-F3: ⏮ / ⏭ step from the PICKED frame, never back onto it ----
  const stepFrames = async (page, name, n) => {
    const out = []
    for (let k = 0; k < n; k++) {
      await page.getByRole('button', { name }).click()
      await page.waitForTimeout(700)
      out.push((await view(page)).markers.a)
    }
    return out
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'UART 問候與回音（終端機）', 8.5)
    await withModule(page, '/src/state/store.ts', 'm.useStore.getState().stopSim()')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: '解碼結果' }).click()
    await page.waitForTimeout(1500)
    await page.locator('.lai-results-search').fill('tick 5')
    await page.waitForTimeout(400)
    await page.locator('.lai-results-row').first().click()
    await page.waitForTimeout(700)
    await page.locator('.lai-results-search').fill('')
    const a5 = (await view(page)).markers.a
    const fwd = await stepFrames(page, '下一個解碼訊框', 2)
    const back = await stepFrames(page, '上一個解碼訊框', 3)
    const near = (x, want) => x !== null && Math.abs(x - want) < 2e-4
    check('uart-hello: 「tick 5」 picked → marker A ≈ 5.001 42 s', near(a5, 5.00142), a5)
    check('uart-hello: ⏭⏭ → 「tick 6」, 「tick 7」', near(fwd[0], 6.00142) && near(fwd[1], 7.00142), fwd)
    check('uart-hello: ⏮⏮⏮ → 6.001 420 → 5.001 420 → 4.001 420 s (never the current frame again)', near(back[0], 6.00142) && near(back[1], 5.00142) && near(back[2], 4.00142), back)
    check('uart-hello ⏮⏭: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  for (const [title, secs] of [['I²C 匯流排掃描', 0.8], ['SPI 74HC595 跑馬燈', 0.8]]) {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, title, secs)
    await withModule(page, '/src/state/store.ts', 'm.useStore.getState().stopSim()')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: '解碼結果' }).click()
    await page.waitForTimeout(1500)
    const rows = page.locator('.lai-results-row')
    const n = await rows.count()
    await rows.nth(Math.min(5, n - 1)).click()
    await page.waitForTimeout(700)
    const at = (await view(page)).markers.a
    const [prev, prev2] = await stepFrames(page, '上一個解碼訊框', 2)
    const [next] = await stepFrames(page, '下一個解碼訊框', 1)
    check(`${title}: ⏮ moves to the previous frame, ⏮ again further back`, at !== null && prev !== null && prev < at && prev2 !== null && prev2 < prev, { at, prev, prev2 })
    check(`${title}: ⏭ after ⏮⏮ returns to the frame after it`, next !== null && Math.abs(next - prev) < 1e-9, { prev, next })
    check(`${title} ⏮: no page errors`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'Blue Pill 閃爍 LED（HAL）', 3.2)
    // hold the window first (the 即時 chip, as an analyst does): a live window
    // scrolls between reading an edge's position and the click landing on it
    await page.locator('.ws-tray button', { hasText: '即時' }).first().click()
    await page.waitForTimeout(400)
    const v = await view(page)
    const st = await page.evaluate(() => window.__e2e.state().simTime)
    const end = v.end ?? st
    const cap = await page.evaluate(([a, b]) => window.__e2e.logic(a, b), [end - v.span, end])
    const pa5 = cap.traces.find((x) => x.index === 0)
    const edges = (pa5?.times ?? []).filter((t) => t > end - 0.9 * v.span && t < end - 0.1 * v.span)
    const y = await rowY(page)
    if (edges.length >= 2) {
      await page.mouse.click((await xOf(page, edges[0])) + 10, y)
      await page.waitForTimeout(300)
      await page.mouse.click((await xOf(page, edges[1])) - 10, y)
      await page.waitForTimeout(500)
    }
    const foot = (await page.locator('.lai-foot').innerText()).replace(/\n/g, ' ')
    // 「Δt ⓘ 501.0 ms」: since the release QA clarity round the Δt label carries its
    // glossary ⓘ (InstrumentTerm 'dt') between the name and the value
    check('blink: clicks 10 px off two edges → Δt 501.0 ms, both 「已對齊邊緣」', /Δt\s*(?:ⓘ\s*)?501\.0 ms/.test(foot) && (foot.match(/已對齊邊緣/g) ?? []).length === 2 && !/未對齊/.test(foot), foot)
    check('blink: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser)
    await openAndRun(page, 'I²C 匯流排掃描', 0.8)
    // the library open (a narrower tray)
    await page.evaluate(async () => {
      const m = await import('/src/ui/embedded/lab.ts')
      const l = m.useLab.getState()
      l.setWorkspace({ left: { ...l.workspace.left, open: true } })
    })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '解碼結果' }).click()
    await page.waitForTimeout(1500)
    const res = await page.locator('.lai-results').boundingBox()
    const foot = await page.locator('.lai-foot').boundingBox()
    const overlap = !!res && !!foot && res.x < foot.x + foot.width && foot.x < res.x + res.width && res.y < foot.y + foot.height && foot.y < res.y + res.height
    check('1440 with the library open: the decode results never overlap the footer', !!res && !!foot && !overlap, { res, foot })
    check('decode results: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\nIS-15: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
