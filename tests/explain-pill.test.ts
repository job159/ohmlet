/**
 * 「電路說明」 on phones (round 5 — explain): the status pill's LOWEST tier,
 * tone 'explain' (src/ui/chrome/StatusPill.tsx statusPillModel +
 * explain.ts explainForPill):
 *  - below every error, warning, the debugger halt, the 保持按下 line, the
 *    auto-run pause line and the idle ready line — it speaks only when
 *    nothing else does;
 *  - a neutral dot, no action, no ›; its detail is both lines (the tap's toast);
 *  - absent while a lesson coach guides, on desktop (the card is there), in
 *    the classic chrome, for an empty board, or when there is no explanation;
 *  - the lesson coach line (coachLine, which reuses the model with guided)
 *    is unchanged by it.
 * Pure functions.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { statusPillModel, type PillInput } from '../src/ui/chrome/StatusPill'
import { explainForPill, type Explanation } from '../src/ui/chrome/explain'
import { stateColor } from '../src/ui/chrome/run-control'
import type { Problem } from '../src/ui/embedded/problems'
import { coachLine } from '../src/ui/lessons/LessonOverlay'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

const problem = (over: Partial<Problem>): Problem => ({
  id: over.id ?? 'p',
  level: 'warning',
  source: 'erc',
  title: 'T',
  detail: 'D',
  componentIds: [],
  holes: [],
  ...over,
})
const counts = (ps: Problem[]) => ({
  error: ps.filter((p) => p.level === 'error').length,
  warning: ps.filter((p) => p.level === 'warning').length,
  info: ps.filter((p) => p.level === 'info').length,
})

const LIT: Explanation = {
  tone: 'ok',
  dot: 'var(--ios-green)',
  lines: ['LED1 亮著：亮度 49 %（9.70 mA）', '由 5.00 V 經 R1 330 Ω 供電'],
  subjectIds: ['LED1'],
  key: '5:LED1:lit',
  short: 'LED1 亮著：亮度 49 %（9.70 mA）',
  tier: 5,
}
const explain = explainForPill(LIT, { desktop: false, legacy: false })!
const base: PillInput = { problems: [], counts: counts([]), phase: 'running', haltedId: null, boardEmpty: false, explain }

describe('the phone pill’s 「電路說明」 tier', () => {
  it('speaks when nothing else does: line 1, a neutral dot, no action, no ›; the tap shows both lines', () => {
    const m = statusPillModel(base)!
    expect(m.tone).toBe('explain')
    expect(m.text).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    expect(m.detail).toBe('LED1 亮著：亮度 49 %（9.70 mA）。由 5.00 V 經 R1 330 Ω 供電')
    expect(m.dot).toBe(stateColor('idle'))
    expect(m.action).toBeNull()
    expect(m.opensProblems).toBe(false)
    expect(m.more).toBe(0)
    // a paused session too (auto-run off: no pause line)
    expect(statusPillModel({ ...base, phase: 'paused' })!.tone).toBe('explain')
  })

  it('sits below every error, warning, the halt, 保持按下, the pause line and the ready line', () => {
    const err = [problem({ id: 'e', level: 'error', title: 'U1 沒有供電' })]
    const warn = [problem({ id: 'w', level: 'warning', title: 'LED1 的限流電阻太小' })]
    expect(statusPillModel({ ...base, problems: err, counts: counts(err) })!.tone).toBe('error')
    expect(statusPillModel({ ...base, problems: warn, counts: counts(warn) })!.tone).toBe('warning')
    expect(statusPillModel({ ...base, phase: 'halted', haltedId: 'U1' })!.tone).toBe('warning')
    expect(statusPillModel({ ...base, latched: ['SW1'] })!.tone).toBe('latched')
    expect(statusPillModel({ ...base, phase: 'paused', userPaused: true })!.tone).toBe('paused')
    expect(statusPillModel({ ...base, phase: 'idle' })!.tone).toBe('neutral')
    // info rows never speak in the pill: the explanation does
    const info = [problem({ id: 'i', level: 'info', title: '提示' })]
    expect(statusPillModel({ ...base, problems: info, counts: counts(info) })!.tone).toBe('explain')
  })

  it('absent while a coach guides, or without an explanation', () => {
    expect(statusPillModel({ ...base, guided: true })).toBeNull()
    expect(statusPillModel({ ...base, explain: null })).toBeNull()
    const { explain: _omit, ...without } = base
    expect(statusPillModel(without)).toBeNull()
  })

  it('explainForPill: phones only — never on desktop, in the classic chrome or for an empty board', () => {
    expect(explainForPill(LIT, { desktop: true, legacy: false })).toBeNull()
    expect(explainForPill(LIT, { desktop: false, legacy: true })).toBeNull()
    expect(explainForPill(null, { desktop: false, legacy: false })).toBeNull()
    const empty: Explanation = { ...LIT, lines: ['麵包板上還沒有元件。'], short: '麵包板上還沒有元件。', key: 'empty', subjectIds: [], tier: 9 }
    expect(explainForPill(empty, { desktop: false, legacy: false })).toBeNull()
    // one line: the detail is that line
    const one: Explanation = { ...LIT, lines: ['U1 正在跑 hal-blink.elf'], short: 'U1 正在跑 hal-blink.elf' }
    expect(explainForPill(one, { desktop: false, legacy: false })).toEqual({ text: 'U1 正在跑 hal-blink.elf', detail: 'U1 正在跑 hal-blink.elf' })
  })

  it('the lesson coach line is unchanged (it never passes an explanation, and guided hides it anyway)', () => {
    const pending = problem({ id: 'i1', level: 'info', title: 'U1 PB12 輸入浮接', pendingRuntime: true })
    expect(coachLine({ problems: [], counts: counts([]), phase: 'running', boardEmpty: false })).toBeNull()
    expect(coachLine({ problems: [pending], counts: counts([pending]), phase: 'idle', boardEmpty: false })).toMatchObject({ kind: 'pending' })
    const err = [problem({ id: 'e', level: 'error', title: 'U1 沒有供電' })]
    expect(coachLine({ problems: err, counts: counts(err), phase: 'running', boardEmpty: false })).toMatchObject({ kind: 'problem', text: 'U1 沒有供電' })
  })
})

describe('the phone pill’s 「電路說明」 for screen readers', () => {
  it('a polite live region (outside the tap button) says subject / state changes — the pill itself stays aria-live off for its 2 Hz numbers', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../src/ui/chrome/StatusPill.tsx'), 'utf8')
    expect(src).toMatch(/aria-live=\{shown\.tone === 'explain' \? 'off' : 'polite'\}/)
    // the live region: only for the explain line, fed by the watcher's rate-limited announcement
    expect(src).toMatch(/\{shown\.tone === 'explain' && \(\s*<span className="app-pill-live" aria-live="polite">\s*\{explanation\?\.announce \?\? ''\}/)
    // not inside the body button (its name stays line 1)
    const button = /className="app-pill-body is-explain[\s\S]*?<\/button>/.exec(src)![0]
    expect(button).not.toMatch(/app-pill-live/)
    const css = readFileSync(path.resolve(__dirname, '../src/ui/chrome/StatusPill.css'), 'utf8')
    expect(css).toMatch(/\.app-pill-live\s*\{[^}]*clip: rect\(0 0 0 0\)/)
  })
})
