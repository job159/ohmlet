/**
 * Motors & drivers family — power output stages for the H-bridge models
 * (./motors.model.ts). Each "leg" is one output pin of a bridge with a
 * high-side switch (supply → OUT) and a low-side switch (OUT → ground)
 * whose ON weights (0..1, the on-fraction of the coming analog step) the
 * driver logic sets before every step. Supply currents therefore flow
 * through the real switches: a bench supply sees the motor current, a
 * brake shorts the winding, an open bridge leaves the inductive current to
 * the freewheel / body diodes.
 *
 *  FetLeg         MOSFET bridge (TB6612FNG, DRV8833, A4988, DRV8825,
 *                 TMC2209): bidirectional on-resistance + intrinsic body
 *                 diodes (OUT → supply, ground → OUT), always present.
 *  DarlingtonLeg  bipolar Darlington bridge (L298): each switch conducts in
 *                 one direction only with a saturation voltage that grows
 *                 with current — V = n·ln(I/Is + 1) + Rs·I, fitted to the
 *                 L298 datasheet typicals VCEsat(H) 1.35 V @ 1 A / 2.0 V @
 *                 2 A and VCEsat(L) 1.2 V @ 1 A / 1.7 V @ 2 A (≈ 2 V total
 *                 drop at 0.5 A). No body diodes: the L298N module's eight
 *                 external flyback diodes are separate sub-circuit elements.
 */
import type { StampContext } from '../mna'
import { pnLimit } from '../mna'
import { Junction, fitJunction, vAt } from './motors-common'

/** MOSFET body diode: ≈ 0.7 V at 10 mA, 0.95 V at 1 A (A4988 VF ≤ 1.2 V at 1.5 A). */
export const BODY_DIODE = fitJunction(0.7, 0.01, 0.95, 1.0)

/** One MOSFET half-bridge output. */
export class FetLeg {
  /** high-side / low-side ON weight for the coming step (0..1) */
  hi = 0
  lo = 0
  private readonly dHi = new Junction(BODY_DIODE.isat, BODY_DIODE.nVt)
  private readonly dLo = new Junction(BODY_DIODE.isat, BODY_DIODE.nVt)

  constructor(
    readonly out: number,
    readonly sup: number,
    readonly gnd: number,
    /** high-side on-conductance (S) */
    public gHi: number,
    /** low-side on-conductance incl. any sense resistor (S) */
    public gLo: number,
  ) {}

  /** Stamp at the candidate solution; returns true when a body diode was step-limited. */
  stamp(ctx: StampContext, x: Float64Array): boolean {
    if (this.out < -1) return false
    if (this.hi > 0) ctx.addConductance(this.sup, this.out, this.hi * this.gHi)
    if (this.lo > 0) ctx.addConductance(this.out, this.gnd, this.lo * this.gLo)
    let lim = this.dHi.stamp(ctx, x, this.out, this.sup, 1)
    if (this.dLo.stamp(ctx, x, this.gnd, this.out, 1)) lim = true
    return lim
  }

  /** Current delivered from OUT into the external load (A). */
  outCurrent(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    const vs = vAt(x, this.sup)
    const vg = vAt(x, this.gnd)
    return (
      this.hi * this.gHi * (vs - vo) -
      this.lo * this.gLo * (vo - vg) -
      this.dHi.current(vo - vs, 1) +
      this.dLo.current(vg - vo, 1)
    )
  }

  /** Current drawn from the supply pin by this leg (negative = returned to it) (A). */
  supplyCurrent(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    const vs = vAt(x, this.sup)
    return this.hi * this.gHi * (vs - vo) - this.dHi.current(vo - vs, 1)
  }

  /** Largest switch current magnitude (for over-current protection) (A). */
  switchCurrent(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    const a = Math.abs(this.hi * this.gHi * (vAt(x, this.sup) - vo))
    const b = Math.abs(this.lo * this.gLo * (vo - vAt(x, this.gnd)))
    return a > b ? a : b
  }

  /** Power dissipated in the switches and body diodes (W). */
  dissipation(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    const vs = vAt(x, this.sup)
    const vg = vAt(x, this.gnd)
    const ih = this.hi * this.gHi * (vs - vo)
    const il = this.lo * this.gLo * (vo - vg)
    return (
      ih * (vs - vo) + il * (vo - vg) + this.dHi.current(vo - vs, 1) * (vo - vs) + this.dLo.current(vg - vo, 1) * (vg - vo)
    )
  }
}

/**
 * A saturated bipolar switch, V = n·ln(I/Is + 1) + Rs·I for V > 0 (no
 * reverse conduction), stamped as a nonlinear two-terminal with the current
 * solved from the voltage by a few Newton steps of the scalar equation.
 */
