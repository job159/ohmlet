/**
 * The zh-TW documentation speaks the product's language: the canonical term
 * table (docs/ux/UX_VERIFY.md §5.4 — the same rules tests/ux-shell-terms.test.ts
 * enforces on the dictionaries and lessons) and Taiwan usage (the mainland
 * terms of tests/i18n/zh-check.ts).
 *
 *   佔空比          → 工作週期
 *   在場景中標示     → 在電路板上標示／取消標示
 *   入門 (難度)      → 初級／中級／進階   (「輸入門檻」 is not a difficulty)
 *   n 支引腳        → n 腳
 *   探針            → 探棒
 *   未載入韌體       → 還沒有韌體
 *   raw refs        → pinLabel / terminalLabel / endpointName wording
 *                     (user-facing pages only: README.md, docs/user-guide.md)
 *
 * Code (fenced blocks and inline code spans) and URLs are not prose and are
 * skipped, and so is a region fenced by `<!-- docs-terms: allow` …
 * `<!-- docs-terms: end -->` (the developer guide's term table lists the
 * words NOT to use). 文件 is Taiwan usage for "documentation" (a file is 檔案),
 * so the mainland list is applied without it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAINLAND_TERMS } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')

/** The Traditional Chinese docs (README.en.md and ARCHITECTURE.md are English). */
const ZH_DOCS = [
  'README.md',
  'CHANGELOG.md',
  'docs/user-guide.md',
  'docs/firmware-guide.md',
  'docs/developer-guide.md',
  'docs/support-matrix.md',
  'docs/third-party-notices.md',
]
/** Pages written for the learner: raw part / terminal refs must not appear in their prose. */
const USER_PAGES = ['README.md', 'docs/user-guide.md']

/** The same pattern as tests/ux-shell-terms.test.ts (RAW_REF). */
const RAW_REF = /\b(3V3|GND)_\d\b|\bU\d+\.(REG|P[A-E]\d+)\b|\b[A-Z]+\d+:[+-]/

const RULES: readonly { id: string; use: string; test: (s: string) => boolean }[] = [
  // the glossary entry 「工作週期（又稱佔空比）」 names the other word on purpose
  { id: 'duty', use: '工作週期', test: (s) => s.replace(/又稱佔空比/g, '').includes('佔空比') },
  { id: 'mark-scene', use: '在電路板上標示／取消標示', test: (s) => s.includes('在場景中標示') },
  { id: 'difficulty', use: '初級／中級／進階', test: (s) => /(?<!輸)入門(?!檻)/.test(s) },
  { id: 'leads', use: 'n 腳', test: (s) => s.includes('支引腳') },
  { id: 'probe-tip', use: '探棒', test: (s) => s.includes('探針') },
  { id: 'no-firmware', use: '還沒有韌體', test: (s) => s.includes('未載入韌體') },
]

/** Prose lines of a markdown file: no fenced code, no inline code, no URLs, no allow regions. */
function proseLines(markdown: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  let fence = false
  let allow = false
  markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      if (/<!--\s*docs-terms:\s*allow/.test(raw)) allow = true
      if (/<!--\s*docs-terms:\s*end\s*-->/.test(raw)) {
        allow = false
        return
      }
      if (/^\s*(```|~~~)/.test(raw)) {
        fence = !fence
        return
      }
      if (fence || allow) return
      const text = raw
        .replace(/`[^`]*`/g, ' ')
        .replace(/\]\([^)]*\)/g, ']')
        .replace(/<https?:[^>]*>/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
      out.push({ line: i + 1, text })
    })
  return out
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('docs: canonical terms and Taiwan usage', () => {
  it('the zh-TW docs use the canonical term table', () => {
    const problems: string[] = []
    for (const file of ZH_DOCS) {
      for (const { line, text } of proseLines(read(file))) {
        for (const r of RULES) if (r.test(text)) problems.push(`${file}:${line} [${r.id}] use 「${r.use}」: ${text.trim().slice(0, 80)}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('the learner-facing pages name pins and terminals, never raw refs', () => {
    const problems: string[] = []
    for (const file of USER_PAGES) {
      for (const { line, text } of proseLines(read(file))) {
        // a ref inside "double quotes" is a syntax example
        if (RAW_REF.test(text.replace(/"[^"\n]*"/g, ''))) problems.push(`${file}:${line}: ${text.trim().slice(0, 80)}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('the zh-TW docs use Taiwan terms (程式、介面、記憶體、預設、資料、設定、網路…)', () => {
    const terms = MAINLAND_TERMS.filter((w) => w !== '文件')
    const problems: string[] = []
    for (const file of ZH_DOCS) {
      for (const { line, text } of proseLines(read(file))) {
        for (const w of terms) if (text.includes(w)) problems.push(`${file}:${line} 「${w}」: ${text.trim().slice(0, 80)}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('the rules catch what they are meant to catch', () => {
    const hit = (s: string) => RULES.filter((r) => r.test(s)).map((r) => r.id)
    expect(hit('佔空比 50 %')).toEqual(['duty'])
    expect(hit('工作週期（又稱佔空比）')).toEqual([])
    expect(hit('入門範例')).toEqual(['difficulty'])
    expect(hit('輸入門檻 0.8 V')).toEqual([])
    expect(hit('P1 探針')).toEqual(['probe-tip'])
    expect(proseLines('a\n```\n佔空比\n```\n`佔空比`\n<!-- docs-terms: allow -->\n佔空比\n<!-- docs-terms: end -->\nb').map((l) => l.text.trim())).toEqual([
      'a',
      '',
      'b',
    ])
  })
})
