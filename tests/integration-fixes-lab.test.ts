/**
 * Logic-analyzer decoder instances and trigger settings persist in the lab
 * store (localStorage 'bb.logicView', migrated from the analyzer's former
 * 'bb.logicDecoders' / 'bb.logicTrigger') and travel in project files
 * (instruments.logicView) — as OPAQUE, versioned JSON: the analyzer UI owns
 * their shape (src/ui/embedded/logic-decoders.ts, instruments/la-config.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import type { SimHost } from '../src/sim/coordinator/api'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { emptyLogicView, LOGIC_VIEW_VERSION, MAX_LOGIC_DECODERS, parseProject, sanitizeLogicView, serializeProject } from '../src/state/project'
import { __setLangForTests } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'

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

/** A host that answers nothing (the lab store only needs it to exist). */
function quietHost(): SimHost {
  const noop = () => {}
  return {
    kind: 'inline',
    load: noop,
    setFirmware: noop,
    start: noop,
    pause: noop,
    reset: noop,
    setSpeed: noop,
    stepTime: noop,
    mcuReset: noop,
    mcuHalt: noop,
    mcuResume: noop,
    mcuStep: noop,
    setRuntimeParam: noop,
    uartSend: noop,
    setLogicChannels: noop,
    query: () => Promise.reject(new Error('no answers')),
    dispose: noop,
  }
}

const LAYOUT: CircuitLayout = {
  version: 1,
  components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }],
  wires: [],
}

const I2C_DECODER = { id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }
const UART_DECODER = { id: 'uart1', decoder: 'uart', channels: { data: 2 }, options: { baud: '115200' } }
const TRIGGER = { kind: 'edge', channel: 1, slope: 'falling', pattern: {}, pre: 0.25 }

describe('lab store: logic-analyzer decoders + trigger (LogicViewSettings)', () => {
  const lab = () => L.useLab.getState()
  let storage: MemoryStorage

  beforeEach(async () => {
    storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage, matchMedia: (q: string) => ({ matches: false, media: q }) })
    __setFirmwareBlobStoreForTests({ ...createMemoryBlobStore(), persistent: true })
    S.__setSimHostFactoryForTests(() => quietHost())
    S.useStore.getState().resetSim()
    S.__resetHistoryForTests()
    S.useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
    await L.__rebootLabForTests()
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('starts empty, persists every change and survives a reload', async () => {
    expect(lab().logicView).toEqual(emptyLogicView())
    lab().setLogicView({ decoders: [I2C_DECODER, UART_DECODER] })
    lab().setLogicView({ trigger: TRIGGER })
    expect(lab().logicView).toEqual({ v: 1, decoders: [I2C_DECODER, UART_DECODER], trigger: TRIGGER })
    expect(JSON.parse(storage.getItem(L.LS_LOGIC_VIEW) as string)).toEqual(lab().logicView)
    await L.__rebootLabForTests()
    expect(lab().logicView).toEqual({ v: 1, decoders: [I2C_DECODER, UART_DECODER], trigger: TRIGGER })
    lab().setLogicView({ trigger: null })
    expect(lab().logicView.trigger).toBeNull()
    expect(lab().logicView.decoders).toHaveLength(2)
  })

  it('keeps the contents opaque but plain JSON (functions, NaN, non-objects dropped)', () => {
    lab().setLogicView({
      decoders: [
        { ...I2C_DECODER, extra: { nested: [1, 'two', true, null] }, bad: Number.NaN, fn: () => 1 } as unknown as Record<string, unknown>,
        42 as unknown as Record<string, unknown>,
      ],
    })
    expect(lab().logicView.decoders).toEqual([{ ...I2C_DECODER, extra: { nested: [1, 'two', true, null] } }])
    expect(L.labBuffers.log().some((e) => e.message.includes('logic decoder #1 is not an object — dropped'))).toBe(true)
  })

  it("migrates the analyzer's former localStorage keys on first boot", async () => {
    storage.setItem('bb.logicDecoders', JSON.stringify({ v: 1, decoders: [UART_DECODER] }))
    storage.setItem('bb.logicTrigger', JSON.stringify({ v: 1, ...TRIGGER }))
    await L.__rebootLabForTests()
    expect(lab().logicView).toEqual({ v: 1, decoders: [UART_DECODER], trigger: TRIGGER })
    // once the lab store has written its own key, that one wins
    lab().setLogicView({ decoders: [] })
    await L.__rebootLabForTests()
    expect(lab().logicView.decoders).toEqual([])
  })

  it('a stored envelope from a newer version is ignored, corrupt storage falls back to empty', async () => {
    storage.setItem(L.LS_LOGIC_VIEW, JSON.stringify({ v: LOGIC_VIEW_VERSION + 1, decoders: [I2C_DECODER] }))
    await L.__rebootLabForTests()
    expect(lab().logicView).toEqual(emptyLogicView())
    storage.setItem(L.LS_LOGIC_VIEW, '{not json')
    await L.__rebootLabForTests()
    expect(lab().logicView).toEqual(emptyLogicView())
  })

  it('export → import carries decoders and trigger in the project file', async () => {
    lab().setLogicView({ decoders: [I2C_DECODER], trigger: TRIGGER })
    const text = await lab().exportProject()
    const env = JSON.parse(text)
    expect(env.instruments.logicView).toEqual({ v: 1, decoders: [I2C_DECODER], trigger: TRIGGER })
    lab().setLogicView({ decoders: [], trigger: null })
    const res = await lab().importProject(text)
    expect(res.ok).toBe(true)
    expect(lab().logicView).toEqual({ v: 1, decoders: [I2C_DECODER], trigger: TRIGGER })
  })

  it('a project without logic-view settings keeps the current ones; empty settings are not written', async () => {
    const plain = await lab().exportProject()
    expect(JSON.parse(plain).instruments.logicView).toBeUndefined()
    lab().setLogicView({ decoders: [UART_DECODER] })
    const res = await lab().importProject(plain)
    expect(res.ok).toBe(true)
    expect(lab().logicView.decoders).toEqual([UART_DECODER])
  })
})

