/**
 * UX wave WS3 — lesson UI (node, server render; zustand renders the INITIAL
 * store state, so these are the views a fresh page shows):
 *  - a step check the learner has not attempted reads 「尚未完成」, never ✕;
 *  - the acceptance list on a board without the lesson's parts says
 *    「麵包板上沒有本課的起始電路」 with an inline 「載入起始電路」;
 *  - the coach step body: first paragraph, 「為什麼？」, the one-click action
 *    next to 「檢查此步驟」; the panel body keeps the whole text;
 *  - hole / terminal refs in lesson text are chips with a Chinese gloss;
 *  - lesson cards carry their course code (「初級 1 · …」);
 *  - every literal t() / tc() source of the new lesson modules has a zh-TW
 *    entry, and the ux-lessons dictionary is Taiwan-usage Chinese.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation } from '../src/i18n'
import uxLessons from '../src/i18n/zh-TW/ux-lessons'
import { lessonById } from '../src/lessons'
import type { Lesson } from '../src/lessons/types'
import { CheckResults } from '../src/ui/lessons/CheckResults'
import { LessonBrowser, StepBody } from '../src/ui/lessons/LessonBrowser'
import { LessonText, refGloss, splitFirstParagraph } from '../src/ui/lessons/LessonText'
import { expectedText } from '../src/ui/lessons/print'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const lesson = (id: string): Lesson => lessonById(id)!

afterEach(() => __setLangForTests('zh-TW'))

describe('step checks before an attempt (LS-4)', () => {
  const run = {
    status: 'done' as const,
    at: 0,
    progress: null,
    results: [{ key: '0', kind: 'has-part' as const, label: '已放上按鈕', pass: false, detail: '電路中沒有按鈕（至少需要 1 個）。', focus: { components: [], holes: ['f45'] } }],
  }
  it('reads 尚未完成 (neutral) until attempted, then ✕ with the detail', () => {
    __setLangForTests('zh-TW')
    const before = renderToStaticMarkup(createElement(CheckResults, { checks: [{ kind: 'has-part', type: 'pushbutton' }], run, runId: 'x', attempted: false }))
    expect(before).toContain('lsn-check is-todo')
    expect(before).toContain('尚未完成')
    expect(before).not.toContain('is-fail')
    expect(before).not.toContain('電路中沒有按鈕')
    const after = renderToStaticMarkup(createElement(CheckResults, { checks: [{ kind: 'has-part', type: 'pushbutton' }], run, runId: 'x' }))
    expect(after).toContain('lsn-check is-fail')
    expect(after).toContain('電路中沒有按鈕')
  })
})

describe('acceptance on a board without the start circuit (LS-5)', () => {
  it('replaces the result list with one callout and the load button', () => {
    __setLangForTests('zh-TW')
    const b1 = lesson('b1-led-resistor')
    const results = b1.acceptance.map((c, i) => ({ key: String(i), kind: c.kind, label: `條件 ${i}`, pass: c.kind === 'erc-clean', detail: '—' }))
    const html = renderToStaticMarkup(
      createElement(CheckResults, { checks: b1.acceptance, run: { status: 'done', at: 0, progress: null, results }, runId: 'b1|acceptance', lesson: b1 }),
    )
    expect(html).toContain('麵包板上沒有本課的起始電路——請先按「載入起始電路」。')
    expect(html).toContain('>載入起始電路<')
    expect(html).not.toContain('條件 1')
  })
})

describe('the coach step body (LS-1, LS-3)', () => {
  it('shows the first paragraph, 為什麼？ and the one-click action next to the check', () => {
    __setLangForTests('zh-TW')
    const i1 = lesson('i1-gpio-output')
    const index = i1.steps.findIndex((s) => s.id === 'firmware')
    const coach = renderToStaticMarkup(createElement(StepBody, { lesson: i1, index, compact: true }))
    expect(coach).toContain('載入 hal-blink 到 U1')
    expect(coach).toContain('檢查此步驟')
    expect(coach).toContain('為什麼？')
    expect(coach).not.toContain('SystemClock_Config') // behind 為什麼？ (collapsed by default)
    expect(coach.indexOf('載入 hal-blink 到 U1')).toBeLessThan(coach.indexOf('檢查此步驟'))
    const panel = renderToStaticMarkup(createElement(StepBody, { lesson: i1, index }))
    expect(panel).toContain('SystemClock_Config')
    expect(panel).not.toContain('為什麼？')
  })

  it('offers ▶ 執行模擬 and 拿一顆電阻 where the step needs them', () => {
    const b1 = lesson('b1-led-resistor')
    const run = renderToStaticMarkup(createElement(StepBody, { lesson: b1, index: b1.steps.findIndex((s) => s.id === 'b1-s5'), compact: true }))
    expect(run).toContain('執行模擬')
    const take = renderToStaticMarkup(createElement(StepBody, { lesson: b1, index: b1.steps.findIndex((s) => s.id === 'b1-s3'), compact: true }))
    expect(take).toContain('拿一顆電阻')
  })

  it('splits step text at the first blank line', () => {
    expect(splitFirstParagraph('做這件事。\n\n因為那樣。\n\n還有這個。')).toEqual(['做這件事。', '因為那樣。\n\n還有這個。'])
    expect(splitFirstParagraph('只有一段。')).toEqual(['只有一段。', ''])
  })
})

describe('hole / terminal chips and lesson codes (LS-7)', () => {
  it('glosses refs in Chinese and renders them as chips', () => {
    __setLangForTests('zh-TW')
    expect(refGloss('top+10')).toBe('上方 + 電源軌第 10 孔')
    expect(refGloss('bot-32')).toBe('下方 − 電源軌第 32 孔')
    expect(refGloss('a14')).toBe('a 列第 14 欄')
    // terminals read the app's one terminal name (H1 terminalLabel, LS-13) even before the lesson
    // circuit is on the board (part type from the lessons)
    expect(refGloss('PS1:+')).toBe('PS1 正端')
    expect(refGloss('FG1:out')).toBe('FG1 輸出端')
    expect(refGloss('FG1:gnd')).toBe('FG1 接地端')
    expect(refGloss('DMM1:COM')).toBe('DMM1 COM 端')
    expect(refGloss('PA5')).toBeNull()
    expect(refGloss('HAL_Delay(500)')).toBeNull()
    const html = renderToStaticMarkup(createElement(LessonText, { text: '一腳插 `top+10`，另一腳插 `a14`，韌體 `hal-blink`。' }))
    expect(html).toContain('class="lsn-code lsn-ref "')
    expect(html).toContain('title="上方 + 電源軌第 10 孔——點一下在電路板上標示"')
    expect(html).toContain('<code class="lsn-code" translate="no">hal-blink</code>')
    const plain = renderToStaticMarkup(createElement(LessonText, { text: '`top+10`', refs: false }))
    expect(plain).not.toContain('lsn-ref')
  })

  it('cards carry the course code', () => {
    __setLangForTests('zh-TW')
    const html = renderToStaticMarkup(createElement(LessonBrowser, { variant: 'panel' }))
    expect(html).toContain('初級 1 · </span>LED 與限流電阻')
    expect(html).toContain('中級 1 · </span>STM32 GPIO 輸出')
  })

  it('the checklist states what each check expects', () => {
    const b1 = lesson('b1-led-resistor')
    // honesty F4: the brightness check is on the app's one scale (I / rated 20 mA) — the same
    // 5–30 mA that read 「50 % – 100 %」 of the old I / 10 mA scale
    expect(b1.acceptance.map(expectedText)).toEqual(['—', '220 Ω – 560 Ω', '—', '5 mA – 15 mA', '25 % – 150 %', '—'])
  })
})

// ------------------------------------------------------------------ i18n

const FILES = [
  'src/ui/lessons/actions.ts',
  'src/ui/lessons/CheckResults.tsx',
  'src/ui/lessons/LessonBrowser.tsx',
  'src/ui/lessons/LessonOverlay.tsx',
  'src/ui/lessons/LessonText.tsx',
  'src/ui/lessons/labels.tsx',
  'src/ui/lessons/print.tsx',
  'src/lessons/engine/format.ts',
]

function literalKeys(src: string): string[] {
  const re = /\b(t|tc)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push(m[1] === 'tc' && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

describe('zh-TW coverage of the lesson UX modules', () => {
  it('every literal t()/tc() source has a zh-TW entry', () => {
    __setLangForTests('zh-TW')
    const missing: string[] = []
    for (const f of FILES) for (const k of literalKeys(read(f))) if (!hasTranslation(k)) missing.push(`${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('the ux-lessons dictionary is Taiwan-usage Chinese with intact placeholders', () => {
    const bad: string[] = []
    for (const [src, zh] of Object.entries(uxLessons)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (ph(src.split('|')[0]) !== ph(zh)) bad.push(`placeholders: ${src}`)
      const left = englishLeft(zh.replace(/\{\w+\}/g, ' '), ['JSON', 'ohmlet'])
      if (left.length) bad.push(`English left in ${src}: ${left.join(' ')}`)
      for (const term of MAINLAND_TERMS) if (zh.includes(term)) bad.push(`mainland term ${term}: ${src}`)
      if (halfWidthPunctuation(zh).length) bad.push(`half-width punctuation: ${zh}`)
    }
    expect(bad).toEqual([])
  })
})
