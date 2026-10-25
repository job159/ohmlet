/**
 * Measurements — pure functions over captures.
 *
 * Logic (edge lists): edge counts, period / frequency (mean rising-to-rising
 * interval over the complete cycles in the window), duty cycle (high time
 * over those cycles), high / low pulse widths (pulses with both edges in
 * the window; spans at the undefined level are never pulses). A frequency
 * is given ONLY for a signal that repeats (UX IS-11, classifyPeriods):
 * serial data (UART TX, SDA, MOSI) is 'aperiodic' and gets none; a clock
 * in bursts (I²C SCL, SPI SCK) reports its in-burst clock instead.
 *
 * Analog (variable-step scope samples, as solved): Vmin / Vmax / Vpp,
 * time-weighted Vavg and Vrms (trapezoidal integration — the step is not
 * constant, and the scope draws straight segments between samples),
 * frequency / period / duty from crossings of the mean with a hysteresis
 * of ±5 % of Vpp (crossing times linearly interpolated), and 10–90 % rise
 * / fall times between Vmin and Vmax (mean over every complete
 * transition). Non-finite samples are skipped.
 */
import type { LogicTrace } from '../sim/coordinator/api'
import { Signal } from './signal'

export interface PulseStats {
  count: number
  min: number
  max: number
  avg: number
}

export interface EdgeMeasurements {
  edges: number
  rising: number
  falling: number
  /** s; null with fewer than two edges of the reference polarity, or when the edges do not repeat (periodicity) */
  period: number | null
  frequency: number | null
  /** high fraction over the complete cycles (0..1); null unless periodic */
  duty: number | null
  high: PulseStats | null
  low: PulseStats | null
  /** how the reference edges repeat (UX IS-11) — period / frequency / duty only for 'periodic' */
  periodicity: PeriodicityKind
  /** Hz: the clock inside the bursts of a 'burst' signal (median complete period), else null */
  burstClock: number | null
  /** a periodic signal some of whose periods had no pulse (a PWM passing 0 % / 100 %) */
  skipped: boolean
  /** 'stopped': the time of the last edge, and the level the signal stayed at (UX QA IS-F9); else null */
  stoppedAt: number | null
  stoppedLevel: 0 | 1 | 2 | null
  /**
   * 'stopped': the period of the train before it stopped (s), else null —
   * a BUS clock that runs one transaction and stops (I²C SCL, SPI SCK in a
   * window fitted to one frame) is a clock burst, not a stopped signal (QA
   * clarity MEASURE-COHERENCE: the footer and 量測 say 「時脈 100.0 kHz（突發）」)
   */
  stoppedPeriod?: number | null
}

// ---------------------------------------------------------------------------
// Periodicity (UX IS-11): never a frequency for a signal that does not repeat
// ---------------------------------------------------------------------------

/**
 * 'periodic'  one repeating signal across the window (a PWM whose pulses
 *             are missing in some periods — 0 % / 100 % duty — still is:
 *             every interval is a whole number of periods);
 * 'burst'     a clock in bursts with idle gaps (I²C SCL, SPI SCK): regular
 *             inside the bursts, the gaps longer than 1.5 periods;
 * 'stopped'   a regular train that ran from the window's start and then
 *             stopped — its last edge more than 2 periods before the window
 *             end, and only that one run in the window (a GPIO whose clock
 *             was switched off, a reset): no frequency, and never 「時脈（突發）」
 *             (UX QA IS-F9) — `stoppedAt` is its last edge;
 * 'aperiodic' edges that do not repeat (UART / SDA / MOSI data, a bouncing
 *             contact): no frequency, no duty;
 * 'unknown'   fewer than two reference edges — nothing to judge.
 */
export type PeriodicityKind = 'periodic' | 'burst' | 'stopped' | 'aperiodic' | 'unknown'

export interface Periodicity {
  kind: PeriodicityKind
  /** s — periodic: the period; burst: the median in-burst period; stopped: the train's period; else null */
  period: number | null
  /** periodic with some periods skipped (intervals of 2, 3 … periods) */
  skipped: boolean
  /** 'stopped': time of the train's last edge (any polarity) */
  stoppedAt?: number
}

/** A stopped train's last edge lies more than this many periods before the window end. */
const STOPPED_PERIODS = 2

/** Consecutive reference intervals may vary by this much (coefficient of variation) and still be one period. */
export const PERIOD_MAX_CV = 0.1
/** An interval counts as k periods when it is within this fraction of a period of k × the period. */
const MULTIPLE_TOL = 0.03
/**
 * In-burst periods lie within ±10 % of the median. The gaps between bursts
 * are longer than 1.1 periods when the pulse widths show one clock (a
 * repeated START / STOP–START of I²C is only 1.5 periods), else longer than
 * 1.5 periods — serial data has intervals of 2, 3 … bit times, so 1.5 × a
 * median of 2 bits must not pass as a gap.
 */
