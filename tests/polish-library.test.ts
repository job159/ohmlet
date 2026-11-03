/**
 * 元件庫 polish (round 5, stream "library") — the verifier's notes on the
 * usage-ordered library:
 *  (a) a part armed from a card shows 「放置中」 and the armed hint on ONE
 *      copy (the one clicked, else the first shown), and the spec-card ids
 *      are unique per copy;
 *  (b) the phone sheet's 「全部」 grid labels its runs: 「常用元件」, then the
 *      category names — the learner sees where the everyday parts end;
 *  (c) search ranks by match quality first (a name before a tag), the usage
 *      order only breaks ties: 「LED」 → 發光二極體 LED, the LED modules,
 *      the OLEDs, then the tag-only hits;
 *  (e) the desktop 「常用元件」 folds (a disclosure button), remembered in
 *      localStorage, open by default.
 * (d) — scripts/ui-shots.mjs — is checked at the end.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, getEntry, type CatalogEntry } from '../src/model/catalog'
import { __setLangForTests, t } from '../src/i18n'
import {
  CATEGORY_ORDER,
  COMMON_PARTS,
  MATCH_TIER,
  NO_MATCH,
  armedSection,
  matchQuality,
  orderedCatalog,
  rankByMatch,
  sheetGroups,
} from '../src/ui/workspace/library-order'
import { PartsView, partMatches, partSearchFields, sheetPartGroups } from '../src/ui/sheets/PartsSheet'
import { LS_COMMON_FOLDED, LibraryPanel, readCommonFolded, writeCommonFolded } from '../src/ui/workspace/LibraryPanel'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const types = (list: readonly CatalogEntry[]) => list.map((e) => e.type)

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

/** The library with `type` armed (store mode 'place'), as the learner sees it. */
function libraryWithArmed(type: string | null): string {
  const before = useStore.getState().mode
  useStore.setState({ mode: type ? { kind: 'place', type, pickedHoles: [] } : { kind: 'select' } })
  try {
    return renderLive(createElement(LibraryPanel, { onCollapse: () => {} }))
  } finally {
    useStore.setState({ mode: before })
  }
}

const count = (html: string, needle: string) => html.split(needle).length - 1
/** The <section> blocks of the library, by aria-label. */
const sectionsOf = (html: string) =>
  html
    .split('<section ')
    .slice(1)
    .map((s) => ({ label: /aria-label="([^"]*)"/.exec(s)?.[1] ?? '', html: s }))

// ---------------------------------------------------------------------------
// (a) one armed copy
// ---------------------------------------------------------------------------

describe('(a) an armed part shows 「放置中」 on one card copy only', () => {
  const r = { type: 'resistor' }
  const l = { type: 'led' }
  const secs = [
    { key: 'fav', entries: [r] },
    { key: 'common', entries: [r, l] },
    { key: 'passive', entries: [r] },
  ]

  it('armedSection: the copy clicked, else the first copy shown', () => {
    expect(armedSection(secs, null, null)).toBeNull()
    // armed elsewhere (a lesson, a shortcut): the first copy
    expect(armedSection(secs, 'resistor', null)).toBe('fav')
    // the copy the learner clicked
    expect(armedSection(secs, 'resistor', { type: 'resistor', section: 'passive' })).toBe('passive')
    expect(armedSection(secs, 'resistor', { type: 'resistor', section: 'common' })).toBe('common')
    // a click on another part is stale for this one
    expect(armedSection(secs, 'resistor', { type: 'led', section: 'common' })).toBe('fav')
    // the clicked section is folded away / filtered out: the first copy still shown
    const folded = secs.filter((s) => s.key !== 'common')
    expect(armedSection(folded, 'resistor', { type: 'resistor', section: 'common' })).toBe('fav')
    expect(armedSection(folded, 'led', { type: 'led', section: 'common' })).toBeNull()
  })

  it('the desktop library: one 「放置中」, one armed hint, on the first copy (常用元件)', () => {
    const html = libraryWithArmed('resistor')
    expect(count(html, 'ws-part-armed-hint')).toBe(1)
    expect(count(html, `>${t('Placing')}<`)).toBe(1)
    expect(count(html, 'aria-pressed="true"')).toBe(1)
    const armedIn = sectionsOf(html).filter((s) => s.html.includes('ws-part-armed-hint'))
    expect(armedIn.map((s) => s.label)).toEqual(['常用元件'])
    // the other copy (被動元件) is a plain card: click to place
    const passive = sectionsOf(html).find((s) => s.label === '被動元件')!
    expect(passive.html).toContain('電阻')
    expect(passive.html).not.toContain('is-armed')
  })

  it('with 常用元件 folded the hint moves to the copy still shown', () => {
    storage.setItem(LS_COMMON_FOLDED, '1')
    const html = libraryWithArmed('resistor')
    expect(count(html, 'ws-part-armed-hint')).toBe(1)
    expect(sectionsOf(html).filter((s) => s.html.includes('ws-part-armed-hint')).map((s) => s.label)).toEqual(['被動元件'])
  })

  it('every copy has its own details id (aria-controls never shared)', () => {
    const html = libraryWithArmed(null)
    const controls = [...html.matchAll(/aria-controls="([^"]*)"/g)].map((m) => m[1])
    expect(controls.length).toBeGreaterThan(CATEGORY_ORDER.length)
    expect(new Set(controls).size).toBe(controls.length)
    // the Blue Pill (常用元件 + 微控制器): two distinct ids
    expect(controls.filter((c) => c.endsWith('-stm32_bluepill'))).toEqual([
      'ws-part-common-stm32_bluepill',
      'ws-part-mcu-stm32_bluepill',
    ])
  })

  it('a click on another copy of the armed part keeps placing and moves the state there', () => {
    const src = read('src/ui/workspace/LibraryPanel.tsx')
    expect(src).toContain("if (armedType === entry.type && armedKey === section) setMode({ kind: 'select' })")
    expect(src).toContain('setArmedAt({ type: entry.type, section })')
    expect(src).toContain('armed={armedType === entry.type && armedKey === sec.key}')
    // a drag arms the copy dragged
    expect(src).toContain('dragToPlace(e, entry, () => setArmedAt({ type: entry.type, section: sec.key }))')
  })

  it('placement over: the clicked copy is forgotten, so a later arm from a lesson or a shortcut shows on the first copy (integration)', () => {
    const src = read('src/ui/workspace/LibraryPanel.tsx')
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(armedType === null\) setArmedAt\(null\)\s*\}, \[armedType\]\)/)
    // with nothing remembered the pure rule picks the first copy shown
    expect(armedSection(secs, 'resistor', null)).toBe('fav')
  })
})