export class SatSwitch {
  private vLast = 0
  private iLast = 0
  constructor(
    readonly isat: number,
    readonly n: number,
    readonly rs: number,
  ) {}

  /** i(v) and di/dv (A, S) */
  eval(v: number): [number, number] {
    if (!(v > 0)) {
      // reverse / zero bias: a tiny leakage keeps the Jacobian finite
      return [1e-9 * v, 1e-9]
    }
    // f(i) = n·ln(i/Is + 1) + Rs·i − v is increasing and concave: Newton from an upper bound converges
    const iExp = this.isat * (Math.exp(Math.min(v / this.n, 80)) - 1)
    let i = Math.min(v / this.rs, iExp)
    for (let k = 0; k < 30; k++) {
      const f = this.n * Math.log(i / this.isat + 1) + this.rs * i - v
      const df = this.n / (i + this.isat) + this.rs
      const di = f / df
      i -= di
      if (i < 0) i = 0
      if (Math.abs(di) < 1e-12 + 1e-9 * i) break
    }
    return [i, 1 / (this.n / (i + this.isat) + this.rs) + 1e-9]
  }

  stamp(ctx: StampContext, x: Float64Array, a: number, c: number, w: number): boolean {
    if (!(w > 0)) return false
    const vRaw = vAt(x, a) - vAt(x, c)
    const vd = pnLimit(vRaw, this.vLast)
    this.vLast = vd
    const [i, g] = this.eval(vd)
    const iw = w * i
    const gw = w * g
    ctx.addConductance(a, c, gw)
    const ieq = iw - gw * vd
    ctx.addCurrent(a, -ieq)
    ctx.addCurrent(c, ieq)
    this.iLast = iw
    return vd !== vRaw
  }

  current(v: number, w: number): number {
    return w > 0 ? w * this.eval(v)[0] : 0
  }

  get lastCurrent(): number {
    return this.iLast
  }
}

/**
 * Cycle-averaged current-regulated H-bridge of a stepper driver winding
 * (chopper frequency ≈ 20–40 kHz, far above what an analog step resolves).
 * Averaged over a chopping cycle the bridge is a CURRENT SOURCE pushing the
 * DAC target through the winding — as long as the average output voltage
 * that needs stays inside what the bridge can produce: up to +VM while
 * driving, down to `vMin` while the winding current has to fall (fast decay
 * reverses the bridge → negative; slow decay only recirculates → ≈ 0, and
 * the minimum on-time of every cycle even keeps it slightly positive). Out
 * of that range it saturates to a voltage source behind the on-resistance,
 * so the current then rises / falls only as fast as L, R and the back-EMF
 * allow — exactly the limits a real chopper hits (current rise at high step
 * rates, "low-current microstepping" in slow decay).
 *
 *  i(v) = s · median((vMin − s·v)/R, |I|, (vMax − s·v)/R),  s = sign(I)
 *
 * (smoothed corners for Newton). The two outputs are referenced to VM/2
 * through weak (2 × 100 kΩ) dividers so their common mode is defined; the
 * power the winding takes (v·i + i²·R) is drawn from VM explicitly (from the
 * previous step), so the supply sees the motor load.
 */
export class RegulatedBridge {
  active = false
  /** DAC target (A), positive = out of OUTa, through the winding into OUTb */
  target = 0
  /** highest average voltage in the target direction (V) */
  vMax = 0
  /** lowest average voltage in the target direction while decaying (V, may be < 0) */
  vMin = 0
  /** solved winding current / voltage (A, V) */
  i = 0
  v = 0
  private vLast = 0
  private sign = 1
  private static readonly G_ANCHOR = 1 / 100e3
  private static readonly EPS = 1e-3

  constructor(
    readonly a: number,
    readonly b: number,
    readonly sup: number,
    readonly gnd: number,
    /** series on-resistance of the conducting path (Ω) */
    public rOn: number,
  ) {}

  /** f(u) in the target frame and df/du */
  private frame(u: number): [number, number] {
    const R = this.rOn
    const I = Math.abs(this.target)
    const e = RegulatedBridge.EPS
    const lo = (this.vMin - u) / R
    const hi = (this.vMax - u) / R
    // m = smooth max(I, lo)
    const d1 = Math.sqrt((I - lo) * (I - lo) + e * e)
    const m = 0.5 * (I + lo + d1)
    const dmdlo = 0.5 * (1 + (lo - I) / d1)
    // f = smooth min(m, hi)
    const d2 = Math.sqrt((m - hi) * (m - hi) + e * e)
    const f = 0.5 * (m + hi - d2)
    const dfdm = 0.5 * (1 - (m - hi) / d2)
    const dfdhi = 0.5 * (1 - (hi - m) / d2)
    const dfdu = dfdm * dmdlo * (-1 / R) + dfdhi * (-1 / R)
    return [f, dfdu]
  }

