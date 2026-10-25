/**
 * UX fix wave — instruments IS-11 (P0): no frequency for a signal that does
 * not repeat.
 *  - classifyPeriods / measureEdges: a steady PWM is periodic; a PWM passing
 *    0 % / 100 % (skipped pulses) still reads its timer frequency; UART data
 *    is aperiodic (no frequency, no duty); an I²C SCL / SPI SCK in bursts
 *    reports its in-burst clock;
 *  - measureWave: the same rule on analog samples ('aperiodic'), and the
 *    samples-per-period figure that limits an analog estimate to 3 digits;
 *  - the readout texts (signal-readout.ts): the baud line of a UART pin or
 *    decoder, 「時脈 … （突發）」, 「—（非週期訊號）」; fmtBaud, fmtFreq(…, 3).
 */
import { describe, expect, it } from 'vitest'
import { classifyPeriods, measureEdges, measureWave } from '../src/instruments/measure'
import { fmtBaud, fmtFreq } from '../src/instruments/format'
import { setLang } from '../src/i18n'
import {
  decoderLineOf,
  dutyText,
  isDataChannel,
  serialLineText,
  timingCell,
  usartLineOfPin,
} from '../src/ui/embedded/instruments/signal-readout'
import { ascii, i2cLines, Line, spiLines, uartLine } from './instruments/synth'
import ux2 from '../src/i18n/zh-TW/ux-instruments-2'
import { MAINLAND_TERMS, englishLeft } from './i18n/zh-check'

/** PWM: `n` periods of `period` at duties from `duty(k)` (0 / 1 = no edge that period). */
function pwm(period: number, n: number, duty: (k: number) => number, t0 = 1e-3): Line {
  const l = new Line(0)
  for (let k = 0; k < n; k++) {
    const d = duty(k)
    const a = t0 + k * period
    if (d <= 0) {
      l.set(a, 0)
      continue
    }
    l.set(a, 1)
    if (d < 1) l.set(a + d * period, 0)
  }
  return l
}

describe('IS-11 classifyPeriods / measureEdges', () => {
  it('a steady 1 kHz PWM is periodic: frequency and duty', () => {
    const m = measureEdges(pwm(1e-3, 20, () => 0.34).trace(), 0.5e-3, 20.5e-3)
    expect(m.periodicity).toBe('periodic')
    expect(m.frequency!).toBeCloseTo(1000, 6)
    expect(m.duty!).toBeCloseTo(0.34, 6)
    expect(m.skipped).toBe(false)
  })
  it('a PWM passing 0 % (skipped pulses) still reads the timer frequency, never 990 Hz', () => {
    // pwm-fade at the bottom of its sweep: 10 periods without a pulse
    const tr = pwm(1e-3, 100, (k) => (k >= 40 && k < 50 ? 0 : 0.02 + 0.001 * (k % 10))).trace()
    const m = measureEdges(tr, 0, 0.101)
    expect(m.periodicity).toBe('periodic')
    expect(m.skipped).toBe(true)
    expect(m.frequency!).toBeCloseTo(1000, 3)
    expect(m.duty!).toBeGreaterThan(0)
  })
  it('UART data is aperiodic: no frequency, no duty (the 38.40 kHz of the audit)', () => {
    const { line, end } = uartLine(ascii('Hello from STM32F103!\r\n'), { baud: 115200 })
    const m = measureEdges(line.trace(), 0, end)
    expect(m.periodicity).toBe('aperiodic')
    expect(m.frequency).toBeNull()
    expect(m.period).toBeNull()
    expect(m.duty).toBeNull()
    expect(m.burstClock).toBeNull()
    expect(m.edges).toBeGreaterThan(20)
    // other lines of the examples, with and without idle between the bytes: never a clock
    for (const text of ['tick 1\r\n', 'found 0x3C\r\n', 'scan done 3\r\n', 'I2C1 scan 0x08-0x77\r\n', 'AT+NAME=ohmlet\r\n']) {
      for (const gap of [0, 3e-5]) {
        const u = uartLine(ascii(text), { baud: 115200, gap })
        const k = measureEdges(u.line.trace(), 0, u.end).periodicity
        expect(k, `${JSON.stringify(text)} gap ${gap}`).toBe('aperiodic')
      }
    }
  })
  it('an I²C SCL in bursts reports its in-burst clock (100 kHz) in every window', () => {
    const ops = []
    for (const a of [0x3c, 0x3d, 0x50, 0x51]) ops.push({ op: 'start' as const }, { op: 'byte' as const, value: a << 1, ack: a % 2 === 0 }, { op: 'stop' as const })
    const { scl, end } = i2cLines(ops, 10e-6)
    const tr = scl.trace()
    for (const [a, b] of [
      [0, end], // the whole recording
      [-Infinity, Infinity],
    ]) {
      const m = measureEdges(tr, a, b)
      expect(m.periodicity).toBe('burst')
      expect(m.frequency).toBeNull()
      expect(m.burstClock!).toBeCloseTo(100e3, 0)
    }
  })
  it('one SPI byte with idle around it is a burst, never a 1 MHz "frequency" of the net', () => {
    const { sck } = spiLines([0xa5], [0x3c], { mode: 0, period: 1e-6 }, 50e-6)
    const m = measureEdges(sck.trace(), 0, 200e-6)
    expect(m.periodicity).toBe('burst')
    expect(m.burstClock!).toBeCloseTo(1e6, 0)
  })
  it('the pure classification: unknown with fewer than two reference edges, aperiodic for random intervals', () => {
    expect(classifyPeriods([1], 0, 2, 1, 1).kind).toBe('unknown')
    expect(classifyPeriods([0, 1e-3, 2e-3, 3e-3], 0, 3.2e-3, 0, 3e-3)).toMatchObject({ kind: 'periodic', skipped: false })
    expect(classifyPeriods([0, 1e-3, 3e-3, 4e-3], 0, 4.2e-3, 0, 4e-3)).toMatchObject({ kind: 'periodic', skipped: true })
    expect(classifyPeriods([0, 1e-3, 2.4e-3, 2.9e-3, 4.6e-3], 0, 4.8e-3, 0, 4.6e-3).kind).toBe('aperiodic')
  })
})

