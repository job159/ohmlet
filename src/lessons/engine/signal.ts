/**
 * Signal arithmetic for the lesson evaluator's 'measure' checks — pure
 * functions over what the coordinator recorded (logic edge lists, scope
 * sample rings, sampled values). Nothing here simulates or estimates beyond
 * the stated rule:
 *
 *  - frequency: whole periods between the first and the last edge of one
 *    polarity (rising edges, else falling edges); fewer than two edges of
 *    either polarity = not measurable (reported as such, never guessed);
 *  - duty: high time / span over the same whole periods; a signal with no
 *    edge at all is DC — 100 % when it stays high, 0 % when it stays low;
 *  - analog waveforms (scope samples) are turned into edges at the
 *    mid-level between their minimum and maximum, with a ±10 % swing
 *    hysteresis band, crossing times interpolated between solved samples;
 *  - averages: a time-weighted mean of the solved samples (each sample holds
 *    over the step that produced it), or the plain mean of values sampled at
 *    jittered instants (deterministic pseudo-random phases, so a periodic
 *    signal is never sampled at one fixed phase).
 */

/** Edge list in a window: level before the window and the transitions in it. */
export interface EdgeList {
  /** level at the window start: 0, 1, or 2 = undefined */
  initial: 0 | 1 | 2
  /** transition times (s), ascending */
  times: ArrayLike<number>
  /** level after each transition */
  levels: ArrayLike<number>
}

export interface PeriodStats {
  /** number of 0→1 / 1→0 transitions in the window */
  rising: number
  falling: number
  /** Hz, null when fewer than two edges of one polarity were seen */
  frequency: number | null
  /** 0..1 over whole periods (null when not measurable), or the DC level for a constant signal */
  duty: number | null
  /** the signal never changed in the window: its level (0/1, 2 = undefined) */
  constant: 0 | 1 | 2 | null
}

/** Transitions between defined levels (undefined stretches are skipped). */
function transitions(e: EdgeList): { t: number; to: 0 | 1 }[] {
  const out: { t: number; to: 0 | 1 }[] = []
  let prev = e.initial
  for (let i = 0; i < e.times.length; i++) {
    const lv = e.levels[i] as 0 | 1 | 2
    // a change out of an undefined stretch has no defined edge time: skipped
    if (lv !== 2 && prev !== 2 && lv !== prev) out.push({ t: e.times[i], to: lv })
    prev = lv
  }
  return out
}

/** Frequency and duty cycle of a logic edge list (see the module rules). */
export function periodStats(e: EdgeList): PeriodStats {
  const tr = transitions(e)
  const rising = tr.filter((x) => x.to === 1)
  const falling = tr.filter((x) => x.to === 0)
  if (tr.length === 0) {
    // DC: the last defined level (initial or after undefined stretches)
    let lv: 0 | 1 | 2 = e.initial
    for (let i = 0; i < e.levels.length; i++) if (e.levels[i] !== 2) lv = e.levels[i] as 0 | 1
    return { rising: 0, falling: 0, frequency: null, duty: lv === 2 ? null : lv, constant: lv }
  }
  // whole periods between edges of the polarity that has more edges (ties: rising)
  const ref = rising.length >= 2 && rising.length >= falling.length ? rising : falling.length >= 2 ? falling : rising
  if (ref.length < 2) {
    return { rising: rising.length, falling: falling.length, frequency: null, duty: null, constant: null }
  }
  const a = ref[0].t
  const b = ref[ref.length - 1].t
  const span = b - a
  if (!(span > 0)) return { rising: rising.length, falling: falling.length, frequency: null, duty: null, constant: null }
  const frequency = (ref.length - 1) / span
  // high time inside [a, b]
  let high = 0
  let level: 0 | 1 = ref === rising ? 1 : 0
  let t = a
  for (const x of tr) {
    if (x.t <= a) continue
    if (x.t > b) break
    if (level === 1) high += x.t - t
    level = x.to
    t = x.t
  }
  if (level === 1) high += b - t
  return { rising: rising.length, falling: falling.length, frequency, duty: high / span, constant: null }
}

