/**
 * 元件庫 in usage order (src/ui/workspace/library-order.ts): the everyday
 * parts first (「常用元件」), the categories from the basics to the
 * specialised, the most used part first inside each; classic chrome keeps
 * the original MCU-first order. Both browsers use it: the desktop 元件庫 tab
 * (LibraryPanel: 收藏 → 常用元件 → categories) and the phone sheet
 * (PartsSheet: 「全部」 common-first, each part once).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, getEntry, supportOf, type CatalogEntry, type ComponentCategory } from '../src/model/catalog'
import { __setLangForTests, t } from '../src/i18n'
import { partLabel } from '../src/i18n/parts'
import {
  CATEGORY_ORDER,
  COMMON_PARTS,
  LEGACY_CATEGORY_ORDER,
  PART_RANK,
  commonFirst,
  commonParts,
  libraryCategories,
  orderEntries,
  orderedCatalog,
} from '../src/ui/workspace/library-order'
import * as partsSheet from '../src/ui/sheets/PartsSheet'
import { LibraryPanel } from '../src/ui/workspace/LibraryPanel'
import { useLab } from '../src/ui/embedded/lab'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const types = (list: readonly CatalogEntry[]) => list.map((e) => e.type)

describe('library order (usage order)', () => {
  it('orderedCatalog() lists every catalog part exactly once', () => {
    const list = types(orderedCatalog())
    expect(list).toHaveLength(Object.keys(CATALOG).length)
    expect(new Set(list).size).toBe(list.length)
    expect([...list].sort()).toEqual(Object.keys(CATALOG).sort())
  })

  it('every part is ranked on purpose: exactly once, under its own category', () => {
    const ranked = Object.values(PART_RANK).flat()
    expect(new Set(ranked).size).toBe(ranked.length)
    for (const [cat, list] of Object.entries(PART_RANK)) {
      for (const type of list) expect(getEntry(type)?.category, type).toBe(cat)
    }
    for (const e of Object.values(CATALOG)) expect(PART_RANK[e.category], e.type).toContain(e.type)
    // the order names every category once
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length)
    expect([...CATEGORY_ORDER].sort()).toEqual([...LEGACY_CATEGORY_ORDER].sort())
    expect([...CATEGORY_ORDER].sort()).toEqual(Object.keys(PART_RANK).sort())
  })

  it('categories in usage order, each one contiguous: basics → supply → outputs → chips → MCU → peripherals → instruments', () => {
    expect(CATEGORY_ORDER).toEqual([
      'passive',
      'semiconductor',
      'switch',
      'power',
      'display',
      'ic',
      'mcu',
      'sensor',
      'module',
      'motor',
      'instrument',
    ])
    const list = orderedCatalog()
    const runs: ComponentCategory[] = []
    for (const e of list) if (runs[runs.length - 1] !== e.category) runs.push(e.category)
    expect(runs).toEqual(CATEGORY_ORDER)
    expect(libraryCategories(list)).toEqual(CATEGORY_ORDER)
  })

  it('the most used part heads each category, in rank order', () => {
    const list = orderedCatalog()
    const heads = CATEGORY_ORDER.map((c) => list.find((e) => e.category === c)?.type)
    expect(heads).toEqual([
      'resistor',
      'led',
      'pushbutton',
      'power_supply',
      'buzzer',
      'ne555',
      'stm32_bluepill',
      'hcsr04',
      'usb_uart_ch340',
      'sg90_servo',
      'multimeter',
    ])
    for (const c of CATEGORY_ORDER) expect(types(list.filter((e) => e.category === c)), c).toEqual(PART_RANK[c])
    expect(types(list).slice(0, 3)).toEqual(['resistor', 'capacitor', 'potentiometer'])
  })

  it('常用元件: the ten everyday parts, all real and placeable', () => {
    expect([...COMMON_PARTS]).toEqual([
      'resistor',
      'led',
      'pushbutton',
      'capacitor',
      'power_supply',
      'potentiometer',
      'stm32_bluepill',
      'npn',
      'diode',
      'multimeter',
    ])
    expect(new Set(COMMON_PARTS).size).toBe(COMMON_PARTS.length)
    const common = commonParts()
    expect(types(common)).toEqual([...COMMON_PARTS])
    for (const e of common) expect(supportOf(e).level, e.type).not.toBe('dev')
  })

  it('classic chrome keeps the original order (MCU first, then catalog order)', () => {
    const legacy = orderedCatalog({ legacy: true })
    const entries = Object.values(CATALOG)
    const before = LEGACY_CATEGORY_ORDER.flatMap((c) => entries.filter((e) => e.category === c))
    expect(types(legacy)).toEqual(types(before))
    expect(legacy[0].type).toBe('stm32_bluepill')
    expect(LEGACY_CATEGORY_ORDER[0]).toBe('mcu')
  })

  it('never drops a part: an unranked type ends its category, an unknown category ends the list', () => {
    const res = getEntry('resistor')!
    const cap = getEntry('capacitor')!
    const newPassive = { ...res, type: 'zz_new_passive' } as CatalogEntry
    const alien = { ...res, type: 'zz_alien', category: 'alien' as ComponentCategory } as CatalogEntry
    const out = types(orderEntries([alien, newPassive, cap, getEntry('led')!, res]))
    expect(out).toEqual(['resistor', 'capacitor', 'zz_new_passive', 'led', 'zz_alien'])
    // legacy keeps the given order inside a category, and drops nothing either
    expect(types(orderEntries([alien, newPassive, cap, res], { legacy: true }))).toEqual([
      'zz_new_passive',
      'capacitor',
      'resistor',
      'zz_alien',
    ])
  })

  it('search results: match quality first, the usage rank breaks ties', () => {
    __setLangForTests('zh-TW')
    const matches = (q: string) => types(partsSheet.sheetPartGroups(false, 'all', q).flatMap((g) => g.entries))
    const led = matches('led')
    expect(led[0]).toBe('led')
    expect(led.indexOf('led')).toBeLessThan(led.indexOf('rgb_led'))
    const res = matches('電阻')
    expect(res[0]).toBe('resistor')
    // same tier (the name contains 電阻): the usage rank decides
    expect(res.indexOf('potentiometer')).toBeLessThan(res.indexOf('photoresistor'))
  })
})

describe('the phone sheet (PartsSheet): 「全部」 is common-first, each part once', () => {
  it('commonFirst moves the everyday parts to the front and lists every part once', () => {
    const all = orderedCatalog()
    const grid = commonFirst(all)
    expect(types(grid).slice(0, COMMON_PARTS.length)).toEqual([...COMMON_PARTS])
    expect(grid).toHaveLength(all.length)
    expect(new Set(types(grid)).size).toBe(all.length)
    // the rest keeps the library order
    const rest = types(all).filter((x) => !COMMON_PARTS.includes(x))
    expect(types(grid).slice(COMMON_PARTS.length)).toEqual(rest)
    // only the common parts that are in the list
    expect(types(commonFirst(all.filter((e) => e.category === 'semiconductor'))).slice(0, 3)).toEqual(['led', 'npn', 'diode'])
  })

  it('the sheet wires it: common-first only for 「全部」 without a query, classic chrome on the original order', () => {
    const src = read('src/ui/sheets/PartsSheet.tsx')
    expect(src).toContain("orderedCatalog({ legacy })")
    expect(src).toContain("if (legacy) return [{ key: 'all', entries: list }]")
    expect(src).toContain("return cat === 'all' ? sheetGroups(list) : [{ key: 'all', entries: list }]")
    expect(src).toContain('(legacy ? LEGACY_CATEGORY_ORDER : CATEGORY_ORDER).map((c) => (')
    // 全部 without a query: 常用元件 first, every part once
    const grid = partsSheet.sheetPartGroups(false, 'all', '').flatMap((g) => g.entries)
    expect(types(grid).slice(0, COMMON_PARTS.length)).toEqual([...COMMON_PARTS])
    expect(new Set(types(grid)).size).toBe(Object.keys(CATALOG).length)
    // classic chrome: one flat run, the original order
    expect(partsSheet.sheetPartGroups(true, 'all', '')).toEqual([{ key: 'all', entries: orderedCatalog({ legacy: true }) }])
    expect(src).not.toMatch(/export const CATEGORY_ORDER/) // one source of truth
    // the old import path still works
    expect(partsSheet.CATEGORY_ORDER).toBe(CATEGORY_ORDER)
    expect(partsSheet.orderedCatalog).toBe(orderedCatalog)
  })
})

// ---------------------------------------------------------------------------
// the desktop 元件庫 tab (LibraryPanel)
// ---------------------------------------------------------------------------

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

let storage = new MemoryStorage()

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
  __setLangForTests('zh-TW')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// server rendering reads the stores' initial state (zustand getInitialState):
// the lab was created without favorites, on the 元件庫 tab
function libraryHtml(Panel: typeof LibraryPanel = LibraryPanel): string {
  return renderToStaticMarkup(createElement(Panel, { onCollapse: () => {} }))
}
// section captions in order — a plain caption, or 常用元件's fold button title
const headers = (html: string) =>
  [...html.matchAll(/class="lg-list-header lg-caption">([^<]*)<|class="ws-lib-fold-title">([^<]*)</g)].map((m) => m[1] ?? m[2])
const labels = (html: string) => [...html.matchAll(/class="ws-part-label">([^<]*)</g)].map((m) => m[1])

describe('the desktop 元件庫 tab (LibraryPanel)', () => {
  it('opens with 常用元件, then the categories in usage order; 電阻 is the very first card', () => {
    expect(t('Common parts')).toBe('常用元件')
    expect(useLab.getInitialState().favorites).toEqual([])
    expect(useLab.getInitialState().workspace.left.tab).toBe('parts')
    const html = libraryHtml()
    const h = headers(html)
    expect(h[0]).toBe('常用元件')
    expect(h.slice(1, 4)).toEqual(['被動元件', '半導體', '開關'])
    expect(h).toHaveLength(1 + CATEGORY_ORDER.length)
    const l = labels(html)
    expect(l[0]).toBe('電阻')
    expect(l.slice(0, COMMON_PARTS.length)).toEqual(commonParts().map((e) => partLabel(e)))
    // a common part is listed again in its own category (like a favorite)
    expect(l.filter((x) => x === '電阻')).toHaveLength(2)
  })

  it('收藏 (the user’s own pins) comes before 常用元件', async () => {
    // a lab created with a starred part (its favorites load from bb.favorites)
    storage.setItem('bb.favorites', JSON.stringify(['ne555', 'resistor']))
    vi.resetModules()
    const i18n = await import('../src/i18n')
    i18n.__setLangForTests('zh-TW')
    const fresh = await import('../src/ui/workspace/LibraryPanel')
    const html = libraryHtml(fresh.LibraryPanel)
    expect(headers(html).slice(0, 3)).toEqual(['收藏', '常用元件', '被動元件'])
    // favorites in library order too: 電阻 before 555
    expect(labels(html)[0]).toBe('電阻')
  }, 30000)

  it('English with the workspace speaks English', () => {
    __setLangForTests('en')
    expect(headers(libraryHtml())[0]).toBe('Common parts')
  })
})
