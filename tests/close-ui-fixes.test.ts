/**
 * Release close-out, UI (closeout-requests.md — the items in the UI files):
 *
 *  - FG-RAIL (hover chip)  a function generator's output net: the chip says
 *                          what the generator is SET to, 「方波 100 Hz ·
 *                          0–5.00 V」 — never the jumping instant (H4 NetLive
 *                          'source' in src/ui/workspace/hole-chip.ts)
 *  - CHIP-AFTER-LAYOUT     the hover chip and ring follow a layout change
 *                          (after Delete, 「PS1 正端」 does not stay over the spot
 *                          the supply left — src/three/scene.ts)
 *  - FG-RAIL (3)           the 即時讀數 card of a waveform source: 電流 / 功率
 *                          as 「交流（瞬時值會跳動）——請用示波器看」 with the scope
 *                          one tap away; the pin rows' titles say a setting is
 *                          a setting (netLiveTitle(live)), a 'source' pin is a
 *                          signal (PartInfo is-signal)
 *  - IS-F11                the 讀數 card of a multimeter with an unwired probe:
 *                          what is missing and the next step under the 「—」,
 *                          the 量測 tab's words
 *  - LOCKUP-CAUSE          tapping the capsule while 「U1 故障（鎖死）——查看原因」
 *                          shows opens the 執行狀態 card (StatusBar action +
 *                          McuPanel lockupCapsuleLine)
 *  - UART port request     「開啟 UART 終端機」 on a USART2 row asks for USART2
 *  - IDD wording           the Blue Pill limit in plain words
 *  - H9 verbs              在邏輯分析儀中檢視 / 執行模擬 in the lessons and the
 *                          instruments dictionaries
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { partSupport } from '../src/i18n/parts'
import { CATALOG, getEntry } from '../src/model/catalog'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { ACTION_EXPAND_MS, capsuleActionTitle, capsuleTap, detailActionOf } from '../src/ui/chrome/StatusBar'
import { useLab } from '../src/ui/embedded/lab'
import { __resetNetActivityForTests, resolveNet } from '../src/ui/embedded/instruments/net-activity'
import { lockupCapsuleLine, setupAction } from '../src/ui/embedded/McuPanel'
import { PinoutGroup } from '../src/ui/embedded/PartInfo'
import { __resetProblemsForTests, useInspectorFocus, useProblems } from '../src/ui/embedded/problems'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'
import { holeChipTextFor } from '../src/ui/workspace/hole-chip'
import { useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'
import { englishLeft } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** The rc-lowpass example's circuit (FG1 square 100 Hz 0–5 V into R1 / C1, PRB1 on the input strip). */
const RC: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 100, amplitude: 2.5, offset: 2.5 } },
    { id: 'R1', type: 'resistor', holes: ['b10', 'b20'], params: { resistance: 10000 } },
    { id: 'C1', type: 'capacitor', holes: ['c20', 'top-16'], params: { capacitance: 1e-7 } },
    { id: 'PRB1', type: 'scope_probe', holes: ['e10'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'W2', from: 'FG1:out', to: 'a10', color: 'yellow' },
    { id: 'W3', from: 'FG1:gnd', to: 'top-1', color: 'black' },
  ],
}

/** The lm7805-regulator example's meter, its IN wire (W5) removed. */
const DMM_OPEN: CircuitLayout = {
  version: 1,
  components: [
    { id: 'BAT1', type: 'battery_9v' },
    { id: 'U1', type: 'lm7805', holes: ['c40', 'c41', 'c42'] },
    { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } },
  ],
  wires: [
    { id: 'W1', from: 'BAT1:-', to: 'top-0', color: 'black' },
    { id: 'W2', from: 'BAT1:+', to: 'a40', color: 'red' },
    { id: 'W3', from: 'a41', to: 'top-32', color: 'black' },
    { id: 'W6', from: 'DMM1:COM', to: 'top-35', color: 'black' },
  ],
}
const DMM_WIRED: CircuitLayout = { ...DMM_OPEN, wires: [...DMM_OPEN.wires, { id: 'W5', from: 'DMM1:IN', to: 'e42', color: 'red' }] }

function telemetry(time: number, volts: Record<string, number>, components: SimTelemetry['components'] = {}): SimTelemetry {
  return { time, netVoltages: volts, components, issues: [] }
}

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useProblems, useInspectorFocus] as unknown as { getState: () => object; getInitialState: () => object }[]
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

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetNetActivityForTests()
  __resetProblemsForTests()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useLab.setState({ logicChannels: [] })
})
afterEach(() => {
  __setLangForTests('zh-TW')
  __resetNetActivityForTests()
  useStore.setState({ selection: [], running: false, simTime: 0, telemetry: null })
})

