/**
 * Embedded-lab store (zustand) — implements the LabState / LabBuffers
 * contract of src/state/lab-types.ts. Everything the embedded platform adds
 * OUTSIDE the undoable circuit document lives here; AppState.layout stays the
 * single source of truth for parts and wires.
 *
 * The SimHost belongs to the app store (src/state/store.ts); this store
 * follows its lifecycle through `onSimHostEvent`:
 *  - 'loaded' (every host.load, incl. the host's boot and undo/redo): firmware
 *    bindings whose board left the document are dropped (undo of that delete
 *    restores them), then the host's firmware is synced to the bindings — a
 *    freshly booted host receives every image; afterwards only differences
 *    are sent, since setFirmware power-on-resets the MCU (see syncHostFirmware);
 *  - 'frame': UART bytes and log lines go to module-level ring buffers (never
 *    React state); MCU info / perf snapshots and the *Version counters reach
 *    React at ≤ 10 Hz;
 *  - 'reset': a power cycle — terminals and log start empty, like the scope.
 *
 * Persistence (all per browser, all tolerant of missing/corrupt storage):
 *  - firmware binding records  → localStorage 'bb.firmware' (component id →
 *    FirmwareRecord, plus `binBase` for raw .bin images),
 *  - firmware BYTES            → IndexedDB 'ohmlet'/'firmware' by SHA-256
 *    (src/state/firmware-store.ts; in-memory where IndexedDB is missing),
 *  - workspace layout          → 'bb.workspace' (only the user's overrides
 *    are stored; every read deep-merges them over the defaults, because the
 *    stored object may be partial, e.g. {"v":1,"enabled":false}),
 *  - library favorites         → 'bb.favorites',
 *  - terminal prefs            → 'bb.terminal',
 *  - logic-analyzer channels   → 'bb.instruments',
 *  - logic-analyzer decoders + trigger (opaque, versioned LogicViewSettings)
 *                              → 'bb.logicView' (first boot: migrated from the
 *    analyzer's former 'bb.logicDecoders' / 'bb.logicTrigger'); both also
 *    travel in project files (instruments.logicChannels / .logicView).
 * Firmware is re-parsed from its bytes on boot (never trusted from a cache)
 * and its SHA-256 re-checked before it is bound again.
 */
import { create } from 'zustand'
import type { CircuitLayout, ComponentInstance } from '../model/types'
import { getEntry } from '../model/catalog'
import type { FirmwareFormat, FirmwareImage, LoadResult } from '../mcu/firmware'
import type { PeripheralSupport } from '../mcu/mcu-api'
import type {
  HostQuery,
  HostQueryResult,
  LogicCapture,
  LogicChannelConfig,
  McuFrameInfo,
  ScopeCapture,
  SerialPortInfo,
  SimFrame,
  SimHost,
  SimLogEntry,
} from '../sim/coordinator/api'
// The ONE import of the firmware loader implementation (ELF / BIN / Intel HEX).
import { loadFirmwareFile } from '../mcu/loader'
import type {
  FirmwareRecord,
  LabBuffers,
  LabState,
  LineEnding,
  LogicViewSettings,
  TerminalMark,
  TerminalPrefs,
  TrayTab,
  UartChunk,
  WorkspacePrefs,
} from './lab-types'
import {
  getSimHost,
  layoutLoadCount,
  onSimHostEvent,
  peekSimHost,
  resumeAfterDebugHalt,
  stripTransientParams,
  useStore,
} from './store'
import { firmwareBlobStore, isSha256Hex, sha256Hex } from './firmware-store'
import { whileAutoRunHeld } from './run-gate'
import {
  emptyLogicView,
  parseProject,
  sanitizeLogicChannels,
  sanitizeLogicView,
  serializeProject,
  type ProjectContents,
} from './project'

// Module serial ports — additive extension of the LabState contract
// (declaration merge, like SimFrame.serialPorts in the coordinator API).
declare module './lab-types' {
  interface LabState {
    /**
     * Virtual serial ports of the modules in the current world (CH340
     * 'COM', HC-05 'BT' …) with the line settings each uses on its pins,
     * from SimFrame.serialPorts: known from the first frame after a load,
     * before any byte arrives, so the UART terminal can list and open them.
     * Updated with the ≤ 10 Hz React pushes, only when the list changes.
     */
    serialPorts: readonly SerialPortInfo[]
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LS_FIRMWARE = 'bb.firmware'
export const LS_WORKSPACE = 'bb.workspace'
export const LS_FAVORITES = 'bb.favorites'
export const LS_TERMINAL = 'bb.terminal'
export const LS_INSTRUMENTS = 'bb.instruments'
/** logic-analyzer decoders + trigger (LogicViewSettings) */
export const LS_LOGIC_VIEW = 'bb.logicView'
/** where the analyzer kept them before the lab store did (src/ui/embedded/instruments/la-config.ts) */
const LS_LEGACY_DECODERS = 'bb.logicDecoders'
const LS_LEGACY_TRIGGER = 'bb.logicTrigger'

/** The desktop workspace needs room for three panels AND a precise pointer (review §10.7). */
export const WORKSPACE_MEDIA_QUERY = '(min-width: 1100px) and (pointer: fine)'

/** per-port terminal history; the oldest bytes are dropped beyond this */
export const UART_BUFFER_BYTES = 64 * 1024
/** simulation log entries kept; the oldest are dropped beyond this */
export const LOG_CAPACITY = 2000

const REACT_PUSH_MS = 100 // ~10 Hz, like the app store
const PANEL_WIDTH_RANGE: [number, number] = [160, 960]
const TRAY_HEIGHT_RANGE: [number, number] = [96, 960]
const LEFT_TABS: readonly WorkspacePrefs['left']['tab'][] = ['parts', 'examples', 'lessons']
const TRAY_TABS: readonly TrayTab[] = ['uart', 'logic', 'scope', 'log', 'measure']
const LINE_ENDINGS: Record<LineEnding, string> = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' }
const FIRMWARE_FORMATS: readonly FirmwareFormat[] = ['elf', 'bin', 'hex']
/** undo can bring back at most this many recently deleted boards' firmware */
const DETACHED_CAP = 16

const TERMINAL_DEFAULTS: TerminalPrefs = { lineEnding: 'lf', hex: false, localEcho: false, timestamps: false }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type RawObject = Record<string, unknown>

function isObject(v: unknown): v is RawObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // no window / storage disabled
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage full / unavailable — the preference just won't persist */
  }
}

function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* unavailable */
  }
}

function lsGetJson(key: string): unknown {
  const raw = lsGet(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined // corrupted entry: treated as absent
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, v))
}

const defaultLabNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()
let labNow: () => number = defaultLabNow

// ---------------------------------------------------------------------------
// Workspace preferences (pure; exported for tests)
// ---------------------------------------------------------------------------

/** Field-wise subset of WorkspacePrefs — what the user explicitly changed. */
export interface WorkspaceOverrides {
  enabled?: boolean
  left?: Partial<WorkspacePrefs['left']>
  right?: Partial<WorkspacePrefs['right']>
  tray?: Partial<WorkspacePrefs['tray']>
}

function wideScreen(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(WORKSPACE_MEDIA_QUERY).matches
    )
  } catch {
    return false
  }
}

/**
 * Defaults; `enabled` follows the device (wide screen + fine pointer) unless
 * overridden. The instrument tray's default follows the CIRCUIT (UX IS-5):
 * collapsed to its tab bar when the document has nothing the tray measures
 * (an empty board, an analog lesson — the 3D scene gets the room), open when
 * it has a microcontroller or a scope / logic probe. The circuit watcher at
 * the bottom of this file opens / collapses it on later changes.
 */
export function workspaceDefaults(): WorkspacePrefs {
  return {
    v: 1,
    enabled: wideScreen(),
    left: { open: true, width: 300, tab: 'parts' },
    right: { open: true, width: 340 },
    tray: { open: circuitTrayTab() !== null, height: 240, tab: circuitTrayTab() ?? 'uart' },
  }
}

/** The tray tab the current document calls for (null when it has nothing, or is unknown). */
function circuitTrayTab(): TrayTab | null {
  try {
    return trayTabFor(useStore.getState().layout, [])
  } catch {
    return null // during module init / without a document
  }
}

/**
 * The well-typed fields of an untrusted, possibly PARTIAL workspace object
 * (localStorage, a project file). Wrong-typed fields are dropped, sizes are
 * clamped to sane panel ranges, unknown tabs ignored.
 */
