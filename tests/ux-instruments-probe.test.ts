/**
 * UX wave — instruments workstream, probe actions and the analyzer's
 * session view (IS-4, IS-6, IS-7, IS-8):
 *  - addBusFor: channels + decoder in one step, with the firmware's baud;
 *    reusing existing channels, never duplicating a decoder;
 *  - findLogicChannel / ensureLogicChannel;
 *  - the channel picker's groups (buses, pins in use, nets);
 *  - scopeLogicLinks (a probe on a recorded net → exact timing);
 *  - revealInLogic → the shared cursor and the analyzer's view (marker A);
 *    replaced channels → auto-fit again, markers cleared;
 *  - addScopeProbeFor: one undo step for CH2 (the store default).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import { addBusFor, addScopeProbeFor, ensureLogicChannel, findLogicChannel, revealInLogic } from '../src/ui/embedded/probe-actions'
import { channelPickerGroups } from '../src/ui/embedded/instruments/channel-picker'
import { scopeLogicLinks } from '../src/ui/embedded/instruments/scope-autoset'
import { __resetLaViewForTests, setLaView, useLaView, watchLaInputs } from '../src/ui/embedded/instruments/la-view'
import { pinModeLabel } from '../src/ui/embedded/text'

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

/** U1 at h10 (PA5 → c20), R1 a40–a44 with a wire from PA5's free hole a20 to a40. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
    { id: 'D1', type: 'led', holes: ['b44', 'b47'] },
  ],
  wires: [{ id: 'W1', from: 'a20', to: 'e40', color: 'yellow' }],
}

const usart1 = { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
const frame = (): McuFrameInfo => ({
  componentId: 'U1',
  state: 'running',
  firmware: 'x.elf',
  pc: 0x08000100,
  hclkHz: 72e6,
  cycles: 1,
  realtime: 1,
  uarts: [{ name: 'USART1', config: usart1 }],
})

const storage = new MemoryStorage()
const lastToast = (): string => getToasts()[getToasts().length - 1]?.text ?? ''

function setDocument(layout: CircuitLayout): void {
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
  __setLangForTests('zh-TW')
  setDocument(LAYOUT)
  useLab.setState({ mcus: { U1: frame() }, firmware: {}, logicChannels: [] })
  useLab.getState().setLogicView({ decoders: [], trigger: null })
  __resetLaViewForTests()
  watchLaInputs()
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  useLab.setState({ mcus: {}, firmware: {} })
  vi.unstubAllGlobals()
})

describe('IS-7 addBusFor', () => {
  it('USART1: PA9 TX + PA10 RX and one UART decoder per direction at the programmed 115200 8N1', () => {
    const r = addBusFor('U1', 'USART1')
    expect(r).toMatchObject({ ok: true, channels: [0, 1] })
    expect(useLab.getState().logicChannels.map((c) => c.label)).toEqual(['PA9 TX', 'PA10 RX'])
    const decs = useLab.getState().logicView.decoders as { decoder: string; channels: Record<string, number>; options: Record<string, string> }[]
    expect(decs.map((d) => [d.decoder, d.channels.data, d.options.baud])).toEqual([
      ['uart', 0, '115200'],
      ['uart', 1, '115200'],
    ])
    expect(lastToast()).toBe('已加入 USART1：PA9、PA10 與 UART 解碼器（115200 8N1）')
    // again: nothing duplicated
    addBusFor('U1', 'USART1')
    expect(useLab.getState().logicChannels).toHaveLength(2)
    expect(useLab.getState().logicView.decoders).toHaveLength(2)
    expect(lastToast()).toBe('USART1 已在邏輯分析儀上（PA9、PA10）')
  })

  it('I2C1 reuses a channel already on the bus net and maps SCL / SDA', () => {
    ensureLogicChannel({ kind: 'mcu-pin', componentId: 'U1', pin: 'PB7' }, 'SDA line')
    const r = addBusFor('U1', 'I2C1')
    expect(r.channels).toEqual([1, 0])
    const d = useLab.getState().logicView.decoders[0] as { decoder: string; channels: Record<string, number> }
    expect(d).toMatchObject({ decoder: 'i2c', channels: { scl: 1, sda: 0 } })
  })

  it('refuses an unknown board / bus honestly', () => {
    expect(addBusFor('U9', 'USART1').ok).toBe(false)
    expect(addBusFor('U1', 'CAN1').ok).toBe(false)
    expect(lastToast()).toMatch(/電路中找不到/)
  })
})

describe('IS-4 / IS-8 channel lookup and the reveal', () => {
  it('findLogicChannel finds a channel by source or by electrical net, never adds', () => {
    expect(findLogicChannel({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' })).toBeNull()
    const e = ensureLogicChannel({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' })
    expect(e).toMatchObject({ ok: true, index: 0, added: true })
    // R1's left lead is wired to PA5's strip: the same net
    expect(findLogicChannel({ kind: 'hole', ref: 'a40' })?.index).toBe(0)
    expect(ensureLogicChannel({ kind: 'hole', ref: 'a40' })).toMatchObject({ ok: true, index: 0, added: false })
    expect(useLab.getState().logicChannels).toHaveLength(1)
  })

  it('revealInLogic moves the shared cursor and the analyzer view (centre, marker A)', () => {
    revealInLogic(0.5, 0.002, 0.4991)
    expect(useLab.getState().labCursor.t).toBe(0.4991)
    expect(useLaView.getState()).toMatchObject({ auto: false, span: 0.002, end: 0.501, markers: { a: 0.4991, b: null } })
    // near time zero the window never reaches before 0
    revealInLogic(0.001, 0.01)
    expect(useLaView.getState().end).toBe(0.01)
  })

  it('replacing the channels turns auto-fit back on and drops the old markers', () => {
    setLaView({ auto: false, markers: { a: 1, b: 2 } })
    useLab.getState().setLogicChannels([{ index: 0, label: 'PA5', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } }])
    expect(useLaView.getState().auto).toBe(true)
    expect(useLaView.getState().markers).toEqual({ a: null, b: null })
    // ADDING a channel keeps the markers
    setLaView({ markers: { a: 1, b: 2 } })
    useLab.getState().setLogicChannels([
      { index: 0, label: 'PA5', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } },
      { index: 1, label: 'PC13', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' } },
    ])
    expect(useLaView.getState().markers).toEqual({ a: 1, b: 2 })
  })
})

describe('IS-7 channel picker', () => {
  it('lists buses first, then pins in use (mode + function), nets by their best name, then all pins', () => {
    useStore.setState({
      telemetry: {
        time: 1,
        netVoltages: {},
        issues: [],
        components: { U1: { mcu: { state: 'running', pc: 0, hclkHz: 72e6, cycles: 0, pinModes: { PA9: 'af', PA5: 'out' } } } },
      } as never,
    })
    const groups = channelPickerGroups({
      layout: useStore.getState().layout,
      telemetry: useStore.getState().telemetry,
      mcus: useLab.getState().mcus,
      channels: [],
      tr: t,
      modeLabel: pinModeLabel,
    })
    expect(groups.map((g) => g.label)).toEqual(['匯流排（通道＋解碼器）', '使用中的腳位', '網路', 'U1 全部腳位'])
    expect(groups[0].options[0]).toMatchObject({ value: 'bus|U1|USART1', label: 'USART1（PA9 TX／PA10 RX）＋ UART 解碼器 115200 8N1' })
    // the pin-mode words are the inspector's (IN-20: 複用推挽 for an AF push-pull pin)
    expect(groups[1].options.map((o) => o.label)).toEqual(['PA5 · 推挽', 'PA9 · USART1_TX · 複用推挽'])
    expect(groups[2].options.map((o) => o.label)).toEqual(['R1 第 2 腳 · a44'])
  })
})

describe('IS-2 scope ↔ logic link, IS-4 probe channel', () => {
  it('a probe on a net the analyzer records links to that channel', () => {
    const layout: CircuitLayout = {
      ...LAYOUT,
      components: [...LAYOUT.components, { id: 'P1', type: 'scope_probe', holes: ['c40'], params: { channel: 1 } }],
    }
    const links = scopeLogicLinks(layout, [{ index: 3, label: 'PA5', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } }])
    expect([...links]).toEqual([[0, 3]])
    expect(scopeLogicLinks(layout, []).size).toBe(0)
  })

  it('a second probe from the probe action lands on CH2 in one undo step', async () => {
    const a = await addScopeProbeFor({ kind: 'hole', ref: 'a44' })
    const b = await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })
    expect([a.channel, b.channel]).toEqual([1, 2])
    useStore.getState().undo()
    const probes = useStore.getState().layout.components.filter((c) => c.type === 'scope_probe')
    expect(probes.map((p) => p.id)).toEqual([a.componentId])
  })
})
