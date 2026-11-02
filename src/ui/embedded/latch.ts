/**
 * Keep-pressed buttons — 「保持按下」 (the latch; product owner's request
 * 「按鍵可以保持按下」).
 *
 * Any part whose catalog entry has the runtime 'pressed' param (the
 * pushbutton, the KY-040's push switch, the joystick's button…) can be KEPT
 * pressed. The state is derived, never stored apart from the document:
 *
 *   latched(id)  =  the layout says pressed:true  AND  no momentary hold is active
 *
 * A momentary hold — the 3D press-and-hold (SC-6, App.tsx handleObjectPress)
 * or the inspector's 按住 puck — marks the part HELD for its duration
 * (pressMomentary), so a part a finger holds down is pressed, not latched.
 * The keep-pressed toggle (setLatched) and the 3D double-click (latchPart)
 * write the same 'pressed' param and leave the part un-held. Consequences,
 * all by construction:
 *  - honest simulation: the latch IS the runtime 'pressed' param the
 *    momentary press uses (the contacts really close in the circuit, the
 *    firmware sees a held button);
 *  - never saved: 'pressed' is a transient param (store
 *    stripTransientParams — autosave, project files, exports, undo
 *    snapshots), so a reload, an undo or a load never brings a latch back;
 *  - a momentary press of a latched part releases it (the hold ends with
 *    pressed:false); deleting the part releases it;
 *  - 重置模擬 (the session ends: telemetry → null) releases every latch
 *    (bindLatchScene's watch — the product chrome only).
 *
 * The scene shows a lock badge over each latched part (IBreadboardScene
 * setLatchedParts, pushed by bindLatchScene on change — never per frame).
 * The same state everywhere, in the same words: the inspector's 「保持按下」
 * switch (the pushbutton's HoldGroup, the KY-040 / joystick 'pressed' row),
 * the long-press sheet's 保持按下 / 放開 (latchSheetItem), the status pill's
 * 「SW1 保持按下中」 〔放開〕 while a session runs (latchedSummaryOf,
 * releaseLatched), and lesson checks — which run with every button released
 * unless they press it themselves (actions.ts liveEvalInput / stepCheckHands).
 * Module-level, no React except the useLatched hook; pure reads take the
 * layout so the chip text (hole-chip.ts) stays a function of its inputs.
 */
