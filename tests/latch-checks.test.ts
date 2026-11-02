/**
 * Keep-pressed latch 「保持按下」 × lesson checks (src/ui/lessons/actions.ts
 * liveEvalInput / runStepCheck): a verdict never depends on where the
 * learner's hand is.
 *  - liveEvalInput('released') — the default, and what the acceptance
 *    (runAcceptance) and every check that presses / turns its inputs itself
 *    use — strips the transient params (store stripTransientParams): every
 *    button starts released at power-on unless the check presses it;
 *  - a step check that only observes (the step asks the learner to press or
 *    release, then looks — i2 「確認內部上拉」, b4 「SW2 放開後 Y 點…」) sees
 *    the circuit as it is now ('live'); when it fails on 檢查此步驟 while a
 *    part is kept pressed, a toast names it with 〔放開〕 (product chrome).
 * Real stores, the bundled firmware, the in-process evaluator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import type { Lesson, LessonCheck } from '../src/lessons/types'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { isLatched, setLatched, useLatchHolds } from '../src/ui/embedded/latch'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  drivesInputs,
  holdsMayExplain,
  liveEvalInput,
  loadLessonCircuit,
  runAcceptance,
  runStepCheck,
  stepCheckHands,
  stopGuide,
  watchStepChecks,
} from '../src/ui/lessons/actions'
import { runKey, useLessonUi } from '../src/ui/lessons/state'
import { useLessonProgress } from '../src/lessons/progress'
import type { EvaluatedCheck } from '../src/lessons/engine/evaluate'

const LONG = { timeout: 180_000 }
const memory = new Map<string, string>()
const lesson = (id: string): Lesson => lessonById(id)!
const stepOf = (l: Lesson, id: string) => l.steps.findIndex((s) => s.id === id)
const checkOf = (l: Lesson, id: string) => l.steps[stepOf(l, id)].check!
const pressedIn = (layout: { components: { id: string; params?: Record<string, unknown> }[] }, id: string) =>
  layout.components.find((c) => c.id === id)?.params?.pressed
const toasts = () => getToasts().map((x) => x.text)

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setFirmwareBlobStoreForTests(createMemoryBlobStore())
  __setLangForTests('zh-TW')
  reloadLessonProgress()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLatchHolds.setState({ held: [] })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  stopGuide()
  __setFirmwareBlobStoreForTests(null)
  vi.unstubAllGlobals()
})

describe('which hands a check runs with', () => {
  it('a check that presses / turns its inputs itself owns them; an observing step looks at the circuit as it is', () => {
    const b3 = lesson('b3-pull-resistors')
    const b4 = lesson('b4-button-debounce')
    const i2 = lesson('i2-exti-button')
    const a6 = lesson('a6-rotary-encoder')
    expect(stepCheckHands(checkOf(b3, 'b3-s3'))).toBe('released') // presses SW1 itself
    expect(stepCheckHands(checkOf(b3, 'b3-s5'))).toBe('released') // presses SW2 itself
    expect(stepCheckHands(checkOf(b4, 'b4-s3'))).toBe('released')
    expect(stepCheckHands(checkOf(i2, 'press'))).toBe('released') // presses once itself
    expect(stepCheckHands(checkOf(a6, 'turn'))).toBe('released') // turns the knob itself
    expect(stepCheckHands(checkOf(i2, 'pullup'))).toBe('live') // 「放開時約 3.3 V」: looks
    expect(stepCheckHands(checkOf(b4, 'b4-s6'))).toBe('live') // 「最後放開 SW2」, then looks
    expect(stepCheckHands(checkOf(b3, 'b3-s6'))).toBe('live') // 「放開按鈕，確認沒有浮接」
    // a stimulus anywhere inside an 'all' counts
    const nested: LessonCheck = { kind: 'all', checks: [{ kind: 'erc-clean' }, checkOf(b3, 'b3-s3')] }
    expect(drivesInputs(nested)).toBe(true)
    expect(drivesInputs({ kind: 'erc-clean' })).toBe(false)
    expect(drivesInputs({ kind: 'measure', at: { hole: 'a1' }, quantity: 'voltage', min: 0, max: 1, stimulus: [] })).toBe(false)
  })

  it('liveEvalInput: released (the default) strips the kept-pressed buttons, live keeps them', async () => {
    useStore.setState({
      layout: {
        version: 1,
        components: [
          { id: 'SW1', type: 'pushbutton', at: 'f50' },
          { id: 'R1', type: 'resistor', holes: ['a36', 'a40'], params: { resistance: 330 } },
        ],
        wires: [],
      },
    })
    setLatched('SW1', true)
    expect(isLatched('SW1')).toBe(true)
    const released = await liveEvalInput()
    expect(pressedIn(released.layout, 'SW1')).toBeUndefined()
    expect(released.layout.components.find((c) => c.id === 'R1')?.params?.resistance).toBe(330) // only the transient params go
    expect(pressedIn((await liveEvalInput('released')).layout, 'SW1')).toBeUndefined()
    expect(pressedIn((await liveEvalInput('live')).layout, 'SW1')).toBe(true)
    // the live board is untouched: SW1 is still kept pressed
    expect(isLatched('SW1')).toBe(true)
  })
})

describe('step checks and the acceptance with SW1 kept pressed (i2, the real firmware)', () => {
  it('a check that presses SW1 itself passes whatever the learner left pressed', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    expect(await loadLessonCircuit(i2, 'solution')).toBe(true)
    setLatched('SW1', true)
    const index = stepOf(i2, 'press')
    await runStepCheck(i2, index)
    const run = useLessonUi.getState().runs[runKey(i2.id, 'press')]
    expect(run?.status).toBe('done')
    expect(run?.results?.every((r) => r.pass), JSON.stringify(run?.results?.map((r) => r.detail))).toBe(true)
    expect(isLatched('SW1')).toBe(true) // the check never touched the live board
  })

  it('an observing step sees SW1 kept pressed: it fails, says so once, and 〔放開〕 lets the next try pass', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    expect(await loadLessonCircuit(i2, 'solution')).toBe(true)
    for (const x of getToasts()) dismissToast(x.id)
    const index = stepOf(i2, 'pullup')
    const key = runKey(i2.id, 'pullup')
    setLatched('SW1', true)
    // the automatic re-check (attempt: false) fails quietly
    await runStepCheck(i2, index, { attempt: false })
    expect(useLessonUi.getState().runs[key]?.results?.[0]?.pass).toBe(false)
    expect(toasts().some((s) => s.includes('保持按下中'))).toBe(false)
    // 檢查此步驟: the same verdict, and the toast names the kept-pressed part with 〔放開〕
    await runStepCheck(i2, index)
    expect(useLessonUi.getState().runs[key]?.results?.[0]?.pass).toBe(false)
    const toast = getToasts().find((x) => x.text.includes('保持按下中'))
    expect(toast?.text).toBe('SW1 保持按下中——這一步檢查的是目前的電路')
    expect(toast?.action?.label).toBe('放開')
    toast!.action!.run()
    expect(isLatched('SW1')).toBe(false)
    await runStepCheck(i2, index)
    expect(useLessonUi.getState().runs[key]?.results?.[0]?.pass).toBe(true)
  })

  it('the real i2 「確認內部上拉」 failure with SW1 kept pressed is one the hand can explain', LONG, async () => {
    // holdsMayExplain on the real result: a measure that really ran and failed
    const i2 = lesson('i2-exti-button')
    expect(await loadLessonCircuit(i2, 'solution')).toBe(true)
    setLatched('SW1', true)
    await runStepCheck(i2, stepOf(i2, 'pullup'), { attempt: false })
    const results = useLessonUi.getState().runs[runKey(i2.id, 'pullup')]?.results ?? []
    expect(results[0]?.pass).toBe(false)
    expect(results[0]?.error).toBeFalsy()
    expect(holdsMayExplain(results)).toBe(true)
  })

  it('the acceptance never depends on the hand: the same observing check passes there with SW1 kept pressed', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    expect(await loadLessonCircuit(i2, 'solution')).toBe(true)
    setLatched('SW1', true)
    // an acceptance made of the observing check alone (no check of it presses SW1 — the
    // evaluator's driven-param reset does not apply): only liveEvalInput's 'released' helps
    const only: Lesson = { ...i2, id: 'i2-latch-acceptance', acceptance: [checkOf(i2, 'pullup')] }
    await runAcceptance(only)
    const run = useLessonUi.getState().runs[runKey(only.id)]
    expect(run?.status).toBe('done')
    expect(run?.results?.[0]?.pass, JSON.stringify(run?.results?.[0]?.detail)).toBe(true)
    expect(isLatched('SW1')).toBe(true)
  })
})

/** A result row as the evaluator returns it (only the fields holdsMayExplain reads matter). */
const row = (kind: LessonCheck['kind'], pass: boolean, extra: Partial<EvaluatedCheck> = {}): EvaluatedCheck => ({
  key: '0',
  kind,
  label: kind,
  pass,
  detail: '',
  ...extra,
})

