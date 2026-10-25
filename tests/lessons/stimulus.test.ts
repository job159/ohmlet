/**
 * Runtime stimulus in lesson checks (final round, request 2): a measure /
 * uart-contains check performs the learner's action itself — a runtime param
 * change (ENC1 「位置」, SW1 「按下」) applied at its exact virtual time
 * through the coordinator's runtime-param path — evaluated by the REAL lesson
 * evaluator on the bundled firmware:
 *
 *  - the change lands at its exact time, also in a circuit without an MCU
 *    (the coordinator's own event queue never runs there);
 *  - uart-contains counts only output sent after the first action and
 *    performs every action up to `seconds` (a release after the press); a
 *    change the check did not reach is dropped; a session already past the
 *    first action runs the whole script later, spacing kept;
 *  - a param the checks drive starts at its catalog default, whatever the
 *    learner left turned or ticked on the live board;
 *  - a part the learner removed fails the check, a param that is not a
 *    runtime setting is an evaluation error (the lesson author's mistake);
 *  - the result names what the check did (「檢查時會自動操作：…」);
 *  - a6: the acceptance turns the knob and presses it (count up, count
 *    down, debounced press / release), swapped CLK / DT fail with pos=-5;
 *  - b3 / b4 / i2: the pressed-button checks never depend on a box the
 *    learner left ticked, and fail on the circuits that cannot do it;
 *  - the worker path: the request survives structured cloning and gives the
 *    same results (the worker runs this very evaluator).
 */
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { __setLangForTests } from '../../src/i18n'
import { lessonById } from '../../src/lessons'
import type { Lesson, LessonCheck, LessonCircuit } from '../../src/lessons/types'
import type { CircuitLayout, ParamValue } from '../../src/model/types'
import { evaluateChecks, evaluateLesson, lessonCircuitInput, type EvaluatedCheck } from '../../src/lessons/engine/evaluate'
import { stimulusText } from '../../src/lessons/engine/format'
import { matchMistake } from '../../src/lessons/diagnose'
import { validateLayout } from '../../src/model/validate'

const LONG = { timeout: 300_000 }

