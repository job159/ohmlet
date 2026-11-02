/**
 * vivid: honest damage models and the telemetry the 3D realism reads
 * (src/sim/devices.ts, src/sim/models/basic.model.ts):
 *  - LED `light` = I / rated 20 mA (220 Ω ≫ 1 kΩ ≫ 10 kΩ, 0 when dark /
 *    burned), `damage` 'burned' with the burn time;
 *  - resistor self-heating against its ¼ W rating: `heat`, 'overheating'
 *    while hot (IEC 60115-1 short-time overload survives), burned OPEN after
 *    a sustained gross overload (latched — the current stops), one error issue;
 *  - electrolytic capacitor reversed beyond 1 V vents (latched), a forward /
 *    non-polarized one never does;
 *  - RGB LED dies publish `light` too.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../src/sim/engine'
import {
  CAP_REVERSE_OK,
  CAP_VENT_VS,
  LED_RATED_CURRENT,
  RES_BURN_HEAT,
  RES_THERMAL_TAU,
  fmtWatts,
  roundLight,
} from '../src/sim/devices'
import '../src/sim/models'
import { RailTap, poweredLayout, runFor, twoLead, leads, wire } from './helpers'

function ledWith(resistance: number | null) {
  const rt = new RailTap()
  const parts =
    resistance === null
      ? [twoLead('D1', 'led', rt.plus(), rt.minus(), { color: 'red' })]
      : [
          twoLead('R1', 'resistor', rt.plus(), 'a15', { resistance }),
          twoLead('D1', 'led', 'b15', rt.minus(), { color: 'red' }),
        ]
  return new SimEngine(poweredLayout(parts, []))
}

describe('vivid: LED light telemetry', () => {
  it('light = I / 20 mA: 220 Ω bright, 1 kΩ clearly dimmer, 10 kΩ faint', () => {
    const lights: number[] = []
    for (const r of [220, 1000, 10000]) {
      const e = ledWith(r)
      runFor(e, 0.005)
      const t = e.telemetry().components['D1']
      expect(t.light).toBeDefined()
      // the published value is the real current over the rating (rounded to 0.001)
      expect(t.light).toBeCloseTo(roundLight((t.current ?? 0) / LED_RATED_CURRENT), 6)
      expect(t.damage).toBeUndefined()
      lights.push(t.light ?? NaN)
    }
    const [l220, l1k, l10k] = lights
    expect(l220).toBeGreaterThan(0.6) // ≈ 14 mA
    expect(l220).toBeLessThan(0.8)
    expect(l1k).toBeGreaterThan(0.13) // ≈ 3.2 mA
    expect(l1k).toBeLessThan(0.18)
    expect(l10k).toBeGreaterThan(0.01) // ≈ 0.32 mA
    expect(l10k).toBeLessThan(0.02)
  }, 20000)

  it('an unpowered LED is dark (light 0)', () => {
    const e = ledWith(220)
    e.setRuntimeParam('PS1', 'voltage', 0)
    runFor(e, 0.002)
    expect(e.telemetry().components['D1'].light).toBe(0)
  })

  it('no series resistor: burned, light 0, damage carries the burn time', () => {
    const e = ledWith(null)
    runFor(e, 0.01)
    const t = e.telemetry().components['D1']
    expect(t.burned).toBe(true)
    expect(t.light).toBe(0)
    expect(t.damage?.kind).toBe('burned')
    expect(t.damage?.since).toBeGreaterThan(0.001)
    expect(t.damage?.since).toBeLessThan(0.003)
  })

  it('roundLight keeps 0.001 steps and maps non-positive / NaN to 0', () => {
    expect(roundLight(0.12345)).toBe(0.123)
    expect(roundLight(-0.2)).toBe(0)
    expect(roundLight(Number.NaN)).toBe(0)
    expect(roundLight(1.5)).toBe(1.5)
  })
})

describe('vivid: resistor self-heating and burn-open', () => {
  function resistorAcross(resistance: number) {
    const rt = new RailTap()
    return new SimEngine(poweredLayout([twoLead('R1', 'resistor', rt.plus(), rt.minus(), { resistance })], []))
  }

  it('within its rating: no heat field, no damage', () => {
    const e = resistorAcross(1000) // 25 mW in a ¼ W part
    runFor(e, 2, 1e-3)
    const t = e.telemetry().components['R1']
    expect(t.heat).toBeUndefined()
    expect(t.damage).toBeUndefined()
  })

  it('IEC 60115-1 short-time overload (6.25× for 5 s) leaves it intact', () => {
    const e = resistorAcross(16) // 5 V / 16 Ω = 1.56 W = 6.25 × ¼ W
    runFor(e, 5, 1e-3)
    const t = e.telemetry().components['R1']
    expect(t.damage?.kind).toBe('overheating') // hot …
    expect(Math.abs(t.current ?? 0)).toBeGreaterThan(0.3) // … but still a resistor
  }, 20000)

  it('a 2× overload overheats (smokes) but never burns open: the current keeps flowing', () => {
    const e = resistorAcross(47) // 532 mW in a ¼ W part
    runFor(e, 3, 1e-3)
    const early = e.telemetry().components['R1']
    expect(early.heat ?? 0).toBeGreaterThan(0.5) // 2.13·(1 − e^−0.3) ≈ 0.55
    expect(early.heat ?? 0).toBeLessThan(1)
    expect(early.damage).toBeUndefined()
    runFor(e, 17, 1e-3)
    const t = e.telemetry().components['R1']
    expect(t.heat ?? 0).toBeGreaterThan(1.7)
    expect(t.heat ?? 0).toBeLessThan(RES_BURN_HEAT)
    expect(t.damage?.kind).toBe('overheating')
    expect(Math.abs(t.current ?? 0)).toBeGreaterThan(0.1) // 5 V / 47 Ω ≈ 106 mA
    expect(e.issues.some((i) => /burned open/.test(i.message))).toBe(false)
  }, 30000)

  it('a gross overload (10 Ω on 12 V = 14.4 W, 58×) burns it open in ≈ 1.9 s — latched, current stops', () => {
    const e = resistorAcross(10)
    e.setRuntimeParam('PS1', 'voltage', 12)
    runFor(e, 1.0, 1e-3)
    expect(e.telemetry().components['R1'].damage?.kind).toBe('overheating')
    expect(e.telemetry().components['R1'].heat ?? 0).toBeGreaterThan(2) // glowing
    expect(Math.abs(e.telemetry().components['R1'].current ?? 0)).toBeGreaterThan(1)
    runFor(e, 1.5, 1e-3)
    const t = e.telemetry().components['R1']
    expect(t.damage?.kind).toBe('burned')
    // heat ratio 57.6 reaches RES_BURN_HEAT at −τ·ln(1 − 10 / 57.6)
    const ratio = (12 * 12) / 10 / 0.25
    const expected = -RES_THERMAL_TAU * Math.log(1 - RES_BURN_HEAT / ratio)
    expect(t.damage?.since).toBeGreaterThan(expected - 0.1)
    expect(t.damage?.since).toBeLessThan(expected + 0.1)
    expect(Math.abs(t.current ?? 1)).toBeLessThan(1e-6)
    const issue = e.issues.find((i) => /^R1 burned open/.test(i.message))
    expect(issue?.level).toBe('error')
    expect(issue?.componentId).toBe('R1')
    expect(issue?.message).toBe('R1 burned open (14.4 W in a 250 mW resistor) — use a larger resistance or a higher-wattage resistor')
    // latched: a power cycle does not heal it
    e.setRuntimeParam('PS1', 'voltage', 0)
    runFor(e, 0.2, 1e-3)
    e.setRuntimeParam('PS1', 'voltage', 12)
    runFor(e, 0.2, 1e-3)
    expect(e.telemetry().components['R1'].damage?.kind).toBe('burned')
    expect(Math.abs(e.telemetry().components['R1'].current ?? 1)).toBeLessThan(1e-6)
    // a fresh model (reset / rebuild) is intact again
    const fresh = resistorAcross(10)
    runFor(fresh, 0.1, 1e-3)
    expect(fresh.telemetry().components['R1'].damage).toBeUndefined()
  }, 20000)

  it('an LED fed through a burned-open resistor goes dark', () => {
    const rt = new RailTap()
    const e = new SimEngine(
      poweredLayout(
        [
          twoLead('R1', 'resistor', rt.plus(), 'a20', { resistance: 10 }),
          twoLead('R2', 'resistor', 'b20', rt.minus(), { resistance: 1 }),
          leads('D1', 'led', ['c20', 'top-30'], { color: 'red' }),
        ],
        [],
      ),
    )
    e.setRuntimeParam('PS1', 'voltage', 12)
    runFor(e, 4, 1e-3)
    expect(e.telemetry().components['R1'].damage?.kind).toBe('burned')
    expect(e.telemetry().components['D1'].light ?? 1).toBe(0)
  }, 20000)

  it('fmtWatts', () => {
    expect(fmtWatts(2.5)).toBe('2.5 W')
    expect(fmtWatts(0.25)).toBe('250 mW')
    expect(fmtWatts(1.23456)).toBe('1.23 W')
  })
})

describe('vivid: electrolytic capacitor venting', () => {
  function capAcross(plus: 'p1' | 'p2', polarized: boolean) {
    const rt = new RailTap()
    const a = rt.plus()
    const b = rt.minus()
    const holes = plus === 'p1' ? [a, b] : [b, a]
    return new SimEngine(poweredLayout([leads('C1', 'capacitor', holes, { capacitance: 1e-4, polarized })], []))
  }

  it('reversed by 5 V it vents after ≈ 1 s — latched, one error issue', () => {
    const e = capAcross('p2', true)
    runFor(e, 0.8, 1e-3)
    expect(e.telemetry().components['C1'].damage).toBeUndefined()
    runFor(e, 0.5, 1e-3)
    const t = e.telemetry().components['C1']
    expect(t.damage?.kind).toBe('vented')
    const expected = 1 / ((5 - CAP_REVERSE_OK) / CAP_VENT_VS)
    expect(t.damage?.since).toBeGreaterThan(expected - 0.05)
    expect(t.damage?.since).toBeLessThan(expected + 0.05)
    const issue = e.issues.find((i) => /^C1 vented/.test(i.message))
    expect(issue?.level).toBe('error')
    expect(issue?.message).toBe('C1 vented: 5.00 V reverse voltage on a polarized capacitor — turn it around (+ lead toward the higher voltage)')
    e.setRuntimeParam('PS1', 'voltage', 0)
    runFor(e, 0.2, 1e-3)
    expect(e.telemetry().components['C1'].damage?.kind).toBe('vented')
  }, 20000)

  it('the right way round, or non-polarized, it never vents', () => {
    for (const e of [capAcross('p1', true), capAcross('p2', false)]) {
      runFor(e, 3, 1e-3)
      expect(e.telemetry().components['C1'].damage).toBeUndefined()
      expect(e.issues.some((i) => /vented/.test(i.message))).toBe(false)
    }
  }, 20000)
})

describe('vivid: RGB LED light', () => {
  it('publishes the brightest die’s I / 20 mA', () => {
    const rt = new RailTap()
    // common cathode: R through 220 Ω, COM to the − rail, G / B unconnected
    const e2 = new SimEngine(
      poweredLayout(
        [
          twoLead('R1', 'resistor', rt.plus(), 'a30', { resistance: 220 }),
          leads('L1', 'rgb_led', ['b30', 'b31', 'b32', 'b33'], { common: 'cathode' }),
        ],
        [wire('c31', rt.minus())],
      ),
    )
    runFor(e2, 0.005)
    const t = e2.telemetry().components['L1']
    expect(t.light ?? 0).toBeGreaterThan(0.5)
    expect(t.light ?? 0).toBeLessThan(0.9)
    expect(t.damage).toBeUndefined()
  })
})
