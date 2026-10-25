/**
 * Per-type off-board geometry (CatalogEntry.offboard): an off-board part may
 * declare its own terminal pitch, terminal-0 offset and body footprint so
 * multi-terminal bench units (L298N 13 terminals, ULN2003 10, 28BYJ-48 5)
 * fit their real size. Covers the model helpers (src/model/breadboard.ts),
 * the validator's body-rect rules, the router's instrument obstacle boxes
 * (src/three/internal/wires.ts), the store's grid-growth auto-nudge, the
 * default shelf, and that every bench mesh stays inside its declared rect.
 * A part WITHOUT `offboard` must keep today's geometry exactly.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { CatalogEntry } from '../src/model/catalog'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout, ComponentInstance } from '../src/model/types'
import {
  boardExtents,
  OFFBOARD_APRON,
  OFFBOARD_BODY_HEIGHT,
  OFFBOARD_SHELF_CLEARANCE,
  OFFBOARD_SHELF_PITCH,
  OFFBOARD_SHELF_RIGHT,
  offboardBodyPosition,
  offboardBodyRect,
  offboardGeometryOf,
  offboardSlotSpan,
  offboardTerminalPosition,
} from '../src/model/breadboard'
import { validateLayout } from '../src/model/validate'
import { instrumentsForLayout } from '../src/three/internal/wires'
import { buildComponentObject, disposeComponentObject } from '../src/three/component-meshes'
import { __resetHistoryForTests, useStore } from '../src/state/store'

// ---------------------------------------------------------------- helpers

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }

const OFFBOARD: CatalogEntry[] = Object.values(CATALOG).filter((e) => e.placement === 'offboard')
const LEGACY = OFFBOARD.filter((e) => e.offboard === undefined)
const OWN = OFFBOARD.filter((e) => e.offboard !== undefined)
/** declared a body of its own (rect or terminal offset) — moves off the legacy shelf formula */
const OWN_BODY = OWN.filter((e) => e.offboard?.rect !== undefined || e.offboard?.terminalOffset !== undefined)

const entry = (type: string): CatalogEntry => {
  const e = CATALOG[type]
  if (!e) throw new Error(`no catalog entry ${type}`)
  return e
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

const onHalfGrid = (v: number): boolean => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9

/** The pre-`offboard` (legacy) formulas, written out independently. */
const legacy = {
  body: (slot: number, pos?: { x: number; z: number }) => pos ?? { x: -10, z: slot * 7 },
  terminal: (slot: number, i: number, pos?: { x: number; z: number }) => {
    const a = pos ?? { x: -10, z: slot * 7 }
    return { x: a.x + 2 + i * 2.5, z: a.z + 2 }
  },
  rect: (slot: number, pos?: { x: number; z: number }): Rect => {
    const a = pos ?? { x: -10, z: slot * 7 }
    return { minX: a.x, maxX: a.x + 6.5, minZ: a.z - 2, maxZ: a.z + 2.5 }
  },
}

/** Off-board-only layout: the given types in order, optional explicit positions. */
function benchLayout(units: { type: string; pos?: { x: number; z: number } }[], extra: Partial<CircuitLayout> = {}): CircuitLayout {
  return {
    version: 1,
    ...extra,
    components: units.map((u, i) => ({ id: `U${i + 1}`, type: u.type, ...(u.pos ? { pos: u.pos } : {}) })),
    wires: [],
  }
}

/** World bounding box of the VISIBLE meshes of a built part. */
function visibleMeshBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return
    m.geometry.computeBoundingBox()
    const b = m.geometry.boundingBox
    if (b) box.union(b.clone().applyMatrix4(m.matrixWorld))
  })
  return box
}

/** Build a bench unit exactly as the scene does (terminal posts at the per-type positions). */
function buildAt(e: CatalogEntry, slot: number, pos?: { x: number; z: number }): THREE.Box3 {
  const comp: ComponentInstance = { id: `X_${e.type}`, type: e.type, ...(pos ? { pos } : {}) }
  const pins = e.pins.map((_, i) => {
    const p = offboardTerminalPosition(slot, i, pos, e.offboard)
    return new THREE.Vector3(p.x, 0, p.z)
  })
  const built = buildComponentObject(comp, e, pins)
  const box = visibleMeshBox(built.object)
  disposeComponentObject(built.object)
  return box
}

