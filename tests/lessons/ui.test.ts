/**
 * Lesson UI (node, server render) + progress store + zh-TW coverage:
 *  - LessonText renders the safe Markdown subset as elements (HTML stays text);
 *  - the browser lists every lesson grouped 初級 / 中級 / 進階 with runnable
 *    badges, and the lesson view shows the actions and the seven sections;
 *  - progress (localStorage 'bb.lessons') starts / steps / completes / resets
 *    and survives a reload; malformed data is dropped, never half-read;
 *  - every literal t() / tc() source in src/ui/lessons and
 *    src/lessons/engine has a zh-TW entry; the lessons-ui dictionary is
 *    Taiwan-usage Traditional Chinese with intact placeholders.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, hasTranslation } from '../../src/i18n'
import lessonsUi from '../../src/i18n/zh-TW/lessons-ui'
import { LESSONS } from '../../src/lessons'
import {
  LESSONS_STORAGE_KEY,
  __setLessonClockForTests,
  parseProgress,
  reloadLessonProgress,
  useLessonProgress,
} from '../../src/lessons/progress'
import { LessonText } from '../../src/ui/lessons/LessonText'
import { LessonBrowser, LessonView, StepBody } from '../../src/ui/lessons/LessonBrowser'
import { CheckResults } from '../../src/ui/lessons/CheckResults'
import type { LessonCheck } from '../../src/lessons/types'
import { useLessonUi, LESSON_SECTIONS } from '../../src/ui/lessons/state'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from '../i18n/zh-check'

const ROOT = path.resolve(__dirname, '../..')
const CJK = /[\u4e00-\u9fff]/

// an in-memory localStorage for the progress store
const memory = new Map<string, string>()
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  __setLangForTests('zh-TW')
  __setLessonClockForTests(null)
})

describe('LessonText', () => {
  it('renders paragraphs, bullets, bold and code as elements — never markup', () => {
    const html = renderToStaticMarkup(
      createElement(LessonText, { text: '把 **R1** 接到 `PA5`\n第二行\n\n- 第一項\n- <b>不是粗體</b>' }),
    )
    expect(html).toContain('<p>把 <strong>R1</strong> 接到 <code class="lsn-code" translate="no">PA5</code><br/>第二行</p>')
    expect(html).toContain('<ul><li>第一項</li><li>&lt;b&gt;不是粗體&lt;/b&gt;</li></ul>')
  })
})

describe('LessonBrowser', () => {
  it('lists every lesson grouped by level with runnable badges', () => {
    __setLangForTests('zh-TW')
    const html = renderToStaticMarkup(createElement(LessonBrowser, { variant: 'panel' }))
    for (const l of LESSONS) expect(html, l.id).toContain(l.title.replace(/&/g, '&amp;'))
    const levels = new Set(LESSONS.map((l) => l.level))
    if (levels.has('beginner')) expect(html).toContain('>初級<')
    if (levels.has('intermediate')) expect(html).toContain('>中級<')
    if (levels.has('advanced')) expect(html).toContain('>進階<')
    expect(html).toMatch(/lsn-badge is-(ready|partial|not-yet)/)
    if (LESSONS.some((l) => l.runnable === 'ready')) expect(html).toContain('>可執行<')
    expect(html).toContain(`已完成 0 / ${LESSONS.length}`)
  })

  it('shows a lesson with its actions and the seven sections', () => {
    const lesson = LESSONS[0]
    const html = renderToStaticMarkup(createElement(LessonView, { lesson, variant: 'sheet' }))
    for (const s of ['載入起始電路', '顯示解答', '檢查我的電路', '所有課程', '目標', '接線', '原理', '步驟', '預期結果', '常見錯誤', '驗收']) {
      expect(html, s).toContain(s)
    }
    expect(html.match(/role="tab"/g)).toHaveLength(LESSON_SECTIONS.length)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('完成本課後，你能夠')
    const step = renderToStaticMarkup(createElement(StepBody, { lesson, index: 0 }))
    expect(step).toContain('lsn-text')
    expect(step).toContain('上一步')
  })

  it('lists checks as pending, then per-check results with details and sub-checks', () => {
    const checks: LessonCheck[] = [
      { kind: 'has-part', type: 'resistor', label: '電路中有電阻' },
      { kind: 'all', checks: [{ kind: 'erc-clean' }], label: '全部成立' },
    ]
    const pending = renderToStaticMarkup(createElement(CheckResults, { checks, run: undefined, runId: 'x' }))
    expect(pending.match(/lsn-check is-pending/g)).toHaveLength(2)
    expect(pending).toContain('電路中有電阻：尚未檢查')
    const running = renderToStaticMarkup(
      createElement(CheckResults, {
        checks,
        runId: 'x',
        run: { status: 'running', at: 0, results: null, progress: { fraction: 0.5, index: 1, total: 2, label: '全部成立' } },
      }),
    )
    expect(running).toContain('正在檢查 2 / 2：全部成立')
    expect(running).toContain('aria-valuenow="50"')
    const done = renderToStaticMarkup(
      createElement(CheckResults, {
        checks,
        runId: 'x',
        run: {
          status: 'done',
          at: 0,
          progress: null,
          results: [
            { key: '0', kind: 'has-part', label: '電路中有電阻', pass: true, detail: '找到 1 個電阻（至少需要 1 個）。' },
            {
              key: '1',
              kind: 'all',
              label: '全部成立',
              pass: false,
              detail: '0 / 1 項條件成立。',
              focus: { components: ['R1'], holes: [] },
              children: [{ key: '1.0', kind: 'erc-clean', label: 'ERC', pass: false, detail: '1 項發現', technical: ['rule-id'] }],
            },
          ],
        },
      }),
    )
    expect(done).toContain('lsn-check is-pass')
    expect(done).toContain('lsn-check is-fail')
    expect(done).toContain('找到 1 個電阻')
    expect(done).toContain('lsn-checks is-nested')
    expect(done).toContain('rule-id')
    expect(done).toContain('在電路板上標示') // the Problems list's words for the same action (LS-13, H9)
  })
})

describe('lesson progress (localStorage bb.lessons)', () => {
  it('records start, steps, completion and survives a reload', () => {
    memory.clear()
    reloadLessonProgress()
    let now = 1_760_000_000_000
    __setLessonClockForTests(() => now)
    const p = () => useLessonProgress.getState()
    p().start('demo')
    expect(p().lessons.demo).toMatchObject({ startedAt: now, step: 0, stepsDone: [] })
    now += 1000
    p().start('demo') // keeps the first start
    p().setStep('demo', 2)
    p().markStepDone('demo', 's1')
    p().markStepDone('demo', 's1')
    now += 1000
    p().complete('demo')
    const saved = JSON.parse(memory.get(LESSONS_STORAGE_KEY)!)
    expect(saved).toEqual({
      v: 1,
      lessons: { demo: { startedAt: now - 2000, step: 2, stepsDone: ['s1'], completedAt: now, updatedAt: now } },
    })
    useLessonProgress.setState({ lessons: {} })
    reloadLessonProgress()
    expect(p().lessons.demo.completedAt).toBe(now)
    p().reset('demo')
    expect(p().lessons.demo).toBeUndefined()
    expect(memory.has(LESSONS_STORAGE_KEY)).toBe(false)
  })

  it('drops malformed or foreign data instead of half-reading it', () => {
    expect(parseProgress(null)).toEqual({})
    expect(parseProgress('{not json')).toEqual({})
    expect(parseProgress(JSON.stringify({ v: 2, lessons: { a: { step: 1 } } }))).toEqual({})
    expect(parseProgress(JSON.stringify({ v: 1, lessons: [] }))).toEqual({})
    const parsed = parseProgress(
      JSON.stringify({
        v: 1,
        lessons: {
          ok: { step: 3, stepsDone: ['a', 'a', 7, ''], startedAt: 5, completedAt: -1, updatedAt: 9 },
          bad: 'x',
          neg: { step: -4 },
        },
      }),
    )
    expect(parsed).toEqual({
      ok: { step: 3, stepsDone: ['a'], startedAt: 5, updatedAt: 9 },
      neg: { step: 0, stepsDone: [], updatedAt: 0 },
    })
  })
})

// ------------------------------------------------------------------ i18n

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const files = (rel: string) =>
  readdirSync(path.join(ROOT, rel))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${rel}/${f}`)

function literalKeys(src: string): string[] {
  const re = /\b(t|tc)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push(m[1] === 'tc' && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

/** String values of `const NAME … = { … }` (record sources handed to t() at runtime). */
function recordValues(src: string, name: string): string[] {
  const start = src.indexOf(`const ${name}`)
  expect(start, `const ${name}`).toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', src.indexOf('= ', start))
  const body = src.slice(open, src.indexOf('}', open) + 1)
  return [...body.matchAll(/:\s*'((?:\\.|[^'])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
}

