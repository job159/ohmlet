/**
 * Motors & drivers family — shared simulation helpers (imported by
 * ./motors.model.ts; not a model plug-in itself).
 *
 * Every motors-family part is a catalog `sim: { kind: 'chip', model:
 * 'motors_part' }` whose ELECTRICAL model lives in its CatalogEntry
 * .subcircuit: one family device (motor armature + rotor, H-bridge output
 * stage …) plus the ordinary on-board parts (flyback diodes, regulator,
 * LEDs, pull resistors) exactly as on the real module. The part chip
 * (MotorsPartChip) owns the component instance: it hands the instance
 * params to its family device (sub-circuit elements only receive their
 * static catalog params), forwards runtime params (load torque, Vref …) and
 * mirrors the device telemetry onto the part. Runtime issues go through
 * AnalogDevice.issues() (SimEngine attributes them to the parent part).
 *
 * Linking is synchronous and deterministic: SimEngine creates a part's
 * chip and IMMEDIATELY afterwards instantiates that part's sub-circuit
 * (engine.ts constructor), so the family-device factory adopts the device
 * into the chip that was created last when the device id is exactly
 * `<part id>.<element id>` of that chip's catalog sub-circuit.
 *
 * Numerics follow src/sim/devices.ts: Norton-only stamps, pn-junction
 * Newton linearization with step limiting (pnLimit), backward-Euler
 * companions for inductances, state and telemetry in endStep.
 */
import type { ComponentInstance, ComponentTelemetry, ParamValue, SimIssue } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import { paramOf } from '../../model/catalog'
import type { StampContext } from '../mna'
import { pnLimit } from '../mna'
import { BaseDevice, bookBranch } from '../devices'

// ------------------------------------------------------------------ math

const EXP_CAP = 80
const EXP_CAP_E = Math.exp(EXP_CAP)

/** exp() with a linear continuation above EXP_CAP (same as devices.ts). */
export function expSafe(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E * (1 + (u - EXP_CAP))
}
export function expSafeDeriv(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E
}

/** Node voltage of solver node `node` (ground and unmapped nodes read 0 V). */
export function vAt(x: Float64Array, node: number): number {
  return node >= 0 ? x[node] : 0
}

export function asNumber(v: ParamValue | undefined, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return fallback
}

