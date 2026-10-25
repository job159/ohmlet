/**
 * Cortex-M3 System Control Space and the other internal PPB blocks
 * (DDI 0403E §B3.2–B3.4, §C1.7–C1.8; Cortex-M3 TRM DDI 0337 ch. 4, 8, 11):
 *
 *   0xE000_0000  ITM   stimulus ports 0..31, TER, TPR, TCR, LAR/LSR
 *   0xE000_1000  DWT   CTRL, CYCCNT (other DWT counters/comparators RAZ/WI)
 *   0xE000_2000  FPB   not implemented (RAZ/WI, logged)
 *   0xE000_E000  SCS   ICTR, ACTLR, SysTick, NVIC, SCB, MPU_TYPE (= no MPU,
 *                      STM32F103 has none), debug registers, STIR
 *
 * This file also owns the exception bookkeeping the NVIC exposes (pending,
 * active, enable, priorities, level-sensitive IRQ lines) and the priority
 * arithmetic of B1.5.4 (ExecutionPriority, PRIGROUP). The exception ENTRY /
 * RETURN mechanics live in cpu.ts.
 *
 * SysTick and DWT.CYCCNT are LAZY: they derive their value from clock.cycles
 * and schedule one event per SysTick wrap (only while TICKINT is set — the
 * COUNTFLAG of a non-interrupting SysTick is derived on read), never ticking
 * per cycle.
 *
 * Unimplemented PPB registers read as zero, ignore writes and are logged once
 * per address. Unprivileged PPB accesses BusFault (B3.2: "unprivileged
 * access to the SCS... BusFault"), except STIR when CCR.USERSETMPEND = 1 and
 * ITM stimulus ports whose ITM_TPR bit allows it.
 */
import { BusFault, type AccessSize, type CycleClock, type EventHandle, type Scheduler } from './types'
import type { CoreConfig, CoreHooks } from './cpu-api'

/** exception numbers (B1.5.2) */
export const EXC_RESET = 1
export const EXC_NMI = 2
export const EXC_HARDFAULT = 3
export const EXC_MEMMANAGE = 4
export const EXC_BUSFAULT = 5
export const EXC_USAGEFAULT = 6
export const EXC_SVCALL = 11
export const EXC_DEBUGMON = 12
export const EXC_PENDSV = 14
export const EXC_SYSTICK = 15

// CCR bits (B3.2.8)
export const CCR_NONBASETHRDENA = 1 << 0
export const CCR_USERSETMPEND = 1 << 1
export const CCR_UNALIGN_TRP = 1 << 3
export const CCR_DIV_0_TRP = 1 << 4
export const CCR_BFHFNMIGN = 1 << 8
export const CCR_STKALIGN = 1 << 9
const CCR_MASK = CCR_NONBASETHRDENA | CCR_USERSETMPEND | CCR_UNALIGN_TRP | CCR_DIV_0_TRP | CCR_BFHFNMIGN | CCR_STKALIGN

// SCR bits (B3.2.7)
export const SCR_SLEEPONEXIT = 1 << 1
export const SCR_SLEEPDEEP = 1 << 2
export const SCR_SEVONPEND = 1 << 4

// CFSR bits (B3.2.15)
export const MMFSR_IACCVIOL = 1 << 0
export const MMFSR_MSTKERR = 1 << 4
export const BFSR_IBUSERR = 1 << 8
export const BFSR_PRECISERR = 1 << 9
export const BFSR_UNSTKERR = 1 << 11
export const BFSR_STKERR = 1 << 12
export const BFSR_BFARVALID = 1 << 15

// HFSR bits (B3.2.16)
export const HFSR_VECTTBL = 1 << 1
export const HFSR_FORCED = 1 << 30
export const HFSR_DEBUGEVT = 1 << 31

// DFSR bits (C1.6.1)
export const DFSR_HALTED = 1 << 0
export const DFSR_BKPT = 1 << 1

// SysTick CTRL bits (B3.3.3)
const ST_ENABLE = 1 << 0
const ST_TICKINT = 1 << 1
const ST_CLKSOURCE = 1 << 2
const ST_COUNTFLAG = 1 << 16

// DEMCR (C1.6.5)
const DEMCR_TRCENA = 1 << 24
const DEMCR_MASK = 0x010f07f1

// ITM (C1.7)
const ITM_LAR_KEY = 0xc5acce55

/**
 * Cortex-M3 CPUID-scheme feature registers 0xE000ED40..ED7C (Cortex-M3 TRM
 * §4.1, "Processor Feature / Debug Feature / Memory Model / ISA Feature
 * registers") — read only, identical for r1p1 and r2p0.
 */
