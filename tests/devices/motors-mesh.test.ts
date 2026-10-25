/**
 * Motors & drivers meshes (src/three/meshes/ext/motors.mesh.ts) — the same
 * standard as tests/parts-basic-mesh.test.ts: a registered real model (not
 * the fallback box) per part inside the 4000-triangle budget, pinWorld exactly
 * at the catalog pins (off-board: the terminal tops), no transmission, never a
 * light, dispose never frees shared resources, synthetic collinear pins never
 * throw, the placement ghost carries no sprites, carriers stay inside their
 * declared body rect under their router height (both allowed rotations), the
 * bench units — built on their real terminal row (CatalogEntry.offboard) —
 * inside their declared rect under the 4-unit height, and
 * the moving parts / LEDs / jumpers pose from telemetry and params.
 *
 * Runs in node (no DOM): canvas prints degrade to null by design.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { ComponentInstance, ComponentTelemetry } from '../../src/model/types'
import {
  componentPinHoles,
  holePosition,
  offboardBodyPosition,
  offboardBodyRect,
  offboardGeometryOf,
  offboardTerminalPosition,
  ROW_Z,
} from '../../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../../src/three/component-meshes'
import { isSharedResource } from '../../src/three/meshes/shared'
import { registeredMeshShapes } from '../../src/three/meshes/registry'
import { TERMINAL_TOP_Y } from '../../src/three/internal/wires'
import { DRV8833_TOP, STEPSTICK_TOP, TB6612_TOP, TMC2209_TOP } from '../../src/three/meshes/ext/motors.mesh'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export const MOTOR_TYPES = [
  'dc_motor',
  'sg90_servo',
  'stepper_28byj48',
  'nema17_stepper',
  'uln2003_board',
  'l298n_module',
  'tb6612fng_module',
  'drv8833_module',
  'a4988_driver',
  'drv8825_driver',
  'tmc2209_driver',
]

const PLACED: Record<string, ComponentInstance> = {
  tb6612fng_module: { id: 'U1', type: 'tb6612fng_module', at: 'h20' },
  drv8833_module: { id: 'U2', type: 'drv8833_module', at: 'g20' },
  a4988_driver: { id: 'U3', type: 'a4988_driver', at: 'g20' },
  drv8825_driver: { id: 'U4', type: 'drv8825_driver', at: 'g20' },
  tmc2209_driver: { id: 'U5', type: 'tmc2209_driver', at: 'g20' },
}

function entryOf(type: string) {
  const e = getEntry(type)
  if (!e) throw new Error(`catalog entry missing: ${type}`)
  return e
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>()
  for (const m of meshesOf(root)) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) out.add(mm)
  return [...out]
}

function spritesOf(root: THREE.Object3D): THREE.Sprite[] {
  const out: THREE.Sprite[] = []
  root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) out.push(o as THREE.Sprite)
  })
  return out
}

function triangleCount(root: THREE.Object3D): number {
  let tris = 0
  for (const m of meshesOf(root)) {
    const g = m.geometry
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3
  }
  return tris
}

/**
 * World-space pin positions exactly as the scene computes them (off-board:
 * the part's own terminal row — CatalogEntry.offboard pitch / offset — on
 * default-shelf slot 0, scene.ts buildComponentRecord).
 */
function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const entry = entryOf(comp.type)
  if (entry.placement === 'offboard') {
    return entry.pins.map((_, i) => {
      const p = offboardTerminalPosition(0, i, comp.pos, entry.offboard)
      return v(p.x, 0, p.z)
    })
  }
  const holes = componentPinHoles(comp, entry)
  if (!holes) throw new Error(`malformed placement for ${comp.id}`)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}

function compFor(type: string): ComponentInstance {
  return PLACED[type] ?? { id: `X_${type}`, type }
}

/** Mesh-only world bounding box (sprites excluded), visible meshes only. */
function meshBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const m of meshesOf(root)) {
    let visible = true
    for (let o: THREE.Object3D | null = m; o; o = o.parent) if (!o.visible) visible = false
    if (!visible) continue
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
  }
  return box
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

