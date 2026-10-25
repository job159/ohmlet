/**
 * Bit-level I²C target (slave) shared by the display-module controllers
 * (SSD1306 / SH1106 OLEDs and the PCF8574 LCD backpack). Driven ONLY by the
 * SDA / SCL pin edges the DigitalDeviceHost delivers (UM10204 §3.1):
 *
 *  • START = SDA falling while SCL is high, STOP = SDA rising while SCL is
 *    high (a START during a transfer is a repeated START).
 *  • Data bits are sampled on SCL rising edges, MSB first; after the 8th bit
 *    the target acknowledges by pulling SDA low for the 9th clock.
 *  • The target only changes SDA while SCL is low: `tOut` after the SCL
 *    falling edge (t_HD;DAT / t_VD;ACK region), so the master always sees a
 *    stable level at its next rising edge.
 *  • Reads: the byte is shifted out MSB first, one bit per SCL low phase;
 *    the master's ACK (SDA low on the 9th clock) asks for another byte, its
 *    NACK ends the read (the target releases SDA and waits for STOP).
 *
 * The protocol owner (the controller model) decides address matching, what
 * an incoming byte means and what is read back.
 */
import type { DigitalDeviceCtx, LogicLevel } from '../digital/api'


export interface I2cTarget {
  /** Does the target answer this 7-bit address / direction? (NACK otherwise) */
  matches(addr7: number, read: boolean): boolean
  /** A (repeated) START began a new transfer. */
  start?(): void
  /** An addressed byte was written; return false to NACK it. */
  write(byte: number): boolean
  /** The 9th clock of an acknowledged written byte has ended (PCF8574 port outputs change here). */
  afterWriteAck?(): void
  /** Next byte for a read transfer (sampled when the byte starts). */
  read(): number
  /** STOP condition (also after a NACKed address). */
  stop?(): void
}

type State = 'idle' | 'addr' | 'ackAddr' | 'write' | 'ackWrite' | 'read' | 'readAck' | 'ignore'

export class I2cSlave {
  private scl: 0 | 1 = 1
  private sda: 0 | 1 = 1
  private state: State = 'idle'
  private bits = 0
  private shift = 0
  private reading = false
  private outByte = 0
  private masterAck = false
  private outHandle = 0
  private acked = false

  constructor(
    private readonly ctx: DigitalDeviceCtx,
    private readonly target: I2cTarget,
    private readonly sdaPin = 'SDA',
    private readonly sclPin = 'SCL',
    /** SDA output delay after SCL falls (s) */
    private readonly tOut = 0.3e-6,
  ) {}

  /** Bus idle, SDA released (power-up, reset). */
  reset(): void {
    this.cancelOut()
    this.ctx.drive(this.sdaPin, 'z')
    this.state = 'idle'
    this.bits = 0
    this.shift = 0
    this.resync()
  }

  /** Re-read the line levels (after power-up). */
  resync(): void {
    this.scl = this.ctx.read(this.sclPin) === 0 ? 0 : 1
    this.sda = this.ctx.read(this.sdaPin) === 0 ? 0 : 1
  }

  /** true while the target is addressed (between its address ACK and STOP / NACK). */
  get active(): boolean {
    return this.state !== 'idle' && this.state !== 'ignore' && this.state !== 'addr'
  }

  /** Feed a pin change; returns true when it was an SDA/SCL edge. */
  onPinChange(pin: string, level: LogicLevel): boolean {
    if (pin !== this.sdaPin && pin !== this.sclPin) return false
    if (level === null) return true
    if (pin === this.sdaPin) {
      const prev = this.sda
      this.sda = level
      if (this.scl === 1 && prev !== level) {
        if (level === 0) this.onStart()
        else this.onStop()
      }
      return true
    }
    if (level === this.scl) return true
    this.scl = level
    if (level === 1) this.sclRise()
    else this.sclFall()
    return true
  }

  private onStart(): void {
    this.cancelOut()
    this.ctx.drive(this.sdaPin, 'z')
    this.state = 'addr'
    this.bits = 0
    this.shift = 0
    this.target.start?.()
  }

  private onStop(): void {
    this.cancelOut()
    this.ctx.drive(this.sdaPin, 'z')
    const was = this.state
    this.state = 'idle'
    if (was !== 'idle') this.target.stop?.()
  }

  private sclRise(): void {
    switch (this.state) {
      case 'addr':
      case 'write':
        if (this.bits < 8) {
          this.shift = ((this.shift << 1) | this.sda) & 0xff
          this.bits++
        }
        return
      case 'read':
        this.bits++
        return
      case 'readAck':
        this.masterAck = this.sda === 0
        return
      default:
        return
    }
  }

  private sclFall(): void {
    switch (this.state) {
      case 'addr': {
        if (this.bits < 8) return
        const addr7 = this.shift >>> 1
        this.reading = (this.shift & 1) === 1
        if (!this.target.matches(addr7, this.reading)) {
          this.state = 'ignore' // NACK: SDA stays released
          return
        }
        this.outLater(0)
        this.state = 'ackAddr'
        return
      }
      case 'ackAddr':
        this.bits = 0
        this.shift = 0
        if (this.reading) this.beginReadByte()
        else {
          this.outLater(1)
          this.state = 'write'
        }
        return
      case 'write': {
        if (this.bits < 8) return
        this.acked = this.target.write(this.shift)
        if (this.acked) this.outLater(0)
        this.state = 'ackWrite'
        return
      }
      case 'ackWrite':
        this.outLater(1)
        this.bits = 0
        this.shift = 0
        this.state = 'write'
        if (this.acked) this.target.afterWriteAck?.()
        return
      case 'read':
        if (this.bits < 8) {
          this.outLater(((this.outByte >>> (7 - this.bits)) & 1) as 0 | 1)
          return
        }
        // byte done: release SDA for the master's ACK / NACK
        this.outLater(1)
        this.state = 'readAck'
        return
      case 'readAck':
        if (this.masterAck) this.beginReadByte()
        else this.state = 'ignore'
        return
      default:
        return
    }
  }

