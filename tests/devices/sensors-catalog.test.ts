/**
 * Sensors family catalog (src/model/parts/sensors.parts.ts): every entry is
 * placeable as documented, honest about its support level, documents every
 * pin, has a registered model, lands every header pin on its own strip
 * (rotations that would short them are refused), keeps the header strips
 * wireable beside the module body, and passes the layout validator; the
 * analog modules (joystick potentiometers, ACS712, divider) behave as their
 * support text claims in the real SimEngine.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole, netIdForHole } from '../../src/model/breadboard'
import { occludedHoles } from '../../src/model/occlusion'
import { validateLayout } from '../../src/model/validate'
import { registeredDigitalDevices } from '../../src/sim/digital/api'
import { createDevice, registeredDevices } from '../../src/sim/devices'
import { SimEngine } from '../../src/sim/engine'
import { ACS712_SENS } from '../../src/sim/models/sensors.model'

export const SENSOR_TYPES = [
  'mpu6050_gy521',
  'bmp280',
  'bme280',
  'bh1750',
  'dht11',
  'dht22',
  'ds18b20',
  'hcsr04',
  'ky040_encoder',
  'joystick_xy',
  'hall_a3144',
  'acs712_5a',
  'voltage_sensor',
  'ir_receiver_vs1838b',
]

function place(type: string): ComponentInstance {
  const e = getEntry(type)!
  if (e.placement === 'footprint') return { id: 'S1', type, at: 'f40' }
  return { id: 'S1', type, holes: e.pins.map((_, i) => `f${40 + i}`) }
}

describe('sensor catalog entries', () => {
  it('exist, are sensors with honest support, full pin docs, specs, tags and a usable doc', () => {
    for (const t of SENSOR_TYPES) {
      const e = CATALOG[t]
      expect(e, t).toBeDefined()
      expect(e.category, t).toBe('sensor')
      expect(['full', 'partial'], t).toContain(e.support?.level)
      expect(e.support!.simulated!.length, t).toBeGreaterThan(0)
      expect(e.support!.limits!.length, t).toBeGreaterThan(0)
      expect(e.pinInfo!.map((p) => p.pin), t).toEqual(e.pins)
      expect(e.meta?.partNumber, t).toBeTruthy()
      expect(e.meta?.sizeMm?.length, t).toBe(3)
      expect(e.meta!.specs!.length, t).toBeGreaterThan(0)
      expect(e.meta!.tags!.length, t).toBeGreaterThan(3)
      expect(e.doc.length, t).toBeGreaterThan(120)
      // every environment input is editable while running
      for (const p of e.params ?? []) if (p.key !== 'turnRate') expect(p.runtime, `${t}.${p.key}`).toBe(true)
    }
  })

  it('every model is registered; digital specs only name real pins (bidirectional pins in both lists)', () => {
    const digital = new Set(registeredDigitalDevices())
    const analog = new Set(registeredDevices())
    for (const t of SENSOR_TYPES) {
      const e = CATALOG[t]
      if (e.digital) {
        expect(e.sim, t).toEqual({ kind: 'chip', model: 'digital-device' })
        expect(digital.has(e.digital.model), t).toBe(true)
        for (const p of [...e.digital.inputs, ...e.digital.outputs, e.digital.supplyPin, e.digital.groundPin]) expect(e.pins, `${t}.${p}`).toContain(p)
      } else {
        expect(e.sim.kind, t).toBe('device')
        expect(analog.has((e.sim as { model: string }).model), t).toBe(true)
      }
      for (const el of e.subcircuit ?? []) {
        for (const p of el.pins) if (!p.startsWith('@')) expect(e.pins, `${t}.${el.id}`).toContain(p)
        const dev = createDevice(el.model, { id: 'x', type: el.model, params: el.params }, e, el.pins.map(() => -1))
        expect(dev, `${t}.${el.id} (${el.model})`).not.toBeNull()
      }
    }
    for (const [t, sda] of [
      ['mpu6050_gy521', 'SDA'],
      ['bme280', 'SDA'],
      ['bh1750', 'SDA'],
      ['ds18b20', 'DQ'],
      ['dht22', 'DATA'],
    ]) {
      expect(CATALOG[t].digital!.inputs).toContain(sda)
      expect(CATALOG[t].digital!.outputs).toContain(sda)
    }
  })

  it('real pinouts (module silkscreens / datasheets)', () => {
    expect(CATALOG.mpu6050_gy521.pins).toEqual(['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'])
    expect(CATALOG.bme280.pins).toEqual(['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'])
    expect(CATALOG.bh1750.pins).toEqual(['VCC', 'GND', 'SCL', 'SDA', 'ADDR'])
    expect(CATALOG.ds18b20.pins).toEqual(['GND', 'DQ', 'VDD'])
    expect(CATALOG.hcsr04.pins).toEqual(['VCC', 'TRIG', 'ECHO', 'GND'])
    expect(CATALOG.ky040_encoder.pins).toEqual(['CLK', 'DT', 'SW', 'VCC', 'GND'])
    expect(CATALOG.joystick_xy.pins).toEqual(['GND', 'VCC', 'VRX', 'VRY', 'SW'])
    expect(CATALOG.hall_a3144.pins).toEqual(['VCC', 'GND', 'OUT'])
    expect(CATALOG.ir_receiver_vs1838b.pins).toEqual(['OUT', 'GND', 'VCC'])
  })

  it('module headers: every pin on its own strip, only 0 / 180 rotations, header strips keep free holes', () => {
    for (const t of SENSOR_TYPES) {
      const e = CATALOG[t]
      if (e.placement !== 'footprint') continue
      expect(e.allowedRotations, t).toEqual([0, 180])
      for (const rotation of [0, 180] as const) {
        const comp: ComponentInstance = { id: 'S1', type: t, at: rotation === 0 ? 'f40' : 'e44', rotation }
        const holes = componentPinHoles(comp, e)!
        expect(holes, `${t} @${rotation}`).not.toBeNull()
        const nets = holes.map((h) => netIdForHole(h!))
        expect(new Set(nets).size, `${t} @${rotation}: pins share a strip`).toBe(nets.length)
        // each pin's strip has at least one hole the body does not cover
        const covered = occludedHoles(comp, e)
        for (const h of holes) {
          const strip = h!.kind === 'strip' ? h! : null
          if (!strip) continue
          const rows = (['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const).filter((r) => (strip.row <= 'e' ? r <= 'e' : r >= 'f'))
          const free = rows.map((r) => formatHole({ ...strip, row: r })).filter((ref) => ref !== formatHole(strip) && !covered.has(ref))
          expect(free.length, `${t} @${rotation} ${formatHole(strip)}`).toBeGreaterThan(0)
        }
      }
      // 90° would fold the single-row header into one strip column: refused
      const v = validateLayout({ version: 1, components: [{ id: 'S1', type: t, at: 'f40', rotation: 90 }], wires: [] })
      expect(v.errors.length, `${t} rotation 90`).toBeGreaterThan(0)
    }
  })

  it('every part places validly on the standard board', () => {
    for (const t of SENSOR_TYPES) {
      const layout: CircuitLayout = { version: 1, components: [{ id: 'PS1', type: 'power_supply' }, place(t)], wires: [] }
      const v = validateLayout(layout)
      expect(v.errors, t).toEqual([])
    }
  })
})

// ------------------------------------------------------------------ analog modules in SimEngine

let wseq = 0
const w = (from: string, to: string): Wire => ({ id: `w${++wseq}`, from, to })

function solve(layout: CircuitLayout, steps = 40): SimEngine {
  expect(validateLayout(layout).errors).toEqual([])
  const e = new SimEngine(layout)
  for (let i = 0; i < steps; i++) e.step(50e-6)
  return e
}
const pinV = (e: SimEngine, id: string, pin: string) => e.telemetry().components[id].pinVoltages[pin]

describe('analog sensor modules', () => {
  it('KY-023: wipers at 0.5 + pos/200 of the supply, SW to GND while pressed', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 3.3 } },
        { id: 'JS', type: 'joystick_xy', at: 'f40', params: { x: 40, y: -100 } },
        { id: 'R1', type: 'resistor', holes: ['j44', 'top+3'], params: { resistance: 10000 } },
      ],
      wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('j40', 'top-1'), w('j41', 'top+1')],
    }
    const e = solve(layout)
    expect(pinV(e, 'JS', 'VRX')).toBeCloseTo(3.3 * 0.7, 3)
    expect(pinV(e, 'JS', 'VRY')).toBeCloseTo(0, 3)
    expect(pinV(e, 'JS', 'SW')).toBeCloseTo(3.3, 3)
    e.setRuntimeParam('JS', 'pressed', true)
    e.setRuntimeParam('JS', 'y', 100)
    e.step(50e-6)
    expect(pinV(e, 'JS', 'SW')).toBeLessThan(0.01)
    expect(pinV(e, 'JS', 'VRY')).toBeCloseTo(3.3, 3)
  })

  it('ACS712: 1.2 mΩ in the loop, OUT = VCC/2 + 185 mV/A (ratiometric), warns outside 4.5–5.5 V and above 5 A', () => {
    const mk = (vcc: number, vload: number): CircuitLayout => ({
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: vcc } },
        { id: 'PS2', type: 'power_supply', params: { voltage: vload } },
        { id: 'CS', type: 'acs712_5a', at: 'f40' },
        { id: 'RL', type: 'resistor', holes: ['i44', 'i47'], params: { resistance: 2 } },
      ],
      wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('j40', 'top+1'), w('j42', 'top-1'), w('PS2:+', 'j38'), w('PS2:-', 'j47'), w('PS2:-', 'top-2')],
    })
    let e = solve(mk(5, 4))
    const i = e.telemetry().components.CS.values!.current
    expect(i).toBeCloseTo(4 / (2 + 0.0012 + 0.01), 2) // load + primary + bench supply 10 mΩ
    expect(pinV(e, 'CS', 'OUT')).toBeCloseTo(2.5 + ACS712_SENS * i, 3)
    expect(e.issues.filter((x) => /ACS712/.test(x.message))).toEqual([])
    e = solve(mk(4, 12))
    expect(pinV(e, 'CS', 'OUT')).toBeCloseTo(4 * (0.5 + (ACS712_SENS / 5) * e.telemetry().components.CS.values!.current), 3)
    const msgs = e.issues.map((x) => x.message)
    expect(msgs.some((m) => /CS: ACS712 supply 4\.00 V is outside 4\.5–5\.5 V/.test(m)), JSON.stringify(msgs)).toBe(true)
    expect(msgs.some((m) => /CS: ACS712 current 5\.97 A exceeds its ±5 A range/.test(m)), JSON.stringify(msgs)).toBe(true)
  })

  it('voltage sensor: S = VIN / 5 through 30 kΩ / 7.5 kΩ', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 20 } },
        { id: 'VS', type: 'voltage_sensor', at: 'f40' },
      ],
      wires: [w('PS1:+', 'j38'), w('PS1:-', 'j44')],
    }
    const e = solve(layout, 4)
    expect(pinV(e, 'VS', 'S')).toBeCloseTo(4, 4)
  })
})
