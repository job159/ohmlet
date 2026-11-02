/**
 * SimulationCoordinator — ONE simulated world in deterministic virtual time
 * (algorithm: ./api.ts header and ARCHITECTURE_REVIEW §10.3).
 *
 * Owns the analog solver (SimEngine), every McuDevice (by component id,
 * surviving engine rebuilds — "hot rewire"), every DigitalDevice host, the
 * logic-net layer and the recorders.
 *
 * Lockstep (any MCU or digital device present):
 *   loop
 *     tStop = min(target, tA + MAX_ANALOG_DT, pending analog point, next event)
 *     every MCU runUntil(tStop). A drive change on a pin whose net is ANALOG
 *       (or a rail) records an analog point at the edge's exact time and,
 *       through requestSync(), stops the MCU at the next instruction
 *       boundary — the analog interval then ends exactly AT the edge. Edges
 *       closer than MIN_ANALOG_DT (0.5 µs) to the last analog solve are
 *       folded into a MIN_ANALOG_DT step with duty-weighted averaging of the
 *       drives (./stage). After an edge one MIN_ANALOG_DT "settle" step
 *       shows the post-edge state without waiting a full step.
 *       Drive changes on LOGIC nets resolve instantly in DigitalNets and never
 *       stop the MCU (they are still stamped into the analog solve).
 *     analog step to tStop when it is an analog point
 *       → adapters push inputs from the new solution, devices see power /
 *         analog inputs, recorders sample
 *     due device events run
 *   Analog points never depend on advance() chunking, so edge timestamps are
 *   identical however the host slices time.
 *
 * Pure analog worlds (no MCU, no digital device) take fixed DEFAULT_DT steps
 * under the legacy store-loop rule — bit-identical to driving SimEngine.
 *
 * No wall-clock input ever reaches the simulation; the injectable `clock`
 * only feeds the perf statistics.
 *
 * Test / lesson hooks (used by ./checks.ts): `setStimulus` puts an external
 * 50 Ω driver on a board header pin (./stimulus — analog stamp + logic
 * slot, never MCU registers), `scheduleAt` runs a callback at an exact
 * virtual time, `addUartListener` reports every transmitted UART byte with
 * the exact time its stop bit ended.
 *
 * Host → MCU serial bytes (`uartSend`, the UART terminal) never enter a
 * USART directly: the terminal's virtual USB-TTL adapter (./uart-adapter,
 * the TTL adapter block at the end of the class) drives the USART's RX pin
 * with real UART frames, and stays off a net something else drives.
 */
import { DEFAULT_DT, GROUND_NODE, NO_NODE, SimEngine } from '../engine'
import type {
  CircuitLayout,
  ComponentInstance,
  ParamValue,
  ScopeSample,
  SimIssue,
  SimTelemetry,
} from '../../model/types'
import { getEntry, paramOf } from '../../model/catalog'
import type { CatalogEntry } from '../../model/catalog'
import type { FirmwareImage } from '../../mcu/firmware'
import type { McuDevice, UartTap } from '../../mcu/mcu-api'
import type { StopReason } from '../../mcu/core/types'
import { createMcu } from '../../mcu/registry'
import { EventQueue } from '../../mcu/core/scheduler'
import { createDigitalDevice } from '../digital/api'
import type { DigitalDevice } from '../digital/api'
import { DigitalDeviceChip, DigitalDeviceHost } from '../digital/device-chip'
import type { DigitalServices } from '../digital/device-chip'
import { classifyNets, DigitalNets, G_STRONG, kindOf, NET_DRIVEN, NET_LOGIC, NET_RAIL } from '../digital/nets'
import type { NetClassification } from '../digital/nets'
import { McuBoardChip } from './mcu-board'
import type { McuBoardEnv, McuBoardState } from './mcu-board'
import { EdgeRing, RangeRing, SampleRing } from './recorders'
import { findScopeTriggers } from '../../instruments/trigger'
import { stimulusStage } from './stimulus'
import type { StimulusHost, StimulusLevel } from './stimulus'
import type {
  HostQuery,
  HostQueryResult,
  LogicCapture,
  LogicChannelConfig,
  LogicTrace,
  McuFrameInfo,
  ScopeCapture,
  ScopeTrace,
  ScopeTriggerQuery,
  SimFrame,
  SimLogEntry,
} from './api'
// module virtual serial ports (comm block at the end of the class)
import { frameFault, serialPortsOf } from './api'
import type { SerialPortInfo, VirtualSerialPort } from './api'
// the UART terminal's USB-TTL adapter (TTL adapter block at the end of the class)
import type { UartRxDriver, UartRxInfo, UartRxState } from './api'
import {
  PASS_ELEMENTS,
  staticRole,
  TTL_QUEUE_MAX,
  TTL_ROUT,
  TTL_VOH,
  ttlCharTime,
  ttlFrameBits,
  ttlLineOf,
  usartRxPin,
} from './uart-adapter'
import type { TtlLine } from './uart-adapter'

// side-effect: registers every real MCU model (src/mcu/all.ts barrel). A
// board whose model is not registered still runs electrically (see load()).
import '../../mcu/all'

/** Longest analog step (s) — the legacy fixed step. */
export const MAX_ANALOG_DT = DEFAULT_DT
/** Shortest analog step (s); denser edges are duty-averaged. */
export const MIN_ANALOG_DT = 0.5e-6
/** Legacy scope feed period (s) — store.ts SCOPE_SAMPLE_DT. */
export const SCOPE_SAMPLE_DT = 1e-3
/** Floating-input diagnostics period (s of sim time). */
const DIAG_PERIOD = 1e-3
/** Logic analyzer thresholds for analog nets (V) — catalog logic_probe support text; reported with each trace (IS-16). */
export const LA_VIL = 0.8
export const LA_VIH = 2.0
const LOG_CAP = 5000
const UART_CAP = 1 << 20
/** Loop iterations without progress before the coordinator gives up on an advance. */
const STALL_LIMIT = 100_000

export interface CoordinatorOptions {
  /** MCU factory (default: src/mcu/registry createMcu) — tests inject doubles */
  createMcu?: (model: string, componentId: string) => McuDevice | null
  /** digital device factory (default: digital/api createDigitalDevice) */
  createDigitalDevice?: (
    model: string,
    comp: ComponentInstance,
    entry: CatalogEntry,
  ) => DigitalDevice | null
  /** wall clock in ms for perf statistics only (default performance.now) */
  clock?: () => number
}

interface McuSlot {
  readonly componentId: string
  readonly model: string
  readonly mcu: McuDevice
  firmwareSha: string | null
  readonly state: McuBoardState
  /** stopped advancing (lockup / model error) — excluded until reset */
  stalled: boolean
  board: Board | null
}

interface Board {
  readonly componentId: string
  readonly entry: CatalogEntry
  readonly adapter: McuBoardChip
  readonly slot: McuSlot | null
  readonly pinNodes: Int32Array
  /** DigitalNets slot per catalog pin (−1: not on a logic net) */
  readonly logicSlot: Int32Array
  /** 1: an edge on this pin must end the analog step exactly */
  readonly coupled: Uint8Array
  /** 1: something besides this pin is attached to its net */
  readonly external: Uint8Array
  /** logic channels watching a catalog pin */
  readonly pinChannels: (Channel[] | undefined)[]
}

interface Channel {
  readonly index: number
  readonly label: string
  readonly ring: EdgeRing
  readonly kind: 'mcu' | 'logic' | 'analog' | 'none'
  readonly node: number
  readonly board: Board | null
  readonly pin: number
  /** MCU pins on this (analog) node: their strong drive defines the level exactly */
  readonly drivers: { board: Board; pin: number }[]
  /** Schmitt state for thresholded analog / logic voltages */
  hyst: 0 | 1 | 2
  lastV: number
  lastT: number
  /** voltage extremes of an analog-net channel (IS-16); null for other kinds */
  range: RangeRing | null
}

interface ProbeBinding {
  channel: number // 0..3
  node: number
  label: string
}

/** A test stimulus (./stimulus) on a board header pin, re-bound on every load(). */
interface StimulusSlot {
  readonly componentId: string
  readonly pin: string
  level: StimulusLevel
  /** current binding (null / −1 while the board or pin is absent) */
  board: Board | null
  index: number
  /** DigitalNets slot of the driver (−1: analog net or unbound) */
  netSlot: number
}

/** Every byte a UART shifts out, with the exact time its stop bit ended (s). */
export type UartByteListener = (componentId: string, port: string, byte: number, t: number) => void

interface Rates {
  realtimeFactor: number
  stepsPerSecond: number
  busyMs: number
}

function freshState(): McuBoardState {
  return { resetHeld: null, boot0Latched: false, nrstHigh: true }
}

function logicChannelIndex(v: unknown): number {
  if (typeof v !== 'string') return -1
  const m = /^D(\d{1,2})$/.exec(v)
  if (!m) return -1
  const n = Number(m[1])
  return n >= 0 && n <= 15 ? n : -1
}

export class SimulationCoordinator implements StimulusHost {
  private readonly makeMcu: (model: string, componentId: string) => McuDevice | null
  private readonly makeDevice: (
    model: string,
    comp: ComponentInstance,
    entry: CatalogEntry,
  ) => DigitalDevice | null
  private readonly clock: () => number

  // ---- world
  private layout: CircuitLayout | null = null
  private rev = 0
  private eng: SimEngine | null = null
  private tNow = 0
  /** the analog interval being stepped (read by every bound adapter) */
  private readonly win = { t0: 0, t1: 0, diagFresh: false }
  private boards: Board[] = []
  private mcuSlots = new Map<string, McuSlot>()
  private mcuOrder: McuSlot[] = []
  private readonly boardStates = new Map<string, McuBoardState>()
  private hosts = new Map<string, { type: string; host: DigitalDeviceHost }>()
  private hostOrder: DigitalDeviceHost[] = []
  private cls: NetClassification | null = null
  private nets: DigitalNets | null = null
  private readonly events = new EventQueue()
  private readonly firmware = new Map<string, FirmwareImage>()

  // ---- lockstep state
  private pendingPoint = Infinity
  private readonly pendingEdges: number[] = []
  private running: McuSlot | null = null
  private runTarget = Infinity
  private curTime = 0
  private nextDiagT = 0
  private haltedBy: string | null = null

