/**
 * Generic chip adapter for logic-level parts (catalog sim {kind:'chip',
 * model:'digital-device'} + `entry.digital`), and the coordinator-side
 * runtime that hosts the `DigitalDevice` model behind `DigitalDeviceCtx`.
 *
 *  DigitalDeviceChip  — lives inside SimEngine (re-created on every rebuild):
 *                       stamps the device's pin drives into the analog
 *                       solver as CMOS stages against the device's own
 *                       supply / ground pins (duty-averaged per interval), so
 *                       DC levels, contention currents and the multimeter
 *                       stay physical.
 *  DigitalDeviceHost  — owned by the SimulationCoordinator (survives
 *                       rebuilds): the DigitalDevice instance, its ctx,
 *                       drives, input hysteresis, power state and scheduled
 *                       events. On logic-resolvable nets drives/inputs go
 *                       through DigitalNets at the exact virtual time; on
 *                       analog nets inputs come from each analog solve and a
 *                       drive change asks the coordinator for an analog step
 *                       boundary at that instant.
 *
 * Output-high rail (DigitalSpec.outputRail): a module whose chip runs from an
 * on-board regulator (HC-05, GY-521, ILI9341, the CH340's 3.3 V jumper)
 * switches the up side of its 'high' / 'pull-up' stages to that rail, not
 * to its VCC pin — so a 3.3 V chip on a 5 V module drives 3.3 V:
 *  - logic-resolvable nets: the DigitalNets slot's up node IS the rail node
 *    (a catalog pin, or the internal '@' sub-circuit node via the net
 *    classification) — exact;
 *  - analog solve: a rail that is a catalog pin and the rail of every
 *    output becomes the chip's stage rail (setRailPins — KCL-exact, the
 *    regulator supplies the current). Any other rail (an internal '@' node,
 *    which ChipStepCtx cannot name) drives the up side as a Norton source
 *    at the rail's solved voltage with the same stage conductance: the
 *    exact output level and output impedance, but that current is not drawn
 *    from the module regulator (an engine stage-to-internal-node hook would
 *    make it exact). 'low' / 'pull-down' stay stage drives to the ground pin.
 */
import { registerChip } from '../chip-api'
import type { ChipInstance, ChipStepCtx } from '../chip-api'
import type { ComponentInstance, ComponentTelemetry, ParamValue } from '../../model/types'
import { getEntry, paramOf } from '../../model/catalog'
import type { CatalogEntry } from '../../model/catalog'
import { outputRailNode } from './api'
import type { DigitalDevice, DigitalDeviceCtx, DigitalDrive, DigitalSpec, LogicLevel } from './api'
import { StageHistory } from '../coordinator/stage'
import { NET_DRIVEN } from './nets'
import type { DigitalNets } from './nets'

export const DIGITAL_DEVICE_MODEL = 'digital-device'

/** CMOS input thresholds as fractions of the device supply (api.ts defaults). */
const DEFAULT_VIL_FRAC = 0.3
const DEFAULT_VIH_FRAC = 0.7
const DEFAULT_ROUT = 50
const DEFAULT_RPULL = 50_000

/** The analog interval about to be stepped (set by the coordinator). */
export interface StepWindow {
  readonly t0: number
  readonly t1: number
}

// ----------------------------------------------------------- engine side

/** DigitalDeviceChip.railPin: the pin's high side is the chip's supply pin (no outputRail). */
export const RAIL_SUPPLY = -1
/** DigitalDeviceChip.railPin: the pin's high side is an internal sub-circuit node (railName). */
export const RAIL_INTERNAL = -2

export class DigitalDeviceChip implements ChipInstance {
  readonly entry: CatalogEntry | null
  readonly spec: DigitalSpec | null
  readonly pinIndex = new Map<string, number>()
  readonly supplyIdx: number
  readonly groundIdx: number
  readonly hist: StageHistory
  /**
   * Output-high rail per catalog pin (DigitalSpec.outputRail, resolved with
   * this part's params): RAIL_SUPPLY, a catalog pin index, or RAIL_INTERNAL.
   */
  readonly railPin: Int32Array
  /** the declared rail per catalog pin ('@v33', '3V3'; null = the supply pin) */
  readonly railName: (string | null)[]
  /** catalog pin that is the rail of EVERY output (the chip's stage rail), −1 none */
  private readonly commonRail: number
  private readonly stampUp: Float64Array
  private readonly stampDown: Float64Array
  host: DigitalDeviceHost | null = null
  private window: StepWindow | null = null
  private ctx: ChipStepCtx | null = null

