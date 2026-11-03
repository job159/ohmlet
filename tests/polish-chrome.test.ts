/**
 * Round 5 polish — the 「電路說明」 card and 〔換新〕 where the learner is
 * (stream "chrome"):
 *
 *  (a) wording: a prediction before a run reads 「LED1 不會亮：…」 (never the
 *      awkward 「會亮不起來」), the open cathode 「陰極（c20）沒有接地」 and its
 *      fix 「用導線把 … 接到 …」 (the Problems rows' own phrasing), Taiwan
 *      terms (板載 LED, 撥動, 不會執行任何程式 …), no translationese;
 *  (b) the card's box: three text lines while the words fit them, FOUR
 *      (two + two / one + three) when line 1 and line 2 both wrap — the fix
 *      is never cut off; it grows at once and shrinks only after a dwell
 *      (explainBoxFit + ExplainCard.css; the real growth is replayed by
 *      scripts/ux-e2e/explain-card.mjs);
 *  (c) 〔換新〕 for several parts in ONE host call, one sound, one toast
 *      「已換上新的 LED1、LED2」 (the selection pill, 〔全部換新〕 in the
 *      Problems list header);
 *  (e) a guided lesson step that asks the learner to MEASURE a value: the
 *      card says the state, never that number (lessonSecrets, the watcher).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import explainZh from '../src/i18n/zh-TW/explain'
import { lessonById } from '../src/lessons'
import { useLessonProgress } from '../src/lessons/progress'
import type { LessonCheck } from '../src/lessons/types'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import { SimEngine } from '../src/sim/engine'
import { runErc, type ErcFinding } from '../src/sim/erc'
import '../src/sim/models'
import { __resetHistoryForTests, __setSimHostFactoryForTests, getSimHost, stepSimTime, useStore } from '../src/state/store'
import { explainCircuit, lessonSecrets, newExplainHistory, observeTelemetry, type ExplainHistory, type ExplainInput, type ExplainSecrets } from '../src/ui/chrome/explain'
import { ledDrivePath } from '../src/ui/chrome/explain-path'
import { EXPLAIN_CARD_H, EXPLAIN_CARD_TALL_H, EXPLAIN_SHRINK_MS, explainBoxFit, unbroken } from '../src/ui/chrome/ExplainCard'
import { damagedSelectionKey } from '../src/ui/chrome/SelectionPill'
import { guidedStepCheck, startExplainWatcher, useExplainView } from '../src/ui/chrome/useExplanation'
import { useLab } from '../src/ui/embedded/lab'
import { ProblemsView } from '../src/ui/embedded/ProblemsList'
import { ProblemsPanelView } from '../src/ui/embedded/ErcPanel'
import { deriveProblems, useProblems, type Problem } from '../src/ui/embedded/problems'
import { damagedPartIds, replaceAllDamagedWithFeedback, replaceLabel, replacePartsWithFeedback } from '../src/ui/embedded/replace-part'
import { playMech } from '../src/ui/fx/sound'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { useLessonUi } from '../src/ui/lessons/state'
import { EXAMPLES } from '../src/ui/workspace/examples'
import { valid } from './erc/helpers'

vi.mock('../src/ui/fx/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/fx/sound')>()),
  playMech: vi.fn(),
}))

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  vi.stubGlobal('navigator', { vibrate: vi.fn() })
  vi.mocked(playMech).mockClear()
  __setLangForTests('zh-TW')
  __resetHistoryForTests?.()
  for (const x of getToasts()) dismissToast(x.id)
})
afterEach(() => {
  __setSimHostFactoryForTests(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useStore.setState({ selection: [], telemetry: null, running: false })
  useLessonUi.setState({ coachId: null })
  __setLangForTests('zh-TW')
})

// ---------------------------------------------------------------- circuits
const PS = (v = 5) => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
const led = (id: string, holes: string[]) => ({ id, type: 'led', holes, params: { color: 'red' } })
const res = (id: string, holes: string[], r: number) => ({ id, type: 'resistor', holes, params: { resistance: r } })
/** PS1 → R1 330 Ω → LED1 → − rail (the classic first circuit) */
const LIT = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4'])], wires: RAILS } as CircuitLayout)
/** the same with LED1's cathode in c20, wired to nothing */
const OPEN = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'c20'])], wires: RAILS } as CircuitLayout)

