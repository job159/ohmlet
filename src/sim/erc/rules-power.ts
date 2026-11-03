/**
 * Power rules: supply shorts (rule 1), supply range (rule 6a), missing
 * ground reference and unpowered parts (rule 8).
 *
 * The rules read the circuit's rails through powerRails(): graph.ts's
 * rails plus the output of a module regulator behind a FITTED jumper (the
 * L298N's 5V-EN → 78M05 → +5V), which graph.ts cannot see.
 */
import type { ErcFinding } from './api'
import type { Circuit, Edge, PartNode, Rail, Regulator } from './graph'
import {
  connectionPath,
  edgesOn,
  fmtV,
  isSourceEntry,
  netOfPin,
  otherEnd,
  pinsOn,
  railOf,
  refOfPin,
  supplyPinsOf,
} from './graph'
import { listText, makeFinding } from './finding'
import { lowPath } from './paths'
import { paramOf } from '../../model/catalog'

// ---------------------------------------------------------------------------
// Jumper-fed module regulators (the L298N's 5V-EN jumper)
// ---------------------------------------------------------------------------

/**
 * Module regulators whose INPUT is a private sub-circuit node that a jumper
 * (a boolean part param) joins to one of the module's supply terminals. The
 * jumper is stamped by the module's own chip model, so graph.ts sees the
 * regulator but not the jumper: its input looks unfed and its output is no
 * rail. The L298N: +12V —5V-EN jumper→ '@reg_in' → 78M05 (sub-circuit REG)
 * → +5V (L298nDevice.stamp, src/sim/models/motors.model.ts). With the jumper
 * fitted (the default) the 78M05 makes the module's +5V — its logic supply
 * and a 5 V output for whatever is wired to the +5V terminal; with it
 * removed +5V is an input that needs its own 5 V supply.
 *   element  the regulator's sub-circuit element id
 *   from     the supply terminal the jumper joins to the regulator input
 *   jumper   the boolean param that says the jumper is fitted
 */
export const JUMPER_FED_REGULATORS: Readonly<Record<string, { element: string; from: string; jumper: string }>> = {
  l298n_module: { element: 'REG', from: '+12V', jumper: 'jumper5v' },
}

/** A jumper-fed regulator's feed (null = an ordinary regulator): the jumper state and the net it joins in. */
function jumperFeedOf(r: Regulator): { fitted: boolean; pin: string; net: string | null } | null {
  const jf = JUMPER_FED_REGULATORS[r.part.entry.type]
  if (!jf || r.elId !== jf.element) return null
  const fitted = paramOf(r.part.comp.params, r.part.entry, jf.jumper) !== false
  return { fitted, pin: jf.from, net: fitted ? netOfPin(r.part, jf.from) : null }
}

const powerRailsCache = new WeakMap<Circuit, ReadonlyMap<string, Rail>>()

/**
 * The circuit's rails as the power rules see them: graph.ts's rails plus the
 * output of every regulator behind a FITTED jumper whose supply terminal is
 * fed — and whatever regulators that output feeds in turn (a Blue Pill on
 * the L298N's +5V gets its 3.3 V). The same rule as graph.ts solveRails: an
 * input at least 1 V above the regulator's ground gives min(vout, u −
 * dropout). A circuit without such a module gets `c.rails` itself.
 */
export function powerRails(c: Circuit): ReadonlyMap<string, Rail> {
  const hit = powerRailsCache.get(c)
  if (hit) return hit
  let rails: Map<string, Rail> | null = null
  if (c.ground && c.regulators.some((r) => jumperFeedOf(r)?.fitted)) {
    for (let iter = 0; iter < 32; iter++) {
      let changed = false
      for (const r of c.regulators) {
        const known: ReadonlyMap<string, Rail> = rails ?? c.rails
        if (!r.outNet || !r.gndNet || known.has(r.outNet)) continue
        const feed = jumperFeedOf(r)
        const inNet = feed ? feed.net : r.inNet
        const vin = inNet ? known.get(inNet) : undefined
        const vg = known.get(r.gndNet)
        if (!vin || !vg) continue
        const u = vin.v - vg.v
        if (u < 1.0) continue // LdoDevice: below ~1 V input the output is released
        const id = r.part.comp.id
        rails ??= new Map(c.rails)
        rails.set(r.outNet, {
          v: vg.v + Math.min(r.vout, u - r.dropout),
          by: r.elId ? `${id} ${r.vout} V regulator` : `${id} output`,
          compId: id,
        })
        changed = true
      }
      if (!changed) break
    }
  }
  const out: ReadonlyMap<string, Rail> = rails ?? c.rails
  powerRailsCache.set(c, out)
  return out
}

