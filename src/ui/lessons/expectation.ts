/**
 * The guided step's expected reading for one part (UX LS-15) — for the
 * inspector's big 讀數 card: 「本課預期 1.7 V – 1.9 V ✓／✕」 under the value
 * while the coach shows a step that measures that part (b1 step 6: DMM1).
 *
 *   currentStepExpectation(componentId)  non-reactive (null = nothing expected)
 *   useStepExpectation(componentId)      reactive: the guided lesson / step only
 *   expectationText(e)                    「本課預期 1.7 V – 1.9 V」
 *   meetsExpectation(e, value)            true / false / null (no usable value)
 *
 * Event-driven: re-evaluates when the guided lesson or its step changes —
 * never per frame (the caller compares its own live value).
 */
import { useMemo } from 'react'
import { lessonById } from '../../lessons'
import { useLessonProgress } from '../../lessons/progress'
import { meetsExpectation, stepExpectation, type StepExpectation } from '../../lessons/step-actions'
import { t } from '../../i18n'
import { clampStep } from './actions'
import { useLessonUi } from './state'

export { meetsExpectation, type StepExpectation }

/** The step the coach shows and what it expects `componentId` to read (null: no guide, or nothing measured there). */
export function currentStepExpectation(componentId: string): StepExpectation | null {
  const coachId = useLessonUi.getState().coachId
  const lesson = coachId ? lessonById(coachId) : undefined
  if (!lesson) return null
  return stepExpectation(lesson, clampStep(lesson, useLessonProgress.getState().lessons[lesson.id]?.step ?? 0), componentId)
}

/** Reactive currentStepExpectation (re-renders when the guided lesson or its step changes). */
export function useStepExpectation(componentId: string | null): StepExpectation | null {
  const coachId = useLessonUi((s) => s.coachId)
  const step = useLessonProgress((s) => (coachId ? (s.lessons[coachId]?.step ?? 0) : 0))
  return useMemo(() => {
    const lesson = coachId ? lessonById(coachId) : undefined
    if (!lesson || !componentId) return null
    return stepExpectation(lesson, clampStep(lesson, step), componentId)
  }, [coachId, step, componentId])
}

/** 「本課預期 1.7 V – 1.9 V」 */
export function expectationText(e: StepExpectation): string {
  return t('This lesson expects {range}', { range: e.range })
}