/**
 * Edges of an analog waveform in [t0, t1]: mid-level threshold between the
 * window's minimum and maximum, ±10 % swing hysteresis, crossing times
 * interpolated linearly between solved samples. Returns null when the swing
 * is below `minSwing` (a DC level — no edges to find).
 */
export function analogEdges(
  t: ArrayLike<number>,
  v: ArrayLike<number>,
  t0: number,
  t1: number,
  minSwing = 0.1,
): (EdgeList & { lo: number; hi: number }) | null {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0 || t[i] > t1 || !Number.isFinite(v[i])) continue
    if (v[i] < lo) lo = v[i]
    if (v[i] > hi) hi = v[i]
  }
  if (!(hi - lo >= minSwing)) return null
  const mid = (lo + hi) / 2
  const band = 0.1 * (hi - lo)
  const up = mid + band
  const down = mid - band
  const times: number[] = []
  const levels: number[] = []
  let state: 0 | 1 | 2 = 2
  let initial: 0 | 1 | 2 = 2
  let pt = NaN
  let pv = NaN
  for (let i = 0; i < t.length; i++) {
    const ti = t[i]
    const vi = v[i]
    if (ti < t0 || ti > t1 || !Number.isFinite(vi)) continue
    if (state === 2) {
      if (vi >= up) state = 1
      else if (vi <= down) state = 0
      initial = state
    } else if (state === 0 && vi >= up) {
      times.push(Number.isFinite(pt) && vi !== pv ? pt + ((mid - pv) / (vi - pv)) * (ti - pt) : ti)
      levels.push(1)
      state = 1
    } else if (state === 1 && vi <= down) {
      times.push(Number.isFinite(pt) && vi !== pv ? pt + ((mid - pv) / (vi - pv)) * (ti - pt) : ti)
      levels.push(0)
      state = 0
    }
    pt = ti
    pv = vi
  }
  return { initial, times, levels, lo, hi }
}

export interface SeriesStats {
  mean: number
  min: number
  max: number
  count: number
}

/**
 * Time-weighted mean of solved samples over [t0, t1]: sample k holds over
 * (t[k−1], t[k]] (the step that produced it); the first sample in the window
 * also covers the stretch from t0. NaN mean when no sample lies in the window.
 */
export function timeWeightedStats(t: ArrayLike<number>, v: ArrayLike<number>, t0: number, t1: number): SeriesStats {
  let acc = 0
  let span = 0
  let min = Infinity
  let max = -Infinity
  let count = 0
  let prev = t0
  for (let i = 0; i < t.length; i++) {
    const ti = t[i]
    if (ti <= t0) continue
    const vi = v[i]
    if (!Number.isFinite(vi)) continue
    const end = Math.min(ti, t1)
    const dt = end - prev
    if (dt > 0) {
      acc += vi * dt
      span += dt
    }
    if (vi < min) min = vi
    if (vi > max) max = vi
    count++
    prev = end
    if (ti >= t1) break
  }
  return { mean: span > 0 ? acc / span : NaN, min, max, count }
}

/** Plain statistics of sampled values (NaN entries skipped). */
export function sampleStats(values: readonly number[]): SeriesStats {
  let acc = 0
  let min = Infinity
  let max = -Infinity
  let count = 0
  for (const x of values) {
    if (!Number.isFinite(x)) continue
    acc += x
    if (x < min) min = x
    if (x > max) max = x
    count++
  }
  return { mean: count > 0 ? acc / count : NaN, min, max, count }
}

/**
 * `n` sampling instants in [t0, t1]: one per equal slot, at a deterministic
 * pseudo-random phase inside its slot (LCG), so periodic waveforms (PWM,
 * blinking) are averaged instead of aliased onto one phase.
 */
export function jitteredInstants(t0: number, t1: number, n: number, seed = 0x2f6b1d): number[] {
  const out: number[] = []
  const slot = (t1 - t0) / n
  let s = seed >>> 0
  for (let k = 0; k < n; k++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const u = s / 4294967296
    out.push(t0 + (k + u) * slot)
  }
  return out
}
