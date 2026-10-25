/**
 * Synthetic logic waveforms for the decoder tests — built from the
 * protocol definitions (independently of the decoders), as edge lists in
 * the LogicTrace format the simulation host returns.
 */
import type { LogicCapture, LogicTrace } from '../../src/sim/coordinator/api'

export type Lvl = 0 | 1 | 2

/** One line: a level timeline. `set` at increasing times; equal levels are merged. */
export class Line {
  readonly events: [number, Lvl][] = []
  constructor(readonly initial: Lvl) {}
  private last(): Lvl {
    return this.events.length ? this.events[this.events.length - 1][1] : this.initial
  }
  set(t: number, level: Lvl): this {
    const prev = this.events.length ? this.events[this.events.length - 1][0] : -Infinity
    if (t < prev) throw new Error(`time goes backwards: ${t} < ${prev}`)
    if (level === this.last()) return this
    // a change at the same instant replaces the previous one
    if (t === prev) {
      this.events.pop()
      if (level === this.last()) return this
    }
    this.events.push([t, level])
    return this
  }
  level(): Lvl {
    return this.last()
  }
  trace(index = 0, label = `D${index}`, exact = true): LogicTrace {
    return {
      index,
      label,
      initial: this.initial,
      times: Float64Array.from(this.events.map((e) => e[0])),
      levels: Uint8Array.from(this.events.map((e) => e[1])),
      exact,
    }
  }
}

export function capture(t0: number, t1: number, traces: LogicTrace[]): LogicCapture {
  return { t0, t1, traces, overflow: false }
}

// ------------------------------------------------------------------ UART

export interface UartWaveOptions {
  baud: number
  dataBits?: number
  parity?: 'none' | 'even' | 'odd'
  stopBits?: number
  inverted?: boolean
  msbFirst?: boolean
  /** idle time before the first frame (s) */
  lead?: number
  /** idle time between frames (s) */
  gap?: number
  /** per-frame overrides for error injection */
  corrupt?: (index: number) => { flipParity?: boolean; lowStop?: boolean } | undefined
}

/** A UART line sending `bytes`; returns the line and the end time. */
export function uartLine(bytes: number[], o: UartWaveOptions): { line: Line; end: number; starts: number[] } {
  const T = 1 / o.baud
  const n = o.dataBits ?? 8
  const stop = o.stopBits ?? 1
  const inv = o.inverted === true
  const L = (l: 0 | 1): Lvl => (inv ? ((1 - l) as 0 | 1) : l)
  const line = new Line(L(1))
  let t = o.lead ?? 10 * T
  const starts: number[] = []
  bytes.forEach((b, idx) => {
    const c = o.corrupt?.(idx)
    starts.push(t)
    line.set(t, L(0))
    t += T
    let ones = 0
    for (let k = 0; k < n; k++) {
      const bit = ((o.msbFirst ? b >> (n - 1 - k) : b >> k) & 1) as 0 | 1
      ones += bit
      line.set(t, L(bit))
      t += T
    }
    if ((o.parity ?? 'none') !== 'none') {
      let p = (o.parity === 'even' ? ones & 1 : (ones + 1) & 1) as 0 | 1
      if (c?.flipParity) p = (1 - p) as 0 | 1
      line.set(t, L(p))
      t += T
    }
    line.set(t, L(c?.lowStop ? 0 : 1))
    t += stop * T
    line.set(t, L(1))
    t += o.gap ?? 0
  })
  return { line, end: t + 10 * T, starts }
}

export function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0))
}

// ------------------------------------------------------------------- I²C

export type I2cOp =
  | { op: 'start' }
  | { op: 'stop' }
  | { op: 'byte'; value: number; ack: boolean }
  | { op: 'bits'; values: (0 | 1)[] } // a partial byte (error injection)
  | { op: 'stretch'; time: number } // hold SCL low longer before the next bit

/**
 * I²C bus (SCL + SDA, idle high). One bit = 4 quarter periods: SDA set
 * while SCL is low, SCL high for half a period.
 */
export function i2cLines(ops: I2cOp[], period = 10e-6, t0 = 20e-6): { scl: Line; sda: Line; end: number } {
  const scl = new Line(1)
  const sda = new Line(1)
  const q = period / 4
  let t = t0
  let stretch = 0
  const bit = (v: 0 | 1) => {
    // SCL is low here
    sda.set(t, v)
    t += q + stretch
    stretch = 0
    scl.set(t, 1)
    t += 2 * q
    scl.set(t, 0)
    t += q
  }
  for (const o of ops) {
    if (o.op === 'start') {
      if (scl.level() === 0) {
        // repeated START: release SDA, raise SCL, then pull SDA low
        sda.set(t, 1)
        t += q
        scl.set(t, 1)
        t += q
      }
      sda.set(t, 0)
      t += q
      scl.set(t, 0)
      t += q
    } else if (o.op === 'stop') {
      sda.set(t, 0)
      t += q
      scl.set(t, 1)
      t += q
      sda.set(t, 1)
      t += 2 * q
    } else if (o.op === 'byte') {
      for (let k = 7; k >= 0; k--) bit(((o.value >> k) & 1) as 0 | 1)
      bit(o.ack ? 0 : 1)
    } else if (o.op === 'bits') {
      for (const v of o.values) bit(v)
    } else {
      stretch = o.time
    }
  }
  return { scl, sda, end: t + period }
}

