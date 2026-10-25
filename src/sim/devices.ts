/**
 * Analog device models for the MNA solver.
 * Owned by the sim-core agent.
 *
 * Every device exposes:
 *   beginStep(time, dt)  — companion-model updates (capacitor/inductor BE, …)
 *   stamp(ctx, x)        — called EVERY Newton-Raphson iteration; nonlinear
 *                          devices linearize around the candidate solution x
 *                          with pn-junction voltage limiting
 *   endStep(x)           — state / telemetry bookkeeping after convergence
 *   setRuntimeParam(k,v) — live tweaks (pot position, switch state, voltage…)
 *   fillTelemetry(t)     — write device-specific telemetry fields
 *
 * Node indices: -1 = ground, anything < 0 is treated as the 0V reference by
 * `vAt`. The engine never hands devices an unmapped pin (malformed components
 * are excluded before construction).
 */

import type { ComponentInstance, ComponentTelemetry, ParamValue, SimIssue } from '../model/types'
import type { CatalogEntry } from '../model/catalog'
import { paramOf } from '../model/catalog'
import { pnLimit } from './mna'
import type { StampContext } from './mna'

// ------------------------------------------------------------- constants

/** Thermal voltage kT/q at room temperature (V). */
export const VT = 0.025852
/** Closed-switch conductance (S). */
export const G_ON = 20
/** Open-switch conductance (S). */
export const G_OFF = 1e-9
/** LED forward voltage at 10mA, per color (V). */
export const LED_VF: Record<string, number> = {
  red: 1.8,
  green: 2.2,
  yellow: 2.0,
  blue: 3.0,
  white: 3.2,
}
/** LED current that gives full brightness (A). */
export const LED_FULL_CURRENT = 0.01
/** Sustained LED current above this burns it out (A). */
export const LED_BURN_CURRENT = 0.03
/** How long the over-current must be sustained to burn the LED (s). */
export const LED_BURN_TIME = 1e-3

const EXP_CAP = 80
const EXP_CAP_E = Math.exp(EXP_CAP)

/** exp() with a linear continuation above EXP_CAP, so it never overflows. */
function expSafe(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E * (1 + (u - EXP_CAP))
}
/** d/du of expSafe. */
function expSafeDeriv(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E
}

function vAt(x: Float64Array, node: number): number {
  return node >= 0 ? x[node] : 0
}

function clampResistance(r: number): number {
  if (!Number.isFinite(r)) return 1000
  return Math.min(Math.max(r, 1e-3), 1e12)
}

function asNumber(v: ParamValue | undefined, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return fallback
}

function asString(v: ParamValue | undefined, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function asBool(v: ParamValue | undefined, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'on'
  return fallback
}

// ------------------------------------------------------------- interface

export interface AnalogDevice {
  readonly comp: ComponentInstance
  /** true → the engine runs the Newton-Raphson loop */
  readonly nonlinear: boolean
  beginStep(time: number, dt: number): void
  stamp(ctx: StampContext, x: Float64Array): void
  endStep(x: Float64Array): void
  setRuntimeParam(key: string, value: ParamValue): void
  fillTelemetry(t: ComponentTelemetry): void
  /**
   * Nonlinear devices: true when the LAST stamp() clipped a junction /
   * control voltage (pnLimit) — the iterate is not yet a solution of the
   * device equations even if x stopped moving. Read by SimEngine's opt-in
   * strict convergence; never affects the stamps themselves.
   */
  readonly limited?: boolean
  /**
   * Optional runtime diagnostics (a relay coil interrupted without a flyback
   * diode, an over-stressed part …): the issues this device raised since the
   * previous call. SimEngine calls it once per step, right after endStep,
   * inside its runtime issue checks; issues are deduplicated by message
   * there, so returning the same issue again is harmless. An issue without
   * `componentId` is attributed to the PART that owns the device (the
   * parent part for a CatalogEntry.subcircuit element). Return an empty
   * array (ideally a shared constant — this runs every step) when nothing
   * happened. Never called on devices that do not implement it, so legacy
   * models are unaffected.
   */
  issues?(): readonly SimIssue[]
}

/**
 * Shared base for device models: catalog-param helpers + no-op hooks.
 * Exported so models registered with `registerDevice` can extend it.
 */
export abstract class BaseDevice implements AnalogDevice {
  readonly nonlinear: boolean = false
  /** see AnalogDevice.limited */
  limited = false

  constructor(
    readonly comp: ComponentInstance,
    protected readonly entry: CatalogEntry,
    protected readonly nodes: number[],
  ) {}

  protected num(key: string, fallback: number): number {
    return asNumber(paramOf(this.comp.params, this.entry, key), fallback)
  }
  protected str(key: string, fallback: string): string {
    return asString(paramOf(this.comp.params, this.entry, key), fallback)
  }
  protected bool(key: string, fallback: boolean): boolean {
    return asBool(paramOf(this.comp.params, this.entry, key), fallback)
  }

  beginStep(_time: number, _dt: number): void {}
  abstract stamp(ctx: StampContext, x: Float64Array): void
  endStep(_x: Float64Array): void {}
  setRuntimeParam(_key: string, _value: ParamValue): void {}
  fillTelemetry(_t: ComponentTelemetry): void {}
}

// -------------------------------------------------------------- passives

class ResistorDevice extends BaseDevice {
  private g: number
  private i = 0
  private v = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.g = 1 / clampResistance(this.num('resistance', 1000))
  }

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], this.g)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.v * this.g
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'resistance') this.g = 1 / clampResistance(asNumber(value, 1 / this.g))
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
  }
}

