/**
 * Probe actions (UX wave contract K7 — IS-4): "measure this pin / hole /
 * terminal" in one call, shared by the 3D probe menu (ProbeMenu.tsx), the
 * inspector's pin rows (IN-7) and the wire editor (IN-10).
 *
 *   addLogicChannelFor(target, label?)  a logic-analyzer channel on the lowest
 *                                       free index 0..15 (lab.setLogicChannels)
 *   addScopeProbeFor(target)            a REAL scope_probe part in a free hole
 *                                       of the target's strip / rail, on the
 *                                       lowest unused channel 1..4
 *   revealInLogic(t, span?)             open the analyzer and ask it to centre
 *                                       on sim time t (consumed by the LA)
 *   findLogicChannel(target)            the channel already measuring the target's net
 *   findScopeProbe(target)              the scope probe already on the target's net
 *                                       (SC-14: the probe menu says 「在邏輯分析儀中顯示」
 *                                       / 「這個網路已由 P1 量測」 instead of adding again)
 *   flashLogicChannel(index)            show + flash that analyzer row (useLogicFlash)
 *   flashScopeChannel(channel)          show + flash that scope CH chip (useScopeFlash)
 *
 * Targets: an MCU board pin (catalog pin name, e.g. 'PA5'), a board hole, or
 * an off-board terminal ('PS1:+'). A hole holding an MCU GPIO pin resolves to
 * that pin (exact digital channel); every other hole / terminal becomes a
 * 'net' source. Every action toasts its outcome (cause + what to do on a
 * refusal) and returns it, so callers can reflect it inline. Duplicates are
 * refused by electrical net (a channel on PA5 already covers the LED anode
 * wired to it). Nothing here runs per frame; the netlist is built per call.
 */
import { create, type StoreApi } from 'zustand'
import type { CircuitLayout, HoleRef } from '../../model/types'
import { BOARD_SIZES, boardConfigOf } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { componentPinHoles, formatHole, isHoleOnBoard, netIdForHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { buildNetlist, type Netlist } from '../../sim/netlist'
import type { LogicChannelConfig, LogicSource } from '../../sim/coordinator/api'
import type { SceneProbeTarget } from '../../three/scene-api'
import { placementValid, useStore } from '../../state/store'
import { showToast, tick, type ToastAction } from '../kit'
import { t } from '../../i18n'
import { isLegacyChrome, isWorkspaceShowing } from '../chrome/legacy'
import { revealInstrument } from './instruments/instrument-request'
import { railName } from '../workspace/hole-chip'
import { useLab } from './lab'
import type { LogicDecoderConfig } from './logic-decoders'
import { newDecoderConfig, sanitizeDecoderConfigs } from './instruments/la-config'
import { busByKey, uartDecoderOptions, uartFormat } from './instruments/buses'
import { channelDisplayName } from './instruments/channel-name'

export type ProbeTarget =
  | { kind: 'mcu-pin'; componentId: string; pin: string }
  | { kind: 'hole'; ref: string }
  | { kind: 'terminal'; ref: string }

/** Logic-analyzer channel indices (D0..D15). */
export const LOGIC_CHANNELS = 16
/** Oscilloscope channels (CH1..CH4). */
export const SCOPE_CHANNELS = 4

/** A probe target the circuit actually has. */
export type ResolvedProbeTarget =
  | {
      kind: 'mcu-pin'
      componentId: string
      pin: string
      /** canonical hole the pin sits in (null: not resolvable on this rig) */
      hole: string | null
      /** default channel label: the port name ('PA5'; 'U2.PA5' with several boards) */
      label: string
    }
  | {
      kind: 'net'
      /** canonical hole ref or terminal ref of the probed point */
      ref: string
      hole: string | null
      label: string
    }

export type ProbeResult = { ok: true; target: ResolvedProbeTarget } | { ok: false; reason: string }

/** The scene's {hole?, terminal?} as a ProbeTarget (null when neither is set). */
export function probeTargetFromScene(target: SceneProbeTarget): ProbeTarget | null {
  if (target.hole) return { kind: 'hole', ref: target.hole }
  if (target.terminal) return { kind: 'terminal', ref: target.terminal }
  return null
}

/** Human text of a raw target (refusal messages). */
function targetText(target: ProbeTarget): string {
  return target.kind === 'mcu-pin' ? `${target.componentId} ${target.pin}` : target.ref
}

function mcuBoardCount(layout: CircuitLayout): number {
  return layout.components.filter((c) => getEntry(c.type)?.mcu).length
}

/** The MCU GPIO pin sitting in canonical hole `ref`, if any. */
function mcuPinInHole(layout: CircuitLayout, ref: string): { componentId: string; pin: string } | null {
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry?.mcu) continue
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    const i = holes.findIndex((h) => h !== null && formatHole(h) === ref)
    if (i >= 0 && entry.mcu.pinMap[entry.pins[i]]) return { componentId: comp.id, pin: entry.pins[i] }
  }
  return null
}