const BURST_TOL = 0.1
const BURST_GAP = 1.5
const BURST_GAP_CLOCK = 1.1
/** One clock: at least this share of the high (and of the low) widths within ±15 % of their median. */
const CLOCK_WIDTH_SHARE = 0.75
const CLOCK_WIDTH_TOL = 0.15

/** Most widths alike (a clock's pulses; serial data has 1, 2, 3 … bit-wide pulses). */
function oneWidth(ws: readonly number[]): boolean {
  if (ws.length < 3) return false
  const md = medianOf(ws)
  return ws.filter((w) => Math.abs(w - md) <= CLOCK_WIDTH_TOL * md).length >= CLOCK_WIDTH_SHARE * ws.length
}

function medianOf(xs: readonly number[]): number {
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * How the reference edge times `ref` (ascending, inside [t0, t1]) repeat.
 * `first` / `last` are the first / last edge of ANY polarity in the window:
 * with a finite window, a repeating signal must cover it — no idle stretch
 * longer than max(1.5 periods, 20 % of the window) at either end, otherwise
 * the regular edges are a burst (8 SPI clocks, then silence). `widths` (the
 * complete high / low pulse widths) tell a clock from data. Pure.
 */
export function classifyPeriods(
  ref: readonly number[],
  t0: number,
  t1: number,
  first: number | null,
  last: number | null,
  widths?: { high: readonly number[]; low: readonly number[] },
): Periodicity {
  if (ref.length < 2) return { kind: 'unknown', period: null, skipped: false }
  const d: number[] = []
  for (let i = 1; i < ref.length; i++) d.push(ref[i] - ref[i - 1])
  if (!d.every((x) => x > 0)) return { kind: 'aperiodic', period: null, skipped: false }
  const finite = Number.isFinite(t0) && Number.isFinite(t1) && first !== null && last !== null
  const slackOf = (p: number) => Math.max(1.5 * p, 0.2 * (t1 - t0))
  const covers = (p: number): boolean => {
    if (!finite) return true
    const slack = slackOf(p)
    return first! - t0 <= slack && t1 - last! <= slack
  }
  const mean = d.reduce((a, x) => a + x, 0) / d.length
  let v = 0
  for (const x of d) v += (x - mean) ** 2
  const cv = Math.sqrt(v / d.length) / mean
  if (cv <= PERIOD_MAX_CV) {
    if (covers(mean)) return { kind: 'periodic', period: mean, skipped: false }
    // one regular run from the window's start that ended well before its end: the
    // signal STOPPED (a GPIO clock switched off) — not a clock burst (UX QA IS-F9).
    // A run with idle before it too (8 SPI clocks, then silence) stays a burst.
    if (d.length >= 2 && finite && first! - t0 <= slackOf(mean) && t1 - last! > STOPPED_PERIODS * mean) {
      // the train's median period: a bus clock read as a burst reads the same clock as a 'burst' does
      return { kind: 'stopped', period: medianOf(d), skipped: false, stoppedAt: last! }
    }
    // regular edges with idle stretches around them: one burst
    return d.length >= 2 ? { kind: 'burst', period: medianOf(d), skipped: false } : { kind: 'aperiodic', period: null, skipped: false }
  }
  const m = medianOf(d)
  // a PWM passing 0 % / 100 %: every interval a whole number of periods, most of them one
  let ones = 0
  let multiples = true
  for (const x of d) {
    const k = Math.round(x / m)
    if (k < 1 || Math.abs(x - k * m) > MULTIPLE_TOL * m) {
      multiples = false
      break
    }
    if (k === 1) ones++
  }
  if (multiples && ones * 2 >= d.length && covers(m)) {
    const unit = d.filter((x) => Math.round(x / m) === 1)
    return { kind: 'periodic', period: unit.reduce((a, x) => a + x, 0) / unit.length, skipped: true }
  }
  // a clock in bursts: regular inside, the gaps clearly longer than one period, never shorter
  const inBurst = d.filter((x) => Math.abs(x - m) <= BURST_TOL * m)
  const clock = !!widths && oneWidth(widths.high) && oneWidth(widths.low)
  const gap = (clock ? BURST_GAP_CLOCK : BURST_GAP) * m
  if (inBurst.length >= 2 && d.every((x) => Math.abs(x - m) <= BURST_TOL * m || x > gap)) {
    return { kind: 'burst', period: medianOf(inBurst), skipped: false }
  }
  return { kind: 'aperiodic', period: null, skipped: false }
}

function stats(widths: number[]): PulseStats | null {
  if (widths.length === 0) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const w of widths) {
    if (w < min) min = w
    if (w > max) max = w
    sum += w
  }
  return { count: widths.length, min, max, avg: sum / widths.length }
}

