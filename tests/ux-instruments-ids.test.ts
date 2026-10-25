/**
 * UX fix wave — instruments IS-18 (H8 ids): one circuit never mixes
 * 「導線 w5」 and 「導線 W2」 (docs/ux/UX_VERIFY.md §5.4 「導線代號一律寫成 W1」).
 *  - load-time normalisation: a wire 'w<n>' becomes 'W<n>' (same number;
 *    a collision takes the lowest free W<n>), in project files, the
 *    autosave path and store.loadLayout (examples, lessons, AI apply);
 *  - the example library is emitted with W ids, so opening blink and
 *    drawing a wire gives W1 … W8;
 *  - an old project file with lower-case wires loads with W ids and its
 *    instruments still bound.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import { migrateComponentIds, parseProject, serializeProject } from '../src/state/project'
import { __resetHistoryForTests, lastLoadRenames, useStore } from '../src/state/store'

const st = () => useStore.getState()

beforeEach(() => {
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
})

const example = (id: string) =>
  JSON.parse(readFileSync(new URL(`../examples/embedded/${id}.ohmlet.json`, import.meta.url), 'utf8')) as { layout: CircuitLayout }

describe('IS-18 wire ids', () => {
  it('w<n> → W<n>; a mixed document keeps its W ids; a clash takes the lowest free number', () => {
    const mixed: CircuitLayout = {
      version: 1,
      components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }],
      wires: [
        { id: 'w5', from: 'PS1:+', to: 'top+0', color: 'red' },
        { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
        { id: 'w2', from: 'a10', to: 'a20', color: 'yellow' },
      ],
    }
    const m = migrateComponentIds(mixed)
    expect(m.layout.wires.map((w) => w.id)).toEqual(['W5', 'W2', 'W1'])
    expect(m.renames).toEqual({ w5: 'W5', w2: 'W1' })
    // endpoints and colours untouched; a second pass changes nothing
    expect(m.layout.wires[0]).toEqual({ ...mixed.wires[0], id: 'W5' })
    expect(migrateComponentIds(m.layout).layout).toBe(m.layout)
  })

  it('every example of the library is emitted with W ids', () => {
    for (const id of ['blink', 'pwm-fade', 'i2c-scan', 'spi-595', 'uart-hello', 'button-exti']) {
      const ids = example(id).layout.wires.map((w) => w.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(ids.every((w) => /^W\d+$/.test(w)), `${id}: ${ids.join(' ')}`).toBe(true)
    }
  })

  it('opening blink and drawing a wire gives W1 … W8 (no w / W mix)', () => {
    const blink = example('blink').layout
    expect(st().loadLayout(blink).ok).toBe(true)
    st().addWire('a50', 'a55', 'yellow')
    const ids = st().layout.wires.map((w) => w.id)
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => `W${i + 1}`))
    expect(ids[ids.length - 1]).toBe(`W${ids.length}`)
  })

  it('a lesson-style layout with w ids loads as W ids and reports the renames', () => {
    const lesson: CircuitLayout = {
      version: 1,
      components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }],
      wires: [
        { id: 'w1', from: 'PS1:+', to: 'top+0', color: 'red' },
        { id: 'w2', from: 'PS1:-', to: 'top-0', color: 'black' },
      ],
    }
    expect(st().loadLayout(lesson).ok).toBe(true)
    expect(st().layout.wires.map((w) => w.id)).toEqual(['W1', 'W2'])
    expect(lastLoadRenames()).toEqual({ w1: 'W1', w2: 'W2' })
    st().addWire('a30', 'a35')
    expect(st().layout.wires.map((w) => w.id)).toEqual(['W1', 'W2', 'W3'])
  })

  it('an old project file (lower-case wires) loads with W ids and its logic channels', () => {
    const old = example('uart-hello').layout
    const lower: CircuitLayout = { ...old, wires: old.wires.map((w) => ({ ...w, id: w.id.toLowerCase() })) }
    const text = serializeProject({
      layout: lower,
      firmware: {},
      instruments: { logicChannels: [{ index: 0, label: 'PA9 TX', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA9' } }] },
    })
    const res = parseProject(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.project.layout.wires.map((w) => w.id)).toEqual(old.wires.map((w) => w.id))
    expect(res.project.instruments?.logicChannels).toEqual([{ index: 0, label: 'PA9 TX', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA9' } }])
  })
})
