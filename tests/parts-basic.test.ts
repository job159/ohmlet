/**
 * Basic-parts family (src/model/parts/basic.parts.ts + src/sim/models/
 * basic.model.ts): catalog integrity and the electrical behavior every
 * support annotation claims — RGB channel currents, P-MOSFET / IRLZ44N
 * switching, zener clamp, regulator output / dropout / limit / Iq, battery
 * sag, current-source compliance, relay pick-up / drop-out timing and the
 * flyback warning, PC817 CTR + isolation, NTC B equation, BSS138 level
 * shifting in both directions, toggle switch and the visual-only crystal.
 *
 * Every circuit is a VALID layout (validateLayout) on the standard board,
 * solved by the real SimEngine.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../src/sim/engine'
import { CATALOG, getEntry } from '../src/model/catalog'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, Wire } from '../src/model/types'
import { validateLayout } from '../src/model/validate'
import { componentPinHoles, formatHole } from '../src/model/breadboard'
import { occludedHoles } from '../src/model/occlusion'
import { createDevice, registeredDevices } from '../src/sim/devices'
import { registeredChips } from '../src/sim/chip-api'
import {
  RELAY_I_DROPOUT,
  RELAY_I_PICKUP,
  RELAY_L,
  RELAY_R,
  RELAY_T_GAP,
  RELAY_T_OPERATE,
  RELAY_T_RELEASE,
  RGB_VF,
  ISRC_G_OUT,
  optoOutput,
} from '../src/sim/models/basic.model'

const ISRC_R_SHUNT = 1 / ISRC_G_OUT

const BASIC_TYPES = [
  'rgb_led',
  'pmos',
  'irlz44n',
  'zener',
  'pc817',
  'lm7805',
  'ams1117_33',
  'battery_9v',
  'battery_aa2',
  'current_source',
  'relay_5v',
  'toggle_switch',
  'ntc_10k',
  'crystal_hc49',
  'level_shifter_4ch',
]

// ------------------------------------------------------------------ helpers

let wseq = 0
const w = (from: string, to: string): Wire => ({ id: `w${++wseq}`, from, to })
const psu = (v = 5, id = 'PS1'): ComponentInstance => ({ id, type: 'power_supply', params: { voltage: v } })
const res = (id: string, a: string, b: string, ohms: number): ComponentInstance => ({
  id,
  type: 'resistor',
  holes: [a, b],
  params: { resistance: ohms },
})

/** Layout powered by PS1 on the top rails (+ → top+0, − → top-0, bot rails joined). */
function powered(components: ComponentInstance[], wires: Wire[], volts = 5): CircuitLayout {
  return {
    version: 1,
    components: [psu(volts), ...components],
    wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top-49', 'bot-49'), ...wires],
  }
}

function engineOf(layout: CircuitLayout): SimEngine {
  const v = validateLayout(layout)
  expect(v.errors, 'layout must be valid').toEqual([])
  return new SimEngine(layout)
}

const tele = (e: SimEngine, id: string): ComponentTelemetry => e.telemetry().components[id]
const pinV = (e: SimEngine, id: string, pin: string): number => tele(e, id).pinVoltages[pin]
const errorsOf = (e: SimEngine) => e.issues.filter((i) => /converge|singular|numerical/.test(i.message))

// ------------------------------------------------------------------ catalog

describe('catalog entries', () => {
  it('every basic part exists with an honest support annotation and pin docs', () => {
    for (const t of BASIC_TYPES) {
      const e = CATALOG[t]
      expect(e, t).toBeDefined()
      expect(e.support, t).toBeDefined()
      expect(['full', 'partial', 'visual'], t).toContain(e.support!.level)
      expect(e.support!.simulated?.length ?? 0, `${t} simulated`).toBeGreaterThan(0)
      expect(e.support!.limits?.length ?? 0, `${t} limits`).toBeGreaterThan(0)
      expect(e.doc.length, `${t} doc`).toBeGreaterThan(40)
      // pinInfo documents every pin, in catalog order
      expect(e.pinInfo?.map((p) => p.pin), `${t} pinInfo`).toEqual(e.pins)
      expect(e.meta?.tags?.length ?? 0, `${t} tags`).toBeGreaterThan(0)
    }
  })

  it('every simulated part has a registered model; the crystal is visual-only', () => {
    const devices = new Set(registeredDevices())
    for (const t of BASIC_TYPES) {
      const e = CATALOG[t]
      if (e.sim.kind === 'device') {
        const known = ['slide_switch'].includes(e.sim.model) || devices.has(e.sim.model)
        expect(known, `${t} → ${e.sim.model}`).toBe(true)
      } else if (e.sim.kind === 'chip') {
        expect(registeredChips(), t).toContain(e.sim.model)
      }
      for (const el of e.subcircuit ?? []) {
        const dev = createDevice(el.model, { id: 'x', type: el.model, params: el.params }, e, el.pins.map(() => -1))
        expect(dev, `${t}.${el.id} (${el.model})`).not.toBeNull()
      }
    }
    expect(CATALOG.crystal_hc49.support!.level).toBe('visual')
    expect(CATALOG.crystal_hc49.sim.kind).toBe('probe') // no electrical stamp
  })

  it('real pinouts: TO-220 orders, RGB lead order, PC817 DIP-4, level-shifter channel pairs', () => {
    expect(CATALOG.irlz44n.pins).toEqual(['gate', 'drain', 'source'])
    expect(CATALOG.lm7805.pins).toEqual(['IN', 'GND', 'OUT'])
    expect(CATALOG.rgb_led.pins).toEqual(['R', 'COM', 'G', 'B'])
    expect(CATALOG.pc817.pins).toEqual(['anode', 'cathode', 'emitter', 'collector'])
    // LVn sits directly opposite HVn (same column, rows g / d)
    const comp: ComponentInstance = { id: 'U1', type: 'level_shifter_4ch', at: 'g30' }
    const entry = getEntry('level_shifter_4ch')!
    const holes = componentPinHoles(comp, entry)!.map((h) => formatHole(h!))
    const at = (pin: string) => holes[entry.pins.indexOf(pin)]
    for (const n of ['1', '2', '3', '4', '']) {
      expect(at(`LV${n}`).slice(1), n).toBe(at(`HV${n}`).slice(1))
      expect(at(`LV${n}`)[0]).toBe('g')
      expect(at(`HV${n}`)[0]).toBe('d')
    }
    expect(at('GND').slice(1)).toBe(at('GND2').slice(1))
  })

  it('footprint bodies occlude exactly the holes under them', () => {
    const relay = occludedHoles({ id: 'K1', type: 'relay_5v', at: 'd20' }, CATALOG.relay_5v)
    // 7 columns (19..25) × rows c–h minus the 5 pin holes
    expect(relay.size).toBe(7 * 6 - 5)
    expect(relay.has('f20')).toBe(true)
    expect(relay.has('c20')).toBe(true)
    expect(relay.has('b20')).toBe(false)
    expect(relay.has('d26')).toBe(false)
    const ls = occludedHoles({ id: 'U1', type: 'level_shifter_4ch', at: 'g30' }, CATALOG.level_shifter_4ch)
    expect(ls.size).toBe(6 * 2) // rows e/f under the board, 6 columns
    expect(ls.has('e30') && ls.has('f35')).toBe(true)
  })
})

