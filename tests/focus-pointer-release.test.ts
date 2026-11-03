/**
 * SH-9 pointer-click focus policy (src/ui/kit/focus.ts) — keyboard isolation.
 *
 * A pointer click drops the focus of a plain button / toggle (the next
 * Space runs / pauses, no ring lingers), but a control whose own keyboard
 * semantics use the next keys KEEPS it: after clicking the UART terminal's
 * 「十六進位」 (a Segmented radio) ArrowLeft picks 「文字」 and Delete stays
 * in the panel — before, the focus fell to <body>, so ArrowLeft nudged the
 * selected Blue Pill and Delete deleted it (scripts/ui-shots.mjs
 * 「keyboard isolation LEAK」). Space keeps SH-9's promise through keys.ts:
 * a pointer-focused control's Space runs and drops the focus then.
 * Outside the desktop workspace (a phone sheet, the narrow-desktop
 * properties panel — no Workspace guardKeys there) the kept control's plain
 * keys are stopped at the document, so one ArrowLeft never both flips a
 * slide switch's 「a／b」 and nudges the part; the guard ends with the focus.
 *
 * No DOM in the suite: the element and `document` are minimal stubs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPlainControlKey, keepsFocusAfterPointerClick, releaseAfterPointerClick, setPointerFocusRelease } from '../src/ui/kit/focus'
import { routeGlobalKey, type KeyTargetInfo } from '../src/ui/chrome/keys'

type Listener = (ev: never) => void

/** A minimal event target: listeners by type. */
class FakeTarget {
  listeners = new Map<string, Set<Listener>>()
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }
  fire(type: string, ev: object) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev as never)
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

class FakeEl extends FakeTarget {
  parent: FakeEl | null = null
  isContentEditable = false
  blur = vi.fn()
  constructor(
    public tagName: string,
    public attrs: Record<string, string> = {},
  ) {
    super()
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null
  }
  contains(n: unknown): boolean {
    for (let c = n as FakeEl | null; c; c = c.parent) if (c === this) return true
    return false
  }
  /** enough of closest() for the role selectors focus.ts asks */
  closest(sel: string): FakeEl | null {
    const roles = [...sel.matchAll(/role="([\w-]+)"/g)].map((m) => m[1])
    for (let c: FakeEl | null = this; c; c = c.parent) if (roles.includes(c.attrs.role)) return c
    return null
  }
}

function el(tagName: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl {
  const e = new FakeEl(tagName, attrs)
  e.parent = parent
  return e
}

let doc = new FakeTarget()

/** A click on `target` (focused) — detail 1 = pointer, 0 = keyboard activation. */
function click(target: FakeEl, detail = 1): void {
  doc = Object.assign(doc, { activeElement: target })
  vi.stubGlobal('document', doc)
  releaseAfterPointerClick({ detail, currentTarget: target } as never)
}

/** A keydown reaching the document (bubble phase) — did something stop it from going on to window? */
function keyAtDocument(target: FakeEl | null, key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}): boolean {
  const ev = { key, target, ...mods, stopPropagation: vi.fn() }
  doc.fire('keydown', ev)
  return ev.stopPropagation.mock.calls.length > 0
}

afterEach(() => {
  vi.unstubAllGlobals()
  setPointerFocusRelease(() => false)
  doc = new FakeTarget()
})

