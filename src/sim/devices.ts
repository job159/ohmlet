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
/**
 * Rated continuous forward current of a 5 mm indicator LED (A) — the
 * catalog's ratings.ifMax (Kingbright WP7113: IF 20 mA). Telemetry `light`
 * = I / this rating (luminous intensity is close to linear in IF).
 */
export const LED_RATED_CURRENT = 0.02

/**
 * LED junction temperature and burn-out (honesty fix F11 — replaces the old
 * "above 30 mA for 1 ms burns it" rule, which blew up a 5 mm LED on the most
 * common beginner choice, 100 Ω on 5 V = 31 mA, that a real LED survives for
 * a very long time).
 *
 * First-order thermal model of a 5 mm epoxy LED with its leads in a
 * breadboard, driven by the power the solver itself computes (P = Vf · I,
 * the junction's own voltage and current every step):
 *
 *   Tj → LED_AMBIENT_C + LED_RTH_JA · P   with time constant LED_THERMAL_TAU
 *   (exact exponential step, so any analog step length gives the same curve)
 *
 *  - LED_RTH_JA 350 K/W: junction-to-ambient thermal resistance of a 5 mm
 *    through-hole LED — the datasheets of the common 5 mm parts list
 *    RthJA ≈ 300–400 K/W (heat leaves through the lead frame; the epoxy
 *    lens is a poor conductor).
 *  - LED_THERMAL_TAU 5 s: the junction heats with the die, reflector cup and
 *    lead frame — a few seconds, not milliseconds (the light of an
 *    over-driven LED droops over seconds) and not minutes (the leads, not
 *    the whole lens, set it).
 *  - LED_AMBIENT_C 25 °C: room temperature, the datasheets' reference.
 *  - LED_TJ_MAX_C 100 °C: the datasheets' maximum junction temperature.
 *    Above it the LED is overheating (telemetry damage 'overheating', heat
 *    ≥ 1 — it smokes) but not yet dead; it clears below LED_TJ_COOL_C.
 *  - LED_TJ_BURN_C 150 °C: far beyond the epoxy's glass transition
 *    (≈ 120–130 °C): the lens expands and lifts the bond wire — the LED
 *    burns OPEN (latched until the simulation is reset or rebuilt).
 *  - LED_PEAK_CURRENT 150 mA held for LED_PEAK_TIME 1 ms: a gross overload.
 *    5 mm LEDs are rated for 100–160 mA only as 0.1 ms pulses at 1/10 duty;
 *    held ten times longer the die or the 25 µm bond wire fails at once —
 *    an LED straight across a supply (hundreds of amperes in the solver,
 *    which has only the supply's 10 mΩ to limit it) or 5 V through 10 Ω
 *    (300 mA) burns within a millisecond or two.
 *
 * What this gives (steady state, red / blue): 20 mA → 38 / 46 °C; 31 mA
 * (100 Ω on 5 V) → 45 / 58 °C — over its 20 mA rating (the 3D flicker and
 * the Problems warning say so) but it never burns; 66 mA (47 Ω) → 69 / 97 °C;
 * the junction passes 100 °C at ≈ 111 / 69 mA (overheating, smoking) and
 * would reach 150 °C at ≈ 183 / 114 mA (a blue LED at 120 mA burns after
 * ≈ 15 s; anything above 150 mA burns at once). Light output is not
 * derated with temperature (the catalog says so).
 */
export const LED_RTH_JA = 350
export const LED_THERMAL_TAU = 5
export const LED_AMBIENT_C = 25
export const LED_TJ_MAX_C = 100
/** an overheating LED is "cool" again below this (hysteresis, °C) */
export const LED_TJ_COOL_C = 95
export const LED_TJ_BURN_C = 150
export const LED_PEAK_CURRENT = 0.15
export const LED_PEAK_TIME = 1e-3
/**
 * The junction model heats with at most this power (W). One step of the
 * solver may report an absurd power (the first, not yet converged step of a
 * power-on: at least tens of kilowatts in a 330 Ω LED circuit), which would "cook"
 * the junction in one 50 µs step.
 * Physically it only matters below the instant-burn current (150 mA ≈ 0.3–0.5
 * W); above that LED_PEAK_CURRENT decides within a millisecond — at 5 W one
 * 50 µs step adds ≈ 0.02 K.
 */
export const LED_HEAT_P_CAP = 5
/**
 * Instant burn-out rule of the per-die RGB LED model (src/sim/models/basic.model.ts):
 * the same gross-overload limit as LED_PEAK_CURRENT / LED_PEAK_TIME (it used
 * to be 30 mA for 1 ms — see above). The RGB dies do not run the junction
 * temperature model yet.
 */
