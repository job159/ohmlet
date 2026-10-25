/**
 * ARMv7-M Cortex-M3 core: registers, the fetch/decode/execute loop, memory
 * routing (bit-band, internal PPB), the exception model of DDI 0403E §B1.5
 * (entry, return, tail-chaining, late arrival, escalation, lockup), sleep
 * (WFI/WFE/SLEEPONEXIT) and the debug surface of cpu-api.ts.
 *
 * Execution: instructions are decoded once per address into per-4-KiB-page
 * arrays (handler + integer fields, see decode.ts / exec.ts) and run from
 * there; the cache follows SystemBus.codeVersion / codeWriteRange so
 * self-modifying code, flash programming and image reloads stay correct.
 * The loop allocates nothing per instruction.
 *
 * Time: clock.cycles is written before every instruction. Due scheduler
 * events run at instruction boundaries; pending exceptions are evaluated
 * only when something that can change them happened (`excDirty`), and the
 * boundary slow path is entered only when flagged (`limit = -1`) or when the next
 * event / the run target is reached, so straight-line code pays one compare
 * per instruction.
 *
 * Deviations from silicon (documented, deliberate):
 *  - zero-wait-state memory: flash wait states and bus contention are not
 *    modeled (see the cycle table in exec.ts);
 *  - late arrival is approximated: events falling inside the 12 stacking
 *    cycles run after the stack push and a higher-priority exception that
 *    became pending then is vectored instead of the original one;
 *  - SLEEPONEXIT unstacks before sleeping (the hardware may skip the
 *    unstack/restack pair): identical architectural state, more bus traffic;
 *  - a derived exception on stacking (STKERR/MSTKERR) is pended and then
 *    competes by priority like a late-arriving exception;
 *  - CCR.BFHFNMIGN is stored but faulting loads are not ignored at
 *    priority < 0 (logged once).
 */
import { decodeThumb, newDecoded, type Decoded } from './decode'
import { bkpt as BKPT, condPassed, P, R_ZERO, UFSR_INVPC, UFSR_INVSTATE, UFSR_UNALIGNED, UFSR_UNDEFINSTR, type Handler } from './exec'
import {
  BFSR_BFARVALID,
  BFSR_IBUSERR,
  BFSR_PRECISERR,
  BFSR_STKERR,
  BFSR_UNSTKERR,
  CCR_BFHFNMIGN,
  CCR_DIV_0_TRP,
  CCR_NONBASETHRDENA,
  CCR_STKALIGN,
  CCR_UNALIGN_TRP,
  DFSR_BKPT,
  DFSR_HALTED,
  EXC_BUSFAULT,
  EXC_HARDFAULT,
  EXC_MEMMANAGE,
  EXC_NMI,
  EXC_SVCALL,
  EXC_USAGEFAULT,
  HFSR_FORCED,
  HFSR_VECTTBL,
  MMFSR_IACCVIOL,
  SCR_SLEEPDEEP,
  SCR_SLEEPONEXIT,
  Scs,
  type ScsCore,
} from './scs'
import { BusFault, type CycleClock, type Scheduler, type StopReason, type SystemBus } from './types'
import type { CoreConfig, CoreFaultInfo, CoreHooks, CoreRegisters, CortexMCore, CreateCortexM3 } from './cpu-api'

/** thrown (never escapes run()) after a synchronous fault has been recorded and pended */
const FAULT = { fault: true }

/** sentinel handler of a not-yet-decoded slot */
const UNDECODED: Handler = () => {
  throw new Error('undecoded slot executed')
}

const PAGE_SHIFT = 12
const PAGE_SLOTS = 1 << (PAGE_SHIFT - 1)

/** decoded instructions of one 4 KiB page: handler per halfword slot + 8 ints (a b c d size) */
class Page {
  readonly fn: Handler[] = new Array<Handler>(PAGE_SLOTS).fill(UNDECODED)
  readonly f = new Int32Array(PAGE_SLOTS * 8)
}

/**
 * Address-space classes by addr[31:25] (32 MiB granules) for the access fast paths.
 * Loads:  0 memory (direct), 1 device (direct; may schedule events → limit = -1), 2 slow path.
 * Stores: 0 SRAM (direct; code-version check), 1 device/flash (direct + limit = -1), 2 slow path.
 * Slow: bit-band aliases 0x22000000/0x42000000, everything from 0x80000000 (internal PPB,
 * external PPB, unsigned-address handling).
 */
const LD_KIND = new Uint8Array(128)
const ST_KIND = new Uint8Array(128)
for (let g = 0; g < 128; g++) {
  if (g < 0x10) {
    LD_KIND[g] = 0
    ST_KIND[g] = 1 // code region: flash programming goes through the FPEC
  } else if (g < 0x20) {
    LD_KIND[g] = 0
    ST_KIND[g] = 0
  } else if (g < 0x40) {
    LD_KIND[g] = 1
    ST_KIND[g] = 1
  } else {
    LD_KIND[g] = 2
    ST_KIND[g] = 2
  }
}
LD_KIND[0x11] = ST_KIND[0x11] = 2 // 0x22000000-0x23FFFFFF SRAM bit-band alias
LD_KIND[0x21] = ST_KIND[0x21] = 2 // 0x42000000-0x43FFFFFF peripheral bit-band alias

const hex = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(8, '0')

export class CortexM3 implements CortexMCore, ScsCore {
  readonly scs: Scs

  // ------------------------------------------------- architectural state
  /** r0..r15, r16 = UNPREDICTABLE-destination sink, r17 = constant 0 */
  readonly r = new Int32Array(18)
  n = 0
  z = 0
  c = 0
  v = 0
  q = 0
  /** ITSTATE (EPSR.IT, 8 bits) */
  it = 0
  /** EPSR.T */
  tbit = 1
  /** IPSR: current exception number, 0 = Thread mode */
  ipsr = 0
  /** the stack pointer that is NOT selected (r[13] holds the active one) */
  private spOther = 0
  /** CONTROL.SPSEL / CONTROL.nPRIV */
  spsel = 0
  npriv = 0
  primask = 0
  basepri = 0
  faultmask = 0
  /** local exclusive monitor: 1 = Exclusive Access state */
  exclusive = 0
  /** WFE event register */
  eventReg = 0

