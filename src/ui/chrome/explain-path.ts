/**
 * 「電路說明」 drive paths (explain stream): what feeds an output and what it
 * returns to, read from the ERC's DC edge graph (src/sim/erc/graph.ts +
 * paths.ts) — the same walk the LED rule makes, so the card and the
 * Problems rows never disagree about a circuit:
 *
 *   ledDrivePath(layout, 'LED1')
 *     → { up: 5 V rail (PS1), down: 0 V rail, resistors: [R1 330 Ω],
 *         switches: [], open: [], neighbors: ['R1'] }
 *
 *  - `up`: the first driver the anode side reaches (a rail above 0 V, an MCU
 *    GPIO, a logic output, the function generator), least series
 *    resistance first (reach's Dijkstra order);
 *  - `down`: the first return the cathode side reaches (the lowest rail, a
 *    GPIO / output that can sink);
 *  - `resistors` / `switches`: the resistors (catalog `resistance`, the
 *    value the inspector shows) and switches on that chosen path;
 *  - `limiters`: the other parts that limit the current on that path (a
 *    potentiometer, an LDR, a thermistor — named, never given a value: the
 *    graph only knows their worst case) and `transistors`: the controlled
 *    channels on it (「由 5.00 V 經 R1 330 Ω、Q1 供電」);
 *  - `open`: switches that are OPEN (pushbutton not pressed, slide /
 *    DIP switch the other way — the part's own params) on EVERY path of one
 *    side, so they break the circuit; empty when another path goes round;
 *  - `gates`: transistors on EVERY path of one side (all the current goes
 *    through them), each with what drives its base / gate: the switches open
 *    on every path to it and the first pin that drives it;
 *  - `neighbors`: the parts on the LED's own two nets (a resistor whose far
 *    lead is open breaks the path before any driver is reached, yet it is
 *    still the LED's neighbour — the card names it as the cause).
 *
 * Built from the layout alone (no telemetry: switch positions are the
 * params), cached per layout identity in a WeakMap — at most one graph per
 * circuit, the walk a few map reads. Pure; never throws (null on trouble).
 */
import type { CircuitLayout } from '../../model/types'
import { buildCircuit, type Circuit, type Edge } from '../../sim/erc/graph'
import { reach, type Reach } from '../../sim/erc/paths'

export type PathSourceKind = 'rail' | 'gpio' | 'out' | 'sig' | 'src'

/** One end of a drive path. */
export interface PathEnd {
  kind: PathSourceKind
  /** the net the end sits on (telemetry netVoltages key) */
  net: string
  /** nominal voltage the ERC assigns (a rail's voltage, a GPIO's VDD …); NaN = unknown */
  v: number
  /** the driving part and pin (GPIO, logic output, generator), or the part that sets the rail */
  partId?: string
  pin?: string
}

/** A transistor every path of one side goes through, and what drives its base / gate. */
export interface PathGate {
  id: string
  /** switches open on every path that drives its base / gate (pressing / flipping one turns it on) */
  open: string[]
  /** the first pin that drives its base / gate (an MCU GPIO, a logic output), else null */
  driver: PathEnd | null
}

export interface DrivePath {
  up: PathEnd | null
  down: PathEnd | null
  /** series resistors on the chosen path, anode side first: id + the resistance param (Ω) */
  resistors: { id: string; ohms: number }[]
  /** other current-limiting parts on the chosen path (pot halves, LDRs …): ids only */
  limiters: string[]
  /** transistor channels on the chosen path (ids) */
  transistors: string[]
  /** switches on the chosen path (their params' position) */
  switches: { id: string; closed: boolean }[]
  /** switches open on EVERY path of one side: they break the circuit (ids, path order) */
  open: string[]
  /** transistors on EVERY path of one side, with what drives them */
  gates: PathGate[]
  /** the chosen path's total series resistance (Ω, both sides; pot halves and transistors count 0) */
  r: number
  /** the other parts on the output's two nets */
  neighbors: string[]
}

const circuits = new WeakMap<CircuitLayout, Circuit | null>()

