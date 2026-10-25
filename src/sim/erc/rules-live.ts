/**
 * Rule 7 — over-rating, from one telemetry snapshot of a running
 * simulation (and the engine/coordinator issues list).
 *
 * Only the part's stated `ratings` are compared (absent rating → no check),
 * and a part is never called destroyed unless its own simulation model says
 * so (LedDevice.burned). Measured values are what the solver computed at the
 * moment of the snapshot.
 */
import type { ErcFinding } from './api'
import type { Circuit, PartNode } from './graph'
import { fmtA, fmtV, netOfPin, refOfPin, teleOf } from './graph'
import { makeFinding } from './finding'
import { getEntry } from '../../model/catalog'
import type { ComponentTelemetry } from '../../model/types'
import { fmtCurrent, fmtPower, isShortCircuitCurrent } from '../../instruments/format'

function fmtW(w: number): string {
  const x = Math.abs(w)
  return x >= 1 ? `${+x.toPrecision(3)} W` : `${+(x * 1000).toPrecision(3)} mW`
}

/**
 * A MEASURED current / power for the messages, through the app's one unit
 * formatter (UX helper H3, language-neutral): a burned-out part's solver
 * values (267 A, 622 W) mean "short circuit", not a number to read (STU-14)
 * — '> 2 A (short circuit)' and, for its power, '— (short circuit)'.
 */
function fmtLiveA(a: number): string {
  return isShortCircuitCurrent(a) ? fmtCurrent(a, { plain: true }) : fmtA(a)
}
function fmtLiveW(w: number, current?: number): string {
  if (isShortCircuitCurrent(current)) return fmtPower(w, { current, plain: true })
  return Math.abs(w) > 100 ? '> 100 W' : fmtW(w)
}

/** Dissipated power from telemetry: the model's own `power`, else ΔV·I across the main branch. */
function powerOf(part: PartNode, t: ComponentTelemetry): number {
  if (typeof t.power === 'number' && Number.isFinite(t.power)) return Math.abs(t.power)
  const i = t.current
  if (typeof i !== 'number' || !Number.isFinite(i)) return NaN
  const pins = part.entry.pins
  const v = (p: string) => t.pinVoltages?.[p]
  let a: number | undefined
  let b: number | undefined
  const model = part.entry.sim.kind === 'device' ? part.entry.sim.model : ''
  if (model === 'npn' || model === 'pnp') {
    a = v('collector')
    b = v('emitter')
  } else if (model === 'nmos') {
    a = v('drain')
    b = v('source')
  } else if (pins.length === 2) {
    a = v(pins[0])
    b = v(pins[1])
  }
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.abs((a - b) * i)
}

const GPIO_OVERCURRENT = /^(\S+) (\S+): driver (sources|sinks) ([\d.]+) mA/
const SUPPLY_OVERCURRENT = /^supply (\S+) current > 2A/

