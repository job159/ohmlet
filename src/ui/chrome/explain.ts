/**
 * 「電路說明」 — one or two plain lines that say what the circuit is doing
 * right now and why (explain stream; the card at the top of the right
 * column, ExplainCard.tsx, and the phone status pill's lowest tier):
 *
 *   ● LED1 亮著：亮度 49 %（9.70 mA）
 *     由 5.00 V 經 R1 330 Ω 供電
 *
 *   ● LED1 不亮：陰極（a38）沒有接地
 *     用導線把 LED1 陰極（a38）接到下方 − 電源軌 第 20 孔
 *
 * The status pill names the FAULT and its one action (「U1 沒有供電」
 * 〔…〕); this names the EFFECT and attributes the cause (「LED1 不亮：驅動它
 * 的 U1 沒有電」). It never prints a Problem.title verbatim (a line that
 * would is dropped) and never counts problems (the pill's 「· 另 n 個」 does).
 *
 * explainCircuit(input) — pure. Subjects, highest tier first (a selected
 * part wins ties inside a tier and never jumps tiers):
 *   P0 the session itself: a debugger halt (the whole world is frozen), a lockup;
 *   P1 latched damage: a burned LED / RGB die / on-board LED, a resistor
 *      burned open, a vented electrolytic, a board pin beyond its absolute
 *      maximum, a supply over 2 A;
 *   P2 no power at all, or every board blocked (no power / firmware / BOOT0)
 *      while nothing the learner built works;
 *   P3 an output that is dark / silent / still with a known cause (an open
 *      lead — its own or its neighbour's — an unfed rail, reversed, both
 *      leads in one strip, the pin not an output, the board driving it
 *      blocked), or a board that is blocked; before any run the same causes
 *      as 「不會亮」 plus the ERC's current-limit findings;
 *   P4 risks on parts that work: an LED over its rating or overheating, a
 *      resistor above its power rating, a series resistor the ERC calls small;
 *   P5 what works, in circuitActivity's order (the learner's outputs, MCU
 *      pins toggling, on-board LEDs, serial data while it keeps coming);
 *   P5b dark or dim for a stated reason: an open switch on every path, the
 *      driving pin at the level that turns it off, a transistor every path
 *      goes through that does not conduct (「按住 SW1，Q1 就會導通」), a
 *      current below the cheer's 1 mA that still glows (「很暗：亮度 3.5 %
 *      （710 µA）」 — never 「沒有電流」);
 *   P6 dark with no cause found (the measured current, as it is);
 *   P7 the supply's output, a board running its firmware, 「電路模擬中」.
 * Line 2: P0–P4 the fix or outcome for the same subject (the ERC's own
 * resistor value — never one computed here —, the hole the missing wire
 * goes to, the 〔換新〕 recovery), else the problem's fix sentence; P5 an
 * aggregate of the same kind and state (「另外 LED2、LED3 也亮著（8.10
 * mA–9.40 mA）」), else the LED's drive path (「由 5.00 V 經 R1 330 Ω 供電」);
 * P5b and lower its own reason / fix first; else the next subject in short
 * form. A subject whose line 1 would contain a Problem.title never leads.
 * Paused: the last snapshot with 「（已暫停）」; no telemetry (auto-run off, a
 * failed start): static, ERC-only text without numbers; an empty board: one
 * line.
 *
 * Honesty: every number is telemetry, a part's params or a parsed issue /
 * ERC finding, through the app's formatters (fmtCurrent, fmtVoltage,
 * ledLightParts — the inspector's own 「49 %（9.70 mA）」 —, fmtPower,
 * fmtRatedCurrent, fmtSimClock, fmtSpan, fmtEng for a resistance param).
 * The lit / turning thresholds are the cheer's (LIT_LIGHT, TURNING_RPM), so
 * the card never contradicts 「電路正常運作 ✓ LED1 亮了」. Blinking and a blink
 * period come from observed flips only (ExplainHistory, fed by the hook at the
 * telemetry's ≤ 10 Hz): three flips the circuit made by itself within
 * BLINK_WINDOW_S = blinking — the flips a user action causes (a press and
 * release, undo, a knob) never count, a burn is no flip —, a period from
 * three flips and only when the sampling cannot alias it. What the blinking
 * looks like comes from the brightness samples of the same window (shapeOf):
 * two levels with step edges 「在閃，約每 1.00 s 一次：亮時 9.70 mA」, a glide
 * through many levels (pwm-fade's breathing LED) 「漸亮漸暗，週期約 2 s：最亮
 * 4.00 mA」, not told (too few samples, a mixed shape) the neutral
 * 「一明一暗…：最亮 …」 — a fade is never 「在閃」. PWM fast enough to fuse
 * (LedWindow's eye mean) has no flips: 「亮著（PWM）：亮度 15 %（平均 2.98
 * mA）」. A buzzer's sounding flips the same way: a beep the samples follow
 * 「嗶嗶響，約每 … 一聲」, a tone / PWM faster than them 「在響」 (never 「不響」
 * between two samples); a silent one's reason 「BZ1 不響：…」, never 「沒亮」. The burn
 * current survives only in the simulator's issue text (engine.ts
 * 'LED LED1 burned out (current 120mA'): BURN_ISSUE parses it (a test pins it).
 *
 * Lessons: while a guided lesson's active step asks the learner to MEASURE
 * a value (its check is a 'measure' — LessonCheck), the card never prints
 * that value (ExplainSecrets, lessonSecrets): 「LED1 亮著」 instead of
 * 「LED1 亮著：亮度 49 %（9.70 mA）」, no burn / on current or supply
 * current for that part, no voltage of the measured net (the path names its
 * supply instead: 「由 PS1 經 R1 330 Ω 供電」), no blink period or PWM
 * brightness while a frequency or a duty is the answer — nor a blinking /
 * fading LED's on-current when it is a PWM average (it follows the duty).
 *
 * Words through t() (zh-TW in src/i18n/zh-TW/explain.ts, keys with an
 * '|explain' context so no other dictionary's key is shadowed); zh-TW lines
 * are tidied (tidyCjkSpaces). Pure apart from the history it is handed.
 */