  // ---- recorders
  private probes: ProbeBinding[] = []
  private readonly scopeRings: (SampleRing | undefined)[] = []
  private readonly scopeLabels: string[] = ['', '', '', '']
  private scopeFeed: ScopeSample[] = []
  private nextScopeT = 0
  private explicitChannels: LogicChannelConfig[] | null = null
  private channels: Channel[] = []
  private channelUnsubs: (() => void)[] = []
  private readonly logicRings: (EdgeRing | undefined)[] = []
  /** per logic channel: the voltage extremes of an analog-net source (IS-16), cleared with its edge ring */
  private readonly logicRanges: (RangeRing | undefined)[] = []
  /** per logic channel / scope channel: the bound source (ring cleared when it changes) and its bind time */
  private readonly logicSources: (string | undefined)[] = []
  private readonly logicSince: number[] = []
  private readonly scopeSources: (string | undefined)[] = []
  private uartPending: { componentId: string; port: string; bytes: number[] }[] = []
  private uartBytes = 0
  private uartListeners: UartByteListener[] = []

  // ---- test stimuli (external drivers on header pins, ./stimulus)
  private readonly stimuli = new Map<string, StimulusSlot>()
  /** inside advance(): `curTime` is the present (events, MCU callbacks) */
  private advancing = false

  // ---- issues / log
  private readonly coordIssues = new Map<string, SimIssue>()
  /**
   * engine issues already written to the log — by identity, not by index:
   * the engine retracts a standing issue that is no longer true (a supply's
   * over-current that ended, SimEngine.checkRuntimeIssues), which shrinks
   * engine.issues; an index would then skip the NEXT new issue's log line
   */
  private engineIssuesLogged = new WeakSet<SimIssue>()
  private logBuf: SimLogEntry[] = []
  private logDropped = 0

  // ---- perf
  private analogSteps = 0
  private perfWinStart = NaN
  private perfSteps = 0
  private perfSim = 0
  private perfBusy = 0
  private rates: Rates = { realtimeFactor: 0, stepsPerSecond: 0, busyMs: 0 }

  private readonly services: DigitalServices

  /** 顯示電流: every engine this coordinator builds tracks element currents (setCurrentTracking) */
  private currentTracking = false

  constructor(opts: CoordinatorOptions = {}) {
    this.makeMcu = opts.createMcu ?? ((model) => createMcu(model))
    this.makeDevice = opts.createDigitalDevice ?? ((model, comp, entry) => createDigitalDevice(model, comp, entry))
    this.clock =
      opts.clock ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.services = {
      now: () => this.curTime,
      schedule: (at, fn) => this.schedule(at, fn),
      cancel: (h) => this.events.cancel(h),
      issue: (id, level, message) => this.addIssue(`dev:${id}:${message}`, level, message, id),
      log: (id, level, message) => this.pushLog(level, id, message, id),
      analogEdge: (t) => this.analogEdge(t),
    }
  }

  // ================================================================ API

  /**
   * 顯示電流 (contract C2): track every element's terminal currents from the
   * solver's stamps — telemetry then carries ComponentTelemetry.pinCurrents
   * and SimTelemetry.wireCurrents / stripCurrents (means over the interval
   * since the previous telemetry). Never changes a solution (bit-identical);
   * survives rebuilds. Off by default (zero cost).
   */
  setCurrentTracking(on: boolean): void {
    this.currentTracking = on
    if (this.eng) this.eng.trackCurrents = on
  }

  /** Whether element currents are tracked (setCurrentTracking). */
  get currentTrackingOn(): boolean {
    return this.currentTracking
  }

  /** Current virtual time (s): every MCU, device and recorder has reached it. */
  get time(): number {
    return this.tNow
  }

  /**
   * The present: inside advance() (coordinator events, MCU pin / UART
   * callbacks) the exact virtual time of the running callback, otherwise
   * `time`.
   */
  get now(): number {
    return this.advancing ? this.curTime : this.tNow
  }

  /** Time of the latest analog solution (≤ time). */
  get analogTime(): number {
    return this.eng ? this.eng.time : 0
  }

  /** The live analog engine (tests / diagnostics; null before load). */
  get engine(): SimEngine | null {
    return this.eng
  }

  /** Total analog steps taken since construction. */
  get stepCount(): number {
    return this.analogSteps
  }

  /** Component id of the MCU whose debugger halted the world (null = running). */
  get halted(): string | null {
    return this.haltedBy
  }

  /** The McuDevice of a board (null when absent / no model). */
  mcu(componentId: string): McuDevice | null {
    return this.mcuSlots.get(componentId)?.mcu ?? null
  }

  /** The hosted DigitalDevice of a part (tests / inspector). */
  digitalDevice(componentId: string): DigitalDevice | null {
    return this.hosts.get(componentId)?.host.device ?? null
  }

  /** Logic-layer view (tests / inspector). */
  get logicNets(): DigitalNets | null {
    return this.nets
  }

  /**
   * (Re)build the world for `layout`. MCUs whose component id, model and
   * firmware survive keep running (hot rewire); new ones start unpowered and
   * power up from the circuit. The analog state restarts from the new
   * netlist (as on every legacy rebuild); the clock is preserved.
   */
  load(layout: CircuitLayout, rev: number = this.rev): void {
    this.layout = layout
    this.rev = rev
    const prevTime = this.eng ? this.eng.time : 0
    let engine: SimEngine
    try {
      engine = new SimEngine(layout)
    } catch (err) {
      this.eng = null
      this.addIssue('load', 'error', `simulation failed to start: ${String(err)}`)
      return
    }
    this.coordIssues.delete('load')
    engine.time = prevTime
    engine.trackCurrents = this.currentTracking
    this.eng = engine
    this.engineIssuesLogged = new WeakSet()
    this.curTime = this.tNow
    const comps: ComponentInstance[] = Array.isArray(layout?.components) ? layout.components : []

    // ---- logic layer
    const cls = classifyNets(engine, comps)
    const nets = new DigitalNets(
      cls,
      (node) => engine.voltageOfNode(node),
      (key, level, message) => this.addIssue(`net:${key}`, level, message),
    )
    this.cls = cls
    this.nets = nets
    for (const key of [...this.coordIssues.keys()]) if (key.startsWith('net:')) this.coordIssues.delete(key)

    // ---- MCU boards
    const keep = new Map<string, McuSlot>()
    const boards: Board[] = []
    for (const comp of comps) {
      if (!comp || typeof comp.id !== 'string') continue
      const entry = getEntry(comp.type)
      if (!entry?.mcu || entry.sim.kind !== 'chip') continue
      const chip = engine.chipOf(comp.id)
      if (!(chip instanceof McuBoardChip) || boards.some((b) => b.componentId === comp.id)) continue
      let slot = this.mcuSlots.get(comp.id) ?? null
      const fwSha = this.firmware.get(comp.id)?.sha256 ?? null
      if (slot && (slot.model !== entry.mcu.model || slot.firmwareSha !== fwSha)) {
        this.retireSlot(slot)
        slot = null
      }
      if (!slot) slot = this.createSlot(comp.id, entry.mcu.model)
      if (slot) keep.set(comp.id, slot)
      boards.push(this.bindBoard(comp.id, entry, chip, slot, engine, cls, nets))
    }
    for (const [id, s] of this.mcuSlots) if (!keep.has(id)) this.retireSlot(s)
    this.mcuSlots = keep
    this.mcuOrder = boards.map((b) => b.slot).filter((s): s is McuSlot => s !== null)
    this.boards = boards
    for (const id of [...this.boardStates.keys()]) {
      if (!boards.some((b) => b.componentId === id)) this.boardStates.delete(id)
    }

    // ---- digital devices
    const keepHosts = new Map<string, { type: string; host: DigitalDeviceHost }>()
    for (const comp of comps) {
      if (!comp || typeof comp.id !== 'string' || keepHosts.has(comp.id)) continue
      const entry = getEntry(comp.type)
      if (!entry?.digital || entry.sim.kind !== 'chip') continue
      const chip = engine.chipOf(comp.id)
      if (!(chip instanceof DigitalDeviceChip)) continue
      let hs = this.hosts.get(comp.id)
      if (hs && hs.type !== comp.type) {
        hs.host.dispose()
        hs = undefined
      }
      if (!hs) {
        let device: DigitalDevice | null = null
        try {
          device = this.makeDevice(entry.digital.model, comp, entry)
        } catch (err) {
          this.addIssue(`dev:${comp.id}:create`, 'error', `${comp.id}: device model failed to start: ${String(err)}`, comp.id)
        }
        if (!device) {
          this.addIssue(
            `dev:${comp.id}:missing`,
            'warning',
            `${comp.id}: digital model "${entry.digital.model}" is not available — part simulated as open pins`,
            comp.id,
          )
          chip.bind(null, this.win)
          continue
        }
        hs = { type: comp.type, host: new DigitalDeviceHost(comp.id, entry, device, this.services) }
      }
      hs.host.attach(chip, nets, engine.pinNodesOf(comp.id), this.win)
      keepHosts.set(comp.id, hs)
    }
    for (const [id, hs] of this.hosts) if (!keepHosts.has(id)) hs.host.dispose()
    this.hosts = keepHosts
    this.hostOrder = [...keepHosts.values()].map((h) => h.host)
    this.bindSerialPorts() // module virtual serial ports (comm block at the end of the class)
    // lockstep worlds take sub-µs post-edge steps: Newton must not stop while
    // a junction is still step-limited (pure analog worlds keep legacy bits)
    engine.strictConvergence = this.mcuOrder.length > 0 || this.hostOrder.length > 0

    // ---- test stimuli stay wired across rebuilds
    for (const s of this.stimuli.values()) this.bindStimulus(s, nets)
    // ---- the terminal's USB-TTL adapters stay plugged in unless the net is no longer free
    this.netIndex = null
    this.bindTtl()

    // every logic net once; afterwards DigitalNets.refreshRails re-resolves
    // them all whenever a rail feeding one (board VDD/VSS, pull and device
    // rails) moves (afterStep)
    nets.resolveAll()

    // ---- recorders
    this.bindProbes(comps, engine)
    this.bindChannels()

    // ---- lockstep bookkeeping
    this.pendingEdges.length = 0
    // a rebuild mid-run starts from an all-zero solution: solve again after
    // MIN_ANALOG_DT so rails, logic nets and inputs are valid at once
    // (until then MCU inputs keep their levels, see McuBoardChip.pushLogicInput)
    this.pendingPoint =
      engine.time > 0 && (this.mcuOrder.length > 0 || this.hostOrder.length > 0) ? engine.time + MIN_ANALOG_DT : Infinity
    if (this.nextScopeT < engine.time) this.nextScopeT = engine.time
    this.nextDiagT = engine.time
    const present = new Set(comps.map((c) => c?.id))
    for (const [key, issue] of [...this.coordIssues]) {
      if (issue.componentId && !present.has(issue.componentId)) this.coordIssues.delete(key)
    }
  }

