/**
 * fix4 lessons — what the lessons and the lesson checks print agrees with
 * the simulator:
 *  - LES-3: the brightness check of an LED that was burned out for the whole
 *    sample window prints 「0 %（已燒毀）」 / "0 % (burned out)" — the
 *    inspector's words — never 「0 %（0 A）」;
 *  - LES-4: every number in b1's and b4's texts is the one the simulator
 *    measures for the circuit the text describes (10 kΩ: ≈ 0.34 mA, 1.7 %,
 *    (5 − 1.62) ÷ 10 kΩ; the new 1 kΩ resistor: ≈ 3.3 mA; …);
 *  - UI-6: no lesson / example text tells the learner which wire colour to
 *    pick (the product chrome colours wires itself: SDA blue, SCL yellow,
 *    TX green, RX white, PWM orange, supply red, ground black).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { LESSONS, lessonById } from '../src/lessons'
import { evaluateChecks, lessonCircuitInput } from '../src/lessons/engine/evaluate'
import { resolvePinRef } from '../src/lessons/engine/refs'
import type { Lesson, LessonCircuit, PinRef } from '../src/lessons/types'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { fmtLight } from '../src/instruments/led-light'
import type { CircuitLayout, ParamValue } from '../src/model/types'

const LONG = { timeout: 300_000 }
const b1 = (): Lesson => lessonById('b1-led-resistor')!
const b4 = (): Lesson => lessonById('b4-button-debounce')!

beforeEach(() => {
  __setLangForTests('zh-TW')
})

function withParams(layout: CircuitLayout, set: Record<string, Record<string, ParamValue>>): CircuitLayout {
  return {
    ...layout,
    components: layout.components.map((c) => (set[c.id] ? { ...c, params: { ...(c.params ?? {}), ...set[c.id] } } : c)),
  }
}

/** A simulated world of `layout` from power-on (the coordinator the lesson checks use). */
function world(layout: CircuitLayout) {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  const to = (t: number) => {
    while (co.time < t - 1e-12) co.advance(Math.min(0.0001, t - co.time))
  }
  const v = (ref: PinRef) => {
    const r = resolvePinRef(layout, ref)
    if (!r.ok) throw new Error(`unresolved ${JSON.stringify(ref)}`)
    return co.engine?.netVoltage(r.endpoint) ?? NaN
  }
  const tel = (id: string) => co.telemetry().components[id]
  return { co, to, v, tel }
}

/** b1 with R1 = `ohms`, settled: the LED's current, brightness and V_F, R1's voltage, the meter's reading. */
function b1At(ohms: number) {
  const w = world(withParams(b1().solution.layout, { R1: { resistance: ohms } }))
  w.to(0.05)
  const led = w.tel('LED1')!
  const anode = w.v({ component: 'LED1', pin: 'anode' })
  const vf = anode - w.v({ component: 'LED1', pin: 'cathode' })
  const vr = w.v({ hole: 'top+10' }) - anode
  const meter = (w.tel('DMM1')?.values as Record<string, number> | undefined)?.reading ?? NaN
  const out = { i: Math.abs(led.current ?? NaN), light: led.light as number, vf, vr, meter }
  w.co.dispose()
  return out
}

const mA = (i: number, digits: number) => (i * 1000).toFixed(digits)
const allText = (l: Lesson) =>
  [
    l.title,
    l.summary,
    ...l.objectives,
    l.wiring,
    l.theory,
    ...l.expected,
    ...l.mistakes.flatMap((m) => [m.symptom, m.cause, m.fix]),
    ...l.steps.flatMap((s) => [s.title, s.body]),
    l.runnableNote ?? '',
  ].join('\n')

