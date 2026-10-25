/**
 * Simulation Coordinator + host contract. CONTRACT FILE.
 *
 * The coordinator (src/sim/coordinator/coordinator.ts) owns ONE simulated
 * world in deterministic virtual time:
 *   - the analog solver (SimEngine, unchanged model),
 *   - every MCU (McuDevice, keyed by component id),
 *   - every digital device (DigitalDevice) and the logic-net layer,
 *   - recorders for the oscilloscope, logic analyzer, UART terminals and log.
 *
 * Time advance (one `advance(seconds)` call):
 *   loop until the target:
 *     tNext = min(target, tAnalog + maxDt, next device event, next MCU sync)
 *     each MCU.runUntil(tNext)   — stops early when a pin that feeds an
 *                                   ANALOG net changes drive (exact edge)
 *     due digital-device events run (logic nets resolve instantly)
 *     engine.step(t - tAnalog)   — chip adapters stamp the drives that were
 *                                   in effect over the interval
 *     inputs pushed back to MCUs/devices from the new solution
 *   With no MCU and no digital device this degenerates to fixed
 *   DEFAULT_DT engine steps — bit-identical to the legacy store loop.
 *
 * Hosts run a coordinator either in a Web Worker (browser) or inline
 * (node tests / fallback). UI code talks ONLY to `SimHost`.
 */
import type {
  CircuitLayout,
  EndpointRef,
  ParamValue,
  ScopeSample,
  SimIssue,
  SimTelemetry,
} from '../../model/types'
import type { FirmwareImage } from '../../mcu/firmware'
import type { McuDebugState, PeripheralSupport, UartLineConfig } from '../../mcu/mcu-api'

// ------------------------------------------------------------------ log

export interface SimLogEntry {
  /** simulation time (s) */
  time: number
  level: 'info' | 'warning' | 'error'
  /** 'sim', 'U1/core', 'U1/USART1', 'OLED1' … */
  source: string
  message: string
  componentId?: string
}

// ------------------------------------------------------------ instruments

/** Where a logic-analyzer channel takes its signal from. */
export type LogicSource =
  | { kind: 'probe'; componentId: string } // a placed logic_probe part (its hole's net)
  | { kind: 'mcu-pin'; componentId: string; pin: string } // an MCU board catalog pin, e.g. 'PA9'
  | { kind: 'net'; ref: EndpointRef } // any hole / terminal

export interface LogicChannelConfig {
  index: number // 0..15
  label: string
  source: LogicSource
}

/** Decoded edge list of one channel inside a capture window. */
export interface LogicTrace {
  index: number
  label: string
  /** level at window start: 0, 1, or 2 = undefined (floating/contention/unknown) */
  initial: 0 | 1 | 2
  /** edge times (s), ascending */
  times: Float64Array
  /** level AFTER each edge (0, 1, 2) */
  levels: Uint8Array
  /** true when the source is exact (MCU pin or logic-resolvable net) rather than thresholded analog samples */
  exact: boolean
  /**
   * A thresholded analog net (exact = false): the lowest / highest voltage
   * the solver saw on it over the query window (UX IS-16 — the analyzer
   * says when the thresholds hide its signal). Absent for exact sources and
   * when no sample of the window is kept.
   */
  vmin?: number
  vmax?: number
  /** the thresholds that turn this analog net into logic levels (V): low below `vil`, high above `vih` */
  vil?: number
  vih?: number
  /**
   * Simulation time (s) the channel was bound to its CURRENT source (always
   * set by the coordinator). The edge ring is cleared whenever a channel's
   * source changes (another pin / net / probe position) or the world is
   * reset, so nothing before `since` belongs to this source: a window that
   * starts earlier reads `initial` = 2 (undefined) up to the first edge at
   * or after `since`. Rebuilds that keep the source keep the history.
   */
  since?: number
}

export interface LogicCapture {
  t0: number
  t1: number
  traces: LogicTrace[]
  /** edges dropped because the ring buffer wrapped */
  overflow: boolean
  /**
   * Coordinator time (s) when the capture was taken: every trace is complete
   * up to here and holds its last level beyond it (draw limit). Always set
   * by the coordinator.
   */
  tNow?: number
}

/** Oscilloscope samples of one channel (variable-step, as solved). */
export interface ScopeTrace {
  index: number // 0..3 (scope_probe channel param)
  label: string
  t: Float64Array
  v: Float32Array
  /**
   * true when the window held more than `maxPoints` samples and was min/max
   * decimated per bucket (spikes kept; averaged measurements approximate).
   * Always set by the coordinator.
   */
  decimated?: boolean
}