  /** Attach / replace / remove the firmware of an MCU board (that MCU restarts). */
  setFirmware(componentId: string, image: FirmwareImage | null): void {
    if (image) this.firmware.set(componentId, image)
    else this.firmware.delete(componentId)
    const slot = this.mcuSlots.get(componentId)
    if (slot) {
      if (image) {
        this.programSlot(slot, image)
        slot.mcu.reset('power-on')
        slot.stalled = false
      } else {
        // no "erase" in the McuDevice contract: start a blank device
        this.retireSlot(slot)
        this.mcuSlots.delete(componentId)
      }
    }
    if (this.haltedBy === componentId) this.haltedBy = null
    // rebuild so board issues ("no firmware") reflect the new state
    if (this.layout) this.load(this.layout, this.rev)
  }

  /** Advance the world by `seconds` of virtual time. */
  advance(seconds: number): void {
    const engine = this.eng
    if (!engine || !(seconds > 0) || !Number.isFinite(seconds) || this.haltedBy) return
    const w0 = this.clock()
    const t0 = this.tNow
    const target = t0 + seconds
    this.advancing = true
    try {
      if (this.mcuOrder.length === 0 && this.hostOrder.length === 0) {
        // legacy rule (store.ts frame loop): whole DEFAULT_DT steps
        while (engine.time < target - DEFAULT_DT * 0.5) {
          const ta = engine.time
          this.win.t0 = ta
          this.win.t1 = ta + DEFAULT_DT
          this.win.diagFresh = false
          engine.step(DEFAULT_DT)
          this.afterStep(ta, engine.time)
        }
        this.tNow = target
      } else {
        this.tNow = this.lockstep(target)
      }
    } finally {
      this.advancing = false
    }
    this.perfSim += this.tNow - t0
    this.perfBusy += this.clock() - w0
  }

  /** Full power cycle: time → 0, fresh MCUs and devices, recorders cleared. */
  reset(): void {
    for (const s of this.mcuSlots.values()) this.retireSlot(s)
    this.mcuSlots.clear()
    this.mcuOrder = []
    for (const hs of this.hosts.values()) hs.host.dispose()
    this.hosts.clear()
    this.hostOrder = []
    this.boardStates.clear()
    this.events.clear()
    this.eng = null
    this.tNow = 0
    this.curTime = 0
    this.haltedBy = null
    this.pendingEdges.length = 0
    this.pendingPoint = Infinity
    this.nextScopeT = 0
    this.scopeFeed = []
    for (const r of this.scopeRings) r?.clear()
    for (const r of this.logicRings) r?.clear()
    for (const r of this.logicRanges) r?.clear()
    // the next load() re-binds every recorder channel at t = 0
    this.logicSources.length = 0
    this.logicSince.length = 0
    this.scopeSources.length = 0
    this.uartPending = []
    this.uartBytes = 0
    // a power cycle unplugs the terminal's adapters (their events went with the queue)
    this.ttl.clear()
    this.coordIssues.clear()
    this.pushLog('info', 'sim', 'power cycle — simulation reset to t = 0')
    if (this.layout) this.load(this.layout, this.rev)
  }

  /** Engine telemetry with coordinator issues merged in. */
  telemetry(): SimTelemetry {
    const engine = this.eng
    if (!engine) return { time: this.tNow, netVoltages: {}, components: {}, issues: this.issues() }
    const tele = engine.telemetry()
    tele.issues = this.issues()
    return tele
  }

  /** Every current issue (engine + coordinator), deduplicated by message. */
  issues(): SimIssue[] {
    const out: SimIssue[] = this.eng ? this.eng.issues.slice() : []
    const seen = new Set(out.map((i) => i.message))
    for (const i of this.coordIssues.values()) {
      if (!seen.has(i.message)) {
        seen.add(i.message)
        out.push(i)
      }
    }
    return out
  }

  /** Snapshot + deltas since the previous frame (scope feed, UART, log). */
  frame(running = false): SimFrame {
    this.drainMcuLogs()
    this.syncEngineIssues()
    this.updateRates()
    const mcus: McuFrameInfo[] = []
    for (const s of this.mcuOrder) {
      const ds = s.mcu.debugState()
      const fault = frameFault(ds.faults)
      mcus.push({
        componentId: s.componentId,
        state: ds.state,
        firmware: s.mcu.firmware ? s.mcu.firmware.name : null,
        pc: ds.registers.r[15] ?? 0,
        hclkHz: ds.hclkHz,
        cycles: ds.cycles,
        instructions: ds.instructions,
        realtime: this.rates.realtimeFactor,
        uarts: s.mcu.uarts.map((u) => ({ name: u.name, config: u.config() })),
        // inspector / instrument facts (the model reports them when it can)
        ...(ds.clocked ? { clocked: ds.clocked } : {}),
        ...(ds.afioMapr !== undefined ? { mapr: ds.afioMapr } : {}),
        // exception / fault facts (SIM-F2): a handler loop is visible without a halt
        ...(typeof ds.ipsr === 'number' ? { exception: ds.ipsr } : {}),
        ...(fault ? { fault } : {}),
        // the terminal's USB-TTL adapter: each USART's RX wire (close-out UART-RX)
        ...this.ttlFrameInfo(s, ds.afioMapr),
      })
    }
    const log = this.logBuf
    this.logBuf = []
    if (this.logDropped > 0) {
      log.unshift({
        time: this.tNow,
        level: 'warning',
        source: 'sim',
        message: `${this.logDropped} log entries dropped (log rate too high)`,
      })
      this.logDropped = 0
    }
    const scope = this.scopeFeed
    this.scopeFeed = []
    const uart = this.uartPending
    this.uartPending = []
    this.uartBytes = 0
    const telemetry = this.telemetry()
    return {
      rev: this.rev,
      time: this.tNow,
      running,
      telemetry,
      scope,
      uart,
      mcus,
      log,
      issues: telemetry.issues,
      perf: { ...this.rates },
      ...this.serialPortFrame(),
    }
  }

  setRuntimeParam(componentId: string, key: string, value: ParamValue): void {
    this.eng?.setRuntimeParam(componentId, key, value)
  }

  /**
   * Host → device serial bytes (the UART terminal). A module port gets them
   * through its own `hostSend`; an MCU USART through the terminal's virtual
   * USB-TTL adapter on the USART's RX pin — real UART frames on the wire
   * (./uart-adapter.ts, TTL adapter block below), never written into the
   * peripheral. `line` (tests, firmware contracts) overrides the adapter's
   * line settings for these bytes — e.g. a terminal left at 9600 Bd while
   * the firmware listens at 115200; by default the adapter uses the
   * firmware's current settings.
   */
  uartSend(componentId: string, port: string, bytes: Uint8Array, line?: Partial<TtlLine>): void {
    if (!this.mcuSlots.has(componentId) && this.serialPortSend(componentId, port, bytes)) return
    const slot = this.mcuSlots.get(componentId)
    const tap = slot?.mcu.uarts.find((u) => u.name === port)
    if (!slot || !tap) {
      this.pushLog('warning', 'sim', `${componentId}: no UART "${port}" to send to`, componentId)
      return
    }
    this.ttlSend(slot, tap, bytes, line)
  }

  /**
   * Test / lesson hook: every byte any UART transmits, with the exact
   * virtual time its stop bit ended (UartTap.onTx cycle → seconds).
   * Returns an unsubscribe function.
   */
  addUartListener(fn: UartByteListener): () => void {
    this.uartListeners.push(fn)
    return () => {
      this.uartListeners = this.uartListeners.filter((f) => f !== fn)
    }
  }

  /**
   * Run `fn` at exact virtual time `t` on the coordinator event queue (a
   * time already past runs at the next event point). Inside `fn`, `now` is
   * `t` and every MCU has reached it. Used by test stimulus plans.
   */
  scheduleAt(t: number, fn: () => void): number {
    return this.schedule(Number.isFinite(t) ? Math.max(t, this.now) : this.now, fn)
  }

  cancelScheduled(handle: number): void {
    this.events.cancel(handle)
  }

  /**
   * Test stimulus (./stimulus.ts): drive the net of a board header pin
   * through 50 Ω to the board's VSS (0) or VDD (1), or release it ('open'),
   * from `now` on. The driver acts electrically — analog stamp + logic-layer
   * slot — and stays applied across rebuilds until changed. Returns false
   * when `componentId` has no such MCU header pin.
   */
  setStimulus(componentId: string, pin: string, level: StimulusLevel): boolean {
    const key = `${componentId}\u0000${pin}`
    let s = this.stimuli.get(key)
    if (!s) {
      s = { componentId, pin, level: 'open', board: null, index: -1, netSlot: -1 }
      this.stimuli.set(key, s)
      if (this.nets) this.bindStimulus(s, this.nets)
    }
    s.level = level
    const b = s.board
    const i = s.index
    if (!b || i < 0) return false
    if (!this.advancing) this.curTime = this.tNow
    const t = this.curTime
    const [up, down] = stimulusStage(level)
    b.adapter.setFixture(i, t, up, down)
    if (s.netSlot >= 0 && this.nets) this.nets.setDrive(s.netSlot, up, down)
    else if (b.coupled[i]) this.analogEdge(t)
    return true
  }

  /** Current stimulus level of a board pin ('open' when none was applied). */
  stimulusOf(componentId: string, pin: string): StimulusLevel {
    return this.stimuli.get(`${componentId}\u0000${pin}`)?.level ?? 'open'
  }

  /** Configure logic-analyzer channels (replaces the logic_probe default). */
  setLogicChannels(channels: LogicChannelConfig[]): void {
    this.explicitChannels = channels.slice()
    this.bindChannels()
  }

  query(q: HostQuery): HostQueryResult {
    switch (q.kind) {
      case 'logic':
        return { kind: 'logic', capture: this.logicCapture(q.t0, q.t1) }
      case 'scope':
        return { kind: 'scope', capture: this.scopeCapture(q.t0, q.t1, q.maxPoints) }
      case 'scope-trigger':
        return { kind: 'scope-trigger', t: this.scopeTrigger(q), tNow: this.tNow }
      case 'mcu-debug': {
        const m = this.mcu(q.componentId)
        return { kind: 'mcu-debug', state: m ? m.debugState() : null }
      }
      case 'mcu-memory': {
        const m = this.mcu(q.componentId)
        const len = Math.max(0, Math.min(q.length | 0, 1 << 16))
        return { kind: 'mcu-memory', bytes: m ? m.readMemory(q.addr >>> 0, len) : null }
      }
      case 'mcu-support': {
        const m = this.mcu(q.componentId)
        return { kind: 'mcu-support', support: m ? m.support.slice() : [] }
      }
    }
  }

