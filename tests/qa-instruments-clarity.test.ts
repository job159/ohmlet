/**
 * Release QA, clarity round — the instruments' analysis panels must be
 * simple, named and explained (QA clarity items, instruments owner):
 *  - LA-AXIS               an absolute anchor tick, then offsets at a stride whose labels never touch;
 *  - LA-FIT                「自動」 fits the SLOWEST periodic channel; a channel without a period in
 *                          the window reads its recent recording (「（最近 100 ms）」);
 *  - LA-MEAS-NAMES         高電位時間 / 低電位時間 / 週期 / 邊緣數;
 *  - FG-RAIL               a function generator's output is its setting, never a rail / one instant;
 *  - MEASURE-COHERENCE     the live summary in the analyzer's words; a paused / halted net names its level;
 *  - UART-RX               the terminal's sends as frames (they skip the RX wire);
 *  - UART-TIMESTAMPS       floor decimals, one count per transcript, exact start bits;
 *  - DECODE-SUMMARY        「位址 0x3C 寫」, the ACK'd addresses, status filters;
 *  - SCOPE-CURSORS         a channel's voltage at a cursor;
 *  - SCOPE-READOUT-TRIGGER two-level vs analog readouts (rise time, no duty on an RC curve),
 *                          the trigger chip's words, the trigger instant always labelled;
 *  - GLOSSARY-IN-INSTRUMENTS the two terms the shared glossary lacks;
 *  - PERF-ORDER-VERDICT    the simulation first, a verdict line;
 *  - ANALYSIS-LAYOUT-SPACE the analysis layout opens the measurements beside an empty plot.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { LogicCapture, LogicTrace } from '../src/sim/coordinator/api'
import { parseProject } from '../src/state/project'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { axisTickLabels, fmtSetting, fmtSiSigned, fmtTickAnchor, fmtTickOffset } from '../src/instruments/format'
import { fitLogicSpan } from '../src/instruments/autofit'
import { measureWave, recentEdgeMeasurements } from '../src/instruments/measure'
import { laAxisLabels } from '../src/ui/embedded/instruments/la-axis'
import {
  __resetNetActivityForTests,
  getNetLive,
  ingestCapture,
  isRailNet,
  netLiveText,
  netLiveTitle,
  resolveNet,
  sourceSetting,
} from '../src/ui/embedded/instruments/net-activity'
import { isWaveformSourcePart, waveformLiveText } from '../src/ui/embedded/instruments/meter-readout'
import { getEntry } from '../src/model/catalog'
import { __resetUartSendsForTests, recordUartSend, sendDuration, USART_RX, useUartSends } from '../src/ui/embedded/instruments/uart-sent'
import { escapeBytes, frameDisplayText, type DecodedFrame } from '../src/ui/embedded/logic-decoders'
import { ackedAddresses, frameFilter, frameMatches, statusText } from '../src/ui/embedded/instruments/DecodeResults'
import { arrivalDecimals, fmtArrival, transcriptDecimals, type TerminalLine } from '../src/ui/embedded/UartTerminal'
import { labelledDivisions, valueAt } from '../src/ui/embedded/instruments/scope-engine'
import { scopeTriggerSummary } from '../src/ui/embedded/instruments/ScopeControls'
import { GLOSSARY } from '../src/ui/embedded/glossary'
import { INSTRUMENT_TERMS, hasInstrumentTerm } from '../src/ui/embedded/instruments/InstrumentTerm'
import { perfSections, perfSummary, perfVerdict, type PerfBoard } from '../src/ui/perf/view'
import type { PerfSnapshot } from '../src/ui/perf/collector'
import { analysisAutoOpen, isAnalysisArrangement } from '../src/ui/embedded/instruments/la-view'
import { Line, capture } from './instruments/synth'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const example = (id: string): CircuitLayout => {
  const res = parseProject(readFileSync(join(ROOT, 'examples/embedded', `${id}.ohmlet.json`), 'utf8'))
  if (!res.ok) throw new Error(res.errors.join('; '))
  return res.project.layout
}

type Edges = Pick<LogicTrace, 'initial' | 'times' | 'levels'>
/** A PWM from t0 to t1: rising every 1/f, high for duty/f. */
function pwm(f: number, duty: number, t0: number, t1: number, index = 0): LogicTrace {
  const l = new Line(0)
  for (let k = 0; t0 + k / f < t1; k++) {
    l.set(t0 + k / f, 1)
    l.set(t0 + (k + duty) / f, 0)
  }
  return l.trace(index)
}

