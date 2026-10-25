/**
 * UX wave — shell workstream (WS1, docs/ux/UX_REVIEW.md §6.3 SH-1…SH-8):
 *   SH-1  run capsule texts per phase (runCapsuleText), the speed factor
 *   SH-2  status pill priority (statusPillModel / pillProblem)
 *   SH-5  mode hints (hintForMode) — new chrome vs the classic wording,
 *         the refusal / repeat-placement toasts
 *   SH-7  the shortcuts list, the run-control helpers (targetMcuId)
 *   SH-8  wire colour by convention (conventionWireColor)
 *   kit   toast keycaps (toastTextNodes)
 * Pure functions and the real stores — no React DOM.
 */
import { isValidElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import type { Problem } from '../src/ui/embedded/problems'
import { formatSpeedFactor, runCapsuleText } from '../src/ui/chrome/StatusBar'
import { pillProblem, statusPillModel } from '../src/ui/chrome/StatusPill'
import { anchorPinName, footprintRow, hintForMode, placedAgainHint, placementRefusedHint } from '../src/ui/chrome/hints'
import { mcuIdsInLayout, targetMcuId } from '../src/ui/chrome/run-control'
import {
  conventionWireColor,
  endpointPolarity,
  markWireColorPicked,
  pinPolarity,
  resetWireColorPick,
  wireColorPicked,
} from '../src/ui/chrome/wire-convention'
import { SHORTCUT_GROUPS } from '../src/ui/chrome/ShortcutsSheet'
import { toastTextNodes } from '../src/ui/kit/Toast'

afterEach(() => __setLangForTests('zh-TW'))

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

// ---------------------------------------------------------------- SH-1
describe('SH-1 run capsule texts', () => {
  it('idle reads as the verb with no clock; aria keeps the pre-wave names', () => {
    __setLangForTests('zh-TW')
    const idle = runCapsuleText('idle', { time: 0 })
    expect(idle.word).toBe('執行模擬')
    expect(idle.time).toBeNull()
    expect(idle.aria).toBe('執行模擬') // scripts/acceptance-e2e.mjs addresses the capsule by it
    expect(idle.title).toBe('執行模擬（空白鍵）· 長按重置')
    const paused = runCapsuleText('paused', { time: 3.111 })
    expect([paused.word, paused.time, paused.aria]).toEqual(['已暫停', '3.11 s', '執行模擬'])
    const running = runCapsuleText('running', { time: 3.111 })
    expect([running.word, running.time, running.aria, running.title]).toEqual([
      '執行中',
      '3.11 s',
      '暫停模擬',
      '暫停模擬（空白鍵）· 長按重置',
    ])
    expect(running.extra).toBeNull()
  })

  it('halted offers 繼續執行 (one verb with the pill — release QA SH-F3) with the board in the tooltip; fault names the board, never green', () => {
    __setLangForTests('zh-TW')
    const halted = runCapsuleText('halted', { time: 9, mcuId: 'U1' })
    expect([halted.word, halted.extra, halted.time]).toEqual(['核心已停住', '繼續執行', null])
    expect(halted.title).toBe('繼續執行 U1 核心（空白鍵／F5）')
    const fault = runCapsuleText('fault', { time: 5.2, mcuId: 'U1' })
    expect([fault.word, fault.time]).toEqual(['U1 故障', '5.20 s'])
    expect(fault.title).toBe('U1 鎖死——原因見狀態提示列')
  })

  it('a slow simulation adds the achieved factor with the reason in the tooltip (SH-8)', () => {
    __setLangForTests('zh-TW')
    const slow = runCapsuleText('running', { time: 1, slow: 0.3, speed: 1 })
    expect(slow.extra).toBe('0.3 倍速')
    expect(slow.title).toContain('模擬比實際時間慢')
    const fast = runCapsuleText('running', { time: 1, slow: 2.1, speed: 5 })
    expect(fast.title).toContain('模擬跟不上設定的 5 倍速')
    // SH-14: the capsule's factor is H3 fmtSpeedFactor — one speed format
    // everywhere, never 「0 倍速」
    expect(formatSpeedFactor(0.05)).toBe('0.05 倍速')
    expect(formatSpeedFactor(0.34)).toBe('0.3 倍速')
    expect(formatSpeedFactor(0.003)).toBe('< 0.01 倍速')
    expect(formatSpeedFactor(-1)).toBe('—')
    expect(runCapsuleText('running', { time: 1, slow: '0.07 倍速', speed: 1 }).extra).toBe('0.07 倍速')
  })

  it('English sources stay readable English (the new chrome with the workspace)', () => {
    __setLangForTests('en')
    expect(runCapsuleText('idle', { time: 0 }).title).toBe('Run simulation (Space) · long-press to reset')
    expect(runCapsuleText('halted', { time: 0, mcuId: 'U2' }).aria).toBe('Resume the U2 core')
  })
})

// ---------------------------------------------------------------- SH-2
describe('SH-2 status pill', () => {
  const base = { phase: 'idle' as const, haltedId: null, boardEmpty: false }

  it('errors first, with "· 另 n 個" and the problem’s own fix', () => {
    __setLangForTests('zh-TW')
    let ran = 0
    const ps = [
      problem({ id: 'e', level: 'error', title: '電路中沒有電源' }),
      problem({ id: 'w', level: 'warning', source: 'mcu', title: 'U1 還沒有韌體', action: { label: '載入韌體…', run: () => ran++ } }),
      problem({ id: 'i', level: 'info', title: 'note' }),
    ]
    const m = statusPillModel({ ...base, problems: ps, counts: counts(ps) })!
    expect(m.tone).toBe('error')
    expect(m.text).toBe('電路中沒有電源')
    expect(m.more).toBe(1) // info never counts
    expect(m.action).toBeNull() // nothing to point at, no own fix
    expect(m.opensProblems).toBe(true)
  })

  it('a board-level MCU warning goes before the circuit’s risks (no firmware explains everything)', () => {
    __setLangForTests('zh-TW')
    let ran = 0
    const ps = [
      problem({ id: 'erc', level: 'warning', title: 'R1 第 1 腳沒接', componentIds: ['R1'], holes: ['a36'] }),
      problem({ id: 'sim', level: 'warning', source: 'sim', title: 'U1：未載入韌體' }),
      problem({ id: 'fw', level: 'warning', source: 'mcu', title: 'U1 還沒有韌體', componentIds: ['U1'], action: { label: '載入韌體…', run: () => ran++ } }),
    ]
    expect(pillProblem(ps)?.id).toBe('fw')
    const m = statusPillModel({ ...base, phase: 'running', problems: ps, counts: counts(ps) })!
    expect([m.tone, m.text, m.more, m.action?.label]).toEqual(['warning', 'U1 還沒有韌體', 2, '載入韌體…'])
    m.action!.run()
    expect(ran).toBe(1)
  })

  it('an ERC finding without its own fix points at the board instead', () => {
    __setLangForTests('zh-TW')
    const ps = [problem({ id: 'w', level: 'warning', title: 'LED1 陰極沒接', componentIds: ['LED1'], holes: ['a38'] })]
    expect(statusPillModel({ ...base, problems: ps, counts: counts(ps) })!.action?.label).toBe('在電路板上標示')
  })

  it('a halt the store has not reported yet, then the "ready" line, then nothing', () => {
    __setLangForTests('zh-TW')
    const none: Problem[] = []
    const c = counts(none)
    const halted = statusPillModel({ ...base, phase: 'halted', haltedId: 'U1', problems: none, counts: c })!
    expect([halted.tone, halted.text, halted.action?.label]).toEqual(['warning', 'U1 核心已停住（偵錯器）', '繼續執行'])
    const ready = statusPillModel({ ...base, problems: none, counts: c })!
    expect([ready.tone, ready.text, ready.action?.label, ready.opensProblems]).toEqual([
      'neutral',
      // the button carries the verb once (release QA SH-F10)
      '電路已就緒（空白鍵）',
      '執行模擬',
      false,
    ])
    // touch screens name no key; a lesson coach owns "the next step" (no ready line)
    expect(statusPillModel({ ...base, touch: true, problems: none, counts: c })!.text).toBe('電路已就緒')
    expect(statusPillModel({ ...base, guided: true, problems: none, counts: c })).toBeNull()
    const guidedProblem = [problem({ id: 'fw', level: 'warning', source: 'mcu', title: 'U1 還沒有韌體' })]
    expect(statusPillModel({ ...base, guided: true, problems: guidedProblem, counts: counts(guidedProblem) })?.text).toBe(
      'U1 還沒有韌體',
    )
    expect(statusPillModel({ ...base, boardEmpty: true, problems: none, counts: c })).toBeNull()
    expect(statusPillModel({ ...base, phase: 'running', problems: none, counts: c })).toBeNull()
    expect(statusPillModel({ ...base, phase: 'paused', problems: none, counts: c })).toBeNull()
    // info alone never shows
    const info = [problem({ level: 'info' })]
    expect(statusPillModel({ ...base, phase: 'running', problems: info, counts: counts(info) })).toBeNull()
  })
})

// ---------------------------------------------------------------- SH-5
describe('SH-5 mode hints', () => {
  it('new chrome: every hint says how to get out, leads read as people say them', () => {
    __setLangForTests('zh-TW')
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' })).toBe('導線模式：依序點兩個孔位或端子 · Esc 結束')
    // SH-12: the first end by its name (H2 endpointName), never the raw ref 「PS1:+」
    expect(hintForMode({ kind: 'wire', from: 'PS1:+', color: 'red' })).toBe('從 PS1 正端拉線：點第二個孔位 · Esc 取消這條') // no space between two Chinese words (SH-F11)
    expect(hintForMode({ kind: 'place', type: 'led', pickedHoles: [] })).toMatch(/依序點 2 個孔位（陽極（長腳）→ 陰極（短腳））· Esc 取消$/)
    expect(hintForMode({ kind: 'place', type: 'resistor', pickedHoles: [] })).toMatch(/依序點 2 個孔位（第 1 腳 → 第 2 腳）· Esc 取消$/)
    expect(hintForMode({ kind: 'place', type: 'led', pickedHoles: ['a10'] })).toBe('第 2/2 腳：點「陰極（短腳）」的孔位 · Esc 取消')
    const bp = hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] })!
    expect(bp).toContain('點 h 列的孔位放下（PB12 對齊那個孔）· R 旋轉 · Esc 取消')
    expect(bp).toMatch(/開發板：/) // no line break inside 開發板 is the toast CSS's job (keep-all)
    const all = [
      hintForMode({ kind: 'wire', from: null, color: 'red' }),
      hintForMode({ kind: 'wire', from: 'a1', color: 'red' }),
      hintForMode({ kind: 'place', type: 'resistor', pickedHoles: [] }),
      hintForMode({ kind: 'place', type: 'resistor', pickedHoles: ['a1'] }),
      hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }),
      hintForMode({ kind: 'place', type: 'ne555', pickedHoles: [] }),
    ]
    for (const h of all) expect(h, String(h)).toMatch(/Esc (結束|取消)/)
  })

  it('touch: the way out is on screen — no Esc / R key names on a phone', () => {
    __setLangForTests('zh-TW')
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' }, true)).toBe('導線模式：依序點兩個孔位或端子 · 點「完成」結束')
    expect(hintForMode({ kind: 'wire', from: 'a1', color: 'red' }, true)).toBe('從 a1 拉線：點第二個孔位 · 點空白處取消這條')
    expect(hintForMode({ kind: 'place', type: 'resistor', pickedHoles: [] }, true)).toBe(
      '電阻：依序點 2 個孔位（第 1 腳 → 第 2 腳）· 再點一次卡片可取消',
    )
    expect(hintForMode({ kind: 'place', type: 'led', pickedHoles: ['a10'] }, true)).toBe('第 2/2 腳：點「陰極（短腳）」的孔位 · 再點一次卡片可取消')
    expect(hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }, true)).toMatch(
      /點 h 列的孔位放下（PB12 對齊那個孔）· 再點一次卡片可取消$/,
    )
    const all = [
      hintForMode({ kind: 'place', type: 'ne555', pickedHoles: [] }, true),
      hintForMode({ kind: 'place', type: 'scope_probe', pickedHoles: [] }, true),
      hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }, true),
      placedAgainHint('R2', true),
    ]
    for (const h of all) expect(h, String(h)).not.toMatch(/Esc|R 旋轉/)
    expect(placedAgainHint('R2', true)).toBe('已放置 R2——繼續點孔位可再放一顆 · 再點一次卡片即可結束')
  })

  it('anchor helpers: the Blue Pill drops on row h with PB12 on the clicked hole', () => {
    const bp = getEntry('stm32_bluepill')!
    expect(footprintRow(bp)).toBe('h')
    expect(anchorPinName(bp)).toBe('PB12')
  })

  it('refusal and repeat-placement toasts', () => {
    __setLangForTests('zh-TW')
    const bp = getEntry('stm32_bluepill')!
    expect(placementRefusedHint(bp, '要跨在中央溝槽上')).toMatch(/^這裡放不下 .+：要跨在中央溝槽上$/)
    expect(placementRefusedHint(bp, null)).toMatch(/需要跨在中央溝槽上，請點 h 列的孔位$/)
    expect(placedAgainHint('R2')).toBe('已放置 R2——繼續點孔位可再放一顆 · Esc 結束')
  })

  it('the classic chrome (English, no workspace) keeps the original wording', () => {
    __setLangForTests('en')
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' })).toBe('Wire mode — tap two holes or terminals to connect them')
    expect(hintForMode({ kind: 'place', type: 'stm32_bluepill', pickedHoles: [] })).toMatch(/tap the PB12 anchor hole \(row h\)$/)
    expect(hintForMode({ kind: 'place', type: 'resistor', pickedHoles: [] })).toMatch(/pin order p1 → p2$/)
  })
})

