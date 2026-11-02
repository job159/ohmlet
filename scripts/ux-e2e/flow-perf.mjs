/**
 * 顯示電流 cost, read from the 效能診斷 overlay (window.__perfRig, ?perfrig)
 * and the flow layer's own counters (window.__flowStats, ?e2e):
 *
 *   UX_E2E_URL=http://localhost:5412/ node scripts/ux-e2e/flow-perf.mjs
 *
 * Scenes: blink (the library example) and heavy (src/ui/perf/heavy-scene.ts
 * + hal-oled-ssd1306 on U1 — the performance reference circuit), each run
 * with the flow view OFF and fully ON, interleaved, desktop workspace
 * 1440×900, zh-TW,
 * Performance render mode (FLOW_PERF_MODE overrides). After a warm-up, the
 * overlay snapshot (fps, scene CPU ms per frame p50 / p95, draw calls,
 * simulation speed, worker load) and the layer's per-frame CPU time / point
 * count are printed as a table. Headless Edge rasterizes in software (its
 * GL competes with the simulation worker for the CPU): the absolute fps
 * are CPU-bound — compare the variants. Asserted: the layer is ONE extra
 * draw call, its per-frame update stays under 1 ms and the worker keeps
 * ≥ 85 % of its untracked speed while tracking.
 *
 * The worker's share is measured so that a busy, shared machine cannot fake
 * it (separate page runs swung with the load: at 99 % CPU a tracking run
 * 'failed' while the flow-ON run, which also tracks, was faster than flow
 * off): ONE page runs the scene with the view off and switches current
 * tracking off / on, on / off … every few seconds; each window yields the
 * worker's cost per simulated second (busy % ÷ real-time factor — right
 * whether the simulation keeps up with real time or not) and the MEDIAN of
 * the per-pair off/on cost ratios is the speed kept (a load spike hits one
 * window, never a whole variant). FLOW_PERF_AB_PAIRS sets the pairs (5).
 */
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const MODE = process.env.FLOW_PERF_MODE ?? 'performance'
const WARM_MS = Number(process.env.FLOW_PERF_WARM_MS ?? 5000)
const SAMPLE_MS = Number(process.env.FLOW_PERF_SAMPLE_MS ?? 6000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

/** A page with `scene` loaded (not yet running); `flow`: the 顯示電流 view stored on. */
async function openScene(scene, flow) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.addInitScript(
    ([mode, flow]) => {
      if (sessionStorage.getItem('fp.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', mode)
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      if (flow) localStorage.setItem('bb.flow', '1')
      sessionStorage.setItem('fp.seeded', '1')
    },
    [MODE, flow],
  )
  await page.goto(`${URL}?perfrig&e2e&shotrig`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 150000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__perfRig, null, { timeout: 90000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1500)
  if (scene === 'blink') {
    await page.evaluate(async () => {
      const ex = await import('/src/ui/workspace/examples.ts')
      await ex.openExampleById('blink')
    })
  } else {
    const res = await page.evaluate(async () => {
      const hs = await import('/src/ui/perf/heavy-scene.ts')
      const lab = await import('/src/state/lab.ts')
      const imp = await lab.useLab.getState().importProject(JSON.stringify(hs.heavyScene()))
      if (!imp.ok) return { ok: false, errors: imp.errors }
      const r = await fetch('/firmware/dist/hal-oled-ssd1306.elf')
      const bytes = new Uint8Array(await r.arrayBuffer())
      const ld = await lab.useLab.getState().loadFirmware('U1', { name: 'hal-oled-ssd1306.elf', bytes })
      return ld.ok ? { ok: true } : { ok: false, error: ld.error }
    })
    if (!res.ok) throw new Error(`heavy scene: ${JSON.stringify(res)}`)
  }
  await sleep(1500)
  return { ctx, page }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}

async function measure(scene, variant) {
  const { ctx, page } = await openScene(scene, variant === 'ON')
  await page.evaluate(async () => {
    const store = await import('/src/state/store.ts')
    store.useStore.getState().startSim()
  })
  await sleep(WARM_MS)
  const ticks = []
  // draw calls of the newest frame vary with what the scene shows (a lit LED's
  // glow): the fewest seen over the window compares like with like
  let callsMin = Infinity
  const t0 = Date.now()
  while (Date.now() - t0 < SAMPLE_MS) {
    await sleep(250)
    const [s, calls] = await page.evaluate(() => [window.__flowStats ? window.__flowStats() : null, window.__perfRig.snapshot().calls])
    if (s && s.visible) ticks.push(s.tickMs)
    if (typeof calls === 'number' && calls < callsMin) callsMin = calls
  }
  const snap = await page.evaluate(() => window.__perfRig.snapshot())
  const fs = await page.evaluate(() => (window.__flowStats ? window.__flowStats() : null))
  await ctx.close()
  ticks.sort((a, b) => a - b)
  return {
    scene,
    flow: variant,
    fps: snap.fps,
    cpuP50: snap.cpuP50,
    cpuP95: snap.cpuP95,
    calls: Number.isFinite(callsMin) ? callsMin : snap.calls,
    realtime: snap.sim?.realtime ?? null,
    busyPct: snap.sim?.busyPct ?? null,
    flowPoints: fs?.visible ? fs.points : 0,
    flowTickP50: ticks.length ? ticks[Math.floor(ticks.length / 2)] : null,
    flowTickMax: ticks.length ? ticks[ticks.length - 1] : null,
    gpu: snap.gpu?.software ? 'software' : snap.gpu?.renderer ?? '?',
  }
}

/** The worker's speed kept while tracking: ONE page, tracking switched in interleaved windows (see the header). */
const AB_PAIRS = Number(process.env.FLOW_PERF_AB_PAIRS ?? 5)
const AB_SETTLE_MS = 1500 // the perf rates are trailing windows: let the previous variant drain out
const AB_WIN_MS = 2500
async function workerAB(scene) {
  const { ctx, page } = await openScene(scene, false)
  await page.evaluate(async () => {
    const store = await import('/src/state/store.ts')
    store.useStore.getState().startSim()
  })
  await sleep(WARM_MS)
  const setTracking = (on) =>
    page.evaluate(async (v) => {
      const tr = await import('/src/sim/coordinator/tracking.ts')
      tr.setCurrentTrackingDefault(v)
    }, on)
  const windowCost = async () => {
    const xs = []
    const t0 = Date.now()
    while (Date.now() - t0 < AB_WIN_MS) {
      await sleep(250)
      const s = await page.evaluate(() => window.__perfRig.snapshot().sim)
      if (s && s.running && s.realtime > 0 && s.busyPct > 0) xs.push(s.busyPct / s.realtime)
    }
    return median(xs)
  }
  const pairs = []
  for (let k = 0; k < AB_PAIRS; k++) {
    const order = k % 2 === 0 ? [false, true] : [true, false]
    const cost = {}
    for (const on of order) {
      await setTracking(on)
      await sleep(AB_SETTLE_MS)
      cost[on ? 'on' : 'off'] = await windowCost()
    }
    if (cost.off != null && cost.on != null) pairs.push(cost.off / cost.on)
  }
  await setTracking(false)
  await ctx.close()
  return { scene, kept: median(pairs), pairs }
}

// interleaved off / on / off / on: a shared, busy machine drifts — the
// averages of alternating runs compare like with like
const REPS = Number(process.env.FLOW_PERF_REPS ?? 2)
const runs = []
const ab = {}
for (const scene of ['blink', 'heavy']) {
  for (let k = 0; k < REPS; k++) {
    for (const variant of ['off', 'ON']) {
      const r = await measure(scene, variant)
      runs.push(r)
      console.log(JSON.stringify(r))
    }
  }
  ab[scene] = await workerAB(scene)
  console.log(JSON.stringify(ab[scene]))
}
await browser.close()
const avg = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const rows = []
for (const scene of ['blink', 'heavy']) {
  for (const flow of ['off', 'ON']) {
    const rs = runs.filter((r) => r.scene === scene && r.flow === flow)
    rows.push({
      scene,
      flow,
      fps: avg(rs.map((r) => r.fps)),
      cpuP50: avg(rs.map((r) => r.cpuP50)),
      cpuP95: avg(rs.map((r) => r.cpuP95)),
      calls: rs.reduce((m, r) => (typeof r.calls === 'number' && (m == null || r.calls < m) ? r.calls : m), null),
      realtime: avg(rs.map((r) => r.realtime)),
      busyPct: avg(rs.map((r) => r.busyPct)),
      flowPoints: Math.round(avg(rs.map((r) => r.flowPoints)) ?? 0),
      flowTickP50: avg(rs.map((r) => r.flowTickP50)),
      flowTickMax: rs.reduce((m, r) => (r.flowTickMax != null && r.flowTickMax > (m ?? -1) ? r.flowTickMax : m), null),
    })
  }
}

const f = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d))
console.log('\nscene  flow  fps    cpu p50/p95 ms  draws  sim ×   worker %  flow pts  flow tick p50/max ms')
for (const r of rows) {
  console.log(
    `${r.scene.padEnd(6)} ${r.flow.padEnd(4)}  ${f(r.fps).padStart(5)}  ${f(r.cpuP50, 2).padStart(5)}/${f(r.cpuP95, 2).padEnd(6)}   ${String(r.calls ?? '—').padStart(5)}  ${f(r.realtime, 2).padStart(5)}  ${f(r.busyPct, 0).padStart(7)}  ${String(r.flowPoints).padStart(8)}  ${f(r.flowTickP50, 2)}/${f(r.flowTickMax, 2)}`,
  )
}
for (const scene of ['blink', 'heavy']) {
  const off = rows.find((r) => r.scene === scene && r.flow === 'off')
  const on = rows.find((r) => r.scene === scene && r.flow === 'ON')
  check(on.flowPoints > 0, `${scene}: particles drawn with the view on`, on.flowPoints)
  check(off.calls != null && on.calls != null && on.calls - off.calls <= 1, `${scene}: the layer costs at most ONE draw call`, { off: off.calls, on: on.calls })
  check(on.flowTickMax != null && on.flowTickMax < 1, `${scene}: the layer's per-frame update < 1 ms`, on.flowTickMax)
  const k = ab[scene]
  check(k.kept != null && k.kept >= 0.85, `${scene}: tracking currents keeps ≥ 85 % of the worker's speed (median of interleaved windows, one page)`, {
    kept: k.kept == null ? null : Number(k.kept.toFixed(3)),
    pairs: k.pairs.map((x) => Number(x.toFixed(2))),
  })
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