  // ---- debugger controls
  mcuReset(componentId: string): void {
    const s = this.mcuSlots.get(componentId)
    if (!s) return
    s.mcu.reset('pin')
    s.stalled = false
    this.pushLog('info', 'sim', `${componentId}: reset`, componentId)
  }
  mcuHalt(componentId: string): void {
    const s = this.mcuSlots.get(componentId)
    if (!s) return
    s.mcu.halt()
    this.haltedBy = componentId
  }
  mcuResume(componentId: string): void {
    const s = this.mcuSlots.get(componentId)
    if (!s) return
    s.mcu.resume()
    if (this.haltedBy === componentId) this.haltedBy = null
  }
  mcuStep(componentId: string): void {
    this.mcuSlots.get(componentId)?.mcu.stepInstruction()
  }

  dispose(): void {
    for (const s of this.mcuSlots.values()) this.retireSlot(s)
    this.mcuSlots.clear()
    this.mcuOrder = []
    for (const hs of this.hosts.values()) hs.host.dispose()
    this.hosts.clear()
    this.hostOrder = []
    this.events.clear()
    this.eng = null
    this.layout = null
    this.stimuli.clear()
    this.ttl.clear()
    this.uartListeners = []
  }

  // ========================================================= lockstep

  /** Run the lockstep loop up to `target`; returns the time actually reached. */
  private lockstep(target: number): number {
    const engine = this.eng as SimEngine
    let idle = 0
    for (;;) {
      const tA = engine.time
      const tStop = Math.min(target, tA + MAX_ANALOG_DT, this.pendingPoint, this.events.nextAt())
      let restart = false
      for (const s of this.mcuOrder) {
        if (s.stalled || s.mcu.time() >= tStop) continue
        let reason: StopReason = 'target'
        this.running = s
        this.runTarget = tStop
        try {
          reason = s.mcu.runUntil(tStop)
        } catch (err) {
          s.stalled = true
          this.addIssue(`mcu:${s.componentId}:error`, 'error', `${s.componentId}: MCU model error: ${String(err)}`, s.componentId)
        } finally {
          this.running = null
          this.runTarget = Infinity
        }
        const reached = s.mcu.time() >= tStop
        if (!reached) {
          if (reason === 'halted' || reason === 'breakpoint') {
            this.haltedBy = s.componentId
            this.pushLog(
              'info',
              `${s.componentId}/debug`,
              `${reason === 'breakpoint' ? 'breakpoint hit' : 'halted'} at PC 0x${(s.mcu.debugState().registers.r[15] >>> 0).toString(16).padStart(8, '0')}`,
              s.componentId,
            )
            return Math.max(tA, Math.min(target, s.mcu.time()))
          }
          if (reason !== 'sync' && !s.stalled) {
            s.stalled = true
            this.pushLog(
              'error',
              `${s.componentId}/core`,
              `MCU stopped advancing (${reason}) — pins frozen until reset`,
              s.componentId,
            )
          } else if (reason === 'sync') restart = true
        }
        if (Math.min(this.pendingPoint, this.events.nextAt()) < tStop) restart = true
        if (restart) break
      }
      if (restart) {
        if (++idle > STALL_LIMIT) {
          this.addIssue('stall', 'error', 'simulation made no progress (MCU keeps stopping) — advance aborted')
          return Math.max(tA, this.tNow)
        }
        continue
      }
      idle = 0
      if (tStop >= tA + MAX_ANALOG_DT || tStop >= this.pendingPoint) this.analogStep(tA, tStop)
      if (this.events.nextAt() <= tStop) this.runEvents(tStop)
      if (tStop >= target) return target
    }
  }

  private analogStep(t0: number, t1: number): void {
    const engine = this.eng as SimEngine
    this.win.t0 = t0
    this.win.t1 = t1
    // floating-input diagnostics once per DIAG_PERIOD of sim time (bit-identical solve)
    this.win.diagFresh = false
    if (this.boards.length > 0 && t1 >= this.nextDiagT) {
      engine.armDiagnostics()
      this.win.diagFresh = true
      this.nextDiagT = (Math.floor(t1 / DIAG_PERIOD) + 1) * DIAG_PERIOD
    }
    engine.step(t1 - t0)
    engine.time = t1 // the coordinator owns the exact timeline
    // edges consumed by this step → one settle step after them
    let had = false
    let next = Infinity
    let w = 0
    for (let k = 0; k < this.pendingEdges.length; k++) {
      const te = this.pendingEdges[k]
      if (te <= t1) {
        if (te > t0) had = true
      } else {
        this.pendingEdges[w++] = te
        if (te < next) next = te
      }
    }
    this.pendingEdges.length = w
    this.pendingPoint = had ? t1 + MIN_ANALOG_DT : Infinity
    if (next < Infinity) this.pendingPoint = Math.min(this.pendingPoint, Math.max(next, t1 + MIN_ANALOG_DT))
    this.afterStep(t0, t1)
  }

  /** Everything that consumes a fresh analog solution. */
  private afterStep(t0: number, t1: number): void {
    this.curTime = t1
    this.analogSteps++
    this.perfSteps++
    // Logic nets first: a rail that moved in this solve (power-up, supply
    // change, a load switching on the regulator) re-resolves EVERY logic net
    // before anyone reads them (DigitalNets.refreshRails compares against the
    // rail voltages of the last FULL resolution, RAIL_REFRESH_V = 10 µV, so
    // logic-net voltages stay ADC-accurate and single-net resolutions in
    // between cannot mask a move).
    this.nets?.refreshRails()
    for (let i = 0; i < this.boards.length; i++) this.boards[i].adapter.observe(t1)
    for (let i = 0; i < this.hostOrder.length; i++) this.hostOrder[i].postSolve()
    this.recordStep(t0, t1)
    this.syncEngineIssues()
  }

  private runEvents(tStop: number): void {
    this.events.runDue(tStop)
  }

  /** Request an analog step boundary at the exact time of an analog-coupled drive edge. */
  private analogEdge(t: number): void {
    const engine = this.eng
    if (!engine) return
    this.pendingEdges.push(t)
    const p = Math.max(t, engine.time + MIN_ANALOG_DT)
    if (p < this.pendingPoint) this.pendingPoint = p
    if (this.running && this.runTarget > this.pendingPoint) this.running.mcu.requestSync()
    // a drive changed on an analog net: a terminal adapter there lets go of a net another output now drives
    if (this.ttl.size > 0) this.ttlCheckAnalog()
  }

  private schedule(at: number, fn: () => void): number {
    const h = this.events.schedule(at, (t) => {
      this.curTime = t
      fn()
    })
    if (this.running && this.runTarget > at) this.running.mcu.requestSync()
    return h
  }

  /** McuPinListener of every slot. */
  private onMcuPin(slot: McuSlot, pin: number, cycle: number): void {
    const b = slot.board
    if (!b) return
    const t = slot.mcu.timeOfCycle(cycle)
    this.curTime = t
    const i = b.adapter.onDrive(pin, t)
    if (i < 0) return
    const ls = b.logicSlot[i]
    if (ls >= 0 && this.nets) this.nets.setDrive(ls, b.adapter.stageUp(i), b.adapter.stageDown(i))
    else if (b.coupled[i]) this.analogEdge(t)
    const chs = b.pinChannels[i]
    if (chs) for (const ch of chs) this.evalChannel(ch, t, false)
  }

  // ========================================================== binding

  private createSlot(componentId: string, model: string): McuSlot | null {
    let mcu: McuDevice | null = null
    try {
      mcu = this.makeMcu(model, componentId)
    } catch (err) {
      this.addIssue(`mcu:${componentId}:create`, 'error', `${componentId}: MCU model "${model}" failed to start: ${String(err)}`, componentId)
    }
    if (!mcu) return null
    const slot: McuSlot = {
      componentId,
      model,
      mcu,
      firmwareSha: null,
      state: freshState(),
      stalled: false,
      board: null,
    }
    mcu.setPowered(false)
    const fw = this.firmware.get(componentId)
    if (fw) this.programSlot(slot, fw)
    // a new MCU joins a running world: bring its clock to the present (unpowered)
    if (this.tNow > 0) mcu.runUntil(this.tNow)
    mcu.pins.listener = { pinDriveChanged: (pin, cycle) => this.onMcuPin(slot, pin, cycle) }
    for (const tap of mcu.uarts) {
      tap.onTx = (byte, cycle) => this.uartOut(componentId, tap.name, byte, slot.mcu.timeOfCycle(cycle))
    }
    this.mcuSlots.set(componentId, slot)
    return slot
  }

  private programSlot(slot: McuSlot, fw: FirmwareImage): void {
    const id = slot.componentId
    let res: { ok: boolean; errors: string[]; warnings: string[] }
    try {
      res = slot.mcu.loadFirmware(fw)
    } catch (err) {
      res = { ok: false, errors: [String(err)], warnings: [] }
    }
    slot.firmwareSha = fw.sha256
    for (const w of res.warnings) this.pushLog('warning', `${id}/loader`, w, id)
    for (const e of res.errors) this.pushLog('error', `${id}/loader`, e, id)
    if (res.ok) this.pushLog('info', `${id}/loader`, `firmware ${fw.name} programmed (sha256 ${fw.sha256.slice(0, 12)}…)`, id)
    else this.addIssue(`mcu:${id}:firmware`, 'error', `${id}: firmware ${fw.name} could not be programmed`, id)
  }

  private retireSlot(slot: McuSlot): void {
    this.drainSlotLog(slot)
    slot.mcu.pins.listener = null
    for (const tap of slot.mcu.uarts) tap.onTx = null
    slot.board = null
  }

