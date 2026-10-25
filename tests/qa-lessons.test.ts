/**
 * Release QA — lessons (LS-F1…LS-F10):
 *  - F1 every way into a lesson lands on ITS circuit: lessonOnBoard (b1's
 *    load is never b2's, an edited b1 is still b1's, the parts fallback after
 *    a reload), startGuide on an empty / a foreign board, 下一課 (goToLesson);
 *  - F2 the wire tool the coach armed leaves once the step's wires are in,
 *    and when the guide moves to a step without wires; the dock's is left alone;
 *  - F3 a passed step's sub-checks fold to one line in the coach;
 *  - F4 the burst finder (pure, and on the a3 firmware's real PA10 output),
 *    the a3 analyzer step's view and its search;
 *  - F5 a lesson's circuit keeps only the analyzer channels it reads;
 *  - F6 a measuring step checks itself while the simulation runs;
 *  - F7 「拆掉 j11 → bot-7 這條線」 in one undo step;
 *  - F8 i2 step 2 marks both wires and frames bot-47;
 *  - F9 b2's meter steps offer 開始接線, derived meter wires, the unwired-lead text;
 *  - F10 rail holes read 「上方 + 電源軌第 0 孔（top+0）」, a missing part offers
 *    載入起始電路 instead of a mark;
 *  - the qa-lessons dictionary is Taiwan-usage Chinese.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import qaLessons from '../src/i18n/zh-TW/qa-lessons'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress, useLessonProgress } from '../src/lessons/progress'
import { actionKey, meterWires, pendingWire, stepActions, wiresOnBoard } from '../src/lessons/step-actions'
import { evaluateChecks, lessonCircuitInput } from '../src/lessons/engine/evaluate'
import { holeRefText, pinRefText } from '../src/lessons/engine/refs'
import type { Lesson, LessonCheck, LessonStepAction } from '../src/lessons/types'
import type { CircuitLayout } from '../src/model/types'
import { loadFirmwareFile } from '../src/mcu/loader'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { LogicCapture } from '../src/sim/coordinator/api'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { useLogicReveal } from '../src/ui/embedded/probe-actions'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  __resetLessonLayoutForTests,
  addLogicChannels,
  coachArmedWiring,
  goToLesson,
  goToStep,
  latestBurst,
  lessonLogicRefs,
  lessonOnBoard,
  lessonPartsOnBoard,
  loadLessonCircuit,
  runningCheckDelay,
  startGuide,
  startWiring,
  stopGuide,
  unwireFromStep,
  useAutoCheck,
  watchRunningStepChecks,
} from '../src/ui/lessons/actions'
import { CheckResults, startHoldsMissing } from '../src/ui/lessons/CheckResults'
import { LessonView, StepBody } from '../src/ui/lessons/LessonBrowser'
import { runKey, useLessonUi } from '../src/ui/lessons/state'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './i18n/zh-check'

const LONG = { timeout: 120_000 }
const HERE = dirname(fileURLToPath(import.meta.url))
const lesson = (id: string): Lesson => lessonById(id)!
const stepIndex = (l: Lesson, id: string) => l.steps.findIndex((s) => s.id === id)
const memory = new Map<string, string>()
const toasts = (): string[] => getToasts().map((x) => x.text)
const lastToast = (): string => getToasts()[getToasts().length - 1]?.text ?? ''
const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ids = () => useStore.getState().layout.components.map((c) => c.id).sort()
/**
 * A server render reads a store's INITIAL state (zustand: getServerState ||
 * getInitialState): show `patches` there while `el` renders.
 */
