/**
 * UX fix round WS3 — the guide follows the board (LS-9) and bound is not
 * running (LS-8):
 *  - replacing the circuit (an example, undo across the load, a cleared
 *    board) ends the guide at once with a toast and forgets it for the next
 *    reload; an edit, a lesson's own circuit load and another lesson's load
 *    do not produce that toast;
 *  - restoreGuide resumes only while the lesson's starting parts are there;
 *  - a lesson load whose circuit is replaced before its firmware arrives
 *    never binds firmware, starts the guide or toasts (RV-09), and a step's
 *    firmware load gives up the same way;
 *  - 「已載入」 for a bound firmware; the run phase in the MCU badge's words.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests, t } from '../src/i18n'
import { LESSONS, lessonById } from '../src/lessons'
import { missingStartParts } from '../src/lessons/diagnose'
import { LESSONS_STORAGE_KEY, parseGuiding, reloadLessonProgress, useLessonProgress } from '../src/lessons/progress'
import type { Lesson } from '../src/lessons/types'
import type { CircuitLayout } from '../src/model/types'
import { parseProject } from '../src/state/project'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  __resetRestoreForTests,
  circuitReplaced,
  lessonPartsOnBoard,
  loadLessonCircuit,
  loadStepFirmware,
  restoreGuide,
  stopGuide,
  watchCircuitChanges,
} from '../src/ui/lessons/actions'
import { phaseSuffix } from '../src/ui/lessons/LessonBrowser'
import { useLessonUi } from '../src/ui/lessons/state'

const LONG = { timeout: 120_000 }
const memory = new Map<string, string>()
const lesson = (id: string): Lesson => lessonById(id)!
const toasts = (): string[] => getToasts().map((x) => x.text)
const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }

/** The bundled blink example's circuit (PS1, U1, R1, D1 — no LED1). */
function blinkExample(): CircuitLayout {
  const raw = readFileSync(path.resolve(__dirname, '../examples/embedded/blink.ohmlet.json'), 'utf8')
  const parsed = parseProject(raw)
  if (!parsed.ok) throw new Error('blink example does not parse')
  return parsed.project.layout
}

let unwatch: (() => void) | null = null

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
  useStore.setState({ layout: EMPTY, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
  for (const x of getToasts()) dismissToast(x.id)
  unwatch = watchCircuitChanges()
})

afterEach(() => {
  unwatch?.()
  unwatch = null
  stopGuide()
  __setFirmwareBlobStoreForTests(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the guide follows the board (LS-9)', () => {
  it('every lesson’s own circuits hold its starting parts (the predicate the guide relies on)', () => {
    for (const l of LESSONS) {
      expect(missingStartParts(l, l.start.layout).mostlyMissing, `${l.id} start`).toBe(false)
      expect(missingStartParts(l, l.solution.layout).mostlyMissing, `${l.id} solution`).toBe(false)
    }
    // the blink example holds a PS1 and an LED1 too (b1's two named parts): its Blue Pill makes it another
    // circuit (release QA LS-F1 — lessonPartsOnBoard, the parts fallback of lessonOnBoard)
    expect(lessonPartsOnBoard(lesson('b1-led-resistor'), blinkExample())).toBe(false)
    for (const l of LESSONS) {
      expect(lessonPartsOnBoard(l, l.start.layout), `${l.id} start (parts)`).toBe(true)
      expect(lessonPartsOnBoard(l, l.solution.layout), `${l.id} solution (parts)`).toBe(true)
    }
  })

  it('a whole replacement vs an edit', () => {
    const b1 = lesson('b1-led-resistor').start.layout
    const edited = { ...b1, components: [...b1.components, { id: 'R9', type: 'resistor', holes: ['a40', 'a44'], params: {} }] }
    expect(circuitReplaced(b1, edited)).toBe(false)
    expect(circuitReplaced(b1, blinkExample())).toBe(true)
    expect(circuitReplaced(b1, EMPTY)).toBe(true) // a cleared board
    expect(circuitReplaced(EMPTY, EMPTY)).toBe(false)
    expect(circuitReplaced(b1, b1)).toBe(false)
  })

  it('opening an example ends the b1 guide at once, with a toast, and a reload resumes nothing', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    expect(await loadLessonCircuit(b1, 'start')).toBe(true)
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    expect(useLessonProgress.getState().guiding).toBe(b1.id)
    expect(useStore.getState().loadLayout(blinkExample()).ok).toBe(true)
    // synchronous: gone before the next frame
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(toasts()).toContain('已結束「LED 與限流電阻」的步驟引導——電路板上換成了別的電路')
    expect(parseGuiding(memory.get(LESSONS_STORAGE_KEY) ?? null)).toBeNull()
    // "reload"
    useLessonUi.setState({ coachId: null, viewId: null })
    reloadLessonProgress()
    __resetRestoreForTests()
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBeNull()
  })

  it('edits, undo of an edit and the lesson’s own solution keep the guide', LONG, async () => {
    const b1 = lesson('b1-led-resistor')
    await loadLessonCircuit(b1, 'start')
    for (const x of getToasts()) dismissToast(x.id)
    useStore.getState().setMode({ kind: 'place', type: 'resistor', pickedHoles: [] })
    const before = useStore.getState().layout.components.length
    useStore.getState().addComponent('resistor', { holes: ['top+10', 'a14'] })
    expect(useStore.getState().layout.components.length).toBe(before + 1)
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    useStore.getState().undo()
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    await loadLessonCircuit(b1, 'solution')
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    // undo across the solution load: the learner's own b1 circuit is back — still b1's parts
    useStore.getState().undo()
    expect(useLessonUi.getState().coachId).toBe(b1.id)
    expect(toasts().some((x) => x.startsWith('已結束'))).toBe(false)
  })

  it('another lesson’s circuit hands the guide over without the "ended" toast', LONG, async () => {
    await loadLessonCircuit(lesson('b1-led-resistor'), 'start')
    for (const x of getToasts()) dismissToast(x.id)
    await loadLessonCircuit(lesson('i1-gpio-output'), 'start')
    expect(useLessonUi.getState().coachId).toBe('i1-gpio-output')
    expect(toasts().some((x) => x.startsWith('已結束'))).toBe(false)
  })

  it('clearing the board ends the guide with its own reason', LONG, async () => {
    await loadLessonCircuit(lesson('b1-led-resistor'), 'start')
    useStore.getState().clearBoard()
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(toasts()).toContain('已結束「LED 與限流電阻」的步驟引導——電路板已清空')
  })

  it('restoreGuide resumes only while the starting parts are on the board', () => {
    useLessonProgress.getState().setGuiding('b1-led-resistor')
    useStore.setState({ layout: blinkExample() })
    __resetRestoreForTests()
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(useLessonProgress.getState().guiding).toBeNull()
    // with b1's circuit it resumes
    useLessonProgress.getState().setGuiding('b1-led-resistor')
    useStore.setState({ layout: lesson('b1-led-resistor').start.layout })
    __resetRestoreForTests()
    restoreGuide()
    expect(useLessonUi.getState().coachId).toBe('b1-led-resistor')
  })
})

