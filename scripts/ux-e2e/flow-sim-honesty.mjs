/**
 * Simulation-telemetry honesty (fix round 3, owner: sim) — browser replay:
 *
 *   UX_E2E_URL=http://localhost:5451/ node scripts/ux-e2e/flow-sim-honesty.mjs
 *
 * Fresh zh-TW profiles, desktop 1440 × 900 and phone 390 × 844 (touch, DPR 2):
 *   A  M2: a 100 µF electrolytic across 5 V beside a 330 Ω LED — no
 *      「PS1 輸出超過 2 A」 (the start-up surge is no short), 「未發現問題」,
 *      and the LED cheers 「電路正常運作 ✓」; a wire straight across the rails
 *      still raises the supply over-current (folded under the short);
 *   B  pwm-fade breathes (glow NP3): examples/embedded/pwm-fade at ¼ real
 *      time, sampled over two ramps — the LED's telemetry light and its 3D
 *      crop (redness) glide in monotonic segments, never strobing, and the
 *      crop follows the light (Spearman ρ > 0.8); mid-fade snapshots carry
 *      values.iPeak (the shown mA averages a switching current);
 *   C  P2: on a phone (390 and 375 px) the 顯示電流 chip shows words beside its
 *      box (「電流」) and stays clear of the capsule — also when the capsule
 *      widens to show 倍速 (then the 40 px chip stacks the box over 「電流」);
 *   D  an averaged current says so (NP3, second pass): pwm-fade's LED1
 *      inspector reads 「電流 平均 … mA」 (「峰值 … mA」 under the title),
 *      「功率 平均 …」 and 「亮度 …（平均 … mA）」 — the same mean — on desktop
 *      and phone; the English classic chrome keeps its words and its
 *      Brightness is the I / 10 mA percent of its Current row (no 0 % strobe);
 *   E  the simulation log after a retracted supply warning: the next new
 *      issue (an LED burning on a second supply) still gets its log line.
 * Exit code 1 on any failed assertion. UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync } from 'node:fs'
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

async function open({ phone = false, width = phone ? 390 : 1440, height = phone ? 844 : 900, cheer = false } = {}) {
  const ctx = await browser.newContext(
    phone ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width, height }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([ws]) => {
      if (sessionStorage.getItem('honesty.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('honesty.seeded', '1')
    },
    [!phone],
  )
  await page.goto(`${URL}?e2e&shotrig${cheer ? '&cheer' : ''}`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 150000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 90000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1500)
  // every toast that ever showed (they leave after a few seconds)
  await mod(page, '/src/ui/kit/toasts.ts', 'window.__honestyToasts = []; m.subscribeToasts((q) => { for (const t of q) if (!window.__honestyToasts.some((x) => x.id === t.id)) window.__honestyToasts.push({ id: t.id, text: t.text }) })')
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
const toasts = (page) => page.evaluate(() => (window.__honestyToasts ?? []).map((x) => x.text))
const simTime = (page) => store(page, 'return m.useStore.getState().simTime')
async function until(page, t, maxMs = 90000) {
  const w0 = Date.now()
  while (Date.now() - w0 < maxMs) {
    if ((await simTime(page)) >= t) return true
    await sleep(200)
  }
  return false
}
const shot = async (page, name, clip) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `honesty-${name}.png`), ...(clip ? { clip } : {}) })
}
const project = (page, id, y) =>
  page.evaluate(([i, h]) => {
    const w = window.__e2e.componentWorld(i, h)
    return w ? window.__shotRig.project(w.x, w.y, w.z) : null
  }, [id, y])

// ------------------------------------------------------------- A: bulk capacitor (M2)
const PS_WIRES = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
const capLayout = {
  version: 1,
  name: 'bulk capacitor',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'C1', type: 'capacitor', holes: ['top+3', 'top-3'], params: { capacitance: 100e-6, polarized: true } },
    { id: 'R1', type: 'resistor', holes: ['top+10', 'a14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['c14', 'c16'], params: { color: 'red' } },
  ],
  wires: [...PS_WIRES, { id: 'W3', from: 'a16', to: 'top-13' }],
}
for (const phone of [false, true]) {
  const tag = phone ? 'phone' : 'desktop'
  const { ctx, page, errors } = await open({ phone, cheer: true })
  await store(page, 'm.useStore.getState().loadLayout(a)', capLayout)
  await sleep(1000)
  await store(page, 'm.useStore.getState().startSim()')
  check(await until(page, 3), `A ${tag}: 3 s of simulated time with a 100 µF capacitor across 5 V`)
  await sleep(1600)
  const issues = await store(page, 'return m.useStore.getState().issues.map((i) => i.message)')
  check(!issues.some((m) => /current > 2A/.test(m)), `A ${tag}: no supply over-current from the start-up surge`, issues)
  const probs = await mod(page, '/src/ui/embedded/problems.ts', 'return m.useProblems.getState().problems.map((p) => p.title)')
  check(!probs.some((x) => /2 A/.test(x)), `A ${tag}: no 「PS1 輸出超過 2 A」 in Problems`, probs)
  check((await toasts(page)).some((x) => x.includes('電路正常運作')), `A ${tag}: the LED beside the capacitor cheers`, await toasts(page))
  await shot(page, `cap-${tag}`)
  await store(page, 'm.useStore.getState().stopSim()')
  await store(page, 'm.useStore.getState().loadLayout(a)', { ...capLayout, wires: [...capLayout.wires, { id: 'W9', from: 'top+20', to: 'top-20' }] })
  await sleep(1000)
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 0.5)
  await sleep(1800)
  const issues2 = await store(page, 'return m.useStore.getState().issues.map((i) => i.message)')
  check(issues2.some((m) => /^supply PS1 current > 2A/.test(m)), `A ${tag}: a wire across the rails still raises the supply over-current`, issues2)
  check(errors.length === 0, `A ${tag}: no page errors`, errors.slice(0, 3))
  await ctx.close()
}

// ------------------------------------------------------------- B: pwm-fade breathes (glow NP3)
for (const phone of [false, true]) {
  const tag = phone ? 'phone' : 'desktop'
  const { ctx, page, errors } = await open({ phone })
  const r = await mod(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById("pwm-fade")')
  await sleep(1500)
  check(r?.ok === true, `B ${tag}: pwm-fade opened`, r)
  await mod(page, '/src/ui/workspace/scene-bridge.ts', 'm.frameTargets({ components: ["LED1"] }, { minElevationDeg: 45 })')
  await sleep(900)
  await store(page, 'm.useStore.getState().setSimSpeed(0.25)') // a dozen snapshots per 1 s ramp
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 0.4)
  const at = await project(page, 'LED1', 1.0)
  const R = phone ? 22 : 34
  const clip = { x: Math.round(at.x - R), y: Math.round(at.y - R), width: 2 * R, height: 2 * R }
  const samples = []
  const t0 = Date.now()
  while (Date.now() - t0 < 14000 && samples.length < 200) {
    const s = await store(page, 'const T = m.useStore.getState().telemetry; const c = T?.components.LED1; return T ? { t: T.time, light: c?.light ?? null, i: c?.current ?? null, peak: c?.values?.iPeak ?? null } : null')
    const buf = await page.screenshot({ clip })
    // the red LED's glow: how much redder than grey (a red glow over the white board LOWERS luminance)
    s.red = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = cv.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, img.width, img.height).data
      let sum = 0
      for (let k = 0; k < d.length; k += 4) sum += Math.max(0, d[k] - (d[k + 1] + d[k + 2]) / 2)
      return sum / (d.length / 4)
    }, buf.toString('base64'))
    samples.push(s)
    await sleep(40)
  }
  await shot(page, `pwm-${tag}`)
  const u = samples.filter((s, k) => s && s.light !== null && (k === 0 || s.t !== samples[k - 1].t))
  const span = u[u.length - 1].t - u[0].t
  check(span > 1.9 && u.length > 15, `B ${tag}: two ramps sampled (${span.toFixed(2)} s simulated, ${u.length} snapshots)`)
  const L = u.map((s) => s.light)
  const maxL = Math.max(...L)
  check(maxL > 0.15 && Math.min(...L) < 0.03, `B ${tag}: dark → bright → dark`, { min: Math.min(...L), max: maxL })
  const glide = (key, full) => {
    let worst = 0
    let flips = 0
    let last = 0
    for (let k = 1; k < u.length; k++) {
      const dt = u[k].t - u[k - 1].t
      const d = u[k][key] - u[k - 1][key]
      worst = Math.max(worst, Math.abs(d) / (full * (dt * 1.25 + 0.2)))
      if (Math.abs(d) > 0.04 * full) {
        if (last !== 0 && Math.sign(d) !== last) flips++
        last = Math.sign(d)
      }
    }
    return { worst, flips }
  }
  const gl = glide('light', maxL)
  check(gl.worst <= 1 && gl.flips <= Math.ceil(span) + 2, `B ${tag}: the light glides in monotonic segments (worst step ${gl.worst.toFixed(2)}, ${gl.flips} turns)`)
  const reds = u.map((s) => s.red)
  const redSpan = Math.max(...reds) - Math.min(...reds)
  const gr = glide('red', redSpan)
  check(redSpan > 10 && gr.worst <= 1 && gr.flips <= Math.ceil(span) + 2, `B ${tag}: the 3D LED breathes too — no strobing (redness ${Math.min(...reds).toFixed(0)} → ${Math.max(...reds).toFixed(0)}, worst ${gr.worst.toFixed(2)}, ${gr.flips} turns)`)
  const rank = (xs) => {
    const r = Array(xs.length)
    xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]).forEach(([, i], k) => (r[i] = k))
    return r
  }
  const ra = rank(L)
  const rb = rank(reds)
  const n = u.length
  const rho = 1 - (6 * ra.reduce((acc, x, k) => acc + (x - rb[k]) ** 2, 0)) / (n * (n * n - 1))
  check(rho > 0.8, `B ${tag}: the crop follows the light (Spearman ρ = ${rho.toFixed(3)})`)
  const mid = u.filter((s) => s.light > 0.03 && s.light < 0.17)
  check(mid.length > 0 && mid.every((s) => typeof s.peak === 'number' && s.peak > s.i), `B ${tag}: mid-fade the shown mA is marked an average (values.iPeak)`, mid.slice(0, 2))
  check(errors.length === 0, `B ${tag}: no page errors`, errors.slice(0, 3))
  await ctx.close()
}

// ------------------------------------------------------------- C: the phone chip keeps words (P2)
for (const [W, H] of [
  [390, 844],
  [375, 812],
]) {
  const { ctx, page, errors } = await open({ phone: true, width: W, height: H })
  await mod(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById("blink")')
  await sleep(1500)
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 0.3)
  await sleep(800)
  const info = () =>
    page.evaluate(() => {
      const c = document.querySelector('.app-flow-chip')
      const cap = document.querySelector('.lg-capsule-wrap .lg-capsule:not(.is-expanded)')
      const lab = c?.querySelector('.app-flow-label:not(.app-flow-measure)')
      if (!c || !cap || !lab) return null
      const r = c.getBoundingClientRect()
      const k = cap.getBoundingClientRect()
      const l = lab.getBoundingClientRect()
      return {
        text: lab.textContent,
        inside: l.width > 8 && l.left >= r.left - 0.5 && l.right <= r.right + 0.5 && l.top >= r.top - 0.5 && l.bottom <= r.bottom + 0.5,
        gap: Math.round(r.left - k.right),
        right: Math.round(r.right),
        top: Math.round(r.top),
        capText: cap.textContent,
        vw: window.innerWidth,
      }
    })
  const a = await info()
  check(!!a && a.text === '電流' && a.inside && a.gap >= 6 && a.right <= a.vw - 6, `C ${W}: ☑ 電流 beside the capsule, clear of it`, a)
  await shot(page, `chip-${W}`, { x: 0, y: 0, width: W, height: 110 })
  await store(page, 'm.useStore.getState().setSimSpeed(50)') // slower than asked → the capsule shows 倍速
  let b = null
  for (let k = 0; k < 24; k++) {
    await sleep(500)
    b = await info()
    if (/倍速/.test(b?.capText ?? '')) break
  }
  await sleep(800)
  b = await info()
  check(!!b && /倍速/.test(b.capText), `C ${W}: the capsule widened to show 倍速`, b?.capText)
  check(!!b && b.text === '電流' && b.inside && b.gap >= 6 && b.right <= b.vw - 6 && b.top < 30, `C ${W}: still worded, clear of the wider capsule, same row`, b)
  await shot(page, `chip-${W}-speed`, { x: 0, y: 0, width: W, height: 110 })
  check(errors.length === 0, `C ${W}: no page errors`, errors.slice(0, 3))
  await ctx.close()
}

// ------------------------------------------------------------- D: an averaged LED current says 平均 (NP3, second pass)
const liveLines = (page) => page.evaluate(() => document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean))
/** a row's next lines (title, [subtitle], value) — the row whose next line is a reading */
const rowAfter = (ls, title) => {
  const i = ls.findIndex((l, k) => l === title && /^(峰值|平均|\d|-|—)/.test(ls[k + 1] ?? ''))
  return i < 0 ? [] : [ls[i + 1] ?? '', ls[i + 2] ?? '']
}
for (const phone of [false, true]) {
  const tag = phone ? 'phone' : 'desktop'
  const { ctx, page, errors } = await open({ phone })
  await mod(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById("pwm-fade")')
  await sleep(1500)
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 1.0)
  await store(page, 'm.useStore.getState().select("LED1")')
  await sleep(1500)
  let said = 0
  let agree = 0
  let averaged = 0
  for (let k = 0; k < 6; k++) {
    const peak = await store(page, 'return m.useStore.getState().telemetry?.components.LED1?.values?.iPeak ?? null')
    const ls = await liveLines(page)
    const cur = rowAfter(ls, '電流')
    const pow = rowAfter(ls, '功率')[0]
    const bri = rowAfter(ls, '亮度')[0]
    if (peak !== null) {
      averaged++
      const mean = cur.map((v) => /^平均 ([\d.]+ [mµ]A)$/.exec(v)?.[1]).find(Boolean)
      if (mean && cur.some((v) => /^峰值 [\d.]+ mA$/.test(v)) && /^平均 /.test(pow) && /（平均 [\d.]+ [mµ]A）$/.test(bri)) said++
      if (mean && bri.includes(`（平均 ${mean}）`)) agree++
    }
    await sleep(300)
  }
  check(averaged >= 4, `D ${tag}: pwm-fade's LED1 averages a switching current (${averaged}/6 reads)`)
  check(said === averaged, `D ${tag}: 電流 「平均 … mA」 with 「峰值 … mA」, 功率 「平均 …」, 亮度 「…（平均 … mA）」 (${said}/${averaged})`)
  check(agree === averaged, `D ${tag}: the 電流 row's mean is the 亮度 row's (${agree}/${averaged})`)
  await shot(page, `avg-${tag}`)
  check(errors.length === 0, `D ${tag}: no page errors`, errors.slice(0, 3))
  await ctx.close()
}
{
  // the English classic chrome: its words, and Brightness = the I / 10 mA percent of the Current row's same mean
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('honesty.seeded')) return
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.lang', 'en')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
    sessionStorage.setItem('honesty.seeded', '1')
  })
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 150000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1500)
  await mod(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById("pwm-fade")')
  await sleep(1500)
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 1.0)
  await store(page, 'm.useStore.getState().select("LED1")')
  await sleep(1200)
  let n = 0
  let agree = 0
  let lit = 0
  let plain = true
  const SCALE = { A: 1, mA: 1e-3, µA: 1e-6, nA: 1e-9 }
  for (let k = 0; k < 8; k++) {
    const ls = await page.evaluate(() => document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean))
    const c = ls[ls.indexOf('Current') + 1] ?? ''
    const b = ls[ls.indexOf('Brightness') + 1] ?? ''
    if (/average|peak|平均|峰值/.test(`${c} ${b}`)) plain = false
    const mc = /^(-?[\d.]+)\s*(mA|µA|nA|A)$/.exec(c)
    const mb = /^(\d+)%$/.exec(b)
    if (mc && mb) {
      n++
      const want = Math.round(Math.min(1, Math.max(0, (Number(mc[1]) * SCALE[mc[2]]) / 0.01)) * 100)
      if (Math.abs(want - Number(mb[1])) <= 1) agree++
      if (Number(mb[1]) > 0) lit++
    }
    await sleep(330)
  }
  check(n >= 6 && agree === n, `D classic: Brightness is the I / 10 mA percent of the Current row at every read (${agree}/${n})`)
  check(lit >= 4, `D classic: no strobing to 0% while the current flows (${lit}/${n})`)
  check(plain, 'D classic: the classic words stay (no average / peak)')
  await shot(page, 'avg-classic')
  check(errors.length === 0, 'D classic: no page errors', errors.slice(0, 3))
  await ctx.close()
}

