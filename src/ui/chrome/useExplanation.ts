/**
 * The 「電路說明」 data (explain stream): one ref-counted watcher turns the
 * stores into an Explanation (explain.ts) that the desktop card
 * (ExplainCard.tsx) and the phone status pill's lowest tier read.
 *
 *   useExplanation(enabled)  → { explanation, stale, announce } | null
 *   startExplainWatcher()    the same watcher without React (tests); returns stop
 *
 * Rates — never per frame:
 *  - every telemetry push (the store's ≤ 10 Hz) is OBSERVED into the history
 *    (lit / dark hysteresis, blink flips, MCU pins toggling: a few map
 *    writes); the lines are recomputed at most every EXPLAIN_REFRESH_MS
 *    (2 Hz) from it;
 *  - a structural edit, the problems / phase / firmware / selection /
 *    language changing recompute at once;
 *  - a knob, a button, a switch (a runtime param: a new layout of the SAME
 *    circuit) never recomputes on the event itself — the store's readings
 *    still predate it (a pressed button with the old, dark readings would
 *    read 「沒有電流」). The shown lines are HELD (not dimmed) until two
 *    telemetry pushes have arrived since the last such change, or at most
 *    EXPLAIN_HOLD_MS while running (a knob drag updates ~2–3 times a
 *    second); paused, until a new snapshot arrives. A drag never rebuilds
 *    the drive-path graph per event.
 * Responsiveness: what the learner just did is answered at once — for
 * EXPLAIN_RESPOND_MS after a held change is released (and after an edit's
 * own lines arrive) a new subject up to P5b shows without the dwell and new
 * numbers without the damping; 「找不到原因」 (P6) still waits (the circuit
 * may be settling). A placeholder (「電路模擬中」, 「模擬還沒開始」) and a
 * repaired part (P1 → anything else) are replaced at once too.
 * Steadiness otherwise (skipped under ?shotrig, so a screenshot depends on
 * no timing):
 *  - dwell: a new line-1 subject must hold EXPLAIN_DWELL_MS before it
 *    replaces the shown one, except P0–P2 (a halt, damage, no power: at once);
 *  - damping: with the same subject, changed text (its numbers) is shown
 *    only when two refreshes in a row differ from the shown text (a one-tick
 *    blip at a rounding edge never shows; a ramp updates once a second).
 * Staleness: after a STRUCTURAL edit (circuitRevision — a knob or a button is
 * not one) or a firmware change, the store still holds the previous
 * revision's telemetry until the first frame of the new one, and the
 * problems list speaks for the old layout until it recomputes (250 ms). Until
 * both are new the previous lines stay, flagged `stale` (the card dims them),
 * for at most EXPLAIN_STALE_MS; then the static rule-check text of the new
 * circuit replaces them. The host's first snapshot after a start, an edit or
 * a reset is the circuit before its first solve (all zeros): it is never
 * read as 「沒有電流」 or 「輸出 0 V」 — the lines wait for a snapshot whose
 * clock moved past it (settle; persona fix). Undo / redo are just layout changes. Every user
 * action is noted in the history (noteUserAction): the flips it causes are
 * never 「在閃」.
 * Lessons: while the coach guides a lesson, its active step's check is read
 * (the guided lesson, its current step — the coach card's own) and what that
 * step asks the learner to measure is never printed (explain.ts
 * lessonSecrets); a new step or another lesson recomputes at once.
 * a11y: `announce` is line 1 when the subject or its state changes, at most
 * once per EXPLAIN_ANNOUNCE_MS (the card's and the phone pill's visually
 * hidden live regions); number changes are never announced.
 */
import { useEffect, useLayoutEffect } from 'react'
import { create } from 'zustand'
import type { CircuitLayout, SimTelemetry } from '../../model/types'
import { onSimHostEvent, simStopReason, useStore } from '../../state/store'
import { onLangChange } from '../../i18n'
import { useLab } from '../embedded/lab'
import { useProblems } from '../embedded/problems'
import { circuitRevision } from '../fx/success-watch'
import { lessonById } from '../../lessons'
import { useLessonProgress } from '../../lessons/progress'
import type { LessonCheck } from '../../lessons/types'
import { useLessonUi } from '../lessons/state'
import { getSimPhase } from './run-control'
import { autoRunEnabled } from './auto-run'
import { TIER, explainCircuit, lessonSecrets, newExplainHistory, noteUart, noteUserAction, observeTelemetry, type Explanation } from './explain'

