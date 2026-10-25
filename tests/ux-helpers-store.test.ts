/**
 * UX fix wave — helper H8 (src/state/store.ts, src/state/project.ts):
 * moveWireEnd / swapLeads as single undo steps, wireRefusal (why addWire
 * says no), case-insensitive ids, and the load-time pushbutton id change
 * 'PB<n>' → 'SW<n>' (PB1 reads like the STM32 pin PB1) with every reference
 * rewritten — project files, the autosave and store.loadLayout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import { migrateComponentIds, parseProject, renameEndpoint, renameLogicChannels, serializeProject } from '../src/state/project'
import { __resetHistoryForTests, canSwapLeads, lastLoadRenames, useStore, wireRefusal } from '../src/state/store'

const st = () => useStore.getState()

function setDocument(layout: CircuitLayout): void {
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }

/** LED1 c40/c42 (polarised), R1 a44–a48, a wire W1 a20 → top-20. */
const BENCH: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'LED1', type: 'led', holes: ['c40', 'c42'] },
    { id: 'R1', type: 'resistor', holes: ['a44', 'a48'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'a20', to: 'top-20', color: 'black' },
    { id: 'W2', from: 'PS1:+', to: 'top+3', color: 'red' },
  ],
}

beforeEach(() => setDocument(EMPTY))

describe('H8 ids', () => {
  it('a new pushbutton is SW1 (never PB1); a slide switch already called SW1 makes it SW2', () => {
    st().addComponent('pushbutton', { at: 'f10' })
    expect(st().layout.components.map((c) => c.id)).toEqual(['SW1'])
    setDocument({ version: 1, components: [{ id: 'SW1', type: 'slide_switch', holes: ['a5', 'a6', 'a7'] }], wires: [] })
    st().addComponent('pushbutton', { at: 'f20' })
    expect(st().layout.components.map((c) => c.id)).toEqual(['SW1', 'SW2'])
  })

  it('ids are allocated case-insensitively: next to "w1" a new wire is not "W1"', () => {
    setDocument({ version: 1, components: [], wires: [{ id: 'w1', from: 'a1', to: 'a10', color: 'red' }] })
    st().addWire('b20', 'b30')
    expect(st().layout.wires.map((w) => w.id)).toEqual(['w1', 'W2'])
  })
})