describe('the 「SW1 保持按下中」 toast only blames the hand for a failure the hand can cause', () => {
  it('holdsMayExplain: measure / uart / ERC failures that really ran — never wiring, parts, firmware, errors or missing parts', () => {
    // what the button state changes
    expect(holdsMayExplain([row('measure', false)])).toBe(true)
    expect(holdsMayExplain([row('uart-contains', false)])).toBe(true)
    expect(holdsMayExplain([row('erc-clean', false)])).toBe(true) // the ERC's switch model reads 'pressed'
    // what it never changes: the netlist, a bound firmware, a firmware's own test bench
    expect(holdsMayExplain([row('connected', false)])).toBe(false)
    expect(holdsMayExplain([row('not-connected', false)])).toBe(false)
    expect(holdsMayExplain([row('has-part', false)])).toBe(false)
    expect(holdsMayExplain([row('firmware-loaded', false)])).toBe(false)
    expect(holdsMayExplain([row('firmware-checks', false)])).toBe(false)
    // a check that could not run, or names parts the board lacks
    expect(holdsMayExplain([row('measure', false, { error: true })])).toBe(false)
    expect(holdsMayExplain([row('measure', false, { missing: ['LED1'] })])).toBe(false)
    // nothing failed
    expect(holdsMayExplain([])).toBe(false)
    expect(holdsMayExplain([row('measure', true)])).toBe(false)
    // an 'all': its failed leaves decide — a wiring failure beside a failed measure is fixed by wiring first
    const all = (children: EvaluatedCheck[]) => row('all', children.every((c) => c.pass), { children })
    expect(holdsMayExplain([all([row('connected', true), row('measure', false)])])).toBe(true)
    expect(holdsMayExplain([all([row('connected', false), row('connected', false)])])).toBe(false)
    expect(holdsMayExplain([all([row('connected', false), row('measure', false)])])).toBe(false)
    expect(holdsMayExplain([all([row('erc-clean', false), all([row('has-part', true), row('uart-contains', false)])])])).toBe(true)
  })

  it('a wiring step (b4-s4) failing while SW1 is kept pressed: ✕ on 檢查此步驟, but no toast blaming SW1', async () => {
    const b4 = lesson('b4-button-debounce')
    expect(await loadLessonCircuit(b4, 'start')).toBe(true)
    for (const x of getToasts()) dismissToast(x.id)
    const index = stepOf(b4, 'b4-s4')
    const key = runKey(b4.id, 'b4-s4')
    expect(stepCheckHands(checkOf(b4, 'b4-s4'))).toBe('live') // observing (structural) — the toast path is reachable
    setLatched('SW1', true)
    expect(isLatched('SW1')).toBe(true)
    await runStepCheck(b4, index)
    const run = useLessonUi.getState().runs[key]
    expect(run?.status).toBe('done')
    expect(run?.results?.[0]?.pass).toBe(false) // R2 / the X-point wire are not placed yet
    expect(useLessonUi.getState().attempted[key]).toBeTruthy() // the learner's try: it reads ✕
    expect(toasts().some((s) => s.includes('保持按下中'))).toBe(false)
  })

  it('the automatic structural re-check the latch itself triggers (watchStepChecks, an edit) never blames SW1', async () => {
    const b4 = lesson('b4-button-debounce')
    expect(await loadLessonCircuit(b4, 'start')).toBe(true)
    for (const x of getToasts()) dismissToast(x.id)
    const index = stepOf(b4, 'b4-s4')
    const key = runKey(b4.id, 'b4-s4')
    expect(useLessonUi.getState().coachId).toBe(b4.id)
    useLessonProgress.getState().setStep(b4.id, index)
    const stop = watchStepChecks(0)
    try {
      setLatched('SW1', true) // a layout change: the coach re-checks its structural step as an edit
      await vi.waitFor(() => expect(useLessonUi.getState().runs[key]?.status).toBe('done'), { timeout: 5000 })
      expect(useLessonUi.getState().runs[key]?.results?.[0]?.pass).toBe(false)
      expect(useLessonUi.getState().attempted[key]).toBeTruthy() // the edit counted as a try
      expect(toasts().some((s) => s.includes('保持按下中'))).toBe(false)
    } finally {
      stop()
    }
  })

  it('English classic chrome never shows it, even for a failure the hand explains (unchanged behaviour)', LONG, async () => {
    __setLangForTests('en')
    const i2 = lesson('i2-exti-button')
    expect(await loadLessonCircuit(i2, 'solution')).toBe(true)
    for (const x of getToasts()) dismissToast(x.id)
    setLatched('SW1', true)
    await runStepCheck(i2, stepOf(i2, 'pullup'))
    const results = useLessonUi.getState().runs[runKey(i2.id, 'pullup')]?.results ?? []
    expect(results[0]?.pass).toBe(false)
    expect(holdsMayExplain(results)).toBe(true)
    expect(getToasts().some((x) => /kept pressed|保持按下/.test(x.text))).toBe(false)
  })
})
