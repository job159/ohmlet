/**
 * Motors & drivers family: simulation models for the parts in
 * src/model/parts/motors.parts.ts. Owned by the motors & drivers engineer.
 *
 * Architecture (see ./motors-common.ts): every part is the chip
 * 'motors_part' + a sub-circuit holding ONE family device (registered here
 * with registerDevice) and the module's ordinary on-board parts (diodes,
 * regulator, LEDs, resistors, the ULN2003A Darlington transistors …).
 * Everything an MCU does to a motor travels through pins and the MNA
 * solver: driver inputs are read from the solved node voltages after every
 * analog step (an MCU edge on an analog net ends the step exactly at the
 * edge, so a STEP pulse or a PWM edge is seen at its real time), output
 * stages are switches between the driver's own supply pins and its outputs,
 * and motors are armature/winding companions with back-EMF whose rotor
 * equations integrate with the analog step.
 *
 * Models:
 *  'motor_dc'       brushed DC motor (./motors-mech.ts DcMotor)
 *  'motor_sg90'     TowerPro SG90 micro servo: pulse-width decoder on SIG,
 *                   proportional position loop, motor current drawn from VCC
 *  'motor_stepper'  two-phase stepper windings + rotor (bipolar NEMA 17,
 *                   unipolar 28BYJ-48 with its 64:1 gear train)
 *  'drv_l298n'      L298 dual Darlington H-bridge of the L298N module
 *  'drv_tb6612'     Toshiba TB6612FNG dual MOSFET H-bridge
 *  'drv_drv8833'    TI DRV8833 dual MOSFET H-bridge
 *  'drv_a4988' …    STEP/DIR stepper drivers on StepStick carriers: Allegro
 *                   A4988, TI DRV8825, Trinamic TMC2209 (standalone)
 *  chip 'motors_part' the part chip (instance params, telemetry)
 * The ULN2003 board needs no family device: its four channels are the
 * ULN2003A's real Darlington pairs (2 × 'npn' + 2.7 kΩ / 7.2 kΩ / 3 kΩ),
 * clamp diodes and LED indicators as sub-circuit elements.
 */
import type { ComponentInstance, ComponentTelemetry, ParamValue } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import { getEntry } from '../../model/catalog'
import type { StampContext } from '../mna'
import { bookBranch, registerDevice } from '../devices'
import type { AnalogDevice } from '../devices'
import { registerChip } from '../chip-api'
import type { ChipInstance, ChipStepCtx } from '../chip-api'
import { LogicInput, MOTORS_PART_CHIP, MotorsDevice, Winding, clamp, vAt } from './motors-common'
import { DarlingtonLeg, FetLeg, RegulatedBridge } from './motors-bridge'
import {
  BYJ48,
  BYJ48_L,
  BYJ48_R,
  DC_MOTOR_130,
  DcMotor,
  NEMA17,
  NEMA17_L,
  NEMA17_R,
  SG90,
  ServoMech,
  StepperRotor,
} from './motors-mech'
import type { StepperParams } from './motors-mech'

const DEG = 180 / Math.PI
const G_ON = 20
const G_OFF = 1e-9

/** wrap an angle in degrees to [0, 360) */
function wrapDeg(rad: number): number {
  const d = (rad * DEG) % 360
  return d < 0 ? d + 360 : d
}

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '?'
}

// =================================================================== DC motor

/**
 * Brushed DC motor, element pins [M+, M−]: armature R + L + back-EMF with
 * the rotor ODE folded into one backward-Euler companion (DcMotor). A
 * positive M+ − M− voltage turns the shaft clockwise (seen from the shaft).
 * Runtime param `loadTorque` (mN·m) brakes the shaft and holds it at
 * standstill up to its value (a stalled motor draws its stall current).
 */
class DcMotorDevice extends MotorsDevice {
  private readonly m = new DcMotor(DC_MOTOR_130)
  private tLoad = 0
  private v = 0
  private stallTime = 0
  private comp_: { geq: number; ieq: number } = { geq: 0, ieq: 0 }

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.applyParams()
  }

  applyParams(): void {
    this.tLoad = Math.max(0, this.p('loadTorque', 0)) * 1e-3
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    this.comp_ = this.m.prepare(dt, this.tLoad)
  }

  stamp(ctx: StampContext): void {
    const a = this.node('M+')
    const b = this.node('M-')
    ctx.addConductance(a, b, this.comp_.geq)
    ctx.addCurrent(a, -this.comp_.ieq)
    ctx.addCurrent(b, this.comp_.ieq)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const pins = this.entry.pins
    bookBranch(out, off, this.nodes, x, pins.indexOf('M+'), pins.indexOf('M-'), this.comp_.geq, this.comp_.ieq)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.node('M+')) - vAt(x, this.node('M-'))
    this.m.advance(this.v, this.dt, this.tLoad)
    // stall: energized, not turning, drawing (near) stall current for 0.2 s
    const iStall = Math.abs(this.v) / this.m.p.r
    if (this.m.stuck && Math.abs(this.v) > 0.5 && Math.abs(this.m.i) > 0.5 * iStall) {
      this.stallTime += this.dt
      if (this.stallTime > 0.2) {
        this.raiseIssue(
          'stall',
          'warning',
          `${this.partId}: motor stalled — ${fmt(Math.abs(this.m.i))} A through the armature (the load torque exceeds the motor torque)`,
        )
      }
    } else {
      this.stallTime = 0
      if (!this.m.stuck) this.rearm('stall')
    }
  }

  get stalled(): boolean {
    return this.stallTime > 0.05
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.m.i
    t.power = this.v * this.m.i
    t.values = {
      angle: wrapDeg(this.m.theta),
      turns: this.m.theta / (2 * Math.PI),
      rpm: (this.m.w * 60) / (2 * Math.PI),
      current: this.m.i,
      voltage: this.v,
      torque: this.m.p.kt * this.m.i * 1e3,
      stalled: this.stalled ? 1 : 0,
    }
  }
}

// =================================================================== SG90 servo

/** SG90 control electronics quiescent current (A at 4.8 V) */
const SG90_IQ = 6e-3
/** SIG input load (Ω) — the servo amplifier's input; not specified, high impedance */
const SG90_R_SIG = 100e3
/** SIG thresholds (V, relative to the servo GND) — TTL-compatible, accepts 3.3 V logic */
const SG90_VIL = 0.8
const SG90_VIH = 2.0
/** minimum supply for the control IC (V) */
const SG90_VMIN = 3.0
/** pulse width range mapped onto 0–180° (s) */
export const SG90_PULSE_MIN = 0.5e-3
export const SG90_PULSE_MAX = 2.5e-3
/** proportional band of the position loop (rad): full drive outside ±6° */
const SG90_BAND = (6 * Math.PI) / 180
/** dead band (rad): the datasheet's 5 µs ≈ 0.45° */
const SG90_DEADBAND = (0.45 * Math.PI) / 180

/**
 * TowerPro SG90, element pins [GND, VCC, SIG].
 *  - SIG is sampled after every analog step; a HIGH pulse of 0.3–3 ms sets
 *    the target angle, 0.5 ms → 0°, 2.5 ms → 180° (clamped), anything else
 *    is ignored (reported once). No pulses → the last target is held (the
 *    model keeps regulating, like a servo receiving a steady signal).
 *  - Position loop: H-bridge duty u = clamp(error / 6°, −1, 1), 0 inside the
 *    ±0.45° dead band; the motor (ServoMech, SG90 constants) is driven with
 *    u·VCC, so speed and torque scale with the supply (0.1 s/60° at 4.8 V).
 *  - VCC draws the control current plus u·i_motor from the supply — a
 *    moving or stalled servo loads the 5 V rail like the real one.
 */