  private bindBoard(
    componentId: string,
    entry: CatalogEntry,
    adapter: McuBoardChip,
    slot: McuSlot | null,
    engine: SimEngine,
    cls: NetClassification,
    nets: DigitalNets,
  ): Board {
    const pinNodes = engine.pinNodesOf(componentId) ?? new Int32Array(entry.pins.length).fill(NO_NODE)
    const n = entry.pins.length
    const board: Board = {
      componentId,
      entry,
      adapter,
      slot,
      pinNodes,
      logicSlot: new Int32Array(n).fill(-1),
      coupled: new Uint8Array(n),
      external: new Uint8Array(n),
      pinChannels: [],
    }
    let state = slot ? slot.state : this.boardStates.get(componentId)
    if (!state) state = freshState()
    this.boardStates.set(componentId, state)
    const win = this.win
    const env: McuBoardEnv = {
      get t0() {
        return win.t0
      },
      get t1() {
        return win.t1
      },
      get diagFresh() {
        return win.diagFresh
      },
      logicManaged: (i) => board.logicSlot[i] >= 0,
      logicVoltage: (i) => {
        const node = pinNodes[i]
        return nets.state(node) === NET_DRIVEN ? nets.voltage(node) : NaN
      },
      syncLogicDrives: () => {
        for (let j = 0; j < adapter.mapped.length; j++) {
          const i = adapter.mapped[j]
          const ls = board.logicSlot[i]
          if (ls >= 0) nets.setDrive(ls, adapter.stageUp(i), adapter.stageDown(i))
        }
      },
      hasExternal: (i) => board.external[i] === 1,
      conductance: (i) => engine.nodeConductance(pinNodes[i]),
      realtime: () => this.rates.realtimeFactor,
      log: (level, message) => this.pushLog(level, 'sim', message, componentId),
    }
    adapter.bind(slot ? slot.mcu : null, env, state, this.tNow)
    if (slot) slot.board = board
    const vddNode = adapter.vddIdx >= 0 ? pinNodes[adapter.vddIdx] : NO_NODE
    const gndNode = adapter.gndIdx >= 0 ? pinNodes[adapter.gndIdx] : NO_NODE
    for (let j = 0; j < adapter.mapped.length; j++) {
      const i = adapter.mapped[j]
      const node = pinNodes[i]
      if (node <= NO_NODE) continue
      if (cls.attachments[node + 1] > 1) board.external[i] = 1
      if (kindOf(cls, node) === NET_LOGIC) {
        const ls = nets.addSlot(node, vddNode, gndNode, `${componentId}.${entry.pins[i]}`)
        board.logicSlot[i] = ls
        if (ls >= 0) {
          nets.initDrive(ls, adapter.stageUp(i), adapter.stageDown(i))
          nets.listen(node, () => this.onLogicPin(board, i, node))
        }
      } else {
        board.coupled[i] = 1
      }
    }
    return board
  }

  /** (Re)bind a test stimulus to the current build: fixture stamp + logic slot. */
  private bindStimulus(s: StimulusSlot, nets: DigitalNets): void {
    s.board = null
    s.index = -1
    s.netSlot = -1
    const b = this.boards.find((x) => x.componentId === s.componentId)
    if (!b) return
    const i = b.entry.pins.indexOf(s.pin)
    if (i < 0 || !b.adapter.portName[i] || b.pinNodes[i] < 0) return
    s.board = b
    s.index = i
    const [up, down] = stimulusStage(s.level)
    b.adapter.setFixture(i, this.curTime, up, down, true)
    if (b.logicSlot[i] >= 0) {
      const vdd = b.adapter.vddIdx >= 0 ? b.pinNodes[b.adapter.vddIdx] : NO_NODE
      const gnd = b.adapter.gndIdx >= 0 ? b.pinNodes[b.adapter.gndIdx] : NO_NODE
      const slot = nets.addSlot(b.pinNodes[i], vdd, gnd, `stimulus ${s.componentId}.${s.pin}`)
      if (slot >= 0) {
        nets.initDrive(slot, up, down)
        s.netSlot = slot
      }
    }
  }

  private onLogicPin(board: Board, i: number, node: number): void {
    const nets = this.nets
    if (!nets) return
    const v = nets.state(node) === NET_DRIVEN ? nets.voltage(node) : NaN
    board.adapter.pushLogicInput(i, v)
    const chs = board.pinChannels[i]
    if (chs) for (const ch of chs) this.evalChannel(ch, this.curTime, false)
  }

  // ======================================================== recorders

  private bindProbes(comps: ComponentInstance[], engine: SimEngine): void {
    const probes: ProbeBinding[] = []
    /** per scope channel: the probes (id + hole) feeding it now */
    const sources: string[][] = [[], [], [], []]
    for (const comp of comps) {
      if (!comp || comp.type !== 'scope_probe') continue
      const entry = getEntry(comp.type)
      if (!entry) continue
      const ref = comp.holes?.[0]
      if (!ref) continue
      const raw = Number(paramOf(comp.params, entry, 'channel') ?? 1)
      if (!Number.isFinite(raw)) continue
      const channel = Math.min(4, Math.max(1, Math.round(raw))) - 1
      probes.push({ channel, node: engine.nodeOf(ref), label: comp.id })
      sources[channel].push(`${comp.id}@${ref}`)
      this.scopeLabels[channel] = comp.id
      if (!this.scopeRings[channel]) this.scopeRings[channel] = new SampleRing()
    }
    this.probes = probes
    for (let ch = 0; ch < 4; ch++) {
      if (sources[ch].length === 0) {
        // probe removed (or moved to another channel): its samples must not
        // be captured as if the channel were still attached
        this.scopeRings[ch] = undefined
        this.scopeLabels[ch] = ''
        this.scopeSources[ch] = undefined
        continue
      }
      const key = sources[ch].join('|')
      // another probe / another hole: the history belongs to the old source
      if (this.scopeSources[ch] !== undefined && this.scopeSources[ch] !== key) this.scopeRings[ch]?.clear()
      this.scopeSources[ch] = key
    }
  }

  private defaultChannels(): LogicChannelConfig[] {
    const out: LogicChannelConfig[] = []
    const used = new Set<number>()
    for (const comp of this.layout?.components ?? []) {
      if (!comp || comp.type !== 'logic_probe') continue
      const entry = getEntry(comp.type)
      if (!entry) continue
      const index = logicChannelIndex(paramOf(comp.params, entry, 'channel'))
      if (index < 0 || used.has(index)) continue
      used.add(index)
      out.push({ index, label: comp.id, source: { kind: 'probe', componentId: comp.id } })
    }
    return out
  }

  private bindChannels(): void {
    const engine = this.eng
    for (const b of this.boards) b.pinChannels.length = 0
    for (const u of this.channelUnsubs) u()
    this.channelUnsubs = []
    this.channels = []
    if (!engine) return
    const configs = this.explicitChannels ?? this.defaultChannels()
    const nets = this.nets
    const bound = new Set<number>()
    for (const cfg of configs) {
      if (!(cfg.index >= 0 && cfg.index <= 15)) continue
      let ring = this.logicRings[cfg.index]
      if (!ring) {
        ring = new EdgeRing()
        this.logicRings[cfg.index] = ring
      }
      // a new source (another pin / net, a moved probe) starts a fresh
      // history at the bind time; a rebuild with the same source keeps it
      const key = this.logicSourceKey(cfg)
      if (this.logicSources[cfg.index] !== key) {
        ring.clear()
        this.logicRanges[cfg.index]?.clear()
        this.logicSources[cfg.index] = key
        this.logicSince[cfg.index] = this.curTime
      }
      bound.add(cfg.index)
      let kind: Channel['kind'] = 'none'
      let node = NO_NODE
      let board: Board | null = null
      let pin = -1
      const src = cfg.source
      if (src.kind === 'mcu-pin') {
        board = this.boards.find((b) => b.componentId === src.componentId) ?? null
        pin = board ? board.entry.pins.indexOf(src.pin) : -1
        if (board && pin >= 0 && board.adapter.portName[pin]) {
          kind = 'mcu'
          node = board.pinNodes[pin]
        } else board = null
      } else {
        if (src.kind === 'probe') {
          const comp = this.layout?.components.find((c) => c && c.id === src.componentId)
          const ref = comp?.holes?.[0]
          node = ref ? engine.nodeOf(ref) : NO_NODE
        } else {
          node = engine.nodeOf(src.ref)
        }
        if (node > NO_NODE) kind = nets && nets.isLogic(node) ? 'logic' : 'analog'
      }
      const drivers: { board: Board; pin: number }[] = []
      if (kind === 'analog') {
        for (const b of this.boards) {
          for (let j = 0; j < b.adapter.mapped.length; j++) {
            const i = b.adapter.mapped[j]
            if (b.pinNodes[i] === node) drivers.push({ board: b, pin: i })
          }
        }
      }
      let range: RangeRing | null = null
      if (kind === 'analog') {
        range = this.logicRanges[cfg.index] ?? null
        if (!range) {
          range = new RangeRing()
          this.logicRanges[cfg.index] = range
        }
      }
      const ch: Channel = {
        index: cfg.index,
        label: cfg.label,
        ring,
        kind,
        node,
        board,
        pin,
        drivers,
        hyst: 2,
        lastV: NaN,
        lastT: engine.time,
        range,
      }
      this.channels.push(ch)
      if (kind === 'mcu' && board) (board.pinChannels[pin] ??= []).push(ch)
      if (kind === 'logic' && nets) {
        this.channelUnsubs.push(nets.listen(node, () => this.evalChannel(ch, this.curTime, false)))
      }
      for (const d of drivers) (d.board.pinChannels[d.pin] ??= []).push(ch)
      this.evalChannel(ch, this.curTime, true)
    }
    // channels no longer configured forget their source (re-adding starts fresh)
    for (let i = 0; i < this.logicSources.length; i++) if (!bound.has(i)) this.logicSources[i] = undefined
  }

  /** Identity of a logic channel's signal source (a probe part includes its hole). */
  private logicSourceKey(cfg: LogicChannelConfig): string {
    const src = cfg.source
    switch (src.kind) {
      case 'mcu-pin':
        return `mcu|${src.componentId}|${src.pin}`
      case 'net':
        return `net|${src.ref}`
      case 'probe': {
        const comp = this.layout?.components.find((c) => c && c.id === src.componentId)
        return `probe|${src.componentId}|${comp?.holes?.[0] ?? ''}`
      }
    }
  }

