/**
 * SimHost implementations:
 *  - InlineSimHost driven by a MANUAL scheduler and a fake wall clock
 *    (start / pause / stepTime / speed / reset / budget / query / dispose);
 *  - SimWorkerRuntime (the worker side) with fake timers: wall × speed,
 *    catch-up cap, ≤ 60 Hz frame coalescing, transferable query results;
 *  - WorkerSimHost end-to-end against an in-process Worker stub that runs
 *    the real SimWorkerRuntime (protocol round trip, errors);
 *  - createSimHost picks the inline host in node.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { InlineSimHost } from '../../src/sim/coordinator/inline-host'
import type { TickScheduler } from '../../src/sim/coordinator/inline-host'
import {
  FRAME_INTERVAL_MS,
  MAX_CATCH_UP_MS,
  SimWorkerRuntime,
  transferablesOf,
  WorkerSimHost,
} from '../../src/sim/coordinator/worker-host'
import type { MainToWorker, WorkerToMain } from '../../src/sim/coordinator/worker-host'
import { createSimHost } from '../../src/sim/coordinator'
import type { SimFrame } from '../../src/sim/coordinator/api'
import type { CircuitLayout } from '../../src/model/types'

/** 5 V → 1 kΩ → GND with a scope probe on the 5 V side. */
const CIRCUIT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['a10', 'a15'], params: { resistance: 1000 } },
    { id: 'PR1', type: 'scope_probe', holes: ['c10'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0' },
    { id: 'W2', from: 'PS1:-', to: 'top-0' },
    { id: 'W3', from: 'top+1', to: 'b10' },
    { id: 'W4', from: 'top-1', to: 'b15' },
  ],
}

class ManualScheduler implements TickScheduler {
  pending: (() => void) | null = null
  request(cb: () => void): unknown {
    this.pending = cb
    return 1
  }
  cancel(): void {
    this.pending = null
  }
  fire(): void {
    const cb = this.pending
    this.pending = null
    cb?.()
  }
}

describe('InlineSimHost', () => {
  function setup(clockFn?: () => number) {
    const sched = new ManualScheduler()
    let now = 0
    const frames: SimFrame[] = []
    const host = new InlineSimHost(
      { onFrame: (f) => frames.push(f) },
      { scheduler: sched, clock: clockFn ?? (() => now) },
    )
    return { host, sched, frames, setNow: (t: number) => (now = t), last: () => frames[frames.length - 1] }
  }

  it('publishes on load; start/tick/pause advance sim time by wall time × speed', () => {
    const { host, sched, frames, setNow, last } = setup()
    host.load(CIRCUIT, 7)
    expect(frames.length).toBe(1)
    expect(last().rev).toBe(7)
    expect(last().running).toBe(false)
    host.start(1)
    expect(last().running).toBe(true)
    expect(sched.pending).not.toBeNull()
    setNow(0)
    sched.fire() // first tick after start simulates one 60 Hz frame
    expect(last().time).toBeCloseTo(1 / 60, 9)
    setNow(20)
    sched.fire()
    expect(last().time).toBeCloseTo(1 / 60 + 0.02, 9)
    expect(last().telemetry.components.R1.current).toBeCloseTo(0.005, 6)
    expect(last().scope.length).toBeGreaterThan(10) // 1 kHz legacy feed (deltas)
    host.pause()
    expect(last().running).toBe(false)
    expect(sched.pending).toBeNull()
    expect(host.isRunning).toBe(false)
  })

  it('stepTime advances exactly while paused (no-op while running)', () => {
    const { host, last, sched } = setup()
    host.load(CIRCUIT, 1)
    host.stepTime(0.01)
    expect(last().time).toBeCloseTo(0.01, 12)
    host.start(1)
    const n = last().time
    host.stepTime(5)
    expect(last().time).toBe(n)
    host.pause()
    sched.fire()
  })

  it('speed scales sim time; the per-tick wall budget lets sim time fall behind', () => {
    const { host, sched, setNow, last } = setup()
    host.load(CIRCUIT, 1)
    host.start(4)
    sched.fire()
    const t0 = last().time
    setNow(10)
    sched.fire()
    expect(last().time - t0).toBeCloseTo(0.04, 9)
    host.dispose()
    // a clock that jumps 10 ms per read: the budget expires after one 1 ms slice
    let wall = 0
    const s2 = setup(() => (wall += 10))
    s2.host.load(CIRCUIT, 1)
    s2.host.start(1)
    s2.sched.fire()
    expect(s2.last().time).toBeCloseTo(0.001, 9)
  })

  it('reset returns to t = 0; query resolves; dispose stops frames', async () => {
    const { host, frames, last } = setup()
    host.load(CIRCUIT, 1)
    host.stepTime(0.005)
    const q = await host.query({ kind: 'scope', t0: 0, t1: 1 })
    expect(q.kind).toBe('scope')
    if (q.kind === 'scope') {
      expect(q.capture.traces[0].t.length).toBe(100) // every analog step
      expect(q.capture.traces[0].v[99]).toBeCloseTo(5, 3)
    }
    host.reset()
    expect(last().time).toBe(0)
    host.dispose()
    const n = frames.length
    host.stepTime(0.01)
    expect(frames.length).toBe(n)
  })

  it('reports a coordinator crash through onError and stops', () => {
    const sched = new ManualScheduler()
    const errors: string[] = []
    const host = new InlineSimHost({ onFrame: () => {}, onError: (m) => errors.push(m) }, { scheduler: sched, clock: () => 0 })
    host.load(CIRCUIT, 1)
    host.coordinator.advance = () => {
      throw new Error('boom')
    }
    host.start(1)
    sched.fire()
    expect(errors).toEqual(['simulation error: boom'])
    expect(host.isRunning).toBe(false)
  })
})

