/**
 * Embedded-platform part visuals (src/three/meshes/boards.ts, pcb.ts,
 * instruments-ext.ts): STM32 Blue Pill, logic-analyzer probe, bench DMM.
 *
 * Same standard as tests/meshes.test.ts: per-part triangle budget, no
 * transmission, never a PointLight, dispose never frees shared resources,
 * orientation from pin 1's real hole, robustness to synthetic pins and to
 * node (no DOM → canvas textures degrade to null, builds never throw).
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG, getEntry } from '../src/model/catalog'
import type { ComponentInstance, ComponentTelemetry } from '../src/model/types'
import { componentPinHoles, holePosition, offboardTerminalPosition } from '../src/model/breadboard'
import {
  buildComponentObject,
  disposeComponentObject,
  updateComponentVisual,
} from '../src/three/component-meshes'
import { isSharedResource } from '../src/three/meshes/shared'
import { TERMINAL_TOP_Y } from '../src/three/internal/wires'
import { LOGIC_CHANNEL_COLORS, logicChannelIndex } from '../src/three/meshes/instruments-ext'
import { BLUEPILL_MESH_TOP } from '../src/three/meshes/boards'
import { MM } from '../src/three/meshes/pcb'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

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

function spritesOf(root: THREE.Object3D): THREE.Sprite[] {
  const out: THREE.Sprite[] = []
  root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) out.push(o as THREE.Sprite)
  })
  return out
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>()
  for (const m of meshesOf(root)) {
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) out.add(mm)
  }
  return [...out]
}

function triangleCount(root: THREE.Object3D): number {
  let tris = 0
  for (const m of meshesOf(root)) {
    const g = m.geometry
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3
  }
  return tris
}

function lightsOf(root: THREE.Object3D): THREE.Light[] {
  const out: THREE.Light[] = []
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) out.push(o as THREE.Light)
  })
  return out
}

/** World-space pin positions exactly as the scene computes them. */
function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const entry = entryOf(comp.type)
  const holes = componentPinHoles(comp, entry)
  if (!holes) throw new Error(`malformed placement for ${comp.id}`)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

const centroidX = (pins: THREE.Vector3[]) => pins.reduce((s, p) => s + p.x, 0) / pins.length

// ---------------------------------------------------------------------------
// Blue Pill
// ---------------------------------------------------------------------------