/** Resolve `target` against `layout` (pure). */
export function resolveProbeTarget(target: ProbeTarget, layout: CircuitLayout = useStore.getState().layout): ProbeResult {
  const missing = { ok: false as const, reason: t('{target} was not found in the circuit', { target: targetText(target) }) }
  if (target.kind === 'mcu-pin') {
    const comp = layout.components.find((c) => c.id === target.componentId)
    const entry = comp ? getEntry(comp.type) : undefined
    const i = entry ? entry.pins.indexOf(target.pin) : -1
    if (!comp || !entry || i < 0) return missing
    const holes = entry.placement === 'offboard' ? null : componentPinHoles(comp, entry, boardConfigOf(layout))
    const h = holes?.[i] ?? null
    const hole = h ? formatHole(h) : null
    const port = entry.mcu?.pinMap[target.pin]
    if (!port) {
      // a power / control pin: measure its net instead of a GPIO channel
      if (!hole) return missing
      return { ok: true, target: { kind: 'net', ref: hole, hole, label: hole } }
    }
    const label = mcuBoardCount(layout) > 1 ? `${comp.id}.${port}` : port
    return { ok: true, target: { kind: 'mcu-pin', componentId: comp.id, pin: target.pin, hole, label } }
  }
  if (target.kind === 'hole') {
    const h = parseHole(target.ref)
    if (!h || !isHoleOnBoard(h, boardConfigOf(layout))) return missing
    const ref = formatHole(h)
    const pin = mcuPinInHole(layout, ref)
    if (pin) return resolveProbeTarget({ kind: 'mcu-pin', ...pin }, layout)
    return { ok: true, target: { kind: 'net', ref, hole: ref, label: ref } }
  }
  const term = parseTerminalRef(target.ref)
  const comp = term ? layout.components.find((c) => c.id === term.componentId) : undefined
  const entry = comp ? getEntry(comp.type) : undefined
  if (!term || !entry || entry.placement !== 'offboard' || !entry.pins.includes(term.pin)) return missing
  const ref = `${term.componentId}:${term.pin}`
  return { ok: true, target: { kind: 'net', ref, hole: null, label: ref } }
}

// ---------------------------------------------------------------------------
// nets
// ---------------------------------------------------------------------------

/** Endpoint ref a logic source measures (null when it cannot be placed on this rig). */
export function logicSourceEndpoint(source: LogicSource, layout: CircuitLayout): string | null {
  return sourceEndpoint(source, layout)
}

function sourceEndpoint(source: LogicSource, layout: CircuitLayout): string | null {
  if (source.kind === 'net') return source.ref
  const comp = layout.components.find((c) => c.id === source.componentId)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry) return null
  const pin = source.kind === 'mcu-pin' ? source.pin : entry.pins[0]
  const i = entry.pins.indexOf(pin)
  const holes = i >= 0 ? componentPinHoles(comp, entry, boardConfigOf(layout)) : null
  const h = holes?.[i]
  return h ? formatHole(h) : null
}

function sourceKey(s: LogicSource): string {
  return s.kind === 'probe' ? `probe|${s.componentId}` : s.kind === 'mcu-pin' ? `mcu|${s.componentId}|${s.pin}` : `net|${s.ref}`
}

