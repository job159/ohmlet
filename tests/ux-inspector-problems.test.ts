/**
 * UX fix wave — inspector P0 items on the problems list (src/ui/embedded/problems.ts):
 *
 *  - IN-13 one fact, one row, one wording: the MCU's 「U1 還沒有韌體」 and the
 *    simulator's 'no firmware loaded' are one row (with 載入韌體…); an LED
 *    straight on PA5 is one row 「LED1 沒有限流電阻 · 影響 2 處」 (the GPIO
 *    over-current finding and the simulator's driver warning fold in); a
 *    burned LED is one row; a pin headline keeps its part id
 *  - IN-14 no fake numbers: PS1 + 5 V without GND → the per-pin
 *    「−1261957 V」 readings and 「求解器未收斂」 fold under 「U1 的 GND 沒接」
 *    with their values as 「—」 (≤ 4 rows, no |V| ≥ 1 kV anywhere)
 *  - IN-15 a board-state fact (BOOT0 = 1, …) takes the firmware-mode findings
 *    of that board as its consequences; TIM1 MOE = 0 from the simulation log
 *    becomes a row 「TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM」
 *  - IN-16 transient floats move to 「已由即時讀數排除」; firmware-dependent
 *    findings before the firmware ran are 「執行後確認」 (info)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import type { CircuitLayout, SimIssue, SimTelemetry } from '../src/model/types'
import type { McuFrameInfo, SimLogEntry } from '../src/sim/coordinator/api'
import { runErc, type ErcFinding, type ErcOptions } from '../src/sim/erc'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { ProblemsPanelView } from '../src/ui/embedded/ErcPanel'
import { ProblemsView } from '../src/ui/embedded/ProblemsList'
import {
  __resetProblemsForTests,
  countProblems,
  deriveProblems,
  deriveProblemsDetailed,
  problemTitle,
  type Problem,
  type ProblemsInput,
} from '../src/ui/embedded/problems'
import { bluePill, part, tap, valid, w } from './erc/helpers'

const FW = { componentId: 'U1', name: 'hal-blink.elf', format: 'elf' as const, sha256: 'a'.repeat(64), size: 1, loadedAt: 0, warnings: [] }

function frame(state: McuFrameInfo['state'], pc = 0x08000100): McuFrameInfo {
  return { componentId: 'U1', state, firmware: 'hal-blink.elf', pc, hclkHz: 72e6, cycles: 1, realtime: 1, uarts: [] }
}

function input(layout: CircuitLayout, o: Partial<ProblemsInput> & { erc?: ErcOptions } = {}): ProblemsInput {
  return {
    layout,
    findings: o.findings ?? runErc(layout, o.erc ?? {}),
    issues: o.issues ?? [],
    firmware: o.firmware ?? {},
    mcus: o.mcus ?? {},
    running: o.running ?? false,
    simTime: o.simTime ?? 0,
    ...o,
  }
}

const issue = (message: string, componentId?: string, level: SimIssue['level'] = 'warning'): SimIssue =>
  componentId ? { level, message, componentId } : { level, message }

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  useStore.setState({ running: false, simTime: 0 })
  useLab.setState({ firmware: {}, mcus: {} })
})

// ---------------------------------------------------------------------------
// IN-13
// ---------------------------------------------------------------------------

describe('IN-13 one fact, one row', () => {
  const powered = valid(bluePill())

  it('no firmware: one row 「U1 還沒有韌體」 with 載入韌體…, the simulator’s clause folded in', () => {
    const p = deriveProblems(
      input(powered, {
        issues: [issue('U1: no firmware loaded — load an ELF/BIN/HEX; the board is simulated electrically only', 'U1')],
        running: true,
        simTime: 1,
      }),
    )
    const fw = p.filter((x) => x.fact === 'fw-missing:U1' || /韌體/.test(x.title))
    expect(fw.map((x) => x.title)).toEqual(['U1 還沒有韌體'])
    expect(fw[0].action?.label).toBe('載入韌體…')
    expect(fw[0].source).toBe('mcu')
    expect(fw[0].detail).toContain('只以電氣方式模擬')
    expect(p.some((x) => x.title.includes('未載入韌體'))).toBe(false)
  })

  it('BOOT0 = 1: the simulator’s BOOT0 issue and the MCU row are one row', () => {
    const p = deriveProblems(
      input(powered, {
        firmware: { U1: FW },
        mcus: { U1: frame('running', 0x1ffff100) },
        issues: [issue('U1: BOOT0 = 1 selects the system-memory bootloader, which is not emulated — MCU held in reset (set BOOT0 = 0 and reset)', 'U1')],
        running: true,
        simTime: 1,
      }),
    )
    expect(p.filter((x) => x.fact === 'boot0:U1')).toHaveLength(1)
    expect(p.filter((x) => /BOOT0|系統記憶體/.test(x.title))).toHaveLength(1)
  })

  it('an LED straight on PA5: 「LED1 沒有限流電阻 · 影響 2 處」 — over-rating and the driver warning fold in', () => {
    const l = valid(bluePill([part('LED1', 'led', [tap('PA5'), 'top-9'])]))
    const issues = [issue('U1 PA5: driver sources 28.9 mA (> 25 mA) — short circuit or missing series resistor', 'U1')]
    const tel: SimTelemetry = { time: 1, netVoltages: {}, issues: [], components: {} }
    const p = deriveProblems(input(l, { erc: { telemetry: tel, issues }, issues, firmware: { U1: FW }, running: true, simTime: 1 }))
    const risks = p.filter((x) => x.level !== 'info')
    expect(risks.map((x) => x.title), JSON.stringify(risks.map((x) => [x.title, x.fact, x.group]))).toEqual(['LED1 沒有限流電阻'])
    expect(risks[0].affects).toBe(2)
    expect(risks[0].componentIds).toEqual(expect.arrayContaining(['LED1', 'U1']))
    expect(countProblems(p).warning).toBe(1)
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: p, live: true, layout: l }))
    expect(html).toContain('1 個原因 · 影響 2 處')
    expect(html.match(/class="erc-title"/g)?.length).toBe(p.length)
  })

  it('a burned LED is one row; the solver’s 267 A reads 「> 2 A（短路）」', () => {
    const l = valid(bluePill([part('LED1', 'led', ['top+20', 'top-20'])]))
    const tel: SimTelemetry = { time: 1, netVoltages: {}, issues: [], components: { LED1: { pinVoltages: {}, current: 267, burned: true } } }
    const issues = [issue('LED LED1 burned out (current 267295mA — add a series resistor)', 'LED1', 'error')]
    const p = deriveProblems(input(l, { erc: { telemetry: tel, issues }, issues, firmware: { U1: FW }, running: true, simTime: 1 }))
    const burned = p.filter((x) => /燒毀/.test(x.title))
    expect(burned).toHaveLength(1)
    expect(burned[0].fact).toBe('burned:LED1')
    expect(burned[0].detail).toContain('> 2 A（短路）')
    expect(burned[0].detail).not.toMatch(/267/)
  })

  it('a pin headline keeps its part id: 「U1 PA5 驅動器輸出 28.9 mA（> 25 mA）」', () => {
    expect(problemTitle('U1 PA5：驅動器輸出 28.9 mA（> 25 mA）——短路或缺少串聯電阻')).toBe('U1 PA5 驅動器輸出 28.9 mA（> 25 mA）')
    expect(problemTitle('U1：MCU 未供電（VDD 0.00 V）——請供應 5V')).toBe('U1 MCU 未供電（VDD 0.00 V）')
  })

  it('the part header list shows one row and 「另 n 個」 (compact)', () => {
    const rows: Problem[] = ['a', 'b', 'c'].map((k, i) => ({
      id: `erc:${k}`,
      level: i === 0 ? 'error' : 'warning',
      source: 'erc',
      title: `t${k}`,
      detail: `d${k}`,
      componentIds: ['U1'],
      holes: [],
    }))
    const html = renderToStaticMarkup(createElement(ProblemsView, { variant: 'compact', componentId: 'U1', problems: rows }))
    expect(html.match(/class="erc-title"/g)?.length).toBe(1)
    expect(html).toContain('另 2 個')
  })
})

// ---------------------------------------------------------------------------
// IN-14
// ---------------------------------------------------------------------------

describe('IN-14 no fake numbers', () => {
  const noGnd = valid(bluePill([], [], { noGround: true }))
  const pins = ['PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA15', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9']
  const issues: SimIssue[] = [
    issue('solver failed to converge — results may be inaccurate'),
    ...pins.map((p, i) => issue(`U1 ${p}: -${1261957 + i}.64 V is below VSS − 0.3 V`, 'U1')),
    issue('U1: no firmware loaded — load an ELF/BIN/HEX; the board is simulated electrically only', 'U1'),
  ]

  it('PS1 + 5 V only: the pin readings fold under 「U1 的 GND 沒接」 with their values as 「—」', () => {
    const p = deriveProblems(input(noGnd, { issues, running: true, simTime: 1 }))
    expect(p.length, p.map((x) => x.title).join(' | ')).toBeLessThanOrEqual(4)
    const root = p.find((x) => x.title === 'U1 的 GND 沒接')!
    expect(root.level).toBe('error')
    expect(root.detail).toContain(`因為 U1 的 GND 沒接，電路沒有參考點，各腳位電壓無法計算（已隱藏 ${pins.length} 則腳位讀數）`)
    expect(root.folded?.items).toHaveLength(pins.length + 1)
    expect(root.folded!.items[0]).toBe('U1 PB12：— 低於 VSS − 0.3 V')
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: p, live: true, layout: noGnd }))
    expect(html).not.toMatch(/[-−]?\d{4,}(\.\d+)? ?V/)
  })

  it('a converged circuit keeps a real reading row', () => {
    const p = deriveProblems(input(valid(bluePill()), { issues: [issue('U1 PA0: -0.52 V is below VSS − 0.3 V', 'U1')], firmware: { U1: FW }, running: true, simTime: 1 }))
    expect(p.some((x) => x.title.startsWith('U1 PA0'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// IN-15
// ---------------------------------------------------------------------------

describe('IN-15 the live rules know the MCU state', () => {
  // the blink wiring: PA5 → R1 → LED → GND
  const blink = valid(
    bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])], [w(tap('PA5'), 'b40')]),
  )
  const tel = (time: number, pc = 0x08000338): SimTelemetry => ({
    time,
    netVoltages: {},
    issues: [],
    components: { U1: { pinVoltages: {}, mcu: { state: 'running', pc, hclkHz: 72e6, cycles: 1, pinModes: { PA5: 'in' }, firmware: 'hal-blink.elf' } } },
  })
  const gpioMode = (f: readonly ErcFinding[]) => f.filter((x) => x.rule === 'gpio-mode')

  it('Reset MCU while paused (1.2 s): no gpio-mode until the board itself ran 0.5 s', () => {
    expect(gpioMode(runErc(blink, { telemetry: tel(1.2) }))).toHaveLength(1)
    expect(gpioMode(runErc(blink, { telemetry: tel(1.2), mcuResetAt: { U1: 1.2 } }))).toEqual([])
    expect(gpioMode(runErc(blink, { telemetry: tel(1.5), mcuResetAt: { U1: 1.2 } }))).toEqual([])
    expect(gpioMode(runErc(blink, { telemetry: tel(1.8), mcuResetAt: { U1: 1.2 } }))).toHaveLength(1)
    // a mark from another session (later than now) is ignored
    expect(gpioMode(runErc(blink, { telemetry: tel(1.8), mcuResetAt: { U1: 9 } }))).toHaveLength(1)
  })

  it('never blames the firmware from system memory (BOOT0 = 1) or while still at the reset entry point', () => {
    const sysmem = gpioMode(runErc(blink, { telemetry: tel(2, 0x1ffff008) }))
    // a consequence of the BOOT0 state, not of the firmware's pin choice
    expect(sysmem.map((f) => f.short)).toEqual(['D1 on PA5: the firmware is not running'])
    expect(sysmem[0].message).not.toContain('hal-blink')
    __setLangForTests('zh-TW')
    expect(tMessage(sysmem[0].message)).toBe('D1 接在 U1 PA5，但 U1 執行的是 ROM 開機程式（BOOT0 = 1），不是你的韌體，所以沒有東西驅動 PA5。請把 BOOT0 設回 0 再重置 MCU。')
    expect(gpioMode(runErc(blink, { telemetry: tel(2, 0x08000b44), mcuResetPc: { U1: 0x08000b45 } }))).toEqual([])
  })

  it('GPIOA without its clock: the message names IOPAEN, not the pin choice', () => {
    const f = gpioMode(runErc(blink, { telemetry: tel(2), unclockedPorts: { U1: ['GPIOA'] } }))
    expect(f).toHaveLength(1)
    expect(f[0].fact).toBe('gpio-clock:U1:GPIOA')
    __setLangForTests('zh-TW')
    const p = deriveProblems(input(blink, { findings: f, firmware: { U1: FW }, running: true, simTime: 2 }))
    expect(p[0].detail).toContain('韌體寫入 GPIOA 時，GPIOA 的時脈沒有打開（RCC_APB2ENR.IOPAEN = 0），寫入被忽略，所以 PA5 一直是浮接輸入。請先呼叫 __HAL_RCC_GPIOA_CLK_ENABLE()。')
  })

  it('BOOT0 = 1: only the state row, with the firmware-mode finding folded as a consequence', () => {
    const findings = runErc(blink, { telemetry: tel(2, 0x1ffff008) })
    expect(gpioMode(findings)).toHaveLength(1)
    const p = deriveProblems(input(blink, { findings, firmware: { U1: FW }, mcus: { U1: frame('running', 0x1ffff100) }, running: true, simTime: 2 }))
    const warn = p.filter((x) => x.level !== 'info')
    expect(warn.map((x) => x.title)).toEqual(['U1 從系統記憶體開機（未模擬）'])
    expect(warn[0].folded?.head).toBe('連帶影響（先解決：U1 從系統記憶體開機）')
    expect(warn[0].folded?.items).toHaveLength(1)
  })

  it('TIM1 counting with MOE = 0 (the log) → 「TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM」', () => {
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
      components: { U1: { pinVoltages: {}, mcu: { state: 'running', pc: 0x08000338, hclkHz: 72e6, cycles: 1, pinModes: { PA8: 'af', PA0: 'af' } } } },
    }
    const l = valid(bluePill())
    const p = deriveProblems(input(l, { firmware: { U1: FW }, mcus: { U1: frame('running') }, running: true, simTime: 1, log, telemetry }))
    const moe = p.filter((x) => x.fact === 'tim-moe:U1:TIM1')
    expect(moe.map((x) => x.title)).toEqual(['TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM'])
    expect(moe[0].level).toBe('warning')
    expect(moe[0].holes.length).toBeGreaterThan(0)
    // an entry from before the board's last firmware load describes another image
    expect(deriveProblems(input(l, { firmware: { U1: FW }, running: true, simTime: 1, log, loadedAt: { U1: 0.6 }, telemetry })).some((x) => x.fact?.startsWith('tim-moe'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// IN-16
// ---------------------------------------------------------------------------

describe('IN-16 transient and run-dependent findings', () => {
  it('a CMOS input that floated at start-up moves to the cleared rows with its note', () => {
    const l = valid(bluePill())
    const issues = [issue('74HC595 input SRCLK is floating (CMOS inputs must be driven): it keeps its last level', 'U2')]
    const note = '開機時 U2 SRCLK 短暫浮接（MCU 重置期間腳位為高阻抗），之後已被 PA5 驅動。'
    const r = deriveProblemsDetailed(input(l, { issues, firmware: { U1: FW }, running: true, simTime: 2, cleared: new Map([['float:U2:SRCLK', note]]) }))
    expect(r.problems.some((x) => /SRCLK/.test(x.title))).toBe(false)
    expect(r.cleared.map((x) => x.note)).toEqual([note])
  })

  it('before the firmware ran: a floating input it may pull up is 「執行後確認」 (info), not a risk', () => {
    const l = valid(bluePill([{ id: 'SW1', type: 'pushbutton', at: 'f50' }], [w(tap('PB12'), 'j50'), w('j52', 'top-12')]))
    const findings = runErc(l)
    expect(findings.some((f) => f.rule === 'floating-input' && f.level === 'risk')).toBe(true)
    const p = deriveProblems(input(l, { findings, firmware: { U1: FW }, pendingBoards: new Set(['U1']) }))
    const pending = p.filter((x) => x.pendingRuntime)
    expect(pending).toHaveLength(1)
    expect(pending[0].level).toBe('info')
    expect(p.filter((x) => x.level === 'warning' || x.level === 'error')).toEqual([])
    // without firmware there is nothing to wait for: it stays under the firmware fact
    const none = deriveProblems(input(l, { findings }))
    expect(none.some((x) => x.pendingRuntime)).toBe(false)
  })
})
