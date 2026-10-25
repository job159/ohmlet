/**
 * PERF-WIN — CPU-side profiling rig for the embedded lab (Windows-friendly:
 * Playwright + the installed Edge, no build step, no native deps).
 *
 * Drives a page served by a running Vite server (dev or preview; a dev
 * server WITHOUT hot reload is best — attribution by source file only works
 * on the dev server's unbundled modules) through realistic lab scenes and
 * measures, per scene, over a fixed wall-clock window AFTER a warm-up:
 *
 *   - main-thread long-task share: Σ duration of PerformanceObserver
 *     'longtask' entries (tasks ≥ 50 ms) inside the window / window length —
 *     the "how often is the page janky" figure;
 *   - frame rate and frame-interval p50 / p95 (requestAnimationFrame
 *     timestamps — what the user sees, GPU included);
 *   - React commits per second (an init-script React DevTools hook stub
 *     counts every commit exactly — React reports to it on its own);
 *   - simulation: the coordinator's realtime factor / analog steps per
 *     second / busy ms per wall second (worker load), and the simulated
 *     time actually achieved over the window (sim-time ÷ wall-time);
 *   - per MCU board: instructions retired per wall second (MIPS);
 *   - a second, separate window under the CDP sampling profiler (so its own
 *     overhead never pollutes the figures above): main-thread busy share,
 *     the share of wall time spent in each app area (glass tone sampler,
 *     3D scene, React, store / sim host, instruments, …; inclusive — a
 *     sample counts once per area on its stack) and the top self-time
 *     functions;
 *   - with the 效能診斷 overlay on (PERF_OVERLAY=1, the default: the page is
 *     opened with ?perfrig): the overlay collector's own snapshot — draw
 *     calls, triangles, geometries / textures, scene CPU ms per frame,
 *     telemetry pushes — read through window.__perfRig.
 *
 * Scenes (PERF_SCENES, comma separated; default "blink,heavy"):
 *   blink   the library's 「Blue Pill 閃爍 LED（HAL）」 example (openExampleById,
 *           exactly what the Examples tab does) + 4 logic channels (PA5,
 *           PC13, PA0, PA1), running;
 *   heavy   src/ui/perf/heavy-scene.ts — Blue Pill + SSD1306 OLED + MPU-6050
 *           + LCD1602 + 74HC595 + 8 LEDs + TB6612FNG + DC motor, imported
 *           as a project, firmware firmware/dist/<PERF_FIRMWARE> bound to U1
 *           (default hal-oled-ssd1306), running;
 *   idle    the same heavy circuit, simulation stopped (scene + chrome only).
 * Every scene runs with the desktop workspace open, zh-TW, onboarding done,
 * in the Enhanced render mode (PERF_MODE overrides: performance | enhanced |
 * studio).
 *
 * Headless Edge renders WebGL in software (SwiftShader) — its frame rates
 * are CPU-bound and NOT what a user with a GPU sees; the CPU-side costs (JS,
 * style/layout, readbacks) are what this mode is good for. PERF_HEADED=1
 * opens a real window for GPU numbers (leave it alone while it runs).
 *
 * Usage (a no-HMR dev server must be running):
 *   PERF_URL=http://localhost:5342/ node scripts/perf-win.mjs
 *   PERF_SCENES=blink PERF_SECONDS=6 PERF_LABEL=before node scripts/perf-win.mjs
 *   PERF_HEADED=1 PERF_SCENES=heavy node scripts/perf-win.mjs
 *
 * Env:
 *   PERF_URL        page to drive (default http://localhost:5173/)
 *   PERF_CHANNEL    msedge (default) | chrome | bundled
 *   PERF_HEADED     1 = headed browser (GPU numbers)
 *   PERF_SCENES     scenes to run (above)
 *   PERF_SECONDS    measurement window per pass (default 6)
 *   PERF_WARMUP_S   wait after the simulation starts (default 4)
 *   PERF_REPEAT     runs per scene (fresh page each); the report keeps all
 *                   runs and prints the median by long-task share
 *   PERF_PROFILE    0 = skip the profiler pass
 *   PERF_SAVE_PROFILE 1 = also write each raw profile (<label>-<scene>-<run>.cpuprofile,
 *                   loadable in the browser DevTools Performance panel)
 *   PERF_OVERLAY    0 = open the page WITHOUT ?perfrig (no overlay, no
 *                   collector — the plain app; overlay figures are then null)
 *   PERF_MODE       render mode (default enhanced)
 *   PERF_FIRMWARE   heavy-scene firmware (default hal-oled-ssd1306)
 *   PERF_VIEWPORT   WxH (default 1440x900)
 *   PERF_LABEL      run label (file names; default "run")
 *   PERF_OUT        output directory (default <os tmp>/ohmlet-perf-win)
 *
 * Writes <PERF_OUT>/<label>.json (every figure, every run) and
 * <PERF_OUT>/<label>.md (a summary table) and prints the table.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.PERF_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.PERF_CHANNEL ?? 'msedge'
const HEADED = process.env.PERF_HEADED === '1'
const SCENES = (process.env.PERF_SCENES ?? 'blink,heavy').split(',').map((s) => s.trim()).filter(Boolean)
const SECONDS = Number(process.env.PERF_SECONDS) || 6
const WARMUP_S = Number(process.env.PERF_WARMUP_S) || 4
const REPEAT = Math.max(1, Number(process.env.PERF_REPEAT) || 1)
const PROFILE = process.env.PERF_PROFILE !== '0'
const SAVE_PROFILE = process.env.PERF_SAVE_PROFILE === '1'
const OVERLAY = process.env.PERF_OVERLAY !== '0'
const MODE = process.env.PERF_MODE ?? 'enhanced'
const FIRMWARE = process.env.PERF_FIRMWARE ?? 'hal-oled-ssd1306'
const [VW, VH] = (process.env.PERF_VIEWPORT ?? '1440x900').split('x').map(Number)
const LABEL = process.env.PERF_LABEL ?? 'run'
const OUT = path.resolve(process.env.PERF_OUT ?? path.join(os.tmpdir(), 'ohmlet-perf-win'))

/** App areas for the profiler attribution (first match per frame wins). */
const AREAS = [
  ['glass tone sampler', (u) => u.includes('/src/ui/kit/glass/adapt.ts')],
  ['perf overlay', (u) => u.includes('/src/ui/perf/')],
  ['3D scene', (u) => u.includes('/src/three/') || /\/three(\.module)?\.js|\/deps\/three/.test(u)],
  ['instruments', (u) => u.includes('/src/ui/embedded/instruments/') || u.includes('/src/instruments/')],
  ['store / sim host', (u) => u.includes('/src/state/') || u.includes('/src/sim/')],
  ['lessons', (u) => u.includes('/src/lessons/') || u.includes('/src/ui/lessons/')],
  ['app UI (components)', (u) => u.includes('/src/ui/') || u.includes('/src/App.tsx')],
  ['React', (u) => /react-dom|\/deps\/react|scheduler/.test(u)],
  ['zustand', (u) => /zustand/.test(u)],
]