  constructor(readonly comp: ComponentInstance) {
    const entry = getEntry(comp.type) ?? null
    this.entry = entry
    this.spec = entry?.digital ?? null
    const pins = entry?.pins ?? []
    pins.forEach((p, i) => this.pinIndex.set(p, i))
    this.supplyIdx = this.spec ? pins.indexOf(this.spec.supplyPin) : -1
    this.groundIdx = this.spec ? pins.indexOf(this.spec.groundPin) : -1
    this.hist = new StageHistory(pins.length)
    this.stampUp = new Float64Array(pins.length)
    this.stampDown = new Float64Array(pins.length)
    this.railPin = new Int32Array(pins.length).fill(RAIL_SUPPLY)
    this.railName = new Array<string | null>(pins.length).fill(null)
    let common = -1
    const spec = this.spec
    if (entry && spec?.outputRail) {
      const param = (key: string) => paramOf(comp.params, entry, key)
      let uniform = spec.outputs.length > 0
      let first: number | undefined
      for (let i = 0; i < pins.length; i++) {
        const node = outputRailNode(spec, pins[i], param)
        if (node === null || node === spec.supplyPin) continue
        this.railName[i] = node
        this.railPin[i] = node.startsWith('@') ? RAIL_INTERNAL : pins.indexOf(node)
        if (this.railPin[i] === -1) this.railPin[i] = RAIL_INTERNAL // not a catalog pin: never the supply
      }
      for (const out of spec.outputs) {
        const r = this.railPin[pins.indexOf(out)] ?? RAIL_SUPPLY
        first ??= r
        if (r < 0 || r !== first) uniform = false
      }
      if (uniform && first !== undefined && first >= 0) common = first
    }
    this.commonRail = common
  }

  bind(host: DigitalDeviceHost | null, window: StepWindow): void {
    this.host = host
    this.window = window
  }

  step(ctx: ChipStepCtx): void {
    this.ctx = ctx
    if (!ctx.drivePinStageAt || !ctx.setRailPins) return
    const hi = this.commonRail >= 0 ? this.commonRail : this.supplyIdx
    ctx.setRailPins(hi, this.groundIdx)
    const w = this.window
    const t0 = w ? w.t0 : ctx.time
    const t1 = w ? w.t1 : ctx.time + ctx.dt
    this.hist.average(t0, t1, this.stampUp, this.stampDown)
    const railPin = this.railPin
    for (let i = 0; i < this.stampUp.length; i++) {
      const r = railPin[i]
      if (r === RAIL_SUPPLY || r === hi) {
        ctx.drivePinStageAt(i, this.stampUp[i], this.stampDown[i])
        continue
      }
      // own output rail ≠ the stage rail: the up side as a Norton source at
      // the rail's solved voltage (see the file header); unknown rail → the
      // supply pin, as without a declaration
      const up = this.stampUp[i]
      const v = up > 0 && ctx.drivePinAt ? (r >= 0 ? this.read(r) : this.host ? this.host.railVoltage(i) : NaN) : NaN
      const norton = Number.isFinite(v)
      ctx.drivePinStageAt(i, norton ? 0 : up, this.stampDown[i])
      ctx.drivePinAt?.(i, norton ? v : 0, norton ? 1 / up : 0)
    }
    this.hist.commit(t1)
  }

  /** Solved node voltage of catalog pin i (absolute, V; NaN before the first step). */
  read(i: number): number {
    return this.ctx && this.ctx.readPinAt ? this.ctx.readPinAt(i) : NaN
  }

  setRuntimeParam(key: string, value: ParamValue): void {
    this.host?.setParam(key, value)
  }

  fillTelemetry(tele: ComponentTelemetry): void {
    this.host?.fillTelemetry(tele)
  }
}

registerChip(DIGITAL_DEVICE_MODEL, (comp) => new DigitalDeviceChip(comp))

// ------------------------------------------------------ coordinator side

/** Coordinator services a hosted device uses. */
export interface DigitalServices {
  /** current virtual time (exact; inside MCU callbacks the edge time) */
  now(): number
  /** run `fn` at absolute virtual time `at` on the coordinator event queue */
  schedule(at: number, fn: () => void): number
  cancel(handle: number): void
  issue(componentId: string, level: 'error' | 'warning', message: string): void
  log(componentId: string, level: 'info' | 'warning' | 'error', message: string): void
  /** a drive on an ANALOG net changed at `t`: request an analog step boundary */
  analogEdge(t: number): void
}

