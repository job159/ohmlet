/**
 * ERC circuit graph: the simulator's netlist plus a typed DC view of what
 * every part does electrically —
 *
 *  - sources (bench supplies, batteries) and the function generator;
 *  - RAILS: nets with a nominal voltage, propagated from the first supply's
 *    minus terminal (0 V) through every source and board regulator;
 *  - two-terminal EDGES between nets (resistors, switches, junctions,
 *    transistor channels …), built from the same catalog params the device
 *    models read (src/sim/devices.ts), including board sub-circuits;
 *  - pin ROLES of chips, MCU boards and logic devices (GPIO, output, input,
 *    supply, ground).
 *
 * Unknown device models (part families registered by other plug-ins without
 * a DC description here) contribute NO edges: the rules then never conclude
 * anything through them (no false alarms, possibly missed findings).
 */
import { buildNetlist } from '../netlist'
import type { Netlist } from '../netlist'
import { getEntry, paramOf } from '../../model/catalog'
import type { CatalogEntry, SubcircuitElement } from '../../model/catalog'
import {
  componentPinHoles,
  formatHole,
  netIdForHole,
  netIdForTerminal,
  parseHole,
  parseTerminalRef,
} from '../../model/breadboard'
import type {
  BoardConfig,
  CircuitLayout,
  ComponentInstance,
  ComponentTelemetry,
  McuTelemetry,
  ParamValue,
  SimIssue,
  SimTelemetry,
  Wire,
} from '../../model/types'
import { isBoardCount, isBoardRows, isBoardSizeId } from '../../model/types'
import { LED_VF } from '../devices'
import { outputRailNode } from '../digital/api'
import { fmtCurrent, fmtVoltage } from '../../instruments/format'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Electrical role of a part pin:
 *  gpio   MCU port pin (direction set by firmware)
 *  out    logic / analog output that drives both levels
 *  od     open-drain / open-collector output (sinks only)
 *  io     bidirectional or unknown-direction signal pin of a chip/device
 *  in     input
 *  vcc    supply input of a chip / board / device
 *  gnd    ground pin of a chip / board / device
 *  src+ / src-   source terminals (bench supply, battery)
 *  sig / sig-    function-generator output / ground
 *  passive       lead of a two-terminal device (described by an Edge)
 *  other         no DC role known (probes, unknown models, control pins)
 */
export type PinRole =
  | 'gpio'
  | 'out'
  | 'od'
  | 'io'
  | 'in'
  | 'vcc'
  | 'gnd'
  | 'src+'
  | 'src-'
  | 'sig'
  | 'sig-'
  | 'passive'
  | 'other'

export interface PartNode {
  comp: ComponentInstance
  entry: CatalogEntry
  /** resolved net per catalog pin (null = unplaced / not on a net) */
  nets: (string | null)[]
  /** printable location per pin: hole ref or "ID:PIN" terminal */
  refs: (string | null)[]
  roles: PinRole[]
}

export interface NetPin {
  part: PartNode
  pin: string
  index: number
  role: PinRole
}

/**
 * DC edge kinds:
 *  resistor   fixed resistance — limits current
 *  variable   one half of a potentiometer — may reach its 0.5 Ω end value
 *  switch     mechanical contact (`closed` = the current position)
 *  ammeter    multimeter in A mode (0.1 Ω shunt)
 *  inductor   ideal inductance — a DC short
 *  junction   diode / LED junction conducting a → b (`vf`)
 *  transistor controlled channel (C–E / D–S), conducts when driven
 *  capacitor  DC open
 *  regulator  linear regulator pass element in → out
 */
export type EdgeKind =
  | 'resistor'
  | 'variable'
  | 'switch'
  | 'ammeter'
  | 'inductor'
  | 'junction'
  | 'transistor'
  | 'capacitor'
  | 'regulator'

export interface Edge {
  a: string
  b: string
  kind: EdgeKind
  /** owning top-level component (a board for its sub-circuit elements) */
  compId: string
  /** sub-circuit element id when the edge is on a board */
  sub?: string
  /** resistance (Ω) for resistor / variable (variable: the CURRENT value) */
  r?: number
  /** switch position */
  closed?: boolean
  /** junction forward voltage (V) */
  vf?: number
  /** human label: "R1", "U1.R_USB_DP", "DS1 segment A" */
  label: string
  /** pin refs of the two ends (for findings' hole lists) */
  refA: string | null
  refB: string | null
}

export interface Source {
  part: PartNode
  plus: string | null
  minus: string | null
  /** nominal plus − minus (V); NaN = unknown */
  v: number
}

