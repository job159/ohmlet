/**
 * The LED's 平均 / 峰值 marker (values.iPeak) is stable for a steady blink
 * (review 4, SIM-2, and the verifier's regression np-1).
 *
 * LedWindow called a mean "an average of a switching current" when the
 * 20 ms eye window held two on/off crossings. A blink whose half period is
 * just under one window (25–50 Hz) puts one or two crossings in it depending
 * on its phase, so the marker — and with it the inspector's 「平均 … mA」 /
 * 「峰值」 rows and the 3D label — flipped frame after frame. An isolated
 * short pulse (on or off for less than 20 ms, period above 40 ms: a sine or
 * triangle that lights the LED only near its peaks, a 10 ms flash every
 * 60 ms) put two crossings in the window once per period and flipped the
 * label once per blink — and a first hold-only fix latched 平均 for ≈ 41 ms
 * after each such pulse, flipping it MORE.
 *
 * The verdict is now a property of the blink: it latches when a crossing
 * leaves two in the eye window AND closes a whole on/off cycle of at most two
 * windows (the switching repeats, 25 Hz or faster), and holds while every
 * cycle still fits two windows (+ 2 buckets of measuring slack). A 1 Hz
 * blinker or an isolated pulse never gets it, a PWM LED always does; the mean
 * itself is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../src/sim/engine'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { LED_EYE_S, LedWindow } from '../src/sim/devices'
import type { CircuitLayout, ComponentTelemetry } from '../src/model/types'
import { FakeMcu, PwmProgram } from './coordinator/fake-mcu'
import { bluePillWorld, part, PA5, tap, w } from './coordinator/worlds'
import { funcGen, layout, twoLead } from './helpers'

const W = (id: string, from: string, to: string) => ({ id, from, to })

/** The reviewer's repro: a function generator (`params`) into 330 Ω and a red LED. */
function fgLed(params: Record<string, string | number>): CircuitLayout {
  return layout(
    [funcGen('FG1', params), twoLead('R1', 'resistor', 'a10', 'a14', { resistance: 330 }), twoLead('D1', 'led', 'b14', 'top-2', { color: 'red' })],
    [W('wo', 'FG1:out', 'e10'), W('wg', 'FG1:gnd', 'top-0')],
  )
}
/** A 0 ↔ 5 V square wave of `hz` (50 % duty). */
const squareLed = (hz: number) => fgLed({ waveform: 'square', frequency: hz, amplitude: 2.5, offset: 2.5 })

type Reader = { advance(s: number): void; telemetry(): { components: Record<string, ComponentTelemetry> } }

/** `n` telemetry frames of `frame` s after `settle` s: in how many is the marker shown, how often does it flip? */
function watch(e: Reader, settle = 0.2, frame = 1 / 60, n = 120): { shown: number; toggles: number; means: number[] } {
  e.advance(settle)
  let shown = 0
  let toggles = 0
  let prev: boolean | null = null
  const means: number[] = []
  for (let k = 0; k < n; k++) {
    e.advance(frame)
    const d = e.telemetry().components.D1
    const has = typeof d.values?.iPeak === 'number'
    if (has) shown++
    if (prev !== null && prev !== has) toggles++
    prev = has
    means.push(d.current ?? NaN)
  }
  return { shown, toggles, means }
}
/** 120 frames at 60 fps after 0.2 s of a 50 % square of `hz`. */
const frames = (hz: number) => watch(new SimEngine(squareLed(hz)))

describe('values.iPeak (平均) for a steady blink: one label, frame after frame', () => {
  it('25.5–100 Hz (half period under one eye window): shown in every frame, never flipping', () => {
    for (const hz of [25.5, 26, 27, 30, 33, 40, 45, 50, 60, 100]) {
      const f = frames(hz)
      expect(f.toggles, `${hz} Hz flips`).toBe(0)
      expect(f.shown, `${hz} Hz frames with 平均`).toBe(120)
    }
  })

  it('1–24 Hz and exactly 25 Hz (half period ≥ one window): a plain reading in every frame', () => {
    for (const hz of [1, 10, 20, 24, 25]) {
      const f = frames(hz)
      expect(f.toggles, `${hz} Hz flips`).toBe(0)
      expect(f.shown, `${hz} Hz frames with 平均`).toBe(0)
    }
  })

  it('a 1 kHz PWM LED is always an average', () => {
    const f = frames(1000)
    expect(f.shown).toBe(120)
  })
})

