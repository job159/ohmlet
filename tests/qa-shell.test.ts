/**
 * Release QA — the shell's fixes (SH-F1 … SH-F11), pure functions and the
 * real stores (no DOM). The browser replay of the same paths (wire mode,
 * onboarding focus, capsule, 更多 sheet, phone layout) is the shell report's
 * scratch scripts qa-final/fix-shell/v1-wire.mjs, v2-desktop.mjs, v3-phone.mjs,
 * v5-examples.mjs (更多 → 範例 ›) and v6-extra.mjs (the orange capsule, a
 * phone long-press 刪除 + ↶).
 *
 *  SH-F1  a wire start that can never be completed is never stored: a part
 *         pin's hole moves the start to the nearest free hole of its strip /
 *         rail, anything else is refused at once with what to do instead;
 *         a refusal about the started end itself drops that start.
 *  SH-F3  the capsule names the blocker when every board is stopped while
 *         running; 「繼續執行」 is the one resume verb.
 *  SH-F4  清空麵包板 and 對準電路 on an empty board frame the whole breadboard.
 *  SH-F6  a refused leads / probe hole says why (H2 wording).
 *  SH-F7  the examples left the 更多 sheet: 「範例 ›」 / 「開啟範例」 open the one
 *         library (the workspace's 範例 tab, the 元件 sheet's 範例 segment).
 *  SH-F9  undo / redo / delete name what changed.
 *  SH-F10 the speeds read 「n 倍速」; the pill's button is 「執行模擬」.
 *  SH-F11 no space between two Chinese words in the hints and toasts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { tidyCjkSpaces } from '../src/i18n/tidy'
import { tidyCjkSpaces as tidyFromRefs } from '../src/lessons/engine/refs'
import type { CircuitLayout } from '../src/model/types'
import type { InteractionMode } from '../src/state/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import {
  deletedText,
  describeLayoutChange,
  endpointRefusal,
  historyStepText,
  nameList,
  placementSpotReason,
  redoWithFeedback,
  refusalConcernsFrom,
  removeSelectedWithFeedback,
  sameNetHoles,
  undoWithFeedback,
  wireStartCheck,
} from '../src/ui/chrome/edit-feedback'
import {
  hintForMode,
  placedAgainHint,
  placementRefusedHint,
  placementSpotRefusedHint,
  wireConnectedHint,
  wireRefusedHint,
  wireStartHint,
} from '../src/ui/chrome/hints'
import { runCapsuleText, runningBlockerOf } from '../src/ui/chrome/StatusBar'
import { statusPillModel } from '../src/ui/chrome/StatusPill'
import { STATE_TONE, stateColor } from '../src/ui/chrome/run-control'
import { speedOptions, speedRowTitle } from '../src/ui/sheets/MoreSheet'
import type { Problem } from '../src/ui/embedded/problems'
import { getEntry } from '../src/model/catalog'
import { showPartsSheetSegment, takePartsSheetSegment } from '../src/ui/sheets/PartsSheet'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'

const st = () => useStore.getState()

function setDocument(layout: CircuitLayout): void {
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

/** The designer's s21 bench: a Blue Pill at h10 (pins in rows c / h, the body over b–i), R1, LED1, PS1, six wires. */
const BENCH: CircuitLayout = {
  version: 1,
  components: [
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['b33', 'b37'] },
    { id: 'LED1', type: 'led', holes: ['e37', 'f37'] },
    { id: 'PS1', type: 'power_supply' },
  ],
  wires: [
    { id: 'W1', from: 'a20', to: 'a33', color: 'yellow' },
    { id: 'W2', from: 'j28', to: 'bot-22', color: 'black' },
    { id: 'W3', from: 'PS1:+', to: 'bot+0', color: 'red' },
    { id: 'W4', from: 'PS1:-', to: 'bot-0', color: 'black' },
    { id: 'W5', from: 'j27', to: 'bot+21', color: 'red' },
    { id: 'W6', from: 'j37', to: 'bot-29', color: 'black' },
  ],
}