describe('Blue Pill (visual.shape bluepill)', () => {
  const bp = (extra: Partial<ComponentInstance> = {}): ComponentInstance => ({
    id: 'U1',
    type: 'stm32_bluepill',
    at: 'h10',
    ...extra,
  })

  it('builds a real model (not the fallback box) inside the 4000-triangle budget', () => {
    const comp = bp()
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), scenePins(comp))
    const tris = triangleCount(built.object)
    expect(tris).toBeGreaterThan(1500) // the fallback box is 12 triangles
    expect(tris).toBeLessThanOrEqual(4000)
    // statics merged per material: a handful of draws, not hundreds
    expect(meshesOf(built.object).length).toBeLessThanOrEqual(24)
    disposeComponentObject(built.object)
  })

  it('pinWorld stays exactly at the catalog pin holes (wire attachment)', () => {
    const comp = bp()
    const pins = scenePins(comp)
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), pins)
    expect(built.pinWorld).toHaveLength(40)
    built.pinWorld.forEach((p, i) => expect(p.distanceTo(pins[i])).toBeLessThan(1e-9))
    disposeComponentObject(built.object)
  })

  it('true proportions: 53 × 22.6 mm board centered on its pins, PCB top at 4.1 mm', () => {
    const comp = bp()
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), scenePins(comp))
    built.object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(built.object)
    const size = box.getSize(new THREE.Vector3())
    // 53 mm board + ~0.8 mm micro-USB overhang along x; 22.6 mm across
    expect(size.x).toBeGreaterThan(53 * MM)
    expect(size.x).toBeLessThan(55 * MM)
    expect(size.z).toBeCloseTo(22.6 * MM, 2)
    // centered on the pin rect (cols 10..29, rows c/h → z 5..11)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(8, 2)
    // tallest feature = the BOOT jumper caps, exported for the router height
    expect(box.max.y).toBeCloseTo(BLUEPILL_MESH_TOP, 3)
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6) // nothing below the breadboard face
    disposeComponentObject(built.object)
  })

  it('orientation follows pin 1: a 180°-rotated board puts the USB at the other end', () => {
    const usbCenterX = (comp: ComponentInstance): number => {
      const built = buildComponentObject(comp, entryOf('stm32_bluepill'), scenePins(comp))
      built.object.updateMatrixWorld(true)
      // the micro-USB shell is the only mesh in its stainless tone (0xb4b8bd)
      const shell = meshesOf(built.object).find(
        (m) => (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0xb4b8bd,
      )
      expect(shell).toBeDefined()
      const box = new THREE.Box3().setFromObject(shell!)
      disposeComponentObject(built.object)
      return (box.min.x + box.max.x) / 2
    }
    // rotation 0: pin 1 = h10 (left end) → USB left of column 10
    expect(usbCenterX(bp())).toBeLessThan(10.5)
    // rotation 180 anchored at c29: pin 1 = c29 (right end) → USB right of 29
    expect(usbCenterX(bp({ at: 'c29', rotation: 180 }))).toBeGreaterThan(28.5)
  })

  /** merged static mesh by its material tone (each finish is one merged mesh) */
  const meshByColor = (root: THREE.Object3D, hex: number): THREE.Mesh | undefined =>
    meshesOf(root).find((m) => (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === hex)
  const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o)
  const PCB_BOTTOM = 2.5 * MM
  const PCB_TOP = (2.5 + 1.6) * MM

  it('thin routed edge: the FR4 core shows between mask lips, the PCB floats over an air gap', () => {
    const comp = bp()
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), scenePins(comp))
    built.object.updateMatrixWorld(true)
    // the FR4 core band: thinner than the 1.6 mm board (mask lips + the
    // roll-over chamfer take the rest), never below the PCB bottom
    const fr4 = meshByColor(built.object, 0x9a9470)
    expect(fr4).toBeDefined()
    const fb = boxOf(fr4!)
    expect(fb.max.y - fb.min.y).toBeLessThan(1.5 * MM)
    expect(fb.max.y - fb.min.y).toBeGreaterThan(1.1 * MM)
    expect(fb.min.y).toBeGreaterThan(PCB_BOTTOM)
    expect(fb.max.y).toBeLessThan(PCB_TOP)
    // a ray along the board at mid-spacer height: nothing on the centerline
    // (open air under the PCB), the black header strip on each pin row
    const meshes = meshesOf(built.object)
    const ray = (z: number) =>
      new THREE.Raycaster(new THREE.Vector3(-10, 1.25 * MM, z), new THREE.Vector3(1, 0, 0)).intersectObjects(meshes, false)
    expect(ray(8)).toHaveLength(0)
    for (const rowZ of [5, 11]) {
      const hits = ray(rowZ)
      expect(hits.length).toBeGreaterThan(0)
      expect((hits[0].object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>).material.color.getHex()).toBe(0x151517)
    }
    disposeComponentObject(built.object)
  })

  it('header posts: 1.4 mm proud with chamfered flat tips; the free BOOT post as tall as a shunt', () => {
    const comp = bp()
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), scenePins(comp))
    built.object.updateMatrixWorld(true)
    const tinned = meshByColor(built.object, 0xd8dce0)
    expect(tinned).toBeDefined()
    const tb = boxOf(tinned!)
    // 2.5 mm plastic + 3.0 mm short end − 1.6 mm PCB; the wire router keeps
    // its clearance against 1.42 mm (tests/wire-router.test.ts)
    expect(tb.max.y).toBeLessThanOrEqual(PCB_TOP + 1.42 * MM + 1e-6)
    expect(tb.max.y).toBeGreaterThan(PCB_TOP + 1.2 * MM)
    // flat chamfered tips, not stamped points: every one of the 40 posts
    // contributes a 4-corner top face at the tip height
    const pos = tinned!.geometry.getAttribute('position') as THREE.BufferAttribute
    const topLocal = Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)))
    const corners = new Set<string>()
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - topLocal) < 1e-6) corners.add(`${pos.getX(i).toFixed(4)}:${pos.getZ(i).toFixed(4)}`)
    }
    expect(corners.size).toBe(40 * 4)
    // gold BOOT / SWD posts: the exposed one stands about as tall as a cap
    const gold = meshByColor(built.object, 0xdcb05a)
    expect(gold).toBeDefined()
    const gb = boxOf(gold!)
    expect(gb.max.y).toBeLessThanOrEqual(BLUEPILL_MESH_TOP)
    expect(gb.max.y).toBeGreaterThan(BLUEPILL_MESH_TOP - 0.6 * MM)
    disposeComponentObject(built.object)
  })

  it('package proportions: LQFP48 7 × 7 mm at 45°, HC-49S 11.35 × 4.95 mm, micro-USB 7.5 × 5 mm past the edge', () => {
    const comp = bp()
    const pins = scenePins(comp)
    const built = buildComponentObject(comp, entryOf('stm32_bluepill'), pins)
    built.object.updateMatrixWorld(true)
    // LQFP body (widest at its parting line): a 7 mm square turned 45°
    const mold = boxOf(meshByColor(built.object, 0x222226)!)
    expect(mold.max.x - mold.min.x).toBeCloseTo(7 * Math.SQRT2 * MM, 2)
    expect(mold.max.z - mold.min.z).toBeCloseTo(7 * Math.SQRT2 * MM, 2)
    expect(mold.max.y - PCB_TOP).toBeLessThan(1.6 * MM) // DS5319 LQFP48: A max 1.6 mm
    // HC-49S can walls (base flange 11.35 × 4.95, can 3.3 mm tall + flange)
    const can = boxOf(meshByColor(built.object, 0xb8bdc3)!)
    expect(can.max.x - can.min.x).toBeCloseTo(11.35 * MM, 2)
    expect(can.max.z - can.min.z).toBeCloseTo(4.95 * MM, 2)
    expect(can.max.y - PCB_TOP).toBeLessThan(3.9 * MM)
    // micro-USB B shell: 7.5 mm wide, 5.0 mm deep, mouth 0.6 mm past the
    // pin-1 end of the 53 mm board (rotation 0: −x)
    const usb = boxOf(meshByColor(built.object, 0xb4b8bd)!)
    expect(usb.max.z - usb.min.z).toBeCloseTo(7.5 * MM, 2)
    expect(usb.max.x - usb.min.x).toBeCloseTo(5.0 * MM, 2)
    const boardMinX = centroidX(pins) - 26.5 * MM
    expect(boardMinX - usb.min.x).toBeCloseTo(0.6 * MM, 2)
    disposeComponentObject(built.object)
  })

  it('survives collinear synthetic pins (meshes.test.ts pattern) without throwing', () => {
    const entry = entryOf('stm32_bluepill')
    const pins = entry.pins.map((_, i) => v(i * 2, 0, 0))
    const built = buildComponentObject({ id: 'T', type: 'stm32_bluepill' }, entry, pins)
    expect(triangleCount(built.object)).toBeLessThanOrEqual(4000)
    expect(built.pinWorld).toHaveLength(40)
    // degenerate inputs must still yield the real model, not the fallback
    expect(triangleCount(built.object)).toBeGreaterThan(1500)
    disposeComponentObject(built.object)
    // and even a malformed 2-pin call
    const tiny = buildComponentObject({ id: 'T2', type: 'stm32_bluepill' }, entry, [v(0, 0, 0), v(0, 0, 0)])
    expect(tiny.pinWorld).toHaveLength(2)
    disposeComponentObject(tiny.object)
  })

  it('no transmission, no lights; LEDs light from sub telemetry (emissive + sprite)', () => {
    const comp = bp()
    const entry = entryOf('stm32_bluepill')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const transmissive = materialsOf(built.object).filter(
      (m) => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0,
    )
    expect(transmissive).toHaveLength(0)
    const glows = spritesOf(built.object)
    expect(glows).toHaveLength(2)
    expect(glows.every((g) => !g.visible)).toBe(true)
    const lenses = materialsOf(built.object).filter(
      (m) => !isSharedResource(m) && (m as THREE.MeshPhysicalMaterial).emissive?.getHex() !== 0,
    ) as THREE.MeshPhysicalMaterial[]
    expect(lenses).toHaveLength(2) // PWR (red) + PC13 (green) lenses, per instance

    updateComponentVisual(
      built,
      comp,
      entry,
      tel({ sub: { LED_PWR: tel({ ledBrightness: 0.9 }), LED_PC13: tel({ ledBrightness: 0 }) } }),
    )
    const lit = lenses.filter((m) => m.emissiveIntensity > 1)
    expect(lit).toHaveLength(1)
    expect(lit[0].emissive.getHex()).toBe(0xff3526) // the red power LED
    expect(glows.filter((g) => g.visible)).toHaveLength(1)
    expect(lightsOf(built.object)).toHaveLength(0) // never a PointLight

    // PC13 on, power LED burned: the dead LED goes dark and smoked
    updateComponentVisual(
      built,
      comp,
      entry,
      tel({ sub: { LED_PWR: tel({ burned: true }), LED_PC13: tel({ ledBrightness: 0.5 }) } }),
    )
    expect(lenses.find((m) => m.emissive.getHex() === 0xff3526)!.emissiveIntensity).toBe(0)
    expect(lenses.find((m) => m.emissive.getHex() === 0x2ecc55)!.emissiveIntensity).toBeGreaterThan(1)
    expect(glows.filter((g) => g.visible)).toHaveLength(1)

    // sim stopped (null telemetry): everything dark again
    updateComponentVisual(built, comp, entry, null)
    expect(lenses.every((m) => m.emissiveIntensity === 0)).toBe(true)
    expect(glows.every((g) => !g.visible)).toBe(true)
    disposeComponentObject(built.object)
  })

  it('the BOOT0 jumper follows the runtime param (one 2.54 mm step)', () => {
    const entry = entryOf('stm32_bluepill')
    const comp = bp()
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const yellow = (root: THREE.Object3D) =>
      meshesOf(root).filter((m) => (m.material as THREE.MeshPhysicalMaterial).color?.getHex() === 0xf2c21b)
    // static BOOT1 jumper is merged into the board (identity transform); the
    // BOOT0 jumper is its own positioned mesh
    const movable = yellow(built.object).find((m) => m.position.lengthSq() > 0)
    expect(movable).toBeDefined()
    const x0 = movable!.position.x
    updateComponentVisual(built, { ...comp, params: { boot0: '1' } }, entry, null)
    expect(movable!.position.x - x0).toBeCloseTo(2.54 * MM, 6)
    updateComponentVisual(built, { ...comp, params: { boot0: '0' } }, entry, null)
    expect(movable!.position.x).toBeCloseTo(x0, 6)
    disposeComponentObject(built.object)
  })

  it('static geometry is merged once and shared by every instance (cheap ghost)', () => {
    const entry = entryOf('stm32_bluepill')
    const a = buildComponentObject(bp(), entry, scenePins(bp()))
    const g = buildComponentObject({ id: '__ghost__', type: 'stm32_bluepill', at: 'h30' }, entry, scenePins(bp({ at: 'h30' })))
    const geosA = new Set(meshesOf(a.object).map((m) => m.geometry))
    const geosG = meshesOf(g.object).map((m) => m.geometry)
    // the ghost reuses the very same merged geometries (no rebuild per hover)
    expect(geosG.every((geo) => geosA.has(geo))).toBe(true)
    expect(geosG.every((geo) => isSharedResource(geo))).toBe(true)
    // ghost: no halo sprites, no per-instance materials
    expect(spritesOf(g.object)).toHaveLength(0)
    expect(materialsOf(g.object).every((m) => isSharedResource(m))).toBe(true)
    disposeComponentObject(a.object)
    disposeComponentObject(g.object)
  })

  it('dispose frees only per-instance resources; a second board is unaffected', () => {
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
      const entry = entryOf('stm32_bluepill')
      const a = buildComponentObject(bp(), entry, scenePins(bp()))
      const b = buildComponentObject(bp({ id: 'U2', at: 'h35' }), entry, scenePins(bp({ at: 'h35' })))
      disposeComponentObject(a.object)
      expect(disposed.length).toBeGreaterThan(0) // the LED lens materials at least
      for (const r of disposed) expect(isSharedResource(r)).toBe(false)
      for (const m of materialsOf(b.object)) expect(disposed.includes(m)).toBe(false)
      for (const m of meshesOf(b.object)) expect(disposed.includes(m.geometry)).toBe(false)
      disposeComponentObject(b.object)
    } finally {
      THREE.Material.prototype.dispose = origMat
      THREE.BufferGeometry.prototype.dispose = origGeo
    }
  })
})

