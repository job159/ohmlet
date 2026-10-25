/**
 * Read-only end-to-end hooks (src/dev/e2e-hooks.ts, `window.__e2e`, loaded
 * only with `?e2e`): the passive frame recorder (LED brightness incl. board
 * sub-circuit LEDs, pushbutton echo, MCU state / PC / cycles, current vs
 * stale revisions), state snapshots, UART transcripts and the geometry used
 * to aim real clicks — and that reading them never changes the document.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout, ParamValue } from '../src/model/types'
import type { FirmwareImage } from '../src/mcu/firmware'
import type {
  HostQuery,
  HostQueryResult,
  LogicChannelConfig,
  SimFrame,
  SimHost,
  SimHostCallbacks,
} from '../src/sim/coordinator/api'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { holePosition, offboardSlotSpan, offboardTerminalPosition, parseHole } from '../src/model/breadboard'
import { CATALOG } from '../src/model/catalog'
import { TERMINAL_TOP_Y } from '../src/three/internal/wires'
import type { E2eHooks } from '../src/dev/e2e-hooks'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'

const LAYOUT: CircuitLayout = {
  version: 1,
  name: 'e2e',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['b33', 'b37'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['e37', 'f37'] },
  ],
  wires: [{ id: 'W1', from: 'PS1:+', to: 'bot+0', color: 'red' }],
}

class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  lastRev = 0
  constructor(readonly cb: SimHostCallbacks) {}
  emit(p: Partial<SimFrame>, rev = this.lastRev): void {
    this.cb.onFrame({
      rev,
      time: 0,
      running: true,
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

describe('window.__e2e (read-only test hooks)', () => {
  const win: { __e2e?: E2eHooks } & Record<string, unknown> = {}
  let hooks: E2eHooks
  let host: FakeHost | null = null

  beforeAll(async () => {
    const store = new Map<string, string>()
    Object.assign(win, {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
      },
      matchMedia: (q: string) => ({ matches: false, media: q }),
    })
    vi.stubGlobal('window', win)
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    S.__setSimHostFactoryForTests((cb) => (host = new FakeHost(cb)))
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    S.useStore.getState().resetSim()
    S.__resetHistoryForTests()
    S.useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
    await L.__rebootLabForTests()
    await import('../src/dev/e2e-hooks')
    hooks = win.__e2e as E2eHooks
  })

  afterAll(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('installs itself on window and resolves ready() after the lab boot', async () => {
    expect(hooks.version).toBe(1)
    await expect(hooks.ready()).resolves.toBe(true)
    expect(hooks.lastFrame()).toBeNull()
  })

  it('records frames passively: LEDs (incl. board sub-LEDs), buttons, MCU state; stale revisions flagged', () => {
    S.getSimHost()
    const h = host as FakeHost
    const t0 = hooks.now()
    h.emit({
      time: 0.5,
      telemetry: {
        time: 0.5,
        netVoltages: {},
        issues: [],
        components: {
          LED1: { pinVoltages: {}, ledBrightness: 0.8, current: 0.008 },
          U1: { pinVoltages: { PB12: 3.3 }, sub: { LED_PC13: { pinVoltages: {}, ledBrightness: 0.2 } } },
          SW1: { pinVoltages: {}, pressed: true },
        },
      },
      mcus: [
        { componentId: 'U1', state: 'running', firmware: 'x.elf', pc: 0x08000123, hclkHz: 72e6, cycles: 1000, realtime: 0.5, uarts: [] },
      ],
      serialPorts: [{ componentId: 'CH1', name: 'COM', config: { enabled: true, baud: 9600, dataBits: 8, parity: 'none', stopBits: 1 } }],
    })
    // an edit loads a new document revision: a frame computed for the old one is stale
    const oldRev = h.lastRev
    S.useStore.getState().setParam('R1', 'resistance', 470)
    expect(h.lastRev).toBeGreaterThan(oldRev)
    h.emit({ time: 0.4 }, oldRev)
    const frames = hooks.frames(t0)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({
      time: 0.5,
      running: true,
      current: true,
      leds: { LED1: 0.8, 'U1/LED_PC13': 0.2 },
      pressed: { SW1: true },
      mcus: [{ id: 'U1', state: 'running', pc: 0x08000123, cycles: 1000, firmware: 'x.elf' }],
    })
    expect(frames[1].current).toBe(false)
    // component() answers from the newest CURRENT frame only
    expect(hooks.component('LED1')?.ledBrightness).toBe(0.8)
    const lf = hooks.lastFrame()
    expect(lf?.time).toBe(0.4)
    expect(hooks.frames(hooks.now() + 1)).toEqual([])
  })

  it('records the achieved realtime factor of every frame (the acceptance report prints it per step and run)', () => {
    S.getSimHost()
    const h = host as FakeHost
    const t0 = hooks.now()
    h.emit({ time: 0.6, perf: { realtimeFactor: 0.37, stepsPerSecond: 1200, busyMs: 990 } })
    h.emit({ time: 0.61, perf: { realtimeFactor: 0.006, stepsPerSecond: 20, busyMs: 920 } })
    const frames = hooks.frames(t0)
    expect(frames.map((f) => f.rt)).toEqual([0.37, 0.006])
    // the frame summary keeps exposing the whole perf block
    expect(hooks.lastFrame()?.perf).toEqual({ realtimeFactor: 0.006, stepsPerSecond: 20, busyMs: 920 })
  })

  it('snapshots state and UART text without touching the document', () => {
    const layoutBefore = S.useStore.getState().layout
    const st = hooks.state()
    expect(st.layout).toBe(layoutBefore)
    expect(st).toMatchObject({ running: expect.any(Boolean), firmware: {}, lang: expect.any(String) })
    expect(hooks.uart('U1', 'USART1')).toBe('')
    expect(hooks.uartPorts()).toEqual([])
    expect(S.useStore.getState().layout).toBe(layoutBefore)
  })

  it('maps holes, off-board terminals and parts to world points', () => {
    const p = holePosition(parseHole('j27')!)
    expect(hooks.endpointWorld('j27')).toEqual({ x: p.x, y: 0, z: p.z })
    const term = hooks.endpointWorld('PS1:+')
    // the PSU is the only off-board part: shelf slot 0, pin '+' — where the scene attaches wires
    const t = offboardTerminalPosition(0, 0, undefined)
    expect(term).toEqual({ x: t.x, y: TERMINAL_TOP_Y, z: t.z })
    expect(hooks.endpointWorld('PS1:nope')).toBeNull()
    expect(hooks.endpointWorld('XX:+')).toBeNull()
    const led = hooks.componentWorld('LED1', 1)
    const a = holePosition(parseHole('e37')!)
    const b = holePosition(parseHole('f37')!)
    expect(led).toEqual({ x: (a.x + b.x) / 2, y: 1, z: (a.z + b.z) / 2 })
    expect(hooks.componentWorld('PS1')).toBeNull() // off-board
    expect(hooks.label('stm32_bluepill')).toBeTruthy()
    expect(hooks.label('no_such_part')).toBeNull()
  })

  it('aims motor / driver terminals at their real terminal row, after a deep unit on the default shelf', () => {
    const before = S.useStore.getState().layout
    const bench: CircuitLayout = {
      version: 1,
      name: 'e2e bench',
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 7.5 } }, // legacy unit: slot 0, span 1
        { id: 'D2', type: 'l298n_module' }, // 7 deep: slot 1, span 1.5
        { id: 'M1', type: 'dc_motor' }, // slot 2.5 (after the deep unit)
        { id: 'D1', type: 'uln2003_board', pos: { x: -40, z: 30 } }, // explicit bench position
      ],
      wires: [],
    }
    S.useStore.setState({ layout: bench })
    try {
      const l298n = CATALOG.l298n_module
      const motor = CATALOG.dc_motor
      const uln = CATALOG.uln2003_board
      expect(offboardSlotSpan(CATALOG.power_supply.offboard)).toBe(1)
      expect(offboardSlotSpan(l298n.offboard)).toBe(1.5)
      // every terminal sits exactly where the scene attaches wires
      const at = (slot: number, e: typeof l298n, pin: string, pos?: { x: number; z: number }) => {
        const p = offboardTerminalPosition(slot, e.pins.indexOf(pin), pos, e.offboard)
        return { x: p.x, y: TERMINAL_TOP_Y, z: p.z }
      }
      expect(hooks.endpointWorld('PS1:-')).toEqual(at(0, CATALOG.power_supply, '-'))
      expect(hooks.endpointWorld('D2:OUT1')).toEqual(at(1, l298n, 'OUT1'))
      expect(hooks.endpointWorld('D2:ENB')).toEqual(at(1, l298n, 'ENB'))
      expect(hooks.endpointWorld('M1:M-')).toEqual(at(2.5, motor, 'M-'))
      expect(hooks.endpointWorld('D1:IN3')).toEqual(at(0, uln, 'IN3', { x: -40, z: 30 }))
      // the L298N's 0.6 pitch: neighbouring terminals are 0.6 apart, not the legacy 2.5
      const a = hooks.endpointWorld('D2:IN1')!
      const b = hooks.endpointWorld('D2:IN2')!
      expect(b.x - a.x).toBeCloseTo(0.6, 9)
      expect(b.z).toBe(a.z)
      // and never the legacy formula (slot = index, pitch 2.5) the hook used to apply
      const legacyM1 = offboardTerminalPosition(2, motor.pins.indexOf('M-'), undefined)
      expect(hooks.endpointWorld('M1:M-')).not.toEqual({ x: legacyM1.x, y: TERMINAL_TOP_Y, z: legacyM1.z })
    } finally {
      S.useStore.setState({ layout: before })
    }
  })
})