export function sanitizeWorkspaceOverrides(raw: unknown): WorkspaceOverrides {
  const out: WorkspaceOverrides = {}
  if (!isObject(raw)) return out
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (isObject(raw.left)) {
    const l: Partial<WorkspacePrefs['left']> = {}
    if (typeof raw.left.open === 'boolean') l.open = raw.left.open
    if (num(raw.left.width)) l.width = clamp(raw.left.width, PANEL_WIDTH_RANGE)
    if (LEFT_TABS.includes(raw.left.tab as WorkspacePrefs['left']['tab'])) {
      l.tab = raw.left.tab as WorkspacePrefs['left']['tab']
    }
    if (Object.keys(l).length > 0) out.left = l
  }
  if (isObject(raw.right)) {
    const r: Partial<WorkspacePrefs['right']> = {}
    if (typeof raw.right.open === 'boolean') r.open = raw.right.open
    if (num(raw.right.width)) r.width = clamp(raw.right.width, PANEL_WIDTH_RANGE)
    if (Object.keys(r).length > 0) out.right = r
  }
  if (isObject(raw.tray)) {
    const t: Partial<WorkspacePrefs['tray']> = {}
    if (typeof raw.tray.open === 'boolean') t.open = raw.tray.open
    if (num(raw.tray.height)) t.height = clamp(raw.tray.height, TRAY_HEIGHT_RANGE)
    if (TRAY_TABS.includes(raw.tray.tab as TrayTab)) t.tab = raw.tray.tab as TrayTab
    if (Object.keys(t).length > 0) out.tray = t
  }
  return out
}

/** `over` layered field-by-field onto `base`. */
export function mergeWorkspaceOverrides(base: WorkspaceOverrides, over: WorkspaceOverrides): WorkspaceOverrides {
  const out: WorkspaceOverrides = { ...base }
  if (over.enabled !== undefined) out.enabled = over.enabled
  if (over.left) out.left = { ...base.left, ...over.left }
  if (over.right) out.right = { ...base.right, ...over.right }
  if (over.tray) out.tray = { ...base.tray, ...over.tray }
  return out
}

/** Complete prefs: overrides deep-merged over `defaults`. */
export function resolveWorkspace(defaults: WorkspacePrefs, over: WorkspaceOverrides): WorkspacePrefs {
  return {
    v: 1,
    enabled: over.enabled ?? defaults.enabled,
    left: { ...defaults.left, ...over.left },
    right: { ...defaults.right, ...over.right },
    tray: { ...defaults.tray, ...over.tray },
  }
}

let workspaceOverrides: WorkspaceOverrides = {}

function loadWorkspace(): WorkspacePrefs {
  const raw = lsGetJson(LS_WORKSPACE)
  // only a v1 object (or a versionless one) is understood; anything else = defaults
  workspaceOverrides = isObject(raw) && (raw.v === undefined || raw.v === 1) ? sanitizeWorkspaceOverrides(raw) : {}
  return resolveWorkspace(workspaceDefaults(), workspaceOverrides)
}

/** Layer `over` onto the stored overrides, publish the resolved prefs, persist. */
function applyWorkspaceOverrides(over: WorkspaceOverrides): void {
  workspaceOverrides = mergeWorkspaceOverrides(workspaceOverrides, over)
  useLab.setState({ workspace: resolveWorkspace(workspaceDefaults(), workspaceOverrides) })
  lsSet(LS_WORKSPACE, JSON.stringify({ v: 1, ...workspaceOverrides }))
}

// ---------------------------------------------------------------------------
// Terminal / favorites / instruments persistence
// ---------------------------------------------------------------------------

/** Bytes the terminal sends for one line: UTF-8 text + the chosen line ending. */
export function encodeTerminalLine(text: string, ending: LineEnding): Uint8Array {
  return new TextEncoder().encode(text + (LINE_ENDINGS[ending] ?? ''))
}

function sanitizeTerminal(raw: unknown, base: TerminalPrefs): TerminalPrefs {
  const out = { ...base }
  if (!isObject(raw)) return out
  if (typeof raw.lineEnding === 'string' && raw.lineEnding in LINE_ENDINGS) out.lineEnding = raw.lineEnding as LineEnding
  if (typeof raw.hex === 'boolean') out.hex = raw.hex
  if (typeof raw.localEcho === 'boolean') out.localEcho = raw.localEcho
  if (typeof raw.timestamps === 'boolean') out.timestamps = raw.timestamps
  if (typeof raw.clearOnLoad === 'boolean') out.clearOnLoad = raw.clearOnLoad
  return out
}

function loadTerminal(): TerminalPrefs {
  return sanitizeTerminal(lsGetJson(LS_TERMINAL), TERMINAL_DEFAULTS)
}

function loadFavorites(): string[] {
  const raw = lsGetJson(LS_FAVORITES)
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((t): t is string => typeof t === 'string' && t.length > 0))]
}

function loadLogicChannels(): LogicChannelConfig[] {
  const raw = lsGetJson(LS_INSTRUMENTS)
  if (!isObject(raw)) return []
  return sanitizeLogicChannels(raw.logicChannels ?? []).channels
}

/**
 * Logic-analyzer view settings: 'bb.logicView' — the single source of truth
 * since UX IS-3. One-time migration of the analyzer's former keys
 * 'bb.logicDecoders' ({v, decoders}) and 'bb.logicTrigger' ({v, …trigger}):
 * when the store holds no decoders (no 'bb.logicView' yet, or an empty one
 * written while the analyzer still kept its own copy) and the legacy key
 * holds some, they move into the store (the legacy trigger too, unless the
 * store has one); the legacy keys are removed once read, so the migration
 * never runs twice.
 */
function loadLogicView(): LogicViewSettings {
  const stored = lsGetJson(LS_LOGIC_VIEW)
  const view = stored !== undefined ? sanitizeLogicView(stored).view ?? emptyLogicView() : emptyLogicView()
  const dec = lsGetJson(LS_LEGACY_DECODERS)
  const trig = lsGetJson(LS_LEGACY_TRIGGER)
  if (dec === undefined && trig === undefined) return view
  const legacyDecoders = isObject(dec) && Array.isArray(dec.decoders) ? dec.decoders : []
  let legacyTrigger: Record<string, unknown> | null = null
  if (isObject(trig)) {
    const { v: _v, ...rest } = trig
    legacyTrigger = rest
  }
  let next = view
  if (stored === undefined || (view.decoders.length === 0 && legacyDecoders.length > 0)) {
    next =
      sanitizeLogicView({
        v: 1,
        decoders: view.decoders.length > 0 ? view.decoders : legacyDecoders,
        trigger: view.trigger ?? legacyTrigger,
      }).view ?? view
    lsSet(LS_LOGIC_VIEW, JSON.stringify(next))
  }
  lsRemove(LS_LEGACY_DECODERS)
  lsRemove(LS_LEGACY_TRIGGER)
  return next
}

/**
 * `instruments.scope` of a project text: a flat object of plain values
 * (string / finite number / boolean / null, ≤ 16 keys), or null. The scope
 * UI sanitizes the values themselves (src/ui/embedded/instruments/
 * scope-settings.ts).
 */
function rawScopePreset(text: string): Record<string, unknown> | null {
  let env: unknown
  try {
    env = JSON.parse(text)
  } catch {
    return null
  }
  const scope = isObject(env) && isObject(env.instruments) ? env.instruments.scope : undefined
  if (!isObject(scope)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(scope).slice(0, 16)) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

// ---------------------------------------------------------------------------
// Ring buffers (module level — never React state)
// ---------------------------------------------------------------------------

/**
 * Fixed-capacity byte FIFO that drops its oldest bytes, with a cached text
 * view. `total` counts every byte ever pushed (the stream offset), so
 * arrival stamps and terminal marks keep pointing at the right byte after
 * the ring drops or clears old ones.
 */
class ByteRing {
  private readonly buf: Uint8Array
  private start = 0
  private len = 0
  private textCache: string | null = ''
  private static decoder: TextDecoder | null = null
  /** bytes ever pushed (stream offset of the next byte) */
  total = 0
  /** arrival stamps of the retained bytes, oldest first */
  chunks: UartChunk[] = []

  constructor(readonly capacity: number) {
    this.buf = new Uint8Array(capacity)
  }

  /** stream offset of the oldest retained byte */
  get first(): number {
    return this.total - this.len
  }

  push(bytes: ArrayLike<number>, stamp?: { t0: number; t1: number; echo?: boolean }): void {
    const n = bytes.length
    if (n === 0) return
    const cap = this.capacity
    if (stamp) {
      const c: UartChunk = { at: this.total, n, t0: stamp.t0, t1: stamp.t1 }
      if (stamp.echo) c.echo = true
      this.chunks.push(c)
    }
    this.total += n
    // only the newest `cap` bytes can survive
    const from = n > cap ? n - cap : 0
    for (let i = from; i < n; i++) {
      const at = (this.start + this.len) % cap
      this.buf[at] = bytes[i] & 0xff
      if (this.len < cap) this.len++
      else this.start = (this.start + 1) % cap
    }
    this.trimChunks()
    this.textCache = null
  }

  private trimChunks(): void {
    const first = this.first
    let k = 0
    while (k < this.chunks.length && this.chunks[k].at + this.chunks[k].n <= first) k++
    if (k > 0) this.chunks.splice(0, k)
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.len)
    const first = Math.min(this.len, this.capacity - this.start)
    out.set(this.buf.subarray(this.start, this.start + first), 0)
    if (first < this.len) out.set(this.buf.subarray(0, this.len - first), first)
    return out
  }

  text(): string {
    if (this.textCache === null) {
      // UTF-8, non-fatal: a sequence cut by the ring's oldest-byte drop shows as U+FFFD
      ByteRing.decoder ??= new TextDecoder('utf-8')
      this.textCache = ByteRing.decoder.decode(this.bytes())
    }
    return this.textCache
  }

  clear(): void {
    this.start = 0
    this.len = 0
    this.chunks = []
    this.textCache = ''
  }
}

