/**
 * Read-only view of one logic channel's edge list (LogicTrace) for the
 * decoders and measurements: level at an instant, edge iteration and
 * binary searches. Levels are 0, 1 or 2 (= undefined: floating,
 * contention, unknown); an edge at time t defines the level AT t.
 */
import type { LogicTrace } from '../sim/coordinator/api'

export type Level = 0 | 1 | 2

export class Signal {
  readonly initial: Level
  readonly times: Float64Array
  readonly levels: Uint8Array

  /**
   * `invert` swaps 0 and 1 (2 stays undefined) — an idle-low UART line or
   * an active-high chip select is decoded as its complement.
   */
  constructor(trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>, invert = false) {
    this.times = trace.times
    if (!invert) {
      this.initial = trace.initial
      this.levels = trace.levels
    } else {
      const flip = (l: number): Level => (l === 0 ? 1 : l === 1 ? 0 : 2)
      this.initial = flip(trace.initial)
      const lv = new Uint8Array(trace.levels.length)
      for (let i = 0; i < lv.length; i++) lv[i] = flip(trace.levels[i])
      this.levels = lv
    }
  }

  get count(): number {
    return this.times.length
  }

  /** Index of the first edge with time > t (count when none). */
  firstAfter(t: number): number {
    let lo = 0
    let hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Index of the first edge with time >= t (count when none). */
  firstAtOrAfter(t: number): number {
    let lo = 0
    let hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Level at time t (after every edge with time <= t). */
  at(t: number): Level {
    const i = this.firstAfter(t) - 1
    return i < 0 ? this.initial : (this.levels[i] as Level)
  }

  /**
   * Level just before t (edges AT t excluded) — what a flip-flop clocked at
   * t captures: data launched by an edge at the same instant misses it
   * (hold time).
   */
  justBefore(t: number): Level {
    const i = this.firstAtOrAfter(t) - 1
    return i < 0 ? this.initial : (this.levels[i] as Level)
  }

  /** Level just before edge i. */
  before(i: number): Level {
    return i <= 0 ? this.initial : (this.levels[i - 1] as Level)
  }

  /** Level after edge i. */
  after(i: number): Level {
    return this.levels[i] as Level
  }
}
