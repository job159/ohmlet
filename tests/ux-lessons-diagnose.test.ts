/**
 * UX wave WS3 — "root cause first" (LS-5), through the REAL evaluator
 * (src/lessons/engine/evaluate.ts) and the real ERC (static rules, as the
 * lesson view runs it while the simulation is stopped):
 *  - b1 and i1 broken circuits name the right common mistake (LED reversed,
 *    LED shorted, no / too small resistor, wrong resistor, cathode not
 *    grounded; no firmware, wrong pin, LED reversed, no resistor);
 *  - ERC findings about the failing checks' parts come first, most severe
 *    first (the reversed LED names LED1 and the swap fix);
 *  - measure checks that fail because of a structural failure fold away;
 *  - an empty board / a foreign circuit reads "load the start circuit";
 *  - measured values print as the instruments print them (H3), never "≈ 0"
 *    for a frequency / duty; "≈ 0 mA" only below 1 µA, never pA (LS-10).
 */
import { describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { lessonById } from '../src/lessons'
import type { Lesson, LessonCircuit } from '../src/lessons/types'
import type { CircuitLayout, ParamValue } from '../src/model/types'
import { evaluateLesson, type EvaluatedCheck } from '../src/lessons/engine/evaluate'
import { fmtMeasured, fmtQuantity, fmtRange } from '../src/lessons/engine/format'
import { fmtCurrent, fmtFreq, fmtPercent, fmtVoltage } from '../src/instruments/format'
import { dependentFailures, findingMatches, matchMistake, missingStartParts, referencedParts, relatedFindings } from '../src/lessons/diagnose'
import { runErc } from '../src/sim/erc'

const LONG = { timeout: 300_000 }
const lesson = (id: string): Lesson => lessonById(id)!

function edit(c: LessonCircuit, fn: (l: CircuitLayout) => CircuitLayout): LessonCircuit {
  return { ...c, layout: fn(JSON.parse(JSON.stringify(c.layout)) as CircuitLayout) }
}
const setParam = (id: string, key: string, value: ParamValue) => (l: CircuitLayout) => ({
  ...l,
  components: l.components.map((c) => (c.id === id ? { ...c, params: { ...c.params, [key]: value } } : c)),
})
const moveHoles = (id: string, holes: string[]) => (l: CircuitLayout) => ({
  ...l,
  components: l.components.map((c) => (c.id === id ? { ...c, holes } : c)),
})
const dropWireAt = (end: string) => (l: CircuitLayout) => ({ ...l, wires: l.wires.filter((w) => w.from !== end && w.to !== end) })
const moveWireEnd = (from: string, to: string) => (l: CircuitLayout) => ({
  ...l,
  wires: l.wires.map((w) => (w.from === from ? { ...w, from: to } : w.to === from ? { ...w, to } : w)),
})

/** Evaluate the lesson's acceptance on `circuit` and diagnose it like the UI does. */
async function diagnose(l: Lesson, circuit: LessonCircuit) {
  const ev = await evaluateLesson(l, circuit)
  const findings = runErc(circuit.layout)
  return {
    results: ev.results,
    mistake: matchMistake(l, ev.results, findings),
    related: relatedFindings(findings, ev.results),
    dependents: dependentFailures(l.acceptance, ev.results),
  }
}

const fails = (results: EvaluatedCheck[]) => results.filter((r) => !r.pass).map((r) => r.key)

describe('b1: the likely cause of each documented mistake', () => {
  const b1 = lesson('b1-led-resistor')
  const symptom = (i: number) => b1.mistakes[i].symptom

  it('LED reversed: the ERC names LED1 and the swap; the mistake matches; measurements fold away', LONG, async () => {
    __setLangForTests('zh-TW')
    const d = await diagnose(b1, edit(b1.solution, moveHoles('LED1', ['c16', 'c14'])))
    expect(d.mistake?.symptom).toBe(symptom(0))
    expect(d.related[0]?.componentIds).toContain('LED1')
    expect(findingMatches(d.related[0], 'led-current:reversed')).toBe(true)
    expect(tMessage(d.related[0].message)).toMatch(/LED1/)
    // the current / brightness checks fail only because the wiring does
    // (check 5, 「ERC 沒有錯誤或風險」, also fails once the ERC flags the reversed LED itself — IN-17)
    expect(fails(d.results).filter((k) => k !== '5')).toEqual(['1', '2', '3', '4'])
    expect([...d.dependents].sort()).toEqual(['3', '4'])
  })

  it('LED legs in one strip → shorted', LONG, async () => {
    const d = await diagnose(b1, edit(b1.solution, moveHoles('LED1', ['c14', 'd14'])))
    expect(d.mistake?.symptom).toBe(symptom(1))
  })

  it('100 Ω burns the LED; 150 Ω is above the rating; 10 kΩ is too dim', LONG, async () => {
    expect((await diagnose(b1, edit(b1.solution, setParam('R1', 'resistance', 100)))).mistake?.symptom).toBe(symptom(2))
    expect((await diagnose(b1, edit(b1.solution, setParam('R1', 'resistance', 150)))).mistake?.symptom).toBe(symptom(3))
    expect((await diagnose(b1, edit(b1.solution, setParam('R1', 'resistance', 10000)))).mistake?.symptom).toBe(symptom(4))
  })

  it('cathode not grounded', LONG, async () => {
    const d = await diagnose(b1, edit(b1.solution, dropWireAt('a16')))
    expect(fails(d.results)).toContain('2')
    expect(d.mistake?.symptom).toBe(symptom(5))
  })

  it('the solution passes: no diagnosis', LONG, async () => {
    const d = await diagnose(b1, b1.solution)
    expect(d.mistake).toBeNull()
    expect(d.dependents.size).toBe(0)
  })

  it('the start circuit is not misdiagnosed as a specific mistake', LONG, async () => {
    const d = await diagnose(b1, b1.start)
    expect(d.mistake).toBeNull()
  })
})

describe('i1: no firmware, wrong pin, LED reversed, no resistor', () => {
  const i1 = lesson('i1-gpio-output')
  const bySymptom = (s: string) => i1.mistakes.findIndex((m) => m.symptom === s)

  it('the start circuit (no firmware, no wire) points at the firmware first', LONG, async () => {
    const d = await diagnose(i1, i1.start)
    expect(d.mistake && bySymptom(d.mistake.symptom)).toBe(0)
  })

  it('PA5 wired to PA6 instead → the wrong-pin mistake', LONG, async () => {
    const d = await diagnose(i1, edit(i1.solution, moveWireEnd('a20', 'a19')))
    expect(d.results[0].pass).toBe(true)
    expect(d.mistake?.fix).toContain('a20')
  })

  it('LED1 reversed → the reversed-LED mistake', LONG, async () => {
    const d = await diagnose(i1, edit(i1.solution, moveHoles('LED1', ['top-32', 'b40'])))
    expect(d.mistake?.cause).toContain('LED 插反了')
  })

  it('R1 replaced by a wire → the missing-resistor mistake', LONG, async () => {
    const d = await diagnose(
      i1,
      edit(i1.solution, (l) => ({
        ...l,
        components: l.components.filter((c) => c.id !== 'R1'),
        wires: [...l.wires, { id: 'wr', from: 'a36', to: 'a40' }],
      })),
    )
    expect(d.mistake?.cause).toContain('少了限流電阻')
  })
})

describe('i2: both wires on one side of the button', () => {
  it('PB12 grounded through A1/A2 → the same-side mistake', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const d = await diagnose(i2, edit(i2.solution, moveWireEnd('j47', 'i45')))
    expect(d.mistake?.symptom).toBe(i2.mistakes[1].symptom)
    // the solution itself is not diagnosed
    expect((await diagnose(i2, i2.solution)).mistake).toBeNull()
  })
})

