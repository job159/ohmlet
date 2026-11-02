/**
 * fix4 lessons — "was the answer loaded" describes the circuit ON the board
 * (UI-1 / LES-1) and a check run reports the verdict of the circuit it
 * evaluated (UI-2 / LES-2):
 *  - peek at the answer (卡住了？載入完整答案) → 〔復原〕 → finish one's own
 *    circuit → 檢查我的電路: 完成！, earned (no 「用的是載入的解答」);
 *  - 載入完整答案 → 載入起始電路 → 〔復原〕 / ↶: the answer is back and its
 *    pass is NOT celebrated nor earned; ↷ brings the start circuit and its
 *    verdict back; the persisted record follows;
 *  - an undo landing on the empty board an answer load replaced: not the
 *    answer;
 *  - a lesson load while a check of that lesson is in flight aborts and
 *    forgets it: nothing is published (no 完成！ over the start circuit, no
 *    「用的是載入的解答」 for the learner's own circuit);
 *  - an undo while a run is in flight cannot flip the verdict the run reports.
 * Real loadLessonCircuit, the real 〔復原〕 toast action, real runAcceptance
 * (the lesson checks run the simulation) and the real success watch.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { LESSONS_STORAGE_KEY, reloadLessonProgress, useLessonProgress } from '../src/lessons/progress'
import type { Lesson } from '../src/lessons/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { __resetProblemsForTests } from '../src/ui/embedded/problems'
import { __resetCelebrationForTests, useCelebration } from '../src/ui/fx/celebrate'
import { entryUsesSolution, lessonEarned, passUsesSolution, runUsesSolution, useSolutionPasses } from '../src/ui/fx/lesson-pass'
import { startSuccessWatch } from '../src/ui/fx/success-watch'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { loadLessonCircuit, runAcceptance, stopGuide } from '../src/ui/lessons/actions'
import { runKey, useLessonUi } from '../src/ui/lessons/state'
import { LessonView } from '../src/ui/lessons/LessonBrowser'

const LONG = { timeout: 180_000 }
const memory = new Map<string, string>()
const b1 = (): Lesson => lessonById('b1-led-resistor')!
const tick = () => new Promise((r) => setTimeout(r, 5))
const st = () => useStore.getState()
const record = () => useLessonProgress.getState().lessons['b1-led-resistor']
const texts = () => getToasts().map((x) => x.text)
const clearToasts = () => {
  for (const x of getToasts()) dismissToast(x.id)
}

let stop: (() => void) | null = null

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
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null, revealCause: null })
  __resetCelebrationForTests()
  useSolutionPasses.setState({ count: 0 })
  clearToasts()
  stop = startSuccessWatch()
})

afterEach(() => {
  stop?.()
  stop = null
  stopGuide()
  __resetProblemsForTests()
  vi.unstubAllGlobals()
})

/** The learner wires b1 by hand on its start circuit: R1 (330 Ω) and the three wires of the solution. */
function wireB1ByHand(): void {
  st().addComponent('resistor', { holes: ['top+10', 'a14'] })
  const r = st().layout.components.find((c) => c.type === 'resistor')!
  st().setParam(r.id, 'resistance', 330)
  st().addWire('a16', 'top-13')
  st().addWire('DMM1:IN', 'e14')
  st().addWire('DMM1:COM', 'top-15')
}

/** Tap the 〔復原〕 of the newest toast (a lesson load's undoable toast). */
function tapUndoToast(): void {
  const last = getToasts()[getToasts().length - 1]
  expect(last?.action?.label).toBe('復原')
  last!.action!.run()
}

const hasR1 = () => st().layout.components.some((c) => c.type === 'resistor')
const wireCount = () => st().layout.wires.length

/** The persisted record's verdict (what a page reload reads). */
function savedUsesSolution(): boolean {
  const doc = JSON.parse(memory.get(LESSONS_STORAGE_KEY) ?? '{}') as { lessons?: Record<string, { startLoadedAt?: number; solutionLoadedAt?: number }> }
  const e = doc.lessons?.['b1-led-resistor']
  return !!e && e.solutionLoadedAt !== undefined && e.solutionLoadedAt > (e.startLoadedAt ?? -1)
}