export const LED_BURN_CURRENT = LED_PEAK_CURRENT
/** How long the RGB die current must stay above LED_BURN_CURRENT to burn it (s). */
export const LED_BURN_TIME = LED_PEAK_TIME

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
  /**
   * Optional (顯示電流, src/sim/coordinator/current-tracker.ts): ADD the
   * current flowing INTO each pin — out[off + k] for nodes[k], A — under the
   * LAST stamp() evaluated at the solution `x`: the very currents the stamps
   * put into the solver's KCL, but per pin (`out` arrives zeroed). The
   * tracker calls it after the solve and before endStep, and only while two
   * pins of the device that are not one internal conductor sit on the same
   * node — there the stamps, which name nodes, not pins, give only the
   * node's total (a DIP switch's commons on one rail, a pot wired as a
   * rheostat, a diode-connected transistor). Its values split that total.
   * NaN = a pin the model does not book (a complex branch): when it is the
   * only such terminal on the shared node it takes the rest of the node's
   * total (KCL), otherwise the node's pins publish unknown. Without the hook
   * they publish unknown whenever the device puts a current there.
   * Pure: never changes the device's state.
   */
  terminalCurrents?(x: Float64Array, out: Float64Array, off: number): void
  /**
   * Optional (換新 — SimEngine.repairParts): the part is replaced by a new
   * one IN PLACE — its latched damage (an LED burned open, a resistor burned
   * open, a vented electrolytic) and the thermal / stress history that led
   * there start afresh, as in a newly built model; the circuit, the solution
   * and every other part carry on. Returns false, changing nothing, when no
   * damage is latched (an intact or merely hot part is not replaced: its
   * temperature is a real state, not damage). If the cause is still there the
   * running simulation damages it again. Never called on devices that do not
   * implement it.
   */
  repair?(): boolean
}

/**
 * terminalCurrents helper: a branch from pin `a` to pin `b` (device pin
 * indices) with conductance `g` and a constant part `i0` flowing a → b
 * inside the device — what ctx.addConductance(nodes[a], nodes[b], g) plus
 * ctx.addCurrent(nodes[a], −i0) / ctx.addCurrent(nodes[b], i0) stamp.
 */
export function bookBranch(
  out: Float64Array,
  off: number,
  nodes: ArrayLike<number>,
  x: Float64Array,
  a: number,
  b: number,
  g: number,
  i0 = 0,
): void {
  if (a < 0 || b < 0 || a >= nodes.length || b >= nodes.length) return
  const na = nodes[a]
  const nb = nodes[b]
  const i = g * ((na >= 0 ? x[na] : 0) - (nb >= 0 ? x[nb] : 0)) + i0
  out[off + a] += i
  out[off + b] -= i
}

/** terminalCurrents helper: a Norton source from pin `plus` to pin `minus` (ctx.addNorton(nodes[plus], nodes[minus], v, rout)). */
export function bookNorton(
  out: Float64Array,
  off: number,
  nodes: ArrayLike<number>,
  x: Float64Array,
  plus: number,
  minus: number,
  v: number,
  rout: number,
): void {
  // exactly MnaSystem.addNorton's decomposition: g between the pins, v·g pushed out of '+'
  const g = 1 / (rout > 1e-6 ? rout : 1e-6)
  bookBranch(out, off, nodes, x, plus, minus, g, -v * g)
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

/**
 * Resistor self-heating (only for a part with a stated power rating —
 * catalog ratings.pMax, ¼ W for the film resistor): `heat` is the dissipated
 * power / pMax through a first-order thermal filter with time constant
 * RES_THERMAL_TAU — the body's temperature rise relative to the rise at
 * rated power (a ¼ W film resistor reaches ≈ 155 °C at its rating; a small
 * leaded resistor's thermal time constant is on the order of ten seconds).
 * Above RES_HOT_ON it is overheating (hot, smoking — telemetry damage
 * 'overheating', clears below RES_HOT_OFF). At RES_BURN_HEAT — ten times
 * the rated temperature rise, the film is destroyed — it burns open: the
 * resistor latches open (G_OFF, the current stops) until it is replaced
 * (換新: repair()) or the simulation is reset or the circuit is edited (a
 * fresh engine). Only a sustained gross overload gets there: IEC 60115-1's
 * short-time overload (6.25× rated power for 5 s) never does; 58× (10 Ω
 * across 12 V = 14.4 W in a ¼ W part) burns it in ≈ 1.9 s.
 */
export const RES_THERMAL_TAU = 10
export const RES_HOT_ON = 1.0
export const RES_HOT_OFF = 0.9
export const RES_BURN_HEAT = 10

class ResistorDevice extends BaseDevice {
  private g: number
  private i = 0
  private v = 0
  /** rated power (W), NaN = no rating → no thermal model */
  private readonly pMax: number
  private heat = 0
  private hot = false
  private hotSince = 0
  private open = false
  private burnedAt = NaN
  private burnPowerW = 0
  private reportPending = false
  private dtLast = 0
  private tStep = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.g = 1 / clampResistance(this.num('resistance', 1000))
    const p = entry.ratings?.pMax
    this.pMax = typeof p === 'number' && p > 0 ? p : NaN
  }

  beginStep(time: number, dt: number): void {
    this.dtLast = dt
    this.tStep = time
  }

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], this.open ? G_OFF : this.g)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.open ? G_OFF : this.g)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.v * (this.open ? G_OFF : this.g)
    if (!(this.pMax > 0) || this.open) {
      if (this.open && this.heat > 0) this.heat *= Math.exp(-this.dtLast / RES_THERMAL_TAU)
      return
    }
    const dt = this.dtLast
    if (dt > 0) {
      const ratio = Math.abs(this.v * this.i) / this.pMax
      this.heat += (ratio - this.heat) * (1 - Math.exp(-dt / RES_THERMAL_TAU))
    }
    const tEnd = this.tStep + dt
    if (!this.hot && this.heat > RES_HOT_ON) {
      this.hot = true
      this.hotSince = tEnd
    } else if (this.hot && this.heat < RES_HOT_OFF) {
      this.hot = false
    }
    if (this.heat >= RES_BURN_HEAT) {
      // the film burned open: latched until a fresh model (reset / rebuild)
      this.burnPowerW = Math.abs(this.v * this.i)
      this.open = true
      this.burnedAt = tEnd
      this.hot = false
      this.reportPending = true
    }
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'resistance') this.g = 1 / clampResistance(asNumber(value, 1 / this.g))
  }

  /** the film burned open (latched) */
  get burnedOpen(): boolean {
    return this.open
  }

  /** 換新 (AnalogDevice.repair): a new resistor — closed, cold, nothing to report */
  repair(): boolean {
    if (!this.open) return false
    this.open = false
    this.heat = 0
    this.hot = false
    this.hotSince = 0
    this.burnedAt = NaN
    this.burnPowerW = 0
    this.reportPending = false
    return true
  }

  issues(): readonly SimIssue[] {
    if (!this.reportPending) return NO_ISSUES
    this.reportPending = false
    const id = this.comp.id
    return [
      {
        level: 'error',
        message: `${id} burned open (${fmtWatts(this.burnPowerW)} in a ${fmtWatts(this.pMax)} resistor) — use a larger resistance or a higher-wattage resistor`,
        componentId: id,
      },
    ]
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
    if (this.heat >= 0.5) t.heat = Math.round(this.heat * 100) / 100
    if (this.open) t.damage = { kind: 'burned', since: this.burnedAt }
    else if (this.hot) t.damage = { kind: 'overheating', since: this.hotSince }
  }
}

