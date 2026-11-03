/**
 * Part keys (round 5 — 「還要有快捷鍵 像 r 電阻 c 電容 p 電供 l 是 led ……
 * 幫我補完常用元件」, 「按鈕改 b」): src/ui/chrome/part-keys.ts.
 *
 *  (a) the map: every 「常用元件」 has a letter, no two share one, none takes
 *      a single-key shortcut (F, ?, Space, Esc, Delete / Backspace, the
 *      arrows), and each is a letter of the part's designator (R1, C1, LED1,
 *      PS1, RV1, D1, Q1, U1, DMM1) — the pushbutton's B (按鈕 / Button) is
 *      the user's own pick;
 *  (b) the decision: classic chrome, modifiers, a text field, a dialog, a
 *      control that reads letters, selected text, auto-repeat, a part that
 *      cannot be placed, the same letter (stop), another letter (switch),
 *      select and wire mode;
 *  (c) the card's own path through the store (arm, stop, switch, an
 *      off-board supply placed at once);
 *  (d) rotate moved to Shift+R in the product chrome (R in the classic one),
 *      顯示電流 to Shift+C (C is the capacitor) — the shortcuts table, the
 *      sheet's 「放置元件」, the rotate button's tooltip, the hint;
 *  (e) the keycaps on the library cards (desktop panel and the sheet);
 *  (f) the DOM reading of where a key landed;
 *  (g) App.tsx wires it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEntry } from '../src/model/catalog'
import { __setLangForTests, t } from '../src/i18n'
import { ID_PREFIX, useStore } from '../src/state/store'
import type { InteractionMode } from '../src/state/types'
import { COMMON_PARTS } from '../src/ui/workspace/library-order'
import {
  PART_KEYS,
  describePartKeyTarget,
  isFlowKey,
  isRotateKey,
  letterOf,
  partKeyAction,
  partKeyOf,
  partKeyRows,
  partKeyTitle,
  partTypeOfKey,
  runPartKey,
  type PartKeyContext,
  type PartKeyEvent,
  type PartKeyTarget,
} from '../src/ui/chrome/part-keys'
import {
  PLACE_PARTS_AFTER,
  PLACE_PARTS_GROUP,
  PlacePartsGroup,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  placePartRows,
  shortcutKeysText,
  withKey,
} from '../src/ui/chrome/ShortcutsSheet'
import { hintForMode } from '../src/ui/chrome/hints'
import { PartsView, sheetPartGroups } from '../src/ui/sheets/PartsSheet'
import { LibraryPanel } from '../src/ui/workspace/LibraryPanel'
import { useLab } from '../src/ui/embedded/lab'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

beforeEach(() => {
  const storage = new MemoryStorage()
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
  __setLangForTests('zh-TW')
})

afterEach(() => {
  vi.unstubAllGlobals()
  useStore.getState().clearBoard()
  useStore.getState().setMode({ kind: 'select' })
})

// ---------------------------------------------------------------- (a) the map
describe('(a) one letter per 常用元件, from its designator', () => {
  it('every COMMON_PARTS entry has a key, and the map lists nothing else', () => {
    for (const type of COMMON_PARTS) expect(PART_KEYS[type], type).toMatch(/^[A-Z]$/)
    expect(Object.keys(PART_KEYS).sort()).toEqual([...COMMON_PARTS].sort())
    // the ten the user asked for, completed
    expect(PART_KEYS).toMatchObject({ resistor: 'R', capacitor: 'C', power_supply: 'P', led: 'L', pushbutton: 'B' })
    expect(PART_KEYS).toMatchObject({ potentiometer: 'V', diode: 'D', npn: 'Q', stm32_bluepill: 'U', multimeter: 'M' })
  })

  it('no two parts share a letter; the letter finds the part (any case)', () => {
    const keys = Object.values(PART_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [type, key] of Object.entries(PART_KEYS)) {
      expect(partTypeOfKey(key)).toBe(type)
      expect(partTypeOfKey(key.toLowerCase())).toBe(type)
    }
    expect(partTypeOfKey('F')).toBeNull()
    expect(partTypeOfKey('Z')).toBeNull()
  })

  it('no letter takes a single-key shortcut (F, ?, Space, Esc, Delete / Backspace, arrows) or any listed single key', () => {
    const singles = Object.values(SHORTCUTS).flatMap((r) => r.combos.filter((c) => c.length === 1).map((c) => c[0].toUpperCase()))
    const reserved = new Set([...singles, 'F', '?', 'SPACE', 'ESC', 'ESCAPE', 'DELETE', 'BACKSPACE', 'ARROWS', 'ENTER', 'TAB'])
    for (const key of Object.values(PART_KEYS)) expect(reserved.has(key), key).toBe(false)
    // R and C left the table's single keys for their parts
    expect(singles).not.toContain('R')
    expect(singles).not.toContain('C')
  })

  it('each letter is one of the designator’s (R1 → R, LED1 → L, RV1 → V, DMM1 → M …); 按鈕 is B (the user’s pick)', () => {
    for (const [type, key] of Object.entries(PART_KEYS)) {
      if (type === 'pushbutton') continue
      const designator = ID_PREFIX[type] ?? 'U' // the Blue Pill's U (store idPrefixFor: an MCU board is an IC)
      expect(designator, type).toContain(key)
    }
    expect(PART_KEYS.pushbutton).toBe('B')
    expect(ID_PREFIX.pushbutton).toBe('SW')
  })

  it('partKeyOf: only a placeable part has a key; rows follow the 常用元件 order', () => {
    expect(partKeyOf('resistor')).toBe('R')
    expect(partKeyOf('ne555')).toBeNull()
    expect(partKeyOf('no_such_part')).toBeNull()
    expect(partKeyRows().map((r) => r.type)).toEqual([...COMMON_PARTS])
  })
})

// ---------------------------------------------------------------- (b) the decision
const key = (k: string, extra: Partial<PartKeyEvent> = {}): PartKeyEvent => ({ key: k, code: `Key${k.toUpperCase()}`, ...extra })
const free: PartKeyTarget = { textEntry: false, inDialog: false, ownsKey: false }
const select: InteractionMode = { kind: 'select' }
const ctx = (over: Partial<PartKeyContext> = {}): PartKeyContext => ({ legacy: false, textSelected: false, mode: select, ...over })

describe('(b) partKeyAction', () => {
  it('a plain letter arms its part from select mode (with or without a selection) and from wire mode', () => {
    expect(partKeyAction(key('r'), free, ctx())).toEqual({ kind: 'arm', type: 'resistor' })
    expect(partKeyAction(key('R'), free, ctx())).toEqual({ kind: 'arm', type: 'resistor' }) // Caps Lock
    expect(partKeyAction(key('b'), free, ctx())).toEqual({ kind: 'arm', type: 'pushbutton' })
    expect(partKeyAction(key('u'), free, ctx())).toEqual({ kind: 'arm', type: 'stm32_bluepill' })
    expect(partKeyAction(key('l'), free, ctx({ mode: { kind: 'wire', from: 'a1', color: 'red' } }))).toEqual({ kind: 'arm', type: 'led' })
  })

  it('the armed part’s letter stops placing; another letter switches part', () => {
    const placing: InteractionMode = { kind: 'place', type: 'resistor', pickedHoles: [] }
    expect(partKeyAction(key('r'), free, ctx({ mode: placing }))).toEqual({ kind: 'stop', type: 'resistor' })
    // half-placed (first lead set): still the armed card's second click
    expect(partKeyAction(key('r'), free, ctx({ mode: { ...placing, pickedHoles: ['a10'] } }))).toEqual({ kind: 'stop', type: 'resistor' })
    expect(partKeyAction(key('c'), free, ctx({ mode: placing }))).toEqual({ kind: 'arm', type: 'capacitor' })
    // a part armed some other way (a lesson's 「拿一顆電阻」, a card, NE555): any letter switches
    expect(partKeyAction(key('l'), free, ctx({ mode: { kind: 'place', type: 'ne555', pickedHoles: [] } }))).toEqual({ kind: 'arm', type: 'led' })
  })

  it('the classic chrome has no part keys', () => {
    expect(partKeyAction(key('r'), free, ctx({ legacy: true }))).toEqual({ kind: 'pass' })
    expect(partKeyAction(key('l'), free, ctx({ legacy: true }))).toEqual({ kind: 'pass' })
  })

  it('Ctrl / ⌘ / Alt / Shift + letter keep their meaning (Ctrl+C copy, Ctrl+R reload, Shift+R rotate …)', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      expect(partKeyAction(key('r', { [mod]: true }), free, ctx()), mod).toEqual({ kind: 'pass' })
      expect(partKeyAction(key('c', { [mod]: true }), free, ctx()), mod).toEqual({ kind: 'pass' })
    }
  })

  it('a text field (the library search!), a dialog, a control that reads letters and selected text keep the key', () => {
    expect(partKeyAction(key('r'), { ...free, textEntry: true }, ctx())).toEqual({ kind: 'pass' })
    expect(partKeyAction(key('r'), { ...free, inDialog: true }, ctx())).toEqual({ kind: 'pass' })
    expect(partKeyAction(key('b'), { ...free, ownsKey: true }, ctx())).toEqual({ kind: 'pass' })
    expect(partKeyAction(key('r'), free, ctx({ textSelected: true }))).toEqual({ kind: 'pass' })
    expect(partKeyAction(key('r', { isComposing: true }), free, ctx())).toEqual({ kind: 'pass' })
  })

  it('a held key acts once; a part that cannot be placed does nothing (the key is still taken)', () => {
    expect(partKeyAction(key('r', { repeat: true }), free, ctx())).toEqual({ kind: 'swallow' })
    expect(partKeyAction(key('r'), free, ctx({ placeable: () => false }))).toEqual({ kind: 'swallow' })
  })

  it('mid-drag (a pointer held down) a letter does nothing, so a wire being drawn is never dropped', () => {
    expect(partKeyAction(key('r'), free, ctx({ pointerHeld: true }))).toEqual({ kind: 'swallow' })
    expect(partKeyAction(key('l'), free, ctx({ pointerHeld: true, mode: { kind: 'place', type: 'resistor', pickedHoles: [] } }))).toEqual({ kind: 'swallow' })
    expect(partKeyAction(key('r'), free, ctx({ pointerHeld: false }))).toEqual({ kind: 'arm', type: 'resistor' })
  })

  it('other keys are not part keys', () => {
    for (const k of ['f', 'z', '?', ' ', 'Escape', 'Delete', 'ArrowLeft', 'F5', 'Enter', '1']) {
      expect(partKeyAction(key(k), free, ctx()), k).toEqual({ kind: 'pass' })
    }
  })

  it('letterOf: the typed letter; a non-Latin layout falls back to the physical key; an IME’s Process is none', () => {
    expect(letterOf({ key: 'r' })).toBe('R')
    expect(letterOf({ key: 'к', code: 'KeyR' })).toBe('R')
    expect(letterOf({ key: 'Process', code: 'KeyR' })).toBeNull()
    expect(letterOf({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBeNull()
  })
})

// ---------------------------------------------------------------- (c) the card's path
describe('(c) runPartKey takes the library card’s path (store.setMode)', () => {
  const mode = () => useStore.getState().mode
  const run = (k: string) =>
    runPartKey(partKeyAction(key(k), free, { legacy: false, textSelected: false, mode: useStore.getState().mode }))

  it('R arms the resistor, R again stops, L switches to the LED', () => {
    useStore.getState().setMode({ kind: 'select' })
    run('r')
    expect(mode()).toEqual({ kind: 'place', type: 'resistor', pickedHoles: [] })
    run('l')
    expect(mode()).toEqual({ kind: 'place', type: 'led', pickedHoles: [] })
    run('l')
    expect(mode()).toEqual({ kind: 'select' })
  })

  it('P places the bench supply beside the board at once and selects it (an off-board part, like its card)', () => {
    const before = useStore.getState().layout.components.length
    run('p')
    const comps = useStore.getState().layout.components
    expect(comps.length).toBe(before + 1)
    expect(comps[comps.length - 1].type).toBe('power_supply')
    expect(mode()).toEqual({ kind: 'select' })
    expect(useStore.getState().selection).toEqual([comps[comps.length - 1].id])
  })

  it('a selection stays (as with a card click) and wire mode gives way', () => {
    useStore.getState().setMode({ kind: 'wire', from: 'a1', color: 'red' })
    run('c')
    expect(mode()).toEqual({ kind: 'place', type: 'capacitor', pickedHoles: [] })
  })

  it('pass / swallow change nothing', () => {
    useStore.getState().setMode({ kind: 'select' })
    runPartKey({ kind: 'pass' })
    runPartKey({ kind: 'swallow' })
    expect(mode()).toEqual({ kind: 'select' })
  })
})

// ---------------------------------------------------------------- (d) rotate → Shift+R, 顯示電流 → Shift+C
describe('(d) the rotate key moves to Shift+R (product chrome), 顯示電流 to Shift+C', () => {
  it('isRotateKey: product Shift+R only; classic R (Shift or not), exactly as before', () => {
    expect(isRotateKey({ key: 'R', shiftKey: true }, false)).toBe(true)
    expect(isRotateKey({ key: 'r' }, false)).toBe(false)
    expect(isRotateKey({ key: 'r' }, true)).toBe(true)
    expect(isRotateKey({ key: 'R', shiftKey: true }, true)).toBe(true)
    for (const legacy of [false, true]) {
      expect(isRotateKey({ key: 'r', ctrlKey: true, shiftKey: true }, legacy)).toBe(false) // Ctrl+Shift+R = hard reload
      expect(isRotateKey({ key: 'r', metaKey: true }, legacy)).toBe(false)
      expect(isRotateKey({ key: 'r', altKey: true, shiftKey: true }, legacy)).toBe(false)
      expect(isRotateKey({ key: 'f', shiftKey: true }, legacy)).toBe(false)
    }
  })

  it('Shift+R while placing is taken by the part keys (any focus but a field / a dialog): it turns the ghost', () => {
    const placing: InteractionMode = { kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }
    const shiftR = key('R', { shiftKey: true })
    expect(partKeyAction(shiftR, free, ctx({ mode: placing }))).toEqual({ kind: 'rotate' })
    expect(partKeyAction(key('R', { shiftKey: true, repeat: true }), free, ctx({ mode: placing }))).toEqual({ kind: 'rotate' }) // held: keeps turning, as R did
    expect(partKeyAction(shiftR, { ...free, textEntry: true }, ctx({ mode: placing }))).toEqual({ kind: 'pass' })
    expect(partKeyAction(shiftR, { ...free, inDialog: true }, ctx({ mode: placing }))).toEqual({ kind: 'pass' })
    expect(partKeyAction(shiftR, free, ctx({ mode: placing, legacy: true }))).toEqual({ kind: 'pass' }) // classic: App.tsx's R, as before
    // a selected placed part turns in App.tsx's 3D-view handler
    expect(partKeyAction(shiftR, free, ctx())).toEqual({ kind: 'pass' })
    // through the store: the rotate button's action
    useStore.getState().setMode(placing)
    runPartKey({ kind: 'rotate' })
    const m = useStore.getState().mode
    expect(m.kind === 'place' && (m.rotation ?? 0) !== 0).toBe(true)
  })

  it('isFlowKey: Shift+C in the product chrome only', () => {
    expect(isFlowKey({ key: 'C', shiftKey: true }, false)).toBe(true)
    expect(isFlowKey({ key: 'c' }, false)).toBe(false)
    expect(isFlowKey({ key: 'C', shiftKey: true }, true)).toBe(false)
    expect(isFlowKey({ key: 'C', shiftKey: true, ctrlKey: true }, false)).toBe(false)
  })

  it('the shortcuts table: 旋轉 Shift+R, 顯示電流 Shift+C — the tooltips read it', () => {
    expect(SHORTCUTS.rotate).toEqual({ combos: [['Shift', 'R']], label: 'Rotate' })
    expect(SHORTCUTS['current-flow']).toEqual({ combos: [['Shift', 'C']], label: 'Show current' })
    expect(shortcutKeysText('rotate')).toBe('Shift+R')
    expect(withKey(t('Rotate part'), 'rotate')).toEqual({ title: '旋轉元件（Shift+R）', ariaKeyshortcuts: 'Shift+R' })
    expect(withKey(t('Show current'), 'current-flow')).toEqual({ title: '顯示電流（Shift+C）', ariaKeyshortcuts: 'Shift+C' })
    const editing = SHORTCUT_GROUPS.find((g) => g.title === 'Editing')!
    expect(editing.rows[0]).toBe(SHORTCUTS.rotate)
  })

  it('the RotateButton’s tooltip comes from the table (Shift+R); the placing hint says Shift+R 旋轉 (mouse) and no key on touch', () => {
    const btn = read('src/ui/chrome/RotateButton.tsx')
    expect(btn).toContain("withKey(t('Rotate part'), 'rotate')")
    const bp = hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }, false)!
    expect(bp).toContain('點 h 列的孔位放下（PB12 對齊那個孔）· Shift+R 旋轉 · Esc 取消')
    expect(bp).not.toMatch(/· R 旋轉/)
    expect(hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }, true)).not.toMatch(/Shift|R 旋轉|Esc/)
  })

  it('the classic hint names no key (unchanged)', () => {
    // classic chrome: English without the workspace (the stubbed matchMedia never matches)
    __setLangForTests('en')
    const h = hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }, false)!
    expect(h).toContain('anchor hole (row h)')
    expect(h).not.toMatch(/rotates|Shift/)
  })
})

// ---------------------------------------------------------------- the shortcuts sheet's 放置元件
describe('(d) the shortcuts sheet lists 「放置元件」', () => {
  it('one row per 常用元件: the letter and the library’s name, in 常用元件 order', () => {
    expect(t(`${PLACE_PARTS_GROUP}|shortcuts`)).toBe('放置元件')
    expect(PLACE_PARTS_AFTER).toBe('View')
    const rows = placePartRows()
    expect(rows.map((r) => r.key)).toEqual(['R', 'L', 'B', 'C', 'P', 'V', 'U', 'Q', 'D', 'M'])
    expect(rows[0]).toEqual({ key: 'R', label: '電阻' })
    expect(rows.find((r) => r.key === 'B')!.label).toBe('按鈕（輕觸開關）')
    expect(rows.find((r) => r.key === 'P')!.label).toBe('直流電源供應器')
  })

  it('renders the keycaps, the names and how to stop', () => {
    const html = renderToStaticMarkup(createElement(PlacePartsGroup))
    expect(html).toContain('<div class="app-keys-group-title">放置元件</div>')
    expect(html).toContain('<kbd class="lg-kbd">R</kbd>')
    expect(html).toContain('<span class="app-keys-label">電阻</span>')
    expect(html.match(/<kbd class="lg-kbd">/g)).toHaveLength(10)
    expect(html).toContain('在輸入框以外都能按；同一個字母再按一次就停止放置')
  })

  it('the sheet puts the group after 檢視, before 編輯', () => {
    const src = read('src/ui/chrome/ShortcutsSheet.tsx')
    expect(src).toContain('{g.title === PLACE_PARTS_AFTER && <PlacePartsGroup />}')
    const titles = SHORTCUT_GROUPS.map((g) => g.title)
    expect(titles.indexOf(PLACE_PARTS_AFTER)).toBe(titles.indexOf('Editing') - 1)
  })
})

// ---------------------------------------------------------------- (e) keycaps
/** Server-render with the stores' live state (renderToStaticMarkup reads getInitialState). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}

const sheetHtml = (legacy: boolean, armedType: string | null = null) =>
  renderToStaticMarkup(
    createElement(PartsView, {
      armedEntry: undefined,
      query: '',
      setQuery: () => {},
      cat: 'all',
      setCat: () => {},
      groups: sheetPartGroups(legacy, 'all', ''),
      armedType,
      legacy,
      onSearchFocus: () => {},
      onCard: () => {},
    }),
  )

describe('(e) the library cards show their key', () => {
  it('partKeyTitle: 「電阻（快捷鍵 R）」; no title for a part without a key', () => {
    expect(partKeyTitle(getEntry('resistor')!)).toBe('電阻（快捷鍵 R）')
    expect(partKeyTitle(getEntry('pushbutton')!)).toBe('按鈕（輕觸開關）（快捷鍵 B）')
    expect(partKeyTitle(getEntry('ne555')!)).toBeNull()
  })

  it('the desktop library: a keycap on every copy of a 常用元件 card (常用元件 and its category), aria-keyshortcuts + title', () => {
    const html = renderLive(createElement(LibraryPanel, { onCollapse: () => {} }))
    const caps = [...html.matchAll(/<kbd class="ws-part-key" aria-hidden="true">([A-Z])<\/kbd>/g)].map((m) => m[1])
    expect(caps).toHaveLength(2 * COMMON_PARTS.length) // 常用元件 + the category copy
    expect(new Set(caps)).toEqual(new Set(Object.values(PART_KEYS)))
    expect(html).toContain('aria-keyshortcuts="R" title="電阻（快捷鍵 R）"')
    expect(html.match(/aria-keyshortcuts="/g)).toHaveLength(2 * COMMON_PARTS.length) // no other card claims a key
  })

  it('the armed card keeps its keycap (press it again to stop) and its stop tooltip', () => {
    useStore.setState({ mode: { kind: 'place', type: 'resistor', pickedHoles: [] } })
    try {
      const html = renderLive(createElement(LibraryPanel, { onCollapse: () => {} }))
      expect(html).toContain(`aria-keyshortcuts="R" title="${t('Click the card again to stop placing')}"`)
      expect(html.match(/<kbd class="ws-part-key" aria-hidden="true">R<\/kbd>/g)).toHaveLength(2)
    } finally {
      useStore.setState({ mode: { kind: 'select' } })
    }
  })

  it('the sheet (product chrome): a corner keycap per 常用元件 card; 「放置中」 takes the corner while armed; classic: none', () => {
    const html = sheetHtml(false)
    expect(html.match(/<kbd class="psh-card-key" aria-hidden="true">/g)).toHaveLength(COMMON_PARTS.length)
    expect(html).toContain('aria-keyshortcuts="L" title="發光二極體 LED（快捷鍵 L）"')
    const armed = sheetHtml(false, 'led')
    expect(armed.match(/<kbd class="psh-card-key"/g)).toHaveLength(COMMON_PARTS.length - 1)
    expect(armed).not.toContain('psh-card-key" aria-hidden="true">L<')
    __setLangForTests('en')
    const classic = sheetHtml(true)
    expect(classic).not.toContain('psh-card-key')
    expect(classic).not.toContain('aria-keyshortcuts')
  })

  it('CSS: the keycaps show on mouse pointers only, with the label tokens (the light tone flips them)', () => {
    const squash = (s: string) => s.replace(/\s+/g, ' ')
    for (const [file, cls] of [
      ['src/ui/workspace/workspace.css', 'ws-part-key'],
      ['src/ui/sheets/PartsSheet.css', 'psh-card-key'],
    ] as const) {
      const css = squash(read(file))
      expect(css, file).toContain(`.${cls} { display: none; }`)
      const desk = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine)', css.indexOf(`.${cls} {`)))
      expect(desk.slice(0, 600), file).toMatch(new RegExp(`\\.${cls} \\{[^}]*display: inline-flex;[^}]*background: var\\(--fill-2\\);[^}]*color: var\\(--label-2\\);`))
    }
  })
})

// ---------------------------------------------------------------- (f) where the key landed
/** A tiny DOM stand-in: tag, attributes, classes, parent — enough for closest() with the selectors part-keys / keys use. */
class FakeEl {
  isContentEditable = false
  constructor(
    public tagName: string,
    public attrs: Record<string, string> = {},
    public parent: FakeEl | null = null,
  ) {}
  getAttribute(n: string): string | null {
    return n in this.attrs ? this.attrs[n] : null
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs
  }
  get classList(): string[] {
    return (this.attrs.class ?? '').split(/\s+/).filter(Boolean)
  }
  get type(): string {
    return this.attrs.type ?? 'text'
  }
  /** one compound selector: tag, .class, [attr], [attr="v"], :not(.class) */
  private one(sel: string): boolean {
    let s = sel.trim()
    const not = /:not\(\.([\w-]+)\)$/.exec(s)
    if (not) {
      if (this.classList.includes(not[1])) return false
      s = s.slice(0, not.index)
    }
    const tag = /^[a-z]+/i.exec(s)?.[0]
    if (tag && tag.toUpperCase() !== this.tagName) return false
    for (const m of s.matchAll(/\.([\w-]+)/g)) if (!this.classList.includes(m[1])) return false
    for (const m of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!(m[1] in this.attrs)) return false
      if (m[2] !== undefined && this.attrs[m[1]] !== m[2]) return false
    }
    return true
  }
  matches(sel: string): boolean {
    return sel.split(',').some((s) => this.one(s))
  }
  closest(sel: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.matches(sel)) return e
    return null
  }
}