const uartRings = new Map<string, { componentId: string; port: string; ring: ByteRing }>()
const portKey = (componentId: string, port: string): string => `${componentId}\u0000${port}`

function ringFor(componentId: string, port: string): ByteRing {
  const key = portKey(componentId, port)
  let e = uartRings.get(key)
  if (!e) {
    e = { componentId, port, ring: new ByteRing(UART_BUFFER_BYTES) }
    uartRings.set(key, e)
  }
  return e.ring
}

/** sim time of the previous frame: a frame's UART bytes arrived in (lastFrameTime, frame.time] */
let lastFrameTime = 0
/** firmware loads / MCU resets for the terminal separators (since the last power cycle) */
let terminalMarks: TerminalMark[] = []
let terminalMarksSnapshot: readonly TerminalMark[] | null = null
let markSeq = 0
const MAX_TERMINAL_MARKS = 200

/**
 * Remember a firmware load / MCU reset of `componentId` at the current
 * stream offset of each of its ports (the separator goes before the next
 * byte). With terminal.clearOnLoad a load clears the board's transcripts.
 */
function addTerminalMark(componentId: string, kind: TerminalMark['kind'], extra: { name?: string; sha?: string } = {}): void {
  if (kind === 'load' && useLab.getState().terminal.clearOnLoad) {
    for (const e of uartRings.values()) if (e.componentId === componentId) e.ring.clear()
    terminalMarks = terminalMarks.filter((m) => m.componentId !== componentId)
  }
  const offsets: Record<string, number> = {}
  for (const e of uartRings.values()) if (e.componentId === componentId) offsets[e.port] = e.ring.total
  const mark: TerminalMark = { id: ++markSeq, componentId, kind, t: useStore.getState().simTime, offsets }
  if (extra.name !== undefined) mark.name = extra.name
  if (extra.sha !== undefined) mark.sha = extra.sha
  terminalMarks.push(mark)
  if (terminalMarks.length > MAX_TERMINAL_MARKS) terminalMarks.splice(0, terminalMarks.length - MAX_TERMINAL_MARKS)
  terminalMarksSnapshot = null
  uartDirty = true
  schedulePush(true)
}

let logEntries: SimLogEntry[] = []
let logSnapshot: readonly SimLogEntry[] | null = null

function appendLog(entries: readonly SimLogEntry[]): void {
  if (entries.length === 0) return
  for (const e of entries) logEntries.push(e)
  if (logEntries.length > LOG_CAPACITY) logEntries.splice(0, logEntries.length - LOG_CAPACITY)
  logSnapshot = null
  logDirty = true
}

/** A message from the lab itself (restore failures, terminal without a host…). */
function labLog(level: SimLogEntry['level'], message: string, componentId?: string): void {
  const entry: SimLogEntry = { time: useStore.getState().simTime, level, source: 'lab', message }
  if (componentId) entry.componentId = componentId
  appendLog([entry])
  schedulePush(true)
}

export const labBuffers: LabBuffers = {
  uartText(componentId, port) {
    return uartRings.get(portKey(componentId, port))?.ring.text() ?? ''
  },
  uartBytes(componentId, port) {
    return uartRings.get(portKey(componentId, port))?.ring.bytes() ?? new Uint8Array(0)
  },
  uartPorts() {
    return [...uartRings.values()].map(({ componentId, port }) => ({ componentId, port }))
  },
  log() {
    logSnapshot ??= logEntries.slice()
    return logSnapshot
  },
  uartFirstOffset(componentId, port) {
    return uartRings.get(portKey(componentId, port))?.ring.first ?? 0
  },
  uartChunks(componentId, port) {
    return uartRings.get(portKey(componentId, port))?.ring.chunks.slice() ?? []
  },
  terminalMarks() {
    terminalMarksSnapshot ??= terminalMarks.slice()
    return terminalMarksSnapshot
  },
}

// ---------------------------------------------------------------------------
// Frame consumption + ≤ 10 Hz React pushes
// ---------------------------------------------------------------------------

let uartDirty = false
let logDirty = false
let snapshotDirty = false
let latestMcus: McuFrameInfo[] = []
let latestPerf: SimFrame['perf'] | null = null
let lastPushMs = Number.NEGATIVE_INFINITY
let pushTimer: ReturnType<typeof setTimeout> | null = null
const NO_SERIAL_PORTS: readonly SerialPortInfo[] = []
let latestSerialPorts: readonly SerialPortInfo[] = NO_SERIAL_PORTS
let serialPortsDirty = false

/** Same ports with the same line settings (frames carry a fresh array every time). */
function sameSerialPorts(a: readonly SerialPortInfo[], b: readonly SerialPortInfo[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.componentId !== y.componentId || x.name !== y.name) return false
    const c = x.config
    const d = y.config
    if (c.enabled !== d.enabled || c.baud !== d.baud || c.dataBits !== d.dataBits) return false
    if (c.parity !== d.parity || c.stopBits !== d.stopBits) return false
  }
  return true
}

function flushPush(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (!uartDirty && !logDirty && !snapshotDirty && !serialPortsDirty) return
  lastPushMs = labNow()
  const patch: Partial<LabState> = {}
  if (snapshotDirty) {
    const mcus: Record<string, McuFrameInfo> = {}
    for (const m of latestMcus) mcus[m.componentId] = m
    patch.mcus = mcus
    patch.perf = latestPerf
  }
  if (serialPortsDirty) patch.serialPorts = latestSerialPorts
  const s = useLab.getState()
  if (uartDirty) patch.uartVersion = s.uartVersion + 1
  if (logDirty) patch.logVersion = s.logVersion + 1
  uartDirty = logDirty = snapshotDirty = serialPortsDirty = false
  useLab.setState(patch)
}

/**
 * Push now when `immediate` (paused frames, user actions) or the 100 ms
 * window has elapsed; otherwise a trailing push at the window's end, so the
 * last data of a burst always reaches React.
 */
function schedulePush(immediate: boolean): void {
  const elapsed = labNow() - lastPushMs
  if (immediate || elapsed >= REACT_PUSH_MS) {
    flushPush()
    return
  }
  if (pushTimer === null) pushTimer = setTimeout(flushPush, REACT_PUSH_MS - elapsed)
}

function onFrame(f: SimFrame, current: boolean): void {
  // the frame's bytes arrived after the previous frame (time restarts on a power cycle)
  const t1 = Number.isFinite(f.time) ? f.time : lastFrameTime
  const t0 = t1 >= lastFrameTime ? lastFrameTime : 0
  lastFrameTime = t1
  // events are real even from an older document revision of this epoch
  for (const u of f.uart) {
    if (u.bytes.length === 0) continue
    ringFor(u.componentId, u.port).push(u.bytes, { t0, t1 })
    uartDirty = true
  }
  appendLog(f.log)
  if (current) {
    latestMcus = f.mcus
    latestPerf = f.perf
    snapshotDirty = true
    const ports = f.serialPorts ?? NO_SERIAL_PORTS
    if (!sameSerialPorts(ports, latestSerialPorts)) {
      latestSerialPorts = ports.length === 0 ? NO_SERIAL_PORTS : ports
      serialPortsDirty = true
    }
  }
  schedulePush(!f.running)
}

