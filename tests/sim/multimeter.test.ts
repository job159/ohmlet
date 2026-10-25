/**
 * Catalog multimeter ('multimeter' device model) — exactly the modes its
 * catalog support text states: V (10 MΩ), A (0.1 Ω shunt in series),
 * Ω (1 V / 10 kΩ ohmmeter). Telemetry: values.reading + display text.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../../src/sim/engine'
import { DMM_OHM_MAX, formatReading } from '../../src/sim/devices'
import type { CircuitLayout, ComponentInstance } from '../../src/model/types'

let wseq = 0
const w = (from: string, to: string) => ({ id: `w${++wseq}`, from, to })
const mm = (mode: string): ComponentInstance => ({ id: 'MM1', type: 'multimeter', params: { mode } })
const lay = (components: ComponentInstance[], wires: ReturnType<typeof w>[]): CircuitLayout => ({ version: 1, components, wires })

describe('display formatting', () => {
  it('autoranges with an SI prefix and fixed significant digits', () => {
    expect(formatReading(3.29812, 'V', 4)).toBe('3.298 V')
    expect(formatReading(0.01234, 'A', 3)).toBe('12.3 mA')
    expect(formatReading(4700, 'Ω', 3)).toBe('4.70 kΩ')
    expect(formatReading(0, 'V', 4)).toBe('0.000 mV') // zero rests in the mV range (SIM-F1)
    expect(formatReading(-1.5, 'V', 4)).toBe('-1.500 V')
    expect(formatReading(999.96, 'Ω', 4)).toBe('1.000 kΩ') // rounding carries into the next range
    expect(formatReading(2.2e-5, 'A', 3)).toBe('22.0 µA')
    expect(formatReading(Infinity, 'Ω', 3)).toBe('OL')
  })
})

describe('V mode', () => {
  it('reads the divider midpoint with a 10 MΩ input', () => {
    const e = new SimEngine(
      lay(
        [
          { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
          { id: 'R1', type: 'resistor', holes: ['a10', 'a20'], params: { resistance: 10_000 } },
          { id: 'R2', type: 'resistor', holes: ['b20', 'top-3'], params: { resistance: 10_000 } },
          mm('V'),
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b10'), w('MM1:IN', 'c20'), w('MM1:COM', 'top-4')],
      ),
    )
    e.step()
    const t = e.telemetry().components.MM1
    // 10 k || 10 MΩ loading: 5 · 9990/(10000 + 9990)
    const expected = (5 * (1 / (1 / 10_000 + 1 / 10e6))) / (10_000 + 1 / (1 / 10_000 + 1 / 10e6))
    expect(t.values!.reading).toBeCloseTo(expected, 4) // + GMIN (1 nS per node)
    expect(t.text).toEqual(['2.499 V', 'DC V'])
  })
})

describe('A mode', () => {
  it('measures the current through the meter wired in series', () => {
    const e = new SimEngine(
      lay(
        [
          { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
          { id: 'R1', type: 'resistor', holes: ['a10', 'a20'], params: { resistance: 1000 } },
          mm('A'),
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b10'), w('c20', 'MM1:IN'), w('MM1:COM', 'top-4')],
      ),
    )
    e.step()
    const t = e.telemetry().components.MM1
    const i = 5 / (1000 + 0.1 + 0.01)
    expect(t.values!.reading).toBeCloseTo(i, 9)
    expect(t.current).toBeCloseTo(i, 9)
    expect(t.text![0]).toBe('5.00 mA')
    expect(e.telemetry().components.R1.current).toBeCloseTo(i, 9)
  })
})

describe('Ω mode', () => {
  const ohmWorld = (holes: string[] | null) =>
    new SimEngine(
      lay(
        [
          { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
          ...(holes ? [{ id: 'R1', type: 'resistor', holes, params: { resistance: 4700 } } as ComponentInstance] : []),
          mm('Ω'),
        ],
        [w('PS1:-', 'top-0'), w('MM1:IN', 'c30'), w('MM1:COM', 'c40')],
      ),
    )

  it('reads a 4.7 kΩ resistor between the probes', () => {
    const e = ohmWorld(['a30', 'a40'])
    e.step()
    const t = e.telemetry().components.MM1
    expect(t.values!.reading).toBeCloseTo(4700, 0)
    expect(t.text).toEqual(['4.70 kΩ', 'Ω'])
  })

  it('reads OL with open probes and switches mode at runtime', () => {
    const e = ohmWorld(null)
    e.step()
    let t = e.telemetry().components.MM1
    expect(t.values!.reading).toBe(Infinity)
    expect(t.text![0]).toBe('OL')
    expect(DMM_OHM_MAX).toBe(40e6)
    e.setRuntimeParam('MM1', 'mode', 'V')
    e.step()
    t = e.telemetry().components.MM1
    expect(t.text![1]).toBe('DC V')
    expect(Math.abs(t.values!.reading)).toBeLessThan(1e-6)
  })
})
