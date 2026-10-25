/**
 * Sensors family meshes (src/three/meshes/ext/sensors.mesh.ts) — the same
 * standard as tests/meshes.test.ts and tests/parts-basic-mesh.test.ts: real
 * models (not the fallback box) inside the 4000-triangle budget, pinWorld
 * exactly at the catalog pins, no transmission, never a light, dispose never
 * frees shared resources, synthetic collinear pins never throw, the router
 * heights cover the real mesh tops, the bodies stay inside their declared
 * footprints, and the moving parts / LEDs follow params and telemetry.
 *
 * Runs in node (no DOM): canvas art, markings and glow textures degrade to
 * plain materials / null by design.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG, getEntry } from '../../src/model/catalog'
import { PARTS } from '../../src/model/parts/sensors.parts'
import type { ComponentInstance, ComponentTelemetry } from '../../src/model/types'
import { ROW_Z, componentPinHoles, holePosition } from '../../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../../src/three/component-meshes'
import { HOLE_DEPTH, isSharedResource } from '../../src/three/meshes/shared'
import { registeredMeshShapes } from '../../src/three/meshes/registry'
import {
  DHT11_TOP,
  DHT22_TOP,
  HCSR04_TOP,
  KY023_TOP,
  KY040_TOP,
  MODULE_HEADER_TOP,
  TERMINAL_MODULE_TOP,
} from '../../src/three/meshes/ext/sensors.mesh'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** every sensors-family type (src/model/parts/sensors.parts.ts) */
const SENSOR_TYPES = PARTS.map((p) => p.type)

/** a valid placement per type (footprint modules at f20, leaded parts in row a) */
function compFor(type: string, extra: Partial<ComponentInstance> = {}): ComponentInstance {
  const e = entryOf(type)
  if (e.placement === 'footprint') return { id: `S_${type}`, type, at: 'f20', ...extra }
  return { id: `S_${type}`, type, holes: e.pins.map((_, i) => `a${20 + i}`), ...extra }
}

function entryOf(type: string) {
  const e = getEntry(type)
  if (!e) throw new Error(`catalog entry missing: ${type}`)
  return e
}

function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const holes = componentPinHoles(comp, entryOf(comp.type))
  if (!holes) throw new Error(`malformed placement for ${comp.id}`)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
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
 * Exact mesh-only world bounding box (every vertex transformed — a rotated
 * local AABB would overstate tilted parts); `only` filters the meshes.
 */
function meshBox(root: THREE.Object3D, only: (m: THREE.Mesh) => boolean = () => true): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  for (const m of meshesOf(root)) {
    if (!only(m)) continue
    const pos = m.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld))
  }
  return box
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

function build(comp: ComponentInstance) {
  return buildComponentObject(comp, entryOf(comp.type), scenePins(comp))
}

// ---------------------------------------------------------------------------

