/**
 * Pointer-click focus policy (UX fix SH-9): after a mouse / touch click a
 * kit control (PressableButton, Segmented, ListRow) drops its focus, so the
 * next Space runs / pauses the simulation instead of pressing the control
 * again, and no focus ring lingers on it — StatusPill's releaseFocus,
 * shared. A keyboard activation (click.detail === 0) keeps the focus.
 *
 * Only a plain button or toggle drops it. A control whose own keyboard
 * semantics use the keys a learner presses next — a radio group or tab list
 * (arrows pick the neighbour), a slider / number field (arrows step it), a
 * select or text field (typing) — KEEPS the focus after a click: ArrowLeft
 * right after clicking 「十六進位」 picks 「文字」 instead of nudging the
 * selected Blue Pill on the board, and a Delete stays in that panel instead
 * of deleting the part (keyboard isolation, ui-shots). Space still runs /
 * pauses there: keys.ts routes the Space of a POINTER-focused control to
 * run and drops its focus then (routeGlobalKey { kind: 'run', blur: true }).
 *
 * While it keeps the focus, its plain keys stay with it everywhere: the
 * desktop workspace panels already stop them (Workspace guardKeys), and a
 * phone sheet / the narrow-desktop properties panel get the same guard
 * here — a document-level bubble listener (after React's own handlers, so
 * the control still reads the key) stops a plain key aimed at it from
 * reaching the window-level board shortcuts (arrow nudge, Delete, R, C …),
 * so one ArrowLeft never both flips a switch's 「a／b」 and nudges the part.
 * Escape, Tab and Ctrl / ⌘ / Alt keys pass, like guardKeys. The guard ends
 * when the control loses its focus to the page (a click on the board blurs
 * it) — not when the whole window does (Alt+Tab: the control still has the
 * page's focus when the learner comes back) — or when it leaves the page.
 * A phone sheet is no modal for the run keys (keys.ts BLOCKING_MODAL), so a
 * segment clicked in the 儀器 / 屬性 sheet still lets Space / F5 / F10 act.
 *
 * Off by default: the host turns it on (App.tsx: the new chrome only — the
 * classic chrome keeps its pre-wave focus behaviour, SH-10).
 */
import type { MouseEvent as ReactMouseEvent } from 'react'

let releaseEnabled: () => boolean = () => false

/** Host switch: when should a pointer click release the control's focus? */
export function setPointerFocusRelease(enabled: () => boolean): void {
  releaseEnabled = enabled
}

/** The DOM facts of a clicked control that decide whether it keeps its focus. */
export interface FocusKeepFacts {
  /** tagName (any case) */
  tag: string
  /** an <input>'s type attribute */
  type?: string | null
  /** the role attribute */
  role?: string | null
  /** contenteditable */
  editable?: boolean
}

/** ARIA roles whose keyboard semantics use the arrows / typing (WAI-ARIA authoring practices). */
const KEEP_ROLES = new Set([
  'radio',
  'tab',
  'slider',
  'spinbutton',
  'option',
  'menuitemradio',
  'textbox',
  'searchbox',
  'combobox',
])
/** <input> types that are plain buttons / toggles (Space / Enter only): released like a button */
const RELEASE_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'image', 'file', 'color'])

/**
 * Does a pointer-clicked control keep its focus (pure)? Yes when its own
 * keyboard semantics use the arrows or typing — radio, tab, slider,
 * spinbutton, option, a text-like / range / number / radio input, select,
 * textarea, contenteditable; no for a plain button, link, switch, checkbox.
 */
export function keepsFocusAfterPointerClick(f: FocusKeepFacts): boolean {
  if (f.editable) return true
  const tag = f.tag.toUpperCase()
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return !RELEASE_INPUTS.has((f.type || 'text').toLowerCase())
  return f.role != null && KEEP_ROLES.has(f.role)
}

/** The facts of `el` (DOM reads only). */
function factsOf(el: HTMLElement): FocusKeepFacts {
  return {
    tag: el.tagName,
    type: el.tagName.toUpperCase() === 'INPUT' ? el.getAttribute('type') : null,
    role: el.getAttribute('role'),
    editable: el.isContentEditable === true,
  }
}

/** Is `e` a plain key a focused control keeps (Workspace guardKeys' rule)? */
export function isPlainControlKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return e.key !== 'Escape' && e.key !== 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey
}

/** The one live key guard (one focused control at a time): its teardown. */
let endKeyGuard: (() => void) | null = null

/** Composite widgets whose arrows move the focus inside them: the guard covers the whole group. */
const GROUP_SELECTOR = '[role="radiogroup"], [role="tablist"], [role="listbox"], [role="menu"]'

/**
 * Keep the plain keys aimed at `el` (or its radio group / tab list) from the
 * window-level shortcuts until the focus leaves it.
 */
function guardPlainKeys(el: HTMLElement): void {
  endKeyGuard?.()
  const scope: HTMLElement = (typeof el.closest === 'function' ? el.closest<HTMLElement>(GROUP_SELECTOR) : null) ?? el
  const inside = (n: EventTarget | null) => n != null && (n === scope || scope.contains(n as Node))
  const onKey = (ev: KeyboardEvent) => {
    if (scope.isConnected === false) return end() // its sheet / panel closed under it
    if (inside(ev.target) && isPlainControlKey(ev)) ev.stopPropagation()
  }
  const onFocusOut = (ev: FocusEvent) => {
    if (inside(ev.relatedTarget)) return // focus moved within the group (arrow keys): keep guarding
    if (ev.relatedTarget != null) return end() // to another control
    // to nowhere: the page (a click on the board) or the WINDOW (Alt+Tab, another
    // app) — then the control keeps the page's focus and gets it back on return,
    // so look once the focus has settled
    setTimeout(() => {
      if (!inside(document.activeElement)) end()
    }, 0)
  }
  const end = () => {
    document.removeEventListener('keydown', onKey)
    scope.removeEventListener('focusout', onFocusOut)
    if (endKeyGuard === end) endKeyGuard = null
  }
  document.addEventListener('keydown', onKey)
  scope.addEventListener('focusout', onFocusOut)
  endKeyGuard = end
}

/** Call at the end of a control's click handler. */
export function releaseAfterPointerClick(e: ReactMouseEvent<HTMLElement>): void {
  if (e.detail <= 0 || typeof document === 'undefined') return
  const el = e.currentTarget
  if (document.activeElement !== el || !releaseEnabled()) return
  // a radio / tab / slider keeps it: the next arrow operates THIS control, not the board
  if (keepsFocusAfterPointerClick(factsOf(el))) {
    guardPlainKeys(el)
    return
  }
  el.blur()
}