class Sg90Device extends MotorsDevice {
  readonly nonlinear: boolean = false
  private readonly mech = new ServoMech(SG90, Math.PI / 2)
  private readonly sig = new LogicInput(0)
  private riseT = -1
  private target = NaN
  private pulse = NaN
  private pulses = 0
  private u = 0
  private vcc = 0
  private iSupply = 0
  private g = 0
  private c = 0
  private tLoad = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.applyParams()
  }

  applyParams(): void {
    // N·cm at the horn
    this.tLoad = Math.max(0, this.p('loadTorque', 0)) * 1e-2
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const powered = this.vcc >= SG90_VMIN
    let u = 0
    if (powered && Number.isFinite(this.target)) {
      const e = this.target - this.mech.theta
      if (Math.abs(e) > SG90_DEADBAND) u = clamp(e / SG90_BAND, -1, 1)
    }
    this.u = u
    // supply current I(V) = Iq/4.8·V + max(0, (u²·V − u·Ke·ω)/R), linearized at the last V
    const gq = SG90_IQ / 4.8
    const p = this.mech.p
    const motorAtLast = (u * u * this.vcc - u * p.ke * this.mech.w) / p.r
    if (u !== 0 && motorAtLast > 0) {
      this.g = gq + (u * u) / p.r
      this.c = (-u * p.ke * this.mech.w) / p.r
    } else {
      this.g = gq
      this.c = 0
    }
  }

  stamp(ctx: StampContext): void {
    const gnd = this.node('GND')
    const vcc = this.node('VCC')
    ctx.addConductance(vcc, gnd, this.g)
    ctx.addCurrent(vcc, -this.c)
    ctx.addCurrent(gnd, this.c)
    ctx.addConductance(this.node('SIG'), gnd, 1 / SG90_R_SIG)
  }

  /** the supply branch and the SIG input on their own pins (SIG tied to VCC or GND) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const pins = this.entry.pins
    const gnd = pins.indexOf('GND')
    bookBranch(out, off, this.nodes, x, pins.indexOf('VCC'), gnd, this.g, this.c)
    bookBranch(out, off, this.nodes, x, pins.indexOf('SIG'), gnd, 1 / SG90_R_SIG)
  }

  endStep(x: Float64Array): void {
    const vg = vAt(x, this.node('GND'))
    this.vcc = vAt(x, this.node('VCC')) - vg
    this.iSupply = this.g * this.vcc + this.c
    const powered = this.vcc >= SG90_VMIN
    const vs = vAt(x, this.node('SIG')) - vg
    if (this.sig.update(vs, SG90_VIL, SG90_VIH) && powered) {
      // the change happened inside this step; an MCU edge starts it exactly (t0)
      if (this.sig.level === 1) this.riseT = this.t0
      else if (this.riseT >= 0) {
        const w = this.t0 - this.riseT
        this.riseT = -1
        if (w >= 0.3e-3 && w <= 3.0e-3) {
          this.pulse = w
          this.pulses++
          const f = clamp((w - SG90_PULSE_MIN) / (SG90_PULSE_MAX - SG90_PULSE_MIN), 0, 1)
          this.target = f * Math.PI
        } else {
          this.raiseIssue(
            'pulse',
            'warning',
            `${this.partId}: SIG pulse of ${fmt(w * 1e3)} ms ignored — a servo expects 0.5–2.5 ms pulses about every 20 ms`,
          )
        }
      }
    }
    if (!powered) this.riseT = -1
    this.mech.advance(powered ? this.u : 0, this.vcc, this.tLoad, this.dt)
    if (this.vcc > 6.5) {
      this.raiseIssue('ov', 'warning', `${this.partId}: servo supply ${fmt(this.vcc, 1)} V is above the SG90's 4.8–6 V range`)
    } else if (this.vcc > 0.5 && this.vcc < 4.0 && this.pulses > 0) {
      this.raiseIssue('uv', 'warning', `${this.partId}: servo supply ${fmt(this.vcc, 1)} V is below the SG90's 4.8 V rating — it moves slowly and weakly`)
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iSupply
    t.power = this.iSupply * this.vcc
    t.values = {
      angle: this.mech.theta * DEG,
      target: Number.isFinite(this.target) ? this.target * DEG : -1,
      pulseUs: Number.isFinite(this.pulse) ? this.pulse * 1e6 : 0,
      rpm: (this.mech.w * 60) / (2 * Math.PI),
      current: this.iSupply,
      motorCurrent: this.mech.i,
      moving: this.mech.w !== 0 ? 1 : 0,
      atStop: this.mech.atStop ? 1 : 0,
    }
  }
}

// =================================================================== steppers

interface WindingSpec {
  /** element pin the positive winding current enters */
  a: string
  /** element pin it leaves */
  b: string
  phase: 0 | 1
  sign: 1 | -1
}

interface StepperSpec {
  windings: WindingSpec[]
  rotor: StepperParams
  r: number
  l: number
  /** load torque param unit (N·cm at the output shaft) */
}

/** NEMA 17 bipolar: phase A = coil A+ → A−, phase B = coil B+ → B−. */
const NEMA17_SPEC: StepperSpec = {
  windings: [
    { a: 'A+', b: 'A-', phase: 0, sign: 1 },
    { a: 'B+', b: 'B-', phase: 1, sign: 1 },
  ],
  rotor: NEMA17,
  r: NEMA17_R,
  l: NEMA17_L,
}

/**
 * 28BYJ-48 unipolar: four half-windings from the RED common to each lead;
 * ORANGE / PINK share pole A with opposite sense, YELLOW / BLUE pole B. The
 * datasheet's clockwise sequence ORANGE → YELLOW → PINK → BLUE is A+, B+, A−, B−.
 */
const BYJ48_SPEC: StepperSpec = {
  windings: [
    { a: 'RED', b: 'ORANGE', phase: 0, sign: 1 },
    { a: 'RED', b: 'PINK', phase: 0, sign: -1 },
    { a: 'RED', b: 'YELLOW', phase: 1, sign: 1 },
    { a: 'RED', b: 'BLUE', phase: 1, sign: -1 },
  ],
  rotor: BYJ48,
  r: BYJ48_R,
  l: BYJ48_L,
}

/**
 * Stepper motor windings + rotor. Each winding is R + L + back-EMF
 * (Winding companion, EMF from the rotor state at the step start); the
 * phase currents drive StepperRotor. Runtime param `loadTorque` (N·cm at
 * the output shaft) brakes the shaft (Coulomb-like, holds at standstill).
 */
class StepperDevice extends MotorsDevice {
  readonly rotor: StepperRotor
  private readonly w: Winding[]
  private readonly nA: number[] = []
  private readonly nB: number[] = []
  private tLoad = 0
  iA = 0
  iB = 0

  constructor(
    comp: ComponentInstance,
    entry: CatalogEntry,
    nodes: number[],
    private readonly spec: StepperSpec,
  ) {
    super(comp, entry, nodes)
    this.rotor = new StepperRotor({ ...spec.rotor })
    this.w = spec.windings.map(() => new Winding(spec.r, spec.l))
    for (const ws of spec.windings) {
      this.nA.push(this.node(ws.a))
      this.nB.push(this.node(ws.b))
    }
    this.applyParams()
  }

  applyParams(): void {
    this.tLoad = Math.max(0, this.p('loadTorque', 0)) * 1e-2
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const eA = this.rotor.emfA()
    const eB = this.rotor.emfB()
    for (let k = 0; k < this.w.length; k++) {
      const s = this.spec.windings[k]
      this.w[k].prepare(dt, s.sign * (s.phase === 0 ? eA : eB))
    }
  }

  stamp(ctx: StampContext): void {
    for (let k = 0; k < this.w.length; k++) this.w[k].stamp(ctx, this.nA[k], this.nB[k])
  }