describe('LES-3: a burned-out LED’s brightness check says so, as the inspector does', () => {
  /** b1 with a 1 Ω "current limiter": the LED burns out within the first millisecond. */
  const burnt = (): LessonCircuit => ({ ...b1().solution, layout: withParams(b1().solution.layout, { R1: { resistance: 1 } }) })
  const brightness = () => b1().acceptance.find((c) => c.kind === 'measure' && c.quantity === 'led-brightness')!

  it('zh-TW: 「量測值 0 %（已燒毀）」, never 「0 %（0 A）」', LONG, async () => {
    const [res] = await evaluateChecks(await lessonCircuitInput(burnt()), [brightness()])
    expect(res.pass).toBe(false)
    expect(res.detail).toContain('量測值 0 %（已燒毀）')
    expect(res.detail).not.toContain('0 A')
  })

  it('English: "Measured 0 % (burned out)"', LONG, async () => {
    __setLangForTests('en')
    const [res] = await evaluateChecks(await lessonCircuitInput(burnt()), [brightness()])
    expect(res.detail).toContain('0 % (burned out)')
    expect(res.detail).not.toContain('0 A')
  })

  it('a lit LED keeps its brightness with its current (330 Ω: 「49 %（9.70 mA）」-style)', LONG, async () => {
    const [res] = await evaluateChecks(await lessonCircuitInput(b1().solution), [brightness()])
    expect(res.pass).toBe(true)
    expect(res.detail).not.toContain('已燒毀')
    expect(res.detail).toMatch(/量測值 49 %（9\.\d+ mA）/)
  })
})

describe('LES-4: b1’s numbers are the simulator’s', () => {
  it('330 Ω (the solution): 9.7 mA, 49 %, DMM1 1.80 V, R1 3.20 V and 31 mW, the LED 17 mW', () => {
    const l = b1()
    const s = b1At(330)
    expect(l.expected[0]).toContain(`約 ${mA(s.i, 1)} mA`)
    expect(l.expected[0]).toContain(`亮度約 ${fmtLight(s.light)}`)
    expect(l.expected[1]).toContain(`約 ${s.meter.toFixed(2)} V`)
    expect(l.expected[2]).toContain(`約 ${s.vr.toFixed(2)} V`)
    expect(l.expected[2]).toContain(`約 ${mA(s.vr * s.i, 0)} mW`)
    expect(l.theory).toContain(`≈ ${mA(s.vf * s.i, 0)} mW`)
    for (const step of l.steps.filter((x) => x.id === 'b1-s5' || x.id === 'b1-s6')) expect(step.body).toContain(`${mA(s.i, 1)} mA`)
  })

  it('220 Ω / 560 Ω: the two currents of 「換成 220 Ω … 560 Ω」', () => {
    const l = b1()
    const lo = b1At(220)
    const hi = b1At(560)
    expect(l.expected[3]).toContain(`換成 220 Ω：約 ${mA(lo.i, 1)} mA；換成 560 Ω：約 ${mA(hi.i, 1)} mA`)
    expect(l.steps.find((x) => x.id === 'b1-s5')!.body).toContain(`電流分別約 ${mA(lo.i, 1)} mA 與 ${mA(hi.i, 1)} mA`)
    // the theory's 「電壓每多約 0.06 V，電流就變成約 3 倍」: the model's own slope between the two
    const per60mV = Math.exp((Math.log(lo.i / hi.i) / (lo.vf - hi.vf)) * 0.06)
    expect(Math.round(per60mV)).toBe(3)
    expect(l.theory).toContain('電壓每多約 0.06 V，電流就變成約 3 倍')
  })

  it('10 kΩ (the dim-LED mistake): ≈ 0.34 mA, 1.7 %, (5 − 1.62) ÷ 10 kΩ — what the check prints right above it', LONG, async () => {
    const l = b1()
    const s = b1At(10_000)
    const dim = l.mistakes.find((m) => m.symptom.includes('10 kΩ'))!
    expect(dim.symptom).toContain(`10 kΩ 時只有約 ${mA(s.i, 2)} mA、亮度約 ${fmtLight(s.light)}`)
    expect(dim.cause).toContain(`(5 − ${s.vf.toFixed(2)}) ÷ 10 kΩ ≈ ${mA(s.i, 2)} mA`)
    expect(mA(s.i, 2)).toBe('0.34')
    expect(fmtLight(s.light)).toBe('1.7 %')
    // the acceptance's brightness check on the same circuit (the line above 最可能的原因)
    const circuit: LessonCircuit = { ...l.solution, layout: withParams(l.solution.layout, { R1: { resistance: 10_000 } }) }
    const check = l.acceptance.find((c) => c.kind === 'measure' && c.quantity === 'led-brightness')!
    const [res] = await evaluateChecks(await lessonCircuitInput(circuit), [check])
    expect(res.detail).toContain(`量測值 ${fmtLight(s.light)}（`)
  })

  it('a new resistor’s 1 kΩ: ≈ 3.3 mA', () => {
    const s = b1At(1000)
    expect(b1().mistakes.find((m) => m.symptom.includes('10 kΩ'))!.cause).toContain(`預設 1 kΩ（約 ${mA(s.i, 1)} mA）`)
  })

  it('100 Ω / 150 Ω / 180 Ω: the model’s V_F and currents of the other mistake rows', () => {
    const l = b1()
    const r100 = b1At(100)
    const r150 = b1At(150)
    const r180 = b1At(180)
    const text = l.mistakes.map((m) => `${m.symptom}\n${m.cause}`).join('\n')
    expect(text).toContain(`(5 − ${r100.vf.toFixed(2)}) ÷ 100 ≈ ${mA(r100.i, 0)} mA`)
    expect(text).toContain(`(5 − ${r150.vf.toFixed(2)}) ÷ 150 ≈ ${mA(r150.i, 0)} mA`)
    expect(text).toContain(`LED 電流約 ${mA(r150.i, 0)} mA`)
    expect(text).toContain(`(5 − ${r180.vf.toFixed(2)}) ÷ 180 ≈ ${mA(r180.i, 1)} mA`)
    expect(text).toContain(`180 Ω 時約 ${mA(r180.i, 1)} mA、亮度約 ${fmtLight(r180.light)}`)
  })
})