// ---------------------------------------------------------------------------
// FG-RAIL — the hover chip on a function generator's output net
// ---------------------------------------------------------------------------

describe('FG-RAIL: the hover chip says the generator’s setting', () => {
  let out = ''
  beforeEach(() => {
    useStore.setState({ layout: RC, selection: [], running: true, simTime: 1, telemetry: null })
    out = resolveNet('a10', RC) ?? ''
    expect(out).not.toBe('')
  })

  it('a10 (FG1 output strip) reads 「方波 100 Hz · 0–5.00 V」 whatever the instant is', () => {
    for (const v of [4.99, 0, 0.00218, 2.5]) {
      useStore.setState({ telemetry: telemetry(1, { [out]: v }) })
      const text = holeChipTextFor(RC, 'a10', useStore.getState().telemetry)
      expect(text).toBe('導線 W2 · 方波 100 Hz · 0–5.00 V · a10（R1 第 1 腳這一排）')
    }
    // R1's own pin on that strip: the same words
    expect(holeChipTextFor(RC, 'b10', useStore.getState().telemetry)).toBe('R1 第 1 腳 · 方波 100 Hz · 0–5.00 V · b10')
  })

  it('the chip follows the setting (a knob change), and says nothing live without a session', () => {
    const layout: CircuitLayout = {
      ...RC,
      components: RC.components.map((c) => (c.id === 'FG1' ? { ...c, params: { ...c.params, waveform: 'sine', frequency: 1000 } } : c)),
    }
    useStore.setState({ layout, telemetry: telemetry(1, { [out]: 3.1 }) })
    expect(holeChipTextFor(layout, 'a10', useStore.getState().telemetry)).toBe('導線 W2 · 正弦波 1 kHz · 0–5.00 V · a10（R1 第 1 腳這一排）')
    useStore.setState({ telemetry: null })
    expect(holeChipTextFor(layout, 'a10', null)).toBe('導線 W2 · a10（R1 第 1 腳這一排）')
  })

  it('a net that is not the generator’s keeps its instantaneous reading', () => {
    const c1 = resolveNet('c20', RC)!
    useStore.setState({ telemetry: telemetry(1, { [out]: 5, [c1]: 1.25 }) })
    expect(holeChipTextFor(RC, 'c20', useStore.getState().telemetry)).toContain('1.25 V')
  })
})

// ---------------------------------------------------------------------------
// CHIP-AFTER-LAYOUT — src/three/scene.ts
// ---------------------------------------------------------------------------

interface ChipInternals {
  m: unknown
  dockedChrome: boolean | null
  chipKey: string
  chipLive: { kind: 'hole' | 'terminal'; ref: string } | null
  pointerInside: boolean
  pointerDirty: boolean
  lastPointerType: string
  labelPinnedUntil: number
  refreshChipAfterLayout(m: unknown): void
}

/** A headless scene whose chip shows `text` for `live` (no part records: every terminal is gone). */
function sceneWithChip(live: ChipInternals['chipLive'], key: string, docked = true) {
  const scene = new BreadboardScene()
  const s = scene as unknown as ChipInternals
  const chip = makeScreenChip()
  const texts: string[] = []
  chip.setText = (x: string) => void texts.push(x)
  const ring = makeHoverRing()
  const m = {
    container: { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 },
    camera: new THREE.PerspectiveCamera(45, 1.6, 0.1, 1000),
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) } },
    holeLabel: makeHoleLabel(),
    screenChip: chip,
    hoverRing: ring,
    clock: new THREE.Clock(),
  }
  s.m = m
  s.dockedChrome = docked
  chip.show()
  ring.show(0)
  s.chipKey = key
  s.chipLive = live
  return { scene, s, m, chip, ring, texts }
}

