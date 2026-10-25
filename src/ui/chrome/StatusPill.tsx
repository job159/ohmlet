/**
 * StatusPill — 「狀態提示列」 (UX wave SH-2): the always-visible answer to
 * "what is wrong / what do I do next", hanging under the run capsule.
 *
 *   ● U1 還沒有韌體 · 另 2 個            [載入韌體…] ›
 *
 * Priority (statusPillModel, pure):
 *   1. the top error   (red dot)   — problem title, 「· 另 n 個」, its fix
 *   2. the top warning (amber dot) — same layout; a board-level MCU warning
 *      (no firmware, debugger halt, system-memory boot, no power) goes
 *      before the circuit's risks: without a program nothing else matters
 *      (pillProblem)
 *   3. a debugger halt the problems store has not reported yet (amber,
 *      「繼續執行」 → runOrResume)
 *   4. nothing has run yet on a non-empty board (neutral): 「電路已就緒（空白鍵）」
 *      + 「執行模擬」 (touch screens: 「電路已就緒」, no key — the button
 *      carries the verb once, release QA SH-F10); not while a lesson coach
 *      is guiding — the coach card owns "the next step", two voices would
 *      disagree
 *   5. otherwise hidden.
 * The fix is the problem's own action (「載入韌體…」, 「繼續執行」) or, for a
 * finding that points at parts / holes, 「在電路板上標示」. The body (and the
 * trailing ›) opens the full problems list: the workspace inspector's
 * problems panel (#ws-problems, scrolled to and focused), the More sheet
 * (problems first) on phones and in the classic chrome.
 *
 * Hidden in the classic chrome (isLegacyChrome), while the host says so
 * (onboarding, empty-state card), on a phone while the lesson coach card is
 * up or a sheet rests at a tall detent over the pill's spot (kit
 * sheetCoverHeight), and when a floating coach card would overlap it
 * (desktop: it moves to the free space right of the card when that fits,
 * else it steps aside). A pointer click on its buttons drops their focus,
 * so the next Space runs / pauses instead of re-pressing the pill.
 *
 * Material: Tier-S (the UndoPill recipe — near-opaque gradient + lg-rim +
 * inset shadows, NO backdrop-filter). Springs in/out on transform/opacity.
 * Data: useProblems (≤ 1 Hz, contract K3) + useSimPhase (on change) — no
 * per-frame work.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import {
  ChevronRightIcon,
  pressProps,
  sheetCoverHeight,
  subscribeSheetCover,
  tick,
  useIsDesktop,
  useMediaQuery,
} from '../kit'
import { t, useLang } from '../../i18n'
import { useLab } from '../embedded/lab'
import { PROBLEMS_ANCHOR_ID, locateProblem, useProblems, type Problem, type ProblemCounts } from '../embedded/problems'
import { useLessonUi } from '../lessons/state'
import { computeGeometry, useWorkspaceActive } from '../workspace/state'
import { isWorkspaceShowing, useLegacyChrome } from './legacy'
import { TONE_COLOR, runOrResume, stateColor, useMcuIdIn, useSimPhase, type SimPhase, type ToneState } from './run-control'
import './StatusPill.css'

/** Matches the exit transition (--lg-dur-control 200 ms) with a little slack. */
const UNMOUNT_DELAY_MS = 240
/** below this much free width beside a floating coach card the pill steps aside */
const MIN_BESIDE_W = 280
const PILL_MAX_W = 440
/** a phone sheet covering more than this fraction of the viewport reaches the pill's spot */
const TALL_SHEET_FRAC = 0.75

/** A pointer click leaves no focus behind (Space stays run / pause); keyboard activation keeps it. */
function releaseFocus(e: MouseEvent<HTMLElement>): void {
  if (e.detail > 0) e.currentTarget.blur()
}

export type PillTone = 'error' | 'warning' | 'neutral'

export interface PillAction {
  label: string
  run(): void
}

export interface PillModel {
  tone: PillTone
  /**
   * the dot's colour: the board state a problem is about, from the one
   * state table (H6 — 「未供電」 red here as on the MCU badge), else the
   * severity; the ready line is 'idle' (neutral)
   */
  dot: string
  text: string
  /** further errors + warnings behind the shown one */
  more: number
  action: PillAction | null
  /** the body opens the problems list (false for the neutral "ready" line) */
  opensProblems: boolean
}

