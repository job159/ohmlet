/**
 * Logic-net layer of the mixed-signal model (see ./api.ts header).
 *
 * 1. CLASSIFICATION (`classifyNets`) — from the netlist and the catalog, every
 *    solver node is one of:
 *      RAIL   a fixed-voltage net: a power_supply terminal, ground, an MCU
 *             board's power/ground pins (entry.mcu vddPin/gndPin and
 *             entry.supplyPins), a regulator output;
 *      LOGIC  "logic-resolvable": every attachment is a logic pin (MCU pin
 *             of entry.mcu.pinMap, entry.digital input/output pin), a
 *             resistor whose other end is a RAIL (pull-up / pull-down), a
 *             probe, or a neutral pin (a device's supply pin);
 *      ANALOG anything else (LED, capacitor, transistor, legacy chip, switch,
 *             multimeter, a resistor between two signal nets …).
 *    Analog nets are resolved by the MNA solver only; logic readers see their
 *    voltage from the latest analog solve.
 *
 * 2. RESOLUTION (`DigitalNets`) — on a LOGIC net every element is a
 *    conductance to a fixed voltage (a driver stage to its part's rails, a
 *    pull resistor to its rail), so the net's DC voltage is exactly
 *        V = Σ G·V_rail / Σ G
 *    which is what the analog solver would also find, but computed at the
 *    exact virtual time of a drive change. A strong high and a strong low
 *    at the same time is CONTENTION (level undefined + an issue); Σ G = 0 is
 *    FLOATING (level undefined: the classic missing pull-up). Listeners are
 *    notified synchronously, so a device answering on the bus (ACK, MISO)
 *    is seen by the MCU in the same instruction cycle.
 *
 * 3. EXTERNAL SOURCES (the UART terminal's USB-TTL adapter, src/sim/
 *    coordinator/uart-adapter.ts): a slot's high level may be a fixed offset
 *    above a reference rail (addSlot `upOffset`: 3.3 V above the board's
 *    GND), and a slot may YIELD (setYield): it is released before the net
 *    resolves whenever another slot drives the net strongly, so it never
 *    fights a module's TXD or an MCU output. `strongDriver` names who
 *    drives a net strongly right now.
 */
import type { ComponentInstance } from '../../model/types'
import { getEntry, paramOf } from '../../model/catalog'

/** Node kinds (per solver node; ground is node −1). */
export const NET_ANALOG = 0
export const NET_LOGIC = 1
export const NET_RAIL = 2

/** Resolved state of a logic net. */
export const NET_FLOATING = 0
export const NET_DRIVEN = 1
export const NET_CONTENTION = 2
export type NetState = 0 | 1 | 2

/** Driver conductance at or above which a drive counts as "strong" (≤ 1 kΩ). */
export const G_STRONG = 1e-3

/** The slice of SimEngine the classifier needs. */
export interface EngineNodeView {
  readonly nodeCount: number
  pinNodesOf(componentId: string): Int32Array | null
  subcircuitOf(componentId: string): { id: string; model: string; nodes: Int32Array }[]
}

export interface PullInfo {
  node: number
  railNode: number
  g: number
  label: string
}

export interface NetClassification {
  readonly nodeCount: number
  /** kind per node, index = node + 1 (index 0 = ground) */
  readonly kind: Uint8Array
  /** non-probe pin attachments per node (index = node + 1), for "is anything connected" */
  readonly attachments: Uint16Array
  readonly pulls: PullInfo[]
  /**
   * Solver node of every internal sub-circuit node, keyed by
   * internalNodeKey(componentId, '@name') — e.g. a module's on-board
   * regulator output that its DigitalSpec.outputRail names. Additive:
   * absent in hand-built classifications.
   */
  readonly internal?: ReadonlyMap<string, number>
}

/** Key of `NetClassification.internal`. */
export function internalNodeKey(componentId: string, name: string): string {
  return `${componentId}\u0000${name}`
}

/** Kind of solver node `node` (ground → RAIL, unknown → ANALOG). */
export function kindOf(cls: NetClassification, node: number): number {
  const k = node + 1
  return k >= 0 && k < cls.kind.length ? cls.kind[k] : NET_ANALOG
}

