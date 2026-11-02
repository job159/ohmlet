/**
 * cheer: a lesson pass celebrates only the learner's own circuit.
 *  - b1 passed with 載入完整答案 (the solution loaded after the start
 *    circuit): no 「完成！」 badge, no confetti (3D event), no chime — one
 *    plain toast that says the pass used the loaded answer;
 *  - b1 wired by hand (start circuit + the learner's own R1 and wires): the
 *    badge, the confetti around the checked parts — and NOT the duplicate
 *    「課程完成——全部 n 項驗收條件都通過。」 toast in the product chrome;
 *  - the English classic chrome keeps its original toast;
 *  - final walkthrough: after a pass with the loaded answer EVERY surface
 *    agrees — the toast, the coach's pass line and the 驗收 headline say
 *    「全部 n 項條件都通過（用的是載入的解答）」, never 「課程完成」, and offer
 *    〔載入起始電路，自己接一次〕 (which loads the start at once and guides
 *    step 1); a lesson already earned on the learner's own circuit keeps it.
 * Real runAcceptance, real lesson checks (they run the simulation).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress, useLessonProgress } from '../src/lessons/progress'
import type { Lesson } from '../src/lessons/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { __resetProblemsForTests } from '../src/ui/embedded/problems'
import { __resetCelebrationForTests, useCelebration } from '../src/ui/fx/celebrate'
import { entryUsesSolution, lessonEarned, lessonPassToast, passUsesSolution, useSolutionPasses } from '../src/ui/fx/lesson-pass'
import { startSuccessWatch } from '../src/ui/fx/success-watch'
import { onSceneFx, type SceneFxEvent } from '../src/three/internal/fx/bus'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { loadLessonCircuit, requestLoad, runAcceptance, stopGuide } from '../src/ui/lessons/actions'
import { useLessonUi } from '../src/ui/lessons/state'
import { LessonView } from '../src/ui/lessons/LessonBrowser'
import { CoachPassLine } from '../src/ui/lessons/LessonOverlay'

const LONG = { timeout: 120_000 }
const memory = new Map<string, string>()
const b1 = (): Lesson => lessonById('b1-led-resistor')!
const tick = () => new Promise((r) => setTimeout(r, 5))

let stop: (() => void) | null = null
let events: SceneFxEvent[] = []
let off: (() => void) | null = null

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
  __resetCelebrationForTests()
  useSolutionPasses.setState({ count: 0 })
  for (const x of getToasts()) dismissToast(x.id)
  events = []
  off = onSceneFx((e) => events.push(e))
  stop = startSuccessWatch()
})

afterEach(() => {
  stop?.()
  stop = null
  off?.()
  off = null
  stopGuide()
  __resetProblemsForTests()
  vi.unstubAllGlobals()
})

/** The learner wires b1 by hand on its start circuit: R1 (330 Ω) and the three wires of the solution. */
function wireB1ByHand(): void {
  const s = useStore.getState()
  s.addComponent('resistor', { holes: ['top+10', 'a14'] })
  const r = useStore.getState().layout.components.find((c) => c.type === 'resistor')!
  useStore.getState().setParam(r.id, 'resistance', 330)
  useStore.getState().addWire('a16', 'top-13')
  useStore.getState().addWire('DMM1:IN', 'e14')
  useStore.getState().addWire('DMM1:COM', 'top-15')
}

const texts = () => getToasts().map((x) => x.text)

