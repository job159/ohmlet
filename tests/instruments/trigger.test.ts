/**
 * Trigger searches: logic edge / pattern, scope level + slope + hysteresis
 * + holdoff.
 */
import { describe, expect, it } from 'vitest'
import { findLogicTrigger, findScopeTriggers } from '../../src/instruments/trigger'
import { capture, Line } from './synth'

describe('logic trigger', () => {
  const a = new Line(0).set(1, 1).set(2, 0).set(3, 2).set(4, 1).trace(0, 'A')
  const b = new Line(1).set(1.5, 0).set(3.5, 1).trace(1, 'B')
  const cap = capture(0, 5, [a, b])

  it('edge: rising / falling / any, strictly after the arm time', () => {
    expect(findLogicTrigger(cap, { kind: 'edge', channel: 0, slope: 'rising' }, 0)).toBe(1)
    expect(findLogicTrigger(cap, { kind: 'edge', channel: 0, slope: 'rising' }, 1)).toBeNull() // 2→1 is not a 0→1 edge
    expect(findLogicTrigger(cap, { kind: 'edge', channel: 0, slope: 'falling' }, 0)).toBe(2)
    expect(findLogicTrigger(cap, { kind: 'edge', channel: 0, slope: 'any' }, 2)).toBe(3)
    expect(findLogicTrigger(cap, { kind: 'edge', channel: 7, slope: 'any' }, 0)).toBeNull()
  })

  it('pattern: the first entry into the pattern after arming', () => {
    // A=1 & B=0 holds from 1.5 to 2
    expect(findLogicTrigger(cap, { kind: 'pattern', pattern: { 0: 1, 1: 0 } }, 0)).toBe(1.5)
    // armed while the pattern is already true: waits for the next entry (none)
    expect(findLogicTrigger(cap, { kind: 'pattern', pattern: { 0: 1, 1: 0 } }, 1.7)).toBeNull()
    // A=1 & B=1: from 4 on (A undefined 3..4)
    expect(findLogicTrigger(cap, { kind: 'pattern', pattern: { 0: 1, 1: 1 } }, 2)).toBe(4)
    expect(findLogicTrigger(cap, { kind: 'pattern', pattern: {} }, 0)).toBeNull()
  })
})

describe('scope trigger', () => {
  // 1 kHz sine sampled every 7 µs
  const t: number[] = []
  const v: number[] = []
  for (let x = 0; x < 5.5e-3; x += 7e-6) {
    t.push(x)
    v.push(1.65 + 1.5 * Math.sin(2 * Math.PI * 1000 * x))
  }

  it('rising and falling crossings at a stable, interpolated phase', () => {
    const r = findScopeTriggers(t, v, { level: 1.65, slope: 'rising' })
    expect(r.length).toBe(5) // 1, 2, 3, 4, 5 ms (t = 0 starts AT the level, not below it)
    r.forEach((x, k) => expect(x).toBeCloseTo((k + 1) * 1e-3, 7))
    const f = findScopeTriggers(t, v, { level: 1.65, slope: 'falling' })
    f.forEach((x, k) => expect(x).toBeCloseTo(0.5e-3 + k * 1e-3, 7))
    const hi = findScopeTriggers(t, v, { level: 2.4, slope: 'rising' })
    // sin = 0.5 → 1/12 of the period after each zero crossing
    hi.forEach((x, k) => expect(x).toBeCloseTo(k * 1e-3 + 1e-3 / 12, 7))
  })

  it('holdoff skips triggers; from/to bound the search', () => {
    const r = findScopeTriggers(t, v, { level: 1.65, slope: 'rising', holdoff: 1.5e-3 })
    expect(r.map((x) => Math.round(x * 1e4) / 10)).toEqual([1, 3, 5])
    const w = findScopeTriggers(t, v, { level: 1.65, slope: 'rising', from: 1.5e-3, to: 4.2e-3 })
    expect(w.map((x) => Math.round(x * 1e4) / 10)).toEqual([2, 3, 4])
  })

  it('hysteresis rejects noise around the level', () => {
    const tt: number[] = []
    const vv: number[] = []
    // slow ramp up with ±50 mV ripple: one real crossing of 1.0 V
    for (let k = 0; k <= 2000; k++) {
      tt.push(k * 1e-6)
      vv.push(k * 1e-3 + (k % 2 ? 0.05 : -0.05))
    }
    expect(findScopeTriggers(tt, vv, { level: 1.0, slope: 'rising' }).length).toBeGreaterThan(10)
    expect(findScopeTriggers(tt, vv, { level: 1.0, slope: 'rising', hysteresis: 0.2 }).length).toBe(1)
  })

  it('skips NaN gaps', () => {
    expect(findScopeTriggers([0, 1, 2, 3], [0, NaN, 2, 0], { level: 1, slope: 'rising' })).toEqual([])
    expect(findScopeTriggers([0, 1, 2, 3], [0, 0.5, 2, 0], { level: 1, slope: 'rising' })).toEqual([1 + 0.5 / 1.5])
  })
})