/**
 * `pin` is the output of one of `part`'s jumper-fed regulators and its jumper
 * is REMOVED: the jumper's label, the regulator voltage and the terminal the
 * jumper would feed it from (null otherwise).
 */
function removedJumperOutput(c: Circuit, part: PartNode, pin: string): { jumper: string; vout: number; from: string } | null {
  for (const r of c.regulators) {
    if (r.part !== part) continue
    const feed = jumperFeedOf(r)
    if (!feed || feed.fitted) continue
    const el = part.entry.subcircuit?.find((x) => x.id === r.elId)
    if (el?.pins[1] !== pin) continue
    const jf = JUMPER_FED_REGULATORS[part.entry.type]
    const jumper = part.entry.params?.find((p) => p.key === jf.jumper)?.label ?? jf.jumper
    return { jumper, vout: r.vout, from: feed.pin }
  }
  return null
}

/** railOf over powerRails(). */
function powerRailOf(c: Circuit, net: string | null | undefined): Rail | undefined {
  return net ? powerRails(c).get(net) : undefined
}

/** An MCU board's VDD over powerRails() (paths.ts boardVdd's rule): NaN unknown or not positive. */
function boardVddOf(c: Circuit, part: PartNode): number {
  const spec = part.entry.mcu
  if (!spec) return NaN
  const v = supplyVoltageOf(c, part, spec.vddPin, spec.gndPin)
  return v > 0 ? v : NaN
}

// ---------------------------------------------------------------------------
// Rule 1 — supply short
// ---------------------------------------------------------------------------

function pathWords(path: Edge[], subject: string): { text: string; closedNow: boolean } {
  const parts: string[] = []
  let closedNow = path.length > 0
  for (const e of path) {
    switch (e.kind) {
      case 'switch':
        parts.push(e.closed ? `${e.label} (closed now)` : e.label)
        if (!e.closed) closedNow = false
        break
      case 'transistor':
        parts.push(`transistor ${e.label}`)
        closedNow = false
        break
      case 'inductor':
        parts.push(`inductor ${e.label} (≈ 0 Ω at DC)`)
        break
      case 'ammeter':
        parts.push(`${e.label} in A mode (a 0.1 Ω shunt)`)
        break
      default:
        parts.push(e.label)
    }
  }
  const via = listText(parts)
  return {
    text: closedNow
      ? `${subject} is short-circuited right now through ${via}`
      : `${subject} is short-circuited whenever ${via} conducts`,
    closedNow,
  }
}

function shortFix(path: Edge[]): string {
  const kinds = new Set(path.map((e) => e.kind))
  const fixes: string[] = []
  if (kinds.has('switch')) fixes.push('put a load (e.g. a resistor or the input you want to drive) in series with the switch')
  if (kinds.has('transistor')) fixes.push('put the load between the supply and the transistor')
  if (kinds.has('ammeter')) fixes.push('measure current in series with a load, or switch the meter to V')
  if (kinds.has('inductor')) fixes.push('add series resistance — an inductor is a DC short')
  return fixes.length > 0 ? `${fixes.join('; ')}.` : ''
}

