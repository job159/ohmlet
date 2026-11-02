/**
 * Sensors family — simulation models for src/model/parts/sensors.parts.ts.
 *
 * Logic-level devices (src/sim/digital/api.ts), each a protocol state
 * machine driven only by its pin edges and virtual-time events:
 *   mpu6050  (sensors-mpu6050.ts)  I²C register map, sample clock, FIFO, INT
 *   bmp280 / bme280 (sensors-bmx280.ts)  I²C, trimming NVM, inverted Bosch
 *            compensation, forced / normal mode timing
 *   bh1750   (sensors-bh1750.ts)   I²C opcodes, measurement timing
 *   dht11 / dht22 (sensors-dht.ts) single-wire start / response / 40-bit frame
 *   ds18b20  (sensors-ds18b20.ts)  1-Wire reset / presence / slots, ROM and
 *            function commands, conversion timing, CRC8
 *   hcsr04, ky040, a3144, vs1838b (sensors-misc.ts)
 *
 * Analog (MNA) devices, defined here:
 *   sensors_joystick  KY-023: two 10 kΩ potentiometers + push switch
 *   sensors_acs712    ACS712ELCTR-05B: 1.2 mΩ primary conductor measuring its
 *                     own current, ratiometric Hall output (VCC/2 + 185 mV/A)
 *   sensors_passive   host for modules whose whole circuit is their
 *                     CatalogEntry.subcircuit (the voltage divider module)
 *
 * Environment inputs are catalog params with runtime: true; the inspector
 * edits them and setParam / setRuntimeParam apply them. Nothing here plays
 * back canned data: every output follows from the inputs, the registers the
 * firmware wrote and the pin edges it made.
 */
import { registerDigitalDevice } from '../digital/api'
import { BaseDevice, bookBranch, G_OFF, G_ON, registerDevice } from '../devices'
import type { StampContext } from '../mna'
import type { ComponentInstance, ComponentTelemetry, ParamValue, SimIssue } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import { Mpu6050 } from './sensors-mpu6050'
import { Bmx280 } from './sensors-bmx280'
import { Bh1750 } from './sensors-bh1750'
import { DhtSensor } from './sensors-dht'
import { Ds18b20 } from './sensors-ds18b20'
import { A3144, Hcsr04, Ky040, Vs1838b } from './sensors-misc'
import { boolParam, numParam } from './sensors-i2c'

function vAt(x: Float64Array, node: number): number {
  return node >= 0 ? x[node] : 0
}

// ================================================================ joystick

/** KY-023 potentiometer value (Ω) and the end resistance of each half. */
export const JOYSTICK_R = 10000
const POT_END_R = 0.5

/**
 * Pins [GND, VCC, VRX, VRY, SW]: each axis is a potentiometer from VCC to
 * GND with its wiper on VRX / VRY at fraction 0.5 + pos/200 of the track
 * from the GND end (pos −100…100 %); SW is a contact to GND.
 */