// ------------------------------------------------------- legacy is untouched

describe('absent `offboard` = the legacy instrument geometry exactly', () => {
  it('the defaults resolve to pitch 2.5, terminal 0 at (2, 2), a 6.5 × 4.5 rect', () => {
    expect(offboardGeometryOf(undefined)).toEqual({ pitch: 2.5, w: 6.5, d: 4.5, ox: 2, oz: 2 })
    expect(offboardGeometryOf(null)).toEqual(offboardGeometryOf({}))
  })

  it('the bench PSU, function generator, multimeter, batteries and current source declare nothing', () => {
    const types = LEGACY.map((e) => e.type)
    for (const t of ['power_supply', 'function_generator', 'multimeter', 'battery_9v', 'battery_aa2', 'current_source']) {
      if (CATALOG[t]) expect(types).toContain(t)
    }
  })

  it('every legacy part: terminals, anchor and rect match the legacy formulas (shelf and explicit pos)', () => {
    for (const e of LEGACY) {
      for (const pos of [undefined, { x: 30, z: -10 }, { x: -22.5, z: 24.5 }]) {
        for (let slot = 0; slot < 4; slot++) {
          expect(offboardBodyPosition(slot, pos, e.offboard)).toEqual(legacy.body(slot, pos))
          expect(offboardBodyRect(slot, pos, e.offboard)).toEqual(legacy.rect(slot, pos))
          for (let i = 0; i < e.pins.length; i++) {
            expect(offboardTerminalPosition(slot, i, pos, e.offboard)).toEqual(legacy.terminal(slot, i, pos))
          }
        }
      }
    }
  })

  it('a pitch-only geometry keeps the legacy anchor and rect (only the terminal spacing changes)', () => {
    const g = { terminalPitch: 1 }
    expect(offboardBodyPosition(2, undefined, g)).toEqual({ x: -10, z: 14 })
    expect(offboardBodyRect(2, undefined, g)).toEqual(legacy.rect(2))
    expect(offboardTerminalPosition(2, 3, undefined, g)).toEqual({ x: -10 + 2 + 3, z: 16 })
  })
})

// ------------------------------------------------------ per-type geometry

describe('per-type geometry formulas', () => {
  const g = { terminalPitch: 0.6, terminalOffset: { x: 2.5, z: 2 }, rect: { w: 10.25, d: 7 } }

  it('terminal i at anchor + (ox + pitch·i, oz); the rect front edge an apron in front of the row', () => {
    const pos = { x: 30, z: -10 }
    for (let i = 0; i < 13; i++) {
      const p = offboardTerminalPosition(5, i, pos, g)
      expect(p.x).toBeCloseTo(32.5 + 0.6 * i, 9)
      expect(p.z).toBe(-8)
    }
    expect(offboardBodyPosition(5, pos, g)).toEqual(pos)
    expect(offboardBodyRect(5, pos, g)).toEqual({ minX: 30, maxX: 40.25, minZ: -8 + OFFBOARD_APRON - 7, maxZ: -8 + OFFBOARD_APRON })
  })

  it('a partial geometry fills the missing fields from the legacy values', () => {
    const rectOnly = { rect: { w: 8, d: 6 } }
    const pos = { x: 0, z: 0 }
    expect(offboardTerminalPosition(0, 1, pos, rectOnly)).toEqual({ x: 2 + 2.5, z: 2 })
    expect(offboardBodyRect(0, pos, rectOnly)).toEqual({ minX: 0, maxX: 8, minZ: 2.5 - 6, maxZ: 2.5 })
    const offsetOnly = { terminalOffset: { x: 1, z: 3 } }
    expect(offboardTerminalPosition(0, 0, pos, offsetOnly)).toEqual({ x: 1, z: 3 })
    expect(offboardBodyRect(0, pos, offsetOnly)).toEqual({ minX: 0, maxX: 6.5, minZ: 3.5 - 4.5, maxZ: 3.5 })
  })
})

// --------------------------------------------- the motor bench units' data

