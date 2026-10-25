/**
 * Bit-level asynchronous serial (UART) engines for the communication
 * modules (comm.model.ts): a receiver that decodes frames from the edges on
 * one pin and a transmitter that shifts frames out on one pin, both in
 * virtual time at the MODULE's own baud rate — so a baud, parity or
 * stop-bit mismatch between a module and an MCU produces exactly the
 * garbage / framing errors a real adapter shows.
 *
 * Receiver (the classic 16× UART reduced to its decision points, cf. RM0008
 * §27.3.3): a falling edge on an idle line starts a frame; the start bit is
 * re-checked at its middle (a glitch shorter than half a bit is a false
 * start); every later bit is the line level at the middle of its bit cell,
 * taken from the edge history of the frame (the line is piecewise constant
 * between edges, so this equals sampling it then); the frame ends at the
 * middle of the first stop bit — a low stop bit is a framing error (a break
 * when the whole frame was low) and the receiver then waits for the line to
 * go high before it accepts a new start bit. Two scheduled events per frame.
 *
 * Transmitter: start bit (0), data LSB first, optional parity, stop bit(s)
 * (1); one scheduled event per level change. The line idles high.
 */
import type { DigitalDeviceCtx, LogicLevel } from '../digital/api'

export type UartParity = 'none' | 'even' | 'odd'

export interface UartFrameFormat {
  baud: number
  /** 5 … 9 data bits */
  dataBits: number
  parity: UartParity
  stopBits: 1 | 2
}

export interface UartRxFrame {
  /** data bits (LSB first on the wire) */
  byte: number
  framingError: boolean
  parityError: boolean
  /** a break: the whole frame (stop bit included) sampled low */
  isBreak: boolean
  /** virtual time the frame was decoded (middle of the stop bit), s */
  t: number
}

/** Parity bit for `byte` (dataBits wide) — even: makes the 1-count even. */
export function parityBit(byte: number, dataBits: number, parity: UartParity): 0 | 1 {
  let ones = 0
  for (let i = 0; i < dataBits; i++) ones += (byte >>> i) & 1
  if (parity === 'even') return (ones & 1) as 0 | 1
  return ((ones & 1) ^ 1) as 0 | 1
}

/** Parse a catalog baud param ('115200', 9600 …) — NaN when unusable. */
export function baudOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) && n >= 50 && n <= 5e6 ? n : NaN
}

export class UartReceiver {
  private state: 'idle' | 'frame' | 'waitHigh' = 'idle'
  private level: 0 | 1 = 1
  private t0 = 0
  private bitT = 0
  private edges: { t: number; l: 0 | 1 }[] = []
  private hStart = 0
  private hEnd = 0
  private fmtFrame: UartFrameFormat | null = null

  constructor(
    private readonly ctx: DigitalDeviceCtx,
    private readonly fmt: () => UartFrameFormat,
    private readonly onFrame: (f: UartRxFrame) => void,
  ) {}

  /** Line low (a frame / break in progress) — for activity LEDs. */
  get active(): boolean {
    return this.state === 'frame' || this.level === 0
  }

  /** Forget any frame in progress; `level` is the present line level. */
  reset(level: LogicLevel): void {
    this.cancel()
    this.level = level === 0 ? 0 : 1
    this.state = this.level === 0 ? 'waitHigh' : 'idle'
    this.edges = []
  }

  cancel(): void {
    if (this.hStart) this.ctx.cancel(this.hStart)
    if (this.hEnd) this.ctx.cancel(this.hEnd)
    this.hStart = this.hEnd = 0
    this.fmtFrame = null
  }

  /** Feed a resolved line level (null = floating: keeps the last level). */
  edge(level: LogicLevel): void {
    if (level === null) return
    if (level === this.level) return
    this.level = level
    const t = this.ctx.now()
    switch (this.state) {
      case 'idle':
        if (level === 0) this.startFrame(t)
        return
      case 'frame':
        this.edges.push({ t, l: level })
        return
      case 'waitHigh':
        if (level === 1) this.state = 'idle'
        return
    }
  }

