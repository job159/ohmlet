/**
 * Wave-3 integration follow-ups in the model layer and the store:
 *  - CatalogEntry.allowedRotations (relay_5v, level_shifter_4ch: 0 / 180)
 *    honored by validateLayout, the store's rotateArmed / rotatePlaced /
 *    addComponent and the placement ghost (placementValid);
 *  - defect B3: two pins of one rigid package in the same breadboard strip
 *    (not bridged inside the part) — an error for documented supply/signal
 *    pins, a warning for bare switch contacts (the pushbutton);
 *  - CatalogEntry.source: the validator's supply checks accept batteries and
 *    the lab current source;
 *  - zh-TW display texts of the new messages (src/i18n/zh-TW/messages-integration.ts).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { CATALOG } from '../src/model/catalog'
import type { CatalogEntry } from '../src/model/catalog'
import type { CircuitLayout, ComponentInstance, Rotation } from '../src/model/types'
import { allowedRotationsOf, stripShorts, validateLayout } from '../src/model/validate'
import { componentPinHoles, formatHole } from '../src/model/breadboard'
import { __resetHistoryForTests, placementValid, useStore } from '../src/state/store'
import { __setLangForTests } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'

let wseq = 0
const w = (from: string, to: string) => ({ id: `w${++wseq}`, from, to })
const ps = (): ComponentInstance => ({ id: 'PS1', type: 'power_supply', params: { voltage: 5 } })
const powered = (comps: ComponentInstance[], wires: ReturnType<typeof w>[] = []): Record<string, unknown> => ({
  version: 1,
  components: [ps(), ...comps],
  wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), ...wires],
})
const at = (id: string, type: string, anchor: string, rotation?: Rotation): ComponentInstance =>
  rotation === undefined ? { id, type, at: anchor } : { id, type, at: anchor, rotation }

// ------------------------------------------------------- allowedRotations

describe('CatalogEntry.allowedRotations', () => {
  it('relay_5v and level_shifter_4ch only take 0 / 180', () => {
    expect(CATALOG.relay_5v.allowedRotations).toEqual([0, 180])
    expect(CATALOG.level_shifter_4ch.allowedRotations).toEqual([0, 180])
    expect(allowedRotationsOf(CATALOG.relay_5v)).toEqual([0, 180])
    expect(allowedRotationsOf(CATALOG.pushbutton)).toEqual([0, 90, 180, 270])
    expect(allowedRotationsOf(CATALOG.ne555)).toEqual([0, 180])
    expect(allowedRotationsOf(CATALOG.resistor)).toEqual([0])
  })

  it('the validator refuses the other quarter turns with an actionable message', () => {
    for (const [type, anchor] of [
      ['relay_5v', 'd20'],
      ['level_shifter_4ch', 'g20'],
    ] as const) {
      for (const r of [90, 270] as Rotation[]) {
        const res = validateLayout(powered([at('X1', type, anchor, r)]))
        expect(res.ok, `${type} ${r}`).toBe(false)
        expect(res.errors.join('\n')).toContain(
          `component "X1" (${type}) cannot use rotation ${r} — this part only fits the breadboard at rotation 0 or 180`,
        )
      }
    }
  })

  it('180 works where the mirrored pins straddle the channel (anchor on the other side)', () => {
    // relay: COIL1 g20, COIL2 d20, COM f21, NO d15, NC g15
    const relay = validateLayout(powered([at('K1', 'relay_5v', 'g20', 180)]))
    expect(relay.errors).toEqual([])
    expect(relay.layout?.components.find((c) => c.id === 'K1')?.rotation).toBe(180)
    // level shifter: LV row in row d, HV row in row g
    const ls = validateLayout(powered([at('LS1', 'level_shifter_4ch', 'd20', 180)]))
    expect(ls.errors).toEqual([])
  })
})

// ------------------------------------------------------------- defect B3

describe('defect B3: two pins of one package in the same strip', () => {
  it('relay at 180 anchored in row d: COIL1 d20 and COIL2 a20 share a strip → error', () => {
    const res = validateLayout(powered([at('K1', 'relay_5v', 'd20', 180)]))
    expect(res.ok).toBe(false)
    expect(res.errors).toContain(
      'component "K1" (relay_5v) at "d20" rotation 180 puts pins COIL1 and COIL2 into one breadboard strip (d20 and a20 are the same net) — the strip shorts them together; choose a rotation or anchor that gives every pin its own strip (straddle the center channel)',
    )
  })

  it('a level shifter turned in place (anchor still in row g) shorts LVn to HVn → error', () => {
    const res = validateLayout(powered([at('LS1', 'level_shifter_4ch', 'g20', 180)]))
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('puts pins LV1 and HV1 into one breadboard strip'))).toBe(true)
  })

  it('a single-row header turned 90° (the B3 module case) shorts every pin; internal bridges are exempt', () => {
    const header: CatalogEntry = {
      type: 'test_header4',
      label: '4-pin module',
      category: 'module',
      placement: 'footprint',
      pins: ['VCC', 'GND', 'SCL', 'GND2'],
      footprintOffsets: [0, 1, 2, 3].map((dCol) => ({ dCol, row: 'b' as const })),
      internalBridges: [['GND', 'GND2']],
      pinInfo: [
        { pin: 'VCC', kind: 'power' },
        { pin: 'GND', kind: 'ground' },
        { pin: 'SCL', kind: 'io' },
        { pin: 'GND2', kind: 'ground' },
      ],
      sim: { kind: 'probe' },
      doc: 'test',
    }
    const flat = componentPinHoles({ id: 'M1', type: header.type, at: 'b10' }, header)!
    expect(stripShorts(header, flat)).toEqual([])
    const turned = componentPinHoles({ id: 'M1', type: header.type, at: 'a10', rotation: 90 }, header)!
    const shorts = stripShorts(header, turned)
    // VCC a10, GND b10, SCL c10, GND2 d10 — all one strip; GND2 is bridged to GND
    expect(shorts.map((s) => [header.pins[s.a], header.pins[s.b], s.severe])).toEqual([
      ['VCC', 'GND', true],
      ['VCC', 'SCL', true],
    ])
    expect(shorts[0].holeA).toBe('a10')
    expect(shorts[0].holeB).toBe('b10')
  })

  it('bare switch contacts (pushbutton A/B in one strip) are only a warning — the button is bypassed', () => {
    const res = validateLayout(powered([at('SW1', 'pushbutton', 'f20', 90)]))
    expect(res.errors).toEqual([])
    expect(res.warnings).toContain(
      'component "SW1" (pushbutton) at "f20" rotation 90 puts pins A1 and B1 into one breadboard strip (f20 and h20 are the same net) — the strip connects them permanently, so that part of the circuit is bypassed',
    )
    // straddling the channel the rotated button is clean
    const ok = validateLayout(powered([at('SW2', 'pushbutton', 'e20', 90)]))
    expect(ok.errors).toEqual([])
    expect(ok.warnings.filter((x) => x.includes('breadboard strip'))).toEqual([])
  })

  it('every catalog package at rotation 0 at its documented anchor has no shorted pins', () => {
    for (const entry of Object.values(CATALOG)) {
      if (entry.placement !== 'dip' && entry.placement !== 'footprint') continue
      const anchorRow = entry.placement === 'dip' ? 'f' : entry.footprintOffsets?.[0]?.row
      if (!anchorRow) continue
      const holes = componentPinHoles({ id: 'X', type: entry.type, at: `${anchorRow}10` }, entry, { size: 'labxl', count: 1, rows: 1 })
      if (!holes) continue
      expect(stripShorts(entry, holes), entry.type).toEqual([])
    }
  })
})

// ------------------------------------------------------------------ store

function resetStore(layout?: CircuitLayout): void {
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({
    layout: layout ?? { version: 1, components: [], wires: [] },
    selection: [],
    mode: { kind: 'select' },
    canUndo: false,
    canRedo: false,
  })
}
const st = () => useStore.getState()

describe('store: rotation honors allowedRotations and B3', () => {
  beforeEach(() => resetStore())
  afterAll(() => resetStore())

  it('rotateArmed cycles 0 ↔ 180 for the relay and the level shifter', () => {
    for (const type of ['relay_5v', 'level_shifter_4ch']) {
      st().setMode({ kind: 'place', type, pickedHoles: [] })
      const seen: (Rotation | undefined)[] = []
      for (let i = 0; i < 4; i++) {
        st().rotateArmed()
        const m = st().mode
        seen.push(m.kind === 'place' ? m.rotation : undefined)
      }
      expect(seen, type).toEqual([180, 0, 180, 0])
    }
  })

  it('the placement ghost (placementValid) agrees with addComponent', () => {
    const L = () => st().layout
    expect(placementValid(L(), 'relay_5v', 'd20')).toBe(true)
    expect(placementValid(L(), 'relay_5v', 'd20', [], 90)).toBe(false) // not an allowed rotation
    expect(placementValid(L(), 'relay_5v', 'g20', [], 180)).toBe(true)
    expect(placementValid(L(), 'relay_5v', 'd20', [], 180)).toBe(false) // B3: COIL1/COIL2 in one strip
    st().addComponent('relay_5v', { at: 'd20', rotation: 90 })
    st().addComponent('relay_5v', { at: 'd20', rotation: 180 })
    expect(L().components).toHaveLength(0)
    st().addComponent('relay_5v', { at: 'g20', rotation: 180 })
    expect(L().components).toHaveLength(1)
    expect(L().components[0].rotation).toBe(180)
    expect(validateLayout(L()).ok).toBe(true)
    // the bypassed pushbutton (warning only) is still placeable, like before
    expect(placementValid(L(), 'pushbutton', 'f40', [], 90)).toBe(true)
  })

  it('rotatePlaced turns a straddling package about its body center when pin 1 cannot be the pivot', () => {
    // about pin 1 the level shifter's 180 would short LVn to HVn (B3): it turns
    // about its center instead — same six columns, LV row now in row d
    st().addComponent('level_shifter_4ch', { at: 'g20' })
    const id = st().layout.components[0].id
    const before = [...occupied()]
    expect(st().rotatePlaced(id)).toEqual({ ok: true })
    expect(st().layout.components[0]).toMatchObject({ at: 'd25', rotation: 180 })
    expect([...occupied()].sort()).toEqual(before.sort())
    expect(validateLayout(st().layout).ok).toBe(true)
    // and back (0° needs pin 1 in row g again): one undo step each
    expect(st().rotatePlaced(id)).toEqual({ ok: true })
    expect(st().layout.components[0].at).toBe('g20')
    expect(st().layout.components[0].rotation).toBeUndefined()
    st().undo()
    expect(st().layout.components[0]).toMatchObject({ at: 'd25', rotation: 180 })

    // the relay the same way (COIL1 d20 → g24, the body keeps columns 19…25)
    resetStore()
    st().addComponent('relay_5v', { at: 'd20' })
    const k = st().layout.components[0].id
    expect(st().rotatePlaced(k)).toEqual({ ok: true })
    expect(st().layout.components[0]).toMatchObject({ at: 'g24', rotation: 180 })
    // the mirrored pin pattern inside the same pin rectangle (columns 19…25, rows d…g)
    expect([...occupied()].sort()).toEqual(['d19', 'd24', 'f25', 'g19', 'g24'])
    expect(validateLayout(st().layout).ok).toBe(true)
  })

  it('rotatePlaced keeps the legacy pivot (pin 1) for parts that turn cleanly about it', () => {
    st().addComponent('pushbutton', { at: 'f10' })
    const id = st().layout.components[0].id
    expect(st().rotatePlaced(id)).toEqual({ ok: true })
    expect(st().layout.components[0]).toMatchObject({ at: 'f10', rotation: 90 })
  })
})

/** Holes occupied by every component pin of the current layout. */
function occupied(): Set<string> {
  const out = new Set<string>()
  for (const c of st().layout.components) {
    for (const h of componentPinHoles(c, CATALOG[c.type]) ?? []) if (h) out.add(formatHole(h))
  }
  return out
}

