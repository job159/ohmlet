/**
 * Bit-level I²C target (slave) port for the sensor models — the same state
 * machine as the AT24C02 model (serial-ics.model.ts), factored so register-
 * map sensors only describe what a byte means (NXP UM10204):
 *
 *  - START = SDA falling while SCL is high, STOP = SDA rising while SCL is
 *    high; a START inside a transaction is a repeated START.
 *  - Bits are sampled on SCL rising edges; the target changes SDA t_AA =
 *    0.3 µs after SCL falls, so every other device sees SCL low first.
 *  - Address byte → `matches(addr7)`; ACK = SDA low during the 9th clock.
 *  - Write transactions: every received byte goes to `write(index, byte)`
 *    (index 0 = first byte after the address); returning false NACKs it.
 *  - Read transactions: `read(index)` supplies each byte MSB first; the
 *    master's ACK asks for the next one, its NACK ends the read (the target
 *    releases SDA and waits for STOP / START).
 *
 * Only pin edges drive it (DigitalDeviceCtx), never function calls from an
 * MCU model. SDA is open drain: the port only drives 'low' or releases.
 */
import type { DigitalDeviceCtx, LogicLevel } from '../digital/api'

/** clock low to data out valid (s) — inside the 0.05–0.9 µs window of typical targets */
export const I2C_T_AA = 0.3e-6

export interface I2cTarget {
  /** 7-bit address match (called after the 8 address bits). */
  matches(addr7: number): boolean
  /** A data byte of a write transaction; false = NACK. */
  write(index: number, value: number): boolean
  /** The next byte of a read transaction. */
  read(index: number): number
  /** START or repeated START seen on the bus. */
  started?(repeated: boolean): void
  /** STOP seen (or the transaction ended). `addressed` = this target took part. */
  stopped?(addressed: boolean): void
}

type PortState = 'idle' | 'addr' | 'ackAddr' | 'wdata' | 'ackData' | 'rdata' | 'rack' | 'ignore'

export class I2cTargetPort {
  private ctx: DigitalDeviceCtx | null = null
  private scl: 0 | 1 = 1
  private sda: 0 | 1 = 1
  private state: PortState = 'idle'
  private bits = 0
  private shift = 0
  private index = 0
  private reading = false
  private masterAck = false
  private outByte = 0
  private outHandle = 0
  private addressed = false
  private inTransaction = false
  /** bytes this port acknowledged (telemetry / tests) */
  transfers = 0

  constructor(
    private readonly target: I2cTarget,
    private readonly sdaPin = 'SDA',
    private readonly sclPin = 'SCL',
  ) {}

  attach(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive(this.sdaPin, 'z')
    this.resync()
  }

  /** Bus between START and STOP (sensors must not update shadowed data then). */
  get busy(): boolean {
    return this.inTransaction
  }

  /** Power loss / reset: release SDA, forget the transaction. */
  reset(): void {
    this.cancelOut()
    this.ctx?.drive(this.sdaPin, 'z')
    const was = this.inTransaction
    this.state = 'idle'
    this.inTransaction = false
    if (was) this.target.stopped?.(this.addressed)
    this.addressed = false
    this.resync()
  }

  resync(): void {
    if (!this.ctx) return
    this.scl = this.ctx.read(this.sclPin) === 0 ? 0 : 1
    this.sda = this.ctx.read(this.sdaPin) === 0 ? 0 : 1
  }

  /** Feed every SDA / SCL change (both pins must be DigitalSpec inputs). */
  onPinChange(pin: string, level: LogicLevel): void {
    if (level === null) return
    if (pin === this.sdaPin) {
      const prev = this.sda
      this.sda = level
      if (this.scl === 1 && prev !== level) {
        if (level === 0) this.start()
        else this.stop()
      }
      return
    }
    if (pin !== this.sclPin || level === this.scl) return
    this.scl = level
    if (level === 1) this.sclRise()
    else this.sclFall()
  }

  private start(): void {
    const repeated = this.inTransaction
    this.cancelOut()
    this.ctx?.drive(this.sdaPin, 'z')
    if (repeated && this.addressed) this.target.stopped?.(true)
    this.inTransaction = true
    this.addressed = false
    this.state = 'addr'
    this.bits = 0
    this.shift = 0
    this.target.started?.(repeated)
  }

  private stop(): void {
    this.cancelOut()
    this.ctx?.drive(this.sdaPin, 'z')
    const was = this.inTransaction
    this.state = 'idle'
    this.inTransaction = false
    if (was) this.target.stopped?.(this.addressed)
    this.addressed = false
  }

  private sclRise(): void {
    switch (this.state) {
      case 'addr':
      case 'wdata':
        if (this.bits < 8) {
          this.shift = ((this.shift << 1) | (this.ctx?.read(this.sdaPin) === 0 ? 0 : 1)) & 0xff
          this.bits++
        }
        return
      case 'rdata':
        this.bits++
        return
      case 'rack':
        this.masterAck = this.ctx?.read(this.sdaPin) === 0
        return
      default:
        return
    }
  }

  private sclFall(): void {
    switch (this.state) {
      case 'addr': {
        if (this.bits < 8) return
        const b = this.shift
        if (!this.target.matches(b >>> 1)) {
          this.state = 'ignore'
          return
        }
        this.addressed = true
        this.reading = (b & 1) === 1
        this.index = 0
        this.out(0)
        this.state = 'ackAddr'
        return
      }
      case 'ackAddr':
        this.bits = 0
        this.shift = 0
        if (this.reading) this.beginRead()
        else {
          this.out(1)
          this.state = 'wdata'
        }
        return
      case 'wdata': {
        if (this.bits < 8) return
        const ok = this.target.write(this.index++, this.shift)
        if (ok) this.transfers++
        this.out(ok ? 0 : 1)
        this.state = 'ackData'
        return
      }
      case 'ackData':
        this.out(1)
        this.bits = 0
        this.shift = 0
        this.state = 'wdata'
        return
      case 'rdata':
        if (this.bits < 8) {
          this.out(((this.outByte >>> (7 - this.bits)) & 1) as 0 | 1)
          return
        }
        this.transfers++
        this.out(1) // release for the master's ACK / NACK
        this.state = 'rack'
        return
      case 'rack':
        if (this.masterAck) this.beginRead()
        else this.state = 'ignore'
        return
      default:
        return
    }
  }

  private beginRead(): void {
    this.outByte = this.target.read(this.index++) & 0xff
    this.bits = 0
    this.state = 'rdata'
    this.out(((this.outByte >>> 7) & 1) as 0 | 1)
  }

  /** Drive SDA (0 = low, 1 = release) t_AA after the SCL falling edge. */
  private out(level: 0 | 1): void {
    const ctx = this.ctx
    if (!ctx) return
    this.cancelOut()
    this.outHandle = ctx.schedule(I2C_T_AA, () => {
      this.outHandle = 0
      ctx.drive(this.sdaPin, level ? 'z' : 'low')
    })
  }

  private cancelOut(): void {
    if (this.outHandle && this.ctx) this.ctx.cancel(this.outHandle)
    this.outHandle = 0
  }
}

/** Numeric value of a param (numbers, numeric strings, booleans). */
export function numParam(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return fallback
}

/** Boolean value of a param. */
export function boolParam(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === 'true' || v === '1'
  return fallback
}