// ------------------------------------------------------------------ RGB LED

describe('rgb_led', () => {
  const rgbLayout = (common: 'cathode' | 'anode', ohms: [number, number, number]) => {
    const led: ComponentInstance = { id: 'D1', type: 'rgb_led', holes: ['a10', 'a11', 'a12', 'a13'], params: { common } }
    if (common === 'cathode') {
      // COM → GND, each color from +5 V through its own resistor
      return powered(
        [led, res('R1', 'top+1', 'c10', ohms[0]), res('R2', 'top+3', 'c12', ohms[1]), res('R3', 'top+5', 'c13', ohms[2])],
        [w('b11', 'top-1')],
      )
    }
    // COM → +5 V, each color sunk to GND through its resistor
    return powered(
      [led, res('R1', 'c10', 'top-1', ohms[0]), res('R2', 'c12', 'top-3', ohms[1]), res('R3', 'c13', 'top-5', ohms[2])],
      [w('b11', 'top+1')],
    )
  }

  it('common cathode: per-channel current = (5 V − Vf) / R with per-color Vf', () => {
    const e = engineOf(rgbLayout('cathode', [330, 220, 220]))
    e.advance(2e-3)
    const t = tele(e, 'D1')
    const iR = t.values!.iR
    const iG = t.values!.iG
    const iB = t.values!.iB
    // red ≈ (5 − 1.93)/330 ≈ 9.3 mA, green/blue ≈ (5 − 3.1)/220 ≈ 8.6 mA
    expect(iR).toBeGreaterThan(8.5e-3)
    expect(iR).toBeLessThan(10e-3)
    for (const i of [iG, iB]) {
      expect(i).toBeGreaterThan(7.8e-3)
      expect(i).toBeLessThan(9.4e-3)
    }
    // the dies sit at their own forward voltages (cathode at 0 V)
    expect(pinV(e, 'D1', 'R')).toBeCloseTo(RGB_VF[0], 1)
    expect(pinV(e, 'D1', 'G')).toBeCloseTo(RGB_VF[1], 1)
    // the common lead carries the sum; KCL against the resistors
    expect(t.current!).toBeCloseTo(iR + iG + iB, 9)
    expect(tele(e, 'R1').current!).toBeCloseTo(iR, 6)
    expect(t.leds!.R).toBeCloseTo(iR / 0.01, 6)
    expect(t.burned).toBe(false)
    expect(errorsOf(e)).toEqual([])
  })

  it('mixed color telemetry: packed rgb follows the channel brightness', () => {
    // red only (green/blue resistors huge → ~dark)
    const e = engineOf(rgbLayout('cathode', [270, 1e8, 1e8]))
    e.advance(1e-3)
    const t = tele(e, 'D1')
    const packed = t.rgb![0]
    expect(packed >> 16).toBeGreaterThan(200) // red channel
    expect((packed >> 8) & 0xff).toBe(0)
    expect(packed & 0xff).toBe(0)
    expect(t.ledBrightness!).toBeCloseTo(t.leds!.R, 9)
  })

  it('common anode: COM to +, colors sink through their resistors', () => {
    const e = engineOf(rgbLayout('anode', [330, 220, 220]))
    e.advance(2e-3)
    const t = tele(e, 'D1')
    expect(t.values!.iR).toBeGreaterThan(8.5e-3)
    expect(t.values!.iB).toBeGreaterThan(7.8e-3)
    // reversed wiring of a common-anode LED (COM to GND) stays dark
    const wrong: CircuitLayout = rgbLayout('cathode', [330, 220, 220])
    ;(wrong.components[1].params as Record<string, string>).common = 'anode'
    const e2 = engineOf(wrong)
    e2.advance(1e-3)
    expect(Math.abs(tele(e2, 'D1').values!.iR)).toBeLessThan(1e-9)
    expect(tele(e2, 'D1').ledBrightness).toBe(0)
  })

  it('a die without a resistor burns out and raises the engine LED issue', () => {
    const e = engineOf(rgbLayout('cathode', [0.1, 1e8, 1e8]))
    e.advance(5e-3)
    const t = tele(e, 'D1')
    expect(t.burned).toBe(true)
    expect(t.leds!.R).toBe(0) // burned die stops emitting
    expect(e.issues.some((i) => i.componentId === 'D1' && /burned out/.test(i.message))).toBe(true)
  })
})