export function checkSupplyShorts(c: Circuit, out: ErcFinding[]): void {
  for (const s of c.sources) {
    const id = s.part.comp.id
    const refP = refOfPin(s.part, '+')
    const refM = refOfPin(s.part, '-')
    if (!s.plus || !s.minus) continue
    if (s.plus === s.minus) {
      const path = refP && refM ? connectionPath(c, refP, refM) : { wires: [], bridges: [] }
      const via =
        path.wires.length > 0
          ? ` through wire${path.wires.length > 1 ? 's' : ''} ${listText(path.wires)}`
          : ''
      out.push(
        makeFinding({
          rule: 'supply-short',
          level: 'error',
          key: id,
          message:
            `${id}’s + and − terminals are connected together${via} — a dead short across the supply ` +
            `${s.part.entry.sim.kind === 'device' && s.part.entry.sim.model === 'power_supply' ? '(the bench supply has no current limit in this simulator)' : '(a battery drives its full short-circuit current)'}. Remove that connection so current must flow through the circuit.`,
          short: `${id} + and − shorted`,
          group: path.wires.length > 0 ? `wires:${[...path.wires].sort().join(',')}` : undefined,
          componentIds: [id, ...path.bridges],
          nets: [s.plus],
          holes: [refP, refM],
          wireIds: path.wires,
        }),
      )
      continue
    }
    const lp = lowPath(c, s.plus, s.minus)
    if (lp && lp.length > 0) {
      const w = pathWords(lp, id)
      out.push(
        makeFinding({
          rule: 'supply-short',
          level: 'risk',
          key: id,
          message: `${w.text}: nothing limits the current between its + and −. ${shortFix(lp)}`,
          short: w.closedNow ? `${id} + and − shorted` : `${id} may be shorted`,
          componentIds: [id, ...lp.map((e) => e.compId)],
          nets: [s.plus, s.minus],
          holes: [refP, refM, ...lp.flatMap((e) => [e.refA, e.refB])],
        }),
      )
    }
  }

  // board / chip supply pins tied to their own ground
  for (const part of c.parts) {
    if (isSourceEntry(part.entry)) continue
    const sp = supplyPinsOf(part.entry)
    if (!sp) continue
    const id = part.comp.id
    const direct: string[] = []
    const directNets: string[] = []
    const directHoles: (string | null)[] = []
    let low: { plus: string; minus: string; path: Edge[] } | null = null
    for (const plus of sp.plus) {
      for (const minus of sp.minus) {
        const np = netOfPin(part, plus)
        const nm = netOfPin(part, minus)
        if (!np || !nm) continue
        if (np === nm) {
          if (!direct.includes(plus)) direct.push(plus)
          directNets.push(np)
          directHoles.push(refOfPin(part, plus), refOfPin(part, minus))
        } else if (!low) {
          const lp = lowPath(c, np, nm)
          if (lp && lp.length > 0) low = { plus, minus, path: lp }
        }
      }
    }
    if (direct.length > 0) {
      const ground = sp.minus.join('/')
      const powered = directNets.some((n) => pinsOn(c, n).some((p) => p.role === 'src+' || p.role === 'src-') || powerRailOf(c, n))
      // the wires joining them: one cause with a source short through the same wires
      const [ra, rb] = [directHoles[0], directHoles[1]]
      const joined = ra && rb ? connectionPath(c, ra, rb).wires : []
      out.push(
        makeFinding({
          rule: 'supply-short',
          level: 'error',
          key: `${id}:pins`,
          message:
            `${id}’s supply pin${direct.length > 1 ? 's' : ''} ${listText(direct)} ${direct.length > 1 ? 'are' : 'is'} on the same net as its ${ground} pin` +
            `${powered ? ' — whatever powers it is short-circuited' : ' — powering it would short the supply'}. ` +
            `Move the wire or lead that joins them (check that the two pins are not in the same breadboard strip).`,
          short: `${id} supply pins tied to GND`,
          group: joined.length > 0 ? `wires:${[...joined].sort().join(',')}` : undefined,
          pins: [...direct, ...sp.minus].map((pin) => ({ id, pin })),
          wireIds: joined,
          componentIds: [id],
          nets: directNets,
          holes: directHoles,
        }),
      )
    } else if (low) {
      const w = pathWords(low.path, `${id}’s ${low.plus}–${low.minus} supply`)
      out.push(
        makeFinding({
          rule: 'supply-short',
          level: 'risk',
          key: `${id}:pins`,
          message: `${w.text}. ${shortFix(low.path)}`,
          short: w.closedNow ? `${id} supply shorted` : `${id} supply may be shorted`,
          pins: [
            { id, pin: low.plus },
            { id, pin: low.minus },
          ],
          componentIds: [id, ...low.path.map((e) => e.compId)],
          nets: [netOfPin(part, low.plus), netOfPin(part, low.minus)],
          holes: [refOfPin(part, low.plus), refOfPin(part, low.minus), ...low.path.flatMap((e) => [e.refA, e.refB])],
        }),
      )
    }
  }

  // a regulator's OUTPUT tied to its own ground (LM7805 OUT → the − rail …,
  // AN-07): the board's own supply pins are covered above
  for (const r of c.regulators) {
    if (!r.outNet || !r.gndNet || r.outNet !== r.gndNet) continue
    const part = r.part
    const el = r.elId ? part.entry.subcircuit?.find((e) => e.id === r.elId) : undefined
    const pins = el ? el.pins : part.entry.pins
    const outPin = pins[1]
    const gndPin = pins[2]
    if (!outPin || !gndPin || outPin.startsWith('@')) continue
    if (supplyPinsOf(part.entry)?.plus.includes(outPin)) continue
    const id = part.comp.id
    const refOut = refOfPin(part, outPin)
    const refGnd = refOfPin(part, gndPin)
    const path = refOut && refGnd ? connectionPath(c, refOut, refGnd) : { wires: [], bridges: [] }
    const via = path.wires.length > 0 ? ` through wire${path.wires.length > 1 ? 's' : ''} ${listText(path.wires)}` : ''
    out.push(
      makeFinding({
        rule: 'supply-short',
        level: 'error',
        key: `${id}:${r.elId || 'reg'}:out`,
        message:
          `Regulator output shorted: ${id} ${outPin} reaches GND${via}. ` +
          `Remove that connection — a shorted output overheats the regulator and drags its input supply down.`,
        short: `${id} ${outPin} shorted to GND`,
        group: path.wires.length > 0 ? `wires:${[...path.wires].sort().join(',')}` : undefined,
        pins: [
          { id, pin: outPin },
          { id, pin: gndPin },
        ],
        componentIds: [id, ...path.bridges],
        nets: [r.outNet],
        holes: [refOut, refGnd],
        wireIds: path.wires,
      }),
    )
  }

  // two sources forcing different voltages onto one net
  for (const rc of c.railConflicts) {
    const id = rc.source.part.comp.id
    out.push(
      makeFinding({
        rule: 'supply-short',
        level: 'error',
        key: `${id}:conflict:${rc.actual.compId}`,
        message:
          `${id} (${fmtV(rc.source.v)}) and ${rc.actual.by} are wired so that they force different voltages onto the same net ` +
          `(${fmtV(rc.expected)} vs ${fmtV(rc.actual.v)}): two voltage sources fight through almost 0 Ω. ` +
          `Disconnect one of them — sources may share only their ground.`,
        short: `${id} and ${rc.actual.compId} fight over one net`,
        componentIds: [id, rc.actual.compId],
        nets: [rc.source.plus, rc.source.minus],
        holes: [refOfPin(rc.source.part, '+'), refOfPin(rc.source.part, '-')],
      }),
    )
  }
}

