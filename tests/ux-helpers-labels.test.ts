/**
 * UX fix wave — helpers H1 (src/i18n/parts.ts pinLabel / terminalLabel) and
 * H2 (src/ui/workspace/hole-chip.ts endpointName / wireRefusalText): one
 * name per pin, terminal and hole on every surface (UX_VERIFY.md §5.4).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { pinLabel, terminalLabel } from '../src/i18n/parts'
import { getEntry, type CatalogEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import { wireRefusal } from '../src/state/store'
import { endpointName, wireRefusalText } from '../src/ui/workspace/hole-chip'

afterEach(() => __setLangForTests('zh-TW'))

const e = (type: string): CatalogEntry => getEntry(type)!

/** U1 at h10 (PA0 → c25, PA5 → c20, 3V3_1 → c12, GND1 → c10), LED1 c40/c42, R1 a44–a48, PS1 + DMM1 off board. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'DMM1', type: 'multimeter' },
    { id: 'FG1', type: 'function_generator' },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'LED1', type: 'led', holes: ['c40', 'c42'] },
    { id: 'R1', type: 'resistor', holes: ['a44', 'a48'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
    { id: 'W3', from: 'a20', to: 'a40', color: 'yellow' },
  ],
}

describe('H1 pinLabel', () => {
  it('full form: the canonical names of UX_VERIFY §5.4', () => {
    const bp = e('stm32_bluepill')
    expect(pinLabel(bp, 'PA5', { id: 'U1' })).toBe('U1 PA5（板上 A5）')
    expect(pinLabel(bp, '3V3_1', { id: 'U1' })).toBe('U1 3V3（板上 3.3）')
    expect(pinLabel(bp, 'GND2', { id: 'U1' })).toBe('U1 GND（板上 G）')
    expect(pinLabel(e('led'), 'anode', { id: 'LED1' })).toBe('LED1 陽極（長腳）')
    expect(pinLabel(e('led'), 'cathode', { id: 'LED1' })).toBe('LED1 陰極（短腳）')
    expect(pinLabel(e('diode'), 'cathode', { id: 'D1' })).toBe('D1 陰極（色環端）')
    expect(pinLabel(e('resistor'), 'p2', { id: 'R1' })).toBe('R1 第 2 腳')
    expect(pinLabel(e('power_supply'), '+', { id: 'PS1' })).toBe('PS1 正端')
    expect(pinLabel(bp, 'PA5')).toBe('PA5（板上 A5）') // inside U1's own inspector
  })
  it('short form drops the note (dense tables; the full form goes in the title)', () => {
    const bp = e('stm32_bluepill')
    expect(pinLabel(bp, 'PA5', { id: 'U1', form: 'short' })).toBe('U1 PA5')
    expect(pinLabel(bp, '3V3_2', { id: 'U1', form: 'short' })).toBe('U1 3V3')
    expect(pinLabel(e('led'), 'anode', { id: 'LED1', form: 'short' })).toBe('LED1 陽極')
    expect(pinLabel(e('resistor'), 'p1', { id: 'R1', form: 'short' })).toBe('R1 第 1 腳')
  })
  it('English reads as English', () => {
    __setLangForTests('en')
    expect(pinLabel(e('stm32_bluepill'), 'PA5', { id: 'U1' })).toBe('U1 PA5 (board label A5)')
    expect(pinLabel(e('stm32_bluepill'), 'PA5', { id: 'U1', form: 'short' })).toBe('U1 PA5')
    expect(pinLabel(e('led'), 'anode', { id: 'LED1', form: 'short' })).toBe('LED1 anode')
  })
})

describe('H1 terminalLabel', () => {
  it('instrument terminals: 「PS1 正端」「DMM1 COM 端」「FG1 輸出端」', () => {
    expect(terminalLabel('PS1:+', LAYOUT)).toBe('PS1 正端')
    expect(terminalLabel('PS1:-', LAYOUT)).toBe('PS1 負端')
    expect(terminalLabel('DMM1:COM', LAYOUT)).toBe('DMM1 COM 端')
    expect(terminalLabel('FG1:out', LAYOUT)).toBe('FG1 輸出端')
    expect(terminalLabel('FG1:gnd', LAYOUT)).toBe('FG1 接地端')
  })
  it('a motor / module lead keeps its printed name; without a layout a generic name; a non-terminal stays', () => {
    expect(terminalLabel('M1:M+', { components: [{ id: 'M1', type: 'dc_motor' }] })).toBe('M1 M+')
    expect(terminalLabel('PS9:+')).toBe('PS9 正端')
    expect(terminalLabel('X1:COM')).toBe('X1 COM 端')
    expect(terminalLabel('a25')).toBe('a25')
    expect(terminalLabel('PS1:')).toBe('PS1:')
  })
  it('English', () => {
    __setLangForTests('en')
    expect(terminalLabel('PS1:+', LAYOUT)).toBe('PS1 positive terminal')
    expect(terminalLabel('DMM1:COM', LAYOUT)).toBe('DMM1 COM terminal')
  })
})

describe('H2 endpointName', () => {
  it('a part pin in the hole: short pin name + hole', () => {
    expect(endpointName(LAYOUT, 'c25')).toBe('U1 PA0（c25）')
    expect(endpointName(LAYOUT, 'c40')).toBe('LED1 陽極（c40）')
    expect(endpointName(LAYOUT, 'a44')).toBe('R1 第 1 腳（a44）')
  })
  it('an empty strip hole (or one with only a wire end) names its strip by the first part pin', () => {
    expect(endpointName(LAYOUT, 'a25')).toBe('a25（U1 PA0 這一排）')
    expect(endpointName(LAYOUT, 'a20')).toBe('a20（U1 PA5 這一排）') // W3's end sits there
    expect(endpointName(LAYOUT, 'e40')).toBe('e40（LED1 陽極這一排）') // tidy zh-TW (SC-F2)
    expect(endpointName(LAYOUT, 'a55')).toBe('a55') // nothing on that strip
  })
  it('rails and terminals', () => {
    expect(endpointName(LAYOUT, 'top-20')).toBe('上方 − 電源軌 第 20 孔')
    expect(endpointName(LAYOUT, 'bot+7')).toBe('下方 + 電源軌 第 7 孔')
    expect(endpointName(LAYOUT, 'PS1:+')).toBe('PS1 正端')
    expect(endpointName(LAYOUT, 'DMM1:COM')).toBe('DMM1 COM 端')
  })
  it('unknown refs come back unchanged; never throws', () => {
    expect(endpointName(LAYOUT, 'zz9')).toBe('zz9')
    expect(endpointName(LAYOUT, '')).toBe('')
  })
})

describe('H8 / H2 wire refusals in words', () => {
  it('names why a wire cannot go there', () => {
    const r = (from: string, to: string) => {
      const x = wireRefusal(LAYOUT, from, to)
      return x ? wireRefusalText(x, LAYOUT) : null
    }
    expect(r('a25', 'top-20')).toBeNull()
    expect(r('a25', 'a25')).toBe('a25 已經接在這條導線的另一端')
    expect(r('c25', 'top-20')).toBe('c25 已經被 U1 PA0 佔用')
    expect(r('a20', 'top-20')).toBe('a20 已經被導線 W3 佔用')
    expect(r('a40', 'a20')).toBe('這兩點之間已經有導線 W3')
    expect(r('a90', 'a1')).toBe('a90 不在目前的麵包板上')
    expect(r('PS9:+', 'a1')).toBe('PS9:+ 不是電路中任何元件的端子')
    expect(wireRefusalText({ kind: 'no-wire', wireId: 'W9' }, LAYOUT)).toBe('導線 W9 已經不存在')
    expect(wireRefusalText({ kind: 'covered', ref: 'g20', by: 'U1' }, LAYOUT)).toBe('g20 被 U1 的本體蓋住了')
  })
  it('a hole under a part body is "covered", naming the part', () => {
    // the Blue Pill PCB covers rows d–g between its header rows
    const x = wireRefusal(LAYOUT, 'e20', 'top-20')
    expect(x).toEqual({ kind: 'covered', ref: 'e20', by: 'U1' })
  })
})