describe('IS-11 measureWave: no analog frequency for data', () => {
  it('a UART line sampled at its edges is aperiodic (levels and transitions stay)', () => {
    const { line, end } = uartLine(ascii('tick 42\r\n'), { baud: 9600 })
    const t: number[] = []
    const v: number[] = []
    let lvl = 1
    t.push(0)
    v.push(3.3)
    for (const [te, l] of line.events) {
      t.push(te - 1e-7, te + 1e-7)
      v.push(lvl * 3.3, l === 1 ? 3.3 : 0)
      lvl = l === 1 ? 1 : 0
    }
    t.push(end)
    v.push(3.3)
    const m = measureWave(t, v, 0, end, {})
    expect(m.timing).toBe('aperiodic')
    expect(m.frequency).toBeNull()
    expect(m.duty).toBeNull()
    expect(m.vpp!).toBeCloseTo(3.3, 6)
  })
  it('a well-sampled sine reports how finely its period is resolved', () => {
    const t: number[] = []
    const v: number[] = []
    for (let i = 0; i <= 10000; i++) {
      t.push(i * 1e-5)
      v.push(Math.sin(2 * Math.PI * 50 * i * 1e-5))
    }
    const m = measureWave(t, v)
    expect(m.timing).toBeNull()
    expect(m.frequency!).toBeCloseTo(50, 1)
    expect(m.samplesPerPeriod!).toBeGreaterThan(1500)
  })
})

