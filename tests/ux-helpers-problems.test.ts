/**
 * UX fix wave — helper H5: problems contract v2 (src/ui/embedded/problems.ts).
 *  - MCU state rows carry Problem.fact ('fw-missing:U1', 'power:U1', …);
 *  - ProblemsState.layout is the circuit the list was computed for (the pill
 *    never says 「電路已就緒」 for a circuit the list has not seen);
 *  - boardBlocker(id): power → firmware → lockup → halt → BOOT0, from MCU
 *    rows, ERC power errors and simulator issues alike.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import {
  __resetProblemsForTests,
  blockerKindOf,
  boardBlocker,
  deriveProblems,
  recomputeProblems,
  simIssueFact,
  useProblems,
  type Problem,
} from '../src/ui/embedded/problems'
import { bluePill, modesTelemetry, part, tap, valid } from './erc/helpers'

const BOARD_ONLY: CircuitLayout = { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }

/** U1 fed 5 V on its 5V pin (j27), G pin (j28) on the − rail. */
const POWERED: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    { id: 'W3', from: 'j28', to: 'top-2', color: 'black' },
  ],
}

function frame(state: McuFrameInfo['state'], pc = 0x08000100): McuFrameInfo {
  return { componentId: 'U1', state, firmware: 'x.elf', pc, hclkHz: 8e6, cycles: 1, realtime: 1, uarts: [] }
}

const FW = { U1: { componentId: 'U1', name: 'hal-blink.elf', format: 'elf' as const, sha256: 'a'.repeat(64), size: 1, loadedAt: 0, warnings: [] } }

function derive(layout: CircuitLayout, opts: { firmware?: boolean; frame?: McuFrameInfo; running?: boolean; issues?: { level: 'error' | 'warning'; message: string; componentId?: string }[] } = {}): Problem[] {
  return deriveProblems({
    layout,
    findings: runErc(layout),
    issues: opts.issues ?? [],
    firmware: opts.firmware ? FW : {},
    mcus: opts.frame ? { U1: opts.frame } : {},
    running: opts.running ?? false,
    simTime: opts.running ? 1 : 0,
  })
}

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  useStore.setState({ running: false, simTime: 0 })
  useLab.setState({ firmware: {}, mcus: {} })
})

describe('H5 Problem.fact on the MCU state rows', () => {
  it('no firmware → fw-missing:U1; halted → halt:U1; lockup → lockup:U1; BOOT0 → boot0:U1', () => {
    expect(derive(POWERED).find((p) => p.source === 'mcu')?.fact).toBe('fw-missing:U1')
    expect(derive(POWERED, { firmware: true, frame: frame('halted') }).find((p) => p.source === 'mcu')?.fact).toBe('halt:U1')
    expect(derive(POWERED, { firmware: true, frame: frame('lockup') }).find((p) => p.source === 'mcu')?.fact).toBe('lockup:U1')
    expect(derive(POWERED, { firmware: true, frame: frame('running', 0x1ffff100) }).find((p) => p.source === 'mcu')?.fact).toBe('boot0:U1')
  })
})

describe('H5 boardBlocker', () => {
  it('a board with no supply at all is blocked by power before anything else', () => {
    const list = derive(BOARD_ONLY)
    const b = boardBlocker('U1', list)
    expect(b?.kind).toBe('power')
    expect(b?.problem.source).toBe('erc')
  })

  it('a powered board without firmware → fw-missing (its action is 載入韌體…)', () => {
    const b = boardBlocker('U1', derive(POWERED))
    expect(b?.kind).toBe('fw-missing')
    expect(b?.problem.action?.label).toBe('載入韌體…')
  })

  it('halted / lockup / BOOT0 / nothing', () => {
    expect(boardBlocker('U1', derive(POWERED, { firmware: true, frame: frame('halted') }))?.kind).toBe('halt')
    expect(boardBlocker('U1', derive(POWERED, { firmware: true, frame: frame('lockup') }))?.kind).toBe('lockup')
    expect(boardBlocker('U1', derive(POWERED, { firmware: true, frame: frame('running', 0x1ffff100) }))?.kind).toBe('boot0')
    expect(boardBlocker('U1', derive(POWERED, { firmware: true, frame: frame('running') }))).toBeNull()
    expect(boardBlocker('U2', derive(POWERED))).toBeNull()
  })

  it('simulator issues count too (no facts needed): unpowered, no ground, no firmware', () => {
    const sim = (message: string, componentId?: string): Problem => ({
      id: `sim:${componentId ?? ''}:${message}`,
      level: 'warning',
      source: 'sim',
      title: message,
      detail: message,
      componentIds: componentId ? [componentId] : [],
      holes: [],
    })
    expect(blockerKindOf(sim('U1: MCU unpowered (VDD 0.00 V) — feed 5V', 'U1'), 'U1')).toBe('power')
    expect(blockerKindOf(sim('no ground'), 'U1')).toBe('power')
    expect(blockerKindOf(sim('U1: no firmware loaded — board simulated electrically only', 'U1'), 'U1')).toBe('fw-missing')
    expect(blockerKindOf(sim('U2: MCU unpowered', 'U2'), 'U1')).toBeNull()
    // an ERC power error blocks the board it is ABOUT (or every consumer of "no power source"),
    // not a board that merely feeds the part through its regulator
    const erc = (id: string, componentIds: string[]): Problem => ({
      id: `erc:${id}`,
      level: 'error',
      source: 'erc',
      rule: id.split(':')[0],
      title: id,
      detail: id,
      componentIds,
      holes: [],
    })
    expect(blockerKindOf(erc('unpowered:U1', ['U1']), 'U1')).toBe('power')
    expect(blockerKindOf(erc('ground-reference:U1', ['U1']), 'U1')).toBe('power')
    expect(blockerKindOf(erc('unpowered:no-source', ['LED1', 'U1']), 'U1')).toBe('power')
    expect(blockerKindOf(erc('unpowered:X1', ['X1', 'U1']), 'U1')).toBeNull()
    expect(blockerKindOf({ ...erc('unpowered:U1', ['U1']), level: 'warning' }, 'U1')).toBeNull()
    // a fact decides on its own; '*' = every board
    const p = { ...sim('x'), fact: 'power:*' }
    expect(blockerKindOf(p, 'U7')).toBe('power')
    expect(blockerKindOf({ ...p, fact: 'overcurrent:U1:PA5' }, 'U1')).toBeNull()
  })
})