interface Run {
  layout: CircuitLayout
  tele: SimTelemetry
  findings: ErcFinding[]
  problems: Problem[]
  history: ExplainHistory
  explain(over?: Partial<ExplainInput>): ReturnType<typeof explainCircuit>
}
/** `layout` simulated `seconds` at the store's 10 Hz, every snapshot observed; the rule check on the last one. */
function run(layout: CircuitLayout, seconds: number): Run {
  const engine = new SimEngine(layout)
  const history = newExplainHistory()
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    engine.advance(0.1, 1e-3)
    observeTelemetry(history, layout, engine.telemetry())
  }
  const tele = engine.telemetry()
  const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
  const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
  return {
    layout,
    tele,
    findings,
    problems,
    history,
    explain: (over = {}) => explainCircuit({ layout, telemetry: tele, phase: 'running', problems, findings, history, ...over }),
  }
}
/** before any run: the rule check only */
function staticOf(layout: CircuitLayout): ReturnType<typeof explainCircuit> {
  const findings = runErc(layout, {})
  const problems = deriveProblems({ layout, findings, issues: [], firmware: {}, mcus: {}, running: false, simTime: 0 })
  return explainCircuit({ layout, telemetry: null, phase: 'idle', problems, findings })
}

// ====================================================================== (a)
describe('(a) wording: natural Taiwan Chinese, the app’s own terms', () => {
  it('a prediction before a run: 「LED1 不會亮：陰極（c20）沒有接地」 / 「用導線把 LED1 陰極（c20）接到 … 電源軌 第 n 孔」', () => {
    const e = staticOf(OPEN)
    expect(e.lines[0]).toBe('LED1 不會亮：陰極（c20）沒有接地')
    expect(e.lines[1]).toMatch(/^用導線把 LED1 陰極（c20）接到上方 − 電源軌 第 \d+ 孔$/)
    // running: the effect, the same cause and fix
    const live = run(OPEN, 0.5).explain()
    expect(live.lines[0]).toBe('LED1 不亮：陰極（c20）沒有接地')
  })

  it('every prediction says 「不會…」 and no line uses the old awkward / literal phrasing', () => {
    expect(t('{id} cannot light|explain', { id: 'LED1' })).toBe('LED1 不會亮')
    expect(t('{id} cannot sound|explain', { id: 'BZ1' })).toBe('BZ1 不會響')
    expect(t('{id} cannot turn|explain', { id: 'M1' })).toBe('M1 不會轉')
    expect(t('{id} cannot show anything|explain', { id: 'OLED1' })).toBe('OLED1 不會顯示')
    const bad = ['會亮不起來', '會響不起來', '會轉不起來', '顯示不出來', '那一排', '核心不會動', '板上的 LED', '的板上 LED', '恢復它', '拉一條導線', '轉過來', '沒有在跑', '它的腳都', '切在']
    const hits = Object.entries(explainZh).filter(([, v]) => bad.some((b) => v.includes(b)))
    expect(hits).toEqual([])
  })

  it('the app’s terms: 板載 LED, 撥動 for a switch, 〔換新〕 / 限流電阻 kept, one 「；」 joint before 「改好就會…」', () => {
    expect(t('{id}’s on-board LED ({pin}) is lit|explain', { id: 'U1', pin: 'PC13' })).toBe('U1 的板載 LED（PC13）亮著')
    expect(t('Flip {id} to close the circuit|explain', { id: 'SW1' })).toBe('撥動 SW1，電路就會接通')
    expect(t('{id} has no firmware, so its core does not run|explain', { id: 'U1' })).toBe('U1 沒有韌體，不會執行任何程式')
    const recover = Object.values(explainZh).filter((v) => v.includes('改好就會自動換上新的'))
    expect(recover.length).toBeGreaterThan(3)
    for (const v of recover) expect(v, v).toMatch(/；改好就會自動換上新的/)
  })
})

