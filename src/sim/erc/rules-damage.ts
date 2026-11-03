/**
 * Damage facts (owner: vivid) — what a part's OWN simulation model latched,
 * read from one telemetry snapshot (ComponentTelemetry.damage), plus the
 * pins the running simulation measured beyond their absolute maximum
 * rating (the coordinator's latched issues). Never invented: no damage
 * field / no measurement → no finding.
 *
 *  - a resistor that burned OPEN (its thermal model: a sustained gross
 *    overload of its power rating) — error, fact 'burned:<id>';
 *  - an electrolytic capacitor whose vent opened (reverse voltage) —
 *    error, fact 'vented:<id>';
 *  - BEFORE that (static, no simulation needed): a polarized capacitor
 *    whose leads sit on two rails the wrong way round by more than
 *    VENT_REVERSE_V — it WILL vent once powered — error, fact
 *    'reversed:<id>'. The same finding id as the vent, so once the
 *    simulation reports the vent that one row states it instead (never
 *    "resolved by the live readings");
 *  - `pinDamageFromIssues`: the board pins the simulation measured beyond
 *    their absolute maximum (over-voltage above VDD + 0.3 V / 5.5 V FT,
 *    below VSS − 0.3 V, or a driver above 25 mA — DS5319 Table 7), for the
 *    3D damage marker and the problems wording (fact 'absmax:<id>:<pin>' /
 *    'overcurrent:<id>:<pin>').
 *
 * LED burn-out keeps its own findings (rules-led / rules-live).
 */
import type { SimIssue } from '../../model/types'
import type { ErcFinding } from './api'
import type { Circuit, PartNode } from './graph'
import { fmtV, netOfPin, railOf, refOfPin, teleOf } from './graph'
import { makeFinding } from './finding'

function fmtW(w: number): string {
  const x = Math.abs(w)
  return x >= 1 ? `${+x.toPrecision(3)} W` : `${+(x * 1000).toPrecision(3)} mW`
}

/**
 * A polarized capacitor reversed by more than this (V) vents in the
 * simulation (the capacitor model: 5 V reverse in about 1 s, 2 V in about
 * 4 s, 1 V or less never).
 */
export const VENT_REVERSE_V = 1

/**
 * A polarized (electrolytic) capacitor whose + lead sits on a LOWER rail than
 * its − lead by more than VENT_REVERSE_V: said before Run, from the rails'
 * nominal voltages (a lead not on a rail is not judged — no guessing).
 */
function checkReversedElectrolytic(c: Circuit, part: PartNode, out: ErcFinding[]): void {
  if (part.comp.params?.polarized !== true) return
  const pNet = netOfPin(part, 'p1')
  const mNet = netOfPin(part, 'p2')
  const plus = railOf(c, pNet)
  const minus = railOf(c, mNet)
  if (!plus || !minus || !(minus.v - plus.v > VENT_REVERSE_V)) return
  const id = part.comp.id
  out.push(
    makeFinding({
      rule: 'over-rating',
      level: 'error',
      key: `${id}:polarity`,
      message:
        `${id} (${part.entry.label}) is a polarized capacitor wired the wrong way round: its + lead (${refOfPin(part, 'p1') ?? 'p1'}) is at ${fmtV(plus.v)} and its − lead (${refOfPin(part, 'p2') ?? 'p2'}) at ${fmtV(minus.v)}. ` +
        `A reversed electrolytic heats up until its pressure vent opens once the circuit is powered. Turn it around so + goes to the higher voltage.`,
      short: `${id} electrolytic reversed`,
      fact: `reversed:${id}`,
      componentIds: [id],
      nets: [pNet, mNet],
      holes: part.refs,
    }),
  )
}

