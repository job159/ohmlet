/**
 * The readers of the eye-averaged LED telemetry (pwm-fade, glow NP3 — second
 * pass): a PWM LED's current, power and brightness are the mean over the
 * last 20 ms of a SWITCHING current (telemetry values.iPeak), and every
 * product-chrome surface says so — 「電流 平均 2.98 mA」 (its on-current
 * 「峰值 4.07 mA」 under the title), 「功率 平均 …」, 「亮度 15 %（平均 2.98 mA）」,
 * the board's on-board LED and the 3D label (fmtLedLight `average`). A steady
 * LED never says 平均. The English classic chrome keeps its words, and its
 * Brightness is the old I / 10 mA percent of the SAME eye-averaged current
 * as its Current row (classicLedBrightness) — never 「Current 2.22 mA /
 * Brightness 0%」.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout, ComponentTelemetry, SimTelemetry, Wire } from '../src/model/types'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { classicLedBrightness, fmtLedLight, isAveragedLed, ledLightParts } from '../src/instruments/led-light'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { SubcircuitGroup } from '../src/ui/embedded/PartInfo'
import { useLessonUi } from '../src/ui/lessons/state'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'
import { funcGen, layout, twoLead } from './helpers'

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __resetHistoryForTests?.()
})
afterEach(() => {
  __setLangForTests('zh-TW')
  vi.unstubAllGlobals()
  useStore.setState({ selection: [], telemetry: null })
})

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const inspect = (l: CircuitLayout, telemetry: SimTelemetry, id = 'LED1') => {
  useStore.setState({ layout: l, selection: [id], telemetry })
  return text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
}

const W = (id: string, from: string, to: string): Wire => ({ id, from, to })
/** A square-wave generator (0 ↔ 5 V at `hz`; `hz` 0 = a steady 5 V) driving 330 Ω + a red LED1. */
function squareLed(hz: number): CircuitLayout {
  return layout(
    [
      hz > 0
        ? funcGen('FG1', { waveform: 'square', frequency: hz, amplitude: 2.5, offset: 2.5 })
        : funcGen('FG1', { waveform: 'square', frequency: 0, amplitude: 0, offset: 5 }),
      twoLead('R1', 'resistor', 'a10', 'a14', { resistance: 330 }),
      twoLead('LED1', 'led', 'b14', 'top-2', { color: 'red' }),
    ],
    [W('wo', 'FG1:out', 'e10'), W('wg', 'FG1:gnd', 'top-0')],
  )
}
/** An RGB LED (common cathode): R on the square wave through 330 Ω, G steady on through 330 Ω. */
function squareRgb(hz: number): CircuitLayout {
  return layout(
    [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      funcGen('FG1', { waveform: 'square', frequency: hz, amplitude: 2.5, offset: 2.5 }),
      twoLead('R1', 'resistor', 'a10', 'a20', { resistance: 330 }),
      twoLead('R2', 'resistor', 'top+5', 'a22', { resistance: 330 }),
      { id: 'RGB1', type: 'rgb_led', holes: ['b20', 'b21', 'b22', 'b23'], params: { common: 'cathode' } },
    ],
    [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), W('wo', 'FG1:out', 'e10'), W('wg', 'FG1:gnd', 'top-1'), W('wc', 'e21', 'top-3')],
  )
}
function run(l: CircuitLayout, seconds: number): SimTelemetry {
  const e = new SimEngine(l)
  e.advance(seconds)
  return e.telemetry()
}

describe('the helpers', () => {
  it('fmtLedLight / ledLightParts say 平均 for an averaged current — and only then', () => {
    expect(fmtLedLight(0.149, 0.00298, { average: true })).toBe('15 %（平均 2.98 mA）')
    expect(fmtLedLight(0.149, 0.00298)).toBe('15 %（2.98 mA）')
    expect(ledLightParts(0.149, 0.00298, { average: true }).value).toBe('15 %（平均 2.98 mA）')
    expect(fmtLedLight(1.2, 0.024, { average: true })).toBe('120 %（平均 24.0 mA，超過額定 20 mA）')
    // a burned LED has nothing to average
    expect(fmtLedLight(0, 0, { burned: true, average: true })).toBe('0 %（已燒毀）')
    __setLangForTests('en')
    expect(fmtLedLight(0.149, 0.00298, { average: true })).toBe('15 % (average 2.98 mA)')
  })

  it('isAveragedLed reads values.iPeak; classicLedBrightness is I / 10 mA of the shown (mean) current', () => {
    expect(isAveragedLed({ values: { iPeak: 0.004 } })).toBe(true)
    expect(isAveragedLed({ values: {} })).toBe(false)
    expect(isAveragedLed(undefined)).toBe(false)
    const pwm: ComponentTelemetry = { pinVoltages: {}, current: 0.00222, light: 0.111, ledBrightness: 0, values: { iPeak: 0.0041 } }
    expect(classicLedBrightness(pwm)).toBeCloseTo(0.222, 6) // not the instant 0
    expect(classicLedBrightness({ pinVoltages: {}, current: 0.03, light: 1.5, ledBrightness: 1 })).toBe(1) // clamped
    expect(classicLedBrightness({ pinVoltages: {}, current: -1e-12, light: 0, ledBrightness: 0 })).toBe(0)
    expect(classicLedBrightness({ pinVoltages: {}, current: 0, light: 0, ledBrightness: 0.5, burned: true })).toBe(0)
    // an RGB LED: its brightest die (leds are each die's mean / 10 mA)
    expect(classicLedBrightness({ pinVoltages: {}, current: 0.012, light: 0.3, ledBrightness: 0, leds: { R: 0.6, G: 0.2, B: 0 } })).toBe(0.6)
    // a part that is no eye-averaged LED (no `light`) keeps its own ledBrightness
    expect(classicLedBrightness({ pinVoltages: {}, current: 0.02, ledBrightness: 0.3 })).toBe(0.3)
    expect(classicLedBrightness({ pinVoltages: {} })).toBeUndefined()
  })
})

