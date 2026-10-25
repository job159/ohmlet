/**
 * UX fix round WS3 — lesson text and checks use the product's names (LS-13,
 * helpers H1 / H9):
 *  - pinRefText is H1: 「U1 PA5（板上 A5）」, 「LED1 陰極（短腳）」, 「PS1 正端」,
 *    「DMM1 COM 端」; never 「U1.PA5」 / 「PS1:-」, no stray space before 與;
 *  - every label and detail of b1 / i1 (start and solution circuits, the real
 *    evaluator) is free of raw refs;
 *  - the guide's 「在電路板上標示／取消標示」 are the Problems list's words.
 */
import { describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests, t } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { evaluateLesson, type EvaluatedCheck } from '../src/lessons/engine/evaluate'
import { checkLabel } from '../src/lessons/engine/format'
import { pinRefText, tidyCjkSpaces } from '../src/lessons/engine/refs'
import type { Lesson } from '../src/lessons/types'

const LONG = { timeout: 300_000 }
const lesson = (id: string): Lesson => lessonById(id)!
/** A raw ref as the acceptance of LS-13 states it: 「U1.PA5」, 「PS1:-」, 「DMM1:COM」. */
const RAW = /\b[A-Z]+\d+[.:][A-Z+-]/

function texts(results: readonly EvaluatedCheck[]): string[] {
  const out: string[] = []
  const walk = (r: EvaluatedCheck) => {
    out.push(r.label, r.detail)
    r.children?.forEach(walk)
  }
  results.forEach(walk)
  return out
}

describe('pin names in lesson checks are H1 (LS-13)', () => {
  it('pinRefText', () => {
    __setLangForTests('zh-TW')
    const i1 = lesson('i1-gpio-output').solution.layout
    expect(pinRefText({ component: 'U1', pin: 'PA5' }, i1)).toBe('U1 PA5（板上 A5）')
    expect(pinRefText({ component: 'U1', pin: 'GND1' }, i1)).toBe('U1 GND（板上 G）')
    expect(pinRefText({ component: 'LED1', pin: 'cathode' }, i1)).toBe('LED1 陰極（短腳）')
    expect(pinRefText({ terminal: 'PS1:+' }, i1)).toBe('PS1 正端')
    expect(pinRefText({ terminal: 'PS1:-' })).toBe('PS1 負端')
    expect(pinRefText({ terminal: 'DMM1:COM' }, lesson('b1-led-resistor').solution.layout)).toBe('DMM1 COM 端')
    expect(pinRefText({ hole: 'a20' })).toBe('a20')
    // a part the circuit does not hold: still no dot
    expect(pinRefText({ component: 'U9', pin: 'PA5' })).toBe('U9 PA5')
    expect(pinRefText({ component: 'LED9', pin: 'anode' })).toBe('LED9 陽極')
  })

  it('no stray space between Chinese words', () => {
    expect(tidyCjkSpaces('LED1 陰極（短腳） 與 PS1 負端 沒有相連。')).toBe('LED1 陰極（短腳）與 PS1 負端沒有相連。')
    expect(tidyCjkSpaces('U1 PA5 與 LED1 陽極')).toBe('U1 PA5 與 LED1 陽極')
    expect(tidyCjkSpaces('量測值 9.70 mA（預期 5 mA – 15 mA）。 2.2 秒內')).toBe('量測值 9.70 mA（預期 5 mA – 15 mA）。 2.2 秒內')
    __setLangForTests('zh-TW')
    const b1 = lesson('b1-led-resistor')
    const label = checkLabel({ kind: 'not-connected', a: { component: 'LED1', pin: 'cathode' }, b: { terminal: 'PS1:-' } }, b1.start.layout)
    expect(label).toBe('LED1 陰極（短腳）與 PS1 負端沒有相連')
  })

  it('b1 and i1: every rendered label and detail is free of raw refs', LONG, async () => {
    __setLangForTests('zh-TW')
    const leaks: string[] = []
    for (const id of ['b1-led-resistor', 'i1-gpio-output']) {
      const l = lesson(id)
      for (const circuit of [l.start, l.solution]) {
        const ev = await evaluateLesson(l, circuit)
        for (const x of texts(ev.results)) if (RAW.test(x)) leaks.push(`${id}: ${x}`)
      }
      for (const s of l.steps) if (s.check && RAW.test(checkLabel(s.check, l.solution.layout))) leaks.push(`${id} ${s.id}: ${checkLabel(s.check)}`)
    }
    expect(leaks).toEqual([])
  })

  it('「在電路板上標示／取消標示」 — the Problems list’s words', () => {
    __setLangForTests('zh-TW')
    expect(t('Show on the board')).toBe('在電路板上標示')
    expect(t('Hide on the board')).toBe('取消標示')
  })
})