/** The ERC graph of `layout` (static: no telemetry), once per layout identity; null when it cannot be built. */
export function circuitOf(layout: CircuitLayout): Circuit | null {
  if (circuits.has(layout)) return circuits.get(layout) ?? null
  let c: Circuit | null = null
  try {
    c = buildCircuit(layout, null, [])
  } catch {
    c = null
  }
  circuits.set(layout, c)
  return c
}

const paths = new WeakMap<CircuitLayout, Map<string, DrivePath | null>>()

function endOf(c: Circuit, r: Reach): PathEnd {
  const e = r.end
  const out: PathEnd = { kind: e.kind, net: e.net, v: e.v }
  if (e.part) out.partId = e.part.comp.id
  else if (e.kind === 'rail') {
    const rail = c.rails.get(e.net)
    if (rail) out.partId = rail.compId
  }
  if (e.pin) out.pin = e.pin
  return out
}

/** A driver worth naming for the anode side: a rail above ground, or anything that drives. */
function drives(r: Reach): boolean {
  return r.end.kind === 'rail' ? r.end.v > 0 : r.end.kind !== 'src'
}

/** A return for the cathode side: a rail (the lowest is found first among equals), or a pin that can sink. */
function returns(r: Reach): boolean {
  return r.end.kind === 'rail' || r.end.kind === 'gpio' || r.end.kind === 'out' || r.end.kind === 'src'
}

/** Switches open on every one of `reaches` (none when one path has no open switch). */
function openOnEvery(reaches: readonly Reach[]): string[] {
  if (reaches.length === 0) return []
  let common: string[] | null = null
  for (const r of reaches) {
    const open = r.flags.switches.filter((e) => e.closed === false).map((e) => e.compId)
    if (open.length === 0) return []
    common = common === null ? open : common.filter((id) => open.includes(id))
  }
  // each path is broken by one of its own switches even when they differ: name the first path's
  return common && common.length > 0 ? common : reaches[0].flags.switches.filter((e) => e.closed === false).map((e) => e.compId)
}

function resistorsOf(c: Circuit, flags: Reach['flags']): { id: string; ohms: number }[] {
  const out: { id: string; ohms: number }[] = []
  for (const e of flags.resistors) {
    // only real resistors (a buzzer / LDR / meter is a resistive edge too, not a "series resistor")
    if (e.sub !== undefined || c.byId.get(e.compId)?.entry.type !== 'resistor') continue
    if (typeof e.r === 'number' && !out.some((x) => x.id === e.compId)) out.push({ id: e.compId, ohms: e.r })
  }
  return out
}

/** The other current limits on a path: potentiometer halves and resistive parts that are no plain resistor (an LDR …). */
function limitersOf(c: Circuit, flags: Reach['flags']): string[] {
  const out: string[] = []
  for (const e of [...flags.variables, ...flags.resistors]) {
    if (e.sub !== undefined || c.byId.get(e.compId)?.entry.type === 'resistor') continue
    if (!out.includes(e.compId)) out.push(e.compId)
  }
  return out
}

function transistorsOf(flags: Reach['flags']): string[] {
  const out: string[] = []
  for (const e of flags.transistors) if (e.sub === undefined && !out.includes(e.compId)) out.push(e.compId)
  return out
}

function switchesOf(flags: Reach['flags']): { id: string; closed: boolean }[] {
  return flags.switches.filter((e) => e.sub === undefined).map((e: Edge) => ({ id: e.compId, closed: e.closed !== false }))
}

/** Transistors on every one of `reaches` (all of that side's current goes through them). */
function transistorsOnEvery(reaches: readonly Reach[]): string[] {
  if (reaches.length === 0) return []
  let common: string[] | null = null
  for (const r of reaches) {
    const ids = transistorsOf(r.flags)
    common = common === null ? ids : common.filter((id) => ids.includes(id))
    if (common.length === 0) return []
  }
  return common ?? []
}

/**
 * What drives transistor `id`'s base / gate: an NPN / N-MOSFET is turned on
 * from above (a supply or a pin driving high), a PNP from below.
 */
