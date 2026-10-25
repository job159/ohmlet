/**
 * Live net activity (UX helper H4 — IS-12): what a net is doing right now,
 * read the same way by the hover chip (SC-12), the MCU pin rows and the
 * wire panel (IN-21) and the problems list (IN-16), so a PWM net never
 * reads 「3.10 V」 in one place and 「0 mV」 in another.
 *
 *   getNetLive(query)        NetLive | null   (non-reactive; null = no simulation data / not in the circuit)
 *   useNetLive(query)        the same as a hook, re-rendering ≤ 4 Hz while the simulation runs
 *   hasActivity(query, t)    true when an edge was seen on the net at or after sim time t
 *   netLiveText(live, opts)  「PWM 1.000 kHz · 34.0 %（平均 1.12 V）」 / 「3.10 V」 / 「訊號變化中（非週期）」 / 「3.10 V（瞬時）」
 *   NetQuery                 a hole / terminal ref ('c20', 'PS1:+'), a part pin ({ componentId, pin }) or a net id ({ net })
 *
 * Where the data comes from (IS-12 (4)): the coordinator records edges ONLY
 * for the logic-analyzer channels (lab.logicChannels; one ring per channel).
 * An MCU-pin net without a channel is NOT recorded — for it getNetLive
 * answers { kind: 'unknown', v, instantaneous: true } with the solver's
 * instantaneous voltage. Recorded nets are classified by
 * src/instruments/measure.ts netLiveSummary over the last NET_LIVE_WINDOW_S
 * of sim time ('pwm' / 'toggling' / 'dc'); a channel added a moment ago
 * reads 'unknown' until its first poll (≤ 250 ms).
 *
 * Activity (hasActivity): an edge on a recorded net (read from the recorder),
 * or — for any net asked about — a level change between two telemetry
 * samples (thresholds 0.8 V / 2.0 V; sampled at the poll rate, so it is
 * evidence of activity, and silence is not proof of none).
 *
 * Rate: a 250 ms poll runs only while someone asks (a mounted useNetLive,
 * or a getNetLive / hasActivity call in the last 5 s) — it reads the
 * recorder (lab.queryLogic, one query in flight at most) while the
 * simulation runs, samples telemetry and bumps the hook version (≤ 4 Hz).
 * Nothing runs per frame. A simulation reset (sim time going back, or the
 * session ending) forgets everything.
 *
 * UX QA IS-F8 — one live summary that matches the logic analyzer:
 *  - a recorded net quiet for the last 100 ms is looked at over a longer
 *    stretch before it is called DC: 3.5 × the period it last showed (or up
 *    to LONG_LOOKBACK_S = 5 s when none is known yet), never before what
 *    this module has seen of its recording (the channel's binding, the
 *    first read) — blink's 1 Hz PA5 reads 「週期訊號 0.998 Hz · 50.0 %」, not
 *    「0 V」 / 「3.10 V」 depending on the moment. The first read of a session
 *    (or after a pause of the poll) reaches back 5 s; later reads stay
 *    incremental, and a small per-net edge history (≤ 512 edges) holds the
 *    rest — never more data per poll than before;
 *  - moving nets say what drives them (NetLive.source): a timer channel
 *    (activePinFunction TIMx_CHy) is a PWM, a decoder's data role is
 *    serial data (「訊號變化中（序列資料）」, the analyzer's own words),
 *    anything else repeating is 「週期訊號 …」;
 *  - a net that holds a supply / battery / regulator output terminal, or an
 *    MCU 3V3 / 5V / GND pin, is steady: { kind: 'dc', v } even unrecorded,
 *    so the inspector does not mark a rail 「瞬時」.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { CircuitLayout } from '../../../model/types'
import { boardConfigOf } from '../../../model/types'
import { getEntry, paramOf } from '../../../model/catalog'
import { componentPinHoles, formatHole, parseHole, parseTerminalRef } from '../../../model/breadboard'
import { buildNetlist, type Netlist } from '../../../sim/netlist'
import type { LogicCapture, LogicChannelConfig } from '../../../sim/coordinator/api'
import { NET_LIVE_WINDOW_S, netLiveSummary, netSummary, type NetHeld, type NetLive, type NetSignalSource } from '../../../instruments/measure'
import { fmtBaud, fmtFreq, fmtPercent, fmtSetting, fmtVoltage, isTrustedVoltage } from '../../../instruments/format'
import { useStore } from '../../../state/store'
import { t } from '../../../i18n'
import { tc } from '../../format'
import { useLab } from '../lab'
import { logicSourceEndpoint } from '../probe-actions'
import { activePinFunction, pinFunctionContext } from './pin-function'
import { isDataChannel, usartLineOnNet } from './signal-readout'
import { sanitizeDecoderConfigs } from './la-config'

export type { NetLive } from '../../../instruments/measure'

/** What to look at: a hole / terminal ref, a part pin, or a resolved net id. */
export type NetQuery = string | { componentId: string; pin: string } | { net: string }

