/**
 * Motors & drivers family — electromechanical models (pure, no solver
 * dependency; used by ./motors.model.ts and unit-tested directly).
 *
 *  DcMotor      brushed permanent-magnet DC motor:
 *                 v = R·i + L·di/dt + Ke·ω            (armature)
 *                 J·dω/dt = Kt·i − b·ω − T_f·sgn(ω)   (rotor; T_f = brush /
 *                 bearing Coulomb friction + the user's load torque, which
 *                 also holds the shaft at standstill up to its value)
 *               Both equations are discretized TOGETHER by backward Euler,
 *               so the armature is ONE linear two-terminal companion per
 *               analog step (i = G·v + I) that already contains the back-EMF
 *               of the end-of-step speed — unconditionally stable for any
 *               step size the coordinator picks (0.5 µs … 50 µs).
 *  StepperRotor two-phase stepper rotor (hybrid with Nr teeth, or permanent
 *               magnet with Np pole pairs — the same equations):
 *                 T = Kt·(−iA·sin(N·θ) + iB·cos(N·θ)) − Td·sin(4·N·θ)
 *                 eA = −Kt·ω·sin(N·θ),  eB = Kt·ω·cos(N·θ)
 *               (eA·iA + eB·iB = ω·T: electrical power in = mechanical out),
 *               semi-implicit Euler with Coulomb friction / stiction. Phase A
 *               alone holds θ = 0, phase B alone θ = 90°/N: the sequence
 *               A+, B+, A−, B− turns the rotor in +θ by one full step
 *               (90° electrical) each.
 *  ServoMech    output-shaft model of a hobby servo's motor + gear train
 *               with mechanical end stops.
 *
 * Sign convention for every motor: +θ / +ω = clockwise looking at the shaft
 * end.
 */

/** Brushed DC motor constants (SI). */
export interface DcMotorParams {
  /** armature resistance (Ω) */
  r: number
  /** armature inductance (H) */
  l: number
  /** back-EMF constant (V·s/rad) */
  ke: number
  /** torque constant (N·m/A) */
  kt: number
  /** rotor inertia incl. the attached flag/wheel (kg·m²) */
  j: number
  /** viscous friction (N·m·s/rad) */
  b: number
  /** Coulomb (brush + bearing) friction torque (N·m) */
  tc: number
}

/**
 * Generic 130-size 3–6 V hobby motor ("R130"): 3 Ω armature → 2.0 A
 * stall current at 6 V, Ke = Kt = 4 mV·s/rad, 0.4 mN·m friction → ≈ 0.1 A
 * no-load current, ≈ 13 400 rpm no-load at 6 V (6 400 rpm at 3 V),
 * 8 mN·m (≈ 80 g·cm) stall torque at 6 V, mechanical time constant
 * J·R/(Kt·Ke + R·b) ≈ 22 ms, electrical time constant L/R ≈ 67 µs.
 */
export const DC_MOTOR_130: DcMotorParams = {
  r: 3.0,
  l: 0.2e-3,
  ke: 4.0e-3,
  kt: 4.0e-3,
  j: 1.2e-7,
  b: 6.7e-8,
  tc: 0.4e-3,
}

/** Steady-state no-load speed (rad/s) of a DC motor at armature voltage v (friction included). */
export function dcSteadySpeed(p: DcMotorParams, v: number, tLoad = 0): number {
  const tf = p.tc + tLoad
  const s = Math.sign(v)
  const vEff = Math.abs(v) - (p.r * tf) / p.kt
  if (vEff <= 0) return 0
  return (s * vEff) / (p.ke + (p.r * p.b) / p.kt)
}

export class DcMotor {
  i = 0
  w = 0
  theta = 0
  /** shaft held by static friction (ω = 0) */
  stuck = true
  /** direction of the last driving torque (friction sign while starting) */
  private drive = 1
  // companion of the current step
  private geq = 0
  private ieq = 0
  private a = 0
  private text = 0
  private jOverDt = 0

  constructor(public p: DcMotorParams) {}