  // -------------------------------------------- execution scratch fields
  /** 1 while an instruction inside an IT block executes */
  inIT = 0
  private curIt = 0
  private curPc = 0
  /** shifter carry-out, 64-bit product halves (exec.ts scratch) */
  sc = 0
  lo = 0
  hi = 0
  readonly tmp = new Int32Array(16)
  /** 1 during LDRT/STRT: the access uses unprivileged permissions */
  unpriv = 0
  /** pending/active/enable/priority/mask state changed: re-evaluate exceptions */
  excDirty = 1
  private takeExc = 0
  /**
   * The hot loop runs instructions while clock.cycles < limit = min(next
   * scheduler event, run target). Anything that needs boundary work (an IRQ
   * pended, a device access that may have scheduled an event, a mask change,
   * a sync request ...) sets limit = -1.
   */
  limit = -1
  private syncReq = false
  private fetching = false
  private codeVer = -1
  private readonly pages = new Map<number, Page>()
  private pageNo = -1
  private pfn: Handler[] = []
  private pf = new Int32Array(0)
  private readonly dec: Decoded = newDecoded()
  private readonly logged = new Set<string>()
  private bpArmed = 0
  private bpSkip = -1
  private haltReason: StopReason = 'halted'
  private sleepKind: 'wfi' | 'wfe' = 'wfi'
  private icount = 0

  private sleepingState = false
  private lockedUpState = false
  private lockupPri = 0
  private lockupExc = 0
  private lockupPc = 0
  private lockupLogged = true
  halted = false
  readonly breakpoints = new Set<number>()

  constructor(
    readonly bus: SystemBus,
    readonly scheduler: Scheduler,
    readonly clock: CycleClock,
    readonly hooks: CoreHooks,
    readonly config: CoreConfig,
  ) {
    this.scs = new Scs(this)
    this.scs.reset()
  }

  get sleeping(): boolean {
    return this.sleepingState
  }
  get lockedUp(): boolean {
    return this.lockedUpState
  }
  get instructions(): number {
    return this.icount
  }

  // ===================================================================== reset

  reset(): void {
    this.scs.reset()
    this.r.fill(0)
    this.n = this.z = this.c = this.v = this.q = 0
    this.it = 0
    this.ipsr = 0
    this.spsel = 0
    this.npriv = 0
    this.primask = this.basepri = this.faultmask = 0
    this.exclusive = 0
    this.eventReg = 0
    this.inIT = 0
    this.unpriv = 0
    this.syncReq = false
    this.bpSkip = -1
    this.setSleeping(false)
    this.lockedUpState = false
    this.spOther = 0 // SP_process
    this.r[14] = -1 // LR = 0xFFFFFFFF (B1.5.5)
    this.loadResetVectors()
    this.limit = -1
    this.excDirty = 1
  }

  /** TakeReset (B1.5.5): SP_main = vector[0] AND ~3, PC = vector[1] (bit 0 → EPSR.T) */
  private loadResetVectors(): void {
    let sp = 0
    let pc = 0
    try {
      sp = this.bus.read32(0)
      pc = this.bus.read32(4)
    } catch (e) {
      if (!(e instanceof BusFault)) throw e
      this.hooks.log?.('error', `reset: vector table at 0x00000000 is not readable (${e.reason})`)
    }
    if (sp & 3) {
      this.logOnce('reset-sp', 'info', `reset: initial SP ${hex(sp)} is not word aligned; SP_main[1:0] are RAZ, so SP = ${hex(sp & ~3)}`)
    }
    this.r[13] = sp & ~3
    this.r[15] = pc & ~1
    this.tbit = pc & 1
    if (this.tbit === 0) this.logOnce('reset-t', 'warning', `reset vector ${hex(pc)} has bit 0 clear: the first instruction raises INVSTATE`)
  }

  /** AIRCR.VECTRESET: local (core-only) reset */
  localReset(): void {
    this.reset()
  }

  clearAllActive(): void {
    this.scs.active.fill(0)
    this.ipsr = 0
    this.excDirty = 1
    this.limit = -1
  }

  // ============================================================== public API

  requestSync(): void {
    this.syncReq = true
    this.limit = -1
  }

  setIrqLine(irq: number, asserted: boolean): void {
    const scs = this.scs
    if (irq < 0 || irq >= scs.numIrq) {
      this.logOnce(`irq-range:${irq}`, 'warning', `setIrqLine: IRQ ${irq} does not exist (numIrq = ${scs.numIrq})`)
      return
    }
    const lv = asserted ? 1 : 0
    if (scs.irqLine[irq] === lv) return
    scs.irqLine[irq] = lv
    // a level-sensitive line pends its interrupt unless the handler is already active;
    // a line still asserted when the handler returns re-pends it (excReturn)
    if (lv && !scs.active[16 + irq]) scs.setPending(16 + irq)
  }

  pendIrq(irq: number): void {
    if (irq < 0 || irq >= this.scs.numIrq) return
    this.scs.setPending(16 + irq)
  }

  pendNmi(): void {
    this.scs.setPending(EXC_NMI)
    // NMI preempts a lockup at HardFault priority (B1.5.15)
    if (this.lockedUpState && this.lockupPri === -1) {
      this.lockedUpState = false
      this.hooks.log?.('info', 'NMI taken: leaving lockup')
    }
  }

  signalEvent(): void {
    this.eventReg = 1
    this.limit = -1
  }

  registers(): CoreRegisters {
    const r: number[] = []
    for (let i = 0; i < 16; i++) r.push(this.r[i] >>> 0)
    return {
      r,
      xpsr: this.xpsr(),
      msp: this.getMSP() >>> 0,
      psp: this.getPSP() >>> 0,
      primask: this.primask,
      basemask: this.basepri,
      faultmask: this.faultmask,
      control: (this.spsel << 1) | this.npriv,
    }
  }

  setRegister(n: number, value: number): void {
    if (n < 0 || n > 15) throw new RangeError(`setRegister: no register r${n}`)
    if (n === 13) this.r[13] = value & ~3
    else if (n === 15) {
      this.r[15] = value & ~1
      this.bpSkip = -1
    } else this.r[n] = value
    this.limit = -1
  }

  faultInfo(): CoreFaultInfo {
    const s = this.scs
    return { cfsr: s.cfsr >>> 0, hfsr: s.hfsr >>> 0, mmfar: s.mmfar >>> 0, bfar: s.bfar >>> 0 }
  }

