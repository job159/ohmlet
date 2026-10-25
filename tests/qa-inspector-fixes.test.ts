/**
 * Release QA — the inspector area's fixes (IN-F1 … IN-F8):
 *
 *  - IN-F7 a core stuck in its own fault handler (IPSR 3–6): McuViewState
 *          'fault-handler' (「在 HardFault 處理常式中」, lockup's red), the
 *          problem row 「U1 發生 HardFault——韌體停在 HardFault_Handler」
 *          (error, fact lockup:U1) with the decoded CFSR / BFAR — checked on
 *          the REAL Cortex-M3 core running a hand-assembled image
 *  - IN-F3 the debugger halt is a state (not counted, 「目前狀態」 first, the
 *          state's colour); runtime rows carry the runtime hint; a board-state
 *          sentence appears once in the inspector (its 執行狀態 card); the
 *          debug row's resume verb is 「繼續執行」
 *  - IN-F1 the firmware picker recommends a lesson only while it is guided,
 *          or open AND on the board; otherwise no row starts highlighted
 *  - IN-F4 an off-board terminal's location is where its wire goes
 *  - IN-F5 on-board elements by name, the id as a tag
 *  - IN-F6 pin-row targets ≥ 24 px, 「瞬時」 ≥ 4.5 : 1
 *  - IN-F8 「執行模擬」, upper-case addresses, the 「對調兩腳」 answer
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import qaInspector from '../src/i18n/zh-TW/qa-inspector'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { CreateCortexM3 } from '../src/mcu/core/cpu-api'
import { loadBin } from '../src/mcu/loader/bin'
import { Stm32f103 } from '../src/mcu/stm32f1/soc'
import { frameFault, type McuFrameInfo } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import type { FirmwareRecord } from '../src/state/lab-types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { stateColor } from '../src/ui/chrome/run-control'
import { activeLessonId, firmwareGroups } from '../src/ui/embedded/BundledFirmwarePicker'
import { ProblemsPanelView } from '../src/ui/embedded/ErcPanel'
import {
  POWER_UP_GRACE_S,
  faultCauseText,
  faultHandlerDetail,
  faultHintText,
  faultHandlerLabel,
  frameFaultOf,
  mcuReadoutsHidden,
  mcuUiStateOf,
  upperAddresses,
} from '../src/ui/embedded/format'
import { useLab } from '../src/ui/embedded/lab'
import { FirmwareGroup, McuStateBadge, mcuStateColor, mcuStateLabel } from '../src/ui/embedded/McuPanel'
import { subcircuitName, terminalDestination, terminalWired } from '../src/ui/embedded/PartInfo'
import { ProblemsView, isRuntimeProblem, problemsHeaderText, runtimeHint } from '../src/ui/embedded/ProblemsList'
import {
  __resetProblemsForTests,
  blockerKindOf,
  boardBlocker,
  countProblems,
  deriveProblems,
  recomputeProblems,
  swapLeadsWithFeedback,
  useProblems,
  type Problem,
} from '../src/ui/embedded/problems'
import { getToasts } from '../src/ui/kit/toasts'
import { lessonById } from '../src/lessons'
import { bundledFirmwareNames } from '../src/firmware-assets'
import { Inspector } from '../src/ui/workspace/Inspector'
import { englishLeft } from './i18n/zh-check'
import { bluePill, part, tap, valid } from './erc/helpers'

const ROOT = path.resolve(__dirname, '..')

const corePath = '../src/mcu/core/cpu'
const coreMod: { createCortexM3?: CreateCortexM3 } | null = await import(/* @vite-ignore */ corePath).catch(() => null)
const createCortexM3 = coreMod?.createCortexM3

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  __setLangForTests('zh-TW')
  useStore.setState({ selection: [], running: false, simTime: 0, telemetry: null })
  useLab.setState({ firmware: {}, mcus: {} })
})

/** U1 fed 5 V, G on the − rail (blink-ready). */
const POWERED = valid(bluePill())

const RECORD = (name = 'fault-handler.bin', description = 'raw binary, 96 bytes at 0x08000000'): FirmwareRecord => ({
  componentId: 'U1',
  name,
  format: name.endsWith('.bin') ? 'bin' : 'elf',
  sha256: 'a'.repeat(64),
  size: 96,
  loadedAt: 0,
  warnings: [],
  description,
})