  /**
   * Re-evaluate a logic channel at virtual time `t`. `analogStep` = called
   * with a fresh analog solution (thresholded crossings are interpolated
   * between the previous and the current sample).
   */
  private evalChannel(ch: Channel, t: number, analogStep: boolean): void {
    let level: 0 | 1 | 2 = 2
    let at = t
    switch (ch.kind) {
      case 'mcu':
        if (ch.board) level = ch.board.adapter.pinLevel(ch.pin)
        break
      case 'logic': {
        const nets = this.nets
        if (nets && nets.state(ch.node) === NET_DRIVEN) level = this.schmitt(ch, nets.voltage(ch.node))
        else ch.hyst = 2
        if (level === 2) ch.hyst = 2
        break
      }
      case 'analog': {
        // an MCU actively driving the net defines the level at its exact edge time
        let strong: 0 | 1 | 2 | -1 = -1
        for (const d of ch.drivers) {
          if (!d.board.adapter.drivesStrongly(d.pin)) continue
          const l = d.board.adapter.pinLevel(d.pin)
          strong = strong === -1 ? l : strong === l ? strong : 2
        }
        const v = this.eng ? this.eng.voltageOfNode(ch.node) : NaN
        if (strong !== -1) {
          level = strong
          ch.hyst = strong
        } else if (analogStep) {
          const prev = ch.hyst
          level = this.schmitt(ch, v)
          if (level !== prev && prev !== 2 && Number.isFinite(ch.lastV) && t > ch.lastT) {
            const thr = level === 1 ? LA_VIH : LA_VIL
            const f = (ch.lastV - thr) / (ch.lastV - v)
            if (f >= 0 && f <= 1) at = ch.lastT + f * (t - ch.lastT)
          }
        } else {
          level = ch.ring.last
        }
        if (analogStep) {
          ch.lastV = v
          ch.lastT = t
          ch.range?.push(t, v)
        }
        break
      }
      default:
        level = 2
    }
    ch.ring.push(at, level)
  }

  private schmitt(ch: Channel, v: number): 0 | 1 | 2 {
    if (!Number.isFinite(v)) {
      ch.hyst = 2
      return 2
    }
    if (v >= LA_VIH) ch.hyst = 1
    else if (v <= LA_VIL) ch.hyst = 0
    return ch.hyst
  }

  private recordStep(_t0: number, t1: number): void {
    const engine = this.eng as SimEngine
    // high-resolution scope: every analog step
    for (const p of this.probes) this.scopeRings[p.channel]?.push(t1, engine.voltageOfNode(p.node))
    // legacy 1 kHz feed — same rule as store.ts takeScopeSample
    if (this.probes.length > 0 && engine.time >= this.nextScopeT - DEFAULT_DT * 0.5) {
      const v: [number, number, number, number] = [NaN, NaN, NaN, NaN]
      for (const p of this.probes) v[p.channel] = engine.voltageOfNode(p.node)
      this.scopeFeed.push({ t: engine.time, v })
      if (this.scopeFeed.length > 100_000) this.scopeFeed.splice(0, this.scopeFeed.length - 100_000)
      this.nextScopeT = engine.time + SCOPE_SAMPLE_DT
    }
    // logic channels: analog thresholds + MCU input levels after this solve
    for (const ch of this.channels) {
      if (ch.kind === 'analog' || ch.kind === 'mcu') this.evalChannel(ch, t1, true)
    }
  }

  private logicCapture(t0: number, t1: number): LogicCapture {
    const traces: LogicTrace[] = []
    let overflow = false
    for (const ch of this.channels) {
      const c = ch.ring.capture(t0, t1)
      overflow ||= c.overflow
      // MCU pins and logic nets are exact; an analog net is exact while an
      // MCU pin drives it (edges are the drive edges), thresholded otherwise
      const exact = ch.kind === 'mcu' || ch.kind === 'logic' || (ch.kind === 'analog' && ch.drivers.length > 0)
      const trace: LogicTrace = {
        index: ch.index,
        label: ch.label,
        initial: c.initial,
        times: c.times,
        levels: c.levels,
        exact,
        since: this.logicSince[ch.index] ?? 0,
      }
      // a thresholded net: how far it swung (IS-16 — "0–1.75 V never reaches 2.0 V")
      if (!exact && ch.range) {
        const r = ch.range.range(Math.max(t0, trace.since ?? 0), Math.min(t1, this.tNow))
        if (r) {
          trace.vmin = r.min
          trace.vmax = r.max
        }
        trace.vil = LA_VIL
        trace.vih = LA_VIH
      }
      traces.push(trace)
    }
    return { t0, t1, traces, overflow, tNow: this.tNow }
  }

  private scopeCapture(t0: number, t1: number, maxPoints?: number): ScopeCapture {
    const traces: ScopeTrace[] = []
    for (let i = 0; i < 4; i++) {
      const ring = this.scopeRings[i]
      if (!ring) continue
      const c = ring.capture(t0, t1, maxPoints)
      traces.push({ index: i, label: this.scopeLabels[i] || `CH${i + 1}`, t: c.t, v: c.v, decimated: c.decimated })
    }
    return { t0, t1, traces }
  }

  /** HostQuery 'scope-trigger': level crossing on the full-resolution recording (null: none / no probe). */
  private scopeTrigger(q: ScopeTriggerQuery): number | null {
    const ring = q.channel >= 0 && q.channel < 4 ? this.scopeRings[q.channel] : undefined
    if (!ring || !Number.isFinite(q.level) || !(q.t1 >= q.t0)) return null
    const c = ring.capture(q.t0, q.t1) // never decimated
    const hits = findScopeTriggers(c.t, c.v, {
      level: q.level,
      slope: q.slope,
      hysteresis: q.hysteresis,
      holdoff: q.holdoff,
      from: q.t0,
      to: q.t1,
    })
    if (hits.length === 0) return null
    return q.pick === 'first' ? hits[0] : hits[hits.length - 1]
  }

  private uartOut(componentId: string, port: string, byte: number, t: number): void {
    for (const fn of this.uartListeners) fn(componentId, port, byte & 0x1ff, t)
    if (this.uartBytes >= UART_CAP) return
    let e = this.uartPending.find((u) => u.componentId === componentId && u.port === port)
    if (!e) {
      e = { componentId, port, bytes: [] }
      this.uartPending.push(e)
    }
    e.bytes.push(byte & 0xff)
    this.uartBytes++
  }

  // ===================================================== issues + log

  private addIssue(key: string, level: 'error' | 'warning', message: string, componentId?: string): void {
    if (this.coordIssues.has(key)) return
    const issue: SimIssue = componentId ? { level, message, componentId } : { level, message }
    this.coordIssues.set(key, issue)
    this.pushLog(level, 'sim', message, componentId)
  }

  private pushLog(
    level: 'info' | 'warning' | 'error',
    source: string,
    message: string,
    componentId?: string,
  ): void {
    const e: SimLogEntry = { time: this.curTime, level, source, message }
    if (componentId) e.componentId = componentId
    this.logBuf.push(e)
    if (this.logBuf.length > LOG_CAP) {
      this.logBuf.shift()
      this.logDropped++
    }
  }

  private syncEngineIssues(): void {
    const engine = this.eng
    if (!engine) return
    const issues = engine.issues
    for (let k = 0; k < issues.length; k++) {
      const i = issues[k]
      if (this.engineIssuesLogged.has(i)) continue
      this.engineIssuesLogged.add(i)
      this.pushLog(i.level, 'sim', i.message, i.componentId)
    }
  }

  private drainSlotLog(slot: McuSlot): void {
    let events: ReturnType<McuDevice['drainLog']> = []
    try {
      events = slot.mcu.drainLog()
    } catch {
      return
    }
    for (const ev of events) {
      const e: SimLogEntry = {
        time: ev.time,
        level: ev.level,
        source: `${slot.componentId}/${ev.source}`,
        message: ev.message,
        componentId: slot.componentId,
      }
      this.logBuf.push(e)
    }
    if (this.logBuf.length > LOG_CAP) {
      this.logDropped += this.logBuf.length - LOG_CAP
      this.logBuf.splice(0, this.logBuf.length - LOG_CAP)
    }
  }

  private drainMcuLogs(): void {
    for (const s of this.mcuOrder) this.drainSlotLog(s)
  }

  private updateRates(): void {
    const now = this.clock()
    if (Number.isNaN(this.perfWinStart)) {
      this.perfWinStart = now
      return
    }
    const dt = now - this.perfWinStart
    if (dt < 1000) return
    const s = dt / 1000
    this.rates = {
      realtimeFactor: this.perfSim / s,
      stepsPerSecond: this.perfSteps / s,
      busyMs: this.perfBusy / s,
    }
    this.perfWinStart = now
    this.perfSim = 0
    this.perfSteps = 0
    this.perfBusy = 0
  }

  // ===================================================================
  // Virtual serial ports of modules (comm-modules block — additive; the
  // contract is the VirtualSerialPort block in ./api.ts). A module port
  // behaves like an MCU UART for hosts and listeners: module → host bytes
  // go through uartOut (frame.uart + UART listeners) under the module's
  // component id, host → module bytes through uartSend.
  // ===================================================================

  /** ports bound by the last load(), with their owner */
  private serialBound: { componentId: string; port: VirtualSerialPort }[] = []

  /** (Re)bind the ports of every hosted device; unbind ports of removed devices. */
  private bindSerialPorts(): void {
    const next: { componentId: string; port: VirtualSerialPort }[] = []
    for (const [componentId, hs] of this.hosts) {
      for (const port of serialPortsOf(hs.host.device)) {
        const name = port.name
        port.onHostRx = (byte, t) => this.uartOut(componentId, name, byte, t)
        next.push({ componentId, port })
      }
    }
    for (const b of this.serialBound) if (!next.some((n) => n.port === b.port)) b.port.onHostRx = null
    this.serialBound = next
  }

  /** Host → module port; false when `componentId` has no port `port`. */
  private serialPortSend(componentId: string, port: string, bytes: Uint8Array): boolean {
    const b = this.serialBound.find((x) => x.componentId === componentId && x.port.name === port)
    if (!b) return false
    // outside advance() the device schedules from the present (as setStimulus does)
    if (!this.advancing) this.curTime = this.tNow
    try {
      b.port.hostSend(bytes)
    } catch (err) {
      this.addIssue(`dev:${componentId}:port`, 'error', `${componentId}: device model error: ${String(err)}`, componentId)
    }
    return true
  }

  /** Frame field listing the module ports (omitted when there are none). */
  private serialPortFrame(): { serialPorts?: SerialPortInfo[] } {
    if (this.serialBound.length === 0) return {}
    return {
      serialPorts: this.serialBound.map((b) => ({ componentId: b.componentId, name: b.port.name, config: b.port.config() })),
    }
  }

