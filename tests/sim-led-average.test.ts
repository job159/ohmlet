/**
 * Eye-averaged LED telemetry (pwm-fade, glow NP3): an LED's published
 * current / power / light — and each RGB LED die's (values iR·iG·iB, leds,
 * rgb, light) — are the MEAN over the last LED_EYE_S (20 ms) of simulated
 * time of the current the solver's own KCL says the junction carried, from
 * converged steps only. A 1 kHz PWM LED therefore fades smoothly at any frame
 * rate and simulation speed instead of strobing between on and off samples;
 * a reader that looks now and then still sees what the LED does now; a
 * steady LED reads exactly what it did; the LED's current agrees with the
 * supply and with the flow layer's pinCurrents; values.iPeak marks an
 * average of a switching current (平均); ledBrightness (the classic chrome's
 * I / 10 mA scale) stays the instant value; an RGB LED names its burned dies.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DT, SimEngine } from '../src/sim/engine'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { LED_EYE_S, LedWindow } from '../src/sim/devices'
import { burnedRgbDies } from '../src/ui/embedded/DamageBanner'
import type { CircuitLayout, ComponentInstance, Wire } from '../src/model/types'
import { PIN_OUT_PP } from '../src/mcu/pins'
import { FakeMcu, PwmProgram } from './coordinator/fake-mcu'
import { bluePillWorld, part, PA5, tap, w } from './coordinator/worlds'
import { funcGen, layout, twoLead } from './helpers'

const W = (id: string, from: string, to: string): Wire => ({ id, from, to })

function bench(parts: ComponentInstance[], wires: Wire[] = [], volts = 5): CircuitLayout {
  return layout(
    [{ id: 'PS1', type: 'power_supply', params: { voltage: volts } }, ...parts],
    [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), ...wires],
  )
}
/** 330 Ω + red LED on the bench supply (lesson 初級 1). */
const b1 = () =>
  bench(
    [twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 330 }), twoLead('D1', 'led', 'b10', 'b14', { color: 'red' })],
    [W('wk', 'c14', 'top-2')],
  )
/** A square-wave generator (0 ↔ 5 V, or a constant `dc` V when given) driving 330 Ω + a red LED. */
function squareLed(hz: number, dc?: number): CircuitLayout {
  return layout(
    [
      dc === undefined
        ? funcGen('FG1', { waveform: 'square', frequency: hz, amplitude: 2.5, offset: 2.5 })
        : funcGen('FG1', { waveform: 'square', frequency: 0, amplitude: 0, offset: dc }),
      twoLead('R1', 'resistor', 'a10', 'a14', { resistance: 330 }),
      twoLead('D1', 'led', 'b14', 'top-2', { color: 'red' }),
    ],
    [W('wo', 'FG1:out', 'e10'), W('wg', 'FG1:gnd', 'top-0')],
  )
}
type Tele = ReturnType<SimEngine['telemetry']>
/** Telemetry every `every` s, `n` times (one read per frame). */
function reads(e: { advance(s: number, dt?: number): void; telemetry(): Tele }, every: number, n: number): Tele[] {
  const out: Tele[] = []
  for (let k = 0; k < n; k++) {
    e.advance(every)
    out.push(e.telemetry())
  }
  return out
}
/** strict Newton (as the coordinator runs in lockstep): the step after an edge is solved, not left step-limited */
function strict(l: CircuitLayout): SimEngine {
  const e = new SimEngine(l)
  e.strictConvergence = true
  return e
}

describe('a steady LED reads what it always did', () => {
  it('330 Ω on 5 V: 9.70 mA, light 0.485 — the same current the supply delivers', () => {
    const e = new SimEngine(b1())
    e.advance(0.2)
    const t = e.telemetry()
    const d = t.components.D1
    expect(d.light).toBe(0.485)
    expect(Math.abs((d.current ?? 0) - 0.0097014)).toBeLessThan(2e-7)
    // one series loop: the LED's eye-mean current is the supply's (instant, steady) current
    expect(Math.abs((d.current ?? 0) - (t.components.PS1.current ?? 0))).toBeLessThan(1e-8)
    expect(d.ledBrightness).toBeCloseTo(0.97, 2) // the classic I / 10 mA scale, clamped
    expect(d.values?.iPeak).toBeUndefined() // a steady current is no average of a switching one
  })

  it('right after power-on too: the step-limited first step never enters the mean (no 10¹⁸ A, no dip)', () => {
    const e = new SimEngine(b1())
    e.step()
    const first = e.telemetry().components.D1
    expect(Number.isFinite(first.current)).toBe(true)
    expect(Math.abs(first.current ?? 1)).toBeLessThan(0.0098)
    e.advance(0.002) // 2 ms in: only converged steps, all at the steady current
    expect(e.telemetry().components.D1.light).toBe(0.485)
  })

  it('telemetry() is a pure read: twice without a step gives the same values', () => {
    const e = new SimEngine(squareLed(1000))
    e.advance(0.0137)
    const a = e.telemetry().components.D1
    const b = e.telemetry().components.D1
    expect(b.current).toBe(a.current)
    expect(b.light).toBe(a.light)
    expect(b.power).toBe(a.power)
  })
})