beforeEach(() => __setLangForTests('zh-TW'))

// ---------------------------------------------------------------------------
describe('LA-AXIS: an anchor, then offsets — never a label run into another', () => {
  it('the tick formatter: (2.1043618, 1 µs) → the anchor, then +1 µs, +2 µs …', () => {
    expect(axisTickLabels(2.1043618, 1e-6, 9)).toEqual(['2.104 361 8 s', '+1 µs', '+2 µs', '+3 µs', '+4 µs', '+5 µs', '+6 µs', '+7 µs', '+8 µs', '+9 µs'])
    // the blink window (5 s, 0.5 s/格) and 20 µs/格: the step reads at a glance
    expect(axisTickLabels(3, 0.5, 3)).toEqual(['3.00 s', '+0.5 s', '+1 s', '+1.5 s'])
    expect(axisTickLabels(0.018973, 2e-5, 2).slice(1)).toEqual(['+20 µs', '+40 µs'])
  })
  it('never a dangling zero group (「0.102 0 s」 → 「0.102 s」); a significant last digit stays', () => {
    expect(fmtTickAnchor(0.102, 1e-3)).toBe('0.102 s')
    expect(fmtTickAnchor(2.10436, 1e-6)).toBe('2.104 360 s')
    expect(fmtTickAnchor(2.1043618, 1e-6)).toBe('2.104 361 8 s')
    expect(fmtTickOffset(9e-7, 1e-7, 9e-7)).toBe('+900 ns')
    expect(fmtTickOffset(0.018, 0.002, 0.018)).toBe('+18 ms')
  })
  it('label boxes are disjoint at 1440 px (1 µs/格) and on a 390 px phone (280 px plot)', () => {
    const measure = (s: string) => s.length * 6.4 // 10.5 px monospace
    for (const [t0, step, width] of [
      [2.1043618, 1e-6, 1150],
      [2.1043618, 1e-6, 280],
      [0.78400, 1e-4, 280],
      [1.00078, 4e-5, 280],
      [0.018973, 2e-5, 1150],
    ] as const) {
      const labels = laAxisLabels(t0, step, width, measure)
      expect(labels.length).toBeGreaterThanOrEqual(2)
      expect(labels[0].text).toMatch(/ s$/) // the anchor reads absolute time
      for (const l of labels.slice(1)) expect(l.text.startsWith('+')).toBe(true)
      for (let i = 1; i < labels.length; i++) expect(labels[i].x + 3).toBeGreaterThanOrEqual(labels[i - 1].x + 3 + labels[i - 1].w)
      for (const l of labels) expect(l.x + 3 + l.w).toBeLessThanOrEqual(width)
    }
  })
  it('a marker flag over the first division: the next label becomes the anchor (absolute time)', () => {
    const measure = (s: string) => s.length * 6.4
    const labels = laAxisLabels(2.1043618, 1e-6, 1150, measure, [10])
    expect(labels[0].k).toBeGreaterThan(0)
    expect(labels[0].text).toBe(fmtTickAnchor(2.1043618 + labels[0].k * 1e-6, 1e-6))
  })
})