function renderWith(el: ReturnType<typeof createElement>, patches: [{ getInitialState: () => object }, Record<string, unknown>][]): string {
  const saved: [Record<string, unknown>, Record<string, unknown>][] = []
  for (const [store, patch] of patches) {
    const init = store.getInitialState() as Record<string, unknown>
    const before: Record<string, unknown> = {}
    for (const k of Object.keys(patch)) before[k] = init[k]
    saved.push([init, before])
    Object.assign(init, patch)
  }
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) Object.assign(init, before)
  }
}
const wireOf = (l: Lesson, id: string) =>
  stepActions(l, stepIndex(l, id)).find((x): x is Extract<LessonStepAction, { kind: 'wire' }> => x.kind === 'wire')!

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
  __resetLessonLayoutForTests()
  useStore.setState({ layout: EMPTY, selection: [], mode: { kind: 'select' }, running: false, simTime: 0 })
  useLab.setState({ firmware: {}, mcus: {}, logicChannels: [] })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null, confirm: null })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  stopGuide()
  useStore.setState({ running: false })
  __setFirmwareBlobStoreForTests(null)
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- F1
describe('every entry point lands on the lesson’s own circuit (LS-F1)', () => {
  it('lessonOnBoard: b1’s load is b1’s, never b2’s — also after edits; b2’s load is b2’s', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    expect(await loadLessonCircuit(b1, 'start')).toBe(true)
    const layout = () => useStore.getState().layout
    expect(lessonOnBoard(b1, layout())).toBe(true)
    // b1's board holds PS1 and DMM1 (two of b2's four named parts): the parts alone would not tell
    expect(lessonOnBoard(b2, layout())).toBe(false)
    // edits keep it b1's
    useStore.getState().setMode({ kind: 'place', type: 'resistor', pickedHoles: [] })
    useStore.getState().addComponent('resistor', { holes: ['top+10', 'a14'] })
    useStore.getState().setParam('R1', 'resistance', 330)
    useStore.getState().setMode({ kind: 'select' })
    expect(lessonOnBoard(b1, layout())).toBe(true)
    expect(lessonOnBoard(b2, layout())).toBe(false)
    expect(await loadLessonCircuit(b2, 'start')).toBe(true)
    expect(lessonOnBoard(b2, layout())).toBe(true)
    expect(lessonOnBoard(b1, layout())).toBe(false)
  })

  it('without a lesson load (after a reload) the parts decide: start parts there, nothing foreign', () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    const a3 = lesson('a3-uart-dma')
    const i1 = lesson('i1-gpio-output')
    expect(lessonOnBoard(b1, b1.start.layout)).toBe(true)
    expect(lessonOnBoard(b1, b1.solution.layout)).toBe(true)
    expect(lessonOnBoard(b2, b1.solution.layout)).toBe(false) // no DMM2, an LED
    expect(lessonOnBoard(a3, i1.solution.layout)).toBe(false) // i1's resistor and LED are not a3's
    expect(lessonOnBoard(b1, i1.solution.layout)).toBe(false) // a Blue Pill under b1
    // a part of a type the lesson uses (b2's optional load resistor) keeps it the lesson's
    const loaded: CircuitLayout = {
      ...b2.solution.layout,
      components: [...b2.solution.layout.components, { id: 'R5', type: 'resistor', holes: ['d12', 'top-11'], params: { resistance: 10000 } }],
    }
    expect(lessonPartsOnBoard(b2, loaded)).toBe(true)
  })

  it('every lesson’s own circuits are its own by parts', () => {
    for (const id of ['b1-led-resistor', 'b2-voltage-divider', 'i1-gpio-output', 'i2-exti-button', 'a3-uart-dma']) {
      const l = lesson(id)
      expect(lessonPartsOnBoard(l, l.start.layout), `${id} start`).toBe(true)
      expect(lessonPartsOnBoard(l, l.solution.layout), `${id} solution`).toBe(true)
    }
  })

  it('開始引導 on an empty board loads the starting circuit and guides step 1', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    startGuide(b1)
    // the load is async (firmware) — wait for it
    for (let i = 0; i < 50 && useLessonUi.getState().coachId !== b1.id; i++) await wait(20)
    expect(ids()).toEqual(['DMM1', 'LED1', 'PS1'])
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    expect(useLessonProgress.getState().lessons[b1.id]?.step).toBe(0)
  })

  it('開始引導 on another circuit asks to replace it and starts nothing', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    await loadLessonCircuit(b1, 'start')
    startGuide(b2, 0)
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: b2.id, which: 'start' })
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    expect(ids()).toEqual(['DMM1', 'LED1', 'PS1'])
  })

  it('下一課 stops the old guide, opens the new lesson’s steps and asks to load its circuit', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    await loadLessonCircuit(b1, 'solution')
    goToLesson(b2)
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(useLessonUi.getState().viewId).toBe(b2.id)
    expect(useLessonUi.getState().section).toBe('steps')
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: b2.id, which: 'start' })
    // 取代 → b2's start circuit and its guide on step 1 (「放上 R1」 places R1, not R2)
    await loadLessonCircuit(b2, 'start')
    expect(ids()).toEqual(['DMM1', 'DMM2', 'PS1'])
    expect(useLessonUi.getState().coachId).toBe(b2.id)
  })

  it('the lesson view: 載入起始電路 until the lesson’s circuit is on the board, then 檢查我的電路', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    await loadLessonCircuit(b1, 'start')
    const actions = (l: Lesson) => {
      const view = renderWith(createElement(LessonView, { lesson: l, variant: 'panel' }), [[useStore, { layout: useStore.getState().layout }]])
      return view.slice(view.indexOf('lsn-actions'), view.indexOf('lsn-tabs'))
    }
    const filled = (row: string) => /lg-btn-filled[^>]*>([^<]*)</.exec(row)?.[1]
    useLessonProgress.getState().start(b2.id)
    const b2Row = () =>
      renderWith(createElement(LessonView, { lesson: b2, variant: 'panel' }), [
        [useStore, { layout: useStore.getState().layout }],
        [useLessonProgress, { lessons: useLessonProgress.getState().lessons }],
      ])
    expect(filled(actions(b2))).toBe('載入起始電路')
    expect(actions(b2)).not.toContain('重新載入起始電路')
    // started before, but off its circuit: the guide starts over (never 「繼續引導」)
    expect(b2Row()).toContain('開始引導')
    expect(b2Row()).not.toContain('繼續引導')
    expect(filled(actions(b1))).toBe('檢查我的電路')
    expect(actions(b1)).toContain('重新載入起始電路')
  })
})

