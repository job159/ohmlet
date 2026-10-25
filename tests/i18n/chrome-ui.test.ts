/**
 * zh-TW coverage for the classic chrome, kit and sheets (src/App.tsx,
 * src/ui/chrome, src/ui/kit, src/ui/sheets): every English source those
 * files hand to t() / tc() has a Traditional Chinese entry, the dynamic
 * sources (model labels, example titles, AI pipeline texts) are covered,
 * the dictionaries stay Taiwan-usage Traditional Chinese, and English stays
 * byte-identical to the pre-i18n UI.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../../src/i18n'
import core from '../../src/i18n/zh-TW/core'
import chrome from '../../src/i18n/zh-TW/chrome'
import sheets from '../../src/i18n/zh-TW/sheets'
import { BOARD_SIZES } from '../../src/model/types'
import { RENDER_MODES, RENDER_MODE_IDS } from '../../src/three/render-modes/capability'
import { EXAMPLES } from '../../src/ui/workspace/examples'
import { WIRE_COLORS, wireColorLabel } from '../../src/ui/wire-colors'
import { tc } from '../../src/ui/format'
import { aiErrorText, aiExpectationText, aiStatusText } from '../../src/ui/sheets/ai-text'
import { describeExpectation } from '../../src/llm/verify'
import { hintForMode } from '../../src/ui/chrome/hints'
import { buildSystemPrompt } from '../../src/llm/prompt'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './zh-check'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const dir = (rel: string) =>
  readdirSync(path.join(ROOT, rel))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${rel}/${f}`)

const OWNED = [
  'src/App.tsx',
  'src/main.tsx',
  'src/ui/format.ts',
  'src/ui/wire-colors.ts',
  ...dir('src/ui/chrome'),
  ...dir('src/ui/kit'),
  ...dir('src/ui/sheets'),
]

const MINE: Record<string, string> = { ...core, ...chrome, ...sheets }

/** Does the merged zh-TW dictionary have this source (or "src|context") key? */
function zhHas(key: string): boolean {
  __setLangForTests('zh-TW')
  return hasTranslation(key)
}

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