describe('the product inspector says 平均 for a PWM LED', () => {
  it('1 kHz, 50 %: 電流 平均 · 峰值 under the title · 功率 平均 · 亮度 …（平均 …）', () => {
    const l = squareLed(1000)
    const telemetry = run(l, 0.1)
    const c = telemetry.components.LED1
    expect(isAveragedLed(c)).toBe(true)
    // the mean is about half the on-current (the on-current is the peak)
    expect(c.current!).toBeGreaterThan(0.35 * c.values!.iPeak)
    expect(c.current!).toBeLessThan(0.65 * c.values!.iPeak)
    const html = inspect(l, telemetry)
    expect(html).toMatch(/電流 峰值 \d\.\d\d mA 平均 \d\.\d\d mA/)
    expect(html).toMatch(/功率 平均 \d\.\d\d mW/)
    expect(html).toMatch(/亮度 \d+ %（平均 \d\.\d\d mA）/)
    // one number everywhere: the 電流 row's mean is the 亮度 row's
    const mean = /電流 峰值 [\d.]+ mA 平均 ([\d.]+) mA/.exec(html)![1]
    expect(html).toContain(`（平均 ${mean} mA）`)
  })

  it('a steady LED never says 平均 (nor 峰值)', () => {
    const l = squareLed(0)
    const telemetry = run(l, 0.1)
    expect(isAveragedLed(telemetry.components.LED1)).toBe(false)
    const html = inspect(l, telemetry)
    expect(html).toMatch(/亮度 \d+ %（\d\.\d\d mA）/)
    expect(html).not.toContain('平均')
    expect(html).not.toContain('峰值')
  })

  it('an RGB LED with a PWM die: its brightness and current say 平均 (no 峰值: the row is the common lead’s sum)', () => {
    const l = squareRgb(1000)
    const telemetry = run(l, 0.1)
    const c = telemetry.components.RGB1
    // the steady green die is the brightest: no average shown
    expect(isAveragedLed(c)).toBe(false)
    expect(inspect(l, telemetry, 'RGB1')).not.toContain('平均')
    // turn the green die off: the brightest die is the PWM red one
    const l2 = { ...l, components: l.components.map((p) => (p.id === 'R2' ? { ...p, params: { resistance: 1e7 } } : p)) }
    const t2 = run(l2, 0.1)
    expect(isAveragedLed(t2.components.RGB1)).toBe(true)
    const html = inspect(l2, t2, 'RGB1')
    expect(html).toMatch(/亮度 \d+ %（平均 \d\.\d\d mA）/)
    expect(html).toMatch(/電流 平均 \d\.\d\d mA/)
    expect(html).not.toContain('峰值')
  })

  it('the board’s on-board LED says 平均 too', () => {
    const entry = CATALOG.stm32_bluepill
    const pc13: ComponentTelemetry = { pinVoltages: {}, current: 0.00131, light: 0.066, ledBrightness: 0, burned: false, values: { iPeak: 0.0026 } }
    const html = text(renderToStaticMarkup(createElement(SubcircuitGroup, { entry, tele: { pinVoltages: {}, sub: { LED_PWR: pc13 } } })))
    expect(html).toContain('6.6 %（平均 1.31 mA）')
  })
})

describe('the English classic chrome: Current and Brightness agree on a PWM LED', () => {
  it('Brightness is the I / 10 mA percent of the Current row’s mean — at every read, never the instant 0 % or 41 %', () => {
    __setLangForTests('en')
    const l = squareLed(1000)
    const e = new SimEngine(l)
    e.advance(0.05)
    let instantDisagrees = 0
    for (let k = 0; k < 12; k++) {
      e.advance(0.00137) // reads at arbitrary phases of the 1 ms period
      const telemetry = e.telemetry()
      const c = telemetry.components.LED1
      const html = inspect(l, telemetry)
      const pct = Number(/Brightness (\d+)%/.exec(html)![1])
      expect(pct).toBe(Math.round(Math.min(1, c.current! / 0.01) * 100))
      // the classic chrome keeps its own words: no 「average」 / 「peak」
      expect(html).not.toMatch(/average|peak|平均|峰值/)
      if (Math.round(c.ledBrightness! * 100) !== pct) instantDisagrees++
    }
    // the engine's instant value would have contradicted the Current row
    expect(instantDisagrees).toBeGreaterThan(3)
  })

  it('a steady LED reads its original percent (the instant and the mean agree: 8.44 mA → 84%)', () => {
    __setLangForTests('en')
    const l = squareLed(0) // 5 V through the generator's 50 Ω and 330 Ω
    const telemetry = run(l, 0.1)
    expect(Math.round(telemetry.components.LED1.ledBrightness! * 100)).toBe(84)
    expect(inspect(l, telemetry)).toMatch(/Brightness 84%/)
  })
})
