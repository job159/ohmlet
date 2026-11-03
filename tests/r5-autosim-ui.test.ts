/**
 * Auto-run (round 5 — 「改了就自動模擬，不用按執行」): what the learner reads
 * and what holds auto-run back —
 *  - the status pill's tier for the learner's own pause (「模擬已暫停——改動接線
 *    或元件就會自動繼續」〔繼續執行〕 — it names what resumes it: a knob or a
 *    button keeps the pause), only when auto-run would resume it, below the
 *    problems / halt / latches, never for a pause it did not see; no 「電路
 *    已就緒」 while auto-run is about to start the board (autoRunWaiting);
 *  - the 顯示電流 toast names no Run button (paused: 「模擬繼續後」);
 *  - the empty board's card: what is opened simulates by itself;
 *  - no lesson text sends the learner to 「▶ 執行模擬」 / the Space bar to run
 *    (only a pause clause may still name it);
 *  - the floating lesson coach folds only for a run the learner started;
 *  - the capsule's ring pulses ~3 s after a start, not forever;
 *  - lab.importProject and loadLessonCircuit hold the run gate for the whole
 *    load (the release fires once they are done);
 *  - the zh-TW dictionary keeps Taiwan usage and the term table.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import autosim from '../src/i18n/zh-TW/autosim'
import { useStore } from '../src/state/store'
import { __resetRunGateForTests, autoRunHeld, noteAutoStart, onAutoRunRelease } from '../src/state/run-gate'
import { useLab } from '../src/ui/embedded/lab'
import type { Problem } from '../src/ui/embedded/problems'
import { statusPillModel, type PillInput } from '../src/ui/chrome/StatusPill'
import { toggleFlowView } from '../src/ui/chrome/FlowToggle'
import { EmptyState } from '../src/ui/chrome/EmptyState'
import { useFlowView } from '../src/ui/fx/flow'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import { loadLessonCircuit, stopGuide } from '../src/ui/lessons/actions'
import { runFoldsCoach } from '../src/ui/lessons/LessonOverlay'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const lastToast = () => getToasts()[getToasts().length - 1]?.text ?? ''

beforeEach(() => {
  __setLangForTests('zh-TW')
  for (const x of getToasts()) dismissToast(x.id)
})
afterEach(() => {
  __setLangForTests('zh-TW')
  useStore.setState({ running: false, simTime: 0 })
})

// ---------------------------------------------------------------- status pill
describe('the status pill names the learner’s own pause (auto-run on)', () => {
  const base: PillInput = { problems: [], counts: { error: 0, warning: 0, info: 0 }, phase: 'paused', haltedId: null, boardEmpty: false }

  it('「模擬已暫停——改動接線或元件就會自動繼續」 with 〔繼續執行〕 (a state, not a problem: the body opens nothing)', () => {
    const m = statusPillModel({ ...base, userPaused: true })!
    expect([m.tone, m.text, m.action?.label, m.opensProblems, m.more]).toEqual([
      'paused',
      '模擬已暫停——改動接線或元件就會自動繼續',
      '繼續執行',
      false,
      0,
    ])
    expect(m.dot).toBe('var(--ios-blue)') // the paused blue of the one state table (H6)
    // a knob / a button keeps the pause: the line names what resumes it, not 「改動電路」 (which a
    // learner may read as turning a knob)
    expect(m.text).not.toContain('改動電路')
  })

  it('no 「電路已就緒」〔執行模擬〕 while auto-run is about to start the board (the boot’s restore, a held load)', () => {
    const idle: PillInput = { ...base, phase: 'idle' }
    expect(statusPillModel(idle)?.text).toBe('電路已就緒（空白鍵）')
    expect(statusPillModel({ ...idle, autoStarting: true })).toBeNull()
    // a problem still speaks meanwhile
    const warn: Problem = { id: 'w', level: 'warning', source: 'erc', title: 'LED1 陰極沒接', detail: 'd', componentIds: ['LED1'], holes: [] }
    expect(statusPillModel({ ...idle, autoStarting: true, problems: [warn], counts: { error: 0, warning: 1, info: 0 } })?.text).toBe('LED1 陰極沒接')
  })

  it('only for a pause auto-run would resume; a problem, a halt and kept-pressed parts speak first', () => {
    expect(statusPillModel({ ...base, userPaused: false })).toBeNull() // as before auto-run
    const warn: Problem = { id: 'w', level: 'warning', source: 'erc', title: 'LED1 陰極沒接', detail: 'd', componentIds: ['LED1'], holes: [] }
    expect(statusPillModel({ ...base, userPaused: true, problems: [warn], counts: { error: 0, warning: 1, info: 0 } })?.text).toBe('LED1 陰極沒接')
    expect(statusPillModel({ ...base, userPaused: true, latched: ['SW1'] })?.tone).toBe('latched')
    expect(statusPillModel({ ...base, phase: 'halted', haltedId: 'U1', userPaused: true })?.text).toBe('U1 核心已停住（偵錯器）')
    // a reset of that pause (t = 0): the ready line, as before
    expect(statusPillModel({ ...base, phase: 'idle', userPaused: true })?.text).toBe('電路已就緒（空白鍵）')
    expect(statusPillModel({ ...base, phase: 'running', userPaused: true })).toBeNull()
  })

  it('the component asks the store why it stopped and whether auto-run is on', () => {
    const src = read('src/ui/chrome/StatusPill.tsx')
    expect(src).toMatch(/userPaused: phase === 'paused' && simStopReason\(\) === 'user' && autoRunEnabled\(\)/)
    expect(src).toMatch(/const autoStarting = useAutoRunWaiting\(\)/)
    expect(src).toMatch(/^\s+autoStarting,$/m)
  })
})

// ---------------------------------------------------------------- 顯示電流 toast
describe('the 顯示電流 toast sends nobody to a Run button', () => {
  beforeEach(() => useFlowView.getState().setVisible(false))
  afterEach(() => useFlowView.getState().setVisible(false))

  it('paused by the learner: the dots come when the simulation goes on', () => {
    useStore.setState({ running: false, simTime: 1.5 })
    toggleFlowView(false)
    expect(lastToast()).toBe('已開啟電流顯示——模擬繼續後就會看到電流流動')
  })

  it('nothing simulating yet: the dots show while it runs (no 「執行模擬」 instruction)', () => {
    useStore.setState({ running: false, simTime: 0 })
    toggleFlowView(false)
    expect(lastToast()).toBe('已開啟電流顯示——模擬執行時就會看到電流流動')
    expect(lastToast()).not.toContain('執行模擬')
  })
})

// ---------------------------------------------------------------- empty state
describe('the empty board’s card', () => {
  it('opening a lesson or an example needs no Run press', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { onBrowseParts: () => {}, onAskAi: () => {} }))
    expect(html).toContain('跟著課程一步一步做，或開啟現成的範例。\n電路會自動開始模擬。')
    expect(html).not.toContain('執行模擬')
  })

  it('the classic chrome keeps its own card', () => {
    __setLangForTests('en')
    const html = renderToStaticMarkup(createElement(EmptyState, { onBrowseParts: () => {}, onAskAi: () => {} }))
    expect(html).toContain('Build your first circuit')
  })
})

// ---------------------------------------------------------------- lessons
describe('lesson texts: the simulation runs by itself', () => {
  const files = (() => {
    const out: string[] = []
    const walk = (rel: string) => {
      for (const name of readdirSync(path.join(ROOT, rel))) {
        const child = `${rel}/${name}`
        if (statSync(path.join(ROOT, child)).isDirectory()) walk(child)
        else if (name.endsWith('.lesson.ts')) out.push(child)
      }
    }
    walk('src/lessons')
    return out
  })()

  it('no step tells the learner to press 「▶ 執行模擬」 or the Space bar to start a run (a pause clause may name it)', () => {
    expect(files.length).toBeGreaterThan(20)
    const bad: string[] = []
    for (const f of files) {
      read(f)
        .split('\n')
        .forEach((line, i) => {
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
          if (line.includes('空白鍵')) bad.push(`${f}:${i + 1} 空白鍵`)
          if (line.includes('執行模擬') && !line.includes('暫停')) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 40)}`)
        })
    }
    expect(bad).toEqual([])
  })

  it('the run steps say so: b1 「模擬會自動執行」, i5 after its firmware load', () => {
    const b1 = lessonById('b1-led-resistor')!
    const s5 = b1.steps.find((s) => s.id === 'b1-s5')!
    expect(s5.title).toBe('LED1 亮起，確認電流')
    expect(String(s5.body)).toContain('模擬會自動執行，LED1 應該亮起')
    const i5 = lessonById('i5-uart')!
    expect(i5.steps.some((s) => String(s.body).includes('按下方的「載入 hal-uart-hello 到 U1」，載入後模擬會自動執行'))).toBe(true)
  })
})

// ---------------------------------------------------------------- lesson coach
describe('the floating lesson coach folds only for a run the learner started', () => {
  afterEach(() => __resetRunGateForTests())

  it('a run auto-run started keeps the card open (else it would stay folded for good); a user run folds it', () => {
    const layout = useStore.getState().layout
    noteAutoStart({ reason: 'edit', layout, rev: '' })
    expect(runFoldsCoach(true, false)).toBe(false)
    noteAutoStart({ reason: 'load', layout, rev: '' })
    expect(runFoldsCoach(true, false)).toBe(false)
    noteAutoStart(null) // the capsule, Space, a step's ▶
    expect(runFoldsCoach(true, false)).toBe(true)
    expect(runFoldsCoach(true, true)).toBe(false) // docked: never
    expect(runFoldsCoach(false, false)).toBe(false)
  })
})

// ---------------------------------------------------------------- capsule ring
describe('the capsule’s running ring', () => {
  it('pulses twice (~3 s) after a start, then rests — never forever; reduced motion still turns it off', () => {
    const css = read('src/app.css')
    const rule = /\.app-run-disc\.is-running::before\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/animation:\s*app-dot-pulse 1\.5s var\(--lg-spring\) 2;/)
    expect(rule![1]).not.toContain('infinite')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.app-run-disc\.is-running::before,[\s\S]*?animation: none/)
  })
})

// ---------------------------------------------------------------- the run gate
describe('multi-step loads hold auto-run until their firmware is bound', () => {
  const memory = new Map<string, string>()
  let releases = 0
  let off: (() => void) | null = null
  beforeEach(() => {
    memory.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
      setItem: (k: string, v: string) => void memory.set(k, String(v)),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
    })
    reloadLessonProgress()
    __resetRunGateForTests()
    releases = 0
    off = onAutoRunRelease(() => releases++)
    useStore.getState().resetSim()
    useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' } })
    useLab.setState({ firmware: {}, mcus: {} })
  })
  afterEach(() => {
    off?.()
    off = null
    stopGuide()
    vi.unstubAllGlobals()
    __resetRunGateForTests()
  })

  it('lab.importProject holds it for the whole call (even one that fails)', async () => {
    const pending = useLab.getState().importProject('{ not json')
    expect(autoRunHeld()).toBe(true)
    const res = await pending
    expect(res.ok).toBe(false)
    expect(autoRunHeld()).toBe(false)
    expect(releases).toBe(1)
  })

  it('loadLessonCircuit holds it until the lesson circuit (and its firmware) is in place', async () => {
    const pending = loadLessonCircuit(lessonById('b1-led-resistor')!, 'start')
    expect(autoRunHeld()).toBe(true)
    expect(await pending).toBe(true)
    expect(autoRunHeld()).toBe(false)
    expect(releases).toBe(1)
    expect(useStore.getState().layout.components.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- dictionary
describe('zh-TW auto-run strings', () => {
  it('Taiwan usage, placeholders kept, full-width punctuation, the run verbs of the term table', () => {
    expect(Object.keys(autosim).length).toBeGreaterThan(0)
    const bad: string[] = []
    for (const [k, v] of Object.entries(autosim)) {
      expect(t(k), k).toBe(v) // nothing later-sorted shadows it
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      if (ph(v) !== ph(k.split('|')[0])) bad.push(`placeholders: ${k}`)
      const text = v.replace(/\{\w+\}/g, ' ')
      if (englishLeft(text).length || halfWidthPunctuation(text).length || MAINLAND_TERMS.some((m) => v.includes(m))) bad.push(v)
      // 執行中 only as 模擬執行中; never a bare 「▶ 執行」
      if (/正在執行|(?<!模擬)執行中|▶ ?執行(?!模擬)/.test(v)) bad.push(`term: ${v}`)
    }
    expect(bad).toEqual([])
    __setLangForTests('en')
    expect(t('Simulation paused — editing parts or wires resumes it|autosim')).toBe('Simulation paused — editing parts or wires resumes it')
  })
})
