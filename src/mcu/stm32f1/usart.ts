/**
 * USART1–3 in asynchronous (UART) mode — RM0008 ch. 27.
 *
 * Registers: SR, DR (TDR/RDR), BRR, CR1, CR2, CR3, GTPR (§27.6).
 * Baud (§27.3.4): Tx/Rx baud = f_PCLK / (16 · USARTDIV), USARTDIV = BRR/16,
 * i.e. one bit lasts exactly BRR PCLK cycles. USART1 is on PCLK2, USART2/3
 * on PCLK1.
 *
 * Transmitter (§27.3.2): TE (with UE) first sends an idle frame (one frame
 * time high), then each DR write moves TDR into the shift register as soon
 * as it is free (TXE = 1 again) and the frame is driven on the TX pin
 * through SocContext.setAfOutput with exact cycle stamps: start bit (0),
 * data LSB first (M = 0: 8 bits, M = 1: 9 bits; with PCE the MSB carries
 * the parity, PS = 0 even / 1 odd), stop bits per CR2.STOP (1, 0.5, 2,
 * 1.5). The frame starts at the DR-write cycle (sub-bit baud-clock phase
 * not modelled). TC is set at the end of the stop bit(s) when TXE = 1; it
 * is cleared by the SR-read → DR-write sequence (or writing 0). SBK sends a
 * break after the current frame: M+10 (10/11) low bit times, then one high
 * bit, SBK cleared at the start of that stop bit (§27.3.2 "Break
 * characters"). UartTap.onTx fires when the stop bit(s) complete.
 *
 * Receiver (§27.3.3): a falling edge on RX starts a frame; each bit is the
 * majority of samples 8, 9, 10 of 16 (§27.3.5, Figure 280 — disagreeing
 * samples set NE). The start bit must sample low (else false start, back to
 * idle). At the first stop bit's sample point (1 stop bit) / its end (2 stop
 * bits) the word goes to RDR: RXNE, FE (stop bit low), PE (parity), NE; if
 * RXNE was still set the word is lost and ORE is set (RDR keeps the old
 * byte). IDLE is set when the line stays high for one frame after a
 * received frame (re-armed only by a new RXNE). PE/FE/NE/ORE/IDLE clear by
 * SR read → DR read; RXNE by DR read or writing 0. After a break / framing
 * error with the line held low, a new start bit needs the line to return
 * high first.
 * UartTap.send() feeds the same receive path, one frame time per byte at
 * the programmed baud (without touching the RX pin). The simulation's UART
 * terminal does NOT use it: its USB-TTL adapter drives the RX pin with real
 * frames (src/sim/coordinator/uart-adapter.ts), so the pin path above is
 * what receives typed bytes; send() stays for direct peripheral tests.
 *
 * Interrupts (IRQ 37/38/39): TXE·TXEIE, TC·TCIE, (RXNE|ORE)·RXNEIE,
 * IDLE·IDLEIE, PE·PEIE, (FE|NE|ORE)·EIE·DMAR. DMA request lines:
 * TXE·DMAT and RXNE·DMAR on the channels of Table 78.
 *
 * Not simulated (logged once, block status 'partial'): synchronous mode
 * (CLKEN / the CK pin), LIN (LINEN, LBD), IrDA (IREN), smartcard (SCEN,
 * NACK, GTPR guard time), half-duplex (HDSEL), RTS/CTS flow control,
 * mute mode / multiprocessor wake-up (RWU, WAKE, ADD). Disabling UE stops
 * the USART immediately (silicon finishes the current byte). Once TE has
 * been set, the TX output idles high whenever no frame is being sent (also
 * after UE/TE are cleared) until a reset or remap; before the first TE the
 * AF pin shows the GPIO AF default (low).
 */
