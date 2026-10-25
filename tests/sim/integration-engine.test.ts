/**
 * Wave-3 integration follow-ups in the analog core (src/sim/engine.ts,
 * netlist.ts, devices.ts) requested by the Wave-2 device engineers:
 *  1. off-board SOURCES beyond power_supply / function_generator
 *     (CatalogEntry.source: battery_9v, battery_aa2, current_source) power
 *     the circuit and define ground — no false "no power supply" / "no ground";
 *  2. CatalogEntry.strictNewton (relay_5v) turns SimEngine.strictConvergence on;
 *  4. AnalogDevice.issues() — device-reported runtime issues, attributed to
 *     the owning part (sub-circuit elements → their parent).
 * Legacy layouts are untouched (tests/sim/legacy-equivalence stays bit-identical).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SimEngine } from '../../src/sim/engine'
import { buildNetlist } from '../../src/sim/netlist'
import { BaseDevice, registerDevice } from '../../src/sim/devices'
import { CATALOG } from '../../src/model/catalog'
import type { CatalogEntry } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, SimIssue } from '../../src/model/types'
import type { StampContext } from '../../src/sim/mna'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { LEGACY_EXAMPLES, loadExample } from './legacy-scenarios'

let wseq = 0
const w = (from: string, to: string) => ({ id: `w${++wseq}`, from, to })
const lay = (components: ComponentInstance[], wires: ReturnType<typeof w>[]): CircuitLayout => ({
  version: 1,
  components,
  wires,
})
const messages = (e: SimEngine): string[] => e.issues.map((i) => i.message)

// ------------------------------------------------------------ 1. sources

describe('off-board sources (CatalogEntry.source)', () => {
  it('battery_9v, battery_aa2 and current_source declare their terminals', () => {
    for (const t of ['battery_9v', 'battery_aa2', 'current_source']) {
      expect(CATALOG[t].source, t).toEqual({ plus: '+', minus: '-' })
    }
    // the legacy bench instruments keep their hard-wired roles
    expect(CATALOG.power_supply.source).toBeUndefined()
    expect(CATALOG.function_generator.source).toBeUndefined()
  })

  it('a battery-only LED circuit: no "no power supply", no "no ground", ground = battery minus', () => {
    const layout = lay(
      [
        { id: 'B1', type: 'battery_9v' },
        { id: 'R1', type: 'resistor', holes: ['top+2', 'a10'], params: { resistance: 1000 } },
        { id: 'D1', type: 'led', holes: ['c10', 'top-2'], params: { color: 'red' } },
      ],
      [w('B1:+', 'top+0'), w('B1:-', 'top-0')],
    )
    const nl = buildNetlist(layout)
    expect(nl.warnings).not.toContain('no ground')
    expect(nl.ground).toBe(nl.netOf('B1:-'))
    const e = new SimEngine(layout)
    e.advance(0.01)
    expect(messages(e)).not.toContain('no power supply')
    expect(e.netVoltage('top-0')).toBe(0)
    const tele = e.telemetry()
    // I = (9 V − Vf) / (1 kΩ + 1.5 Ω internal): ≈ 7 mA through a red LED
    const i = tele.components.D1.current ?? NaN
    expect(i).toBeGreaterThan(0.0068)
    expect(i).toBeLessThan(0.0074)
    // the terminal voltage sags by I · 1.5 Ω
    expect(e.netVoltage('top+0')).toBeCloseTo(9 - i * 1.5, 6)
  })

  it('a lab current source alone drives its set current into a resistor (V = I·R, behind 1 MΩ)', () => {
    const layout = lay(
      [
        { id: 'CS1', type: 'current_source', params: { current: 5 } },
        { id: 'R1', type: 'resistor', holes: ['top+3', 'top-3'], params: { resistance: 1000 } },
      ],
      [w('CS1:+', 'top+0'), w('CS1:-', 'top-0')],
    )
    const e = new SimEngine(layout)
    e.advance(0.002)
    expect(messages(e)).not.toContain('no power supply')
    expect(buildNetlist(layout).warnings).not.toContain('no ground')
    expect(e.netVoltage('top-0')).toBe(0)
    expect(e.netVoltage('top+0')).toBeCloseTo((0.005 * 1000 * 1e6) / (1000 + 1e6), 4)
  })

  it('a power_supply or function_generator still defines ground first (legacy rule)', () => {
    const layout = lay(
      [
        { id: 'B1', type: 'battery_aa2' },
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'R1', type: 'resistor', holes: ['top+2', 'top-2'], params: { resistance: 1000 } },
        { id: 'R2', type: 'resistor', holes: ['bot+2', 'bot-2'], params: { resistance: 1000 } },
      ],
      [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('B1:+', 'bot+0'), w('B1:-', 'bot-0')],
    )
    const nl = buildNetlist(layout)
    expect(nl.ground).toBe(nl.netOf('PS1:-'))
    const fg = lay(
      [
        { id: 'B1', type: 'battery_9v' },
        { id: 'FG1', type: 'function_generator' },
      ],
      [],
    )
    const nf = buildNetlist(fg)
    expect(nf.ground).toBe(nf.netOf('FG1:gnd'))
  })

  it('without any source the legacy warnings remain', () => {
    const layout = lay([{ id: 'R1', type: 'resistor', holes: ['a1', 'a5'] }], [])
    expect(buildNetlist(layout).warnings).toContain('no ground')
    expect(messages(new SimEngine(layout))).toContain('no power supply')
  })
})

// --------------------------------------------------------- 2. strictNewton

describe('CatalogEntry.strictNewton → SimEngine.strictConvergence', () => {
  const relay = (): CircuitLayout =>
    lay(
      [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'K1', type: 'relay_5v', at: 'd20' },
      ],
      [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('a20', 'top+1'), w('j20', 'top-1')],
    )

  it('relay_5v carries the flag; a layout with it solves strictly whatever a caller assigns', () => {
    expect(CATALOG.relay_5v.strictNewton).toBe(true)
    const e = new SimEngine(relay())
    expect(e.requiresStrictConvergence).toBe(true)
    expect(e.strictConvergence).toBe(true)
    e.strictConvergence = false // e.g. the coordinator in a pure analog world
    expect(e.strictConvergence).toBe(true)
  })

  it('layouts without such a part keep the legacy default (off, assignable)', () => {
    for (const [name, raw] of LEGACY_EXAMPLES) {
      const e = new SimEngine(loadExample(raw))
      expect(e.requiresStrictConvergence, name).toBe(false)
      expect(e.strictConvergence, name).toBe(false)
      e.strictConvergence = true
      expect(e.strictConvergence, name).toBe(true)
    }
  })

  it('the coordinator keeps it on in a pure analog world with a relay', () => {
    const co = new SimulationCoordinator()
    co.load(relay(), 1)
    expect(co.engine?.strictConvergence).toBe(true)
    co.advance(0.02)
    // the energized coil picked the armature up (5 V / 70 Ω ≈ 71 mA > 53.6 mA)
    expect(co.telemetry().components.K1.sub?.K.values?.energized).toBe(1)
    co.dispose()
  })
})

// ------------------------------------------------------- 4. device issues

/** Raises one warning when its pin voltage first exceeds `limit` (shared empty array otherwise). */
class ThresholdDevice extends BaseDevice {
  private pending: SimIssue[] = []
  private fired = false
  calls = 0
  private static readonly NONE: readonly SimIssue[] = []
  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], 1e-3)
  }
  endStep(x: Float64Array): void {
    const v = this.nodes[0] >= 0 ? x[this.nodes[0]] : 0
    if (!this.fired && v > this.num('limit', 3)) {
      this.fired = true
      this.pending.push({ level: 'warning', message: `${this.comp.id}: above ${this.num('limit', 3)} V` })
    }
  }
  issues(): readonly SimIssue[] {
    this.calls++
    if (this.pending.length === 0) return ThresholdDevice.NONE
    const out = this.pending
    this.pending = []
    return out
  }
}

