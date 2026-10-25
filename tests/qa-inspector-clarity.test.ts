/**
 * Release QA — the analysis-panel clarity items of the inspector area:
 *
 *  - MCU-CYCLES          the CPU cycle count is 「時脈週期數」 (never the bare 週期,
 *                        which is a period on the scope and the analyzer)
 *  - GLOSSARY-ENTRIES    the instruments' jargon and the register grid in the
 *                        glossary (zh-TW for every id); the grid decodes ipsr
 *                        (「3（HardFault）」) and shows mmfar / bfar as 「—（無效）」
 *                        unless CFSR says they hold an address
 *  - LOCKUP-CAUSE        the known cause of a lockup in words (a .bin at another
 *                        base, a bad vector table) with the one-click fix
 *                        「改用 0x08000000 重新載入」; the capsule in the pill's words
 *  - PERIPH-LIVE-CONFIG  「韌體目前的設定」: what the firmware set up (USART line
 *                        settings + pins, I²C / SPI pins, PWM channels, ADC
 *                        inputs) with the instrument that shows each
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CreateCortexM3 } from '../src/mcu/core/cpu-api'
import type { McuDebugState, UartLineConfig } from '../src/mcu/mcu-api'
import { loadFirmwareFile } from '../src/mcu/loader'
import { Stm32f103 } from '../src/mcu/stm32f1/soc'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore, sha256Hex } from '../src/state/firmware-store'
import type { FirmwareRecord } from '../src/state/lab-types'
import { useStore } from '../src/state/store'
import { useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'
import { GLOSSARY, glossaryText, type GlossaryId } from '../src/ui/embedded/glossary'
import {
  DEFAULT_BIN_BASE,
  boundBinBase,
  exceptionName,
  faultAddressValid,
  fmtCount,
  fmtFaultAddress,
  fmtIpsr,
  lockupCauseOf,
  lockupCauseText,
} from '../src/ui/embedded/format'
import { useLab } from '../src/ui/embedded/lab'
import {
  FirmwareGroup,
  FirmwareSetupGroup,
  McuStatsGroup,
  McuStatusGroup,
  RegisterRows,
  reloadBinAtDefault,
  setupAction,
  type McuView,
} from '../src/ui/embedded/McuPanel'
import { firmwareSetup, uartFrameText, type SetupInput } from '../src/ui/embedded/mcu-setup'
import { __resetProblemsForTests, deriveProblems, showExecutionState, useInspectorFocus, useProblems } from '../src/ui/embedded/problems'
import { englishLeft } from './i18n/zh-check'
import { bluePill, valid } from './erc/helpers'

const ROOT = path.resolve(__dirname, '..')

const corePath = '../src/mcu/core/cpu'
const coreMod: { createCortexM3?: CreateCortexM3 } | null = await import(/* @vite-ignore */ corePath).catch(() => null)
const createCortexM3 = coreMod?.createCortexM3

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  __setLangForTests('zh-TW')
  __setFirmwareBlobStoreForTests(null)
  useStore.setState({ selection: [], running: false, simTime: 0, telemetry: null })
  useLab.setState({ firmware: {}, mcus: {} })
})

/** U1 fed 5 V, G on the − rail. */
const POWERED = valid(bluePill())

const BLUE_PILL = getEntry('stm32_bluepill')!

const BARE_BLINK = new Uint8Array(readFileSync(path.join(ROOT, 'firmware/dist/bare-blink.bin')))

/** The record lab.loadFirmware binds for `bare-blink.bin` at `base` (the real loader's description). */
function binRecord(base: number, bytes = BARE_BLINK): FirmwareRecord {
  const parsed = loadFirmwareFile('bare-blink.bin', bytes, { binBase: base })
  if (!parsed.ok) throw new Error(parsed.error)
  return {
    componentId: 'U1',
    name: 'bare-blink.bin',
    format: 'bin',
    sha256: sha256Hex(bytes),
    size: bytes.length,
    loadedAt: 0,
    warnings: parsed.image.warnings.slice(),
    description: parsed.image.description,
  }
}

function frame(state: McuFrameInfo['state'], extra: Partial<McuFrameInfo> = {}): McuFrameInfo {
  return { componentId: 'U1', state, firmware: 'bare-blink.bin', pc: 0xfffffffe, hclkHz: 8e6, cycles: 1000, realtime: 1, uarts: [], ...extra }
}

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
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

/** The text a person reads (tags stripped, entities decoded). */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

