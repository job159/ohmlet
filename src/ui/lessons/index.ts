/**
 * Lesson UI (src/lessons holds the lessons, the engine and the progress
 * store): the browser shown in the workspace Library panel's 課程 tab and in
 * the lessons sheet, the overlay App.tsx mounts (coach card, 3D highlights,
 * lessons sheet, load confirmation) and the actions they share.
 */
export { LessonBrowser } from './LessonBrowser'
export { LessonOverlay } from './LessonOverlay'
export { openLessons, startGuide, stopGuide, requestLoad, loadLessonCircuit, runAcceptance, runStepCheck } from './actions'
export { useLessonUi, runKey, LESSON_SECTIONS, type LessonSection, type CheckRun } from './state'
export { currentStepExpectation, expectationText, meetsExpectation, useStepExpectation, type StepExpectation } from './expectation'
