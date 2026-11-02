/**
 * Basic-parts family: analog device models (registerDevice) and one
 * monitoring chip (registerChip) for the parts in
 * src/model/parts/basic.parts.ts. Owned by the basic-parts engineer.
 *
 * Every model follows the devices.ts patterns: Norton-only stamps, Newton
 * linearization around the candidate solution with junction-voltage
 * limiting, backward-Euler companions for energy storage, state and
 * telemetry in endStep. Nothing here is time-scripted: every current follows
 * from the node voltages, every state change (relay armature, LED burn-out)
 * from computed currents.
 *
 * Models:
 *  - 'rgb_led'        three LED junctions (per-color Vf) to a common lead,
 *                     common cathode or common anode (param `common`)
 *  - 'zener'          Shockley forward junction + exponential reverse
 *                     breakdown at Vz (param `vz`, BZX55 test current 5 mA)
 *  - 'pmos'           square-law P-MOSFET (mirror of the legacy nmos) + body diode
 *  - 'irlz44n'        logic-level power N-MOSFET (IRLZ44N fit) + body diode
 *  - 'nmos_vth'       square-law N-MOSFET with params vth / k / lambda /
 *                     bodyDiode (sub-circuit element, e.g. the BSS138s of the
 *                     level shifter)
 *  - 'basic_iq'       regulator quiescent (ground-pin) current IN → GND
 *  - 'battery'        Thevenin cell: open-circuit voltage + internal resistance
 *  - 'current_source' lab current source with a voltage compliance limit
 *  - 'ntc'            B-equation thermistor (runtime param temperature)
 *  - 'pc817'          optocoupler: IR LED junction + current-controlled
 *                     phototransistor (CTR) with Ebers-Moll saturation
 *  - 'relay_srd05'    relay coil (R + L) + armature (pick-up / drop-out
 *                     hysteresis, operate / release travel) + form-C contacts
 *  - 'basic_subcircuit' host for parts whose whole model is their
 *                     CatalogEntry.subcircuit (stamps nothing itself)
 *  - chip 'basic_relay_monitor' reads the relay coil pins and reports the
 *                     inductive kick of a coil switched off without a
 *                     flyback diode (devices cannot raise SimIssues)
 */

import type { ComponentInstance, ComponentTelemetry, ParamValue } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import type { StampContext } from '../mna'
import { pnLimit } from '../mna'
import {
  BaseDevice,
  bookBranch,
  bookNorton,
  G_OFF,
  G_ON,
  LED_BURN_CURRENT,
  LED_BURN_TIME,
  LED_FULL_CURRENT,
  LED_RATED_CURRENT,
  LedDevice,
  LedWindow,
  PowerSupplyDevice,
  roundLight,
  VT,
  registerDevice,
} from '../devices'
import type { AnalogDevice } from '../devices'
import { registerChip } from '../chip-api'
import type { ChipInstance, ChipStepCtx } from '../chip-api'

// ---------------------------------------------------------------- helpers

const EXP_CAP = 80
const EXP_CAP_E = Math.exp(EXP_CAP)

/** exp() with a linear continuation above EXP_CAP (same as devices.ts). */
function expSafe(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E * (1 + (u - EXP_CAP))
}
function expSafeDeriv(u: number): number {
  return u <= EXP_CAP ? Math.exp(u) : EXP_CAP_E
}

function vAt(x: Float64Array, node: number): number {
  return node >= 0 ? x[node] : 0
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

/**
 * SPICE `pnjlim`: limit the change of a junction voltage between Newton
 * iterations logarithmically once it is above the critical voltage (where
 * the exponential gets steep). Decreases below vcrit pass unchanged.
 */
function pnjlim(vNew: number, vOld: number, nVt: number, vcrit: number): number {
  if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * nVt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / nVt
      return arg > 0 ? vOld + nVt * Math.log(arg) : vcrit
    }
    return nVt * Math.log(vNew / nVt)
  }
  return vNew
}

/**
 * SPICE `fetlim`: limit a MOSFET gate voltage between Newton iterations
 * relative to the threshold `vto`. From cutoff a rising gate jumps straight
 * to vto + 0.5 V, so the device conducts (gm > 0) in the very next
 * linearization — a plain fixed-step limit leaves the stamps unchanged while
 * the gate is still below threshold and Newton "converges" on an off device.
 */
function fetlim(vNew: number, vOld: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vOld - vto)) + 2
  const vtstlo = vtsthi / 2 + 2
  const vtox = vto + 3.5
  const delv = vNew - vOld
  if (vOld >= vto) {
    if (vOld >= vtox) {
      if (delv <= 0) {
        // going off
        if (vNew >= vtox) return -delv > vtstlo ? vOld - vtstlo : vNew
        return Math.max(vNew, vto + 2)
      }
      // staying on
      return delv >= vtsthi ? vOld + vtsthi : vNew
    }
    // middle region
    return delv <= 0 ? Math.max(vNew, vto - 0.5) : Math.min(vNew, vto + 4)
  }
  // off
  if (delv <= 0) return -delv > vtsthi ? vOld - vtsthi : vNew
  const vtemp = vto + 0.5
  if (vNew <= vtemp) return delv > vtstlo ? vOld + vtstlo : vNew
  return vtemp
}

/** SPICE `limvds`: limit a (non-negative-mode) drain-source voltage between Newton iterations. */
function limvds(vNew: number, vOld: number): number {
  if (vOld >= 3.5) {
    if (vNew > vOld) return Math.min(vNew, 3 * vOld + 2)
    return vNew < 3.5 ? Math.max(vNew, 2) : vNew
  }
  return vNew > vOld ? Math.min(vNew, 4) : Math.max(vNew, -0.5)
}

/** Critical voltage of a junction (SPICE vcrit = nVt·ln(nVt / (√2·Is))). */
function vcritOf(isat: number, nVt: number): number {
  return nVt * Math.log(nVt / (Math.SQRT2 * isat))
}

/**
 * Stamp one Shockley junction anode `a` → cathode `c`, linearized at the
 * (already limited) junction voltage vd. Returns the junction current and
 * its small-signal conductance at vd.
 */
function stampJunction(
  ctx: StampContext,
  a: number,
  c: number,
  vd: number,
  isat: number,
  nVt: number,
): { id: number; gd: number } {
  const u = vd / nVt
  const id = isat * (expSafe(u) - 1)
  const gd = (isat * expSafeDeriv(u)) / nVt + 1e-12
  ctx.addConductance(a, c, gd)
  const ieq = id - gd * vd
  ctx.addCurrent(a, -ieq)
  ctx.addCurrent(c, ieq)
  return { id, gd }
}