/** A strip that is full (R2 in c40, wire ends in a / b / d / e 40) and a resistor lead on the top + rail. */
const FULL: CircuitLayout = {
  version: 1,
  components: [
    { id: 'R2', type: 'resistor', holes: ['c40', 'c44'] },
    { id: 'R3', type: 'resistor', holes: ['top+5', 'a50'] },
  ],
  wires: [
    { id: 'W1', from: 'a40', to: 'a55' },
    { id: 'W2', from: 'b40', to: 'b55' },
    { id: 'W3', from: 'd40', to: 'd55' },
    { id: 'W4', from: 'e40', to: 'e55' },
  ],
}

const CJK_SPACE = /[一-鿿）] [一-鿿（]/

afterEach(() => {
  __setLangForTests('zh-TW')
  for (const t of getToasts()) dismissToast(t.id)
})

describe('SH-F1 a wire start that can never be completed is never stored', () => {
  it('a part pin: the start moves to the nearest free hole of its strip, and the toast says so', () => {
    __setLangForTests('zh-TW')
    const start = wireStartCheck(BENCH, 'c21')
    // b21, d21, e21 sit under the board's body, so a21 is the strip's free hole
    expect(start).toEqual({ kind: 'redirect', from: 'a21', hole: 'c21', pin: 'U1 PA4', rail: false })
    expect(wireStartHint(start, BENCH)).toBe('c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線')
    // R1's first lead in b33: a33 holds W1's end, c33 is free (a tie goes outward, then the next free)
    const r1 = wireStartCheck(BENCH, 'b33')
    expect(r1).toMatchObject({ kind: 'redirect', from: 'c33', pin: 'R1 第 1 腳' })
    expect(wireStartHint(r1, BENCH)).toBe('b33 被 R1 第 1 腳佔用，已改從同一排的 c33 拉線')
  })

  it('a pin on a rail: the nearest free hole of the same rail', () => {
    __setLangForTests('zh-TW')
    const start = wireStartCheck(FULL, 'top+5')
    expect(start).toEqual({ kind: 'redirect', from: 'top+4', hole: 'top+5', pin: 'R3 第 1 腳', rail: true })
    expect(wireStartHint(start, FULL)).toBe('top+5 被 R3 第 1 腳佔用，已改從同一條電源軌的 top+4 拉線')
  })

  it('a wire end, a covered hole, a full strip, a hole off the board: refused at once, with what to do', () => {
    __setLangForTests('zh-TW')
    // a wire end: never redirected (the user may mean that wire), the free hole is named
    const wireEnd = wireStartCheck(FULL, 'a55')
    expect(wireEnd).toEqual({ kind: 'refuse', refusal: { kind: 'occupied', ref: 'a55' }, where: 'row' })
    expect(wireStartHint(wireEnd, FULL)).toBe('這裡不能接：a55 已經被導線 W1 佔用——請點同一排的空孔')
    // a20 on the bench: W1's end, U1 PA5 in c20, the board's body over b / d / e — no free hole left
    const noRoom = wireStartCheck(BENCH, 'a20')
    expect(noRoom).toEqual({ kind: 'refuse', refusal: { kind: 'occupied', ref: 'a20' }, where: 'row-full' })
    expect(wireStartHint(noRoom, BENCH)).toBe('這裡不能接：a20 已經被導線 W1 佔用——這一排已經沒有空孔')
    const covered = wireStartCheck(BENCH, 'e25')
    expect(covered).toMatchObject({ kind: 'refuse', refusal: { kind: 'covered', ref: 'e25', by: 'U1' }, where: 'row' })
    expect(wireStartHint(covered, BENCH)).toBe('這裡不能接：e25 被 U1 的本體蓋住了——請點同一排的空孔')
    const full = wireStartCheck(FULL, 'c40')
    expect(full).toMatchObject({ kind: 'refuse', where: 'row-full' })
    expect(wireStartHint(full, FULL)).toBe('這裡不能接：c40 已經被 R2 第 1 腳佔用——這一排已經沒有空孔')
    const rail = wireStartCheck(BENCH, 'bot+0')
    expect(wireStartHint(rail, BENCH)).toBe('這裡不能接：bot+0 已經被導線 W3 佔用——請點同一條電源軌上的空孔')
    const off = wireStartCheck(BENCH, 'a90')
    expect(off).toEqual({ kind: 'refuse', refusal: { kind: 'invalid-endpoint', ref: 'a90' }, where: null })
    expect(wireStartHint(off, BENCH)).toBe('這裡不能接：a90 不在目前的麵包板上')
  })

  it('a free hole and a terminal start a wire as before', () => {
    expect(wireStartCheck(BENCH, 'a40')).toEqual({ kind: 'ok' })
    expect(wireStartCheck(BENCH, 'PS1:+')).toEqual({ kind: 'ok' }) // a terminal takes any number of wires
    expect(wireStartCheck(BENCH, 'PS9:+')).toMatchObject({ kind: 'refuse', refusal: { kind: 'invalid-endpoint' } })
    expect(wireStartHint({ kind: 'ok' }, BENCH)).toBeNull()
  })

  it('one endpoint is checked by the store’s own rules (store.wireRefusal agrees for a free partner)', async () => {
    const { wireRefusal } = await import('../src/state/store')
    for (const ref of ['a20', 'c21', 'e25', 'a90', 'a40', 'b33']) {
      const one = endpointRefusal(BENCH, ref)
      const pair = wireRefusal(BENCH, ref, 'a45')
      expect(one).toEqual(pair)
    }
  })

  it('the strip search order: nearest row first, a tie away from the channel', () => {
    expect(sameNetHoles(BENCH, 'c21')).toEqual(['b21', 'd21', 'a21', 'e21'])
    expect(sameNetHoles(BENCH, 'h5')).toEqual(['i5', 'g5', 'j5', 'f5'])
    expect(sameNetHoles(BENCH, 'top+0').slice(0, 3)).toEqual(['top+1', 'top+2', 'top+3'])
  })

  it('a refused second click drops the start only when the started end is the problem', () => {
    expect(refusalConcernsFrom({ kind: 'occupied', ref: 'a20' }, 'a20')).toBe(true)
    expect(refusalConcernsFrom({ kind: 'covered', ref: 'e25', by: 'U1' }, 'e25')).toBe(true)
    expect(refusalConcernsFrom({ kind: 'invalid-endpoint', ref: 'a90' }, 'a90')).toBe(true)
    expect(refusalConcernsFrom({ kind: 'occupied', ref: 'a20' }, 'a21')).toBe(false) // the second end: re-aim
    expect(refusalConcernsFrom({ kind: 'duplicate', ref: 'a33', wireId: 'W1' }, 'a20')).toBe(false)
    expect(refusalConcernsFrom({ kind: 'same-endpoint', ref: 'a40' }, 'a40')).toBe(false)
  })
})