/** String values inside a `const NAME … = …` block (first balanced block). */
function constStrings(src: string, name: string, field?: string): string[] {
  const start = src.indexOf(`const ${name}`)
  expect(start, `const ${name} not found`).toBeGreaterThanOrEqual(0)
  // the initializer's bracket (skip type annotations like `Step[]`)
  const eq = src.indexOf('= ', start)
  const open = eq - start + src.slice(eq).search(/[[{]/)
  let depth = 0
  let end = start + open
  for (let i = start + open; i < src.length; i++) {
    const c = src[i]
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = src.slice(start + open, end)
  const re = field
    ? new RegExp(`\\b${field}:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`, 'g')
    : /:\s*(['"])((?:\\.|(?!\1).)*)\1/g
  return [...body.matchAll(re)].map((m) => m[2].replace(/\\(['"\\])/g, '$1'))
}

describe('chrome / kit / sheets zh-TW coverage', () => {
  it('every literal t()/tc() source in the owned files has a zh-TW entry', () => {
    const missing: string[] = []
    for (const f of OWNED) {
      let src = read(f)
      // ScopeSheet: only the sheet chrome is ours — the scope instrument view
      // below it (ScopeView …) belongs to the workspace dictionaries
      if (f.endsWith('ScopeSheet.tsx')) src = src.slice(0, src.indexOf('export function ScopeView'))
      for (const k of literalKeys(src)) {
        if (k === 'AI' || k === 'MCU') continue // identical in both languages
        if (!zhHas(k)) missing.push(`${f}: ${JSON.stringify(k)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('constant-sourced strings (categories, onboarding, lab views, AI chips, about) are covered', () => {
    const parts = read('src/ui/sheets/PartsSheet.tsx')
    const sources = [
      ...constStrings(parts, 'CATEGORY_LABELS'),
      ...constStrings(parts, 'SUPPORT_SPOKEN'),
      ...constStrings(read('src/ui/chrome/Onboarding.tsx'), 'STEPS', 'title'),
      ...constStrings(read('src/ui/chrome/Onboarding.tsx'), 'STEPS', 'body'),
      ...constStrings(read('src/ui/sheets/ScopeSheet.tsx'), 'LAB_VIEW_OPTIONS', 'label'),
      ...constStrings(read('src/ui/sheets/ScopeSheet.tsx'), 'LAB_VIEW_TITLES'),
      ...constStrings(read('src/ui/sheets/AiSheet.tsx'), 'EXAMPLE_PROMPTS', 'chip'),
      ...constStrings(read('src/ui/sheets/AiSheet.tsx'), 'EXAMPLE_PROMPTS', 'prompt'),
    ]
    const more = read('src/ui/sheets/MoreSheet.tsx')
    for (const n of ['ABOUT_1', 'ABOUT_2', 'ABOUT_3']) {
      const m = more.match(new RegExp(`const ${n} =\\s*'((?:\\\\.|[^'])*)'`))
      expect(m, n).not.toBeNull()
      sources.push(m![1].replace(/\\'/g, "'"))
    }
    expect(sources.length).toBeGreaterThan(30)
    const missing = sources.filter((s) => !['MCU', 'UART'].includes(s) && !zhHas(s))
    expect(missing).toEqual([])
  })

  it('model labels shown by the sheets are covered (board sizes, render modes, examples, wire colors)', () => {
    const sources = [
      ...Object.values(BOARD_SIZES).map((b) => b.label),
      ...RENDER_MODE_IDS.flatMap((id) => [RENDER_MODES[id].label, RENDER_MODES[id].description]),
      ...EXAMPLES.map((e) => e.title),
    ]
    expect(sources.filter((s) => !zhHas(s))).toEqual([])
    __setLangForTests('zh-TW')
    for (const c of WIRE_COLORS) expect(wireColorLabel(c.name)).toMatch(/[\u4e00-\u9fff]/)
  })

  it('AI pipeline statuses, errors and expectation lines are localised', () => {
    __setLangForTests('zh-TW')
    const statuses = [
      'starting…',
      'cancelling…',
      'thinking…',
      'repairing (attempt 2)…',
      'designing circuit…',
      'validating…',
      'testing circuit in the simulator…',
    ]
    for (const s of statuses) expect(aiStatusText(s), s).toMatch(/[\u4e00-\u9fff]/)
    expect(aiStatusText('repairing (attempt 2)…')).toBe('修正中（第 2 次）…')
    const errors = [
      'Generation cancelled.',
      'No API key set — add your Anthropic API key first.',
      'Rate limited by the Claude API (429). Wait a minute and try again.',
      'The model "claude-x" was not found (404). Your account may not have access to it yet.',
      'The Claude API rejected the request (400): bad thing',
      'Claude API error (502): upstream',
      'Claude could not produce a working circuit after 3 attempts. Last failures:\n- a\n- b',
      'Generated circuit failed validation: x; y',
    ]
    for (const e of errors) expect(aiErrorText(e), e).toMatch(/[\u4e00-\u9fff]/)
    expect(aiErrorText('The model "claude-x" was not found (404). Your account may not have access to it yet.')).toContain(
      '"claude-x"',
    )
    const lines = [
      describeExpectation({ kind: 'led_on', target: 'D1' }),
      describeExpectation({ kind: 'led_off', target: 'D1' }),
      describeExpectation({ kind: 'led_blinks', target: 'D1', minHz: 0.5, maxHz: 3 }),
      describeExpectation({ kind: 'segments_show', target: 'DS1', digit: '7' }),
      describeExpectation({ kind: 'net_oscillates', target: 'f20', minHz: 1 }),
      describeExpectation({ kind: 'net_in_range', target: 'f20', minV: 1, maxV: 4 }),
      describeExpectation({ kind: 'buzzer_sounds', target: 'BZ1' }),
    ]
    for (const l of lines) {
      const zh = aiExpectationText(l)
      expect(zh, l).toMatch(/[\u4e00-\u9fff]/)
      expect(zh).not.toBe(l)
    }
    // English passes through untouched
    __setLangForTests('en')
    for (const s of [...statuses, ...errors, ...lines]) {
      expect(aiStatusText(s)).toBe(s)
      expect(aiErrorText(s)).toBe(s)
      expect(aiExpectationText(s)).toBe(s)
    }
  })

  it('placement hints: Chinese in zh-TW, the original English text in en', () => {
    __setLangForTests('en')
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' })).toBe(
      'Wire mode — tap two holes or terminals to connect them',
    )
    expect(hintForMode({ kind: 'wire', from: 'a5', color: 'red' })).toBe(
      'Wire from a5 — tap the second hole or terminal',
    )
    expect(hintForMode({ kind: 'place', type: 'resistor', pickedHoles: ['a1'] })).toBe(
      "Lead 2 of 2 — tap the hole for 'p2'",
    )
    // zh-TW is the new chrome (UX wave SH-5): every hint says how to get out
    // and names leads as a person reads them (tests/ux-shell-chrome.test.ts)
    __setLangForTests('zh-TW')
    expect(hintForMode({ kind: 'wire', from: 'a5', color: 'red' })).toBe('從 a5 拉線：點第二個孔位 · Esc 取消這條')
    expect(hintForMode({ kind: 'place', type: 'resistor', pickedHoles: ['a1'] })).toBe('第 2/2 腳：點「第 2 腳」的孔位 · Esc 取消')
    expect(hintForMode({ kind: 'select' })).toBeNull()
  })

  it('tc(): context entry in zh-TW, plain source in English', () => {
    __setLangForTests('zh-TW')
    expect(tc('Power', 'telemetry')).toBe('功率')
    expect(t('Power')).toBe('電源')
    expect(tc('Nothing here', 'ctx')).toBe('Nothing here')
    __setLangForTests('en')
    expect(tc('Power', 'telemetry')).toBe('Power')
    expect(wireColorLabel('red')).toBe('red')
  })

  it('dictionaries are Traditional Chinese with Taiwan terminology', () => {
    // simplified-only characters and mainland terms the glossary forbids
    const simplified = /[这们个为时电线键设计载导连显图关开择复读误辑头动发现换组态网络数据]/
    const mainland = /程序|文件|界面|信息|内存|默认|软件|硬件|视频|鼠标|屏幕|项目|优化|支持/
    const bad = Object.entries(MINE).filter(([, v]) => simplified.test(v) || mainland.test(v))
    expect(bad).toEqual([])
    // no key is defined twice across these three dictionaries
    const all = [core, chrome, sheets].flatMap((d) => Object.keys(d))
    expect(all.length).toBe(new Set(all).size)
    // placeholders survive translation
    for (const [k, v] of Object.entries(MINE)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      expect(ph(v), k).toBe(ph(k))
    }
  })

  it('no English words left (placeholders, proper names, key names aside), full-width punctuation, no mainland terms', () => {
    const proper = ['Claude', 'Anthropic', 'Console', 'Cmd', 'Ctrl', 'Enter']
    const bad: string[] = []
    for (const [k, v] of Object.entries(MINE)) {
      const text = v.replace(/\{\w+\}/g, ' ').replace(/api\.anthropic\.com|"sk-ant-"/g, ' ')
      const words = englishLeft(text, proper)
      const punct = halfWidthPunctuation(text)
      const terms = MAINLAND_TERMS.filter((m) => v.includes(m))
      if (words.length || punct.length || terms.length) bad.push(`${k} → ${v} ${JSON.stringify({ words, punct, terms })}`)
    }
    expect(bad).toEqual([])
  })
})

describe('AI system prompt reply language', () => {
  it('zh-TW appends a fixed Traditional Chinese reply rule; English is the original prompt', () => {
    const en = buildSystemPrompt('standard', 'en')
    const zh = buildSystemPrompt('standard', 'zh-TW')
    expect(en).not.toContain('## Reply language')
    expect(zh).toContain('## Reply language')
    expect(zh).toContain('Traditional Chinese')
    expect(zh.startsWith(en)).toBe(true)
    // byte-stable per language (prompt caching)
    expect(buildSystemPrompt('standard', 'zh-TW')).toBe(zh)
    expect(buildSystemPrompt('half', 'en')).toBe(buildSystemPrompt('half', 'en'))
    // defaults to the active UI language
    __setLangForTests('en')
    expect(buildSystemPrompt('standard')).toBe(en)
    __setLangForTests('zh-TW')
    expect(buildSystemPrompt('standard')).toBe(zh)
  })
})