export function checkLive(c: Circuit, out: ErcFinding[], ledsReported: ReadonlySet<string>): void {
  const holesOf = (part: PartNode) => part.refs
  if (c.telemetry) {
    for (const part of c.parts) {
      const id = part.comp.id
      const t = teleOf(c, id)
      if (!t) continue
      const r = part.entry.ratings
      const label = part.entry.label
      const isLed = part.entry.sim.kind === 'device' && part.entry.sim.model === 'led'

      if (!ledsReported.has(id)) {
        if (t.burned === true) {
          out.push(
            makeFinding({
              rule: 'over-rating',
              level: 'error',
              key: id,
              message: isLed
                ? `${id} burned out in the simulation (the LED model latches it after more than 30 mA for over 1 ms). Add or enlarge its series resistor, then reset the simulation.`
                : `${id} (${label}) burned out in the simulation (its model latched an over-current). Limit the current through it, then reset the simulation.`,
              short: `${id} burned out`,
              fact: `burned:${id}`,
              componentIds: [id],
              nets: part.nets,
              holes: holesOf(part),
            }),
          )
          continue
        }
        if (r?.ifMax !== undefined && typeof t.current === 'number' && t.current > r.ifMax * 1.0001) {
          out.push(
            makeFinding({
              rule: 'over-rating',
              level: 'risk',
              key: id,
              message: `${id} (${label}) carries ${fmtLiveA(t.current)} forward current in the simulation, above its ${fmtA(r.ifMax)} rated continuous current: a real part ages quickly or fails. Increase its series resistor.`,
              short: `${id} current above its rating`,
              componentIds: [id],
              nets: part.nets,
              holes: holesOf(part),
            }),
          )
        }
      }

      if (r?.pMax !== undefined) {
        const p = powerOf(part, t)
        if (p > r.pMax * 1.0001) {
          out.push(
            makeFinding({
              rule: 'over-rating',
              level: 'risk',
              key: `${id}:p`,
              message:
                `${id} (${label}) dissipates ${fmtLiveW(p, t.current)} in the simulation, above its ${fmtW(r.pMax)} rating: a real part would overheat. ` +
                `${part.entry.sim.kind === 'device' && part.entry.sim.model === 'resistor' ? 'Use a larger resistance or a higher-wattage resistor.' : 'Reduce the current through it.'}`,
              short: `${id} power above its rating`,
              componentIds: [id],
              nets: part.nets,
              holes: holesOf(part),
            }),
          )
        }
      }

      if (r?.iMax !== undefined && typeof t.current === 'number' && Math.abs(t.current) > r.iMax * 1.0001) {
        out.push(
          makeFinding({
            rule: 'over-rating',
            level: 'risk',
            key: `${id}:i`,
            message: `${id} (${label}) carries ${fmtLiveA(t.current)} in the simulation, above its ${fmtA(r.iMax)} continuous rating. Reduce the load or use a stronger part.`,
            short: `${id} current above its rating`,
            componentIds: [id],
            nets: part.nets,
            holes: holesOf(part),
          }),
        )
      }

      // board sub-circuits: on-board LEDs and regulator
      for (const el of part.entry.subcircuit ?? []) {
        const st = t.sub?.[el.id]
        if (!st) continue
        if (el.model === 'led') {
          const ifMax = getEntry('led')?.ratings?.ifMax
          if (st.burned === true) {
            out.push(
              makeFinding({
                rule: 'over-rating',
                level: 'error',
                key: `${id}:${el.id}`,
                message: `${id}’s on-board LED ${el.id} burned out in the simulation (over 30 mA for more than 1 ms): something drives its pin with too much current. Check what is wired to ${el.pins.filter((p) => !p.startsWith('@')).join(' / ')}.`,
                short: `${id} on-board LED burned out`,
                pins: el.pins.filter((p) => !p.startsWith('@')).map((pin) => ({ id, pin })),
                componentIds: [id],
                nets: el.pins.map((p) => (p.startsWith('@') ? null : netOfPin(part, p))),
                holes: el.pins.map((p) => (p.startsWith('@') ? null : refOfPin(part, p))),
              }),
            )
          } else if (ifMax !== undefined && typeof st.current === 'number' && st.current > ifMax * 1.0001) {
            out.push(
              makeFinding({
                rule: 'over-rating',
                level: 'risk',
                key: `${id}:${el.id}`,
                message: `${id}’s on-board LED ${el.id} carries ${fmtLiveA(st.current)} in the simulation, above a typical ${fmtA(ifMax)} LED rating.`,
                short: `${id} on-board LED current too high`,
                componentIds: [id],
                nets: [],
                holes: [],
              }),
            )
          }
        } else if (el.model === 'ldo') {
          const vals = st.values ?? {}
          const vout = typeof el.params?.vout === 'number' ? el.params.vout : 3.3
          const ilimit = typeof el.params?.ilimit === 'number' ? el.params.ilimit : 0.3
          const dropout = typeof el.params?.dropout === 'number' ? el.params.dropout : 0.25
          const outPin = el.pins[1]
          const inPin = el.pins[0]
          if (vals.limiting === 1) {
            out.push(
              makeFinding({
                rule: 'over-rating',
                level: 'risk',
                key: `${id}:${el.id}:limit`,
                message:
                  `${id}’s ${fmtV(vout)} regulator is in current limit (≈ ${fmtA(ilimit)}) in the simulation: the load on ${outPin} is too heavy or shorted, ` +
                  `and the ${fmtV(vout)} rail is sagging (now ${fmtV(vals.vout ?? NaN)}). Remove the overload or power it from a separate supply.`,
                short: `${id} regulator in current limit`,
                pins: [{ id, pin: outPin }],
                componentIds: [id],
                nets: [netOfPin(part, outPin)],
                holes: [refOfPin(part, outPin)],
              }),
            )
          } else if (
            typeof vals.vin === 'number' &&
            typeof vals.vout === 'number' &&
            vals.vin >= 1.0 &&
            vals.vout < vout - 0.05 &&
            !c.rails.has(netOfPin(part, inPin) ?? '')
          ) {
            // input not statically known (else supply-range already reported the dropout)
            out.push(
              makeFinding({
                rule: 'over-rating',
                level: 'risk',
                key: `${id}:${el.id}:dropout`,
                message:
                  `${id}’s ${fmtV(vout)} regulator is in dropout in the simulation: its input ${inPin} is at ${fmtV(vals.vin)}, so the output is only ${fmtV(vals.vout)}. ` +
                  `Feed at least ${fmtV(vout + dropout)} into ${inPin}` +
                  `${part.entry.mcu ? `, or ${fmtV(vout)} directly into a ${fmtV(vout)} pin` : ''}.`,
                short: `${id} regulator in dropout`,
                pins: [
                  { id, pin: inPin },
                  { id, pin: outPin },
                ],
                componentIds: [id],
                nets: [netOfPin(part, inPin), netOfPin(part, outPin)],
                holes: [refOfPin(part, inPin)],
              }),
            )
          }
        }
      }
    }
  }

  // run-time findings the engine / coordinator already measured
  for (const iss of c.issues) {
    const g = GPIO_OVERCURRENT.exec(iss.message)
    if (g) {
      const [, board, pin, dir, ma] = g
      const part = c.byId.get(board)
      if (!part) continue
      out.push(
        makeFinding({
          rule: 'over-rating',
          level: 'risk',
          key: `${board}:${pin}:gpio`,
          message:
            `The simulation measured ${board} ${pin} ${dir === 'sources' ? 'sourcing' : 'sinking'} ${ma} mA, above the 25 mA per-pin limit: ` +
            `a short or a missing series resistor on ${pin}. Add a resistor, or drive the load through a transistor.`,
          short: `${board} ${pin} over 25 mA`,
          ref: 'DS5319 Table 7',
          // the same cause as the LED-current finding on this pin (rules-led): one group
          group: `gpio-current:${board}:${pin}`,
          fact: `overcurrent:${board}:${pin}`,
          pins: [{ id: board, pin }],
          componentIds: [board],
          nets: [netOfPin(part, pin)],
          holes: [refOfPin(part, pin)],
        }),
      )
      continue
    }
    const s = SUPPLY_OVERCURRENT.exec(iss.message)
    if (s) {
      const part = c.byId.get(s[1])
      if (!part) continue
      out.push(
        makeFinding({
          rule: 'over-rating',
          level: 'risk',
          key: `${s[1]}:supply`,
          message: `The simulation measured more than 2 A from ${s[1]} — a short circuit or a very heavy load. Find the low-resistance path (see the supply-short findings) and break it.`,
          short: `${s[1]} supplies more than 2 A`,
          fact: `overcurrent-supply:${s[1]}`,
          componentIds: [s[1]],
          nets: part.nets,
          holes: part.refs,
        }),
      )
    }
  }
}