describe('missing start circuit', () => {
  it('names the parts the acceptance checks need and flags a board without them', () => {
    const b1 = lesson('b1-led-resistor')
    expect(referencedParts(b1).sort()).toEqual(['LED1', 'PS1'])
    expect(missingStartParts(b1, { version: 1, components: [], wires: [] })).toMatchObject({ mostlyMissing: true, total: 2 })
    expect(missingStartParts(b1, b1.start.layout).mostlyMissing).toBe(false)
    const i1 = lesson('i1-gpio-output')
    expect(referencedParts(i1).sort()).toEqual(['LED1', 'PS1', 'U1'])
    // another lesson's circuit on the board
    expect(missingStartParts(i1, b1.solution.layout).mostlyMissing).toBe(true)
  })
})

describe('measured values in the one app format (H3), never ≈ 0 for a non-zero value (LS-10)', () => {
  it('H3 numbers; only a current below 1 µA or a voltage below 5 mV reads ≈ 0, in the unit of the range', () => {
    __setLangForTests('zh-TW')
    expect(fmtMeasured('current', 7.6e-18, 0.005, 0.015)).toBe('≈ 0 mA')
    expect(fmtMeasured('current', 7.6e-12, 5e-3, 15e-3)).toBe('≈ 0 mA')
    expect(fmtMeasured('current', 0.0097, 0.005, 0.015)).toBe('9.70 mA')
    expect(fmtMeasured('current', 0.00032, 0.005, 0.015)).toBe('320 µA')
    expect(fmtMeasured('current', 0.032, 0.005, 0.015)).toBe('32.0 mA')
    expect(fmtMeasured('current', 2.1, 0.005, 0.015)).toBe('> 2 A（短路）')
    expect(fmtMeasured('voltage', 1.7981, 1.7, 1.9)).toBe('1.80 V')
    expect(fmtMeasured('voltage', 0.12, 0, 0.4)).toBe('120 mV')
    expect(fmtMeasured('voltage', 1e-9, 0, 0.4)).toBe('≈ 0 mV')
    expect(fmtMeasured('voltage', 0.0001, 3, 3.6)).toBe('≈ 0 V')
    expect(fmtMeasured('voltage', -1261957.64, 3, 3.6)).toBe('—') // a solver artefact is never a reading
    expect(fmtMeasured('frequency', 0.998, 0.95, 1.05)).toBe('0.998 Hz')
    expect(fmtMeasured('frequency', 0, 0.95, 1.05)).toBe('0 Hz')
    expect(fmtMeasured('frequency', 492.66, 495, 505)).toBe('492.7 Hz')
    expect(fmtMeasured('duty', 0.625, 45, 55)).toBe('62.5 %')
    expect(fmtMeasured('duty', 0.004, 45, 55)).toBe('0.4 %')
    expect(fmtMeasured('current', Number.NaN, 0.005, 0.015)).toBe('—')
  })

  it('a low frequency is printed, not clamped to ≈ 0 (RV-04)', () => {
    expect(fmtMeasured('frequency', 2, 450, 550)).toBe('2.000 Hz')
    expect(fmtMeasured('frequency', 4, 450, 550)).toBe('4.000 Hz')
    expect(fmtMeasured('frequency', 8, 900, 1100)).toBe('8.000 Hz')
    expect(fmtMeasured('frequency', 0.02, 900, 1100)).toBe('0.0200 Hz')
    for (const v of [2, 4, 8, 0.02, 1e-3]) expect(fmtMeasured('frequency', v, 900, 1100)).not.toMatch(/≈/)
    for (const v of [0.001, 0.0001]) expect(fmtMeasured('duty', v, 45, 55)).not.toMatch(/≈/)
  })

  it('the same value prints the same as the instruments (H3) — the IS-17 table', () => {
    expect(fmtQuantity('voltage', 3.3)).toBe(fmtVoltage(3.3))
    expect(fmtQuantity('voltage', 0.5)).toBe('500 mV')
    expect(fmtQuantity('current', 9.7e-3)).toBe(fmtCurrent(9.7e-3))
    expect(fmtQuantity('frequency', 999.7)).toBe(fmtFreq(999.7))
    expect(fmtQuantity('frequency', 0.998)).toBe('0.998 Hz')
    expect(fmtQuantity('duty', 0.5)).toBe(fmtPercent(0.5))
    expect(fmtMeasured('voltage', 3.3, 3, 3.6)).toBe('3.30 V')
    expect(fmtMeasured('current', 9.7e-3, 5e-3, 15e-3)).toBe('9.70 mA')
  })

  it('expected limits keep the precision the author wrote', () => {
    expect(fmtRange('current', 0.005, 0.015)).toBe('5 mA – 15 mA')
    expect(fmtRange('voltage', 1.7, 1.9)).toBe('1.7 V – 1.9 V')
    expect(fmtRange('voltage', 0, 0.4)).toBe('0 V – 400 mV')
    expect(fmtRange('frequency', 0.95, 1.05)).toBe('0.95 Hz – 1.05 Hz')
    expect(fmtRange('frequency', 450, 550)).toBe('450 Hz – 550 Hz')
    expect(fmtRange('frequency', 900, 1100)).toBe('900 Hz – 1.1 kHz')
    expect(fmtRange('duty', 45, 55)).toBe('45 % – 55 %')
    expect(fmtRange('led-brightness', 0.5, 1)).toBe('50 % – 100 %')
  })
})
