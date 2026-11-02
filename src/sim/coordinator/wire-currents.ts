/**
 * Current through every wire and every piece of breadboard strip / rail
 * metal (SimTelemetry.wireCurrents / stripCurrents — contract C2).
 *
 * The analog solver treats a whole net as ONE node, so it knows how much
 * current each part pin pushes into a net but not which wires carry it. This
 * module resolves that with a small physical model of the copper inside each
 * net: every place something attaches (a used hole, an off-board terminal) is
 * a node; wires, strip metal between neighbouring used holes of a 5-hole
 * strip, rail metal between neighbouring used rail holes and a part's
 * internal bridges (e.g. a Blue Pill's three GND pins) are resistances
 * proportional to their length. KCL with the pin currents as injections then
 * gives each conductor's current — exact for the usual tree-shaped nets
 * (where KCL alone decides) and physically split for loops / parallel wires.
 *
 * Built once per engine (the conductances never change); each solve is a
 * forward/back substitution per net.
 *
 * Never a broken loop: a net whose pin currents are not all known (NaN from
 * the tracker: a chip current that could not be attributed honestly, or a
 * part the tracker concealed because it pushes current into such a net) or
 * do not sum to zero within KCL_HIDE_A publishes NO wire / strip currents —
 * the flow layer then shows nothing there instead of current appearing from
 * or vanishing into a terminal.
 */