class CapacitorDevice extends BaseDevice {
  private c: number
  private vPrev = 0
  private geq = 0
  private ieq = 0
  private i = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.c = Math.max(this.num('capacitance', 1e-5), 1e-15)
  }

  beginStep(_time: number, dt: number): void {
    // backward Euler companion: i = C/dt·v − C/dt·vPrev
    this.geq = this.c / dt
    this.ieq = this.geq * this.vPrev
  }

  stamp(ctx: StampContext): void {
    const a = this.nodes[0]
    const b = this.nodes[1]
    ctx.addConductance(a, b, this.geq)
    ctx.addCurrent(a, this.ieq)
    ctx.addCurrent(b, -this.ieq)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.geq * (v - this.vPrev)
    this.vPrev = v
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'capacitance') this.c = Math.max(asNumber(value, this.c), 1e-15)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
  }
}

class InductorDevice extends BaseDevice {
  private l: number
  private iPrev = 0
  private geq = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.l = Math.max(this.num('inductance', 0.01), 1e-12)
  }

  beginStep(_time: number, dt: number): void {
    // backward Euler companion: i(n+1) = i(n) + dt/L·v(n+1)
    this.geq = dt / this.l
  }

  stamp(ctx: StampContext): void {
    const a = this.nodes[0]
    const b = this.nodes[1]
    ctx.addConductance(a, b, this.geq)
    // constant part of the branch current flows a→b
    ctx.addCurrent(a, -this.iPrev)
    ctx.addCurrent(b, this.iPrev)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.iPrev += this.geq * v
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'inductance') this.l = Math.max(asNumber(value, this.l), 1e-12)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iPrev
  }
}

class PotentiometerDevice extends BaseDevice {
  private rTotal: number
  private pos: number

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.rTotal = clampResistance(this.num('resistance', 10000))
    this.pos = Math.min(Math.max(this.num('position', 0.5), 0), 1)
  }

  stamp(ctx: StampContext): void {
    // pins: [ccw, wiper, cw]; position 0 = wiper at ccw end
    const r1 = Math.max(this.rTotal * this.pos, 0.5)
    const r2 = Math.max(this.rTotal * (1 - this.pos), 0.5)
    ctx.addConductance(this.nodes[0], this.nodes[1], 1 / r1)
    ctx.addConductance(this.nodes[1], this.nodes[2], 1 / r2)
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'position') this.pos = Math.min(Math.max(asNumber(value, this.pos), 0), 1)
    else if (key === 'resistance') this.rTotal = clampResistance(asNumber(value, this.rTotal))
  }
}

class PhotoresistorDevice extends BaseDevice {
  private g: number
  private i = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.g = 0
    this.setLight(this.num('light', 0.5))
  }

  private setLight(light: number): void {
    const l = Math.min(Math.max(light, 0), 1)
    // R = 200Ω · 10^(3·(1−light)): 200Ω bright … 200kΩ dark
    this.g = 1 / (200 * Math.pow(10, 3 * (1 - l)))
  }

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], this.g)
  }

  endStep(x: Float64Array): void {
    this.i = (vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])) * this.g
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'light') this.setLight(asNumber(value, 0.5))
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
  }
}

// -------------------------------------------------------- semiconductors

class DiodeDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  /** saturation current (A) — LEDs override per color */
  protected isat = 1e-12
  /**
   * n·Vt (V) — silicon diode n=1.2 (with Is=1e-12 this puts Vf at ~0.66V @
   * 1mA / ~0.69V @ 5mA, matching a real 1N4148), LEDs n=2.
   */
  protected nVt = 1.2 * VT
  protected vLast = 0
  protected i = 0
  protected v = 0

  stamp(ctx: StampContext, x: Float64Array): void {
    const a = this.nodes[0]
    const c = this.nodes[1]
    const vRaw = vAt(x, a) - vAt(x, c)
    const vd = pnLimit(vRaw, this.vLast)
    this.limited = vd !== vRaw
    this.vLast = vd
    const u = vd / this.nVt
    const id = this.isat * (expSafe(u) - 1)
    const gd = (this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
    ctx.addConductance(a, c, gd)
    const ieq = id - gd * vd
    ctx.addCurrent(a, -ieq)
    ctx.addCurrent(c, ieq)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.isat * (expSafe(this.v / this.nVt) - 1)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
  }
}

export class LedDevice extends DiodeDevice {
  burned = false
  /** current (mA) captured at the moment of burnout, for the issue message */
  burnCurrentMa = 0
  brightness = 0
  private overTime = 0
  private dtLast = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const color = this.str('color', 'red')
    const vf = LED_VF[color] ?? LED_VF.red
    this.nVt = 2 * VT // n = 2
    // choose Is so that V(10mA) = the color's forward voltage
    this.isat = LED_FULL_CURRENT / (expSafe(vf / this.nVt) - 1)
  }

  beginStep(_time: number, dt: number): void {
    this.dtLast = dt
  }

  endStep(x: Float64Array): void {
    super.endStep(x)
    if (!this.burned) {
      if (this.i > LED_BURN_CURRENT) {
        this.overTime += this.dtLast
        if (this.overTime > LED_BURN_TIME) {
          this.burned = true
          this.burnCurrentMa = this.i * 1000
        }
      } else {
        this.overTime = 0
      }
    }
    // burned LEDs keep conducting but stop emitting light
    this.brightness = this.burned ? 0 : Math.min(Math.max(this.i / LED_FULL_CURRENT, 0), 1)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    super.fillTelemetry(t)
    t.ledBrightness = this.brightness
    t.burned = this.burned
  }
}

