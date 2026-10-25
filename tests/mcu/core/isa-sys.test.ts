/**
 * System instructions (firmware/tests/isa/sys.s): MRS/MSR (B5.2.2/B5.2.3),
 * CPS (B5.2.1), BASEPRI_MAX, CONTROL/PSP, unprivileged restrictions, hints.
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex } from './harness'

describe('ISA: system instructions (sys.s)', () => {
  const m = fixture('sys')
  const why = m.runToStop(100_000)
  const res = m.sym('results')
  const slots = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => hex(m.r32(res + 4 * (a + i))))
  const H = (...v: number[]) => v.map(hex)

  it('runs to BKPT #0', () => {
    expect(why).toBe('breakpoint')
    expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/BKPT #0 /)])
  })

  it('xPSR views: APSR flags, IPSR = 0 in Thread mode, EPSR reads as zero', () => {
    // APSR, XPSR, IPSR, EPSR, IAPSR, EAPSR, IEPSR after APSR := NZCVQ, then APSR := 0x5…
    expect(slots(0, 7)).toEqual(H(0xf8000000, 0xf8000000, 0, 0, 0xf8000000, 0xf8000000, 0, 0x50000000))
  })

  it('PRIMASK/FAULTMASK through CPSID/CPSIE and MSR', () => {
    expect(slots(8, 15)).toEqual(H(1, 0, 1, 0, 1, 0, 1, 0))
  })

  it('BASEPRI keeps the 4 implemented bits; BASEPRI_MAX only raises the masking level', () => {
    // 0x45→0x40; MAX 0x80 ignored (lower priority); MAX 0x20 taken; MAX 0 ignored; 0; MAX 0x3f from 0 → 0x30
    expect(slots(16, 21)).toEqual(H(0x40, 0x40, 0x20, 0x20, 0, 0x30))
  })

  it('MSP/PSP (bits [1:0] RAZ/WI) and CONTROL.SPSEL bank switching in Thread mode', () => {
    const top = m.sym('_estack')
    expect(slots(22, 31)).toEqual(H(top, 0x20003000, 0, 2, 0x20003000, 0x20002ffc, top, top, 0x20003000, 0x20004ff4))
  })

  it('unprivileged Thread mode: MSR/CPS to masks and CONTROL ignored, MRS MSP reads 0, SVC regains privilege', () => {
    // CONTROL=1, PRIMASK (MSR) 0, PRIMASK (CPSID) 0, BASEPRI 0, MSP 0, CONTROL still 1, APSR writable,
    // IPSR seen by the SVC handler = 11, CONTROL after the handler cleared nPRIV = 0
    expect(slots(32, 40)).toEqual(H(1, 0, 0, 0, 0, 1, 0x10000000, 11, 0))
  })

  it('hints and barriers fall through (SEV makes the following WFE return at once)', () => {
    expect(slots(41, 41)).toEqual(H(0xc0ffee))
    expect(m.core.sleeping).toBe(false)
  })
})