describe('SH-F6 a refused leads / probe hole says why', () => {
  it('the H2 wording for a wire end, a part pin, a covered hole, a picked hole, a hole off the board', () => {
    __setLangForTests('zh-TW')
    const L: CircuitLayout = {
      ...BENCH,
      components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      wires: [{ id: 'W1', from: 'a20', to: 'a33' }],
    }
    expect(placementSpotReason(L, 'resistor', 'a20')).toBe('a20 已經被導線 W1 佔用')
    expect(placementSpotRefusedHint(placementSpotReason(L, 'resistor', 'a20')!)).toBe('這裡不能放：a20 已經被導線 W1 佔用')
    expect(placementSpotReason(L, 'resistor', 'c25')).toBe('c25 已經被 U1 PA0 佔用')
    expect(placementSpotReason(L, 'resistor', 'e20')).toBe('e20 被 U1 的本體蓋住了')
    expect(placementSpotReason(L, 'resistor', 'a40', ['a40'])).toBe('a40 已經選過了')
    expect(placementSpotReason(L, 'resistor', 'a90')).toBe('a90 不在目前的麵包板上')
    expect(placementSpotReason(L, 'resistor', 'a40')).toBeNull() // a good hole has no reason
    expect(placementSpotReason(L, 'scope_probe', 'a20')).toBe('a20 已經被導線 W1 佔用')
  })
})