describe('CHIP-AFTER-LAYOUT: the hover chip follows the layout', () => {
  it('syncLayout re-checks the chip once per layout change (never per frame)', () => {
    const src = read('src/three/scene.ts')
    const sync = src.slice(src.indexOf('  private syncLayout(): void {'), src.indexOf('  /** Swap the board mesh + hole index'))
    expect(sync).toContain('this.refreshChipAfterLayout(m)')
    const tick = src.slice(src.indexOf('      tickHolograms(t)'), src.indexOf('      tickHolograms(t)') + 3000)
    expect(tick).not.toContain('refreshChipAfterLayout')
  })

  it('a mouse resting on the canvas: the next hover pass re-aims (「PS1 正端」 does not outlive PS1)', () => {
    const { s, m } = sceneWithChip({ kind: 'terminal', ref: 'PS1:+' }, 't:PS1:+')
    s.pointerInside = true
    s.lastPointerType = 'mouse'
    s.pointerDirty = false
    s.refreshChipAfterLayout(m)
    expect(s.chipKey).toBe('!stale')
    expect(s.pointerDirty).toBe(true)
  })

  it('a finger’s chip on a terminal that is gone: the chip and its ring go with it', () => {
    const { s, m, chip, ring } = sceneWithChip({ kind: 'terminal', ref: 'PS1:+' }, '!pin')
    s.pointerInside = false
    s.lastPointerType = 'touch'
    s.refreshChipAfterLayout(m)
    expect(chip.visible).toBe(false)
    ring.tick(10) // the quick fade completes
    expect(ring.object.visible).toBe(false)
    expect(s.chipKey).toBe('')
    expect(s.chipLive).toBeNull()
  })

  it('a finger’s chip on a hole: its text is re-asked in place (the strip may hold something else now)', () => {
    const { scene, s, m, chip, texts } = sceneWithChip({ kind: 'hole', ref: 'a10' }, '!pin')
    s.pointerInside = false
    s.lastPointerType = 'touch'
    scene.setCallbacks({ holeLabelText: (ref: string) => (ref === 'a10' ? 'a10（R1 第 1 腳這一排）' : null) })
    s.refreshChipAfterLayout(m)
    expect(texts).toEqual(['a10（R1 第 1 腳這一排）'])
    expect(chip.visible).toBe(true)
  })

  it('the classic chrome keeps its chip until the pointer moves (as before); no chip, nothing to do', () => {
    const a = sceneWithChip({ kind: 'terminal', ref: 'PS1:+' }, 't:PS1:+', false)
    a.s.pointerInside = true
    a.s.lastPointerType = 'mouse'
    a.s.pointerDirty = false
    a.s.refreshChipAfterLayout(a.m)
    expect(a.s.chipKey).toBe('t:PS1:+')
    expect(a.s.pointerDirty).toBe(false)
    expect(a.chip.visible).toBe(true)
    const b = sceneWithChip(null, '')
    b.s.pointerInside = true
    b.s.lastPointerType = 'mouse'
    b.s.pointerDirty = false
    b.s.refreshChipAfterLayout(b.m)
    expect(b.s.pointerDirty).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FG-RAIL (3) — the inspector's 即時讀數 and pin rows
// ---------------------------------------------------------------------------

describe('FG-RAIL (3): a waveform source in the inspector', () => {
  let out = ''
  beforeEach(() => {
    out = resolveNet('a10', RC) ?? ''
    useStore.setState({
      layout: RC,
      selection: ['FG1'],
      running: true,
      simTime: 2,
      telemetry: telemetry(2, { [out]: 4.99, [resolveNet('top-1', RC)!]: 0 }, { FG1: { current: 5.68e-6, power: 2.8e-5 }, R1: { current: 2.1e-4, power: 4.4e-4 } } as never),
    })
  })
  const body = () => renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))

  it('電流與功率: 「交流（瞬時值會跳動）——請用示波器看」, never one instant of them', () => {
    const text = textOf(body())
    expect(text).toContain('即時讀數')
    expect(text).toContain('電流與功率')
    expect(text).toContain('交流（瞬時值會跳動）——請用示波器看')
    expect(text).not.toContain('5.68 µA')
    expect(text).not.toContain('28.0 µW')
  })

  it('the scope is one tap away: 「在示波器中檢視（CH1）」 when a probe measures the output, else 「放示波器探棒（CH1）」', () => {
    expect(textOf(body())).toContain('在示波器中檢視（CH1）')
    useStore.setState({ layout: { ...RC, components: RC.components.filter((c) => c.id !== 'PRB1') } })
    const text = textOf(body())
    expect(text).toContain('放示波器探棒（CH1）')
    expect(text).not.toContain('在示波器中檢視')
  })

  it('the output pin row: the setting, wrapping only between its parts, titled as a setting', () => {
    const html = body()
    expect(html).toContain('<span style="white-space:nowrap">方波 100 Hz ·</span> <span style="white-space:nowrap">0–5.00 V</span>')
    expect(html).toContain('title="方波 100 Hz · 0–5.00 V（函數產生器設定） — 函數產生器的設定值，不是量測結果；實際波形請看示波器"')
    expect(html).not.toContain('方波 100 Hz · 0–5.00 V（函數產生器設定） — 瞬時值，每秒更新 4 次')
    // the ground row is a plain DC value: the 4 Hz title stays
    expect(html).toContain('title="0 V — 瞬時值，每秒更新 4 次"')
  })

  it('any other part keeps its readings (R1: 電流 210 µA), and a plain DC row keeps the 4 Hz title', () => {
    useStore.setState({ selection: ['R1'] })
    const html = body()
    const text = textOf(html)
    expect(text).toContain('即時讀數')
    expect(text).not.toContain('交流（瞬時值會跳動）')
    expect(text).toMatch(/電流210(\.0)? µA/)
    // R1 第 1 腳 sits on the generator's strip: its row is titled as a setting too
    expect(html).toContain('title="方波 100 Hz · 0–5.00 V（函數產生器設定） — 函數產生器的設定值，不是量測結果；實際波形請看示波器"')
  })

  it('the classic chrome keeps its pre-wave numbers (English without the workspace)', () => {
    __setLangForTests('en')
    const text = textOf(body())
    expect(text).toContain('5.68 µA')
    expect(text).not.toContain('use the scope')
    expect(text).not.toContain('Show in the oscilloscope')
  })

  it('PartInfo: an MCU pin on the generator’s output is a signal row with the setting’s title', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
        { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 100, amplitude: 1.5, offset: 1.5 } },
      ],
      wires: [{ id: 'W1', from: 'FG1:out', to: 'a20', color: 'yellow' }],
    }
    const pa5 = resolveNet('c20', layout)!
    useStore.setState({ layout, selection: ['U1'], telemetry: telemetry(2, { [pa5]: 3 }, { U1: { mcu: { state: 'running', pc: 0, hclkHz: 72e6, cycles: 1, pinModes: { PA5: 'an' } } } } as never) })
    const comp = layout.components[0]
    const html = renderLive(createElement(PinoutGroup, { comp, entry: getEntry('stm32_bluepill')!, tele: useStore.getState().telemetry!.components.U1, variant: 'in-use' }))
    const row = /<span class="emb-pin-v lg-tabular is-signal" title="([^"]*)">([^<]*)</.exec(html)
    expect(row, html.slice(0, 400)).not.toBeNull()
    expect(row![2]).toBe('方波 100 Hz · 0–3.00 V')
    expect(row![1]).toContain('函數產生器的設定值，不是量測結果；實際波形請看示波器')
  })
})