const NO_ISSUES: readonly SimIssue[] = []

/** "2.5 W" / "250 mW" for the damage messages (3 significant digits). */
export function fmtWatts(w: number): string {
  const x = Math.abs(w)
  return x >= 1 ? `${+x.toPrecision(3)} W` : `${+(x * 1000).toPrecision(3)} mW`
}

/**
 * Electrolytic (polarized) capacitor reversed: an aluminium electrolytic
 * tolerates about 1 V of reverse voltage; beyond that the oxide is
 * stripped, it heats and its pressure vent opens. Modelled as accumulated
 * stress = ∫ (Vrev − CAP_REVERSE_OK) / CAP_VENT_VS dt — 5 V reverse vents it
 * in about one second, 2 V in four, ≤ 1 V never. Venting is latched
 * (telemetry damage 'vented') until it is replaced (換新: repair()) or the
 * simulation is reset or the circuit is edited (a fresh engine); the electrical
 * model itself is unchanged (a real vented part has lost capacitance and
 * may short — the problem text says so).
 */
export const CAP_REVERSE_OK = 1.0
export const CAP_VENT_VS = 4

class CapacitorDevice extends BaseDevice {
  private c: number
  private vPrev = 0
  private geq = 0
  private ieq = 0
  private i = 0
  private readonly polarized: boolean
  private ventStress = 0
  private vented = false
  private ventedAt = NaN
  private ventReverseV = 0
  private reportPending = false
  private dtLast = 0
  private tStep = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.c = Math.max(this.num('capacitance', 1e-5), 1e-15)
    this.polarized = this.bool('polarized', false)
  }

  beginStep(time: number, dt: number): void {
    // backward Euler companion: i = C/dt·v − C/dt·vPrev
    this.geq = this.c / dt
    this.ieq = this.geq * this.vPrev
    this.dtLast = dt
    this.tStep = time
  }

  /** the vent opened (reverse voltage, latched) */
  get isVented(): boolean {
    return this.vented
  }

  /**
   * 換新 (AnalogDevice.repair): a new capacitor — vent closed, no reverse
   * stress. Its voltage (vPrev) is kept: the new part takes the old one's
   * place in a running circuit, so no artificial charging spike.
   */
  repair(): boolean {
    if (!this.vented) return false
    this.vented = false
    this.ventedAt = NaN
    this.ventStress = 0
    this.ventReverseV = 0
    this.reportPending = false
    return true
  }

  issues(): readonly SimIssue[] {
    if (!this.reportPending) return NO_ISSUES
    this.reportPending = false
    const id = this.comp.id
    return [
      {
        level: 'error',
        message: `${id} vented: ${this.ventReverseV.toFixed(2)} V reverse voltage on a polarized capacitor — turn it around (+ lead toward the higher voltage)`,
        componentId: id,
      },
    ]
  }

  stamp(ctx: StampContext): void {
    const a = this.nodes[0]
    const b = this.nodes[1]
    ctx.addConductance(a, b, this.geq)
    ctx.addCurrent(a, this.ieq)
    ctx.addCurrent(b, -this.ieq)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.geq, -this.ieq)
  }

  endStep(x: Float64Array): void {
    const v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.geq * (v - this.vPrev)
    this.vPrev = v
    if (this.polarized && !this.vented && -v > CAP_REVERSE_OK && this.dtLast > 0) {
      this.ventStress += ((-v - CAP_REVERSE_OK) / CAP_VENT_VS) * this.dtLast
      if (this.ventStress >= 1) {
        this.vented = true
        this.ventedAt = this.tStep + this.dtLast
        this.ventReverseV = -v
        this.reportPending = true
      }
    }
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'capacitance') this.c = Math.max(asNumber(value, this.c), 1e-15)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    if (this.vented) t.damage = { kind: 'vented', since: this.ventedAt }
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

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.geq, this.iPrev)
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

  /** each track half's own current (a rheostat: wiper tied to an end) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const r1 = Math.max(this.rTotal * this.pos, 0.5)
    const r2 = Math.max(this.rTotal * (1 - this.pos), 0.5)
    bookBranch(out, off, this.nodes, x, 0, 1, 1 / r1)
    bookBranch(out, off, this.nodes, x, 1, 2, 1 / r2)
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

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.g)
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

  /** the junction's last linearization (both leads on one node: its stamp's own current) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const vd = this.vLast
    const u = vd / this.nVt
    const id = this.isat * (expSafe(u) - 1)
    const gd = (this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
    bookBranch(out, off, this.nodes, x, 0, 1, gd, id - gd * vd)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
  }
}

/** Round to 0.001 (telemetry `light`): stable values keep the 3D diff quiet. */
export function roundLight(x: number): number {
  return x > 0 && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0
}

