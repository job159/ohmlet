/**
 * UX fix SH-9 / SH-10 — global key routing (src/ui/chrome/keys.ts):
 * Space and F5 / F10 / Shift+F5 mean the same thing wherever the focus is.
 *
 * The suite has no DOM (no jsdom in the toolchain), so the routing is
 * tested on its pure halves: routeGlobalKey (the target / app facts →
 * pass · run · debug · swallow) and debugKeyAction (the run state → halt,
 * step, halt + step, resume, reset, or why nothing happens). The DOM half
 * (describeKeyTarget, the focus modality, the capture listener) is replayed
 * in the real browser by scripts/ux-e2e/shell-SH-9.mjs.
 */
import { describe, expect, it } from 'vitest'
import {
  debugKeyAction,
  debugKeyOf,
  isSpaceKey,
  routeGlobalKey,
  type DebugState,
  type KeyAppInfo,
  type KeyTargetInfo,
} from '../src/ui/chrome/keys'
import { SHORTCUTS, SHORTCUT_GROUPS, WORKSPACE_ONLY_ROWS } from '../src/ui/chrome/ShortcutsSheet'

const BODY: KeyTargetInfo = { textEntry: false, widget: false, keyboardFocused: false, inModal: false, ownKeys: [] }
const target = (over: Partial<KeyTargetInfo>): KeyTargetInfo => ({ ...BODY, ...over })
const APP: KeyAppInfo = { legacy: false, mcuCount: 1, blockingModal: false }
const app = (over: Partial<KeyAppInfo>): KeyAppInfo => ({ ...APP, ...over })
const SPACE = { key: ' ', code: 'Space' }

describe('SH-9 Space', () => {
  it('runs / pauses from the 3D view (the body)', () => {
    expect(routeGlobalKey(SPACE, BODY, APP)).toEqual({ kind: 'run', blur: false })
  })

  it('a CLICKED control keeps no claim on Space: run, and drop its focus (no second activation on key-up)', () => {
    // 「單步」 chip, 「重置 MCU」, the coach's 「下一步」, a tray tab, LA 「自動」 — focused by a pointer
    expect(routeGlobalKey(SPACE, target({ widget: true, keyboardFocused: false }), APP)).toEqual({ kind: 'run', blur: true })
  })

  it('a control the KEYBOARD moved to keeps Space (native activation)', () => {
    expect(routeGlobalKey(SPACE, target({ widget: true, keyboardFocused: true }), APP)).toEqual({ kind: 'pass' })
  })

  it('a keyboard-focused non-control (a panel heading, the canvas) still runs', () => {
    expect(routeGlobalKey(SPACE, target({ keyboardFocused: true }), APP)).toEqual({ kind: 'run', blur: false })
  })

  it('typing, an open modal and data-own-keys keep Space', () => {
    expect(routeGlobalKey(SPACE, target({ textEntry: true }), APP).kind).toBe('pass')
    expect(routeGlobalKey(SPACE, target({ inModal: true }), APP).kind).toBe('pass')
    expect(routeGlobalKey(SPACE, BODY, app({ blockingModal: true })).kind).toBe('pass')
    expect(routeGlobalKey(SPACE, target({ ownKeys: ['Space'] }), APP).kind).toBe('pass')
    expect(routeGlobalKey(SPACE, target({ ownKeys: ['F5'] }), APP).kind).toBe('run')
  })

  it('needs no MCU, but never with a modifier', () => {
    expect(routeGlobalKey(SPACE, BODY, app({ mcuCount: 0 })).kind).toBe('run')
    expect(routeGlobalKey({ ...SPACE, ctrlKey: true }, BODY, APP).kind).toBe('pass')
  })

  it('the classic chrome routes nothing (its pre-wave bubble handler keeps Space — SH-10)', () => {
    expect(routeGlobalKey(SPACE, BODY, app({ legacy: true }))).toEqual({ kind: 'pass' })
    expect(routeGlobalKey({ key: 'F5' }, BODY, app({ legacy: true }))).toEqual({ kind: 'pass' })
  })

  it('isSpaceKey: key or code', () => {
    expect(isSpaceKey({ key: ' ' })).toBe(true)
    expect(isSpaceKey({ key: 'Unidentified', code: 'Space' })).toBe(true)
    expect(isSpaceKey({ key: 'a', code: 'KeyA' })).toBe(false)
  })
})