// ------------------------------------------------------------- E: the simulation log after a retracted warning
{
  const { ctx, page, errors } = await open({})
  await store(page, 'm.useStore.getState().loadLayout(a)', {
    version: 1,
    name: 'log sync',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['top+5', 'top-5'], params: { resistance: 1 } },
      { id: 'PS2', type: 'power_supply', params: { voltage: 0 } },
      { id: 'D1', type: 'led', holes: ['bot+5', 'bot-5'], params: { color: 'red' } },
    ],
    wires: [...PS_WIRES, { id: 'W3', from: 'PS2:+', to: 'bot+0' }, { id: 'W4', from: 'PS2:-', to: 'bot-0' }],
  })
  await sleep(1000)
  await store(page, 'm.useStore.getState().startSim()')
  await until(page, 0.2)
  await sleep(500)
  const issues = () => store(page, 'return m.useStore.getState().issues.map((i) => i.message)')
  check((await issues()).some((m) => /^supply PS1 current > 2A/.test(m)), 'E: 1 Ω across PS1 raises the supply warning')
  // the short ends (R1 burns open within about a second, or PS1 turned down): the warning is retracted
  await store(page, 'm.useStore.getState().setParam("PS1", "voltage", 1)')
  await until(page, 1.6)
  await sleep(500)
  check(!(await issues()).some((m) => /^supply PS1 current > 2A/.test(m)), 'E: the warning is retracted once the short ends')
  // a NEW issue afterwards: an LED straight across PS2 burns — its line must reach the log
  await store(page, 'm.useStore.getState().setParam("PS2", "voltage", 5)')
  await until(page, 2.0)
  await sleep(800)
  check((await issues()).some((m) => /^LED D1 burned out/.test(m)), 'E: the LED across PS2 burned')
  const log = await mod(page, '/src/ui/embedded/lab.ts', 'return m.labBuffers.log().filter((e) => e.source === "sim").map((e) => e.message)')
  check(log.filter((m) => /^LED D1 burned out/.test(m)).length === 1, 'E: 模擬日誌 got the burn line (the retraction never makes it skip the next issue)', log)
  await shot(page, 'log')
  check(errors.length === 0, 'E: no page errors', errors.slice(0, 3))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
