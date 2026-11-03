/**
 * Success watchers (owner: vivid; honesty rules: cheer) — WHEN to celebrate,
 * from real state only. The cheer is a promise: when it plays, every other
 * surface (status pill, Problems, inspector, lesson panel) agrees.
 *
 *   startSuccessWatch()  CelebrationOverlay installs it once; returns stop
 *
 * 1. lesson pass: a lesson's acceptance run (useLessonUi.runs['<id>|acceptance'])
 *    finishes with every check passing → celebrate('lesson-pass') with the
 *    lesson's title and the count of checks that passed, gathered around the
 *    parts the checks looked at. NOT when the passing circuit is the loaded
 *    answer (the solution was loaded after the start circuit — the lesson's
 *    own progress record, read only): the lesson panel already says that
 *    pass does not count, so no badge, confetti or chime (lesson-pass.ts).
 * 2. circuit ok (「電路正常運作 ✓」) — CheerJudge, all of:
 *    - the circuit NEWLY does something (circuitActivity: an LED that really
 *      carries ≥ 1 mA, a motor turning, a buzzer sounding, a display on, a
 *      lit segment / pixel, an MCU output pin that really toggled, UART
 *      bytes the firmware sent) that it has not already done cleanly in this
 *      simulation session (startSim … resetSim; a pause keeps it). So a
 *      delete, an undo or a knob that leaves the same things working never
 *      re-cheers — only a change that makes something newly work cleanly.
 *      What worked before a change counts as done even when its window had
 *      not finished yet (a delete 0.7 s after Run does not cheer the LED that
 *      was already lit), unless that revision was known not to be clean (a
 *      blocking warning / error / damage): then fixing it can still cheer;
 *    - NO error and NO warning naming an active part (one that works or
 *      carries current) — with such a warning there is no celebration at
 *      all: the status pill already explains;
 *    - that holds for CHEER_WINDOW_S of SIMULATED time, judged by a problems
 *      list computed after the window (recomputeProblems); a damage event
 *      (a part burns / vents / overheats, a pin beyond its absolute maximum)
 *      or a new error inside the window cancels it;
 *    - AT FIRE TIME every thing the toast would name is re-verified against
 *      the latest telemetry (CheerJudge.verdict — final walkthrough M1: the
 *      cheer once named 「LED1 亮了」 over an LED a released button had
 *      already turned dark): it is there NOW (an LED lit now; an MCU pin
 *      that toggles changed within its last period, one that changed once
 *      still holds its new level — 「PA5 切換了」, not 「在切換」) and it
 *      covered the window's last half (steadily, or — a blinking LED — by
 *      repeating since before it). A blinking LED in its off phase holds the
 *      cheer until its next on-phase (the toast plays while it is lit); what
 *      went away is dropped; with nothing left there is no cheer (the next
 *      sign of life opens a new window). A momentary input (a button's
 *      runtime 'pressed') that just moved holds the judgement for
 *      HAND_SETTLE_S, and a pin's toggling counts only if it goes on after
 *      the hand moved — so what ended because a button returned to rest
 *      (a 0.9 s press, a phone long-press) never cheers. WHILE A FINGER
 *      HOLDS a momentary input (CheerSnapshot.held — pressed by the 3D
 *      press-and-hold or the 按住 puck, not kept pressed: latch.ts) nothing
 *      is judged at all: what only the finger keeps alive is the hand, not
 *      the circuit working, and it ends with the release a moment later (a
 *      1.3 s / 2.5 s press once cheered just before the LED went dark —
 *      M1 verification). After the release the judgement settles
 *      (HAND_SETTLE_S) and names only what still works; 保持按下 is a
 *      steady state and cheers like any other circuit;
 *    - at most once per circuit revision (circuitRevision: parts, placements,
 *      build-time params, wires, bound firmware — a knob is not a change);
 *    - never for what a circuit auto-run started on OPENING it does by
 *      itself (round 5 — runStartedByAutoRun 'boot' / 'load' / 'chrome':
 *      the app's restored board, an example, a lesson circuit, a project;
 *      CheerJudge.quiet): the learner did not build it — it counts as done
 *      (cleanSeen), it is not cheered. Once the learner USES that circuit (a
 *      switch, a button, a knob, the supply — CheerJudge.wake) what newly
 *      works cheers as usual, and so does what a user edit newly makes work.
 *
 * Under the visual-regression harness (?shotrig, celebrationsSuppressed)
 * nothing is watched: the shots stay deterministic.
 *
 * Non-React and rate-limited: the checks run on the store's ≤ 10 Hz React
 * telemetry push and the problems store's ≤ 1 Hz updates, never per frame
 * (the per-frame host event only sets a flag when UART bytes arrive); the
 * one extra problems computation runs once per window.
 */