describe('multi-terminal motor / driver bench units fit their real size', () => {
  it.each([
    ['l298n_module', 13],
    ['uln2003_board', 10],
    ['stepper_28byj48', 5],
  ])('%s declares a finer pitch for its %i terminals and a rect holding the whole row', (type, n) => {
    const e = entry(type)
    expect(e.pins).toHaveLength(n)
    expect(e.offboard?.terminalPitch).toBeDefined()
    expect(e.offboard!.terminalPitch!).toBeLessThan(2.5)
    // the legacy pitch would have run the row far past the legacy 6.5 rect
    expect(2 + 2.5 * (n - 1)).toBeGreaterThan(6.5)
  })

  it.each(OWN.map((e) => [e.type, e] as const))('%s: every terminal sits inside its rect, the row on one line', (_t, e) => {
    const g = offboardGeometryOf(e.offboard)
    for (const pos of [undefined, { x: 12, z: 31.5 }]) {
      const r = offboardBodyRect(1, pos, e.offboard)
      for (let i = 0; i < e.pins.length; i++) {
        const p = offboardTerminalPosition(1, i, pos, e.offboard)
        expect(p.x).toBeGreaterThan(r.minX)
        // a post proxy (≤ 0.9 wide, narrowed to the pitch) still lies inside
        expect(p.x + Math.min(0.45, g.pitch / 2)).toBeLessThanOrEqual(r.maxX + 1e-9)
        expect(p.z).toBeCloseTo(r.maxZ - OFFBOARD_APRON, 9)
      }
    }
    expect(g.pitch).toBeGreaterThan(0)
    expect(g.d).toBeLessThanOrEqual(OFFBOARD_SHELF_PITCH)
  })

  it.each(OWN.map((e) => [e.type, e] as const))(
    '%s: the bench mesh (body, leads, terminal tips) stays inside its rect and under the router height',
    (_t, e) => {
      for (const [slot, pos] of [
        [0, { x: 0, z: 0 }],
        [2, undefined],
        [1, { x: -31.5, z: 24.5 }],
      ] as const) {
        const r = offboardBodyRect(slot, pos, e.offboard)
        const b = buildAt(e, slot, pos)
        expect(b.isEmpty()).toBe(false)
        const eps = 0.02
        expect(b.min.x).toBeGreaterThanOrEqual(r.minX - eps)
        expect(b.max.x).toBeLessThanOrEqual(r.maxX + eps)
        expect(b.min.z).toBeGreaterThanOrEqual(r.minZ - eps)
        expect(b.max.z).toBeLessThanOrEqual(r.maxZ + eps)
        expect(b.max.y).toBeLessThanOrEqual(OFFBOARD_BODY_HEIGHT + eps)
      }
    },
  )
})

// ------------------------------------------------------------ default shelf

/** Default-shelf slots of a list of units, numbered the way every consumer does. */
function shelfSlots(units: { type: string }[]): number[] {
  let slot = 0
  return units.map((u) => {
    const s = slot
    slot += offboardSlotSpan(entry(u.type).offboard)
    return s
  })
}

/** The router's fixed exit run from an instrument terminal (wire-router.ts EXIT_RUN). */
const EXIT_RUN = 1.5

