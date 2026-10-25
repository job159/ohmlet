/**
 * Oscilloscope acquisition logic (pure parts of the scope view): query
 * windows, rolling vs triggered frames for Auto / Normal / Single, the
 * legacy-feed fallback, decimation flag, axis labels and the front-panel
 * value formats.
 */
import { describe, expect, it } from 'vitest'
import type { ScopeCapture } from '../../src/sim/coordinator/api'
import {
  MAX_POINTS,
  buildFrame,
  fmtTimeOffset,
  legacyCapture,
  queryWindow,
  verticalRange,
  type ScopeFrame,
} from '../../src/ui/embedded/instruments/scope-engine'
import {
  SCOPE_DEFAULTS,
  TDIVS,
  fmtDiv,
  parseVolts,
  sanitizeScopeSettings,
  type ScopeSettings,
} from '../../src/ui/embedded/instruments/scope-settings'

/** 1 kHz square 0 → 3.3 V (rising at k ms), sampled every 10 µs from t0 to t1. */
function square(t0: number, t1: number, index = 0): ScopeCapture {
  const t: number[] = []
  const v: number[] = []
  for (let x = t0; x <= t1 + 1e-12; x += 10e-6) {
    t.push(x)
    const ph = ((x % 1e-3) + 1e-3) % 1e-3
    v.push(ph < 0.5e-3 ? 3.3 : 0)
  }
  return { t0, t1, traces: [{ index, label: `CH${index + 1}`, t: Float64Array.from(t), v: Float32Array.from(v) }] }
}

const S = (p: Partial<ScopeSettings>): ScopeSettings => ({ ...SCOPE_DEFAULTS, ...p })
const ATT = [true, true, false, false]

describe('scope acquisition', () => {
  it('query window: rolling = one window; triggered = two windows + holdoff', () => {
    expect(queryWindow(S({ tdiv: 1e-3 }), 0.5, null)).toEqual({ q0: 0.49, q1: 0.5 })
    const q = queryWindow(S({ tdiv: 1e-3, trigSource: 0, holdoff: 1e-3 }), 0.5, null)
    expect(q.q0).toBeCloseTo(0.479, 12)
    expect(queryWindow(S({ tdiv: 1, trigSource: 0 }), 3, null).q0).toBe(0)
  })

  it('trigger off: a rolling window ending now', () => {
    const f = buildFrame({ cap: square(0, 0.02), settings: S({ tdiv: 1e-3 }), now: 0.02, attached: ATT, legacy: false, prev: null, armedAt: null })
    expect(f).toMatchObject({ status: 'roll', t1: 0.02, ref: 0.02, trigger: null })
    expect(f.t0).toBeCloseTo(0.01, 12)
  })

  it('Auto/Normal: the newest crossing with a complete post-trigger half sits at the centre', () => {
    const s = S({ tdiv: 0.2e-3, trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'normal' })
    // rising edges every 1 ms; window 2 ms → the trigger must be ≤ now − 1 ms
    const now = 0.0205
    const f = buildFrame({ cap: square(now - 4e-3, now), settings: s, now, attached: ATT, legacy: false, prev: null, armedAt: null })
    expect(f.status).toBe('trig')
    expect(f.trigger!.t).toBeGreaterThan(0.019 - 1e-5)
    expect(f.trigger!.t).toBeLessThan(0.019 + 1e-5)
    expect(f.t0).toBeCloseTo(f.trigger!.t - 1e-3, 12)
    expect(f.t1).toBeCloseTo(f.trigger!.t + 1e-3, 12)
    expect(f.ref).toBe(f.trigger!.t)
    // falling slope triggers half a period later / earlier
    const ff = buildFrame({ cap: square(now - 4e-3, now), settings: { ...s, trigSlope: 'falling' }, now, attached: ATT, legacy: false, prev: null, armedAt: null })
    expect(ff.trigger!.t).toBeCloseTo(0.0185, 4)
  })

  it('no crossing: Auto rolls, Normal keeps the last triggered frame', () => {
    const flat: ScopeCapture = { t0: 0, t1: 0.01, traces: [{ index: 0, label: 'CH1', t: Float64Array.from([0, 0.005, 0.01]), v: Float32Array.from([1, 1, 1]) }] }
    const auto = buildFrame({ cap: flat, settings: S({ tdiv: 1e-4, trigSource: 0, trigMode: 'auto' }), now: 0.01, attached: ATT, legacy: false, prev: null, armedAt: null })
    expect(auto.status).toBe('auto')
    expect(auto.trigger).toBeNull()
    const prev: ScopeFrame = { traces: [], t0: 1, t1: 2, ref: 1.5, trigger: { t: 1.5, level: 1, source: 0 }, status: 'trig', decimated: false, legacy: false }
    const normal = buildFrame({ cap: flat, settings: S({ tdiv: 1e-4, trigSource: 0, trigMode: 'normal' }), now: 0.01, attached: ATT, legacy: false, prev, armedAt: null })
    expect(normal).toMatchObject({ status: 'ready', t0: 1, t1: 2, ref: 1.5 })
  })

  it('Single: the FIRST crossing after arming, then stop (frozen)', () => {
    const s = S({ tdiv: 0.2e-3, trigSource: 0, trigMode: 'single' })
    const cap = square(0, 0.01)
    const armed = buildFrame({ cap, settings: s, now: 0.01, attached: ATT, legacy: false, prev: null, armedAt: 0.0042 })
    expect(armed.status).toBe('stop')
    expect(armed.trigger!.t).toBeCloseTo(0.005, 4)
    const waiting = buildFrame({ cap, settings: s, now: 0.01, attached: ATT, legacy: false, prev: null, armedAt: 0.0095 })
    expect(waiting.status).toBe('armed')
    const disarmed = buildFrame({ cap: { t0: 0, t1: 0, traces: [] }, settings: s, now: 0.02, attached: ATT, legacy: false, prev: armed, armedAt: null })
    expect(disarmed).toMatchObject({ status: 'stop', t0: armed.t0, t1: armed.t1 })
  })

  it('only attached channels are shown; dense captures are flagged as decimated', () => {
    const cap = square(0, 0.002)
    cap.traces.push({ index: 2, label: 'CH3', t: Float64Array.from([0]), v: Float32Array.from([1]) })
    const f = buildFrame({ cap, settings: S({ tdiv: 1e-4 }), now: 0.002, attached: ATT, legacy: false, prev: null, armedAt: null })
    expect(f.traces.map((t) => t.index)).toEqual([0])
    expect(f.decimated).toBe(false)
    const dense = square(0, (MAX_POINTS / 2) * 10e-6)
    expect(buildFrame({ cap: dense, settings: S({}), now: 1, attached: ATT, legacy: false, prev: null, armedAt: null }).decimated).toBe(true)
  })

  it('legacy 1 kHz feed → per-channel traces (NaN = unattached)', () => {
    const cap = legacyCapture(
      [
        { t: 0.001, v: [1, NaN, NaN, NaN] },
        { t: 0.002, v: [2, 5, NaN, NaN] },
        { t: 0.003, v: [3, 6, NaN, NaN] },
      ],
      0.0015,
      0.003,
    )
    expect(cap.traces.map((t) => [t.index, Array.from(t.t), Array.from(t.v)])).toEqual([
      [0, [0.002, 0.003], [2, 3]],
      [1, [0.002, 0.003], [5, 6]],
    ])
  })
})

