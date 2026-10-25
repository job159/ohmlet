/**
 * Smoke test (firmware/tests/isa/smoke.s): a counted loop and two CASEs run
 * to BKPT; results derived by hand from the ARM ARM (A2.2.1 AddWithCarry).
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex } from './harness'

describe('smoke', () => {
  it('runs to BKPT with the expected results', () => {
    const m = fixture('smoke')
    expect(m.runToStop(100000)).toBe('breakpoint')
    expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^BKPT #0 /)])
    const res = m.sym('results')
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => hex(m.r32(res + 4 * i)))).toEqual(
      [
        55, // 10 + 9 + ... + 1
        0x80000000, // adds r0, r1, r2: 0x7fffffff + 1 → N and V set
        0x7fffffff,
        0x90000000,
        3, // it eq; addeq r0, r1, r2 with Z set: 1 + 2, flags untouched
        1,
        0x40000000,
      ].map(hex),
    )
  })
})
