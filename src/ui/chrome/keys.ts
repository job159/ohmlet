/**
 * Global key routing (UX fix SH-9 — docs/ux/UX_VERIFY.md V-09): Space and
 * the debugger keys F5 / F10 / Shift+F5 mean the same thing wherever the
 * focus is — on the 3D view, after a click on a panel button, on a tray
 * tab, inside the lesson coach.
 *
 * App.tsx listens on `window` in the CAPTURE phase (like the tray's Shift+A),
 * so neither Workspace.guardKeys (which stops plain keys inside the panels)
 * nor a focused button sees these keys first. The decision is pure
 * (routeGlobalKey / debugKeyAction — tests/ux-shell-keys.test.ts); the DOM
 * facts it needs are read by describeKeyTarget().
 *
 * Space keeps its native meaning only where the user expects it:
 *   - typing in a field (input, textarea, select, contenteditable, textbox);
 *   - a control the KEYBOARD moved to (Tab / arrows): a button, a switch, a
 *     tab, a slider … — Space activates it, as everywhere on the web;
 *   - inside an open modal dialog (the shortcuts list, the onboarding);
 *   - inside an element that declares `data-own-keys="Space"`.
 * A control that only has focus because it was clicked keeps no claim on
 * Space: the key runs / pauses and the control loses its focus (so the
 * key-up cannot activate it a second time — 「重置 MCU」 then Space reset
 * twice, COH-03).
 *
 * Where the focus came from is tracked here (installFocusModality): the
 * browser's own :focus-visible is no help — Chromium turns a mouse-focused
 * button :focus-visible on the first key press, before any handler runs.
 *
 * F5 / F10 / Shift+F5 never type anything, so they act even in a text
 * field; only an open modal dialog or `data-own-keys` keeps them. With an
 * MCU in the circuit F5 never reloads the page (preventDefault). F6 /
 * Shift+F6 move the focus between the window's regions (SH-16 — rail,
 * library, 3D view, inspector, tray). The classic chrome (isLegacyChrome)
 * routes none of this: there F5 is the browser's reload and Space keeps
 * its pre-wave handler (SH-10).
 */

/** The DOM facts about a key event's target that the routing needs. */
export interface KeyTargetInfo {
  /** typing goes there: input (text-like), textarea, select, contenteditable, role=textbox / combobox / searchbox */
  textEntry: boolean
  /** an activatable control: button / link / summary / role=button, or an ARIA widget (slider, switch, tab …) */
  widget: boolean
  /** the target got its focus from the keyboard (Tab, arrows, a key that opened it) */
  keyboardFocused: boolean
  /** the target is inside an open aria-modal="true" dialog */
  inModal: boolean
  /** key names claimed by `data-own-keys` on the target or an ancestor ("Space F5") */
  ownKeys: readonly string[]
}

/** The app facts the routing needs. */
export interface KeyAppInfo {
  /** classic chrome (English without the workspace): nothing is routed here */
  legacy: boolean
  /** MCU boards in the circuit (the debugger keys need one) */
  mcuCount: number
  /** a blocking modal is open anywhere (shortcuts list, onboarding) — not a phone sheet */
  blockingModal: boolean
}

export interface KeyLike {
  key: string
  code?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export type DebugKey = 'F5' | 'F10' | 'Shift+F5'

export type KeyRoute =
  /** not ours: let the event go on (native behaviour, the bubble-phase shortcuts) */
  | { kind: 'pass' }
  /** run / pause (toggleRun); `blur` = drop the pointer focus of the target */
  | { kind: 'run'; blur: boolean }
  /** a debugger key; `blur` = drop the pointer focus of the target (no ring left on a clicked chip) */
  | { kind: 'debug'; key: DebugKey; blur: boolean }
  /** swallow it (preventDefault, no action): F5 under a modal must not reload the page */
  | { kind: 'swallow' }
  /** F6 / Shift+F6: move the focus to the next / previous region (SH-16) */
  | { kind: 'region'; back: boolean }

/** Space as KeyboardEvent.key / .code. */
export function isSpaceKey(e: KeyLike): boolean {
  return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'
}

/** The debugger key of `e` (no Ctrl / Cmd / Alt), else null. */
export function debugKeyOf(e: KeyLike): DebugKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'F5') return e.shiftKey ? 'Shift+F5' : 'F5'
  if (e.key === 'F10' && !e.shiftKey) return 'F10'
  return null
}

/** Does `ownKeys` claim this key? ('Space' also matches ' '; 'F5' matches Shift+F5 too) */
function owns(ownKeys: readonly string[], name: string): boolean {
  return ownKeys.includes(name)
}

/**
 * Where a keydown goes (pure). Space → run unless the target keeps it;
 * F5 / F10 / Shift+F5 → the debugger when there is an MCU (F5 swallowed
 * under a modal so it never reloads the page); everything else passes.
 */