function onReset(): void {
  for (const e of uartRings.values()) e.ring.clear()
  lastFrameTime = 0
  terminalMarks = []
  terminalMarksSnapshot = null
  logEntries = []
  logSnapshot = null
  latestMcus = []
  latestPerf = null
  uartDirty = logDirty = snapshotDirty = true
  flushPush()
}

// ---------------------------------------------------------------------------
// Firmware bindings
// ---------------------------------------------------------------------------

interface Binding {
  record: FirmwareRecord
  image: FirmwareImage
  /** BIN only: the load address chosen by the user (absent = loader default) */
  binBase?: number
}

/** A persisted record (FirmwareRecord + the BIN base needed to re-parse it). */
interface StoredRecord extends FirmwareRecord {
  binBase?: number
}

/** component id → live binding (state.firmware mirrors the records) */
const bindings = new Map<string, Binding>()
/** last component instance seen for each bound board (identity = "the same board") */
const lastInstance = new Map<string, ComponentInstance>()
/**
 * Bindings of boards that left the document, with the exact instance they
 * were bound to: undo/redo restores immutable component references, so the
 * SAME object reappearing means the user brought that board back. A new
 * board that merely reuses the id is a different object and starts empty.
 */
const detached = new Map<string, Binding & { instance: ComponentInstance | undefined }>()
/**
 * One physical MCU board across its edits. Every edit (a drag, a rotation,
 * moving the whole circuit, growing the grid) replaces the board's immutable
 * object with a new one of the same id: that copy continues the lineage of
 * the object it replaced. A board a wholesale load (store.loadLayout — a
 * lesson circuit, an example, an import) brings starts a lineage of its own.
 *
 * `displaced`: a load took this board off while it had NO firmware. When undo
 * brings any object of the lineage back, a binding made since then on another
 * board under the same id (the loaded one) is not this board's: it is
 * detached (redo restores it with that board), so 〔復原〕 gives the learner's
 * board back as it was. Firmware loaded onto ANY copy of the board clears the
 * flag — it is the learner's own, and follows the board through its edits
 * and their undo as before.
 */
interface BoardLineage {
  displaced: boolean
}
let lineages = new WeakMap<ComponentInstance, BoardLineage>()
/**
 * Every component object a layout this module saw held. Undo / redo only
 * bring back such objects (history keeps the immutable references), so an
 * object never seen before is new: an edit's copy, or a load's board.
 */
const seenParts = new WeakSet<ComponentInstance>()
/** store.layoutLoadCount() as last seen by the layout subscription */
let seenLayoutLoads = layoutLoadCount()
/** original file bytes of every image this session (export without an IndexedDB round trip) */
const bytesCache = new Map<string, Uint8Array>()
/** blobs being written right now — never garbage-collected */
const inflightShas = new Set<string>()
/** persisted records not yet re-verified by the boot restore */
let pendingRestore: Record<string, StoredRecord> = {}
/** per-board load sequence: a newer load (or a clear) supersedes an in-flight one */
const loadSeq = new Map<string, number>()

function findComponent(layout: CircuitLayout, id: string): ComponentInstance | undefined {
  return layout.components.find((c) => c.id === id)
}

function isMcuComponent(layout: CircuitLayout, id: string): boolean {
  const c = findComponent(layout, id)
  return !!c && !!getEntry(c.type)?.mcu
}

/** Parse firmware bytes with the loader; never throws. */
async function parseImage(name: string, bytes: Uint8Array, binBase?: number): Promise<LoadResult> {
  try {
    return await loadFirmwareFile(name, bytes, binBase !== undefined ? { binBase } : {})
  } catch (err) {
    return { ok: false, error: `firmware loader failed: ${errorText(err)}` }
  }
}

function persistRecords(): void {
  const out: Record<string, StoredRecord> = { ...pendingRestore }
  for (const [id, b] of bindings) out[id] = b.binBase !== undefined ? { ...b.record, binBase: b.binBase } : b.record
  if (Object.keys(out).length === 0) lsRemove(LS_FIRMWARE)
  else lsSet(LS_FIRMWARE, JSON.stringify(out))
}

/** Mirror `bindings` into React state + localStorage. */
function publishFirmware(): void {
  const firmware: Record<string, FirmwareRecord> = {}
  for (const [id, b] of bindings) firmware[id] = b.record
  useLab.setState({ firmware })
  persistRecords()
}

/**
 * What the current host holds, per board: a mirror of the coordinator's
 * firmware map (which is keyed by component id and survives load() and
 * reset()). Only DIFFERENCES are ever sent, because SimHost.setFirmware
 * programs the image, power-on-resets that MCU and rebuilds the world —
 * re-sending an unchanged image after each edit would restart the firmware
 * on every wire you add and defeat the hot rewire of host.load.
 */
let syncedHost: SimHost | null = null
const hostImages = new Map<string, FirmwareImage>()

/**
 * Bring `h`'s firmware in line with the bindings: send images it lacks or
 * holds in an older version, remove images of boards that lost their
 * binding (so a new board reusing the id never inherits stale firmware).
 * `boot` = a brand-new host that holds nothing yet.
 */
function syncHostFirmware(h: SimHost, boot = false): void {
  if (boot || h !== syncedHost) {
    syncedHost = h
    hostImages.clear()
  }
  const send = (id: string, image: FirmwareImage | null): void => {
    try {
      h.setFirmware(id, image)
      if (image) hostImages.set(id, image)
      else hostImages.delete(id)
    } catch (err) {
      labLog('error', `could not send firmware to ${id}: ${errorText(err)}`, id)
    }
  }
  for (const id of [...hostImages.keys()]) if (!bindings.has(id)) send(id, null)
  for (const [id, b] of bindings) if (hostImages.get(id) !== b.image) send(id, b.image)
}

function bind(componentId: string, b: Binding, opts: { createHost: boolean }): void {
  bindings.set(componentId, b)
  detached.delete(componentId)
  const comp = findComponent(useStore.getState().layout, componentId)
  if (comp) {
    lastInstance.set(componentId, comp)
    // firmware loaded onto this board (any copy of it) is its own
    const line = lineages.get(comp)
    if (line) line.displaced = false
  }
  publishFirmware()
  // a host created right here already synced every binding with its boot load
  const h = opts.createHost ? getSimHost() : peekSimHost()
  if (h) syncHostFirmware(h)
}

function lineageOf(c: ComponentInstance): BoardLineage {
  let line = lineages.get(c)
  if (!line) {
    line = { displaced: false }
    lineages.set(c, line)
  }
  return line
}

/**
 * The layout went from `prev` to `next`. An edit's new copy of an MCU board
 * (never seen, same id as a board of `prev`) continues that board's lineage;
 * undo / redo bring back objects already seen, a load brings boards of their
 * own. A wholesale load also marks the boards it took away while they had no
 * firmware as displaced. The live host's reload may already have reconciled
 * the bindings with `next` (the store's own subscription runs first): a board
 * of `prev` had firmware when its id is still bound (the binding moved on to
 * the loaded board), when its binding was detached from exactly this
 * instance, or when its restore is pending.
 */
function followBoards(next: CircuitLayout, prev: CircuitLayout): void {
  const loads = layoutLoadCount()
  const loaded = loads !== seenLayoutLoads
  seenLayoutLoads = loads
  for (const c of prev.components) seenParts.add(c) // the boot document's parts too
  for (const c of next.components) {
    if (seenParts.has(c)) continue
    seenParts.add(c)
    if (loaded || !getEntry(c.type)?.mcu) continue
    const before = findComponent(prev, c.id)
    if (before && before !== c && getEntry(before.type)?.mcu) lineages.set(c, lineageOf(before))
  }
  if (!loaded) return
  const kept = new Set(next.components)
  for (const c of prev.components) {
    if (kept.has(c) || !getEntry(c.type)?.mcu) continue
    if (bindings.has(c.id) || detached.get(c.id)?.instance === c || c.id in pendingRestore) continue
    lineageOf(c).displaced = true
  }
}

/**
 * `comp` (bound under `id`) is a board a load displaced without firmware,
 * brought back by undo while the binding sits on another board — the loaded
 * one, not any copy of this one.
 */
function bindingIsForeign(id: string, comp: ComponentInstance): boolean {
  const line = lineages.get(comp)
  if (!line?.displaced) return false
  const last = lastInstance.get(id)
  return last !== comp && (last === undefined || lineages.get(last) !== line)
}

/**
 * Drop bindings whose board left `layout` (deleted, or no longer an MCU) —
 * or was swapped back by undo for a board a load had displaced without
 * firmware (bindingIsForeign) — and restore detached ones whose exact board
 * instance came back (undo/redo).
 */