import type { CircuitLayout, ComponentTelemetry, SimTelemetry } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { onSimHostEvent, useStore } from '../../state/store'
import { runStartedByAutoRun } from '../../state/run-gate'
import { pinDamageFromIssues } from '../../sim/erc/rules-damage'
import { useLab } from '../embedded/lab'
import { canPress, useLatchHolds } from '../embedded/latch'
import { isLegacyChrome } from '../chrome/legacy'
import { recomputeProblems, useProblems, type Problem } from '../embedded/problems'
import { useLessonUi } from '../lessons/state'
import { lessonById } from '../../lessons'
import { t } from '../../i18n'
import { celebrate, celebrationsSuppressed, useCelebration } from './celebrate'
import { passUsesSolution, noteSolutionPass, runUsesSolution } from './lesson-pass'

/** an LED counts as lit from 1 mA (light = I / 20 mA) */
export const LIT_LIGHT = 0.05
/** kept for callers: the simulation must have run this long (s) before a circuit is judged */
export const SETTLE_S = 0.25
/** a newly working circuit must stay clean this long (SIMULATED seconds) before the cheer */
export const CHEER_WINDOW_S = 1.2
/** what the 「電路正常運作 ✓」 toast names (the 3D sparkle covers every part) */
export const CHEER_PHRASES = 2
/** a motor counts as turning above this speed (rpm) */
export const TURNING_RPM = 5
/** a part carrying at least this current (A) belongs to the working circuit */
export const ACTIVE_CURRENT_A = 1e-5
/** … or dissipating at least this power (W) */
const ACTIVE_POWER_W = 1e-4
/** a momentary input (a button's 'pressed') that moved holds the judgement this long (SIMULATED s) */
export const HAND_SETTLE_S = 0.4
/** past the window, the judge waits at most this long (SIMULATED s) for what is due back (a blinking LED's next on-phase) */
export const CHEER_WAIT_S = 1.5
/** a periodic thing is due back within 1.5 periods plus this (SIMULATED s: the 10 Hz telemetry's sampling) */
const PERIOD_SLACK_S = 0.3

/**
 * Structural identity of a circuit: what a "change" is for the circuit-ok
 * cue. Runtime params (knobs, switches, PSU voltage …) are excluded — moving
 * them is using the circuit, not changing it.
 */
export function circuitRevision(layout: CircuitLayout, firmware: Record<string, { sha256?: string }> = {}): string {
  const parts = layout.components.map((c) => {
    const entry = getEntry(c.type)
    const runtime = new Set((entry?.params ?? []).filter((p) => p.runtime).map((p) => p.key))
    const params = c.params
      ? Object.keys(c.params)
          .filter((k) => !runtime.has(k))
          .sort()
          .map((k) => `${k}=${String(c.params![k])}`)
          .join(',')
      : ''
    return `${c.id}|${c.type}|${(c.holes ?? []).join(',')}|${c.at ?? ''}|${c.rotation ?? 0}|${params}|${firmware[c.id]?.sha256 ?? ''}`
  })
  const wires = layout.wires.map((w) => `${w.from}>${w.to}`)
  return `${parts.sort().join(';')}#${wires.sort().join(';')}`
}

/** One thing the circuit really does, keyed so "the same thing again" is recognisable. */
export interface ActivityItem {
  /** 'LED1:lit', 'M1:turning', 'U1:toggles:PC13', 'U1:uart' … */
  key: string
  id: string
  /** short phrase, UI language (「LED1 亮了」) */
  phrase: string
  /** an MCU pin's item ('toggles:'): how many level changes were seen, and the last one (simulated s) */
  changes?: number
  lastChange?: number
}

export interface Activity {
  /** parts showing real activity, the subject first */
  componentIds: string[]
  /** short phrases, UI language (「LED1 亮了」), at most 3 */
  phrases: string[]
  /** every activity, keyed */
  items: ActivityItem[]
}

/** MCU output levels seen per board pin (for the toggle check), kept by the caller. */
export type PinLevels = Map<string, number>

/** One MCU output pin's level changes (simulated s), kept by the caller. */
export interface PinChange {
  /** level changes seen */
  n: number
  /** the newest change times, oldest first (at most 3) */
  times: number[]
  /** the last sample's time, and the step before it (the telemetry's sampling) */
  at: number
  dt: number
}
export type PinChanges = Map<string, PinChange>

/**
 * A pin that changed at least twice still toggles at `time`: its last change
 * is at most 1.5 of its recent intervals old (plus the sampling's slack).
 */
export function stillToggling(h: PinChange, time: number): boolean {
  const ts = h.times
  if (ts.length < 2) return false
  let gap = ts[ts.length - 1] - ts[ts.length - 2]
  if (ts.length >= 3) gap = Math.max(gap, ts[ts.length - 2] - ts[ts.length - 3])
  return time - ts[ts.length - 1] <= 1.5 * gap + Math.max(PERIOD_SLACK_S, 3 * h.dt)
}

