/**
 * Embedded-lab store contract (zustand, src/state/lab.ts). CONTRACT FILE.
 *
 * Holds everything the embedded platform adds OUTSIDE the undoable circuit
 * document (`AppState.layout` stays the single source of truth for parts and
 * wires, exactly as before):
 *   - firmware bindings (component id → firmware record; blobs in IndexedDB),
 *   - live MCU / perf info from SimFrames (≤ 10 Hz React updates),
 *   - instrument configuration (logic-analyzer channels, terminal options),
 *   - workspace layout preferences and library favorites,
 *   - project-file import/export (envelope around the layout).
 *
 * High-rate data (UART bytes, log lines, logic/scope samples) never lives in
 * React state: it is kept in module-level ring buffers exposed through the
 * accessor functions below, with a `*Version` counter in the store that
 * panels watch to know when to redraw.
 */
import type { FirmwareFormat } from '../mcu/firmware'
import type {
  HostQueryResult,
  LogicCapture,
  LogicChannelConfig,
  McuFrameInfo,
  ScopeCapture,
  SimFrame,
  SimLogEntry,
} from '../sim/coordinator/api'
import type { McuDebugState, PeripheralSupport } from '../mcu/mcu-api'

export interface FirmwareRecord {
  componentId: string
  name: string
  format: FirmwareFormat
  sha256: string
  size: number
  /** ms since epoch */
  loadedAt: number
  /** ELF entry / BIN load address etc. for display */
  description?: string
  warnings: string[]
}

export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf'

export interface TerminalPrefs {
  lineEnding: LineEnding
  /** show bytes as hex instead of text */
  hex: boolean
  /** echo sent text locally */
  localEcho: boolean
  timestamps: boolean
  /**
   * clear the board's terminal transcripts when new firmware is loaded
   * (otherwise a dim separator line marks the load). Additive (UX IS-8);
   * absent in older stored prefs = false.
   */
  clearOnLoad?: boolean
}

/**
 * When a run of a port's received bytes arrived (UX IS-8). The ring keeps
 * no per-byte times; every chunk the lab appends is stamped with the
 * simulation-time window of the frame that delivered it: the bytes were
 * received in (t0, t1].
 */
export interface UartChunk {
  /** stream offset of the chunk's first byte (bytes ever received on the port, 0-based) */
  at: number
  /** chunk length in bytes */
  n: number
  t0: number
  t1: number
  /** locally echoed sent bytes (terminal localEcho) */
  echo?: boolean
}

/** A firmware load or MCU reset, for the terminal's separator lines (UX IS-8). */
export interface TerminalMark {
  /** increasing id */
  id: number
  componentId: string
  kind: 'load' | 'reset'
  /** simulation time of the event (s) */
  t: number
  /** firmware file name / short SHA-256 (loads) */
  name?: string
  sha?: string
  /** port name → that port's stream offset at the event (the separator goes before this byte) */
  offsets: Record<string, number>
}

/**
 * The time the instruments share (UX IS-8): the logic analyzer draws it as
 * a dashed line, the scope when it falls inside its window; set by marker A,
 * a UART / log "show in the logic analyzer" and similar. null = none.
 */
export interface LabCursor {
  t: number | null
}

/** The instrument tray's tabs; 'measure' = 量測, the meters' readings (UX IS-19). */
export type TrayTab = 'uart' | 'logic' | 'scope' | 'log' | 'measure'

/**
 * Logic-analyzer VIEW settings that persist with the lab (localStorage
 * 'bb.logicView') and travel in project files (instruments.logicView):
 * protocol-decoder instances and trigger settings. The store keeps them as
 * OPAQUE JSON — their shape belongs to the analyzer UI
 * (src/ui/embedded/logic-decoders.ts LogicDecoderConfig[],
 * src/ui/embedded/instruments/la-config.ts LogicTriggerPrefs), which
 * sanitizes them on use. The store only guarantees plain JSON (objects,
 * arrays, strings, finite numbers, booleans, null), the caps below and the
 * envelope version `v` (a newer version is ignored, never half-read).
 */
export interface LogicViewSettings {
  v: 1
  /** decoder instances, in display order (≤ 32 plain JSON objects) */
  decoders: Record<string, unknown>[]
  /** trigger settings (a plain JSON object), null = the analyzer's defaults */
  trigger: Record<string, unknown> | null
}