function reconcileBindings(layout: CircuitLayout): void {
  let changed = false
  for (const [id, b] of [...bindings]) {
    const comp = findComponent(layout, id)
    if (comp && getEntry(comp.type)?.mcu && !bindingIsForeign(id, comp)) {
      lastInstance.set(id, comp)
      continue
    }
    bindings.delete(id)
    detached.delete(id) // re-insert at the end (newest)
    detached.set(id, { ...b, instance: lastInstance.get(id) })
    lastInstance.delete(id)
    changed = true
  }
  while (detached.size > DETACHED_CAP) detached.delete(detached.keys().next().value as string)
  for (const [id, d] of [...detached]) {
    if (bindings.has(id)) {
      detached.delete(id)
      continue
    }
    const comp = findComponent(layout, id)
    if (!comp || d.instance === undefined || comp !== d.instance) continue
    const restored: Binding = { record: d.record, image: d.image }
    if (d.binBase !== undefined) restored.binBase = d.binBase
    bindings.set(id, restored)
    lastInstance.set(id, comp)
    detached.delete(id)
    changed = true
  }
  if (restoreShelved(layout)) changed = true
  if (changed) publishFirmware()
}

/**
 * Copy / paste: bindings of boards that left the document while a paste
 * gave their id to another board (cut U1, paste: a new U1). `detached` keeps
 * one record per id, so each is kept here with the very board it belongs
 * to; when undo / redo brings that board back unbound, it gets its firmware
 * again (and the board that had the id meanwhile keeps its own here, for
 * its redo). A board bound again its own way drops a stale entry.
 */
const shelved = new WeakMap<ComponentInstance, Binding>()
let shelfInUse = false

function shelve(d: (Binding & { instance?: ComponentInstance }) | undefined, keep?: ComponentInstance): void {
  if (!d?.instance || d.instance === keep) return
  const b: Binding = { record: d.record, image: d.image }
  if (d.binBase !== undefined) b.binBase = d.binBase
  shelved.set(d.instance, b)
  shelfInUse = true
}

/** reconcileBindings' last pass: shelved boards back in `layout` and unbound get their firmware. */
function restoreShelved(layout: CircuitLayout): boolean {
  if (!shelfInUse) return false
  let changed = false
  for (const comp of layout.components) {
    const b = shelved.get(comp)
    if (!b) continue
    if (bindings.has(comp.id)) {
      if (lastInstance.get(comp.id) === comp) shelved.delete(comp) // bound again its own way
      continue
    }
    if (!getEntry(comp.type)?.mcu) continue
    shelve(detached.get(comp.id), comp)
    detached.delete(comp.id)
    shelved.delete(comp)
    bindings.set(comp.id, b)
    lastInstance.set(comp.id, comp)
    changed = true
  }
  return changed
}

/**
 * Copy / paste (round 5 — src/ui/chrome/copy-paste.ts): the pasted board
 * `dst` runs the same image as `src` — the binding `src` has now, or the one
 * it left behind when it was cut or deleted (detached). `opts.sha256` (the
 * image at copy time) refuses another image the id got since. Undo / redo
 * follow it like any binding: undoing the paste detaches it with the pasted
 * board's own instance, and redo brings that very instance back. Returns
 * the record now bound to `dst`, or null when there was nothing to copy.
 * `dst` may be `src` itself: a board cut and pasted gets its id back, and
 * its image from the binding it left behind. That binding stays the cut
 * board's too (shelved with its instance): undoing the paste and then the
 * cut brings the original board back WITH its firmware.
 */
export function copyFirmware(src: string, dst: string, opts: { sha256?: string } = {}): FirmwareRecord | null {
  const from = bindings.get(src) ?? detached.get(src)
  if (!from || (opts.sha256 !== undefined && from.record.sha256 !== opts.sha256)) return null
  const board = findComponent(useStore.getState().layout, dst)
  if (!board || !getEntry(board.type)?.mcu) return null
  shelve(detached.get(dst), board) // bind() below drops the record a board that left under this id keeps
  loadSeq.set(dst, (loadSeq.get(dst) ?? 0) + 1) // supersedes an in-flight load for that id
  delete pendingRestore[dst] // a stale stored record of an earlier board with this id
  const record: FirmwareRecord = { ...from.record, componentId: dst, loadedAt: Date.now(), warnings: from.record.warnings.slice() }
  const b: Binding = { record, image: from.image }
  if (from.binBase !== undefined) b.binBase = from.binBase
  bind(dst, b, { createHost: false }) // a host built later gets every binding with its boot load
  addTerminalMark(dst, 'load', { name: record.name, sha: record.sha256.slice(0, 8) })
  return record
}

async function storeBytes(sha: string, bytes: Uint8Array, name: string): Promise<string | null> {
  bytesCache.set(sha, bytes)
  const store = firmwareBlobStore()
  inflightShas.add(sha)
  try {
    await store.put(sha, bytes, name)
  } catch (err) {
    return `the firmware could not be saved in browser storage (${errorText(err)}) — the binding lasts until this page is closed`
  } finally {
    inflightShas.delete(sha)
  }
  return store.persistent
    ? null
    : 'browser storage (IndexedDB) is unavailable — the binding lasts until this page is closed'
}

function referencedShas(): Set<string> {
  const keep = new Set<string>(inflightShas)
  for (const b of bindings.values()) keep.add(b.record.sha256)
  for (const d of detached.values()) keep.add(d.record.sha256)
  for (const r of Object.values(pendingRestore)) keep.add(r.sha256)
  // localStorage is shared by every tab of the origin: another tab's bindings count too
  for (const r of Object.values(readStoredRecords())) keep.add(r.sha256)
  return keep
}

/** Delete stored firmware no binding refers to any more (best effort). */
async function collectGarbage(): Promise<void> {
  const store = firmwareBlobStore()
  try {
    const keys = await store.keys()
    for (const k of keys) {
      if (referencedShas().has(k)) continue
      await store.delete(k)
      bytesCache.delete(k)
    }
  } catch {
    /* GC is an optimisation: a failure leaves an unreferenced blob behind */
  }
}

function readStoredRecords(): Record<string, StoredRecord> {
  const raw = lsGetJson(LS_FIRMWARE)
  const out: Record<string, StoredRecord> = {}
  if (!isObject(raw)) return out
  for (const [id, r] of Object.entries(raw)) {
    if (!isObject(r)) continue
    if (typeof r.name !== 'string' || !FIRMWARE_FORMATS.includes(r.format as FirmwareFormat)) continue
    if (!isSha256Hex(r.sha256)) continue
    if (typeof r.size !== 'number' || !Number.isInteger(r.size) || r.size < 0) continue
    const rec: StoredRecord = {
      componentId: id,
      name: r.name,
      format: r.format as FirmwareFormat,
      sha256: r.sha256,
      size: r.size,
      loadedAt: typeof r.loadedAt === 'number' ? r.loadedAt : 0,
      warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [],
    }
    if (typeof r.description === 'string') rec.description = r.description
    if (typeof r.binBase === 'number' && Number.isInteger(r.binBase) && r.binBase >= 0) rec.binBase = r.binBase
    out[id] = rec
  }
  return out
}

/**
 * Boot: re-bind every persisted record whose board still exists, from its
 * stored bytes, re-hashed and re-parsed. Anything that cannot be restored is
 * dropped with a log entry — never bound half-way.
 */
async function restoreFirmware(): Promise<void> {
  pendingRestore = readStoredRecords()
  const store = firmwareBlobStore()
  for (const id of Object.keys(pendingRestore)) {
    const rec = pendingRestore[id]
    if (!rec) continue // cleared meanwhile
    const drop = (level: SimLogEntry['level'], why: string): void => {
      delete pendingRestore[id]
      labLog(level, `firmware "${rec.name}" for ${id} was not restored: ${why}`, id)
    }
    if (!isMcuComponent(useStore.getState().layout, id)) {
      drop('info', 'the circuit has no microcontroller board with that id')
      continue
    }
    let bytes: Uint8Array | null = null
    try {
      bytes = bytesCache.get(rec.sha256) ?? (await store.get(rec.sha256))
    } catch (err) {
      drop('warning', `browser storage could not be read (${errorText(err)}) — load the file again`)
      continue
    }
    if (!bytes) {
      drop('warning', 'its bytes are no longer in browser storage — load the file again')
      continue
    }
    if (sha256Hex(bytes) !== rec.sha256) {
      drop('error', 'the stored bytes are corrupted (SHA-256 mismatch) — load the file again')
      continue
    }
    const parsed = await parseImage(rec.name, bytes, rec.binBase)
    if (pendingRestore[id] !== rec) continue // cleared / replaced while parsing
    if (!parsed.ok) {
      drop('error', parsed.error)
      continue
    }
    if (!isMcuComponent(useStore.getState().layout, id)) {
      drop('info', 'the board was removed')
      continue
    }
    delete pendingRestore[id]
    bytesCache.set(rec.sha256, bytes)
    const { binBase, ...record } = rec
    const b: Binding = { record, image: parsed.image }
    if (binBase !== undefined && rec.format === 'bin') b.binBase = binBase
    bind(id, b, { createHost: false })
  }
  pendingRestore = {}
  persistRecords()
  await collectGarbage()
}