describe('every motors-family part', () => {
  it('has a registered builder and builds a real model inside the budget', () => {
    const shapes = new Set(registeredMeshShapes())
    for (const t of MOTOR_TYPES) {
      const shape = CATALOG[t].visual?.shape
      expect(shapes.has(shape ?? ''), `${t} shape ${shape}`).toBe(true)
      const comp = compFor(t)
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      const tris = triangleCount(built.object)
      expect(tris, `${t} is not the fallback box`).toBeGreaterThan(200)
      expect(tris, `${t} budget`).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
    }
  })

  it('pinWorld sits exactly at the catalog pins (off-board: on the terminal tops)', () => {
    for (const t of MOTOR_TYPES) {
      const comp = compFor(t)
      const pins = scenePins(comp)
      const built = buildComponentObject(comp, entryOf(t), pins)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      built.pinWorld.forEach((p, i) => {
        expect(p.x, `${t} pin ${i}`).toBeCloseTo(pins[i].x, 9)
        expect(p.z, `${t} pin ${i}`).toBeCloseTo(pins[i].z, 9)
        expect(p.y, `${t} pin ${i}`).toBe(CATALOG[t].placement === 'offboard' ? TERMINAL_TOP_Y : 0)
      })
      disposeComponentObject(built.object)
    }
  })

  it('no transmission, never a light', () => {
    for (const t of MOTOR_TYPES) {
      const comp = compFor(t)
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      const transmissive = materialsOf(built.object).filter((m) => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0)
      expect(transmissive, t).toHaveLength(0)
      let lights = 0
      built.object.traverse((o) => {
        if ((o as THREE.Light).isLight) lights++
      })
      expect(lights, t).toBe(0)
      disposeComponentObject(built.object)
    }
  })

  it('dispose frees only per-instance resources; a second instance stays intact', () => {
    const disposed: object[] = []
    const origMat = THREE.Material.prototype.dispose
    const origGeo = THREE.BufferGeometry.prototype.dispose
    THREE.Material.prototype.dispose = function (this: THREE.Material) {
      disposed.push(this)
      origMat.call(this)
    }
    THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
      disposed.push(this)
      origGeo.call(this)
    }
    try {
      for (const t of MOTOR_TYPES) {
        const comp = compFor(t)
        const a = buildComponentObject(comp, entryOf(t), scenePins(comp))
        const b = buildComponentObject({ ...comp, id: `${comp.id}_b` }, entryOf(t), scenePins(comp))
        disposeComponentObject(a.object)
        for (const m of materialsOf(b.object)) expect(disposed.includes(m), `${t} shares a disposed material`).toBe(false)
        for (const m of meshesOf(b.object)) expect(disposed.includes(m.geometry), `${t} shares a disposed geometry`).toBe(false)
        disposeComponentObject(b.object)
      }
      for (const r of disposed) expect(isSharedResource(r)).toBe(false)
    } finally {
      THREE.Material.prototype.dispose = origMat
      THREE.BufferGeometry.prototype.dispose = origGeo
    }
  })

  it('survives collinear synthetic pins (meshes.test.ts pattern) and malformed 2-pin calls', () => {
    for (const t of MOTOR_TYPES) {
      const entry = entryOf(t)
      const pins = entry.pins.map((_, i) => v(i * 2, 0, 0))
      const built = buildComponentObject({ id: `T_${t}`, type: t }, entry, pins)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      expect(triangleCount(built.object), t).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
      const tiny = buildComponentObject({ id: `T2_${t}`, type: t }, entry, [v(0, 0, 0), v(0, 0, 0)])
      expect(tiny.pinWorld).toHaveLength(2)
      disposeComponentObject(tiny.object)
    }
  })

  it('the placement ghost builds without sprites and reuses the shared statics', () => {
    for (const t of MOTOR_TYPES) {
      const comp = { ...compFor(t), id: '__ghost__' }
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      expect(spritesOf(built.object), t).toHaveLength(0)
      // the body itself is shared geometry (merged once per design)
      const shared = meshesOf(built.object).filter((m) => isSharedResource(m.geometry))
      expect(shared.length, t).toBeGreaterThan(0)
      disposeComponentObject(built.object)
    }
  })
})