describe('SH-F9 undo / redo / delete name what changed', () => {
  beforeEach(() => setDocument({ version: 1, components: [], wires: [] }))

  it('one step in words', () => {
    __setLangForTests('zh-TW')
    const empty: CircuitLayout = { version: 1, components: [], wires: [] }
    const r1: CircuitLayout = { ...empty, components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'] }] }
    expect(describeLayoutChange(empty, r1)).toBe('放上 R1')
    // the last part deleted is named, never 「清空麵包板」 (browser: long-press 刪除 R1 → ↶ said 「已復原：清空麵包板」)
    expect(describeLayoutChange(r1, empty)).toBe('刪除 R1')
    expect(historyStepText('undo', describeLayoutChange(r1, empty))).toBe('已復原：刪除 R1')
    // a whole board emptied at once
    expect(describeLayoutChange(BENCH, empty)).toBe('清空麵包板')
    const wired: CircuitLayout = { ...r1, wires: [{ id: 'W6', from: 'b10', to: 'b20' }] }
    expect(describeLayoutChange(r1, wired)).toBe('接上導線 W6')
    expect(describeLayoutChange(wired, r1)).toBe('刪除導線 W6')
    // PS1 goes with its wires: the step is named after the part
    const ps: CircuitLayout = { ...wired, components: [...wired.components, { id: 'PS1', type: 'power_supply' }], wires: [...wired.wires, { id: 'W7', from: 'PS1:+', to: 'top+0' }] }
    expect(describeLayoutChange(ps, wired)).toBe('刪除 PS1')
    const moved: CircuitLayout = { ...r1, components: [{ id: 'R1', type: 'resistor', holes: ['a11', 'a15'] }] }
    expect(describeLayoutChange(r1, moved)).toBe('移動 R1')
    const tuned: CircuitLayout = { ...r1, components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 220 } }] }
    expect(describeLayoutChange(r1, tuned)).toBe('調整 R1')
    const rewired: CircuitLayout = { ...wired, wires: [{ id: 'W6', from: 'b10', to: 'b21' }] }
    expect(describeLayoutChange(wired, rewired)).toBe('改接導線 W6')
    const recolored: CircuitLayout = { ...wired, wires: [{ id: 'W6', from: 'b10', to: 'b20', color: 'red' }] }
    expect(describeLayoutChange(wired, recolored)).toBe('更改導線 W6 的顏色')
    const u1: CircuitLayout = { ...empty, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }] }
    expect(describeLayoutChange(u1, { ...empty, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10', rotation: 180 }] })).toBe('旋轉 U1')
    expect(describeLayoutChange(empty, BENCH)).toBe('載入電路')
    // a paste (Ctrl+V, round 5) adds a part AND its wire while every part already there stays the same
    // object — a placement, never 「載入電路」 (a load builds fresh objects, so the same additions read as one)
    const pasted: CircuitLayout = { ...wired, components: [...wired.components, { id: 'R2', type: 'resistor', holes: ['a40', 'a44'] }], wires: [...wired.wires, { id: 'W9', from: 'b40', to: 'b50' }] }
    expect(describeLayoutChange(wired, pasted)).toBe('放上 R2、導線 W9')
    expect(describeLayoutChange(wired, JSON.parse(JSON.stringify(pasted)) as CircuitLayout)).toBe('載入電路')
    expect(describeLayoutChange(r1, { ...r1, board: 'labxl' })).toBe('變更麵包板')
    expect(describeLayoutChange(r1, r1)).toBeNull()
    expect(nameList(['R1', 'LED1', 'R2', 'R3', 'R4'])).toBe('R1、LED1、R2 等 5 項')
  })

  it('the toasts: 「已復原：…」 / 「已重做：…」 after the store’s own undo / redo', () => {
    __setLangForTests('zh-TW')
    st().addComponent('resistor', { holes: ['a10', 'a14'] })
    st().addWire('b10', 'b20')
    const wireId = st().layout.wires[0].id
    undoWithFeedback()
    expect(st().layout.wires).toHaveLength(0)
    expect(getToasts().at(-1)?.text).toBe(`已復原：接上導線 ${wireId}`)
    redoWithFeedback()
    expect(st().layout.wires).toHaveLength(1)
    expect(getToasts().at(-1)?.text).toBe(`已重做：接上導線 ${wireId}`)
    // a held Ctrl+Z replaces its own toast (one history toast at a time)
    undoWithFeedback()
    undoWithFeedback()
    expect(getToasts().filter((t) => t.text.startsWith('已復原')).map((t) => t.text)).toEqual(['已復原：放上 R1'])
    expect(historyStepText('undo', null)).toBe('已復原')
  })

  it('Delete names what it removed and how to get it back', () => {
    __setLangForTests('zh-TW')
    st().addComponent('power_supply', {})
    const id = st().layout.components[0].id
    st().select(id)
    expect(removeSelectedWithFeedback()).toBe(true)
    expect(st().layout.components).toHaveLength(0)
    expect(getToasts().at(-1)?.text).toBe(`已刪除 ${id}——Ctrl+Z 可復原`)
    expect(deletedText(['PS1'], false)).toBe('已刪除 PS1——Ctrl+Z 可復原')
    expect(deletedText(['導線 W3'], true)).toBe('已刪除導線 W3——點 ↶ 可復原')
    expect(removeSelectedWithFeedback()).toBe(false) // nothing selected
  })

  it('the classic chrome stays silent', () => {
    __setLangForTests('en')
    st().addComponent('resistor', { holes: ['a10', 'a14'] })
    const before = getToasts().length
    undoWithFeedback()
    redoWithFeedback()
    st().select(st().layout.components[0].id)
    removeSelectedWithFeedback()
    expect(getToasts().length).toBe(before)
  })
})

