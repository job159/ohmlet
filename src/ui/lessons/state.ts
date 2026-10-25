/**
 * Lesson UI state (React-free zustand store, never persisted — progress is
 * src/lessons/progress.ts, which also remembers the guided lesson): which
 * lesson the browser shows, which section, the lesson the coach card is
 * guiding, where the coach sits, the phone / classic lessons sheet, the
 * pending "replace the board?" confirmation, a temporary 3D focus (a failed
 * check's parts, a hole chip), the check runs (acceptance or one step) with
 * their live progress and results, which step checks the learner has
 * attempted, a firmware load in flight, the 「為什麼？」 disclosure and a
 * request to bring a failed acceptance's cause into view.
 */
import { create } from 'zustand'
import type { EvalProgress, EvaluatedCheck } from '../../lessons/engine'
import { useLessonProgress } from '../../lessons/progress'

export type LessonSection = 'objectives' | 'wiring' | 'theory' | 'steps' | 'expected' | 'mistakes' | 'acceptance'

export const LESSON_SECTIONS: readonly LessonSection[] = [
  'objectives',
  'wiring',
  'theory',
  'steps',
  'expected',
  'mistakes',
  'acceptance',
]

export interface CheckRun {
  status: 'running' | 'done' | 'error'
  progress: EvalProgress | null
  results: EvaluatedCheck[] | null
  /** error text (already localized) */
  error?: string
  /** ms since epoch the run finished / started */
  at: number
}

/** Key of a run: the acceptance checks of a lesson, or one step's check. */
export function runKey(lessonId: string, stepId?: string): string {
  return stepId ? `${lessonId}|step:${stepId}` : `${lessonId}|acceptance`
}

/** Viewport rect of the floating coach card (CSS px), for the scene's top inset. */
export interface CoachRect {
  top: number
  bottom: number
  height: number
}

export interface LessonUiState {
  /**
   * Where the FLOATING coach card sits (UX contract K8, LS-3): published by
   * the card via ResizeObserver; null while no floating card is shown (none
   * guided, or the card lives in the workspace's #ws-coach-slot). App.tsx
   * reads it for the scene's top view inset (SH-4).
   */
  coachRect: CoachRect | null
  /** the coach card is docked in the workspace Library panel (#ws-coach-slot) */
  coachDocked: boolean
  /** lesson open in the browser (null = the lesson list) */
  viewId: string | null
  section: LessonSection
  /** lesson guided by the coach card over the scene (null = none) */
  coachId: string | null
  /** coach card body folded to its header line */
  coachFolded: boolean
  /** the 「為什麼？」 part of the coach's step text is open (remembered for the session) */
  whyOpen: boolean
  /** phone / classic-chrome lessons sheet */
  sheetOpen: boolean
  /** "load this circuit — replace the board?" waiting for an answer */
  confirm: { lessonId: string; which: 'start' | 'solution' } | null
  /** a failed check's parts / holes pointed at in 3D (overrides the step highlight) */
  focus: { key: string; components: string[]; holes: string[] } | null
  runs: Record<string, CheckRun>
  /**
   * step runs (runKey) the learner has attempted — pressed 檢查此步驟 / a step
   * action, or edited the circuit while on the step. Until then a failing
   * step check reads a neutral 「○ 尚未完成」, never a red ✕ (LS-4).
   */
  attempted: Record<string, true>
  /** `${component}|${project}` of a step-action firmware load in flight */
  loadingFirmware: string | null
  /**
   * 「查看原因」 on a failing acceptance toast (LS-12): that lesson's 驗收
   * section scrolls its outcome — the summary and 最可能的原因 — into view
   * once it shows (the section consumes the request).
   */
  revealCause: { lessonId: string; at: number } | null

  openLesson(id: string, section?: LessonSection): void
  closeLesson(): void
  setSection(section: LessonSection): void
  setCoach(id: string | null): void
  setCoachFolded(folded: boolean): void
  setCoachDocked(docked: boolean): void
  setWhyOpen(open: boolean): void
  setSheetOpen(open: boolean): void
  setConfirm(c: LessonUiState['confirm']): void
  setFocus(f: LessonUiState['focus']): void
  setRun(key: string, run: CheckRun | null): void
  markAttempted(key: string): void
  /** forget the attempts of every step of a lesson (a fresh circuit) */
  clearAttempts(lessonId: string): void
  setLoadingFirmware(key: string | null): void
  requestRevealCause(lessonId: string | null): void
  /** publish the floating coach rect (rounded to whole px; unchanged values are ignored) */
  setCoachRect(rect: CoachRect | null): void
}

export const useLessonUi = create<LessonUiState>()((set, get) => ({
  coachRect: null,
  coachDocked: false,
  viewId: null,
  section: 'objectives',
  coachId: null,
  coachFolded: false,
  whyOpen: false,
  sheetOpen: false,
  confirm: null,
  focus: null,
  runs: {},
  attempted: {},
  loadingFirmware: null,
  revealCause: null,

  openLesson(id, section) {
    const same = get().viewId === id
    set({ viewId: id, section: section ?? (same ? get().section : 'objectives') })
  },
  closeLesson() {
    set({ viewId: null })
  },
  setSection(section) {
    set({ section })
  },
  setCoach(id) {
    set({ coachId: id, focus: null, coachFolded: false })
    // remembered across reloads (LS-4): the next visit resumes the guide
    useLessonProgress.getState().setGuiding(id)
  },
  setCoachFolded(coachFolded) {
    set({ coachFolded })
  },
  setCoachDocked(coachDocked) {
    if (get().coachDocked !== coachDocked) set({ coachDocked })
  },
  setWhyOpen(whyOpen) {
    set({ whyOpen })
  },
  setSheetOpen(sheetOpen) {
    set({ sheetOpen })
  },
  setConfirm(confirm) {
    set({ confirm })
  },
  setFocus(focus) {
    set({ focus })
  },
  setRun(key, run) {
    const runs = { ...get().runs }
    if (run) runs[key] = run
    else delete runs[key]
    set({ runs })
  },
  markAttempted(key) {
    if (get().attempted[key]) return
    set({ attempted: { ...get().attempted, [key]: true } })
  },
  clearAttempts(lessonId) {
    const prefix = `${lessonId}|`
    const cur = get().attempted
    if (!Object.keys(cur).some((k) => k.startsWith(prefix))) return
    const attempted: Record<string, true> = {}
    for (const k of Object.keys(cur)) if (!k.startsWith(prefix)) attempted[k] = true
    set({ attempted })
  },
  setLoadingFirmware(loadingFirmware) {
    set({ loadingFirmware })
  },
  requestRevealCause(lessonId) {
    set({ revealCause: lessonId ? { lessonId, at: Date.now() } : null })
  },
  setCoachRect(rect) {
    const next =
      rect && [rect.top, rect.bottom, rect.height].every(Number.isFinite)
        ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) }
        : null
    const cur = get().coachRect
    if (cur === next || (cur && next && cur.top === next.top && cur.bottom === next.bottom && cur.height === next.height)) return
    set({ coachRect: next })
  },
}))