/** Server-side oscilloscope trigger search (HostQuery 'scope-trigger'). */
export interface ScopeTriggerQuery {
  kind: 'scope-trigger'
  /** scope channel 0..3 */
  channel: number
  /** trigger level (V) */
  level: number
  slope: 'rising' | 'falling'
  /** search window (absolute simulation time, s): samples in [t0, t1], crossings reported in [t0, t1] */
  t0: number
  t1: number
  /** re-arm band (V, default 0): the signal must first be beyond level ∓ hysteresis */
  hysteresis?: number
  /** s; crossings closer than this to the previous accepted one are ignored (default 0) */
  holdoff?: number
  /** which accepted crossing to return (default 'last') */
  pick?: 'first' | 'last'
}

export interface ScopeCapture {
  t0: number
  t1: number
  traces: ScopeTrace[]
}

/**
 * Host → coordinator pull requests (answered asynchronously by hosts).
 * 'scope-trigger' searches level crossings on the FULL-resolution scope
 * recording (never on a decimated capture), with the semantics of
 * src/instruments/trigger.ts findScopeTriggers (linear interpolation between
 * the solved samples, hysteresis re-arm, holdoff); `t` is null when no
 * crossing qualifies or the channel has no probe.
 */
export type HostQuery =
  | { kind: 'logic'; t0: number; t1: number }
  | { kind: 'scope'; t0: number; t1: number; maxPoints?: number }
  | ScopeTriggerQuery
  | { kind: 'mcu-debug'; componentId: string }
  | { kind: 'mcu-memory'; componentId: string; addr: number; length: number }
  | { kind: 'mcu-support'; componentId: string }

export type HostQueryResult =
  | { kind: 'logic'; capture: LogicCapture }
  | { kind: 'scope'; capture: ScopeCapture }
  | { kind: 'scope-trigger'; t: number | null; tNow: number }
  | { kind: 'mcu-debug'; state: McuDebugState | null }
  | { kind: 'mcu-memory'; bytes: Uint8Array | null }
  | { kind: 'mcu-support'; support: PeripheralSupport[] }

// ---------------------------------------------------------------- frames

/** Per-MCU summary pushed with every frame. */
export interface McuFrameInfo {
  componentId: string
  state: McuDebugState['state']
  firmware: string | null
  pc: number
  hclkHz: number
  cycles: number
  /** achieved MCU speed relative to real time over the last second */
  realtime: number
  /** UART line configs as programmed by firmware */
  uarts: { name: string; config: UartLineConfig }[]
}

/** What a host delivers to the UI, at most once per animation frame. */
export interface SimFrame {
  /** layout revision this frame was computed from (drop frames of stale revisions) */
  rev: number
  time: number
  running: boolean
  /** set when the host stopped its own loop (an MCU hit a breakpoint / was halted) */
  pausedBy?: 'debugger' | null
  telemetry: SimTelemetry
  /** 1 kHz legacy scope feed (ScopeSheet), samples since the previous frame */
  scope: ScopeSample[]
  /** UART bytes transmitted by firmware since the previous frame */
  uart: { componentId: string; port: string; bytes: number[] }[]
  mcus: McuFrameInfo[]
  log: SimLogEntry[]
  issues: SimIssue[]
  perf: {
    /** achieved sim-time / wall-time over the last second */
    realtimeFactor: number
    /** analog steps per wall second */
    stepsPerSecond: number
    /** wall ms spent simulating per wall second (load) */
    busyMs: number
  }
}

export interface SimHostCallbacks {
  onFrame(frame: SimFrame): void
  /** fatal host failure (worker crashed, construction error) */
  onError?(message: string): void
}