  stepInstruction(): void {
    if (this.lockedUpState) return
    this.halted = false
    this.bpSkip = this.r[15]
    this.run(this.clock.cycles + 1)
    this.halted = true
    this.haltReason = 'halted'
    this.scs.dfsr |= DFSR_HALTED
  }

  // ==================================================================== run

  run(untilCycle: number): StopReason {
    if (this.halted) return 'halted'
    if (this.lockedUpState) return 'lockup'
    this.bpArmed = this.breakpoints.size > 0 ? 1 : 0
    this.limit = -1
    return this.loop(untilCycle)
  }

  /**
   * The hot loop: one iteration per instruction. Everything but fetch and
   * execute happens in boundary(), entered only when clock time reaches
   * `limit`. Page, retired-instruction count and PC live in locals; the
   * try/catch sits outside the inner loop so a fault costs nothing until it
   * happens and the faulting PC is still in scope.
   */
  private loop(until: number): StopReason {
    const R = this.r
    const clock = this.clock
    const undecoded = UNDECODED
    let cyc = clock.cycles
    let retired = 0
    let pc = 0
    let pageNo = -1
    let pfn = this.pfn
    let pf = this.pf
    for (;;) {
      try {
        for (;;) {
          if (cyc >= this.limit) {
            clock.cycles = cyc
            this.icount += retired
            retired = 0
            const stop = this.boundary(until)
            if (stop !== null) return stop
            cyc = clock.cycles
            pageNo = this.pageNo
            pfn = this.pfn
            pf = this.pf
          }
          pc = R[15]
          if (this.bpArmed !== 0 && this.breakpointHit(pc)) {
            clock.cycles = cyc
            this.icount += retired
            return 'breakpoint'
          }
          if (pc >>> PAGE_SHIFT !== pageNo) {
            this.selectPage(pc)
            pageNo = this.pageNo
            pfn = this.pfn
            pf = this.pf
          }
          const slot = (pc >>> 1) & (PAGE_SLOTS - 1)
          let fn = pfn[slot]
          if (fn === undecoded) fn = this.decodeSlot(slot, pc)
          const k = slot << 3
          clock.cycles = cyc
          R[15] = pc + pf[k + 4]
          const it = this.it
          if (it === 0) {
            cyc += fn(this, pf[k], pf[k + 1], pf[k + 2], pf[k + 3], pc)
          } else {
            // IT block: ITSTATE[7:4] is this instruction's condition; advance before
            // executing (an exception return inside the block restores ITSTATE itself).
            // BKPT is unconditional even inside an IT block (DDI 0403E A7.7.17).
            const next = (it & 7) === 0 ? 0 : (it & 0xe0) | ((it << 1) & 0x1f)
            if (condPassed(this, it >> 4) || fn === BKPT) {
              this.curIt = it
              this.inIT = 1
              this.it = next
              cyc += fn(this, pf[k], pf[k + 1], pf[k + 2], pf[k + 3], pc)
              this.inIT = 0
            } else {
              this.it = next
              cyc += 1
            }
          }
          retired++
        }
      } catch (e) {
        clock.cycles = cyc
        this.icount += retired
        retired = 0
        this.curPc = pc
        this.onThrow(e)
        if (this.lockedUpState) {
          this.lockupPc = pc
          this.logLockup()
          return 'lockup'
        }
        this.limit = -1
      }
    }
  }

  private breakpointHit(pc: number): boolean {
    if (this.bpSkip === pc) {
      // resuming from this breakpoint: execute the instruction once
      this.bpSkip = -1
      return false
    }
    if (!this.breakpoints.has(pc >>> 0)) return false
    this.bpSkip = pc
    this.halted = true
    this.haltReason = 'halted'
    this.scs.dfsr |= DFSR_BKPT
    return true
  }

  /**
   * Instruction-boundary slow path: code-cache sync, due events, halt/lockup,
   * sync requests, exception entry, sleep fast-forward, INVSTATE, run target.
   * Returns a stop reason or null to continue executing.
   */
  private boundary(until: number): StopReason | null {
    const clock = this.clock
    const sched = this.scheduler
    for (;;) {
      if (this.bus.codeVersion !== this.codeVer) this.syncCode()
      if (sched.nextAt() <= clock.cycles) {
        sched.runDue(clock.cycles)
        continue
      }
      if (this.lockedUpState) {
        this.logLockup()
        return 'lockup'
      }
      if (this.halted) {
        const why = this.haltReason
        this.haltReason = 'halted'
        return why
      }
      if (this.syncReq) {
        this.syncReq = false
        return 'sync'
      }
      if (this.excDirty !== 0) {
        this.excDirty = 0
        this.takeExc = this.selectTakeable()
      }
      if (this.takeExc !== 0) {
        if (clock.cycles >= until) return 'target'
        if (this.sleepingState) this.setSleeping(false)
        this.enterException(this.takeExc)
        continue
      }
      if (this.sleepingState) {
        if (this.wakeWithoutEntry()) {
          this.setSleeping(false)
          continue
        }
        const t = Math.min(sched.nextAt(), until)
        if (t === Infinity) return 'sleep'
        if (t > clock.cycles) clock.cycles = t
        if (clock.cycles >= until) return 'sleep'
        continue
      }
      if (this.tbit === 0) {
        // EPSR.T = 0: executing any instruction raises INVSTATE (B1.4.2)
        this.scs.cfsr |= UFSR_INVSTATE
        this.pendFault(EXC_USAGEFAULT)
        continue
      }
      if (clock.cycles >= until) return 'target'
      const nxt = sched.nextAt()
      this.limit = nxt < until ? nxt : until
      return null
    }
  }

  // ========================================================= decode cache

  private selectPage(pc: number): void {
    const a = pc >>> 0
    this.curPc = pc
    // default memory map execute-never regions (B3.1): Peripheral, Device, System
    if ((a >= 0x40000000 && a < 0x60000000) || a >= 0xa0000000) {
      this.scs.cfsr |= MMFSR_IACCVIOL
      this.logOnce(`xn:${a >>> PAGE_SHIFT}`, 'error', `instruction fetch from execute-never address ${hex(a)} → MemManage IACCVIOL`)
      this.pendFault(EXC_MEMMANAGE)
      throw FAULT
    }
    const no = a >>> PAGE_SHIFT
    let page = this.pages.get(no)
    if (page === undefined) {
      page = new Page()
      this.pages.set(no, page)
    }
    this.pageNo = no
    this.pfn = page.fn
    this.pf = page.f
  }

