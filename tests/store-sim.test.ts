/**
 * Store ↔ SimHost wiring (src/state/store.ts routes the simulation through
 * the SimHost contract of src/sim/coordinator/api.ts).
 *
 * Two layers:
 *  - a scripted FAKE host pins the store-side semantics exactly: host.load on
 *    every document change (incl. undo/redo) but not on runtime params or
 *    instrument moves, the telemetry sink on every frame vs. React state at
 *    ≤ 10 Hz (manual clock), stale-revision and pre-reset frames, the legacy
 *    "no session → AppState untouched" rule, the optimistic start that a host
 *    error rolls back, and the world-freezing MCU debugger halt;
 *  - the REAL inline host (src/sim/coordinator) runs an actual circuit with a
 *    manual tick scheduler and a frozen wall clock: start/pause on the host
 *    clock, speed, stepping, reset, a runtime param without rebuild, and a
 *    structural rebuild that keeps the clock.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CircuitLayout, ParamValue, SimTelemetry } from '../src/model/types'
import type { SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import * as C from '../src/sim/coordinator'
import * as S from '../src/state/store'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 5 V supply → rails → R1 (1 kΩ) rail to rail; scope probe ch1 on R1's + side. */
const CIRCUIT: CircuitLayout = {
  version: 1,
  name: 'store-sim',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['a10', 'a15'], params: { resistance: 1000 } },
    { id: 'PR1', type: 'scope_probe', holes: ['c10'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'W3', from: 'top+1', to: 'b10', color: 'red' },
    { id: 'W4', from: 'top-1', to: 'b15', color: 'black' },
  ],
}

function tele(time: number): SimTelemetry {
  return { time, netVoltages: {}, components: {}, issues: [] }
}

function frame(p: Partial<SimFrame> & { rev: number; time: number }): SimFrame {
  return {
    running: true,
    telemetry: tele(p.time),
    scope: [],
    uart: [],
    mcus: [],
    log: [],
    issues: [],
    perf: { realtimeFactor: 1, stepsPerSecond: 20000, busyMs: 1 },
    ...p,
  }
}

interface Call {
  method: string
  args: unknown[]
}

/** Scripted SimHost: records every call; the test pushes frames/errors. */
class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  readonly calls: Call[] = []
  lastRev = 0
  startError: string | null = null
  constructor(readonly cb: SimHostCallbacks) {}
  private rec(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }
  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length
  }
  emit(p: Partial<SimFrame> & { time: number }): void {
    this.cb.onFrame(frame({ rev: this.lastRev, ...p }))
  }
  load(layout: CircuitLayout, rev: number): void {
    this.lastRev = rev
    this.rec('load', [layout, rev])
  }
  setFirmware(...a: unknown[]): void {
    this.rec('setFirmware', a)
  }
  start(speed: number): void {
    this.rec('start', [speed])
    if (this.startError) this.cb.onError?.(this.startError)
  }
  pause(): void {
    this.rec('pause', [])
  }
  reset(): void {
    this.rec('reset', [])
  }
  setSpeed(s: number): void {
    this.rec('setSpeed', [s])
  }
  stepTime(s: number): void {
    this.rec('stepTime', [s])
  }
  mcuReset(id: string): void {
    this.rec('mcuReset', [id])
  }
  mcuHalt(id: string): void {
    this.rec('mcuHalt', [id])
  }
  mcuResume(id: string): void {
    this.rec('mcuResume', [id])
  }
  mcuStep(id: string): void {
    this.rec('mcuStep', [id])
  }
  setRuntimeParam(id: string, key: string, value: ParamValue): void {
    this.rec('setRuntimeParam', [id, key, value])
  }
  uartSend(...a: unknown[]): void {
    this.rec('uartSend', a)
  }
  setLogicChannels(...a: unknown[]): void {
    this.rec('setLogicChannels', a)
  }
  async query(): Promise<never> {
    throw new Error('not scripted')
  }
  dispose(): void {
    this.rec('dispose', [])
  }
}

