/**
 * Intermediate (中級) STM32 lessons, src/lessons/intermediate/*.lesson.ts:
 * every lesson is checked through the REAL lesson evaluator
 * (src/lessons/engine/evaluate.ts — netlist, coordinator with the real
 * firmware/dist images, ERC, firmware contracts):
 *  - start and solution circuits pass validateLayout; required parts exist
 *    in the catalog and required firmware in firmware/dist;
 *  - the solution passes EVERY acceptance check and every step check;
 *  - the start circuit fails at least one acceptance check;
 *  - the content follows the lesson rules (3–8 steps, objectives, mistakes,
 *    expected results, zh-TW text without mainland terms and without
 *    untranslated English outside `code` spans);
 *  - the common mistakes the lessons describe as reproducible really
 *    reproduce: the lesson-i* mistake firmware and the wiring mistakes give
 *    the symptom the lesson text states.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { LESSONS } from '../../src/lessons'
import { lessonById } from '../../src/lessons'
import type { Lesson, LessonCheck, PinRef } from '../../src/lessons/types'
import type { CircuitLayout } from '../../src/model/types'
import {
  evaluateChecks,
  evaluateLesson,
  lessonCircuitInput,
  type EvalInput,
  type EvaluatedCheck,
} from '../../src/lessons/engine/evaluate'
import { validateLayout } from '../../src/model/validate'
import { CATALOG } from '../../src/model/catalog'
import { englishLeft } from '../i18n/zh-check'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
const LONG = { timeout: 600_000 }

const intermediate = LESSONS.filter((l) => l.level === 'intermediate')

function explain(results: EvaluatedCheck[]): string {
  const lines: string[] = []
  const walk = (r: EvaluatedCheck, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${r.pass ? 'PASS' : 'FAIL'} [${r.kind}] ${r.label}: ${r.detail}${r.technical ? ` | ${r.technical.join(' | ')}` : ''}`)
    for (const c of r.children ?? []) walk(c, depth + 1)
  }
  results.forEach((r) => walk(r, 0))
  return lines.join('\n')
}

/** Simplified-Chinese / mainland terms that must not appear in zh-TW lesson text. */
const MAINLAND = [
  // traditional-character spellings of mainland usage (Taiwan: 程式 檔案 介面 記憶體 預設 暫存器 序列埠 鮑率 腳位 晶片 …)
  '程序', '文件', '界面', '內存', '默認', '寄存器', '串口', '波特率', '引腳', '管腳', '芯片', '模塊', '函數', '信號',
  '數據', '調試', '字節', '比特', '運行', '加載', '硬件', '軟件', '屏幕', '時鐘', '定時器', '電平', '上升沿', '下降沿',
  '占空比', '分頻', '採樣', '分辨率', '消抖', '輪詢', '緩沖', '地址', '萬用表', '電位器', '晶振', '激活', '視頻', '網絡',
  '打印', '菜單', '鼠標', '光標', '服務器', '兼容', '計算機', '單片機',
  // simplified characters never belong in zh-TW text
  '这', '个', '们', '时', '后', '设', '据', '错', '数', '电', '压', '图', '线', '开', '关', '读', '写', '为', '与',
]

function allText(l: Lesson): string {
  return [
    l.title,
    l.summary,
    ...l.objectives,
    l.wiring,
    l.theory,
    ...l.expected,
    ...l.mistakes.flatMap((m) => [m.symptom, m.cause, m.fix]),
    ...l.steps.flatMap((s) => [s.title, s.body]),
    l.runnableNote ?? '',
    l.start.layout.name ?? '',
    l.start.layout.description ?? '',
    l.solution.layout.name ?? '',
    l.solution.layout.description ?? '',
  ].join('\n')
}