export function routeGlobalKey(e: KeyLike, target: KeyTargetInfo, app: KeyAppInfo): KeyRoute {
  if (app.legacy) return { kind: 'pass' }
  if (isSpaceKey(e)) {
    if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'pass' }
    if (target.textEntry) return { kind: 'pass' }
    if (target.inModal || app.blockingModal) return { kind: 'pass' }
    if (owns(target.ownKeys, 'Space')) return { kind: 'pass' }
    if (target.widget && target.keyboardFocused) return { kind: 'pass' }
    return { kind: 'run', blur: target.widget }
  }
  if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // a modal keeps its own focus loop
    if (target.inModal || app.blockingModal) return { kind: 'pass' }
    return { kind: 'region', back: !!e.shiftKey }
  }
  const dk = debugKeyOf(e)
  if (dk) {
    if (app.mcuCount === 0) return { kind: 'pass' } // no MCU: the browser keeps F5
    if (target.inModal || app.blockingModal || owns(target.ownKeys, dk) || owns(target.ownKeys, e.key)) {
      return e.key === 'F5' ? { kind: 'swallow' } : { kind: 'pass' }
    }
    return { kind: 'debug', key: dk, blur: target.widget && !target.keyboardFocused }
  }
  return { kind: 'pass' }
}

// ---------------------------------------------------------------------------
// debugger key → action
// ---------------------------------------------------------------------------

/** The run state a debugger key acts on. */
export interface DebugState {
  /** store.running */
  running: boolean
  /** the simulation has run (simTime > 0) */
  started: boolean
  /** boards the debugger has halted */
  halted: readonly string[]
  /** the board a key acts on (targetMcuId): the selected or only board; null = ambiguous */
  target: string | null
}

export type DebugAction =
  /** resume every halted core and run (runOrResume) */
  | { kind: 'resume' }
  | { kind: 'halt'; id: string }
  | { kind: 'step'; id: string }
  /** paused (not halted): halt the core where the pause left it, then step it */
  | { kind: 'halt-step'; id: string }
  | { kind: 'reset'; id: string }
  /** say why nothing happens (English source for t()) */
  | { kind: 'explain'; text: 'select-reset' | 'select-halt' | 'select-step' | 'halt-first' | 'start-first' }

/**
 * What a debugger key does in a state (pure):
 *   Shift+F5  reset the target board
 *   F5        halted or stopped → resume / run; running → halt the target
 *   F10       halted → step (the target if it is halted, else the first
 *             halted board); paused → halt + step; running → 「先按 F5」;
 *             nothing has run yet → 「先執行」
 */
export function debugKeyAction(key: DebugKey, s: DebugState): DebugAction {
  if (key === 'Shift+F5') return s.target ? { kind: 'reset', id: s.target } : { kind: 'explain', text: 'select-reset' }
  if (key === 'F5') {
    if (s.halted.length > 0 || !s.running) return { kind: 'resume' }
    return s.target ? { kind: 'halt', id: s.target } : { kind: 'explain', text: 'select-halt' }
  }
  // F10
  if (s.halted.length > 0) return { kind: 'step', id: s.target && s.halted.includes(s.target) ? s.target : s.halted[0] }
  if (s.running) return { kind: 'explain', text: 'halt-first' }
  if (!s.started) return { kind: 'explain', text: 'start-first' }
  return s.target ? { kind: 'halt-step', id: s.target } : { kind: 'explain', text: 'select-step' }
}

// ---------------------------------------------------------------------------
// DOM side
// ---------------------------------------------------------------------------

/** ARIA roles whose keyboard focus owns Space (the WAI-ARIA widget roles). */
const WIDGET_ROLES = new Set([
  'button',
  'link',
  'slider',
  'spinbutton',
  'switch',
  'checkbox',
  'radio',
  'tab',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'gridcell',
])
const TEXT_ROLES = new Set(['textbox', 'combobox', 'searchbox'])
/** <input> types that are controls, not text entry */
const CONTROL_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])

let lastInputWasKeyboard = false
let keyboardFocusedEl: Element | null = null
let lastPointerEl: Element | null = null
let lastPointerAt = Number.NEGATIVE_INFINITY
let modalityInstalled = 0
let uninstallModality: (() => void) | null = null

/**
 * Track whether focus arrives by keyboard or pointer (reference-counted;
 * App.tsx installs it once). Any key press counts as keyboard input, any
 * pointerdown as pointer input; a focus change records which came last.
 */