  private decodeSlot(slot: number, pc: number): Handler {
    const bus = this.bus
    const d = this.dec
    this.fetching = true
    const hw1 = bus.fetch16(pc >>> 0)
    const hw2 = hw1 >>> 11 >= 0x1d ? bus.fetch16((pc + 2) >>> 0) : 0
    this.fetching = false
    decodeThumb(hw1, hw2, pc, d)
    const f = this.pf
    const k = slot << 3
    f[k] = d.a
    f[k + 1] = d.b
    f[k + 2] = d.c
    f[k + 3] = d.d
    f[k + 4] = d.size
    this.pfn[slot] = d.fn
    if (d.unpredictable !== null) {
      const enc = d.size === 4 ? `${hw1.toString(16).padStart(4, '0')} ${hw2.toString(16).padStart(4, '0')}` : hw1.toString(16).padStart(4, '0')
      this.logOnce(`unpred:${pc}`, 'warning', `UNPREDICTABLE instruction ${enc} at ${hex(pc)} (${d.unpredictable}); executed per the ARM ARM pseudocode`)
    }
    return d.fn
  }

  /** executable memory changed behind our back (SystemBus.codeVersion moved) */
  private syncCode(): void {
    const v = this.bus.codeVersion
    const range = (this.bus as { codeWriteRange?: { start: number; end: number } }).codeWriteRange
    if (v === this.codeVer + 1 && range !== undefined && typeof range.start === 'number' && range.end - range.start <= 0x100000) {
      this.invalidate(range.start >>> 0, range.end >>> 0)
      // main flash is also executed through the boot alias at 0x00000000 (RM0008 §3.4)
      if (range.start >>> 0 >= 0x08000000 && range.end >>> 0 <= 0x10000000) this.invalidate(range.start - 0x08000000, range.end - 0x08000000)
    } else {
      this.pages.clear()
      this.pageNo = -1
    }
    this.codeVer = v
  }

  /** drop decoded instructions overlapping [start, end) (incl. a 32-bit one starting 2 bytes earlier) */
  private invalidate(start: number, end: number): void {
    for (let a = (start - 2) & ~1; a < end; a += 2) {
      const page = this.pages.get(a >>> PAGE_SHIFT)
      if (page === undefined) {
        a = (((a >>> PAGE_SHIFT) + 1) << PAGE_SHIFT) - 2 // skip the rest of an uncached page
        continue
      }
      page.fn[(a >>> 1) & (PAGE_SLOTS - 1)] = UNDECODED
    }
  }

  // ======================================================= memory access
  // Data accesses from instructions. addr is an int32 (two's complement of
  // the unsigned address); the fast paths only take addresses < 2^31.

  ld32(addr: number): number {
    if ((addr & 3) === 0) {
      const k = LD_KIND[addr >>> 25]
      if (k === 0) return this.bus.read32(addr) | 0
      if (k === 1) {
        const v = this.bus.read32(addr) | 0
        this.limit = -1
        return v
      }
    }
    return this.ldSlow(addr, 4) | 0
  }

  ld16(addr: number): number {
    if ((addr & 1) === 0) {
      const k = LD_KIND[addr >>> 25]
      if (k === 0) return this.bus.read16(addr)
      if (k === 1) {
        const v = this.bus.read16(addr)
        this.limit = -1
        return v
      }
    }
    return this.ldSlow(addr, 2)
  }

  ld8(addr: number): number {
    const k = LD_KIND[addr >>> 25]
    if (k === 0) return this.bus.read8(addr)
    if (k === 1) {
      const v = this.bus.read8(addr)
      this.limit = -1
      return v
    }
    return this.ldSlow(addr, 1)
  }

  st32(addr: number, v: number): void {
    if ((addr & 3) === 0) {
      const k = ST_KIND[addr >>> 25]
      if (k === 0) {
        this.bus.write32(addr, v >>> 0)
        if (this.bus.codeVersion !== this.codeVer) this.limit = -1
        return
      }
      if (k === 1) {
        this.bus.write32(addr, v >>> 0)
        this.limit = -1
        return
      }
    }
    this.stSlow(addr, v, 4)
  }

  st16(addr: number, v: number): void {
    if ((addr & 1) === 0) {
      const k = ST_KIND[addr >>> 25]
      if (k === 0) {
        this.bus.write16(addr, v)
        if (this.bus.codeVersion !== this.codeVer) this.limit = -1
        return
      }
      if (k === 1) {
        this.bus.write16(addr, v)
        this.limit = -1
        return
      }
    }
    this.stSlow(addr, v, 2)
  }

  st8(addr: number, v: number): void {
    const k = ST_KIND[addr >>> 25]
    if (k === 0) {
      this.bus.write8(addr, v)
      if (this.bus.codeVersion !== this.codeVer) this.limit = -1
      return
    }
    if (k === 1) {
      this.bus.write8(addr, v)
      this.limit = -1
      return
    }
    this.stSlow(addr, v, 1)
  }

  private privilegedAccess(): boolean {
    return this.unpriv === 0 && (this.ipsr !== 0 || this.npriv === 0)
  }

  private ldSlow(addr: number, size: 1 | 2 | 4): number {
    if (size !== 1 && (addr & (size - 1)) !== 0) {
      // unaligned LDR/LDRH: allowed unless CCR.UNALIGN_TRP (A3.2.1); performed as byte accesses
      if (this.scs.ccr & CCR_UNALIGN_TRP) this.usageFault(UFSR_UNALIGNED)
      let v = 0
      for (let i = 0; i < size; i++) v |= this.ld8((addr + i) | 0) << (8 * i)
      return size === 4 ? v | 0 : v
    }
    const a = addr >>> 0
    if (a >= 0xe0000000 && a < 0xe0040000) {
      this.limit = -1
      return this.scs.read(a, size, !this.privilegedAccess())
    }
    if ((a >= 0x22000000 && a < 0x24000000) || (a >= 0x42000000 && a < 0x44000000)) return this.bitbandRead(a, size)
    this.limit = -1
    return size === 4 ? this.bus.read32(a) : size === 2 ? this.bus.read16(a) : this.bus.read8(a)
  }