export interface PillInput {
  /** the problems store's list (sorted error → warning → info) */
  problems: readonly Problem[]
  counts: ProblemCounts
  phase: SimPhase
  haltedId: string | null
  boardEmpty: boolean
  /** a lesson coach is guiding: it owns "the next step" (no "ready" line) */
  guided?: boolean
  /** the primary pointer is a touch screen: the "ready" line names no key */
  touch?: boolean
  /**
   * the problems were computed for THIS circuit and no board is still in
   * its firmware grace (SH-13 — COH-18): only then may the pill say
   * 「電路已就緒」; false = say nothing yet (default true: pure callers)
   */
  settled?: boolean
}

/** The board state an MCU state row is about (its H5 fact), else null. */
function factState(p: Problem): ToneState | null {
  const kind = (p.fact ?? '').split(':')[0]
  switch (kind) {
    case 'power':
      return 'unpowered'
    case 'fw-missing':
      return 'no-firmware'
    case 'halt':
      return 'halted'
    case 'lockup':
      return 'lockup'
    case 'boot0':
      return 'boot-sysmem'
    default:
      return null
  }
}

/** The pill dot of a problem: its board state's colour (H6), else red for an error, orange for a warning. */
export function problemDotColor(p: Problem): string {
  const state = factState(p)
  if (state) return stateColor(state)
  return TONE_COLOR[p.level === 'error' ? 'red' : 'orange']
}

/** A problem that names something to point at in 3D. */
function locatable(p: Problem): boolean {
  return p.componentIds.length > 0 || p.holes.length > 0 || (p.wireIds?.length ?? 0) > 0
}

/**
 * The one problem the pill shows: the first error; else the first MCU-level
 * warning (the board's own state — no firmware, a debugger halt, a
 * system-memory boot, no power — explains everything after it); else the
 * first warning. Info never shows.
 */
export function pillProblem(problems: readonly Problem[]): Problem | null {
  const error = problems.find((p) => p.level === 'error')
  if (error) return error
  return problems.find((p) => p.level === 'warning' && p.source === 'mcu') ?? problems.find((p) => p.level === 'warning') ?? null
}

/** What the pill says (pure — tests). */
export function statusPillModel({
  problems,
  counts,
  phase,
  haltedId,
  boardEmpty,
  guided = false,
  touch = false,
  settled = true,
}: PillInput): PillModel | null {
  const top = pillProblem(problems)
  if (top) {
    const action: PillAction | null = top.action
      ? { label: top.action.label, run: () => top.action!.run() }
      : locatable(top)
        ? { label: t('Show on the board'), run: () => void locateProblem(top) }
        : null
    return {
      tone: top.level === 'error' ? 'error' : 'warning',
      dot: problemDotColor(top),
      text: top.title,
      more: Math.max(0, counts.error + counts.warning - 1),
      action,
      opensProblems: true,
    }
  }
  if (phase === 'halted') {
    const id = haltedId ?? 'MCU'
    return {
      tone: 'warning',
      dot: stateColor('halted'),
      text: t('{id} core halted (debugger)', { id }),
      more: 0,
      action: { label: t('Resume running'), run: () => runOrResume() },
      opensProblems: true,
    }
  }
  // a lesson coach already says what to do next — one voice for "next step";
  // never before the list speaks for this very circuit (a board just placed
  // is not "ready" 600 ms before its own problems arrive — COH-18)
  if (phase === 'idle' && !boardEmpty && !guided && settled) {
    // findings only the run can confirm (H5 pendingRuntime, IN-16): say how
    // many — the panel's 「執行後確認」 group counts the same rows — and the
    // body opens the list (N7)
    const pending = problems.filter((p) => p.pendingRuntime).length
    const n = { n: pending }
    // the button names the verb (「執行模擬」, the capsule's word); the line
    // says the circuit is ready and which key does it — the verb is not
    // printed twice (release QA SH-F10)
    return {
      tone: 'neutral',
      dot: stateColor('idle'),
      text:
        pending > 0
          ? touch
            ? t('Circuit ready · {n} to confirm after the run', n)
            : t('Circuit ready (Space) · {n} to confirm after the run', n)
          : touch
            ? t('Circuit ready')
            : t('Circuit ready (Space)'),
      more: 0,
      action: { label: t('Run simulation'), run: () => useStore.getState().startSim() },
      opensProblems: pending > 0,
    }
  }
  return null
}

/**
 * Does the problems list speak for the circuit on the bench? (SH-13 / H5)
 * The list was computed for this layout identity, and no MCU board waits in
 * its firmware grace (a board without firmware shows 「U1 還沒有韌體」 once
 * the grace ends — until then the pill says nothing rather than 「就緒」).
 */