/** Edge-based measurements of one logic channel inside [t0, t1]. */
export function measureEdges(
  trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>,
  t0 = -Infinity,
  t1 = Infinity,
): EdgeMeasurements {
  const sig = new Signal(trace)
  const rises: number[] = []
  const falls: number[] = []
  const high: number[] = []
  const low: number[] = []
  let lastEdge = -1
  for (let i = sig.firstAtOrAfter(t0); i < sig.count && sig.times[i] <= t1; i++) {
    const before = sig.before(i)
    const after = sig.after(i)
    const t = sig.times[i]
    if (before === 0 && after === 1) rises.push(t)
    else if (before === 1 && after === 0) falls.push(t)
    // a complete pulse: the previous edge in the window started this level
    if (lastEdge >= 0 && before !== 2) {
      const w = t - sig.times[lastEdge]
      if (before === 1) high.push(w)
      else low.push(w)
    }
    lastEdge = i
  }
  const ref = rises.length >= 2 ? rises : falls.length >= 2 ? falls : null
  const n = rises.length + falls.length
  const tFirst = n > 0 ? Math.min(rises[0] ?? Infinity, falls[0] ?? Infinity) : null
  const tLast = n > 0 ? Math.max(rises[rises.length - 1] ?? -Infinity, falls[falls.length - 1] ?? -Infinity) : null
  const per: Periodicity = ref ? classifyPeriods(ref, t0, t1, tFirst, tLast, { high, low }) : { kind: 'unknown', period: null, skipped: false }
  let period: number | null = null
  let duty: number | null = null
  if (ref && per.kind === 'periodic') {
    period = per.period
    // high time inside [ref0, refN] (a skipped period counts as the 0 % / 100 % it was)
    const a = ref[0]
    const b = ref[ref.length - 1]
    let hi = 0
    let ok = true
    let level = sig.at(a)
    let t = a
    for (let i = sig.firstAfter(a); i < sig.count && sig.times[i] <= b; i++) {
      if (level === 2) ok = false
      if (level === 1) hi += sig.times[i] - t
      t = sig.times[i]
      level = sig.after(i)
    }
    if (ok && b > a) duty = hi / (b - a)
  }
  return {
    edges: n,
    rising: rises.length,
    falling: falls.length,
    period,
    frequency: period && period > 0 ? 1 / period : null,
    duty,
    high: stats(high),
    low: stats(low),
    periodicity: per.kind,
    burstClock: per.kind === 'burst' && per.period ? 1 / per.period : null,
    skipped: per.kind === 'periodic' && per.skipped,
    stoppedAt: per.kind === 'stopped' && per.stoppedAt !== undefined ? per.stoppedAt : null,
    stoppedPeriod: per.kind === 'stopped' ? per.period : null,
    // the level it stayed at: at the window's end (a pin left floating reads 2)
    stoppedLevel: per.kind === 'stopped' && per.stoppedAt !== undefined ? sig.at(Number.isFinite(t1) ? t1 : per.stoppedAt) : null,
  }
}

// ---------------------------------------------------------------------------
// A channel's recent recording (QA clarity LA-FIT)
// ---------------------------------------------------------------------------

/** The shortest recent stretch a channel is measured over when its window holds no complete period (s). */
export const RECENT_MIN_S = 0.1

/**
 * A channel whose visible window (or A–B) holds less than one complete
 * period, measured over its RECENT recording instead — the last
 * max(100 ms, 3 periods) before `t1` (the period rounded up the analyzer's
 * 1-2-5 ladder, so the label reads 「最近 5 s」, not 「最近 3.01 s」), never
 * before `from` (what the recorder still holds). `span` is the stretch
 * actually measured (the label: 「（最近 100 ms）」, the scope's wording).
 * null when the recording holds nothing to judge either (fewer than two
 * reference edges). Pure.
 */
export function recentEdgeMeasurements(
  trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>,
  from: number,
  t1: number,
): { m: EdgeMeasurements; span: number } | null {
  if (!(t1 > from)) return null
  const short = Math.min(RECENT_MIN_S, t1 - from)
  const m100 = measureEdges(trace, t1 - short, t1)
  let period = m100.periodicity === 'periodic' ? m100.period : null
  if (period === null) {
    const all = measureEdges(trace, from, t1)
    if (all.periodicity === 'periodic') period = all.period
    // a burst clock / serial data / a stopped train: its own words over the stretch that shows them
    else if (m100.periodicity !== 'unknown') return { m: m100, span: short }
    else if (all.periodicity !== 'unknown') return { m: all, span: t1 - from }
    else return null
  }
  if (period === null || !(period > 0)) return null
  const span = Math.min(t1 - from, Math.max(RECENT_MIN_S, ladderAtLeast(3 * period)))
  const m = measureEdges(trace, t1 - span, t1)
  return m.periodicity === 'unknown' ? null : { m, span }
}