export interface SignalSource {
  part: PartNode
  out: string | null
  gnd: string | null
  /** extreme output voltages relative to its gnd terminal (V) */
  vMax: number
  vMin: number
}

export interface Regulator {
  part: PartNode
  /** sub-circuit element id ('' for a top-level regulator part) */
  elId: string
  inNet: string | null
  outNet: string | null
  gndNet: string | null
  vout: number
  dropout: number
  ilimit: number
  /** maximum rated input (V); NaN = unknown */
  vinMax: number
}

export interface Rail {
  /** nominal voltage relative to the ERC reference (V) */
  v: number
  /** what sets it: "PS1 +", "U1 3.3 V regulator" */
  by: string
  compId: string
}

export interface RailConflict {
  source: Source
  /** voltage the source would set on plus (minus + v) vs what the net already has */
  expected: number
  actual: Rail
}

export interface Circuit {
  layout: CircuitLayout
  board: BoardConfig
  netlist: Netlist
  parts: PartNode[]
  byId: Map<string, PartNode>
  edges: Edge[]
  edgesByNet: Map<string, Edge[]>
  pinsByNet: Map<string, NetPin[]>
  sources: Source[]
  signals: SignalSource[]
  regulators: Regulator[]
  rails: Map<string, Rail>
  railConflicts: RailConflict[]
  /** 0 V reference net of the static analysis (null = no source at all) */
  ground: string | null
  wires: Wire[]
  telemetry: SimTelemetry | null
  issues: readonly SimIssue[]
  /** per-board reset marks (ErcOptions.mcuResetAt / mcuResetPc) */
  mcuReset: {
    resetAt?: Record<string, number>
    resetPc?: Record<string, number>
    /** ErcOptions.unclockedPorts */
    unclocked?: Record<string, readonly string[]>
  }
}

// ---------------------------------------------------------------------------
// Catalog knowledge used only by the ERC
// ---------------------------------------------------------------------------

/**
 * Output pins of the legacy behavioral ICs, from each data sheet's pin
 * description (TI SN74xx / CD4xxxB / NE555 / LM358). Every other non-supply
 * pin of these parts is an input.
 */
const LEGACY_OUTPUTS: Record<string, readonly string[]> = {
  ne555: ['OUT'],
  lm358: ['OUT1', 'OUT2'],
  sn7400: ['1Y', '2Y', '3Y', '4Y'],
  sn7408: ['1Y', '2Y', '3Y', '4Y'],
  sn7432: ['1Y', '2Y', '3Y', '4Y'],
  sn7486: ['1Y', '2Y', '3Y', '4Y'],
  sn7404: ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y'],
  sn7474: ['1Q', '1QN', '2Q', '2QN'],
  sn74193: ['QA', 'QB', 'QC', 'QD', 'CO', 'BO'],
  cd4017: ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'CO'],
  cd4026: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'CO', 'DEO', 'UCS'],
  cd4511: ['A_SEG', 'B_SEG', 'C_SEG', 'D_SEG', 'E_SEG', 'F_SEG', 'G_SEG'],
  cd4040: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12'],
}
/** NE555 DISCH is an open-collector discharge transistor (sinks only). */
const LEGACY_OPEN_DRAIN: Record<string, readonly string[]> = { ne555: ['DISCH'] }
/**
 * Output-high drop below VCC of the legacy analog-output ICs, as their
 * behavioral models drive it (catalog support text): NE555 OUT = VCC − 0.5 V,
 * LM358 output ≤ VCC − 1.2 V. Logic families drive the full supply.
 */
const LEGACY_HIGH_DROP: Record<string, number> = { ne555: 0.5, lm358: 1.2 }

/**
 * Highest voltage an output pin of `type` reaches above its ground at supply
 * `vs` — for a pin WITHOUT a declared output rail (see outputRailVoltage).
 */
export function outputHigh(type: string, vs: number): number {
  return vs - (LEGACY_HIGH_DROP[type] ?? 0)
}

/** Net id of a part's internal sub-circuit node ('@v33' of U2 → '@U2@v33'), as addSubcircuitEdges names it. */
export function subcircuitNet(componentId: string, node: string): string {
  return `@${componentId}${node}`
}

/**
 * Net of the declared output-high rail of a logic device's pin
 * (DigitalSpec.outputRail — e.g. the HC-05's on-board 3.3 V regulator
 * output): a catalog pin's net, or the internal sub-circuit net. undefined
 * when nothing is declared for the pin (its high side is its supply pin).
 */
export function outputRailNet(part: PartNode, pin: string): string | null | undefined {
  const spec = part.entry.digital
  if (!spec?.outputRail) return undefined
  const node = outputRailNode(spec, pin, (k) => paramOf(part.comp.params, part.entry, k))
  if (node === null) return undefined
  return node.startsWith('@') ? subcircuitNet(part.comp.id, node) : netOfPin(part, node)
}

