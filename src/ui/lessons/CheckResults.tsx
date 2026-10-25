/**
 * A list of lesson checks with their live state: pending before a run, the
 * check being evaluated while it runs, then per-check pass / fail with the
 * evaluator's zh-TW detail (measured vs expected), technical lines (firmware
 * output, contract rule ids — verbatim), the sub-checks of an 'all' check,
 * and 「在電路板上標示」 for a failed check's parts / holes. A passed
 * firmware-loaded check says what is still needed to RUN it (LS-8).
 *
 * A step check the learner has not attempted yet (`attempted={false}`)
 * reads a neutral 「○ 尚未完成」 instead of a red ✕ (LS-4).
 *
 * A check that failed because a part is not on the board (EvaluatedCheck
 * .missing, release QA LS-F10 — 「電路中沒有 DMM2」) never offers to mark
 * that part; when the lesson's starting circuit holds it, the first such
 * row offers 「載入起始電路」 instead (once per list).
 *
 * With `lesson` (the acceptance list), root cause first (LS-5):
 *  - half or more of the parts the checks name missing from the board →
 *    one callout 「麵包板上沒有本課的起始電路」 + 「載入起始電路」;
 *  - 「最可能的原因」: ERC findings about the failing checks' parts (a live
 *    runErc when the run finished) with 「在電路板上標示」, then the lesson's
 *    common mistake whose `match` fits 「對照常見錯誤：… → 解法：…」;
 *  - measure checks that fail only because a structural check on the same
 *    parts fails fold under 「另外 n 項因此未通過」.
 *
 * A check that performs a learner action itself (its runtime stimulus,
 * final round) says so under its label — before the run from the lesson
 * data, after it with the times it really used: 「檢查時會自動操作：0.1 秒時
 * 把 ENC1 的「位置」設為 5」.
 */
import { useMemo, useState } from 'react'
import type { Lesson, LessonCheck, LessonStimulus } from '../../lessons/types'
import { checkLabel, stimulusText, type EvaluatedCheck } from '../../lessons/engine'
import { dependentFailures, matchMistake, missingStartParts, relatedFindings } from '../../lessons/diagnose'
import { runErc, type ErcFinding } from '../../sim/erc'
import { useStore } from '../../state/store'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import type { TerminalOwners } from '../../i18n/parts'
import { ChevronDownIcon, ChevronRightIcon, PressableButton } from '../kit'
import { focusInScene } from '../workspace/scene-bridge'
import { useSimPhase } from '../chrome/run-control'
import { useLessonUi, type CheckRun } from './state'
import { CheckGlyph, RunProgress, stateText, type CheckState } from './labels'
import { LessonInline } from './LessonText'
import { requestLoad } from './actions'

/**
 * After 「U1 已載入 hal-blink.elf。」: what the learner still has to do for it
 * to run (LS-8) — live, so it disappears the moment ▶ 執行模擬 is pressed.
 * A halted / faulted core is the capsule's and the status pill's to explain.
 */
function RunPhaseHint() {
  const phase = useSimPhase()
  if (phase === 'idle') return <>{t(' (it starts running when you press ▶ Run simulation)')}</>
  if (phase === 'paused') return <>{t(' (the simulation is paused — press ▶ Run simulation to continue)')}</>
  return null
}

/** Point at a failed check's / finding's parts: the lesson highlight layer + the camera (K4). */
function showInScene(key: string, components: string[], holes: string[]): void {
  useLessonUi.getState().setFocus({ key, components, holes })
  focusInScene({ components, holes }, { kind: 'guide' })
}

/** The lesson's starting circuit holds a part the check found missing (an id, or a has-part type). */
export function startHoldsMissing(lesson: Lesson | undefined, missing: readonly string[] | undefined): boolean {
  if (!lesson || !missing || missing.length === 0) return false
  return missing.some((m) => lesson.start.layout.components.some((c) => c.id === m || c.type === m))
}