export function asBool(v: ParamValue | undefined, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'on'
  return fallback
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Thermal voltage kT/q at room temperature (V), devices.ts VT. */
export const VT = 0.025852

// ------------------------------------------------------------- junctions

/**
 * One exponential junction anode → cathode, i = w·Is·(e^(v/nVt) − 1),
 * scaled by a duty weight w ∈ [0, 1] (0 = not stamped). Used for MOSFET
 * body diodes (fixed w = 1) and for the saturated bipolar Darlington
 * switches of the L298 (w = on-fraction of the analog step), whose
 * saturation voltage grows logarithmically with current like a junction.
 */
export class Junction {
  private vLast = 0
  constructor(
    readonly isat: number,
    readonly nVt: number,
  ) {}

  /** Stamp at the candidate solution; returns true when the junction voltage was step-limited. */
  stamp(ctx: StampContext, x: Float64Array, a: number, c: number, w: number): boolean {
    if (!(w > 0)) return false
    const vRaw = vAt(x, a) - vAt(x, c)
    const vd = pnLimit(vRaw, this.vLast)
    this.vLast = vd
    const u = vd / this.nVt
    const id = w * this.isat * (expSafe(u) - 1)
    const gd = (w * this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
    ctx.addConductance(a, c, gd)
    const ieq = id - gd * vd
    ctx.addCurrent(a, -ieq)
    ctx.addCurrent(c, ieq)
    return vd !== vRaw
  }

  /** Current anode → cathode at the solved voltage `v` with weight `w`. */
  current(v: number, w: number): number {
    return w > 0 ? w * this.isat * (expSafe(v / this.nVt) - 1) : 0
  }

  /** terminalCurrents: the last stamp's linearization between device pins `pa` (anode) → `pc` at x. */
  book(out: Float64Array, off: number, nodes: ArrayLike<number>, x: Float64Array, pa: number, pc: number, w: number): void {
    if (!(w > 0)) return
    const vd = this.vLast
    const u = vd / this.nVt
    const id = w * this.isat * (expSafe(u) - 1)
    const gd = (w * this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
    bookBranch(out, off, nodes, x, pa, pc, gd, id - gd * vd)
  }
}

/**
 * Junction parameters from two datasheet points (V1 at I1, V2 at I2):
 * nVt = (V2 − V1) / ln(I2/I1), Is = I1 / e^(V1/nVt).
 */
export function fitJunction(v1: number, i1: number, v2: number, i2: number): { isat: number; nVt: number } {
  const nVt = (v2 - v1) / Math.log(i2 / i1)
  return { isat: i1 / Math.exp(v1 / nVt), nVt }
}

// ---------------------------------------------------------- logic inputs

/**
 * A logic input read from the analog solution (an MCU edge on an analog
 * net ends the analog step exactly at the edge, so the level changes in
 * the solve right after it). Schmitt behavior: above `vih` → 1, below
 * `vil` → 0, in between the last level is kept and `undefinedNow` is set
 * (the datasheet does not define the level there).
 */
export class LogicInput {
  level: 0 | 1
  undefinedNow = false
  constructor(initial: 0 | 1 = 0) {
    this.level = initial
  }

  /** Returns true when the level changed. */
  update(v: number, vil: number, vih: number): boolean {
    const prev = this.level
    if (!Number.isFinite(v)) v = 0
    this.undefinedNow = false
    if (v >= vih) this.level = 1
    else if (v <= vil) this.level = 0
    else this.undefinedNow = true
    return this.level !== prev
  }
}

// --------------------------------------------------------------- issues

const NO_ISSUES: readonly SimIssue[] = []

/** Every motors-family device registered model name (catalog sub-circuit `model`). */
export const MOTORS_PART_CHIP = 'motors_part'

/**
 * Base of the family devices: parameters come from the PARENT part (the
 * chip hands them over in configure()), runtime issues are returned through
 * AnalogDevice.issues() (SimEngine attributes them to the parent part),
 * element pins are looked up by name in the element's own pin list.
 */
export abstract class MotorsDevice extends BaseDevice {
  /** id of the catalog part this device belongs to (the component id) */
  partId: string
  private queue: SimIssue[] = []
  private raised = new Set<string>()
  private pParams: Record<string, ParamValue> | undefined
  private pEntry: CatalogEntry
  /** step bookkeeping shared by most devices */
  protected t0 = 0
  protected dt = 5e-5

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.partId = comp.id
    this.pParams = comp.params
    this.pEntry = entry
  }

  /** Bind to the parent part (component instance params + catalog entry). */
  configure(part: ComponentInstance, partEntry: CatalogEntry): void {
    this.partId = part.id
    this.pParams = part.params ? { ...part.params } : undefined
    this.pEntry = partEntry
    this.applyParams()
  }

  /** Re-read every parameter (construction, configure). */
  abstract applyParams(): void

  /** A runtime parameter of the parent part changed. */
  setPartParam(key: string, value: ParamValue): void {
    this.pParams = { ...(this.pParams ?? {}), [key]: value }
    this.applyParams()
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    this.setPartParam(key, value)
  }

  /** Parent-part param with the catalog default. */
  protected p(key: string, fallback: number): number {
    return asNumber(paramOf(this.pParams, this.pEntry, key), fallback)
  }
  protected pb(key: string, fallback: boolean): boolean {
    return asBool(paramOf(this.pParams, this.pEntry, key), fallback)
  }
  protected ps(key: string, fallback: string): string {
    const v = paramOf(this.pParams, this.pEntry, key)
    return typeof v === 'string' ? v : fallback
  }

  /** Solver node of an element pin by name (−2 when the element has no such pin). */
  protected node(pin: string): number {
    const i = this.entry.pins.indexOf(pin)
    return i >= 0 && i < this.nodes.length ? this.nodes[i] : -2
  }

  /** Queue an issue once per `key` (re-armed with rearm()). */
  protected raiseIssue(key: string, level: 'error' | 'warning', message: string): void {
    if (this.raised.has(key)) return
    this.raised.add(key)
    this.queue.push({ level, message })
  }

  /** AnalogDevice.issues: the issues raised since the previous call. */
  issues(): readonly SimIssue[] {
    if (this.queue.length === 0) return NO_ISSUES
    const out = this.queue
    this.queue = []
    return out
  }

  protected rearm(key: string): void {
    this.raised.delete(key)
  }

  beginStep(time: number, dt: number): void {
    this.t0 = time
    this.dt = dt
  }

  /** Top-level telemetry of the parent part (values, current, power …). */
  fillPartTelemetry(t: ComponentTelemetry): void {
    this.fillTelemetry(t)
  }
}

/** Two-terminal winding (R + L) backward-Euler companion with an EMF source: v = R·i + L·di/dt + e. */
export class Winding {
  i = 0
  v = 0
  private geq = 0
  private ieq = 0
  constructor(
    public r: number,
    public l: number,
  ) {}

  /** Companion for the coming step (e = back-EMF at the step start, explicit). */
  prepare(dt: number, emf: number): void {
    const lOverDt = this.l / dt
    this.geq = 1 / (this.r + lOverDt)
    this.ieq = this.geq * (lOverDt * this.i - emf)
  }

  /** i (a → b) = geq·(Va − Vb) + ieq */
  stamp(ctx: StampContext, a: number, b: number): void {
    ctx.addConductance(a, b, this.geq)
    ctx.addCurrent(a, -this.ieq)
    ctx.addCurrent(b, this.ieq)
  }

  /** terminalCurrents: the stamped companion's current between device pins `pa` → `pb` at x */
  book(out: Float64Array, off: number, nodes: ArrayLike<number>, x: Float64Array, pa: number, pb: number): void {
    bookBranch(out, off, nodes, x, pa, pb, this.geq, this.ieq)
  }

  /** Accept the solved terminal voltage. */
  settle(v: number): void {
    this.v = v
    this.i = this.geq * v + this.ieq
  }
}