describe('default shelf', () => {
  const board = boardExtents('standard')

  it('own-body units right-align to the shelf: never over the board, on the 0.5 grid, back edge on the shelf line', () => {
    for (const e of OWN_BODY) {
      for (let slot = 0; slot < 6; slot += 0.5) {
        const a = offboardBodyPosition(slot, undefined, e.offboard)
        const r = offboardBodyRect(slot, undefined, e.offboard)
        expect(onHalfGrid(a.x) && onHalfGrid(a.z)).toBe(true)
        expect(r.maxX).toBeLessThanOrEqual(OFFBOARD_SHELF_RIGHT)
        expect(r.maxX).toBeLessThanOrEqual(board.minX - 3)
        expect(OFFBOARD_SHELF_RIGHT - r.maxX).toBeLessThan(0.5) // right-aligned (grid snap only)
        // the back edge sits on a legacy unit's back line (≤ 0.25 in front of it: anchor grid snap)
        expect(r.minZ - legacy.rect(slot).minZ).toBeGreaterThanOrEqual(0)
        expect(r.minZ - legacy.rect(slot).minZ).toBeLessThan(0.5)
        if (offboardSlotSpan(e.offboard) === 1) {
          // a unit no deeper than the legacy one lands exactly where a legacy unit does
          expect(r.maxZ).toBe(legacy.rect(slot).maxZ)
          expect(offboardTerminalPosition(slot, 0, undefined, e.offboard).z).toBe(legacy.terminal(slot, 0).z)
        }
      }
    }
  })

  it('legacy units keep x = −10 (their rect also ends at the shelf edge)', () => {
    expect(legacy.rect(0).maxX).toBe(OFFBOARD_SHELF_RIGHT)
  })

  it('slot spans: 1 for every legacy part (slot = index), half-slot steps for deep units', () => {
    for (const e of LEGACY) expect(offboardSlotSpan(e.offboard)).toBe(1)
    expect(offboardSlotSpan(undefined)).toBe(1)
    expect(offboardSlotSpan({ terminalPitch: 1 })).toBe(1) // pitch only: the legacy body
    for (const e of OFFBOARD) {
      const span = offboardSlotSpan(e.offboard)
      expect(span).toBeGreaterThanOrEqual(1)
      expect(onHalfGrid(span)).toBe(true)
    }
    // the 7-deep boards and the deeper motors need more than one slot; the 130 motor does not
    for (const t of ['uln2003_board', 'l298n_module', 'stepper_28byj48', 'nema17_stepper']) {
      expect(offboardSlotSpan(entry(t).offboard), t).toBeGreaterThan(1)
    }
    expect(offboardSlotSpan(entry('dc_motor').offboard)).toBe(1)
    // a legacy-only layout numbers its shelf exactly like before: slot = index
    expect(shelfSlots(LEGACY.map((e) => ({ type: e.type })))).toEqual(LEGACY.map((_, i) => i))
  })

  it('every unit keeps the legacy clearance in front of its terminal row before the next unit', () => {
    expect(OFFBOARD_SHELF_CLEARANCE).toBe(7 - 4.5)
    for (const a of OFFBOARD) {
      for (const b of OFFBOARD) {
        const units = [{ type: 'power_supply' }, { type: a.type }, { type: b.type }]
        const slots = shelfSlots(units)
        const r0 = offboardBodyRect(slots[0], undefined, entry('power_supply').offboard)
        const ra = offboardBodyRect(slots[1], undefined, entry(a.type).offboard)
        const rb = offboardBodyRect(slots[2], undefined, entry(b.type).offboard)
        expect(ra.minZ - r0.maxZ, `power_supply → ${a.type}`).toBeGreaterThanOrEqual(OFFBOARD_SHELF_CLEARANCE)
        expect(rb.minZ - ra.maxZ, `${a.type} → ${b.type}`).toBeGreaterThanOrEqual(OFFBOARD_SHELF_CLEARANCE)
      }
    }
  })

  it("no wire's fixed exit run reaches another unit (router boxes, every pair on the shelf)", () => {
    for (const a of OFFBOARD) {
      for (const b of OFFBOARD) {
        const boxes = instrumentsForLayout(benchLayout([{ type: a.type }, { type: b.type }]))
        for (const [i, j] of [
          [0, 1],
          [1, 0],
        ]) {
          const o = boxes[j]
          for (const t of boxes[i].terminals) {
            const end = { x: t.x + t.exitDir.x * EXIT_RUN, z: t.z + t.exitDir.z * EXIT_RUN }
            // the run is a straight +z segment from the terminal to `end`
            const crosses = end.x > o.minX && end.x < o.maxX && end.z > o.minZ && t.z < o.maxZ
            expect(crosses, `${a.type} / ${b.type}: an exit of unit ${i} runs into unit ${j}`).toBe(false)
          }
        }
      }
    }
  })

  it('every pair of off-board types on the default shelf validates (no board / unit overlap)', () => {
    for (const a of OFFBOARD) {
      for (const b of OFFBOARD) {
        const res = validateLayout(benchLayout([{ type: a.type }, { type: b.type }]))
        expect(res.errors, `${a.type} then ${b.type}`).toEqual([])
      }
    }
  })

  it('every off-board type at once, in catalog and reverse order, validates', () => {
    const types = OFFBOARD.map((e) => ({ type: e.type }))
    for (const order of [types, [...types].reverse()]) {
      const res = validateLayout(benchLayout(order))
      expect(res.errors).toEqual([])
    }
  })

  /** The strip in front of every terminal row, as deep as the legacy clearance past the apron, holds no other unit. */
  function expectExitStripsClear(layout: CircuitLayout, label: string): void {
    expect(validateLayout(layout).errors, label).toEqual([])
    const boxes = instrumentsForLayout(layout)
    expect(boxes.length).toBeGreaterThan(1)
    const reach = OFFBOARD_APRON + OFFBOARD_SHELF_CLEARANCE
    for (const box of boxes) {
      for (const o of boxes) {
        if (o === box) continue
        for (const t of box.terminals) {
          const hit = t.x > o.minX && t.x < o.maxX && o.minZ < t.z + reach && o.maxZ > t.z
          expect(hit, `${label}: ${box.id} terminal at (${t.x}, ${t.z}) faces ${o.id}`).toBe(false)
        }
      }
    }
  }

  it.each(['dc-motor-l298n', 'stepper-28byj48', 'stepper-a4988', 'servo-sg90'])(
    'shipped example %s: every default-shelf terminal keeps its exit strip clear of the other units',
    (name) => {
      const file = path.resolve(__dirname, '..', 'examples', 'embedded', `${name}.ohmlet.json`)
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { layout?: CircuitLayout } & CircuitLayout
      expectExitStripsClear(raw.layout ?? raw, name)
    },
  )

  it('the default-shelf motors scene (motors-shelf-default) shelves its deep boards with clear exits', () => {
    const file = path.resolve(__dirname, 'visual', 'extra-motors.json')
    const scenes = JSON.parse(readFileSync(file, 'utf8')) as { name: string; layout: CircuitLayout }[]
    const scene = scenes.find((s) => s.name === 'motors-shelf-default')
    expect(scene).toBeDefined()
    const layout = scene!.layout
    // every unit on the default shelf, the deep boards among them
    expect(layout.components.every((c) => c.pos === undefined)).toBe(true)
    const types = layout.components.map((c) => c.type)
    for (const t of ['l298n_module', 'uln2003_board', 'stepper_28byj48']) expect(types).toContain(t)
    expectExitStripsClear(layout, scene!.name)
  })
})