  private stSlow(addr: number, v: number, size: 1 | 2 | 4): void {
    if (size !== 1 && (addr & (size - 1)) !== 0) {
      if (this.scs.ccr & CCR_UNALIGN_TRP) this.usageFault(UFSR_UNALIGNED)
      for (let i = 0; i < size; i++) this.st8((addr + i) | 0, (v >>> (8 * i)) & 0xff)
      return
    }
    const a = addr >>> 0
    this.limit = -1
    if (a >= 0xe0000000 && a < 0xe0040000) {
      this.scs.write(a, v >>> 0, size, !this.privilegedAccess())
      return
    }
    if ((a >= 0x22000000 && a < 0x24000000) || (a >= 0x42000000 && a < 0x44000000)) {
      this.bitbandWrite(a, v, size)
      return
    }
    if (size === 4) this.bus.write32(a, v >>> 0)
    else if (size === 2) this.bus.write16(a, v)
    else this.bus.write8(a, v)
  }

  /**
   * Bit-band alias (Cortex-M3 TRM §3.7): alias word n of the 32 MiB alias maps
   * to bit (n & 7) of byte (n >> 3) of the 1 MiB bit-band region. An alias
   * access of size s becomes an access of size s to the aligned unit that
   * contains that byte (read) or a read-modify-write of it (write).
   */
  private bitbandTarget(a: number, size: 1 | 2 | 4): number {
    const off = a & 0x01ffffff
    const byte = (a & 0xf0000000) + (off >>> 5)
    return byte & ~(size - 1)
  }

  private bitbandRead(a: number, size: 1 | 2 | 4): number {
    const off = a & 0x01ffffff
    const byte = (a & 0xf0000000) + (off >>> 5)
    const unit = byte & ~(size - 1)
    const bit = (byte - unit) * 8 + ((off >>> 2) & 7)
    const v = size === 4 ? this.ld32(unit | 0) : size === 2 ? this.ld16(unit | 0) : this.ld8(unit | 0)
    return (v >>> bit) & 1
  }

  private bitbandWrite(a: number, value: number, size: 1 | 2 | 4): void {
    const off = a & 0x01ffffff
    const byte = (a & 0xf0000000) + (off >>> 5)
    const unit = this.bitbandTarget(a, size)
    const bit = (byte - unit) * 8 + ((off >>> 2) & 7)
    const cur = size === 4 ? this.ld32(unit | 0) : size === 2 ? this.ld16(unit | 0) : this.ld8(unit | 0)
    const nv = value & 1 ? cur | (1 << bit) : cur & ~(1 << bit)
    if (size === 4) this.st32(unit | 0, nv)
    else if (size === 2) this.st16(unit | 0, nv & 0xffff)
    else this.st8(unit | 0, nv & 0xff)
  }

  // ============================================================ PC writes

  /**
   * BXWritePC / LoadWritePC (A2.3.1): interworking, EXC_RETURN in Handler
   * mode. Returns the extra cycles of an exception return (unstack 10 /
   * tail-chain 6), 0 for a plain branch.
   */
  bxWritePC(addr: number): number {
    if (this.ipsr !== 0 && addr >>> 28 === 0xf) return this.exceptionReturn(addr)
    this.r[15] = addr & ~1
    if ((addr & 1) === 0) {
      // the T bit is cleared: the next instruction raises INVSTATE
      this.tbit = 0
      this.limit = -1
    }
    return 0
  }

  loadWritePC(addr: number): number {
    return this.bxWritePC(addr)
  }

  /** BLXWritePC: interworking only (no exception return through BLX) */
  blxWritePC(addr: number): void {
    this.r[15] = addr & ~1
    if ((addr & 1) === 0) {
      this.tbit = 0
      this.limit = -1
    }
  }

  // ===================================================== special registers

  xpsr(): number {
    return (
      ((this.n << 31) |
        (this.z << 30) |
        (this.c << 29) |
        (this.v << 28) |
        (this.q << 27) |
        ((this.it & 3) << 25) |
        (this.tbit << 24) |
        ((this.it >> 2) << 10) |
        this.ipsr) >>>
      0
    )
  }

  privileged(): boolean {
    return this.ipsr !== 0 || this.npriv === 0
  }

  getMSP(): number {
    return this.spsel ? this.spOther : this.r[13]
  }
  getPSP(): number {
    return this.spsel ? this.r[13] : this.spOther
  }
  private setMSP(v: number): void {
    if (this.spsel) this.spOther = v & ~3
    else this.r[13] = v & ~3
  }
  private setPSP(v: number): void {
    if (this.spsel) this.r[13] = v & ~3
    else this.spOther = v & ~3
  }
  private setSpsel(sel: number): void {
    if (sel === this.spsel) return
    const t = this.r[13]
    this.r[13] = this.spOther
    this.spOther = t
    this.spsel = sel
  }

  /** MRS (B5.2.2) */
  readSpecial(sysm: number): number {
    switch (sysm >> 3) {
      case 0: {
        let v = 0
        if (sysm & 1) v |= this.ipsr
        if ((sysm & 4) === 0) v |= (this.n << 31) | (this.z << 30) | (this.c << 29) | (this.v << 28) | (this.q << 27)
        return v // EPSR reads as zero
      }
      case 1:
        if (!this.privileged()) return 0
        return sysm === 8 ? this.getMSP() : sysm === 9 ? this.getPSP() : 0
      case 2:
        // PRIMASK/BASEPRI/FAULTMASK are read only when CurrentModeIsPrivileged() (unprivileged
        // reads give zero); CONTROL is readable at any privilege
        switch (sysm & 7) {
          case 0:
            return this.privileged() ? this.primask : 0
          case 1:
          case 2:
            return this.privileged() ? this.basepri : 0
          case 3:
            return this.privileged() ? this.faultmask : 0
          case 4:
            return (this.spsel << 1) | this.npriv
        }
    }
    return 0
  }