// ---------------------------------------------------------------------------
// Rule 6a — supply range
// ---------------------------------------------------------------------------

export function checkSupplyRange(c: Circuit, out: ErcFinding[]): void {
  for (const part of c.parts) {
    const { entry, comp } = part
    const id = comp.id
    const ratings = entry.ratings

    if (entry.mcu) {
      const spec = entry.mcu
      const vdd = supplyVoltageOf(c, part, spec.vddPin, spec.gndPin)
      const holes = [refOfPin(part, spec.vddPin), refOfPin(part, spec.gndPin)]
      const nets = [netOfPin(part, spec.vddPin), netOfPin(part, spec.gndPin)]
      if (Number.isFinite(vdd) && vdd < -0.05) {
        out.push(reversed(id, spec.vddPin, spec.gndPin, vdd, nets, holes))
      } else if (Number.isFinite(vdd) && ratings?.vddMax !== undefined && vdd > ratings.vddMax + 0.005) {
        const rail = powerRailOf(c, netOfPin(part, spec.vddPin))
        out.push(
          makeFinding({
            rule: 'supply-range',
            level: 'error',
            key: `${id}:vdd`,
            message:
              `${id}’s 3.3 V supply (${spec.vddPin}) is at ${fmtV(vdd)}${rail ? ` from ${rail.by}` : ''} — above the ${fmtV(ratings.vddMax)} maximum of its MCU. ` +
              `Feed 5 V into the 5V pin (the on-board regulator makes 3.3 V) or set the supply to 3.3 V.`,
            short: `${id} supply too high`,
            ref: 'DS5319 Table 9',
            pins: [{ id, pin: spec.vddPin }],
            componentIds: [id, rail?.compId],
            nets,
            holes,
          }),
        )
      } else if (Number.isFinite(vdd) && vdd > 0.05 && ratings?.vddMin !== undefined && vdd < ratings.vddMin - 0.005) {
        out.push(
          makeFinding({
            rule: 'supply-range',
            level: 'risk',
            key: `${id}:vdd`,
            message:
              `${id}’s 3.3 V supply is only ${fmtV(vdd)}, below the ${fmtV(ratings.vddMin)} minimum of its MCU: it will not start reliably. ` +
              `Supply 3.3 V to a 3.3 pin or 5 V to the 5V pin.`,
            short: `${id} supply too low`,
            ref: 'DS5319 Table 9',
            componentIds: [id],
            nets,
            holes,
          }),
        )
      }
    } else if (ratings && (ratings.vddMin !== undefined || ratings.vddMax !== undefined || entry.digital)) {
      const sp = supplyPinsOf(entry)
      if (sp && sp.plus.length > 0 && sp.minus.length > 0) {
        const plus = sp.plus[0]
        const minus = sp.minus[0]
        const v = supplyVoltageOf(c, part, plus, minus)
        const nets = [netOfPin(part, plus), netOfPin(part, minus)]
        const holes = [refOfPin(part, plus), refOfPin(part, minus)]
        if (Number.isFinite(v) && v < -0.05) {
          out.push(reversed(id, plus, minus, v, nets, holes))
        } else if (Number.isFinite(v) && ratings.vddMax !== undefined && v > ratings.vddMax + 0.005) {
          out.push(
            makeFinding({
              rule: 'supply-range',
              level: 'error',
              key: `${id}:vdd`,
              message:
                `${id} (${entry.label}) is powered at ${fmtV(v)}, above its rated ${fmtV(ratings.vddMax)} maximum supply` +
                `${ratings.vddMin !== undefined ? ` (rated ${fmtV(ratings.vddMin)}–${fmtV(ratings.vddMax)})` : ''}. ` +
                `Lower the supply or use a part rated for ${fmtV(v)}.`,
              short: `${id} supply too high`,
              componentIds: [id],
              nets,
              holes,
            }),
          )
        } else if (Number.isFinite(v) && v > 0.05 && ratings.vddMin !== undefined && v < ratings.vddMin - 0.005) {
          out.push(
            makeFinding({
              rule: 'supply-range',
              level: 'risk',
              key: `${id}:vdd`,
              message:
                `${id} (${entry.label}) is powered at only ${fmtV(v)}, below its rated ${fmtV(ratings.vddMin)} minimum` +
                `${ratings.vddMax !== undefined ? ` (rated ${fmtV(ratings.vddMin)}–${fmtV(ratings.vddMax)})` : ''}: ` +
                `a real part may not work. Raise the supply to its rated range.`,
              short: `${id} supply too low`,
              componentIds: [id],
              nets,
              holes,
            }),
          )
        }
      }
    }

    // logic devices: below the model's power-up threshold they stay off
    if (entry.digital) {
      const d = entry.digital
      const v = supplyVoltageOf(c, part, d.supplyPin, d.groundPin)
      if (Number.isFinite(v) && v > 0.05 && v < d.minVdd - 0.005 && !(ratings?.vddMin !== undefined && v < ratings.vddMin - 0.005)) {
        out.push(
          makeFinding({
            rule: 'supply-range',
            level: 'error',
            key: `${id}:minvdd`,
            message:
              `${id} (${entry.label}) gets ${fmtV(v)} but needs at least ${fmtV(d.minVdd)} to power up — it stays off. ` +
              `Power it from a higher rail.`,
            short: `${id} supply too low to start`,
            componentIds: [id],
            nets: [netOfPin(part, d.supplyPin), netOfPin(part, d.groundPin)],
            holes: [refOfPin(part, d.supplyPin), refOfPin(part, d.groundPin)],
          }),
        )
      }
    }

    // linear regulators (board sub-circuits): input range
    for (const reg of c.regulators) {
      if (reg.part !== part) continue
      // a jumper-fed regulator's input is the jumper's supply terminal while it is fitted (none without it)
      const feed = jumperFeedOf(reg)
      const inNet = feed ? feed.net : reg.inNet
      const vin = powerRailOf(c, inNet)
      const vg = powerRailOf(c, reg.gndNet)
      if (!vin || !vg) continue
      const u = vin.v - vg.v
      const inPin = feed ? feed.pin : reg.elId ? part.entry.subcircuit?.find((e) => e.id === reg.elId)?.pins[0] : part.entry.pins[0]
      const inRef = inPin ? refOfPin(part, inPin) : null
      const what = reg.elId ? `${id}’s ${inPin ?? 'input'} pin (${fmtV(reg.vout)} regulator input)` : `${id}’s input`
      if (Number.isFinite(reg.vinMax) && u > reg.vinMax + 0.005) {
        out.push(
          makeFinding({
            rule: 'supply-range',
            level: 'error',
            key: `${id}:${reg.elId || 'reg'}:vin`,
            message:
              `${what} gets ${fmtV(u)} from ${vin.by}, above the regulator’s ${fmtV(reg.vinMax)} maximum input` +
              `. Use a 5 V supply.`,
            short: `${id} regulator input too high`,
            pins: [{ id, pin: inPin }],
            ref: part.entry.type === 'stm32_bluepill' ? 'XC6206 ("662K") data sheet' : undefined,
            componentIds: [id, vin.compId],
            nets: [inNet],
            holes: [inRef],
          }),
        )
      } else if (
        u >= 1.0 &&
        u < reg.vout + reg.dropout - 0.005 &&
        powerRailOf(c, reg.outNet)?.compId === id &&
        // a part rated by its input range already got the under-voltage finding
        !(reg.elId && ratings?.vddMin !== undefined && !entry.mcu && u < ratings.vddMin - 0.005)
      ) {
        out.push(
          makeFinding({
            rule: 'supply-range',
            level: 'risk',
            key: `${id}:${reg.elId || 'reg'}:dropout`,
            message:
              `${what} gets only ${fmtV(u)}: a ${fmtV(reg.vout)} regulator needs about ${fmtV(reg.vout + reg.dropout)} ` +
              `(${fmtV(reg.vout)} + ${fmtV(reg.dropout)} dropout), so its output sags to ≈ ${fmtV(u - reg.dropout)}. ` +
              // a jumper-fed module regulator (the L298N's 78M05 on VS) needs a higher supply on that terminal
              `${reg.elId && !feed ? `Feed ${fmtV(reg.vout)} straight into a ${fmtV(reg.vout)} pin instead, or 5 V into ${inPin ?? 'the input'}.` : 'Raise the input voltage.'}`,
            short: `${id} regulator input too low`,
            pins: [{ id, pin: inPin }],
            componentIds: [id],
            nets: [inNet, reg.outNet],
            holes: [inRef],
          }),
        )
      }
    }
  }
}