  // ===================================================================
  // The UART terminal's virtual USB-TTL adapter (./uart-adapter.ts; the
  // frame contract is UartRxInfo in ./api.ts). One adapter per MCU USART
  // the terminal has sent to. Plugged into the USART's RX pin at the first
  // send, it idles high and shifts the queued bytes out as UART frames —
  // one coordinator event per level change, so every edge has its exact
  // virtual time — driving the pin's net as a DigitalNets slot (logic net)
  // and a Norton source (McuBoardChip.setSource; on an analog net its edges
  // end analog steps). It never fights the circuit: before it plugs in and
  // before every frame it checks that nothing else drives the net (ttlWire),
  // and it lets go when something starts to (a rebuild, an output switching
  // on — watched on logic nets, checked every frame on analog nets).
  // ===================================================================

  private readonly ttl = new Map<string, TtlAdapter>()
  /** per load(): solver node → the part pins and pass elements on it (built on first use) */
  private netIndex: NetIndex | null = null

  private ttlKey(componentId: string, port: string): string {
    return `${componentId}\u0000${port}`
  }

  /** Queue `bytes` on the adapter of `tap` (plugging it in first), or say why not. */
  private ttlSend(slot: McuSlot, tap: UartTap, bytes: Uint8Array, over?: Partial<TtlLine>): void {
    const id = slot.componentId
    const port = tap.name
    const n = bytes.length
    if (n === 0) return
    // outside advance() the adapter starts from the present (as setStimulus does)
    if (!this.advancing) this.curTime = this.tNow
    const refuse = (why: string): void =>
      this.pushLog('warning', 'sim', `${id} ${port}: the terminal did not send ${n} byte(s) — ${why}`, id)
    let mapr: number | undefined
    try {
      mapr = slot.mcu.debugState().afioMapr
    } catch {
      mapr = undefined
    }
    const pin = usartRxPin(port, mapr)
    const b = slot.board
    const i = pin && b ? b.adapter.portName.indexOf(pin) : -1
    if (!pin || !b || i < 0) {
      refuse(`its RX pin ${pin ?? port} is not on the board's headers`)
      return
    }
    const line = ttlLineOf({ ...tap.config(), ...over })
    if (!line) {
      refuse(`the firmware has not set the ${port} baud rate (BRR) yet`)
      return
    }
    const key = this.ttlKey(id, port)
    let ad = this.ttl.get(key)
    // a remap moved the RX pin: the adapter's jumper moves with it
    if (ad && ad.attached && ad.pin !== pin) this.ttlUnplug(ad)
    const wire = this.ttlWire(b, i, ad && ad.attached ? ad : null)
    if (wire.state !== 'free') {
      refuse(this.ttlWhy(id, port, pin, wire))
      return
    }
    if (!ad) {
      ad = {
        componentId: id,
        port,
        pin,
        attached: false,
        level: 1,
        queue: [],
        inFlight: false,
        nextStart: 0,
        handles: new Set(),
        board: null,
        index: -1,
        netSlot: -1,
        unlisten: null,
      }
      this.ttl.set(key, ad)
    }
    const take = Math.min(n, Math.max(0, TTL_QUEUE_MAX - ad.queue.length))
    for (let k = 0; k < take; k++) ad.queue.push({ byte: bytes[k], line })
    if (take < n) this.pushLog('warning', 'sim', `${id} ${port}: the terminal's adapter buffer is full — ${n - take} byte(s) dropped`, id)
    if (!ad.attached) {
      // plugged in now: TXD rises to idle, the first start bit follows one character later
      ad.pin = pin
      ad.attached = true
      ad.level = 1
      ad.nextStart = this.curTime + ttlCharTime(line)
      this.ttlBind(ad, b, i, false)
      this.ttlApply(ad)
    }
    this.ttlPump(ad)
  }

  /** Stage conductances of the adapter's TXD right now: [to TTL_VOH, to GND]. */
  private ttlStage(ad: TtlAdapter): [number, number] {
    if (!ad.attached) return [0, 0]
    const g = 1 / TTL_ROUT
    return ad.level === 1 ? [g, 0] : [0, g]
  }

  /** Bind the adapter to catalog pin `i` of board `b` (a logic slot on a logic net); `initial` = a rebuild re-binding it as it was. */
  private ttlBind(ad: TtlAdapter, b: Board, i: number, initial: boolean): void {
    ad.unlisten?.()
    ad.unlisten = null
    ad.board = b
    ad.index = i
    ad.netSlot = -1
    const nets = this.nets
    const node = b.pinNodes[i]
    const [up, down] = initial ? this.ttlStage(ad) : [0, 0]
    if (nets && b.logicSlot[i] >= 0) {
      const gnd = b.adapter.gndIdx >= 0 ? b.pinNodes[b.adapter.gndIdx] : NO_NODE
      const slot = nets.addSlot(node, gnd, gnd, `USB-TTL ${ad.componentId}.${ad.pin}`, TTL_VOH)
      if (slot >= 0) {
        nets.initDrive(slot, up, down)
        ad.netSlot = slot
        // another output switching on lets the adapter go before the net resolves (no contention)
        nets.setYield(slot, () => this.ttlWatch(ad))
        ad.unlisten = nets.listen(node, () => this.ttlWatch(ad))
      }
    }
    b.adapter.sourceVoh = TTL_VOH
    b.adapter.setSource(i, this.curTime, up, down, true)
  }

  /** Put the adapter's present drive on its pin (at `curTime`: an event's exact time). */
  private ttlApply(ad: TtlAdapter): void {
    const b = ad.board
    if (!b || ad.index < 0) return
    const t = this.curTime
    const [up, down] = this.ttlStage(ad)
    b.adapter.setSource(ad.index, t, up, down)
    if (ad.netSlot >= 0 && this.nets) this.nets.setDrive(ad.netSlot, up, down)
    else if (b.coupled[ad.index]) this.analogEdge(t)
  }

  /** Start the next queued frame (never against another driver). */
  private ttlPump(ad: TtlAdapter): void {
    if (ad.inFlight || !ad.attached || ad.queue.length === 0) return
    const b = ad.board
    if (!b || ad.index < 0) return
    const w = this.ttlWire(b, ad.index, ad)
    if (w.state !== 'free') {
      this.ttlLetGo(ad, w)
      return
    }
    const item = ad.queue.shift() as { byte: number; line: TtlLine }
    const bitT = 1 / item.line.baud
    const start = Math.max(this.curTime, ad.nextStart)
    const bits = ttlFrameBits(item.byte, item.line)
    const end = start + (bits.length + item.line.stopBits) * bitT
    ad.inFlight = true
    const at = (t: number, fn: () => void): void => {
      const h = this.schedule(t, () => {
        ad.handles.delete(h)
        fn()
      })
      ad.handles.add(h)
    }
    let prev: 0 | 1 = 1
    for (let k = 0; k <= bits.length; k++) {
      const l: 0 | 1 = k < bits.length ? bits[k] : 1 // then the stop bit(s)
      if (l === prev) continue
      prev = l
      at(start + k * bitT, () => {
        ad.level = l
        this.ttlApply(ad)
      })
    }
    at(end, () => {
      ad.inFlight = false
      ad.nextStart = end
      this.ttlPump(ad)
    })
  }

  /** Unplug: cancel the frame on the wire, drop the queue, release the line. */
  private ttlUnplug(ad: TtlAdapter): void {
    for (const h of ad.handles) this.events.cancel(h)
    ad.handles.clear()
    ad.inFlight = false
    ad.queue = []
    if (ad.attached) {
      ad.attached = false
      ad.level = 1
      this.ttlApply(ad)
    }
    ad.unlisten?.()
    ad.unlisten = null
  }

  /** Something else drives the RX net now: unplug and say so. */
  private ttlLetGo(ad: TtlAdapter, w: TtlWire): void {
    if (!ad.attached) return
    const pin = ad.pin
    this.ttlUnplug(ad)
    this.pushLog(
      'info',
      'sim',
      `${ad.componentId} ${ad.port}: the terminal's USB-TTL adapter let go of ${pin} — ${this.ttlWhy(ad.componentId, ad.port, pin, w)}`,
      ad.componentId,
    )
  }

  /** Logic-net listener of a plugged-in adapter: another strong driver (or the MCU's own output) appeared. */
  private ttlWatch(ad: TtlAdapter): void {
    const b = ad.board
    if (!ad.attached || !b || ad.index < 0) return
    const w = this.ttlWire(b, ad.index, ad)
    if (w.state !== 'free') this.ttlLetGo(ad, w)
  }

  /**
   * After a drive change on an analog net (analogEdge): an adapter plugged
   * into an analog net lets go when an MCU or device output now drives it
   * (the parts that drive by their kind cannot appear without a rebuild).
   */
  private ttlCheckAnalog(): void {
    for (const ad of this.ttl.values()) {
      const b = ad.board
      if (!ad.attached || ad.netSlot >= 0 || !b || ad.index < 0) continue
      if (b.adapter.drivesStrongly(ad.index)) this.ttlLetGo(ad, { state: 'output' })
      else {
        const by = this.ttlPresentDriver(b.pinNodes[ad.index], b.componentId, ad.index)
        if (by) this.ttlLetGo(ad, { state: 'driven', by })
      }
    }
  }

  /** (Re)bind every plugged-in adapter after a rebuild; one whose net is no longer free lets go. */
  private bindTtl(): void {
    for (const ad of this.ttl.values()) {
      // the previous DigitalNets (and its listeners) went with the old build
      ad.unlisten = null
      ad.board = null
      ad.index = -1
      ad.netSlot = -1
      if (!ad.attached) continue
      const b = this.boards.find((x) => x.componentId === ad.componentId)
      const i = b ? b.adapter.portName.indexOf(ad.pin) : -1
      if (!b || i < 0) {
        this.ttlUnplug(ad) // the board left the circuit: the adapter is unplugged with it
        continue
      }
      const w = this.ttlWire(b, i, null)
      if (w.state !== 'free') {
        this.ttlLetGo(ad, w)
        continue
      }
      this.ttlBind(ad, b, i, true)
    }
  }

  /**
   * What the adapter finds on the RX net of catalog pin `i` of board `b`
   * (`ad` = the adapter plugged into it, excluded from the drivers).
   */
  private ttlWire(b: Board, i: number, ad: TtlAdapter | null): TtlWire {
    const node = b.pinNodes[i]
    if (node <= NO_NODE) return { state: 'absent' }
    const cls = this.cls
    if (node === GROUND_NODE || (cls && kindOf(cls, node) === NET_RAIL)) {
      const by = this.ttlStaticDriver(node, b, i, true)
      return by ? { state: 'rail', by } : { state: 'rail' }
    }
    if (b.adapter.drivesStrongly(i)) return { state: 'output' }
    const nets = this.nets
    let present: UartRxDriver | null
    if (nets && b.logicSlot[i] >= 0) {
      // a logic net: every pin on it is a slot — its strength right now is exact
      const except = ad && ad.netSlot >= 0 ? [b.logicSlot[i], ad.netSlot] : [b.logicSlot[i]]
      const label = nets.strongDriver(node, except)
      present = label ? this.ttlDriverOfLabel(label) : null
    } else present = this.ttlPresentDriver(node, b.componentId, i)
    // then the parts that drive by their kind (a module's TXD still booting, a transistor, a level shifter's other side)
    const by = present ?? this.ttlStaticDriver(node, b, i, false)
    return by ? { state: 'driven', by } : { state: 'free' }
  }