// ---------------------------------------------------------------------------
// Host queries
// ---------------------------------------------------------------------------

async function runQuery(q: HostQuery, createHost: boolean): Promise<HostQueryResult | null> {
  const h = createHost ? getSimHost() : peekSimHost()
  if (!h) return null
  try {
    return await h.query(q)
  } catch (err) {
    labLog('warning', `${q.kind} query failed: ${errorText(err)}`)
    return null
  }
}

function hostCall(run: (h: SimHost) => void, what: string, createHost = true): void {
  const h = createHost ? getSimHost() : peekSimHost()
  if (!h) return
  try {
    run(h)
  } catch (err) {
    labLog('error', `${what} failed: ${errorText(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLab = create<LabState>()((set, get) => ({
  // ---- firmware ----
  firmware: {},

  async loadFirmware(componentId, file, opts) {
    await bootPromise // a concurrent boot restore must not overwrite this binding
    const seq = (loadSeq.get(componentId) ?? 0) + 1
    loadSeq.set(componentId, seq)
    if (!isMcuComponent(useStore.getState().layout, componentId)) {
      return { ok: false, error: `"${componentId}" is not a microcontroller board in this circuit` }
    }
    if (!(file.bytes instanceof Uint8Array) || file.bytes.length === 0) {
      return { ok: false, error: `${file.name}: the file is empty` }
    }
    const bytes = file.bytes.slice() // our own copy: the caller may reuse its buffer
    const binBase = opts?.binBase
    const parsed = await parseImage(file.name, bytes, binBase)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const image = parsed.image
    const sha = sha256Hex(bytes)
    if (image.sha256 !== sha) {
      return {
        ok: false,
        error: `${file.name}: the loader reported SHA-256 "${image.sha256}" but the file hashes to ${sha}`,
      }
    }
    const warnings = image.warnings.slice()
    const storageWarning = await storeBytes(sha, bytes, file.name)
    if (storageWarning) warnings.push(storageWarning)
    if (loadSeq.get(componentId) !== seq) {
      return { ok: false, error: 'superseded by a newer firmware load or clear for this board' }
    }
    if (!isMcuComponent(useStore.getState().layout, componentId)) {
      return { ok: false, error: `"${componentId}" was removed while its firmware was loading` }
    }
    const record: FirmwareRecord = {
      componentId,
      name: file.name,
      format: image.format,
      sha256: sha,
      size: bytes.length,
      loadedAt: Date.now(),
      warnings: image.warnings.slice(),
    }
    if (image.description !== undefined) record.description = image.description
    const b: Binding = { record, image }
    if (image.format === 'bin' && binBase !== undefined) b.binBase = binBase
    bind(componentId, b, { createHost: true })
    addTerminalMark(componentId, 'load', { name: file.name, sha: sha.slice(0, 8) })
    return { ok: true, warnings }
  },

  clearFirmware(componentId) {
    loadSeq.set(componentId, (loadSeq.get(componentId) ?? 0) + 1) // cancels an in-flight load
    const had = bindings.delete(componentId)
    const hadPending = componentId in pendingRestore
    delete pendingRestore[componentId]
    detached.delete(componentId)
    lastInstance.delete(componentId)
    if (!had && !hadPending) return
    publishFirmware()
    const h = peekSimHost()
    if (h) syncHostFirmware(h)
    void collectGarbage()
  },

  // ---- live info ----
  mcus: {},
  perf: null,
  serialPorts: NO_SERIAL_PORTS,
  uartVersion: 0,
  logVersion: 0,

  // ---- MCU debugger ----
  mcuReset(componentId) {
    hostCall((h) => h.mcuReset(componentId), `${componentId} reset`)
    addTerminalMark(componentId, 'reset')
  },
  mcuHalt(componentId) {
    hostCall((h) => h.mcuHalt(componentId), `${componentId} halt`)
  },
  mcuResume(componentId) {
    hostCall((h) => h.mcuResume(componentId), `${componentId} resume`)
    // a debugger halt froze the whole world (the hosts stop their loop on it):
    // resuming the MCU resumes the world it was frozen in
    resumeAfterDebugHalt()
  },
  mcuStep(componentId) {
    hostCall((h) => h.mcuStep(componentId), `${componentId} step`)
  },
  async queryMcuDebug(componentId) {
    const r = await runQuery({ kind: 'mcu-debug', componentId }, true)
    return r?.kind === 'mcu-debug' ? r.state : null
  },
  async queryMcuSupport(componentId) {
    const r = await runQuery({ kind: 'mcu-support', componentId }, true)
    return r?.kind === 'mcu-support' ? r.support : ([] as PeripheralSupport[])
  },
  async readMcuMemory(componentId, addr, length) {
    const valid =
      Number.isInteger(addr) && addr >= 0 && addr <= 0xffffffff && Number.isInteger(length) && length > 0 && length <= 0x10000
    if (!valid) return null
    const r = await runQuery({ kind: 'mcu-memory', componentId, addr, length }, true)
    return r?.kind === 'mcu-memory' ? r.bytes : null
  },

  // ---- UART terminal ----
  terminal: loadTerminal(),

  setTerminal(p) {
    const terminal = sanitizeTerminal(p, get().terminal)
    set({ terminal })
    lsSet(LS_TERMINAL, JSON.stringify(terminal))
  },

  sendUart(componentId, port, text) {
    get().sendUartBytes(componentId, port, encodeTerminalLine(text, get().terminal.lineEnding))
  },

  sendUartBytes(componentId, port, bytes) {
    if (bytes.length === 0) return
    const h = peekSimHost()
    if (!h) {
      labLog('warning', `${bytes.length} byte(s) for ${componentId} ${port} not sent: the simulation is not loaded`, componentId)
      return
    }
    try {
      h.uartSend(componentId, port, bytes.slice())
    } catch (err) {
      labLog('error', `sending to ${componentId} ${port} failed: ${errorText(err)}`, componentId)
      return
    }
    // a terminal's local echo: what you typed appears in the transcript
    if (get().terminal.localEcho) {
      const now = useStore.getState().simTime
      ringFor(componentId, port).push(bytes, { t0: now, t1: now, echo: true })
      uartDirty = true
      schedulePush(true)
    }
  },

  clearUart(componentId, port) {
    const e = uartRings.get(portKey(componentId, port))
    if (!e) return
    e.ring.clear()
    uartDirty = true
    schedulePush(true)
  },

  // ---- logic analyzer / scope ----
  logicChannels: loadLogicChannels(),

  setLogicChannels(channels) {
    const { channels: clean, warnings } = sanitizeLogicChannels(channels)
    for (const w of warnings) labLog('warning', `logic analyzer: ${w}`)
    set({ logicChannels: clean })
    lsSet(LS_INSTRUMENTS, JSON.stringify({ v: 1, logicChannels: clean }))
    hostCall((h) => h.setLogicChannels(clean), 'logic analyzer setup', false)
  },

  async queryLogic(t0, t1) {
    const r = await runQuery({ kind: 'logic', t0, t1 }, false)
    const empty: LogicCapture = { t0, t1, traces: [], overflow: false }
    return r?.kind === 'logic' ? r.capture : empty
  },

  async queryScope(t0, t1, maxPoints) {
    const q: HostQuery = maxPoints !== undefined ? { kind: 'scope', t0, t1, maxPoints } : { kind: 'scope', t0, t1 }
    const r = await runQuery(q, false)
    const empty: ScopeCapture = { t0, t1, traces: [] }
    return r?.kind === 'scope' ? r.capture : empty
  },

  logicView: loadLogicView(),

  setLogicView(p) {
    const cur = get().logicView
    const { view, warnings } = sanitizeLogicView({
      v: cur.v,
      decoders: p.decoders !== undefined ? p.decoders : cur.decoders,
      trigger: p.trigger !== undefined ? p.trigger : cur.trigger,
    })
    for (const w of warnings) labLog('warning', `logic analyzer: ${w}`)
    const next = view ?? cur
    set({ logicView: next })
    lsSet(LS_LOGIC_VIEW, JSON.stringify(next))
  },

  labCursor: { t: null },

  setLabCursor(t) {
    const v = t !== null && Number.isFinite(t) && t >= 0 ? t : null
    if (get().labCursor.t === v) return
    set({ labCursor: { t: v } })
  },

  scopePreset: null,

  // ---- workspace & library ----
  workspace: loadWorkspace(),

  setWorkspace(p) {
    applyWorkspaceOverrides(sanitizeWorkspaceOverrides(p))
  },

  favorites: loadFavorites(),

  toggleFavorite(type) {
    const favs = get().favorites
    const favorites = favs.includes(type) ? favs.filter((t) => t !== type) : [...favs, type]
    set({ favorites })
    lsSet(LS_FAVORITES, JSON.stringify(favorites))
  },

  // ---- project files ----
  async exportProject() {
    await bootPromise
    const store = firmwareBlobStore()
    const firmware: ProjectContents['firmware'] = {}
    for (const [id, b] of bindings) {
      let bytes = bytesCache.get(b.record.sha256) ?? null
      if (!bytes) {
        try {
          bytes = await store.get(b.record.sha256)
        } catch {
          bytes = null
        }
      }
      if (!bytes || sha256Hex(bytes) !== b.record.sha256) {
        labLog('warning', `firmware "${b.record.name}" for ${id} is not in the exported project: its bytes are unavailable`, id)
        continue
      }
      firmware[id] = { name: b.record.name, format: b.record.format, bytes }
      if (b.binBase !== undefined) firmware[id].binBase = b.binBase
    }
    return serializeProject({
      // exports never carry the momentary 'pressed' of a held button (legacy exportJson)
      layout: stripTransientParams(useStore.getState().layout),
      firmware,
      workspace: get().workspace,
      instruments: { logicChannels: get().logicChannels, logicView: get().logicView },
    })
  },

  // auto-run (round 5) waits for the whole import (state/run-gate.ts): loadLayout lands the new
  // circuit before its firmware binds below, while the board id may still hold the previous image
  importProject: whileAutoRunHeld(async (text: string) => {
    await bootPromise
    const parsed = parseProject(text)
    if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: parsed.warnings }
    const p = parsed.project
    const warnings = parsed.warnings.slice()

    // parse every image BEFORE touching any state (the bytes are hash-verified already)
    const ready: { id: string; binding: Binding; bytes: Uint8Array }[] = []
    for (const fw of p.firmware) {
      const r = await parseImage(fw.name, fw.bytes, fw.binBase)
      if (!r.ok) {
        warnings.push(`firmware "${fw.name}" for ${fw.componentId} was not loaded: ${r.error}`)
        continue
      }
      if (r.image.sha256 !== fw.sha256) {
        warnings.push(`firmware "${fw.name}" for ${fw.componentId} was not loaded: the loader's SHA-256 disagrees with the file`)
        continue
      }
      const record: FirmwareRecord = {
        componentId: fw.componentId,
        name: fw.name,
        format: r.image.format,
        sha256: fw.sha256,
        size: fw.size,
        loadedAt: Date.now(),
        warnings: r.image.warnings.slice(),
      }
      if (r.image.description !== undefined) record.description = r.image.description
      const binding: Binding = { record, image: r.image }
      if (fw.binBase !== undefined && r.image.format === 'bin') binding.binBase = fw.binBase
      ready.push({ id: fw.componentId, binding, bytes: fw.bytes })
    }

    const res = useStore.getState().loadLayout(p.layout) // one undo step, like a JSON import
    if (!res.ok) return { ok: false, errors: res.errors, warnings }

    // the project's firmware replaces every previous binding
    for (const id of [...bindings.keys()]) {
      loadSeq.set(id, (loadSeq.get(id) ?? 0) + 1)
      bindings.delete(id)
    }
    detached.clear()
    lastInstance.clear()
    for (const r of ready) {
      const storageWarning = await storeBytes(r.binding.record.sha256, r.bytes, r.binding.record.name)
      if (storageWarning) warnings.push(`${r.id}: ${storageWarning}`)
      const comp = findComponent(useStore.getState().layout, r.id)
      if (!comp || !getEntry(comp.type)?.mcu) continue // edited away meanwhile
      bindings.set(r.id, r.binding)
      lastInstance.set(r.id, comp)
    }
    publishFirmware()
    const h = peekSimHost()
    if (h) syncHostFirmware(h) // drops the old images, programs the new ones
    void collectGarbage()

    for (const r of ready) {
      if (bindings.get(r.id) === r.binding) {
        addTerminalMark(r.id, 'load', { name: r.binding.record.name, sha: r.binding.record.sha256.slice(0, 8) })
      }
    }

    // a loaded file replaces the analyzer setup with its own — a file without
    // instruments clears it, so the channels of the previous circuit (「PA5
    // LED」 after opening adc-pot) never linger on a board that reuses the id
    get().setLogicChannels(p.instruments?.logicChannels ?? [])
    // decoders + trigger travel with the project; a project without them keeps
    // the current ones only while it keeps the channels too: the old decoders'
    // role → channel mappings would read new channels as garbage
    if (p.instruments?.logicView) get().setLogicView(p.instruments.logicView)
    else if (!p.instruments || p.instruments.logicChannels.length > 0) get().setLogicView({ decoders: [], trigger: null })
    // the oscilloscope preset (envelope instruments.scope, UX IS-2): opaque
    // here, sanitized by the scope UI; read from the raw text because the
    // envelope parser keeps only the fields it knows
    // (no preset but scope probes: `{}` asks the scope to set itself up from
    // the signal the first time it is shown)
    const scope = rawScopePreset(text)
    if (scope || p.layout.components.some((c) => c.type === 'scope_probe')) {
      set({ scopePreset: { seq: (get().scopePreset?.seq ?? 0) + 1, settings: scope ?? {} } })
    }
    if (p.workspace) {
      // panel arrangement travels with the project; whether the desktop
      // workspace is ON is a property of this device, not of the project
      const over = sanitizeWorkspaceOverrides(p.workspace)
      delete over.enabled
      applyWorkspaceOverrides(over)
    }
    return { ok: true, errors: [], warnings }
  }),
}))

