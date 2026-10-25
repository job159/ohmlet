/**
 * UX fix wave — zh-TW strings of the shared helpers (src/i18n/zh-TW/ux-helpers.ts):
 * every literal t() source the helper modules hand over resolves to Chinese,
 * no later dictionary shadows an entry, placeholders survive, Taiwan usage,
 * no stray English, full-width punctuation, a space between a number and
 * its unit.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import uxHelpers from '../src/i18n/zh-TW/ux-helpers'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './i18n/zh-check'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** The helper providers of H1–H11. */
const FILES = [
  'src/instruments/format.ts',
  'src/instruments/measure.ts',
  'src/i18n/parts.ts',
  'src/ui/workspace/hole-chip.ts',
  'src/ui/workspace/scene-bridge.ts',
  'src/ui/embedded/instruments/net-activity.ts',
  'src/ui/embedded/instruments/pin-function.ts',
  'src/ui/embedded/problems.ts',
  'src/ui/chrome/run-control.ts',
  'src/ui/chrome/ShortcutsSheet.tsx',
]

/** Literal t('…') / tc('…', '…') keys (string literals only). */
function literalKeys(src: string): string[] {
  const re = /\b(t|tc|tCtx)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push((m[1] === 'tc' || m[1] === 'tCtx') && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

describe('ux-helpers zh-TW', () => {
  it('every literal source in the helper modules resolves to Chinese', () => {
    __setLangForTests('zh-TW')
    const missing: string[] = []
    for (const f of FILES) for (const k of literalKeys(read(f))) if (!hasTranslation(k)) missing.push(`${f}: ${JSON.stringify(k)}`)
    expect(missing).toEqual([])
  })

  it('every ux-helpers entry is what t() returns (nothing shadows it)', () => {
    __setLangForTests('zh-TW')
    expect(Object.entries(uxHelpers).filter(([k, v]) => t(k) !== v)).toEqual([])
  })

  it('Taiwan usage, placeholders kept, no stray English, full-width punctuation', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(uxHelpers)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      if (ph(v) !== ph(k)) bad.push(`placeholders: ${k}`)
      const text = v.replace(/\{\w+\}/g, ' ')
      const words = englishLeft(text, ['PWM'])
      const punct = halfWidthPunctuation(text)
      const terms = MAINLAND_TERMS.filter((m) => v.includes(m))
      if (words.length || punct.length || terms.length) bad.push(`${k} → ${v} ${JSON.stringify({ words, punct, terms })}`)
      if (/[这们个为时电线键设计载导连显图关开择复读误辑头动发现换组态网络数据]/.test(v)) bad.push(`simplified: ${k}`)
    }
    expect(bad).toEqual([])
  })
})