// --------------------------------------------------------------- page side

/** Init script: storage seed, long-task observer, rAF stamps, React commit counter. */
function initScript({ mode }) {
  if (!sessionStorage.getItem('perf-win-seeded')) {
    sessionStorage.setItem('perf-win-seeded', '1')
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.layout', JSON.stringify({ version: 1, components: [], wires: [] }))
    localStorage.setItem('bb.renderMode', mode)
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    localStorage.setItem('bb.lang', 'zh-TW')
  }
  const S = (window.__perfWin = { lt: [], raf: new Float64Array(1 << 16), rafN: 0, commits: 0 })
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) S.lt.push([e.startTime, e.duration])
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    /* no long-task API */
  }
  const tick = (t) => {
    S.raf[S.rafN++ & 0xffff] = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // React DevTools hook stub: React registers with it at load and reports
  // every commit — an exact commit count (the overlay collector wraps it too)
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let id = 0
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      inject(r) {
        id += 1
        this.renderers.set(id, r)
        return id
      },
      onCommitFiberRoot() {
        S.commits += 1
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      checkDCE() {},
    }
  }
}

/** Page-side: a snapshot of the cumulative counters at `now`. */
async function pageMark(page) {
  return page.evaluate(async () => {
    const S = window.__perfWin
    const store = await import('/src/state/store.ts')
    const lab = await import('/src/state/lab.ts')
    const st = store.useStore.getState()
    const l = lab.useLab.getState()
    const mcus = {}
    for (const [id, m] of Object.entries(l.mcus ?? {})) mcus[id] = { state: m.state, instructions: m.instructions ?? null, cycles: m.cycles ?? null }
    return {
      now: performance.now(),
      commits: S.commits,
      rafN: S.rafN,
      simTime: st.simTime ?? null,
      running: !!st.running,
      perf: l.perf ? { ...l.perf } : null,
      mcus,
      heap: performance.memory?.usedJSHeapSize ?? null,
    }
  })
}