/**
 * The eye's averaging time for LED telemetry (s of SIMULATED time): `light`,
 * `current` and `power` of an LED are the mean over the last LED_EYE_S —
 * about how long the eye integrates light (flicker fusion near 50 Hz), so a
 * PWM-driven LED (hundreds of hertz and up) shows its average and a slow
 * blinker shows on and off.
 */
export const LED_EYE_S = 0.02
/** the eye window is kept in this many equal buckets (1 ms each) */
const LED_EYE_BUCKETS = 20
const LED_EYE_B = LED_EYE_S / LED_EYE_BUCKETS
/** switching detector: on above this fraction of the window's peak current … */
export const LED_SWITCH_ON = 0.5
/** … off again below this fraction (Schmitt hysteresis: ripple is no switching) */
export const LED_SWITCH_OFF = 0.25
/** … of at least this peak (A): a dark LED's nanoampere wiggles never count */
export const LED_SWITCH_FLOOR_A = 50e-6
/** on / off crossings inside the eye window that make its mean an average of a switching current */
export const LED_SWITCH_EDGES = 2
/**
 * … and the switching must REPEAT: a whole on/off cycle (the last
 * LED_SWITCH_EDGES + 1 crossings) inside LED_SWITCH_HOLD_WINDOWS eye windows,
 * i.e. a blink of 25 Hz or faster. Once switching, the verdict holds while
 * every cycle still fits those windows (+ LED_SWITCH_SLACK buckets: a
 * crossing is known only to its bucket and its step, so one steady cycle can
 * measure up to two buckets more than the one that latched the verdict).
 * That makes the verdict a property of the blink, not of its phase: a steady
 * 25–50 Hz blink puts one or two crossings in a window depending on its phase,
 * and an isolated short pulse (a 10 ms flash every 60 ms, a sine that lights
 * the LED only near its peaks) puts two in a window once per period — neither
 * may flip the 平均 label frame after frame. The first is always an average,
 * the second never (the eye sees it blink).
 */
export const LED_SWITCH_HOLD_WINDOWS = 2
/** one cycle may measure this many buckets more while the verdict holds (see LED_SWITCH_HOLD_WINDOWS) */
const LED_SWITCH_SLACK = 2
/** a cycle that latches the verdict spans at most this many buckets … */
const LED_SWITCH_CYCLE_B = LED_SWITCH_HOLD_WINDOWS * LED_EYE_BUCKETS
/** … and one that keeps it at most this many */
const LED_SWITCH_HOLD_B = LED_SWITCH_CYCLE_B + LED_SWITCH_SLACK
/** crossings remembered: one whole cycle */
const LED_SWITCH_RING = LED_SWITCH_EDGES + 1