/** The smallest 1-2-5 value ≥ x (the logic analyzer's zoom ladder, autofit.ts LA_SPANS, unbounded). */
function ladderAtLeast(x: number): number {
  const e = Math.floor(Math.log10(x))
  for (const k of [e, e + 1]) for (const m of [1, 2, 5]) if (m * 10 ** k >= x * (1 - 1e-9)) return Number((m * 10 ** k).toPrecision(3))
  return x
}

// ---------------------------------------------------------------------------
// Net live summary (UX helper H4)
// ---------------------------------------------------------------------------

/** Sim-time window the live summary looks back over (100 ms). */
export const NET_LIVE_WINDOW_S = 0.1
/** Rise-to-rise periods may vary by this much (coefficient of variation) and still be one PWM (= PERIOD_MAX_CV). */
export const PWM_MAX_PERIOD_CV = 0.1
/** Reference edges needed before a period / duty is claimed (2 complete periods). */
export const PWM_MIN_REF_EDGES = 3

/** Edge statistics of one recorded net inside a window (netSummary). */
export interface NetSummary {
  /** edges inside [t0, t1] */
  edges: number
  rising: number
  falling: number
  /** time of the last edge inside the window (null = none) */
  lastEdge: number | null
  /**
   * The edges form ONE periodic signal across the window — the same rule
   * the logic analyzer and the scope use (classifyPeriods, UX IS-11): at
   * least PWM_MIN_REF_EDGES reference edges, rise-to-rise periods within
   * PWM_MAX_PERIOD_CV of their mean (or whole multiples of one period: a PWM
   * passing 0 % / 100 %), no undefined level inside the measured cycles,
   * and edges across the window (no idle stretch longer than max(1.5
   * periods, 20 % of the window) at either end). Serial data, bursts and
   * glitches are not periodic — they never get a frequency.
   */
  periodic: boolean
  /** Hz, only when periodic */
  frequency: number | null
  /** high fraction 0..1, only when periodic */
  duty: number | null
  /** level at the window's end: 0, 1 or 2 (undefined) */
  level: 0 | 1 | 2
  /**
   * Hz: the clock inside the bursts when the edges are a clock in bursts
   * (measureEdges 'burst' — I²C SCL, SPI SCK), else null (QA clarity
   * MEASURE-COHERENCE: the live summary words it as the analyzer does)
   */
  burstClock?: number | null
}

/**
 * Pure: what the edge list of a recorded net did inside [t0, t1] — edge
 * counts, the last edge, and, ONLY for a periodic signal (see
 * NetSummary.periodic), its frequency and duty (measureEdges over the same
 * window). Never guesses: an aperiodic or too short record has
 * frequency = duty = null.
 */
export function netSummary(trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>, t0: number, t1: number): NetSummary {
  const sig = new Signal(trace)
  let lastEdge: number | null = null
  for (let i = sig.firstAtOrAfter(t0); i < sig.count && sig.times[i] <= t1; i++) lastEdge = sig.times[i]
  const m = measureEdges(trace, t0, t1)
  // the reference polarity measureEdges uses for the period: two complete
  // periods at least before a live readout claims a PWM
  const refEdges = m.rising >= 2 ? m.rising : m.falling
  const periodic =
    refEdges >= PWM_MIN_REF_EDGES && m.periodicity === 'periodic' && m.frequency !== null && m.period !== null && m.duty !== null
  return {
    edges: m.edges,
    rising: m.rising,
    falling: m.falling,
    lastEdge,
    periodic,
    frequency: periodic ? m.frequency : null,
    duty: periodic ? m.duty : null,
    level: sig.at(t1),
    burstClock: m.periodicity === 'burst' ? m.burstClock : null,
  }
}

/**
 * What one net is doing right now (UX helper H4) — the hover chip, the pin
 * rows, the wire panel and the problems list all read this, so a PWM net
 * never shows "3.10 V" in one place and "0 mV" in another:
 *  - 'pwm'      a recorded net with a periodic signal in the last
 *               NET_LIVE_WINDOW_S: frequency, duty and the average voltage
 *               (duty × the net's high level; null when that level was never
 *               observed);
 *  - 'toggling' a recorded net with ≥ 2 edges in the window that are NOT one
 *               periodic signal (serial data, bursts): no frequency is claimed;
 *               `v` is the instantaneous solver voltage; `young` = fewer than
 *               PWM_MIN_REF_EDGES edges of either polarity — too few to tell
 *               whether it repeats, so nothing is claimed either way (UX QA
 *               IS-F8: blink's first second is not 「非週期」);
 *  - 'dc'       a recorded net with fewer than 2 edges in the window: `v` is
 *               its (steady) solver voltage;
 *  - 'unknown'  the net is not recorded (no logic channel watches it), or a
 *               recorded net without a trustworthy voltage: `v` is the
 *               instantaneous solver value (null = none), to be shown as such.
 */
