import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../../src/i18n'

afterEach(() => __setLangForTests('zh-TW'))

describe('i18n core', () => {
  it('defaults to Traditional Chinese and falls back to the English source', () => {
    __setLangForTests('zh-TW')
    expect(t('Language')).toBe('語言')
    expect(t('a string nobody translated')).toBe('a string nobody translated')
    expect(hasTranslation('Language')).toBe(true)
  })
  it('English returns sources unchanged and interpolates placeholders', () => {
    __setLangForTests('en')
    expect(t('Language')).toBe('Language')
    expect(t('{n} selected', { n: 3 })).toBe('3 selected')
  })
})