/**
 * Eye-averaged LED telemetry (pwm-fade, glow NP3): one junction's window.
 *
 * What an LED shows is the MEAN of the current its junction carried over
 * the last LED_EYE_S of simulated time (∫ i dt / ∫ dt — the way
 * CurrentTracker.drain() averages pinCurrents over a frame), not one
 * instant: a 1 kHz PWM LED fades smoothly in 3D instead of strobing between
 * on and off samples, at any frame rate and any simulation speed, and a
 * reader that looks only now and then (a check after a button press) still
 * sees what the LED does NOW, not a blend of the last second. A steady LED
 * reads exactly what an instant sample reads.
 *
 * The current is the one the solver's own KCL used — the junction's Newton
 * linearization evaluated at the solution, what the rest of the circuit and
 * pinCurrents see — and only from steps whose last Newton iteration was not
 * step-limited (`limited`: x is then no solution of the junction equation;
 * the first step of a power-on can read 10¹⁸ A as a raw Shockley value).
 * Before any such step the mean is 0; a window holding none keeps the last
 * mean. Reading is pure: telemetry() twice gives the same values.
 *
 * Kept in LED_EYE_BUCKETS buckets of LED_EYE_S / LED_EYE_BUCKETS (by
 * absolute simulated time) plus the one leaving the window, weighted by the
 * part of it still inside: the mean glides, no jump when a bucket retires.
 *
 * Switching: on / off crossings of the current (Schmitt levels LED_SWITCH_ON
 * / LED_SWITCH_OFF of the window's peak, at least LED_SWITCH_FLOOR_A); with
 * LED_SWITCH_EDGES of them inside the window (a whole on or off phase) and a
 * whole on/off cycle inside LED_SWITCH_HOLD_WINDOWS windows (it repeats) the
 * mean averages a switching current (PWM, a blink of 25 Hz or faster: never
 * a 1 Hz blinker, never an isolated short flash) — telemetry values.iPeak
 * then lets a reader say 平均 / average. The verdict holds while every cycle
 * still fits those windows, so a steady blink keeps one label frame after
 * frame instead of flipping with its phase.
 */
export class LedWindow {
  private readonly n = LED_EYE_BUCKETS + 1
  private readonly q = new Float64Array(LED_EYE_BUCKETS + 1)
  private readonly e = new Float64Array(LED_EYE_BUCKETS + 1)
  private readonly t = new Float64Array(LED_EYE_BUCKETS + 1)
  private readonly pk = new Float64Array(LED_EYE_BUCKETS + 1)
  /** absolute index of the newest bucket (floor(t / bucket)); −1 = none yet */
  private cur = -1
  /** end time of the last step (s) */
  private tNow = 0
  /** Schmitt state and its reference (the window's peak when the newest bucket opened) */
  private on = false
  private refPeak = 0
  /** the last mean read (kept while the window holds no usable step) */
  private lastI = 0
  private lastP = 0
  /**
   * Switching verdict (hysteresis, LED_SWITCH_HOLD_WINDOWS): latched when a
   * crossing leaves LED_SWITCH_EDGES of them inside the eye window and closes
   * a cycle of at most LED_SWITCH_CYCLE_B buckets; cleared once the cycle in
   * progress has outgrown LED_SWITCH_HOLD_B. edgeAt = absolute bucket of each
   * of the last LED_SWITCH_RING crossings (ring, newest at edgeHead).
   */
  private switching = false
  private readonly edgeAt = new Float64Array(LED_SWITCH_RING).fill(-Infinity)
  private edgeHead = 0

  /**
   * One solved step ending at `tEnd`: junction current `i` (A) at junction
   * voltage `v` (V) over `dt` s; `limited` = the last Newton iteration was
   * step-limited (not used, see the class doc).
   */
  add(i: number, v: number, dt: number, tEnd: number, limited = false): void {
    if (!(dt > 0) || !Number.isFinite(tEnd)) return
    this.tNow = tEnd
    const k = Math.max(0, Math.floor(tEnd / LED_EYE_B - 1e-9))
    if (k !== this.cur) this.rotate(k)
    if (limited || !Number.isFinite(i)) return
    const s = k % this.n
    this.q[s] += i * dt
    if (Number.isFinite(v)) this.e[s] += v * i * dt
    this.t[s] += dt
    if (i > this.pk[s]) this.pk[s] = i
    const ref = Math.max(this.refPeak, LED_SWITCH_FLOOR_A)
    if (this.on ? i < ref * LED_SWITCH_OFF : i > ref * LED_SWITCH_ON) {
      this.on = !this.on
      this.edgeHead = (this.edgeHead + 1) % LED_SWITCH_RING
      this.edgeAt[this.edgeHead] = k
      // the eye window now holds LED_SWITCH_EDGES crossings (a whole on or off phase) and the
      // last cycle fits the hold windows (the switching repeats): the mean averages a switching current
      if (this.edgeBack(LED_SWITCH_EDGES - 1) > k - LED_EYE_BUCKETS && this.edgeBack(LED_SWITCH_EDGES) >= k - LED_SWITCH_CYCLE_B) {
        this.switching = true
      }
    }
  }

  /** bucket of the crossing `back` crossings before the newest (0: the newest; −Infinity: none so far) */
  private edgeBack(back: number): number {
    return this.edgeAt[(this.edgeHead - back + LED_SWITCH_RING) % LED_SWITCH_RING]
  }

  /** Forget everything (the LED burned: what it shows starts afresh). */
  clear(): void {
    this.q.fill(0)
    this.e.fill(0)
    this.t.fill(0)
    this.pk.fill(0)
    this.on = false
    this.refPeak = 0
    this.lastI = 0
    this.lastP = 0
    this.switching = false
    this.edgeAt.fill(-Infinity)
    this.edgeHead = 0
  }