  /** "U1.PA2" / "CH1.TXD" / "stimulus U1.PA0" (DigitalNets slot labels) → the driver. */
  private ttlDriverOfLabel(label: string): UartRxDriver {
    const m = /^(?:stimulus |USB-TTL )?([^.\s]+)\.(\S+)$/.exec(label)
    return m ? this.ttlBy(m[1], m[2]) : this.ttlBy(label, '')
  }

  /** A driver, with its module's own serial port when it has one. */
  private ttlBy(componentId: string, pin: string): UartRxDriver {
    const port = this.ttlModulePort(componentId)
    return port ? { componentId, pin, port } : { componentId, pin }
  }

  /** A module's own host-side serial port ('COM', 'BT'), when it has one. */
  private ttlModulePort(componentId: string): string | undefined {
    return serialPortsOf(this.hosts.get(componentId)?.host.device)[0]?.name
  }

  /** An MCU or digital-device output driving `node` strongly right now (analog nets). */
  private ttlPresentDriver(node: number, selfBoard: string | null, selfPin: number, skipPart?: string): UartRxDriver | null {
    for (const ob of this.boards) {
      if (ob.componentId === skipPart) continue
      for (let j = 0; j < ob.adapter.mapped.length; j++) {
        const k = ob.adapter.mapped[j]
        if (ob.pinNodes[k] !== node || (ob.componentId === selfBoard && k === selfPin)) continue
        if (ob.adapter.drivesStrongly(k)) return { componentId: ob.componentId, pin: ob.entry.pins[k] }
      }
    }
    const engine = this.eng
    if (!engine) return null
    for (const [id, hs] of this.hosts) {
      if (id === skipPart) continue
      const chip = hs.host.chip
      const nodes = engine.pinNodesOf(id)
      if (!chip || !nodes) continue
      for (let k = 0; k < nodes.length && k < chip.hist.up.length; k++) {
        if (nodes[k] !== node) continue
        if (chip.hist.up[k] >= G_STRONG || chip.hist.down[k] >= G_STRONG) return this.ttlBy(id, hs.host.pins[k])
      }
    }
    return null
  }

  /**
   * A part that can drive `node` by its kind (staticRole: a supply, a
   * transistor, an IC output), or — one hop — an output behind a part that
   * passes signals (a level shifter's MOSFET): { BT1 TXD via LS1 }. With
   * `rail`, the supply / power pin the rail net comes from.
   */
  private ttlStaticDriver(node: number, b: Board, i: number, rail: boolean): UartRxDriver | null {
    const idx = this.ttlNetIndex()
    const self = b.entry.pins[i]
    for (const a of idx.pins.get(node) ?? []) {
      if (a.componentId === b.componentId && a.pin === self) continue
      const role = staticRole(a.entry, a.pin)
      if (role === 'driver' || role === 'source') return this.ttlBy(a.componentId, a.pin)
      if (rail && isPowerPin(a.entry, a.pin)) return this.ttlBy(a.componentId, a.pin)
    }
    if (rail) return null
    for (const el of idx.elems.get(node) ?? []) {
      const here = el.pinNames[el.nodes.indexOf(node)] ?? ''
      // a stage inside the part (an internal node on its other side) drives this pin itself
      if (el.internal.some((x, k) => x && el.nodes[k] !== node)) return { componentId: el.componentId, pin: here }
      for (let k = 0; k < el.nodes.length; k++) {
        const m = el.nodes[k]
        if (m === node || m <= NO_NODE || m === GROUND_NODE) continue
        if (this.cls && kindOf(this.cls, m) === NET_RAIL) continue
        const d = this.ttlDirectDriver(m, el.componentId)
        if (d) return { ...d, via: el.componentId }
      }
    }
    return null
  }

  /** A driver directly on `node` (present outputs, then parts by kind), ignoring part `skip`. */
  private ttlDirectDriver(node: number, skip: string): UartRxDriver | null {
    const nets = this.nets
    if (nets && nets.isLogic(node)) {
      const label = nets.strongDriver(node)
      const d = label ? this.ttlDriverOfLabel(label) : null
      return d && d.componentId !== skip ? d : null
    }
    const present = this.ttlPresentDriver(node, null, -1, skip)
    if (present) return present
    for (const a of this.ttlNetIndex().pins.get(node) ?? []) {
      if (a.componentId === skip) continue
      const role = staticRole(a.entry, a.pin)
      if (role === 'driver' || role === 'source') return this.ttlBy(a.componentId, a.pin)
    }
    return null
  }

  /** Part pins and pass elements per solver node of the current build. */
  private ttlNetIndex(): NetIndex {
    if (this.netIndex) return this.netIndex
    const pins = new Map<number, NetAttach[]>()
    const elems = new Map<number, NetElem[]>()
    const engine = this.eng
    if (engine) {
      for (const comp of this.layout?.components ?? []) {
        if (!comp || typeof comp.id !== 'string') continue
        const entry = getEntry(comp.type)
        const nodes = entry ? engine.pinNodesOf(comp.id) : null
        if (!entry || !nodes) continue
        for (let k = 0; k < nodes.length && k < entry.pins.length; k++) {
          if (nodes[k] <= NO_NODE) continue
          let list = pins.get(nodes[k])
          if (!list) pins.set(nodes[k], (list = []))
          list.push({ componentId: comp.id, entry, pin: entry.pins[k] })
        }
        for (const el of engine.subcircuitOf(comp.id)) {
          if (!PASS_ELEMENTS.has(el.model)) continue
          const names = entry.subcircuit?.find((x) => x.id === el.id)?.pins ?? []
          const e: NetElem = {
            componentId: comp.id,
            pinNames: names,
            nodes: el.nodes,
            internal: names.map((p) => typeof p === 'string' && p.startsWith('@')),
          }
          for (const nd of new Set(el.nodes)) {
            if (nd <= NO_NODE) continue
            let list = elems.get(nd)
            if (!list) elems.set(nd, (list = []))
            list.push(e)
          }
        }
      }
    }
    this.netIndex = { pins, elems }
    return this.netIndex
  }

  /** The reason the adapter does not drive a net, for the log (zh-TW: messages-close-sim.ts). */
  private ttlWhy(id: string, port: string, pin: string, w: TtlWire): string {
    switch (w.state) {
      case 'driven': {
        const by = w.by
        if (!by) return `${pin} is driven by another output`
        return by.via ? `${pin} is driven by ${by.componentId} ${by.pin} through ${by.via}` : `${pin} is driven by ${by.componentId} ${by.pin}`
      }
      case 'rail':
        return `${pin} is wired to a supply rail or ground`
      case 'output':
        return `${pin} is an output of ${id} right now, not the ${port} RX`
      case 'absent':
        return `${pin} is not connected to anything`
      default:
        return `${pin} is busy`
    }
  }

  /** Every USART's RX wire for the frame (an adapter whose analog net got another driver lets go here). */
  private ttlFrameInfo(s: McuSlot, mapr: number | undefined): { uartRx?: UartRxInfo[] } {
    const b = s.board
    if (!b || s.mcu.uarts.length === 0) return {}
    const out: UartRxInfo[] = []
    for (const tap of s.mcu.uarts) {
      const pin = usartRxPin(tap.name, mapr)
      if (!pin) continue
      const ad = this.ttl.get(this.ttlKey(s.componentId, tap.name))
      const mine = ad && ad.attached && ad.pin === pin ? ad : null
      const i = b.adapter.portName.indexOf(pin)
      const w: TtlWire = i < 0 ? { state: 'absent' } : this.ttlWire(b, i, mine)
      if (mine && w.state !== 'free') this.ttlLetGo(mine, w)
      out.push({
        port: tap.name,
        pin,
        state: w.state,
        ...(w.by ? { by: w.by } : {}),
        attached: !!mine && mine.attached,
        queued: ad ? ad.queue.length + (ad.inFlight ? 1 : 0) : 0,
      })
    }
    return { uartRx: out }
  }
}

/** A pin that is a part's supply or ground (rail nets: who the rail comes from). */
function isPowerPin(entry: CatalogEntry, pin: string): boolean {
  if (entry.mcu && (pin === entry.mcu.vddPin || pin === entry.mcu.gndPin)) return true
  if (entry.supplyPins?.plus?.includes(pin) || entry.supplyPins?.minus?.includes(pin)) return true
  if (entry.digital && (pin === entry.digital.supplyPin || pin === entry.digital.groundPin)) return true
  const kind = entry.pinInfo?.find((p) => p.pin === pin)?.kind
  return kind === 'power' || kind === 'ground'
}

/** The terminal's virtual USB-TTL adapter on one MCU USART (TTL adapter block). */
interface TtlAdapter {
  readonly componentId: string
  readonly port: string
  /** the MCU pin it is plugged into ('PA10') */
  pin: string
  attached: boolean
  /** TXD level while attached */
  level: 0 | 1
  queue: { byte: number; line: TtlLine }[]
  /** a frame is on the wire (its events are scheduled) */
  inFlight: boolean
  /** earliest start of the next frame (s) */
  nextStart: number
  /** coordinator events of the frame on the wire */
  handles: Set<number>
  // binding to the current build (re-made by every load)
  board: Board | null
  index: number
  netSlot: number
  unlisten: (() => void) | null
}

/** What the adapter finds on an RX net. */
interface TtlWire {
  state: UartRxState
  by?: UartRxDriver
}

interface NetAttach {
  componentId: string
  entry: CatalogEntry
  pin: string
}

/** A pass element (transistor) inside a part, with its terminals' nodes. */
interface NetElem {
  componentId: string
  /** the element's pins as the catalog names them (catalog pins or '@' internal nodes) */
  pinNames: readonly string[]
  nodes: Int32Array
  internal: boolean[]
}

interface NetIndex {
  pins: Map<number, NetAttach[]>
  elems: Map<number, NetElem[]>
}
