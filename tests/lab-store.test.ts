/**
 * Embedded-lab store (src/state/lab.ts) against a scripted fake SimHost, the
 * REAL firmware loader (src/mcu/loader) and real images from firmware/dist:
 * the firmware binding lifecycle (load → persist → send, host sync after
 * every host.load WITHOUT resetting running firmware, re-send to a rebooted
 * host, drop on delete, restore on undo of that delete, clear + blob GC, boot
 * restore from localStorage + the blob store incl. its failure modes),
 * SimFrame consumption into the UART / log ring buffers, terminal
 * line-ending encoding, partial workspace prefs merging, favorites, logic
 * channels, debugger resume, and project export/import through the lab store.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import {
  __setFirmwareBlobStoreForTests,
  bytesToBase64,
  createMemoryBlobStore,
  type FirmwareBlobStore,
} from '../src/state/firmware-store'
import { parseProject } from '../src/state/project'

import * as L from '../src/state/lab'
import * as S from '../src/state/store'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nodeSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** byte-exact equality without a per-element deep-equal walk (firmware images are 100s of KiB) */
const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array): boolean =>
  !!a && a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length))
const file = (name: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: new Uint8Array(readFileSync(`firmware/dist/${name}`)),
})

const LAB_LAYOUT: CircuitLayout = {
  version: 1,
  name: 'lab',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

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

/** A memory blob store that claims persistence — stands in for IndexedDB across "reloads". */
function persistentMemoryStore(): FirmwareBlobStore {
  return { ...createMemoryBlobStore(), persistent: true }
}

interface Call {
  method: string
  args: unknown[]
}

class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  readonly calls: Call[] = []
  lastRev = 0
  answer: ((q: HostQuery) => Promise<HostQueryResult>) | null = null
  constructor(readonly cb: SimHostCallbacks) {}
  private rec(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }
  of(method: string): Call[] {
    return this.calls.filter((c) => c.method === method)
  }
  emit(p: Partial<SimFrame> & { time: number }): void {
    this.cb.onFrame({
      rev: this.lastRev,
      running: false,
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
  load(layout: CircuitLayout, rev: number): void {
    this.lastRev = rev
    this.rec('load', [layout, rev])
  }
  setFirmware(componentId: string, image: FirmwareImage | null): void {
    this.rec('setFirmware', [componentId, image])
  }
  start(speed: number): void {
    this.rec('start', [speed])
  }
  pause(): void {
    this.rec('pause', [])
  }
  reset(): void {
    this.rec('reset', [])
  }
  setSpeed(s: number): void {
    this.rec('setSpeed', [s])
  }
  stepTime(s: number): void {
    this.rec('stepTime', [s])
  }
  mcuReset(id: string): void {
    this.rec('mcuReset', [id])
  }
  mcuHalt(id: string): void {
    this.rec('mcuHalt', [id])
  }
  mcuResume(id: string): void {
    this.rec('mcuResume', [id])
  }
  mcuStep(id: string): void {
    this.rec('mcuStep', [id])
  }
  setRuntimeParam(id: string, key: string, value: ParamValue): void {
    this.rec('setRuntimeParam', [id, key, value])
  }
  uartSend(componentId: string, port: string, bytes: Uint8Array): void {
    this.rec('uartSend', [componentId, port, bytes])
  }
  setLogicChannels(channels: LogicChannelConfig[]): void {
    this.rec('setLogicChannels', [channels])
  }
  query(q: HostQuery): Promise<HostQueryResult> {
    this.rec('query', [q])
    if (!this.answer) return Promise.reject(new Error('no answer scripted'))
    return this.answer(q)
  }
  dispose(): void {
    this.rec('dispose', [])
  }
}

// ---------------------------------------------------------------------------

describe('lab store', () => {
  const st = () => S.useStore.getState()
  const lab = () => L.useLab.getState()
  let storage: MemoryStorage
  let blobs: FirmwareBlobStore
  let hosts: FakeHost[]
  let wide = false
  const host = (): FakeHost => hosts[hosts.length - 1]
  /** firmware ids sent to the host, in order (null image = removal) */
  const sent = (h: FakeHost): string[] =>
    h.of('setFirmware').map((c) => `${c.args[0] as string}:${c.args[1] === null ? 'none' : (c.args[1] as FirmwareImage).name}`)

  function resetDocument(layout: CircuitLayout): void {
    st().resetSim()
    S.__resetHistoryForTests()
    S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
  }

  /** a page reload: fresh in-memory lab state, booted from storage */
  async function reboot(): Promise<void> {
    await L.__rebootLabForTests()
  }

  beforeEach(async () => {
    storage = new MemoryStorage()
    wide = false
    vi.stubGlobal('window', {
      localStorage: storage,
      matchMedia: (q: string) => ({ matches: wide, media: q }),
    })
    blobs = persistentMemoryStore()
    __setFirmwareBlobStoreForTests(blobs)
    hosts = []
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    resetDocument(LAB_LAYOUT)
    await reboot()
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  // ------------------------------------------------------------ firmware lifecycle

  it('loadFirmware parses a real ELF, persists record + bytes and sends it to a freshly booted host', async () => {
    const f = file('hal-blink.elf')
    const res = await lab().loadFirmware('U1', f)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
    const rec = lab().firmware.U1
    expect(rec).toMatchObject({ componentId: 'U1', name: 'hal-blink.elf', format: 'elf', size: f.bytes.length })
    expect(rec.sha256).toBe(nodeSha(f.bytes))
    expect(JSON.parse(storage.getItem('bb.firmware') as string).U1.sha256).toBe(rec.sha256)
    expect(sameBytes(await blobs.get(rec.sha256), f.bytes)).toBe(true)
    // the host was created for it; its boot load sent every binding exactly once
    expect(hosts).toHaveLength(1)
    expect(sent(host())).toEqual(['U1:hal-blink.elf'])
    const img = host().of('setFirmware')[0].args[1] as FirmwareImage
    expect(img.sha256).toBe(rec.sha256)
    expect(img.entry).not.toBeNull()
    expect(host().of('setLogicChannels')).toHaveLength(1)
  })

  it('a second load replaces the binding and resets that MCU through setFirmware', async () => {
    st().startSim()
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const r = await lab().loadFirmware('U1', file('bare-blink.hex'))
    expect(r.ok).toBe(true)
    expect(lab().firmware.U1.format).toBe('hex')
    expect(sent(host())).toEqual(['U1:hal-blink.elf', 'U1:bare-blink.hex'])
  })

  it('BIN images keep their load address for re-parsing', async () => {
    const r = await lab().loadFirmware('U1', file('bare-blink.bin'), { binBase: 0x08000000 })
    expect(r.ok).toBe(true)
    expect(JSON.parse(storage.getItem('bb.firmware') as string).U1.binBase).toBe(0x08000000)
  })

  it('refuses non-MCU components, unknown ids, empty and unparsable files', async () => {
    expect((await lab().loadFirmware('R1', file('hal-blink.elf'))).ok).toBe(false)
    expect((await lab().loadFirmware('U9', file('hal-blink.elf'))).ok).toBe(false)
    expect((await lab().loadFirmware('U1', { name: 'x.elf', bytes: new Uint8Array(0) })).ok).toBe(false)
    const bad = await lab().loadFirmware('U1', { name: 'x.elf', bytes: new TextEncoder().encode('not an elf') })
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/ELF/)
    expect(lab().firmware).toEqual({})
    expect(storage.getItem('bb.firmware')).toBeNull()
  })

  it('after each host.load the host is synced — unchanged firmware is NOT re-sent (no MCU reset per edit)', async () => {
    st().startSim()
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const h = host()
    const before = sent(h).length
    const loads = h.of('load').length
    st().addComponent('resistor', { holes: ['a50', 'a54'] })
    st().undo()
    st().redo()
    st().setParam('R1', 'resistance', 470)
    expect(h.of('load').length).toBe(loads + 4) // every edit reloaded the world…
    expect(sent(h).length).toBe(before) // …and the running firmware was left alone (hot rewire)
  })

  it('a replacement host (crash → fresh boot) receives every binding again', async () => {
    st().startSim()
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    host().cb.onError?.('worker crashed')
    expect(st().running).toBe(false)
    st().startSim()
    expect(hosts).toHaveLength(2)
    expect(sent(host())).toEqual(['U1:hal-blink.elf'])
    expect(host().of('setLogicChannels')).toHaveLength(1)
  })

  it('deleting the board drops its binding (and the host\'s copy); undo brings the same board back WITH its firmware', async () => {
    st().startSim()
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const h = host()
    st().removeComponent('U1')
    expect(lab().firmware).toEqual({})
    expect(storage.getItem('bb.firmware')).toBeNull()
    expect(sent(h).slice(-1)).toEqual(['U1:none']) // a new board reusing "U1" must not inherit it
    const n = sent(h).length
    st().undo()
    expect(lab().firmware.U1?.name).toBe('hal-blink.elf')
    expect(sent(h).slice(n)).toEqual(['U1:hal-blink.elf'])
    expect(h.calls.map((c) => c.method).slice(-2)).toEqual(['load', 'setFirmware']) // after the reload
    expect(JSON.parse(storage.getItem('bb.firmware') as string).U1).toBeDefined()
  })

  it('a NEW board that reuses a deleted board\'s id starts without firmware', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().removeComponent('U1')
    st().addComponent('stm32_bluepill', { at: 'h10' })
    expect(st().layout.components.some((c) => c.id === 'U1')).toBe(true)
    expect(lab().firmware).toEqual({})
  })

  it('bindings follow the document even when no host exists', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    S.__setSimHostFactoryForTests(null) // disposes the host the load created
    S.__setSimHostFactoryForTests((cb) => {
      const h2 = new FakeHost(cb)
      hosts.push(h2)
      return h2
    })
    expect(S.peekSimHost()).toBeNull()
    S.useStore.setState({ layout: { ...LAB_LAYOUT, components: LAB_LAYOUT.components.filter((c) => c.id !== 'U1') } })
    expect(lab().firmware).toEqual({})
  })

  it('clearFirmware unbinds, tells the host and garbage-collects the bytes', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const sha = lab().firmware.U1.sha256
    lab().clearFirmware('U1')
    expect(lab().firmware).toEqual({})
    expect(storage.getItem('bb.firmware')).toBeNull()
    expect(sent(host()).slice(-1)).toEqual(['U1:none'])
    await vi.waitFor(async () => expect(await blobs.get(sha)).toBeNull())
  })

  // ------------------------------------------------------------ boot restore

  it('a reload restores bindings from localStorage + stored bytes and the next host boot receives them', async () => {
    await lab().loadFirmware('U1', file('bare-blink.bin'), { binBase: 0x08000000 })
    const rec = lab().firmware.U1
    S.__setSimHostFactoryForTests(null) // "close the page"
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    await reboot()
    expect(lab().firmware.U1).toEqual(rec)
    st().startSim()
    expect(sent(host())).toEqual(['U1:bare-blink.bin'])
  })

  it('drops (and logs) records whose bytes are gone, corrupted, or whose board no longer exists', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const sha = lab().firmware.U1.sha256

    await blobs.delete(sha)
    await reboot()
    expect(lab().firmware).toEqual({})
    expect(L.labBuffers.log().some((e) => /no longer in browser storage/.test(e.message))).toBe(true)
    expect(storage.getItem('bb.firmware')).toBeNull()

    await lab().loadFirmware('U1', file('hal-blink.elf'))
    await blobs.put(sha, new Uint8Array([1, 2, 3]), 'evil')
    await reboot()
    expect(lab().firmware).toEqual({})
    expect(L.labBuffers.log().some((e) => /corrupted/.test(e.message))).toBe(true)

    await lab().loadFirmware('U1', file('hal-blink.elf'))
    S.useStore.setState({ layout: { ...LAB_LAYOUT, components: LAB_LAYOUT.components.filter((c) => c.id !== 'U1') } })
    storage.setItem('bb.firmware', JSON.stringify({ U1: { ...lab().firmware.U1, sha256: sha } }))
    await reboot()
    expect(lab().firmware).toEqual({})
  })

  it('ignores a corrupted bb.firmware entry', async () => {
    storage.setItem('bb.firmware', '{not json')
    await reboot()
    expect(lab().firmware).toEqual({})
    storage.setItem('bb.firmware', JSON.stringify({ U1: { name: 3 }, U2: 'x' }))
    await reboot()
    expect(lab().firmware).toEqual({})
  })

  // ------------------------------------------------------------ frames → buffers

  it('consumes frames: UART bytes and log lines into ring buffers, MCU info + perf into state', () => {
    S.getSimHost()
    const h = host()
    const v0 = lab().uartVersion
    const l0 = lab().logVersion
    h.emit({
      time: 0.01,
      uart: [{ componentId: 'U1', port: 'USART1', bytes: [...new TextEncoder().encode('hello µ\r\n')] }],
      log: [{ time: 0.01, level: 'warning', source: 'U1/USART1', message: 'overrun', componentId: 'U1' }],
      mcus: [{ componentId: 'U1', state: 'running', firmware: 'x.elf', pc: 0x08000131, hclkHz: 72e6, cycles: 720000, realtime: 1, uarts: [] }],
    })
    expect(L.labBuffers.uartText('U1', 'USART1')).toBe('hello µ\r\n')
    expect(L.labBuffers.uartBytes('U1', 'USART1').length).toBe(10)
    expect(L.labBuffers.uartPorts()).toEqual([{ componentId: 'U1', port: 'USART1' }])
    expect(L.labBuffers.log().map((e) => e.message)).toEqual(['overrun'])
    expect(lab().uartVersion).toBe(v0 + 1)
    expect(lab().logVersion).toBe(l0 + 1)
    expect(lab().mcus.U1.hclkHz).toBe(72e6)
    expect(lab().perf?.stepsPerSecond).toBe(1)
    expect(L.labBuffers.uartText('U9', 'USART1')).toBe('')
  })

  it('keeps UART bytes of a superseded revision but not its MCU snapshot; reset clears the buffers', () => {
    st().startSim()
    const h = host()
    const oldRev = h.lastRev
    st().addComponent('resistor', { holes: ['a50', 'a54'] }) // reload → new revision
    h.cb.onFrame({
      rev: oldRev,
      time: 0.02,
      running: false,
      telemetry: { time: 0.02, netVoltages: {}, components: {}, issues: [] },
      scope: [],
      uart: [{ componentId: 'U1', port: 'USART2', bytes: [65, 66] }],
      mcus: [{ componentId: 'U1', state: 'halted', firmware: null, pc: 0, hclkHz: 8e6, cycles: 0, realtime: 0, uarts: [] }],
      log: [],
      issues: [],
      perf: { realtimeFactor: 0, stepsPerSecond: 0, busyMs: 0 },
    })
    expect(L.labBuffers.uartText('U1', 'USART2')).toBe('AB')
    expect(lab().mcus.U1).toBeUndefined()
    st().resetSim()
    expect(L.labBuffers.uartText('U1', 'USART2')).toBe('')
    expect(L.labBuffers.log()).toEqual([])
  })

  it('caps a port\'s history, dropping the oldest bytes', () => {
    S.getSimHost()
    const chunk = new Array(1000).fill(0x41)
    for (let i = 0; i < 70; i++) host().emit({ time: i, uart: [{ componentId: 'U1', port: 'USART1', bytes: chunk }] })
    host().emit({ time: 71, uart: [{ componentId: 'U1', port: 'USART1', bytes: [0x5a] }] })
    const b = L.labBuffers.uartBytes('U1', 'USART1')
    expect(b.length).toBe(L.UART_BUFFER_BYTES)
    expect(b[b.length - 1]).toBe(0x5a)
  })

  it('pushes running frames to React at most every 100 ms, with a trailing push', () => {
    vi.useFakeTimers()
    try {
      let now = 0
      L.__setLabClockForTests(() => now)
      S.getSimHost()
      const v0 = lab().uartVersion
      host().emit({ time: 0, running: true, uart: [{ componentId: 'U1', port: 'USART1', bytes: [0x31] }] })
      expect(lab().uartVersion).toBe(v0 + 1)
      now = 30
      host().emit({ time: 0.03, running: true, uart: [{ componentId: 'U1', port: 'USART1', bytes: [0x32] }] })
      now = 60
      host().emit({ time: 0.06, running: true, uart: [{ componentId: 'U1', port: 'USART1', bytes: [0x33] }] })
      expect(lab().uartVersion).toBe(v0 + 1) // throttled — but the buffer is already current
      expect(L.labBuffers.uartText('U1', 'USART1')).toBe('123')
      now = 100
      vi.advanceTimersByTime(100)
      expect(lab().uartVersion).toBe(v0 + 2) // trailing push
    } finally {
      vi.useRealTimers()
    }
  })

  // ------------------------------------------------------------ terminal

  it('encodes every line ending', () => {
    const dec = (b: Uint8Array): number[] => [...b]
    expect(dec(L.encodeTerminalLine('hi', 'none'))).toEqual([0x68, 0x69])
    expect(dec(L.encodeTerminalLine('hi', 'lf'))).toEqual([0x68, 0x69, 0x0a])
    expect(dec(L.encodeTerminalLine('hi', 'cr'))).toEqual([0x68, 0x69, 0x0d])
    expect(dec(L.encodeTerminalLine('hi', 'crlf'))).toEqual([0x68, 0x69, 0x0d, 0x0a])
    expect(dec(L.encodeTerminalLine('µ', 'none'))).toEqual([0xc2, 0xb5]) // UTF-8
  })

  it('sendUart applies the chosen line ending and forwards the bytes to the host', () => {
    S.getSimHost()
    for (const [ending, tail] of [
      ['none', []],
      ['lf', [10]],
      ['cr', [13]],
      ['crlf', [13, 10]],
    ] as const) {
      lab().setTerminal({ lineEnding: ending })
      lab().sendUart('U1', 'USART1', 'AT')
      const last = host().of('uartSend').slice(-1)[0]
      expect(last.args.slice(0, 2)).toEqual(['U1', 'USART1'])
      expect([...(last.args[2] as Uint8Array)]).toEqual([0x41, 0x54, ...tail])
    }
    expect(JSON.parse(storage.getItem('bb.terminal') as string).lineEnding).toBe('crlf')
  })

  it('local echo writes sent text into the transcript; without a host nothing is sent and the log says so', () => {
    lab().sendUart('U1', 'USART1', 'lost')
    expect(L.labBuffers.log().some((e) => /not sent/.test(e.message))).toBe(true)
    expect(L.labBuffers.uartText('U1', 'USART1')).toBe('')
    S.getSimHost()
    lab().setTerminal({ localEcho: true, lineEnding: 'lf' })
    lab().sendUart('U1', 'USART1', 'ping')
    expect(L.labBuffers.uartText('U1', 'USART1')).toBe('ping\n')
    lab().clearUart('U1', 'USART1')
    expect(L.labBuffers.uartText('U1', 'USART1')).toBe('')
  })

  it('setTerminal ignores ill-typed fields; prefs survive a reload', async () => {
    lab().setTerminal({ hex: true, lineEnding: 'bogus' as never })
    expect(lab().terminal.hex).toBe(true)
    expect(lab().terminal.lineEnding).toBe('lf')
    await reboot()
    expect(lab().terminal.hex).toBe(true)
  })

  // ------------------------------------------------------------ workspace / favorites

  it('merges a PARTIAL stored workspace over the defaults (visual-regression harness shape)', async () => {
    wide = true
    storage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
    await reboot()
    const d = L.workspaceDefaults()
    expect(lab().workspace).toEqual({ ...d, enabled: false })
    expect(d.enabled).toBe(true) // the default follows matchMedia
  })

  it('defaults: enabled follows matchMedia when nothing is stored, false without matchMedia', async () => {
    wide = true
    await reboot()
    expect(lab().workspace.enabled).toBe(true)
    wide = false
    await reboot()
    expect(lab().workspace.enabled).toBe(false)
    vi.stubGlobal('window', { localStorage: storage })
    await reboot()
    expect(lab().workspace.enabled).toBe(false)
  })

  it('deep-merges nested partials, drops ill-typed fields, clamps sizes, survives corrupt JSON', async () => {
    storage.setItem(
      'bb.workspace',
      JSON.stringify({ v: 1, tray: { height: 99999, tab: 'logic' }, left: { open: 'yes', tab: 'nope' }, right: 5 }),
    )
    await reboot()
    const d = L.workspaceDefaults()
    expect(lab().workspace.tray).toEqual({ open: d.tray.open, height: 960, tab: 'logic' })
    expect(lab().workspace.left).toEqual(d.left)
    expect(lab().workspace.right).toEqual(d.right)
    storage.setItem('bb.workspace', '{oops')
    await reboot()
    expect(lab().workspace).toEqual(d)
  })

  it('setWorkspace stores only the overrides, so `enabled` keeps following the device', async () => {
    lab().setWorkspace({ tray: { open: false, height: 300, tab: 'log' } })
    expect(JSON.parse(storage.getItem('bb.workspace') as string)).toEqual({
      v: 1,
      tray: { open: false, height: 300, tab: 'log' },
    })
    wide = true
    await reboot()
    expect(lab().workspace.enabled).toBe(true)
    expect(lab().workspace.tray.tab).toBe('log')
  })

  it('favorites toggle and persist; corrupt entries are cleaned', async () => {
    lab().toggleFavorite('stm32_bluepill')
    lab().toggleFavorite('led')
    lab().toggleFavorite('stm32_bluepill')
    expect(lab().favorites).toEqual(['led'])
    storage.setItem('bb.favorites', JSON.stringify(['led', 3, 'led', 'resistor']))
    await reboot()
    expect(lab().favorites).toEqual(['led', 'resistor'])
  })

  // ------------------------------------------------------------ logic channels / queries

  it('logic channels: sanitized, persisted, forwarded to the host and re-sent on host boot', async () => {
    const ch: LogicChannelConfig[] = [{ index: 1, label: 'LED', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' } }]
    lab().setLogicChannels([...ch, { index: 99 } as unknown as LogicChannelConfig])
    expect(lab().logicChannels).toEqual(ch)
    expect(JSON.parse(storage.getItem('bb.instruments') as string).logicChannels).toEqual(ch)
    st().startSim()
    expect(host().of('setLogicChannels').map((c) => c.args[0])).toEqual([ch])
    await reboot()
    expect(lab().logicChannels).toEqual(ch)
  })

  it('queries go to the host; failures and a missing host give empty answers', async () => {
    expect(await lab().queryLogic(0, 1)).toEqual({ t0: 0, t1: 1, traces: [], overflow: false })
    expect(await lab().queryScope(0, 1)).toEqual({ t0: 0, t1: 1, traces: [] })
    S.getSimHost()
    host().answer = async (q) =>
      q.kind === 'mcu-memory' ? { kind: 'mcu-memory', bytes: new Uint8Array([1, 2]) } : { kind: 'mcu-support', support: [] }
    expect(await lab().readMcuMemory('U1', 0x20000000, 2)).toEqual(new Uint8Array([1, 2]))
    expect(await lab().readMcuMemory('U1', -1, 2)).toBeNull() // invalid address: never asked
    expect(await lab().queryMcuDebug('U1')).toBeNull() // wrong-kind answer
    host().answer = null
    expect(await lab().queryMcuSupport('U1')).toEqual([])
    expect(L.labBuffers.log().some((e) => /mcu-support query failed/.test(e.message))).toBe(true)
    lab().mcuHalt('U1')
    lab().mcuStep('U1')
    expect(host().calls.slice(-2).map((c) => c.method)).toEqual(['mcuHalt', 'mcuStep'])
  })

  it('mcuResume after a debugger halt that froze the world restarts it', () => {
    st().startSim()
    const h = host()
    h.emit({ time: 0.05, running: true })
    lab().mcuHalt('U1')
    // the host stops its loop on the halt and says so in its next frame
    h.emit({
      time: 0.051,
      running: false,
      mcus: [{ componentId: 'U1', state: 'halted', firmware: 'x', pc: 0x08000100, hclkHz: 8e6, cycles: 9, realtime: 0, uarts: [] }],
    })
    expect(st().running).toBe(false)
    expect(lab().mcus.U1.state).toBe('halted')
    lab().mcuResume('U1')
    expect(h.calls.slice(-2).map((c) => c.method)).toEqual(['mcuResume', 'start'])
    expect(st().running).toBe(true)
  })

  // ------------------------------------------------------------ project files

  it('exportProject → importProject round-trips layout, firmware bytes, workspace and logic channels', async () => {
    const f = file('hal-blink.elf')
    await lab().loadFirmware('U1', f)
    lab().setLogicChannels([{ index: 0, label: 'PC13', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' } }])
    lab().setWorkspace({ left: { open: false, width: 280, tab: 'lessons' } })
    const text = await lab().exportProject()
    const parsed = parseProject(text)
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    expect(sameBytes(parsed.project.firmware[0].bytes, f.bytes)).toBe(true)

    // a different session: other circuit, no firmware, other prefs
    lab().clearFirmware('U1')
    lab().setLogicChannels([])
    lab().setWorkspace({ left: { open: true, width: 300, tab: 'parts' } })
    resetDocument({ version: 1, components: [], wires: [] })
    st().startSim()
    const h = host()

    const res = await lab().importProject(text)
    expect(res).toEqual({ ok: true, errors: [], warnings: [] })
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1', 'U1', 'R1'])
    expect(st().canUndo).toBe(true) // one undo step, like a JSON import
    expect(lab().firmware.U1.sha256).toBe(nodeSha(f.bytes))
    expect(sent(h).slice(-1)).toEqual(['U1:hal-blink.elf'])
    expect(lab().logicChannels.map((c) => c.label)).toEqual(['PC13'])
    expect(lab().workspace.left).toEqual({ open: false, width: 280, tab: 'lessons' })
  })

  it('importing a bare legacy layout replaces the circuit and drops old bindings', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const legacy = readFileSync('examples/blinky-555.json', 'utf8')
    const res = await lab().importProject(legacy)
    expect(res.ok).toBe(true)
    expect(st().layout.name).toMatch(/555/)
    expect(lab().firmware).toEqual({})
  })

  it('a rejected import (corrupt JSON, newer version, SHA mismatch) changes nothing', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const good = await lab().exportProject()
    const layoutBefore = st().layout
    const fwBefore = lab().firmware

    expect((await lab().importProject('{"format":')).ok).toBe(false)
    const newer = JSON.parse(good)
    newer.formatVersion = 2
    const r2 = await lab().importProject(JSON.stringify(newer))
    expect(r2.ok).toBe(false)
    expect(r2.errors[0]).toMatch(/newer/)
    const tampered = JSON.parse(good)
    tampered.firmware.U1.data = bytesToBase64(new Uint8Array(tampered.firmware.U1.size))
    const r3 = await lab().importProject(JSON.stringify(tampered))
    expect(r3.ok).toBe(false)
    expect(r3.errors.join()).toMatch(/SHA-256 mismatch/)

    expect(st().layout).toBe(layoutBefore)
    expect(lab().firmware).toBe(fwBefore)
  })

  it('an embedded image the loader rejects is skipped with a warning; the circuit still loads', async () => {
    const text = JSON.stringify({
      format: 'ohmlet-project',
      formatVersion: 1,
      app: { name: 'ohmlet', version: '0.1.0' },
      savedAt: '2026-10-09T00:00:00.000Z',
      layout: LAB_LAYOUT,
      firmware: {
        U1: {
          name: 'junk.elf',
          format: 'elf',
          sha256: nodeSha(new Uint8Array([1, 2, 3, 4])),
          size: 4,
          data: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
        },
      },
    })
    const res = await lab().importProject(text)
    expect(res.ok).toBe(true)
    expect(res.warnings.join()).toMatch(/junk\.elf/)
    expect(lab().firmware).toEqual({})
  })
})