describe('intermediate lessons: registry and content', () => {
  it('the eight intermediate lessons are registered in order', () => {
    expect(intermediate.map((l) => l.order)).toEqual([...intermediate.map((l) => l.order)].sort((a, b) => a - b))
    expect(intermediate.map((l) => l.id)).toEqual([
      'i1-gpio-output',
      'i2-exti-button',
      'i3-timer-interrupt',
      'i4-pwm',
      'i5-uart',
      'i6-adc',
      'i7-i2c',
      'i8-spi-595',
    ])
    expect(new Set(intermediate.map((l) => l.id)).size).toBe(intermediate.length)
    // every intermediate lesson runs real firmware on the Blue Pill
    for (const l of intermediate) expect(Object.values(l.solution.firmware ?? {}).length, l.id).toBe(1)
  })

  for (const l of intermediate) {
    describe(l.id, () => {
      it('layouts are valid, requirements exist', () => {
        for (const [what, c] of [
          ['start', l.start],
          ['solution', l.solution],
        ] as const) {
          const v = validateLayout(c.layout)
          expect(v.errors, `${l.id} ${what}`).toEqual([])
          expect(v.ok).toBe(true)
          for (const p of Object.values(c.firmware ?? {})) expect(existsSync(join(DIST, `${p}.elf`)), p).toBe(true)
        }
        for (const p of l.requires?.parts ?? []) expect(CATALOG[p], p).toBeDefined()
        for (const p of l.requires?.firmware ?? []) expect(existsSync(join(DIST, `${p}.elf`)), p).toBe(true)
        for (const c of l.solution.layout.components) expect(l.requires?.parts ?? [], `${c.type} listed in requires.parts`).toContain(c.type)
      })

      it('content follows the lesson rules (zh-TW, 3–8 steps, mistakes, expected results)', () => {
        expect(l.steps.length).toBeGreaterThanOrEqual(3)
        expect(l.steps.length).toBeLessThanOrEqual(8)
        expect(new Set(l.steps.map((s) => s.id)).size).toBe(l.steps.length)
        expect(l.objectives.length).toBeGreaterThanOrEqual(3)
        expect(l.mistakes.length).toBeGreaterThanOrEqual(3)
        expect(l.expected.length).toBeGreaterThanOrEqual(3)
        expect(l.acceptance.length).toBeGreaterThanOrEqual(3)
        if (l.runnable !== 'ready') expect(l.runnableNote, 'runnableNote').toBeTruthy()
        const text = allText(l)
        for (const w of MAINLAND) expect(text.includes(w), `mainland term "${w}" in ${l.id}`).toBe(false)
        // every expected result states a number
        for (const e of l.expected) expect(/\d/.test(e), e).toBe(true)
        // no untranslated English outside `code` spans (firmware output, identifiers, project names)
        for (const field of allText(l).split('\n')) {
          expect(englishLeft(field.replace(/`[^`]*`/g, ' ')), field).toEqual([])
        }
        for (const c of [...l.acceptance, ...l.steps.flatMap((s) => (s.check ? [s.check] : []))]) {
          expect(englishLeft(c.label ?? ''), c.label).toEqual([])
        }
      })

      it('the solution passes every acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.solution)
        if (process.env.LESSON_VERBOSE) console.log(`${l.id} solution\n${explain(ev.results)}`)
        expect(ev.pass, explain(ev.results)).toBe(true)
      })

      it('the start circuit fails at least one acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.start)
        if (process.env.LESSON_VERBOSE) console.log(`${l.id} start\n${explain(ev.results)}`)
        expect(ev.pass, explain(ev.results)).toBe(false)
      })

      it('every step check passes on the solution', LONG, async () => {
        const checks = l.steps.map((s) => s.check).filter((c): c is LessonCheck => !!c)
        const input = await lessonCircuitInput(l.solution)
        const res = await evaluateChecks(input, checks)
        expect(
          res.every((r) => r.pass),
          explain(res),
        ).toBe(true)
      })
    })
  }
})

// ------------------------------------------------- common mistakes reproduce

/** The solution circuit of `lessonId` with `firmware` on U1, after `mutate`. */
async function variant(lessonId: string, firmware: string, mutate: (l: CircuitLayout) => void = () => {}): Promise<EvalInput> {
  const lesson = lessonById(lessonId)
  if (!lesson) throw new Error(`no lesson ${lessonId}`)
  const layout = JSON.parse(JSON.stringify(lesson.solution.layout)) as CircuitLayout
  mutate(layout)
  const v = validateLayout(layout)
  if (!v.ok) throw new Error(`${lessonId} variant invalid: ${v.errors.join('; ')}`)
  return lessonCircuitInput({ layout, firmware: { U1: firmware } })
}

/** The wire with endpoint `keep`: move its other end to `other`. */
function moveWire(l: CircuitLayout, keep: string, other: string): void {
  const w = l.wires.find((x) => x.from === keep || x.to === keep)
  if (!w) throw new Error(`no wire at ${keep}`)
  if (w.from === keep) w.to = other
  else w.from = other
}

/** Evaluate the checks on `input`; each must give the paired verdict. */
async function expectVerdicts(input: EvalInput, checks: [LessonCheck, boolean][]): Promise<void> {
  const res = await evaluateChecks(
    input,
    checks.map(([c]) => c),
  )
  for (let i = 0; i < checks.length; i++) {
    expect(res[i].error ?? false, explain([res[i]])).toBe(false)
    expect(res[i].pass, explain(res)).toBe(checks[i][1])
  }
}

const pin = (p: string): PinRef => ({ component: 'U1', pin: p })
const freq = (at: PinRef, min: number, max: number, seconds: number): LessonCheck => ({
  kind: 'measure',
  at,
  quantity: 'frequency',
  min,
  max,
  seconds,
  fresh: true,
})
const ledCurrent = (id: string, min: number, max: number, seconds = 1.5): LessonCheck => ({
  kind: 'measure',
  at: { component: id, pin: 'anode' },
  quantity: 'current',
  component: id,
  min,
  max,
  seconds,
  fresh: true,
})
const uart = (text: string, seconds = 1): LessonCheck => ({ kind: 'uart-contains', component: 'U1', port: 'USART1', text, seconds })
const com = (text: string): LessonCheck => ({ kind: 'uart-contains', component: 'X1', port: 'COM', text, seconds: 0.5 })
const ercRisk: LessonCheck = { kind: 'erc-clean', level: 'risk' }

describe('intermediate lessons: the common mistakes reproduce in the simulator', () => {
  it('i1: lesson-i1-noclk leaves PA5 undriven (LED1 dark) while PC13 blinks; lesson-i1-od never lights LED1', LONG, async () => {
    await expectVerdicts(await variant('i1-gpio-output', 'lesson-i1-noclk'), [
      [freq(pin('PA5'), 0.95, 1.05, 2.2), false],
      [freq(pin('PC13'), 0.95, 1.05, 2.2), true],
      [ledCurrent('LED1', 0, 1e-5), true],
    ])
    await expectVerdicts(await variant('i1-gpio-output', 'lesson-i1-od'), [[ledCurrent('LED1', 0, 1e-5), true]])
  })

  it('i3: lesson-i3-offby1 toggles PB12 at 492.66 Hz instead of 500 Hz', LONG, async () => {
    await expectVerdicts(await variant('i3-timer-interrupt', 'lesson-i3-offby1'), [
      [freq(pin('PB12'), 492, 493.5, 0.5), true],
      [freq(pin('PB12'), 495, 505, 0.5), false],
    ])
  })

  it('i4: lesson-i4-nomoe keeps PA8 silent while PA0 runs at 1 kHz; a DMM reads the PWM average on PA8', LONG, async () => {
    await expectVerdicts(await variant('i4-pwm', 'lesson-i4-nomoe'), [
      [{ kind: 'measure', at: pin('PA8'), quantity: 'duty', min: 0, max: 0.01, seconds: 0.1, fresh: true }, true],
      [freq(pin('PA0'), 990, 1010, 0.1), true],
    ])
    await expectVerdicts(await variant('i4-pwm', 'hal-tim-pwm'), [
      [{ kind: 'measure', at: pin('PA8'), quantity: 'voltage', min: 2.2, max: 2.45, seconds: 0.1, fresh: true }, true],
    ])
  })

  it('i5: TX to TX leaves the COM port silent (ERC flags the fight); a 9600-baud COM port gets garbage; no GND: silent + ERC', LONG, async () => {
    const swapped = await variant('i5-uart', 'hal-uart-hello', (l) => {
      moveWire(l, 'j15', 'e38')
      moveWire(l, 'j16', 'e39')
    })
    await expectVerdicts(swapped, [
      [com('Hello'), false],
      [ercRisk, false],
    ])
    const baud = await variant('i5-uart', 'hal-uart-hello', (l) => {
      const x1 = l.components.find((c) => c.id === 'X1')
      if (x1) x1.params = { logic: '3.3V', baud: '9600' }
    })
    await expectVerdicts(baud, [[com('Hello'), false]])
    const noGnd = await variant('i5-uart', 'hal-uart-hello', (l) => {
      l.wires = l.wires.filter((w) => w.from !== 'e35')
    })
    await expectVerdicts(noGnd, [
      [com('Hello'), false],
      [ercRisk, false],
    ])
  })

  it('i6: the pot on the 5 V rail over-drives PA0 (ERC); wiper and end swapped read a constant 4095', LONG, async () => {
    await expectVerdicts(await variant('i6-adc', 'hal-adc-pot', (l) => moveWire(l, 'e42', 'bot+33')), [
      [{ kind: 'measure', at: pin('PA0'), quantity: 'voltage', min: 3.4, max: 5, seconds: 0.3, fresh: true }, true],
      [ercRisk, false],
    ])
    const swapped = await variant('i6-adc', 'hal-adc-pot', (l) => {
      moveWire(l, 'e41', 'top+36')
      moveWire(l, 'e42', 'a25')
    })
    await expectVerdicts(swapped, [[uart('adc=4095', 0.5), true]])
  })

  it('i7: no pull-ups give bus busy; SDA/SCL swapped find nothing; A0 high gives 0x51; WP high makes the write fail', LONG, async () => {
    const noPullups = await variant('i7-i2c', 'lesson-i7-i2c', (l) => {
      l.components = l.components.filter((c) => c.id !== 'R1' && c.id !== 'R2')
    })
    await expectVerdicts(noPullups, [
      [uart('bus busy at 0x08: SDA/SCL stuck low (pull-ups?)'), true],
      [uart('scan done 0'), true],
      [ercRisk, false],
    ])
    const swapped = await variant('i7-i2c', 'lesson-i7-i2c', (l) => {
      moveWire(l, 'a42', 'j24')
      moveWire(l, 'a43', 'j23')
    })
    await expectVerdicts(swapped, [
      [uart('scan done 0'), true],
      [uart('eeprom not found at 0x50'), true],
      [ercRisk, false],
    ])
    await expectVerdicts(await variant('i7-i2c', 'lesson-i7-i2c', (l) => moveWire(l, 'j40', 'top+40')), [
      [uart('found 0x51'), true],
      [uart('eeprom not found at 0x50'), true],
    ])
    await expectVerdicts(await variant('i7-i2c', 'lesson-i7-i2c', (l) => moveWire(l, 'a41', 'top+32')), [
      [uart('ready after 0 polls'), true],
      [uart('eeprom write failed'), true],
    ])
  })

  it('i8: LSB first lights QH first; no RCLK, OE high or SCK/MOSI swapped keep every LED dark', LONG, async () => {
    const q = (name: string): PinRef => ({ component: 'U2', pin: name })
    const level = (name: string, min: number, max: number): LessonCheck => ({
      kind: 'measure',
      at: q(name),
      quantity: 'voltage',
      min,
      max,
      seconds: 0.05,
      fresh: true,
    })
    await expectVerdicts(await variant('i8-spi-595', 'lesson-i8-lsb'), [
      [level('QH', 2.5, 3.4), true],
      [level('QA', 0, 0.3), true],
    ])
    await expectVerdicts(await variant('i8-spi-595', 'hal-spi-595'), [
      [level('QA', 2.5, 3.4), true],
      [level('QH', 0, 0.3), true],
    ])
    const dark = (name: string): LessonCheck => ({ kind: 'measure', at: q(name), quantity: 'duty', min: 0, max: 0.01, seconds: 1.6, fresh: true })
    const outputs = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH']
    const mutations: ((l: CircuitLayout) => void)[] = [
      (l) => {
        l.wires = l.wires.filter((w) => w.from !== 'a38') // RCLK unconnected
      },
      (l) => moveWire(l, 'a37', 'top+29'), // OE high
      (l) => {
        moveWire(l, 'a39', 'a18') // SRCLK ← MOSI
        moveWire(l, 'a36', 'a20') // SER ← SCK
      },
    ]
    for (const mutate of mutations) {
      await expectVerdicts(
        await variant('i8-spi-595', 'hal-spi-595', mutate),
        outputs.map((o): [LessonCheck, boolean] => [dark(o), true]),
      )
    }
  })
})