  /** A start bit began at `t` (≤ now): validate it at its middle, then decode the frame. */
  private startFrame(t: number): void {
    const f = this.fmt()
    if (!(f.baud > 0)) return
    this.fmtFrame = f
    this.state = 'frame'
    this.t0 = t
    this.bitT = 1 / f.baud
    this.edges = [{ t, l: 0 }]
    this.hStart = this.ctx.schedule(Math.max(0, t + this.bitT / 2 - this.ctx.now()), () => {
      this.hStart = 0
      if (this.levelAt(this.t0 + this.bitT / 2) !== 0) {
        // glitch shorter than half a bit: false start — a later falling edge may be a real one
        const rest = this.edges.filter((e) => e.t > this.t0 + this.bitT / 2)
        const prior = this.edges.filter((e) => e.t > this.t0 && e.t <= this.t0 + this.bitT / 2)
        const lastFall = [...prior].reverse().find((e) => e.l === 0)
        this.state = 'idle'
        this.fmtFrame = null
        this.edges = []
        if (this.level === 0 && lastFall && rest.length === 0) this.startFrame(lastFall.t)
        else if (this.level === 0) this.state = 'waitHigh'
        return
      }
      const p = f.parity === 'none' ? 0 : 1
      this.hEnd = this.ctx.schedule((1 + f.dataBits + p) * this.bitT, () => {
        this.hEnd = 0
        this.endFrame()
      })
    })
  }

  private levelAt(t: number): 0 | 1 {
    let l: 0 | 1 = 1
    for (const e of this.edges) {
      if (e.t <= t + 1e-15) l = e.l
      else break
    }
    return l
  }

  private endFrame(): void {
    const f = this.fmtFrame
    this.fmtFrame = null
    if (!f) return
    const T = this.bitT
    const mid = (k: number) => this.t0 + (k + 0.5) * T
    let byte = 0
    let zeros = 0
    for (let i = 0; i < f.dataBits; i++) {
      const b = this.levelAt(mid(1 + i))
      byte |= b << i
      if (!b) zeros++
    }
    let parityError = false
    let k = 1 + f.dataBits
    if (f.parity !== 'none') {
      const pb = this.levelAt(mid(k))
      if (!pb) zeros++
      parityError = pb !== parityBit(byte, f.dataBits, f.parity)
      k++
    }
    const stop = this.levelAt(mid(k))
    const framingError = stop === 0
    const isBreak = framingError && byte === 0 && zeros === f.dataBits + (f.parity === 'none' ? 0 : 1)
    this.edges = []
    this.state = this.level === 0 ? 'waitHigh' : 'idle'
    this.onFrame({ byte, framingError, parityError, isBreak, t: this.ctx.now() })
  }
}

export class UartTransmitter {
  private queue: number[] = []
  private levels: (0 | 1)[] = []
  private idx = 0
  private byte = 0
  private handle = 0
  private sending = false
  private bitT = 0

  constructor(
    private readonly ctx: DigitalDeviceCtx,
    private readonly fmt: () => UartFrameFormat,
    private readonly drive: (level: 0 | 1) => void,
    /** a frame's stop bit(s) completed */
    private readonly onSent?: (byte: number, t: number) => void,
  ) {}

  /** A frame is on the line (start bit … stop bits) — for activity LEDs. */
  get busy(): boolean {
    return this.sending
  }

  /** The line is low right now. */
  get low(): boolean {
    return this.sending && this.levels[this.idx - 1] === 0
  }

  get pending(): number {
    return this.queue.length + (this.sending ? 1 : 0)
  }

  send(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.queue.push(bytes[i] & 0x1ff)
    if (!this.sending) this.next()
  }

  /** Drop everything (power loss / reset); the line returns to idle (high). */
  cancel(): void {
    if (this.handle) this.ctx.cancel(this.handle)
    this.handle = 0
    this.queue = []
    this.sending = false
    this.levels = []
    this.idx = 0
  }

  private next(): void {
    const b = this.queue.shift()
    if (b === undefined) {
      this.sending = false
      return
    }
    const f = this.fmt()
    if (!(f.baud > 0)) {
      this.queue = []
      this.sending = false
      return
    }
    this.bitT = 1 / f.baud
    const lv: (0 | 1)[] = [0]
    for (let i = 0; i < f.dataBits; i++) lv.push(((b >>> i) & 1) as 0 | 1)
    if (f.parity !== 'none') lv.push(parityBit(b, f.dataBits, f.parity))
    for (let i = 0; i < f.stopBits; i++) lv.push(1)
    this.levels = lv
    this.byte = b
    this.idx = 0
    this.sending = true
    this.step()
  }

  /** Drive the level at `idx` and wait until the next level change (or the frame end). */
  private step(): void {
    const lv = this.levels
    if (this.idx >= lv.length) {
      this.sending = false
      this.onSent?.(this.byte, this.ctx.now())
      this.next()
      return
    }
    const l = lv[this.idx]
    this.drive(l)
    let n = 1
    while (this.idx + n < lv.length && lv[this.idx + n] === l) n++
    this.idx += n
    this.handle = this.ctx.schedule(n * this.bitT, () => {
      this.handle = 0
      this.step()
    })
  }
}