// ---------------------------------------------------------------- F2
describe('the coach’s wire tool leaves once the step’s wires are in (LS-F2)', () => {
  it('b1 step 4: a16 → top-13 drawn → select mode and the toast', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'solution')
    // the cathode wire is the one step 4 asks for: take it off, then draw it with 開始接線
    const w = useStore.getState().layout.wires.find((x) => (x.from === 'a16' && x.to === 'top-13') || (x.to === 'a16' && x.from === 'top-13'))!
    useStore.getState().removeWire(w.id)
    const index = stepIndex(b1, 'b1-s4')
    goToStep(b1, index)
    startWiring(wireOf(b1, 'b1-s4'), { lesson: b1, index })
    expect(useStore.getState().mode.kind).toBe('wire')
    expect(coachArmedWiring()).toBe(true)
    // the click handler (App.tsx): first end, the wire, the tool re-armed for a next wire
    useStore.getState().setMode({ kind: 'wire', from: 'a16', color: 'black' })
    useStore.getState().addWire('a16', 'top-13', 'black')
    useStore.getState().setMode({ kind: 'wire', from: null, color: 'black' })
    expect(useStore.getState().mode.kind).toBe('wire')
    await wait(5)
    expect(useStore.getState().mode).toEqual({ kind: 'select' })
    expect(lastToast()).toBe('導線都接好了，已離開導線工具')
    expect(coachArmedWiring()).toBe(false)
  })

  it('下一步 to a step without wires returns to select (no toast); the dock’s wire mode is left alone', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'start')
    const index = stepIndex(b1, 'b1-s4')
    goToStep(b1, index)
    startWiring(wireOf(b1, 'b1-s4'), { lesson: b1, index })
    for (const x of getToasts()) dismissToast(x.id)
    goToStep(b1, index + 1)
    expect(useStore.getState().mode).toEqual({ kind: 'select' })
    expect(toasts()).toEqual([])
    // the learner's own wire tool (the dock)
    useStore.getState().setMode({ kind: 'wire', from: null, color: 'red' })
    goToStep(b1, index)
    goToStep(b1, index + 1)
    stopGuide()
    expect(useStore.getState().mode.kind).toBe('wire')
  })

  it('下一課 leaves the coach’s wire tool too', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'start')
    const index = stepIndex(b1, 'b1-s4')
    goToStep(b1, index)
    startWiring(wireOf(b1, 'b1-s4'), { lesson: b1, index })
    goToLesson(lesson('b2-voltage-divider'))
    expect(useStore.getState().mode).toEqual({ kind: 'select' })
  })
})

// ---------------------------------------------------------------- F3
describe('a passed step folds its sub-checks in the coach (LS-F3)', () => {
  it('「3 / 3 項條件成立」 instead of the list, the list when it is not done', () => {
    const b1 = lesson('b1-led-resistor')
    const index = stepIndex(b1, 'b1-s6')
    const step = b1.steps[index]
    const key = runKey(b1.id, step.id)
    const child = (k: string) => ({ key: k, kind: 'connected' as const, label: `條件 ${k}`, pass: true, detail: '' })
    const runs = {
      [key]: { status: 'done', progress: null, at: 1, results: [{ key: '0', kind: 'all', label: '全部', pass: true, detail: '', children: [child('0.0'), child('0.1'), child('0.2')] }] },
    }
    const render = (compact: boolean) =>
      renderWith(createElement(StepBody, { lesson: b1, index, compact }), [
        [useLessonUi, { runs }],
        [useLessonProgress, { lessons: useLessonProgress.getState().lessons }],
      ])
    expect(render(true)).toContain('條件 0.1')
    useLessonProgress.getState().markStepDone(b1.id, step.id)
    const folded = render(true)
    expect(folded).toContain('3 / 3 項條件成立')
    expect(folded).toMatch(/class="lsn-checks-folded" aria-expanded="false"/)
    expect(folded).not.toContain('條件 0.1')
    // the lesson page (not compact) keeps the list
    expect(render(false)).toContain('條件 0.1')
  })
})

