/**
 * Motors & drivers family (src/model/parts/motors.parts.ts,
 * src/sim/models/motors*.ts): catalog honesty and placement, the
 * electromechanical models in isolation (DC motor ODE: steady-state speed vs
 * voltage, stall current, mechanical time constant), and every driver and
 * motor in the REAL SimEngine on bench circuits built like a user would —
 * bench supplies, wires to the module terminals / breadboard holes, a
 * resistor or a motor as the load, a function generator as the pulse source:
 * L298N / TB6612FNG / DRV8833 truth tables and drops, the ULN2003 Darlington
 * sinks and their LEDs, STEP/DIR microstepping of the A4988 / DRV8825 /
 * TMC2209 with the motor following, the SG90 position loop, and the warnings
 * the models raise (stall, over-current trip, reset held, logic thresholds).
 * Real firmware on the Blue Pill: tests/devices/motors-firmware.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { validateLayout } from '../../src/model/validate'
import { registeredDevices } from '../../src/sim/devices'
import { registeredChips } from '../../src/sim/chip-api'
import { SimEngine } from '../../src/sim/engine'
import { DC_MOTOR_130, DcMotor, dcSteadySpeed } from '../../src/sim/models/motors-mech'

const MOTOR_TYPES = [
  'dc_motor',
  'sg90_servo',
  'stepper_28byj48',
  'nema17_stepper',
  'uln2003_board',
  'l298n_module',
  'tb6612fng_module',
  'drv8833_module',
  'a4988_driver',
  'drv8825_driver',
  'tmc2209_driver',
]

const RPM = 60 / (2 * Math.PI)

// ---------------------------------------------------------------------------
// bench builder
// ---------------------------------------------------------------------------

class Bench {
  readonly components: ComponentInstance[] = []
  readonly wires: Wire[] = []
  private n = 0

  add(c: ComponentInstance): this {
    this.components.push(c)
    return this
  }
  psu(id: string, voltage: number): this {
    return this.add({ id, type: 'power_supply', params: { voltage } })
  }
  w(from: string, to: string): this {
    this.wires.push({ id: `w${++this.n}`, from, to })
    return this
  }
  layout(): CircuitLayout {
    return { version: 1, name: 'motors bench', components: this.components, wires: this.wires }
  }
  engine(): SimEngine {
    return new SimEngine(this.layout())
  }
}

function values(e: SimEngine, id: string): Record<string, number> {
  return e.telemetry().components[id]?.values ?? {}
}
function pv(e: SimEngine, id: string, pin: string): number {
  return e.telemetry().components[id]?.pinVoltages[pin] ?? NaN
}
function issues(e: SimEngine): string[] {
  return e.telemetry().issues.map((i) => i.message)
}

/** A free hole in the strip of a footprint part's pin (row a for the top half, j for the bottom). */
function holeOf(comp: ComponentInstance, pin: string): string {
  const entry = CATALOG[comp.type]
  const h = componentPinHoles(comp, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(`${comp.id}:${pin}`)
  return formatHole({ ...h, row: 'abcde'.includes(h.row) ? 'a' : 'j' })
}
/** A second free hole of the same strip (row b / i). */
function hole2Of(comp: ComponentInstance, pin: string): string {
  const entry = CATALOG[comp.type]
  const h = componentPinHoles(comp, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(`${comp.id}:${pin}`)
  return formatHole({ ...h, row: 'abcde'.includes(h.row) ? 'b' : 'i' })
}

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

describe('motors catalog entries', () => {
  it('exist as honest motor-category parts with full pin docs, specs and a usable doc', () => {
    for (const t of MOTOR_TYPES) {
      const e = CATALOG[t]
      expect(e, t).toBeDefined()
      expect(e.category, t).toBe('motor')
      expect(['full', 'partial'], t).toContain(e.support?.level)
      expect(e.support!.simulated!.length, t).toBeGreaterThan(0)
      expect(e.support!.limits!.length, t).toBeGreaterThan(0)
      expect(e.pinInfo!.map((p) => p.pin), t).toEqual(e.pins)
      expect(e.meta?.partNumber, t).toBeTruthy()
      expect(e.meta?.sizeMm?.length, t).toBe(3)
      expect(e.meta!.specs!.length, t).toBeGreaterThan(0)
      expect(e.meta!.tags!.length, t).toBeGreaterThan(3)
      expect(e.doc.length, t).toBeGreaterThan(150)
      for (const p of e.params ?? []) expect(p.runtime, `${t}.${p.key}`).toBe(true)
    }
    // the UART configuration of the TMC2209 is not simulated: partial, said so
    expect(CATALOG.tmc2209_driver.support!.level).toBe('partial')
    expect(CATALOG.tmc2209_driver.support!.limits!.join(' ')).toMatch(/UART/)
  })

  it('every part is the motors_part chip + a registered electrical sub-circuit naming real pins', () => {
    const devs = new Set(registeredDevices())
    const chips = new Set(registeredChips())
    expect(chips.has('motors_part')).toBe(true)
    for (const t of MOTOR_TYPES) {
      const e = CATALOG[t]
      expect(e.sim, t).toEqual({ kind: 'chip', model: 'motors_part' })
      expect(e.subcircuit!.length, t).toBeGreaterThan(0)
      for (const el of e.subcircuit!) {
        expect(devs.has(el.model) || ['resistor', 'diode', 'led', 'npn', 'ldo'].includes(el.model), `${t}.${el.id} ${el.model}`).toBe(true)
        for (const p of el.pins) if (!p.startsWith('@')) expect(e.pins, `${t}.${el.id}`).toContain(p)
      }
    }
  })

  it('breadboard carriers land every pin on its own strip at 0° / 180° and refuse 90° / 270°', () => {
    for (const t of ['tb6612fng_module', 'drv8833_module', 'a4988_driver', 'drv8825_driver', 'tmc2209_driver']) {
      const e = getEntry(t)!
      expect(e.placement, t).toBe('footprint')
      expect(e.allowedRotations, t).toEqual([0, 180])
      const row0 = e.footprintOffsets![0].row
      const n = e.pins.length / 2
      const mirror: Record<string, string> = { h: 'c', c: 'h', g: 'd', d: 'g' }
      for (const [rotation, at] of [
        [0, `${row0}30`],
        [180, `${mirror[row0]}${30 + n - 1}`],
      ] as const) {
        const comp: ComponentInstance = { id: 'U1', type: t, at, ...(rotation ? { rotation } : {}) }
        const holes = componentPinHoles(comp, e)!
        expect(holes, `${t}@${rotation}`).not.toBeNull()
        const strips = holes.map((h) => (h && h.kind === 'strip' ? `${h.col}${'abcde'.includes(h.row) ? 'T' : 'B'}` : '?'))
        const distinct = new Set(strips)
        // internally bridged GND pins may share nothing either: every pin its own strip
        expect(distinct.size, `${t}@${rotation}`).toBe(e.pins.length)
        const v = validateLayout({ version: 1, name: 'x', components: [comp], wires: [] })
        expect(v.errors, `${t}@${rotation}`).toEqual([])
      }
      for (const rotation of [90, 270] as const) {
        const v = validateLayout({ version: 1, name: 'x', components: [{ id: 'U1', type: t, at: `${row0}30`, rotation }], wires: [] })
        expect(v.errors.length, `${t}@${rotation}`).toBeGreaterThan(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// DC motor ODE in isolation
// ---------------------------------------------------------------------------

/** Drive a DcMotor with an ideal voltage source for `t` seconds; returns ω samples. */
function runDc(v: number, t: number, dt = 50e-6, tLoad = 0): { m: DcMotor; w: number[] } {
  const m = new DcMotor(DC_MOTOR_130)
  const w: number[] = []
  for (let k = 0; k < Math.round(t / dt); k++) {
    m.prepare(dt, tLoad)
    m.advance(v, dt, tLoad)
    w.push(m.w)
  }
  return { m, w }
}

describe('DC motor model (armature + rotor, backward Euler together)', () => {
  it('steady-state no-load speed follows (V − R·Tf/Kt) / (Ke + R·b/Kt): ≈ 6 400 rpm at 3 V, ≈ 13 400 rpm at 6 V', () => {
    for (const v of [3, 4.5, 6]) {
      const { m } = runDc(v, 0.4)
      const expected = dcSteadySpeed(DC_MOTOR_130, v)
      expect(m.w / expected, `${v} V`).toBeCloseTo(1, 3)
      // no-load current = friction / Kt ≈ 0.1 A
      expect(m.i, `${v} V`).toBeCloseTo((DC_MOTOR_130.tc + DC_MOTOR_130.b * m.w) / DC_MOTOR_130.kt, 3)
    }
    expect(dcSteadySpeed(DC_MOTOR_130, 3) * RPM).toBeGreaterThan(6200)
    expect(dcSteadySpeed(DC_MOTOR_130, 3) * RPM).toBeLessThan(6600)
    expect(dcSteadySpeed(DC_MOTOR_130, 6) * RPM).toBeGreaterThan(13200)
    expect(dcSteadySpeed(DC_MOTOR_130, 6) * RPM).toBeLessThan(13600)
    // reversed supply → reversed rotation, same magnitude
    expect(runDc(-6, 0.4).m.w).toBeCloseTo(-dcSteadySpeed(DC_MOTOR_130, 6), 0)
  })

  it('a load above the stall torque keeps the shaft still and the full V/R flows', () => {
    const { m } = runDc(6, 0.1, 50e-6, 10e-3) // stall torque at 6 V = Kt·V/R = 8 mN·m
    expect(m.w).toBe(0)
    expect(m.i).toBeCloseTo(6 / DC_MOTOR_130.r, 3)
    // just below the stall torque it turns slowly
    const slow = runDc(6, 0.5, 50e-6, 7e-3).m
    expect(slow.w).toBeGreaterThan(0)
    expect(slow.w).toBeLessThan(0.2 * dcSteadySpeed(DC_MOTOR_130, 6))
  })

  it('spins up with the mechanical time constant J·R/(Kt·Ke + R·b) ≈ 22 ms, independent of the step size', () => {
    const p = DC_MOTOR_130
    const tau = (p.j * p.r) / (p.kt * p.ke + p.r * p.b)
    expect(tau * 1e3).toBeGreaterThan(20)
    expect(tau * 1e3).toBeLessThan(24)
    for (const dt of [5e-6, 50e-6]) {
      const { w } = runDc(6, 0.2, dt)
      const final = dcSteadySpeed(p, 6)
      const k63 = w.findIndex((x) => x >= 0.632 * final)
      // + L/R electrical lag (≈ 67 µs) and the half-step of the sampling
      expect(k63 * dt * 1e3, `dt ${dt}`).toBeGreaterThan(tau * 1e3 * 0.95)
      expect(k63 * dt * 1e3, `dt ${dt}`).toBeLessThan(tau * 1e3 * 1.08)
    }
  })
})

// ---------------------------------------------------------------------------
// DC motor in the engine
// ---------------------------------------------------------------------------

describe('DC motor on a bench supply (SimEngine)', () => {
  it('runs at the no-load speed, reverses with the polarity, and reports a stall under a heavy load', () => {
    const b = new Bench().psu('PS1', 6).add({ id: 'M1', type: 'dc_motor' }).w('PS1:+', 'M1:M+').w('PS1:-', 'M1:M-')
    const e = b.engine()
    e.advance(0.3)
    const v = values(e, 'M1')
    expect(v.rpm / (dcSteadySpeed(DC_MOTOR_130, 6) * RPM)).toBeCloseTo(1, 2)
    expect(v.current).toBeGreaterThan(0.09)
    expect(v.current).toBeLessThan(0.13)
    expect(v.stalled).toBe(0)

    const rev = new Bench().psu('PS1', 6).add({ id: 'M1', type: 'dc_motor' }).w('PS1:+', 'M1:M-').w('PS1:-', 'M1:M+').engine()
    rev.advance(0.3)
    expect(values(rev, 'M1').rpm).toBeLessThan(-0.98 * dcSteadySpeed(DC_MOTOR_130, 6) * RPM)

    // the runtime load torque brakes it, then stalls it
    const s = new Bench().psu('PS1', 5).add({ id: 'M1', type: 'dc_motor' }).w('PS1:+', 'M1:M+').w('PS1:-', 'M1:M-').engine()
    s.advance(0.2)
    s.setRuntimeParam('M1', 'loadTorque', 3 as ParamValue)
    s.advance(0.3)
    const loaded = values(s, 'M1')
    expect(loaded.rpm).toBeLessThan(0.65 * dcSteadySpeed(DC_MOTOR_130, 5) * RPM)
    expect(loaded.current).toBeGreaterThan(0.7)
    s.setRuntimeParam('M1', 'loadTorque', 20 as ParamValue)
    s.advance(0.4)
    const stalled = values(s, 'M1')
    expect(stalled.rpm).toBe(0)
    expect(stalled.current).toBeCloseTo(5 / DC_MOTOR_130.r, 1)
    expect(stalled.stalled).toBe(1)
    expect(issues(s).some((m) => /M1: motor stalled — 1\.\d\d A/.test(m))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// L298N module
// ---------------------------------------------------------------------------

/** L298N on a 9 V supply, load resistor between OUT1 and OUT2 (breadboard), IN1/IN2/ENA tied to +5V or GND. */
function l298(in1: 0 | 1, in2: 0 | 1, en: 0 | 1 | 'jumper', load = 100, vs = 9): SimEngine {
  const b = new Bench()
    .psu('PS1', vs)
    .add({ id: 'D1', type: 'l298n_module', params: { jumperEnA: en === 'jumper' } })
    .add({ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: load } })
    .w('PS1:+', 'D1:+12V')
    .w('PS1:-', 'D1:GND')
    .w('D1:OUT1', 'b10')
    .w('D1:OUT2', 'b14')
    .w('D1:IN1', in1 ? 'D1:+5V' : 'D1:GND')
    .w('D1:IN2', in2 ? 'D1:+5V' : 'D1:GND')
  if (en !== 'jumper') b.w('D1:ENA', en ? 'D1:+5V' : 'D1:GND')
  const e = b.engine()
  e.advance(0.02)
  return e
}

describe('L298N module (SimEngine)', () => {
  it('truth table: EN·IN1/IN2 → forward, reverse, brake (both high / both low), EN low = off', () => {
    const v12 = (e: SimEngine) => pv(e, 'D1', 'OUT1') - pv(e, 'D1', 'OUT2')
    const fwd = l298(1, 0, 'jumper')
    expect(values(fwd, 'D1').logic).toBe(1)
    expect(values(fwd, 'D1').vss).toBeCloseTo(5, 1) // 78M05 behind the 5V-EN jumper
    expect(v12(fwd)).toBeGreaterThan(6.5)
    expect(v12(fwd)).toBeLessThan(8.2)
    expect(v12(l298(0, 1, 'jumper'))).toBeLessThan(-6.5)
    expect(Math.abs(v12(l298(1, 1, 'jumper')))).toBeLessThan(0.05)
    expect(Math.abs(v12(l298(0, 0, 'jumper')))).toBeLessThan(0.05)
    // enable driven by a pin (jumper removed)
    expect(v12(l298(1, 0, 1))).toBeGreaterThan(6.5)
    const off = l298(1, 0, 0)
    expect(Math.abs(v12(off))).toBeLessThan(0.05)
    expect(Math.abs(values(off, 'D1').ia)).toBeLessThan(1e-3)
  })

  it('Darlington drops: ≈ 2.5 V total at 1 A (datasheet VCEsat(H) + VCEsat(L) typ 1.35 + 1.2 V)', () => {
    const e = l298(1, 0, 'jumper', 6.5)
    const ia = values(e, 'D1').ia
    const drop = 9 - (pv(e, 'D1', 'OUT1') - pv(e, 'D1', 'OUT2'))
    expect(ia).toBeGreaterThan(0.9)
    expect(ia).toBeLessThan(1.1)
    expect(drop).toBeGreaterThan(2.3)
    expect(drop).toBeLessThan(2.8)
  })

  it('without the 5V-EN jumper and no +5V feed the bridges stay off (warning); a driven EN against its jumper is flagged', () => {
    const b = new Bench()
      .psu('PS1', 9)
      .add({ id: 'D1', type: 'l298n_module', params: { jumper5v: false } })
      .add({ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 100 } })
      .w('PS1:+', 'D1:+12V')
      .w('PS1:-', 'D1:GND')
      .w('D1:OUT1', 'b10')
      .w('D1:OUT2', 'b14')
      .w('D1:IN1', 'D1:+12V')
    const e = b.engine()
    e.advance(0.01)
    expect(values(e, 'D1').logic).toBe(0)
    expect(Math.abs(values(e, 'D1').ia)).toBeLessThan(1e-3)
    expect(issues(e).some((m) => /D1: logic supply \+5V is 0\.0 V — fit the 5V-EN jumper/.test(m))).toBe(true)

    // an output (≈ 25 Ω, like an MCU pin driving low) fighting the fitted ENA jumper
    const j = new Bench()
      .psu('PS1', 9)
      .add({ id: 'D1', type: 'l298n_module' })
      .add({ id: 'R1', type: 'resistor', holes: ['a20', 'a22'], params: { resistance: 25 } })
      .w('PS1:+', 'D1:+12V')
      .w('PS1:-', 'D1:GND')
      .w('D1:ENA', 'b20')
      .w('b22', 'D1:GND')
      .engine()
    j.advance(0.01)
    expect(issues(j).some((m) => /D1: ENA is driven while its jumper ties it to \+5V/.test(m))).toBe(true)
  })

  it('drives a 130 motor: speed = (VS − drops − I·R) / Ke', () => {
    const e = new Bench()
      .psu('PS1', 7.5)
      .add({ id: 'D1', type: 'l298n_module' })
      .add({ id: 'M1', type: 'dc_motor' })
      .w('PS1:+', 'D1:+12V')
      .w('PS1:-', 'D1:GND')
      .w('D1:IN1', 'D1:+5V')
      .w('D1:IN2', 'D1:GND')
      .w('D1:OUT1', 'M1:M+')
      .w('D1:OUT2', 'M1:M-')
      .engine()
    e.advance(0.4)
    const m = values(e, 'M1')
    expect(m.voltage).toBeGreaterThan(5.5)
    expect(m.voltage).toBeLessThan(6.4) // 7.5 V − ≈ 1.4 V at 0.12 A
    expect(m.rpm / (dcSteadySpeed(DC_MOTOR_130, m.voltage) * RPM)).toBeCloseTo(1, 2)
  })
})

// ---------------------------------------------------------------------------
// TB6612FNG breakout
// ---------------------------------------------------------------------------

describe('TB6612FNG breakout (SimEngine)', () => {
  const U1: ComponentInstance = { id: 'U1', type: 'tb6612fng_module', at: 'h40' }
  function tb(ain1: 0 | 1, ain2: 0 | 1, pwm: 0 | 1, stby: 0 | 1, vcc = 3.3): SimEngine {
    const b = new Bench()
      .psu('PS1', 6)
      .psu('PS2', vcc)
      .add(U1)
      .add({ id: 'R1', type: 'resistor', holes: [hole2Of(U1, 'AO1'), hole2Of(U1, 'AO2')], params: { resistance: 20 } })
      .w('PS1:+', holeOf(U1, 'VM'))
      .w('PS2:+', holeOf(U1, 'VCC'))
      .w('PS1:-', holeOf(U1, 'GND'))
      .w('PS2:-', 'top-0')
      .w('PS1:-', 'top-1')
      .w('PS2:+', 'top+0')
    const tie = (pin: string, level: 0 | 1, k: number) => b.w(holeOf(U1, pin), level ? `top+${k}` : `top-${k}`)
    tie('AIN1', ain1, 3)
    tie('AIN2', ain2, 4)
    tie('PWMA', pwm, 5)
    tie('STBY', stby, 6)
    const e = b.engine()
    e.advance(0.01)
    return e
  }
  const vout = (e: SimEngine) => pv(e, 'U1', 'AO1') - pv(e, 'U1', 'AO2')

  it('truth table: CW / CCW / short brake / stop / standby with the 0.5 Ω MOSFET bridge', () => {
    // CW: VM across 20 Ω behind 2 × 0.25 Ω
    expect(vout(tb(1, 0, 1, 1))).toBeCloseTo((6 * 20) / 20.5, 1)
    expect(vout(tb(0, 1, 1, 1))).toBeCloseTo((-6 * 20) / 20.5, 1)
    for (const [a, b2, p, s] of [
      [1, 1, 1, 1], // short brake
      [1, 0, 0, 1], // PWM low = short brake
      [0, 0, 1, 1], // stop
      [1, 0, 1, 0], // standby
    ] as const) {
      const e = tb(a, b2, p, s)
      expect(Math.abs(vout(e)), `${a}${b2}${p}${s}`).toBeLessThan(0.02)
      expect(Math.abs(values(e, 'U1').ia), `${a}${b2}${p}${s}`).toBeLessThan(1e-3)
    }
    expect(values(tb(1, 0, 1, 0), 'U1').standby).toBe(1)
  })

  it('VM without VCC: the logic is off and the missing supply is reported', () => {
    const e = tb(1, 0, 1, 1, 0)
    expect(Math.abs(vout(e))).toBeLessThan(0.02)
    expect(issues(e).some((m) => /U1: VM is powered but VCC is not/.test(m))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DRV8833 breakout
// ---------------------------------------------------------------------------

describe('DRV8833 breakout (SimEngine)', () => {
  const U1: ComponentInstance = { id: 'U1', type: 'drv8833_module', at: 'g50' }
  function drv(ain1: 0 | 1, ain2: 0 | 1, slp: 0 | 1, load = 20): SimEngine {
    const b = new Bench()
      .psu('PS1', 5)
      .psu('PS2', 3.3)
      .add(U1)
      .add({ id: 'R1', type: 'resistor', holes: [hole2Of(U1, 'AOUT1'), hole2Of(U1, 'AOUT2')], params: { resistance: load } })
      // nFAULT open drain: 10 kΩ pull-up to 3.3 V
      .add({ id: 'R2', type: 'resistor', holes: [hole2Of(U1, 'FLT'), 'i58'], params: { resistance: 10000 } })
      .w('PS1:+', holeOf(U1, 'VM'))
      .w('PS1:-', holeOf(U1, 'GND'))
      .w('PS2:+', 'j58')
      .w('PS2:-', 'PS1:-')
      .w('PS2:+', 'bot+0')
      .w('PS1:-', 'bot-0')
    const tie = (pin: string, level: 0 | 1, k: number) => b.w(holeOf(U1, pin), level ? `bot+${k}` : `bot-${k}`)
    tie('SLP', slp, 2)
    tie('AIN1', ain1, 3)
    tie('AIN2', ain2, 4)
    return b.engine()
  }
  const vout = (e: SimEngine) => pv(e, 'U1', 'AOUT1') - pv(e, 'U1', 'AOUT2')

  it('forward / reverse / brake / coast; nSLEEP low = off; the bridges start 1 ms after waking', () => {
    const f = drv(1, 0, 1)
    f.advance(0.0005)
    expect(Math.abs(vout(f))).toBeLessThan(0.02) // still in t_WAKE
    f.advance(0.002)
    expect(vout(f)).toBeCloseTo((5 * 20) / 20.36, 1)
    const r = drv(0, 1, 1)
    r.advance(0.003)
    expect(vout(r)).toBeCloseTo((-5 * 20) / 20.36, 1)
    for (const [a, b2, s] of [
      [1, 1, 1],
      [0, 0, 1],
      [1, 0, 0],
    ] as const) {
      const e = drv(a, b2, s)
      e.advance(0.003)
      expect(Math.abs(vout(e)), `${a}${b2}${s}`).toBeLessThan(0.02)
    }
  })

  it('over-current protection: a shorted output trips after 4 µs, nFAULT pulls low, retries after 1.35 ms', () => {
    const e = drv(1, 0, 1, 0.05)
    e.advance(0.0012, 1e-5)
    // tripped: outputs off, FLT low through the pull-up, warning raised
    let sawFault = false
    let sawLow = false
    for (let k = 0; k < 200; k++) {
      e.step(1e-5)
      if (values(e, 'U1').fault === 1) sawFault = true
      if (pv(e, 'U1', 'FLT') < 0.5) sawLow = true
    }
    expect(sawFault).toBe(true)
    expect(sawLow).toBe(true)
    expect(issues(e).some((m) => /U1: over-current on bridge A \(\d+\.\d\d A > 3\.3 A\) — outputs disabled, nFAULT low, retry after 1\.35 ms/.test(m))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ULN2003 board + 28BYJ-48
// ---------------------------------------------------------------------------

describe('ULN2003 board with a 28BYJ-48 (SimEngine)', () => {
  it('a high input sinks its winding through the Darlington (≈ 0.9 V), lights its LED, and the rotor aligns', () => {
    const e = new Bench()
      .psu('PS1', 5)
      .add({ id: 'D1', type: 'uln2003_board' })
      .add({ id: 'M1', type: 'stepper_28byj48' })
      .w('PS1:+', 'D1:VCC')
      .w('PS1:-', 'D1:GND')
      .w('D1:IN1', 'D1:VCC')
      .w('D1:IN2', 'D1:GND')
      .w('D1:OUT1', 'M1:ORANGE')
      .w('D1:OUT2', 'M1:YELLOW')
      .w('D1:OUT3', 'M1:PINK')
      .w('D1:OUT4', 'M1:BLUE')
      .w('M1:RED', 'D1:VCC')
      .engine()
    e.advance(0.2)
    const t = e.telemetry().components.D1
    expect(t.pinVoltages.OUT1).toBeGreaterThan(0.7)
    expect(t.pinVoltages.OUT1).toBeLessThan(1.15)
    expect(t.pinVoltages.OUT2).toBeGreaterThan(4.5) // off: pulled up by its winding
    expect(t.leds!.A).toBeGreaterThan(0.15)
    expect(t.leds!.B).toBe(0)
    const m = values(e, 'M1')
    expect(m.iA).toBeGreaterThan(0.07)
    expect(m.iA).toBeLessThan(0.09) // (5 − 0.9) / 50 Ω
    // phase A alone holds the rotor at a full-step position (0 = ORANGE)
    expect(Math.abs(m.position)).toBeLessThan(0.05)
    expect(m.rpm).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// StepStick drivers + NEMA 17
// ---------------------------------------------------------------------------

interface StepRig {
  e: SimEngine
  U1: ComponentInstance
}

/**
 * A StepStick carrier at g40 with a NEMA 17, VMOT 12 V, logic 3.3 V,
 * STEP from a function generator (0 … 3.3 V square at `freq`), DIR high;
 * `tie` = extra pins tied high (3.3 V) / low.
 */
function stepRig(type: string, freq: number, high: string[], low: string[], extra?: (b: Bench, U1: ComponentInstance) => void): StepRig {
  const U1: ComponentInstance = { id: 'U1', type, at: 'g40' }
  const e = CATALOG[type]
  const pin = (role: string): string => {
    const map: Record<string, Record<string, string>> = {
      a4988_driver: { vm: 'VMOT', gnd: 'GND', vdd: 'VDD', a1: '1A', a2: '1B', b1: '2A', b2: '2B' },
      drv8825_driver: { vm: 'VMOT', gnd: 'GND', vdd: '', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2' },
      tmc2209_driver: { vm: 'VM', gnd: 'GND', vdd: 'VIO', a1: 'M1A', a2: 'M1B', b1: 'M2A', b2: 'M2B' },
    }
    return map[type][role]
  }
  const b = new Bench()
    .psu('PS1', 12)
    .psu('PS2', 3.3)
    .add(U1)
    .add({ id: 'M1', type: 'nema17_stepper' })
    .add({ id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: freq, amplitude: 1.65, offset: 1.65 } })
    .w('PS1:+', holeOf(U1, pin('vm')))
    .w('PS1:-', holeOf(U1, pin('gnd')))
    .w('PS2:-', 'PS1:-')
    .w('FG1:gnd', 'PS1:-')
    .w('PS2:+', 'top+0')
    .w('PS1:-', 'top-0')
    .w('PS2:+', 'bot+0')
    .w('PS1:-', 'bot-0')
    .w(holeOf(U1, pin('a1')), 'M1:A+')
    .w(holeOf(U1, pin('a2')), 'M1:A-')
    .w(holeOf(U1, pin('b1')), 'M1:B+')
    .w(holeOf(U1, pin('b2')), 'M1:B-')
    .w('FG1:out', holeOf(U1, 'STEP'))
    .w(holeOf(U1, 'DIR'), 'bot+1')
  if (pin('vdd')) b.w('PS2:+', holeOf(U1, pin('vdd')))
  high.forEach((p, k) => b.w(holeOf(U1, p), `bot+${k + 3}`))
  low.forEach((p, k) => b.w(holeOf(U1, p), `bot-${k + 3}`))
  extra?.(b, U1)
  expect(e).toBeDefined()
  return { e: b.engine(), U1 }
}

describe('StepStick drivers with a NEMA 17 (SimEngine, STEP from a function generator)', () => {
  it('A4988 1/16: position = pulses / 16, the rotor follows (home 45° = ½ full step), winding current = Vref / 0.544 Ω', () => {
    const { e } = stepRig('a4988_driver', 400, ['MS1', 'MS2', 'MS3'], [], (b, U1) => b.w(hole2Of(U1, 'RST'), hole2Of(U1, 'SLP')))
    e.advance(0.25)
    const d = values(e, 'U1')
    expect(d.pulses).toBeGreaterThanOrEqual(99)
    expect(d.pulses).toBeLessThanOrEqual(101)
    expect(d.microstep).toBe(16)
    expect(d.position).toBeCloseTo(d.pulses / 16, 9)
    expect(d.iFull).toBeCloseTo(0.5 / (8 * 0.068), 6)
    e.advance(0.05) // settle after the last edge
    const m = values(e, 'M1')
    expect(m.position - values(e, 'U1').position).toBeGreaterThan(0.4)
    expect(m.position - values(e, 'U1').position).toBeLessThan(0.6)
    // the regulated winding current follows the sine table
    const peak = Math.max(Math.abs(values(e, 'U1').iA), Math.abs(values(e, 'U1').iB))
    expect(peak).toBeGreaterThan(0.7 * d.iFull)
    expect(peak).toBeLessThan(1.05 * d.iFull)
  })

  it('A4988 with RESET left floating stays in reset: no steps, outputs off (wrong-wiring symptom)', () => {
    const { e } = stepRig('a4988_driver', 400, [], [])
    e.advance(0.1)
    const d = values(e, 'U1')
    expect(d.position).toBe(0)
    expect(d.enabled).toBe(0)
    expect(Math.abs(d.iA) + Math.abs(d.iB)).toBeLessThan(1e-3)
  })

  it('A4988 with VDD = 5 V cannot see a 3.3 V STEP (VIH = 0.7·VDD): no steps, the threshold warning names it', () => {
    const bad = new Bench()
    const U1: ComponentInstance = { id: 'U1', type: 'a4988_driver', at: 'g40' }
    bad
      .psu('PS1', 12)
      .psu('PS2', 5)
      .add(U1)
      .add({ id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 400, amplitude: 1.65, offset: 1.65 } })
      .w('PS1:+', holeOf(U1, 'VMOT'))
      .w('PS1:-', holeOf(U1, 'GND'))
      .w('PS2:+', holeOf(U1, 'VDD'))
      .w('PS2:-', 'PS1:-')
      .w('FG1:gnd', 'PS1:-')
      .w('FG1:out', holeOf(U1, 'STEP'))
      .w(hole2Of(U1, 'RST'), hole2Of(U1, 'SLP'))
    const be = bad.engine()
    be.advance(0.05)
    expect(values(be, 'U1').position).toBe(0)
    expect(issues(be).some((m) => /U1: STEP sits at 3\.3 V — between the A4988's input thresholds \(0\.3·VDD … 0\.7·VDD with VDD = 5\.0 V\)/.test(m))).toBe(true)
  })

  it('DRV8825 M0/M2 high = 1/32 (RST and SLP driven high), the motor follows', () => {
    const { e } = stepRig('drv8825_driver', 400, ['M0', 'M2', 'RST', 'SLP'], [])
    e.advance(0.25)
    const d = values(e, 'U1')
    expect(d.microstep).toBe(32)
    expect(d.pulses).toBeGreaterThanOrEqual(99)
    expect(d.position).toBeCloseTo(d.pulses / 32, 9)
    e.advance(0.05)
    // the detent torque pulls the rotor up to ≈ 0.1 step off the 1/32 grid (microstep error)
    expect(values(e, 'M1').position - values(e, 'U1').position).toBeGreaterThan(0.35)
    expect(values(e, 'M1').position - values(e, 'U1').position).toBeLessThan(0.65)
  })

  it('TMC2209 standalone MS1 = MS2 = low = 1/8, interpolated; UART activity is reported as not simulated', () => {
    const { e } = stepRig('tmc2209_driver', 400, [], ['EN'])
    e.advance(0.25)
    const d = values(e, 'U1')
    expect(d.microstep).toBe(8)
    expect(d.position).toBeCloseTo(d.pulses / 8, 9)
    e.advance(0.05)
    expect(values(e, 'M1').position - values(e, 'U1').position).toBeGreaterThan(-0.1)
    expect(values(e, 'M1').position - values(e, 'U1').position).toBeLessThan(0.1) // home 0°
    const u = stepRig('tmc2209_driver', 400, [], ['EN'], (b, U1) => b.w('FG1:out', hole2Of(U1, 'UART')))
    u.e.advance(0.02)
    expect(issues(u.e).some((m) => /U1: activity on PDN_UART — the TMC2209 UART register interface is not simulated/.test(m))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SG90
// ---------------------------------------------------------------------------

describe('SG90 servo (SimEngine)', () => {
  it('a 1.25 ms pulse train moves the horn to 67.5° at ≈ 0.1 s/60° and holds; VCC carries the motor current', () => {
    const e = new Bench()
      .psu('PS1', 4.8)
      .add({ id: 'S1', type: 'sg90_servo' })
      .add({ id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 400, amplitude: 1.65, offset: 1.65 } })
      .w('PS1:+', 'S1:VCC')
      .w('PS1:-', 'S1:GND')
      .w('FG1:gnd', 'PS1:-')
      .w('FG1:out', 'S1:SIG')
      .engine()
    expect(values(e, 'S1').angle ?? 90).toBeCloseTo(90, 6)
    let maxI = 0
    let tArrive = -1
    for (let k = 0; k < 120; k++) {
      e.advance(0.0025)
      const v = values(e, 'S1')
      maxI = Math.max(maxI, v.current)
      if (tArrive < 0 && Math.abs(v.angle - 67.5) < 1) tArrive = e.time
    }
    const v = values(e, 'S1')
    expect(v.pulseUs).toBeCloseTo(1250, -1)
    expect(v.target).toBeCloseTo(67.5, 6)
    expect(v.angle).toBeCloseTo(67.5, 0)
    // 22.5° at 0.1 s/60° ≈ 38 ms (+ ramp-in of the proportional band)
    expect(tArrive).toBeGreaterThan(0.03)
    expect(tArrive).toBeLessThan(0.075)
    expect(maxI).toBeGreaterThan(0.2)
    expect(v.current).toBeLessThan(0.02) // holding at the target: only the electronics
    // pulses stop: the last position is held (documented limit)
    e.setRuntimeParam('FG1', 'amplitude', 0 as ParamValue)
    e.setRuntimeParam('FG1', 'offset', 0 as ParamValue)
    e.advance(0.2)
    expect(values(e, 'S1').angle).toBeCloseTo(67.5, 0)
  })

  it('a pulse outside 0.3–3 ms is ignored and reported', () => {
    const e = new Bench()
      .psu('PS1', 5)
      .add({ id: 'S1', type: 'sg90_servo' })
      .add({ id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 50, amplitude: 1.65, offset: 1.65 } })
      .w('PS1:+', 'S1:VCC')
      .w('PS1:-', 'S1:GND')
      .w('FG1:gnd', 'PS1:-')
      .w('FG1:out', 'S1:SIG')
      .engine()
    e.advance(0.1)
    expect(values(e, 'S1').angle).toBeCloseTo(90, 6)
    expect(issues(e).some((m) => /S1: SIG pulse of 10\.00 ms ignored — a servo expects 0\.5–2\.5 ms pulses about every 20 ms/.test(m))).toBe(true)
  })
})