describe('values.iPeak (平均) for an isolated short pulse: never, at any read rate (np-1)', () => {
  // offset 0: the LED conducts only near the waveform's peaks — a short flash once per period
  const sine = (hz: number) => fgLed({ waveform: 'sine', frequency: hz, amplitude: 2.5, offset: 0 })
  const triangle = (hz: number) => fgLed({ waveform: 'triangle', frequency: hz, amplitude: 3, offset: 0 })

  it('a sine / triangle lighting the LED only near its peaks at 12–24 Hz reads plain in every frame', () => {
    for (const hz of [12, 15, 18, 20, 22, 24]) {
      for (const [name, l] of [
        ['sine', sine(hz)],
        ['triangle', triangle(hz)],
      ] as const) {
        const f = watch(new SimEngine(l))
        expect(f.toggles, `${name} ${hz} Hz flips`).toBe(0)
        expect(f.shown, `${name} ${hz} Hz frames with 平均`).toBe(0)
        expect(Math.max(...f.means), `${name} ${hz} Hz lights`).toBeGreaterThan(1e-4)
      }
    }
  })

  it('the same at 144 and 47 frames per second', () => {
    for (const frame of [1 / 144, 1 / 47]) {
      for (const l of [sine(15), triangle(12), sine(20)]) {
        const f = watch(new SimEngine(l), 0.2, frame, Math.round(1.5 / frame))
        expect(f.toggles).toBe(0)
        expect(f.shown).toBe(0)
      }
    }
  })

  it('the same flash repeating 30–60 times a second is an average in every frame', () => {
    for (const hz of [30, 40, 60]) {
      for (const [name, l] of [
        ['sine', sine(hz)],
        ['triangle', triangle(hz)],
      ] as const) {
        const f = watch(new SimEngine(l))
        expect(f.toggles, `${name} ${hz} Hz flips`).toBe(0)
        expect(f.shown, `${name} ${hz} Hz frames with 平均`).toBe(120)
      }
    }
  })

  /** Firmware blinking PA5 into 330 Ω + a red LED: on for `onMs` every `periodMs` (FakeMcu at 8 MHz). */
  function firmwareBlink(periodMs: number, onMs: number): SimulationCoordinator {
    const l = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA5'), 'e45')],
    )
    const co = new SimulationCoordinator({
      createMcu: () => {
        const f = new FakeMcu()
        f.addProgram(new PwmProgram(PA5, periodMs * 8_000, onMs * 8_000, 0))
        return f
      },
    })
    co.load(l, 1)
    return co
  }

  it('firmware: a 10 ms flash every 60 ms reads plain in every frame; a 3 ms flash every 33 ms is an average in every frame', () => {
    const slow = watch(firmwareBlink(60, 10))
    expect(slow.toggles).toBe(0)
    expect(slow.shown).toBe(0)
    expect(Math.max(...slow.means)).toBeGreaterThan(1e-3) // it does light up
    const fast = watch(firmwareBlink(33, 3))
    expect(fast.toggles).toBe(0)
    expect(fast.shown).toBe(120)
  })
})

