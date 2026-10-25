/**
 * UX requests round — lessons:
 *  - LS-12 (a) finished: a failing acceptance toasts 「驗收 n / m 項通過」 with
 *    the kit's action 「查看原因」, which opens the lesson's 驗收 section and
 *    asks it to bring its outcome and 最可能的原因 into view;
 *  - LS-14 (d) / H5: the phone coach's line is the pill's model — the error /
 *    warning title with the folded 「另 n 個」 count; with nothing wrong, the
 *    findings only the run can confirm read 「n 項執行後確認」 (idle only);
 *  - i4 step 7 says on a touch screen how the phone re-routes a wire end
 *    (long-press, then drag — SC-13), on a mouse how the grips do;
 *  - i1 compares LED1 with the Blue Pill's own LED: its observe steps keep
 *    the board in the frame (highlight.watch), other observe steps do not;
 *  - the printed handout names the wires as the app does (W3, never w3 / p1 —
 *    IS-18 (3); the ids themselves: tests/ux-lessons-ids.test.ts).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { observeTargets } from '../src/lessons/step-actions'
import { reloadLessonProgress } from '../src/lessons/progress'
import type { Lesson } from '../src/lessons/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import type { Problem, ProblemCounts } from '../src/ui/embedded/problems'
import { dismissToast, getToasts } from '../src/ui/kit'
import { loadLessonCircuit, runAcceptance, showAcceptanceCause, stopGuide } from '../src/ui/lessons/actions'
import { coachLine } from '../src/ui/lessons/LessonOverlay'
import { deviceText } from '../src/ui/lessons/LessonText'
import { Handout } from '../src/ui/lessons/print'
import { useLessonUi } from '../src/ui/lessons/state'

const LONG = { timeout: 120_000 }
const memory = new Map<string, string>()
const lesson = (id: string): Lesson => lessonById(id)!

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  reloadLessonProgress()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null, revealCause: null })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  stopGuide()
  vi.unstubAllGlobals()
})

describe('the failing acceptance toast leads to its cause (LS-12 a)', () => {
  it(
    'b1 start circuit: 「驗收 1 / 6 項通過」 + 「查看原因」 → 驗收 with the cause revealed',
    async () => {
      const b1 = lesson('b1-led-resistor')
      expect(await loadLessonCircuit(b1, 'start')).toBe(true)
      useLessonUi.getState().openLesson(b1.id, 'objectives')
      for (const x of getToasts()) dismissToast(x.id)
      await runAcceptance(b1)
      const toast = getToasts().at(-1)
      expect(toast?.text).toMatch(/^驗收 \d+ \/ 6 項通過$/)
      expect(toast?.action?.label).toBe('查看原因')
      expect(useLessonUi.getState().revealCause).toBeNull()
      toast!.action!.run()
      const ui = useLessonUi.getState()
      expect(ui.viewId).toBe(b1.id)
      expect(ui.section).toBe('acceptance')
      expect(ui.revealCause?.lessonId).toBe(b1.id)
    },
    LONG,
  )

  it('showAcceptanceCause opens 驗收 of that lesson (the section consumes the request)', () => {
    const i1 = lesson('i1-gpio-output')
    showAcceptanceCause(i1)
    expect(useLessonUi.getState()).toMatchObject({ viewId: i1.id, section: 'acceptance', revealCause: { lessonId: i1.id } })
    useLessonUi.getState().requestRevealCause(null)
    expect(useLessonUi.getState().revealCause).toBeNull()
  })
})

const zero: ProblemCounts = { error: 0, warning: 0, info: 0 }
function row(p: Partial<Problem> & Pick<Problem, 'id' | 'level' | 'title'>): Problem {
  return { source: 'erc', detail: '', componentIds: [], holes: [], ...p } as Problem
}

describe('the phone coach line is the pill’s model (LS-14 d, H5)', () => {
  const pending = row({ id: 'erc:float:U1:PB12', level: 'info', title: 'U1 PB12 輸入浮接', pendingRuntime: true })
  const hint = row({ id: 'erc:open-lead:LED1', level: 'info', title: 'LED1 還沒接線' })

  it('an error leads, with the folded count of the rest', () => {
    const err = row({ id: 'erc:no-power', level: 'error', title: '電路中沒有電源' })
    const warn = row({ id: 'erc:x', level: 'warning', title: 'U1 還沒有韌體' })
    const line = coachLine({ problems: [err, warn, pending], counts: { ...zero, error: 1, warning: 1, info: 1 }, phase: 'idle', boardEmpty: false })
    expect(line).toMatchObject({ kind: 'problem', tone: 'error', text: '電路中沒有電源', more: 1 })
  })

  it('nothing wrong: 「n 項執行後確認」 while idle, nothing once it runs', () => {
    const counts = { ...zero, info: 2 }
    expect(coachLine({ problems: [pending, hint], counts, phase: 'idle', boardEmpty: false })).toMatchObject({
      kind: 'pending',
      text: '1 項執行後確認',
      first: pending,
    })
    expect(coachLine({ problems: [pending, hint], counts, phase: 'running', boardEmpty: false })).toBeNull()
    expect(coachLine({ problems: [hint], counts: { ...zero, info: 1 }, phase: 'idle', boardEmpty: false })).toBeNull()
    expect(coachLine({ problems: [], counts: zero, phase: 'idle', boardEmpty: true })).toBeNull()
  })
})

describe('i4 step 7 says how THIS device re-routes a wire end', () => {
  it('mouse: select the wire and drag its end; touch: long-press the end and drag it', () => {
    const body = lesson('i4-pwm').steps.find((s) => s.id === 'fade')!.body
    expect(deviceText(body, false)).toContain('選取 R2 的導線，把 `a25` 那一端拖到 `a19`')
    expect(deviceText(body, true)).toContain('長按 R2 導線在 `a25` 的那一端，再拖到 `a19`')
    expect(deviceText(body, true)).not.toContain('選取 R2 的導線')
  })
})

describe('i1 compares LED1 with the board’s own LED: both stay in the frame (LS-12 b)', () => {
  it('observe steps frame their LEDs (+ series parts); i1 steps 4 and 6 keep U1 (its PC13 LED) too', () => {
    const i1 = lesson('i1-gpio-output')
    const at = (l: Lesson, id: string) => l.steps.findIndex((s) => s.id === id)
    expect(observeTargets(i1, at(i1, 'run'))?.components).toEqual(['LED1', 'U1'])
    expect(observeTargets(i1, at(i1, 'mistakes'))?.components).toEqual(['LED1', 'U1'])
    // elsewhere the board stays out of the frame, so the LEDs stay large
    const b1 = lesson('b1-led-resistor')
    expect(observeTargets(b1, at(b1, 'b1-s5'))?.components).toEqual(['LED1', 'R1'])
    const i4 = lesson('i4-pwm')
    expect(observeTargets(i4, at(i4, 'firmware'))?.components).toEqual(['LED1', 'LED2'])
  })

  it('the text says where the board LED is, and names Space only for a keyboard', () => {
    const body = lesson('i1-gpio-output').steps.find((s) => s.id === 'run')!.body
    expect(deviceText(body, false)).toContain('按上方的「▶ 執行模擬」（或空白鍵），看 LED1 與板載綠色 LED（PC13，在 USB 接頭旁）')
    expect(deviceText(body, true)).toContain('按上方的「▶ 執行模擬」，看 LED1')
  })
})

describe('the handout names wires as the app does', () => {
  it('b1 and a1: W ids in the wire table', () => {
    for (const id of ['b1-led-resistor', 'a1-mpu6050']) {
      const html = renderToStaticMarkup(createElement(Handout, { lesson: lesson(id) }))
      expect(html, id).toMatch(/>W3</)
      expect(html, id).not.toMatch(/>(?:w|p)\d+</)
    }
  })
})