/** The single simulation API used by the store and UI. */
export interface SimHost {
  readonly kind: 'worker' | 'inline'
  /**
   * (Re)build the world for `layout`. Called on every document change.
   * MCUs whose component id AND firmware survive keep running (hot rewire);
   * everything else starts from power-on.
   */
  load(layout: CircuitLayout, rev: number): void
  /**
   * Attach / replace / remove firmware of an MCU board. ALWAYS reprograms
   * and power-on-resets that MCU. The coordinator keeps firmware per
   * component id across load() and reset(), so callers send only changes.
   */
  setFirmware(componentId: string, image: FirmwareImage | null): void
  start(speed: number): void
  pause(): void
  /** full power cycle: time → 0, every recorder cleared */
  reset(): void
  setSpeed(speed: number): void
  /** while paused: advance exactly `seconds` of sim time, then publish a frame */
  stepTime(seconds: number): void
  /** MCU debugger controls */
  mcuReset(componentId: string): void
  mcuHalt(componentId: string): void
  mcuResume(componentId: string): void
  mcuStep(componentId: string): void
  setRuntimeParam(componentId: string, key: string, value: ParamValue): void
  /**
   * Host → device serial bytes (the UART terminal). A module port (CH340
   * 'COM' …) transmits them on the module's pins; an MCU USART port
   * ('USART1' …) gets them through the terminal's virtual USB-TTL adapter
   * on its RX pin — real UART frames on the wire at the firmware's line
   * settings, never written into the peripheral (./uart-adapter.ts;
   * McuFrameInfo.uartRx says whether the RX net is free).
   */
  uartSend(componentId: string, port: string, bytes: Uint8Array): void
  setLogicChannels(channels: LogicChannelConfig[]): void
  query(q: HostQuery): Promise<HostQueryResult>
  dispose(): void
}

// ======================================================================
// Virtual serial ports of modules (comm-modules block — additive only).
//
// A module that bridges its UART pins to a host-side port — the CH340
// USB-to-TTL adapter ('COM': the PC's virtual COM port), the HC-05
// Bluetooth module ('BT': the paired phone) — exposes `serialPorts` on its
// DigitalDevice. The coordinator binds every port on load():
//   - module → host: the device calls `onHostRx(byte, t)` with the exact
//     virtual time it finished receiving the byte on its pins; the byte
//     reaches SimFrame.uart as { componentId: <module id>, port: <name> }
//     and every coordinator UART listener, exactly like an MCU USART byte;
//   - host → module: SimHost.uartSend(<module id>, <name>, bytes) calls
//     `hostSend`; the module transmits them on its pins (bit level, its own
//     baud) — so the UART terminal can open the port like any other.
// Nothing crosses by function call between the module and an MCU: the
// bytes always travel as waveforms on the nets.
// ======================================================================

/** A host-side serial port of a module (see the block comment above). */
export interface VirtualSerialPort {
  /** port name shown in the UART terminal ('COM', 'BT' …) */
  readonly name: string
  /** set by the coordinator: a byte the module delivers to the host and the virtual time (s) it completed */
  onHostRx: ((byte: number, t: number) => void) | null
  /** host → module: bytes typed in the terminal (sent from the present on) */
  hostSend(bytes: Uint8Array): void
  /** the line settings the module uses on its pins for this port */
  config(): UartLineConfig
}

/** A DigitalDevice that exposes virtual serial ports. */
export interface SerialPortDevice {
  readonly serialPorts: readonly VirtualSerialPort[]
}

/** The virtual serial ports of a device object (empty when it has none). */
export function serialPortsOf(device: unknown): readonly VirtualSerialPort[] {
  const ports = (device as Partial<SerialPortDevice> | null)?.serialPorts
  return Array.isArray(ports) ? ports : []
}

/** One module port as listed in a frame (UART terminal port list / header). */
export interface SerialPortInfo {
  componentId: string
  name: string
  config: UartLineConfig
}

/** Frame extension (declaration merge): the module ports of the current world. */
export interface SimFrame {
  /** virtual serial ports of modules (absent when the world has none) */
  serialPorts?: SerialPortInfo[]
}

// ======================================================================
// Diagnostics (perf block — additive only): the 效能診斷 overlay
// (src/ui/perf) derives MIPS per board from successive frames.
// ======================================================================

/** McuFrameInfo extension (declaration merge). */
export interface McuFrameInfo {
  /** instructions retired since the last power-on reset (set by the coordinator) */
  instructions?: number
}

// ======================================================================
// MCU inspector / instrument facts (fidelity block — additive only)
// ======================================================================

/** McuFrameInfo extension (declaration merge). */
export interface McuFrameInfo {
  /**
   * Peripherals the firmware has switched on, by their support-table names
   * (McuDebugState.clocked: RCC enable bits, self-clocked blocks once
   * started, the always-used core) — the MCU 周邊 tab's 「只看韌體用到的」
   * filter. Absent when the model does not report it.
   */
  clocked?: readonly string[]
  /**
   * AFIO_MAPR as the firmware programmed it (McuDebugState.afioMapr; SWJ_CFG
   * reads 0): which remappable USART / SPI / I²C / TIM functions sit on
   * their remapped pins (pin-function.ts activePinFunction). Absent = unknown.
   */
  mapr?: number
}