import type { CircuitLayout, ComponentTelemetry, SimIssue, SimTelemetry } from '../../model/types'
import { getEntry, type CatalogEntry } from '../../model/catalog'
import type { McuFrameInfo } from '../../sim/coordinator/api'
import type { ErcFinding } from '../../sim/erc'
import { pinDamageFromIssues } from '../../sim/erc/rules-damage'
import { t } from '../../i18n'
import { pinLabel, terminalLabel } from '../../i18n/parts'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { fmtCurrent, fmtPower, fmtSimClock, fmtSpan, fmtVoltage, isShortCircuitCurrent, isTrustedVoltage } from '../../instruments/format'
import { LED_LIGHT_RATED_A, fmtRatedCurrent, isAveragedLed, isOverRated, ledLightParts } from '../../instruments/led-light'
import { fmtEng } from '../format'
import { boardBlocker, type BoardBlockerKind, type Problem } from '../embedded/problems'
import { lockupCauseOf, lockupCauseText } from '../embedded/format'
import { endpointName } from '../workspace/hole-chip'
import { parseHole } from '../../model/breadboard'
import { LIT_LIGHT, TURNING_RPM, circuitActivity, type Activity, type PinChanges, type PinLevels } from '../fx/success-watch'
import { TONE_COLOR, stateColor, type SimPhase, type ToneState } from './run-control'
import { circuitOf, ledDrivePath, type DrivePath, type PathEnd } from './explain-path'
import type { LessonCheck, PinRef } from '../../lessons/types'

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** an LED counts as dark again only below this light (hysteresis under the cheer's LIT_LIGHT = 1 mA) */
export const UNLIT_LIGHT = 0.03
/**
 * below the lit threshold but at least this light (0.5 % — 100 µA for a 20 mA
 * LED) an LED still glows visibly in 3D (led-look.ts reaches its visual floor
 * at ≈ 0.2 mA): it is 「很暗」, never 「沒有電流」
 */
export const DIM_LIGHT = 0.005
/** this many lit / dark flips within BLINK_WINDOW_S of SIMULATED time = blinking (on → off → on: a repeat, not one pulse) */
export const BLINK_FLIPS = 3
export const BLINK_WINDOW_S = 4
/** a blink period is named only from this many observed flips */
export const PERIOD_FLIPS = 3
/**
 * flips within this much simulated time after a user action (a press, a
 * knob, an edit, a firmware load) are its effect, not the circuit blinking by
 * itself (at least two telemetry steps — a slowed-down world samples coarser)
 */
export const ACTION_QUIET_S = 0.25
/** a board 「正在送出序列資料」 only while it sent bytes within this much simulated time */
export const UART_RECENT_S = 2
/** … and only when it spans this many telemetry samples (a faster blink would alias) */
const PERIOD_SAMPLES = 4
/**
 * The shape of a blink is told from this many brightness samples inside
 * BLINK_WINDOW_S (see shapeOf); fewer = not told (the neutral 「一明一暗」).
 */
export const SHAPE_SAMPLES = 8
/** brightness samples remembered per emitter (a slowed-down world samples finely: ¼ speed = 40 per simulated second) */
const SHAPE_MAX = 240
/**
 * 'blink' = on / off: the samples sit at two levels and the edges between
 * them are steps; 'fade' = it passes smoothly through many levels (a
 * breathing LED, PWM with a sweeping duty, an RC-smoothed drive).
 */
export type BlinkShape = 'blink' | 'fade'

/** Subject tiers (lower = more important). */
export const TIER = { session: 0, damage: 1, power: 2, cause: 3, risk: 4, works: 5, benign: 6, unknown: 7, steady: 8, none: 9 } as const

/** The simulator's burned-LED issue (src/sim/engine.ts checkRuntimeIssues): the only place the burn current survives. */
export const BURN_ISSUE = /^LED (\S+) burned out \(current (\d+(?:\.\d+)?(?:e[+-]?\d+)?)mA/

/** An ERC current-limit finding's resistor advice (rules-led.ts: 'of about 330 Ω' / 'Use at least 1 kΩ'). */
const RESISTOR_ADVICE = /\b(about|at least) (\d+(?:\.\d+)? [kM]?Ω)/

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type ExplainTone = 'ok' | 'info' | 'warning' | 'error' | 'paused' | 'idle'

export interface Explanation {
  tone: ExplainTone
  /** the leading dot's CSS colour (the one state table for board states, H6) */
  dot: string
  /** line 1 (the subject's state) and, when there is one, line 2 (its fix / the rest) */
  lines: [string] | [string, string]
  /** the parts the lines are about, the subject first (a click selects the first) */
  subjectIds: string[]
  /** subject + state ('5:LED1:lit'): what the dwell / announcements compare */
  key: string
  /** line 1 alone (the phone pill) */
  short: string
  /** the subject's tier (TIER) */
  tier: number
  /** a stand-in with no subject (「電路模擬中」, 「模擬還沒開始」, the empty board): the first real line replaces it at once */
  placeholder?: boolean
}

/** One LED-like emitter's observed history (simulated s). */
export interface EmitterTrack {
  lit: boolean
  /** lit ↔ dark flips the circuit made by itself inside BLINK_WINDOW_S, newest last (not the ones a user action caused) */
  flips: number[]
  /** currents while lit inside the window (A), newest last */
  on: { t: number; i: number }[]
  /** the on-currents predate the last user action: the next lit sample replaces them */
  onStale: boolean
  /** the last sample's time, the step before it and the widest step while flips are remembered */
  at: number
  dt: number
  dtMax: number
  /** the newest flip of any cause (simulated s) */
  lastFlip: number
  /**
   * it was blinking when the learner acted (a knob on the blinker): it still
   * counts as blinking until this simulated time — every new flip extends it
   * by carryGap — so a turn of the knob never flashes 「亮著」 / 「沒亮」 between
   * two blinks; null = no carry
   */
  carryUntil: number | null
  carryGap: number
  /** brightness (light) samples inside BLINK_WINDOW_S since the last user action, newest last — the blink's shape */
  levels: { t: number; l: number }[]
  /** the last time (simulated s) a sample averaged a switching current (PWM: values.iPeak); −Infinity = never */
  pwmAt: number
  /** the observed shape of its blinking (shapeOf), kept while the samples are ambiguous; null = not told */
  shape: BlinkShape | null
}

/** What the hook remembers between telemetry pushes (≤ 10 Hz); reset with the session. */
export interface ExplainHistory {
  /** 'LED1', 'U1/LED_PC13' → its track */
  emitters: Map<string, EmitterTrack>
  /** circuitActivity's toggle bookkeeping */
  levels: PinLevels
  toggled: Set<string>
  changes: PinChanges
  /** the latest circuitActivity (MCU pins toggling) */
  activity: Activity | null
  /** the board whose UART sent bytes last, and when (simulated s; frame events), else null */
  uart: { id: string; at: number } | null
  /** the newest telemetry time observed */
  time: number
  /** a user action waits for the next snapshot (noteUserAction) */
  action: boolean
  /** flips up to this simulated time are the last user action's effect (never a blink) */
  quietUntil: number
}

export interface ExplainInput {
  layout: CircuitLayout
  /** null = no session (auto-run off, a failed start): static ERC-only text */
  telemetry: SimTelemetry | null
  phase: SimPhase
  /** the problems list computed for THIS layout ([] when it speaks for another) */
  problems: readonly Problem[]
  /** the raw ERC findings behind it (the resistor advice is read from their English text) */
  findings?: readonly ErcFinding[]
  mcus?: Readonly<Record<string, McuFrameInfo>>
  firmware?: Readonly<Record<string, { name: string; format: string; description?: string; warnings?: string[] }>>
  /** the selected part ids (a tie-break inside a tier) */
  selection?: readonly string[]
  history?: ExplainHistory | null
  /** what the guided lesson's active step asks the learner to measure: never printed (lessonSecrets) */
  secrets?: ExplainSecrets | null
  /** no session yet, but auto-run will start one by itself (product chrome — the hook asks auto-run) */
  autoStart?: boolean
}

/**
 * What the active step of a guided lesson asks the learner to find out by
 * measuring (lessonSecrets): while that step is active the card says the
 * state without the number — 「LED1 亮著」, never the answer.
 */
export interface ExplainSecrets {
  /** parts whose current / brightness is the answer (a 'current' / 'led-brightness' measure) */
  current: readonly string[]
  /** nets whose voltage is the answer (a 'voltage' measure) */
  nets: readonly string[]
  /** a frequency or a duty is the answer: no blink period, no PWM brightness */
  timing: boolean
}

// ---------------------------------------------------------------------------
// history (the hook feeds it on every telemetry push)
// ---------------------------------------------------------------------------

export function newExplainHistory(): ExplainHistory {
  return {
    emitters: new Map(),
    levels: new Map(),
    toggled: new Set(),
    changes: new Map(),
    activity: null,
    uart: null,
    time: -Infinity,
    action: false,
    quietUntil: -Infinity,
  }
}

/**
 * The learner just acted on the circuit (a button, a switch, a knob, an
 * edit, undo / redo, a firmware load): what the outputs do next is its
 * effect — the next snapshot starts a quiet window (ACTION_QUIET_S) whose
 * flips never count as blinking, and the flips seen before it are forgotten
 * (they belong to the circuit as it was). One press and release is never
 * 「在閃」; a blinker the learner tweaks keeps blinking (carryUntil).
 */
export function noteUserAction(h: ExplainHistory): void {
  h.action = true
}

/** A board sent UART bytes at simulated `time` (the frame's own clock). */
export function noteUart(h: ExplainHistory, id: string, time: number): void {
  h.uart = { id, at: Number.isFinite(time) ? time : h.time }
}

/** A board's power LED: always on while powered — never a subject. */
function isPowerIndicator(subId: string): boolean {
  return /PWR/i.test(subId)
}

/** How long a blink seen before a user action keeps counting without a new flip: 1.5 × its longest phase + two samples. */
function carryGapOf(tr: EmitterTrack): number {
  let widest = 0
  for (let i = 1; i < tr.flips.length; i++) widest = Math.max(widest, tr.flips[i] - tr.flips[i - 1])
  if (widest <= 0) return tr.carryUntil !== null ? tr.carryGap : 0
  return Math.min(BLINK_WINDOW_S, Math.max(0.3, widest * 1.5 + 2 * tr.dt))
}

/**
 * The shape of the brightness samples (BlinkShape), from the values alone:
 * 'blink' when at most 15 % of them lie in the middle half of the swing and
 * at least one step between two samples jumps more than 60 % of it (two
 * levels, sharp edges — the 20 ms eye window puts at most one sample on an
 * edge); 'fade' when at least 30 % lie in the middle half, spread over at
 * least four of its ten bins with none holding half of them (many levels, not
 * one more level), and no step jumps (it glides). Anything else, or fewer
 * than SHAPE_SAMPLES samples, or no real swing: null — not told.
 */
export function shapeOf(levels: readonly { l: number }[]): BlinkShape | null {
  const n = levels.length
  if (n < SHAPE_SAMPLES) return null
  let lo = Infinity
  let hi = -Infinity
  for (const s of levels) {
    if (s.l < lo) lo = s.l
    if (s.l > hi) hi = s.l
  }
  const span = hi - lo
  if (!(span >= LIT_LIGHT - UNLIT_LIGHT)) return null
  let mid = 0
  let jumps = 0
  const bins = new Map<number, number>()
  for (let k = 0; k < n; k++) {
    const x = (levels[k].l - lo) / span
    if (x > 0.25 && x < 0.75) {
      mid++
      const b = Math.floor(x * 20)
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    if (k > 0 && Math.abs(levels[k].l - levels[k - 1].l) > 0.6 * span) jumps++
  }
  if (mid <= 0.15 * n && jumps > 0) return 'blink'
  if (mid >= 0.3 * n && jumps === 0 && bins.size >= 4 && Math.max(...bins.values()) < 0.5 * mid) return 'fade'
  return null
}

/** The observed shape of an emitter's blinking: 'blink' (on / off), 'fade' (glides through many levels), null = not told. */
export function blinkShape(tr: EmitterTrack | undefined): BlinkShape | null {
  return tr?.shape ?? null
}

/** Its on-current averaged a switching (PWM) current within the window: it follows the duty. */
function pwmRecently(tr: EmitterTrack | undefined, now: number): boolean {
  return !!tr && now - tr.pwmAt <= BLINK_WINDOW_S
}

function track(h: ExplainHistory, key: string, light: number, current: number | undefined, time: number, averaged = false): void {
  let tr = h.emitters.get(key)
  if (!tr) {
    tr = {
      lit: light >= LIT_LIGHT,
      flips: [],
      on: [],
      onStale: false,
      at: time,
      dt: 0,
      dtMax: 0,
      lastFlip: -Infinity,
      carryUntil: null,
      carryGap: 0,
      levels: [],
      pwmAt: -Infinity,
      shape: null,
    }
    h.emitters.set(key, tr)
  } else if (time > tr.at) {
    tr.dt = time - tr.at
    tr.at = time
  }
  const lit = tr.lit ? light >= UNLIT_LIGHT : light >= LIT_LIGHT
  if (lit !== tr.lit) {
    tr.lit = lit
    tr.lastFlip = time
    // a user action's effect is no blink; the circuit's own flips count
    if (time > h.quietUntil) tr.flips.push(time)
    if (tr.carryUntil !== null && tr.carryGap > 0) tr.carryUntil = Math.max(tr.carryUntil, time + tr.carryGap)
  }
  if (tr.carryUntil !== null && time > tr.carryUntil) tr.carryUntil = null
  while (tr.flips.length > 0 && time - tr.flips[0] > BLINK_WINDOW_S) tr.flips.shift()
  if (tr.flips.length > 8) tr.flips.splice(0, tr.flips.length - 8)
  // the widest sampling step while flips are remembered (a period shorter than a few of them would alias)
  tr.dtMax = tr.flips.length > 0 ? Math.max(tr.dtMax, tr.dt) : tr.dt
  if (lit && typeof current === 'number' && Number.isFinite(current)) {
    if (tr.onStale) {
      tr.on = []
      tr.onStale = false
    }
    tr.on.push({ t: time, i: Math.abs(current) })
  }
  // the whole window (a breathing LED's 最亮 is its peak, which a short tail of dense samples — a slowed-down
  // world — would miss), bounded like the brightness samples
  while (tr.on.length > 0 && (time - tr.on[0].t > BLINK_WINDOW_S || tr.on.length > SHAPE_MAX)) tr.on.shift()
  if (averaged) tr.pwmAt = time
  // the brightness samples (one per simulated moment: a repeated snapshot is no new sample) and the shape they tell
  const last = tr.levels[tr.levels.length - 1]
  if (!last || time > last.t) tr.levels.push({ t: time, l: Number.isFinite(light) ? light : 0 })
  while (tr.levels.length > 0 && (time - tr.levels[0].t > BLINK_WINDOW_S || tr.levels.length > SHAPE_MAX)) tr.levels.shift()
  // told only once the window holds a whole cycle (the flips that make it blink): half a cycle of a staircase
  // reads as two levels. An ambiguous stretch keeps the shape told before; an emitter no longer blinking forgets it.
  const shape = tr.flips.length >= BLINK_FLIPS ? shapeOf(tr.levels) : null
  if (shape) tr.shape = shape
  else if (tr.flips.length < BLINK_FLIPS && tr.carryUntil === null) tr.shape = null
}

/** A user action reaches the history at the first snapshot after it (noteUserAction). */
function applyAction(h: ExplainHistory, time: number): void {
  h.action = false
  const step = Number.isFinite(h.time) && time > h.time ? time - h.time : 0
  h.quietUntil = time + Math.max(ACTION_QUIET_S, 2 * step)
  for (const tr of h.emitters.values()) {
    if (isBlinking(tr, h.time)) {
      // from its last flip: a knob held still on a stopped blinker lets it lapse
      tr.carryGap = carryGapOf(tr)
      const until = tr.lastFlip + tr.carryGap
      tr.carryUntil = tr.carryGap > 0 && until >= h.time ? until : null
    } else tr.carryUntil = null
    tr.flips = []
    tr.onStale = true
    // the samples belong to the circuit as it was (a knob may change the shape); the shape told carries
    tr.levels = []
  }
}

/**
 * One telemetry snapshot into the history: each LED-like emitter's lit
 * state (hysteresis LIT_LIGHT / UNLIT_LIGHT) and flips, and the MCU pins'
 * toggling (circuitActivity). A clock that went back = a new session. A
 * burned emitter has no track (burning is no flip; the new part 換新 puts in
 * starts a fresh one).
 */
export function observeTelemetry(h: ExplainHistory, layout: CircuitLayout, tele: SimTelemetry): void {
  if (tele.time < h.time) {
    const uart = h.uart
    const action = h.action
    Object.assign(h, newExplainHistory())
    // a frame of the new session may have reported its bytes already
    h.uart = uart && uart.at <= tele.time ? uart : null
    h.action = action
  }
  if (h.action) applyAction(h, tele.time)
  h.time = tele.time
  for (const comp of layout.components) {
    const ct = tele.components[comp.id]
    if (!ct) continue
    if (typeof ct.light === 'number') {
      if (ct.burned === true || ct.damage?.kind === 'burned') h.emitters.delete(comp.id)
      else track(h, comp.id, ct.light, ct.current, tele.time, isAveragedLed(ct))
    } else if (typeof ct.sounding === 'boolean') {
      // a buzzer: sounding ↔ silent flips the same way (beeping by itself = 「嗶嗶響」; a tone faster than the
      // readings can follow = 「在響」, never 「不響」 between two samples)
      track(h, comp.id, ct.sounding ? 1 : 0, ct.current, tele.time)
    }
    if (ct.sub) {
      for (const [sid, st] of Object.entries(ct.sub)) {
        if (isPowerIndicator(sid) || typeof st.light !== 'number') continue
        const key = `${comp.id}/${sid}`
        if (st.burned === true || st.damage?.kind === 'burned') h.emitters.delete(key)
        else track(h, key, st.light, st.current, tele.time, isAveragedLed(st))
      }
    }
  }
  h.activity = circuitActivity(layout, tele, h.levels, h.toggled, h.changes)
}

/** Flips inside the window ending at `now`. */
function flipsIn(tr: EmitterTrack, now: number): number[] {
  return tr.flips.filter((f) => now - f <= BLINK_WINDOW_S)
}

/**
 * The emitter blinks: BLINK_FLIPS flips the circuit made by itself within
 * BLINK_WINDOW_S (on → off → on: it repeats), or it was blinking when the
 * learner acted and keeps flipping (carryUntil).
 */
export function isBlinking(tr: EmitterTrack | undefined, now: number): boolean {
  if (!tr) return false
  return flipsIn(tr, now).length >= BLINK_FLIPS || (tr.carryUntil !== null && now <= tr.carryUntil)
}

/** The observed blink period (s) — from PERIOD_FLIPS flips, never shorter than the sampling can tell; else null. */
/**
 * An observed period, calm (persona fix: a steady 1 s blink read 「1.04 s」,
 * 「981 ms」, 「998 ms」 by turns — more precision than three flips timed from
 * 10 Hz readings have): from 0.5 s one decimal in s (「約每 1.0 s」), from
 * 10 s whole seconds, below 0.5 s two significant digits (「約每 250 ms」).
 */
export function fmtPeriod(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return fmtSpan(seconds)
  if (seconds >= 9.95) return `${Math.round(seconds)} s`
  if (seconds >= 0.495) return `${seconds.toFixed(1)} s`
  const ms = seconds * 1000
  return ms >= 1 ? `${Number(ms.toPrecision(2))} ms` : `${Number((ms * 1000).toPrecision(2))} µs`
}

export function blinkPeriod(tr: EmitterTrack | undefined, now: number): number | null {
  if (!tr) return null
  const f = flipsIn(tr, now)
  const n = f.length
  if (n < PERIOD_FLIPS) return null
  // whole cycles between flips of the same direction (on → on)
  const cycles = Math.floor((n - 1) / 2)
  const period = (f[n - 1] - f[n - 1 - 2 * cycles]) / cycles
  if (!(period > 0) || period < PERIOD_SAMPLES * tr.dtMax) return null
  return period
}

/**
 * A buzzer's on / off is a beep the readings can follow: at least four flips
 * in the window, each at least one and a half sampling steps after the last
 * (its sounding is an instant reading, so a tone or PWM faster than the
 * samples flips at random, often one sample apart — that is 「在響」).
 */
function isBeeping(tr: EmitterTrack | undefined, now: number): boolean {
  if (!tr) return false
  const f = flipsIn(tr, now)
  if (f.length < BLINK_FLIPS + 1) return false
  for (let k = 1; k < f.length; k++) if (f[k] - f[k - 1] < 1.5 * tr.dtMax) return false
  return true
}

/**
 * 「LED1 在閃，約每 1.00 s 一次：亮時 9.70 mA」 (on / off), 「LED1 漸亮漸暗，週
 * 期約 2 s：最亮 4.00 mA」 (it glides through many levels: a breathing LED is
 * no blink), 「LED1 一明一暗…」 while the shape is not told — the
 * period and the current only when given (a lesson's answer is not).
 */
function blinkWords(id: string, shape: BlinkShape | null, periodS: number | null, on: number | null): string {
  const period = periodS !== null ? fmtPeriod(periodS) : null
  const current = on !== null ? fmtCurrent(on) : null
  if (shape === 'blink') {
    if (current !== null) {
      return period !== null
        ? t('{id} is blinking about every {period}: {current} while on|explain', { id, period, current })
        : t('{id} is blinking: {current} while on|explain', { id, current })
    }
    return period !== null ? t('{id} is blinking about every {period}|explain', { id, period }) : t('{id} is blinking|explain', { id })
  }
  if (shape === 'fade') {
    if (current !== null) {
      return period !== null
        ? t('{id} fades up and down about every {period}: {current} at its brightest|explain', { id, period, current })
        : t('{id} fades up and down: {current} at its brightest|explain', { id, current })
    }
    return period !== null ? t('{id} fades up and down about every {period}|explain', { id, period }) : t('{id} fades up and down|explain', { id })
  }
  if (current !== null) {
    return period !== null
      ? t('{id} goes bright and dark about every {period}: {current} at its brightest|explain', { id, period, current })
      : t('{id} goes bright and dark: {current} at its brightest|explain', { id, current })
  }
  return period !== null ? t('{id} goes bright and dark about every {period}|explain', { id, period }) : t('{id} goes bright and dark|explain', { id })
}

/** The current while lit (A): the highest eye-mean sample of its on-phases in the window (edges read lower). */
function onCurrent(tr: EmitterTrack | undefined): number | null {
  if (!tr || tr.on.length === 0) return null
  return Math.max(...tr.on.map((x) => x.i))
}

// ---------------------------------------------------------------------------
// lessons: what the active step asks the learner to measure
// ---------------------------------------------------------------------------

/** The net a lesson's pin ref sits on (the rule check's graph — the nets the card's voltages are read from); null when unknown. */
function netOfRef(layout: CircuitLayout, ref: PinRef): string | null {
  const c = circuitOf(layout)
  if (!c) return null
  try {
    if ('component' in ref) {
      const part = c.byId.get(ref.component)
      const i = part ? part.entry.pins.indexOf(ref.pin) : -1
      if (part && i >= 0 && part.nets[i]) return part.nets[i]
      return c.netlist.netOf(`${ref.component}:${ref.pin}`)
    }
    return c.netlist.netOf('terminal' in ref ? ref.terminal : ref.hole)
  } catch {
    return null
  }
}

/**
 * The values a lesson step's check asks the learner to measure (its
 * 'measure' checks, also inside 'all'), as the card must not print them:
 * a current / an LED brightness → that part; a voltage → that net; a
 * frequency / a duty → timing. Null when the step measures nothing.
 */
export function lessonSecrets(check: LessonCheck | null | undefined, layout: CircuitLayout): ExplainSecrets | null {
  const current: string[] = []
  const nets: string[] = []
  let timing = false
  const walk = (c: LessonCheck | null | undefined): void => {
    if (!c) return
    if (c.kind === 'all') {
      for (const sub of c.checks) walk(sub)
      return
    }
    if (c.kind !== 'measure') return
    if (c.quantity === 'current' || c.quantity === 'led-brightness') {
      const id = c.component ?? ('component' in c.at ? c.at.component : null)
      if (id && !current.includes(id)) current.push(id)
    } else if (c.quantity === 'voltage') {
      const net = netOfRef(layout, c.at)
      if (net && !nets.includes(net)) nets.push(net)
    } else timing = true
  }
  walk(check)
  return current.length > 0 || nets.length > 0 || timing ? { current, nets, timing } : null
}

/** Part `id`'s current / brightness is what the learner is measuring right now. */
function hidesCurrent(input: ExplainInput, id: string): boolean {
  return input.secrets?.current.includes(id) ?? false
}

/** The voltage of `net` is what the learner is measuring right now. */
function hidesNet(input: ExplainInput, net: string | null | undefined): boolean {
  return !!net && (input.secrets?.nets.includes(net) ?? false)
}

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

type OutputKind = 'led' | 'rgb' | 'seg' | 'buzzer' | 'motor' | 'display'

function outputKind(entry: CatalogEntry | undefined): OutputKind | null {
  if (!entry || entry.mcu) return null
  const model = entry.sim.kind === 'device' ? entry.sim.model : ''
  if (model === 'led') return 'led'
  if (model === 'rgb_led') return 'rgb'
  if (model === 'seven_segment') return 'seg'
  if (model === 'buzzer') return 'buzzer'
  if (entry.category === 'motor' && !/_(board|module|driver)$/.test(entry.type)) return 'motor'
  if (entry.category === 'display') return 'display'
  return null
}

/** 「LED1 不亮」 (running) / 「LED1 不會亮」 (before a run: a prediction from the rule check). */
function offWords(kind: OutputKind, id: string, live: boolean): string {
  switch (kind) {
    case 'buzzer':
      return live ? t('{id} is silent|explain', { id }) : t('{id} cannot sound|explain', { id })
    case 'motor':
      return live ? t('{id} is not turning|explain', { id }) : t('{id} cannot turn|explain', { id })
    case 'display':
      return live ? t('{id} shows nothing|explain', { id }) : t('{id} cannot show anything|explain', { id })
    default:
      return live ? t('{id} is dark|explain', { id }) : t('{id} cannot light|explain', { id })
  }
}

/**
 * A name inserted into a line keeps its own spacing (「上方 − 電源軌 第 20 孔」 —
 * the hole chip's words) when the line is tidied: its spaces travel as NBSP.
 */
function asName(name: string): string {
  return name.replace(/ /g, ' ')
}

function withCause(what: string, cause: string | null): string {
  return cause ? t('{what}: {cause}|explain', { what, cause }) : what
}

const NO_PARTS: CircuitLayout = { version: 1, components: [], wires: [] }

/** A hole as a person reads it: a rail hole by the hole chip's rail words (「下方 + 電源軌 第 3 孔」), a strip hole as it is (「c20」). */
function holeName(hole: string): string {
  return parseHole(hole)?.kind === 'rail' ? endpointName(NO_PARTS, hole) : hole
}

/** 「R1 330 Ω」 — the resistance param in the inspector's own format. */
function resistorText(r: { id: string; ohms: number }): string {
  return `${r.id} ${fmtEng(r.ohms, 'Ω')}`
}

/** 「每分鐘 1240 轉」 (「1240 rpm」) — telemetry's speed in whole revolutions per minute. */
function fmtRpm(rpm: number): string {
  return t('{n} rpm|explain', { n: Math.round(Math.abs(rpm)) })
}

/** A part pin in the H1 short form: 「U1 PA5」, 「LED1 陰極」. */
function pinName(layout: CircuitLayout, id: string, pin: string): string {
  const entry = getEntry(layout.components.find((c) => c.id === id)?.type ?? '')
  return entry ? pinLabel(entry, pin, { id, form: 'short' }) : `${id} ${pin}`
}

/** A pin of the subject itself, without its id: 「陰極」. */
function ownPinName(entry: CatalogEntry | undefined, pin: string): string {
  return entry ? pinLabel(entry, pin, { form: 'short' }) : pin
}

/**
 * What drives a path end, as a person reads it: 「5.00 V」 (measured, else
 * the ERC's nominal), 「U1 PA5」, 「FG1 輸出端」 — a rail whose voltage the
 * lesson step asks the learner to measure by the part that sets it (「PS1」).
 */
function sourceText(input: ExplainInput, end: PathEnd): string | null {
  const { layout, telemetry: tele } = input
  if (end.kind === 'rail') {
    if (hidesNet(input, end.net)) return end.partId ?? null
    const measured = tele?.netVoltages[end.net]
    if (isTrustedVoltage(measured) && measured > 0) return fmtVoltage(measured)
    return Number.isFinite(end.v) && end.v > 0 ? fmtVoltage(end.v) : null
  }
  if (!end.partId || !end.pin) return null
  if (end.kind === 'sig') return terminalLabel(`${end.partId}:${end.pin}`, layout)
  return pinName(layout, end.partId, end.pin)
}

/** The fix sentence of a problem's explanation (its last sentence that is not a note about hidden readings). */
function detailFix(p: Problem | undefined): string | null {
  if (!p) return null
  const sentences = p.detail
    .split(/(?<=[。！？])|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[。.]$/, ''))
    .filter(Boolean)
  const usable = sentences.filter((s) => !/讀數|readings/.test(s))
  return usable[usable.length - 1] ?? null
}

/** The ERC's resistor advice for LED `id`: 'about' (none in series) / 'at least' (too small) and the value it computed. */
function resistorAdvice(findings: readonly ErcFinding[] | undefined, id: string): { kind: 'about' | 'at least'; r: string } | null {
  const f = findings?.find((x) => x.rule === 'led-current' && x.componentIds[0] === id && RESISTOR_ADVICE.test(x.message))
  const m = f ? RESISTOR_ADVICE.exec(f.message) : null
  return m ? { kind: m[1] as 'about' | 'at least', r: m[2] } : null
}

/**
 * The current a burned LED carried when it burned (A), from the simulator's
 * issue; null when not reported, or when it is no reading (above 2 A — an LED
 * straight across a stiff supply makes the solver's number meaningless).
 */
export function burnCurrentOf(issues: readonly SimIssue[] | null | undefined, id: string): number | null {
  for (const iss of issues ?? []) {
    const m = BURN_ISSUE.exec(iss?.message ?? '')
    if (!m || m[1] !== id) continue
    const i = parseFloat(m[2]) * 1e-3
    return Number.isFinite(i) && !isShortCircuitCurrent(i) ? i : null
  }
  return null
}

function ratedOf(entry: CatalogEntry | undefined): number {
  const ifMax = entry?.ratings?.ifMax
  return typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_LIGHT_RATED_A
}

/** A power rating as authored: 「250 mW」, 「1 W」. */
function fmtRatedPower(w: number): string {
  return fmtPower(w).replace(/\.0+(?=\s)/, '').replace(/(\.\d*?)0+(?=\s)/, '$1')
}

// ---------------------------------------------------------------------------
// subjects
// ---------------------------------------------------------------------------

interface Subject {
  tier: number
  id: string
  state: string
  tone: ExplainTone
  /** a board-state dot (H6) instead of the tone's */
  dot?: string
  line1: string
  /** the fix / outcome (P0–P4), or the drive path (P5) */
  line2?: string | null
  /** the problem behind it (its fix sentence is line 2's fallback) */
  problem?: Problem
  /** aggregation group ('lit', 'blink', 'fade', 'pulse', 'turning', 'off', 'dim') and the amount it ranges over (A) */
  group?: string
  amount?: number | null
  /** stable order inside a tier: layout order, MCU activity after the learner's outputs */
  order: number
  ids?: string[]
}

const TONE_DOT: Readonly<Record<ExplainTone, string>> = {
  ok: TONE_COLOR.green,
  info: TONE_COLOR.neutral,
  warning: TONE_COLOR.orange,
  error: TONE_COLOR.red,
  paused: stateColor('paused'),
  idle: stateColor('idle'),
}

const BLOCKER_STATE: Readonly<Record<BoardBlockerKind, ToneState>> = {
  power: 'unpowered',
  'fw-missing': 'no-firmware',
  lockup: 'lockup',
  halt: 'halted',
  boot0: 'boot-sysmem',
}

/** The problems naming part `id`, without the findings only a run can confirm (「執行後確認」). */
function rowsAbout(problems: readonly Problem[], id: string): Problem[] {
  return problems.filter((p) => !p.pendingRuntime && p.componentIds.includes(id))
}

interface Cause {
  /** 「陰極（a38）沒有接地」; null = a problem names it but no cause word fits */
  cause: string | null
  line2?: string | null
  problem?: Problem
  /** the driving board's state colour (H6) when its state is the cause */
  dot?: string
}

/** Why output `id` (dark / silent / still) does nothing: the problems naming it, its neighbours or its driver. */
function causeOf(input: ExplainInput, id: string, entry: CatalogEntry | undefined, path: DrivePath | null): Cause | null {
  const { layout, problems } = input
  const raw = (p: Problem) => input.findings?.find((f) => `erc:${f.id}` === p.id)
  // a lead in a rail no supply feeds (the ERC's wording; its row lists the rail's holes too)
  const floatingRail = (p: Problem) => /no supply feeds that rail/.test(raw(p)?.message ?? '') || p.holes.length > 1
  const fixFor = (p: Problem, hole: string | undefined, floating = false): string | null => {
    const to = p.fixHoles?.[0]
    if (!hole || !to) return null
    // a rail no supply feeds: the wire joins that rail (any hole) to a fed one
    const from = floating ? holeName(hole) : endpointName(layout, hole)
    return t('Wire {from} to {to}|explain', { from: asName(from), to: asName(endpointName(layout, to)) })
  }
  const own = rowsAbout(problems, id)
  for (const p of own) {
    if (p.id === `erc:led-current:${id}:shorted`) {
      return { cause: t('both of its leads are in one strip, so it is shorted|explain'), line2: t('Move one of its leads to another strip|explain'), problem: p }
    }
    if (p.fact === `reversed:${id}`) {
      return { cause: t('its leads are plugged in the wrong way round|explain'), line2: t('Swap the two leads of {id} (the long lead is the anode)|explain', { id }), problem: p }
    }
    if (p.id === `erc:open-lead:${id}:both`) {
      return { cause: t('none of its leads is wired yet|explain'), line2: t('Wire both leads of {id} into the circuit|explain', { id }), problem: p }
    }
    const lead = p.id.startsWith(`erc:open-lead:${id}:`) ? p.id.slice(`erc:open-lead:${id}:`.length) : null
    if (lead) {
      const hole = p.holes[0]
      const word = ownPinName(entry, lead)
      const floating = floatingRail(p)
      const cause = floating
        ? t('the rail its {pin} goes to has no supply|explain', { pin: word })
        : lead === 'cathode' && hole
          ? t('the cathode row ({hole}) does not reach ground|explain', { hole: holeName(hole) })
          : t('{pin} ({hole}) is connected to nothing|explain', { pin: word, hole: hole ? holeName(hole) : '—' })
      return { cause, line2: fixFor(p, hole, floating), problem: p }
    }
    if (p.rule === 'rail-unpowered') return { cause: t('the rail it is on has no supply|explain'), problem: p }
    if (p.rule === 'gpio-mode' && p.componentIds[0] === id) {
      const m = /^erc:gpio-mode:([^:]+):(.+)$/.exec(p.id)
      if (m) return { cause: t('the pin that drives it, {pin}, is not an output|explain', { pin: pinName(layout, m[1], m[2]) }), problem: p }
    }
  }
  // a neighbour's open lead (a resistor whose far lead goes nowhere) or the rail a neighbour sits on
  for (const nb of path?.neighbors ?? []) {
    for (const p of rowsAbout(problems, nb)) {
      const lead = p.id.startsWith(`erc:open-lead:${nb}:`) ? p.id.slice(`erc:open-lead:${nb}:`.length) : null
      if (lead && lead !== 'both') {
        const hole = p.holes[0]
        const pin = pinName(layout, nb, lead)
        const floating = floatingRail(p)
        const cause = floating
          ? t('the rail {pin} goes to has no supply|explain', { pin })
          : t('{pin} ({hole}) is connected to nothing|explain', { pin, hole: hole ? holeName(hole) : '—' })
        return { cause, line2: fixFor(p, hole, floating), problem: p }
      }
      if (p.rule === 'rail-unpowered') return { cause: t('the rail it is on has no supply|explain'), problem: p }
    }
  }
  // the board driving it is blocked (no power, no firmware, a lockup, a halt, BOOT0 = 1)
  for (const end of [path?.up, path?.down]) {
    if (!end || end.kind !== 'gpio' || !end.partId) continue
    const b = boardBlocker(end.partId, problems)
    if (!b) continue
    const board = end.partId
    const cause =
      b.kind === 'power'
        ? t('the {board} that drives it has no power|explain', { board })
        : b.kind === 'fw-missing'
          ? t('the {board} that drives it has no firmware|explain', { board })
          : b.kind === 'lockup'
            ? t('the {board} that drives it is locked up|explain', { board })
            : b.kind === 'halt'
              ? t('the {board} that drives it is halted by the debugger|explain', { board })
              : t('the {board} that drives it boots from system memory|explain', { board })
    return { cause, line2: b.kind === 'fw-missing' ? t('Load firmware into {id}|explain', { id: board }) : null, problem: b.problem, dot: stateColor(BLOCKER_STATE[b.kind]) }
  }
  // a problem about it whose cause has no word here: its own fix sentence
  const named = own.find((p) => p.componentIds[0] === id && !p.state && p.rule !== 'led-current')
  return named ? { cause: null, problem: named } : null
}

/**
 * A dark LED's (a silent buzzer's) benign reason: an open switch on every
 * path, the driving pin at its off level, a transistor that does not conduct
 * — 「LED1 沒亮：…」, a buzzer 「BZ1 不響：…」 (it never lights).
 */
function benignOf(input: ExplainInput, id: string, kind: OutputKind, path: DrivePath | null): Omit<Subject, 'id' | 'order'> | null {
  if (!path) return null
  const { layout, telemetry } = input
  const buzzer = kind === 'buzzer'
  const sw = path.open[0]
  if (sw) {
    const type = layout.components.find((c) => c.id === sw)?.type
    const push = type === 'pushbutton'
    return {
      tier: TIER.benign,
      state: `open:${sw}`,
      tone: 'info',
      line1: push
        ? buzzer
          ? t('{id} is silent: {sw} is not pressed, so the circuit is open|explain', { id, sw })
          : t('{id} is off: {sw} is not pressed, so the circuit is open|explain', { id, sw })
        : buzzer
          ? t('{id} is silent: {sw} is switched open|explain', { id, sw })
          : t('{id} is off: {sw} is switched open|explain', { id, sw }),
      line2: push ? t('Hold {id} down to close the circuit|explain', { id: sw }) : t('Flip {id} to close the circuit|explain', { id: sw }),
      group: kind === 'led' ? 'off' : undefined,
      ids: [id, sw],
    }
  }
  // the pin driving the anode is low (or the one sinking the cathode is high): measured, never assumed
  for (const [end, offHigh] of [
    [path.up, false],
    [path.down, true],
  ] as const) {
    if (!end || (end.kind !== 'gpio' && end.kind !== 'out') || !end.partId || !end.pin) continue
    const v = telemetry?.components[end.partId]?.pinVoltages?.[end.pin]
    if (!isTrustedVoltage(v)) continue
    const vdd = end.kind === 'gpio' ? 3.3 : Number.isFinite(end.v) && end.v > 0 ? end.v : 5
    const level = v > vdd * 0.6 ? 1 : v < vdd * 0.3 ? 0 : -1
    if (level < 0 || (level === 1) !== offHigh) continue
    const pin = pinName(layout, end.partId, end.pin)
    return {
      tier: TIER.benign,
      state: `level:${end.partId}:${end.pin}`,
      tone: 'info',
      line1: buzzer
        ? offHigh
          ? t('{id} is silent: {pin} outputs high|explain', { id, pin })
          : t('{id} is silent: {pin} outputs low|explain', { id, pin })
        : offHigh
          ? t('{id} is off: {pin} outputs high|explain', { id, pin })
          : t('{id} is off: {pin} outputs low|explain', { id, pin }),
      group: kind === 'led' ? 'off' : undefined,
      ids: [id, end.partId],
    }
  }
  // all of its current goes through a transistor: no current = the transistor is off (a fact of the
  // series path, not a guess) — and what would turn it on, when the circuit says so
  const gate = path.gates[0]
  if (gate) {
    const q = gate.id
    const sw = gate.open[0]
    let line2: string | null = null
    if (sw) {
      const push = layout.components.find((c) => c.id === sw)?.type === 'pushbutton'
      line2 = push ? t('Hold {sw} down and {q} turns on|explain', { sw, q }) : t('Flip {sw} and {q} turns on|explain', { sw, q })
    } else if (gate.driver?.partId && gate.driver.pin && (gate.driver.kind === 'gpio' || gate.driver.kind === 'out')) {
      const v = telemetry?.components[gate.driver.partId]?.pinVoltages?.[gate.driver.pin]
      const vdd = gate.driver.kind === 'gpio' ? 3.3 : Number.isFinite(gate.driver.v) && gate.driver.v > 0 ? gate.driver.v : 5
      if (isTrustedVoltage(v) && v < vdd * 0.3) line2 = t('{pin} that drives it outputs low|explain', { pin: pinName(layout, gate.driver.partId, gate.driver.pin) })
    }
    return {
      tier: TIER.benign,
      state: `gate:${q}`,
      tone: 'info',
      line1: buzzer ? t('{id} is silent: {q} is not conducting|explain', { id, q }) : t('{id} is off: {q} is not conducting|explain', { id, q }),
      line2,
      group: kind === 'led' ? 'off' : undefined,
      ids: [id, q, ...(sw ? [sw] : [])],
    }
  }
  return null
}

/** Nothing limits the current on the LED's path (no resistor, no pot / LDR): the advice is to add one. */
function unlimited(path: DrivePath | null): boolean {
  return !!path?.up && path.resistors.length === 0 && path.limiters.length === 0
}

/**
 * Line 2 of a burned LED: the ERC's resistor value — 「串一顆約 …」 when none
 * is in series, 「改用至少 …」 when the one in series is too small —, else
 * 「串一顆限流電阻」 when nothing limits it, else 〔換新〕.
 */
function burnedFix(input: ExplainInput, id: string, path: DrivePath | null): string {
  const advice = resistorAdvice(input.findings, id)
  if (advice?.kind === 'about') return t('Add a current-limiting resistor of about {r}; once fixed, a new {id} goes in by itself|explain', { r: advice.r, id })
  if (advice) return t('Use a current-limiting resistor of at least {r}; once fixed, a new {id} goes in by itself|explain', { r: advice.r, id })
  if (unlimited(path)) return t('Add a current-limiting resistor; once fixed, a new {id} goes in by itself|explain', { id })
  return t('Press Replace for a new one; fixing the circuit or a value also replaces it|explain')
}

/** Line 2 of an LED drawing too much current (not burned): the ERC's value, else the plain advice. */
function currentFix(input: ExplainInput, id: string, path: DrivePath | null): string {
  const advice = resistorAdvice(input.findings, id)
  if (advice?.kind === 'about') return t('Add a current-limiting resistor of about {r}|explain', { r: advice.r })
  if (advice) return t('Use a current-limiting resistor of at least {r}|explain', { r: advice.r })
  if (unlimited(path)) return t('Add a current-limiting resistor in series|explain')
  return t('Use a larger current-limiting resistor|explain')
}

/** P1 subjects from the part's own model (telemetry) and the simulator's latched pin issues. */
function damageSubjects(input: ExplainInput, out: Subject[]): void {
  const { layout, telemetry } = input
  if (!telemetry) return
  const issues = telemetry.issues ?? []
  layout.components.forEach((comp, order) => {
    const id = comp.id
    const ct: ComponentTelemetry | undefined = telemetry.components[id]
    if (!ct) return
    const entry = getEntry(comp.type)
    const model = entry?.sim.kind === 'device' ? entry.sim.model : ''
    const d = ct.damage
    const add = (state: string, line1: string, line2: string | null) =>
      out.push({ tier: TIER.damage, id, state, tone: 'error', line1, line2, problem: rowsAbout(input.problems, id)[0], order })
    if (model === 'rgb_led' && (ct.burned === true || d?.kind === 'burned')) {
      add('burned', t('{id} has a burned-out die: the current was above the rated {rated}|explain', { id, rated: fmtRatedCurrent(ratedOf(entry)) }), burnedFix(input, id, ledDrivePath(layout, id)))
    } else if (model === 'led' && (ct.burned === true || d?.kind === 'burned')) {
      const rated = fmtRatedCurrent(ratedOf(entry))
      // the burn current is that part's current: never while the learner is asked to measure it
      const i = hidesCurrent(input, id) ? null : burnCurrentOf(issues, id)
      add(
        'burned',
        i !== null
          ? t('{id} burned out: {current} is above the rated {rated}|explain', { id, current: fmtCurrent(i), rated })
          : t('{id} burned out: the current was far above the rated {rated}|explain', { id, rated }),
        burnedFix(input, id, ledDrivePath(layout, id)),
      )
    } else if (model === 'resistor' && d?.kind === 'burned') {
      const pMax = entry?.ratings?.pMax
      add(
        'burned',
        t('{id} burned open: it dissipated far more than its {max} rating|explain', { id, max: typeof pMax === 'number' && pMax > 0 ? fmtRatedPower(pMax) : t('rated|power') }),
        t('Use a larger resistance or a higher-wattage resistor; once fixed, a new {id} goes in by itself|explain', { id }),
      )
    } else if (model === 'capacitor' && d?.kind === 'vented') {
      add('vented', t('{id} vented: it was wired in reverse|explain', { id }), t('Turn {id} around so + goes to the higher voltage; once fixed, a new {id} goes in by itself|explain', { id }))
    } else if (model === 'resistor') {
      // P4: above its power rating but not burned (yet) — the model's own power reading (rules-live's rule)
      const pMax = entry?.ratings?.pMax
      const p = typeof ct.power === 'number' && Number.isFinite(ct.power) && !isShortCircuitCurrent(ct.current) ? Math.abs(ct.power) : NaN
      if (typeof pMax === 'number' && pMax > 0 && p > pMax * 1.0001) {
        out.push({
          tier: TIER.risk,
          id,
          state: 'over-power',
          tone: 'warning',
          line1: t('{id} is running hot: {power}, above its {max} rating|explain', { id, power: fmtPower(p), max: fmtRatedPower(pMax) }),
          line2: t('Use a larger resistance or a higher-wattage resistor|explain'),
          // after an output's own risk (「LED1 亮著，但超過額定」 is what the learner looks at)
          order: layout.components.length + 500 + order,
        })
      }
    }
    // a board's on-board LED its model burned (something drove its pin too hard)
    for (const [sid, st] of Object.entries(ct.sub ?? {})) {
      if (st.burned !== true && st.damage?.kind !== 'burned') continue
      add(`sub-burned:${sid}`, t('{id}’s on-board LED burned out|explain', { id }), t('Check what is wired to that pin; once fixed, a new one goes in by itself|explain'))
      break
    }
    // a bench supply over 2 A: a short
    if (entry?.category === 'power' && isShortCircuitCurrent(ct.current)) {
      const short = input.problems.find((p) => p.rule === 'supply-short' || p.fact === `overcurrent-supply:${id}`)
      out.push({
        tier: TIER.damage,
        id,
        state: 'short',
        tone: 'error',
        line1: t('{id} is shorted: more than 2 A flows|explain', { id }),
        line2: detailFix(short) ?? t('Remove the wire that joins + and − directly|explain'),
        order,
      })
    }
  })
  // a board pin the simulation measured beyond its absolute maximum (latched until a rebuild)
  const order0 = layout.components.length
  pinDamageFromIssues(issues).forEach((d, i) => {
    if (!layout.components.some((c) => c.id === d.componentId)) return
    const pin = pinName(layout, d.componentId, d.pin)
    const over = d.kind === 'overcurrent'
    const ma = parseFloat(d.measured)
    out.push({
      tier: TIER.damage,
      id: d.componentId,
      state: `${d.kind}:${d.pin}`,
      tone: 'error',
      line1: over
        ? t('{pin} draws too much current: {current}, over the 25 mA per pin|explain', { pin, current: Number.isFinite(ma) ? fmtCurrent(ma * 1e-3) : d.measured })
        : t('{pin} is beyond its absolute maximum: {v}|explain', { pin, v: d.measured }),
      line2: over
        ? t('Limit what this pin drives; once the circuit is fixed, the simulation restores it|explain')
        : t('Keep this pin within its supply voltage; once the circuit is fixed, the simulation restores it|explain'),
      order: order0 + i,
    })
  })
}

/** The boards in the layout and what blocks each (null = nothing). */
function boardsOf(input: ExplainInput): { id: string; order: number; blocker: ReturnType<typeof boardBlocker> }[] {
  const out: { id: string; order: number; blocker: ReturnType<typeof boardBlocker> }[] = []
  input.layout.components.forEach((c, order) => {
    if (getEntry(c.type)?.mcu) out.push({ id: c.id, order, blocker: boardBlocker(c.id, input.problems) })
  })
  return out
}

/** P0: the debugger halt (the whole world frozen) and a lockup. */
function sessionSubjects(input: ExplainInput, out: Subject[]): void {
  const { layout, phase, mcus = {}, telemetry, firmware = {} } = input
  layout.components.forEach((c, order) => {
    const state = mcus[c.id]?.state
    if (state === 'halted' && phase === 'halted') {
      const time = telemetry?.time
      out.push({
        tier: TIER.session,
        id: c.id,
        state: 'halted',
        tone: 'warning',
        dot: stateColor('halted'),
        line1:
          typeof time === 'number'
            ? t('The whole simulation stopped at {t}: {id} is halted by the debugger|explain', { t: fmtSimClock(time), id: c.id })
            : t('The whole simulation is stopped: {id} is halted by the debugger|explain', { id: c.id }),
        line2: t('Resume running and the whole circuit carries on from this moment|explain'),
        order,
      })
    } else if (state === 'lockup') {
      const cause = lockupCauseOf(firmware[c.id])
      out.push({
        tier: TIER.session,
        id: c.id,
        state: 'lockup',
        tone: 'error',
        dot: stateColor('lockup'),
        line1: t('{id} locked up: its firmware is not running|explain', { id: c.id }),
        line2: cause ? lockupCauseText(cause) : null,
        problem: input.problems.find((p) => p.fact === `lockup:${c.id}`),
        order,
      })
    }
  })
}

/** Everything the learner built that should do something: its state now (or, before a run, why it will not). */
function outputSubjects(input: ExplainInput, out: Subject[]): void {
  const { layout, telemetry, history } = input
  const live = telemetry !== null
  const now = telemetry?.time ?? 0
  layout.components.forEach((comp, order) => {
    const id = comp.id
    const entry = getEntry(comp.type)
    const kind = outputKind(entry)
    if (!kind) return
    const ct = telemetry?.components[id]
    const path = kind === 'led' || kind === 'buzzer' ? ledDrivePath(layout, id) : null
    const push = (s: Omit<Subject, 'id' | 'order'>) => out.push({ id, order, ...s })
    if (!live) {
      // before a run: only what the rule check already knows
      const c = causeOf(input, id, entry, path)
      if (c) {
        push({ tier: TIER.cause, state: 'static-cause', tone: 'warning', line1: withCause(offWords(kind, id, false), c.cause), line2: c.line2, problem: c.problem, dot: c.dot })
        return
      }
      const risk = kind === 'led' ? rowsAbout(input.problems, id).find((p) => p.rule === 'led-current' && p.level !== 'info') : undefined
      if (risk) {
        const none = unlimited(path)
        push({
          tier: TIER.cause,
          state: 'static-current',
          tone: 'warning',
          line1: none
            ? t('{id} has no current-limiting resistor in series: the current may be too large|explain', { id })
            : t('{id}’s current-limiting resistor is on the small side: the current may exceed its rating|explain', { id }),
          line2: currentFix(input, id, path),
          problem: risk,
        })
      }
      return
    }
    if (!ct) return // not in this snapshot (a part just added): nothing to say yet
    if (ct.burned === true || ct.damage?.kind === 'burned') return // P1 says it
    if (kind === 'led' || kind === 'rgb') {
      const rated = ratedOf(entry)
      const tr = history?.emitters.get(id)
      // the learner is measuring this part's current / brightness: its state, never the number
      const secret = hidesCurrent(input, id)
      if (kind === 'led' && ct.damage?.kind === 'overheating') {
        const i = typeof ct.current === 'number' ? fmtCurrent(Math.abs(ct.current)) : '—'
        push({
          tier: TIER.risk,
          state: 'overheating',
          tone: 'warning',
          line1: secret
            ? t('{id} is overheating: far above the rated {rated}|explain', { id, rated: fmtRatedCurrent(rated) })
            : t('{id} is overheating: {current} is far above the rated {rated}|explain', { id, current: i, rated: fmtRatedCurrent(rated) }),
          line2: t('Junction above 100 °C — {fix}|explain', { fix: currentFix(input, id, path) }),
        })
        return
      }
      if (isBlinking(tr, now)) {
        // on / off, a glide through many levels (a breathing LED), or not told yet (the neutral 「一明一暗」)
        const shape = blinkShape(tr)
        // a frequency / duty step: no period, and no on-current that is a PWM average (it follows the duty);
        // a current step on this part: no on-current
        const timing = input.secrets?.timing === true
        const period = timing ? null : blinkPeriod(tr, now)
        const on = secret || (timing && pwmRecently(tr, now)) ? null : onCurrent(tr)
        const state = shape ?? 'pulse'
        push({ tier: TIER.works, state, tone: 'ok', line1: blinkWords(id, shape, period, on), line2: pathLine(input, path, on), group: state, amount: on })
        return
      }
      const light = typeof ct.light === 'number' ? ct.light : 0
      const lit = tr ? tr.lit : light >= LIT_LIGHT
      if (lit) {
        const average = isAveragedLed(ct)
        const current = kind === 'rgb' ? light * rated : ct.current
        const parts = ledLightParts(ct.light, current, { rated, average })
        // a PWM LED's average brightness follows the duty: not while a duty / frequency is the answer
        const quiet = secret || (average && input.secrets?.timing === true)
        if (isOverRated(light) && parts.over) {
          push({
            tier: TIER.risk,
            state: 'over',
            tone: 'warning',
            line1: quiet ? t('{id} is lit but {over}|explain', { id, over: parts.over }) : t('{id} is lit but {over}: brightness {value}|explain', { id, over: parts.over, value: parts.value }),
            line2: currentFix(input, id, path),
          })
          return
        }
        const small = kind === 'led' && rowsAbout(input.problems, id).some((p) => p.rule === 'led-current' && p.level === 'warning') && resistorAdvice(input.findings, id)?.kind === 'at least'
        if (small) {
          push({ tier: TIER.risk, state: 'small', tone: 'warning', line1: t('{id} is lit, but its current-limiting resistor is on the small side|explain', { id }), line2: currentFix(input, id, path) })
          return
        }
        const measured = typeof current === 'number' && Number.isFinite(current) ? Math.abs(current) : null
        // a hidden reading never reaches an aggregate's range (「另外 LED2 也亮著（8.10 mA）」)
        const amount = quiet ? null : measured
        push({
          tier: TIER.works,
          state: average ? 'pwm' : 'lit',
          tone: 'ok',
          line1: quiet
            ? average
              ? t('{id} is lit (PWM)|explain', { id })
              : t('{id} is lit|explain', { id })
            : average
              ? t('{id} is lit (PWM): brightness {value}|explain', { id, value: parts.value })
              : t('{id} is lit: brightness {value}|explain', { id, value: parts.value }),
          line2: pathLine(input, path, measured),
          group: 'lit',
          amount,
        })
        return
      }
      // below the cheer's 1 mA but conducting: it glows faintly (the 3D LED shows it), the inspector's own words
      if (light >= DIM_LIGHT) {
        const current = kind === 'rgb' ? light * rated : ct.current
        const average = isAveragedLed(ct)
        const parts = ledLightParts(ct.light, current, { rated, average })
        const quiet = secret || (average && input.secrets?.timing === true)
        const measured = typeof current === 'number' && Number.isFinite(current) ? Math.abs(current) : null
        push({
          tier: TIER.benign,
          state: 'dim',
          tone: 'info',
          line1: quiet ? t('{id} glows only faintly|explain', { id }) : t('{id} glows only faintly: brightness {value}|explain', { id, value: parts.value }),
          line2: pathLine(input, path, measured),
          group: 'dim',
          amount: quiet ? null : measured,
        })
        return
      }
      darkSubject(input, id, kind, entry, path, ct, push)
      return
    }
    if (kind === 'seg') {
      const on = Object.values(ct.segments ?? {}).filter(Boolean).length
      if (on > 0) push({ tier: TIER.works, state: 'lit', tone: 'ok', line1: t('{id} is lit: {n} segments on|explain', { id, n: on }), group: 'lit', amount: null })
      else darkSubject(input, id, kind, entry, path, ct, push)
      return
    }
    if (kind === 'buzzer') {
      const tr = history?.emitters.get(id)
      if (isBlinking(tr, now)) {
        // it switches on and off by itself: a beep the readings follow (its period — not while a frequency /
        // duty is the answer), else a tone / PWM faster than the readings: it sounds, never 「不響」 between samples
        if (isBeeping(tr, now)) {
          const period = input.secrets?.timing ? null : blinkPeriod(tr, now)
          push({
            tier: TIER.works,
            state: 'beep',
            tone: 'ok',
            line1: period !== null ? t('{id} is beeping about every {period}|explain', { id, period: fmtPeriod(period) }) : t('{id} is beeping|explain', { id }),
          })
        } else push({ tier: TIER.works, state: 'sounding', tone: 'ok', line1: t('{id} is sounding|explain', { id }) })
      } else if (ct.sounding === true) push({ tier: TIER.works, state: 'sounding', tone: 'ok', line1: t('{id} is sounding|explain', { id }) })
      else darkSubject(input, id, kind, entry, path, ct, push)
      return
    }
    if (kind === 'motor') {
      const rpm = ct.values?.rpm
      if (typeof rpm === 'number' && Math.abs(rpm) >= TURNING_RPM) {
        push({ tier: TIER.works, state: 'turning', tone: 'ok', line1: t('{id} is turning: {rpm}|explain', { id, rpm: fmtRpm(rpm) }), group: 'turning', amount: null })
      } else darkSubject(input, id, kind, entry, path, ct, push)
      return
    }
    // a display module: its picture, an addressable strip's lit pixels
    const showing = ct.display?.on === true || (Array.isArray(ct.rgb) && ct.rgb.some((x) => (x & 0xffffff) !== 0)) || Object.values(ct.segments ?? {}).some(Boolean)
    if (showing) push({ tier: TIER.works, state: 'showing', tone: 'ok', line1: t('{id} shows a picture|explain', { id }) })
    else darkSubject(input, id, kind, entry, path, ct, push)
  })
}

/**
 * 「由 5.00 V 經 R1 330 Ω 供電」 — the lit LED's path: the source measured,
 * resistors with their params, other limits (a pot, an LDR) and transistors
 * by name only (「經 R2 330 Ω、Q1」); 「直接由 …」 only when nothing is in series.
 */
function pathLine(input: ExplainInput, path: DrivePath | null, current: number | null = null): string | null {
  if (!path?.up) return null
  const source = sourceText(input, path.up)
  if (!source) return null
  // the path the rule check sees must be able to carry what the LED measurably draws — else the graph misses
  // the real one (a part it does not model, e.g. a MOSFET with a voltmeter across it) and nothing is said
  const across = path.up.v - (path.down && Number.isFinite(path.down.v) ? path.down.v : 0)
  const v = Number.isFinite(across) && across > 0 ? across : 5
  if (current !== null && current > 0 && path.r > 0 && v / path.r < current * 0.5) return null
  const fed = path.up.kind === 'rail'
  const through = [...path.resistors.map(resistorText), ...path.limiters, ...path.transistors]
  if (through.length === 0) return fed ? t('Fed straight from {source}|explain', { source }) : t('Driven straight by {source}|explain', { source })
  const resistors = (through.length > 3 ? [...through.slice(0, 3), '…'] : through).join(t(', |explain'))
  return fed ? t('Fed from {source} through {resistors}|explain', { source, resistors }) : t('Driven by {source} through {resistors}|explain', { source, resistors })
}

/** A dark / silent / still output while running: a known cause (P3), a benign reason (P5b), else nothing found (P6, LEDs). */
function darkSubject(
  input: ExplainInput,
  id: string,
  kind: OutputKind,
  entry: CatalogEntry | undefined,
  path: DrivePath | null,
  ct: ComponentTelemetry,
  push: (s: Omit<Subject, 'id' | 'order'>) => void,
): void {
  const c = causeOf(input, id, entry, path)
  if (c) {
    push({ tier: TIER.cause, state: 'cause', tone: 'warning', line1: withCause(offWords(kind, id, true), c.cause), line2: c.line2, problem: c.problem, dot: c.dot })
    return
  }
  const benign = kind === 'led' || kind === 'buzzer' ? benignOf(input, id, kind, path) : null
  if (benign) {
    push(benign)
    return
  }
  if (kind !== 'led') return // a still motor / quiet buzzer / blank display with no cause is not news
  // the measured current, never 「沒有電流（710 µA）」: a leak of nanoamps is printed as what it is — and
  // not at all while the learner is asked to measure it (「LED1 沒亮」)
  const i = typeof ct.current === 'number' && Number.isFinite(ct.current) ? Math.abs(ct.current) : 0
  push({
    tier: TIER.unknown,
    state: 'unknown',
    tone: 'info',
    line1: hidesCurrent(input, id)
      ? t('{id} is off|explain', { id })
      : i >= 1e-9
        ? t('{id} is off: only {current} flows|explain', { id, current: fmtCurrent(i) })
        : t('{id} is off: no current flows|explain', { id }),
    line2: t('No clear cause found; check that both of its leads are in the circuit|explain'),
    group: 'off',
  })
}

/** Boards: P2 / P3 when blocked, P5 their pins toggling / on-board LEDs / serial data, P7 running. */
function boardSubjects(input: ExplainInput, out: Subject[], learnerWorks: boolean): void {
  const { layout, telemetry, history, mcus = {}, firmware = {} } = input
  const boards = boardsOf(input)
  if (boards.length === 0) return
  const blocking = (k: BoardBlockerKind | undefined) => k === 'power' || k === 'fw-missing' || k === 'boot0'
  const allBlocked = boards.every((b) => blocking(b.blocker?.kind))
  const base = layout.components.length
  for (const b of boards) {
    const k = b.blocker?.kind
    // an output already says it (「LED1 不亮：驅動它的 U1 沒有韌體」 — the effect AND the cause, one line
    // instead of the pill's own words again)
    const told = !!b.blocker && out.some((s) => s.id !== b.id && s.problem === b.blocker!.problem)
    if (blocking(k) && !told) {
      const id = b.id
      out.push({
        tier: allBlocked && !learnerWorks ? TIER.power : TIER.cause,
        id,
        state: `blocked:${k}`,
        tone: k === 'power' ? 'error' : 'warning',
        dot: stateColor(BLOCKER_STATE[k!]),
        line1:
          k === 'power'
            ? t('{id} has no power, so its core does not run|explain', { id })
            : k === 'fw-missing'
              ? t('{id} has no firmware, so its core does not run|explain', { id })
              : t('{id} has BOOT0 = 1 and starts the system-memory bootloader|explain', { id }),
        line2: k === 'fw-missing' ? t('Load firmware into {id}|explain', { id }) : null,
        problem: b.blocker!.problem,
        order: b.order,
      })
    }
  }
  if (!telemetry) return
  const fw = (id: string) => firmware[id]?.name ?? mcus[id]?.firmware ?? null
  // pins really toggling (circuitActivity, observed) — after the learner's outputs
  const toggles = new Map<string, string[]>()
  for (const it of history?.activity?.items ?? []) {
    const m = /^toggles:(.+)$/.exec(it.key.slice(it.id.length + 1))
    if (!m) continue
    toggles.set(it.id, [...(toggles.get(it.id) ?? []), m[1]])
  }
  for (const [id, pins] of toggles) {
    const name = fw(id)
    const list = pins.slice(0, 3).join(t(', |explain'))
    out.push({
      tier: TIER.works,
      id,
      state: `toggles:${pins.join(',')}`,
      tone: 'ok',
      line1: name ? t('{id} ({fw}): {pins} toggling|explain', { id, fw: name, pins: list }) : t('{id}: {pins} toggling|explain', { id, pins: list }),
      order: base + 1000 + boards.findIndex((b) => b.id === id),
    })
  }
  // on-board LEDs (not the power LED)
  boards.forEach((b, i) => {
    const sub = telemetry.components[b.id]?.sub ?? {}
    for (const [sid, st] of Object.entries(sub)) {
      if (isPowerIndicator(sid) || typeof st.light !== 'number' || st.burned) continue
      const tr = history?.emitters.get(`${b.id}/${sid}`)
      const blinking = isBlinking(tr, telemetry.time)
      const lit = tr ? tr.lit : st.light >= LIT_LIGHT
      if (!blinking && !lit) continue
      const pin = /^LED_(.+)$/.exec(sid)?.[1]
      const id = b.id
      // the same shapes as a learner's LED: on / off 「在閃」, a glide 「漸亮漸暗」, not told 「一明一暗」
      const shape = blinking ? blinkShape(tr) : null
      const line1 = !blinking
        ? pin
          ? t('{id}’s on-board LED ({pin}) is lit|explain', { id, pin })
          : t('{id}’s on-board LED is lit|explain', { id })
        : shape === 'blink'
          ? pin
            ? t('{id}’s on-board LED ({pin}) is blinking|explain', { id, pin })
            : t('{id}’s on-board LED is blinking|explain', { id })
          : shape === 'fade'
            ? pin
              ? t('{id}’s on-board LED ({pin}) fades up and down|explain', { id, pin })
              : t('{id}’s on-board LED fades up and down|explain', { id })
            : pin
              ? t('{id}’s on-board LED ({pin}) goes bright and dark|explain', { id, pin })
              : t('{id}’s on-board LED goes bright and dark|explain', { id })
      out.push({
        tier: TIER.works,
        id,
        state: `sub-${blinking ? (shape ?? 'pulse') : 'lit'}:${sid}`,
        tone: 'ok',
        line1,
        order: base + 2000 + i,
      })
    }
  })
  // serial data: only while bytes keep coming (a greeting at boot is not 「正在送出」 a minute later)
  const uart = history?.uart
  if (uart && boards.some((b) => b.id === uart.id) && telemetry.time - uart.at <= UART_RECENT_S && uart.at - telemetry.time <= UART_RECENT_S) {
    out.push({ tier: TIER.works, id: uart.id, state: 'uart', tone: 'ok', line1: t('{id} is sending serial data|explain', { id: uart.id }), order: base + 3000 })
  }
  // a board running its firmware with nothing observed yet
  for (const b of boards) {
    const s = mcus[b.id]?.state
    const name = fw(b.id)
    if (b.blocker || !name || (s !== 'running' && s !== 'sleeping')) continue
    out.push({ tier: TIER.steady, id: b.id, state: 'runs', tone: 'ok', line1: t('{id} runs {fw}|explain', { id: b.id, fw: name }), order: b.order })
  }
}

/** P2: the circuit has no power at all (one fact 'power:*'). */
function powerSubject(input: ExplainInput, out: Subject[]): void {
  const p = input.problems.find((x) => x.fact === 'power:*' && x.level === 'error')
  if (!p) return
  out.push({ tier: TIER.power, id: p.componentIds[0] ?? '', state: 'no-power', tone: 'error', dot: stateColor('unpowered'), line1: t('The circuit gets no power, so nothing can work|explain'), problem: p, order: -1 })
}

/** P7: the bench supply's output and what the circuit draws (measured). */
function supplySubject(input: ExplainInput, out: Subject[]): void {
  const { layout, telemetry } = input
  if (!telemetry) return
  layout.components.forEach((c, order) => {
    const sim = getEntry(c.type)?.sim
    if (sim?.kind !== 'device' || sim.model !== 'power_supply') return
    const ct = telemetry.components[c.id]
    if (!ct || isShortCircuitCurrent(ct.current)) return
    const vp = ct.pinVoltages?.['+']
    const vm = ct.pinVoltages?.['-']
    const v = isTrustedVoltage(vp) && isTrustedVoltage(vm) ? vp - vm : NaN
    if (!isTrustedVoltage(v)) return
    const i = Math.abs(ct.current ?? 0)
    // a lesson step measuring a part's current: the supply's current may equal it (one loop), so it is
    // not said; measuring the supply's own voltage: not said either
    const noCurrent = (input.secrets?.current.length ?? 0) > 0
    const noVoltage = hidesNet(input, netOfRef(layout, { component: c.id, pin: '+' })) || hidesNet(input, netOfRef(layout, { component: c.id, pin: '-' }))
    out.push({
      tier: TIER.steady,
      id: c.id,
      state: 'supply',
      tone: 'ok',
      line1: noVoltage
        ? t('{id} is supplying the circuit|explain', { id: c.id })
        : noCurrent
          ? t('{id} outputs {v}|explain', { id: c.id, v: fmtVoltage(v) })
          : i >= 1e-6
            ? t('{id} outputs {v}; the circuit draws {i}|explain', { id: c.id, v: fmtVoltage(v), i: fmtCurrent(i) })
            : t('{id} outputs {v}; almost no current flows out|explain', { id: c.id, v: fmtVoltage(v) }),
      order: 10_000 + order,
    })
  })
}

// ---------------------------------------------------------------------------
// the summary
// ---------------------------------------------------------------------------

/** 「8.10 mA–9.40 mA」, one value when they print alike. */
function rangeText(amounts: readonly number[]): string | null {
  if (amounts.length === 0) return null
  const lo = fmtCurrent(Math.min(...amounts))
  const hi = fmtCurrent(Math.max(...amounts))
  return lo === hi ? lo : t('{lo}–{hi}|explain', { lo, hi })
}

/** Line 2 for P5 and lower: the rest of the same kind and state, in one phrase. */
function aggregate(top: Subject, rest: readonly Subject[]): string | null {
  if (!top.group) return null
  const same = rest.filter((s) => s.group === top.group && s.tier === top.tier && s.id !== top.id)
  if (same.length === 0) return null
  const ids = [...new Set(same.map((s) => s.id))]
  const amounts = same.map((s) => s.amount).filter((a): a is number => typeof a === 'number')
  const range = top.group === 'lit' && amounts.length === same.length ? rangeText(amounts) : null
  if (top.group === 'lit') {
    if (ids.length > 3) return range ? t('Also {n} more are lit ({range})|explain', { n: ids.length, range }) : t('Also {n} more are lit|explain', { n: ids.length })
    const list = ids.join(t(', |explain'))
    return range ? t('Also {ids} are lit ({range})|explain', { ids: list, range }) : t('Also {ids} are lit|explain', { ids: list })
  }
  const list = ids.slice(0, 3).join(t(', |explain')) + (ids.length > 3 ? '…' : '')
  if (top.group === 'blink') return t('Also {ids} are blinking|explain', { ids: list })
  if (top.group === 'fade') return t('Also {ids} fade up and down|explain', { ids: list })
  if (top.group === 'pulse') return t('Also {ids} go bright and dark|explain', { ids: list })
  if (top.group === 'turning') return t('Also {ids} are turning|explain', { ids: list })
  if (top.group === 'dim') return t('Also {ids} glow only faintly|explain', { ids: list })
  return t('Also {ids} are off|explain', { ids: list })
}

/** A line without spaces between two Chinese words (the templates' joints); a name's own spaces stay (asName). */
const tidy = (s: string): string => tidyCjkSpaces(s.trim()).replace(/ /g, ' ')

/** A line of `input` free of every Problem.title (the pill's words — the card never repeats them), else null. */
function cleaner(input: ExplainInput): (s: string | null | undefined) => string | null {
  const titles = input.problems.map((p) => p.title).filter((s) => s.length >= 4)
  return (s) => {
    if (!s) return null
    const text = tidy(s)
    return text && !titles.some((title) => text.includes(title)) ? text : null
  }
}

/** The lines of `top` (+ the next subject) with no Problem.title inside them. */
function finish(input: ExplainInput, subjects: readonly Subject[], top: Subject, placeholder = false): Explanation {
  const clean = cleaner(input)
  const paused = input.phase === 'paused' && input.telemetry !== null
  const tag = (s: string) => (paused ? t('{text} (paused)|explain', { text: s }) : s)
  const rest = subjects.filter((s) => s !== top)
  const next = rest[0]
  const also = next ? clean(t('Also: {text}|explain', { text: next.line1 })) : null
  let line2: string | null
  if (top.tier <= TIER.risk) line2 = clean(top.line2) ?? clean(detailFix(top.problem))
  // what works: the others like it first (「另外 LED2 也亮著」), else its path; a dark / dim one: its own
  // reason or fix first (「按住 SW1」, 「由 5.00 V 經 R1 4.7 kΩ 供電」)
  else if (top.tier === TIER.works) line2 = clean(aggregate(top, rest)) ?? clean(top.line2) ?? also
  else line2 = clean(top.line2) ?? clean(aggregate(top, rest)) ?? also
  // explainCircuit only picks a subject whose line 1 is clean; a stand-in has no title in it
  const line1 = tag(clean(top.line1) ?? tidy(top.line1))
  const tone: ExplainTone = paused && (top.tone === 'ok' || top.tone === 'info') ? 'paused' : top.tone
  const ids = top.ids ?? (top.id ? [top.id] : [])
  return {
    tone,
    dot: top.dot && tone !== 'paused' ? top.dot : TONE_DOT[tone],
    lines: line2 ? [line1, line2] : [line1],
    subjectIds: ids.filter((id) => input.layout.components.some((c) => c.id === id)),
    key: `${top.tier}:${top.id}:${top.state}${paused ? ':paused' : ''}`,
    short: line1,
    tier: top.tier,
    ...(placeholder ? { placeholder: true } : {}),
  }
}

/** What the circuit is doing, in one or two lines (see the module doc). */
export function explainCircuit(input: ExplainInput): Explanation {
  const { layout, telemetry } = input
  if (layout.components.length === 0) {
    const line = tidy(t('There are no parts on the breadboard yet.|explain'))
    return { tone: 'idle', dot: TONE_DOT.idle, lines: [line], subjectIds: [], key: 'empty', short: line, tier: TIER.none, placeholder: true }
  }
  const subjects: Subject[] = []
  sessionSubjects(input, subjects)
  damageSubjects(input, subjects)
  powerSubject(input, subjects)
  outputSubjects(input, subjects)
  const learnerWorks = subjects.some((s) => s.tier === TIER.works || s.tier === TIER.risk)
  boardSubjects(input, subjects, learnerWorks)
  supplySubject(input, subjects)
  const selected = new Set(input.selection ?? [])
  subjects.sort((a, b) => a.tier - b.tier || (selected.has(a.id) ? 0 : 1) - (selected.has(b.id) ? 0 : 1) || a.order - b.order)
  // a subject whose line 1 would repeat a Problems title (the pill's words) never leads
  const clean = cleaner(input)
  const top = subjects.find((s) => clean(s.line1) !== null)
  if (top) return finish(input, subjects, top)
  // a session without fresh readings (just after an edit) still runs: never 「還沒開始」
  if (telemetry || input.phase !== 'idle') {
    return finish(input, [], { tier: TIER.steady, id: '', state: 'simulating', tone: 'ok', line1: t('The circuit is being simulated|explain'), order: 0 }, true)
  }
  return finish(
    input,
    [],
    {
      tier: TIER.none,
      id: '',
      state: 'not-started',
      tone: 'idle',
      // auto-run starts it by itself (persona fix): never 「開始模擬後…」, which asks the learner to start it
      line1: input.autoStart ? t('The simulation starts by itself in a moment|explain') : t('The simulation has not started yet|explain'),
      line2: input.autoStart
        ? t('Then this card says what the circuit is doing|explain')
        : t('Once it runs, this card says what the circuit is doing|explain'),
      order: 0,
    },
    true,
  )
}

/**
 * The phone status pill's lowest tier ('explain'): line 1 as its text and
 * both lines for the tap — on phones only (desktop has the card), never in
 * the classic chrome, never for an empty board (the empty-state card speaks).
 */
export function explainForPill(e: Explanation | null, opts: { desktop: boolean; legacy: boolean }): { text: string; detail: string } | null {
  if (!e || opts.desktop || opts.legacy || e.key === 'empty') return null
  const [a, b] = e.lines
  return { text: e.short, detail: b ? t('{a}. {b}|explain', { a, b }) : a }
}