/** Ebers-Moll BJT (transport form), βF = 150. Pins: [emitter, base, collector]. */
class BjtDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private static readonly IS = 1e-14
  private static readonly BF = 150
  private static readonly BR = 3
  private readonly sgn: number // +1 npn, -1 pnp
  private vbeLast = 0
  private vbcLast = 0
  private iC = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[], pnp: boolean) {
    super(comp, entry, nodes)
    this.sgn = pnp ? -1 : 1
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const nE = this.nodes[0]
    const nB = this.nodes[1]
    const nC = this.nodes[2]
    const s = this.sgn
    const vE = vAt(x, nE)
    const vB = vAt(x, nB)
    const vC = vAt(x, nC)

    // effective (npn-oriented) junction voltages, with step limiting
    const u1Raw = s * (vB - vE)
    const u2Raw = s * (vB - vC)
    const u1 = pnLimit(u1Raw, this.vbeLast)
    const u2 = pnLimit(u2Raw, this.vbcLast)
    this.limited = u1 !== u1Raw || u2 !== u2Raw
    this.vbeLast = u1
    this.vbcLast = u2

    const IS = BjtDevice.IS
    const BF = BjtDevice.BF
    const BR = BjtDevice.BR
    const e1 = u1 / VT
    const e2 = u2 / VT
    const f1 = IS * (expSafe(e1) - 1)
    const f2 = IS * (expSafe(e2) - 1)
    const g1 = (IS * expSafeDeriv(e1)) / VT + 1e-12
    const g2 = (IS * expSafeDeriv(e2)) / VT + 1e-12

    const kr = 1 + 1 / BR
    // npn-oriented terminal currents (into the terminal)
    const IC0 = f1 - f2 * kr
    const IB0 = f1 / BF + f2 / BR
    // partials wrt the effective junction voltages
    const dIC1 = g1
    const dIC2 = -g2 * kr
    const dIB1 = g1 / BF
    const dIB2 = g2 / BR

    // Matrix entries are independent of the npn/pnp sign (it cancels through
    // the chain rule); only the RHS constants carry the sign.
    // row C: iC = dIC1·(vB−vE) + dIC2·(vB−vC) + cC
    ctx.addElement(nC, nB, dIC1 + dIC2)
    ctx.addElement(nC, nE, -dIC1)
    ctx.addElement(nC, nC, -dIC2)
    const cC = s * (IC0 - dIC1 * u1 - dIC2 * u2)
    ctx.addCurrent(nC, -cC)
    // row B
    ctx.addElement(nB, nB, dIB1 + dIB2)
    ctx.addElement(nB, nE, -dIB1)
    ctx.addElement(nB, nC, -dIB2)
    const cB = s * (IB0 - dIB1 * u1 - dIB2 * u2)
    ctx.addCurrent(nB, -cB)
    // row E = −(row C + row B)
    ctx.addElement(nE, nB, -(dIC1 + dIC2 + dIB1 + dIB2))
    ctx.addElement(nE, nE, dIC1 + dIB1)
    ctx.addElement(nE, nC, dIC2 + dIB2)
    ctx.addCurrent(nE, cC + cB)
  }

  endStep(x: Float64Array): void {
    const s = this.sgn
    const vE = vAt(x, this.nodes[0])
    const vB = vAt(x, this.nodes[1])
    const vC = vAt(x, this.nodes[2])
    const f1 = BjtDevice.IS * (expSafe((s * (vB - vE)) / VT) - 1)
    const f2 = BjtDevice.IS * (expSafe((s * (vB - vC)) / VT) - 1)
    this.iC = s * (f1 - f2 * (1 + 1 / BjtDevice.BR))
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iC
  }
}

/**
 * Square-law N-MOSFET (SPICE level 1 with channel-length modulation),
 * Vth = 2V, k = 0.1 A/V², λ = 0.01 /V. Pins: [source, gate, drain].
 *
 * The model is always evaluated in the FIXED source/gate/drain orientation;
 * reverse conduction (vds < 0) uses the device symmetry
 * id(vgs, vds) = −id(vgd, −vds) with the chain-ruled Jacobian. Re-deciding a
 * source/drain node swap every NR iteration while sharing the vgs/vds
 * limiting state across orientations made the limiter reference voltages of
 * the opposite node pair, producing a stable 2-cycle that never converged
 * (drains solved to hundreds of negative volts). Likewise, λ keeps the
 * saturation gds = λ·id instead of a hard 1e-9 floor, so the linearized
 * drain row keeps a realistic output conductance and the linear solve cannot
 * fling the drain arbitrarily far from the operating point.
 */
class NmosDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private static readonly K = 0.1
  private static readonly VTH = 2
  private static readonly LAMBDA = 0.01
  private vgsLast = 0
  private vdsLast = 0
  private iD = 0

  /** Drain current of the symmetric square-law model (telemetry/bookkeeping). */
  private static current(vgs: number, vds: number): number {
    const reverse = vds < 0
    const fVgs = reverse ? vgs - vds : vgs // gate-to-(effective source)
    const fVds = reverse ? -vds : vds
    const vov = fVgs - NmosDevice.VTH
    let id = 0
    if (vov > 0) {
      const cl = 1 + NmosDevice.LAMBDA * fVds
      id =
        fVds < vov
          ? NmosDevice.K * (vov - 0.5 * fVds) * fVds * cl
          : 0.5 * NmosDevice.K * vov * vov * cl
    }
    return reverse ? -id : id
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const nS = this.nodes[0]
    const nG = this.nodes[1]
    const nD = this.nodes[2]

    // step-limit the junction voltages in the fixed orientation, so the
    // limiter state always refers to the same node pair
    const vgsRaw = vAt(x, nG) - vAt(x, nS)
    const vdsRaw = vAt(x, nD) - vAt(x, nS)
    const vgs = pnLimit(vgsRaw, this.vgsLast, 1.0)
    const vds = pnLimit(vdsRaw, this.vdsLast, 1.0)
    this.limited = vgs !== vgsRaw || vds !== vdsRaw
    this.vgsLast = vgs
    this.vdsLast = vds

    // evaluate the square law in the forward frame (effective source = the
    // lower of S/D), then map id and its derivatives back via the chain rule
    const reverse = vds < 0
    const fVgs = reverse ? vgs - vds : vgs
    const fVds = reverse ? -vds : vds

    const K = NmosDevice.K
    const lambda = NmosDevice.LAMBDA
    const vov = fVgs - NmosDevice.VTH
    let fId = 0
    let fGm = 0
    let fGds = 0
    if (vov > 0) {
      const cl = 1 + lambda * fVds
      if (fVds < vov) {
        // triode (λ factor applied here too, so id is continuous at vds = vov)
        fId = K * (vov - 0.5 * fVds) * fVds * cl
        fGm = K * fVds * cl
        fGds = K * (vov - fVds) * cl + K * (vov - 0.5 * fVds) * fVds * lambda
      } else {
        // saturation with channel-length modulation: gds = λ·id > 0
        fId = 0.5 * K * vov * vov * cl
        fGm = K * vov * cl
        fGds = 0.5 * K * vov * vov * lambda
      }
    }

    // iD(vgs, vds) and its partials in the fixed frame:
    //   forward:  ∂iD/∂vgs = gm,   ∂iD/∂vds = gds
    //   reverse:  ∂iD/∂vgs = −gm,  ∂iD/∂vds = gm + gds
    const id = reverse ? -fId : fId
    const dIdVgs = reverse ? -fGm : fGm
    const dIdVds = (reverse ? fGm + fGds : fGds) + 1e-9

    // iD ≈ dIdVgs·(vG−vS) + dIdVds·(vD−vS) + c
    ctx.addElement(nD, nG, dIdVgs)
    ctx.addElement(nD, nD, dIdVds)
    ctx.addElement(nD, nS, -(dIdVgs + dIdVds))
    const c = id - dIdVgs * vgs - dIdVds * vds
    ctx.addCurrent(nD, -c)
    ctx.addElement(nS, nG, -dIdVgs)
    ctx.addElement(nS, nD, -dIdVds)
    ctx.addElement(nS, nS, dIdVgs + dIdVds)
    ctx.addCurrent(nS, c)
  }

  endStep(x: Float64Array): void {
    const vs = vAt(x, this.nodes[0])
    const vg = vAt(x, this.nodes[1])
    const vd = vAt(x, this.nodes[2])
    this.iD = NmosDevice.current(vg - vs, vd - vs)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iD
  }
}

// --------------------------------------------------------------- switches

class PushbuttonDevice extends BaseDevice {
  private pressed: boolean

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.pressed = this.bool('pressed', false)
  }

  stamp(ctx: StampContext): void {
    // pins [A1, A2, B1, B2]; A1/A2 and B1/B2 are netlist-bridged, so a single
    // conductance between the A side and the B side models the contact.
    ctx.addConductance(this.nodes[0], this.nodes[2], this.pressed ? G_ON : G_OFF)
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'pressed') this.pressed = asBool(value, this.pressed)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.pressed = this.pressed
  }
}

class SlideSwitchDevice extends BaseDevice {
  private state: string

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.state = this.str('state', 'a')
  }

  stamp(ctx: StampContext): void {
    // pins [a, common, b]
    ctx.addConductance(this.nodes[1], this.nodes[0], this.state === 'a' ? G_ON : G_OFF)
    ctx.addConductance(this.nodes[1], this.nodes[2], this.state === 'b' ? G_ON : G_OFF)
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'state') this.state = asString(value, this.state)
  }
}

class DipSwitch8Device extends BaseDevice {
  private on: string

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.on = this.str('on', '00000000')
  }

  stamp(ctx: StampContext): void {
    // pins: 1A..8A = indices 0..7, 8B..1B = indices 8..15 → nB = 15 − nA
    for (let i = 0; i < 8; i++) {
      const closed = this.on.charAt(i) === '1'
      ctx.addConductance(this.nodes[i], this.nodes[15 - i], closed ? G_ON : G_OFF)
    }
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'on') this.on = asString(value, this.on)
  }
}

// --------------------------------------------------------------- displays

const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const
const SEGMENT_LIT_CURRENT = 1e-3