function isPowerIndicator(subId: string): boolean {
  return /PWR/i.test(subId)
}

/**
 * What the learner built comes first in the words: a part that lights /
 * turns / sounds / shows, then a board pin that toggles, then a board's own
 * LED, then serial data (stable within one kind).
 */
function activityRank(it: ActivityItem): number {
  const what = it.key.slice(it.id.length + 1)
  if (what.startsWith('toggles:')) return 1
  if (what.startsWith('sub-lit:')) return 2
  if (what === 'uart') return 3
  return 0
}

function activityFrom(input: readonly ActivityItem[]): Activity {
  const items = input.map((it, i) => ({ it, i })).sort((a, b) => activityRank(a.it) - activityRank(b.it) || a.i - b.i).map((x) => x.it)
  const ids: string[] = []
  const phrases: string[] = []
  for (const it of items) {
    if (!ids.includes(it.id)) ids.push(it.id)
    if (phrases.length < 3 && !phrases.includes(it.phrase)) phrases.push(it.phrase)
  }
  return { componentIds: ids, phrases, items }
}

/**
 * The real activity in one telemetry snapshot. `levels` remembers each MCU
 * output pin's last logic level (0 / 1) across snapshots: a pin that took
 * both levels while running counts as toggling. With `changes` (the
 * watcher's), each pin's change times are kept too and its item tells the
 * truth NOW: a pin that changed once and holds its new level 「U1 的 PA5
 * 切換了」, one that keeps changing 「U1 的 PA5 在切換」 — only while its
 * last change is within its recent period (stillToggling); a pin that
 * stopped is no activity any more. Without `changes` (older callers) a pin
 * that took both levels once reads 「在切換」 from then on. Pure apart from
 * `levels`, `toggled` and `changes`.
 */
export function circuitActivity(layout: CircuitLayout, tele: SimTelemetry, levels: PinLevels, toggled: Set<string>, changes?: PinChanges): Activity {
  const items: ActivityItem[] = []
  const add = (id: string, what: string, phrase: string, extra?: Pick<ActivityItem, 'changes' | 'lastChange'>) => {
    const key = `${id}:${what}`
    if (!items.some((x) => x.key === key)) items.push(extra ? { key, id, phrase, ...extra } : { key, id, phrase })
  }
  for (const comp of layout.components) {
    const id = comp.id
    const ct: ComponentTelemetry | undefined = tele.components[id]
    if (!ct) continue
    const entry = getEntry(comp.type)
    const v = ct.values ?? {}
    if (!ct.burned && typeof ct.light === 'number' && ct.light >= LIT_LIGHT) add(id, 'lit', t('{id} lit', { id }))
    if (ct.sub) {
      for (const [sid, st] of Object.entries(ct.sub)) {
        if (isPowerIndicator(sid) || st.burned) continue
        if (typeof st.light === 'number' && st.light >= LIT_LIGHT) add(id, `sub-lit:${sid}`, t('{id} on-board LED lit', { id }))
      }
    }
    if (typeof v.rpm === 'number' && Math.abs(v.rpm) >= TURNING_RPM) add(id, 'turning', t('{id} turning', { id }))
    if (ct.sounding === true) add(id, 'sounding', t('{id} sounding', { id }))
    if (ct.display?.on === true) add(id, 'display', t('{id} display on', { id }))
    if (ct.segments && Object.values(ct.segments).some(Boolean)) add(id, 'lit', t('{id} lit', { id }))
    if (Array.isArray(ct.rgb) && ct.rgb.some((x) => (x & 0xffffff) !== 0)) add(id, 'lit', t('{id} lit', { id }))
    // an MCU whose OUTPUT pin really took both levels while it runs
    const mcu = ct.mcu
    if (entry?.mcu && mcu && (mcu.state === 'running' || mcu.state === 'sleeping') && mcu.pinModes) {
      const vdd = 3.3
      for (const [pin, mode] of Object.entries(mcu.pinModes)) {
        if (mode !== 'out' && mode !== 'od' && mode !== 'af' && mode !== 'af-od') continue
        const vp = ct.pinVoltages[pin]
        if (typeof vp !== 'number' || !Number.isFinite(vp)) continue
        const level = vp > vdd * 0.6 ? 1 : vp < vdd * 0.3 ? 0 : -1
        if (level < 0) continue
        const key = `${id}:${pin}`
        const prev = levels.get(key)
        const h = changes ? (changes.get(key) ?? { n: 0, times: [], at: tele.time, dt: 0 }) : null
        if (h && changes) {
          if (tele.time > h.at) {
            h.dt = tele.time - h.at
            h.at = tele.time
          }
          changes.set(key, h)
        }
        if (prev !== undefined && prev !== level) {
          toggled.add(key)
          if (h) {
            h.n++
            h.times.push(tele.time)
            if (h.times.length > 3) h.times.shift()
          }
        }
        levels.set(key, level)
        if (!toggled.has(key)) continue
        if (!h) add(id, `toggles:${pin}`, t('{id} toggles {pin}', { id, pin }))
        else if (h.n === 1) add(id, `toggles:${pin}`, t('{id} switched {pin}', { id, pin }), { changes: 1, lastChange: h.times[0] })
        else if (stillToggling(h, tele.time)) add(id, `toggles:${pin}`, t('{id} toggles {pin}', { id, pin }), { changes: h.n, lastChange: h.times[h.times.length - 1] })
      }
    }
  }
  return activityFrom(items)
}