// ------------------------------------------------------------------ MOSFETs

describe('pmos (high-side switch)', () => {
  // source on +5 V (strip a10), drain → 100 Ω load → GND, gate via the toggle
  // (a = GND → on, b = +5 V → off)
  const layoutFor = (state: 'a' | 'b') =>
    powered(
      [
        { id: 'Q1', type: 'pmos', holes: ['a10', 'a11', 'a12'] },
        res('RL', 'c12', 'top-2', 100),
        { id: 'S1', type: 'toggle_switch', holes: ['a20', 'a21', 'a22'], params: { state } },
      ],
      [w('b10', 'top+1'), w('b11', 'b21'), w('b20', 'top-4'), w('b22', 'top+5')],
    )

  it('gate low → on: the load gets ≈ 5 V (RDS(on) = 1/(k·(|VGS|−2)) ≈ 3.3 Ω)', () => {
    const e = engineOf(layoutFor('a'))
    e.step()
    const vLoad = pinV(e, 'Q1', 'drain')
    expect(vLoad).toBeCloseTo((5 * 100) / (100 + 1 / (0.1 * (5 - 2 - 0))), 1)
    expect(vLoad).toBeGreaterThan(4.7)
    // current flows OUT of the drain into the load
    expect(tele(e, 'Q1').current!).toBeLessThan(-0.045)
    expect(errorsOf(e)).toEqual([])
  })

  it('gate at the source → off; switching at runtime follows the gate', () => {
    const e = engineOf(layoutFor('b'))
    e.step()
    expect(pinV(e, 'Q1', 'drain')).toBeLessThan(0.01)
    e.setRuntimeParam('S1', 'state', 'a')
    e.step()
    expect(pinV(e, 'Q1', 'drain')).toBeGreaterThan(4.7)
  })

  it('Vth param: −4 V threshold barely conducts at |VGS| = 5 V', () => {
    const lay = layoutFor('a')
    lay.components[1].params = { vth: -4 }
    const e = engineOf(lay)
    e.step()
    // vov = 1 V: saturation current 0.5·0.1·1 = 50 mA → load ≈ 4.4 V... but
    // triode with Ron = 10 Ω → ≈ 4.5 V; clearly less than with −2 V
    expect(pinV(e, 'Q1', 'drain')).toBeLessThan(4.6)
    expect(pinV(e, 'Q1', 'drain')).toBeGreaterThan(3.5)
  })

  it('body diode conducts drain → source when the drain is driven above the source', () => {
    // source to a 1 kΩ load to GND, drain on +5 V, gate tied to the source (off)
    const e = engineOf(
      powered(
        [{ id: 'Q1', type: 'pmos', holes: ['a10', 'a11', 'a12'] }, res('RL', 'c10', 'top-2', 1000)],
        [w('b12', 'top+1'), w('c11', 'd10')],
      ),
    )
    e.step()
    const vs = pinV(e, 'Q1', 'source')
    expect(5 - vs).toBeGreaterThan(0.55)
    expect(5 - vs).toBeLessThan(0.75)
    expect(tele(e, 'Q1').values!.ibody).toBeGreaterThan(4e-3)
  })
})

describe('irlz44n (logic-level low-side switch)', () => {
  // 12 V supply → 10 Ω load (1.2 A) → drain; source → GND; gate from a source
  const layoutFor = (vGate: number) => ({
    version: 1 as const,
    components: [
      psu(12),
      { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1, amplitude: 0, offset: vGate } },
      { id: 'Q1', type: 'irlz44n', holes: ['a11', 'a12', 'a13'] },
      res('RL', 'top+2', 'c12', 10),
    ],
    wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('FG1:out', 'b11'), w('FG1:gnd', 'top-3'), w('b13', 'top-5')],
  })

  it('3.3 V and 5 V gate drive saturate it: VDS ≈ I·RDS(on) (25 mΩ at 5 V)', () => {
    for (const [vg, rMax] of [
      [5, 0.026],
      [3.3, 0.06],
    ]) {
      const e = engineOf(layoutFor(vg))
      e.step()
      const vds = pinV(e, 'Q1', 'drain')
      const id = tele(e, 'Q1').current!
      expect(id, `${vg} V`).toBeGreaterThan(1.15)
      expect(vds / id, `${vg} V`).toBeLessThan(rMax)
      expect(errorsOf(e)).toEqual([])
    }
  })

  it('0 V gate → off; 1.0 V (below Vth 1.5 V) still off', () => {
    for (const vg of [0, 1.0]) {
      const e = engineOf(layoutFor(vg))
      e.step()
      expect(pinV(e, 'Q1', 'drain'), `${vg} V`).toBeGreaterThan(11.9)
    }
  })
})

// ---------------------------------------------------------------------- zener

