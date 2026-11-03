/**
 * ERC rules 1 (supply short), 6a (supply range) and 8 (ground reference /
 * unpowered) on real breadboard layouts.
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import type { ComponentInstance } from '../../src/model/types'
import { BP, bluePill, layout, ofRule, part, ps, railsWorld, summary, tap, valid, w } from './helpers'

/** 7404 hex inverter straddling the channel at f40: VCC = e40, GND = f46, 1A = f40, 1Y = f41. */
const INV: ComponentInstance = { id: 'U2', type: 'sn7404', at: 'f40' }

describe('rule 1 — supply short', () => {
  it('flags a jumper between the + and − rails as an error and names the wire', () => {
    const l = valid(railsWorld([], [w('top+3', 'top-3')]))
    const jumper = l.wires[l.wires.length - 1].id
    const f = ofRule(runErc(l), 'supply-short')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].componentIds).toContain('PS1')
    expect(f[0].wireIds).toContain(jumper)
    expect(f[0].holes).toEqual(['PS1:+', 'PS1:-'])
  })

  it('flags a Blue Pill 3.3 V pin jumpered to its GND pin', () => {
    const l = valid(bluePill([], [w(tap('3V3_1'), tap('GND1'))]))
    const f = ofRule(runErc(l), 'supply-short').filter((x) => x.componentIds.includes('U1'))
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].message).toMatch(/3V3_1/)
  })

  it('reports a pushbutton across the supply as a risk (short whenever it is pressed)', () => {
    const sw = { id: 'SW1', type: 'pushbutton', at: 'f40' }
    const l = valid(railsWorld([sw], [w('top+3', 'a40'), w('top-3', 'a42')]))
    const f = ofRule(runErc(l), 'supply-short')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/whenever SW1 conducts/)
    expect(f[0].componentIds).toEqual(['PS1', 'SW1'])

    const pressed = valid(railsWorld([{ ...sw, params: { pressed: true } }], [w('top+3', 'a40'), w('top-3', 'a42')]))
    const g = ofRule(runErc(pressed), 'supply-short')
    expect(g[0].level).toBe('risk')
    expect(g[0].message).toMatch(/right now/)
  })

  it('reports a multimeter in A mode across the supply, but not in V mode', () => {
    const mk = (mode: string) =>
      valid(
        layout(
          [ps(), { id: 'DMM1', type: 'multimeter', params: { mode } }],
          [w('PS1:+', 'DMM1:IN'), w('DMM1:COM', 'PS1:-')],
        ),
      )
    const a = ofRule(runErc(mk('A')), 'supply-short')
    expect(a, summary(a)).toHaveLength(1)
    expect(a[0].level).toBe('risk')
    expect(a[0].message).toMatch(/A mode/)
    expect(ofRule(runErc(mk('V')), 'supply-short')).toEqual([])
  })

  it('flags two supplies of different voltage driving the same rail', () => {
    const l = valid(
      layout(
        [ps('PS1', 5), ps('PS2', 3.3)],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('PS2:+', 'top+5'), w('PS2:-', 'top-5')],
      ),
    )
    const f = ofRule(runErc(l), 'supply-short')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].componentIds.sort()).toEqual(['PS1', 'PS2'])

    const same = valid(
      layout(
        [ps('PS1', 5), ps('PS2', 5)],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('PS2:+', 'top+5'), w('PS2:-', 'top-5')],
      ),
    )
    expect(ofRule(runErc(same), 'supply-short')).toEqual([])
  })

  it('stays quiet for a correctly wired LED and a correctly powered chip', () => {
    const l = valid(
      railsWorld(
        [part('R1', 'resistor', ['top+5', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5']), INV],
        [w('a40', 'top+6'), w('j46', 'top-6')],
      ),
    )
    expect(ofRule(runErc(l), 'supply-short')).toEqual([])
  })
})

describe('rule 6a — supply range', () => {
  const powered = (v: number) => valid(railsWorld([INV], [w('a40', 'top+6'), w('j46', 'top-6')], v))

  it('7404 (4.75–5.25 V): error at 9 V, nothing at 5 V, risk at 3.3 V', () => {
    const hi = ofRule(runErc(powered(9)), 'supply-range')
    expect(hi, summary(hi)).toHaveLength(1)
    expect(hi[0].level).toBe('error')
    expect(hi[0].message).toMatch(/9\.00 V.*5\.25 V/)
    expect(ofRule(runErc(powered(5)), 'supply-range')).toEqual([])
    const lo = ofRule(runErc(powered(3.3)), 'supply-range')
    expect(lo).toHaveLength(1)
    expect(lo[0].level).toBe('risk')
  })

  it('NE555 (4.5–16 V) on 3.3 V is a risk; on 12 V it is fine', () => {
    const t = { id: 'U3', type: 'ne555', at: 'f50' } // GND f50, VCC e50
    const mk = (v: number) => valid(railsWorld([t], [w('j50', 'top-7'), w('a50', 'top+7')], v))
    expect(ofRule(runErc(mk(3.3)), 'supply-range').map((x) => x.level)).toEqual(['risk'])
    expect(ofRule(runErc(mk(12)), 'supply-range')).toEqual([])
  })

  it('flags a reversed chip supply as an error', () => {
    const l = valid(railsWorld([INV], [w('a40', 'top-6'), w('j46', 'top+6')]))
    const f = ofRule(runErc(l), 'supply-range')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].message).toMatch(/reversed/)
  })

  it('Blue Pill: 5 V on a 3.3 pin is an error, 3.3 V there is fine', () => {
    const five = ofRule(runErc(valid(bluePill([], [], { via3v3: true, supply: 5 }))), 'supply-range')
    expect(five, summary(five)).toHaveLength(1)
    expect(five[0].level).toBe('error')
    expect(five[0].message).toMatch(/3\.60 V maximum/)
    expect(ofRule(runErc(valid(bluePill([], [], { via3v3: true, supply: 3.3 }))), 'supply-range')).toEqual([])
  })

  it('Blue Pill: 9 V on the 5V pin exceeds the regulator input; 3.3 V there is a dropout risk; 5 V is fine', () => {
    const nine = ofRule(runErc(valid(bluePill([], [], { supply: 9 }))), 'supply-range')
    expect(nine.map((x) => x.level), summary(nine)).toEqual(['error'])
    expect(nine[0].message).toMatch(/6\.00 V maximum input/)
    const low = ofRule(runErc(valid(bluePill([], [], { supply: 3.3 }))), 'supply-range')
    expect(low.map((x) => x.level), summary(low)).toEqual(['risk'])
    expect(low[0].message).toMatch(/3\.55 V/)
    expect(ofRule(runErc(valid(bluePill([], [], { supply: 5 }))), 'supply-range')).toEqual([])
  })
})

