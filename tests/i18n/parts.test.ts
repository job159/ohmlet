/**
 * zh-TW part texts: EVERY live catalog type (src/model/catalog.ts + every
 * src/model/parts/*.parts.ts) must have a Traditional Chinese entry
 * (src/i18n/zh-TW/parts-*.ts), complete enough that the library card and
 * the inspector never mix languages: label, doc, specs / simulated / limits
 * with the catalog's item counts, every param label and every word-valued
 * select option. A new part fails here until its translation exists.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../../src/i18n'
import {
  missingPartTranslations,
  partDoc,
  partLabel,
  partOptionLabel,
  partParamLabel,
  partSpecs,
  partSupport,
  partTranslation,
} from '../../src/i18n/parts'
import { CATALOG, supportOf } from '../../src/model/catalog'
import type { CatalogEntry } from '../../src/model/catalog'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './zh-check'

afterEach(() => __setLangForTests('zh-TW'))

const ENTRIES: CatalogEntry[] = Object.values(CATALOG)
const CJK = /[一-鿿]/

/** Technical tokens a part's own texts may keep: its pin names, pin labels and option values. */
function partTokens(e: CatalogEntry): string[] {
  const out = new Set<string>()
  const add = (s?: string) => {
    for (const t of (s ?? '').split(/[^A-Za-z0-9_]+/)) if (t) out.add(t)
  }
  for (const p of e.pins) add(p)
  for (const p of e.pinInfo ?? []) {
    add(p.pin)
    add(p.label)
    for (const f of p.functions ?? []) add(f)
  }
  add(e.meta?.partNumber)
  for (const p of e.params ?? []) for (const o of p.options ?? []) add(o)
  return [...out]
}

function allTexts(type: string): string[] {
  const z = partTranslation(type)
  if (!z) return []
  return [
    z.label,
    z.doc,
    ...(z.specs ?? []),
    ...(z.simulated ?? []),
    ...(z.limits ?? []),
    ...Object.values(z.params ?? {}),
    ...Object.values(z.options ?? {}).flatMap((o) => Object.values(o)),
  ]
}

describe('zh-TW part texts', () => {
  it('every catalog type has a zh-TW entry', () => {
    expect(ENTRIES.length).toBeGreaterThan(40)
    expect(missingPartTranslations(ENTRIES.map((e) => e.type))).toEqual([])
  })

  it('label and doc are translated (doc in Chinese)', () => {
    const bad: string[] = []
    for (const e of ENTRIES) {
      const z = partTranslation(e.type)
      if (!z) continue
      if (!z.label.trim()) bad.push(`${e.type}: empty label`)
      if (!CJK.test(z.doc)) bad.push(`${e.type}: doc is not Chinese`)
    }
    expect(bad).toEqual([])
  })

  it('specs / simulated / limits are complete and in catalog order (same item counts)', () => {
    const bad: string[] = []
    for (const e of ENTRIES) {
      const z = partTranslation(e.type)
      if (!z) continue
      const s = supportOf(e)
      const check = (what: string, en: string[] | undefined, zh: string[] | undefined) => {
        if (!en || en.length === 0) return
        if (!zh) bad.push(`${e.type}: ${what} missing (${en.length} items)`)
        else if (zh.length !== en.length) bad.push(`${e.type}: ${what} has ${zh.length} items, catalog ${en.length}`)
      }
      check('specs', e.meta?.specs, z.specs)
      check('simulated', s.simulated, z.simulated)
      check('limits', s.limits, z.limits)
    }
    expect(bad).toEqual([])
  })

  it('every param has a label and every word-valued select option a label; no stray keys', () => {
    const bad: string[] = []
    for (const e of ENTRIES) {
      const z = partTranslation(e.type)
      if (!z) continue
      const keys = new Set((e.params ?? []).map((p) => p.key))
      for (const p of e.params ?? []) {
        if (!z.params?.[p.key]) bad.push(`${e.type}: param "${p.key}" has no label`)
        for (const o of p.options ?? []) {
          if (/[a-z]{3,}/.test(o) && !z.options?.[p.key]?.[o]) bad.push(`${e.type}: option ${p.key}="${o}" has no label`)
        }
      }
      for (const k of Object.keys(z.params ?? {})) if (!keys.has(k)) bad.push(`${e.type}: zh param "${k}" is not a catalog param`)
      for (const [k, opts] of Object.entries(z.options ?? {})) {
        const def = e.params?.find((p) => p.key === k)
        for (const o of Object.keys(opts)) if (!def?.options?.includes(o)) bad.push(`${e.type}: zh option ${k}="${o}" is not a catalog option`)
      }
    }
    expect(bad).toEqual([])
  })

  it('texts are Chinese: no English words left (technical tokens aside), Taiwan usage, full-width punctuation', () => {
    const bad: string[] = []
    for (const e of ENTRIES) {
      const tokens = partTokens(e)
      for (const s of allTexts(e.type)) {
        const left = englishLeft(s, tokens)
        if (left.length) bad.push(`${e.type}: [${left.join(', ')}] in "${s.slice(0, 80)}"`)
        for (const term of MAINLAND_TERMS) if (s.includes(term)) bad.push(`${e.type}: mainland term ${term} in "${s.slice(0, 60)}"`)
        for (const p of halfWidthPunctuation(s)) bad.push(`${e.type}: half-width punctuation "${p}"`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the display helpers return Chinese in zh-TW and the catalog English in en', () => {
    const led = CATALOG.led
    __setLangForTests('zh-TW')
    expect(partLabel(led)).toBe('發光二極體 LED')
    expect(partDoc(led)).toMatch(/陽極/)
    expect(partParamLabel(led, 'color', 'Color')).toBe('顏色')
    expect(partOptionLabel(led, 'color', 'green')).toBe('綠色')
    expect(partSupport(led).simulated?.[1]).toBe('亮度與電流成正比，10 mA 時全亮')
    expect(partSupport(led).level).toBe('full')
    expect(partSpecs(CATALOG.stm32_bluepill)[0]).toMatch(/^Cortex-M3 最高 72 MHz/)
    expect(partLabel(CATALOG.stm32_bluepill)).toBe('STM32F103C8T6 Blue Pill 開發板')
    __setLangForTests('en')
    expect(partLabel(led)).toBe('LED')
    expect(partDoc(led)).toBe(led.doc)
    expect(partOptionLabel(led, 'color', 'green')).toBe('green')
    expect(partSupport(led)).toEqual(supportOf(led))
  })
})
