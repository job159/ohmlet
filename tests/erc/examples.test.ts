/**
 * False-alarm guard: the curated, known-good circuits (bundled examples and
 * the LLM few-shot layouts) produce no ERC error or risk — statically and
 * with live telemetry from the real engine — and the checker never throws
 * on malformed input (it runs on every edit in the inspector).
 */
import { describe, expect, it } from 'vitest'
import { runErc, ercCounts, ERC_RULES } from '../../src/sim/erc'
import { SimEngine } from '../../src/sim/engine'
import { FEW_SHOT_EXAMPLES } from '../../src/llm/examples'
import { EXAMPLES } from '../../src/ui/workspace/examples'
import type { CircuitLayout } from '../../src/model/types'
import { bluePill, part, railsWorld, summary, tap, w } from './helpers'

const GOOD: [string, CircuitLayout][] = [
  ...EXAMPLES.map((e): [string, CircuitLayout] => [e.title, e.layout]),
  ...FEW_SHOT_EXAMPLES.map((l): [string, CircuitLayout] => [l.name ?? 'few-shot', l]),
]

describe('ERC on known-good circuits', () => {
  for (const [name, l] of GOOD) {
    it(`${name}: no errors or risks (static and with telemetry)`, { timeout: 60_000 }, () => {
      const statik = runErc(l)
      expect(statik.filter((f) => f.level !== 'info'), summary(statik)).toEqual([])
      const e = new SimEngine(l)
      e.advance(0.05)
      const live = runErc(l, { telemetry: e.telemetry(), issues: e.issues })
      expect(live.filter((f) => f.level !== 'info'), summary(live)).toEqual([])
    })
  }

  it('a correctly wired Blue Pill LED circuit is clean', () => {
    const l = bluePill(
      [part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])],
      [w(tap('PA5'), 'b40')],
    )
    expect(runErc(l), summary(runErc(l))).toEqual([])
  })
})

describe('ERC robustness and output contract', () => {
  it('never throws on malformed layouts', () => {
    const junk: unknown[] = [
      { version: 1, components: [], wires: [] },
      { version: 1, components: [null, { id: 'X' }, { id: 'Y', type: 'nope' }], wires: [null] },
      { version: 1, components: [{ id: 'R1', type: 'resistor', holes: ['zz'] }], wires: [{ id: 'w', from: 'a1', to: 'Q:9' }] },
      { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'a1' }], wires: [] },
      { version: 1, components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 'x' } }], wires: [{ id: 'w', from: 'PS1:+', to: 'PS1:-' }] },
    ]
    for (const l of junk) expect(() => runErc(l as CircuitLayout)).not.toThrow()
    expect(runErc(null as unknown as CircuitLayout)).toEqual([])
  })

  it('findings are sorted error → risk → info with unique ids, and every rule is documented', () => {
    const l = railsWorld(
      [
        part('D1', 'led', ['top+5', 'top-5']),
        part('D2', 'led', ['top-6', 'a40']),
        part('R1', 'resistor', ['top+6', 'b40'], { resistance: 330 }),
        { id: 'SW1', type: 'pushbutton', at: 'f50' },
        // an unwired LED: the one info (the reversed D2 became a risk in IN-17)
        part('D3', 'led', ['a20', 'a24']),
      ],
      [w('top+3', 'a50'), w('top-3', 'a52')],
    )
    const f = runErc(l)
    const order = { error: 0, risk: 1, info: 2 }
    for (let i = 1; i < f.length; i++) expect(order[f[i - 1].level]).toBeLessThanOrEqual(order[f[i].level])
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length)
    expect(ercCounts(f).error).toBeGreaterThanOrEqual(1)
    expect(ercCounts(f).risk).toBeGreaterThanOrEqual(1)
    expect(ercCounts(f).info).toBe(1)
    const documented = new Set(ERC_RULES.map((r) => r.id))
    for (const x of f) expect(documented.has(x.rule)).toBe(true)
    for (const x of f) {
      expect(x.message.length).toBeGreaterThan(40)
      expect(Array.isArray(x.componentIds) && Array.isArray(x.nets) && Array.isArray(x.holes)).toBe(true)
    }
  })
})
