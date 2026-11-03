/**
 * Round 5 final integrator — the focus stream's two open contract requests:
 *
 *  (1) Segmented roving focus (src/ui/kit/Segmented.tsx): an arrow moves the
 *      focus with the selection, so the ring never stays on the old, now
 *      unselected segment and Enter never re-selects it. keys.ts keeps a
 *      group the POINTER focused pointer-picked across that move, so the
 *      next Space still runs / pauses (SH-9) — a keyboard user's group stays
 *      keyboard-focused (Space presses the segment, WAI-ARIA).
 *  (2) App.tsx: an arrow a focused control already used (preventDefault —
 *      Segmented, SliderIOS, ResizeHandle) never also nudges the selected
 *      part, however the control got its focus (product chrome only).
 *
 * No DOM in the suite: window / document / Element are minimal stubs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { focusedByKeyboard, installFocusModality, routeGlobalKey } from '../src/ui/chrome/keys'

type Listener = (ev: never) => void

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
}

class FakeEl extends FakeTarget {
  parent: FakeEl | null = null
  constructor(
    public tagName: string,
    public attrs: Record<string, string> = {},
  ) {
    super()
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs
  }
  contains(n: unknown): boolean {
    for (let c = n as FakeEl | null; c; c = c.parent) if (c === this) return true
    return false
  }
  /** enough of closest() for the role selectors keys.ts asks */
  closest(sel: string): FakeEl | null {
    const roles = [...sel.matchAll(/\[role="([a-z]+)"\]/g)].map((m) => m[1])
    for (let c: FakeEl | null = this; c; c = c.parent) if (roles.includes(c.attrs.role ?? '')) return c
    return null
  }
}

const g = globalThis as unknown as Record<string, unknown>
let saved: Record<string, unknown> = {}
let uninstall: (() => void) | null = null
let win: FakeTarget
let doc: FakeTarget

beforeEach(() => {
  saved = { window: g.window, document: g.document, Element: g.Element }
  win = new FakeTarget()
  doc = new FakeTarget()
  g.window = win
  g.document = doc
  g.Element = FakeEl
  uninstall = installFocusModality()
})

afterEach(() => {
  uninstall?.()
  uninstall = null
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k]
    else g[k] = v
  }
})

/** A radio group with three segments. */
function group(): { track: FakeEl; seg: FakeEl[] } {
  const track = new FakeEl('DIV', { role: 'radiogroup' })
  const seg = ['文字', '十六進位', 'x'].map(() => {
    const b = new FakeEl('BUTTON', { role: 'radio' })
    b.parent = track
    return b
  })
  return { track, seg }
}

const pointer = (el: FakeEl) => win.fire('pointerdown', { target: el })
const key = (k: string) => win.fire('keydown', { key: k })
const focusIn = (el: FakeEl, from: FakeEl | null) => doc.fire('focusin', { target: el, relatedTarget: from })

const APP = { legacy: false, mcuCount: 1, blockingModal: false }
const spaceRoute = (el: FakeEl) =>
  routeGlobalKey(
    { key: ' ', code: 'Space' },
    { textEntry: false, widget: true, keyboardFocused: focusedByKeyboard(el as unknown as Element), inModal: false, ownKeys: [] },
    APP,
  )

describe('(1) roving focus keeps the way a radio group got its focus', () => {
  it('clicked, then an arrow moves the focus to the next segment: still pointer-picked, Space runs', () => {
    const { seg } = group()
    pointer(seg[1])
    focusIn(seg[1], null)
    expect(focusedByKeyboard(seg[1] as unknown as Element)).toBe(false)
    key('ArrowLeft') // Segmented selects 文字 and moves the focus there
    focusIn(seg[0], seg[1])
    expect(focusedByKeyboard(seg[0] as unknown as Element)).toBe(false)
    expect(spaceRoute(seg[0])).toEqual({ kind: 'run', blur: true })
  })

  it('a keyboard user who tabbed in stays keyboard-focused along the arrows: Space presses the segment', () => {
    const { seg } = group()
    key('Tab')
    focusIn(seg[1], null)
    expect(focusedByKeyboard(seg[1] as unknown as Element)).toBe(true)
    key('ArrowRight')
    focusIn(seg[2], seg[1])
    expect(focusedByKeyboard(seg[2] as unknown as Element)).toBe(true)
    expect(spaceRoute(seg[2])).toEqual({ kind: 'pass' })
  })

  it('leaving the group by keyboard (Tab to another control) is keyboard focus as before', () => {
    const { seg } = group()
    const other = new FakeEl('BUTTON')
    pointer(seg[1])
    focusIn(seg[1], null)
    key('Tab')
    focusIn(other, seg[1])
    expect(focusedByKeyboard(other as unknown as Element)).toBe(true)
  })

  it('Segmented moves the focus with an arrow-key selection (source contract)', () => {
    const src = readFileSync(resolve(__dirname, '../src/ui/kit/Segmented.tsx'), 'utf8')
    expect(src).toMatch(/focusNextRef\.current = next\.value\s+select\(next\.value\)/)
    expect(src).toMatch(/if \(want === null \|\| want !== value\) return[\s\S]{0,200}querySelectorAll<HTMLElement>\('\[role="radio"\]'\)\[i\]\?\.focus\(\)/)
  })
})

describe('(2) an arrow a control already used never also nudges the part', () => {
  it('App.tsx skips the nudge when the arrow was preventDefault-ed (product chrome)', () => {
    const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8')
    const nudge = app.slice(app.indexOf("st.mode.kind === 'select' &&\n        st.selection.length > 0 &&"), app.indexOf('st.moveSelection(-1)'))
    expect(nudge).toMatch(/!\(e\.defaultPrevented && !legacyChrome\)/)
    expect(nudge).toMatch(/ArrowLeft/)
  })
})
