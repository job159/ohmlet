/**
 * Release polish (catalog) — battery_9v's part number is a part number:
 * 「6LR61 (PP3)」, an identifier the inspector shows untranslated
 * (translate="no"); 「alkaline + snap clip」 moved into the translated
 * description — the BAT1 inspector subtitle no longer shows English words.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { CATALOG } from '../src/model/catalog'
import { partDoc } from '../src/i18n/parts'

describe('battery_9v part number and description', () => {
  afterEach(() => __setLangForTests('zh-TW'))
  const entry = CATALOG.battery_9v

  it('the part number is only 「6LR61 (PP3)」 — no English words in an untranslated identifier', () => {
    expect(entry.meta?.partNumber).toBe('6LR61 (PP3)')
    expect(entry.meta?.partNumber).not.toMatch(/\b[a-z]{3,}\b/)
  })

  it('「alkaline」 and 「snap clip」 are in the description, translated: 鹼性電池、電池扣', () => {
    expect(entry.doc).toMatch(/9 V alkaline battery with a snap clip/)
    __setLangForTests('zh-TW')
    const zh = partDoc(entry)
    expect(zh).toContain('附電池扣的 9 V 鹼性電池')
    expect(zh).not.toMatch(/alkaline|snap/i)
    __setLangForTests('en')
    expect(partDoc(entry)).toBe(entry.doc)
  })
})