// ---------------------------------------------------------------- validator

describe('validator body-rect rules use the per-type rect', () => {
  it('rejects a wide module overlapping another unit where the legacy rect would not', () => {
    // PSU at x 0..6.5; the L298N's own rect reaches x −9..1.25, the legacy one only −9..−2.5
    const lay = benchLayout([
      { type: 'power_supply', pos: { x: 0, z: 25 } },
      { type: 'l298n_module', pos: { x: -9, z: 25 } },
    ])
    expect(overlaps(legacy.rect(1, { x: -9, z: 25 }), legacy.rect(0, { x: 0, z: 25 }))).toBe(false)
    const res = validateLayout(lay)
    expect(res.ok).toBe(false)
    expect(res.errors.join('\n')).toMatch(/overlaps instrument "U1"/)
    // one grid step further left it clears
    expect(validateLayout(benchLayout([
      { type: 'power_supply', pos: { x: 0, z: 25 } },
      { type: 'l298n_module', pos: { x: -10.5, z: 25 } },
    ])).errors).toEqual([])
  })

  it('rejects a deep module reaching back over the board where the legacy rect would not', () => {
    // standard board ends at z = 18; the ULN2003 rect reaches 7 back from z + 2.5
    expect(legacy.rect(0, { x: 10, z: 22 }).minZ).toBeGreaterThan(18)
    const bad = validateLayout(benchLayout([{ type: 'uln2003_board', pos: { x: 10, z: 22 } }]))
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/overlaps the .*board/)
    expect(validateLayout(benchLayout([{ type: 'uln2003_board', pos: { x: 10, z: 23 } }])).errors).toEqual([])
  })

  it('the motor visual-regression scenes are valid layouts under the new geometry', () => {
    const file = path.resolve(__dirname, 'visual', 'extra-motors.json')
    const scenes = JSON.parse(readFileSync(file, 'utf8')) as { name: string; layout: unknown }[]
    expect(scenes.length).toBeGreaterThan(0)
    for (const s of scenes) {
      const layout = typeof s.layout === 'string' ? JSON.parse(s.layout) : s.layout
      const res = validateLayout(layout)
      expect(res.errors, s.name).toEqual([])
    }
  })
})

