/**
 * The simulation engine: nets + analog devices + behavioral chips.
 * Owned by the sim-core agent.
 *
 * Step order (per ARCHITECTURE.md):
 *   1. chips step    — read PREVIOUS solution, declare per-pin Norton drives
 *   2. device beginStep — companion-model updates (BE capacitor/inductor…)
 *   3. solve         — single pass for linear circuits, Newton-Raphson else
 *   4. device endStep — state + telemetry bookkeeping, runtime issue checks
 *
 * The engine never throws on weird layouts: malformed components are
 * excluded and reported as issues instead.
 *
 * Embedded-platform hooks (all additive — a layout without the new parts
 * produces bit-identical solutions, see tests/sim/legacy-equivalence):
 *  - board-rows (`layout.boardRows`) are honored (defect B1);
 *  - `chipOf`, `nodeOf`, `pinNodesOf`, `nodeVoltages`, `sample` give the
 *    Simulation Coordinator zero-alloc access to nodes and the solution;
 *  - `CatalogEntry.subcircuit` elements (board LEDs, pull-ups, regulator)
 *    are instantiated with the ordinary device models; '@name' pins get
 *    private solver nodes appended AFTER the net nodes;
 *  - chips may stamp CMOS output stages against their own rails
 *    (ChipStepCtx.setRailPins / drivePinStageAt) and report issues;
 *  - an armed diagnostic step records each node's total stamped conductance
 *    (used for floating-input detection) without changing any result.
 */

import '../model/catalog'
import './chips/all' // side-effect: registers every behavioral chip model
import './coordinator/mcu-board' // side-effect: registers the 'mcu-board' chip adapter
import './digital/device-chip' // side-effect: registers the 'digital-device' chip adapter
import './models' // side-effect: part-family model plug-ins (src/sim/models/*.model.ts)

import type {
  BoardConfig,
  CircuitLayout,
  ComponentInstance,
  ComponentTelemetry,
  EndpointRef,
  ParamValue,
  SimIssue,
  SimTelemetry,
} from '../model/types'
import { isBoardCount, isBoardRows, isBoardSizeId } from '../model/types'
import { componentPinHoles, formatHole } from '../model/breadboard'
import { CATALOG, getEntry } from '../model/catalog'
import type { CatalogEntry, SubcircuitElement } from '../model/catalog'
import { createChip } from './chip-api'
import type { ChipInstance, ChipStepCtx, PinDrive } from './chip-api'
import { buildNetlist } from './netlist'
import type { Netlist } from './netlist'
import { MnaSystem, NR_MAX_ITERS, solveNewton } from './mna'
import type { StampContext } from './mna'
import { createDevice, LedDevice, PowerSupplyDevice } from './devices'
import type { AnalogDevice } from './devices'

/** Default simulation time step (seconds). */
export const DEFAULT_DT = 5e-5

/** Node index of the ground (0 V reference) net. */
export const GROUND_NODE = -1
/** Node index meaning "this pin maps to no net" (ground is -1). */
export const NO_NODE = -2
const NO_NET = NO_NODE

const MSG_NO_POWER = 'no power supply'
const MSG_SINGULAR = 'circuit matrix is singular — check connections'
const MSG_NO_CONVERGE = 'solver failed to converge — results may be inaccurate'
const MSG_NUMERIC = 'numerical error in solver — voltages were reset'

type IssueSink = (level: 'error' | 'warning', message: string, componentId?: string) => void

// --------------------------------------------------------- chip plumbing

class ChipRuntime {
  readonly pinIndex = new Map<string, number>()
  readonly pinNodes: Int32Array
  readonly driveG: Float64Array // 0 = pin released (high-impedance)
  readonly driveV: Float64Array
  /** CMOS stage conductances (allocated on first drivePinStageAt) */
  stageUp: Float64Array | null = null
  stageDown: Float64Array | null = null
  railHiNode = NO_NET
  railLoNode = NO_NET
  readonly ctx: ChipCtx
  readonly supplyPinIdx: number
  readonly supplyPinName: string

  constructor(
    readonly comp: ComponentInstance,
    readonly entry: CatalogEntry,
    readonly chip: ChipInstance,
    nodes: number[],
    x: Float64Array,
    report: IssueSink,
  ) {
    const n = entry.pins.length
    this.pinNodes = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      this.pinNodes[i] = i < nodes.length ? nodes[i] : NO_NET
      this.pinIndex.set(entry.pins[i], i)
    }
    this.driveG = new Float64Array(n)
    this.driveV = new Float64Array(n)
    const supply = entry.pins.findIndex((p) => p === 'VCC' || p === 'VDD')
    this.supplyPinIdx = supply
    this.supplyPinName = supply >= 0 ? entry.pins[supply] : ''
    this.ctx = new ChipCtx(this, x, report)
  }
}