describe('extents match the catalog footprints and router heights', () => {
  it('breadboard carriers stay inside their body rect and under obstacleHeight, at 0° and 180°', () => {
    const tops: Record<string, number> = {
      tb6612fng_module: TB6612_TOP,
      drv8833_module: DRV8833_TOP,
      a4988_driver: STEPSTICK_TOP,
      drv8825_driver: STEPSTICK_TOP,
      tmc2209_driver: TMC2209_TOP,
    }
    for (const [t, top] of Object.entries(tops)) {
      const e = entryOf(t)
      expect(e.allowedRotations, t).toEqual([0, 180])
      const n = e.pins.length / 2
      const mirror: Record<string, string> = { h: 'c', c: 'h', g: 'd', d: 'g' }
      for (const rotation of [0, 180] as const) {
        // 180°: pin 1 sits at the far end of the mirrored row (same holes overall)
        const at0 = PLACED[t].at!
        const at = rotation === 0 ? at0 : `${mirror[at0[0]]}${Number(at0.slice(1)) + n - 1}`
        const comp = { ...PLACED[t], at, rotation }
        const built = buildComponentObject(comp, e, scenePins(comp))
        const box = meshBox(built.object)
        expect(box.max.y, `${t} top`).toBeLessThanOrEqual(top + 1e-6)
        expect(e.obstacleHeight!, `${t} obstacleHeight`).toBeGreaterThanOrEqual(box.max.y)
        expect(box.min.y, `${t} nothing below the board`).toBeGreaterThanOrEqual(-0.01)
        // body rect: anchor column range ± half a pitch, the declared rows
        const bf = e.bodyFootprint as { dCols: [number, number]; rows: (keyof typeof ROW_Z)[] }
        const col = Number(at.slice(1))
        const cols = rotation === 0 ? [col + bf.dCols[0], col + bf.dCols[1]] : [col - bf.dCols[1], col - bf.dCols[0]]
        const zs = bf.rows.map((r) => ROW_Z[r])
        expect(box.min.x, `${t}@${rotation} min x`).toBeGreaterThan(cols[0] - 0.5 - 1e-6)
        expect(box.max.x, `${t}@${rotation} max x`).toBeLessThan(cols[1] + 0.5 + 1e-6)
        // the PCB covers its own rows' holes but never the next row's centre
        const rowsOut = Object.values(ROW_Z).filter((z) => !zs.includes(z))
        for (const z of rowsOut) expect(box.min.z > z || box.max.z < z, `${t}@${rotation} reaches row z=${z}`).toBe(true)
        disposeComponentObject(built.object)
      }
    }
  })

  it('bench units on their real terminal row stay within their declared rect (legacy instrument rect when none), under 4 units', () => {
    for (const t of MOTOR_TYPES.filter((x) => CATALOG[x].placement === 'offboard')) {
      const comp = compFor(t)
      const geom = CATALOG[t].offboard
      const pins = scenePins(comp)
      const built = buildComponentObject(comp, entryOf(t), pins)
      // the unit without its leads: the leads are the only per-instance
      // (non-shared) geometry; the body statics and the posed parts are shared.
      // The anchor is where the scene put the body for this terminal row
      // (terminal 0 = anchor + the part's own terminal offset).
      const g = offboardGeometryOf(geom)
      const anchor = offboardBodyPosition(0, comp.pos, geom)
      expect(pins[0].x, t).toBeCloseTo(anchor.x + g.ox, 9)
      expect(pins[0].z, t).toBeCloseTo(anchor.z + g.oz, 9)
      built.object.updateMatrixWorld(true)
      const box = new THREE.Box3()
      for (const m of meshesOf(built.object)) {
        if (!isSharedResource(m.geometry)) continue
        m.geometry.computeBoundingBox()
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
      }
      // the body stays within its rect's width (the legacy 6.5 instrument
      // width when the part declares none), at most 2.5 behind the legacy
      // back line and never in front of the terminal apron …
      const r = offboardBodyRect(0, comp.pos, geom)
      expect(box.min.x, t).toBeGreaterThanOrEqual(anchor.x - 0.05)
      expect(box.max.x, t).toBeLessThanOrEqual(anchor.x + g.w + 0.05)
      expect(box.min.z, t).toBeGreaterThanOrEqual(Math.min(r.minZ, pins[0].z - 2 - 2 - 2.5) - 0.05)
      expect(box.max.z, t).toBeLessThanOrEqual(pins[0].z + 0.5)
      // … and the whole unit (body, leads, tips on the real terminal row) inside its declared rect
      const all = meshBox(built.object)
      expect(all.min.x, t).toBeGreaterThanOrEqual(r.minX - 0.02)
      expect(all.max.x, t).toBeLessThanOrEqual(r.maxX + 0.02)
      expect(all.min.z, t).toBeGreaterThanOrEqual(r.minZ - 0.02)
      expect(all.max.z, t).toBeLessThanOrEqual(r.maxZ + 0.02)
      expect(all.max.y, t).toBeLessThanOrEqual(4.05)
      expect(all.min.y, t).toBeGreaterThanOrEqual(-1e-6)
      disposeComponentObject(built.object)
    }
  })
})

