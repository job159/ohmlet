/**
 * UX fix SH-11 / SH-12 — placement and wiring feedback.
 *
 * SH-11: a refused dip / footprint drop names the REAL reason
 * (src/ui/chrome/hints.ts placementRefusedHint + packageOverflow):
 *   - a Blue Pill clicked in row e: 「請點 h 列（藍色標示）的孔位（PB12 對齊
 *     那個孔）」, never the validator's "use the XL board" (F-08);
 *   - right row, off the right edge (h60 on a 63-column board): 「往左移」;
 *   - a DIP not in row f (pin 1 sits in f — dipHoles): 「請點 f 列」;
 *   - otherwise the validator's reason (occupied …).
 * Pure functions + the catalog; App.tsx's refusalWhere (the store probe)
 * is replayed in the browser by scripts/ux-e2e/shell-SH-11.mjs.
 *
 * SH-12: a started wire names its first end like every other surface
 * (H2 endpointName), a committed wire is confirmed 「已接上 … → …」, a
 * refused one says why (H2 wireRefusalText), and on touch a placement the
 * lesson coach armed is left with 「再按一次「放置中」」 (TR-19).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { InteractionMode } from '../src/state/types'
import {
  anchorRowOf,
  hintForMode,
  packageOverflow,
  placedAgainHint,
  placementRefusedHint,
  wireConnectedHint,
  wireRefusedHint,
} from '../src/ui/chrome/hints'
import { endpointName } from '../src/ui/workspace/hole-chip'

afterEach(() => __setLangForTests('zh-TW'))

const bluepill = getEntry('stm32_bluepill')!
const ne555 = getEntry('ne555')!
const STD = { size: 'standard' as const, count: 1 }
/** the validator's text for a footprint whose anchor sits in a wrong row (it reads as "off the board") */
const OFF_BOARD_REASON = '封裝會超出標準麵包板（63 欄）——請改用加大 XL 麵包板或把它往左移'

describe('SH-11 refused placement', () => {
  it('the anchor rows: h for the Blue Pill, f for a DIP', () => {
    expect(anchorRowOf(bluepill)).toBe('h')
    expect(anchorRowOf(ne555)).toBe('f')
  })

  it('Blue Pill on e10: the row, never the XL board', () => {
    __setLangForTests('zh-TW')
    const text = placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'e10', fitRows: ['h'], overflow: null })
    expect(text).toContain('h 列')
    expect(text).toContain('PB12 對齊那個孔')
    expect(text).toContain('跨在中央溝槽上')
    expect(text).not.toContain('XL')
    // same without the probe (an older caller / every row of the column taken)
    expect(placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'e10' })).toContain('h 列')
    expect(placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'e10', fitRows: [] })).toContain('h 列')
  })

  it('the probe decides when rotated (the row that fits is named)', () => {
    __setLangForTests('zh-TW')
    const text = placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'a10', fitRows: ['c'], rotation: 180 })
    expect(text).toContain('c 列')
    // rotated, nothing fits at this column: no row is guessed — the validator speaks
    expect(placementRefusedHint(bluepill, '已被佔用', { hole: 'a10', fitRows: [], rotation: 180 })).toContain('已被佔用')
  })

  it('h60 on a 63-column board: the right edge → move left', () => {
    __setLangForTests('zh-TW')
    expect(packageOverflow(bluepill, 'h60', STD)).toBe('right')
    expect(packageOverflow(bluepill, 'h10', STD)).toBeNull()
    expect(packageOverflow(bluepill, 'h60', { size: 'labxl', count: 1 })).toBeNull()
    const text = placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'h60', fitRows: [], overflow: 'right' })
    expect(text).toContain('往左移')
    expect(text).toContain('右邊超出麵包板')
    expect(text).toContain('實驗室 XL') // the board as the More sheet names it
  })

  it('a DIP: pin 1 in row f; off the right edge; the validator otherwise', () => {
    __setLangForTests('zh-TW')
    expect(placementRefusedHint(ne555, null, { hole: 'e10', fitRows: ['f'] })).toContain('f 列')
    expect(packageOverflow(ne555, 'f62', STD)).toBe('right') // DIP-8: f62..f65
    expect(packageOverflow(ne555, 'f60', STD)).toBeNull()
    expect(placementRefusedHint(ne555, null, { hole: 'f62', fitRows: [], overflow: 'right' })).toContain('往左移')
    const occupied = placementRefusedHint(ne555, '第 3 腳的孔位 f12 已被 R1 佔用', { hole: 'f10', fitRows: ['f'] })
    expect(occupied).toContain('f12 已被 R1 佔用')
  })

  it('the touch wording is the same (no key is named)', () => {
    __setLangForTests('zh-TW')
    const text = placementRefusedHint(bluepill, OFF_BOARD_REASON, { hole: 'e10', fitRows: ['h'] })
    expect(text).not.toMatch(/Esc|R 旋轉/)
  })

  it('English sources read as English', () => {
    __setLangForTests('en')
    expect(placementRefusedHint(bluepill, null, { hole: 'e10', fitRows: ['h'] })).toContain('tap a hole in row h (marked in blue) (PB12 lands on that hole)')
    expect(placementRefusedHint(bluepill, null, { hole: 'h60', fitRows: [], overflow: 'right' })).toContain('move it left')
  })
})