class ChipCtx implements ChipStepCtx {
  time = 0
  dt = DEFAULT_DT

  constructor(
    private readonly rt: ChipRuntime,
    private readonly x: Float64Array,
    private readonly report: IssueSink,
  ) {}

  readPin(pin: string): number {
    const i = this.rt.pinIndex.get(pin)
    if (i === undefined) return NaN
    const node = this.rt.pinNodes[i]
    if (node <= NO_NET) return NaN
    return node < 0 ? 0 : this.x[node]
  }

  drivePin(pin: string, drive: PinDrive | null): void {
    const i = this.rt.pinIndex.get(pin)
    if (i === undefined) return
    if (!drive) {
      this.rt.driveG[i] = 0
      return
    }
    const rout = drive.rout > 1e-3 ? drive.rout : 1e-3
    this.rt.driveG[i] = 1 / rout
    this.rt.driveV[i] = drive.v
  }

  readPinAt(index: number): number {
    const nodes = this.rt.pinNodes
    if (!(index >= 0 && index < nodes.length)) return NaN
    const node = nodes[index]
    if (node <= NO_NET) return NaN
    return node < 0 ? 0 : this.x[node]
  }

  drivePinAt(index: number, v: number, rout: number): void {
    const g = this.rt.driveG
    if (!(index >= 0 && index < g.length)) return
    if (!(rout > 0) || !Number.isFinite(rout) || !Number.isFinite(v)) {
      g[index] = 0
      return
    }
    g[index] = 1 / (rout > 1e-3 ? rout : 1e-3)
    this.rt.driveV[index] = v
  }

  reportIssue(level: 'error' | 'warning', message: string): void {
    this.report(level, message, this.rt.comp.id)
  }

  setRailPins(high: number, low: number): void {
    const nodes = this.rt.pinNodes
    this.rt.railHiNode = high >= 0 && high < nodes.length ? nodes[high] : NO_NET
    this.rt.railLoNode = low >= 0 && low < nodes.length ? nodes[low] : NO_NET
  }

  drivePinStageAt(index: number, gUp: number, gDown: number): void {
    const rt = this.rt
    const n = rt.pinNodes.length
    if (!(index >= 0 && index < n)) return
    if (rt.stageUp === null || rt.stageDown === null) {
      rt.stageUp = new Float64Array(n)
      rt.stageDown = new Float64Array(n)
    }
    rt.stageUp[index] = gUp > 0 && Number.isFinite(gUp) ? gUp : 0
    rt.stageDown[index] = gDown > 0 && Number.isFinite(gDown) ? gDown : 0
  }
}

// ----------------------------------------------- diagnostic stamp recorder

/**
 * StampContext proxy used on an armed diagnostic step: forwards every call
 * to the real system UNCHANGED (same calls, same order → bit-identical
 * solution) and accumulates each node's diagonal conductance. GMIN is added
 * by MnaSystem.beginStamp, not through stamps, so it is excluded.
 */
class DiagStampCtx implements StampContext {
  readonly diag: Float64Array

  constructor(private readonly sys: MnaSystem) {
    this.diag = new Float64Array(sys.nodeCount)
  }

  get nodeCount(): number {
    return this.sys.nodeCount
  }

  addElement(row: number, col: number, value: number): void {
    this.sys.addElement(row, col, value)
    if (row === col && row >= 0) this.diag[row] += value
  }

  addConductance(a: number, b: number, g: number): void {
    this.sys.addConductance(a, b, g)
    if (a >= 0) this.diag[a] += g
    if (b >= 0) this.diag[b] += g
  }

  addCurrent(node: number, current: number): void {
    this.sys.addCurrent(node, current)
  }

  addNorton(plus: number, minus: number, v: number, rout: number): void {
    this.sys.addNorton(plus, minus, v, rout)
    const g = 1 / (rout > 1e-6 ? rout : 1e-6) // same clamp as MnaSystem.addNorton
    if (plus >= 0) this.diag[plus] += g
    if (minus >= 0) this.diag[minus] += g
  }
}

// ------------------------------------------------------ per-component info

interface SubRuntime {
  el: SubcircuitElement
  device: AnalogDevice
  /** solver node per element pin */
  nodes: Int32Array
}