// ---------------------------------------------------------------------------
// Wiring to the app store + boot
// ---------------------------------------------------------------------------

onSimHostEvent((e) => {
  switch (e.kind) {
    case 'loaded': {
      reconcileBindings(e.layout)
      if (e.boot) {
        try {
          e.host.setLogicChannels(useLab.getState().logicChannels)
        } catch (err) {
          labLog('error', `logic analyzer setup failed: ${errorText(err)}`)
        }
      }
      // the coordinator keeps firmware per board across load() and reset():
      // a booted host gets everything, otherwise only what changed (a board
      // deleted, brought back by undo, an imported project…)
      syncHostFirmware(e.host, e.boot)
      break
    }
    case 'frame':
      onFrame(e.frame, e.current)
      break
    case 'reset':
      onReset()
      break
    case 'disposed':
      syncedHost = null
      hostImages.clear()
      latestMcus = []
      latestPerf = null
      snapshotDirty = true
      if (latestSerialPorts.length > 0) {
        latestSerialPorts = NO_SERIAL_PORTS
        serialPortsDirty = true
      }
      flushPush()
      break
  }
})

// ---------------------------------------------------------------------------
// Instrument tray + logic channels follow the circuit (UX IS-5, IS-8)
// ---------------------------------------------------------------------------

/**
 * The logic channel's source still exists in `layout` WITH THE SAME MEANING
 * (release polish — a part id alone is not enough: example ids repeat, and
 * lm7805-regulator's U1 is a regulator, not i2c-scan's Blue Pill):
 *  - 'mcu-pin' — `componentId` is a microcontroller board and `pin` one of
 *    its GPIO pins (the catalog's pinMap: what an MCU-pin channel can read);
 *  - 'probe'   — `componentId` is a placed logic probe;
 *  - 'net'     — a hole always exists; a terminal "ID:PIN" needs a part
 *    `ID` that has a pin `PIN`.
 *
 * The rule for the analyzer's setup when the circuit changes:
 *  1. loading a file (an example, a lesson's circuit, an imported project)
 *     replaces the setup with the file's own: lab.importProject sets the
 *     file's channels and decoders, a lesson keeps only the channels it reads
 *     (src/ui/lessons/actions.ts pruneLessonChannels); a REPLACED circuit
 *     keeps an earlier channel only while this function holds for it (a file
 *     without its own channels: lm7805-regulator after i2c-scan drops
 *     「PB6 SCL」 / 「PB7 SDA」, and the decoders that read only them);
 *  2. editing the circuit (delete, move, undo) never drops a channel: one
 *     whose source is gone stays, marked 「來源 U1 已不存在」 in the analyzer,
 *     until the user removes it or brings the part back.
 * The tray's own choice (trayTabFor) and the analyzer's row mark use the
 * same test, so the 量測 tab, the analyzer and the tray always agree.
 */
