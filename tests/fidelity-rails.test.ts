/**
 * Module output-high rails (DigitalSpec.outputRail): a module whose chip runs
 * from an on-board regulator drives its logic outputs between GND and that
 * regulator's output — not its VCC pin — in the analog solve, on
 * logic-resolvable nets and in the ERC.
 *
 *  - the HC-05 on a 5 V supply: TXD / STATE high ≈ 3.3 V on PA3 / PA0, no
 *    runtime over-voltage and no ERC error (the ERC used to take VCC = 5 V);
 *  - a TEST-ONLY module (inserted into CATALOG for this file) that drives
 *    push-pull 'high' and 'pull-up' with a declared '@v33' rail: the rail-
 *    stage drive reaches the internal LDO node on a logic net (exact), on an
 *    analog net (Norton at the rail's solved voltage) and for a pull-up; the
 *    same module WITHOUT the field still drives its VCC (legacy behaviour);
 *    a catalog-pin rail for every output / for some outputs;
 *  - every catalog module with an internal-LDO logic supply declares it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CATALOG, getEntry } from '../src/model/catalog'
import type { CatalogEntry } from '../src/model/catalog'
import type { CircuitLayout, ComponentInstance } from '../src/model/types'
import { outputRailNode, registerDigitalDevice } from '../src/sim/digital/api'
import type { DigitalDevice, DigitalDeviceCtx, DigitalOutputRail } from '../src/sim/digital/api'
import { DigitalDeviceChip, RAIL_INTERNAL, RAIL_SUPPLY } from '../src/sim/digital/device-chip'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { runErc } from '../src/sim/erc'
import { buildCircuit, outputRailNet, outputRailVoltage } from '../src/sim/erc/graph'
import '../src/mcu/all'
import { bluePill, summary, tap, valid, w } from './erc/helpers'

// ------------------------------------------------------------- test module

/** Drives OUT and AOUT push-pull high and PU with its weak pull-up, from init on. */
class DriveHigh implements DigitalDevice {
  init(ctx: DigitalDeviceCtx): void {
    ctx.drive('OUT', 'high')
    ctx.drive('AOUT', 'high')
    ctx.drive('PU', 'pull-up')
  }
}
registerDigitalDevice('fidelity-drive-high', () => new DriveHigh())

/** A 5-lead logic module (VCC GND OUT AOUT PU) + a lead V3 = its 3.3 V LDO output when `pinRail`. */
function testModule(type: string, rail?: DigitalOutputRail, pinRail = false): CatalogEntry {
  const ldoOut = pinRail ? 'V3' : '@v33'
  return {
    type,
    label: 'Fidelity test module',
    category: 'module',
    placement: 'leads',
    pins: pinRail ? ['VCC', 'GND', 'OUT', 'AOUT', 'PU', 'V3'] : ['VCC', 'GND', 'OUT', 'AOUT', 'PU'],
    sim: { kind: 'chip', model: 'digital-device' },
    digital: {
      model: 'fidelity-drive-high',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3,
      inputs: [],
      outputs: ['OUT', 'AOUT', 'PU'],
      ...(rail ? { outputRail: rail } : {}),
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [{ id: 'REG', model: 'ldo', pins: ['VCC', ldoOut, 'GND'], params: { vout: 3.3, dropout: 0.25, rout: 0.1, ilimit: 0.2 } }],
    doc: 'Test only.',
  }
}

const TEST_TYPES: CatalogEntry[] = [
  testModule('fid_ldo_rail', { node: '@v33' }),
  testModule('fid_plain'),
  testModule('fid_pin_rail_all', { node: 'V3' }, true),
  testModule('fid_pin_rail_out', { node: 'V3', pins: ['OUT'] }, true),
]

beforeAll(() => {
  for (const e of TEST_TYPES) CATALOG[e.type] = e
})
afterAll(() => {
  for (const e of TEST_TYPES) delete CATALOG[e.type]
})

let seq = 0
const wire = (from: string, to: string) => ({ id: `fw${++seq}`, from, to })

/**
 * The test module X1 on strips 40–44(/45) powered from a 5 V bench supply on
 * the top rails; OUT has a 10 kΩ pull-down (a logic net), AOUT a 100 nF
 * capacitor to GND (an analog net), PU nothing else (a logic net).
 */
function rig(type: string): CircuitLayout {
  const pins = getEntry(type)!.pins.length
  const holes = Array.from({ length: pins }, (_, i) => `a${40 + i}`)
  const comps: ComponentInstance[] = [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'X1', type, holes },
    { id: 'R1', type: 'resistor', holes: ['c42', 'top-42'], params: { resistance: 10_000 } },
    { id: 'C1', type: 'capacitor', holes: ['c43', 'top-43'], params: { capacitance: 100e-9 } },
  ]
  return {
    version: 1,
    name: 'output rail rig',
    components: comps,
    wires: [wire('PS1:+', 'top+0'), wire('PS1:-', 'top-0'), wire('b40', 'top+40'), wire('b41', 'top-41')],
  }
}