/** Merged net of an endpoint ('' when the netlist does not know it). */
function netOf(netlist: Netlist, ref: string | null): string {
  return ref ? netlist.netOf(ref) ?? '' : ''
}

/** Every component / wire on the target's electrical net ("選取接在這裡的元件"). */
export function netMembersFor(
  target: ProbeTarget,
  layout: CircuitLayout = useStore.getState().layout,
): { net: string | null; componentIds: string[]; wireIds: string[] } {
  const r = resolveProbeTarget(target, layout)
  const none = { net: null, componentIds: [], wireIds: [] }
  if (!r.ok) return none
  const ref = r.target.kind === 'net' ? r.target.ref : r.target.hole
  const netlist = buildNetlist(layout)
  const net = ref ? netlist.netOf(ref) : null
  if (!net) return none
  const config = boardConfigOf(layout)
  const componentIds: string[] = []
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    const refs =
      entry.placement === 'offboard'
        ? entry.pins.map((p) => `${comp.id}:${p}`)
        : (componentPinHoles(comp, entry, config) ?? []).map((h) => (h ? formatHole(h) : null))
    if (refs.some((x) => x !== null && netlist.netOf(x) === net)) componentIds.push(comp.id)
  }
  const wireIds = layout.wires.filter((w) => netlist.netOf(w.from) === net || netlist.netOf(w.to) === net).map((w) => w.id)
  return { net, componentIds, wireIds }
}

// ---------------------------------------------------------------------------
// logic analyzer
// ---------------------------------------------------------------------------

/** Lowest logic channel index not in use (null when all 16 are taken). */
export function nextLogicIndex(channels: readonly LogicChannelConfig[]): number | null {
  const used = new Set(channels.map((c) => c.index))
  for (let i = 0; i < LOGIC_CHANNELS; i++) if (!used.has(i)) return i
  return null
}

/**
 * Point the instruments at `tab`: the desktop tray opens on it; on a phone
 * the 「儀器」 sheet opens on it next (and follows now when open) — the board
 * stays in view (revealInstrument; the classic chrome is untouched).
 */
function showTray(tab: 'logic' | 'scope'): void {
  revealInstrument(tab)
}

/**
 * 「在儀器中查看」 on a probe toast where no tray shows the instrument (a phone,
 * a narrow window): one tap brings the 儀器 sheet up on it (`then`: flash the
 * row / chip again — the first flash fired while the sheet was closed). None
 * in the workspace (the tray already shows it) or the classic chrome.
 */
function viewAction(tab: 'logic' | 'scope', then?: () => void): ToastAction | undefined {
  if (isLegacyChrome() || isWorkspaceShowing()) return undefined
  return {
    label: t('View in Instruments'),
    run: () => {
      revealInstrument(tab, { open: true })
      then?.()
    },
  }
}

/**
 * The analyzer row a moment ago asked to flash (the probe menu's
 * 「在邏輯分析儀中顯示」, a channel that already measures the net). The
 * logic analyzer reads it and flashes that row's label and trace.
 */
export const useLogicFlash = create<{ index: number | null; seq: number; at: number }>(() => ({ index: null, seq: 0, at: 0 }))

/**
 * Show the analyzer row of channel `index` (0..15): the instruments on the
 * analyzer, the row scrolled into view and flashed (SC-14 (3) / IS-13).
 */
export function flashLogicChannel(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= LOGIC_CHANNELS) return
  showTray('logic')
  useLogicFlash.setState((s) => ({ index, seq: s.seq + 1, at: Date.now() }))
}

export interface LogicChannelResult {
  ok: boolean
  index?: number
  reason?: string
}

/** A channel for `target`, found or added — no toast, no tray switch (shared by the actions below). */
export interface EnsuredChannel {
  ok: boolean
  index?: number
  /** the channel was added now (false: an existing one already measures this net) */
  added?: boolean
  /** label of the channel that measures it */
  label?: string
  reason?: string
}