/**
 * Nominal voltage (ERC reference) the HIGH side of `pin` switches to when the
 * part declares an output rail: that rail's voltage (NaN while it has none —
 * e.g. the module's regulator input is not powered). undefined when nothing
 * is declared: callers then use `ground + outputHigh(type, supply)`.
 */
export function outputRailVoltage(c: Circuit, part: PartNode, pin: string): number | undefined {
  const net = outputRailNet(part, pin)
  if (net === undefined) return undefined
  return railOf(c, net)?.v ?? NaN
}

/**
 * Real-part input-high threshold of a legacy logic family at supply `vdd`
 * (V), NaN when not a logic input:
 *  - TI SN74xx (standard TTL), Recommended Operating Conditions: VIH ≥ 2 V;
 *  - TI CD4000B series (CD4017B/4026B/4040B/4511B), Static Electrical
 *    Characteristics: VIH ≥ 3.5 V @ 5 V, 7 V @ 10 V, 11 V @ 15 V = 0.7·VDD.
 * (The simulator's behavioral chips switch at 0.5·VCC — see catalog limits.)
 */
export function legacyVih(type: string, vdd: number): number {
  if (/^sn74/.test(type)) return 2.0
  if (/^cd40/.test(type)) return 0.7 * vdd
  return NaN
}

/**
 * Maximum input of a board's linear regulator when the catalog element does
 * not state one (params.vinMax): the Blue Pill's "662K" regulator is a Torex
 * XC6206P332MR — data sheet: maximum operating input 6.0 V.
 */
const BOARD_REGULATOR_VIN_MAX: Record<string, number> = { stm32_bluepill: 6.0 }

/** Device models whose DC behavior the edge builder below knows. */
const KNOWN_DEVICE_MODELS = new Set([
  'resistor',
  'capacitor',
  'inductor',
  'potentiometer',
  'photoresistor',
  'diode',
  'led',
  'npn',
  'pnp',
  'nmos',
  'pushbutton',
  'slide_switch',
  'dip_switch_8',
  'seven_segment',
  'buzzer',
  'power_supply',
  'function_generator',
  'ldo',
  'multimeter',
])

// ---------------------------------------------------------------------------
// Param helpers (same defaults as the device models)
// ---------------------------------------------------------------------------

