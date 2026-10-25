/**
 * Release polish (instruments / state) — stale analyzer channels after an
 * example replaces the circuit (src/state/lab.ts logicSourcePresent).
 *
 * The rule, as implemented:
 *  1. loading a file (example, lesson circuit, imported project) replaces the
 *     analyzer setup with the file's own; a REPLACED circuit keeps an earlier
 *     channel only while its source still exists WITH THE SAME MEANING — an
 *     'mcu-pin' channel needs a microcontroller board of that id that has the
 *     pin as a GPIO (opening lm7805-regulator after i2c-scan must not keep
 *     「PB6 SCL」 / 「PB7 SDA」 on U1, which is now the LM7805);
 *  2. editing the circuit (delete, move, undo) never drops a channel: a
 *     deleted board's channel stays, marked as a missing source.
 * The analyzer, the 量測 tab (both list lab.logicChannels) and the tray's
 * choice read the same test, so they agree.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import type { LogicChannelConfig, SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'

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

/** A host that answers nothing (the lab store only needs one to exist). */
class SilentHost implements SimHost {
  readonly kind = 'inline' as const
  constructor(readonly cb: SimHostCallbacks) {}
  emit(p: Partial<SimFrame> & { time: number }): void {
    this.cb.onFrame({
      rev: 0,
      running: true,
      telemetry: { time: p.time, netVoltages: {}, components: {}, issues: [] },
      scope: [],
      uart: [],
      mcus: [],
      log: [],
      issues: [],
      perf: { realtimeFactor: 1, stepsPerSecond: 1, busyMs: 1 },
      ...p,
    })
  }
  load(): void {}
  setFirmware(): void {}
  start(): void {}
  pause(): void {}
  reset(): void {}
  setSpeed(): void {}
  stepTime(): void {}
  mcuReset(): void {}
  mcuHalt(): void {}
  mcuResume(): void {}
  mcuStep(): void {}
  setRuntimeParam(): void {}
  uartSend(): void {}
  setLogicChannels(): void {}
  query(): Promise<never> {
    return Promise.reject(new Error('no answers'))
  }
  dispose(): void {}
}

const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }
const example = (id: string) => readFileSync(`examples/embedded/${id}.ohmlet.json`, 'utf8')
const layoutOf = (id: string): CircuitLayout => (JSON.parse(example(id)) as { layout: CircuitLayout }).layout
const pinCh = (index: number, componentId: string, pin: string, label = pin): LogicChannelConfig => ({ index, label, source: { kind: 'mcu-pin', componentId, pin } })

describe('logicSourcePresent: the source exists with the same meaning', () => {
  const i2c = layoutOf('i2c-scan')
  const lm = layoutOf('lm7805-regulator')

  it('an MCU-pin channel needs a microcontroller board of that id with that GPIO pin', () => {
    expect(L.logicSourcePresent(i2c, pinCh(0, 'U1', 'PB6'))).toBe(true)
    // lm7805-regulator's U1 is the LM7805: same id, no PB6
    expect(lm.components.find((c) => c.id === 'U1')?.type).toBe('lm7805')
    expect(L.logicSourcePresent(lm, pinCh(0, 'U1', 'PB6'))).toBe(false)
    expect(L.logicSourcePresent(lm, pinCh(1, 'U1', 'PB7'))).toBe(false)
    // a Blue Pill's power pins are not GPIO channels (they are measured as nets)
    expect(L.logicSourcePresent(i2c, pinCh(0, 'U1', '3V3_1'))).toBe(false)
    expect(L.logicSourcePresent(i2c, pinCh(0, 'U1', 'GND1'))).toBe(false)
    expect(L.logicSourcePresent(i2c, pinCh(0, 'U1', 'PZ9'))).toBe(false)
    expect(L.logicSourcePresent(i2c, pinCh(0, 'U9', 'PB6'))).toBe(false)
  })

  it('a probe channel needs a logic probe of that id; a terminal net needs a part with that terminal', () => {
    const withProbe: CircuitLayout = { ...lm, components: [...lm.components, { id: 'LP1', type: 'logic_probe', holes: ['a30'] }] }
    expect(L.logicSourcePresent(withProbe, { index: 0, label: 'LP1', source: { kind: 'probe', componentId: 'LP1' } })).toBe(true)
    expect(L.logicSourcePresent(lm, { index: 0, label: 'C1', source: { kind: 'probe', componentId: 'C1' } })).toBe(false)
    const net = (ref: string): LogicChannelConfig => ({ index: 0, label: ref, source: { kind: 'net', ref } })
    expect(L.logicSourcePresent(lm, net('a25'))).toBe(true)
    expect(L.logicSourcePresent(lm, net('BAT1:+'))).toBe(true)
    expect(L.logicSourcePresent(lm, net('DMM1:COM'))).toBe(true)
    expect(L.logicSourcePresent(lm, net('PS1:+'))).toBe(false)
    expect(L.logicSourcePresent(lm, net('U1:PB6'))).toBe(false)
    expect(L.logicSourcePresent(i2c, net('PS1:+'))).toBe(true)
  })

  it('the tray reads the same test: a stale MCU-pin channel does not keep the analyzer as the circuit’s tab', () => {
    expect(L.trayTabFor(lm, [pinCh(0, 'U1', 'PB6')])).toBe('measure')
    expect(L.trayTabFor(i2c, [pinCh(0, 'U1', 'PB6')])).toBe('logic')
  })
})