/**
 * The logic channel that measures `target`: an existing one on the same
 * source or electrical net, else a new one on the lowest free index
 * (lab.setLogicChannels). Silent — callers toast.
 */
export function ensureLogicChannel(target: ProbeTarget, label?: string): EnsuredChannel {
  const layout = useStore.getState().layout
  const r = resolveProbeTarget(target, layout)
  if (!r.ok) return { ok: false, reason: r.reason }
  const lab = useLab.getState()
  const channels = lab.logicChannels
  const source: LogicSource =
    r.target.kind === 'mcu-pin'
      ? { kind: 'mcu-pin', componentId: r.target.componentId, pin: r.target.pin }
      : { kind: 'net', ref: r.target.ref }
  const name = label?.trim() || r.target.label

  // duplicates: the same source, or another source on the same electrical net
  const netlist = buildNetlist(layout)
  const key = sourceKey(source)
  const net = netOf(netlist, sourceEndpoint(source, layout))
  const dup = channels.find(
    (c) => sourceKey(c.source) === key || (net !== '' && netOf(netlist, sourceEndpoint(c.source, layout)) === net),
  )
  if (dup) return { ok: true, index: dup.index, added: false, label: dup.label }

  const index = nextLogicIndex(channels)
  if (index === null) return { ok: false, reason: t('All 16 logic analyzer channels are in use — remove one first') }
  lab.setLogicChannels([...channels, { index, label: name, source }].sort((a, b) => a.index - b.index))
  return { ok: true, index, added: true, label: name }
}

/** The logic channel already measuring `target` (same source or same net), or null. Never adds. */
export function findLogicChannel(target: ProbeTarget, layout: CircuitLayout = useStore.getState().layout): LogicChannelConfig | null {
  const r = resolveProbeTarget(target, layout)
  if (!r.ok) return null
  const source: LogicSource =
    r.target.kind === 'mcu-pin'
      ? { kind: 'mcu-pin', componentId: r.target.componentId, pin: r.target.pin }
      : { kind: 'net', ref: r.target.ref }
  const netlist = buildNetlist(layout)
  const key = sourceKey(source)
  const net = netOf(netlist, sourceEndpoint(source, layout))
  return (
    useLab
      .getState()
      .logicChannels.find(
        (c) => sourceKey(c.source) === key || (net !== '' && netOf(netlist, sourceEndpoint(c.source, layout)) === net),
      ) ?? null
  )
}

/**
 * Add a logic-analyzer channel for `target` on the lowest free index. A
 * target already measured (same source, or another source on the same net)
 * is refused with the channel that has it. Toasts the outcome. The analyzer
 * auto-fits its window to the new channel by itself (UX IS-1).
 */
export function addLogicChannelFor(target: ProbeTarget, label?: string): LogicChannelResult {
  const fail = (reason: string): LogicChannelResult => {
    showToast(reason, { duration: 3600 })
    return { ok: false, reason }
  }
  const e = ensureLogicChannel(target, label)
  if (!e.ok || e.index === undefined) return fail(e.reason ?? t('{target} was not found in the circuit', { target: targetText(target) }))
  // the channel by the name the analyzer shows (UX IS-13): 「D1 陽極（長腳）」, 「PA5（板上 A5）」
  const layout = useStore.getState().layout
  const ch = useLab.getState().logicChannels.find((c) => c.index === e.index)
  const name = ch ? channelDisplayName(layout, ch).name : e.label ?? ''
  const index = e.index
  if (!e.added) {
    // like the scope's duplicate probe: show the row that already has it
    flashLogicChannel(index)
    const reason = t('{label} is already on the logic analyzer', { label: name })
    showToast(reason, { duration: 3600, action: viewAction('logic', () => flashLogicChannel(index)) })
    return { ok: false, reason }
  }
  tick()
  showTray('logic')
  const view = viewAction('logic', () => flashLogicChannel(index))
  showToast(
    // a phone: the sheet is one tap away on the toast (the classic chrome keeps its text)
    isWorkspaceShowing() || view
      ? t('Added {label} to the logic analyzer', { label: name })
      : t('Added {label} to the logic analyzer — open Instruments to see it', { label: name }),
    view ? { action: view } : {},
  )
  return { ok: true, index }
}