describe('LedWindow switching hysteresis (ideal square currents)', () => {
  /**
   * Feed an ideal 9 mA / 1 nA pulse train of `hz` (on for `duty` of each period) at `dt` steps;
   * read every `frame` s from 0.2 s on.
   */
  function sweep(hz: number, seconds = 1.2, phase = 0, duty = 0.5, frame = 1 / 60, dt = 1e-5): { on: number; reads: number; toggles: number } {
    const win = new LedWindow()
    let t = 0
    let next = 0.2
    let on = 0
    let reads = 0
    let toggles = 0
    let prev: boolean | null = null
    while (t < seconds) {
      t += dt
      const p = (t * hz + phase) % 1
      win.add(p < duty ? 9e-3 : 1e-9, 1.9, dt, t)
      if (t >= next) {
        next += frame
        const s = win.read().switching
        reads++
        if (s) on++
        if (prev !== null && prev !== s) toggles++
        prev = s
      }
    }
    return { on, reads, toggles }
  }

  it('any duty: a pulse train slower than ≈ 23 Hz is never an average, one from 26 Hz up always is — no flips', () => {
    for (const duty of [0.05, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 0.95]) {
      for (const [frame, dt] of [
        [1 / 60, 5e-5],
        [1 / 144, 1e-5],
      ] as const) {
        for (const phase of [0, 0.21, 0.58]) {
          for (const hz of [2, 8, 12, 15, 17.5, 20, 22.5]) {
            const r = sweep(hz, 1.6, phase, duty, frame, dt)
            const at = `duty ${duty} ${hz} Hz phase ${phase} frame ${frame.toFixed(4)}`
            expect(r.toggles, at).toBe(0)
            expect(r.on, at).toBe(0)
          }
          for (const hz of [26, 30, 35, 45, 60, 100, 400]) {
            const r = sweep(hz, 1.6, phase, duty, frame, dt)
            const at = `duty ${duty} ${hz} Hz phase ${phase} frame ${frame.toFixed(4)}`
            expect(r.toggles, at).toBe(0)
            expect(r.on, at).toBe(r.reads)
          }
        }
      }
    }
  })

  it('a burst of fast flashes is an average while it lasts and clears after it', () => {
    const win = new LedWindow()
    const dt = 1e-5
    let t = 0
    const run = (seconds: number, f: (t: number) => number) => {
      const end = t + seconds
      while (t < end - 1e-12) {
        t += dt
        win.add(f(t), 1.9, dt, t)
      }
    }
    run(0.3, () => 1e-9)
    const start = t
    run(0.04, (x) => (((x - start) * 1000) / 5) % 2 < 1 ? 9e-3 : 1e-9) // 5 ms on / 5 ms off for 40 ms
    expect(win.read().switching).toBe(true)
    run(0.06, () => 1e-9)
    expect(win.read().switching).toBe(false)
  })

  it('from 25.2 Hz up the verdict never flips, at any phase', () => {
    for (let hz = 25.2; hz <= 60; hz += 0.4) {
      for (const phase of [0, 0.13, 0.37, 0.71]) {
        const r = sweep(hz, 1.2, phase)
        expect(r.toggles, `${hz.toFixed(1)} Hz phase ${phase}`).toBe(0)
        expect(r.on, `${hz.toFixed(1)} Hz phase ${phase}`).toBe(r.reads)
      }
    }
  })

  it('a half period longer than the eye window is never called switching', () => {
    for (const hz of [1, 5, 12.5, 20, 24.6]) {
      const r = sweep(hz)
      expect(r.on, `${hz} Hz`).toBe(0)
    }
  })

  it('when the switching stops it clears about two windows later; the mean is the plain window mean throughout', () => {
    const win = new LedWindow()
    const dt = 1e-5
    let t = 0
    const run = (seconds: number, f: (t: number) => number) => {
      const end = t + seconds
      while (t < end - 1e-12) {
        t += dt
        win.add(f(t), 1.9, dt, t)
      }
    }
    run(0.05, (x) => ((x * 1000) % 1 < 0.5 ? 9e-3 : 0)) // 1 kHz PWM
    expect(win.read().switching).toBe(true)
    run(0.01, () => 9e-3) // held on
    expect(win.read().switching).toBe(true) // the hold: the last window still averaged switching
    run(2 * LED_EYE_S + 0.002, () => 9e-3)
    const r = win.read()
    expect(r.switching).toBe(false)
    expect(r.i).toBeCloseTo(9e-3, 12) // the mean: exactly the steady current
  })
})
