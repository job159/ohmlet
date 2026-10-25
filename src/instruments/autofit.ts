/**
 * Time-axis auto-fit for the logic analyzer (UX IS-1) — pure functions over
 * edge captures, shared by the view and its tests.
 *
 *   typicalPeriod   median interval between consecutive rising edges (or
 *                   between consecutive edges when a window holds fewer
 *                   than two rising edges — a slow toggle seen once)
 *   busiestTrace    the channel with the most edges in a window
 *   spanForPeriod   the smallest ladder span that shows ≥ 4 periods (the
 *                   1-2-5 ladder then shows 4–10 of them)
 *   fitLogicSpan    the whole decision: frames first (1.5 × the newest
 *                   decoded frame), else the SLOWEST channel that repeats
 *                   (QA clarity LA-FIT: every channel's signal is in the
 *                   window — 2 periods of the slowest when the periodic
 *                   channels differ in speed, else 4–10 periods), else the
 *                   busiest channel's typical interval
 *
 * Nothing here guesses: no edges → no fit (the view keeps its span and says
 * how to find the signal).
 */
import type { LogicCapture, LogicTrace } from '../sim/coordinator/api'
import { measureEdges } from './measure'

/** 1-2-5 zoom ladder of the logic analyzer: 1 µs … 20 s visible span. */
export const LA_SPANS: readonly number[] = (() => {
  const out: number[] = []
  for (let e = -6; e <= 1; e++) for (const m of [1, 2, 5]) out.push(Number((m * 10 ** e).toPrecision(3)))
  return out.filter((s) => s <= 20)
})()

/** How many periods the fitted window shows at least. */
export const FIT_MIN_PERIODS = 4
/** A decoded frame fills 1 / FIT_FRAME_ZOOM of the fitted window. */
export const FIT_FRAME_ZOOM = 1.5
/** Periodic channels of different speeds: the window shows at least this many periods of the slowest (QA clarity LA-FIT). */
export const FIT_SLOW_PERIODS = 2
/** Periods closer than this ratio count as one speed (a blink's PA5 and PC13): the single-speed fit (4–10 periods) applies. */
const SAME_SPEED_RATIO = 1.5
/** A window longer than this many periods of the fastest channel cannot show it: the per-channel table is opened instead. */
export const FIT_FAST_LIMIT = 2000

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type EdgeTrace = Pick<LogicTrace, 'initial' | 'times' | 'levels'>

/**
 * Typical repetition interval of `trace` inside [t0, t1] (s): the median
 * interval between consecutive RISING edges, or between consecutive edges
 * of any kind when the window holds fewer than two rising edges (a slow
 * toggle seen once: a half period at best — fine for choosing a zoom, never
 * for a printed frequency, which passes `risingOnly`). Edges into or out of
 * the undefined level (2) are not counted. null with fewer than two usable
 * edges.
 */
export function typicalPeriod(
  trace: EdgeTrace,
  t0 = -Infinity,
  t1 = Infinity,
  opts: { risingOnly?: boolean } = {},
): number | null {
  const rises: number[] = []
  const all: number[] = []
  let prev: number = trace.initial
  for (let i = 0; i < trace.times.length; i++) {
    const t = trace.times[i]
    const next = trace.levels[i]
    if (t >= t0 && t <= t1 && prev !== 2 && next !== 2 && prev !== next) {
      all.push(t)
      if (prev === 0 && next === 1) rises.push(t)
    }
    prev = next
  }
  const ref = rises.length >= 2 ? rises : opts.risingOnly ? [] : all
  if (ref.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < ref.length; i++) if (ref[i] > ref[i - 1]) gaps.push(ref[i] - ref[i - 1])
  const p = median(gaps)
  return p !== null && p > 0 ? p : null
}

/** Defined-level edges of `trace` inside [t0, t1]. */
export function edgeCount(trace: EdgeTrace, t0 = -Infinity, t1 = Infinity): number {
  let n = 0
  let prev: number = trace.initial
  for (let i = 0; i < trace.times.length; i++) {
    const t = trace.times[i]
    const next = trace.levels[i]
    if (t >= t0 && t <= t1 && prev !== next && prev !== 2 && next !== 2) n++
    prev = next
  }
  return n
}

/** The trace with the most edges in [t0, t1] (ties: the lower channel index); null when none has an edge. */
export function busiestTrace(cap: Pick<LogicCapture, 'traces'>, t0 = -Infinity, t1 = Infinity): LogicTrace | null {
  let best: LogicTrace | null = null
  let bestN = 0
  for (const tr of [...cap.traces].sort((a, b) => a.index - b.index)) {
    const n = edgeCount(tr, t0, t1)
    if (n > bestN) {
      best = tr
      bestN = n
    }
  }
  return best
}

/** The smallest ladder span ≥ `x` (the largest when none is). */
export function spanAtLeast(x: number, spans: readonly number[] = LA_SPANS): number {
  for (const s of spans) if (s >= x * (1 - 1e-9)) return s
  return spans[spans.length - 1]
}

/**
 * The window for a signal repeating every `period`: the smallest ladder span
 * that shows at least FIT_MIN_PERIODS periods. Ladder steps are ≤ 2.5×, so
 * the window shows 4–10 periods (1 kHz → 5 ms, 0.998 Hz → 5 s).
 */