function lesson(id: string): Lesson {
  const l = lessonById(id)
  if (!l) throw new Error(`no lesson ${id}`)
  return l
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function variant(l: Lesson, mutate: (layout: CircuitLayout) => void, firmware?: string): LessonCircuit {
  const layout = clone(l.solution.layout)
  mutate(layout)
  const v = validateLayout(layout)
  if (!v.ok) throw new Error(`${l.id} variant invalid: ${v.errors.join('; ')}`)
  const fw = firmware ?? l.solution.firmware?.U1
  return fw ? { layout, firmware: { U1: fw } } : { layout }
}

function moveWire(l: CircuitLayout, keep: string, other: string): void {
  const w = l.wires.find((x) => x.from === keep || x.to === keep)
  if (!w) throw new Error(`no wire at ${keep}`)
  if (w.from === keep) w.to = other
  else w.from = other
}

function dropWire(l: CircuitLayout, end: string): void {
  l.wires = l.wires.filter((w) => w.from !== end && w.to !== end)
}

function setParam(l: CircuitLayout, id: string, key: string, value: ParamValue): void {
  const c = l.components.find((x) => x.id === id)
  if (!c) throw new Error(`no part ${id}`)
  c.params = { ...(c.params ?? {}), [key]: value }
}

async function run(circuit: LessonCircuit, checks: LessonCheck[]): Promise<EvaluatedCheck[]> {
  __setLangForTests('zh-TW')
  return evaluateChecks(await lessonCircuitInput(circuit), checks)
}

function explain(rs: EvaluatedCheck[]): string {
  const lines: string[] = []
  const walk = (r: EvaluatedCheck, d: number) => {
    lines.push(`${'  '.repeat(d)}${r.pass ? 'PASS' : 'FAIL'} ${r.label}: ${r.detail}${r.stimulus ? ` [${r.stimulus}]` : ''}${r.technical ? ` | ${r.technical.join(' | ')}` : ''}`)
    for (const c of r.children ?? []) walk(c, d + 1)
  }
  rs.forEach((r) => walk(r, 0))
  return lines.join('\n')
}

/** a voltage out of a detail 「量測值 3.66 V（預期 …）」 / 「量測值 ≈ 0 mV」 */
function measured(r: EvaluatedCheck): number {
  const m = /量測值 (≈ )?([\d.]+) (m?)V/.exec(r.detail)
  if (!m) throw new Error(`no voltage in ${r.detail}`)
  return parseFloat(m[2]) * (m[3] === 'm' ? 1e-3 : 1)
}

const Y = { component: 'C1', pin: 'p1' }
const yWindow = (press: number | null): LessonCheck => ({
  kind: 'measure',
  at: Y,
  quantity: 'voltage',
  min: 0,
  max: 5.1,
  seconds: 0.3,
  fresh: true,
  ...(press === null ? {} : { stimulus: [{ at: press, component: 'SW2', param: 'pressed', value: true }] }),
})

describe('runtime stimulus: when and how it is applied', () => {
  it('lands at its exact virtual time, also without an MCU (b4: Y discharges through R3 only once SW2 is pressed)', LONG, async () => {
    const b4 = lesson('b4-button-debounce')
    const [never, early, late] = await run(b4.solution, [yWindow(null), yWindow(0.1), yWindow(0.25)])
    // the mean over the second half of the window, [0.15, 0.3] s
    expect(measured(never)).toBeGreaterThan(4.95)
    expect(measured(early)).toBeLessThan(0.05)
    // pressed at 0.25 s: 0.1 s at 5 V, then 50 ms of a τ = 10 ms decay → (0.5 + 0.0497) / 0.15 = 3.66 V
    expect(measured(late)).toBeGreaterThan(3.55)
    expect(measured(late)).toBeLessThan(3.75)
    expect(never.stimulus).toBeUndefined()
    expect(early.stimulus).toBe('檢查時會自動操作：0.1 秒時勾選 SW2 的「按下」')
  })

  it('uart-contains counts only what the firmware sends after the action', LONG, async () => {
    const b3 = lesson('b3-pull-resistors')
    const released: LessonCheck = { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'PA0=1 PA1=0', seconds: 0.4 }
    const [before, after] = await run(b3.solution, [
      released,
      { ...released, stimulus: [{ at: 0.15, component: 'SW1', param: 'pressed', value: true }] },
    ])
    expect(before.pass, explain([before])).toBe(true)
    // SW1 held from 0.15 s on: every line after it reads PA0=0 — the earlier PA0=1 lines do not count
    expect(after.pass, explain([after])).toBe(false)
    expect(after.technical?.[0]).toContain('PA0=0 PA1=0')
    expect(after.technical?.[0]).not.toContain('PA0=1')
  })

  it('performs a release after the press although the text came first; a change the check did not reach is dropped', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const pb12 = { component: 'U1', pin: 'PB12' }
    const press = (release: number): LessonCheck => ({
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'press 1',
      seconds: 0.4,
      stimulus: [
        { at: 0.1, component: 'SW1', param: 'pressed', value: true },
        { at: release, component: 'SW1', param: 'pressed', value: false },
      ],
    })
    // PB12 over the next 0.4 s of the same session (mean of [0.6, 0.8])
    const level: LessonCheck = { kind: 'measure', at: pb12, quantity: 'voltage', min: 0, max: 3.6, seconds: 0.4 }
    const released = await run(i2.solution, [press(0.3), level])
    expect(released[0].pass, explain(released)).toBe(true)
    expect(released[0].detail).toMatch(/上電後 0\.1[23]\d* 秒收到「press 1」/)
    expect(measured(released[1])).toBeGreaterThan(3.0)
    // the release at 0.9 s lies beyond the check's 0.4 s: dropped, SW1 stays held
    const held = await run(i2.solution, [press(0.9), level])
    expect(held[0].pass, explain(held)).toBe(true)
    expect(measured(held[1])).toBeLessThan(0.3)
  })

  it('a session already past the first action runs the whole script later, spacing and deadline included', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const press = (text: string, at: number, seconds: number): LessonCheck => ({
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text,
      seconds,
      stimulus: [
        { at, component: 'SW1', param: 'pressed', value: true },
        { at: at + 0.1, component: 'SW1', param: 'pressed', value: false },
      ],
    })
    // the first check runs the shared session to 0.4 s (its release), a measure on to 0.5 s; the third
    // check's script (written for 0.1 s → 0.2 s) then runs 0.5 s → 0.6 s, its deadline 0.3 s → 0.7 s
    const idle: LessonCheck = { kind: 'measure', at: { component: 'U1', pin: 'PB12' }, quantity: 'voltage', min: 3, max: 3.4, seconds: 0.1 }
    const res = await run(i2.solution, [press('press 1', 0.3, 0.4), idle, press('press 2', 0.1, 0.3)])
    expect(res.every((r) => r.pass), explain(res)).toBe(true)
    expect(res[2].stimulus).toBe('檢查時會自動操作：0.5 秒時勾選 SW1 的「按下」，0.6 秒時取消勾選 SW1 的「按下」')
    expect(res[2].detail).toMatch(/上電後 0\.52\d* 秒收到「press 2」/)
  })

  it('a param the checks drive starts at its catalog default: what the learner left turned or ticked neither breaks nor fakes a check', LONG, async () => {
    const a6 = lesson('a6-rotary-encoder')
    // the learner turned the knob to 5 and left the switch ticked on the live board
    const left = variant(a6, (x) => {
      setParam(x, 'ENC1', 'position', 5)
      setParam(x, 'ENC1', 'pressed', true)
    })
    const knob = await run(left, [a6.acceptance[9], a6.acceptance[10]])
    expect(knob.every((r) => r.pass), explain(knob)).toBe(true)
    // b3 with SW1 left ticked: the released checks see it released, the press check presses it itself
    const b3 = lesson('b3-pull-resistors')
    const ticked = variant(b3, (x) => setParam(x, 'SW1', 'pressed', true))
    const ev = await evaluateLesson(b3, ticked)
    expect(ev.pass, explain(ev.results)).toBe(true)
    // …but a check that drives nothing still reads the board as it is (i2 without a stimulus on SW1 here)
    const i2 = lesson('i2-exti-button')
    const held = variant(i2, (x) => setParam(x, 'SW1', 'pressed', true))
    const [pb12] = await run(held, [{ kind: 'measure', at: { component: 'U1', pin: 'PB12' }, quantity: 'voltage', min: 3, max: 3.4, seconds: 0.2, fresh: true }])
    expect(pb12.pass).toBe(false)
  })

  it('a removed part fails the check; a param that is not a runtime setting is an evaluation error', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const base: LessonCheck = { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'press 1', seconds: 0.3 }
    const noButton = variant(i2, (x) => {
      x.components = x.components.filter((c) => c.id !== 'SW1')
      dropWire(x, 'j45')
      dropWire(x, 'j47')
    })
    const [gone] = await run(noButton, [{ ...base, stimulus: [{ at: 0.1, component: 'SW1', param: 'pressed', value: true }] }])
    expect(gone.pass).toBe(false)
    expect(gone.error).toBeUndefined()
    expect(gone.detail).toBe('電路中沒有 SW1')
    const [bad] = await run(i2.solution, [{ ...base, stimulus: [{ at: 0.1, component: 'R1', param: 'resistance', value: 1000 }] }])
    expect(bad.pass).toBe(false)
    expect(bad.error).toBe(true)
    expect(bad.detail).toBe('R1 沒有可以在模擬執行中調整的「resistance」設定。')
  })

  it('names what it did in the app’s words (zh-TW and English)', () => {
    const parts = { components: [{ id: 'ENC1', type: 'ky040_encoder' }, { id: 'SW1', type: 'pushbutton' }] }
    __setLangForTests('zh-TW')
    expect(
      stimulusText(
        [
          { at: 0, component: 'SW1', param: 'pressed', value: true },
          { at: 0.1, component: 'ENC1', param: 'position', value: 5 },
          { at: 0.25, component: 'SW1', param: 'pressed', value: false },
        ],
        parts,
      ),
    ).toBe('檢查時會自動操作：一上電就勾選 SW1 的「按下」，0.1 秒時把 ENC1 的「位置」設為 5，0.25 秒時取消勾選 SW1 的「按下」')
    __setLangForTests('en')
    expect(stimulusText([{ at: 0.1, component: 'ENC1', param: 'position', value: 5 }], parts)).toBe(
      'The check does this itself: 0.1 s: set ENC1 “Position” to 5',
    )
    __setLangForTests('zh-TW')
    expect(stimulusText([], parts)).toBe('')
    // an SI quantity in the app's units, a count as a plain number
    expect(stimulusText([{ at: 0.2, component: 'DRV1', param: 'vref', value: 0.08 }], { components: [{ id: 'DRV1', type: 'a4988_driver' }] })).toBe(
      '檢查時會自動操作：0.2 秒時把 DRV1 的「限流 VREF」設為 80 mV',
    )
  })
})