// ======================================================================
// Exception / fault facts (release QA SIM-F2 — additive only): the
// inspector learns that firmware sits in a fault handler while it runs,
// without a manual halt (McuDebugState.ipsr / faults, every frame).
// ======================================================================

/** A latched core fault as the SCB reports it (CoreFaultInfo, valid addresses only). */
export interface McuFrameFault {
  /** SCB CFSR (UFSR << 16 | BFSR << 8 | MMFSR) */
  cfsr: number
  /** SCB HFSR (FORCED, VECTTBL …) */
  hfsr: number
  /** SCB BFAR — present only while CFSR.BFARVALID (bit 15) says it holds the faulting address */
  bfar?: number
  /** SCB MMFAR — present only while CFSR.MMARVALID (bit 7) says it holds the faulting address */
  mmfar?: number
}

/** McuFrameInfo extension (declaration merge). */
export interface McuFrameInfo {
  /**
   * Active exception number (IPSR; 0 = thread mode, 3 = HardFault, 15 =
   * SysTick, 16 + n = IRQ n) when the frame was taken. Set by the
   * coordinator from McuDebugState.ipsr; absent when the model does not
   * report it.
   */
  exception?: number
  /**
   * The latched fault status (McuDebugState.faults) — present only while
   * CFSR or HFSR is non-zero, i.e. a fault happened since the last reset
   * (the bits are sticky until firmware clears them).
   */
  fault?: McuFrameFault
}

/** CFSR.MMARVALID — MMFAR holds the faulting address (PM0056 §4.4.14). */
export const CFSR_MMARVALID = 1 << 7
/** CFSR.BFARVALID — BFAR holds the faulting address (PM0056 §4.4.14). */
export const CFSR_BFARVALID = 1 << 15

/**
 * The frame's fault record for a core's fault registers: undefined while
 * CFSR and HFSR are both zero; BFAR / MMFAR only when their VALID bit is
 * set (otherwise they hold stale or reset values, never an address).
 */
export function frameFault(f: { cfsr: number; hfsr: number; bfar: number; mmfar: number } | undefined): McuFrameFault | undefined {
  if (!f) return undefined
  const cfsr = f.cfsr >>> 0
  const hfsr = f.hfsr >>> 0
  if (cfsr === 0 && hfsr === 0) return undefined
  const out: McuFrameFault = { cfsr, hfsr }
  if (cfsr & CFSR_BFARVALID) out.bfar = f.bfar >>> 0
  if (cfsr & CFSR_MMARVALID) out.mmfar = f.mmfar >>> 0
  return out
}

// ======================================================================
// The UART terminal's USB-TTL adapter (release close-out UART-RX —
// additive only): bytes typed for an MCU USART travel as UART frames on its
// RX pin (./uart-adapter.ts). Every MCU frame says, per USART, which pin
// that is and whether the adapter may drive it.
// ======================================================================

/**
 * What the terminal's adapter finds on a USART's RX net:
 *   'free'    nothing else drives it: typed bytes go out as frames on it
 *   'driven'  another output drives it (`by`): the adapter stays off
 *   'rail'    it is wired to a supply rail or ground: the adapter stays off
 *   'output'  the MCU's own pin is an output right now (the firmware uses
 *             it as a GPIO / another function, not as this USART's RX)
 *   'absent'  the pin is not on the board's headers / not connected (a
 *             remap onto a pin the package lacks)
 */
export type UartRxState = 'free' | 'driven' | 'rail' | 'output' | 'absent'

/** The output that drives a USART's RX net (UartRxInfo.by). */
export interface UartRxDriver {
  /** the driving part ('CH1', 'U1' …) */
  componentId: string
  /** its catalog pin ('TXD', 'PA2', '+' …) */
  pin: string
  /** the part the signal passes through on its way (a level shifter 'LS1') */
  via?: string
  /** the driver's own host-side serial port, when it has one ('COM', 'BT') — the terminal offers it */
  port?: string
}

/** One USART's RX wire as the terminal's adapter sees it (McuFrameInfo.uartRx). */
export interface UartRxInfo {
  /** 'USART1' … */
  port: string
  /** the RX pin for the current AFIO remap ('PA10', 'PB7' …) */
  pin: string
  state: UartRxState
  by?: UartRxDriver
  /** the adapter is plugged into this pin (idles high between frames) */
  attached: boolean
  /** bytes not yet completely on the wire */
  queued: number
}

/** McuFrameInfo extension (declaration merge). */
export interface McuFrameInfo {
  /** every USART's RX wire (set by the coordinator for boards on the breadboard) */
  uartRx?: UartRxInfo[]
}
