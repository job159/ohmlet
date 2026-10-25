/**
 * UX fix wave — helper H4: what a net is doing right now.
 *  - src/instruments/measure.ts netSummary / netLiveSummary (pure): a 1 kHz
 *    34 % PWM is 'pwm', 3.3 V DC is 'dc', serial data / bursts are
 *    'toggling' (never a frequency), an unrecorded net is 'unknown';
 *  - src/ui/embedded/instruments/net-activity.ts getNetLive / hasActivity /
 *    netLiveText against the real stores, fed with recorder captures.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { LogicCapture, LogicTrace } from '../src/sim/coordinator/api'
import { NET_LIVE_WINDOW_S, netLiveSummary, netSummary } from '../src/instruments/measure'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import {
  __resetNetActivityForTests,
  __tickNetActivityForTests,
  getNetLive,
  hasActivity,
  ingestCapture,
  netLiveText,
  netLiveTitle,
  resolveNet,
} from '../src/ui/embedded/instruments/net-activity'

// ---------------------------------------------------------------------------
// synthetic edge lists
// ---------------------------------------------------------------------------

type Edges = Pick<LogicTrace, 'initial' | 'times' | 'levels'>

/** A PWM from t0 to t1: rising every 1/f, high for duty/f. */
function pwm(f: number, duty: number, t0: number, t1: number): Edges {
  const times: number[] = []
  const levels: number[] = []
  for (let t = t0; t < t1; t += 1 / f) {
    times.push(t)
    levels.push(1)
    if (t + duty / f < t1) {
      times.push(t + duty / f)
      levels.push(0)
    }
  }
  return { initial: 0, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
}

/** Arbitrary edges (level after each edge alternates from `initial`). */
function edges(initial: 0 | 1, times: number[]): Edges {
  const levels = times.map((_, i) => ((initial + i + 1) % 2) as 0 | 1)
  return { initial, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
}

/** UART-ish: 115200 Bd bytes 'H' 'i' with idle gaps — not one periodic signal. */
function serial(t0: number): Edges {
  const bit = 1 / 115200
  const bitsOf = (b: number) => [0, ...Array.from({ length: 8 }, (_, i) => (b >> i) & 1), 1]
  const times: number[] = []
  let level = 1
  let t = t0
  for (const byte of [0x48, 0x69, 0x0d, 0x0a]) {
    for (const b of bitsOf(byte)) {
      if (b !== level) {
        times.push(t)
        level = b
      }
      t += bit
    }
    t += 7 * bit // idle between bytes
  }
  return edges(1, times)
}

describe('H4 netSummary / netLiveSummary (pure)', () => {
  it('a 1 kHz 34 % PWM is periodic: frequency, duty and the average from the high level', () => {
    const tr = pwm(1000, 0.34, 0.9, 1.0)
    const s = netSummary(tr, 1.0 - NET_LIVE_WINDOW_S, 1.0)
    expect(s.periodic).toBe(true)
    expect(s.frequency).toBeCloseTo(1000, 3)
    expect(s.duty).toBeCloseTo(0.34, 3)
    const live = netLiveSummary({ trace: tr, t0: 0.9, t1: 1.0, v: 3.1, vHigh: 3.3 })
    expect(live.kind).toBe('pwm')
    if (live.kind !== 'pwm') return
    expect(live.f).toBeCloseTo(1000, 3)
    expect(live.duty).toBeCloseTo(0.34, 3)
    expect(live.vavg).toBeCloseTo(0.34 * 3.3, 3)
    // without an observed high level the average is withheld, not guessed
    const noHigh = netLiveSummary({ trace: tr, t0: 0.9, t1: 1.0, v: 0 })
    expect(noHigh.kind === 'pwm' && noHigh.vavg).toBe(null)
  })

  it('3.3 V with no edges is DC; no edges in the last 100 ms is DC too', () => {
    expect(netLiveSummary({ trace: edges(1, []), t0: 0.9, t1: 1.0, v: 3.3 })).toEqual({ kind: 'dc', v: 3.3 })
    const blink = edges(0, [0.5]) // toggled half a second ago
    expect(netLiveSummary({ trace: blink, t0: 0.9, t1: 1.0, v: 3.1 })).toEqual({ kind: 'dc', v: 3.1 })
  })

  it('serial data and bursts are toggling — never a frequency', () => {
    const uart = serial(0.95)
    const s = netSummary(uart, 0.9, 1.0)
    expect(s.edges).toBeGreaterThan(4)
    expect(s.periodic).toBe(false)
    expect(s.frequency).toBeNull()
    expect(netLiveSummary({ trace: uart, t0: 0.9, t1: 1.0, v: 3.3 })).toEqual({ kind: 'toggling', edges: s.edges, v: 3.3 })
    // an SPI-like burst: 8 fast clocks, then silence
    const burst = edges(0, Array.from({ length: 16 }, (_, i) => 0.95 + i * 1e-6))
    expect(netLiveSummary({ trace: burst, t0: 0.9, t1: 1.0, v: 0 }).kind).toBe('toggling')
    // two rising edges only (one period) are not enough to claim a frequency
    expect(netLiveSummary({ trace: edges(0, [0.92, 0.93, 0.96]), t0: 0.9, t1: 1.0, v: 0 }).kind).toBe('toggling')
  })

  it('an unrecorded net is unknown + instantaneous; an untrustworthy voltage is never passed on', () => {
    expect(netLiveSummary({ trace: null, t0: 0, t1: 1, v: 3.1 })).toEqual({ kind: 'unknown', v: 3.1, instantaneous: true })
    expect(netLiveSummary({ trace: null, t0: 0, t1: 1, v: -1261957 })).toEqual({ kind: 'unknown', v: null, instantaneous: true })
    expect(netLiveSummary({ trace: edges(1, []), t0: 0.9, t1: 1.0, v: NaN })).toEqual({ kind: 'unknown', v: null, instantaneous: true })
  })
})

// ---------------------------------------------------------------------------
// net-activity against the stores
// ---------------------------------------------------------------------------

/** U1 at h10: PA6 → c19 (recorded on D0), PA5 → c20 (not recorded). */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
  ],
}