describe('rule 8 — ground reference and unpowered parts', () => {
  it('a circuit with consumers but no source is an error', () => {
    const l = valid(layout([part('R1', 'resistor', ['a40', 'a45']), part('D1', 'led', ['b45', 'b50'])]))
    const f = ofRule(runErc(l), 'unpowered')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].id).toBe('unpowered:no-source')
  })

  it('7404 with VCC unwired → unpowered error; GND unwired → ground-reference error; VCC through a resistor → risk', () => {
    const noVcc = runErc(valid(railsWorld([INV], [w('j46', 'top-6')])))
    expect(ofRule(noVcc, 'unpowered').map((x) => x.level), summary(noVcc)).toEqual(['error'])
    expect(ofRule(noVcc, 'ground-reference')).toEqual([])

    const noGnd = runErc(valid(railsWorld([INV], [w('a40', 'top+6')])))
    expect(ofRule(noGnd, 'ground-reference').map((x) => x.level), summary(noGnd)).toEqual(['error'])
    expect(ofRule(noGnd, 'unpowered')).toEqual([])

    const viaR = runErc(
      valid(railsWorld([INV, part('R1', 'resistor', ['a40', 'top+6'], { resistance: 1000 })], [w('j46', 'top-6')])),
    )
    const u = ofRule(viaR, 'unpowered')
    expect(u.map((x) => x.level), summary(viaR)).toEqual(['risk'])
    expect(u[0].message).toMatch(/through R1/)

    const ok = runErc(valid(railsWorld([INV], [w('a40', 'top+6'), w('j46', 'top-6')])))
    expect([...ofRule(ok, 'unpowered'), ...ofRule(ok, 'ground-reference')]).toEqual([])
  })

  it('Blue Pill: only GND wired → unpowered error; 5 V wired but no GND → ground-reference error only', () => {
    const onlyGnd = valid(layout([ps(), BP], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w(tap('GND3'), 'top-1')]))
    const a = runErc(onlyGnd)
    expect(ofRule(a, 'unpowered').map((x) => x.level), summary(a)).toEqual(['error'])

    const b = runErc(valid(bluePill([], [], { noGround: true })))
    expect(ofRule(b, 'ground-reference').map((x) => x.level), summary(b)).toEqual(['error'])
    expect(ofRule(b, 'unpowered')).toEqual([])

    const ok = runErc(valid(bluePill()))
    expect(ok, summary(ok)).toEqual([])
  })

  it('a second supply without a common ground is a risk; tying its − to ground clears it', () => {
    const parts = [ps('PS2', 3), part('R1', 'resistor', ['a40', 'a45'], { resistance: 1000 })]
    const floating = valid(
      layout([ps(), ...parts], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('PS2:+', 'b40'), w('PS2:-', 'b45')]),
    )
    const f = ofRule(runErc(floating), 'ground-reference')
    expect(f.map((x) => x.componentIds[0]), summary(f)).toEqual(['PS2'])
    expect(f[0].level).toBe('risk')

    const grounded = valid(
      layout([ps(), ...parts], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('PS2:+', 'b40'), w('PS2:-', 'top-4'), w('top-5', 'b45')]),
    )
    expect(ofRule(runErc(grounded), 'ground-reference')).toEqual([])
  })

  it('a circuit driven only by a function generator is not "unpowered" (the LED it feeds really lights)', () => {
    const fg = { id: 'FG1', type: 'function_generator' }
    const r = part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 })
    const d = part('D1', 'led', ['b45', 'b50'])
    const l = valid(layout([fg, r, d], [w('FG1:out', 'c40'), w('FG1:gnd', 'c50')]))
    const f = ofRule(runErc(l), 'unpowered')
    expect(f, summary(f)).toEqual([])
    // a chip still needs a real supply, but the card must not say 「什麼都不會動」
    const chip = valid(layout([fg, r, d, INV], [w('FG1:out', 'c40'), w('FG1:gnd', 'c50')]))
    const g = ofRule(runErc(chip), 'unpowered').filter((x) => x.id === 'unpowered:no-source')
    expect(g, summary(g)).toHaveLength(1)
    expect(g[0].componentIds).toEqual(['U2'])
    expect(g[0].fact).toBeUndefined()
    // an unwired generator drives nothing: the LED is still unpowered
    const idle = valid(layout([fg, r, d]))
    expect(ofRule(runErc(idle), 'unpowered').map((x) => x.id)).toEqual(['unpowered:no-source'])
  })

  it('a function generator whose gnd is not tied to the circuit is a risk', () => {
    const fg = { id: 'FG1', type: 'function_generator' }
    const r = part('R1', 'resistor', ['a40', 'top-4'], { resistance: 1000 })
    const loose = valid(layout([ps(), fg, r], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('FG1:out', 'b40')]))
    const f = ofRule(runErc(loose), 'ground-reference')
    expect(f.map((x) => x.componentIds[0]), summary(f)).toEqual(['FG1'])
    const tied = valid(
      layout([ps(), fg, r], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('FG1:out', 'b40'), w('FG1:gnd', 'top-5')]),
    )
    expect(ofRule(runErc(tied), 'ground-reference')).toEqual([])
  })
})