export function checkDamage(c: Circuit, out: ErcFinding[]): void {
  for (const part of c.parts) {
    const model = part.entry.sim.kind === 'device' ? part.entry.sim.model : ''
    // the reversed electrolytic, until the simulation reports its vent (below)
    if (model === 'capacitor' && teleOf(c, part.comp.id)?.damage?.kind !== 'vented') checkReversedElectrolytic(c, part, out)
  }
  if (!c.telemetry) return
  for (const part of c.parts) {
    const id = part.comp.id
    const t = teleOf(c, id)
    const d = t?.damage
    if (!d) continue
    const model = part.entry.sim.kind === 'device' ? part.entry.sim.model : ''
    const label = part.entry.label
    if (d.kind === 'burned' && model === 'resistor') {
      const pMax = part.entry.ratings?.pMax
      out.push(
        makeFinding({
          rule: 'over-rating',
          level: 'error',
          key: `${id}:burned`,
          message:
            `${id} (${label}) burned open in the simulation: it dissipated many times its ${pMax !== undefined ? fmtW(pMax) : 'rated'} power until its film overheated and burned through, ` +
            `so it no longer conducts. Use a larger resistance or a higher-wattage resistor; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).`,
          short: `${id} burned open`,
          fact: `burned:${id}`,
          componentIds: [id],
          nets: part.nets,
          holes: part.refs,
        }),
      )
    } else if (d.kind === 'vented' && model === 'capacitor') {
      out.push(
        makeFinding({
          rule: 'over-rating',
          level: 'error',
          // the same id as the static polarity finding: one row, the vent replaces the warning
          key: `${id}:polarity`,
          message:
            `${id} (${label}) vented in the simulation: its + lead sat more than 1 V below its − lead, and a reversed electrolytic capacitor heats up until its pressure vent opens. ` +
            `A real one is ruined (it loses capacitance and may short); the simulation keeps its value. Turn it around so + goes to the higher voltage; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).`,
          short: `${id} vented (reversed)`,
          fact: `vented:${id}`,
          componentIds: [id],
          nets: part.nets,
          holes: part.refs,
        }),
      )
    }
  }
}

/** One board pin the simulation measured beyond its absolute maximum rating. */
export interface PinDamage {
  componentId: string
  /** the MCU port name the coordinator reports ('PA0'), = the catalog pin of a Blue Pill GPIO */
  pin: string
  kind: 'overvoltage' | 'overcurrent'
  /** the measured value as the message states it ('5.20 V', '41.3 mA') */
  measured: string
}

const OVER_V = /^(\S+) (\S+): (-?[\d.]+) V (?:exceeds |is below VSS − 0\.3 V)/
const OVER_I = /^(\S+) (\S+): driver (?:sources|sinks) ([\d.]+) mA/

/**
 * The pins the running simulation measured beyond their absolute maximum
 * (the coordinator reports each once per power-on and keeps it: latched
 * until the simulation is reset). Pure — used by the 3D damage markers and
 * the problems wording alike.
 */
export function pinDamageFromIssues(issues: readonly SimIssue[] | null | undefined): PinDamage[] {
  const out: PinDamage[] = []
  if (!issues) return out
  for (const iss of issues) {
    if (!iss || typeof iss.message !== 'string') continue
    let m = OVER_V.exec(iss.message)
    if (m) {
      // a reading the solver produced for an unpowered / unsolvable board
      // (−1261957 V) is not a measurement: no marker (problems folds it too)
      if (Math.abs(parseFloat(m[3])) <= 50 && !out.some((d) => d.componentId === m![1] && d.pin === m![2])) {
        out.push({ componentId: m[1], pin: m[2], kind: 'overvoltage', measured: `${fmtV(parseFloat(m[3]))}` })
      }
      continue
    }
    m = OVER_I.exec(iss.message)
    if (m && !out.some((d) => d.componentId === m![1] && d.pin === m![2])) {
      out.push({ componentId: m[1], pin: m[2], kind: 'overcurrent', measured: `${m[3]} mA` })
    }
  }
  return out
}
