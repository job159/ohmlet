/**
 * Part keys (round 5 — 「還要有快捷鍵 像 r 電阻 c 電容 p 電供 l 是 led」):
 * one letter picks up a 「常用元件」 for placement, exactly as a click on its
 * library card does (owner: chrome).
 *
 *   R 電阻 · C 電容 · L LED · P 電源供應器 · B 按鈕 · V 可變電阻 ·
 *   D 二極體 · Q NPN 電晶體 · U Blue Pill · M 萬用電表
 *
 * The letters follow the designator the app gives the part (store.ts
 * ID_PREFIX: R1, C1, LED1, PS1, RV1, D1, Q1, U1, DMM1), so they teach the
 * convention — the pushbutton (SW1) is B for 按鈕 / Button, the user's pick.
 * THE map is PART_KEYS (every COMMON_PARTS entry has one — the library
 * keycaps, the shortcuts sheet's 「放置元件」, the key handler and the tests
 * read it here).
 *
 * Behaviour (product chrome only; the classic chrome has no part keys and
 * its R still rotates):
 *   - a plain letter (no Ctrl / ⌘ / Alt / Shift) arms the part — the card's
 *     own path: a tick, store.setMode place (an off-board supply / meter is
 *     placed beside the board at once), its 「放置中」 card, its hint toast;
 *   - the same letter while that part is armed stops placing (the armed
 *     card's second click); another letter switches part; select mode (with
 *     or without a selection) and wire mode arm it too, like a card click;
 *   - a held key acts once (auto-repeat is swallowed); a part that cannot be
 *     placed (missing / in development) does nothing;
 *   - typing in a field, an open dialog (the shortcuts list, the
 *     onboarding — not a library sheet), selected text, and a focused
 *     control or surface that reads letters itself (a list's type-ahead,
 *     an instrument plot's A / B markers, a terminal) keep the key.
 * The listener is on `window` in the CAPTURE phase (installPartKeys): a
 * library card keeps the focus after a click and the workspace panels stop
 * plain keys from bubbling (Workspace guardKeys), so 「點電阻卡片，再按 L」
 * would otherwise do nothing; it also runs before FlowToggle's own key
 * listener, which stands aside for a taken key (defaultPrevented).
 *
 * Because R now picks up a resistor and C a capacitor, the product chrome
 * rotates with Shift+R (isRotateKey — R in the classic chrome, as before)
 * and shows the current with Shift+C (isFlowKey). Shift+R while PLACING is
 * taken here too (any focus but a field / a dialog — a part just armed from
 * its card turns at once); a selected placed part turns in App.tsx's 3D-view
 * handler, which stands aside for a key taken here (defaultPrevented).
 *
 * The ghost appears under the mouse at once: the store keeps the hole the
 * mouse rests on in every mode, so arming draws the ghost there (App.tsx
 * syncOverlays). Where the scene has reported no hole (the mouse came to
 * rest while a hover pass could not run — an orbit, a drag), a key that arms
 * a part with the mouse on the 3D view replays that mouse position to the
 * canvas once (nudgeHover) instead of waiting for the next move.
 *
 * partKeyAction / isRotateKey / isFlowKey are pure (tests/part-hotkeys.test.ts);
 * describePartKeyTarget reads the DOM; installPartKeys wires it (App.tsx).
 */
import { getEntry, supportOf, type CatalogEntry } from '../../model/catalog'
import type { InteractionMode } from '../../state/types'
import { useStore } from '../../state/store'
import { t } from '../../i18n'
import { partLabel } from '../../i18n/parts'
import { tick } from '../kit'
import { COMMON_PARTS } from '../workspace/library-order'
import { editCue } from './edit-feedback'
import { describeKeyTarget, type KeyLike } from './keys'

/** The letter of each 「常用元件」 (its designator's letter — store.ts ID_PREFIX). */
export const PART_KEYS: Readonly<Record<string, string>> = {
  resistor: 'R', // R1
  led: 'L', // LED1
  pushbutton: 'B', // SW1 — B for 按鈕 / Button
  capacitor: 'C', // C1
  power_supply: 'P', // PS1
  potentiometer: 'V', // RV1 (a variable resistor)
  stm32_bluepill: 'U', // U1
  npn: 'Q', // Q1
  diode: 'D', // D1
  multimeter: 'M', // DMM1
}