describe('H5 ProblemsState.layout', () => {
  it('starts null; a run stamps the layout it was computed for, even when the rows are unchanged', () => {
    expect(useProblems.getState().layout).toBeNull()
    useStore.getState().resetSim()
    __resetHistoryForTests()
    useStore.setState({ layout: POWERED })
    recomputeProblems(10_000)
    expect(useProblems.getState().layout).toBe(POWERED)
    recomputeProblems(12_000) // past the firmware grace: the no-firmware row is in
    const rows = useProblems.getState().problems
    expect(rows.map((p) => p.fact)).toContain('fw-missing:U1')
    const same: CircuitLayout = { ...POWERED } // a new identity, the same circuit
    useStore.setState({ layout: same })
    recomputeProblems(13_000)
    expect(useProblems.getState().layout).toBe(same)
    expect(useProblems.getState().problems).toBe(rows) // no re-render of the list
  })
})

describe('QA IN-F2 a floating MCU pin folds under its cause', () => {
  // Blue Pill powered, LED1 anode on PA5's strip, its cathode on an unconnected rail
  const LED_ON_PA5 = valid(bluePill([part('LED1', 'led', [tap('PA5'), 'bot-30'])]))
  const FLOAT = { level: 'warning' as const, message: 'U1 PA5: floating input — nothing drives its net and no pull-up/down is enabled; reads are undefined', componentId: 'U1' }

  it('the simulator message states the fact float:U1:PA5', () => {
    expect(simIssueFact(FLOAT)).toBe('float:U1:PA5')
    expect(simIssueFact({ ...FLOAT, componentId: undefined })).toBe('float:U1:PA5')
  })

  it('no firmware: the float row is a consequence of 「U1 還沒有韌體」, never a row of its own', () => {
    const rows = deriveProblems({
      layout: LED_ON_PA5,
      findings: runErc(LED_ON_PA5),
      issues: [FLOAT],
      firmware: {},
      mcus: {},
      running: true,
      simTime: 1,
    })
    expect(rows.some((p) => p.fact === 'float:U1:PA5')).toBe(false)
    const fw = rows.find((p) => p.fact === 'fw-missing:U1')!
    expect(fw.title).toBe('U1 還沒有韌體')
    expect(fw.folded?.head).toBe('連帶影響（先解決：U1 還沒有韌體）')
    expect(fw.folded?.items).toEqual(['U1 PA5 浮接輸入'])
    // what is left: two rows — the open LED cathode and the board's missing firmware
    // the cathode IS wired — to a rail nothing feeds (persona fix: was 「LED1 陰極沒接」)
    expect(rows.map((p) => p.title).sort()).toEqual(['LED1 陰極的電源軌沒接電', 'U1 還沒有韌體'])
  })

  it('a firmware that leaves PA5 an input: 「LED1 接在 PA5，但 PA5 不是輸出」 with the float folded as 「另 1 個相關」', () => {
    const tel = modesTelemetry({ PA5: 'in' })
    tel.time = 1
    tel.components.U1.mcu!.firmware = 'lesson-a3-uart-dma.elf'
    const findings = runErc(LED_ON_PA5, { telemetry: tel })
    expect(findings.some((f) => f.id === 'gpio-mode:U1:PA5')).toBe(true)
    const rows = deriveProblems({
      layout: LED_ON_PA5,
      findings,
      issues: [FLOAT],
      firmware: FW,
      mcus: { U1: frame('running') },
      running: true,
      simTime: 1,
      telemetry: tel,
    })
    expect(rows.some((p) => p.fact === 'float:U1:PA5')).toBe(false)
    const gpio = rows.find((p) => p.id === 'erc:gpio-mode:U1:PA5')!
    expect(gpio.title).toBe('LED1 接在 PA5，但 PA5 不是輸出')
    expect(gpio.folded).toEqual({ head: '另 1 個相關', items: ['U1 PA5 浮接輸入'] })
  })

  it('another board’s or a part’s float is not folded under U1', () => {
    const rows = deriveProblems({
      layout: LED_ON_PA5,
      findings: runErc(LED_ON_PA5),
      issues: [{ ...FLOAT, message: FLOAT.message.replace('U1 PA5', 'U2 PA5'), componentId: 'U2' }],
      firmware: {},
      mcus: {},
      running: true,
      simTime: 1,
    })
    expect(rows.some((p) => p.fact === 'float:U2:PA5')).toBe(true)
  })
})
