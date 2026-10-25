/**
 * I2C1 / I2C2 — the STM32F1 ("v1") I2C interface, RM0008 ch. 26, simulated
 * BIT-LEVEL on its SCL / SDA pins.
 *
 * Nothing is exchanged with a device "by function call": the block drives
 * its two open-drain alternate-function outputs through
 * SocContext.setAfOutput (0 = pull low, 1 = release) and reads the
 * resolved bus levels through pinLevel / onPinInput. A device answers by
 * pulling the same nets low, so a missing pull-up, swapped lines or a wrong
 * address produce the real symptoms (BUSY stuck, no ACK, HAL timeouts).
 *
 * Registers (§26.6): CR1, CR2, OAR1, OAR2, DR, SR1, SR2, CCR, TRISE.
 *
 * Bus monitor (always running while the block is clocked, also with PE = 0,
 * §26.6.7 BUSY): the effective line levels are the pin inputs ANDed with the
 * block's own open-drain outputs (a line this block pulls low IS low, however
 * late the circuit reports it). SDA falling while SCL is high = START, SDA
 * rising while SCL is high = STOP. BUSY is set whenever SDA or SCL is
 * detected low (also when the monitor starts: clock enable, SWRST release,
 * so lines without pull-ups that never rise keep BUSY set) and cleared by a
 * STOP condition.
 *
 * SCL timing (§26.6.8–9): Sm: Thigh = Tlow = CCR·TPCLK1; Fm DUTY = 0:
 * Thigh = CCR·T, Tlow = 2·CCR·T; DUTY = 1: Thigh = 9·CCR·T, Tlow = 16·CCR·T.
 * The high period counts from the release of SCL; TRISE·TPCLK1 after the
 * release the master checks the SCL PIN: if it is still low (a slave
 * stretches the clock, or nothing pulls the line up) the high counter stops
 * until SCL is actually detected high (§26.3.3 "SCL master clock
 * generation"), so stretching is honoured exactly. SDA is sampled at that
 * high-detection point. Data on SDA changes a quarter of Tlow after SCL
 * falls (data hold; a modelling choice inside the I²C-bus limits: setup
 * time = 3/4·Tlow). START: SDA falls, SCL falls Thigh later (tHD;STA).
 * Repeated START: SDA released, SCL released, Thigh, SDA low, Thigh, SCL
 * low. STOP: SDA low, SCL released, Thigh after SCL is high SDA released.
 * After a STOP a new START waits Tlow (bus free time tBUF).
 *
 * Master (§26.3.3) — the SR1/SR2 event sequence ST's HAL relies on:
 *  EV5  START (when BUSY = 0) → SB, MSL; SCL held low until SR1 read → DR
 *       write (address).
 *  EV6  address ACKed → ADDR (+ TxE when transmitting, TRA from R/W̄);
 *       SCL held low until SR1 read → SR2 read. NACK → AF, no ADDR; SCL
 *       held low until software programs STOP or START.
 *  EV9  10-bit header (OAR1.ADDMODE = 1, byte 11110xx0) → ADD10, then the
 *       second address byte (SR1 read → DR write).
 *  EV8  transmitter: DR moves to the shift register at the start of each
 *       byte (TxE = 1); a DR write while the shift register is idle goes
 *       straight into it (TxE stays 1, §26.6.6 TxE note). Byte ACKed with DR
 *       empty → BTF, SCL held low until DR write / STOP / START. NACK → AF.
 *  EV7  receiver: after the ACK pulse the byte goes to DR (RxNE); if DR is
 *       still full it stays in the shift register (BTF, SCL held low until
 *       DR is read). ACK/NACK of each byte from CR1.ACK; with POS = 1 the
 *       ACK value latched when the byte STARTED controls it (the "next
 *       byte" semantics of the N = 2 procedure, §26.6.1 POS). The 1-, 2-
 *       and N-byte procedures of §26.3.3 therefore work as on silicon.
 *  STOP/START requests act at the end of the current byte, or at once when
 *  the master is holding SCL low between bytes (BTF, AF) or after SB.
 *  Arbitration: a master that releases SDA (sends 1) and samples SDA low
 *  loses the arbitration: ARLO, both lines released, back to slave mode.
 *
 * Slave (§26.3.2): 7-bit OAR1 (+ OAR2 with ENDUAL, general call with ENGC)
 * matched on the address byte after a START → ACK (if CR1.ACK), ADDR,
 * TRA, TxE (transmitter); SCL stretched while ADDR is set, while a
 * transmitter has nothing in DR (EV3-1 / BTF) and while a receiver's DR is
 * still full (BTF); NOSTRETCH = 1 → no stretching, OVR on overrun /
 * underrun. Transmitter: NACK from the master → AF, lines released (STOPF
 * is not set after a NACK). Receiver: STOP after an ACKed byte → STOPF.
 * Misplaced START/STOP inside a byte → BERR.
 *
 * Flag clearing: SB / ADD10 = SR1 read then DR write; ADDR = SR1 read then
 * SR2 read (also when ADDR was set after the SR1 read, §26.6.7 note); STOPF
 * = SR1 read then CR1 write; BTF follows its condition (cleared by the DR
 * access that ends it, or by START/STOP); RxNE by DR read; TxE by DR write;
 * error flags by writing 0. PE = 0 clears every flag and releases the pins.
 *
 * Interrupts: event IRQ (I2C1 31, I2C2 33) = ITEVTEN·(SB|ADDR|ADD10|STOPF|
 * BTF | ITBUFEN·(TxE|RxNE)); error IRQ (32, 34) = ITERREN·(BERR|ARLO|AF|OVR|
 * PECERR|TIMEOUT|SMBALERT) (§26.4, Table 189). DMA (§26.3.7, Table 78):
 * DMAEN·TxE (data phase) on I2C1 ch6 / I2C2 ch4, DMAEN·RxNE on ch7 / ch5.
 * LAST: the DMA controller's EOT_1 (its CNDTR reached 1) makes the next byte
 * a NACK — EOT_1 arrives as the controller's 'DMA1_CH<n>_EOT_1' signal
 * (SocContext.onTrigger, emitted by dma.ts before the transfer's acknowledge).
 *
 * PEC (§26.3.8): the CRC-8 (x⁸+x²+x+1) of every byte on the bus (address
 * included) is computed while ENPEC = 1 and readable in SR2[15:8]; CR1.PEC
 * sends it after the last transmitted byte, or checks the next received
 * byte against it (PECERR, NACK).
 *
 * Not simulated (logged): SMBus mode (SMBUS/SMBTYPE/ENARP/ALERT: no SMBA
 * pin, no 25 ms timeout, no ARP default addresses), 10-bit SLAVE
 * addressing, multi-master clock synchronisation (another master pulling
 * SCL low during our high phase), the analog noise filter. A PE = 0 write
 * takes effect at once (silicon waits for the end of the transfer).
 */