/** A server render that reads the stores' CURRENT state (see tests/cheer-lesson.test.ts). */
function renderNow(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLessonUi, useLessonProgress] as unknown as { getInitialState: () => object; getState: () => object }[]
  const saved: [Record<string, unknown>, Record<string, unknown>][] = []
  for (const store of stores) {
    const init = store.getInitialState() as Record<string, unknown>
    const now = store.getState() as Record<string, unknown>
    const before: Record<string, unknown> = {}
    for (const k of Object.keys(now)) if (typeof now[k] !== 'function') before[k] = init[k]
    saved.push([init, before])
    for (const k of Object.keys(before)) init[k] = now[k]
  }
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) Object.assign(init, before)
  }
}
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('UI-1 / LES-1: undo across a lesson load — the answer verdict follows the board', () => {
  it(
    'peek at the answer (卡住了) → 〔復原〕 → finish one’s own circuit → 檢查我的電路: 完成！, earned',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      wireB1ByHand()
      const own = st().layout
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true) // 卡住了？載入完整答案
      expect(passUsesSolution(b1().id)).toBe(true)
      tapUndoToast()
      expect(st().layout).toBe(own) // the learner's own circuit is back
      // every reader of the rule describes it: the coach's 「卡住了？」 shows again, the record follows
      expect(passUsesSolution(b1().id)).toBe(false)
      expect(entryUsesSolution(record())).toBe(false)
      expect(savedUsesSolution()).toBe(false)
      clearToasts()
      await runAcceptance(b1())
      const run = useLessonUi.getState().runs[runKey(b1().id)]
      expect(run?.results?.every((r) => r.pass)).toBe(true)
      expect(runUsesSolution(run)).toBe(false)
      expect(useCelebration.getState().badge?.title).toBe('完成！')
      expect(useSolutionPasses.getState().count).toBe(0)
      expect(texts().some((x) => x.includes('用的是載入的解答'))).toBe(false)
      expect(lessonEarned(record())).toBe(true)
      expect(record()?.viaSolution).toBeUndefined()
      // the 驗收 block: 「課程完成」, not the answer's headline
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      const words = plain(renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' })))
      expect(words).toContain('課程完成')
      expect(words).not.toContain('用的是載入的解答')
    },
    LONG,
  )

  it(
    'peek right after the start load → 〔復原〕 → wire it by hand: earned',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      tapUndoToast()
      expect(hasR1()).toBe(false) // the start circuit again
      expect(passUsesSolution(b1().id)).toBe(false)
      wireB1ByHand()
      expect(passUsesSolution(b1().id)).toBe(false)
      await runAcceptance(b1())
      expect(useCelebration.getState().badge?.title).toBe('完成！')
      expect(lessonEarned(record())).toBe(true)
    },
    LONG,
  )

  it(
    '載入完整答案 → 載入起始電路 → 〔復原〕: the answer is back — its pass is not celebrated nor earned',
    async () => {
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      await tick()
      const answerWires = wireCount()
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      expect(passUsesSolution(b1().id)).toBe(false)
      tapUndoToast()
      expect(hasR1()).toBe(true)
      expect(wireCount()).toBe(answerWires)
      expect(passUsesSolution(b1().id)).toBe(true)
      expect(savedUsesSolution()).toBe(true)
      clearToasts()
      await runAcceptance(b1())
      expect(useLessonUi.getState().runs[runKey(b1().id)]?.results?.every((r) => r.pass)).toBe(true)
      expect(useCelebration.getState().badge).toBeNull()
      expect(useSolutionPasses.getState().count).toBe(1)
      expect(texts()).toContain('驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。')
      expect(record()?.viaSolution).toBe(true)
      expect(lessonEarned(record())).toBe(false)
    },
    LONG,
  )

  it(
    'Ctrl+Z / ↶ and ↷ across the loads: the verdict follows each board, and the record with it',
    async () => {
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      expect(passUsesSolution(b1().id)).toBe(false)
      st().undo() // ↶ — back to the answer
      expect(hasR1()).toBe(true)
      expect(passUsesSolution(b1().id)).toBe(true)
      expect(savedUsesSolution()).toBe(true)
      st().redo() // ↷ — the start circuit again
      expect(hasR1()).toBe(false)
      expect(passUsesSolution(b1().id)).toBe(false)
      expect(savedUsesSolution()).toBe(false)
      st().undo()
      st().undo() // ↶ past the answer load: the empty board it replaced
      expect(st().layout.components).toHaveLength(0)
      expect(passUsesSolution(b1().id)).toBe(false)
      st().redo() // ↷ — the answer again
      expect(hasR1()).toBe(true)
      expect(passUsesSolution(b1().id)).toBe(true)
    },
    LONG,
  )

  it('載入完整答案 on an empty board → ↶: the empty board (and what is built on it) is not the answer; ↷ is', async () => {
    expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
    expect(passUsesSolution(b1().id)).toBe(true)
    st().undo()
    expect(st().layout.components).toHaveLength(0)
    expect(passUsesSolution(b1().id)).toBe(false)
    st().addComponent('resistor', { holes: ['top+10', 'a14'] }) // building by hand on it
    expect(passUsesSolution(b1().id)).toBe(false)
    st().undo()
    st().redo()
    st().undo()
    expect(passUsesSolution(b1().id)).toBe(false)
  })

  it('載入完整答案 → 清空麵包板: what is built next is the learner’s own; 〔復原〕 brings the answer and its verdict back', async () => {
    expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
    st().clearBoard()
    expect(passUsesSolution(b1().id)).toBe(false)
    expect(savedUsesSolution()).toBe(false)
    st().addComponent('resistor', { holes: ['top+10', 'a14'] }) // building by hand from nothing
    expect(passUsesSolution(b1().id)).toBe(false)
    st().undo()
    st().undo() // the answer back
    expect(hasR1()).toBe(true)
    expect(passUsesSolution(b1().id)).toBe(true)
    expect(savedUsesSolution()).toBe(true)
  })

  it('the coach’s answer test reads the same rule (no private copy of the stamps rule)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/ui/lessons/LessonOverlay.tsx'), 'utf8')
    expect(src).toContain('const answerLoaded = entryUsesSolution(progress)')
    expect(src).not.toMatch(/solutionLoadedAt\s*>/)
  })
})

