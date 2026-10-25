/**
 * Performance diagnostics collector (the 效能診斷 overlay and the profiling
 * rig scripts/perf-win.mjs read it). Started only while diagnostics are on;
 * stop() removes every hook, so a normal session pays nothing.
 *
 * Sources (all measured, nothing estimated):
 *  - requestAnimationFrame timestamps → frame rate and frame interval
 *    p50 / p95 (what the user sees, GPU included);
 *  - the scene's diagnostics probe (BreadboardScene.attachPerfProbe) → CPU
 *    ms of each animation frame, draw calls / triangles summed over every
 *    render pass, telemetry-application cost and how many part visuals were
 *    refreshed vs skipped as unchanged; renderer.info.memory → geometries /
 *    textures / shader programs held;
 *  - React commits: counted through the React DevTools global hook when one
 *    is installed before React loads (the DevTools extension, or the rig's
 *    init script) — exact. Without it React offers no commit callback, so
 *    the collector counts DOM mutation batches under <body> instead and the
 *    overlay labels the figure as such;
 *  - simulation frames (store onSimHostEvent): the coordinator's own
 *    realtime factor, analog steps/s and busy ms per second (worker load),
 *    frames/s, and per MCU board MIPS / simulated MHz from the retired
 *    instruction and cycle counters of successive frames; the main-thread
 *    cost of handling one frame (store + scene + the React render it
 *    triggers synchronously) is timed from the frame event to the second
 *    microtask after it;
 *  - performance.memory (Chromium) → JS heap in use;
 *  - PerformanceObserver 'longtask' entries (Chromium; null elsewhere — the
 *    overlay says the browser does not report them) → the share of wall
 *    time the main thread spent in tasks of ≥ 50 ms (the jank figure);
 *  - the scene canvas's WEBGL_debug_renderer_info string → whether WebGL
 *    runs in software (SwiftShader / llvmpipe / Microsoft Basic Render),
 *    where frame figures do not represent a machine with a GPU.
 */
import { onSimHostEvent } from '../../state/store'
import { createScenePerfProbe, type ScenePerfProbe } from '../../three/scene'

/** What the collector needs from the 3D scene (feature-detected). */
export interface PerfSceneLike {
  attachPerfProbe?(probe: ScenePerfProbe | null): void
  perfMemory?(): { geometries: number; textures: number; programs: number } | null
}

export interface McuPerf {
  componentId: string
  state: string
  /** million instructions per wall second (null: no instruction counter / no data yet) */
  mips: number | null
  /** simulated core MHz per wall second */
  mhz: number | null
}

export interface PerfSnapshot {
  /** wall ms covered by the rates below */
  windowMs: number
  fps: number | null
  frameP50: number | null
  frameP95: number | null
  /** CPU ms of the scene's animation frames */
  cpuP50: number | null
  cpuP95: number | null
  calls: number | null
  triangles: number | null
  geometries: number | null
  textures: number | null
  programs: number | null
  commitsPerSec: number | null
  /** 'react' = exact React commits, 'dom' = DOM mutation batches (no DevTools hook) */
  commitSource: 'react' | 'dom'
  telemetryPushesPerSec: number | null
  /** CPU ms per telemetry push (scene part refresh) */
  telemetryMsPerPush: number | null
  partsAppliedPerPush: number | null
  partsSkippedPerPush: number | null
  sim: {
    running: boolean
    realtime: number
    stepsPerSecond: number
    /** worker load: busy ms per wall second / 10 */
    busyPct: number
    framesPerSec: number | null
    /** main-thread ms spent handling one frame (avg over the window) */
    handleMs: number | null
  } | null
  mcus: McuPerf[]
  heapMB: number | null
  /** share (0…1) of the window the main thread spent in long tasks (≥ 50 ms); null = not reported by this browser */
  longTaskShare: number | null
  /** WebGL renderer string (null = not exposed) and whether it is a software rasterizer */
  gpu: { renderer: string | null; software: boolean }
}

/** Software rasterizers: frame rates there are CPU-bound and not what a GPU machine sees. */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|software/i

/** The WebGL renderer behind `canvas` (its existing context; null when not exposed). */
export function glRendererOf(canvas: HTMLCanvasElement | null): { renderer: string | null; software: boolean } {
  try {
    const gl = (canvas?.getContext('webgl2') ?? null) as WebGL2RenderingContext | null
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null
    return { renderer, software: renderer !== null && SOFTWARE_GL.test(renderer) }
  } catch {
    return { renderer: null, software: false }
  }
}