/** Poll period (ms) — the ≤ 4 Hz refresh. */
export const NET_POLL_MS = 250
/** A getNetLive / hasActivity call keeps the poll alive this long (ms). */
const INTEREST_MS = 5000
/** The recorder is never read further back than this per poll (s of sim time). */
const MAX_LOOKBACK_S = 1
/** A fresh read (first of a session, or after a gap) reaches back this far (s of sim time) — the longest look-back. */
export const LONG_LOOKBACK_S = 5
/** A quiet recorded net is judged over this many of its last-seen periods. */
const PERIOD_LOOKBACK = 3.5
/** Edges kept per recorded net for the long look-back (a slow net needs a few; a busy one is judged on 100 ms). */
const HISTORY_EDGES = 512
/** Telemetry thresholds for the activity sampler (V). */
const V_LOW = 0.8
const V_HIGH = 2.0

// ---------------------------------------------------------------------------
// nets
// ---------------------------------------------------------------------------

let netlistCache: { layout: CircuitLayout; netlist: Netlist | null } | null = null
function netlistOf(layout: CircuitLayout): Netlist | null {
  if (netlistCache?.layout === layout) return netlistCache.netlist
  let netlist: Netlist | null = null
  try {
    netlist = buildNetlist(layout)
  } catch {
    netlist = null
  }
  netlistCache = { layout, netlist }
  return netlist
}

/** The merged net id `query` names on `layout` (null when it is not in the circuit). */
export function resolveNet(query: NetQuery, layout: CircuitLayout): string | null {
  const netlist = netlistOf(layout)
  if (!netlist) return null
  if (typeof query === 'string') {
    if (parseHole(query) || parseTerminalRef(query)) return netlist.netOf(query)
    return netlist.nets.includes(query) ? query : null
  }
  if ('net' in query) return netlist.nets.includes(query.net) ? query.net : null
  const comp = layout.components.find((c) => c.id === query.componentId)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry) return null
  if (entry.placement === 'offboard') return netlist.netOf(`${comp.id}:${query.pin}`)
  const i = entry.pins.indexOf(query.pin)
  const h = i >= 0 ? componentPinHoles(comp, entry, boardConfigOf(layout))?.[i] : null
  return h ? netlist.netOf(formatHole(h)) : null
}

/** Logic channel index → the net it records, per (layout, channels) identity. */
let channelCache: { layout: CircuitLayout; channels: readonly LogicChannelConfig[]; byIndex: Map<number, string>; nets: Set<string> } | null =
  null
function channelNets(layout: CircuitLayout, channels: readonly LogicChannelConfig[]): { byIndex: Map<number, string>; nets: Set<string> } {
  if (channelCache?.layout === layout && channelCache.channels === channels) return channelCache
  const byIndex = new Map<number, string>()
  const nets = new Set<string>()
  const netlist = netlistOf(layout)
  if (netlist) {
    for (const ch of channels) {
      const ref = logicSourceEndpoint(ch.source, layout)
      const net = ref ? netlist.netOf(ref) : null
      if (!net) continue
      byIndex.set(ch.index, net)
      nets.add(net)
    }
  }
  channelCache = { layout, channels, byIndex, nets }
  return channelCache
}

// ---------------------------------------------------------------------------
// state (module level — never React state)
// ---------------------------------------------------------------------------

/** recorded net → its classification at the last poll */
const live = new Map<string, NetLive>()
/** net → newest edge time seen (recorder or telemetry sampling) */
const lastEdge = new Map<string, number>()
/** net → the high level (V) last observed in telemetry */
const highLevel = new Map<string, number>()
/** net → thresholded level of the previous telemetry sample */
const sampledLevel = new Map<string, 0 | 1>()
/** net → wall ms it was last asked about (the telemetry sampler watches these) */
const watched = new Map<string, number>()
/** recorded net → the edges seen of it (for the long look-back of a quiet net) */
interface NetHistory {
  /** the channel's binding time the edges belong to (a new source starts over) */
  since: number
  /** knowledge starts here; level `initial` until the first kept edge */
  t0: number
  t1: number
  initial: 0 | 1 | 2
  times: number[]
  levels: number[]
}
const history = new Map<string, NetHistory>()
/** recorded net → the period of its last periodic classification (s) */
const periodOf = new Map<string, number>()
/** sim time the recorder has been read up to */
let polledTo = Number.NEGATIVE_INFINITY
/** sim time of the last look (a reset — time going back — forgets everything) */
let seenTime = 0
/** the simulation was seen running since the last reset: a stop now is a PAUSE (「暫停前：…」 is a claim about a run we saw) */
let sawRunning = false

