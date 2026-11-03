/**
 * StatusBar — the top-center Dynamic-Island-style run control, built on the
 * kit StatusCapsule (DESIGN.md §2).
 *
 * Classic chrome (isLegacyChrome — English without the workspace; the legacy
 * visual-regression scenes) renders exactly as before the UX wave:
 * - Run-state dot: pulses green while the sim runs (transform/opacity only).
 * - Tabular-nums sim clock + 執行中 / 已暫停 word.
 * - Auto-expands for 3 s whenever a NEW sim issue arrives.
 *
 * Everywhere else the capsule is an explicit RUN CONTROL (UX wave SH-1):
 * a 22 px glyph disc + a verb, driven by the run phase (run-control.ts):
 *   idle    ▶ (green disc)  「執行模擬」
 *   paused  ▶ (green disc)  「已暫停 · 3.11 s」
 *   running ❚❚ in the green ring 「執行中 · 3.11 s」 — the normal state with
 *           auto-run (round 5), so the ring pulses only for ~3 s after a
 *           start, then rests (app.css; none with reduced motion) (+ 「· 0.3 倍速」
 *           when the simulation has run slower than asked for over 2 s — SH-8)
 *           — but when EVERY board in the circuit is blocked (H5
 *           boardBlocker: no power / no firmware / lockup), ❚❚ on the
 *           blocker's state-tone disc and the first board's reason:
 *           「執行中 · U1 沒有供電」 (red), 「執行中 · U1 還沒有韌體」 (orange) —
 *           the pill and the MCU badge say the same (release QA SH-F3)
 *   halted  ▶ (orange disc) 「核心已停住 · 繼續執行」
 *   fault   ⚠ (red disc)    「U1 故障 · 5.20 s」
 * with a tooltip naming the shortcut (「執行模擬（空白鍵）· 長按重置」). Tap =
 * toggleRun (a debugger halt resumes instead of staying dead); the issue
 * flash is gone — the status pill (StatusPill.tsx) shows problems
 * persistently.
 *
 * Both:
 * - Long-press = Reset, two-step: the first long-press shows a confirm toast,
 *   a second long-press within 3 s actually resets.
 * - Expands for 3 s on a new LLM status/error and pushCapsuleDetail lines.
 * - Studio render mode: stays expanded while the path tracer loads / builds /
 *   samples ("rendering… N/M samples"), flashes the converged line, then
 *   auto-collapses — fed by pushRenderProgress (scene → App → here).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../../state/store'
import type { RenderProgress } from '../../three/scene-api'
import { ChevronRightIcon, PauseIcon, PlayIcon, StatusCapsule, WarningIcon, showToast, tick } from '../kit'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { tc } from '../format'
import { aiErrorText, aiStatusText } from '../sheets/ai-text'
import { useLab } from '../embedded/lab'
import { useLegacyChrome } from './legacy'
import { fmtSimClock, fmtSpeedFactor } from '../../instruments/format'
import { boardBlocker, useProblems, type Problem } from '../embedded/problems'
import { stateColor, toggleRun, useMcuIdIn, useMcuIds, useSimPhase, type SimPhase, type ToneState } from './run-control'
import { toggleRunWithFeedback } from './run-feedback'

const EXPAND_MS = 3000
const RESET_CONFIRM_MS = 3000
/** sampling updates reach React at most this often (perf budget: ≤10Hz) */
const PROGRESS_THROTTLE_MS = 250
/** achieved / requested speed below this … */
export const SLOW_RATIO = 0.9
/** … for this long shows the speed hint (SH-8) */
export const SLOW_HOLD_MS = 2000
/** body class while the capsule shows its second line (the status pill steps down) */
export const CAPSULE_EXPANDED_CLASS = 'app-capsule-expanded'

// --- Studio render progress (module-level sink, like the kit's showToast) ---
// The scene's RenderModeManager emits progress from inside the rAF loop; the
// App glue routes it here and the mounted StatusBar renders it through the
// capsule's existing expansion mechanism. Throttled so per-sample events
// can't drive 60Hz React renders; phase changes always pass through.
let renderProgressSink: ((p: RenderProgress) => void) | null = null
let lastProgressPhase: RenderProgress['phase'] | null = null
let lastProgressPushMs = 0

/** Feed Studio convergence progress into the status capsule (safe pre-mount). */
export function pushRenderProgress(p: RenderProgress): void {
  if (p.phase === lastProgressPhase && p.phase === 'sampling') {
    const now = performance.now()
    if (now - lastProgressPushMs < PROGRESS_THROTTLE_MS) return
    lastProgressPushMs = now
  }
  lastProgressPhase = p.phase
  renderProgressSink?.(p)
}