export type NetLive =
  | { kind: 'pwm'; f: number; duty: number; vavg: number | null; source?: NetSignalSource; held?: NetHeld }
  | {
      kind: 'toggling'
      edges: number
      v: number | null
      source?: NetSignalSource
      young?: true
      /** Hz — the edges are a clock in bursts (I²C SCL, SPI SCK): 「時脈 400.0 kHz（突發）」, the analyzer's words */
      burstClock?: number
      /** the net is a USART line the firmware configured: 「UART 115 200 Bd · 8N1」 */
      line?: NetSerialLine
      /** the bus a decoder's data role on this net belongs to ('SPI', 'I²C', 'UART', '1-Wire'): 「SPI 資料」 */
      protocol?: string
      held?: NetHeld
    }
  | { kind: 'dc'; v: number }
  | { kind: 'unknown'; v: number | null; instantaneous: true }
  /**
   * QA clarity FG-RAIL: a net driven by a function generator (and not on
   * the logic analyzer) — what the generator is SET to, never one jumping
   * instant of it: 「方波 100 Hz · 0–5.00 V（函數產生器設定）」.
   */
  | { kind: 'source'; id: string; waveform: 'sine' | 'square' | 'triangle'; f: number; lo: number; hi: number }

/**
 * QA clarity MEASURE-COHERENCE: a moving net while the simulation is paused,
 * or while the board driving it is halted (its edges stopped): what it does
 * NOW is hold a level — the summary names the level first and what it did
 * before as history (「目前 高（3.30 V）· 暫停前：週期訊號 0.998 Hz · 50.0 %」),
 * never 「訊號變化中」.
 */
export interface NetHeld {
  why: 'paused' | 'halted'
  /** the net's present solver voltage (null = unknown) */
  v: number | null
}

/** A serial line's settings (signal-readout SerialLine without its origin). */
export interface NetSerialLine {
  baud: number
  frame: string | null
}

/**
 * What drives a moving net (UX QA IS-F8), so the words stay neutral:
 *  'timer' a timer channel output (the driving pin's active function is
 *          TIMx_CHy) — a real PWM: 「PWM 1.000 kHz · 34.0 %」;
 *  'gpio'  anything else that repeats (a toggled GPIO): 「週期訊號 0.998 Hz · 50.0 %」;
 *  'data'  the net's logic channel is a decoder's data role (UART data,
 *          SDA, MOSI / MISO, 1-Wire DQ): 「訊號變化中（序列資料）」, never a PWM.
 * Absent (the pure netLiveSummary, older callers) reads as 'timer' — the
 * wording before the source was known.
 */
export type NetSignalSource = 'timer' | 'gpio' | 'data'

export interface NetLiveInput {
  /** the net's recorded edge list (null = the net is not recorded) */
  trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'> | null
  /** window start / end (sim time, s): normally [now − NET_LIVE_WINDOW_S, now] */
  t0: number
  t1: number
  /** instantaneous solver voltage of the net (telemetry), null = unknown */
  v: number | null
  /** the net's high level (V) as last observed, for the PWM average */
  vHigh?: number | null
}

/** A voltage worth printing (finite, |v| ≤ 1 kV — format.ts isTrustedVoltage). */
function trusted(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000
}

/** Pure classification behind getNetLive / useNetLive (see NetLive). */
export function netLiveSummary(input: NetLiveInput): NetLive {
  const v = trusted(input.v) ? input.v : null
  if (!input.trace) return { kind: 'unknown', v, instantaneous: true }
  const s = netSummary(input.trace, input.t0, input.t1)
  if (s.periodic && s.frequency !== null && s.duty !== null) {
    const vavg = trusted(input.vHigh) && input.vHigh > 0 ? s.duty * input.vHigh : null
    return { kind: 'pwm', f: s.frequency, duty: s.duty, vavg }
  }
  if (s.edges >= 2) {
    // too few edges of either polarity to judge a period: say only that it changes
    if (Math.max(s.rising, s.falling) < PWM_MIN_REF_EDGES) return { kind: 'toggling', edges: s.edges, v, young: true }
    return s.burstClock ? { kind: 'toggling', edges: s.edges, v, burstClock: s.burstClock } : { kind: 'toggling', edges: s.edges, v }
  }
  return v === null ? { kind: 'unknown', v: null, instantaneous: true } : { kind: 'dc', v }
}

