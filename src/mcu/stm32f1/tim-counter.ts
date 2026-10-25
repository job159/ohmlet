/**
 * TIMx counter arithmetic (RM0008 §14.3.2 / §15.3.2) — pure functions over
 * the 16-bit counter state. tim.ts keeps its counter LAZY: it never ticks,
 * it jumps straight to the next step that matters (an update, a compare
 * match, an output edge) with these closed forms.
 *
 * One "step" = one CK_CNT period (the counter moves by one). Modes:
 *  - 'up'   (edge-aligned, DIR = 0): 0 → ARR, then 0 with a counter
 *           overflow ('ovf'), period ARR + 1 steps (Figure 103);
 *  - 'down' (edge-aligned, DIR = 1): ARR → 0, then ARR with a counter
 *           underflow ('unf'), period ARR + 1 steps;
 *  - 'center' (CMS ≠ 00): 0 → ARR, overflow on REACHING ARR, then ARR → 0,
 *           underflow on reaching 0, period 2·ARR steps (§15.3.2
 *           "Center-aligned mode", Figure 113: the overflow coincides with
 *           CNT = ARR, the underflow with CNT = 0). DIR is the direction of
 *           the next step: down at ARR, up at 0.
 * A counter above ARR (ARR lowered without preload, or CNT written above
 * it) misses its CNT = ARR comparison: counting up it runs to 0xFFFF and
 * rolls over to 0 WITHOUT an overflow event ('roll'); counting down it
 * simply passes ARR. ARR = 0 blocks the counter (§15.4.12) — callers never
 * step it then.
 *
 * `stepOnce` is the reference behaviour; `stepsToEnter` / `stepsToWrap` /
 * `advance` are its closed forms and are checked against it step by step in
 * tests/mcu/stm32f1/tim-counter.test.ts.
 */

export type CountMode = 'up' | 'down' | 'center'

export interface Counter {
  cnt: number
  /** direction of the next step (center-aligned) / DIR (edge-aligned) */
  down: boolean
}

/** What a step did at its end: overflow, underflow, silent 0xFFFF → 0 roll, nothing. */
export type Wrap = 'ovf' | 'unf' | 'roll' | null

/** Direction filter for compare matches (CMS flag rules, §15.4.1). */
export type MatchDir = 'any' | 'up' | 'down'

const TOP = 0x10000

/** Center-aligned: the counter at ARR always turns down, at 0 always up. */
function norm(c: Counter, arr: number): void {
  if (c.cnt === arr) c.down = true
  else if (c.cnt === 0) c.down = false
}

/** Center-aligned phase in [0, 2·ARR) of a counter with cnt ≤ ARR. */
function phase(c: Counter, arr: number): number {
  if (c.cnt === arr) return arr
  if (c.cnt === 0) return 0
  return c.down ? 2 * arr - c.cnt : c.cnt
}

function fromPhase(c: Counter, arr: number, ph: number): void {
  c.cnt = ph <= arr ? ph : 2 * arr - ph
  c.down = ph >= arr
}

/** steps from phase p0 to the next phase ≡ target (mod L), in 1..L */
function phaseSteps(p0: number, target: number, L: number): number {
  const s = (((target - p0) % L) + L) % L
  return s === 0 ? L : s
}

/**
 * One counter step (the reference model). Mutates `c`; returns the wrap at
 * its end and whether it was an up-step (for the CMS compare-flag rules).
 */
export function stepOnce(mode: CountMode, c: Counter, arr: number): { wrap: Wrap; up: boolean } {
  if (mode === 'up') {
    c.down = false
    if (c.cnt === arr) {
      c.cnt = 0
      return { wrap: 'ovf', up: true }
    }
    if (c.cnt === 0xffff) {
      c.cnt = 0
      return { wrap: 'roll', up: true }
    }
    c.cnt++
    return { wrap: null, up: true }
  }
  if (mode === 'down') {
    c.down = true
    if (c.cnt === 0) {
      c.cnt = arr
      return { wrap: 'unf', up: false }
    }
    c.cnt--
    return { wrap: null, up: false }
  }
  if (c.cnt <= arr) norm(c, arr)
  if (!c.down) {
    if (c.cnt === 0xffff) {
      c.cnt = 0
      return { wrap: 'roll', up: true }
    }
    c.cnt++
    if (c.cnt === arr) {
      c.down = true
      return { wrap: 'ovf', up: true }
    }
    return { wrap: null, up: true }
  }
  c.cnt--
  if (c.cnt === 0) {
    c.down = false
    return { wrap: 'unf', up: false }
  }
  return { wrap: null, up: false }
}