import type { BoardConfig, CircuitLayout, ComponentInstance, Hole } from '../../model/types'
import { componentPinHoles, formatHole, holePosition, netIdForHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { getEntry } from '../../model/catalog'
import type { CatalogEntry } from '../../model/catalog'
import { KCL_HIDE_A } from './current-tracker'

/** Contact resistance of a jumper end in a socket / on a post (Ω). */
export const R_CONTACT = 0.01
/** 22 AWG jumper conductor per hole pitch (0.053 Ω/m × 2.54 mm). */
export const R_WIRE_PER_PITCH = 1.35e-4
/** Strip / rail clip metal per hole pitch (Ω). */
export const R_METAL_PER_PITCH = 2e-3
/** A part's internal bridge (PCB plane, Ω). */
export const R_BRIDGE = 5e-3
/** Plan length assumed for a wire end on an off-board terminal (pitches). */
const TERMINAL_RUN = 12
/** Strip segments carrying less than this are not listed (A). */
export const STRIP_LIST_MIN = 1e-9
/**
 * A net whose pin currents miss KCL by more than this is not published (A):
 * the tracker's concealment threshold (./current-tracker.ts), half the flow
 * layer's visibility floor. The tracker has already hidden such a net and
 * every part around it (drain → conceal); this check is the safety net.
 */
export { KCL_HIDE_A }

/** A part the engine simulates, with the global slot of its catalog pin 0. */
export interface FlowPart {
  comp: ComponentInstance
  entry: CatalogEntry
  /** global part-pin slot of catalog pin 0 (pins consecutive) */
  base: number
}

interface GNode {
  key: string
  net: number
  local: number
  hole: Hole | null
  pos: { x: number; z: number } | null
  /** global part-pin slots attached here */
  slots: number[]
}

interface GEdge {
  a: number // local node index
  b: number
  g: number
  /** wire id, strip key ("c12>e12") or '' for a bridge */
  wire: string | null
  strip: string | null
}

interface NetSystem {
  nodes: GNode[]
  edges: GEdge[]
  /** local index → reduced index (−1 = pinned to 0 V of this net's local frame) */
  red: Int32Array
  /** dense Cholesky factor (lower, row-major) of the reduced Laplacian */
  chol: Float64Array
  m: number
  /** local node index of the 0 V reference point (ground net only; −1 = none) */
  refNode: number
  /** scratch */
  inj: Float64Array
  v: Float64Array
  y: Float64Array
}

export interface FlowResult {
  wires: Record<string, number>
  strips: Record<string, number>
}

/** Off-board terminal key of the 0 V reference: the netlist's ground choice. */
function referenceTerminal(components: ComponentInstance[]): string | null {
  const ps = components.find((c) => c && c.type === 'power_supply')
  if (ps) return `${ps.id}:-`
  const fg = components.find((c) => c && c.type === 'function_generator')
  if (fg) return `${fg.id}:gnd`
  for (const c of components) {
    if (!c || typeof c.type !== 'string' || typeof c.id !== 'string') continue
    const entry = getEntry(c.type)
    const src = entry?.placement === 'offboard' ? entry.source : undefined
    if (src && entry?.pins.includes(src.minus)) return `${c.id}:${src.minus}`
  }
  return null
}

export class WireFlowModel {
  private readonly systems: NetSystem[] = []

  constructor(
    layout: CircuitLayout,
    board: BoardConfig,
    parts: FlowPart[],
    netOf: (ref: string) => string | null,
    groundNet: string | null,
  ) {
    const components: ComponentInstance[] = Array.isArray(layout?.components) ? layout.components : []
    const wires = Array.isArray(layout?.wires) ? layout.wires : []
    const netIndex = new Map<string, number>()
    const nodes = new Map<string, GNode>()
    const perNet: { nodes: GNode[]; edges: GEdge[] }[] = []

    const node = (key: string, hole: Hole | null): GNode | null => {
      const have = nodes.get(key)
      if (have) return have
      const net = netOf(key)
      if (!net) return null
      let ni = netIndex.get(net)
      if (ni === undefined) {
        ni = perNet.length
        netIndex.set(net, ni)
        perNet.push({ nodes: [], edges: [] })
      }
      const list = perNet[ni].nodes
      const n: GNode = { key, net: ni, local: list.length, hole, pos: hole ? holePosition(hole) : null, slots: [] }
      list.push(n)
      nodes.set(key, n)
      return n
    }
    const edge = (a: GNode, b: GNode, r: number, wire: string | null, strip: string | null): void => {
      if (a.net !== b.net || a === b) return
      perNet[a.net].edges.push({ a: a.local, b: b.local, g: 1 / r, wire, strip })
    }

    // part pins
    for (const p of parts) {
      const { comp, entry } = p
      const keys: (GNode | null)[] = []
      if (entry.placement === 'offboard') {
        for (const pin of entry.pins) keys.push(node(`${comp.id}:${pin}`, null))
      } else {
        const holes = componentPinHoles(comp, entry, board)
        if (!holes) continue
        for (const h of holes) keys.push(h ? node(formatHole(h), h) : null)
      }
      for (let i = 0; i < keys.length; i++) keys[i]?.slots.push(p.base + i)
      for (const [pa, pb] of entry.internalBridges ?? []) {
        const a = keys[entry.pins.indexOf(pa)]
        const b = keys[entry.pins.indexOf(pb)]
        if (a && b) edge(a, b, R_BRIDGE, null, null)
      }
    }

    // wires
    const byId = new Map<string, ComponentInstance>()
    for (const c of components) if (c && typeof c.id === 'string' && !byId.has(c.id)) byId.set(c.id, c)
    const endpoint = (ref: unknown): GNode | null => {
      if (typeof ref !== 'string') return null
      const h = parseHole(ref)
      if (h) return node(formatHole(h), h)
      const t = parseTerminalRef(ref)
      if (!t) return null
      const comp = byId.get(t.componentId)
      const entry = comp ? getEntry(comp.type) : undefined
      if (!entry || entry.placement !== 'offboard' || !entry.pins.includes(t.pin)) return null
      return node(`${t.componentId}:${t.pin}`, null)
    }
    for (const w of wires) {
      if (!w || typeof w.id !== 'string') continue
      const a = endpoint(w.from)
      const b = endpoint(w.to)
      if (!a || !b) continue
      const run = a.pos && b.pos ? Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) : TERMINAL_RUN
      if (a === b) {
        // both ends in one hole: no current can flow through it
        perNet[a.net].edges.push({ a: a.local, b: a.local, g: 0, wire: w.id, strip: null })
        continue
      }
      edge(a, b, 2 * R_CONTACT + R_WIRE_PER_PITCH * (run + 2), w.id, null)
    }

    // strip and rail metal between neighbouring used holes
    const metal = new Map<string, GNode[]>()
    for (const n of nodes.values()) {
      if (!n.hole) continue
      const id = netIdForHole(n.hole)
      const list = metal.get(id)
      if (list) list.push(n)
      else metal.set(id, [n])
    }
    for (const list of metal.values()) {
      if (list.length < 2) continue
      const rail = list[0].hole!.kind === 'rail'
      list.sort((p, q) => (rail ? p.pos!.x - q.pos!.x : p.pos!.z - q.pos!.z))
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]
        const b = list[i]
        const d = rail ? b.pos!.x - a.pos!.x : b.pos!.z - a.pos!.z
        edge(a, b, R_METAL_PER_PITCH * Math.max(d, 0.25), null, `${a.key}>${b.key}`)
      }
    }

    // the 0 V reference point
    const refKey = referenceTerminal(components)
    const refNode = refKey ? nodes.get(refKey) ?? null : null
    const groundIdx = groundNet !== null ? netIndex.get(groundNet) ?? -1 : -1

    for (let ni = 0; ni < perNet.length; ni++) {
      const { nodes: list, edges } = perNet[ni]
      this.systems.push(
        buildSystem(list, edges, ni === groundIdx && refNode && refNode.net === ni ? refNode.local : -1),
      )
    }
  }

  /**
   * Conductor currents for the given mean part-pin currents (A, into the
   * part per global slot; NaN = unknown) and reference injection (A into the
   * ground net). A net with an unknown pin current, or whose pin currents
   * miss KCL by more than KCL_HIDE_A, is left out of the result (its wires
   * and strip metal stay unknown — never a broken loop).
   */
  solve(pins: Float64Array, ref: number): FlowResult {
    const wires: Record<string, number> = {}
    const strips: Record<string, number> = {}
    for (const sys of this.systems) {
      const inj = sys.inj
      inj.fill(0)
      let sum = 0
      let known = true
      for (const n of sys.nodes) {
        let j = 0
        for (const s of n.slots) {
          const i = s >= 0 && s < pins.length ? pins[s] : 0
          if (Number.isFinite(i)) j -= i // current INTO the part leaves the net
          else known = false
        }
        inj[n.local] = j
        sum += j
      }
      // unknown / unbalanced (the reference would have to absorb it): show nothing here
      if (!known || !(Math.abs(sum) <= KCL_HIDE_A)) continue
      if (sys.refNode >= 0 && Number.isFinite(ref)) inj[sys.refNode] += ref
      solveSystem(sys)
      const v = sys.v
      for (const e of sys.edges) {
        const i = e.g * (v[e.a] - v[e.b])
        if (e.wire !== null) wires[e.wire] = i === 0 ? 0 : i
        else if (e.strip !== null && Math.abs(i) > STRIP_LIST_MIN) strips[e.strip] = i
      }
    }
    return { wires, strips }
  }
}

