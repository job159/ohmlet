/**
 * Pin-name hover labels for the 3D scene (SceneCallbacks.holeLabelText):
 *   - a hole holding a component pin → "<id> · <silkscreen label or pin name> · <hole>"
 *     (e.g. "U1 · A5 · c20" on a Blue Pill, whose pinInfo labels PA5 "A5"),
 *   - a wire end → "<wire id> · <hole>",
 *   - anything else → null (the scene keeps its plain coordinate chip).
 * The index is rebuilt once per layout identity (hover fires per hole, the
 * layout only changes per edit). Pure — no DOM, no store.
 */
import type { CircuitLayout, HoleRef } from '../../model/types'
import { boardConfigOf } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { componentPinHoles, formatHole, parseHole } from '../../model/breadboard'

let cache: { layout: CircuitLayout; map: Map<string, string> } | null = null

export function holeLabelIndex(layout: CircuitLayout): Map<string, string> {
  if (cache?.layout === layout) return cache.map
  const map = new Map<string, string>()
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard') continue
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    const labels = new Map(entry.pinInfo?.map((p) => [p.pin, p.label ?? p.pin]) ?? [])
    holes.forEach((h, i) => {
      if (!h) return
      const ref = formatHole(h)
      const pin = entry.pins[i]
      map.set(ref, `${comp.id} · ${labels.get(pin) ?? pin} · ${ref}`)
    })
  }
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      const h = parseHole(end)
      if (!h) continue // off-board terminal ("PS1:+")
      const ref = formatHole(h)
      if (!map.has(ref)) map.set(ref, `${w.id} · ${ref}`)
    }
  }
  cache = { layout, map }
  return map
}

/** Label for `hole` in `layout`, or null. Accepts non-canonical refs ("0:a12"). */
export function holeLabelFor(layout: CircuitLayout, hole: HoleRef): string | null {
  const h = parseHole(hole)
  if (!h) return null
  return holeLabelIndex(layout).get(formatHole(h)) ?? null
}