// ---------------------------------------------------------------- SH-12
describe('SH-12 wire hints name both ends; the coach is the way out', () => {
  const layout = {
    version: 1,
    name: 't',
    components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
    wires: [],
  } as unknown as CircuitLayout

  it('the started wire names its first end as everything else does (H2 endpointName)', () => {
    __setLangForTests('zh-TW')
    const from = 'a20' // the free hole of U1's PA5 strip (c20)
    const mode: InteractionMode = { kind: 'wire', from, color: 'yellow' }
    const name = endpointName(layout, from)
    expect(name).toBe('a20（U1 PA5 這一排）')
    // no space between the full-width bracket and the next word
    expect(hintForMode(mode, false, 'card', layout)).toBe(`從 ${name}拉線：點第二個孔位 · Esc 取消這條`)
    expect(hintForMode(mode, true, 'card', layout)).toBe(`從 ${name}拉線：點第二個孔位 · 點空白處取消這條`)
  })

  it('a committed wire is confirmed with both ends; a refused one says why', () => {
    __setLangForTests('zh-TW')
    expect(wireConnectedHint(layout, 'a20', 'top-20')).toBe('已接上 a20（U1 PA5 這一排）→ 上方 − 電源軌第 20 孔') // SH-F11: no space between two Chinese words
    expect(wireRefusedHint({ kind: 'same-endpoint', ref: 'a20' }, layout)).toBe('這裡不能接：a20 已經接在這條導線的另一端')
  })

  it('touch, armed from the lesson coach: press 「放置中」 again — never a card the student did not touch (TR-19)', () => {
    __setLangForTests('zh-TW')
    const place: InteractionMode = { kind: 'place', type: 'resistor', pickedHoles: [] }
    const fromCard = hintForMode(place, true, 'card', layout)!
    const fromCoach = hintForMode(place, true, 'coach', layout)!
    expect(fromCard).toContain('再點一次卡片即可結束')
    expect(fromCoach).toContain('再按一次「放置中」即可結束')
    expect(fromCoach).not.toContain('卡片')
    expect(placedAgainHint('R1', true, 'coach')).toBe('已放置 R1——繼續點孔位可再放一顆 · 再按一次「放置中」即可結束')
    // a mouse hint names Esc either way
    expect(hintForMode(place, false, 'coach', layout)).toContain('Esc 取消')
    // every touch hint with a card exit has the fragment the swap looks for
    for (const type of ['resistor', 'led', 'ne555', 'stm32_bluepill', 'logic_probe']) {
      if (!getEntry(type)) continue
      const text = hintForMode({ kind: 'place', type, pickedHoles: [] }, true, 'coach', layout) ?? ''
      expect(text, type).not.toContain('卡片')
    }
  })

})