describe('zener (BZX55 5V1)', () => {
  it('clamps at 5.1 V ± 5 % at its 5 mA test current (driven by the lab current source)', () => {
    const e = engineOf(
      powered(
        [
          { id: 'I1', type: 'current_source', params: { current: 5, compliance: 12 } },
          { id: 'Z1', type: 'zener', holes: ['a10', 'a12'] },
        ],
        [w('I1:+', 'b12'), w('I1:-', 'b10'), w('c10', 'top-1')],
      ),
    )
    e.advance(1e-3)
    const vz = pinV(e, 'Z1', 'cathode') - pinV(e, 'Z1', 'anode')
    expect(vz).toBeGreaterThan(5.1 * 0.95)
    expect(vz).toBeLessThan(5.1 * 1.05)
    expect(vz).toBeCloseTo(5.1, 2) // anchored exactly at IZT
    // the source's 1 MΩ output shunt takes Vz / 1 MΩ of the 5 mA
    expect(tele(e, 'Z1').values!.iz).toBeCloseTo(5e-3 - vz / ISRC_R_SHUNT, 7) // ± the 1 nS GMIN node leak
    expect(errorsOf(e)).toEqual([])
  })

  it('shunt regulator: 12 V → 1 kΩ → zener holds ≈ 5.1 V; dynamic resistance ≈ 0.1 V / I', () => {
    const e = engineOf(powered([res('R1', 'top+1', 'a10', 1000), { id: 'Z1', type: 'zener', holes: ['a5', 'b10'] }], [w('b5', 'top-1')], 12))
    e.step()
    const v = pinV(e, 'Z1', 'cathode')
    const i = (12 - v) / 1000
    expect(v).toBeCloseTo(5.1 + 0.1 * Math.log(i / 5e-3), 3)
    expect(v).toBeGreaterThan(5.1 * 0.95)
    expect(v).toBeLessThan(5.1 * 1.05)
  })

  it('forward biased it conducts like a silicon diode', () => {
    const e = engineOf(powered([res('R1', 'top+1', 'a10', 1000), { id: 'Z1', type: 'zener', holes: ['b10', 'a5'] }], [w('b5', 'top-1')]))
    e.step()
    const vf = pinV(e, 'Z1', 'anode')
    expect(vf).toBeGreaterThan(0.6)
    expect(vf).toBeLessThan(0.75)
  })

  it('Newton-safe: a stiff 6 V supply straight across the clamp converges (no NaN, no warning)', () => {
    const e = engineOf(powered([{ id: 'Z1', type: 'zener', holes: ['a5', 'a10'] }], [w('b10', 'top+1'), w('b5', 'top-1')], 6))
    e.step()
    const t = tele(e, 'Z1')
    expect(Number.isFinite(t.current!)).toBe(true)
    // 0.9 V above Vz: I = 5 mA·e^9 ≈ 40 A through the 10 mΩ supply
    expect(-t.current!).toBeGreaterThan(5)
    expect(errorsOf(e)).toEqual([])
  })

  it('the vz param selects other BZX55 voltages', () => {
    const e = engineOf(
      powered(
        [
          { id: 'I1', type: 'current_source', params: { current: 5 } },
          { id: 'Z1', type: 'zener', holes: ['a10', 'a12'], params: { vz: '3.3' } },
        ],
        [w('I1:+', 'b12'), w('I1:-', 'b10'), w('c10', 'top-1')],
      ),
    )
    e.advance(1e-3)
    expect(pinV(e, 'Z1', 'cathode') - pinV(e, 'Z1', 'anode')).toBeCloseTo(3.3, 2)
  })
})

// ---------------------------------------------------------------- regulators

describe('lm7805 / ams1117_33', () => {
  /** regulator IN/GND/OUT on a10..a12, IN fed from the supply, load on OUT. */
  const regLayout = (type: string, vin: number, loadOhms: number | null) =>
    powered(
      [{ id: 'U1', type, holes: ['a10', 'a11', 'a12'] }, ...(loadOhms === null ? [] : [res('RL', 'c12', 'top-3', loadOhms)])],
      [w('b10', 'top+1'), w('b11', 'top-1')],
      vin,
    )

  it('7805: 5.00 V out at 100 mA from 9 V; ≈ 5 mA quiescent drawn from the input', () => {
    const e = engineOf(regLayout('lm7805', 9, 50))
    e.advance(1e-3)
    expect(pinV(e, 'U1', 'OUT')).toBeCloseTo(5, 2)
    const sub = tele(e, 'U1').sub!
    expect(sub.REG.values!.iout).toBeCloseTo(0.1, 3)
    // supply current = load current + Iq
    expect(tele(e, 'PS1').current!).toBeCloseTo(0.1 + 0.005, 3)
    // no load: only Iq
    const e2 = engineOf(regLayout('lm7805', 9, null))
    e2.advance(1e-3)
    expect(pinV(e2, 'U1', 'OUT')).toBeCloseTo(5, 2)
    expect(tele(e2, 'PS1').current!).toBeCloseTo(0.005, 4)
  })

  it('7805 dropout: OUT = VIN − 2 V below 7 V input', () => {
    const e = engineOf(regLayout('lm7805', 6, 100))
    e.advance(1e-3)
    expect(pinV(e, 'U1', 'OUT')).toBeCloseTo(4, 1)
  })

  it('7805 current limit: a 1 Ω load settles at 1.5 A', () => {
    const e = engineOf(regLayout('lm7805', 12, 1))
    e.advance(2e-3)
    const i = tele(e, 'U1').sub!.REG.values!.iout
    expect(i).toBeCloseTo(1.5, 1)
    expect(tele(e, 'U1').sub!.REG.values!.limiting).toBe(1)
    expect(pinV(e, 'U1', 'OUT')).toBeCloseTo(1.5, 1)
  })

  it('AMS1117-3.3: 3.30 V from 5 V, dropout 1.1 V, limit 1.1 A', () => {
    const e = engineOf(regLayout('ams1117_33', 5, 33))
    e.advance(1e-3)
    expect(pinV(e, 'U1', 'OUT')).toBeCloseTo(3.3, 2)
    const e2 = engineOf(regLayout('ams1117_33', 4, 330))
    e2.advance(1e-3)
    expect(pinV(e2, 'U1', 'OUT')).toBeCloseTo(2.9, 1)
    const e3 = engineOf(regLayout('ams1117_33', 5, 0.5))
    e3.advance(2e-3)
    expect(tele(e3, 'U1').sub!.REG.values!.iout).toBeCloseTo(1.1, 1)
  })
})