  /** Linear companion i = geq·v + ieq of the armature for a step of `dt` (s). */
  prepare(dt: number, tLoad: number): { geq: number; ieq: number } {
    const p = this.p
    const lOverDt = p.l / dt
    this.jOverDt = p.j / dt
    if (this.stuck) {
      // locked rotor: no back-EMF during this step
      this.geq = 1 / (p.r + lOverDt)
      this.ieq = this.geq * lOverDt * this.i
    } else {
      const s = this.w !== 0 ? Math.sign(this.w) : this.drive
      this.text = (p.tc + Math.max(0, tLoad)) * s
      this.a = this.jOverDt + p.b
      this.geq = 1 / (p.r + lOverDt + (p.ke * p.kt) / this.a)
      this.ieq = this.geq * (lOverDt * this.i - (p.ke * (this.jOverDt * this.w - this.text)) / this.a)
    }
    return { geq: this.geq, ieq: this.ieq }
  }

  /** Accept the solved armature voltage `v` (V) for the prepared step. */
  advance(v: number, dt: number, tLoad: number): void {
    const p = this.p
    const i1 = this.geq * v + this.ieq
    const tm = p.kt * i1
    const tf = p.tc + Math.max(0, tLoad)
    let w1 = 0
    if (this.stuck) {
      if (Math.abs(tm) > tf) {
        this.stuck = false
        this.drive = Math.sign(tm)
      }
    } else {
      w1 = (this.jOverDt * this.w + tm - this.text) / this.a
      const s = this.w !== 0 ? Math.sign(this.w) : this.drive
      if (Math.sign(w1) !== s) {
        // friction stops the shaft within this step
        w1 = 0
        if (Math.abs(tm) <= tf) this.stuck = true
        else this.drive = Math.sign(tm)
      }
    }
    this.i = i1
    this.w = w1
    this.theta += w1 * dt
  }
}

/** Two-phase stepper rotor constants (motor side, SI). */
export interface StepperParams {
  /** rotor teeth (hybrid) / pole pairs (PM): electrical angle = n·θ */
  n: number
  /** torque constant per phase (N·m/A) = back-EMF constant (V·s/rad) */
  kt: number
  /** rotor inertia (kg·m²) */
  j: number
  /** viscous damping (N·m·s/rad) */
  b: number
  /** Coulomb friction (N·m) */
  tc: number
  /** detent torque amplitude (N·m), period 1/4 of an electrical cycle */
  td: number
  /** gear ratio motor:output (1 = direct drive) */
  gear: number
}

export class StepperRotor {
  theta = 0
  w = 0
  private stuck = true

  constructor(public p: StepperParams) {}

  /** back-EMF of phase A / B at the present state (V) */
  emfA(): number {
    return -this.p.kt * this.w * Math.sin(this.p.n * this.theta)
  }
  emfB(): number {
    return this.p.kt * this.w * Math.cos(this.p.n * this.theta)
  }

  /** electromagnetic + detent torque for phase currents iA, iB (N·m) */
  torque(iA: number, iB: number): number {
    const p = this.p
    const e = p.n * this.theta
    return p.kt * (-iA * Math.sin(e) + iB * Math.cos(e)) - p.td * Math.sin(4 * e)
  }

  /** Advance by dt with phase currents iA, iB and a load torque at the OUTPUT shaft (N·m). */
  advance(iA: number, iB: number, tLoadOut: number, dt: number): void {
    const p = this.p
    const tm = this.torque(iA, iB) - p.b * this.w
    const tf = p.tc + Math.max(0, tLoadOut) / p.gear
    if (this.stuck || this.w === 0) {
      if (Math.abs(tm) <= tf) {
        this.stuck = true
        this.w = 0
        return
      }
      this.stuck = false
    }
    const s = this.w !== 0 ? Math.sign(this.w) : Math.sign(tm)
    let w1 = this.w + ((tm - tf * s) / p.j) * dt
    if (Math.sign(w1) !== s) {
      w1 = 0
      if (Math.abs(tm) <= tf) this.stuck = true
    }
    this.w = w1
    this.theta += w1 * dt
  }

  /** output-shaft angle (rad) */
  get outputAngle(): number {
    return this.theta / this.p.gear
  }
  /** output-shaft speed (rad/s) */
  get outputSpeed(): number {
    return this.w / this.p.gear
  }
  /** rotor position in full steps (one full step = 90° electrical) */
  get fullSteps(): number {
    return (this.theta * this.p.n * 2) / Math.PI
  }
}

/**
 * Generic NEMA 17 hybrid stepper (17HS4401-class): 1.8°/step (50 rotor
 * teeth), 1.7 A rated, 1.5 Ω / 2.8 mH per phase, 0.40 N·m holding torque
 * with both phases at the rated current (Kt = 0.40 / (√2·1.7) ≈ 0.166 N·m/A),
 * rotor inertia 54 g·cm², detent ≈ 0.022 N·m.
 */
