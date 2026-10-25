/**
 * UX fix wave — the inspector's requests round (the other workstreams'
 * requests and the inspector's own continuity limits):
 *
 *  - the problems list counts like the status pill and the 更多 badge:
 *    「問題（errors + warnings）· 提示 n」 (shell SH-13), or the host's own header
 *  - ERC finding values in THE unit format (H3): 「3.30 V」, 「9.70 mA」 — the
 *    same strings the inspector prints for the same value (instruments IS-17)
 *  - 「在電路板上標示」 keeps the fix target in the frame, unmarked: an open LED
 *    cathode frames the nearest − rail hole, a lead on a floating rail the
 *    powered rail it should be wired to (scene SC-11 / H7 includeHoles)
 *  - hovering a pin row or a where-chip marks it on the board (H7
 *    highlightSource), mouse only, cleared on leave
 *  - 「在模擬日誌中檢視」 is offered wherever the new chrome runs (the phone's
 *    儀器 sheet presents the log view — the shell's showInstrument)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { railByZh, whatZh } from '../src/i18n/zh-TW/messages-erc'
import type { SimTelemetry } from '../src/model/types'
import type { McuFrameInfo, SimLogEntry } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { fmtA, fmtV } from '../src/sim/erc/graph'
import { fmtCurrent, fmtVoltage } from '../src/instruments/format'
import { useStore } from '../src/state/store'
import { useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'
import { sourceHoverProps, releaseSourceHover } from '../src/ui/embedded/controls'
import { useLab } from '../src/ui/embedded/lab'
import { ProblemsView, problemsHeaderText } from '../src/ui/embedded/ProblemsList'
import { __resetProblemsForTests, deriveProblems, ercProblem, locateProblem, type Problem } from '../src/ui/embedded/problems'
import { registerScene, type BridgeScene } from '../src/ui/workspace/scene-bridge'
import { bluePill, part, railsWorld, valid } from './erc/helpers'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  registerScene(null)
  __resetProblemsForTests()
  __setLangForTests('zh-TW')
  useStore.setState({ selection: [] })
})

const row = (id: string, level: Problem['level']): Problem => ({ id, level, source: 'erc', title: id, detail: id, componentIds: [], holes: [] })

describe('the problems list counts like the pill', () => {
  it('「問題（n）」 counts errors + warnings; hints (info) apart', () => {
    expect(problemsHeaderText([row('a', 'error'), row('b', 'warning')])).toBe('問題（2）')
    expect(problemsHeaderText([row('a', 'error'), row('b', 'info'), row('c', 'info')])).toBe('問題（1）· 提示 2')
    expect(problemsHeaderText([row('a', 'info')])).toBe('問題（0）· 提示 1')
  })

  it('the panel variant renders that header; a host can bring its own or none', () => {
    const list = [row('a', 'warning'), row('b', 'info')]
    expect(renderToStaticMarkup(createElement(ProblemsView, { problems: list }))).toContain('問題（1）· 提示 1')
    const none = renderToStaticMarkup(createElement(ProblemsView, { problems: list, header: null }))
    expect(none).not.toContain('問題（')
    expect(renderToStaticMarkup(createElement(ProblemsView, { problems: list, header: createElement('b', null, '自己的標題') }))).toContain('<b>自己的標題</b>')
  })
})

describe('ERC values in the app’s one unit format (H3)', () => {
  it('fmtV / fmtA print what the inspector prints', () => {
    expect(fmtV(3.3)).toBe(fmtVoltage(3.3, { plain: true }))
    expect(fmtV(0.5)).toBe('500 mV')
    expect(fmtA(9.7e-3)).toBe('9.70 mA')
    expect(fmtA(-9.7e-3)).toBe('9.70 mA') // a magnitude: the sentence says the direction
    expect(fmtA(267)).toBe(fmtCurrent(267, { plain: true }))
    expect(fmtV(Number.NaN)).toBe('—')
  })

  it('a supply terminal inside a finding reads 「PS1 正端（5.00 V）」, the H1 name (never 「PS1 +」 or 「FG1:out」)', () => {
    expect(whatZh('PS1 + (5.00 V)')).toBe('PS1 正端（5.00 V）')
    expect(whatZh('PS1 − (0 V)')).toBe('PS1 負端（0 V）')
    expect(railByZh('FG1 out (peak)')).toMatch(/^FG1 \S+端（峰值）$/)
    expect(railByZh('FG1 gnd')).not.toContain(':')
    expect(railByZh('U1 3.3 V regulator')).toBe('U1 的 3.3 V 穩壓器')
  })

  it('a finding reads 「5.00 V」 / 「3.60 V」 in Chinese, never a second number style', () => {
    // 5 V straight into the Blue Pill's 3.3 V pin
    const f = runErc(valid(bluePill([], [], { via3v3: true, supply: 5 }))).find((x) => x.rule === 'supply-range')!
    const zh = tMessage(f.message)
    expect(zh).toContain('5.00 V')
    expect(zh).toContain('3.60 V')
    expect(zh).not.toMatch(/[^.\d]3\.6 V/)
  })
})

describe('「在電路板上標示」 frames where the fix goes', () => {
  // PS1 on the top rails; R1 from top+ to column 10; LED1 anode in column 10, cathode alone in column 14
  const openCathode = valid(railsWorld([part('R1', 'resistor', ['top+3', 'a10'], { resistance: 330 }), part('D1', 'led', ['b10', 'b14'])]))

  it('an LED cathode that connects to nothing names the nearest fed − rail hole', () => {
    const f = runErc(openCathode).find((x) => x.rule === 'open-lead')!
    expect(f.holes).toEqual(['b14'])
    expect(f.fixHoles).toEqual(['top-10'])
    expect(ercProblem(f).fixHoles).toEqual(['top-10'])
  })

  it('a cathode on an unpowered rail names the powered rail of the same polarity', () => {
    const l = valid(railsWorld([part('R1', 'resistor', ['top+3', 'a10'], { resistance: 330 }), part('D1', 'led', ['b10', 'bot-12'])]))
    const f = runErc(l).find((x) => x.rule === 'open-lead')!
    expect(f.holes[0]).toBe('bot-12')
    expect(f.fixHoles).toEqual(['top-12'])
  })

  it('locateProblem frames the fix target unmarked, a little wider; other rows keep the plain call', () => {
    const calls: { frame: unknown[]; mark: unknown[] } = { frame: [], mark: [] }
    const scene: BridgeScene = {
      frameContent: () => {},
      frameTargets: (spec, opts) => void calls.frame.push({ spec, opts }),
      setProblemHighlights: (spec) => void calls.mark.push(spec),
      problemHighlightLevels: ['error', 'risk', 'info'],
    }
    registerScene(scene)
    useStore.setState({ layout: openCathode })
    const p = ercProblem(runErc(openCathode).find((x) => x.rule === 'open-lead')!)
    locateProblem(p)
    expect(calls.frame[0]).toEqual({ spec: { holes: ['b14', 'top-10'], components: ['D1'] }, opts: { minSpanHoles: 12 } })
    expect(calls.mark[0]).toEqual({ holes: ['b14'], components: ['D1'], level: 'info' })
    calls.frame.length = 0
    locateProblem({ ...p, id: 'plain', fixHoles: undefined })
    expect(calls.frame[0]).toEqual({ spec: { holes: ['b14'], components: ['D1'] }, opts: undefined })
  })
})

describe('hover marks the place on the board (H7 highlightSource)', () => {
  it('a mouse on a pin row puts the marker up; leaving clears it; touch never does', () => {
    const seen: unknown[] = []
    registerScene({ frameContent: () => {}, frameTargets: () => {}, setProblemHighlights: () => {}, setSourceHighlight: (s) => void seen.push(s) })
    const props = sourceHoverProps({ holes: ['c20'] })
    props.onPointerEnter?.({ pointerType: 'touch' } as never)
    expect(seen).toEqual([])
    props.onPointerEnter?.({ pointerType: 'mouse' } as never)
    expect(seen).toEqual([{ holes: ['c20'], components: [] }])
    props.onPointerLeave?.({ pointerType: 'mouse' } as never)
    expect(seen).toEqual([{ holes: ['c20'], components: [] }, null])
    // a list that unmounts with nothing up does not clear someone else's marker
    releaseSourceHover()
    expect(seen).toHaveLength(2)
    expect(sourceHoverProps(null)).toEqual({})
  })
})

describe('「在模擬日誌中檢視」 on every new-chrome surface', () => {
  const log: SimLogEntry[] = [
    {
      time: 0.4,
      level: 'warning',
      source: 'U1/TIM1',
      message:
        'TIM1 is counting with CCxE/CCxNE set but BDTR.MOE = 0: an advanced-control timer keeps its outputs disabled until the main output enable is set (RM0008 §14.4.18). HAL_TIM_PWM_Start() sets it; register-level code needs TIM1->BDTR |= TIM_BDTR_MOE.',
    },
  ]
  const telemetry: SimTelemetry = {
    time: 1,
    netVoltages: {},
    issues: [],
    components: { U1: { pinVoltages: {}, mcu: { state: 'running', pc: 0x08000338, hclkHz: 72e6, cycles: 1, pinModes: { PA8: 'af' } } } },
  }
  const frame: McuFrameInfo = { componentId: 'U1', state: 'running', firmware: 'x.elf', pc: 0x08000338, hclkHz: 72e6, cycles: 1, realtime: 1, uarts: [] }
  const FW = { componentId: 'U1', name: 'x.elf', format: 'elf' as const, sha256: 'a'.repeat(64), size: 1, loadedAt: 0, warnings: [] }

  it('a log row offers it without the desktop workspace (the phone) and presents the log there', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    try {
      const l = valid(bluePill())
      const rows = deriveProblems({ layout: l, findings: runErc(l), issues: [], firmware: { U1: FW }, mcus: { U1: frame }, running: true, simTime: 1, log, telemetry })
      const moe = rows.find((p) => p.fact === 'tim-moe:U1:TIM1')!
      expect(moe.action?.label).toBe('在模擬日誌中檢視')
      const before = useInstrumentRequest.getState().request?.seq ?? 0
      moe.action!.run()
      expect(useLab.getState().workspace.tray.tab).toBe('log')
      expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'log', seq: before + 1 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the classic English chrome never offers it', () => {
    __setLangForTests('en')
    const l = valid(bluePill())
    const rows = deriveProblems({ layout: l, findings: runErc(l), issues: [], firmware: { U1: FW }, mcus: { U1: frame }, running: true, simTime: 1, log, telemetry })
    expect(rows.find((p) => p.fact === 'tim-moe:U1:TIM1')?.action).toBeUndefined()
  })
})
