/**
 * Library order — how the 元件庫 lists the catalog (owner: library).
 *
 * Usage order, the way a parts drawer on a hobby bench is sorted: the
 * everyday parts first (「常用元件」: 電阻, LED, 按鈕 …), then the categories
 * from the basics to the specialised — 被動元件 → 半導體 → 開關 → 電源 →
 * 顯示 → IC → 微控制器 → 感測器 → 模組 → 馬達 → 儀器 — and inside each
 * category the most used part first (PART_RANK: 電阻 before 電感, LED before
 * PC817). Search results rank by match quality first (rankByMatch: a name
 * that is / starts with the term, then names that contain it, then tag-only
 * hits); the usage order only breaks ties (「電阻」 → 電阻, 可變電阻,
 * 光敏電阻 …).
 *
 * A UI concern only: the catalog itself (src/model/catalog.ts) keeps its key
 * order, which the LLM prompt / schema, the support matrix and many tests
 * read. Classic chrome keeps its original order (LEGACY_CATEGORY_ORDER, then
 * catalog order) and has no 常用元件.
 *
 * Nothing is ever dropped: a part without a rank goes to the end of its
 * category, a category missing from the order to the end of the list
 * (tests/library-order.test.ts insists every part is ranked on purpose).
 *
 * Pure module (catalog only — no React / DOM): node tests and vite-node
 * scripts import it. Consumers: src/ui/workspace/LibraryPanel.tsx (the
 * desktop 元件庫 tab) and src/ui/sheets/PartsSheet.tsx (the phone sheet).
 */
import { CATALOG, getEntry, supportOf, type CatalogEntry, type ComponentCategory } from '../../model/catalog'

/** Category order of the library (product chrome): basics → supply → outputs → chips → MCU and its peripherals → instruments. */
export const CATEGORY_ORDER: ComponentCategory[] = [
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
]

/** The original order (MCU first), kept by classic chrome. */
export const LEGACY_CATEGORY_ORDER: ComponentCategory[] = [
  'mcu',
  'passive',
  'semiconductor',
  'switch',
  'display',
  'ic',
  'power',
  'sensor',
  'module',
  'motor',
  'instrument',
]

/** Usage order inside each category (most used first). Every catalog type appears exactly once, under its own category. */
export const PART_RANK: Record<ComponentCategory, readonly string[]> = {
  passive: ['resistor', 'capacitor', 'potentiometer', 'photoresistor', 'ntc_10k', 'inductor', 'crystal_hc49'],
  semiconductor: ['led', 'npn', 'diode', 'rgb_led', 'pnp', 'nmos', 'zener', 'irlz44n', 'pc817', 'pmos'],
  switch: ['pushbutton', 'slide_switch', 'relay_5v', 'toggle_switch', 'dip_switch_8'],
  power: ['power_supply', 'battery_9v', 'battery_aa2', 'lm7805', 'ams1117_33', 'function_generator', 'current_source'],
  display: [
    'buzzer',
    'seven_segment',
    'ssd1306_i2c',
    'lcd1602_i2c',
    'lcd1602',
    'ws2812b_strip8',
    'max7219_8x8',
    'tm1637_4digit',
    'lcd2004',
    'sh1106_i2c',
    'ssd1306_spi',
    'st7735',
    'ili9341',
  ],
  ic: [
    'ne555',
    'lm358',
    '74hc595',
    'cd4017',
    'cd4511',
    'sn7400',
    'sn7404',
    'sn7408',
    'sn7432',
    'sn7486',
    'sn7474',
    'cd4026',
    'sn74193',
    'cd4040',
    'at24c02',
  ],
  mcu: ['stm32_bluepill'],
  sensor: [
    'hcsr04',
    'dht11',
    'ir_receiver_vs1838b',
    'mpu6050_gy521',
    'ds18b20',
    'joystick_xy',
    'ky040_encoder',
    'dht22',
    'bmp280',
    'bh1750',
    'hall_a3144',
    'bme280',
    'voltage_sensor',
    'acs712_5a',
  ],
  module: [
    'usb_uart_ch340',
    'hc05_bt',
    'esp01',
    'sd_card_spi',
    'pcf8574_module',
    'level_shifter_4ch',
    'max485_module',
    'w25q32_flash',
    'can_tja1050',
  ],
  motor: [
    'sg90_servo',
    'dc_motor',
    'stepper_28byj48',
    'uln2003_board',
    'l298n_module',
    'a4988_driver',
    'nema17_stepper',
    'tb6612fng_module',
    'drv8833_module',
    'drv8825_driver',
    'tmc2209_driver',
  ],
  instrument: ['multimeter', 'scope_probe', 'logic_probe'],
}