// ====================================================================== (b)
const CSS = read('src/ui/chrome/ExplainCard.css')
/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|\\}|\\*/)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(CSS)
  return m ? m[1] : ''
}
const px = (block: string, prop: string): number => {
  const m = new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)
  return m ? parseFloat(m[1]) : NaN
}
const lh = (block: string): number => {
  const m = /font:\s*\d+\s+\d+px\/(\d+)px/.exec(block)
  return m ? +m[1] : NaN
}
const clampOf = (block: string): number => {
  const m = /-webkit-line-clamp:\s*(\d+)/.exec(block)
  return m && !/white-space:\s*nowrap/.test(block) ? +m[1] : 1
}

/** Estimated advance of `text` at `size` px (CJK / full-width 1 em, Latin narrower) — as tests/explain-card.test.ts. */
function textWidth(text: string, size: number, bold = false): number {
  let em = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) em += 1
    else if (ch === ' ' || ch === ' ') em += 0.28
    else if (/[0-9]/.test(ch)) em += 0.57
    else if (/[A-Z]/.test(ch)) em += 0.66
    else if (/[a-z]/.test(ch)) em += 0.53
    else em += 0.62
  }
  return em * size * (bold ? 1.04 : 1)
}

describe('(b) the card’s box: three lines, four when the words need them — never a cut-off fix', () => {
  it('explainBoxFit: line 1 wraps → two of line 1; four lines when line 2 wraps too, or line 2 needs three', () => {
    expect(explainBoxFit(1, 0)).toEqual({ l1Long: false, tall: false })
    expect(explainBoxFit(1, 2)).toEqual({ l1Long: false, tall: false })
    expect(explainBoxFit(2, 1)).toEqual({ l1Long: true, tall: false })
    // the walkthrough's case: line 1 wrapped AND line 2 wrapped — it was clamped to one line of line 2
    expect(explainBoxFit(2, 2)).toEqual({ l1Long: true, tall: true })
    expect(explainBoxFit(1, 3)).toEqual({ l1Long: false, tall: true })
    expect(explainBoxFit(3, 0)).toEqual({ l1Long: true, tall: true })
  })

  it('the tall box (EXPLAIN_CARD_TALL_H) holds two + two and one + three; the three-line box stays EXPLAIN_CARD_H', () => {
    expect(px(rule('.app-explain'), 'height')).toBe(EXPLAIN_CARD_H)
    expect(px(rule('.app-explain.is-tall'), 'height')).toBe(EXPLAIN_CARD_TALL_H)
    expect(EXPLAIN_CARD_TALL_H).toBeGreaterThan(EXPLAIN_CARD_H)
    expect(clampOf(rule('.app-explain.is-tall .app-explain-l2'))).toBe(3)
    expect(clampOf(rule('.app-explain.is-tall.is-l1-long .app-explain-l2'))).toBe(2)
    expect(clampOf(rule('.app-explain.is-l1-long .app-explain-l1'))).toBe(2)
    const pad = /padding:\s*(\d+)px\s+\d+px\s+(\d+)px/.exec(rule('.app-explain-body'))!
    const inner = EXPLAIN_CARD_TALL_H - +pad[1] - +pad[2]
    const l1 = lh(rule('.app-explain-l1'))
    const l2 = lh(rule('.app-explain-l2'))
    expect(2 * l1 + 2 * l2).toBeLessThanOrEqual(inner)
    expect(l1 + 3 * l2).toBeLessThanOrEqual(inner)
    // measuring lifts every clamp for one layout pass
    const measuring = rule('.app-explain.is-measuring .app-explain-l1,\n.app-explain.is-measuring .app-explain-l2')
    expect(measuring).toMatch(/line-clamp:\s*none/)
    // … in every box state: the tall / l1-long clamps (up to 0,5,0) never win over it (integration)
    for (const prop of ['display', '-webkit-line-clamp', 'line-clamp', 'white-space', 'overflow']) {
      expect(measuring).toMatch(new RegExp(`(^|[;\\s])${prop}:[^;]*!important`))
    }
  })

  it('grows before the paint, shrinks only after the dwell (the inspector moves rarely), at once under ?shotrig', () => {
    const card = read('src/ui/chrome/ExplainCard.tsx')
    expect(EXPLAIN_SHRINK_MS).toBeGreaterThanOrEqual(3000)
    expect(card).toMatch(/if \(fit\.tall\) \{\s*if \(!tall\) setTall\(true\)/)
    expect(card).toMatch(/setTimeout\(\(\) => setTall\(false\), EXPLAIN_SHRINK_MS\)/)
    expect(card).toMatch(/if \(shotRig\(\)\) \{\s*setTall\(false\)/)
    // the height reaches the inspector through the measured box (--ws-explain-h = height + 8)
    expect(card).toMatch(/--ws-explain-h/)
    expect(card).toMatch(/\$\{tall \? ' is-tall' : ''\}/)
  })

  it('the walkthrough’s open cathode now takes one line of line 1 at the 340 px column; its fix fits two', () => {
    const e = staticOf(valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'd18'])], wires: RAILS } as CircuitLayout))
    const side = /padding:\s*\d+px\s+(\d+)px\s+\d+px\s+(\d+)px/.exec(rule('.app-explain-body'))!
    const W = 340 - +side[1] - +side[2] - px(rule('.app-explain-dot'), 'width') - px(rule('.app-explain-row'), 'gap')
    expect(textWidth(unbroken(e.lines[0]), 14, true)).toBeLessThanOrEqual(W)
    expect(textWidth(unbroken(e.lines[1]!), 13)).toBeLessThanOrEqual(2 * W * 0.94)
    // before: 「LED1 會亮不起來：陰極那一排（d18）沒有接到地」 did not fit one line
    expect(textWidth('LED1 會亮不起來：陰極那一排（d18）沒有接到地', 14, true)).toBeGreaterThan(W)
  })

  it('a hole name never breaks inside 「第 13 孔」 on the card (no-break spaces; the words themselves are unchanged)', () => {
    expect(unbroken('用導線把 LED1 陰極（d18）接到上方 − 電源軌 第 13 孔')).toBe('用導線把 LED1 陰極（d18）接到上方 − 電源軌 第 13 孔')
    expect(unbroken('LED1 亮著')).toBe('LED1 亮著')
  })

  it('a value never breaks from its unit when line 1 wraps (「4.05 mA」, never 「4.05」 / 「mA」); ids and English words are left alone (round 5 final)', () => {
    const NB = String.fromCharCode(0xa0)
    expect(unbroken('LED1 漸亮漸暗，週期約 2.03 s：最亮 4.05 mA')).toBe(`LED1 漸亮漸暗，週期約 2.03${NB}s：最亮 4.05${NB}mA`)
    expect(unbroken('LED1 在閃，約每 998 ms 一次：亮時 405 µA')).toBe(`LED1 在閃，約每 998${NB}ms 一次：亮時 405${NB}µA`)
    expect(unbroken('由 U1 PA6 經 R1 330 Ω、R2 1 kΩ 驅動')).toBe(`由 U1 PA6 經 R1 330${NB}Ω、R2 1${NB}kΩ 驅動`)
    expect(unbroken('LED1 亮著：亮度 49 %（9.70 mA）')).toBe(`LED1 亮著：亮度 49${NB}%（9.70${NB}mA）`)
    expect(unbroken('由 5.00 V 經 R1 330 Ω 供電')).toBe(`由 5.00${NB}V 經 R1 330${NB}Ω 供電`)
    expect(unbroken('U1 sends serial data; LED1 is lit; BZ1 is silent')).toBe('U1 sends serial data; LED1 is lit; BZ1 is silent')
  })
})

