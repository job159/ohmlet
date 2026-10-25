/**
 * Communication-module meshes (src/three/meshes/ext/comm.mesh.ts) — same
 * standard as tests/meshes.test.ts and tests/parts-basic-mesh.test.ts: real
 * models (not the fallback box) inside the 4000-triangle budget, pinWorld
 * exactly at the catalog pins, no transmission, never a light, dispose never
 * frees shared resources, synthetic collinear pins never throw, ghost
 * previews without per-instance canvases / sprites, declared router heights
 * covering the real mesh tops, bodies inside their declared footprint rects
 * on the board, rotation-aware frames, telemetry / params posing what they
 * claim (indicator LEDs, logic-level and address shunts).
 *
 * Runs in node (no DOM): canvas prints degrade to null by design.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { ComponentInstance, ComponentTelemetry } from '../../src/model/types'
import { ROW_Z, componentPinHoles, holePosition } from '../../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../../src/three/component-meshes'
import { isSharedResource } from '../../src/three/meshes/shared'
import { registeredMeshShapes } from '../../src/three/meshes/registry'
import { COMM_MESH_TOPS } from '../../src/three/meshes/ext/comm.mesh'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const PLACED: Record<string, ComponentInstance> = {
  usb_uart_ch340: { id: 'CH1', type: 'usb_uart_ch340', at: 'a35' },
  hc05_bt: { id: 'BT1', type: 'hc05_bt', at: 'e40' },
  max485_module: { id: 'M1', type: 'max485_module', at: 'h34' },
  w25q32_flash: { id: 'F1', type: 'w25q32_flash', at: 'e40' },
  sd_card_spi: { id: 'SD1', type: 'sd_card_spi', at: 'e40' },
  pcf8574_module: { id: 'X1', type: 'pcf8574_module', at: 'h40' },
  esp01: { id: 'E1', type: 'esp01', at: 'e40' },
  can_tja1050: { id: 'C1', type: 'can_tja1050', at: 'h40' },
}
const TYPES = Object.keys(PLACED)

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

function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const holes = componentPinHoles(comp, entryOf(comp.type))
  if (!holes) throw new Error(`malformed placement for ${comp.id}`)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}

function meshBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const m of meshesOf(root)) {
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
  }
  return box
}

function build(comp: ComponentInstance) {
  return buildComponentObject(comp, entryOf(comp.type), scenePins(comp))
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

/** per-instance emissive lens materials (the indicator LEDs) */
function lenses(root: THREE.Object3D): THREE.MeshPhysicalMaterial[] {
  return materialsOf(root).filter(
    (m) => !isSharedResource(m) && (m as THREE.MeshPhysicalMaterial).emissive !== undefined && (m as THREE.MeshPhysicalMaterial).emissiveMap === null && m.type === 'MeshPhysicalMaterial',
  ) as THREE.MeshPhysicalMaterial[]
}

// ---------------------------------------------------------------------------