// ---------------------------------------------------------------------------
// IS-F11 — the 讀數 card of a meter with an unwired probe
// ---------------------------------------------------------------------------

describe('IS-F11: the 讀數 card says what is missing and the next step', () => {
  const body = () => textOf(renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} })))

  it('IN unwired, paused: 「—」 + 「探棒未接（DMM1 IN 端還沒接線）——把 COM 接到 GND、IN 接到要量的點」', () => {
    useStore.setState({ layout: DMM_OPEN, selection: ['DMM1'], running: false, simTime: 1.9, telemetry: telemetry(1.9, {}, { DMM1: { text: ['0.000', 'DC V'] } } as never) })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    const text = textOf(html)
    expect(text).toContain('讀數—探棒未接（DMM1 IN 端還沒接線）——把 COM 接到 GND、IN 接到要量的點')
    expect(text).not.toContain('等待第一筆讀數')
    expect(text).not.toContain('按上方「▶ 執行模擬」後顯示讀數')
    expect(html).toContain('insp-readout-sub is-open')
  })

  it('both probes unwired, before any run: the same kind of sentence (nothing to wait for)', () => {
    useStore.setState({ layout: { ...DMM_OPEN, wires: DMM_OPEN.wires.filter((w) => w.id !== 'W6') }, selection: ['DMM1'], running: false, telemetry: null })
    expect(body()).toContain('探棒未接（DMM1 兩支探棒都還沒接線）——把 COM 接到 GND、IN 接到要量的點')
  })

  it('wired, before a run: the card still says how to get a reading; while running, the value and what it is', () => {
    useStore.setState({ layout: DMM_WIRED, selection: ['DMM1'], running: false, telemetry: null })
    expect(body()).toContain('讀數—按上方「▶ 執行模擬」後顯示讀數')
    useStore.setState({ running: true, simTime: 2, telemetry: telemetry(2, {}, { DMM1: { text: ['5.000 V', 'DC V'] } } as never) })
    expect(body()).toContain('讀數5.000 V直流電壓（IN − COM）')
  })

  it('the card subscribes to the layout (wiring a probe while paused updates it)', () => {
    const src = read('src/ui/sheets/PropertiesSheet.tsx')
    const group = src.slice(src.indexOf('function ReadoutGroup('), src.indexOf('function meterNumber('))
    expect(group).toContain('useStore((s) => s.layout)')
    expect(group).toContain('meterReading(comp, entry, tele, layout)')
  })
})

