/**
 * edit-feedback.ts — what an editing click or key did, in the shell's own
 * words (release QA SH-F1 / SH-F6 / SH-F9). The decisions are pure functions
 * of the layout (tests); the *WithFeedback actions add the toast. New chrome
 * only: every caller keeps the classic chrome (isLegacyChrome) silent and
 * exactly as before.
 *
 *  - wireStartCheck(layout, endpoint): may a new wire START here? A start
 *    that can never be completed is never stored (SH-F1). An occupied hole
 *    holding a PART PIN redirects to the free hole of the same net nearest
 *    the click (the 5-hole strip — 「c21 被 U1 PA4 佔用，已改從同一排的 a21
 *    拉線」; a rail hole: the same rail); any other refusal (a wire end, a
 *    covered hole, off the board, a full strip) is refused at once and the
 *    start stays empty. Same rules as store.wireRefusal (its on-board test,
 *    store.occupiedHoles, store.occludedHolesOf).
 *  - refusalConcernsFrom(refusal, from): a refused second click whose problem
 *    is the started end itself drops that start (the next click starts anew).
 *  - placementSpotReason(layout, type, hole, picked): why a leads / probe
 *    hole click was refused (SH-F6) — the H2 wording (wireRefusalText) for an
 *    occupied / covered / off-board hole, 「a20 已經選過了」 for a hole picked
 *    already, or the part body that would cover a hole in use.
 *  - describeLayoutChange(before, after): one step of the history as a
 *    person says it — 「放上 R1」, 「刪除導線 W6」, 「移動 U1」 (SH-F9), for
 *    「已復原：…」 / 「已重做：…」; deletedText names what Delete removed.
 *  - the 「這裡不能接」 toast is ONE toast (showWireRefusalToast replaces the
 *    previous one); it goes when wire mode ends and on undo / redo.
 */
import type { CircuitLayout, ComponentInstance, Hole, Wire } from '../../model/types'
import { BOARD_SIZES, STRIP_ROWS, boardConfigOf } from '../../model/types'
import { componentPinHoles, formatHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { getEntry } from '../../model/catalog'
import { occludedHoles } from '../../model/occlusion'
import {
  normalizeHoleRef,
  occludedHolesOf,
  occupiedHoles,
  placementValid,
  useStore,
  wireRefusal,
  type WireRefusal,
} from '../../state/store'
import { t } from '../../i18n'
import { partLabel, pinLabel } from '../../i18n/parts'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { dismissToast, showToast } from '../kit'
import { wireRefusalText } from '../workspace/hole-chip'
import { playCue, type SoundCue } from '../fx/sound'
import { isLegacyChrome } from './legacy'
import { coarsePointer } from './hints'
import { shortcutKeysText } from './ShortcutsSheet'

// ---------------------------------------------------------------------------
// one endpoint on its own (the rules of store.wireRefusal)
// ---------------------------------------------------------------------------

/** The part whose molded body covers hole `ref` (canonical), if any. */
export function coveringComponentId(layout: CircuitLayout, ref: string): string | undefined {
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (entry && occludedHoles(comp, entry, config).has(ref)) return comp.id
  }
  return undefined
}

/**
 * Why `ref` could not be an end of ANY new wire on `layout` (null = it can):
 * off the active rig / not a terminal of a placed part (store.wireRefusal's
 * own endpoint test), a lead or wire end in the hole (store.occupiedHoles),
 * under a part body (store.occludedHolesOf). The checks build their sets
 * once per call of the returned function's owner — use one checker for a
 * whole search.
 */
export function endpointChecker(layout: CircuitLayout): (ref: string) => WireRefusal | null {
  let used: Set<string> | null = null
  let blocked: Set<string> | null = null
  return (ref) => {
    // the store's endpoint test (on the active rig / a placed part's terminal)
    // answers first for a point paired with itself
    const self = wireRefusal(layout, ref, ref)
    if (self?.kind === 'invalid-endpoint') return self
    const hole = normalizeHoleRef(ref)
    if (!hole) return null // a terminal takes any number of wires
    used ??= occupiedHoles(layout)
    if (used.has(hole)) return { kind: 'occupied', ref: hole }
    blocked ??= occludedHolesOf(layout)
    if (blocked.has(hole)) {
      const by = coveringComponentId(layout, hole)
      return by ? { kind: 'covered', ref: hole, by } : { kind: 'covered', ref: hole }
    }
    return null
  }
}