function resetStoreTo(layout: CircuitLayout): void {
  S.useStore.getState().resetSim()
  S.__resetHistoryForTests()
  S.useStore.setState({
    layout,
    selection: [],
    mode: { kind: 'select' },
    canUndo: false,
    canRedo: false,
    simSpeed: 1,
    issues: [],
  })
}

// ---------------------------------------------------------------------------
// Fake host: exact store-side semantics
// ---------------------------------------------------------------------------

describe('store ↔ SimHost (scripted fake host)', () => {
  const st = () => S.useStore.getState()
  let hosts: FakeHost[] = []
  let clock = 0
  const host = (): FakeHost => hosts[hosts.length - 1]

  beforeEach(() => {
    hosts = []
    clock = 0
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    S.__setSimClockForTests(() => clock)
    resetStoreTo(CIRCUIT)
  })

  afterEach(() => {
    S.setTelemetrySink(null)
    S.__setSimClockForTests(null)
    S.__setSimHostFactoryForTests(null)
  })

  it('creates no host until one is needed; resetSim never builds one', () => {
    st().resetSim()
    st().setSimSpeed(3)
    expect(hosts).toHaveLength(0)
    expect(S.peekSimHost()).toBeNull()
  })

  it('startSim boots the host with the current document, then starts it optimistically', () => {
    st().setSimSpeed(10)
    st().startSim()
    expect(hosts).toHaveLength(1)
    expect(st().running).toBe(true)
    expect(host().calls.map((c) => c.method)).toEqual(['load', 'start'])
    expect(host().calls[0].args[0]).toBe(st().layout)
    expect(host().calls[1].args).toEqual([10])
    st().startSim() // already running: no-op
    expect(host().count('start')).toBe(1)
  })

  it('a host error rolls the optimistic start back and the next start boots a fresh host', () => {
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      if (hosts.length === 0) h.startError = 'worker crashed'
      hosts.push(h)
      return h
    })
    st().startSim()
    expect(st().running).toBe(false)
    expect(st().issues).toEqual([{ level: 'error', message: 'simulation failed to start: worker crashed' }])
    expect(hosts[0].count('dispose')).toBe(1)
    expect(S.peekSimHost()).toBeNull()

    st().startSim()
    expect(hosts).toHaveLength(2)
    expect(st().running).toBe(true)
    expect(hosts[1].count('load')).toBe(1) // the new host got the document
  })

  it('a factory that throws leaves the sim stopped with one error issue', () => {
    S.__setSimHostFactoryForTests(() => {
      throw new Error('no Worker')
    })
    st().startSim()
    expect(st().running).toBe(false)
    expect(st().issues).toEqual([{ level: 'error', message: 'simulation failed to start: Error: no Worker' }])
  })

  it('an error reported while the host is being built fails the start', () => {
    S.__setSimHostFactoryForTests((cb) => {
      cb.onError?.('module worker unsupported')
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    st().startSim()
    expect(st().running).toBe(false)
    expect(st().issues[0].message).toBe('simulation failed to start: module worker unsupported')
    expect(hosts[0].count('dispose')).toBe(1)
    expect(hosts[0].count('start')).toBe(0)
  })

  it('an error while running reports a stopped simulation', () => {
    st().startSim()
    host().emit({ time: 0.01, running: true }) // start confirmed
    host().cb.onError?.('out of memory')
    expect(st().running).toBe(false)
    expect(st().issues[0].message).toBe('simulation stopped: out of memory')
  })

  it('every document change reloads the host — undo/redo too — but runtime params and instrument moves do not', () => {
    st().startSim()
    const h = host()
    const loads = (): number => h.count('load')
    let n = loads()

    st().addComponent('resistor', { holes: ['a20', 'a24'] })
    expect(loads()).toBe(++n)
    const revs = h.calls.filter((c) => c.method === 'load').map((c) => c.args[1] as number)
    expect(revs[revs.length - 1]).toBeGreaterThan(revs[0]) // fresh revision per load

    st().setParam('PS1', 'voltage', 3.3) // runtime param
    expect(loads()).toBe(n)
    expect(h.calls[h.calls.length - 1]).toEqual({ method: 'setRuntimeParam', args: ['PS1', 'voltage', 3.3] })

    expect(st().setInstrumentPos('PS1', { x: -20, z: 30 }).ok).toBe(true) // visual only
    expect(loads()).toBe(n)

    st().setParam('R1', 'resistance', 2200) // structural
    expect(loads()).toBe(++n)
    expect((h.calls[h.calls.length - 1].args[0] as CircuitLayout).components.find((c) => c.id === 'R1')?.params)
      .toEqual({ resistance: 2200 })

    st().undo()
    expect(loads()).toBe(++n)
    expect(h.calls[h.calls.length - 1].args[0]).toBe(st().layout)
    st().redo()
    expect(loads()).toBe(++n)
    expect(h.calls[h.calls.length - 1].args[0]).toBe(st().layout)

    S.useStore.setState({ layout: CIRCUIT }) // direct document swap
    expect(loads()).toBe(++n)
  })

  it('the telemetry sink sees every frame; React state moves at most every 100 ms while running', () => {
    const seen: (SimTelemetry | null)[] = []
    S.setTelemetrySink((t) => seen.push(t))
    st().startSim()
    seen.length = 0
    let pushes = 0
    const unsub = S.useStore.subscribe((s, p) => {
      if (s.simTime !== p.simTime) pushes++
    })
    for (let i = 1; i <= 13; i++) {
      clock = i * 16 // ~60 fps for 208 ms
      host().emit({ time: i / 1000 })
    }
    unsub()
    expect(seen).toHaveLength(13)
    expect(seen[12]?.time).toBe(0.013)
    // the first frame pushes at once (t=16 ms), the next only once 100 ms have
    // passed (t=128 ms); React lags the scene by < 100 ms, as before
    expect(pushes).toBe(2)
    expect(st().simTime).toBe(0.008)
    st().stopSim() // the final state lands on stop
    expect(st().simTime).toBe(0.013)
  })

  it('paused frames publish at once; stopSim leaves the last frame on screen', () => {
    st().startSim()
    clock = 0
    host().emit({ time: 0.5 })
    clock = 10
    host().emit({ time: 0.6 }) // throttled
    expect(st().simTime).toBe(0.5)
    st().stopSim()
    expect(host().count('pause')).toBe(1)
    expect(st().simTime).toBe(0.6) // legacy publishNow on stop
    clock = 11
    host().emit({ time: 0.6001, running: false }) // e.g. a stepTime frame
    expect(st().simTime).toBe(0.6001)
  })

  it('scope samples accumulate per frame and are trimmed to the scope window', () => {
    st().startSim()
    for (let k = 0; k < 10; k++) {
      clock = k * 200
      const t = (k + 1) * 0.1
      host().emit({ time: t, scope: [{ t, v: [k, NaN, NaN, NaN] }] })
    }
    expect(st().scope.samples).toHaveLength(10)
    st().setScopeWindow(0.25)
    expect(st().scope.samples.map((s) => s.v[0])).toEqual([7, 8, 9])
    expect(st().scope.timeWindow).toBe(0.25)
  })

  it('frames of a superseded revision keep their events but not their snapshot; pre-reset frames are dropped', () => {
    st().startSim()
    const h = host()
    const oldRev = h.lastRev
    st().setParam('R1', 'resistance', 330) // reload → new revision
    expect(h.lastRev).toBeGreaterThan(oldRev)
    const seen: (SimTelemetry | null)[] = []
    S.setTelemetrySink((t) => seen.push(t))
    seen.length = 0
    h.cb.onFrame(frame({ rev: oldRev, time: 0.2, scope: [{ t: 0.2, v: [1, NaN, NaN, NaN] }] }))
    expect(seen).toEqual([]) // stale snapshot never reaches the scene
    expect(st().scope.samples.map((s) => s.t)).toEqual([0.2]) // the sample is real
    h.cb.onFrame(frame({ rev: h.lastRev, time: 0.21 }))
    expect(seen).toHaveLength(1)

    const preReset = h.lastRev
    st().resetSim()
    expect(h.count('reset')).toBe(1)
    expect(h.lastRev).toBeGreaterThan(preReset) // the power-cycled world has a fresh revision
    st().startSim()
    h.cb.onFrame(frame({ rev: preReset, time: 9, scope: [{ t: 9, v: [9, NaN, NaN, NaN] }] }))
    expect(st().simTime).toBe(0)
    expect(st().scope.samples).toEqual([])
  })

  it('outside a session host frames never touch AppState (legacy: no engine before start)', () => {
    S.getSimHost() // e.g. the lab store created it to load firmware
    S.useStore.setState({ issues: [{ level: 'warning', message: 'from the validator' }] })
    host().emit({ time: 0.3, running: false, issues: [{ level: 'error', message: 'chip unpowered' }] })
    expect(st().telemetry).toBeNull()
    expect(st().simTime).toBe(0)
    expect(st().issues).toEqual([{ level: 'warning', message: 'from the validator' }])
  })

  it('resetSim clears the session state and power-cycles the host', () => {
    const seen: (SimTelemetry | null)[] = []
    S.setTelemetrySink((t) => seen.push(t))
    st().startSim()
    host().emit({ time: 0.4, scope: [{ t: 0.4, v: [1, 2, 3, 4] }], issues: [{ level: 'warning', message: 'x' }] })
    expect(st().simTime).toBe(0.4)
    st().resetSim()
    expect(st().running).toBe(false)
    expect(st().simTime).toBe(0)
    expect(st().telemetry).toBeNull()
    expect(st().issues).toEqual([])
    expect(st().scope.samples).toEqual([])
    expect(seen[seen.length - 1]).toBeNull()
    const order = host().calls.map((c) => c.method).slice(-3)
    expect(order).toEqual(['pause', 'reset', 'load'])
  })

  it('setSimSpeed validates and forwards to an existing host', () => {
    st().setSimSpeed(0.1)
    expect(st().simSpeed).toBe(0.1)
    st().startSim()
    expect(host().calls.find((c) => c.method === 'start')?.args).toEqual([0.1])
    st().setSimSpeed(10)
    expect(host().calls[host().calls.length - 1]).toEqual({ method: 'setSpeed', args: [10] })
    for (const bad of [0, -1, NaN, Infinity]) st().setSimSpeed(bad)
    expect(st().simSpeed).toBe(10)
    expect(host().count('setSpeed')).toBe(1)
  })

  it('loadLayout and clearBoard end the session and reload the host', () => {
    st().startSim()
    host().emit({ time: 0.1 })
    const loads = host().count('load')
    expect(st().loadLayout({ ...CIRCUIT, name: 'again' }).ok).toBe(true)
    expect(st().running).toBe(false)
    expect(st().simTime).toBe(0)
    // power-cycle reload + the new document
    expect(host().count('load')).toBe(loads + 2)
    expect((host().calls[host().calls.length - 1].args[0] as CircuitLayout).name).toBe('again')
    st().clearBoard()
    expect((host().calls[host().calls.length - 1].args[0] as CircuitLayout).components).toEqual([])
  })

  it('an MCU debugger halt that froze the world pauses the session; resuming restarts it', () => {
    const halted = {
      componentId: 'U1',
      state: 'halted' as const,
      firmware: 'fw.elf',
      pc: 0x08000200,
      hclkHz: 72e6,
      cycles: 1,
      realtime: 0,
      uarts: [],
    }
    st().startSim()
    host().emit({ time: 0.1 }) // start confirmed
    // a stale paused frame WITHOUT a halted MCU is not a halt
    host().emit({ time: 0.1, running: false })
    expect(st().running).toBe(true)
    host().emit({ time: 0.12, running: false, mcus: [halted] })
    expect(st().running).toBe(false)
    expect(st().simTime).toBe(0.12) // the session stays: paused, not reset
    const starts = host().count('start')
    S.resumeAfterDebugHalt()
    expect(st().running).toBe(true)
    expect(host().count('start')).toBe(starts + 1)
    S.resumeAfterDebugHalt() // nothing pending any more
    expect(host().count('start')).toBe(starts + 1)
  })

  it('a halt seen after the user paused does not arm an automatic resume', () => {
    st().startSim()
    host().emit({ time: 0.1 })
    st().stopSim()
    host().emit({ time: 0.1, running: false, mcus: [{ componentId: 'U1', state: 'halted', firmware: null, pc: 0, hclkHz: 8e6, cycles: 0, realtime: 0, uarts: [] }] })
    const starts = host().count('start')
    S.resumeAfterDebugHalt()
    expect(st().running).toBe(false)
    expect(host().count('start')).toBe(starts)
  })
})