const ID_REGS: Record<number, number> = {
  0xd40: 0x00000030, // ID_PFR0: Thumb-2
  0xd44: 0x00000200, // ID_PFR1: M-profile programmers' model
  0xd48: 0x00100000, // ID_DFR0: M-profile debug
  0xd4c: 0x00000000, // ID_AFR0
  0xd50: 0x00100030, // ID_MMFR0
  0xd54: 0x00000000, // ID_MMFR1
  0xd58: 0x01000000, // ID_MMFR2: WFI stall
  0xd5c: 0x00000000, // ID_MMFR3
  0xd60: 0x01141110, // ID_ISAR0: bitcount, bitfield, CMPBranch, coprocessor, debug, divide
  0xd64: 0x02111000, // ID_ISAR1
  0xd68: 0x21112231, // ID_ISAR2
  0xd6c: 0x01111110, // ID_ISAR3
  0xd70: 0x01310102, // ID_ISAR4
}

/** The pieces of the core the SCS needs (implemented by CortexM3 in cpu.ts). */
export interface ScsCore {
  readonly clock: CycleClock
  readonly scheduler: Scheduler
  readonly hooks: CoreHooks
  readonly config: CoreConfig
  ipsr: number
  /** set to -1 to request boundary work */
  limit: number
  excDirty: number
  eventReg: number
  privileged(): boolean
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
  localReset(): void
  clearAllActive(): void
}

export class Scs {
  readonly numIrq: number
  readonly numExc: number
  /** priority byte mask: only the top `priorityBits` bits are implemented */
  readonly prioMask: number

  // ------------------------------------------------- exception bookkeeping
  readonly pend: Uint8Array
  readonly active: Uint8Array
  /** configured priority (0..255, masked) for exceptions 4..numExc-1; fixed -3/-2/-1 for 1..3 */
  readonly prio: Int16Array
  /** NVIC enable, indexed by exception number (16 + irq) */
  readonly enabled: Uint8Array
  /** level of each external IRQ line as driven by the SoC */
  readonly irqLine: Uint8Array

  prigroup = 0
  vtor = 0
  ccr = 0
  scr = 0
  actlr = 0
  /** SHCSR enable bits (MEMFAULTENA 16, BUSFAULTENA 17, USGFAULTENA 18) */
  shcsrEna = 0
  cfsr = 0
  hfsr = 0
  dfsr = 0
  mmfar = 0
  bfar = 0
  afsr = 0
  demcr = 0

  // ------------------------------------------------------------- SysTick
  private stCtrl = 0
  private stLoad = 0
  /** counter value at stBase (valid while disabled: the frozen value) */
  private stBaseVal = 0
  /** tick-aligned cycle stBaseVal refers to */
  private stBase = 0
  /** core cycles per SysTick tick */
  private stPeriod = 1
  /** COUNTFLAG latched; plus wraps after stFlagFrom are derived on read */
  private stFlag = 0
  private stFlagFrom = 0
  private stEvent: EventHandle = 0

  // ----------------------------------------------------------------- DWT
  private dwtCtrl = 0
  private cycBase = 0
  private cycFrom = 0
  private cycRunning = false

  // ----------------------------------------------------------------- ITM
  private itmTer = 0
  private itmTpr = 0
  private itmTcr = 0
  private itmLocked = true

  constructor(private readonly core: ScsCore) {
    const cfg = core.config
    this.numIrq = cfg.numIrq
    this.numExc = 16 + cfg.numIrq
    this.prioMask = (0xff << (8 - cfg.priorityBits)) & 0xff
    this.pend = new Uint8Array(this.numExc)
    this.active = new Uint8Array(this.numExc)
    this.prio = new Int16Array(this.numExc)
    this.enabled = new Uint8Array(this.numExc)
    this.irqLine = new Uint8Array(this.numIrq)
  }

