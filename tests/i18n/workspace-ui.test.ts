/**
 * zh-TW coverage for the desktop workspace, the embedded-lab panels and the
 * instrument views (src/ui/workspace, src/ui/embedded,
 * src/ui/embedded/instruments, and the scope view part of
 * src/ui/sheets/ScopeSheet.tsx): every English source those files hand to
 * t() / tc() has a Traditional Chinese entry, the data-driven sources
 * (library categories, MCU states, peripheral statuses, ERC rule titles and
 * level semantics, decoder roles / parameters / options, catalog pin notes,
 * lower-case pin names, descriptive part numbers) are covered, the display
 * helpers in src/ui/embedded/text.ts localize in zh-TW and pass English
 * through untouched, and the three dictionaries stay Taiwan-usage
 * Traditional Chinese with intact placeholders.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { isValidElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../../src/i18n'
import workspace from '../../src/i18n/zh-TW/workspace'
import embedded from '../../src/i18n/zh-TW/embedded'
import instruments from '../../src/i18n/zh-TW/instruments'
import catalogText from '../../src/i18n/zh-TW/catalog-text'
import { CATALOG } from '../../src/model/catalog'
import { ERC_RULES } from '../../src/sim/erc/api'
import { DECODERS } from '../../src/instruments/decoders'
import { MCU_STATE_META } from '../../src/ui/embedded/format'
import {
  decoderInfoText,
  firmwareDescriptionText,
  logSourceText,
  pinFunctionText,
  pinModeLabel,
  pinNameText,
  placementText,
  tc,
  tNodes,
  tText,
} from '../../src/ui/embedded/text'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const dir = (rel: string) =>
  readdirSync(path.join(ROOT, rel))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${rel}/${f}`)

const OWNED = [...dir('src/ui/workspace'), ...dir('src/ui/embedded'), ...dir('src/ui/embedded/instruments')]
const CJK = /[\u4e00-\u9fff]/

function zhHas(key: string): boolean {
  __setLangForTests('zh-TW')
  return hasTranslation(key)
}

/** Literal t('…') / tc('…', '…') keys (string literals only). */
function literalKeys(src: string): string[] {
  const re = /\b(t|tc)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push(m[1] === 'tc' && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

/** String values of a `const NAME … = { … }` record. */
function recordValues(src: string, name: string): string[] {
  const start = src.indexOf(`const ${name}`)
  expect(start, `const ${name} not found`).toBeGreaterThanOrEqual(0)
  const body = src.slice(src.indexOf('{', src.indexOf('= ', start)), src.indexOf('}', src.indexOf('= ', start)) + 1)
  return [...body.matchAll(/:\s*'((?:\\.|[^'])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
}

describe('workspace / embedded / instruments zh-TW coverage', () => {
  it('every literal t()/tc() source in the owned files has a zh-TW entry', () => {
    const files = [...OWNED.map((f) => [f, read(f)] as const)]
    // ScopeSheet.tsx: the scope instrument view (ScopeView, ScopeCanvas, MeasRow) is ours
    const scope = read('src/ui/sheets/ScopeSheet.tsx')
    files.push(['src/ui/sheets/ScopeSheet.tsx', scope.slice(scope.indexOf('export function ScopeView'))])
    const missing: string[] = []
    let n = 0
    for (const [f, src] of files) {
      for (const k of literalKeys(src)) {
        n++
        if (!zhHas(k)) missing.push(`${f}: ${JSON.stringify(k)}`)
      }
    }
    expect(n).toBeGreaterThan(250)
    expect(missing).toEqual([])
  })

  it('table-driven labels are covered (categories, MCU states, peripheral statuses, ERC rules)', () => {
    const categories = recordValues(read('src/ui/workspace/LibraryPanel.tsx'), 'CATEGORY_NAMES')
    expect(categories.length).toBeGreaterThanOrEqual(10)
    const statuses = recordValues(read('src/ui/embedded/McuPanel.tsx'), 'STATUS_LABEL')
    expect(statuses.length).toBe(3)
    const keys = [
      ...categories.map((c) => `${c}|category`),
      ...Object.values(MCU_STATE_META).map((m) => `${m.label}|mcu-state`),
      ...statuses.map((s) => `${s}|peripheral`),
      ...ERC_RULES.map((r) => r.title),
    ]
    expect(keys.filter((k) => !zhHas(k))).toEqual([])
    // the rule tooltips: what each level means for each rule
    __setLangForTests('zh-TW')
    const semantics = ERC_RULES.flatMap((r) => Object.values(r.levels))
    expect(semantics.length).toBeGreaterThan(15)
    expect(semantics.filter((s) => !CJK.test(tText(s)))).toEqual([])
  })

  it('protocol decoders: roles, parameters, options, descriptions and lanes are covered', () => {
    __setLangForTests('zh-TW')
    const words: string[] = []
    for (const d of DECODERS) {
      expect(CJK.test(t(d.description)), d.description).toBe(true)
      for (const r of d.roles) words.push(r.label)
      for (const p of d.params) {
        words.push(p.label)
        for (const o of p.options) words.push(o.label)
      }
    }
    // lane names declared in the decoder sources (annotation rows)
    for (const f of dir('src/instruments/decoders')) {
      for (const m of read(f).matchAll(/label: '([^']+)'/g)) words.push(m[1])
    }
    // pure signal / protocol names (SDA, MISO, I²C, 1-Wire, 9600) stay as they are
    const needs = [...new Set(words)].filter((w) => /[a-z]{3}/.test(w) && !/^\d/.test(w))
    expect(needs.length).toBeGreaterThan(20)
    expect(needs.filter((w) => !hasTranslation(`${w}|decoder`))).toEqual([])
  })

  it('catalog pin texts: notes, lower-case pin names and remap functions are localized', () => {
    __setLangForTests('zh-TW')
    const notes = new Set<string>()
    const pins = new Set<string>()
    const remaps = new Set<string>()
    for (const e of Object.values(CATALOG)) {
      for (const p of e.pins) if (/^[a-z]{2,}$/.test(p)) pins.add(p)
      for (const pi of e.pinInfo ?? []) {
        if (pi.note) notes.add(pi.note)
        if (pi.label && /^[a-z]{2,}$/.test(pi.label)) pins.add(pi.label)
        for (const f of pi.functions ?? []) if (f.endsWith(' (remap)')) remaps.add(f)
      }
    }
    expect(notes.size).toBeGreaterThan(50)
    // purely numeric notes ("2 – 6 V.") need no translation
    const worded = [...notes].filter((n) => /[A-Za-z]{3}/.test(n))
    expect(worded.filter((n) => !CJK.test(tText(n)))).toEqual([])
    expect([...pins].filter((p) => !/[\u4e00-\u9fff]|^GND$/.test(pinNameText(p)))).toEqual([])
    for (const f of remaps) expect(pinFunctionText(f)).toBe(`${f.slice(0, -8)}（重映射）`)
    // technical pin names are left alone
    expect(pinNameText('PA5')).toBe('PA5')
    expect(pinNameText('VCC')).toBe('VCC')
    expect(pinNameText('a')).toBe('a')
  })

  it('descriptive part numbers / manufacturers (common English words) are translated', () => {
    __setLangForTests('zh-TW')
    const common =
      /\b(module|generic|board|breakout|carrier|strip|backpack|holder|alkaline|toggle|class|controller|driver|detection|matrix|digit|display|diffused|converter|compatible|design|chip|bus|expansion)\b/
    const texts = new Set<string>()
    for (const e of Object.values(CATALOG)) {
      for (const s of [e.meta?.partNumber, e.meta?.manufacturer]) if (s && common.test(s)) texts.add(s)
    }
    expect(texts.size).toBeGreaterThan(20)
    expect([...texts].filter((s) => !CJK.test(tText(s)))).toEqual([])
  })

  it('display helpers: Chinese in zh-TW, the original English in en', () => {
    __setLangForTests('zh-TW')
    expect(decoderInfoText('auto: 9600 Bd')).toBe('自動：9600 Bd')
    expect(decoderInfoText('auto: 9600 Bd (measured 9615 Bd)')).toBe('自動：9600 Bd（實測 9615 Bd）')
    expect(firmwareDescriptionText('raw binary, 1024 bytes at 0x08000000')).toBe('原始二進位檔，1024 位元組，位於 0x08000000')
    const elf = firmwareDescriptionText('ELF32 ARM, EABI5, soft-float, Thumb entry 0x08002375')
    expect(elf).toMatch(CJK)
    expect(elf).toContain('0x08002375')
    expect(logSourceText('sim')).toBe('模擬器')
    expect(logSourceText('U1/loader')).toBe('U1/載入器')
    expect(logSourceText('U1/USART1')).toBe('U1/USART1')
    expect(pinModeLabel('af-od')).toBe('複用開汲極')
    expect(tc('Partial', 'peripheral')).toBe('部分')
    expect(t('Partial')).toBe('部分模擬')
    expect(t('{n} parts', { n: 3 })).toBe('3 個元件')
    const resistor = Object.values(CATALOG).find((e) => e.placement === 'leads')!
    expect(placementText(resistor)).toMatch(CJK)
    const nodes = tNodes('tests: {list}', { list: 'hal-blink' })
    expect(nodes.join('')).toContain('測試')
    expect(nodes.some((n) => isValidElement(n))).toBe(true)

    __setLangForTests('en')
    expect(decoderInfoText('auto: 9600 Bd')).toBe('auto: 9600 Bd')
    expect(firmwareDescriptionText('raw binary, 1024 bytes at 0x08000000')).toBe('raw binary, 1024 bytes at 0x08000000')
    expect(logSourceText('U1/loader')).toBe('U1/loader')
    expect(pinNameText('anode')).toBe('anode')
    expect(pinFunctionText('USART1_TX (remap)')).toBe('USART1_TX (remap)')
    expect(pinModeLabel('af-od')).toBe('af-od')
    expect(tc('Partial', 'peripheral')).toBe('Partial')
    expect(t('Electrical rules')).toBe('Electrical rules')
    expect(placementText(resistor)).toBe(`${resistor.pins.length} leads`)
  })

  it('dictionaries are Traditional Chinese with Taiwan terminology and intact placeholders', () => {
    const mine: Record<string, string> = { ...workspace, ...embedded, ...instruments, ...catalogText }
    const simplified = /[这们个为时电线键设计载导连显图关开择复读误辑头动发现换组态网络数据]/
    const mainland = /程序|文件|界面|信息|内存|默认|软件|硬件|视频|鼠标|屏幕|项目|优化|支持/
    expect(Object.entries(mine).filter(([, v]) => simplified.test(v) || mainland.test(v))).toEqual([])
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    expect(Object.entries(mine).filter(([k, v]) => ph(k) !== ph(v))).toEqual([])
    // no key defined twice across these four files
    const all = [workspace, embedded, instruments, catalogText].flatMap((d) => Object.keys(d))
    expect(all.length).toBe(new Set(all).size)
  })
})