export const NEMA17: StepperParams = {
  n: 50,
  kt: 0.166,
  j: 54e-7,
  // iron / eddy-current and bearing losses as viscous damping (ζ ≈ 0.07 at the 1.1 krad/s rotor resonance)
  b: 8e-4,
  tc: 0.004,
  td: 0.022,
  gear: 1,
}
export const NEMA17_R = 1.5
export const NEMA17_L = 2.8e-3

/**
 * 28BYJ-48 5 V unipolar PM stepper: 32 full steps per motor revolution
 * (8 pole pairs, 11.25°), 64:1 gear train → 2048 full steps (4096 half
 * steps) per output revolution, 50 Ω per phase. Kt is sized so one phase at
 * (5 V − 0.9 V ULN2003 drop)/50 Ω holds ≈ 34 mN·m at the output (datasheet
 * pull-in torque ≥ 34.3 mN·m): 0.034 / (64 · 0.082) ≈ 6.5 mN·m/A.
 */
export const BYJ48: StepperParams = {
  n: 8,
  kt: 6.5e-3,
  j: 4e-8,
  b: 1e-7,
  tc: 0.1e-3,
  td: 0.05e-3,
  gear: 64,
}
export const BYJ48_R = 50
export const BYJ48_L = 25e-3

/** Hobby-servo output-shaft constants (motor and gear train lumped, SI). */
export interface ServoParams {
  /** motor + H-bridge resistance seen by the supply (Ω) */
  r: number
  /** back-EMF constant at the output shaft (V·s/rad) */
  ke: number
  /** torque constant at the output shaft incl. gear efficiency (N·m/A) */
  kt: number
  /** reflected inertia (kg·m²) */
  j: number
  /** gear-train Coulomb friction at the output (N·m) */
  tc: number
  /** mechanical travel limits (rad) */
  min: number
  max: number
}

/**
 * TowerPro SG90 at 4.8 V: 0.1 s/60° → 10.5 rad/s no-load
 * (Ke = 4.8 / 10.5 ≈ 0.457 V·s/rad), stall torque 1.8 kgf·cm = 0.177 N·m at
 * ≈ 0.7 A stall current (R ≈ 6.9 Ω, Kt = 0.25 N·m/A — the gear train's
 * efficiency makes Kt < Ke), reflected inertia for ≈ 12 ms mechanical time
 * constant, end stops 3° beyond the 0–180° command range.
 */
export const SG90: ServoParams = {
  r: 6.9,
  ke: 0.457,
  kt: 0.25,
  j: 2e-4,
  tc: 0.008,
  min: (-3 * Math.PI) / 180,
  max: (183 * Math.PI) / 180,
}

export class ServoMech {
  theta: number
  w = 0
  /** motor current of the last step (A, signed) */
  i = 0
  atStop = false
  private stuck = true

  constructor(
    public p: ServoParams,
    theta0: number,
  ) {
    this.theta = theta0
  }

  /** motor current for drive fraction u (−1..1) of supply v (V) */
  current(u: number, v: number): number {
    return (u * v - this.p.ke * this.w) / this.p.r
  }

  /** Advance by dt with drive fraction u (H-bridge duty, signed) and supply v; extra load torque at the shaft. */
  advance(u: number, v: number, tLoad: number, dt: number): void {
    const p = this.p
    // an H-bridge in "off" (u = 0) leaves the motor open: no current, no braking
    this.i = u !== 0 ? this.current(u, v) : 0
    const tm = p.kt * this.i
    const tf = p.tc + Math.max(0, tLoad)
    if (this.stuck || this.w === 0) {
      if (Math.abs(tm) <= tf) {
        this.stuck = true
        this.w = 0
        this.atStop = this.theta <= p.min || this.theta >= p.max
        return
      }
      this.stuck = false
    }
    const s = this.w !== 0 ? Math.sign(this.w) : Math.sign(tm)
    let w1 = this.w + ((tm - tf * s) / p.j) * dt
    if (Math.sign(w1) !== s) {
      w1 = 0
      if (Math.abs(tm) <= tf) this.stuck = true
    }
    let th = this.theta + w1 * dt
    this.atStop = false
    if (th <= p.min) {
      th = p.min
      w1 = 0
      this.atStop = true
    } else if (th >= p.max) {
      th = p.max
      w1 = 0
      this.atStop = true
    }
    this.theta = th
    this.w = w1
  }
}
