/**
 * What a logic-analyzer channel is called, and where it is on the board
 * (UX IS-13 — channels lead back to the circuit and keep their identity):
 *
 *   channelDisplayName(layout, ch)
 *     a board pin  → 「PA5（板上 A5）」, second line 「U1」,
 *                    title 「PA5（板上 A5）· c20 · U1 腳位」
 *     a net (hole) → its occupant by H1 「D1 陽極（長腳）」, second line 「b40 · 網路」
 *     a terminal   → H1 「PS1 正端」, second line 「網路」
 *     a probe part → its label, second line 「LP1 探棒」
 *   A label the user (or an example) gave — 「PA6 PWM」 — stays the name;
 *   only the language-neutral defaults the probe actions write ('PA5',
 *   'U2.PA5', 'b40', 'PS1:+') are replaced by the circuit's words, at view
 *   time, so the persisted label never depends on the UI language.
 *
 * Also the place the label buttons point the 3D view at (hole + part + pin).
 * Pure of the layout (names through H1 pinLabel / terminalLabel, H2
 * endpointName for the tooltip); never throws.
 */
import type { CircuitLayout } from '../../../model/types'
import { boardConfigOf } from '../../../model/types'
import { getEntry } from '../../../model/catalog'
import { componentPinHoles, formatHole, netIdForHole, parseHole, parseTerminalRef } from '../../../model/breadboard'
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { buildNetlist } from '../../../sim/netlist'
import { pinLabel, terminalLabel } from '../../../i18n/parts'
import { t } from '../../../i18n'
import { tc } from '../../format'
import { endpointName } from '../../workspace/hole-chip'

export interface ChannelName {
  /** what the channel is called */
  name: string
  /** the second line under the name */
  sub: string
  /** tooltip: what and where, in full */
  title: string
  /** the hole the source sits in (null: off-board / not placed) */
  hole: string | null
  /** the part to select (the board, the part on the net, the probe); null for an empty hole */
  componentId: string | null
  /** that part's pin (the inspector's pin row) */
  pin: string | null
}

/** The part pin in `hole`, else the first part pin on its 5-hole strip (layout order). */
function occupantOf(layout: CircuitLayout, hole: string): { id: string; type: string; pin: string } | null {
  const h = parseHole(hole)
  if (!h) return null
  const config = boardConfigOf(layout)
  const strip = netIdForHole(h)
  let mate: { id: string; type: string; pin: string } | null = null
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard' || comp.type === 'scope_probe' || comp.type === 'logic_probe') continue
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    for (let i = 0; i < holes.length; i++) {
      const ph = holes[i]
      if (!ph) continue
      if (formatHole(ph) === hole) return { id: comp.id, type: comp.type, pin: entry.pins[i] }
      if (!mate && netIdForHole(ph) === strip) mate = { id: comp.id, type: comp.type, pin: entry.pins[i] }
    }
  }
  return mate
}

/** The raw label a probe action writes for this source (port name, 'U2.PA5', hole / terminal ref). */
export function isDefaultChannelLabel(layout: CircuitLayout, ch: LogicChannelConfig): boolean {
  const s = ch.source
  if (s.kind === 'net') return ch.label === s.ref
  const comp = layout.components.find((c) => c.id === s.componentId)
  const entry = comp ? getEntry(comp.type) : undefined
  if (s.kind === 'mcu-pin') {
    const port = entry?.mcu?.pinMap[s.pin] ?? s.pin
    return ch.label === port || ch.label === `${s.componentId}.${port}` || ch.label === s.pin
  }
  return ch.label === String(comp?.params?.channel ?? 'D0') || ch.label === s.componentId
}