describe('SH-9 F5 / F10 / Shift+F5 routing', () => {
  it('act wherever the focus is — a clicked chip, a keyboard-focused button, even a text field', () => {
    for (const t of [BODY, target({ widget: true }), target({ widget: true, keyboardFocused: true }), target({ textEntry: true })]) {
      expect(routeGlobalKey({ key: 'F5' }, t, APP)).toMatchObject({ kind: 'debug', key: 'F5' })
      expect(routeGlobalKey({ key: 'F10' }, t, APP)).toMatchObject({ kind: 'debug', key: 'F10' })
      expect(routeGlobalKey({ key: 'F5', shiftKey: true }, t, APP)).toMatchObject({ kind: 'debug', key: 'Shift+F5' })
    }
    // a pointer-focused chip loses its focus (no ring left behind), a keyboard-focused one keeps it
    expect(routeGlobalKey({ key: 'F10' }, target({ widget: true }), APP)).toEqual({ kind: 'debug', key: 'F10', blur: true })
    expect(routeGlobalKey({ key: 'F10' }, target({ widget: true, keyboardFocused: true }), APP)).toEqual({ kind: 'debug', key: 'F10', blur: false })
  })

  it('without an MCU the browser keeps F5 (reload) and F10', () => {
    expect(routeGlobalKey({ key: 'F5' }, BODY, app({ mcuCount: 0 })).kind).toBe('pass')
    expect(routeGlobalKey({ key: 'F10' }, BODY, app({ mcuCount: 0 })).kind).toBe('pass')
  })

  it('under a modal F5 is swallowed (never a reload with a circuit on the bench), F10 passes', () => {
    expect(routeGlobalKey({ key: 'F5' }, BODY, app({ blockingModal: true })).kind).toBe('swallow')
    expect(routeGlobalKey({ key: 'F5' }, target({ inModal: true }), APP).kind).toBe('swallow')
    expect(routeGlobalKey({ key: 'F10' }, target({ inModal: true }), APP).kind).toBe('pass')
    expect(routeGlobalKey({ key: 'F5' }, target({ ownKeys: ['F5'] }), APP).kind).toBe('swallow')
  })

  it('debugKeyOf: Ctrl / Cmd / Alt combos are not debugger keys', () => {
    expect(debugKeyOf({ key: 'F5', ctrlKey: true })).toBeNull()
    expect(debugKeyOf({ key: 'F5', altKey: true })).toBeNull()
    expect(debugKeyOf({ key: 'F10', shiftKey: true })).toBeNull()
    expect(debugKeyOf({ key: 'F5', shiftKey: true })).toBe('Shift+F5')
  })
})

describe('SH-9 debugger key actions', () => {
  const S = (over: Partial<DebugState>): DebugState => ({ running: false, started: true, halted: [], target: 'U1', ...over })

  it('F10 while PAUSED halts the core where the pause left it and steps (E2-09)', () => {
    expect(debugKeyAction('F10', S({}))).toEqual({ kind: 'halt-step', id: 'U1' })
  })

  it('F10 while running asks for F5 first; before the first run asks to start', () => {
    expect(debugKeyAction('F10', S({ running: true }))).toEqual({ kind: 'explain', text: 'halt-first' })
    expect(debugKeyAction('F10', S({ started: false }))).toEqual({ kind: 'explain', text: 'start-first' })
    expect(debugKeyAction('F10', S({ target: null }))).toEqual({ kind: 'explain', text: 'select-step' })
  })

  it('F10 steps a halted core: the selected one when halted, else the first halted', () => {
    expect(debugKeyAction('F10', S({ halted: ['U1'] }))).toEqual({ kind: 'step', id: 'U1' })
    expect(debugKeyAction('F10', S({ halted: ['U2'], target: 'U1' }))).toEqual({ kind: 'step', id: 'U2' })
    expect(debugKeyAction('F10', S({ running: true, halted: ['U1'] }))).toEqual({ kind: 'step', id: 'U1' })
  })

  it('F5: halted or stopped → resume / run; running → halt the target', () => {
    expect(debugKeyAction('F5', S({ halted: ['U1'], running: true }))).toEqual({ kind: 'resume' })
    expect(debugKeyAction('F5', S({}))).toEqual({ kind: 'resume' })
    expect(debugKeyAction('F5', S({ running: true }))).toEqual({ kind: 'halt', id: 'U1' })
    expect(debugKeyAction('F5', S({ running: true, target: null }))).toEqual({ kind: 'explain', text: 'select-halt' })
  })

  it('Shift+F5 resets the target board', () => {
    expect(debugKeyAction('Shift+F5', S({ running: true }))).toEqual({ kind: 'reset', id: 'U1' })
    expect(debugKeyAction('Shift+F5', S({ target: null }))).toEqual({ kind: 'explain', text: 'select-reset' })
  })
})

describe('SH-16 F6 / Shift+F6 between the regions', () => {
  it('routes to the region cycle, back with Shift; not in the classic chrome, not under a modal', () => {
    expect(routeGlobalKey({ key: 'F6' }, BODY, APP)).toEqual({ kind: 'region', back: false })
    expect(routeGlobalKey({ key: 'F6', shiftKey: true }, target({ widget: true }), APP)).toEqual({ kind: 'region', back: true })
    expect(routeGlobalKey({ key: 'F6' }, target({ textEntry: true }), app({ mcuCount: 0 }))).toEqual({ kind: 'region', back: false })
    expect(routeGlobalKey({ key: 'F6' }, BODY, app({ legacy: true })).kind).toBe('pass')
    expect(routeGlobalKey({ key: 'F6' }, target({ inModal: true }), APP).kind).toBe('pass')
    expect(routeGlobalKey({ key: 'F6', ctrlKey: true }, BODY, APP).kind).toBe('pass')
  })
})

describe('SH-9 the shortcuts list', () => {
  it('lists Shift+A 分析版面 (workspace only)', () => {
    const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows)
    expect(rows).toContain(SHORTCUTS['analysis-layout'])
    expect(WORKSPACE_ONLY_ROWS.has(SHORTCUTS['analysis-layout'])).toBe(true)
    expect(WORKSPACE_ONLY_ROWS.has(SHORTCUTS.run)).toBe(false)
  })

  it('lists F6 / Shift+F6 (SH-16)', () => {
    expect(SHORTCUT_GROUPS.flatMap((g) => g.rows)).toContain(SHORTCUTS.regions)
    expect(SHORTCUTS.regions.combos).toEqual([['F6'], ['Shift', 'F6']])
  })
})