describe('a6: the acceptance turns the knob and presses it', () => {
  const a6 = lesson('a6-rotary-encoder')
  const TURN = 9
  const PRESS = 10

  it('counts up to pos=5, back down to pos=2, prints SW pressed / SW released ≈ 20 ms after each action', LONG, async () => {
    const res = await run(a6.solution, [a6.acceptance[TURN], a6.acceptance[PRESS]])
    expect(res.every((r) => r.pass), explain(res)).toBe(true)
    const [up, down] = res[0].children!
    // 0.1 s + 5 detents × 50 ms (20 detents/s)
    expect(up.detail).toMatch(/上電後 0\.3[34]\d* 秒收到「pos=5」/)
    expect(up.stimulus).toBe('檢查時會自動操作：0.1 秒時把 ENC1 的「位置」設為 5')
    expect(down.detail).toMatch(/上電後 0\.6[34]\d* 秒收到「pos=2」/)
    const [pressed, released] = res[1].children!
    expect(pressed.detail).toMatch(/上電後 0\.92\d* 秒收到「SW pressed」/)
    expect(pressed.stimulus).toBe('檢查時會自動操作：0.9 秒時勾選 ENC1 的「按下」')
    expect(released.detail).toMatch(/上電後 1\.02\d* 秒收到「SW released」/)
  })

  it('swapped CLK / DT count backwards (pos=-5) and fail; an unwired SW never prints SW pressed', LONG, async () => {
    const swapped = variant(a6, (x) => {
      moveWire(x, 'j40', 'j24')
      moveWire(x, 'j41', 'j23')
    })
    const [turn] = await run(swapped, [a6.acceptance[TURN]])
    expect(turn.pass).toBe(false)
    expect(turn.children![0].technical?.[0]).toContain('pos=-5')
    const [press] = await run(variant(a6, (x) => dropWire(x, 'j42')), [a6.acceptance[PRESS]])
    expect(press.pass).toBe(false)
    expect(press.children![0].pass).toBe(false)
  })

  it('stays partial for the one thing the simulator does not model: contact bounce', () => {
    expect(a6.runnable).toBe('partial')
    expect(a6.runnableNote).toContain('彈跳')
    expect(a6.runnableNote).toContain('驗收會自己把 ENC1 的「位置」')
  })
})