function ResultRow({
  r,
  runId,
  depth,
  attempted,
  owner,
  offerStart = false,
}: {
  r: EvaluatedCheck
  runId: string
  depth: number
  attempted: boolean
  /** the lesson the check belongs to (「載入起始電路」 on a missing part) */
  owner?: Lesson
  /** this row offers 「載入起始電路」 (the list's first row that failed for a part the start circuit holds) */
  offerStart?: boolean
}) {
  const focus = useLessonUi((s) => s.focus)
  const setFocus = useLessonUi((s) => s.setFocus)
  const state: CheckState = r.pass ? 'pass' : !attempted ? 'todo' : r.error ? 'error' : 'fail'
  const key = `${runId}#${r.key}`
  // a check that failed for a part that is not on the board has nothing to mark there (LS-F10): the
  // part itself is not there, and marking the others would point at what is not the problem
  const marks = r.focus && !(r.missing && r.missing.length > 0) ? r.focus : null
  const focusable = state !== 'todo' && !r.pass && !!marks && (marks.components.length > 0 || marks.holes.length > 0)
  const loadOffer = offerStart && state !== 'todo' && !r.pass && !!owner
  const focused = focus?.key === key
  return (
    <li className={`lsn-check is-${state}`} aria-label={t('{label}: {state}', { label: r.label, state: stateText(state) })}>
      <CheckGlyph state={state} />
      <div className="lsn-check-body">
        <span className="lsn-check-label">
          <LessonInline text={r.label} />
        </span>
        {r.stimulus && <span className="lsn-check-stim">{r.stimulus}</span>}
        {state === 'todo' ? (
          <span className="lsn-check-todo">{t('Not done yet')}</span>
        ) : (
          <>
            {r.detail && (
              <span className="lsn-check-detail">
                {r.detail}
                {r.kind === 'firmware-loaded' && r.pass && <RunPhaseHint />}
              </span>
            )}
            {r.technical && r.technical.length > 0 && (
              <span className="lsn-check-tech" translate="no">
                {r.technical.map((line, i) => (
                  <span key={i}>{line}</span>
                ))}
              </span>
            )}
            {r.children && r.children.length > 0 && depth < 3 && (
              <ul className="lsn-checks is-nested">
                {r.children.map((c) => (
                  <ResultRow key={c.key} r={c} runId={runId} depth={depth + 1} attempted={attempted} owner={owner} />
                ))}
              </ul>
            )}
          </>
        )}
        {focusable && marks && (
          <button
            type="button"
            className="lsn-link"
            aria-pressed={focused}
            onClick={() => (focused ? setFocus(null) : showInScene(key, marks.components, marks.holes))}
          >
            {focused ? t('Hide on the board') : t('Show on the board')}
          </button>
        )}
        {loadOffer && owner && (
          <span className="lsn-check-load">
            <PressableButton size="sm" variant="tinted" onClick={() => requestLoad(owner, 'start')}>
              {t('Load starting circuit')}
            </PressableButton>
          </span>
        )}
      </div>
    </li>
  )
}

/** ERC findings of the live circuit, computed once per finished run (event-driven, never per frame). */
function useRunFindings(run: CheckRun | undefined, enabled: boolean): ErcFinding[] {
  const at = run?.status === 'done' ? run.at : null
  return useMemo(() => {
    if (!enabled || at === null) return []
    const s = useStore.getState()
    try {
      // telemetry only while it describes the running circuit; otherwise the static rules
      return runErc(s.layout, s.running ? { telemetry: s.telemetry, issues: s.issues } : {})
    } catch {
      return []
    }
  }, [at, enabled])
}