describe('state-driven visuals', () => {
  function rotorOf(built: { object: THREE.Object3D }, pred: (o: THREE.Object3D) => boolean): THREE.Object3D {
    let found: THREE.Object3D | null = null
    built.object.traverse((o) => {
      if (!found && pred(o)) found = o
    })
    expect(found).not.toBeNull()
    return found!
  }

  it('DC motor: the indicator disc turns with telemetry angle and blurs at speed', () => {
    const comp = compFor('dc_motor')
    const entry = entryOf('dc_motor')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const discs = meshesOf(built.object).filter((m) => m.geometry.type === 'CylinderGeometry' && (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0xf1f0ea)
    expect(discs.length).toBe(1)
    const rotor = discs[0].parent!
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 90, rpm: 10 } }))
    expect(rotor.rotation.x).toBeCloseTo(-Math.PI / 2, 9)
    const ringMeshes = meshesOf(rotor).filter((m) => m.geometry.type === 'RingGeometry')
    expect(ringMeshes.length).toBe(2)
    expect(ringMeshes[0].parent!.visible).toBe(false)
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 30, rpm: 9000 } }))
    expect(ringMeshes[0].parent!.visible).toBe(true)
    expect(rotor.rotation.x).toBeCloseTo((-30 * Math.PI) / 180, 9)
    disposeComponentObject(built.object)
  })

  it('SG90: the horn follows telemetry angle (0° → −x, 90° → +z toward the viewer, 180° → +x)', () => {
    const comp = compFor('sg90_servo')
    const entry = entryOf('sg90_servo')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const horn = rotorOf(built, (o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'ExtrudeGeometry' && o.parent !== null && o.parent.type === 'Group' && o.parent.children.length >= 5).parent!
    const dir = () => new THREE.Vector3(1, 0, 0).applyEuler(horn.rotation)
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 0 } }))
    expect(dir().x).toBeCloseTo(-1, 6)
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 90 } }))
    expect(dir().z).toBeCloseTo(1, 6)
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 180 } }))
    expect(dir().x).toBeCloseTo(1, 6)
    disposeComponentObject(built.object)
  })

  it('28BYJ-48 / NEMA 17: the output pointer / disc turns with telemetry angle', () => {
    for (const t of ['stepper_28byj48', 'nema17_stepper']) {
      const comp = compFor(t)
      const entry = entryOf(t)
      const built = buildComponentObject(comp, entry, scenePins(comp))
      const before: number[] = []
      built.object.traverse((o) => before.push(o.rotation.x + o.rotation.y))
      updateComponentVisual(built, comp, entry, tel({ values: { angle: 45, rpm: 5 } }))
      const after: number[] = []
      built.object.traverse((o) => after.push(o.rotation.x + o.rotation.y))
      const moved = after.filter((a, i) => Math.abs(a - before[i]) > 1e-9)
      expect(moved.length, t).toBe(1)
      expect(Math.abs(moved[0] - before[after.indexOf(moved[0])]), t).toBeCloseTo(Math.PI / 4, 6)
      disposeComponentObject(built.object)
    }
  })

  it('ULN2003 board: LEDs A–D light from telemetry leds, never a light', () => {
    const comp = compFor('uln2003_board')
    const entry = entryOf('uln2003_board')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const lenses = materialsOf(built.object).filter((m) => (m as THREE.MeshPhysicalMaterial).emissive && !isSharedResource(m)) as THREE.MeshPhysicalMaterial[]
    expect(lenses).toHaveLength(4)
    for (const l of lenses) expect(l.emissiveIntensity).toBe(0)
    updateComponentVisual(built, comp, entry, tel({ leds: { A: 0.25, B: 0, C: 0.25, D: 0 } }))
    expect(lenses.map((l) => l.emissiveIntensity > 0)).toEqual([true, false, true, false])
    expect(spritesOf(built.object).filter((s) => s.visible)).toHaveLength(2)
    disposeComponentObject(built.object)
  })

  it('L298N: jumpers follow the params, the power LED the telemetry', () => {
    const entry = entryOf('l298n_module')
    const comp: ComponentInstance = { id: 'D1', type: 'l298n_module', params: { jumperEnA: false } }
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const caps = meshesOf(built.object).filter((m) => (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0x18181b)
    expect(caps).toHaveLength(3)
    updateComponentVisual(built, comp, entry, tel({ leds: { PWR: 0.3 } }))
    expect(caps.map((c) => c.visible)).toEqual([false, true, true])
    const lens = materialsOf(built.object).find((m) => (m as THREE.MeshPhysicalMaterial).emissive && !isSharedResource(m)) as THREE.MeshPhysicalMaterial
    expect(lens.emissiveIntensity).toBeGreaterThan(1)
    updateComponentVisual(built, { ...comp, params: { jumperEnA: true, jumper5v: false } }, entry, tel({ leds: { PWR: 0 } }))
    expect(caps.map((c) => c.visible)).toEqual([true, true, false])
    expect(lens.emissiveIntensity).toBe(0)
    disposeComponentObject(built.object)
  })
})