function num(
  params: Record<string, ParamValue> | undefined,
  entry: CatalogEntry | undefined,
  key: string,
  fallback: number,
): number {
  const v = entry ? paramOf(params, entry, key) : params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(
  params: Record<string, ParamValue> | undefined,
  entry: CatalogEntry | undefined,
  key: string,
  fallback: string,
): string {
  const v = entry ? paramOf(params, entry, key) : params?.[key]
  return typeof v === 'string' ? v : fallback
}

function bool(
  params: Record<string, ParamValue> | undefined,
  entry: CatalogEntry | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const v = entry ? paramOf(params, entry, key) : params?.[key]
  return typeof v === 'boolean' ? v : fallback
}

/**
 * A VOLTAGE source: '+'/'-' terminals on a power-category device with a
 * 'voltage' param (bench supply, batteries). A current source (no voltage
 * param) is not one — it limits its own current.
 */
export function isSourceEntry(entry: CatalogEntry): boolean {
  if (entry.sim.kind !== 'device') return false
  if (entry.sim.model === 'power_supply') return true
  return (
    entry.category === 'power' &&
    entry.sim.model !== 'function_generator' &&
    entry.pins.includes('+') &&
    entry.pins.includes('-') &&
    (entry.params ?? []).some((p) => p.key === 'voltage' && p.kind === 'number')
  )
}

/** Supply pins of a part (catalog supplyPins → digital spec → legacy VCC/VDD/GND/VSS names). */
export function supplyPinsOf(entry: CatalogEntry): { plus: string[]; minus: string[] } | null {
  if (entry.supplyPins) return entry.supplyPins
  if (entry.digital) return { plus: [entry.digital.supplyPin], minus: [entry.digital.groundPin] }
  if (entry.sim.kind !== 'chip') return null
  const plus = entry.pins.filter((p) => p === 'VCC' || p === 'VDD')
  const minus = entry.pins.filter((p) => p === 'GND' || p === 'VSS')
  return plus.length > 0 || minus.length > 0 ? { plus, minus } : null
}

function rolesOf(entry: CatalogEntry): PinRole[] {
  const pins = entry.pins
  const roles: PinRole[] = pins.map(() => 'other')
  const info = new Map((entry.pinInfo ?? []).map((p) => [p.pin, p]))
  const supply = supplyPinsOf(entry)
  if (entry.sim.kind === 'probe') return roles

  if (entry.mcu) {
    const spec = entry.mcu
    pins.forEach((p, i) => {
      const kind = info.get(p)?.kind
      if (spec.pinMap[p]) roles[i] = 'gpio'
      else if (p === spec.gndPin || kind === 'ground' || supply?.minus.includes(p)) roles[i] = 'gnd'
      else if (p === spec.vddPin || kind === 'power' || supply?.plus.includes(p)) roles[i] = 'vcc'
    })
    return roles
  }

  if (entry.digital) {
    const d = entry.digital
    pins.forEach((p, i) => {
      const isIn = d.inputs.includes(p)
      const isOut = d.outputs.includes(p)
      // the real part's pin direction (pinInfo) wins: a DigitalSpec "output"
      // may only be an internal pull of an input pin (e.g. AT24C02 A0–A2/WP)
      const kind = info.get(p)?.kind
      if (p === d.supplyPin || supply?.plus.includes(p)) roles[i] = 'vcc'
      else if (p === d.groundPin || supply?.minus.includes(p)) roles[i] = 'gnd'
      else if (kind === 'input' || kind === 'analog') roles[i] = 'in'
      else if (kind === 'output') roles[i] = 'out'
      else if (isIn && isOut) roles[i] = 'io'
      else if (isOut) roles[i] = 'out'
      else if (isIn) roles[i] = 'in'
      else roles[i] = kindRole(info.get(p)?.kind)
    })
    return roles
  }

  if (entry.sim.kind === 'chip') {
    const outs = LEGACY_OUTPUTS[entry.type]
    const ods = LEGACY_OPEN_DRAIN[entry.type] ?? []
    pins.forEach((p, i) => {
      if (supply?.plus.includes(p)) roles[i] = 'vcc'
      else if (supply?.minus.includes(p)) roles[i] = 'gnd'
      else if (ods.includes(p)) roles[i] = 'od'
      else if (outs) roles[i] = outs.includes(p) ? 'out' : 'in'
      else roles[i] = info.has(p) ? kindRole(info.get(p)?.kind) : 'io'
    })
    return roles
  }

  // analog devices
  const model = entry.sim.model
  if (isSourceEntry(entry)) {
    pins.forEach((p, i) => {
      if (p === '+') roles[i] = 'src+'
      else if (p === '-') roles[i] = 'src-'
    })
    return roles
  }
  if (model === 'function_generator') {
    pins.forEach((p, i) => {
      if (p === 'out') roles[i] = 'sig'
      else if (p === 'gnd') roles[i] = 'sig-'
    })
    return roles
  }
  if (KNOWN_DEVICE_MODELS.has(model)) return pins.map(() => 'passive')
  // unknown device model: only its declared supply pins are known
  pins.forEach((p, i) => {
    if (supply?.plus.includes(p)) roles[i] = 'vcc'
    else if (supply?.minus.includes(p)) roles[i] = 'gnd'
  })
  return roles
}

function kindRole(kind: string | undefined): PinRole {
  switch (kind) {
    case 'power':
      return 'vcc'
    case 'ground':
      return 'gnd'
    case 'output':
      return 'out'
    case 'input':
    case 'analog':
      return 'in'
    case 'io':
      return 'io'
    default:
      return 'other'
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Pin states of an MCU board that come from RUNNING firmware (null otherwise). */
export function trustedPinModes(tele: ComponentTelemetry | undefined): Record<string, string> | null {
  const m: McuTelemetry | undefined = tele?.mcu
  if (!m || !m.pinModes) return null
  if (m.state === 'no-firmware' || m.state === 'unpowered' || m.state === 'reset') return null
  return m.pinModes
}

export function buildCircuit(
  layout: CircuitLayout,
  telemetry: SimTelemetry | null = null,
  issues: readonly SimIssue[] = [],
  mcuReset: Circuit['mcuReset'] = {},
): Circuit {
  const board: BoardConfig = {
    size: isBoardSizeId(layout?.board) ? layout.board : 'standard',
    count: isBoardCount(layout?.boardCount) ? layout.boardCount : 1,
    rows: isBoardRows(layout?.boardRows) ? layout.boardRows : 1,
  }
  const netlist = buildNetlist(layout)
  const components: ComponentInstance[] = Array.isArray(layout?.components) ? layout.components : []
  const wires: Wire[] = Array.isArray(layout?.wires) ? layout.wires.filter((w) => !!w) : []

  const parts: PartNode[] = []
  const byId = new Map<string, PartNode>()
  for (const comp of components) {
    if (!comp || typeof comp.id !== 'string' || typeof comp.type !== 'string' || byId.has(comp.id)) continue
    const entry = getEntry(comp.type)
    if (!entry || entry.sim.kind === 'probe') continue
    const n = entry.pins.length
    const nets: (string | null)[] = new Array(n).fill(null)
    const refs: (string | null)[] = new Array(n).fill(null)
    if (entry.placement === 'offboard') {
      entry.pins.forEach((pin, i) => {
        refs[i] = `${comp.id}:${pin}`
        nets[i] = netlist.netOf(refs[i]!)
      })
    } else {
      const holes = componentPinHoles(comp, entry, board)
      if (holes) {
        holes.forEach((h, i) => {
          if (!h) return
          refs[i] = formatHole(h)
          nets[i] = netlist.netOf(refs[i]!)
        })
      }
    }
    const part: PartNode = { comp, entry, nets, refs, roles: rolesOf(entry) }
    parts.push(part)
    byId.set(comp.id, part)
  }

  const pinsByNet = new Map<string, NetPin[]>()
  for (const part of parts) {
    part.nets.forEach((net, i) => {
      if (!net) return
      let list = pinsByNet.get(net)
      if (!list) pinsByNet.set(net, (list = []))
      list.push({ part, pin: part.entry.pins[i], index: i, role: part.roles[i] })
    })
  }

  const edges: Edge[] = []
  const sources: Source[] = []
  const signals: SignalSource[] = []
  const regulators: Regulator[] = []

  for (const part of parts) {
    const { comp, entry } = part
    const pinNet = (pin: string): string | null => {
      const i = entry.pins.indexOf(pin)
      return i >= 0 ? part.nets[i] : null
    }
    const pinRef = (pin: string): string | null => {
      const i = entry.pins.indexOf(pin)
      return i >= 0 ? part.refs[i] : null
    }
    if (isSourceEntry(entry)) {
      const v = num(comp.params, entry, 'voltage', NaN)
      sources.push({ part, plus: pinNet('+'), minus: pinNet('-'), v })
      continue
    }
    if (entry.sim.kind === 'device' && entry.sim.model === 'function_generator') {
      const amp = Math.abs(num(comp.params, entry, 'amplitude', 2.5))
      const off = num(comp.params, entry, 'offset', 2.5)
      signals.push({ part, out: pinNet('out'), gnd: pinNet('gnd'), vMax: off + amp, vMin: off - amp })
      continue
    }
    if (entry.sim.kind === 'device') {
      const tele = telemetry?.components?.[comp.id]
      addDeviceEdges(edges, regulators, part, entry.sim.model, comp.params, entry, pinNet, pinRef, comp.id, comp.id, undefined, tele)
    }
    // board / module sub-circuits (on-board LEDs, pull-ups, regulator)
    for (const el of entry.subcircuit ?? []) addSubcircuitEdges(edges, regulators, part, el, pinNet, pinRef)
  }

  const edgesByNet = new Map<string, Edge[]>()
  for (const e of edges) {
    for (const net of e.a === e.b ? [e.a] : [e.a, e.b]) {
      let list = edgesByNet.get(net)
      if (!list) edgesByNet.set(net, (list = []))
      list.push(e)
    }
  }

  const circuit: Circuit = {
    layout,
    board,
    netlist,
    parts,
    byId,
    edges,
    edgesByNet,
    pinsByNet,
    sources,
    signals,
    regulators,
    rails: new Map(),
    railConflicts: [],
    ground: null,
    wires,
    telemetry,
    issues,
    mcuReset,
  }
  solveRails(circuit)
  return circuit
}

type PinLookup = (pin: string) => string | null

function addDeviceEdges(
  edges: Edge[],
  regulators: Regulator[],
  part: PartNode,
  model: string,
  params: Record<string, ParamValue> | undefined,
  entry: CatalogEntry | undefined,
  net: PinLookup,
  ref: PinLookup,
  compId: string,
  label: string,
  sub: string | undefined,
  tele: ComponentTelemetry | undefined,
): void {
  const push = (pa: string, pb: string, kind: EdgeKind, extra: Partial<Edge> = {}, lbl = label) => {
    const a = net(pa)
    const b = net(pb)
    if (!a || !b) return
    const e: Edge = { a, b, kind, compId, label: lbl, refA: ref(pa), refB: ref(pb), ...extra }
    if (sub !== undefined) e.sub = sub
    edges.push(e)
  }
  switch (model) {
    case 'resistor':
      push('p1', 'p2', 'resistor', { r: Math.max(num(params, entry, 'resistance', 1000), 1e-3) })
      break
    case 'potentiometer': {
      const rt = Math.max(num(params, entry, 'resistance', 10000), 1e-3)
      const pos = Math.min(Math.max(num(params, entry, 'position', 0.5), 0), 1)
      // same split and 0.5 Ω end resistance as PotentiometerDevice
      push('ccw', 'wiper', 'variable', { r: Math.max(rt * pos, 0.5) })
      push('wiper', 'cw', 'variable', { r: Math.max(rt * (1 - pos), 0.5) })
      break
    }
    case 'photoresistor':
      // brightest value (PhotoresistorDevice: 200 Ω at full light) — the
      // worst case for current limiting; pulls only care that it is finite
      push('p1', 'p2', 'resistor', { r: 200 })
      break
    case 'buzzer':
      push('p1', 'p2', 'resistor', { r: 300 })
      break
    case 'capacitor':
      push('p1', 'p2', 'capacitor')
      break
    case 'inductor':
      push('p1', 'p2', 'inductor')
      break
    case 'diode':
      push('anode', 'cathode', 'junction', { vf: 0.7 })
      break
    case 'led': {
      const color = str(params, entry, 'color', 'red')
      push('anode', 'cathode', 'junction', { vf: LED_VF[color] ?? LED_VF.red })
      break
    }
    case 'seven_segment':
      for (const seg of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) {
        push(seg, 'COM1', 'junction', { vf: 2.0 }, `${label} segment ${seg}`)
      }
      break
    case 'npn':
      push('collector', 'emitter', 'transistor')
      push('base', 'emitter', 'junction', { vf: 0.7 }, `${label} base`)
      break
    case 'pnp':
      push('emitter', 'collector', 'transistor')
      push('emitter', 'base', 'junction', { vf: 0.7 }, `${label} base`)
      break
    case 'nmos':
      push('drain', 'source', 'transistor')
      break
    case 'pushbutton': {
      const pressed = tele?.pressed ?? bool(params, entry, 'pressed', false)
      push('A1', 'B1', 'switch', { closed: pressed })
      break
    }
    case 'slide_switch': {
      const state = str(params, entry, 'state', 'a')
      push('common', 'a', 'switch', { closed: state === 'a' })
      push('common', 'b', 'switch', { closed: state === 'b' })
      break
    }
    case 'dip_switch_8': {
      const on = str(params, entry, 'on', '00000000')
      for (let i = 0; i < 8; i++) {
        push(`${i + 1}A`, `${i + 1}B`, 'switch', { closed: on.charAt(i) === '1' }, `${label} switch ${i + 1}`)
      }
      break
    }
    case 'multimeter': {
      const mode = str(params, entry, 'mode', 'V')
      if (mode === 'A') push('IN', 'COM', 'ammeter')
      else if (mode === 'V') push('IN', 'COM', 'resistor', { r: 10e6 })
      // Ω mode: a 1 V / 10 kΩ test source — no DC role for these rules
      break
    }
    case 'ldo': {
      // pins [in, out, gnd] (LdoDevice)
      const pins = part.entry.subcircuit?.find((e) => e.id === sub)?.pins ?? part.entry.pins
      const [pin, pout, pgnd] = pins
      if (!pin || !pout || !pgnd) break
      push(pin, pout, 'regulator')
      const vinMaxParam = num(params, entry, 'vinMax', NaN)
      regulators.push({
        part,
        elId: sub ?? '',
        inNet: net(pin),
        outNet: net(pout),
        gndNet: net(pgnd),
        vout: Math.max(num(params, entry, 'vout', 3.3), 0),
        dropout: Math.max(num(params, entry, 'dropout', 0.25), 0),
        ilimit: Math.max(num(params, entry, 'ilimit', 0.3), 1e-6),
        vinMax: Number.isFinite(vinMaxParam)
          ? vinMaxParam
          : sub !== undefined
            ? (BOARD_REGULATOR_VIN_MAX[part.entry.type] ?? NaN)
            : NaN,
      })
      break
    }
    default:
      break
  }
}

function addSubcircuitEdges(
  edges: Edge[],
  regulators: Regulator[],
  part: PartNode,
  el: SubcircuitElement,
  parentNet: PinLookup,
  parentRef: PinLookup,
): void {
  if (!el || typeof el.model !== 'string' || !Array.isArray(el.pins)) return
  // element pins are parent catalog pins or private '@' nodes; device pin
  // names come from the element's model entry (same rule as the engine)
  const modelEntry = modelEntryOf(el.model)
  const devPins = modelEntry && modelEntry.pins.length === el.pins.length ? modelEntry.pins : el.pins
  const toParent = new Map<string, string>()
  devPins.forEach((dp, i) => toParent.set(dp, el.pins[i]))
  const net: PinLookup = (dp) => {
    const p = toParent.get(dp)
    if (!p) return null
    return p.startsWith('@') ? subcircuitNet(part.comp.id, p) : parentNet(p)
  }
  const ref: PinLookup = (dp) => {
    const p = toParent.get(dp)
    if (!p || p.startsWith('@')) return null
    return parentRef(p)
  }
  addDeviceEdges(
    edges,
    regulators,
    part,
    el.model,
    el.params,
    modelEntry,
    net,
    ref,
    part.comp.id,
    `${part.comp.id}.${el.id}`,
    el.id,
    undefined,
  )
}

/** Catalog entry whose device model is `model` (the engine's modelEntryOf). */
function modelEntryOf(model: string): CatalogEntry | undefined {
  const direct = getEntry(model)
  if (direct && direct.sim.kind === 'device' && direct.sim.model === model) return direct
  return undefined
}

// ---------------------------------------------------------------------------
// Static voltage analysis
// ---------------------------------------------------------------------------

/** Tolerance (V) when comparing nominal rail voltages. */
const V_TOL = 0.05

function solveRails(c: Circuit): void {
  const rails = c.rails
  const firstPs =
    c.sources.find((s) => s.part.entry.type === 'power_supply' && s.minus && s.plus !== s.minus) ??
    c.sources.find((s) => s.minus && s.plus !== s.minus)
  if (firstPs && firstPs.minus) {
    c.ground = firstPs.minus
    rails.set(firstPs.minus, { v: 0, by: `${firstPs.part.comp.id} −`, compId: firstPs.part.comp.id })
  } else {
    const fg = c.signals.find((s) => s.gnd)
    if (fg && fg.gnd) {
      c.ground = fg.gnd
      rails.set(fg.gnd, { v: 0, by: `${fg.part.comp.id} gnd`, compId: fg.part.comp.id })
    }
  }
  if (!c.ground) return

  for (let iter = 0; iter < 32; iter++) {
    let changed = false
    for (const s of c.sources) {
      if (!s.plus || !s.minus || s.plus === s.minus || !Number.isFinite(s.v)) continue
      const id = s.part.comp.id
      const vm = rails.get(s.minus)
      const vp = rails.get(s.plus)
      if (vm && !vp) {
        rails.set(s.plus, { v: vm.v + s.v, by: `${id} +`, compId: id })
        changed = true
      } else if (vp && !vm) {
        rails.set(s.minus, { v: vp.v - s.v, by: `${id} −`, compId: id })
        changed = true
      }
    }
    for (const r of c.regulators) {
      if (!r.inNet || !r.outNet || !r.gndNet || rails.has(r.outNet)) continue
      const vin = rails.get(r.inNet)
      const vg = rails.get(r.gndNet)
      if (!vin || !vg) continue
      const u = vin.v - vg.v
      if (u < 1.0) continue // LdoDevice: below ~1 V input the output is released
      const id = r.part.comp.id
      rails.set(r.outNet, {
        v: vg.v + Math.min(r.vout, u - r.dropout),
        by: r.elId ? `${id} ${r.vout} V regulator` : `${id} output`,
        compId: id,
      })
      changed = true
    }
    if (!changed) break
  }

  for (const s of c.sources) {
    if (!s.plus || !s.minus || s.plus === s.minus || !Number.isFinite(s.v)) continue
    const vm = rails.get(s.minus)
    const vp = rails.get(s.plus)
    if (vm && vp && Math.abs(vp.v - vm.v - s.v) > V_TOL) {
      // the net already carries another source's voltage
      const other = vp.compId !== s.part.comp.id ? vp : vm
      c.railConflicts.push({ source: s, expected: vm.v + s.v, actual: other })
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function railOf(c: Circuit, net: string | null | undefined): Rail | undefined {
  return net ? c.rails.get(net) : undefined
}

/** Pins on a net (excluding one part, optionally). */
export function pinsOn(c: Circuit, net: string | null | undefined, exceptPart?: PartNode): NetPin[] {
  if (!net) return []
  const list = c.pinsByNet.get(net) ?? []
  return exceptPart ? list.filter((p) => p.part !== exceptPart) : list
}

export function edgesOn(c: Circuit, net: string | null | undefined): Edge[] {
  return net ? (c.edgesByNet.get(net) ?? []) : []
}

export function otherEnd(e: Edge, net: string): string {
  return e.a === net ? e.b : e.a
}

export function teleOf(c: Circuit, id: string): ComponentTelemetry | undefined {
  return c.telemetry?.components?.[id]
}

/** Net of a named pin of a part. */
export function netOfPin(part: PartNode, pin: string): string | null {
  const i = part.entry.pins.indexOf(pin)
  return i >= 0 ? part.nets[i] : null
}

export function refOfPin(part: PartNode, pin: string): string | null {
  const i = part.entry.pins.indexOf(pin)
  return i >= 0 ? part.refs[i] : null
}

/** Supply voltage across a part's plus/minus pins from the rails (NaN unknown). */
export function supplyVoltage(c: Circuit, part: PartNode, plusPin: string, minusPin: string): number {
  const p = railOf(c, netOfPin(part, plusPin))
  const m = railOf(c, netOfPin(part, minusPin))
  return p && m ? p.v - m.v : NaN
}

/** Human description of a net for messages: its rail, else a pin ref on it. */
export function describeNet(c: Circuit, net: string): string {
  const rail = c.rails.get(net)
  if (rail) return `${fmtV(rail.v)} (${rail.by})`
  if (net.startsWith('R:') || /^\d+:R:/.test(net)) return `the ${net.replace(/^(\d+:)?R:/, '')} rail`
  return `net ${net}`
}

/**
 * Values in finding messages are THE app's unit format (UX helper H3,
 * src/instruments/format.ts — IN-14): 「3.30 V」, 「500 mV」, 「9.70 mA」, the
 * same strings the inspector and the instruments print for the same value.
 * `plain` keeps the English annotations (「> 2 A (short circuit)」); tMessage
 * translates the sentence later. A value that cannot be trusted prints 「—」.
 */
export function fmtV(v: number): string {
  return fmtVoltage(v, { plain: true })
}

/** A current's magnitude (direction is said in words), H3 format: 「9.70 mA」, 「0 A」 under 1 nA. */
export function fmtA(a: number): string {
  return fmtCurrent(Number.isFinite(a) ? Math.abs(a) : a, { plain: true })
}

export function fmtOhm(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(3)} MΩ`
  if (r >= 1e3) return `${+(r / 1e3).toPrecision(3)} kΩ`
  return `${+r.toPrecision(3)} Ω`
}

// ---------------------------------------------------------------------------
// Wire paths between static nets (for direct-short findings)
// ---------------------------------------------------------------------------

/** Static (pre-merge) net id of an endpoint ref. */
function staticNet(ref: string): string | null {
  const h = parseHole(ref)
  if (h) return netIdForHole(h)
  const t = parseTerminalRef(ref)
  return t ? netIdForTerminal(t.componentId, t.pin) : null
}

/**
 * Wires (and internal part bridges) on a shortest path joining two endpoint
 * refs before nets merge — the connections to remove to break a short.
 * Strips are implicit (two refs in one strip share a static net).
 */
export function connectionPath(c: Circuit, fromRef: string, toRef: string): { wires: string[]; bridges: string[] } {
  const from = staticNet(fromRef)
  const to = staticNet(toRef)
  const empty = { wires: [], bridges: [] }
  if (!from || !to) return empty
  if (from === to) return empty
  type Step = { node: string; via: string; kind: 'wire' | 'bridge' }
  const adj = new Map<string, Step[]>()
  const link = (a: string, b: string, via: string, kind: 'wire' | 'bridge') => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ node: b, via, kind })
    adj.get(b)!.push({ node: a, via, kind })
  }
  for (const w of c.wires) {
    const a = typeof w.from === 'string' ? staticNet(w.from) : null
    const b = typeof w.to === 'string' ? staticNet(w.to) : null
    if (a && b) link(a, b, w.id, 'wire')
  }
  for (const part of c.parts) {
    for (const [pa, pb] of part.entry.internalBridges ?? []) {
      const ra = refOfPin(part, pa)
      const rb = refOfPin(part, pb)
      const a = ra ? staticNet(ra) : null
      const b = rb ? staticNet(rb) : null
      if (a && b) link(a, b, part.comp.id, 'bridge')
    }
  }
  const prev = new Map<string, { from: string; step: Step }>()
  const seen = new Set([from])
  const queue = [from]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === to) break
    for (const st of adj.get(cur) ?? []) {
      if (seen.has(st.node)) continue
      seen.add(st.node)
      prev.set(st.node, { from: cur, step: st })
      queue.push(st.node)
    }
  }
  if (!seen.has(to)) return empty
  const wires: string[] = []
  const bridges: string[] = []
  for (let n = to; n !== from; ) {
    const p = prev.get(n)!
    if (p.step.kind === 'wire') wires.unshift(p.step.via)
    else if (!bridges.includes(p.step.via)) bridges.unshift(p.step.via)
    n = p.from
  }
  return { wires, bridges }
}
