/**
 * UX wave — instruments workstream (IS-1 … IS-8), pure parts:
 *  - fmtFreq: never "mHz", 4 significant digits from 1 Hz up, 3 below;
 *  - auto-fit: typical period, busiest channel, span choice (4–10 periods),
 *    newest decoded frame;
 *  - measureWave guard: decimated / under-sampled captures give no timing;
 *  - decoded frames (I²C transfers, UART lines) for the results table;
 *  - decoder auto-mapping (a second UART decoder lands on RX), summaries;
 *  - scope auto setup timebase; bus definitions; UART byte-run search;
 *  - the terminal's line model (stamps + separators) and arrival format.
 */
import { describe, expect, it } from 'vitest'
import { fmtFreq, fmtSpan, fmtTimeRange } from '../src/instruments/format'
import { measureWave } from '../src/instruments/measure'
import {
  LA_SPANS,
  adjacentEdge,
  busiestTrace,
  fitLogicSpan,
  spanAtLeast,
  spanForPeriod,
  typicalPeriod,
} from '../src/instruments/autofit'
import type { LogicChannelConfig } from '../src/sim/coordinator/api'
import { decodedFrames, runDecoder } from '../src/ui/embedded/logic-decoders'
import { decoderSummary, measuredBaudOf, newDecoderConfig, triggerCondition, TRIGGER_DEFAULTS } from '../src/ui/embedded/instruments/la-config'
import { busByKey, busUse, uartDecoderOptions, uartFormat } from '../src/ui/embedded/instruments/buses'
import { activePinFunction } from '../src/ui/embedded/instruments/pin-function'
import { channelPickerGroups } from '../src/ui/embedded/instruments/channel-picker'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { readFileSync } from 'node:fs'
import { findByteRun } from '../src/ui/embedded/instruments/uart-reveal'
import { buildTerminalLines, fmtArrival } from '../src/ui/embedded/UartTerminal'
import { tdivForPeriod } from '../src/ui/embedded/instruments/scope-autoset'
import { stepSpan } from '../src/ui/embedded/instruments/la-view'
import { ascii, capture, i2cLines, Line, uartLine } from './instruments/synth'
import uxInstruments from '../src/i18n/zh-TW/ux-instruments'
import { MAINLAND_TERMS, englishLeft } from './i18n/zh-check'

const ch = (index: number, label: string, pin = label): LogicChannelConfig => ({
  index,
  label,
  source: { kind: 'mcu-pin', componentId: 'U1', pin },
})

/** a square wave: toggles every half period from t0 for n half periods */
function square(half: number, n: number, t0 = 0.5 * half, initial: 0 | 1 = 0): Line {
  const l = new Line(initial)
  let v: 0 | 1 = initial
  for (let k = 0; k < n; k++) {
    v = v === 0 ? 1 : 0
    l.set(t0 + k * half, v)
  }
  return l
}

