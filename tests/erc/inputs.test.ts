/**
 * ERC rule 4 (floating inputs) and rule 5 (I²C pull-ups) on a Blue Pill.
 *
 * The I²C tests use a TEST-ONLY catalog entry (a generic logic device with
 * VCC/GND/SCL/SDA pins), inserted into CATALOG for this file only (vitest
 * isolates module state per test file), because the rule must work for any
 * part family whose DigitalSpec names SDA/SCL pins.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import { CATALOG } from '../../src/model/catalog'
import type { ComponentInstance } from '../../src/model/types'
import { I2C_DEV, bluePill, layout, modesTelemetry, ofRule, part, ps, sensor, sensorPower, summary, tap, valid, w } from './helpers'

// ---------------------------------------------------------------------------
// rule 4
// ---------------------------------------------------------------------------

/** SW1 at f40: A side = strip 40 (a40 free), B side = strip 42 (a42 free). */
const SW1: ComponentInstance = { id: 'SW1', type: 'pushbutton', at: 'f40' }

/** PA0 → button → GND (bot- = ground, bot+ = board 3.3 V). */
function buttonToGnd(extra: ComponentInstance[] = [], pin = 'PA0') {
  return valid(bluePill([SW1, ...extra], [w(tap(pin), 'a40'), w('a42', 'bot-1')], { rail3v3: true }))
}

describe('rule 4 — floating inputs', () => {
  it('a button from PA0 to GND with no pull resistor is a risk that names the fix', () => {
    const f = ofRule(runErc(buttonToGnd()), 'floating-input')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/pull-up/)
    expect(f[0].message).toMatch(/GPIO_PULLUP|10 kΩ/)
    expect(f[0].componentIds).toEqual(['U1', 'SW1'])
  })

  it('an external 10 kΩ pull-up to 3.3 V clears it; a pull-DOWN with a button to GND is flagged', () => {
    const up = buttonToGnd([part('R1', 'resistor', ['b40', 'bot+3'], { resistance: 10_000 })])
    expect(ofRule(runErc(up), 'floating-input')).toEqual([])
    const down = buttonToGnd([part('R1', 'resistor', ['b40', 'bot-3'], { resistance: 10_000 })])
    const f = ofRule(runErc(down), 'floating-input')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/changes nothing/)
  })

  it('uses the firmware pin mode: in↑ clears it, in↓ / floating / push-pull output are risks', () => {
    const l = buttonToGnd()
    const run = (mode: string) => ofRule(runErc(l, { telemetry: modesTelemetry({ PA0: mode }) }), 'floating-input')
    expect(run('in↑')).toEqual([])
    expect(run('in↓')[0].message).toMatch(/changes nothing/)
    expect(run('in')[0].message).toMatch(/floating input \(GPIO_NOPULL\)/)
    expect(run('out')[0].message).toMatch(/push-pull output/)
    // a board without running firmware gives no mode evidence
    const reset = modesTelemetry({ PA0: 'in↑' })
    reset.components.U1.mcu!.state = 'reset'
    expect(ofRule(runErc(l, { telemetry: reset }), 'floating-input')).toHaveLength(1)
  })

  it('a button to 3.3 V wants a pull-down (in↓ clears it)', () => {
    const l = valid(bluePill([SW1], [w(tap('PA0'), 'a40'), w('a42', 'bot+1')], { rail3v3: true }))
    const f = ofRule(runErc(l), 'floating-input')
    expect(f[0].message).toMatch(/pull-down/)
    expect(ofRule(runErc(l, { telemetry: modesTelemetry({ PA0: 'in↓' }) }), 'floating-input')).toEqual([])
  })

  it('PA12 already has the board’s 10 kΩ USB pull-up (R10): no finding', () => {
    expect(ofRule(runErc(buttonToGnd([], 'PA12')), 'floating-input')).toEqual([])
  })

  it('an SPDT slide switch between 3.3 V and GND defines both positions; with one throw open it floats', () => {
    // slide switch a = c50, common = c51, b = c52
    const sw = part('SW2', 'slide_switch', ['c50', 'c51', 'c52'])
    const both = valid(bluePill([sw], [w(tap('PA0'), 'a51'), w('a50', 'bot+1'), w('a52', 'bot-1')], { rail3v3: true }))
    expect(ofRule(runErc(both), 'floating-input')).toEqual([])
    const one = valid(bluePill([sw], [w(tap('PA0'), 'a51'), w('a52', 'bot-1')], { rail3v3: true }))
    expect(ofRule(runErc(one), 'floating-input').map((x) => x.level)).toEqual(['risk'])
  })
})

