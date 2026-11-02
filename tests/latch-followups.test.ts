/**
 * Keep-pressed latch 「保持按下」 — the follow-ups (src/ui/embedded/latch.ts):
 *  - the status pill: while a session runs with parts kept pressed,
 *    「SW1 保持按下中」 + 〔放開〕, below every problem and the halt line
 *    (statusPillModel, pure; the 放開 action releases them in the store);
 *  - the long-press action sheet's 保持按下 / 放開 item (latchSheetItem) and
 *    releaseLatched (a finger's hold is left alone);
 *  - the KY-040 / joystick 'pressed' param is the same 「保持按下」 toggle as
 *    the pushbutton's (PropertiesBody server render), named 「按鈕（SW）」;
 *    the English classic chrome keeps its generic switch;
 *  - wording: no lesson / example text names a 「按下」 box to tick, b3 / b4
 *    tell the learner to press SW1 on the board or turn 「保持按下」 on, and a
 *    check's own press reads 「按住 SW1」 / 「放開 SW1」 (English unchanged).
 * The lesson checks' hands (liveEvalInput / runStepCheck) are in
 * tests/latch-checks.test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { LESSONS, lessonById } from '../src/lessons'
import { stimulusText } from '../src/lessons/engine/format'
import type { CircuitLayout } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { partDoc, partParamLabel } from '../src/i18n/parts'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { statusPillModel } from '../src/ui/chrome/StatusPill'
import { TONE_COLOR } from '../src/ui/chrome/run-control'
import { useLab } from '../src/ui/embedded/lab'
import type { Problem } from '../src/ui/embedded/problems'
import {
  isLatched,
  latchSheetItem,
  latchedIn,
  latchedSummaryOf,
  pressMomentary,
  releaseLatched,
  setLatched,
  useLatchHolds,
} from '../src/ui/embedded/latch'
import { useLessonUi } from '../src/ui/lessons/state'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'

const ROOT = path.resolve(__dirname, '..')

const LAYOUT: CircuitLayout = {
  version: 1,
  name: 'latch-followups',
  components: [
    { id: 'SW1', type: 'pushbutton', at: 'f50' },
    { id: 'SW2', type: 'pushbutton', at: 'f54' },
    { id: 'ENC1', type: 'ky040_encoder', at: 'f10' },
    { id: 'JOY1', type: 'joystick_xy', at: 'f30' },
    { id: 'R1', type: 'resistor', holes: ['a36', 'a40'] },
  ],
  wires: [],
}

const pressed = (id: string) => useStore.getState().layout.components.find((c) => c.id === id)?.params?.pressed

function reset(): void {
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useLatchHolds.setState({ held: [] })
  useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

beforeEach(() => {
  __setLangForTests('zh-TW')
  reset()
})
afterEach(() => {
  __setLangForTests('zh-TW')
  useLatchHolds.setState({ held: [] })
  useStore.setState({ telemetry: null, selection: [] })
})

// ------------------------------------------------------------ status pill

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
const none: Problem[] = []
const base = { haltedId: null, boardEmpty: false, problems: none, counts: counts(none) }

describe('status pill: 「SW1 保持按下中」 while a session runs', () => {
  it('running or paused with a part kept pressed: the latch line, its blue, and 〔放開〕', () => {
    for (const phase of ['running', 'paused'] as const) {
      const m = statusPillModel({ ...base, phase, latched: ['SW1'] })!
      expect(m.text).toBe('SW1 保持按下中')
      expect(m.tone).toBe('latched')
      expect(m.dot).toBe(TONE_COLOR.blue)
      expect(m.action?.label).toBe('放開')
      expect(m.opensProblems).toBe(false) // a state, not a problem: the body opens no list
      expect(m.more).toBe(0)
    }
    expect(statusPillModel({ ...base, phase: 'running', latched: ['SW1', 'ENC1'] })!.text).toBe('SW1、ENC1 保持按下中')
  })

  it('never above a problem or the halt; nothing before a session; unchanged without a latch', () => {
    const err = [problem({ id: 'e', level: 'error', title: 'U1 還沒有韌體' })]
    const warn = [problem({ id: 'w', level: 'warning', title: 'PB12 浮接' })]
    expect(statusPillModel({ ...base, phase: 'running', latched: ['SW1'], problems: err, counts: counts(err) })!.text).toBe('U1 還沒有韌體')
    expect(statusPillModel({ ...base, phase: 'running', latched: ['SW1'], problems: warn, counts: counts(warn) })!.text).toBe('PB12 浮接')
    expect(statusPillModel({ ...base, phase: 'halted', haltedId: 'U1', latched: ['SW1'] })!.text).toBe('U1 核心已停住（偵錯器）')
    // no session yet: the next step is 執行模擬, not the latch
    expect(statusPillModel({ ...base, phase: 'idle', latched: ['SW1'] })!.text).toBe('電路已就緒（空白鍵）')
    // no latch: the pill says nothing while running (as before)
    expect(statusPillModel({ ...base, phase: 'running' })).toBeNull()
    expect(statusPillModel({ ...base, phase: 'running', latched: [] })).toBeNull()
  })

  it('〔放開〕 lets go of the kept-pressed parts in the store', () => {
    setLatched('SW1', true)
    setLatched('ENC1', true)
    const latched = latchedIn(useStore.getState().layout)
    expect(latched).toEqual(['SW1', 'ENC1'])
    const m = statusPillModel({ ...base, phase: 'running', latched })!
    m.action!.run()
    expect(pressed('SW1')).toBe(false)
    expect(pressed('ENC1')).toBe(false)
    expect(latchedIn(useStore.getState().layout)).toEqual([])
  })

  it('English (product chrome) says it in English', () => {
    __setLangForTests('en')
    const m = statusPillModel({ ...base, phase: 'running', latched: ['SW1', 'SW2'] })!
    expect(m.text).toBe('SW1, SW2 kept pressed')
    expect(m.action?.label).toBe('Release')
  })

  it('latchedSummaryOf is the inspector / pill wording', () => {
    expect(latchedSummaryOf([])).toBe('')
    expect(latchedSummaryOf(['SW1'])).toBe('SW1 保持按下中')
  })
})

// ------------------------------------------------------------ long-press sheet + release

describe('the long-press sheet item and releaseLatched', () => {
  it('保持按下 on a released button, 放開 on a kept-pressed one; null for a part with no button', () => {
    const item = latchSheetItem('SW1')!
    expect(item.label).toBe('保持按下')
    expect(item.kept).toBe(false)
    expect(item.run()).toBe(true)
    expect(isLatched('SW1')).toBe(true)
    const again = latchSheetItem('SW1')!
    expect(again.label).toBe('放開')
    expect(again.kept).toBe(true)
    expect(again.run()).toBe(true)
    expect(pressed('SW1')).toBe(false)
    expect(latchSheetItem('ENC1')?.label).toBe('保持按下') // the KY-040's push switch
    expect(latchSheetItem('JOY1')?.label).toBe('保持按下')
    expect(latchSheetItem('R1')).toBeNull()
    expect(latchSheetItem('NOPE')).toBeNull()
  })

  it('a part a finger holds is pressed, not kept pressed: the item offers 保持按下 and 放開 leaves the finger alone', () => {
    pressMomentary('SW1', true)
    expect(latchSheetItem('SW1')?.label).toBe('保持按下')
    setLatched('SW2', true)
    expect(releaseLatched(['SW1', 'SW2'])).toBe(1)
    expect(pressed('SW1')).toBe(true) // still under the finger
    expect(pressed('SW2')).toBe(false)
    pressMomentary('SW1', false)
    expect(pressed('SW1')).toBe(false)
  })

  it('releaseLatched() with no list lets go of every kept-pressed part', () => {
    setLatched('SW1', true)
    setLatched('JOY1', true)
    expect(releaseLatched()).toBe(2)
    expect(latchedIn(useStore.getState().layout)).toEqual([])
    expect(useStore.getState().canUndo).toBe(false) // runtime state, never an undo step
  })
})

// ------------------------------------------------------------ inspector: the same toggle everywhere

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi, useLatchHolds] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}

const inspectorOf = (id: string) => {
  useStore.setState({ selection: [id] })
  return renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
}
/** the latch toggle's markup (role=switch, its state, its words) */
const latchToggle = (html: string) => html.match(/<button[^>]*class="latch-toggle[^"]*"[^>]*>.*?<\/button>/)?.[0] ?? null