import { create } from 'zustand'
import { getEntry, type CatalogEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import { useStore } from '../../state/store'
import { onLangChange, t } from '../../i18n'

/** Can this part be pressed (and so kept pressed): its catalog entry has the 'pressed' param. */
export function canPress(entry: CatalogEntry | null | undefined): boolean {
  return !!entry?.params?.some((p) => p.key === 'pressed')
}

interface LatchHolds {
  /** ids held down momentarily right now (3D press-and-hold, the 按住 puck) */
  held: readonly string[]
}

/** The momentary holds (runtime only). */
export const useLatchHolds = create<LatchHolds>(() => ({ held: [] }))

function beginHold(id: string): void {
  const held = useLatchHolds.getState().held
  if (!held.includes(id)) useLatchHolds.setState({ held: [...held, id] })
}

function endHold(id: string): void {
  const held = useLatchHolds.getState().held
  if (held.includes(id)) useLatchHolds.setState({ held: held.filter((h) => h !== id) })
}

/** Is `id` held down momentarily right now? */
export function isHeld(id: string): boolean {
  return useLatchHolds.getState().held.includes(id)
}

/** The latched parts of `layout` (layout order). */
export function latchedIn(layout: CircuitLayout, held: readonly string[] = useLatchHolds.getState().held): string[] {
  const out: string[] = []
  for (const c of Array.isArray(layout.components) ? layout.components : []) {
    if (!c || c.params?.pressed !== true || held.includes(c.id)) continue
    if (canPress(getEntry(c.type))) out.push(c.id)
  }
  return out
}

/** Is `id` kept pressed in `layout` (default: the store's)? */
export function isLatched(id: string, layout: CircuitLayout = useStore.getState().layout): boolean {
  const c = Array.isArray(layout.components) ? layout.components.find((x) => x && x.id === id) : undefined
  return !!c && c.params?.pressed === true && !isHeld(id) && canPress(getEntry(c.type))
}

/** Reactive isLatched (the inspector toggle). */
export function useLatched(id: string): boolean {
  const pressed = useStore((s) => s.layout.components.find((c) => c.id === id)?.params?.pressed === true)
  const held = useLatchHolds((s) => s.held.includes(id))
  return pressed && !held
}

/** A pressable part in the store's layout, or null. */
function pressableComp(id: string) {
  const comp = useStore.getState().layout.components.find((c) => c.id === id)
  return comp && canPress(getEntry(comp.type)) ? comp : null
}

/**
 * A momentary press (the 3D press-and-hold, the 按住 puck): pressed while
 * held. Down marks the part held (a latched part held by a finger is just
 * pressed); up lets go — which also releases a part that was latched. An up
 * for a part that is no longer held is ignored: the latch took it over
 * meanwhile (setLatched / latchPart), or 重置模擬 already let it go.
 */
export function pressMomentary(id: string, down: boolean): void {
  if (!pressableComp(id)) {
    endHold(id)
    return
  }
  const st = useStore.getState()
  if (down) {
    beginHold(id)
    st.setParam(id, 'pressed', true)
    return
  }
  if (!isHeld(id)) return
  st.setParam(id, 'pressed', false) // first: never "latched" between the two writes
  endHold(id)
}

/**
 * 「保持按下」 on / off (the inspector toggle): on = pressed until turned
 * off; off releases. Works with or without a simulation session (the
 * runtime param reaches the circuit whenever it runs). False when `id` is
 * not a pressable part.
 */
export function setLatched(id: string, on: boolean): boolean {
  if (!pressableComp(id)) return false
  endHold(id) // the toggle owns it now (a quick click's held-back release is superseded)
  useStore.getState().setParam(id, 'pressed', on)
  return true
}

/**
 * The 3D double-click (SceneCallbacks.onObjectLatch): the part its second
 * click pressed stays pressed. True when it is latched now.
 */
export function latchPart(id: string): boolean {
  return setLatched(id, true)
}

/** Release every latched (and held) part — 重置模擬. */
export function releaseAllLatches(): void {
  const st = useStore.getState()
  for (const c of st.layout.components) {
    if (c.params?.pressed === true && canPress(getEntry(c.type))) st.setParam(c.id, 'pressed', false)
  }
  if (useLatchHolds.getState().held.length > 0) useLatchHolds.setState({ held: [] })
}

/** 「SW1 保持按下中」 / 「SW1、SW2 保持按下中」 for the latched parts of `layout` ('' when none). */
export function latchedSummary(layout: CircuitLayout = useStore.getState().layout): string {
  return latchedSummaryOf(latchedIn(layout))
}

/** 「SW1 保持按下中」 for the latched part ids `ids` ('' when none) — callers that already hold the list (the status pill). */
export function latchedSummaryOf(ids: readonly string[]): string {
  return ids.length === 0 ? '' : t('{ids} kept pressed|latch', { ids: ids.join(t(', |list-separator')) })
}

/**
 * 「放開」 (the status pill, the long-press sheet): let go of the parts in
 * `ids` that are kept pressed right now (default: every latched part); a
 * part a finger holds is left to that finger. Returns how many it released.
 */
export function releaseLatched(ids: readonly string[] = latchedIn(useStore.getState().layout)): number {
  let n = 0
  for (const id of ids) if (isLatched(id) && setLatched(id, false)) n++
  return n
}

/** A 保持按下 / 放開 menu item (latchSheetItem). */
export interface LatchSheetItem {
  label: string
  /** the part is kept pressed now (the item releases it) */
  kept: boolean
  /** toggle it; false when `id` is no pressable part (any more) */
  run(): boolean
}

/**
 * The long-press action sheet's 「保持按下」 / 「放開」 item for part `id`
 * (App.tsx — the product chrome), or null when `id` is not a pressable part.
 * The sheet comes up on a long-press outside a session (before a run,
 * after 重置模擬); during a session a long-press on a button presses it
 * (the finger is the hand on the button) — its inspector switch and a
 * double-click / double-tap keep it pressed there.
 */
export function latchSheetItem(id: string, layout: CircuitLayout = useStore.getState().layout): LatchSheetItem | null {
  const comp = Array.isArray(layout.components) ? layout.components.find((c) => c && c.id === id) : undefined
  if (!comp || !canPress(getEntry(comp.type))) return null
  const kept = isLatched(id, layout)
  return {
    label: kept ? t('Release|latch') : t('Keep pressed|latch'),
    kept,
    run: () => setLatched(id, !kept),
  }
}

/** The scene half of the latch: the lock badges (IBreadboardScene.setLatchedParts). */
export interface LatchScene {
  setLatchedParts?(ids: readonly string[]): void
}

/**
 * App.tsx, once per mounted scene: push the latched parts to the scene on
 * every change (layout, holds, a chrome switch — never per frame), and
 * release every latch when the simulation session ends (重置模擬: telemetry
 * → null). `enabled` false (the classic chrome) pushes no badges and leaves
 * a reset as it was. Returns the unsubscribe.
 */
export function bindLatchScene(scene: LatchScene, enabled: () => boolean = () => true): () => void {
  let last: string | null = null
  const push = () => {
    const ids = enabled() ? latchedIn(useStore.getState().layout) : []
    const key = ids.join('\n')
    if (key === last) return
    last = key
    scene.setLatchedParts?.(ids)
  }
  push()
  const unsubStore = useStore.subscribe((s, prev) => {
    if (s.layout !== prev.layout) {
      // a held part that left the layout is held no more
      const held = useLatchHolds.getState().held
      if (held.some((id) => !s.layout.components.some((c) => c.id === id))) {
        useLatchHolds.setState({ held: held.filter((id) => s.layout.components.some((c) => c.id === id)) })
      }
      push()
    }
    // the session ended (重置模擬, a load): let go — after the store's own
    // update settles (resetSim has already reloaded the world; it is paused,
    // so the release lands before the next simulated step)
    if (s.telemetry === null && prev.telemetry !== null && enabled()) queueMicrotask(releaseAllLatches)
  })
  const unsubHolds = useLatchHolds.subscribe(push)
  const unsubLang = onLangChange(push)
  return () => {
    unsubStore()
    unsubHolds()
    unsubLang()
  }
}
