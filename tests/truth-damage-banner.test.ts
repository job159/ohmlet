/**
 * The inspector's damage banner (vivid contract → truth): a damaged non-LED
 * part gets a banner from its OWN telemetry, styled like the burned-LED one,
 * naming cause, fix and how the simulated part comes back — and titled
 * exactly like its Problems row:
 *
 *   resistor burned open   「R2 燒斷了」       (error)
 *   resistor overheating   「R2 功率超過額定」  (warning) + 「溫度（相對額定）」
 *   capacitor vented       「C1 反接爆開」      (error)
 *   LED burned             「LED1 已燒毀」      (error)
 *   LED overheating        「LED1 正在過熱」    (warning, junction > 100 °C)
 *
 * Product chrome only: the English classic chrome keeps its single
 * original LED sentence and shows no new banner.
 *
 * Second pass: an RGB LED with a burned die is not "dead" (the burned die
 * keeps conducting, the others light) — the banner names the die and the
 * 亮度 row reads the lit dies; the inspector states a title once (the
 * banner drops its title while the problem card above shows the part's own
 * row, e.g. an overheating LED under 「LED1 的限流電阻太小」).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { runErc } from '../src/sim/erc'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { burnedRgbDies, cardShowsOwnRow, damageText, fmtHeat } from '../src/ui/embedded/DamageBanner'
import { useLab } from '../src/ui/embedded/lab'
import { deriveProblems, useProblems, type Problem, type ProblemsInput } from '../src/ui/embedded/problems'
import { useLessonUi } from '../src/ui/lessons/state'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'
import { valid } from './erc/helpers'

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

function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi, useProblems] as unknown as { getState: () => object; getInitialState: () => object }[]
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

const PS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
const resistorOn12V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 12 } },
    { id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } },
  ],
  wires: PS,
} as CircuitLayout)
const reversedCap: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'C1', type: 'capacitor', holes: ['top-6', 'top+6'], params: { capacitance: 1e-4, polarized: true } },
  ],
  wires: PS,
} as CircuitLayout)
const ledAcross5V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'LED1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } },
  ],
  wires: PS,
} as CircuitLayout)

function run(layout: CircuitLayout, seconds: number, dt = 1e-3): SimTelemetry {
  const e = new SimEngine(layout)
  e.advance(seconds, dt)
  return e.telemetry()
}
const problemsOf = (layout: CircuitLayout, telemetry: SimTelemetry) =>
  deriveProblems({
    layout,
    findings: runErc(layout, { telemetry, issues: telemetry.issues }),
    issues: telemetry.issues,
    firmware: {},
    mcus: {},
    running: true,
    simTime: telemetry.time,
  } as ProblemsInput)

describe('damage banner text — from telemetry, titled like the Problems row', () => {
  it('nothing damaged → no banner', () => {
    // 1 kΩ on 12 V: 144 mW in a ¼ W resistor — within its rating
    const ok = structuredClone(resistorOn12V)
    ok.components[1].params = { resistance: 1000 }
    const tele = run(ok, 5)
    expect(tele.components.R2.damage).toBeUndefined()
    expect(damageText('R2', CATALOG.resistor, tele.components.R2)).toBeNull()
    expect(damageText('R2', CATALOG.resistor, undefined)).toBeNull()
  })

  it('10 Ω on 12 V: overheating first (warning, 溫度（相對額定）), then 「R2 燒斷了」 (error) = the Problems row', () => {
    const hot = run(resistorOn12V, 1)
    const h = hot.components.R2
    expect(h.damage?.kind).toBe('overheating')
    const warn = damageText('R2', CATALOG.resistor, h)!
    expect(warn.tone).toBe('warning')
    expect(warn.title).toBe('R2 功率超過額定')
    expect(warn.body).toContain('14.4 W')
    expect(warn.body).toContain('超過額定 250 mW')
    expect(warn.body).toContain('會燒斷')
    expect(fmtHeat(h.heat!)).toMatch(/^\d+(\.\d)? 倍$/)
    // the Problems row of the same fact has the same title
    expect(problemsOf(resistorOn12V, hot).some((p) => p.title === warn.title)).toBe(true)

    const burned = run(resistorOn12V, 2.5)
    const b = damageText('R2', CATALOG.resistor, burned.components.R2)!
    expect(b.tone).toBe('error')
    expect(b.title).toBe('R2 燒斷了')
    expect(b.body).toContain('電阻膜過熱燒穿')
    expect(b.body).toContain('請改用阻值更大或瓦數更高的電阻')
    expect(b.body).toContain('「重置模擬」')
    expect(b.body).toContain('真實的電阻只能更換')
    expect(problemsOf(resistorOn12V, burned).find((p) => p.fact === 'burned:R2')?.title).toBe(b.title)
  })

  it('a reversed electrolytic: 「C1 反接爆開」 (error) = the Problems row; the value is kept', () => {
    const tele = run(reversedCap, 1.5)
    const d = damageText('C1', CATALOG.capacitor, tele.components.C1)!
    expect(d.tone).toBe('error')
    expect(d.title).toBe('C1 反接爆開')
    expect(d.body).toContain('實際的電容已經損壞')
    expect(d.body).toContain('模擬仍沿用原本的容值')
    expect(d.body).toContain('「重置模擬」')
    expect(problemsOf(reversedCap, tele).find((p) => p.fact === 'vented:C1')?.title).toBe(d.title)
  })

  it('an LED across 5 V: 「LED1 已燒毀」 = the Problems row; an overheating LED warns', () => {
    const tele = run(ledAcross5V, 0.02, undefined)
    const d = damageText('LED1', CATALOG.led, tele.components.LED1)!
    expect(d.tone).toBe('error')
    expect(d.title).toBe('LED1 已燒毀')
    expect(d.body).toContain('讓電流低於 20 mA')
    expect(d.body).not.toContain('更換') // the simulated LED recovers (QA: no 「replace」 in the product copy)
    expect(problemsOf(ledAcross5V, tele).some((p) => p.title === d.title)).toBe(true)
    const hot = damageText('LED1', CATALOG.led, { pinVoltages: {}, current: 0.139, light: 6.95, heat: 1.2, damage: { kind: 'overheating', since: 4 } })!
    expect(hot.tone).toBe('warning')
    expect(hot.title).toBe('LED1 正在過熱')
    expect(hot.body).toContain('電流 139 mA 遠超過額定 20 mA')
  })
})

describe('the inspector shows it', () => {
  it('product chrome: the burned resistor’s banner and its live values', () => {
    const telemetry = run(resistorOn12V, 2.5)
    useStore.setState({ layout: resistorOn12V, selection: ['R2'], telemetry })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(html).toContain('dmg-banner')
    expect(html).toContain('role="alert"')
    expect(text(html)).toContain('R2 燒斷了')
  })

  it('product chrome: an overheating resistor shows the warning banner and 「溫度（相對額定）」', () => {
    const telemetry = run(resistorOn12V, 1)
    useStore.setState({ layout: resistorOn12V, selection: ['R2'], telemetry })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(html).toContain('dmg-banner is-warn')
    expect(text(html)).toMatch(/溫度（相對額定） \d+(\.\d)? 倍/)
  })

  it('product chrome: the vented capacitor’s banner', () => {
    const telemetry = run(reversedCap, 1.5)
    useStore.setState({ layout: reversedCap, selection: ['C1'], telemetry })
    expect(text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))).toContain('C1 反接爆開')
  })

  it('classic chrome: no new banner; the burned LED keeps its original sentence', () => {
    __setLangForTests('en')
    const telemetry = run(resistorOn12V, 2.5)
    useStore.setState({ layout: resistorOn12V, selection: ['R2'], telemetry })
    expect(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))).not.toContain('dmg-banner')
    const led = run(ledAcross5V, 0.02)
    useStore.setState({ layout: ledAcross5V, selection: ['LED1'], telemetry: led })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(html).not.toContain('dmg-banner')
    expect(html).toContain('Burned out — replace this LED and add a series resistor.')
  })
})

// ---------------------------------------------------------------- second pass
const rgbRedBurned: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    // pins [R, COM, G, B]: red through 10 Ω (≈ 300 mA — burns in a millisecond), green through 150 Ω
    { id: 'D1', type: 'rgb_led', holes: ['f6', 'f7', 'f8', 'f9'], params: { common: 'cathode' } },
    { id: 'R1', type: 'resistor', holes: ['bot+6', 'j6'], params: { resistance: 10 } },
    { id: 'R2', type: 'resistor', holes: ['bot+8', 'j8'], params: { resistance: 150 } },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'bot+0' },
    { id: 'w2', from: 'PS1:-', to: 'bot-0' },
    { id: 'w3', from: 'h7', to: 'bot-7' },
  ],
} as CircuitLayout)

describe('second pass: a partly burned RGB LED is not described as dead', () => {
  it('the banner names the burned die, says it still conducts and the other dies still light', () => {
    const tele = run(rgbRedBurned, 0.05, 1e-4).components.D1
    expect(tele.burned).toBe(true)
    expect(tele.light!).toBeGreaterThan(0.3) // the green die lights
    expect(burnedRgbDies(tele)).toEqual(['R'])
    const d = damageText('D1', CATALOG.rgb_led, tele)!
    expect(d.tone).toBe('error')
    expect(d.title).toBe('D1 已燒毀') // = the Problems row
    expect(d.body).toContain('紅色晶粒電流太大燒毀了')
    expect(d.body).toContain('燒毀的晶粒仍會導通，但不再發光；其他晶粒照常發光')
    expect(d.body).not.toContain('不導電')
    // a burned die that carries no current cannot be named: the generic sentence (never a guess)
    const dark = { ...tele, values: { iR: 0, iG: 0, iB: 0 } }
    expect(burnedRgbDies(dark)).toEqual([])
    expect(damageText('D1', CATALOG.rgb_led, dark)!.body).toContain('有晶粒電流太大燒毀了')
    // intact RGB: no banner
    expect(damageText('D1', CATALOG.rgb_led, { ...tele, burned: false, damage: undefined })).toBeNull()
  })

  it('the inspector’s 亮度 reads the lit die, not 「0 %（已燒毀）」', () => {
    const telemetry = run(rgbRedBurned, 0.05, 1e-4)
    const tele = telemetry.components.D1
    useStore.setState({ layout: rgbRedBurned, selection: ['D1'], telemetry })
    const html = text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))
    const pct = `${Math.round(tele.light! * 100)} %`
    expect(html).toMatch(new RegExp(`亮度 ${pct}（\\d+(\\.\\d+)? mA）`))
    expect(html).not.toContain('0 %（已燒毀）')
    expect(html).not.toContain('不導電')
    // nothing lit with a burned die: 「0 %（有晶粒燒毀）」
    const darkTele = { ...telemetry, components: { ...telemetry.components, D1: { ...tele, light: 0 } } }
    useStore.setState({ telemetry: darkTele })
    expect(text(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))).toContain('亮度 0 %（有晶粒燒毀）')
  })
})

describe('second pass: the inspector states a title once', () => {
  const row = (componentIds: string[], title = 'x'): Pick<Problem, 'componentIds' | 'title'> => ({ componentIds, title })

  it('cardShowsOwnRow: the first row involving the part, whose subject is the part', () => {
    expect(cardShowsOwnRow([], 'R2')).toBe(false)
    expect(cardShowsOwnRow([row(['R2'])], 'R2')).toBe(true)
    expect(cardShowsOwnRow([row(['PS1', 'R2'])], 'R2')).toBe(false) // a row about another part: the banner keeps its title
    expect(cardShowsOwnRow([row(['LED9']), row(['LED1', 'R1'])], 'LED1')).toBe(true)
  })

  it('with the part’s own Problems row in the card above, the banner keeps its body and drops the repeated title', () => {
    const telemetry = run(resistorOn12V, 2.5)
    const problems = problemsOf(resistorOn12V, telemetry)
    expect(problems[0].title).toBe('R2 燒斷了')
    useStore.setState({ layout: resistorOn12V, selection: ['R2'], telemetry })
    useProblems.setState({ problems })
    try {
      const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
      expect(html).toContain('dmg-banner')
      expect(html).toContain('is-untitled')
      expect(html).not.toContain('dmg-banner-title')
      expect(text(html)).toContain('電阻膜過熱燒穿')
      // the title is stated once — by the card
      expect(text(html).split('R2 燒斷了').length - 1).toBe(1)
    } finally {
      useProblems.setState({ problems: [] })
    }
  })

  it('an overheating LED: its row is the cause (「…限流電阻太小」); the banner adds the state without a second title', () => {
    const layout = valid({
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        // a blue LED through 15 Ω: ≈ 125 mA — its junction passes 100 °C after ≈ 4 s (burns at ≈ 12 s)
        { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 15 } },
        { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'blue' } },
      ],
      wires: PS,
    } as CircuitLayout)
    const e = new SimEngine(layout)
    e.advance(0.01) // power-on at the analog step, then 1 ms steps (the thermal step is exact for any length)
    e.advance(6, 1e-3)
    const telemetry = e.telemetry()
    expect(telemetry.components.LED1.damage?.kind).toBe('overheating')
    const problems = problemsOf(layout, telemetry)
    const own = problems.find((p) => p.componentIds.includes('LED1'))!
    expect(own.componentIds[0]).toBe('LED1')
    expect(own.title).toBe('LED1 的限流電阻太小')
    useStore.setState({ layout, selection: ['LED1'], telemetry })
    useProblems.setState({ problems })
    try {
      const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
      expect(html).toContain('dmg-banner is-warn is-untitled')
      expect(text(html)).not.toContain('LED1 正在過熱')
      expect(text(html)).toContain('接面溫度已超過 100 °C')
    } finally {
      useProblems.setState({ problems: [] })
    }
  })
})