/** Index of the first of `names` among the entry pins (−1 if none). */
function pinIndex(entry: CatalogEntry, ...names: string[]): number {
  for (const n of names) {
    const i = entry.pins.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

/** Solver node of a pin found by name, else the positional fallback. */
function nodeOf(entry: CatalogEntry, nodes: number[], fallback: number, ...names: string[]): number {
  const i = pinIndex(entry, ...names)
  const k = i >= 0 ? i : fallback
  return k < nodes.length ? nodes[k] : -2
}

// ------------------------------------------------------------------ RGB LED

/**
 * Forward voltage at 10 mA per die of a typical 5 mm RGB LED (datasheet
 * values ≈ 2.0 V red / 3.2 V green / 3.2 V blue at 20 mA; with n = 2 the
 * 10 mA point sits ≈ 36 mV lower). Green and blue are InGaN dies — unlike
 * the single-color catalog LED's 2.2 V GaP green.
 */
export const RGB_VF: readonly [number, number, number] = [1.95, 3.1, 3.1]
const RGB_CHANNELS = ['R', 'G', 'B'] as const

/**
 * 5 mm RGB LED, pins [R, COM, G, B]: three LED junctions to the common lead
 * — common cathode (dies' cathodes on COM) or common anode (anodes on COM).
 * Each die is the catalog LED junction (Shockley, n = 2, Is fitted to its Vf
 * at 10 mA). A die burns out when its current stays above LED_BURN_CURRENT
 * (150 mA, the peak rating) for more than LED_BURN_TIME (1 ms) — it keeps
 * conducting but stops emitting; no junction-temperature model yet.
 *
 * Telemetry, eye-averaged per die over the last LED_EYE_S of simulated time
 * (LedWindow, like the single LED — a PWM-driven die fades instead of
 * strobing): values iR / iG / iB = each die's mean current (A); `light` =
 * the brightest INTACT die's mean / 20 mA; `leds` R / G / B = mean / 10 mA,
 * clamped (0 for a burned die); `rgb` packs those; `current` / `power` =
 * the common lead's means (the sums); values burnedR / burnedG / burnedB =
 * 1 for each burned die (the inspector names it even when it carries no
 * current); values.iPeak while the brightest die's current switches (see
 * LedWindow). ledBrightness stays the instant brightest die (I / 10 mA).
 *
 * Extends LedDevice so the engine's existing LED burn-out issue applies
 * (`burned` = any die burned, `burnCurrentMa` = the current that killed it);
 * every LedDevice method is overridden for the three junctions.
 */
class RgbLedDevice extends LedDevice {
  private readonly anodes = new Int32Array(3)
  private readonly cathodes = new Int32Array(3)
  /** device pin index of each die's anode / cathode (terminalCurrents) */
  private readonly anodePins = new Int32Array(3)
  private readonly cathodePins = new Int32Array(3)
  private readonly isatC = new Float64Array(3)
  private readonly vcritC = new Float64Array(3)
  private readonly nVtC = 2 * VT
  private readonly vLastC = new Float64Array(3)
  /** each die's last stamped junction current / conductance (the KCL current, LedWindow) */
  private readonly idC = new Float64Array(3)
  private readonly gdC = new Float64Array(3)
  private readonly winC = [new LedWindow(), new LedWindow(), new LedWindow()]
  /** each die's last Newton iteration was step-limited (its window skips that step) */
  private readonly limC = new Uint8Array(3)
  private readonly vC = new Float64Array(3)
  private readonly iC = new Float64Array(3)
  private readonly overC = new Float64Array(3)
  private readonly burnedC = [false, false, false]
  private readonly brightC = new Float64Array(3)
  private dtStep = 0
  private tStepC = 0
  readonly commonAnode: boolean

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.commonAnode = this.str('common', 'cathode') === 'anode'
    const com = nodeOf(entry, nodes, 1, 'COM')
    const pinNodes = [nodeOf(entry, nodes, 0, 'R'), nodeOf(entry, nodes, 2, 'G'), nodeOf(entry, nodes, 3, 'B')]
    const at = (fallback: number, name: string): number => {
      const i = pinIndex(entry, name)
      return i >= 0 ? i : fallback
    }
    const comPin = at(1, 'COM')
    const chPins = [at(0, 'R'), at(2, 'G'), at(3, 'B')]
    for (let ch = 0; ch < 3; ch++) {
      this.anodePins[ch] = this.commonAnode ? comPin : chPins[ch]
      this.cathodePins[ch] = this.commonAnode ? chPins[ch] : comPin
      this.anodes[ch] = this.commonAnode ? com : pinNodes[ch]
      this.cathodes[ch] = this.commonAnode ? pinNodes[ch] : com
      this.isatC[ch] = LED_FULL_CURRENT / (expSafe(RGB_VF[ch] / this.nVtC) - 1)
      this.vcritC[ch] = vcritOf(this.isatC[ch], this.nVtC)
    }
  }

  beginStep(time: number, dt: number): void {
    this.dtStep = dt
    this.tStepC = time
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    let limited = false
    for (let ch = 0; ch < 3; ch++) {
      const a = this.anodes[ch]
      const c = this.cathodes[ch]
      const vRaw = vAt(x, a) - vAt(x, c)
      const vd = pnjlim(vRaw, this.vLastC[ch], this.nVtC, this.vcritC[ch])
      if (vd !== vRaw) limited = true
      this.limC[ch] = vd !== vRaw ? 1 : 0
      this.vLastC[ch] = vd
      const j = stampJunction(ctx, a, c, vd, this.isatC[ch], this.nVtC)
      this.idC[ch] = j.id
      this.gdC[ch] = j.gd
    }
    this.limited = limited
  }

  /** each die's last linearization (R, G and B tied to one net: each die keeps its own current) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    for (let ch = 0; ch < 3; ch++) {
      const gd = this.gdC[ch]
      bookBranch(out, off, this.nodes, x, this.anodePins[ch], this.cathodePins[ch], gd, this.idC[ch] - gd * this.vLastC[ch])
    }
  }

  endStep(x: Float64Array): void {
    let anyBurned = false
    let maxBright = 0
    for (let ch = 0; ch < 3; ch++) {
      const v = vAt(x, this.anodes[ch]) - vAt(x, this.cathodes[ch])
      const i = this.isatC[ch] * (expSafe(v / this.nVtC) - 1)
      this.vC[ch] = v
      this.iC[ch] = i
      // the eye window: the current the solver's KCL used this step (LedWindow)
      this.winC[ch].add(this.idC[ch] + this.gdC[ch] * (v - this.vLastC[ch]), v, this.dtStep, this.tStepC + this.dtStep, this.limC[ch] === 1)
      if (!this.burnedC[ch]) {
        if (i > LED_BURN_CURRENT) {
          this.overC[ch] += this.dtStep
          if (this.overC[ch] > LED_BURN_TIME) {
            this.burnedC[ch] = true
            if (!this.burned) {
              this.burnCurrentMa = i * 1000
              this.burnedAt = this.tStepC + this.dtStep
            }
          }
        } else {
          this.overC[ch] = 0
        }
      }
      // a burned die keeps conducting but stops emitting
      const b = this.burnedC[ch] ? 0 : Math.min(Math.max(i / LED_FULL_CURRENT, 0), 1)
      this.brightC[ch] = b
      if (b > maxBright) maxBright = b
      if (this.burnedC[ch]) anyBurned = true
    }
    this.burned = anyBurned
    this.brightness = maxBright
  }

  fillTelemetry(t: ComponentTelemetry): void {
    // eye-averaged per die over the last LED_EYE_S of simulated time (LedWindow)
    const w = [this.winC[0].read(), this.winC[1].read(), this.winC[2].read()]
    // the common lead carries the sum of the three die currents
    t.current = w[0].i + w[1].i + w[2].i
    t.power = w[0].p + w[1].p + w[2].p
    // the classic I / 10 mA scale: the instant brightest die, as it always was
    t.ledBrightness = this.brightness
    t.burned = this.burned
    // relative intensity of the brightest intact die (I / 20 mA), for the 3D glow
    let light = 0
    let brightest = -1
    for (let ch = 0; ch < 3; ch++) {
      if (this.burnedC[ch] || !(w[ch].i / LED_RATED_CURRENT > light)) continue
      light = w[ch].i / LED_RATED_CURRENT
      brightest = ch
    }
    t.light = roundLight(light)
    if (this.burned) t.damage = { kind: 'burned', since: this.burnedAt }
    const leds: Record<string, number> = {}
    let packed = 0
    for (let ch = 0; ch < 3; ch++) {
      // a burned die keeps conducting but stops emitting
      const b = this.burnedC[ch] ? 0 : Math.min(Math.max(w[ch].i / LED_FULL_CURRENT, 0), 1)
      leds[RGB_CHANNELS[ch]] = b
      packed |= Math.round(b * 255) << (8 * (2 - ch))
    }
    t.leds = leds
    t.rgb = [packed]
    const values: Record<string, number> = { iR: w[0].i, iG: w[1].i, iB: w[2].i }
    for (let ch = 0; ch < 3; ch++) if (this.burnedC[ch]) values[`burned${RGB_CHANNELS[ch]}`] = 1
    // the brightness shown (the brightest die's) averages a switching current: say so (平均)
    if (brightest >= 0 && w[brightest].switching) values.iPeak = w[brightest].peak
    t.values = values
  }
}

// -------------------------------------------------------------------- zener

/** BZX55 zener test current IZT (A): Vz is specified at 5 mA. */
export const ZENER_IZT = 5e-3
/**
 * Breakdown knee softness (V): reverse current = IZT·exp((Vr − Vz)/VZS), so
 * the dynamic resistance is VZS / I — 20 Ω at IZT, 100 Ω at 1 mA, 4 Ω at
 * 25 mA (BZX55C5V1 datasheet: rzj ≤ 60 Ω at 5 mA).
 */
export const ZENER_VZS = 0.1

/**
 * Zener diode, pins [anode, cathode]. Forward: the catalog silicon diode
 * (Shockley Is = 1 pA, n = 1.2). Reverse: exponential breakdown anchored at
 * (Vz, IZT). Both branches are limited between Newton iterations with SPICE
 * pnjlim on their own junction variable (forward vd, breakdown Vr − Vz), so
 * a step from 0 V onto a stiff clamp converges without overflow.
 */
class ZenerDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private static readonly IS = 1e-12
  private static readonly NVT = 1.2 * VT
  private readonly vz: number
  private readonly vcritF = vcritOf(ZenerDevice.IS, ZenerDevice.NVT)
  private readonly vcritZ = vcritOf(ZENER_IZT, ZENER_VZS)
  /** reverse current at 0 V subtracted so the device passes exactly 0 A at 0 V */
  private readonly izOffset: number
  private vfLast = 0
  private wLast = -10
  private i = 0
  private v = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.vz = Math.min(Math.max(this.num('vz', 5.1), 1.8), 100)
    this.izOffset = ZENER_IZT * Math.exp(-this.vz / ZENER_VZS)
  }

  /** anode → cathode current at junction voltage v (negative in breakdown). */
  private current(v: number): number {
    const fwd = ZenerDevice.IS * (expSafe(v / ZenerDevice.NVT) - 1)
    const rev = ZENER_IZT * expSafe((-v - this.vz) / ZENER_VZS) - this.izOffset
    return fwd - rev
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const a = this.nodes[0]
    const c = this.nodes[1]
    const vRaw = vAt(x, a) - vAt(x, c)
    // forward junction
    const vf = pnjlim(vRaw, this.vfLast, ZenerDevice.NVT, this.vcritF)
    // breakdown "junction": w = Vr − Vz with Vr = −v
    const wRaw = -vRaw - this.vz
    const w = pnjlim(wRaw, this.wLast, ZENER_VZS, this.vcritZ)
    this.limited = vf !== vRaw || w !== wRaw
    this.vfLast = vf
    this.wLast = w

    const uf = vf / ZenerDevice.NVT
    const iF = ZenerDevice.IS * (expSafe(uf) - 1)
    const gF = (ZenerDevice.IS * expSafeDeriv(uf)) / ZenerDevice.NVT
    const uz = w / ZENER_VZS
    const iR = ZENER_IZT * expSafe(uz) - this.izOffset // cathode → anode
    const gR = (ZENER_IZT * expSafeDeriv(uz)) / ZENER_VZS
    // I(a→c) ≈ iF + gF·(v − vf) − [iR + gR·(−v − vz − w)]
    //        = (gF + gR)·v + (iF − gF·vf − iR + gR·(vz + w))
    const g = gF + gR + 1e-12
    const k = iF - gF * vf - iR + gR * (this.vz + w)
    ctx.addConductance(a, c, g)
    ctx.addCurrent(a, -k)
    ctx.addCurrent(c, k)
    this.linG = g
    this.linK = k
  }

  /** last stamp's linearization I(a→c) ≈ linG·v + linK */
  private linG = 0
  private linK = 0

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.linG, this.linK)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.current(this.v)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
    t.values = { vz: -this.v, iz: -this.i }
  }
}