  /** Reset values (B1.5.5 TakeReset + B3.2 register reset values). */
  reset(): void {
    this.pend.fill(0)
    this.active.fill(0)
    this.prio.fill(0)
    this.prio[EXC_RESET] = -3
    this.prio[EXC_NMI] = -2
    this.prio[EXC_HARDFAULT] = -1
    this.enabled.fill(0)
    this.irqLine.fill(0)
    this.prigroup = 0
    this.vtor = 0
    // STKALIGN resets to 0 on Cortex-M3 r0/r1 (configurable) and to 1 from
    // r2p0 on (TRM r2p0 §4.3.9); CPUID[23:20] = variant.
    this.ccr = ((this.core.config.cpuid >>> 20) & 0xf) >= 2 ? CCR_STKALIGN : 0
    this.scr = 0
    this.actlr = 0
    this.shcsrEna = 0
    this.cfsr = this.hfsr = this.dfsr = this.mmfar = this.bfar = this.afsr = 0
    this.demcr = 0
    this.stCancel()
    this.stCtrl = 0
    this.stLoad = 0
    this.stBaseVal = 0
    this.stBase = 0
    this.stFlag = 0
    this.stFlagFrom = 0
    this.dwtCtrl = 0x40000000 // NUMCOMP = 4
    this.cycBase = 0
    this.cycFrom = 0
    this.cycRunning = false
    this.itmTer = this.itmTpr = this.itmTcr = 0
    this.itmLocked = true
  }

  // ======================================================== priorities

  /** group priority of a (possibly negative) priority value under PRIGROUP (B1.5.4) */
  groupPri(p: number): number {
    return p < 0 ? p : p & ~((2 << this.prigroup) - 1)
  }

  /** is a system fault (4/5/6) enabled in SHCSR? Other exceptions are always enabled once pended. */
  takeable(exc: number): boolean {
    if (exc >= 16) return this.enabled[exc] !== 0
    switch (exc) {
      case EXC_MEMMANAGE:
        return (this.shcsrEna & (1 << 16)) !== 0
      case EXC_BUSFAULT:
        return (this.shcsrEna & (1 << 17)) !== 0
      case EXC_USAGEFAULT:
        return (this.shcsrEna & (1 << 18)) !== 0
      case EXC_DEBUGMON:
        return false // no debug monitor: halting debug only
      default:
        return true
    }
  }

  /** highest-priority pending and enabled exception (lowest priority value, then number); 0 = none */
  bestPending(): number {
    let best = 0
    let bp = 1000
    const pend = this.pend
    const prio = this.prio
    for (let e = 2; e < this.numExc; e++) {
      if (pend[e] === 0) continue
      const p = prio[e]
      if (p < bp && this.takeable(e)) {
        best = e
        bp = p
      }
    }
    return best
  }

  activeCount(): number {
    let n = 0
    for (let e = 1; e < this.numExc; e++) n += this.active[e]
    return n
  }

  /** ExecutionPriority() (B1.5.4) given the current masks */
  executionPriority(primask: number, basepri: number, faultmask: number): number {
    let hp = 256
    const active = this.active
    const prio = this.prio
    for (let e = 1; e < this.numExc; e++) {
      if (active[e] !== 0 && prio[e] < hp) hp = prio[e]
    }
    hp = this.groupPri(hp)
    let boosted = 256
    if (basepri !== 0) boosted = this.groupPri(basepri)
    if (primask !== 0) boosted = 0
    if (faultmask !== 0) boosted = -1
    return boosted < hp ? boosted : hp
  }

  setPending(exc: number): void {
    if (this.pend[exc] === 0) {
      this.pend[exc] = 1
      // SEVONPEND: an interrupt becoming pending is a WFE wake-up event (B1.5.18)
      if (exc >= 16 && this.scr & SCR_SEVONPEND) this.core.eventReg = 1
      this.core.excDirty = 1
      this.core.limit = -1
    }
  }

  clearPending(exc: number): void {
    if (this.pend[exc] !== 0) {
      this.pend[exc] = 0
      this.core.excDirty = 1
      this.core.limit = -1
    }
  }

  // ============================================================ SysTick

  private stCancel(): void {
    if (this.stEvent !== 0) {
      this.core.scheduler.cancel(this.stEvent)
      this.stEvent = 0
    }
  }

  private stEnabled(): boolean {
    return (this.stCtrl & ST_ENABLE) !== 0
  }

  /** counter value at cycle t (t >= stBase) while enabled */
  private stValueAt(t: number): number {
    const n = Math.floor((t - this.stBase) / this.stPeriod)
    if (n === 0) return this.stBaseVal
    if (this.stBaseVal > 0 && n <= this.stBaseVal) return this.stBaseVal - n
    // ticks after reaching zero: the first one reloads LOAD (no wrap event), then counts down
    const after = this.stBaseVal > 0 ? n - this.stBaseVal - 1 : n - 1
    if (this.stLoad === 0) return 0
    return this.stLoad - (after % (this.stLoad + 1))
  }

