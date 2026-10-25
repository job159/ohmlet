/**
 * SPI1 / SPI2 — RM0008 ch. 25 (SPI mode; I2S is not present on the
 * medium-density STM32F103C8, §25.1), simulated BIT-LEVEL on SCK / MOSI /
 * MISO / NSS.
 *
 * Registers (§25.5): CR1, CR2, SR, DR, CRCPR, RXCRCR, TXCRCR (+ I2SCFGR /
 * I2SPR: not implemented on this device — writes logged and ignored).
 *
 * Master (§25.3.3): SCK = f_PCLK / 2^(BR+1) (SPI1 on PCLK2, SPI2 on PCLK1),
 * so one SCK half period is exactly 2^BR PCLK cycles. A DR write moves the
 * Tx buffer into the shift register 2 PCLK cycles later (the "2 APB clock"
 * delay of §25.3.5) — that is the frame start t0, when TXE is set. The 2·n
 * SCK edges (n = 8 or 16, DFF) follow at t0 + k·h, k = 1 … 2n, starting
 * from the CPOL idle level. CPHA = 0: the first data bit is on MOSI at t0,
 * odd edges sample MISO, even edges shift the next bit out; CPHA = 1: odd
 * edges shift out, even edges sample (Figure 239). MSB or LSB first
 * (LSBFIRST). RXNE is set on the last sampling edge; if RXNE was still set
 * the new frame is lost and OVR is set (Rx buffer keeps the unread data).
 * A Tx buffer written before the frame ends starts the next frame right at
 * t0 + 2n·h (continuous transfer, BSY stays high); otherwise BSY drops at
 * the end of the frame. BSY = shift register busy OR Tx buffer full
 * (§25.5.3). RXONLY and BIDIMODE/BIDIOE = 0 masters clock frames
 * continuously from SPE = 1 until SPE is cleared (the frame in progress
 * completes, §25.3.8).
 *
 * Slave (§25.3.2): driven only by edges on the SCK PIN while selected
 * (NSS pin low, or SSM = 1 with SSI = 0). The edge that leaves the CPOL idle
 * level is the leading edge: CPHA = 0 samples on it and shifts out on the
 * trailing edge (the first bit is put on MISO as soon as the slave is
 * selected / the previous frame ends); CPHA = 1 shifts out on the leading
 * edge and samples on the trailing one. One shift register shifts out at
 * one end and in at the other, so a slave whose Tx buffer was not refilled
 * sends back the frame it just received (as silicon does). Deselecting the
 * slave (NSS high) resets its bit counter.
 *
 * NSS (§25.3.1): SSM = 1 → SSI is the internal NSS; SSM = 0, master with
 * SSOE = 1 → the NSS pin is driven low while SPE = 1 (high once disabled);
 * master with SSOE = 0 → NSS pin input. A master whose internal NSS goes low
 * gets MODF (§25.3.10): SPE and MSTR cleared, MODF set; SPE/MSTR cannot be
 * set again while MODF = 1; MODF clears by an SR access then a CR1 write.
 *
 * CRC (§25.3.6): separate Tx and Rx CRC calculators (CRCPR polynomial,
 * 8- or 16-bit per DFF) clocked on every data bit; CRCEN 0→1 clears both.
 * CRCNEXT: after the last data frame (Tx buffer empty) the next frame
 * sends TXCRCR; the CRC frame received at the same time is compared with
 * RXCRCR → CRCERR, and lands in DR (RXNE). CRCNEXT is cleared by hardware
 * at the end of the CRC frame.
 *
 * Interrupt (SPI1 35, SPI2 36, §25.3.11): TXE·TXEIE | RXNE·RXNEIE |
 * (OVR|MODF|CRCERR)·ERRIE. DMA (§25.3.9, Table 78): TXE·TXDMAEN /
 * RXNE·RXDMAEN on SPI1 ch3/ch2, SPI2 ch5/ch4. OVR clears by DR read then
 * SR read.
 *
 * Pins: SPI1 PA4 NSS / PA5 SCK / PA6 MISO / PA7 MOSI, remap (AFIO
 * SPI1_REMAP) PA15 / PB3 / PB4 / PB5; SPI2 PB12 / PB13 / PB14 / PB15
 * (§9.3.10, Table 25 / DS5319 Table 5). Outputs are push-pull AF levels via
 * SocContext.setAfOutput: SCK and MOSI (master) or MISO (slave) while SPE =
 * 1, released at SPE = 0 (the GPIO's AF default then applies).
 *
 * Bidirectional 1-line mode (BIDIMODE = 1): BIDIOE = 1 transmits on the
 * data pin (MOSI master / MISO slave); BIDIOE = 0 keeps the pin but switches
 * its AF output buffer off (SocContext.setAfOutput 'z', RM0008 §25.3.4), so
 * the pin is high-impedance and the frame is sampled from it.
 *
 * Not simulated (logged): I2S (not on this device), the TI frame format
 * (not on F1), multi-master arbitration beyond MODF.
 */