/** Page-side: figures over [a.now, b.now]. */
async function pageWindow(page, a, b) {
  return page.evaluate(
    ([t0, t1]) => {
      const S = window.__perfWin
      let lt = 0
      let ltCount = 0
      for (const [s, d] of S.lt) {
        const e = s + d
        const o = Math.min(e, t1) - Math.max(s, t0)
        if (o > 0) {
          lt += o
          ltCount += 1
        }
      }
      const n = Math.min(S.rafN, 1 << 16)
      const stamps = []
      for (let k = 0; k < n; k++) {
        const t = S.raf[(S.rafN - 1 - k) & 0xffff]
        if (t < t0) break
        if (t <= t1) stamps.push(t)
      }
      stamps.reverse()
      const iv = []
      for (let i = 1; i < stamps.length; i++) iv.push(stamps[i] - stamps[i - 1])
      iv.sort((x, y) => x - y)
      const pct = (p) => (iv.length ? iv[Math.min(iv.length - 1, Math.max(0, Math.ceil(p * iv.length) - 1))] : null)
      const sum = iv.reduce((s, x) => s + x, 0)
      return {
        longTaskMs: lt,
        longTasks: ltCount,
        frames: iv.length,
        fps: iv.length && sum > 0 ? (iv.length * 1000) / sum : null,
        frameP50: pct(0.5),
        frameP95: pct(0.95),
        frameMax: iv.length ? iv[iv.length - 1] : null,
      }
    },
    [a.now, b.now],
  )
}

// --------------------------------------------------------------- scenes

async function openScene(page, scene) {
  if (scene === 'blink') {
    const res = await page.evaluate(async () => {
      const ex = await import('/src/ui/workspace/examples.ts')
      return ex.openExampleById('blink')
    })
    if (!res?.ok) throw new Error(`blink example did not open: ${JSON.stringify(res)}`)
    await page.waitForFunction(async () => {
      const lab = await import('/src/state/lab.ts')
      return !!lab.useLab.getState().firmware.U1
    }, null, { timeout: 60000 })
    await page.evaluate(async () => {
      const lab = await import('/src/state/lab.ts')
      const l = lab.useLab.getState()
      const have = l.logicChannels.map((c) => (c.source.kind === 'mcu-pin' ? c.source.pin : ''))
      const want = ['PA5', 'PC13', 'PA0', 'PA1']
      const channels = [...l.logicChannels]
      for (const pin of want) {
        if (have.includes(pin) || channels.length >= 8) continue
        channels.push({ index: channels.length, label: pin, source: { kind: 'mcu-pin', componentId: 'U1', pin } })
      }
      l.setLogicChannels(channels.map((c, i) => ({ ...c, index: i })))
    })
    return
  }
  // heavy / idle: the heavy reference circuit + bundled firmware on U1
  const fw = `${FIRMWARE}.elf`
  const res = await page.evaluate(async (file) => {
    const hs = await import('/src/ui/perf/heavy-scene.ts')
    const lab = await import('/src/state/lab.ts')
    const imp = await lab.useLab.getState().importProject(JSON.stringify(hs.heavyScene()))
    if (!imp.ok) return { ok: false, step: 'import', errors: imp.errors }
    const r = await fetch(`/firmware/dist/${file}`)
    if (!r.ok) return { ok: false, step: 'fetch', status: r.status }
    const bytes = new Uint8Array(await r.arrayBuffer())
    const ld = await lab.useLab.getState().loadFirmware('U1', { name: file, bytes })
    return ld.ok ? { ok: true } : { ok: false, step: 'firmware', error: ld.error }
  }, fw)
  if (!res.ok) throw new Error(`heavy scene did not load: ${JSON.stringify(res)}`)
}

async function startSim(page) {
  await page.evaluate(async () => {
    const store = await import('/src/state/store.ts')
    store.useStore.getState().startSim()
  })
  await page.waitForFunction(async () => {
    const store = await import('/src/state/store.ts')
    return store.useStore.getState().simTime > 0.05
  }, null, { timeout: 120000 })
}

