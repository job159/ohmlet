/**
 * Honesty fix F11 — the LED's junction-temperature burn model
 * (src/sim/devices.ts LED_RTH_JA … LED_PEAK_TIME), replacing "above 30 mA
 * for 1 ms burns it":
 *
 *  - 100 Ω on 5 V (31 mA, the common beginner choice) runs 60 s of
 *    simulated time without burning — over its 20 mA rating (light > 1, the
 *    ERC still warns) but its junction settles near 45 °C;
 *  - an LED straight across 5 V burns within milliseconds, then it is OPEN
 *    (no current) and latched;
 *  - above the 150 mA peak rating it burns within ≈ 1 ms;
 *  - between: the junction heats over seconds — a blue LED at ≈ 125 mA
 *    overheats (damage 'overheating', heat ≥ 1) and burns after ≈ 12 s; a
 *    red one at ≈ 139 mA overheats but never reaches 150 °C;
 *  - the power-on step (an unconverged Newton iterate can report absurd
 *    power) never cooks a properly limited LED;
 *  - the RGB dies' instant rule is the same peak limit.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../src/sim/engine'
import {
  LED_AMBIENT_C,
  LED_BURN_CURRENT,
  LED_BURN_TIME,
  LED_PEAK_CURRENT,
  LED_PEAK_TIME,
  LED_RTH_JA,
  LED_THERMAL_TAU,
  LED_TJ_BURN_C,
  LED_TJ_MAX_C,
  LedDevice,
} from '../src/sim/devices'
import { runErc } from '../src/sim/erc'
import '../src/sim/models'
import { RailTap, poweredLayout, runFor, twoLead } from './helpers'

function ledWith(resistance: number | null, color = 'red', volts = 5) {
  const rt = new RailTap()
  const parts =
    resistance === null
      ? [twoLead('D1', 'led', rt.plus(), rt.minus(), { color })]
      : [twoLead('R1', 'resistor', rt.plus(), 'a15', { resistance }), twoLead('D1', 'led', 'b15', rt.minus(), { color })]
  const layout = poweredLayout(parts, [])
  const e = new SimEngine(layout)
  if (volts !== 5) e.setRuntimeParam('PS1', 'voltage', volts)
  return { e, layout }
}

/** the LED device itself (its junction temperature) */
function ledDevice(e: SimEngine): LedDevice {
  const d = (e as unknown as { leds: LedDevice[] }).leds[0]
  expect(d).toBeInstanceOf(LedDevice)
  return d
}

describe('F11: the constants are a 5 mm LED’s', () => {
  it('350 K/W, seconds, 100 °C max, 150 °C burn, 150 mA / 1 ms instant', () => {
    expect(LED_RTH_JA).toBeGreaterThanOrEqual(300)
    expect(LED_RTH_JA).toBeLessThanOrEqual(400)
    expect(LED_THERMAL_TAU).toBeGreaterThanOrEqual(1)
    expect(LED_THERMAL_TAU).toBeLessThanOrEqual(30)
    expect(LED_AMBIENT_C).toBe(25)
    expect(LED_TJ_MAX_C).toBe(100)
    expect(LED_TJ_BURN_C).toBe(150)
    expect(LED_PEAK_CURRENT).toBe(0.15)
    expect(LED_PEAK_TIME).toBe(1e-3)
    // the RGB LED's per-die instant rule is the same gross-overload limit (no longer 30 mA)
    expect(LED_BURN_CURRENT).toBe(LED_PEAK_CURRENT)
    expect(LED_BURN_TIME).toBe(LED_PEAK_TIME)
  })
})

describe('F11: 100 Ω on 5 V (31 mA) never burns', () => {
  it('60 s of simulated time: lit and over-rated, junction ≈ 45 °C, no damage; the ERC still warns', () => {
    const { e, layout } = ledWith(100)
    runFor(e, 0.01) // the analog step first (power-on)
    e.advance(60, 1e-3) // then a minute (the thermal step is exact for any step length)
    const t = e.telemetry().components['D1']
    expect(e.time).toBeGreaterThan(59.9)
    expect(t.burned).toBe(false)
    expect(t.damage).toBeUndefined()
    expect(t.current!).toBeGreaterThan(0.03)
    expect(t.current!).toBeLessThan(0.033)
    expect(t.light!).toBeGreaterThan(1.5) // ≈ 157 % of the rated 20 mA: over-driven (the 3D flicker)
    expect(t.heat).toBeUndefined() // well below half the rise to 100 °C
    const tj = ledDevice(e).junctionC
    expect(tj).toBeGreaterThan(40)
    expect(tj).toBeLessThan(50)
    expect(e.issues.some((i) => /burned out/.test(i.message))).toBe(false)
    // the warning stays: the LED current is above its rating
    const f = runErc(layout, { telemetry: e.telemetry(), issues: e.issues }).filter((x) => x.rule === 'led-current')
    expect(f.length).toBeGreaterThan(0)
    expect(f.every((x) => x.level === 'risk')).toBe(true)
  }, 30000)

  it('330 Ω: the power-on step (unconverged iterate) does not cook a limited LED', () => {
    const { e } = ledWith(330)
    e.step()
    expect(e.telemetry().components['D1'].burned).toBe(false)
    expect(ledDevice(e).junctionC).toBeLessThan(30)
    runFor(e, 0.01)
    expect(e.telemetry().components['D1'].light!).toBeGreaterThan(0.45) // 9.7 mA ≈ 48 % of 20 mA
  })
})