// ---------------------------------------------------------------- SH-8 wire colour
function layoutOf(partial: Partial<CircuitLayout>): CircuitLayout {
  return { version: 1, name: 't', components: [], wires: [], ...partial } as CircuitLayout
}

describe('SH-8 wire colour by convention', () => {
  it('pin names', () => {
    expect(['GND', 'GND2', 'gnd', 'VSS', 'COM', '-', 'G'].map(pinPolarity)).toEqual(Array(7).fill('ground'))
    expect(['VCC', '5V', '3V3_1', '+', 'VIN', 'VOUT'].map(pinPolarity)).toEqual(Array(6).fill('supply'))
    expect(['anode', 'p1', 'OUT', 'PA5', 'SDA'].map(pinPolarity)).toEqual(Array(5).fill(null))
  })

  it('rails, terminals and strips joined to them', () => {
    const l = layoutOf({
      components: [
        { id: 'PS1', type: 'power_supply' } as never,
        { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] } as never,
      ],
      wires: [{ id: 'W1', from: 'e14', to: 'top-14', color: 'black' } as never],
    })
    expect(endpointPolarity(l, 'top-3')).toBe('ground')
    expect(endpointPolarity(l, 'bot+7')).toBe('supply')
    expect(endpointPolarity(l, 'PS1:-')).toBe('ground')
    expect(endpointPolarity(l, 'PS1:+')).toBe('supply')
    expect(endpointPolarity(l, 'c14')).toBe('ground') // same strip as the wire to the − rail
    expect(endpointPolarity(l, 'c10')).toBeNull()
    expect(conventionWireColor(l, ['c10', 'top-20'])).toBe('black') // LED cathode → − rail
    expect(conventionWireColor(l, ['PS1:+', 'top+1'])).toBe('red')
    expect(conventionWireColor(l, ['c10', 'j30'])).toBe('yellow')
    expect(conventionWireColor(l, ['c10', null])).toBe('yellow')
  })

  it('a board’s GND pin marks its strip', () => {
    const l = layoutOf({ components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' } as never] })
    const entry = getEntry('stm32_bluepill')!
    // find a hole on the same strip as a GND pin of the board
    const gndIdx = entry.pins.findIndex((p) => /^GND/.test(p))
    expect(gndIdx).toBeGreaterThanOrEqual(0)
    const colors = new Set<string>()
    for (let col = 1; col <= 40; col++) for (const row of ['a', 'j']) colors.add(conventionWireColor(l, [`${row}${col}`]))
    expect(colors.has('black')).toBe(true)
    expect(colors.has('red')).toBe(true)
  })

  it('an explicit swatch choice is sticky until wire mode is armed again', () => {
    resetWireColorPick()
    expect(wireColorPicked()).toBe(false)
    markWireColorPicked()
    expect(wireColorPicked()).toBe(true)
    resetWireColorPick()
    expect(wireColorPicked()).toBe(false)
  })
})

// ---------------------------------------------------------------- SH-7
describe('SH-7 keyboard', () => {
  it('the shortcuts list covers the spec’s keys', () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.rows.flatMap((r) => r.combos.map((c) => c.join('+'))))
    for (const k of ['Space', 'F5', 'F10', 'Shift+F5', 'F', 'R', 'Delete', 'Arrows', 'Esc', 'Mod+Z', 'Mod+Y', 'Mod+S', '?']) {
      expect(keys, k).toContain(k)
    }
  })

  it('targetMcuId: the selected board, else the only one, else none', () => {
    const st = useStore.getState()
    st.loadLayout(
      layoutOf({
        components: [
          { id: 'U1', type: 'stm32_bluepill', at: 'h10' } as never,
          { id: 'R1', type: 'resistor', holes: ['a50', 'a54'] } as never,
        ],
      }),
    )
    expect(mcuIdsInLayout()).toEqual(['U1'])
    useStore.getState().select(null)
    expect(targetMcuId()).toBe('U1')
    useStore.getState().select('R1')
    expect(targetMcuId()).toBe('U1')
    useStore.getState().loadLayout(layoutOf({ components: [] }))
    expect(targetMcuId()).toBeNull()
    expect(useLab.getState()).toBeTruthy()
  })
})

// ---------------------------------------------------------------- kit toast keycaps
describe('toast keycaps', () => {
  it('key names become <kbd>, part and pin names never do', () => {
    const nodes = toastTextNodes('第 2/2 腳：點「R1」的孔位 · R 旋轉 · Esc 取消') as unknown[]
    expect(Array.isArray(nodes)).toBe(true)
    const kbds = (nodes as ReactElement[]).filter((n) => isValidElement(n)).map((n) => (n.props as { children: string }).children)
    expect(kbds).toEqual(['R', 'Esc'])
    expect(toastTextNodes('已放置 R1')).toBe('已放置 R1')
    expect(toastTextNodes('Rotate R2')).toBe('Rotate R2')
    const f = toastTextNodes('已停住 U1 核心——F10 單步、F5 繼續') as unknown[]
    expect((f as ReactElement[]).filter((n) => isValidElement(n)).length).toBe(2)
  })
})
