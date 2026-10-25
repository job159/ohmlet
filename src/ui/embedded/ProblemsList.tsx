/**
 * <ProblemsList/> — the problems of useProblems (src/ui/embedded/problems.ts,
 * contract K3) as a Tier-S list: level dot, headline, where it is, the
 * explanation and the two ways out — the problem's own fix (「載入韌體…」,
 * 「繼續執行」, 「對調兩腳」) and 「在電路板上標示」 (scene bridge, problem layer,
 * which also selects the problem's part).
 *
 *   variant 'panel'   — header 「問題（n）」, every problem with its detail;
 *                       an all-clear row when there is nothing to report
 *   variant 'compact' — ONE row (the most important, the same the status pill
 *                       would name) with a two-line explanation, and
 *                       「另 n 個」 that leads to the full problems panel
 *                       (#ws-problems) — or unfolds the rest where there is
 *                       no panel (the phone); renders nothing when clear —
 *                       the phone More sheet and the part editor's header
 *   componentId       — only the problems that involve that part
 *
 * ProblemRow is shared with the full problems panel (ErcPanel.tsx: level
 * groups, 「執行後確認」, 「已由即時讀數排除」, the ⓘ note, anchor #ws-problems).
 * Where a problem is reads as chips (「U1 PA5」, 「LED1 陰極」, 「導線 W1」):
 * a part chip opens its inspector at that pin, a wire chip selects the wire.
 * Under 「詳細」: the rule's meaning, the reference, and the rows folded
 * under this one (hidden readings, consequences). Reuses the ERC panel
 * classes (Tier-S, no backdrop-filter). Re-renders only when the problems
 * store publishes (≤ 1 Hz).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CheckIcon, ListGroup, ListRow } from '../kit'
import { useStore } from '../../state/store'
import type { CircuitLayout } from '../../model/types'
import { ERC_RULES } from '../../sim/erc/api'
import { t, useLang } from '../../i18n'
import { terminalLabel } from '../../i18n/parts'
import { focusInScene } from '../workspace/scene-bridge'
import { stateColor } from '../chrome/run-control'
import { ChipButton, sourceHoverProps, useSourceHoverRelease } from './controls'
import { tc, tText } from './text'
import {
  PROBLEMS_ANCHOR_ID,
  focusInspector,
  isBoardStateOf,
  locateProblem,
  problemWhereItems,
  startProblemsWatcher,
  useProblems,
  type Problem,
  type ProblemLevel,
  type ProblemWhereItem,
} from './problems'
import './embedded.css'
import './ErcPanel.css'

export interface ProblemsListProps {
  variant?: 'panel' | 'compact'
  /** only problems involving this component */
  componentId?: string
  /** leave these out (the host shows them its own way) */
  exclude?: (p: Problem) => boolean
  /**
   * the panel variant's header: omitted → 「問題（n）· 提示 m」 (problemsHeaderText);
   * a node → the host's own; null → none (the host already shows a header)
   */
  header?: ReactNode | null
  /**
   * an MCU board whose 執行狀態 card (#exec-{id}, McuPanel StateReason)
   * explains its board-state facts (H5 blockerKindOf — QA IN-F3): the
   * compact card shows such a row as its title + 「見下方執行狀態」, and does
   * not count the board's other state rows under 「另 n 個」
   */
  boardState?: string
}

/**
 * The problems count as the status pill, the 更多 badge and the More sheet
 * say it (SH-13 — one count everywhere): 「問題（n）」 with n = errors +
 * warnings, and 「· 提示 m」 when there are hints (info rows, incl. 執行後確認).
 * A board state (Problem.state — the debugger halt) is not a problem: not counted.
 */
export function problemsHeaderText(problems: readonly Problem[]): string {
  let n = 0
  let m = 0
  for (const p of problems) {
    if (p.state) continue
    if (p.level === 'info') m++
    else n++
  }
  return m > 0 ? t('Problems ({n}) · {m} hints', { n, m }) : t('Problems ({n})', { n })
}

/** ERC dot classes per problem level. */
const DOT: Record<ProblemLevel, string> = { error: 'is-error', warning: 'is-risk', info: 'is-info' }

const RULES = new Map(ERC_RULES.map((r) => [r.id, r]))

export function levelName(level: ProblemLevel): string {
  return level === 'error' ? tc('Error', 'problem') : level === 'warning' ? tc('Warning', 'problem') : tc('Info', 'problem')
}

/** The heading of the board states (Problem.state) — the first group of a problems list (QA IN-F3). */
export function stateGroupName(): string {
  return t('Current state|problem')
}