  /** MSR (B5.2.3) */
  writeSpecial(sysm: number, v: number, mask: number): void {
    const priv = this.privileged()
    switch (sysm >> 3) {
      case 0:
        if ((sysm & 4) === 0 && mask & 2) {
          this.n = (v >>> 31) & 1
          this.z = (v >>> 30) & 1
          this.c = (v >>> 29) & 1
          this.v = (v >>> 28) & 1
          this.q = (v >>> 27) & 1
        }
        return
      case 1:
        if (!priv) return
        if (sysm === 8) this.setMSP(v)
        else if (sysm === 9) this.setPSP(v)
        return
      case 2:
        if (!priv) return
        switch (sysm & 7) {
          case 0:
            this.primask = v & 1
            break
          case 1:
            this.basepri = v & this.scs.prioMask
            break
          case 2: {
            // BASEPRI_MAX: only raises the masking priority (lower non-zero value)
            const nv = v & this.scs.prioMask
            if (nv !== 0 && (nv < this.basepri || this.basepri === 0)) this.basepri = nv
            break
          }
          case 3:
            // FAULTMASK can only be set when executing above priority -1 (not in HardFault/NMI)
            if (this.executionPriority(false) > -1 || (v & 1) === 0) this.faultmask = v & 1
            break
          case 4:
            this.npriv = v & 1
            if (this.ipsr === 0) this.setSpsel((v >> 1) & 1)
            break
        }
        this.excDirty = 1
        this.limit = -1
    }
  }

  /** CPSIE/CPSID (B5.2.1): ignored when unprivileged */
  changeProcessorState(disable: number, flags: number): void {
    if (!this.privileged()) return
    if (flags & 2) this.primask = disable
    if (flags & 1) {
      if (!disable) this.faultmask = 0
      else if (this.executionPriority(false) > -1) this.faultmask = 1
    }
    this.excDirty = 1
    this.limit = -1
  }

  // ==================================================== exceptions: state

  executionPriority(ignorePrimask: boolean): number {
    return this.scs.executionPriority(ignorePrimask ? 0 : this.primask, this.basepri, this.faultmask)
  }

  /** exception that preempts right now (B1.5.4), or 0 */
  private selectTakeable(): number {
    const scs = this.scs
    const e = scs.bestPending()
    if (e === 0) return 0
    return scs.groupPri(scs.prio[e]) < this.executionPriority(false) ? e : 0
  }

  /** WFI wakes on an exception that would preempt if PRIMASK were 0; WFE on the event register */
  private wakeWithoutEntry(): boolean {
    if (this.sleepKind === 'wfe') {
      if (this.eventReg) {
        this.eventReg = 0
        return true
      }
      return false
    }
    const scs = this.scs
    const e = scs.bestPending()
    return e !== 0 && scs.groupPri(scs.prio[e]) < this.executionPriority(true)
  }

  private setSleeping(s: boolean): void {
    if (s === this.sleepingState) return
    this.sleepingState = s
    this.hooks.sleepChanged?.(s, (this.scs.scr & SCR_SLEEPDEEP) !== 0)
  }

  waitForInterrupt(): void {
    if (this.wfiWouldWake()) return
    this.sleepKind = 'wfi'
    this.setSleeping(true)
    this.limit = -1
  }

  private wfiWouldWake(): boolean {
    const scs = this.scs
    const e = scs.bestPending()
    return e !== 0 && scs.groupPri(scs.prio[e]) < this.executionPriority(true)
  }

  waitForEvent(): void {
    if (this.eventReg) {
      this.eventReg = 0
      return
    }
    this.sleepKind = 'wfe'
    this.setSleeping(true)
    this.limit = -1
  }

  sendEvent(): void {
    // single core: SEV sets the local event register (B1.5.18)
    this.eventReg = 1
  }

  divZeroTrap(): boolean {
    return (this.scs.ccr & CCR_DIV_0_TRP) !== 0
  }

  // ====================================================== exceptions: faults

  /** record a UsageFault cause, pend it (with escalation) and abandon the instruction */
  usageFault(bits: number): never {
    this.scs.cfsr |= bits
    this.pendFault(EXC_USAGEFAULT)
    throw FAULT
  }

  /**
   * Pend a synchronous fault, escalating to HardFault (HFSR.FORCED) when it is
   * disabled or cannot preempt the current execution priority (B1.5.15), and
   * to lockup when even HardFault cannot preempt (fault in HardFault/NMI or
   * with FAULTMASK set).
   */
  pendFault(exc: number): void {
    const scs = this.scs
    const ep = this.executionPriority(false)
    let target = exc
    if (exc !== EXC_HARDFAULT && (!scs.takeable(exc) || scs.groupPri(scs.prio[exc]) >= ep)) {
      target = EXC_HARDFAULT
      scs.hfsr |= HFSR_FORCED
    }
    if (target === EXC_HARDFAULT && ep <= -1) {
      this.lockup(ep, exc)
      return
    }
    scs.setPending(target)
    this.excDirty = 1
    this.limit = -1
  }

  private lockup(pri: number, exc: number): void {
    this.lockedUpState = true
    this.lockupPri = pri
    this.lockupExc = exc
    this.lockupPc = this.r[15]
    this.lockupLogged = false
    this.setSleeping(false)
    // the locked-up core fetches from 0xFFFFFFFE (B1.5.15)
    this.r[15] = 0xfffffffe | 0
  }

  private logLockup(): void {
    if (this.lockupLogged) return
    this.lockupLogged = true
    const names: Record<number, string> = { 2: 'NMI', 3: 'HardFault', 4: 'MemManage', 5: 'BusFault', 6: 'UsageFault', 11: 'SVCall' }
    const where = this.ipsr === EXC_NMI ? 'NMI handler' : this.ipsr === EXC_HARDFAULT ? 'HardFault handler' : 'FAULTMASK set'
    this.hooks.log?.(
      'error',
      `core LOCKUP: ${names[this.lockupExc] ?? `exception ${this.lockupExc}`} at ${hex(this.lockupPc)} while executing at priority ${this.lockupPri} ` +
        `(${where}); CFSR=${hex(this.scs.cfsr)} HFSR=${hex(this.scs.hfsr)}`,
    )
  }

  /** SVC: SVCall, escalated to HardFault when it cannot be taken now */
  supervisorCall(): void {
    const scs = this.scs
    const ep = this.executionPriority(false)
    if (scs.groupPri(scs.prio[EXC_SVCALL]) >= ep) {
      scs.hfsr |= HFSR_FORCED
      if (ep <= -1) {
        this.lockup(ep, EXC_SVCALL)
        throw FAULT
      }
      scs.setPending(EXC_HARDFAULT)
    } else scs.setPending(EXC_SVCALL)
    this.excDirty = 1
    this.limit = -1
  }