export function problemsSettled(
  problemsLayout: CircuitLayout | null,
  layout: CircuitLayout,
  firmware: Readonly<Record<string, unknown>>,
): boolean {
  if (problemsLayout !== layout) return false
  return layout.components.every((c) => !getEntry(c.type)?.mcu || firmware[c.id] != null)
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Workspace: bring the problems up in the inspector — open the right panel,
 * scroll to them and focus their heading. When the problem(s) the pill
 * speaks about involve the selected part (SH-13 (5) — COH-07), the
 * selection stays and its own
 * header block is the target (#insp-{id}, else the part's problem list):
 * the student was looking at LED1, the pill must not throw that away.
 * Otherwise the selection clears (the no-selection inspector leads with the
 * full list, #ws-problems). False when the workspace is not showing (the
 * caller opens the More sheet instead).
 */
export function openProblemsPanel(subject: Problem | readonly Problem[] | null = null): boolean {
  if (!isWorkspaceShowing()) return false
  const st = useStore.getState()
  const about = subject == null ? [] : Array.isArray(subject) ? subject : [subject as Problem]
  const keepId = st.selection.find((id) => about.some((p) => p.componentIds.includes(id))) ?? null
  if (!keepId) st.select(null)
  const lab = useLab.getState()
  if (!lab.workspace.right.open) lab.setWorkspace({ right: { ...lab.workspace.right, open: true } })
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = keepId
        ? document.getElementById(`insp-${keepId}`) ??
          document.querySelector<HTMLElement>('.ws-right .insp-part-problems') ??
          document.querySelector<HTMLElement>('.ws-right .ws-scroll')
        : document.getElementById(PROBLEMS_ANCHOR_ID)
      if (!el) return
      el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
      const heading =
        el.querySelector<HTMLElement>('[data-problems-heading], h1, h2, h3, [role="heading"], .lg-list-header') ?? el
      if (!heading.hasAttribute('tabindex') && heading.tabIndex < 0) heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    }),
  )
  return true
}

/** Where the pill sits: the default centred spot, beside a floating coach card, or nowhere. */
type Placement = { kind: 'center' } | { kind: 'beside'; cx: number; maxW: number } | { kind: 'hide' }

/**
 * Keep clear of a FLOATING lesson coach card (it shares the pill's top):
 * stay centred when that does not overlap the card, else move into the free
 * space right of it, else step aside. DOM reads only when the card, the
 * pill's content or the viewport change.
 */
function placeBesideCoach(pillW: number, workspaceOn: boolean, wsInsets: { left: number; right: number }): Placement {
  const vw = window.innerWidth
  const card = document.querySelector<HTMLElement>('.lsn-coach')
  const r = card?.getBoundingClientRect()
  // the card's horizontal extent (fallback: the classic desktop card spot)
  const cardLeft = r && r.width > 0 ? r.left : 96
  const cardRight = r && r.width > 0 ? r.right : 96 + 320
  const lo = workspaceOn ? wsInsets.left : 12
  const hi = vw - (workspaceOn ? wsInsets.right : 12)
  const center = workspaceOn ? (lo + hi) / 2 : vw / 2
  const w = Math.min(pillW, PILL_MAX_W)
  const left = center - w / 2
  const right = center + w / 2
  if (right <= cardLeft - 8 || left >= cardRight + 12) return { kind: 'center' }
  const a = cardRight + 12
  const b = hi - 8
  if (b - a >= Math.min(MIN_BESIDE_W, w)) {
    const maxW = Math.min(PILL_MAX_W, b - a)
    return { kind: 'beside', cx: a + Math.min(w, maxW) / 2, maxW }
  }
  return { kind: 'hide' }
}

export interface StatusPillProps {
  /** the host hides it (onboarding, the empty-state card) */
  hidden?: boolean
  /** phones / classic chrome: open the More sheet (problems first) */
  onOpenMore: () => void
}