describe('SH-F3 the capsule names what stops every board', () => {
  const problem = (over: Partial<Problem>): Problem => ({
    id: over.id ?? 'p',
    level: 'warning',
    source: 'mcu',
    title: 'T',
    detail: 'D',
    componentIds: [],
    holes: [],
    ...over,
  })
  const power = (id: string) => problem({ id: `mcu:power:${id}`, level: 'error', fact: `power:${id}`, componentIds: [id] })
  const fw = (id: string) => problem({ id: `mcu:fw:${id}`, fact: `fw-missing:${id}`, componentIds: [id] })

  it('only when every board is blocked; then the first board', () => {
    expect(runningBlockerOf(['U1'], [power('U1')])).toEqual({ kind: 'power', id: 'U1' })
    expect(runningBlockerOf(['U1'], [fw('U1')])).toEqual({ kind: 'fw-missing', id: 'U1' })
    expect(runningBlockerOf(['U1', 'U2'], [fw('U2'), power('U1')])).toEqual({ kind: 'power', id: 'U1' })
    expect(runningBlockerOf(['U1', 'U2'], [power('U1')])).toBeNull() // U2 runs
    expect(runningBlockerOf([], [power('U1')])).toBeNull() // no boards (a 555 circuit)
    expect(runningBlockerOf(['U1'], [problem({ id: 'halt', fact: 'halt:U1', componentIds: ['U1'] })])).toBeNull()
  })

  it('「執行中 · U1 沒有供電」 red, 「執行中 · U1 還沒有韌體」 orange; the aria name stays 「暫停模擬」', () => {
    __setLangForTests('zh-TW')
    const p = runCapsuleText('running', { time: 3.1, blocker: { kind: 'power', id: 'U1' } })
    expect([p.word, p.extra, p.time, p.aria]).toEqual(['執行中', 'U1 沒有供電', null, '暫停模擬'])
    expect(p.state).toBe('unpowered')
    expect(stateColor(p.state)).toBe('var(--ios-red)')
    const f = runCapsuleText('running', { time: 3.1, blocker: { kind: 'fw-missing', id: 'U1' } })
    expect([f.word, f.extra, f.aria]).toEqual(['執行中', 'U1 還沒有韌體', '暫停模擬'])
    expect(STATE_TONE[f.state]).toBe('orange')
    // no blocker: the running clock as before
    const r = runCapsuleText('running', { time: 3.114 })
    expect([r.word, r.time, r.extra, r.state]).toEqual(['執行中', '3.11 s', null, 'running'])
  })

  it('one resume verb: 「核心已停住 · 繼續執行」 (English stays Resume)', () => {
    __setLangForTests('zh-TW')
    expect(runCapsuleText('halted', { time: 1, mcuId: 'U1' }).extra).toBe('繼續執行')
    __setLangForTests('en')
    expect(runCapsuleText('halted', { time: 1, mcuId: 'U1' }).extra).toBe('Resume')
  })
})

