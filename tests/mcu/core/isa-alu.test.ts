/**
 * Data-processing / multiply / bit-field / extend / saturate instructions:
 * every CASE of firmware/tests/isa/alu*.s is executed on the core and its
 * {r0, r1, APSR} compared with the independent reference model
 * (ref-model.ts, ARM ARM pseudocode).
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex, type Machine } from './harness'
import { apsrOf, refExec, stateFrom } from './ref-model'

interface CaseResult {
  text: string
  inputs: number[]
  got: number[]
  want: number[]
}

export function runCases(name: string): { m: Machine; cases: CaseResult[] } {
  const m = fixture(name)
  const why = m.runToStop(50_000_000)
  if (why !== 'breakpoint') throw new Error(`${name}: stopped with ${why} at ${hex(m.core.registers().r[15])}: ${JSON.stringify(m.logs)}`)
  const lastLog = m.logs[m.logs.length - 1]?.message ?? ''
  if (!/BKPT #0 /.test(lastLog)) throw new Error(`${name}: unexpected stop: ${lastLog}`)
  const start = m.sym('__cases_start')
  const end = m.sym('__cases_end')
  const results = m.sym('results')
  const cases: CaseResult[] = []
  for (let a = start, i = 0; a < end; a += 24, i++) {
    let text = ''
    for (let p = m.r32(a); ; p++) {
      const ch = m.bus.read8(p)
      if (ch === 0) break
      text += String.fromCharCode(ch)
    }
    const inputs = [1, 2, 3, 4, 5].map((k) => m.r32(a + 4 * k))
    const got = [0, 1, 2].map((k) => m.r32(results + 12 * i + 4 * k))
    const st = stateFrom(inputs[0], inputs[1], inputs[2], inputs[3], inputs[4])
    refExec(text, st)
    cases.push({ text, inputs, got, want: [st.r[0], st.r[1], apsrOf(st)] })
  }
  return { m, cases }
}

function check(name: string, minCases: number): void {
  const { cases } = runCases(name)
  expect(cases.length).toBeGreaterThanOrEqual(minCases)
  const bad = cases.filter((c) => c.got.some((g, i) => g !== c.want[i]))
  const fmt = (c: CaseResult) =>
    `${c.text.padEnd(44)} in=${c.inputs.map(hex).join(' ')}  got r0=${hex(c.got[0])} r1=${hex(c.got[1])} apsr=${hex(c.got[2])}  want r0=${hex(c.want[0])} r1=${hex(c.want[1])} apsr=${hex(c.want[2])}`
  expect(bad.map(fmt).slice(0, 40)).toEqual([])
}

describe('ISA: data processing (reference model)', () => {
  it('16-bit encodings, in and out of IT blocks (alu16.s)', () => check('alu16', 500))
  it('32-bit shifted-register and register-shift forms (alu_reg.s)', () => check('alu_reg', 800))
  it('modified and plain immediates, ThumbExpandImm_C carry (alu_imm.s)', () => check('alu_imm', 650))
  it('multiply, divide, bit field, extend, reverse, CLZ, saturate (alu_misc.s)', () => check('alu_misc', 590))
})