// ---------------------------------------------------------------------------
// (b) phone 全部: labelled runs
// ---------------------------------------------------------------------------

const sheetHtml = (legacy: boolean, cat: 'all' | 'passive', query: string) =>
  renderToStaticMarkup(
    createElement(PartsView, {
      armedEntry: undefined,
      query,
      setQuery: () => {},
      cat,
      setCat: () => {},
      groups: sheetPartGroups(legacy, cat, query),
      armedType: null,
      legacy,
      onSearchFocus: () => {},
      onCard: () => {},
    }),
  )
const captions = (html: string) => [...html.matchAll(/class="lg-list-header lg-caption">([^<]*)</g)].map((m) => m[1])
const cardLabels = (html: string) => [...html.matchAll(/class="psh-card-label">([^<]*)</g)].map((m) => m[1])

describe('(b) the phone sheet’s 「全部」 labels where the everyday parts end', () => {
  it('sheetGroups: 常用元件 (the ten), then the rest by category, every part once', () => {
    const groups = sheetGroups(orderedCatalog())
    expect(groups[0].key).toBe('common')
    expect(types(groups[0].entries)).toEqual([...COMMON_PARTS])
    // the categories in library order; 微控制器 has no run (its only part is common)
    expect(groups.slice(1).map((g) => g.key)).toEqual(CATEGORY_ORDER.filter((c) => c !== 'mcu'))
    const all = groups.flatMap((g) => types(g.entries))
    expect(all).toHaveLength(Object.keys(CATALOG).length)
    expect(new Set(all).size).toBe(all.length)
    for (const g of groups.slice(1)) for (const e of g.entries) expect(e.category).toBe(g.key)
  })

  it('the grid: a 「常用元件」 label over the first ten cards, the category names after them', () => {
    const html = sheetHtml(false, 'all', '')
    const caps = captions(html)
    expect(caps[0]).toBe('常用元件')
    expect(caps.slice(1, 4)).toEqual(['被動元件', '半導體', '開關'])
    const sec = sectionsOf(html)
    expect(sec[0].label).toBe('常用元件')
    expect(cardLabels(sec[0].html)).toHaveLength(COMMON_PARTS.length)
    expect(cardLabels(sec[0].html)[0]).toBe('電阻')
    expect(cardLabels(sec[1].html)[0]).toBe('光敏電阻（LDR）')
    // each card once
    const labels = cardLabels(html)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('the run captions carry their own padding in PartsSheet.css (not only via workspace.css)', () => {
    const css = read('src/ui/sheets/PartsSheet.css')
    expect(css).toMatch(/\.psh-group > \.lg-list-header \{\s*padding: 6px 6px 7px;\s*\}/)
  })

  it('no labels on a filtered grid, nor in classic chrome (its flat grid is unchanged)', () => {
    expect(captions(sheetHtml(false, 'passive', ''))).toEqual([])
    expect(captions(sheetHtml(false, 'all', 'led'))).toEqual([])
    __setLangForTests('en')
    const classic = sheetHtml(true, 'all', '')
    expect(captions(classic)).toEqual([])
    expect(count(classic, 'class="psh-grid"')).toBe(1)
    expect(classic).not.toContain('<section')
    expect(cardLabels(classic)[0]).toBe('STM32F103C8T6 Blue Pill')
  })
})

// ---------------------------------------------------------------------------
// (c) search ranking
// ---------------------------------------------------------------------------

const search = (q: string) => types(sheetPartGroups(false, 'all', q).flatMap((g) => g.entries))

describe('(c) search: match quality first, usage order breaks ties', () => {
  it('「LED」: the LED, the parts named LED, the OLEDs, then the tag-only hits', () => {
    expect(search('LED')).toEqual([
      'led', // 發光二極體 LED (its name)
      'rgb_led', // RGB LED
      'ws2812b_strip8', // WS2812B RGB LED 燈條
      'max7219_8x8', // MAX7219 8×8 LED 點矩陣模組
      'ssd1306_i2c', // OLED … (a name that contains it)
      'sh1106_i2c',
      'ssd1306_spi',
      'tm1637_4digit', // tag 'led'
      'irlz44n', // tag 'led strip'
      'current_source', // tag 'led test'
      '74hc595', // tag 'led driver'
    ])
    // lower case ranks the same
    expect(search('led')).toEqual(search('LED'))
  })

  it('「電阻」「按鈕」「OLED」: the exact name first', () => {
    expect(search('電阻')).toEqual(['resistor', 'potentiometer', 'photoresistor', 'ntc_10k'])
    expect(search('按鈕')).toEqual(['pushbutton'])
    expect(search('OLED')).toEqual(['ssd1306_i2c', 'sh1106_i2c', 'ssd1306_spi'])
  })

  it('「馬達」: the parts named 馬達 before the ones only in the 馬達 category', () => {
    const res = search('馬達')
    const named = res.filter((type) => getEntry(type) && /馬達/.test(labelOf(type)))
    expect(res.slice(0, named.length)).toEqual(named)
    expect(res.slice(named.length)).toEqual(['sg90_servo', 'l298n_module'])
    expect(res[0]).toBe('dc_motor')
  })

  it('「感測」: names with 感測 before the category-only sensors', () => {
    const res = search('感測')
    const named = res.filter((type) => /感測/.test(labelOf(type)))
    expect(named.length).toBeGreaterThan(5)
    expect(res.slice(0, named.length)).toEqual(named)
    expect(res).toContain('dht11') // still found (its category)
    expect(res.indexOf('dht11')).toBeGreaterThan(res.indexOf('acs712_5a'))
  })

  it('matchQuality tiers', () => {
    const f = (names: string[], tags: string[] = []) => ({ names, tags })
    expect(matchQuality(f(['LED']), 'led')[0]).toBe(MATCH_TIER.exact)
    expect(matchQuality(f(['RGB LED（5 mm）']), 'led')[0]).toBe(MATCH_TIER.prefix)
    expect(matchQuality(f(['OLED 0.96"']), 'led')[0]).toBe(MATCH_TIER.contains)
    expect(matchQuality(f(['TM1637'], ['led']), 'led')[0]).toBe(MATCH_TIER.tag)
    expect(matchQuality(f(['IRLZ44N'], ['led strip']), 'led')[0]).toBe(MATCH_TIER.tagContains)
    expect(matchQuality(f(['X']), 'led')[0]).toBe(NO_MATCH)
    // width / compatibility folded (NFKC): I²C in a name is i2c, ＬＥＤ is led
    expect(matchQuality(f(['OLED 0.96" 128×64 I²C']), 'i2c')[0]).toBe(MATCH_TIER.prefix)
    expect(matchQuality(f(['LED']), 'ＬＥＤ')[0]).toBe(MATCH_TIER.exact)
    // every term counts: the worst one first, then the sum
    expect(matchQuality(f(['STM32F103C8T6 Blue Pill']), 'blue pill')).toEqual([MATCH_TIER.prefix, 2 * MATCH_TIER.prefix])
    expect(matchQuality(f(['anything']), '  ')).toEqual([0, 0])
  })

  it('rankByMatch keeps the given (usage) order inside a tier and filters nothing', () => {
    const list = orderedCatalog()
    const ranked = rankByMatch(list, 'zzz-no-such', (e) => partSearchFields(e))
    expect(types(ranked)).toEqual(types(list))
    expect(types(rankByMatch(list, '', (e) => partSearchFields(e)))).toEqual(types(list))
  })

  it('English ranks the same way', () => {
    __setLangForTests('en')
    const res = search('led')
    expect(res.slice(0, 4)).toEqual(['led', 'rgb_led', 'ws2812b_strip8', 'max7219_8x8'])
    expect(res.indexOf('ssd1306_i2c')).toBeLessThan(res.indexOf('irlz44n'))
  })

  it('the desktop 元件庫 ranks its results the same way (classic chrome’s sheet does not rank)', () => {
    const src = read('src/ui/workspace/LibraryPanel.tsx')
    expect(src).toContain('const filtered = rankByMatch(matching, query, (e) => partSearchFields(e, [categoryName(e.category)]))')
    // classic chrome: the original order, filtered — no ranking
    expect(types(sheetPartGroups(true, 'all', 'led')[0].entries)).toEqual(
      types(orderedCatalog({ legacy: true }).filter((e) => partMatches(e, 'led'))),
    )
  })
})

function labelOf(type: string): string {
  const e = getEntry(type)!
  return partSearchFields(e).names[0]
}

// ---------------------------------------------------------------------------
// (e) 常用元件 folds
// ---------------------------------------------------------------------------

describe('(e) the desktop 「常用元件」 folds, remembered per browser', () => {
  const foldButton = (html: string) => /<button type="button" class="lg-list-header lg-caption ws-lib-fold"[^>]*>/.exec(html)?.[0] ?? ''

  it('open by default: a disclosure button over the ten cards', () => {
    expect(readCommonFolded()).toBe(false)
    const html = libraryWithArmed(null)
    const btn = foldButton(html)
    expect(btn).toContain('aria-expanded="true"')
    expect(btn).toContain('aria-controls="ws-lib-list-common"')
    expect(btn).toContain(`title="${t('Fold the common parts')}"`)
    expect(html).toContain('id="ws-lib-list-common"')
    expect(count(html, '>電阻<')).toBe(2)
  })

  it('folded (localStorage): the caption stays, the cards go — 電阻 is listed once', () => {
    storage.setItem(LS_COMMON_FOLDED, '1')
    expect(readCommonFolded()).toBe(true)
    const html = libraryWithArmed(null)
    const btn = foldButton(html)
    expect(btn).toContain('aria-expanded="false"')
    expect(btn).not.toContain('aria-controls')
    expect(btn).toContain(`title="${t('Show the common parts')}"`)
    expect(html).not.toContain('id="ws-lib-list-common"')
    expect(html).toContain('常用元件</span><span class="ws-lib-fold-count">10 個元件</span>')
    expect(count(html, '>電阻<')).toBe(1)
  })

  it('writeCommonFolded remembers, unfolding forgets; storage failures are harmless', () => {
    writeCommonFolded(true)
    expect(storage.getItem(LS_COMMON_FOLDED)).toBe('1')
    writeCommonFolded(false)
    expect(storage.getItem(LS_COMMON_FOLDED)).toBeNull()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('window', { localStorage: broken })
    expect(readCommonFolded()).toBe(false)
    expect(() => writeCommonFolded(true)).not.toThrow()
  })

  it('zh-TW texts', () => {
    expect(t('Fold the common parts')).toBe('收合常用元件')
    expect(t('Show the common parts')).toBe('展開常用元件')
  })
})

// ---------------------------------------------------------------------------
// (d) scripts/ui-shots.mjs
// ---------------------------------------------------------------------------

describe('(d) scripts/ui-shots.mjs survives the duplicated cards and the zh-TW UI', () => {
  const src = read('scripts/ui-shots.mjs')

  it('the Blue Pill details button is picked once (.first()), by its name in the page language', () => {
    expect(src).not.toMatch(/name: \/Show STM32F103C8T6 Blue Pill details\/ \}\)\.click\(\)/)
    expect(src).toMatch(/Show \{part\} details[\s\S]{0,200}\.first\(\)\.click\(\)/)
    expect(src).toMatch(/Hide \{part\} details[\s\S]{0,200}\.first\(\)\.click\(\)/)
  })

  it('pins the UI language and resolves English sources through the app’s own t()', () => {
    expect(src).toContain("localStorage.setItem('bb.lang'")
    expect(src).toContain("/src/i18n/index.ts")
    // no bare English accessible names left
    expect(src).not.toContain("{ name: 'Search the component library' }")
    expect(src).not.toContain("getByRole('radio', { name: 'Examples' })")
    expect(src).not.toContain(".getByText('More')")
  })
})