/** Per-pin binding to the current engine build. */
interface PinBinding {
  node: number
  /** DigitalNets slot (−1 = analog net / unconnected) */
  slot: number
}

export class DigitalDeviceHost {
  readonly ctx: DigitalDeviceCtx
  readonly spec: DigitalSpec
  readonly pins: string[]
  chip: DigitalDeviceChip | null = null
  powered = false
  private nets: DigitalNets | null = null
  private bindings: PinBinding[] = []
  /** solver node of each pin's declared output rail (−2: none / unknown — the supply pin) */
  private railNodes: Int32Array = new Int32Array(0)
  private unsubscribe: (() => void)[] = []
  private readonly drives: DigitalDrive[]
  /** stage conductances currently applied per pin */
  private readonly curUp: Float64Array
  private readonly curDown: Float64Array
  private readonly mayDrive: Uint8Array
  private readonly isInput: Uint8Array
  /** hysteresis state per pin: −1 unknown, 0, 1 */
  private readonly hyst: Int8Array
  /** last level delivered to onPinChange: −2 never, −1 null, 0, 1 */
  private readonly delivered: Int8Array
  private readonly handles = new Set<number>()
  private readonly warned = new Set<string>()
  private initialized = false
  private disposed = false

  constructor(
    readonly componentId: string,
    readonly entry: CatalogEntry,
    readonly device: DigitalDevice,
    private readonly services: DigitalServices,
  ) {
    const spec = entry.digital
    if (!spec) throw new Error(`${componentId}: catalog entry ${entry.type} has no digital spec`)
    this.spec = spec
    this.pins = entry.pins
    const n = entry.pins.length
    this.drives = new Array<DigitalDrive>(n).fill('z')
    this.curUp = new Float64Array(n)
    this.curDown = new Float64Array(n)
    this.mayDrive = new Uint8Array(n)
    this.isInput = new Uint8Array(n)
    this.hyst = new Int8Array(n).fill(-1)
    this.delivered = new Int8Array(n).fill(-2)
    for (const p of spec.outputs) {
      const i = entry.pins.indexOf(p)
      if (i >= 0) this.mayDrive[i] = 1
    }
    // bidirectional pins (SDA, DQ …) are listed in BOTH inputs and outputs
    for (const p of spec.inputs) {
      const i = entry.pins.indexOf(p)
      if (i >= 0) this.isInput[i] = 1
    }
    const self = this
    this.ctx = {
      componentId,
      now: () => services.now(),
      read: (pin) => self.readPin(pin),
      voltage: (pin) => self.voltagePin(pin),
      drive: (pin, d) => self.drivePin(pin, d),
      schedule: (delay, fn) => self.schedule(delay, fn),
      cancel: (h) => self.cancel(h),
      supply: () => self.supply(),
      issue: (level, message) => services.issue(componentId, level, `${componentId}: ${message}`),
      log: (message) => services.log(componentId, 'info', message),
    }
  }

  // ------------------------------------------------------------- binding

  /**
   * Bind to a (re)built engine: `nodes` = solver node per catalog pin;
   * logic-net pins get DigitalNets slots. Call `nets.resolveAll()` after
   * every host and MCU is attached.
   */
  attach(
    chip: DigitalDeviceChip | null,
    nets: DigitalNets | null,
    nodes: Int32Array | null,
    window: StepWindow,
  ): void {
    for (const u of this.unsubscribe) u()
    this.unsubscribe = []
    this.chip = chip
    this.nets = nets
    const n = this.pins.length
    this.bindings = []
    const supplyNode = nodes && chip && chip.supplyIdx >= 0 ? nodes[chip.supplyIdx] : -2
    const groundNode = nodes && chip && chip.groundIdx >= 0 ? nodes[chip.groundIdx] : -2
    this.railNodes = new Int32Array(n).fill(-2)
    for (let i = 0; i < n; i++) {
      const node = nodes && i < nodes.length ? nodes[i] : -2
      // the output stage's high side: the declared output rail, else the supply pin
      const r = chip && i < chip.railPin.length ? chip.railPin[i] : RAIL_SUPPLY
      if (r >= 0 && nodes && r < nodes.length) this.railNodes[i] = nodes[r]
      else if (r === RAIL_INTERNAL && nets && chip) this.railNodes[i] = nets.internalNode(this.componentId, chip.railName[i] ?? '')
      const upNode = this.railNodes[i] > -2 ? this.railNodes[i] : supplyNode
      let slot = -1
      if (nets && (this.mayDrive[i] || this.isInput[i]) && nets.isLogic(node)) {
        slot = nets.addSlot(node, upNode, groundNode, `${this.componentId}.${this.pins[i]}`)
        const [up, down] = this.stageOf(this.effective(i))
        nets.initDrive(slot, up, down)
        if (this.isInput[i]) {
          const pin = i
          this.unsubscribe.push(nets.listen(node, () => this.inputMaybeChanged(pin)))
        }
      }
      this.bindings.push({ node, slot })
      const [up, down] = this.stageOf(this.effective(i))
      this.curUp[i] = up
      this.curDown[i] = down
      if (chip) chip.hist.set(i, up, down)
    }
    chip?.bind(this, window)
    if (!this.initialized) {
      this.initialized = true
      try {
        this.device.init(this.ctx)
      } catch (err) {
        this.services.issue(this.componentId, 'error', `${this.componentId}: device model error in init: ${String(err)}`)
      }
    }
  }