export function logicSourcePresent(layout: CircuitLayout, ch: LogicChannelConfig): boolean {
  const s = ch.source
  if (s.kind === 'net') {
    const term = /^([^:]+):(.+)$/.exec(s.ref)
    if (!term) return true
    const comp = layout.components.find((c) => c.id === term[1])
    if (!comp) return false
    const entry = getEntry(comp.type)
    return !entry || entry.pins.includes(term[2])
  }
  const comp = layout.components.find((c) => c.id === s.componentId)
  if (!comp) return false
  if (s.kind === 'probe') return comp.type === 'logic_probe'
  return !!getEntry(comp.type)?.mcu?.pinMap[s.pin]
}

/**
 * The tray tab a circuit calls for, or null when it has nothing the tray
 * shows yet: 'logic' when the analyzer has live channels (or a logic probe
 * is placed), else 'scope' for a scope probe, else 'uart' for a
 * microcontroller whose firmware enabled a USART (`usartOn` — a board just
 * placed has nothing to print: an empty terminal is not opened, UX IS-20),
 * else 'measure' for a circuit with a multimeter and no microcontroller (its
 * reading always in view, UX IS-19).
 */
export function trayTabFor(layout: CircuitLayout, channels: readonly LogicChannelConfig[], usartOn = false): TrayTab | null {
  let mcu = false
  let scope = false
  let logicProbe = false
  let meter = false
  for (const c of layout.components) {
    if (c.type === 'scope_probe') scope = true
    else if (c.type === 'logic_probe') logicProbe = true
    else if (c.type === 'multimeter') meter = true
    else if (getEntry(c.type)?.mcu) mcu = true
  }
  if (logicProbe || channels.some((ch) => logicSourcePresent(layout, ch))) return 'logic'
  if (scope) return 'scope'
  if (mcu) return usartOn ? 'uart' : null
  return meter ? 'measure' : null
}

/** Some board's firmware enabled a USART (the terminal has something to show). */
function usartEnabled(mcus: LabState['mcus'] = useLab.getState().mcus): boolean {
  for (const id in mcus) if (mcus[id].uarts.some((u) => u.config.enabled)) return true
  return false
}

/** the user opened / collapsed the tray this session: automatic changes stop */
let trayTouched = false
/** the last circuit's verdict (null = nothing to measure) */
let trayWant: TrayTab | null = null

/** Tray.tsx: the user toggled the tray (automatic open / collapse stop for this session). */
export function noteTrayToggledByUser(): void {
  trayTouched = true
}

/**
 * Boot: the tray is open exactly when the restored circuit has something to
 * measure — a stored open / collapsed state of an earlier session is not
 * carried over (it described another circuit); the default decides.
 */
function bootTrayState(): void {
  trayWant = trayTabFor(useStore.getState().layout, useLab.getState().logicChannels, usartEnabled())
  if (workspaceOverrides.tray && 'open' in workspaceOverrides.tray) {
    const { open: _open, ...rest } = workspaceOverrides.tray
    workspaceOverrides = { ...workspaceOverrides, tray: rest }
    if (Object.keys(rest).length === 0) delete workspaceOverrides.tray
  }
  useLab.setState({ workspace: resolveWorkspace(workspaceDefaults(), workspaceOverrides) })
}

/** Drop logic channels (and the decoders that only read them) whose source left `layout`. */
function pruneStaleChannels(layout: CircuitLayout): void {
  const lab = useLab.getState()
  const keep = lab.logicChannels.filter((ch) => logicSourcePresent(layout, ch))
  if (keep.length === lab.logicChannels.length) return
  lab.setLogicChannels(keep)
  const live = new Set(keep.map((c) => c.index))
  const decoders = lab.logicView.decoders.filter((d) => {
    const chs = isObject(d) && isObject(d.channels) ? Object.values(d.channels) : []
    return chs.some((i) => typeof i === 'number' && live.has(i))
  })
  if (decoders.length !== lab.logicView.decoders.length) lab.setLogicView({ decoders })
}

// bindings follow the document even when no host exists yet; the tray and
// the logic channels follow wholesale circuit changes
for (const c of useStore.getState().layout.components) seenParts.add(c)
useStore.subscribe((state, prev) => {
  if (state.layout === prev.layout) return
  followBoards(state.layout, prev.layout)
  reconcileBindings(state.layout)
  // a circuit REPLACED as a whole (an example, a lesson, an imported or new
  // file): none of its parts is a part of the previous document. Channels of
  // parts that are gone belong to the old circuit. (A deleted board inside the
  // same circuit keeps its channels, shown as "source no longer exists".)
  const before = new Set(prev.layout.components)
  const replaced = state.layout.components.length > 0 && !state.layout.components.some((c) => before.has(c))
  if (replaced) pruneStaleChannels(state.layout)
  followCircuit(trayTabFor(state.layout, useLab.getState().logicChannels, usartEnabled()), replaced)
})

/**
 * The tray follows the circuit (UX IS-5): opens on the tab the circuit calls
 * for when it had nothing to show, collapses when a replaced circuit has
 * nothing; a REPLACED circuit that calls for another tab (an analog bench
 * with a meter after a board) switches to it — never once the user toggled
 * the tray this session.
 */
function followCircuit(want: TrayTab | null, replaced: boolean): void {
  const was = trayWant
  trayWant = want
  if (trayTouched) return
  const tray = useLab.getState().workspace.tray
  if ((want === null) === (was === null)) {
    if (replaced && want !== null && want !== was && tray.tab !== want) applyWorkspaceOverrides({ tray: { open: true, tab: want } })
    return
  }
  if (want !== null && !tray.open) applyWorkspaceOverrides({ tray: { open: true, tab: want } })
  // collapse only when the circuit was replaced (a lesson / example / new
  // board) — deleting the board mid-edit keeps the tray (and its stale-
  // channel notes) where the user is looking
  else if (want === null && tray.open && replaced) applyWorkspaceOverrides({ tray: { open: false } })
}

// a USART the firmware just enabled: the terminal now has something to show (IS-20)
let usartWasOn = false
useLab.subscribe((s, p) => {
  if (s.mcus === p.mcus) return
  const on = usartEnabled(s.mcus)
  if (on === usartWasOn) return
  usartWasOn = on
  // switched off (a reset, the session ending): the tray stays where the user looks
  if (on) followCircuit(trayTabFor(useStore.getState().layout, s.logicChannels, true), false)
})

bootTrayState()

let bootPromise: Promise<void> = restoreFirmware()

/** Resolves once the boot-time firmware restore has finished. */
export function labReady(): Promise<void> {
  return bootPromise
}

/**
 * TEST-ONLY: forget all in-memory lab state and boot again from storage
 * (localStorage + the current firmware blob store), as a page reload would.
 */
export function __rebootLabForTests(): Promise<void> {
  if (pushTimer !== null) clearTimeout(pushTimer)
  pushTimer = null
  bindings.clear()
  detached.clear()
  lastInstance.clear()
  lineages = new WeakMap()
  for (const c of useStore.getState().layout.components) seenParts.add(c)
  seenLayoutLoads = layoutLoadCount()
  syncedHost = null
  hostImages.clear()
  bytesCache.clear()
  inflightShas.clear()
  loadSeq.clear()
  uartRings.clear()
  logEntries = []
  logSnapshot = null
  latestMcus = []
  latestPerf = null
  latestSerialPorts = NO_SERIAL_PORTS
  uartDirty = logDirty = snapshotDirty = serialPortsDirty = false
  lastPushMs = Number.NEGATIVE_INFINITY
  lastFrameTime = 0
  terminalMarks = []
  terminalMarksSnapshot = null
  trayTouched = false
  useLab.setState({
    labCursor: { t: null },
    scopePreset: null,
    firmware: {},
    mcus: {},
    perf: null,
    serialPorts: NO_SERIAL_PORTS,
    uartVersion: 0,
    logVersion: 0,
    terminal: loadTerminal(),
    logicChannels: loadLogicChannels(),
    logicView: loadLogicView(),
    workspace: loadWorkspace(),
    favorites: loadFavorites(),
  })
  bootTrayState()
  bootPromise = restoreFirmware()
  return bootPromise
}

/** TEST-ONLY: wall clock for the 10 Hz push throttle (null = real clock). */
export function __setLabClockForTests(clock: (() => number) | null): void {
  labNow = clock ?? defaultLabNow
  lastPushMs = Number.NEGATIVE_INFINITY
}