  /** cycle of the first 1→0 transition strictly after cycle t (Infinity if none) */
  private stNextWrapAfter(t: number): number {
    if (!this.stEnabled()) return Infinity
    const p = this.stPeriod
    // first wrap: after stBaseVal ticks, or (if starting at 0) after reload + LOAD ticks
    let first: number
    if (this.stBaseVal > 0) first = this.stBase + this.stBaseVal * p
    else if (this.stLoad > 0) first = this.stBase + (this.stLoad + 1) * p
    else return Infinity
    if (first > t) return first
    if (this.stLoad === 0) return Infinity
    const per = (this.stLoad + 1) * p
    const k = Math.floor((t - first) / per) + 1
    return first + k * per
  }

  /** re-anchor the lazy counter at `now` (before LOAD/CLKSOURCE changes) */
  private stRebase(now: number): void {
    if (this.stEnabled()) {
      const tick = this.stBase + Math.floor((now - this.stBase) / this.stPeriod) * this.stPeriod
      this.stBaseVal = this.stValueAt(tick)
      this.stBase = tick
    }
  }

  private stSchedule(): void {
    this.stCancel()
    if (!this.stEnabled() || (this.stCtrl & ST_TICKINT) === 0) return
    const now = this.core.clock.cycles
    const w = this.stNextWrapAfter(now - 1)
    if (w === Infinity) return
    this.stEvent = this.core.scheduler.schedule(Math.ceil(w), (cycle) => this.stWrap(cycle))
    this.core.limit = -1
  }

  private stWrap(cycle: number): void {
    this.stEvent = 0
    this.setPending(EXC_SYSTICK)
    // re-anchor at the wrap so the lazy formula stays short
    this.stBase = cycle
    this.stBaseVal = 0
    this.stFlag = 1
    this.stFlagFrom = cycle
    this.stSchedule()
  }

  private stPeriodNow(): number {
    if (this.stCtrl & ST_CLKSOURCE) return 1
    const d = this.core.hooks.systickRefDivider()
    return d > 0 ? d : 1
  }

  private stReadCtrl(now: number): number {
    let flag = this.stFlag
    if (!flag && this.stNextWrapAfter(this.stFlagFrom) <= now) flag = 1
    // COUNTFLAG clears on read (B3.3.3)
    this.stFlag = 0
    this.stFlagFrom = now
    return (this.stCtrl & 7) | (flag ? ST_COUNTFLAG : 0)
  }

  private stWriteCtrl(v: number, now: number): void {
    // latch any wrap that already happened under the old configuration
    if (!this.stFlag && this.stNextWrapAfter(this.stFlagFrom) <= now) this.stFlag = 1
    const wasEnabled = this.stEnabled()
    if (wasEnabled) {
      this.stBaseVal = this.stValueAt(now)
      this.stBase = now
    }
    this.stCtrl = v & 7
    this.stPeriod = this.stPeriodNow()
    if (this.stEnabled()) {
      // ticks fall on multiples of the reference period (core-clock source: every cycle)
      this.stBase = Math.floor(now / this.stPeriod) * this.stPeriod
    }
    this.stFlagFrom = now
    this.stSchedule()
  }

  private stReadVal(now: number): number {
    return this.stEnabled() ? this.stValueAt(now) : this.stBaseVal
  }

  /** any write clears VAL to 0 and clears COUNTFLAG (B3.3.5) */
  private stWriteVal(now: number): void {
    this.stFlag = 0
    this.stFlagFrom = now
    this.stBaseVal = 0
    if (this.stEnabled()) this.stBase = Math.floor(now / this.stPeriod) * this.stPeriod
    this.stSchedule()
  }

  private stWriteLoad(v: number, now: number): void {
    if (!this.stFlag && this.stNextWrapAfter(this.stFlagFrom) <= now) this.stFlag = 1
    this.stFlagFrom = now
    this.stRebase(now)
    this.stLoad = v & 0xffffff
    this.stSchedule()
  }

  /** SoC clock change (systickRefDivider may have changed): keep the count, re-time the ticks */
  clockChanged(): void {
    if (!this.stEnabled() || this.stCtrl & ST_CLKSOURCE) return
    const now = this.core.clock.cycles
    this.stRebase(now)
    this.stPeriod = this.stPeriodNow()
    this.stSchedule()
  }

  // ================================================================ DWT

  private cycNow(): number {
    return this.cycRunning ? (this.cycBase + (this.core.clock.cycles - this.cycFrom)) % 4294967296 : this.cycBase
  }

  private cycUpdate(): void {
    const run = (this.demcr & DEMCR_TRCENA) !== 0 && (this.dwtCtrl & 1) !== 0
    if (run === this.cycRunning) return
    this.cycBase = this.cycNow()
    this.cycFrom = this.core.clock.cycles
    this.cycRunning = run
  }

