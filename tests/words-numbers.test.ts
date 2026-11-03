/**
 * Final wording pass (owner: words) — the numbers and sentences every surface
 * shares must say the same thing, from the real models:
 *
 *  m1  every LED burn sentence states the LED model's thermal rule (junction
 *      past about 150 °C, or more than 150 mA for over 1 ms —
 *      src/sim/devices.ts LED_TJ_BURN_C / LED_PEAK_CURRENT), never the old
 *      「超過 30 mA 達 1 ms」, in English and zh-TW, anywhere a user reads it;
 *  T   the raw ERC rows (ERC panel FindingRow, a lesson's 最可能的原因) quote
 *      the measured brightness on the app's one scale (telemetry `light` =
 *      I / the rated 20 mA, src/instruments/led-light.ts), never the old
 *      I / 10 mA percent;
 *  P1  one rounding: the 3D LED label, the inspector, the lesson acceptance
 *      and the ERC sentence print the same percent for the same current over
 *      a sweep (b1's 330 Ω reads 49 % everywhere, not 48 % in acceptance);
 *  C   the catalog honesty texts (RGB LED scale and burn rule, the LED look,
 *      the legacy chips' supply reading, the pushbutton's keep-pressed words,
 *      the 'over-rating' rule now that a reversed electrolytic is a static
 *      error before Run).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { partSupport, partTranslation } from '../src/i18n/parts'
import { CATALOG, supportOf } from '../src/model/catalog'
import type { CircuitLayout, ParamValue, SimTelemetry } from '../src/model/types'
import { LED_PEAK_CURRENT, LED_PEAK_TIME, LED_TJ_BURN_C, roundLight } from '../src/sim/devices'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { fmtLedLight, fmtLight, isOverRated, ledFindingMessage, ledLightParts } from '../src/instruments/led-light'
import { ERC_RULES, runErc } from '../src/sim/erc'
import type { ErcFinding } from '../src/sim/erc'
import { buildCircuit } from '../src/sim/erc/graph'
import { checkLive } from '../src/sim/erc/rules-live'
import { lessonById } from '../src/lessons'
import { evaluateChecks, lessonCircuitInput } from '../src/lessons/engine/evaluate'
import { sampleStats } from '../src/lessons/engine/signal'
import type { LessonCheck } from '../src/lessons/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { useLessonUi } from '../src/ui/lessons/state'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'
import { englishLeft } from './i18n/zh-check'
import { BP, bluePill, ofRule, part, railsWorld, summary, valid, w } from './erc/helpers'

const ROOT = path.resolve(__dirname, '..')

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

/** The thermal rule's numbers, from the model itself. */
const RULE_EN = new RegExp(
  `junction pass(?:ed|es) about ${LED_TJ_BURN_C} °C.*more than ${LED_PEAK_CURRENT * 1000} mA flow(?:s|ed) for over ${LED_PEAK_TIME * 1000} ms`,
)
const RULE_ZH = `接面溫度超過約 ${LED_TJ_BURN_C} °C，或電流超過 ${LED_PEAK_CURRENT * 1000} mA 達 ${LED_PEAK_TIME * 1000} ms 以上`
const OLD_RULE = /30 mA (?:for|達)[^\n]{0,20}1 ms|after more than 30 mA/

function zh(message: string): string {
  __setLangForTests('zh-TW')
  return tMessage(message)
}

function expectThermalSentence(message: string): void {
  expect(message).toMatch(RULE_EN)
  expect(message).not.toMatch(OLD_RULE)
  const z = zh(message)
  expect(z).toContain(RULE_ZH)
  expect(z).not.toMatch(/30 mA/)
  expect(englishLeft(z), z).toEqual([])
}

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

function simulate(l: CircuitLayout, seconds = 0.05): { telemetry: SimTelemetry; issues: SimEngine['issues'] } {
  const e = new SimEngine(l)
  e.advance(seconds)
  return { telemetry: e.telemetry(), issues: e.issues }
}

// ---------------------------------------------------------------------------
// m1 — the burn sentences
// ---------------------------------------------------------------------------