// --------------------------------------------------------------- sources

describe('validator: independent sources power the circuit (CatalogEntry.source)', () => {
  it('a battery-only layout gets no "no power_supply" warning; chip supply pins on the battery terminals are fine', () => {
    const res = validateLayout({
      version: 1,
      components: [
        { id: 'B1', type: 'battery_9v' },
        { id: 'U1', type: 'ne555', at: 'f10' },
      ],
      // ne555 at f10: GND = f10 (pin 1), VCC = e10 (pin 8)
      wires: [w('B1:+', 'top+0'), w('B1:-', 'top-0'), w('a10', 'top+1'), w('j10', 'top-1')],
    })
    expect(res.ok).toBe(true)
    expect(res.warnings.filter((x) => x.includes('power_supply') || x.includes('power supply'))).toEqual([])
  })

  it('without any source the legacy warning remains', () => {
    const res = validateLayout({ version: 1, components: [{ id: 'R1', type: 'resistor', holes: ['a1', 'a5'] }], wires: [] })
    expect(res.warnings.some((x) => x.startsWith('no power_supply in the layout'))).toBe(true)
  })
})

// ------------------------------------------------------------------ zh-TW

describe('zh-TW display texts of the new messages', () => {
  afterAll(() => __setLangForTests('zh-TW'))

  it('translates every new validator message with full-width punctuation', () => {
    __setLangForTests('zh-TW')
    const msgs = [
      ...validateLayout(powered([at('K1', 'relay_5v', 'd20', 90)])).errors.filter((e) => e.includes('cannot use rotation')),
      ...validateLayout(powered([at('K1', 'relay_5v', 'd20', 180)])).errors.filter((e) => e.includes('breadboard strip')),
      ...validateLayout(powered([at('SW1', 'pushbutton', 'f20', 90)])).warnings.filter((e) => e.includes('breadboard strip')),
      'component T1 model error: Error: boom',
    ]
    expect(msgs.length).toBe(5)
    for (const m of msgs) {
      expect(hasMessageTranslation(m), m).toBe(true)
      const zh = tMessage(m)
      expect(zh, m).not.toBe(m)
      expect(zh).toMatch(/[一-鿿]/)
    }
    // the facts survive the translation (dictionaries: src/i18n/zh-TW/messages-*.ts)
    expect(tMessage(msgs[0])).toContain('K1')
    expect(tMessage(msgs[0])).toContain('180')
    for (const token of ['COIL1', 'COIL2', 'd20', 'a20']) expect(tMessage(msgs[1])).toContain(token)
    __setLangForTests('en')
    expect(tMessage(msgs[0])).toBe(msgs[0])
  })
})
