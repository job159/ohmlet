/**
 * DMA1 — the 7-channel DMA controller of RM0008 ch. 13 (registers §13.4).
 *
 * Registers: ISR (GIFx/TCIFx/HTIFx/TEIFx, read-only), IFCR (write 1 to
 * clear; CGIFx clears all four flags of the channel), per channel CCRx (EN,
 * TCIE, HTIE, TEIE, DIR, CIRC, PINC, MINC, PSIZE, MSIZE, PL, MEM2MEM),
 * CNDTRx (writable only while EN = 0, then the live remaining count),
 * CPARx, CMARx. GIFx is set with any of TC/HT/TE and cleared only by CGIFx.
 *
 * Requests (§13.3.7, Table 78): peripherals raise their request through
 * SocContext.dmaRequest; the SoC ORs every requester of a channel and calls
 * `dmaRequestChanged` here. A channel is ready when EN = 1, CNDTR ≠ 0 and
 * its request line is high — or MEM2MEM = 1 (memory-to-memory: transfers
 * start as soon as the channel is enabled, §13.3.3). Requests are LEVELS:
 * a peripheral drops its request through the bus access itself (reading
 * USART_DR clears RXNE, reading ADC_DR clears the ADC request, writing
 * USART_DR clears TXE); after every peripheral-triggered transfer (CNDTR
 * already decremented) the SoC is told (`ctx.dmaServed`) and acknowledges
 * the peripheral(s) that requested it — also one whose request the access
 * itself dropped — so held requests (timers) are released in `dmaAck`
 * (the acknowledge of §13.3.1). Just before that acknowledge the channel's
 * end-of-transfer signals go out through ctx.emitTrigger: 'DMA1_CH<n>_EOT_1'
 * when the transfer left CNDTR = 1 and 'DMA1_CH<n>_EOT' when it left 0
 * (RM0008 §26.3.7 — the I2C LAST/NACK logic listens to EOT_1).
 *
 * Arbitration (§13.3.2): one transfer at a time; among the ready channels
 * the highest PL wins, equal PL → the lower channel number. The decision is
 * re-taken after every single transfer, so a higher-priority request waits
 * at most for the transfer in progress.
 *
 * One transfer = read of PSIZE/MSIZE bytes at the current source address,
 * write at the current destination (DIR = 0: peripheral → memory, 1:
 * memory → peripheral; mem2mem uses CPAR as the "peripheral" side), with
 * Table 76 packing: a narrower source is zero-extended, a wider one
 * truncated to the destination width. Addresses are forced to the data size
 * (PA[0] / PA[1:0] ignored, §13.4.5–6). Byte / half-word WRITES to an APB
 * peripheral are presented to the bridge as 32-bit writes with the data
 * replicated on every lane (§13.3.5 — e.g. a byte 0xB0 becomes 0xB0B0B0B0).
 * Pointers post-increment by their own size when PINC / MINC; CNDTR
 * decrements; HTIF is set when CNDTR reaches ⌊N/2⌋ (N = programmed count,
 * so N = 1 sets HT and TC together), TCIF at 0. CIRC reloads CNDTR and both
 * pointers (§13.3.3); otherwise the channel stays enabled but idle until
 * software disables it and reprograms CNDTR. A BusFault on either access
 * (reserved address, read-only memory, unaligned peripheral access) sets
 * TEIF and clears EN (§13.3.5 "Error management").
 *
 * Interrupts: channel x → IRQ 10 + x (DMA1_Channel1..7 = IRQ 11..17),
 * level TCIF·TCIE | HTIF·HTIE | TEIF·TEIE.
 *
 * Timing (approximation, documented): a transfer occupies the controller
 * for 2 HCLK cycles (arbitration + address computation) plus each access:
 * 2 HCLK for SRAM / flash / AHB registers (bus-matrix arbitration + data
 * phase), 2 HCLK + one APB clock for an APB peripheral (AHB-APB bridge).
 * SRAM → SRAM = 6 HCLK, APB2 (72 MHz) ↔ SRAM = 7, APB1 (36 MHz) ↔ SRAM = 8 —
 * inside the 6–10 AHB clocks per transfer ST quotes for the F1 (AN2548).
 * Both accesses take effect at the END of that slot. Not modelled: the
 * CPU stalls caused by bus-matrix contention (the core is never slowed),
 * flash wait states on DMA reads. The DMA freezes while its RCC clock
 * (AHBENR.DMA1EN) is off; a transfer that was in flight is dropped.
 */
