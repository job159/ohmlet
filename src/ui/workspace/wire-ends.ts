/**
 * Re-routing a wire by dragging one of its ends (UX fix wave SC-13) — the
 * host side of the scene's end handles, installed on the scene by
 * scene-bridge registerScene (SceneCallbacks.onWireEndPreview /
 * onWireEndMove), so App.tsx needs no change. Module-level, no React.
 *
 *   wireEndAccepted(id, end, ref)   would moving that end there be accepted? (preview tint)
 *   moveWireEndTo(id, end, ref)     the drop: store.moveWireEnd (ONE undo step, H8) + feedback
 *
 * The re-route is confirmed with 〔復原〕 (round 5 polish — the same toast as
 * a drag-drawn wire's: a mouse press on ANY wire's end now re-routes it, so
 * an orbit that started there comes back in one tap); a refused drop plays
 * the refusal sound (playMech 'refuse') with its 「這裡不能接」.
 *
 * Feedback speaks the shared names (H2 endpointName): 「已改接導線 W8：U1 PA6
 * （a19）→ e40（R2 第 1 腳這一排）」, a refusal 「這裡不能接：a20 已經被導線 W3
 * 佔用」 (wireRefusalText). A wire that still wears its convention colour
 * (black to ground, red to supply, yellow otherwise — the user never picked
 * a swatch for it) is re-coloured by the convention of its new ends in the
 * same undo step (store.moveWireEnd's `color` option, H8).
 */
import type { CircuitLayout } from '../../model/types'
import { useStore, wireRefusal, type WireEditResult } from '../../state/store'
import { conventionWireColor } from '../chrome/wire-convention'
import { undoableToast } from '../chrome/edit-feedback'
import { showToast, tick } from '../kit'
import { t } from '../../i18n'
import { playMech } from '../fx/sound'
import { isLegacyChrome } from '../chrome/legacy'
import { endpointName, wireRefusalText } from './hole-chip'

type End = 'from' | 'to'

/** The layout without wire `id` (its old end hole is free for the moved end). */
function without(layout: CircuitLayout, id: string): CircuitLayout {
  return { ...layout, wires: layout.wires.filter((w) => w.id !== id) }
}

/**
 * Would moving `end` of wire `id` to `ref` be accepted (the store's own
 * checks, wireRefusal with the wire out of the way)? The unchanged spot
 * counts as accepted. Pure read of the store; never throws.
 */
export function wireEndAccepted(id: string, end: End, ref: string): boolean {
  try {
    const layout = useStore.getState().layout
    const wire = layout.wires.find((w) => w.id === id)
    if (!wire) return false
    if (wire[end] === ref) return true
    const other = wire[end === 'from' ? 'to' : 'from']
    const rest = without(layout, id)
    return (end === 'from' ? wireRefusal(rest, ref, other) : wireRefusal(rest, other, ref)) === null
  } catch {
    return true
  }
}

/**
 * The drop of an end handle: re-route the end (one undo step) with a short
 * confirmation, or say why it cannot go there; released away from any hole
 * or terminal, the wire stays as it was (and says so).
 */
export function moveWireEndTo(id: string, end: End, ref: string | null): void {
  const st = useStore.getState()
  const wire = st.layout.wires.find((w) => w.id === id)
  if (!wire) return
  if (ref === null) {
    showToast(t('Released away from a hole or terminal — wire {id} stays as it was', { id }), { duration: 2600 })
    return
  }
  const other = wire[end === 'from' ? 'to' : 'from']
  // still the convention colour of its ends → follow the convention to the new ones
  const auto = wire.color === conventionWireColor(st.layout, [wire.from, wire.to])
  const nextColor = auto ? conventionWireColor(without(st.layout, id), end === 'from' ? [ref, other] : [other, ref]) : wire.color
  const res: WireEditResult = st.moveWireEnd(id, end, ref, nextColor !== wire.color ? { color: nextColor } : undefined)
  if (!res.ok) {
    showToast(t('Can’t connect here: {reason}', { reason: wireRefusalText(res.refusal) }), { duration: 3600 })
    if (!isLegacyChrome()) playMech('refuse') // a refused drop sounds like a new wire's (wire-draw.ts)
    return
  }
  if (!res.changed) return
  tick()
  const layout = useStore.getState().layout
  const moved = layout.wires.find((w) => w.id === id)
  if (!moved) return
  // with 〔復原〕 like a new wire's 「已接上 …」 (polish): a drag that was meant
  // to be an orbit and caught a wire's end comes back in one tap
  undoableToast(t('Re-routed wire {id}: {a} → {b}', { id, a: endpointName(layout, moved.from), b: endpointName(layout, moved.to) }), layout)
}
