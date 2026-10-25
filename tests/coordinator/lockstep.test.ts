/**
 * Lockstep timing of the SimulationCoordinator with a FAKE McuDevice whose
 * pin activity is scripted at exact core cycles:
 *  - analog-coupled edges end analog steps EXACTLY at the edge time;
 *  - 1 kHz / 25 % PWM into an LED: exact logic edges, scope samples at the
 *    edges, measured duty 25.0 %;
 *  - very fast toggling (2 MHz) is duty-averaged into ≥ 0.5 µs steps and
 *    an RC low-pass settles at duty × VDD;
 *  - determinism: identical edge timestamps across runs and across very
 *    different advance() chunkings, including an analog → MCU → logic
 *    feedback path.
 */
import { describe, expect, it } from 'vitest'
import { MIN_ANALOG_DT, SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { LogicCapture, ScopeCapture } from '../../src/sim/coordinator/api'
import type { CircuitLayout } from '../../src/model/types'
import { FakeMcu, PwmProgram } from './fake-mcu'
import { bluePillWorld, part, PA0, PA5, PA9, tap, w } from './worlds'

const HZ = 8e6
const PERIOD = 8000 // 1 kHz at 8 MHz
const HIGH = 2000 // 25 %
const START = 8000 // first rising edge at 1 ms

/** PA5 → 330 Ω → red LED → GND; scope ch1 + logic probe D0 on the PA5 net. */
function ledWorld(): CircuitLayout {
  return bluePillWorld(
    [
      part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }),
      part('D1', 'led', ['b50', 'top-5'], { color: 'red' }),
      part('P1', 'scope_probe', ['c45'], { channel: 1 }),
      part('L1', 'logic_probe', ['d45'], { channel: 'D0' }),
    ],
    [w(tap('PA5'), 'e45')],
  )
}

function world(layout: CircuitLayout, setup: (f: FakeMcu) => void, hz = HZ) {
  const fakes: FakeMcu[] = []
  const co = new SimulationCoordinator({
    createMcu: () => {
      const f = new FakeMcu(hz)
      setup(f)
      fakes.push(f)
      return f
    },
  })
  co.load(layout, 1)
  return { co, fake: () => fakes[fakes.length - 1] }
}

function logic(co: SimulationCoordinator, t0: number, t1: number): LogicCapture {
  const r = co.query({ kind: 'logic', t0, t1 })
  if (r.kind !== 'logic') throw new Error('bad query')
  return r.capture
}

function scope(co: SimulationCoordinator, t0: number, t1: number): ScopeCapture {
  const r = co.query({ kind: 'scope', t0, t1 })
  if (r.kind !== 'scope') throw new Error('bad query')
  return r.capture
}

/** Expected PWM edges (cycle, level) with first rise at START, up to `lastCycle`. */
function pwmEdges(lastCycle: number): { cycle: number; level: 0 | 1 }[] {
  const out: { cycle: number; level: 0 | 1 }[] = []
  for (let c = START; c <= lastCycle; c += PERIOD) {
    out.push({ cycle: c, level: 1 })
    if (c + HIGH <= lastCycle) out.push({ cycle: c + HIGH, level: 0 })
  }
  return out
}