// --- arbitrary detail lines (module-level sink, like pushRenderProgress) ---
// Feature code outside the shell (firmware loads, MCU faults, project
// import) flashes a second capsule line through the same 3 s expansion the
// issue/AI lines use. Calls before the StatusBar mounts are dropped — the
// capsule is a live status surface, not a queue.
let capsuleDetailSink: ((text: string, opts: CapsuleDetailOptions) => void) | null = null

/** How long a detail line with an action stays up (ms) — long enough to read it and reach for it. */
export const ACTION_EXPAND_MS = 6000

/** What a capsule detail line is about (SH-13 (6)). */
export interface CapsuleDetailOptions {
  /**
   * the caller already said it in a kit toast (a firmware load, a debugger
   * halt): the new chrome does not say it a second time in the capsule —
   * one event, one voice (the classic chrome flashes it as before)
   */
  toasted?: boolean
  /**
   * what tapping the capsule does while this line shows (new chrome; release
   * close-out LOCKUP-CAUSE): 「U1 故障（鎖死）——查看原因」 opens the board's
   * 執行狀態 card — the line names its target, so the tap goes there instead
   * of pausing or resuming. The line then stays up ACTION_EXPAND_MS. The
   * classic chrome ignores it (its tap still runs / pauses, as before).
   */
  action?: () => void
}

/** The action a detail line brings to the capsule: the new chrome's (null in the classic chrome, or without one). Pure. */
export function detailActionOf(opts: CapsuleDetailOptions, legacy: boolean): (() => void) | null {
  return !legacy && opts.action ? opts.action : null
}

/**
 * One tap on the capsule: while a detail line with an action shows, that
 * action (the line collapses first — it has done its job); otherwise the
 * run control. Pure (tests).
 */
export function capsuleTap(action: (() => void) | null, collapse: () => void, runControl: () => void): void {
  if (action) {
    collapse()
    action()
    return
  }
  runControl()
}

/** Flash `text` as the status capsule's expanded second line (3 s). English
 *  runtime messages are localised here (tMessage) as a safety net; callers
 *  should pass display text already. */
export function pushCapsuleDetail(text: string, opts: CapsuleDetailOptions = {}): void {
  capsuleDetailSink?.(text, opts)
}

/** Capsule line for a Studio progress payload. */
export function renderProgressText(p: RenderProgress): string {
  switch (p.phase) {
    case 'loading':
      return t('Studio: loading ray tracer…')
    case 'building':
      return t('Studio: preparing scene…')
    case 'sampling':
      return t('Studio: rendering… {n}/{total} samples', { n: p.samples, total: p.targetSamples })
    case 'converged':
      return t('Studio render complete · {n} samples', { n: p.samples })
  }
}

/**
 * The capsule's clock and speed are THE unit formatter's (UX helper H3 —
 * SH-14): 「3.11 s」, 「187.8 s」, 「612 s（10:12）」 (never 「3:07.8」) and
 * 「0.2 倍速」, 「0.07 倍速」, 「< 0.01 倍速」 (never 「0 倍速」) — the same
 * strings the MCU panel prints for the same moment.
 */
export { fmtSimClock as formatSimTime, fmtSpeedFactor as formatSpeedFactor } from '../../instruments/format'

/** The classic chrome's clock, exactly as before the UX wave: m:ss.s past a minute. */
function legacySimTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0.00 s'
  if (t < 60) return `${t.toFixed(2)} s`
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

/** What stops every board while the simulation runs (release QA SH-F3 — H5 boardBlocker kinds). */
export interface RunningBlocker {
  kind: 'power' | 'fw-missing' | 'lockup'
  /** the first blocked board (layout order) */
  id: string
}

/** The state each blocker kind is shown in (H6 STATE_TONE). */
const BLOCKER_STATE: Readonly<Record<RunningBlocker['kind'], ToneState>> = {
  power: 'unpowered',
  'fw-missing': 'no-firmware',
  lockup: 'lockup',
}

/**
 * The blocker the capsule names while running: only when EVERY board in
 * `ids` has one of the kinds that leave it doing nothing (no power, no
 * firmware, a lockup — H5 boardBlocker); then the first board's. Null with
 * no boards, or when any board runs. Pure (tests).
 */
export function runningBlockerOf(ids: readonly string[], problems: readonly Problem[]): RunningBlocker | null {
  let first: RunningBlocker | null = null
  for (const id of ids) {
    const b = boardBlocker(id, problems)
    if (!b || (b.kind !== 'power' && b.kind !== 'fw-missing' && b.kind !== 'lockup')) return null
    first ??= { kind: b.kind, id }
  }
  return first
}

