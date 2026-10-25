/**
 * UX fix wave — instruments IS-13 … IS-20 (pure and store-level parts):
 *  - IS-13 channel names from the circuit (H1 / H2), never 「b40 / 網路 b40」;
 *    the scope probe names 「P1 · U1 PA6 網路」; one probe per net
 *    (findScopeProbe, the duplicate refused, allowDuplicate);
 *  - IS-14 decoder texts in Chinese (SPI 0x hex, the mode error, boot noise,
 *    準位不明), the blocker sentences;
 *  - IS-15 the analyzer window: kept when a channel is added to the same
 *    circuit with a marker, reset (live, auto, no markers) on a new circuit
 *    or a simulation reset;
 *  - IS-16 RangeRing (the analog channel's voltage extremes);
 *  - IS-19 the meter reading of the 量測 tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import { addScopeProbeFor, findScopeProbe } from '../src/ui/embedded/probe-actions'
import { channelDisplayName, displayLabels, isDefaultChannelLabel, scopeProbeNames } from '../src/ui/embedded/instruments/channel-name'
import { __resetLaViewForTests, setLaView, useLaView, watchLaInputs } from '../src/ui/embedded/instruments/la-view'
import { annotationDisplayText, decodedFrames, runDecoder, transferText } from '../src/ui/embedded/logic-decoders'
import { RangeRing } from '../src/sim/coordinator/recorders'
import { meterReading } from '../src/ui/embedded/instruments/meter-readout'
import { blockerSentence } from '../src/ui/embedded/instruments/BlockerNote'
import type { Problem } from '../src/ui/embedded/problems'
import { capture, spiLines } from './instruments/synth'

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

/** pwm-fade's bench: PA6 (c19) → e40 → R1 a40–a44 → D1 anode b44, a probe P1 at c40. */
const PWM: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
    { id: 'D1', type: 'led', holes: ['b44', 'top-45'] },
    { id: 'P1', type: 'scope_probe', holes: ['c40'], params: { channel: 1 } },
  ],
  wires: [{ id: 'W1', from: 'a19', to: 'e40', color: 'yellow' }],
}

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
  setDocument(PWM)
  useLab.setState({ mcus: {}, firmware: {}, logicChannels: [] })
  __resetLaViewForTests()
  watchLaInputs()
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IS-13 channels named after the circuit', () => {
  const pa6 = { index: 0, label: 'PA6', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA6' } }
  it('a board pin: H1 name, the board below, the hole in the title; a label of one’s own stays', () => {
    const n = channelDisplayName(PWM, pa6)
    expect(n).toMatchObject({ name: 'PA6（板上 A6）', sub: 'U1', hole: 'c19', componentId: 'U1', pin: 'PA6' })
    expect(n.title).toBe('PA6（板上 A6） · c19 · U1 腳位')
    expect(channelDisplayName(PWM, { ...pa6, label: 'PA6 PWM' }).name).toBe('PA6 PWM')
    expect(isDefaultChannelLabel(PWM, pa6)).toBe(true)
    expect(isDefaultChannelLabel(PWM, { ...pa6, label: 'PA6 PWM' })).toBe(false)
  })
  it('a net: the part pin in the hole (「D1 陽極（長腳）」), never 「b44 / 網路 b44」; a terminal by H1', () => {
    const net = { index: 1, label: 'b44', source: { kind: 'net' as const, ref: 'b44' } }
    expect(channelDisplayName(PWM, net)).toMatchObject({ name: 'D1 陽極（長腳）', sub: 'b44 · 網路', componentId: 'D1' })
    const term = { index: 2, label: 'PS1:+', source: { kind: 'net' as const, ref: 'PS1:+' } }
    expect(channelDisplayName(PWM, term)).toMatchObject({ name: 'PS1 正端', sub: '網路' })
    // the toolbar chips (trigger / decoders) read the same names
    expect(displayLabels(PWM, [pa6, net]).map((c) => c.label)).toEqual(['PA6（板上 A6）', 'D1 陽極（長腳）'])
  })
  it('the scope chip names its probe and net: P1 · U1 PA6', () => {
    expect(scopeProbeNames(PWM).get(0)).toEqual({ id: 'P1', channel: 0, hole: 'c40', net: 'U1 PA6' })
  })
  it('one probe per net: the second is refused with the probe that has it, allowDuplicate places it anyway', async () => {
    expect(findScopeProbe({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })).toEqual({ componentId: 'P1', channel: 1, hole: 'c40' })
    const r = await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })
    expect(r).toMatchObject({ ok: false, existing: { componentId: 'P1', channel: 1 } })
    expect(lastToast()).toBe('這個網路已由 P1 量測（CH1）')
    expect(useStore.getState().layout.components.filter((c) => c.type === 'scope_probe')).toHaveLength(1)
    const again = await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' }, { allowDuplicate: true })
    expect(again).toMatchObject({ ok: true, channel: 2 })
    // the LED anode's net has no probe yet
    expect(findScopeProbe({ kind: 'hole', ref: 'b44' })).toBeNull()
  })
})

