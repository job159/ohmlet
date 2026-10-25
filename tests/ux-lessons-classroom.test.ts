/**
 * UX fix round WS3 — classroom (LS-15) and the lesson page (LS-14):
 *  - b1 step 6 checks the meter's READING: an open cathode (the meter reads
 *    5 V) fails it, the solution passes it;
 *  - stepExpectation names what a step expects an instrument to read;
 *  - the receipt carries the student's 姓名／座號 in its JSON and file name,
 *    remembered on the device (try/catch storage);
 *  - the student handout prints the starting circuit, never the solution;
 *  - device wording {滑鼠：…｜觸控：…} reads the right sentence;
 *  - the MCU pin a step points at (i1 step 1 → U1 PA5).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { evaluateChecks } from '../src/lessons/engine/evaluate'
import { meetsExpectation, stepExpectation, stepPinTarget } from '../src/lessons/step-actions'
import type { Lesson } from '../src/lessons/types'
import type { CircuitLayout } from '../src/model/types'
import { deviceText } from '../src/ui/lessons/LessonText'
import { Handout, STUDENT_NAME_KEY, buildReceipt, fileSafeName, readStudentName, receiptFileName, saveStudentName } from '../src/ui/lessons/print'

const LONG = { timeout: 120_000 }
const lesson = (id: string): Lesson => lessonById(id)!
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('b1 step 6 checks the reading (LS-15, TR-11)', () => {
  const b1 = lesson('b1-led-resistor')
  const s6 = b1.steps.findIndex((s) => s.id === 'b1-s6')

  it('an open cathode (the meter reads 5 V) fails; the solution passes', LONG, async () => {
    const check = b1.steps[s6].check!
    const open: CircuitLayout = { ...b1.solution.layout, wires: b1.solution.layout.wires.filter((w) => w.from !== 'a16' && w.to !== 'a16') }
    const [bad] = await evaluateChecks({ layout: open, firmware: {} }, [check])
    expect(bad.pass).toBe(false)
    const reading = bad.children?.[2]
    expect(reading?.pass).toBe(false)
    expect(reading?.detail).toMatch(/量測值 5\.00 V（預期 1\.7 V – 1\.9 V）/)
    const [good] = await evaluateChecks({ layout: b1.solution.layout, firmware: {} }, [check])
    expect(good.pass, good.children?.map((c) => c.detail).join(' / ')).toBe(true)
  })

  it('names what the step expects DMM1 to read', () => {
    const e = stepExpectation(b1, s6, 'DMM1')!
    expect(e).toMatchObject({ quantity: 'voltage', min: 1.7, max: 1.9, range: '1.7 V – 1.9 V' })
    expect(meetsExpectation(e, 1.798)).toBe(true)
    expect(meetsExpectation(e, 5)).toBe(false)
    expect(meetsExpectation(e, Number.NaN)).toBeNull()
    expect(stepExpectation(b1, s6, 'LED1')).toBeNull()
    // a current step: about the LED
    const s5 = b1.steps.findIndex((s) => s.id === 'b1-s5')
    expect(stepExpectation(b1, s5, 'LED1')).toMatchObject({ quantity: 'current', range: '5 mA – 15 mA' })
  })
})

describe('named receipts (LS-15)', () => {
  it('the receipt and its file name carry the student', () => {
    const b1 = lesson('b1-led-resistor')
    const at = Date.UTC(2026, 9, 14, 7, 15)
    expect(fileSafeName(' 王小明 12 ')).toBe('王小明-12')
    expect(fileSafeName('a/b:c*?')).toBe('a-b-c')
    expect(receiptFileName(b1, at, '王小明 12')).toMatch(/^b1-led-resistor-王小明-12-acceptance-\d{8}-\d{4}\.json$/)
    expect(receiptFileName(b1, at)).toMatch(/^b1-led-resistor-acceptance-/)
    expect(buildReceipt(b1, [], at, '王小明 12').student).toEqual({ name: '王小明 12' })
    expect(buildReceipt(b1, [], at).student).toBeUndefined()
  })

  it('remembers the name on this device, and survives a storage that throws', () => {
    expect(readStudentName()).toBe('')
    saveStudentName(' 王小明 12 ')
    expect(memory.get(STUDENT_NAME_KEY)).toBe('王小明 12')
    expect(readStudentName()).toBe('王小明 12')
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readStudentName()).toBe('')
    expect(() => saveStudentName('x')).not.toThrow()
  })
})

describe('the student handout (LS-15)', () => {
  it('prints the starting circuit, never the solution', () => {
    const b1 = lesson('b1-led-resistor')
    const teacher = renderToStaticMarkup(createElement(Handout, { lesson: b1 }))
    const student = renderToStaticMarkup(createElement(Handout, { lesson: b1, student: true }))
    expect(teacher).toContain('參考電路（解答）')
    expect(student).not.toContain('參考電路（解答）')
    expect(student).toContain('起始電路')
    expect(student).toContain('學生版')
    // R1 is what the student places: the solution's part list has it, the starting circuit does not
    expect(teacher).toMatch(/<td translate="no">R1<\/td>/)
    expect(student).not.toMatch(/<td translate="no">R1<\/td>/)
    // wire ends read the terminal's name, never 「PS1:+」
    expect(teacher).toContain('PS1 正端')
    expect(teacher).not.toMatch(/PS1:[+-]/)
  })
})

describe('the lesson text speaks to this device (LS-14)', () => {
  it('device wording', () => {
    const text = '{滑鼠：把游標停在 Blue Pill 上，找到｜觸控：點一下 Blue Pill 上的 A5 腳，找到} **PA5**。'
    expect(deviceText(text, false)).toBe('把游標停在 Blue Pill 上，找到 **PA5**。')
    expect(deviceText(text, true)).toBe('點一下 Blue Pill 上的 A5 腳，找到 **PA5**。')
    expect(deviceText('沒有變體 `{a}`', true)).toBe('沒有變體 `{a}`')
  })

  it('the MCU pin a step points at', () => {
    const i1 = lesson('i1-gpio-output')
    expect(stepPinTarget(i1, 0, i1.start.layout)).toEqual({ component: 'U1', pin: 'PA5' })
    expect(stepPinTarget(i1, 2, i1.start.layout)).toBeNull()
  })
})