// ---------------------------------------------------------------------------
// buses (UX IS-7): channels + decoder in one step
// ---------------------------------------------------------------------------

export interface BusResult {
  ok: boolean
  /** channel indices of the bus signals, in BusDef.signals order */
  channels?: number[]
  /** decoder instance ids added (empty: the decoder was already there) */
  decoders?: string[]
  reason?: string
}

/**
 * Put bus `busKey` ('USART1', 'I2C1', 'SPI1', 'I2C1-remap' …) of MCU board
 * `componentId` on the logic analyzer: a channel per signal (existing ones
 * on the same nets are reused, labelled 'PA9 TX' / 'PB6 SCL' …) and the
 * decoder — for a USART one per direction, with the baud rate and frame
 * format the firmware programmed when the lab knows them (else auto baud).
 * Opens the analyzer and toasts the outcome.
 */
export function addBusFor(componentId: string, key: string): BusResult {
  const fail = (reason: string): BusResult => {
    showToast(reason, { duration: 3600 })
    return { ok: false, reason }
  }
  const bus = busByKey(key)
  const layout = useStore.getState().layout
  const comp = layout.components.find((c) => c.id === componentId)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!bus || !comp || !entry?.mcu) return fail(t('{target} was not found in the circuit', { target: `${componentId} ${key}` }))
  const prefix = mcuBoardCount(layout) > 1 ? `${componentId}.` : ''
  const indices: number[] = []
  for (const s of bus.signals) {
    // the catalog pin that carries this port pin (Blue Pill: the same name)
    const pin = Object.keys(entry.mcu.pinMap).find((p) => entry.mcu!.pinMap[p] === s.pin) ?? s.pin
    const e = ensureLogicChannel({ kind: 'mcu-pin', componentId, pin }, `${prefix}${s.pin} ${s.name}`)
    if (!e.ok || e.index === undefined) return fail(e.reason ?? t('{target} was not found in the circuit', { target: `${componentId} ${s.pin}` }))
    indices.push(e.index)
  }
  const lab = useLab.getState()
  const existing = sanitizeDecoderConfigs(lab.logicView.decoders)
  const channels = lab.logicChannels
  const added: LogicDecoderConfig[] = []
  const has = (decoder: string, map: Record<string, number>) =>
    [...existing, ...added].some(
      (d) => d.decoder === decoder && Object.entries(map).every(([role, ch]) => d.channels[role] === ch),
    )
  const make = (decoder: string, map: Record<string, number>, options: Record<string, string>) => {
    if (has(decoder, map)) return
    const base = newDecoderConfig(decoder, channels, [...existing, ...added])
    if (base) added.push({ ...base, channels: map, options })
  }
  const uart = lab.mcus[componentId]?.uarts.find((u) => u.name === bus.id)?.config
  if (bus.kind === 'uart') {
    const opts = uartDecoderOptions(uart)
    bus.signals.forEach((_, k) => make('uart', { data: indices[k] }, opts))
  } else if (bus.kind === 'i2c') {
    make('i2c', { scl: indices[0], sda: indices[1] }, { addressFormat: '7bit' })
  } else {
    const map: Record<string, number> = {}
    bus.signals.forEach((s, k) => (map[s.role] = indices[k]))
    make('spi', map, {})
  }
  if (added.length > 0) lab.setLogicView({ decoders: [...existing, ...added] as unknown as Record<string, unknown>[] })
  tick()
  showTray('logic')
  const pins = bus.signals.map((s) => s.pin).join(t(', '))
  const fmt = bus.kind === 'uart' ? uartFormat(uart) : null
  const decoderName = bus.kind === 'uart' ? 'UART' : bus.kind === 'i2c' ? 'I²C' : 'SPI'
  const view = viewAction('logic')
  showToast(
    added.length === 0
      ? t('{bus} is already on the logic analyzer ({pins})', { bus: bus.id, pins })
      : fmt
        ? t('Added {bus}: {pins} and the {decoder} decoder ({format})', { bus: bus.id, pins, decoder: decoderName, format: fmt })
        : t('Added {bus}: {pins} and the {decoder} decoder', { bus: bus.id, pins, decoder: decoderName }),
    view ? { action: view } : {},
  )
  return { ok: true, channels: indices, decoders: added.map((d) => d.id ?? d.decoder) }
}

