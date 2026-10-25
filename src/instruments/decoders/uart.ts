/**
 * Asynchronous serial (UART) decoder — one line per decoder instance.
 *
 * Frame (RM0008 §27.3.2, Figure 278): idle high, start bit (low), 5–9 data
 * bits LSB first (MSB first optional), optional parity bit (even: the data
 * bits plus the parity bit hold an even number of 1s; odd: odd), 1 / 1.5 /
 * 2 stop bits (high). An inverted line (idle low, e.g. after an RS-232
 * transceiver) is decoded as its complement.
 *
 * Sampling: like a receiver, a 1→0 transition (idle → start) starts a frame
 * and every bit is sampled ONCE at its centre, start + (k + ½)·T with
 * T = 1/baud (a hardware USART takes the majority of three samples around
 * the centre, RM0008 §27.3.5 — on an ideal simulated edge list the centre
 * sample is the same value). The start bit must still be low at its centre
 * (otherwise: a glitch, skipped). Each stop bit is sampled at its centre
 * (for 1.5 stop bits only the first one); a low stop bit is a framing
 * error, all-zero data + parity + stop is a BREAK. The next start bit is
 * searched after the last stop-bit sample point. Frames that the capture
 * window cuts off are not decoded; a sample point at an undefined level
 * (floating / contention) is reported as an error.
 *
 * Auto-baud: the bit time is estimated from the pulse widths between
 * edges — the shortest pulse that most other pulses are integer multiples
 * of (±20 %), refined as Σwidth / Σmultiple over all consistent pulses —
 * and snapped to a standard rate within 2 %. It needs at least one
 * single-bit pulse in the window (true for almost any text).
 */
import type { LogicTrace } from '../../sim/coordinator/api'
import { fmtHexShort, fmtWord } from '../format'
import { Signal } from '../signal'
import type { Annotation, DecodeResult, DecoderRow } from '../types'

export type UartParity = 'none' | 'even' | 'odd'

export interface UartOptions {
  /** bits per second, or 'auto' (estimated from the shortest pulse) */
  baud: number | 'auto'
  /** 5–9 (default 8) */
  dataBits?: number
  parity?: UartParity
  /** 1, 1.5 or 2 (default 1) */
  stopBits?: number
  /** idle-low line (default false: idle high) */
  inverted?: boolean
  /** default 'lsb' (every standard UART) */
  bitOrder?: 'lsb' | 'msb'
}

export interface UartFrame {
  t0: number
  t1: number
  value: number
  /** null without parity */
  parityOk: boolean | null
  framingOk: boolean
  isBreak: boolean
}

export interface UartResult extends DecodeResult {
  /** the baud rate used (null: auto-baud found no pulses) */
  baud: number | null
  frames: UartFrame[]
}

/** Common rates the auto-baud estimate snaps to (within 2 %). */
export const STANDARD_BAUDS = [
  110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 31250, 38400, 56000, 57600, 74880, 76800, 115200,
  128000, 153600, 230400, 250000, 256000, 460800, 500000, 576000, 921600, 1000000, 1152000, 1500000, 2000000,
  2500000, 3000000, 4000000, 4500000,
] as const

export const UART_ROWS: DecoderRow[] = [{ id: 'data', label: 'UART', role: 'data' }]

export interface BaudEstimate {
  /** snapped standard rate (or the rounded measurement when none is near) */
  baud: number
  /** 1 / refined bit time */
  measured: number
  /** pulses consistent with the bit time / all complete pulses */
  support: number
}

/**
 * Estimate the baud rate from the complete pulses (edge to edge, both
 * levels defined) of `trace`. Null when there are fewer than two edges.
 */
export function estimateBaud(trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>): BaudEstimate | null {
  const sig = new Signal(trace)
  const widths: number[] = []
  for (let i = 1; i < sig.count; i++) {
    if (sig.before(i) === 2 || sig.after(i - 1) === 2) continue
    const w = sig.times[i] - sig.times[i - 1]
    if (w > 0) widths.push(w)
  }
  if (widths.length === 0) return null
  const sorted = widths.slice().sort((a, b) => a - b)
  const fit = (T: number) => {
    let sumW = 0
    let sumN = 0
    let ok = 0
    for (const w of widths) {
      const n = Math.round(w / T)
      if (n < 1 || n > 16) continue
      if (Math.abs(w - n * T) > 0.2 * T) continue
      sumW += w
      sumN += n
      ok++
    }
    return { T: sumN > 0 ? sumW / sumN : T, ok }
  }
  // candidate bit times: distinct pulse-width clusters, shortest first; the
  // first one that explains most pulses wins (a lone glitch does not)
  let best: { T: number; ok: number } | null = null
  let prev = -Infinity
  for (const w of sorted) {
    if (w < prev * 1.2) continue
    prev = w
    let f = fit(w)
    f = fit(f.T)
    if (!best || f.ok > best.ok) best = f
    if (f.ok >= widths.length * 0.6) {
      best = f
      break
    }
    if (w > sorted[0] * 16) break
  }
  if (!best) return null
  const measured = 1 / best.T
  let baud = Math.round(measured)
  for (const s of STANDARD_BAUDS) {
    if (Math.abs(measured - s) / s <= 0.02) {
      baud = s
      break
    }
  }
  return { baud, measured, support: best.ok / widths.length }
}