let version = 0
const listeners = new Set<() => void>()
let subscribers = 0
let interestUntil = 0
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let hadTelemetry = false

const wallNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function bump(): void {
  version++
  for (const l of listeners) l()
}

function forget(): void {
  live.clear()
  history.clear()
  periodOf.clear()
  lastEdge.clear()
  highLevel.clear()
  sampledLevel.clear()
  polledTo = Number.NEGATIVE_INFINITY
  sawRunning = false
}

/**
 * Drop everything when the simulation went back in time (a reset; opening
 * an example or a lesson resets too). Edits keep the observations: net ids
 * of untouched strips survive, and a runtime param (a knob, a held button)
 * must not wipe the evidence the problems list relies on.
 */
function checkEpoch(simTime: number): void {
  if (simTime < seenTime) forget()
  seenTime = simTime
}

function noteInterest(net: string | null): void {
  const now = wallNow()
  interestUntil = now + INTEREST_MS
  if (net) watched.set(net, now)
  ensureTimer()
}

function ensureTimer(): void {
  if (timer !== null || typeof setInterval !== 'function') return
  timer = setInterval(tick, NET_POLL_MS)
}

function stopTimer(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

/** One telemetry sample of the watched and recorded nets: high levels and level changes. */
function sampleTelemetry(recorded: ReadonlySet<string>): void {
  const tel = useStore.getState().telemetry
  if (!tel) return
  const now = wallNow()
  for (const [net, at] of watched) if (now - at > INTEREST_MS) watched.delete(net)
  const nets = new Set<string>([...watched.keys(), ...recorded])
  for (const net of nets) {
    const v = tel.netVoltages[net]
    if (!isTrustedVoltage(v)) continue
    const level = v >= V_HIGH ? 1 : v <= V_LOW ? 0 : null
    if (level === null) continue
    if (level === 1) highLevel.set(net, v)
    const prev = sampledLevel.get(net)
    if (prev !== undefined && prev !== level) lastEdge.set(net, Math.max(lastEdge.get(net) ?? Number.NEGATIVE_INFINITY, tel.time))
    sampledLevel.set(net, level)
  }
}

function tick(): void {
  const st = useStore.getState()
  if (subscribers === 0 && wallNow() > interestUntil) {
    stopTimer()
    return
  }
  checkEpoch(st.simTime)
  if (st.running) sawRunning = true
  if (!st.telemetry) {
    // the session ended (resetSim): forget it; hooks fall back to null once
    if (hadTelemetry) {
      forget()
      bump()
    }
    hadTelemetry = false
    return
  }
  hadTelemetry = true
  const { nets } = channelNets(st.layout, useLab.getState().logicChannels)
  sampleTelemetry(nets)
  const now = st.simTime
  if (inFlight || nets.size === 0 || (!st.running && polledTo >= now)) {
    if (st.running) bump()
    return
  }
  // a fresh read reaches back for the long look-back; later reads stay incremental
  const fresh = !(polledTo > Number.NEGATIVE_INFINITY) || now - polledTo > MAX_LOOKBACK_S
  const t0 = fresh ? Math.max(now - LONG_LOOKBACK_S, 0) : Math.max(Math.min(polledTo, now - NET_LIVE_WINDOW_S), now - MAX_LOOKBACK_S, 0)
  inFlight = true
  const layout = st.layout
  useLab
    .getState()
    .queryLogic(t0, now)
    .then((capture) => {
      // a capture of a circuit that is gone describes nothing any more
      if (useStore.getState().layout === layout) ingestCapture(capture)
    })
    .catch(() => {
      /* no host / the query failed: the 'unknown' path stays honest */
    })
    .finally(() => {
      inFlight = false
    })
}

/**
 * Fold one recorder capture into the live state (the poll does this; tests
 * call it directly). Every trace whose channel records a net updates that
 * net's classification (over the last NET_LIVE_WINDOW_S before the end of
 * the capture's query window, `t1` — never its later `tNow`) and its newest
 * edge.
 */
export function ingestCapture(
  capture: LogicCapture,
  ctx: { layout?: CircuitLayout; channels?: readonly LogicChannelConfig[] } = {},
): void {
  const layout = ctx.layout ?? useStore.getState().layout
  const channels = ctx.channels ?? useLab.getState().logicChannels
  checkEpoch(useStore.getState().simTime)
  if (useStore.getState().running) sawRunning = true
  const { byIndex } = channelNets(layout, channels)
  // the traces hold the edges of the QUERY window [t0, t1]; tNow is later
  // when the simulation advanced while the query was in flight, and edges
  // after t1 are not in this capture — classifying up to tNow would see an
  // empty tail (a steady PWM read as 'toggling'), and reading the recorder
  // "up to tNow" would skip those edges for hasActivity
  const t1 = Math.min(capture.t1, capture.tNow ?? capture.t1)
  const tel = useStore.getState().telemetry
  for (const tr of capture.traces) {
    const net = byIndex.get(tr.index)
    if (!net) continue
    const since = tr.since ?? Number.NEGATIVE_INFINITY
    for (let i = tr.times.length - 1; i >= 0; i--) {
      const at = tr.times[i]
      if (at > t1) continue
      if (at <= polledTo || at < since) break
      lastEdge.set(net, Math.max(lastEdge.get(net) ?? Number.NEGATIVE_INFINITY, at))
      break
    }
    const v = tel?.netVoltages[net]
    const h = remember(net, tr, capture.t0, t1)
    const input = { v: typeof v === 'number' ? v : null, vHigh: highLevel.get(net) ?? null }
    let res = netLiveSummary({ trace: tr, t0: t1 - NET_LIVE_WINDOW_S, t1, ...input })
    if (res.kind !== 'pwm' && res.kind !== 'toggling') {
      // quiet for 100 ms: a slow signal is not DC — look back over its own
      // period (or up to 5 s), never before what was seen of its recording
      const p = periodOf.get(net)
      const span = p !== undefined ? Math.min(LONG_LOOKBACK_S, Math.max(NET_LIVE_WINDOW_S, PERIOD_LOOKBACK * p)) : LONG_LOOKBACK_S
      const from = Math.max(t1 - span, h.t0)
      if (t1 - from > NET_LIVE_WINDOW_S) {
        const trace = { initial: h.initial, times: Float64Array.from(h.times), levels: Uint8Array.from(h.levels) }
        const long = netLiveSummary({ trace, t0: from, t1, ...input })
        if (long.kind === 'pwm' || (long.kind === 'toggling' && netSummary(trace, from, t1).edges >= 2)) res = long
      }
    }
    if (res.kind === 'pwm') periodOf.set(net, 1 / res.f)
    live.set(net, res)
  }
  polledTo = Math.max(polledTo, t1)
  bump()
}

/**
 * Fold capture trace `tr` (query window [capT0, capT1]) into net's edge
 * history: the edges kept from before the capture, then the capture's own;
 * a new channel binding (`since`) or a gap since the last read starts over.
 * Keeps the last LONG_LOOKBACK_S and at most HISTORY_EDGES edges.
 */
function remember(net: string, tr: LogicCapture['traces'][number], capT0: number, capT1: number): NetHistory {
  const since = tr.since ?? Number.NEGATIVE_INFINITY
  const prev = history.get(net)
  let h: NetHistory
  if (!prev || prev.since !== since || capT0 > prev.t1 + 1e-9) {
    h = { since, t0: Math.max(capT0, since), t1: capT1, initial: tr.initial, times: Array.from(tr.times), levels: Array.from(tr.levels) }
  } else {
    let k = prev.times.length
    while (k > 0 && prev.times[k - 1] >= capT0) k--
    h = {
      since,
      t0: prev.t0,
      t1: Math.max(prev.t1, capT1),
      initial: prev.initial,
      times: prev.times.slice(0, k).concat(Array.from(tr.times)),
      levels: prev.levels.slice(0, k).concat(Array.from(tr.levels)),
    }
  }
  // forget what is older than the longest look-back, and the oldest edges of a busy net
  const minT = capT1 - LONG_LOOKBACK_S
  let drop = 0
  while (drop < h.times.length && h.times[drop] < minT) drop++
  drop = Math.max(drop, h.times.length - HISTORY_EDGES)
  if (drop > 0) {
    h.initial = h.levels[drop - 1] as 0 | 1 | 2
    h.t0 = Math.max(h.t0, h.times[drop - 1])
    h.times = h.times.slice(drop)
    h.levels = h.levels.slice(drop)
  }
  h.t0 = Math.max(h.t0, Math.min(minT, h.times.length > 0 ? h.times[0] : minT))
  history.set(net, h)
  return h
}

// ---------------------------------------------------------------------------
// what drives a net, and the steady rails (UX QA IS-F8)
// ---------------------------------------------------------------------------

/** The facts of a layout's nets: MCU board pins by net, the supply rails, the function-generator outputs. */
interface NetFacts {
  layout: CircuitLayout
  pins: Map<string, { id: string; pin: string }[]>
  rails: Set<string>
  /** net → the waveform source (function generator) whose output drives it (QA clarity FG-RAIL) */
  sources: Map<string, string>
}
let netFacts: NetFacts | null = null
/** A source whose output follows a waveform (a function generator): never a steady rail (QA clarity FG-RAIL). */
function isWaveformSource(entry: NonNullable<ReturnType<typeof getEntry>>): boolean {
  return entry.type === 'function_generator' || !!entry.params?.some((p) => p.key === 'waveform')
}
function factsOf(layout: CircuitLayout): NetFacts {
  if (netFacts?.layout === layout) return netFacts
  const pins = new Map<string, { id: string; pin: string }[]>()
  const rails = new Set<string>()
  const sources = new Map<string, string>()
  const netlist = netlistOf(layout)
  if (netlist) {
    const config = boardConfigOf(layout)
    const railNet = (ref: string) => {
      const n = netlist.netOf(ref)
      if (n) rails.add(n)
    }
    for (const comp of layout.components) {
      const entry = getEntry(comp.type)
      if (!entry) continue
      if (entry.placement === 'offboard') {
        if (isWaveformSource(entry)) {
          // a function generator's output follows its waveform: what it is SET to, never a rail
          const out = netlist.netOf(`${comp.id}:${entry.pins[0]}`)
          if (out && !sources.has(out)) sources.set(out, comp.id)
          continue
        }
        // a bench supply / battery holds its terminals steady (a current source does not)
        if (entry.category === 'power' && comp.type !== 'current_source') for (const pin of entry.pins) railNet(`${comp.id}:${pin}`)
        continue
      }
      const holes = componentPinHoles(comp, entry, config)
      if (!holes) continue
      entry.pins.forEach((pin, i) => {
        const h = holes[i]
        if (!h) return
        const ref = formatHole(h)
        if (entry.mcu) {
          // the board's supply pins are rails; the rest drive or read nets
          if (/^(3V3|5V|GND)(_?\d+)?$/.test(pin)) railNet(ref)
          const n = netlist.netOf(ref)
          if (n) {
            const list = pins.get(n) ?? []
            list.push({ id: comp.id, pin })
            pins.set(n, list)
          }
        } else if (entry.category === 'power' && comp.type !== 'current_source' && !isWaveformSource(entry) && /^(OUT|GND|\+|-)$/.test(pin)) {
          railNet(ref) // an on-board regulator's output and ground, a battery's terminals
        }
      })
    }
  }
  netFacts = { layout, pins, rails, sources }
  return netFacts
}

/** The function generator driving `net` as its setting (QA clarity FG-RAIL), or null. */
function sourceSummary(net: string, layout: CircuitLayout): Extract<NetLive, { kind: 'source' }> | null {
  const id = factsOf(layout).sources.get(net)
  return id ? sourceSetting(id, layout) : null
}

/**
 * What function generator `id` is SET to, as a NetLive 'source' (QA clarity
 * FG-RAIL / MEASURE-COHERENCE — the 量測 row, the pin rows and the hover chip
 * say the same 「方波 100 Hz · 0–5.00 V」). Needs no simulation. null when
 * `id` is not a waveform source of `layout`.
 */
export function sourceSetting(id: string, layout: CircuitLayout = useStore.getState().layout): Extract<NetLive, { kind: 'source' }> | null {
  const comp = layout.components.find((c) => c.id === id)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry || !isWaveformSource(entry)) return null
  const num = (key: string, d: number) => {
    const v = Number(paramOf(comp.params, entry, key))
    return Number.isFinite(v) ? v : d
  }
  const w = String(paramOf(comp.params, entry, 'waveform') ?? 'square')
  const waveform = w === 'sine' || w === 'triangle' ? w : 'square'
  const amp = Math.abs(num('amplitude', 0))
  const offset = num('offset', 0)
  return { kind: 'source', id: comp.id, waveform, f: num('frequency', 0), lo: offset - amp, hi: offset + amp }
}

