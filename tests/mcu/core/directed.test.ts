/**
 * Directed tests for what the random differential vectors cannot reach
 * (they never raise exceptions and run with an idle NVIC): IT state across
 * interrupts, SVC and faults, BKPT inside IT, the exclusive monitor (incl.
 * the HAL's ATOMIC_SET_BIT on the real STM32F103 USART registers), PC writes
 * in Handler mode, CONTROL/BASEPRI/PRIGROUP/PRIMASK/FAULTMASK corners,
 * tail-chaining vs. masking, ICSR fields and SysTick reload/COUNTFLAG
 * corners. firmware/tests/isa/directed.s and strex_soc.s carry the programs;
 * every expected value is derived here from the cited DDI 0403E rule.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCortexM3 } from '../../../src/mcu/core/cpu'
import { loadElf } from '../../../src/mcu/loader'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { FIXTURES, fixture, hex, loadElfFile, makeMachine, type Machine } from './harness'

const H = (...v: number[]) => v.map(hex)
const T = 1 << 24 // EPSR.T
/** ITAdvance() (A7.3.3) */
const itAdvance = (s: number) => ((s & 7) === 0 ? 0 : (s & 0xe0) | ((s << 1) & 0x1f))
/** ITSTATE as it appears in the xPSR: IT[1:0] → bits 26:25, IT[7:2] → bits 15:10 (B1.4.2) */
const itBits = (s: number) => ((s & 3) << 25) | ((s >> 2) << 10)
const CFSR_IACCVIOL = 1 << 0
const CFSR_PRECISERR = 1 << 9
const CFSR_BFARVALID = 1 << 15
const CFSR_UNDEFINSTR = 1 << 16
const HFSR_FORCED = 1 << 30

