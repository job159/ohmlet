/**
 * The inspector's problems panel and the ERC findings view.
 *
 *   ErcPanel           the problems panel (UX wave IN-3): everything that is
 *                      wrong or worth knowing, from the problems store
 *                      (src/ui/embedded/problems.ts, contract K3) — the
 *                      electrical rule check, the simulator's issues and the
 *                      MCU states — grouped 錯誤／風險／提示 and 執行後確認
 *                      (findings the firmware's pin set-up decides, IN-16),
 *                      each row with where it is, cause + fix, the problem's
 *                      own action and 「在電路板上標示」. One row per fact and
 *                      per common cause (folded by problems.ts). Root id
 *                      #ws-problems.
 *   ProblemsPanelView  its pure view (tests)
 *   ErcView            the plain ERC findings list (pure; ErcFindingsPanel
 *                      binds it to the store) grouped by level:
 *                        Error  certain from the wiring and the stated part ratings
 *                        Risk   a likely problem, or one that depends on firmware / values
 *                        Info   legal but worth knowing
 *
 * Both state plainly that these are rule-based checks, not a proof.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, InfoIcon, ListGroup, ListRow } from '../kit'
import { useStore } from '../../state/store'
import type { CircuitLayout } from '../../model/types'
import { ERC_RULES, ercCounts, runErc } from '../../sim/erc'
import type { ErcFinding, ErcLevel } from '../../sim/erc'
import { ChipButton, Popover } from './controls'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { tc, tText } from './text'
import { PROBLEMS_ANCHOR_ID, isBoardStateOf, mergeTitles, startProblemsWatcher, useProblems, type Problem, type ProblemLevel } from './problems'
import { ProblemRow, isRuntimeProblem, levelName, runtimeHint, stateGroupName, stateRowColor } from './ProblemsList'

/** One headline for headlines that differ in a single word (problems.ts folds with it). */
export { mergeTitles }
import './embedded.css'
import './ErcPanel.css'

/** English sources; shown through tc(…, 'erc') / t(). */
const LEVELS: { level: ErcLevel; title: string; hint: string }[] = [
  { level: 'error', title: 'Error', hint: 'Certain from the wiring and the part ratings' },
  { level: 'risk', title: 'Risk', hint: 'Likely problem, or depends on firmware / component values' },
  { level: 'info', title: 'Info', hint: 'Allowed, but worth knowing' },
]

const RULE_INFO = new Map(ERC_RULES.map((r) => [r.id, r]))

/** Re-publish `value` at most once per `ms` (trailing edge), so the checker does not re-run at frame rate. */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const now = Date.now()
    const wait = last.current + ms - now
    if (wait <= 0) {
      last.current = now
      setOut(value)
      return
    }
    const h = setTimeout(() => {
      last.current = Date.now()
      setOut(value)
    }, wait)
    return () => clearTimeout(h)
  }, [value, ms])
  return out
}

/** "1 error" / "2 risks" (t() sources '{n} error' / '{n} errors' …). */
function plural(n: number, word: 'error' | 'risk'): string {
  return t(n === 1 ? `{n} ${word}` : `{n} ${word}s`, { n })
}

function levelTitle(level: ErcLevel): string {
  return tc(level === 'error' ? 'Error' : level === 'risk' ? 'Risk' : 'Info', 'erc')
}

export type ErcResult = { findings: ErcFinding[] } | { error: string }

/**
 * Store-bound ERC-only view (current layout + throttled live telemetry and
 * issues). The app shows the problems panel (ErcPanel below) instead; this
 * stays for hosts that want the rule findings alone.
 */
export function ErcFindingsPanel() {
  const layout = useStore((s) => s.layout)
  const liveTelemetry = useStore((s) => s.telemetry)
  const liveIssues = useStore((s) => s.issues)
  const marqueeSelect = useStore((s) => s.marqueeSelect)
  const telemetry = useThrottled(liveTelemetry, 1000)
  const issues = useThrottled(liveIssues, 1000)

  const result = useMemo((): ErcResult => {
    try {
      return { findings: runErc(layout, { telemetry, issues }) }
    } catch (err) {
      return { error: String(err) }
    }
  }, [layout, telemetry, issues])

  return <ErcView result={result} live={telemetry !== null} onSelect={marqueeSelect} />
}

// ---------------------------------------------------------------------------
// The problems panel (UX wave IN-3): ERC + simulator issues + MCU states in
// one list, from the problems store (contract K3) — no runErc of its own.
// ---------------------------------------------------------------------------

/** Problem levels in display order (English sources through tc(…, 'problem')). */
const PROBLEM_LEVELS: { level: ProblemLevel; hint: string }[] = [
  { level: 'error', hint: 'Certain from the wiring and the part ratings' },
  { level: 'warning', hint: 'Likely problem, or depends on firmware / component values' },
  { level: 'info', hint: 'Allowed, but worth knowing' },
]

