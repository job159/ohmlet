/**
 * The logic analyzer's 「＋通道…」 menu (UX IS-7), most useful first:
 *
 *   匯流排（通道＋解碼器）  buses the firmware uses (alternate-function pins,
 *                            an enabled USART) or that are wired — channels
 *                            AND the decoder in one step, with the baud rate
 *                            the firmware programmed
 *   邏輯探棒               placed logic_probe parts
 *   使用中的腳位           MCU pins driven by the firmware (output / AF) or
 *                            wired to something: "PA9 · USART1_TX · 複用"
 *   網路                   other wired nets by their best name:
 *                            "R1 第 2 腳 · a44"
 *   U1 全部腳位            every port pin (the former flat list)
 *
 * Pure model builder (option values encode the action: 'bus|U1|USART1',
 * 'mcu|U1|PA9', 'net|a44', 'probe|LP1'); the view dispatches them.
 */
import type { CircuitLayout } from '../../../model/types'
import { boardConfigOf } from '../../../model/types'
import { getEntry } from '../../../model/catalog'
import { componentPinHoles, formatHole } from '../../../model/breadboard'
import { buildNetlist } from '../../../sim/netlist'
import type { LogicChannelConfig, McuFrameInfo } from '../../../sim/coordinator/api'
import type { SimTelemetry } from '../../../model/types'
import { pinDisplayName, pinLabel } from '../../../i18n/parts'
import type { SelectGroup, SelectOption } from '../controls'
import { F103_BUSES, busKey, busUse, uartFormat } from './buses'
import { activePinFunction, pinFunctionContext, remapActive } from './pin-function'

export type Tr = (src: string, params?: Record<string, string | number>) => string

export interface PickerInput {
  layout: CircuitLayout
  telemetry: SimTelemetry | null
  mcus: Readonly<Record<string, McuFrameInfo>>
  channels: readonly LogicChannelConfig[]
  /** t() — injected so the builder stays pure */
  tr: Tr
  /** compact pin-mode tag ('af' → 複用) */
  modeLabel: (mode: string) => string
}

const MAX_NETS = 40

/** Endpoint of a channel source (for "already on the analyzer"). */
function channelEndpoints(layout: CircuitLayout, channels: readonly LogicChannelConfig[]): string[] {
  const config = boardConfigOf(layout)
  const out: string[] = []
  for (const ch of channels) {
    const s = ch.source
    if (s.kind === 'net') {
      out.push(s.ref)
      continue
    }
    const comp = layout.components.find((c) => c.id === s.componentId)
    const entry = comp ? getEntry(comp.type) : undefined
    if (!comp || !entry) continue
    const pin = s.kind === 'mcu-pin' ? s.pin : entry.pins[0]
    const i = entry.pins.indexOf(pin)
    const h = i >= 0 ? componentPinHoles(comp, entry, config)?.[i] : null
    if (h) out.push(formatHole(h))
  }
  return out
}