  /** every winding on its own pins (a coil shorted by a wire brakes the rotor) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const pins = this.entry.pins
    for (let k = 0; k < this.w.length; k++) {
      const s = this.spec.windings[k]
      this.w[k].book(out, off, this.nodes, x, pins.indexOf(s.a), pins.indexOf(s.b))
    }
  }

  endStep(x: Float64Array): void {
    let iA = 0
    let iB = 0
    for (let k = 0; k < this.w.length; k++) {
      const wd = this.w[k]
      wd.settle(vAt(x, this.nA[k]) - vAt(x, this.nB[k]))
      const s = this.spec.windings[k]
      if (s.phase === 0) iA += s.sign * wd.i
      else iB += s.sign * wd.i
    }
    this.iA = iA
    this.iB = iB
    this.rotor.advance(iA, iB, this.tLoad, this.dt)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    const r = this.rotor
    let p = 0
    for (const wd of this.w) p += wd.v * wd.i
    t.current = Math.max(Math.abs(this.iA), Math.abs(this.iB))
    t.power = p
    const values: Record<string, number> = {
      angle: wrapDeg(r.outputAngle),
      turns: r.outputAngle / (2 * Math.PI),
      position: r.fullSteps,
      rpm: (r.outputSpeed * 60) / (2 * Math.PI),
      iA: this.iA,
      iB: this.iB,
      rotorAngle: wrapDeg(r.theta),
    }
    this.spec.windings.forEach((s, k) => {
      values[`i_${s.b}`] = this.w[k].i
    })
    t.values = values
  }
}

// =================================================================== L298N

/** L298 logic input thresholds (V): VIL ≤ 1.5, VIH ≥ 2.3 (datasheet) */
const L298_VIL = 1.5
const L298_VIH = 2.3
/** input load: IIH 30–100 µA at a high level → ≈ 50 kΩ */
const L298_R_IN = 50e3
/** logic supply VSS operating minimum (V) */
const L298_VSS_MIN = 4.5
/** quiescent currents: Iss ≈ 15 mA at 5 V, Is ≈ 13 mA at 12 V (datasheet typicals) */
const L298_G_SS = 15e-3 / 5
const L298_G_S = 13e-3 / 12
/** continuous output current per bridge (A) */
const L298_I_MAX = 2

/**
 * L298 dual full bridge of the L298N (HW-095) module. Element pins: the
 * module terminals + '@reg_in' (78M05 input behind the 5V-EN jumper).
 *  - Bridge A: ENA & IN1 → OUT1, ENA & IN2 → OUT2; bridge B likewise. An
 *    enabled output whose IN is high turns its upper Darlington on, low its
 *    lower one; EN low turns both off (the motor current then freewheels
 *    through the module's flyback diodes into +12V — fast decay).
 *  - Inputs are read with the datasheet thresholds against GND; ≈ 50 kΩ
 *    input load. Jumpers (params): ENA / ENB to +5V, 5V-EN connects +12V
 *    to the on-board 78M05 (sub-circuit 'ldo').
 *  - Logic runs while +5V ≥ 4.5 V.
 */
class L298nDevice extends MotorsDevice {
  readonly nonlinear: boolean = true
  private readonly legs: DarlingtonLeg[]
  private readonly inEnA = new LogicInput()
  private readonly inEnB = new LogicInput()
  private readonly ins = [new LogicInput(), new LogicInput(), new LogicInput(), new LogicInput()]
  private jumper5v = true
  private jumperEnA = true
  private jumperEnB = true
  private logicOn = false
  private vs = 0
  private vss = 0
  private ia = 0
  private ib = 0
  private pd = 0
  private noLogicTime = 0
  private overTime = [0, 0]

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const vs = this.node('+12V')
    const gnd = this.node('GND')
    this.legs = ['OUT1', 'OUT2', 'OUT3', 'OUT4'].map((o) => new DarlingtonLeg(this.node(o), vs, gnd))
    this.applyParams()
  }

  applyParams(): void {
    this.jumper5v = this.pb('jumper5v', true)
    this.jumperEnA = this.pb('jumperEnA', true)
    this.jumperEnB = this.pb('jumperEnB', true)
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const on = this.logicOn
    const enA = on && this.inEnA.level === 1
    const enB = on && this.inEnB.level === 1
    const set = (leg: DarlingtonLeg, en: boolean, inp: LogicInput) => {
      leg.hi = en && inp.level === 1 ? 1 : 0
      leg.lo = en && inp.level === 0 ? 1 : 0
    }
    set(this.legs[0], enA, this.ins[0])
    set(this.legs[1], enA, this.ins[1])
    set(this.legs[2], enB, this.ins[2])
    set(this.legs[3], enB, this.ins[3])
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const gnd = this.node('GND')
    const v5 = this.node('+5V')
    ctx.addConductance(this.node('ENA'), v5, this.jumperEnA ? G_ON : G_OFF)
    ctx.addConductance(this.node('ENB'), v5, this.jumperEnB ? G_ON : G_OFF)
    ctx.addConductance(this.node('+12V'), this.node('@reg_in'), this.jumper5v ? G_ON : G_OFF)
    for (const p of ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']) ctx.addConductance(this.node(p), gnd, 1 / L298_R_IN)
    ctx.addConductance(v5, gnd, L298_G_SS)
    if (this.logicOn) ctx.addConductance(this.node('+12V'), gnd, L298_G_S)
    let lim = false
    for (const leg of this.legs) if (leg.stamp(ctx, x)) lim = true
    this.limited = lim
  }

  /** every branch of the last stamp on its own pins (ENA wired to +5V, an IN tied to GND …) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const P = (p: string) => this.entry.pins.indexOf(p)
    const n = this.nodes
    const gnd = P('GND')
    const v5 = P('+5V')
    const vs = P('+12V')
    bookBranch(out, off, n, x, P('ENA'), v5, this.jumperEnA ? G_ON : G_OFF)
    bookBranch(out, off, n, x, P('ENB'), v5, this.jumperEnB ? G_ON : G_OFF)
    bookBranch(out, off, n, x, vs, P('@reg_in'), this.jumper5v ? G_ON : G_OFF)
    for (const p of ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']) bookBranch(out, off, n, x, P(p), gnd, 1 / L298_R_IN)
    bookBranch(out, off, n, x, v5, gnd, L298_G_SS)
    if (this.logicOn) bookBranch(out, off, n, x, vs, gnd, L298_G_S)
    for (let k = 0; k < 4; k++) this.legs[k].book(out, off, n, x, P(`OUT${k + 1}`), vs, gnd)
  }

  endStep(x: Float64Array): void {
    const vg = vAt(x, this.node('GND'))
    this.vs = vAt(x, this.node('+12V')) - vg
    this.vss = vAt(x, this.node('+5V')) - vg
    this.logicOn = this.logicOn ? this.vss >= L298_VSS_MIN - 0.2 : this.vss >= L298_VSS_MIN
    const rd = (p: string) => vAt(x, this.node(p)) - vg
    this.inEnA.update(rd('ENA'), L298_VIL, L298_VIH)
    this.inEnB.update(rd('ENB'), L298_VIL, L298_VIH)
    const names = ['IN1', 'IN2', 'IN3', 'IN4']
    for (let k = 0; k < 4; k++) this.ins[k].update(rd(names[k]), L298_VIL, L298_VIH)
    this.ia = this.legs[0].outCurrent(x)
    this.ib = this.legs[2].outCurrent(x)
    let pd = 0
    for (const leg of this.legs) pd += leg.dissipation(x)
    this.pd = pd
    this.checks(x)
  }

  private checks(x: Float64Array): void {
    const id = this.partId
    // bridges powered but no logic supply
    if (this.vs > 7 && !this.logicOn) {
      this.noLogicTime += this.dt
      if (this.noLogicTime > 1e-3) {
        this.raiseIssue(
          'nologic',
          'warning',
          `${id}: logic supply +5V is ${fmt(this.vss, 1)} V — fit the 5V-EN jumper (VS 7–12 V) or feed 5 V to the +5V terminal; the bridges stay off`,
        )
      }
    } else this.noLogicTime = 0
    if (this.jumper5v && this.vs > 12.5) {
      this.raiseIssue(
        'reg',
        'warning',
        `${id}: VS = ${fmt(this.vs, 1)} V with the 5V-EN jumper fitted — the module's 78M05 is meant for VS ≤ 12 V: remove the jumper and feed +5V externally`,
      )
    }
    if (this.vs > 46) this.raiseIssue('vsmax', 'error', `${id}: VS = ${fmt(this.vs, 1)} V exceeds the L298's 46 V maximum`)
    const cur = [this.ia, this.ib]
    for (let k = 0; k < 2; k++) {
      if (Math.abs(cur[k]) > L298_I_MAX) {
        this.overTime[k] += this.dt
        if (this.overTime[k] > 1e-3) {
          this.raiseIssue(
            `oc${k}`,
            'warning',
            `${id}: channel ${k === 0 ? 'A' : 'B'} carries ${fmt(Math.abs(cur[k]))} A — above the L298's 2 A continuous rating (the L298 has no over-current protection)`,
          )
        }
      } else this.overTime[k] = 0
    }
    // something drives ENx against its jumper (the jumper ties it to +5V)
    const v5 = vAt(x, this.node('+5V'))
    const jum: [boolean, string][] = [
      [this.jumperEnA, 'ENA'],
      [this.jumperEnB, 'ENB'],
    ]
    for (const [fitted, pin] of jum) {
      if (!fitted || !this.logicOn) continue
      const iJ = (v5 - vAt(x, this.node(pin))) * G_ON
      if (Math.abs(iJ) > 5e-3) {
        this.raiseIssue(
          `jumper${pin}`,
          'warning',
          `${id}: ${pin} is driven while its jumper ties it to +5V — remove the ${pin} jumper to control the speed with PWM`,
        )
      }
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = Math.abs(this.ia) > Math.abs(this.ib) ? this.ia : this.ib
    t.power = this.pd
    t.values = {
      vs: this.vs,
      vss: this.vss,
      ia: this.ia,
      ib: this.ib,
      logic: this.logicOn ? 1 : 0,
      enA: this.inEnA.level,
      enB: this.inEnB.level,
      in1: this.ins[0].level,
      in2: this.ins[1].level,
      in3: this.ins[2].level,
      in4: this.ins[3].level,
      dissipation: this.pd,
    }
  }
}

// =================================================================== TB6612FNG

/** TB6612FNG: Ron (upper + lower) 0.5 Ω typ at VM ≥ 5 V */
const TB_R_HALF = 0.25
/** input pull-down 200 kΩ (datasheet), VIH 0.7·VCC / VIL 0.3·VCC */
const TB_R_PD = 200e3
const TB_VCC_MIN = 2.7
const TB_VM_MIN = 2.5
/** average / peak output current (A) */
const TB_I_PEAK = 3.2

/**
 * Toshiba TB6612FNG. Per channel (IN1, IN2, PWM), STBY high:
 *   H H x → short brake (both low sides on) · L H H → CCW (OUT1 L, OUT2 H)
 *   H L H → CW (OUT1 H, OUT2 L) · IN1 ≠ IN2 with PWM L → short brake
 *   L L x → stop (outputs off: the winding current decays through the body
 *   diodes). STBY low: every output off. PWM on the PWMx pin therefore
 *   alternates drive and short brake (slow decay): the motor sees ≈ duty·VM.
 */
class Tb6612Device extends MotorsDevice {
  readonly nonlinear: boolean = true
  private readonly legs: FetLeg[]
  private readonly inputs: Record<string, LogicInput> = {}
  private on = false
  private vm = 0
  private vcc = 0
  private ia = 0
  private ib = 0
  private pd = 0
  private overTime = [0, 0]
  private static readonly INS = ['AIN1', 'AIN2', 'PWMA', 'BIN1', 'BIN2', 'PWMB', 'STBY']

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const vm = this.node('VM')
    const gnd = this.node('GND')
    const g = 1 / TB_R_HALF
    this.legs = ['AO1', 'AO2', 'BO1', 'BO2'].map((o) => new FetLeg(this.node(o), vm, gnd, g, g))
    for (const p of Tb6612Device.INS) this.inputs[p] = new LogicInput()
    this.applyParams()
  }

  applyParams(): void {}

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const L = (p: string) => this.inputs[p].level === 1
    const run = this.on && L('STBY')
    this.channel(run, L('AIN1'), L('AIN2'), L('PWMA'), this.legs[0], this.legs[1])
    this.channel(run, L('BIN1'), L('BIN2'), L('PWMB'), this.legs[2], this.legs[3])
  }