import type { AccessSize, EventHandle } from '../core/types'
import type { UartLineConfig, UartTap } from '../mcu-api'
import type { AfioRemap, RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { APB1, APB2, laneMask, laneShift } from './block'

const PE = 1 << 0
const FE = 1 << 1
const NE = 1 << 2
const ORE = 1 << 3
const IDLE = 1 << 4
const RXNE = 1 << 5
const TC = 1 << 6
const TXE = 1 << 7
const LBD = 1 << 8
const CTS = 1 << 9

const CR1_SBK = 1 << 0
const CR1_RWU = 1 << 1
const CR1_RE = 1 << 2
const CR1_TE = 1 << 3
const CR1_IDLEIE = 1 << 4
const CR1_RXNEIE = 1 << 5
const CR1_TCIE = 1 << 6
const CR1_TXEIE = 1 << 7
const CR1_PEIE = 1 << 8
const CR1_PS = 1 << 9
const CR1_PCE = 1 << 10
const CR1_WAKE = 1 << 11
const CR1_M = 1 << 12
const CR1_UE = 1 << 13
const CR3_EIE = 1 << 0
const CR3_DMAR = 1 << 6
const CR3_DMAT = 1 << 7

const STOP_BITS = [1, 0.5, 2, 1.5] as const

export interface UsartConfig {
  name: 'USART1' | 'USART2' | 'USART3'
  base: number
  gate: RccGate
  irq: number
  /** APB bus clocking the block */
  apb: 1 | 2
  dmaTx: number
  dmaRx: number
  /** TX/RX pin names for the current remap (Table 54–56 / §9.3.8) */
  pins(r: AfioRemap): { tx: string; rx: string }
}

export const USART1_CONFIG: UsartConfig = {
  name: 'USART1',
  base: 0x40013800,
  gate: APB2(14),
  irq: 37,
  apb: 2,
  dmaTx: 4,
  dmaRx: 5,
  pins: (r) => (r.usart1 ? { tx: 'PB6', rx: 'PB7' } : { tx: 'PA9', rx: 'PA10' }),
}
export const USART2_CONFIG: UsartConfig = {
  name: 'USART2',
  base: 0x40004400,
  gate: APB1(17),
  irq: 38,
  apb: 1,
  dmaTx: 7,
  dmaRx: 6,
  pins: (r) => (r.usart2 ? { tx: 'PD5', rx: 'PD6' } : { tx: 'PA2', rx: 'PA3' }),
}
export const USART3_CONFIG: UsartConfig = {
  name: 'USART3',
  base: 0x40004800,
  gate: APB1(18),
  irq: 39,
  apb: 1,
  dmaTx: 2,
  dmaRx: 3,
  pins: (r) => (r.usart3 === 3 ? { tx: 'PD8', rx: 'PD9' } : r.usart3 === 1 ? { tx: 'PC10', rx: 'PC11' } : { tx: 'PB10', rx: 'PB11' }),
}

type RxState = 'idle' | 'frame' | 'waitHigh'

export class Usart implements Stm32Peripheral, UartTap {
  readonly name: string
  readonly base: number
  readonly size = 0x400
  readonly gate: RccGate
  onTx: ((byte: number, cycle: number) => void) | null = null

  private ctx!: SocContext
  // registers
  private sr = TXE | TC
  private rdr = 0
  private tdr = 0
  private tdrFull = false
  private brr = 0
  private cr1 = 0
  private cr2 = 0
  private cr3 = 0
  private gtpr = 0
  /** SR as seen by the last SR read (clear sequences) */
  private srSeen = 0
  // pins
  private txPinName = ''
  private rxPinName = ''
  private txPin = -1
  private rxPin = -1
  // transmitter
  private txOn = false
  /** TX pin claimed as AF output (from the first TE until reset / remap) */
  private txClaimed = false
  private shiftBusy = false
  private txEvents: EventHandle[] = []
  private breakPending = false
  // receiver
  private rxOn = false
  private rxState: RxState = 'idle'
  private rxStart = 0
  private rxEv: EventHandle = 0
  private idleEv: EventHandle = 0
  private idleArmed = false
  private histC: number[] = []
  private histL: number[] = []
  private baseLevel = 1
  private unsubRx: (() => void) | null = null
  private tapQueue: number[] = []
  private tapEv: EventHandle = 0
  private tapNext = 0
  // outputs
  private irqOn = false
  private dmaTxOn = false
  private dmaRxOn = false

  constructor(private cfg: UsartConfig) {
    this.name = cfg.name
    this.base = cfg.base
    this.gate = cfg.gate
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
  }

  // ------------------------------------------------------------ UartTap

  send(bytes: Uint8Array): void {
    if (!this.rxOn) {
      this.ctx.log('warning', this.name, `${bytes.length} byte(s) sent to ${this.name} dropped: the receiver is disabled (UE/RE = 0)`)
      return
    }
    if (this.bitCycles() === 0) {
      this.ctx.log('warning', this.name, `${bytes.length} byte(s) sent to ${this.name} dropped: BRR is not programmed`)
      return
    }
    for (const b of bytes) this.tapQueue.push(b)
    this.pumpTap()
  }

  config(): UartLineConfig {
    const pclk = this.pclk()
    return {
      enabled: (this.cr1 & CR1_UE) !== 0 && (this.cr1 & (CR1_TE | CR1_RE)) !== 0,
      baud: this.brr >= 16 && pclk > 0 ? pclk / this.brr : 0,
      dataBits: this.cr1 & CR1_M ? 9 : 8,
      parity: this.cr1 & CR1_PCE ? (this.cr1 & CR1_PS ? 'odd' : 'even') : 'none',
      stopBits: STOP_BITS[(this.cr2 >>> 12) & 3],
    }
  }

  // ------------------------------------------------------------ bus

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
    return (this.sr & ~TXE) | (this.tdrFull ? 0 : TXE)
  }

  private read32(off: number): number {
    switch (off) {
      case 0x00: {
        const v = this.srValue()
        this.srSeen = v
        return v
      }
      case 0x04: {
        const v = this.rdr & (this.cr1 & CR1_M ? 0x1ff : 0xff)
        // DR read: clears RXNE; with a preceding SR read also PE/FE/NE/ORE/IDLE (§27.6.1)
        this.sr &= ~(RXNE | (this.srSeen & (PE | FE | NE | ORE | IDLE)))
        this.srSeen = 0
        this.update()
        return v
      }
      case 0x08:
        return this.brr
      case 0x0c:
        return this.cr1
      case 0x10:
        return this.cr2
      case 0x14:
        return this.cr3
      case 0x18:
        return this.gtpr
      default:
        return 0
    }
  }

  private write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00: {
        // rc_w0: RXNE, TC, LBD, CTS; everything else read-only
        const clr = ~v & m & (RXNE | TC | LBD | CTS)
        this.sr &= ~clr
        this.update()
        return
      }
      case 0x04:
        if (!(m & 0xff)) return
        this.tdr = v & 0x1ff
        this.tdrFull = true
        if (this.srSeen & TC) this.sr &= ~TC // SR read → DR write clears TC
        this.srSeen = 0
        if (this.txOn && !this.shiftBusy) this.loadShift(this.ctx.clock.cycles)
        this.update()
        return
      case 0x08:
        this.brr = ((this.brr & ~m) | (v & m)) & 0xffff
        if (this.brr !== 0 && this.brr < 16) this.ctx.log('warning', this.name, `BRR = ${this.brr}: USARTDIV must be ≥ 1 (BRR ≥ 16)`)
        return
      case 0x0c: {
        const old = this.cr1
        this.cr1 = ((this.cr1 & ~m) | (v & m)) & 0x3fff
        this.checkModes()
        this.applyEnables()
        if (this.cr1 & CR1_SBK && !(old & CR1_SBK)) this.requestBreak()
        this.update()
        return
      }
      case 0x10:
        this.cr2 = ((this.cr2 & ~m) | (v & m)) & 0x7f6f
        this.checkModes()
        return
      case 0x14:
        this.cr3 = ((this.cr3 & ~m) | (v & m)) & 0x7ff
        this.checkModes()
        this.update()
        return
      case 0x18:
        this.gtpr = ((this.gtpr & ~m) | (v & m)) & 0xffff
        return
    }
  }

  reset(): void {
    this.stopTx()
    if (this.ctx) this.releaseTx()
    this.stopRx()
    this.tapQueue.length = 0
    this.sr = TXE | TC
    this.rdr = this.tdr = 0
    this.tdrFull = false
    this.brr = this.cr1 = this.cr2 = this.cr3 = this.gtpr = 0
    this.srSeen = 0
    this.breakPending = false
    this.update()
  }

  clockEnabled(on: boolean): void {
    if (!on) {
      // a gated USART freezes: frames in flight are lost
      this.stopTx()
      this.stopRx()
    } else this.applyEnables()
  }

  clockChanged(): void {
    // bit times are derived per frame; frames already on the wire keep their timing
  }

  remapChanged(): void {
    const { tx, rx } = this.cfg.pins(this.ctx.remap())
    if (tx === this.txPinName && rx === this.rxPinName) return
    const wasTx = this.txOn
    const wasRx = this.rxOn
    this.stopTx()
    this.releaseTx()
    this.stopRx()
    if (wasTx || wasRx) this.applyEnables()
  }

  // ------------------------------------------------------------ helpers

  private pclk(): number {
    return this.cfg.apb === 2 ? this.ctx.clocks.pclk2() : this.ctx.clocks.pclk1()
  }

  /** core cycles per bit (0 when BRR is unusable) */
  private bitCycles(): number {
    if (this.brr < 16) return 0
    return this.brr * this.ctx.cyclesPerTick(this.pclk())
  }

  private nbits(): number {
    return this.cr1 & CR1_M ? 9 : 8
  }

  private stopBits(): number {
    return STOP_BITS[(this.cr2 >>> 12) & 3]
  }

  private resolvePins(): void {
    const { tx, rx } = this.cfg.pins(this.ctx.remap())
    this.txPinName = tx
    this.rxPinName = rx
    this.txPin = this.ctx.pin(tx)
    this.rxPin = this.ctx.pin(rx)
  }

  private checkModes(): void {
    const un: [boolean, string][] = [
      [(this.cr2 & (1 << 11)) !== 0, 'synchronous mode (CLKEN, CK pin)'],
      [(this.cr2 & (1 << 14)) !== 0, 'LIN mode (LINEN)'],
      [(this.cr3 & (1 << 1)) !== 0, 'IrDA mode (IREN)'],
      [(this.cr3 & (1 << 3)) !== 0, 'half-duplex mode (HDSEL)'],
      [(this.cr3 & (1 << 5)) !== 0, 'smartcard mode (SCEN)'],
      [(this.cr3 & (3 << 8)) !== 0, 'RTS/CTS hardware flow control (RTSE/CTSE)'],
      [(this.cr1 & (CR1_RWU | CR1_WAKE)) !== 0, 'mute mode / multiprocessor wake-up (RWU, WAKE)'],
    ]
    for (const [on, what] of un) {
      if (on) this.ctx.log('warning', this.name, `${what} is not simulated: the USART keeps working as a plain asynchronous UART`)
    }
  }

  private applyEnables(): void {
    const ue = (this.cr1 & CR1_UE) !== 0
    const tx = ue && (this.cr1 & CR1_TE) !== 0
    const rx = ue && (this.cr1 & CR1_RE) !== 0
    if (tx || rx) {
      const prevTx = this.txPinName
      this.resolvePins()
      if (this.txPin < 0 && tx && prevTx !== this.txPinName) {
        this.ctx.log('warning', this.name, `${this.name} TX is mapped to ${this.txPinName}, which is not bonded out on the STM32F103C8 (LQFP48)`)
      }
      if (this.rxPin < 0 && rx) this.ctx.log('warning', this.name, `${this.name} RX is mapped to ${this.rxPinName}, which is not bonded out on the STM32F103C8 (LQFP48)`)
    }
    if (tx && !this.txOn) this.startTx()
    else if (!tx && this.txOn) this.stopTx()
    if (rx && !this.rxOn) this.startRx()
    else if (!rx && this.rxOn) this.stopRx()
  }

  // ------------------------------------------------------------ transmitter

  private startTx(): void {
    this.txOn = true
    const now = this.ctx.clock.cycles
    if (this.txPin >= 0) {
      this.ctx.setAfOutput(this.name, this.txPin, 1, now)
      this.txClaimed = true
    }
    const B = this.bitCycles()
    if (B === 0) {
      this.ctx.log('warning', this.name, `${this.name} transmitter enabled with BRR = ${this.brr}: nothing can be sent until BRR is programmed`)
      return
    }
    // TE → idle frame (preamble) before the first data frame (§27.3.2)
    this.shiftBusy = true
    const end = now + (1 + this.nbits() + this.stopBits()) * B
    this.txEvents.push(this.ctx.scheduler.schedule(end, (c) => this.frameDone(c, null)))
  }

  /**
   * Transmitter off (TE/UE cleared, clock gated): an unfinished frame is cut
   * and the output returns to the idle (high) level. The pin stays claimed —
   * HAL's re-init (UE = 0 … UE = 1) must not produce a phantom start bit.
   */
  private stopTx(): void {
    for (const h of this.txEvents) this.ctx?.scheduler.cancel(h)
    this.txEvents.length = 0
    this.shiftBusy = false
    if (this.txClaimed && this.txPin >= 0) this.ctx.setAfOutput(this.name, this.txPin, 1)
    this.txOn = false
  }

  /** Reset / remap: stop driving the TX pin altogether. */
  private releaseTx(): void {
    if (this.txClaimed && this.txPin >= 0) this.ctx.setAfOutput(this.name, this.txPin, null)
    this.txClaimed = false
  }

  private loadShift(c0: number): void {
    const B = this.bitCycles()
    if (B === 0) return // waits in TDR until BRR is valid and TE is re-enabled
    const word = this.tdr
    this.tdrFull = false
    this.shiftBusy = true
    const n = this.nbits()
    const pce = (this.cr1 & CR1_PCE) !== 0
    let frame = word & ((1 << n) - 1)
    if (pce) {
      const dataBits = n - 1
      let ones = 0
      for (let i = 0; i < dataBits; i++) ones += (frame >>> i) & 1
      const odd = (this.cr1 & CR1_PS) !== 0
      const parity = (ones & 1) ^ (odd ? 1 : 0)
      frame = (frame & ((1 << dataBits) - 1)) | (parity << dataBits)
    }
    const levels = [0]
    for (let i = 0; i < n; i++) levels.push((frame >>> i) & 1)
    const data = pce ? word & ((1 << (n - 1)) - 1) : word & ((1 << n) - 1)
    this.emitFrame(c0, levels, (1 + n + this.stopBits()) * B, B, data)
    this.update()
  }

  /** Schedule the edges of one frame: `levels` per bit slot from c0, then high until `len` cycles. */
  private emitFrame(c0: number, levels: number[], len: number, B: number, data: number | null): void {
    let prev = 1
    const pin = this.txPin
    for (let i = 0; i <= levels.length; i++) {
      const lvl = i < levels.length ? levels[i] : 1 // stop bit(s)
      if (lvl !== prev) {
        const at = c0 + i * B
        const l = lvl as 0 | 1
        if (pin >= 0) this.txEvents.push(this.ctx.scheduler.schedule(at, (c) => this.ctx.setAfOutput(this.name, pin, l, c)))
        prev = lvl
      }
    }
    this.txEvents.push(this.ctx.scheduler.schedule(c0 + len, (c) => this.frameDone(c, data)))
  }

  private frameDone(cycle: number, data: number | null): void {
    this.txEvents.length = 0
    this.shiftBusy = false
    if (data !== null) {
      // a data or break frame completed (idle preambles do not touch TC)
      if (data >= 0) this.onTx?.(data, cycle)
    }
    if (this.breakPending) {
      this.breakPending = false
      this.sendBreak(cycle)
    } else if (this.tdrFull) {
      this.loadShift(cycle)
    } else if (data !== null) {
      this.sr |= TC
    }
    this.update()
  }

  private requestBreak(): void {
    if (!this.txOn) return
    if (this.shiftBusy) this.breakPending = true
    else this.sendBreak(this.ctx.clock.cycles)
  }

  private sendBreak(c0: number): void {
    const B = this.bitCycles()
    if (B === 0) return
    this.shiftBusy = true
    const lowBits = this.nbits() + 2 // 10 (M = 0) or 11 (M = 1) low bit times
    const levels = new Array<number>(lowBits).fill(0)
    // SBK is cleared by hardware during the stop bit of the break
    this.txEvents.push(this.ctx.scheduler.schedule(c0 + lowBits * B, () => (this.cr1 &= ~CR1_SBK)))
    this.emitFrame(c0, levels, (lowBits + 1) * B, B, -1)
  }

  // ------------------------------------------------------------ receiver

  private startRx(): void {
    this.rxOn = true
    this.rxState = 'idle'
    this.histC.length = 0
    this.histL.length = 0
    if (this.rxPin >= 0) {
      this.baseLevel = this.ctx.pinLevel(this.rxPin)
      if (this.baseLevel === 0) this.rxState = 'waitHigh'
      this.unsubRx = this.ctx.onPinInput(this.rxPin, (l, c) => this.rxEdge(l, c))
    }
    this.pumpTap()
  }

  private stopRx(): void {
    this.unsubRx?.()
    this.unsubRx = null
    const s = this.ctx?.scheduler
    if (s) {
      s.cancel(this.rxEv)
      s.cancel(this.idleEv)
      s.cancel(this.tapEv)
    }
    this.rxEv = this.idleEv = this.tapEv = 0
    if (this.rxOn && this.tapQueue.length) {
      this.ctx.log('warning', this.name, `${this.tapQueue.length} queued byte(s) dropped: the receiver was disabled`)
    }
    this.tapQueue.length = 0
    this.rxOn = false
    this.rxState = 'idle'
  }

  private rxEdge(level: 0 | 1, cycle: number): void {
    this.histC.push(cycle)
    this.histL.push(level)
    if (this.histC.length > 256) {
      const drop = this.histC.length - 64
      this.baseLevel = this.histL[drop - 1]
      this.histC.splice(0, drop)
      this.histL.splice(0, drop)
    }
    if (level === 0 && this.rxState === 'idle') this.beginFrame(cycle)
    else if (level === 1 && this.rxState === 'waitHigh') this.rxState = 'idle'
  }

  /** RX line level at `cycle`, from the recorded edge history. */
  private levelAt(cycle: number): number {
    for (let i = this.histC.length - 1; i >= 0; i--) if (this.histC[i] <= cycle) return this.histL[i]
    return this.baseLevel
  }

  /** majority of samples 8, 9, 10 of the 16 per bit (§27.3.5) */
  private sampleBit(bitStart: number, B: number): { v: number; noise: boolean } {
    const a = this.levelAt(bitStart + (B * 8) / 16)
    const b = this.levelAt(bitStart + (B * 9) / 16)
    const c = this.levelAt(bitStart + (B * 10) / 16)
    return { v: a + b + c >= 2 ? 1 : 0, noise: a !== b || b !== c }
  }

  private beginFrame(c0: number): void {
    const B = this.bitCycles()
    if (B === 0) return
    this.ctx.scheduler.cancel(this.idleEv)
    this.idleEv = 0
    this.rxState = 'frame'
    this.rxStart = c0
    // start-bit validation after its sample 10
    this.rxEv = this.ctx.scheduler.schedule(c0 + (B * 10) / 16, () => {
      const s = this.sampleBit(c0, B)
      if (s.v !== 0) {
        // false start: noise pulse shorter than half a bit
        this.rxState = 'idle'
        this.rxEv = 0
        this.restartFromHistory(c0 + (B * 10) / 16)
        return
      }
      const n = this.nbits()
      const stop = this.stopBits()
      const decideAt = stop >= 2 ? c0 + (1 + n + 1) * B : c0 + (1 + n) * B + (B * 10) / 16
      this.rxEv = this.ctx.scheduler.schedule(decideAt, (c) => this.endFrame(c0, B, s.noise, c))
    })
  }

  private restartFromHistory(after: number): void {
    // a falling edge recorded after `after` that is still low now starts the next frame
    for (let i = 0; i < this.histC.length; i++) {
      if (this.histC[i] > after && this.histL[i] === 0) {
        this.beginFrame(this.histC[i])
        return
      }
    }
    if (this.levelAt(this.ctx.clock.cycles) === 0) this.rxState = 'waitHigh'
  }

  private endFrame(c0: number, B: number, startNoise: boolean, cycle: number): void {
    this.rxEv = 0
    const n = this.nbits()
    let word = 0
    let noise = startNoise
    for (let i = 0; i < n; i++) {
      const s = this.sampleBit(c0 + (1 + i) * B, B)
      word |= s.v << i
      noise ||= s.noise
    }
    const st = this.sampleBit(c0 + (1 + n) * B, B)
    noise ||= st.noise
    const fe = st.v === 0
    this.deliver(word, fe, noise, c0 + (1 + n + this.stopBits()) * B)
    // continue: a start bit that already began after the stop sample point, or wait for the line to rise
    const after = c0 + (1 + n) * B + (B * 10) / 16
    this.rxState = 'idle'
    let next = -1
    for (let i = 0; i < this.histC.length; i++) {
      if (this.histC[i] > after && this.histL[i] === 0) {
        next = this.histC[i]
        break
      }
    }
    if (next >= 0) this.beginFrame(next)
    else if (this.levelAt(cycle) === 0) this.rxState = 'waitHigh'
  }

  private pumpTap(): void {
    if (this.tapEv || this.tapQueue.length === 0 || !this.rxOn) return
    const B = this.bitCycles()
    if (B === 0) return
    const n = this.nbits()
    const stop = this.stopBits()
    const start = Math.max(this.ctx.clock.cycles, this.tapNext)
    this.tapNext = start + (1 + n + stop) * B
    const decideAt = stop >= 2 ? start + (1 + n + 1) * B : start + (1 + n) * B + (B * 10) / 16
    this.ctx.scheduler.cancel(this.idleEv)
    this.idleEv = 0
    this.tapEv = this.ctx.scheduler.schedule(decideAt, () => {
      this.tapEv = 0
      if (!this.rxOn) return
      const byte = this.tapQueue.shift() as number
      let word = byte & 0xff
      if (this.cr1 & CR1_PCE) {
        const dataBits = n - 1
        word &= (1 << dataBits) - 1
        let ones = 0
        for (let i = 0; i < dataBits; i++) ones += (word >>> i) & 1
        word |= ((ones & 1) ^ (this.cr1 & CR1_PS ? 1 : 0)) << dataBits
      }
      this.deliver(word, false, false, this.tapNext)
      this.pumpTap()
    })
  }

  /** a complete frame reached the receive shift register */
  private deliver(word: number, fe: boolean, noise: boolean, frameEnd: number): void {
    if (this.sr & RXNE) {
      this.sr |= ORE // RDR keeps the unread byte; this one is lost
    } else {
      this.rdr = word
      let flags = RXNE
      if (fe) flags |= FE
      if (noise) flags |= NE
      if (this.cr1 & CR1_PCE) {
        const n = this.nbits()
        let ones = 0
        for (let i = 0; i < n; i++) ones += (word >>> i) & 1
        const odd = (this.cr1 & CR1_PS) !== 0
        if ((ones & 1) !== (odd ? 1 : 0)) flags |= PE
      }
      this.sr |= flags
    }
    this.idleArmed = true
    this.scheduleIdle(frameEnd)
    this.update()
  }

  private scheduleIdle(frameEnd: number): void {
    const B = this.bitCycles()
    if (B === 0) return
    this.ctx.scheduler.cancel(this.idleEv)
    const at = frameEnd + (1 + this.nbits() + this.stopBits()) * B
    this.idleEv = this.ctx.scheduler.schedule(at, () => {
      this.idleEv = 0
      if (!this.rxOn || !this.idleArmed || this.rxState !== 'idle' || this.tapEv) return
      if (this.rxPin >= 0 && this.levelAt(at) === 0) return
      this.idleArmed = false
      this.sr |= IDLE
      this.update()
    })
  }

  // ------------------------------------------------------------ outputs

  private update(): void {
    if (!this.ctx) return
    const sr = this.srValue()
    const c1 = this.cr1
    const irq =
      ((sr & TXE) !== 0 && (c1 & CR1_TXEIE) !== 0) ||
      ((sr & TC) !== 0 && (c1 & CR1_TCIE) !== 0) ||
      ((sr & (RXNE | ORE)) !== 0 && (c1 & CR1_RXNEIE) !== 0) ||
      ((sr & IDLE) !== 0 && (c1 & CR1_IDLEIE) !== 0) ||
      ((sr & PE) !== 0 && (c1 & CR1_PEIE) !== 0) ||
      ((sr & (FE | NE | ORE)) !== 0 && (this.cr3 & (CR3_EIE | CR3_DMAR)) === (CR3_EIE | CR3_DMAR))
    if (irq !== this.irqOn) {
      this.irqOn = irq
      this.ctx.setIrq(this.cfg.irq, irq)
    }
    const dt = (sr & TXE) !== 0 && (this.cr3 & CR3_DMAT) !== 0
    if (dt !== this.dmaTxOn) {
      this.dmaTxOn = dt
      this.ctx.dmaRequest(this.cfg.dmaTx, dt)
    }
    const dr = (sr & RXNE) !== 0 && (this.cr3 & CR3_DMAR) !== 0
    if (dr !== this.dmaRxOn) {
      this.dmaRxOn = dr
      this.ctx.dmaRequest(this.cfg.dmaRx, dr)
    }
  }
}