export interface WaveMeasurements {
  /** finite samples used */
  samples: number
  vmin: number | null
  vmax: number | null
  vpp: number | null
  vavg: number | null
  vrms: number | null
  period: number | null
  frequency: number | null
  duty: number | null
  /** mean 10–90 % rise / fall time (null without a complete transition) */
  rise: number | null
  fall: number | null
  /**
   * samples per period over the measured cycles (null without a period) —
   * how finely the data resolves one period: an analog frequency is quoted
   * to at most 3 significant digits below ANALOG_FINE_SAMPLES (UX IS-11)
   */
  samplesPerPeriod: number | null
  /**
   * Why period / frequency / duty / rise / fall are withheld although the
   * signal varies (UX IS-2 — a scope never prints a number that may be
   * wrong): 'decimated' = the samples were min/max-decimated (crossing
   * times are lost); 'undersampled' = one period spans fewer than
   * MIN_SAMPLES_PER_PERIOD samples or MIN_PX_PER_PERIOD screen pixels.
   * 'aperiodic' = the mean crossings do not repeat (serial data on the
   * probed net, UX IS-11 — classifyPeriods): no frequency / period / duty
   * (the levels and rise / fall times stay).
   * null = the timing values are trustworthy (or simply absent).
   */
  timing: 'decimated' | 'undersampled' | 'aperiodic' | null
  /**
   * 'undersampled' = the net's shortest known pulse (WaveGuard.minPulse — a
   * serial bit, the exact edges' narrowest pulse) is shorter than
   * AMPLITUDE_MIN_SAMPLES analog sample intervals: the samples miss whole
   * pulses, so Vpp / Vavg / Vrms are withheld too (null) — a 115 200 Bd line
   * sampled every 50 µs is not a 2.727 Vpp signal (UX QA IS-F6). null = the
   * levels are trustworthy.
   */
  amplitude: 'undersampled' | null
  /** the median interval between the window's samples (s; null with < 2 samples or decimated data) */
  sampleInterval: number | null
  /**
   * QA clarity SCOPE-READOUT-TRIGGER: how the signal spends its time —
   * 'two-level' = at least TWO_LEVEL_SHARE of the window within ±10 % of
   * the swing from one of its two extremes (a square wave, a PWM): it has a
   * duty cycle; 'analog' = in between (an RC charge curve, a sine, a
   * triangle): max / min / RMS / rise time, never a duty cycle. Absent with
   * fewer than two samples or a flat window.
   */
  shape?: 'two-level' | 'analog'
}

/** A window this share of whose time sits near one of its two extremes is a two-level signal. */
export const TWO_LEVEL_SHARE = 0.8

/** Guard of measureWave: fewer samples than this per period → no timing values. */
export const MIN_SAMPLES_PER_PERIOD = 4
/** Guard of measureWave: a period narrower than this on screen → no timing values. */
export const MIN_PX_PER_PERIOD = 2
/** Fewer samples per period than this: an analog frequency gets 3 significant digits, not 4. */
export const ANALOG_FINE_SAMPLES = 1000

export interface WaveGuard {
  /** the samples were min/max decimated (ScopeTrace.decimated) */
  decimated?: boolean
  /** screen pixels per second of the drawn window (enables the pixel guard) */
  pxPerSecond?: number
  /**
   * The net's shortest known pulse (s): a serial line's bit time (1 / baud),
   * or the narrowest pulse of the exact edges the logic analyzer recorded.
   * Shorter than AMPLITUDE_MIN_SAMPLES sample intervals → `amplitude` =
   * 'undersampled' and no levels (UX QA IS-F6).
   */
  minPulse?: number | null
  /**
   * The analog sample interval (s) when the samples given cannot tell it
   * (decimated data): the full-resolution recording's, or the solver step.
   */
  sampleInterval?: number | null
}

/** A pulse needs at least this many analog sample intervals before its levels are trusted. */
export const AMPLITUDE_MIN_SAMPLES = 2

/** Median positive interval between consecutive finite samples inside [t0, t1] (null with fewer than two). */
export function medianSampleInterval(t: ArrayLike<number>, v: ArrayLike<number>, t0 = -Infinity, t1 = Infinity): number | null {
  const d: number[] = []
  let prev = NaN
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0 || t[i] > t1 || !Number.isFinite(v[i])) continue
    if (Number.isFinite(prev) && t[i] > prev) d.push(t[i] - prev)
    prev = t[i]
  }
  if (d.length === 0) return null
  d.sort((a, b) => a - b)
  return d[d.length >> 1]
}

const NO_WAVE: WaveMeasurements = {
  samples: 0,
  vmin: null,
  vmax: null,
  vpp: null,
  vavg: null,
  vrms: null,
  period: null,
  frequency: null,
  duty: null,
  rise: null,
  fall: null,
  samplesPerPeriod: null,
  timing: null,
  amplitude: null,
  sampleInterval: null,
}

/** Time of the crossing of `level` between samples (ta, va) and (tb, vb). */
function cross(ta: number, va: number, tb: number, vb: number, level: number): number {
  if (vb === va) return tb
  return ta + ((level - va) / (vb - va)) * (tb - ta)
}

