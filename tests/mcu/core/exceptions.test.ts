/**
 * Exception model and System Control Space (DDI 0403E §B1.5, §B3.2–B3.4),
 * driven by the firmware/tests/isa/exc_*.s programs. Each program reports
 * through the harness MMIO log; the expected sequences below are derived
 * by hand from the ARM ARM rules cited next to them.
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex, type Machine } from './harness'

const H = (...v: number[]) => v.map(hex)

function run(name: string, opts?: Parameters<typeof fixture>[1]): Machine {
  const m = fixture(name, opts)
  m.runToStop(2_000_000)
  return m
}
const log = (m: Machine) => m.bus.logWrites.map(hex)

describe('SVC, PendSV, stacking, tail-chaining, nesting (exc_svc.s)', () => {
  const m = run('exc_svc')
  const L = log(m)
  const svcRet = m.sym('svc_ret')

  it('halts on the final BKPT', () => {
    expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^BKPT #0 /)])
  })
  it('SVC from Thread/MSP: IPSR 11, LR 0xFFFFFFF9, 8-word frame r0-r3 r12 lr pc xpsr, stacked r0 returned', () => {
    // xPSR: N and V preset, T = 1, IPSR 0, bit 9 = 0 (SP 0x20005000 is 8-byte aligned)
    expect(L.slice(0, 13)).toEqual(
      H(11, 0xfffffff9, 42, 0x1000, 0x1001, 0x1002, 0x1003, 0x100c, 0x100e, svcRet, 0x91000000, 0x1001, 0x1001),
    )
  })
  it('PendSV pended from Thread mode is taken before the next instruction', () => {
    expect(L.slice(14, 18)).toEqual(H(0xe0, 14, 0xfffffff9, 0x2000))
  })
  it('lower-priority PendSV pended in SVC tail-chains: same EXC_RETURN, 6-cycle chain', () => {
    expect(L.slice(18, 22)).toEqual(H(11, 0xfffffff9, 1, 0x5100))
    // cycle stamps: SVC before its last 5 instructions vs PendSV's first load.
    // LDR 2 + LDC 2 + STR 2 + BX 3 (1+P) + tail-chain 6 + LDC 2 = 17 (exec.ts cycle table)
    expect(parseInt(L[23], 16) - parseInt(L[22], 16)).toBe(17)
    expect(L.slice(24, 28)).toEqual(H(0xe0, 14, 0xfffffff9, 0x3000))
  })
  it('higher-priority PendSV preempts SVC: EXC_RETURN 0xFFFFFFF1 (return to Handler)', () => {
    expect(L.slice(28, 31)).toEqual(H(11, 0xfffffff9, 2))
    expect(L.slice(32)).toEqual(H(0xe0, 14, 0xfffffff1, 0x5100, 0x4000))
  })
})

describe('NVIC priorities, masking, level lines, late arrival (exc_nvic.s)', () => {
  const m = run('exc_nvic')
  const L = log(m)
  const seg = (from: number, to: number) => {
    const a = L.indexOf(hex(from))
    const b = L.indexOf(hex(to))
    return L.slice(a + 1, b + 1)
  }

  it('halts on the final BKPT without unexpected exceptions', () => {
    expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^BKPT #0 /)])
  })
  it('A: higher priority nests (LR F1, IABR both), lower priority tail-chains; ICSR fields', () => {
    // ICSR in IRQ1: VECTACTIVE 17, RETTOBASE 0; in IRQ0 after pending IRQ3: VECTACTIVE 16, RETTOBASE 1, VECTPENDING 19, ISRPENDING
    expect(L.slice(0, 11)).toEqual(H(0x100, 0x101, 0xfffffff1, 0x11, 0x3, 0x201, 0x00413810, 0x200, 0x103, 0x203, 0xa001))
  })
  it('B: equal priorities are taken lowest exception number first, the second tail-chains', () => {
    expect(seg(0xa001, 0xa002)).toEqual(H(0x6, 0x00411000, 0x101, 0xfffffff9, 0x00412811, 0x2, 0x201, 0x102, 0x202, 0xa002))
  })
  it('C: PRIGROUP 6 puts 0x80 and 0xC0 in one group (no preemption); PRIGROUP 0 nests', () => {
    expect(seg(0xa002, 0xa003)).toEqual(H(0xfa050600, 0x103, 0x303, 0x203, 0x100, 0x200, 0xa003))
    expect(seg(0xa003, 0xa004)).toEqual(H(0x103, 0x100, 0x200, 0x303, 0x203, 0xa004))
  })
  it('D: BASEPRI 0x80 masks priority 0x80 but not 0x40 (VECTPENDING still reports the masked one)', () => {
    expect(seg(0xa004, 0xa005)).toEqual(H(0x101, 0xfffffff9, 0x00410811, 0x2, 0x201, 0xa005))
    expect(seg(0xa005, 0xa006)).toEqual(H(0x100, 0x200, 0xa006))
  })
  it('E: FAULTMASK masks priority 0 but not NMI', () => {
    expect(seg(0xa006, 0xa007)).toEqual(H(0x1ff, 2, 0x2ff, 0xa007))
    expect(seg(0xa007, 0xa008)).toEqual(H(0x107, 0x207, 0xa008))
  })
  it('F: a level line still asserted at exception return re-pends the IRQ', () => {
    expect(seg(0xa008, 0xa009)).toEqual(H(0x104, 0x204, 0x104, 0x204, 0xa009))
  })
  it('G: ICPR cannot clear an asserted line but clears a pulse-pended IRQ', () => {
    expect(seg(0xa009, 0xa00a)).toEqual(H(0x20, 0, 0xa00a))
  })
  it('H: STIR pends an external interrupt by number', () => {
    expect(seg(0xa00a, 0xa00b)).toEqual(H(0x106, 0xfffffff9, 0x40, 0x206, 0xa00b))
  })
  it('I: late arrival — a higher-priority IRQ asserted during stacking is vectored first (no nesting)', () => {
    // IRQ6 runs with LR = 0xFFFFFFF9 and only itself active, then IRQ3 tail-chains
    expect(seg(0xa00b, 0xa00c)).toEqual(H(0x106, 0xfffffff9, 0x40, 0x206, 0x103, 0x203, 0xa00c))
  })
})

describe('faults, escalation, fault status registers (exc_fault.s)', () => {
  const m = run('exc_fault')
  const L = log(m)
  const S = (n: string) => m.sym(n)
  /** fault record: 0xFA17, IPSR, CFSR, HFSR, [BFAR], stacked PC */
  const rec = (ipsr: number, cfsr: number, hfsr: number, pc: number, bfar?: number) =>
    H(0xfa17, ipsr, cfsr, hfsr, ...(bfar === undefined ? [] : [bfar]), pc)
  const seg = (from: number, to: number) => {
    const a = L.indexOf(hex(from))
    const b = to < 0 ? L.length : L.indexOf(hex(to))
    return L.slice(a + 1, b)
  }

  it('runs to completion; bus faults and XN fetches are logged', () => {
    expect(m.logs.at(-1)?.message).toMatch(/^BKPT #0 /)
    expect(m.logs.filter((l) => /UNPREDICTABLE/.test(l.message))).toEqual([])
  })
  it('UDF with UsageFault disabled escalates to HardFault (FORCED); enabled → UsageFault', () => {
    expect(seg(0xf001, 0xf002)).toEqual(rec(3, 0x10000, 0x40000000, S('udf1')))
    expect(seg(0xf002, 0xf003)).toEqual([...rec(6, 0x10000, 0, S('udf2')), hex(0)])
  })
  it('division by zero returns 0, or DIVBYZERO with CCR.DIV_0_TRP', () => {
    expect(seg(0xf003, 0xf004)).toEqual(rec(6, 0x02000000, 0, S('div1')))
  })
  it('BX to an even address: INVSTATE at the target, stacked PC = target', () => {
    expect(seg(0xf004, 0xf104)).toEqual(rec(6, 0x20000, 0, S('inv_target') & ~1))
  })
  it('UNALIGNED: LDR/LDRH only with UNALIGN_TRP; LDM/LDRD/LDREX always', () => {
    expect(seg(0xf005, 0xf006)).toEqual([
      ...rec(6, 0x01000000, 0, S('una1')),
      ...rec(6, 0x01000000, 0, S('una2')),
      hex(0),
      ...rec(6, 0x01000000, 0, S('una3')),
      ...rec(6, 0x01000000, 0, S('una4')),
      ...rec(6, 0x01000000, 0, S('una5')),
    ])
  })
  it('coprocessor/FP space → NOCP; DSP-extension encodings → UNDEFINSTR', () => {
    expect(seg(0xf006, 0xf007)).toEqual([
      ...rec(6, 0x80000, 0, S('nocp1')),
      ...rec(6, 0x80000, 0, S('nocp2')),
      ...rec(6, 0x10000, 0, S('dsp1')),
      ...rec(6, 0x10000, 0, S('dsp2')),
      ...rec(6, 0x10000, 0, S('dsp3')),
      ...rec(6, 0x10000, 0, S('dsp4')),
    ])
  })
  it('precise BusFault on unmapped memory: PRECISERR + BFARVALID, BFAR = address', () => {
    expect(seg(0xf007, 0xf008)).toEqual([
      ...rec(3, 0x8200, 0x40000000, S('bus1'), 0x30000000),
      ...rec(5, 0x8200, 0, S('bus2'), 0x30000004),
    ])
  })
  it('instruction fetch from execute-never space → MemManage IACCVIOL (HardFault when disabled)', () => {
    expect(seg(0xf008, 0xf009)).toEqual([...rec(3, 0x1, 0x40000000, 0x40000100), ...rec(4, 0x1, 0, 0xe0000200)])
  })
  it('unprivileged SCS access → BusFault with BFAR', () => {
    expect(seg(0xf009, 0xf00a)).toEqual([...rec(5, 0x8200, 0, S('unpriv1'), 0xe000ed00), hex(0)])
  })
  it('a fault that cannot preempt the running handler (same priority) escalates to HardFault', () => {
    expect(seg(0xf00a, 0xf10a)).toEqual(rec(3, 0x10000, 0x40000000, S('udf_svc')))
  })
  it('vector-table read error → HardFault with HFSR.VECTTBL', () => {
    expect(seg(0xf00b, 0xf10b)).toEqual(rec(3, 0, 0x2, S('after_ispr')))
    expect(seg(0xf10b, -1)).toEqual(H(0x08000000))
  })
})

