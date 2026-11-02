/**
 * ERC rule 2 — LED current limiting — on real layouts, plus the telemetry
 * upgrade when the simulation's own LED model burns the part out.
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import { SimEngine } from '../../src/sim/engine'
import { bluePill, ofRule, part, railsWorld, summary, tap, valid, w } from './helpers'

describe('rule 2 — LED without a current-limiting element', () => {
  it('an LED straight across the supply rails is an error with a resistor suggestion', () => {
    const l = valid(railsWorld([part('D1', 'led', ['top+5', 'top-5'])]))
    const f = ofRule(runErc(l), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].componentIds[0]).toBe('D1')
    expect(f[0].message).toMatch(/directly across PS1 \+/)
    expect(f[0].message).toMatch(/330 Ω/) // E12 ≥ (5 − 1.8) V / 10 mA
    expect(f[0].holes).toEqual(['top+5', 'top-5'])
  })

  it('a 330 Ω series resistor clears it; a 47 Ω one is a risk (too small)', () => {
    const mk = (r: number) =>
      valid(
        railsWorld(
          [part('R1', 'resistor', ['top+5', 'a40'], { resistance: r }), part('D1', 'led', ['b40', 'b45'])],
          [w('c45', 'top-5')],
        ),
      )
    expect(ofRule(runErc(mk(330)), 'led-current')).toEqual([])
    const f = ofRule(runErc(mk(47)), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/R1 \(47 Ω\)/)
    expect(f[0].message).toMatch(/68\.1 mA/) // (5 − 1.8) / 47
    expect(f[0].message).toMatch(/at least 180 Ω/) // E12 ≥ 3.2 V / 20 mA
    expect(f[0].componentIds).toEqual(['D1', 'R1'])
  })

  it('an LED driven straight from a GPIO is a risk; with 330 Ω it is fine', () => {
    const bare = valid(bluePill([part('D1', 'led', ['a40', 'top-9'])], [w(tap('PA5'), 'b40')]))
    const f = ofRule(runErc(bare), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/U1 PA5/)
    expect(f[0].message).toMatch(/25 mA/)
    expect(f[0].componentIds).toEqual(['D1', 'U1'])

    const ok = valid(
      bluePill(
        [part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])],
        [w(tap('PA5'), 'b40')],
      ),
    )
    expect(ofRule(runErc(ok), 'led-current')).toEqual([])
  })

  it('a pushbutton in the only path makes it a risk "when SW1 is closed"', () => {
    const l = valid(
      railsWorld([{ id: 'SW1', type: 'pushbutton', at: 'f40' }, part('D1', 'led', ['a42', 'top-6'])], [w('top+3', 'a40')]),
    )
    const f = ofRule(runErc(l), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/when SW1 is closed/)
    expect(f[0].componentIds).toContain('SW1')
  })

  it('a potentiometer as the only limiter is a risk; a fixed resistor in series clears it', () => {
    const pot = part('RV1', 'potentiometer', ['c40', 'c41', 'c42'])
    const bare = valid(railsWorld([pot, part('D1', 'led', ['a41', 'top-6'])], [w('top+3', 'a40')]))
    const f = ofRule(runErc(bare), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/RV1 turned to its end/)

    const ok = valid(
      railsWorld(
        [pot, part('R1', 'resistor', ['a41', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-6'])],
        [w('top+3', 'a40')],
      ),
    )
    expect(ofRule(runErc(ok), 'led-current')).toEqual([])
  })

  it('an NPN low-side switch without a resistor is a risk; with one it is fine', () => {
    // Q1 E-B-C at j50 (emitter) j51 (base) j52 (collector)
    const q = part('Q1', 'npn', ['j50', 'j51', 'j52'])
    const bare = valid(
      railsWorld(
        [q, part('D1', 'led', ['top+5', 'i52']), part('RB', 'resistor', ['i51', 'top+6'], { resistance: 10000 })],
        [w('i50', 'top-5')],
      ),
    )
    const f = ofRule(runErc(bare), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/Q1 conducts/)

    const ok = valid(
      railsWorld(
        [
          q,
          part('R1', 'resistor', ['top+5', 'g45'], { resistance: 330 }),
          part('D1', 'led', ['h45', 'i52']),
          part('RB', 'resistor', ['i51', 'top+6'], { resistance: 10000 }),
        ],
        [w('i50', 'top-5')],
      ),
    )
    expect(ofRule(runErc(ok), 'led-current')).toEqual([])
  })

  it('both leads in one strip is an error (shorted, never lights)', () => {
    const l = valid(railsWorld([part('D1', 'led', ['a50', 'b50'])]))
    const f = ofRule(runErc(l), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].id).toBe('led-current:D1:shorted')
  })

  // UX fix wave IN-17: it can never light, so it is a risk (was info)
  it('an LED wired in reverse between the rails is a risk', () => {
    const l = valid(
      railsWorld([part('R1', 'resistor', ['top+5', 'a40'], { resistance: 330 }), part('D1', 'led', ['top-5', 'b40'])]),
    )
    const f = ofRule(runErc(l), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/in reverse/)
  })

  it('checks every segment of a 7-segment display (segment A tied straight to +5 V)', () => {
    // DIP-10 at f40: E f40, D f41, COM1 f42, C f43, DP f44, B e44, A e43, COM2 e42, F e41, G e40
    const l = valid(railsWorld([{ id: 'DS1', type: 'seven_segment', at: 'f40' }], [w('top+3', 'a43'), w('j42', 'top-6')]))
    const f = ofRule(runErc(l), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].message).toMatch(/DS1 segment A/)
  })

  it('upgrades to error and says so when the simulation burned the LED out', () => {
    // honesty F11: the LED burns from its junction temperature or above its 150 mA peak rating —
    // 47 Ω (66 mA) no longer burns it; 10 Ω (≈ 300 mA) does, within a millisecond
    const l = valid(
      railsWorld(
        [part('R1', 'resistor', ['top+5', 'a40'], { resistance: 10 }), part('D1', 'led', ['b40', 'b45'])],
        [w('c45', 'top-5')],
      ),
    )
    const engine = new SimEngine(l)
    engine.advance(0.005)
    const telemetry = engine.telemetry()
    expect(telemetry.components.D1.burned).toBe(true)
    const f = ofRule(runErc(l, { telemetry, issues: engine.issues }), 'led-current')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].message).toMatch(/burned it out/)
    // a burned LED is OPEN now (F11): what the simulation measures is the open junction's leakage
    expect(f[0].message).toMatch(/measures \d+(\.\d+)? [nµm]?A/)
    // the live rule does not repeat it
    expect(ofRule(runErc(l, { telemetry }), 'over-rating')).toEqual([])
  })
})