describe('async loads cannot resurrect a replaced circuit (LS-9 / RV-09)', () => {
  it('a lesson load replaced before its firmware arrives binds nothing, starts no guide, toasts nothing', LONG, async () => {
    const spy = vi.spyOn(useLab.getState(), 'loadFirmware')
    const i1 = lesson('i1-gpio-output')
    // i1's start circuit binds no firmware: use the solution (hal-blink on U1)
    const pending = loadLessonCircuit(i1, 'solution')
    expect(useStore.getState().loadLayout(blinkExample()).ok).toBe(true) // before the ELF fetch resolves
    for (const x of getToasts()) dismissToast(x.id)
    expect(await pending).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(toasts()).toEqual([])
    expect(useLab.getState().firmware.U1).toBeUndefined()
  })

  it('a newer lesson load wins over an older one still fetching', LONG, async () => {
    const first = loadLessonCircuit(lesson('i1-gpio-output'), 'solution')
    const second = loadLessonCircuit(lesson('i4-pwm'), 'solution')
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(useLessonUi.getState().coachId).toBe('i4-pwm')
    expect(useLab.getState().firmware.U1?.name).toBe('hal-tim-pwm.elf')
  })

  it('a step firmware load whose circuit is replaced gives up silently', LONG, async () => {
    const i1 = lesson('i1-gpio-output')
    await loadLessonCircuit(i1, 'start')
    const spy = vi.spyOn(useLab.getState(), 'loadFirmware')
    const pending = loadStepFirmware('U1', 'hal-blink', { lesson: i1, index: 2 })
    useStore.getState().loadLayout(blinkExample())
    for (const x of getToasts()) dismissToast(x.id)
    expect(await pending).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(toasts()).toEqual([])
    expect(useLessonUi.getState().loadingFirmware).toBeNull()
  })
})

describe('bound is not running (LS-8)', () => {
  it('「已載入」 for a bound firmware, and the run phase in the MCU badge’s words', () => {
    expect(t('{id} has {project} loaded', { id: 'U1', project: 'hal-blink' })).toBe('U1 已載入 hal-blink')
    expect(t('{id} has {name} loaded.', { id: 'U1', name: 'hal-blink.elf' })).toBe('U1 已載入 hal-blink.elf。')
    expect(t('{id} has {name} loaded, not the {project} firmware.', { id: 'U1', name: 'x.elf', project: 'hal-blink' })).toBe(
      'U1 載入的是 x.elf，不是 hal-blink 韌體。',
    )
    expect(t('{id} has no firmware loaded.', { id: 'U1' })).toBe('U1 還沒有韌體。')
    expect(phaseSuffix('idle')).toBe(' · 尚未執行')
    expect(phaseSuffix('running')).toBe(' · 執行中')
    expect(phaseSuffix('paused')).toBe(' · 已暫停')
    expect(phaseSuffix('halted')).toBe(' · 核心已停住')
    for (const l of LESSONS) {
      for (const c of [...l.acceptance, ...l.steps.flatMap((s) => (s.check ? [s.check] : []))]) {
        if (c.kind === 'firmware-loaded' && c.label) expect(c.label, l.id).toMatch(/^U\d+ 已載入 /)
      }
    }
  })
})