// ------------------------------------------------------------------- router

describe('router obstacle boxes', () => {
  it('cover the whole per-type body and put the exits on the per-type terminals', () => {
    const lay = benchLayout([
      { type: 'power_supply' },
      { type: 'l298n_module', pos: { x: 20, z: 26 } },
      { type: 'uln2003_board' },
    ])
    const boxes = instrumentsForLayout(lay)
    expect(boxes).toHaveLength(3)
    const slots = shelfSlots(lay.components) // PSU 0, L298N 1 (1.5 slots), ULN2003 2.5
    expect(slots).toEqual([0, 1, 2.5])
    lay.components.forEach((c, i) => {
      const e = entry(c.type)
      const slot = slots[i]
      const box = boxes[i]
      expect(box.id).toBe(c.id)
      expect(box).toMatchObject({ ...offboardBodyRect(slot, c.pos, e.offboard), height: OFFBOARD_BODY_HEIGHT })
      expect(box.terminals).toHaveLength(e.pins.length)
      box.terminals.forEach((t, i) => {
        expect({ x: t.x, z: t.z }).toEqual(offboardTerminalPosition(slot, i, c.pos, e.offboard))
        expect(t.exitDir).toEqual({ x: 0, z: 1 })
      })
    })
    // the legacy PSU box is byte-identical to the pre-`offboard` one
    expect(boxes[0]).toMatchObject(legacy.rect(0))
    // the L298N box spans its 10.25-wide body, not the legacy 6.5
    expect(boxes[1].maxX - boxes[1].minX).toBe(10.25)
  })
})

// -------------------------------------------------------------------- store

describe('store keeps own-body units clear of a grown board', () => {
  const st = () => useStore.getState()
  beforeEach(() => {
    st().resetSim()
    __resetHistoryForTests()
    useStore.setState({
      layout: { version: 1, components: [], wires: [] },
      selection: [],
      mode: { kind: 'select' },
      canUndo: false,
      canRedo: false,
    })
  })

  it('setInstrumentPos refuses a spot only the per-type rect overlaps', () => {
    st().addComponent('uln2003_board', {})
    const id = st().layout.components[0].id
    expect(st().setInstrumentPos(id, { x: 10, z: 22 }).ok).toBe(false) // body reaches back over the board
    expect(st().setInstrumentPos(id, { x: 10, z: 23 })).toEqual({ ok: true })
  })

  it('a swallowed L298N drops past the far edge by its own depth; a second unit steps by its own width', () => {
    st().addComponent('l298n_module', {})
    st().addComponent('uln2003_board', {})
    const [l298, uln] = st().layout.components.map((c) => c.id)
    expect(st().setInstrumentPos(l298, { x: 66, z: 5 })).toEqual({ ok: true }) // right of board 1
    expect(st().setInstrumentPos(uln, { x: 66, z: 13 })).toEqual({ ok: true })
    expect(st().setBoardCount(2)).toEqual({ ok: true }) // board 2 now covers both
    const after = st().layout
    const p0 = after.components[0].pos!
    const p1 = after.components[1].pos!
    // L298N: rect minZ = z + 2 + 0.5 − 7 must clear the board's z = 18 → z = 23, x kept
    expect(p0).toEqual({ x: 66, z: 23 })
    expect(p1.z).toBe(23)
    expect(p1.x).toBeGreaterThan(66)
    expect(onHalfGrid(p1.x)).toBe(true)
    const r0 = offboardBodyRect(0, p0, entry('l298n_module').offboard)
    const r1 = offboardBodyRect(1, p1, entry('uln2003_board').offboard)
    expect(overlaps(r0, r1)).toBe(false)
    expect(validateLayout(after).errors).toEqual([])
    st().undo()
    expect(st().layout.components.map((c) => c.pos)).toEqual([
      { x: 66, z: 5 },
      { x: 66, z: 13 },
    ])
  })
})
