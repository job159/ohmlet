/**
 * Digital (logic-level) device contract. CONTRACT FILE.
 *
 * Mixed-signal model used by the Simulation Coordinator:
 *
 *  ELECTRICAL layer — the existing MNA solver (SimEngine). Every pin drive
 *    of an MCU or digital device is ALSO stamped there as a Norton source, so
 *    DC levels, currents, pull-up presence, contention and the multimeter
 *    stay physically meaningful. It advances in analog steps (≤ 50 µs).
 *
 *  LOGIC layer — `DigitalNets` (src/sim/digital/nets.ts). A net whose every
 *    attached element is a logic pin (MCU pin / digital-device pin), a
 *    resistor to a FIXED-VOLTAGE rail (pull-up/pull-down), or a rail itself,
 *    is "logic-resolvable": a drive change on it is resolved immediately
 *    (wired-AND for open-drain, pull strength, contention → 'X') at the
 *    exact virtual time of the edge, and listeners are notified
 *    synchronously. Bit-level I²C / SPI / UART / 1-Wire between an MCU and a
 *    device therefore works at real bus speeds without forcing analog steps.
 *    A net with any other element (capacitor, LED, transistor, op-amp …) is
 *    "analog": logic readers see its voltage from the latest analog solve
 *    through their input thresholds (resolution = analog step).
 *
 *  PROTOCOL layer — devices implement their bus state machines on top of
 *    pin edges (START/STOP/ACK detection, shift registers, timing). Nothing
 *    is exchanged "by function call" between an MCU peripheral and a device:
 *    all communication goes through pins and nets, so wiring mistakes (no
 *    pull-up, swapped SDA/SCL, wrong address) produce the real symptoms.
 */
import type { ComponentInstance, ParamValue } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'

/** Resolved logic state of a net: 0, 1, or null = floating/undefined/contention. */
export type LogicLevel = 0 | 1 | null

/**
 * How a device drives one of its pins.
 *  'z'         released (high impedance; input)
 *  'low'/'high' strong push-pull drive (open-drain devices only ever use 'low'/'z')
 *  'pull-up'/'pull-down' weak drive (internal pull resistor of the device)
 */
export type DigitalDrive = 'z' | 'low' | 'high' | 'pull-up' | 'pull-down'

export interface DigitalDeviceCtx {
  readonly componentId: string
  /** current virtual time (s) — exact, also inside pin-change callbacks */
  now(): number
  /** resolved logic level of the net on `pin` (with this device's input thresholds) */
  read(pin: string): LogicLevel
  /** last known voltage of the net on `pin` (V; NaN if unconnected) */
  voltage(pin: string): number
  /** change this device's drive on `pin`; takes effect immediately (same virtual time) */
  drive(pin: string, d: DigitalDrive): void
  /** run `fn` after `delay` seconds of virtual time; returns a handle */
  schedule(delay: number, fn: () => void): number
  cancel(handle: number): void
  /** supply voltage across the device's supply pins (V; 0 when unpowered/unconnected) */
  supply(): number
  /** surface a problem in the simulation log / issues list */
  issue(level: 'error' | 'warning', message: string): void
  log(message: string): void
}

/** Telemetry a device may expose (merged into ComponentTelemetry). */
export interface DeviceTelemetry {
  display?: import('../../model/types').DisplayTelemetry
  values?: Record<string, number>
  rgb?: number[]
  leds?: Record<string, number>
  text?: string[]
}

export interface DigitalDevice {
  /** Called once when the simulation starts (and after a power cycle). */
  init(ctx: DigitalDeviceCtx): void
  /** A logic input changed (only pins listed in `DigitalSpec.inputs`). */
  onPinChange?(pin: string, level: LogicLevel): void
  /** Runtime parameter / environment input (temperature, acceleration, distance…). */
  setParam?(key: string, value: ParamValue): void
  /** Supply crossed the device's minimum operating voltage. Unpowered devices must release all pins. */
  powerChanged?(powered: boolean): void
  /** Called at UI rate; return a snapshot (must be cheap; bump a version for big buffers). */
  telemetry?(): DeviceTelemetry | null
}

/** Catalog-side description of a digital device (CatalogEntry.digital). */
export interface DigitalSpec {
  /** model id registered with registerDigitalDevice */
  model: string
  /** supply pin and ground pin names (device is powered when V(supply)-V(ground) ≥ minVdd) */
  supplyPin: string
  groundPin: string
  minVdd: number
  /** pins whose logic changes are delivered to onPinChange */
  inputs: string[]
  /** pins the device may drive (a bidirectional pin such as SDA or 1-Wire DQ must be listed in BOTH inputs and outputs) */
  outputs: string[]
  /** input thresholds as fractions of the device supply (CMOS default 0.3 / 0.7) */
  vilFrac?: number
  vihFrac?: number
  /** output impedance for 'low'/'high' (Ω, default 50) and pull resistance (Ω, default 50k) */
  rout?: number
  rPull?: number
  /**
   * Output-high rail when it is NOT the supply pin (additive; absent = the
   * supply pin, the legacy behaviour): a module whose chip runs from an
   * on-board regulator (HC-05, GY-521, ILI9341 …) drives its outputs
   * between GND and that regulator's output, not its VCC pin.
   */
  outputRail?: DigitalOutputRail
}

/**
 * Where the HIGH side of a device's output stage connects (DigitalSpec.outputRail).
 * The 'high' and 'pull-up' drives of the covered pins switch to this node
 * instead of `supplyPin`: in the analog solve, on logic-resolvable nets and
 * in the ERC's output-high level. 'low' / 'pull-down' always go to
 * `groundPin`; the input thresholds stay fractions of the supply pin.
 */
export interface DigitalOutputRail {
  /**
   * The rail: a catalog pin ('3V3') or an internal sub-circuit node ('@v33'
   * = a pin of an `entry.subcircuit` element, typically the module LDO's
   * output).
   */
  node: string
  /** the outputs it applies to (default: every pin of `outputs`) */
  pins?: string[]
  /**
   * A jumper param that selects the rail: option value → node (CH340 "logic"
   * 5V / 3.3V). An option missing from `nodes` falls back to `node`.
   */
  select?: { param: string; nodes: Record<string, string> }
}

/**
 * The declared output-high rail of `pin` (a catalog pin name or an '@'
 * sub-circuit node — possibly the supply pin itself when a jumper selects
 * it), or null when nothing is declared for it (its high side is the
 * supply pin). `param` reads the part's params (with catalog defaults) for
 * a `select` jumper.
 */
export function outputRailNode(
  spec: DigitalSpec,
  pin: string,
  param?: (key: string) => ParamValue | undefined,
): string | null {
  const r = spec.outputRail
  if (!r || typeof r.node !== 'string' || r.node === '') return null
  if (!(r.pins ?? spec.outputs).includes(pin)) return null
  if (r.select && param) {
    const v = param(r.select.param)
    const key = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined
    const sel = key !== undefined ? r.select.nodes[key] : undefined
    if (typeof sel === 'string' && sel !== '') return sel
  }
  return r.node
}

export type DigitalDeviceFactory = (comp: ComponentInstance, entry: CatalogEntry) => DigitalDevice

const registry = new Map<string, DigitalDeviceFactory>()

export function registerDigitalDevice(model: string, factory: DigitalDeviceFactory): void {
  registry.set(model, factory)
}

export function createDigitalDevice(
  model: string,
  comp: ComponentInstance,
  entry: CatalogEntry,
): DigitalDevice | null {
  const f = registry.get(model)
  return f ? f(comp, entry) : null
}

export function registeredDigitalDevices(): string[] {
  return [...registry.keys()]
}