function supplyVoltageOf(c: Circuit, part: PartNode, plus: string, minus: string): number {
  const p = powerRailOf(c, netOfPin(part, plus))
  const m = powerRailOf(c, netOfPin(part, minus))
  return p && m ? p.v - m.v : NaN
}

function reversed(
  id: string,
  plus: string,
  minus: string,
  v: number,
  nets: (string | null)[],
  holes: (string | null)[],
): ErcFinding {
  return makeFinding({
    rule: 'supply-range',
    level: 'error',
    key: `${id}:reversed`,
    message:
      `${id}’s supply is reversed: ${plus} is ${fmtV(-v)} BELOW ${minus}. Reverse polarity destroys most ICs — ` +
      `swap the two supply connections.`,
    short: `${id} supply reversed`,
    pins: [
      { id, pin: plus },
      { id, pin: minus },
    ],
    componentIds: [id],
    nets,
    holes,
  })
}

// ---------------------------------------------------------------------------
// Rule 8 — ground reference / unpowered parts
// ---------------------------------------------------------------------------

/** Parts that cannot work without a supply. */
function needsPower(part: PartNode): boolean {
  const e = part.entry
  return e.sim.kind === 'chip' || !!e.supplyPins || (e.sim.kind === 'device' && (e.sim.model === 'led' || e.sim.model === 'seven_segment'))
}