/**
 * Waveform measurements of scope samples (t ascending) inside [t0, t1].
 * A signal whose mean crossings do not repeat (classifyPeriods) never has a
 * period / frequency / duty: `timing` = 'aperiodic', with or without a guard.
 * With `guard`, the timing values (period, frequency, duty, rise, fall) are
 * withheld — `timing` says why — when the samples were decimated, when one
 * period spans fewer than MIN_SAMPLES_PER_PERIOD samples, or when it is
 * narrower than MIN_PX_PER_PERIOD pixels on screen. Levels (Vmin … Vrms)
 * are always reported.
 */
export function measureWave(
  t: ArrayLike<number>,
  v: ArrayLike<number>,
  t0 = -Infinity,
  t1 = Infinity,
  guard: WaveGuard = {},
): WaveMeasurements {
  const [raw, cycles, aperiodic] = measureWaveRaw(t, v, t0, t1)
  let m = raw
  // the sampling itself (UX QA IS-F6): the interval between the samples, and
  // whether it can hold the net's shortest pulse at all — else no levels either
  const dt = guard.decimated ? guard.sampleInterval ?? null : medianSampleInterval(t, v, t0, t1) ?? guard.sampleInterval ?? null
  if (dt !== null) m = { ...m, sampleInterval: dt }
  const minPulse = guard.minPulse
  if (dt !== null && typeof minPulse === 'number' && minPulse > 0 && minPulse < AMPLITUDE_MIN_SAMPLES * dt && m.samples > 0) {
    return {
      ...m,
      vpp: null,
      vavg: null,
      vrms: null,
      period: null,
      frequency: null,
      duty: null,
      rise: null,
      fall: null,
      samplesPerPeriod: null,
      timing: 'undersampled',
      amplitude: 'undersampled',
    }
  }
  if (m.vpp === null || !(m.vpp > 1e-9)) return m
  // samples per period over the measured cycles (variable-step data: count
  // the samples, never assume a step). A square wave solved only at its
  // edges has exactly 4 per period (before / after each edge).
  let perPeriod: number | null = null
  if (cycles) {
    let n = 0
    for (let i = 0; i < t.length; i++) if (t[i] > cycles.from && t[i] < cycles.to && Number.isFinite(v[i])) n++
    perPeriod = n / cycles.n
  }
  if (m.period !== null) m.samplesPerPeriod = perPeriod
  let timing: WaveMeasurements['timing'] = null
  if (guard.decimated) timing = 'decimated'
  else if (perPeriod !== null) {
    if (perPeriod < MIN_SAMPLES_PER_PERIOD) timing = 'undersampled'
    else if (
      guard.pxPerSecond !== undefined &&
      m.period !== null &&
      m.period * guard.pxPerSecond < MIN_PX_PER_PERIOD
    ) {
      timing = 'undersampled'
    }
  }
  // data that can hold the timing but whose crossings do not repeat: no frequency (the transitions stay)
  if (timing === null && aperiodic) return { ...m, timing: 'aperiodic' }
  if (timing === null) return m
  return { ...m, period: null, frequency: null, duty: null, rise: null, fall: null, samplesPerPeriod: null, timing }
}

/**
 * Measurements without the guard + the complete cycles they were taken over
 * + whether the crossings fail to repeat (period / frequency / duty are then
 * already null).
 */
