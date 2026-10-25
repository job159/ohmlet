/**
 * UX fix wave — the host side of the scene's new interactions:
 *  - SC-13 wire-ends.ts: a dragged end is accepted where the store would
 *    take it (the wire's own old hole included), the drop re-routes in ONE
 *    undo step with 「已改接導線 W8：…」, a refusal says 「這裡不能接：…」,
 *    a release away from a hole leaves the wire as it was and says so;
 *  - SC-14 ProbeMenu probeMenuModel: a point the analyzer / the scope
 *    already measures offers 「在邏輯分析儀中檢視（PA5 LED）」 / 「在示波器中檢視
 *    （CH1）」 instead of adding it again; a terminal's header is its H1 name;
 *  - SC-15 FirmwareDrop dropFirmwareFile: the refusals of a canvas drop.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { getToasts } from '../src/ui/kit/toasts'
import { moveWireEndTo, wireEndAccepted } from '../src/ui/workspace/wire-ends'
import { probeMenuModel } from '../src/ui/workspace/ProbeMenu'
import { dropFirmwareFile } from '../src/ui/workspace/FirmwareDrop'

/** i4's PA0 wire W8 (a25 → e40, green — a picked colour), W3 on PA5's strip. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R2', type: 'resistor', holes: ['d40', 'd44'], params: { resistance: 330 } },
    { id: 'P1', type: 'scope_probe', holes: ['b44'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    { id: 'W3', from: 'a20', to: 'e30', color: 'yellow' },
    { id: 'W8', from: 'a25', to: 'e40', color: 'green' },
  ],
}

const lastToast = () => getToasts().at(-1)?.text ?? ''

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetHistoryForTests()
  useStore.setState({ layout: LAYOUT, selection: [], telemetry: null })
  useLab.setState({ logicChannels: [] })
})
afterEach(() => {
  useLab.setState({ logicChannels: [] })
})

describe('SC-13 wire end re-route (host side)', () => {
  it('accepts a free hole and the end’s own hole; refuses an occupied or covered one', () => {
    expect(wireEndAccepted('W8', 'from', 'a19')).toBe(true)
    expect(wireEndAccepted('W8', 'from', 'a25')).toBe(true) // where it already is
    expect(wireEndAccepted('W8', 'from', 'a20')).toBe(false) // W3's end sits there
    expect(wireEndAccepted('W8', 'from', 'e20')).toBe(false) // under U1's body
    expect(wireEndAccepted('W8', 'from', 'PS1:+')).toBe(true) // a terminal post
    expect(wireEndAccepted('nope', 'from', 'a19')).toBe(false)
  })

  it('the drop re-routes in one undo step and says what it connected', () => {
    moveWireEndTo('W8', 'from', 'a19')
    const w8 = useStore.getState().layout.wires.find((w) => w.id === 'W8')!
    expect(w8.from).toBe('a19')
    expect(w8.to).toBe('e40')
    expect(w8.color).toBe('green') // a picked colour stays
    expect(lastToast()).toBe('已改接導線 W8：a19（U1 PA6 這一排） → e40（R2 第 1 腳這一排）')
    useStore.getState().undo()
    expect(useStore.getState().layout.wires.find((w) => w.id === 'W8')!.from).toBe('a25')
  })

  it('a refusal explains why, prefixed 「這裡不能接：」; a release off any hole keeps the wire', () => {
    moveWireEndTo('W8', 'from', 'a20')
    expect(lastToast()).toBe('這裡不能接：a20 已經被導線 W3 佔用')
    expect(useStore.getState().layout.wires.find((w) => w.id === 'W8')!.from).toBe('a25')
    moveWireEndTo('W8', 'from', null)
    expect(lastToast()).toBe('沒有放在孔位或端子上——導線 W8 維持原樣')
    expect(useStore.getState().layout).toBe(LAYOUT)
  })
})

describe('SC-14 probe menu: show what is already measured', () => {
  it('a pin already on the analyzer: 「在邏輯分析儀中檢視（…）」 replaces 「加入邏輯分析儀」', () => {
    const before = probeMenuModel({ kind: 'hole', ref: 'c20' })
    expect(before.header).toBe('U1 PA5（板上 A5）· c20')
    expect(before.items[0].label).toBe('加入邏輯分析儀')
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA5 LED', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } }] })
    const after = probeMenuModel({ kind: 'hole', ref: 'c20' })
    expect(after.items[0].label).toBe('在邏輯分析儀中檢視（PA5 LED）')
    // the same net from a wire end on PA5's strip
    expect(probeMenuModel({ kind: 'hole', ref: 'a20' }).items[0].label).toBe('在邏輯分析儀中檢視（PA5 LED）')
    expect(after.items.map((i) => i.label).join(' ')).not.toMatch(/D0/)
  })

  it('a net the scope already probes: 「在示波器中檢視（CH1）」; a terminal’s header is its name', () => {
    expect(probeMenuModel({ kind: 'hole', ref: 'a44' }).items[1].label).toBe('在示波器中檢視（CH1）')
    expect(probeMenuModel({ kind: 'hole', ref: 'a30' }).items[1].label).toMatch(/^放示波器探棒（CH2）$/)
    expect(probeMenuModel({ kind: 'terminal', ref: 'PS1:+' }).header).toBe('PS1 正端')
  })
})

describe('SC-15 firmware drop refusals', () => {
  it('a non-firmware file, and a circuit without a board, say what to do', () => {
    dropFirmwareFile(new File(['x'], 'notes.txt'), 'U1')
    expect(lastToast()).toBe('只接受 .elf、.bin 或 .hex 韌體檔')
    useStore.setState({ layout: { version: 1, components: [], wires: [] } })
    dropFirmwareFile(new File(['x'], 'hal-blink.elf'), null)
    expect(lastToast()).toBe('電路中沒有微控制器——先放一塊 Blue Pill 開發板')
    useStore.setState({
      layout: {
        version: 1,
        components: [
          { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
          { id: 'U2', type: 'stm32_bluepill', at: 'h40' },
        ],
        wires: [],
      },
    })
    dropFirmwareFile(new File(['x'], 'hal-blink.elf'), null)
    expect(lastToast()).toBe('請放到要執行它的開發板上：U1、U2')
  })
})