// ---------------------------------------------------------------------------
// Real inline host: an actual circuit, ticked by hand on a frozen clock
// ---------------------------------------------------------------------------

describe('store ↔ inline SimHost (real coordinator)', () => {
  const st = () => S.useStore.getState()
  let calls: Call[] = []
  let created: SimHost | null = null
  /** wall clock (ms) shared by the host and the store's React throttle */
  let now = 0
  let queued: (() => void) | null = null
  const scheduler: C.TickScheduler = {
    request: (cb) => {
      queued = cb
      return 1
    },
    cancel: () => {
      queued = null
    },
  }
  /** let `ms` of wall time pass and run the host's pending tick, if any */
  const tick = (ms: number): void => {
    now += ms
    const cb = queued
    queued = null
    cb?.()
  }

  const r1mA = (): number => Math.abs(st().telemetry?.components.R1?.current ?? NaN) * 1000
  const count = (m: string): number => calls.filter((c) => c.method === m).length

  beforeEach(() => {
    calls = []
    created = null
    now = 0
    queued = null
    // the real inline host, with every call recorded on the way through
    S.__setSimHostFactoryForTests((cb) => {
      const real = new C.InlineSimHost(cb, { scheduler, clock: () => now })
      created = new Proxy(real, {
        get(target, prop, receiver) {
          const v: unknown = Reflect.get(target, prop, receiver)
          if (typeof v !== 'function') return v
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args })
            return (v as (...a: unknown[]) => unknown).apply(target, args)
          }
        },
      })
      return created
    })
    S.__setSimClockForTests(() => now)
    resetStoreTo(CIRCUIT)
  })

  afterEach(() => {
    S.useStore.getState().resetSim()
    S.__setSimClockForTests(null)
    S.__setSimHostFactoryForTests(null)
  })

  it('createSimHost gives node the inline host', () => {
    const h = C.createSimHost({ onFrame: () => {} })
    expect(h.kind).toBe('inline')
    h.dispose()
  })

  it('start runs the world on the host clock × speed; pause freezes it and shows the final state', () => {
    const seen: (SimTelemetry | null)[] = []
    S.setTelemetrySink((t) => seen.push(t))
    st().startSim()
    expect(created?.kind).toBe('inline')
    expect(st().running).toBe(true)
    expect(count('load')).toBe(1)
    expect(count('start')).toBe(1)
    // the start frame (t = 0) was the first React push; the first tick lands
    // inside the same 100 ms window, so only the scene sees it
    tick(16) // first tick: one 60 Hz frame of wall time
    expect(st().simTime).toBe(0)
    expect(seen[seen.length - 1]?.time).toBeCloseTo(1 / 60, 4) // engine time: whole 50 µs steps
    tick(100)
    expect(st().simTime).toBeCloseTo(1 / 60 + 0.1, 6)
    expect(r1mA()).toBeCloseTo(5, 1) // 5 V across 1 kΩ
    tick(50) // throttled for React again — the scene still sees it
    expect(st().simTime).toBeCloseTo(1 / 60 + 0.1, 6)
    expect(seen[seen.length - 1]?.time).toBeCloseTo(1 / 60 + 0.15, 4)
    st().stopSim()
    expect(st().running).toBe(false)
    expect(count('pause')).toBe(1)
    expect(st().simTime).toBeCloseTo(1 / 60 + 0.15, 6) // the final state lands on stop
    tick(500) // no tick is scheduled while paused
    expect(st().simTime).toBeCloseTo(1 / 60 + 0.15, 6)
    S.setTelemetrySink(null)
  })

  it('speed scales sim time, before and during a run', () => {
    st().setSimSpeed(2)
    st().startSim()
    expect(calls.find((c) => c.method === 'start')?.args).toEqual([2])
    tick(16)
    tick(100)
    expect(st().simTime).toBeCloseTo(2 / 60 + 0.2, 6)
    st().setSimSpeed(0.5)
    expect(calls.filter((c) => c.method === 'setSpeed').map((c) => c.args)).toEqual([[0.5]])
    tick(100)
    expect(st().simTime).toBeCloseTo(2 / 60 + 0.25, 6)
  })

  it('stepping while paused advances sim time and publishes telemetry + the 1 kHz scope feed', () => {
    st().startSim()
    st().stopSim()
    S.stepSimTime(0.02)
    expect(st().simTime).toBeCloseTo(0.02, 6)
    expect(r1mA()).toBeCloseTo(5, 1)
    const samples = st().scope.samples
    expect(samples.length).toBeGreaterThanOrEqual(15)
    expect(samples[samples.length - 1].t).toBeLessThanOrEqual(0.02 + 1e-9)
    expect(samples[samples.length - 1].v[0]).toBeCloseTo(5, 1) // ch1 on the 5 V net
  })

  it('reset power-cycles the world: time back to 0, the next session starts from scratch', () => {
    S.stepSimTime(0.01)
    expect(st().simTime).toBeCloseTo(0.01, 6)
    st().resetSim()
    expect(count('reset')).toBe(1)
    expect(st().simTime).toBe(0)
    expect(st().telemetry).toBeNull()
    expect(st().scope.samples).toEqual([])
    S.stepSimTime(0.005)
    expect(st().simTime).toBeCloseTo(0.005, 6)
    expect(r1mA()).toBeCloseTo(5, 1)
  })

  it('a runtime param changes the live world without a reload', () => {
    S.stepSimTime(0.01)
    const loads = count('load')
    st().setParam('PS1', 'voltage', 3)
    expect(count('load')).toBe(loads)
    expect(count('setRuntimeParam')).toBe(1)
    S.stepSimTime(0.01)
    expect(st().simTime).toBeCloseTo(0.02, 6)
    expect(r1mA()).toBeCloseTo(3, 1)
  })

  it('a structural edit rebuilds through host.load while the clock keeps running; undo rebuilds back', () => {
    S.stepSimTime(0.01)
    const loads = count('load')
    st().setParam('R1', 'resistance', 500)
    expect(count('load')).toBe(loads + 1)
    S.stepSimTime(0.01)
    expect(st().simTime).toBeCloseTo(0.02, 6) // not a power cycle
    expect(r1mA()).toBeCloseTo(10, 1)
    st().undo()
    expect(count('load')).toBe(loads + 2)
    S.stepSimTime(0.01)
    expect(st().simTime).toBeCloseTo(0.03, 6)
    expect(r1mA()).toBeCloseTo(5, 1)
  })

  it('edits while running reload the host without stopping it', () => {
    st().startSim()
    tick(16)
    st().setParam('R1', 'resistance', 2000)
    expect(st().running).toBe(true)
    tick(100)
    expect(st().simTime).toBeCloseTo(1 / 60 + 0.1, 6)
    expect(r1mA()).toBeCloseTo(2.5, 1)
  })
})

