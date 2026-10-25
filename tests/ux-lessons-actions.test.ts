/**
 * UX wave WS3 — lesson step actions (LS-1) and flow continuity (LS-4):
 *  - stepActions derives the one-click actions from each step's check
 *    (firmware-loaded → load, measure / UART / contract → ▶ run, a part the
 *    solution adds → take a part) and honours explicit lists ([] = none);
 *  - every firmware a step action or a mistake button can load is bundled,
 *    and every firmware step of i1–i8 exposes its load button;
 *  - loadStepFirmware binds the bundled image through the lab's own loader
 *    (the inspector's path) and checks the step: i1 step 3 in ONE call;
 *  - armPart arms the placement mode; nextLesson / nextLevelStart;
 *  - progress remembers the guided lesson, the solution loads and the last
 *    acceptance score; the guide resumes after a "reload" with a toast;
 *  - not-yet-attempted step checks (useLessonUi.attempted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { LESSONS, lessonById } from '../src/lessons'
import {
  LESSONS_STORAGE_KEY,
  __setLessonClockForTests,
  parseGuiding,
  parseProgress,
  reloadLessonProgress,
  useLessonProgress,
} from '../src/lessons/progress'
import { actionKey, lessonFirmwareRefs, lessonMcu, mainFirmware, mistakeFirmware, stepActions } from '../src/lessons/step-actions'
import type { Lesson } from '../src/lessons/types'
import { hasBundledFirmware } from '../src/firmware-assets'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  __resetRestoreForTests,
  armPart,
  boundProject,
  loadLessonCircuit,
  loadStepFirmware,
  nextLesson,
  nextLevelStart,
  restoreGuide,
  runStepCheck,
  stopGuide,
} from '../src/ui/lessons/actions'
import { runKey, useLessonUi } from '../src/ui/lessons/state'
import { lessonCode } from '../src/ui/lessons/labels'

const LONG = { timeout: 120_000 }
const memory = new Map<string, string>()
const lesson = (id: string): Lesson => lessonById(id)!
const keys = (l: Lesson, i: number) => stepActions(l, i).map(actionKey)
const stepIndex = (l: Lesson, id: string) => l.steps.findIndex((s) => s.id === id)
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
  reloadLessonProgress()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  __setLessonClockForTests(null)
  __setFirmwareBlobStoreForTests(null)
  vi.unstubAllGlobals()
})

describe('stepActions (LS-1)', () => {
  it('derives load / run / take-a-part from the step checks', () => {
    const b1 = lesson('b1-led-resistor')
    expect(keys(b1, stepIndex(b1, 'b1-s1'))).toEqual([]) // a tour: nothing to click
    expect(keys(b1, stepIndex(b1, 'b1-s3'))).toEqual(['arm|resistor']) // the solution adds R1
    expect(keys(b1, stepIndex(b1, 'b1-s4'))).toEqual(['wire|a16>top-13']) // a wire: 「開始接線（a16 → top-13）」 (LS-11)
    expect(keys(b1, stepIndex(b1, 'b1-s5'))).toEqual(['run'])
    const i1 = lesson('i1-gpio-output')
    expect(keys(i1, stepIndex(i1, 'wire'))).toEqual(['wire|a20>e36']) // R1 is already in the start circuit: only a wire (LS-11)
    expect(keys(i1, stepIndex(i1, 'firmware'))).toEqual(['fw|U1|hal-blink'])
    expect(keys(i1, stepIndex(i1, 'run'))).toEqual(['run', 'logic|U1|PA5']) // a frequency is read on the analyzer (LS-11)
    expect(keys(i1, stepIndex(i1, 'mistakes'))).toEqual(['fw|U1|lesson-i1-noclk', 'fw|U1|lesson-i1-od', 'run'])
    const i2 = lesson('i2-exti-button')
    expect(keys(i2, stepIndex(i2, 'place'))).toEqual(['arm|pushbutton'])
    // explicit: the button was placed in step 1, so only its two wires — 開始接線 marks each end (release QA LS-F8)
    expect(keys(i2, stepIndex(i2, 'wire'))).toEqual(['wire|j10>j45,j47>bot-47'])
  })

  it('every firmware a step or a mistake can load is bundled', () => {
    const refs = LESSONS.flatMap((l) => lessonFirmwareRefs(l).map((r) => ({ ...r, lesson: l.id })))
    expect(refs.length).toBeGreaterThan(10)
    const missing = refs.filter((r) => !hasBundledFirmware(r.project)).map((r) => `${r.lesson} ${r.where}: ${r.project}`)
    expect(missing).toEqual([])
    // the boards they go to exist in the lesson's circuits
    for (const r of refs) {
      const l = lesson(r.lesson)
      const ids = new Set([...l.start.layout.components, ...l.solution.layout.components].map((c) => c.id))
      expect(ids.has(r.component), `${r.lesson} ${r.where} → ${r.component}`).toBe(true)
    }
  })

  it('every firmware step of i1–i8 offers its one-click load', () => {
    for (const l of LESSONS.filter((x) => x.level === 'intermediate')) {
      l.steps.forEach((s, i) => {
        const c = s.check
        if (c?.kind !== 'firmware-loaded' || !c.project) return
        expect(keys(l, i), `${l.id} ${s.id}`).toContain(`fw|${c.component}|${c.project}`)
      })
    }
    // i5 checks its firmware step by the UART greeting: it still loads + runs in one place
    const i5 = lesson('i5-uart')
    expect(keys(i5, stepIndex(i5, 'firmware'))).toEqual(['fw|U1|hal-uart-hello', 'run'])
  })

  it('names the mistake firmware and the main firmware of a lesson', () => {
    const i1 = lesson('i1-gpio-output')
    expect(lessonMcu(i1)).toBe('U1')
    expect(mainFirmware(i1, 'U1')).toBe('hal-blink')
    const all = i1.mistakes.flatMap((m) => mistakeFirmware(i1, m))
    expect(all).toEqual(['lesson-i1-noclk', 'lesson-i1-od'])
    for (const id of ['i2-exti-button', 'i3-timer-interrupt', 'i4-pwm', 'i8-spi-595']) {
      const l = lesson(id)
      expect(l.mistakes.flatMap((m) => mistakeFirmware(l, m)).length, id).toBe(1)
    }
  })
})

describe('loadStepFirmware / armPart (LS-1)', () => {
  it('i1: one call binds hal-blink through the lab loader and passes step 3', LONG, async () => {
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    const i1 = lesson('i1-gpio-output')
    expect(await loadLessonCircuit(i1, 'start')).toBe(true)
    expect(useLab.getState().firmware.U1).toBeUndefined()
    const step = stepIndex(i1, 'firmware')
    const ok = await loadStepFirmware('U1', 'hal-blink', { lesson: i1, index: step })
    expect(ok).toBe(true)
    expect(useLab.getState().firmware.U1?.name).toBe('hal-blink.elf')
    expect(boundProject('U1')).toBe('hal-blink')
    expect(lastToast()).toBe('已將 hal-blink.elf 載入 U1')
    // the step check ran (and passed) on the live circuit
    await vi.waitFor(() => expect(useLessonUi.getState().runs[runKey(i1.id, 'firmware')]?.status).toBe('done'), { timeout: 20_000 })
    expect(useLessonUi.getState().runs[runKey(i1.id, 'firmware')]?.results?.[0]?.pass).toBe(true)
    expect(useLessonProgress.getState().lessons[i1.id]?.stepsDone).toContain('firmware')
    stopGuide()
  })

  it('refuses a board that is not on the board, with the fix in the toast', async () => {
    expect(await loadStepFirmware('U1', 'hal-blink')).toBe(false)
    expect(lastToast()).toBe('電路中沒有 U1——請先按「載入起始電路」')
  })

  it('armPart arms the library placement mode', () => {
    armPart('resistor')
    expect(useStore.getState().mode).toEqual({ kind: 'place', type: 'resistor', pickedHoles: [] })
    armPart('no-such-part')
    expect(useStore.getState().mode).toMatchObject({ type: 'resistor' })
  })
})

describe('flow continuity (LS-4)', () => {
  it('next lesson by level / order, and the jump to the next level', () => {
    expect(nextLesson(lesson('b1-led-resistor'))?.id).toBe('b2-voltage-divider')
    expect(nextLevelStart(lesson('b1-led-resistor'))?.id).toBe('i1-gpio-output')
    const lastBeginner = LESSONS.filter((l) => l.level === 'beginner').pop()!
    expect(nextLesson(lastBeginner)?.id).toBe('i1-gpio-output')
    expect(nextLevelStart(lastBeginner)).toBeUndefined() // 下一課 already is the next level
    expect(nextLesson(LESSONS[LESSONS.length - 1])).toBeUndefined()
  })

  it('remembers the guided lesson and resumes it after a reload, once, with a toast', () => {
    const b1 = lesson('b1-led-resistor')
    useLessonProgress.getState().setStep(b1.id, 2)
    useLessonUi.getState().setCoach(b1.id)
    expect(parseGuiding(memory.get(LESSONS_STORAGE_KEY) ?? null)).toBe(b1.id)
    // "reload": fresh UI state, progress read back from storage; the autosave brought b1's circuit back
    // (the guide resumes only while the lesson's starting parts are on the board — LS-9)
    useStore.setState({ layout: b1.start.layout })
    useLessonUi.setState({ coachId: null, viewId: null })
    reloadLessonProgress()
    __resetRestoreForTests()
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    expect(lastToast()).toBe('繼續「LED 與限流電阻」步驟 3')
    // the lesson browser shows where the learner was
    expect(useLessonUi.getState().viewId).toBe(b1.id)
    expect(useLessonUi.getState().section).toBe('steps')
    // once per page
    useLessonUi.setState({ coachId: null })
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBeNull()
    // closing the guide forgets it
    useLessonUi.getState().setCoach(b1.id)
    stopGuide()
    expect(parseGuiding(memory.get(LESSONS_STORAGE_KEY) ?? null)).toBeNull()
  })

  it('a guided lesson that no longer exists is forgotten', () => {
    useLessonProgress.getState().setGuiding('zz-gone')
    __resetRestoreForTests()
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(useLessonProgress.getState().guiding).toBeNull()
  })

  it('a step check reads 尚未完成 until the learner attempts it', LONG, async () => {
    const i2 = lesson('i2-exti-button')
    await loadLessonCircuit(i2, 'start')
    const key = runKey(i2.id, 'place')
    expect(useLessonUi.getState().attempted[key]).toBeUndefined()
    await runStepCheck(i2, 0, { attempt: false }) // the automatic re-check after the load
    expect(useLessonUi.getState().runs[key]?.results?.[0]?.pass).toBe(false)
    expect(useLessonUi.getState().attempted[key]).toBeUndefined()
    await runStepCheck(i2, 0) // 檢查此步驟
    expect(useLessonUi.getState().attempted[key]).toBe(true)
    // a fresh circuit forgets the attempts
    await loadLessonCircuit(i2, 'start')
    expect(useLessonUi.getState().attempted[key]).toBeUndefined()
    stopGuide()
  })
})

describe('progress: solution completions and the last check (LS-7)', () => {
  it('a completion after loading the solution is marked, an earned one upgrades it', () => {
    let now = 1_000
    __setLessonClockForTests(() => now)
    const p = () => useLessonProgress.getState()
    p().loaded('demo', 'solution')
    now += 10
    p().complete('demo')
    expect(p().lessons.demo).toMatchObject({ completedAt: 1_010, viaSolution: true })
    now += 10
    p().loaded('demo', 'start')
    now += 10
    p().complete('demo')
    expect(p().lessons.demo.viaSolution).toBeUndefined()
    expect(p().lessons.demo.completedAt).toBe(1_030)
    // a later "solution" pass never downgrades an earned completion
    now += 10
    p().loaded('demo', 'solution')
    now += 10
    p().complete('demo')
    expect(p().lessons.demo.viaSolution).toBeUndefined()
    p().recordCheck('demo', 2, 6)
    p().recordCheck('demo', 7, 6) // invalid: ignored
    expect(p().lessons.demo.lastCheck).toEqual({ passed: 2, total: 6, at: 1_050 })
    const saved = parseProgress(memory.get(LESSONS_STORAGE_KEY) ?? null)
    expect(saved.demo).toMatchObject({ lastCheck: { passed: 2, total: 6 }, startLoadedAt: 1_020, solutionLoadedAt: 1_040 })
  })

  it('drops malformed new fields instead of half-reading them', () => {
    const parsed = parseProgress(
      JSON.stringify({
        v: 1,
        guiding: 42,
        lessons: { a: { step: 1, viaSolution: true, lastCheck: { passed: 9, total: 3, at: 1 }, solutionLoadedAt: -5 } },
      }),
    )
    expect(parsed.a).toEqual({ step: 1, stepsDone: [], updatedAt: 0 })
    expect(parseGuiding(JSON.stringify({ v: 1, lessons: {}, guiding: 42 }))).toBeNull()
  })

  it('lesson codes read 初級 1 / 中級 3', () => {
    expect(lessonCode(lesson('b1-led-resistor'))).toBe('初級 1')
    expect(lessonCode(lesson('i3-timer-interrupt'))).toBe('中級 3')
  })
})