function telemetry(time: number, volts: Record<string, number>): SimTelemetry {
  return { time, netVoltages: volts, components: {}, issues: [] }
}

function capture(t1: number, trace: Edges, index = 0): LogicCapture {
  return { t0: t1 - 0.5, t1, tNow: t1, overflow: false, traces: [{ index, label: 'PA6', exact: true, since: 0, ...trace }] }
}

describe('H4 getNetLive / hasActivity / netLiveText', () => {
  let pa6 = ''
  let pa5 = ''

  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetNetActivityForTests()
    useStore.getState().resetSim()
    __resetHistoryForTests()
    useStore.setState({ layout: LAYOUT, selection: [], running: false, simTime: 1.0, telemetry: null })
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA6', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' } }] })
    pa6 = resolveNet('c19', LAYOUT) ?? ''
    pa5 = resolveNet({ componentId: 'U1', pin: 'PA5' }, LAYOUT) ?? ''
  })

  afterEach(() => {
    __resetNetActivityForTests()
    useStore.setState({ telemetry: null, running: false, simTime: 0 })
    useLab.setState({ logicChannels: [] })
  })

  it('resolves holes, part pins and net ids to one net', () => {
    expect(pa6).not.toBe('')
    expect(resolveNet({ componentId: 'U1', pin: 'PA6' }, LAYOUT)).toBe(pa6)
    expect(resolveNet({ net: pa6 }, LAYOUT)).toBe(pa6)
    expect(resolveNet('c20', LAYOUT)).toBe(pa5)
    expect(resolveNet('PS1:+', LAYOUT)).not.toBeNull()
    expect(resolveNet('nowhere', LAYOUT)).toBeNull()
  })

  it('no simulation session → null (nothing live to say)', () => {
    expect(getNetLive('c19')).toBeNull()
    expect(netLiveText(null)).toBe('—')
  })

  it('a recorded PWM net reads pwm (1.000 kHz) everywhere it is asked', () => {
    // PA6 in alternate-function mode with TIM3 switched on (and SPI1 off): a timer
    // channel drives the net — a real PWM (UX QA IS-F8 source 'timer')
    const tel = telemetry(1.0, { [pa6]: 3.1, [pa5]: 3.1 })
    tel.components.U1 = { mcu: { pinModes: { PA6: 'af' } } } as never
    useStore.setState({ telemetry: tel })
    useLab.setState({ mcus: { U1: { componentId: 'U1', uarts: [], clocked: ['GPIO', 'AFIO', 'TIM3'] } as never } })
    // the poll's telemetry sample learns the high level (3.1 V) for the average
    getNetLive('c19')
    __tickNetActivityForTests()
    ingestCapture(capture(1.0, pwm(1000, 0.34, 0.5, 1.0)))
    const live = getNetLive({ componentId: 'U1', pin: 'PA6' })
    expect(live?.kind).toBe('pwm')
    expect(live).toMatchObject({ source: 'timer' })
    expect(getNetLive('c19')).toEqual(live)
    expect(netLiveText(live)).toBe('PWM 1.000 kHz · 34.0 %（平均 1.05 V）')
    expect(netLiveText(live, { form: 'compact' })).toBe('PWM 1.000 kHz · 34.0 %')
    // the same edges without a timer behind them (pin mode unknown): neutral words
    useLab.setState({ mcus: {} })
    useStore.setState({ telemetry: telemetry(1.0, { [pa6]: 3.1, [pa5]: 3.1 }) })
    const plain = getNetLive('c19')
    expect(plain).toMatchObject({ kind: 'pwm', source: 'gpio' })
    expect(netLiveText(plain)).toBe('週期訊號 1.000 kHz · 34.0 %')
    expect(netLiveText(plain, { form: 'compact' })).toBe('週期訊號 1.000 kHz · 34.0 %')
    // the unrecorded PA5 net: the instantaneous value, said as such
    const other = getNetLive('c20')
    expect(other).toEqual({ kind: 'unknown', v: 3.1, instantaneous: true })
    expect(netLiveText(other)).toBe('3.10 V（瞬時）')
    expect(netLiveText(other, { form: 'compact' })).toBe('3.10 V')
    expect(netLiveTitle()).toBe('瞬時值，每秒更新 4 次')
  })

  it('a capture taken while the simulation ran on (tNow > t1) is classified over its own window', () => {
    useStore.setState({ telemetry: telemetry(1.08, { [pa6]: 3.1 }) })
    // the query asked for [0.5, 1.0]; the coordinator answered at 1.08 s — the
    // traces hold no edges after 1.0 s, which is not a gap in the PWM
    ingestCapture({ ...capture(1.0, pwm(1000, 0.34, 0.5, 1.0)), tNow: 1.08 })
    expect(getNetLive('c19')?.kind).toBe('pwm')
    // and the recorder counts as read up to 1.0 s only: an edge at 1.03 s in
    // the next capture is still news for hasActivity
    ingestCapture({ ...capture(1.1, edges(0, [1.03])), t0: 1.0, tNow: 1.1 })
    expect(hasActivity('c19', 1.02)).toBe(true)
  })

  it('a recorded quiet net is DC with the current solver value', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa6]: 3.3 }) })
    ingestCapture(capture(1.0, edges(1, [])))
    expect(getNetLive('c19')).toEqual({ kind: 'dc', v: 3.3 })
    useStore.setState({ telemetry: telemetry(1.1, { [pa6]: 3.29 }) })
    expect(netLiveText(getNetLive('c19'))).toBe('3.29 V')
  })

  it('hasActivity: an edge on the recorder at or after the time asked', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa6]: 0 }) })
    expect(hasActivity('c19', 0)).toBe(false)
    ingestCapture(capture(1.0, edges(0, [0.42, 0.97])))
    expect(hasActivity('c19', 0.5)).toBe(true)
    expect(hasActivity({ componentId: 'U1', pin: 'PA6' }, 0.97)).toBe(true)
    expect(hasActivity('c19', 0.98)).toBe(false)
    expect(hasActivity('nowhere', 0)).toBe(false)
  })

  it('hasActivity on an unrecorded net: a level change between telemetry samples', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa5]: 0 }), simTime: 1.0 })
    expect(hasActivity('c20', 0.9)).toBe(false) // starts watching the net
    __tickNetActivityForTests()
    useStore.setState({ telemetry: telemetry(1.2, { [pa5]: 3.2 }), simTime: 1.2 })
    __tickNetActivityForTests()
    expect(hasActivity('c20', 0.9)).toBe(true)
    expect(hasActivity('c20', 1.3)).toBe(false)
  })

  it('a simulation reset (time going back) forgets every observation', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa6]: 0 }) })
    ingestCapture(capture(1.0, edges(0, [0.97])))
    expect(hasActivity('c19', 0.5)).toBe(true)
    useStore.setState({ telemetry: telemetry(0.01, { [pa6]: 0 }), simTime: 0.01 })
    __tickNetActivityForTests()
    expect(hasActivity('c19', 0)).toBe(false)
    expect(getNetLive('c19')).toEqual({ kind: 'unknown', v: 0, instantaneous: true })
  })

  it('toggling text; English', () => {
    expect(netLiveText({ kind: 'toggling', edges: 12, v: 3.3 })).toBe('訊號變化中（非週期）')
    __setLangForTests('en')
    expect(netLiveText({ kind: 'toggling', edges: 12, v: 3.3 })).toBe('Changing (not periodic)')
    expect(netLiveText({ kind: 'pwm', f: 1000, duty: 0.34, vavg: 1.122 })).toBe('PWM 1.000 kHz · 34.0 % (average 1.12 V)')
    expect(netLiveText({ kind: 'unknown', v: 3.1, instantaneous: true })).toBe('3.10 V (instantaneous)')
  })
})