  // ======================================================= bus interface

  /** read of the internal PPB, addr in [0xE0000000, 0xE0040000) */
  read(addr: number, size: AccessSize, unprivileged: boolean): number {
    const off = addr - 0xe0000000
    if (off < 0x1000) return this.itmRead(off, size, unprivileged)
    if (unprivileged) throw new BusFault(addr, false, 'unprivileged access to the PPB')
    const shift = (addr & 3) * 8
    // byte-addressable priority registers
    if (off >= 0xe400 && off < 0xe400 + this.numIrq && size !== 4) return this.readBytes(addr, size)
    if (off >= 0xed18 && off < 0xed24 && size !== 4) return this.readBytes(addr, size)
    const w = this.readWord(off & ~3)
    if (size === 4) return w >>> 0
    return (w >>> shift) & (size === 2 ? 0xffff : 0xff)
  }

  write(addr: number, value: number, size: AccessSize, unprivileged: boolean): void {
    const off = addr - 0xe0000000
    if (off < 0x1000) return this.itmWrite(off, value, size, unprivileged)
    if (unprivileged) {
      // STIR is the one SCS register software may write unprivileged (B3.4.6, CCR.USERSETMPEND)
      if (off === 0xef00 && this.ccr & CCR_USERSETMPEND) return this.writeWord(0xef00, value, 0xffffffff)
      throw new BusFault(addr, true, 'unprivileged access to the PPB')
    }
    if (off >= 0xe400 && off < 0xe400 + this.numIrq && size !== 4) return this.writeBytes(addr, value, size)
    if (off >= 0xed18 && off < 0xed24 && size !== 4) return this.writeBytes(addr, value, size)
    const shift = (addr & 3) * 8
    const mask = size === 4 ? 0xffffffff : ((size === 2 ? 0xffff : 0xff) << shift) >>> 0
    this.writeWord(off & ~3, (value << shift) >>> 0, mask)
    this.core.limit = -1
  }

  private readBytes(addr: number, size: AccessSize): number {
    let v = 0
    for (let i = 0; i < size; i++) v |= this.priorityByte(addr + i - 0xe0000000) << (8 * i)
    return v >>> 0
  }

  private writeBytes(addr: number, value: number, size: AccessSize): void {
    for (let i = 0; i < size; i++) this.setPriorityByte(addr + i - 0xe0000000, (value >>> (8 * i)) & 0xff)
  }

  /** NVIC_IPRn byte or SHPRn byte at PPB offset `off` */
  private priorityByte(off: number): number {
    if (off >= 0xe400 && off < 0xe400 + this.numIrq) return this.prio[16 + off - 0xe400]
    if (off >= 0xed18 && off < 0xed24) {
      const exc = 4 + off - 0xed18
      return this.sysPrioImplemented(exc) ? this.prio[exc] : 0
    }
    return 0
  }

  private setPriorityByte(off: number, v: number): void {
    let exc = -1
    if (off >= 0xe400 && off < 0xe400 + this.numIrq) exc = 16 + off - 0xe400
    else if (off >= 0xed18 && off < 0xed24) {
      exc = 4 + off - 0xed18
      if (!this.sysPrioImplemented(exc)) return
    }
    if (exc < 0) return
    const p = v & this.prioMask
    if (this.prio[exc] !== p) {
      this.prio[exc] = p
      this.core.excDirty = 1
      this.core.limit = -1
    }
  }

  private sysPrioImplemented(exc: number): boolean {
    return exc === 4 || exc === 5 || exc === 6 || exc === 11 || exc === 12 || exc === 14 || exc === 15
  }

  private unimplemented(off: number, write: boolean): void {
    const a = (0xe0000000 + off) >>> 0
    this.core.logOnce(
      `ppb:${a}`,
      'warning',
      `PPB register 0x${a.toString(16).padStart(8, '0')} is not implemented (${write ? 'write ignored' : 'reads as 0'})`,
    )
  }

