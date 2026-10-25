/**
 * ERC rule 3 (GPIO overvoltage) and rule 6b (logic levels) on a Blue Pill.
 * PA0 / PA5 are standard I/O; PA9 / PA10 / PB6 are five-volt tolerant (FT)
 * per the catalog pinInfo (DS5319 Table 5).
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import type { ComponentInstance } from '../../src/model/types'
import { BP, bluePill, layout, modesTelemetry, ofRule, part, ps, summary, tap, valid, w } from './helpers'

/** 7404 at f40 powered from the 5 V top rails: VCC e40 → a40, GND f46 → j46; 1A = f40, 1Y = f41. */
const INV: ComponentInstance = { id: 'U2', type: 'sn7404', at: 'f40' }
const INV_POWER = [w('a40', 'top+6'), w('j46', 'top-6')]

describe('rule 3 — GPIO overvoltage', () => {
  it('a non-FT pin (PA0) tied to the 5 V rail is an error; tied to 3.3 V it is fine', () => {
    const hi = runErc(valid(bluePill([], [w(tap('PA0'), 'top+5')])))
    const f = ofRule(hi, 'gpio-overvoltage')
    expect(f, summary(hi)).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].message).toMatch(/PA0 is not 5 V tolerant/)
    expect(f[0].message).toMatch(/3\.60 V/)
    expect(f[0].holes).toEqual(['c25']) // the PA0 header pin (board at h10)

    const ok = runErc(valid(bluePill([], [w(tap('PA0'), 'bot+5')], { rail3v3: true })))
    expect(ofRule(ok, 'gpio-overvoltage'), summary(ok)).toEqual([])
  })

  it('an FT pin (PA9) on 5 V is info; with the firmware pull-up enabled it is a risk (DS5319 Table 9 note 3)', () => {
    const l = valid(bluePill([], [w(tap('PA9'), 'top+5')]))
    const f = ofRule(runErc(l), 'gpio-overvoltage')
    expect(f.map((x) => x.level), summary(f)).toEqual(['info'])
    expect(f[0].message).toMatch(/5 V tolerant/)

    const pulled = ofRule(runErc(l, { telemetry: modesTelemetry({ PA9: 'in↑' }) }), 'gpio-overvoltage')
    expect(pulled.map((x) => x.level)).toEqual(['risk'])
    expect(pulled[0].message).toMatch(/pull-up/)

    const nopull = ofRule(runErc(l, { telemetry: modesTelemetry({ PA9: 'in' }) }), 'gpio-overvoltage')
    expect(nopull.map((x) => x.level)).toEqual(['info'])
  })

  it('an FT pin above 5.5 V is an error', () => {
    const l = valid(
      bluePill([ps('PS2', 9)], [w('PS2:+', 'bot+0'), w('PS2:-', 'top-5'), w(tap('PA9'), 'bot+3')]),
    )
    const f = ofRule(runErc(l), 'gpio-overvoltage')
    expect(f.map((x) => x.level), summary(f)).toEqual(['error'])
    expect(f[0].message).toMatch(/only up to 5\.50 V/)
  })

  it('through a resistor: 10 kΩ to 5 V on PA0 is a risk (≈0.14 mA), 220 Ω is an error (> 5 mA injection)', () => {
    const mk = (r: number) =>
      valid(bluePill([part('R1', 'resistor', ['a40', 'top+5'], { resistance: r })], [w(tap('PA0'), 'b40')]))
    const soft = ofRule(runErc(mk(10_000)), 'gpio-overvoltage')
    expect(soft.map((x) => x.level), summary(soft)).toEqual(['risk'])
    expect(soft[0].message).toMatch(/140 µA/)
    expect(soft[0].componentIds).toContain('R1')
    const hard = ofRule(runErc(mk(220)), 'gpio-overvoltage')
    expect(hard.map((x) => x.level), summary(hard)).toEqual(['error'])
    expect(hard[0].message).toMatch(/±5 mA injection limit/)
  })

  it('a 10 kΩ / 20 kΩ divider from 5 V keeps PA0 at 3.33 V: no finding; 10 kΩ / 100 kΩ (4.55 V) is a risk', () => {
    const mk = (rDown: number) =>
      valid(
        bluePill(
          [
            part('R1', 'resistor', ['a40', 'top+5'], { resistance: 10_000 }),
            part('R2', 'resistor', ['b40', 'top-5'], { resistance: rDown }),
          ],
          [w(tap('PA0'), 'c40')],
        ),
      )
    expect(ofRule(runErc(mk(20_000)), 'gpio-overvoltage')).toEqual([])
    const f = ofRule(runErc(mk(100_000)), 'gpio-overvoltage')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/divide it to ≈ 4\.55 V/)
    expect(f[0].message).toMatch(/104 µA/) // (4.545 − 3.6) V / 9.09 kΩ
  })

  it('a pin held directly at GND is safe even with a resistor to 5 V on it', () => {
    const l = valid(
      bluePill([part('R1', 'resistor', ['a40', 'top+5'], { resistance: 1000 })], [w(tap('PA0'), 'b40'), w('c40', 'top-6')]),
    )
    expect(ofRule(runErc(l), 'gpio-overvoltage')).toEqual([])
  })

  it('the default function generator (0…5 V) on PA0 is an error; a 0…3 V signal is fine', () => {
    const mk = (params?: Record<string, number>) =>
      valid(
        bluePill(
          [params ? { id: 'FG1', type: 'function_generator', params } : { id: 'FG1', type: 'function_generator' }],
          [w('FG1:out', tap('PA0')), w('FG1:gnd', 'top-5')],
        ),
      )
    const f = ofRule(runErc(mk()), 'gpio-overvoltage')
    expect(f.map((x) => x.level), summary(f)).toEqual(['error'])
    expect(f[0].message).toMatch(/FG1 out/)
    expect(ofRule(runErc(mk({ offset: 1.5, amplitude: 1.5 })), 'gpio-overvoltage')).toEqual([])
    const neg = ofRule(runErc(mk({ offset: 0, amplitude: 2 })), 'gpio-overvoltage')
    expect(neg.map((x) => x.level)).toEqual(['error'])
    expect(neg[0].message).toMatch(/VSS − 0\.3 V/)
  })

  it('an unpowered (but grounded) board with a pin on 5 V is a back-powering risk', () => {
    const l = valid(
      layout([ps(), BP], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w(tap('GND3'), 'top-1'), w(tap('PA0'), 'top+2')]),
    )
    const f = ofRule(runErc(l), 'gpio-overvoltage')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/back-powers/)
  })
})