/** runningBlockerOf for the live circuit (re-renders only when the answer changes; ≤ 1 Hz problems). */
function useRunningBlocker(active: boolean): RunningBlocker | null {
  const ids = useMcuIds()
  const layout = useStore((s) => s.layout)
  const key = useProblems((s) => {
    // only a list computed for THIS circuit speaks (H5 — never a stale reason after an edit)
    if (!active || ids.length === 0 || s.layout !== layout) return ''
    const b = runningBlockerOf(ids, s.problems)
    return b ? `${b.kind}\u0000${b.id}` : ''
  })
  if (key === '') return null
  const [kind, id] = key.split('\u0000')
  return { kind: kind as RunningBlocker['kind'], id }
}

/** 「U1 沒有供電」 / 「U1 還沒有韌體」 / 「U1 故障」: the capsule's blocker suffix (the problem rows' words). */
function blockerText(b: RunningBlocker): string {
  switch (b.kind) {
    case 'power':
      return t('{id} has no power', { id: b.id })
    case 'fw-missing':
      return t('{id} has no firmware yet', { id: b.id })
    case 'lockup':
      return t('{id} fault', { id: b.id })
  }
}

/**
 * The capsule's run-control texts for a phase (UX wave SH-1): the visible
 * label, the accessible name and the tooltip. `aria` keeps the exact
 * pre-wave names (「執行模擬」 / 「暫停模擬」) for idle / paused / running —
 * the acceptance walkthrough and assistive tech address the capsule by them;
 * the shortcut and the long-press live in `title` + aria-keyshortcuts.
 * `state` is the state the disc and its colour show (H6): the phase, or
 * while running with every board blocked (`blocker`) the blocker's state.
 */
export function runCapsuleText(
  phase: SimPhase,
  opts: { time: number; mcuId?: string | null; slow?: number | string | null; speed?: number; blocker?: RunningBlocker | null },
): { word: string; time: string | null; extra: string | null; aria: string; title: string; state: ToneState } {
  const time = fmtSimClock(opts.time)
  const id = opts.mcuId ?? 'MCU'
  switch (phase) {
    case 'idle':
      return { word: t('Run simulation'), time: null, extra: null, aria: t('Run simulation'), title: t('Run simulation (Space) · long-press to reset'), state: phase }
    case 'paused':
      return { word: t('Paused'), time, extra: null, aria: t('Run simulation'), title: t('Run simulation (Space) · long-press to reset'), state: phase }
    case 'running': {
      if (opts.blocker) {
        // every board is stopped by its blocker: say the first one's, in its state colour
        return {
          word: t('Running'),
          time: null,
          extra: blockerText(opts.blocker),
          aria: t('Pause simulation'),
          title: t('Pause simulation (Space) · long-press to reset'),
          state: BLOCKER_STATE[opts.blocker.kind],
        }
      }
      // the achieved factor as H3 prints it (a number, or the already formatted text)
      const slow = opts.slow == null ? null : typeof opts.slow === 'string' ? opts.slow : fmtSpeedFactor(opts.slow)
      const why =
        opts.slow == null
          ? ''
          : (opts.speed ?? 1) > 1
            ? ` · ${t('The simulation cannot keep up with the {n}× speed setting', { n: opts.speed ?? 1 })}`
            : ` · ${t('The simulation runs slower than real time')}`
      return {
        word: t('Running'),
        time,
        extra: slow,
        aria: t('Pause simulation'),
        title: t('Pause simulation (Space) · long-press to reset') + why,
        state: phase,
      }
    }
    case 'halted':
      return {
        word: t('Core halted'),
        time: null,
        extra: tc('Resume', 'capsule'),
        aria: t('Resume the {id} core', { id }),
        title: t('Resume the {id} core (Space / F5)', { id }),
        state: phase,
      }
    case 'fault':
      return {
        word: t('{id} fault', { id }),
        time,
        extra: null,
        aria: t('{id} locked up — see the status bar below for why', { id }),
        title: t('{id} locked up — see the status bar below for why', { id }),
        state: phase,
      }
  }
}

/** The capsule's tooltip while a detail line with an action shows: 「點一下：U1 故障（鎖死）——查看原因 · 長按重置」. */
export function capsuleActionTitle(detail: string): string {
  return t('Tap: {action} · long-press to reset', { action: detail })
}

/**
 * The 22 px glyph disc of the run control. Its state colours come from the
 * one state table (H6 STATE_TONE via --app-state on the capsule): the
 * running ring, the halted disc, the fault disc, the blocked disc (every
 * board stopped while running — SH-F3, no pulse: nothing runs); the green ▶
 * of idle / paused is the ACTION (「按這裡執行」), not a state, and stays
 * green.
 */