// ---------------------------------------------------------------------------
// rule 5
// ---------------------------------------------------------------------------

beforeAll(() => {
  CATALOG[I2C_DEV.type] = I2C_DEV
})
afterAll(() => {
  delete CATALOG[I2C_DEV.type]
})

describe('rule 5 — I²C pull-ups', () => {
  const bus = (extraParts: ComponentInstance[] = [], swap = false) =>
    valid(
      bluePill(
        [sensor(), ...extraParts],
        [...sensorPower(), w('b42', tap(swap ? 'PB7' : 'PB6')), w('b43', tap(swap ? 'PB6' : 'PB7'))],
        { rail3v3: true },
      ),
    )

  it('sensor on PB6/PB7 without pull-ups: risk while the firmware is unknown, error once it is open-drain', () => {
    const f = ofRule(runErc(bus()), 'i2c-pullup')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk', 'risk'])
    expect(f.map((x) => x.message).join('\n')).toMatch(/SCL[\s\S]*SDA|SDA[\s\S]*SCL/)

    const od = runErc(bus(), { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) })
    const e = ofRule(od, 'i2c-pullup')
    expect(e.map((x) => x.level), summary(od)).toEqual(['error', 'error'])
    // UX wave IN-8: the datasheet citation moved from the message to ErcFinding.ref (shown under 「詳細」)
    expect(e[0].message).toMatch(/open-drain, so every device/)
    expect(e[0].ref).toBe('NXP UM10204 §3.1.1')
    expect(e[0].componentIds.sort()).toEqual(['U1', 'U2'])
  })

  it('4.7 kΩ pull-ups to 3.3 V clear both lines', () => {
    const l = bus([
      part('R1', 'resistor', ['c42', 'bot+20'], { resistance: 4700 }),
      part('R2', 'resistor', ['c43', 'bot+21'], { resistance: 4700 }),
    ])
    expect(ofRule(runErc(l), 'i2c-pullup')).toEqual([])
    expect(ofRule(runErc(l, { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) }), 'i2c-pullup')).toEqual([])
  })

  it('pull-ups to 5 V on the FT pins PB6/PB7 are allowed (info about the internal pulls)', () => {
    const l = bus([
      part('R1', 'resistor', ['c42', 'top+20'], { resistance: 4700 }),
      part('R2', 'resistor', ['c43', 'top+21'], { resistance: 4700 }),
    ])
    const all = runErc(l)
    expect(ofRule(all, 'i2c-pullup')).toEqual([])
    expect(ofRule(all, 'gpio-overvoltage').map((x) => x.level), summary(all)).toEqual(['info', 'info'])
  })

  it('SDA wired to PB6 (I2C1_SCL) is reported as swapped', () => {
    const f = ofRule(runErc(bus([], true)), 'i2c-pullup').filter((x) => /swapped/.test(x.message))
    expect(f, summary(f)).toHaveLength(2)
    expect(f.every((x) => x.level === 'risk')).toBe(true)
  })

  it('two devices sharing SDA/SCL with no pull-ups (no MCU) is an error', () => {
    const l = valid(
      layout(
        [ps('PS1', 3.3), sensor('U2', 40), sensor('U3', 50)],
        [
          w('PS1:+', 'bot+0'),
          w('PS1:-', 'bot-0'),
          ...sensorPower(40),
          ...sensorPower(50),
          w('b42', 'b52'),
          w('b43', 'b53'),
        ],
      ),
    )
    const f = ofRule(runErc(l), 'i2c-pullup')
    expect(f.map((x) => x.level), summary(f)).toEqual(['error', 'error'])
  })
})