function parityBit(value: number, bits: number): number {
  let ones = 0
  for (let i = 0; i < bits; i++) ones += (value >> i) & 1
  return ones & 1
}

/**
 * Decode one UART line. `t1` is the end of the captured window (frames
 * that do not end before it are skipped); it defaults to the last edge.
 */
export function decodeUart(trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>, opts: UartOptions, t1?: number): UartResult {
  const dataBits = Math.min(9, Math.max(5, Math.round(opts.dataBits ?? 8)))
  const parity: UartParity = opts.parity ?? 'none'
  const stopBits = opts.stopBits === 1.5 || opts.stopBits === 2 ? opts.stopBits : 1
  const msbFirst = opts.bitOrder === 'msb'
  const info: string[] = []
  const annotations: Annotation[] = []
  const frames: UartFrame[] = []

  let baud: number | null = null
  if (opts.baud === 'auto') {
    const est = estimateBaud(trace)
    if (est) {
      baud = est.baud
      const m = Math.round(est.measured)
      info.push(m === est.baud ? `auto: ${est.baud} Bd` : `auto: ${est.baud} Bd (measured ${m} Bd)`)
    } else {
      info.push('auto-baud: no complete pulses in the window')
    }
  } else if (Number.isFinite(opts.baud) && opts.baud > 0) {
    baud = opts.baud
  }
  if (baud === null) return { rows: UART_ROWS, annotations, info, baud, frames }

  const sig = new Signal(trace, opts.inverted === true)
  const end = t1 ?? (sig.count > 0 ? sig.times[sig.count - 1] : 0)
  const T = 1 / baud
  const pBits = parity === 'none' ? 0 : 1
  const firstStop = 1 + dataBits + pBits // bit index of the first stop bit
  const lastSampleIdx = stopBits === 2 ? firstStop + 1 : firstStop
  const frameBits = 1 + dataBits + pBits + stopBits

  let searchFrom = -Infinity
  for (let i = 0; i < sig.count; i++) {
    const ts = sig.times[i]
    if (ts <= searchFrom) continue
    if (sig.after(i) !== 0 || sig.before(i) !== 1) continue // idle (1) → start (0) only
    const sampleAt = (k: number) => ts + (k + 0.5) * T
    const tEnd = ts + frameBits * T
    if (sampleAt(lastSampleIdx) > end) break // cut off by the window
    if (sig.at(sampleAt(0)) !== 0) {
      // the line rose again before the start bit's centre: a glitch
      searchFrom = sampleAt(0)
      continue
    }
    let undefinedAt = -1
    let value = 0
    for (let b = 0; b < dataBits; b++) {
      const l = sig.at(sampleAt(1 + b))
      if (l === 2) {
        undefinedAt = 1 + b
        break
      }
      if (l === 1) value |= msbFirst ? 1 << (dataBits - 1 - b) : 1 << b
    }
    let pBit = 0
    if (undefinedAt < 0 && pBits) {
      const l = sig.at(sampleAt(1 + dataBits))
      if (l === 2) undefinedAt = 1 + dataBits
      else pBit = l
    }
    let stopOk = true
    if (undefinedAt < 0) {
      for (let k = firstStop; k <= lastSampleIdx; k++) {
        const l = sig.at(sampleAt(k))
        if (l === 2) {
          undefinedAt = k
          break
        }
        if (l === 0) stopOk = false
      }
    }
    searchFrom = sampleAt(lastSampleIdx)
    if (undefinedAt >= 0) {
      annotations.push({
        t0: ts,
        t1: tEnd,
        row: 'data',
        text: 'undefined level',
        short: '?',
        kind: 'error',
      })
      continue
    }
    const parityOk =
      parity === 'none' ? null : (parityBit(value, dataBits) ^ pBit) === (parity === 'even' ? 0 : 1)
    const isBreak = value === 0 && pBit === 0 && !stopOk
    frames.push({ t0: ts, t1: tEnd, value, parityOk, framingOk: stopOk, isBreak })
    if (isBreak) {
      annotations.push({ t0: ts, t1: tEnd, row: 'data', text: 'BREAK', short: 'BRK', kind: 'ctrl' })
      continue
    }
    const errors: string[] = []
    if (parityOk === false) errors.push('parity error')
    if (!stopOk) errors.push('framing error')
    const word = fmtWord(value, dataBits)
    annotations.push({
      t0: ts,
      t1: tEnd,
      row: 'data',
      text: errors.length ? `${word} ${errors.join(', ')}` : word,
      short: errors.length ? `${fmtHexShort(value, dataBits)}!` : fmtHexShort(value, dataBits),
      kind: errors.length ? 'error' : 'data',
      value,
    })
  }
  return { rows: UART_ROWS, annotations, info, baud, frames }
}