describe('scope screen formats', () => {
  it('axis time labels keep the legacy format for ≥ 10 ms windows', () => {
    expect(fmtTimeOffset(-5, 5)).toBe('-5.0s')
    expect(fmtTimeOffset(0, 5)).toBe('0')
    expect(fmtTimeOffset(-0.08, 0.1)).toBe('-80ms')
    expect(fmtTimeOffset(-0.0016, 0.002)).toBe('-1.6ms')
    expect(fmtTimeOffset(4e-6, 20e-6)).toBe('4µs')
    expect(fmtTimeOffset(2.5e-7, 2e-6)).toBe('0.3µs')
  })

  it('vertical range: fixed V/div puts 0 V vpos divisions above the bottom', () => {
    expect(verticalRange(null, S({ vdiv: 1, vpos: 1 }))).toEqual({ vmin: -1, vmax: 7 })
    expect(verticalRange(null, S({ vdiv: 0.5, vpos: 4 }))).toEqual({ vmin: -2, vmax: 2 })
    expect(verticalRange(null, S({}))).toEqual({ vmin: -1, vmax: 6 }) // legacy empty default
  })

  it('front-panel values', () => {
    expect(fmtDiv(0.002, 's')).toBe('2 ms/div')
    expect(fmtDiv(0.0005, 's')).toBe('500 µs/div')
    expect(fmtDiv(1, 's')).toBe('1 s/div')
    expect(fmtDiv(0.02, 'V')).toBe('20 mV/div')
    expect(TDIVS[0]).toBe(1e-6)
    expect(TDIVS[TDIVS.length - 1]).toBe(2)
    expect(parseVolts('1.65')).toBe(1.65)
    expect(parseVolts(' 1.65 V ')).toBe(1.65)
    expect(parseVolts('-0.5v')).toBe(-0.5)
    expect(parseVolts('500m')).toBeCloseTo(0.5, 12)
    expect(parseVolts('500 mV')).toBeCloseTo(0.5, 12)
    expect(parseVolts('abc')).toBeNull()
    expect(parseVolts('1e9')).toBeNull()
  })

  it('stored settings are sanitized', () => {
    expect(sanitizeScopeSettings(null)).toEqual(SCOPE_DEFAULTS)
    expect(sanitizeScopeSettings({ tdiv: 0.003, vdiv: 7, trigSource: 9, trigMode: 'x', cursors: 'time' })).toEqual({
      ...SCOPE_DEFAULTS,
      cursors: 'time',
    })
    expect(sanitizeScopeSettings({ tdiv: 0.002, vdiv: 1, trigSource: 1, trigLevel: 2.5, trigMode: 'single', holdoff: 1e-3 })).toMatchObject({
      tdiv: 0.002,
      vdiv: 1,
      trigSource: 1,
      trigLevel: 2.5,
      trigMode: 'single',
      holdoff: 1e-3,
    })
  })
})