class JoystickDevice extends BaseDevice {
  private x: number
  private y: number
  private pressed: boolean
  private vx = 0
  private vy = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.x = this.num('x', 0)
    this.y = this.num('y', 0)
    this.pressed = this.bool('pressed', false)
  }

  private static wiper(pos: number): number {
    return Math.min(1, Math.max(0, 0.5 + pos / 200))
  }

  private stampPot(ctx: StampContext, wiper: number, pos: number): void {
    const [gnd, vcc] = this.nodes
    const w = JoystickDevice.wiper(pos)
    ctx.addConductance(vcc, wiper, 1 / (JOYSTICK_R * (1 - w) + POT_END_R))
    ctx.addConductance(wiper, gnd, 1 / (JOYSTICK_R * w + POT_END_R))
  }

  stamp(ctx: StampContext): void {
    this.stampPot(ctx, this.nodes[2], this.x)
    this.stampPot(ctx, this.nodes[3], this.y)
    ctx.addConductance(this.nodes[4], this.nodes[0], this.pressed ? G_ON : G_OFF)
  }

  /** every track half and the SW contact on their own pins (two pins tied to one net) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    for (const [wiper, pos] of [
      [2, this.x],
      [3, this.y],
    ]) {
      const w = JoystickDevice.wiper(pos)
      bookBranch(out, off, this.nodes, x, 1, wiper, 1 / (JOYSTICK_R * (1 - w) + POT_END_R))
      bookBranch(out, off, this.nodes, x, wiper, 0, 1 / (JOYSTICK_R * w + POT_END_R))
    }
    bookBranch(out, off, this.nodes, x, 4, 0, this.pressed ? G_ON : G_OFF)
  }

  endStep(x: Float64Array): void {
    const g = vAt(x, this.nodes[0])
    this.vx = vAt(x, this.nodes[2]) - g
    this.vy = vAt(x, this.nodes[3]) - g
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'x') this.x = Math.min(100, Math.max(-100, numParam(value, this.x)))
    else if (key === 'y') this.y = Math.min(100, Math.max(-100, numParam(value, this.y)))
    else if (key === 'pressed') this.pressed = boolParam(value, this.pressed)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.pressed = this.pressed
    t.values = { x: this.x, y: this.y, vrx: this.vx, vry: this.vy, pressed: this.pressed ? 1 : 0 }
  }
}

// ================================================================ ACS712

/** ACS712ELCTR-05B: primary conductor resistance (Ω), sensitivity (V/A at VCC = 5 V), supply current (A), output resistance (Ω). */
export const ACS712_RP = 1.2e-3
export const ACS712_SENS = 0.185
export const ACS712_ICC = 10e-3
export const ACS712_ROUT = 1
const ACS712_K = ACS712_SENS / 5
const NO_ISSUES: readonly SimIssue[] = []

/**
 * Pins [VCC, OUT, GND, IP+, IP−]. OUT is a controlled source:
 *   Vout = Vgnd + (Vcc − Vgnd) · (0.5 + 0.037 · I),  I = (V(IP+) − V(IP−)) / 1.2 mΩ
 * (ratiometric: 185 mV/A at 5 V), behind 1 Ω, clamped to the rails;
 * linearized per Newton iteration.
 */
class Acs712Device extends BaseDevice {
  readonly nonlinear: boolean = true
  private i = 0
  private vout = 0
  private vcc = 0
  private issued = new Set<string>()
  private fresh: SimIssue[] = []

  stamp(ctx: StampContext, x: Float64Array): void {
    const [c, o, g, p, m] = this.nodes
    const gp = 1 / ACS712_RP
    ctx.addConductance(p, m, gp)
    ctx.addConductance(c, g, ACS712_ICC / 5)
    const vc = vAt(x, c)
    const vg = vAt(x, g)
    const d = vAt(x, p) - vAt(x, m)
    const u = vc - vg
    const s = 0.5 + ACS712_K * gp * d
    let vt = vg + u * s
    // partials of vt wrt [c, g, p, m]
    let jc = s
    let jg = 1 - s
    let jp = u * ACS712_K * gp
    let jm = -jp
    if (vt > vc) {
      vt = vc
      jc = 1
      jg = 0
      jp = 0
      jm = 0
    } else if (vt < vg) {
      vt = vg
      jc = 0
      jg = 1
      jp = 0
      jm = 0
    }
    const go = 1 / ACS712_ROUT
    const ctrl: [number, number][] = [
      [c, jc],
      [g, jg],
      [p, jp],
      [m, jm],
    ]
    let rhs = vt
    for (const [n, j] of ctrl) rhs -= j * vAt(x, n)
    const l = this.lin
    l[0] = jc
    l[1] = jg
    l[2] = jp
    l[3] = jm
    l[4] = rhs
    // i_out = go·(vt(x) − Vout) injected into OUT, returned through GND
    ctx.addElement(o, o, go)
    ctx.addElement(g, o, -go)
    for (const [n, j] of ctrl) {
      if (j === 0) continue
      ctx.addElement(o, n, -go * j)
      ctx.addElement(g, n, go * j)
    }
    ctx.addCurrent(o, go * rhs)
    ctx.addCurrent(g, -go * rhs)
  }

