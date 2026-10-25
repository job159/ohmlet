/**
 * ohmlet project files — envelope format v1 (ARCHITECTURE_REVIEW §10.6).
 * Pure and DOM-free: node tests and the lab store (src/state/lab.ts) share it.
 *
 * Why an envelope instead of new CircuitLayout fields: validateLayout REBUILDS
 * the layout object and silently drops every unknown member (review §8 R4),
 * so firmware or workspace state stored inside the layout would vanish on the
 * next autosave/boot. The circuit document therefore stays a plain,
 * validator-owned CircuitLayout and the project file wraps it:
 *
 *   {
 *     "format": "ohmlet-project", "formatVersion": 1,
 *     "app": { "name": "ohmlet", "version": "0.1.0" },
 *     "savedAt": "2026-10-09T12:00:00.000Z",
 *     "layout": { …CircuitLayout… },
 *     "firmware": { "U1": { "name", "format", "sha256", "size", "data" (base64) } },
 *     "workspace"?: { …WorkspacePrefs… },
 *     "instruments"?: { "logicChannels": [ …LogicChannelConfig… ] }
 *   }
 *
 * Reading is migration-based: every accepted input is lifted, one
 * formatVersion at a time, through MIGRATIONS up to the current version and
 * only then validated. A bare legacy CircuitLayout (what AppState.exportJson
 * has always written) is formatVersion 0. A file from a NEWER ohmlet is
 * refused with a clear message rather than half-read.
 *
 * Firmware is embedded byte-exact and verified on read: the decoded data must
 * have the recorded size AND hash to the recorded SHA-256, otherwise the
 * whole project is rejected (a corrupted image must never be programmed).
 */
import type { CircuitLayout } from '../model/types'
import { getEntry } from '../model/catalog'
import { validateLayout } from '../model/validate'
import type { FirmwareFormat } from '../mcu/firmware'
import type { LogicChannelConfig, LogicSource } from '../sim/coordinator/api'
import type { LogicViewSettings, WorkspacePrefs } from './lab-types'
import { base64ToBytes, bytesToBase64, isSha256Hex, sha256Hex } from './firmware-store'
import pkg from '../../package.json'

export const PROJECT_FORMAT = 'ohmlet-project'
export const PROJECT_FORMAT_VERSION = 1
export const PROJECT_APP_NAME = 'ohmlet'
/** the running app's version (package.json), recorded in every saved project */
export const APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0'

const FIRMWARE_FORMATS: readonly FirmwareFormat[] = ['elf', 'bin', 'hex']
/** logic-analyzer channels 0..15 (LogicChannelConfig.index) */
const MAX_LOGIC_CHANNELS = 16

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One embedded firmware file, keyed by the MCU board's component id. */
export interface ProjectFirmwareEntry {
  /** original file name */
  name: string
  format: FirmwareFormat
  /** lowercase hex SHA-256 of the ORIGINAL file bytes (FirmwareImage.sha256) */
  sha256: string
  /** byte length of the original file */
  size: number
  /** base64 (RFC 4648, padded) of the original file bytes */
  data: string
  /**
   * BIN images only: the flash address the raw image was programmed at, when
   * the user chose one (absent = the loader's default). A raw .bin carries no
   * addresses of its own, so without this the image could not be re-loaded
   * identically. Additive to the v1 envelope; readers that ignore it fall
   * back to the default base.
   */
  binBase?: number
}

export interface ProjectInstruments {
  logicChannels: LogicChannelConfig[]
  /**
   * Logic-analyzer decoder instances + trigger settings (opaque JSON with
   * its own version, see LogicViewSettings). Additive to the v1 envelope:
   * written only when the analyzer has decoders or trigger settings;
   * readers that ignore it keep working.
   */
  logicView?: LogicViewSettings
}

/** The on-disk shape of formatVersion 1. */
export interface ProjectEnvelopeV1 {
  format: typeof PROJECT_FORMAT
  formatVersion: 1
  app: { name: string; version: string }
  /** ISO-8601 UTC */
  savedAt: string
  layout: CircuitLayout
  firmware: Record<string, ProjectFirmwareEntry>
  workspace?: WorkspacePrefs
  instruments?: ProjectInstruments
}

/** What the lab store hands to serializeProject. */
export interface ProjectContents {
  layout: CircuitLayout
  /** component id → original file */
  firmware: Record<string, { name: string; format: FirmwareFormat; bytes: Uint8Array; binBase?: number }>
  workspace?: WorkspacePrefs
  instruments?: ProjectInstruments
}

