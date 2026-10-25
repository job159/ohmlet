/**
 * UX wave — shell workstream zh-TW coverage (src/i18n/zh-TW/ux-shell.ts):
 * every English source the shell's new code hands to t() / tc() has a
 * Traditional-Chinese (Taiwan) entry that the merged dictionary really
 * resolves to (a later dictionary never shadows it), placeholders survive,
 * no mainland terms, no English words left beyond key names / proper names,
 * full-width punctuation; the constant-sourced copy (onboarding steps, the
 * shortcuts list) is covered too.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import uxShell from '../src/i18n/zh-TW/ux-shell'
import { SHORTCUT_GROUPS } from '../src/ui/chrome/ShortcutsSheet'
import { tc } from '../src/ui/format'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './i18n/zh-check'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** The shell files of the UX wave (new + changed). */
const FILES = [
  'src/App.tsx',
  'src/ui/chrome/StatusBar.tsx',
  'src/ui/chrome/StatusPill.tsx',
  'src/ui/chrome/ShortcutsSheet.tsx',
  'src/ui/chrome/EmptyState.tsx',
  'src/ui/chrome/Onboarding.tsx',
  'src/ui/chrome/hints.ts',
  'src/ui/chrome/WireColorStrip.tsx',
  'src/ui/chrome/UndoPill.tsx',
  'src/ui/chrome/RotateButton.tsx',
  'src/ui/sheets/MoreSheet.tsx',
  // release QA (SH-F1 / SH-F6 / SH-F9): the edit feedback's own words
  'src/ui/chrome/edit-feedback.ts',
]

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

/** title / body / mouseBody strings of an Onboarding step table (`const STEPS`, `const LEGACY_STEPS`). */
function onboardingSources(table = 'STEPS'): string[] {
  const src = read('src/ui/chrome/Onboarding.tsx')
  const start = src.indexOf(`const ${table}:`)
  // the table ends at its closing bracket line (LF or CRLF checkouts)
  const close = /\r?\n\]\r?\n/.exec(src.slice(start))
  const end = close ? start + close.index : src.length
  return [...src.slice(start, end).matchAll(/\b(?:title|body|mouseBody):\s*'((?:\\.|[^'])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
}

describe('ux-shell zh-TW', () => {
  it('every literal source in the shell files resolves to Chinese', () => {
    __setLangForTests('zh-TW')
    const missing: string[] = []
    for (const f of FILES) {
      for (const k of literalKeys(read(f))) {
        if (k === 'AI' || k === 'MCU') continue
        if (!hasTranslation(k)) missing.push(`${f}: ${JSON.stringify(k)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('onboarding steps and the shortcuts list are covered', () => {
    __setLangForTests('zh-TW')
    const steps = onboardingSources()
    expect(steps.length).toBe(7) // 3 titles + 3 bodies + the mouse wording
    const rows = SHORTCUT_GROUPS.flatMap((g) => [`${g.title}|shortcuts`, ...g.rows.map((r) => r.label)])
    const missing = [...steps, ...rows].filter((s) => !hasTranslation(s))
    expect(missing).toEqual([])
    // the mouse and touch wordings differ (no pinch on a desktop)
    expect(t(steps[3])).toContain('雙指捏合')
    expect(t(steps[4])).toContain('滾輪縮放')
    expect(t(steps[4])).not.toContain('捏合')
  })

  it('the classic tour keeps the pre-wave steps (SH-10: Look around / Place parts / Or just ask)', () => {
    const legacy = onboardingSources('LEGACY_STEPS')
    expect(legacy.length).toBe(6)
    expect(legacy.filter((_, i) => i % 2 === 0)).toEqual(['Look around', 'Place parts', 'Or just ask'])
    expect(read('src/ui/chrome/Onboarding.tsx')).toContain("t('Get started')")
  })

  it('every ux-shell entry is what t() returns (nothing shadows it)', () => {
    __setLangForTests('zh-TW')
    const shadowed = Object.entries(uxShell).filter(([k, v]) => {
      const bar = k.indexOf('|')
      // context keys resolve through tc(): the merged dictionary holds the key itself
      return (bar >= 0 ? t(k) : t(k)) !== v
    })
    expect(shadowed).toEqual([])
  })

  it('Taiwan usage, placeholders kept, no stray English, full-width punctuation', () => {
    const proper = ['Esc', 'Space', 'Ctrl', 'Shift', 'Delete', 'Pill', 'Blue']
    const bad: string[] = []
    for (const [k, v] of Object.entries(uxShell)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      if (ph(v) !== ph(k.split('|')[0])) bad.push(`placeholders: ${k}`)
      const text = v.replace(/\{\w+\}/g, ' ')
      const words = englishLeft(text, proper)
      const punct = halfWidthPunctuation(text)
      const terms = MAINLAND_TERMS.filter((m) => v.includes(m))
      if (words.length || punct.length || terms.length) bad.push(`${k} → ${v} ${JSON.stringify({ words, punct, terms })}`)
      if (/[这们个为时电线键设计载导连显图关开择复读误辑头动发现换组态网络数据]/.test(v)) bad.push(`simplified: ${k}`)
    }
    expect(bad).toEqual([])
  })

  it('numbers and units keep a space (「0.3 倍速」, 「3.11 s」)', () => {
    __setLangForTests('zh-TW')
    expect(t('{x}× speed', { x: '0.3' })).toBe('0.3 倍速')
    expect(t('Resume the {id} core (Space / F5)', { id: 'U1' })).toBe('繼續執行 U1 核心（空白鍵／F5）')
  })
})

describe('SH-16 tc() context fallback (RV-10)', () => {
  it('a missing context entry falls back to the translated plain source, never the English one', () => {
    __setLangForTests('zh-TW')
    expect(tc('Standard', 'decoder')).toBe(t('Standard'))
    expect(tc('Standard', 'decoder')).toBe('標準')
    expect(tc('Run', 'pill')).toBe('執行') // a context entry still wins
    __setLangForTests('en')
    expect(tc('Run', 'pill')).toBe('Run')
    expect(tc('{n} more', 'zz', { n: 2 })).toBe('2 more')
  })
})
