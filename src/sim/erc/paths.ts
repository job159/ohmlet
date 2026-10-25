/**
 * Path searches over the ERC's DC edge graph (graph.ts).
 *
 *  reach()    — from one lead of a junction, the drivers (upstream) or
 *               returns (downstream) it reaches, with the series resistance
 *               and the kinds of elements on the way (switches, transistors,
 *               potentiometers …). Dijkstra on (resistance, #conditional
 *               elements), so the least-limited path is found first.
 *  lowPath()  — a near-zero-ohm path between two nets through elements that
 *               are a short whenever they conduct (switch, transistor,
 *               inductor, A-mode meter).
 */
import type { Circuit, Edge, PartNode } from './graph'
import { edgesOn, fmtV, otherEnd, outputHigh, outputRailVoltage, pinsOn, railOf, supplyPinsOf, supplyVoltage } from './graph'

export interface PathFlags {
  switches: Edge[]
  transistors: Edge[]
  /** potentiometer halves (can be turned down to ~0.5 Ω) */
  variables: Edge[]
  /** inductors and A-mode meters (≈ 0 Ω at DC) */
  shunts: Edge[]
  /** other junctions in series (diodes / LEDs) */
  junctions: Edge[]
  resistors: Edge[]
}

export type EndpointKind = 'rail' | 'gpio' | 'out' | 'sig' | 'src'

export interface Endpoint {
  kind: EndpointKind
  net: string
  /**
   * nominal driving voltage (V, ERC reference): the rail voltage, a GPIO's
   * VDD, a logic output's supply, the generator's peak; NaN = unknown
   */
  v: number
  /** "PS1 + (5 V)", "U1 PA5", "U2 1Y" */
  what: string
  part?: PartNode
  pin?: string
}

export interface Reach {
  end: Endpoint
  /** total series resistance on the path (Ω; variable halves count 0) */
  r: number
  flags: PathFlags
}

function emptyFlags(): PathFlags {
  return { switches: [], transistors: [], variables: [], shunts: [], junctions: [], resistors: [] }
}

function cloneFlags(f: PathFlags): PathFlags {
  return {
    switches: f.switches.slice(),
    transistors: f.transistors.slice(),
    variables: f.variables.slice(),
    shunts: f.shunts.slice(),
    junctions: f.junctions.slice(),
    resistors: f.resistors.slice(),
  }
}

export function conditionalCount(f: PathFlags): number {
  return f.switches.length + f.transistors.length + f.variables.length
}

/** VDD of an MCU board relative to its ground (V), NaN when unpowered/unknown. */
export function boardVdd(c: Circuit, part: PartNode): number {
  const spec = part.entry.mcu
  if (!spec) return NaN
  const v = supplyVoltage(c, part, spec.vddPin, spec.gndPin)
  return v > 0 ? v : NaN
}

/** Supply of a chip / device across its first plus/minus pins (V), NaN unknown. */
export function partSupply(c: Circuit, part: PartNode): number {
  const sp = supplyPinsOf(part.entry)
  if (!sp || sp.plus.length === 0 || sp.minus.length === 0) return NaN
  if (part.entry.mcu) return boardVdd(c, part)
  return supplyVoltage(c, part, sp.plus[0], sp.minus[0])
}

/** Ground-referenced voltage of a part's minus pin (0 when unknown). */
function partGround(c: Circuit, part: PartNode): number {
  const sp = supplyPinsOf(part.entry)
  const pin = part.entry.mcu?.gndPin ?? sp?.minus[0]
  const i = pin ? part.entry.pins.indexOf(pin) : -1
  return railOf(c, i >= 0 ? part.nets[i] : null)?.v ?? 0
}

/** Drivers (dir 'up') or returns (dir 'down') sitting directly on `net`. */
export function endpointsAt(c: Circuit, net: string, dir: 'up' | 'down'): Endpoint[] {
  const rail = railOf(c, net)
  if (rail) return [{ kind: 'rail', net, v: rail.v, what: `${rail.by} (${fmtV(rail.v)})` }]
  const out: Endpoint[] = []
  for (const p of pinsOn(c, net)) {
    const id = p.part.comp.id
    switch (p.role) {
      case 'gpio': {
        const vdd = boardVdd(c, p.part)
        out.push({
          kind: 'gpio',
          net,
          v: partGround(c, p.part) + (Number.isFinite(vdd) ? vdd : 3.3),
          what: `${id} ${p.pin}`,
          part: p.part,
          pin: p.pin,
        })
        break
      }
      case 'out':
      case 'io': {
        // a declared output rail (module regulator) sets the high level; else the supply
        const rail = outputRailVoltage(c, p.part, p.pin)
        const vs = partSupply(c, p.part)
        out.push({
          kind: 'out',
          net,
          v: rail !== undefined ? rail : Number.isFinite(vs) ? partGround(c, p.part) + outputHigh(p.part.entry.type, vs) : NaN,
          what: `${id} ${p.pin}`,
          part: p.part,
          pin: p.pin,
        })
        break
      }
      case 'od':
        if (dir === 'down') out.push({ kind: 'out', net, v: NaN, what: `${id} ${p.pin}`, part: p.part, pin: p.pin })
        break
      case 'sig':
        if (dir === 'up') {
          const sig = c.signals.find((s) => s.part === p.part)
          const g = railOf(c, sig?.gnd)?.v ?? 0
          out.push({ kind: 'sig', net, v: sig ? g + sig.vMax : NaN, what: `${id} out`, part: p.part, pin: p.pin })
        }
        break
      case 'src+':
        if (dir === 'up') out.push({ kind: 'src', net, v: NaN, what: `${id} +`, part: p.part, pin: p.pin })
        break
      case 'src-':
      case 'sig-':
        if (dir === 'down') out.push({ kind: 'src', net, v: NaN, what: `${id} ${p.pin}`, part: p.part, pin: p.pin })
        break
      default:
        break
    }
  }
  return out
}