describe('KY-040 / joystick: the pushbutton’s 「保持按下」, not a generic 「按下」 switch', () => {
  it('the KY-040 and the joystick render the latch toggle under the name 「按鈕（SW）」', () => {
    for (const id of ['ENC1', 'JOY1']) {
      const html = inspectorOf(id)
      const toggle = latchToggle(html)
      expect(toggle, id).not.toBeNull()
      expect(toggle).toContain('role="switch"')
      expect(toggle).toContain('aria-checked="false"')
      expect(toggle).toContain('保持按下')
      expect(html).toContain('按鈕（SW）')
      expect(html).not.toContain('aria-label="按下"') // the old generic Switch
    }
    // the pushbutton's own toggle is the same control
    expect(latchToggle(inspectorOf('SW1'))).toContain('保持按下')
  })

  it('it follows the latch: on = kept pressed (is-on, aria-checked); a finger’s hold is not a latch', () => {
    setLatched('ENC1', true)
    const on = latchToggle(inspectorOf('ENC1'))!
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('is-on')
    setLatched('ENC1', false)
    pressMomentary('ENC1', true)
    expect(latchToggle(inspectorOf('ENC1'))).toContain('aria-checked="false"')
    pressMomentary('ENC1', false)
  })

  it('the English classic chrome keeps its generic Pressed switch', () => {
    __setLangForTests('en')
    const html = inspectorOf('ENC1')
    expect(latchToggle(html)).toBeNull()
    expect(html).toContain('Pressed')
  })

  it('the zh-TW name and the part docs say 保持按下', () => {
    for (const type of ['ky040_encoder', 'joystick_xy']) {
      const entry = getEntry(type)!
      expect(partParamLabel(entry, 'pressed', 'Pressed')).toBe('按鈕（SW）')
      expect(partDoc(entry)).toContain('「保持按下」')
      expect(partDoc(entry)).not.toMatch(/與「按下」|「按下」可/)
    }
  })
})

