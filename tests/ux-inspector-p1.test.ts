/**
 * UX fix wave — inspector P1 items and the classic-chrome inspector:
 *
 *  - IN-19 from a problem to the part in one step: where-chips (「U1 PA5」 →
 *    U1's 腳位 tab at PA5), 「在電路板上標示」 selects the problem's part, the
 *    I²C pull-up findings ring a free hole beside PB6 / PB7, the 模擬狀態
 *    group never says 「沒有問題」 next to a problem card, 「對調兩腳」
 *  - IN-20 one vocabulary: raw catalog pins (3V3_1, GND1) and board parts
 *    (U1.REG) read 「3V3（板上 3.3）」 / 「U1 板載穩壓器」; references 「表 7」;
 *    「複用推挽」; the glossary's 工作週期 names its other word
 *  - IN-21 the MCU panel: one state colour (unpowered red 「沒有供電」), the
 *    tab remembered per part type, readings that are never 「−0 pA」 / 1 MV
 *  (Store-bound views — the 模擬狀態 link, 「對調兩腳」, the classic-chrome
 *  inspector of IN-18 — are checked in the real browser: server rendering
 *  reads a zustand store's initial state. See scripts/ux-e2e/inspector-IN-18.mjs.)
 *  - IN-17 the telemetry-rate reversal check (seesReversal)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { edgeZh } from '../src/i18n/zh-TW/messages-erc'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { runErc } from '../src/sim/erc'
import { useStore } from '../src/state/store'
import { stateColor } from '../src/ui/chrome/run-control'
import { glossaryText } from '../src/ui/embedded/glossary'
import { fmtReadingCurrent, fmtReadingPower, fmtReadingVoltage, isNoLoad, MCU_STATE_META } from '../src/ui/embedded/format'
import { rememberMcuTab, rememberedMcuTab } from '../src/ui/embedded/McuPanel'
import {
  __resetProblemsForTests,
  ercProblem,
  locateProblem,
  problemWhereItems,
  seesReversal,
  useInspectorFocus,
  type Problem,
} from '../src/ui/embedded/problems'
import { tc } from '../src/ui/embedded/text'
import { bluePill, modesTelemetry, part, tap, valid, w } from './erc/helpers'

beforeAll(() => __setLangForTests('zh-TW'))
afterAll(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  __setLangForTests('zh-TW')
  useStore.setState({ selection: [] })
})

// the blink wiring: PA5 → R1 → D1 → the − rail
const blink = valid(bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])], [w(tap('PA5'), 'b40')]))

describe('IN-19 from a problem to the part', () => {
  it('where-chips name the pin in the short form, the full form as the title', () => {
    const p: Problem = { id: 'x', level: 'warning', source: 'erc', title: 't', detail: 'd', componentIds: ['D1', 'U1'], holes: [tap('PA5').replace('a', 'c')], wireIds: ['W1'] }
    const items = problemWhereItems(p, blink)
    expect(items.map((i) => i.text)).toEqual(['D1', 'U1 PA5', '導線 W1'])
    const u1 = items[1]
    expect(u1.kind === 'part' && u1.pins).toEqual(['PA5'])
    expect(u1.title).toBe('U1 PA5（板上 A5）')
  })

  it('「在電路板上標示」 selects the subject and opens its inspector at the named pin', () => {
    useStore.setState({ layout: blink })
    const p: Problem = { id: 'y', level: 'info', source: 'erc', title: 't', detail: 'd', componentIds: ['U1', 'D1'], holes: [tap('PA5').replace('a', 'c')] }
    locateProblem(p)
    expect(useStore.getState().selection).toEqual(['U1'])
    expect(useInspectorFocus.getState().request).toMatchObject({ componentId: 'U1', pin: 'PA5' })
    const q: Problem = { ...p, id: 'z', componentIds: ['D1'], holes: ['top-9'] }
    locateProblem(q)
    expect(useStore.getState().selection).toEqual(['D1'])
  })

  it('an I²C pull-up finding rings a free hole beside each MCU pin (where the resistor goes)', () => {
    const l = valid(bluePill())
    const f = runErc(l, { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) }).filter((x) => x.rule === 'i2c-pullup')
    expect(f).toHaveLength(2)
    for (const pin of ['PB6', 'PB7']) {
      const one = f.find((x) => x.holes.includes(tap(pin).replace(/^[aj]/, (r) => (r === 'a' ? 'c' : 'h'))))!
      expect(one.holes).toContain(tap(pin))
    }
  })

})

describe('IN-20 one vocabulary', () => {
  it('raw catalog pins in a finding read as the pin’s one name', () => {
    // the 3.3 pin wired straight to the board's own ground
    const l = valid(bluePill([], [w('top-20', tap('3V3_1'))]))
    const f = runErc(l).find((x) => x.id === 'supply-short:U1:pins')!
    expect(f.message).toMatch(/3V3_1/)
    const p = ercProblem(f, l)
    expect(p.detail).not.toMatch(/\b(3V3|GND)_\d\b|\bGND\d\b/)
    expect(p.detail).toContain('3V3（板上 3.3）與它的 GND（板上 G）')
    expect(p.title).toBe('U1 的電源腳接到 GND')
  })

  it('a board’s own parts and the datasheet references read in Chinese', () => {
    expect(edgeZh('U1.REG')).toBe('U1 板載穩壓器')
    expect(edgeZh('U1.LED_PC13')).toBe('U1 板載 LED（LED_PC13）')
    expect(edgeZh('U1.R_USB_DP')).toBe('U1 板上電阻 R_USB_DP')
    expect(edgeZh('R1')).toBe('R1')
    expect(tMessage('DS5319 Tables 7 and 9')).toBe('DS5319 表 7 與 9')
    expect(tMessage('DS5319 Table 9 note 3')).toBe('DS5319 表 9 註 3')
    expect(tMessage('RM0008 §7.3.7')).toBe('RM0008 §7.3.7')
  })

  it('「複用推挽」 beside 「複用開汲極」; the glossary names both words for the duty cycle', () => {
    expect(tc('af', 'pin-mode')).toBe('複用推挽')
    expect(tc('af-od', 'pin-mode')).toBe('複用開汲極')
    expect(glossaryText('duty').title).toBe('工作週期（又稱佔空比）')
  })
})

describe('IN-21 the MCU panel', () => {
  it('unpowered: the H6 red and the same words as the problem (「沒有供電」)', () => {
    expect(stateColor('unpowered')).toBe('var(--ios-red)')
    expect(MCU_STATE_META.unpowered.color).toBe(stateColor('unpowered'))
    expect(MCU_STATE_META['no-firmware'].color).toBe(stateColor('no-firmware'))
    expect(tc(MCU_STATE_META.unpowered.label, 'mcu-state')).toBe('沒有供電')
    expect(t('{id} has no power', { id: 'U1' })).toContain('沒有供電')
    expect(tc(MCU_STATE_META['no-firmware'].label, 'mcu-state')).toBe('還沒有韌體')
  })

  it('the tab is remembered per part type for the session', () => {
    expect(rememberedMcuTab('stm32_bluepill_test')).toBe('overview')
    rememberMcuTab('stm32_bluepill_test', 'firmware')
    expect(rememberedMcuTab('stm32_bluepill_test')).toBe('firmware')
    expect(rememberedMcuTab('another_board')).toBe('overview')
  })

  it('readings are never a solver artefact, a negative zero or a short shown as a number', () => {
    expect(fmtReadingVoltage(-1261957.64)).toBe('—（求解器未收斂）')
    expect(fmtReadingVoltage(Number.NaN)).toBe('—（求解器未收斂）')
    expect(fmtReadingVoltage(3.0962)).toBe('3.10 V')
    expect(fmtReadingCurrent(-7.6e-12)).toBe('0 A')
    expect(fmtReadingCurrent(267)).toBe('> 2 A（短路）')
    expect(fmtReadingPower(622, 267)).toBe('—（短路）')
    expect(isNoLoad(5e-9)).toBe(true)
    expect(isNoLoad(0.002)).toBe(false)
  })
})

describe('IN-17 the reversal evidence between two recomputes', () => {
  const tel = (anode: number, cathode: number, current: number): SimTelemetry => ({
    time: 1,
    netVoltages: {},
    issues: [],
    components: { D1: { pinVoltages: { anode, cathode }, current } },
  })
  it('a suspect measured reverse-biased with no current', () => {
    expect(seesReversal(tel(0, 3.3, -7.6e-12), ['D1'])).toBe(true)
    expect(seesReversal(tel(0, 0, 0), ['D1'])).toBe(false)
    expect(seesReversal(tel(2.0, 0, 0.004), ['D1'])).toBe(false)
    expect(seesReversal(tel(0, 3.3, -7.6e-12), ['LED9'])).toBe(false)
    expect(seesReversal(null, ['D1'])).toBe(false)
  })
})

// keep the layout type in use for readers of this file
export type _Layout = CircuitLayout
