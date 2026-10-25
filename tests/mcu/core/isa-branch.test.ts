/**
 * Branches, IT blocks, table branches and PC-relative operands
 * (firmware/tests/isa/branch.s). Condition outcomes are recomputed from the
 * ConditionPassed() table (A7.3); addresses come from the ELF symbols.
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex } from './harness'

const CONDS = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le']

/** A7.3 condition table, with NZCV = bits 3..0 of f */
function holds(cond: string, f: number): boolean {
  const n = (f >> 3) & 1
  const z = (f >> 2) & 1
  const c = (f >> 1) & 1
  const v = f & 1
  switch (cond) {
    case 'eq':
      return z === 1
    case 'ne':
      return z === 0
    case 'cs':
      return c === 1
    case 'cc':
      return c === 0
    case 'mi':
      return n === 1
    case 'pl':
      return n === 0
    case 'vs':
      return v === 1
    case 'vc':
      return v === 0
    case 'hi':
      return c === 1 && z === 0
    case 'ls':
      return c === 0 || z === 1
    case 'ge':
      return n === v
    case 'lt':
      return n !== v
    case 'gt':
      return z === 0 && n === v
    case 'le':
      return z === 1 || n !== v
  }
  throw new Error(cond)
}

describe('ISA: branches, IT, table branches (branch.s)', () => {
  const m = fixture('branch')
  const why = m.runToStop(1_000_000)
  const res = m.sym('results')
  const slot = (i: number) => m.r32(res + 4 * i)

  it('runs to the final BKPT without faults', () => {
    expect(why).toBe('breakpoint')
    expect(m.logs.filter((l) => l.level !== 'info')).toEqual([])
    expect(m.logs.at(-1)?.message).toMatch(/BKPT #0 /)
  })

  it('B<cond> (16-bit T1 and 32-bit T3) for every condition and NZCV value', () => {
    const bad: string[] = []
    for (const [base, enc] of [
      [0, 'T1'],
      [224, 'T3'],
    ] as const) {
      CONDS.forEach((cond, ci) => {
        for (let f = 0; f < 16; f++) {
          const got = slot(base + ci * 16 + f)
          const want = holds(cond, f) ? 1 : 0
          if (got !== want) bad.push(`${enc} b${cond} NZCV=${f.toString(2).padStart(4, '0')}: got ${got}`)
        }
      })
    }
    expect(bad).toEqual([])
  })

  it('ITETE blocks execute then/else slots by condition', () => {
    const pairs = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le']
    const bad: string[] = []
    pairs.forEach((c, pi) => {
      for (let f = 0; f < 16; f++) {
        const i = 448 + (pi * 16 + f) * 2
        const want = holds(c, f) ? [5, 0] : [0, 10]
        const got = [slot(i), slot(i + 1)]
        if (got[0] !== want[0] || got[1] !== want[1]) bad.push(`itete ${c} NZCV=${f}: got ${got} want ${want}`)
      }
    })
    expect(bad).toEqual([])
  })

  it('branches as the last IT instruction, CBZ/CBNZ, TBB/TBH', () => {
    expect([896, 897, 898, 899].map(slot)).toEqual([1, 1, 7, 8])
    expect([900, 901, 902, 903].map(slot)).toEqual([1, 3, 4, 4])
    expect([904, 905, 906, 907].map(slot)).toEqual([10, 11, 12, 13])
    expect([908, 909, 910, 911].map(slot)).toEqual([20, 21, 22, 23])
    expect(slot(912)).toBe(32)
  })

  it('BL/BLX link registers and every way of writing the PC', () => {
    const got = [913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924].map(slot)
    expect(got.map(hex)).toEqual(
      [1, m.sym('ret_bl') | 1, 2, m.sym('ret_blx') | 1, 2, 3, 4, 5, 6, 77, 61, 62].map(hex),
    )
  })

  it('PC-relative ADD/MOV (PC reads as insn + 4), ADR (Align(PC,4) ± imm), 16-bit literal', () => {
    const got = [925, 926, 927, 928, 929, 930].map(slot)
    expect(got.map(hex)).toEqual(
      [m.sym('pc_add') + 4, m.sym('pc_mov') + 4, m.sym('lit16'), 0x600dc0de, m.sym('near_back'), m.sym('lit16') + 4].map(hex),
    )
    expect(m.core.registers().r[8]).toBe(res + 4 * 931)
  })
})