  private readWord(off: number): number {
    const core = this.core
    const now = core.clock.cycles
    // NVIC register banks
    if (off >= 0xe100 && off < 0xe400) {
      const bank = (off & 0x7f) >> 2
      const reg = (off - 0xe100) >> 7 // 0 ISER, 1 ICER, 2 ISPR, 3 ICPR, 4 IABR
      if (reg > 4) return this.unimpl0(off)
      let v = 0
      for (let i = 0; i < 32; i++) {
        const irq = bank * 32 + i
        if (irq >= this.numIrq) break
        const e = 16 + irq
        const bit = reg <= 1 ? this.enabled[e] : reg <= 3 ? this.pend[e] : this.active[e]
        if (bit) v |= 1 << i
      }
      return v >>> 0
    }
    if (off >= 0xe400 && off < 0xe5f0) {
      let v = 0
      for (let i = 0; i < 4; i++) v |= this.priorityByte(off + i) << (8 * i)
      return v >>> 0
    }
    if (off >= 0xed40 && off < 0xed80) return ID_REGS[off] ?? this.unimpl0(off)
    switch (off) {
      // ------------------------------------------------------------- DWT
      case 0x1000:
        return this.dwtCtrl
      case 0x1004:
        return this.cycNow() >>> 0
      // ------------------------------------------------------- SCS misc
      case 0xe000: // MCR: reserved
        return 0
      case 0xe004: // ICTR.INTLINESNUM: (number of 32-line groups) - 1
        return Math.max(0, Math.ceil(this.numIrq / 32) - 1)
      case 0xe008:
        return this.actlr
      // --------------------------------------------------------- SysTick
      case 0xe010:
        return this.stReadCtrl(now)
      case 0xe014:
        return this.stLoad
      case 0xe018:
        return this.stReadVal(now)
      case 0xe01c:
        return this.core.config.systickCalib >>> 0
      // ------------------------------------------------------------- SCB
      case 0xed00:
        return this.core.config.cpuid >>> 0
      case 0xed04:
        return this.icsr()
      case 0xed08:
        return this.vtor
      case 0xed0c:
        return (0xfa050000 | (this.prigroup << 8)) >>> 0
      case 0xed10:
        return this.scr
      case 0xed14:
        return this.ccr
      case 0xed18:
      case 0xed1c:
      case 0xed20: {
        let v = 0
        for (let i = 0; i < 4; i++) v |= this.priorityByte(off + i) << (8 * i)
        return v >>> 0
      }
      case 0xed24:
        return this.shcsr()
      case 0xed28:
        return this.cfsr >>> 0
      case 0xed2c:
        return this.hfsr >>> 0
      case 0xed30:
        return this.dfsr
      case 0xed34:
        return this.mmfar >>> 0
      case 0xed38:
        return this.bfar >>> 0
      case 0xed3c:
        return this.afsr >>> 0
      case 0xed90: // MPU_TYPE: DREGION = 0 → no MPU (STM32F103 implements none)
        return 0
      case 0xedf0: // DHCSR: no external debugger attached (C_DEBUGEN = 0)
        return 0
      case 0xedfc:
        return this.demcr
      case 0xef00: // STIR is write-only
        return 0
      default:
        return this.unimpl0(off)
    }
  }

  private unimpl0(off: number): number {
    this.unimplemented(off, false)
    return 0
  }