describe('H8 wireRefusal / moveWireEnd / swapLeads', () => {
  it('wireRefusal mirrors addWire (null exactly when the wire is added)', () => {
    setDocument(BENCH)
    expect(wireRefusal(st().layout, 'a25', 'top-25')).toBeNull()
    expect(wireRefusal(st().layout, 'a20', 'b30')).toEqual({ kind: 'occupied', ref: 'a20' })
    expect(wireRefusal(st().layout, 'b30', 'b30')).toEqual({ kind: 'same-endpoint', ref: 'b30' })
    expect(wireRefusal(st().layout, 'top-20', 'a20')).toEqual({ kind: 'duplicate', ref: 'a20', wireId: 'W1' })
    expect(wireRefusal(st().layout, 'a90', 'a1')).toEqual({ kind: 'invalid-endpoint', ref: 'a90' })
    const before = st().layout.wires.length
    st().addWire('a20', 'b30') // refused: occupied
    expect(st().layout.wires.length).toBe(before)
    st().addWire('a25', 'top-25')
    expect(st().layout.wires.length).toBe(before + 1)
  })

  it('moveWireEnd re-routes one end: same id and colour, one undo step', () => {
    setDocument(BENCH)
    const r = st().moveWireEnd('W1', 'from', 'a19')
    expect(r).toEqual({ ok: true, changed: true })
    expect(st().layout.wires.find((w) => w.id === 'W1')).toEqual({ id: 'W1', from: 'a19', to: 'top-20', color: 'black' })
    expect(st().canUndo).toBe(true)
    st().undo()
    expect(st().layout.wires.find((w) => w.id === 'W1')?.from).toBe('a20')
    expect(st().canUndo).toBe(false)
    st().redo()
    expect(st().layout.wires.find((w) => w.id === 'W1')?.from).toBe('a19')
  })

  it('moveWireEnd: a second re-route of the same wire is its own undo step; same place = no step', () => {
    setDocument(BENCH)
    st().moveWireEnd('W1', 'to', 'top-21')
    st().moveWireEnd('W1', 'to', 'top-22')
    expect(st().moveWireEnd('W1', 'to', 'top-22')).toEqual({ ok: true, changed: false })
    st().undo()
    expect(st().layout.wires.find((w) => w.id === 'W1')?.to).toBe('top-21')
    st().undo()
    expect(st().layout.wires.find((w) => w.id === 'W1')?.to).toBe('top-20')
  })

  it('moveWireEnd validates like addWire, with the wire itself out of the way', () => {
    setDocument(BENCH)
    expect(st().moveWireEnd('W9', 'from', 'a1')).toEqual({ ok: false, refusal: { kind: 'no-wire', wireId: 'W9' } })
    expect(st().moveWireEnd('W1', 'from', 'c40')).toEqual({ ok: false, refusal: { kind: 'occupied', ref: 'c40' } })
    expect(st().moveWireEnd('W1', 'from', 'top-20')).toEqual({ ok: false, refusal: { kind: 'same-endpoint', ref: 'top-20' } })
    // its own old hole is free for the moved end: a20 → b20 → a20 works
    expect(st().moveWireEnd('W1', 'from', 'b20').ok).toBe(true)
    expect(st().moveWireEnd('W1', 'from', 'a20').ok).toBe(true)
    // to an off-board terminal of a placed instrument
    expect(st().moveWireEnd('W1', 'to', 'PS1:-').ok).toBe(true)
    expect(st().layout.wires.find((w) => w.id === 'W1')?.to).toBe('PS1:-')
  })

  it('swapLeads swaps a two-lead part’s holes in one undo step', () => {
    setDocument(BENCH)
    expect(canSwapLeads(st().layout, 'LED1')).toBe(true)
    expect(canSwapLeads(st().layout, 'PS1')).toBe(false)
    expect(canSwapLeads(st().layout, 'NOPE')).toBe(false)
    expect(st().swapLeads('LED1')).toEqual({ ok: true })
    expect(st().layout.components.find((c) => c.id === 'LED1')?.holes).toEqual(['c42', 'c40'])
    st().undo()
    expect(st().layout.components.find((c) => c.id === 'LED1')?.holes).toEqual(['c40', 'c42'])
    expect(st().swapLeads('PS1')).toEqual({ ok: false })
  })
})

// ---------------------------------------------------------------------------
// load-time id normalisation
// ---------------------------------------------------------------------------

/** An older document: two pushbuttons PB1 / PB2, a slide switch SW1 and a wire named like a button. */
const OLD: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'SW1', type: 'slide_switch', holes: ['a5', 'a6', 'a7'] },
    { id: 'PB1', type: 'pushbutton', at: 'f40' },
    { id: 'PB2', type: 'pushbutton', at: 'f48' },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'sw2', from: 'a40', to: 'top-30', color: 'black' },
  ],
}