interface CompRuntime {
  comp: ComponentInstance
  entry: CatalogEntry | null
  /** node index per catalog pin (-1 ground, NO_NET unmapped); null = excluded */
  pinNodes: number[] | null
  device: AnalogDevice | null
  chip: ChipRuntime | null
  /** instantiated CatalogEntry.subcircuit elements */
  subs: SubRuntime[] | null
}

/** One instantiated sub-circuit element, as reported by `subcircuitOf`. */
export interface SubcircuitInfo {
  id: string
  model: string
  /** solver node per element pin (GROUND_NODE / internal nodes included) */
  nodes: Int32Array
}

/** Catalog entry whose device model is `model` (e.g. 'led' → CATALOG.led), if any. */
function modelEntryOf(model: string): CatalogEntry | undefined {
  for (const key in CATALOG) {
    const e = CATALOG[key]
    if (e.sim.kind === 'device' && e.sim.model === model) return e
  }
  return undefined
}

// ------------------------------------------------------------------ engine

export class SimEngine {
  /** Static + runtime issues, deduplicated by message. */
  readonly issues: SimIssue[] = []
  time = 0
  /**
   * Opt-in stricter Newton convergence (default OFF = legacy behavior,
   * bit-identical). solveNewton declares convergence when the iterate stops
   * moving, which can happen while a junction is still being step-limited
   * (pnLimit, 0.5 V/iteration): right after an abrupt edge an LED in series
   * with a resistor then solves as if it were off for one step (its anode
   * sits at the driving voltage). Harmless at the legacy fixed 50 µs step,
   * but visible with the coordinator's sub-µs post-edge steps — so the
   * coordinator enables this in MCU/device lockstep: Newton continues (up to
   * NR_MAX_ITERS more iterations) until no device reports `limited`.
   *
   * A part whose catalog entry sets `strictNewton` (e.g. relay_5v) turns it
   * on for the whole engine regardless of what a caller assigns: the
   * effective value is `assigned || requiresStrictConvergence`.
   */
  get strictConvergence(): boolean {
    return this.strictAssigned || this.requiresStrictConvergence
  }
  set strictConvergence(on: boolean) {
    this.strictAssigned = on
  }
  /** Some part of this layout needs strict Newton convergence (CatalogEntry.strictNewton). */
  readonly requiresStrictConvergence: boolean
  private strictAssigned = false

  private readonly netlist: Netlist
  private readonly board: BoardConfig
  private readonly netIndex = new Map<string, number>()
  private readonly sys: MnaSystem
  private readonly x: Float64Array
  private readonly runtimes: CompRuntime[] = []
  private readonly runtimeById = new Map<string, CompRuntime>()
  private readonly devices: AnalogDevice[] = []
  private readonly chips: ChipRuntime[] = []
  private readonly deviceById = new Map<string, AnalogDevice>()
  private readonly leds: LedDevice[] = []
  /** component id an LED's burn-out issue is attributed to (sub-circuit LEDs → parent part) */
  private readonly ledOwner: string[] = []
  private readonly supplies: PowerSupplyDevice[] = []
  /** devices implementing AnalogDevice.issues, with the part they belong to */
  private readonly issueDevices: AnalogDevice[] = []
  private readonly issueOwner: string[] = []
  private readonly ledReported: Uint8Array
  private readonly supplyWarned: Uint8Array
  private readonly isLinear: boolean
  private readonly issueKeys = new Set<string>()
  private readonly stampAllFn: (xv: Float64Array) => void
  private readonly reportFn: IssueSink
  /** number of solver nodes that are nets (internal sub-circuit nodes follow) */
  private readonly netNodeCount: number
  private netOfNodeCache: (string | null)[] | null = null
  private firstSolveDone = false
  private diagCtx: DiagStampCtx | null = null
  private diagArmed = false
  private diagValid = false