/** Steps (≥ 1) until the next step that ends in a wrap ('ovf' | 'unf' | 'roll'). */
export function stepsToWrap(mode: CountMode, c: Counter, arr: number): number {
  if (mode === 'up') return c.cnt <= arr ? arr - c.cnt + 1 : TOP - c.cnt
  if (mode === 'down') return c.cnt + 1
  if (c.cnt > arr) return c.down ? c.cnt : TOP - c.cnt
  const p = phase(c, arr)
  return arr - (p % arr)
}

/**
 * Steps (≥ 1) until the counter next ENTERS value `v` (a step ending on v),
 * optionally only by an up-step or a down-step; Infinity if never.
 */
export function stepsToEnter(mode: CountMode, c: Counter, arr: number, v: number, dir: MatchDir = 'any'): number {
  const cnt = c.cnt
  if (mode === 'up') {
    if (dir === 'down') return Infinity
    if (cnt <= arr) {
      if (v > arr) return Infinity
      return v > cnt ? v - cnt : arr - cnt + 1 + v
    }
    if (v > cnt) return v - cnt
    return v <= arr ? TOP - cnt + v : Infinity
  }
  if (mode === 'down') {
    if (dir === 'up') return Infinity
    if (v < cnt) return cnt - v
    return v <= arr ? cnt + 1 + (arr - v) : Infinity
  }
  // center-aligned
  if (cnt > arr) {
    if (c.down) {
      // linear down to ARR, then the normal cycle from (ARR, down)
      if (v < cnt && v >= arr && dir !== 'up') return cnt - v
      const seg = cnt - arr
      return seg + centerEnter(arr, arr, v, dir)
    }
    // linear up to 0xFFFF, roll to 0 (an up-step entering 0), then normal from (0, up)
    if (dir !== 'down') {
      if (v > cnt) return v - cnt
      if (v === 0) return TOP - cnt
    }
    return TOP - cnt + centerEnter(arr, 0, v, dir)
  }
  return centerEnter(arr, phase(c, arr), v, dir)
}

function centerEnter(arr: number, p0: number, v: number, dir: MatchDir): number {
  const L = 2 * arr
  let best = Infinity
  if (dir !== 'down' && v >= 1 && v <= arr) best = phaseSteps(p0, v, L)
  if (dir !== 'up' && v >= 0 && v < arr) best = Math.min(best, phaseSteps(p0, (L - v) % L, L))
  return best
}

/**
 * Advance `n` ≥ 0 steps without looking at them (the caller knows nothing
 * relevant happens in between). Mutates `c`; returns the number of 'ovf' +
 * 'unf' wraps passed (rolls are not counted).
 */
export function advance(mode: CountMode, c: Counter, arr: number, n: number): number {
  if (n <= 0) return 0
  if (mode === 'up') {
    c.down = false
    if (c.cnt > arr) {
      const w = TOP - c.cnt
      if (n < w) {
        c.cnt += n
        return 0
      }
      n -= w
      c.cnt = 0
    }
    const total = c.cnt + n
    const L = arr + 1
    c.cnt = total % L
    return Math.floor(total / L)
  }
  if (mode === 'down') {
    c.down = true
    if (n <= c.cnt) {
      c.cnt -= n
      return 0
    }
    n -= c.cnt + 1
    const L = arr + 1
    c.cnt = arr - (n % L)
    return 1 + Math.floor(n / L)
  }
  if (c.cnt > arr) {
    if (c.down) {
      const w = c.cnt - arr
      if (n <= w) {
        c.cnt -= n
        return 0
      }
      n -= w
      c.cnt = arr
    } else {
      const w = TOP - c.cnt
      if (n < w) {
        c.cnt += n
        return 0
      }
      n -= w
      c.cnt = 0
      c.down = false
    }
  }
  const L = 2 * arr
  const p0 = phase(c, arr)
  const p = p0 + n
  const wraps = Math.floor(p / arr) - Math.floor(p0 / arr)
  fromPhase(c, arr, p % L)
  return wraps
}

/** Direction the PWM comparison uses for the current counter state. */
export function countingDown(mode: CountMode, c: Counter, arr: number): boolean {
  if (mode === 'up') return false
  if (mode === 'down') return true
  if (c.cnt === arr) return true
  if (c.cnt === 0) return false
  return c.down
}

/**
 * PWM mode 1 reference level (§15.3.9): counting up, OCxREF is active while
 * CNT < CCRx; counting down, active while CNT ≤ CCRx (so CCRx > ARR holds it
 * active, CCRx = 0 holds it inactive except — counting down edge-aligned —
 * for the one step at 0: "0 % PWM is not possible"). PWM mode 2 is the
 * complement.
 */
export function pwm1Active(mode: CountMode, c: Counter, arr: number, ccr: number): boolean {
  return countingDown(mode, c, arr) ? c.cnt <= ccr : c.cnt < ccr
}