/**
 * Damage anywhere in a snapshot: a part's own model latched or is in a
 * damage state (burned, vented, overheating, a pin beyond its rating), a
 * burned LED, or a board pin the simulation measured beyond its absolute
 * maximum. A circuit in this state is not "working normally".
 */
export function snapshotDamaged(tele: SimTelemetry): boolean {
  for (const id in tele.components) {
    const ct = tele.components[id]
    if (!ct) continue
    if (ct.burned === true || ct.damage) return true
    if (ct.sub) {
      for (const sid in ct.sub) {
        const st = ct.sub[sid]
        if (st && (st.burned === true || st.damage)) return true
      }
    }
  }
  return pinDamageFromIssues(tele.issues).length > 0
}

/**
 * The parts that belong to the working circuit right now: those named by
 * `extra` (what works), every part the solver says carries current or
 * dissipates power, and every MCU board that runs.
 */
export function activePartIds(layout: CircuitLayout, tele: SimTelemetry, extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>(extra)
  for (const c of layout.components) {
    const ct = tele.components[c.id]
    if (!ct) continue
    if (typeof ct.current === 'number' && Math.abs(ct.current) >= ACTIVE_CURRENT_A) out.add(c.id)
    else if (typeof ct.power === 'number' && Math.abs(ct.power) >= ACTIVE_POWER_W) out.add(c.id)
    else if (ct.pinCurrents && Object.values(ct.pinCurrents).some((i) => Math.abs(i) >= ACTIVE_CURRENT_A)) out.add(c.id)
    else if (ct.mcu && (ct.mcu.state === 'running' || ct.mcu.state === 'sleeping')) out.add(c.id)
  }
  return out
}

/**
 * The rows that forbid a cheer: every error, and every warning that names
 * an active part (or no part at all). Board STATES (a debugger halt) and
 * info rows do not count.
 */
export function cheerBlockers(problems: readonly Problem[], active: ReadonlySet<string>): Problem[] {
  return problems.filter(
    (p) =>
      !p.state &&
      (p.level === 'error' || (p.level === 'warning' && (p.componentIds.length === 0 || p.componentIds.some((id) => active.has(id))))),
  )
}

/** What one judged snapshot tells the judge. */
export interface CheerSnapshot {
  /** circuitRevision of the circuit the snapshot belongs to */
  rev: string
  /** simulated time (s) */
  time: number
  activity: Activity
  /** snapshotDamaged() */
  damaged: boolean
  /**
   * simulated time of the latest change of a momentary input (a button's
   * runtime 'pressed': pressed, released, kept, let go) in this session;
   * absent = none
   */
  handAt?: number
  /**
   * a finger holds a momentary input down right now (fingerHeld: the 3D
   * press-and-hold, the 按住 puck — not 保持按下): nothing is judged until it
   * lets go; absent = no
   */
  held?: boolean
}

/** One thing in the running window: when it was there (simulated s). */
export interface CheerTrack {
  /** the newest form of the thing (its phrase can change: 「切換了」 → 「在切換」) */
  it: ActivityItem
  /** first seen in this window */
  first: number
  /** start of its current presence (null = not there in the latest snapshot) */
  runStart: number | null
  /** when it (re)appeared, newest last (at most 4): two or more = it repeats (a blinking LED) */
  onsets: number[]
}

/** What the judge makes of one thing when the window is over. */
export type CheerVerdict = 'yes' | 'wait' | 'no'

export interface CheerDecision {
  /** the parts that newly work (the 3D sparkle) */
  componentIds: string[]
  /** 「LED1 亮了 · U1 的 PC13 在切換」 */
  message: string
}

/**
 * The circuit-ok rules as a small state machine (pure: the caller feeds
 * snapshots and the problems lists — see the module doc).
 */