export function spanForPeriod(period: number, spans: readonly number[] = LA_SPANS): number {
  return spanAtLeast(FIT_MIN_PERIODS * period, spans)
}

export type LogicFit =
  | { kind: 'none' }
  /**
   * follow the clock with this span (channel `channel` repeats every
   * `period`); `complete` = a full rising-to-rising period was seen (else the
   * span comes from one edge-to-edge interval and should be re-checked).
   * QA clarity LA-FIT: `slowest` = the channel was chosen as the slowest of
   * several periodic channels of different speeds (the view says so);
   * `periods` = how many of its periods the span shows; `measCol` = the
   * fastest channel repeats more than FIT_FAST_LIMIT times in the span (too
   * dense to read — the view opens the per-channel table); `undecided` = a
   * channel has edges but too few to judge its period yet (a slower one may
   * still come: the caller looks further back before settling).
   */
  | {
      kind: 'period'
      span: number
      period: number
      channel: number
      complete: boolean
      slowest?: boolean
      periods?: number
      measCol?: boolean
      undecided?: boolean
    }
  /** freeze on the newest decoded frame: window [end − span, end] */
  | { kind: 'frame'; span: number; end: number; frame: { t0: number; t1: number } }

/**
 * Auto-fit decision. `frames` (decoded transactions, any order): fit the
 * newest one at 1.5 × its duration, centred. Otherwise the busiest channel
 * of `cap` inside [t0, t1] sets the span from its typical period. `none`
 * when there is nothing to fit (no frame, < 2 edges).
 */
export function fitLogicSpan(
  cap: Pick<LogicCapture, 'traces'> & Partial<Pick<LogicCapture, 'overflow'>>,
  frames: readonly { t0: number; t1: number }[],
  opts: {
    t0?: number
    t1?: number
    spans?: readonly number[]
    /** QA clarity LA-FIT: fit the slowest periodic channel (default); false = the classic busiest-channel fit */
    slowest?: boolean
  } = {},
): LogicFit {
  const spans = opts.spans ?? LA_SPANS
  let last: { t0: number; t1: number } | null = null
  for (const f of frames) if (!last || f.t1 > last.t1) last = f
  if (last) {
    const dur = Math.max(last.t1 - last.t0, spans[0] / FIT_FRAME_ZOOM)
    const span = spanAtLeast(FIT_FRAME_ZOOM * dur, spans)
    return { kind: 'frame', span, end: (last.t0 + last.t1) / 2 + span / 2, frame: { t0: last.t0, t1: last.t1 } }
  }
  const t0 = opts.t0 ?? -Infinity
  const t1 = opts.t1 ?? Infinity
  // QA clarity LA-FIT: every channel that repeats must show its signal — fit the slowest
  const periodic: { index: number; period: number }[] = []
  let undecided = false
  for (const tr of opts.slowest === false ? [] : [...cap.traces].sort((a, b) => a.index - b.index)) {
    const n = edgeCount(tr, t0, t1)
    if (n === 0) continue
    // a channel bound a moment ago, or a wrapped ring: judge from the first edge it still holds
    const from = Math.max(t0, tr.since ?? -Infinity, cap.overflow && tr.times.length > 0 ? tr.times[0] : -Infinity)
    const m = measureEdges(tr, from, t1)
    if (m.periodicity === 'periodic' && m.period !== null && m.period > 0) periodic.push({ index: tr.index, period: m.period })
    else if (m.periodicity === 'unknown') undecided = true
  }
  if (periodic.length > 0) {
    let slow = periodic[0]
    let fast = periodic[0]
    for (const p of periodic) {
      if (p.period > slow.period * (1 + 1e-9)) slow = p
      if (p.period < fast.period) fast = p
    }
    const mixed = slow.period / fast.period > SAME_SPEED_RATIO
    const span = mixed ? spanAtLeast(FIT_SLOW_PERIODS * slow.period, spans) : spanForPeriod(slow.period, spans)
    const out: LogicFit = {
      kind: 'period',
      span,
      period: slow.period,
      channel: slow.index,
      complete: true,
      periods: Math.floor(span / slow.period + 1e-6),
    }
    if (mixed) out.slowest = true
    if (span > FIT_FAST_LIMIT * fast.period) out.measCol = true
    if (undecided) out.undecided = true
    return out
  }
  const tr = busiestTrace(cap, t0, t1)
  if (!tr) return { kind: 'none' }
  const rising = typicalPeriod(tr, t0, t1, { risingOnly: true })
  const period = rising ?? typicalPeriod(tr, t0, t1)
  if (period === null) return { kind: 'none' }
  return { kind: 'period', span: spanForPeriod(period, spans), period, channel: tr.index, complete: rising !== null }
}

/**
 * Nearest edge time of `trace` strictly after (dir 1) or before (dir -1)
 * `t`; null when there is none in the trace.
 */
export function adjacentEdge(trace: EdgeTrace, t: number, dir: 1 | -1, eps = 0): number | null {
  let prev: number = trace.initial
  let best: number | null = null
  for (let i = 0; i < trace.times.length; i++) {
    const te = trace.times[i]
    const next = trace.levels[i]
    if (next !== prev) {
      if (dir === 1 && te > t + eps) return te
      if (dir === -1 && te < t - eps) best = te
    }
    prev = next
  }
  return dir === -1 ? best : null
}