/** endpointChecker for a single endpoint. */
export function endpointRefusal(layout: CircuitLayout, ref: string): WireRefusal | null {
  return endpointChecker(layout)(ref)
}

/** The part pin plugged into hole `ref` (canonical), if one is. */
export function pinInHole(layout: CircuitLayout, ref: string): { id: string; pin: string; label: string } | null {
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard') continue
    const holes = componentPinHoles(comp, entry, config)
    const i = holes?.findIndex((h) => h != null && formatHole(h) === ref) ?? -1
    if (i >= 0) return { id: comp.id, pin: entry.pins[i], label: pinLabel(entry, entry.pins[i], { id: comp.id, form: 'short' }) }
  }
  return null
}

/**
 * The other holes of `ref`'s static net, nearest first: the rest of its
 * 5-hole strip (a–e or f–j of the same column; a tie goes to the row away
 * from the centre channel), or the rest of its power rail. Holes the rig
 * does not have are left for the checker to refuse.
 */
export function sameNetHoles(layout: CircuitLayout, ref: string): string[] {
  const h = parseHole(ref)
  if (!h) return []
  const withRow = (x: Hole): Hole => (h.boardRow ? { ...x, boardRow: h.boardRow } : x)
  if (h.kind === 'strip') {
    const i = STRIP_ROWS.indexOf(h.row)
    const half = i < 5 ? STRIP_ROWS.slice(0, 5) : STRIP_ROWS.slice(5)
    const outward = i < 5 ? -1 : 1 // a tie goes away from the channel
    return half
      .filter((row) => row !== h.row)
      .sort((p, q) => {
        const dp = Math.abs(STRIP_ROWS.indexOf(p) - i)
        const dq = Math.abs(STRIP_ROWS.indexOf(q) - i)
        if (dp !== dq) return dp - dq
        return (STRIP_ROWS.indexOf(p) - i) * outward > 0 ? -1 : 1
      })
      .map((row) => formatHole(withRow({ kind: 'strip', col: h.col, row })))
  }
  const config = boardConfigOf(layout)
  const n = BOARD_SIZES[config.size].railHoles * config.count
  const out: string[] = []
  for (let d = 1; d < n; d++) {
    for (const index of [h.index - d, h.index + d]) {
      if (index >= 0 && index < n) out.push(formatHole(withRow({ kind: 'rail', rail: h.rail, index })))
    }
  }
  return out
}

/** What a wire-mode click on `endpoint` with no start yet should do. */
export type WireStart =
  | { kind: 'ok' }
  /** a part pin sits in the hole: start from the nearest free hole of its net instead */
  | { kind: 'redirect'; from: string; hole: string; pin: string; rail: boolean }
  /**
   * no start: `where` says what the user can still do — a free hole of the
   * same strip / rail exists ('row' / 'rail'), the net has none left
   * ('row-full' / 'rail-full'), or nothing to suggest (off the board)
   */
  | { kind: 'refuse'; refusal: WireRefusal; where: 'row' | 'rail' | 'row-full' | 'rail-full' | null }

/** May a new wire start at `endpoint` (SH-F1)? */
export function wireStartCheck(layout: CircuitLayout, endpoint: string): WireStart {
  const check = endpointChecker(layout)
  const refusal = check(endpoint)
  if (!refusal) return { kind: 'ok' }
  if (refusal.kind !== 'occupied' && refusal.kind !== 'covered') return { kind: 'refuse', refusal, where: null }
  const h = parseHole(refusal.ref)
  const rail = h?.kind === 'rail'
  const free = sameNetHoles(layout, refusal.ref).find((ref) => check(ref) == null) ?? null
  const pin = refusal.kind === 'occupied' ? pinInHole(layout, refusal.ref) : null
  if (pin && free) return { kind: 'redirect', from: free, hole: refusal.ref, pin: pin.label, rail }
  return { kind: 'refuse', refusal, where: free ? (rail ? 'rail' : 'row') : rail ? 'rail-full' : 'row-full' }
}