// ----------------------------------------------------------------- batteries

describe('batteries (Thevenin sag)', () => {
  const batLayout = (type: string, ohms: number): CircuitLayout => ({
    version: 1,
    components: [{ id: 'B1', type }, res('RL', 'a10', 'a20', ohms)],
    wires: [w('B1:+', 'b10'), w('B1:-', 'b20')],
  })
  const vLoad = (e: SimEngine) => pinV(e, 'RL', 'p1') - pinV(e, 'RL', 'p2')

  it('9 V battery sags as V = 9 · R / (R + 1.5 Ω)', () => {
    for (const r of [1000, 100, 10]) {
      const e = new SimEngine(batLayout('battery_9v', r))
      e.step()
      expect(vLoad(e), `${r} Ω`).toBeCloseTo((9 * r) / (r + 1.5), 3)
      expect(tele(e, 'B1').values!.vterm).toBeCloseTo((9 * r) / (r + 1.5), 3)
    }
  })

  it('2×AA holder: 3 V behind 0.3 Ω', () => {
    const e = new SimEngine(batLayout('battery_aa2', 10))
    e.step()
    expect(vLoad(e)).toBeCloseTo((3 * 10) / 10.3, 3)
  })

  it('a shorted battery is flagged like a shorted supply', () => {
    const e = new SimEngine(batLayout('battery_9v', 0.01))
    e.step()
    expect(tele(e, 'B1').current!).toBeGreaterThan(5)
    expect(e.issues.some((i) => i.componentId === 'B1' && /possible short/.test(i.message))).toBe(true)
  })
})

// ------------------------------------------------------------ current source

describe('current_source (compliance limit)', () => {
  const srcLayout = (ohms: number | null, params: Record<string, number> = {}): CircuitLayout => ({
    version: 1,
    components: [
      psu(5),
      { id: 'I1', type: 'current_source', params: { current: 10, compliance: 12, ...params } },
      ...(ohms === null ? [] : [res('RL', 'a10', 'a20', ohms)]),
    ],
    wires: [w('PS1:-', 'top-0'), w('I1:+', 'b10'), w('I1:-', 'b20'), w('c20', 'top-1')],
  })

  it('forces the set current through the load (CC mode)', () => {
    const e = new SimEngine(srcLayout(100))
    e.advance(1e-3)
    // all of Iset but the 1 MΩ output shunt's V/1 MΩ
    expect(tele(e, 'RL').current!).toBeCloseTo(0.01 - 1 / ISRC_R_SHUNT, 8)
    expect(tele(e, 'I1').text![1]).toBe('CC')
    e.setRuntimeParam('I1', 'current', 50)
    e.advance(1e-3)
    expect(tele(e, 'RL').current!).toBeCloseTo(0.05 - 5 / ISRC_R_SHUNT, 8)
  })

  it('hits compliance: a 2 kΩ load would need 20 V → held at 12 V, 6 mA (CV)', () => {
    const e = new SimEngine(srcLayout(2000))
    e.advance(1e-3)
    expect(pinV(e, 'RL', 'p1') - pinV(e, 'RL', 'p2')).toBeCloseTo(12, 2)
    expect(tele(e, 'RL').current!).toBeCloseTo(0.006, 4)
    expect(tele(e, 'I1').values!.compliance).toBe(1)
    expect(tele(e, 'I1').text![1]).toMatch(/^CV/)
  })

  it('open output rests at the compliance voltage (no runaway, no NaN)', () => {
    const e = new SimEngine(srcLayout(null, { compliance: 9 }))
    e.advance(1e-3)
    const t = tele(e, 'I1')
    expect(t.values!.vout).toBeCloseTo(9, 2)
    expect(Number.isFinite(t.values!.iout)).toBe(true)
    expect(errorsOf(e)).toEqual([])
  })
})

// --------------------------------------------------------------------- relay