/** Common-cathode 7-segment display: 8 LED junctions (a-g + dp) to COM. */
class SevenSegmentDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private readonly isat: number
  private readonly nVt = 2 * VT
  private readonly segNodes: Int32Array
  private readonly comNode: number
  private readonly vLast = new Float64Array(8)
  private readonly segI = new Float64Array(8)

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    // ~2.0V forward at 10mA per segment junction
    this.isat = LED_FULL_CURRENT / (expSafe(2.0 / this.nVt) - 1)
    this.segNodes = new Int32Array(8)
    for (let i = 0; i < SEGMENT_NAMES.length; i++) {
      const seg = SEGMENT_NAMES[i]
      const pinName = seg === 'dp' ? 'DP' : seg.toUpperCase()
      const pinIdx = entry.pins.indexOf(pinName)
      this.segNodes[i] = pinIdx >= 0 && pinIdx < nodes.length ? nodes[pinIdx] : -1
    }
    const comIdx = entry.pins.indexOf('COM1')
    this.comNode = comIdx >= 0 && comIdx < nodes.length ? nodes[comIdx] : -1
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const com = this.comNode
    const vCom = vAt(x, com)
    let limited = false
    for (let i = 0; i < 8; i++) {
      const a = this.segNodes[i]
      const vRaw = vAt(x, a) - vCom
      const vd = pnLimit(vRaw, this.vLast[i])
      if (vd !== vRaw) limited = true
      this.vLast[i] = vd
      const u = vd / this.nVt
      const id = this.isat * (expSafe(u) - 1)
      const gd = (this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
      ctx.addConductance(a, com, gd)
      const ieq = id - gd * vd
      ctx.addCurrent(a, -ieq)
      ctx.addCurrent(com, ieq)
    }
    this.limited = limited
  }

  endStep(x: Float64Array): void {
    const vCom = vAt(x, this.comNode)
    for (let i = 0; i < 8; i++) {
      const vd = vAt(x, this.segNodes[i]) - vCom
      this.segI[i] = this.isat * (expSafe(vd / this.nVt) - 1)
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    const segments: Record<string, boolean> = {}
    for (let i = 0; i < SEGMENT_NAMES.length; i++) {
      segments[SEGMENT_NAMES[i]] = this.segI[i] > SEGMENT_LIT_CURRENT
    }
    t.segments = segments
  }
}

class BuzzerDevice extends BaseDevice {
  private static readonly R = 300
  private sounding = false
  private i = 0

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], 1 / BuzzerDevice.R)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = v / BuzzerDevice.R
    this.sounding = Math.abs(v) > 1
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.sounding = this.sounding
  }
}

// ---------------------------------------------------------------- sources

export class PowerSupplyDevice extends BaseDevice {
  static readonly ROUT = 0.01
  private voltage: number
  /** branch current flowing out of the '+' terminal into the circuit (A) */
  current = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.voltage = this.num('voltage', 5)
  }

  stamp(ctx: StampContext): void {
    ctx.addNorton(this.nodes[0], this.nodes[1], this.voltage, PowerSupplyDevice.ROUT)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.current = (this.voltage - v) / PowerSupplyDevice.ROUT
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'voltage') this.voltage = asNumber(value, this.voltage)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.current
    const v = this.voltage - this.current * PowerSupplyDevice.ROUT
    t.power = this.current * v
  }
}

class FunctionGeneratorDevice extends BaseDevice {
  private static readonly ROUT = 50
  private waveform: string
  private frequency: number
  private amplitude: number
  private offset: number
  private vNow: number
  private i = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.waveform = this.str('waveform', 'square')
    this.frequency = Math.max(this.num('frequency', 1), 0)
    this.amplitude = this.num('amplitude', 2.5)
    this.offset = this.num('offset', 2.5)
    this.vNow = this.offset
  }

  beginStep(time: number, dt: number): void {
    // the solve produces the end-of-step solution → evaluate at t + dt
    const t = time + dt
    const phase = this.frequency * t
    const p = phase - Math.floor(phase)
    let w: number
    switch (this.waveform) {
      case 'sine':
        w = Math.sin(2 * Math.PI * p)
        break
      case 'triangle':
        w = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4
        break
      case 'square':
      default:
        w = p < 0.5 ? 1 : -1
        break
    }
    this.vNow = this.offset + this.amplitude * w
  }

  stamp(ctx: StampContext): void {
    ctx.addNorton(this.nodes[0], this.nodes[1], this.vNow, FunctionGeneratorDevice.ROUT)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = (this.vNow - v) / FunctionGeneratorDevice.ROUT
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    switch (key) {
      case 'waveform':
        this.waveform = asString(value, this.waveform)
        break
      case 'frequency':
        this.frequency = Math.max(asNumber(value, this.frequency), 0)
        break
      case 'amplitude':
        this.amplitude = asNumber(value, this.amplitude)
        break
      case 'offset':
        this.offset = asNumber(value, this.offset)
        break
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
  }
}

// ------------------------------------------------------------ regulators

/** Below this input (V, in−gnd) the LDO's control loop has no headroom: output released. */
const LDO_VIN_MIN = 1.0
/** Width (V) of the smooth enable around LDO_VIN_MIN (fully off ~0.4 V below it). */
const LDO_ENABLE_W = 0.02
/** Smoothing (V) of min(vout, vin − dropout) — keeps the Jacobian continuous. */
const LDO_SMOOTH_V = 0.002
/** Current softness (A) of the "source only" clamp at 0 A (softplus scale). */
const LDO_SOFT_I = 1e-5
/** Max change of the controlled output voltage per Newton iteration (V). */
const LDO_STEP = 0.5

/** Numerically safe softplus s·ln(1 + e^(y/s)); its derivative is σ(y/s). */
function softplus(y: number, s: number): number {
  const u = y / s
  return s * (Math.max(u, 0) + Math.log1p(Math.exp(-Math.abs(u))))
}
function sigmoid(u: number): number {
  return u >= 0 ? 1 / (1 + Math.exp(-u)) : Math.exp(u) / (1 + Math.exp(u))
}