import { BusFault, type AccessSize, type EventHandle } from '../core/types'
import type { RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { AHB, hex8, merge, RegisterBlock } from './block'

const EN = 1 << 0
const TCIE = 1 << 1
const HTIE = 1 << 2
const TEIE = 1 << 3
const DIR = 1 << 4
const CIRC = 1 << 5
const PINC = 1 << 6
const MINC = 1 << 7
const MEM2MEM = 1 << 14
const CCR_MASK = 0x7fff

// per-channel flag bits in ISR / IFCR (shifted by 4 × (channel − 1))
const GIF = 1
const TCIF = 2
const HTIF = 4
const TEIF = 8

export const DMA1_CHANNELS = 7
/** IRQ of DMA1 channel x (1-based): 11..17 (RM0008 Table 63) */
export const dmaIrq = (channel: number): number => 10 + channel

/** HCLK cycles of the arbitration + address computation phase of one transfer */
export const DMA_ARB_CYCLES = 2
/** HCLK cycles of one SRAM / flash / AHB access by the DMA */
export const DMA_MEM_CYCLES = 2

const APB1_BASE = 0x40000000
const APB2_BASE = 0x40010000
const APB_END = 0x40018000

export const DMA1_NOTES =
  '7 channels: CCR/CNDTR/CPAR/CMAR, ISR/IFCR, peripheral requests per Table 78 (OR-ed by the SoC, level-driven, acknowledged after each transfer), priority arbitration (PL, then channel number) re-taken after every transfer, peripheral↔memory and memory-to-memory, PSIZE/MSIZE packing per Table 76, APB byte/half-word write replication (§13.3.5), PINC/MINC, circular mode, HT/TC/TE flags and IRQs 11–17, transfer error on bus faults (TEIF, EN cleared). Real HAL firmware exercises memory-to-memory, ADC1 → memory circular, USART1 TX (memory → peripheral) and circular RX with HT/TC/IDLE handling (hal-dma-m2m, hal-adc-dma, hal-uart-dma); priorities, packing, lane replication and transfer errors are unit-tested only. Timing approximation: 2 HCLK arbitration + 2 HCLK per memory access, 2 HCLK + 1 APB clock per APB access (6–8 HCLK per transfer); CPU stalls from bus-matrix contention and flash wait states on DMA reads are not modelled.'

interface Channel {
  ccr: number
  /** live NDT */
  ndt: number
  /** value programmed into CNDTR (reload for circular mode, HT threshold) */
  ndtProg: number
  cpar: number
  cmar: number
  /** internal current addresses (not software visible, §13.3.2) */
  curP: number
  curM: number
}

const SIZE: readonly AccessSize[] = [1, 2, 4, 4]

export class Dma1 extends RegisterBlock implements Stm32Peripheral {
  readonly name = 'DMA1'
  readonly base = 0x40020000
  readonly size = 0x400
  readonly gate: RccGate = AHB(0)

  private ctx!: SocContext
  private isr = 0
  private readonly ch: Channel[] = []
  /** request line per channel (bit x−1) as OR-ed by the SoC */
  private lines = 0
  private clocked = false
  /** channel (0-based) whose transfer is in flight, -1 when idle */
  private active = -1
  private ev: EventHandle = 0
  private irqOn = 0
  private readonly reported = new Set<string>()
  /** transfers performed since reset (diagnostics / tests) */
  transfers = 0

  constructor() {
    super()
    for (let i = 0; i < DMA1_CHANNELS; i++) this.ch.push({ ccr: 0, ndt: 0, ndtProg: 0, cpar: 0, cmar: 0, curP: 0, curM: 0 })
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
  }

  // ------------------------------------------------------------ bus

  read32(off: number): number {
    if (off === 0x00) return this.isr
    if (off === 0x04) return 0 // IFCR is write-only
    const r = this.reg(off)
    if (!r) return 0
    const c = this.ch[r.i]
    switch (r.k) {
      case 0:
        return c.ccr
      case 1:
        return c.ndt
      case 2:
        return c.cpar
      case 3:
        return c.cmar
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    if (off === 0x04) {
      this.clearFlags(v & m)
      return
    }
    const r = this.reg(off)
    if (!r) return
    const c = this.ch[r.i]
    const n = r.i + 1
    switch (r.k) {
      case 0: {
        const old = c.ccr
        c.ccr = merge(old, v, m, CCR_MASK)
        if (c.ccr & EN && !(old & EN)) this.enable(r.i)
        this.checkConfig(r.i)
        this.update()
        this.kick(this.ctx.clock.cycles)
        return
      }
      case 1:
        if (c.ccr & EN) {
          this.report(`ndt${n}`, 'warning', `DMA1_CNDTR${n} written while channel ${n} is enabled: ignored (writable only with EN = 0, RM0008 §13.4.4)`)
          return
        }
        c.ndt = c.ndtProg = merge(c.ndt, v, m, 0xffff)
        return
      case 2:
      case 3:
        if (c.ccr & EN) {
          this.report(`addr${n}`, 'warning', `DMA1_${r.k === 2 ? 'CPAR' : 'CMAR'}${n} written while channel ${n} is enabled (RM0008 §13.4.5–6: must not be): the transfer in progress keeps its current address, the new base applies from the next reload`)
        }
        if (r.k === 2) c.cpar = merge(c.cpar, v, m, 0xffffffff)
        else c.cmar = merge(c.cmar, v, m, 0xffffffff)
        return
    }
  }

  reset(): void {
    if (this.ctx) this.ctx.scheduler.cancel(this.ev)
    this.ev = 0
    this.active = -1
    this.isr = 0
    this.lines = 0
    for (const c of this.ch) {
      c.ccr = c.ndt = c.ndtProg = c.cpar = c.cmar = c.curP = c.curM = 0
    }
    this.transfers = 0
    this.reported.clear()
    this.update()
  }

  clockEnabled(on: boolean): void {
    this.clocked = on
    if (!on) {
      if (this.active >= 0) this.ctx.log('warning', 'DMA1', `DMA1 clock disabled (RCC_AHBENR.DMA1EN = 0) during a channel ${this.active + 1} transfer: the transfer is dropped`)
      this.ctx.scheduler.cancel(this.ev)
      this.ev = 0
      this.active = -1
    } else this.kick(this.ctx.clock.cycles)
  }

  /** The SoC routes the OR of every peripheral request on `channel` (1..7) here. */
  dmaRequestChanged(channel: number, active: boolean): void {
    if (channel < 1 || channel > DMA1_CHANNELS) return
    const bit = 1 << (channel - 1)
    this.lines = active ? this.lines | bit : this.lines & ~bit
    if (active) this.kick(this.ctx.clock.cycles)
  }

  /** request line state of `channel` (1..7) — diagnostics / tests */
  requestLine(channel: number): boolean {
    return ((this.lines >>> (channel - 1)) & 1) === 1
  }

  // ------------------------------------------------------------ engine

  private reg(off: number): { i: number; k: number } | null {
    if (off < 0x08) return null
    const i = Math.floor((off - 0x08) / 20)
    const k = ((off - 0x08) % 20) >> 2
    if (i >= DMA1_CHANNELS || k > 3) return null
    return { i, k }
  }

  private enable(i: number): void {
    const c = this.ch[i]
    const ps = SIZE[(c.ccr >>> 8) & 3]
    const ms = SIZE[(c.ccr >>> 10) & 3]
    c.curP = (c.cpar & ~(ps - 1)) >>> 0
    c.curM = (c.cmar & ~(ms - 1)) >>> 0
    if (c.ndt === 0) {
      this.report(`zero${i}`, 'info', `DMA1 channel ${i + 1} enabled with CNDTR = 0: no transfer can be served (RM0008 §13.4.4)`)
    }
  }

  private checkConfig(i: number): void {
    const c = this.ch[i].ccr
    const n = i + 1
    if (((c >>> 8) & 3) === 3 || ((c >>> 10) & 3) === 3) {
      this.report(`size${n}`, 'warning', `DMA1_CCR${n}: PSIZE/MSIZE = 11 is reserved (RM0008 §13.4.3) — the model uses 32 bits`)
    }
    if (c & MEM2MEM && c & CIRC) {
      this.report(`m2mcirc${n}`, 'warning', `DMA1_CCR${n}: memory-to-memory mode may not be used together with circular mode (RM0008 §13.3.3) — the model stops at CNDTR = 0`)
    }
  }

  private ready(i: number): boolean {
    const c = this.ch[i]
    return (c.ccr & EN) !== 0 && c.ndt > 0 && ((c.ccr & MEM2MEM) !== 0 || ((this.lines >>> i) & 1) === 1)
  }

  /** Arbiter: start the next transfer at cycle `at` if the controller is idle. */
  private kick(at: number): void {
    if (this.active >= 0 || !this.clocked || !this.ctx) return
    let best = -1
    let bestPl = -1
    for (let i = 0; i < DMA1_CHANNELS; i++) {
      if (!this.ready(i)) continue
      const pl = (this.ch[i].ccr >>> 12) & 3
      if (pl > bestPl) {
        best = i
        bestPl = pl
      }
    }
    if (best < 0) return
    const c = this.ch[best]
    const toPer = (c.ccr & DIR) !== 0
    const dur = DMA_ARB_CYCLES + this.accessCycles(toPer ? c.curM : c.curP) + this.accessCycles(toPer ? c.curP : c.curM)
    this.active = best
    this.ev = this.ctx.scheduler.schedule(at + dur, (cyc) => this.execute(best, cyc))
  }

  /** HCLK cycles of one DMA access to `addr` (see the header). */
  private accessCycles(addr: number): number {
    const a = addr >>> 0
    if (a >= APB1_BASE && a < APB2_BASE) return 2 + this.ctx.cyclesPerTick(this.ctx.clocks.pclk1())
    if (a >= APB2_BASE && a < APB_END) return 2 + this.ctx.cyclesPerTick(this.ctx.clocks.pclk2())
    return DMA_MEM_CYCLES
  }

  private execute(i: number, cyc: number): void {
    this.ev = 0
    this.active = -1
    const c = this.ch[i]
    // disabled (or emptied) by software while the transfer was being arbitrated: dropped
    if (!(c.ccr & EN) || c.ndt === 0) {
      this.kick(cyc)
      return
    }
    const ps = SIZE[(c.ccr >>> 8) & 3]
    const ms = SIZE[(c.ccr >>> 10) & 3]
    const toPer = (c.ccr & DIR) !== 0
    const src = toPer ? c.curM : c.curP
    const dst = toPer ? c.curP : c.curM
    const ss = toPer ? ms : ps
    const ds = toPer ? ps : ms
    const fromPeripheral = !(c.ccr & MEM2MEM)
    let phase = 'read'
    try {
      const v = this.busRead(src, ss)
      phase = 'write'
      this.busWrite(dst, ds, v)
    } catch (e) {
      if (!(e instanceof BusFault)) throw e
      c.ccr &= ~EN
      this.setFlags(i, TEIF)
      this.ctx.log('warning', 'DMA1', `DMA1 channel ${i + 1} transfer error: ${phase} of ${hex8(e.addr)} failed (${e.reason}) — TEIF${i + 1} set, channel disabled (RM0008 §13.3.5)`)
      if (fromPeripheral) this.ctx.dmaServed?.(i + 1)
      this.update()
      this.kick(cyc)
      return
    }
    this.transfers++
    if (c.ccr & PINC) c.curP = (c.curP + ps) >>> 0
    if (c.ccr & MINC) c.curM = (c.curM + ms) >>> 0
    c.ndt--
    /** CNDTR after this transfer, before a circular reload */
    const remaining = c.ndt
    let flags = 0
    if (c.ndt === c.ndtProg >>> 1) flags |= HTIF
    if (c.ndt === 0) {
      flags |= TCIF
      if (c.ccr & CIRC) {
        c.ndt = c.ndtProg
        c.curP = (c.cpar & ~(ps - 1)) >>> 0
        c.curM = (c.cmar & ~(ms - 1)) >>> 0
      }
    }
    if (flags) this.setFlags(i, flags)
    if (fromPeripheral) {
      // end-of-transfer hardware signals to the requesting peripheral
      // (RM0008 §26.3.7: EOT_1 = number of data − 1 transferred, EOT = all),
      // delivered before the acknowledge so I2C LAST needs no CNDTR bus read
      if (remaining === 1) this.ctx.emitTrigger?.(`DMA1_CH${i + 1}_EOT_1`, cyc)
      else if (remaining === 0) this.ctx.emitTrigger?.(`DMA1_CH${i + 1}_EOT`, cyc)
      // acknowledge (§13.3.1) once the transfer is accounted for
      this.ctx.dmaServed?.(i + 1, remaining)
    }
    this.update()
    this.kick(cyc)
  }

  private busRead(addr: number, size: AccessSize): number {
    const a = (addr & ~(size - 1)) >>> 0
    const bus = this.ctx.bus
    return size === 4 ? bus.read32(a) >>> 0 : size === 2 ? bus.read16(a) : bus.read8(a)
  }

  /** Table 76: zero-extend a narrower source, truncate a wider one; §13.3.5 lane replication on APB. */
  private busWrite(addr: number, size: AccessSize, value: number): void {
    const a = (addr & ~(size - 1)) >>> 0
    const bus = this.ctx.bus
    if (size === 4) {
      bus.write32(a, value >>> 0)
      return
    }
    const v = size === 2 ? value & 0xffff : value & 0xff
    if (a >= APB1_BASE && a < APB_END) {
      const word = size === 2 ? (v | (v << 16)) >>> 0 : (v * 0x01010101) >>> 0
      bus.write32((a & ~3) >>> 0, word)
      return
    }
    if (size === 2) bus.write16(a, v)
    else bus.write8(a, v)
  }

  private setFlags(i: number, flags: number): void {
    this.isr = (this.isr | ((flags | GIF) << (4 * i))) >>> 0
  }

  private clearFlags(w: number): void {
    for (let i = 0; i < DMA1_CHANNELS; i++) {
      let f = (w >>> (4 * i)) & 0xf
      if (!f) continue
      if (f & GIF) f = 0xf // CGIFx clears GIF, TEIF, HTIF and TCIF
      this.isr = (this.isr & ~(f << (4 * i))) >>> 0
    }
    this.update()
  }

  private report(key: string, level: 'info' | 'warning', msg: string): void {
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.ctx.log(level, 'DMA1', msg)
  }

  // ------------------------------------------------------------ outputs

  private update(): void {
    if (!this.ctx) return
    let on = 0
    for (let i = 0; i < DMA1_CHANNELS; i++) {
      const f = (this.isr >>> (4 * i)) & 0xf
      const ccr = this.ch[i].ccr
      if ((f & TCIF && ccr & TCIE) || (f & HTIF && ccr & HTIE) || (f & TEIF && ccr & TEIE)) on |= 1 << i
    }
    const diff = on ^ this.irqOn
    if (!diff) return
    this.irqOn = on
    for (let i = 0; i < DMA1_CHANNELS; i++) if ((diff >>> i) & 1) this.ctx.setIrq(dmaIrq(i + 1), ((on >>> i) & 1) === 1)
  }
}