// ---------------------------------------------------------------------------
// oscilloscope
// ---------------------------------------------------------------------------

/** Lowest scope channel 1..4 no placed scope_probe uses (null when all four are taken). */
export function nextScopeChannel(layout: CircuitLayout = useStore.getState().layout): number | null {
  const used = new Set<number>()
  for (const c of layout.components) {
    if (c.type !== 'scope_probe') continue
    used.add(Number(c.params?.channel ?? 1))
  }
  for (let ch = 1; ch <= SCOPE_CHANNELS; ch++) if (!used.has(ch)) return ch
  return null
}

/** The breadboard hole a scope probe should share a strip / rail with (null: none reachable). */
function anchorHole(r: ResolvedProbeTarget, layout: CircuitLayout): string | null {
  if (r.hole) return r.hole
  if (r.kind !== 'net') return null
  // an off-board terminal: the first breadboard hole a wire takes it to
  for (const w of layout.wires) {
    const other = w.from === r.ref ? w.to : w.to === r.ref ? w.from : null
    const h = other ? parseHole(other) : null
    if (h) return formatHole(h)
  }
  return null
}

/**
 * Free holes on the same 5-hole strip (or the same rail) as `ref`, nearest
 * first — `ref` itself first when it is free (a right-click on the one empty
 * hole of a Blue Pill pin strip, UX QA IS-F5) — where a scope probe can go
 * right now (pure; exported for tests).
 */
export function probeHolesNear(layout: CircuitLayout, ref: HoleRef): string[] {
  const h = parseHole(ref)
  if (!h) return []
  const config = boardConfigOf(layout)
  const out: string[] = []
  const tryHole = (cand: Parameters<typeof formatHole>[0]) => {
    if (!isHoleOnBoard(cand, config)) return
    const c = formatHole(cand)
    if (!out.includes(c) && placementValid(layout, 'scope_probe', c)) out.push(c)
  }
  const boardRow = h.boardRow
  if (h.kind === 'strip') {
    const half = 'abcde'.includes(h.row) ? 'abcde' : 'fghij'
    const at = half.indexOf(h.row)
    const rows = [...half].sort((a, b) => Math.abs(half.indexOf(a) - at) - Math.abs(half.indexOf(b) - at))
    for (const row of rows) {
      tryHole(boardRow ? { kind: 'strip', col: h.col, row: row as typeof h.row, boardRow } : { kind: 'strip', col: h.col, row: row as typeof h.row })
    }
    return out
  }
  const total = BOARD_SIZES[config.size].railHoles * config.count
  tryHole(h) // the rail hole asked about, when free
  for (let d = 1; d < total && out.length < 4; d++) {
    for (const index of [h.index - d, h.index + d]) {
      if (index < 0 || index >= total) continue
      tryHole(boardRow ? { kind: 'rail', rail: h.rail, index, boardRow } : { kind: 'rail', rail: h.rail, index })
    }
  }
  return out
}

/**
 * Where a scope probe for `anchor` can go: a free hole of its own strip /
 * rail first (probeHolesNear); when that is full, a free hole of another
 * strip or rail on the SAME electrical net (same voltage — joined by wires
 * or a board's internal bridges). Nearest-first inside a strip; nets are
 * walked in layout order. Empty when the whole net is full (pure).
 */
