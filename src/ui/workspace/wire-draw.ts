/**
 * Drawing a wire by dragging (round 5 drag-to-wire) — the host side of the
 * scene's drag-to-wire gesture, installed on the scene by scene-bridge
 * registerScene (SceneCallbacks.wireDrawStart / onWireDrawStarted /
 * onWireDrawPreview / onWireDraw, and the polish round's wireDrawLanding /
 * wireDrawStartText / wireGripText / onWireDrawHint), so App.tsx needs no
 * change. A sibling of wire-ends.ts (SC-13). Module-level, no React.
 * Product chrome only: the classic chrome never starts one (wireDrawStart
 * answers null).
 *
 *   wireDrawStart(ref)            may a wire start at the pressed point — and from where?
 *   wireDrawStarted(from)         the drag became real (haptic tick)
 *   wireDrawAccepted(from, to)    would from → to be accepted (preview tint)?
 *   wireDrawLanding(from, to)     where would a drop at `to` really land (a leg → its strip's free hole)?
 *   wireDrawStartText(p, from)    the chip's words for a start a pin's press moved
 *   wireGripText(ref, wireId)     a finger's grip chip: what a lift / a drag does
 *   wireDrawHint()                the one-time tip (the mouse first rests on a free hole)
 *   wireDrawTooSmall()            zoomed too far out, a press in a hole orbited: how to zoom in (once a page)
 *   drawWire(from, to, pressed?)  the drop: store.addWire (ONE undo step) + feedback
 *
 * The start follows the wire mode's own rule (edit-feedback wireStartCheck,
 * release QA SH-F1): a free hole or a terminal starts the wire there, a part
 * pin's hole starts it from the free hole of the same strip / rail nearest
 * the pin, anything else (a wire end, a covered hole, a full strip) starts
 * nothing — the press stays an orbit / tap. The DROP follows the same rule
 * (polish): a leg is the natural target, so a drop on a part pin's hole
 * lands on the free hole of that strip nearest the pin — the preview, ring
 * and chip already show that hole (「c25 被 R1 第 2 腳佔用 → 接到同一排的
 * a25」) and the toast says where it went (「已接上 a19 → a25（c25 被 R1 第 2
 * 腳佔用，改接同一排）」); only a strip with no free hole refuses — and a
 * hole on the START's own strip / rail, free or a leg (final round: the
 * breadboard joins them already — 「這裡不能接：d40 跟起點在同一排，本來就是
 * 通的」, said on the aim chip before the drop too). The drop
 * stores the wire in its net's role colour (contract C1, wire-roles
 * roleColorOfNewWire), keeps the mode and the selection as they are (a
 * selected wire's sheet would cover a phone's board) and confirms it with
 * 〔復原〕, which also takes back a drag that was meant to be an orbit. A
 * refusal says why (「這裡不能接：…」, the wire mode's one refusal toast) with
 * the refusal sound; released away from any hole or terminal, nothing
 * happens (no toast, no sound).
 */
import type { CircuitLayout } from '../../model/types'
import { parseHole } from '../../model/breadboard'
import { normalizeHoleRef, useStore, wireRefusal, type WireRefusal } from '../../state/store'
import { showToast, tick } from '../kit'
import { t } from '../../i18n'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { playMech } from '../fx/sound'
import { isLegacyChrome } from '../chrome/legacy'
import {
  dismissWireRefusalToast,
  editCue,
  endpointChecker,
  pinInHole,
  sameNetHoles,
  showWireRefusalToast,
  undoableToast,
  wireStartCheck,
} from '../chrome/edit-feedback'
import { arrowJoin, coarsePointer, wireRefusedHint, wireStartHint } from '../chrome/hints'
import { roleColorOfNewWire } from '../wire-roles'
import { endpointName } from './hole-chip'

/**
 * Where a wire pressed at `ref` starts (null = none here). Select mode, or
 * the wire mode before its first end is picked; never in the classic chrome.
 * Pure read of the store; never throws.
 */
export function wireDrawStart(ref: string): string | null {
  try {
    if (isLegacyChrome()) return null
    const st = useStore.getState()
    const mode = st.mode
    if (mode.kind !== 'select' && !(mode.kind === 'wire' && mode.from === null)) return null
    const check = wireStartCheck(st.layout, ref)
    if (check.kind === 'ok') return ref
    return check.kind === 'redirect' ? check.from : null
  } catch {
    return null
  }
}