export interface WorkspacePrefs {
  v: 1
  /** desktop workspace enabled (wide screens only; phones always use sheets) */
  enabled: boolean
  left: { open: boolean; width: number; tab: 'parts' | 'examples' | 'lessons' }
  right: { open: boolean; width: number }
  tray: { open: boolean; height: number; tab: TrayTab }
}

export interface LabState {
  // ---- firmware (persisted: records in localStorage 'bb.firmware', bytes in IndexedDB) ----
  firmware: Record<string, FirmwareRecord>
  /** parse + validate + store + send to the sim host; resets that MCU */
  loadFirmware(componentId: string, file: { name: string; bytes: Uint8Array }, opts?: { binBase?: number }): Promise<{ ok: boolean; error?: string; warnings?: string[] }>
  clearFirmware(componentId: string): void

  // ---- live info from SimFrames ----
  mcus: Record<string, McuFrameInfo>
  perf: SimFrame['perf'] | null
  uartVersion: number
  logVersion: number

  // ---- MCU debugger controls (forwarded to the SimHost) ----
  mcuReset(componentId: string): void
  mcuHalt(componentId: string): void
  mcuResume(componentId: string): void
  mcuStep(componentId: string): void
  queryMcuDebug(componentId: string): Promise<McuDebugState | null>
  queryMcuSupport(componentId: string): Promise<PeripheralSupport[]>
  readMcuMemory(componentId: string, addr: number, length: number): Promise<Uint8Array | null>

  // ---- UART terminal ----
  terminal: TerminalPrefs
  setTerminal(p: Partial<TerminalPrefs>): void
  /** encode `text` + line ending and send to the MCU's USART (peripheral-level tap) */
  sendUart(componentId: string, port: string, text: string): void
  sendUartBytes(componentId: string, port: string, bytes: Uint8Array): void
  clearUart(componentId: string, port: string): void

  // ---- logic analyzer / scope ----
  logicChannels: LogicChannelConfig[]
  setLogicChannels(channels: LogicChannelConfig[]): void
  queryLogic(t0: number, t1: number): Promise<LogicCapture>
  queryScope(t0: number, t1: number, maxPoints?: number): Promise<ScopeCapture>
  /** decoder instances + trigger settings of the logic analyzer (persisted; in project files) */
  logicView: LogicViewSettings
  /** replace decoders and/or trigger (sanitized to plain JSON, then persisted) */
  setLogicView(p: Partial<Pick<LogicViewSettings, 'decoders' | 'trigger'>>): void
  /** the shared instrument time cursor (UX IS-8, not persisted) */
  labCursor: LabCursor
  setLabCursor(t: number | null): void
  /**
   * Oscilloscope front-panel preset carried by the last imported project /
   * example (envelope `instruments.scope`, opaque JSON — the scope UI
   * sanitizes it); `seq` bumps on every import that carries one, or that
   * has scope probes but no preset (`settings` = {}: the scope sets itself
   * up from the signal). Additive (UX IS-2).
   */
  scopePreset: { seq: number; settings: Record<string, unknown> } | null

  // ---- workspace & library ----
  workspace: WorkspacePrefs
  setWorkspace(p: Partial<Omit<WorkspacePrefs, 'v'>>): void
  favorites: string[]
  toggleFavorite(type: string): void

  // ---- project files ----
  /** JSON text of an 'ohmlet-project' envelope (layout + embedded firmware + workspace) */
  exportProject(): Promise<string>
  /** accepts an envelope or a bare legacy CircuitLayout */
  importProject(text: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }>
}

/** Module-level buffers (implemented in src/state/lab.ts). */
export interface LabBuffers {
  /** terminal transcript of `componentId`/`port`: received bytes plus locally echoed sent bytes when terminal.localEcho is on (capped, oldest dropped) */
  uartText(componentId: string, port: string): string
  uartBytes(componentId: string, port: string): Uint8Array
  /** ports that have received anything: [{componentId, port}] */
  uartPorts(): { componentId: string; port: string }[]
  /** recent simulation log (capped) */
  log(): readonly SimLogEntry[]
  /** stream offset of the first byte uartBytes() still holds (older bytes were dropped / cleared) */
  uartFirstOffset(componentId: string, port: string): number
  /** arrival stamps of the bytes uartBytes() holds, oldest first (UX IS-8) */
  uartChunks(componentId: string, port: string): readonly UartChunk[]
  /** firmware loads and MCU resets since the last power cycle, oldest first (UX IS-8) */
  terminalMarks(): readonly TerminalMark[]
}

export type { HostQueryResult }