describe('lockup (exc_lockup.s)', () => {
  it('a fault in the HardFault handler locks the core up; NMI leaves the lockup', () => {
    const m = fixture('exc_lockup')
    expect(m.runToStop(100_000)).toBe('lockup')
    expect(m.core.lockedUp).toBe(true)
    expect(m.core.registers().r[15]).toBe(0xfffffffe)
    expect(m.logs.at(-1)?.message).toBe(
      `core LOCKUP: UsageFault at ${hex(m.sym('udf_hardfault'))} while executing at priority -1 (HardFault handler); CFSR=0x00010000 HFSR=0x40000000`,
    )
    expect(log(m)).toEqual(H(1, 2, 0x40000000))
    // run() keeps returning 'lockup' without executing
    const c = m.clock.cycles
    expect(m.core.run(c + 1000)).toBe('lockup')
    expect(m.clock.cycles).toBe(c)
    // NMI (priority -2) preempts the locked-up HardFault context; it returns to 0xFFFFFFFE
    m.core.pendNmi()
    expect(m.runToStop(100_000)).toBe('breakpoint')
    expect(log(m).slice(3)).toEqual(H(3, 2, 0xfffffffe))
  })
})

describe('RTOS-style PSP context switch via SysTick + PendSV (exc_psp.s)', () => {
  const m = run('exc_psp')
  it('both tasks make progress with intact r4-r11 and Thread mode on PSP', () => {
    expect(m.logs.at(-1)?.message).toMatch(/^BKPT #0 /)
    const countA = m.r32(m.sym('countA'))
    const countB = m.r32(m.sym('countB'))
    const switches = m.r32(m.sym('switches'))
    expect(countA).toBeGreaterThanOrEqual(400)
    expect(countB).toBeGreaterThanOrEqual(400)
    expect(switches).toBeGreaterThan(10)
    expect(m.r32(m.sym('ticks'))).toBe(switches)
    // every PendSV saw EXC_RETURN "Thread, process stack"
    expect(new Set(log(m))).toEqual(new Set([hex(0xfffffffd)]))
    const regs = m.core.registers()
    expect(regs.control).toBe(2)
    expect(regs.r[13]).toBe(regs.psp)
    expect(regs.msp).toBe(0x20005000)
  })
})

describe('sleep: WFI / WFE / SEVONPEND / SLEEPONEXIT (exc_sleep.s)', () => {
  const m = run('exc_sleep')
  const L = log(m).map((x) => parseInt(x, 16))

  it('WFI fast-forwards to the waking interrupt without executing instructions', () => {
    const [entry, , t0, t1] = L
    // timer armed 6 cycles after t0 (LDC 2 + LDC 2 + STR start) for 100000 cycles; entry 12 + LDC 2 into the handler
    expect(entry).toBe(t0 + 6 + 100000 + 12 + 2)
    expect(t1).toBeGreaterThan(entry)
    expect(m.core.instructions).toBeLessThan(400)
    expect(m.sleepEvents.slice(0, 2)).toEqual([true, false])
  })
  it('WFI with PRIMASK set wakes but the IRQ is taken only after CPSIE', () => {
    expect(L.slice(4, 8)).toEqual([0x2001, L[5], 0x100, 0x2002])
  })
  it('SEV makes WFE return at once; SEVONPEND wakes WFE on a disabled IRQ becoming pending', () => {
    expect(L.slice(8, 10)).toEqual([0x3001, 0x2])
  })
  it('SLEEPONEXIT goes back to sleep after the handler instead of resuming Thread code', () => {
    expect(L.slice(11)).toEqual([0x100, L[12], 0x100, 0x4001])
    expect(L[12] - L[10]).toBeGreaterThanOrEqual(2000)
  })
})

describe('stack alignment and unaligned initial SP (exc_stack.s)', () => {
  it('r1p1 (CPUID 0x411FC231): STKALIGN resets to 0; frames 8-byte aligned only with STKALIGN=1 (xPSR[9])', () => {
    const m = run('exc_stack')
    expect(m.logs[0].message).toMatch(/initial SP 0x20004fff is not word aligned/)
    expect(log(m)).toEqual(
      H(0x20004ffc, 0, 0x20004fdc, 0x01000000, 0x20004ffc, 0x20004fd8, 0x01000200, 0x20004ffc, 0x20004fdc, 0x01000000, 0x20004ffc),
    )
  })
  it('r2p0 (CPUID 0x412FC230): STKALIGN resets to 1', () => {
    const m = run('exc_stack', { config: { cpuid: 0x412fc230 } })
    expect(log(m).slice(0, 4)).toEqual(H(0x20004ffc, 0x200, 0x20004fd8, 0x01000200))
  })
})

describe('System Control Space registers (exc_scs.s)', () => {
  const m = run('exc_scs')
  const L = log(m)
  const seg = (from: number, to: number) => L.slice(L.indexOf(hex(from)) + 1, L.indexOf(hex(to)))

  it('identification: CPUID, ICTR (43 IRQs → 1), CALIB, AIRCR VECTKEYSTAT, CCR, 24-bit LOAD', () => {
    expect(L.slice(0, 6)).toEqual(H(0x411fc231, 1, 0x2328, 0xfa050000, 0, 0x00345678))
  })
  it('SysTick on the core clock fires every LOAD+1 = 1000 cycles', () => {
    const t = seg(0x5101, 0x5102).map((x) => parseInt(x, 16))
    expect(t.length).toBe(5)
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBe(1000)
  })
  it('SysTick on the reference clock (systickRefDivider = 8) fires every 8 × 100 cycles', () => {
    const t = seg(0x5102, 0x5103).map((x) => parseInt(x, 16))
    expect(t.length).toBe(4)
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBe(800)
  })
  it('LOAD = 0 never wraps; COUNTFLAG is set by the wrap, cleared by reading CSR or writing VAL', () => {
    expect(seg(0x5103, 0x5104)).toEqual(H(7, 0x10005, 5, 5))
  })
  it('ICSR PENDSTSET pends SysTick; PENDSTCLR clears it', () => {
    const s = seg(0x5104, 0x5105)
    expect(s.slice(1)).toEqual(H(0x0400f000, 0))
  })
  it('DWT.CYCCNT counts core cycles only while enabled', () => {
    expect(seg(0x5105, 0x5106)).toEqual(H(12, 0))
  })
  it('ITM: locked until LAR is written; stimulus port 0 forwards bytes/words; TER and TRCENA gate it', () => {
    expect(seg(0x5106, 0x5107)).toEqual(H(1))
    expect(m.itm).toEqual([
      { port: 0, value: 0x4f, size: 1 },
      { port: 0, value: 0x4b, size: 1 },
      { port: 0, value: 0x12345678, size: 4 },
    ])
    expect(m.logs.some((l) => /ITM is locked/.test(l.message))).toBe(true)
  })
  it('VTOR relocates the vector table to SRAM', () => {
    expect(seg(0x5107, 0x5108)).toEqual(H(m.sym('ram_vectors'), 0xa17))
  })
  it('SHPR/IPR take byte and halfword writes; only the top 4 priority bits are implemented', () => {
    expect(seg(0x5108, 0x5109)).toEqual(H(0xf0500000, 0xf0, 0xa0b00000, 0xa0b0))
  })
  it('AIRCR needs VECTKEY; SYSRESETREQ calls hooks.systemResetRequest; unimplemented PPB reads 0', () => {
    expect(seg(0x5109, 0x510a)).toEqual(H(0xfa050000, 0xfa050300, 0))
    expect(m.resets.length).toBe(1)
    expect(m.logs.some((l) => /0xe0002000 is not implemented/.test(l.message))).toBe(true)
  })
  it('peripheral bit-band alias performs a read-modify-write of the target word', () => {
    expect(L.slice(L.indexOf(hex(0x510a)) + 1)).toEqual(H(0x108, 0x8, 1, 0))
  })
})
