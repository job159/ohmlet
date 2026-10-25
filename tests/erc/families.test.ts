/**
 * ERC on part families contributed through the catalog plug-in seam
 * (src/model/parts/*.parts.ts): batteries are voltage sources, a current
 * source is not, and a stand-alone regulator module is checked through its
 * catalog ratings and its 'ldo' sub-circuit element. Each case is skipped
 * when its catalog type is absent (the families are owned elsewhere).
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import { CATALOG } from '../../src/model/catalog'
import { bluePill, layout, modesTelemetry, ofRule, part, ps, summary, tap, valid, w } from './helpers'

const has = (t: string) => !!CATALOG[t]

describe('ERC on plug-in part families', () => {
  it.skipIf(!has('battery_9v'))('a 9 V battery is a source: an LED across it is an error, a jumper across it a short', () => {
    const bat = { id: 'BT1', type: 'battery_9v' }
    const led = valid(layout([bat, part('D1', 'led', ['top+5', 'top-5'])], [w('BT1:+', 'top+0'), w('BT1:-', 'top-0')]))
    const f = ofRule(runErc(led), 'led-current')
    expect(f.map((x) => x.level), summary(f)).toEqual(['error'])
    expect(f[0].message).toMatch(/BT1 \+ \(9\.00 V\)/)
    const short = valid(layout([bat], [w('BT1:+', 'top+0'), w('BT1:-', 'top-0'), w('top+3', 'top-3')]))
    expect(ofRule(runErc(short), 'supply-short').map((x) => x.level)).toEqual(['error'])
  })

  it.skipIf(!has('current_source'))('a current source limits its own current: no LED or short finding', () => {
    const l = valid(
      layout([{ id: 'CS1', type: 'current_source' }, part('D1', 'led', ['a40', 'a45'])], [w('CS1:+', 'b40'), w('CS1:-', 'b45')]),
    )
    const f = runErc(l)
    expect([...ofRule(f, 'led-current'), ...ofRule(f, 'supply-short')], summary(f)).toEqual([])
  })

  it.skipIf(!has('lm7805'))('LM7805: 12 V in is fine and its 5 V output is a rail; 6 V in is below its 7 V minimum', () => {
    // TO-220 IN/GND/OUT at a40/a41/a42 (its body overhangs a39 and a43)
    const mk = (v: number) =>
      valid(
        layout(
          [ps('PS1', v), part('U3', 'lm7805', ['a40', 'a41', 'a42']), part('D1', 'led', ['c42', 'top-9'])],
          [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('b40', 'top+5'), w('b41', 'top-5')],
        ),
      )
    const ok = runErc(mk(12))
    expect(ofRule(ok, 'supply-range'), summary(ok)).toEqual([])
    // the LED hangs straight on the regulator's 5 V output
    const led = ofRule(ok, 'led-current')
    expect(led.map((x) => x.level)).toEqual(['error'])
    expect(led[0].message).toMatch(/U3 5 V regulator \(5\.00 V\)/)
    const low = ofRule(runErc(mk(6)), 'supply-range')
    expect(low.map((x) => x.level), summary(low)).toEqual(['risk'])
    expect(low[0].message).toMatch(/7\.00 V minimum/)
  })
})

describe('ERC on a real I²C part (AT24C02 EEPROM)', () => {
  // DIP-8 at f40: A0 f40, A1 f41, A2 f42, GND f43, SDA e43, SCL e42, WP e41, VCC e40
  const eeprom = { id: 'U2', type: 'at24c02', at: 'f40' }
  const base = [w('a40', 'bot+5'), w('j43', 'bot-5'), w('a43', tap('PB7')), w('a42', tap('PB6'))]
  const mk = (pullups: boolean, extra: ReturnType<typeof w>[] = []) =>
    valid(
      bluePill(
        [
          eeprom,
          ...(pullups
            ? [
                part('R1', 'resistor', ['b42', 'bot+6'], { resistance: 4700 }),
                part('R2', 'resistor', ['b43', 'bot+7'], { resistance: 4700 }),
              ]
            : []),
        ],
        [...base, ...extra],
        { rail3v3: true },
      ),
    )

  it.skipIf(!has('at24c02'))('no pull-ups: risk with unknown firmware, error once PB6/PB7 are open-drain; clean with 4.7 kΩ', () => {
    expect(ofRule(runErc(mk(false)), 'i2c-pullup').map((x) => x.level)).toEqual(['risk', 'risk'])
    const od = ofRule(runErc(mk(false), { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) }), 'i2c-pullup')
    expect(od.map((x) => x.level), summary(od)).toEqual(['error', 'error'])
    const ok = runErc(mk(true), { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) })
    expect(ok, summary(ok)).toEqual([])
  })

  it.skipIf(!has('at24c02'))('WP / address pins are inputs with internal pull-downs: no logic-level or floating finding', () => {
    // WP (e41) on PA0; A0 (f40) through a pushbutton (f50) to 3.3 V
    const l = mk(true, [w('a41', tap('PA0')), w('j40', 'a50'), w('a52', 'bot+8')])
    l.components.push({ id: 'SW1', type: 'pushbutton', at: 'f50' })
    valid(l)
    const f = runErc(l)
    expect(ofRule(f, 'floating-input'), summary(f)).toEqual([])
    expect([...ofRule(f, 'logic-level'), ...ofRule(f, 'floating-input')], summary(f)).toEqual([])
  })
})