describe('every comm module', () => {
  it('has a registered builder and builds a real model inside the budget', () => {
    const shapes = new Set(registeredMeshShapes())
    for (const t of TYPES) {
      const shape = CATALOG[t].visual?.shape ?? ''
      expect(shapes.has(shape), `${t} shape ${shape}`).toBe(true)
      const built = build(PLACED[t])
      const tris = triangleCount(built.object)
      expect(tris, `${t} is not the fallback box`).toBeGreaterThan(300)
      expect(tris, `${t} budget`).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
    }
  })

  it('pinWorld sits exactly at the catalog pins', () => {
    for (const t of TYPES) {
      const pins = scenePins(PLACED[t])
      const built = build(PLACED[t])
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
    for (const t of TYPES) {
      const built = build(PLACED[t])
      expect(materialsOf(built.object).filter((m) => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0), t).toHaveLength(0)
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
      for (const t of TYPES) {
        const a = build(PLACED[t])
        const b = build({ ...PLACED[t], id: `${PLACED[t].id}_b` })
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
    for (const t of TYPES) {
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

  it('ghost previews build without sprites or per-instance lens materials', () => {
    for (const t of TYPES) {
      const built = build({ ...PLACED[t], id: '__ghost__' })
      expect(spritesOf(built.object), t).toHaveLength(0)
      expect(lenses(built.object), t).toHaveLength(0)
      disposeComponentObject(built.object)
    }
  })

  it('static geometry is shared between instances (merged once per design)', () => {
    for (const t of TYPES) {
      const a = build(PLACED[t])
      const b = build({ ...PLACED[t], id: `${PLACED[t].id}_b` })
      const shared = (o: THREE.Object3D) => new Set(meshesOf(o).map((m) => m.geometry).filter((g) => isSharedResource(g)))
      const sa = shared(a.object)
      expect(sa.size, t).toBeGreaterThan(3)
      for (const g of shared(b.object)) expect(sa.has(g), t).toBe(true)
      disposeComponentObject(a.object)
      disposeComponentObject(b.object)
    }
  })
})

describe('router heights and body extents match the meshes', () => {
  it('every obstacleHeight covers the real mesh top; nothing below the hole depth', () => {
    for (const t of TYPES) {
      const built = build(PLACED[t])
      const box = meshBox(built.object)
      expect(box.max.y, `${t} exported top`).toBeLessThanOrEqual(COMM_MESH_TOPS[t] + 1e-6)
      expect(box.max.y, `${t} exported top is the real top`).toBeGreaterThan(COMM_MESH_TOPS[t] - 0.25)
      expect(CATALOG[t].obstacleHeight!, `${t} obstacleHeight`).toBeGreaterThanOrEqual(box.max.y)
      expect(box.min.y, `${t} nothing below the hole depth`).toBeGreaterThanOrEqual(-0.2)
      disposeComponentObject(built.object)
    }
  })

  it('on the board every body covers only its declared footprint holes', () => {
    // a hole is covered when the body crosses its center: the box must stop
    // short of the neighbor column / row centers around the declared rect
    const ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const
    const neighborZ = (r: (typeof ORDER)[number], dir: -1 | 1): number => {
      const k = ORDER.indexOf(r) + dir
      if (k < 0) return 1 // top − rail
      if (k >= ORDER.length) return 15 // bottom − rail
      return ROW_Z[ORDER[k]]
    }
    // CH340 / SD module / ESP-01 run off the rows on their far side (over the rails / off the board)
    const overhang: Record<string, 'minus' | 'plus' | undefined> = { usb_uart_ch340: 'minus', sd_card_spi: 'plus', esp01: 'plus' }
    for (const t of TYPES) {
      const comp = PLACED[t]
      const e = entryOf(t)
      const at = holePosition(componentPinHoles(comp, e)![0]!)
      const fp = e.bodyFootprint
      if (!fp || fp === 'auto') throw new Error(`${t} needs a bodyFootprint`)
      const rows = [...fp.rows].sort((p, q) => ROW_Z[p] - ROW_Z[q])
      const built = build(comp)
      const box = meshBox(built.object)
      expect(box.min.x, `${t} x0`).toBeGreaterThan(at.x + fp.dCols[0] - 1)
      expect(box.max.x, `${t} x1`).toBeLessThan(at.x + fp.dCols[1] + 1)
      // and it really reaches its outer declared columns' centers
      expect(box.min.x, `${t} covers dCol ${fp.dCols[0]}`).toBeLessThan(at.x + fp.dCols[0])
      expect(box.max.x, `${t} covers dCol ${fp.dCols[1]}`).toBeGreaterThan(at.x + fp.dCols[1])
      if (overhang[t] !== 'minus') expect(box.min.z, `${t} z0`).toBeGreaterThan(neighborZ(rows[0], -1))
      if (overhang[t] !== 'plus') expect(box.max.z, `${t} z1`).toBeLessThan(neighborZ(rows[rows.length - 1], 1))
      disposeComponentObject(built.object)
    }
  })

  it('the far-side overhangs are the real module lengths', () => {
    const ch = meshBox(build(PLACED.usb_uart_ch340).object)
    // 40 mm board + the USB-A plug: 52 mm from the header edge to the plug mouth
    expect((ch.max.z - ch.min.z) * 2.54).toBeGreaterThan(51)
    expect((ch.max.z - ch.min.z) * 2.54).toBeLessThan(53)
    const sd = meshBox(build(PLACED.sd_card_spi).object)
    expect((sd.max.z - sd.min.z) * 2.54).toBeGreaterThan(42)
    expect((sd.max.x - sd.min.x) * 2.54).toBeCloseTo(24, 0)
    const bt = meshBox(build(PLACED.hc05_bt).object)
    // the ZS-040 stands upright: 37.3 mm tall, 15.5 mm wide, only the channel side beyond row e
    expect((bt.max.x - bt.min.x) * 2.54).toBeCloseTo(15.5, 0)
    expect(bt.max.y * 2.54).toBeCloseTo(38.2, 1)
    expect(bt.max.z).toBeLessThan(ROW_Z.f)
  })

  it('180° placements turn the module about its pins (body on the other side)', () => {
    for (const t of ['w25q32_flash', 'sd_card_spi', 'esp01', 'usb_uart_ch340', 'hc05_bt']) {
      const row = t === 'usb_uart_ch340' ? 'j' : 'f'
      const comp0 = PLACED[t]
      const comp1: ComponentInstance = { ...comp0, at: `${row}45`, rotation: 180 }
      const pins = scenePins(comp1)
      const b0 = meshBox(build(comp0).object)
      const b1 = meshBox(build(comp1).object)
      const pinZ = pins[0].z
      // rotation 0 body center lies on one side of its pin row, rotation 180 on the other
      const side0 = Math.sign((b0.min.z + b0.max.z) / 2 - scenePins(comp0)[0].z)
      const side1 = Math.sign((b1.min.z + b1.max.z) / 2 - pinZ)
      expect(side1, t).toBe(-side0)
      expect(b1.max.y, t).toBeCloseTo(b0.max.y, 6)
    }
  })
})

describe('state-driven visuals', () => {
  it('CH340: PWR LED from the sub-circuit, TXD / RXD from the activity channels', () => {
    const comp = PLACED.usb_uart_ch340
    const entry = entryOf(comp.type)
    const built = build(comp)
    const ls = lenses(built.object)
    expect(ls).toHaveLength(3)
    expect(ls.every((l) => l.emissiveIntensity === 0)).toBe(true)
    updateComponentVisual(built, comp, entry, tel({ sub: { LED_PWR: { pinVoltages: {}, ledBrightness: 0.3 } }, leds: { TX: 1, RX: 0 } }))
    const lit = ls.filter((l) => l.emissiveIntensity > 0).map((l) => l.emissive.getHex())
    expect(lit).toHaveLength(2)
    const glows = spritesOf(built.object).filter((s) => s.visible)
    expect(glows).toHaveLength(2)
    updateComponentVisual(built, comp, entry, tel({ leds: { TX: 0, RX: 1 } }))
    expect(ls.filter((l) => l.emissiveIntensity > 0)).toHaveLength(1)
    disposeComponentObject(built.object)
  })

  it('CH340: the logic-level shunt follows the jumper param', () => {
    const entry = entryOf('usb_uart_ch340')
    const shuntX = (logic: string) => {
      const comp: ComponentInstance = { ...PLACED.usb_uart_ch340, params: { logic } }
      const built = buildComponentObject(comp, entry, scenePins(comp))
      let x = NaN
      built.object.updateMatrixWorld(true)
      built.object.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0x1a1a1c) {
          x = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).x
        }
      })
      disposeComponentObject(built.object)
      return x
    }
    const x5 = shuntX('5V')
    const x3 = shuntX('3.3V')
    // header at a35: 3V3 · VCC · 5V over columns 36.5 / 37.5 / 38.5 → shunt centers 37.0 (3.3V) / 38.0 (5V)
    expect(x3).toBeCloseTo(36.5 + 0.5, 1)
    expect(x5).toBeCloseTo(37.5 + 0.5, 1)
  })

  it('PCF8574: the A2–A0 shunts follow the address param', () => {
    const entry = entryOf('pcf8574_module')
    const shuntZ = (address: string) => {
      const comp: ComponentInstance = { ...PLACED.pcf8574_module, params: { address } }
      const built = buildComponentObject(comp, entry, scenePins(comp))
      built.object.updateMatrixWorld(true)
      const zs: number[] = []
      built.object.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0x2456c8) zs.push(new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).z)
      })
      disposeComponentObject(built.object)
      return zs
    }
    const z20 = shuntZ('0x20')
    const z25 = shuntZ('0x25') // A0 = 1, A1 = 0, A2 = 1
    expect(z20).toHaveLength(3)
    expect(z25[0]).toBeLessThan(z20[0]) // A0 moved to the VCC side (−z)
    expect(z25[1]).toBeCloseTo(z20[1], 6)
    expect(z25[2]).toBeLessThan(z20[2])
    // and the update path moves them at run time
    const comp = PLACED.pcf8574_module
    const built = buildComponentObject(comp, entry, scenePins(comp))
    updateComponentVisual(built, { ...comp, params: { address: '0x27' } }, entry, null)
    built.object.updateMatrixWorld(true)
    const after: number[] = []
    built.object.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0x2456c8) after.push(new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).z)
    })
    for (let k = 0; k < 3; k++) expect(after[k]).toBeLessThan(z20[k])
    disposeComponentObject(built.object)
  })

  it('HC-05 status LED, MAX485 / ESP-01 power and TX LEDs light from telemetry', () => {
    const cases: [string, ComponentTelemetry, number][] = [
      ['hc05_bt', tel({ leds: { LED: 1 } }), 1],
      ['max485_module', tel({ sub: { LED_PWR: { pinVoltages: {}, ledBrightness: 0.25 } } }), 1],
      ['esp01', tel({ sub: { LED_PWR: { pinVoltages: {}, ledBrightness: 0.25 } }, leds: { TX: 1 } }), 2],
    ]
    for (const [t, telemetry, n] of cases) {
      const comp = PLACED[t]
      const built = build(comp)
      updateComponentVisual(built, comp, entryOf(t), telemetry)
      expect(lenses(built.object).filter((l) => l.emissiveIntensity > 0), t).toHaveLength(n)
      updateComponentVisual(built, comp, entryOf(t), tel({}))
      expect(lenses(built.object).filter((l) => l.emissiveIntensity > 0), t).toHaveLength(0)
      disposeComponentObject(built.object)
    }
  })
})