  private channel(run: boolean, in1: boolean, in2: boolean, pwm: boolean, o1: FetLeg, o2: FetLeg): void {
    o1.hi = o1.lo = o2.hi = o2.lo = 0
    if (!run || (!in1 && !in2)) return // standby / stop: off
    if (in1 && in2) {
      o1.lo = o2.lo = 1 // short brake
    } else if (!pwm) {
      o1.lo = o2.lo = 1 // short brake
    } else if (in1) {
      o1.hi = 1 // CW: OUT1 H, OUT2 L
      o2.lo = 1
    } else {
      o1.lo = 1 // CCW: OUT1 L, OUT2 H
      o2.hi = 1
    }
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const gnd = this.node('GND')
    for (const p of Tb6612Device.INS) ctx.addConductance(this.node(p), gnd, 1 / TB_R_PD)
    // quiescent: ICC ≈ 1 mA, IM ≈ 1 mA
    ctx.addConductance(this.node('VCC'), gnd, 1e-3 / 5)
    ctx.addConductance(this.node('VM'), gnd, 1e-3 / 12)
    let lim = false
    for (const leg of this.legs) if (leg.stamp(ctx, x)) lim = true
    this.limited = lim
  }

  /** every branch of the last stamp on its own pins (STBY tied to VCC, an input tied to GND …) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const P = (p: string) => this.entry.pins.indexOf(p)
    const n = this.nodes
    const gnd = P('GND')
    const vm = P('VM')
    for (const p of Tb6612Device.INS) bookBranch(out, off, n, x, P(p), gnd, 1 / TB_R_PD)
    bookBranch(out, off, n, x, P('VCC'), gnd, 1e-3 / 5)
    bookBranch(out, off, n, x, vm, gnd, 1e-3 / 12)
    const outs = ['AO1', 'AO2', 'BO1', 'BO2']
    for (let k = 0; k < 4; k++) this.legs[k].book(out, off, n, x, P(outs[k]), vm, gnd)
  }

  endStep(x: Float64Array): void {
    const vg = vAt(x, this.node('GND'))
    this.vm = vAt(x, this.node('VM')) - vg
    this.vcc = vAt(x, this.node('VCC')) - vg
    this.on = this.vcc >= TB_VCC_MIN && this.vm >= TB_VM_MIN
    const vih = 0.7 * this.vcc
    const vil = 0.3 * this.vcc
    for (const p of Tb6612Device.INS) this.inputs[p].update(vAt(x, this.node(p)) - vg, vil, vih)
    this.ia = this.legs[0].outCurrent(x)
    this.ib = this.legs[2].outCurrent(x)
    let pd = 0
    for (const leg of this.legs) pd += leg.dissipation(x)
    this.pd = pd
    const id = this.partId
    if (this.vm > 15) this.raiseIssue('vm', 'error', `${id}: VM = ${fmt(this.vm, 1)} V exceeds the TB6612FNG's 15 V maximum`)
    if (this.vcc > 6) this.raiseIssue('vcc', 'error', `${id}: VCC = ${fmt(this.vcc, 1)} V exceeds the TB6612FNG's 6 V maximum`)
    if (this.vm > 3 && this.vcc < 1) this.raiseIssue('novcc', 'warning', `${id}: VM is powered but VCC is not — connect VCC to the 3.3 V or 5 V logic supply`)
    const cur = [this.ia, this.ib]
    for (let k = 0; k < 2; k++) {
      if (Math.abs(cur[k]) > TB_I_PEAK) {
        this.overTime[k] += this.dt
        if (this.overTime[k] > 1e-3) {
          this.raiseIssue(
            `oc${k}`,
            'warning',
            `${id}: channel ${k === 0 ? 'A' : 'B'} carries ${fmt(Math.abs(cur[k]))} A — above the TB6612FNG's 3.2 A peak rating (1.2 A continuous)`,
          )
        }
      } else this.overTime[k] = 0
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = Math.abs(this.ia) > Math.abs(this.ib) ? this.ia : this.ib
    t.power = this.pd
    const values: Record<string, number> = {
      vm: this.vm,
      vcc: this.vcc,
      ia: this.ia,
      ib: this.ib,
      standby: this.on && this.inputs.STBY.level === 1 ? 0 : 1,
      dissipation: this.pd,
    }
    for (const p of Tb6612Device.INS) values[p] = this.inputs[p].level
    t.values = values
  }
}

// =================================================================== DRV8833

/** DRV8833: HS 200 mΩ + LS 160 mΩ (VM = 5 V, 25 °C typ) */
const D33_R_HS = 0.2
const D33_R_LS = 0.16
/** inputs: VIL 0.7 V, VIH 2.0 V; nSLEEP VIL 0.5 V, VIH 2.5 V */
const D33_VIL = 0.7
const D33_VIH = 2.0
const D33_SLP_VIL = 0.5
const D33_SLP_VIH = 2.5
/** pull-downs: xINy 150 kΩ (datasheet RPD), nSLEEP 500 kΩ */
const D33_R_PD = 150e3
const D33_R_PD_SLP = 500e3
/** VM undervoltage lockout (V, rising / falling) */
const D33_UVLO_ON = 2.6
const D33_UVLO_OFF = 2.5
/** start-up time after nSLEEP high (s), OCP trip (A), deglitch (s), retry period (s) */
const D33_TWAKE = 1e-3
const D33_IOCP = 3.3
const D33_TDEG = 4e-6
const D33_TOCP = 1.35e-3

/**
 * TI DRV8833, per bridge: xIN1 xIN2 = 0 0 coast (outputs off, fast decay
 * through the body diodes) · 0 1 reverse · 1 0 forward · 1 1 brake (both
 * low sides, slow decay). PWM on one input with the other low = fast decay,
 * with the other high = slow decay (datasheet Table 2). nSLEEP low: all
 * off; the bridges start t_WAKE = 1 ms after nSLEEP goes high. VM UVLO
 * 2.6 V. OCP: a switch above 3.3 A for 4 µs disables that bridge and pulls
 * nFAULT low for t_OCP = 1.35 ms, then it retries. xISEN are tied to GND on
 * this breakout (no current regulation).
 */
class Drv8833Device extends MotorsDevice {
  readonly nonlinear: boolean = true
  private readonly legs: FetLeg[]
  private readonly ins: Record<string, LogicInput> = {}
  private readonly slp = new LogicInput()
  private uvlo = true
  private wakeAt = Infinity
  private vm = 0
  private ia = 0
  private ib = 0
  private pd = 0
  private ocpOver = [0, 0]
  private faultUntil = [-1, -1]
  private static readonly INS = ['AIN1', 'AIN2', 'BIN1', 'BIN2']

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const vm = this.node('VM')
    const gnd = this.node('GND')
    this.legs = ['AOUT1', 'AOUT2', 'BOUT1', 'BOUT2'].map((o) => new FetLeg(this.node(o), vm, gnd, 1 / D33_R_HS, 1 / D33_R_LS))
    for (const p of Drv8833Device.INS) this.ins[p] = new LogicInput()
    this.applyParams()
  }

