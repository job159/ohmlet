/**
 * Damage support texts say what the code does (review 4, SIM-3; round 5).
 *
 * A burned LED / resistor or a vented capacitor stays damaged until it is
 * replaced: 〔換新〕 (SimEngine.repairParts — in place), or by itself when
 * the circuit is edited (every document change rebuilds the engine: store →
 * host.load → new SimEngine, and the damage lives in the device instances)
 * or a value changes (auto-heal.ts), or a reset. The DamageBanner says so;
 * the catalog's support texts (English and zh-TW, the inspector and
 * docs/support-matrix.md) say it too. The English one is also what the
 * classic chrome shows (no 〔換新〕, no automatic 換新 there): it names
 * “Replace” and the value change as the workspace's.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/model/catalog'
import { PARTS_ZH } from '../src/i18n/zh-TW/parts-core'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { CircuitLayout } from '../src/model/types'
import { layout, twoLead } from './helpers'

const LATCHED = ['resistor', 'capacitor', 'led'] as const

describe('damage latch texts', () => {
  it('English (classic chrome reads it too): latched until a new part goes in — an edit or a reset; “Replace” and a value change in the workspace', () => {
    for (const type of LATCHED) {
      const lines = CATALOG[type].support?.simulated ?? []
      const latch = lines.filter((l) => /latched/.test(l))
      expect(latch.length, type).toBe(1)
      expect(latch[0], type).toMatch(
        /latched until a new part goes in[ (—]+a circuit edit or a reset puts one in; in the workspace, “Replace” and a value change do too/,
      )
    }
  })

  it('zh-TW: 直到按〔換新〕換上新的（改好電路或數值時會自動換新…）, line for line with the English', () => {
    for (const type of LATCHED) {
      const en = CATALOG[type].support?.simulated ?? []
      const zh = PARTS_ZH[type]?.simulated ?? []
      expect(zh.length, type).toBe(en.length)
      const k = en.findIndex((l) => /latched/.test(l))
      expect(zh[k], type).toMatch(/直到按〔換新〕換上新的[（—]+改好電路或數值時會自動換新，重置模擬也會/)
      expect(zh.join('\n'), type).not.toMatch(/直到重置模擬/)
    }
  })

  it('…which is what happens: an unrelated edit brings a burned LED back', () => {
    const W = (id: string, from: string, to: string) => ({ id, from, to })
    const base: CircuitLayout = layout(
      [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, twoLead('D1', 'led', 'top+1', 'top-1', { color: 'red' })],
      [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0')],
    )
    const co = new SimulationCoordinator()
    co.load(base, 1)
    co.advance(0.01)
    expect(co.frame().telemetry.components.D1.damage?.kind).toBe('burned')
    // an unrelated wire: the engine is rebuilt, the LED is intact again
    co.load({ ...base, wires: [...base.wires, W('wx', 'j50', 'j55')] }, 2)
    expect(co.frame().telemetry.components.D1.damage).toBeUndefined()
    co.dispose?.()
  })
})