interface ResistorAttach {
  a: number
  b: number
  g: number
  label: string
}

/**
 * Classify every solver node of a built engine (see the file header).
 * `components` are the layout's components (engine-excluded ones skipped).
 */
export function classifyNets(
  engine: EngineNodeView,
  components: readonly ComponentInstance[],
): NetClassification {
  const n = engine.nodeCount
  const size = n + 1
  const rail = new Uint8Array(size)
  const analog = new Uint8Array(size)
  const logic = new Uint8Array(size)
  const attachments = new Uint16Array(size)
  const resistors: ResistorAttach[] = []
  const internal = new Map<string, number>()
  rail[0] = 1 // ground

  const idx = (node: number): number => (node >= -1 && node < n ? node + 1 : -1)
  const mark = (arr: Uint8Array, node: number): void => {
    const k = idx(node)
    if (k >= 0) arr[k] = 1
  }
  const attach = (node: number): void => {
    const k = idx(node)
    if (k >= 0 && attachments[k] < 0xffff) attachments[k]++
  }

  for (const comp of components) {
    if (!comp || typeof comp.id !== 'string') continue
    const entry = getEntry(comp.type)
    if (!entry) continue
    const nodes = engine.pinNodesOf(comp.id)
    if (!nodes) continue
    const pins = entry.pins
    const sim = entry.sim
    if (sim.kind === 'probe') continue

    if (entry.mcu) {
      const spec = entry.mcu
      const railPins = new Set<string>([spec.vddPin, spec.gndPin])
      for (const p of entry.supplyPins?.plus ?? []) railPins.add(p)
      for (const p of entry.supplyPins?.minus ?? []) railPins.add(p)
      for (let i = 0; i < pins.length; i++) {
        const node = nodes[i]
        attach(node)
        if (railPins.has(pins[i])) mark(rail, node)
        else if (spec.pinMap[pins[i]]) mark(logic, node)
        else if (pins[i] === spec.resetPin) mark(analog, node) // NRST: read through the analog solve
        // other pins (VBAT …): neutral
      }
    } else if (entry.digital) {
      const spec = entry.digital
      const io = new Set<string>([...spec.inputs, ...spec.outputs])
      for (let i = 0; i < pins.length; i++) {
        attach(nodes[i])
        if (io.has(pins[i])) mark(logic, nodes[i])
        // supply / ground / unlisted pins are neutral consumers
      }
    } else if (sim.kind === 'device' && sim.model === 'power_supply') {
      for (let i = 0; i < pins.length; i++) {
        attach(nodes[i])
        mark(rail, nodes[i])
      }
    } else if (sim.kind === 'device' && sim.model === 'resistor' && nodes.length === 2) {
      attach(nodes[0])
      attach(nodes[1])
      resistors.push({
        a: nodes[0],
        b: nodes[1],
        g: resistorG(paramOf(comp.params, entry, 'resistance')),
        label: comp.id,
      })
    } else {
      for (let i = 0; i < nodes.length; i++) {
        attach(nodes[i])
        mark(analog, nodes[i])
      }
    }

    // board-level sub-circuit elements (on-board LEDs, pull-ups, regulator)
    for (const el of engine.subcircuitOf(comp.id)) {
      const def = entry.subcircuit?.find((s) => s.id === el.id)
      def?.pins.forEach((p, i) => {
        if (typeof p === 'string' && p.startsWith('@') && i < el.nodes.length) internal.set(internalNodeKey(comp.id, p), el.nodes[i])
      })
      if (el.model === 'resistor' && el.nodes.length === 2) {
        resistors.push({
          a: el.nodes[0],
          b: el.nodes[1],
          g: resistorG(def?.params?.resistance),
          label: `${comp.id}.${el.id}`,
        })
      } else if (el.model === 'ldo' && el.nodes.length === 3) {
        mark(rail, el.nodes[1]) // regulated output
        mark(analog, el.nodes[0])
        mark(analog, el.nodes[2])
      } else {
        for (let i = 0; i < el.nodes.length; i++) mark(analog, el.nodes[i])
      }
    }
  }

  // resistors: a pull when exactly one end is a rail, otherwise analog
  const pulls: PullInfo[] = []
  for (const r of resistors) {
    const ka = idx(r.a)
    const kb = idx(r.b)
    if (ka < 0 || kb < 0 || r.a === r.b) continue
    if (rail[ka] && !rail[kb]) pulls.push({ node: r.b, railNode: r.a, g: r.g, label: r.label })
    else if (rail[kb] && !rail[ka]) pulls.push({ node: r.a, railNode: r.b, g: r.g, label: r.label })
    else if (!rail[ka] || !rail[kb]) {
      analog[ka] = 1
      analog[kb] = 1
    }
  }

  const kind = new Uint8Array(size)
  for (let k = 0; k < size; k++) {
    kind[k] = rail[k] ? NET_RAIL : analog[k] ? NET_ANALOG : logic[k] ? NET_LOGIC : NET_ANALOG
  }
  // pulls only matter on logic nets
  return {
    nodeCount: n,
    kind,
    attachments,
    pulls: pulls.filter((p) => kind[p.node + 1] === NET_LOGIC),
    internal,
  }
}