/**
 * 「常用元件」 — the parts nearly every circuit starts from, listed first
 * (product chrome): general hobby usage weighted by this lab's own examples
 * (the Blue Pill and the bench supply are in most of them).
 */
export const COMMON_PARTS: readonly string[] = [
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
]

export interface LibraryOrderOptions {
  /** Classic chrome: the original order (LEGACY_CATEGORY_ORDER, then catalog order). */
  legacy?: boolean
}

/**
 * `entries` in library order: by category (CATEGORY_ORDER), then by usage
 * rank inside each (PART_RANK; unranked parts after the ranked ones, in
 * their given order). Categories missing from the order follow, sorted.
 * Legacy: LEGACY_CATEGORY_ORDER, then the given order. Never drops an entry.
 */
export function orderEntries(entries: readonly CatalogEntry[], opts: LibraryOrderOptions = {}): CatalogEntry[] {
  const cats = opts.legacy ? LEGACY_CATEGORY_ORDER : CATEGORY_ORDER
  const present = new Set(entries.map((e) => e.category))
  const order = [...cats.filter((c) => present.has(c)), ...[...present].filter((c) => !cats.includes(c)).sort()]
  return order.flatMap((c) => {
    const inCat = entries.filter((e) => e.category === c)
    if (opts.legacy) return inCat
    const rank = PART_RANK[c] ?? []
    const key = (e: CatalogEntry, i: number) => {
      const r = rank.indexOf(e.type)
      return r >= 0 ? r : rank.length + i
    }
    return inCat
      .map((e, i) => ({ e, k: key(e, i) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.e)
  })
}

/** Every catalog entry in library order. */
export function orderedCatalog(opts: LibraryOrderOptions = {}): CatalogEntry[] {
  return orderEntries(Object.values(CATALOG), opts)
}

/** The 「常用元件」 entries (COMMON_PARTS order; a missing or in-development type is skipped). */
export function commonParts(): CatalogEntry[] {
  return COMMON_PARTS.map((type) => getEntry(type)).filter(
    (e): e is CatalogEntry => e !== undefined && supportOf(e).level !== 'dev',
  )
}

/**
 * `entries` with the 「常用元件」 among them moved to the front (COMMON_PARTS
 * order), the rest as given — the phone sheet's flat 「全部」 grid: it has
 * no section headers, so each part is listed once.
 */
export function commonFirst(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const have = new Set(entries.map((e) => e.type))
  const common = commonParts().filter((e) => have.has(e.type))
  const first = new Set(common.map((e) => e.type))
  return [...common, ...entries.filter((e) => !first.has(e.type))]
}

/** One run of the phone sheet's grid: 'common' (「常用元件」), a category, or 'all' — the list as it is, without a header. */
export interface SheetGroup {
  key: 'common' | 'all' | ComponentCategory
  entries: CatalogEntry[]
}

/**
 * The phone sheet's 「全部」 grid (no query): 「常用元件」 first, then the
 * rest under their category names, in list order — each part listed once
 * (commonFirst), so a category whose every part is common (微控制器: the
 * Blue Pill) has no run of its own. The labels tell where the everyday
 * parts end.
 */
export function sheetGroups(entries: readonly CatalogEntry[]): SheetGroup[] {
  const list = commonFirst(entries)
  const n = commonParts().filter((e) => entries.some((x) => x.type === e.type)).length
  const groups: SheetGroup[] = n > 0 ? [{ key: 'common', entries: list.slice(0, n) }] : []
  for (const e of list.slice(n)) {
    const last = groups[groups.length - 1]
    if (last && last.key === e.category) last.entries.push(e)
    else groups.push({ key: e.category, entries: [e] })
  }
  return groups
}

/** The distinct categories of an ordered list, in list order (the library's sections / filter values). */
export function libraryCategories(entries: readonly CatalogEntry[]): ComponentCategory[] {
  return [...new Set(entries.map((e) => e.category))]
}

// ---------------------------------------------------------------------------
// Search ranking — match quality first, usage order only breaks ties
// ---------------------------------------------------------------------------

/**
 * What a part is searched by. `names`: the name in the UI language, the
 * English name, the type key and the part number. `tags`: the search tags,
 * the maker and the category name(s). The caller builds them (the
 * localised texts live in the i18n layer, not in this pure module).
 */
export interface PartSearchFields {
  names: readonly string[]
  tags: readonly string[]
}

/**
 * Match tiers of one search term, best first: a name IS the term → a name
 * (or a word of it) starts with the term → a name contains it → a tag IS
 * the term → a tag contains it. NO_MATCH: none of the fields has it (the
 * caller's filter may still have kept the part — it then sorts last).
 */
export const MATCH_TIER = { exact: 0, prefix: 1, contains: 2, tag: 3, tagContains: 4 } as const
export const NO_MATCH = 5

/** Case- and width-folded text: 「ＬＥＤ」 = 「led」, 「I²C」 = 「i2c」, 「（」 = 「(」. */
function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

/** The words of a name: anything but letters and digits separates them (a Chinese run stays one word). */
function words(s: string): string[] {
  return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** The tier of one (folded) term against the (folded) fields. */
function termTier(term: string, names: readonly string[], tags: readonly string[]): number {
  let best: number = NO_MATCH
  for (const n of names) {
    if (n === term) return MATCH_TIER.exact
    if (n.startsWith(term) || words(n).some((w) => w.startsWith(term))) best = Math.min(best, MATCH_TIER.prefix)
    else if (n.includes(term)) best = Math.min(best, MATCH_TIER.contains)
  }
  if (best !== NO_MATCH) return best
  for (const tag of tags) {
    if (tag === term) return MATCH_TIER.tag
    if (tag.includes(term)) best = Math.min(best, MATCH_TIER.tagContains)
  }
  return best
}

/**
 * How well a part's fields match `query`: per whitespace-separated term its
 * tier (MATCH_TIER), then `[worst term, sum of terms]` — lower is better.
 * An empty query is `[0, 0]`.
 */
export function matchQuality(fields: PartSearchFields, query: string): [number, number] {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [0, 0]
  const names = fields.names.filter(Boolean).map(fold)
  const tags = fields.tags.filter(Boolean).map(fold)
  let worst = 0
  let sum = 0
  for (const term of terms) {
    const tier = termTier(term, names, tags)
    worst = Math.max(worst, tier)
    sum += tier
  }
  return [worst, sum]
}

/**
 * Search results ranked by match quality first — 「LED」: 發光二極體 LED
 * (the name), then the parts with LED in their name (RGB LED, WS2812B,
 * LED 點矩陣), then the names that merely contain it (OLED), then tag-only
 * hits (TM1637, IRLZ44N, 實驗室電流源); `entries`' own order (the usage
 * order) only breaks ties. Filters nothing: the caller has filtered.
 */
export function rankByMatch(
  entries: readonly CatalogEntry[],
  query: string,
  fields: (e: CatalogEntry) => PartSearchFields,
): CatalogEntry[] {
  if (query.trim() === '') return [...entries]
  return entries
    .map((e, i) => ({ e, i, q: matchQuality(fields(e), query) }))
    .sort((a, b) => a.q[0] - b.q[0] || a.q[1] - b.q[1] || a.i - b.i)
    .map((x) => x.e)
}

// ---------------------------------------------------------------------------
// The armed card — one copy only
// ---------------------------------------------------------------------------

/** Which card copy the learner last armed: the part type and the section key it was clicked in. */
export interface ArmedCopy {
  type: string
  section: string
}

/**
 * The one section whose copy of the armed part shows 「放置中」 and the
 * armed hint (a part can be listed in 收藏, 常用元件 and its category): the
 * copy the learner clicked (`clicked`), while that section still lists it;
 * else the first copy in `sections` (the rendered sections, in order — a
 * part armed elsewhere, e.g. by a lesson, or 常用元件 folded away). null
 * when nothing is armed or no rendered section lists it.
 */
export function armedSection(
  sections: readonly { key: string; entries: readonly { type: string }[] }[],
  armedType: string | null,
  clicked: ArmedCopy | null,
): string | null {
  if (armedType === null) return null
  const lists = (s: { entries: readonly { type: string }[] }) => s.entries.some((e) => e.type === armedType)
  if (clicked && clicked.type === armedType) {
    const own = sections.find((s) => s.key === clicked.section)
    if (own && lists(own)) return own.key
  }
  return sections.find(lists)?.key ?? null
}