export interface ParsedFirmware {
  componentId: string
  name: string
  format: FirmwareFormat
  sha256: string
  size: number
  /** decoded, size- and hash-verified original file bytes */
  bytes: Uint8Array
  binBase?: number
}

export interface ParsedProject {
  /** formatVersion of the INPUT (0 = bare legacy CircuitLayout) */
  sourceFormatVersion: number
  /** writer app, null for legacy layouts */
  app: { name: string; version: string } | null
  savedAt: string | null
  /** validateLayout output (canonical object) */
  layout: CircuitLayout
  /** verified firmware for MCU boards that exist in `layout` */
  firmware: ParsedFirmware[]
  /** raw workspace object — the lab store merges it field-by-field with its defaults */
  workspace: Record<string, unknown> | null
  instruments: ProjectInstruments | null
}

export type ProjectParseResult =
  | { ok: true; project: ParsedProject; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * JSON text of a formatVersion-1 envelope. Firmware entries are hashed here
 * from the bytes themselves (never trusted from a caller's record) and
 * emitted in sorted id order so equal projects serialize byte-identically.
 */
export function serializeProject(
  contents: ProjectContents,
  opts: { savedAt?: Date; appVersion?: string } = {},
): string {
  const firmware: Record<string, ProjectFirmwareEntry> = {}
  for (const id of Object.keys(contents.firmware).sort()) {
    const f = contents.firmware[id]
    const entry: ProjectFirmwareEntry = {
      name: f.name,
      format: f.format,
      sha256: sha256Hex(f.bytes),
      size: f.bytes.length,
      data: bytesToBase64(f.bytes),
    }
    if (f.format === 'bin' && f.binBase !== undefined) entry.binBase = f.binBase
    firmware[id] = entry
  }
  const env: ProjectEnvelopeV1 = {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: { name: PROJECT_APP_NAME, version: opts.appVersion ?? APP_VERSION },
    savedAt: (opts.savedAt ?? new Date()).toISOString(),
    layout: contents.layout,
    firmware,
  }
  if (contents.workspace) env.workspace = contents.workspace
  if (contents.instruments) {
    env.instruments = { logicChannels: contents.instruments.logicChannels }
    const view = contents.instruments.logicView
    if (view && (view.decoders.length > 0 || view.trigger !== null)) env.instruments.logicView = view
  }
  return JSON.stringify(env, null, 2)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type RawObject = Record<string, unknown>

function isObject(v: unknown): v is RawObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Upgrade steps keyed by the formatVersion they upgrade FROM; each returns a
 * raw object of formatVersion + 1. Never edit a shipped step — add the next.
 */
const MIGRATIONS: Record<number, (raw: RawObject) => RawObject> = {
  /** 0 → 1: a bare CircuitLayout becomes the envelope's `layout`, with no firmware. */
  0: (layout) => ({
    format: PROJECT_FORMAT,
    formatVersion: 1,
    app: null,
    savedAt: null,
    layout,
    firmware: {},
  }),
}

/** formatVersion of a raw input, or an error message. */
function detectVersion(raw: RawObject): { version: number } | { error: string } {
  if (raw.format === undefined) {
    // pre-envelope export: a bare CircuitLayout (validated later, after migration)
    if ('components' in raw || 'wires' in raw || 'version' in raw) return { version: 0 }
    return { error: 'not an ohmlet project or circuit layout (no "format" and no "components")' }
  }
  if (raw.format !== PROJECT_FORMAT) {
    return { error: `unknown file format ${JSON.stringify(raw.format)} (expected "${PROJECT_FORMAT}")` }
  }
  const v = raw.formatVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { error: `"formatVersion" must be a positive integer (got ${JSON.stringify(v ?? null)})` }
  }
  if (v > PROJECT_FORMAT_VERSION) {
    const app = isObject(raw.app) && typeof raw.app.version === 'string' ? ` by ohmlet ${raw.app.version}` : ''
    return {
      error:
        `this project was saved${app} in project format v${v}, which is newer than this ` +
        `version of ohmlet supports (format v${PROJECT_FORMAT_VERSION} and older) — update ohmlet to open it`,
    }
  }
  return { version: v }
}

/** Parse + migrate + validate project-file text (envelope or bare legacy CircuitLayout). */
export function parseProject(text: string): ProjectParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      errors: [`the file is not valid JSON (${err instanceof Error ? err.message : String(err)})`],
      warnings: [],
    }
  }
  return parseProjectObject(raw)
}