describe('(f) describePartKeyTarget', () => {
  let dialog: FakeEl | null = null
  const body = new FakeEl('BODY')
  beforeEach(() => {
    dialog = null
    vi.stubGlobal('Element', FakeEl)
    vi.stubGlobal('document', {
      body,
      documentElement: new FakeEl('HTML'),
      querySelector: (sel: string) => (dialog && dialog.matches(sel) ? dialog : null),
    })
  })
  const panel = new FakeEl('ASIDE', { class: 'ws-panel ws-left' }, body)

  it('the page itself, a library card, a tab or a radio: letters are part keys', () => {
    expect(describePartKeyTarget(body as unknown as EventTarget, 'R')).toEqual(free)
    const card = new FakeEl('BUTTON', { class: 'ws-part-main lg-pressable', type: 'button' }, panel)
    expect(describePartKeyTarget(card as unknown as EventTarget, 'L')).toEqual(free)
    const tab = new FakeEl('BUTTON', { role: 'tab' }, panel)
    expect(describePartKeyTarget(tab as unknown as EventTarget, 'R')).toEqual(free)
    const radio = new FakeEl('BUTTON', { role: 'radio' }, panel)
    expect(describePartKeyTarget(radio as unknown as EventTarget, 'R')).toEqual(free)
    // the 3D view (F6 gives it tabindex -1)
    const view = new FakeEl('DIV', { class: 'app-canvas', tabindex: '-1' }, body)
    expect(describePartKeyTarget(view as unknown as EventTarget, 'R')).toEqual(free)
  })

  it('the library search types its letters', () => {
    const search = new FakeEl('INPUT', { type: 'search', class: 'psh-search-input' }, panel)
    expect(describePartKeyTarget(search as unknown as EventTarget, 'R').textEntry).toBe(true)
  })

  it('an instrument plot (its A / B markers), a terminal, a type-ahead list and data-own-keys read their own letters', () => {
    const plot = new FakeEl('DIV', { class: 'emb-la-plot', role: 'img', tabindex: '0' }, panel)
    expect(describePartKeyTarget(plot as unknown as EventTarget, 'B').ownsKey).toBe(true)
    const log = new FakeEl('DIV', { tabindex: '0' }, panel)
    expect(describePartKeyTarget(log as unknown as EventTarget, 'R').ownsKey).toBe(true)
    const list = new FakeEl('DIV', { role: 'listbox' }, panel)
    const option = new FakeEl('DIV', { role: 'option' }, list)
    expect(describePartKeyTarget(option as unknown as EventTarget, 'R').ownsKey).toBe(true)
    const owner = new FakeEl('DIV', { 'data-own-keys': 'B Space' }, panel)
    const inside = new FakeEl('BUTTON', {}, owner)
    expect(describePartKeyTarget(inside as unknown as EventTarget, 'B').ownsKey).toBe(true)
    expect(describePartKeyTarget(inside as unknown as EventTarget, 'R').ownsKey).toBe(false)
  })

  it('an open dialog (the shortcuts list, the onboarding) owns the keys; a library sheet does not', () => {
    dialog = new FakeEl('DIV', { class: 'app-keys', role: 'dialog', 'aria-modal': 'true' }, body)
    expect(describePartKeyTarget(body as unknown as EventTarget, 'R').inDialog).toBe(true)
    dialog = new FakeEl('DIV', { class: 'lg-sheet psh', role: 'dialog', 'aria-modal': 'true' }, body)
    const card = new FakeEl('BUTTON', { class: 'psh-card' }, dialog)
    expect(describePartKeyTarget(card as unknown as EventTarget, 'R')).toEqual(free)
  })
})

// ---------------------------------------------------------------- (g) App.tsx
describe('(g) App.tsx wires the part keys, Shift+R and Shift+C', () => {
  const app = read('src/App.tsx')
  it('installs the capture listener once with the chrome and the text selection', () => {
    expect(app).toContain('useEffect(() => installPartKeys({ legacy: isLegacyChrome, textSelected: textSelectionActive }), [])')
  })
  it('the rotate branch reads isRotateKey; Shift+C toggles 顯示電流 once per press', () => {
    // …and stands aside when part-keys.ts already turned an armed ghost (Shift+R while placing)
    expect(app).toContain('if (isRotateKey(e, legacyChrome) && !e.defaultPrevented) {')
    expect(app).not.toContain("if (key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {")
    expect(app).toMatch(/if \(isFlowKey\(e, legacyChrome\) && !e\.defaultPrevented\) \{\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) toggleFlowView\(true\)/)
  })
})