/** The wire left its start: the haptic tick of a wire in hand. */
export function wireDrawStarted(_from: string): void {
  tick()
}

/** Would a wire from → to be accepted (the store's own checks)? Pure; never throws. */
export function wireDrawAccepted(from: string, to: string): boolean {
  try {
    return wireRefusal(useStore.getState().layout, from, to) === null
  } catch {
    return true
  }
}

/** Where a drop lands (landingOf). */
export type WireLanding =
  | { kind: 'ok'; to: string }
  /** a part pin sits in the aimed hole: the wire lands on the free hole of its strip / rail instead */
  | { kind: 'redirect'; to: string; hole: string; pin: string; rail: boolean }
  /**
   * final round: the aimed hole (`hole`, canonical) is on the START's own
   * strip / rail — the two points are joined by the breadboard already, so
   * a wire there would join the net to itself: refused, saying so
   */
  | { kind: 'joined'; hole: string; rail: boolean }
  /** no landing: why (`full`: the pin's strip / rail has no free hole left) */
  | { kind: 'refuse'; refusal: WireRefusal; full: 'row-full' | 'rail-full' | null }

/**
 * Where a new wire from `from` dropped on `to` lands on `layout` (polish —
 * the start's rule, wireStartCheck, for the drop): a hole on `from`'s own
 * strip / rail — free or a part's leg — is no landing at all ('joined': the
 * breadboard joins the two already; final round, one rule and one reason
 * for both); else `to` when the store takes it; a part pin's hole → the
 * free hole of the same 5-hole strip / rail nearest the pin that takes this
 * wire; otherwise refused, saying whether the strip was full.
 */
export function landingOf(layout: CircuitLayout, from: string, to: string): WireLanding {
  const aimed = normalizeHoleRef(to)
  const start = normalizeHoleRef(from)
  // (the start itself is the scene's silent cancel — drawWire returns before asking)
  if (aimed !== null && start !== null && aimed !== start && sameNetHoles(layout, aimed).includes(start)) {
    return { kind: 'joined', hole: aimed, rail: parseHole(aimed)?.kind === 'rail' }
  }
  const refusal = wireRefusal(layout, from, to)
  if (!refusal) return { kind: 'ok', to }
  if (refusal.kind !== 'occupied' || aimed === null || refusal.ref !== aimed) return { kind: 'refuse', refusal, full: null }
  const pin = pinInHole(layout, aimed)
  if (!pin) return { kind: 'refuse', refusal, full: null }
  const rail = parseHole(aimed)?.kind === 'rail'
  // (never `from`'s own strip: 'joined' answered that above)
  const strip = sameNetHoles(layout, aimed)
  const check = endpointChecker(layout)
  const free = strip.find((ref) => check(ref) == null && wireRefusal(layout, from, ref) == null) ?? null
  if (!free) return { kind: 'refuse', refusal, full: rail ? 'rail-full' : 'row-full' }
  return { kind: 'redirect', to: free, hole: aimed, pin: pin.label, rail }
}

/**
 * 「d40 跟起點在同一排，本來就是通的」: why a drop on the start's own strip /
 * rail does nothing. A rail hole goes by its tidy name, like the 「已接上 …」
 * toast and the hover chip (「上方 + 電源軌第 22 孔跟起點在同一條電源軌上…」).
 */
function joinedText(land: Extract<WireLanding, { kind: 'joined' }>, layout: CircuitLayout): string {
  const p = { hole: land.rail ? endpointName(layout, land.hole) : land.hole }
  return tidyCjkSpaces(
    land.rail
      ? t('{hole} is on the same rail as the start — they are already connected', p)
      : t('{hole} is in the same row as the start — they are already connected', p),
  )
}

/**
 * Wire mode's second click (App.tsx wireEndpointClick, product chrome) keeps
 * the drag's 'joined' rule: a hole on the first end's own strip / rail is
 * refused with 「這裡不能接：d40 跟起點在同一排，本來就是通的」. Null when the
 * rule does not apply (the store's own checks follow). Pure; never throws.
 */
export function joinedRefusalText(layout: CircuitLayout, from: string, to: string): string | null {
  try {
    const land = landingOf(layout, from, to)
    return land.kind === 'joined' ? tidyCjkSpaces(t('Can’t wire here: {reason}', { reason: joinedText(land, layout) })) : null
  } catch {
    return null
  }
}