describe('LES-4: b4’s numbers are the simulator’s', () => {
  /** b4 with SW1 held and R1 = `ohms`: the LED's current and brightness. */
  function ledAt(ohms: number) {
    const w = world(withParams(b4().solution.layout, { R1: { resistance: ohms }, SW1: { pressed: true } }))
    w.to(0.05)
    const led = w.tel('LED1')!
    const out = { i: Math.abs(led.current ?? NaN), light: led.light as number }
    w.co.dispose()
    return out
  }

  it('SW1 held: ≈ 9.7 mA with 330 Ω; the 10 kΩ mistake: ≈ 0.34 mA, 1.7 %, (5 − 1.62) ÷ 10 kΩ', () => {
    const l = b4()
    const ok = ledAt(330)
    expect(l.expected[0]).toContain(`電流約 ${mA(ok.i, 1)} mA`)
    expect(l.objectives.join('\n')).toContain(`按下時約 ${mA(ok.i, 1)} mA`)
    expect(l.steps.find((x) => x.id === 'b4-s3')!.body).toContain(`電流約 ${mA(ok.i, 1)} mA`)
    const dim = ledAt(10_000)
    const row = l.mistakes.find((m) => m.cause.includes('10 kΩ'))!
    expect(row.symptom).toContain(`亮度約 ${fmtLight(dim.light)}，電流約 ${mA(dim.i, 2)} mA`)
    expect(row.cause).toContain(`÷ 10 kΩ ≈ ${mA(dim.i, 2)} mA`)
    expect(row.cause).toContain('(5 − 1.62)')
    expect(mA(dim.i, 2)).toBe('0.34')
    expect(fmtLight(dim.light)).toBe('1.7 %')
  })

  it('the RC debounce: 5.00 V released, 1.84 V 10 ms after a press, < 1.5 V after ≈ 12 ms, X ≈ 2.5 V on release, 3.16 V after 20 ms, 3.5 V after ≈ 24 ms, 0.5 mA in R2', () => {
    const l = b4()
    const w = world(l.solution.layout)
    const X: PinRef = { component: 'SW2', pin: 'A1' }
    const Y: PinRef = { component: 'C1', pin: 'p1' }
    w.to(0.3)
    expect(w.v(X).toFixed(2)).toBe('5.00')
    expect(w.v(Y).toFixed(2)).toBe('5.00')
    expect(l.expected[1]).toContain('5.00 V')
    // press SW2
    const tp = w.co.time
    w.co.setRuntimeParam('SW2', 'pressed', true)
    w.to(tp + 0.01)
    const y10 = w.v(Y)
    let below = NaN
    while (w.co.time < tp + 0.05) {
      w.to(w.co.time + 0.0001)
      if (Number.isNaN(below) && w.v(Y) < 1.5) below = w.co.time - tp
    }
    w.to(tp + 0.2)
    const r2 = Math.abs(w.tel('R2')?.current ?? NaN)
    expect(l.expected[2]).toContain(`10 ms 後約 ${y10.toFixed(2)} V`)
    expect(l.expected[2]).toContain(`約 ${(below * 1000).toFixed(0)} ms 後低於 1.5 V`)
    expect(l.steps.find((x) => x.id === 'b4-s6')!.body).toContain(`降到 ${y10.toFixed(2)} V`)
    expect(l.theory).toContain(`≈ ${(below * 1000).toFixed(0)} ms`)
    expect(l.steps.find((x) => x.id === 'b4-s4')!.body).toContain(`= ${mA(r2, 1)} mA`)
    // release
    const tr = w.co.time
    w.co.setRuntimeParam('SW2', 'pressed', false)
    w.to(tr + 0.0002)
    const xJump = w.v(X)
    w.to(tr + 0.02)
    const y20 = w.v(Y)
    let above = NaN
    while (w.co.time < tr + 0.06) {
      w.to(w.co.time + 0.0001)
      if (Number.isNaN(above) && w.v(Y) > 3.5) above = w.co.time - tr
    }
    w.co.dispose()
    expect(l.expected[3]).toContain(`X 點先跳到約 ${xJump.toFixed(1)} V`)
    expect(l.expected[3]).toContain(`20 ms 後 Y 點約 ${y20.toFixed(2)} V`)
    expect(l.theory).toContain(`≈ ${(above * 1000).toFixed(0)} ms`)
  })
})

