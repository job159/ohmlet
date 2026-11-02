/**
 * WorkerSimHost — the browser SimHost: the SimulationCoordinator runs in a
 * module Web Worker (./sim.worker.ts), so firmware execution and the solver
 * never block the main thread.
 *
 * Spawned exactly like src/llm/verify.worker.ts:
 *   new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
 *
 * Protocol (structured clone; query results transfer their typed-array
 * buffers): MainToWorker commands mirror the SimHost methods; the worker
 * answers with 'frame' (coalesced to ≤ 60 Hz while running, immediate after a
 * paused command), 'query-result' and 'error'.
 *
 * Worker timing (SimWorkerRuntime): sim time follows wall time × speed. Each
 * timer tick adds the elapsed wall time (capped by MAX_CATCH_UP_MS) to a
 * sim-time debt and pays it in slices while a compute budget lasts; debt
 * beyond the catch-up cap is dropped, so an overloaded simulation runs slower
 * than real time (reported as perf.realtimeFactor) instead of spiralling.
 * While debt remains the next tick follows immediately (MessageChannel, not
 * a clamped timer) so a worker that is behind uses its whole core; commands
 * from the main thread still interleave between ticks.
 */
import type { CircuitLayout, ParamValue } from '../../model/types'
import type { FirmwareImage } from '../../mcu/firmware'
import { SimulationCoordinator } from './coordinator'
import type { CoordinatorOptions } from './coordinator'
import { registerTrackingTarget } from './tracking'
import type {
  HostQuery,
  HostQueryResult,
  LogicChannelConfig,
  SimFrame,
  SimHost,
  SimHostCallbacks,
} from './api'

// ---------------------------------------------------------------- protocol

export type MainToWorker =
  | { type: 'load'; layout: CircuitLayout; rev: number }
  | { type: 'firmware'; componentId: string; image: FirmwareImage | null }
  | { type: 'start'; speed: number }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'speed'; speed: number }
  | { type: 'step'; seconds: number }
  | { type: 'mcu'; op: 'reset' | 'halt' | 'resume' | 'step'; componentId: string }
  | { type: 'param'; componentId: string; key: string; value: ParamValue }
  | { type: 'uart'; componentId: string; port: string; bytes: Uint8Array }
  | { type: 'logic-channels'; channels: LogicChannelConfig[] }
  | { type: 'query'; id: number; query: HostQuery }
  | { type: 'currents'; on: boolean }
  | { type: 'dispose' }

export type WorkerToMain =
  | { type: 'frame'; frame: SimFrame }
  | { type: 'query-result'; id: number; result?: HostQueryResult; error?: string }
  | { type: 'error'; message: string }

/** Buffers of a query result that can be moved instead of copied. */
export function transferablesOf(r: HostQueryResult): Transferable[] {
  const out: Transferable[] = []
  if (r.kind === 'logic') {
    for (const t of r.capture.traces) out.push(t.times.buffer, t.levels.buffer)
  } else if (r.kind === 'scope') {
    for (const t of r.capture.traces) out.push(t.t.buffer, t.v.buffer)
  } else if (r.kind === 'mcu-memory' && r.bytes) {
    out.push(r.bytes.buffer)
  }
  // a buffer may only appear once in a transfer list
  return [...new Set(out)]
}

// ---------------------------------------------------------- main thread

export class WorkerSimHost implements SimHost {
  readonly kind = 'worker' as const
  private readonly worker: Worker
  private readonly pending = new Map<
    number,
    { resolve: (r: HostQueryResult) => void; reject: (e: Error) => void }
  >()
  private nextQuery = 1
  private dead = false
  /** leave the 顯示電流 tracking registry (./tracking.ts) */
  private readonly untrack: () => void