describe('m1: every LED burn sentence states the thermal model', () => {
  it('an LED the simulation burned (10 Ω on 5 V, ≈ 300 mA): the LED finding says why, in both languages', () => {
    const l = valid(
      railsWorld([part('R1', 'resistor', ['top+5', 'a40'], { resistance: 10 }), part('D1', 'led', ['b40', 'b45'])], [w('c45', 'top-5')]),
    )
    const sim = simulate(l, 0.005)
    expect(sim.telemetry.components.D1.burned).toBe(true)
    const f = ofRule(runErc(l, sim), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].message).toMatch(/The simulation’s LED model has already burned it out \(/)
    expectThermalSentence(f[0].message)
    expect(zh(f[0].message)).toContain(`模擬的 LED 模型已將它燒毀（電流長時間遠超額定、${RULE_ZH}）。`)
  })

  it('a burned LED behind a resistor the static check accepts: 「在模擬中燒毀（…）」', () => {
    const l = ledBoard(330)
    const sim = simulate(l)
    sim.telemetry.components.LED1 = { ...sim.telemetry.components.LED1, burned: true, light: 0, current: 5e-9 }
    const f = ofRule(runErc(l, sim), 'led-current').filter((x) => x.level === 'error')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].message).toMatch(/^LED1 burned out in the simulation \(/)
    expectThermalSentence(f[0].message)
    expect(zh(f[0].message)).toMatch(new RegExp(`^LED1 在模擬中燒毀（電流長時間遠超額定、${RULE_ZH}）——`))
  })

  it('the live rule’s LED sentence (an LED no LED finding reported)', () => {
    const l = ledBoard(330)
    const sim = simulate(l)
    sim.telemetry.components.LED1 = { ...sim.telemetry.components.LED1, burned: true }
    const out: ErcFinding[] = []
    checkLive(buildCircuit(l, sim.telemetry, sim.issues), out, new Set())
    const f = out.find((x) => x.id === 'over-rating:LED1')
    expect(f, summary(out)).toBeDefined()
    expect(f!.message).toMatch(/latches it as burned when/)
    expectThermalSentence(f!.message)
    expect(zh(f!.message)).toBe(`LED1 在模擬中燒毀（LED 模型在電流長時間遠超額定、${RULE_ZH}時鎖定為燒毀）。請加上或加大串聯電阻，再按〔換新〕；改好電路或數值時也會自動換新。`)
  })

  it('a board’s on-board LED burned out', () => {
    const l = valid(bluePill())
    const sim = simulate(l, 0.01)
    const u1 = sim.telemetry.components[BP.id]
    expect(u1.sub?.LED_PC13).toBeDefined()
    u1.sub!.LED_PC13 = { ...u1.sub!.LED_PC13, burned: true }
    const f = runErc(l, sim).find((x) => x.id === 'over-rating:U1:LED_PC13')
    expect(f).toBeDefined()
    expectThermalSentence(f!.message)
    expect(zh(f!.message)).toMatch(new RegExp(`^U1 的板載 LED LED_PC13 在模擬中燒毀（電流長時間遠超額定、${RULE_ZH}）：`))
  })

  it('no user-facing text still says 30 mA for 1 ms (ERC, dictionaries, catalog, lessons, docs)', () => {
    const files: string[] = []
    const walk = (dir: string, ok: (f: string) => boolean) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) walk(p, ok)
        else if (ok(p)) files.push(p)
      }
    }
    for (const d of ['src/sim/erc', 'src/i18n', 'src/model', 'src/lessons', 'src/instruments', 'src/ui']) walk(path.join(ROOT, d), (f) => /\.tsx?$/.test(f))
    walk(path.join(ROOT, 'docs'), (f) => f.endsWith('.md') && !f.includes(`${path.sep}ux${path.sep}`))
    const hits = files.filter((f) => OLD_RULE.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))
    expect(hits).toEqual([])
    expect(OLD_RULE.test('超過 30 mA 達 1 ms 以上')).toBe(true)
    expect(OLD_RULE.test('over 30 mA for more than 1 ms')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// truth — the raw ERC rows on the one brightness scale
// ---------------------------------------------------------------------------

describe('the LED finding quotes the brightness on the app’s one scale (I / 20 mA)', () => {
  it('150 Ω (≈ 21 mA): the raw message already reads the inspector’s percent — Problems’ rescaling changes nothing', () => {
    const l = ledBoard(150)
    const sim = simulate(l)
    const tele = sim.telemetry.components.LED1
    const pct = fmtLight(tele.light)
    expect(pct).toMatch(/^10\d %$/)
    const f = ofRule(runErc(l, sim), 'led-current')[0]
    expect(f.message).toContain(`right now (brightness ${pct}).`)
    // the old I / 10 mA scale (ledBrightness, clamped at 100 %) never shows
    expect(f.message).not.toMatch(/brightness 100 %/)
    expect(ledFindingMessage(f, sim.telemetry)).toBe(f.message)
    expect(zh(f.message)).toContain(`（亮度 ${pct}）。`)
  })

  it('below 10 % the inspector prints one decimal, which the sentence cannot carry: the current alone is quoted', () => {
    const l = ledBoard(100)
    const sim = simulate(l)
    sim.telemetry.components.LED1 = { ...sim.telemetry.components.LED1, current: 0.0015, light: 0.075, ledBrightness: 0.15 }
    const f = ofRule(runErc(l, sim), 'led-current')[0]
    expect(f.message).toMatch(/The simulation measures 1\.50 mA through it right now\./)
    expect(f.message).not.toMatch(/brightness/)
    expect(zh(f.message)).toContain('模擬目前量測到流經它的電流為 1.50 mA。')
  })

  it('telemetry light, not ledBrightness: 0.5 of 20 mA reads 50 %, never the old 100 %', () => {
    const l = ledBoard(100)
    const sim = simulate(l)
    sim.telemetry.components.LED1 = { ...sim.telemetry.components.LED1, current: 0.01, light: 0.5, ledBrightness: 1 }
    const f = ofRule(runErc(l, sim), 'led-current')[0]
    expect(f.message).toContain('measures 10.0 mA through it right now (brightness 50 %).')
  })
})

// ---------------------------------------------------------------------------
// P1 — one rounding on every surface
// ---------------------------------------------------------------------------

/** The percent at the start of a brightness text 「49 %（9.70 mA）」 → 「49 %」. */
const pctOf = (s: string) => /^(< )?\d+(?:\.\d)? %/.exec(s)?.[0] ?? s

describe('P1: the same LED reads the same percent on every surface', () => {
  it('fmtLight rounds from thousandths, half up: an averaged 0.48499999… and the telemetry’s 0.485 both read 49 %', () => {
    expect(0.48499999999999993).not.toBe(0.485)
    expect(fmtLight(0.485)).toBe('49 %')
    expect(fmtLight(0.48499999999999993)).toBe('49 %')
    expect(fmtLight(0.145)).toBe('15 %') // 0.145 × 100 = 14.499999999999998
    expect(fmtLight(0.0035)).toBe('0.4 %')
    expect(fmtLight(0.0001)).toBe('< 0.1 %')
    expect(fmtLight(0.0995)).toBe('10 %')
    expect(fmtLight(1.005)).toBe('101 %')
    expect(isOverRated(1.005)).toBe(true) // printed 101 % → said to be over the rating
    expect(isOverRated(1.004)).toBe(false)
  })

  it('a sweep 0.05 – 40 mA: 3D label = inspector = lesson acceptance = ERC sentence', () => {
    const rated = 0.02
    for (let uA = 50; uA <= 40_000; uA += uA < 2000 ? 7 : 61) {
      const i = uA * 1e-6
      const light = roundLight(i / rated) // what the LED model publishes
      // 3D label (src/three/scene.ts live LED labels): `${id} ${fmtLedLight(light, current)}`
      const label = fmtLedLight(light, i)
      // inspector (PropertiesSheet 亮度): ledLightParts
      const insp = ledLightParts(light, i, { rated })
      // lesson acceptance (evaluate.ts): the mean of 200 samples of the same telemetry
      const mean = sampleStats(Array<number>(200).fill(light)).mean
      const iMean = sampleStats(Array<number>(200).fill(i)).mean
      const accept = fmtLedLight(mean, iMean, { rated })
      expect(pctOf(insp.value), `${uA} µA`).toBe(pctOf(label))
      expect(pctOf(accept), `${uA} µA (mean ${mean})`).toBe(pctOf(label))
      expect(insp.over !== null, `${uA} µA`).toBe(label.includes('超過額定'))
      expect(accept.includes('超過額定'), `${uA} µA`).toBe(label.includes('超過額定'))
    }
  })

  it('b1 with the textbook 330 Ω: 49 %（9.70 mA） on the label, in the inspector, in the acceptance and in the lesson text', { timeout: 120_000 }, async () => {
    // the lesson's own answer circuit (330 Ω)
    const b1 = lessonById('b1-led-resistor')!
    const solution = structuredClone(b1.solution!)
    const sol = solution.layout as CircuitLayout
    const r = sol.components.find((c) => c.type === 'resistor')!
    expect(r.params?.resistance).toBe(330 as ParamValue)
    const telemetry = simulate(sol, 0.2).telemetry
    const tele = telemetry.components.LED1
    expect(tele.light).toBe(0.485)
    // 3D label
    const shown = fmtLedLight(tele.light, tele.current)
    expect(shown).toBe('49 %（9.70 mA）')
    // inspector
    useStore.setState({ layout: sol, selection: ['LED1'], telemetry })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(text(html)).toContain(`亮度 ${shown}`)
    // acceptance (b1 「LED1 正常發光」)
    const check = b1.acceptance.find((c) => c.kind === 'measure' && c.quantity === 'led-brightness') as Extract<LessonCheck, { kind: 'measure' }>
    const [res] = await evaluateChecks(await lessonCircuitInput(solution), [check])
    expect(res.pass).toBe(true)
    expect(res.detail).toContain(`量測值 ${shown}（`)
    // the averaging window's min / max use the same rounding — never 「49 %」 beside 「最大 48.5 %」
    const spread = /（最小 ([^，]+)，最大 ([^）]+)）/.exec(res.detail)
    if (spread) {
      expect(spread[1]).toMatch(/^\d+ %$/)
      expect(spread[2]).toMatch(/^\d+ %$/)
      expect(parseInt(spread[2], 10)).toBeGreaterThanOrEqual(parseInt(shown, 10))
    }
    expect(res.detail).not.toMatch(/最[小大] \d+\.\d %/)
    // the lesson's own expected result says the same number
    expect(b1.expected.join('\n')).toContain('亮度約 49 %（以額定 20 mA 為 100 %）')
    expect(b1.expected.join('\n')).not.toContain('亮度約 48 %')
  })

  it('an acceptance window over a blinking LED prints its min / max with the same rounding as the value', { timeout: 120_000 }, async () => {
    // a 10 Hz square wave 0 – 5 V through 330 Ω: the 0.2 – 0.4 s window sees the LED off and on
    const layout: CircuitLayout = {
      version: 1,
      name: 'blink',
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 10, amplitude: 2.5, offset: 2.5 } },
        { id: 'R1', type: 'resistor', holes: ['b10', 'b14'], params: { resistance: 330 } },
        { id: 'LED1', type: 'led', holes: ['c14', 'c16'], params: { color: 'red' } },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'top+0' },
        { id: 'W2', from: 'PS1:-', to: 'top-0' },
        { id: 'W3', from: 'FG1:gnd', to: 'top-1' },
        { id: 'W4', from: 'FG1:out', to: 'a10' },
        { id: 'W5', from: 'a16', to: 'top-13' },
      ],
    } as CircuitLayout
    const check: LessonCheck = {
      kind: 'measure',
      at: { component: 'LED1', pin: 'anode' },
      quantity: 'led-brightness',
      component: 'LED1',
      min: 0,
      max: 150,
      seconds: 0.4,
      fresh: true,
    }
    const [res] = await evaluateChecks(await lessonCircuitInput({ layout }), [check])
    const spread = /（最小 ([^，]+)，最大 ([^）]+)）/.exec(res.detail)
    expect(spread, res.detail).not.toBeNull()
    expect(spread![1]).toBe('0 %')
    // ≈ 8.4 mA on the high half (the generator's 50 Ω output in series): a whole percent, as the value
    // and the inspector print it — 「42.1 %」 before the fix
    expect(spread![2]).toMatch(/^\d+ %$/)
    expect(parseInt(spread![2], 10)).toBeGreaterThan(30)
    const value = /量測值 ([\d.]+ %)/.exec(res.detail)![1]
    expect(value).toMatch(/^\d+ %$/) // the mean, whole percent from 10 % up
  })
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