/**
 * Low-dropout linear regulator, pins [in, out, gnd] (e.g. the Blue Pill's
 * on-board 3.3 V LDO). Params: vout (V), dropout (V), rout (Ω), ilimit (A).
 *
 * Behavioral pass element: the output target is Vt = min(vout, vin − dropout)
 * behind `rout`. The pass transistor only SOURCES current (in → out — an LDO
 * cannot sink, so an output back-driven above Vt simply turns it off); with
 * vin − gnd below ~1 V the control loop is dead and the output is released.
 * The input draws exactly the output current (quiescent current not
 * modeled), so the bench supply sees the load.
 *
 * Current limit: quasi-static, like a limit loop of finite bandwidth. After
 * every step whose output current exceeded `ilimit`, the effective series
 * resistance for the NEXT step becomes the one that delivers `ilimit` at the
 * present output voltage (never below `rout`); a short therefore settles at
 * ilimit within a few steps (the first step after the fault may overshoot).
 * Keeping the limit out of the Newton loop is deliberate: a hard current
 * clamp turns the output into a pure current source while the iterate is
 * still far from the solution (cold start from 0 V), and the solve then flings
 * the unloaded rail to hundreds of volts.
 *
 * Newton safety: min() and the 0 A clamp are smoothed (continuous Jacobian),
 * and the controlled output voltage is step-limited between iterations like
 * a pn junction (pnLimit).
 */
export class LdoDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private readonly vout: number
  private readonly dropout: number
  private readonly rout: number
  private readonly ilimit: number
  /** series resistance in effect this step (rout, raised while current-limiting) */
  private rEff: number
  private wLast = 0
  private iOut = 0
  private vinRel = 0
  private voutRel = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.vout = Math.max(this.num('vout', 3.3), 0)
    this.dropout = Math.max(this.num('dropout', 0.25), 0)
    this.rout = Math.max(this.num('rout', 0.05), 1e-4)
    this.ilimit = Math.max(this.num('ilimit', 0.3), 1e-6)
    this.rEff = this.rout
  }

  /** Smooth min(vout, u − dropout) and its derivative wrt u. */
  private target(u: number): [number, number] {
    const a = this.vout
    const b = u - this.dropout
    const r = Math.sqrt((a - b) * (a - b) + LDO_SMOOTH_V * LDO_SMOOTH_V)
    return [0.5 * (a + b - r), 0.5 * (1 + (a - b) / r)]
  }

  /** Output current (A, in → out) and its partials wrt u = vin−gnd and w = vout−gnd. */
  private evaluate(u: number, w: number): { i: number; gu: number; gw: number } {
    // smooth enable e(u) = σ((u − VIN_MIN)/W)
    const eu = sigmoid((u - LDO_VIN_MIN) / LDO_ENABLE_W)
    const deu = (eu * (1 - eu)) / LDO_ENABLE_W
    const [vt, dVtDu] = this.target(u)
    const r = this.rEff
    // pass current, smoothly clamped at 0 (source only)
    const x = (vt - w) / r
    const c = softplus(x, LDO_SOFT_I)
    const dc = sigmoid(x / LDO_SOFT_I)
    return {
      i: eu * c,
      gu: deu * c + (eu * dc * dVtDu) / r,
      gw: -(eu * dc) / r,
    }
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const nIn = this.nodes[0]
    const nOut = this.nodes[1]
    const nG = this.nodes[2]
    const vg = vAt(x, nG)
    const u = vAt(x, nIn) - vg
    const wRaw = vAt(x, nOut) - vg
    const w = pnLimit(wRaw, this.wLast, LDO_STEP)
    this.limited = w !== wRaw
    this.wLast = w
    const { i, gu, gw } = this.evaluate(u, w)
    // linearized I(Vin, Vout, Vg) = gu·Vin + gw·Vout − (gu+gw)·Vg + k,
    // flowing out of `in` and into `out`
    const k = i - gu * u - gw * w
    ctx.addElement(nOut, nIn, -gu)
    ctx.addElement(nOut, nOut, -gw)
    ctx.addElement(nOut, nG, gu + gw)
    ctx.addCurrent(nOut, k)
    ctx.addElement(nIn, nIn, gu)
    ctx.addElement(nIn, nOut, gw)
    ctx.addElement(nIn, nG, -(gu + gw))
    ctx.addCurrent(nIn, -k)
  }

  endStep(x: Float64Array): void {
    const vg = vAt(x, this.nodes[2])
    this.vinRel = vAt(x, this.nodes[0]) - vg
    this.voutRel = vAt(x, this.nodes[1]) - vg
    this.iOut = this.evaluate(this.vinRel, this.voutRel).i
    // quasi-static current limit for the next step
    const headroom = this.target(this.vinRel)[0] - this.voutRel
    const rNeed = headroom / this.ilimit
    this.rEff = rNeed > this.rout ? rNeed : this.rout
  }

  /** True while the current limit is active (series resistance raised). */
  get limiting(): boolean {
    return this.rEff > this.rout
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iOut
    t.power = this.iOut * (this.vinRel - this.voutRel)
    t.values = {
      vin: this.vinRel,
      vout: this.voutRel,
      iout: this.iOut,
      limiting: this.limiting ? 1 : 0,
    }
  }
}

// ----------------------------------------------------------- instruments