describe('SH-F10 one verb, one speed format', () => {
  it('the More sheet speeds read like the capsule (classic keeps 0.1×)', () => {
    __setLangForTests('zh-TW')
    // five 「n 倍速」 wrap in a ~340 px sheet: the row title carries 倍速 (the spec's fallback)
    expect(speedOptions(false).map((o) => o.label)).toEqual(['0.1 倍', '0.5 倍', '1 倍', '5 倍', '10 倍'])
    expect(speedRowTitle(false)).toBe('模擬速度（倍速）')
    expect(speedRowTitle(true)).toBe('速度')
    expect(speedOptions(true).map((o) => o.label)).toEqual(['0.1×', '0.5×', '1×', '5×', '10×'])
    expect(speedOptions(false).map((o) => o.value)).toEqual(['0.1', '0.5', '1', '5', '10'])
  })

  it('the pill: 「電路已就緒（空白鍵）」 + 〔執行模擬〕 — the verb once', () => {
    __setLangForTests('zh-TW')
    const m = statusPillModel({ problems: [], counts: { error: 0, warning: 0, info: 0 }, phase: 'idle', haltedId: null, boardEmpty: false })!
    expect([m.text, m.action?.label]).toEqual(['電路已就緒（空白鍵）', '執行模擬'])
    expect(m.text).not.toContain('執行模擬')
    const touch = statusPillModel({ problems: [], counts: { error: 0, warning: 0, info: 0 }, phase: 'idle', haltedId: null, boardEmpty: false, touch: true })!
    expect(touch.text).toBe('電路已就緒')
  })
})

