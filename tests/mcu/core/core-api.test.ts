/**
 * The CortexMCore contract (src/mcu/core/cpu-api.ts) as the SoC and the
 * simulation coordinator use it: run() time semantics and determinism under
 * arbitrary chunking, scheduler events at instruction boundaries,
 * requestSync, sleep fast-forward, host-driven IRQ lines, the debug surface
 * (breakpoints, stepping, BKPT, register access) and decode-cache coherence.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FW_DIST, fixture, hex, loadElfFile, makeMachine, type Machine } from './harness'

const selftest = () => makeMachine(loadElfFile(path.join(FW_DIST, 'cpu-selftest.elf')))

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0)
}

describe('run(): time and determinism', () => {
  it('returns "target" with clock.cycles >= untilCycle, overshooting by less than one instruction', () => {
    const m = fixture('spin')
    for (const until of [1, 5, 17, 100, 1001, 5000]) {
      expect(m.core.run(until)).toBe('target')
      expect(m.clock.cycles).toBeGreaterThanOrEqual(until)
      expect(m.clock.cycles - until).toBeLessThan(13)
    }
  })

  it('running in random-sized chunks is bit-identical to one long run (lockstep determinism)', () => {
    const ref = selftest()
    expect(ref.runToStop()).toBe('breakpoint')
    const m = selftest()
    const rnd = lcg(12345)
    let calls = 0
    for (;;) {
      const why = m.core.run(m.clock.cycles + 1 + (rnd() % 3000))
      calls++
      if (why === 'breakpoint') break
      expect(why).toBe('target')
    }
    expect(calls).toBeGreaterThan(100)
    expect(m.clock.cycles).toBe(ref.clock.cycles)
    expect(m.core.instructions).toBe(ref.core.instructions)
    expect(m.core.registers()).toEqual(ref.core.registers())
    expect(m.r32(m.sym('selftest_checksum'))).toBe(ref.r32(ref.sym('selftest_checksum')))
  })

  it('scheduler events run at instruction boundaries and receive their scheduled cycle', () => {
    const m = fixture('spin')
    const seen: { at: number; now: number }[] = []
    for (const at of [10, 11, 12, 333, 334, 5000]) m.sched.schedule(at, (c) => seen.push({ at: c, now: m.clock.cycles }))
    // an event may schedule another one in the past/present: it runs at the same boundary
    m.sched.schedule(700, () => m.sched.schedule(650, (c) => seen.push({ at: c, now: m.clock.cycles })))
    m.core.run(6000)
    expect(seen.map((s) => s.at)).toEqual([10, 11, 12, 333, 334, 650, 5000])
    for (const s of seen.filter((x) => x.at !== 650)) {
      expect(s.now).toBeGreaterThanOrEqual(s.at)
      expect(s.now - s.at).toBeLessThan(4) // the spin loop's longest instruction is a 3-cycle branch
    }
  })

  it('requestSync() from an event stops at the next boundary with "sync"; before run() it stops at once', () => {
    const m = fixture('spin')
    m.sched.schedule(1000, () => m.core.requestSync())
    expect(m.core.run(10_000)).toBe('sync')
    expect(m.clock.cycles).toBeGreaterThanOrEqual(1000)
    expect(m.clock.cycles).toBeLessThan(1004)
    const n = m.core.instructions
    m.core.requestSync()
    expect(m.core.run(20_000)).toBe('sync')
    expect(m.core.instructions).toBe(n)
    expect(m.core.run(20_000)).toBe('target')
  })
})

describe('sleep', () => {
  it('WFI with nothing to wake it before the target returns "sleep" exactly at the target', () => {
    const m = fixture('exc_sleep')
    // the first WFI waits for a timer IRQ ~100000 cycles away
    expect(m.core.run(50_000)).toBe('sleep')
    expect(m.clock.cycles).toBe(50_000)
    expect(m.core.sleeping).toBe(true)
    const n = m.core.instructions
    expect(m.core.run(90_000)).toBe('sleep')
    expect(m.core.instructions).toBe(n)
    expect(m.clock.cycles).toBe(90_000)
    // the timer IRQ (armed at cycle 46 for 100000 cycles) wakes the core: handler entry at
    // 100046 + 12 (stacking) + 2 (LDC) = 100060, then the program runs on to its next WFI
    m.core.run(100_200)
    expect(m.bus.logWrites[0]).toBe(100_060)
    expect(m.core.instructions).toBeGreaterThan(n + 10)
  })

  it('a sleeping core with no events and an infinite target returns "sleep" without advancing time', () => {
    const m = fixture('exc_sleep')
    m.core.run(1000)
    m.sched.clear() // drop the timer: nothing can wake the core
    const c = m.clock.cycles
    expect(m.core.run(Infinity)).toBe('sleep')
    expect(m.clock.cycles).toBe(c)
  })
})

describe('host-driven interrupts (setIrqLine / pendIrq / pendNmi)', () => {
  it('a level line keeps re-pending while asserted and stops when released', () => {
    const m = fixture('spin')
    m.core.run(200)
    m.core.setIrqLine(0, true)
    m.core.run(2000)
    const n = m.bus.logWrites.length
    expect(n).toBeGreaterThan(20)
    expect(new Set(m.bus.logWrites)).toEqual(new Set([0x100]))
    m.core.setIrqLine(0, false)
    m.core.run(4000)
    const after = m.bus.logWrites.length
    m.core.run(8000)
    expect(m.bus.logWrites.length).toBe(after)
    expect(after - n).toBeLessThanOrEqual(1)
  })

  it('pendIrq pulses one interrupt; out-of-range lines are reported, not faked', () => {
    const m = fixture('spin')
    m.core.run(200)
    m.core.pendIrq(1)
    m.core.run(1000)
    expect(m.bus.logWrites).toEqual([0x101])
    m.core.setIrqLine(99, true)
    expect(m.logs.some((l) => /IRQ 99 does not exist/.test(l.message))).toBe(true)
  })
})

describe('debug surface', () => {
  it('breakpoints halt BEFORE the instruction; resuming executes it exactly once', () => {
    const m = fixture('spin')
    const bp = m.sym('spin_branch')
    m.core.breakpoints.add(bp)
    expect(m.core.run(100_000)).toBe('breakpoint')
    expect(m.core.halted).toBe(true)
    expect(m.core.registers().r[15]).toBe(bp)
    const r0 = m.core.registers().r[0]
    expect(m.core.run(100_000)).toBe('halted')
    m.core.halted = false
    expect(m.core.run(100_000)).toBe('breakpoint')
    expect(m.core.registers().r[15]).toBe(bp)
    expect(m.core.registers().r[0]).toBe(r0 + 1) // one more loop iteration
    m.core.breakpoints.clear()
    m.core.halted = false
    expect(m.core.run(m.clock.cycles + 100)).toBe('target')
  })

  it('stepInstruction executes exactly one instruction (or one exception entry) while halted', () => {
    const m = fixture('spin')
    m.core.run(100)
    m.core.halted = true
    const pc0 = m.core.registers().r[15]
    const n0 = m.core.instructions
    m.core.stepInstruction()
    expect(m.core.instructions).toBe(n0 + 1)
    expect(m.core.halted).toBe(true)
    const pc1 = m.core.registers().r[15]
    expect(pc1).not.toBe(pc0)
    // a pending IRQ: the step performs the exception entry
    m.core.pendIrq(0)
    m.core.stepInstruction()
    expect(m.core.instructions).toBe(n0 + 1)
    expect(m.core.registers().xpsr & 0x1ff).toBe(16)
    m.core.stepInstruction()
    expect(m.core.instructions).toBe(n0 + 2)
  })

  it('BKPT halts ON the instruction and reports it', () => {
    const m = fixture('smoke')
    expect(m.runToStop()).toBe('breakpoint')
    const pc = m.core.registers().r[15]
    expect(m.bus.read16(pc)).toBe(0xbe00) // bkpt #0
    expect(m.core.halted).toBe(true)
    expect(m.logs.at(-1)?.message).toBe(`BKPT #0 at ${hex(pc)}: core halted`)
  })

  it('registers() / setRegister() / faultInfo()', () => {
    const m = fixture('spin')
    m.core.run(100)
    m.core.setRegister(0, 0xdeadbeef)
    m.core.setRegister(13, 0x20001003)
    const r = m.core.registers()
    expect(r.r[0]).toBe(0xdeadbeef)
    expect(r.r[13]).toBe(0x20001000) // SP[1:0] RAZ
    expect(r.msp).toBe(0x20001000)
    expect(r.xpsr & 0x01000000).toBe(0x01000000) // T
    expect(r.control).toBe(0)
    expect(() => m.core.setRegister(16, 0)).toThrow(RangeError)
    expect(m.core.faultInfo()).toEqual({ cfsr: 0, hfsr: 0, mmfar: 0, bfar: 0 })
    m.core.setRegister(15, m.sym('spin_loop') | 1)
    expect(m.core.registers().r[15]).toBe(m.sym('spin_loop'))
  })
})

describe('decode cache coherence', () => {
  it('code rewritten in SRAM after it executed runs the new instructions (smc.s)', () => {
    const m = fixture('smc')
    expect(m.runToStop()).toBe('breakpoint')
    expect(m.bus.logWrites).toEqual([5, 9, 0x1277])
  })

  it('a new image loaded into flash between runs is picked up (codeVersion)', () => {
    const m = fixture('spin')
    m.core.run(1000)
    // overwrite the loop body "adds r0, #1" with "adds r0, #2"
    const at = m.sym('spin_loop')
    m.bus.loadFlash(at, new Uint8Array([0x02, 0x30]))
    m.core.setRegister(0, 0)
    m.core.run(m.clock.cycles + 400)
    expect(m.core.registers().r[0] % 2).toBe(0)
    expect(m.core.registers().r[0]).toBeGreaterThan(50)
  })
})

describe('SysTick lazy counter (white box: SCS registers at controlled cycles)', () => {
  const SYST_CSR = 0xe000e010
  const SYST_RVR = 0xe000e014
  const SYST_CVR = 0xe000e018
  const wr = (m: Machine, a: number, v: number) => m.core.scs.write(a, v, 4, false)
  const rd = (m: Machine, a: number) => m.core.scs.read(a, 4, false)

  /**
   * B3.3: after VAL is cleared the counter reloads LOAD on the next tick, then
   * decrements once per tick; the 1→0 transition sets COUNTFLAG. With the core
   * clock a tick is every cycle after the enabling write.
   */
  const expectedVal = (load: number, ticks: number) => (ticks === 0 ? 0 : load - ((ticks - 1) % (load + 1)))

  it('VAL follows LOAD/reload semantics on the core clock without per-cycle ticking', () => {
    const m = fixture('spin')
    m.core.run(321)
    wr(m, SYST_RVR, 99)
    wr(m, SYST_CVR, 12345) // any write clears VAL
    const t0 = m.clock.cycles
    wr(m, SYST_CSR, 5) // ENABLE | CLKSOURCE
    for (const until of [t0 + 1, t0 + 7, t0 + 100, t0 + 101, t0 + 250, t0 + 9999]) {
      m.core.run(until)
      expect(rd(m, SYST_CVR)).toBe(expectedVal(99, m.clock.cycles - t0))
    }
    // disabling freezes the count
    wr(m, SYST_CSR, 4)
    const frozen = rd(m, SYST_CVR)
    m.core.run(m.clock.cycles + 777)
    expect(rd(m, SYST_CVR)).toBe(frozen)
  })

  it('reference clock: one tick per systickRefDivider() cycles, on multiples of the divider', () => {
    const m = fixture('spin', { refDivider: 8 })
    m.core.run(1003)
    wr(m, SYST_RVR, 9)
    wr(m, SYST_CVR, 0)
    const t0 = m.clock.cycles
    wr(m, SYST_CSR, 1) // ENABLE, external reference
    for (const d of [3, 8, 50, 81, 700]) {
      m.core.run(t0 + d)
      const ticks = Math.floor(m.clock.cycles / 8) - Math.floor(t0 / 8)
      expect(rd(m, SYST_CVR)).toBe(expectedVal(9, ticks))
    }
  })

  it('TICKINT pends SysTick exactly at each wrap (the handler logs 0x115)', () => {
    const m = fixture('spin')
    m.core.run(100)
    wr(m, SYST_RVR, 499)
    wr(m, SYST_CVR, 0)
    wr(m, SYST_CSR, 7)
    m.core.run(m.clock.cycles + 500 * 10 + 50)
    expect(m.bus.logWrites.length).toBe(10)
  })
})

describe('diagnostics', () => {
  it('UNPREDICTABLE encodings are logged once per address and executed', () => {
    const m = makeMachine(null)
    // vector table + `add.w pc, r0, r1` (Rd = PC: UNPREDICTABLE) then b .
    const img = new Uint8Array(64)
    const dv = new DataView(img.buffer)
    dv.setUint32(0, 0x20001000, true)
    dv.setUint32(4, 0x08000021, true)
    dv.setUint16(0x20, 0xeb00, true)
    dv.setUint16(0x22, 0x0f01, true)
    dv.setUint16(0x24, 0xe7fc, true) // b 0x08000020
    m.bus.loadFlash(0x08000000, img)
    m.core.reset()
    m.core.run(1000)
    const un = m.logs.filter((l) => /UNPREDICTABLE/.test(l.message))
    expect(un.length).toBe(1)
    expect(un[0].message).toMatch(/eb00 0f01 at 0x08000020/)
    expect(m.core.lockedUp).toBe(false)
  })
})