  applyParams(): void {}

  private awake(t: number): boolean {
    return !this.uvlo && this.slp.level === 1 && t >= this.wakeAt
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const run = this.awake(time)
    const L = (p: string) => this.ins[p].level === 1
    this.bridge(run && time >= this.faultUntil[0], L('AIN1'), L('AIN2'), this.legs[0], this.legs[1])
    this.bridge(run && time >= this.faultUntil[1], L('BIN1'), L('BIN2'), this.legs[2], this.legs[3])
  }

  private bridge(run: boolean, in1: boolean, in2: boolean, o1: FetLeg, o2: FetLeg): void {
    o1.hi = o1.lo = o2.hi = o2.lo = 0
    if (!run) return
    if (in1 && in2) o1.lo = o2.lo = 1
    else if (in1) {
      o1.hi = 1
      o2.lo = 1
    } else if (in2) {
      o1.lo = 1
      o2.hi = 1
    }
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const gnd = this.node('GND')
    for (const p of Drv8833Device.INS) ctx.addConductance(this.node(p), gnd, 1 / D33_R_PD)
    ctx.addConductance(this.node('SLP'), gnd, 1 / D33_R_PD_SLP)
    // VM operating current 1.7 mA typ (awake), sleep 1.6 µA
    ctx.addConductance(this.node('VM'), gnd, this.slp.level === 1 ? 1.7e-3 / 5 : 1e-6 / 5)
    // nFAULT open drain (low while a bridge is in its OCP period)
    const faulted = this.faultUntil[0] > this.t0 || this.faultUntil[1] > this.t0
    if (faulted) ctx.addConductance(this.node('FLT'), gnd, 1 / 50)
    let lim = false
    for (const leg of this.legs) if (leg.stamp(ctx, x)) lim = true
    this.limited = lim
  }

  /** every branch of the last stamp on its own pins (SLP tied to VM, an input tied to GND …) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const P = (p: string) => this.entry.pins.indexOf(p)
    const n = this.nodes
    const gnd = P('GND')
    const vm = P('VM')
    for (const p of Drv8833Device.INS) bookBranch(out, off, n, x, P(p), gnd, 1 / D33_R_PD)
    bookBranch(out, off, n, x, P('SLP'), gnd, 1 / D33_R_PD_SLP)
    bookBranch(out, off, n, x, vm, gnd, this.slp.level === 1 ? 1.7e-3 / 5 : 1e-6 / 5)
    if (this.faultUntil[0] > this.t0 || this.faultUntil[1] > this.t0) bookBranch(out, off, n, x, P('FLT'), gnd, 1 / 50)
    const outs = ['AOUT1', 'AOUT2', 'BOUT1', 'BOUT2']
    for (let k = 0; k < 4; k++) this.legs[k].book(out, off, n, x, P(outs[k]), vm, gnd)
  }

  endStep(x: Float64Array): void {
    const vg = vAt(x, this.node('GND'))
    const t1 = this.t0 + this.dt
    this.vm = vAt(x, this.node('VM')) - vg
    this.uvlo = this.uvlo ? this.vm < D33_UVLO_ON : this.vm < D33_UVLO_OFF
    const wasAsleep = this.slp.level === 0
    this.slp.update(vAt(x, this.node('SLP')) - vg, D33_SLP_VIL, D33_SLP_VIH)
    if (this.slp.level === 1 && wasAsleep) this.wakeAt = this.t0 + D33_TWAKE
    if (this.slp.level === 0) this.wakeAt = Infinity
    for (const p of Drv8833Device.INS) this.ins[p].update(vAt(x, this.node(p)) - vg, D33_VIL, D33_VIH)
    this.ia = this.legs[0].outCurrent(x)
    this.ib = this.legs[2].outCurrent(x)
    let pd = 0
    for (const leg of this.legs) pd += leg.dissipation(x)
    this.pd = pd
    const id = this.partId
    for (let k = 0; k < 2; k++) {
      const sw = Math.max(this.legs[2 * k].switchCurrent(x), this.legs[2 * k + 1].switchCurrent(x))
      if (sw > D33_IOCP) {
        this.ocpOver[k] += this.dt
        if (this.ocpOver[k] >= D33_TDEG) {
          this.faultUntil[k] = t1 + D33_TOCP
          this.ocpOver[k] = 0
          this.raiseIssue(
            `ocp${k}`,
            'warning',
            `${id}: over-current on bridge ${k === 0 ? 'A' : 'B'} (${fmt(sw)} A > 3.3 A) — outputs disabled, nFAULT low, retry after 1.35 ms`,
          )
        }
      } else this.ocpOver[k] = 0
    }
    if (this.vm > 11.8) this.raiseIssue('vm', 'error', `${id}: VM = ${fmt(this.vm, 1)} V exceeds the DRV8833's 11.8 V absolute maximum`)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = Math.abs(this.ia) > Math.abs(this.ib) ? this.ia : this.ib
    t.power = this.pd
    const values: Record<string, number> = {
      vm: this.vm,
      ia: this.ia,
      ib: this.ib,
      sleep: this.slp.level === 1 ? 0 : 1,
      uvlo: this.uvlo ? 1 : 0,
      fault: this.faultUntil[0] > this.t0 || this.faultUntil[1] > this.t0 ? 1 : 0,
      dissipation: this.pd,
    }
    for (const p of Drv8833Device.INS) values[p] = this.ins[p].level
    t.values = values
  }
}

// =================================================================== StepStick drivers

type StepStickKind = 'a4988' | 'drv8825' | 'tmc2209'

interface StepStickSpec {
  kind: StepStickKind
  /** chip name for messages */
  name: string
  /** element pin names */
  pins: {
    en: string
    step: string
    dir: string
    ms: string[]
    rst?: string
    slp?: string
    vm: string
    vdd?: string
    a1: string
    a2: string
    b1: string
    b2: string
    spread?: string
    pdn?: string
    uart?: string
  }
  /** electrical-angle table resolution (positions per electrical revolution) */
  tableSize: number
  /** home position (table index) */
  home: number
  /** microstep divisor from the MS pin levels (null = invalid combination) */
  divisor(ms: (0 | 1)[]): number | null
  /** % rounding of the DAC table (DRV8825 publishes whole percent) */
  roundPercent: boolean
  /** full-scale current (A) from VREF (V) */
  iFull(vref: number): number
  /** input thresholds: absolute (V) or fractions of VDD */
  vil: (vdd: number) => number
  vih: (vdd: number) => number
  /** internal pull-downs (pin → Ω) */
  pullDowns: Record<string, number>
  /** logic supply OK (vdd = VDD pin, vm = motor supply) */
  logicOk(vdd: number, vm: number, prev: boolean): boolean
  /** motor supply UVLO (outputs enabled above) */
  vmOk(vm: number, prev: boolean): boolean
  /** on-resistance of the conducting path: high side + low side + sense resistor (Ω) */
  rPath: number
  /**
   * Lowest cycle-averaged winding voltage while the current has to fall, as
   * a fraction of VM, for slow and for mixed decay (from the off-time /
   * PWM period, the fast-decay share and the minimum on-time = blanking).
   */
  vMinSlow: number
  vMinMixed: number
  /** mixed decay on decreasing steps (A4988 / DRV8825) */
  mixed: boolean
  /** STEP minimum high / low pulse width (s), setup time DIR → STEP (s) */
  tStepMin: number
  tSetup: number
  /** wake-up time after SLEEP high (s) */
  tWake: number
  /** quiescent currents (S equivalent) on VM and VDD */
  gVm: number
  gVdd: number
  /** VM absolute maximum (V) */
  vmMax: number
  /** interpolate to 1/256 between STEP pulses (TMC2209 MicroPlyer) */
  interpolate: boolean
}