/** Cumulative counter sampled over time → rate over a trailing window. */
class RateWindow {
  private readonly t: number[] = []
  private readonly v: number[] = []
  push(t: number, v: number): void {
    this.t.push(t)
    this.v.push(v)
    // keep ~10 s of samples
    while (this.t.length > 2 && t - this.t[0] > 10_000) {
      this.t.shift()
      this.v.shift()
    }
  }
  /** (Δvalue, Δms) over the newest `windowMs` (at least two samples) */
  delta(windowMs: number): { dv: number; dt: number } | null {
    const n = this.t.length
    if (n < 2) return null
    const tEnd = this.t[n - 1]
    let i = n - 2
    while (i > 0 && tEnd - this.t[i] < windowMs) i--
    const dt = tEnd - this.t[i]
    if (dt <= 0) return null
    return { dv: this.v[n - 1] - this.v[i], dt }
  }
  rate(windowMs: number): number | null {
    const d = this.delta(windowMs)
    return d ? (d.dv * 1000) / d.dt : null
  }
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[i]
}

interface ReactHook {
  onCommitFiberRoot?: (...args: unknown[]) => unknown
  renderers?: Map<unknown, unknown>
}

const RAF_CAP = 1024
/** trailing window of the reported rates (ms) */
export const PERF_WINDOW_MS = 2000

export class PerfCollector {
  private running = false
  private startedAt = 0
  private raf = 0
  private readonly rafT = new Float64Array(RAF_CAP)
  private rafN = 0
  private commits = 0
  private commitSource: 'react' | 'dom' = 'dom'
  private undo: (() => void)[] = []
  private probe: ScenePerfProbe = createScenePerfProbe(RAF_CAP)
  private scene: PerfSceneLike | null = null
  /** elements whose own DOM writes are not "app" mutations (the overlay) */
  private readonly ignoreRoots = new Set<Node>()
  /** long tasks as flat [start, end, start, end, …] (ms, trailing ~10 s); null = not supported */
  private longTasks: number[] | null = null
  private gpu: { renderer: string | null; software: boolean } | null = null

  // simulation
  private simFrames = 0
  private simHandleMs = 0
  private lastPerf: { running: boolean; realtime: number; stepsPerSecond: number; busyMs: number } | null = null
  private readonly mcuPrev = new Map<string, { wall: number; instr: number | null; cycles: number }>()
  private readonly mcuNow = new Map<string, McuPerf>()

  // windows over cumulative counters
  private readonly wCommits = new RateWindow()
  private readonly wSimFrames = new RateWindow()
  private readonly wSimHandle = new RateWindow()
  private readonly wTelePushes = new RateWindow()
  private readonly wTeleMs = new RateWindow()
  private readonly wApplied = new RateWindow()
  private readonly wSkipped = new RateWindow()

  start(): void {
    if (this.running || typeof window === 'undefined') return
    this.running = true
    this.startedAt = performance.now()
    this.rafN = 0
    this.probe = createScenePerfProbe(RAF_CAP)
    const tick = (t: number) => {
      if (!this.running) return
      this.rafT[this.rafN % RAF_CAP] = t
      this.rafN++
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
    this.undo.push(() => cancelAnimationFrame(this.raf))
    this.hookCommits()
    this.hookLongTasks()
    this.undo.push(onSimHostEvent((e) => {
      if (e.kind === 'frame') this.onFrame(e.frame)
      else if (e.kind === 'reset' || e.kind === 'disposed') {
        this.mcuPrev.clear()
        this.mcuNow.clear()
        this.lastPerf = null
      }
    }))
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    for (const u of this.undo.splice(0)) {
      try {
        u()
      } catch {
        /* already gone */
      }
    }
    this.setScene(null)
    this.mcuPrev.clear()
    this.mcuNow.clear()
    this.lastPerf = null
    this.longTasks = null
    this.gpu = null
  }

  get active(): boolean {
    return this.running
  }

  /** Attach the scene probe (null detaches); safe to call every tick. */
  setScene(scene: PerfSceneLike | null): void {
    if (scene === this.scene) return
    this.scene?.attachPerfProbe?.(null)
    this.scene = scene
    if (scene && this.running) scene.attachPerfProbe?.(this.probe)
  }

  /** DOM writes under `el` are not counted as app mutation batches. */
  ignoreMutationsIn(el: Node): () => void {
    this.ignoreRoots.add(el)
    return () => this.ignoreRoots.delete(el)
  }

  private hookLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined') return
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')) return
    const list: number[] = []
    try {
      const obs = new PerformanceObserver((entries) => {
        for (const e of entries.getEntries()) list.push(e.startTime, e.startTime + e.duration)
        // keep ~10 s
        const cut = performance.now() - 10_000
        let drop = 0
        while (drop < list.length && list[drop + 1] < cut) drop += 2
        if (drop > 0) list.splice(0, drop)
      })
      obs.observe({ type: 'longtask' })
      this.longTasks = list
      this.undo.push(() => obs.disconnect())
    } catch {
      this.longTasks = null
    }
  }