function RunDisc({ phase, blocked = false }: { phase: SimPhase; blocked?: boolean }) {
  if (phase === 'running' && blocked) {
    return (
      <span className="app-run-disc is-blocked" aria-hidden="true">
        <PauseIcon size={12} />
      </span>
    )
  }
  if (phase === 'running') {
    return (
      <span className="app-run-disc is-running" aria-hidden="true">
        <PauseIcon size={12} />
      </span>
    )
  }
  if (phase === 'fault') {
    return (
      <span className="app-run-disc is-fault" aria-hidden="true">
        <WarningIcon size={13} />
      </span>
    )
  }
  return (
    <span className={`app-run-disc is-play${phase === 'halted' ? ' is-halted' : ''}`} aria-hidden="true">
      <PlayIcon size={12} />
    </span>
  )
}

/**
 * Achieved speed factor while the simulation has been slower than asked for
 * (achieved / requested < SLOW_RATIO) for SLOW_HOLD_MS; null otherwise. Reads
 * the lab's ≤ 10 Hz perf snapshot (the coordinator's factor itself changes
 * once per second) — never per frame.
 */
function useSlowFactor(active: boolean): string | null {
  const speed = useStore((s) => s.simSpeed)
  // the formatted text (H3 fmtSpeedFactor) is the selector value: a re-render
  // only when the printed factor changes, and never a rounding to 「0 倍速」
  const slow = useLab((s) => {
    const rf = s.perf?.realtimeFactor
    if (!active || rf == null || !Number.isFinite(rf) || rf < 0) return null
    if (rf >= SLOW_RATIO * (speed > 0 ? speed : 1)) return null
    return fmtSpeedFactor(rf)
  })
  const [shown, setShown] = useState<string | null>(null)
  const since = useRef<number | null>(null)
  useEffect(() => {
    if (slow == null) {
      since.current = null
      setShown(null)
      return
    }
    const now = performance.now()
    if (since.current == null) since.current = now
    const wait = SLOW_HOLD_MS - (now - since.current)
    if (wait <= 0) {
      setShown(slow)
      return
    }
    const timer = window.setTimeout(() => setShown(slow), wait)
    return () => window.clearTimeout(timer)
  }, [slow])
  return slow == null ? null : shown
}