// ---------------------------------------------------------------------------
// catalog honesty texts
// ---------------------------------------------------------------------------

describe('catalog honesty texts say what the models do', () => {
  const both = (type: string) => {
    const entry = CATALOG[type]
    __setLangForTests('zh-TW')
    const z = partSupport(entry)
    return { en: supportOf(entry), zh: z }
  }

  it('RGB LED: 20 mA = 100 % (the one scale), burns above 150 mA for 1 ms, the perceptual look, no thermal model', () => {
    const { en, zh: z } = both('rgb_led')
    const enText = [...(en.simulated ?? []), ...(en.limits ?? [])].join('\n')
    const zhText = [...(z.simulated ?? []), ...(z.limits ?? [])].join('\n')
    expect(enText).toContain('/ the rated 20 mA (100 % at 20 mA')
    expect(enText).toContain(`above ${LED_PEAK_CURRENT * 1000} mA (its peak rating) for more than ${LED_PEAK_TIME * 1000} ms`)
    expect(zhText).toContain('亮度 = 各晶粒電流 ÷ 額定 20 mA（20 mA 時 100 %')
    expect(zhText).toContain('晶粒電流超過 150 mA（峰值額定）達 1 ms 以上即燒毀')
    expect(zhText).toContain('依人眼的感受發光')
    expect(zhText).toContain('沒有接面溫度模型')
    for (const s of [enText, zhText]) {
      expect(s).not.toMatch(/30 mA|full at 10 mA|10 mA 時全亮|eye-sensitivity|人眼感光曲線/)
    }
  })

  it('the 5 mm LED states its 3D look on the same scale (dark at 0, a glow from about 0.5 mA, dazzling at 20 mA)', () => {
    const { en, zh: z } = both('led')
    expect(en.simulated?.[1]).toMatch(/current \/ its rated 20 mA/)
    expect(en.simulated?.some((s) => /3D look .*about 0\.5 mA.*20 mA/.test(s))).toBe(true)
    expect(z.simulated?.some((s) => s.startsWith('3D 外觀依人眼的感受呈現這個亮度：0 mA 全暗，約 0.5 mA 起'))).toBe(true)
  })

  it('every legacy chip says plainly that a bench supply’s reading leaves out its output current (Option 1)', () => {
    const legacy = ['ne555', 'lm358', 'sn7400', 'sn7404', 'sn7408', 'sn7432', 'sn7486', 'sn7474', 'cd4017', 'cd4026', 'cd4511', 'sn74193', 'cd4040']
    for (const type of legacy) {
      const { en, zh: z } = both(type)
      expect(en.limits?.some((s) => /bench supply’s own current reading leaves out the current these outputs drive/.test(s)), type).toBe(true)
      expect(
        z.limits?.some((s) => s.startsWith('電源供應器自己的電流讀數不含這些輸出驅動的電流') && s.includes('「顯示電流」')),
        type,
      ).toBe(true)
    }
    const ps = both('power_supply')
    expect(ps.en.limits?.some((s) => /leaves out the output current of the behavioral chips/.test(s))).toBe(true)
    expect(ps.zh.limits?.some((s) => s.startsWith('電流讀數不含行為模型晶片（555、74xx、CD40xx、LM358）輸出的電流'))).toBe(true)
  })

  it('the pushbutton uses the inspector’s and the lessons’ words in zh-TW; the English (classic chrome) line is unchanged', () => {
    const { en, zh: z } = both('pushbutton')
    expect(z.simulated?.[1]).toBe('執行中可按住，或雙擊／打開「保持按下」讓它一直按著')
    expect(z.simulated?.[1]).toContain(`「${t('Keep pressed|latch')}」`)
    expect(en.simulated?.[1]).toBe('pressed state changeable while running')
  })

  it('the KY-040 and joystick name their push switch 「按鈕（SW）」 (the row the keep-pressed switch sits on)', () => {
    expect(partTranslation('ky040_encoder')?.params?.pressed).toBe('按鈕（SW）')
    expect(partTranslation('joystick_xy')?.params?.pressed).toBe('按鈕（SW）')
  })

  it('the over-rating rule: no longer "(live)" — a reversed electrolytic across two rails is an error before Run', () => {
    const rule = ERC_RULES.find((r) => r.id === 'over-rating')!
    expect(rule.title).toBe('Over rating')
    expect(rule.levels.error).toMatch(/before Run, a polarized capacitor sits reversed by more than 1 V between two rails/)
    __setLangForTests('zh-TW')
    expect(t(rule.title)).toBe('超出額定')
    expect(t(rule.levels.error!)).toContain('有極性（電解）電容反接在兩條電源軌之間超過 1 V')
    expect(englishLeft(t(rule.levels.error!))).toEqual([])
    // and that finding is filed under this rule, with no simulation at all
    const l = valid(
      railsWorld([part('C1', 'capacitor', ['top-20', 'top+21'], { capacitance: 1e-4, polarized: true })]),
    )
    const f = runErc(l).filter((x) => x.rule === 'over-rating')
    expect(f.map((x) => [x.level, x.fact]), summary(f)).toEqual([['error', 'reversed:C1']])
    expect(tMessage(f[0].short!)).toBe('C1 電解電容接反了')
  })
})