/** The serial line of a recorded net, the analyzer's way (a USART pin the firmware set up). */
function lineOf(net: string, layout: CircuitLayout): { baud: number; frame: string | null } | null {
  const netlist = netlistOf(layout)
  if (!netlist) return null
  const l = usartLineOnNet(net, netlist, { layout, telemetry: useStore.getState().telemetry, mcus: useLab.getState().mcus })
  return l ? { baud: l.baud, frame: l.frame } : null
}

const PROTOCOL_NAMES: Record<string, string> = { spi: 'SPI', i2c: 'I²C', uart: 'UART', onewire: '1-Wire' }

/** The bus of a decoder whose DATA role reads `net`: 'SPI', 'I²C', 'UART', '1-Wire' (null = none). */
function protocolOf(net: string, layout: CircuitLayout): string | null {
  const lab = useLab.getState()
  const { byIndex } = channelNets(layout, lab.logicChannels)
  const decoders = sanitizeDecoderConfigs(lab.logicView.decoders)
  for (const [index, n] of byIndex) {
    if (n !== net) continue
    for (const cfg of decoders) {
      if (!Object.entries(cfg.channels).some(([role, ch]) => ch === index && /^(data|sda|mosi|miso|dq)$/.test(role))) continue
      return PROTOCOL_NAMES[cfg.decoder] ?? null
    }
  }
  return null
}