// ---------------------------------------------------------------- F4
describe('the a3 analyzer step shows the 40 B message (LS-F4)', () => {
  it('latestBurst: the newest complete burst long enough; cut bursts and short ones do not count', () => {
    const train = (t0: number, n: number, dt = 87e-6) => Array.from({ length: n }, (_, i) => t0 + i * dt)
    const times = [...train(0.1, 6), ...train(0.3, 24), ...train(0.5, 41), ...train(0.7, 6)]
    // the 40 B-like train (41 edges ≈ 3.48 ms) is the latest one ≥ 3 ms
    const b = latestBurst(times, { t0: 0, t1: 0.8, minBurst: 0.003 })
    expect(b).not.toBeNull()
    expect(b!.start).toBeCloseTo(0.5, 9)
    expect(b!.end - b!.start).toBeCloseTo(40 * 87e-6, 9)
    // without a minimum: the newest complete burst (0.7)
    expect(latestBurst(times, { t0: 0, t1: 0.8 })!.start).toBeCloseTo(0.7, 9)
    // the window ends inside the last burst: it is not complete
    expect(latestBurst(times, { t0: 0, t1: 0.7003 })!.start).toBeCloseTo(0.5, 9)
    // the window starts inside a burst: not complete either
    expect(latestBurst(train(0.5, 41), { t0: 0.5001, t1: 0.6, minBurst: 0.003 })).toBeNull()
    expect(latestBurst([], { t0: 0, t1: 1 })).toBeNull()
  })

  it('on the real a3 firmware: PA10 carries one 3.47 ms train for msg #3', LONG, () => {
    const a3 = lesson('a3-uart-dma')
    const res = loadFirmwareFile('lesson-a3-uart-dma.elf', new Uint8Array(readFileSync(join(HERE, '../firmware/dist/lesson-a3-uart-dma.elf'))))
    if (!res.ok) throw new Error(res.error)
    const co = new SimulationCoordinator()
    co.load(a3.solution.layout, 1)
    co.setFirmware('U1', res.image)
    co.setLogicChannels([
      { index: 0, label: 'PA10', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA10' } },
      { index: 1, label: 'PB0', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PB0' } },
    ])
    while (co.time < 0.6) co.advance(0.005)
    const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
    if (q.kind !== 'logic') throw new Error('logic')
    const pa10 = q.capture.traces.find((x) => x.index === 0)!
    const b = latestBurst(pa10.times, { t0: q.capture.t0, t1: q.capture.tNow ?? q.capture.t1, minBurst: 0.003 })
    expect(b).not.toBeNull()
    expect(b!.start).toBeGreaterThan(0.49)
    expect(b!.start).toBeLessThan(0.53)
    // 40 characters of 86.8 µs, the last stop bit not an edge
    expect(b!.end - b!.start).toBeGreaterThan(0.0033)
    expect(b!.end - b!.start).toBeLessThan(0.0035)
    // PB0 pulses (the 4 interrupts) inside a 5 ms window centred on it
    const mid = (b!.start + b!.end) / 2
    const pb0 = q.capture.traces.find((x) => x.index === 1)!
    const rises = Array.from(pb0.times).filter((t, i) => pb0.levels[i] === 1 && t >= mid - 0.0025 && t <= mid + 0.0025)
    expect(rises.length).toBe(4)
  })

  it('the step carries the view; derived / merged add-logic actions keep theirs; the key tells them apart', () => {
    const a3 = lesson('a3-uart-dma')
    const a = stepActions(a3, stepIndex(a3, 'analyzer'))[0]
    expect(a).toEqual({ kind: 'add-logic', component: 'U1', pins: ['PA10', 'PB0'], view: { span: 0.005, burstOn: 'PA10', minBurst: 0.003, label: '40 B 訊息' } })
    expect(actionKey(a)).toBe('logic|U1|PA10,PB0|0.005|PA10|0.003')
    expect(actionKey({ kind: 'add-logic', component: 'U1', pins: ['PA10', 'PB0'] })).toBe('logic|U1|PA10,PB0')
  })

  it('stopped: the channels go on and the toast says to run first; running: the analyzer jumps to the burst', LONG, async () => {
    const a3 = lesson('a3-uart-dma')
    await loadLessonCircuit(a3, 'start')
    const view = { span: 0.005, burstOn: 'PA10', minBurst: 0.003, label: '40 B 訊息' }
    expect(addLogicChannels('U1', ['PA10', 'PB0'], view)).toBe(true)
    await wait(10)
    expect(lastToast()).toBe('已把 PA10、PB0 加到邏輯分析儀——按 ▶ 執行模擬後，再按一次這個按鈕跳到最近一筆 40 B 訊息')
    // running, with a capture holding a 40-character train at 0.5 s
    const train = Float64Array.from({ length: 41 }, (_, i) => 0.5 + i * 86.8e-6)
    const cap: LogicCapture = {
      t0: 0,
      t1: 0.62,
      tNow: 0.62,
      overflow: false,
      traces: [{ index: 0, label: 'PA10', initial: 1, times: train, levels: Uint8Array.from(train, (_, i) => (i % 2 === 0 ? 0 : 1)), exact: true }],
    }
    useLab.setState({ queryLogic: async () => cap })
    useStore.setState({ running: true, simTime: 0.62 })
    const before = useLogicReveal.getState().request?.seq ?? 0
    addLogicChannels('U1', ['PA10', 'PB0'], view)
    for (let i = 0; i < 50 && (useLogicReveal.getState().request?.seq ?? 0) === before; i++) await wait(10)
    const r = useLogicReveal.getState().request!
    expect(r.seq).toBe(before + 1)
    expect(r.span).toBe(0.005)
    expect(r.marker).toBeCloseTo(0.5, 9)
    expect(r.t).toBeCloseTo(0.5 + 20 * 86.8e-6, 9)
    expect(lastToast()).toBe('已在邏輯分析儀上跳到最近一筆 40 B 訊息（視窗 5 ms）')
  })
})

// ---------------------------------------------------------------- F5
describe('a lesson’s circuit keeps only the analyzer channels it reads (LS-F5)', () => {
  it('i1’s PA5 / PC13 and their trigger and decoder do not carry into a3; i1 keeps its own', LONG, async () => {
    const i1 = lesson('i1-gpio-output')
    await loadLessonCircuit(i1, 'start')
    addLogicChannels('U1', ['PA5', 'PC13'])
    useLab.getState().setLogicView({ trigger: { kind: 'edge', channel: 0, slope: 'rising', pattern: {}, pre: 0.1 } })
    await loadLessonCircuit(i1, 'start')
    expect(useLab.getState().logicChannels.map((c) => (c.source.kind === 'mcu-pin' ? c.source.pin : '?'))).toEqual(['PA5', 'PC13'])
    expect(useLab.getState().logicView.trigger).not.toBeNull()
    const a3 = lesson('a3-uart-dma')
    expect(lessonLogicRefs(a3)).toEqual([
      { component: 'U1', pin: 'PA10' },
      { component: 'U1', pin: 'PB0' },
    ])
    await loadLessonCircuit(a3, 'start')
    expect(useLab.getState().logicChannels).toEqual([])
    expect(useLab.getState().logicView.trigger).toBeNull()
    // step 4: PA10 on channel 0 — where the default trigger looks
    addLogicChannels('U1', ['PA10', 'PB0'])
    expect(useLab.getState().logicChannels.map((c) => [c.index, c.source.kind === 'mcu-pin' ? c.source.pin : '?'])).toEqual([
      [0, 'PA10'],
      [1, 'PB0'],
    ])
  })
})

// ---------------------------------------------------------------- F6
describe('a measuring step checks itself while the simulation runs (LS-F6)', () => {
  it('how long each kind of check waits', () => {
    const b1 = lesson('b1-led-resistor')
    expect(runningCheckDelay(b1.steps[stepIndex(b1, 'b1-s5')].check!)).toBe(1) // 0.05 s → at least 1 s
    expect(runningCheckDelay(b1.steps[stepIndex(b1, 'b1-s6')].check!)).toBe(1) // an 'all' with a reading
    expect(runningCheckDelay(b1.steps[stepIndex(b1, 'b1-s4')].check!)).toBeNull() // structural
    expect(runningCheckDelay({ kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'x', seconds: 3 })).toBe(3)
    expect(runningCheckDelay({ kind: 'firmware-checks', project: 'hal-blink' })).toBe(1)
    expect(runningCheckDelay({ kind: 'firmware-loaded', component: 'U1' })).toBeNull()
  })

  it('b1 step 5: nothing while stopped; running, it waits 1 s of simulated time, then passes without a ✕', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'solution')
    const index = stepIndex(b1, 'b1-s5')
    goToStep(b1, index)
    const key = runKey(b1.id, 'b1-s5')
    const stop = watchRunningStepChecks(5)
    try {
      await wait(40)
      expect(useLessonUi.getState().runs[key]).toBeUndefined()
      expect(useAutoCheck.getState().key).toBeNull()
      useStore.setState({ running: true, simTime: 0.2 })
      await wait(40)
      expect(useAutoCheck.getState()).toEqual({ key, inSeconds: 1 })
      expect(useLessonUi.getState().runs[key]).toBeUndefined()
      useStore.setState({ simTime: 1.25 })
      for (let i = 0; i < 400 && !useLessonProgress.getState().lessons[b1.id]?.stepsDone.includes('b1-s5'); i++) await wait(25)
      expect(useLessonProgress.getState().lessons[b1.id]?.stepsDone).toContain('b1-s5')
      expect(useLessonUi.getState().attempted[key]).toBeUndefined()
    } finally {
      stop()
    }
  })

  it('a failing auto-check stays 尚未完成 and retries only after 2 s of simulated time', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'start') // no resistor: LED1 draws nothing
    const index = stepIndex(b1, 'b1-s5')
    goToStep(b1, index)
    const key = runKey(b1.id, 'b1-s5')
    const stop = watchRunningStepChecks(5)
    try {
      useStore.setState({ running: true, simTime: 0.1 })
      await wait(30)
      useStore.setState({ simTime: 1.2 })
      for (let i = 0; i < 400 && useLessonUi.getState().runs[key]?.status !== 'done'; i++) await wait(25)
      expect(useLessonUi.getState().runs[key]?.results?.[0].pass).toBe(false)
      expect(useLessonUi.getState().attempted[key]).toBeUndefined()
      const at = useLessonUi.getState().runs[key]!.at
      useStore.setState({ simTime: 2.5 })
      await wait(60)
      expect(useLessonUi.getState().runs[key]!.at).toBe(at) // < 2 s after the try
      expect(useAutoCheck.getState()).toEqual({ key, inSeconds: 1 })
      const html = renderWith(createElement(StepBody, { lesson: b1, index, compact: true }), [
        [useLessonUi, { runs: useLessonUi.getState().runs, attempted: {} }],
        [useAutoCheck, useAutoCheck.getState()],
      ])
      expect(html).toContain('模擬執行中，約 1 秒後自動檢查…')
      expect(html).toContain('尚未完成')
      expect(html).not.toContain('is-fail')
    } finally {
      stop()
    }
  })
})

