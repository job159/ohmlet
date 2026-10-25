/**
 * UX fix wave IN-20 (requests round): a problem row never shows a catalog
 * pin key — 「U1 的 GND 腳位沒有連接到電路接地，雖然 3V3_1 有供電」 must read
 * 「…雖然 3V3（板上 3.3）有供電」. Every bundled example and every lesson
 * circuit (start and solution), plus each of them with one wire pulled out
 * (the half-wired states a learner passes through), through the ERC and the
 * problems rows (ercProblem with the layout — the display substitution).
 */
import { describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { runErc } from '../src/sim/erc'
import { LESSONS } from '../src/lessons'
import { EXAMPLES } from '../src/ui/workspace/examples'
import { ercProblem } from '../src/ui/embedded/problems'
import { bluePill, valid } from './erc/helpers'

/** catalog keys a person should never read: 3V3_1, GND1, 5V_2, U1.REG, U1.PA5 */
const RAW_PIN = /\b(?:3V3|GND|5V)_\d\b|\bGND\d\b|\b[A-Z]+\d+\.(?:REG|P[A-E]\d+)\b/

const CIRCUITS: [string, CircuitLayout][] = [
  ...EXAMPLES.map((e): [string, CircuitLayout] => [`example ${e.title}`, e.layout]),
  ...LESSONS.flatMap((l): [string, CircuitLayout][] => [
    [`${l.id} start`, l.start.layout],
    [`${l.id} solution`, l.solution.layout],
  ]),
]

function variants(l: CircuitLayout): CircuitLayout[] {
  return [l, ...l.wires.map((_, i) => ({ ...l, wires: l.wires.filter((__, j) => j !== i) }))]
}

describe('IN-20 problem rows name pins the way people read them', () => {
  __setLangForTests('zh-TW')
  it('a Blue Pill fed on its 3.3 pin without GND: 「雖然 3V3（板上 3.3）有供電」', () => {
    const l = valid(bluePill([], [], { via3v3: true, noGround: true }))
    const f = runErc(l).find((x) => x.rule === 'ground-reference')!
    const p = ercProblem(f, l)
    expect(p.detail).toContain('雖然 3V3（板上 3.3）有供電')
    expect(p.detail).not.toMatch(RAW_PIN)
  })
  for (const [name, layout] of CIRCUITS) {
    it(`${name} (and with each wire missing)`, { timeout: 60_000 }, () => {
      __setLangForTests('zh-TW')
      const bad: string[] = []
      for (const l of variants(layout)) {
        for (const f of runErc(l)) {
          const p = ercProblem(f, l)
          for (const text of [p.title, p.detail]) if (RAW_PIN.test(text)) bad.push(`${f.id}: ${text}`)
        }
      }
      expect([...new Set(bad)]).toEqual([])
    })
  }
})