describe('pointer click: which controls keep their focus (pure)', () => {
  it('radio groups, tab lists, sliders, number / text fields, selects keep it — their keys operate THEM', () => {
    for (const role of ['radio', 'tab', 'slider', 'spinbutton', 'option', 'menuitemradio', 'textbox', 'combobox', 'searchbox']) {
      expect(keepsFocusAfterPointerClick({ tag: 'button', role }), role).toBe(true)
    }
    for (const type of ['range', 'number', 'text', 'radio', 'search', null]) {
      expect(keepsFocusAfterPointerClick({ tag: 'INPUT', type }), String(type)).toBe(true)
    }
    expect(keepsFocusAfterPointerClick({ tag: 'SELECT' })).toBe(true)
    expect(keepsFocusAfterPointerClick({ tag: 'TEXTAREA' })).toBe(true)
    expect(keepsFocusAfterPointerClick({ tag: 'DIV', editable: true })).toBe(true)
  })

  it('plain buttons and toggles drop it (Space / Enter only — SH-9 as before)', () => {
    expect(keepsFocusAfterPointerClick({ tag: 'BUTTON' })).toBe(false)
    expect(keepsFocusAfterPointerClick({ tag: 'BUTTON', role: 'switch' })).toBe(false)
    expect(keepsFocusAfterPointerClick({ tag: 'BUTTON', role: 'checkbox' })).toBe(false)
    expect(keepsFocusAfterPointerClick({ tag: 'A', role: 'link' })).toBe(false)
    expect(keepsFocusAfterPointerClick({ tag: 'BUTTON', role: 'menuitem' })).toBe(false)
    for (const type of ['button', 'submit', 'reset', 'checkbox', 'file', 'color']) {
      expect(keepsFocusAfterPointerClick({ tag: 'INPUT', type }), type).toBe(false)
    }
  })
})