// ------------------------------------------------------------------- SPI

export interface SpiWaveOptions {
  mode: 0 | 1 | 2 | 3
  lsbFirst?: boolean
  bits?: number
  period?: number
  /** CS polarity (default active low); null = no CS line */
  cs?: 'low' | 'high' | null
  /** stop after this many bits of the last word (error injection) */
  truncateLastTo?: number
  /** SCK level while CS is inactive (default: CPOL) */
  idleSck?: 0 | 1
}

/** One CS-framed transfer of `mosi` / `miso` words (equal length). */
export function spiLines(
  mosiWords: number[],
  misoWords: number[],
  o: SpiWaveOptions,
  t0 = 20e-6,
): { sck: Line; mosi: Line; miso: Line; cs: Line | null; end: number } {
  const cpol = (o.mode >> 1) as 0 | 1
  const cpha = (o.mode & 1) as 0 | 1
  const n = o.bits ?? 8
  const P = o.period ?? 1e-6
  const h = P / 2
  const idle = o.idleSck ?? cpol
  const sck = new Line(idle)
  const mosi = new Line(1)
  const miso = new Line(1)
  const csPol = o.cs === undefined ? 'low' : o.cs
  const cs = csPol === null ? null : new Line(csPol === 'low' ? 1 : 0)
  let t = t0
  if (cs) cs.set(t, csPol === 'low' ? 0 : 1)
  t += h
  if (idle !== cpol) sck.set(t - h / 2, cpol)
  const bitOf = (w: number, k: number) => ((o.lsbFirst ? w >> k : w >> (n - 1 - k)) & 1) as 0 | 1
  for (let wi = 0; wi < mosiWords.length; wi++) {
    const count = wi === mosiWords.length - 1 && o.truncateLastTo !== undefined ? o.truncateLastTo : n
    for (let k = 0; k < count; k++) {
      const set = () => {
        mosi.set(t, bitOf(mosiWords[wi], k))
        miso.set(t, bitOf(misoWords[wi] ?? 0, k))
      }
      if (cpha === 0) {
        // data valid before the leading edge
        set()
        t += h / 2
        sck.set(t, (1 - cpol) as 0 | 1) // leading = sample
        t += h
        sck.set(t, cpol) // trailing = shift
        t += h / 2
      } else {
        sck.set(t, (1 - cpol) as 0 | 1) // leading = shift
        set()
        t += h
        sck.set(t, cpol) // trailing = sample
        t += h
      }
    }
  }
  t += h
  if (cs) cs.set(t, csPol === 'low' ? 1 : 0)
  return { sck, mosi, miso, cs, end: t + P }
}

// ---------------------------------------------------------------- 1-Wire

export type OneWireOp =
  | { op: 'reset'; presence: boolean }
  | { op: 'write'; value: number } // a byte, LSB first
  | { op: 'read'; value: number } // a byte the slave answers, LSB first
  | { op: 'low'; time: number } // an arbitrary low pulse (error injection)

/** 1-Wire line with standard (or overdrive ÷10) timing per AN126. */
export function oneWireLine(ops: OneWireOp[], overdrive = false, t0 = 50e-6): { line: Line; end: number } {
  const k = overdrive ? 0.1 : 1
  const line = new Line(1)
  let t = t0
  const slot = (lowTime: number, total: number) => {
    line.set(t, 0)
    line.set(t + lowTime, 1)
    t += total
  }
  for (const o of ops) {
    if (o.op === 'reset') {
      line.set(t, 0)
      t += 500e-6 * k
      line.set(t, 1)
      if (o.presence) {
        line.set(t + 30e-6 * k, 0)
        line.set(t + 150e-6 * k, 1)
      }
      t += 480e-6 * k
    } else if (o.op === 'write') {
      for (let b = 0; b < 8; b++) {
        const one = ((o.value >> b) & 1) === 1
        slot((one ? 6e-6 : 60e-6) * k, 70e-6 * k)
      }
    } else if (o.op === 'read') {
      for (let b = 0; b < 8; b++) {
        const one = ((o.value >> b) & 1) === 1
        // master 6 µs low; a 0 is stretched by the slave to 30 µs
        slot((one ? 6e-6 : 30e-6) * k, 70e-6 * k)
      }
    } else {
      slot(o.time, o.time + 60e-6 * k)
    }
  }
  return { line, end: t + 100e-6 * k }
}