export function StatusPill({ hidden = false, onOpenMore }: StatusPillProps) {
  const legacy = useLegacyChrome()
  const workspaceOn = useWorkspaceActive()
  const isDesktop = useIsDesktop()
  const problems = useProblems((s) => s.problems)
  const counts = useProblems((s) => s.counts)
  const phase = useSimPhase()
  const haltedId = useMcuIdIn('halted')
  const boardEmpty = useStore((s) => s.layout.components.length === 0)
  const coachId = useLessonUi((s) => s.coachId)
  const coachRect = useLessonUi((s) => s.coachRect)
  const workspacePrefs = useLab((s) => s.workspace)
  const touch = !useMediaQuery('(pointer: fine)')
  useLang()

  // phones: a sheet at a tall detent slides over the pill's spot (event-driven)
  const [sheetCover, setSheetCover] = useState(sheetCoverHeight)
  useEffect(() => subscribeSheetCover(setSheetCover), [])
  const underSheet =
    !isDesktop && typeof window !== 'undefined' && sheetCover > window.innerHeight * TALL_SHEET_FRAC

  // the list speaks for this circuit (not the one before an edit, not a
  // board still in its firmware grace) — event-driven, no polling
  const layout = useStore((s) => s.layout)
  const problemsLayout = useProblems((s) => s.layout)
  const firmware = useLab((s) => s.firmware)
  const settled = problemsSettled(problemsLayout, layout, firmware)
  const model = legacy
    ? null
    : statusPillModel({ problems, counts, phase, haltedId, boardEmpty, guided: coachId != null, touch, settled })
  const phoneCoach = !isDesktop && (coachId != null || coachRect != null)
  const wanted = !legacy && !hidden && model != null && !phoneCoach && !underSheet

  // floating coach card on desktop: measure once per change (never per frame)
  const pillRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<Placement>({ kind: 'center' })
  const [viewport, setViewport] = useState(0)
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const modelKey = model ? `${model.tone}|${model.text}|${model.more}|${model.action?.label ?? ''}` : ''
  useLayoutEffect(() => {
    if (!wanted || !isDesktop || coachRect == null) {
      setPlacement((p) => (p.kind === 'center' ? p : { kind: 'center' }))
      return
    }
    const pill = pillRef.current
    const g = computeGeometry(workspacePrefs, window.innerWidth, window.innerHeight)
    const next = placeBesideCoach(pill ? pill.scrollWidth + 2 : PILL_MAX_W, workspaceOn, {
      left: g.insetLeft,
      right: g.insetRight,
    })
    setPlacement((p) =>
      p.kind === next.kind && (p.kind !== 'beside' || (next.kind === 'beside' && p.cx === next.cx && p.maxW === next.maxW))
        ? p
        : next,
    )
  }, [wanted, isDesktop, coachRect, modelKey, workspaceOn, workspacePrefs, viewport])

  const visible = wanted && placement.kind !== 'hide'

  // keep the last model mounted through the exit spring
  const lastModel = useRef<PillModel | null>(null)
  if (model) lastModel.current = model
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), UNMOUNT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  const shown = model ?? lastModel.current
  if (typeof document === 'undefined' || legacy || !shown || (!mounted && !visible)) return null

  const openProblems = (e: MouseEvent<HTMLElement>) => {
    releaseFocus(e)
    tick()
    // what the pill speaks about: its problem, else (the ready line) the
    // findings the run will confirm — a selected part among them stays selected
    const all = useProblems.getState().problems
    const top = pillProblem(all)
    if (!openProblemsPanel(top ?? all.filter((p) => p.pendingRuntime))) onOpenMore()
  }
  const style = {
    '--app-pill-dot': shown.dot,
    ...(placement.kind === 'beside'
      ? { '--app-pill-cx': `${Math.round(placement.cx)}px`, '--app-pill-maxw': `${Math.round(placement.maxW)}px` }
      : {}),
  } as CSSProperties
  const more = shown.more > 0 ? t('· {n} more', { n: shown.more }) : null

  return createPortal(
    <div
      ref={pillRef}
      className={`app-status-pill lg-rim is-${shown.tone}${visible ? ' is-in' : ''}${placement.kind === 'beside' ? ' is-beside' : ''}`}
      style={style}
      // the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR) — while it shows
      data-scene-avoid={visible ? '' : undefined}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      {shown.opensProblems ? (
        <button
          type="button"
          className="app-pill-body lg-pressable"
          title={t('See all problems')}
          {...pressProps}
          onClick={openProblems}
        >
          <span className="app-pill-dot" aria-hidden="true" />
          <span className="app-pill-text">{shown.text}</span>
          {more && <span className="app-pill-more">{more}</span>}
        </button>
      ) : (
        <span className="app-pill-body is-static">
          <span className="app-pill-dot" aria-hidden="true" />
          <span className="app-pill-text">{shown.text}</span>
        </span>
      )}
      {shown.action && (
        <button
          type="button"
          className="app-pill-action lg-pressable"
          {...pressProps}
          onClick={(e) => {
            releaseFocus(e)
            tick()
            shown.action?.run()
          }}
        >
          {shown.action.label}
        </button>
      )}
      {shown.opensProblems && (
        <button
          type="button"
          className="app-pill-chevron lg-pressable"
          aria-label={t('See all problems')}
          title={t('See all problems')}
          {...pressProps}
          onClick={openProblems}
        >
          <ChevronRightIcon size={16} />
        </button>
      )}
    </div>,
    document.body,
  )
}
