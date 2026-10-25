/**
 * Architecturally defined corner cases (firmware/tests/isa/edge.s): writes
 * to SP clear SP[1:0], UNPREDICTABLE encodings run the ARM ARM pseudocode and
 * are logged once, DSP multiply-group encodings are UNDEFINED. Expected
 * values are worked out by hand in the comments of edge.s.
 */
import { describe, expect, it } from 'vitest'
import { MMIO_BASE, fixture, hex } from './harness'

describe('ISA corner cases (edge.s)', () => {
  const m = fixture('edge')
  const why = m.runToStop(1_000_000)
  const L = m.bus.logWrites.map(hex)
  const H = (...v: number[]) => v.map(hex)
  const S = (n: string) => m.sym(n)

  it('runs to its BKPT', () => {
    expect(why).toBe('breakpoint')
    expect(m.logs.at(-1)?.message).toMatch(/^BKPT #0 /)
  })

  it('MOV.W / ADD.W / SUB.W / LDR.W (immediate, register) to SP and an SP base written back by +3 all clear SP[1:0]', () => {
    expect(L.slice(0, 6)).toEqual(H(0x20004ff0, 0x20004ff4, 0x20004fe4, 0x20004f8c, 0x20004f8c, 0x20004f8c))
  })

  it('STRD with Rn = PC stores at the instruction address + 4 + imm (UNPREDICTABLE, not UNDEFINED)', () => {
    expect(L.slice(6, 8)).toEqual(H(0x11111111, 0x22222222))
  })

  it('LDRBT / post-indexed LDRB with Rt = PC perform the read and the write-back, discarding the byte', () => {
    expect(L.slice(8, 10)).toEqual(H(0xe003, MMIO_BASE + 4))
    const reads = m.bus.accesses.filter((a) => !a.write && a.addr === MMIO_BASE)
    expect(reads.map((a) => a.size)).toEqual([1, 1])
  })

  it('multiply-group encodings with hw2[7:6] != 00 raise UsageFault UNDEFINSTR', () => {
    expect(L.slice(10)).toEqual(H(0xfa17, 0x10000, S('smlabb'), 0xfa17, 0x10000, S('mul_op2'), 0xe004))
  })

  it('each UNPREDICTABLE encoding is logged once, with its address and the reason', () => {
    const un = m.logs.filter((l) => /UNPREDICTABLE/.test(l.message)).map((l) => l.message)
    expect(un).toEqual([
      expect.stringMatching(new RegExp(`^UNPREDICTABLE instruction e9cf 0101 at ${hex(S('strd_pc'))} \\(STRD with Rn = PC\\)`)),
      expect.stringMatching(new RegExp(`^UNPREDICTABLE instruction f815 fe00 at ${hex(S('ldrbt_pc'))} \\(LDRT-class load with Rt = SP/PC\\)`)),
      expect.stringMatching(new RegExp(`^UNPREDICTABLE instruction f815 fb04 at ${hex(S('ldrb_pc_wb'))} \\(byte/halfword load to PC with writeback\\)`)),
    ])
  })
})