  /** last stamp's linearization of vt: ∂/∂[VCC, GND, IP+, IP−] and the constant */
  private readonly lin = new Float64Array(5)

  /**
   * Pins [VCC, OUT, GND, IP+, IP−], each branch on its own pins (IP− and
   * GND both on 0 V — sensing the low side): the primary conductor, the
   * supply current and the output source of the last stamp at x.
   */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const n = this.nodes
    bookBranch(out, off, n, x, 3, 4, 1 / ACS712_RP)
    bookBranch(out, off, n, x, 0, 2, ACS712_ICC / 5)
    const l = this.lin
    const go = 1 / ACS712_ROUT
    // into OUT: go·(Vout − vt(x)); the same current leaves through GND
    const vt = l[0] * vAt(x, n[0]) + l[1] * vAt(x, n[2]) + l[2] * vAt(x, n[3]) + l[3] * vAt(x, n[4]) + l[4]
    const i = go * (vAt(x, n[1]) - vt)
    out[off + 1] += i
    out[off + 2] -= i
  }

  endStep(x: Float64Array): void {
    const [c, o, g, p, m] = this.nodes
    this.i = (vAt(x, p) - vAt(x, m)) / ACS712_RP
    this.vout = vAt(x, o) - vAt(x, g)
    this.vcc = vAt(x, c) - vAt(x, g)
    if (this.vcc > 0.5 && (this.vcc < 4.5 || this.vcc > 5.5)) {
      this.raise('vcc', `ACS712 supply ${this.vcc.toFixed(2)} V is outside 4.5–5.5 V: output zero point and sensitivity are not specified there`)
    }
    if (Math.abs(this.i) > 5) {
      this.raise('range', `ACS712 current ${this.i.toFixed(2)} A exceeds its ±5 A range`)
    }
  }

  private raise(key: string, message: string): void {
    if (this.issued.has(key)) return
    this.issued.add(key)
    this.fresh.push({ level: 'warning', message: `${this.comp.id}: ${message}` })
  }

  issues(): readonly SimIssue[] {
    if (this.fresh.length === 0) return NO_ISSUES
    const out = this.fresh
    this.fresh = []
    return out
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.values = { current: this.i, vout: this.vout, vcc: this.vcc }
  }
}

// ================================================================ passive host

/** A module whose whole circuit is its sub-circuit (stamps nothing itself). */
class PassiveModuleDevice extends BaseDevice {
  stamp(): void {}
}

// ================================================================ registration

registerDigitalDevice('mpu6050', (comp) => new Mpu6050(comp))
registerDigitalDevice('bmp280', (comp) => new Bmx280(false, comp))
registerDigitalDevice('bme280', (comp) => new Bmx280(true, comp))
registerDigitalDevice('bh1750', (comp) => new Bh1750(comp))
registerDigitalDevice('dht11', (comp) => new DhtSensor('dht11', comp))
registerDigitalDevice('dht22', (comp) => new DhtSensor('dht22', comp))
registerDigitalDevice('ds18b20', (comp) => new Ds18b20(comp.id, comp))
registerDigitalDevice('hcsr04', (comp) => new Hcsr04(comp))
registerDigitalDevice('ky040', (comp) => new Ky040(comp))
registerDigitalDevice('a3144', (comp) => new A3144(comp))
registerDigitalDevice('vs1838b', (comp) => new Vs1838b(comp))

registerDevice('sensors_joystick', (c, e, n) => new JoystickDevice(c, e, n))
registerDevice('sensors_acs712', (c, e, n) => new Acs712Device(c, e, n))
registerDevice('sensors_passive', (c, e, n) => new PassiveModuleDevice(c, e, n))