  /** Throws when the worker cannot be constructed (createSimHost then falls back to inline). */
  constructor(private readonly callbacks: SimHostCallbacks) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.onMessage(e.data)
    this.worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.()
      this.fail(e.message ? `simulation worker crashed: ${e.message}` : 'simulation worker crashed')
    }
    this.worker.onmessageerror = () => this.fail('simulation worker sent an unreadable message')
    this.untrack = registerTrackingTarget(this)
  }

  private onMessage(m: WorkerToMain): void {
    if (this.dead || !m) return
    switch (m.type) {
      case 'frame':
        this.callbacks.onFrame(m.frame)
        break
      case 'query-result': {
        const p = this.pending.get(m.id)
        if (!p) return
        this.pending.delete(m.id)
        if (m.result) p.resolve(m.result)
        else p.reject(new Error(m.error ?? 'query failed'))
        break
      }
      case 'error':
        this.fail(m.message)
        break
    }
  }

  private fail(message: string): void {
    if (this.dead) return
    this.callbacks.onError?.(message)
  }

  private post(m: MainToWorker): void {
    if (this.dead) return
    this.worker.postMessage(m)
  }

  load(layout: CircuitLayout, rev: number): void {
    this.post({ type: 'load', layout, rev })
  }
  setFirmware(componentId: string, image: FirmwareImage | null): void {
    this.post({ type: 'firmware', componentId, image })
  }
  start(speed: number): void {
    this.post({ type: 'start', speed })
  }
  pause(): void {
    this.post({ type: 'pause' })
  }
  reset(): void {
    this.post({ type: 'reset' })
  }
  setSpeed(speed: number): void {
    this.post({ type: 'speed', speed })
  }
  stepTime(seconds: number): void {
    this.post({ type: 'step', seconds })
  }
  mcuReset(componentId: string): void {
    this.post({ type: 'mcu', op: 'reset', componentId })
  }
  mcuHalt(componentId: string): void {
    this.post({ type: 'mcu', op: 'halt', componentId })
  }
  mcuResume(componentId: string): void {
    this.post({ type: 'mcu', op: 'resume', componentId })
  }
  mcuStep(componentId: string): void {
    this.post({ type: 'mcu', op: 'step', componentId })
  }
  setRuntimeParam(componentId: string, key: string, value: ParamValue): void {
    this.post({ type: 'param', componentId, key, value })
  }
  uartSend(componentId: string, port: string, bytes: Uint8Array): void {
    this.post({ type: 'uart', componentId, port, bytes: bytes.slice() })
  }
  setLogicChannels(channels: LogicChannelConfig[]): void {
    this.post({ type: 'logic-channels', channels })
  }
  setCurrentTracking(on: boolean): void {
    this.post({ type: 'currents', on })
  }
  query(q: HostQuery): Promise<HostQueryResult> {
    if (this.dead) return Promise.reject(new Error('simulation host disposed'))
    const id = this.nextQuery++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ type: 'query', id, query: q })
    })
  }
  dispose(): void {
    if (this.dead) return
    this.untrack()
    this.post({ type: 'dispose' })
    this.dead = true
    this.worker.terminate()
    for (const p of this.pending.values()) p.reject(new Error('simulation host disposed'))
    this.pending.clear()
  }
}

// --------------------------------------------------------- worker side

/** Minimal timer / clock surface (injectable for node tests). */
export interface WorkerRuntimeEnv {
  post(m: WorkerToMain, transfer: Transferable[]): void
  clock?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /**
   * Run `fn` as soon as pending messages were handled (default: a
   * MessageChannel round trip — unlike setTimeout it is not clamped to 4 ms,
   * so a worker that is behind real time keeps the CPU instead of idling).
   */
  yieldNow?: (fn: () => void) => void
  coordinator?: CoordinatorOptions
}

function defaultYield(): (fn: () => void) => void {
  if (typeof MessageChannel === 'undefined') return (fn) => void setTimeout(fn, 0)
  let ch: MessageChannel | null = null // created on first use
  const queue: (() => void)[] = []
  return (fn) => {
    if (!ch) {
      ch = new MessageChannel()
      ch.port1.onmessage = () => queue.shift()?.()
      // node (tests): never keep the process alive for this port
      ;(ch.port1 as unknown as { unref?: () => void }).unref?.()
    }
    queue.push(fn)
    ch.port2.postMessage(0)
  }
}

/** Frames are coalesced to at most one per this many ms (≤ 60 Hz). */
export const FRAME_INTERVAL_MS = 1000 / 60
/** Wall time at most simulated per tick (ms) — the catch-up cap. */
export const MAX_CATCH_UP_MS = 250
/** Compute budget per timer tick (ms) before yielding to the message queue. */
const TICK_BUDGET_MS = 12
/** Timer period while running (ms). */
const TICK_MS = 4
/** Sim-time slice between budget checks (s). */
const SLICE = 1e-3

/**
 * The worker's side: owns the coordinator, runs the wall-clock loop and
 * answers commands. Pure TS (no `self`) so node tests can drive it.
 */
export class SimWorkerRuntime {
  readonly coordinator: SimulationCoordinator
  private readonly clock: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void
  private readonly yieldNow: (fn: () => void) => void
  /** a tick is queued (timer or yield) */
  private queued = false
  private running = false
  private speed = 1
  private timer: unknown = null
  private lastWall: number | null = null
  private debt = 0
  private lastFrameWall = -Infinity
  private disposed = false

