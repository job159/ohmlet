/**
 * UART decoder on synthetic lines (tests/instruments/synth.ts builds the
 * frames from the frame definition, independently of the decoder).
 */
import { describe, expect, it } from 'vitest'
import { decodeUart, estimateBaud } from '../../src/instruments/decoders/uart'
import { ascii, Line, uartLine } from './synth'

describe('UART decoder', () => {
  it('decodes 8N1 at a configured baud with hex + ASCII annotations', () => {
    const bytes = ascii('Hi,\r\n')
    const { line, end, starts } = uartLine(bytes, { baud: 115200 })
    const r = decodeUart(line.trace(), { baud: 115200 }, end)
    expect(r.frames.map((f) => f.value)).toEqual(bytes)
    expect(r.annotations.map((a) => a.text)).toEqual(["0x48 'H'", "0x69 'i'", "0x2C ','", '0x0D \\r', '0x0A \\n'])
    expect(r.annotations.map((a) => a.short)).toEqual(['48', '69', '2C', '0D', '0A'])
    expect(r.annotations.every((a) => a.kind === 'data' && a.row === 'data')).toBe(true)
    // spans: start-bit edge → end of the stop bit (10 bit times)
    const T = 1 / 115200
    r.frames.forEach((f, i) => {
      expect(f.t0).toBeCloseTo(starts[i], 12)
      expect(f.t1 - f.t0).toBeCloseTo(10 * T, 12)
      expect(f.parityOk).toBeNull()
      expect(f.framingOk).toBe(true)
    })
  })

  it('auto-detects the baud from the shortest pulse and snaps to a standard rate', () => {
    for (const baud of [1200, 9600, 57600, 115200, 921600]) {
      const { line, end } = uartLine(ascii('U*hello'), { baud })
      const est = estimateBaud(line.trace())
      expect(est?.baud, `${baud}`).toBe(baud)
      const r = decodeUart(line.trace(), { baud: 'auto' }, end)
      expect(r.baud).toBe(baud)
      expect(r.info[0]).toBe(`auto: ${baud} Bd`)
      expect(String.fromCharCode(...r.frames.map((f) => f.value))).toBe('U*hello')
    }
  })

  it('auto-baud reports an off-standard rate as measured (no snapping beyond 2 %)', () => {
    const { line, end } = uartLine(ascii('abc'), { baud: 100000 })
    const r = decodeUart(line.trace(), { baud: 'auto' }, end)
    expect(r.baud).toBe(100000)
    expect(r.frames.map((f) => f.value)).toEqual(ascii('abc'))
    // a 1.5 % fast clock still snaps to 115200 and decodes
    const fast = uartLine(ascii('abc'), { baud: 115200 * 1.015 })
    const rf = decodeUart(fast.line.trace(), { baud: 'auto' }, fast.end)
    expect(rf.baud).toBe(115200)
    expect(rf.info[0]).toMatch(/^auto: 115200 Bd \(measured 1169\d\d Bd\)$/)
    expect(rf.frames.map((f) => f.value)).toEqual(ascii('abc'))
  })

  it('auto-baud is not fooled by one short glitch', () => {
    const { line } = uartLine(ascii('The quick brown fox'), { baud: 9600, lead: 2e-3 })
    // a 2 µs glitch in the leading idle time
    const glitched = new Line(1).set(1e-3, 0).set(1e-3 + 2e-6, 1)
    for (const [t, l] of line.events) glitched.set(t, l)
    expect(estimateBaud(glitched.trace())?.baud).toBe(9600)
  })

  it('auto-baud without complete pulses reports it', () => {
    const r = decodeUart(new Line(1).trace(), { baud: 'auto' }, 1)
    expect(r.baud).toBeNull()
    expect(r.annotations).toEqual([])
    expect(r.info[0]).toMatch(/no complete pulses/)
  })

  it('supports 5–9 data bits, even/odd parity and 1 / 1.5 / 2 stop bits', () => {
    const cases = [
      { dataBits: 7, parity: 'even' as const, stopBits: 1, bytes: [0x41, 0x7f, 0x00, 0x55] },
      { dataBits: 8, parity: 'odd' as const, stopBits: 2, bytes: [0xff, 0x00, 0xa5, 0x5a] },
      { dataBits: 9, parity: 'none' as const, stopBits: 1, bytes: [0x1ff, 0x100, 0x0a5] },
      { dataBits: 5, parity: 'none' as const, stopBits: 1.5, bytes: [0x1f, 0x00, 0x15] },
      { dataBits: 6, parity: 'odd' as const, stopBits: 1, bytes: [0x3f, 0x01] },
    ]
    for (const c of cases) {
      const { line, end } = uartLine(c.bytes, { baud: 19200, ...c })
      const r = decodeUart(line.trace(), { baud: 19200, ...c }, end)
      expect(r.frames.map((f) => f.value), JSON.stringify(c)).toEqual(c.bytes)
      expect(r.frames.every((f) => f.framingOk && f.parityOk !== false)).toBe(true)
      if (c.parity !== 'none') expect(r.frames.every((f) => f.parityOk === true)).toBe(true)
      expect(r.annotations.every((a) => a.kind === 'data')).toBe(true)
    }
    // a 9-bit word is shown as 3 hex digits without ASCII
    const nine = uartLine([0x1a5], { baud: 9600, dataBits: 9 })
    expect(decodeUart(nine.line.trace(), { baud: 9600, dataBits: 9 }, nine.end).annotations[0].text).toBe('0x1A5')
  })

  it('annotates parity and framing errors', () => {
    const bytes = ascii('ABCD')
    const { line, end } = uartLine(bytes, {
      baud: 9600,
      parity: 'even',
      corrupt: (i) => (i === 1 ? { flipParity: true } : i === 2 ? { lowStop: true } : undefined),
      gap: 3 / 9600,
    })
    const r = decodeUart(line.trace(), { baud: 9600, parity: 'even' }, end)
    expect(r.frames.map((f) => f.value)).toEqual(bytes)
    expect(r.frames.map((f) => f.parityOk)).toEqual([true, false, true, true])
    expect(r.frames.map((f) => f.framingOk)).toEqual([true, true, false, true])
    expect(r.annotations.map((a) => [a.kind, a.text])).toEqual([
      ['data', "0x41 'A'"],
      ['error', "0x42 'B' parity error"],
      ['error', "0x43 'C' framing error"],
      ['data', "0x44 'D'"],
    ])
    expect(r.annotations[1].short).toBe('42!')
  })

  it('reports a BREAK (all-zero frame with a low stop bit)', () => {
    const T = 1 / 9600
    const line = new Line(1).set(1e-3, 0).set(1e-3 + 12 * T, 1)
    const r = decodeUart(line.trace(), { baud: 9600 }, 1e-3 + 20 * T)
    expect(r.frames).toHaveLength(1)
    expect(r.frames[0].isBreak).toBe(true)
    expect(r.annotations[0]).toMatchObject({ text: 'BREAK', kind: 'ctrl' })
  })

  it('decodes an inverted (idle-low) line and MSB-first frames', () => {
    const inv = uartLine(ascii('OK'), { baud: 38400, inverted: true })
    expect(inv.line.initial).toBe(0)
    const r = decodeUart(inv.line.trace(), { baud: 38400, inverted: true }, inv.end)
    expect(r.frames.map((f) => f.value)).toEqual(ascii('OK'))
    // the same line read as idle-high is garbage, not success
    const wrong = decodeUart(inv.line.trace(), { baud: 38400 }, inv.end)
    expect(wrong.frames.map((f) => f.value)).not.toEqual(ascii('OK'))

    const msb = uartLine([0x01, 0x80], { baud: 38400, msbFirst: true })
    expect(decodeUart(msb.line.trace(), { baud: 38400, bitOrder: 'msb' }, msb.end).frames.map((f) => f.value)).toEqual([
      0x01, 0x80,
    ])
  })

  it('skips frames cut off by the end of the capture window', () => {
    const { line, starts } = uartLine(ascii('xyz'), { baud: 9600 })
    const T = 1 / 9600
    // window ends in the middle of the third frame
    const r = decodeUart(line.trace(), { baud: 9600 }, starts[2] + 5 * T)
    expect(r.frames.map((f) => f.value)).toEqual(ascii('xy'))
  })

  it('skips a start-bit glitch and reports undefined levels as errors', () => {
    const T = 1 / 9600
    const g = new Line(1).set(1e-3, 0).set(1e-3 + 0.2 * T, 1)
    const r = decodeUart(g.trace(), { baud: 9600 }, 1e-3 + 30 * T)
    expect(r.frames).toEqual([])
    expect(r.annotations).toEqual([])

    const u = new Line(1).set(1e-3, 0).set(1e-3 + 3 * T, 2).set(1e-3 + 12 * T, 1)
    const ru = decodeUart(u.trace(), { baud: 9600 }, 1e-3 + 30 * T)
    expect(ru.frames).toEqual([])
    expect(ru.annotations).toEqual([
      expect.objectContaining({ kind: 'error', text: 'undefined level', t0: 1e-3 }),
    ])
  })

  it('decodes back-to-back frames without idle time', () => {
    const bytes = [0x00, 0xff, 0x00, 0x55, 0xaa]
    const { line, end } = uartLine(bytes, { baud: 2_000_000, gap: 0 })
    expect(decodeUart(line.trace(), { baud: 'auto' }, end).frames.map((f) => f.value)).toEqual(bytes)
  })
})