  /** BKPT: halting debug — the core halts on the BKPT (no semihosting) */
  breakpointInstruction(pc: number, imm: number): void {
    this.r[15] = pc
    // halted ON the BKPT: inside an IT block, ITSTATE stays that of the BKPT itself
    if (this.inIT !== 0) this.it = this.curIt
    this.scs.dfsr |= DFSR_BKPT
    this.halted = true
    this.haltReason = 'breakpoint'
    this.bpSkip = -1
    this.limit = -1
    this.hooks.log?.('info', `BKPT #${imm} at ${hex(pc)}: core halted`)
  }

  /** a thrown fault / bus error during an instruction: restore the instruction and pend the fault */
  private onThrow(e: unknown): void {
    if (!this.lockedUpState) this.r[15] = this.curPc
    if (this.inIT) {
      this.it = this.curIt
      this.inIT = 0
    }
    this.unpriv = 0
    this.limit = -1
    this.excDirty = 1
    if (e === FAULT) return
    if (e instanceof BusFault) {
      const scs = this.scs
      if (this.fetching) {
        this.fetching = false
        scs.cfsr |= BFSR_IBUSERR
        this.logOnce(`ibus:${e.addr}`, 'error', `instruction fetch BusFault at ${hex(e.addr)}: ${e.reason}`)
      } else {
        scs.cfsr |= BFSR_PRECISERR | BFSR_BFARVALID
        scs.bfar = e.addr >>> 0
        if (scs.ccr & CCR_BFHFNMIGN && this.executionPriority(false) < 0) {
          this.logOnce('bfhfnmign', 'warning', 'CCR.BFHFNMIGN is set but not modeled: the BusFault at priority < 0 is not ignored')
        }
        this.logOnce(`dbus:${this.curPc}`, 'warning', `precise BusFault: ${e.write ? 'write to' : 'read from'} ${hex(e.addr)} at pc ${hex(this.curPc)} (${e.reason})`)
      }
      this.pendFault(EXC_BUSFAULT)
      return
    }
    throw e
  }

  // ===================================================== exceptions: entry

  /** stacking + vectoring (B1.5.6), with late arrival and derived faults */
  private enterException(exc: number): void {
    const clock = this.clock
    this.pushStack(this.r[15])
    clock.cycles += 12
    // late arrival: events during the 12 stacking cycles may pend a higher-priority exception
    const sched = this.scheduler
    if (sched.nextAt() <= clock.cycles) sched.runDue(clock.cycles)
    const late = this.selectTakeable()
    if (late !== 0) exc = late
    this.exceptionTaken(exc)
  }

  /** PushStack (B1.5.6): 8-word frame, optional 8-byte alignment (CCR.STKALIGN → xPSR[9]) */
  private pushStack(returnAddress: number): void {
    const R = this.r
    const usePsp = this.spsel === 1 && this.ipsr === 0
    const sp = R[13]
    const align = (sp & 4) !== 0 && (this.scs.ccr & CCR_STKALIGN) !== 0 ? 1 : 0
    const frame = ((sp - 0x20) & ~(align << 2)) | 0
    const xpsr = (this.xpsr() & ~(1 << 9)) | (align << 9)
    try {
      this.st32(frame, R[0])
      this.st32(frame + 4, R[1])
      this.st32(frame + 8, R[2])
      this.st32(frame + 12, R[3])
      this.st32(frame + 16, R[12])
      this.st32(frame + 20, R[14])
      this.st32(frame + 24, returnAddress)
      this.st32(frame + 28, xpsr)
    } catch (e) {
      if (e === FAULT) {
        // stacking on an unaligned/odd SP cannot happen (SP[1:0] = 0); keep going
      } else if (e instanceof BusFault) {
        this.scs.cfsr |= BFSR_STKERR
        this.logOnce(`stkerr:${e.addr}`, 'error', `BusFault while stacking an exception frame at ${hex(e.addr)} (STKERR)`)
        this.pendFault(EXC_BUSFAULT)
      } else throw e
    }
    R[13] = frame
    R[14] = this.ipsr !== 0 ? 0xfffffff1 | 0 : usePsp ? 0xfffffffd | 0 : 0xfffffff9 | 0
  }

  /** ExceptionTaken (B1.5.6): vector fetch, Handler mode on MSP */
  private exceptionTaken(exc: number): void {
    const scs = this.scs
    let vec = 0
    for (;;) {
      try {
        vec = this.bus.read32((scs.vtor + 4 * exc) >>> 0)
        break
      } catch (e) {
        if (!(e instanceof BusFault)) throw e
        // a vector-table read error escalates to HardFault (HFSR.VECTTBL)
        scs.hfsr |= HFSR_VECTTBL
        this.logOnce(`vecttbl:${exc}`, 'error', `vector table read for exception ${exc} at ${hex(scs.vtor + 4 * exc)} failed: ${e.reason}`)
        if (exc === EXC_HARDFAULT || exc === EXC_NMI) {
          this.lockup(exc === EXC_NMI ? -2 : -1, exc)
          return
        }
        exc = EXC_HARDFAULT
      }
    }
    this.setSpsel(0)
    this.ipsr = exc
    this.it = 0
    this.tbit = vec & 1
    this.r[15] = vec & ~1
    scs.pend[exc] = 0
    scs.active[exc] = 1
    this.exclusive = 0
    this.eventReg = 1
    this.excDirty = 1
    this.limit = -1
  }

  // ==================================================== exceptions: return

