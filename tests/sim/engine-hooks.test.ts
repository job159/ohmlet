/**
 * Additive SimEngine hooks for the embedded platform (src/sim/engine.ts,
 * devices.ts, chip-api.ts): board-rows fix (defect B1), node access API,
 * sub-circuits, chip-context extensions, device registry, diagnostics,
 * opt-in strict Newton convergence, and the LDO regulator model.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_DT, GROUND_NODE, NO_NODE, SimEngine } from '../../src/sim/engine'
import { registerChip } from '../../src/sim/chip-api'
import type { ChipInstance, ChipStepCtx } from '../../src/sim/chip-api'
import { BaseDevice, createDevice, registerDevice, registeredDevices } from '../../src/sim/devices'
import { CATALOG } from '../../src/model/catalog'
import type { CatalogEntry } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, ParamValue } from '../../src/model/types'
import type { StampContext } from '../../src/sim/mna'
import { LEGACY_EXAMPLES, loadExample } from './legacy-scenarios'

let wseq = 0
const w = (from: string, to: string) => ({ id: `w${++wseq}`, from, to })
const ps = (v = 5, id = 'PS1'): ComponentInstance => ({ id, type: 'power_supply', params: { voltage: v } })
const lay = (components: ComponentInstance[], wires: ReturnType<typeof w>[], extra: Partial<CircuitLayout> = {}): CircuitLayout => ({
  version: 1,
  components,
  wires,
  ...extra,
})

function testEntry(e: Partial<CatalogEntry> & Pick<CatalogEntry, 'type' | 'pins' | 'sim'>): CatalogEntry {
  return { label: e.type, category: 'passive', placement: 'leads', doc: 'test-only part', ...e } as CatalogEntry
}

// ----------------------------------------------------- test-only chip/device

class ExtChip implements ChipInstance {
  param = 0
  seen = { readAt: NaN, readByName: NaN }
  constructor(readonly comp: ComponentInstance) {}
  step(ctx: ChipStepCtx): void {
    // pins: VCC GND OUT SINK IN
    this.seen.readAt = ctx.readPinAt!(4)
    this.seen.readByName = ctx.readPin('IN')
    ctx.setRailPins!(0, 1)
    ctx.drivePinStageAt!(2, 1 / 100, 0) // OUT: 100 Ω to VCC
    ctx.drivePinAt!(3, 1.0, this.param > 0 ? 1000 : 0) // SINK: 1 V / 1 kΩ to ground, or released
    if (this.seen.readAt > 4) ctx.reportIssue!('warning', `${this.comp.id}: IN above 4 V`)
  }
  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'p') this.param = Number(value)
  }
  fillTelemetry(tele: ComponentTelemetry): void {
    tele.values = { param: this.param }
  }
}
const chips = new Map<string, ExtChip>()

class FixedCurrent extends BaseDevice {
  stamp(ctx: StampContext): void {
    ctx.addCurrent(this.nodes[0], this.num('amps', 0.001))
  }
}

beforeAll(() => {
  CATALOG.test_ext_chip = testEntry({
    type: 'test_ext_chip',
    pins: ['VCC', 'GND', 'OUT', 'SINK', 'IN'],
    sim: { kind: 'chip', model: 'test-ext-chip' },
  })
  registerChip('test-ext-chip', (comp) => {
    const c = new ExtChip(comp)
    chips.set(comp.id, c)
    return c
  })
  CATALOG.test_sub = testEntry({
    type: 'test_sub',
    pins: ['A', 'K'],
    sim: { kind: 'probe' },
    subcircuit: [
      { id: 'L', model: 'led', pins: ['A', '@m'], params: { color: 'red' } },
      { id: 'R', model: 'resistor', pins: ['@m', 'K'], params: { resistance: 10 } },
    ],
  })
  CATALOG.test_ldo = testEntry({ type: 'test_ldo', pins: ['IN', 'OUT', 'GND'], sim: { kind: 'device', model: 'ldo' } })
  CATALOG.test_isrc = testEntry({ type: 'test_isrc', pins: ['P'], sim: { kind: 'device', model: 'test-isrc' } })
  registerDevice('test-isrc', (comp, entry, nodes) => new FixedCurrent(comp, entry, nodes))
})

// ------------------------------------------------------------------- B1

describe('board-rows (defect B1)', () => {
  it('simulates parts placed on board-row 1 (they used to be excluded as malformed)', () => {
    const e = new SimEngine(
      lay(
        [
          ps(5),
          { id: 'R1', type: 'resistor', holes: ['1:a10', '1:a20'], params: { resistance: 10_000 } },
          { id: 'R2', type: 'resistor', holes: ['1:b20', '1:top-3'], params: { resistance: 10_000 } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', '1:c10'), w('top-1', '1:top-0')],
        { boardRows: 2 },
      ),
    )
    e.step()
    expect(e.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(e.netVoltage('1:c20')).toBeCloseTo(2.5, 4) // GMIN (1 nS/node) costs ~14 µV
    expect(e.telemetry().components.R1.current).toBeCloseTo(2.5e-4, 8)
  })
})

// --------------------------------------------------------- node access

describe('coordinator hooks: chipOf / nodeOf / pinNodesOf / nodeVoltages / sample', () => {
  const divider = () =>
    new SimEngine(
      lay(
        [
          ps(5),
          { id: 'R1', type: 'resistor', holes: ['a10', 'a20'], params: { resistance: 1000 } },
          { id: 'R2', type: 'resistor', holes: ['b20', 'top-3'], params: { resistance: 3000 } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b10')],
      ),
    )

  it('maps refs and pins to solver nodes and samples without allocation', () => {
    const e = divider()
    e.step()
    const mid = e.nodeOf('c20')
    expect(mid).toBeGreaterThanOrEqual(0)
    expect(e.nodeOf('top-5')).toBe(GROUND_NODE)
    expect(e.nodeOf('zz99')).toBe(NO_NODE)
    expect(e.nodeOf('PS1:+')).toBe(e.nodeOf('top+7'))
    const pins = e.pinNodesOf('R2')!
    expect(Array.from(pins)).toEqual([mid, GROUND_NODE])
    expect(e.pinNodesOf('nope')).toBeNull()
    expect(e.nodeVoltages[mid]).toBeCloseTo(3.75, 4)
    expect(e.nodeCount).toBe(e.nodeVoltages.length)
    const nodes = Int32Array.from([mid, GROUND_NODE, NO_NODE, e.nodeOf('a10')])
    const out = new Float64Array(4)
    e.sample(nodes, out)
    expect(out[0]).toBe(e.netVoltage('a20'))
    expect(out[1]).toBe(0)
    expect(Number.isNaN(out[2])).toBe(true)
    expect(out[3]).toBeCloseTo(5, 3)
    expect(e.netIdOfNode(mid)).toBe('S20T')
    expect(e.chipOf('R1')).toBeNull()
  })

  it('diagnostic steps report node conductance and leave the solution bit-identical', () => {
    const e = divider()
    e.armDiagnostics()
    e.step()
    expect(e.nodeConductance(e.nodeOf('a20'))).toBeCloseTo(1 / 1000 + 1 / 3000, 12)
    // nonlinear circuit: one engine diagnosed every step, one never
    const [, raw] = LEGACY_EXAMPLES[0]
    const a = new SimEngine(loadExample(raw))
    const b = new SimEngine(loadExample(raw))
    for (let i = 0; i < 3000; i++) {
      a.armDiagnostics()
      a.step()
      b.step()
    }
    expect(Array.from(a.nodeVoltages)).toEqual(Array.from(b.nodeVoltages))
  })
})

// ------------------------------------------------- chip ctx extensions

describe('ChipStepCtx / ChipInstance extensions', () => {
  function chipWorld(inVolts: number) {
    return new SimEngine(
      lay(
        [
          ps(5),
          { id: 'X1', type: 'test_ext_chip', holes: ['a30', 'a31', 'a32', 'a33', 'a34'] },
          { id: 'RL', type: 'resistor', holes: ['b32', 'top-4'], params: { resistance: 100 } },
          { id: 'RS', type: 'resistor', holes: ['b33', 'top-5'], params: { resistance: 1000 } },
          { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1, amplitude: 0, offset: inVolts } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b30'), w('top-1', 'b31'), w('FG1:out', 'b34'), w('FG1:gnd', 'top-2')],
      ),
    )
  }

  it('index API reads like readPin; stage drive draws from the chip VCC net (KCL)', () => {
    const e = chipWorld(2.5)
    e.step()
    e.step()
    const c = chips.get('X1')!
    expect(c.seen.readAt).toBe(c.seen.readByName)
    expect(c.seen.readAt).toBeCloseTo(2.5, 4)
    // OUT: 100 Ω stage to VCC into 100 Ω load → VCC/2
    expect(e.netVoltage('c32')).toBeCloseTo(5 / 2, 3)
    // supply current = stage current (25 mA) — it flows from the VCC net
    const psI = e.telemetry().components.PS1.current!
    expect(psI).toBeCloseTo(0.025, 4)
    expect(e.chipOf('X1')).toBe(c)
  })

  it('drivePinAt: Norton to ground; rout <= 0 releases', () => {
    const e = chipWorld(0)
    e.step()
    expect(e.netVoltage('c33')).toBeCloseTo(0, 9) // released
    e.setRuntimeParam('X1', 'p', 1)
    e.step()
    e.step()
    expect(e.netVoltage('c33')).toBeCloseTo(0.5, 6) // 1 V / 1 kΩ into 1 kΩ
  })

  it('setRuntimeParam falls back to the chip; fillTelemetry and reportIssue land', () => {
    const e = chipWorld(4.5)
    e.setRuntimeParam('X1', 'p', 7)
    e.step()
    e.step()
    expect(e.telemetry().components.X1.values).toEqual({ param: 7 })
    expect(e.issues).toContainEqual({ level: 'warning', message: 'X1: IN above 4 V', componentId: 'X1' })
  })
})

// --------------------------------------------------------- sub-circuits

describe('CatalogEntry.subcircuit', () => {
  it('instantiates elements with private @nodes, reports telemetry under sub, applies LED burn checks', () => {
    const e = new SimEngine(
      lay([ps(5), { id: 'S1', type: 'test_sub', holes: ['a40', 'top-6'] }], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b40')]),
    )
    const nets = e.nodeCount
    expect(nets).toBeGreaterThanOrEqual(2) // the @m node is an extra solver node
    // honesty F11: an LED above its 150 mA peak rating burns within a millisecond and is then OPEN —
    // read the current before the burn, the burn after it
    e.advance(0.0005)
    const before = e.telemetry().components.S1.sub!
    expect(Object.keys(before).sort()).toEqual(['L', 'R'])
    expect(before.L.current!).toBeGreaterThan(0.1) // 5 V into a red LED + 10 Ω
    expect(before.R.current).toBeCloseTo(before.L.current!, 6)
    expect(before.L.burned).toBe(false)
    e.advance(0.0025)
    const sub = e.telemetry().components.S1.sub!
    expect(sub.L.pinVoltages.A).toBeCloseTo(5, 2)
    expect(sub.R.current).toBeCloseTo(sub.L.current!, 6)
    expect(Math.abs(sub.L.current!)).toBeLessThan(1e-6) // burned open
    expect(sub.L.burned).toBe(true)
    const burn = e.issues.find((i) => i.message.startsWith('LED S1.L burned out'))
    expect(burn?.componentId).toBe('S1') // attributed to the parent part
    // internal nodes never appear as nets
    expect(Object.keys(e.telemetry().netVoltages).some((n) => n.includes('@'))).toBe(false)
  })

  it('the Blue Pill board works electrically on a plain engine (regulator + power LED)', () => {
    const e = new SimEngine(
      lay([ps(5), { id: 'U1', type: 'stm32_bluepill', at: 'h10' }], [w('PS1:+', 'j27'), w('PS1:-', 'top-0'), w('j28', 'top-1')]),
    )
    e.advance(0.001)
    const u1 = e.telemetry().components.U1
    expect(u1.pinVoltages['3V3_1']).toBeCloseTo(3.3, 3)
    expect(u1.sub!.LED_PWR.ledBrightness).toBeGreaterThan(0.1)
    expect(u1.mcu?.state).toBe('no-firmware')
    expect(e.issues.map((i) => i.message)).toContain('U1: no firmware loaded — board simulated electrically only')
    expect(e.issues.some((i) => i.level === 'error')).toBe(false)
  })
})

// ------------------------------------------------------- device registry

describe('device registry', () => {
  it('createDevice falls back to registered models; built-ins keep precedence', () => {
    expect(registeredDevices()).toContain('test-isrc')
    const e = new SimEngine(
      lay(
        [
          ps(5),
          { id: 'I1', type: 'test_isrc', holes: ['a50'], params: { amps: 0.002 } },
          { id: 'R1', type: 'resistor', holes: ['b50', 'top-7'], params: { resistance: 1000 } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0')],
      ),
    )
    e.step()
    expect(e.netVoltage('c50')).toBeCloseTo(2, 5) // 2 mA into 1 kΩ
    registerDevice('resistor', () => {
      throw new Error('built-in must win')
    })
    const r = createDevice('resistor', { id: 'R', type: 'resistor' }, CATALOG.resistor, [0, -1])
    expect(r).not.toBeNull()
    expect(createDevice('no-such-model', { id: 'Z', type: 'z' }, CATALOG.resistor, [0])).toBeNull()
  })
})

// -------------------------------------------------- strict convergence

describe('opt-in strict Newton convergence', () => {
  /** 0 → 3.3 V step into 330 Ω + red LED, solved with a 1 µs step. */
  function anodeAfterEdge(strict: boolean): number {
    const e = new SimEngine(
      lay(
        [
          ps(5),
          { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1, amplitude: 0, offset: 0 } },
          { id: 'R1', type: 'resistor', holes: ['a10', 'a20'], params: { resistance: 330 } },
          { id: 'D1', type: 'led', holes: ['b20', 'top-3'], params: { color: 'red' } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('FG1:out', 'b10'), w('FG1:gnd', 'top-1')],
      ),
    )
    e.strictConvergence = strict
    e.step()
    e.setRuntimeParam('FG1', 'offset', 3.3)
    e.step(1e-6)
    return e.netVoltage('c20')
  }

  it('is off by default (legacy behavior kept) and fixes the post-edge junction solve when on', () => {
    expect(new SimEngine(lay([], [])).strictConvergence).toBe(false)
    const legacy = anodeAfterEdge(false)
    const strict = anodeAfterEdge(true)
    expect(strict).toBeGreaterThan(1.6)
    expect(strict).toBeLessThan(1.9) // a conducting red LED
    expect(legacy).toBeGreaterThan(strict) // the legacy loop stops while the junction is still limited
  })
})