describe('lessons zh-TW coverage', () => {
  it('every literal t()/tc() source of the lesson UI and engine has a zh-TW entry', () => {
    __setLangForTests('zh-TW')
    const missing: string[] = []
    for (const f of [...files('src/ui/lessons'), ...files('src/lessons/engine')]) {
      for (const k of literalKeys(read(f))) if (!hasTranslation(k)) missing.push(`${f}: ${JSON.stringify(k)}`)
    }
    expect(missing).toEqual([])
  })

  it('record-sourced labels (levels, runnable states, sections, quantities) are covered', () => {
    const labels = read('src/ui/lessons/labels.tsx')
    const sources = [
      ...recordValues(labels, 'LEVEL_NAMES').map((s) => `${s}|lesson level`),
      ...recordValues(labels, 'RUNNABLE_NAMES'),
      ...recordValues(labels, 'RUNNABLE_HINTS'),
      ...recordValues(read('src/ui/lessons/LessonBrowser.tsx'), 'SECTION_NAMES'),
    ]
    expect(sources.length).toBe(3 + 3 + 3 + 7)
    expect(sources.filter((s) => !hasTranslation(s))).toEqual([])
  })

  it('the lessons-ui dictionary is Taiwan-usage Traditional Chinese with intact placeholders', () => {
    const bad: string[] = []
    for (const [src, zh] of Object.entries(lessonsUi)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (ph(src) !== ph(zh)) bad.push(`placeholders: ${src}`)
      const symbolsOnly = !/[A-Za-z]{2}/.test(src.replace(/\{\w+\}/g, ''))
      if (!symbolsOnly && !CJK.test(zh)) bad.push(`not Chinese: ${src}`)
      const left = englishLeft(zh.replace(/\{\w+\}/g, ' '), ['ERC'])
      if (left.length) bad.push(`English left in ${src}: ${left.join(' ')}`)
      for (const term of MAINLAND_TERMS) if (zh.includes(term)) bad.push(`mainland term ${term}: ${src}`)
      if (halfWidthPunctuation(zh).length) bad.push(`half-width punctuation: ${zh}`)
    }
    expect(bad).toEqual([])
  })
})