// ====================================================================== (e)
const stepCheck = (lessonId: string, stepId: string): LessonCheck => {
  const s = lessonById(lessonId)!.steps.find((x) => x.id === stepId)
  expect(s?.check, `${lessonId}/${stepId}`).toBeTruthy()
  return s!.check!
}

describe('(e) a lesson step that asks the learner to measure: the state, never the number', () => {
  it('lessonSecrets reads the step’s measure checks (also inside 「all」): a current → the part, a voltage → the net, a duty → timing', () => {
    expect(lessonSecrets(stepCheck('b1-led-resistor', 'b1-s5'), LIT)).toEqual({ current: ['LED1'], nets: [], timing: false })
    // b1-s6 (DMM1 wired and its reading, inside 「all」): the meter's net, no part current
    const b1 = lessonById('b1-led-resistor')!.solution.layout
    const s6 = lessonSecrets(stepCheck('b1-led-resistor', 'b1-s6'), b1)
    expect(s6?.current).toEqual([])
    expect(s6?.nets.length).toBe(1)
    expect(s6?.timing).toBe(false)
    const i1 = lessonById('i1-gpio-output')!
    const duty = i1.steps.find((s) => s.check?.kind === 'measure' && s.check.quantity === 'duty')!
    expect(lessonSecrets(duty.check, i1.solution.layout)?.timing).toBe(true)
    // a step that measures nothing: nothing hidden
    expect(lessonSecrets(stepCheck('b1-led-resistor', 'b1-s3'), LIT)).toBeNull()
    expect(lessonSecrets(null, LIT)).toBeNull()
  })

  it('a lit LED: 「LED1 亮著」 + its path, no brightness or current; the supply’s current is not said either', () => {
    const r = run(LIT, 0.5)
    const secrets: ExplainSecrets = { current: ['LED1'], nets: [], timing: false }
    expect(r.explain().lines[0]).toMatch(/^LED1 亮著：亮度 \d+ %（\d+\.\d+ mA）$/)
    const e = r.explain({ secrets })
    expect(e.lines).toEqual(['LED1 亮著', '由 5.00 V 經 R1 330 Ω 供電'])
    expect(e.short).toBe('LED1 亮著')
    // the supply line (the only other subject) carries no current: in one loop it IS the LED's current
    const supply = run(valid({ version: 1, components: [PS(), res('R1', ['top+3', 'top-4'], 330)], wires: RAILS } as CircuitLayout), 0.3)
    expect(supply.explain().lines[0]).toMatch(/^PS1 輸出 5\.00 V，供給電路 \d/)
    expect(supply.explain({ secrets }).lines[0]).toBe('PS1 輸出 5.00 V')
  })

  it('the others keep their numbers, but an aggregate never prints the hidden part’s reading', () => {
    const two = valid({
      version: 1,
      components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4']), res('R2', ['top+20', 'a25'], 330), led('LED2', ['b25', 'top-21'])],
      wires: RAILS,
    } as CircuitLayout)
    const r = run(two, 0.5)
    expect(r.explain().lines[1]).toMatch(/^另外 LED2 也亮著（\d+\.\d+ mA）$/)
    const e = r.explain({ secrets: { current: ['LED2'], nets: [], timing: false } })
    expect(e.lines[0]).toMatch(/^LED1 亮著：亮度 \d+ %/)
    expect(e.lines[1]).toBe('另外 LED2 也亮著')
  })

  it('burned, dark with no cause: the state without the current', () => {
    const burned = run(valid({ version: 1, components: [PS(), led('LED1', ['top+3', 'top-4'])], wires: RAILS } as CircuitLayout), 0.5)
    const secrets: ExplainSecrets = { current: ['LED1'], nets: [], timing: false }
    expect(burned.explain({ secrets }).lines[0]).toBe('LED1 燒毀：電流遠超過額定 20 mA')
    // P6 (synthetic: a dark LED with a leak and no rule-check cause)
    const L: CircuitLayout = { version: 1, components: [led('LED1', ['b10', 'b20'])], wires: [] }
    const tele: SimTelemetry = { time: 1, netVoltages: {}, components: { LED1: { pinVoltages: {}, light: 0, current: 45e-9 } }, issues: [] }
    const base = { layout: L, telemetry: tele, phase: 'running' as const, problems: [], findings: [] }
    expect(explainCircuit(base).lines[0]).toMatch(/^LED1 沒亮：電流只有 45\.0 nA$/)
    expect(explainCircuit({ ...base, secrets }).lines[0]).toBe('LED1 沒亮')
  })

  it('a voltage step: the measured rail is named by its supply, not its voltage', () => {
    const r = run(LIT, 0.5)
    const net = ledDrivePath(LIT, 'LED1')!.up!.net
    // the step's ref resolves to the very net the card would print
    expect(lessonSecrets({ kind: 'measure', at: { terminal: 'PS1:+' }, quantity: 'voltage', min: 4.9, max: 5.1 }, LIT)?.nets).toEqual([net])
    expect(r.explain({ secrets: { current: [], nets: [net], timing: false } }).lines[1]).toBe('由 PS1 經 R1 330 Ω 供電')
  })

  it('a frequency / duty step: a blinker without its period', () => {
    const blinker = EXAMPLES.find((x) => x.title === '555 LED blinker')!.layout
    const r = run(blinker, 6)
    expect(r.explain().lines[0]).toMatch(/^D1 在閃，約每 \d+(\.\d+)? m?s 一次/) // fmtPeriod: 「0.7 s」
    expect(r.explain({ secrets: { current: [], nets: [], timing: true } }).lines[0]).toMatch(/^D1 在閃：亮時 \d+\.\d+ mA$/)
  })

  it('the watcher reads the coach’s active step: b1 「LED1 亮起，確認電流」 → 「LED1 亮著」; another step → the number again', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    const tele: SimTelemetry = { time: 0.2, netVoltages: {}, components: { LED1: { pinVoltages: {}, light: 0.485, current: 0.0097 } }, issues: [] }
    useLab.setState({ firmware: {}, mcus: {} })
    useStore.setState({ layout: LIT, telemetry: tele, running: true, simTime: 0.2, selection: [] })
    useProblems.setState({ problems: [], layout: LIT, findings: [] })
    useLessonProgress.getState().setStep('b1-led-resistor', 4)
    useLessonUi.setState({ coachId: 'b1-led-resistor' })
    expect(guidedStepCheck()).toEqual(stepCheck('b1-led-resistor', 'b1-s5'))
    const stop = startExplainWatcher()
    try {
      expect(useExplainView.getState().explanation?.lines[0]).toBe('LED1 亮著')
      // the next step (a voltmeter on the LED): the current is no longer the answer
      useLessonProgress.getState().setStep('b1-led-resistor', 5)
      expect(useExplainView.getState().explanation?.lines[0]).toMatch(/^LED1 亮著：亮度 49 %（9\.70 mA）$/)
      // no lesson guided: nothing hidden
      useLessonProgress.getState().setStep('b1-led-resistor', 4)
      expect(useExplainView.getState().explanation?.lines[0]).toBe('LED1 亮著')
      useLessonUi.setState({ coachId: null })
      expect(guidedStepCheck()).toBeNull()
      expect(useExplainView.getState().explanation?.lines[0]).toMatch(/^LED1 亮著：亮度/)
    } finally {
      stop()
      useStore.setState({ running: false, simTime: 0, telemetry: null })
    }
  })
})