describe('ux-instruments dictionary: Taiwan Chinese, no English left', () => {
  it('every entry is translated, uses Taiwan terms and keeps its placeholders', () => {
    for (const [en, zh] of Object.entries(uxInstruments)) {
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${en} → ${zh} uses ${term}`).toBe(false)
      // keycap names (Alt, Esc, Shift) are printed on the keyboard, not translated
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' '), ['Alt', 'Esc', 'Shift']), `${en} → ${zh}`).toEqual([])
      // the same set of placeholders (a translation may repeat one)
      const ph = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join()
      expect(ph(zh), en).toBe(ph(en.split('|')[0]))
    }
    // the copy the spec asks for, word for word
    expect(uxInstruments['No signal changes in this window. Press “Auto” to zoom to the signal.']).toBe(
      '目前視窗內沒有訊號變化。按「自動」縮放到有訊號的範圍。',
    )
    expect(uxInstruments['Click the waveform to place marker A, click again for B — then read Δt and the frequency.']).toBe(
      '點一下波形放 A 標記，再點一下放 B，就能量 Δt 與頻率。',
    )
    expect(uxInstruments['Timebase too slow to measure frequency — press “Auto setup”']).toBe('時基太慢，無法量頻率——按「自動設定」')
    expect(uxInstruments['Source {id} no longer exists']).toBe('來源 {id} 已不存在')
  })
})

describe('IS-1 fmtFreq — no milli prefix for a frequency', () => {
  it('formats below 1 Hz with 3 significant digits in Hz', () => {
    expect(fmtFreq(0.998)).toBe('0.998 Hz')
    expect(fmtFreq(1 / 1.002)).toBe('0.998 Hz')
    expect(fmtFreq(0.05)).toBe('0.0500 Hz')
    expect(fmtFreq(0.9996)).toBe('1.000 Hz') // rounds up into the next range
  })
  it('formats 1 Hz – 1 kHz in Hz and kHz / MHz with 4 significant digits', () => {
    expect(fmtFreq(1)).toBe('1.000 Hz')
    expect(fmtFreq(50)).toBe('50.00 Hz')
    expect(fmtFreq(998)).toBe('998.0 Hz')
    expect(fmtFreq(999.96)).toBe('1.000 kHz')
    expect(fmtFreq(1000)).toBe('1.000 kHz')
    expect(fmtFreq(99_250)).toBe('99.25 kHz')
    expect(fmtFreq(72e6)).toBe('72.00 MHz')
  })
  it('never prints mHz, and refuses non-positive / non-finite input', () => {
    for (const f of [0.001, 0.0123, 0.5, 0.75]) expect(fmtFreq(f)).not.toMatch(/mHz/)
    expect(fmtFreq(0)).toBe('—')
    expect(fmtFreq(-3)).toBe('—')
    expect(fmtFreq(Number.NaN)).toBe('—')
  })
  it('fmtSpan drops trailing zeros', () => {
    expect(fmtSpan(0.01)).toBe('10 ms')
    expect(fmtSpan(0.001)).toBe('1 ms')
    expect(fmtSpan(5e-4)).toBe('500 µs')
    expect(fmtSpan(5)).toBe('5 s')
  })
})

describe('IS-1 auto-fit', () => {
  it('the ladder is 1-2-5 from 1 µs to 20 s, without float noise', () => {
    expect(LA_SPANS[0]).toBe(1e-6)
    expect(LA_SPANS).toContain(0.005)
    expect(LA_SPANS[LA_SPANS.length - 1]).toBe(20)
    expect(spanAtLeast(0.004)).toBe(0.005)
    expect(spanAtLeast(0.005)).toBe(0.005)
  })
  it('chooses the smallest span showing ≥ 4 periods: 1 kHz → 5 ms, 0.998 Hz → 5 s', () => {
    expect(spanForPeriod(1e-3)).toBe(0.005)
    expect(spanForPeriod(1.002)).toBe(5)
    // always 4–10 periods (ladder steps ≤ 2.5×)
    for (const p of [3e-6, 7.7e-5, 1.3e-3, 0.042, 0.3]) {
      const n = spanForPeriod(p) / p
      expect(n).toBeGreaterThanOrEqual(4)
      expect(n).toBeLessThan(10.0001)
    }
  })
  it('typical period: rising-to-rising median, or edge-to-edge with < 2 rising edges', () => {
    const blink = square(0.501, 6) // 0.2505, 0.7515, … toggles every 501 ms
    expect(typicalPeriod(blink.trace())).toBeCloseTo(1.002, 9)
    const once = square(0.501, 2) // one rise, one fall
    expect(typicalPeriod(once.trace())).toBeCloseTo(0.501, 9)
    expect(typicalPeriod(square(0.5, 1).trace())).toBeNull()
    // a printed frequency needs a whole period: one rise + one fall is not one
    expect(typicalPeriod(once.trace(), -Infinity, Infinity, { risingOnly: true })).toBeNull()
    expect(typicalPeriod(blink.trace(), -Infinity, Infinity, { risingOnly: true })).toBeCloseTo(1.002, 9)
    // a 10 % PWM seen for one pulse: edge-to-edge = the pulse width, never its period
    const pulse = new Line(0)
    pulse.set(1e-3, 1)
    pulse.set(1.1e-3, 0)
    expect(typicalPeriod(pulse.trace(), -Infinity, Infinity, { risingOnly: true })).toBeNull()
  })
  it('a span from one edge-to-edge interval is marked incomplete (re-checked), a full period is final', () => {
    expect(fitLogicSpan(capture(0, 1.2, [square(0.501, 2).trace()]), [])).toMatchObject({ kind: 'period', complete: false })
    expect(fitLogicSpan(capture(0, 3.2, [square(0.501, 6).trace()]), [])).toMatchObject({ kind: 'period', complete: true })
  })
  it('fits the busiest channel; blink at 3 s shows ≥ 2 periods in a 5 s window', () => {
    const pa5 = square(0.501, 5, 0.501).trace(0)
    const pc13 = square(0.501, 5, 0.501, 1).trace(1)
    const flat = new Line(0).trace(2)
    const cap = capture(0, 3, [flat, pc13, pa5])
    expect(busiestTrace(cap)?.index).toBe(0)
    const fit = fitLogicSpan(cap, [])
    expect(fit).toMatchObject({ kind: 'period', span: 5, channel: 0 })
    expect(fitLogicSpan(capture(0, 3, [flat]), [])).toEqual({ kind: 'none' })
  })
  it('PWM 1 kHz fits 5 ms (5 periods)', () => {
    const pwm = new Line(0)
    for (let k = 0; k < 40; k++) {
      pwm.set(k * 1e-3, 1)
      pwm.set(k * 1e-3 + 3e-4, 0)
    }
    expect(fitLogicSpan(capture(0, 0.04, [pwm.trace()]), [])).toMatchObject({ kind: 'period', span: 0.005 })
  })
  it('decoded frames win: 1.5 × the newest frame, centred on it', () => {
    const fit = fitLogicSpan(capture(0, 1, []), [
      { t0: 0.1, t1: 0.1001 },
      { t0: 0.5, t1: 0.5001 },
    ])
    expect(fit.kind).toBe('frame')
    if (fit.kind !== 'frame') return
    expect(fit.span).toBe(spanAtLeast(1.5e-4))
    expect(fit.end - fit.span / 2).toBeCloseTo(0.50005, 9)
  })
  it('adjacent edges and ladder steps', () => {
    const l = square(1e-3, 4).trace() // edges at 0.5, 1.5, 2.5, 3.5 ms
    expect(adjacentEdge(l, 1e-3, 1)).toBeCloseTo(1.5e-3, 12)
    expect(adjacentEdge(l, 1e-3, -1)).toBeCloseTo(0.5e-3, 12)
    expect(adjacentEdge(l, 4e-3, 1)).toBeNull()
    expect(stepSpan(0.01, 1)).toBe(0.02)
    expect(stepSpan(0.01, -1)).toBe(0.005)
    expect(stepSpan(3.7, -1)).toBe(2) // an arbitrary span (⤢ all) steps onto the ladder
  })
})

describe('IS-2 measureWave guard: never a timing value from data that cannot hold it', () => {
  // 1 kHz square solved at its edges only (4 samples per period)
  const t: number[] = []
  const v: number[] = []
  for (let k = 0; k < 20; k++) {
    const p = k * 1e-3
    t.push(p, p + 1e-7, p + 5e-4, p + 5e-4 + 1e-7)
    v.push(0, 3.3, 3.3, 0)
  }
  it('exact edge-solved data keeps its frequency', () => {
    const m = measureWave(t, v, -Infinity, Infinity, {})
    expect(m.timing).toBeNull()
    expect(m.frequency!).toBeCloseTo(1000, 3)
  })
  it('a decimated capture withholds frequency / period / duty but keeps the levels', () => {
    const m = measureWave(t, v, -Infinity, Infinity, { decimated: true })
    expect(m).toMatchObject({ timing: 'decimated', frequency: null, period: null, duty: null, rise: null })
    expect(m.vpp).toBeCloseTo(3.3, 6)
    expect(m.vavg).not.toBeNull()
  })
  it('fewer than 4 samples per period → under-sampled', () => {
    // the same 1 kHz wave seen through a coarse 0.6 ms sampler
    const ts: number[] = []
    const vs: number[] = []
    for (let x = 0; x < 0.02; x += 6e-4) {
      ts.push(x)
      vs.push(x % 1e-3 < 5e-4 ? 3.3 : 0)
    }
    const m = measureWave(ts, vs, -Infinity, Infinity, {})
    expect(m.timing).toBe('undersampled')
    expect(m.frequency).toBeNull()
  })
  it('a period narrower than 2 px on screen → under-sampled', () => {
    // 500 ms/div over 600 px: 1 ms = 0.12 px
    const m = measureWave(t, v, -Infinity, Infinity, { pxPerSecond: 600 / 5 })
    expect(m.timing).toBe('undersampled')
    expect(measureWave(t, v, -Infinity, Infinity, { pxPerSecond: 600 / 2e-3 }).timing).toBeNull()
  })
  it('without a guard argument the old behaviour is unchanged for well-sampled data', () => {
    expect(measureWave(t, v).frequency!).toBeCloseTo(1000, 3)
  })
  it('a 97 % PWM (mean inside the hysteresis band of the top level) still reads 1 kHz and its duty', () => {
    // pwm-fade near the top of its sweep: 0.97 ms high, 0.03 ms low, 3.1 V
    const th: number[] = []
    const vh: number[] = []
    for (let k = 0; k < 20; k++) {
      const p = k * 1e-3
      for (let x = 0; x < 1e-3 - 1e-9; x += 1e-5) {
        th.push(p + x)
        vh.push(x < 0.97e-3 ? 3.1 : 0)
      }
    }
    const m = measureWave(th, vh, -Infinity, Infinity, {})
    expect(m.timing).toBeNull()
    expect(m.frequency!).toBeCloseTo(1000, 0)
    expect(m.duty!).toBeCloseTo(0.97, 2)
  })
})

describe('IS-6 decoded frames', () => {
  it('I²C transfers become "Addr 0x27 W" rows with their ACK / NACK status', () => {
    const { scl, sda, end } = i2cLines([
      { op: 'start' },
      { op: 'byte', value: 0x27 << 1, ack: false },
      { op: 'stop' },
      { op: 'start' },
      { op: 'byte', value: 0x50 << 1, ack: true },
      { op: 'byte', value: 0x00, ack: true },
      { op: 'stop' },
    ])
    const cap = capture(0, end + 1e-4, [scl.trace(0), sda.trace(1)])
    const run = runDecoder(cap, { id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 } })!
    const frames = decodedFrames([run])
    expect(frames.map((f) => [f.text, f.status])).toEqual([
      ['Addr 0x27 W', 'nack'],
      ['Addr 0x50 W · 00', 'ok'],
    ])
    expect(frames[0].t0).toBeLessThan(frames[1].t0)
    expect(frames.every((f) => f.decoder === 'I²C' && f.instance === 'i2c1' && f.channel === 1)).toBe(true)
  })
  it('UART bytes group into lines (a line feed or a pause ends one)', () => {
    const baud = 115200
    const a = uartLine([...ascii('Hello\r\n'), ...ascii('tick 1\r\n')], { baud, lead: 1e-4 })
    const cap = capture(0, a.end + 1e-3, [a.line.trace(0)])
    const run = runDecoder(cap, { id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } })!
    const frames = decodedFrames([run])
    expect(frames.map((f) => f.text)).toEqual(['"Hello\\r\\n"', '"tick 1\\r\\n"'])
    expect(frames[0].status).toBe('ok')
  })

  it('a UART lane carries its lines as a coarse level (drawn when bytes are too narrow to label)', () => {
    const baud = 115200
    const a = uartLine([...ascii('Hello\r\n'), ...ascii('tick 1\r\n')], { baud, lead: 1e-4 })
    const cap = capture(0, a.end + 1e-3, [a.line.trace(0)])
    const run = runDecoder(cap, { id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } })!
    const lane = run.rows.find((r) => r.id === 'uart1:data')!
    expect(lane.items).toHaveLength(15) // one box per byte
    expect(lane.coarse!.map((x) => x.text)).toEqual(['Hello\\r\\n', 'tick 1\\r\\n'])
    expect(lane.coarse![0].t0).toBeCloseTo(a.starts[0], 9)
    expect(lane.coarse![0].short).toBe('Hello…')
    // exports / the results table still read the raw byte annotations
    expect(run.annotations.filter((x) => x.row === 'data')).toHaveLength(15)
  })
})

describe('decoder notes stay honest before the first run', () => {
  it('mapped roles over an empty capture wait for data — they are not "missing a channel"', () => {
    const empty = capture(0, 0.01, [])
    const mapped = runDecoder(empty, { id: 'i2c', decoder: 'i2c', channels: { scl: 0, sda: 1 } })!
    expect(mapped.missing).toEqual([])
    expect(mapped.rows).toEqual([])
    const unmapped = runDecoder(empty, { id: 'i2c', decoder: 'i2c', channels: {} })!
    expect(unmapped.missing.sort()).toEqual(['scl', 'sda'])
    // a capture WITH traces but not the mapped one: that channel is gone
    const other = capture(0, 0.01, [new Line(1).trace(5)])
    expect(runDecoder(other, { id: 'i2c', decoder: 'i2c', channels: { scl: 0, sda: 1 } })!.missing.sort()).toEqual(['scl', 'sda'])
  })
})

describe('IS-9 measurement column formatting', () => {
  it('pulse widths: one value when constant, a min–max range with the unit written once', () => {
    expect(fmtTimeRange(0.501, 0.501)).toBe('501 ms')
    expect(fmtTimeRange(8.68e-6, 86.8e-6)).toBe('8.68–86.8 µs')
    expect(fmtTimeRange(950e-6, 1.2e-3)).toBe('950 µs–1.20 ms')
    expect(fmtTimeRange(NaN, 1)).toBe('—')
  })
})

describe('IS-3 / IS-5 decoder configuration helpers', () => {
  const channels = [ch(0, 'PA9 TX', 'PA9'), ch(1, 'PA10 RX', 'PA10')]
  it('the UART data channel prefers a TX / RX channel no other UART decoder reads', () => {
    const first = newDecoderConfig('uart', channels, [])!
    expect(first.channels).toEqual({ data: 0 })
    const second = newDecoderConfig('uart', channels, [first])!
    expect(second.channels).toEqual({ data: 1 })
    expect(second.id).toBe('uart2')
  })
  it('summaries for the toolbar chips', () => {
    const tr = (s: string, p?: Record<string, string | number>) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => String(p?.[k] ?? ''))
    expect(decoderSummary({ decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } }, channels, tr)).toBe(
      'UART · PA9 TX · 115200 8N1',
    )
    expect(decoderSummary({ decoder: 'uart', channels: { data: 1 }, options: {} }, channels, tr, 9600)).toBe(
      'UART · PA10 RX · 9600 (auto) 8N1',
    )
    expect(decoderSummary({ decoder: 'i2c', channels: { scl: 0, sda: 1 } }, channels, tr)).toBe('I²C · PA9 TX / PA10 RX')
    expect(measuredBaudOf(['auto: 115200 Bd (measured 115207 Bd)'])).toBe(115200)
    expect(measuredBaudOf([])).toBeNull()
    expect(triggerCondition(TRIGGER_DEFAULTS, channels)).toBe('PA9 TX ↓')
    expect(triggerCondition({ ...TRIGGER_DEFAULTS, kind: 'pattern', pattern: { 1: 1 } }, channels)).toBe('PA10 RX=1')
  })
})

describe('IS-7 buses', () => {
  const cfg = { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
  it('USART decoder options and format come from the firmware line config', () => {
    expect(uartDecoderOptions(cfg)).toEqual({ baud: '115200', dataBits: '8', parity: 'none', stopBits: '1' })
    expect(uartDecoderOptions({ ...cfg, baud: 115107 }).baud).toBe('115200') // within 1 % of standard
    expect(uartDecoderOptions({ ...cfg, baud: 250000 }).baud).toBe('250000')
    expect(uartDecoderOptions({ ...cfg, enabled: false })).toEqual({})
    expect(uartFormat({ ...cfg, parity: 'even' })).toBe('115200 7E1')
  })
  it('use detection: AF pins / an enabled USART beat plain wiring', () => {
    const usart1 = busByKey('USART1')!
    const i2c1 = busByKey('I2C1')!
    const never = () => false
    expect(busUse(usart1, { PA9: 'af', PA10: 'in' }, never, [{ name: 'USART1', config: cfg }])).toBe(2)
    expect(busUse(i2c1, { PB6: 'af-od', PB7: 'af-od' }, never)).toBe(2)
    expect(busUse(i2c1, { PB6: 'in', PB7: 'in' }, () => true)).toBe(1)
    expect(busUse(i2c1, undefined, never)).toBe(0)
    expect(busByKey('I2C1-remap')?.signals.map((s) => s.pin)).toEqual(['PB8', 'PB9'])
  })
  it('the active alternate function is named only when unambiguous', () => {
    // IS-10: the picker uses the shared H10 judgement (channel-picker's own variant is gone)
    expect(activePinFunction(['USART1_TX', 'TIM1_CH2'], 'af', { uarts: [{ name: 'USART1', config: { enabled: true } }] })).toBe('USART1_TX')
    expect(activePinFunction(['I2C1_SCL', 'TIM4_CH1', 'USART1_TX (remap)'], 'af-od')).toBe('I2C1_SCL')
    expect(activePinFunction(['SPI1_MISO', 'ADC12_IN6', 'TIM3_CH1'], 'af')).toBeNull()
    expect(activePinFunction(['USART1_TX'], 'out')).toBeNull()
  })
})

describe('IS-2 scope auto setup timebase', () => {
  it('shows about 2–3 periods across 10 divisions', () => {
    expect(tdivForPeriod(1e-3)).toBe(2e-4) // 1 kHz → 200 µs/div (2 periods)
    for (const p of [1e-3, 2.2e-4, 0.0173, 0.4]) {
      const periods = (10 * tdivForPeriod(p)) / p
      expect(periods).toBeGreaterThanOrEqual(1.9)
      expect(periods).toBeLessThanOrEqual(5)
    }
  })
})

describe('IS-8 UART line ↔ wire, terminal model', () => {
  it('finds a line on the wire by its bytes and extends to its last byte', () => {
    const wire = ascii('xxHello\r\nab').map((value, k) => ({ t0: k * 1e-4, t1: k * 1e-4 + 8.7e-5, value }))
    const run = findByteRun(wire, ascii('Hello'), 0, 1)!
    expect(run.t0).toBeCloseTo(2e-4, 12)
    expect(run.t1).toBeCloseTo(6e-4 + 8.7e-5, 12)
    expect(findByteRun(wire, ascii('Hello'), 3e-4, 1)).toBeNull() // must start inside the window
    expect(findByteRun(wire, ascii('nope'), 0, 1)).toBeNull()
  })
  it('splits lines at CR LF / CR / LF with the arrival window of their first byte, separators in place', () => {
    const bytes = Uint8Array.from(ascii('Hello\r\ntick 1\nab'))
    const chunks = [
      { at: 100, n: 7, t0: 0, t1: 0.016 },
      { at: 107, n: 9, t0: 0.99, t1: 1.006 },
    ]
    const marks = [{ id: 1, componentId: 'U1', kind: 'load' as const, t: 0.5, name: 'x.elf', sha: '12345678', offsets: { USART1: 107 } }]
    const lines = buildTerminalLines(bytes, 100, chunks, marks, 'USART1')
    expect(lines.map((l) => (l.kind === 'mark' ? `--${l.mark.name}` : `${l.text}@${l.t1}`))).toEqual([
      'Hello@0.016',
      '--x.elf',
      'tick 1@1.006',
      'ab@1.006',
    ])
    // a mark before the retained bytes is gone with them; one at the end stays
    const late = [{ ...marks[0], offsets: { USART1: 116 } }, { ...marks[0], id: 2, offsets: { USART1: 50 } }]
    expect(buildTerminalLines(bytes, 100, chunks, late, 'USART1').map((l) => l.kind)).toEqual(['text', 'text', 'text', 'mark'])
  })
  it('arrival stamps carry no invented digits', () => {
    // classic chrome keeps the arrival stamp of the first byte
    const classic = { classic: true }
    expect(fmtArrival(2.570, 2.586, classic)).toBe('≈2.59 s')
    expect(fmtArrival(0.0003, 0.0021, classic)).toBe('≈2 ms') // ±1.8 ms: no decimals
    expect(fmtArrival(0.2, 0.2003, classic)).toBe('≈200.3 ms')
    expect(fmtArrival(1.25, 1.25, classic)).toBe('1.250 s')
    expect(fmtArrival(null, null, classic)).toBe('—')
    // product chrome (IS-17 / IS-20): the line START (one character before the first
    // byte arrived), in seconds like every simulation time (H3), ≈ with a space
    const T = 10 / 115200
    // QA clarity UART-TIMESTAMPS: the decimals a 16 ms window can carry — floor(−log10 0.016) = 1
    expect(fmtArrival(2.570, 2.586, { frameTime: T })).toBe('≈ 2.6 s')
    expect(fmtArrival(1.25, 1.25, { frameTime: T })).toBe('1.249 913 s')
    expect(fmtArrival(1.25, 1.25)).toBe('1.250 000 s')
    expect(fmtArrival(0.0003, 0.0021)).toBe('≈ 0.00 s') // a 1.8 ms window: two decimals, never a third invented one
    expect(fmtArrival(null, null)).toBe('—')
  })
})

describe('IS-10 the channel picker never labels an I²C pin as USART', () => {
  const layoutOf = (id: string): CircuitLayout =>
    JSON.parse(readFileSync(new URL(`../examples/embedded/${id}.ohmlet.json`, import.meta.url), 'utf8')).layout
  const tr = (src: string, params?: Record<string, string | number>) =>
    src.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''))
  const modeLabel = (m: string) => ({ af: 'AF', 'af-od': 'AF-OD', out: 'OUT', in: 'IN' })[m] ?? m
  const usart1 = { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
  const groupsFor = (id: string, pinModes: Record<string, string>) =>
    channelPickerGroups({
      layout: layoutOf(id),
      telemetry: { components: { U1: { mcu: { state: 'running', pc: 0, hclkHz: 8e6, cycles: 0, pinModes } } } } as unknown as SimTelemetry,
      mcus: { U1: { componentId: 'U1', state: 'running', firmware: 'x', pc: 0, hclkHz: 8e6, cycles: 0, realtime: 1, uarts: [{ name: 'USART1', config: usart1 }] } },
      channels: [],
      tr,
      modeLabel,
    })
  const labels = (gs: ReturnType<typeof channelPickerGroups>, group: string) =>
    gs.find((g) => g.label === group)?.options.map((o) => o.label) ?? []

  it('hal-i2c-scan (USART1 printing, I2C1 scanning): PB6 / PB7 are I2C1, the bus is I2C1 on PB6 / PB7', () => {
    const gs = groupsFor('i2c-scan', { PB6: 'af-od', PB7: 'af-od', PA9: 'af', PA10: 'in' })
    const pins = labels(gs, 'Pins in use')
    expect(pins).toContain('PB6 · I2C1_SCL · AF-OD')
    expect(pins).toContain('PB7 · I2C1_SDA · AF-OD')
    expect(pins.filter((l) => /^PB[67] /.test(l) && /USART/.test(l))).toEqual([])
    const buses = labels(gs, 'Buses (channels + decoder)')
    expect(buses).toContain('I2C1 (PB6 SCL／PB7 SDA) + I²C decoder')
    expect(buses.some((l) => /USART1 \(PB6/.test(l))).toBe(false)
    // the remapped pin sets are never offered while AFIO_MAPR is unknown
    expect(buses.some((l) => /PB8|PB3/.test(l))).toBe(false)
  })
  it('a pin whose function is ambiguous shows its mode only (never a guess)', () => {
    const gs = groupsFor('i2c-scan', { PB6: 'af', PB7: 'af' })
    const pins = labels(gs, 'Pins in use')
    expect(pins).toContain('PB6 · AF')
    expect(pins).toContain('PB7 · AF')
  })
  it('hal-uart-hello: PA9 still reads USART1_TX and the bus is USART1 on PA9 / PA10', () => {
    const gs = groupsFor('uart-hello', { PA9: 'af', PA10: 'in' })
    expect(labels(gs, 'Pins in use')).toContain('PA9 · USART1_TX · AF')
    expect(labels(gs, 'Buses (channels + decoder)')[0]).toMatch(/^USART1 \(PA9 TX／PA10 RX\) \+ UART decoder 115200 8N1$/)
  })
})
