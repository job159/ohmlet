/**
 * The cost of the LED glow on a 20-LED board (owner: glow), read from the
 * 效能診斷 overlay (window.__perfRig, ?perfrig):
 *
 *   UX_E2E_URL=http://localhost:5421/ node scripts/ux-e2e/glow-perf.mjs
 *
 * Twenty 5 mm LEDs at ≈ 4 mA (5 V, 820 Ω each) on the standard board. Per
 * render mode the board is run, then paused (the same frame content every
 * frame) while the camera turns slowly so
 * every frame is drawn: the paused, lit board with its glow objects shown
 * vs hidden, interleaved five times (medians — the machine may be shared).
 * Reports fps, scene CPU ms per frame and draw calls, and checks: a lit LED
 * costs at most 2 draw calls per frame (glow halo + light pool; the star
 * flare joins only from ≈ 6 mA — the vivid look drew three from ≈ 3.4 mA),
 * and the scene CPU per frame stays within the machine's noise (< 1.5 ms)
 * for all twenty glows.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const MODES = (process.env.GLOW_MODES ?? 'performance,enhanced').split(',').filter(Boolean)
const N = 20
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

/** the free rail hole (index 1..49; 0 takes the supply wire) whose x is nearest to x */
function railIndexNear(x, used) {
  let best = -1
  for (let i = 1; i < 50; i++) {
    if (used.has(i)) continue
    if (best < 0 || Math.abs(2.5 + i + Math.floor(i / 5) - x) < Math.abs(2.5 + best + Math.floor(best / 5) - x)) best = i
  }
  used.add(best)
  return best
}
const usedPlus = new Set()
const usedMinus = new Set()
const components = [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }]
for (let i = 0; i < N; i++) {
  const c = 4 + 3 * i
  components.push({ id: `R${i + 1}`, type: 'resistor', holes: [`top+${railIndexNear(c - 1, usedPlus)}`, `a${c}`], params: { resistance: 820 } })
  components.push({ id: `LED${i + 1}`, type: 'led', holes: [`b${c}`, `top-${railIndexNear(c, usedMinus)}`], params: { color: ['red', 'green', 'yellow', 'blue', 'white'][i % 5] } })
}
const LAYOUT = { version: 1, name: 'glow-perf-20', components, wires: [{ id: 'W1', from: 'PS1:+', to: 'top+0' }, { id: 'W2', from: 'PS1:-', to: 'top-0' }] }

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
try {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.addInitScript(
      ([m]) => {
        if (sessionStorage.getItem('glowp.seeded')) return
        localStorage.clear()
        localStorage.setItem('bb.onboarded', '1')
        localStorage.setItem('bb.renderMode', m)
        localStorage.setItem('bb.lang', 'zh-TW')
        localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
        sessionStorage.setItem('glowp.seeded', '1')
      },
      [mode],
    )
    await page.goto(`${URL}?perfrig&e2e&shotrig`, { timeout: 180_000 })
    await page.waitForFunction(() => !!window.__e2e && !!window.__perfRig && !!window.__shotRig, null, { timeout: 120_000 })
    await page.evaluate(() => window.__e2e.ready())
    await sleep(mode === 'enhanced' ? 4000 : 1500)
    const mod = (file, src, arg) =>
      page.evaluate(
        async ([f, s, ar]) => {
          const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
          const m = await import(url)
          return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, ar)
        },
        [file, src, arg],
      )
    const loaded = await mod('/src/state/store.ts', 'return m.useStore.getState().loadLayout(a)', LAYOUT)
    if (!check(loaded?.ok !== false, `${mode}: the 20-LED board loads`, JSON.stringify(loaded?.errors ?? '').slice(0, 200))) continue
    await sleep(2000)
    /** turn the camera for `ms`, then read the overlay; the minimum draw calls over the window */
    const sample = async (ms) => {
      await page.evaluate((dur) => {
        const t0 = performance.now()
        const step = () => {
          const t = (performance.now() - t0) / 1000
          const a = 0.25 * Math.sin(t * 0.8)
          window.__shotRig.setCamera(32 + 40 * Math.sin(a), 34, 4 + 40 * Math.cos(a), 32, 0, 4)
          if (performance.now() - t0 < dur) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }, ms)
      let calls = Infinity
      const t0 = Date.now()
      await sleep(1200)
      while (Date.now() - t0 < ms - 300) {
        const c = await page.evaluate(() => window.__perfRig.snapshot().calls)
        if (typeof c === 'number' && c < calls) calls = c
        await sleep(250)
      }
      const s = await page.evaluate(() => window.__perfRig.snapshot())
      return { fps: s.fps, cpuP50: s.cpuP50, cpuP95: s.cpuP95, calls: Number.isFinite(calls) ? calls : s.calls }
    }
    await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
    await sleep(2500)
    await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
    await sleep(800)
    const lit = await page.evaluate(() => {
      let n = 0
      for (let i = 1; i <= 20; i++) if ((window.__e2e.component(`LED${i}`)?.light ?? 0) > 0.1) n++
      return n
    })
    check(lit === N, `${mode}: all ${N} LEDs lit by the real circuit`, `${lit}`)
    // the same paused, lit board with the glow objects shown / hidden,
    // interleaved 5× (the machine is shared: medians against the noise)
    const glow = (show) =>
      page.evaluate((v) => {
        window.__vividFx.group.parent.parent.traverse((o) => {
          if (o.name === 'led-halo' || o.name === 'led-flare' || o.name === 'led-pool') o.visible = v ? o.userData.glowWasVisible ?? o.visible : ((o.userData.glowWasVisible = o.visible), false)
        })
      }, show)
    const on = []
    const off = []
    for (let k = 0; k < 5; k++) {
      on.push(await sample(4000))
      await glow(false)
      off.push(await sample(4000))
      await glow(true)
    }
    const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const A = { fps: med(on.map((r) => r.fps)), cpu: med(on.map((r) => r.cpuP50)), calls: Math.min(...on.map((r) => r.calls)) }
    const B = { fps: med(off.map((r) => r.fps)), cpu: med(off.map((r) => r.cpuP50)), calls: Math.min(...off.map((r) => r.calls)) }
    const f = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : '—')
    console.log(`      ${mode}: glow hidden  fps ${f(B.fps)}  cpu p50 ${f(B.cpu, 2)} ms  calls ${B.calls}`)
    console.log(`      ${mode}: glow shown   fps ${f(A.fps)}  cpu p50 ${f(A.cpu, 2)} ms  calls ${A.calls}  (${lit} LEDs lit, 4 mA)`)
    // (+2: a stray hover ring / chip in the minimum-calls window)
    check(A.calls - B.calls <= 2 * N + 2, `${mode}: ≤ 2 draw calls per lit LED (halo + pool)`, `+${A.calls - B.calls} for ${N}`)
    // the noise of a shared machine is ≈ ±1 ms between identical samples
    check(A.cpu - B.cpu < 1.5, `${mode}: scene CPU per frame within noise (< 1.5 ms for ${N} glows)`, `${f(B.cpu, 2)} → ${f(A.cpu, 2)} ms`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