// ---------------------------------------------------------------- F7
describe('the end of a jumper experiment in one click (LS-F7)', () => {
  it('a3 rxne / normal: 開始接線 → 重置 MCU → 拆掉 → ▶; the text says to remove it in its first paragraph', () => {
    const a3 = lesson('a3-uart-dma')
    for (const [id, hole, rail] of [
      ['rxne', 'j11', 'bot-7'],
      ['normal', 'j10', 'bot-6'],
    ]) {
      const i = stepIndex(a3, id)
      expect(stepActions(a3, i).map(actionKey)).toEqual([`wire|${hole}>${rail}`, 'reset|mcu|', `unwire|${hole}>${rail}`, 'run'])
      expect(a3.steps[i].body.split('\n\n')[0].endsWith('看完後請拆掉這條線，再按「重置 MCU」。')).toBe(true)
    }
  })

  it('the button shows only while the wire is in; it removes it in one undo step', LONG, async () => {
    const a3 = lesson('a3-uart-dma')
    await loadLessonCircuit(a3, 'start')
    const index = stepIndex(a3, 'rxne')
    const un = stepActions(a3, index).find((x): x is Extract<LessonStepAction, { kind: 'unwire' }> => x.kind === 'unwire')!
    const row = () => {
      const html = renderWith(createElement(StepBody, { lesson: a3, index, compact: true }), [[useStore, { layout: useStore.getState().layout }]])
      return html.slice(html.indexOf('lsn-actrow'), html.indexOf('lsn-step-check'))
    }
    expect(row()).not.toContain('拆掉 j11 → bot-7 這條線')
    expect(row()).toContain('開始接線（j11 → bot-7）')
    useStore.getState().addWire('j11', 'bot-7', 'black')
    expect(wiresOnBoard(un, useStore.getState().layout)).toHaveLength(1)
    expect(row()).toContain('拆掉 j11 → bot-7 這條線')
    expect(row()).not.toContain('開始接線（j11 → bot-7）')
    expect(unwireFromStep(un)).toBe(true)
    expect(lastToast()).toBe('已拆掉 j11 → bot-7 這條線')
    expect(wiresOnBoard(un, useStore.getState().layout)).toHaveLength(0)
    useStore.getState().undo()
    expect(wiresOnBoard(un, useStore.getState().layout)).toHaveLength(1)
    // the step check passes once it is out again
    useStore.getState().redo()
    const res = await evaluateChecks({ layout: useStore.getState().layout, firmware: {} }, [a3.steps[index].check!])
    expect(res[0].pass).toBe(true)
  })
})

