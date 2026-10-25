/**
 * Measurements: edge-based (logic) and waveform (scope samples).
 */
import { describe, expect, it } from 'vitest'
import { measureEdges, measureWave } from '../../src/instruments/measure'
import { fmtPercent, fmtSi, fmtWord } from '../../src/instruments/format'
import { Line } from './synth'

/** PWM: `n` periods of `period` s at `duty`, rising first at t0. */
function pwm(period: number, duty: number, n: number, t0 = 1e-3): Line {
  const l = new Line(0)
  for (let k = 0; k < n; k++) {
    l.set(t0 + k * period, 1)
    l.set(t0 + k * period + duty * period, 0)
  }
  return l
}

describe('edge measurements', () => {
  it('frequency, period, duty, pulse widths and edge counts of a PWM', () => {
    const m = measureEdges(pwm(1e-3, 0.25, 10).trace())
    expect(m.rising).toBe(10)
    expect(m.falling).toBe(10)
    expect(m.edges).toBe(20)
    expect(m.period).toBeCloseTo(1e-3, 12)
    expect(m.frequency).toBeCloseTo(1000, 6)
    expect(m.duty).toBeCloseTo(0.25, 9)
    expect(m.high).toMatchObject({ count: 10 })
    expect(m.high!.avg).toBeCloseTo(250e-6, 12)
    expect(m.low!.count).toBe(9) // the low after the last falling edge never ends
    expect(m.low!.min).toBeCloseTo(750e-6, 12)
    expect(m.low!.max).toBeCloseTo(750e-6, 12)
  })

  it('respects the window and needs two edges of a polarity for a period', () => {
    const tr = pwm(1e-3, 0.5, 10).trace()
    const m = measureEdges(tr, 2.9e-3, 5.1e-3) // rising edges at 3, 4, 5 ms
    expect(m.rising).toBe(3)
    expect(m.period).toBeCloseTo(1e-3, 12)
    expect(m.duty).toBeCloseTo(0.5, 9)
    const one = measureEdges(tr, 2.9e-3, 3.2e-3)
    expect(one.period).toBeNull()
    expect(one.frequency).toBeNull()
    expect(one.duty).toBeNull()
    expect(one.high).toBeNull() // the high pulse is cut by the window
  })

  it('never measures pulses at the undefined level', () => {
    const l = new Line(0).set(1e-3, 1).set(2e-3, 2).set(3e-3, 0).set(4e-3, 1).set(5e-3, 0)
    const m = measureEdges(l.trace())
    expect(m.high!.count).toBe(2) // 1→2 ms and 4→5 ms; 2→3 ms is undefined
    expect(m.low!.count).toBe(1) // 3→4 ms
  })
})