/** See the module comment. */
export function channelDisplayName(layout: CircuitLayout, ch: LogicChannelConfig): ChannelName {
  const own = !isDefaultChannelLabel(layout, ch)
  const s = ch.source
  try {
    if (s.kind === 'mcu-pin') {
      const comp = layout.components.find((c) => c.id === s.componentId)
      const entry = comp ? getEntry(comp.type) : undefined
      if (!comp || !entry) return plain(ch)
      const i = entry.pins.indexOf(s.pin)
      const h = i >= 0 && entry.placement !== 'offboard' ? componentPinHoles(comp, entry, boardConfigOf(layout))?.[i] : null
      const hole = h ? formatHole(h) : null
      const pinName = pinLabel(entry, s.pin)
      return {
        name: own ? ch.label : pinName,
        sub: comp.id,
        title: [pinName, hole, t('{id} pin', { id: comp.id })].filter(Boolean).join(' · '),
        hole,
        componentId: comp.id,
        pin: s.pin,
      }
    }
    if (s.kind === 'net') {
      const term = parseTerminalRef(s.ref)
      if (term) {
        const name = terminalLabel(s.ref, layout)
        return { name: own ? ch.label : name, sub: tc('net', 'channel'), title: `${name} · ${tc('net', 'channel')}`, hole: null, componentId: term.componentId, pin: term.pin }
      }
      const h = parseHole(s.ref)
      const hole = h ? formatHole(h) : s.ref
      const occ = h ? occupantOf(layout, hole) : null
      const entry = occ ? getEntry(occ.type) : undefined
      const name = occ && entry ? pinLabel(entry, occ.pin, { id: occ.id }) : endpointName(layout, hole)
      return {
        name: own ? ch.label : name,
        sub: `${hole} · ${tc('net', 'channel')}`,
        title: [name, occ ? hole : null, tc('net', 'channel')].filter(Boolean).join(' · '),
        hole,
        componentId: occ?.id ?? null,
        pin: occ?.pin ?? null,
      }
    }
    // a logic_probe part
    const comp = layout.components.find((c) => c.id === s.componentId)
    const entry = comp ? getEntry(comp.type) : undefined
    const h = comp && entry ? componentPinHoles(comp, entry, boardConfigOf(layout))?.[0] : null
    const hole = h ? formatHole(h) : null
    return {
      name: ch.label,
      sub: t('{id} probe', { id: s.componentId }),
      title: [ch.label, hole ? endpointName(layout, hole) : null, t('{id} probe', { id: s.componentId })].filter(Boolean).join(' · '),
      hole,
      componentId: s.componentId,
      pin: null,
    }
  } catch {
    return plain(ch)
  }
}

function plain(ch: LogicChannelConfig): ChannelName {
  return { name: ch.label, sub: '', title: ch.label, hole: null, componentId: ch.source.kind === 'net' ? null : ch.source.componentId, pin: null }
}

/** Display names of channels by index (labels in toolbar summaries: trigger chip, decoder chips). */
export function displayLabels(layout: CircuitLayout, channels: readonly LogicChannelConfig[]): LogicChannelConfig[] {
  return channels.map((c) => {
    const n = channelDisplayName(layout, c).name
    return n === c.label ? c : { ...c, label: n }
  })
}

/** A placed scope probe as its CH chip names it (UX IS-13): 「CH1 · P1 · U1 PA6 網路」. */
export interface ScopeProbeName {
  /** the probe part */
  id: string
  /** 0..3 */
  channel: number
  hole: string
  /** the net by its most telling member: a board pin first (「U1 PA6」), else a part pin (「D1 陽極」), else the hole */
  net: string
}

/** The probes of `layout` by scope channel (the first probe of a shared channel). Pure; never throws. */
export function scopeProbeNames(layout: CircuitLayout): Map<number, ScopeProbeName> {
  const out = new Map<number, ScopeProbeName>()
  try {
    const probes = layout.components.filter((c) => c.type === 'scope_probe' && c.holes?.[0])
    if (probes.length === 0) return out
    const netlist = buildNetlist(layout)
    const config = boardConfigOf(layout)
    // every part pin's net, boards first
    const members: { net: string; name: string; mcu: boolean }[] = []
    for (const comp of layout.components) {
      const entry = getEntry(comp.type)
      if (!entry || comp.type === 'scope_probe' || comp.type === 'logic_probe') continue
      const refs =
        entry.placement === 'offboard'
          ? entry.pins.map((p) => `${comp.id}:${p}`)
          : (componentPinHoles(comp, entry, config) ?? []).map((h) => (h ? formatHole(h) : null))
      refs.forEach((ref, i) => {
        const net = ref ? netlist.netOf(ref) : null
        if (!net) return
        const name = entry.placement === 'offboard' ? terminalLabel(`${comp.id}:${entry.pins[i]}`, layout) : pinLabel(entry, entry.pins[i], { id: comp.id, form: 'short' })
        members.push({ net, name, mcu: !!entry.mcu })
      })
    }
    for (const p of probes) {
      const channel = Math.round(Number(p.params?.channel ?? 1)) - 1
      if (channel < 0 || channel > 3 || out.has(channel)) continue
      const hole = p.holes![0]
      const net = netlist.netOf(hole)
      const on = net ? members.filter((m) => m.net === net) : []
      const best = on.find((m) => m.mcu) ?? on[0]
      out.set(channel, { id: p.id, channel, hole, net: best ? best.name : hole })
    }
  } catch {
    // a layout the netlist cannot read: no names (the chips keep 「CH1」)
  }
  return out
}