// ---------------------------------------------------------------- F8
describe('i2 step 2 marks both wires and frames the GND hole (LS-F8)', () => {
  it('開始接線 walks j10 → j45 then j47 → bot-47; bot-47 is highlighted', () => {
    const i2 = lesson('i2-exti-button')
    const i = stepIndex(i2, 'wire')
    expect(i2.steps[i].highlight?.holes).toContain('bot-47')
    const a = wireOf(i2, 'wire')
    expect(a.wires).toEqual([
      ['j10', 'j45'],
      ['j47', 'bot-47'],
    ])
    expect(pendingWire(a, i2.start.layout)).toEqual(['j10', 'j45'])
    expect(pendingWire(a, i2.solution.layout)).toBeNull()
    // the text, the intro and the solution name the same hole
    expect(i2.steps[i].body).toContain('`bot-47`')
    expect(i2.wiring).toContain('`bot-47`')
    expect(i2.solution.layout.wires.some((w) => [w.from, w.to].includes('bot-47'))).toBe(true)
  })
})

// ---------------------------------------------------------------- F9
describe('meter steps wire their leads (LS-F9)', () => {
  it('b2 steps 2 and 4 offer 開始接線 (DMM IN 端 → …) and ▶; the text names the leads', () => {
    const b2 = lesson('b2-voltage-divider')
    expect(stepActions(b2, stepIndex(b2, 'b2-s2'))).toEqual([
      { kind: 'wire', wires: [['DMM1:IN', 'e12'], ['DMM1:COM', 'top-12']] },
      { kind: 'run' },
    ])
    expect(stepActions(b2, stepIndex(b2, 'b2-s4'))).toEqual([
      { kind: 'wire', wires: [['DMM2:IN', 'e26'], ['DMM2:COM', 'top-24']] },
      { kind: 'run' },
    ])
    const s2 = b2.steps[stepIndex(b2, 'b2-s2')].body
    expect(s2).toContain('DMM1 IN 端接到 `e12`、DMM1 COM 端接到 `top-12`')
    expect(s2).not.toContain('DMM1:IN')
    const html = renderToStaticMarkup(createElement(StepBody, { lesson: b2, index: stepIndex(b2, 'b2-s2'), compact: true }))
    expect(html).toContain('開始接線（DMM1 IN 端 → e12）')
    expect(html).toContain('執行模擬')
  })

  it('a measure at a meter terminal derives the meter’s leads (generic), merged with a step’s own wires', () => {
    const b2 = lesson('b2-voltage-divider')
    expect(meterWires(b2, { terminal: 'DMM2:IN' })).toEqual([
      ['DMM2:IN', 'e26'],
      ['DMM2:COM', 'top-24'],
    ])
    expect(meterWires(b2, { terminal: 'PS1:+' })).toEqual([])
    expect(meterWires(b2, { component: 'R1', pin: '1' })).toEqual([])
    // the same step without its explicit actions: derived from the check
    const i = stepIndex(b2, 'b2-s2')
    const derived: Lesson = { ...b2, steps: b2.steps.map((s, k) => (k === i ? { ...s, action: undefined } : s)) }
    expect(stepActions(derived, i)).toEqual(stepActions(b2, i))
    // b1 step 6 (its holes and its reading ask for the same leads): one 開始接線
    const b1 = lesson('b1-led-resistor')
    const s6 = stepActions(b1, stepIndex(b1, 'b1-s6'))
    expect(s6.filter((a) => a.kind === 'wire')).toEqual([{ kind: 'wire', wires: [['DMM1:IN', 'e14'], ['DMM1:COM', 'top-15']] }])
  })

  it('檢查此步驟 before the leads are wired: 「DMM1 IN 端還沒接線，量不到電壓」, then the COM lead', LONG, async () => {
    const b2 = lesson('b2-voltage-divider')
    const check = b2.steps[stepIndex(b2, 'b2-s2')].check as LessonCheck
    const solution = b2.solution.layout
    // the dividers in, no meter leads
    const noLeads: CircuitLayout = { ...solution, wires: solution.wires.filter((w) => !w.from.startsWith('DMM') && !w.to.startsWith('DMM')) }
    let res = await evaluateChecks({ layout: noLeads, firmware: {} }, [check])
    expect(res[0].pass).toBe(false)
    expect(res[0].detail).toBe('DMM1 IN 端還沒接線，量不到電壓')
    const inOnly: CircuitLayout = { ...noLeads, wires: [...noLeads.wires, { id: 'W9', from: 'DMM1:IN', to: 'e12', color: 'red' }] }
    res = await evaluateChecks({ layout: inOnly, firmware: {} }, [check])
    expect(res[0].detail).toBe('DMM1 COM 端還沒接線，量不到電壓')
    res = await evaluateChecks(await lessonCircuitInput(b2.solution), [check])
    expect(res[0].pass).toBe(true)
  })
})