describe('SimWorkerRuntime (worker side)', () => {
  function setup() {
    const posted: { m: WorkerToMain; transfer: Transferable[] }[] = []
    let now = 0
    const timers: (() => void)[] = []
    const rt = new SimWorkerRuntime({
      post: (m, transfer) => posted.push({ m, transfer }),
      clock: () => now,
      setTimer: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimer: () => {
        timers.length = 0
      },
    })
    const frames = () => posted.filter((p) => p.m.type === 'frame').map((p) => (p.m as { frame: SimFrame }).frame)
    const runTimer = () => {
      const fn = timers.shift()
      fn?.()
    }
    return { rt, posted, frames, runTimer, setNow: (t: number) => (now = t) }
  }

  it('follows wall time × speed, coalesces frames to ≤ 60 Hz and caps catch-up', () => {
    const { rt, frames, runTimer, setNow } = setup()
    rt.handle({ type: 'load', layout: CIRCUIT, rev: 3 })
    expect(frames().length).toBe(1)
    expect(frames()[0].rev).toBe(3)
    rt.handle({ type: 'start', speed: 2 })
    const afterStart = frames().length
    // ticks every 4 ms: sim follows wall × 2, frames only every ≥ 16.7 ms
    for (let t = 4; t <= 100; t += 4) {
      setNow(t)
      runTimer()
    }
    const fr = frames().slice(afterStart)
    expect(fr.length).toBeGreaterThanOrEqual(5)
    expect(fr.length).toBeLessThanOrEqual(Math.ceil(100 / FRAME_INTERVAL_MS) + 1)
    expect(fr[fr.length - 1].time).toBeCloseTo((100 - 4) * 2 / 1000, 9) // first tick only sets the wall origin
    // a 10 s stall is not caught up: at most MAX_CATCH_UP_MS of wall time
    const before = fr[fr.length - 1].time
    setNow(10_100)
    runTimer()
    const after = frames()[frames().length - 1].time
    expect(after - before).toBeLessThanOrEqual((MAX_CATCH_UP_MS / 1000) * 2 + 1e-9)
    rt.handle({ type: 'pause' })
    expect(frames()[frames().length - 1].running).toBe(false)
  })

  it('steps while paused, answers queries with transferable buffers', () => {
    const { rt, posted, frames } = setup()
    rt.handle({ type: 'load', layout: CIRCUIT, rev: 1 })
    rt.handle({ type: 'step', seconds: 0.002 })
    expect(frames()[frames().length - 1].time).toBeCloseTo(0.002, 12)
    rt.handle({ type: 'query', id: 42, query: { kind: 'scope', t0: 0, t1: 1 } })
    const reply = posted.find((p) => p.m.type === 'query-result')!
    expect(reply.m).toMatchObject({ type: 'query-result', id: 42 })
    const result = (reply.m as { result: Parameters<typeof transferablesOf>[0] }).result
    expect(reply.transfer).toEqual(transferablesOf(result))
    expect(reply.transfer.length).toBe(2) // t and v of the one scope channel
  })

  it('applies runtime params without a reload', () => {
    const { rt, frames } = setup()
    rt.handle({ type: 'load', layout: CIRCUIT, rev: 1 })
    rt.handle({ type: 'param', componentId: 'PS1', key: 'voltage', value: 3 })
    rt.handle({ type: 'step', seconds: 0.001 })
    expect(frames()[frames().length - 1].telemetry.components.R1.current).toBeCloseTo(0.003, 6)
  })
})