// ---------------------------------------------------------------------------
describe('LA-FIT: every channel’s signal in the window', () => {
  it('lesson i4: PA8 2 kHz, PA0 1 kHz, PA6 20 kHz → 2 periods of PA0 (2 ms), said as the slowest', () => {
    const cap = capture(0, 0.5, [pwm(2000, 0.75, 0, 0.5, 0), pwm(1000, 0.25, 0, 0.5, 1), pwm(20000, 0.3, 0, 0.5, 2)])
    const fit = fitLogicSpan(cap, [], { t0: 0, t1: 0.5 })
    expect(fit).toMatchObject({ kind: 'period', span: 0.002, channel: 1, slowest: true, periods: 2 })
    expect(fit.kind === 'period' && fit.measCol).toBeFalsy()
  })
  it('a 1 Hz blink beside a 1 MHz clock: the blink’s window, and the per-channel table opens', () => {
    const blink = new Line(0)
    for (let k = 0; k < 6; k++) blink.set(0.25 + 0.5 * k, k % 2 === 0 ? 1 : 0)
    // the 1 MHz clock ran all along; the recorder's ring kept only its last 0.1 s (it wrapped)
    const fast = pwm(1e6, 0.5, 2.9, 3.0, 1)
    const fit = fitLogicSpan({ ...capture(0, 3, [blink.trace(0), fast]), overflow: true }, [], { t0: 0, t1: 3 })
    expect(fit).toMatchObject({ kind: 'period', channel: 0, span: 2, periods: 2, slowest: true, measCol: true })
  })
  it('a channel with an edge but no period yet: the fit says it is undecided (the view looks further back)', () => {
    const once = new Line(0).set(1.2, 1)
    const fit = fitLogicSpan(capture(0, 2, [pwm(1000, 0.5, 0, 2, 0), once.trace(1)]), [], { t0: 0, t1: 2 })
    expect(fit).toMatchObject({ kind: 'period', channel: 0, undecided: true })
  })
  it('the recent recording: the last max(100 ms, 3 periods) — 1 kHz over 100 ms, a 1 Hz blink over 5 s', () => {
    const r = recentEdgeMeasurements(pwm(1000, 0.25, 0, 5), 0, 5)!
    expect(r.span).toBeCloseTo(0.1, 9)
    expect(r.m.frequency).toBeCloseTo(1000, 3)
    expect(r.m.duty).toBeCloseTo(0.25, 3)
    const blink = pwm(1 / 1.002, 0.5, 0.2, 9)
    const b = recentEdgeMeasurements(blink, 0, 9)!
    expect(b.span).toBe(5) // 3 periods rounded up the 1-2-5 ladder
    expect(b.m.period).toBeCloseTo(1.002, 6)
    expect(recentEdgeMeasurements(new Line(0).trace(), 0, 5)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('LA-MEAS-NAMES: the quantities named the way lessons and the scope name them', () => {
  it('高電位時間 / 低電位時間 / 週期 / 邊緣數', () => {
    expect(t('high|meas')).toBe('高電位時間')
    expect(t('low|meas')).toBe('低電位時間')
    expect(t('T|meas')).toBe('週期')
    expect(t('edges|meas')).toBe('邊緣數')
    expect(t('shortest–longest')).toBe('最短–最長')
    expect(t('(last {span})', { span: '100 ms' })).toBe('（最近 100 ms）')
  })
})

// ---------------------------------------------------------------------------
describe('FG-RAIL + MEASURE-COHERENCE: one honest wording per net', () => {
  const RC = example('rc-lowpass')
  const tel = (time: number, volts: Record<string, number>): SimTelemetry => ({ time, netVoltages: volts, components: {}, issues: [] })
  beforeEach(() => {
    __resetNetActivityForTests()
    useStore.getState().resetSim()
    __resetHistoryForTests()
    useStore.setState({ layout: RC, selection: [], running: true, simTime: 1, telemetry: null })
    useLab.setState({ logicChannels: [], mcus: {} })
  })
  afterEach(() => {
    __resetNetActivityForTests()
    useStore.setState({ telemetry: null, running: false, simTime: 0 })
  })

  it('rc-lowpass: FG1 輸出, a10 and R1 第 1 腳 read the generator’s setting, never one instant', () => {
    const out = resolveNet('a10', RC)!
    expect(isRailNet(out, RC)).toBe(false)
    for (const v of [5, 0.0089]) {
      useStore.setState({ telemetry: tel(1, { [out]: v }) })
      for (const q of ['a10', { componentId: 'FG1', pin: 'out' }, { componentId: 'R1', pin: R1Pin1() }] as const) {
        const live = getNetLive(q as never)
        expect(live?.kind).toBe('source')
        expect(netLiveText(live, { form: 'compact' })).toBe('方波 100 Hz · 0–5.00 V')
        expect(netLiveText(live)).toBe('方波 100 Hz · 0–5.00 V（函數產生器設定）')
      }
    }
    expect(netLiveTitle(getNetLive('a10'))).toBe('函數產生器的設定值，不是量測結果；實際波形請看示波器')
    // a sine with an offset reads its peaks
    expect(netLiveText({ kind: 'source', id: 'FG1', waveform: 'sine', f: 1000, lo: 1, hi: 4 }, { form: 'compact' })).toBe('正弦波 1 kHz · 1.00–4.00 V')
    expect(sourceSetting('FG1', RC)).toMatchObject({ waveform: 'square', f: 100, lo: 0, hi: 5 })
    expect(sourceSetting('PS1', RC)).toBeNull()
    // the supply stays a steady rail
    expect(isRailNet(resolveNet('PS1:+', RC) ?? '', RC) || isRailNet(resolveNet('PS1:-', RC) ?? '', RC)).toBe(true)
    // the generator's own current / power: never a bare instant
    expect(isWaveformSourcePart(getEntry('function_generator'))).toBe(true)
    expect(isWaveformSourcePart(getEntry('power_supply'))).toBe(false)
    expect(waveformLiveText()).toBe('交流（瞬時值會跳動）——請用示波器看')
    function R1Pin1() {
      return getEntry('resistor')!.pins[0]
    }
  })

  it('a paused net names its level first, never 「訊號變化中」', () => {
    expect(netLiveText({ kind: 'pwm', f: 0.998, duty: 0.5, vavg: null, source: 'gpio', held: { why: 'paused', v: 3.3 } })).toBe(
      '目前 高（3.30 V） · 暫停前：週期訊號 0.998 Hz · 50.0 %',
    )
    expect(netLiveText({ kind: 'toggling', edges: 9, v: 0, source: 'gpio', held: { why: 'halted', v: 0 } })).toBe('目前 低（0 V） · 核心停住前：有訊號變化（非週期）')
    expect(netLiveText({ kind: 'toggling', edges: 9, v: 0, source: 'gpio', held: { why: 'paused', v: 0 } })).not.toMatch(/訊號變化中/)
  })

  it('getNetLive: a recorded periodic net, then the pause — the level first, the run as history', () => {
    const LAY = example('rc-lowpass')
    useStore.setState({ layout: LAY, running: true, simTime: 1 })
    useLab.setState({ logicChannels: [{ index: 0, label: 'a20', source: { kind: 'net', ref: 'a20' } }] })
    const net = resolveNet('a20', LAY)!
    useStore.setState({ telemetry: tel(1, { [net]: 3.3 }) })
    const cap: LogicCapture = { t0: 0.5, t1: 1, tNow: 1, overflow: false, traces: [{ ...pwm(1000, 0.5, 0.5, 1), since: 0 }] }
    ingestCapture(cap)
    expect(netLiveText(getNetLive('a20'))).toBe('週期訊號 1.000 kHz · 50.0 %')
    useStore.setState({ running: false })
    expect(netLiveText(getNetLive('a20'))).toBe('目前 高（3.30 V） · 暫停前：週期訊號 1.000 kHz · 50.0 %')
    expect(netLiveTitle(getNetLive('a20'))).toBe('目前的準位，以及暫停前訊號的樣子')
    // a stop the module never saw running (no run this session) claims no pause
    __resetNetActivityForTests()
    useStore.setState({ running: false })
    ingestCapture(cap)
    expect(netLiveText(getNetLive('a20'))).toBe('週期訊號 1.000 kHz · 50.0 %')
  })

  it('the analyzer’s words: a burst clock, a USART line, a bus’s data', () => {
    expect(netLiveText({ kind: 'toggling', edges: 90, v: 3.3, source: 'gpio', burstClock: 400e3 })).toBe('時脈 400.0 kHz（突發）')
    expect(netLiveText({ kind: 'toggling', edges: 90, v: 3.3, source: 'data', line: { baud: 115200, frame: '8N1' } })).toBe('UART 115 200 Bd · 8N1')
    expect(netLiveText({ kind: 'toggling', edges: 90, v: 3.3, source: 'data', protocol: 'SPI' })).toBe('SPI 資料')
  })

  it('a recorded net with a clock in bursts carries its burst clock into the live summary', () => {
    const LAY = example('rc-lowpass')
    useStore.setState({ layout: LAY })
    // the RC node (R1 / C1, column 20): not the generator's net, not a rail
    useLab.setState({ logicChannels: [{ index: 0, label: 'a20', source: { kind: 'net', ref: 'a20' } }] })
    const net = resolveNet('a20', LAY)!
    // 8 clocks at 400 kHz every 200 µs
    const l = new Line(0)
    for (let b = 0; b < 400; b++) for (let k = 0; k < 8; k++) {
      const t0 = 0.92 + b * 2e-4 + k * 2.5e-6
      l.set(t0, 1)
      l.set(t0 + 1.25e-6, 0)
    }
    useStore.setState({ telemetry: tel(1, { [net]: 0 }) })
    const cap: LogicCapture = { t0: 0.9, t1: 1, tNow: 1, overflow: false, traces: [{ ...l.trace(0), since: 0 }] }
    ingestCapture(cap)
    expect(netLiveText(getNetLive('a20'))).toBe('時脈 400.0 kHz（突發）')
  })
})

// ---------------------------------------------------------------------------
describe('UART-RX: the terminal’s sends are said, never drawn as edges', () => {
  afterEach(() => {
    __resetUartSendsForTests()
    useStore.setState({ simTime: 0 })
  })
  it('a send is kept with its time and bytes; a reset forgets it', () => {
    useStore.setState({ simTime: 0.6 })
    recordUartSend({ componentId: 'U1', port: 'USART1', t: 0.6, bytes: [0x68, 0x69, 0x0d, 0x0a], frameTime: 10 / 115200 })
    const s = useUartSends.getState().sends
    expect(s).toHaveLength(1)
    expect(sendDuration(s[0])).toBeCloseTo(4 * 10 / 115200, 12)
    expect(escapeBytes(s[0].bytes)).toBe('"hi\\r\\n"')
    expect(USART_RX.USART1).toBe('PA10')
    useStore.setState({ simTime: 0.1 })
    expect(useUartSends.getState().sends).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('DECODE-SUMMARY: the table at a glance', () => {
  const i2c = (t0: number, text: string, status: DecodedFrame['status']): DecodedFrame => ({ id: `i2c@${t0}`, instance: 'i2c', decoder: 'I²C', channel: 0, t0, t1: t0 + 1e-4, text, status })
  const frames = [i2c(1, 'Addr 0x08 W', 'nack'), i2c(2, 'Addr 0x76 W · 0xD0', 'ok'), i2c(3, 'Addr 0x3C W', 'ok'), i2c(4, 'Addr 0x50 R · 0x12', 'ok'), i2c(5, 'Addr 0x3C W', 'ok')]
  it('the answering addresses, in address order', () => {
    expect(ackedAddresses(frames)).toEqual(['0x3C', '0x50', '0x76'])
  })
  it('「位址 0x3C 寫」 / 「讀」 in 內容; bytes unchanged; the classic chrome keeps the decoders’ text', () => {
    expect(frameDisplayText(frames[1])).toBe('位址 0x76 寫 · 0xD0')
    expect(frameDisplayText(frames[3])).toBe('位址 0x50 讀 · 0x12')
    expect(frameDisplayText(frames[1], true)).toBe('Addr 0x76 W · 0xD0')
    // the search finds the words as shown, and still the address
    expect(frameMatches(frames[1], '位址 0x76', statusText(frames[1]), frameDisplayText(frames[1]))).toBe(true)
    expect(frameMatches(frames[1], '0x76', statusText(frames[1]))).toBe(true)
  })
  it('status filters: 只看 ACK / 只看錯誤', () => {
    expect(frames.filter((f) => frameFilter(f, 'ack')).map((f) => f.t0)).toEqual([2, 3, 4, 5])
    expect(frames.filter((f) => frameFilter(f, 'error')).map((f) => f.t0)).toEqual([1])
  })
})

// ---------------------------------------------------------------------------
describe('UART-TIMESTAMPS: honest decimals, one count per transcript', () => {
  const T = 10 / 115200
  it('a ~9 ms window prints 「≈ 1.00 s」, never 「≈ 0.997 s」', () => {
    expect(arrivalDecimals(0.009)).toBe(2)
    expect(fmtArrival(0.9926, 1.0016, { frameTime: T })).toBe('≈ 1.00 s')
    expect(fmtArrival(2.57, 2.586, { frameTime: T })).toBe('≈ 2.6 s')
    // the recorder's start bit: exact, to the microsecond
    expect(fmtArrival(0.9926, 1.0016, { frameTime: T, exact: 1.00142 })).toBe('1.001 420 s')
  })
  it('one decimal count for the whole transcript', () => {
    const line = (at: number, t0: number, t1: number): TerminalLine => ({ kind: 'text', at, bytes: [0x41], text: 'A', t0, t1, end: t1, echo: false })
    const lines = [line(0, 0.0003, 0.0021), line(10, 0.9926, 1.0016), line(20, 1.995, 2.0)]
    expect(transcriptDecimals(lines)).toBe(2)
    // every line exact → the microsecond
    expect(transcriptDecimals(lines, new Map([[0, 0.00142], [10, 1.00142], [20, 2.00142]]))).toBe(6)
    // one line looked up but not on the wire (NaN) keeps the coarse count
    expect(transcriptDecimals(lines, new Map([[0, 0.00142], [10, Number.NaN], [20, 2.00142]]))).toBe(2)
    const d = transcriptDecimals(lines)
    const stamps = lines.map((l) => (l.kind === 'text' ? fmtArrival(l.t0, l.t1, { frameTime: T, decimals: d }) : ''))
    expect(new Set(stamps.map((s) => /\.(\d+)/.exec(s)?.[1].length)).size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('SCOPE: cursors that measure, a readout that fits the signal, a trigger chip', () => {
  /** rc-lowpass CH2: 100 Hz square 0–5 V through R = 10 kΩ, C = 100 nF (τ = 1 ms), sampled every 20 µs */
  function rc(): { t: number[]; v: number[]; sq: number[] } {
    const t: number[] = []
    const v: number[] = []
    const sq: number[] = []
    let vc = 0
    const dt = 2e-5
    for (let k = 0; k <= 4000; k++) {
      const time = k * dt
      const vin = Math.floor(time / 0.005) % 2 === 0 ? 5 : 0
      vc += (vin - vc) * (1 - Math.exp(-dt / 1e-3))
      t.push(time)
      v.push(vc)
      sq.push(vin)
    }
    return { t, v, sq }
  }
  it('an RC charge curve is analog: rise time ≈ 2.2 ms, no duty cycle', () => {
    const { t, v } = rc()
    const m = measureWave(t, v, 0.02, 0.08)
    expect(m.shape).toBe('analog')
    expect(m.rise).toBeGreaterThan(2.1e-3)
    expect(m.rise).toBeLessThan(2.3e-3)
  })
  it('a square wave has two levels', () => {
    const { t, sq } = rc()
    expect(measureWave(t, sq, 0.02, 0.08).shape).toBe('two-level')
  })
  it('a channel’s voltage at a cursor, interpolated; outside the trace → null', () => {
    const tr = { t: Float64Array.from([0, 1e-3, 2e-3]), v: Float32Array.from([0, 2, 4]) }
    expect(valueAt(tr, 0.5e-3)).toBeCloseTo(1, 6)
    expect(valueAt(tr, 2e-3)).toBeCloseTo(4, 6)
    expect(valueAt(tr, 3e-3)).toBeNull()
  })
  it('the trigger instant (division 5) always carries a label', () => {
    expect(labelledDivisions(2, 5)).toEqual([1, 3, 5, 7, 9])
    expect(labelledDivisions(5, 5)).toEqual([0, 5, 10])
    expect(labelledDivisions(2, 10)).toEqual([0, 2, 4, 6, 8, 10])
    expect(labelledDivisions(2, null)).toEqual([0, 2, 4, 6, 8, 10])
  })
  it('the trigger chip says what it is set to, every field named', () => {
    expect(scopeTriggerSummary({ trigSource: 0, trigSlope: 'rising', trigLevel: 1.55, trigMode: 'auto', holdoff: 0 })).toBe('觸發：CH1 ↑ 上升緣 · 準位 1.55 V · 自動')
    expect(scopeTriggerSummary({ trigSource: 1, trigSlope: 'falling', trigLevel: 2.5, trigMode: 'single', holdoff: 1e-3 })).toBe('觸發：CH2 ↓ 下降緣 · 準位 2.50 V · 單次 · 抑制 1 ms')
    expect(scopeTriggerSummary({ trigSource: null, trigSlope: 'rising', trigLevel: 0, trigMode: 'auto', holdoff: 0 })).toBe('觸發：關')
  })
  it('signed times use the typographic minus', () => {
    expect(fmtSiSigned(-0.004, 's')).toBe('−4.000 ms')
    expect(fmtSetting(100, 'Hz')).toBe('100 Hz')
    expect(fmtSetting(0.5, 'Hz')).toBe('0.5 Hz')
  })
})

// ---------------------------------------------------------------------------
describe('GLOSSARY-IN-INSTRUMENTS', () => {
  it('上升時間 and the I²C lane letters are explained (registered additively)', () => {
    expect(hasInstrumentTerm('rise')).toBe(true)
    expect(hasInstrumentTerm('i2c-lane')).toBe(true)
    // glossary.ts now defines both as real GlossaryIds with the same text
    expect((GLOSSARY as Record<string, unknown>).rise).toEqual(INSTRUMENT_TERMS.rise)
    expect(t(INSTRUMENT_TERMS['i2c-lane']!.body)).toBe('S＝開始、Sr＝重複開始、P＝停止、A＝ACK（有回應）、N＝NACK（沒有回應）。')
  })
})

// ---------------------------------------------------------------------------
describe('PERF-ORDER-VERDICT: 「為什麼慢？」 first', () => {
  const snap = (p: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
    windowMs: 2000,
    fps: 103,
    frameP50: 9,
    frameP95: 12,
    cpuP50: 2,
    cpuP95: 3,
    calls: 100,
    triangles: 1000,
    geometries: 10,
    textures: 5,
    programs: 3,
    commitsPerSec: 4,
    commitSource: 'react',
    telemetryPushesPerSec: 30,
    telemetryMsPerPush: 0.1,
    partsAppliedPerPush: 1,
    partsSkippedPerPush: 3,
    sim: { running: true, realtime: 0.5, stepsPerSecond: 20000, busyPct: 96.4, framesPerSec: 30, handleMs: 0.4 },
    mcus: [{ componentId: 'U1', mips: 19.1, mhz: 38.2 } as never],
    heapMB: 90,
    longTaskShare: 0,
    gpu: { renderer: null, software: false },
    ...p,
  })
  const BOARDS: PerfBoard[] = [{ id: 'U1', state: 'running' }]
  it('a simulation thread at its limit: the computer, not the picture', () => {
    const v = perfVerdict(snap())
    expect(v.kind).toBe('sim')
    expect(v.text).toBe('模擬 0.5 倍速：模擬執行緒已滿載（96.4 %）——是電腦算不夠快，不是畫面卡')
    expect(perfSummary(snap())).toBe('每秒 103 張 · 0.5 倍速 · 電腦算不夠快')
  })
  it('a slow picture; all fine; a slow-motion run is not "behind"', () => {
    expect(perfVerdict(snap({ fps: 20, sim: { running: true, realtime: 1, stepsPerSecond: 1, busyPct: 30, framesPerSec: 30, handleMs: 0.4 } })).kind).toBe('render')
    expect(perfVerdict(snap({ sim: { running: true, realtime: 1.01, stepsPerSecond: 1, busyPct: 40, framesPerSec: 30, handleMs: 0.4 } })).text).toBe('一切正常：模擬跟得上真實時間')
    expect(perfVerdict(snap({ sim: { running: true, realtime: 0.1, stepsPerSecond: 1, busyPct: 10, framesPerSec: 30, handleMs: 0.4 } }), 0.1).kind).toBe('ok')
  })
  it('the simulation section first: 模擬速度, the thread load, the boards, then the rest', () => {
    const s = perfSections(snap(), BOARDS)
    expect(s.map((x) => x.key)).toEqual(['sim', 'render', 'ui'])
    expect(s[0].rows.slice(0, 3).map((r) => r.key)).toEqual(['rt', 'busy', 'mcu:U1'])
  })
})

// ---------------------------------------------------------------------------
describe('ANALYSIS-LAYOUT-SPACE: an empty plot gets the measurements beside it', () => {
  const ws = (left: boolean, right: boolean, h: number) => ({ left: { open: left }, right: { open: right }, tray: { open: true, height: h } })
  it('recognises the analysis arrangement', () => {
    expect(isAnalysisArrangement(ws(false, false, 495), 900)).toBe(true)
    expect(isAnalysisArrangement(ws(true, false, 495), 900)).toBe(false)
    expect(isAnalysisArrangement(ws(false, false, 300), 900)).toBe(false)
  })
  it('opens 各通道量測 (and 解碼結果 with decoders) when > 40 % of the plot is empty — the user’s toggles win', () => {
    const v = { measCol: false, results: false, measColByUser: false, resultsByUser: false }
    expect(analysisAutoOpen(v, 500, 136, false)).toEqual({ measCol: true })
    expect(analysisAutoOpen(v, 500, 136, true)).toEqual({ measCol: true, results: true })
    expect(analysisAutoOpen(v, 500, 400, true)).toEqual({})
    expect(analysisAutoOpen({ ...v, measColByUser: true, resultsByUser: true }, 500, 136, true)).toEqual({})
  })
})