  private rotate(k: number): void {
    if (k < this.cur) {
      this.clear() // time went back (never in one engine): start over
    } else {
      const from = Math.max(this.cur + 1, k - this.n + 1)
      for (let j = from; j <= k; j++) {
        const s = j % this.n
        this.q[s] = 0
        this.e[s] = 0
        this.t[s] = 0
        this.pk[s] = 0
      }
    }
    this.cur = k
    this.refPeak = this.peak()
    // the cycle in progress (from the oldest of the last LED_SWITCH_EDGES crossings) has outgrown
    // the hold: no longer switching. Runs before a crossing in bucket k is counted, so a crossing
    // that closes a too-long cycle finds the verdict cleared and cannot latch it (span > CYCLE_B).
    if (this.switching && this.edgeBack(LED_SWITCH_EDGES - 1) < k - LED_SWITCH_HOLD_B) this.switching = false
  }

  /** the highest current inside the window (A) */
  peak(): number {
    let p = 0
    for (let s = 0; s < this.n; s++) if (this.pk[s] > p) p = this.pk[s]
    return p
  }

  /** mean current (A) and power (W) over the eye window; whether it averages a switching current */
  read(): { i: number; p: number; peak: number; switching: boolean } {
    if (this.cur < 0) return { i: this.lastI, p: this.lastP, peak: 0, switching: false }
    // the bucket leaving the window counts with the part of it still inside
    const oldest = this.cur - LED_EYE_BUCKETS
    const f = oldest >= 0 ? Math.min(1, Math.max(0, this.cur + 1 - this.tNow / LED_EYE_B)) : 0
    let q = 0
    let e = 0
    let t = 0
    for (let j = this.cur - LED_EYE_BUCKETS + 1; j <= this.cur; j++) {
      if (j < 0) continue
      const s = j % this.n
      q += this.q[s]
      e += this.e[s]
      t += this.t[s]
    }
    if (oldest >= 0 && f > 0) {
      const s = oldest % this.n
      q += f * this.q[s]
      e += f * this.e[s]
      t += f * this.t[s]
    }
    if (t > 0) {
      this.lastI = q / t
      this.lastP = e / t
    }
    return { i: this.lastI, p: this.lastP, peak: this.peak(), switching: this.switching }
  }
}

/**
 * The current a Shockley junction stamped at the (limited) voltage `vd`
 * carries at junction voltage `v` — its Newton linearization, i.e. what the
 * solver's KCL used (DiodeDevice.stamp: id + gd·(v − vd)).
 */
export function junctionKclCurrent(isat: number, nVt: number, vd: number, v: number): number {
  const u = vd / nVt
  const id = isat * (expSafe(u) - 1)
  const gd = (isat * expSafeDeriv(u)) / nVt + 1e-12
  return id + gd * (v - vd)
}

/**
 * A single LED junction (catalog `led`, every board's on-board LED): the
 * Shockley diode above plus the junction-temperature burn model (see
 * LED_RTH_JA … LED_PEAK_TIME). Once burned it is OPEN — a real LED killed by
 * over-current almost always fails open (the bond wire breaks) — and dark,
 * latched until a fresh model (換新: repair(), reset / rebuild). Its telemetry current,
 * power and light are eye-averaged over the last LED_EYE_S of simulated
 * time (LedWindow); ledBrightness (the I / 10 mA scale) stays the instant
 * value it always was — the classic chrome shows that scale of the eye mean
 * (src/instruments/led-light.ts classicLedBrightness), so its Current and
 * Brightness rows agree; the burn and thermal models use every step's own
 * current.
 */