function frame(state: McuFrameInfo['state'], extra: Partial<McuFrameInfo> = {}, pc = 0x08000050): McuFrameInfo {
  return { componentId: 'U1', state, firmware: 'fault-handler.bin', pc, hclkHz: 8e6, cycles: 1000, realtime: 1, uarts: [], ...extra }
}

/** The analyst's fault-handler.bin, hand-assembled: a load from 0x30000000 (no memory there) faults; every handler is `b .`. */
function faultImage(load = true): Uint8Array {
  const b = new Uint8Array(96)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 0x20005000, true) // initial SP
  dv.setUint32(4, 0x08000041, true) // Reset_Handler (Thumb) at 0x08000040
  for (let v = 2; v < 16; v++) dv.setUint32(v * 4, 0x08000051, true) // NMI … SysTick → the loop at 0x08000050
  if (load) {
    dv.setUint16(0x40, 0x4801, true) // ldr r0, [pc, #4]  → 0x30000000
    dv.setUint16(0x42, 0x6801, true) // ldr r1, [r0]      → BusFault, escalated to HardFault
  } else {
    dv.setUint16(0x40, 0xbf00, true) // nop
    dv.setUint16(0x42, 0xbf00, true) // nop
  }
  dv.setUint16(0x44, 0xe7fe, true) // b .
  dv.setUint16(0x46, 0xbf00, true)
  dv.setUint32(0x48, 0x30000000, true)
  dv.setUint16(0x50, 0xe7fe, true) // HardFault_Handler: b .
  dv.setUint16(0x52, 0xbf00, true)
  return b
}

/** Run an image on the real core and take the board's frame the way the coordinator builds it (SIM-F2). */
function runOnCore(bytes: Uint8Array): McuFrameInfo {
  const parsed = loadBin(bytes, 'fault-handler.bin')
  if (!parsed.ok) throw new Error(parsed.error)
  const mcu = new Stm32f103({ createCore: createCortexM3 as CreateCortexM3 })
  expect(mcu.loadFirmware(parsed.image).ok).toBe(true)
  mcu.reset('power-on')
  mcu.runUntil(0.01)
  const ds = mcu.debugState()
  const fault = frameFault(ds.faults)
  return {
    componentId: 'U1',
    state: ds.state,
    firmware: 'fault-handler.bin',
    pc: ds.registers.r[15] ?? 0,
    hclkHz: ds.hclkHz,
    cycles: ds.cycles,
    realtime: 1,
    uarts: [],
    exception: ds.ipsr,
    ...(fault ? { fault } : {}),
  }
}

/**
 * A server render reads a zustand store's INITIAL state (getServerState ||
 * getInitialState): render `el` against the stores' live state instead.
 */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useProblems] as unknown as { getState: () => object; getInitialState: () => object }[]
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