// ---------------------------------------------------------------- F10
describe('rail holes by name, missing parts by the starting circuit (LS-F10)', () => {
  it('a rail hole names its rail, a strip hole stays its code', () => {
    expect(holeRefText('top+0')).toBe('上方 + 電源軌第 0 孔（top+0）')
    expect(holeRefText('bot-47')).toBe('下方 − 電源軌第 47 孔（bot-47）')
    expect(pinRefText({ hole: 'c45' })).toBe('c45')
    __setLangForTests('en')
    expect(holeRefText('top+0')).toBe('top + rail hole 0 (top+0)')
    __setLangForTests('zh-TW')
  })

  it('i2: 「U1 PB12（板上 B12）與上方 + 電源軌第 0 孔（top+0）位於不同的網路。」', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    const check = i2.acceptance[3]
    const res = await evaluateChecks({ layout: i2.solution.layout, firmware: {} }, [check])
    expect(res[0].detail).toBe('U1 PB12（板上 B12）與上方 + 電源軌第 0 孔（top+0）位於不同的網路。')
  })

  it('b2 checked on b1’s circuit: 「電路中沒有 DMM2」 offers 載入起始電路, never a mark', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    const b2 = lesson('b2-voltage-divider')
    const res = await evaluateChecks({ layout: b1.solution.layout, firmware: {} }, b2.acceptance)
    const dmm2 = res.find((r) => r.detail === '電路中沒有 DMM2')!
    expect(dmm2).toBeDefined()
    expect(dmm2.missing).toEqual(['DMM2'])
    expect(startHoldsMissing(b2, dmm2.missing)).toBe(true)
    expect(startHoldsMissing(b1, ['resistor'])).toBe(false) // has-part of a part the learner adds
    const run = { status: 'done' as const, progress: null, results: [dmm2], at: 1 }
    const html = renderWith(createElement(CheckResults, { checks: [b2.acceptance[1]], run, runId: 'x', lesson: b2 }), [
      [useStore, { layout: b1.solution.layout }],
    ])
    expect(html).toContain('電路中沒有 DMM2')
    expect(html).toContain('載入起始電路')
    expect(html).not.toContain('在電路板上標示')
    // a has-part failure carries its type, an 'all' its children's
    const hp = await evaluateChecks({ layout: EMPTY, firmware: {} }, [{ kind: 'has-part', type: 'resistor' }])
    expect(hp[0].missing).toEqual(['resistor'])
  })

  it('b1’s text names top-0 like top+0', () => {
    const b1 = lesson('b1-led-resistor')
    expect(b1.wiring).toContain('`top-0`（上方 − 電源軌第 0 孔）')
    expect(b1.steps[0].body).toContain('`top-0`（上方 − 電源軌第 0 孔）')
  })
})

// ---------------------------------------------------------------- dictionary
describe('the qa-lessons dictionary', () => {
  it('is Taiwan-usage Traditional Chinese with intact placeholders', () => {
    const bad: string[] = []
    for (const [src, zh] of Object.entries(qaLessons)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (ph(src) !== ph(zh)) bad.push(`placeholders: ${src}`)
      if (!/[一-鿿]/.test(zh)) bad.push(`not Chinese: ${src}`)
      const left = englishLeft(zh.replace(/\{\w+\}/g, ' '))
      if (left.length) bad.push(`English left in ${src}: ${left.join(' ')}`)
      for (const term of MAINLAND_TERMS) if (zh.includes(term)) bad.push(`mainland term ${term}: ${src}`)
      if (halfWidthPunctuation(zh).length) bad.push(`half-width punctuation: ${zh}`)
      // 執行中 only as the run phase (H9)
      if (/執行中/.test(zh.replace(/模擬執行中/g, ''))) bad.push(`執行中: ${zh}`)
    }
    expect(bad).toEqual([])
  })
})