/**
 * The problems panel (root id `ws-problems` — the status pill scrolls here):
 * header 「問題」 with the count badges and an ⓘ 「這是什麼？」 note; groups
 * 錯誤／風險／提示; rows with where / cause + fix / actions (ProblemRow);
 * findings sharing a cause folded into one row; the static risks the live
 * readings cleared in a collapsed 「已由即時讀數排除（n）」 group.
 */
export function ErcPanel({ boardState }: { boardState?: string } = {}) {
  // the watcher is reference-counted: App starts it too (SH-4); this keeps
  // the panel honest even where it is the only consumer
  useEffect(() => startProblemsWatcher(), [])
  const problems = useProblems((s) => s.problems)
  const resolved = useProblems((s) => s.resolved)
  const live = useProblems((s) => s.live)
  const ercError = useProblems((s) => s.ercError)
  const layout = useStore((s) => s.layout)
  return <ProblemsPanelView problems={problems} resolved={resolved} live={live} ercError={ercError} layout={layout} boardState={boardState} />
}

/** Rows of one cause that a caller did not fold yet (same ErcFinding.group): the first carries the rest. */
function foldGroups(list: readonly Problem[]): Problem[] {
  const out: Problem[] = []
  const byGroup = new Map<string, number>()
  for (const p of list) {
    const at = p.group ? byGroup.get(`${p.level}:${p.group}`) : undefined
    if (at === undefined) {
      if (p.group) byGroup.set(`${p.level}:${p.group}`, out.length)
      out.push(p)
      continue
    }
    const head = out[at]
    const uniq = (xs: string[]) => [...new Set(xs)]
    out[at] = {
      ...head,
      title: mergeTitles([head.title, p.title]),
      componentIds: uniq([...head.componentIds, ...p.componentIds]),
      holes: uniq([...head.holes, ...p.holes]),
      wireIds: uniq([...(head.wireIds ?? []), ...(p.wireIds ?? [])]),
      affects: (head.affects ?? 1) + (p.affects ?? 1),
    }
  }
  return out
}