  private writeWord(off: number, value: number, mask: number): void {
    const core = this.core
    const now = core.clock.cycles
    const v = (value & mask) >>> 0
    const merge = (cur: number): number => ((cur & ~mask) | v) >>> 0
    if (off >= 0xe100 && off < 0xe300) {
      const bank = (off & 0x7f) >> 2
      const reg = (off - 0xe100) >> 7
      for (let i = 0; i < 32; i++) {
        if (((v >>> i) & 1) === 0) continue
        const irq = bank * 32 + i
        if (irq >= this.numIrq) break
        const e = 16 + irq
        switch (reg) {
          case 0:
            if (!this.enabled[e]) {
              this.enabled[e] = 1
              core.excDirty = 1
            }
            break
          case 1:
            if (this.enabled[e]) {
              this.enabled[e] = 0
              core.excDirty = 1
            }
            break
          case 2:
            this.setPending(e)
            break
          default:
            // ICPR cannot clear the pending state of a still-asserted level line
            if (!(this.irqLine[irq] && !this.active[e])) this.clearPending(e)
        }
      }
      core.limit = -1
      return
    }
    if (off >= 0xe300 && off < 0xe400) return // IABR is read-only
    if (off >= 0xe400 && off < 0xe5f0) {
      for (let i = 0; i < 4; i++) if ((mask >>> (8 * i)) & 0xff) this.setPriorityByte(off + i, (v >>> (8 * i)) & 0xff)
      return
    }
    switch (off) {
      case 0x1000: {
        // DWT_CTRL: only CYCCNTENA (bit 0) is functional; NUMCOMP is read-only
        this.dwtCtrl = (0x40000000 | (merge(this.dwtCtrl) & 1)) >>> 0
        if (merge(0) & ~1 & 0x0fffffff) core.logOnce('dwt-ctrl', 'info', 'DWT_CTRL: only CYCCNTENA is modeled (profiling counters, PC sampling and comparators are not)')
        this.cycUpdate()
        return
      }
      case 0x1004:
        this.cycBase = merge(this.cycNow())
        this.cycFrom = now
        return
      case 0xe008:
        this.actlr = merge(this.actlr) & 7
        return
      case 0xe010:
        return this.stWriteCtrl(merge(this.stCtrl), now)
      case 0xe014:
        return this.stWriteLoad(merge(this.stLoad), now)
      case 0xe018:
        return this.stWriteVal(now)
      case 0xe01c: // CALIB read-only
        return
      case 0xed04:
        return this.writeIcsr(v)
      case 0xed08:
        this.vtor = merge(this.vtor) & 0x3fffff80
        return
      case 0xed0c:
        return this.writeAircr(value, mask)
      case 0xed10:
        this.scr = merge(this.scr) & (SCR_SLEEPONEXIT | SCR_SLEEPDEEP | SCR_SEVONPEND)
        return
      case 0xed14:
        this.ccr = merge(this.ccr) & CCR_MASK
        core.excDirty = 1
        return
      case 0xed18:
      case 0xed1c:
      case 0xed20:
        for (let i = 0; i < 4; i++) if ((mask >>> (8 * i)) & 0xff) this.setPriorityByte(off + i, (v >>> (8 * i)) & 0xff)
        return
      case 0xed24:
        return this.writeShcsr(merge(this.shcsr()))
      case 0xed28: // write-one-to-clear
        this.cfsr = (this.cfsr & ~v) >>> 0
        return
      case 0xed2c:
        this.hfsr = (this.hfsr & ~(v & (HFSR_VECTTBL | HFSR_FORCED | HFSR_DEBUGEVT))) >>> 0
        return
      case 0xed30:
        this.dfsr = (this.dfsr & ~(v & 0x1f)) >>> 0
        return
      case 0xed34:
        this.mmfar = merge(this.mmfar)
        return
      case 0xed38:
        this.bfar = merge(this.bfar)
        return
      case 0xed3c:
        this.afsr = merge(this.afsr)
        return
      case 0xed90:
        return
      case 0xedf0:
        core.logOnce('dhcsr', 'info', 'DHCSR write ignored: halting debug is driven by the simulator, not by firmware')
        return
      case 0xedfc:
        this.demcr = merge(this.demcr) & DEMCR_MASK
        this.cycUpdate()
        return
      case 0xef00: {
        const irq = v & 0x1ff
        if (irq < this.numIrq) this.setPending(16 + irq)
        return
      }
      default:
        if ((off >= 0xed00 && off < 0xed40) || (off >= 0xed40 && off < 0xed80)) return // read-only
        this.unimplemented(off, true)
    }
  }

  private icsr(): number {
    const core = this.core
    const vectActive = core.ipsr
    let isrPending = 0
    for (let e = 16; e < this.numExc; e++) {
      if (this.pend[e]) {
        isrPending = 1
        break
      }
    }
    const vectPending = this.bestPending()
    // RETTOBASE: in Handler mode, 1 when no exception other than the current one is active
    const retToBase = vectActive !== 0 && this.activeCount() === 1 ? 1 : 0
    return (
      ((this.pend[EXC_NMI] << 31) |
        (this.pend[EXC_PENDSV] << 28) |
        (this.pend[EXC_SYSTICK] << 26) |
        (isrPending << 22) |
        ((vectPending & 0x1ff) << 12) |
        (retToBase << 11) |
        (vectActive & 0x1ff)) >>>
      0
    )
  }

  private writeIcsr(v: number): void {
    if (v & (1 << 31)) this.setPending(EXC_NMI)
    if (v & (1 << 28)) this.setPending(EXC_PENDSV)
    else if (v & (1 << 27)) this.clearPending(EXC_PENDSV)
    if (v & (1 << 26)) this.setPending(EXC_SYSTICK)
    else if (v & (1 << 25)) this.clearPending(EXC_SYSTICK)
  }

  private writeAircr(value: number, mask: number): void {
    const core = this.core
    if (mask !== 0xffffffff || value >>> 16 !== 0x05fa) {
      core.logOnce('aircr-key', 'warning', 'AIRCR write without VECTKEY 0x05FA (or not a word write) ignored')
      return
    }
    const pg = (value >> 8) & 7
    if (pg !== this.prigroup) {
      this.prigroup = pg
      core.excDirty = 1
    }
    if (value & 2) {
      core.logOnce('vectclractive', 'warning', 'AIRCR.VECTCLRACTIVE (debug-only, UNPREDICTABLE when not halted): all active state cleared')
      core.clearAllActive()
    }
    if (value & 4) {
      core.hooks.log?.('info', 'AIRCR.SYSRESETREQ: system reset requested')
      core.hooks.systemResetRequest()
      return
    }
    if (value & 1) {
      core.logOnce('vectreset', 'warning', 'AIRCR.VECTRESET (debug-only): core-only reset performed, peripherals keep their state')
      core.localReset()
    }
  }