interface State {
  net: string
  r: number
  cond: number
  flags: PathFlags
}

/**
 * Endpoints reachable from `start` (excluding the `skip` edge and never
 * entering `block`). 'up' walks against junction direction (toward what
 * feeds an anode), 'down' with it (toward what sinks a cathode). Resistors
 * are crossed only when `throughResistors`.
 */
export function reach(
  c: Circuit,
  start: string,
  dir: 'up' | 'down',
  opts: { skip?: Edge; block?: string; throughResistors?: boolean },
): Reach[] {
  const best = new Map<string, State>()
  const done = new Set<string>()
  const open: State[] = [{ net: start, r: 0, cond: 0, flags: emptyFlags() }]
  best.set(start, open[0])
  const found: Reach[] = []
  while (open.length > 0) {
    // pop the lexicographically smallest (r, cond)
    let k = 0
    for (let i = 1; i < open.length; i++) {
      const a = open[i]
      const b = open[k]
      if (a.r < b.r || (a.r === b.r && a.cond < b.cond)) k = i
    }
    const cur = open.splice(k, 1)[0]
    if (done.has(cur.net)) continue
    done.add(cur.net)
    const ends = endpointsAt(c, cur.net, dir)
    if (ends.length > 0) {
      for (const end of ends) found.push({ end, r: cur.r, flags: cur.flags })
      continue // a driver / return terminates the path
    }
    for (const e of edgesOn(c, cur.net)) {
      if (e === opts.skip) continue
      const next = otherEnd(e, cur.net)
      if (next === cur.net || next === opts.block || done.has(next)) continue
      const flags = cloneFlags(cur.flags)
      let r = cur.r
      let cond = cur.cond
      switch (e.kind) {
        case 'junction':
          if (dir === 'up' ? e.b !== cur.net : e.a !== cur.net) continue
          flags.junctions.push(e)
          break
        case 'switch':
          flags.switches.push(e)
          cond++
          break
        case 'transistor':
          flags.transistors.push(e)
          cond++
          break
        case 'variable':
          // both halves of one pot in series = its fixed total resistance
          if (flags.variables.some((v) => v.compId === e.compId)) {
            if (!opts.throughResistors) continue
            r += e.r ?? 0
            flags.resistors.push(e)
            break
          }
          flags.variables.push(e)
          cond++
          break
        case 'ammeter':
        case 'inductor':
          flags.shunts.push(e)
          break
        case 'resistor':
          if (!opts.throughResistors) continue
          r += e.r ?? 0
          flags.resistors.push(e)
          break
        default:
          continue // capacitor (DC open), regulator
      }
      const prev = best.get(next)
      if (prev && (prev.r < r || (prev.r === r && prev.cond <= cond))) continue
      const st: State = { net: next, r, cond, flags }
      best.set(next, st)
      open.push(st)
    }
  }
  return found
}

const SHORT_KINDS = new Set(['switch', 'transistor', 'inductor', 'ammeter'])

/** Edges of a path from `from` to `to` through near-zero-ohm elements only (BFS), or null. */
export function lowPath(c: Circuit, from: string, to: string): Edge[] | null {
  if (from === to) return []
  const prev = new Map<string, { net: string; edge: Edge }>()
  const seen = new Set([from])
  const queue = [from]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === to) break
    for (const e of edgesOn(c, cur)) {
      if (!SHORT_KINDS.has(e.kind)) continue
      const next = otherEnd(e, cur)
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, { net: cur, edge: e })
      queue.push(next)
    }
  }
  if (!seen.has(to)) return null
  const path: Edge[] = []
  for (let n = to; n !== from; ) {
    const p = prev.get(n)!
    path.unshift(p.edge)
    n = p.net
  }
  return path
}
