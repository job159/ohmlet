/**
 * Operation simplification (product owner, 2026-11): 「刪除物件不要做 double
 * check，按 delete 直接刪」「導線不要選顏色」「把載入完整答案做在更顯見的地方」
 * and similar friction:
 *
 *   - deleting never asks first in the product chrome — the selection pill
 *     (any count), the inspector's 移除 / header trash, the Delete key —
 *     and every toast carries 〔復原〕, which undoes exactly that step (and
 *     refuses with words when the board changed since); the classic chrome
 *     keeps its confirmations;
 *   - the wire strip shows the colour legend instead of swatches (classic:
 *     the six swatches), the wire inspector the colour's meaning; the
 *     scene's C1 override (setWireColorOverride) replaces the stored colour;
 *   - 「載入完整答案」: a tinted button in the lesson header (product chrome,
 *     both before and while working on the lesson), the coach's calm
 *     「卡住了？載入完整答案」; a lesson load asks only when firmware it would
 *     overwrite is on the board (loadNeedsConfirm);
 *   - the inspector's one-tap common values (R / C / PSU) and LED colours.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import type { CircuitLayout, Wire } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { BreadboardScene } from '../src/three/scene'
import { CONFIRM_THRESHOLD, groupDeleteConfirms } from '../src/ui/chrome/SelectionPill'
import { WireColorStrip, wireLegendItems } from '../src/ui/chrome/WireColorStrip'
import { firmwareAtRisk, removeSelectedWithFeedback, undoAction, undoableToast } from '../src/ui/chrome/edit-feedback'
import { useLab } from '../src/ui/embedded/lab'
import { getToasts } from '../src/ui/kit'
import { loadNeedsConfirm, requestLoad } from '../src/ui/lessons/actions'
import { FullAnswerButton, LessonView } from '../src/ui/lessons/LessonBrowser'
import { useLessonUi } from '../src/ui/lessons/state'
import { Handout } from '../src/ui/lessons/print'
import { PropertiesBody, QUICK_PICKS, quickPicksFor } from '../src/ui/sheets/PropertiesSheet'

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __resetHistoryForTests?.()
  useStore.setState({ selection: [], mode: { kind: 'select' } })
})
afterEach(() => {
  __setLangForTests('zh-TW')
  vi.unstubAllGlobals()
})

const st = () => useStore.getState()

const LED: CircuitLayout = {
  version: 1,
  name: 't',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'yellow' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'yellow' },
    { id: 'W3', from: 'a18', to: 'top-12', color: 'green' },
  ],
} as CircuitLayout

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi] as unknown as { getState: () => object; getInitialState: () => object }[]
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

describe('delete without a double check', () => {
  it('the selection pill asks only in the classic chrome, above its threshold', () => {
    expect(CONFIRM_THRESHOLD).toBe(3)
    expect(groupDeleteConfirms(12, false)).toBe(false)
    expect(groupDeleteConfirms(4, true)).toBe(true)
    expect(groupDeleteConfirms(3, true)).toBe(false)
  })

  it('Delete: gone at once, the toast carries 〔復原〕 that brings the part and its wires back', () => {
    st().loadLayout(LED)
    st().select('LED1')
    expect(removeSelectedWithFeedback()).toBe(true)
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1', 'R1'])
    const toast = getToasts().at(-1)!
    expect(toast.text).toBe('已刪除 LED1——Ctrl+Z 可復原')
    expect(toast.action?.label).toBe('復原')
    expect(toast.duration).toBeGreaterThanOrEqual(5000) // long enough to reach it
    toast.action!.run()
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1', 'R1', 'LED1'])
    expect(getToasts().at(-1)?.text).toBe('已復原：刪除 LED1')
  })

  it('a group delete is one step: 〔復原〕 brings every part and wire back', () => {
    st().loadLayout(LED)
    useStore.setState({ selection: ['R1', 'LED1', 'W1', 'W3'] })
    removeSelectedWithFeedback()
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1'])
    expect(st().layout.wires.map((w) => w.id)).toEqual(['W2'])
    getToasts().at(-1)!.action!.run()
    expect(st().layout.components).toHaveLength(3)
    expect(st().layout.wires).toHaveLength(3)
  })

  it('〔復原〕 never undoes a later edit: after one more change it says so and leaves the history alone', () => {
    st().loadLayout(LED)
    st().select('R1')
    removeSelectedWithFeedback()
    const action = getToasts().at(-1)!.action!
    st().removeWire('W3') // one more edit before the tap
    // the toast leaves with that edit (its 〔復原〕 could only refuse now) — a stale handle still refuses
    expect(getToasts().some((x) => x.text.startsWith('已刪除 R1'))).toBe(false)
    action.run()
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1', 'LED1']) // R1 stays deleted, W3 too
    expect(st().layout.wires.map((w) => w.id)).toEqual(['W1', 'W2'])
    expect(getToasts().at(-1)?.text).toBe('之後又有新的變更——請用 ↶ 一步步復原')
  })

  it('undoableToast / undoAction for any one-step edit (清空麵包板, a lesson load)', () => {
    st().loadLayout(LED)
    st().clearBoard()
    const after = st().layout
    undoableToast('已清空麵包板', after)
    expect(getToasts().at(-1)?.action?.label).toBe('復原')
    undoAction(after).run()
    expect(st().layout.components).toHaveLength(3)
  })

  it('the classic chrome stays silent (its confirmations stay)', () => {
    __setLangForTests('en')
    st().loadLayout(LED)
    st().select('R1')
    const n = getToasts().length
    removeSelectedWithFeedback()
    expect(getToasts().length).toBe(n)
  })
})

describe('automatic wire colours in the chrome', () => {
  it('wire mode: a legend instead of swatches (product); the six swatches (classic)', () => {
    st().loadLayout(LED)
    useStore.setState({ mode: { kind: 'wire', from: null, color: 'red' } })
    const html = renderLive(createElement(WireColorStrip))
    expect(html).not.toContain('app-swatch')
    expect(html).toContain('紅＝電源正')
    expect(html).toContain('黑＝地')
    expect(html).toContain('其他顏色＝訊號')
    expect(html).toContain('完成')
    // the signal dots are the plain-signal palette's own colours (one colour, one meaning)
    expect(wireLegendItems().map((i) => i.colors[0])).toEqual(['red', 'black', 'purple'])
    __setLangForTests('en')
    const classic = renderLive(createElement(WireColorStrip))
    expect(classic.match(/app-swatch/g)).toHaveLength(6)
    expect(classic).not.toContain('app-wire-legend')
    useStore.setState({ mode: { kind: 'select' } })
  })

  it('the wire inspector shows the role colour and its meaning, no colour editor', () => {
    st().loadLayout(LED)
    useStore.setState({ selection: ['W3'] })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(html).toContain('黑色：接地（PS1 負端）') // stored green
    expect(html).toContain('aria-label="刪除導線 W3"')
    expect(html).not.toContain('role="radiogroup"')
  })

  it('the scene draws the override colour (null = the stored one) — the wire signature folds it in', () => {
    const scene = new BreadboardScene()
    const s = scene as unknown as { displayWire(w: Wire): Wire }
    const w: Wire = { id: 'W3', from: 'a18', to: 'top-12', color: 'green' }
    expect(s.displayWire(w).color).toBe('green')
    scene.setWireColorOverride(new Map([['W3', 'black']]))
    expect(s.displayWire(w).color).toBe('black')
    expect(s.displayWire({ ...w, id: 'W9' }).color).toBe('green') // not in the map: stored
    scene.setWireColorOverride(null)
    expect(s.displayWire(w)).toBe(w)
  })

  it('the lesson handout names the colour the board shows (product) / the stored one (classic)', () => {
    const lesson = lessonById('b1-led-resistor')!
    const html = renderToStaticMarkup(createElement(Handout, { lesson }))
    expect(html).toContain('紅色：電源正極（5 V 網路）')
    expect(html).toContain('黑色：接地（PS1 負端）')
  })
})

describe('「載入完整答案」', () => {
  const b1 = () => lessonById('b1-led-resistor')!
  const i7 = () => lessonById('i7-i2c')!
  const blink: CircuitLayout = {
    version: 1,
    name: 'blink',
    components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
    wires: [],
  } as CircuitLayout

  it('a tinted button in the lesson header, before and while working on the lesson (product chrome)', () => {
    useStore.setState({ layout: { version: 1, name: 'e', components: [], wires: [] } as CircuitLayout })
    const before = renderLive(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
    const row = before.slice(before.indexOf('lsn-actions'), before.indexOf('lsn-tabs'))
    expect(row).toContain('載入起始電路')
    expect(row).toMatch(/lg-btn-tinted[^>]*>載入完整答案</)
    expect(row).not.toContain('>顯示解答<') // the old button: the new one's tooltip says what it does
    useStore.setState({ layout: b1().start.layout })
    const working = renderLive(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
    const row2 = working.slice(working.indexOf('lsn-actions'), working.indexOf('lsn-tabs'))
    expect(row2).toContain('檢查我的電路')
    expect(row2).toContain('載入完整答案')
    expect(working).not.toContain('>顯示解答…<') // no longer behind ⋯
    expect(working).not.toContain('更多課程動作')
  })

  it('the classic chrome keeps 顯示解答 (and no 載入完整答案)', () => {
    __setLangForTests('en')
    useStore.setState({ layout: { version: 1, name: 'e', components: [], wires: [] } as CircuitLayout })
    const html = renderLive(createElement(LessonView, { lesson: b1(), variant: 'panel' }))
    expect(html).toContain('Show solution')
    expect(html).not.toContain('Load the full answer')
  })

  it('the coach card’s calm action', () => {
    const html = renderToStaticMarkup(createElement(FullAnswerButton, { lesson: b1(), calm: true }))
    expect(html).toContain('卡住了？載入完整答案')
    expect(html).toContain('lsn-coach-answer')
    // b1's answer has no firmware: the tooltip does not claim any (review F7)
    expect(html).toContain('title="顯示解答：載入本課完成的電路——按 ↶ 可復原"')
    const i1 = renderToStaticMarkup(createElement(FullAnswerButton, { lesson: lessonById('i1-gpio-output')!, calm: true }))
    expect(i1).toContain('title="顯示解答：載入本課完成的電路與韌體——按 ↶ 可復原"')
  })

  it('a load asks only when it would overwrite firmware (firmware is not in the undo history)', () => {
    const empty = { version: 1, name: 'e', components: [], wires: [] } as CircuitLayout
    expect(loadNeedsConfirm(b1(), 'solution', empty, false, {})).toBe(false)
    expect(loadNeedsConfirm(b1(), 'solution', empty, true, {})).toBe(false)
    // the classic chrome asks for any board
    expect(loadNeedsConfirm(b1(), 'solution', LED, true, {})).toBe(true)
    // product: a board without firmware — the circuit is one undo away
    expect(loadNeedsConfirm(b1(), 'solution', LED, false, {})).toBe(false)
    // b1 has no MCU: U1 leaves the board, the lab keeps its binding for the undo
    expect(loadNeedsConfirm(b1(), 'solution', blink, false, { U1: { name: 'hal-blink.elf' } })).toBe(false)
    // i7 gives U1 firmware of its own: that binding would be overwritten
    expect(loadNeedsConfirm(i7(), 'solution', blink, false, { U1: { name: 'hal-blink.elf' } })).toBe(true)
    expect(loadNeedsConfirm(i7(), 'start', blink, false, { U1: { name: 'hal-blink.elf' } })).toBe(true)
    expect(loadNeedsConfirm(i7(), 'solution', blink, false, {})).toBe(false)
    // the board IS the lesson's circuit: its firmware is the lesson's
    expect(loadNeedsConfirm(i7(), 'solution', i7().start.layout, false, { U1: { name: 'lesson-i7-i2c.elf' } })).toBe(false)
  })

  it('firmwareAtRisk: the boards whose loaded firmware a load would overwrite', () => {
    const two = {
      ...blink,
      components: [...blink.components, { id: 'U2', type: 'stm32_bluepill', at: 'h40' }, { id: 'R1', type: 'resistor', holes: ['a1', 'a5'] }],
    } as CircuitLayout
    const fw = { U1: { name: 'a.elf' }, R1: { name: 'not an mcu' } }
    expect(firmwareAtRisk(two, fw, null)).toEqual(['U1']) // an import replaces every binding
    expect(firmwareAtRisk(two, fw, new Set(['U2']))).toEqual([]) // U1 only leaves: its binding waits for the undo
    expect(firmwareAtRisk(two, fw, new Set(['U1', 'U2']))).toEqual(['U1'])
  })

  it('requestLoad: product chrome loads at once over a board without firmware; the classic chrome asks', () => {
    st().loadLayout(LED)
    useLessonUi.getState().setConfirm(null)
    requestLoad(b1(), 'solution')
    expect(useLessonUi.getState().confirm).toBeNull()
    expect(st().layout.components.some((c) => c.id === 'DMM1')).toBe(true)
    __setLangForTests('en')
    st().loadLayout(LED)
    requestLoad(b1(), 'solution')
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: 'b1-led-resistor', which: 'solution' })
    useLessonUi.getState().setConfirm(null)
  })
})

describe('one-tap common values', () => {
  it('the picks: what the lessons and examples use', () => {
    expect(QUICK_PICKS.resistor.resistance).toEqual([220, 330, 1000, 4700, 10000])
    expect(quickPicksFor('capacitor', 'capacitance')).toEqual([100e-9, 1e-6, 10e-6, 100e-6])
    expect(quickPicksFor('power_supply', 'voltage')).toEqual([3.3, 5, 9, 12])
    expect(quickPicksFor('resistor', 'nope')).toBeUndefined()
  })

  it('R1 shows them as a wrapping row (product); the E12 scroller stays in the classic chrome', () => {
    st().loadLayout(LED)
    useStore.setState({ selection: ['R1'] })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(html).toContain('aria-label="常用值"')
    for (const v of ['220 Ω', '330 Ω', '1 kΩ', '4.7 kΩ', '10 kΩ']) expect(html).toContain(`>${v}</button>`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>330 Ω</)
    expect(html).toContain('aria-label="刪除 R1"') // the header's trash
    __setLangForTests('en')
    const classic = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    expect(classic).not.toContain('prs-chips-wrap')
    expect(classic).toContain('E12 quick picks')
    expect(classic).not.toContain('prs-head-del')
  })

  it('the bench supply: the slider keeps its row, the usual voltages under it', () => {
    st().loadLayout(LED)
    useStore.setState({ selection: ['PS1'] })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    for (const v of ['3.3 V', '5 V', '9 V', '12 V']) expect(html).toContain(`>${v}</button>`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>5 V</)
  })

  it('LED colours are one-tap swatches (product)', () => {
    st().loadLayout(LED)
    useStore.setState({ selection: ['LED1'] })
    const html = renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
    for (const c of ['紅色', '綠色', '黃色', '藍色', '白色']) expect(html).toContain(`aria-label="${c}"`)
    expect(html).toMatch(/role="radio" aria-checked="true" aria-label="紅色"/)
    expect(html).not.toContain('prs-select-cover')
  })
})