describe('b3 / b4 / i2: pressed-button checks press the button themselves', () => {
  it('b3: the press steps pass with nothing ticked on the board; the acceptance reads PA0=0 / PA1=1 while it holds the buttons', LONG, async () => {
    const b3 = lesson('b3-pull-resistors')
    const steps = ['b3-s3', 'b3-s5'].map((id) => b3.steps.find((s) => s.id === id)!.check!)
    const released = variant(b3, (x) => {
      setParam(x, 'SW1', 'pressed', false)
      setParam(x, 'SW2', 'pressed', false)
    })
    // each step check runs on its own world (runStepCheck), the acceptance check in a run of its own here
    const res = [
      ...(await run(released, [steps[0]])),
      ...(await run(released, [steps[1]])),
      ...(await run(released, [b3.acceptance[b3.acceptance.length - 1]])),
    ]
    expect(res.every((r) => r.pass), explain(res)).toBe(true)
    expect(res[0].stimulus).toBe('檢查時會自動操作：一上電就勾選 SW1 的「按下」')
    // SW2's other side not on 3.3 V: pressing it cannot raise PA1
    const open = await run(
      variant(b3, (x) => dropWire(x, 'a50')),
      [b3.acceptance[b3.acceptance.length - 1]],
    )
    expect(open[0].pass, explain(open)).toBe(false)
    expect(open[0].children![0].pass).toBe(true)
    expect(open[0].children![1].pass).toBe(false)
  })

  it('b4: LED1 lights while the check holds SW1, Y discharges while it holds SW2; without R1 the LED stays dark', LONG, async () => {
    const b4 = lesson('b4-button-debounce')
    const n = b4.acceptance.length
    const res = [
      ...(await run(b4.solution, [b4.steps.find((s) => s.id === 'b4-s3')!.check!])),
      ...(await run(b4.solution, [b4.acceptance[n - 2], b4.acceptance[n - 1]])),
    ]
    expect(res.every((r) => r.pass), explain(res)).toBe(true)
    const noR1 = variant(b4, (x) => {
      x.components = x.components.filter((c) => c.id !== 'R1')
    })
    const dark = await run(noR1, [b4.acceptance[n - 2]])
    expect(dark[0].pass).toBe(false)
  })

  it('i2: one press prints press 1 and leaves LED1 on; the firmware without the NVIC enable never counts', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const last = i2.acceptance[i2.acceptance.length - 1]
    const step = i2.steps.find((s) => s.id === 'press')!.check!
    const ok = [...(await run(i2.solution, [step])), ...(await run(i2.solution, [last]))]
    expect(ok.every((r) => r.pass), explain(ok)).toBe(true)
    const nonvic = await run(variant(i2, () => {}, 'lesson-i2-nonvic'), [last])
    expect(nonvic[0].pass, explain(nonvic)).toBe(false)
    expect(nonvic[0].children!.every((c) => !c.pass)).toBe(true)
    // …which makes 「NVIC 沒有致能」 the 最可能的原因 of its own reproduction (whole acceptance, static ERC)
    const ev = await evaluateLesson(i2, variant(i2, () => {}, 'lesson-i2-nonvic'))
    const mistake = matchMistake(i2, ev.results, [])
    expect(mistake?.cause ?? '', explain(ev.results)).toContain('NVIC 沒有致能')
  })
})

describe('the worker path', () => {
  it('a request with a stimulus survives structured cloning and evaluates to the same results', LONG, async () => {
    const a6 = lesson('a6-rotary-encoder')
    const input = await lessonCircuitInput(a6.solution)
    const checks = [a6.acceptance[9], a6.acceptance[10]]
    __setLangForTests('zh-TW')
    const inline = await evaluateChecks(input, checks)
    // what runLessonChecks posts to the lesson-check worker (structured clone)
    const req = structuredClone({ input, checks })
    expect(req.checks[0]).toEqual(checks[0])
    const viaWorker = await evaluateChecks(req.input, req.checks)
    expect(viaWorker).toEqual(inline)
  })
})
