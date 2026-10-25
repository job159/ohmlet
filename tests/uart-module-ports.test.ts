/**
 * UART terminal: module serial ports (CH340 'COM' = the PC's virtual COM
 * port, HC-05 'BT' = the paired phone) are listed from SimFrame.serialPorts
 * BEFORE any byte arrives, with the line settings the module uses on its
 * pins and zh-TW names.
 *
 *  - the REAL coordinator publishes both ports (and their settings) in the
 *    first frame after load(), with nothing transmitted yet;
 *  - the lab store mirrors them into `serialPorts` (fed by a scripted host:
 *    only current frames count, identical lists never re-render, a disposed
 *    host clears them);
 *  - terminalPorts() / terminalPortLabel() (what the terminal's port picker
 *    renders) order them and name them in Chinese.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout, ParamValue } from '../src/model/types'
import type { FirmwareImage } from '../src/mcu/firmware'
import type {
  HostQuery,
  HostQueryResult,
  LogicChannelConfig,
  McuFrameInfo,
  SerialPortInfo,
  SimFrame,
  SimHost,
  SimHostCallbacks,
} from '../src/sim/coordinator/api'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { fmtUartConfig, terminalPortLabel, terminalPorts } from '../src/ui/embedded/UartTerminal'
import { __setLangForTests } from '../src/i18n'
import '../src/mcu/all'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'

// CH340 at a35 (GND a35 … DTR a40), HC-05 at e50 (STATE e50 … EN e55), a Blue Pill at h10
const LAYOUT: CircuitLayout = {
  version: 1,
  name: 'module ports',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'CH1', type: 'usb_uart_ch340', at: 'a35', params: { baud: '9600', parity: 'even' } },
    { id: 'BT1', type: 'hc05_bt', at: 'e50' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

const cfg = (baud: number, parity: 'none' | 'even' | 'odd' = 'none', enabled = true): SerialPortInfo['config'] => ({
  enabled,
  baud,
  dataBits: 8,
  parity,
  stopBits: 1,
})

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

/** A scripted SimHost: records nothing, emits the frames a test hands it. */
class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  lastRev = 0
  constructor(readonly cb: SimHostCallbacks) {}
  emit(p: Partial<SimFrame>, rev = this.lastRev): void {
    this.cb.onFrame({
      rev,
      time: 0,
      running: false,
      telemetry: { time: 0, netVoltages: {}, components: {}, issues: [] },
      scope: [],
      uart: [],
      mcus: [],
      log: [],
      issues: [],
      perf: { realtimeFactor: 1, stepsPerSecond: 1, busyMs: 1 },
      ...p,
    })
  }
  load(_layout: CircuitLayout, rev: number): void {
    this.lastRev = rev
  }
  setFirmware(_componentId: string, _image: FirmwareImage | null): void {}
  start(_speed: number): void {}
  pause(): void {}
  reset(): void {}
  setSpeed(_s: number): void {}
  stepTime(_s: number): void {}
  mcuReset(_id: string): void {}
  mcuHalt(_id: string): void {}
  mcuResume(_id: string): void {}
  mcuStep(_id: string): void {}
  setRuntimeParam(_id: string, _key: string, _value: ParamValue): void {}
  uartSend(_componentId: string, _port: string, _bytes: Uint8Array): void {}
  setLogicChannels(_channels: LogicChannelConfig[]): void {}
  query(_q: HostQuery): Promise<HostQueryResult> {
    return Promise.reject(new Error('no answer scripted'))
  }
  dispose(): void {}
}

describe('coordinator: module ports are in the first frame, before any byte', () => {
  it('lists CH340 COM (the PC-side port settings) and HC-05 BT with their line settings', () => {
    const co = new SimulationCoordinator()
    co.load(LAYOUT, 1)
    const f = co.frame(false)
    expect(f.uart.every((u) => u.bytes.length === 0)).toBe(true)
    const ports = f.serialPorts ?? []
    expect(ports.map((p) => `${p.componentId}/${p.name}`)).toEqual(['CH1/COM', 'BT1/BT'])
    // the CH340's COM side as the PC opened it (params): 8 data bits + even
    // parity = a 9-bit WORD (UartLineConfig counts like USART_CR1.M)
    expect(ports[0].config).toEqual({ enabled: true, baud: 9600, dataBits: 9, parity: 'even', stopBits: 1 })
    expect(fmtUartConfig(ports[0].config)).toBe('9600 8E1')
    // the HC-05's stored UART setting (datasheet default 9600 8N1); the BT
    // side is enabled only while the module bridges data (powered, data mode)
    expect(ports[1].config).toMatchObject({ baud: 9600, dataBits: 8, parity: 'none', stopBits: 1 })
    expect(fmtUartConfig(ports[1].config)).toBe(ports[1].config.enabled ? '9600 8N1' : 'disabled')
    co.dispose()
  })
})