describe('exact-edge lockstep (fake MCU, 1 kHz 25 % PWM into an LED)', () => {
  const T_END = 0.0105

  it('records logic edges at the exact scripted cycle times', () => {
    const { co, fake } = world(ledWorld(), (f) => f.addProgram(new PwmProgram(PA5, PERIOD, HIGH, START)))
    co.setLogicChannels([
      { index: 0, label: 'probe', source: { kind: 'probe', componentId: 'L1' } },
      { index: 1, label: 'pin', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } },
    ])
    co.advance(T_END)
    const want = pwmEdges(Math.floor(T_END * HZ))
    const cap = logic(co, 0.0005, T_END)
    expect(cap.overflow).toBe(false)
    for (const tr of cap.traces) {
      expect(tr.exact, tr.label).toBe(true)
      expect(tr.initial).toBe(0)
      expect(Array.from(tr.levels)).toEqual(want.map((e) => e.level))
      // Object.is on every timestamp: the edge time IS timeOfCycle(cycle)
      expect(Array.from(tr.times)).toEqual(want.map((e) => fake().timeOfCycle(e.cycle)))
    }
    // the coordinator stopped the MCU at analog-coupled edges (an edge in the
    // last cycle of a run needs no stop: the run ends there anyway)
    expect(fake().syncStops).toBeGreaterThanOrEqual(want.length - 2)
  })

  it('ends an analog step exactly at each edge, then settles 0.5 µs later', () => {
    const { co, fake } = world(ledWorld(), (f) => f.addProgram(new PwmProgram(PA5, PERIOD, HIGH, START)))
    co.advance(T_END)
    const tr = scope(co, 0, T_END).traces.find((t) => t.index === 0)
    expect(tr).toBeDefined()
    const t = Array.from(tr!.t)
    const v = Array.from(tr!.v)
    for (const e of pwmEdges(Math.floor(T_END * HZ))) {
      const te = fake().timeOfCycle(e.cycle)
      const k = t.indexOf(te)
      expect(k, `sample at edge ${te}`).toBeGreaterThan(0)
      // at te the solution still reflects the PRE-edge drive; MIN_ANALOG_DT later the new one
      if (e.level === 1) {
        expect(v[k]).toBeLessThan(0.1)
        expect(v[k + 1]).toBeGreaterThan(2.9)
      } else {
        expect(v[k]).toBeGreaterThan(2.9)
        expect(v[k + 1]).toBeLessThan(0.1)
      }
      expect(t[k + 1] - te).toBeCloseTo(MIN_ANALOG_DT, 12)
    }
  })

  it('measures 25.0 % duty and 1.000 ms period on the analog net', () => {
    const { co } = world(ledWorld(), (f) => f.addProgram(new PwmProgram(PA5, PERIOD, HIGH, START)))
    co.advance(T_END)
    const tr = scope(co, 0, T_END).traces[0]
    // threshold at the middle of the solved VOL / VOH (the 50 Ω driver into
    // 330 Ω + LED gives VOH ≈ 3.1 V): symmetric crossings
    let lo = Infinity
    let hi = -Infinity
    for (const x of tr.v) {
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
    const thr = (lo + hi) / 2
    const rises: number[] = []
    const falls: number[] = []
    for (let i = 1; i < tr.t.length; i++) {
      const a = tr.v[i - 1]
      const b = tr.v[i]
      if ((a < thr) === (b < thr)) continue
      const tc = tr.t[i - 1] + ((thr - a) / (b - a)) * (tr.t[i] - tr.t[i - 1])
      ;(b > a ? rises : falls).push(tc)
    }
    expect(rises.length).toBe(10)
    expect(falls.length).toBe(10)
    const highs = falls.map((f, i) => f - rises[i])
    const periods = rises.slice(1).map((r, i) => r - rises[i])
    const duty = highs.reduce((s, x) => s + x, 0) / highs.length / 1e-3
    expect(duty * 100).toBeCloseTo(25.0, 4)
    for (const p of periods) expect(p).toBeCloseTo(1e-3, 12)
  })

  it('the LED current follows the drive (stage drive through the board rails)', () => {
    const { co } = world(ledWorld(), (f) => f.addProgram(new PwmProgram(PA5, PERIOD, HIGH, START)))
    co.advance(0.00110) // 0.1 ms into the first high phase
    const tele = co.telemetry()
    expect(tele.components.D1.ledBrightness).toBeGreaterThan(0.3)
    co.advance(0.0005) // low phase
    expect(co.telemetry().components.D1.ledBrightness).toBe(0)
  })
})