/**
 * The scene's question while a new wire aims at `to`: where would the drop
 * land (null = nowhere: the red route), with the chip's words when it
 * moves along the strip — 「c25 被 R1 第 2 腳佔用 → 接到同一排的 a25」. A
 * hole on the start's own strip / rail lands nowhere either, but says why
 * on the aimed hole (`to` null: 「d40 跟起點在同一排，本來就是通的」 — a red
 * route over a FREE hole would be a riddle otherwise). Pure; never throws.
 */
export function wireDrawLanding(from: string, to: string): { to: string | null; note: string | null } | null {
  try {
    const land = landingOf(useStore.getState().layout, from, to)
    if (land.kind === 'ok') return { to: land.to, note: null }
    if (land.kind === 'joined') return { to: null, note: joinedText(land, useStore.getState().layout) }
    if (land.kind === 'refuse') return null
    const p = { hole: land.hole, pin: land.pin, free: land.to }
    return {
      to: land.to,
      note: tidyCjkSpaces(
        land.rail ? t('{hole} is taken by {pin} → lands on {free} on the same rail', p) : t('{hole} is taken by {pin} → lands on {free} in the same row', p),
      ),
    }
  } catch {
    return { to, note: null }
  }
}

/**
 * The chip's words while a new wire whose start a part pin's press moved
 * aims at nothing yet: the wire mode's own 「c21 被 U1 PA4 佔用，已改從同一排
 * 的 a21 拉線」. Null when the start was not moved. Pure; never throws.
 */
export function wireDrawStartText(pressed: string, from: string): string | null {
  try {
    const layout = useStore.getState().layout
    const check = wireStartCheck(layout, pressed)
    return check.kind === 'redirect' && check.from === from ? wireStartHint(check, layout) : null
  } catch {
    return null
  }
}

/**
 * A finger's long-press armed a grip on `ref` (a new wire's pressed point,
 * or an end of wire `wireId`): the chip names the point and what comes next
 * — 「a24 · 放開：探測選單／拖曳：拉線」, 「a20（U1 PA5 這一排）· 放開：探測選單
 * ／拖曳：改接這一端」. Pure; never throws.
 */
export function wireGripText(ref: string, wireId: string | null): string | null {
  try {
    const point = endpointName(useStore.getState().layout, ref)
    return tidyCjkSpaces(
      wireId === null
        ? t('{point} · lift: probe menu / drag: draw a wire', { point })
        : t('{point} · lift: probe menu / drag: move this end', { point }),
    )
  } catch {
    return null
  }
}

/** localStorage flag of the one-time drag-to-wire tip. */
export const WIRE_DRAW_TIP_KEY = 'bb.tip.dragWire'

/** The tip was shown (or cannot be) in this page — no localStorage read per hover. */
let tipDone = false

/** Tests: forget the in-page memory of the one-time tip. */
export function __resetWireDrawTipForTests(): void {
  tipDone = false
}

/** Under a harness that must not show surprise toasts (?shotrig visual baselines). */
function harness(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).has('shotrig')
  } catch {
    return false
  }
}

/**
 * The mouse first rested where a press draws a new wire from a free hole
 * (the scene's crosshair just turned on): ONCE per browser (localStorage
 * WIRE_DRAW_TIP_KEY), a short tip — 「小提示：按住孔位拖到另一個孔位，就能拉線」.
 * Product chrome, a mouse (a fine pointer), never under ?shotrig, never
 * before the first-launch tour is done (it covers the board meanwhile).
 */
export function wireDrawHint(): void {
  if (tipDone) return
  try {
    if (isLegacyChrome() || coarsePointer() || harness()) return
    const ls = window.localStorage
    if (ls.getItem('bb.onboarded') == null) return // the tour is still up: next time
    tipDone = true
    if (ls.getItem(WIRE_DRAW_TIP_KEY) != null) return
    ls.setItem(WIRE_DRAW_TIP_KEY, '1')
  } catch {
    tipDone = true // no storage: once per page, then quiet
  }
  showToast(t('Tip: hold a hole and drag to another hole to draw a wire'), { duration: 4200 })
}

/** The zoom tip was shown in this page (wireDrawTooSmall: once per page). */
let smallDone = false

/** Tests: forget the in-page memory of the zoom tip. */
export function __resetWireDrawTooSmallForTests(): void {
  smallDone = false
}