describe('releaseAfterPointerClick (the kit controls’ click handlers)', () => {
  it('a clicked Segmented radio (「十六進位」) keeps the focus: the next ArrowLeft / Delete stay with it', () => {
    setPointerFocusRelease(() => true)
    const radio = el('BUTTON', { role: 'radio', 'aria-checked': 'true' })
    click(radio)
    expect(radio.blur).not.toHaveBeenCalled()
    const tab = el('BUTTON', { role: 'tab' })
    click(tab)
    expect(tab.blur).not.toHaveBeenCalled()
  })

  it('a clicked plain button / switch still drops it (new chrome)', () => {
    setPointerFocusRelease(() => true)
    const btn = el('BUTTON')
    click(btn)
    expect(btn.blur).toHaveBeenCalledTimes(1)
    const sw = el('BUTTON', { role: 'switch', 'aria-checked': 'false' })
    click(sw)
    expect(sw.blur).toHaveBeenCalledTimes(1)
  })

  it('a keyboard activation, an unfocused target and the classic chrome (host switch off) keep the focus', () => {
    setPointerFocusRelease(() => true)
    const btn = el('BUTTON')
    click(btn, 0)
    expect(btn.blur).not.toHaveBeenCalled()
    vi.stubGlobal('document', Object.assign(new FakeTarget(), { activeElement: null }))
    releaseAfterPointerClick({ detail: 1, currentTarget: btn } as never)
    expect(btn.blur).not.toHaveBeenCalled()
    setPointerFocusRelease(() => false)
    click(btn)
    expect(btn.blur).not.toHaveBeenCalled()
  })

  it('while a clicked radio keeps the focus its plain keys stay with it (phone sheet / narrow desktop: no double action)', () => {
    setPointerFocusRelease(() => true)
    const group = el('DIV', { role: 'radiogroup' })
    const a = el('BUTTON', { role: 'radio' }, group)
    const b = el('BUTTON', { role: 'radio', 'aria-checked': 'true' }, group)
    click(b)
    expect(doc.count('keydown')).toBe(1)
    // after React's handlers (the Segmented already moved the selection): not on to the board shortcuts
    for (const k of ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'r', 'c', 'f']) expect(keyAtDocument(b, k), k).toBe(true)
    // Escape, Tab and Ctrl / ⌘ / Alt keys go on (deselect, focus moves, Ctrl+Z, Ctrl+C …)
    expect(keyAtDocument(b, 'Escape')).toBe(false)
    expect(keyAtDocument(b, 'Tab')).toBe(false)
    expect(keyAtDocument(b, 'z', { ctrlKey: true })).toBe(false)
    expect(keyAtDocument(b, 'c', { metaKey: true })).toBe(false)
    // a key aimed elsewhere is not its business
    expect(keyAtDocument(null, 'Delete')).toBe(false)
    expect(keyAtDocument(el('CANVAS'), 'Delete')).toBe(false)
    // the focus moves inside the group (a roving radio group): still guarded
    group.fire('focusout', { relatedTarget: a })
    expect(keyAtDocument(a, 'ArrowLeft')).toBe(true)
    // the focus leaves to another control: the guard ends at once
    group.fire('focusout', { relatedTarget: el('BUTTON') })
    expect(doc.count('keydown')).toBe(0)
    expect(group.count('focusout')).toBe(0)
    expect(keyAtDocument(b, 'Delete')).toBe(false)
  })

  it('a click on the board ends the guard; the window losing focus (Alt+Tab) does not', () => {
    vi.useFakeTimers()
    try {
      setPointerFocusRelease(() => true)
      const group = el('DIV', { role: 'radiogroup' })
      const b = el('BUTTON', { role: 'radio', 'aria-checked': 'true' }, group)
      click(b)
      // Alt+Tab: focusout with no relatedTarget, but the radio keeps the page's focus
      group.fire('focusout', { relatedTarget: null })
      vi.runAllTimers()
      expect(doc.count('keydown'), 'still guarded after the window comes back').toBe(1)
      expect(keyAtDocument(b, 'ArrowLeft')).toBe(true)
      expect(keyAtDocument(b, 'Delete')).toBe(true)
      // a click on the board: the focus falls to <body> — the guard ends, the board's keys work again
      Object.assign(doc, { activeElement: null })
      group.fire('focusout', { relatedTarget: null })
      vi.runAllTimers()
      expect(doc.count('keydown')).toBe(0)
      expect(group.count('focusout')).toBe(0)
      expect(keyAtDocument(b, 'Delete')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the guard ends when its sheet / panel closes under it (the group left the page)', () => {
    setPointerFocusRelease(() => true)
    const group = Object.assign(el('DIV', { role: 'radiogroup' }), { isConnected: true })
    const b = el('BUTTON', { role: 'radio' }, group)
    click(b)
    expect(keyAtDocument(b, 'ArrowLeft')).toBe(true)
    group.isConnected = false
    expect(keyAtDocument(b, 'Delete')).toBe(false)
    expect(doc.count('keydown')).toBe(0)
  })

  it('one guard at a time; a released plain button, a keyboard activation and the classic chrome add none', () => {
    setPointerFocusRelease(() => true)
    click(el('BUTTON', { role: 'radio' }))
    click(el('BUTTON', { role: 'tab' }))
    expect(doc.count('keydown')).toBe(1)
    doc = new FakeTarget()
    click(el('BUTTON'))
    click(el('BUTTON', { role: 'radio' }), 0)
    setPointerFocusRelease(() => false)
    click(el('BUTTON', { role: 'radio' }))
    expect(doc.count('keydown')).toBe(0)
  })

  it('isPlainControlKey: Workspace guardKeys’ rule', () => {
    expect(isPlainControlKey({ key: 'ArrowLeft' })).toBe(true)
    expect(isPlainControlKey({ key: 'Delete' })).toBe(true)
    expect(isPlainControlKey({ key: 'Escape' })).toBe(false)
    expect(isPlainControlKey({ key: 'Tab' })).toBe(false)
    expect(isPlainControlKey({ key: 'v', ctrlKey: true })).toBe(false)
    expect(isPlainControlKey({ key: 'v', altKey: true })).toBe(false)
  })

  it('Space after a click on a kept radio still runs / pauses and drops its focus (SH-9, keys.ts)', () => {
    const pointerFocusedRadio: KeyTargetInfo = { textEntry: false, widget: true, keyboardFocused: false, inModal: false, ownKeys: [] }
    expect(routeGlobalKey({ key: ' ', code: 'Space' }, pointerFocusedRadio, { legacy: false, mcuCount: 1, blockingModal: false })).toEqual({
      kind: 'run',
      blur: true,
    })
  })
})