// ----------------------------------------------------------------- MOSFETs

interface MosSpec {
  /** +1 N-channel, −1 P-channel */
  sgn: 1 | -1
  /** threshold voltage magnitude default (V) — overridable by param `vth` */
  vth: number
  /** transconductance parameter k (A/V²) — param `k` */
  k: number
  /** channel-length modulation (1/V) — param `lambda` */
  lambda: number
  /** body diode present — param `bodyDiode` */
  bodyDiode: boolean
}

/** Body-diode junction (Shockley, Is = 1 pA, n = 1.2 — the catalog diode). */
const BODY_IS = 1e-12
const BODY_NVT = 1.2 * VT
const BODY_VCRIT = vcritOf(BODY_IS, BODY_NVT)

/**
 * Square-law (SPICE level 1) MOSFET with channel-length modulation, both
 * polarities, nodes [source, gate, drain]. Same equations as the legacy
 * NmosDevice (fixed S/G/D orientation, symmetric reverse conduction through
 * the chain rule, λ-based saturation conductance) in an N-frame: for a
 * P-channel device every terminal voltage is negated, the N-frame current is
 * computed and the drain current negated back — the matrix entries are
 * sign-independent, only the RHS constant carries the sign (cf. BjtDevice).
 *
 * Newton limiting is SPICE MOS1's (fetlim on the gate voltage, limvds on
 * vds), not the legacy fixed 1 V step: from cutoff the gate jumps to just
 * above threshold, so a FET switched on hard conducts in the same step
 * instead of creeping up over several steps with unchanged (off) stamps.
 *
 * Optional body diode from the body (tied to the source) to the drain:
 * anode = source for N, anode = drain for P — a separate junction with its
 * own pnjlim state.
 */
class MosfetDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private readonly sgn: 1 | -1
  private readonly vth: number
  private readonly k: number
  private readonly lambda: number
  private readonly bodyDiode: boolean
  private readonly nS: number
  private readonly nG: number
  private readonly nD: number
  private u1Last = 0
  private u2Last = 0
  private vbLast = 0
  private iD = 0
  private iBody = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[], spec: MosSpec) {
    super(comp, entry, nodes)
    this.sgn = spec.sgn
    // `vth` is stated signed for P-channel parts (e.g. −2 V); the N-frame
    // uses its magnitude
    this.vth = Math.min(Math.max(Math.abs(this.num('vth', spec.sgn * spec.vth)), 0.05), 20)
    this.k = Math.min(Math.max(this.num('k', spec.k), 1e-6), 1e4)
    this.lambda = Math.min(Math.max(this.num('lambda', spec.lambda), 0), 1)
    this.bodyDiode = this.bool('bodyDiode', spec.bodyDiode)
    this.nS = nodeOf(entry, nodes, 0, 'source', 'S')
    this.nG = nodeOf(entry, nodes, 1, 'gate', 'G')
    this.nD = nodeOf(entry, nodes, 2, 'drain', 'D')
    const s = pinIndex(entry, 'source', 'S')
    const d = pinIndex(entry, 'drain', 'D')
    this.pinS = s >= 0 ? s : 0
    this.pinD = d >= 0 ? d : 2
  }

  /** device pin index of the source / drain (terminalCurrents) */
  private readonly pinS: number
  private readonly pinD: number

  /** N-frame square law: [id, gm, gds] at (vgs, vds) with vds ≥ 0. */
  private forward(vgs: number, vds: number): [number, number, number] {
    const vov = vgs - this.vth
    if (vov <= 0) return [0, 0, 0]
    const K = this.k
    const lambda = this.lambda
    const cl = 1 + lambda * vds
    if (vds < vov) {
      return [
        K * (vov - 0.5 * vds) * vds * cl,
        K * vds * cl,
        K * (vov - vds) * cl + K * (vov - 0.5 * vds) * vds * lambda,
      ]
    }
    return [0.5 * K * vov * vov * cl, K * vov * cl, 0.5 * K * vov * vov * lambda]
  }

  /** N-frame drain current at (u1 = vgs, u2 = vds), symmetric reverse conduction. */
  private channel(u1: number, u2: number): number {
    const reverse = u2 < 0
    const [id] = this.forward(reverse ? u1 - u2 : u1, reverse ? -u2 : u2)
    return reverse ? -id : id
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const s = this.sgn
    const nS = this.nS
    const nG = this.nG
    const nD = this.nD
    const vS = vAt(x, nS)
    const vG = vAt(x, nG)
    const vD = vAt(x, nD)
    const u1Raw = s * (vG - vS)
    const u2Raw = s * (vD - vS)
    // SPICE MOS1 limiting in the N-frame: fetlim on the gate voltage of the
    // side acting as source (by the previous iterate's vds sign), limvds on vds
    let u1: number
    let u2: number
    if (this.u2Last >= 0) {
      u1 = fetlim(u1Raw, this.u1Last, this.vth)
      u2 = limvds(u1 - (u1Raw - u2Raw), this.u2Last)
    } else {
      const vgd = fetlim(u1Raw - u2Raw, this.u1Last - this.u2Last, this.vth)
      u2 = -limvds(-(u1Raw - vgd), -this.u2Last)
      u1 = vgd + u2
    }
    let limited = Math.abs(u1 - u1Raw) > 1e-12 || Math.abs(u2 - u2Raw) > 1e-12
    this.u1Last = u1
    this.u2Last = u2

    const reverse = u2 < 0
    const [fId, fGm, fGds] = this.forward(reverse ? u1 - u2 : u1, reverse ? -u2 : u2)
    const id = reverse ? -fId : fId
    const dIdU1 = reverse ? -fGm : fGm
    const dIdU2 = (reverse ? fGm + fGds : fGds) + 1e-9
    // actual drain current iD = s·id(u1, u2); ∂iD/∂vG = dIdU1, ∂iD/∂vD = dIdU2
    ctx.addElement(nD, nG, dIdU1)
    ctx.addElement(nD, nD, dIdU2)
    ctx.addElement(nD, nS, -(dIdU1 + dIdU2))
    const c = s * (id - dIdU1 * u1 - dIdU2 * u2)
    ctx.addCurrent(nD, -c)
    ctx.addElement(nS, nG, -dIdU1)
    ctx.addElement(nS, nD, -dIdU2)
    ctx.addElement(nS, nS, dIdU1 + dIdU2)
    ctx.addCurrent(nS, c)
    this.lin[0] = dIdU1
    this.lin[1] = dIdU2
    this.lin[2] = c

    if (this.bodyDiode) {
      const a = s > 0 ? nS : nD
      const k = s > 0 ? nD : nS
      const vbRaw = vAt(x, a) - vAt(x, k)
      const vb = pnjlim(vbRaw, this.vbLast, BODY_NVT, BODY_VCRIT)
      if (vb !== vbRaw) limited = true
      this.vbLast = vb
      const j = stampJunction(ctx, a, k, vb, BODY_IS, BODY_NVT)
      this.lin[3] = j.gd
      this.lin[4] = j.id - j.gd * vb
    }
    this.limited = limited
  }

  /** last stamp's linearization: ∂iD/∂vG, ∂iD/∂vD, constant, body diode gd, ieq */
  private readonly lin = new Float64Array(5)

  /** the drain row of the last stamp at x (returning through the source) plus the body diode; the gate takes none */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const pS = this.pinS
    const pD = this.pinD
    const l = this.lin
    const iD = l[0] * vAt(x, this.nG) + l[1] * vAt(x, this.nD) - (l[0] + l[1]) * vAt(x, this.nS) + l[2]
    out[off + pD] += iD
    out[off + pS] -= iD
    if (this.bodyDiode) {
      // anode = source (N) / drain (P)
      if (this.sgn > 0) bookBranch(out, off, this.nodes, x, pS, pD, l[3], l[4])
      else bookBranch(out, off, this.nodes, x, pD, pS, l[3], l[4])
    }
  }

  endStep(x: Float64Array): void {
    const s = this.sgn
    const vS = vAt(x, this.nS)
    const vG = vAt(x, this.nG)
    const vD = vAt(x, this.nD)
    this.iD = s * this.channel(s * (vG - vS), s * (vD - vS))
    if (this.bodyDiode) {
      const vb = s > 0 ? vS - vD : vD - vS
      this.iBody = BODY_IS * (expSafe(vb / BODY_NVT) - 1)
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    // current INTO the drain terminal (channel + reverse body-diode current)
    t.current = this.iD - this.sgn * this.iBody
    t.values = { id: this.iD, ibody: this.iBody }
  }
}