export class CheerJudge {
  /** revisions that already cheered (never again on this page) */
  private readonly cheered = new Set<string>()
  /** activity keys that already worked (cleanly, as far as anything showed) in this simulation session */
  private readonly cleanSeen = new Set<string>()
  /**
   * activity keys seen in the CURRENT revision while nothing was known
   * against it (no blocking list, no damage) — not yet confirmed. A change
   * of the circuit settles them into cleanSeen (they already worked before
   * that change: a delete / undo / move inside the first window never
   * cheers them later); a blocker or damage found for this revision
   * retracts them (they never worked cleanly: fixing it may still cheer).
   */
  private readonly provisional = new Set<string>()
  /** the current revision is known not to be clean (a blocking list or damage) until a clean list opens a window */
  private blocked = false
  /** the running window: what newly works and when each was there (simulated s) */
  private pending: { rev: string; since: number; items: Map<string, CheerTrack> } | null = null
  /** the problems list (identity) that last blocked: wait for a different one */
  private blockedBy: readonly Problem[] | null = null
  private rev: string | null = null
  /** the revision opened, not built (quiet) — until the learner uses it (wake) */
  private quietRev: string | null = null
  /** the revision that was opened (kept through wake): a power cycle of it is quiet again */
  private openedRev: string | null = null

  /**
   * Revision `rev` was OPENED, not built (auto-run started it for 'boot' /
   * 'load' / 'chrome' — the app's restored board, an example, a lesson
   * circuit, a project): what it does by itself is seeded into cleanSeen —
   * its windows still run and confirm what works (a blocker or damage still
   * retracts it), but they never cheer. Until the learner uses the circuit
   * (wake): from then on what NEWLY works cheers as usual. A change of the
   * circuit ends it too (revise): the edit is the learner's.
   */
  quiet(rev: string): void {
    this.quietRev = rev
    this.openedRev = rev
  }

  /**
   * The learner used the quiet circuit (a runtime value — a switch, a
   * button, a knob, the supply): what it already did counts as done (as for
   * a change — a window not finished yet included, unless the circuit was
   * known not to be clean), and what newly works from now on can cheer.
   */
  wake(): void {
    if (this.quietRev === null || this.quietRev !== this.rev) return
    this.quietRev = null
    for (const k of this.provisional) this.cleanSeen.add(k)
    this.provisional.clear()
    this.pending = null
  }

  /** the opened revision is quiet (tests / diagnostics) */
  get quietNow(): boolean {
    return this.quietRev !== null && this.quietRev === this.rev
  }

  /** a new simulation session (resetSim): nothing has worked yet — an opened circuit powered up again is quiet again */
  reset(): void {
    this.cleanSeen.clear()
    this.provisional.clear()
    this.blocked = false
    this.pending = null
    this.blockedBy = null
    if (this.openedRev !== null && this.openedRev === this.rev) this.quietRev = this.openedRev
  }

  /**
   * The circuit's revision: a change cancels a pending window, and what
   * the circuit already did before it (not known to be unclean) counts as
   * done in this session — only something that NEWLY works after the change
   * can cheer.
   */
  revise(rev: string): void {
    if (rev === this.rev) return
    for (const k of this.provisional) this.cleanSeen.add(k)
    this.provisional.clear()
    this.blocked = false
    this.rev = rev
    this.pending = null
    this.blockedBy = null
    // a change of the circuit is the learner's: the opened revision is left behind
    if (this.quietRev !== rev) this.quietRev = null
    if (this.openedRev !== rev) this.openedRev = null
  }

  /** this revision is known not to be clean: what it did so far did not "work cleanly" */
  private retract(): void {
    this.provisional.clear()
    this.blocked = true
  }

  private observe(items: readonly ActivityItem[]): void {
    if (this.blocked) return
    for (const it of items) this.provisional.add(it.key)
  }

  /** a window is running (tests / diagnostics) */
  get pendingSince(): number | null {
    return this.pending ? this.pending.since : null
  }

  /**
   * Is `tr` true NOW, and has it been for the window's last half (M1)?
   *  - gone: a thing that repeats (≥ 2 onsets — a blinking LED in its off
   *    phase) is due back within 1.5 periods → 'wait'; anything else ended → 'no';
   *  - there, but a button moved less than HAND_SETTLE_S ago → 'wait' (see what
   *    remains without the hand); a pin's toggling whose last change came no
   *    later than that → 'wait' (it must go on without the hand: changes the
   *    presses made are not the firmware toggling);
   *  - there since the window's last half began, or repeating since before
   *    it → 'yes'; there only recently → 'wait'.
   */
  verdict(tr: CheerTrack, time: number, handAt: number): CheerVerdict {
    const n = tr.onsets.length
    if (tr.runStart === null) {
      if (n < 2) return 'no'
      const period = tr.onsets[n - 1] - tr.onsets[n - 2]
      return time - tr.onsets[n - 1] <= 1.5 * period + PERIOD_SLACK_S ? 'wait' : 'no'
    }
    const settled = handAt + HAND_SETTLE_S
    if (time < settled) return 'wait'
    if ((tr.it.changes ?? 0) >= 2 && (tr.it.lastChange ?? -Infinity) < settled) return 'wait'
    const half = time - CHEER_WINDOW_S / 2
    if (tr.runStart <= half || (n >= 2 && tr.first <= half)) return 'yes'
    return 'wait'
  }