function resistorG(r: unknown): number {
  const v = typeof r === 'number' ? r : typeof r === 'string' ? parseFloat(r) : 1000
  const ohms = Number.isFinite(v) ? Math.min(Math.max(v, 1e-3), 1e12) : 1000
  return 1 / ohms
}

// --------------------------------------------------------------- resolution

interface Slot {
  node: number
  upNode: number
  downNode: number
  /**
   * Volts added to the up rail's voltage (0 for every on-board stage): an
   * external source whose high level is fixed relative to a reference rail
   * — the UART terminal's USB-TTL adapter drives 3.3 V above the board's
   * GND whatever the board's own VDD does (addSlot `upOffset`).
   */
  upOffset: number
  gUp: number
  gDown: number
  label: string
  /**
   * A YIELDING source (setYield): it lets go — conductances to 0, then this
   * callback with the other driver's label — the moment another strong
   * driver shares its net, before the net is resolved. The UART terminal's
   * USB-TTL adapter never fights a module's TXD or an MCU output.
   */
  onYield?: (by: string) => void
}

interface LogicNet {
  slots: number[]
  pulls: PullInfo[]
  v: number
  state: NetState
  listeners: ((node: number) => void)[]
  contentionReported: boolean
  /** slots with an onYield callback on this net */
  yielding: number
}

/** Max nested resolution depth (device answering device …) before giving up. */
const MAX_DEPTH = 32

/**
 * Rail movement (V) after which `refreshRails` re-resolves every logic net.
 * Logic-net voltages are what an MCU's ADC converts, so this stays far below
 * one 12-bit LSB at 3.3 V (0.8 mV); a supply that is merely settling moves
 * the rails by less than this per solve and costs nothing.
 */
export const RAIL_REFRESH_V = 10e-6

export class DigitalNets {
  private readonly nets = new Map<number, LogicNet>()
  private readonly slots: Slot[] = []
  /**
   * rail node → its voltage at the last FULL resolution (resolveAll). Only
   * resolveAll writes it: a single net resolved in between (a drive change)
   * reads the live rail voltage but must not mark the rail "seen", or the
   * other nets would keep the old rail voltage after a supply move.
   */
  private readonly railUsed = new Map<number, number>()
  private depth = 0
  private oscillationReported = false

  constructor(
    readonly cls: NetClassification,
    private readonly railVoltage: (node: number) => number,
    private readonly onIssue: (key: string, level: 'error' | 'warning', message: string) => void,
  ) {
    for (let k = 1; k < cls.kind.length; k++) {
      if (cls.kind[k] === NET_LOGIC) {
        this.nets.set(k - 1, {
          slots: [],
          pulls: [],
          v: NaN,
          state: NET_FLOATING,
          listeners: [],
          contentionReported: false,
          yielding: 0,
        })
      }
    }
    for (const p of cls.pulls) {
      const net = this.nets.get(p.node)
      if (net) {
        net.pulls.push(p)
        this.railUsed.set(p.railNode, NaN)
      }
    }
  }