  constructor(layout: CircuitLayout) {
    // boardConfigOf(layout), hardened: never throw on weird layouts.
    this.board = {
      size: isBoardSizeId(layout?.board) ? layout.board : 'standard',
      count: isBoardCount(layout?.boardCount) ? layout.boardCount : 1,
      // B1: without `rows`, every pin on board-row >= 1 resolved to null and
      // grid-row parts were excluded as "malformed" (the netlist had the fix)
      rows: isBoardRows(layout?.boardRows) ? layout.boardRows : 1,
    }
    this.netlist = buildNetlist(layout)
    this.reportFn = (level, message, componentId) => this.addIssue(level, message, componentId)
    for (const w of this.netlist.warnings) this.addIssue('warning', w)

    // map every non-ground net to a solver node index
    let n = 0
    for (const net of this.netlist.nets) {
      if (net !== this.netlist.ground) this.netIndex.set(net, n++)
    }
    this.netNodeCount = n

    const components: ComponentInstance[] = Array.isArray(layout?.components)
      ? layout.components
      : []

    // internal ('@name') sub-circuit nodes come AFTER every net node, so a
    // layout without sub-circuits keeps exactly the legacy node numbering
    const internalNodes = new Map<string, number>()
    for (const comp of components) {
      if (!comp || typeof comp.id !== 'string' || typeof comp.type !== 'string') continue
      const sub = getEntry(comp.type)?.subcircuit
      if (!sub) continue
      for (const el of sub) {
        for (const p of el.pins) {
          if (typeof p !== 'string' || !p.startsWith('@')) continue
          const key = `${comp.id}\u0000${p}`
          if (!internalNodes.has(key)) internalNodes.set(key, n++)
        }
      }
    }

    this.sys = new MnaSystem(n)
    this.x = new Float64Array(n)
    this.stampAllFn = (xv: Float64Array) => this.stampAll(xv)

    let hasSupply = false
    let strict = false

    for (const comp of components) {
      const rt: CompRuntime = {
        comp,
        entry: null,
        pinNodes: null,
        device: null,
        chip: null,
        subs: null,
      }
      this.runtimes.push(rt)
      try {
        if (!comp || typeof comp.id !== 'string' || typeof comp.type !== 'string') {
          this.addIssue('error', 'component with missing id/type — excluded from simulation')
          continue
        }
        if (!this.runtimeById.has(comp.id)) this.runtimeById.set(comp.id, rt)
        const entry = getEntry(comp.type)
        if (!entry) {
          this.addIssue(
            'error',
            `component ${comp.id} has unknown type "${comp.type}" — excluded from simulation`,
            comp.id,
          )
          continue
        }
        rt.entry = entry
        // bench supply, or an independent source part (battery, current source)
        if (comp.type === 'power_supply' || entry.source !== undefined) hasSupply = true
        if (entry.strictNewton === true) strict = true

        const nodes = this.resolvePinNodes(comp, entry)
        if (!nodes) {
          this.addIssue(
            'error',
            `component ${comp.id} is malformed (bad holes or anchor) — excluded from simulation`,
            comp.id,
          )
          continue
        }
        rt.pinNodes = nodes

        const sim = entry.sim
        if (sim.kind === 'device') {
          const device = createDevice(sim.model, comp, entry, nodes)
          if (!device) {
            this.addIssue(
              'error',
              `component ${comp.id}: unknown device model "${sim.model}" — excluded from simulation`,
              comp.id,
            )
          } else {
            rt.device = device
            this.devices.push(device)
            this.deviceById.set(comp.id, device)
            if (device instanceof LedDevice) {
              this.leds.push(device)
              this.ledOwner.push(comp.id)
            }
            if (device instanceof PowerSupplyDevice) this.supplies.push(device)
            this.trackIssues(device, comp.id)
          }
        } else if (sim.kind === 'chip') {
          const chip = createChip(sim.model, comp)
          if (!chip) {
            this.addIssue(
              'warning',
              `component ${comp.id}: chip model "${sim.model}" is not registered — excluded from simulation`,
              comp.id,
            )
          } else {
            const crt = new ChipRuntime(comp, entry, chip, nodes, this.x, this.reportFn)
            rt.chip = crt
            this.chips.push(crt)
          }
        }
        // sim.kind === 'probe': no electrical stamp, pin voltages only

        // board-level analog parts work even when the main model is missing
        if (entry.subcircuit) this.instantiateSubcircuit(rt, entry.subcircuit, nodes, internalNodes)
      } catch (err) {
        this.addIssue(
          'error',
          `component ${comp?.id ?? '?'} failed to initialize: ${String(err)}`,
          comp?.id,
        )
      }
    }

    if (!hasSupply) this.addIssue('warning', MSG_NO_POWER)
    this.requiresStrictConvergence = strict

    this.ledReported = new Uint8Array(this.leds.length)
    this.supplyWarned = new Uint8Array(this.supplies.length)

    let linear = true
    for (const d of this.devices) {
      if (d.nonlinear) {
        linear = false
        break
      }
    }
    this.isLinear = linear
  }