// ---------------------------------------------------------------------------
// Logic probe
// ---------------------------------------------------------------------------

describe('logic analyzer probe (visual.shape logic_probe)', () => {
  const entry = () => entryOf('logic_probe')

  it('channel → standard 8-color palette, repeating for D8-D15', () => {
    expect(logicChannelIndex('D0')).toBe(0)
    expect(logicChannelIndex('D7')).toBe(7)
    expect(logicChannelIndex('D15')).toBe(15)
    expect(logicChannelIndex('garbage')).toBe(0)
    for (const [ch, idx] of [
      ['D0', 0],
      ['D2', 2],
      ['D7', 7],
      ['D8', 0],
      ['D10', 2],
      ['D15', 7],
    ] as const) {
      const built = buildComponentObject(
        { id: 'LA', type: 'logic_probe', params: { channel: ch } },
        entry(),
        [v(5, 0, 3)],
      )
      const colors = materialsOf(built.object).map((m) => (m as THREE.MeshPhysicalMaterial).color?.getHex())
      expect(colors, ch).toContain(LOGIC_CHANNEL_COLORS[idx])
      disposeComponentObject(built.object)
    }
  })

  it('is a real clip (hook into the hole), distinct from the scope probe, inside the budget', () => {
    const la = buildComponentObject({ id: 'LA', type: 'logic_probe' }, entry(), [v(5, 0, 3)])
    const scope = buildComponentObject({ id: 'P1', type: 'scope_probe' }, entryOf('scope_probe'), [v(5, 0, 3)])
    expect(triangleCount(la.object)).toBeGreaterThan(200)
    expect(triangleCount(la.object)).toBeLessThanOrEqual(4000)
    expect(meshesOf(la.object).length).toBeLessThanOrEqual(4) // statically merged
    // the hook reaches into the hole
    const box = new THREE.Box3().setFromObject(la.object)
    expect(box.min.y).toBeLessThan(-0.1)
    // different silhouette: no shared geometry with the scope probe, and no
    // black boot material (the scope probe's 0x26262a)
    const scopeGeos = new Set(meshesOf(scope.object).map((m) => m.geometry))
    expect(meshesOf(la.object).some((m) => scopeGeos.has(m.geometry))).toBe(false)
    expect(materialsOf(la.object).some((m) => (m as THREE.MeshPhysicalMaterial).color?.getHex() === 0x26262a)).toBe(false)
    expect(la.pinWorld[0].distanceTo(v(5, 0, 3))).toBeLessThan(1e-9)
    disposeComponentObject(la.object)
    disposeComponentObject(scope.object)
  })
})