describe('IS-14 decoder texts in the UI language', () => {
  it('SPI transfers in 0x hex; a wrong SCK idle level before the first clean transfer is boot noise, later a mode error', () => {
    // CS asserted with SCK high in mode 0 (boot), then a clean transfer, then the mode error again
    const a = spiLines([0x01], [0xff], { mode: 0, idleSck: 1 }, 20e-6)
    const b = spiLines([0x02, 0x80], [0xff, 0xff], { mode: 0 }, 200e-6)
    const c = spiLines([0x04], [0xff], { mode: 0, idleSck: 1 }, 400e-6)
    const merge = (k: 'sck' | 'mosi' | 'miso' | 'cs') => {
      const out = { initial: 1 as 0 | 1 | 2, times: [] as number[], levels: [] as number[] }
      out.initial = a[k]!.initial
      const push = (t: number, v: number) => {
        if ((out.levels.length ? out.levels[out.levels.length - 1] : out.initial) === v) return
        out.times.push(t)
        out.levels.push(v)
      }
      for (const [t, v] of a[k]!.events) push(t, v)
      for (const [t, v] of b[k]!.events) push(t, v)
      // the third transfer: SCK floats high again before CS asserts (a reset)
      if (k === 'sck') push(390e-6, 1)
      for (const [t, v] of c[k]!.events) push(t, v)
      return out
    }
    const trace = (i: number, k: 'sck' | 'mosi' | 'miso' | 'cs') => {
      const m = merge(k)
      return { index: i, label: k, initial: m.initial, times: Float64Array.from(m.times), levels: Uint8Array.from(m.levels), exact: true }
    }
    const cap = capture(0, 600e-6, [trace(0, 'sck'), trace(1, 'mosi'), trace(2, 'miso'), trace(3, 'cs')])
    const run = runDecoder(cap, { id: 'spi1', decoder: 'spi', channels: { sck: 0, mosi: 1, miso: 2, cs: 3 }, options: { mode: '0' } })!
    const frames = decodedFrames([run])
    expect(frames.map((f) => [f.text, f.status, f.note?.kind ?? null])).toEqual([
      ['MOSI 0x01 · MISO 0xFF', 'hint', 'boot-noise'],
      ['MOSI 0x02 0x80 · MISO 0xFF 0xFF', 'ok', null],
      ['MOSI 0x04 · MISO 0xFF', 'error', 'mode-error'],
    ])
    // the lane says it in Chinese; the raw decoder text (exports) keeps the wire format
    const err = [...run.annotations].reverse().find((x) => x.transfer?.modeError)!
    expect(err.text).toMatch(/^SCK idle level ≠ CPOL 0/)
    expect(annotationDisplayText(err)).toBe('SCK 閒置準位 ≠ CPOL 0 · MOSI 0x04 · MISO 0xFF')
    expect(transferText({ bits: 16, mosi: [0x1a5] })).toBe('MOSI 0x01A5')
  })
  it('準位不明 / 不完整字組 instead of the decoders’ English', () => {
    const base = { t0: 0, t1: 1, row: 'x', kind: 'error' as const }
    expect(annotationDisplayText({ ...base, text: 'undefined level' })).toBe('準位不明')
    expect(annotationDisplayText({ ...base, text: 'incomplete word (3 bits)' })).toBe('不完整字組（3 位元）')
    expect(annotationDisplayText({ ...base, text: 'Addr 0x3C W' })).toBe('Addr 0x3C W')
  })
  it('the blocker sentences', () => {
    const p = { title: 'U1 故障' } as Problem
    expect(blockerSentence({ kind: 'power', componentId: 'U1', problem: p }, 'channels')).toBe('U1 沒有供電，所以這些通道沒有訊號')
    expect(blockerSentence({ kind: 'fw-missing', componentId: 'U1', problem: p }, 'port')).toBe('U1 還沒有韌體')
    expect(blockerSentence({ kind: 'halt', componentId: 'U1', problem: p }, 'probe')).toBe('U1 核心已停住（偵錯器）')
    expect(blockerSentence({ kind: 'lockup', componentId: 'U1', problem: p }, 'probe')).toBe('U1 故障')
  })
})