/**
 * Persona fix: a mouse press in a hole that is too small on screen to draw
 * from (zoomed far out) turned into an orbit — say how to zoom in, once per
 * page: 「放大一點（滾輪，或按 F 對準電路）就能從孔位拉線」. Product chrome, a
 * mouse, never under ?shotrig.
 */
export function wireDrawTooSmall(): void {
  if (smallDone) return
  try {
    if (isLegacyChrome() || coarsePointer() || harness()) return
  } catch {
    return
  }
  smallDone = true
  showToast(t('Zoom in a little (scroll, or press F to frame the circuit) to draw wires from the holes'), { duration: 4200 })
}

/** 「a25（c25 被 R1 第 2 腳佔用，改接同一排）」: an end the redirect moved, with why. */
function movedEndName(free: string, hole: string, pin: string, rail: boolean, start: boolean): string {
  const p = { free, hole, pin }
  if (start) {
    return rail
      ? t('{free} ({hole} is taken by {pin}, so it starts on the same rail)', p)
      : t('{free} ({hole} is taken by {pin}, so it starts in the same row)', p)
  }
  return rail
    ? t('{free} ({hole} is taken by {pin}, so it lands on the same rail)', p)
    : t('{free} ({hole} is taken by {pin}, so it lands in the same row)', p)
}

/**
 * The refusal of a drop at `to` (landingOf said no): the toast + the refusal
 * sound. On the start's own strip / rail: 「這裡不能接：d40 跟起點在同一排，本來
 * 就是通的」 — a free hole and a part's leg alike (final round).
 */
function refuseDrop(land: Extract<WireLanding, { kind: 'refuse' | 'joined' }>, layout: CircuitLayout): void {
  const text =
    land.kind === 'joined'
      ? tidyCjkSpaces(t('Can’t wire here: {reason}', { reason: joinedText(land, layout) }))
      : land.full
        ? (wireStartHint({ kind: 'refuse', refusal: land.refusal, where: land.full }, layout) ?? wireRefusedHint(land.refusal, layout))
        : wireRefusedHint(land.refusal, layout)
  showWireRefusalToast(text)
  playMech('refuse')
}

/**
 * The drop: add the wire from → to in its role colour (one undo step) and
 * say so with 〔復原〕, or say why not (and sound it). `to` null (released
 * away from any hole or terminal, or back on the start) changes nothing and
 * says nothing. A part pin's hole as `to` lands on the free hole of its
 * strip (landingOf); `pressed` (the scene's) is the pin a moved start was
 * pressed on — both moves are named in the toast.
 */
export function drawWire(from: string, to: string | null, pressed?: string): void {
  if (to === null || isLegacyChrome()) return
  if (to === from || (normalizeHoleRef(to) ?? to) === (normalizeHoleRef(from) ?? from)) return // back on its start: a plain cancel, silent
  const st = useStore.getState()
  const land = landingOf(st.layout, from, to)
  if (land.kind === 'refuse' || land.kind === 'joined') {
    refuseDrop(land, st.layout)
    return
  }
  const end = land.to
  const before = st.layout.wires.length
  st.addWire(from, end, roleColorOfNewWire(st.layout, from, end))
  const after = useStore.getState().layout
  if (after.wires.length <= before) return
  tick() // wire complete (DESIGN.md §1 Haptics)
  editCue('wire') // the wire mode's own cue (product chrome, 音效 on)
  dismissWireRefusalToast() // the last refusal is answered
  undoableToast(connectedText(after, st.layout, from, land, pressed), after)
}

/**
 * 「已接上 a19 → a29」, naming the ends a redirect moved: 「已接上 a21（c21 被
 * U1 PA4 佔用，改從同一排接出）→ a25（c25 被 R1 第 2 腳佔用，改接同一排）」.
 * `prior` is the board the start was judged on (the pin still in its hole).
 */
function connectedText(after: CircuitLayout, prior: CircuitLayout, from: string, land: Extract<WireLanding, { kind: 'ok' | 'redirect' }>, pressed?: string): string {
  let a = endpointName(after, from)
  if (pressed !== undefined && pressed !== from) {
    const start = wireStartCheck(prior, pressed)
    if (start.kind === 'redirect' && start.from === from) a = movedEndName(from, start.hole, start.pin, start.rail, true)
  }
  const b = land.kind === 'redirect' ? movedEndName(land.to, land.hole, land.pin, land.rail, false) : endpointName(after, land.to)
  return tidyCjkSpaces(t('Connected {ends}', { ends: arrowJoin([a, b]) }))
}