describe('relay_5v (SRD-05VDC-SL-C)', () => {
  /**
   * Coil: +5 V → toggle S1 (a = +5 V, common → COIL1, b = open) → COIL1;
   * COIL2 → GND. Contacts: COM on +5 V, NO and NC each loaded with 1 kΩ to
   * GND (so their voltage shows the contact state). Optional 1N4148 across
   * the coil (cathode on COIL1 = the + side).
   */
  const relayLayout = (opts: { diode?: boolean; coilVolts?: number } = {}): CircuitLayout => {
    const comps: ComponentInstance[] = [
      { id: 'K1', type: 'relay_5v', at: 'd20' }, // COIL1 d20, COIL2 g20, COM e19, NO g25, NC d25
      { id: 'S1', type: 'toggle_switch', holes: ['a40', 'a41', 'a42'], params: { state: 'b' } },
      res('RNO', 'j25', 'bot-10', 1000),
      res('RNC', 'a25', 'top-10', 1000),
    ]
    const wires = [w('b40', 'top+3'), w('b41', 'a20'), w('j20', 'bot-3'), w('a19', 'top+5')]
    if (opts.diode) comps.push({ id: 'D1', type: 'diode', holes: ['i20', 'b20'] }) // anode COIL2, cathode COIL1
    return powered(comps, wires, opts.coilVolts ?? 5)
  }
  /**
   * The coordinator runs MCU / device circuits with strictConvergence (Newton
   * keeps iterating while any junction is still step-limited). The flyback
   * case needs it: the legacy 1N4148 model's 0.5 V/iteration limiter must
   * walk from −5 V reverse to forward within the switch-off step.
   */
  const relayEngine = (opts: { diode?: boolean; coilVolts?: number } = {}): SimEngine => {
    const e = engineOf(relayLayout(opts))
    e.strictConvergence = true
    return e
  }
  const no = (e: SimEngine) => pinV(e, 'K1', 'NO') > 2.5
  const nc = (e: SimEngine) => pinV(e, 'K1', 'NC') > 2.5

  /** Time (s) until `cond` holds, stepping 50 µs, up to `max` s; NaN if never. */
  function timeUntil(e: SimEngine, cond: () => boolean, max: number): number {
    const t0 = e.time
    while (e.time - t0 < max) {
      e.step()
      if (cond()) return e.time - t0
    }
    return NaN
  }

  it('constants are the datasheet limits', () => {
    expect(RELAY_I_PICKUP).toBeCloseTo(3.75 / 70, 9)
    expect(RELAY_I_DROPOUT).toBeCloseTo(0.5 / 70, 9)
  })

  it('rest: COM–NC closed, NO open; coil current rises with τ = L/R', () => {
    const e = relayEngine()
    e.advance(1e-3)
    expect(nc(e)).toBe(true)
    expect(no(e)).toBe(false)
    e.setRuntimeParam('S1', 'state', 'a')
    const tau = RELAY_L / RELAY_R
    e.advance(tau)
    const i = tele(e, 'K1').values!.icoil
    expect(i).toBeCloseTo((5 / 70) * (1 - Math.exp(-1)), 2)
  })

  it('pick-up: NC breaks, then NO makes — at coil rise to 75 % + 4 ms travel (≈ 6 ms)', () => {
    const e = relayEngine()
    e.advance(1e-3)
    e.setRuntimeParam('S1', 'state', 'a')
    const tRise = (RELAY_L / RELAY_R) * Math.log(1 / (1 - 0.75))
    const tBreak = timeUntil(e, () => !nc(e), 0.02)
    const tMake = tBreak + timeUntil(e, () => no(e), 0.02)
    expect(tMake).toBeGreaterThan(tRise + RELAY_T_OPERATE - 2e-4)
    expect(tMake).toBeLessThan(tRise + RELAY_T_OPERATE + 4e-4)
    expect(tMake).toBeLessThan(10e-3) // datasheet operate time ≤ 10 ms
    // break-before-make gap
    expect(tMake - tBreak).toBeCloseTo(RELAY_T_GAP, 3)
    expect(tele(e, 'K1').values!.energized).toBe(1)
  })

  it('switching the coil off without a flyback diode: inductive kick warning, release ≈ 2 ms', () => {
    const e = relayEngine()
    e.setRuntimeParam('S1', 'state', 'a')
    e.advance(20e-3)
    expect(no(e)).toBe(true)
    expect(e.issues.some((i) => /flyback/.test(i.message))).toBe(false)
    e.setRuntimeParam('S1', 'state', 'b')
    const tRelease = timeUntil(e, () => nc(e), 0.02)
    expect(tRelease).toBeGreaterThan(RELAY_T_RELEASE - 1e-4)
    expect(tRelease).toBeLessThan(RELAY_T_RELEASE + 3e-4)
    const warn = e.issues.find((i) => /flyback/.test(i.message))
    expect(warn?.componentId).toBe('K1')
    expect(warn?.level).toBe('warning')
    expect(tele(e, 'K1').values!.kick).toBeGreaterThan(30)
  })

  it('with a flyback diode: no warning, the kick is clamped and release takes longer', () => {
    const e = relayEngine({ diode: true })
    e.setRuntimeParam('S1', 'state', 'a')
    e.advance(20e-3)
    expect(no(e)).toBe(true)
    e.setRuntimeParam('S1', 'state', 'b')
    const tRelease = timeUntil(e, () => nc(e), 0.02)
    // current decays through the diode: (I0 + Vd/R)·e^(−t/τ) − Vd/R reaches drop-out ≈ 2 ms later
    expect(tRelease).toBeGreaterThan(RELAY_T_RELEASE + 1.5e-3)
    expect(tRelease).toBeLessThan(RELAY_T_RELEASE + 3e-3)
    expect(e.issues.some((i) => /flyback/.test(i.message))).toBe(false)
    expect(tele(e, 'K1').values!.kick).toBeLessThan(1.2)
  })

  it('MCU-style low-side driver: 2N7000 switched by a logic level, 1N4148 flyback — clean release', () => {
    // COIL1 on +5 V, COIL2 → 2N7000 drain, source → GND, gate from a 0/5 V source
    const lay: CircuitLayout = {
      version: 1,
      components: [
        psu(5),
        { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1, amplitude: 0, offset: 5 } },
        { id: 'K1', type: 'relay_5v', at: 'd20' },
        { id: 'Q1', type: 'nmos', holes: ['a30', 'a31', 'a32'] }, // source, gate, drain
        { id: 'D1', type: 'diode', holes: ['i20', 'b20'] }, // anode COIL2, cathode COIL1
        res('RNO', 'j25', 'bot-10', 1000),
      ],
      wires: [
        w('PS1:+', 'top+0'),
        w('PS1:-', 'top-0'),
        w('top-49', 'bot-49'),
        w('a20', 'top+2'),
        w('j20', 'b32'),
        w('b30', 'top-4'),
        w('FG1:out', 'b31'),
        w('FG1:gnd', 'top-6'),
        w('a19', 'top+8'),
      ],
    }
    const e = engineOf(lay)
    e.strictConvergence = true
    e.advance(20e-3)
    expect(pinV(e, 'K1', 'NO')).toBeGreaterThan(4.9)
    e.setRuntimeParam('FG1', 'offset', 0)
    e.advance(10e-3)
    expect(pinV(e, 'K1', 'NO')).toBeLessThan(0.01)
    // the diode clamped the kick: drain only ≈ 0.8 V above the rail
    expect(tele(e, 'K1').values!.kick).toBeLessThan(1.2)
    expect(e.issues.filter((i) => /flyback|converge/.test(i.message))).toEqual([])
  })

  it('3.3 V on the coil is below the guaranteed pick-up (75 %): the relay stays released', () => {
    const e = relayEngine({ coilVolts: 3.3 })
    e.setRuntimeParam('S1', 'state', 'a')
    e.advance(30e-3)
    expect(tele(e, 'K1').values!.icoil).toBeCloseTo(3.3 / 70, 3)
    expect(no(e)).toBe(false)
    expect(nc(e)).toBe(true)
  })
})