export function ProblemsPanelView({
  problems: all,
  resolved = [],
  live,
  ercError = null,
  layout,
  boardState,
}: {
  problems: readonly Problem[]
  resolved?: readonly Problem[]
  live: boolean
  ercError?: string | null
  layout?: CircuitLayout
  /**
   * the selected MCU board whose 執行狀態 card above already explains its
   * board-state facts (H5 blockerKindOf — QA IN-F3): those rows are left out here
   */
  boardState?: string
}) {
  useLang()
  const [showResolved, setShowResolved] = useState(false)
  const [infoAnchor, setInfoAnchor] = useState<HTMLButtonElement | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const problems = boardState ? all.filter((p) => !isBoardStateOf(p, boardState)) : all
  const omitted = all.length - problems.length
  // a board STATE (the debugger halt) is not a problem: its own first group, not counted (QA IN-F3)
  const states = problems.filter((p) => p.state)
  const counts = { error: 0, warning: 0, info: 0 }
  for (const p of problems) if (!p.state) counts[p.level]++
  // findings the firmware's pin set-up decides, before it ran (IN-16): their own group
  const pending = problems.filter((p) => p.pendingRuntime && !p.state)

  return (
    <div id={PROBLEMS_ANCHOR_ID} className="erc-panel insp-problems" tabIndex={-1}>
      <ListGroup
        header={
          <span className="erc-head-row">
            <span id={`${PROBLEMS_ANCHOR_ID}-heading`} className="erc-head-title" role="heading" aria-level={2} tabIndex={-1}>
              {t('Problems')}
            </span>
            {counts.error > 0 && (
              <span className="erc-badge is-error" aria-label={plural(counts.error, 'error')}>
                {counts.error}
              </span>
            )}
            {counts.warning > 0 && (
              <span className="erc-badge is-risk" aria-label={plural(counts.warning, 'risk')}>
                {counts.warning}
              </span>
            )}
            <span className="erc-head-spacer" />
            <button
              type="button"
              ref={setInfoAnchor}
              className="erc-info-btn"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((o) => !o)}
            >
              <InfoIcon size={14} />
              {t('What is this?')}
            </button>
          </span>
        }
        footer={`${t('Electrical rules')} · ${live ? t('Wiring + live readings') : t('Wiring and ratings (start the simulation to add live readings)')}`}
      >
        {ercError && (
          <div className="lg-row emb-issue" role="listitem">
            <span className="emb-issue-text">
              {t('The rule check could not run on this layout')} — {tMessage(ercError)}
            </span>
          </div>
        )}
        {problems.length === 0 && !ercError && (
          <ListRow
            // the sentence names the board and where its state is: it wraps, never cut off
            className="erc-allclear"
            leading={
              <span className="emb-ok" aria-hidden="true">
                <CheckIcon size={18} />
              </span>
            }
            // the rows the board's 執行狀態 card states are not "no problems" (QA IN-F3)
            title={omitted > 0 && boardState ? t('No other problems found ({id}: see its execution state above)', { id: boardState }) : t('No problems found')}
          />
        )}
        {states.length > 0 && [
          <div key="h:state" className="lg-row erc-group" role="listitem" title={runtimeHint()}>
            <span className="erc-dot is-state" style={{ background: stateRowColor(states[0]) }} aria-hidden="true" />
            <span className="erc-group-title">{stateGroupName()}</span>
            <span className="erc-group-hint">{runtimeHint()}</span>
          </div>,
          ...states.map((p) => <ProblemRow key={p.id} problem={p} layout={layout} />),
        ]}
        {PROBLEM_LEVELS.map(({ level, hint }) => {
          const group = foldGroups(problems.filter((p) => p.level === level && !p.pendingRuntime && !p.state))
          if (group.length === 0) return null
          // the level hints say what the WIRING makes certain; rows the running chip / simulator
          // report say so instead (a lockup is an error, but not one the wiring proves — QA IN-F3)
          const allRuntime = group.every(isRuntimeProblem)
          const hintText = allRuntime ? runtimeHint() : t(hint)
          return [
            <div key={`h:${level}`} className="lg-row erc-group" role="listitem" title={hintText}>
              <span className={`erc-dot ${level === 'warning' ? 'is-risk' : `is-${level}`}`} aria-hidden="true" />
              <span className="erc-group-title">
                {levelName(level)} <span className="erc-group-count">{group.length}</span>
              </span>
              <span className="erc-group-hint">{hintText}</span>
            </div>,
            ...group.map((p) => (
              <ProblemRow key={p.id} problem={p} layout={layout} basis={!allRuntime && isRuntimeProblem(p) ? runtimeHint() : undefined} />
            )),
          ]
        })}
        {pending.length > 0 && [
          <div key="h:pending" className="lg-row erc-group" role="listitem" title={t('Depends on how the firmware sets up its pins: run the simulation to check.')}>
            <span className="erc-dot is-info" aria-hidden="true" />
            <span className="erc-group-title is-pending">{t('Confirm after running ({n})', { n: pending.length })}</span>
            <span className="erc-group-hint">{t('Depends on how the firmware sets up its pins: run the simulation to check.')}</span>
          </div>,
          ...pending.map((p) => <ProblemRow key={p.id} problem={p} layout={layout} />),
        ]}
        {resolved.length > 0 && (
          <button
            type="button"
            role="listitem"
            className="lg-row erc-group is-toggle"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((o) => !o)}
          >
            <span className="erc-dot is-ok" aria-hidden="true" />
            <span className="erc-group-title">{t('Cleared by the live readings ({n})', { n: resolved.length })}</span>
            <span className="erc-group-chev" aria-hidden="true">
              {showResolved ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
            </span>
          </button>
        )}
        {showResolved &&
          resolved.map((p) => (
            <ProblemRow key={`r:${p.id}`} problem={p} layout={layout} dim note={p.note ?? t('The live readings show this is not a problem right now.')} />
          ))}
      </ListGroup>
      {infoOpen && (
        <Popover anchor={infoAnchor} onClose={() => setInfoOpen(false)} align="end" className="erc-info-pop" aria-label={t('What is this?')}>
          <span>
            {t(
              'Rule-based checks of the wiring, the parts’ datasheet ratings and the latest simulation readings — not a proof that the circuit works or is safe.',
            )}{' '}
            {t('Problems found while the simulation runs and the MCU’s state are listed here too.')}
          </span>
          <span className="erc-legend">
            <span className="erc-dot is-error" aria-hidden="true" />
            <span>
              <b>{levelName('error')}</b> {t('certain from the wiring and the part ratings')}
            </span>
            <span className="erc-dot is-risk" aria-hidden="true" />
            <span>
              <b>{levelName('warning')}</b> {t('a likely problem, or it depends on the firmware or part values')}
            </span>
            <span className="erc-dot is-info" aria-hidden="true" />
            <span>
              <b>{levelName('info')}</b> {t('allowed, but worth knowing')}
            </span>
            <span className="erc-dot is-state" style={{ background: stateRowColor({ fact: 'halt:' } as Problem) }} aria-hidden="true" />
            <span>
              <b>{stateGroupName()}</b> {t('what a board is doing right now (e.g. the debugger halted its core) — not counted as a problem')}
            </span>
          </span>
          <span>{t('Rows the running chip or the simulator reports are runtime states, not conclusions from the wiring.')}</span>
        </Popover>
      )}
    </div>
  )
}