export class LedDevice extends DiodeDevice {
  burned = false
  /** current (mA) captured at the moment of burnout, for the issue message */
  burnCurrentMa = 0
  /** simulation time (s) of the burnout (NaN while intact) */
  burnedAt = NaN
  brightness = 0
  /** the eye window of the telemetry (see LedWindow) */
  private readonly win = new LedWindow()
  private overTime = 0
  private dtLast = 0
  private tStep = 0
  /** rated continuous forward current (A): the catalog's ifMax, else 20 mA */
  private readonly rated: number
  /** modelled junction temperature (°C) */
  private tj = LED_AMBIENT_C
  /** above LED_TJ_MAX_C (cleared below LED_TJ_COOL_C) */
  private hot = false
  private hotSince = 0
  /** cached 1 − exp(−dt/τ) for the last step length */
  private alphaDt = -1
  private alpha = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const color = this.str('color', 'red')
    const vf = LED_VF[color] ?? LED_VF.red
    this.nVt = 2 * VT // n = 2
    // choose Is so that V(10mA) = the color's forward voltage
    this.isat = LED_FULL_CURRENT / (expSafe(vf / this.nVt) - 1)
    const ifMax = entry.ratings?.ifMax
    this.rated = typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_RATED_CURRENT
  }

  beginStep(time: number, dt: number): void {
    this.dtLast = dt
    this.tStep = time
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    if (!this.burned) {
      super.stamp(ctx, x)
      return
    }
    // burned open: only the open-circuit leakage of G_OFF remains
    this.limited = false
    ctx.addConductance(this.nodes[0], this.nodes[1], G_OFF)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    if (this.burned) bookBranch(out, off, this.nodes, x, 0, 1, G_OFF)
    else super.terminalCurrents(x, out, off)
  }

  endStep(x: Float64Array): void {
    const dt = this.dtLast
    if (dt > 0 && dt !== this.alphaDt) {
      this.alphaDt = dt
      this.alpha = 1 - Math.exp(-dt / LED_THERMAL_TAU)
    }
    if (this.burned) {
      this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
      this.i = this.v * G_OFF
      if (dt > 0) this.tj += (LED_AMBIENT_C - this.tj) * this.alpha // an open junction cools down
      this.brightness = 0
      this.win.add(this.i, this.v, dt, this.tStep + dt) // (linear: exactly the stamped leakage)
      return
    }
    super.endStep(x)
    // the eye window: the current the solver's KCL used this step (see LedWindow)
    this.win.add(junctionKclCurrent(this.isat, this.nVt, this.vLast, this.v), this.v, dt, this.tStep + dt, this.limited === true)
    if (dt > 0) {
      // the junction's own dissipation (a reverse-biased LED leaks pA: ~0)
      const p = Math.min(Math.max(0, this.v * this.i), LED_HEAT_P_CAP)
      this.tj += (LED_AMBIENT_C + LED_RTH_JA * p - this.tj) * this.alpha
      // a gross overload: above the peak pulse rating for longer than a pulse may last
      this.overTime = this.i > LED_PEAK_CURRENT ? this.overTime + dt : 0
    }
    const tEnd = this.tStep + dt
    if (this.overTime > LED_PEAK_TIME || this.tj >= LED_TJ_BURN_C) {
      this.burned = true
      this.burnCurrentMa = this.i * 1000
      this.burnedAt = tEnd
      this.hot = false
      this.brightness = 0
      this.win.clear() // from now on it shows what a burned-open LED does: nothing
      return
    }
    if (!this.hot && this.tj > LED_TJ_MAX_C) {
      this.hot = true
      this.hotSince = tEnd
    } else if (this.hot && this.tj < LED_TJ_COOL_C) {
      this.hot = false
    }
    this.brightness = Math.min(Math.max(this.i / LED_FULL_CURRENT, 0), 1)
  }

  /** modelled junction temperature (°C) */
  get junctionC(): number {
    return this.tj
  }

  /**
   * 換新 (AnalogDevice.repair): a new LED — intact, at ambient temperature,
   * its eye window empty (dark until the next solved step), and the Newton
   * seed of a fresh junction (the burned stamp left vLast frozen at the burn).
   */
  repair(): boolean {
    if (!this.burned) return false
    this.burned = false
    this.burnCurrentMa = 0
    this.burnedAt = NaN
    this.overTime = 0
    this.tj = LED_AMBIENT_C
    this.hot = false
    this.hotSince = 0
    this.brightness = 0
    this.vLast = 0
    this.win.clear()
    return true
  }

  /** relative luminous intensity: I / rated (0 when burned or reverse-biased) */
  get light(): number {
    return this.burned ? 0 : roundLight(this.i / this.rated)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    // eye-averaged over the last LED_EYE_S of simulated time (LedWindow)
    const w = this.win.read()
    t.current = w.i
    t.power = w.p
    // the classic chrome's I / 10 mA scale: the instant value, as it always was
    t.ledBrightness = this.brightness
    t.burned = this.burned
    t.light = this.burned ? 0 : roundLight(w.i / this.rated)
    // the current shown averages a switching (PWM) current: say so (平均)
    if (w.switching && !this.burned) t.values = { iPeak: w.peak }
    // thermal stress: junction temperature rise / the rise at its maximum junction
    // temperature (1 = LED_TJ_MAX_C), published like the resistor's from 0.5 on
    const heat = (this.tj - LED_AMBIENT_C) / (LED_TJ_MAX_C - LED_AMBIENT_C)
    if (heat >= 0.5) t.heat = Math.round(heat * 100) / 100
    if (this.burned) t.damage = { kind: 'burned', since: this.burnedAt }
    else if (this.hot) t.damage = { kind: 'overheating', since: this.hotSince }
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
    // the linearization, for terminalCurrents
    const k = this.lin
    k[0] = dIC1
    k[1] = dIC2
    k[2] = cC
    k[3] = dIB1
    k[4] = dIB2
    k[5] = cB
  }

  /** last stamp's linearization: dIC1, dIC2, cC, dIB1, dIB2, cB */
  private readonly lin = new Float64Array(6)

  /** collector and base rows of the last stamp at x; the emitter returns their sum (a diode-connected transistor: B = C) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const vE = vAt(x, this.nodes[0])
    const vB = vAt(x, this.nodes[1])
    const vC = vAt(x, this.nodes[2])
    const k = this.lin
    const iC = (k[0] + k[1]) * vB - k[0] * vE - k[1] * vC + k[2]
    const iB = (k[3] + k[4]) * vB - k[3] * vE - k[4] * vC + k[5]
    out[off] += -(iC + iB)
    out[off + 1] += iB
    out[off + 2] += iC
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
    this.lin[0] = dIdVgs
    this.lin[1] = dIdVds
    this.lin[2] = c
  }

  /** last stamp's linearization: ∂iD/∂vgs, ∂iD/∂vds, constant */
  private readonly lin = new Float64Array(3)

  /** the drain row of the last stamp at x; it returns through the source, the gate takes none */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const vS = vAt(x, this.nodes[0])
    const vG = vAt(x, this.nodes[1])
    const vD = vAt(x, this.nodes[2])
    const k = this.lin
    const iD = k[0] * vG + k[1] * vD - (k[0] + k[1]) * vS + k[2]
    out[off] -= iD
    out[off + 2] += iD
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

  /** the contact, A1 → B1 (the tracker shares each side over its bridged legs) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 2, this.pressed ? G_ON : G_OFF)
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

  /** each contact's own current (a and b tied to one net) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 1, 0, this.state === 'a' ? G_ON : G_OFF)
    bookBranch(out, off, this.nodes, x, 1, 2, this.state === 'b' ? G_ON : G_OFF)
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

  /** each switch's own current, nA → nB (the commons tied to one rail) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    for (let i = 0; i < 8; i++) {
      const closed = this.on.charAt(i) === '1'
      bookBranch(out, off, this.nodes, x, i, 15 - i, closed ? G_ON : G_OFF)
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
  /** device pin index of each segment's anode and of COM1 (−1 = missing) */
  private readonly segPins: Int32Array
  private readonly comPin: number
  private readonly vLast = new Float64Array(8)
  private readonly segI = new Float64Array(8)

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    // ~2.0V forward at 10mA per segment junction
    this.isat = LED_FULL_CURRENT / (expSafe(2.0 / this.nVt) - 1)
    this.segNodes = new Int32Array(8)
    this.segPins = new Int32Array(8)
    for (let i = 0; i < SEGMENT_NAMES.length; i++) {
      const seg = SEGMENT_NAMES[i]
      const pinName = seg === 'dp' ? 'DP' : seg.toUpperCase()
      const pinIdx = entry.pins.indexOf(pinName)
      this.segNodes[i] = pinIdx >= 0 && pinIdx < nodes.length ? nodes[pinIdx] : -1
      this.segPins[i] = pinIdx >= 0 && pinIdx < nodes.length ? pinIdx : -1
    }
    const comIdx = entry.pins.indexOf('COM1')
    this.comNode = comIdx >= 0 && comIdx < nodes.length ? nodes[comIdx] : -1
    this.comPin = comIdx >= 0 && comIdx < nodes.length ? comIdx : -1
  }

  /** each segment junction's last linearization (segments tied together); COM1/COM2 are one conductor */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    for (let i = 0; i < 8; i++) {
      const vd = this.vLast[i]
      const u = vd / this.nVt
      const id = this.isat * (expSafe(u) - 1)
      const gd = (this.isat * expSafeDeriv(u)) / this.nVt + 1e-12
      if (this.segPins[i] >= 0 && this.comPin >= 0) {
        bookBranch(out, off, this.nodes, x, this.segPins[i], this.comPin, gd, id - gd * vd)
      } else {
        // a missing pin stamped against the 0 V reference: nothing to book it on honestly
        if (this.segPins[i] >= 0) out[off + this.segPins[i]] = NaN
        if (this.comPin >= 0) out[off + this.comPin] = NaN
      }
    }
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
    // glow2: each segment's real light, like an LED's `light` — its junction
    // current / the rated 20 mA, rounded to 0.001, not clamped (> 1 = over-driven)
    const segmentLight = {} as NonNullable<ComponentTelemetry['segmentLight']>
    for (let i = 0; i < SEGMENT_NAMES.length; i++) {
      segments[SEGMENT_NAMES[i]] = this.segI[i] > SEGMENT_LIT_CURRENT
      segmentLight[SEGMENT_NAMES[i]] = roundLight(this.segI[i] / LED_RATED_CURRENT)
    }
    t.segments = segments
    t.segmentLight = segmentLight
  }
}