describe('SH-F2 / SH-F5 / SH-F8 the parts a browser checks (source guards; the browser replay is v2-desktop.mjs / v3-phone.mjs)', () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8')

  it('SH-F2 both tours are modal for the keyboard: primary focus, Tab trap, Esc = 略過, focus given back', () => {
    const src = read('src/ui/chrome/Onboarding.tsx')
    expect(src.match(/useTourFocus\(rootRef, primaryRef, step, onDone\)/g)).toHaveLength(2)
    expect(src.match(/<div ref=\{rootRef\} className="app-onboard"/g)).toHaveLength(2)
    // 下一步 (both tours) and 開始第一課 (the path's last card) take the focus
    expect(src.match(/<PressableButton ref=\{primaryRef\}/g)).toHaveLength(3)
    expect(src).toContain("if (e.key === 'Escape')")
    expect(src).toContain('focusVisible: visible') // no ring on a programmatic focus: classic baselines unchanged
  })

  it('SH-F5 「完成」 never wraps; the toasts clear the undo pill while wiring on a phone', () => {
    const strip = read('src/ui/chrome/WireColorStrip.css')
    expect(strip).toMatch(/\.app-wire-done \{\s*white-space: nowrap;\s*flex: none;\s*\}/)
    expect(strip).toMatch(/@media \(max-width: 375px\)[\s\S]*\.app-wire-strip\.has-done \.app-swatch \{\s*width: 30px;\s*height: 30px;/)
    const app = read('src/app.css')
    expect(app).toMatch(/@media \(max-width: 899px\) \{\s*body\.app-wire-armed\.app-undo-visible \.lg-toast-host \{\s*bottom: calc\(var\(--lg-safe-bottom\) \+ 203px\);/)
  })

  it('SH-F8 the pill’s fix button is a ≥ 44 px finger target (coarse pointers only)', () => {
    const css = read('src/ui/chrome/StatusPill.css')
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/\.app-pill-action \{\s*position: relative;\s*min-width: 44px;/)
    expect(coarse).toMatch(/\.app-pill-action::after \{[^}]*inset: -6px;[^}]*min-height: 44px;/)
  })
})

describe('SH-F4 / SH-F7 the 更多 sheet and the undo pill (source guards; the browser replay is v2-desktop.mjs / v3-phone.mjs / v5-examples.mjs)', () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8')

  const squash = (s: string) => s.replace(/\s+/g, ' ')

  it('SH-F4 清空麵包板 frames the breadboard (new chrome); 對準電路 is never disabled; F frames on an empty board', () => {
    const more = squash(read('src/ui/sheets/MoreSheet.tsx'))
    // the camera comes back to the whole breadboard right after the clear
    const clear = more.indexOf('clearBoard()', more.indexOf('destructive: true'))
    expect(clear).toBeGreaterThan(0)
    expect(more.slice(clear, clear + 260)).toContain('if (!legacy) frameCircuit()')
    const pill = read('src/ui/chrome/UndoPill.tsx')
    const frameButton = pill.slice(pill.indexOf("aria-label={t('Frame the circuit')}"), pill.indexOf('onClick={() => frameCircuit()}'))
    expect(frameButton.length).toBeGreaterThan(0)
    expect(frameButton).not.toMatch(/disabled=/)
    // the F key frames without asking whether the board holds anything (an empty board's framing is the home view)
    const app = squash(read('src/App.tsx'))
    expect(app).toContain("if (key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !isLegacyChrome()) { e.preventDefault() frameCircuit() return }")
  })

  it('SH-F7 no example list in the new chrome’s 更多 sheet: one 「範例 ›」 row beside 課程 (above 電路), handed to the host', () => {
    const more = squash(read('src/ui/sheets/MoreSheet.tsx'))
    expect(more).not.toContain('ExamplesView') // the sheet's own 範例 page is gone (SC-F3 landed)
    // the classic chrome keeps its list, exactly where it was
    expect(more).toContain('{legacy && ( <> <div className="asm-examples-anchor" /> <ExampleGroups desktop={desktop} onOpened={onDismiss} /> </> )}')
    const row = more.indexOf("title={t('Examples')}")
    expect(row).toBeGreaterThan(0)
    expect(row).toBeLessThan(more.indexOf("header={t('Circuit')}"))
    // in the top 「where to go」 group, right after 課程 (both are new-chrome only)
    const lessons = more.indexOf("title={t('Lessons')}")
    expect(lessons).toBeGreaterThan(0)
    expect(row).toBeGreaterThan(lessons)
    expect(more.slice(lessons, row)).toContain('{onOpenExamples && (')
    // one opener for the empty state's 「開啟範例」 and the 更多 row: the workspace tab, or 元件 → 範例
    const app = squash(read('src/App.tsx'))
    const opener = app.slice(app.indexOf('const openExamples = () => {'), app.indexOf('// --- dock state machine ---'))
    expect(opener).toContain('showExamples()')
    expect(opener).toContain("showPartsSheetSegment('examples') setActiveSheet('parts')")
    expect(app).toContain('onOpenExamples={openExamples}')
    expect(app).toContain('onOpenExamples={legacy ? undefined : openExamples}')
    expect(app).not.toContain('setMoreSection')
  })

  it('SH-F7 the 元件 sheet opens on the segment asked for, once', () => {
    expect(takePartsSheetSegment()).toBe('parts')
    showPartsSheetSegment('examples')
    expect(takePartsSheetSegment()).toBe('examples')
    expect(takePartsSheetSegment()).toBe('parts') // the next plain opening is 元件庫 again
  })
})

