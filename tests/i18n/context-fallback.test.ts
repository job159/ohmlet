import { afterAll, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../../src/i18n'

describe('t() context suffix', () => {
  afterAll(() => __setLangForTests('zh-TW'))

  it('English shows the source without its "|context" suffix', () => {
    __setLangForTests('en')
    expect(t('Details|problem')).toBe('Details')
    expect(t('{n} pins|count', { n: 2 })).toBe('2 pins')
    expect(t('Overview|mcu-tab')).toBe('Overview')
  })

  it('keeps sources whose "|" is not a context suffix', () => {
    __setLangForTests('en')
    expect(t('A | B')).toBe('A | B')
    expect(t('TX|RX pair')).toBe('TX|RX pair')
  })

  it('zh-TW still resolves the context key', () => {
    __setLangForTests('zh-TW')
    expect(t('Details|problem')).toBe('詳細')
  })
})
