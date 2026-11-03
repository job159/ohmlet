/**
 * 「電路說明」 zh-TW coverage (round 5 — explain, src/i18n/zh-TW/explain.ts):
 * every English source the explain code hands to t() has a Traditional-
 * Chinese (Taiwan) entry that the merged dictionary really resolves to (no
 * later-sorted dictionary shadows it — every key carries '|explain'),
 * placeholders survive, no mainland terms, no simplified characters, no
 * English words left beyond names, full-width punctuation. The canonical
 * term table (tests/ux-shell-terms.test.ts) and the chrome scan
 * (tests/i18n/chrome-ui.test.ts) cover the same file / keys automatically.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import explain from '../src/i18n/zh-TW/explain'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './i18n/zh-check'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const FILES = ['src/ui/chrome/explain.ts', 'src/ui/chrome/explain-path.ts', 'src/ui/chrome/useExplanation.ts', 'src/ui/chrome/ExplainCard.tsx']

/** Literal t('…') keys (string literals only). */
function literalKeys(src: string): string[] {
  const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
  return [...src.matchAll(re)].map((m) => m[2].replace(/\\(['"\\])/g, '$1'))
}

describe('explain zh-TW', () => {
  it('every literal source in the explain files resolves to Chinese', () => {
    __setLangForTests('zh-TW')
    const keys = FILES.flatMap((f) => literalKeys(read(f)).map((k) => [f, k] as const))
    expect(keys.length).toBeGreaterThan(100)
    const missing = keys.filter(([, k]) => !hasTranslation(k)).map(([f, k]) => `${f}: ${JSON.stringify(k)}`)
    expect(missing).toEqual([])
  })

  it('every explain entry is used, carries the |explain context and is what t() returns (nothing shadows it)', () => {
    __setLangForTests('zh-TW')
    const used = new Set(FILES.flatMap((f) => literalKeys(read(f))))
    expect(Object.keys(explain).filter((k) => !k.endsWith('|explain'))).toEqual([])
    expect(Object.keys(explain).filter((k) => !used.has(k))).toEqual([])
    expect(Object.entries(explain).filter(([k, v]) => t(k) !== v)).toEqual([])
  })

  it('Taiwan usage, placeholders kept, no stray English, full-width punctuation', () => {
    const proper = ['PWM', 'LED', 'BOOT0']
    const bad: string[] = []
    for (const [k, v] of Object.entries(explain)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      if (ph(v) !== ph(k.split('|')[0])) bad.push(`placeholders: ${k}`)
      const text = v.replace(/\{\w+\}/g, ' ')
      const words = englishLeft(text, proper)
      const punct = halfWidthPunctuation(text)
      const terms = MAINLAND_TERMS.filter((m) => v.includes(m))
      if (words.length || punct.length || terms.length) bad.push(`${k} → ${v} ${JSON.stringify({ words, punct, terms })}`)
      if (/[这们个为时电线键设计载导连显图关开择复读误辑头动发现换组态网络数据转从过闪烧]/.test(v)) bad.push(`simplified: ${k} → ${v}`)
      // the run-state rule: 執行中 only for the run phase; never 「▶ 執行」 alone
      if (/執行中|▶/.test(v)) bad.push(`term: ${k} → ${v}`)
    }
    expect(bad).toEqual([])
  })

  it('the recovery words match the damage stream (〔換新〕, 改好就會自動換上新的)', () => {
    __setLangForTests('zh-TW')
    expect(t('Press Replace for a new one; fixing the circuit or a value also replaces it|explain')).toBe('按〔換新〕換上新的；改好電路或數值也會自動換新')
    expect(t('Add a current-limiting resistor; once fixed, a new {id} goes in by itself|explain', { id: 'LED1' })).toBe('串一顆限流電阻；改好就會自動換上新的 LED1')
  })

  it('English shows the sources without the context', () => {
    __setLangForTests('en')
    expect(t('{id} is lit: brightness {value}|explain', { id: 'LED1', value: '49 % (9.70 mA)' })).toBe('LED1 is lit: brightness 49 % (9.70 mA)')
    expect(t(', |explain')).toBe(', ')
    expect(t('Circuit explanation|explain')).toBe('Circuit explanation')
  })
})