describe('duty-weighted averaging for very fast toggling', () => {
  it('2 MHz / 25 % PWM into an RC low-pass settles at 0.25 × VDD in ≥ 0.5 µs steps', () => {
    const hz = 72e6
    const layout = bluePillWorld(
      [
        part('R1', 'resistor', ['a45', 'a50'], { resistance: 1000 }),
        part('C1', 'capacitor', ['b50', 'top-5'], { capacitance: 1e-6 }),
      ],
      [w(tap('PA5'), 'e45')],
    )
    // 36 cycles = 0.5 µs period, 9 cycles high
    const { co, fake } = world(layout, (f) => f.addProgram(new PwmProgram(PA5, 36, 9, 7200)), hz)
    const steps0 = co.stepCount
    const T = 0.012
    co.advance(T)
    const steps = co.stepCount - steps0
    const engine = co.engine!
    const vdd = engine.netVoltage(tap('3V3_1'))
    const vx = engine.netVoltage('c50')
    // RC = (1000 + 50) Ω × 1 µF ≈ 1.05 ms; 11.9 ms of PWM ≫ 5 τ
    expect(vx / vdd).toBeCloseTo(0.25, 2)
    // never finer than MIN_ANALOG_DT, although edges come every 0.125 µs
    expect(steps).toBeLessThanOrEqual(Math.ceil(T / MIN_ANALOG_DT) + 10)
    // ~95k edges, yet the MCU stopped at most once per analog step
    expect(fake().syncStops).toBeLessThanOrEqual(steps)
  })
})

describe('determinism', () => {
  /**
   * Feedback world: PA5 PWM → 10 kΩ → PA0 net with 10 nF (RC = 100 µs);
   * the fake "firmware" echoes PA0's Schmitt level onto PA9 ten cycles after
   * each input change; PA9's net is logic-resolvable (exact edges).
   */
  function feedbackWorld(): CircuitLayout {
    return bluePillWorld(
      [
        part('R1', 'resistor', ['a45', 'a50'], { resistance: 10_000 }),
        part('C1', 'capacitor', ['b50', 'top-5'], { capacitance: 10e-9 }),
        part('P1', 'scope_probe', ['c50'], { channel: 1 }),
        part('L1', 'logic_probe', [tap('PA9')], { channel: 'D0' }),
      ],
      [w(tap('PA5'), 'e45'), w(tap('PA0'), 'd50')],
    )
  }

  function run(chunks: (i: number) => number, total: number) {
    const { co, fake } = world(feedbackWorld(), (f) => {
      f.addProgram(new PwmProgram(PA5, 1600, 800, 800)) // 5 kHz, 50 %
      f.echoes.push({ from: PA0, to: PA9, delay: 10 })
    })
    let i = 0
    while (co.time < total - 1e-12) co.advance(Math.min(chunks(i++), total - co.time))
    return { co, fake: fake() }
  }

  function signature(co: SimulationCoordinator, t1: number) {
    const lc = logic(co, 0, t1).traces[0]
    const sc = scope(co, 0, t1).traces[0]
    return { times: Array.from(lc.times), levels: Array.from(lc.levels), st: Array.from(sc.t), sv: Array.from(sc.v) }
  }

  it('produces identical edges and samples across runs and advance() chunkings', () => {
    const T = 0.004
    const a = run(() => T, T)
    const b = run(() => T, T)
    const c = run(() => 1e-4, T)
    const sizes = [3.7e-5, 1.13e-4, 2e-6, 9.9e-4, 5e-7, 2.71e-4]
    const d = run((i) => sizes[i % sizes.length], T)
    const W = 0.0039 // compare a window every run has fully simulated
    const sa = signature(a.co, W)
    expect(sa.times.length).toBeGreaterThan(20) // the feedback path really toggles PA9
    for (const other of [b, c, d]) {
      const so = signature(other.co, W)
      expect(so.times).toEqual(sa.times)
      expect(so.levels).toEqual(sa.levels)
      expect(so.st).toEqual(sa.st)
      expect(so.sv).toEqual(sa.sv)
    }
    // every echoed edge sits exactly 10 cycles after an input change the MCU saw
    const f = a.fake
    for (const t of sa.times) {
      const cyc = Math.round(t * HZ)
      expect(f.timeOfCycle(cyc)).toBe(t)
      expect(f.pins.inputs.some((e) => e.pin === PA0 && e.cycle === cyc - 10)).toBe(true)
    }
  })
})
