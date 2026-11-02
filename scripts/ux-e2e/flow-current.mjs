/**
 * 顯示電流 (current flow, owner: flow) — browser replay of the product
 * owner's request 「增加一個勾選，是在模擬時如果勾選可以看到電流怎麼流（粒子
 * 流動的感覺）」.
 *
 *   UX_E2E_URL=http://localhost:5412/ node scripts/ux-e2e/flow-current.mjs
 *
 * Fresh zh-TW profiles (desktop workspace 1440×900 with a mouse; phone
 * 390×844 touch, DPR 2; the English classic chrome), REAL clicks / keys:
 *   A  blink: no chip before the first run; running → the 「顯示電流」 chip
 *      sits right of the run capsule, unchecked; a click checks it, the
 *      legend toast 「光點越快越密＝電流越大，方向＝由正到負」 shows, particles
 *      appear;
 *   B  blink: the particles pulse with the LED — the PA5 wire (W7) carries
 *      current exactly in the frames the LED is lit, from PA5 (a20) toward
 *      the resistor; the GND return wire (W6) runs rail → board;
 *      LED pinCurrents = W7's current in the same telemetry;
 *   C  pause freezes the particles (positions identical over 600 ms);
 *   D  the C key toggles off / on with a toast;
 *   E  parallel LEDs (330 Ω vs 3.3 kΩ): the brighter LED carries ~10× the
 *      current, its particles run faster, the supply wire carries the sum;
 *   F  an MCU SINKING an LED (3.3 V rail → LED → R → PA5): current flows INTO
 *      PA5, lit in the frames PA5 is low;
 *   G  phone (390 × 844 and 375 × 812): the chip beside the capsule keeps a
 *      visible short label 「電流」 next to its box (P2), clear of the
 *      capsule; a tap turns it on;
 *   H  classic chrome (English): no chip; the layer still works when the
 *      preference is set programmatically;
 *   I  the legacy 555 (examples/blinky-555.json, F5): while the LED is lit
 *      the chip takes its OUT current in at VCC and the bench supply's +
 *      wire carries exactly what its − wire carries back — a closed loop;
 *   J  the 555 on a 9 V battery behind an LM7805: the engine names the
 *      regulator to the tracker, so while the LED is lit the WHOLE loop
 *      shows (battery + wire = − wire) — never a broken loop, and no
 *      「無法完整追蹤」 note;
 *   K  a 7404 whose VCC comes through 10 Ω: no particles anywhere, and once
 *      per run the honest note 「U1 的電流迴路無法完整追蹤，暫不顯示它的光點」;
 *   L  a 7404 on the Blue Pill 3V3 pin: its output current closes through
 *      the board's regulator and the bench supply (+ wire = − wire);
 *   M  turned on while paused: 「執行模擬時就會看到」, and the legend toast
 *      comes when the run resumes (not spent while nothing can be seen).
 * Exit code 1 on any failed assertion. UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(cond, what, extra = '') {
  const x = typeof extra === 'string' ? extra : JSON.stringify(extra)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${x ? `  (${x.length > 400 ? x.slice(0, 400) + '…' : x})` : ''}`)
  if (!cond) failures++
  return cond
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ lang = 'zh-TW', workspace = true, phone = false, flow = false, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([lang, ws, flow]) => {
      if (sessionStorage.getItem('flow.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      if (flow) localStorage.setItem('bb.flow', '1')
      sessionStorage.setItem('flow.seeded', '1')
    },
    [lang, workspace && !phone, flow],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 150000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 90000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1500)
  return { ctx, page, errors }
}

const mod = (page, p, src, arg) =>
  page.evaluate(
    async ([p, s, a]) => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new globalThis.URL(n).pathname === p) ?? p
      const m = await import(url)
      const F = Object.getPrototypeOf(async function () {}).constructor
      return await new F('m', 'a', s)(m, a)
    },
    [p, src, arg],
  )
const store = (page, src, arg) => mod(page, '/src/state/store.ts', src, arg)
const openExample = async (page, id) => {
  const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await sleep(1500)
  return r
}
async function runFor(page, simSeconds, maxMs = 90000) {
  const t0 = await store(page, 'return m.useStore.getState().simTime')
  await store(page, 'm.useStore.getState().startSim()')
  const w0 = Date.now()
  let t = t0
  while (Date.now() - w0 < maxMs) {
    await sleep(250)
    t = await store(page, 'return m.useStore.getState().simTime')
    if (t - t0 >= simSeconds) break
  }
  return t
}
const stats = (page) => page.evaluate(() => (window.__flowStats ? window.__flowStats() : null))
const paths = (page) => page.evaluate(() => (window.__flowPaths ? window.__flowPaths() : []))
const comp = (page, id) => page.evaluate((id) => window.__e2e.component(id), id)
const chip = (page) => page.locator('.app-flow-chip')
const toasts = async (page) => (await page.locator('.lg-toast').allInnerTexts().catch(() => [])).join(' | ')
const shot = async (page, name) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `flow-${name}.png`) })
}
const box = async (loc) => (await loc.count()) > 0 ? await loc.first().boundingBox() : null

// ---------------------------------------------------------------- desktop
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  // A — no chip before the first run
  check((await chip(page).count()) === 0, 'A: no 顯示電流 chip while nothing has run (idle)')
  await runFor(page, 0.6)
  const c = chip(page)
  check((await c.count()) === 1, 'A: running → the chip shows')
  check((await c.innerText()).includes('顯示電流'), 'A: chip label 「顯示電流」', await c.innerText())
  check((await c.getAttribute('aria-checked')) === 'false', 'A: unchecked by default')
  const cap = await box(page.locator('.lg-capsule-wrap .lg-capsule:not(.is-expanded)'))
  const cb = await box(c)
  check(!!cap && !!cb && cb.x >= cap.x + cap.width && cb.x - (cap.x + cap.width) < 24 && Math.abs(cb.y + cb.height / 2 - (cap.y + cap.height / 2)) < 6, 'A: the chip sits right beside the capsule, centred on it', { cap, cb })
  const title = await c.getAttribute('title')
  check(!!title && title.includes('光點越快越密＝電流越大，方向＝由正到負'), 'A: tooltip carries the legend', title)
  check(((await stats(page))?.visible ?? false) === false, 'A: no particles before the box is checked')
  await c.click()
  await sleep(400)
  check((await c.getAttribute('aria-checked')) === 'true', 'A: a click checks it')
  check((await toasts(page)).includes('光點越快越密＝電流越大，方向＝由正到負'), 'A: first use → legend toast', await toasts(page))
  await sleep(1500)
  const s1 = await stats(page)
  check(!!s1 && s1.visible && s1.heads > 10, 'A: particles flow (heads > 10)', s1)
  check(await page.evaluate(() => localStorage.getItem('bb.flow')) === '1', 'A: the choice is remembered (bb.flow)')
  // zoomed view for the record
  await page.evaluate(() => window.__shotRig.setCamera(30, 16, 22, 34, 0, 6))
  await sleep(700)
  await shot(page, 'blink-desk')

  // B — pulses with the LED; directions; pin current = wire current
  let lit = 0
  let dark = 0
  let agree = 0
  let same = 0
  let sameN = 0
  let dirOk = 0
  let dirN = 0
  for (let k = 0; k < 40; k++) {
    await sleep(110)
    const [led, ps] = await Promise.all([comp(page, 'LED1'), paths(page)])
    const w7 = ps.find((p) => p.key === 'w:W7')
    const w6 = ps.find((p) => p.key === 'w:W6')
    const b = led?.ledBrightness ?? 0
    if (b > 0.15) {
      lit++
      if (w7 && w7.amps > 1e-3) agree++
      if (w7 && w6) {
        dirN++
        if (w7.amps > 0 && w6.amps < 0) dirOk++
      }
    } else if (b < 0.01) {
      dark++
      if (!w7 || Math.abs(w7.amps) < 1e-3) agree++
    }
    const pc = led?.pinCurrents?.anode
    if (typeof pc === 'number' && pc > 1e-3) {
      sameN++
      // the scene shows the newest telemetry; both come from it
      if (w7 && Math.abs(w7.amps - pc) / pc < 0.35) same++
    }
  }
  check(lit >= 6 && dark >= 6, 'B: the sampled window saw the LED lit and dark', { lit, dark })
  check(agree >= 0.8 * (lit + dark), 'B: W7 particles exactly while the LED is lit (≥ 80 % of samples)', { agree, of: lit + dark })
  check(dirN > 0 && dirOk === dirN, 'B: PA5 → resistor on W7, rail → GND pin on W6', { dirOk, dirN })
  check(sameN > 0 && same >= 0.7 * sameN, 'B: the particles carry the LED’s own pin current', { same, sameN })

  // C — pause freezes
  await store(page, 'm.useStore.getState().stopSim()')
  await sleep(900)
  const f1 = await stats(page)
  await sleep(600)
  const f2 = await stats(page)
  check(!!f1 && !!f2 && f1.heads > 0 && f1.sig === f2.sig, 'C: paused → particles frozen in place (still shown)', { f1: f1?.sig, f2: f2?.sig, heads: f1?.heads })

  // D — the C key
  await page.locator('canvas').first().click({ position: { x: 700, y: 400 } }).catch(() => {})
  await page.keyboard.press('Escape')
  await page.keyboard.press('c')
  await sleep(500)
  check((await c.getAttribute('aria-checked')) === 'false', 'D: C key → off')
  check((await toasts(page)).includes('已關閉電流顯示'), 'D: toast 「已關閉電流顯示」', await toasts(page))
  check(((await stats(page))?.visible ?? false) === false, 'D: particles gone')
  await page.keyboard.press('c')
  await sleep(500)
  check((await c.getAttribute('aria-checked')) === 'true', 'D: C key → on again')

  // E — parallel LEDs, very different currents
  const parallel = {
    version: 1,
    name: 'parallel LEDs',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
      { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
      { id: 'R2', type: 'resistor', holes: ['top+13', 'a24'], params: { resistance: 3300 } },
      { id: 'LED2', type: 'led', holes: ['b24', 'top-17'], params: { color: 'red' } },
    ],
    wires: [
      { id: 'WP', from: 'PS1:+', to: 'top+0', color: 'red' },
      { id: 'WN', from: 'PS1:-', to: 'top-0', color: 'black' },
    ],
  }
  await store(page, 'm.useStore.getState().resetSim?.()')
  await store(page, 'm.useStore.getState().loadLayout(a)', parallel)
  await sleep(800)
  await runFor(page, 0.3)
  await sleep(1200)
  const l1 = await comp(page, 'LED1')
  const l2 = await comp(page, 'LED2')
  const ps = await paths(page)
  const p1 = ps.find((p) => p.key === 'p:LED1')
  const p2 = ps.find((p) => p.key === 'p:LED2')
  const wp = ps.find((p) => p.key === 'w:WP')
  const i1 = l1?.pinCurrents?.anode ?? 0
  const i2 = l2?.pinCurrents?.anode ?? 0
  check(i1 > 0.008 && i2 > 0.0005 && i1 / i2 > 6, 'E: 330 Ω branch carries ~10× the 3.3 kΩ branch', { i1, i2 })
  check((l1?.ledBrightness ?? 0) > (l2?.ledBrightness ?? 0), 'E: and its LED is brighter', { b1: l1?.ledBrightness, b2: l2?.ledBrightness })
  check(!!p1 && !!p2 && p1.speed > p2.speed * 1.4, 'E: its particles run clearly faster', { s1: p1?.speed, s2: p2?.speed })
  check(!!wp && Math.abs(wp.amps - (i1 + i2)) / (i1 + i2) < 0.05, 'E: the supply wire carries I1 + I2', { wp: wp?.amps, sum: i1 + i2 })
  await page.evaluate(() => window.__shotRig.setCamera(14, 14, 18, 15, 0, 3))
  await sleep(800)
  await shot(page, 'parallel-desk')

  // F — an MCU sinking an LED: 3V3 rail → LED → R → PA5 (blink toggles PA5)
  await store(page, 'm.useStore.getState().stopSim()')
  await openExample(page, 'blink')
  const sink = await store(page, 'return m.useStore.getState().layout')
  sink.components = sink.components.map((p) =>
    p.id === 'LED1' ? { ...p, holes: ['top+32', 'b40'] } : p,
  )
  await store(page, 'm.useStore.getState().loadLayout(a)', sink)
  await sleep(1000)
  await runFor(page, 0.5)
  let into = 0
  let litN = 0
  for (let k = 0; k < 30; k++) {
    await sleep(120)
    const [u1, led, ps2] = await Promise.all([comp(page, 'U1'), comp(page, 'LED1'), paths(page)])
    if ((led?.ledBrightness ?? 0) > 0.15) {
      litN++
      const pa5 = u1?.pinCurrents?.PA5 ?? 0
      const w7 = ps2.find((p) => p.key === 'w:W7')
      if (pa5 > 1e-3 && w7 && w7.amps < -1e-3) into++
    }
  }
  check(litN >= 4 && into >= 0.8 * litN, 'F: lit frames: current flows INTO PA5 (pinCurrents.PA5 > 0, W7 runs resistor → PA5)', { into, litN })
  await shot(page, 'sink-desk')
  check(errors.length === 0, 'desktop: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ---------------------------------------------------------------- phone
for (const [W, H] of [
  [390, 844],
  [375, 812],
]) {
  const { ctx, page, errors } = await open({ phone: true, width: W, height: H })
  await openExample(page, 'blink')
  await runFor(page, 0.5)
  const c = chip(page)
  check((await c.count()) === 1, `G ${W}: phone — the chip shows while running`)
  const cb = await box(c)
  const cap = await box(page.locator('.lg-capsule-wrap .lg-capsule:not(.is-expanded)'))
  check(!!cb && cb.x >= 0 && cb.x + cb.width <= W && !!cap && (cb.x >= cap.x + cap.width || cb.y >= cap.y + cap.height), `G ${W}: inside the screen, clear of the capsule`, { cb, cap })
  check(!!cb && cb.width >= 34 && cb.height >= 34, `G ${W}: a finger-sized target (≥ 34 px)`, cb)
  // P2: a visible short label beside the box, not a bare □⚡
  const label = c.locator('.app-flow-label:not(.app-flow-measure)')
  const lb = await box(label)
  check((await label.count()) === 1 && (await label.innerText()).trim() === '電流' && !!lb && lb.width > 10 && (await label.isVisible()), `G ${W}: the chip shows its short label 「電流」`, { text: (await label.count()) ? await label.innerText() : null, lb })
  check(!!cb && !!cap && cb.x - (cap.x + cap.width) >= 6, `G ${W}: at least 6 px from the capsule (not crowding it)`, { gap: cb && cap ? cb.x - (cap.x + cap.width) : null })
  await c.tap()
  await sleep(1500)
  check((await c.getAttribute('aria-checked')) === 'true', `G ${W}: a tap checks it`)
  const s = await stats(page)
  check(!!s && s.visible && s.heads > 10, `G ${W}: particles on the phone`, s)
  await shot(page, `blink-phone-${W}`)
  check(errors.length === 0, `phone ${W}: no page errors`, errors.slice(0, 3))
  await ctx.close()
}

// ---------------------------------------------------------------- legacy 555: a closed loop (F5)
{
  const { ctx, page, errors } = await open({ flow: true })
  const raw = JSON.parse(readFileSync(new globalThis.URL('../../examples/blinky-555.json', import.meta.url), 'utf8'))
  await store(page, 'm.useStore.getState().loadLayout(a)', raw.layout ?? raw)
  await sleep(1200)
  await runFor(page, 0.6)
  let lit = null
  for (let i = 0; i < 40 && !lit; i++) {
    const t = await store(page, 'const T = m.useStore.getState().telemetry; return T ? { wc: T.wireCurrents ?? null, u1: T.components.U1?.pinCurrents ?? null, d1: T.components.D1?.pinCurrents ?? null } : null')
    if (t && t.wc && t.u1 && (t.d1?.anode ?? 0) > 1e-3) lit = t
    else await sleep(120)
  }
  check(!!lit, 'I: 555 — a frame with the LED lit')
  if (lit) {
    const led = lit.d1.anode
    check(lit.u1.OUT < -0.9 * led && Math.abs(lit.u1.VCC + lit.u1.OUT) < 1e-6, 'I: the chip takes its OUT current in at VCC', lit.u1)
    const plus = lit.wc.w1 ?? lit.wc.W1
    const minus = lit.wc.w2 ?? lit.wc.W2
    check(typeof plus === 'number' && plus > led && Math.abs(plus + minus) < 1e-6, 'I: the + supply wire carries what the − wire carries back', { plus, minus, led })
  }
  const s = await stats(page)
  check(!!s && s.visible && s.heads > 10, 'I: particles on the 555 circuit', s)
  await shot(page, '555-loop')
  check(errors.length === 0, '555: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ------------------------------------- chips whose loop cannot be closed: dark, never broken (F5 fallback)
{
  const { ctx, page, errors } = await open({ flow: true, workspace: false })
  const sample = async (ms) => {
    const out = []
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const t = await store(page, 'const T = m.useStore.getState().telemetry; return T ? { wc: T.wireCurrents ?? {}, lit: (T.components.D1?.current ?? T.components.LED1?.current ?? 0) > 1e-3 } : null')
      const p = await paths(page)
      if (t) out.push({ ...t, paths: p.map((x) => x.key) })
      await sleep(150)
    }
    return out
  }
  // J: blinky-555 on a 9 V battery behind an LM7805 (the verifier's q11) — the engine tells the
  // tracker that U2 is a regulator: OUT's sourcing current returns through the 7805 and the
  // battery, so the lit LED shows the WHOLE loop (and still never a broken one)
  const raw = JSON.parse(readFileSync(new globalThis.URL('../../examples/blinky-555.json', import.meta.url), 'utf8'))
  const L = structuredClone(raw.layout ?? raw)
  L.components = L.components.filter((c) => c.id !== 'PS1')
  L.components.push({ id: 'BAT1', type: 'battery_9v' }, { id: 'U2', type: 'lm7805', holes: ['c40', 'c41', 'c42'] })
  L.wires = L.wires.filter((w) => !w.from.startsWith('PS1'))
  L.wires.push({ id: 'b1', from: 'BAT1:-', to: 'top-0' }, { id: 'b2', from: 'BAT1:+', to: 'a40' }, { id: 'r1', from: 'a41', to: 'top-38' }, { id: 'r2', from: 'a42', to: 'top+39' })
  await store(page, 'm.useStore.getState().loadLayout(a)', L)
  await sleep(1200)
  await runFor(page, 1.0)
  const sj = await sample(3500)
  check(sj.some((x) => x.lit) && sj.some((x) => !x.lit), 'J: 7805-fed 555 — the sampled window saw the LED lit and dark', { lit: sj.filter((x) => x.lit).length, of: sj.length })
  const brokenJ = sj.filter((x) => {
    if (x.paths.length === 0) return false
    const b1 = x.wc.b1
    const b2 = x.wc.b2
    return !(typeof b1 === 'number' && typeof b2 === 'number' && Math.abs(b1 + b2) < 1e-6) // a shown loop must close at the battery
  })
  check(brokenJ.length === 0, 'J: never a broken loop — either the whole loop (battery + = −) or nothing', brokenJ.slice(0, 2))
  check(sj.every((x) => (x.paths.length === 0) === (Object.keys(x.wc).length === 0)), 'J: no particle without a published wire current', sj.slice(0, 2).map((x) => x.paths.length))
  const closedJ = sj.filter((x) => x.lit && x.paths.length > 0 && typeof x.wc.b2 === 'number' && Math.abs(x.wc.b1 + x.wc.b2) < 1e-6)
  check(closedJ.length > 0 && closedJ.length === sj.filter((x) => x.lit).length, 'J: every lit frame shows the closed loop through the 7805 and the battery', { closed: closedJ.length, lit: sj.filter((x) => x.lit).length })
  check(!(await toasts(page)).includes('無法完整追蹤'), 'J: no 「無法完整追蹤」 note — the loop closes', await toasts(page))
  await shot(page, '7805-loop')
  // K: a 7404 whose VCC comes through 10 Ω (the verifier's q10): dark around the chip
  await store(page, 'm.useStore.getState().stopSim()')
  await store(page, 'm.useStore.getState().loadLayout(a)', {
    version: 1,
    name: 'nopath',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'U1', type: 'sn7404', at: 'f20' },
      { id: 'RL', type: 'resistor', holes: ['j21', 'bot-22'], params: { resistance: 330 } },
      { id: 'LED1', type: 'led', holes: ['j30', 'bot-31'], params: { color: 'red' } },
      { id: 'RF', type: 'resistor', holes: ['top+5', 'a50'], params: { resistance: 10 } },
    ],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+0' }, { id: 'W2', from: 'PS1:-', to: 'top-0' }, { id: 'W3', from: 'top-1', to: 'bot-1' },
      { id: 'Wv', from: 'a20', to: 'b50' }, { id: 'Wg', from: 'j26', to: 'bot-26' }, { id: 'Wo', from: 'g21', to: 'g30' },
    ],
  })
  await sleep(1200)
  await runFor(page, 0.5)
  const kNote = await toasts(page)
  const sk = await sample(1500)
  check(sk.length > 0 && sk.every((x) => x.paths.length === 0), 'K: VCC through a resistor — no particles anywhere (Wo / LED1 / rails dark)', sk.slice(-1)[0])
  check(kNote.includes('U1 的電流迴路無法完整追蹤，暫不顯示它的光點'), 'K: honest, not silent — the toast names U1', kNote)
  await shot(page, '7404-concealed')
  // once per run: it does not come back while the same run goes on
  await sleep(6000)
  check(!(await toasts(page)).includes('無法完整追蹤'), 'K: said once per run (gone, not repeated)', await toasts(page))
  check(errors.length === 0, 'J/K: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ----------------------------- L: a chip on the Blue Pill 3V3 pin closes through the board regulator
{
  const { ctx, page, errors } = await open({ flow: true, workspace: false })
  const L = await mod(page, '/src/model/breadboard.ts', `
    const cat = await import('/src/model/catalog.ts')
    const BP = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
    const U2 = { id: 'U2', type: 'sn7404', at: 'f40' }
    const hole = (comp, pin, row) => {
      const e = cat.CATALOG[comp.type]; const h = m.componentPinHoles(comp, e)[e.pins.indexOf(pin)]
      return m.formatHole(row ? { ...h, row: row(h.row) } : h)
    }
    const tap = (pin) => hole(BP, pin, (r) => (r === 'c' ? 'a' : 'j'))
    const u = (pin, r) => hole(U2, pin, () => r)
    return { version: 1, name: 'bp33', components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP, U2,
      { id: 'R1', type: 'resistor', holes: [u('1Y', 'j'), 'j49'], params: { resistance: 330 } },
      { id: 'D1', type: 'led', holes: ['i49', 'bot-44'], params: { color: 'green' } },
    ], wires: [
      { id: 'Wp', from: 'PS1:+', to: tap('5V') }, { id: 'Wn', from: 'PS1:-', to: 'top-0' },
      { id: 'Wg1', from: tap('GND3'), to: 'top-1' }, { id: 'Wb', from: 'top-3', to: 'bot-3' },
      { id: 'W33', from: tap('3V3_1'), to: u('VCC', 'a') }, { id: 'Wg2', from: u('GND', 'j'), to: 'bot-47' },
    ] }`)
  await store(page, 'm.useStore.getState().loadLayout(a)', L)
  await sleep(1200)
  await runFor(page, 0.6)
  await sleep(800)
  const t = await store(page, 'const T = m.useStore.getState().telemetry; return { wc: T.wireCurrents ?? {}, u2: T.components.U2?.pinCurrents ?? {}, u1: T.components.U1?.pinCurrents ?? {}, d1: T.components.D1?.current ?? 0 }')
  check(t.d1 > 1e-3 && Math.abs(t.u2.VCC + t.u2['1Y']) < 1e-6, 'L: the 7404 takes 1Y’s current in at VCC (from the Blue Pill 3V3 pin)', { VCC: t.u2.VCC, '1Y': t.u2['1Y'] })
  check(Math.abs(t.wc.W33 - t.u2.VCC) < 1e-6 && Math.abs(t.u1['3V3_1'] + t.u2.VCC) < 1e-6, 'L: the 3V3 wire carries it, out of the board’s 3V3 pin (its regulator)', { W33: t.wc.W33, '3V3_1': t.u1['3V3_1'] })
  check(typeof t.wc.Wp === 'number' && t.wc.Wp > t.u2.VCC && Math.abs(t.wc.Wp + t.wc.Wn) < 1e-6, 'L: the supply’s + wire carries what its − wire carries back (board + chip)', { Wp: t.wc.Wp, Wn: t.wc.Wn })
  const s = await stats(page)
  check(!!s && s.visible && s.heads > 10, 'L: particles along the whole loop', s)
  await shot(page, 'bp33-loop')
  check(errors.length === 0, 'L: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ------------------------- M: turned on while paused → the legend waits for the run, then shows
{
  const { ctx, page, errors } = await open({ workspace: false })
  await openExample(page, 'blink')
  await runFor(page, 0.3)
  await page.locator('.lg-capsule').first().click()
  await sleep(700)
  const ph = await mod(page, '/src/ui/chrome/run-control.ts', 'return m.getSimPhase()')
  check(ph === 'paused', 'M: the capsule pauses', ph)
  await chip(page).click()
  await sleep(600)
  const before = await toasts(page)
  check(before.includes('已開啟電流顯示') && !before.includes('光點越快越密'), 'M: paused → 「執行模擬時就會看到」, no legend yet', before)
  check((await page.evaluate(() => localStorage.getItem('bb.flowHint'))) !== '1', 'M: the one-time legend is not spent while nothing can be seen')
  await page.locator('.lg-capsule').first().click()
  await sleep(1500)
  const after = await toasts(page)
  check(after.includes('光點越快越密＝電流越大，方向＝由正到負'), 'M: resumed → the legend toast', after)
  check((await page.evaluate(() => localStorage.getItem('bb.flowHint'))) === '1', 'M: shown once (bb.flowHint)')
  check(errors.length === 0, 'M: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ---------------------------------------------------------------- classic chrome
{
  const { ctx, page, errors } = await open({ lang: 'en', workspace: false })
  await openExample(page, 'blink')
  await runFor(page, 0.5)
  check((await chip(page).count()) === 0, 'H: classic chrome — no chip (original top bar)')
  await mod(page, '/src/ui/fx/flow.ts', 'm.useFlowView.getState().setVisible(true)')
  await sleep(2000)
  const s = await stats(page)
  check(!!s && s.visible && s.heads > 0, 'H: classic chrome — the layer works when turned on programmatically', s)
  check(errors.length === 0, 'classic: no page errors', errors.slice(0, 3))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