describe('H8 pushbutton ids PB<n> → SW<n> on load', () => {
  it('migrateComponentIds: the lowest free SW<n> (case-insensitive), w<n> wires → W<n>, the same object when nothing matches', () => {
    const m = migrateComponentIds(OLD)
    // SW1 is the slide switch, "sw2" a wire: PB1 → SW3, PB2 → SW4; IS-18: the wire w1 → W1
    expect(m.renames).toEqual({ w1: 'W1', PB1: 'SW3', PB2: 'SW4' })
    expect(m.layout.components.map((c) => c.id)).toEqual(['PS1', 'SW1', 'SW3', 'SW4', 'U1'])
    expect(m.layout.wires).toEqual([{ ...OLD.wires[0], id: 'W1' }, OLD.wires[1]])
    expect(migrateComponentIds(m.layout).layout).toBe(m.layout)
    expect(migrateComponentIds(EMPTY).layout).toBe(EMPTY)
    // a part that is not a pushbutton keeps a PB-looking id
    const odd: CircuitLayout = { version: 1, components: [{ id: 'PB7', type: 'resistor', holes: ['a1', 'a5'] }], wires: [] }
    expect(migrateComponentIds(odd).layout).toBe(odd)
  })

  it('keeps the number when SW<n> is free, whatever the order in the file (lesson checks name SW1 / SW2)', () => {
    // PB1 was deleted and placed again, so it comes after PB2 in the file
    const reordered: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PB2', type: 'pushbutton', at: 'f48' },
        { id: 'PB1', type: 'pushbutton', at: 'f40' },
        { id: 'PB01', type: 'pushbutton', at: 'f30' },
      ],
      wires: [{ id: 'W1', from: 'a40', to: 'top-30', color: 'black' }],
    }
    const m = migrateComponentIds(reordered)
    // PB01 wants SW1 too (taken by PB1): the lowest free one
    expect(m.renames).toEqual({ PB2: 'SW2', PB1: 'SW1', PB01: 'SW3' })
    expect(m.layout.components.map((c) => c.id)).toEqual(['SW2', 'SW1', 'SW3'])
    // a slide switch already called SW2: PB2 moves to the lowest free number
    const clash: CircuitLayout = {
      version: 1,
      components: [
        { id: 'SW2', type: 'slide_switch', holes: ['a5', 'a6', 'a7'] },
        { id: 'PB2', type: 'pushbutton', at: 'f48' },
      ],
      wires: [],
    }
    expect(migrateComponentIds(clash).renames).toEqual({ PB2: 'SW1' })
    // an id that merely looks like an Object member is never a rename
    expect(renameEndpoint('constructor:x', {})).toBe('constructor:x')
  })

  it('references to a renamed id are rewritten (terminal refs, logic sources)', () => {
    expect(renameEndpoint('PB1:A1', { PB1: 'SW1' })).toBe('SW1:A1')
    expect(renameEndpoint('PB12', { PB1: 'SW1' })).toBe('PB12')
    expect(renameEndpoint('a40', { PB1: 'SW1' })).toBe('a40')
    const chans = [
      { index: 0, label: 'X', source: { kind: 'net' as const, ref: 'PB1:A1' } },
      { index: 1, label: 'PA5', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA5' } },
    ]
    const out = renameLogicChannels(chans, { PB1: 'SW1' })
    expect(out[0].source).toEqual({ kind: 'net', ref: 'SW1:A1' })
    expect(out[1]).toBe(chans[1])
    expect(renameLogicChannels(chans, {})).toBe(chans)
  })

  it('store.loadLayout renames (lessons, examples, AI apply) and reports the renames', () => {
    expect(st().loadLayout(OLD).ok).toBe(true)
    const ids = st().layout.components.map((c) => c.id)
    expect(ids).toContain('SW3')
    expect(ids).not.toContain('PB1')
    expect(lastLoadRenames()).toEqual({ w1: 'W1', PB1: 'SW3', PB2: 'SW4' })
    st().loadLayout(BENCH)
    expect(lastLoadRenames()).toEqual({})
  })

  it('project files: layout, firmware keys and logic channels come back with the new ids', () => {
    const text = serializeProject({
      layout: OLD,
      firmware: {},
      instruments: { logicChannels: [{ index: 0, label: 'button', source: { kind: 'net', ref: 'f40' } }] },
    })
    const res = parseProject(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ids = res.project.layout.components.map((c) => c.id)
    expect(ids).toEqual(['PS1', 'SW1', 'SW3', 'SW4', 'U1'])
    expect(res.project.instruments?.logicChannels[0].source).toEqual({ kind: 'net', ref: 'f40' })
    // a bare legacy layout (formatVersion 0) goes through the same path
    const legacy = parseProject(JSON.stringify(OLD))
    expect(legacy.ok && legacy.project.layout.components.some((c) => c.id === 'PB1')).toBe(false)
  })
})

describe('H8 the autosave boot path renames too', () => {
  it('a saved layout with PB1 boots as SW<n>', async () => {
    const saved = new Map<string, string>([['bb.layout', JSON.stringify(OLD)]])
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => saved.get(k) ?? null,
        // read-only: a debounced autosave of the PREVIOUS store module (the
        // tests above load layouts) may fire during the slow import below and
        // must not replace the saved document this test boots from
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    })
    try {
      vi.resetModules()
      const fresh = await import('../src/state/store')
      const ids = fresh.useStore.getState().layout.components.map((c) => c.id)
      expect(ids).toEqual(['PS1', 'SW1', 'SW3', 'SW4', 'U1'])
      // IS-18: the lower-case wire w1 boots as W1 too
      expect(fresh.lastLoadRenames()).toEqual({ w1: 'W1', PB1: 'SW3', PB2: 'SW4' })
      expect(fresh.useStore.getState().layout.wires.map((w) => w.id)).toEqual(['W1', 'sw2'])
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