/** Multimeter voltmeter input impedance (Ω). */
export const DMM_R_VOLT = 10e6
/** Multimeter ammeter shunt (Ω). */
export const DMM_R_SHUNT = 0.1
/** Ohmmeter test source: open-circuit voltage (V) and source resistance (Ω). */
export const DMM_OHM_V = 1
export const DMM_OHM_R = 10e3
/** Ohmmeter over-range (Ω): above this the display reads OL. */
export const DMM_OHM_MAX = 40e6
/**
 * Multimeter integration gate (s of simulated time): the display shows the
 * mean over this window, ~10 readings per second like a bench DMM — the
 * same window as the 量測 tab's net row (instruments/measure.ts
 * NET_LIVE_WINDOW_S), so on a PWM net both read duty × V_high.
 */
export const DMM_GATE_S = 0.1

const SI_PREFIXES: [number, string][] = [
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
]

/**
 * Where a meter display rests at zero, per unit: a magnitude below `floor`
 * is under the meter's resolution and reads zero in the `prefix` range
 * (V below 1 µV → "0.000 mV", A below 1 nA → "0.00 µA", Ω below 1 mΩ →
 * "0.00 Ω") — never a solver residue such as 2.786e-40 printed as a value.
 */
const READING_ZERO: Record<string, { floor: number; prefix: string }> = {
  V: { floor: 1e-6, prefix: 'm' },
  A: { floor: 1e-9, prefix: 'µ' },
  'Ω': { floor: 1e-3, prefix: '' },
}
/** Other units: zero below the lowest SI range (n). */
const READING_ZERO_DEFAULT = { floor: 1e-9, prefix: '' }

/** `x` with `sig` significant digits in plain decimal notation (never an exponent). */
function plainDigits(x: number, sig: number): string {
  const text = x.toPrecision(sig)
  if (!text.includes('e')) return text
  const decimals = sig - 1 - Math.floor(Math.log10(Math.abs(x)))
  return x.toFixed(Math.min(100, Math.max(0, decimals)))
}

/**
 * Autoranged meter display string: `sig` significant digits with an SI
 * prefix, e.g. formatReading(3.29812, 'V', 4) → "3.298 V",
 * formatReading(0.01234, 'A', 3) → "12.3 mA", formatReading(4700, 'Ω', 3) →
 * "4.70 kΩ". The range follows |value|; below the unit's resolution floor
 * (READING_ZERO) the display reads zero with the same digits ("0.000 mV",
 * "0.00 µA"), never signed and never in exponent notation. Non-finite values
 * read "OL" (over-range).
 */
export function formatReading(value: number, unit: string, sig: number): string {
  if (!Number.isFinite(value)) return 'OL'
  const a = Math.abs(value)
  const zero = READING_ZERO[unit] ?? READING_ZERO_DEFAULT
  if (a < zero.floor) return `${(0).toPrecision(sig)} ${zero.prefix}${unit}`
  let k = SI_PREFIXES.findIndex(([s]) => a >= s * 0.9995)
  if (k < 0) k = SI_PREFIXES.length - 1
  for (;;) {
    const [scale, prefix] = SI_PREFIXES[k]
    const text = plainDigits(value / scale, sig)
    // rounding may carry into the next decade (999.96 → "1000"): re-range
    if (Math.abs(parseFloat(text)) >= 1000 && k > 0) {
      k -= 1
      continue
    }
    return `${text} ${prefix}${unit}`
  }
}

type DmmMode = 'V' | 'A' | 'Ω'

function dmmMode(v: string): DmmMode {
  if (v === 'A') return 'A'
  // U+03A9 (catalog) and U+2126 OHM SIGN, plus a typed fallback
  if (v === 'Ω' || v === 'Ω' || v.toLowerCase() === 'ohm') return 'Ω'
  return 'V'
}

/**
 * Bench digital multimeter, pins [COM, IN], runtime param `mode`, exactly
 * as its catalog support text states:
 *   V — 10 MΩ input impedance between IN and COM, reads V(IN) − V(COM)
 *   A — 0.1 Ω shunt between IN and COM (wire it in series), reads the
 *       current flowing IN → COM through the meter
 *   Ω — 1 V / 10 kΩ test source (IN positive), reads V/I between the probes;
 *       like a real meter the reading is meaningless in a powered circuit
 *       (an external voltage pushing current back reads OL)
 * DC only. Telemetry: values.reading (V / A / Ω; +Infinity = OL) and
 * text = [display string, mode label].
 *
 * Like a real integrating DMM the display is a GATE MEAN, not the last
 * solver step: endStep accumulates the probe voltage · dt over DMM_GATE_S of
 * simulated time and publishes the gate's mean (V: the mean voltage, A: the
 * mean current, Ω: the resistance the mean probe voltage stands for), so a
 * PWM pin reads duty × V_high instead of flipping between 0 V and 3.3 V
 * with the step it happened to land on. Until the first gate completes (a
 * new circuit, a mode change) the running mean is published, so a DC
 * circuit reads at once. values.reading, text and (A mode) current all carry
 * this one published value — the 3D LCD, the inspector and the 量測 tab
 * never disagree.
 */