  /** current (A, a → b through the load) and di/dv at winding voltage v */
  eval(v: number): [number, number] {
    const s = this.sign
    const [f, df] = this.frame(s * v)
    return [s * f, df]
  }

  /** set the frame for the coming step (sign of the target, or of the current at 0 A) */
  prepare(): void {
    this.sign = this.target > 0 ? 1 : this.target < 0 ? -1 : this.i >= 0 ? 1 : -1
  }

  stamp(ctx: StampContext, x: Float64Array): boolean {
    if (!this.active || this.a < -1 || this.b < -1) return false
    const ga = RegulatedBridge.G_ANCHOR
    ctx.addConductance(this.a, this.sup, ga)
    ctx.addConductance(this.a, this.gnd, ga)
    ctx.addConductance(this.b, this.sup, ga)
    ctx.addConductance(this.b, this.gnd, ga)
    const vRaw = vAt(x, this.a) - vAt(x, this.b)
    const v = pnLimit(vRaw, this.vLast, 2)
    this.vLast = v
    const [i0, g] = this.eval(v)
    // source current i(v) out of node a (from node b): conductance −g, constant i0 − g·v
    ctx.addConductance(this.a, this.b, -g)
    const c = i0 - g * v
    ctx.addCurrent(this.a, c)
    ctx.addCurrent(this.b, -c)
    // the winding power comes from VM (previous step)
    const vm = vAt(x, this.sup) - vAt(x, this.gnd)
    if (vm > 1) {
      const iVm = (this.v * this.i + this.i * this.i * this.rOn) / vm
      ctx.addCurrent(this.sup, -iVm)
      ctx.addCurrent(this.gnd, iVm)
    }
    return v !== vRaw
  }

  settle(x: Float64Array): void {
    if (!this.active || this.a < -1 || this.b < -1) {
      this.i = 0
      this.v = 0
      return
    }
    this.v = vAt(x, this.a) - vAt(x, this.b)
    this.i = this.eval(this.v)[0]
  }

  /** current drawn from VM (A) */
  supplyCurrent(vm: number): number {
    return this.active && vm > 1 ? (this.v * this.i + this.i * this.i * this.rOn) / vm : 0
  }
}

/** L298 source (upper) Darlington: 1.35 V @ 1 A, 2.0 V @ 2 A (datasheet VCEsat(H) typ), n = 50 mV. */
export const L298_SOURCE = satFit(1.35, 2.0, 0.05)
/** L298 sink (lower) Darlington: 1.2 V @ 1 A, 1.7 V @ 2 A (datasheet VCEsat(L) typ). */
export const L298_SINK = satFit(1.2, 1.7, 0.05)

/** Fit V = n·ln(I/Is) + Rs·I through V1 @ 1 A and V2 @ 2 A for a chosen slope n. */
function satFit(v1: number, v2: number, n: number): { isat: number; n: number; rs: number } {
  const rs = v2 - v1 - n * Math.LN2
  const isat = 1 / Math.exp((v1 - rs) / n)
  return { isat, n, rs }
}

/** One L298 bridge output: upper Darlington VS → OUT, lower OUT → GND. */
export class DarlingtonLeg {
  hi = 0
  lo = 0
  private readonly up = new SatSwitch(L298_SOURCE.isat, L298_SOURCE.n, L298_SOURCE.rs)
  private readonly down = new SatSwitch(L298_SINK.isat, L298_SINK.n, L298_SINK.rs)

  constructor(
    readonly out: number,
    readonly sup: number,
    readonly gnd: number,
  ) {}

  stamp(ctx: StampContext, x: Float64Array): boolean {
    if (this.out < -1) return false
    let lim = this.up.stamp(ctx, x, this.sup, this.out, this.hi)
    if (this.down.stamp(ctx, x, this.out, this.gnd, this.lo)) lim = true
    return lim
  }

  outCurrent(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    return this.up.current(vAt(x, this.sup) - vo, this.hi) - this.down.current(vo - vAt(x, this.gnd), this.lo)
  }

  supplyCurrent(x: Float64Array): number {
    if (this.out < -1) return 0
    return this.up.current(vAt(x, this.sup) - vAt(x, this.out), this.hi)
  }

  dissipation(x: Float64Array): number {
    if (this.out < -1) return 0
    const vo = vAt(x, this.out)
    const vsu = vAt(x, this.sup) - vo
    const vsd = vo - vAt(x, this.gnd)
    return this.up.current(vsu, this.hi) * vsu + this.down.current(vsd, this.lo) * vsd
  }
}
