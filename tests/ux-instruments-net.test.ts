/**
 * UX fix wave — instruments IS-12 (P0): the net live summary (H4) answers
 * the acceptance cases and judges periodicity exactly like the logic
 * analyzer and the scope (one rule — classifyPeriods), so a PWM net reads
 * the same frequency on the hover chip, the pin rows and the instruments.
 */
import { describe, expect, it } from 'vitest'
import { NET_LIVE_WINDOW_S, measureEdges, netLiveSummary, netSummary } from '../src/instruments/measure'
import type { LogicTrace } from '../src/sim/coordinator/api'

type Edges = Pick<LogicTrace, 'initial' | 'times' | 'levels'>

/** A PWM of frequency f from t0 to t1 whose duty per period is duty(k) (0 = no pulse that period). */
function pwm(f: number, duty: (k: number) => number, t0: number, t1: number): Edges {
  const times: number[] = []
  const levels: number[] = []
  let k = 0
  for (let t = t0; t < t1 - 1e-12; t += 1 / f, k++) {
    const d = duty(k)
    if (d <= 0) continue
    times.push(t)
    levels.push(1)
    if (t + d / f < t1) {
      times.push(t + d / f)
      levels.push(0)
    }
  }
  return { initial: 0, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
}

describe('IS-12 net live summary (H4)', () => {
  it('a 1 kHz / 34 % PWM → pwm 1 kHz, 34 %, average from the high level', () => {
    const live = netLiveSummary({ trace: pwm(1000, () => 0.34, 0.8, 1.0), t0: 1.0 - NET_LIVE_WINDOW_S, t1: 1.0, v: 0, vHigh: 3.1 })
    expect(live).toMatchObject({ kind: 'pwm' })
    if (live.kind !== 'pwm') return
    expect(live.f).toBeCloseTo(1000, 3)
    expect(live.duty).toBeCloseTo(0.34, 3)
    expect(live.vavg).toBeCloseTo(0.34 * 3.1, 3)
  })
  it('3.3 V DC → dc; a recorded net without edges → dc', () => {
    const quiet: Edges = { initial: 1, times: new Float64Array(0), levels: new Uint8Array(0) }
    expect(netLiveSummary({ trace: quiet, t0: 0.9, t1: 1.0, v: 3.3 })).toEqual({ kind: 'dc', v: 3.3 })
    const quietLow: Edges = { initial: 0, times: new Float64Array(0), levels: new Uint8Array(0) }
    expect(netLiveSummary({ trace: quietLow, t0: 0.9, t1: 1.0, v: 0 })).toEqual({ kind: 'dc', v: 0 })
  })
  it('pwm-fade at the bottom of its sweep (10 periods without a pulse) is still the 1 kHz PWM — as on the scope', () => {
    const tr = pwm(1000, (k) => (k >= 40 && k < 50 ? 0 : 0.03), 0.9, 1.0)
    const live = netLiveSummary({ trace: tr, t0: 0.9, t1: 1.0, v: 0, vHigh: 3.1 })
    expect(live.kind).toBe('pwm')
    if (live.kind !== 'pwm') return
    expect(live.f).toBeCloseTo(1000, 3)
    // the very number the logic analyzer / scope compute over the same window
    expect(live.f).toBeCloseTo(measureEdges(tr, 0.9, 1.0).frequency!, 9)
  })
  it('netSummary and measureEdges agree on every window (one periodicity rule)', () => {
    const tr = pwm(1000, (k) => 0.2 + 0.01 * (k % 50), 0, 0.5)
    for (const [a, b] of [
      [0.1, 0.2],
      [0.0, 0.5],
      [0.3, 0.305],
    ]) {
      const s = netSummary(tr, a, b)
      const m = measureEdges(tr, a, b)
      if (s.periodic) expect(s.frequency).toBe(m.frequency)
      // not a live PWM only when the analyzer does not call it periodic either, or sees < 2 complete periods
      else expect(m.periodicity !== 'periodic' || m.rising < 3).toBe(true)
    }
  })
})