describe('project envelope: instruments.logicView', () => {
  it('round-trips byte-exact and reports malformed members', () => {
    const text = serializeProject({
      layout: LAYOUT,
      firmware: {},
      instruments: { logicChannels: [], logicView: { v: 1, decoders: [I2C_DECODER], trigger: TRIGGER } },
    })
    const p = parseProject(text)
    if (!p.ok) throw new Error(p.errors.join('\n'))
    expect(p.project.instruments?.logicView).toEqual({ v: 1, decoders: [I2C_DECODER], trigger: TRIGGER })
    const env = JSON.parse(text)
    env.instruments.logicView = { v: 1, decoders: [I2C_DECODER, 'x'], trigger: 7 }
    const q = parseProject(JSON.stringify(env))
    if (!q.ok) throw new Error(q.errors.join('\n'))
    expect(q.project.instruments?.logicView).toEqual({ v: 1, decoders: [I2C_DECODER], trigger: null })
    expect(q.warnings).toEqual([
      'instruments: logic decoder #1 is not an object — dropped',
      'instruments: "logicView.trigger" is not an object — ignored',
    ])
    env.instruments.logicView = { v: 9, decoders: [I2C_DECODER] }
    const r = parseProject(JSON.stringify(env))
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.project.instruments?.logicView).toBeUndefined()
    expect(r.warnings[0]).toContain('logic-analyzer settings v9 come from a newer ohmlet — ignored')
  })

  it('caps the decoder list', () => {
    const many = Array.from({ length: MAX_LOGIC_DECODERS + 3 }, (_, i) => ({ id: `u${i}`, decoder: 'uart', channels: {} }))
    const s = sanitizeLogicView({ v: 1, decoders: many, trigger: null })
    expect(s.view?.decoders).toHaveLength(MAX_LOGIC_DECODERS)
    expect(s.warnings).toEqual([`more than ${MAX_LOGIC_DECODERS} logic decoders — the rest were dropped`])
  })

  it('every new warning has a zh-TW text', () => {
    __setLangForTests('zh-TW')
    const texts = [
      'instruments: logic decoder #1 is not an object — dropped',
      'instruments: "logicView.trigger" is not an object — ignored',
      'instruments: "logicView.decoders" must be an array — ignored',
      'instruments: "logicView" is not an object — ignored',
      'instruments: "logicView.v" must be a positive integer — ignored',
      'instruments: logic-analyzer settings v9 come from a newer ohmlet — ignored (decoders and trigger keep their current settings)',
      `instruments: more than ${MAX_LOGIC_DECODERS} logic decoders — the rest were dropped`,
      'logic analyzer: logic decoder #1 is not an object — dropped',
    ]
    for (const t of texts) {
      expect(hasMessageTranslation(t), t).toBe(true)
      expect(tMessage(t)).toMatch(/[一-鿿]/)
    }
  })
})