describe('waveform measurements', () => {
  it('sine with offset on a variable step: Vpp, Vavg, Vrms, frequency', () => {
    const f = 50
    const A = 2
    const off = 1
    const t: number[] = []
    const v: number[] = []
    let x = 0
    let k = 0
    while (x <= 0.1) {
      t.push(x)
      v.push(off + A * Math.sin(2 * Math.PI * f * x))
      x += k++ % 2 ? 37e-6 : 61e-6 // uneven solver steps
    }
    const m = measureWave(t, v)
    expect(m.vmax).toBeCloseTo(off + A, 3)
    expect(m.vmin).toBeCloseTo(off - A, 3)
    expect(m.vpp).toBeCloseTo(2 * A, 3)
    expect(m.vavg!).toBeCloseTo(off, 2)
    expect(m.vrms!).toBeCloseTo(Math.sqrt(off * off + (A * A) / 2), 2)
    expect(m.frequency!).toBeCloseTo(f, 2)
    expect(m.duty!).toBeCloseTo(0.5, 2)
  })

  it('square wave with linear edges: duty and 10–90 % rise / fall times', () => {
    // 1 kHz, 30 % duty, 0 → 3.3 V, 10 µs rise, 20 µs fall (segments between samples)
    const t: number[] = []
    const v: number[] = []
    for (let k = 0; k < 5; k++) {
      const p = k * 1e-3
      t.push(p, p + 10e-6, p + 300e-6, p + 320e-6)
      v.push(0, 3.3, 3.3, 0)
    }
    t.push(5e-3)
    v.push(0)
    const m = measureWave(t, v)
    expect(m.vpp).toBeCloseTo(3.3, 6)
    expect(m.rise!).toBeCloseTo(8e-6, 9)
    expect(m.fall!).toBeCloseTo(16e-6, 9)
    expect(m.frequency!).toBeCloseTo(1000, 6)
    // mean = (5 + 300-10 ... ) — the high time measured at the mean crossing
    expect(m.duty!).toBeGreaterThan(0.29)
    expect(m.duty!).toBeLessThan(0.32)
  })

  it('duty from falling crossings when the window holds one rising crossing', () => {
    // 25 % duty, 1 kHz, window starts just after a rising edge: rise at 1 ms only, falls at 0.25 / 1.25 ms
    const t: number[] = []
    const v: number[] = []
    const add = (x: number, y: number) => {
      t.push(x)
      v.push(y)
    }
    add(0.0001e-3, 3.3)
    add(0.25e-3, 3.3)
    add(0.2501e-3, 0)
    add(1e-3, 0)
    add(1.0001e-3, 3.3)
    add(1.25e-3, 3.3)
    add(1.2501e-3, 0)
    add(1.9e-3, 0)
    const m = measureWave(t, v)
    expect(m.period!).toBeCloseTo(1e-3, 8)
    expect(m.duty!).toBeCloseTo(0.25, 3)
  })

  it('flat / short / NaN inputs', () => {
    const flat = measureWave([0, 1e-3, 2e-3], [1.5, 1.5, 1.5])
    expect(flat).toMatchObject({ vpp: 0, vavg: 1.5, vrms: 1.5, frequency: null, rise: null })
    expect(measureWave([], []).samples).toBe(0)
    const nan = measureWave([0, 1, 2, 3], [0, NaN, 2, 2])
    expect(nan.samples).toBe(3)
    expect(nan.vmax).toBe(2)
    // window limits
    expect(measureWave([0, 1, 2, 3], [5, 1, 2, 9], 0.5, 2.5)).toMatchObject({ vmin: 1, vmax: 2, samples: 2 })
  })

  it('a step with one solver interval rises in 80 % of it (as solved, nothing invented)', () => {
    const m = measureWave([0, 1e-3, 1.05e-3, 2e-3], [0, 0, 3.3, 3.3])
    expect(m.rise!).toBeCloseTo(0.8 * 50e-6, 12)
  })
})

describe('instrument formats', () => {
  it('SI values, percentages and words', () => {
    expect(fmtSi(1000.4, 'Hz')).toBe('1.000 kHz')
    expect(fmtSi(999.96, 'Hz')).toBe('1.000 kHz')
    expect(fmtSi(0.0025, 's')).toBe('2.500 ms')
    expect(fmtSi(-0.12, 'V', 3)).toBe('-120 mV')
    expect(fmtSi(99.996, 'V')).toBe('100.0 V')
    expect(fmtSi(8.68e-6, 's')).toBe('8.680 µs')
    expect(fmtSi(0, 'V')).toBe('0 V')
    expect(fmtSi(NaN, 'V')).toBe('—')
    expect(fmtPercent(0.25)).toBe('25.0 %')
    expect(fmtWord(0x48)).toBe("0x48 'H'")
    expect(fmtWord(0x0d)).toBe('0x0D \\r')
    expect(fmtWord(0x9f)).toBe('0x9F')
    expect(fmtWord(0x1ff, 9)).toBe('0x1FF')
    expect(fmtWord(0x41, 16)).toBe('0x0041')
  })
})