const A4988_RS = 0.068
const DRV8825_RS = 0.1
const TMC2209_RS = 0.11

/**
 * A4988: fixed off-time 30 µs, blanking (minimum on-time) 1 µs. Slow decay
 * cycle = 1 µs at +VM + 30 µs ≈ 0 V → +VM/31; mixed decay = 1 µs +VM,
 * 31.25 % of t_OFF at −VM, the rest ≈ 0 V → (1 − 9.375)/31 · VM.
 */
const A4988_SPEC: StepStickSpec = {
  kind: 'a4988',
  name: 'A4988',
  pins: { en: 'EN', step: 'STEP', dir: 'DIR', ms: ['MS1', 'MS2', 'MS3'], rst: 'RST', slp: 'SLP', vm: 'VMOT', vdd: 'VDD', a1: '1A', a2: '1B', b1: '2A', b2: '2B' },
  tableSize: 64, // 1/16 step = 5.625°
  home: 8, // 45°
  divisor([ms1, ms2, ms3]) {
    const code = ms1 | (ms2 << 1) | (ms3 << 2)
    switch (code) {
      case 0:
        return 1
      case 1:
        return 2
      case 2:
        return 4
      case 3:
        return 8
      case 7:
        return 16
      default:
        return null
    }
  },
  roundPercent: false,
  iFull: (vref) => vref / (8 * A4988_RS),
  vil: (vdd) => 0.3 * vdd,
  vih: (vdd) => 0.7 * vdd,
  pullDowns: { MS1: 100e3, MS2: 50e3, MS3: 100e3 },
  logicOk: (vdd, _vm, prev) => (prev ? vdd >= 2.8 - 0.09 : vdd >= 2.8),
  vmOk: (vm, prev) => (prev ? vm >= 7.5 : vm >= 8),
  rPath: 0.32 + 0.32 + A4988_RS,
  vMinSlow: 1 / 31,
  vMinMixed: (1 - 0.3125 * 30) / 31,
  mixed: true,
  tStepMin: 1e-6,
  tSetup: 200e-9,
  tWake: 1e-3,
  gVm: 2e-3 / 12,
  gVdd: 5e-3 / 5,
  vmMax: 35,
  interpolate: false,
}

/**
 * DRV8825: fixed 30 kHz PWM (33.3 µs), blanking 3.75 µs = minimum on-time.
 * Slow decay → +3.75/33.3 · VM; mixed decay (fast until 75 % of the cycle)
 * → (3.75 − 21.25)/33.3 · VM.
 */