export function StatusBar() {
  const running = useStore((s) => s.running)
  const simTime = useStore((s) => s.simTime)
  const issues = useStore((s) => s.issues)
  const llm = useStore((s) => s.llm)
  const speed = useStore((s) => s.simSpeed)
  const legacy = useLegacyChrome()
  const phase = useSimPhase()
  const faultId = useMcuIdIn('lockup')
  const haltedId = useMcuIdIn('halted')
  const slow = useSlowFactor(!legacy && phase === 'running')
  const blocker = useRunningBlocker(!legacy && phase === 'running')
  useLang()

  const [detail, setDetail] = useState<string | null>(null)
  // the showing line's action (new chrome): a tap on the capsule runs it instead of the run control
  const [detailAction, setDetailAction] = useState<(() => void) | null>(null)
  const expandTimer = useRef<number | null>(null)
  const collapse = () => {
    if (expandTimer.current != null) window.clearTimeout(expandTimer.current)
    expandTimer.current = null
    setDetail(null)
    setDetailAction(null)
  }
  const flash = (text: string, action: (() => void) | null = null) => {
    setDetail(text)
    // (a function state value is set through an updater)
    setDetailAction(() => action)
    if (expandTimer.current != null) window.clearTimeout(expandTimer.current)
    expandTimer.current = window.setTimeout(collapse, action ? ACTION_EXPAND_MS : EXPAND_MS)
  }
  useEffect(
    () => () => {
      if (expandTimer.current != null) window.clearTimeout(expandTimer.current)
    },
    [],
  )

  // classic chrome: expand when a message we haven't shown yet appears in the
  // issue list (the new chrome's status pill shows problems persistently)
  const prevIssuesRef = useRef<string[]>([])
  const legacyRef = useRef(legacy)
  legacyRef.current = legacy
  useEffect(() => {
    const msgs = issues.map((i) => i.message)
    const fresh = msgs.find((m) => !prevIssuesRef.current.includes(m))
    prevIssuesRef.current = msgs
    if (fresh && legacyRef.current) flash(tMessage(fresh))
  }, [issues])

  // Studio render-mode progress: every update re-arms the 3s collapse timer,
  // so the capsule stays open while sampling and collapses after convergence
  useEffect(() => {
    renderProgressSink = (p) => flash(renderProgressText(p))
    capsuleDetailSink = (text, opts) => {
      // the new chrome: a line a toast already said is not repeated up here
      if (opts.toasted && !legacyRef.current) return
      flash(tMessage(text), detailActionOf(opts, legacyRef.current))
    }
    return () => {
      renderProgressSink = null
      capsuleDetailSink = null
    }
  }, [])

  // expand on LLM progress / errors / a finished generation
  const prevLlmRef = useRef<{ status: string; error: string | null; pending: boolean }>({
    status: '',
    error: null,
    pending: false,
  })
  useEffect(() => {
    const prev = prevLlmRef.current
    prevLlmRef.current = { status: llm.status, error: llm.error, pending: llm.pending != null }
    if (llm.status && llm.status !== prev.status) flash(t('AI: {text}', { text: aiStatusText(llm.status) }))
    else if (llm.error && llm.error !== prev.error) flash(t('AI: {text}', { text: aiErrorText(llm.error) }))
    else if (llm.pending != null && !prev.pending) flash(t('AI circuit ready — open AI to apply'))
  }, [llm])

  // the status pill below the capsule steps down while the second line shows
  const expanded = detail != null
  useEffect(() => {
    if (legacy || typeof document === 'undefined') return
    document.body.classList.toggle(CAPSULE_EXPANDED_CLASS, expanded)
    return () => document.body.classList.remove(CAPSULE_EXPANDED_CLASS)
  }, [legacy, expanded])

  // two-step destructive reset on long-press
  const resetArmRef = useRef(0)
  const onLongPress = () => {
    const now = Date.now()
    if (now - resetArmRef.current < RESET_CONFIRM_MS) {
      resetArmRef.current = 0
      useStore.getState().resetSim()
      tick(16)
      showToast(t('Simulation reset'))
    } else {
      resetArmRef.current = now
      showToast(t('Long-press again to reset the simulation'))
    }
  }

  if (legacy) {
    // same rendering as before the wave; the tap still resumes a debugger
    // halt (toggleRun) instead of silently doing nothing
    return (
      <StatusCapsule
        aria-label={running ? t('Pause simulation') : t('Run simulation')}
        dot={<span className={`app-run-dot ${running ? 'is-running' : ''}`} />}
        expanded={expanded}
        expandedContent={detail}
        onTap={toggleRun}
        onLongPress={onLongPress}
      >
        <span className="lg-tabular">{legacySimTime(simTime)}</span>
        <span className="app-run-word">{running ? t('Running') : t('Paused')}</span>
      </StatusCapsule>
    )
  }

  const text = runCapsuleText(phase, {
    time: simTime,
    mcuId: phase === 'fault' ? faultId : phase === 'halted' ? haltedId : null,
    slow,
    speed,
    blocker,
  })
  const blocked = phase === 'running' && blocker != null
  // a detail line with an action: the capsule IS that action while the line shows (its name, its tap)
  const action = expanded ? detailAction : null
  return (
    <StatusCapsule
      className={`app-run-capsule is-${phase}${blocked ? ' is-blocked' : ''}${action ? ' has-detail-action' : ''}`}
      style={{ '--app-state': stateColor(text.state) } as CSSProperties}
      data-scene-avoid=""
      aria-label={action && detail ? detail : text.aria}
      aria-keyshortcuts={action ? undefined : phase === 'halted' ? 'Space F5' : 'Space'}
      title={action && detail ? capsuleActionTitle(detail) : text.title}
      dot={<RunDisc phase={phase} blocked={blocked} />}
      expanded={expanded}
      expandedContent={
        action ? (
          // the pill's disclosure chevron: this line opens something (one look for 「去那裡」)
          <span className="app-capsule-detail-action" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
            <ChevronRightIcon size={14} />
          </span>
        ) : (
          detail
        )
      }
      onTap={() => capsuleTap(action, collapse, () => void toggleRunWithFeedback())}
      onLongPress={onLongPress}
    >
      {phase === 'paused' && <span className="app-run-state" aria-hidden="true" />}
      <span className="app-run-word app-run-label">{text.word}</span>
      {text.time != null && (
        <>
          <span className="app-run-sep" aria-hidden="true">
            ·
          </span>
          <span className="lg-tabular app-run-time">{text.time}</span>
        </>
      )}
      {text.extra != null && (
        <>
          <span className="app-run-sep" aria-hidden="true">
            ·
          </span>
          <span className={`app-run-extra${phase === 'halted' ? ' is-action' : blocked ? ' is-blocked' : ' is-slow'}`}>{text.extra}</span>
        </>
      )}
    </StatusCapsule>
  )
}