/**
 * The dot of a board-state row: the state's own colour from the one state
 * table (H6 — the capsule / pill / MCU badge colour), never a level's.
 */
export function stateRowColor(p: Problem): string {
  const kind = (p.fact ?? '').split(':')[0]
  return stateColor(kind === 'lockup' ? 'lockup' : kind === 'power' ? 'unpowered' : kind === 'fw-missing' ? 'no-firmware' : kind === 'boot0' ? 'boot-sysmem' : 'halted')
}

/**
 * Rows the simulation reports while it runs (the chip, the simulator) — not
 * decided by the wiring (QA IN-F3). 「U1 還沒有韌體」 is not one: it is known
 * before anything ran (no firmware is bound), so it never claims 「由模擬中
 * 的晶片回報」 — before ▶ that would not be true.
 */
export function isRuntimeProblem(p: Problem): boolean {
  if (p.source === 'mcu') return !p.fact?.startsWith('fw-missing:')
  return p.source === 'sim'
}

/** 「執行時狀態：由模擬中的晶片回報」 — where a row's certainty comes from when it is not the wiring. */
export function runtimeHint(): string {
  return t('Runtime state: reported by the chip in the simulation')
}

/** 「見下方執行狀態」: the board's 執行狀態 card (#exec-{id}) into view, focused. */
export function showExecutionCard(componentId: string): void {
  if (typeof document === 'undefined') return
  const row = document.getElementById(`exec-${componentId}`)
  if (!row) return
  const card = row.closest<HTMLElement>('.lg-listgroup') ?? row
  card.scrollIntoView({ block: 'start', behavior: 'smooth' })
  row.focus({ preventScroll: true })
}

/** Store-bound list: the problems of useProblems (re-renders when it publishes). */
export function ProblemsList(props: ProblemsListProps) {
  // the watcher is reference-counted: hosts that mount a list keep it running
  useEffect(() => startProblemsWatcher(), [])
  const problems = useProblems((s) => s.problems)
  const layout = useStore((s) => s.layout)
  return <ProblemsView {...props} problems={problems} layout={layout} />
}

/**
 * 「另 n 個」: bring the full problems panel up (the workspace inspector's
 * #ws-problems, scrolled to and its heading focused). False when there is no
 * panel on screen (the phone) — the caller unfolds the list instead.
 */
function showAllProblems(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(PROBLEMS_ANCHOR_ID)
  if (!el) return false
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const heading = document.getElementById(`${PROBLEMS_ANCHOR_ID}-heading`) ?? el
  heading.focus({ preventScroll: true })
  return true
}

/** The pure list (rendered by ProblemsList, and by tests / callers with their own list). */
export function ProblemsView({
  variant = 'panel',
  componentId,
  problems: all,
  layout,
  exclude,
  header,
  boardState,
}: ProblemsListProps & { problems: readonly Problem[]; layout?: CircuitLayout }) {
  useLang()
  const [unfolded, setUnfolded] = useState(false)
  const mine = all.filter((p) => (!componentId || p.componentIds.includes(componentId)) && !exclude?.(p))
  const compact = variant === 'compact'
  // the board's state facts are explained once, in its 執行狀態 card (QA IN-F3)
  const isState = (p: Problem): boolean => !!boardState && isBoardStateOf(p, boardState)
  // compact: the most important row only (the list is sorted, as the pill reads it) — the
  // board's further state rows are in its 執行狀態 card, not under 「另 n 個」
  const problems = compact && boardState ? mine.filter((p, i) => i === 0 || !isState(p)) : mine
  if (compact && problems.length === 0) return null
  // a list: the board states first, under 「目前狀態」 (QA IN-F3)
  const states = compact ? [] : problems.filter((p) => p.state)
  const ordered = states.length > 0 ? [...states, ...problems.filter((p) => !p.state)] : problems
  const shown = compact && !unfolded ? ordered.slice(0, 1) : ordered
  const more = ordered.length - shown.length
  const row = (p: Problem) => (
    <ProblemRow
      key={p.id}
      problem={p}
      compact={compact}
      layout={layout}
      hideWhere={!!componentId}
      stateLink={compact && boardState && isState(p) ? boardState : undefined}
    />
  )
  return (
    <ListGroup
      className={`erc-panel ${compact ? 'is-compact' : ''}`}
      header={compact ? undefined : header !== undefined ? header ?? undefined : problemsHeaderText(problems)}
    >
      {ordered.length === 0 ? (
        <ListRow
          leading={
            <span className="emb-ok" aria-hidden="true">
              <CheckIcon size={18} />
            </span>
          }
          title={t('No problems found')}
        />
      ) : states.length > 0 ? (
        <>
          <div className="lg-row erc-group" role="listitem">
            <span className="erc-dot is-state" style={{ background: stateRowColor(states[0]) }} aria-hidden="true" />
            <span className="erc-group-title">{stateGroupName()}</span>
          </div>
          {shown.filter((p) => p.state).map(row)}
          {shown.some((p) => !p.state) && (
            <div className="lg-row erc-group" role="listitem">
              <span className="erc-group-title">{t('Problems')}</span>
            </div>
          )}
          {shown.filter((p) => !p.state).map(row)}
        </>
      ) : (
        shown.map(row)
      )}
      {more > 0 && (
        <div className="lg-row erc-more-row" role="listitem">
          <button
            type="button"
            className="erc-more is-all"
            title={t('See every problem')}
            onClick={() => {
              if (!showAllProblems()) setUnfolded(true)
            }}
          >
            {t('and {n} more', { n: more })}
          </button>
        </div>
      )}
    </ListGroup>
  )
}