/**
 * A moving net that holds still right now (QA clarity MEASURE-COHERENCE):
 * the simulation is paused, or a board pin on it belongs to a halted /
 * locked-up core AND no edge was seen in the last NET_LIVE_WINDOW_S (a timer
 * that keeps toggling a halted core's pin is still moving). null = moving.
 */
function heldOf(net: string, layout: CircuitLayout, v: number | null): NetHeld | null {
  const st = useStore.getState()
  const tel = st.telemetry
  const mcus = useLab.getState().mcus
  // a debugger halt freezes the whole world (the store is not running then): name the halt, not a pause
  const halted = (factsOf(layout).pins.get(net) ?? []).some(({ id }) => mcus[id]?.state === 'halted' || mcus[id]?.state === 'lockup')
  if (halted && tel && (!st.running || (lastEdge.get(net) ?? Number.NEGATIVE_INFINITY) < tel.time - NET_LIVE_WINDOW_S)) return { why: 'halted', v }
  if (st.running) sawRunning = true
  else if (sawRunning && st.simTime > 0) return { why: 'paused', v }
  return null
}

/** What drives moving net `net`: a timer channel, a decoder's data role, or a plain GPIO (the spec's order). */
function sourceOf(net: string, layout: CircuitLayout): NetSignalSource {
  const lab = useLab.getState()
  const tel = useStore.getState().telemetry
  for (const { id, pin } of factsOf(layout).pins.get(net) ?? []) {
    const comp = layout.components.find((c) => c.id === id)
    const entry = comp ? getEntry(comp.type) : undefined
    const mode = tel?.components[id]?.mcu?.pinModes?.[pin]
    const fns = entry?.pinInfo?.find((p) => p.pin === pin)?.functions ?? []
    const frame = lab.mcus[id]
    const fn = activePinFunction(fns, mode, { ...pinFunctionContext(frame), clocked: frame?.clocked })
    if (fn && /^TIM\d+_CH\d+N?$/.test(fn)) return 'timer'
  }
  const { byIndex } = channelNets(layout, lab.logicChannels)
  const decoders = sanitizeDecoderConfigs(lab.logicView.decoders)
  for (const [index, n] of byIndex) if (n === net && isDataChannel(index, decoders)) return 'data'
  return 'gpio'
}