describe('a PWM LED is averaged like the eye (and an ammeter) sees it', () => {
  function fullLight(): number {
    const e = strict(squareLed(0, 5))
    e.advance(0.05)
    return e.telemetry().components.D1.light ?? 0
  }

  it('1 kHz, 50 %: every frame (16 ms) shows ≈ half the held-on brightness — smooth, no strobing', () => {
    const full = fullLight()
    expect(full).toBeGreaterThan(0.3)
    const e = strict(squareLed(1000))
    e.advance(0.05)
    const ws = reads(e, 0.016, 12).map((t) => t.components.D1)
    for (const d of ws) {
      expect((d.light ?? 0) / full).toBeGreaterThan(0.47)
      expect((d.light ?? 0) / full).toBeLessThan(0.53)
      // the shown current is an average of a switching current: values.iPeak (平均) = the on-current
      expect(d.values?.iPeak).toBeDefined()
      expect((d.values?.iPeak ?? 0) / (full * 0.02)).toBeGreaterThan(0.95)
    }
    const lights = ws.map((d) => d.light ?? 0)
    expect(Math.max(...lights) - Math.min(...lights)).toBeLessThan(0.03 * full)
  })

  it('at ANY read cadence — every 50 µs step of a slow simulation, too — the brightness glides (one instant would be on or off)', () => {
    const full = fullLight()
    const e = strict(squareLed(1000))
    e.advance(0.05)
    const lights = reads(e, DEFAULT_DT, 60).map((t) => t.components.D1.light ?? 0)
    for (const l of lights) {
      expect(l / full).toBeGreaterThan(0.46)
      expect(l / full).toBeLessThan(0.54)
    }
    // the instant current itself strobes: the classic ledBrightness (instant I / 10 mA) shows it
    const instant = reads(e, DEFAULT_DT, 40).map((t) => t.components.D1.ledBrightness ?? 0)
    expect(Math.min(...instant)).toBeLessThan(0.01)
    expect(Math.max(...instant)).toBeGreaterThan(0.6)
  })

  it('a slow blinker (1 Hz) is no average: on reads on, off reads off — also when read only now and then', () => {
    const e = new SimEngine(squareLed(1))
    e.advance(0.3)
    const on = e.telemetry().components.D1
    expect(on.light).toBeGreaterThan(0.3)
    e.advance(0.3) // off since 0.5 s: a sparse reader sees it off, not a blend of the last 0.3 s
    const off = e.telemetry().components.D1
    expect(off.light).toBe(0)
    const ws = reads(e, 0.016, 40).map((t) => t.components.D1) // 0.6 → 1.24 s: an on edge inside
    expect(ws.every((d) => d.values?.iPeak === undefined)).toBe(true)
    expect(ws.some((d) => (d.light ?? 0) > 0.3)).toBe(true)
  })

  it('MCU PWM (25 %, 1 kHz on PA5): the LED’s mA matches the flow layer’s mA and is a quarter of the held-on current', () => {
    const l = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA5'), 'e45')],
    )
    const co = new SimulationCoordinator({
      createMcu: () => {
        const f = new FakeMcu()
        f.addProgram(new PwmProgram(PA5, 8_000, 2_000, 0))
        return f
      },
    })
    co.setCurrentTracking(true)
    co.load(l, 1)
    co.advance(0.004)
    co.telemetry()
    for (let k = 0; k < 5; k++) {
      co.advance(LED_EYE_S)
      const d = co.telemetry().components.D1
      const flow = d.pinCurrents?.anode ?? NaN
      expect(Math.abs((d.current ?? 0) - flow)).toBeLessThan(0.03 * flow)
      expect(d.values?.iPeak).toBeDefined()
    }
    const steady = new SimulationCoordinator({
      createMcu: () => {
        const f = new FakeMcu()
        f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }
        return f
      },
    })
    steady.load(l, 1)
    steady.advance(0.03)
    const full = steady.telemetry().components.D1.current ?? 0
    co.advance(0.016)
    const avg = co.telemetry().components.D1.current ?? 0
    expect(avg / full).toBeGreaterThan(0.23)
    expect(avg / full).toBeLessThan(0.27)
  })

  it('a burned LED shows what a burned-open LED does from the burn on (no left-over surge)', () => {
    const e = new SimEngine(bench([twoLead('D1', 'led', 'top+1', 'top-1', { color: 'red' })]))
    e.advance(0.0015) // the surge (≈ 267 A) burns it within 1 ms; read in the same eye window
    const d = e.telemetry().components.D1
    expect(d.burned).toBe(true)
    expect(d.light).toBe(0)
    expect(Math.abs(d.current ?? 1)).toBeLessThan(1e-6)
  })
})