  /**
   * ExceptionReturn (B1.5.8) with tail-chaining. Returns the cycles of the
   * return itself (unstacking 10, tail-chain 6) on top of the branch.
   */
  private exceptionReturn(er: number): number {
    const scs = this.scs
    const R = this.r
    const ret = this.ipsr
    this.limit = -1
    this.excDirty = 1
    if ((er & 0x0ffffff0) !== 0x0ffffff0) {
      this.logOnce('excret-bits', 'warning', `EXC_RETURN ${hex(er)} has bits[27:4] not all ones (UNPREDICTABLE); decoded by bits[3:0]`)
    }
    if (!scs.active[ret]) return this.invalidReturn(er, ret)
    const nested = scs.activeCount()
    let toThread: boolean
    let usePsp: boolean
    switch (er & 15) {
      case 1:
        if (nested === 1) return this.invalidReturn(er, ret)
        toThread = false
        usePsp = false
        break
      case 9:
        if (nested !== 1 && !(scs.ccr & CCR_NONBASETHRDENA)) return this.invalidReturn(er, ret)
        toThread = true
        usePsp = false
        break
      case 13:
        if (nested !== 1 && !(scs.ccr & CCR_NONBASETHRDENA)) return this.invalidReturn(er, ret)
        toThread = true
        usePsp = true
        break
      default:
        return this.invalidReturn(er, ret)
    }
    this.deactivate(ret)
    // tail-chaining: a pending exception that may preempt the context being returned to
    // is entered directly, reusing the stacked frame (B1.5.12)
    const chain = this.selectTakeable()
    if (chain !== 0) {
      R[14] = er
      this.exceptionTaken(chain)
      return 6
    }
    // PopStack
    const frameSp = usePsp ? this.getPSP() : this.getMSP()
    const tmp = this.tmp
    try {
      if (frameSp & 3) throw new BusFault(frameSp >>> 0, false, 'unaligned exception frame')
      for (let i = 0; i < 8; i++) tmp[i] = this.ld32((frameSp + 4 * i) | 0)
    } catch (e) {
      if (!(e instanceof BusFault)) throw e
      scs.cfsr |= BFSR_UNSTKERR
      this.logOnce(`unstk:${e.addr}`, 'error', `BusFault while unstacking an exception frame at ${hex(e.addr)} (UNSTKERR)`)
      // the return is abandoned; the derived BusFault is taken without a new frame
      this.takeDerivedNoStack(EXC_BUSFAULT, er)
      return 6
    }
    const psr = tmp[7]
    const newSp = ((frameSp + 0x20) | (((psr >>> 9) & 1) << 2)) | 0
    if (toThread) this.setSpsel(usePsp ? 1 : 0)
    if (usePsp) this.setPSP(newSp)
    else this.setMSP(newSp)
    R[0] = tmp[0]
    R[1] = tmp[1]
    R[2] = tmp[2]
    R[3] = tmp[3]
    R[12] = tmp[4]
    R[14] = tmp[5]
    const pc = tmp[6]
    if (pc & 1) this.logOnce('excret-pc', 'warning', `exception return to an odd address ${hex(pc)} (UNPREDICTABLE); bit 0 ignored`)
    R[15] = pc & ~1
    this.n = (psr >>> 31) & 1
    this.z = (psr >>> 30) & 1
    this.c = (psr >>> 29) & 1
    this.v = (psr >>> 28) & 1
    this.q = (psr >>> 27) & 1
    const it = ((psr >>> 25) & 3) | ((psr >>> 8) & 0xfc)
    if ((it & 0xf) === 0 && it !== 0) {
      // IT[3:0] = 0 is not an IT block (InITBlock(), A7.3.3): EPSR[15:12] then hold the ICI
      // continuation of an interrupted LDM/STM, which this core never creates (it completes
      // LDM/STM before taking an exception); the instruction restarts from its first register
      this.logOnce('excret-ici', 'info', `exception return with EPSR.ICI = ${(it >> 4) & 0xf}: the multiple load/store restarts`)
      this.it = 0
    } else this.it = it
    this.tbit = (psr >>> 24) & 1
    const ipsr = psr & 0x1ff
    this.ipsr = toThread ? 0 : ipsr
    this.exclusive = 0
    this.eventReg = 1
    // the stacked IPSR must agree with the mode encoded in EXC_RETURN
    if ((!toThread && ipsr === 0) || (toThread && ipsr !== 0)) {
      scs.cfsr |= UFSR_INVPC
      this.logOnce('excret-ipsr', 'error', `exception return: stacked IPSR ${ipsr} does not match EXC_RETURN ${hex(er)} (INVPC)`)
      this.pendFault(EXC_USAGEFAULT)
      return 10
    }
    if (toThread && nested === 1 && scs.scr & SCR_SLEEPONEXIT) {
      // SLEEPONEXIT: back to sleep on the return to Thread mode (B1.5.18)
      this.sleepKind = 'wfi'
      this.setSleeping(true)
    }
    return 10
  }

  private deactivate(exc: number): void {
    const scs = this.scs
    scs.active[exc] = 0
    if (exc !== EXC_NMI) this.faultmask = 0
    // level-sensitive line still asserted → pending again
    if (exc >= 16 && scs.irqLine[exc - 16]) scs.setPending(exc)
    this.excDirty = 1
  }

  /** illegal EXC_RETURN (B1.5.8): DeActivate, INVPC UsageFault taken without stacking, LR = EXC_RETURN */
  private invalidReturn(er: number, ret: number): number {
    this.deactivate(ret)
    this.scs.cfsr |= UFSR_INVPC
    this.logOnce(`invpc:${er}`, 'error', `illegal exception return ${hex(er)} from exception ${ret} (INVPC)`)
    this.takeDerivedNoStack(EXC_USAGEFAULT, er)
    return 6
  }

  /** enter a fault without pushing a new frame (the pseudocode's ExceptionTaken without PushStack) */
  private takeDerivedNoStack(exc: number, er: number): void {
    const scs = this.scs
    let target = exc
    const ep = this.executionPriority(false)
    if (!scs.takeable(exc) || scs.groupPri(scs.prio[exc]) >= ep) {
      target = EXC_HARDFAULT
      scs.hfsr |= HFSR_FORCED
      if (ep <= -1) {
        this.lockup(ep, exc)
        return
      }
    }
    this.r[14] = er | 0xf0000000
    this.exceptionTaken(target)
  }

  // ================================================================ misc

  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void {
    if (this.logged.has(key)) return
    this.logged.add(key)
    this.hooks.log?.(level, msg)
  }

  /** for tests / the debugger: drop every decoded instruction */
  flushDecodeCache(): void {
    this.pages.clear()
    this.pageNo = -1
  }
}

export const createCortexM3: CreateCortexM3 = (
  bus: SystemBus,
  scheduler: Scheduler,
  clock: CycleClock,
  hooks: CoreHooks,
  config: CoreConfig,
): CortexMCore => new CortexM3(bus, scheduler, clock, hooks, config)

// referenced to keep the cycle-table constant and register indices documented in one place
void P
void R_ZERO
void UFSR_UNDEFINSTR