describe('UI-2 / LES-2: a run reports the circuit it evaluated', () => {
  /** Call `fn` once, the first time the run `key` reports progress (mid-run). */
  function onFirstProgress(key: string, fn: () => void): () => void {
    let done = false
    const unsub = useLessonUi.subscribe((s) => {
      if (done) return
      const r = s.runs[key]
      if (r?.status === 'running' && r.progress) {
        done = true
        unsub()
        fn()
      }
    })
    return unsub
  }

  it(
    'the answer under check → 載入起始電路 mid-run: the run is aborted and forgotten — no 完成！, nothing recorded',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      clearToasts()
      const key = runKey(b1().id)
      let load: Promise<boolean> | null = null
      const off = onFirstProgress(key, () => {
        load = loadLessonCircuit(b1(), 'start')
      })
      await runAcceptance(b1())
      off()
      expect(load).not.toBeNull()
      expect(await load!).toBe(true)
      expect(hasR1()).toBe(false) // the start circuit
      expect(useLessonUi.getState().runs[key]).toBeUndefined()
      expect(record()?.completedAt).toBeUndefined()
      expect(record()?.lastCheck).toBeUndefined()
      expect(useCelebration.getState().badge).toBeNull()
      expect(useSolutionPasses.getState().count).toBe(0)
      expect(texts().some((x) => x.includes('驗收'))).toBe(false)
    },
    LONG,
  )

  it(
    'the learner’s own circuit under check → 載入完整答案 mid-run: nothing published, no 「用的是載入的解答」',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      wireB1ByHand()
      clearToasts()
      const key = runKey(b1().id)
      let load: Promise<boolean> | null = null
      const off = onFirstProgress(key, () => {
        load = loadLessonCircuit(b1(), 'solution')
      })
      await runAcceptance(b1())
      off()
      expect(await load!).toBe(true)
      expect(useLessonUi.getState().runs[key]).toBeUndefined()
      expect(record()?.completedAt).toBeUndefined()
      expect(record()?.viaSolution).toBeUndefined()
      expect(texts().some((x) => x.includes('用的是載入的解答'))).toBe(false)
    },
    LONG,
  )

  it(
    'an undo during a run of the answer cannot turn its pass into an earned one',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      clearToasts()
      const key = runKey(b1().id)
      const off = onFirstProgress(key, () => st().undo()) // ↶ back to the start circuit while the answer is checked
      await runAcceptance(b1())
      off()
      expect(hasR1()).toBe(false)
      expect(passUsesSolution(b1().id)).toBe(false) // the board now: the start circuit
      const run = useLessonUi.getState().runs[key]
      expect(run?.results?.every((r) => r.pass)).toBe(true) // what the run evaluated: the answer
      expect(runUsesSolution(run)).toBe(true)
      expect(useCelebration.getState().badge).toBeNull()
      expect(useSolutionPasses.getState().count).toBe(1)
      expect(texts()).toContain('驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。')
      expect(record()?.viaSolution).toBe(true)
      expect(lessonEarned(record())).toBe(false)
      // the 驗收 block reports that run: the answer's headline
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      const words = plain(renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' })))
      expect(words).toContain('全部 6 項條件都通過（用的是載入的解答）')
    },
    LONG,
  )

  it(
    'an undo onto the answer during a run of the learner’s own circuit cannot turn it into a copy',
    async () => {
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      wireB1ByHand()
      clearToasts()
      const key = runKey(b1().id)
      const off = onFirstProgress(key, () => {
        // ↶ through the hand wiring and across the start load: the answer is back on the board
        for (let i = 0; i < 20 && !(hasR1() && passUsesSolution(b1().id)); i++) st().undo()
      })
      await runAcceptance(b1())
      off()
      expect(passUsesSolution(b1().id)).toBe(true) // the board now: the answer
      const run = useLessonUi.getState().runs[key]
      expect(run?.results?.every((r) => r.pass)).toBe(true)
      expect(runUsesSolution(run)).toBe(false)
      expect(useCelebration.getState().badge?.title).toBe('完成！')
      expect(lessonEarned(record())).toBe(true)
    },
    LONG,
  )
})