/** A McuView for the stats group: a running core at `cycles`. */
function runningView(cycles: number): McuView {
  return {
    live: { state: 'running', pc: 0x08000100, cycles, hclkHz: 72e6, realtime: 1, firmware: 'hal-blink.elf', exception: 0, fault: null },
    dbg: null,
    pc: 0x08000100,
    symbol: 'main',
    hasCore: true,
    halted: false,
    stopped: false,
    hide: false,
  }
}

/** The register snapshot of the audit's lockup (c14-006): bare-blink.bin at 0x08001000. */
function lockupDbg(over: Partial<McuDebugState> = {}): McuDebugState {
  const r = Array.from({ length: 16 }, () => 0)
  r[13] = 0xffffffdc
  r[14] = 0xfffffff9
  r[15] = 0xfffffffe
  return {
    state: 'lockup',
    registers: { r, xpsr: 0x01000003 } as McuDebugState['registers'],
    faults: { cfsr: 0x00001001, hfsr: 0x40000000, mmfar: 0, bfar: 0 },
    cycles: 1000,
    instructions: 100,
    hclkHz: 8e6,
    ipsr: 3,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// MCU-CYCLES
// ---------------------------------------------------------------------------

describe('QA clarity MCU-CYCLES: the CPU cycle count is 「時脈週期數」', () => {
  it('the 概況 tab reads 「時脈週期數 153 563 289」 and its glossary names the count', () => {
    expect(t('Cycles')).toBe('時脈週期數')
    expect(glossaryText('cycles').title).toBe('時脈週期數（CPU 時脈週期）')
    expect(glossaryText('cycles').body).toBe('重置後經過的核心時脈週期數。韌體執行時會一直增加；核心停住或停在重置時不會動。')
    const html = renderLive(createElement(McuStatsGroup, { componentId: 'U1', view: runningView(153563289) }))
    const text = textOf(html)
    expect(fmtCount(153563289)).toMatch(/^153.563.289$/)
    expect(text).toContain(`時脈週期數ⓘ${fmtCount(153563289)}`)
    expect(text).not.toMatch(/(^|[^脈])週期ⓘ/) // never the bare label
  })

  it('English stays 「Cycles」', () => {
    __setLangForTests('en')
    expect(t('Cycles')).toBe('Cycles')
    expect(glossaryText('cycles').title).toBe('Cycles (CPU clock cycles)')
  })
})

// ---------------------------------------------------------------------------
// GLOSSARY-ENTRIES
// ---------------------------------------------------------------------------

describe('QA clarity GLOSSARY-ENTRIES: the instruments and the register grid in the glossary', () => {
  const NEW: Record<string, { title: string; body: string }> = {
    vpp: { title: '峰對峰值（Vpp）', body: '波形最高點減最低點的電壓差。' },
    avg: { title: '平均值', body: '一段時間內電壓的平均；PWM 的平均值 ≈ 工作週期 × 高電位電壓，萬用電表直流檔量到的就是它。' },
    rms: { title: '均方根（RMS）', body: '換算成等效直流的值，用來算功率；正弦波 ≈ 峰值 × 0.707。' },
    period: { title: '週期', body: '訊號重複一次的時間＝1 ÷ 頻率。' },
    trigger: { title: '觸發', body: '讓波形每次從同一處開始畫：訊號往上（↑）或往下（↓）穿過觸發準位的那一刻是時間 0。' },
    holdoff: { title: '觸發抑制時間', body: '觸發一次後等這段時間才允許下一次，讓複雜波形不亂跳。' },
    vdiv: { title: '每格電壓（V/格）', body: '垂直方向一格代表幾伏特；格數 × V/格＝電壓差。' },
    tdiv: { title: '每格時間（時間/格）', body: '水平方向一格代表的時間；畫面寬 10 格，所以 10 × 時間/格就是畫面顯示的總時間。' },
    baud: { title: '鮑率（Bd）', body: '每秒傳幾個位元；115 200 Bd 每位元約 8.68 µs，兩端要設成一樣。' },
    '8n1': { title: '8N1（資料格式）', body: '8 個資料位元、無同位、1 個停止位元。' },
    edges: { title: '邊緣數', body: '這段時間內訊號在高、低電位之間切換的次數；邊緣太少就量不出頻率。' },
    burst: { title: '突發', body: '只在傳資料時才出現的時脈（I²C、SPI）。' },
    ack: { title: 'ACK／NACK（應答）', body: 'ACK＝接收端拉低 SDA 表示收到；NACK＝沒人回應。掃描 I²C 時大多數位址回 NACK 是正常的。' },
    dt: { title: 'Δt（標記時間差）', body: 'A、B 兩標記之間的時間差；1/Δt 是把它當一個週期時的頻率。' },
    sp: { title: 'SP（堆疊指標）', body: '堆疊頂端的位址。呼叫函式或進入中斷時會把資料推入堆疊，SP 就往下移；重置時從向量表的第一個值載入。' },
    lr: { title: 'LR（返回位址）', body: '目前的函式執行完要回到的位址。在例外處理常式裡則是 EXC_RETURN 值（0xFFFFFFF9 等）。' },
    xpsr: { title: 'xPSR（程式狀態）', body: expect.stringContaining('條件旗標 N、Z、C、V') as unknown as string },
    ipsr: { title: 'IPSR（目前的例外編號）', body: '0＝一般程式；3＝HardFault；15＝SysTick；16 以上是周邊中斷（IRQ 編號＝IPSR − 16）。' },
  }

  it('every new term exists with its zh-TW title and body', () => {
    for (const [id, want] of Object.entries(NEW)) {
      expect(GLOSSARY[id as GlossaryId], id).toBeDefined()
      expect(glossaryText(id as GlossaryId), id).toEqual(want)
    }
  })

  it('every GlossaryId has zh-TW text (the dictionary has both sources), Taiwan usage, no stray English', () => {
    for (const id of Object.keys(GLOSSARY) as GlossaryId[]) {
      const e = GLOSSARY[id]
      // a title that is an identifier itself (BOOT0) stays as written
      expect(hasTranslation(e.title) || /^[A-Z0-9]+$/.test(e.title), `${id} title`).toBe(true)
      expect(hasTranslation(e.body), `${id} body`).toBe(true)
      const g = glossaryText(id)
      expect(/[一-鿿]/.test(g.body), id).toBe(true)
      expect(englishLeft(g.body.replace(/EXC_RETURN|HardFault|SysTick|IPSR|NACK|ACK|SDA|PWM|RMS|Vpp/g, '')), id).toEqual([])
    }
  })

  it('ipsr in words: 「3（HardFault）」, 「0（一般程式）」, a peripheral interrupt by its F103 name', () => {
    expect(fmtIpsr(3)).toBe('3（HardFault）')
    expect(fmtIpsr(0)).toBe('0（一般程式）')
    expect(fmtIpsr(15)).toBe('15（SysTick）')
    expect(fmtIpsr(11)).toBe('11（SVCall）')
    // IPSR = 16 + IRQ (RM0008 Table 63): USART1 = IRQ 37, EXTI15_10 = IRQ 40, TIM3 = IRQ 29
    expect(fmtIpsr(16 + 37)).toBe('53（USART1 中斷）')
    expect(fmtIpsr(16 + 40)).toBe('56（EXTI15_10 中斷）')
    expect(fmtIpsr(16 + 29)).toBe('45（TIM3 中斷）')
    expect(exceptionName(16 + 60)).toBe('IRQ 60')
    expect(fmtIpsr(Number.NaN)).toBe('—')
    __setLangForTests('en')
    expect(fmtIpsr(3)).toBe('3 (HardFault)')
    expect(fmtIpsr(0)).toBe('0 (normal program)')
  })

  it('mmfar / bfar mean something only while CFSR says so (MMARVALID bit 7 / BFARVALID bit 15)', () => {
    expect(faultAddressValid(0x00001001, 'mmfar')).toBe(false)
    expect(faultAddressValid(0x00001001, 'bfar')).toBe(false)
    expect(fmtFaultAddress(0, 0x00001001, 'mmfar')).toBe('—（無效）')
    expect(fmtFaultAddress(0, 0x00001001, 'bfar')).toBe('—（無效）')
    expect(fmtFaultAddress(0x30000000, (1 << 15) | (1 << 9), 'bfar')).toBe('0x30000000')
    expect(fmtFaultAddress(0x20005000, (1 << 7) | (1 << 1), 'mmfar')).toBe('0x20005000')
  })

  it('the lockup register view (c14-006): 「ipsr 3（HardFault）」, 「mmfar —（無效）」, sp / lr / xpsr / ipsr explained', () => {
    const html = renderToStaticMarkup(createElement(RegisterRows, { dbg: lockupDbg(), id: 'regs-U1' }))
    const text = textOf(html)
    expect(text).toContain('ipsrⓘ3（HardFault）')
    expect(text).toContain('mmfar—（無效）')
    expect(text).toContain('bfar—（無效）')
    expect(text).toContain('cfsr0x00001001')
    expect(text).not.toContain('mmfar0x00000000')
    for (const name of ['sp', 'lr', 'pc', 'xpsr', 'ipsr']) expect(html, name).toContain(`<button type="button" class="insp-term "`)
    expect((html.match(/class="emb-reg-name insp-reg-term"/g) ?? []).length).toBe(5)
    expect(html).toContain('title="無效：CFSR.MMARVALID（位元 7）為 0，MMFAR 裡不是故障位址"')
    // a valid BFAR shows its address
    const valid = textOf(
      renderToStaticMarkup(createElement(RegisterRows, { dbg: lockupDbg({ state: 'halted', faults: { cfsr: (1 << 15) | (1 << 9), hfsr: 1 << 30, mmfar: 0, bfar: 0x30000000 } }) })),
    )
    expect(valid).toContain('bfar0x30000000')
    expect(valid).toContain('mmfar—（無效）')
    // a halted core in thread mode
    expect(textOf(renderToStaticMarkup(createElement(RegisterRows, { dbg: lockupDbg({ state: 'halted', ipsr: 0, faults: { cfsr: 0, hfsr: 0, mmfar: 0, bfar: 0 } }) })))).toContain(
      'ipsrⓘ0（一般程式）',
    )
  })

  it.skipIf(typeof createCortexM3 !== 'function')('the real core: bare-blink.bin at 0x08001000 locks up in HardFault with no valid fault address', () => {
    const parsed = loadFirmwareFile('bare-blink.bin', BARE_BLINK, { binBase: 0x08001000 })
    if (!parsed.ok) throw new Error(parsed.error)
    const mcu = new Stm32f103({ createCore: createCortexM3 as CreateCortexM3 })
    expect(mcu.loadFirmware(parsed.image).ok).toBe(true)
    mcu.reset('power-on')
    mcu.runUntil(0.01)
    const ds = mcu.debugState()
    expect(ds.state).toBe('lockup')
    const text = textOf(renderToStaticMarkup(createElement(RegisterRows, { dbg: ds })))
    expect(text).toContain(`ipsrⓘ${fmtIpsr(ds.ipsr)}`)
    expect(fmtIpsr(ds.ipsr)).toBe('3（HardFault）')
    expect(text).toContain('mmfar—（無效）')
  })
})

// ---------------------------------------------------------------------------
// LOCKUP-CAUSE
// ---------------------------------------------------------------------------

describe('QA clarity LOCKUP-CAUSE: the known cause, in words, with the fix', () => {
  const CAUSE = 'bare-blink.bin 載入在 0x08001000，所以 0x08000000 沒有向量表，核心一開機就出錯。'

  it('a .bin loaded at 0x08001000: the sentence names the address', () => {
    const rec = binRecord(0x08001000)
    expect(boundBinBase(rec)).toBe(0x08001000)
    const cause = lockupCauseOf(rec)
    expect(cause).toEqual({ kind: 'bin-base', file: 'bare-blink.bin', base: 0x08001000 })
    expect(lockupCauseText(cause!)).toBe(CAUSE)
    // at the default base the image has a vector table: nothing to blame
    expect(lockupCauseOf(binRecord(DEFAULT_BIN_BASE))).toBeNull()
    expect(lockupCauseOf(null)).toBeNull()
  })

  it.skipIf(typeof createCortexM3 !== 'function')('the loader’s vector-table warnings name the other causes (the real STM32F1 loader’s texts)', () => {
    const run = (bytes: Uint8Array, base = DEFAULT_BIN_BASE) => {
      const parsed = loadFirmwareFile('x.bin', bytes, { binBase: base })
      if (!parsed.ok) throw new Error(parsed.error)
      const mcu = new Stm32f103({ createCore: createCortexM3 as CreateCortexM3 })
      return mcu.loadFirmware(parsed.image).warnings
    }
    const image = (sp: number, pc: number) => {
      const b = new Uint8Array(64)
      const dv = new DataView(b.buffer)
      dv.setUint32(0, sp, true)
      dv.setUint32(4, pc, true)
      return b
    }
    const elf = { name: 'app.elf', format: 'elf', warnings: [] as string[] }
    // an ELF linked at 0x08004000: nothing at 0x08000000
    const erased = run(BARE_BLINK, 0x08001000)
    expect(lockupCauseOf(elf, erased)).toEqual({ kind: 'no-vectors', file: 'app.elf' })
    expect(lockupCauseText(lockupCauseOf(elf, erased)!)).toBe('app.elf 沒有放到 0x08000000，所以那裡沒有向量表，核心一開機就出錯。')
    const badSp = run(image(0x30000000, 0x08000009))
    expect(lockupCauseOf(elf, badSp)).toEqual({ kind: 'bad-sp', file: 'app.elf', sp: '0x30000000' })
    expect(lockupCauseText(lockupCauseOf(elf, badSp)!)).toBe(
      'app.elf 向量表的第一個值（初始堆疊指標 0x30000000）不在 SRAM（0x20000000–0x20005000）裡，所以核心一開機就出錯。',
    )
    const even = run(image(0x20005000, 0x08000008))
    expect(lockupCauseOf(elf, even)).toEqual({ kind: 'reset-thumb', file: 'app.elf', vector: '0x08000008' })
    expect(lockupCauseText(lockupCauseOf(elf, even)!)).toBe('app.elf 的重置向量（0x08000008）Thumb 位元是 0，所以核心一開機就出錯。')
    const outside = run(image(0x20005000, 0x30000001))
    expect(lockupCauseOf(elf, outside)?.kind).toBe('reset-outside')
    expect(lockupCauseText(lockupCauseOf(elf, outside)!)).toBe('app.elf 的重置向量（0x30000001）沒有指向快閃記憶體，所以核心一開機就出錯。')
    // a good image: no cause
    expect(lockupCauseOf(elf, run(image(0x20005000, 0x08000009)))).toBeNull()
  })

  it('the problem row says the same sentence; 「查看原因」 opens the board’s 執行狀態 card', () => {
    const rows = deriveProblems({ layout: POWERED, findings: runErc(POWERED), issues: [], firmware: { U1: binRecord(0x08001000) }, mcus: { U1: frame('lockup') }, running: true, simTime: 1 })
    const row = rows.find((p) => p.id === 'mcu:lockup:U1')!
    expect(row.title).toBe('U1 故障（鎖死）')
    expect(row.detail).toBe(CAUSE)
    expect(row.action?.label).toBe('查看原因')
    // an image the app knows nothing wrong about keeps the common causes
    const plain = deriveProblems({ layout: POWERED, findings: [], issues: [], firmware: { U1: binRecord(DEFAULT_BIN_BASE) }, mcus: { U1: frame('lockup') }, running: true, simTime: 1 })
    expect(plain.find((p) => p.id === 'mcu:lockup:U1')!.detail).toBe('核心在處理錯誤時又發生錯誤而停止。常見原因：0x08000000 沒有向量表，或堆疊指標錯誤。')
    // the loader's log rows (since the load) name a bad vector table of an ELF
    const elfRec: FirmwareRecord = { ...binRecord(DEFAULT_BIN_BASE), name: 'app.elf', format: 'elf', description: 'ELF32 ARM' }
    const log = [
      { time: 0.5, level: 'warning' as const, source: 'U1/loader', message: 'initial stack pointer 0x00000000 is not inside the 20 KiB of SRAM (0x20000000–0x20005000)' },
    ]
    const fromLog = deriveProblems({ layout: POWERED, findings: [], issues: [], firmware: { U1: elfRec }, mcus: { U1: frame('lockup') }, running: true, simTime: 1, log, loadedAt: { U1: 0.5 } })
    expect(fromLog.find((p) => p.id === 'mcu:lockup:U1')!.detail).toContain('初始堆疊指標 0x00000000')
    // a log row of an older image does not count
    const stale = deriveProblems({ layout: POWERED, findings: [], issues: [], firmware: { U1: elfRec }, mcus: { U1: frame('lockup') }, running: true, simTime: 1, log, loadedAt: { U1: 0.8 } })
    expect(stale.find((p) => p.id === 'mcu:lockup:U1')!.detail).toContain('常見原因')
  })

  it('「查看原因」: the board selected, its 概況 tab requested, the 執行狀態 card scrolled to', async () => {
    useStore.setState({ layout: POWERED })
    const scrolled: string[] = []
    vi.stubGlobal('document', { getElementById: (id: string) => ({ scrollIntoView: () => void scrolled.push(id) }) })
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 1))
    try {
      showExecutionState('U1')
      await new Promise((r) => setTimeout(r, 60))
      expect(useStore.getState().selection).toEqual(['U1'])
      expect(useInspectorFocus.getState().request).toMatchObject({ componentId: 'U1', tab: 'overview' })
      expect(scrolled.at(-1)).toBe('exec-U1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the 執行狀態 card: the cause, 「改用 0x08000000 重新載入」 and 「在模擬日誌中檢視」', () => {
    useStore.setState({ layout: POWERED, running: true, simTime: 2 })
    useLab.setState({ firmware: { U1: binRecord(0x08001000) } })
    const view: McuView = { ...runningView(1000), live: { ...runningView(1000).live, state: 'lockup' }, stopped: true }
    const html = renderLive(createElement(McuStatusGroup, { componentId: 'U1', view }))
    const text = textOf(html)
    expect(text).toContain('故障（鎖死）')
    expect(text).toContain(CAUSE)
    expect(text).toContain('改用 0x08000000 重新載入')
    expect(text).toContain('在模擬日誌中檢視')
    expect(text).not.toContain('常見原因')
    expect(html).toContain('id="exec-U1"')
    // the firmware card offers the same fix beside its 「不是預設位址」 note
    const card = textOf(renderLive(createElement(FirmwareGroup, { componentId: 'U1' })))
    expect(card).toContain(t('Not the default address: the vector table must be at 0x08000000.'))
    expect(card).toContain('非預設位址：向量表必須位於 0x08000000。')
    expect(card).toContain('改用 0x08000000 重新載入')
  })

  it('the capsule says the pill’s words and names the pill’s target; the old 「（LOCKUP）……請查看模擬日誌」 is gone', () => {
    const capsule = t('{id} fault (lockup) — see why', { id: 'U1' })
    expect(capsule).toBe('U1 故障（鎖死）——查看原因')
    expect(capsule.startsWith(t('{id} fault (lockup)', { id: 'U1' }))).toBe(true)
    expect(capsule.endsWith(t('See why'))).toBe(true)
    const src = readFileSync(path.join(ROOT, 'src/ui/embedded/McuPanel.tsx'), 'utf8')
    // the new chrome's capsule line; the classic chrome keeps its own words
    expect(src).toMatch(/isLegacyChrome\(\)\s*\?\s*t\('\{id\}: core LOCKUP — see the Simulation log'[^)]*\)\s*:\s*t\('\{id\} fault \(lockup\) — see why'/)
  })

  it('「改用 0x08000000 重新載入」 reloads the bound bytes through lab.loadFirmware at the default base', async () => {
    useStore.setState({ layout: POWERED })
    const store = createMemoryBlobStore()
    __setFirmwareBlobStoreForTests(store)
    const rec = binRecord(0x08001000)
    await store.put(rec.sha256, BARE_BLINK, rec.name)
    const calls: { id: string; name: string; bytes: number; opts: unknown }[] = []
    const loadFirmware = vi.fn(async (id: string, file: { name: string; bytes: Uint8Array }, opts?: { binBase?: number }) => {
      calls.push({ id, name: file.name, bytes: file.bytes.length, opts })
      return { ok: true, warnings: [] }
    })
    useLab.setState({ firmware: { U1: rec }, loadFirmware } as never)
    expect(await reloadBinAtDefault('U1')).toBeNull()
    expect(calls).toEqual([{ id: 'U1', name: 'bare-blink.bin', bytes: BARE_BLINK.length, opts: { binBase: 0x08000000 } }])
    // bytes the store no longer has: the card says what to do
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    useLab.setState({ firmware: { U1: { ...rec, sha256: 'b'.repeat(64) } } })
    expect(await reloadBinAtDefault('U1')).toBe('已經找不到 bare-blink.bin 的內容——請重新選擇這個檔案，並載入到 0x08000000。')
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// PERIPH-LIVE-CONFIG
// ---------------------------------------------------------------------------

describe('QA clarity PERIPH-LIVE-CONFIG: 「韌體目前的設定」 in the 周邊 tab', () => {
  const UART_115200: UartLineConfig = { enabled: true, baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 }
  const base = (over: Partial<SetupInput>): SetupInput => ({
    pinInfo: BLUE_PILL.pinInfo,
    pinMap: BLUE_PILL.mcu?.pinMap,
    clocked: ['Memory map', 'RCC', 'FLASH', 'GPIO', 'AFIO'],
    uarts: [],
    mapr: 0,
    pinModes: {},
    ...over,
  })

  it('uart-hello: USART1 at 115 200 Bd 8N1 on TX PA9 / RX PA10; GPIO and AFIO named once', () => {
    const s = firmwareSetup(
      base({ clocked: ['Memory map', 'RCC', 'FLASH', 'GPIO', 'AFIO', 'USART1'], uarts: [{ name: 'USART1', config: UART_115200 }], pinModes: { PA9: 'af', PA10: 'in' } }),
    )
    expect(s.rows).toEqual([
      {
        block: 'USART1',
        kind: 'uart',
        busKey: 'USART1',
        uart: UART_115200,
        signals: [
          { name: 'TX', pin: 'PA9', boardPin: 'PA9' },
          { name: 'RX', pin: 'PA10', boardPin: 'PA10' },
        ],
      },
    ])
    expect(s.others).toEqual(['GPIO', 'AFIO'])
    expect(uartFrameText(UART_115200)).toBe('8N1')
    expect(uartFrameText({ ...UART_115200, dataBits: 9, parity: 'even', stopBits: 2 })).toBe('8E2')
  })

  it('I2C1 on SCL PB6 / SDA PB7 (remapped: PB8 / PB9); SPI1 on SCK / MISO / MOSI', () => {
    const i2c = firmwareSetup(base({ clocked: ['GPIO', 'AFIO', 'I2C1'], pinModes: { PB6: 'af-od', PB7: 'af-od' } }))
    expect(i2c.rows).toMatchObject([{ block: 'I2C1', kind: 'i2c', busKey: 'I2C1', signals: [{ name: 'SCL', pin: 'PB6' }, { name: 'SDA', pin: 'PB7' }] }])
    const remap = firmwareSetup(base({ clocked: ['I2C1'], mapr: 1 << 1 }))
    expect(remap.rows).toMatchObject([{ block: 'I2C1', remap: true, busKey: 'I2C1-remap', signals: [{ pin: 'PB8' }, { pin: 'PB9' }] }])
    const spi = firmwareSetup(base({ clocked: ['SPI1'] }))
    expect(spi.rows[0].signals.map((x) => `${x.name} ${x.pin}`)).toEqual(['SCK PA5', 'MISO PA6', 'MOSI PA7'])
    // USART3 partially remapped onto pins the Blue Pill does not bring out: no pins named
    const u3 = firmwareSetup(base({ clocked: ['USART3'], mapr: 1 << 4 }))
    expect(u3.rows).toMatchObject([{ block: 'USART3', remap: true, signals: [] }])
  })

  it('pwm-fade: TIM3 CH1 on PA6 (SPI1 off: not MISO); a timer with no output pin; ADC1 inputs', () => {
    const pwm = firmwareSetup(base({ clocked: ['GPIO', 'TIM3'], pinModes: { PA6: 'af' } }))
    expect(pwm.rows).toEqual([{ block: 'TIM3', kind: 'timer', signals: [{ name: 'CH1', pin: 'PA6', boardPin: 'PA6' }] }])
    expect(firmwareSetup(base({ clocked: ['TIM2'] })).rows).toEqual([{ block: 'TIM2', kind: 'timer', signals: [] }])
    const adc = firmwareSetup(base({ clocked: ['ADC1'], pinModes: { PA0: 'an', PA1: 'an' } }))
    expect(adc.rows).toEqual([
      {
        block: 'ADC1',
        kind: 'adc',
        signals: [
          { name: 'IN0', pin: 'PA0', boardPin: 'PA0' },
          { name: 'IN1', pin: 'PA1', boardPin: 'PA1' },
        ],
      },
    ])
    // rows in a fixed order: serial / buses, timers, ADCs
    const all = firmwareSetup(base({ clocked: ['ADC1', 'TIM3', 'I2C1', 'USART1'], uarts: [{ name: 'USART1', config: UART_115200 }] }))
    expect(all.rows.map((r) => r.block)).toEqual(['USART1', 'I2C1', 'TIM3', 'ADC1'])
    // nothing reported: nothing listed
    expect(firmwareSetup(base({ clocked: null, uarts: null })).rows).toEqual([])
  })

  /** U1 running uart-hello (frame + telemetry as the lab has them). */
  function uartHello(): void {
    useStore.setState({
      layout: POWERED,
      running: true,
      simTime: 1,
      telemetry: { components: { U1: { mcu: { state: 'running', pc: 0x08000100, hclkHz: 72e6, cycles: 1, pinModes: { PA9: 'af', PA10: 'in', PC13: 'od' } } } } } as never,
    })
    useLab.setState({
      firmware: { U1: { ...binRecord(DEFAULT_BIN_BASE), name: 'hal-uart-hello.elf', format: 'elf', description: 'ELF32 ARM' } },
      mcus: { U1: frame('running', { clocked: ['Memory map', 'RCC', 'FLASH', 'GPIO', 'AFIO', 'USART1'], uarts: [{ name: 'USART1', config: UART_115200 }], mapr: 0 }) },
    })
  }

  it('the group shows the USART1 row with its terminal link', () => {
    uartHello()
    const html = renderLive(createElement(FirmwareSetupGroup, { componentId: 'U1', onShowPins: () => {} }))
    const text = textOf(html)
    expect(text).toContain('韌體目前的設定')
    expect(text).toContain('USART1')
    // 「TX PA9」 stays on one line (a no-break space); the line may break between the signals
    expect(text).toContain('115 200 Bdⓘ · 8N1ⓘ · TX PA9／RX PA10')
    expect(text).toContain('開啟 UART 終端機')
    expect(text).toContain('另外也開啟了：GPIO、AFIO')
    expect(englishLeft(text.replace(/USART1|GPIO|AFIO|UART|Bd|8N1|TX|RX|PA9|PA10/g, ''))).toEqual([])
  })

  it('「開啟 UART 終端機」 lands on the terminal; the bus and PWM rows put their pins on the analyzer', () => {
    uartHello()
    const rows = firmwareSetup(
      base({ clocked: ['USART1', 'I2C1', 'TIM3'], uarts: [{ name: 'USART1', config: UART_115200 }], pinModes: { PB6: 'af-od', PB7: 'af-od', PA6: 'af' } }),
    ).rows
    const uart = setupAction('U1', rows[0])!
    expect(uart.label).toBe('開啟 UART 終端機')
    const before = useInstrumentRequest.getState().request?.seq ?? 0
    uart.run()
    expect(useLab.getState().workspace.tray.tab).toBe('uart')
    expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'uart', seq: before + 1 })
    expect(setupAction('U1', rows[1])!.label).toBe('加入邏輯分析儀（含解碼器）')
    expect(setupAction('U1', rows[2])!.label).toBe('加入邏輯分析儀')
    expect(setupAction('U1', { block: 'TIM2', kind: 'timer', signals: [] })).toBeNull()
    expect(setupAction('U1', { block: 'ADC1', kind: 'adc', signals: [] })).toBeNull()
  })

  it('the I²C row adds SCL / SDA and the I²C decoder in one click', () => {
    useStore.setState({ layout: POWERED })
    useLab.setState({ logicChannels: [], logicView: { ...useLab.getState().logicView, decoders: [] } } as never)
    const row = firmwareSetup(base({ clocked: ['I2C1'], pinModes: { PB6: 'af-od', PB7: 'af-od' } })).rows[0]
    setupAction('U1', row)!.run()
    const lab = useLab.getState()
    expect(lab.logicChannels.map((c) => c.label)).toEqual(['PB6 SCL', 'PB7 SDA'])
    expect((lab.logicView.decoders as { decoder: string }[]).map((d) => d.decoder)).toEqual(['i2c'])
    // on the analyzer now: the row shows it instead of adding it again (the probe menu's rule)
    const view = setupAction('U1', row)!
    expect(view.label).toBe('在邏輯分析儀中檢視')
    view.run()
    expect(useLab.getState().workspace.tray.tab).toBe('logic')
    expect(useLab.getState().logicChannels).toHaveLength(2)
    // the PWM row the same way
    const pwm = firmwareSetup(base({ clocked: ['TIM3'], pinModes: { PA6: 'af' } })).rows[0]
    expect(setupAction('U1', pwm)!.label).toBe('加入邏輯分析儀')
    setupAction('U1', pwm)!.run()
    expect(useLab.getState().logicChannels.map((c) => c.label)).toContain('PA6')
    expect(setupAction('U1', pwm)!.label).toBe('在邏輯分析儀中檢視')
  })

  it('empty states say the next step', () => {
    useStore.setState({ layout: POWERED })
    const html = () => textOf(renderLive(createElement(FirmwareSetupGroup, { componentId: 'U1', onShowPins: () => {} })))
    expect(html()).toContain('載入韌體並執行後，這裡會列出它設定的序列埠、匯流排、PWM 輸出與類比輸入。')
    useLab.setState({ firmware: { U1: binRecord(DEFAULT_BIN_BASE) } })
    expect(html()).toContain('按「▶ 執行模擬」後，這裡會列出韌體設定的序列埠、匯流排、PWM 輸出與類比輸入。')
    // blink: GPIO only
    useLab.setState({ mcus: { U1: frame('running', { clocked: ['Memory map', 'RCC', 'FLASH', 'GPIO'] }) } })
    const blink = html()
    expect(blink).toContain('韌體沒有使用帶腳位的周邊——它用到的腳位都是一般 GPIO。')
    expect(blink).toContain('查看腳位')
    expect(blink).toContain('另外也開啟了：GPIO')
  })

  it('every new zh-TW string is Chinese (identifiers aside)', () => {
    const keys = [
      'What the firmware set up',
      'Open the UART terminal',
      'Add to logic analyzer (with decoder)',
      'clock on, not enabled yet',
      'no channel drives a pin (it only counts or keeps time)',
      'no analog input pin set up yet',
      'remapped to pins this board does not bring out',
      'Reload at 0x08000000',
      '{id} fault (lockup) — see why',
    ]
    for (const k of keys) {
      expect(hasTranslation(k), k).toBe(true)
      expect(englishLeft(t(k).replace(/UART|PWM|\{\w+\}/g, '')), k).toEqual([])
    }
  })
})