/** Is `net` a supply rail (a supply / battery / regulator output, an MCU 3V3 / 5V / GND pin)? */
export function isRailNet(net: string, layout: CircuitLayout = useStore.getState().layout): boolean {
  return factsOf(layout).rails.has(net)
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * What `query`'s net is doing now (see NetLive in src/instruments/measure.ts).
 * null without a simulation session (no telemetry) or when the query is not
 * part of the circuit. A recorded net reads its last poll ('pwm' / 'toggling'
 * / 'dc', with the current solver voltage); any other net reads
 * { kind: 'unknown', v, instantaneous: true }. Also keeps the poll alive.
 */
export function getNetLive(query: NetQuery): NetLive | null {
  const st = useStore.getState()
  const net = resolveNet(query, st.layout)
  noteInterest(net)
  const tel = st.telemetry
  if (!tel || !net) return null
  const raw = tel.netVoltages[net]
  const v = isTrustedVoltage(raw) ? raw : null
  const { nets } = channelNets(st.layout, useLab.getState().logicChannels)
  const cached = nets.has(net) ? live.get(net) : undefined
  const quiet = !cached || cached.kind === 'dc' || cached.kind === 'unknown'
  // a function generator's output: its setting, never one jumping instant (QA clarity FG-RAIL)
  if (quiet) {
    const src = sourceSummary(net, st.layout)
    if (src) return src
  }
  // a supply rail is steady whether or not a channel records it (IS-F8 (3))
  if (quiet && v !== null && isRailNet(net, st.layout)) return { kind: 'dc', v }
  if (!cached) return { kind: 'unknown', v, instantaneous: true }
  if (cached.kind === 'dc') return v === null ? { kind: 'unknown', v: null, instantaneous: true } : { kind: 'dc', v }
  const held = heldOf(net, st.layout, v)
  if (cached.kind === 'toggling') {
    // the analyzer's words for what moves (QA clarity MEASURE-COHERENCE): a USART line, a burst clock, a bus's data
    const source = sourceOf(net, st.layout)
    const out: Extract<NetLive, { kind: 'toggling' }> = { kind: 'toggling', edges: cached.edges, v, source }
    if (cached.young) out.young = true
    const line = lineOf(net, st.layout)
    if (line) out.line = line
    else if (source === 'data') {
      const protocol = protocolOf(net, st.layout)
      if (protocol) out.protocol = protocol
    } else if (cached.burstClock) out.burstClock = cached.burstClock
    if (held) out.held = held
    return out
  }
  if (cached.kind === 'pwm') return held ? { ...cached, source: sourceOf(net, st.layout), held } : { ...cached, source: sourceOf(net, st.layout) }
  return cached
}

/**
 * Was an edge seen on `query`'s net at or after sim time `since`? true only
 * on evidence (the recorder, or a level change between telemetry samples);
 * false also means "not seen" — not proof of a quiet net. Keeps the poll
 * alive and starts watching the net.
 */
export function hasActivity(query: NetQuery, since: number): boolean {
  const net = resolveNet(query, useStore.getState().layout)
  noteInterest(net)
  if (!net) return false
  return (lastEdge.get(net) ?? Number.NEGATIVE_INFINITY) >= since
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const getVersion = (): number => version

/** getNetLive as a hook: re-renders at the poll rate (≤ 4 Hz) while the simulation runs. */
export function useNetLive(query: NetQuery | null): NetLive | null {
  const key = query === null ? '' : typeof query === 'string' ? query : 'net' in query ? `net|${query.net}` : `${query.componentId}|${query.pin}`
  useEffect(() => {
    if (key === '') return
    subscribers++
    ensureTimer()
    return () => {
      subscribers--
    }
  }, [key])
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return query === null ? null : getNetLive(query)
}

/**
 * NetLive as text, the one wording for chips, rows and panels:
 *  - 'pwm'      by its source (IS-F8): a timer 「PWM 1.000 kHz · 34.0 %（平均 1.12 V）」
 *               (full) / 「PWM 1.000 kHz · 34.0 %」 (compact); a GPIO 「週期訊號
 *               0.998 Hz · 50.0 %」 (both forms — the pin row, the chip and 量測
 *               say the same); serial data 「訊號變化中（序列資料）」
 *  - 'toggling' 「訊號變化中（非週期）」, serial data 「訊號變化中（序列資料）」, too
 *               few edges to judge yet (`young`) 「訊號變化中」
 *  - 'dc'       「3.10 V」
 *  - 'unknown'  「3.10 V（瞬時）」 (full) / 「3.10 V」 (compact); no value → 「—」
 * Voltages through H3 fmtVoltage (compact), the frequency through fmtFreq.
 */
export function netLiveText(live: NetLive | null, opts: { form?: 'full' | 'compact' } = {}): string {
  if (!live) return '—'
  const full = opts.form !== 'compact'
  switch (live.kind) {
    case 'pwm': {
      if (live.held) return heldText(live.held, movingText(live, true))
      if (live.source === 'data') return t('Changing (serial data)')
      if (live.source === 'gpio') return t('Periodic signal {f} · {duty}', { f: fmtFreq(live.f), duty: fmtPercent(live.duty) })
      const base = t('PWM {f} · {duty}', { f: fmtFreq(live.f), duty: fmtPercent(live.duty) })
      return full && live.vavg !== null ? t('{text} (average {v})', { text: base, v: fmtVoltage(live.vavg) }) : base
    }
    case 'toggling':
      if (live.held) return heldText(live.held, movingText(live, true))
      return movingText(live, false)
    case 'dc':
      return fmtVoltage(live.v)
    case 'unknown':
      if (live.v === null) return '—'
      return full ? t('{v} (instantaneous)', { v: fmtVoltage(live.v) }) : fmtVoltage(live.v)
    case 'source': {
      const text = t('{wave} {f} · {range}', { wave: t(WAVE_NAMES[live.waveform]), f: fmtSetting(live.f, 'Hz'), range: voltRange(live.lo, live.hi) })
      return full ? t('{text} (function generator setting)', { text }) : text
    }
  }
}

const WAVE_NAMES = { square: 'Square wave', sine: 'Sine wave', triangle: 'Triangle wave' } as const

/** 「0–5.00 V」: one unit when both ends read in volts (the analyzer's threshold hint does the same). */
export function voltRange(lo: number, hi: number): string {
  const a = fmtVoltage(lo)
  const b = fmtVoltage(hi)
  return / V$/.test(a) && / V$/.test(b) && !/ mV$/.test(a) && !a.startsWith('−') ? `${a.slice(0, -2)}–${b}` : `${a} – ${b}`
}

/**
 * What a moving net does, in the analyzer's words (QA clarity
 * MEASURE-COHERENCE): 「UART 115 200 Bd · 8N1」, 「時脈 400.0 kHz（突發）」,
 * 「SPI 資料」, 「週期訊號 0.998 Hz · 50.0 %」. `past`: the same, as the
 * history of a net that holds still now — never 「訊號變化中」 (「有訊號變化」).
 */
function movingText(live: Extract<NetLive, { kind: 'pwm' | 'toggling' }>, past: boolean): string {
  if (live.kind === 'pwm') {
    if (live.source === 'data') return t('Serial data')
    if (live.source === 'gpio') return t('Periodic signal {f} · {duty}', { f: fmtFreq(live.f), duty: fmtPercent(live.duty) })
    return t('PWM {f} · {duty}', { f: fmtFreq(live.f), duty: fmtPercent(live.duty) })
  }
  if (live.line) return t('UART {line}', { line: live.line.frame ? `${fmtBaud(live.line.baud)} · ${live.line.frame}` : fmtBaud(live.line.baud) })
  if (live.burstClock) return `${tc('clock', 'meas')} ${t('{f} (burst)', { f: fmtFreq(live.burstClock) })}`
  if (live.source === 'data') return live.protocol ? t('{protocol} data', { protocol: live.protocol }) : past ? t('Serial data') : t('Changing (serial data)')
  // too few edges to judge a period yet (a 1 Hz blink's first second): no claim either way
  if (past) return live.young ? t('Level changes') : t('Level changes (not periodic)')
  return live.young ? tc('Changing', 'net') : t('Changing (not periodic)')
}

/** 「目前 高（3.30 V）· 暫停前：…」 / 「目前 低（0 V）· 核心停住前：…」 */
function heldText(held: NetHeld, before: string): string {
  const v = held.v
  const now =
    v === null
      ? t('Now —')
      : v >= 2.0
        ? t('Now high ({v})', { v: fmtVoltage(v) })
        : v <= 0.8
          ? t('Now low ({v})', { v: fmtVoltage(v) })
          : t('Now {v}', { v: fmtVoltage(v) })
  return held.why === 'paused' ? t('{now} · before the pause: {before}', { now, before }) : t('{now} · before the core halted: {before}', { now, before })
}

/**
 * Title for a live value: 「瞬時值，每秒更新 4 次」; with the value itself,
 * what it is when it is not a measurement (QA clarity FG-RAIL): a function
 * generator's setting, a paused / halted net's held level.
 */
export function netLiveTitle(live?: NetLive | null): string {
  if (live?.kind === 'source') return t('What the function generator is set to — not a measurement; the scope shows the real waveform')
  if ((live?.kind === 'pwm' || live?.kind === 'toggling') && live.held)
    return live.held.why === 'paused' ? t('The level now, and what the signal did before the pause') : t('The level now, and what the signal did before the core halted')
  return t('Instantaneous value, updated 4 times a second')
}

/** TEST-ONLY: forget every observation, listener interest and the poll timer. */
export function __resetNetActivityForTests(): void {
  stopTimer()
  forget()
  watched.clear()
  seenTime = 0
  subscribers = 0
  interestUntil = 0
  inFlight = false
  hadTelemetry = false
  netlistCache = null
  channelCache = null
  netFacts = null
}

/** TEST-ONLY: run one poll tick now (telemetry sample + recorder read). */
export function __tickNetActivityForTests(): void {
  tick()
}