const DRV8825_SPEC: StepStickSpec = {
  kind: 'drv8825',
  name: 'DRV8825',
  pins: { en: 'EN', step: 'STEP', dir: 'DIR', ms: ['M0', 'M1', 'M2'], rst: 'RST', slp: 'SLP', vm: 'VMOT', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2' },
  tableSize: 128, // 1/32 step
  home: 16,
  divisor([m0, m1, m2]) {
    const code = m0 | (m1 << 1) | (m2 << 2)
    return [1, 2, 4, 8, 16, 32, 32, 32][code]
  },
  roundPercent: true,
  iFull: (vref) => vref / (5 * DRV8825_RS),
  vil: () => 0.7,
  vih: () => 2.2,
  pullDowns: { EN: 100e3, M0: 100e3, M1: 100e3, M2: 100e3, STEP: 100e3, DIR: 100e3, RST: 100e3, SLP: 1e6 },
  // the logic runs from the internal 3.3 V regulator fed by VM (UVLO 7.8 V typ rising)
  logicOk: (_vdd, vm, prev) => (prev ? vm >= 7.6 : vm >= 7.8),
  vmOk: () => true,
  rPath: 0.2 + 0.2 + DRV8825_RS,
  vMinSlow: 3.75 / 33.33,
  vMinMixed: (3.75 - 21.25) / 33.33,
  mixed: true,
  tStepMin: 1.9e-6,
  tSetup: 650e-9,
  tWake: 1e-3,
  gVm: 5e-3 / 24,
  gVdd: 0,
  vmMax: 45,
  interpolate: false,
}

/** TMC2209: SpreadCycle/StealthChop both regulate with fast-decay capability (modeled as −VM/2). */
const TMC2209_SPEC: StepStickSpec = {
  kind: 'tmc2209',
  name: 'TMC2209',
  pins: {
    en: 'EN',
    step: 'STEP',
    dir: 'DIR',
    ms: ['MS1', 'MS2'],
    vm: 'VM',
    vdd: 'VIO',
    a1: 'M1A',
    a2: 'M1B',
    b1: 'M2A',
    b2: 'M2B',
    spread: 'SPREAD',
    pdn: 'PDN',
    uart: 'UART',
  },
  tableSize: 1024, // 1/256 step
  home: 0,
  divisor([ms1, ms2]) {
    // standalone STEP/DIR (datasheet table "MS2 MS1"): 00 → 1/8, 01 → 1/32, 10 → 1/64, 11 → 1/16
    return [8, 32, 64, 16][ms1 | (ms2 << 1)]
  },
  roundPercent: false,
  // analog VREF scaling: I_peak = (VREF / 2.5 V) · 325 mV / (RSENSE + 20 mΩ)
  iFull: (vref) => (Math.min(vref, 2.5) / 2.5) * (0.325 / (TMC2209_RS + 0.02)),
  vil: (vdd) => 0.3 * vdd,
  vih: (vdd) => 0.7 * vdd,
  pullDowns: { MS1: 100e3, MS2: 100e3, SPREAD: 100e3, PDN: 100e3 },
  logicOk: (vdd, vm, prev) => (prev ? vdd >= 2.9 && vm >= 4.3 : vdd >= 3.0 && vm >= 4.5),
  vmOk: () => true,
  rPath: 0.17 + 0.17 + TMC2209_RS,
  vMinSlow: -0.5,
  vMinMixed: -0.5,
  mixed: false,
  tStepMin: 100e-9,
  tSetup: 20e-9,
  tWake: 0,
  gVm: 10e-3 / 24,
  gVdd: 1e-3 / 5,
  vmMax: 29,
  interpolate: true,
}

/**
 * STEP/DIR microstepping driver on a StepStick carrier (A4988, DRV8825,
 * TMC2209 standalone):
 *  - translator: a STEP rising edge (read after the analog step that sees
 *    it) advances the electrical index by tableSize/(4·divisor) in the DIR
 *    direction; MS/MODE pins and DIR are sampled at that edge; a step mode
 *    change moves to the next position valid in the new mode (datasheets).
 *  - winding targets: I_full·cos / sin of the electrical angle (A4988
 *    Table 2, DRV8825 Table 2 in whole percent, TMC2209 1/256 sine); TMC2209
 *    interpolates to 1/256 over the last step period (MicroPlyer).
 *  - current regulation per winding: cycle-averaged chopper
 *    (RegulatedBridge) — the winding current follows the target while the
 *    bridge has the voltage for it; mixed decay (fast part) on decreasing
 *    steps (A4988 automatic, DRV8825 DECAY open), slow decay otherwise.
 *  - ENABLE (active low) turns the outputs off but the translator keeps
 *    counting; RESET low → home position, outputs off, STEP ignored; SLEEP
 *    low → outputs off, after SLEEP high the outputs and STEP stay off for
 *    t_WAKE; undervoltage on the logic / motor supply disables the outputs
 *    (logic UVLO also resets the translator). Outputs off = only the body
 *    diodes conduct (the winding current returns to VM).
 */
class StepStickDevice extends MotorsDevice {
  readonly nonlinear: boolean = true
  private readonly legs: FetLeg[]
  private readonly bridges: [RegulatedBridge, RegulatedBridge]
  private readonly inp: Record<string, LogicInput> = {}
  private vref = 0.5
  private iFull = 0.92
  // state
  private logicOn = false
  private vmOn = false
  private index: number
  /** interpolated index (TMC2209) */
  private fine: number
  private divisor = 1
  private steps = 0
  private fullSteps = 0
  private lastStepT = -1
  private stepPeriod = 0
  private stepRiseT = -1
  private fallT = -1
  private dirChangeT = -1
  private wakeAt = -1
  private decreasing: [boolean, boolean] = [false, false]
  private targets: [number, number] = [0, 0]
  private iw: [number, number] = [0, 0]
  private vm = 0
  private vdd = 0
  private uartSeen = false
  private lastUart: 0 | 1 = 0
  private pd = 0

  constructor(
    comp: ComponentInstance,
    entry: CatalogEntry,
    nodes: number[],
    private readonly spec: StepStickSpec,
  ) {
    super(comp, entry, nodes)
    const P = spec.pins
    const vm = this.node(P.vm)
    const gnd = this.node('GND')
    // body diodes of the four outputs (the switches themselves are averaged in the bridges)
    this.legs = [P.a1, P.a2, P.b1, P.b2].map((o) => new FetLeg(this.node(o), vm, gnd, 0, 0))
    this.bridges = [
      new RegulatedBridge(this.node(P.a1), this.node(P.a2), vm, gnd, spec.rPath),
      new RegulatedBridge(this.node(P.b1), this.node(P.b2), vm, gnd, spec.rPath),
    ]
    for (const p of this.inputPins()) this.inp[p] = new LogicInput()
    this.index = spec.home
    this.fine = spec.home
    this.applyParams()
  }

  private inputPins(): string[] {
    const P = this.spec.pins
    return [P.en, P.step, P.dir, ...P.ms, P.rst, P.slp, P.spread, P.pdn, P.uart].filter((p): p is string => !!p)
  }

  applyParams(): void {
    this.vref = clamp(this.p('vref', 0.5), 0, 4)
    this.iFull = this.spec.iFull(this.vref)
  }

  private level(pin: string | undefined, fallback: 0 | 1): 0 | 1 {
    return pin ? this.inp[pin].level : fallback
  }

  private outputsEnabled(t: number): boolean {
    const P = this.spec.pins
    if (!this.logicOn || !this.vmOn) return false
    if (this.level(P.en, 0) === 1) return false
    if (P.rst && this.level(P.rst, 1) === 0) return false
    if (P.slp && this.level(P.slp, 1) === 0) return false
    return t >= this.wakeAt
  }

  /** winding target currents (A) at electrical index i */
  private currentsAt(i: number): [number, number] {
    const ang = (2 * Math.PI * i) / this.spec.tableSize
    let c = Math.cos(ang)
    let s = Math.sin(ang)
    if (this.spec.roundPercent) {
      c = Math.round(c * 100) / 100
      s = Math.round(s * 100) / 100
    }
    return [this.iFull * c, this.iFull * s]
  }

  beginStep(time: number, dt: number): void {
    super.beginStep(time, dt)
    const S = this.spec
    if (S.interpolate && this.fine !== this.index) {
      // MicroPlyer: move toward the commanded position over one step period
      const per = this.stepPeriod > 0 ? this.stepPeriod : 1e-3
      const rate = S.tableSize / (4 * this.divisor) / per
      const d = this.index - this.fine
      const stepMax = rate * dt
      this.fine += Math.abs(d) <= stepMax ? d : Math.sign(d) * stepMax
    }
    const en = this.outputsEnabled(time)
    this.targets = this.currentsAt(S.interpolate ? this.fine : this.index)
    const vm = Math.max(this.vm, 0)
    for (let k = 0; k < 2; k++) {
      const br = this.bridges[k]
      br.active = en
      br.target = this.targets[k]
      const mixed = S.mixed && this.decreasing[k] && this.divisor > 1
      br.vMax = vm
      br.vMin = (mixed ? S.vMinMixed : S.vMinSlow) * vm
      br.prepare()
    }
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const gnd = this.node('GND')
    for (const [pin, r] of Object.entries(this.spec.pullDowns)) ctx.addConductance(this.node(pin), gnd, 1 / r)
    ctx.addConductance(this.node(this.spec.pins.vm), gnd, this.spec.gVm)
    if (this.spec.pins.vdd && this.spec.gVdd > 0) ctx.addConductance(this.node(this.spec.pins.vdd), gnd, this.spec.gVdd)
    let lim = false
    for (const leg of this.legs) if (leg.stamp(ctx, x)) lim = true
    for (const br of this.bridges) if (br.stamp(ctx, x)) lim = true
    this.limited = lim
  }

  /** every branch of the last stamp on its own pins (RST tied to SLP, EN and MS pins tied to GND …) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const P = (p: string) => this.entry.pins.indexOf(p)
    const n = this.nodes
    const S = this.spec.pins
    const gnd = P('GND')
    const vm = P(S.vm)
    for (const [pin, r] of Object.entries(this.spec.pullDowns)) bookBranch(out, off, n, x, P(pin), gnd, 1 / r)
    bookBranch(out, off, n, x, vm, gnd, this.spec.gVm)
    if (S.vdd && this.spec.gVdd > 0) bookBranch(out, off, n, x, P(S.vdd), gnd, this.spec.gVdd)
    const outs = [S.a1, S.a2, S.b1, S.b2]
    for (let k = 0; k < 4; k++) this.legs[k].book(out, off, n, x, P(outs[k]), vm, gnd)
    this.bridges[0].book(out, off, n, x, P(S.a1), P(S.a2), vm, gnd)
    this.bridges[1].book(out, off, n, x, P(S.b1), P(S.b2), vm, gnd)
  }

  endStep(x: Float64Array): void {
    const P = this.spec.pins
    const S = this.spec
    const id = this.partId
    const t0 = this.t0
    const vg = vAt(x, this.node('GND'))
    this.vm = vAt(x, this.node(P.vm)) - vg
    this.vdd = P.vdd ? vAt(x, this.node(P.vdd)) - vg : 3.3
    // supplies
    const logic = S.logicOk(this.vdd, this.vm, this.logicOn)
    if (logic !== this.logicOn) {
      this.logicOn = logic
      if (!logic) {
        // power-on reset: translator home
        this.index = S.home
        this.fine = S.home
      }
    }
    this.vmOn = S.vmOk(this.vm, this.vmOn)
    // inputs
    const vil = S.vil(this.vdd)
    const vih = S.vih(this.vdd)
    const prev: Record<string, 0 | 1> = {}
    for (const p of this.inputPins()) {
      prev[p] = this.inp[p].level
      this.inp[p].update(vAt(x, this.node(p)) - vg, vil, vih)
    }
    // winding currents: regulated bridge + body diodes (out of x1 → winding → x2)
    let pd = 0
    for (let k = 0; k < 2; k++) {
      const br = this.bridges[k]
      br.settle(x)
      this.iw[k] = br.i + this.legs[2 * k].outCurrent(x)
      pd += br.i * br.i * S.rPath
    }
    for (const leg of this.legs) pd += leg.dissipation(x)
    this.pd = pd
    if (this.logicOn) this.logicEdges(prev, t0)
    // diagnostics
    if (this.vm > S.vmMax) this.raiseIssue('vmmax', 'error', `${id}: motor supply ${fmt(this.vm, 1)} V exceeds the ${S.name}'s ${S.vmMax} V maximum`)
    if (this.logicOn && !this.vmOn && this.vm > 1 && this.steps !== 0) {
      this.raiseIssue('uvlo', 'warning', `${id}: motor supply ${fmt(this.vm, 1)} V is below the ${S.name}'s operating minimum — outputs disabled`)
    }
    if (S.kind === 'a4988' && this.vdd > 2.5 && this.vdd < 6 && this.inp[P.step].undefinedNow) {
      // a 3.3 V MCU cannot reach VIH = 0.7·VDD when VDD = 5 V
      this.raiseIssue(
        'vih',
        'warning',
        `${id}: STEP sits at ${fmt(vAt(x, this.node(P.step)) - vg, 1)} V — between the A4988's input thresholds (0.3·VDD … 0.7·VDD with VDD = ${fmt(this.vdd, 1)} V); power VDD from the MCU's 3.3 V`,
      )
    }
  }

  private logicEdges(prev: Record<string, 0 | 1>, t: number): void {
    const P = this.spec.pins
    const S = this.spec
    const id = this.partId
    // SLEEP rising → wake-up delay
    if (P.slp && prev[P.slp] === 0 && this.inp[P.slp].level === 1) this.wakeAt = t + S.tWake
    if (P.slp && this.inp[P.slp].level === 0) this.wakeAt = Infinity
    // RESET: home + outputs off
    const inReset = P.rst ? this.inp[P.rst].level === 0 : false
    if (inReset) {
      this.index = S.home
      this.fine = S.home
    }
    // PDN_UART activity: the UART configuration is not modeled
    if (P.uart) {
      const u = this.inp[P.uart].level
      if (u !== this.lastUart) {
        this.lastUart = u
        if (!this.uartSeen) {
          this.uartSeen = true
          this.raiseIssue('uart', 'warning', `${id}: activity on PDN_UART — the TMC2209 UART register interface is not simulated (standalone STEP/DIR mode only)`)
        }
      }
    }
    // DIR change timestamp (setup check)
    if (prev[P.dir] !== this.inp[P.dir].level) this.dirChangeT = t
    const sp = prev[P.step]
    const sn = this.inp[P.step].level
    if (sp === 0 && sn === 1) {
      // STEP rising edge
      if (this.fallT >= 0 && t - this.fallT < S.tStepMin) {
        this.raiseIssue('tlow', 'warning', `${id}: STEP low time ${fmt((t - this.fallT) * 1e6)} µs is shorter than the ${S.name} minimum ${fmt(S.tStepMin * 1e6, 1)} µs`)
      }
      this.stepRiseT = t
      if (this.dirChangeT >= 0 && t - this.dirChangeT < S.tSetup && this.steps !== 0) {
        this.raiseIssue('setup', 'warning', `${id}: DIR changed ${fmt((t - this.dirChangeT) * 1e9, 0)} ns before a STEP edge — the ${S.name} needs ${fmt(S.tSetup * 1e9, 0)} ns setup time`)
      }
      if (inReset) return
      if (P.slp && this.inp[P.slp].level === 0) return
      if (t < this.wakeAt) {
        this.raiseIssue('wake', 'warning', `${id}: STEP pulse ${fmt((this.wakeAt - t) * 1e3)} ms too early after SLEEP went high — the ${S.name} ignores steps until it is awake`)
        return
      }
      const ms = P.ms.map((p) => this.inp[p].level)
      const div = S.divisor(ms)
      if (div === null) {
        this.raiseIssue('ms', 'warning', `${id}: MS1/MS2/MS3 = ${ms.join('/')} is not a valid ${S.name} step mode — treated as full step`)
      }
      this.divisor = div ?? 1
      const dir = this.inp[P.dir].level === 1 ? 1 : -1
      this.advanceIndex(dir)
      this.steps += dir
      this.fullSteps += dir / this.divisor
      if (this.lastStepT >= 0) this.stepPeriod = t - this.lastStepT
      this.lastStepT = t
    } else if (sp === 1 && sn === 0) {
      if (this.stepRiseT >= 0 && t - this.stepRiseT < S.tStepMin) {
        this.raiseIssue('thigh', 'warning', `${id}: STEP high pulse ${fmt((t - this.stepRiseT) * 1e6)} µs is shorter than the ${S.name} minimum ${fmt(S.tStepMin * 1e6, 1)} µs`)
      }
      this.fallT = t
    }
  }

  /** advance the translator one step of the current mode (next valid position) */
  private advanceIndex(dir: number): void {
    const S = this.spec
    const N = S.tableSize
    const inc = N / (4 * this.divisor)
    // grid of the mode: full step = home + k·N/4 (A4988/DRV8825 45°), others multiples of inc
    const offset = this.divisor === 1 ? S.home % inc : 0
    const before = this.index
    let next = before + dir
    while ((((next - offset) % inc) + inc) % inc !== 0) next += dir
    const [ta0, tb0] = this.currentsAt(before)
    this.index = ((next % N) + N) % N
    if (!S.interpolate) this.fine = this.index
    else if (Math.abs(this.index - this.fine) > N / 2) this.fine += Math.sign(this.index - this.fine) * N
    const [ta1, tb1] = this.currentsAt(this.index)
    this.decreasing = [Math.abs(ta1) < Math.abs(ta0), Math.abs(tb1) < Math.abs(tb0)]
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = Math.abs(this.iw[0]) > Math.abs(this.iw[1]) ? this.iw[0] : this.iw[1]
    t.power = this.pd
    t.values = {
      // commanded position in full steps (each STEP pulse counts 1/divisor)
      position: this.fullSteps,
      // signed STEP pulse count (microsteps of whatever mode was set)
      pulses: this.steps,
      microstep: this.divisor,
      index: this.index,
      iA: this.iw[0],
      iB: this.iw[1],
      targetA: this.targets[0],
      targetB: this.targets[1],
      iFull: this.iFull,
      enabled: this.outputsEnabled(this.t0 + this.dt) ? 1 : 0,
      vm: this.vm,
      vdd: this.vdd,
      supply: this.bridges[0].supplyCurrent(this.vm) + this.bridges[1].supplyCurrent(this.vm),
      dissipation: this.pd,
    }
  }
}

// =================================================================== part chip

/**
 * The part chip of every motors-family component: owns the instance,
 * configures the family device, forwards runtime params and mirrors
 * telemetry (values, current, power, on-board LEDs 'LED_<name>' →
 * leds[name]).
 */
export class MotorsPartChip implements ChipInstance {
  readonly devices: MotorsDevice[] = []
  readonly entry: CatalogEntry | undefined

  constructor(readonly comp: ComponentInstance) {
    this.entry = getEntry(comp.type)
  }

  /** true when `deviceId` names one of this part's sub-circuit elements */
  owns(deviceId: string): boolean {
    return !!this.entry?.subcircuit?.some((el) => `${this.comp.id}.${el.id}` === deviceId)
  }

  adopt(d: MotorsDevice): void {
    if (this.entry) d.configure(this.comp, this.entry)
    this.devices.push(d)
  }

  step(_ctx: ChipStepCtx): void {
    // the electrical model is the sub-circuit; issues travel through AnalogDevice.issues()
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    for (const d of this.devices) d.setPartParam(key, value)
  }

  fillTelemetry(tele: ComponentTelemetry): void {
    const main = this.devices[0]
    if (main) main.fillPartTelemetry(tele)
    const sub = tele.sub
    if (sub && !main) {
      // ULN2003-style boards: output transistors 'QO<n>' → values.out<n> (collector current, A)
      let values: Record<string, number> | undefined
      let imax = 0
      for (const id of Object.keys(sub)) {
        const m = /^QO(\d)$/.exec(id)
        const ic = sub[id].current
        if (!m || typeof ic !== 'number') continue
        ;(values ??= {})[`out${m[1]}`] = ic
        if (Math.abs(ic) > Math.abs(imax)) imax = ic
      }
      if (values) {
        tele.values = values
        tele.current = imax
      }
    }
    if (sub) {
      let leds: Record<string, number> | undefined
      for (const id of Object.keys(sub)) {
        if (!id.startsWith('LED_')) continue
        const b = sub[id].ledBrightness
        if (typeof b === 'number') (leds ??= {})[id.slice(4)] = b
      }
      if (leds) tele.leds = leds
    }
  }
}

/** The chip created last — its sub-circuit devices are created right after it (engine.ts). */
let pendingPart: MotorsPartChip | null = null

registerChip(MOTORS_PART_CHIP, (comp) => {
  pendingPart = new MotorsPartChip(comp)
  return pendingPart
})

function linked<T extends MotorsDevice>(d: T): AnalogDevice {
  const p = pendingPart
  if (p && p.owns(d.comp.id)) p.adopt(d)
  return d
}

registerDevice('motor_dc', (c, e, n) => linked(new DcMotorDevice(c, e, n)))
registerDevice('motor_sg90', (c, e, n) => linked(new Sg90Device(c, e, n)))
registerDevice('motor_nema17', (c, e, n) => linked(new StepperDevice(c, e, n, NEMA17_SPEC)))
registerDevice('motor_28byj48', (c, e, n) => linked(new StepperDevice(c, e, n, BYJ48_SPEC)))
registerDevice('drv_l298n', (c, e, n) => linked(new L298nDevice(c, e, n)))
registerDevice('drv_tb6612', (c, e, n) => linked(new Tb6612Device(c, e, n)))
registerDevice('drv_drv8833', (c, e, n) => linked(new Drv8833Device(c, e, n)))
registerDevice('drv_a4988', (c, e, n) => linked(new StepStickDevice(c, e, n, A4988_SPEC)))
registerDevice('drv_drv8825', (c, e, n) => linked(new StepStickDevice(c, e, n, DRV8825_SPEC)))
registerDevice('drv_tmc2209', (c, e, n) => linked(new StepStickDevice(c, e, n, TMC2209_SPEC)))

export { DcMotorDevice, Sg90Device, StepperDevice, L298nDevice, Tb6612Device, Drv8833Device, StepStickDevice }
