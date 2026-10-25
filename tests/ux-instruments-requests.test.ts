/**
 * UX requests round — instruments:
 *  - H8 moveWireEnd(id, end, ref, { color }): the convention colour of the
 *    new ends rides in the SAME undo step (SC-13 (4));
 *  - flashLogicChannel / flashScopeChannel (SC-14 (3)): the instruments point
 *    at the row / chip and a fresh flash request is made; a caller that bumps
 *    only `seq` is stamped fresh;
 *  - revealInstrument: one current instrument (lab.workspace.tray.tab) for the
 *    workspace and the phone sheet; `open` goes through the shell's request
 *    store; the classic chrome is untouched;
 *  - probe toasts: 「在儀器中查看」 where no tray shows the instrument, and
 *    「仍要再放一支」 on the duplicate probe refusal (places it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  addLogicChannelFor,
  addScopeProbeFor,
  flashLogicChannel,
  flashScopeChannel,
  useLogicFlash,
  useScopeFlash,
} from '../src/ui/embedded/probe-actions'
import { revealInstrument } from '../src/ui/embedded/instruments/instrument-request'
import { useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'

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

/** pwm-fade's bench: PA6 (c19) → e40 → R1 → D1, a probe P1 at c40 on PA6's net; W2 a black ground wire. */
const PWM: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
    { id: 'D1', type: 'led', holes: ['b44', 'top-45'] },
    { id: 'P1', type: 'scope_probe', holes: ['c40'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'a19', to: 'e40', color: 'yellow' },
    { id: 'W2', from: 'a50', to: 'top-50', color: 'black' },
  ],
}

const storage = new MemoryStorage()
let wide = false
const st = () => useStore.getState()
const lastToast = () => getToasts()[getToasts().length - 1]

function setDocument(layout: CircuitLayout): void {
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

beforeEach(() => {
  storage.clear()
  wide = false
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: wide, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
  __setLangForTests('zh-TW')
  setDocument(PWM)
  useLab.setState({ mcus: {}, firmware: {}, logicChannels: [] })
  useLab.getState().setWorkspace({ enabled: true, tray: { open: false, height: 240, tab: 'uart' } })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('H8 moveWireEnd colour option', () => {
  it('re-colours in the same undo step; one undo restores the end and the colour', () => {
    const r = st().moveWireEnd('W2', 'to', 'a55', { color: 'yellow' })
    expect(r).toEqual({ ok: true, changed: true })
    expect(st().layout.wires.find((w) => w.id === 'W2')).toEqual({ id: 'W2', from: 'a50', to: 'a55', color: 'yellow' })
    st().undo()
    expect(st().layout.wires.find((w) => w.id === 'W2')).toEqual({ id: 'W2', from: 'a50', to: 'top-50', color: 'black' })
    expect(st().canUndo).toBe(false)
  })
  it('no colour (or a blank one) keeps the colour; the same place makes no step even with a colour', () => {
    st().moveWireEnd('W2', 'to', 'a55', { color: '  ' })
    expect(st().layout.wires.find((w) => w.id === 'W2')?.color).toBe('black')
    st().moveWireEnd('W2', 'to', 'a56')
    expect(st().layout.wires.find((w) => w.id === 'W2')?.color).toBe('black')
    st().undo()
    st().undo()
    expect(st().canUndo).toBe(false)
    expect(st().moveWireEnd('W2', 'to', 'top-50', { color: 'red' })).toEqual({ ok: true, changed: false })
    expect(st().layout.wires.find((w) => w.id === 'W2')?.color).toBe('black')
    expect(st().canUndo).toBe(false)
  })
  it('a refused move changes nothing, colour included', () => {
    const r = st().moveWireEnd('W2', 'to', 'c40', { color: 'red' }) // P1's hole
    expect(r.ok).toBe(false)
    expect(st().layout.wires.find((w) => w.id === 'W2')).toEqual(PWM.wires[1])
  })
})

describe('flash requests (SC-14 (3))', () => {
  it('flashLogicChannel points the instruments at the analyzer with a fresh request', () => {
    const seq = useLogicFlash.getState().seq
    flashLogicChannel(3)
    expect(useLogicFlash.getState()).toMatchObject({ index: 3, seq: seq + 1 })
    expect(Date.now() - useLogicFlash.getState().at).toBeLessThan(1000)
    expect(useLab.getState().workspace.tray.tab).toBe('logic')
    // a phone keeps the desktop tray's open / closed state
    expect(useLab.getState().workspace.tray.open).toBe(false)
    flashLogicChannel(16)
    flashLogicChannel(-1)
    expect(useLogicFlash.getState().seq).toBe(seq + 1)
  })
  it('flashScopeChannel: 1..4 only; the workspace opens its tray on the scope', () => {
    wide = true
    const seq = useScopeFlash.getState().seq
    flashScopeChannel(2)
    expect(useScopeFlash.getState()).toMatchObject({ channel: 2, seq: seq + 1 })
    expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'scope' })
    flashScopeChannel(5)
    expect(useScopeFlash.getState().seq).toBe(seq + 1)
  })
  it('a request that bumps seq without a time is stamped now (it still flashes)', () => {
    useScopeFlash.setState({ at: 0 })
    useScopeFlash.setState((s) => ({ channel: 1, seq: s.seq + 1 }))
    expect(Date.now() - useScopeFlash.getState().at).toBeLessThan(1000)
    useLogicFlash.setState({ at: 0 })
    useLogicFlash.setState((s) => ({ index: 0, seq: s.seq + 1 }))
    expect(Date.now() - useLogicFlash.getState().at).toBeLessThan(1000)
  })
})

describe('revealInstrument — one current instrument', () => {
  it('a phone: the tab is set, the sheet is not asked for; open → the shell’s request', () => {
    const before = useInstrumentRequest.getState().request?.seq ?? 0
    expect(revealInstrument('log')).toBe(true)
    expect(useLab.getState().workspace.tray).toMatchObject({ open: false, tab: 'log' })
    expect(useInstrumentRequest.getState().request?.seq ?? 0).toBe(before)
    expect(revealInstrument('scope', { open: true })).toBe(true)
    expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'scope', seq: before + 1 })
    expect(useLab.getState().workspace.tray.tab).toBe('scope')
  })
  it('the workspace: the tray opens on the tab', () => {
    wide = true
    revealInstrument('measure')
    expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'measure' })
  })
  it('the classic chrome (English, no workspace): nothing changes', () => {
    __setLangForTests('en')
    const before = useInstrumentRequest.getState().request
    expect(revealInstrument('log', { open: true })).toBe(false)
    expect(useLab.getState().workspace.tray.tab).toBe('uart')
    expect(useInstrumentRequest.getState().request).toBe(before)
  })
})