  private beginReadByte(): void {
    this.outByte = this.target.read() & 0xff
    this.bits = 0
    this.state = 'read'
    this.outLater(((this.outByte >>> 7) & 1) as 0 | 1)
  }

  /** drive SDA (0 = low, 1 = release) tOut after the SCL falling edge */
  private outLater(level: 0 | 1): void {
    this.cancelOut()
    this.outHandle = this.ctx.schedule(this.tOut, () => {
      this.outHandle = 0
      this.ctx.drive(this.sdaPin, level ? 'z' : 'low')
    })
  }

  private cancelOut(): void {
    if (this.outHandle) this.ctx.cancel(this.outHandle)
    this.outHandle = 0
  }
}

/** Deterministic power-up SRAM contents (seeded per component id): real display RAM wakes up random. */
export function powerUpNoise(componentId: string, out: Uint8Array): void {
  let h = 2166136261
  for (let i = 0; i < componentId.length; i++) h = Math.imul(h ^ componentId.charCodeAt(i), 16777619)
  let a = h >>> 0
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff
  }
}

/**
 * Reports inputs that read no valid logic level: driven to a voltage between
 * V_IL and V_IH (e.g. 3.3 V logic into a part powered at 5 V whose V_IH is
 * 3.5 V) at once; really floating (nothing drives the net) only when it is
 * still floating 20 ms later — MCU pins float until the firmware configures
 * them, which is not worth a warning.
 */
export class InputWatch {
  private readonly warned = new Set<string>()
  private readonly pending = new Set<string>()
  private superviseHandle = 0

  constructor(
    private readonly ctx: DigitalDeviceCtx,
    private readonly chip: string,
    private readonly vihFrac: number,
  ) {}

  private midVoltage(pin: string): number {
    const v = this.ctx.voltage(pin)
    return Number.isFinite(v) && v > 0.05 ? v : NaN
  }

  /** `pin` just read null */
  undefinedLevel(pin: string): void {
    if (this.reportMid(pin)) return
    if (this.pending.has(pin) || this.warned.has(`${pin}:float`)) return
    this.pending.add(pin)
    // A floating input and one driven between V_IL and V_IH both read null
    // without an edge in between (an MCU pin configured as a 3.3 V output
    // HIGH straight from reset): look again once the firmware has had time
    // to configure its pins and report whichever it is.
    this.ctx.schedule(20e-3, () => {
      this.pending.delete(pin)
      if (this.ctx.read(pin) !== null || this.reportMid(pin) || this.warned.has(`${pin}:float`)) return
      this.warned.add(`${pin}:float`)
      this.ctx.issue('warning', `${this.chip} input ${pin} is floating (CMOS inputs must be driven)`)
    })
  }

  /**
   * Electrical supervision while powered: every `period` of virtual time,
   * look at the voltage on `pins`. The input hysteresis of the digital host
   * keeps the last valid level when a pin goes from LOW straight to a
   * voltage between V_IL and V_IH (3.3 V logic into a 5 V part with V_IH =
   * 0.7·VDD), so no pin change ever reveals that case; a pin seen in that
   * band on two checks in a row is reported once (the level itself still
   * reads as the chip's Schmitt input would hold it). Stops once every pin
   * has been reported; `stopSupervision` on power loss.
   */
  supervise(pins: readonly string[], vilFrac: number, period = 10e-3): void {
    this.stopSupervision()
    const seen = new Set<string>()
    const tick = (): void => {
      this.superviseHandle = 0
      const vdd = this.ctx.supply()
      let open = false
      for (const pin of pins) {
        if (this.warned.has(`${pin}:mid`)) continue
        open = true
        const v = this.ctx.voltage(pin)
        const mid = vdd > 0 && v > vilFrac * vdd + 0.05 && v < this.vihFrac * vdd - 0.05
        if (!mid) seen.delete(pin)
        else if (seen.has(pin)) this.reportMid(pin)
        else seen.add(pin)
      }
      if (open) this.superviseHandle = this.ctx.schedule(period, tick)
    }
    this.superviseHandle = this.ctx.schedule(period, tick)
  }

  stopSupervision(): void {
    if (this.superviseHandle) this.ctx.cancel(this.superviseHandle)
    this.superviseHandle = 0
  }

  /** a driven mid-band voltage on `pin`: warn once; true when it is one */
  private reportMid(pin: string): boolean {
    const v = this.midVoltage(pin)
    if (!Number.isFinite(v)) return false
    const key = `${pin}:mid`
    if (this.warned.has(key)) return true
    this.warned.add(key)
    const vdd = this.ctx.supply()
    this.ctx.issue(
      'warning',
      `${this.chip} input ${pin} is at ${v.toFixed(2)} V, between V_IL and V_IH = ${(this.vihFrac * vdd).toFixed(2)} V (${this.vihFrac}·VDD): no valid logic level — power the part lower or use a level shifter`,
    )
    return true
  }
}