/** Can `type` be placed from the library (a catalog entry that is not in development)? */
export function partPlaceable(type: string): boolean {
  const entry = getEntry(type)
  return !!entry && supportOf(entry).level !== 'dev'
}

/** The letter that picks up `type` ('R' for 'resistor'), or null (no key, or the part cannot be placed). */
export function partKeyOf(type: string): string | null {
  const key = PART_KEYS[type]
  return key && partPlaceable(type) ? key : null
}

/** The part a letter picks up ('R' → 'resistor'; any case), or null. */
export function partTypeOfKey(letter: string): string | null {
  const up = letter.toUpperCase()
  for (const [type, key] of Object.entries(PART_KEYS)) if (key === up) return type
  return null
}

/** One row of the shortcuts sheet's 「放置元件」: the letter and the part (COMMON_PARTS order). */
export interface PartKeyRow {
  key: string
  type: string
  entry: CatalogEntry
}

/** The part keys in 「常用元件」 order — the parts that can be placed. */
export function partKeyRows(): PartKeyRow[] {
  const rows: PartKeyRow[] = []
  for (const type of COMMON_PARTS) {
    const key = partKeyOf(type)
    const entry = getEntry(type)
    if (key && entry) rows.push({ key, type, entry })
  }
  return rows
}

/** A library card's tooltip: 「電阻（快捷鍵 R）」 (null: the part has no key). */
export function partKeyTitle(entry: CatalogEntry): string | null {
  const key = partKeyOf(entry.type)
  return key ? t('{part} (shortcut {key})', { part: partLabel(entry), key }) : null
}

// ---------------------------------------------------------------------------
// the decision (pure)
// ---------------------------------------------------------------------------

/** A keydown as the decision reads it. */
export interface PartKeyEvent extends KeyLike {
  repeat?: boolean
  isComposing?: boolean
}

/** Where the key landed (describePartKeyTarget reads it from the DOM). */
export interface PartKeyTarget {
  /** typing goes there (input, textarea, select, contenteditable, textbox / combobox / searchbox) */
  textEntry: boolean
  /** a dialog is open that owns the keys (the shortcuts list, the onboarding, a confirm) — not a library sheet */
  inDialog: boolean
  /** the focused control or surface reads this letter itself (type-ahead list, plot markers, terminal, data-own-keys) */
  ownsKey: boolean
}

export interface PartKeyContext {
  /** classic chrome (English without the workspace): no part keys */
  legacy: boolean
  /** text is selected on the page (copy-paste.ts textSelectionActive) */
  textSelected: boolean
  /** the current interaction mode */
  mode: InteractionMode
  /** a pointer button is down (a drag-to-wire, a part move, an orbit): a card click cannot happen mid-drag, so a letter does nothing */
  pointerHeld?: boolean
  /** can this part be placed (default partPlaceable) */
  placeable?: (type: string) => boolean
}

export type PartKeyAction =
  /** not a part key here: the key goes on (the browser, the other handlers) */
  | { kind: 'pass' }
  /** a part key that does nothing now (held down, a part that cannot be placed): taken, no action */
  | { kind: 'swallow' }
  /** pick the part up (store.setMode place) — or switch to it */
  | { kind: 'arm'; type: string }
  /** the armed part's own letter: stop placing */
  | { kind: 'stop'; type: string }
  /** Shift+R while placing: turn the armed package's ghost (store.rotateArmed — the R of old) */
  | { kind: 'rotate' }

const PASS: PartKeyAction = { kind: 'pass' }

/** The letter a key event types ('R'; uppercase), or null. A non-Latin layout falls back to the physical key. */
export function letterOf(e: KeyLike): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase()
  // a non-Latin keyboard layout: the key's printed letter is the physical one
  if (e.key.length === 1 && !/[\x20-\x7e]/.test(e.key) && e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  return null
}