import type { AccessSize, EventHandle } from '../core/types'
import type { AfioRemap, RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { APB1, APB2, laneMask, laneShift } from './block'

// ---- CR1 (§25.5.1)
const CR1_CPHA = 1 << 0
const CR1_CPOL = 1 << 1
const CR1_MSTR = 1 << 2
const CR1_SPE = 1 << 6
const CR1_LSBFIRST = 1 << 7
const CR1_SSI = 1 << 8
const CR1_SSM = 1 << 9
const CR1_RXONLY = 1 << 10
const CR1_DFF = 1 << 11
const CR1_CRCNEXT = 1 << 12
const CR1_CRCEN = 1 << 13
const CR1_BIDIOE = 1 << 14
const CR1_BIDIMODE = 1 << 15
// ---- CR2 (§25.5.2)
const CR2_RXDMAEN = 1 << 0
const CR2_TXDMAEN = 1 << 1
const CR2_SSOE = 1 << 2
const CR2_ERRIE = 1 << 5
const CR2_RXNEIE = 1 << 6
const CR2_TXEIE = 1 << 7
// ---- SR (§25.5.3)
export const SPI_SR_RXNE = 1 << 0
export const SPI_SR_TXE = 1 << 1
export const SPI_SR_CRCERR = 1 << 4
export const SPI_SR_MODF = 1 << 5
export const SPI_SR_OVR = 1 << 6
export const SPI_SR_BSY = 1 << 7

export interface SpiConfig {
  name: 'SPI1' | 'SPI2'
  base: number
  gate: RccGate
  irq: number
  /** APB bus clocking the block */
  apb: 1 | 2
  dmaRx: number
  dmaTx: number
  pins(r: AfioRemap): { nss: string; sck: string; miso: string; mosi: string }
}

export const SPI1_CONFIG: SpiConfig = {
  name: 'SPI1',
  base: 0x40013000,
  gate: APB2(12),
  irq: 35,
  apb: 2,
  dmaRx: 2,
  dmaTx: 3,
  pins: (r) => (r.spi1 ? { nss: 'PA15', sck: 'PB3', miso: 'PB4', mosi: 'PB5' } : { nss: 'PA4', sck: 'PA5', miso: 'PA6', mosi: 'PA7' }),
}

export const SPI2_CONFIG: SpiConfig = {
  name: 'SPI2',
  base: 0x40003800,
  gate: APB1(14),
  irq: 36,
  apb: 1,
  dmaRx: 4,
  dmaTx: 5,
  pins: () => ({ nss: 'PB12', sck: 'PB13', miso: 'PB14', mosi: 'PB15' }),
}

/** Support-table notes (peripherals.ts). */
export const SPI_NOTES =
  'Bit-level SPI on SCK/MOSI/MISO/NSS: master SCK at f_PCLK/2^(BR+1) with exact edge cycles, CPOL/CPHA modes 0–3 (MISO sampled on the right edge), 8/16-bit frames, MSB/LSB first, continuous transfers (BSY), TXE/RXNE/OVR, RXONLY and BIDIMODE/BIDIOE (bidirectional receive tri-states the data pin: AF output enable off), hardware NSS output (SSOE), software NSS (SSM/SSI), MODF, slave mode clocked by the SCK pin (NSS pin or SSI select), hardware CRC (CRCPR, TXCRCR/RXCRCR, CRCNEXT, CRCERR), interrupt and DMA request lines, AFIO SPI1 remap. Not simulated (logged): I2S (not present on the STM32F103C8).'

/** One CRC step on a serial bit (§25.3.6): MSB-feedback LFSR with polynomial `poly`, width w. */
export function spiCrcBit(crc: number, bit: number, poly: number, w: number): number {
  const mask = w === 16 ? 0xffff : 0xff
  const fb = ((crc >>> (w - 1)) & 1) ^ (bit & 1)
  crc = (crc << 1) & mask
  return fb ? (crc ^ (poly & mask)) & mask : crc
}

export class Spi implements Stm32Peripheral {
  readonly name: string
  readonly base: number
  readonly size = 0x400
  readonly gate: RccGate

  private ctx!: SocContext
  // ---- registers
  private cr1 = 0
  private cr2 = 0
  private crcpr = 7
  private rxcrc = 0
  private txcrc = 0
  private ovr = false
  private modf = false
  private crcerr = false
  private rxBuf = 0
  private rxne = false
  private txBuf = 0
  private txFull = false
  /** SR accessed while MODF = 1 (first half of the MODF clear sequence) */
  private modfSeen = false
  /** DR read since OVR (first half of the OVR clear sequence) */
  private ovrDrRead = false
  // ---- shift register / frame
  private shifting = false
  private shift = 0
  /** the shift register holds Tx-buffer data not yet shifted out (a later DR write queues) */
  private shiftLoaded = false
  private rxShift = 0
  private bitsIn = 0
  private bitsOut = 0
  private crcFrame = false
  /** master: frame start cycle and its scheduled edges */
  private evs: EventHandle[] = []
  private stopAfterFrame = false
  // ---- pins
  private pinNames = { nss: '', sck: '', miso: '', mosi: '' }
  private nssPin = -1
  private sckPin = -1
  private misoPin = -1
  private mosiPin = -1
  private claimed = new Set<number>()
  /** claimed pins whose AF output buffer is switched off (bidirectional receive) */
  private hiZ = new Set<number>()
  private unsub: (() => void)[] = []
  private clocked = false
  // ---- slave
  private selected = false
  private warned = new Set<string>()
  // ---- outputs
  private irqOn = false
  private dmaTxOn = false
  private dmaRxOn = false

  constructor(private cfg: SpiConfig) {
    this.name = cfg.name
    this.base = cfg.base
    this.gate = cfg.gate
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
    this.resolvePins()
  }

  // ================================================================ bus

  read(offset: number, size: AccessSize): number {
    const w = this.read32(offset & ~3)
    if (size === 4) return w >>> 0
    return (w >>> laneShift(offset)) & (size === 2 ? 0xffff : 0xff)
  }

  write(offset: number, value: number, size: AccessSize): void {
    if (size === 4) this.write32(offset & ~3, value >>> 0, 0xffffffff)
    else this.write32(offset & ~3, (value << laneShift(offset)) >>> 0, laneMask(offset, size))
  }

  private srValue(): number {
    let v = 0
    if (this.rxne) v |= SPI_SR_RXNE
    if (!this.txFull) v |= SPI_SR_TXE
    if (this.crcerr) v |= SPI_SR_CRCERR
    if (this.modf) v |= SPI_SR_MODF
    if (this.ovr) v |= SPI_SR_OVR
    if (this.busy()) v |= SPI_SR_BSY
    return v
  }

  private busy(): boolean {
    if (this.isMaster() && this.cr1 & CR1_BIDIMODE && !(this.cr1 & CR1_BIDIOE)) return false // §25.3.7 exception
    return this.shifting || this.txFull
  }

  private read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.cr1
      case 0x04:
        return this.cr2
      case 0x08: {
        const v = this.srValue()
        if (this.modf) this.modfSeen = true
        if (this.ovr && this.ovrDrRead) {
          // OVR: DR read followed by SR read (§25.3.10)
          this.ovr = false
          this.ovrDrRead = false
          this.update()
        }
        return v
      }
      case 0x0c: {
        const v = this.rxBuf & (this.cr1 & CR1_DFF ? 0xffff : 0xff)
        if (this.ovr) this.ovrDrRead = true
        if (this.rxne) {
          this.rxne = false
          this.update()
        }
        return v
      }
      case 0x10:
        return this.crcpr
      case 0x14:
        return this.cr1 & CR1_CRCEN ? this.rxcrc : 0
      case 0x18:
        return this.cr1 & CR1_CRCEN ? this.txcrc : 0
      default:
        return 0
    }
  }

  private write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00:
        this.writeCr1(((this.cr1 & ~m) | (v & m)) & 0xffff)
        return
      case 0x04: {
        const old = this.cr2
        this.cr2 = ((this.cr2 & ~m) | (v & m)) & 0xe7
        if ((old ^ this.cr2) & CR2_SSOE) this.applyPins()
        this.update()
        return
      }
      case 0x08: {
        if (this.modf) this.modfSeen = true
        // CRCERR is rc_w0; everything else read-only
        if (m & SPI_SR_CRCERR && !(v & SPI_SR_CRCERR)) this.crcerr = false
        this.update()
        return
      }
      case 0x0c:
        this.writeDr(v & m & 0xffff, m)
        return
      case 0x10:
        this.crcpr = ((this.crcpr & ~m) | (v & m)) & 0xffff
        if (this.crcpr === 0) this.warnOnce('crcpr0', `${this.name}_CRCPR = 0: not a valid CRC polynomial`)
        return
      case 0x1c:
      case 0x20:
        if (v & m) this.warnOnce('i2s', `I2S is not available on the STM32F103C8 (medium-density, RM0008 §25.1): ${this.name}_${off === 0x1c ? 'I2SCFGR' : 'I2SPR'} write ignored`)
        return
      default:
        return
    }
  }

  reset(): void {
    this.cancelFrame()
    this.cr1 = 0
    this.cr2 = 0
    this.crcpr = 7
    this.rxcrc = this.txcrc = 0
    this.ovr = this.modf = this.crcerr = false
    this.modfSeen = this.ovrDrRead = false
    this.rxBuf = 0
    this.rxne = false
    this.txBuf = 0
    this.txFull = false
    this.selected = false
    this.stopAfterFrame = false
    if (this.ctx) {
      this.releaseAll()
      this.unsubscribe()
      this.update()
    }
  }

  clockEnabled(on: boolean): void {
    this.clocked = on
    if (!on) {
      if (this.shifting) this.warnOnce('gated', `${this.name} clock disabled during a frame: the frame is lost`)
      this.cancelFrame()
      this.unsubscribe()
    } else {
      this.applyPins()
      this.maybeStart(this.now())
    }
  }

  clockChanged(): void {
    // the half period is derived from PCLK at every frame start
  }

  remapChanged(): void {
    const p = this.cfg.pins(this.ctx.remap())
    if (p.sck === this.pinNames.sck && p.mosi === this.pinNames.mosi) return
    this.releaseAll()
    this.unsubscribe()
    this.resolvePins()
    this.applyPins()
  }

  // ================================================================ registers

  private writeCr1(nv: number): void {
    const old = this.cr1
    if (this.modf) {
      if (this.modfSeen) {
        // MODF: SR access followed by a CR1 write (§25.3.10)
        this.modf = false
        this.modfSeen = false
      } else {
        // SPE and MSTR cannot be set while MODF = 1
        nv &= ~(CR1_SPE | CR1_MSTR)
      }
    }
    if (nv & CR1_CRCEN && !(old & CR1_CRCEN)) {
      this.rxcrc = 0
      this.txcrc = 0
    }
    const live = (old & CR1_SPE) !== 0
    const cfgBits = CR1_CPHA | CR1_CPOL | CR1_MSTR | CR1_LSBFIRST | CR1_DFF | (0x7 << 3)
    if (live && nv & CR1_SPE && (old ^ nv) & cfgBits && this.shifting) {
      this.warnOnce('cfg-live', `${this.name}_CR1 mode/format bits changed during a transfer (RM0008 §25.5.1: change them only while SPE = 0)`)
    }
    this.cr1 = nv
    const spe = (nv & CR1_SPE) !== 0
    if (spe && !live) this.enable()
    else if (!spe && live) this.disable()
    else if (spe) {
      this.applyPins()
      this.checkNss()
      this.maybeStart(this.now())
    } else this.applyPins() // disabled: only the NSS output (MSTR/SSM/SSOE) can change
    this.update()
  }

  private enable(): void {
    this.applyPins()
    if (!this.isMaster() && this.cr1 & CR1_SSM) this.setSelected((this.cr1 & CR1_SSI) === 0)
    this.checkNss()
    this.maybeStart(this.now())
  }

  private disable(): void {
    if (this.isMaster() && this.shifting && this.rxOnlyMaster()) {
      // receive-only master: the frame in progress completes (§25.3.8)
      this.stopAfterFrame = true
      return
    }
    if (this.shifting) {
      this.warnOnce('spe-off', `${this.name}: SPE cleared during a frame — the frame is cut (RM0008 §25.3.8: wait for TXE = 1 and BSY = 0 first)`)
    }
    this.cancelFrame()
    this.selected = false
    this.releaseAll()
    this.unsubscribe()
    this.applyPins()
  }

  private writeDr(v: number, m: number): void {
    if (!(m & 0xff)) return
    this.txBuf = this.cr1 & CR1_DFF ? v & 0xffff : v & 0xff
    this.txFull = true
    if (!this.isMaster() && this.enabled() && this.selected && !this.shifting && !this.shiftLoaded && this.bitsIn === 0 && this.bitsOut <= 1) {
      // selected idle slave: the data is in the shift register before the first SCK edge
      this.loadFrame()
      if (!(this.cr1 & CR1_CPHA)) this.outBit(this.now())
    }
    this.maybeStart(this.now())
    this.update()
  }

  // ================================================================ helpers

  private now(): number {
    return this.ctx.clock.cycles
  }

  private isMaster(): boolean {
    return (this.cr1 & CR1_MSTR) !== 0
  }

  private enabled(): boolean {
    return (this.cr1 & CR1_SPE) !== 0 && this.clocked
  }

  private nbits(): number {
    return this.cr1 & CR1_DFF ? 16 : 8
  }

  private pclk(): number {
    return this.cfg.apb === 2 ? this.ctx.clocks.pclk2() : this.ctx.clocks.pclk1()
  }

  /** core cycles per SCK half period: 2^BR PCLK cycles */
  private halfPeriod(): number {
    const br = (this.cr1 >>> 3) & 7
    return (1 << br) * this.ctx.cyclesPerTick(this.pclk())
  }

  private rxOnlyMaster(): boolean {
    const c = this.cr1
    return (c & CR1_BIDIMODE) !== 0 ? (c & CR1_BIDIOE) === 0 : (c & CR1_RXONLY) !== 0
  }

  /** this SPI transmits on its data-out pin in the current mode */
  private transmits(): boolean {
    const c = this.cr1
    if (c & CR1_BIDIMODE) return (c & CR1_BIDIOE) !== 0
    return (c & CR1_RXONLY) === 0
  }

  /** this SPI receives in the current mode */
  private receives(): boolean {
    const c = this.cr1
    if (c & CR1_BIDIMODE) return (c & CR1_BIDIOE) === 0
    return true
  }

  /** pin the data is shifted out on (−1: none) */
  private outPin(): number {
    if (!this.transmits()) return -1
    return this.isMaster() ? this.mosiPin : this.misoPin
  }

  /** pin the data is sampled from */
  private inPin(): number {
    const c = this.cr1
    if (c & CR1_BIDIMODE) return this.isMaster() ? this.mosiPin : this.misoPin
    return this.isMaster() ? this.misoPin : this.mosiPin
  }

  private resolvePins(): void {
    const p = this.cfg.pins(this.ctx.remap())
    this.pinNames = p
    this.nssPin = this.ctx.pin(p.nss)
    this.sckPin = this.ctx.pin(p.sck)
    this.misoPin = this.ctx.pin(p.miso)
    this.mosiPin = this.ctx.pin(p.mosi)
  }

  private drive(pin: number, level: 0 | 1, cycle = this.now()): void {
    if (pin < 0) return
    this.claimed.add(pin)
    this.hiZ.delete(pin)
    this.ctx.setAfOutput(this.name, pin, level, cycle)
  }

  /**
   * Bidirectional receive (BIDIMODE = 1, BIDIOE = 0): the SPI keeps the data
   * pin but switches its output buffer off (RM0008 §25.3.4, "BIDIOE: output
   * disabled (receive-only mode)") — the AF pin is high-impedance and the
   * other end drives the line.
   */
  private tristate(pin: number): void {
    if (pin < 0 || this.hiZ.has(pin)) return
    this.claimed.add(pin)
    this.hiZ.add(pin)
    this.ctx.setAfOutput(this.name, pin, 'z')
  }

  private releasePin(pin: number): void {
    if (pin < 0 || !this.claimed.has(pin)) return
    this.claimed.delete(pin)
    this.hiZ.delete(pin)
    this.ctx.setAfOutput(this.name, pin, null)
  }

  private releaseAll(): void {
    for (const p of [...this.claimed]) this.releasePin(p)
  }

  private unsubscribe(): void {
    for (const u of this.unsub) u()
    this.unsub = []
  }

  /** (re)claim the output pins and subscribe to the input pins for the current mode */
  private applyPins(): void {
    if (!this.ctx) return
    this.unsubscribe()
    const spe = this.enabled()
    const master = this.isMaster()
    const cpol: 0 | 1 = this.cr1 & CR1_CPOL ? 1 : 0
    // NSS output (master, SSOE): low while SPE = 1, high when disabled
    if (master && this.cr2 & CR2_SSOE && !(this.cr1 & CR1_SSM)) this.drive(this.nssPin, spe ? 0 : 1)
    else this.releasePin(this.nssPin)
    if (!spe) {
      this.releasePin(this.sckPin)
      this.releasePin(this.mosiPin)
      this.releasePin(this.misoPin)
      return
    }
    if (master) {
      if (!this.shifting) this.drive(this.sckPin, cpol)
      this.releasePin(this.misoPin)
      if (this.transmits()) {
        if (!this.claimed.has(this.mosiPin) || this.hiZ.has(this.mosiPin)) this.drive(this.mosiPin, this.firstBit(this.shift))
      } else if (this.cr1 & CR1_BIDIMODE) this.tristate(this.mosiPin) // 1-line bidirectional receive
      else this.releasePin(this.mosiPin)
      // NSS input (SSM = 0, SSOE = 0): a low level is a mode fault
      if (!(this.cr1 & CR1_SSM) && !(this.cr2 & CR2_SSOE) && this.nssPin >= 0) {
        this.unsub.push(this.ctx.onPinInput(this.nssPin, () => this.checkNss()))
      }
    } else {
      this.releasePin(this.sckPin)
      this.releasePin(this.mosiPin)
      if (this.transmits()) {
        if (!this.claimed.has(this.misoPin) || this.hiZ.has(this.misoPin)) this.drive(this.misoPin, this.firstBit(this.shift))
      } else if (this.cr1 & CR1_BIDIMODE) this.tristate(this.misoPin) // 1-line bidirectional receive
      else this.releasePin(this.misoPin)
      if (this.sckPin >= 0) this.unsub.push(this.ctx.onPinInput(this.sckPin, (l, c) => this.slaveSck(l, c)))
      if (!(this.cr1 & CR1_SSM) && this.nssPin >= 0) {
        this.unsub.push(this.ctx.onPinInput(this.nssPin, (l) => this.setSelected(l === 0)))
        this.setSelected(this.ctx.pinLevel(this.nssPin) === 0)
      } else if (this.cr1 & CR1_SSM) this.setSelected((this.cr1 & CR1_SSI) === 0)
    }
  }

  /** master: internal NSS low → mode fault (§25.3.10) */
  private checkNss(): void {
    if (!this.isMaster() || !(this.cr1 & CR1_SPE)) return
    let nss: 0 | 1
    if (this.cr1 & CR1_SSM) nss = this.cr1 & CR1_SSI ? 1 : 0
    else if (this.cr2 & CR2_SSOE) return // NSS is our output
    else nss = this.nssPin >= 0 ? this.ctx.pinLevel(this.nssPin) : 1
    if (nss === 1) return
    this.modf = true
    this.modfSeen = false
    this.cancelFrame()
    this.cr1 &= ~(CR1_SPE | CR1_MSTR)
    this.releaseAll()
    this.unsubscribe()
    this.ctx.log('warning', this.name, `${this.name} master mode fault (MODF): NSS is low (${this.cr1 & CR1_SSM ? 'SSI = 0' : `${this.pinNames.nss} pin`}) — SPE and MSTR cleared (RM0008 §25.3.10)`)
    this.update()
  }

  private firstBit(word: number): 0 | 1 {
    const n = this.nbits()
    return (this.cr1 & CR1_LSBFIRST ? word & 1 : (word >>> (n - 1)) & 1) as 0 | 1
  }

  private bitAt(word: number, i: number): 0 | 1 {
    const n = this.nbits()
    return (this.cr1 & CR1_LSBFIRST ? (word >>> i) & 1 : (word >>> (n - 1 - i)) & 1) as 0 | 1
  }

  private crcWidth(): number {
    return this.cr1 & CR1_DFF ? 16 : 8
  }

  // ================================================================ frames (common)

  /** load the shift register for a new frame: Tx buffer, CRC (CRCNEXT) or the previous content */
  private loadFrame(): void {
    this.crcFrame = false
    this.shiftLoaded = false
    if (this.txFull && this.transmits()) {
      this.shift = this.txBuf
      this.txFull = false
      this.shiftLoaded = true
    } else if (this.cr1 & CR1_CRCNEXT && this.cr1 & CR1_CRCEN) {
      this.shift = this.txcrc
      this.crcFrame = true
    } else if (this.txFull) {
      // receive-only modes: a DR write is consumed but not sent
      this.txFull = false
    }
    this.bitsIn = 0
    this.bitsOut = 0
    this.rxShift = 0
  }

  private outBit(cycle: number): void {
    const pin = this.outPin()
    const i = this.bitsOut++
    if (pin < 0 || i >= this.nbits()) return
    const bit = this.bitAt(this.shift, i)
    if (this.cr1 & CR1_CRCEN && !this.crcFrame) this.txcrc = spiCrcBit(this.txcrc, bit, this.crcpr, this.crcWidth())
    this.drive(pin, bit, cycle)
  }

  private inBit(): void {
    const pin = this.inPin()
    const n = this.nbits()
    if (this.bitsIn >= n) return
    const bit = pin >= 0 ? this.ctx.pinLevel(pin) : 0
    const i = this.bitsIn++
    if (this.cr1 & CR1_LSBFIRST) this.rxShift |= bit << i
    else this.rxShift |= bit << (n - 1 - i)
    if (this.cr1 & CR1_CRCEN && !this.crcFrame) this.rxcrc = spiCrcBit(this.rxcrc, bit, this.crcpr, this.crcWidth())
  }

  /** the last sampling edge: shift register → Rx buffer (§25.3.5) */
  private frameReceived(): void {
    const word = this.rxShift >>> 0
    // what remains in the shift register is what was shifted in
    if (this.receives()) {
      if (this.crcFrame) {
        if (word !== this.rxcrc) this.crcerr = true
        this.cr1 &= ~CR1_CRCNEXT
      }
      if (this.rxne) this.ovr = true // the Rx buffer keeps the unread data
      else {
        this.rxBuf = word
        this.rxne = true
      }
    } else if (this.crcFrame) this.cr1 &= ~CR1_CRCNEXT
    this.shift = word
    this.shiftLoaded = false
  }

  // ================================================================ master

  private cancelFrame(): void {
    const s = this.ctx?.scheduler
    if (s) for (const h of this.evs) s.cancel(h)
    this.evs = []
    this.shifting = false
    this.stopAfterFrame = false
  }

  private maybeStart(at: number): void {
    if (!this.ctx || !this.enabled() || !this.isMaster() || this.shifting) return
    // a frame starts on a DR write (or at once in the receive-only modes); a CRCNEXT set
    // after the last frame has ended does not start one
    if (!this.txFull && !this.rxOnlyMaster()) return
    // the Tx buffer moves to the shift register 2 PCLK cycles after the DR write (§25.3.5)
    this.shifting = true
    const t0 = at + 2 * this.ctx.cyclesPerTick(this.pclk())
    const h0 = this.ctx.scheduler.schedule(t0, (c) => this.masterFrame(c))
    this.evs = [h0]
    this.update()
  }

  private masterFrame(t0: number): void {
    this.evs = []
    this.loadFrame()
    const n = this.nbits()
    const h = this.halfPeriod()
    const cpha = (this.cr1 & CR1_CPHA) !== 0
    const cpol: 0 | 1 = this.cr1 & CR1_CPOL ? 1 : 0
    const sched = (at: number, fn: (c: number) => void) => this.evs.push(this.ctx.scheduler.schedule(at, fn))
    if (!cpha) this.outBit(t0)
    for (let k = 1; k <= 2 * n; k++) {
      const lead = k % 2 === 1
      const level = (lead ? cpol ^ 1 : cpol) as 0 | 1
      sched(t0 + k * h, (c) => {
        this.drive(this.sckPin, level, c)
        const sample = cpha ? !lead : lead
        if (sample) {
          this.inBit()
          if (this.bitsIn === n) this.frameReceived()
        } else if (cpha || k < 2 * n) {
          // shift-out edges: CPHA = 1 leading edges; CPHA = 0 trailing edges but the last
          this.outBit(c)
        }
        this.update()
      })
    }
    sched(t0 + 2 * n * h, (c) => this.masterFrameEnd(c))
    this.update()
  }

  private masterFrameEnd(c: number): void {
    this.evs = []
    this.shifting = false
    const crcNext = (this.cr1 & (CR1_CRCNEXT | CR1_CRCEN)) === (CR1_CRCNEXT | CR1_CRCEN) && !this.crcFrame
    if (this.stopAfterFrame || !(this.cr1 & CR1_SPE)) {
      this.stopAfterFrame = false
      this.releaseAll()
      this.unsubscribe()
      this.applyPins()
      this.update()
      return
    }
    // continuous: the next frame starts right away when data (or the CRC) is waiting
    if (this.txFull || this.rxOnlyMaster() || crcNext) {
      this.shifting = true
      this.masterFrame(c)
      return
    }
    this.update()
  }

  // ================================================================ slave

  private setSelected(sel: boolean): void {
    if (sel === this.selected) return
    this.selected = sel
    if (this.isMaster() || !this.enabled()) return
    if (sel) {
      this.slaveArm()
    } else {
      // deselected: the bit counter restarts with the next selection
      this.shifting = false
      this.bitsIn = this.bitsOut = 0
    }
    this.update()
  }

  /** slave: prepare the next frame and put its first bit on MISO (CPHA = 0) */
  private slaveArm(): void {
    if (this.shiftLoaded) {
      // still holds unsent data (deselected before any edge): keep it, restart the bit count
      this.bitsIn = this.bitsOut = 0
      this.rxShift = 0
    } else this.loadFrame()
    if (!(this.cr1 & CR1_CPHA)) this.outBit(this.now())
  }

  private slaveSck(level: 0 | 1, c: number): void {
    if (this.isMaster() || !this.enabled() || !this.selected) return
    const cpol: 0 | 1 = this.cr1 & CR1_CPOL ? 1 : 0
    const lead = level !== cpol
    const cpha = (this.cr1 & CR1_CPHA) !== 0
    const n = this.nbits()
    if (!this.shifting) {
      if (!lead) return // a trailing edge without a frame in progress (glitch)
      this.shifting = true
      if (cpha && !this.shiftLoaded) this.loadFrame() // data written since the slave was armed
    }
    const sample = cpha ? !lead : lead
    if (sample) {
      this.inBit()
      if (this.bitsIn === n) {
        this.frameReceived()
        if (!cpha) {
          // CPHA = 0: the frame ends with the trailing edge that follows
          this.update()
          return
        }
        this.shifting = false
        this.slaveArm()
      }
    } else {
      if (cpha) this.outBit(c)
      else if (this.bitsIn === n) {
        // trailing edge after the last sample: frame complete, next frame's first bit out
        this.shifting = false
        this.slaveArm()
      } else this.outBit(c)
    }
    this.update()
  }

  // ================================================================ outputs

  private update(): void {
    if (!this.ctx) return
    const sr = this.srValue()
    const c2 = this.cr2
    const irq =
      ((sr & SPI_SR_TXE) !== 0 && (c2 & CR2_TXEIE) !== 0) ||
      ((sr & SPI_SR_RXNE) !== 0 && (c2 & CR2_RXNEIE) !== 0) ||
      ((sr & (SPI_SR_OVR | SPI_SR_MODF | SPI_SR_CRCERR)) !== 0 && (c2 & CR2_ERRIE) !== 0)
    if (irq !== this.irqOn) {
      this.irqOn = irq
      this.ctx.setIrq(this.cfg.irq, irq)
    }
    const dt = (sr & SPI_SR_TXE) !== 0 && (c2 & CR2_TXDMAEN) !== 0 && (this.cr1 & CR1_SPE) !== 0
    if (dt !== this.dmaTxOn) {
      this.dmaTxOn = dt
      this.ctx.dmaRequest(this.cfg.dmaTx, dt)
    }
    const dr = (sr & SPI_SR_RXNE) !== 0 && (c2 & CR2_RXDMAEN) !== 0
    if (dr !== this.dmaRxOn) {
      this.dmaRxOn = dr
      this.ctx.dmaRequest(this.cfg.dmaRx, dr)
    }
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.log('warning', this.name, msg)
  }
}