  /** True when `node` is logic-resolvable. */
  isLogic(node: number): boolean {
    return this.nets.has(node)
  }

  /**
   * Solver node of a component's internal sub-circuit node ('@v33'), or −2
   * (no node) when the classification does not know it.
   */
  internalNode(componentId: string, name: string): number {
    return this.cls.internal?.get(internalNodeKey(componentId, name)) ?? -2
  }

  /** Voltage of any solver node from the latest analog solve (ground 0 V, NaN unknown). */
  railVoltageOf(node: number): number {
    return this.railVoltage(node)
  }

  /**
   * Register a logic pin on `node` (a driver and/or reader). `upNode` /
   * `downNode` are the rails its output stage switches to; `upOffset` (V,
   * default 0) is added to the up rail's voltage — a source whose high level
   * is fixed relative to a reference rail (the terminal's USB-TTL adapter:
   * up = down = the board's GND, upOffset = 3.3 V). Returns the slot id, or
   * −1 when the node is not a logic net.
   */
  addSlot(node: number, upNode: number, downNode: number, label: string, upOffset = 0): number {
    const net = this.nets.get(node)
    if (!net) return -1
    const id = this.slots.length
    this.slots.push({ node, upNode, downNode, upOffset: Number.isFinite(upOffset) ? upOffset : 0, gUp: 0, gDown: 0, label })
    net.slots.push(id)
    this.railUsed.set(upNode, NaN)
    this.railUsed.set(downNode, NaN)
    return id
  }

  /** Set a slot's initial drive WITHOUT resolving (binding phase; call resolveAll after). */
  initDrive(slot: number, gUp: number, gDown: number): void {
    const s = this.slots[slot]
    if (!s) return
    s.gUp = gUp
    s.gDown = gDown
  }

  /**
   * Make `slot` a yielding source (null: an ordinary one again): whenever
   * another slot drives its net strongly while it does, it is released
   * (both conductances 0) before the net resolves and `fn` is told who
   * drives the net. Its own drive changes still resolve normally.
   */
  setYield(slot: number, fn: ((by: string) => void) | null): void {
    const s = this.slots[slot]
    const net = s ? this.nets.get(s.node) : undefined
    if (!s || !net) return
    if (s.onYield && !fn) net.yielding--
    else if (!s.onYield && fn) net.yielding++
    s.onYield = fn ?? undefined
  }

  /** Change a slot's stage conductances; resolves the net and notifies listeners synchronously. */
  setDrive(slot: number, gUp: number, gDown: number): void {
    const s = this.slots[slot]
    if (!s || (s.gUp === gUp && s.gDown === gDown)) return
    s.gUp = gUp
    s.gDown = gDown
    this.resolve(s.node)
  }

  /**
   * The label of a slot on `node` that drives it STRONGLY right now (an
   * up or down conductance ≥ G_STRONG: a push-pull output, an open-drain
   * low), skipping the slots in `except`; null when none does. The
   * terminal's USB-TTL adapter asks this before it drives a net, so it
   * never fights a module's TXD or another MCU's output.
   */
  strongDriver(node: number, except: readonly number[] = []): string | null {
    const net = this.nets.get(node)
    if (!net) return null
    for (const id of net.slots) {
      if (except.includes(id)) continue
      const s = this.slots[id]
      if (s.gUp >= G_STRONG || s.gDown >= G_STRONG) return s.label
    }
    return null
  }

  /** Resolved voltage of a logic net (NaN when floating). */
  voltage(node: number): number {
    return this.nets.get(node)?.v ?? NaN
  }

  state(node: number): NetState {
    return this.nets.get(node)?.state ?? NET_FLOATING
  }

  /** Subscribe to resolution changes of a logic net; returns an unsubscribe. */
  listen(node: number, fn: (node: number) => void): () => void {
    const net = this.nets.get(node)
    if (!net) return () => {}
    net.listeners.push(fn)
    return () => {
      const i = net.listeners.indexOf(fn)
      if (i >= 0) net.listeners.splice(i, 1)
    }
  }