function measureWaveRaw(
  t: ArrayLike<number>,
  v: ArrayLike<number>,
  t0: number,
  t1: number,
): [WaveMeasurements, { from: number; to: number; n: number } | null, boolean] {
  const T: number[] = []
  const V: number[] = []
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0 || t[i] > t1) continue
    const x = v[i]
    if (!Number.isFinite(x)) continue
    T.push(t[i])
    V.push(x)
  }
  const n = T.length
  if (n === 0) return [NO_WAVE, null, false]
  let vmin = Infinity
  let vmax = -Infinity
  for (const x of V) {
    if (x < vmin) vmin = x
    if (x > vmax) vmax = x
  }
  const vpp = vmax - vmin
  // time-weighted mean and RMS (trapezoid; v² integrated exactly for a linear segment)
  let area = 0
  let area2 = 0
  const dur = T[n - 1] - T[0]
  for (let i = 1; i < n; i++) {
    const dt = T[i] - T[i - 1]
    const a = V[i - 1]
    const b = V[i]
    area += ((a + b) / 2) * dt
    area2 += ((a * a + a * b + b * b) / 3) * dt
  }
  let vavg: number
  let vrms: number
  if (dur > 0) {
    vavg = area / dur
    vrms = Math.sqrt(Math.max(0, area2 / dur))
  } else {
    let s = 0
    let s2 = 0
    for (const x of V) {
      s += x
      s2 += x * x
    }
    vavg = s / n
    vrms = Math.sqrt(s2 / n)
  }
  const out: WaveMeasurements = { ...NO_WAVE, samples: n, vmin, vmax, vpp, vavg, vrms }
  if (n < 2 || !(vpp > 1e-9)) return [out, null, false]
  // the shape: time spent within ±10 % of the swing from either extreme (a square wave ≈ 100 %, an RC curve ≈ 50 %)
  if (dur > 0) {
    const band = 0.1 * vpp
    let near = 0
    for (let i = 1; i < n; i++) {
      const a = V[i - 1]
      const b = V[i]
      const top = vmax - a <= band && vmax - b <= band
      const bottom = a - vmin <= band && b - vmin <= band
      if (top || bottom) near += T[i] - T[i - 1]
    }
    out.shape = near / dur >= TWO_LEVEL_SHARE ? 'two-level' : 'analog'
  }

  // ---- mean crossings with hysteresis → period, duty
  const h = 0.05 * vpp
  const crossings = (mid: number): { rises: number[]; falls: number[] } => {
    const rises: number[] = []
    const falls: number[] = []
    let state: 0 | 1 | -1 = V[0] > mid + h ? 1 : V[0] < mid - h ? 0 : -1
    for (let i = 1; i < n; i++) {
      const x = V[i]
      if (state !== 1 && x > mid + h) {
        if (state === 0) {
          // find the sample pair that crosses the mean on the way up
          let k = i
          while (k > 0 && V[k - 1] >= mid) k--
          rises.push(k > 0 ? cross(T[k - 1], V[k - 1], T[k], V[k], mid) : T[0])
        }
        state = 1
      } else if (state !== 0 && x < mid - h) {
        if (state === 1) {
          let k = i
          while (k > 0 && V[k - 1] <= mid) k--
          falls.push(k > 0 ? cross(T[k - 1], V[k - 1], T[k], V[k], mid) : T[0])
        }
        state = 0
      }
    }
    return { rises, falls }
  }
  let { rises, falls } = crossings(vavg)
  if (rises.length < 2 && falls.length < 2) {
    // a pulse train near 0 % / 100 % duty puts its mean within the
    // hysteresis band of one level (a 97 % PWM: mean 3.00 V, top 3.10 V) —
    // cross at the 50 % reference level between the extremes instead
    ;({ rises, falls } = crossings(vmin + 0.5 * vpp))
  }
  const ref = rises.length >= 2 ? rises : falls.length >= 2 ? falls : null
  let cycles: { from: number; to: number; n: number } | null = null
  let aperiodic = false
  const per: Periodicity = ref
    ? classifyPeriods(ref, t0, t1, Math.min(rises[0] ?? Infinity, falls[0] ?? Infinity), Math.max(rises[rises.length - 1] ?? -Infinity, falls[falls.length - 1] ?? -Infinity))
    : { kind: 'unknown', period: null, skipped: false }
  if (ref) cycles = { from: ref[0], to: ref[ref.length - 1], n: ref.length - 1 }
  if (per.kind === 'burst' || per.kind === 'stopped' || per.kind === 'aperiodic') aperiodic = true
  if (ref && per.kind === 'periodic' && per.period !== null) {
    const period = per.period
    out.period = period
    out.frequency = period > 0 ? 1 / period : null
    // duty: the time above the mean over the complete cycles between the
    // first and last reference crossing (rising, or falling when the window
    // holds fewer than two rising crossings)
    const other = ref === rises ? falls : rises
    let part = 0
    let o = 0
    for (let k = 0; k < ref.length - 1; k++) {
      while (o < other.length && other[o] <= ref[k]) o++
      if (o >= other.length || other[o] >= ref[k + 1]) {
        part = NaN
        break
      }
      part += other[o] - ref[k]
    }
    const span = ref[ref.length - 1] - ref[0]
    if (Number.isFinite(part) && span > 0) out.duty = ref === rises ? part / span : 1 - part / span
  }

  // ---- 10–90 % transition times
  const lo = vmin + 0.1 * vpp
  const hi = vmin + 0.9 * vpp
  const riseT: number[] = []
  const fallT: number[] = []
  let tLo = NaN // rising: left the 10 % level
  let tHi = NaN // falling: left the 90 % level
  for (let i = 1; i < n; i++) {
    const a = V[i - 1]
    const b = V[i]
    // rising transition
    if (a < lo && b >= lo) tLo = cross(T[i - 1], a, T[i], b, lo)
    if (a < hi && b >= hi && Number.isFinite(tLo)) {
      riseT.push(cross(T[i - 1], a, T[i], b, hi) - tLo)
      tLo = NaN
    }
    if (b < lo) tLo = a >= lo ? NaN : tLo
    // falling transition
    if (a > hi && b <= hi) tHi = cross(T[i - 1], a, T[i], b, hi)
    if (a > lo && b <= lo && Number.isFinite(tHi)) {
      fallT.push(cross(T[i - 1], a, T[i], b, lo) - tHi)
      tHi = NaN
    }
    if (b > hi) tHi = a <= hi ? NaN : tHi
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  out.rise = mean(riseT)
  out.fall = mean(fallT)
  return [out, cycles, aperiodic]
}
