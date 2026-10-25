/**
 * SPI slave shift engine shared by the SPI memory modules (W25Q32 flash,
 * micro-SD card). Driven ONLY by pin edges:
 *
 *  - CS falling starts a transaction (the clock level at that moment tells
 *    mode 0 — SCK idles low — from mode 3 — SCK idles high);
 *  - MOSI is sampled on every SCK rising edge, MSB first; after the 8th bit
 *    the byte goes to the handler, which decides what comes next;
 *  - MISO changes on SCK falling edges: the falling edge after a complete
 *    byte presents the MSB of the next output byte, the others shift the
 *    current byte. In mode 0 the first byte's MSB is presented when CS
 *    falls; in mode 3 the leading falling edge of a byte leaves it in place
 *    (it is already on the line), so both modes see identical data;
 *  - CS rising ends the transaction (the handler learns how many bits of an
 *    unfinished byte were clocked — erase / program commands of real parts
 *    only execute when CS rises on a byte boundary).
 *
 * Output bytes are `number` (driven) or `null` (MISO released — a part that
 * only drives its data output in output phases).
 */
import type { DigitalDeviceCtx, LogicLevel } from '../digital/api'

export interface SpiSlaveHandler {
  /** CS fell: a new transaction begins */
  select(): void
  /** one byte received (MSB first) */
  byte(rx: number): void
  /** the byte to shift out next (null = keep MISO released for that byte) */
  next(): number | null
  /** CS rose; `partialBits` = bits clocked into an unfinished byte (0 = ended on a byte boundary) */
  deselect(partialBits: number): void
}

export interface SpiPins {
  cs: string
  sck: string
  mosi: string
  miso: string
}

export class SpiSlave {
  private selected = false
  private bitsIn = 0
  private inShift = 0
  private out: number | null = null
  private sck: 0 | 1 = 0
  private cs: 0 | 1 = 1
  /** bytes exchanged in this transaction (statistics) */
  bytes = 0

  constructor(
    private readonly ctx: DigitalDeviceCtx,
    private readonly pins: SpiPins,
    private readonly h: SpiSlaveHandler,
    /** drive MISO: 0 / 1, or null = release */
    private readonly driveMiso: (bit: 0 | 1 | null) => void,
  ) {}

  get isSelected(): boolean {
    return this.selected
  }

  /** Re-read CS / SCK (power-up); ends any transaction without notifying. */
  sync(): void {
    this.cs = this.ctx.read(this.pins.cs) === 0 ? 0 : 1
    this.sck = this.ctx.read(this.pins.sck) === 1 ? 1 : 0
    this.selected = false
    this.driveMiso(null)
  }

  /** Feed a pin change; returns true when the pin belongs to the SPI bus. */
  onPin(pin: string, level: LogicLevel): boolean {
    if (pin === this.pins.cs) {
      // a floating CS reads high (deselected): a select must be driven
      const l: 0 | 1 = level === 0 ? 0 : 1
      if (l === this.cs) return true
      this.cs = l
      if (l === 0) this.begin()
      else this.end()
      return true
    }
    if (pin === this.pins.sck) {
      if (level === null) return true
      if (level === this.sck) return true
      this.sck = level
      if (!this.selected) return true
      if (level === 1) this.rise()
      else this.fall()
      return true
    }
    return pin === this.pins.mosi
  }

  private begin(): void {
    this.selected = true
    this.bitsIn = 0
    this.inShift = 0
    this.bytes = 0
    this.h.select()
    this.load()
  }

  private end(): void {
    if (!this.selected) return
    this.selected = false
    this.driveMiso(null)
    const partial = this.bitsIn === 8 ? 0 : this.bitsIn
    this.h.deselect(partial)
  }

  private rise(): void {
    if (this.bitsIn >= 8) {
      // a rising edge without the falling edge that loads the next byte cannot happen on a real clock
      this.bitsIn = 0
      this.inShift = 0
    }
    const b = this.ctx.read(this.pins.mosi) === 0 ? 0 : 1
    this.inShift = ((this.inShift << 1) | b) & 0xff
    this.bitsIn++
    if (this.bitsIn === 8) {
      this.bytes++
      this.h.byte(this.inShift)
    }
  }

  private fall(): void {
    if (this.bitsIn === 0) return // mode 3 leading edge: the MSB is already presented
    if (this.bitsIn >= 8) {
      this.bitsIn = 0
      this.inShift = 0
      this.load()
      return
    }
    this.present(7 - this.bitsIn)
  }

  /** Ask the handler for the next output byte and present its MSB. */
  private load(): void {
    this.out = this.h.next()
    this.present(7)
  }

  private present(bit: number): void {
    if (this.out === null) this.driveMiso(null)
    else this.driveMiso(((this.out >>> bit) & 1) as 0 | 1)
  }
}