/** Folded rows listed under 「詳細」 before 「另 n 個」. */
const FOLDED_SHOWN = 6

/** Explanations longer than this get the 「詳細」 disclosure (the rest is clamped). */
const LONG_DETAIL = 90

/**
 * Does the line-clamped element hide text (scrollHeight beyond its box)?
 * Checked after layout and when its width changes (a narrow panel clamps a
 * short explanation too) — so 「詳細」 appears whenever something is cut off.
 */
function useClamped(ref: RefObject<HTMLElement | null>, active: boolean, text: string): boolean {
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, active, text])
  return clamped
}

/** 「在電路板上標示」, falling back to selecting the parts while no 3D scene is registered. */
export function showProblemOnBoard(p: Problem): void {
  if (locateProblem(p)) return
  const ids = [...p.componentIds, ...(p.wireIds ?? [])]
  if (ids.length > 0) useStore.getState().marqueeSelect(ids)
}

/** A where chip: a part opens its inspector (at the pin the problem names), a wire is selected and framed. */
function goTo(item: ProblemWhereItem): void {
  if (item.kind === 'part') {
    // the pin row is #pin-{id}-{pin} (an MCU opens its 腳位 tab there)
    focusInspector(item.id, item.pins[0] ? { pin: item.pins[0] } : {})
  } else if (item.kind === 'wire') {
    useStore.getState().select(item.id)
    focusInScene({ components: [item.id] }, { kind: 'guide' })
  }
}

/** Where the problem is, as chips (IN-19): 「U1 PA5」 → U1's 腳位 tab at PA5; 「導線 W1」 → the wire. */
function WhereChips({ problem: p, layout }: { problem: Problem; layout: CircuitLayout }) {
  useSourceHoverRelease()
  const items = problemWhereItems(p, layout)
  if (items.length === 0) return null
  // the holes as names a person reads (UX helpers H1 / H2): 「PS1 正端」, never "PS1:+"
  const holes = p.holes.slice(0, 6).map((h) => (h.includes(':') ? terminalLabel(h, layout) : h))
  return (
    <span className="erc-where erc-where-chips" title={holes.length > 0 ? holes.join(t(', ')) + (p.holes.length > 6 ? ' …' : '') : undefined}>
      {items.map((item, i) =>
        item.kind === 'more' ? (
          <span key={`more:${i}`} className="erc-where-more" title={item.title}>
            {item.text}
          </span>
        ) : (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            className="erc-where-chip"
            title={item.title}
            // the mouse on 「U1 PA5」 / 「導線 W1」 marks that part or wire on the board (H7 hover marker)
            {...sourceHoverProps({ components: [item.id] })}
            onClick={(e) => {
              e.stopPropagation()
              goTo(item)
            }}
          >
            {item.text}
          </button>
        ),
      )}
    </span>
  )
}