  /** Cancel scheduled events and listeners (device removed from the layout). */
  dispose(): void {
    this.disposed = true
    for (const u of this.unsubscribe) u()
    this.unsubscribe = []
    for (const h of this.handles) this.services.cancel(h)
    this.handles.clear()
  }

  // ----------------------------------------------------------- ctx impl

  private indexOf(pin: string): number {
    const i = this.pins.indexOf(pin)
    if (i < 0) this.warnOnce(`pin:${pin}`, `unknown pin "${pin}"`)
    return i
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.services.issue(this.componentId, 'warning', `${this.componentId}: ${message}`)
  }

  /** Voltage of the net on catalog pin i: logic nets exact, analog nets from the last solve. */
  private netVoltage(i: number): number {
    const b = this.bindings[i]
    if (!b) return NaN
    if (b.slot >= 0 && this.nets) {
      return this.nets.state(b.node) === NET_DRIVEN ? this.nets.voltage(b.node) : NaN
    }
    return this.chip ? this.chip.read(i) : NaN
  }

  /** Logic level of catalog pin i with this device's thresholds + hysteresis. */
  private levelOf(i: number): LogicLevel {
    const vdd = this.supply()
    if (!this.powered || !(vdd > 0)) return null
    const v = this.netVoltage(i)
    if (!Number.isFinite(v)) {
      this.hyst[i] = -1
      return null
    }
    const vil = (this.spec.vilFrac ?? DEFAULT_VIL_FRAC) * vdd
    const vih = (this.spec.vihFrac ?? DEFAULT_VIH_FRAC) * vdd
    // relative to the device ground
    const vRel = v - this.groundVoltage()
    if (vRel <= vil) this.hyst[i] = 0
    else if (vRel >= vih) this.hyst[i] = 1
    const h = this.hyst[i]
    return h === 0 ? 0 : h === 1 ? 1 : null
  }

  private readPin(pin: string): LogicLevel {
    const i = this.indexOf(pin)
    return i < 0 ? null : this.levelOf(i)
  }

  private voltagePin(pin: string): number {
    const i = this.indexOf(pin)
    return i < 0 ? NaN : this.netVoltage(i)
  }

  private drivePin(pin: string, d: DigitalDrive): void {
    const i = this.indexOf(pin)
    if (i < 0) return
    if (!this.mayDrive[i]) {
      this.warnOnce(`drive:${pin}`, `model drives pin ${pin}, which the catalog does not list as an output — ignored`)
      return
    }
    if (this.drives[i] === d) return
    this.drives[i] = d
    this.apply(i)
  }

  private schedule(delay: number, fn: () => void): number {
    if (this.disposed) return 0
    const at = this.services.now() + (delay > 0 && Number.isFinite(delay) ? delay : 0)
    const h = this.services.schedule(at, () => {
      this.handles.delete(h)
      if (this.disposed) return
      try {
        fn()
      } catch (err) {
        this.services.issue(this.componentId, 'error', `${this.componentId}: device model error: ${String(err)}`)
      }
    })
    this.handles.add(h)
    return h
  }

  private cancel(h: number): void {
    if (!this.handles.has(h)) return
    this.handles.delete(h)
    this.services.cancel(h)
  }