/** What a keydown does as a part key (pure). */
export function partKeyAction(e: PartKeyEvent, target: PartKeyTarget, ctx: PartKeyContext): PartKeyAction {
  if (ctx.legacy) return PASS
  // Shift+R while placing turns the ghost wherever the focus is, like the part
  // keys that armed it (a card just clicked keeps the focus); rotating a
  // placed part stays with the 3D view's keys (App.tsx). Held: it keeps turning, as R did.
  if (ctx.mode.kind === 'place' && isRotateKey(e, false)) {
    return target.textEntry || target.inDialog || target.ownsKey ? PASS : { kind: 'rotate' }
  }
  // Ctrl / ⌘ + letter keep their meaning (Ctrl+C copy, Ctrl+R reload…); Shift+R rotates, Shift+C shows the current
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return PASS
  if (e.isComposing) return PASS
  const letter = letterOf(e)
  const type = letter ? partTypeOfKey(letter) : null
  if (!type) return PASS
  if (target.textEntry || target.inDialog || target.ownsKey || ctx.textSelected) return PASS
  if (e.repeat) return { kind: 'swallow' } // held: it acted on its first press
  if (ctx.pointerHeld) return { kind: 'swallow' } // mid-drag: never drop the wire being drawn
  if (!(ctx.placeable ?? partPlaceable)(type)) return { kind: 'swallow' }
  if (ctx.mode.kind === 'place' && ctx.mode.type === type) return { kind: 'stop', type }
  return { kind: 'arm', type }
}

/**
 * The rotate key: Shift+R in the product chrome (R picks up a resistor
 * there), R (Shift or not) in the classic chrome — exactly as before.
 */
export function isRotateKey(e: KeyLike, legacy: boolean): boolean {
  if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return false
  return legacy || !!e.shiftKey
}

/** Shift+C: 顯示電流 on / off (product chrome — C picks up a capacitor). */
export function isFlowKey(e: KeyLike, legacy: boolean): boolean {
  return !legacy && e.key.toLowerCase() === 'c' && !!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
}

// ---------------------------------------------------------------------------
// DOM side
// ---------------------------------------------------------------------------

/** Roles whose keyboard focus reads letters (type-ahead). */
const TYPEAHEAD_ROLES = new Set(['listbox', 'option', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tree', 'treeitem', 'grid', 'gridcell', 'treegrid', 'application'])
/** Controls a letter means nothing to (buttons, toggles, tabs, sliders, handles). */
const CONTROL_ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'slider', 'spinbutton', 'separator', 'scrollbar'])
const CONTROL_TAGS = new Set(['BUTTON', 'A', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA'])

/** A dialog that owns the keys is open: an aria-modal that is not a kit sheet (the library sheet is one). */
function dialogOpen(el: Element | null): boolean {
  if (typeof document === 'undefined') return false
  if (document.querySelector('[aria-modal="true"]:not(.lg-sheet)') != null) return true
  return el?.closest('[aria-modal="true"]:not(.lg-sheet)') != null
}

/** Does the focused element read `letter` itself? */
function ownsLetter(el: Element, letter: string | null): boolean {
  const own = el.closest('[data-own-keys]')?.getAttribute('data-own-keys') ?? ''
  if (letter && own.split(/\s+/).some((k) => k.toUpperCase() === letter)) return true
  const role = el.getAttribute('role')
  if (role && TYPEAHEAD_ROLES.has(role)) return true
  if (el.closest('[role="listbox"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="treegrid"]')) return true
  // a focusable surface that is not a control — an instrument plot (its A / B
  // markers), the scope screen, a terminal or log: it reads its own keys
  const control = CONTROL_TAGS.has(el.tagName) || (role != null && CONTROL_ROLES.has(role))
  const tabindex = el.getAttribute('tabindex')
  return !control && tabindex != null && Number(tabindex) >= 0 && !el.closest('.app-canvas')
}

/** The part-key facts of a key event's target (DOM reads only). */
export function describePartKeyTarget(target: EventTarget | null, letter: string | null): PartKeyTarget {
  const info = describeKeyTarget(target)
  const el = typeof Element !== 'undefined' && target instanceof Element ? target : null
  const page = el == null || (typeof document !== 'undefined' && (el === document.body || el === document.documentElement))
  return {
    textEntry: info.textEntry,
    inDialog: dialogOpen(el),
    ownsKey: !page && el != null && ownsLetter(el, letter),
  }
}

/** The last mouse position over the page, and whether it was over the 3D view's canvas. */
let lastMouse: { x: number; y: number } | null = null

/** The 3D view's canvas (the scene's renderer). */
function sceneCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null
  const c = document.querySelector('.app-canvas canvas')
  return c instanceof HTMLCanvasElement ? c : null
}

/**
 * Replay the resting mouse to the 3D view when the store has no hovered
 * hole: a part armed by a key would otherwise show its ghost only at the
 * next mouse move. One synthetic pointermove at the same spot = one hover
 * pass of the scene (the ghost lands under the pointer at once).
 */
export function nudgeHover(): void {
  const canvas = sceneCanvas()
  if (!canvas || !lastMouse || typeof PointerEvent === 'undefined') return
  if (document.elementFromPoint(lastMouse.x, lastMouse.y) !== canvas) return
  canvas.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: lastMouse.x,
      clientY: lastMouse.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  )
}