/** The text a person reads (tags and attributes stripped): a sentence in an aria-label is not shown twice. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '\n')

function derive(f: McuFrameInfo, layout: CircuitLayout = POWERED): Problem[] {
  return deriveProblems({ layout, findings: runErc(layout), issues: [], firmware: { U1: RECORD() }, mcus: { U1: f }, running: true, simTime: 1 })
}

// ---------------------------------------------------------------------------
// IN-F7
// ---------------------------------------------------------------------------

describe('QA IN-F7 a core in its own fault handler', () => {
  const at = (state: McuFrameInfo['state'], exception: number | undefined, running = true) =>
    mcuUiStateOf({ hasFirmware: true, running, simTime: 1, frame: { state, pc: 0x08000050, exception } })

  it('a running / sleeping frame with exception 3–6 is 「在 … 處理常式中」 in lockup’s red', () => {
    expect(at('running', 3)).toBe('fault-handler')
    expect(at('sleeping', 6)).toBe('fault-handler')
    expect(at('running', 3, false)).toBe('fault-handler') // paused there: the fault is the news
    expect(at('running', 0)).toBe('running') // thread mode
    expect(at('running', 15)).toBe('running') // SysTick (blink)
    expect(at('running', 2)).toBe('running') // NMI is not a fault
    expect(at('running', undefined)).toBe('running') // a host that does not report it: no guessing
    expect(at('halted', 3)).toBe('halted')
    expect(at('lockup', 3)).toBe('lockup')
    // callers without the exception keep the narrow McuUiState
    expect(mcuUiStateOf({ hasFirmware: true, running: true, simTime: 1, frame: { state: 'running', pc: 0x08000050 } })).toBe('running')
    expect(faultHandlerLabel(3)).toBe('在 HardFault 處理常式中')
    expect(faultHandlerLabel(4)).toBe('在 MemManage 處理常式中')
    expect(faultHandlerLabel(5)).toBe('在 BusFault 處理常式中')
    expect(faultHandlerLabel(6)).toBe('在 UsageFault 處理常式中')
    expect(mcuStateLabel('fault-handler', 3)).toBe('在 HardFault 處理常式中')
    expect(mcuStateLabel('lockup')).toBe('故障（鎖死）')
    expect(mcuStateColor('fault-handler')).toBe(stateColor('lockup'))
    expect(mcuReadoutsHidden('fault-handler')).toBe(false)
    const badge = renderToStaticMarkup(createElement(McuStateBadge, { state: 'fault-handler', exception: 3 }))
    expect(badge).toContain('在 HardFault 處理常式中')
    expect(badge).toContain(`--emb-state:${stateColor('lockup')}`)
  })

  it('the fault registers in words: the cause, the address only when valid, the PC only when known', () => {
    const precise = { cfsr: (1 << 9) | (1 << 15), hfsr: 1 << 30, bfar: 0x30000000 }
    expect(faultCauseText(precise)).toBe('精確 BusFault：存取 0x30000000 時出錯')
    expect(faultCauseText({ ...precise, pc: 0x08000042 })).toBe('精確 BusFault：存取 0x30000000 時出錯（pc 0x08000042）')
    expect(faultCauseText({ cfsr: 1 << 9, hfsr: 0, bfar: 0x30000000 })).toBe('精確 BusFault：資料存取出錯') // BFARVALID clear: no address
    expect(faultCauseText({ cfsr: 1 << 16, hfsr: 1 << 30 })).toBe('UsageFault：未定義指令')
    expect(faultCauseText({ cfsr: 1 << 25, hfsr: 0 })).toBe('UsageFault：除以零')
    expect(faultCauseText({ cfsr: 0, hfsr: 1 << 1 })).toBe('HardFault：讀取向量表失敗')
    expect(faultCauseText({ cfsr: 0, hfsr: 1 << 30 })).toBe('HardFault：其他故障升級成 HardFault')
    expect(faultCauseText(null)).toBeNull()
    // the cause, what it means, and what to check (the next step)
    expect(faultHandlerDetail(3, precise)).toBe(
      '精確 BusFault：存取 0x30000000 時出錯。核心停在 HardFault_Handler（預設的處理常式是無窮迴圈），程式不會再往下執行。' +
        '常見原因：指標指向不存在的位址（沒有初始化或算錯的指標）。',
    )
    expect(faultHandlerDetail(5, null)).toBe('核心停在 BusFault_Handler（預設的處理常式是無窮迴圈），程式不會再往下執行。')
    __setLangForTests('en')
    expect(faultHandlerDetail(3, precise)).toBe(
      'Precise BusFault: the access to 0x30000000 failed. The core is in HardFault_Handler (the default handler is an endless loop), so the program does not go on. ' +
        'Common cause: a pointer to an address where nothing is (an uninitialised or miscalculated pointer).',
    )
    __setLangForTests('zh-TW')
    // one plain next step per cause bit; none for a cause the registers do not name
    expect(faultHintText({ cfsr: 1 << 16, hfsr: 1 << 30 })).toBe('常見原因：跳到不是程式碼的位址執行（函式指標錯誤），或把資料當成指令執行。')
    expect(faultHintText({ cfsr: 1 << 17, hfsr: 1 << 30 })).toBe('常見原因：跳到偶數位址（Thumb 位元為 0），例如函式指標少了 |1。')
    expect(faultHintText({ cfsr: 1 << 12, hfsr: 1 << 30 })).toBe('常見原因：堆疊用盡（堆疊溢位，超出 RAM 範圍）。')
    expect(faultHintText({ cfsr: 1 << 25, hfsr: 0 })).toBe('除法前請先檢查除數是否為 0（韌體開啟了除以零陷阱）。')
    expect(faultHintText({ cfsr: 0, hfsr: 1 << 1 })).toBe('常見原因：VTOR 指向的位置沒有向量表（例如映像檔沒有放在 0x08000000）。')
    expect(faultHintText({ cfsr: 0, hfsr: 1 << 30 })).toBeNull() // FORCED alone names no cause
    expect(faultHintText(null)).toBeNull()
    expect(faultHandlerDetail(6, { cfsr: 1 << 16, hfsr: 0 })).toBe(
      'UsageFault：未定義指令。核心停在 UsageFault_Handler（預設的處理常式是無窮迴圈），程式不會再往下執行。常見原因：跳到不是程式碼的位址執行（函式指標錯誤），或把資料當成指令執行。',
    )
    // frames are read structurally (McuFrameInfo.exception / fault — SIM-F2)
    expect(frameFaultOf({ exception: 3, fault: { cfsr: 1, hfsr: 2, bfar: 3 } })).toEqual({ exception: 3, fault: { cfsr: 1, hfsr: 2, bfar: 3 } })
    expect(frameFaultOf({ state: 'running' })).toEqual({ exception: null, fault: null })
  })

  it.skipIf(typeof createCortexM3 !== 'function')('the real core in fault-handler.bin: a red board blocker with the decoded BusFault', () => {
    const f = runOnCore(faultImage())
    expect(f.state).toBe('running')
    expect(f.exception).toBe(3)
    expect(mcuUiStateOf({ hasFirmware: true, running: true, simTime: 1, frame: { state: f.state, pc: f.pc, exception: f.exception } })).toBe('fault-handler')
    const rows = derive(f)
    const row = rows.find((p) => p.id === 'mcu:fault-handler:U1')!
    expect(row).toMatchObject({ level: 'error', source: 'mcu', fact: 'lockup:U1', title: 'U1 發生 HardFault——韌體停在 HardFault_Handler' })
    expect(row.detail).toContain('精確 BusFault：存取 0x30000000 時出錯')
    expect(row.detail).toContain('核心停在 HardFault_Handler')
    expect(englishLeft(row.detail.replace(/HardFault_Handler|BusFault/g, ''))).toEqual([])
    expect(row.action?.label).toBe('查看暫存器')
    expect(row.extraActions?.map((a) => a.label)).toEqual(['在模擬日誌中檢視'])
    expect(rows[0]).toBe(row) // the first error: the pill names it
    expect(countProblems(rows).error).toBe(1)
    expect(boardBlocker('U1', rows)?.kind).toBe('lockup')
    expect(blockerKindOf(row, 'U1')).toBe('lockup')
  })

  it.skipIf(typeof createCortexM3 !== 'function')('a firmware that never faults (thread mode) shows nothing of it', () => {
    const f = runOnCore(faultImage(false))
    expect(f.exception).toBe(0)
    expect(f.fault).toBeUndefined()
    expect(derive(f).some((p) => p.id.startsWith('mcu:fault-handler:'))).toBe(false)
  })

  it('blink in its SysTick handler is fine; a lockup keeps 「U1 故障（鎖死）」; halted in the handler keeps the fault', () => {
    expect(derive(frame('running', { exception: 15 })).some((p) => p.id.startsWith('mcu:fault-handler:'))).toBe(false)
    const lock = derive(frame('lockup', { exception: 3, fault: { cfsr: 1 << 9, hfsr: 1 << 30 } }))
    expect(lock.filter((p) => p.source === 'mcu').map((p) => p.title)).toEqual(['U1 故障（鎖死）'])
    // 「查看暫存器」 halts the core: the fault stays the error, the halt is a state
    const halted = derive(frame('halted', { exception: 3, fault: { cfsr: (1 << 9) | (1 << 15), hfsr: 1 << 30, bfar: 0x30000000 } }))
    expect(halted.find((p) => p.id === 'mcu:fault-handler:U1')?.level).toBe('error')
    expect(halted.find((p) => p.id === 'mcu:halted:U1')?.state).toBe(true)
    expect(boardBlocker('U1', halted)?.kind).toBe('lockup')
  })

  it('「查看暫存器」 halts a running core and opens its 概況 tab', () => {
    const halts: string[] = []
    useStore.setState({ layout: POWERED })
    useLab.setState({ mcus: { U1: frame('running', { exception: 3 }) }, mcuHalt: (id: string) => void halts.push(id) } as never)
    const row = derive(frame('running', { exception: 3 })).find((p) => p.id === 'mcu:fault-handler:U1')!
    row.action!.run()
    expect(halts).toEqual(['U1'])
    expect(useStore.getState().selection).toEqual(['U1'])
  })

  it('a board fed 5 V does not flash 「沒有供電」 on ▶: the start-up frames wait like the problems list', () => {
    const unpowered = { state: 'unpowered' as const, pc: 0 }
    // before the supply was evaluated (≤ POWER_UP_GRACE_S): no reading yet
    expect(mcuUiStateOf({ hasFirmware: true, running: true, simTime: 1, powerSettled: false, frame: unpowered })).toBe('no-data')
    // past it, an unpowered board says so — the moment the problems list files 「U1 沒有供電」
    expect(mcuUiStateOf({ hasFirmware: true, running: true, simTime: 1, powerSettled: true, frame: unpowered })).toBe('unpowered')
    expect(POWER_UP_GRACE_S).toBe(0.05)
    const derived = (simTime: number) =>
      deriveProblems({ layout: POWERED, findings: [], issues: [], firmware: { U1: RECORD() }, mcus: { U1: frame('unpowered') }, running: true, simTime }).some(
        (p) => p.id === 'mcu:unpowered:U1',
      )
    expect(derived(POWER_UP_GRACE_S / 2)).toBe(false)
    expect(derived(POWER_UP_GRACE_S * 2)).toBe(true)
    // callers that do not say (the perf overlay) take every frame as it is
    expect(mcuUiStateOf({ hasFirmware: true, running: true, simTime: 1, frame: unpowered })).toBe('unpowered')
  })

  it('「查看暫存器」 then scrolls the register rows (#regs-U1) into view once the halted core was read', async () => {
    useStore.setState({ layout: POWERED })
    useLab.setState({ mcus: { U1: frame('running', { exception: 3 }) }, mcuHalt: () => {} } as never)
    const scrolled: string[] = []
    let frames = 0
    // the register rows appear a few frames after the halt (McuPanel reads the stopped core)
    const el = (id: string) => ({ scrollIntoView: () => void scrolled.push(id) })
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'regs-U1' ? (frames > 4 ? el(id) : null) : el(id)) })
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(() => (frames++, cb()), 1))
    try {
      derive(frame('running', { exception: 3 }))
        .find((p) => p.id === 'mcu:fault-handler:U1')!
        .action!.run()
      await new Promise((r) => setTimeout(r, 120))
      expect(scrolled).toContain('insp-U1') // the part first (focusInspector)
      expect(scrolled.at(-1)).toBe('regs-U1') // then the registers the button named
      expect(scrolled.filter((s) => s === 'regs-U1')).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------
// IN-F3
// ---------------------------------------------------------------------------

describe('QA IN-F3 a halt is a state; one sentence in one place', () => {
  it('the halted row is a state: not counted, not a risk, listed first under 「目前狀態」 in its own colour', () => {
    const rows = derive(frame('halted'))
    const halt = rows.find((p) => p.fact === 'halt:U1')!
    expect(halt.state).toBe(true)
    expect(countProblems(rows)).toEqual({ error: 0, warning: 0, info: expect.any(Number) })
    expect(problemsHeaderText(rows)).not.toMatch(/問題（[1-9]/)
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: rows, live: true, layout: POWERED }))
    expect(html).toContain('目前狀態')
    expect(html).not.toContain('erc-badge is-risk') // no orange count
    expect(textOf(html).split('U1 核心已停住（偵錯器）').length - 1).toBe(1)
    expect(html).toContain(`background:${stateColor('halted')}`)
    expect(html.indexOf('目前狀態')).toBeLessThan(html.indexOf('U1 核心已停住（偵錯器）'))
    // the phone's list: the same group first
    const list = renderToStaticMarkup(createElement(ProblemsView, { problems: rows, layout: POWERED }))
    expect(list).toContain('目前狀態')
  })

  it('runtime rows say where their certainty comes from (a lockup is an error the wiring does not prove)', () => {
    const lock = derive(frame('lockup'))
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: lock, live: true, layout: POWERED }))
    expect(runtimeHint()).toBe('執行時狀態：由模擬中的晶片回報')
    expect(html).toContain('執行時狀態：由模擬中的晶片回報')
    expect(html).not.toContain('確定錯誤：由接線與元件額定值即可確定')
    // an ERC error and a runtime error in one group: the ERC hint heads it, the runtime row carries its own
    const erc: Problem = { id: 'erc:x', level: 'error', source: 'erc', rule: 'supply-short', title: 'PS1 短路', detail: '…', componentIds: ['PS1'], holes: [] }
    const mixed = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: [erc, ...lock], live: true, layout: POWERED }))
    expect(mixed).toContain('確定錯誤：由接線與元件額定值即可確定')
    expect(mixed).toContain('erc-basis')
  })

  it('「U1 還沒有韌體」 is known before ▶: it never claims to be reported by the running chip', () => {
    const rows = deriveProblems({ layout: POWERED, findings: runErc(POWERED), issues: [], firmware: {}, mcus: {}, running: false, simTime: 0 })
    const fw = rows.find((p) => p.fact === 'fw-missing:U1')!
    expect(fw.source).toBe('mcu')
    expect(isRuntimeProblem(fw)).toBe(false)
    expect(isRuntimeProblem(derive(frame('lockup'))[0])).toBe(true)
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: rows, live: false, layout: POWERED }))
    expect(html).toContain('U1 還沒有韌體')
    expect(html).not.toContain('執行時狀態：由模擬中的晶片回報')
  })

  it('the selected board’s state facts: the part card shows the title + 「見下方執行狀態」, the bottom list leaves them out', () => {
    const rows = derive(frame('halted'))
    const card = renderToStaticMarkup(createElement(ProblemsView, { variant: 'compact', componentId: 'U1', boardState: 'U1', problems: rows, layout: POWERED }))
    expect(card).toContain('U1 核心已停住（偵錯器）')
    expect(card).toContain('見下方執行狀態')
    expect(card).not.toContain('偵錯器停住了核心')
    const panel = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: rows, live: true, layout: POWERED, boardState: 'U1' }))
    expect(panel).not.toContain('U1 核心已停住（偵錯器）')
    expect(panel).toContain('沒有發現其他問題（U1 的狀態見上方「執行狀態」）')
  })

  /** Render the workspace inspector with U1 selected after one problems run. */
  function inspectorFor(layout: CircuitLayout, f: McuFrameInfo | null, opts: { running?: boolean; firmware?: boolean } = {}): string {
    __resetHistoryForTests()
    useStore.setState({ layout, selection: ['U1'], running: opts.running ?? false, simTime: 1, telemetry: null })
    // the firmware first: a (re)binding marks the board's frame of that moment as history (trackMcuResets)
    useLab.setState({ firmware: opts.firmware === false ? {} : { U1: RECORD('hal-blink.elf', 'ELF32 ARM, Thumb entry 0x08000b45') } })
    useLab.setState({ mcus: f ? { U1: f } : {} })
    recomputeProblems(10_000)
    recomputeProblems(12_000) // past the firmware grace
    return renderLive(createElement(Inspector, { onCollapse: () => {} }))
  }
  const count = (html: string, s: string) => textOf(html).split(s).length - 1

  it('blink halted (Space → F5): 「偵錯器停住了核心…」 exactly once in U1’s inspector; the debug row says 「繼續執行」', () => {
    const html = inspectorFor(POWERED, frame('halted', {}, 0x0800074a))
    expect(count(html, '偵錯器停住了核心')).toBe(1)
    expect(count(html, 'U1 核心已停住（偵錯器）')).toBe(1)
    expect(html).toContain('見下方執行狀態')
    expect(html).toContain('id="exec-U1"')
    // the debug row's resume: the one verb of the status card and the pill
    expect(html).toMatch(/aria-labelledby="dbg-U1"[\s\S]*繼續執行/)
    expect(html).not.toMatch(/aria-labelledby="dbg-U1"[^]*?>繼續<\/button>/)
  })

  it('no power source (PS1 deleted, ▶): 「電路中沒有電源，因此 U1…」 exactly once in U1’s inspector', () => {
    const noSupply: CircuitLayout = { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }
    const html = inspectorFor(noSupply, frame('unpowered'), { running: true })
    expect(count(html, '電路中沒有電源，因此 U1')).toBe(1)
    expect(html).toContain('見下方執行狀態')
  })

  it('the run button says 「執行模擬」; the firmware card prints addresses upper-case', () => {
    const html = inspectorFor(POWERED, null)
    expect(html).toContain('執行模擬')
    expect(html).not.toMatch(/>執行<\/span>/)
    useStore.setState({ selection: ['U1'] })
    const card = renderLive(createElement(FirmwareGroup, { componentId: 'U1' }))
    expect(card).toContain('Thumb 進入點 0x08000B45')
    expect(card).not.toContain('0x08000b45')
    expect(upperAddresses('ELF32 ARM，Thumb 進入點 0x08000b45')).toBe('ELF32 ARM，Thumb 進入點 0x08000B45')
    expect(upperAddresses('I²C 位址 0x3c')).toBe('I²C 位址 0x3c')
  })
})

