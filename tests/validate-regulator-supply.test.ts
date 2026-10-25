import { describe, expect, it } from 'vitest'
import { validateLayout } from '../src/model/validate'
import type { CircuitLayout } from '../src/model/types'

// A 3.3 V I2C EEPROM fed from the Blue Pill's own 3V3 pin (its on-board LDO),
// the board itself powered through its 5V pin from a bench supply.
function layout(withBoardSupply: boolean): CircuitLayout {
  const wires = [
    { id: 'w1', from: 'PS1:-', to: 'top-0' },
    // Blue Pill at h10: 5V = h27, GND3 = h28, 3V3_2 = h29
    { id: 'w3', from: 'j28', to: 'top-5' },
    { id: 'w4', from: 'j29', to: 'a40' }, // board 3V3 → EEPROM VCC strip (U2 pin 8 at e40)
    { id: 'w5', from: 'top-12', to: 'j43' }, // EEPROM GND (pin 4 at f43)
  ]
  if (withBoardSupply) wires.push({ id: 'w2', from: 'PS1:+', to: 'j27' })
  return {
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
      { id: 'U2', type: 'at24c02', at: 'f40' },
    ],
    wires,
  }
}

describe('validator: on-board regulators are supply sources', () => {
  it('a part fed from the Blue Pill 3V3 pin is powered when the board 5V pin is', () => {
    const r = validateLayout(layout(true))
    expect(r.errors).toEqual([])
    expect(r.warnings.filter((w) => /supply pin VCC/.test(w))).toEqual([])
  })
  it('the same part is still reported when the board itself is unpowered', () => {
    const r = validateLayout(layout(false))
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => /U2.*supply pin VCC.*not connected to any power supply "\+"/.test(w))).toBe(true)
  })
})