describe('IS-15 the analyzer window', () => {
  const pa6 = { index: 0, label: 'PA6', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA6' } }
  const pa5 = { index: 1, label: 'PA5', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA5' } }
  it('a channel added to the same circuit keeps a marked, frozen window', () => {
    useLab.getState().setLogicChannels([pa6])
    setLaView({ auto: false, span: 0.002, end: 1.5, markers: { a: 1.4995, b: null } })
    useLab.getState().setLogicChannels([pa6, pa5])
    expect(useLaView.getState()).toMatchObject({ auto: false, span: 0.002, end: 1.5, markers: { a: 1.4995, b: null } })
  })
  it('another circuit’s channels and a simulation reset start over: live, auto, no markers', () => {
    useLab.getState().setLogicChannels([pa6])
    setLaView({ auto: false, span: 0.002, end: 182.9, markers: { a: 182.85, b: 182.86 } })
    useLab.getState().setLogicChannels([{ index: 0, label: 'PB6', source: { kind: 'mcu-pin', componentId: 'U9', pin: 'PB6' } }])
    expect(useLaView.getState()).toMatchObject({ auto: true, end: null, markers: { a: null, b: null } })
    setLaView({ auto: false, span: 0.002, end: 3, markers: { a: 2.5, b: null } })
    useStore.setState({ simTime: 3 })
    useStore.setState({ simTime: 0 })
    expect(useLaView.getState()).toMatchObject({ auto: true, end: null, markers: { a: null, b: null } })
  })
})

describe('IS-16 RangeRing', () => {
  it('keeps the voltage extremes of a window (bucket resolution), forgets on clear', () => {
    const r = new RangeRing(1e-3, 8)
    for (let k = 0; k < 100; k++) r.push(k * 1e-4, k % 10 < 3 ? 1.75 : 0)
    expect(r.range(0, 0.0099)).toEqual({ min: 0, max: 1.75 })
    expect(r.range(0.02, 0.03)).toBeNull() // nothing recorded there
    r.push(0.05, NaN) // non-finite samples are ignored
    r.clear()
    expect(r.range(0, 1)).toBeNull()
  })
})

describe('IS-19 meter readings', () => {
  it('the multimeter’s display and mode; a supply without load reads its voltage', () => {
    const dmm = { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }
    const r = meterReading(dmm, getEntry('multimeter')!, { text: ['5.000 V', 'DC V'] } as never)
    expect(r).toEqual({ value: '5.000 V', sub: '直流電壓（IN − COM）' })
    expect(meterReading(dmm, getEntry('multimeter')!, undefined).value).toBeNull()
    const ps = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }
    const idle = meterReading(ps, getEntry('power_supply')!, { current: 1e-12, pinVoltages: { '+': 5, '-': 0 } } as never)
    expect(idle.value).toBe('5.00 V')
  })
})