class BuzzerDevice extends BaseDevice {
  private static readonly R = 300
  private sounding = false
  private i = 0

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], 1 / BuzzerDevice.R)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, 1 / BuzzerDevice.R)
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

  /** + and − on one net (shorted by a wire): the current its stamp drives round the short (a subclass with its own stamp overrides it) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookNorton(out, off, this.nodes, x, 0, 1, this.voltage, PowerSupplyDevice.ROUT)
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

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookNorton(out, off, this.nodes, x, 0, 1, this.vNow, FunctionGeneratorDevice.ROUT)
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
    this.lin[0] = gu
    this.lin[1] = gw
    this.lin[2] = k
  }

  /** last stamp's linearization: gu, gw, k */
  private readonly lin = new Float64Array(3)

  /** the pass current of the last stamp at x: into `in`, out of `out`; the ground pin takes none */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const vg = vAt(x, this.nodes[2])
    const l = this.lin
    const i = l[0] * (vAt(x, this.nodes[0]) - vg) + l[1] * (vAt(x, this.nodes[1]) - vg) + l[2]
    out[off] += i
    out[off + 1] -= i
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

  /** pins [COM, IN]: the input impedance, the shunt or the ohmmeter's test source */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    if (this.mode === 'V') bookBranch(out, off, this.nodes, x, 1, 0, 1 / DMM_R_VOLT)
    else if (this.mode === 'A') bookBranch(out, off, this.nodes, x, 1, 0, 1 / DMM_R_SHUNT)
    else bookNorton(out, off, this.nodes, x, 1, 0, DMM_OHM_V, DMM_OHM_R)
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