function gateOf(c: Circuit, id: string): PathGate {
  const part = c.byId.get(id)
  const pins = part?.entry.pins ?? []
  const i = pins.findIndex((p) => p === 'base' || p === 'gate')
  const net = part && i >= 0 ? part.nets[i] : null
  if (!part || !net) return { id, open: [], driver: null }
  const model = part.entry.sim.kind === 'device' ? part.entry.sim.model : ''
  const dir = model === 'pnp' ? 'down' : 'up'
  const own = c.edges.filter((e) => e.compId === id)
  const all = reach(c, net, dir, { throughResistors: true }).filter((r) =>
    dir === 'up' ? drives(r) : r.end.kind === 'rail' ? r.end.v <= 0 : r.end.kind === 'gpio' || r.end.kind === 'out',
  )
  // never back through the transistor itself (its base–emitter junction)
  const reaches = all.filter((r) => !own.some((e) => r.flags.junctions.includes(e)))
  const driver = reaches.find((r) => r.end.kind === 'gpio' || r.end.kind === 'out')
  return { id, open: openOnEvery(reaches), driver: driver ? endOf(c, driver) : null }
}

/**
 * The drive path of LED / buzzer-like part `id` (its first junction or
 * two-lead edge, anode → cathode); null when the part has no such edge or
 * is not on the board.
 */
export function ledDrivePath(layout: CircuitLayout, id: string): DrivePath | null {
  let cache = paths.get(layout)
  if (!cache) paths.set(layout, (cache = new Map()))
  if (cache.has(id)) return cache.get(id) ?? null
  let out: DrivePath | null = null
  try {
    out = compute(layout, id)
  } catch {
    out = null
  }
  cache.set(id, out)
  return out
}

function compute(layout: CircuitLayout, id: string): DrivePath | null {
  const c = circuitOf(layout)
  if (!c) return null
  const part = c.byId.get(id)
  if (!part) return null
  const edge = c.edges.find((e) => e.compId === id && e.sub === undefined && (e.kind === 'junction' || e.kind === 'resistor'))
  if (!edge) return null
  const neighbors: string[] = []
  for (const net of [edge.a, edge.b]) {
    for (const p of c.pinsByNet.get(net) ?? []) {
      const other = p.part.comp.id
      if (other !== id && !neighbors.includes(other)) neighbors.push(other)
    }
  }
  if (edge.a === edge.b) return { up: null, down: null, resistors: [], limiters: [], transistors: [], switches: [], open: [], gates: [], r: 0, neighbors }
  const ups = reach(c, edge.a, 'up', { skip: edge, block: edge.b, throughResistors: true }).filter(drives)
  const downs = reach(c, edge.b, 'down', { skip: edge, block: edge.a, throughResistors: true }).filter(returns)
  // the lowest return first (ground before a higher rail at the same resistance)
  const down = [...downs].sort((x, y) => x.r - y.r || (x.end.kind === 'rail' && y.end.kind === 'rail' ? x.end.v - y.end.v : 0))[0]
  const up = ups[0]
  const uniq = <T,>(xs: T[]): T[] => xs.filter((s, i, all) => all.indexOf(s) === i)
  const open = uniq([...openOnEvery(ups), ...openOnEvery(downs)])
  const chosen = [up, down].filter((r): r is Reach => !!r)
  return {
    up: up ? endOf(c, up) : null,
    down: down ? endOf(c, down) : null,
    resistors: [...(up ? resistorsOf(c, up.flags) : []), ...(down ? resistorsOf(c, down.flags) : [])].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i),
    limiters: uniq(chosen.flatMap((r) => limitersOf(c, r.flags))),
    transistors: uniq(chosen.flatMap((r) => transistorsOf(r.flags))),
    switches: [...(up ? switchesOf(up.flags) : []), ...(down ? switchesOf(down.flags) : [])],
    open,
    gates: uniq([...transistorsOnEvery(ups), ...transistorsOnEvery(downs)]).map((id) => gateOf(c, id)),
    r: (up?.r ?? 0) + (down?.r ?? 0),
    neighbors,
  }
}