export function installFocusModality(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  modalityInstalled++
  if (modalityInstalled === 1) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      lastInputWasKeyboard = true
    }
    const onPointer = (e: PointerEvent) => {
      lastInputWasKeyboard = false
      lastPointerEl = e.target instanceof Element ? e.target : null
      lastPointerAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    }
    const onFocusIn = (e: FocusEvent) => {
      keyboardFocusedEl = lastInputWasKeyboard && e.target instanceof Element ? e.target : null
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('focusin', onFocusIn, true)
    uninstallModality = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('focusin', onFocusIn, true)
    }
  }
  let done = false
  return () => {
    if (done) return
    done = true
    modalityInstalled--
    if (modalityInstalled === 0) {
      uninstallModality?.()
      uninstallModality = null
      keyboardFocusedEl = null
      lastInputWasKeyboard = false
      lastPointerEl = null
    }
  }
}

/**
 * Did the latest user action happen inside `selector`? The last pointerdown
 * within `withinMs`, or (keyboard) the focused element — e.g. the lesson
 * coach's 「拿一顆電阻」 armed the placement mode (SH-12 / TR-19).
 */
export function lastActionInside(selector: string, withinMs = 1500): boolean {
  if (typeof document === 'undefined') return false
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (!lastInputWasKeyboard && lastPointerEl && now - lastPointerAt <= withinMs) return lastPointerEl.closest(selector) != null
  const active = document.activeElement
  return lastInputWasKeyboard && active instanceof Element && active.closest(selector) != null
}

/** Did `el` (or the element it sits in) get its focus from the keyboard? */
export function focusedByKeyboard(el: Element | null): boolean {
  return el != null && keyboardFocusedEl != null && (el === keyboardFocusedEl || keyboardFocusedEl.contains(el))
}

function isTextEntry(el: Element): boolean {
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !CONTROL_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase())
  if ((el as HTMLElement).isContentEditable) return true
  const role = el.getAttribute('role')
  return role != null && TEXT_ROLES.has(role)
}

function isWidget(el: Element): boolean {
  const tag = el.tagName
  if (tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'A' && el.hasAttribute('href'))) return true
  if (tag === 'INPUT') return true // a control input (text inputs are caught first)
  const role = el.getAttribute('role')
  return role != null && WIDGET_ROLES.has(role)
}

/** The routing facts of a key event target (DOM reads only; cheap). */
export function describeKeyTarget(target: EventTarget | null): KeyTargetInfo {
  const el = target instanceof Element ? target : null
  if (!el || el === document.body || el === document.documentElement) {
    return { textEntry: false, widget: false, keyboardFocused: false, inModal: false, ownKeys: [] }
  }
  // the control the key lands on: the target itself or its nearest widget ancestor
  const widgetEl = isWidget(el) ? el : el.closest('button, summary, a[href], [role]')
  const widget = widgetEl != null && isWidget(widgetEl)
  const own = el.closest('[data-own-keys]')?.getAttribute('data-own-keys') ?? ''
  return {
    textEntry: isTextEntry(el),
    widget,
    keyboardFocused: focusedByKeyboard(widget ? widgetEl : el),
    inModal: el.closest('[aria-modal="true"]') != null,
    ownKeys: own.split(/\s+/).filter(Boolean),
  }
}

/**
 * A blocking modal is open: an aria-modal dialog that is not a kit phone
 * sheet (those rest over the scene without blocking it — the canvas and
 * the run keys stay usable at the low detents).
 */
export function blockingModalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[aria-modal="true"]:not(.lg-sheet)') != null
}

// ---------------------------------------------------------------------------
// F6: the regions of the window (SH-16 — N17)
// ---------------------------------------------------------------------------

/**
 * The focus regions in F6 order: the dock / rail, the library panel, the
 * 3D view, the inspector, the instrument tray (the ones on screen).
 */
export const FOCUS_REGIONS: readonly string[] = ['.lg-dock', '.ws-left', '.app-canvas', '.ws-right', '.ws-tray']

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Is `el` laid out and visible (a collapsed panel is not a region)? */
function shown(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0
}

/** Move the focus to the next (Shift: previous) region; returns the region focused. */
export function cycleFocusRegion(back: boolean): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const regions = FOCUS_REGIONS.map((sel) => document.querySelector<HTMLElement>(sel)).filter(
    (el): el is HTMLElement => el != null && shown(el),
  )
  if (regions.length === 0) return null
  const active = document.activeElement
  const at = regions.findIndex((r) => active != null && (r === active || r.contains(active)))
  const n = regions.length
  const region = regions[at < 0 ? (back ? n - 1 : 0) : (at + (back ? n - 1 : 1)) % n]
  // the dock: its current tab; a panel: its first control; the 3D view itself
  const into =
    region.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
    (region.classList.contains('app-canvas') ? null : region.querySelector<HTMLElement>(FOCUSABLE))
  const el = into ?? region
  if (el === region && el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
  return region
}

/** Drop the focus of a pointer-focused control (Space then cannot activate it on key-up). */
export function releasePointerFocus(target: EventTarget | null): void {
  const el = target instanceof HTMLElement ? target : null
  if (!el || typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body && (active === el || active.contains(el) || el.contains(active))) {
    active.blur()
  }
}