// ---------------------------------------------------------------------------
// IN-F1
// ---------------------------------------------------------------------------

describe('QA IN-F1 the picker recommends only the lesson the learner is on', () => {
  const always = () => true
  const never = () => false

  it('guided first; a viewed lesson only while its browser is on screen AND its circuit is on the board', () => {
    expect(activeLessonId({ coachId: 'b1-led-resistor', viewId: 'a3-uart-dma', browserShown: false, onBoard: never })).toBe('b1-led-resistor')
    expect(activeLessonId({ coachId: null, viewId: 'a3-uart-dma', browserShown: true, onBoard: always })).toBe('a3-uart-dma')
    expect(activeLessonId({ coachId: null, viewId: 'a3-uart-dma', browserShown: false, onBoard: always })).toBeNull() // the 課程 tab is hidden
    expect(activeLessonId({ coachId: null, viewId: 'a3-uart-dma', browserShown: true, onBoard: never })).toBeNull() // the board was cleared
    expect(activeLessonId({ coachId: null, viewId: null, browserShown: true, onBoard: always })).toBeNull()
  })

  it('a3 viewed, the board cleared to Blue Pill + LED: no 「本課使用」 group, 範例韌體 first', () => {
    const a3 = lessonById('a3-uart-dma')
    expect(a3).toBeTruthy()
    const cleared = valid(bluePill([part('LED1', 'led', [tap('PA5'), 'bot-30'])]))
    const id = activeLessonId({ coachId: null, viewId: 'a3-uart-dma', browserShown: false, onBoard: () => true })
    expect(id).toBeNull()
    const groups = firmwareGroups(bundledFirmwareNames(), id ? lessonById(id) : null)
    expect(groups[0].id).toBe('example')
    expect(cleared.components.length).toBeGreaterThan(0)
    // while a lesson that uses hal-blink is guided, 「本課使用 · hal-blink」 stays first
    const b1 = firmwareGroups(bundledFirmwareNames(), lessonById(activeLessonId({ coachId: 'i1-gpio-output', viewId: null, browserShown: false, onBoard: never })!))
    expect(b1[0].id).toBe('lesson')
    expect(b1[0].options[0].name).toBe('hal-blink')
  })

  it('the picker starts with no highlighted row unless a lesson recommends one (Enter loads nothing by surprise)', () => {
    const src = readFileSync(path.join(ROOT, 'src/ui/embedded/BundledFirmwarePicker.tsx'), 'utf8')
    expect(src).toMatch(/useState\(\(\) => \(recommended \? 0 : -1\)\)/)
    expect(src).toMatch(/aria-activedescendant=\{flat\.length > 0 && active >= 0/)
  })
})

// ---------------------------------------------------------------------------
// IN-F4 / IN-F5
// ---------------------------------------------------------------------------

describe('QA IN-F4 an off-board terminal says where its wire goes', () => {
  it('「→ 下方 + 電源軌 第 0 孔」, 「… 等 2 處」, 「未接線」 — never "PS1:+"', () => {
    const l: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'DMM1', type: 'multimeter' },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'bot+0', color: 'red' },
        { id: 'W2', from: 'PS1:-', to: 'bot-0', color: 'black' },
        { id: 'W3', from: 'bot-5', to: 'PS1:-', color: 'black' },
      ],
    }
    expect(terminalDestination(l, 'PS1:+')).toBe('→ 下方 + 電源軌 第 0 孔')
    expect(terminalDestination(l, 'PS1:-')).toBe('→ 下方 − 電源軌 第 0 孔 等 2 處')
    expect(terminalDestination(l, 'DMM1:COM')).toBe('未接線')
    for (const s of ['PS1:+', 'PS1:-', 'DMM1:COM']) expect(terminalDestination(l, s)).not.toMatch(/[A-Z]+\d+:/)
    // an unwired terminal has no net: its row shows no reading (never a solver's 「0 V」)
    expect(terminalWired(l, 'PS1:+')).toBe(true)
    expect(terminalWired(l, 'DMM1:COM')).toBe(false)
  })
})