describe('IS-11 readout texts', () => {
  const usart1 = [{ name: 'USART1', config: { enabled: true, baud: 115107, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const } }]
  it('fmtBaud groups thousands; fmtFreq can quote 3 digits', () => {
    expect(fmtBaud(115200)).toBe('115 200 Bd')
    expect(fmtBaud(9600)).toBe('9600 Bd')
    expect(fmtBaud(1_000_000)).toBe('1 000 000 Bd')
    expect(fmtBaud(NaN)).toBe('—')
    expect(fmtFreq(1010.2, 3)).toBe('1.01 kHz')
    expect(fmtFreq(999.4, 3)).toBe('999 Hz')
    expect(fmtFreq(1010.2)).toBe('1.010 kHz')
  })
  it('a USART pin of an enabled USART is a serial line (TX in AF, RX in an input mode); remaps never count', () => {
    expect(usartLineOfPin(['USART1_TX', 'TIM1_CH2'], 'af', usart1)).toMatchObject({ baud: 115200, frame: '8N1', by: { kind: 'usart', name: 'USART1' } })
    expect(usartLineOfPin(['USART1_RX', 'TIM1_CH3'], 'in↑', usart1)?.by).toEqual({ kind: 'usart', name: 'USART1' })
    expect(usartLineOfPin(['USART1_TX', 'TIM1_CH2'], 'out', usart1)).toBeNull()
    expect(usartLineOfPin(['I2C1_SCL', 'TIM4_CH1', 'USART1_TX (remap)'], 'af-od', usart1)).toBeNull()
    expect(usartLineOfPin(['USART1_TX'], 'af', [])).toBeNull()
  })
  it('a UART decoder gives the line of its channel (configured, or auto-measured)', () => {
    const decs = [{ id: 'uart1', decoder: 'uart', channels: { data: 2 }, options: { baud: '9600', dataBits: '8', parity: 'even', stopBits: '1' } }]
    expect(decoderLineOf(2, decs)).toEqual({ baud: 9600, frame: '8E1', by: { kind: 'decoder' } })
    expect(decoderLineOf(1, decs)).toBeNull()
    expect(isDataChannel(2, decs)).toBe(true)
    expect(isDataChannel(0, [{ decoder: 'i2c', channels: { scl: 0, sda: 1 } }])).toBe(false)
    expect(isDataChannel(1, [{ decoder: 'i2c', channels: { scl: 0, sda: 1 } }])).toBe(true)
  })
  it('zh-TW: the baud line, the burst clock, 非週期訊號 — never a frequency for data', () => {
    setLang('zh-TW')
    const line = usartLineOfPin(['USART1_TX'], 'af', usart1)!
    expect(serialLineText(line)).toBe('115 200 Bd · 8N1（由 USART1 設定）')
    const cellLine = timingCell({ frequency: 38400, periodicity: 'periodic', burstClock: null, skipped: false }, line)
    expect(cellLine).toMatchObject({ kind: 'line', label: '鮑率', value: '115 200 Bd · 8N1（由 USART1 設定）', periodic: false })
    expect(dutyText({ duty: 0.999 }, cellLine)).toBe('—')
    expect(timingCell({ frequency: null, periodicity: 'burst', burstClock: 99250, skipped: false }, null)).toMatchObject({
      kind: 'burst',
      label: '時脈',
      value: '99.25 kHz（突發）',
    })
    expect(timingCell({ frequency: null, periodicity: 'aperiodic', burstClock: null, skipped: false }, null).value).toBe('—（非週期訊號）')
    expect(timingCell({ frequency: null, periodicity: 'aperiodic', burstClock: null, skipped: false }, null, true).value).toBe('—（非週期訊號：序列資料）')
    const f = timingCell({ frequency: 1000, periodicity: 'periodic', burstClock: null, skipped: false }, null)
    expect(f).toMatchObject({ kind: 'freq', label: '頻率', value: '1.000 kHz', periodic: true })
    expect(dutyText({ duty: 0.34 }, f)).toBe('34.0 %')
    setLang('en')
    expect(serialLineText(line)).toBe('115 200 Bd · 8N1 (set by USART1)')
    setLang('zh-TW')
  })
})

describe('ux-instruments-2 dictionary: Taiwan Chinese, no English left', () => {
  it('every entry is translated, uses Taiwan terms (工作週期, never 佔空比) and keeps its placeholders', () => {
    for (const [en, zh] of Object.entries(ux2)) {
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${en} → ${zh} uses ${term}`).toBe(false)
      expect(zh.includes('佔空比'), `${en} → ${zh}`).toBe(false)
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' '), ['Alt', 'Esc', 'Shift', 'UART', 'Bd']), `${en} → ${zh}`).toEqual([])
      const ph = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort()
      expect(ph(zh), `${en} → ${zh}`).toEqual(ph(en.replace(/\|[a-z0-9-]+$/, '')))
    }
  })
})
