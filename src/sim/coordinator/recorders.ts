/**
 * Fixed-capacity ring buffers behind the logic analyzer and the
 * high-resolution oscilloscope. Preallocated typed arrays — recording never
 * allocates; captures copy a window out (the host transfers the buffers).
 */

/** Edge list of one logic channel (level after each edge: 0, 1, 2 = undefined). */
export class EdgeRing {
  private readonly times: Float64Array
  private readonly levels: Uint8Array
  private start = 0
  private count = 0
  /** level before the first retained edge (valid while nothing was dropped) */
  private initial: 0 | 1 | 2 = 2
  private dropped = false
  /** current level (after the latest edge) */
  last: 0 | 1 | 2 = 2

  constructor(readonly capacity = 1 << 16) {
    this.times = new Float64Array(capacity)
    this.levels = new Uint8Array(capacity)
  }

  /** Record `level` from time `t` on (no-op when unchanged). */
  push(t: number, level: 0 | 1 | 2): void {
    if (level === this.last) return
    const cap = this.capacity
    if (this.count === cap) {
      // drop the oldest edge
      this.start = (this.start + 1) % cap
      this.count--
      this.dropped = true
    }
    const k = (this.start + this.count) % cap
    this.times[k] = t
    this.levels[k] = level
    this.count++
    this.last = level
  }

  /** Forget everything; `level` is the level from now on. */
  clear(level: 0 | 1 | 2 = 2): void {
    this.start = 0
    this.count = 0
    this.dropped = false
    this.initial = level
    this.last = level
  }

  private timeAt(i: number): number {
    return this.times[(this.start + i) % this.capacity]
  }

  /** Index of the last edge with time <= t (−1 if none). */
  private lastAtOrBefore(t: number): number {
    let lo = 0
    let hi = this.count - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.timeAt(mid) <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  capture(t0: number, t1: number): {
    initial: 0 | 1 | 2
    times: Float64Array
    levels: Uint8Array
    overflow: boolean
  } {
    const a = this.lastAtOrBefore(t0)
    let initial: 0 | 1 | 2
    let overflow = false
    if (a >= 0) initial = this.levels[(this.start + a) % this.capacity] as 0 | 1 | 2
    else if (!this.dropped) initial = this.initial
    else {
      initial = 2
      overflow = true
    }
    const b = this.lastAtOrBefore(t1)
    const n = Math.max(0, b - a)
    const times = new Float64Array(n)
    const levels = new Uint8Array(n)
    for (let j = 0; j < n; j++) {
      const k = (this.start + a + 1 + j) % this.capacity
      times[j] = this.times[k]
      levels[j] = this.levels[k]
    }
    return { initial, times, levels, overflow }
  }
}

/** Voltage samples of one oscilloscope channel (variable step, as solved). */
export class SampleRing {
  private readonly t: Float64Array
  private readonly v: Float32Array
  private start = 0
  private count = 0

  constructor(readonly capacity = 1 << 17) {
    this.t = new Float64Array(capacity)
    this.v = new Float32Array(capacity)
  }

  push(t: number, v: number): void {
    const cap = this.capacity
    if (this.count === cap) {
      this.start = (this.start + 1) % cap
      this.count--
    }
    const k = (this.start + this.count) % cap
    this.t[k] = t
    this.v[k] = v
    this.count++
  }

  clear(): void {
    this.start = 0
    this.count = 0
  }

  get size(): number {
    return this.count
  }

  private timeAt(i: number): number {
    return this.t[(this.start + i) % this.capacity]
  }