export function probeHolesOnNet(layout: CircuitLayout, anchor: HoleRef): string[] {
  const own = probeHolesNear(layout, anchor)
  if (own.length > 0) return own
  const a = parseHole(anchor)
  if (!a) return []
  const netlist = buildNetlist(layout)
  const net = netlist.netOf(formatHole(a))
  if (!net) return []
  const config = boardConfigOf(layout)
  const used: string[] = []
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard') continue
    for (const h of componentPinHoles(comp, entry, config) ?? []) if (h) used.push(formatHole(h))
  }
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      const h = parseHole(end)
      if (h) used.push(formatHole(h))
    }
  }
  const seen = new Set<string>([netIdForHole(a)])
  for (const ref of used) {
    const h = parseHole(ref)
    if (!h || seen.has(netIdForHole(h)) || netlist.netOf(ref) !== net) continue
    seen.add(netIdForHole(h))
    const free = probeHolesNear(layout, ref)
    if (free.length > 0) return free
  }
  return []
}

export interface ScopeProbeResult {
  ok: boolean
  componentId?: string
  channel?: number
  reason?: string
  /** refused because this probe already measures the net (addScopeProbeFor without allowDuplicate) */
  existing?: ScopeProbeOnNet
}

/** A placed scope probe and its channel. */
export interface ScopeProbeOnNet {
  componentId: string
  /** 1..4 */
  channel: number
  hole: string
}

/** The scope probe already on `target`'s electrical net (lowest channel first), or null. */
export function findScopeProbe(target: ProbeTarget, layout: CircuitLayout = useStore.getState().layout): ScopeProbeOnNet | null {
  const r = resolveProbeTarget(target, layout)
  if (!r.ok) return null
  const anchor = anchorHole(r.target, layout)
  const netlist = buildNetlist(layout)
  const net = anchor ? netlist.netOf(anchor) : r.target.kind === 'net' ? netlist.netOf(r.target.ref) : null
  if (!net) return null
  let best: ScopeProbeOnNet | null = null
  for (const c of layout.components) {
    const hole = c.type === 'scope_probe' ? c.holes?.[0] : undefined
    if (!hole || netlist.netOf(hole) !== net) continue
    const channel = Number(c.params?.channel ?? 1)
    if (!best || channel < best.channel) best = { componentId: c.id, channel, hole }
  }
  return best
}

/**
 * The scope's channel chip a moment ago asked to flash (a probe action
 * pointing at a channel that already shows the net). ScopeView reads it.
 */
export const useScopeFlash = create<{ channel: number | null; seq: number; at: number }>(() => ({ channel: null, seq: 0, at: 0 }))

/**
 * Show the scope channel `channel` (1..4): the instruments on the scope, its
 * CH chip flashed (the probe menu's 「在示波器中顯示（CH1）」, a duplicate probe).
 */
export function flashScopeChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 1 || channel > SCOPE_CHANNELS) return
  showTray('scope')
  useScopeFlash.setState((s) => ({ channel, seq: s.seq + 1, at: Date.now() }))
}

// A request written straight into a flash store without its time (a caller
// that bumps `seq` only) is stamped now, so the view still treats it as fresh.
function stampFresh<S extends { seq: number; at: number }>(store: StoreApi<S>): void {
  store.subscribe((s, p) => {
    if (s.seq !== p.seq && s.at === p.at) store.setState({ at: Date.now() } as Partial<S>)
  })
}
stampFresh(useScopeFlash)
stampFresh(useLogicFlash)

/**
 * Place a real scope_probe in a free hole of the target's strip / rail
 * (else elsewhere on the same net — probeHolesOnNet) on the lowest unused
 * channel: store.addComponent gives a new probe the lowest unused channel
 * itself (IS-4), so this is ONE undo step; the setParam fallback only runs
 * if a store without that default is in use. Opens the scope tab and
 * toasts the outcome.
 */