describe('F11: gross overloads still burn at once', () => {
  it('an LED straight across 5 V burns within milliseconds, then it is OPEN and latched', () => {
    const { e } = ledWith(null)
    runFor(e, 0.02)
    const t = e.telemetry().components['D1']
    expect(t.burned).toBe(true)
    expect(t.light).toBe(0)
    expect(t.damage?.kind).toBe('burned')
    expect(t.damage!.since).toBeGreaterThan(LED_PEAK_TIME * 0.9)
    expect(t.damage!.since).toBeLessThan(0.005) // far under a second
    expect(Math.abs(t.current!)).toBeLessThan(1e-6) // burned open: no current any more
    const issue = e.issues.find((i) => /^LED D1 burned out/.test(i.message))
    expect(issue?.componentId).toBe('D1')
    // latched: power off and on again does not heal it
    e.setRuntimeParam('PS1', 'voltage', 0)
    runFor(e, 0.005)
    e.setRuntimeParam('PS1', 'voltage', 5)
    runFor(e, 0.005)
    expect(e.telemetry().components['D1'].burned).toBe(true)
  })

  it('above the 150 mA peak rating (10 Ω on 5 V ≈ 300 mA): burned after ≈ 1 ms', () => {
    const { e } = ledWith(10)
    e.advance(0.0006)
    expect(e.telemetry().components['D1'].burned).toBe(false)
    expect(e.telemetry().components['D1'].current!).toBeGreaterThan(LED_PEAK_CURRENT)
    e.advance(0.002)
    const t = e.telemetry().components['D1']
    expect(t.burned).toBe(true)
    expect(t.damage!.since).toBeLessThan(0.0015)
    // the issue names the current that killed it
    expect(e.issues.find((i) => /^LED D1 burned out/.test(i.message))?.message).toMatch(/current 3\d\dmA/)
  })
})

describe('F11: between the rating and the peak the junction heats over seconds', () => {
  it('blue at ≈ 125 mA: overheating (heat ≥ 1) after a few seconds, burned after ≈ 12 s — not at once', () => {
    const { e } = ledWith(15, 'blue')
    runFor(e, 0.01)
    const i0 = e.telemetry().components['D1'].current!
    expect(i0).toBeGreaterThan(0.1)
    expect(i0).toBeLessThan(LED_PEAK_CURRENT)
    e.advance(1, 1e-3)
    expect(e.telemetry().components['D1'].burned).toBe(false)
    expect(e.telemetry().components['D1'].damage).toBeUndefined()
    e.advance(5, 1e-3) // 6 s: past 100 °C
    let t = e.telemetry().components['D1']
    expect(t.burned).toBe(false)
    expect(t.damage?.kind).toBe('overheating')
    expect(t.heat!).toBeGreaterThanOrEqual(1)
    e.advance(14, 1e-3) // 20 s
    t = e.telemetry().components['D1']
    expect(t.burned).toBe(true)
    expect(t.damage!.since).toBeGreaterThan(8)
    expect(t.damage!.since).toBeLessThan(18)
  }, 30000)

  it('red at ≈ 139 mA (22 Ω): overheating for a minute but never 150 °C', () => {
    const { e } = ledWith(22)
    runFor(e, 0.01)
    e.advance(60, 1e-3)
    const t = e.telemetry().components['D1']
    expect(t.burned).toBe(false)
    expect(t.damage?.kind).toBe('overheating')
    const tj = ledDevice(e).junctionC
    expect(tj).toBeGreaterThan(LED_TJ_MAX_C)
    expect(tj).toBeLessThan(LED_TJ_BURN_C)
  }, 30000)

  it('the overheating clears when the current drops (hysteresis), the junction cools', () => {
    const { e } = ledWith(22)
    runFor(e, 0.01)
    e.advance(30, 1e-3)
    expect(e.telemetry().components['D1'].damage?.kind).toBe('overheating')
    e.setRuntimeParam('R1', 'resistance', 330)
    e.advance(30, 1e-3)
    const t = e.telemetry().components['D1']
    expect(t.damage).toBeUndefined()
    expect(t.heat).toBeUndefined()
    expect(ledDevice(e).junctionC).toBeLessThan(40)
  }, 30000)
})

describe('F11: the RGB LED’s dies follow the same instant limit', () => {
  const rgb = (r: number) =>
    new SimEngine({
      version: 1,
      name: 'rgb',
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'D1', type: 'rgb_led', holes: ['f6', 'f7', 'f8', 'f9'], params: { common: 'cathode' } },
        { id: 'R1', type: 'resistor', holes: ['bot+6', 'j6'], params: { resistance: r } },
      ],
      wires: [
        { id: 'w1', from: 'PS1:+', to: 'bot+0' },
        { id: 'w2', from: 'PS1:-', to: 'bot-0' },
        { id: 'w3', from: 'h7', to: 'bot-7' },
      ],
    } as never)

  it('100 Ω on the red die (≈ 30 mA) no longer burns it; 10 Ω (≈ 300 mA) still does', () => {
    const ok = rgb(100)
    ok.advance(0.01) // power-on at the analog step
    ok.advance(1, 1e-3)
    const t = ok.telemetry().components['D1']
    expect(t.light!).toBeGreaterThan(1.4) // ≈ 150 % of 20 mA: over-driven, lit
    expect(t.burned).toBe(false)
    const gross = rgb(10)
    gross.advance(0.01)
    expect(gross.telemetry().components['D1'].burned).toBe(true)
  })
})