  /** First index with time >= t (inclusive = false) or time > t (inclusive = true). */
  private bound(t: number, inclusive: boolean): number {
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const tm = this.timeAt(mid)
      if (tm < t || (inclusive && tm === t)) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /**
   * Samples with t0 <= t <= t1. Above `maxPoints` the window is decimated
   * per bucket to its min and max sample (in time order), which keeps
   * narrow spikes visible; `decimated` tells which happened (averages over
   * a decimated window are approximate).
   */
  capture(t0: number, t1: number, maxPoints?: number): { t: Float64Array; v: Float32Array; decimated: boolean } {
    const a = this.bound(t0, false)
    const end = this.bound(t1, true)
    const n = Math.max(0, end - a)
    const cap = this.capacity
    if (!maxPoints || maxPoints <= 0 || n <= maxPoints) {
      const t = new Float64Array(n)
      const v = new Float32Array(n)
      for (let j = 0; j < n; j++) {
        const k = (this.start + a + j) % cap
        t[j] = this.t[k]
        v[j] = this.v[k]
      }
      return { t, v, decimated: false }
    }
    const buckets = Math.max(1, Math.floor(maxPoints / 2))
    const outT: number[] = []
    const outV: number[] = []
    for (let bk = 0; bk < buckets; bk++) {
      const s = a + Math.floor((bk * n) / buckets)
      const e = a + Math.floor(((bk + 1) * n) / buckets)
      if (e <= s) continue
      let iMin = s
      let iMax = s
      for (let i = s; i < e; i++) {
        const vi = this.v[(this.start + i) % cap]
        if (vi < this.v[(this.start + iMin) % cap]) iMin = i
        if (vi > this.v[(this.start + iMax) % cap]) iMax = i
      }
      const first = Math.min(iMin, iMax)
      const second = Math.max(iMin, iMax)
      outT.push(this.t[(this.start + first) % cap])
      outV.push(this.v[(this.start + first) % cap])
      if (second !== first) {
        outT.push(this.t[(this.start + second) % cap])
        outV.push(this.v[(this.start + second) % cap])
      }
    }
    return { t: Float64Array.from(outT), v: Float32Array.from(outV), decimated: true }
  }
}

/**
 * Voltage extremes of one thresholded (analog-net) logic channel, in fixed
 * time buckets (UX IS-16): the analyzer can then say when its 0.8 / 2.0 V
 * thresholds hide a signal (「訊號 0–1.75 V，未達高電位門檻 2.0 V」).
 * Preallocated; a bucket is reused when its slot comes round again, so the
 * ring keeps the last `capacity × bucket` seconds (6.5 s by default) and a
 * query reports the extremes of the buckets overlapping the window (a few
 * hundred microseconds wider than the window at most — fine for "does the
 * net ever reach the threshold").
 */
export class RangeRing {
  private readonly keys: Float64Array
  private readonly mins: Float32Array
  private readonly maxs: Float32Array

  constructor(
    readonly bucket = 1e-4,
    readonly capacity = 1 << 16,
  ) {
    this.keys = new Float64Array(capacity).fill(-1)
    this.mins = new Float32Array(capacity)
    this.maxs = new Float32Array(capacity)
  }

  push(t: number, v: number): void {
    if (!Number.isFinite(v) || !(t >= 0)) return
    const k = Math.floor(t / this.bucket)
    const slot = k % this.capacity
    if (this.keys[slot] !== k) {
      this.keys[slot] = k
      this.mins[slot] = v
      this.maxs[slot] = v
      return
    }
    if (v < this.mins[slot]) this.mins[slot] = v
    if (v > this.maxs[slot]) this.maxs[slot] = v
  }

  clear(): void {
    this.keys.fill(-1)
  }

  /** Extremes over [t0, t1] (null when no sample of the window is kept). */
  range(t0: number, t1: number): { min: number; max: number } | null {
    if (!(t1 >= t0)) return null
    const k1 = Math.floor(Math.max(0, t1) / this.bucket)
    const k0 = Math.max(Math.floor(Math.max(0, t0) / this.bucket), k1 - this.capacity + 1)
    let min = Infinity
    let max = -Infinity
    for (let k = k0; k <= k1; k++) {
      const slot = k % this.capacity
      if (this.keys[slot] !== k) continue
      if (this.mins[slot] < min) min = this.mins[slot]
      if (this.maxs[slot] > max) max = this.maxs[slot]
    }
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
  }
}