// ---------------------------------------------------------------------------
// LOCKUP-CAUSE — the capsule line runs its action
// ---------------------------------------------------------------------------

describe('LOCKUP-CAUSE: tapping 「U1 故障（鎖死）——查看原因」 opens the 執行狀態 card', () => {
  it('the line and its action (new chrome); the classic chrome keeps its line and its tap', () => {
    const line = lockupCapsuleLine('U1')
    expect(line.text).toBe('U1 故障（鎖死）——查看原因')
    expect(typeof line.opts.action).toBe('function')
    useStore.setState({ layout: { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }, selection: [] })
    line.opts.action!()
    expect(useStore.getState().selection).toEqual(['U1'])
    expect(useInspectorFocus.getState().request).toMatchObject({ componentId: 'U1', tab: 'overview' })
    __setLangForTests('en')
    const classic = lockupCapsuleLine('U1')
    expect(classic.text).toBe('U1: core LOCKUP — see the Simulation log')
    expect(classic.opts.action).toBeUndefined()
  })

  it('a tap runs the line’s action instead of the run control; without one, the run control', () => {
    const calls: string[] = []
    capsuleTap(() => calls.push('open'), () => calls.push('collapse'), () => calls.push('run'))
    expect(calls).toEqual(['collapse', 'open'])
    calls.length = 0
    capsuleTap(null, () => calls.push('collapse'), () => calls.push('run'))
    expect(calls).toEqual(['run'])
    const action = () => {}
    expect(detailActionOf({ action }, false)).toBe(action)
    expect(detailActionOf({ action }, true)).toBeNull()
    expect(detailActionOf({}, false)).toBeNull()
  })

  it('the capsule names the action while the line shows, and the line stays up long enough to reach', () => {
    expect(capsuleActionTitle('U1 故障（鎖死）——查看原因')).toBe('點一下：U1 故障（鎖死）——查看原因 · 長按重置')
    expect(englishLeft(t('{a} and {b}|quantities', { a: '電流', b: '功率' }))).toEqual([])
    expect(ACTION_EXPAND_MS).toBeGreaterThanOrEqual(5000)
    const src = read('src/ui/chrome/StatusBar.tsx')
    expect(src).toContain('aria-label={action && detail ? detail : text.aria}')
    expect(src).toContain('onTap={() => capsuleTap(action, collapse, () => void toggleRunWithFeedback())}')
  })
})

// ---------------------------------------------------------------------------
// UART port request
// ---------------------------------------------------------------------------

describe('「開啟 UART 終端機」 opens that USART', () => {
  it('a USART2 row asks the terminal for U1 · USART2 and brings the terminal up', () => {
    const src = read('src/ui/embedded/UartTerminal.tsx')
    expect(src).toContain('export function requestTerminalPort(componentId: string, port: string): void')
    const action = setupAction('U1', { block: 'USART2', kind: 'uart', signals: [] })
    expect(action?.label).toBe('開啟 UART 終端機')
    const seq = useInstrumentRequest.getState().request?.seq ?? 0
    action!.run()
    // (no workspace here: the instrument sheet is requested on the UART tab)
    expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'uart', seq: seq + 1 })
    expect(read('src/ui/embedded/McuPanel.tsx')).toMatch(/requestTerminalPort\(componentId, row\.block\)\s*\n\s*showInstrument\('uart'\)/)
  })
})

// ---------------------------------------------------------------------------
// wording: IDD, H9 verbs
// ---------------------------------------------------------------------------

describe('plain words', () => {
  it('the Blue Pill limit names the chip’s own consumption without the datasheet symbol', () => {
    const limits = partSupport(CATALOG.stm32_bluepill).limits ?? []
    const line = limits.find((x) => x.includes('20–36 mA'))
    expect(line).toBe('晶片本身的耗電（72 MHz 時約 20–36 mA）未模擬：電源供應器讀到的電流不含晶片本身')
    expect(limits.join('')).not.toMatch(/IDD/)
  })

  it('the verbs of the term table: 在邏輯分析儀中檢視, 執行模擬', () => {
    expect(t('Show the latest {what} on the logic analyzer', { what: 'UART 幀' })).toBe('在邏輯分析儀中檢視最近一筆 UART 幀')
    expect(t('No edges yet — press Run')).toBe('尚無邊緣——請按「▶ 執行模擬」')
    expect(t('no samples — place a scope probe and press Run')).toBe('沒有取樣——請放置示波器探棒並按「▶ 執行模擬」')
  })
})