/** The findings list (pure view — rendered by ErcPanel, and by tests). */
export function ErcView({
  result,
  live,
  onSelect,
}: {
  result: ErcResult
  /** findings include live telemetry */
  live: boolean
  /** select these component / wire ids on the board */
  onSelect: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(true)
  useLang()
  const findings = 'findings' in result ? result.findings : []
  const counts = ercCounts(findings)

  const summary =
    'error' in result
      ? t('The rule check could not run on this layout')
      : findings.length === 0
        ? t('No problems found')
        : [
            counts.error > 0 ? plural(counts.error, 'error') : null,
            counts.risk > 0 ? plural(counts.risk, 'risk') : null,
            counts.info > 0 ? t('{n} info', { n: counts.info }) : null,
          ]
            .filter(Boolean)
            .join(' · ')

  return (
    <div className="erc-panel">
      <ListGroup
        header={
          <span className="erc-head">
            {t('Electrical rules')}
            {counts.error > 0 && (
              <span className="erc-badge is-error" aria-label={plural(counts.error, 'error')}>
                {counts.error}
              </span>
            )}
            {counts.risk > 0 && (
              <span className="erc-badge is-risk" aria-label={plural(counts.risk, 'risk')}>
                {counts.risk}
              </span>
            )}
          </span>
        }
        footer={
          <>
            {live
              ? t(
                  'Rule-based checks of the wiring, the parts’ datasheet ratings and the latest simulation readings — not a proof that the circuit works or is safe.',
                )
              : t(
                  'Rule-based checks of the wiring and the parts’ datasheet ratings — not a proof that the circuit works or is safe.',
                )}{' '}
            <b>{levelTitle('error')}</b>
            {t(' = certain from the circuit graph; ')}
            <b>{levelTitle('risk')}</b>
            {t(' = likely problem, or depends on firmware or values; ')}
            <b>{levelTitle('info')}</b>
            {t(' = worth knowing.')}
          </>
        }
      >
        <ListRow
          leading={
            findings.length === 0 && !('error' in result) ? (
              <span className="emb-ok" aria-hidden="true">
                <CheckIcon size={18} />
              </span>
            ) : undefined
          }
          title={summary}
          subtitle={live ? t('Wiring + live readings') : t('Wiring and ratings (start the simulation to add live readings)')}
          trailing={
            findings.length > 0 ? (
              <span className="emb-disclose" aria-hidden="true">
                {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
              </span>
            ) : undefined
          }
          onPress={findings.length > 0 ? () => setOpen((o) => !o) : undefined}
        />
        {'error' in result && (
          <div className="lg-row emb-issue" role="listitem">
            <span className="emb-issue-text">{tMessage(result.error)}</span>
          </div>
        )}
        {open &&
          LEVELS.map(({ level, hint }) => {
            const group = findings.filter((f) => f.level === level)
            if (group.length === 0) return null
            const hintText = t(hint)
            return [
              <div key={`h:${level}`} className="lg-row erc-group" role="listitem" title={hintText}>
                <span className={`erc-dot is-${level}`} aria-hidden="true" />
                <span className="erc-group-title">
                  {levelTitle(level)} <span className="erc-group-count">{group.length}</span>
                </span>
                <span className="erc-group-hint">{hintText}</span>
              </div>,
              ...group.map((f) => (
                <FindingRow key={f.id} finding={f} onSelect={onSelect} />
              )),
            ]
          })}
      </ListGroup>
    </div>
  )
}

function FindingRow({ finding: f, onSelect }: { finding: ErcFinding; onSelect: (ids: string[]) => void }) {
  const ids = [...f.componentIds, ...(f.wireIds ?? [])]
  const where = f.holes.slice(0, 4).join(', ') + (f.holes.length > 4 ? ' …' : '')
  const rule = RULE_INFO.get(f.rule)
  const semantics = rule?.levels[f.level]
  return (
    <div className={`lg-row erc-finding is-${f.level}`} role="listitem">
      <span className={`erc-dot is-${f.level}`} aria-label={levelTitle(f.level)} />
      <span className="erc-body">
        <span className="erc-meta">
          <span className="erc-rule" title={semantics ? tText(semantics) : undefined}>
            {rule ? t(rule.title) : f.rule}
          </span>
          {where && <span className="erc-where emb-mono">{where}</span>}
          {ids.length > 0 && (
            <ChipButton
              onClick={() => onSelect(ids)}
              title={t('Select {ids} on the board', { ids: ids.join(', ') })}
              aria-label={t('Select parts {ids}', { ids: ids.join(', ') })}
            >
              {t('Select parts')}
            </ChipButton>
          )}
        </span>
        <span className="erc-message">{tMessage(f.message)}</span>
      </span>
    </div>
  )
}