describe('WorkerSimHost over an in-process Worker stub', () => {
  const realWorker = (globalThis as { Worker?: unknown }).Worker

  afterEach(() => {
    ;(globalThis as { Worker?: unknown }).Worker = realWorker
  })

  /** Minimal Worker stand-in: runs SimWorkerRuntime on the same thread, async like a real worker. */
  class StubWorker {
    static last: StubWorker | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: ((e: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    terminated = false
    readonly url: string
    readonly runtime: SimWorkerRuntime
    constructor(url: URL | string, opts?: { type?: string }) {
      this.url = String(url)
      expect(opts?.type).toBe('module')
      StubWorker.last = this
      this.runtime = new SimWorkerRuntime({
        post: (m) => queueMicrotask(() => this.onmessage?.({ data: m } as MessageEvent)),
        setTimer: () => 0,
        clearTimer: () => {},
      })
    }
    postMessage(m: MainToWorker): void {
      queueMicrotask(() => this.runtime.handle(structuredClone(m)))
    }
    terminate(): void {
      this.terminated = true
    }
  }

  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('loads the module worker, relays frames and query results, disposes cleanly', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = StubWorker
    const frames: SimFrame[] = []
    const host = new WorkerSimHost({ onFrame: (f) => frames.push(f) })
    expect(host.kind).toBe('worker')
    expect(StubWorker.last!.url).toMatch(/sim\.worker\.ts$/)
    host.load(CIRCUIT, 5)
    host.stepTime(0.003)
    await flush()
    expect(frames.map((f) => f.rev)).toEqual([5, 5])
    expect(frames[1].time).toBeCloseTo(0.003, 12)
    const q = await host.query({ kind: 'logic', t0: 0, t1: 1 })
    expect(q.kind).toBe('logic')
    host.dispose()
    expect(StubWorker.last!.terminated).toBe(true)
    await expect(host.query({ kind: 'logic', t0: 0, t1: 1 })).rejects.toThrow('disposed')
  })

  it('surfaces worker crashes through onError', () => {
    ;(globalThis as { Worker?: unknown }).Worker = StubWorker
    const errors: string[] = []
    new WorkerSimHost({ onFrame: () => {}, onError: (m) => errors.push(m) })
    StubWorker.last!.onerror?.({ message: 'kaput', preventDefault() {} } as unknown as ErrorEvent)
    expect(errors).toEqual(['simulation worker crashed: kaput'])
  })

  it('createSimHost: worker when Worker exists, inline in node', () => {
    expect(createSimHost({ onFrame: () => {} }).kind).toBe('inline')
    ;(globalThis as { Worker?: unknown }).Worker = StubWorker
    const h = createSimHost({ onFrame: () => {} })
    expect(h.kind).toBe('worker')
    h.dispose()
    ;(globalThis as { Worker?: unknown }).Worker = class {
      constructor() {
        throw new Error('blocked by CSP')
      }
    }
    expect(createSimHost({ onFrame: () => {} }).kind).toBe('inline')
  })
})