/** the lines' refresh while numbers change (2 Hz) */
export const EXPLAIN_REFRESH_MS = 500
/** a new subject must hold this long before it replaces the shown one (P3 and lower) */
export const EXPLAIN_DWELL_MS = 1000
/** the previous circuit's lines stay (dimmed) at most this long after an edit */
export const EXPLAIN_STALE_MS = 1500
/** at most one announcement per this long */
export const EXPLAIN_ANNOUNCE_MS = 2000
/** after a knob / button / switch, the shown lines wait at most this long (running) for readings taken after it */
export const EXPLAIN_HOLD_MS = 400
/** after the learner's change shows, new subjects / numbers show at once for this long */
export const EXPLAIN_RESPOND_MS = 1500

export interface ExplainView {
  explanation: Explanation | null
  /** the lines still describe the circuit before the last edit (the card dims them) */
  stale: boolean
  /** line 1 of the last subject / state change, for a polite live region ('' = nothing yet) */
  announce: string
}

const EMPTY_VIEW: ExplainView = { explanation: null, stale: false, announce: '' }

/** The published view (one per page). */
export const useExplainView = create<ExplainView>(() => EMPTY_VIEW)

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Under the visual-regression harness (?shotrig) the lines settle at once. */
function shotRig(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).has('shotrig')
  } catch {
    return false
  }
}

type Firmware = Record<string, { sha256?: string }>

/** circuitRevision per layout identity AND firmware table (a structural change or a load is a different string). */
const revisions = new WeakMap<CircuitLayout, { firmware: Firmware; rev: string }>()
function revisionOf(layout: CircuitLayout, firmware: Firmware): string {
  const hit = revisions.get(layout)
  if (hit && hit.firmware === firmware) return hit.rev
  const rev = circuitRevision(layout, firmware)
  revisions.set(layout, { firmware, rev })
  return rev
}

const textOf = (e: Explanation): string => e.lines.join('\n')

/**
 * The check of the step the lesson coach is on (the guided lesson and its
 * current step, clamped like the coach card's), else null: no lesson guided,
 * or a step without a check.
 */
export function guidedStepCheck(): LessonCheck | null {
  const id = useLessonUi.getState().coachId
  const lesson = id ? lessonById(id) : undefined
  if (!lesson || lesson.steps.length === 0) return null
  const raw = useLessonProgress.getState().lessons[lesson.id]?.step ?? 0
  const i = Math.min(Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0), lesson.steps.length - 1)
  return lesson.steps[i]?.check ?? null
}

/** The guided step the coach is on, as a comparable key (a new step or lesson recomputes the lines). */
function guidedStepKey(): string {
  const id = useLessonUi.getState().coachId
  return id ? `${id}#${useLessonProgress.getState().lessons[id]?.step ?? 0}` : ''
}

/** Will auto-run start a session by itself (enabled here, and no explicit pause / failed start / halt holds it)? */
function autoStartComing(): boolean {
  try {
    const why = simStopReason()
    return (why === null || why === 'reset') && autoRunEnabled()
  } catch {
    return false
  }
}

let watcher: { refs: number; stop: () => void } | null = null

/** Start (or join) the watcher; returns its stop function (ref-counted, idempotent). */
export function startExplainWatcher(): () => void {
  if (watcher) watcher.refs++
  else watcher = { refs: 1, stop: runWatcher() }
  let done = false
  return () => {
    if (done || !watcher) return
    done = true
    watcher.refs--
    if (watcher.refs > 0) return
    watcher.stop()
    watcher = null
  }
}