describe('probe toasts with an action', () => {
  it('a phone: 「已加入邏輯分析儀：…」 + 「在儀器中查看」, which opens the sheet on the analyzer', () => {
    const r = addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' })
    expect(r.ok).toBe(true)
    const toast = lastToast()
    expect(toast?.text).toBe('已加入邏輯分析儀：PA7（板上 A7）')
    expect(toast?.action?.label).toBe('在儀器中查看')
    useLab.getState().setWorkspace({ tray: { ...useLab.getState().workspace.tray, tab: 'uart' } })
    const seq = useInstrumentRequest.getState().request?.seq ?? 0
    toast?.action?.run()
    expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'logic', seq: seq + 1 })
  })
  it('the workspace: no action (the tray already shows it)', () => {
    wide = true
    addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' })
    expect(lastToast()?.text).toBe('已加入邏輯分析儀：PA7（板上 A7）')
    expect(lastToast()?.action).toBeUndefined()
  })
  it('a duplicate channel flashes the row that has it', () => {
    addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })
    const seq = useLogicFlash.getState().seq
    const again = addLogicChannelFor({ kind: 'hole', ref: 'e40' }) // PA6's net through W1
    expect(again.ok).toBe(false)
    expect(useLogicFlash.getState()).toMatchObject({ index: 0, seq: seq + 1 })
    expect(lastToast()?.text).toBe('PA6（板上 A6） 已在邏輯分析儀上')
  })
  it('the duplicate scope probe: 「仍要再放一支」 places the second probe', async () => {
    const r = await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })
    expect(r).toMatchObject({ ok: false, existing: { componentId: 'P1', channel: 1 } })
    const toast = lastToast()
    expect(toast?.text).toBe('這個網路已由 P1 量測（CH1）')
    expect(toast?.action?.label).toBe('仍要再放一支')
    toast?.action?.run()
    await Promise.resolve()
    const probes = st().layout.components.filter((c) => c.type === 'scope_probe')
    expect(probes).toHaveLength(2)
    expect(probes[1].params?.channel).toBe(2)
  })
  it('the classic chrome keeps its texts and has no actions', async () => {
    __setLangForTests('en')
    addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' })
    expect(lastToast()?.text).toMatch(/open Instruments to see it/)
    expect(lastToast()?.action).toBeUndefined()
    await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })
    expect(lastToast()?.action).toBeUndefined()
  })
})
