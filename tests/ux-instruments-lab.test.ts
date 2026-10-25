/**
 * UX wave — instruments workstream, the lab-store side:
 *  - IS-3: lab.logicView is the single source of truth — the one-time
 *    migration of the analyzer's former localStorage keys, example envelopes
 *    (i2c-scan, uart-hello) that bring their decoders, save → open round
 *    trips, channels replaced without decoders reset the old decoders;
 *  - IS-5: the tray follows the circuit (collapsed on an empty board, open
 *    with an MCU / probe, collapsed again when a circuit without one
 *    replaces it, never after the user toggled it);
 *  - IS-8: stale channels are pruned when a circuit is replaced (kept, and
 *    shown as stale, when the board is deleted inside the same circuit);
 *    received UART chunks carry their frame's time window; firmware loads
 *    and MCU resets leave terminal marks (or clear the transcript);
 *  - IS-2: the scope preset of a project (instruments.scope) or the request
 *    for an automatic setup;
 *  - IS-4: a second scope probe from the store lands on CH2.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import type { SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
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

/** A host that records nothing and answers nothing, but can emit frames. */
class EmitHost implements SimHost {
  readonly kind = 'inline' as const
  rev = 0
  constructor(readonly cb: SimHostCallbacks) {}
  emit(p: Partial<SimFrame> & { time: number }): void {
    this.cb.onFrame({
      rev: this.rev,
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
  load(_l: CircuitLayout, rev: number): void {
    this.rev = rev
  }
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
const BOARD: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
  ],
  wires: [],
}
const ANALOG: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS2', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R9', type: 'resistor', holes: ['a50', 'a54'], params: { resistance: 1000 } },
  ],
  wires: [],
}
const PA5 = { index: 0, label: 'PA5', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA5' } }
const UART_DEC = { id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } }

describe('UX instruments — lab store', () => {
  const lab = () => L.useLab.getState()
  const st = () => S.useStore.getState()
  let storage: MemoryStorage
  let host: EmitHost | null = null

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
    S.__setSimHostFactoryForTests((cb) => (host = new EmitHost(cb)))
    await boot(EMPTY)
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
    host = null
  })

  // ------------------------------------------------------------- IS-3

  it('migrates the former bb.logicDecoders / bb.logicTrigger once, into an empty logicView, and removes them', async () => {
    storage.setItem(L.LS_LOGIC_VIEW, JSON.stringify({ v: 1, decoders: [], trigger: null }))
    storage.setItem('bb.logicDecoders', JSON.stringify({ v: 1, decoders: [UART_DEC] }))
    storage.setItem('bb.logicTrigger', JSON.stringify({ v: 1, kind: 'edge', channel: 0, slope: 'rising', pattern: {}, pre: 0.25 }))
    await L.__rebootLabForTests()
    expect(lab().logicView.decoders).toEqual([UART_DEC])
    expect(lab().logicView.trigger).toMatchObject({ slope: 'rising', pre: 0.25 })
    expect(storage.getItem('bb.logicDecoders')).toBeNull()
    expect(storage.getItem('bb.logicTrigger')).toBeNull()
    expect(JSON.parse(storage.getItem(L.LS_LOGIC_VIEW) as string).decoders).toEqual([UART_DEC])
  })

  it('a logicView with decoders wins over a stale legacy key (which is still removed)', async () => {
    const I2C = { id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 } }
    storage.setItem(L.LS_LOGIC_VIEW, JSON.stringify({ v: 1, decoders: [I2C], trigger: null }))
    storage.setItem('bb.logicDecoders', JSON.stringify({ v: 1, decoders: [UART_DEC] }))
    await L.__rebootLabForTests()
    expect(lab().logicView.decoders).toEqual([I2C])
    expect(storage.getItem('bb.logicDecoders')).toBeNull()
  })

  it('example envelopes bring their decoders: i2c-scan (I²C), uart-hello (two UARTs at 115200)', async () => {
    const i2c = readFileSync('examples/embedded/i2c-scan.ohmlet.json', 'utf8')
    expect((await lab().importProject(i2c)).ok).toBe(true)
    expect(lab().logicView.decoders.map((d) => d.decoder)).toEqual(['i2c'])
    const uart = readFileSync('examples/embedded/uart-hello.ohmlet.json', 'utf8')
    expect((await lab().importProject(uart)).ok).toBe(true)
    expect(lab().logicView.decoders).toHaveLength(2)
    expect(lab().logicView.decoders.every((d) => d.decoder === 'uart' && (d.options as { baud: string }).baud === '115200')).toBe(true)
    // save → open round trip keeps them
    const text = await lab().exportProject()
    lab().setLogicView({ decoders: [] })
    expect((await lab().importProject(text)).ok).toBe(true)
    expect(lab().logicView.decoders).toHaveLength(2)
  })

  it('a project that replaces the channels without decoders drops the old decoders (they would read garbage)', async () => {
    const i2c = readFileSync('examples/embedded/i2c-scan.ohmlet.json', 'utf8')
    await lab().importProject(i2c)
    expect(lab().logicView.decoders).toHaveLength(1)
    const blink = readFileSync('examples/embedded/blink.ohmlet.json', 'utf8')
    await lab().importProject(blink)
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PA5 LED', 'PC13 板載 LED'])
    expect(lab().logicView.decoders).toEqual([])
  })

  // ------------------------------------------------------------- IS-5

  it('the tray follows the circuit: collapsed when empty, open on the UART once the firmware enables a USART, collapsed when an analog circuit replaces it', async () => {
    expect(lab().workspace.tray.open).toBe(false)
    expect(L.trayTabFor(EMPTY, [])).toBeNull()
    // IS-20: a board just placed has nothing to print — no empty terminal pops up …
    st().loadLayout(BOARD)
    expect(lab().workspace.tray.open).toBe(false)
    expect(L.trayTabFor(BOARD, [])).toBeNull()
    // … until its firmware enables a USART
    const uart = { name: 'USART1', config: { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const } }
    L.useLab.setState({ mcus: { U1: { componentId: 'U1', state: 'running', firmware: 'x.elf', pc: 0, hclkHz: 8e6, cycles: 0, realtime: 1, uarts: [uart] } } })
    expect(lab().workspace.tray).toMatchObject({ open: true, tab: 'uart' })
    expect(L.trayTabFor(BOARD, [], true)).toBe('uart')
    L.useLab.setState({ mcus: {} })
    st().loadLayout(ANALOG)
    expect(lab().workspace.tray.open).toBe(false)
    // a page load with a circuit to measure opens the tray, whatever an earlier session stored
    st().loadLayout({ ...ANALOG, components: [...ANALOG.components, { id: 'P1', type: 'scope_probe', holes: ['c50'], params: { channel: 1 } }] })
    storage.setItem('bb.workspace', JSON.stringify({ v: 1, tray: { open: false, height: 300 } }))
    await L.__rebootLabForTests()
    expect(lab().workspace.tray).toMatchObject({ open: true, height: 300, tab: 'scope' })
  })

  it('IS-19: a bench with a multimeter and no microcontroller opens on 量測', () => {
    const bench: CircuitLayout = { ...ANALOG, components: [...ANALOG.components, { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }] }
    expect(L.trayTabFor(bench, [])).toBe('measure')
    expect(L.trayTabFor({ ...bench, components: [...bench.components, ...BOARD.components.filter((c) => c.id === 'U1')] }, [])).toBeNull()
    st().loadLayout(bench)
    expect(lab().workspace.tray).toMatchObject({ open: true, tab: 'measure' })
  })

  it('logic channels pick the logic tab; the user toggling the tray stops the automatic changes', async () => {
    expect(L.trayTabFor(BOARD, [PA5])).toBe('logic')
    L.noteTrayToggledByUser()
    st().loadLayout(BOARD)
    expect(lab().workspace.tray.open).toBe(false)
  })

  // ------------------------------------------------------------- IS-8

  it('stale channels: pruned when the circuit is replaced, kept (as stale) when the board is deleted', async () => {
    await boot(BOARD)
    lab().setLogicChannels([PA5])
    lab().setLogicView({ decoders: [UART_DEC] })
    // delete U1 inside the same circuit → the channel stays, its source is gone
    S.useStore.setState({ selection: ['U1'] })
    st().removeSelected()
    expect(lab().logicChannels).toHaveLength(1)
    expect(L.logicSourcePresent(st().layout, lab().logicChannels[0])).toBe(false)
    // a lesson / example replaces the circuit → pruned, with the decoder that only read it
    st().loadLayout(ANALOG)
    expect(lab().logicChannels).toEqual([])
    expect(lab().logicView.decoders).toEqual([])
  })

  it('UART chunks carry the time window of their frame; resets and loads leave marks', async () => {
    await boot(BOARD)
    st().startSim()
    expect(host).not.toBeNull()
    host!.emit({ time: 0.016, uart: [{ componentId: 'U1', port: 'USART1', bytes: [72, 105, 13, 10] }] })
    host!.emit({ time: 0.032, uart: [] })
    host!.emit({ time: 1.008, uart: [{ componentId: 'U1', port: 'USART1', bytes: [116, 10] }] })
    const chunks = L.labBuffers.uartChunks('U1', 'USART1')
    expect(chunks).toEqual([
      { at: 0, n: 4, t0: 0, t1: 0.016 },
      { at: 4, n: 2, t0: 0.032, t1: 1.008 },
    ])
    lab().mcuReset('U1')
    const marks = L.labBuffers.terminalMarks()
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ componentId: 'U1', kind: 'reset', offsets: { USART1: 6 } })
    // clear on load: a firmware load empties the board's transcript
    lab().setTerminal({ clearOnLoad: true })
    const fw = readFileSync('firmware/dist/hal-blink.elf')
    expect((await lab().loadFirmware('U1', { name: 'hal-blink.elf', bytes: new Uint8Array(fw) })).ok).toBe(true)
    expect(L.labBuffers.uartBytes('U1', 'USART1')).toHaveLength(0)
    expect(L.labBuffers.uartFirstOffset('U1', 'USART1')).toBe(6)
    const load = L.labBuffers.terminalMarks().at(-1)!
    expect(load).toMatchObject({ kind: 'load', name: 'hal-blink.elf', offsets: { USART1: 6 } })
    expect(load.sha).toMatch(/^[0-9a-f]{8}$/)
  })

  it('the shared cursor accepts a time or null', () => {
    lab().setLabCursor(1.25)
    expect(lab().labCursor.t).toBe(1.25)
    lab().setLabCursor(Number.NaN)
    expect(lab().labCursor.t).toBeNull()
  })

  // ------------------------------------------------------------- IS-2

  it('a project scope preset reaches lab.scopePreset; probes without one ask for an automatic setup', async () => {
    const pwm = JSON.parse(readFileSync('examples/embedded/pwm-fade.ohmlet.json', 'utf8'))
    expect((await lab().importProject(JSON.stringify(pwm))).ok).toBe(true)
    expect(lab().scopePreset).toMatchObject({ settings: {} }) // scope_probe P1, no preset in the envelope
    pwm.instruments.scope = { tdiv: 0.0005, trigSource: 0, trigSlope: 'rising', bad: { x: 1 } }
    const seq = lab().scopePreset!.seq
    expect((await lab().importProject(JSON.stringify(pwm))).ok).toBe(true)
    expect(lab().scopePreset).toEqual({ seq: seq + 1, settings: { tdiv: 0.0005, trigSource: 0, trigSlope: 'rising' } })
  })

  // ------------------------------------------------------------- IS-4

  it('the store gives a new scope probe the lowest free channel (one undo step)', async () => {
    await boot(BOARD)
    st().addComponent('scope_probe', { holes: ['c40'] })
    st().addComponent('scope_probe', { holes: ['c41'] })
    const probes = st().layout.components.filter((c) => c.type === 'scope_probe')
    expect(probes.map((p) => p.params?.channel ?? 1)).toEqual([1, 2])
    st().undo()
    expect(st().layout.components.filter((c) => c.type === 'scope_probe')).toHaveLength(1)
  })
})