// --------------------------------------------------------------- profiler

function aggregateProfile(profile) {
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const self = new Map()
  const areaOf = new Map()
  const areaFor = (id) => {
    if (areaOf.has(id)) return areaOf.get(id)
    const set = new Set()
    let cur = id
    while (cur !== undefined) {
      const u = byId.get(cur).callFrame.url ?? ''
      if (u) {
        for (const [name, test] of AREAS) {
          if (test(u)) {
            set.add(name)
            break
          }
        }
      }
      cur = parent.get(cur)
    }
    areaOf.set(id, set)
    return set
  }
  const area = new Map()
  let total = 0
  let idle = 0
  let program = 0
  let gc = 0
  const { samples, timeDeltas } = profile
  for (let i = 0; i < samples.length; i++) {
    const dt = (timeDeltas[i + 1] ?? 0) / 1000 // ms; delta to the NEXT sample belongs to this one
    const id = samples[i]
    const n = byId.get(id)
    total += dt
    const fn = n.callFrame.functionName
    if (fn === '(idle)') {
      idle += dt
      continue
    }
    if (fn === '(program)') program += dt
    if (fn === '(garbage collector)') gc += dt
    const key = `${fn || '(anonymous)'} ${shortUrl(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + dt)
    for (const a of areaFor(id)) area.set(a, (area.get(a) ?? 0) + dt)
  }
  const pct = (ms) => (total > 0 ? (100 * ms) / total : 0)
  return {
    wallMs: total,
    busyPct: pct(total - idle),
    programPct: pct(program),
    gcPct: pct(gc),
    areas: Object.fromEntries([...area.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +pct(v).toFixed(2)])),
    topSelf: [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([k, v]) => ({ fn: k, ms: +v.toFixed(1), pct: +pct(v).toFixed(2) })),
  }
}

function shortUrl(u) {
  if (!u) return ''
  const i = u.indexOf('/src/')
  if (i >= 0) return u.slice(i + 1).replace(/\?.*$/, '')
  const d = u.indexOf('/deps/')
  if (d >= 0) return u.slice(d + 1).replace(/\?.*$/, '')
  return u.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')
}

// --------------------------------------------------------------- one run

async function runScene(browser, scene, run = 0) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(initScript, { mode: MODE })
  const q = OVERLAY ? 'perfrig' : 'perfwin'
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}${q}`)
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.evaluate(async () => {
    const lab = await import('/src/state/lab.ts')
    await lab.labReady()
  })
  const gl = await page.evaluate(() => {
    try {
      const c = document.createElement('canvas').getContext('webgl2')
      const ext = c?.getExtension('WEBGL_debug_renderer_info')
      return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
    } catch {
      return null
    }
  })
  await openScene(page, scene)
  await page.waitForTimeout(1500) // layout settles, camera springs to the circuit
  if (scene !== 'idle') await startSim(page)
  await page.waitForTimeout(WARMUP_S * 1000)

  // ---- pass 1: plain measurement window
  const a = await pageMark(page)
  await page.waitForTimeout(SECONDS * 1000)
  const b = await pageMark(page)
  const w = await pageWindow(page, a, b)
  const overlay = OVERLAY ? await page.evaluate(() => window.__perfRig?.snapshot?.() ?? null) : null
  const wallS = (b.now - a.now) / 1000
  const mcus = {}
  for (const [id, m] of Object.entries(b.mcus)) {
    const p = a.mcus[id]
    mcus[id] = {
      state: m.state,
      mips: p && m.instructions !== null && p.instructions !== null && m.instructions >= p.instructions ? (m.instructions - p.instructions) / wallS / 1e6 : null,
      mhz: p && m.cycles !== null && p.cycles !== null && m.cycles >= p.cycles ? (m.cycles - p.cycles) / wallS / 1e6 : null,
    }
  }
  const result = {
    scene,
    gl,
    wallMs: b.now - a.now,
    longTaskPct: (100 * w.longTaskMs) / (b.now - a.now),
    longTasks: w.longTasks,
    fps: w.fps,
    frameP50: w.frameP50,
    frameP95: w.frameP95,
    frameMax: w.frameMax,
    commitsPerSec: (b.commits - a.commits) / wallS,
    simRealtime: a.simTime !== null && b.simTime !== null ? (b.simTime - a.simTime) / wallS : null,
    simPerf: b.perf,
    mcus,
    heapMB: b.heap !== null ? b.heap / 1048576 : null,
    overlay,
    profile: null,
    errors,
  }

  // ---- pass 2: the same page under the sampling profiler
  if (PROFILE) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
    await cdp.send('Profiler.start')
    await page.waitForTimeout(SECONDS * 1000)
    const { profile } = await cdp.send('Profiler.stop')
    result.profile = aggregateProfile(profile)
    if (SAVE_PROFILE) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(path.join(OUT, `${LABEL}-${scene}-${run}.cpuprofile`), JSON.stringify(profile))
    }
    await cdp.detach()
  }
  await ctx.close()
  return result
}

