/**
 * Honesty fix F4 — ONE LED brightness scale: brightness = I / the rated
 * 20 mA (telemetry `light`, what the 3D LED shows), always printed with the
 * LED current — 「20 %（4.07 mA）」, above the rating 「106 %（21.1 mA，超過額定
 * 20 mA）」 — in the inspector (PropertiesSheet live values, the board's
 * on-board LEDs), the 3D LED labels, the lesson checks and the catalog.
 * The English classic chrome keeps its original 「…%」 (I / 10 mA).
 *
 * Lesson acceptance keeps EXACTLY the same pass / fail currents: b1's
 * 「LED1 正常發光」 passed 5–30 mA before (≥ 50 % of 10 mA, and the old model
 * burned the LED above 30 mA) and passes 5–30 mA now (25–150 % of 20 mA).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout, ComponentTelemetry, ParamValue, SimTelemetry } from '../src/model/types'
import { LED_RATED_CURRENT } from '../src/sim/devices'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { LED_LIGHT_RATED_A, fmtLedLight, fmtLight, fmtRatedCurrent, isOverRated, ledFindingMessage, ledLightParts, ledSentenceOnOneScale } from '../src/instruments/led-light'
import { runErc } from '../src/sim/erc'
import { deriveProblems, type ProblemsInput } from '../src/ui/embedded/problems'
import { lessonById } from '../src/lessons'
import { evaluateChecks, lessonCircuitInput } from '../src/lessons/engine/evaluate'
import type { LessonCheck } from '../src/lessons/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { SubcircuitGroup } from '../src/ui/embedded/PartInfo'
import { useLessonUi } from '../src/ui/lessons/state'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'

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

function ledBoard(resistance: number): CircuitLayout {
  return {
    version: 1,
    name: 't',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['top+10', 'a14'], params: { resistance } },
      { id: 'LED1', type: 'led', holes: ['c14', 'c16'], params: { color: 'red' } },
    ],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+0' },
      { id: 'W2', from: 'PS1:-', to: 'top-0' },
      { id: 'W3', from: 'a16', to: 'top-13' },
    ],
  } as CircuitLayout
}

function telemetryOf(layout: CircuitLayout, seconds = 0.05): SimTelemetry {
  const e = new SimEngine(layout)
  e.advance(seconds)
  return e.telemetry()
}

describe('F4: the helper', () => {
  it('is relative to the rated 20 mA — the device model’s and the catalog LED’s', () => {
    expect(LED_LIGHT_RATED_A).toBe(LED_RATED_CURRENT)
    expect(CATALOG.led.ratings?.ifMax).toBe(LED_LIGHT_RATED_A)
    expect(fmtRatedCurrent(0.02)).toBe('20 mA')
    expect(fmtRatedCurrent(0.015)).toBe('15 mA')
  })

  it('zh-TW: always with the current; above the rating says so; burned; faint never 0 %', () => {
    __setLangForTests('zh-TW')
    expect(fmtLedLight(0.2035, 0.00407)).toBe('20 %（4.07 mA）')
    expect(fmtLedLight(1.055, 0.0211)).toBe('106 %（21.1 mA，超過額定 20 mA）')
    expect(fmtLedLight(1.004, 0.02008)).toBe('100 %（20.1 mA）') // 「100 %」 is not 「超過額定」
    expect(fmtLedLight(0, 3e-9, { burned: true })).toBe('0 %（已燒毀）')
    expect(fmtLedLight(0.0035, 0.00007)).toBe('0.4 %（70.0 µA）')
    expect(fmtLedLight(0, -7.6e-12)).toBe('0 %（0 A）') // a reversed LED: nothing flows
    expect(fmtLedLight(undefined, 0.01)).toBe('—')
    expect(fmtLight(0.0001)).toBe('< 0.1 %')
    expect(isOverRated(1.004)).toBe(false)
    expect(isOverRated(1.006)).toBe(true)
    expect(ledLightParts(1.57, 0.0314)).toEqual({ value: '157 %（31.4 mA）', over: '超過額定 20 mA' })
    expect(ledLightParts(0.485, 0.0097)).toEqual({ value: '49 %（9.70 mA）', over: null })
  })

  it('English (non-classic chrome) reads the same numbers', () => {
    __setLangForTests('en')
    expect(fmtLedLight(0.2035, 0.00407)).toBe('20 % (4.07 mA)')
    expect(fmtLedLight(1.55, 0.031)).toBe('155 % (31.0 mA, above the rated 20 mA)')
    expect(fmtLedLight(0, 0, { burned: true })).toBe('0 % (burned out)')
  })
})

describe('F4: the inspector uses the one scale', () => {
  it('a 330 Ω LED reads 「亮度 49 %（9.70 mA）」 — not the old 97 %', () => {
    const layout = ledBoard(330)
    const telemetry = telemetryOf(layout)
    const t = telemetry.components.LED1
    expect(t.light!).toBeGreaterThan(0.47)
    expect(t.light!).toBeLessThan(0.5)
    useStore.setState({ layout, selection: ['LED1'], telemetry })
    const html = text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
    expect(html).toMatch(/亮度 4[89] %（9\.\d\d mA）/)
    expect(html).not.toMatch(/亮度 97 %/)
  })

  it('100 Ω (31 mA): over the rating, said with the current', () => {
    const layout = ledBoard(100)
    const telemetry = telemetryOf(layout)
    useStore.setState({ layout, selection: ['LED1'], telemetry })
    const html = text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
    // the note goes under the row title (a narrow inspector never squeezes 「亮度」)
    expect(html).toMatch(/亮度 超過額定 20 mA 15\d %（3\d\.\d mA）/)
    expect(html).not.toMatch(/亮度 100 %/)
  })

  it('the classic chrome keeps its original I / 10 mA percent', () => {
    __setLangForTests('en')
    const layout = ledBoard(330)
    const telemetry = telemetryOf(layout)
    useStore.setState({ layout, selection: ['LED1'], telemetry })
    const html = text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
    expect(html).toMatch(/Brightness 97%/)
  })

  it('a board’s on-board LED: brightness with its current', () => {
    const entry = CATALOG.stm32_bluepill
    const pwr: ComponentTelemetry = { pinVoltages: {}, current: 0.00262, light: 0.131, ledBrightness: 0.262, burned: false }
    const html = text(renderToStaticMarkup(createElement(SubcircuitGroup, { entry, tele: { pinVoltages: {}, sub: { LED_PWR: pwr } } })))
    expect(html).toContain('13 %（2.62 mA）')
  })
})

describe('F4: the Problems rows quote the same brightness', () => {
  it('the ERC sentence’s old 「(brightness 100 %)」 is recomputed from the current it quotes', () => {
    const m = 'LED1: R1 (100 Ω) lets up to ≈ 32.0 mA flow. The simulation measures 31.4 mA through it right now (brightness 100 %).'
    expect(ledSentenceOnOneScale(m)).toBe(
      'LED1: R1 (100 Ω) lets up to ≈ 32.0 mA flow. The simulation measures 31.4 mA through it right now (brightness 157 %).',
    )
    expect(ledSentenceOnOneScale(ledSentenceOnOneScale(m))).toBe(ledSentenceOnOneScale(m)) // idempotent
    // second pass: below 10 % the inspector prints one decimal (「4.9 %」), which the sentence's zh-TW
    // template (whole percent only) cannot carry — the brightness is left out, the current stays
    // (this used to assert a whole 「(brightness 5 %)」 that the inspector never printed)
    expect(ledSentenceOnOneScale('measures 970 µA through it right now (brightness 10 %).')).toBe('measures 970 µA through it right now.')
    expect(ledSentenceOnOneScale('no brightness here')).toBe('no brightness here')
  })

  it('second pass: from the LED’s telemetry light — the inspector’s exact percent, not the rounded current’s', () => {
    const m = 'The simulation measures 21.1 mA through it right now (brightness 100 %).'
    // 21.08 mA: the sentence's rounded 21.1 mA alone would say 106 %; the readings say 105 % (the inspector's)
    expect(ledSentenceOnOneScale(m)).toContain('(brightness 106 %)')
    expect(ledSentenceOnOneScale(m, { light: 1.054 })).toBe('The simulation measures 21.1 mA through it right now (brightness 105 %).')
    expect(ledSentenceOnOneScale(ledSentenceOnOneScale(m, { light: 1.054 }), { light: 1.054 })).toContain('(brightness 105 %)') // idempotent
    expect(ledSentenceOnOneScale('The simulation measures 125 mA through it right now (brightness 100 %).', { light: 6.23 })).toContain('(brightness 623 %)')
    // the percent is fmtLight's, the inspector's: 10 % and up whole
    expect(ledSentenceOnOneScale('measures 2.00 mA through it right now (brightness 20 %)', { light: 0.1 })).toContain('(brightness 10 %)')
    expect(ledSentenceOnOneScale('measures 1.50 mA through it right now (brightness 15 %)', { light: 0.075 })).toBe('measures 1.50 mA through it right now')
  })

  it('ledFindingMessage: an led-current finding reads its subject’s telemetry light; other rules pass through', () => {
    const tel = { time: 0, components: { LED1: { pinVoltages: {}, light: 1.054, current: 0.02108 } } } as unknown as SimTelemetry
    const f = { rule: 'led-current' as const, componentIds: ['LED1', 'R1'], message: 'x measures 21.1 mA through it right now (brightness 100 %).' }
    expect(ledFindingMessage(f, tel)).toContain('(brightness 105 %)')
    expect(ledFindingMessage(f, null)).toContain('(brightness 106 %)') // no readings: from the quoted current
    expect(ledFindingMessage({ ...f, rule: 'over-rating' as const }, tel)).toBe(f.message)
  })

  it('second pass: 150 Ω (21.1 mA) — the Problems row prints the inspector’s very percent', () => {
    __setLangForTests('zh-TW')
    const layout = ledBoard(150)
    const telemetry = telemetryOf(layout)
    const light = telemetry.components.LED1.light!
    const pct = `${Math.round(light * 100)} %`
    const p = deriveProblems({
      layout,
      findings: runErc(layout, { telemetry, issues: telemetry.issues }),
      issues: telemetry.issues,
      firmware: {},
      mcus: {},
      running: true,
      simTime: telemetry.time,
      telemetry,
    } as ProblemsInput)
    const row = p.find((x) => x.rule === 'led-current' && x.componentIds.includes('LED1'))!
    useStore.setState({ layout, selection: ['LED1'], telemetry })
    const html = text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
    const insp = /亮度 (?:超過額定 20 mA )?(\d+ %)（([\d.]+ mA)）/.exec(html)!
    expect(insp[1]).toBe(pct)
    expect(row.detail).toContain(`${insp[2]}（亮度 ${pct}）`)
  })

  it('second pass: the lesson’s ERC check quotes the same brightness as its brightness check (b1, 100 Ω)', { timeout: 120_000 }, async () => {
    __setLangForTests('zh-TW')
    const b1 = lessonById('b1-led-resistor')!
    const sol = structuredClone(b1.solution)
    const r1 = sol.layout.components.find((x) => x.id === 'R1')!
    r1.params = { ...(r1.params ?? {}), resistance: 100 as ParamValue }
    const input = await lessonCircuitInput(sol)
    const [bright, erc] = await evaluateChecks(input, [b1.acceptance[4], b1.acceptance[5]])
    const b = /量測值 (\d+ %)（([\d.]+ mA)/.exec(bright.detail)!
    expect(erc.pass).toBe(false)
    expect(erc.detail).toContain(`${b[2]}（亮度 ${b[1]}）`)
    expect(erc.detail).not.toContain('亮度 100 %')
  })

  it('100 Ω: the Problems row and the inspector say 157 % of the same 31.4 mA', () => {
    __setLangForTests('zh-TW')
    const layout = ledBoard(100)
    const telemetry = telemetryOf(layout)
    const p = deriveProblems({
      layout,
      findings: runErc(layout, { telemetry, issues: telemetry.issues }),
      issues: telemetry.issues,
      firmware: {},
      mcus: {},
      running: true,
      simTime: telemetry.time,
    } as ProblemsInput)
    const row = p.find((x) => x.rule === 'led-current' && x.componentIds.includes('LED1'))!
    expect(row.level).toBe('warning')
    expect(row.detail).toMatch(/3\d\.\d mA（亮度 15\d %）/)
    expect(row.detail).not.toContain('亮度 100 %')
  })
})

describe('F4: lesson acceptance keeps the same pass / fail currents', () => {
  const b1 = () => lessonById('b1-led-resistor')!
  const withR = (r: number) => {
    const sol = structuredClone(b1().solution)
    const c = sol.layout.components.find((x) => x.id === 'R1')!
    c.params = { ...(c.params ?? {}), resistance: r as ParamValue }
    return sol
  }

  it('b1 「LED1 正常發光」 passes exactly 5–30 mA, as the old ≥ 50 % of 10 mA + 30 mA burn did', { timeout: 120_000 }, async () => {
    __setLangForTests('zh-TW')
    const check = b1().acceptance[4] as Extract<LessonCheck, { kind: 'measure' }>
    expect(check.quantity).toBe('led-brightness')
    expect(check.label).toContain('25–150 %')
    // R → (current, did the old scale pass?)
    const cases: [number, boolean][] = [
      [10000, false], // 0.32 mA
      [1000, false], // 3.2 mA
      [560, true], // 5.8 mA
      [330, true], // 9.7 mA
      [220, true], // 14.5 mA
      [150, true], // 21 mA
      [108, true], // 29 mA
      [100, false], // 31 mA — the old model burned it; now 157 % > 150 %
      [95, false], // 33 mA
    ]
    for (const [r, oldPass] of cases) {
      const input = await lessonCircuitInput(withR(r))
      const [res] = await evaluateChecks(input, [check])
      const i = (5 - 1.85) / r
      expect(res.pass, `${r} Ω ≈ ${(i * 1000).toFixed(1)} mA`).toBe(oldPass)
      // the old rule, computed independently: ≥ 5 mA and ≤ 30 mA
      expect(oldPass).toBe(i >= 0.005 && i <= 0.03)
    }
  })

  it('the result reads the brightness with its current and the expected range in mA', { timeout: 60_000 }, async () => {
    __setLangForTests('zh-TW')
    const check = b1().acceptance[4] as Extract<LessonCheck, { kind: 'measure' }>
    const [res] = await evaluateChecks(await lessonCircuitInput(withR(330)), [check])
    expect(res.pass).toBe(true)
    expect(res.detail).toMatch(/量測值 4[89] %（9\.\d\d mA）（預期 25 % – 150 %，即 5 mA – 30 mA）/)
    const [over] = await evaluateChecks(await lessonCircuitInput(withR(100)), [check])
    expect(over.pass).toBe(false)
    expect(over.detail).toMatch(/量測值 15\d %（3\d\.\d mA，超過額定 20 mA）/)
  })

  it('b4 「SW1 放開時 LED1 不亮」: the same 0.1 mA limit (0.5 % of 20 mA = 1 % of 10 mA)', () => {
    const b4 = lessonById('b4-button-debounce')!
    const check = b4.acceptance.find((c) => c.kind === 'measure' && c.quantity === 'led-brightness') as Extract<LessonCheck, { kind: 'measure' }>
    expect(check.max * LED_LIGHT_RATED_A).toBeCloseTo(0.01 * 0.01, 12)
  })

  it('lesson texts quote the new scale (no 「亮度約 97 %」)', () => {
    for (const id of ['b1-led-resistor', 'b4-button-debounce', 'b6-mosfet-led']) {
      const json = JSON.stringify(lessonById(id))
      expect(json, id).not.toMatch(/亮度約 97 %|亮度約 3 %|超過 30 mA 持續 1 ms/)
    }
    // P1: fmtLight rounds from telemetry thousandths, half up, so 330 Ω (light 0.485) reads 49 % on
    // every surface — the 3D label, the inspector and acceptance — and the lesson text says the same.
    expect(JSON.stringify(lessonById('b1-led-resistor'))).toContain('亮度約 49 %（以額定 20 mA 為 100 %）')
  })
})