/** Generic TO-92 P-MOSFET: the legacy nmos constants mirrored (Vth −2 V). */
export const PMOS_SPEC: MosSpec = { sgn: -1, vth: 2, k: 0.1, lambda: 0.01, bodyDiode: true }
/**
 * IRLZ44N fit (Infineon/IR datasheet: VGS(th) 1.0–2.0 V; RDS(on) ≤ 25 mΩ at
 * VGS = 5 V, ≤ 35 mΩ at 4 V): Vth 1.5 V, k = 1/(25 mΩ · 3.5 V) = 11.4 A/V²
 * gives 25 mΩ at 5 V and 35 mΩ at 4 V in the triode region.
 */
export const IRLZ44N_SPEC: MosSpec = { sgn: 1, vth: 1.5, k: 11.4, lambda: 0.01, bodyDiode: true }
/** Generic N-MOSFET element (defaults = the legacy nmos, no body diode). */
export const NMOS_VTH_SPEC: MosSpec = { sgn: 1, vth: 2, k: 0.1, lambda: 0.01, bodyDiode: false }

// --------------------------------------------------------------- regulators

/**
 * Quiescent (ground-pin) current of a linear regulator, pins [in, gnd]:
 * `iq` amps flow IN → GND once the input has headroom, enabled smoothly
 * around 1 V (σ((Vin − 1 V) / 0.1 V)) so the Newton Jacobian stays
 * continuous. Pairs with an 'ldo' element (which models the pass current).
 */
class QuiescentDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private readonly iq: number
  private i = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.iq = Math.max(this.num('iq', 5e-3), 0)
  }

  private evaluate(u: number): [number, number] {
    const z = (u - 1.0) / 0.1
    const e = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
    return [this.iq * e, (this.iq * e * (1 - e)) / 0.1]
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const a = this.nodes[0]
    const b = this.nodes[1]
    const u = vAt(x, a) - vAt(x, b)
    const [i, g] = this.evaluate(u)
    ctx.addConductance(a, b, g)
    const ieq = i - g * u
    ctx.addCurrent(a, -ieq)
    ctx.addCurrent(b, ieq)
    this.linG = g
    this.linI = ieq
  }

  /** last stamp's linearization: I(in → gnd) ≈ linG·u + linI */
  private linG = 0
  private linI = 0

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.linG, this.linI)
  }

  endStep(x: Float64Array): void {
    this.i = this.evaluate(vAt(x, this.nodes[0]) - vAt(x, this.nodes[1]))[0]
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
  }
}

// ----------------------------------------------------------------- sources

/**
 * Battery, pins [+, −]: open-circuit voltage `voltage` behind the internal
 * resistance `rint` (Thevenin, stamped as a Norton). Extends
 * PowerSupplyDevice only so the engine's "supply current > 2 A (possible
 * short circuit)" issue covers batteries too; stamp/endStep are its own.
 * No discharge: the charge never runs down.
 */
class BatteryDevice extends PowerSupplyDevice {
  private voc: number
  private rint: number
  private vTerm = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.voc = Math.max(this.num('voltage', 9), 0)
    this.rint = Math.max(this.num('rint', 1.5), 1e-3)
  }

  stamp(ctx: StampContext): void {
    ctx.addNorton(this.nodes[0], this.nodes[1], this.voc, this.rint)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookNorton(out, off, this.nodes, x, 0, 1, this.voc, this.rint)
  }

  endStep(x: Float64Array): void {
    this.vTerm = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.current = (this.voc - this.vTerm) / this.rint
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'voltage') this.voc = Math.max(asNumber(value, this.voc), 0)
    else if (key === 'rint') this.rint = Math.max(asNumber(value, this.rint), 1e-3)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.current
    t.power = this.current * this.vTerm
    t.values = { voc: this.voc, vterm: this.vTerm, current: this.current }
  }
}

/** CV-mode output resistance of the current source at its compliance limit (Ω). */
export const ISRC_R_CV = 0.1
/** Output conductance in constant-current mode (1 MΩ shunt), S. */
export const ISRC_G_OUT = 1e-6
/** Smoothing (A) of min(Iset, (Vc − v)/R_CV) — keeps the Jacobian continuous. */
const ISRC_SMOOTH_I = 1e-5
/**
 * Newton guard (V above the compliance limit): an iterate that first
 * crosses Vc + ISRC_OVERSHOOT is clamped there, where the CV branch is
 * already stiff — an open load would otherwise solve to I/G_OUT (kV) in the
 * CC linearization. A fixed per-iteration step limit is NOT used: in CC mode
 * the stamps hardly change with v, so Newton would declare convergence on the
 * unlimited (kV) iterate.
 */
const ISRC_OVERSHOOT = 1

/**
 * Lab current source, pins [+, −], params `current` (mA) and `compliance`
 * (V). Output current out of '+' (back into '−'):
 *   i(v) = smin(Iset, (Vc − v) / R_CV) − G_OUT·v
 * i.e. a 1 MΩ-shunted current source until the terminal voltage reaches the
 * compliance limit, where it becomes a Vc voltage source behind 0.1 Ω (CV
 * mode). Smooth min + a first-crossing clamp just above Vc keep Newton
 * stable even with an open load (the output then rises to Vc and stops).
 */
class CurrentSourceDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private iset: number
  private vc: number
  private wLast = 0
  private iOut = 0
  private vOut = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.iset = Math.max(this.num('current', 10), 0) / 1000
    this.vc = Math.max(this.num('compliance', 12), 0)
  }

  private evaluate(w: number): [number, number] {
    const a = this.iset
    const b = (this.vc - w) / ISRC_R_CV
    const r = Math.sqrt((a - b) * (a - b) + ISRC_SMOOTH_I * ISRC_SMOOTH_I)
    const i = 0.5 * (a + b - r) - ISRC_G_OUT * w
    // d/dw: dsmin/db · db/dw − G_OUT (dsmin/db → 0 in CC mode, → 1 in CV mode)
    const g = 0.5 * (1 + (a - b) / r) * (-1 / ISRC_R_CV) - ISRC_G_OUT
    return [i, g]
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const p = this.nodes[0]
    const m = this.nodes[1]
    const wRaw = vAt(x, p) - vAt(x, m)
    const wMax = this.vc + ISRC_OVERSHOOT
    const w = wRaw > wMax && this.wLast < wMax ? wMax : wRaw
    this.limited = w !== wRaw
    this.wLast = w
    const [i, g] = this.evaluate(w)
    // i(v) ≈ i + g·(v − w) injected into '+' (g ≤ 0 → conductance −g)
    ctx.addConductance(p, m, -g)
    const j = i - g * w
    ctx.addCurrent(p, j)
    ctx.addCurrent(m, -j)
    this.linG = g
    this.linJ = j
  }

  /** last stamp's linearization: output ≈ linJ + linG·v out of '+' */
  private linG = 0
  private linJ = 0

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, -this.linG, -this.linJ)
  }

  endStep(x: Float64Array): void {
    this.vOut = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.iOut = this.evaluate(this.vOut)[0]
  }

  /** True while the output sits at the compliance limit (CV mode). */
  get atCompliance(): boolean {
    return (this.vc - this.vOut) / ISRC_R_CV < this.iset - 1e-6
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'current') this.iset = Math.max(asNumber(value, this.iset * 1000), 0) / 1000
    else if (key === 'compliance') this.vc = Math.max(asNumber(value, this.vc), 0)
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iOut
    t.power = this.iOut * this.vOut
    const cv = this.atCompliance
    t.values = { iset: this.iset, iout: this.iOut, vout: this.vOut, compliance: cv ? 1 : 0 }
    t.text = [`${(this.iOut * 1000).toFixed(2)} mA`, cv ? `CV ${this.vc.toFixed(1)} V` : 'CC']
  }
}

// ------------------------------------------------------------- thermistor

/** NTC reference temperature T25 (K). */
const T25 = 298.15

/**
 * NTC thermistor, pins [p1, p2]: R(T) = R25·exp(B·(1/T − 1/T25)) with the
 * part's R25 / B (params `r25`, `beta`) and the runtime param `temperature`
 * (°C). No self-heating.
 */
class NtcDevice extends BaseDevice {
  private readonly r25: number
  private readonly beta: number
  private tempC: number
  private g = 1e-4
  private i = 0
  private v = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.r25 = Math.max(this.num('r25', 10000), 1)
    this.beta = Math.max(this.num('beta', 3950), 1)
    this.tempC = this.num('temperature', 25)
    this.update()
  }

  private update(): void {
    const t = Math.max(this.tempC + 273.15, 1)
    const r = this.r25 * Math.exp(this.beta * (1 / t - 1 / T25))
    this.g = 1 / Math.min(Math.max(r, 1e-3), 1e12)
  }

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nodes[0], this.nodes[1], this.g)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.g)
  }

  endStep(x: Float64Array): void {
    this.v = vAt(x, this.nodes[0]) - vAt(x, this.nodes[1])
    this.i = this.v * this.g
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key === 'temperature') {
      this.tempC = asNumber(value, this.tempC)
      this.update()
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.power = this.i * this.v
    t.values = { resistance: 1 / this.g, temperature: this.tempC }
  }
}

// -------------------------------------------------------------- optocoupler

/** PC817 IR LED: VF = 1.2 V typ at IF = 20 mA (Sharp PC817 datasheet), n = 2. */
const OPTO_NVT = 2 * VT
const OPTO_IS = 20e-3 / (Math.exp(1.2 / OPTO_NVT) - 1)
const OPTO_VCRIT = vcritOf(OPTO_IS, OPTO_NVT)
/**
 * Phototransistor Ebers-Moll betas used for the saturation curve only (the
 * forward current gain is folded into CTR): with βF = 300, βR = 0.5 the
 * saturated VCE is ≈ 0.09 V at IF = 20 mA, IC = 1 mA (datasheet typ 0.1 V,
 * max 0.2 V) and the output reaches 90 % of CTR·IF by VCE ≈ 0.22 V.
 */
const OPTO_BF = 300
const OPTO_BR = 0.5
const OPTO_A = 1 + 1 / OPTO_BR
const OPTO_B = OPTO_BF / OPTO_BR
/** collector-emitter leakage (S) — within the ≤ 100 nA dark current at 20 V */
const OPTO_G_LEAK = 1e-9
/** a point on the saturation knee: h(VCE) climbs from 0 to ≈ 0.9 between ≈ 0.03 V and ≈ 0.22 V */
const OPTO_VCE_KNEE = 0.1

/**
 * Newton step limit for VCE. Off the knee h(VCE) is flat (dh ≈ 0), so a step
 * from the active region overshoots far below it and the one back overshoots
 * above it — a limit cycle (≈ −0.3 V ↔ ≈ 0.7 V with a 10 kΩ pull-up) that
 * never lands in the ≈ 0.2 V wide knee. A step that would cross the knee
 * stops on it first; any other step is limited to 1 V.
 */
export function optoVceLimit(vNew: number, vOld: number): number {
  if ((vOld > OPTO_VCE_KNEE && vNew < OPTO_VCE_KNEE) || (vOld < OPTO_VCE_KNEE && vNew > OPTO_VCE_KNEE)) {
    return OPTO_VCE_KNEE
  }
  return pnLimit(vNew, vOld, 1.0)
}

/**
 * Normalized output h(VCE) = IC / (CTR·IF) of an Ebers-Moll transistor whose
 * base is driven by a fixed photocurrent (the base current eliminated in
 * closed form): h = (t − a)/(t + b), t = exp(VCE/VT), a = 1 + 1/βR,
 * b = βF/βR — 1 in the active region, falling through 0 at the saturation
 * offset VT·ln(a) and to −(βR + 1)/βF in reverse. Returns [h, dh/dVCE].
 */
export function optoOutput(vce: number): [number, number] {
  const v = vce / VT
  if (v >= 0) {
    const e = Math.exp(-v)
    const den = 1 + OPTO_B * e
    return [(1 - OPTO_A * e) / den, ((OPTO_A + OPTO_B) * e) / (den * den * VT)]
  }
  const t = Math.exp(v)
  const den = t + OPTO_B
  return [(t - OPTO_A) / den, (t * (OPTO_A + OPTO_B)) / (den * den * VT)]
}

/**
 * Optocoupler (PC817), pins [anode, cathode, emitter, collector]: IR LED
 * junction anode → cathode; output collector → emitter current
 *   IC = CTR · max(IF, 0) · h(VCE)
 * (current-controlled, CTR = param `ctr` in %). The two sides share no
 * conductance (galvanic isolation). Linearized jointly in (VAK, VCE).
 */