describe('LedWindow', () => {
  const B = LED_EYE_S / 20

  it('is the mean over the last LED_EYE_S of converged steps; a pure read', () => {
    const win = new LedWindow()
    expect(win.read().i).toBe(0)
    let t = 0
    const step = (i: number, dt = 1e-4, limited = false) => {
      t += dt
      win.add(i, 2, dt, t, limited)
    }
    for (let k = 0; k < 100; k++) step(0.01) // 10 ms at 10 mA
    expect(win.read().i).toBeCloseTo(0.01, 12)
    expect(win.read().p).toBeCloseTo(0.02, 12)
    step(1e9, 1e-4, true) // a step-limited step: skipped
    expect(win.read().i).toBeCloseTo(0.01, 12)
    for (let k = 0; k < 100; k++) step(0) // 10 ms off: half the window
    expect(win.read().i).toBeCloseTo(0.005, 3)
    for (let k = 0; k < 300; k++) step(0) // 30 ms more off: the on-phase left the window
    expect(win.read().i).toBe(0)
    expect(win.read().i).toBe(0)
    expect(B).toBeCloseTo(0.001, 12)
  })

  it('switching: a whole period inside the window marks the mean as an average; clear() forgets', () => {
    const win = new LedWindow()
    let t = 0
    for (let k = 0; k < 40; k++) {
      t += 5e-4
      win.add(k % 2 === 0 ? 0.01 : 0, 2, 5e-4, t)
    }
    const r = win.read()
    expect(r.switching).toBe(true)
    expect(r.peak).toBe(0.01)
    expect(r.i).toBeCloseTo(0.005, 3)
    win.clear()
    expect(win.read().i).toBe(0)
    // a single turn-on is no switching
    for (let k = 0; k < 10; k++) {
      t += 1e-3
      win.add(k < 3 ? 0 : 0.01, 2, 1e-3, t)
    }
    expect(win.read().switching).toBe(false)
  })
})

describe('RGB LED dies', () => {
  /** Common-cathode RGB LED: R through 330 Ω from a 1 kHz square, G through 330 Ω from 5 V, B straight on PS2 (`bVolts`). */
  function rgb(bVolts: number): CircuitLayout {
    return layout(
      [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'PS2', type: 'power_supply', params: { voltage: bVolts } },
        funcGen('FG1', { waveform: 'square', frequency: 1000, amplitude: 2.5, offset: 2.5 }),
        twoLead('R1', 'resistor', 'a10', 'a20', { resistance: 330 }),
        twoLead('R2', 'resistor', 'top+1', 'a24', { resistance: 330 }),
        { id: 'D1', type: 'rgb_led', holes: ['e20', 'e22', 'e24', 'e26'] },
      ],
      [
        W('wp', 'PS1:+', 'top+0'),
        W('wn', 'PS1:-', 'top-0'),
        W('wo', 'FG1:out', 'e10'),
        W('wg', 'FG1:gnd', 'top-1'),
        W('wc', 'a22', 'top-2'),
        W('wb', 'PS2:+', 'a26'),
        W('wb2', 'PS2:-', 'top-3'),
      ],
    )
  }

  it('a PWM die is averaged like a single LED (leds / rgb / iR agree, no strobing); the steady die is not marked', () => {
    const e = strict(rgb(0))
    e.advance(0.05)
    const ws = reads(e, 0.016, 6).map((t) => t.components.D1)
    for (const d of ws) {
      const iR = d.values?.iR ?? 0
      const iG = d.values?.iG ?? 0
      expect(iR).toBeGreaterThan(0.002) // ≈ half of its ≈ 8 mA on-current, every frame
      expect(Math.abs(iR - ws[0].values!.iR)).toBeLessThan(0.03 * ws[0].values!.iR)
      expect(iG).toBeGreaterThan(iR) // G is steady at its full current: the brightest die
      expect(d.light).toBeCloseTo(iG / 0.02, 2)
      expect(d.leds?.R).toBeCloseTo(iR / 0.01, 6)
      expect(((d.rgb?.[0] ?? 0) >> 16) & 0xff).toBe(Math.round(Math.min(1, iR / 0.01) * 255))
      expect(d.values?.iPeak).toBeUndefined() // the brightness shown (G's) is steady
      expect(d.values?.burnedR).toBeUndefined()
    }
  })

  it('a burned die is flagged (values.burnedB = 1) and the inspector names it even with no current through it', () => {
    const e = new SimEngine(rgb(5)) // B straight across 5 V: far above 150 mA → burns within 1 ms
    e.advance(0.01)
    let d = e.telemetry().components.D1
    expect(d.burned).toBe(true)
    expect(d.values?.burnedB).toBe(1)
    expect(d.values?.burnedR).toBeUndefined()
    expect(d.values?.burnedG).toBeUndefined()
    // switch everything off: the burned die now carries nothing, the model still says it burned
    e.setRuntimeParam('PS2', 'voltage', 0)
    e.setRuntimeParam('PS1', 'voltage', 0)
    e.setRuntimeParam('FG1', 'amplitude', 0)
    e.setRuntimeParam('FG1', 'offset', 0)
    e.advance(0.05)
    d = e.telemetry().components.D1
    expect(Math.abs(d.values?.iB ?? 1)).toBeLessThan(1e-6)
    expect(d.values?.burnedB).toBe(1)
    expect(burnedRgbDies(d)).toEqual(['B'])
  })
})
