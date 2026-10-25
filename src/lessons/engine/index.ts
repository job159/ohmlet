/**
 * Lesson engine: evaluates lesson checks against the real simulation
 * (evaluate.ts), runs them off the main thread (run.ts + the lesson-check
 * worker), formats their texts (format.ts) and parses the lesson Markdown
 * subset (markdown.ts). Lesson progress lives in ../progress.ts.
 */
export {
  DEFAULT_MEASURE_SECONDS,
  DEFAULT_UART_SECONDS,
  ERC_SETTLE_SECONDS,
  EvalCancelledError,
  EvalContext,
  MAX_MEASURE_SECONDS,
  MAX_UART_SECONDS,
  checkWeight,
  evaluateCheck,
  evaluateChecks,
  evaluateLesson,
  lessonCircuitInput,
  type EvalInput,
  type EvalOptions,
  type EvalProgress,
  type EvaluatedCheck,
  type LessonEvaluation,
} from './evaluate'
export { assetNeeds, collectAssets, defaultAssets, hasBundled, prefetchedAssets, type AssetBundle, type EvalAssets, type FirmwareFile } from './assets'
export { runLessonChecks, type LessonCheckMessage, type LessonCheckRequest, type RunLessonChecksOptions } from './run'
export { checkLabel, fmtMeasured, fmtQuantity, fmtRange, fmtSi, partName, quantityName, stimulusText } from './format'
export { parseInline, parseMarkdown, markdownPlainText, type MdBlock, type MdInline } from './markdown'
export { catalogPin, pinRefComponent, pinRefText, resolvePinRef, type ResolvedRef } from './refs'