function CauseCallout({ lesson, results, findings }: { lesson: Lesson; results: EvaluatedCheck[]; findings: ErcFinding[] }) {
  const focus = useLessonUi((s) => s.focus)
  const related = useMemo(() => relatedFindings(findings, results), [findings, results])
  const mistake = useMemo(() => matchMistake(lesson, results, findings), [lesson, results, findings])
  if (related.length === 0 && !mistake) return null
  return (
    <div className="lsn-cause" role="note" aria-label={t('Most likely cause')}>
      <div className="lsn-cause-title">{t('Most likely cause')}</div>
      <ul className="lsn-cause-list">
        {related.map((f) => {
          const key = `erc:${f.id}`
          const on = focus?.key === key
          const where = f.componentIds.length > 0 || f.holes.length > 0
          return (
            <li key={f.id} className={`lsn-cause-item is-${f.level}`}>
              <span className="lsn-cause-dot" aria-hidden="true" />
              <span className="lsn-cause-text">
                {tMessage(f.message)}
                {where && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="lsn-link is-inline"
                      aria-pressed={on}
                      onClick={() => {
                        if (on) {
                          useLessonUi.getState().setFocus(null)
                          return
                        }
                        useLessonUi.getState().setFocus({ key, components: f.componentIds, holes: f.holes })
                        const spec = { components: [...f.componentIds, ...(f.wireIds ?? [])], holes: f.holes }
                        if (f.level === 'info') focusInScene(spec, { kind: 'guide' })
                        else focusInScene(spec, { kind: 'problem', level: f.level === 'error' ? 'error' : 'risk' })
                      }}
                    >
                      {/* the Problems list shows this very finding: same words for the same action */}
                      {on ? t('Hide on the board') : t('Show on the board')}
                    </button>
                  </>
                )}
              </span>
            </li>
          )
        })}
        {mistake && (
          <li className="lsn-cause-item is-mistake">
            <span className="lsn-cause-dot" aria-hidden="true" />
            <span className="lsn-cause-text">
              <strong>{t('Compare with a common mistake:')}</strong> <LessonInline text={mistake.symptom} />
              {' → '}
              <strong>{t('Fix:')}</strong> <LessonInline text={mistake.fix} />
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function StartCircuitCallout({ lesson }: { lesson: Lesson }) {
  return (
    <div className="lsn-callout is-start" role="status">
      <span>{t('The board does not hold this lesson’s starting circuit — load it first.')}</span>
      <PressableButton size="sm" variant="filled" onClick={() => requestLoad(lesson, 'start')}>
        {t('Load starting circuit')}
      </PressableButton>
    </div>
  )
}

export function CheckResults({
  checks,
  run,
  runId,
  onCancel,
  attempted = true,
  lesson,
  names = lesson,
}: {
  checks: readonly LessonCheck[]
  run: CheckRun | undefined
  /** the run's key (focus keys are scoped by it) */
  runId: string
  onCancel?: () => void
  /** the learner tried this (pressed check / edited the circuit): failures read ✕, else 「尚未完成」 */
  attempted?: boolean
  /** the acceptance list of this lesson: diagnosis, folded dependent failures, missing start circuit */
  lesson?: Lesson
  /** the lesson the checks belong to, for pin names before a run (H1) — defaults to `lesson` */
  names?: Lesson
}) {
  useLang()
  const [showDependents, setShowDependents] = useState(false)
  const layout = useStore((s) => (lesson ? s.layout : null))
  const missing = useMemo(() => (lesson && layout ? missingStartParts(lesson, layout) : null), [lesson, layout])
  const running = run?.status === 'running'
  const done = run?.status === 'done' && run.results ? run.results : null
  const findings = useRunFindings(run, !!lesson && !!done && done.some((r) => !r.pass))
  const dependents = useMemo(() => (lesson && done ? dependentFailures(checks, done) : new Set<string>()), [lesson, done, checks])
  const noStart = !!missing?.mostlyMissing
  // 「載入起始電路」 once per list: on the first row that failed for a part the starting circuit holds (LS-F10)
  // (a row in view first — not one folded under 「另外 n 項因此未通過」)
  const startOffer = useMemo(() => {
    if (!done || !names) return null
    const offers = (r: EvaluatedCheck) => !r.pass && startHoldsMissing(names, r.missing)
    return (done.find((r) => !dependents.has(r.key) && offers(r)) ?? done.find(offers))?.key ?? null
  }, [done, names, dependents])

  return (
    <div className="lsn-results">
      {running && <RunProgress progress={run.progress} onCancel={onCancel} />}
      {run?.status === 'error' && (
        <div className="lsn-callout is-error" role="alert">
          {t('The check could not run: {error}', { error: run.error ?? '' })}
        </div>
      )}
      {lesson && noStart && !running && <StartCircuitCallout lesson={lesson} />}
      {done ? (
        noStart && lesson ? null : (
          <>
            {lesson && <CauseCallout lesson={lesson} results={done} findings={findings} />}
            <ul className="lsn-checks">
              {done
                .filter((r) => !dependents.has(r.key))
                .map((r) => (
                  <ResultRow key={r.key} r={r} runId={runId} depth={0} attempted={attempted} owner={names} offerStart={r.key === startOffer} />
                ))}
            </ul>
            {dependents.size > 0 && (
              <div className="lsn-dependents">
                <button
                  type="button"
                  className="lsn-disclosure"
                  aria-expanded={showDependents}
                  onClick={() => setShowDependents(!showDependents)}
                >
                  {showDependents ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                  <span>{t('{n} more fail because of this', { n: dependents.size })}</span>
                </button>
                {showDependents && (
                  <ul className="lsn-checks is-dependent">
                    {done
                      .filter((r) => dependents.has(r.key))
                      .map((r) => (
                        <ResultRow key={r.key} r={r} runId={runId} depth={0} attempted={attempted} owner={names} offerStart={r.key === startOffer} />
                      ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )
      ) : (
        <ul className="lsn-checks">
          {checks.map((c, i) => {
            const state: CheckState = running && run.progress?.index === i ? 'running' : 'pending'
            const parts = partsFor(names)
            const label = checkLabel(c, parts)
            const stim = stimulusOf(c)
            return (
              <li key={i} className={`lsn-check is-${state}`} aria-label={t('{label}: {state}', { label, state: stateText(state) })}>
                <CheckGlyph state={state} />
                <div className="lsn-check-body">
                  <span className="lsn-check-label">
                    <LessonInline text={label} />
                  </span>
                  {stim.length > 0 && <span className="lsn-check-stim">{stimulusText(stim, parts)}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The learner actions a check (with its sub-checks) performs itself while it runs. */
function stimulusOf(c: LessonCheck): LessonStimulus[] {
  if (c.kind === 'all') return c.checks.flatMap(stimulusOf)
  return (c.kind === 'measure' || c.kind === 'uart-contains') && c.stimulus ? c.stimulus : []
}

/** Which catalog part each id is, for pin names (H1): the live board first, then the lesson's own circuits. */
function partsFor(lesson: Lesson | undefined): TerminalOwners {
  const live = useStore.getState().layout.components
  return { components: lesson ? [...live, ...lesson.solution.layout.components, ...lesson.start.layout.components] : live }
}

/** "n / m 項通過" of a finished run (null while none). */
export function runSummary(run: CheckRun | undefined): { passed: number; total: number } | null {
  if (!run || run.status !== 'done' || !run.results) return null
  return { passed: run.results.filter((r) => r.pass).length, total: run.results.length }
}
