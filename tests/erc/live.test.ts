/**
 * ERC rule 7 — over-rating from simulation telemetry. Every snapshot here
 * comes from the real SimEngine (resistor power, supply current, the Blue
 * Pill's on-board LDO model) except the LED case, whose telemetry is
 * constructed to exercise the rating comparison on a statically sound
 * circuit (the static rule 2 already covers the reachable over-current
 * layouts, and the live rule then defers to it).
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import { SimEngine } from '../../src/sim/engine'
import type { CircuitLayout, SimTelemetry } from '../../src/model/types'
import { BP, bluePill, layout, ofRule, part, ps, railsWorld, summary, tap, valid, w } from './helpers'

function simulate(l: CircuitLayout, seconds = 0.005) {
  const e = new SimEngine(l)
  e.advance(seconds)
  return { telemetry: e.telemetry(), issues: e.issues }
}

describe('rule 7 — over-rating from telemetry', () => {
  it('a 10 Ω resistor across 5 V dissipates 2.5 W > 0.25 W → risk; 1 kΩ is fine', () => {
    const mk = (r: number) => valid(railsWorld([part('R1', 'resistor', ['top+5', 'top-5'], { resistance: r })]))
    const hot = mk(10)
    expect(ofRule(runErc(hot), 'over-rating')).toEqual([]) // nothing without telemetry
    const f = ofRule(runErc(hot, simulate(hot)), 'over-rating')
    expect(f.map((x) => x.id), summary(f)).toEqual(['over-rating:R1:p'])
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/2\.5 W.*250 mW/)
    const cool = mk(1000)
    expect(ofRule(runErc(cool, simulate(cool)), 'over-rating')).toEqual([])
  })

  it('a 1 Ω load: the engine’s > 2 A supply warning becomes a finding', () => {
    const l = valid(railsWorld([part('R1', 'resistor', ['top+5', 'top-5'], { resistance: 1 })]))
    // the engine reports a supply's over-current once it is SUSTAINED (SUPPLY_OVERCURRENT_HOLD_S = 10 ms — M2)
    const f = ofRule(runErc(l, simulate(l, 0.02)), 'over-rating')
    expect(f.map((x) => x.id).sort(), summary(f)).toEqual(['over-rating:PS1:supply', 'over-rating:R1:p'])
  })

  it('Blue Pill 3.3 V rail overloaded by 5 Ω: the regulator model current-limits → risk', () => {
    const l = valid(bluePill([part('R1', 'resistor', [tap('3V3_1'), 'top-9'], { resistance: 5 })]))
    const sim = simulate(l, 0.01)
    expect(sim.telemetry.components.U1.sub?.REG?.values?.limiting).toBe(1)
    const f = ofRule(runErc(l, sim), 'over-rating')
    expect(f.map((x) => x.id).sort(), summary(f)).toEqual(['over-rating:R1:p', 'over-rating:U1:REG:limit'])
    expect(f.find((x) => x.id === 'over-rating:U1:REG:limit')!.message).toMatch(/current limit/)
  })

  it('Blue Pill fed through 2.2 kΩ: the regulator drops out in the simulation → risk', () => {
    const fed = valid(
      layout(
        [ps(), BP, part('R1', 'resistor', ['a40', 'a45'], { resistance: 2200 })],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w(tap('GND3'), 'top-1'), w('top+2', 'b40'), w('b45', tap('5V'))],
      ),
    )
    const sim = simulate(fed, 0.01)
    const reg = sim.telemetry.components.U1.sub?.REG?.values
    expect(reg?.vout ?? 9).toBeLessThan(3.2)
    const all = runErc(fed, sim)
    const f = ofRule(all, 'over-rating')
    expect(f.map((x) => x.id), summary(all)).toEqual(['over-rating:U1:REG:dropout'])
    expect(f[0].message).toMatch(/dropout/)
    // statically the 5V pin is fed only through R1
    expect(ofRule(all, 'unpowered').map((x) => x.level)).toEqual(['risk'])
  })

  it('an LED reported above its 20 mA rating is a risk; at 10 mA it is fine', () => {
    const l = valid(
      railsWorld(
        [part('R1', 'resistor', ['top+5', 'a40'], { resistance: 330 }), part('D1', 'led', ['b40', 'top-5'])],
      ),
    )
    const tele = (current: number): SimTelemetry => ({
      time: 0.01,
      netVoltages: {},
      issues: [],
      components: { D1: { pinVoltages: {}, current, ledBrightness: 1, burned: false } },
    })
    const f = ofRule(runErc(l, { telemetry: tele(0.025) }), 'over-rating')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/25\.0 mA.*20\.0 mA/)
    expect(ofRule(runErc(l, { telemetry: tele(0.01) }), 'over-rating')).toEqual([])
  })
})