/** Build one net's reduced Laplacian and factor it (dense Cholesky). */
function buildSystem(nodes: GNode[], edges: GEdge[], refNode: number): NetSystem {
  const n = nodes.length
  // connected components (a net is connected through its own copper, but a
  // conductor the model could not place must not make the matrix singular)
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (const e of edges) if (e.g > 0) parent[find(e.a)] = find(e.b)
  // one pinned node per component: the reference point, else its first node
  const pinned = new Map<number, number>()
  if (refNode >= 0) pinned.set(find(refNode), refNode)
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!pinned.has(r)) pinned.set(r, i)
  }
  const isPinned = new Uint8Array(n)
  for (const i of pinned.values()) isPinned[i] = 1
  const red = new Int32Array(n)
  let m = 0
  for (let i = 0; i < n; i++) red[i] = isPinned[i] ? -1 : m++
  const L = new Float64Array(m * m)
  for (const e of edges) {
    if (!(e.g > 0)) continue
    const a = red[e.a]
    const b = red[e.b]
    if (a >= 0) L[a * m + a] += e.g
    if (b >= 0) L[b * m + b] += e.g
    if (a >= 0 && b >= 0) {
      L[a * m + b] -= e.g
      L[b * m + a] -= e.g
    }
  }
  // Cholesky (the reduced Laplacian of a connected component with a pinned
  // node is symmetric positive definite)
  for (let j = 0; j < m; j++) {
    let d = L[j * m + j]
    for (let k = 0; k < j; k++) d -= L[j * m + k] * L[j * m + k]
    d = d > 1e-30 ? Math.sqrt(d) : 1e-15
    L[j * m + j] = d
    for (let i = j + 1; i < m; i++) {
      let s = L[i * m + j]
      for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k]
      L[i * m + j] = s / d
    }
  }
  return { nodes, edges, red, chol: L, m, refNode, inj: new Float64Array(n), v: new Float64Array(n), y: new Float64Array(m) }
}

/** v = L⁻¹·inj on the reduced nodes (pinned nodes at 0 V). */
function solveSystem(sys: NetSystem): void {
  const { red, chol: L, m, inj, v, y } = sys
  const n = red.length
  for (let i = 0; i < n; i++) if (red[i] >= 0) y[red[i]] = inj[i]
  // forward: L·z = y
  for (let i = 0; i < m; i++) {
    let s = y[i]
    for (let k = 0; k < i; k++) s -= L[i * m + k] * y[k]
    y[i] = s / L[i * m + i]
  }
  // backward: Lᵀ·w = z
  for (let i = m - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < m; k++) s -= L[k * m + i] * y[k]
    y[i] = s / L[i * m + i]
  }
  for (let i = 0; i < n; i++) v[i] = red[i] >= 0 ? y[red[i]] : 0
}