// ---------------------------------------------------------------------------
// Multimeter
// ---------------------------------------------------------------------------

describe('bench multimeter (visual.shape dmm)', () => {
  const entry = () => entryOf('multimeter')
  const pins = () => [0, 1].map((i) => {
    const p = offboardTerminalPosition(0, i)
    return v(p.x, 0, p.z)
  })

  it('binding posts attach wires exactly at the terminal tops (PSU convention)', () => {
    const built = buildComponentObject({ id: 'DMM1', type: 'multimeter' }, entry(), pins())
    expect(built.pinWorld).toHaveLength(2)
    built.pinWorld.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pins()[i].x, 9)
      expect(p.z).toBeCloseTo(pins()[i].z, 9)
      expect(p.y).toBe(TERMINAL_TOP_Y)
    })
    expect(triangleCount(built.object)).toBeLessThanOrEqual(4000)
    // enclosure stays inside the offboard body rect the validator/router use
    // (≤ 0.1 = the rubber corner bumpers' molded overhang — the PSU
    // enclosure in instruments.ts has exactly the same bumpers)
    const box = new THREE.Box3().setFromObject(built.object)
    const anchor = { x: pins()[0].x - 2, z: pins()[0].z - 2 }
    expect(box.min.x).toBeGreaterThanOrEqual(anchor.x - 0.1)
    expect(box.max.x).toBeLessThanOrEqual(anchor.x + 6.5 + 0.1)
    expect(box.min.z).toBeGreaterThanOrEqual(anchor.z - 2 - 0.1)
    expect(box.max.z).toBeLessThanOrEqual(anchor.z + 2.5 + 0.1)
    expect(box.max.y).toBeLessThanOrEqual(4) // OFFBOARD_BODY_HEIGHT
    disposeComponentObject(built.object)
  })

  it('the selector knob turns to the active mode; telemetry text never throws headless', () => {
    const e = entry()
    const built = buildComponentObject({ id: 'DMM1', type: 'multimeter' }, e, pins())
    // the knob is the only rotated child group (its pointer sits on the mode)
    const knobRoll = () => {
      let roll: number | null = null
      built.object.traverse((o) => {
        if (o !== built.object && (o as THREE.Group).isGroup && o.children.length > 0) roll = o.rotation.z
      })
      return roll as number | null
    }
    expect(knobRoll()).toBeCloseTo(0.87, 6) // default 'V' (upper-left legend)
    updateComponentVisual(built, { id: 'DMM1', type: 'multimeter', params: { mode: 'Ω' } }, e, tel({ text: ['1.000 kΩ'] }))
    expect(knobRoll()).toBeCloseTo(-0.87, 6)
    updateComponentVisual(built, { id: 'DMM1', type: 'multimeter', params: { mode: 'A' } }, e, tel({ text: ['-12.5 mA'] }))
    expect(knobRoll()).toBeCloseTo(0, 6)
    updateComponentVisual(built, { id: 'DMM1', type: 'multimeter', params: { mode: 'A' } }, e, null)
    const transmissive = materialsOf(built.object).filter(
      (m) => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0,
    )
    expect(transmissive).toHaveLength(0)
    disposeComponentObject(built.object)
  })
})