function runWatcher(): () => void {
  const history = newExplainHistory()
  const rig = shotRig()
  let shown: Explanation | null = null
  let shownStale = false
  let pendingKey: string | null = null
  let pendingSince = 0
  /** refreshes in a row whose text (numbers) differed from the shown one */
  let differing = 0
  /** the last structural edit / firmware change (wall ms) and the telemetry the store held then */
  let changeAt: number | null = null
  let teleAtChange: SimTelemetry | null = null
  let rev = revisionOf(useStore.getState().layout, useLab.getState().firmware)
  /** a runtime change (knob, button, switch) waits for readings taken after it: since (wall ms) and pushes seen */
  let holdSince: number | null = null
  let holdPushes = 0
  /** until then (wall ms) what the learner just did shows at once */
  let respondUntil = Number.NEGATIVE_INFINITY
  /**
   * Settling (persona fix): the first snapshot a session publishes after it
   * starts, after a structural edit / firmware change or after a reset is
   * the host's load frame — the new circuit before its first solve (every
   * voltage and current 0: 「LED1 沒亮：沒有電流流過」 next to a lit LED,
   * 「PS1 輸出 0 V」 while the inspector reads 5.00 V). Its readings are no
   * evidence: they are neither observed nor explained until the clock moves
   * past that snapshot (`time`: its sim time, null = not seen yet). Running,
   * the wait lasts until it does; otherwise at most EXPLAIN_STALE_MS (a reset
   * while paused stays at t = 0).
   */
  let settle: { since: number; time: number | null } | null = null
  const beginSettle = (): void => {
    // ?shotrig: the lines settle at once (a screenshot depends on no timing)
    settle = rig ? null : { since: nowMs(), time: null }
  }
  /** a new store snapshot: may its readings be used? (false = still the unsolved load frame) */
  const noteSnapshot = (prevTele: SimTelemetry | null, tele: SimTelemetry): boolean => {
    if (prevTele === null || tele.time < prevTele.time) beginSettle()
    if (settle === null) return true
    if (settle.time === null) {
      settle.time = tele.time
      return false
    }
    if (tele.time > settle.time) {
      settle = null
      return true
    }
    return false
  }
  let lastCompute = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  let timerAt = Number.POSITIVE_INFINITY
  let force = true
  let lastAnnounceAt = Number.NEGATIVE_INFINITY
  let announceTimer: ReturnType<typeof setTimeout> | null = null

  const publish = (next: Partial<ExplainView>): void => {
    const cur = useExplainView.getState()
    if (Object.entries(next).every(([k, v]) => cur[k as keyof ExplainView] === v)) return
    useExplainView.setState(next)
  }

  const announce = (text: string): void => {
    const wait = lastAnnounceAt + EXPLAIN_ANNOUNCE_MS - nowMs()
    if (announceTimer !== null) clearTimeout(announceTimer)
    announceTimer = null
    if (wait <= 0) {
      lastAnnounceAt = nowMs()
      publish({ announce: text })
      return
    }
    // the newest change wins once the gap has passed
    announceTimer = setTimeout(() => {
      announceTimer = null
      lastAnnounceAt = nowMs()
      publish({ announce: text })
    }, wait)
  }

  const schedule = (delay: number): void => {
    const at = nowMs() + Math.max(0, delay)
    if (timer !== null && timerAt <= at) return
    if (timer !== null) clearTimeout(timer)
    timerAt = at
    timer = setTimeout(() => {
      timer = null
      timerAt = Number.POSITIVE_INFINITY
      compute()
    }, Math.max(0, delay))
  }

  const render = (next: Explanation, stale: boolean): void => {
    const keyChanged = next.key !== shown?.key
    shown = next
    shownStale = stale
    pendingKey = null
    differing = 0
    publish({ explanation: next, stale })
    if (keyChanged && !stale) announce(next.lines[0])
  }

  /**
   * The watcher runs inside other stores' setState (the simulation's frame
   * feed among them): a fault here keeps the last lines and is reported once,
   * never thrown into the caller.
   */
  let reported = false
  const guarded = (run: () => void): void => {
    try {
      run()
    } catch (err) {
      if (reported) return
      reported = true
      console.error('circuit explanation failed', err)
    }
  }
  const observe = (layout: CircuitLayout, tele: SimTelemetry): void => guarded(() => observeTelemetry(history, layout, tele))
  const compute = (): void => guarded(computeLines)

  /** A held runtime change is answered: the next lines show at once, and so does what follows for a moment. */
  const release = (): void => {
    holdSince = null
    holdPushes = 0
    respondUntil = nowMs() + EXPLAIN_RESPOND_MS
  }

  function computeLines(): void {
    const t0 = nowMs()
    const s = useStore.getState()
    const pr = useProblems.getState()
    const lab = useLab.getState()
    const phase = getSimPhase()
    // a knob / button / switch: the readings in the store may predate it — keep the shown lines (not dimmed)
    // until readings taken after it arrive (running: at most EXPLAIN_HOLD_MS; paused: the next snapshot)
    if (holdSince !== null) {
      if (shown && s.telemetry && !rig && (phase === 'paused' || phase === 'halted' || phase === 'fault')) return
      if (shown && s.telemetry && !rig && phase === 'running' && t0 < holdSince + EXPLAIN_HOLD_MS) {
        schedule(holdSince + EXPLAIN_HOLD_MS - t0)
        return
      }
      release()
    }
    lastCompute = t0
    let immediate = force || rig
    force = false
    // the store's snapshot is the new circuit before its first solve (settle): no readings yet
    // (no snapshot at all: nothing to distrust — the static words follow at once; idle at t = 0 — a reset
    // left paused — is what the learner sees: shown as it is)
    let unsure = false
    if (settle !== null && s.telemetry !== null) {
      if (phase === 'idle' || (phase !== 'running' && t0 - settle.since >= EXPLAIN_STALE_MS)) settle = null
      else {
        unsure = true
        if (phase !== 'running') schedule(settle.since + EXPLAIN_STALE_MS - t0)
      }
    }
    // the problems list speaks for this circuit: computed for it, or for a layout of the same structure
    const settled = pr.layout === s.layout || (pr.layout !== null && revisionOf(pr.layout, lab.firmware) === revisionOf(s.layout, lab.firmware))
    if (changeAt !== null && settled && !unsure && (s.telemetry === null || s.telemetry !== teleAtChange)) {
      // the edited circuit's own words: shown at once (the learner is waiting for them)
      changeAt = null
      immediate = true
      respondUntil = t0 + EXPLAIN_RESPOND_MS
    }
    if (changeAt !== null) {
      const waited = t0 - changeAt
      if (shown && waited < EXPLAIN_STALE_MS) {
        // the previous circuit's words, dimmed, until the new circuit's arrive
        shownStale = true
        publish({ stale: true })
        schedule(EXPLAIN_STALE_MS - waited)
        return
      }
    }
    const stale = changeAt !== null
    const next = explainCircuit({
      layout: s.layout,
      // stale too long: the new circuit's static rule-check text, never the old readings (nor the unsolved new ones)
      telemetry: stale || unsure ? null : s.telemetry,
      phase,
      problems: settled ? pr.problems : [],
      findings: settled ? pr.findings : [],
      mcus: lab.mcus,
      firmware: lab.firmware,
      selection: s.selection,
      history: stale || unsure ? null : history,
      // the value the guided lesson's step asks the learner to measure is never printed
      secrets: lessonSecrets(guidedStepCheck(), s.layout),
      // no session yet: auto-run starts one by itself unless the learner paused it / a start failed
      autoStart: autoStartComing(),
    })
    const respond = t0 < respondUntil
    if (shown && !shownStale && !immediate && next.key === shown.key) {
      // the same subject: a pending one starts over
      pendingKey = null
      if (textOf(next) === textOf(shown)) {
        differing = 0
        if (next.dot !== shown.dot || next.tone !== shown.tone) render(next, false)
        return
      }
      // damping: changed numbers show once two refreshes in a row differ from the shown ones (at once right
      // after the learner's own change)
      differing++
      if (!respond && differing < 2) {
        schedule(EXPLAIN_REFRESH_MS)
        return
      }
      render(next, false)
      return
    }
    const atOnce =
      !shown ||
      shownStale ||
      immediate ||
      next.tier <= TIER.power ||
      // a stand-in (「電路模擬中」) is no subject to hold on to
      shown.placeholder === true ||
      // damage is latched: it only ends when the part is replaced (換新, a fix) — say so at once
      (shown.tier === TIER.damage && next.tier > TIER.damage) ||
      // the learner's own change is answered at once; 「找不到原因」 still waits (the circuit may be settling)
      (respond && next.tier <= TIER.benign)
    if (atOnce) {
      render(next, false)
      return
    }
    // dwell: a new subject holds a moment before it replaces the shown one
    if (pendingKey !== next.key) {
      pendingKey = next.key
      pendingSince = t0
    }
    if (t0 - pendingSince >= EXPLAIN_DWELL_MS) render(next, false)
    else schedule(pendingSince + EXPLAIN_DWELL_MS - t0)
  }

  /** a refresh soon: at once when the last one is old enough, else at the 2 Hz slot */
  const refresh = (): void => {
    const wait = lastCompute + EXPLAIN_REFRESH_MS - nowMs()
    if (wait <= 0) compute()
    else schedule(wait)
  }
  const now = (): void => {
    force = true
    compute()
  }
  /** a runtime change (knob, button, switch): hold until readings taken after it arrive */
  const hold = (): void => {
    if (holdSince === null) holdSince = nowMs()
    holdPushes = 0
    if (getSimPhase() === 'running') schedule(holdSince + EXPLAIN_HOLD_MS - nowMs())
  }

  const unsubs: (() => void)[] = []
  unsubs.push(
    useStore.subscribe((s, prev) => {
      let structural = false
      let runtime = false
      if (s.layout !== prev.layout) {
        const r = revisionOf(s.layout, useLab.getState().firmware)
        if (r !== rev) {
          rev = r
          changeAt = nowMs()
          teleAtChange = prev.telemetry
          structural = true
          // the edit's own staleness rule takes over from a held knob / button
          holdSince = null
          holdPushes = 0
          // the host reloads: its next snapshot is the new circuit before its first solve
          beginSettle()
        } else runtime = true
        // its effect on the outputs is no blink (one press and release, undo, a wire moved)
        guarded(() => noteUserAction(history))
      }
      if (s.telemetry !== prev.telemetry && s.telemetry) {
        const waiting = settle !== null
        // the unsolved load frame (settle) is neither observed nor counted as readings taken after a change
        if (noteSnapshot(prev.telemetry, s.telemetry)) {
          observe(s.layout, s.telemetry)
          if (waiting && !runtime && !structural && s.running === prev.running && s.selection === prev.selection) {
            // the first solved readings of the new session / circuit: explained at once, not at the 2 Hz slot
            compute()
            return
          }
          // readings taken after the held change: two pushes while running (the first may have been in
          // flight), one while paused
          if (holdSince !== null && !runtime && ++holdPushes >= (s.running && getSimPhase() === 'running' ? 2 : 1)) {
            release()
            compute()
            return
          }
        }
      }
      // only a live session has readings to wait for (idle: the static words follow the change at once)
      if (runtime && s.telemetry && !rig && getSimPhase() !== 'idle') {
        hold()
        if (s.selection !== prev.selection) now()
        return
      }
      if (s.running !== prev.running && holdSince !== null) {
        // a pause / resume while a change is held: wait for that phase's first readings
        holdSince = nowMs()
        holdPushes = 0
      }
      if (structural || s.running !== prev.running || s.selection !== prev.selection || runtime) now()
      else if (s.telemetry !== prev.telemetry || s.simTime !== prev.simTime) refresh()
    }),
  )
  unsubs.push(useProblems.subscribe((s, prev) => (s.problems !== prev.problems || s.layout !== prev.layout ? compute() : undefined)))
  unsubs.push(
    useLab.subscribe((s, prev) => {
      if (s.firmware !== prev.firmware) {
        rev = revisionOf(useStore.getState().layout, s.firmware)
        changeAt = nowMs()
        teleAtChange = useStore.getState().telemetry
        guarded(() => noteUserAction(history))
        beginSettle()
        now()
      } else if (s.mcus !== prev.mcus) refresh()
    }),
  )
  unsubs.push(
    onSimHostEvent((e) => {
      if (e.kind === 'reset') {
        Object.assign(history, newExplainHistory())
        // the power cycle's first snapshot is t = 0 before its first solve
        beginSettle()
        refresh()
      } else if (e.kind === 'frame' && e.current) {
        // the board whose serial data is coming in now (UART_RECENT_S keeps it while bytes keep coming)
        for (const u of e.frame.uart) if (u.bytes.length > 0) noteUart(history, u.componentId, e.frame.time)
      }
    }),
  )
  // a lesson step (or the guided lesson) changes what must not be printed: at once
  let stepKey = guidedStepKey()
  const onLesson = (): void => {
    const k = guidedStepKey()
    if (k === stepKey) return
    stepKey = k
    now()
  }
  unsubs.push(useLessonUi.subscribe(onLesson))
  unsubs.push(useLessonProgress.subscribe(onLesson))
  unsubs.push(onLangChange(now))
  const s0 = useStore.getState()
  if (s0.telemetry) observe(s0.layout, s0.telemetry)
  compute()

  return () => {
    for (const u of unsubs) u()
    if (timer !== null) clearTimeout(timer)
    if (announceTimer !== null) clearTimeout(announceTimer)
    useExplainView.setState(EMPTY_VIEW)
  }
}

/** useLayoutEffect in the browser (the first lines are there before the first paint — no inspector jump), useEffect elsewhere. */
const useBeforePaint = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * The explanation while `enabled` (the watcher runs only then — the desktop
 * card, or the phone pill); null otherwise. The watcher starts before the
 * first paint, so the card (and the inspector's top under it) never jumps
 * in after it.
 */
export function useExplanation(enabled: boolean): ExplainView | null {
  useBeforePaint(() => (enabled ? startExplainWatcher() : undefined), [enabled])
  // a disabled consumer (the desktop pill, the phone card) never re-renders on the other one's updates
  const view = useExplainView((s) => (enabled ? s : EMPTY_VIEW))
  return enabled ? view : null
}