// --------------------------------------------------------------- report

const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d))

function table(rows) {
  const lines = [
    '| scene | long-task % | busy % (prof) | glass % | scene % | React % | store/sim % | fps | frame p50/p95 ms | commits/s | sim RT× | coord RT× | steps/s | worker % | MIPS | calls | tris |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const ar = r.profile?.areas ?? {}
    const mips = Object.entries(r.mcus).map(([id, m]) => `${id} ${f(m.mips)}`).join(', ') || '—'
    lines.push(
      `| ${r.scene} | ${f(r.longTaskPct)} | ${f(r.profile?.busyPct)} | ${f(ar['glass tone sampler'] ?? 0)} | ${f(ar['3D scene'] ?? 0)} | ${f(ar.React ?? 0)} | ${f(ar['store / sim host'] ?? 0)} | ${f(r.fps)} | ${f(r.frameP50)}/${f(r.frameP95)} | ${f(r.commitsPerSec)} | ${f(r.simRealtime, 2)} | ${f(r.simPerf?.realtimeFactor, 2)} | ${f(r.simPerf?.stepsPerSecond, 0)} | ${f(r.simPerf ? r.simPerf.busyMs / 10 : null)} | ${mips} | ${f(r.overlay?.calls, 0)} | ${f(r.overlay?.triangles, 0)} |`,
    )
  }
  return lines.join('\n')
}

const browser = await chromium.launch({
  channel: CHANNEL === 'bundled' ? undefined : CHANNEL,
  headless: !HEADED,
  args: ['--enable-precise-memory-info'],
})
const all = []
try {
  for (const scene of SCENES) {
    const runs = []
    for (let i = 0; i < REPEAT; i++) {
      process.stdout.write(`${scene} run ${i + 1}/${REPEAT}… `)
      const r = await runScene(browser, scene, i)
      console.log(`long-task ${f(r.longTaskPct)} %, fps ${f(r.fps)}, sim ${f(r.simRealtime, 2)}×`)
      runs.push(r)
    }
    const sorted = [...runs].sort((x, y) => x.longTaskPct - y.longTaskPct)
    all.push({ scene, median: sorted[Math.floor((sorted.length - 1) / 2)], runs })
  }
} finally {
  await browser.close()
}

mkdirSync(OUT, { recursive: true })
const meta = { label: LABEL, url: URL, channel: CHANNEL, headed: HEADED, mode: MODE, firmware: FIRMWARE, seconds: SECONDS, warmupS: WARMUP_S, viewport: `${VW}x${VH}`, overlay: OVERLAY, at: new Date().toISOString(), host: os.cpus()[0]?.model }
writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify({ meta, scenes: all }, null, 2))
let md = `# perf-win — ${LABEL}\n\n${JSON.stringify(meta)}\n\n${table(all.map((s) => s.median))}\n`
for (const s of all) {
  const p = s.median.profile
  if (!p) continue
  md += `\n## ${s.scene} — profiler (${f(p.wallMs / 1000)} s, busy ${f(p.busyPct)} %, (program) ${f(p.programPct)} %, GC ${f(p.gcPct)} %)\n\nareas (inclusive % of wall): ${JSON.stringify(p.areas)}\n\n| self % | function |\n|---|---|\n`
  for (const t of p.topSelf.slice(0, 15)) md += `| ${f(t.pct, 2)} | ${t.fn} |\n`
}
writeFileSync(path.join(OUT, `${LABEL}.md`), md)
console.log(`\n${md}\nwritten: ${path.join(OUT, `${LABEL}.json`)}`)
const failed = all.some((s) => s.runs.some((r) => r.errors.length > 0))
if (failed) console.log('page errors:', all.flatMap((s) => s.runs.flatMap((r) => r.errors)).slice(0, 5))