// ---------------------------------------------------------------------------
// Catalog support annotations (legacy entries)
// ---------------------------------------------------------------------------

describe('legacy catalog entries carry honest support annotations', () => {
  const LEGACY = [
    'resistor', 'capacitor', 'inductor', 'potentiometer', 'photoresistor', 'diode', 'led', 'npn', 'pnp',
    'nmos', 'pushbutton', 'slide_switch', 'dip_switch_8', 'power_supply', 'function_generator',
    'seven_segment', 'buzzer', 'ne555', 'lm358', 'sn7400', 'sn7404', 'sn7408', 'sn7432', 'sn7486',
    'sn7474', 'cd4017', 'cd4026', 'cd4511', 'sn74193', 'cd4040', 'scope_probe',
  ]

  it('all 31 legacy entries declare a level, what is simulated and its limits', () => {
    expect(LEGACY).toHaveLength(31)
    for (const t of LEGACY) {
      const s = CATALOG[t]?.support
      expect(s, t).toBeDefined()
      expect(['full', 'partial', 'visual', 'dev'], t).toContain(s!.level)
      expect(s!.simulated?.length ?? 0, `${t} simulated`).toBeGreaterThan(0)
      expect(s!.limits?.length ?? 0, `${t} limits`).toBeGreaterThan(0)
    }
  })

  it('states the known model facts the engine actually implements', () => {
    const text = (t: string) => JSON.stringify(CATALOG[t].support)
    // honesty F9 / F11: a reversed electrolytic now vents (its value is kept, so still 'partial'),
    // and the LED burns from its junction temperature, not after 30 mA for 1 ms
    expect(text('capacitor')).toMatch(/reversed by more than 1 V vents/)
    expect(text('capacitor')).toMatch(/keeps its capacitance/)
    expect(CATALOG.capacitor.support!.level).toBe('partial')
    expect(text('led')).toMatch(/junction temperature/)
    expect(text('led')).toMatch(/rated 20 mA/)
    expect(text('resistor')).toMatch(/burns it open/)
    expect(text('nmos')).toMatch(/Vth = 2 V/)
    expect(text('buzzer')).toMatch(/300 Ω/)
    expect(CATALOG.buzzer.support!.level).toBe('partial')
    for (const t of ['ne555', 'sn7400', 'cd4017', 'sn74193']) expect(text(t), t).toMatch(/behavioral/)
  })
})