/** Run a part key's action — the library card's own path (LibraryPanel arm / PartsSheet onCard). */
export function runPartKey(action: PartKeyAction): void {
  if (action.kind === 'rotate') {
    useStore.getState().rotateArmed() // the rotate button's / old R's action (its click: mech-watch)
    return
  }
  if (action.kind !== 'arm' && action.kind !== 'stop') return
  const st = useStore.getState()
  tick()
  if (action.kind === 'stop') {
    st.setMode({ kind: 'select' })
    return
  }
  // an off-board part (supply, meter…) is placed by arming it: that is its placement commit
  const before = st.layout.components.length
  st.setMode({ kind: 'place', type: action.type, pickedHoles: [] })
  if (useStore.getState().layout.components.length > before) editCue('place')
  else if (useStore.getState().hoverHole === null) nudgeHover()
}

/** The app facts the key handler reads on each key. */
export interface PartKeyHost {
  legacy: () => boolean
  textSelected: () => boolean
}

/**
 * Listen for the part keys (App.tsx, once): window CAPTURE phase; a key it
 * acts on (or swallows) is taken (preventDefault) — the bubbling handlers,
 * FlowToggle's included, see defaultPrevented.
 */
export function installPartKeys(host: PartKeyHost): () => void {
  if (typeof window === 'undefined') return () => {}
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.isTrusted) lastMouse = { x: e.clientX, y: e.clientY }
  }
  // pointers held down right now (a drag in progress — partKeyAction's pointerHeld)
  const held = new Set<number>()
  const onDown = (e: PointerEvent) => void held.add(e.pointerId)
  const onUp = (e: PointerEvent) => void held.delete(e.pointerId)
  const onBlur = () => held.clear()
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const action = partKeyAction(e, describePartKeyTarget(e.target, letterOf(e)), {
      legacy: host.legacy(),
      textSelected: host.textSelected(),
      mode: useStore.getState().mode,
      pointerHeld: held.size > 0,
    })
    if (action.kind === 'pass') return
    e.preventDefault()
    runPartKey(action)
  }
  window.addEventListener('pointermove', onMove, { capture: true, passive: true })
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true })
  window.addEventListener('pointerup', onUp, { capture: true, passive: true })
  window.addEventListener('pointercancel', onUp, { capture: true, passive: true })
  window.addEventListener('blur', onBlur)
  window.addEventListener('keydown', onKey, true)
  return () => {
    window.removeEventListener('pointermove', onMove, { capture: true })
    window.removeEventListener('pointerdown', onDown, { capture: true })
    window.removeEventListener('pointerup', onUp, { capture: true })
    window.removeEventListener('pointercancel', onUp, { capture: true })
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('keydown', onKey, true)
  }
}
