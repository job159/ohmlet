/**
 * PinRef resolution for the lesson evaluator: a lesson names a pin of a
 * placed part ({ component, pin }), a breadboard hole ({ hole }) or an
 * off-board terminal ({ terminal: "PS1:+" }); the evaluator needs the
 * endpoint ref the netlist / coordinator understand (a hole ref or an
 * "ID:PIN" terminal ref) and, for logic channels, whether the pin is an MCU
 * GPIO (exact edge recording).
 *
 * Pure: no DOM, no simulation — safe in node tests and workers.
 */
import type { CircuitLayout, ComponentInstance, EndpointRef } from '../../model/types'
import { boardConfigOf } from '../../model/types'
import { componentPinHoles, formatHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { getEntry, type CatalogEntry } from '../../model/catalog'
import type { PinRef } from '../types'
import { t } from '../../i18n'
import { pinLabel, terminalLabel, type TerminalOwners } from '../../i18n/parts'
import { tidyCjkSpaces } from '../../i18n/tidy'

export type ResolvedRef =
  | {
      ok: true
      /** hole ref ("c45") or off-board terminal ref ("PS1:+") */
      endpoint: EndpointRef
      /** the endpoint is a breadboard hole (a scope probe can sit on its net) */
      hole: boolean
      /** set when the ref is a GPIO header pin of an MCU board */
      mcuPin?: { componentId: string; pin: string }
    }
  | {
      ok: false
      /** why the ref does not resolve (English source for t(); `{x}` params) */
      reason: 'no-component' | 'no-pin' | 'unplaced' | 'bad-hole' | 'bad-terminal'
      params: Record<string, string>
    }

/** The catalog pin name a lesson wrote, matched exactly, then case-insensitively. */
export function catalogPin(entry: CatalogEntry, pin: string): string | null {
  if (entry.pins.includes(pin)) return pin
  const lower = pin.toLowerCase()
  const hit = entry.pins.find((p) => p.toLowerCase() === lower)
  if (hit) return hit
  // silkscreen labels ("A5" for PA5, "G" …) as written on the board
  const info = entry.pinInfo?.find((p) => p.label !== undefined && p.label.toLowerCase() === lower)
  return info ? info.pin : null
}

function findComponent(layout: CircuitLayout, id: string): ComponentInstance | undefined {
  return Array.isArray(layout.components) ? layout.components.find((c) => c && c.id === id) : undefined
}

/** Resolve a PinRef against a layout. */
export function resolvePinRef(layout: CircuitLayout, ref: PinRef): ResolvedRef {
  if ('hole' in ref) {
    const h = parseHole(ref.hole)
    if (!h) return { ok: false, reason: 'bad-hole', params: { ref: ref.hole } }
    return { ok: true, endpoint: formatHole(h), hole: true }
  }
  if ('terminal' in ref) {
    const term = parseTerminalRef(ref.terminal)
    if (!term) return { ok: false, reason: 'bad-terminal', params: { ref: ref.terminal } }
    const comp = findComponent(layout, term.componentId)
    if (!comp) return { ok: false, reason: 'no-component', params: { id: term.componentId } }
    const entry = getEntry(comp.type)
    const pin = entry ? catalogPin(entry, term.pin) : null
    if (!entry || !pin) return { ok: false, reason: 'no-pin', params: { id: term.componentId, pin: term.pin } }
    return { ok: true, endpoint: `${comp.id}:${pin}`, hole: false }
  }
  const comp = findComponent(layout, ref.component)
  if (!comp) return { ok: false, reason: 'no-component', params: { id: ref.component } }
  const entry = getEntry(comp.type)
  const pin = entry ? catalogPin(entry, ref.pin) : null
  if (!entry || !pin) return { ok: false, reason: 'no-pin', params: { id: ref.component, pin: ref.pin } }
  const mcuPin = entry.mcu && entry.mcu.pinMap[pin] ? { componentId: comp.id, pin } : undefined
  if (entry.placement === 'offboard') {
    return mcuPin ? { ok: true, endpoint: `${comp.id}:${pin}`, hole: false, mcuPin } : { ok: true, endpoint: `${comp.id}:${pin}`, hole: false }
  }
  const holes = componentPinHoles(comp, entry, boardConfigOf(layout))
  const h = holes?.[entry.pins.indexOf(pin)]
  if (!h) return { ok: false, reason: 'unplaced', params: { id: comp.id } }
  const endpoint = formatHole(h)
  return mcuPin ? { ok: true, endpoint, hole: true, mcuPin } : { ok: true, endpoint, hole: true }
}

/** The rails by the names the hole chips use (H2 — src/ui/workspace/hole-chip.ts RAIL_NAMES; worker-safe copy). */
const RAIL_NAMES: Record<string, string> = {
  'top+': 'top + rail',
  'top-': 'top − rail',
  'bot+': 'bottom + rail',
  'bot-': 'bottom − rail',
}

/**
 * A breadboard hole as a person reads it (release QA LS-F10): a strip hole
 * is its own name 「c45」; a rail hole says which rail, with the ref for
 * precision — 「上方 + 電源軌第 0 孔（top+0）」.
 */
export function holeRefText(hole: string): string {
  const h = parseHole(hole)
  const rail = h && h.kind === 'rail' ? RAIL_NAMES[h.rail] : undefined
  if (!h || h.kind !== 'rail' || !rail) return hole
  return tidyCjkSpaces(t('{name} ({hole})', { name: t('{rail} hole {n}', { rail: t(rail), n: h.index }), hole }))
}

/**
 * A PinRef as a person reads it — the app's one pin name (UX helper H1,
 * src/i18n/parts.ts; LS-13): 「U1 PA5（板上 A5）」, 「U1 GND（板上 G）」,
 * 「LED1 陰極（短腳）」, 「PS1 正端」, 「DMM1 COM 端」; a strip hole stays its
 * own name 「c45」, a rail hole names its rail 「上方 + 電源軌第 0 孔（top+0）」
 * (holeRefText). `parts` (a CircuitLayout fits) tells which catalog part an
 * id is; a part it does not know reads 「U1 PA5」 / 「LED1 陽極」 (word pins in
 * the UI language). Never 「U1.PA5」 or 「PS1:-」.
 */
export function pinRefText(ref: PinRef, parts?: TerminalOwners): string {
  if ('hole' in ref) return holeRefText(ref.hole)
  if ('terminal' in ref) return terminalLabel(ref.terminal, parts)
  const type = parts?.components.find((c) => c.id === ref.component)?.type
  const entry = type ? getEntry(type) : undefined
  if (entry) return pinLabel(entry, catalogPin(entry, ref.pin) ?? ref.pin, { id: ref.component })
  if (/^[a-z]{2,}$/.test(ref.pin)) {
    const key = `${ref.pin}|pin`
    const word = t(key)
    if (word !== key) return `${ref.component} ${word}`
  }
  return `${ref.component} ${ref.pin}`
}

/**
 * zh-TW text built from names: no space between two Chinese words —
 * 「LED1 陰極（短腳） 與 PS1 負端 沒有相連」 → 「LED1 陰極（短腳）與 PS1 負端沒有相連」 —
 * while 「U1 PA5 與 LED1」 keeps the space next to Latin text. The one
 * implementation lives in src/i18n/tidy.ts (the shell's hints use it too —
 * UX fix SH-F11); re-exported here for the lessons engine.
 */
export { tidyCjkSpaces }

/** Every component id a check names (for 3D highlights of a failed check). */
export function pinRefComponent(ref: PinRef): string | null {
  if ('component' in ref) return ref.component
  if ('terminal' in ref) return parseTerminalRef(ref.terminal)?.componentId ?? null
  return null
}