describe('rule 6b — logic levels', () => {
  it('a 5 V 7404 output on non-FT PA0 is an error; on FT PA9 it is info', () => {
    const bad = runErc(valid(bluePill([INV], [...INV_POWER, w('j41', tap('PA0'))])))
    const f = ofRule(bad, 'logic-level')
    expect(f.map((x) => x.level), summary(bad)).toEqual(['error'])
    expect(f[0].message).toMatch(/U2 1Y/)
    expect(f[0].componentIds).toEqual(['U1', 'U2'])

    const ft = ofRule(runErc(valid(bluePill([INV], [...INV_POWER, w('j41', tap('PA9'))]))), 'logic-level')
    expect(ft.map((x) => x.level)).toEqual(['info'])
  })

  it('through a 1 kΩ series resistor the 5 V output is a risk (≈1.4 mA injected)', () => {
    const l = valid(
      bluePill([INV, part('R1', 'resistor', ['g41', 'g50'], { resistance: 1000 })], [...INV_POWER, w('j50', tap('PA0'))]),
    )
    const f = ofRule(runErc(l), 'logic-level')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/1\.40 mA/)
  })

  it('a 3.3 V output into a 5 V CD4017 clock (VIH 3.5 V) is a risk; into a TTL 7404 input it is fine', () => {
    // CD4017 at f50: VDD e50, VSS f57, CLK e52
    const cd = { id: 'U3', type: 'cd4017', at: 'f50' }
    const l = valid(bluePill([cd], [w('a50', 'top+7'), w('j57', 'top-7'), w('a52', tap('PA0'))]))
    const f = ofRule(runErc(l), 'logic-level')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk'])
    expect(f[0].message).toMatch(/3\.50 V on CLK/)
    // the firmware keeps PA0 an input → no output drives CLK
    expect(ofRule(runErc(l, { telemetry: modesTelemetry({ PA0: 'in' }) }), 'logic-level')).toEqual([])
    // TTL input threshold is 2 V
    const ttl = valid(bluePill([INV], [...INV_POWER, w('j40', tap('PA0'))]))
    expect(ofRule(runErc(ttl), 'logic-level')).toEqual([])
  })

  it('a 7404 input tied above its 5.5 V absolute maximum is an error', () => {
    const l = valid(
      layout(
        [ps('PS1', 5), ps('PS2', 9), INV],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('PS2:+', 'bot+0'), w('PS2:-', 'top-1'), ...INV_POWER, w('j40', 'bot+2')],
      ),
    )
    const f = ofRule(runErc(l), 'logic-level')
    expect(f.map((x) => x.level), summary(f)).toEqual(['error'])
    expect(f[0].message).toMatch(/U2 1A.*5\.50 V absolute-maximum/)
  })
})