/** As parseProject, for an already-parsed JSON value. */
export function parseProjectObject(raw: unknown): ProjectParseResult {
  const warnings: string[] = []
  if (!isObject(raw)) {
    return { ok: false, errors: ['a project file must contain a JSON object'], warnings }
  }
  const detected = detectVersion(raw)
  if ('error' in detected) return { ok: false, errors: [detected.error], warnings }

  let env: RawObject = raw
  for (let v = detected.version; v < PROJECT_FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) {
      return { ok: false, errors: [`no migration from project format v${v}`], warnings }
    }
    env = step(env)
  }
  return readV1(env, detected.version, warnings)
}

function readV1(env: RawObject, sourceFormatVersion: number, warnings: string[]): ProjectParseResult {
  const errors: string[] = []

  // ---- layout (the validator is the single authority) ----
  if (!isObject(env.layout)) {
    return { ok: false, errors: ['the project has no "layout" object'], warnings }
  }
  const res = validateLayout(env.layout)
  for (const w of res.warnings) warnings.push(`layout: ${w}`)
  if (!res.ok || !res.layout) {
    return { ok: false, errors: res.errors.map((e) => `layout: ${e}`), warnings }
  }
  // the load-time id normalisation (UX H8): every reference below uses the new ids
  const { layout, renames } = migrateComponentIds(res.layout)

  // ---- app / savedAt (informative) ----
  let app: ParsedProject['app'] = null
  if (isObject(env.app) && typeof env.app.name === 'string' && typeof env.app.version === 'string') {
    app = { name: env.app.name, version: env.app.version }
  } else if (env.app !== null && env.app !== undefined) {
    warnings.push('"app" is malformed — ignored')
  }
  const savedAt = typeof env.savedAt === 'string' ? env.savedAt : null

  // ---- firmware (verified byte-exact; any corruption rejects the project) ----
  const firmware: ParsedFirmware[] = []
  const fwRaw = env.firmware ?? {}
  if (!isObject(fwRaw)) {
    errors.push('"firmware" must be an object keyed by component id')
  } else {
    for (const rawId of Object.keys(fwRaw).sort()) {
      const id = renamedId(renames, rawId) ?? rawId
      const r = readFirmwareEntry(rawId, fwRaw[rawId], errors, warnings)
      if (!r) continue
      if (id !== rawId) r.componentId = id
      const comp = layout.components.find((c) => c.id === id)
      if (!comp || !getEntry(comp.type)?.mcu) {
        warnings.push(`firmware "${r.name}" for "${id}" ignored — the circuit has no microcontroller board "${id}"`)
        continue
      }
      firmware.push(r)
    }
  }

  // ---- workspace (merged with defaults by the lab store) ----
  let workspace: Record<string, unknown> | null = null
  if (isObject(env.workspace)) workspace = env.workspace
  else if (env.workspace !== undefined) warnings.push('"workspace" is not an object — ignored')

  // ---- instruments ----
  let instruments: ProjectInstruments | null = null
  if (isObject(env.instruments)) {
    const s = sanitizeLogicChannels(env.instruments.logicChannels ?? [])
    for (const w of s.warnings) warnings.push(`instruments: ${w}`)
    instruments = { logicChannels: renameLogicChannels(s.channels, renames) }
    if (env.instruments.logicView !== undefined) {
      const lv = sanitizeLogicView(env.instruments.logicView)
      for (const w of lv.warnings) warnings.push(`instruments: ${w}`)
      if (lv.view) instruments.logicView = lv.view
    }
  } else if (env.instruments !== undefined) {
    warnings.push('"instruments" is not an object — ignored')
  }

  if (errors.length > 0) return { ok: false, errors, warnings }
  return {
    ok: true,
    project: { sourceFormatVersion, app, savedAt, layout, firmware, workspace, instruments },
    warnings,
  }
}