export function channelPickerGroups(inp: PickerInput): SelectGroup[] {
  const { layout, telemetry, mcus, channels, tr, modeLabel } = inp
  const config = boardConfigOf(layout)
  const netlist = buildNetlist(layout)
  const netOf = (ref: string | null | undefined) => (ref ? netlist.netOf(ref) ?? '' : '')
  const usedNets = new Set(channelEndpoints(layout, channels).map((r) => netOf(r)).filter((n) => n !== ''))
  const usedKeys = new Set(
    channels.map((c) =>
      c.source.kind === 'probe' ? `probe|${c.source.componentId}` : c.source.kind === 'mcu-pin' ? `mcu|${c.source.componentId}|${c.source.pin}` : `net|${c.source.ref}`,
    ),
  )

  // how many endpoints sit on each net (a pin "is wired" when its net has more than itself)
  const netSize = new Map<string, number>()
  const bump = (ref: string | null) => {
    const n = netOf(ref)
    if (n) netSize.set(n, (netSize.get(n) ?? 0) + 1)
  }
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    if (entry.placement === 'offboard') {
      for (const p of entry.pins) bump(`${comp.id}:${p}`)
      continue
    }
    for (const h of componentPinHoles(comp, entry, config) ?? []) bump(h ? formatHole(h) : null)
  }
  for (const w of layout.wires) {
    bump(w.from)
    bump(w.to)
  }

  const boards = layout.components.filter((c) => getEntry(c.type)?.mcu)
  const multi = boards.length > 1
  const busOpts: SelectOption[] = []
  const pinOpts: SelectOption[] = []
  const allGroups: SelectGroup[] = []
  const mcuNets = new Set<string>()

  for (const comp of boards) {
    const entry = getEntry(comp.type)!
    const mcu = entry.mcu!
    const holes = componentPinHoles(comp, entry, config)
    const holeOf = (pin: string) => {
      const i = entry.pins.indexOf(pin)
      const h = i >= 0 ? holes?.[i] : null
      return h ? formatHole(h) : null
    }
    const modes = telemetry?.components[comp.id]?.mcu?.pinModes
    const wired = (port: string) => {
      const pin = Object.keys(mcu.pinMap).find((p) => mcu.pinMap[p] === port) ?? port
      const n = netOf(holeOf(pin))
      return n !== '' && (netSize.get(n) ?? 0) > 1
    }
    const prefix = multi ? `${comp.id} · ` : ''

    // ---- buses: in use first; none in use → the usual three
    // H10 facts of this board: its USARTs and AFIO_MAPR as the firmware programmed them
    const pfc = pinFunctionContext(mcus[comp.id])
    const uarts = mcus[comp.id]?.uarts
    // AFIO_MAPR as the simulation reports it (McuFrameInfo.mapr): a remapped
    // pin set is suggested ONLY when the known MAPR selects it — and then the
    // default set of that peripheral is not (it no longer carries it); with
    // MAPR unknown the default mapping is assumed (UX IS-10 — PB6 / PB7 of an
    // I²C scan are never offered as 「USART1（PB6 TX／PB7 RX）」)
    const mapr = pfc.mapr
    const best = new Map<string, { b: (typeof F103_BUSES)[number]; use: number }>()
    for (const b of F103_BUSES) {
      const remapped = mapr !== undefined && remapActive(`${b.id}_${b.signals[0].name}`, mapr)
      if (b.remap ? !remapped : remapped) continue
      const use = busUse(b, modes, wired, uarts)
      const cur = best.get(b.id)
      if (!cur || use > cur.use || (use === cur.use && cur.b.remap && !b.remap)) best.set(b.id, { b, use })
    }
    const list = [...best.values()]
    const active = list.filter((x) => x.use > 0)
    const shown = (active.length > 0 ? active : list.filter((x) => ['USART1', 'I2C1', 'SPI1'].includes(x.b.id))).sort(
      (a, b) => b.use - a.use,
    )
    for (const { b } of shown) {
      const pins = b.signals.map((s) => `${s.pin} ${s.name}`).join('／')
      const dec = b.kind === 'uart' ? 'UART' : b.kind === 'i2c' ? 'I²C' : 'SPI'
      const fmt = b.kind === 'uart' ? uartFormat(uarts?.find((u) => u.name === b.id)?.config) : null
      busOpts.push({
        value: `bus|${comp.id}|${busKey(b)}`,
        label: fmt
          ? tr('{prefix}{bus} ({pins}) + {decoder} decoder {format}', { prefix, bus: b.id, pins, decoder: dec, format: fmt })
          : tr('{prefix}{bus} ({pins}) + {decoder} decoder', { prefix, bus: b.id, pins, decoder: dec }),
      })
    }

    // ---- pins
    const all: SelectOption[] = []
    for (const pin of Object.keys(mcu.pinMap)) {
      const port = mcu.pinMap[pin]
      const value = `mcu|${comp.id}|${pin}`
      const hole = holeOf(pin)
      const n = netOf(hole)
      if (n) mcuNets.add(n)
      const taken = usedKeys.has(value) || (n !== '' && usedNets.has(n))
      const mode = modes?.[pin]
      // H10: the one judgement the inspector's pin rows use too (never an I²C pin as USART)
      const fn = activePinFunction(entry.pinInfo?.find((p) => p.pin === pin)?.functions ?? [], mode, pfc)
      // every pin by its H1 name: 「PA6（板上 A6）」, 「· TIM3_CH1」 when the function is known (IS-13)
      all.push({ value, label: [`${prefix}${pinLabel(entry, pin)}`, fn].filter(Boolean).join(' · '), disabled: taken })
      const driven = mode === 'out' || mode === 'od' || mode === 'af' || mode === 'af-od'
      const isWired = n !== '' && (netSize.get(n) ?? 0) > 1
      if (!driven && !isWired) continue
      const parts = [`${prefix}${port}`]
      if (fn) parts.push(fn)
      if (mode) parts.push(modeLabel(mode))
      else if (isWired) parts.push(tr('wired'))
      pinOpts.push({ value, label: parts.join(' · '), disabled: taken })
    }
    allGroups.push({ label: tr('{id} all pins', { id: comp.id }), options: all })
  }

  // ---- logic probes
  const probeOpts: SelectOption[] = []
  for (const c of layout.components) {
    if (c.type !== 'logic_probe') continue
    const value = `probe|${c.id}`
    probeOpts.push({ value, label: `${c.id} (${String(c.params?.channel ?? 'D0')})`, disabled: usedKeys.has(value) })
  }

  // ---- other wired nets, named by their first part pin
  const netOpts: SelectOption[] = []
  const seen = new Set<string>()
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.mcu || entry.placement === 'offboard' || comp.type === 'logic_probe' || comp.type === 'scope_probe') continue
    const holes = componentPinHoles(comp, entry, config)
    entry.pins.forEach((pin, i) => {
      if (netOpts.length >= MAX_NETS) return
      const h = holes?.[i]
      if (!h) return
      const ref = formatHole(h)
      const n = netOf(ref)
      if (!n || seen.has(n) || mcuNets.has(n) || (netSize.get(n) ?? 0) < 2) return
      seen.add(n)
      netOpts.push({ value: `net|${ref}`, label: `${comp.id} ${pinDisplayName(entry, pin)} · ${ref}`, disabled: usedNets.has(n) })
    })
  }

  const groups: SelectGroup[] = []
  if (busOpts.length) groups.push({ label: tr('Buses (channels + decoder)'), options: busOpts })
  if (probeOpts.length) groups.push({ label: tr('Logic probes'), options: probeOpts })
  if (pinOpts.length) groups.push({ label: tr('Pins in use'), options: pinOpts })
  if (netOpts.length) groups.push({ label: tr('Nets'), options: netOpts })
  return [...groups, ...allGroups]
}