import type { AccessSize, EventHandle } from '../core/types'
import type { AfioRemap, RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { APB1, laneMask, laneShift } from './block'

// ---- CR1 (§26.6.1)
const CR1_PE = 1 << 0
const CR1_SMBUS = 1 << 1
const CR1_SMBTYPE = 1 << 3
const CR1_ENARP = 1 << 4
const CR1_ENPEC = 1 << 5
const CR1_ENGC = 1 << 6
const CR1_NOSTRETCH = 1 << 7
const CR1_START = 1 << 8
const CR1_STOP = 1 << 9
const CR1_ACK = 1 << 10
const CR1_POS = 1 << 11
const CR1_PEC = 1 << 12
const CR1_ALERT = 1 << 13
const CR1_SWRST = 1 << 15
const CR1_MASK = 0xbffb
// ---- CR2 (§26.6.2)
const CR2_FREQ = 0x3f
const CR2_ITERREN = 1 << 8
const CR2_ITEVTEN = 1 << 9
const CR2_ITBUFEN = 1 << 10
const CR2_DMAEN = 1 << 11
const CR2_LAST = 1 << 12
const CR2_MASK = 0x1f3f
// ---- SR1 (§26.6.6)
export const I2C_SR1_SB = 1 << 0
export const I2C_SR1_ADDR = 1 << 1
export const I2C_SR1_BTF = 1 << 2
export const I2C_SR1_ADD10 = 1 << 3
export const I2C_SR1_STOPF = 1 << 4
export const I2C_SR1_RXNE = 1 << 6
export const I2C_SR1_TXE = 1 << 7
export const I2C_SR1_BERR = 1 << 8
export const I2C_SR1_ARLO = 1 << 9
export const I2C_SR1_AF = 1 << 10
export const I2C_SR1_OVR = 1 << 11
export const I2C_SR1_PECERR = 1 << 12
export const I2C_SR1_TIMEOUT = 1 << 14
export const I2C_SR1_SMBALERT = 1 << 15
const SR1_ERRORS = 0xdf00
// ---- SR2 (§26.6.7)
export const I2C_SR2_MSL = 1 << 0
export const I2C_SR2_BUSY = 1 << 1
export const I2C_SR2_TRA = 1 << 2
export const I2C_SR2_GENCALL = 1 << 4
export const I2C_SR2_DUALF = 1 << 7
// ---- CCR (§26.6.8)
const CCR_FS = 1 << 15
const CCR_DUTY = 1 << 14

export interface I2cConfig {
  name: 'I2C1' | 'I2C2'
  base: number
  gate: RccGate
  evIrq: number
  erIrq: number
  dmaTx: number
  dmaRx: number
  /** SCL / SDA / SMBA pin names in the current remap (RM0008 §9.3.9, Table 55) */
  pins(r: AfioRemap): { scl: string; sda: string; smba: string }
}

export const I2C1_CONFIG: I2cConfig = {
  name: 'I2C1',
  base: 0x40005400,
  gate: APB1(21),
  evIrq: 31,
  erIrq: 32,
  dmaTx: 6,
  dmaRx: 7,
  pins: (r) => (r.i2c1 ? { scl: 'PB8', sda: 'PB9', smba: 'PB5' } : { scl: 'PB6', sda: 'PB7', smba: 'PB5' }),
}

export const I2C2_CONFIG: I2cConfig = {
  name: 'I2C2',
  base: 0x40005800,
  gate: APB1(22),
  evIrq: 33,
  erIrq: 34,
  dmaTx: 4,
  dmaRx: 5,
  pins: () => ({ scl: 'PB10', sda: 'PB11', smba: 'PB12' }),
}

/** Support-table notes (peripherals.ts) — what the model does and does not do. */
export const I2C_NOTES =
  'Bit-level I²C on the SCL/SDA pins (open-drain AF outputs, wired-AND with the circuit): START / repeated START / STOP generation and detection, Sm and Fm (DUTY) SCL timing from CCR and PCLK1, clock stretching honoured through the TRISE feedback check, ACK/NACK (AF), arbitration loss (ARLO), BUSY from the line levels (a missing pull-up keeps it set), the SR1/SR2 event sequences and clearing rules ST HAL relies on (EV5–EV9, 1-/2-/N-byte reception with ACK/POS, BTF stretching, 10-bit master addressing), slave mode with 7-bit OAR1/OAR2/general call (ADDR, TxE, RxNE, STOPF, AF, SCL stretching, NOSTRETCH overrun/underrun), BERR, PEC (CRC-8 in SR2, transmission and check), event/error interrupts, DMA request lines and LAST (EOT_1 signalled by the DMA controller). Not simulated (logged): SMBus mode (SMBA pin, timeouts, ARP addresses), 10-bit slave addressing, multi-master clock synchronisation, the analog noise filter; PE = 0 takes effect at once.'

/** CRC-8, polynomial x⁸ + x² + x + 1 (0x07), MSB first (§26.3.8). */
export function pecUpdate(crc: number, byte: number): number {
  let c = (crc ^ byte) & 0xff
  for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
  return c
}

type MPhase =
  | 'idle'
  | 'startWait' // START requested, waiting for the bus to be free
  | 'start' // generating a START
  | 'sb' // EV5: SB = 1, SCL held low
  | 'byte' // clocking a byte
  | 'addrHold' // EV6: ADDR = 1, SCL held low
  | 'add10Hold' // EV9: ADD10 = 1, SCL held low
  | 'txHold' // EV8_1 / BTF (transmitter): SCL held low until DR write / STOP / START
  | 'rxHold' // BTF (receiver): SCL held low until DR read / STOP / START
  | 'afHold' // NACK received: SCL held low until STOP / START
  | 'stop' // generating a STOP
  | 'restart' // generating a repeated START

type SPhase = 'idle' | 'ignore' | 'addr' | 'addrAck' | 'rx' | 'rxAck' | 'tx' | 'txAck' | 'nacked'

type ByteKind = 'addr' | 'addr2' | 'data' | 'pec'

export class I2c implements Stm32Peripheral {
  readonly name: string
  readonly base: number
  readonly size = 0x400
  readonly gate: RccGate

  private ctx!: SocContext
  // ---- registers
  private cr1 = 0
  private cr2 = 0
  private oar1 = 0
  private oar2 = 0
  private ccr = 0
  private trise = 2
  /** SB, ADDR, ADD10, STOPF and the error flags (TxE/RxNE/BTF kept separately) */
  private sr1 = 0
  private txe = false
  private rxne = false
  private btf = false
  private msl = false
  private busy = false
  private tra = false
  private gencall = false
  private dualf = false
  private pec = 0
  /**
   * "SR1 was read" for the three clearing sequences (§26.6.6): SB/ADD10 =
   * SR1 read → DR write (SR2 reads in between allowed, as in ST's SPL EV5
   * check); ADDR = SR1 read → SR2 read (a DR access in between cancels it, so
   * HAL's event IRQ, which reads SR2 before SR1, never clears ADDR early);
   * STOPF = SR1 read → CR1 write.
   */
  private latchSb = false
  private latchAddr = false
  private latchStopf = false
  // ---- data path
  private dr = 0
  /** transmitter: DR holds an unsent byte (TxE = 0) */
  private drFull = false
  private shift = 0
  /** receiver: a received byte waits in the shift register (BTF) */
  private shiftFull = false
  // ---- pins / bus monitor
  private sclPin = -1
  private sdaPin = -1
  private sclName = ''
  private sdaName = ''
  private unsub: (() => void)[] = []
  private claimed = false
  private sclOut: 0 | 1 = 1
  private sdaOut: 0 | 1 = 1
  private sclIn: 0 | 1 = 1
  private sdaIn: 0 | 1 = 1
  private sclBus: 0 | 1 = 1
  private sdaBus: 0 | 1 = 1
  private monitoring = false
  private clocked = false
  // ---- master
  private mphase: MPhase = 'idle'
  private mEv: EventHandle = 0
  private mEv2: EventHandle = 0
  private waitHigh: ((cycle: number) => void) | null = null
  private busFreeAt = 0
  private bitI = 0
  private kind: ByteKind = 'data'
  private out = false
  private outByte = 0
  private inByte = 0
  private ackSeen = false
  private ackAtStart = false
  private nackNext = false
  private pecNow = false
  private sampleCycle = 0
  // ---- slave
  private sphase: SPhase = 'idle'
  private sBits = 0
  private sShift = 0
  private sAcked = false
  private sStretch = false
  private sMasterAck = false
  /** slave transmitter: the shift register holds the byte being sent */
  private sLoaded = false
  private sEv: EventHandle = 0
  /** pending slave SDA change (data hold after SCL falls) */
  private sEvSda: EventHandle = 0
  // ---- outputs
  private evIrqOn = false
  private erIrqOn = false
  private dmaTxOn = false
  private dmaRxOn = false
  /** an RX DMA request of ours awaits its acknowledge (an EOT_1 then belongs to our transfer) */
  private dmaRxPending = false
  private warned = new Set<string>()

  constructor(private cfg: I2cConfig) {
    this.name = cfg.name
    this.base = cfg.base
    this.gate = cfg.gate
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
    this.resolvePins()
    // the RX channel's EOT_1 hardware signal from the DMA controller (§26.3.7)
    ctx.onTrigger?.(`DMA1_CH${this.cfg.dmaRx}_EOT_1`, () => this.dmaEot1())
  }

  // ================================================================ bus access

  read(offset: number, size: AccessSize): number {
    const w = this.read32(offset & ~3)
    if (size === 4) return w >>> 0
    return (w >>> laneShift(offset)) & (size === 2 ? 0xffff : 0xff)
  }

  write(offset: number, value: number, size: AccessSize): void {
    if (size === 4) this.write32(offset & ~3, value >>> 0, 0xffffffff)
    else this.write32(offset & ~3, (value << laneShift(offset)) >>> 0, laneMask(offset, size))
  }

  private sr1Value(): number {
    let v = this.sr1
    if (this.txe) v |= I2C_SR1_TXE
    if (this.rxne) v |= I2C_SR1_RXNE
    if (this.btf) v |= I2C_SR1_BTF
    return v
  }

  private sr2Value(): number {
    let v = (this.pec & 0xff) << 8
    if (this.msl) v |= I2C_SR2_MSL
    if (this.busy) v |= I2C_SR2_BUSY
    if (this.tra) v |= I2C_SR2_TRA
    if (this.gencall) v |= I2C_SR2_GENCALL
    if (this.dualf) v |= I2C_SR2_DUALF
    return v
  }

  private read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.cr1
      case 0x04:
        return this.cr2
      case 0x08:
        return this.oar1
      case 0x0c:
        return this.oar2
      case 0x10:
        return this.readDr()
      case 0x14:
        this.latchSb = this.latchAddr = this.latchStopf = true
        return this.sr1Value()
      case 0x18: {
        const v = this.sr2Value()
        if (this.latchAddr) {
          this.latchAddr = false
          if (this.sr1 & I2C_SR1_ADDR) this.clearAddr()
        }
        return v
      }
      case 0x1c:
        return this.ccr
      case 0x20:
        return this.trise
      default:
        return 0
    }
  }

  private write32(off: number, v: number, m: number): void {
    if (this.cr1 & CR1_SWRST && off !== 0x00) return // under reset: only CR1 (SWRST) is writable
    switch (off) {
      case 0x00:
        this.writeCr1(((this.cr1 & ~m) | (v & m)) & CR1_MASK)
        return
      case 0x04:
        this.cr2 = ((this.cr2 & ~m) | (v & m)) & CR2_MASK
        this.update()
        return
      case 0x08:
        this.oar1 = ((this.oar1 & ~m) | (v & m)) & 0xc3ff
        return
      case 0x0c:
        this.oar2 = ((this.oar2 & ~m) | (v & m)) & 0xff
        return
      case 0x10:
        if (m & 0xff) this.writeDr(v & 0xff)
        return
      case 0x14: {
        // rc_w0: SMBALERT, TIMEOUT, PECERR, OVR, AF, ARLO, BERR
        const clr = ~v & m & SR1_ERRORS
        this.sr1 &= ~clr
        this.update()
        return
      }
      case 0x18:
        return // read-only
      case 0x1c:
        if (this.cr1 & CR1_PE) this.warnOnce('ccr-pe', `${this.name}_CCR written while PE = 1: the CCR register must be configured only when the I2C is disabled (RM0008 §26.6.8)`)
        this.ccr = ((this.ccr & ~m) | (v & m)) & 0xcfff
        return
      case 0x20:
        if (this.cr1 & CR1_PE) this.warnOnce('trise-pe', `${this.name}_TRISE written while PE = 1: TRISE must be configured only when the I2C is disabled (RM0008 §26.6.9)`)
        this.trise = ((this.trise & ~m) | (v & m)) & 0x3f
        return
    }
  }

  reset(): void {
    this.cancelMaster()
    this.cancelSlave()
    this.cr1 = 0
    this.cr2 = 0
    this.oar1 = this.oar2 = 0
    this.ccr = 0
    this.trise = 2
    this.clearState()
    this.busy = false
    this.busFreeAt = 0
    this.dmaRxPending = false
    this.release()
    if (this.ctx) {
      if (this.clocked) this.restartMonitor()
      else this.stopMonitor()
      this.update()
    }
  }

  clockEnabled(on: boolean): void {
    this.clocked = on
    if (!on) {
      // a gated I2C freezes: its timing events stop (a transfer in flight is lost)
      if (this.mphase !== 'idle' || this.sphase !== 'idle') {
        this.warnOnce('gated', `${this.name} clock disabled during a transfer: the transfer is aborted (lines stay as they are)`)
      }
      this.cancelMaster()
      this.cancelSlave()
      this.mphase = 'idle'
      this.sphase = 'idle'
      this.stopMonitor()
    } else {
      this.restartMonitor()
    }
  }

  clockChanged(): void {
    // bit times are derived from PCLK1 at every SCL edge
    if (this.cr1 & CR1_PE) this.checkTiming()
  }

  remapChanged(): void {
    const { scl, sda } = this.cfg.pins(this.ctx.remap())
    if (scl === this.sclName && sda === this.sdaName) return
    const wasClaimed = this.claimed
    this.release()
    this.stopMonitor()
    this.resolvePins()
    if (this.clocked) this.restartMonitor()
    if (wasClaimed) this.claim()
  }

  dmaAck(channel: number): void {
    if (channel === this.cfg.dmaRx) this.dmaRxPending = false
  }

  /**
   * EOT_1 (§26.3.7): the DMA channel just transferred the last-but-one byte
   * of OUR receive transfer (the signal arrives before that transfer's
   * acknowledge) — with LAST set, the next received byte is NACKed. Taken
   * from the DMA controller's signal; nothing reads CNDTR over the bus.
   */
  private dmaEot1(): void {
    if (!this.dmaRxPending || !(this.cr2 & CR2_LAST) || !(this.cr2 & CR2_DMAEN)) return
    this.nackNext = true
  }

  // ================================================================ registers

  private writeCr1(nv: number): void {
    const old = this.cr1
    // STOPF: SR1 read followed by a CR1 write (§26.6.6)
    if (this.latchStopf && this.sr1 & I2C_SR1_STOPF) this.sr1 &= ~I2C_SR1_STOPF
    this.latchStopf = false
    if (nv & CR1_SWRST) {
      if (!(old & CR1_SWRST)) this.softwareReset()
      this.cr1 = CR1_SWRST
      return
    }
    if (old & CR1_SWRST) {
      // leaving software reset: registers keep their reset values, the bus monitor restarts
      this.cr1 = 0
      this.restartMonitor()
      nv &= ~CR1_SWRST
    }
    const pe = (nv & CR1_PE) !== 0
    if (!pe) nv &= ~(CR1_START | CR1_STOP | CR1_ACK | CR1_POS | CR1_PEC | CR1_ALERT)
    if (!(nv & CR1_ENPEC)) nv &= ~CR1_PEC
    this.cr1 = nv
    if (pe && !(old & CR1_PE)) this.enable()
    else if (!pe && old & CR1_PE) this.disable()
    if (pe) {
      this.checkModes(old)
      if (nv & CR1_ENPEC && !(old & CR1_ENPEC)) this.pec = 0
      if (nv & CR1_START && !(old & CR1_START)) this.startRequested()
      if (nv & CR1_STOP && !(old & CR1_STOP)) this.stopRequested()
    }
    this.update()
  }

  private checkModes(old: number): void {
    const now = this.cr1
    const fresh = (bit: number) => (now & bit) !== 0 && (old & bit) === 0
    if (fresh(CR1_SMBUS) || fresh(CR1_SMBTYPE) || fresh(CR1_ENARP)) {
      this.warnOnce('smbus', `SMBus mode (SMBUS/SMBTYPE/ENARP) is not simulated: ${this.name} keeps working as a plain I²C interface (no SMBA pin, no 25 ms timeout, no ARP / host / alert-response addresses)`)
    }
    if (fresh(CR1_ALERT)) this.warnOnce('alert', `${this.name} CR1.ALERT: the SMBA pin is not simulated`)
    if (this.oar1 & 0x8000) this.warnOnce('add10', `${this.name}: 10-bit slave addressing (OAR1.ADDMODE = 1) is not simulated — the slave does not answer 10-bit headers (10-bit MASTER addressing works)`)
  }

  private softwareReset(): void {
    this.cancelMaster()
    this.cancelSlave()
    this.cr2 = 0
    this.oar1 = this.oar2 = 0
    this.ccr = 0
    this.trise = 2
    this.clearState()
    this.busy = false
    this.release()
    this.stopMonitor()
    this.update()
  }

  /** flags and transfer state back to idle (PE = 0, SWRST, reset) */
  private clearState(): void {
    this.sr1 = 0
    this.txe = this.rxne = this.btf = false
    this.msl = this.tra = this.gencall = this.dualf = false
    this.pec = 0
    this.latchSb = this.latchAddr = this.latchStopf = false
    this.dr = 0
    this.drFull = this.shiftFull = false
    this.mphase = 'idle'
    this.sphase = 'idle'
    this.nackNext = false
    this.pecNow = false
    this.sStretch = false
    this.sLoaded = false
    this.waitHigh = null
  }

  private enable(): void {
    this.checkTiming()
    this.claim()
  }

  private disable(): void {
    if (this.mphase !== 'idle' && this.mphase !== 'startWait') {
      this.warnOnce('pe-off', `${this.name}: PE cleared during a transfer — the transfer is abandoned at once (RM0008 §26.6.1: silicon finishes the current communication first)`)
    }
    this.cancelMaster()
    this.cancelSlave()
    const busy = this.busy
    this.clearState()
    this.busy = busy
    this.release()
  }

  private readDr(): number {
    this.latchSb = this.latchAddr = false
    const v = this.dr
    if (this.rxne) {
      if (this.shiftFull) {
        // BTF (receiver): the byte waiting in the shift register moves to DR, RxNE stays set
        this.dr = this.shift
        this.shiftFull = false
        this.btf = false
        if (this.msl && this.mphase === 'rxHold') this.continueRx(this.now())
        else if (this.sphase === 'rx' && this.sStretch) this.slaveUnstretch()
      } else {
        this.rxne = false
      }
    }
    this.update()
    return v
  }

  private writeDr(v: number): void {
    const latch = this.latchSb
    this.latchSb = this.latchAddr = false
    if (this.rxne && !this.tra) {
      // RxNE is also cleared by a DR write (§26.6.6)
      this.rxne = false
    }
    const now = this.now()
    if (this.msl) {
      if (this.mphase === 'sb' && this.sr1 & I2C_SR1_SB) {
        if (!latch) {
          this.warnOnce('ev5', `${this.name}: DR written while SB = 1 without reading SR1 first — EV5 is cleared by SR1 read followed by the DR write (RM0008 §26.3.3); the address is not sent`)
          this.dr = v
          return
        }
        this.sr1 &= ~I2C_SR1_SB
        this.dr = v
        this.startByte(now, 'addr', true, v)
        this.update()
        return
      }
      if (this.mphase === 'add10Hold' && this.sr1 & I2C_SR1_ADD10) {
        if (!latch) {
          this.dr = v
          return
        }
        this.sr1 &= ~I2C_SR1_ADD10
        this.dr = v
        this.startByte(now, 'addr2', true, v)
        this.update()
        return
      }
      if (this.tra && this.mphase === 'txHold') {
        // EV8_1 / BTF: shift register idle — the byte goes straight into it (TxE stays 1)
        this.dr = v
        this.btf = false
        this.txe = true
        this.startByte(now, 'data', true, v)
        this.update()
        return
      }
    } else if (this.sphase === 'tx' && this.sStretch && !this.sLoaded) {
      // slave transmitter waiting for data (EV3-1 / BTF)
      this.dr = v
      this.btf = false
      this.txe = true
      this.slaveLoadAndSend(v)
      this.update()
      return
    }
    this.dr = v
    if (this.tra) {
      this.drFull = true
      this.txe = false
    }
    this.update()
  }

  private clearAddr(): void {
    this.sr1 &= ~I2C_SR1_ADDR
    const now = this.now()
    if (this.msl && this.mphase === 'addrHold') {
      if (this.tra) this.continueTx(now)
      else this.continueRx(now)
    } else if (this.sphase === 'tx' || this.sphase === 'rx') {
      if (this.sphase === 'tx') {
        if (this.sLoaded) this.slaveUnstretchAfterSetup()
        else if (this.drFull) {
          this.drFull = false
          this.txe = true
          this.slaveLoadAndSend(this.dr)
        }
        // else: keep stretching until DR is written (EV3-1)
      } else this.slaveUnstretch()
    }
    this.update()
  }

  // ================================================================ timing

  private now(): number {
    return this.ctx.clock.cycles
  }

  private pclk(): number {
    return this.ctx.clocks.pclk1()
  }

  /** core cycles per PCLK1 cycle */
  private tPclk(): number {
    return this.ctx.cyclesPerTick(this.pclk())
  }

  private ccrValue(): number {
    const c = this.ccr & 0xfff
    const fast = (this.ccr & CCR_FS) !== 0
    const min = fast && this.ccr & CCR_DUTY ? 1 : fast ? 1 : 4
    return Math.max(c, min)
  }

  private tHigh(): number {
    const c = this.ccrValue()
    const fast = (this.ccr & CCR_FS) !== 0
    return (fast && this.ccr & CCR_DUTY ? 9 * c : c) * this.tPclk()
  }

  private tLow(): number {
    const c = this.ccrValue()
    const fast = (this.ccr & CCR_FS) !== 0
    return (fast ? (this.ccr & CCR_DUTY ? 16 * c : 2 * c) : c) * this.tPclk()
  }

  /** SCL feedback-loop check point after the release (TRISE·TPCLK1, §26.6.9) */
  private tRise(): number {
    return Math.min(this.trise * this.tPclk(), this.tHigh())
  }

  /** data hold after SCL falls (a quarter of Tlow, see the header) */
  private tHold(): number {
    return this.tLow() / 4
  }

  private checkTiming(): void {
    const pclk = this.pclk()
    const freq = this.cr2 & CR2_FREQ
    const mhz = pclk / 1e6
    if (freq < 2 || freq > 36) this.warnOnce(`freq-range-${freq}`, `${this.name}_CR2.FREQ = ${freq}: must be the APB1 clock in MHz, 2…36 (RM0008 §26.6.2)`)
    else if (Math.abs(freq - mhz) >= 1) this.warnOnce(`freq-${freq}-${mhz}`, `${this.name}_CR2.FREQ = ${freq} MHz but PCLK1 is ${mhz} MHz: setup/hold times are generated from FREQ, SCL timing from the real PCLK1 (RM0008 §26.6.2)`)
    const c = this.ccr & 0xfff
    const fast = (this.ccr & CCR_FS) !== 0
    if (c < (fast && this.ccr & CCR_DUTY ? 1 : 4)) this.warnOnce(`ccr-min-${this.ccr}`, `${this.name}_CCR = ${c} is below the minimum (0x04, 0x01 in fast duty mode, RM0008 §26.6.8): clamped`)
    if (fast && mhz < 4) this.warnOnce('fm-pclk', `${this.name}: Fm mode needs PCLK1 ≥ 4 MHz (RM0008 §26.3.3)`)
    else if (mhz < 2) this.warnOnce('sm-pclk', `${this.name}: Sm mode needs PCLK1 ≥ 2 MHz (RM0008 §26.3.3)`)
    const fscl = pclk > 0 ? this.ctx.cyclesPerTick(1) / (this.tHigh() + this.tLow()) : 0
    if (fscl > (fast ? 400_000 : 100_000) * 1.001) {
      this.warnOnce(`fscl-${Math.round(fscl)}`, `${this.name}: CCR gives SCL ≈ ${(fscl / 1000).toFixed(1)} kHz, above the ${fast ? '400 kHz Fm' : '100 kHz Sm'} limit of the I²C specification`)
    }
  }

  // ================================================================ pins

  private resolvePins(): void {
    const { scl, sda } = this.cfg.pins(this.ctx.remap())
    this.sclName = scl
    this.sdaName = sda
    this.sclPin = this.ctx.pin(scl)
    this.sdaPin = this.ctx.pin(sda)
  }

  /** PE = 1: the block's open-drain outputs take the pins (released = 1). SCL first, so the rise reads as a STOP. */
  private claim(): void {
    if (this.claimed) return
    this.claimed = true
    this.sclOut = 1
    this.sdaOut = 1
    const now = this.now()
    if (this.sclPin >= 0) this.ctx.setAfOutput(this.name, this.sclPin, 1, now)
    if (this.sdaPin >= 0) this.ctx.setAfOutput(this.name, this.sdaPin, 1, now)
    this.updateBus(now)
  }

  private release(): void {
    this.sclOut = 1
    this.sdaOut = 1
    if (!this.claimed || !this.ctx) return
    this.claimed = false
    if (this.sclPin >= 0) this.ctx.setAfOutput(this.name, this.sclPin, null)
    if (this.sdaPin >= 0) this.ctx.setAfOutput(this.name, this.sdaPin, null)
  }

  private setScl(level: 0 | 1, cycle: number): void {
    if (this.sclOut === level) return
    this.sclOut = level
    if (this.claimed && this.sclPin >= 0) this.ctx.setAfOutput(this.name, this.sclPin, level, cycle)
    this.updateBus(cycle)
  }

  private setSda(level: 0 | 1, cycle: number): void {
    if (this.sdaOut === level) return
    this.sdaOut = level
    if (this.claimed && this.sdaPin >= 0) this.ctx.setAfOutput(this.name, this.sdaPin, level, cycle)
    this.updateBus(cycle)
  }

  /** effective SCL: the pin input ANDed with our own open-drain output */
  private sclLevel(): 0 | 1 {
    return (this.sclIn & this.sclOut) as 0 | 1
  }

  private sdaLevel(): 0 | 1 {
    return (this.sdaIn & this.sdaOut) as 0 | 1
  }

  private stopMonitor(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    this.monitoring = false
  }

  /** (re)start the bus monitor: sample the lines; a line already low means a busy bus (§26.6.7 BUSY) */
  private restartMonitor(): void {
    this.stopMonitor()
    if (!this.ctx) return
    this.monitoring = true
    if (this.sclPin >= 0) {
      this.sclIn = this.ctx.pinLevel(this.sclPin)
      this.unsub.push(
        this.ctx.onPinInput(this.sclPin, (l, c) => {
          this.sclIn = l
          this.updateBus(c)
        }),
      )
    }
    if (this.sdaPin >= 0) {
      this.sdaIn = this.ctx.pinLevel(this.sdaPin)
      this.unsub.push(
        this.ctx.onPinInput(this.sdaPin, (l, c) => {
          this.sdaIn = l
          this.updateBus(c)
        }),
      )
    }
    this.sclBus = this.sclLevel()
    this.sdaBus = this.sdaLevel()
    if (!(this.cr1 & CR1_SWRST) && (!this.sclBus || !this.sdaBus)) this.busy = true
    this.update()
  }

  /** compare the effective line levels with the last seen ones and dispatch the edges */
  private updateBus(cycle: number): void {
    if (!this.monitoring) return
    const scl = this.sclLevel()
    const sda = this.sdaLevel()
    const sclChanged = scl !== this.sclBus
    const sdaChanged = sda !== this.sdaBus
    if (!sclChanged && !sdaChanged) return
    // simultaneous changes: an SDA change paired with an SCL change happens while SCL is low
    if (sclChanged && scl === 0) {
      this.sclBus = 0
      this.onSclFall(cycle)
      if (sdaChanged) {
        this.sdaBus = sda
        this.onSdaEdge(sda, cycle)
      }
    } else {
      if (sdaChanged) {
        this.sdaBus = sda
        this.onSdaEdge(sda, cycle)
      }
      if (sclChanged) {
        this.sclBus = scl
        if (scl) this.onSclRise(cycle)
        else this.onSclFall(cycle)
      }
    }
    if ((!this.sclBus || !this.sdaBus) && !this.busy && !(this.cr1 & CR1_SWRST)) {
      this.busy = true
      this.update()
    }
  }

  private onSdaEdge(level: 0 | 1, cycle: number): void {
    if (this.sclBus !== 1) return
    if (level === 0) this.onStartCondition(cycle)
    else this.onStopCondition(cycle)
  }

  private onStartCondition(cycle: number): void {
    if (this.cr1 & CR1_SWRST) return
    this.busy = true
    const ours = this.mphase === 'start' || this.mphase === 'restart'
    if (this.msl && !ours && this.mphase === 'byte') {
      // a START inside our byte (another device): bus error, transfer state unchanged (§26.3.4)
      this.sr1 |= I2C_SR1_BERR
    }
    if (this.cr1 & CR1_PE && !ours && !this.msl) this.slaveStart()
    this.update()
  }

  private onStopCondition(cycle: number): void {
    if (this.cr1 & CR1_SWRST) return
    this.busy = false
    this.busFreeAt = cycle + this.tLow()
    if (this.cr1 & CR1_STOP && (!this.msl || this.mphase === 'stop')) this.cr1 &= ~CR1_STOP // cleared by hardware when a STOP is detected
    if (this.msl) {
      // our own STOP ends master mode; a misplaced STOP from another device is a bus
      // error and "the state of the current transmission is not affected" (§26.3.4)
      if (this.mphase === 'stop') this.masterDone()
      else this.sr1 |= I2C_SR1_BERR
    } else if (this.cr1 & CR1_PE) this.slaveStop()
    if (this.mphase === 'startWait') this.scheduleStart(this.busFreeAt)
    this.update()
  }

  private onSclRise(cycle: number): void {
    if (this.waitHigh) {
      const fn = this.waitHigh
      this.waitHigh = null
      fn(cycle)
    }
    if (this.sphase !== 'idle' && this.sphase !== 'ignore' && !this.msl) this.slaveSclRise()
  }

  private onSclFall(cycle: number): void {
    if (this.sphase !== 'idle' && this.sphase !== 'ignore' && !this.msl) this.slaveSclFall(cycle)
  }

  // ================================================================ master

  private cancelMaster(): void {
    const s = this.ctx?.scheduler
    if (s) {
      if (this.mEv) s.cancel(this.mEv)
      if (this.mEv2) s.cancel(this.mEv2)
    }
    this.mEv = this.mEv2 = 0
    this.waitHigh = null
  }

  /** the master's next timing step (replaces a pending one) */
  private at(cycle: number, fn: (c: number) => void): void {
    if (this.mEv) this.ctx.scheduler.cancel(this.mEv)
    const h = this.ctx.scheduler.schedule(cycle, (c) => {
      if (this.mEv === h) this.mEv = 0
      fn(c)
    })
    this.mEv = h
  }

  /** secondary event (an SDA change scheduled alongside the main step) */
  private at2(cycle: number, fn: (c: number) => void): void {
    if (this.mEv2) this.ctx.scheduler.cancel(this.mEv2)
    const h = this.ctx.scheduler.schedule(cycle, (c) => {
      if (this.mEv2 === h) this.mEv2 = 0
      fn(c)
    })
    this.mEv2 = h
  }

  private startRequested(): void {
    if (this.msl) {
      // repeated START at the end of the current byte, or now if holding the bus between bytes
      if (this.mphase === 'txHold' || this.mphase === 'rxHold' || this.mphase === 'afHold') {
        this.btf = false
        this.genRestart(this.now())
      }
      return
    }
    if (this.mphase !== 'idle') return
    if (this.busy) {
      this.mphase = 'startWait'
      return
    }
    this.scheduleStart(Math.max(this.now(), this.busFreeAt))
  }

  private scheduleStart(at: number): void {
    this.mphase = 'start'
    this.cancelMaster()
    this.at(Math.max(at, this.now()), (c) => this.genStart(c))
  }

  private stopRequested(): void {
    if (this.msl) {
      switch (this.mphase) {
        case 'txHold':
        case 'rxHold':
        case 'afHold':
        case 'sb':
          this.btf = false
          this.sr1 &= ~I2C_SR1_SB
          this.genStop(this.now())
          return
        default:
          return // at the end of the current byte / after ADDR is cleared / after the START
      }
    }
    if (this.mphase === 'startWait' || this.mphase === 'start') return // handled when the START completes
    if (this.sphase !== 'idle' && this.sphase !== 'ignore') {
      // slave: release SCL and SDA after the current byte (§26.6.1 STOP, slave mode)
      return
    }
  }

  /** START from an idle bus: SDA low, Thigh later SCL low → SB (EV5) */
  private genStart(c: number): void {
    if (!(this.cr1 & CR1_PE) || !(this.cr1 & CR1_START)) {
      this.mphase = 'idle'
      return
    }
    if (this.busy || this.sclLevel() === 0 || this.sdaLevel() === 0) {
      // someone else took the bus (or a line is held low): wait for a STOP
      this.mphase = 'startWait'
      this.busy = true
      this.update()
      return
    }
    this.mphase = 'start'
    this.setSda(0, c)
    this.at(c + this.tHigh(), (c2) => {
      this.setScl(0, c2)
      this.startDone(c2)
    })
  }

  private startDone(c: number): void {
    this.cr1 &= ~CR1_START
    this.msl = true
    this.tra = false
    this.txe = false
    this.btf = false
    this.drFull = false
    this.sr1 |= I2C_SR1_SB
    this.mphase = 'sb'
    if (this.cr1 & CR1_ENPEC) this.pec = 0
    this.update()
    if (this.cr1 & CR1_STOP) {
      // STOP programmed during the START: "after the current Start condition is sent"
      this.sr1 &= ~I2C_SR1_SB
      this.genStop(c)
    }
  }

  /** repeated START from SCL low: SDA released, SCL released (stretch-aware), Thigh, SDA low, Thigh, SCL low */
  private genRestart(c: number): void {
    this.mphase = 'restart'
    this.cancelMaster()
    this.at2(c + this.tHold(), (c1) => this.setSda(1, c1))
    this.at(c + this.tLow(), (c1) =>
      this.releaseScl(c1, (hi) => {
        this.at(hi, (c3) => {
          if (this.sdaLevel() === 0) {
            // SDA held low by someone else: cannot generate the START (arbitration lost)
            this.arbitrationLost(c3)
            return
          }
          this.setSda(0, c3)
          this.at(c3 + this.tHigh(), (c4) => {
            this.setScl(0, c4)
            this.startDone(c4)
          })
        })
      }),
    )
  }

  /** STOP from SCL low: SDA low, SCL released (stretch-aware), Thigh later SDA released */
  private genStop(c: number): void {
    this.mphase = 'stop'
    this.cancelMaster()
    this.at2(c + this.tHold(), (c1) => this.setSda(0, c1))
    this.at(c + this.tLow(), (c1) =>
      this.releaseScl(c1, (hi) => {
        this.at(hi, (c3) => {
          this.setSda(1, c3)
          // the monitor sees the STOP (SDA rising with SCL high) → masterDone; if SDA
          // stays low (held by another device) the bus remains busy
        })
      }),
    )
  }

  private masterDone(): void {
    this.cancelMaster()
    this.msl = false
    this.tra = false
    this.txe = false
    this.btf = false
    this.drFull = false
    this.sr1 &= ~(I2C_SR1_SB | I2C_SR1_ADDR | I2C_SR1_ADD10)
    this.cr1 &= ~(CR1_STOP | CR1_PEC)
    this.mphase = 'idle'
    if (this.cr1 & CR1_START && this.cr1 & CR1_PE) {
      // a START requested meanwhile waits for the bus-free time
      this.mphase = 'startWait'
    }
  }

  /**
   * Release SCL at `c`, then (stretch-aware, §26.3.3) call `high(fallAt)` with
   * the cycle at which the high period ends: TRISE·TPCLK1 after the release
   * the SCL pin is checked; if low, the high counter waits for the pin to rise.
   */
  private releaseScl(c: number, high: (fallAt: number) => void): void {
    this.setScl(1, c)
    const tr = this.tRise()
    const th = this.tHigh()
    const check = (c2: number) => {
      if (this.sclLevel() === 1) {
        this.sampleCycle = c2
        high(c + th)
      } else {
        // clock stretching (or no pull-up): the high counter stops until SCL is seen high
        this.waitHigh = (c3) => {
          this.sampleCycle = c3
          high(c3 + (th - tr))
        }
      }
    }
    if (tr <= 0) check(c)
    else this.at(c + tr, check)
  }

  /** start clocking a byte at `c` (SCL low): address / data out, or data in */
  private startByte(c: number, kind: ByteKind, out: boolean, value: number): void {
    this.mphase = 'byte'
    this.kind = kind
    this.out = out
    this.outByte = value & 0xff
    this.inByte = 0
    this.bitI = 0
    this.ackSeen = false
    this.ackAtStart = (this.cr1 & CR1_ACK) !== 0
    // POS = 1: a PEC bit set before the byte starts marks THIS byte as the PEC (§26.6.1)
    this.pecNow = !out && (this.cr1 & CR1_PEC) !== 0 && (this.cr1 & CR1_POS) !== 0
    if (out && this.cr1 & CR1_ENPEC && kind !== 'pec') this.pec = pecUpdate(this.pec, value)
    this.clockBit(c)
  }

  /** one SCL clock of the current byte, from the SCL falling edge at `tf` */
  private clockBit(tf: number): void {
    const i = this.bitI
    let sda: 0 | 1
    if (this.out) sda = i < 8 ? (((this.outByte >>> (7 - i)) & 1) as 0 | 1) : 1
    else if (i < 8) sda = 1
    else sda = this.ackDecision() ? 0 : 1
    this.at2(tf + this.tHold(), (c) => this.setSda(sda, c))
    this.at(tf + this.tLow(), (c) =>
      this.releaseScl(c, (fallAt) => {
        this.sampleBit(i, sda)
        if (this.mphase !== 'byte') return // arbitration lost
        this.at(fallAt, (c2) => {
          this.setScl(0, c2)
          this.bitI++
          if (this.bitI <= 8) this.clockBit(c2)
          else this.byteEnd(c2)
        })
      }),
    )
  }

  /** receiver: ACK (true) or NACK for the byte just clocked in */
  private ackDecision(): boolean {
    // POS = 0: PEC set (after the last data byte's RxNE) marks the byte in the shift register
    if (!this.pecNow && this.cr1 & CR1_PEC && this.cr1 & CR1_ENPEC && !(this.cr1 & CR1_POS)) this.pecNow = true
    if (this.nackNext) {
      this.nackNext = false
      return false
    }
    if (this.pecNow) {
      // PEC check: NACK when the received PEC byte does not match (§26.3.8)
      const ok = this.inByte === this.pec
      if (!ok) this.sr1 |= I2C_SR1_PECERR
      return ok && (this.cr1 & CR1_ACK) !== 0
    }
    if (this.cr1 & CR1_POS) return this.ackAtStart
    return (this.cr1 & CR1_ACK) !== 0
  }

  private sampleBit(i: number, sent: 0 | 1): void {
    const sda = this.sdaLevel()
    if (this.out) {
      if (i < 8) {
        if (sent === 1 && sda === 0) this.arbitrationLost(this.sampleCycle)
      } else this.ackSeen = sda === 0
    } else if (i < 8) {
      this.inByte = ((this.inByte << 1) | sda) & 0xff
    }
  }

  private arbitrationLost(c: number): void {
    this.cancelMaster()
    this.sr1 |= I2C_SR1_ARLO
    this.msl = false
    this.tra = false
    this.txe = false
    this.btf = false
    this.cr1 &= ~(CR1_START | CR1_STOP)
    this.mphase = 'idle'
    // lines released by hardware (§26.3.5)
    this.setSda(1, c)
    this.setScl(1, c)
    this.update()
  }

  private byteEnd(c: number): void {
    switch (this.kind) {
      case 'addr':
      case 'addr2': {
        if (!this.ackSeen) {
          this.sr1 |= I2C_SR1_AF
          this.mphase = 'afHold'
          this.update()
          if (this.cr1 & CR1_STOP) this.genStop(c)
          else if (this.cr1 & CR1_START) this.genRestart(c)
          return
        }
        const a = this.outByte
        const header10 = (a & 0xf8) === 0xf0 && (this.oar1 & 0x8000) !== 0
        if (this.kind === 'addr' && header10 && (a & 1) === 0) {
          this.sr1 |= I2C_SR1_ADD10
          this.mphase = 'add10Hold'
          this.update()
          return
        }
        this.tra = this.kind === 'addr2' ? true : (a & 1) === 0
        this.sr1 |= I2C_SR1_ADDR
        if (this.tra) {
          this.txe = !this.drFull
        }
        this.mphase = 'addrHold'
        this.update()
        return
      }
      case 'pec':
      case 'data': {
        if (this.out) {
          if (this.kind === 'pec') this.cr1 &= ~CR1_PEC
          if (!this.ackSeen) {
            this.sr1 |= I2C_SR1_AF
            this.mphase = 'afHold'
            this.update()
            if (this.cr1 & CR1_STOP) this.genStop(c)
            else if (this.cr1 & CR1_START) this.genRestart(c)
            return
          }
          this.continueTx(c)
          return
        }
        // receiver: the master drove the ACK bit; release SDA after the hold time
        this.at2(c + this.tHold(), (c1) => this.setSda(1, c1))
        if (this.cr1 & CR1_ENPEC && !this.pecNow) this.pec = pecUpdate(this.pec, this.inByte)
        if (this.pecNow) this.cr1 &= ~CR1_PEC
        if (!this.rxne) {
          this.dr = this.inByte
          this.rxne = true
          this.continueRx(c)
        } else {
          this.shift = this.inByte
          this.shiftFull = true
          this.btf = true
          this.mphase = 'rxHold'
          this.update()
          if (this.cr1 & CR1_STOP) this.genStop(c)
          else if (this.cr1 & CR1_START) this.genRestart(c)
        }
        return
      }
    }
  }

  /** transmitter between bytes (SCL low at `c`) */
  private continueTx(c: number): void {
    if (this.cr1 & CR1_STOP) {
      this.txe = false
      this.btf = false
      this.genStop(c)
    } else if (this.cr1 & CR1_START) {
      this.txe = false
      this.btf = false
      this.genRestart(c)
    } else if (this.drFull) {
      this.drFull = false
      this.txe = true
      this.startByte(c, 'data', true, this.dr)
    } else if (this.cr1 & CR1_PEC && this.cr1 & CR1_ENPEC) {
      this.startByte(c, 'pec', true, this.pec)
    } else {
      this.txe = true
      // BTF only after a data byte (EV8_2), not right after ADDR (EV8_1)
      this.btf = this.kind === 'data' || this.kind === 'pec'
      this.mphase = 'txHold'
    }
    this.update()
  }

  /** receiver between bytes (SCL low at `c`) */
  private continueRx(c: number): void {
    if (this.cr1 & CR1_STOP) this.genStop(c)
    else if (this.cr1 & CR1_START) this.genRestart(c)
    else this.startByte(c, 'data', false, 0)
    this.update()
  }

  // ================================================================ slave

  private cancelSlave(): void {
    if (this.sEv && this.ctx) this.ctx.scheduler.cancel(this.sEv)
    if (this.sEvSda && this.ctx) this.ctx.scheduler.cancel(this.sEvSda)
    this.sEv = 0
    this.sEvSda = 0
    if (this.sStretch && this.ctx) {
      this.sStretch = false
      this.setScl(1, this.now())
    }
  }

  private slaveStart(): void {
    if (this.sphase !== 'idle' && this.sphase !== 'ignore' && this.sphase !== 'nacked') {
      if (this.sBits > 0 && this.sBits < 8) this.sr1 |= I2C_SR1_BERR // misplaced START inside a byte
      // repeated START: release what we drive, flags of the previous address are cleared
      this.cancelSlave()
      this.setSda(1, this.now())
    }
    this.tra = false
    this.dualf = false
    this.gencall = false
    this.sphase = 'addr'
    this.sBits = 0
    this.sShift = 0
    this.sAcked = false
    this.sLoaded = false
  }

  private slaveStop(): void {
    const active = this.sphase !== 'idle' && this.sphase !== 'ignore'
    if (active && this.sphase !== 'addr') {
      if (this.sBits > 0 && this.sBits < 8 && this.sphase !== 'nacked') this.sr1 |= I2C_SR1_BERR
      // STOPF after an acknowledged byte, not after a NACK (§26.6.6)
      if (this.sAcked && this.sphase !== 'nacked') this.sr1 |= I2C_SR1_STOPF
    }
    this.cancelSlave()
    if (this.sdaOut === 0) this.setSda(1, this.now())
    this.tra = false
    this.dualf = false
    this.gencall = false
    this.txe = false
    this.sphase = 'idle'
    this.sBits = 0
    this.sLoaded = false
  }

  private slaveSclRise(): void {
    const sda = this.sdaLevel()
    switch (this.sphase) {
      case 'addr':
      case 'rx':
        if (this.sBits < 8) {
          this.sShift = ((this.sShift << 1) | sda) & 0xff
          this.sBits++
        }
        return
      case 'txAck':
        this.sMasterAck = sda === 0
        return
      default:
        return
    }
  }

  private slaveSclFall(c: number): void {
    switch (this.sphase) {
      case 'addr': {
        if (this.sBits < 8) return
        const b = this.sShift
        const a7 = b >>> 1
        let match = false
        this.dualf = false
        this.gencall = false
        if (!(this.oar1 & 0x8000) && a7 === ((this.oar1 >>> 1) & 0x7f)) match = true
        else if (this.oar2 & 1 && a7 === ((this.oar2 >>> 1) & 0x7f)) {
          match = true
          this.dualf = true
        } else if (b === 0 && this.cr1 & CR1_ENGC) {
          match = true
          this.gencall = true
        }
        if (!match || !(this.cr1 & CR1_ACK)) {
          this.dualf = this.gencall = false
          this.sphase = 'ignore'
          return
        }
        this.tra = (b & 1) === 1 && !this.gencall
        if (this.cr1 & CR1_ENPEC) this.pec = pecUpdate(0, b)
        this.slaveSda(0, c) // ACK
        this.sphase = 'addrAck'
        return
      }
      case 'addrAck': {
        this.slaveSda(1, c)
        this.sAcked = true
        this.sr1 |= I2C_SR1_ADDR
        this.sBits = 0
        this.sShift = 0
        if (this.tra) {
          this.sphase = 'tx'
          this.txe = !this.drFull
        } else this.sphase = 'rx'
        if (!(this.cr1 & CR1_NOSTRETCH)) this.slaveStretch(c)
        else if (this.tra) this.slaveLoadAndSend(this.dr) // no stretching: whatever DR holds goes out
        this.update()
        return
      }
      case 'rx': {
        if (this.sBits < 8) return
        const byte = this.sShift
        let ack = (this.cr1 & CR1_ACK) !== 0
        if (this.cr1 & CR1_PEC && this.cr1 & CR1_ENPEC) {
          if (byte !== this.pec) {
            this.sr1 |= I2C_SR1_PECERR
            ack = false
          }
          this.cr1 &= ~CR1_PEC
        } else if (this.cr1 & CR1_ENPEC) this.pec = pecUpdate(this.pec, byte)
        if (ack) this.slaveSda(0, c)
        this.sAcked = ack
        this.sphase = 'rxAck'
        return
      }
      case 'rxAck': {
        this.slaveSda(1, c)
        const byte = this.sShift
        this.sBits = 0
        this.sShift = 0
        this.sphase = 'rx'
        if (this.cr1 & CR1_STOP) {
          // slave STOP request: release the lines after the current byte
          this.cr1 &= ~CR1_STOP
          this.sphase = 'ignore'
        }
        if (!this.rxne) {
          this.dr = byte
          this.rxne = true
        } else if (this.cr1 & CR1_NOSTRETCH) {
          this.sr1 |= I2C_SR1_OVR // overrun: the new byte is lost
        } else {
          this.shift = byte
          this.shiftFull = true
          this.btf = true
          this.slaveStretch(c)
        }
        this.update()
        return
      }
      case 'tx': {
        // next data bit on SDA (bits 6..0 after the first, which went out when the byte was loaded)
        if (this.sBits < 8) {
          const bit = ((this.sShift >>> (7 - this.sBits)) & 1) as 0 | 1
          this.slaveSda(bit, c)
          this.sBits++
          return
        }
        // after the 8th bit: release SDA for the master's ACK
        this.slaveSda(1, c)
        this.sLoaded = false
        this.sphase = 'txAck'
        return
      }
      case 'txAck': {
        if (!this.sMasterAck) {
          // NACK: AF, lines released (§26.3.4); STOPF will not be set
          this.sr1 |= I2C_SR1_AF
          this.sAcked = false
          this.txe = false
          this.sphase = 'nacked'
          this.update()
          return
        }
        this.sAcked = true
        this.sphase = 'tx'
        this.sBits = 0
        if (this.cr1 & CR1_STOP) {
          this.cr1 &= ~CR1_STOP
          this.sphase = 'ignore'
          this.update()
          return
        }
        if (this.drFull) {
          this.drFull = false
          this.txe = true
          this.slaveLoadAndSend(this.dr, c)
        } else if (this.cr1 & CR1_NOSTRETCH) {
          this.sr1 |= I2C_SR1_OVR // underrun: the same DR byte is sent again
          this.slaveLoadAndSend(this.dr, c)
        } else {
          this.btf = true
          this.txe = true
          this.slaveStretch(c)
        }
        this.update()
        return
      }
      default:
        return
    }
  }

  /** slave transmitter: load the shift register and put its first bit on SDA (SCL is low) */
  private slaveLoadAndSend(v: number, c = this.now()): void {
    this.sShift = v & 0xff
    this.sLoaded = true
    if (this.cr1 & CR1_ENPEC) this.pec = pecUpdate(this.pec, v)
    this.slaveSda(((this.sShift >>> 7) & 1) as 0 | 1, c)
    this.sBits = 1
    if (this.sStretch && !(this.sr1 & I2C_SR1_ADDR)) this.slaveUnstretchAfterSetup(c)
  }

  /** data setup before the master may clock it: release SCL after the SDA change */
  private slaveUnstretchAfterSetup(c = this.now()): void {
    if (!this.sStretch) return
    if (this.sEv) this.ctx.scheduler.cancel(this.sEv)
    const h = this.ctx.scheduler.schedule(c + 2 * this.slaveHold(), (c1) => {
      if (this.sEv === h) this.sEv = 0
      this.sStretch = false
      this.setScl(1, c1)
    })
    this.sEv = h
  }

  /**
   * Slave data hold: SDA changes 4 PCLK1 cycles after the SCL falling edge
   * (the FREQ-derived hold of §26.6.2), never inside the falling edge itself —
   * every other device on the bus has seen SCL low before SDA moves.
   */
  private slaveHold(): number {
    return 4 * this.tPclk()
  }

  private slaveSda(level: 0 | 1, c: number): void {
    if (this.sEvSda) this.ctx.scheduler.cancel(this.sEvSda)
    const h = this.ctx.scheduler.schedule(c + this.slaveHold(), (c1) => {
      if (this.sEvSda === h) this.sEvSda = 0
      this.setSda(level, c1)
    })
    this.sEvSda = h
  }

  private slaveStretch(c: number): void {
    this.sStretch = true
    this.setScl(0, c)
  }

  private slaveUnstretch(): void {
    if (!this.sStretch) return
    if (this.sr1 & I2C_SR1_ADDR) return // EV1 still pending
    this.sStretch = false
    this.setScl(1, this.now())
  }

  // ================================================================ outputs

  private update(): void {
    if (!this.ctx) return
    const sr1 = this.sr1Value()
    const c2 = this.cr2
    const ev =
      (c2 & CR2_ITEVTEN) !== 0 &&
      ((sr1 & (I2C_SR1_SB | I2C_SR1_ADDR | I2C_SR1_ADD10 | I2C_SR1_STOPF | I2C_SR1_BTF)) !== 0 ||
        ((c2 & CR2_ITBUFEN) !== 0 && (sr1 & (I2C_SR1_TXE | I2C_SR1_RXNE)) !== 0))
    const er = (c2 & CR2_ITERREN) !== 0 && (sr1 & SR1_ERRORS) !== 0
    if (ev !== this.evIrqOn) {
      this.evIrqOn = ev
      this.ctx.setIrq(this.cfg.evIrq, ev)
    }
    if (er !== this.erIrqOn) {
      this.erIrqOn = er
      this.ctx.setIrq(this.cfg.erIrq, er)
    }
    const dma = (c2 & CR2_DMAEN) !== 0
    // DMA requests only for data transfers (§26.3.7): not while ADDR is pending
    const dt = dma && this.txe && this.tra && (sr1 & I2C_SR1_ADDR) === 0
    const dr = dma && this.rxne
    if (dt !== this.dmaTxOn) {
      this.dmaTxOn = dt
      this.ctx.dmaRequest(this.cfg.dmaTx, dt)
    }
    if (dr !== this.dmaRxOn) {
      this.dmaRxOn = dr
      if (dr) this.dmaRxPending = true // until the DMA acknowledges the transfer
      this.ctx.dmaRequest(this.cfg.dmaRx, dr)
    }
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.log('warning', this.name, msg)
  }

  // ================================================================ inspection (tests / UI)

  /** current master / slave phase (tests, debugger views) */
  get state(): { master: string; slave: string; busy: boolean } {
    return { master: this.mphase, slave: this.sphase, busy: this.busy }
  }
}
