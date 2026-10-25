/**
 * Wire colour by convention (UX wave SH-8): while the user has not picked a
 * swatch since wire mode was armed, a new wire takes the colour its
 * endpoints call for —
 *   a ground point (− rail, GND / G / VSS / COM pin or terminal) → black,
 *   a supply point (+ rail, 5V / 3V3 / VCC / VDD / VIN / VOUT pin, + terminal) → red,
 *   anything else → yellow (signal).
 * A ground endpoint wins over a supply endpoint (the LED cathode → − rail
 * wire is black even though it starts on a plain strip). Endpoints are
 * classified on the static board nets joined by the existing wires, so a
 * hole on the same strip as a board's GND pin counts as ground. An explicit
 * swatch choice stays sticky until wire mode is armed again.
 *
 * Pure apart from the module-level "picked" flag; computed per click, never
 * per frame.
 */
import { getEntry } from '../../model/catalog'
import { componentPinHoles, netIdForHole, netIdForTerminal, parseHole, parseTerminalRef } from '../../model/breadboard'
import { boardConfigOf, type CircuitLayout } from '../../model/types'

export type ConventionColor = 'black' | 'red' | 'yellow'
export type EndpointPolarity = 'ground' | 'supply' | null

let picked = false

/** WireColorStrip: the user chose a swatch — keep it for this wire session. */
export function markWireColorPicked(): void {
  picked = true
}

/** Wire mode was (re-)armed: back to the convention. */
export function resetWireColorPick(): void {
  picked = false
}

/** Has the user picked a swatch since wire mode was armed? */
export function wireColorPicked(): boolean {
  return picked
}

const GROUND_PIN = /^(?:GND|VSS|COM|G|0V|-|−|V-)(?:_?\d+)?$/i
const SUPPLY_PIN = /^(?:VCC|VDD|VIN|VOUT|VBUS|5V|3V3|3\.3V|\+|V\+)(?:_?\d+)?$/i

/** Polarity of a pin / terminal name. */
export function pinPolarity(pin: string): EndpointPolarity {
  if (GROUND_PIN.test(pin)) return 'ground'
  if (SUPPLY_PIN.test(pin)) return 'supply'
  return null
}

/** Net id of an endpoint (hole or "ID:PIN" terminal); null when unparseable. */
function netOf(endpoint: string): string | null {
  const h = parseHole(endpoint)
  if (h) return netIdForHole(h)
  const term = parseTerminalRef(endpoint)
  return term ? netIdForTerminal(term.componentId, term.pin) : null
}

let cache: { layout: CircuitLayout; classOf: (net: string) => EndpointPolarity } | null = null

/** Static nets of `layout` joined by its wires, each classified once (cached per layout identity). */
function classifier(layout: CircuitLayout): (net: string) => EndpointPolarity {
  if (cache?.layout === layout) return cache.classOf
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const w of layout.wires) {
    const a = netOf(w.from)
    const b = netOf(w.to)
    if (a && b) union(a, b)
  }
  // classification per joined net: a rail decides by its marking, else pins
  const rail = new Map<string, EndpointPolarity>()
  const pins = new Map<string, Set<'ground' | 'supply'>>()
  const note = (net: string, p: EndpointPolarity) => {
    if (!p) return
    const root = find(net)
    let s = pins.get(root)
    if (!s) pins.set(root, (s = new Set()))
    s.add(p)
  }
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    if (entry.placement === 'offboard') {
      for (const pin of entry.pins) note(netIdForTerminal(comp.id, pin), pinPolarity(pin))
      continue
    }
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    holes.forEach((h, i) => {
      if (h) note(netIdForHole(h), pinPolarity(entry.pins[i]))
    })
  }
  const classOf = (net: string): EndpointPolarity => {
    const root = find(net)
    // the rail itself, or any rail joined to this net by wires
    if (!rail.has(root)) {
      let r: EndpointPolarity = null
      for (const key of [...parent.keys(), net]) {
        if (find(key) !== root) continue
        const m = /R:(?:top|bot)([+-])$/.exec(key)
        if (m) {
          r = m[1] === '-' ? 'ground' : r ?? 'supply'
          if (r === 'ground') break
        }
      }
      rail.set(root, r)
    }
    const fromRail = rail.get(root) ?? null
    if (fromRail) return fromRail
    const s = pins.get(root)
    if (s?.has('ground')) return 'ground'
    if (s?.has('supply')) return 'supply'
    return null
  }
  cache = { layout, classOf }
  return classOf
}

/** Polarity of one endpoint in `layout`. */
export function endpointPolarity(layout: CircuitLayout, endpoint: string): EndpointPolarity {
  const net = netOf(endpoint)
  return net ? classifier(layout)(net) : null
}

/** The conventional colour for a wire between `endpoints` (null entries ignored). */
export function conventionWireColor(layout: CircuitLayout, endpoints: readonly (string | null | undefined)[]): ConventionColor {
  let supply = false
  for (const e of endpoints) {
    if (!e) continue
    const p = endpointPolarity(layout, e)
    if (p === 'ground') return 'black'
    if (p === 'supply') supply = true
  }
  return supply ? 'red' : 'yellow'
}