  shcsr(): number {
    const p = this.pend
    const a = this.active
    return (
      (this.shcsrEna |
        (p[EXC_SVCALL] << 15) |
        (p[EXC_BUSFAULT] << 14) |
        (p[EXC_MEMMANAGE] << 13) |
        (p[EXC_USAGEFAULT] << 12) |
        (a[EXC_SYSTICK] << 11) |
        (a[EXC_PENDSV] << 10) |
        (a[EXC_DEBUGMON] << 8) |
        (a[EXC_SVCALL] << 7) |
        (a[EXC_USAGEFAULT] << 3) |
        (a[EXC_BUSFAULT] << 1) |
        a[EXC_MEMMANAGE]) >>>
      0
    )
  }

  private writeShcsr(v: number): void {
    // enables, plus the pending/active bits, which B3.2.13 makes writable (state restore by an RTOS / debugger)
    this.shcsrEna = v & (7 << 16)
    const setP = (e: number, bit: number) => (v & (1 << bit) ? (this.pend[e] = 1) : (this.pend[e] = 0))
    const setA = (e: number, bit: number) => (this.active[e] = v & (1 << bit) ? 1 : 0)
    setP(EXC_SVCALL, 15)
    setP(EXC_BUSFAULT, 14)
    setP(EXC_MEMMANAGE, 13)
    setP(EXC_USAGEFAULT, 12)
    setA(EXC_SYSTICK, 11)
    setA(EXC_PENDSV, 10)
    setA(EXC_DEBUGMON, 8)
    setA(EXC_SVCALL, 7)
    setA(EXC_USAGEFAULT, 3)
    setA(EXC_BUSFAULT, 1)
    setA(EXC_MEMMANAGE, 0)
    this.core.excDirty = 1
    this.core.limit = -1
  }

  // ================================================================ ITM

  private itmRead(off: number, size: AccessSize, unprivileged: boolean): number {
    if (off < 0x80) return 1 // stimulus port: FIFOREADY = 1 (the simulated FIFO never fills)
    if (unprivileged) throw new BusFault(0xe0000000 + off, false, 'unprivileged access to the ITM control registers')
    let w: number
    switch (off & ~3) {
      case 0xe00:
        w = this.itmTer
        break
      case 0xe40:
        w = this.itmTpr
        break
      case 0xe80:
        w = this.itmTcr
        break
      case 0xfb4: // LSR: lock implemented (bit 0), locked (bit 1)
        w = 1 | (this.itmLocked ? 2 : 0)
        break
      default:
        return this.unimpl0(off)
    }
    const shift = (off & 3) * 8
    return size === 4 ? w >>> 0 : (w >>> shift) & (size === 2 ? 0xffff : 0xff)
  }

  private itmWrite(off: number, value: number, size: AccessSize, unprivileged: boolean): void {
    if (off < 0x80) {
      const port = off >> 2
      // unprivileged writes are permitted only to port groups whose ITM_TPR bit is clear
      if (unprivileged && (this.itmTpr >> (port >> 3)) & 1) return
      if (this.demcr & DEMCR_TRCENA && this.itmTcr & 1 && (this.itmTer >>> port) & 1) {
        this.core.hooks.itmWrite?.(port, value >>> 0, size)
        this.core.limit = -1
      }
      return
    }
    if (unprivileged) throw new BusFault(0xe0000000 + off, true, 'unprivileged access to the ITM control registers')
    if (off === 0xfb0) {
      this.itmLocked = value >>> 0 !== ITM_LAR_KEY
      return
    }
    if (this.itmLocked && (off === 0xe00 || off === 0xe40 || off === 0xe80)) {
      this.core.logOnce('itm-lock', 'warning', 'ITM control register write ignored: ITM is locked (write 0xC5ACCE55 to ITM_LAR first)')
      return
    }
    const v = value >>> 0
    switch (off) {
      case 0xe00:
        this.itmTer = v
        return
      case 0xe40:
        this.itmTpr = v & 0xf
        return
      case 0xe80:
        this.itmTcr = v & 0x00ff3f1f
        return
      default:
        this.unimplemented(off, true)
    }
  }
}
