/**
 * Trigger searches — pure functions over captures.
 *
 * Logic analyzer:
 *   - edge trigger: the first rising / falling / any edge of one channel
 *     after the arm time (transitions to or from the undefined level count
 *     as edges only for 'any');
 *   - pattern trigger: the first instant after the arm time at which every
 *     specified channel holds its required level (0 / 1; unspecified
 *     channels are don't-care) — the pattern must BECOME true (a pattern
 *     already true at the arm time waits for the next entry).
 *
 * Oscilloscope: level crossings with slope, hysteresis (the signal must
 * first be on the other side of level ∓ hysteresis — noise around the level
 * does not retrigger) and holdoff (after a trigger, crossings within the
 * holdoff time are ignored). Crossing times are linearly interpolated
 * between samples, so a periodic signal triggers at a stable phase.
 */
import type { LogicCapture } from '../sim/coordinator/api'
import { Signal } from './signal'

export type EdgeSlope = 'rising' | 'falling' | 'any'

export type LogicTriggerSpec =
  | { kind: 'edge'; channel: number; slope: EdgeSlope }
  | { kind: 'pattern'; pattern: Record<number, 0 | 1> }

/** Time of the first trigger event strictly after `after` (null: none in the capture). */
export function findLogicTrigger(capture: LogicCapture, spec: LogicTriggerSpec, after: number): number | null {
  if (spec.kind === 'edge') {
    const tr = capture.traces.find((t) => t.index === spec.channel)
    if (!tr) return null
    const sig = new Signal(tr)
    for (let i = sig.firstAfter(after); i < sig.count; i++) {
      const b = sig.before(i)
      const a = sig.after(i)
      if (a === b) continue
      if (spec.slope === 'any') return sig.times[i]
      if (spec.slope === 'rising' && b === 0 && a === 1) return sig.times[i]
      if (spec.slope === 'falling' && b === 1 && a === 0) return sig.times[i]
    }
    return null
  }
  const entries = Object.entries(spec.pattern).map(([k, v]) => [Number(k), v] as const)
  if (entries.length === 0) return null
  const sigs: { sig: Signal; want: 0 | 1 }[] = []
  for (const [ch, want] of entries) {
    const tr = capture.traces.find((t) => t.index === ch)
    if (!tr) return null
    sigs.push({ sig: new Signal(tr), want })
  }
  const matches = (t: number) => sigs.every(({ sig, want }) => sig.at(t) === want)
  // candidate instants: every edge of an involved channel after the arm time
  const times: number[] = []
  for (const { sig } of sigs) for (let i = sig.firstAfter(after); i < sig.count; i++) times.push(sig.times[i])
  times.sort((a, b) => a - b)
  let prev = matches(after)
  for (const t of times) {
    const now = matches(t)
    if (now && !prev) return t
    prev = now
  }
  return null
}

export interface ScopeTriggerOptions {
  level: number
  slope: 'rising' | 'falling'
  /** V; the re-arm band (default 0) */
  hysteresis?: number
  /** s; minimum time between accepted triggers (default 0) */
  holdoff?: number
  /** search window (default: everything) */
  from?: number
  to?: number
}

/** Every accepted trigger time in the samples, ascending. */
export function findScopeTriggers(t: ArrayLike<number>, v: ArrayLike<number>, o: ScopeTriggerOptions): number[] {
  const out: number[] = []
  const h = Math.max(0, o.hysteresis ?? 0)
  const holdoff = Math.max(0, o.holdoff ?? 0)
  const from = o.from ?? -Infinity
  const to = o.to ?? Infinity
  const rising = o.slope === 'rising'
  let armed = false
  let lastTrig = -Infinity
  let pt = NaN
  let pv = NaN
  for (let i = 0; i < t.length; i++) {
    const ti = t[i]
    const vi = v[i]
    if (ti > to) break
    if (!Number.isFinite(vi)) {
      pv = NaN
      continue
    }
    if (rising ? vi < o.level - h : vi > o.level + h) armed = true
    if (
      armed &&
      Number.isFinite(pv) &&
      (rising ? pv < o.level && vi >= o.level : pv > o.level && vi <= o.level)
    ) {
      const tc = vi === pv ? ti : pt + ((o.level - pv) / (vi - pv)) * (ti - pt)
      if (tc >= from && tc - lastTrig >= holdoff) {
        out.push(tc)
        lastTrig = tc
      }
      armed = false
    }
    pt = ti
    pv = vi
  }
  return out
}