export function ProblemRow({
  problem: p,
  compact = false,
  layout,
  hideWhere = false,
  dim = false,
  note,
  stateLink,
  basis,
}: {
  problem: Problem
  compact?: boolean
  layout?: CircuitLayout
  /** the host already says which part (the part editor) */
  hideWhere?: boolean
  /** de-emphasised (resolved problems) */
  dim?: boolean
  /** a caption under the headline (「即時讀數顯示目前沒有這個問題」) — the row's own note wins */
  note?: string
  /**
   * the board whose 執行狀態 card explains this row (a board-state fact —
   * QA IN-F3): only the headline and 「見下方執行狀態」, the sentence and its
   * fix are in that card
   */
  stateLink?: string
  /** where the row's certainty comes from when its group's hint does not say it (「執行時狀態：由模擬中的晶片回報」) */
  basis?: string
}) {
  const [open, setOpen] = useState(false)
  const canLocate = p.componentIds.length > 0 || p.holes.length > 0 || (p.wireIds?.length ?? 0) > 0
  const rule = p.rule ? RULES.get(p.rule as (typeof ERC_RULES)[number]['id']) : undefined
  const ercLevel = p.level === 'warning' ? 'risk' : p.level
  const semantics = rule?.levels[ercLevel]
  const showDetail = p.detail !== p.title
  const msgRef = useRef<HTMLSpanElement>(null)
  const clamped = useClamped(msgRef, showDetail && !open, p.detail)
  const long = p.detail.length > LONG_DETAIL || clamped
  const folded = p.folded && p.folded.items.length > 0 ? p.folded : null
  const expandable = showDetail && (long || !!p.ref || !!folded || (!compact && !!semantics))
  const caption = p.note ?? note ?? (p.affects && p.affects > 1 ? t('1 cause · affects {n} places', { n: p.affects }) : undefined)
  const fallbackWhere = [...p.componentIds, ...p.holes.slice(0, 3)].join(t(', '))
  // a board state (the debugger halt) has the state's own colour and no level (QA IN-F3)
  const dot = p.state ? (
    <span className="erc-dot is-state" style={{ background: stateRowColor(p) }} aria-label={stateGroupName()} />
  ) : (
    <span className={`erc-dot ${DOT[p.level]}`} aria-label={levelName(p.level)} />
  )
  if (stateLink) {
    return (
      <div className={`lg-row erc-finding is-${p.level === 'warning' ? 'risk' : p.level} is-state-link`} role="listitem">
        {dot}
        <span className="erc-body">
          <span className="erc-title">{p.title}</span>
          <span className="erc-actions">
            <ChipButton onClick={() => showExecutionCard(stateLink)}>{t('See the execution state below')}</ChipButton>
          </span>
        </span>
      </div>
    )
  }
  return (
    <div className={`lg-row erc-finding is-${p.level === 'warning' ? 'risk' : p.level} ${dim ? 'is-dim' : ''}`} role="listitem">
      {dot}
      <span className="erc-body">
        <span className="erc-title">{p.title}</span>
        {!hideWhere &&
          (layout ? (
            <WhereChips problem={p} layout={layout} />
          ) : (
            fallbackWhere && <span className="erc-where">{fallbackWhere}</span>
          ))}
        {caption && <span className="erc-note">{caption}</span>}
        {basis && <span className="erc-note erc-basis">{basis}</span>}
        {showDetail && (
          <span ref={msgRef} className={`erc-message ${open ? '' : compact ? 'is-clamp-2' : 'is-clamp-3'}`}>
            {p.detail}
          </span>
        )}
        {open && (p.ref || semantics || folded) && (
          <span className="erc-ref">
            {folded && (
              <span className="erc-folded">
                <span className="erc-folded-head">{folded.head}</span>
                {/* a long list (31 pin readings) shows its first lines and how many more */}
                {(folded.items.length > FOLDED_SHOWN + 2 ? folded.items.slice(0, FOLDED_SHOWN) : folded.items).map((item, i) => (
                  <span key={`${i}:${item}`} className="erc-folded-item">
                    {item}
                  </span>
                ))}
                {folded.items.length > FOLDED_SHOWN + 2 && (
                  <span className="erc-folded-item is-more">{t('and {n} more', { n: folded.items.length - FOLDED_SHOWN })}</span>
                )}
              </span>
            )}
            {rule && semantics && <span>{t('{rule}: {meaning}', { rule: tText(rule.title), meaning: tText(semantics) })}</span>}
            {p.ref && <span>{t('Reference: {ref}', { ref: p.ref })}</span>}
          </span>
        )}
        {(p.action || canLocate || expandable) && (
          <span className="erc-actions">
            {p.action && (
              <ChipButton accent onClick={() => p.action?.run()}>
                {p.action.label}
              </ChipButton>
            )}
            {p.extraActions?.map((a) => (
              <ChipButton key={a.label} onClick={() => a.run()}>
                {a.label}
              </ChipButton>
            ))}
            {canLocate && (
              <ChipButton onClick={() => showProblemOnBoard(p)} aria-label={t('Show {what} on the board', { what: p.title })}>
                {t('Show on the board')}
              </ChipButton>
            )}
            {expandable && (
              <button type="button" className="erc-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? t('Less') : t('Details|problem')}
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  )
}