// --------------------------------------------------------------------- PC817

describe('pc817 optocoupler', () => {
  // DIP at f45: anode f45, cathode f46, emitter e46, collector e45
  const optoLayout = (rLed: number, rPull: number, ctr?: number): CircuitLayout =>
    powered(
      [
        { id: 'U1', type: 'pc817', at: 'f45', ...(ctr ? { params: { ctr } } : {}) },
        res('RLED', 'bot+5', 'j45', rLed),
        res('RC', 'top+5', 'a45', rPull),
      ],
      [w('top+48', 'bot+48'), w('j46', 'bot-5'), w('a46', 'top-5')],
    )

  it('CTR ≈ 100 %: IC = IF in the active region', () => {
    const e = engineOf(optoLayout(330, 100))
    e.step()
    const v = tele(e, 'U1').values!
    expect(v.if).toBeGreaterThan(10e-3)
    expect(v.if).toBeLessThan(12.5e-3)
    expect(v.ic / v.if).toBeCloseTo(1.0, 2)
    // LED forward voltage ≈ 1.2 V at ~11 mA
    expect(pinV(e, 'U1', 'anode')).toBeGreaterThan(1.1)
    expect(pinV(e, 'U1', 'anode')).toBeLessThan(1.25)
    expect(errorsOf(e)).toEqual([])
  })

  it('saturates with a 10 kΩ pull-up (VCE(sat) < 0.2 V) and releases when the LED is off', () => {
    const e = engineOf(optoLayout(330, 10_000))
    e.step()
    expect(pinV(e, 'U1', 'collector')).toBeLessThan(0.2)
    const off = engineOf(optoLayout(1e9, 10_000))
    off.step()
    expect(pinV(off, 'U1', 'collector')).toBeGreaterThan(4.99)
  })

  it('the ctr param scales the output; the saturation curve is continuous', () => {
    const e = engineOf(optoLayout(1000, 100, 300))
    e.step()
    const v = tele(e, 'U1').values!
    expect(v.ic / v.if).toBeCloseTo(3.0, 1)
    // h(VCE) is monotonic and passes the datasheet saturation point
    let prev = -Infinity
    for (let vce = -0.2; vce <= 1; vce += 0.01) {
      const [h] = optoOutput(vce)
      expect(h).toBeGreaterThanOrEqual(prev)
      prev = h
    }
    expect(optoOutput(5)[0]).toBeCloseTo(1, 6)
  })

  it('isolation: a floating output loop (own 3 V battery) carries CTR·IF; no current crosses sides', () => {
    const lay: CircuitLayout = {
      version: 1,
      components: [
        psu(5),
        { id: 'U1', type: 'pc817', at: 'f45' },
        res('RLED', 'bot+5', 'j45', 330),
        { id: 'B1', type: 'battery_aa2' },
        res('RC', 'a45', 'a40', 100),
      ],
      wires: [w('PS1:+', 'bot+0'), w('PS1:-', 'bot-0'), w('j46', 'bot-5'), w('B1:+', 'b40'), w('B1:-', 'b46')],
    }
    const e = engineOf(lay)
    e.step()
    const v = tele(e, 'U1').values!
    // the LED-side supply delivers exactly the LED current
    expect(tele(e, 'PS1').current!).toBeCloseTo(v.if, 7)
    // the battery loop carries the transistor current
    expect(tele(e, 'B1').current!).toBeCloseTo(v.ic, 7)
    expect(v.ic / v.if).toBeGreaterThan(0.95)
  })
})

// ----------------------------------------------------------------------- NTC

describe('ntc_10k', () => {
  const ntcLayout = (tC: number) =>
    powered(
      [{ id: 'TH1', type: 'ntc_10k', holes: ['a10', 'a12'], params: { temperature: tC } }, res('R1', 'c12', 'top-2', 10_000)],
      [w('b10', 'top+1')],
    )
  const rOf = (tC: number) => 10_000 * Math.exp(3950 * (1 / (tC + 273.15) - 1 / 298.15))

  it('R(T) follows the B equation (10 kΩ at 25 °C, B = 3950)', () => {
    for (const tC of [-20, 0, 25, 50, 100]) {
      const e = engineOf(ntcLayout(tC))
      e.step()
      const r = tele(e, 'TH1').values!.resistance
      expect(r / rOf(tC), `${tC} °C`).toBeCloseTo(1, 9)
      // divider with 10 kΩ
      expect(pinV(e, 'TH1', 'p2'), `${tC} °C`).toBeCloseTo((5 * 10_000) / (10_000 + rOf(tC)), 4)
    }
    expect(rOf(25)).toBeCloseTo(10_000, 6)
  })

  it('temperature is a runtime knob', () => {
    const e = engineOf(ntcLayout(25))
    e.step()
    expect(pinV(e, 'TH1', 'p2')).toBeCloseTo(2.5, 3)
    e.setRuntimeParam('TH1', 'temperature', 60)
    e.step()
    expect(pinV(e, 'TH1', 'p2')).toBeCloseTo((5 * 10_000) / (10_000 + rOf(60)), 4)
  })
})