// ------------------------------------------------------------ wording a learner can follow literally

/** 「勾選 SW1 的「按下」」, 「切換 SW1 的「按下」」, 「屬性面板的「按下」」: a box that does not exist */
const OLD_CONTROL = /(勾選|切換|取消勾選)[^。；\n]{0,12}「按下」|屬性面板的「按下」|勾選「按下」/

function lessonTexts(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  for (const l of LESSONS) {
    for (const s of l.steps) out.push({ where: `${l.id}/${s.id}`, text: `${s.title}\n${s.body}` })
    for (const [i, e] of (l.expected ?? []).entries()) out.push({ where: `${l.id}/expected[${i}]`, text: e })
    for (const [i, m] of (l.mistakes ?? []).entries()) out.push({ where: `${l.id}/mistake[${i}]`, text: `${m.symptom}\n${m.cause}\n${m.fix}` })
  }
  return out
}

describe('wording: the learner can follow it literally', () => {
  it('no lesson step, expectation or mistake names a 「按下」 box', () => {
    const bad = lessonTexts().filter((x) => OLD_CONTROL.test(x.text))
    expect(bad.map((x) => x.where)).toEqual([])
  })

  it('no example description does either (descriptors, envelopes and the index)', () => {
    const dir = path.join(ROOT, 'examples/embedded')
    const files = [
      ...readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.example.mjs')).map((f) => `src/${f}`),
      ...readdirSync(dir).filter((f) => f.endsWith('.json')),
    ]
    const bad = files.filter((f) => OLD_CONTROL.test(readFileSync(path.join(dir, f), 'utf8')))
    expect(bad).toEqual([])
  })

  it('b3 / b4: press SW1 on the board, or keep it pressed with 雙擊 / 點兩下 or 「保持按下」', () => {
    const step = (lessonId: string, stepId: string) => lessonById(lessonId)!.steps.find((s) => s.id === stepId)!.body
    for (const [lessonId, stepId, sw] of [
      ['b3-pull-resistors', 'b3-s3', 'SW1'],
      ['b3-pull-resistors', 'b3-s5', 'SW2'],
      ['b4-button-debounce', 'b4-s3', 'SW1'],
    ] as const) {
      const body = step(lessonId, stepId)
      expect(body, stepId).toContain(`在麵包板上按住 ${sw}`)
      expect(body, stepId).toContain('在屬性面板打開「保持按下」')
      expect(body, stepId).toContain(`{滑鼠：雙擊｜觸控：點兩下} ${sw}`)
      expect(body, stepId).not.toMatch(OLD_CONTROL)
    }
    // how to let go again is said where it is kept pressed
    expect(step('b3-pull-resistors', 'b3-s3')).toContain('關掉「保持按下」，或在麵包板上點一下 SW1')
  })

  it('the button-exti example: one click presses once; 雙擊 or 「保持按下」 keeps it pressed', () => {
    type Item = { id: string; description: string }
    const index = JSON.parse(readFileSync(path.join(ROOT, 'examples/embedded/index.json'), 'utf8')) as Item[] | { examples?: Item[] }
    const list: Item[] = (Array.isArray(index) ? index : index.examples) ?? []
    const ex = list.find((e) => e.id === 'button-exti')!
    expect(ex.description).toContain('在 3D 畫面點一下 SW1 就是按一次')
    expect(ex.description).toContain('雙擊 SW1，或在屬性面板打開 SW1 的「保持按下」')
  })

  it('a check’s own press reads 「按住 SW1」 / 「放開 SW1」; the English keeps its words; other boxes still tick', () => {
    const parts = { components: [{ id: 'SW1', type: 'pushbutton' }, { id: 'ENC1', type: 'ky040_encoder' }, { id: 'CH1', type: 'usb_uart_ch340' }] }
    const press = [
      { at: 0, component: 'SW1', param: 'pressed', value: true },
      { at: 0.4, component: 'SW1', param: 'pressed', value: false },
      { at: 0.9, component: 'ENC1', param: 'pressed', value: true },
    ]
    expect(stimulusText(press, parts)).toBe('檢查時會自動操作：一上電就按住 SW1，0.4 秒時放開 SW1，0.9 秒時按住 ENC1')
    expect(stimulusText([{ at: 0, component: 'SW1', param: 'pressed', value: false }], parts)).toBe('檢查時會自動操作：一上電就放開 SW1')
    expect(stimulusText([{ at: 0.2, component: 'CH1', param: 'dtr', value: true }], parts)).toBe('檢查時會自動操作：0.2 秒時勾選 CH1 的「DTR 已拉起」')
    __setLangForTests('en')
    expect(stimulusText(press.slice(0, 2), parts)).toBe('The check does this itself: At power-on: tick SW1 “Pressed”; 0.4 s: untick SW1 “Pressed”')
  })
})