describe('directed corner cases (directed.s)', () => {
  const m = fixture('directed')
  const why = m.runToStop(3_000_000)
  const L = m.bus.logWrites.map(hex)
  const S = (n: string) => m.sym(n)
  /** the IT instruction's ITSTATE (its low byte) at `addr` */
  const itAt = (addr: number) => m.bus.read16(addr) & 0xff
  /** log entries after checkpoint `from` up to and including checkpoint `to` */
  const seg = (from: number | null, to: number) => {
    const a = from === null ? -1 : L.indexOf(hex(from))
    const b = L.indexOf(hex(to))
    return L.slice(a + 1, b + 1)
  }

  it('D: BKPT inside an IT block whose condition fails still executes (A7.7.17) and halts on it', () => {
    expect(why).toBe('breakpoint')
    expect(m.logs.at(-1)?.message).toBe(`BKPT #5 at ${hex(S('d_bkpt'))}: core halted`)
    expect(m.core.registers().r[15]).toBe(S('d_bkpt'))
    // halted ON the BKPT: ITSTATE is still that of the BKPT slot (IT NE = 0x18), not advanced
    expect(m.core.it).toBe(itAt(S('d_it')))
    expect(m.core.it).toBe(0x18)
  })

  it('reports only the two deliberate faults besides the BKPT', () => {
    expect(m.logs.map((l) => l.message)).toEqual([
      expect.stringMatching(new RegExp(`^precise BusFault: read from 0x60000000 at pc ${hex(S('c_load'))}`)),
      expect.stringMatching(/^instruction fetch from execute-never address 0xfffffff8/),
      expect.stringMatching(/^BKPT #5 /),
    ])
  })

  it('A: an interrupt inside ITETE stacks the advanced ITSTATE and the next slot as return address; the rest of the block resumes with the stacked flags', () => {
    const st = itAdvance(itAt(S('a_store') - 2))
    // IRQ0 sees xPSR = Z C (CMP r0, #0) | T | IT of slot 2; r4 (NE) and r6 (NE) untouched, r5 (EQ) += 2
    expect(seg(null, 0xd001)).toEqual(H(0x100, 0x60000000 | T | itBits(st), S('a_next'), 0x200, 0, 2, 0, 0xd001))
    expect(st).toBe(0x16) // ITETE EQ = 0x0B advanced once
  })

  it('B: a conditional SVC whose condition fails is not taken; a taken one returns into the ELSE slot, which stays skipped', () => {
    const st = itAdvance(itAt(S('b_next') - 4))
    expect(seg(0xd001, 0xd002)).toEqual(H(0x1b0, 2, 0x60000000 | T | itBits(st), S('b_next'), 0, 0xd002))
  })

  it('C: a precise BusFault inside an IT block stacks the faulting instruction with its own ITSTATE; the retry completes the block', () => {
    const st = itAt(S('c_load') - 2) // not advanced: the instruction did not complete
    expect(seg(0xd002, 0xd003)).toEqual(
      H(0x1f3, S('c_load'), 0x60000000 | T | itBits(st), CFSR_PRECISERR | CFSR_BFARVALID, HFSR_FORCED, 0xc0de1234, 0, 0xd003),
    )
  })

  it('E: exclusive monitor — entry and return clear it, CLREX/STREX close it; no address tag, plain stores keep it (Cortex-M3); device registers; the ATOMIC_SET_BIT retry', () => {
    expect(seg(0xd003, 0xd005)).toEqual(
      H(
        0, // E1 STREX succeeds
        0x101, 0x201, 1, // E2 IRQ1 between LDREX and STREX → fails
        0, // E3 plain store to the word in between → still succeeds
        0, 0x5a5a, // E4 STREX to the next word succeeds and stores
        1, 1, // E5 after CLREX; a second STREX
        0x1b0, 9, 1, // E6 LDREX inside SVC, exception return clears the monitor
        0, 0x90, // E7 device register
        0x101, 0x201, 2, 0x190, // E8 two attempts, both bits set
        0xd005,
      ),
    )
  })

  it('F: LDM/LDMDB {Rn, PC} without write-back load Rn and branch (LoadWritePC)', () => {
    expect(seg(0xd005, 0xd006)).toEqual(H(0x11112222, 0x33334444, 0xd006))
  })

  it('H/I: MOV PC, LR in Handler mode is BranchWritePC (IACCVIOL at 0xFFFFFFF8); POP/LDR PC return; SPSEL write ignored in Handler mode; nPRIV applies to Thread', () => {
    expect(seg(0xd006, 0xd007)).toEqual(
      H(
        0x1b0, 3,
        0x1f3, 0xfffffff8, 0x60000000 | T | 11, CFSR_IACCVIOL, HFSR_FORCED, // fault in SVCall, MemManage disabled
        11, // resumed in SVCall
        0x1b0, 4, 0x4b4,
        0x1b0, 5, 0x5b5,
        0x1b0, 6, 0, 1, // CONTROL after writing SPSEL / nPRIV in Handler mode
        1, 0, // Thread: CONTROL = nPRIV; MRS BASEPRI reads 0 unprivileged (B5.2.2)
        0x1b0, 7, 0, 0x80, // privileged again: BASEPRI kept 0x80 (the unprivileged MSR was ignored)
        0xd007,
      ),
    )
  })

  it('J: BASEPRI keeps only the 4 implemented bits (0x0F masks nothing); BASEPRI_MAX only raises the masking level', () => {
    expect(seg(0xd007, 0xd008)).toEqual(H(0, 0x102, 0x202, 0x10, 0x00412000, 0x10, 0x102, 0x202, 0xd008))
  })

  it('K: BASEPRI is compared by group priority: with PRIGROUP 5 it masks 0x60 (group 0x40) but not 0x20', () => {
    expect(seg(0xd008, 0xd009)).toEqual(H(0x106, 0xfffffff9, 0x206, 0x00413000, 0x103, 0x203, 0xd009))
  })

  it('L: a pending IRQ that cannot preempt the masked Thread context is not tail-chained; it is taken after CPSIE', () => {
    expect(seg(0xd009, 0xd00b)).toEqual(H(0x105, 0x205, 0xd00a, 1, 0x104, 0xfffffff9, 0x00000814, 0x204, 0xd00b))
  })

  it('M: returning from a nested handler tail-chains into a pending priority between it and the preempted handler (LR F1, RETTOBASE 0)', () => {
    expect(seg(0xd00b, 0xd00c)).toEqual(H(0x107, 0x106, 0xfffffff1, 0x206, 0x104, 0xfffffff1, 0x00000014, 0x204, 0x207, 0xd00c))
  })

  it('N: a pending interrupt that is not enabled sets ICSR.ISRPENDING but not VECTPENDING', () => {
    expect(seg(0xd00c, 0xd00d)).toEqual(H(0x00400000, 0, 0xd00d))
  })

  it('O: with PRIMASK set a UsageFault still escalates to a HardFault that is taken (priority -1 < 0)', () => {
    const s = seg(0xd00d, 0xd00e)
    expect([s[0], s[1], s[3], s[4], s[5]]).toEqual(H(0x1f3, S('o_udf'), CFSR_UNDEFINSTR, HFSR_FORCED, 0xd00e))
    expect(parseInt(s[2], 16) & (T | 0x0600fc00 | 0x1ff)).toBe(T) // Thread, no IT
  })
})

describe('HAL ATOMIC_SET_BIT on the STM32F103 USART registers (strex_soc.s, real SoC + core)', () => {
  it('STREX to a peripheral register succeeds; an interrupt between LDREX and STREX costs exactly one retry', () => {
    const file = path.join(FIXTURES, 'strex_soc.elf')
    const parsed = loadElf(new Uint8Array(readFileSync(file)), 'strex_soc.elf')
    if (!parsed.ok) throw new Error(parsed.error)
    const mcu = new Stm32f103({ createCore: createCortexM3 })
    expect(mcu.loadFirmware(parsed.image).ok).toBe(true)
    mcu.reset('power-on')
    let why = ''
    for (let i = 0; i < 100 && (why === '' || why === 'target' || why === 'sleep'); i++) why = mcu.runUntil(mcu.time() + 1e-4)
    expect(why).toBe('breakpoint')
    const res = loadElfFile(file).symbols.get('results') as number
    const words = Array.from({ length: 7 }, (_, i) => mcu.bus.read32(res + 4 * i) >>> 0)
    // CR1: UE|TE in one attempt; CR3: DMAT after 2 attempts with 1 USART1 interrupt; CR1: TE cleared in one
    expect(words.map(hex)).toEqual(H(1, 0x2008, 2, 0x80, 1, 1, 0x2000))
    expect(mcu.bus.read32(0x4001380c) >>> 0).toBe(0x2000)
    expect(mcu.bus.read32(0x40013814) >>> 0).toBe(0x80)
  })
})

/** a flash image: vector table (SP, reset, NMI ... IRQ47) + Thumb code at 0x08000100 */
function image(code: number[], vectors: Record<number, number> = {}): Machine {
  const m = makeMachine(null)
  const img = new Uint8Array(0x100 + 2 * code.length)
  const dv = new DataView(img.buffer)
  dv.setUint32(0, 0x20001000, true)
  dv.setUint32(4, 0x08000101, true)
  for (const [n, a] of Object.entries(vectors)) dv.setUint32(4 * Number(n), a, true)
  code.forEach((h, i) => dv.setUint16(0x100 + 2 * i, h, true))
  m.bus.loadFlash(0x08000000, img)
  m.core.reset()
  return m
}

describe('priority boosting to -1', () => {
  it('a fault with FAULTMASK set cannot be taken: lockup at priority -1 (B1.5.15); NMI (-2) still preempts', () => {
    // 0x100: CPSID f; 0x102: UDF #0; 0x104: NMI handler `b .`
    const m = image([0xb671, 0xde00, 0xe7fe], { 2: 0x08000105 })
    expect(m.core.run(1000)).toBe('lockup')
    expect(m.core.lockedUp).toBe(true)
    const f = m.core.faultInfo()
    expect(f.cfsr & CFSR_UNDEFINSTR).toBe(CFSR_UNDEFINSTR)
    expect(f.hfsr & HFSR_FORCED).toBe(HFSR_FORCED)
    expect(m.logs.at(-1)?.message).toMatch(/^core LOCKUP: UsageFault at 0x08000102 while executing at priority -1 \(FAULTMASK set\)/)
    m.core.pendNmi()
    expect(m.core.lockedUp).toBe(false)
    m.core.run(m.clock.cycles + 100)
    expect(m.core.registers().xpsr & 0x1ff).toBe(2) // in the NMI handler
  })
})

describe('IT state at exception boundaries (host-driven)', () => {
  it('an interrupt taken between IT and its first slot stacks the whole ITSTATE; both slots then run as THEN/ELSE', () => {
    // 0x100 MOVS r0, #0 (Z = 1); 0x102 ITE EQ; 0x104 ADDEQ r1, #1; 0x106 ADDNE r2, #1; 0x108 B .
    // IRQ0 handler at 0x10A: MOVS r0, #1 (Z = 0); BX LR
    const m = image([0x2000, 0xbf0c, 0x3101, 0x3201, 0xe7fe, 0x2001, 0x4770], { 16: 0x0800010b })
    m.core.scs.write(0xe000e100, 1, 4, false) // NVIC_ISER0: IRQ0
    m.core.stepInstruction()
    m.core.stepInstruction()
    expect(m.core.registers().r[15]).toBe(0x08000104)
    expect(m.core.it).toBe(0x0c)
    m.core.pendIrq(0)
    m.core.halted = false
    m.core.run(m.clock.cycles + 200)
    const R = m.core.registers()
    expect(R.r[1]).toBe(1) // THEN slot ran (Z restored from the frame)
    expect(R.r[2]).toBe(0) // ELSE slot skipped: ITSTATE came back with the frame
    expect(R.r[15]).toBe(0x08000108)
    expect(m.core.it).toBe(0)
  })

  it('a frame whose EPSR holds ICI (IT[3:0] = 0) is not an IT block on return: the next instruction runs unconditionally', () => {
    // 0x100 SVC #0; 0x102 ADDS r1, #1; 0x104 B .
    // SVC handler at 0x106: LDR r0, =0x01004000 (T | ICI = 0b0100, N = 0); STR r0, [SP, #28]; BX LR
    const m = image([0xdf00, 0x3101, 0xe7fe, 0x4803, 0x9007, 0x4770, 0xbf00, 0xbf00, 0xbf00, 0xbf00, 0x4000, 0x0100], { 11: 0x08000107 })
    m.core.run(300)
    const R = m.core.registers()
    expect(R.r[1]).toBe(1) // an IT reading of 0x40 (MI with N = 0) would have skipped it
    expect(R.r[15]).toBe(0x08000104)
    expect(m.logs.map((l) => l.message)).toContain('exception return with EPSR.ICI = 4: the multiple load/store restarts')
  })
})

describe('SysTick reload and COUNTFLAG corners (B3.3, white box)', () => {
  const CSR = 0xe000e010
  const RVR = 0xe000e014
  const CVR = 0xe000e018
  const ICSR = 0xe000ed04
  const PENDSTSET = 1 << 26
  const COUNTFLAG = 1 << 16
  const wr = (m: Machine, a: number, v: number) => m.core.scs.write(a, v, 4, false)
  const rd = (m: Machine, a: number) => m.core.scs.read(a, 4, false) >>> 0
  /** core clock, started at t0 with VAL = 0: tick 1 reloads LOAD, the count reaches 0 at tick LOAD+1 */
  const valAt = (load: number, ticks: number) => (ticks === 0 ? 0 : load - ((ticks - 1) % (load + 1)))
  const start = (load: number, ctrl: number): { m: Machine; t0: number } => {
    const m = fixture('spin')
    m.core.primask = 1 // keep SysTick pending instead of taken (ICSR shows it)
    m.core.run(200)
    wr(m, RVR, load)
    wr(m, CVR, 0)
    const t0 = m.clock.cycles
    wr(m, CSR, ctrl)
    return { m, t0 }
  }

  it('enabling with VAL = 0 reloads on the first tick without COUNTFLAG or an interrupt; the first 1→0 comes LOAD ticks later', () => {
    const { m, t0 } = start(99, 7) // ENABLE | TICKINT | CLKSOURCE
    m.core.run(t0 + 3)
    expect(rd(m, CVR)).toBe(valAt(99, m.clock.cycles - t0))
    expect(rd(m, CSR) & COUNTFLAG).toBe(0)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    m.core.run(t0 + 99)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    m.core.run(t0 + 104)
    expect(rd(m, ICSR) & PENDSTSET).toBe(PENDSTSET)
    expect(rd(m, CSR) & COUNTFLAG).toBe(COUNTFLAG)
  })

  it('COUNTFLAG (TICKINT = 0) is set by the wrap, cleared by reading CSR but not by reading VAL, and set again only by the next wrap', () => {
    const { m, t0 } = start(49, 5)
    m.core.run(t0 + 40)
    expect(rd(m, CSR) & COUNTFLAG).toBe(0)
    m.core.run(t0 + 60)
    rd(m, CVR)
    expect(rd(m, CSR) & COUNTFLAG).toBe(COUNTFLAG)
    expect(rd(m, CSR) & COUNTFLAG).toBe(0)
    m.core.run(t0 + 95)
    expect(rd(m, CSR) & COUNTFLAG).toBe(0)
    m.core.run(t0 + 105) // second wrap at t0 + 100
    expect(rd(m, CSR) & COUNTFLAG).toBe(COUNTFLAG)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0) // no TICKINT, no exception
  })

  it('a LOAD write mid-count leaves the running count alone and takes effect at the next reload', () => {
    const { m, t0 } = start(99, 5)
    m.core.run(t0 + 50)
    const before = rd(m, CVR)
    wr(m, RVR, 9)
    expect(rd(m, CVR)).toBe(before)
    m.core.run(t0 + 90)
    expect(rd(m, CVR)).toBe(valAt(99, m.clock.cycles - t0)) // still the old period
    m.core.run(t0 + 105)
    // reached 0 at tick 100, reloaded 9 at tick 101
    const ticks = m.clock.cycles - t0
    expect(rd(m, CVR)).toBe(9 - (ticks - 101))
  })

  it('a VAL write moves the next wrap: reload on the next tick, interrupt LOAD + 1 ticks after the write', () => {
    const { m, t0 } = start(999, 7)
    m.core.run(t0 + 500)
    const t1 = m.clock.cycles
    wr(m, CVR, 0xabc) // any value clears VAL (and COUNTFLAG)
    expect(rd(m, CVR)).toBe(0)
    m.core.run(t0 + 1010) // the old wrap time
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    m.core.run(t1 + 995)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    m.core.run(t1 + 1005)
    expect(rd(m, ICSR) & PENDSTSET).toBe(PENDSTSET)
  })

  it('LOAD = 0 written mid-count: the running count still reaches 0 once (COUNTFLAG + interrupt), then the counter stays at 0', () => {
    const { m, t0 } = start(99, 7)
    m.core.run(t0 + 30)
    wr(m, RVR, 0)
    m.core.run(t0 + 105)
    expect(rd(m, CSR) & COUNTFLAG).toBe(COUNTFLAG)
    expect(rd(m, ICSR) & PENDSTSET).toBe(PENDSTSET)
    wr(m, ICSR, 1 << 25) // PENDSTCLR
    m.core.run(t0 + 600)
    expect(rd(m, CVR)).toBe(0)
    expect(rd(m, CSR) & COUNTFLAG).toBe(0)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
  })

  it('a pended SysTick stays pending when TICKINT is cleared; PENDSTCLR removes it', () => {
    const { m, t0 } = start(49, 7)
    m.core.run(t0 + 60)
    expect(rd(m, ICSR) & PENDSTSET).toBe(PENDSTSET)
    wr(m, CSR, 5)
    expect(rd(m, ICSR) & PENDSTSET).toBe(PENDSTSET)
    wr(m, ICSR, 1 << 25)
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    m.core.run(t0 + 200) // further wraps: COUNTFLAG only
    expect(rd(m, ICSR) & PENDSTSET).toBe(0)
    expect(rd(m, CSR) & COUNTFLAG).toBe(COUNTFLAG)
  })

  it('switching CLKSOURCE mid-count keeps the count and continues at the reference-clock rate', () => {
    const { m, t0 } = start(999, 5)
    m.core.run(t0 + 100)
    wr(m, CSR, 1) // reference clock: one tick per systickRefDivider() = 8 cycles
    const t1 = m.clock.cycles
    const v1 = rd(m, CVR)
    expect(v1).toBe(valAt(999, t1 - t0))
    m.core.run(t1 + 400)
    const ticks = Math.floor(m.clock.cycles / 8) - Math.floor(t1 / 8)
    expect(rd(m, CVR)).toBe(v1 - ticks)
  })
})