// ------------------------------------------------------------------ LDO

describe("'ldo' device model", () => {
  function ldo(vin: number, load: ComponentInstance[], wires: ReturnType<typeof w>[] = []) {
    const e = new SimEngine(
      lay(
        [
          ps(vin),
          { id: 'REG', type: 'test_ldo', holes: ['a20', 'a22', 'top-4'], params: { vout: 3.3, dropout: 0.25, rout: 0.05, ilimit: 0.3 } },
          ...load,
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b20'), ...wires],
      ),
    )
    return e
  }
  const load = (ohms: number): ComponentInstance => ({ id: 'RL', type: 'resistor', holes: ['b22', 'top-5'], params: { resistance: ohms } })

  it('regulates 5 V → 3.3 V under load; the input draws the output current', () => {
    const e = ldo(5, [load(100)])
    e.advance(0.0005)
    expect(e.netVoltage('c22')).toBeCloseTo(3.3, 2)
    const t = e.telemetry().components
    expect(t.REG.current).toBeCloseTo(0.033, 3)
    expect(t.PS1.current).toBeCloseTo(t.REG.current!, 6)
    expect(t.REG.values!.limiting).toBe(0)
    expect(e.issues.some((i) => i.message.includes('converge'))).toBe(false)
  })

  it('drops out to vin − dropout when the input is too low', () => {
    const e = ldo(3.4, [load(1000)])
    e.advance(0.0005)
    expect(e.netVoltage('c22')).toBeCloseTo(3.15, 2)
  })

  it('current-limits a short at ilimit within a few steps', () => {
    const e = ldo(5, [load(1)])
    for (let i = 0; i < 10; i++) e.step()
    const reg = e.telemetry().components.REG
    expect(reg.current).toBeCloseTo(0.3, 3)
    expect(e.netVoltage('c22')).toBeCloseTo(0.3, 2)
    expect(reg.values!.limiting).toBe(1)
  })

  it('never sinks: an output back-driven above vout turns it off', () => {
    const e = ldo(
      5,
      [{ id: 'PS2', type: 'power_supply', params: { voltage: 4 } }, { id: 'RB', type: 'resistor', holes: ['c22', 'a30'], params: { resistance: 10 } }],
      [w('PS2:+', 'b30'), w('PS2:-', 'top-6')],
    )
    e.advance(0.0005)
    const reg = e.telemetry().components.REG
    expect(reg.current!).toBeGreaterThanOrEqual(0)
    expect(reg.current!).toBeLessThan(1e-4)
    expect(e.netVoltage('c22')).toBeCloseTo(4, 3)
  })

  it('releases the output when the input collapses', () => {
    const e = ldo(0.5, [load(1000)])
    e.advance(0.0005)
    expect(Math.abs(e.netVoltage('c22'))).toBeLessThan(0.01)
    expect(Math.abs(e.telemetry().components.REG.current!)).toBeLessThan(1e-5)
  })

  it('cold-starts the Blue Pill board without a convergence warning', () => {
    const e = new SimEngine(
      lay([ps(5), { id: 'U1', type: 'stm32_bluepill', at: 'h10' }], [w('PS1:+', 'j27'), w('PS1:-', 'top-0'), w('j28', 'top-1')]),
    )
    e.step(DEFAULT_DT)
    expect(e.telemetry().components.U1.pinVoltages['3V3_1']).toBeCloseTo(3.3, 3)
    expect(e.issues.some((i) => i.message.includes('converge'))).toBe(false)
  })
})
