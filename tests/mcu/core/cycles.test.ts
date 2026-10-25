/**
 * The cycle model documented in src/mcu/core/exec.ts (Cortex-M3 TRM Table
 * 3-1 values, P = 2, zero-wait-state memory): each case executes ONE
 * hand-encoded instruction from flash and checks the clock advance against
 * the table, so the documentation and the implementation cannot drift apart.
 */
import { describe, expect, it } from 'vitest'
import { makeMachine, SRAM_BASE, type Machine } from './harness'

const CODE = 0x08000100
const DATA = SRAM_BASE + 0x100

/** machine with `halfwords` at CODE (then `b .`), registers preset, PC at CODE */
function setup(halfwords: number[], regs: Record<number, number> = {}): Machine {
  const m = makeMachine(null)
  const img = new Uint8Array(0x200)
  const dv = new DataView(img.buffer)
  dv.setUint32(0, SRAM_BASE + 0x4000, true) // SP
  dv.setUint32(4, CODE | 1, true)
  ;[...halfwords, 0xe7fe].forEach((h, i) => dv.setUint16(0x100 + 2 * i, h, true))
  m.bus.loadFlash(0x08000000, img)
  m.core.reset()
  for (const [r, v] of Object.entries(regs)) m.core.setRegister(Number(r), v)
  return m
}

/** cycles taken by the next instruction */
function step(m: Machine): number {
  const c0 = m.clock.cycles
  const n0 = m.core.instructions
  m.core.run(c0 + 1)
  expect(m.core.instructions).toBe(n0 + 1)
  return m.clock.cycles - c0
}

const cases: [string, number[], Record<number, number>, number][] = [
  ['ADDS r0, r1, r2', [0x1888], {}, 1],
  ['MOV pc, r0 (ALUWritePC: 1 + P)', [0x4687], { 0: CODE + 0x40 }, 3],
  ['MULS r0, r1, r0', [0x4348], { 0: 3, 1: 5 }, 1],
  ['MLA r0, r1, r2, r3', [0xfb01, 0x3002], {}, 2],
  ['UMULL, 16-bit operands (early termination)', [0xfba2, 0x0103], { 2: 0x1234, 3: 0xffff }, 3],
  ['UMULL, one wide operand', [0xfba2, 0x0103], { 2: 0x12345, 3: 0xffff }, 4],
  ['UMULL, two wide operands', [0xfba2, 0x0103], { 2: 0x12345678, 3: 0x9abcdef0 }, 5],
  ['SMULL, small negative operands', [0xfb82, 0x0103], { 2: -5, 3: -7 }, 3],
  ['UMLAL, two wide operands (TRM 4..7)', [0xfbe2, 0x0103], { 2: 0x12345678, 3: 0x9abcdef0 }, 6],
  ['UDIV by zero', [0xfbb1, 0xf0f2], { 1: 100, 2: 0 }, 2],
  ['UDIV with a 32-bit quotient', [0xfbb1, 0xf0f2], { 1: 0xffffffff, 2: 1 }, 12],
  ['SDIV with a zero quotient', [0xfb91, 0xf0f2], { 1: 3, 2: 7 }, 2],
  ['LDR r0, [r1]', [0x6808], { 1: DATA }, 2],
  ['STR r0, [r1]', [0x6008], { 1: DATA }, 2],
  ['LDRD r2, r3, [r1]', [0xe9d1, 0x2300], { 1: DATA }, 3],
  ['PUSH {r0-r3} (1 + N)', [0xb40f], {}, 5],
  ['B . (1 + P)', [0xe7fe], {}, 3],
  ['BEQ not taken', [0xd0fe], {}, 1],
  ['CBZ not taken', [0xb100], { 0: 1 }, 1],
  ['MRS r0, APSR', [0xf3ef, 0x8000], {}, 2],
  ['MSR APSR_nzcvq, r0', [0xf380, 0x8800], {}, 2],
  ['CPSID i', [0xb672], {}, 1],
  ['DSB', [0xf3bf, 0x8f4f], {}, 1],
  ['LDREX r0, [r1]', [0xe851, 0x0f00], { 1: DATA }, 2],
]

describe('cycle model (exec.ts table)', () => {
  for (const [name, code, regs, want] of cases) {
    it(`${name}: ${want}`, () => {
      expect(step(setup(code, regs))).toBe(want)
    })
  }

  it('LDR pc, [r1] (2 + P) and POP {r0, pc} (1 + N + P)', () => {
    const m = setup([0xf8d1, 0xf000], { 1: DATA })
    m.bus.write32(DATA, (CODE + 0x40) | 1)
    expect(step(m)).toBe(4)
    expect(m.core.registers().r[15]).toBe(CODE + 0x40)
    const p = setup([0xbd01])
    const sp = p.core.registers().r[13]
    p.bus.write32(sp, 7)
    p.bus.write32(sp + 4, (CODE + 0x40) | 1)
    expect(step(p)).toBe(5)
  })

  it('TBB (2 + P); IT itself and an IT-skipped instruction take 1 each', () => {
    // tbb [pc, r0]; table {2, ...}: branch to the table end
    const t = setup([0xe8df, 0xf000, 0x0202, 0xbf00, 0xbf00], { 0: 0 })
    expect(step(t)).toBe(4)
    expect(t.core.registers().r[15]).toBe(CODE + 4 + 4)
    // ite eq (Z = 0): the "then" slot is skipped, the "else" slot executes
    const i = setup([0xbf0c, 0x1c40, 0x1c80])
    expect(step(i)).toBe(1)
    expect(step(i)).toBe(1)
    expect(i.core.registers().r[0]).toBe(0)
    expect(step(i)).toBe(1)
  })

  it('exception entry 12 / return 10 (+ BX 1 + P) / tail-chain 6 are the TRM values', () => {
    // exc_svc.s measures the tail-chain; here: entry of a pended IRQ and its return
    const m = setup([0xbf00, 0xbf00])
    const img = new Uint8Array(4)
    new DataView(img.buffer).setUint32(0, (CODE + 0x40) | 1, true)
    m.bus.loadFlash(0x08000000 + 4 * 16, img) // IRQ0 vector
    m.bus.loadFlash(CODE + 0x40, new Uint8Array([0x70, 0x47])) // bx lr
    m.core.scs.write(0xe000e100, 1, 4, false) // ISER0: IRQ0
    m.core.pendIrq(0)
    const c0 = m.clock.cycles
    m.core.run(c0 + 1) // takes the exception, then executes BX LR (1 + P) + unstacking 10
    expect(m.core.registers().xpsr & 0x1ff).toBe(16)
    expect(m.clock.cycles - c0).toBe(12)
    expect(step(m)).toBe(3 + 10)
    expect(m.core.registers().xpsr & 0x1ff).toBe(0)
  })
})
