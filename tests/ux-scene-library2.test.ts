/**
 * UX fix wave SC-17 — library and example wording and search:
 *  - the canonical terms (UX_VERIFY.md §5.4): 「n 腳」 (never 「n 支引腳」),
 *    「微控制器（MCU）」, 「初級／中級／進階」 (never 「入門」), 「工作週期」 in
 *    the examples' own texts;
 *  - the example search ranks title hits above summary hits above tag hits
 *    above category-name hits: 「PWM」 lists 「PWM 呼吸燈」 first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { tc } from '../src/ui/format'
import {
  LIBRARY,
  exampleCategoryName,
  exampleDescription,
  exampleDifficultyName,
  exampleMatchRank,
  exampleMatches,
  exampleSummary,
  exampleTitle,
} from '../src/ui/workspace/examples'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

const extra = (ex: (typeof LIBRARY)[number]) => [exampleCategoryName(ex.category), exampleDifficultyName(ex.difficulty)]

/** The Examples tab's order for a query (LibraryPanel ExamplesTab). */
function search(q: string) {
  return LIBRARY.map((ex, i) => ({ ex, i, rank: exampleMatchRank(ex, q, t, extra(ex)) }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
}

describe('SC-17 wording', () => {
  it('library and examples speak the canonical terms', () => {
    expect(t('{n} leads', { n: 2 })).toBe('2 腳')
    expect(tc('MCU', 'category')).toBe('微控制器（MCU）')
    expect(tc('Beginner', 'difficulty')).toBe('初級')
    expect(t('Beginner')).toBe('初級')
    expect(exampleDifficultyName('beginner')).toBe('初級')
    expect(exampleDifficultyName('intermediate')).toBe('中級')
    expect(exampleDifficultyName('advanced')).toBe('進階')
  })

  it('the examples’ own texts say 工作週期, never 佔空比', () => {
    for (const ex of LIBRARY) {
      const text = [exampleTitle(ex, t), exampleSummary(ex, t), ...exampleDescription(ex, t)].join('\n')
      expect(text, ex.key).not.toMatch(/佔空比/)
    }
    const fade = LIBRARY.find((ex) => ex.key === 'pwm-fade')!
    expect(exampleSummary(fade, t)).toMatch(/工作週期/)
  })
})

describe('SC-17 example search ranking', () => {
  it('「PWM」: PWM 呼吸燈 (a title hit) comes first, category-name-only hits last', () => {
    const hits = search('PWM')
    expect(hits.length).toBeGreaterThan(1)
    expect(hits[0].ex.key).toBe('pwm-fade')
    expect(hits[0].rank).toBe(0)
    // the ranks never go down the list
    for (let i = 1; i < hits.length; i++) expect(hits[i].rank).toBeGreaterThanOrEqual(hits[i - 1].rank)
    // an example that matches only through its section name is still listed, after every real hit
    const blink = hits.find((h) => h.ex.key === 'blink')
    if (blink) expect(blink.rank).toBe(3)
  })

  it('every term must match; an empty query keeps the library order', () => {
    expect(exampleMatchRank(LIBRARY[0], '', t)).toBe(0)
    expect(exampleMatchRank(LIBRARY[0], 'zzz-no-such-thing', t)).toBe(-1)
    const fade = LIBRARY.find((ex) => ex.key === 'pwm-fade')!
    expect(exampleMatchRank(fade, 'PWM 呼吸', t)).toBe(0)
    expect(exampleMatches(fade, 'PWM', t)).toBe(true)
    expect(exampleMatches(fade, 'PWM i2c', t)).toBe(false)
  })
})