  constructor(private readonly env: WorkerRuntimeEnv) {
    this.clock =
      env.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.setTimer = env.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = env.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.yieldNow = env.yieldNow ?? defaultYield()
    this.coordinator = new SimulationCoordinator({ clock: this.clock, ...env.coordinator })
  }

  handle(m: MainToWorker): void {
    if (this.disposed || !m) return
    const co = this.coordinator
    try {
      switch (m.type) {
        case 'load':
          co.load(m.layout, m.rev)
          this.postFrame()
          break
        case 'firmware':
          co.setFirmware(m.componentId, m.image)
          this.postFrame()
          break
        case 'start':
          this.setSpeed(m.speed)
          if (!this.running) {
            this.running = true
            this.lastWall = null
            this.debt = 0
            this.postFrame()
            this.schedule()
          }
          break
        case 'pause':
          if (this.running) {
            this.running = false
            this.unschedule()
            this.postFrame()
          }
          break
        case 'reset':
          co.reset()
          this.lastWall = null
          this.debt = 0
          this.postFrame()
          break
        case 'speed':
          this.setSpeed(m.speed)
          break
        case 'step':
          if (!this.running && m.seconds > 0 && Number.isFinite(m.seconds)) {
            co.advance(m.seconds)
            this.postFrame()
          }
          break
        case 'mcu':
          if (m.op === 'reset') co.mcuReset(m.componentId)
          else if (m.op === 'halt') co.mcuHalt(m.componentId)
          else if (m.op === 'resume') co.mcuResume(m.componentId)
          else co.mcuStep(m.componentId)
          this.postFrame()
          break
        case 'param':
          co.setRuntimeParam(m.componentId, m.key, m.value)
          break
        case 'uart':
          co.uartSend(m.componentId, m.port, m.bytes)
          break
        case 'logic-channels':
          co.setLogicChannels(m.channels)
          break
        case 'currents':
          co.setCurrentTracking(m.on === true)
          break
        case 'query': {
          let result: HostQueryResult
          try {
            result = co.query(m.query)
          } catch (err) {
            this.env.post({ type: 'query-result', id: m.id, error: String(err) }, [])
            break
          }
          this.env.post({ type: 'query-result', id: m.id, result }, transferablesOf(result))
          break
        }
        case 'dispose':
          this.disposed = true
          this.running = false
          this.unschedule()
          co.dispose()
          break
      }
    } catch (err) {
      this.running = false
      this.unschedule()
      this.env.post({ type: 'error', message: err instanceof Error ? err.message : String(err) }, [])
    }
  }

  private setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed
  }

  private schedule(): void {
    if (this.queued || !this.running) return
    this.queued = true
    this.timer = this.setTimer(() => this.tick(), TICK_MS)
  }

  /** Behind real time: continue right after the message queue drains. */
  private scheduleNow(): void {
    if (this.queued || !this.running) return
    this.queued = true
    this.yieldNow(() => this.tick())
  }

  private unschedule(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.queued = false
  }

  /** One wall-clock tick while running. */
  tick(): void {
    this.timer = null
    this.queued = false
    if (!this.running || this.disposed) return
    const now = this.clock()
    const wallMs = this.lastWall === null ? 0 : Math.min(Math.max(now - this.lastWall, 0), MAX_CATCH_UP_MS)
    this.lastWall = now
    // sim time owed = wall time × speed, capped so an overloaded sim never spirals
    this.debt = Math.min(this.debt + (wallMs / 1000) * this.speed, (MAX_CATCH_UP_MS / 1000) * this.speed)
    const deadline = now + TICK_BUDGET_MS
    try {
      while (this.debt > 1e-12) {
        const slice = Math.min(this.debt, SLICE)
        this.coordinator.advance(slice)
        this.debt -= slice
        if (this.coordinator.halted) {
          this.running = false
          this.debt = 0
          break
        }
        if (this.clock() >= deadline) break
      }
    } catch (err) {
      this.running = false
      this.env.post({ type: 'error', message: err instanceof Error ? err.message : String(err) }, [])
      return
    }
    const t = this.clock()
    if (!this.running || t - this.lastFrameWall >= FRAME_INTERVAL_MS) this.postFrame()
    if (this.debt > 1e-12) this.scheduleNow()
    else this.schedule()
  }

  private postFrame(): void {
    if (this.disposed) return
    this.lastFrameWall = this.clock()
    this.env.post({ type: 'frame', frame: this.coordinator.frame(this.running) }, [])
  }
}