describe('the analyzer setup when the circuit changes', () => {
  const lab = () => L.useLab.getState()
  const st = () => S.useStore.getState()
  let storage: MemoryStorage

  async function boot(layout: CircuitLayout): Promise<void> {
    st().resetSim()
    S.__resetHistoryForTests()
    S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
    await L.__rebootLabForTests()
  }

  beforeEach(async () => {
    storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage, matchMedia: (q: string) => ({ matches: true, media: q }), innerHeight: 900 })
    __setFirmwareBlobStoreForTests({ ...createMemoryBlobStore(), persistent: true })
    S.__setSimHostFactoryForTests((cb) => new SilentHost(cb))
    await boot(EMPTY)
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('opening lm7805-regulator after i2c-scan drops 「PB6 SCL」 / 「PB7 SDA」 and their I²C decoder (analyzer and 量測 alike)', async () => {
    expect((await lab().importProject(example('i2c-scan'))).ok).toBe(true)
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PB6 SCL', 'PB7 SDA'])
    expect(lab().logicView.decoders.map((d) => d.decoder)).toEqual(['i2c'])
    expect((await lab().importProject(example('lm7805-regulator'))).ok).toBe(true)
    expect(st().layout.components.find((c) => c.id === 'U1')?.type).toBe('lm7805')
    expect(lab().logicChannels).toEqual([])
    expect(lab().logicView.decoders).toEqual([])
  })

  it('an example with its own channels replaces the setup with them (i2c-scan → uart-hello → blink)', async () => {
    await lab().importProject(example('i2c-scan'))
    await lab().importProject(example('uart-hello'))
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PA9 TX', 'PA10 RX'])
    expect(lab().logicView.decoders.map((d) => d.decoder)).toEqual(['uart', 'uart'])
    await lab().importProject(example('blink'))
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PA5 LED', 'PC13 板載 LED'])
  })

  it('editing never drops a channel: delete the board → kept (source missing), undo → present again', async () => {
    await lab().importProject(example('blink'))
    const before = lab().logicChannels
    expect(before.map((c) => L.logicSourcePresent(st().layout, c))).toEqual([true, true])
    S.useStore.setState({ selection: ['U1'] })
    st().removeSelected()
    expect(lab().logicChannels).toEqual(before)
    expect(lab().logicChannels.map((c) => L.logicSourcePresent(st().layout, c))).toEqual([false, false])
    st().undo()
    expect(lab().logicChannels).toEqual(before)
    expect(lab().logicChannels.map((c) => L.logicSourcePresent(st().layout, c))).toEqual([true, true])
  })

  it('a lone board moved (every component object is new) keeps its channels: the source still exists', async () => {
    const lone: CircuitLayout = { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }
    await boot(lone)
    lab().setLogicChannels([pinCh(0, 'U1', 'PA5', 'PA5 LED')])
    // the whole layout replaced by an edited copy (no component object shared)
    st().loadLayout({ ...lone, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h12' }] })
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PA5 LED'])
  })
})