describe('UI-6: no text tells the learner a wire colour to pick (the product chrome colours wires itself)', () => {
  // 「建議用綠色線」, 「用黃色導線」, 「紅色跳線」… — a meter's 「紅色測試線」 is the meter's own lead, not a pick
  const COLOUR_PICK = /[紅黑綠藍黃白橘橙紫灰棕粉]色(的)?(導|跳)?線|建議用.{0,4}色|\b(use|pick|choose) an? \w+ (wire|jumper)\b|\b(red|black|green|blue|yellow|white|orange) (wire|jumper)\b/i

  it('a1 wires SCL / SDA without a colour (SDA is drawn blue, green means UART TX)', () => {
    const a1 = lessonById('a1-mpu6050')!
    expect(a1.wiring).toContain('SCL：`j42` → `j23`')
    expect(a1.wiring).toContain('SDA：`j43` → `j24`')
    expect(a1.wiring).not.toMatch(COLOUR_PICK)
  })

  it('no lesson text', () => {
    for (const l of LESSONS) expect(allText(l), l.id).not.toMatch(COLOUR_PICK)
  })

  it('no example text', () => {
    const root = path.resolve(__dirname, '..')
    const index = readFileSync(path.join(root, 'examples/embedded/index.json'), 'utf8')
    expect(index).not.toMatch(COLOUR_PICK)
  })
})