describe('cheer: the lesson pass is celebrated only on the learner’s own circuit', () => {
  it(
    '載入完整答案 → 檢查我的電路: all pass, but no badge, no confetti, no chime — the toast says it was the loaded answer',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      expect(passUsesSolution(b1().id)).toBe(true)
      for (const x of getToasts()) dismissToast(x.id)
      await runAcceptance(b1())
      expect(useLessonUi.getState().runs['b1-led-resistor|acceptance']?.results?.every((r) => r.pass)).toBe(true)
      expect(useCelebration.getState().badge).toBeNull()
      expect(useCelebration.getState().count['lesson-pass']).toBe(0)
      expect(events.filter((e) => e.kind === 'lesson-pass')).toHaveLength(0)
      expect(useSolutionPasses.getState().count).toBe(1)
      expect(texts()).toContain('驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。')
      expect(texts().some((x) => x.startsWith('課程完成'))).toBe(false)
      // the lesson's own record is unchanged by the cheer: 「以解答完成」
      expect(useLessonProgress.getState().lessons['b1-led-resistor']?.viaSolution).toBe(true)
    },
    LONG,
  )

  it(
    'b1 wired by hand → 完成！ badge + confetti around the checked parts, and no duplicate 「課程完成…」 toast',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      wireB1ByHand()
      expect(passUsesSolution(b1().id)).toBe(false)
      for (const x of getToasts()) dismissToast(x.id)
      await runAcceptance(b1())
      expect(useLessonUi.getState().runs['b1-led-resistor|acceptance']?.results?.every((r) => r.pass)).toBe(true)
      const badge = useCelebration.getState().badge
      expect(badge?.title).toBe('完成！')
      expect(badge?.message).toBe('「LED 與限流電阻」驗收 6 項全部通過')
      const fx = events.filter((e) => e.kind === 'lesson-pass')
      expect(fx).toHaveLength(1)
      expect(fx[0].componentIds).toEqual(expect.arrayContaining(['LED1', 'R1']))
      expect(texts().some((x) => x.startsWith('課程完成'))).toBe(false)
      expect(useLessonProgress.getState().lessons['b1-led-resistor']?.completedAt).toBeGreaterThan(0)
    },
    LONG,
  )

  it(
    'a hand-built pass after an earlier answer load still celebrates once the start circuit was loaded again',
    async () => {
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      await tick()
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      wireB1ByHand()
      await runAcceptance(b1())
      expect(useCelebration.getState().badge?.title).toBe('完成！')
    },
    LONG,
  )
})

describe('cheer: lessonPassToast', () => {
  it('product chrome: the solution sentence; nothing while the badge shows; the classic chrome: the original sentence', () => {
    expect(lessonPassToast(6, true)).toBe('驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。')
    expect(lessonPassToast(6, false)).toBe('課程完成——全部 6 項驗收條件都通過。') // no badge up (e.g. the harness)
    useCelebration.setState({ badge: { id: 1, kind: 'lesson-pass', title: '完成！', at: 0 } })
    expect(lessonPassToast(6, false)).toBeNull()
    __setLangForTests('en')
    expect(lessonPassToast(6, false)).toBe('Lesson complete — all 6 acceptance checks pass.')
    expect(lessonPassToast(6, true)).toBe('Lesson complete — all 6 acceptance checks pass.')
  })
})

/**
 * A server render reads a store's INITIAL state (zustand: getServerState ||
 * getInitialState): show the stores' CURRENT state there while `el` renders.
 */
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
const filledButtons = (html: string) => [...html.matchAll(/lg-btn-filled[^>]*>([^<]*)</g)].map((m) => m[1])