  /** Resolve every logic net once (initial state after binding; notifies changes). */
  resolveAll(): void {
    this.sampleRails()
    for (const node of this.nets.keys()) this.resolve(node)
  }

  /**
   * After an analog solve: if any rail feeding a logic net moved by more
   * than RAIL_REFRESH_V since the last full resolution (power-up, supply
   * change, brown-out, a load on the regulator), re-resolve every logic net.
   * Returns whether it did.
   */
  refreshRails(): boolean {
    let moved = false
    for (const [node, used] of this.railUsed) {
      const v = this.railVoltage(node)
      // an unconnected rail (NaN both times) has not moved
      if (!(Math.abs(v - used) <= RAIL_REFRESH_V) && !(Number.isNaN(v) && Number.isNaN(used))) {
        moved = true
        break
      }
    }
    if (moved) this.resolveAll()
    return moved
  }

  private sampleRails(): void {
    for (const node of this.railUsed.keys()) this.railUsed.set(node, this.railVoltage(node))
  }

  private resolve(node: number): void {
    const net = this.nets.get(node)
    if (!net) return
    if (net.yielding > 0) this.yieldTo(net)
    let gSum = 0
    let iSum = 0
    let strongUp = -1
    let strongDown = -1
    for (const id of net.slots) {
      const s = this.slots[id]
      if (s.gUp > 0) {
        gSum += s.gUp
        iSum += s.gUp * (this.rail(s.upNode) + s.upOffset)
        if (s.gUp >= G_STRONG) strongUp = id
      }
      if (s.gDown > 0) {
        gSum += s.gDown
        iSum += s.gDown * this.rail(s.downNode)
        if (s.gDown >= G_STRONG) strongDown = id
      }
    }
    for (const p of net.pulls) {
      gSum += p.g
      iSum += p.g * this.rail(p.railNode)
    }
    let state: NetState
    let v: number
    if (strongUp >= 0 && strongDown >= 0 && strongUp !== strongDown) {
      state = NET_CONTENTION
      v = iSum / gSum
      if (!net.contentionReported) {
        net.contentionReported = true
        this.onIssue(
          `contention:${node}`,
          'warning',
          `logic contention: ${this.slots[strongUp].label} drives high while ${this.slots[strongDown].label} drives low (level undefined)`,
        )
      }
    } else if (gSum > 0) {
      state = NET_DRIVEN
      v = iSum / gSum
    } else {
      state = NET_FLOATING
      v = NaN
    }
    const changed =
      state !== net.state ||
      !(Math.abs(v - net.v) <= 1e-9 || (Number.isNaN(v) && Number.isNaN(net.v)))
    net.state = state
    net.v = v
    if (!changed || net.listeners.length === 0) return
    if (this.depth >= MAX_DEPTH) {
      if (!this.oscillationReported) {
        this.oscillationReported = true
        this.onIssue('logic-oscillation', 'error', 'logic nets did not settle (devices keep re-driving each other) — notifications dropped')
      }
      return
    }
    this.depth++
    try {
      // copy: a listener may unsubscribe while we iterate
      const ls = net.listeners.slice()
      for (const fn of ls) fn(node)
    } finally {
      this.depth--
    }
  }

  /** Release every yielding source of `net` that another strong driver now shares the net with. */
  private yieldTo(net: LogicNet): void {
    for (const id of net.slots) {
      const s = this.slots[id]
      if (!s.onYield || !(s.gUp >= G_STRONG || s.gDown >= G_STRONG)) continue
      let other: Slot | null = null
      for (const j of net.slots) {
        const o = this.slots[j]
        if (j !== id && !o.onYield && (o.gUp >= G_STRONG || o.gDown >= G_STRONG)) {
          other = o
          break
        }
      }
      if (!other) continue
      s.gUp = 0
      s.gDown = 0
      s.onYield(other.label)
    }
  }

  /** Live rail voltage for a resolution (never marks the rail as seen — see railUsed). */
  private rail(node: number): number {
    const v = this.railVoltage(node)
    return Number.isFinite(v) ? v : 0
  }
}
