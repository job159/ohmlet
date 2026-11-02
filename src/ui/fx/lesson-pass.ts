/**
 * Lesson-pass honesty (owner: cheer) — one rule for every surface that
 * reacts to a passed acceptance run:
 *
 *   passUsesSolution(lessonId)   the passing circuit is the loaded answer
 *                                (the solution was loaded after the start
 *                                circuit — read from the lesson's own
 *                                progress record, never changed here; the
 *                                same rule LessonOverlay / progress.complete
 *                                apply; the record's load stamps follow the
 *                                board across undo / redo — actions.ts
 *                                followLoadProvenance)
 *   entryUsesSolution(entry)     the same rule on a progress entry (React
 *                                selectors: LessonOverlay's 「卡住了？」,
 *                                the pass line of a run without a verdict)
 *   runUsesSolution(run)         the verdict an acceptance run carries,
 *                                taken when it started for the circuit it
 *                                evaluated (runAcceptance →
 *                                noteRunUsesSolution): the toast, the
 *                                progress record, the cheer, the coach's
 *                                pass line and the 驗收 pass block of that
 *                                run all use it
 *   lessonEarned(entry)         completed on the learner's OWN circuit (not
 *                                「以解答完成」)
 *   lessonPassToast(n, viaSolution)
 *                                runAcceptance's pass toast: the classic
 *                                chrome keeps its original sentence; the
 *                                product chrome drops it while the 「完成！」
 *                                badge already says it, and says plainly that
 *                                a pass with the loaded answer does not
 *                                complete the lesson (no badge, confetti or
 *                                chime then — success-watch.ts); a lesson
 *                                already earned on the learner's own circuit
 *                                stays earned, so then it only says which
 *                                circuit passed.
 * Every product-chrome surface of a pass with the loaded answer says the
 * same thing (final walkthrough): the toast, the coach's pass line and the
 * 驗收 headline 「全部 n 項條件都通過（用的是載入的解答）」, never 「課程完成」,
 * with the next step 〔載入起始電路，自己接一次〕.
 */
import { create } from 'zustand'
import { useLessonProgress, type LessonLoadStamps, type LessonProgressEntry } from '../../lessons/progress'
import { isLegacyChrome } from '../chrome/legacy'
import { t } from '../../i18n'
import { useCelebration } from './celebrate'

/**
 * Load stamps whose latest load is the full answer (the solution was loaded
 * after the start circuit). The stamps follow the board: undo / redo across
 * a lesson load puts back the stamps of the board it lands on
 * (src/ui/lessons/actions.ts followLoadProvenance), so they describe the
 * circuit on the board now, not merely the last load button pressed.
 */
export function stampsUseSolution(s: LessonLoadStamps | undefined): boolean {
  return !!s && s.solutionLoadedAt !== undefined && s.solutionLoadedAt > (s.startLoadedAt ?? -1)
}

/** A progress entry whose latest load is the full answer (the solution was loaded after the start circuit). */
export function entryUsesSolution(e: LessonProgressEntry | undefined): boolean {
  return stampsUseSolution(e)
}

/** The lesson was completed on the learner's own circuit (「已完成」, not 「以解答完成」). */
export function lessonEarned(e: LessonProgressEntry | undefined): boolean {
  return !!e && e.completedAt !== undefined && !e.viaSolution
}

/** The passing circuit is the loaded answer: the solution was loaded after the start circuit. */
export function passUsesSolution(lessonId: string): boolean {
  return entryUsesSolution(useLessonProgress.getState().lessons[lessonId])
}

/** The answer-pass verdict each published acceptance run carries (keyed by the run object). */
const runVerdicts = new WeakMap<object, boolean>()

/**
 * runAcceptance: `run` evaluated the loaded answer (or not) — the verdict
 * taken when the run started, for the very circuit it evaluated; an undo or
 * a load while it ran cannot change what it reports.
 */
export function noteRunUsesSolution(run: object, viaSolution: boolean): void {
  runVerdicts.set(run, viaSolution)
}

/** The verdict `run` carries (noteRunUsesSolution), undefined when it carries none. */
export function runUsesSolution(run: object | null | undefined): boolean | undefined {
  return run ? runVerdicts.get(run) : undefined
}

/** How many passes with the loaded answer went uncelebrated this page (tests / e2e). */
export const useSolutionPasses = create<{ count: number }>()(() => ({ count: 0 }))

/** success-watch: a pass with the loaded answer was seen and NOT celebrated. */
export function noteSolutionPass(): void {
  useSolutionPasses.setState((s) => ({ count: s.count + 1 }))
}

/**
 * The toast runAcceptance shows for a full pass (call it after the run was
 * published, so the badge is already up), or null when none is needed.
 */
export function lessonPassToast(n: number, viaSolution: boolean, earned = false): string | null {
  if (isLegacyChrome()) return t('Lesson complete — all {n} acceptance checks pass.', { n })
  if (viaSolution) {
    // already earned on the learner's own circuit: it stays earned — say only which circuit passed
    if (earned) return t('All {n} acceptance checks pass (with the loaded solution).|cheer', { n })
    return t('All {n} acceptance checks pass, but with the loaded solution — build it yourself to complete the lesson.|cheer', { n })
  }
  // the 「完成！」 badge says exactly this: one message, not two
  if (useCelebration.getState().badge?.kind === 'lesson-pass') return null
  return t('Lesson complete — all {n} acceptance checks pass.', { n })
}