/** Is anything other than this part attached to the net? */
function netUsed(c: Circuit, net: string | null, self: PartNode): boolean {
  if (!net) return false
  return pinsOn(c, net, self).length > 0 || edgesOn(c, net).some((e) => e.compId !== self.comp.id)
}

/** A resistor-like element joining `net` to a rail, if any (the part is fed through it). */
function feedVia(c: Circuit, net: string | null): { edge: Edge; rail: string } | null {
  if (!net) return null
  for (const e of edgesOn(c, net)) {
    if (e.kind === 'capacitor') continue
    const other = otherEnd(e, net)
    const rail = powerRailOf(c, other)
    if (rail) return { edge: e, rail: rail.by }
  }
  return null
}

export function checkPower(c: Circuit, out: ErcFinding[]): void {
  if (c.sources.length === 0) {
    // A function generator wired into the circuit drives it too: an LED (or a
    // bare 7-segment) it feeds really lights, so only parts that need a real
    // supply (chips, modules with supply pins) are still "unpowered" then.
    const driven = c.signals.some((g) => netUsed(c, g.out, g.part))
    const consumers = c.parts.filter((p) => needsPower(p) && !(driven && p.entry.sim.kind === 'device' && !p.entry.supplyPins))
    if (consumers.length > 0) {
      out.push(
        makeFinding({
          rule: 'unpowered',
          level: 'error',
          key: 'no-source',
          message:
            `There is no power source in the circuit, so ${listText(consumers.slice(0, 3).map((p) => p.comp.id))}` +
            `${consumers.length > 3 ? ` and ${consumers.length - 3} more` : ''} cannot work. ` +
            `Add a DC power supply (or battery) and wire its + and − terminals to the power rails.`,
          short: 'No power source',
          // 「電路沒有電，什麼都不會動」 would be false while a generator drives part of it
          fact: driven ? undefined : 'power:*',
          componentIds: consumers.map((p) => p.comp.id),
          nets: [],
          holes: [],
        }),
      )
    }
  }

  // sources / generators without a common ground
  for (const s of c.sources) {
    if (!s.plus || !s.minus || s.plus === s.minus || railOf(c, s.minus)) continue
    if (!netUsed(c, s.plus, s.part) && !netUsed(c, s.minus, s.part)) continue
    const id = s.part.comp.id
    out.push(
      makeFinding({
        rule: 'ground-reference',
        level: 'risk',
        key: id,
        message:
          `${id}’s − terminal is not connected to the circuit ground${c.ground ? ` (${groundName(c)})` : ''}: its voltages float relative to the rest of the circuit. ` +
          `Wire ${id}:- to the ground rail (or to another source’s + to stack them).`,
        short: `${id} has no common ground`,
        componentIds: [id],
        nets: [s.minus],
        holes: [refOfPin(s.part, '-')],
      }),
    )
  }
  for (const g of c.signals) {
    if (!g.out || !g.gnd || railOf(c, g.gnd) || c.ground === g.gnd) continue
    if (!netUsed(c, g.out, g.part)) continue
    const id = g.part.comp.id
    out.push(
      makeFinding({
        rule: 'ground-reference',
        level: 'risk',
        key: id,
        message:
          `${id}’s gnd terminal is not connected to the circuit ground: its output has no common reference. ` +
          `Wire ${id}:gnd to the ground rail.`,
        short: `${id} has no common ground`,
        componentIds: [id],
        nets: [g.gnd],
        holes: [refOfPin(g.part, 'gnd')],
      }),
    )
  }

  if (c.sources.length === 0 || !c.ground) return

  for (const part of c.parts) {
    const e = part.entry
    if (isSourceEntry(e)) continue
    if (!(e.sim.kind === 'chip' || e.supplyPins)) continue
    if (part.nets.every((n) => !n)) continue // not placed on the board
    const id = part.comp.id

    if (e.mcu) {
      const spec = e.mcu
      const gndNet = netOfPin(part, spec.gndPin)
      const gndRail = powerRailOf(c, gndNet)
      const plusNets = (e.supplyPins?.plus ?? [spec.vddPin]).map((p) => ({ pin: p, net: netOfPin(part, p) }))
      const fedPins = plusNets.filter((p) => p.net && (powerRailOf(c, p.net) || pinsOn(c, p.net).some((x) => x.role === 'src+')))
      if (!gndRail) {
        out.push(
          makeFinding({
            rule: 'ground-reference',
            level: 'error',
            key: id,
            message:
              `${id}’s GND pins are not connected to the circuit ground${fedPins.length > 0 ? `, although ${listText(fedPins.map((p) => p.pin))} ${fedPins.length > 1 ? 'are' : 'is'} supplied` : ''}: ` +
              `the board has no return path and cannot run. Wire one of its G pins to the − rail.`,
            short: `${id} GND not connected`,
            fact: `power:${id}`,
            // the fed supply pins it names read 「3V3（板上 3.3）」 too, never 3V3_1 (IN-20)
            pins: [{ id, pin: spec.gndPin }, ...fedPins.map((p) => ({ id, pin: p.pin }))],
            componentIds: [id],
            nets: [gndNet],
            holes: [refOfPin(part, spec.gndPin)],
          }),
        )
        continue
      }
      if (!Number.isFinite(boardVddOf(c, part))) {
        const via = plusNets.map((p) => ({ ...p, feed: feedVia(c, p.net) })).find((p) => p.feed)
        out.push(
          makeFinding({
            rule: 'unpowered',
            level: via ? 'risk' : 'error',
            key: id,
            message: via
              ? `${id}’s ${via.pin} pin is fed only through ${via.feed!.edge.label} from ${via.feed!.rail}: the board’s supply would collapse under load. ` +
                `Wire ${via.pin} straight to the supply rail.`
              : `${id} is not powered: neither its 5V pin nor a 3.3 pin reaches a supply. ` +
                `Wire 5 V to the 5V pin (the on-board regulator makes 3.3 V) or 3.3 V to a 3.3 pin.`,
            short: via ? `${id} fed through ${via.feed!.edge.label}` : `${id} has no power`,
            fact: via ? undefined : `power:${id}`,
            pins: via ? [{ id, pin: via.pin }] : undefined,
            componentIds: [id, via?.feed?.edge.compId],
            nets: plusNets.map((p) => p.net),
            holes: plusNets.map((p) => refOfPin(part, p.pin)),
          }),
        )
      }
      continue
    }

    const sp = supplyPinsOf(e)
    if (!sp) continue
    const missingGnd = sp.minus.filter((p) => {
      const n = netOfPin(part, p)
      return n !== null && !powerRailOf(c, n)
    })
    const plusInfo = sp.plus.map((p) => ({ pin: p, net: netOfPin(part, p) }))
    const missingVcc = plusInfo.filter((p) => p.net !== null && !powerRailOf(c, p.net))
    if (missingGnd.length > 0) {
      out.push(
        makeFinding({
          rule: 'ground-reference',
          level: 'error',
          key: id,
          message:
            `${id}’s ${listText(missingGnd)} pin${missingGnd.length > 1 ? 's are' : ' is'} not connected to the circuit ground (at ${listText(missingGnd.map((p) => refOfPin(part, p) ?? p))}): ` +
            `the ${e.label} has no return path and will not work. Wire ${missingGnd.length > 1 ? 'them' : 'it'} to the − (ground) rail.`,
          short: `${id} GND not connected`,
          fact: `power:${id}`,
          pins: missingGnd.map((pin) => ({ id, pin })),
          componentIds: [id],
          nets: missingGnd.map((p) => netOfPin(part, p)),
          holes: missingGnd.map((p) => refOfPin(part, p)),
        }),
      )
    }
    if (missingVcc.length > 0) {
      const fed = missingVcc.map((p) => ({ ...p, feed: feedVia(c, p.net) }))
      const viaOnly = fed.every((p) => p.feed)
      const first = fed[0]
      // the output of a jumper-fed regulator whose jumper is removed: say how to feed it
      const jumperOff = !viaOnly && missingVcc.length === 1 ? removedJumperOutput(c, part, first.pin) : null
      out.push(
        makeFinding({
          rule: 'unpowered',
          level: viaOnly ? 'risk' : 'error',
          key: id,
          message: viaOnly
            ? `${id}’s ${first.pin} pin is fed only through ${first.feed!.edge.label} from ${first.feed!.rail}: the supply would sag as the ${e.label} draws current. Wire ${first.pin} straight to the + rail.`
            : jumperOff
              ? `${id}’s ${first.pin} pin is not connected to any supply (at ${refOfPin(part, first.pin) ?? first.pin}): with the ${jumperOff.jumper} removed, the ${e.label} needs its own ${fmtV(jumperOff.vout)} there. ` +
                `Wire ${first.pin} to a ${fmtV(jumperOff.vout)} supply, or fit the jumper so the on-board regulator makes it from ${jumperOff.from}.`
              : `${id}’s ${listText(missingVcc.map((p) => p.pin))} pin${missingVcc.length > 1 ? 's are' : ' is'} not connected to any supply (at ${listText(missingVcc.map((p) => refOfPin(part, p.pin) ?? p.pin))}): ` +
                `the ${e.label} is unpowered. Wire ${missingVcc.length > 1 ? 'them' : 'it'} to the + rail.`,
          short: viaOnly ? `${id} fed through ${first.feed!.edge.label}` : `${id} has no power`,
          fact: viaOnly ? undefined : `power:${id}`,
          pins: missingVcc.map((p) => ({ id, pin: p.pin })),
          componentIds: [id, ...fed.map((p) => p.feed?.edge.compId)],
          nets: missingVcc.map((p) => p.net),
          holes: missingVcc.map((p) => refOfPin(part, p.pin)),
        }),
      )
    }
  }
}

function groundName(c: Circuit): string {
  const r = c.ground ? railOf(c, c.ground) : undefined
  return r ? r.by : 'ground'
}