export class MultimeterDevice extends BaseDevice {
  private mode: DmmMode
  /** the published (gate-mean) reading */
  private reading = 0
  /** dt of the step being solved (beginStep) */
  private dt = 0
  /** ∫ (V(IN) − V(COM)) dt and the time covered, over the open gate */
  private gateSum = 0
  private gateTime = 0
  /** a full gate has completed since the last (re)start */
  private gated = false

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.mode = dmmMode(this.str('mode', 'V'))
  }

  beginStep(_time: number, dt: number): void {
    this.dt = dt
  }

  stamp(ctx: StampContext): void {
    const com = this.nodes[0]
    const inp = this.nodes[1]
    if (this.mode === 'V') ctx.addConductance(inp, com, 1 / DMM_R_VOLT)
    else if (this.mode === 'A') ctx.addConductance(inp, com, 1 / DMM_R_SHUNT)
    else ctx.addNorton(inp, com, DMM_OHM_V, DMM_OHM_R)
  }

  endStep(x: Float64Array): void {
    const vm = vAt(x, this.nodes[1]) - vAt(x, this.nodes[0])
    // the solution holds over the whole step (backward Euler): weight it by dt
    const h = this.dt > 0 && Number.isFinite(this.dt) ? this.dt : 0
    this.gateSum += vm * h
    this.gateTime += h
    const full = this.gateTime >= DMM_GATE_S * (1 - 1e-9)
    if (full || !this.gated) {
      this.reading = this.fromProbeVoltage(this.gateTime > 0 ? this.gateSum / this.gateTime : vm)
    }
    if (full) {
      this.gated = true
      this.gateSum = 0
      this.gateTime = 0
    }
  }

  /** The reading a (mean) probe voltage V(IN) − V(COM) stands for in the current mode. */
  private fromProbeVoltage(vm: number): number {
    if (this.mode === 'V') return vm
    if (this.mode === 'A') return vm / DMM_R_SHUNT
    const i = (DMM_OHM_V - vm) / DMM_OHM_R
    const r = i > 0 ? vm / i : Infinity
    return r >= 0 && r <= DMM_OHM_MAX ? r : Infinity
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key !== 'mode') return
    const mode = dmmMode(asString(value, this.mode))
    if (mode === this.mode) return
    this.mode = mode
    // a new range starts a new measurement: the old gate measured another circuit
    this.gateSum = 0
    this.gateTime = 0
    this.gated = false
  }

  fillTelemetry(t: ComponentTelemetry): void {
    let text: string
    if (this.mode === 'V') {
      text = Math.abs(this.reading) > 1000 ? 'OL' : formatReading(this.reading, 'V', 4)
      t.text = [text, 'DC V']
    } else if (this.mode === 'A') {
      text = Math.abs(this.reading) > 10 ? 'OL' : formatReading(this.reading, 'A', 3)
      t.current = this.reading
      t.text = [text, 'DC A']
    } else {
      text = formatReading(this.reading, 'Ω', 3)
      t.text = [text, 'Ω']
    }
    t.values = { reading: this.reading }
  }
}

// ---------------------------------------------------------------- factory

/** Factory of an externally registered device model (same signature as the built-ins). */
export type DeviceFactory = (
  comp: ComponentInstance,
  entry: CatalogEntry,
  nodes: number[],
) => AnalogDevice

const deviceRegistry = new Map<string, DeviceFactory>()

/**
 * Register an additional analog device model (catalog `sim.model` or a
 * SubcircuitElement `model`). Built-in model names take precedence.
 */
export function registerDevice(model: string, factory: DeviceFactory): void {
  deviceRegistry.set(model, factory)
}

/** Names of the externally registered device models. */
export function registeredDevices(): string[] {
  return [...deviceRegistry.keys()]
}

/**
 * Instantiate the analog model named `model` (from catalog `sim.model`).
 * `nodes` holds the solver node index of each catalog pin (-1 = ground).
 * Returns null for unknown model names.
 */
export function createDevice(
  model: string,
  comp: ComponentInstance,
  entry: CatalogEntry,
  nodes: number[],
): AnalogDevice | null {
  switch (model) {
    case 'resistor':
      return new ResistorDevice(comp, entry, nodes)
    case 'capacitor':
      return new CapacitorDevice(comp, entry, nodes)
    case 'inductor':
      return new InductorDevice(comp, entry, nodes)
    case 'potentiometer':
      return new PotentiometerDevice(comp, entry, nodes)
    case 'photoresistor':
      return new PhotoresistorDevice(comp, entry, nodes)
    case 'diode':
      return new DiodeDevice(comp, entry, nodes)
    case 'led':
      return new LedDevice(comp, entry, nodes)
    case 'npn':
      return new BjtDevice(comp, entry, nodes, false)
    case 'pnp':
      return new BjtDevice(comp, entry, nodes, true)
    case 'nmos':
      return new NmosDevice(comp, entry, nodes)
    case 'pushbutton':
      return new PushbuttonDevice(comp, entry, nodes)
    case 'slide_switch':
      return new SlideSwitchDevice(comp, entry, nodes)
    case 'dip_switch_8':
      return new DipSwitch8Device(comp, entry, nodes)
    case 'seven_segment':
      return new SevenSegmentDevice(comp, entry, nodes)
    case 'buzzer':
      return new BuzzerDevice(comp, entry, nodes)
    case 'power_supply':
      return new PowerSupplyDevice(comp, entry, nodes)
    case 'function_generator':
      return new FunctionGeneratorDevice(comp, entry, nodes)
    case 'ldo':
      return new LdoDevice(comp, entry, nodes)
    case 'multimeter':
      return new MultimeterDevice(comp, entry, nodes)
    default: {
      const f = deviceRegistry.get(model)
      return f ? f(comp, entry, nodes) : null
    }
  }
}