/** Analog (telemetry) and logic-layer voltages of X1's pins after 5 ms. */
function solve(type: string): { analog: Record<string, number>; logic: (pin: string) => number; co: SimulationCoordinator } {
  const co = new SimulationCoordinator()
  co.load(valid(rig(type)), 1)
  co.advance(5e-3)
  const analog = co.telemetry().components.X1.pinVoltages
  const entry = getEntry(type)!
  const nodes = co.engine!.pinNodesOf('X1')!
  const logic = (pin: string) => co.logicNets!.voltage(nodes[entry.pins.indexOf(pin)])
  return { analog, logic, co }
}

/** 5 V × 10 k / (10 k + 50 Ω) and 3.3 V × the same divider (push-pull 50 Ω against the 10 kΩ pull-down). */
const DIV = 10_000 / 10_050

describe('rail-stage drive to the module regulator (DigitalSpec.outputRail)', () => {
  it('an internal LDO rail: high = 3.3 V on a logic net, an analog net and for a pull-up, while VCC = 5 V', () => {
    const { analog, logic, co } = solve('fid_ldo_rail')
    expect(analog.VCC).toBeCloseTo(5, 2)
    // logic net (pull-down to a rail): exact resolution against the '@v33' node
    expect(logic('OUT')).toBeCloseTo(3.3 * DIV, 2)
    expect(analog.OUT).toBeCloseTo(3.3 * DIV, 2)
    // analog net (capacitor): the analog solve drives it to the rail
    expect(Number.isNaN(logic('AOUT'))).toBe(true) // not a logic net
    expect(analog.AOUT).toBeCloseTo(3.3, 2)
    // the weak pull-up goes to the chip's own VDD (the LDO), too
    expect(logic('PU')).toBeCloseTo(3.3, 2)
    expect(analog.PU).toBeCloseTo(3.3, 2)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })

  it('without the field a module drives its supply pin exactly as before', () => {
    const { analog, logic } = solve('fid_plain')
    expect(logic('OUT')).toBeCloseTo(5 * DIV, 2)
    expect(analog.OUT).toBeCloseTo(5 * DIV, 2)
    expect(analog.AOUT).toBeCloseTo(5, 2)
    expect(logic('PU')).toBeCloseTo(5, 2)
  })

  it('a catalog-pin rail: for every output it is the stage rail, for some outputs only those pins move', () => {
    const all = solve('fid_pin_rail_all')
    expect(all.analog.V3).toBeCloseTo(3.3, 2)
    expect(all.logic('OUT')).toBeCloseTo(3.3 * DIV, 2)
    expect(all.analog.AOUT).toBeCloseTo(3.3, 2)
    expect(all.analog.PU).toBeCloseTo(3.3, 2)
    const some = solve('fid_pin_rail_out')
    expect(some.logic('OUT')).toBeCloseTo(3.3 * DIV, 2)
    expect(some.analog.OUT).toBeCloseTo(3.3 * DIV, 2)
    expect(some.analog.AOUT).toBeCloseTo(5, 2)
    expect(some.logic('PU')).toBeCloseTo(5, 2)
  })

  it('the chip adapter resolves the rail per pin (catalog pin / internal node / supply)', () => {
    const chip = (type: string) => new DigitalDeviceChip({ id: 'X', type })
    const idx = (type: string, pin: string) => getEntry(type)!.pins.indexOf(pin)
    const ldo = chip('fid_ldo_rail')
    expect(ldo.railPin[idx('fid_ldo_rail', 'OUT')]).toBe(RAIL_INTERNAL)
    expect(ldo.railName[idx('fid_ldo_rail', 'OUT')]).toBe('@v33')
    expect(ldo.railPin[idx('fid_ldo_rail', 'VCC')]).toBe(RAIL_SUPPLY)
    const some = chip('fid_pin_rail_out')
    expect(some.railPin[idx('fid_pin_rail_out', 'OUT')]).toBe(idx('fid_pin_rail_out', 'V3'))
    expect(some.railPin[idx('fid_pin_rail_out', 'AOUT')]).toBe(RAIL_SUPPLY)
    expect([...chip('fid_plain').railPin].every((r) => r === RAIL_SUPPLY)).toBe(true)
    // real modules
    const mpu = chip('mpu6050_gy521')
    expect(mpu.railPin[idx('mpu6050_gy521', 'INT')]).toBe(RAIL_INTERNAL)
    expect(mpu.railName[idx('mpu6050_gy521', 'INT')]).toBe('@3v3')
    const tft = chip('ili9341')
    expect(tft.railName[idx('ili9341', 'SDO')]).toBe('@3v3')
  })

  it('the CH340 logic jumper selects its rail (5V / 3V3) through the same declaration', () => {
    const spec = getEntry('usb_uart_ch340')!.digital!
    expect(outputRailNode(spec, 'TXD', () => '3.3V')).toBe('3V3')
    expect(outputRailNode(spec, 'TXD', () => '5V')).toBe('5V')
    expect(outputRailNode(spec, 'TXD', () => 'bogus')).toBe('5V')
    // the idle (high) TXD level of the USB-powered adapter, its GND on the bench ground
    // (CH1 at a35: GND a35, 3V3 a36, 5V a37, TXD a38, RXD a39, DTR a40)
    for (const [logicLevel, v] of [
      ['3.3V', 3.3],
      ['5V', 5],
    ] as const) {
      const co = new SimulationCoordinator()
      co.load(
        valid({
          version: 1,
          name: 'ch340',
          components: [
            { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
            { id: 'CH1', type: 'usb_uart_ch340', at: 'a35', params: { logic: logicLevel } },
          ],
          wires: [wire('PS1:-', 'top-0'), wire('e35', 'top-35')],
        }),
        1,
      )
      co.advance(5e-3)
      expect(co.telemetry().components.CH1.pinVoltages.TXD).toBeCloseTo(v, 1)
    }
  })
})

// ------------------------------------------------------------------ HC-05

/** HC-05 standing in row e at col 40 (STATE e40, RXD e41, TXD e42, GND e43, VCC e44, EN e45) on the Blue Pill bench (top+ = 5 V). */
function hc05World(extra: ComponentInstance[] = [], wires: ReturnType<typeof w>[] = []): CircuitLayout {
  return valid(
    bluePill(
      [{ id: 'BT1', type: 'hc05_bt', at: 'e40' }, ...extra],
      [
        w('d43', 'top-43'), // GND
        w('a44', 'top+44'), // VCC = 5 V
        w('d42', tap('PA3')), // TXD → PA3 (not 5 V tolerant)
        w('d40', tap('PA0')), // STATE → PA0 (not 5 V tolerant)
        ...wires,
      ],
    ),
  )
}

describe('HC-05 on a 5 V supply: TXD / STATE are 3.3 V outputs', () => {
  it('the simulation: TXD high ≈ 3.3 V on PA3 while VCC = 5 V, no over-voltage on the board', () => {
    const co = new SimulationCoordinator()
    co.load(hc05World(), 1)
    co.advance(0.2)
    const t = co.telemetry()
    expect(t.components.BT1.pinVoltages.VCC).toBeCloseTo(5, 1)
    expect(t.components.BT1.pinVoltages.TXD).toBeGreaterThan(3.2)
    expect(t.components.BT1.pinVoltages.TXD).toBeLessThan(3.4)
    expect(t.components.U1.pinVoltages.PA3).toBeCloseTo(t.components.BT1.pinVoltages.TXD, 3)
    expect(co.issues().filter((i) => /exceeds|not 5 V tolerant/.test(i.message))).toEqual([])
  })

  it('the ERC: no over-voltage / logic-level error for TXD → PA3 or STATE → PA0', () => {
    const f = runErc(hc05World())
    const bad = f.filter((x) => (x.rule === 'logic-level' || x.rule === 'gpio-overvoltage') && x.componentIds.includes('BT1'))
    expect(bad, summary(f)).toEqual([])
    // the high level the ERC uses IS the module regulator: 3.3 V, not VCC
    const c = buildCircuit(hc05World())
    const bt = c.byId.get('BT1')!
    expect(outputRailNet(bt, 'TXD')).toBe('@BT1@v33')
    expect(outputRailVoltage(c, bt, 'TXD')).toBeCloseTo(3.3, 3)
    expect(outputRailVoltage(c, bt, 'STATE')).toBeCloseTo(3.3, 3)
    expect(outputRailNet(bt, 'VCC')).toBeUndefined()
  })

  it('the ERC still flags a 5 V output on a non-tolerant pin (a module without a declared rail)', () => {
    const l = valid(
      bluePill(
        [{ id: 'X1', type: 'fid_plain', holes: ['a40', 'a41', 'a42', 'a43', 'a44'] }],
        [w('b40', 'top+40'), w('b41', 'top-41'), w('b42', tap('PA3'))],
      ),
    )
    const f = runErc(l).filter((x) => x.rule === 'logic-level' && x.componentIds.includes('X1'))
    expect(f.map((x) => x.level), summary(f)).toEqual(['error'])
    expect(f[0].message).toMatch(/PA3 is not 5 V tolerant .* driven to 5\.00 V by X1 OUT \(an output powered at 5\.00 V\)/)
    // the same module with its LDO declared as the rail: 3.3 V, no finding
    const ok = valid(
      bluePill(
        [{ id: 'X1', type: 'fid_ldo_rail', holes: ['a40', 'a41', 'a42', 'a43', 'a44'] }],
        [w('b40', 'top+40'), w('b41', 'top-41'), w('b42', tap('PA3'))],
      ),
    )
    const g = runErc(ok).filter((x) => (x.rule === 'logic-level' || x.rule === 'gpio-overvoltage') && x.componentIds.includes('X1'))
    expect(g, summary(g)).toEqual([])
  })

  it('an unpowered module regulator gives no output level at all (no guess)', () => {
    // VCC not wired: the '@v33' rail has no voltage → no high source is assumed
    const l = valid(bluePill([{ id: 'BT1', type: 'hc05_bt', at: 'e40' }], [w('d43', 'top-43'), w('d42', tap('PA3'))]))
    const c = buildCircuit(l)
    expect(Number.isNaN(outputRailVoltage(c, c.byId.get('BT1')!, 'TXD')!)).toBe(true)
    const f = runErc(l).filter((x) => x.rule === 'logic-level' && x.componentIds.includes('BT1'))
    expect(f).toEqual([])
  })
})

// ------------------------------------------------------- catalog coverage

describe('every module whose logic runs from an internal on-board regulator declares it', () => {
  it('outputRail names that LDO output for each such module with outputs', () => {
    const missing: string[] = []
    for (const [type, e] of Object.entries(CATALOG)) {
      const d = e.digital
      if (!d || d.outputs.length === 0 || type.startsWith('fid_')) continue
      const ldo = (e.subcircuit ?? []).find((s) => s.model === 'ldo' && s.pins[1]?.startsWith('@'))
      if (!ldo) continue
      if (d.outputRail?.node !== ldo.pins[1]) missing.push(`${type}: outputRail ${d.outputRail?.node ?? '(none)'} ≠ ${ldo.pins[1]}`)
    }
    expect(missing).toEqual([])
  })

  it('every declared rail names a real node and only listed outputs', () => {
    const bad: string[] = []
    for (const [type, e] of Object.entries(CATALOG)) {
      const r = e.digital?.outputRail
      if (!r || type.startsWith('fid_')) continue
      const internal = new Set((e.subcircuit ?? []).flatMap((s) => s.pins.filter((p) => p.startsWith('@'))))
      const nodes = [r.node, ...Object.values(r.select?.nodes ?? {})]
      for (const n of nodes) if (!e.pins.includes(n) && !internal.has(n)) bad.push(`${type}: ${n}`)
      for (const p of r.pins ?? []) if (!e.digital!.outputs.includes(p)) bad.push(`${type}: pin ${p} is not an output`)
    }
    expect(bad).toEqual([])
    // the affected modules of the audit
    const declared = Object.entries(CATALOG)
      .filter(([type, e]) => e.digital?.outputRail && !type.startsWith('fid_'))
      .map(([type]) => type)
      .sort()
    expect(declared).toEqual(['bh1750', 'hc05_bt', 'ili9341', 'mpu6050_gy521', 'sd_card_spi', 'sh1106_i2c', 'ssd1306_i2c', 'usb_uart_ch340'])
  })
})