// ====================================================================== (c)
/** two bare red LEDs across 5 V (both burn) beside a lit one */
const TWO_BURN = valid({
  version: 1,
  components: [PS(), led('LED2', ['top+8', 'top-9']), led('LED1', ['top+3', 'top-4']), res('R1', ['top+20', 'a25'], 330), led('LED3', ['b25', 'top-21'])],
  wires: RAILS,
} as CircuitLayout)

/** The real store on an inline host (manual ticks: paused), its repairParts calls recorded. */
function sessionOf(layout: CircuitLayout): { repaired: (readonly string[] | null)[] } {
  const rec = { repaired: [] as (readonly string[] | null)[] }
  __setSimHostFactoryForTests((cb: SimHostCallbacks) => {
    const h = new InlineSimHost(cb, { scheduler: { request: () => 0, cancel: () => {} }, clock: () => 0 })
    const repair = h.repairParts.bind(h)
    ;(h as SimHost).repairParts = (ids) => {
      rec.repaired.push(ids)
      repair(ids)
    }
    return h
  })
  useStore.setState({ layout })
  getSimHost()
  stepSimTime(0.05)
  return rec
}

describe('(c) 〔換新〕 for several parts: one call, one sound, one toast', () => {
  it('damagedPartIds: the board’s destroyed parts in layout order, nothing that left the board', () => {
    sessionOf(TWO_BURN)
    const s = useStore.getState()
    expect(damagedPartIds(s.telemetry, s.layout)).toEqual(['LED2', 'LED1'])
    expect(damagedPartIds(s.telemetry, { components: [{ id: 'LED1' }, { id: 'LED3' }] })).toEqual(['LED1'])
    expect(damagedPartIds(null, s.layout)).toEqual([])
  })

  it('〔全部換新〕: ONE repairParts call with every destroyed part, ONE insert sound, ONE toast 「已換上新的 LED2、LED1」', () => {
    const rec = sessionOf(TWO_BURN)
    useStore.setState({ running: true })
    expect(replaceAllDamagedWithFeedback()).toBe(true)
    expect(rec.repaired).toEqual([['LED2', 'LED1']])
    expect(playMech).toHaveBeenCalledTimes(1)
    expect(playMech).toHaveBeenCalledWith('insert', { count: 2 })
    expect(getToasts().map((x) => x.text)).toEqual(['已換上新的 LED2、LED1'])
  })

  it('the selection pill’s 〔換新〕: only the selected destroyed ones, in one call; a stale click says nothing was replaced', () => {
    const rec = sessionOf(TWO_BURN)
    const s = useStore.getState()
    // the pill's key: the destroyed parts among the selection, selection order (LED3 and R1 are whole)
    expect(damagedSelectionKey(['LED3', 'LED1', 'R1', 'LED2'], s.telemetry)).toBe('LED1,LED2')
    expect(damagedSelectionKey(['LED3'], s.telemetry)).toBe('')
    expect(damagedSelectionKey('LED1', s.telemetry)).toBe('LED1')
    expect(replaceLabel(['LED1', 'LED2'])).toBe('把 LED1、LED2 換成新的')
    expect(replaceLabel(['LED1'])).toBe('把 LED1 換成新的')
    expect(replacePartsWithFeedback(['LED1', 'LED3'])).toBe(true)
    expect(rec.repaired).toEqual([['LED1']])
    expect(getToasts().map((x) => x.text)).toEqual(['已換上新的 LED1——模擬已暫停'])
    // the readings show them whole now: nothing to replace, no sound
    vi.mocked(playMech).mockClear()
    expect(replacePartsWithFeedback(['LED1', 'LED3'])).toBe(false)
    expect(rec.repaired).toEqual([['LED1']])
    expect(playMech).not.toHaveBeenCalled()
    expect(getToasts().map((x) => x.text).slice(-1)).toEqual(['沒有損壞的元件，不用換新'])
  })

  it('the Problems list header shows 〔全部換新〕 for two or more destroyed parts, never for one', () => {
    const rows: Problem[] = [{ id: 'p1', level: 'error', source: 'sim', title: 'LED1 已燒毀', detail: 'D', componentIds: ['LED1'], holes: [] }]
    const two = renderToStaticMarkup(createElement(ProblemsView, { variant: 'panel', problems: rows, replaceIds: ['LED1', 'LED2'] }))
    expect(two).toContain('全部換新')
    expect(two).toContain('aria-label="把損壞的 LED1、LED2 全部換成新的"')
    expect(two).toContain('問題（1）')
    const one = renderToStaticMarkup(createElement(ProblemsView, { variant: 'panel', problems: rows, replaceIds: ['LED1'] }))
    expect(one).not.toContain('全部換新')
    // the compact card (the part editor) never carries it
    const compact = renderToStaticMarkup(createElement(ProblemsView, { variant: 'compact', problems: rows, replaceIds: ['LED1', 'LED2'] }))
    expect(compact).not.toContain('全部換新')
  })

  it('the desktop workspace’s problems panel (ErcPanel) carries 〔全部換新〕 in its header too (integration)', () => {
    const rows: Problem[] = [{ id: 'p1', level: 'error', source: 'sim', title: 'LED1 已燒毀', detail: 'D', componentIds: ['LED1'], holes: [] }]
    const view = (replaceIds?: string[]) => renderToStaticMarkup(createElement(ProblemsPanelView, { problems: rows, live: true, replaceIds }))
    const html = view(['LED2', 'LED1'])
    expect(html).toContain('全部換新')
    expect(html).toContain('aria-label="把損壞的 LED2、LED1 全部換成新的"')
    // the header row: after the spacer, before 「這是什麼？」
    expect(html.indexOf('erc-head-spacer')).toBeLessThan(html.indexOf('全部換新'))
    expect(html.indexOf('全部換新')).toBeLessThan(html.indexOf('這是什麼？'))
    expect(view(['LED1'])).not.toContain('全部換新')
    expect(view()).not.toContain('全部換新')
    // the store-bound panel feeds it the same ids as the phone list (product chrome only: useReplaceAllIds)
    expect(read('src/ui/embedded/ErcPanel.tsx')).toMatch(/const replaceIds = useReplaceAllIds\(\)[\s\S]*replaceIds=\{replaceIds\}/)
  })

  it('the pill and the header are product chrome only (the classic chrome has no 換新 anywhere)', () => {
    const pill = read('src/ui/chrome/SelectionPill.tsx')
    expect(pill).toMatch(/const damagedKey = useStore\(\(s\) => \(legacy \? '' : damagedSelectionKey\(s\.selection, s\.telemetry\)\)\)/)
    expect(pill).toMatch(/\{!legacy && damaged\.length > 0 && \(/)
    const list = read('src/ui/embedded/ProblemsList.tsx')
    expect(list).toMatch(/useStore\(\(s\) => \(legacy \? '' : damagedPartIds\(s\.telemetry, s\.layout\)\.join\(','\)\)\)/)
  })
})

// ====================================================================== (d)
describe('(d) the selection pill fits a 320 px phone', () => {
  const css = read('src/ui/chrome/SelectionPill.css')
  it('never wider than the screen; at ≤ 400 px the separators drop and the buttons tighten (44 px targets kept)', () => {
    expect(css).toMatch(/max-width:\s*calc\(100vw - var\(--lg-safe-left, 0px\) - var\(--lg-safe-right, 0px\) - 16px\)/)
    const narrow = /@media \(max-width: 400px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.app-sel-dot \{\s*display: none;/)
    expect(narrow).toMatch(/\.app-sel-btn \{\s*padding: 0 8px;/)
    expect(css).toMatch(/\.app-sel-btn \{[^}]*min-width: 44px;[^}]*height: 44px;/)
    // label · 換新 · 複製 · 刪除 · 清除 at 320: 12 + label (5 CJK @14) + 換新 (2 CJK + 24) + 3 × (2 CJK + 16) + 4 < 304
    const width = 12 + 4 + 5 * 14 + 4 + (30 + 24) + 3 * Math.max(44, 30 + 16)
    expect(width).toBeLessThanOrEqual(320 - 16)
  })

  it('phones: one row above the undo / redo pill (on its row it covered it)', () => {
    const phone = /@media \(max-width: 899px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(phone).toMatch(/\.app-sel-pill\.is-product \{\s*bottom: calc\(var\(--lg-safe-bottom\) \+ 139px\)/)
    expect(phone).toMatch(/body\.app-wire-armed \.app-sel-pill\.is-product \{\s*bottom: calc\(var\(--lg-safe-bottom\) \+ 201px\)/)
  })

  it('the classic chrome’s pill keeps its row and its look: every new rule is scoped to .is-product (integration)', () => {
    const base = /\.app-sel-pill \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(base).toMatch(/bottom: calc\(var\(--lg-safe-bottom\) \+ 83px\)/)
    expect(css).toMatch(/body\.app-wire-armed \.app-sel-pill \{\s*bottom: calc\(var\(--lg-safe-bottom\) \+ 145px\)/)
    const narrow = /@media \(max-width: 400px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    const selectors = narrow.match(/^\s*[^{}\n]+\{/gm) ?? []
    expect(selectors.length).toBeGreaterThanOrEqual(5)
    for (const sel of selectors) expect(sel).toContain('.app-sel-pill.is-product')
    expect(css).not.toMatch(/^\.app-sel-(count|btn) \{[^}]*(overflow|flex: 0 0 auto)/m)
    expect(read('src/ui/chrome/SelectionPill.tsx')).toContain("${legacy ? '' : ' is-product'}")
  })
})
