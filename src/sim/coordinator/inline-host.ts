/**
 * InlineSimHost — runs a SimulationCoordinator on the calling thread.
 *
 * Used in node (tests) and as the browser fallback when a Web Worker cannot
 * be created. Each tick advances sim time by (wall time since the previous
 * tick × speed), capped at `maxCatchUpMs` of wall time, in SLICE-sized
 * pieces while a per-tick wall-clock budget lasts — when the budget runs out
 * sim time simply falls behind (exactly the legacy store loop's rule), so the
 * UI never freezes. The scheduler and the clock are injectable: node tests
 * tick the host by hand with a frozen clock, which makes every run
 * deterministic.
 */
import type { CircuitLayout, ParamValue } from '../../model/types'
import type { FirmwareImage } from '../../mcu/firmware'
import { SimulationCoordinator } from './coordinator'
import type { CoordinatorOptions } from './coordinator'
import type {
  HostQuery,
  HostQueryResult,
  LogicChannelConfig,
  SimHost,
  SimHostCallbacks,
} from './api'

/** Where ticks come from (requestAnimationFrame in the browser, manual in tests). */
export interface TickScheduler {
  request(cb: () => void): unknown
  cancel(handle: unknown): void
}

export interface InlineSimHostOptions {
  scheduler?: TickScheduler
  /** wall clock (ms) */
  clock?: () => number
  /** wall-clock compute budget per tick (ms) — legacy FRAME_BUDGET_MS */
  budgetMs?: number
  /** most wall time one tick simulates (ms) — legacy MAX_FRAME_WALL_DT */
  maxCatchUpMs?: number
  /** a prebuilt coordinator, or options for a new one */
  coordinator?: SimulationCoordinator | CoordinatorOptions
}

/** Sim-time slice between wall-budget checks (s) — legacy SCOPE_SAMPLE_DT slices. */
const SLICE = 1e-3

function defaultScheduler(): TickScheduler {
  if (typeof requestAnimationFrame === 'function') {
    return {
      request: (cb) => requestAnimationFrame(() => cb()),
      cancel: (h) => cancelAnimationFrame(h as number),
    }
  }
  return {
    request: (cb) => setTimeout(cb, 16),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class InlineSimHost implements SimHost {
  readonly kind = 'inline' as const
  readonly coordinator: SimulationCoordinator
  private readonly scheduler: TickScheduler
  private readonly clock: () => number
  private readonly budgetMs: number
  private readonly maxCatchUpMs: number
  private running = false
  private speed = 1
  private handle: unknown = null
  private lastWall: number | null = null
  private disposed = false

  constructor(
    private readonly callbacks: SimHostCallbacks,
    opts: InlineSimHostOptions = {},
  ) {
    this.scheduler = opts.scheduler ?? defaultScheduler()
    this.clock = opts.clock ?? defaultClock
    this.budgetMs = opts.budgetMs ?? 8
    this.maxCatchUpMs = opts.maxCatchUpMs ?? 250 // legacy MAX_FRAME_WALL_DT
    const co = opts.coordinator
    this.coordinator =
      co instanceof SimulationCoordinator ? co : new SimulationCoordinator({ clock: this.clock, ...co })
  }

  get isRunning(): boolean {
    return this.running
  }

  load(layout: CircuitLayout, rev: number): void {
    this.coordinator.load(layout, rev)
    this.publish()
  }

  setFirmware(componentId: string, image: FirmwareImage | null): void {
    this.coordinator.setFirmware(componentId, image)
    this.publish()
  }

  start(speed: number): void {
    if (this.disposed) return
    this.setSpeed(speed)
    if (this.running) return
    this.running = true
    this.lastWall = null
    this.schedule()
    this.publish()
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    this.unschedule()
    this.publish()
  }

  reset(): void {
    this.coordinator.reset()
    this.lastWall = null
    this.publish()
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed
  }

  stepTime(seconds: number): void {
    if (this.running || !(seconds > 0) || !Number.isFinite(seconds)) return
    this.coordinator.advance(seconds)
    this.publish()
  }

  mcuReset(componentId: string): void {
    this.coordinator.mcuReset(componentId)
    this.publish()
  }

  mcuHalt(componentId: string): void {
    this.coordinator.mcuHalt(componentId)
    this.publish()
  }

  mcuResume(componentId: string): void {
    this.coordinator.mcuResume(componentId)
    this.publish()
  }

  mcuStep(componentId: string): void {
    this.coordinator.mcuStep(componentId)
    this.publish()
  }

  setRuntimeParam(componentId: string, key: string, value: ParamValue): void {
    this.coordinator.setRuntimeParam(componentId, key, value)
  }

  uartSend(componentId: string, port: string, bytes: Uint8Array): void {
    this.coordinator.uartSend(componentId, port, bytes)
  }

  setLogicChannels(channels: LogicChannelConfig[]): void {
    this.coordinator.setLogicChannels(channels)
  }

  query(q: HostQuery): Promise<HostQueryResult> {
    try {
      return Promise.resolve(this.coordinator.query(q))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  dispose(): void {
    this.running = false
    this.unschedule()
    this.disposed = true
    this.coordinator.dispose()
  }

  /**
   * One tick (normally from the scheduler; tests may call it directly with
   * a manual scheduler): simulate the wall time elapsed since the previous
   * tick × speed, within the wall budget, then publish a frame.
   */
  tick(): void {
    this.handle = null
    if (!this.running || this.disposed) return
    const now = this.clock()
    const wallMs =
      this.lastWall === null ? 1000 / 60 : Math.min(Math.max(now - this.lastWall, 0), this.maxCatchUpMs)
    this.lastWall = now
    let remaining = (wallMs / 1000) * this.speed
    const deadline = now + this.budgetMs
    try {
      while (remaining > 1e-12) {
        const slice = Math.min(remaining, SLICE)
        this.coordinator.advance(slice)
        remaining -= slice
        if (this.coordinator.halted) {
          this.running = false // debugger halt / breakpoint pauses the world
          break
        }
        if (this.clock() >= deadline) break // budget spent: sim time falls behind
      }
    } catch (err) {
      this.running = false
      this.callbacks.onError?.(`simulation error: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    this.publish()
    if (this.running) this.schedule()
  }

  private schedule(): void {
    if (this.handle !== null || !this.running) return
    this.handle = this.scheduler.request(() => this.tick())
  }

  private unschedule(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle)
    this.handle = null
  }

  private publish(): void {
    if (this.disposed) return
    this.callbacks.onFrame(this.coordinator.frame(this.running))
  }
}