describe('lab store + terminal: module serial ports', () => {
  const lab = () => L.useLab.getState()
  let hosts: FakeHost[]
  const host = (): FakeHost => hosts[hosts.length - 1]

  beforeAll(() => __setLangForTests('zh-TW'))
  afterAll(() => __setLangForTests('zh-TW'))

  beforeEach(async () => {
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      matchMedia: (q: string) => ({ matches: false, media: q }),
    })
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    hosts = []
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    S.useStore.getState().resetSim()
    S.__resetHistoryForTests()
    S.useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
    await L.__rebootLabForTests()
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  const PORTS: SerialPortInfo[] = [
    { componentId: 'CH1', name: 'COM', config: cfg(9600, 'even') },
    { componentId: 'BT1', name: 'BT', config: cfg(9600) },
  ]

  it('mirrors SimFrame.serialPorts of current frames; identical lists keep the same state', () => {
    expect(lab().serialPorts).toEqual([])
    S.getSimHost()
    // a frame of an older document revision does not describe the current world
    host().emit({ serialPorts: PORTS }, host().lastRev - 1)
    expect(lab().serialPorts).toEqual([])
    host().emit({ serialPorts: PORTS })
    expect(lab().serialPorts).toEqual(PORTS)
    const first = lab().serialPorts
    // every frame carries a fresh array: an equal list must not re-render the terminal
    host().emit({ serialPorts: PORTS.map((p) => ({ ...p, config: { ...p.config } })) })
    expect(lab().serialPorts).toBe(first)
    // a changed setting (the COM port re-opened at 115200) is pushed
    host().emit({ serialPorts: [{ ...PORTS[0], config: cfg(115200) }, PORTS[1]] })
    expect(lab().serialPorts[0].config.baud).toBe(115200)
    // a world without modules: the field is absent → no ports
    host().emit({})
    expect(lab().serialPorts).toEqual([])
  })

  it('a disposed host clears the ports', () => {
    S.getSimHost()
    host().emit({ serialPorts: PORTS })
    expect(lab().serialPorts).toHaveLength(2)
    // replacing the factory disposes the live host ('disposed' event)
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    expect(lab().serialPorts).toEqual([])
  })

  it('terminalPorts(): MCU USARTs first, then module ports, then other ports with data; zh-TW names', () => {
    const mcus: Record<string, McuFrameInfo> = {
      U1: {
        componentId: 'U1',
        state: 'running',
        firmware: 'x.elf',
        pc: 0x08000000,
        hclkHz: 72e6,
        cycles: 1,
        realtime: 1,
        uarts: [{ name: 'USART1', config: cfg(115200) }],
      },
    }
    const ports = terminalPorts(LAYOUT.components, mcus, PORTS, [
      { componentId: 'BT1', port: 'BT' }, // already listed
      { componentId: 'X9', port: 'COM' }, // a module that left the world, its bytes still buffered
    ])
    expect(ports.map((p) => `${p.componentId}/${p.port}:${p.kind}`)).toEqual([
      'U1/USART1:mcu',
      'U1/USART2:mcu',
      'U1/USART3:mcu',
      'CH1/COM:module',
      'BT1/BT:module',
      'X9/COM:data',
    ])
    expect(ports[0].config?.baud).toBe(115200)
    expect(ports[1].config).toBeUndefined()
    expect(ports[3].config).toEqual(cfg(9600, 'even'))
    expect(ports.map(terminalPortLabel)).toEqual([
      'U1 · USART1',
      'U1 · USART2',
      'U1 · USART3',
      'CH1 · COM 埠（USB 轉 TTL）',
      'BT1 · 藍牙（已配對手機）',
      'X9 · COM 埠（USB 轉 TTL）',
    ])
  })
})