describe('SH-F11 no space between two Chinese words in the hints and toasts', () => {
  it('one implementation: the lessons engine re-exports src/i18n/tidy.ts', () => {
    expect(tidyFromRefs).toBe(tidyCjkSpaces)
    expect(tidyCjkSpaces('從 PS1 正端 拉線')).toBe('從 PS1 正端拉線')
    expect(tidyCjkSpaces('a33（R1 第 1 腳 這一排）')).toBe('a33（R1 第 1 腳這一排）')
    expect(tidyCjkSpaces('U1 PA5 這一排')).toBe('U1 PA5 這一排') // next to Latin text the space stays
    expect(tidyCjkSpaces('Wire from PS1 + terminal')).toBe('Wire from PS1 + terminal')
  })

  it('the spec examples', () => {
    __setLangForTests('zh-TW')
    useStore.setState({ layout: BENCH })
    expect(hintForMode({ kind: 'wire', from: 'PS1:+', color: 'red' }, false)).toBe('從 PS1 正端拉線：點第二個孔位 · Esc 取消這條')
    expect(wireConnectedHint(BENCH, 'a20', 'a33')).toBe('已接上 a20（U1 PA5 這一排）→ a33（R1 第 1 腳這一排）')
  })

  it('every hint builder, every mode and part: no 「中 文」 in zh output (English untouched)', () => {
    __setLangForTests('zh-TW')
    useStore.setState({ layout: BENCH })
    const out: string[] = []
    const modes: InteractionMode[] = [
      { kind: 'wire', from: null, color: 'red' },
      { kind: 'wire', from: 'PS1:+', color: 'red' },
      { kind: 'wire', from: 'PS1:-', color: 'red' },
      { kind: 'wire', from: 'a33', color: 'red' },
      { kind: 'wire', from: 'c21', color: 'red' },
      { kind: 'wire', from: 'bot-0', color: 'red' },
    ]
    for (const type of ['resistor', 'led', 'potentiometer', 'stm32_bluepill', 'ne555', 'scope_probe', 'power_supply', 'pushbutton', 'capacitor']) {
      modes.push({ kind: 'place', type, pickedHoles: [] })
      modes.push({ kind: 'place', type, pickedHoles: ['a40'] })
    }
    for (const mode of modes) {
      for (const touch of [false, true]) {
        for (const armed of ['card', 'coach'] as const) out.push(hintForMode(mode, touch, armed, BENCH) ?? '')
      }
    }
    for (const touch of [false, true]) out.push(placedAgainHint('R2', touch), placedAgainHint('R2', touch, 'coach'))
    for (const [a, b] of [['a20', 'a33'], ['PS1:+', 'bot+0'], ['j37', 'bot-29'], ['a33', 'c21']]) out.push(wireConnectedHint(BENCH, a, b))
    out.push(wireRefusedHint({ kind: 'occupied', ref: 'c21' }, BENCH), wireRefusedHint({ kind: 'covered', ref: 'e25', by: 'U1' }, BENCH))
    for (const ref of ['c21', 'b33', 'a20', 'e25', 'a90', 'bot+0']) out.push(wireStartHint(wireStartCheck(BENCH, ref), BENCH) ?? '')
    out.push(wireStartHint(wireStartCheck(FULL, 'c40'), FULL) ?? '', wireStartHint(wireStartCheck(FULL, 'top+5'), FULL) ?? '')
    for (const type of ['resistor', 'potentiometer', 'led']) {
      const entry = getEntry(type)!
      out.push(placementRefusedHint(entry, '已經被導線 W1 佔用'), placementRefusedHint(entry, null))
    }
    out.push(placementRefusedHint(getEntry('stm32_bluepill')!, null, { hole: 'e10', fitRows: ['h'] }))
    out.push(placementSpotRefusedHint(placementSpotReason(BENCH, 'resistor', 'a20')!))
    const bad = out.filter((s) => CJK_SPACE.test(s))
    expect(out.filter(Boolean).length).toBeGreaterThan(60)
    expect(bad).toEqual([])
    // English is left alone
    __setLangForTests('en')
    expect(hintForMode({ kind: 'wire', from: 'PS1:+', color: 'red' }, false)).toBe('Wire from PS1:+ — tap the second hole or terminal') // the classic hint, word for word
  })
})