describe('QA IN-F5 on-board elements by name', () => {
  it('the Blue Pill’s elements read as parts, with the catalog’s values (the real board’s 10 kΩ R10)', () => {
    const bp = getEntry('stm32_bluepill')!
    const names = Object.fromEntries((bp.subcircuit ?? []).map((el) => [el.id, subcircuitName(bp, el)]))
    expect(names).toEqual({
      REG: '3.3 V 穩壓器（LDO）',
      LED_PWR: '電源指示 LED',
      R_PWR: '電源 LED 限流電阻',
      LED_PC13: 'PC13 板載 LED',
      R_PC13: 'PC13 LED 限流電阻（510 Ω）',
      R_USB_DP: 'USB D+ 上拉電阻（10 kΩ）',
    })
    // anything else: 「板載{元件}」 — no raw model names in Chinese
    for (const type of ['lm7805', 'relay_5v', 'uln2003_board', 'level_shifter_4ch', 'usb_uart_ch340']) {
      const e = getEntry(type)
      for (const el of e?.subcircuit ?? []) {
        const name = subcircuitName(e!, el)
        expect(name.startsWith('板載'), name).toBe(true)
        expect(englishLeft(name.replace(/\b(LED|LDO|NPN|MOSFET|SRD-05|USB)\b/g, '')), `${type} ${el.id}: ${name}`).toEqual([])
      }
    }
    __setLangForTests('en')
    expect(subcircuitName(bp, bp.subcircuit!.find((el) => el.id === 'LED_PWR')!)).toBe('Power indicator LED')
  })
})