  /** Share (0…1) of [t0, t1] covered by long tasks. */
  private longTaskShare(t0: number, t1: number): number | null {
    const lt = this.longTasks
    if (!lt || t1 <= t0) return null
    let busy = 0
    for (let i = 0; i < lt.length; i += 2) {
      const o = Math.min(lt[i + 1], t1) - Math.max(lt[i], t0)
      if (o > 0) busy += o
    }
    return Math.min(1, busy / (t1 - t0))
  }

  private hookCommits(): void {
    const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: ReactHook }).__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (hook && typeof hook.onCommitFiberRoot === 'function' && (hook.renderers?.size ?? 0) > 0) {
      const orig = hook.onCommitFiberRoot
      const wrapped = (...args: unknown[]) => {
        this.commits++
        return orig.apply(hook, args)
      }
      hook.onCommitFiberRoot = wrapped
      this.commitSource = 'react'
      this.undo.push(() => {
        if (hook.onCommitFiberRoot === wrapped) hook.onCommitFiberRoot = orig
      })
      return
    }
    this.commitSource = 'dom'
    // the whole body: chrome rendered through portals (capsule, sheets, panels) counts too
    const root = document.body
    if (!root || typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        let inside = false
        for (const ig of this.ignoreRoots) {
          if (ig.contains(r.target)) {
            inside = true
            break
          }
        }
        if (!inside) {
          this.commits++
          return
        }
      }
    })
    obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
    this.undo.push(() => obs.disconnect())
  }

  private onFrame(f: import('../../sim/coordinator/api').SimFrame): void {
    const t0 = performance.now()
    this.simFrames++
    // store + scene + the synchronous React render the frame triggers: React
    // flushes uSES updates in a microtask queued after this listener, so
    // the second microtask runs once that flush is done
    queueMicrotask(() =>
      queueMicrotask(() => {
        this.simHandleMs += performance.now() - t0
      }),
    )
    this.lastPerf = {
      running: f.running,
      realtime: f.perf.realtimeFactor,
      stepsPerSecond: f.perf.stepsPerSecond,
      busyMs: f.perf.busyMs,
    }
    const seen = new Set<string>()
    for (const m of f.mcus) {
      seen.add(m.componentId)
      const instr = typeof m.instructions === 'number' ? m.instructions : null
      const prev = this.mcuPrev.get(m.componentId)
      const cur = { wall: t0, instr, cycles: m.cycles }
      let out = this.mcuNow.get(m.componentId)
      if (!out) {
        out = { componentId: m.componentId, state: m.state, mips: null, mhz: null }
        this.mcuNow.set(m.componentId, out)
      }
      out.state = m.state
      if (!prev) {
        this.mcuPrev.set(m.componentId, cur)
        continue
      }
      const dt = t0 - prev.wall
      if (dt < 500) continue // rates over ≥ 0.5 s of wall time
      // a counter that went backwards = a reset in between: restart the window
      if (m.cycles >= prev.cycles) out.mhz = (m.cycles - prev.cycles) / dt / 1000
      if (instr !== null && prev.instr !== null && instr >= prev.instr) out.mips = (instr - prev.instr) / dt / 1000
      else if (instr === null) out.mips = null
      this.mcuPrev.set(m.componentId, cur)
    }
    for (const id of [...this.mcuNow.keys()]) {
      if (!seen.has(id)) {
        this.mcuNow.delete(id)
        this.mcuPrev.delete(id)
      }
    }
  }

  /** Current figures (rates over the trailing PERF_WINDOW_MS). */
  snapshot(): PerfSnapshot {
    const now = performance.now()
    const p = this.probe
    this.wCommits.push(now, this.commits)
    this.wSimFrames.push(now, this.simFrames)
    this.wSimHandle.push(now, this.simHandleMs)
    this.wTelePushes.push(now, p.telemetryPushes)
    this.wTeleMs.push(now, p.telemetryMs)
    this.wApplied.push(now, p.partsApplied)
    this.wSkipped.push(now, p.partsSkipped)

    // rAF intervals inside the window
    const n = Math.min(this.rafN, RAF_CAP)
    const intervals: number[] = []
    let newest = -Infinity
    for (let k = 1; k < n; k++) {
      const i = (this.rafN - k) % RAF_CAP
      const j = (this.rafN - k - 1) % RAF_CAP
      const t = this.rafT[i]
      if (k === 1) newest = t
      if (newest - this.rafT[j] > PERF_WINDOW_MS) break
      intervals.push(t - this.rafT[j])
    }
    const iv = Float64Array.from(intervals).sort()
    let sum = 0
    for (const x of iv) sum += x
    const fps = iv.length > 0 && sum > 0 ? (iv.length * 1000) / sum : null

    // scene CPU per frame (newest frames covering about the same window)
    let cpuP50: number | null = null
    let cpuP95: number | null = null
    if (p.frames > 0) {
      const take = Math.min(p.frames, p.frameMs.length, Math.max(1, iv.length))
      const cpu = new Float64Array(take)
      for (let k = 0; k < take; k++) cpu[k] = p.frameMs[(p.frames - 1 - k) % p.frameMs.length]
      cpu.sort()
      cpuP50 = percentile(cpu, 0.5)
      cpuP95 = percentile(cpu, 0.95)
    }
    const mem = this.scene?.perfMemory?.() ?? null

    const pushes = this.wTelePushes.delta(PERF_WINDOW_MS)
    const perPush = (w: RateWindow): number | null => {
      const d = w.delta(PERF_WINDOW_MS)
      return d && pushes && pushes.dv > 0 ? d.dv / pushes.dv : null
    }
    const frames = this.wSimFrames.delta(PERF_WINDOW_MS)
    const handle = this.wSimHandle.delta(PERF_WINDOW_MS)
    const lp = this.lastPerf
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    if (!this.gpu || this.gpu.renderer === null) {
      this.gpu = glRendererOf(typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('.app-canvas canvas'))
    }
    // long tasks: over the same trailing window (or since start, when shorter)
    const ltFrom = Math.max(now - PERF_WINDOW_MS, this.startedAt)

    return {
      windowMs: PERF_WINDOW_MS,
      fps,
      frameP50: iv.length > 0 ? percentile(iv, 0.5) : null,
      frameP95: iv.length > 0 ? percentile(iv, 0.95) : null,
      cpuP50,
      cpuP95,
      calls: p.frames > 0 ? p.calls : null,
      triangles: p.frames > 0 ? p.triangles : null,
      geometries: mem?.geometries ?? null,
      textures: mem?.textures ?? null,
      programs: mem?.programs ?? null,
      commitsPerSec: this.wCommits.rate(PERF_WINDOW_MS),
      commitSource: this.commitSource,
      telemetryPushesPerSec: this.wTelePushes.rate(PERF_WINDOW_MS),
      telemetryMsPerPush: perPush(this.wTeleMs),
      partsAppliedPerPush: perPush(this.wApplied),
      partsSkippedPerPush: perPush(this.wSkipped),
      sim: lp
        ? {
            running: lp.running,
            realtime: lp.realtime,
            stepsPerSecond: lp.stepsPerSecond,
            busyPct: lp.busyMs / 10,
            framesPerSec: frames && frames.dt > 0 ? (frames.dv * 1000) / frames.dt : null,
            handleMs: handle && frames && frames.dv > 0 ? handle.dv / frames.dv : null,
          }
        : null,
      mcus: [...this.mcuNow.values()].map((m) => ({ ...m })),
      heapMB: typeof heap === 'number' ? heap / (1024 * 1024) : null,
      longTaskShare: now - ltFrom >= 250 ? this.longTaskShare(ltFrom, now) : null,
      gpu: this.gpu ?? { renderer: null, software: false },
    }
  }
}

/** The page-wide collector (the overlay and the rig share it). */
export const perfCollector = new PerfCollector()