class ThrowingDevice extends BaseDevice {
  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], 1e-3)
  }
  issues(): readonly SimIssue[] {
    throw new Error('diagnostics exploded')
  }
}

const entry = (e: Partial<CatalogEntry> & Pick<CatalogEntry, 'type' | 'pins' | 'sim'>): CatalogEntry =>
  ({ label: e.type, category: 'passive', placement: 'leads', doc: 'test-only part', ...e }) as CatalogEntry

describe('AnalogDevice.issues() (device-reported runtime issues)', () => {
  const instances: ThresholdDevice[] = []
  beforeAll(() => {
    registerDevice('test_threshold', (c, e, n) => {
      const d = new ThresholdDevice(c, e, n)
      instances.push(d)
      return d
    })
    registerDevice('test_throwing', (c, e, n) => new ThrowingDevice(c, e, n))
    CATALOG.test_threshold_part = entry({
      type: 'test_threshold_part',
      pins: ['p', 'n'],
      params: [{ key: 'limit', label: 'limit', kind: 'number', default: 3 }],
      sim: { kind: 'device', model: 'test_threshold' },
    })
    CATALOG.test_threshold_host = entry({
      type: 'test_threshold_host',
      pins: ['A', 'B'],
      sim: { kind: 'probe' },
      subcircuit: [{ id: 'MON', model: 'test_threshold', pins: ['A', 'B'], params: { limit: 4 } }],
    })
    CATALOG.test_throwing_part = entry({
      type: 'test_throwing_part',
      pins: ['p', 'n'],
      sim: { kind: 'device', model: 'test_throwing' },
    })
  })
  afterAll(() => {
    delete CATALOG.test_threshold_part
    delete CATALOG.test_threshold_host
    delete CATALOG.test_throwing_part
  })

  const world = (v: number, comps: ComponentInstance[]): CircuitLayout =>
    lay([{ id: 'PS1', type: 'power_supply', params: { voltage: v } }, ...comps], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0')])

  it('collects a top-level device issue once, attributed to its part, polled once per step', () => {
    const e = new SimEngine(world(5, [{ id: 'X1', type: 'test_threshold_part', holes: ['top+1', 'top-1'] }]))
    e.advance(10 * 5e-5)
    const hit = e.issues.filter((i) => i.message === 'X1: above 3 V')
    expect(hit).toEqual([{ level: 'warning', message: 'X1: above 3 V', componentId: 'X1' }])
    expect(instances[instances.length - 1].calls).toBe(10)
  })

  it('a sub-circuit element reports under the PARENT part', () => {
    const e = new SimEngine(world(5, [{ id: 'H1', type: 'test_threshold_host', holes: ['top+2', 'top-2'] }]))
    e.step()
    expect(e.issues.find((i) => i.message === 'H1.MON: above 4 V')).toEqual({
      level: 'warning',
      message: 'H1.MON: above 4 V',
      componentId: 'H1',
    })
  })

  it('below the limit nothing is raised; legacy devices are never polled', () => {
    const e = new SimEngine(world(2, [{ id: 'X2', type: 'test_threshold_part', holes: ['top+1', 'top-1'] }]))
    e.advance(0.001)
    expect(e.issues.some((i) => i.componentId === 'X2')).toBe(false)
  })

  it('a throwing issues() becomes ONE model-error issue, never an exception', () => {
    const e = new SimEngine(world(5, [{ id: 'T1', type: 'test_throwing_part', holes: ['top+1', 'top-1'] }]))
    expect(() => e.advance(0.001)).not.toThrow()
    const errs = e.issues.filter((i) => i.componentId === 'T1')
    expect(errs).toHaveLength(1)
    expect(errs[0].level).toBe('error')
    expect(errs[0].message).toContain('component T1 model error: Error: diagnostics exploded')
  })
})