export async function addScopeProbeFor(target: ProbeTarget, opts: { allowDuplicate?: boolean } = {}): Promise<ScopeProbeResult> {
  const st = useStore.getState()
  const layout = st.layout
  const fail = (reason: string): ScopeProbeResult => {
    showToast(reason, { duration: 3600 })
    return { ok: false, reason }
  }
  const r = resolveProbeTarget(target, layout)
  if (!r.ok) return fail(r.reason)
  // one net, one probe — like the analyzer's one channel per net (UX IS-13): show the
  // channel that already has it (the caller may offer 「仍要再放一支」 → allowDuplicate)
  const existing = opts.allowDuplicate ? null : findScopeProbe(target, layout)
  if (existing) {
    flashScopeChannel(existing.channel)
    const reason = t('This net is already measured by {id} (CH{n})', { id: existing.componentId, n: existing.channel })
    // a deliberate second probe stays one tap away (the probe menu's 「再放一支示波器探棒」)
    const more = !isLegacyChrome() && nextScopeChannel(layout) !== null
    showToast(
      reason,
      more
        ? { duration: 3600, action: { label: t('Place another probe anyway'), run: () => void addScopeProbeFor(target, { allowDuplicate: true }) } }
        : { duration: 3600 },
    )
    return { ok: false, reason, existing }
  }
  const channel = nextScopeChannel(layout)
  if (channel === null) return fail(t('All four scope channels are in use — move or remove a probe first'))
  const anchor = anchorHole(r.target, layout)
  if (!anchor) return fail(t('{target} is not wired to the breadboard, so a probe cannot reach it', { target: r.target.label }))
  const hole = probeHolesOnNet(layout, anchor)[0]
  if (!hole) {
    return fail(t('The net of {hole} has no free hole — free a hole on its strip, or wire the net to an empty strip', { hole: anchor }))
  }

  const before = layout.components.length
  st.addComponent('scope_probe', { holes: [hole] })
  const comps = useStore.getState().layout.components
  const placed = comps.length > before ? comps[comps.length - 1] : undefined
  if (!placed || placed.type !== 'scope_probe') return fail(t('Couldn’t place a scope probe at {hole}', { hole }))
  if (Number(placed.params?.channel ?? 1) !== channel) useStore.getState().setParam(placed.id, 'channel', channel)
  tick()
  showTray('scope')
  const a = parseHole(anchor)
  const at = parseHole(hole)
  const view = viewAction('scope', () => flashScopeChannel(channel))
  showToast(
    at?.kind === 'rail'
      ? t('Placed a scope probe on the {rail} (CH{n})', { rail: railName(at.rail), n: channel })
      : a && at && netIdForHole(a) === netIdForHole(at)
        ? t('Placed a scope probe on the strip of {hole} (CH{n})', { hole: anchor, n: channel })
        : t('The strip of {target} is full — placed the scope probe at {hole} on the same net (CH{n})', {
            target: anchor,
            hole,
            n: channel,
          }),
    view ? { action: view } : {},
  )
  return { ok: true, componentId: placed.id, channel }
}

// ---------------------------------------------------------------------------
// reveal a moment in the logic analyzer
// ---------------------------------------------------------------------------

export interface LogicRevealRequest {
  /** simulation time to centre on (s) */
  t: number
  /** window span (s) */
  span: number
  /** bumps on every request (consumers apply each seq once) */
  seq: number
  /** where marker A goes (default: `t`) — e.g. the start bit of a UART line centred by its middle */
  marker?: number
}

/**
 * The latest "show this moment" request. The logic analyzer (and the phone
 * scope sheet) subscribe and apply each new `seq` once: stop following,
 * centre the window on `t` with `span`, set marker A at `t`.
 */
export const useLogicReveal = create<{ request: LogicRevealRequest | null }>(() => ({ request: null }))

/**
 * Open the logic analyzer on sim time `t` (default span 10 ms), marker A at
 * `marker` (default `t`). Also moves the shared instrument cursor
 * (lab.labCursor) there. Ignores invalid input.
 */
export function revealInLogic(time: number, span = 0.01, marker?: number): void {
  if (!Number.isFinite(time) || time < 0) return
  const s = Number.isFinite(span) && span > 0 ? span : 0.01
  const prev = useLogicReveal.getState().request
  const request: LogicRevealRequest = { t: time, span: s, seq: (prev?.seq ?? 0) + 1 }
  if (marker !== undefined && Number.isFinite(marker) && marker >= 0) request.marker = marker
  useLogicReveal.setState({ request })
  useLab.getState().setLabCursor(request.marker ?? time)
  showTray('logic')
}