  /** this snapshot's things into the window's tracks */
  private track(fresh: readonly ActivityItem[], time: number): void {
    if (!this.pending) return
    const now = new Map(fresh.map((it) => [it.key, it]))
    for (const [key, tr] of this.pending.items) {
      const it = now.get(key)
      if (!it) {
        tr.runStart = null
        continue
      }
      tr.it = it
      if (tr.runStart === null) {
        tr.runStart = time
        tr.onsets.push(time)
        if (tr.onsets.length > 4) tr.onsets.shift()
      }
    }
    for (const it of fresh) {
      if (!this.pending.items.has(it.key)) this.pending.items.set(it.key, { it, first: time, runStart: time, onsets: [time] })
    }
  }

  /**
   * One snapshot.
   *  - `latest`: the newest published problems list when it was computed
   *    for THIS circuit, else null;
   *  - `judge()`: computes the problems list now (called once, after the window);
   *  - `active(ids)`: activePartIds for this snapshot plus `ids`.
   * Returns the cheer to play, or null.
   */
  step(
    snap: CheerSnapshot,
    latest: readonly Problem[] | null,
    judge: () => readonly Problem[],
    active: (ids: readonly string[]) => ReadonlySet<string>,
  ): CheerDecision | null {
    this.revise(snap.rev)
    if (snap.damaged) {
      // a damage event: cancel the window; the latched damage blocks until reset / fixed
      this.pending = null
      this.retract()
      return null
    }
    const fresh = snap.activity.items.filter((it) => !this.cleanSeen.has(it.key))
    if (!this.pending) {
      if (fresh.length === 0) return null
      if (latest === null) {
        // no list for this circuit yet: nothing is known against it (no window either)
        if (!snap.held) this.observe(fresh)
        return null
      }
      if (latest === this.blockedBy) return null
      const ids = [...snap.activity.componentIds]
      if (cheerBlockers(latest, active(ids)).length > 0) {
        this.blockedBy = latest
        this.retract()
        return null
      }
      this.blocked = false
      if (!snap.held) this.observe(fresh)
      this.pending = { rev: snap.rev, since: snap.time, items: new Map() }
      this.track(fresh, snap.time)
      return null
    }
    // a new error inside the window cancels it
    if (latest && latest.some((p) => p.level === 'error' && !p.state)) {
      this.blockedBy = latest
      this.pending = null
      this.retract()
      return null
    }
    // what a finger keeps alive (held) never counts as having worked: not provisional either
    if (!snap.held) this.observe(fresh)
    this.track(fresh, snap.time)
    // a finger holds a momentary input down: nothing is judged until it lets go (what only the
    // hand keeps alive ends with the release — M1); the window waits, it never runs out meanwhile
    if (snap.held) return null
    const since = this.pending.since
    if (snap.time < since + CHEER_WINDOW_S) return null
    // M1: re-verify everything the toast would name against THIS snapshot (verdict) —
    // what is due back (a blinking LED's next on-phase, the circuit after a button moved)
    // holds the cheer a little; what went away is dropped; nothing left: no cheer
    const handAt = snap.handAt ?? -Infinity
    let waiting = false
    const items: ActivityItem[] = []
    for (const tr of this.pending.items.values()) {
      const v = this.verdict(tr, snap.time, handAt)
      if (v === 'yes') items.push(tr.it)
      else if (v === 'wait') waiting = true
    }
    // the bounded wait counts from when a verdict could first be given: the window's end, or
    // HAND_SETTLE_S after the hand's last move (a long press released after the window)
    const ready = Math.max(since + CHEER_WINDOW_S, handAt + HAND_SETTLE_S)
    if (waiting && snap.time < ready + CHEER_WAIT_S) return null
    if (items.length === 0) {
      // what newly worked does not any more (a released button, a one-off flash): the next sign of life opens a new window
      this.pending = null
      return null
    }
    const ids = [...new Set([...items.map((it) => it.id), ...snap.activity.componentIds])]
    const judged = judge()
    if (cheerBlockers(judged, active(ids)).length > 0) {
      this.blockedBy = judged
      this.pending = null
      this.retract()
      return null
    }
    // confirmed: what works now works cleanly
    for (const it of snap.activity.items) this.cleanSeen.add(it.key)
    for (const it of items) this.cleanSeen.add(it.key)
    for (const k of this.provisional) this.cleanSeen.add(k)
    this.provisional.clear()
    this.pending = null
    // an opened circuit (quiet): what it does is done now — not cheered, the learner did not build it
    if (this.quietRev === snap.rev) return null
    if (this.cheered.has(snap.rev)) return null
    this.cheered.add(snap.rev)
    const a = activityFrom(items)
    // one line of toast: the two most telling things that newly work
    return { componentIds: a.componentIds, message: a.phrases.slice(0, CHEER_PHRASES).join(' · ') }
  }
}