// ---------------------------------------------------------------------------
// IN-F6 / IN-F8 / dictionary
// ---------------------------------------------------------------------------

describe('QA IN-F6 pin-row targets and the 瞬時 tag', () => {
  const css = readFileSync(path.join(ROOT, 'src/ui/embedded/inspector.css'), 'utf8')
  const rule = (sel: string) => {
    const at = css.indexOf(`${sel} {`)
    expect(at, sel).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('the hole buttons are ≥ 24 × 24 px without a taller row', () => {
    const r = rule('.emb-pin .insp-pin-hole')
    expect(r).toMatch(/min-height:\s*24px/)
    expect(r).toMatch(/min-width:\s*24px/)
    expect(r).toMatch(/margin-block:\s*-3px/) // 24 − 18 line height, given back
  })

  it('「瞬時」 uses the secondary label token: ≥ 4.5 : 1 on the dark and the light panel', () => {
    expect(rule('.insp-pin-instant')).toMatch(/color:\s*var\(--label-2\)/)
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (fg: [number, number, number, number], bg: [number, number, number]) => {
      const mix = fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])) as [number, number, number]
      const [a, b] = [lum(...mix), lum(...bg)]
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    // --label-2 of the kit: rgba(255,255,255,0.64) dark / rgba(22,25,35,0.62) light (src/ui/kit tokens)
    expect(ratio([255, 255, 255, 0.64], [38, 40, 48])).toBeGreaterThanOrEqual(4.5)
    expect(ratio([22, 25, 35, 0.62], [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('QA IN-F8 「對調兩腳」 answers', () => {
  it('a swap says it happened; a refused swap says so', () => {
    __resetHistoryForTests()
    useStore.setState({ layout: { version: 1, components: [{ id: 'LED1', type: 'led', holes: ['a20', 'a24'] }], wires: [] } })
    expect(swapLeadsWithFeedback('LED1')).toBe(true)
    expect(useStore.getState().layout.components[0].holes).toEqual(['a24', 'a20'])
    expect(getToasts().at(-1)?.text).toBe('已對調 LED1 的兩腳')
    expect(swapLeadsWithFeedback('LED9')).toBe(false)
    expect(getToasts().at(-1)?.text).toBe('無法對調 LED9 的兩腳')
  })
})

describe('QA inspector dictionary', () => {
  it('every new string has Taiwan Chinese; the English sources are keys t() finds', () => {
    for (const [k, v] of Object.entries(qaInspector)) {
      expect(hasTranslation(k), k).toBe(true)
      expect(englishLeft(v.replace(/\b(HardFault|MemManage|BusFault|UsageFault|IPSR|ARMv7-M|ARM|LDO|pc)\b|\{\w+\}/g, '')), k).toEqual([])
    }
    expect(t('Run simulation')).toBe('執行模擬')
    expect(t('Resume running')).toBe('繼續執行')
  })

  it('the problems store counts no state rows', () => {
    useStore.setState({ layout: POWERED })
    useLab.setState({ firmware: { U1: RECORD() } })
    useLab.setState({ mcus: { U1: frame('halted') } })
    useStore.setState({ running: false, simTime: 1 })
    recomputeProblems(10_000)
    expect(useProblems.getState().counts.warning).toBe(0)
    expect(useProblems.getState().problems.some((p) => p.state)).toBe(true)
  })
})