/**
 * Is a refused second click's problem the STARTED end itself (occupied,
 * covered or no longer on the rig — e.g. after an undo)? Then the start is
 * dropped; a problem with the second end keeps it so the user can re-aim.
 */
export function refusalConcernsFrom(refusal: WireRefusal, from: string): boolean {
  if (refusal.kind !== 'occupied' && refusal.kind !== 'covered' && refusal.kind !== 'invalid-endpoint') return false
  return refusal.ref === (normalizeHoleRef(from) ?? from)
}

// ---------------------------------------------------------------------------
// a refused leads / probe hole (SH-F6)
// ---------------------------------------------------------------------------

/**
 * Why placing the next lead of `type` on `hole` is refused (null = it is
 * not): the checks of store.placementValid in its order, each in the H2
 * wording — 「a90 不在目前的麵包板上」, 「a20 已經選過了」, 「a20 已經被導線 W1
 * 佔用」, 「c25 已經被 U1 PA0 佔用」, 「e20 被 U1 的本體蓋住了」 — or, for the
 * last lead, the new part's body over a hole in use.
 */
export function placementSpotReason(layout: CircuitLayout, type: string, hole: string, picked: readonly string[] = []): string | null {
  if (placementValid(layout, type, hole, [...picked])) return null
  const entry = getEntry(type)
  const ref = normalizeHoleRef(hole)
  const h = ref ? parseHole(ref) : null
  if (!entry || !ref || !h) return null
  const check = endpointChecker(layout)
  const refusal = check(ref)
  if (refusal?.kind === 'invalid-endpoint') return wireRefusalText(refusal, layout)
  if (picked.some((p) => normalizeHoleRef(p) === ref)) return t('{hole} is already picked', { hole: ref })
  if (refusal) return wireRefusalText(refusal, layout)
  // the last lead: the part's own body would overhang a hole in use
  const used = occupiedHoles(layout)
  const probe: ComponentInstance = { id: '__ghost__', type, holes: [...picked.map((p) => normalizeHoleRef(p) ?? p), ref] }
  for (const covered of occludedHoles(probe, entry, boardConfigOf(layout))) {
    if (used.has(covered)) return t('the body of {part} would cover {hole}, which is already in use', { part: partLabel(entry), hole: covered })
  }
  return null
}

// ---------------------------------------------------------------------------
// one history step in words (SH-F9)
// ---------------------------------------------------------------------------

/** 「R1、LED1」, 「R1、LED1、R2 等 5 項」 (', ' in English). */
export function nameList(names: readonly string[]): string {
  const sep = t(', ')
  if (names.length <= 3) return names.join(sep)
  return t('{names} ({n} in all)|history', { names: names.slice(0, 3).join(sep), n: names.length })
}

const wireName = (id: string) => t('Wire {id}', { id })

