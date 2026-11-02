/**
 * UX fix round WS3 — every step's next action is a button (LS-11):
 *  - wire steps derive 「開始接線（a16 → top-13）」 from the solution's new
 *    wires at the step's holes, and the next missing wire after each one;
 *  - a failing value check offers 「把 R1 設為 330 Ω」 (the value the lesson
 *    teaches, else the E12 value nearest the middle) and 「選取 R1」;
 *  - frequency / duty steps put their pins on the logic analyzer in one
 *    click, and a lesson opens the tray on its instrument;
 *  - 「拿一顆電阻」 → one placement → select mode, the new part selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import { actionKey, lessonInstrument, nearestE12, paramFixes, pendingWire, stepActions, stepWires } from '../src/lessons/step-actions'
import { evaluateChecks } from '../src/lessons/engine/evaluate'
import type { Lesson, LessonStepAction } from '../src/lessons/types'
import type { CircuitLayout } from '../src/model/types'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import { addLogicChannels, applyParamFix, armPart, loadLessonCircuit, startWiring, stopGuide, WIRE_FOCUS } from '../src/ui/lessons/actions'
import { useLessonUi } from '../src/ui/lessons/state'

const lesson = (id: string): Lesson => lessonById(id)!
const stepIndex = (l: Lesson, id: string) => l.steps.findIndex((s) => s.id === id)
const memory = new Map<string, string>()
const lastToast = (): string => getToasts()[getToasts().length - 1]?.text ?? ''

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __setFirmwareBlobStoreForTests(createMemoryBlobStore())
  reloadLessonProgress()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {}, logicChannels: [] })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  stopGuide()
  __setFirmwareBlobStoreForTests(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('wire steps (LS-11 c)', () => {
  it('derive the wires a step asks for, oriented by its holes', () => {
    const b1 = lesson('b1-led-resistor')
    expect(stepWires(b1, stepIndex(b1, 'b1-s4'))).toEqual([['a16', 'top-13']])
    // the meter: a terminal end first (it has no hole), in the order the step names the holes
    expect(stepWires(b1, stepIndex(b1, 'b1-s6'))).toEqual([
      ['DMM1:IN', 'e14'],
      ['DMM1:COM', 'top-15'],
    ])
    const i1 = lesson('i1-gpio-output')
    expect(stepActions(i1, stepIndex(i1, 'wire'))).toEqual([{ kind: 'wire', wires: [['a20', 'e36']] }])
    // a step that adds a part arms it; its holes are the part's, not a wire's
    expect(stepActions(b1, stepIndex(b1, 'b1-s3')).map(actionKey)).toEqual(['arm|resistor'])
  })

  it('every wire step of every lesson names real holes of its solution', () => {
    for (const id of ['b1-led-resistor', 'b4-button-debounce', 'b5-rc-time-constant', 'i1-gpio-output', 'i4-pwm', 'i5-uart', 'i7-i2c', 'i8-spi-595']) {
      const l = lesson(id)
      l.steps.forEach((_, i) => {
        for (const a of stepActions(l, i)) {
          if (a.kind !== 'wire') continue
          expect(a.wires.length, `${id} step ${i + 1}`).toBeGreaterThan(0)
          for (const [f, t] of a.wires) expect(l.solution.layout.wires.some((w) => (w.from === f && w.to === t) || (w.from === t && w.to === f))).toBe(true)
        }
      })
    }
  })

  it('the next missing wire after each one is drawn', () => {
    const b1 = lesson('b1-led-resistor')
    const a = stepActions(b1, stepIndex(b1, 'b1-s6')).find((x): x is Extract<LessonStepAction, { kind: 'wire' }> => x.kind === 'wire')!
    const start = b1.start.layout
    expect(pendingWire(a, start)).toEqual(['DMM1:IN', 'e14'])
    const one: CircuitLayout = { ...start, wires: [...start.wires, { id: 'W9', from: 'e14', to: 'DMM1:IN' }] }
    expect(pendingWire(a, one)).toEqual(['DMM1:COM', 'top-15'])
    expect(pendingWire(a, b1.solution.layout)).toBeNull()
  })

  it('「開始接線」 enters the wire tool and marks the start, then the other end', async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'start')
    const a = stepActions(b1, stepIndex(b1, 'b1-s4'))[0] as Extract<LessonStepAction, { kind: 'wire' }>
    startWiring(a, { lesson: b1, index: stepIndex(b1, 'b1-s4') })
    expect(useStore.getState().mode).toMatchObject({ kind: 'wire', from: null })
    expect(useLessonUi.getState().focus).toMatchObject({ holes: ['a16'] })
    expect(useLessonUi.getState().focus?.key.startsWith(WIRE_FOCUS)).toBe(true)
    useStore.getState().setMode({ kind: 'wire', from: 'a16', color: 'black' })
    expect(useLessonUi.getState().focus?.holes).toEqual(['top-13'])
    useStore.getState().addWire('a16', 'top-13', 'black')
    expect(useLessonUi.getState().focus).toBeNull()
  })
})

describe('a failing value check fixes in one click (LS-11 b)', () => {
  it('nearest E12 value inside the range', () => {
    expect(nearestE12(390, 220, 560)).toBe(390)
    expect(nearestE12(5250, 4700, 5800)).toBe(5600)
    expect(nearestE12(4700, 4400, 5000)).toBe(4700)
  })

  it('b1 step 3 with a 1 kΩ R1: 「把 R1 設為 330 Ω」, and the step passes after it', async () => {
    const b1 = lesson('b1-led-resistor')
    const check = b1.steps[stepIndex(b1, 'b1-s3')].check!
    const layout: CircuitLayout = {
      ...b1.start.layout,
      components: [...b1.start.layout.components, { id: 'R1', type: 'resistor', holes: ['top+10', 'a14'], params: { resistance: 1000 } }],
    }
    const [r] = await evaluateChecks({ layout, firmware: {} }, [check])
    expect(r.pass).toBe(false)
    const fixes = paramFixes(b1, check, r, layout)
    expect(fixes).toEqual([{ component: 'R1', param: 'resistance', value: 330, unit: 'Ω' }])
    // in range → nothing to fix
    const ok: CircuitLayout = { ...layout, components: layout.components.map((c) => (c.id === 'R1' ? { ...c, params: { resistance: 330 } } : c)) }
    const [r2] = await evaluateChecks({ layout: ok, firmware: {} }, [check])
    expect(r2.pass).toBe(true)
    expect(paramFixes(b1, check, r2, ok)).toEqual([])
    // the live store: applyParamFix sets the value
    useStore.setState({ layout })
    applyParamFix(fixes[0])
    expect(useStore.getState().layout.components.find((c) => c.id === 'R1')?.params?.resistance).toBe(330)
  })
})

describe('analyzer steps and the lesson instrument (LS-11 d)', () => {
  it('derives add-logic for frequency / duty at a part pin, merged per part', () => {
    const i1 = lesson('i1-gpio-output')
    expect(stepActions(i1, stepIndex(i1, 'analyzer'))).toEqual([{ kind: 'add-logic', component: 'U1', pins: ['PA5', 'PC13'] }, { kind: 'run' }])
    const i8 = lesson('i8-spi-595')
    expect(stepActions(i8, stepIndex(i8, 'analyzer')).map(actionKey)).toEqual(['run', 'logic|U2|QA'])
    // b5 reads the RC curve on the oscilloscope: no logic channel for the generator's terminal
    const b5 = lesson('b5-rc-time-constant')
    expect(stepActions(b5, 2).map(actionKey)).toEqual(['run'])
  })

  it('the tray opens on the lesson’s instrument', () => {
    expect(lessonInstrument(lesson('i1-gpio-output'))).toBe('logic')
    expect(lessonInstrument(lesson('i3-timer-interrupt'))).toBe('logic')
    expect(lessonInstrument(lesson('b5-rc-time-constant'))).toBe('scope')
    expect(lessonInstrument(lesson('b1-led-resistor'))).toBeNull()
  })

  it('one click puts PA5 and PC13 on the analyzer; a second says they are there', async () => {
    await loadLessonCircuit(lesson('i1-gpio-output'), 'start')
    expect(addLogicChannels('U1', ['PA5', 'PC13'])).toBe(true)
    const chans = useLab.getState().logicChannels
    expect(chans.map((c) => (c.source.kind === 'mcu-pin' ? c.source.pin : '?'))).toEqual(['PA5', 'PC13'])
    expect(lastToast()).toMatch(/已把 PA5、PC13 加到邏輯分析儀/)
    addLogicChannels('U1', ['PA5', 'PC13'])
    expect(useLab.getState().logicChannels).toHaveLength(2)
    expect(lastToast()).toBe('PA5、PC13 已經在邏輯分析儀上了')
  })
})

describe('「拿一顆電阻」 selects what it placed (LS-11 a)', () => {
  it('one placement → select mode, the new part selected', async () => {
    vi.useFakeTimers()
    useStore.setState({ layout: lesson('b1-led-resistor').start.layout })
    armPart('resistor')
    expect(useStore.getState().mode).toMatchObject({ kind: 'place', type: 'resistor' })
    // the placement click: commit, then the app re-arms repeat placement
    useStore.getState().addComponent('resistor', { holes: ['top+10', 'a14'] })
    useStore.getState().setMode({ kind: 'place', type: 'resistor', pickedHoles: [] })
    vi.runAllTimers()
    expect(useStore.getState().mode).toEqual({ kind: 'select' })
    expect(useStore.getState().selection).toEqual(['R1'])
    // P3 (final walkthrough): in the product chrome the opened properties sheet is the
    // feedback, so no 「已放置…」 toast covers its one-tap value chips. The classic chrome's
    // 'Placed R1 — its properties are open' is covered in tests/qa-lessons.test.ts.
    expect(getToasts().some((x) => x.text.startsWith('已放置'))).toBe(false)
  })

  it('leaving placement another way stops watching', () => {
    vi.useFakeTimers()
    useStore.setState({ layout: lesson('b1-led-resistor').start.layout })
    armPart('resistor')
    useStore.getState().setMode({ kind: 'select' })
    useStore.getState().addComponent('resistor', { holes: ['top+10', 'a14'] })
    vi.runAllTimers()
    expect(useStore.getState().selection).toEqual([])
  })
})