class OptocouplerDevice extends BaseDevice {
  readonly nonlinear: boolean = true
  private readonly ctr: number
  private readonly nA: number
  private readonly nK: number
  private readonly nE: number
  private readonly nC: number
  private vdLast = 0
  private vceLast = 0
  private iF = 0
  private iC = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.ctr = Math.min(Math.max(this.num('ctr', 100), 0), 1000) / 100
    this.nA = nodeOf(entry, nodes, 0, 'anode')
    this.nK = nodeOf(entry, nodes, 1, 'cathode')
    this.nE = nodeOf(entry, nodes, 2, 'emitter')
    this.nC = nodeOf(entry, nodes, 3, 'collector')
    const at = (fallback: number, name: string): number => {
      const i = pinIndex(entry, name)
      return i >= 0 ? i : fallback
    }
    this.pins = Int32Array.of(at(0, 'anode'), at(1, 'cathode'), at(2, 'emitter'), at(3, 'collector'))
  }

  /** device pin index of anode, cathode, emitter, collector (terminalCurrents) */
  private readonly pins: Int32Array
  /** last stamp's linearization: LED gd, ieq; output gA, gC, c0 */
  private readonly lin = new Float64Array(5)

  /**
   * The LED junction and the output row of the last stamp at x, each on its
   * own pins (cathode and emitter both on 0 V — the usual low-side wiring).
   */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    const p = this.pins
    const l = this.lin
    bookBranch(out, off, this.nodes, x, p[0], p[1], l[0], l[1])
    const iC = l[2] * (vAt(x, this.nA) - vAt(x, this.nK)) + l[3] * (vAt(x, this.nC) - vAt(x, this.nE)) + l[4]
    out[off + p[3]] += iC
    out[off + p[2]] -= iC
  }

  stamp(ctx: StampContext, x: Float64Array): void {
    const { nA, nK, nE, nC } = this
    const vdRaw = vAt(x, nA) - vAt(x, nK)
    const vd = pnjlim(vdRaw, this.vdLast, OPTO_NVT, OPTO_VCRIT)
    const vceRaw = vAt(x, nC) - vAt(x, nE)
    const vce = optoVceLimit(vceRaw, this.vceLast)
    this.limited = vd !== vdRaw || vce !== vceRaw
    this.vdLast = vd
    this.vceLast = vce

    const { id, gd } = stampJunction(ctx, nA, nK, vd, OPTO_IS, OPTO_NVT)
    this.lin[0] = gd
    this.lin[1] = id - gd * vd
    const ifPos = id > 0 ? id : 0
    const dIf = id > 0 ? gd : 0
    const [h, dh] = optoOutput(vce)
    const ic = this.ctr * ifPos * h
    const gA = this.ctr * dIf * h // ∂IC/∂VAK
    const gC = this.ctr * ifPos * dh + OPTO_G_LEAK // ∂IC/∂VCE
    // IC (into the collector) ≈ ic + gA·(vAK − vd) + gC·(vCE − vce) + leak
    ctx.addElement(nC, nA, gA)
    ctx.addElement(nC, nK, -gA)
    ctx.addElement(nC, nC, gC)
    ctx.addElement(nC, nE, -gC)
    const c0 = ic - gA * vd - (gC - OPTO_G_LEAK) * vce
    this.lin[2] = gA
    this.lin[3] = gC
    this.lin[4] = c0
    ctx.addCurrent(nC, -c0)
    ctx.addElement(nE, nA, -gA)
    ctx.addElement(nE, nK, gA)
    ctx.addElement(nE, nC, -gC)
    ctx.addElement(nE, nE, gC)
    ctx.addCurrent(nE, c0)
  }

  endStep(x: Float64Array): void {
    const vd = vAt(x, this.nA) - vAt(x, this.nK)
    const vce = vAt(x, this.nC) - vAt(x, this.nE)
    this.iF = OPTO_IS * (expSafe(vd / OPTO_NVT) - 1)
    this.iC = this.ctr * Math.max(this.iF, 0) * optoOutput(vce)[0] + OPTO_G_LEAK * vce
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iC
    t.values = { if: this.iF, ic: this.iC, ctr: this.iF > 1e-9 ? this.iC / this.iF : 0 }
  }
}

// -------------------------------------------------------------------- relay

/** SRD-05VDC-SL-C coil resistance (Ω, datasheet 70 Ω ± 10 %). */
export const RELAY_R = 70
/** Coil inductance (H) — not specified by the datasheet; an estimate of this coil type. */
export const RELAY_L = 0.1
/** Must-operate (pick-up) coil current: 75 % of the rated 5 V (datasheet max) over 70 Ω. */
export const RELAY_I_PICKUP = (0.75 * 5) / RELAY_R
/** Must-release (drop-out) coil current: 10 % of 5 V (datasheet min) over 70 Ω. */
export const RELAY_I_DROPOUT = (0.1 * 5) / RELAY_R
/** Armature travel after pick-up until NO closes (s); total operate ≈ coil rise + this ≤ 10 ms. */
export const RELAY_T_OPERATE = 4e-3
/** Armature travel after drop-out until NC closes (s); release ≤ 5 ms without a diode. */
export const RELAY_T_RELEASE = 2e-3
/** Break-before-make gap: the opening contact parts this long before the other closes (s). */
export const RELAY_T_GAP = 0.5e-3

type ArmatureState = 'rest' | 'operating' | 'operated' | 'releasing'

/**
 * Relay, pins [COIL1, COIL2, COM, NO, NC] (sub-circuit element of relay_5v).
 *
 * Coil: 70 Ω in series with L as ONE backward-Euler companion
 *   i = (v + (L/dt)·i_prev) / (R + L/dt)
 * so the coil current rises with τ = L/R and an interrupted coil produces
 * the real inductive kick L·di/dt across its pins.
 *
 * Armature (state machine on the computed coil current, hysteresis by the
 * datasheet pick-up / drop-out limits): at rest NC is closed; |i| ≥ pick-up
 * starts the operate travel — NC opens RELAY_T_GAP before NO closes, at
 * RELAY_T_OPERATE. |i| ≤ drop-out starts the release travel (NO opens, NC
 * closes at RELAY_T_RELEASE). A coil current falling below drop-out during
 * operate travel (or rising above pick-up during release) reverses it.
 * Contacts: 50 mΩ closed (datasheet ≤ 100 mΩ) / 1 nS open.
 */