// ---------------------------------------------------------------------------
// the watcher
// ---------------------------------------------------------------------------

let running = 0

export interface SuccessWatchOptions {
  /** compute the problems list now (default: recomputeProblems() → useProblems) */
  judgeProblems?: () => readonly Problem[]
}

/**
 * The momentary inputs pressed in `layout` (a button's runtime 'pressed' —
 * held by a finger or kept pressed, latch.ts): their ids, sorted. A change
 * of this key is the hand moving (CheerSnapshot.handAt).
 */
export function pressedInputs(layout: CircuitLayout): string {
  const out: string[] = []
  for (const c of layout.components) if (c.params?.pressed === true && canPress(getEntry(c.type))) out.push(c.id)
  return out.sort().join(',')
}

/**
 * The momentary inputs a FINGER holds down in `layout` right now (pressed
 * and held — latch.ts useLatchHolds: the 3D press-and-hold, the 按住 puck),
 * as opposed to kept pressed (保持按下). The English classic chrome has no
 * 保持按下 for the pushbutton (its HOLD button writes 'pressed' while it is
 * held), so a pressed pushbutton there is always a finger. Ids, sorted.
 */
export function fingerHeld(
  layout: CircuitLayout,
  held: readonly string[] = useLatchHolds.getState().held,
  classic: boolean = isLegacyChrome(),
): string[] {
  const out: string[] = []
  for (const c of layout.components) {
    if (c.params?.pressed !== true || !canPress(getEntry(c.type))) continue
    if (held.includes(c.id) || (classic && c.type === 'pushbutton')) out.push(c.id)
  }
  return out.sort()
}

/** The hand's state: which inputs are pressed, and which of them a finger holds (`SW1*`). A change = the hand moved. */
function handKey(layout: CircuitLayout): string {
  const fingers = fingerHeld(layout)
  return pressedInputs(layout)
    .split(',')
    .map((id) => (id && fingers.includes(id) ? `${id}*` : id))
    .join(',')
}

/** A part's values changed between `prev` and `next` (its params object replaced — an instrument moved keeps it). */
export function valuesChanged(prev: CircuitLayout, next: CircuitLayout): boolean {
  if (prev.components === next.components) return false
  const before = new Map(prev.components.map((c) => [c.id, c.params]))
  return next.components.some((c) => before.has(c.id) && before.get(c.id) !== c.params)
}

/** The parts a passed acceptance run looked at that are on the board (empty = the whole circuit). */
function checkedParts(results: readonly { focus?: { components: string[] } }[]): string[] {
  const on = new Set(useStore.getState().layout.components.map((c) => c.id))
  const out: string[] = []
  for (const r of results) for (const id of r.focus?.components ?? []) if (on.has(id) && !out.includes(id)) out.push(id)
  return out
}