function readFirmwareEntry(
  id: string,
  raw: unknown,
  errors: string[],
  warnings: string[],
): ParsedFirmware | null {
  const where = `firmware "${id}"`
  if (!isObject(raw)) {
    errors.push(`${where}: entry must be an object`)
    return null
  }
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null
  if (!name) errors.push(`${where}: "name" must be a non-empty string`)
  const format = FIRMWARE_FORMATS.includes(raw.format as FirmwareFormat) ? (raw.format as FirmwareFormat) : null
  if (!format) errors.push(`${where}: "format" must be one of ${FIRMWARE_FORMATS.join(', ')}`)
  const sha = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : null
  if (!isSha256Hex(sha)) errors.push(`${where}: "sha256" must be 64 hex digits`)
  const size = raw.size
  const sizeOk = typeof size === 'number' && Number.isInteger(size) && size >= 0
  if (!sizeOk) errors.push(`${where}: "size" must be a non-negative integer`)
  if (typeof raw.data !== 'string') {
    errors.push(`${where}: "data" must be a base64 string`)
    return null
  }
  if (!name || !format || !isSha256Hex(sha) || !sizeOk) return null

  const bytes = base64ToBytes(raw.data)
  if (!bytes) {
    errors.push(`${where} (${name}): "data" is not valid base64 — the file is corrupted`)
    return null
  }
  if (bytes.length !== size) {
    errors.push(`${where} (${name}): decoded ${bytes.length} bytes but the project records ${size} — the file is corrupted`)
    return null
  }
  const actual = sha256Hex(bytes)
  if (actual !== sha) {
    errors.push(
      `${where} (${name}): SHA-256 mismatch (recorded ${sha.slice(0, 12)}…, data hashes to ` +
        `${actual.slice(0, 12)}…) — the embedded firmware is corrupted`,
    )
    return null
  }

  const out: ParsedFirmware = { componentId: id, name, format, sha256: sha, size: bytes.length, bytes }
  if (raw.binBase !== undefined) {
    const b = raw.binBase
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 0xffffffff) {
      errors.push(`${where} (${name}): "binBase" must be a 32-bit address`)
      return null
    }
    if (format === 'bin') out.binBase = b
    else warnings.push(`${where} (${name}): "binBase" only applies to .bin images — ignored`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Logic-analyzer channel sanitizing (shared with the lab store's localStorage restore)
// ---------------------------------------------------------------------------

function readLogicSource(raw: unknown): LogicSource | null {
  if (!isObject(raw)) return null
  switch (raw.kind) {
    case 'probe':
      return typeof raw.componentId === 'string' ? { kind: 'probe', componentId: raw.componentId } : null
    case 'mcu-pin':
      return typeof raw.componentId === 'string' && typeof raw.pin === 'string'
        ? { kind: 'mcu-pin', componentId: raw.componentId, pin: raw.pin }
        : null
    case 'net':
      return typeof raw.ref === 'string' ? { kind: 'net', ref: raw.ref } : null
    default:
      return null
  }
}

/**
 * Keep the well-formed LogicChannelConfig entries of `raw` (index an integer
 * 0..15, first occurrence of an index wins), sorted by index; every dropped
 * entry is reported.
 */
export function sanitizeLogicChannels(raw: unknown): { channels: LogicChannelConfig[]; warnings: string[] } {
  const warnings: string[] = []
  if (!Array.isArray(raw)) {
    return { channels: [], warnings: ['"logicChannels" must be an array — ignored'] }
  }
  const byIndex = new Map<number, LogicChannelConfig>()
  raw.forEach((c, i) => {
    if (!isObject(c)) {
      warnings.push(`logic channel #${i} is not an object — dropped`)
      return
    }
    const index = c.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_LOGIC_CHANNELS) {
      warnings.push(`logic channel #${i}: "index" must be an integer 0..${MAX_LOGIC_CHANNELS - 1} — dropped`)
      return
    }
    if (byIndex.has(index)) {
      warnings.push(`logic channel #${i}: duplicate index ${index} — dropped`)
      return
    }
    const source = readLogicSource(c.source)
    if (!source) {
      warnings.push(`logic channel ${index}: malformed "source" — dropped`)
      return
    }
    const label = typeof c.label === 'string' ? c.label : `D${index}`
    byIndex.set(index, { index, label, source })
  })
  const channels = [...byIndex.values()].sort((a, b) => a.index - b.index)
  return { channels, warnings }
}

// ---------------------------------------------------------------------------
// Load-time component-id normalisation (UX helper H8)
// ---------------------------------------------------------------------------

/**
 * Pushbuttons used to get the id prefix 'PB' (PB1, PB2 …), which reads like
 * the STM32 port pins PB1, PB2 (「按鈕 PB1 接 PB12」). They are 'SW' now
 * (store ID_PREFIX); every document read from outside the running app —
 * project files, the autosave, example / lesson / AI layouts (store
 * loadLayout) — is normalised here.
 *
 * Wires: examples, lessons and older files named them 'w1', 'w2' …, the
 * editor 'W1' — one circuit showed 「導線 w5、導線 W2」 (UX IS-18, §5.4 「一律
 * 寫成 W1」). A lower-case 'w<n>' becomes 'W<n>' on load.
 */
const LEGACY_PUSHBUTTON_ID = /^PB\d+$/
const LEGACY_WIRE_ID = /^w(\d+)$/

/** Old id → new id of one normalisation (empty when nothing was renamed). */
export type IdRenames = Readonly<Record<string, string>>

/**
 * `layout` with every pushbutton whose id matches /^PB\d+$/ renamed to
 * 'SW<n>' — the SAME number when 'SW<n>' is free (PB2 → SW2, whatever the
 * order of the parts in the file: lesson checks and a teacher's notes keep
 * pointing at the same button), else the lowest free 'SW<n>' (free = no
 * component or wire id equal to it, case-insensitively; such collisions in
 * layout order) — and every reference to a renamed id rewritten: wire
 * endpoints "PB1:…" (terminal refs). A wire 'w<n>' becomes 'W<n>' the same
 * way (UX IS-18: one circuit never mixes 「導線 w5」 and 「導線 W2」; nothing
 * else in a document names a wire). Returns the SAME
 * layout object (and no renames) when nothing matches, so the store's
 * layout identity semantics hold. Pure.
 *
 * Other references live outside the document and go through the same map:
 * project firmware keys and logic-analyzer sources (readV1 here,
 * renameLogicChannels). Lab state keyed by component id never names a
 * pushbutton (firmware → MCU boards; logic sources → MCU pins, logic probes,
 * holes and off-board terminals).
 */
export function migrateComponentIds(layout: CircuitLayout): { layout: CircuitLayout; renames: IdRenames } {
  const legacy = layout.components.filter((c) => c.type === 'pushbutton' && LEGACY_PUSHBUTTON_ID.test(c.id))
  const legacyWires = layout.wires.filter((w) => LEGACY_WIRE_ID.test(w.id))
  if (legacy.length === 0 && legacyWires.length === 0) return { layout, renames: {} }
  // every id that stays (the renamed buttons and wires give theirs up)
  const taken = new Set<string>()
  for (const c of layout.components) if (!legacy.includes(c)) taken.add(c.id.toLowerCase())
  for (const w of layout.wires) if (!legacyWires.includes(w)) taken.add(w.id.toLowerCase())
  const renames: Record<string, string> = {}
  // wires: w5 → W5 (the same number; a 'W5' already there → the lowest free W<n>)
  for (const w of legacyWires) {
    const same = `W${Number(w.id.slice(1))}`
    if (taken.has(same.toLowerCase())) continue
    renames[w.id] = same
    taken.add(same.toLowerCase())
  }
  for (const w of legacyWires) {
    if (renamedId(renames, w.id)) continue
    let n = 1
    while (taken.has(`w${n}`)) n++
    renames[w.id] = `W${n}`
    taken.add(`w${n}`)
  }
  // 1) keep the number where it is free: PB2 → SW2
  for (const c of legacy) {
    const same = `SW${Number(c.id.slice(2))}` // 'PB01' → 'SW1'
    if (taken.has(same.toLowerCase())) continue
    renames[c.id] = same
    taken.add(same.toLowerCase())
  }
  // 2) a collision (a slide switch already called SW1) takes the lowest free SW<n>
  for (const c of legacy) {
    if (renamedId(renames, c.id)) continue
    let n = 1
    while (taken.has(`sw${n}`)) n++
    renames[c.id] = `SW${n}`
    taken.add(`sw${n}`)
  }
  const components = layout.components.map((c) => {
    const id = renamedId(renames, c.id)
    return id ? { ...c, id } : c
  })
  const wires = layout.wires.map((w) => {
    const id = renamedId(renames, w.id) ?? w.id
    const from = renameEndpoint(w.from, renames)
    const to = renameEndpoint(w.to, renames)
    return id === w.id && from === w.from && to === w.to ? w : { ...w, id, from, to }
  })
  return { layout: { ...layout, components, wires }, renames }
}

/** The new id of `id` in `renames` (own keys only — an id like 'constructor' is never a rename). */
export function renamedId(renames: IdRenames, id: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(renames, id) ? renames[id] : undefined
}

/** "PB1:A1" → "SW1:A1" when PB1 was renamed; holes and other refs unchanged. */
export function renameEndpoint(ref: string, renames: IdRenames): string {
  const i = ref.indexOf(':')
  if (i <= 0) return ref
  const to = renamedId(renames, ref.slice(0, i))
  return to ? `${to}${ref.slice(i)}` : ref
}

/** Logic-analyzer channels with their component / terminal references renamed (same array when nothing changes). */
export function renameLogicChannels(channels: LogicChannelConfig[], renames: IdRenames): LogicChannelConfig[] {
  if (Object.keys(renames).length === 0) return channels
  return channels.map((ch) => {
    const s = ch.source
    if (s.kind === 'net') {
      const ref = renameEndpoint(s.ref, renames)
      return ref === s.ref ? ch : { ...ch, source: { kind: 'net', ref } }
    }
    const id = renamedId(renames, s.componentId)
    return id ? { ...ch, source: { ...s, componentId: id } } : ch
  })
}

// ---------------------------------------------------------------------------
// Logic-analyzer view settings — opaque JSON (shared with the lab store)
// ---------------------------------------------------------------------------

/** Version of the LogicViewSettings envelope this build writes and reads. */
export const LOGIC_VIEW_VERSION = 1
/** Decoder instances kept at most (the analyzer itself shows 8). */
export const MAX_LOGIC_DECODERS = 32
/** Nesting kept inside an opaque decoder / trigger object. */
const MAX_JSON_DEPTH = 8

/** No decoders, analyzer-default trigger. */
export function emptyLogicView(): LogicViewSettings {
  return { v: 1, decoders: [], trigger: null }
}

/**
 * A plain-JSON deep copy: strings, finite numbers, booleans, null, arrays and
 * plain objects (other values — functions, NaN, class instances, deeper than
 * MAX_JSON_DEPTH — are left out); undefined when `v` itself is not one.
 */
function plainJson(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (depth >= MAX_JSON_DEPTH) return undefined
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (const x of v) {
      const c = plainJson(x, depth + 1)
      if (c !== undefined) out.push(c)
    }
    return out
  }
  if (isObject(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const out: RawObject = {}
    for (const [k, x] of Object.entries(v)) {
      const c = plainJson(x, depth + 1)
      if (c !== undefined) out[k] = c
    }
    return out
  }
  return undefined
}

/**
 * Check a LogicViewSettings envelope `{ v, decoders: object[], trigger:
 * object | null }` from storage or a project file. The members stay opaque
 * (the analyzer UI sanitizes their fields); malformed members are dropped
 * with a warning, and an envelope from a NEWER version is ignored whole.
 */
export function sanitizeLogicView(raw: unknown): { view: LogicViewSettings | null; warnings: string[] } {
  const warnings: string[] = []
  if (!isObject(raw)) return { view: null, warnings: ['"logicView" is not an object — ignored'] }
  const v = raw.v ?? LOGIC_VIEW_VERSION
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { view: null, warnings: ['"logicView.v" must be a positive integer — ignored'] }
  }
  if (v > LOGIC_VIEW_VERSION) {
    return {
      view: null,
      warnings: [`logic-analyzer settings v${v} come from a newer ohmlet — ignored (decoders and trigger keep their current settings)`],
    }
  }
  const view = emptyLogicView()
  if (raw.decoders !== undefined) {
    if (!Array.isArray(raw.decoders)) warnings.push('"logicView.decoders" must be an array — ignored')
    else {
      raw.decoders.forEach((d, i) => {
        const c = plainJson(d)
        if (!isObject(c)) warnings.push(`logic decoder #${i} is not an object — dropped`)
        else if (view.decoders.length >= MAX_LOGIC_DECODERS) {
          if (view.decoders.length === MAX_LOGIC_DECODERS && i === MAX_LOGIC_DECODERS) {
            warnings.push(`more than ${MAX_LOGIC_DECODERS} logic decoders — the rest were dropped`)
          }
        } else view.decoders.push(c)
      })
    }
  }
  if (raw.trigger !== undefined && raw.trigger !== null) {
    const t = plainJson(raw.trigger)
    if (isObject(t)) view.trigger = t
    else warnings.push('"logicView.trigger" is not an object — ignored')
  }
  return { view, warnings }
}