describe('cheer: after a pass with the loaded answer every surface says the same (final walkthrough)', () => {
  async function answerPass(): Promise<void> {
    expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
    await tick()
    expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
    for (const x of getToasts()) dismissToast(x.id)
    await runAcceptance(b1())
    expect(useLessonUi.getState().runs['b1-led-resistor|acceptance']?.results?.every((r) => r.pass)).toBe(true)
  }

  it(
    'the toast, the 驗收 headline and the coach line: 「全部 6 項條件都通過（用的是載入的解答）」, no 「課程完成」, next step 〔載入起始電路，自己接一次〕',
    async () => {
      await answerPass()
      expect(texts()).toEqual(['驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。'])
      const entry = useLessonProgress.getState().lessons[b1().id]
      expect(entryUsesSolution(entry)).toBe(true)
      expect(lessonEarned(entry)).toBe(false)
      // the lesson panel's 驗收 section
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      const view = renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
      const words = plain(view)
      expect(words).toContain('全部 6 項條件都通過（用的是載入的解答）')
      expect(words).not.toContain('課程完成')
      expect(view).toContain('lsn-pass is-answer')
      expect(filledButtons(view)).toContain('載入起始電路，自己接一次')
      expect(words).toContain('這次通過用的是載入的解答。載入起始電路、自己接一次，才算真正完成本課。')
      // the coach card's pass line
      const line = renderNow(createElement(CoachPassLine, { lesson: b1(), answer: true, earned: false, total: 6 }))
      expect(plain(line)).toContain('全部 6 項條件都通過（用的是載入的解答）')
      expect(plain(line)).toContain('載入起始電路，自己接一次')
      expect(plain(line)).not.toContain('課程完成')
      expect(plain(line)).not.toContain('下一課')
      // the hand-built pass keeps its own words
      const own = renderNow(createElement(CoachPassLine, { lesson: b1(), answer: false, earned: true, total: 6 }))
      expect(plain(own)).toContain('課程完成')
      expect(plain(own)).toContain('下一課：')
    },
    LONG,
  )

  it(
    '〔載入起始電路，自己接一次〕 loads the start circuit at once (〔復原〕), clears the answer pass and guides step 1',
    async () => {
      await answerPass()
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      requestLoad(b1(), 'start')
      for (let i = 0; i < 50 && passUsesSolution(b1().id); i++) await tick()
      expect(useLessonUi.getState().confirm ?? null).toBeNull()
      expect(passUsesSolution(b1().id)).toBe(false)
      expect(useLessonUi.getState().runs['b1-led-resistor|acceptance']).toBeUndefined() // the answer's pass is gone
      expect(useLessonUi.getState().coachId).toBe(b1().id)
      expect(useLessonProgress.getState().lessons[b1().id]?.step).toBe(0)
      expect(useStore.getState().layout.components.some((c) => c.type === 'resistor')).toBe(false) // the start: no R1 yet
      expect(getToasts()[getToasts().length - 1]?.action?.label).toBe('復原')
    },
    LONG,
  )

  it(
    'a lesson already earned on the learner’s own circuit: an answer pass keeps it earned — no 「才算完成」, 下一課 leads',
    async () => {
      expect(await loadLessonCircuit(b1(), 'start')).toBe(true)
      wireB1ByHand()
      await runAcceptance(b1())
      expect(lessonEarned(useLessonProgress.getState().lessons[b1().id])).toBe(true)
      __resetCelebrationForTests()
      await tick()
      expect(await loadLessonCircuit(b1(), 'solution')).toBe(true)
      for (const x of getToasts()) dismissToast(x.id)
      await runAcceptance(b1())
      expect(texts()).toEqual(['驗收 6 項全部通過（用的是載入的解答）。'])
      expect(useCelebration.getState().badge).toBeNull()
      expect(lessonEarned(useLessonProgress.getState().lessons[b1().id])).toBe(true)
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      const view = renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
      expect(plain(view)).toContain('全部 6 項條件都通過（用的是載入的解答）')
      expect(plain(view)).not.toContain('才算真正完成本課')
      const filled = filledButtons(view)
      expect(filled[filled.length - 1]).toMatch(/^下一課：/)
      const line = renderNow(createElement(CoachPassLine, { lesson: b1(), answer: true, earned: true, total: 6 }))
      expect(plain(line)).toContain('下一課：')
      expect(lessonPassToast(6, true, true)).toBe('驗收 6 項全部通過（用的是載入的解答）。')
    },
    LONG,
  )

  it(
    'the English classic chrome keeps its original pass block',
    async () => {
      await answerPass()
      __setLangForTests('en')
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance' })
      const view = renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
      expect(plain(view)).toContain('All 6 conditions pass — lesson complete!')
      expect(view).not.toContain('is-answer')
    },
    LONG,
  )

  it(
    'after a reload (no run on screen) a lesson completed with the answer reads 「以解答完成」 in 驗收 too, not 「你已於 … 完成本課」',
    async () => {
      await answerPass()
      useLessonUi.setState({ viewId: b1().id, section: 'acceptance', runs: {} })
      const words = plain(renderNow(createElement(LessonView, { lesson: b1(), variant: 'panel' })))
      expect(words).toContain('這次是載入解答後完成的——載入起始電路、自己接一次，才會記錄為「已完成」。')
      expect(words).not.toContain('完成本課。')
    },
    LONG,
  )
})