export function startSuccessWatch(opts: SuccessWatchOptions = {}): () => void {
  running++
  if (celebrationsSuppressed()) {
    // the visual-regression harness: no celebration, no extra problems run
    return () => {
      running--
    }
  }
  const startedAt = Date.now()
  const unsubs: (() => void)[] = []

  // ---- 1. lesson pass
  const seenRuns = new WeakSet<object>()
  unsubs.push(
    useLessonUi.subscribe((s, prev) => {
      if (s.runs === prev.runs) return
      for (const [key, run] of Object.entries(s.runs)) {
        if (!key.endsWith('|acceptance') || seenRuns.has(run)) continue
        seenRuns.add(run)
        if (run.status !== 'done' || !run.results || run.results.length === 0 || run.at < startedAt) continue
        if (!run.results.every((r) => r.pass)) continue
        const lessonId = key.slice(0, -'|acceptance'.length)
        // the verdict the run took for the circuit it evaluated (an undo while it ran cannot flip it)
        if (runUsesSolution(run) ?? passUsesSolution(lessonId)) {
          // the loaded answer passed: the lesson panel says it does not count — no cheer
          noteSolutionPass()
          continue
        }
        const lesson = lessonById(lessonId)
        const n = run.results.length
        celebrate('lesson-pass', {
          componentIds: checkedParts(run.results),
          message: lesson
            ? t('“{title}” — all {n} acceptance checks pass', { title: lesson.title, n })
            : t('All {n} acceptance checks pass', { n }),
        })
      }
    }),
  )

  // ---- 2. circuit ok
  const judgeProblems =
    opts.judgeProblems ??
    (() => {
      recomputeProblems()
      return useProblems.getState().problems
    })
  const judge = new CheerJudge()
  let rev = ''
  let levels: PinLevels = new Map()
  let toggled = new Set<string>()
  let changes: PinChanges = new Map()
  let uartSeen = false
  let uartFrom = ''
  let busy = false
  // the hand: which buttons are pressed (and which a finger holds), and when (simulated s) that
  // last changed — a quick click presses and releases between two telemetry pushes, so it is
  // noted on the layout / holds change; 保持按下 over a held button is a move too (handKey)
  let hands = handKey(useStore.getState().layout)
  let handAt = -Infinity
  /** the auto-run start record the judge was last told about (quiet once per opening) */
  let quietedFor: ReturnType<typeof runStartedByAutoRun> = null

  const reviseIfChanged = (): void => {
    const r = circuitRevision(useStore.getState().layout, useLab.getState().firmware)
    if (r === rev) return
    rev = r
    levels = new Map()
    toggled = new Set()
    changes = new Map()
    uartSeen = false
    judge.revise(r)
  }

  const noteHands = (): void => {
    const s = useStore.getState()
    const k = handKey(s.layout)
    if (k === hands) return
    hands = k
    if (s.telemetry) handAt = s.telemetry.time
  }

  const check = (): void => {
    if (busy) return // judgeProblems() publishes to the problems store, which calls back here
    const s = useStore.getState()
    if (!s.running || !s.telemetry) return
    busy = true
    try {
      reviseIfChanged()
      // a circuit auto-run started on opening (the app, an example, a lesson circuit, a project)
      // is not the learner's doing: what it does by itself does not cheer (CheerJudge.quiet —
      // once per opening: using it afterwards wakes the judge)
      const auto = runStartedByAutoRun()
      if (auto !== quietedFor) {
        quietedFor = auto
        if (auto && (auto.reason === 'boot' || auto.reason === 'load' || auto.reason === 'chrome') && auto.rev === rev) judge.quiet(rev)
      }
      const tele = s.telemetry
      const act = circuitActivity(s.layout, tele, levels, toggled, changes)
      if (uartSeen && uartFrom) {
        act.items.push({ key: `${uartFrom}:uart`, id: uartFrom, phrase: t('{id} sends serial data', { id: uartFrom }) })
        if (!act.componentIds.includes(uartFrom)) act.componentIds.push(uartFrom)
      }
      const pr = useProblems.getState()
      const decision = judge.step(
        { rev, time: tele.time, activity: act, damaged: snapshotDamaged(tele), handAt, held: fingerHeld(s.layout).length > 0 },
        pr.layout === s.layout ? pr.problems : null,
        judgeProblems,
        (ids) => activePartIds(s.layout, tele, ids),
      )
      if (!decision) return
      // the lesson's 「完成！」 is on screen: it already says the circuit works
      if (useCelebration.getState().badge) return
      celebrate('circuit-ok', decision)
    } finally {
      busy = false
    }
  }

  unsubs.push(
    useStore.subscribe((s, prev) => {
      if (s.layout !== prev.layout) {
        const before = rev
        reviseIfChanged()
        // the same circuit with a part's value changed: the learner USES it (a switch, a button, a
        // knob, the supply) — an opened circuit's quiet ends (an instrument moved is not using it)
        if (rev === before && valuesChanged(prev.layout, s.layout)) judge.wake()
        noteHands()
      }
      if (s.telemetry !== prev.telemetry || s.running !== prev.running) check()
    }),
  )
  unsubs.push(useLab.subscribe((s, prev) => (s.firmware !== prev.firmware ? reviseIfChanged() : undefined)))
  // a finger letting go of a button it held while the button stays pressed (保持按下 taking over)
  unsubs.push(useLatchHolds.subscribe((s, prev) => (s.held !== prev.held ? noteHands() : undefined)))
  unsubs.push(useProblems.subscribe((s, prev) => (s.problems !== prev.problems || s.layout !== prev.layout ? check() : undefined)))
  unsubs.push(
    onSimHostEvent((e) => {
      if (e.kind === 'reset') {
        // a power cycle starts a new session: nothing has worked in it yet
        // (the same circuit still cheers only once — CheerJudge keeps that)
        levels = new Map()
        toggled = new Set()
        changes = new Map()
        uartSeen = false
        handAt = -Infinity
        judge.reset()
      } else if (e.kind === 'frame' && e.current && !uartSeen) {
        for (const u of e.frame.uart) {
          if (u.bytes.length > 0) {
            uartSeen = true
            uartFrom = u.componentId
            break
          }
        }
      }
    }),
  )
  reviseIfChanged()

  return () => {
    running--
    for (const u of unsubs) u()
  }
}

/** watchers installed (tests) */
export function successWatchCount(): number {
  return running
}