  private groundVoltage(): number {
    const c = this.chip
    if (!c || c.groundIdx < 0) return 0
    const v = c.read(c.groundIdx)
    return Number.isFinite(v) ? v : 0
  }

  /**
   * Absolute voltage (V, latest solve) of catalog pin i's declared output
   * rail; NaN when it has none or the rail node is unknown (the chip then
   * stages the pin against its supply pin, as without a declaration).
   */
  railVoltage(i: number): number {
    const node = i >= 0 && i < this.railNodes.length ? this.railNodes[i] : -2
    return node > -2 && this.nets ? this.nets.railVoltageOf(node) : NaN
  }

  /** V(supply) − V(ground) from the latest solve (0 when unconnected). */
  supply(): number {
    const c = this.chip
    if (!c || c.supplyIdx < 0) return 0
    const v = c.read(c.supplyIdx) - this.groundVoltage()
    return Number.isFinite(v) ? v : 0
  }

  // ------------------------------------------------------------ drives

  private effective(i: number): DigitalDrive {
    return this.powered ? this.drives[i] : 'z'
  }

  private stageOf(d: DigitalDrive): [number, number] {
    const gs = 1 / (this.spec.rout ?? DEFAULT_ROUT)
    const gp = 1 / (this.spec.rPull ?? DEFAULT_RPULL)
    switch (d) {
      case 'high':
        return [gs, 0]
      case 'low':
        return [0, gs]
      case 'pull-up':
        return [gp, 0]
      case 'pull-down':
        return [0, gp]
      default:
        return [0, 0]
    }
  }

  private apply(i: number): void {
    const [up, down] = this.stageOf(this.effective(i))
    if (this.curUp[i] === up && this.curDown[i] === down) return
    this.curUp[i] = up
    this.curDown[i] = down
    const t = this.services.now()
    this.chip?.hist.record(i, t, up, down)
    const b = this.bindings[i]
    if (b && b.slot >= 0 && this.nets) this.nets.setDrive(b.slot, up, down)
    else if (b && b.node > -2 && this.chip) this.services.analogEdge(t)
  }

  private inputMaybeChanged(i: number): void {
    if (!this.powered) return
    const level = this.levelOf(i)
    const code = level === null ? -1 : level
    if (code === this.delivered[i]) return
    this.delivered[i] = code
    if (this.device.onPinChange) {
      try {
        this.device.onPinChange(this.pins[i], level)
      } catch (err) {
        this.services.issue(this.componentId, 'error', `${this.componentId}: device model error: ${String(err)}`)
      }
    }
  }

  /**
   * After every analog solve: supply supervision (powerChanged) and inputs
   * on ANALOG nets (logic nets deliver through their listeners).
   */
  postSolve(): void {
    const vdd = this.supply()
    const p = vdd >= this.spec.minVdd
    if (p !== this.powered) {
      this.powered = p
      if (this.device.powerChanged) {
        try {
          this.device.powerChanged(p)
        } catch (err) {
          this.services.issue(this.componentId, 'error', `${this.componentId}: device model error: ${String(err)}`)
        }
      }
      // unpowered parts release every pin; re-apply the model's drives on power-up
      for (let i = 0; i < this.pins.length; i++) this.apply(i)
      if (!p) this.delivered.fill(-2)
      for (let i = 0; i < this.pins.length; i++) if (this.isInput[i]) this.inputMaybeChanged(i)
      return
    }
    if (!p) return
    for (let i = 0; i < this.pins.length; i++) {
      if (this.isInput[i] && !(this.bindings[i] && this.bindings[i].slot >= 0)) this.inputMaybeChanged(i)
    }
  }

  setParam(key: string, value: ParamValue): void {
    try {
      this.device.setParam?.(key, value)
    } catch (err) {
      this.services.issue(this.componentId, 'error', `${this.componentId}: device model error: ${String(err)}`)
    }
  }

  fillTelemetry(tele: ComponentTelemetry): void {
    const t = this.device.telemetry?.()
    if (!t) return
    if (t.display) tele.display = t.display
    if (t.values) tele.values = t.values
    if (t.rgb) tele.rgb = t.rgb
    if (t.leds) tele.leds = t.leds
    if (t.text) tele.text = t.text
  }

  /** Current drive of a catalog pin as requested by the model (tests / inspector). */
  driveOf(pin: string): DigitalDrive {
    const i = this.pins.indexOf(pin)
    return i >= 0 ? this.drives[i] : 'z'
  }
}