describe('every sensor part', () => {
  it('has a registered builder (the DS18B20: the built-in TO-92) and builds a real model in budget', () => {
    const shapes = new Set(registeredMeshShapes())
    for (const t of SENSOR_TYPES) {
      const shape = CATALOG[t].visual?.shape ?? ''
      expect(shape === 'to92' || shapes.has(shape), `${t} shape ${shape}`).toBe(true)
      const built = build(compFor(t))
      const tris = triangleCount(built.object)
      expect(tris, `${t} is not the fallback box`).toBeGreaterThan(60)
      expect(tris, `${t} budget`).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
    }
  })

  it('pinWorld sits exactly at the catalog pins', () => {
    for (const t of SENSOR_TYPES) {
      const comp = compFor(t)
      const pins = scenePins(comp)
      const built = build(comp)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      built.pinWorld.forEach((p, i) => {
        expect(p.x, `${t} pin ${i}`).toBeCloseTo(pins[i].x, 9)
        expect(p.z, `${t} pin ${i}`).toBeCloseTo(pins[i].z, 9)
        expect(p.y, `${t} pin ${i}`).toBe(0)
      })
      disposeComponentObject(built.object)
    }
  })

  it('no transmission, never a light', () => {
    for (const t of SENSOR_TYPES) {
      const built = build(compFor(t))
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
      for (const t of SENSOR_TYPES) {
        const comp = compFor(t)
        const a = build(comp)
        const b = build({ ...comp, id: `${comp.id}_b` })
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

  it('survives collinear synthetic pins and malformed 2-pin calls', () => {
    for (const t of SENSOR_TYPES) {
      const entry = entryOf(t)
      const pins = entry.pins.map((_, i) => v(i * 2, 0, 0))
      const built = buildComponentObject({ id: `T_${t}`, type: t }, entry, pins)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      expect(triangleCount(built.object), t).toBeGreaterThan(60)
      expect(triangleCount(built.object), t).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
      const tiny = buildComponentObject({ id: `T2_${t}`, type: t }, entry, [v(0, 0, 0), v(0, 0, 0)])
      expect(tiny.pinWorld).toHaveLength(2)
      disposeComponentObject(tiny.object)
    }
  })

  it('ghost previews: no sprites, no per-instance materials beyond the shared statics', () => {
    for (const t of SENSOR_TYPES) {
      const comp = { ...compFor(t), id: '__ghost__' }
      const built = build(comp)
      expect(spritesOf(built.object), t).toHaveLength(0)
      // flat modules: everything but the moving parts' transforms is shared
      if (CATALOG[t].placement === 'footprint' && t !== 'acs712_5a' && t !== 'voltage_sensor') {
        for (const m of meshesOf(built.object)) {
          expect(isSharedResource(m.geometry), `${t} ghost geometry`).toBe(true)
          expect(isSharedResource(m.material as THREE.Material), `${t} ghost material`).toBe(true)
        }
      }
      disposeComponentObject(built.object)
    }
  })
})

describe('router heights and body extents match the meshes', () => {
  const TOPS: Record<string, number> = {
    mpu6050_gy521: MODULE_HEADER_TOP,
    bmp280: MODULE_HEADER_TOP,
    bme280: MODULE_HEADER_TOP,
    bh1750: MODULE_HEADER_TOP,
    dht11: DHT11_TOP,
    dht22: DHT22_TOP,
    hcsr04: HCSR04_TOP,
    ky040_encoder: KY040_TOP,
    joystick_xy: KY023_TOP,
    acs712_5a: TERMINAL_MODULE_TOP,
    voltage_sensor: TERMINAL_MODULE_TOP,
  }

  it('every declared obstacleHeight covers the real mesh top (the joystick at full tilt)', () => {
    for (const [t, top] of Object.entries(TOPS)) {
      const built = build(compFor(t))
      const box = meshBox(built.object)
      expect(box.max.y, `${t} exported top`).toBeLessThanOrEqual(top + 1e-6)
      // (the joystick's export is its full-tilt reach, checked below)
      if (t !== 'joystick_xy') expect(box.max.y, `${t} top is the real feature`).toBeGreaterThan(top - 0.05)
      expect(CATALOG[t].obstacleHeight!, `${t} obstacleHeight`).toBeGreaterThanOrEqual(top)
      expect(box.min.y, `${t} nothing below the hole depth`).toBeGreaterThanOrEqual(HOLE_DEPTH - 1e-6)
      disposeComponentObject(built.object)
    }
    // the tilted joystick stays under its declared height
    const js = compFor('joystick_xy', { params: { x: 100, y: -100 } })
    const built = build(js)
    const box = meshBox(built.object)
    expect(box.max.y).toBeGreaterThan(meshBox(build(compFor('joystick_xy')).object).max.y)
    expect(box.max.y).toBeLessThanOrEqual(KY023_TOP + 1e-6)
    disposeComponentObject(built.object)
  })

  it('module bodies stay inside their declared columns; the ones that fit stay inside their rows', () => {
    // f20 anchors: a hole is covered when the body crosses its centre
    for (const t of Object.keys(TOPS)) {
      const e = CATALOG[t]
      const fp = e.bodyFootprint
      if (!fp || fp === 'auto') throw new Error(`${t}: no body footprint`)
      // the load / input wires of the terminal modules run to their own holes beside the board
      const isWire = (m: THREE.Mesh) => {
        const g = m.geometry as THREE.BufferGeometry & { parameters?: { radius?: number } }
        return g.type === 'TubeGeometry' || (g.type === 'SphereGeometry' && g.parameters?.radius === 0.2)
      }
      const built = build(compFor(t))
      const box = meshBox(built.object, (m) => !isWire(m))
      const [c0, c1] = fp.dCols
      expect(box.min.x, `${t} left`).toBeGreaterThan(20 + c0 - 1)
      expect(box.min.x, `${t} left`).toBeLessThan(20 + c0)
      expect(box.max.x, `${t} right`).toBeGreaterThan(20 + c1)
      expect(box.max.x, `${t} right`).toBeLessThan(20 + c1 + 1)
      const zs = fp.rows.map((r) => ROW_Z[r])
      const zMin = Math.min(...zs)
      const zMax = Math.max(...zs)
      // never over the strips in front of the header (rows g–j stay wireable)
      expect(box.max.z, `${t} front`).toBeLessThan(ROW_Z.g)
      expect(box.max.z, `${t} front`).toBeGreaterThanOrEqual(zMax)
      if (zMin > ROW_Z.a) {
        // fits: crosses its first row, not the one before it
        expect(box.min.z, `${t} back`).toBeLessThan(zMin)
        expect(box.min.z, `${t} back`).toBeGreaterThan(zMin - 1)
      } else {
        // reaches row a (and possibly past it over the rails)
        expect(box.min.z, `${t} back`).toBeLessThan(ROW_Z.a)
      }
      disposeComponentObject(built.object)
    }
  })
})

describe('orientation, moving parts and LEDs', () => {
  it('HC-SR04: transducers face back over rows c–e, the component side faces front; 180° turns it round', () => {
    const cans = (built: { object: THREE.Object3D }) =>
      meshBox(built.object, (m) => (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0xc4c8cd)
    const a = build(compFor('hcsr04'))
    const ca = cans(a)
    expect(ca.max.z).toBeLessThan(ROW_Z.f)
    expect(ca.min.z).toBeGreaterThan(ROW_Z.b)
    expect(ca.min.z).toBeLessThan(ROW_Z.c)
    disposeComponentObject(a.object)
    // the pins run GND ECHO TRIG VCC left → right from the front
    const pins = scenePins(compFor('hcsr04'))
    expect(pins[0].x).toBeGreaterThan(pins[3].x)
    const b = build(compFor('hcsr04', { at: 'e30', rotation: 180 }))
    const cb = cans(b)
    expect(cb.min.z).toBeGreaterThan(ROW_Z.e)
    expect(cb.max.z).toBeGreaterThan(ROW_Z.h)
    disposeComponentObject(b.object)
  })

  it('KY-040: the shaft turns with the encoder angle (clockwise from above) and sinks while pressed', () => {
    const comp = compFor('ky040_encoder')
    const entry = entryOf('ky040_encoder')
    const built = build(comp)
    const shaft = (): THREE.Object3D => {
      let found: THREE.Object3D | null = null
      built.object.traverse((o) => {
        if (!found && o !== built.object && (o as THREE.Group).isGroup && o.children.length >= 3) found = o
      })
      return found!
    }
    expect(shaft().rotation.y).toBeCloseTo(0, 12)
    const y0 = shaft().position.y
    updateComponentVisual(built, comp, entry, tel({ values: { angle: 90, pressed: 0 } }))
    expect(shaft().rotation.y).toBeCloseTo(-Math.PI / 2, 9)
    updateComponentVisual(built, comp, entry, tel({ values: { angle: -18, pressed: 1 } }))
    expect(shaft().rotation.y).toBeCloseTo(Math.PI / 10, 9)
    expect(shaft().position.y).toBeLessThan(y0)
    // without telemetry the position param poses it (20 detents per turn)
    updateComponentVisual(built, { ...comp, params: { position: 5 } }, entry, null)
    expect(shaft().rotation.y).toBeCloseTo(-Math.PI / 2, 9)
    expect(shaft().position.y).toBe(y0)
    disposeComponentObject(built.object)
  })

  it('KY-023: the stick leans toward +x for x > 0 and away from the header for y > 0; pressing sinks it', () => {
    const comp = compFor('joystick_xy')
    const entry = entryOf('joystick_xy')
    const built = build(comp)
    const capCenter = () => {
      // the cap is the highest mesh: its bounding box centre in world space
      let best: THREE.Mesh | null = null
      let top = -Infinity
      built.object.updateMatrixWorld(true)
      for (const m of meshesOf(built.object)) {
        m.geometry.computeBoundingBox()
        const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)
        if (b.max.y > top) {
          top = b.max.y
          best = m
        }
      }
      const b = best!.geometry.boundingBox!.clone().applyMatrix4(best!.matrixWorld)
      return b.getCenter(new THREE.Vector3())
    }
    const rest = capCenter()
    updateComponentVisual(built, comp, entry, tel({ values: { x: 100, y: 0, pressed: 0 } }))
    expect(capCenter().x).toBeGreaterThan(rest.x + 1)
    updateComponentVisual(built, comp, entry, tel({ values: { x: 0, y: 100, pressed: 0 } }))
    expect(capCenter().z).toBeLessThan(rest.z - 1) // header at row f (front), +y leans back
    updateComponentVisual(built, comp, entry, tel({ values: { x: 0, y: 0, pressed: 1 } }))
    expect(capCenter().y).toBeLessThan(rest.y)
    updateComponentVisual(built, { ...comp, params: { x: -50 } }, entry, null)
    expect(capCenter().x).toBeLessThan(rest.x - 0.5)
    disposeComponentObject(built.object)
  })

  it('power LEDs follow the sub-circuit LED (GY-521, DHT11 module, ACS712); the DHT22 module has none', () => {
    for (const t of ['mpu6050_gy521', 'dht11', 'acs712_5a']) {
      const comp = compFor(t)
      const entry = entryOf(t)
      const built = build(comp)
      const lens = materialsOf(built.object).find(
        (m) => !isSharedResource(m) && (m as THREE.MeshPhysicalMaterial).emissive?.getHex() === 0xff3526,
      ) as THREE.MeshPhysicalMaterial
      expect(lens, t).toBeDefined()
      const [glow] = spritesOf(built.object)
      expect(lens.emissiveIntensity).toBe(0)
      updateComponentVisual(built, comp, entry, tel({ sub: { LED_PWR: tel({ ledBrightness: 0.2 }) } }))
      expect(lens.emissiveIntensity, t).toBeGreaterThan(1)
      expect(glow.visible, t).toBe(true)
      updateComponentVisual(built, comp, entry, tel({ sub: { LED_PWR: tel({ ledBrightness: 0 }) } }))
      expect(lens.emissiveIntensity, t).toBe(0)
      disposeComponentObject(built.object)
    }
    const d22 = build(compFor('dht22'))
    expect(spritesOf(d22.object)).toHaveLength(0)
    disposeComponentObject(d22.object)
  })

  it('ACS712 / voltage sensor: the two wires leave the terminal block and end inside their own holes', () => {
    for (const t of ['acs712_5a', 'voltage_sensor']) {
      const comp = compFor(t)
      const pins = scenePins(comp)
      const built = build(comp)
      built.object.updateMatrixWorld(true)
      for (const i of [3, 4]) {
        // a tinned end reaches down into the hole of pin i
        const tip = meshesOf(built.object).find((m) => {
          if (isSharedResource(m.geometry)) return false
          m.geometry.computeBoundingBox()
          const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)
          return b.min.y <= HOLE_DEPTH + 1e-6 && Math.abs((b.min.x + b.max.x) / 2 - pins[i].x) < 0.1 && Math.abs((b.min.z + b.max.z) / 2 - pins[i].z) < 0.1
        })
        expect(tip, `${t} pin ${i}`).toBeDefined()
      }
      disposeComponentObject(built.object)
    }
  })
})