class RelayDevice extends BaseDevice {
  private readonly nC1: number
  private readonly nC2: number
  private readonly nCom: number
  private readonly nNo: number
  private readonly nNc: number
  private geq = 0
  private ieq = 0
  private iCoil = 0
  private vCoil = 0
  private dt = 5e-5
  state: ArmatureState = 'rest'
  private timer = 0
  private noClosed = false
  private ncClosed = true

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    this.nC1 = nodes[0]
    this.nC2 = nodes[1]
    this.nCom = nodes[2]
    this.nNo = nodes[3]
    this.nNc = nodes[4]
  }

  beginStep(_time: number, dt: number): void {
    this.dt = dt
    const lOverDt = RELAY_L / dt
    this.geq = 1 / (RELAY_R + lOverDt)
    this.ieq = this.geq * lOverDt * this.iCoil
  }

  stamp(ctx: StampContext): void {
    ctx.addConductance(this.nC1, this.nC2, this.geq)
    ctx.addCurrent(this.nC1, -this.ieq)
    ctx.addCurrent(this.nC2, this.ieq)
    ctx.addConductance(this.nCom, this.nNo, this.noClosed ? G_ON : G_OFF)
    ctx.addConductance(this.nCom, this.nNc, this.ncClosed ? G_ON : G_OFF)
  }

  /** the coil and each contact on their own pins (COM tied to a coil pin — one supply for both) */
  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    bookBranch(out, off, this.nodes, x, 0, 1, this.geq, this.ieq)
    bookBranch(out, off, this.nodes, x, 2, 3, this.noClosed ? G_ON : G_OFF)
    bookBranch(out, off, this.nodes, x, 2, 4, this.ncClosed ? G_ON : G_OFF)
  }

  endStep(x: Float64Array): void {
    this.vCoil = vAt(x, this.nC1) - vAt(x, this.nC2)
    this.iCoil = this.geq * this.vCoil + this.ieq
    this.advanceArmature(Math.abs(this.iCoil), this.dt)
  }

  private advanceArmature(i: number, dt: number): void {
    switch (this.state) {
      case 'rest':
        if (i >= RELAY_I_PICKUP) {
          this.state = 'operating'
          this.timer = 0
        }
        break
      case 'operating':
        if (i <= RELAY_I_DROPOUT) {
          // spring wins before the armature seated: back to rest
          this.state = 'rest'
          this.timer = 0
          this.noClosed = false
          this.ncClosed = true
          break
        }
        this.timer += dt
        if (this.timer >= RELAY_T_OPERATE - RELAY_T_GAP) this.ncClosed = false
        if (this.timer >= RELAY_T_OPERATE) {
          this.noClosed = true
          this.state = 'operated'
        }
        break
      case 'operated':
        if (i <= RELAY_I_DROPOUT) {
          this.state = 'releasing'
          this.timer = 0
        }
        break
      case 'releasing':
        if (i >= RELAY_I_PICKUP) {
          this.state = 'operated'
          this.timer = 0
          this.noClosed = true
          this.ncClosed = false
          break
        }
        this.timer += dt
        if (this.timer >= RELAY_T_RELEASE - RELAY_T_GAP) this.noClosed = false
        if (this.timer >= RELAY_T_RELEASE) {
          this.ncClosed = true
          this.state = 'rest'
        }
        break
    }
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.iCoil
    t.power = this.iCoil * this.vCoil
    t.values = {
      icoil: this.iCoil,
      vcoil: this.vCoil,
      no: this.noClosed ? 1 : 0,
      nc: this.ncClosed ? 1 : 0,
      energized: this.state === 'operated' || this.state === 'operating' ? 1 : 0,
    }
  }
}

/** Inductive kick (V) above which an interrupted relay coil is flagged. */
export const RELAY_KICK_LIMIT = 30
/** Coil voltage (V) above which the drive polarity is (re)learned. */
const RELAY_DRIVE_V = 2

/**
 * Monitor chip of relay_5v (catalog sim model 'basic_relay_monitor'; the
 * electrical model is the 'relay_srd05' sub-circuit element). Every step it
 * reads the coil pin voltages of the previous solution, learns the drive
 * polarity while the coil is energized, and reports ONE warning when the
 * coil voltage swings the other way by more than RELAY_KICK_LIMIT — the
 * inductive kick of a coil interrupted without a flyback diode (a diode
 * clamps it at ≈ 0.7 V). It drives no pins. Telemetry mirrors the relay
 * element's values onto the part.
 */
class RelayMonitorChip implements ChipInstance {
  private polarity = 0
  private reported = false
  /** largest reverse coil voltage seen (V), telemetry */
  private kickMax = 0

  constructor(readonly comp: ComponentInstance) {}

  step(ctx: ChipStepCtx): void {
    const v1 = ctx.readPin('COIL1')
    const v2 = ctx.readPin('COIL2')
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) return
    const v = v1 - v2
    if (this.polarity !== 0) {
      const kick = -v * this.polarity
      if (kick > this.kickMax) this.kickMax = kick
      if (kick > RELAY_KICK_LIMIT) {
        if (!this.reported) {
          this.reported = true
          ctx.reportIssue?.(
            'warning',
            `relay ${this.comp.id}: coil switched off without a flyback diode — inductive kick of ${Math.round(kick)} V across the coil (add a diode across COIL1/COIL2, cathode to the + side)`,
          )
        }
        return
      }
    }
    // a plausible drive voltage (either sign) sets the polarity to watch
    const mag = Math.abs(v)
    if (mag >= RELAY_DRIVE_V && mag <= RELAY_KICK_LIMIT) this.polarity = Math.sign(v)
  }

  fillTelemetry(tele: ComponentTelemetry): void {
    const k = tele.sub?.K
    if (!k) return
    tele.current = k.current
    tele.values = { ...(k.values ?? {}), kick: this.kickMax }
  }
}

// ---------------------------------------------------------------- host

/** Parts whose whole electrical model is their CatalogEntry.subcircuit. */
class SubcircuitHostDevice extends BaseDevice {
  stamp(): void {}
}

// ------------------------------------------------------------ registration

const mos =
  (spec: MosSpec) =>
  (comp: ComponentInstance, entry: CatalogEntry, nodes: number[]): AnalogDevice =>
    new MosfetDevice(comp, entry, nodes, spec)

registerDevice('rgb_led', (c, e, n) => new RgbLedDevice(c, e, n))
registerDevice('zener', (c, e, n) => new ZenerDevice(c, e, n))
registerDevice('pmos', mos(PMOS_SPEC))
registerDevice('irlz44n', mos(IRLZ44N_SPEC))
registerDevice('nmos_vth', mos(NMOS_VTH_SPEC))
registerDevice('basic_iq', (c, e, n) => new QuiescentDevice(c, e, n))
registerDevice('battery', (c, e, n) => new BatteryDevice(c, e, n))
registerDevice('current_source', (c, e, n) => new CurrentSourceDevice(c, e, n))
registerDevice('ntc', (c, e, n) => new NtcDevice(c, e, n))
registerDevice('pc817', (c, e, n) => new OptocouplerDevice(c, e, n))
registerDevice('relay_srd05', (c, e, n) => new RelayDevice(c, e, n))
registerDevice('basic_subcircuit', (c, e, n) => new SubcircuitHostDevice(c, e, n))
registerChip('basic_relay_monitor', (comp) => new RelayMonitorChip(comp))