/** A wire whose off-board end belongs to one of `ids` (it goes with that part). */
function attachedTo(w: Wire, ids: ReadonlySet<string>): boolean {
  for (const end of [w.from, w.to]) {
    const term = parseHole(end) ? null : parseTerminalRef(end)
    if (term && ids.has(term.componentId)) return true
  }
  return false
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The edit that turns `before` into `after`, as a person says it (null when
 * nothing a person would name changed): 「清空麵包板」 (an emptied board of
 * more than three named things — the last part deleted stays 「刪除 R1」), 「載入電路」, 「放上
 * R1」, 「接上導線 W6」, 「刪除 PS1」, 「刪除導線 W6」, 「移動 R1」, 「旋轉 U1」,
 * 「調整 R1」, 「改接導線 W3」, 「更改導線 W3 的顏色」, 「變更麵包板」. For an
 * undo pass (after-undo, before-undo); for a redo (before-redo, after-redo).
 */
export function describeLayoutChange(before: CircuitLayout, after: CircuitLayout): string | null {
  const label = changeLabel(before, after)
  return label == null ? null : tidyCjkSpaces(label)
}

function changeLabel(before: CircuitLayout, after: CircuitLayout): string | null {
  if (before === after) return null
  const bComps = new Map(before.components.map((c) => [c.id, c]))
  const aComps = new Map(after.components.map((c) => [c.id, c]))
  const bWires = new Map(before.wires.map((w) => [w.id, w]))
  const aWires = new Map(after.wires.map((w) => [w.id, w]))
  const addedC = after.components.filter((c) => !bComps.has(c.id)).map((c) => c.id)
  const removedC = before.components.filter((c) => !aComps.has(c.id)).map((c) => c.id)
  const addedW = after.wires.filter((w) => !bWires.has(w.id))
  const removedW = before.wires.filter((w) => !aWires.has(w.id))
  // what a removal names: the parts, and the wires that did not go with them
  const gone = new Set(removedC)
  const removedNames = [...removedC, ...removedW.filter((w) => !attachedTo(w, gone)).map((w) => wireName(w.id))]
  // an emptied board: 「清空麵包板」 only when it took more than a person
  // would list — deleting the last part reads 「刪除 R1」, never 「清空麵包板」
  if (after.components.length === 0 && after.wires.length === 0 && removedNames.length > 3) {
    return t('Clear the board|history')
  }
  // a whole circuit at once (an example, an import, an AI circuit): a single
  // edit never adds a part and a wire together, nor swaps parts for others
  if ((addedC.length > 0 && addedW.length > 0) || (addedC.length > 0 && removedC.length > 0)) return t('Load a circuit|history')
  if (addedC.length > 0 || addedW.length > 0) {
    if (removedC.length > 0 || removedW.length > 0) return t('Load a circuit|history')
    return addedC.length > 0
      ? t('Place {names}|history', { names: nameList(addedC) })
      : t('Connect {names}|history', { names: nameList(addedW.map((w) => wireName(w.id))) })
  }
  if (removedNames.length > 0) return t('Delete {names}|history', { names: nameList(removedNames) })
  if (
    (before.board ?? 'standard') !== (after.board ?? 'standard') ||
    (before.boardCount ?? 1) !== (after.boardCount ?? 1) ||
    (before.boardRows ?? 1) !== (after.boardRows ?? 1)
  ) {
    return t('Change the breadboard|history')
  }
  const moved: string[] = []
  const rotated: string[] = []
  const adjusted: string[] = []
  for (const c of after.components) {
    const b = bComps.get(c.id)
    if (!b || b === c) continue
    if (!same(b.rotation, c.rotation)) rotated.push(c.id)
    else if (!same(b.at, c.at) || !same(b.holes, c.holes) || !same(b.pos, c.pos)) moved.push(c.id)
    else if (!same(b.params, c.params)) adjusted.push(c.id)
  }
  const rewired: string[] = []
  const recolored: string[] = []
  for (const w of after.wires) {
    const b = bWires.get(w.id)
    if (!b || b === w) continue
    if (b.from !== w.from || b.to !== w.to) rewired.push(wireName(w.id))
    else if (!same(b.color, w.color)) recolored.push(wireName(w.id))
  }
  if (moved.length > 0) return t('Move {names}|history', { names: nameList(moved) })
  if (rotated.length > 0) return t('Rotate {names}|history', { names: nameList(rotated) })
  if (rewired.length > 0) return t('Rewire {names}|history', { names: nameList(rewired) })
  if (adjusted.length > 0) return t('Adjust {names}|history', { names: nameList(adjusted) })
  if (recolored.length > 0) return t('Recolor {names}|history', { names: nameList(recolored) })
  return null
}

/** 「已復原：放上 R1」 / 「已重做：刪除導線 W6」 (「已復原」 alone when the step has no name). */
export function historyStepText(direction: 'undo' | 'redo', label: string | null): string {
  const text =
    direction === 'undo'
      ? label
        ? t('Undone: {what}', { what: label })
        : t('Undone|history')
      : label
        ? t('Redone: {what}', { what: label })
        : t('Redone|history')
  return tidyCjkSpaces(text)
}

/** The selected ids as a person names them: 「PS1」, 「導線 W3」. */
export function selectionNames(layout: CircuitLayout, ids: readonly string[]): string[] {
  return ids
    .filter((id) => layout.components.some((c) => c.id === id) || layout.wires.some((w) => w.id === id))
    .map((id) => (layout.components.some((c) => c.id === id) ? id : wireName(id)))
}

/** 「已刪除 PS1——Ctrl+Z 可復原」 (⌘Z on a Mac; a touch screen names the ↶ button). */
export function deletedText(names: readonly string[], touch = coarsePointer()): string {
  const p = { names: nameList(names) }
  return tidyCjkSpaces(
    touch ? t('{names} deleted — tap ↶ to undo', p) : t('{names} deleted — {keys} undoes it', { ...p, keys: shortcutKeysText('undo') }),
  )
}

// ---------------------------------------------------------------------------
// the toasts (new chrome)
// ---------------------------------------------------------------------------

/** The one 「這裡不能接」 toast (a new one replaces it). */
let wireRefusalToastId: number | null = null
/** The last 「已復原 / 已重做 / 已刪除」 toast (a held Ctrl+Z replaces it). */
let historyToastId: number | null = null

/** Show a wire refusal, replacing the previous one. */
export function showWireRefusalToast(text: string): void {
  dismissWireRefusalToast()
  wireRefusalToastId = showToast(text, { duration: 3200 })
}

/** Drop the 「這裡不能接」 toast (wire mode ended, an undo / redo, a wire that worked). */
export function dismissWireRefusalToast(): void {
  if (wireRefusalToastId != null) dismissToast(wireRefusalToastId)
  wireRefusalToastId = null
}

function historyToast(text: string): void {
  if (historyToastId != null) dismissToast(historyToastId)
  historyToastId = showToast(text, { duration: 2600 })
}

/** Undo (Ctrl/⌘+Z, the undo pill): one step back, and the new chrome says which. */
export function undoWithFeedback(): void {
  const st = useStore.getState()
  if (isLegacyChrome()) {
    st.undo()
    return
  }
  const before = st.layout
  st.undo()
  const after = useStore.getState().layout
  if (after === before) return
  dismissWireRefusalToast()
  historyToast(historyStepText('undo', describeLayoutChange(after, before)))
}

/** Redo (Ctrl/⌘+Shift+Z, Ctrl+Y, the redo button). */
export function redoWithFeedback(): void {
  const st = useStore.getState()
  if (isLegacyChrome()) {
    st.redo()
    return
  }
  const before = st.layout
  st.redo()
  const after = useStore.getState().layout
  if (after === before) return
  dismissWireRefusalToast()
  historyToast(historyStepText('redo', describeLayoutChange(before, after)))
}

/**
 * The boards of `layout` whose loaded firmware a whole-circuit load would
 * overwrite (operation simplification: a load replacing the board acts at
 * once — the circuit is one undo step — and asks first only for what undo
 * cannot bring back: firmware bindings are not in the history). `next`: the
 * MCU ids the incoming circuit binds or clears (a lesson load); null = every
 * binding is replaced (a project / example import). A board the load merely
 * takes away keeps its binding for the undo (the lab's detached bindings).
 */
export function firmwareAtRisk(layout: CircuitLayout, firmware: Readonly<Record<string, unknown>>, next: ReadonlySet<string> | null): string[] {
  return layout.components
    .filter((c) => !!getEntry(c.type)?.mcu && firmware[c.id] != null && (next === null || next.has(c.id)))
    .map((c) => c.id)
}

/** 「U1 的 hal-blink.elf」: a board and the firmware file loaded on it (the id alone when the name is unknown). */
function boardFirmwareName(id: string, firmware: Readonly<Record<string, unknown>>): string {
  const rec = firmware[id] as { name?: unknown } | null | undefined
  return typeof rec?.name === 'string' && rec.name ? t('{file} on {id}|firmware at risk', { id, file: rec.name }) : id
}

/**
 * The one confirmation a whole-circuit load still asks (review F7): only
 * when it would overwrite firmware (firmwareAtRisk — undo cannot bring that
 * back), and then it names the boards and says so — title 「要取代電路和 U1
 * 的韌體嗎？」, message 「「Blue Pill 閃爍 LED（HAL）」會取代目前的電路（按 ↶
 * 可復原），也會取代已載入的韌體：U1 的 hal-blink.elf（韌體無法復原）。」.
 * Shared by 範例 → 開啟, 下一課 / 開始引導 and 載入完整答案 (product chrome).
 */
export function firmwareRiskDialog(
  title: string,
  boards: readonly string[],
  firmware: Readonly<Record<string, unknown>>,
): { title: string; message: string } {
  return {
    title: t('Replace the circuit and the firmware of {boards}?', { boards: nameList(boards) }),
    message: t('“{title}” replaces the circuit (↶ brings it back) and the loaded firmware: {list} (the firmware cannot be undone).', {
      title,
      list: nameList(boards.map((id) => boardFirmwareName(id, firmware))),
    }),
  }
}

/**
 * A quiet sound cue for an edit (product chrome; src/ui/fx/sound.ts —
 * rate-limited, silent before the first gesture and while 音效 is off): a
 * part placed ('place'), a wire completed ('wire'), parts deleted
 * ('delete'). The classic chrome stays silent, as it always was.
 */
export function editCue(cue: Extract<SoundCue, 'place' | 'wire' | 'delete'>): void {
  if (!isLegacyChrome()) playCue(cue)
}

/**
 * The 〔復原〕 action of an edit toast: undoes `after`'s step — only while the
 * board still IS `after` (one more edit since, and the button would undo
 * that one instead: it says so and leaves the history to ↶ / Ctrl+Z).
 */
export function undoAction(after: CircuitLayout): { label: string; run(): void } {
  return {
    label: t('Undo'),
    run: () => {
      if (useStore.getState().layout !== after) {
        historyToast(t('The board changed since — step back with ↶'))
        return
      }
      undoWithFeedback()
    },
  }
}

/** The open 〔復原〕 toast's board watch (undoableToast). */
let undoableWatch: (() => void) | null = null

/**
 * A toast for a step the user can take back at once: its words + 〔復原〕.
 * It leaves as soon as the board is no longer `after` (one more edit, a hand
 * wiring after a lesson load…): its 〔復原〕 could then only refuse.
 */
export function undoableToast(text: string, after: CircuitLayout = useStore.getState().layout): void {
  if (historyToastId != null) dismissToast(historyToastId)
  undoableWatch?.()
  undoableWatch = null
  const id = showToast(text, { action: undoAction(after) })
  historyToastId = id
  const unsubscribe = useStore.subscribe((s) => {
    if (s.layout === after) return
    unsubscribe()
    if (undoableWatch === unsubscribe) undoableWatch = null
    dismissToast(id)
  })
  undoableWatch = unsubscribe
}

/** The Delete key: remove the selection; the new chrome names what went and how to get it back. */
export function removeSelectedWithFeedback(): boolean {
  const st = useStore.getState()
  if (st.selection.length === 0) return false
  const names = selectionNames(st.layout, st.selection)
  const before = st.layout
  st.removeSelected()
  const after = useStore.getState().layout
  // operation simplification: deleting never asks first — the toast carries 〔復原〕
  if (!isLegacyChrome() && after !== before && names.length > 0) {
    undoableToast(deletedText(names), after)
    editCue('delete')
  }
  return true
}

/** The long-press sheet's 「刪除」 and the inspector's 「移除」 (new chrome): the Delete key's words, with 〔復原〕. */
export function deletedToast(names: readonly string[]): void {
  undoableToast(deletedText(names))
  editCue('delete')
}