  // ------------------------------------------------------------ stepping

  /** Advance the simulation by one step (default DEFAULT_DT seconds). */
  step(dt?: number): void {
    let h = dt ?? DEFAULT_DT
    if (!(h > 0) || !Number.isFinite(h)) h = DEFAULT_DT
    const t = this.time
    const x = this.x

    // 1. chips read the previous solution and declare their drives
    const chips = this.chips
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i]
      c.ctx.time = t
      c.ctx.dt = h
      try {
        c.chip.step(c.ctx)
      } catch (err) {
        this.addIssue('error', `chip ${c.comp.id} model error: ${String(err)}`, c.comp.id)
      }
    }

    // 2. analog companion-model updates
    const devices = this.devices
    for (let i = 0; i < devices.length; i++) devices[i].beginStep(t, h)

    // 3. solve
    const diagnose = this.diagArmed
    if (this.sys.nodeCount > 0) {
      if (this.isLinear) {
        this.sys.beginStamp()
        this.stampAll(x)
        if (this.sys.factorIfNeeded()) this.sys.solveInto(x)
        else this.addIssue('warning', MSG_SINGULAR)
      } else {
        let res = solveNewton(this.sys, this.stampAllFn, x)
        if (this.strictConvergence && res.converged) {
          let budget = NR_MAX_ITERS
          while (budget > 0 && this.anyLimited()) {
            res = solveNewton(this.sys, this.stampAllFn, x, budget)
            budget -= res.iterations
            if (!res.converged) break
          }
          if (res.converged && this.anyLimited()) res = { ...res, converged: false }
        }
        if (res.singular) this.addIssue('warning', MSG_SINGULAR)
        else if (!res.converged) this.addIssue('warning', MSG_NO_CONVERGE)
      }
      // never let NaN/Inf propagate into future steps
      for (let i = 0; i < x.length; i++) {
        if (!Number.isFinite(x[i])) {
          x.fill(0)
          this.addIssue('warning', MSG_NUMERIC)
          break
        }
      }
    }
    if (diagnose) {
      this.diagArmed = false
      this.diagValid = this.sys.nodeCount > 0
    }

    // 4. device bookkeeping
    for (let i = 0; i < devices.length; i++) devices[i].endStep(x)

    // runtime issues
    this.checkRuntimeIssues()
    if (!this.firstSolveDone) {
      this.firstSolveDone = true
      this.checkChipSupplies()
    }

    this.time = t + h
  }

  /** Advance by (approximately) `seconds` of simulation time in `dt` steps. */
  advance(seconds: number, dt?: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return
    let h = dt ?? DEFAULT_DT
    if (!(h > 0) || !Number.isFinite(h)) h = DEFAULT_DT
    const steps = Math.max(1, Math.round(seconds / h))
    for (let i = 0; i < steps; i++) this.step(h)
  }

  // ----------------------------------------------------------- telemetry

  telemetry(): SimTelemetry {
    const netVoltages: Record<string, number> = {}
    const ground = this.netlist.ground
    for (const net of this.netlist.nets) {
      if (net === ground) {
        netVoltages[net] = 0
      } else {
        const idx = this.netIndex.get(net)
        netVoltages[net] = idx === undefined ? NaN : this.x[idx]
      }
    }

    const components: Record<string, ComponentTelemetry> = {}
    for (const rt of this.runtimes) {
      if (!rt.comp || typeof rt.comp.id !== 'string') continue
      const tele: ComponentTelemetry = { pinVoltages: {} }
      if (rt.entry && rt.pinNodes) {
        const pins = rt.entry.pins
        for (let i = 0; i < pins.length; i++) {
          tele.pinVoltages[pins[i]] = this.nodeVoltage(rt.pinNodes[i])
        }
      }
      if (rt.device) {
        try {
          rt.device.fillTelemetry(tele)
        } catch {
          /* never throw from telemetry */
        }
      }
      if (rt.chip && rt.chip.chip.outputs) {
        try {
          const out = rt.chip.chip.outputs()
          if (out) tele.outputs = out
        } catch {
          /* never throw from telemetry */
        }
      }
      if (rt.subs && rt.subs.length > 0) {
        const sub: Record<string, ComponentTelemetry> = {}
        for (const s of rt.subs) {
          const st: ComponentTelemetry = { pinVoltages: {} }
          const pins = s.el.pins
          for (let i = 0; i < pins.length; i++) st.pinVoltages[pins[i]] = this.nodeVoltage(s.nodes[i])
          try {
            s.device.fillTelemetry(st)
          } catch {
            /* never throw from telemetry */
          }
          sub[s.el.id] = st
        }
        tele.sub = sub
      }
      if (rt.chip && rt.chip.chip.fillTelemetry) {
        try {
          rt.chip.chip.fillTelemetry(tele)
        } catch {
          /* never throw from telemetry */
        }
      }
      components[rt.comp.id] = tele
    }

    return {
      time: this.time,
      netVoltages,
      components,
      issues: this.issues.slice(),
    }
  }

  /**
   * Live tweaks while running: pot position, switch state, pressed, light,
   * voltage… Device components first; chip components (e.g. a board's BOOT0
   * jumper) fall back to the optional ChipInstance.setRuntimeParam.
   */
  setRuntimeParam(componentId: string, key: string, value: ParamValue): void {
    const device = this.deviceById.get(componentId)
    if (device) {
      try {
        device.setRuntimeParam(key, value)
      } catch {
        /* never throw on bad runtime params */
      }
      return
    }
    const chip = this.runtimeById.get(componentId)?.chip?.chip
    if (chip && chip.setRuntimeParam) {
      try {
        chip.setRuntimeParam(key, value)
      } catch {
        /* never throw on bad runtime params */
      }
    }
  }

  /** Voltage of the net a hole/terminal ref belongs to; NaN if unknown. */
  netVoltage(ref: EndpointRef): number {
    const net = this.netlist.netOf(ref)
    if (!net) return NaN
    if (net === this.netlist.ground) return 0
    const idx = this.netIndex.get(net)
    return idx === undefined ? NaN : this.x[idx]
  }

  // ------------------------------------------------- coordinator hooks

  /** Behavioral chip instance of a component (null if not a live chip part). */
  chipOf(componentId: string): ChipInstance | null {
    return this.runtimeById.get(componentId)?.chip?.chip ?? null
  }

  /** Solver node of a hole/terminal ref: >= 0, GROUND_NODE (-1), or NO_NODE (-2) if unknown. */
  nodeOf(ref: EndpointRef): number {
    return this.nodeOfNet(this.netlist.netOf(ref))
  }

  /** Solver node per catalog pin of a component (fresh copy), or null if excluded/unknown. */
  pinNodesOf(componentId: string): Int32Array | null {
    const nodes = this.runtimeById.get(componentId)?.pinNodes
    return nodes ? Int32Array.from(nodes) : null
  }

  /** Instantiated sub-circuit elements of a component (empty if none). */
  subcircuitOf(componentId: string): SubcircuitInfo[] {
    const subs = this.runtimeById.get(componentId)?.subs
    if (!subs) return []
    return subs.map((s) => ({ id: s.el.id, model: s.el.model, nodes: Int32Array.from(s.nodes) }))
  }

  /** Total solver nodes (nets + internal sub-circuit nodes; ground excluded). */
  get nodeCount(): number {
    return this.x.length
  }

  /**
   * Live solution vector (node voltages, V) — a READ-ONLY view: callers must
   * never write to it. Index = solver node; ground (-1) is implicitly 0 V.
   */
  get nodeVoltages(): Float64Array {
    return this.x
  }

  /** Voltage of one solver node (ground → 0, NO_NODE / out of range → NaN). */
  voltageOfNode(node: number): number {
    if (node === GROUND_NODE) return 0
    if (node >= 0 && node < this.x.length) return this.x[node]
    return NaN
  }

  /** Zero-alloc gather: out[i] = voltage of nodes[i] (ground 0, unknown NaN). */
  sample(nodes: Int32Array, out: Float64Array): void {
    const x = this.x
    const n = Math.min(nodes.length, out.length)
    for (let i = 0; i < n; i++) {
      const node = nodes[i]
      out[i] = node >= 0 && node < x.length ? x[node] : node === GROUND_NODE ? 0 : NaN
    }
  }

  /** Net id of a solver node (null for ground-less internal nodes / out of range). */
  netIdOfNode(node: number): string | null {
    if (node === GROUND_NODE) return this.netlist.ground
    if (!this.netOfNodeCache) {
      const cache: (string | null)[] = new Array(this.netNodeCount).fill(null)
      for (const [net, idx] of this.netIndex) cache[idx] = net
      this.netOfNodeCache = cache
    }
    return node >= 0 && node < this.netOfNodeCache.length ? this.netOfNodeCache[node] : null
  }

  /**
   * Record per-node stamped conductance during the NEXT step (diagnostics
   * only — the solution is bit-identical to an unarmed step).
   */
  armDiagnostics(): void {
    if (this.sys.nodeCount === 0) return
    this.diagArmed = true
  }

  /**
   * Total conductance (S) stamped onto `node` by every device and chip drive
   * in the last diagnosed step (final Newton linearization; GMIN excluded).
   * NaN when no diagnosed step has run or the node is not a solver node.
   */
  nodeConductance(node: number): number {
    if (!this.diagValid || !this.diagCtx || !(node >= 0 && node < this.x.length)) return NaN
    return this.diagCtx.diag[node]
  }

  // ------------------------------------------------------------ internals

  /** Some nonlinear device clipped its operating point in the last stamp. */
  private anyLimited(): boolean {
    const devices = this.devices
    for (let i = 0; i < devices.length; i++) {
      if (devices[i].limited === true) return true
    }
    return false
  }

  private nodeVoltage(node: number): number {
    if (node === -1) return 0
    if (node < 0) return NaN
    return this.x[node]
  }

  private resolvePinNodes(comp: ComponentInstance, entry: CatalogEntry): number[] | null {
    if (entry.placement === 'offboard') {
      const out: number[] = []
      for (const pin of entry.pins) {
        out.push(this.nodeOfNet(this.netlist.netOf(`${comp.id}:${pin}`)))
      }
      return out
    }
    const holes = componentPinHoles(comp, entry, this.board)
    if (!holes) return null
    const out: number[] = []
    for (const h of holes) {
      out.push(h ? this.nodeOfNet(this.netlist.netOf(formatHole(h))) : NO_NET)
    }
    return out
  }

  private nodeOfNet(net: string | null): number {
    if (!net) return NO_NET
    if (net === this.netlist.ground) return -1
    const idx = this.netIndex.get(net)
    return idx === undefined ? NO_NET : idx
  }

  /**
   * Instantiate CatalogEntry.subcircuit elements with the ordinary device
   * models. Pins name parent catalog pins or '@internal' nodes.
   */
  private instantiateSubcircuit(
    rt: CompRuntime,
    elements: SubcircuitElement[],
    pinNodes: number[],
    internalNodes: Map<string, number>,
  ): void {
    const comp = rt.comp
    const entry = rt.entry
    if (!entry) return
    const subs: SubRuntime[] = []
    for (const el of elements) {
      if (!el || typeof el.id !== 'string' || typeof el.model !== 'string' || !Array.isArray(el.pins)) {
        this.addIssue('error', `component ${comp.id}: malformed sub-circuit element — excluded`, comp.id)
        continue
      }
      const nodes = new Int32Array(el.pins.length)
      let ok = true
      for (let i = 0; i < el.pins.length; i++) {
        const p = el.pins[i]
        let node = NO_NET
        if (p.startsWith('@')) node = internalNodes.get(`${comp.id}\u0000${p}`) ?? NO_NET
        else {
          const idx = entry.pins.indexOf(p)
          if (idx >= 0 && idx < pinNodes.length) node = pinNodes[idx]
        }
        if (node <= NO_NET) {
          ok = false
          this.addIssue(
            'error',
            `component ${comp.id}: sub-circuit element ${el.id} pin "${p}" is not connected to a node — element excluded`,
            comp.id,
          )
          break
        }
        nodes[i] = node
      }
      if (!ok) continue
      const modelEntry = modelEntryOf(el.model)
      const subEntry: CatalogEntry =
        modelEntry && modelEntry.pins.length === el.pins.length
          ? modelEntry
          : {
              type: el.model,
              label: el.id,
              category: entry.category,
              placement: 'leads',
              pins: el.pins.slice(),
              sim: { kind: 'device', model: el.model },
              doc: '',
            }
      const subComp: ComponentInstance = el.params
        ? { id: `${comp.id}.${el.id}`, type: el.model, params: el.params }
        : { id: `${comp.id}.${el.id}`, type: el.model }
      const device = createDevice(el.model, subComp, subEntry, Array.from(nodes))
      if (!device) {
        this.addIssue(
          'error',
          `component ${comp.id}: sub-circuit element ${el.id} has unknown device model "${el.model}" — element excluded`,
          comp.id,
        )
        continue
      }
      subs.push({ el, device, nodes })
      this.devices.push(device)
      if (device instanceof LedDevice) {
        this.leds.push(device)
        this.ledOwner.push(comp.id)
      }
      if (device instanceof PowerSupplyDevice) this.supplies.push(device)
      this.trackIssues(device, comp.id) // attributed to the parent part
    }
    rt.subs = subs
  }

  /** Register a device that reports runtime issues (AnalogDevice.issues). */
  private trackIssues(device: AnalogDevice, owner: string): void {
    if (typeof device.issues !== 'function') return
    this.issueDevices.push(device)
    this.issueOwner.push(owner)
  }

  /** Stamp every device and every chip pin drive (called per NR iteration). */
  private stampAll(xv: Float64Array): void {
    let sys: StampContext = this.sys
    if (this.diagArmed) {
      if (!this.diagCtx) this.diagCtx = new DiagStampCtx(this.sys)
      this.diagCtx.diag.fill(0) // keep only the final Newton iteration
      sys = this.diagCtx
    }
    const devices = this.devices
    for (let i = 0; i < devices.length; i++) devices[i].stamp(sys, xv)
    const chips = this.chips
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i]
      const pinNodes = c.pinNodes
      const driveG = c.driveG
      const driveV = c.driveV
      for (let p = 0; p < pinNodes.length; p++) {
        const g = driveG[p]
        if (g > 0) {
          const node = pinNodes[p]
          if (node >= 0) {
            // Norton drive between the pin and ground
            sys.addElement(node, node, g)
            sys.addCurrent(node, driveV[p] * g)
          }
          // node === -1 (pin wired to ground): driving ground is a no-op
        }
      }
      const up = c.stageUp
      const down = c.stageDown
      if (up !== null && down !== null) {
        // CMOS stage: conductances to the chip's own rails (KCL-exact supply current)
        const hi = c.railHiNode
        const lo = c.railLoNode
        for (let p = 0; p < pinNodes.length; p++) {
          const node = pinNodes[p]
          if (node <= NO_NET) continue
          const gu = up[p]
          if (gu > 0 && hi > NO_NET) sys.addConductance(node, hi, gu)
          const gd = down[p]
          if (gd > 0 && lo > NO_NET) sys.addConductance(node, lo, gd)
        }
      }
    }
  }

  private checkRuntimeIssues(): void {
    const leds = this.leds
    for (let i = 0; i < leds.length; i++) {
      if (this.ledReported[i] === 0 && leds[i].burned) {
        this.ledReported[i] = 1
        const led = leds[i]
        this.addIssue(
          'error',
          `LED ${led.comp.id} burned out (current ${Math.round(led.burnCurrentMa)}mA — add a series resistor)`,
          this.ledOwner[i],
        )
      }
    }
    const supplies = this.supplies
    for (let i = 0; i < supplies.length; i++) {
      if (this.supplyWarned[i] === 0 && Math.abs(supplies[i].current) > 2) {
        this.supplyWarned[i] = 1
        this.addIssue(
          'warning',
          `supply ${supplies[i].comp.id} current > 2A (possible short circuit)`,
          supplies[i].comp.id,
        )
      }
    }
    // device-reported diagnostics (AnalogDevice.issues), attributed to their part
    const reporters = this.issueDevices
    for (let i = 0; i < reporters.length; i++) {
      const dev = reporters[i]
      let raised: readonly SimIssue[] | undefined
      try {
        raised = dev.issues?.()
      } catch (err) {
        this.addIssue('error', `component ${this.issueOwner[i]} model error: ${String(err)}`, this.issueOwner[i])
        continue
      }
      if (!raised) continue
      for (let k = 0; k < raised.length; k++) {
        const issue = raised[k]
        if (!issue || typeof issue.message !== 'string') continue
        this.addIssue(issue.level === 'error' ? 'error' : 'warning', issue.message, issue.componentId ?? this.issueOwner[i])
      }
    }
  }

  /** One-time check after the first solve: chip supply pins must be powered. */
  private checkChipSupplies(): void {
    for (const c of this.chips) {
      if (c.supplyPinIdx < 0) continue
      const node = c.pinNodes[c.supplyPinIdx]
      const v = node === -1 ? 0 : node >= 0 ? this.x[node] : NaN
      if (!(v >= 2)) {
        this.addIssue(
          'warning',
          `chip ${c.comp.id} ${c.supplyPinName} pin not connected to a powered net`,
          c.comp.id,
        )
      }
    }
  }

  private addIssue(level: 'error' | 'warning', message: string, componentId?: string): void {
    if (this.issueKeys.has(message)) return
    this.issueKeys.add(message)
    const issue: SimIssue = componentId ? { level, message, componentId } : { level, message }
    this.issues.push(issue)
  }
}