// ----------------------------------------------------------- level shifter

describe('level_shifter_4ch (BSS138 sub-circuit)', () => {
  /**
   * HV = 5 V (supply), LV = 3.3 V from an AMS1117 fed by the 5 V rail.
   * Open-drain drivers: toggle S1 pulls LV1 to GND (state a), toggle S2
   * pulls HV2 to GND (state a); state b leaves the line released.
   */
  const shifterLayout = (s1: 'a' | 'b', s2: 'a' | 'b'): CircuitLayout =>
    powered(
      [
        { id: 'U1', type: 'level_shifter_4ch', at: 'g30' },
        { id: 'U2', type: 'ams1117_33', holes: ['a50', 'a51', 'a52'] },
        { id: 'S1', type: 'toggle_switch', holes: ['a55', 'a56', 'a57'], params: { state: s1 } },
        { id: 'S2', type: 'toggle_switch', holes: ['a60', 'a61', 'a62'], params: { state: s2 } },
      ],
      [
        w('b50', 'top+1'), // regulator IN ← 5 V
        w('b51', 'top-1'),
        w('b52', 'j32'), // 3.3 V → LV
        w('a32', 'top+3'), // HV ← 5 V
        w('a33', 'top-3'), // GND (HV side; LV GND is bridged on the board)
        w('b55', 'top-5'), // S1.a = GND
        w('b56', 'j30'), // S1.common → LV1
        w('b60', 'top-7'), // S2.a = GND
        w('b61', 'a31'), // S2.common → HV2
      ],
    )
  const v = (e: SimEngine, pin: string) => pinV(e, 'U1', pin)

  it('idle: every LV pin sits at 3.3 V, every HV pin at 5 V (pull-ups)', () => {
    const e = engineOf(shifterLayout('b', 'b'))
    e.advance(1e-3)
    for (const n of [1, 2, 3, 4]) {
      expect(v(e, `LV${n}`), `LV${n}`).toBeCloseTo(3.3, 2)
      expect(v(e, `HV${n}`), `HV${n}`).toBeCloseTo(5, 2)
    }
    expect(errorsOf(e)).toEqual([])
  })

  it('3.3 V side driven low (open drain) → the 5 V side follows low', () => {
    const e = engineOf(shifterLayout('a', 'b'))
    e.advance(1e-3)
    expect(v(e, 'LV1')).toBeLessThan(0.01)
    expect(v(e, 'HV1')).toBeLessThan(0.15) // 0.5 mA through the BSS138 channel
    // the other channels are untouched
    expect(v(e, 'HV3')).toBeCloseTo(5, 2)
    expect(v(e, 'LV3')).toBeCloseTo(3.3, 2)
  })

  it('5 V side driven low → the 3.3 V side follows low (body diode, then the channel)', () => {
    const e = engineOf(shifterLayout('b', 'a'))
    e.advance(1e-3)
    expect(v(e, 'HV2')).toBeLessThan(0.01)
    expect(v(e, 'LV2')).toBeLessThan(0.15)
    expect(v(e, 'HV1')).toBeCloseTo(5, 2)
  })

  it('toggling at runtime translates edges both ways', () => {
    const e = engineOf(shifterLayout('b', 'b'))
    e.advance(5e-4)
    e.setRuntimeParam('S1', 'state', 'a')
    e.advance(5e-4)
    expect(v(e, 'HV1')).toBeLessThan(0.15)
    e.setRuntimeParam('S1', 'state', 'b')
    e.advance(5e-4)
    expect(v(e, 'HV1')).toBeCloseTo(5, 2)
    expect(v(e, 'LV1')).toBeCloseTo(3.3, 2)
  })
})

// --------------------------------------------------- toggle switch, crystal

describe('toggle_switch and crystal_hc49', () => {
  it('toggle joins common to a or b', () => {
    const e = engineOf(
      powered(
        [
          { id: 'S1', type: 'toggle_switch', holes: ['a10', 'a11', 'a12'], params: { state: 'a' } },
          res('RA', 'c10', 'top-2', 1000),
          res('RB', 'c12', 'top-4', 1000),
        ],
        [w('b11', 'top+1')],
      ),
    )
    e.step()
    expect(pinV(e, 'S1', 'a')).toBeCloseTo(5, 2)
    expect(pinV(e, 'S1', 'b')).toBeCloseTo(0, 3)
    e.setRuntimeParam('S1', 'state', 'b')
    e.step()
    expect(pinV(e, 'S1', 'a')).toBeCloseTo(0, 3)
    expect(pinV(e, 'S1', 'b')).toBeCloseTo(5, 2)
  })

  it('crystal is an open circuit (visual only): it never loads the nets it touches', () => {
    const e = engineOf(
      powered([{ id: 'Y1', type: 'crystal_hc49', holes: ['a10', 'a12'] }, res('R1', 'top+1', 'c10', 1000)], [w('b12', 'top-1')]),
    )
    e.step()
    expect(pinV(e, 'Y1', 'p1')).toBeCloseTo(5, 4) // only the 1 nS GMIN leak loads the node
    expect(tele(e, 'PS1').current!).toBeLessThan(1e-7)
  })
})
