/**
 * Basic-parts meshes (src/three/meshes/ext/basic.mesh.ts) — same standard as
 * tests/meshes.test.ts and tests/meshes-embedded.test.ts: real models (not
 * the fallback box) inside the 4000-triangle budget, pinWorld exactly at the
 * catalog pins (off-board: terminal tops), no transmission (the single-color
 * LED's privilege), never a light, dispose never frees shared resources,
 * synthetic collinear pins never throw, declared router heights cover the
 * real mesh tops, telemetry / params pose what they claim.
 *
 * Runs in node (no DOM): canvas prints and screens degrade to null by design.
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
import { registeredMeshShapes } from '../src/three/meshes/registry'
import { TERMINAL_TOP_Y } from '../src/three/internal/wires'
import {
  AMS1117_TOP,
  HC49_TOP,
  LEVEL_SHIFTER_TOP,
  NTC_TOP,
  RELAY_TOP,
  RGB_EPOXY_OPACITY,
  RGB_LED_TOP,
  TO220_TOP,
  TOGGLE_TOP,
} from '../src/three/meshes/ext/basic.mesh'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const BASIC_TYPES = [
  'rgb_led',
  'pmos',
  'irlz44n',
  'zener',
  'pc817',
  'lm7805',
  'ams1117_33',
  'battery_9v',
  'battery_aa2',
  'current_source',
  'relay_5v',
  'toggle_switch',
  'ntc_10k',
  'crystal_hc49',
  'level_shifter_4ch',
]

/** a valid on-board placement per type (offboard: none) */
const PLACED: Record<string, ComponentInstance> = {
  rgb_led: { id: 'D1', type: 'rgb_led', holes: ['a10', 'a11', 'a12', 'a13'] },
  pmos: { id: 'Q1', type: 'pmos', holes: ['a10', 'a11', 'a12'] },
  irlz44n: { id: 'Q2', type: 'irlz44n', holes: ['a10', 'a11', 'a12'] },
  zener: { id: 'Z1', type: 'zener', holes: ['a10', 'a14'] },
  pc817: { id: 'U1', type: 'pc817', at: 'f10' },
  lm7805: { id: 'U2', type: 'lm7805', holes: ['a10', 'a11', 'a12'] },
  ams1117_33: { id: 'U3', type: 'ams1117_33', holes: ['a10', 'a11', 'a12'] },
  relay_5v: { id: 'K1', type: 'relay_5v', at: 'd20' },
  toggle_switch: { id: 'S1', type: 'toggle_switch', holes: ['a10', 'a11', 'a12'] },
  ntc_10k: { id: 'TH1', type: 'ntc_10k', holes: ['a10', 'a12'] },
  crystal_hc49: { id: 'Y1', type: 'crystal_hc49', holes: ['a10', 'a12'] },
  level_shifter_4ch: { id: 'U4', type: 'level_shifter_4ch', at: 'g30' },
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

/** World-space pin positions exactly as the scene computes them. */
function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const entry = entryOf(comp.type)
  if (entry.placement === 'offboard') {
    return entry.pins.map((_, i) => {
      const p = offboardTerminalPosition(0, i)
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

/** Mesh-only world bounding box (sprites excluded). */
function meshBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const m of meshesOf(root)) {
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
  }
  return box
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

// ---------------------------------------------------------------------------

describe('every basic part', () => {
  it('has a registered builder (or a built-in shape) and builds a real model', () => {
    const shapes = new Set(registeredMeshShapes())
    for (const t of BASIC_TYPES) {
      const shape = CATALOG[t].visual?.shape
      expect(shape === 'dip' || shapes.has(shape ?? ''), `${t} shape ${shape}`).toBe(true)
      const comp = compFor(t)
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      const tris = triangleCount(built.object)
      expect(tris, `${t} is not the 12-triangle fallback box`).toBeGreaterThan(60)
      expect(tris, `${t} budget`).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
    }
  })

  it('pinWorld sits exactly at the catalog pins (off-board: on the terminal tops)', () => {
    for (const t of BASIC_TYPES) {
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

  it('no transmission (alpha-blend only), never a light', () => {
    for (const t of BASIC_TYPES) {
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
      for (const t of BASIC_TYPES) {
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
    for (const t of BASIC_TYPES) {
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

  it('ghost previews build without per-instance canvases or sprites', () => {
    for (const t of BASIC_TYPES) {
      const comp = { ...compFor(t), id: '__ghost__' }
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      expect(spritesOf(built.object), t).toHaveLength(0)
      disposeComponentObject(built.object)
    }
  })
})

describe('router heights and body extents match the meshes', () => {
  it('every declared obstacleHeight covers the real mesh top', () => {
    const tops: Record<string, number> = {
      rgb_led: RGB_LED_TOP,
      irlz44n: TO220_TOP,
      lm7805: TO220_TOP,
      ams1117_33: AMS1117_TOP,
      relay_5v: RELAY_TOP,
      toggle_switch: TOGGLE_TOP,
      ntc_10k: NTC_TOP,
      crystal_hc49: HC49_TOP,
      level_shifter_4ch: LEVEL_SHIFTER_TOP,
    }
    for (const [t, top] of Object.entries(tops)) {
      const comp = compFor(t)
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      const box = meshBox(built.object)
      expect(box.max.y, `${t} exported top`).toBeLessThanOrEqual(top + 1e-6)
      expect(CATALOG[t].obstacleHeight!, `${t} obstacleHeight`).toBeGreaterThanOrEqual(box.max.y)
      expect(box.min.y, `${t} nothing below the hole depth`).toBeGreaterThanOrEqual(-0.2)
      disposeComponentObject(built.object)
    }
    // the TO-92 P-FET reuses the TO-92 body (router height of the legacy nmos)
    const comp = compFor('pmos')
    const built = buildComponentObject(comp, entryOf('pmos'), scenePins(comp))
    expect(CATALOG.pmos.obstacleHeight!).toBeGreaterThanOrEqual(meshBox(built.object).max.y)
    disposeComponentObject(built.object)
  })

  it('footprint modules stay inside their declared body rects', () => {
    // a hole is covered when the body crosses its center: the relay at d20
    // must cross columns 19..25 and rows c..h (z 5..11) but no further
    const relay = buildComponentObject(PLACED.relay_5v, entryOf('relay_5v'), scenePins(PLACED.relay_5v))
    const rb = meshBox(relay.object)
    expect(rb.min.x).toBeGreaterThan(18)
    expect(rb.min.x).toBeLessThan(19)
    expect(rb.max.x).toBeGreaterThan(25)
    expect(rb.max.x).toBeLessThan(26)
    expect(rb.min.z).toBeGreaterThan(4)
    expect(rb.min.z).toBeLessThan(5)
    expect(rb.max.z).toBeGreaterThan(11)
    expect(rb.max.z).toBeLessThan(12)
    disposeComponentObject(relay.object)
    // level shifter at g30: columns 30..35, rows d..g (z 6..10), not c / h
    const ls = buildComponentObject(PLACED.level_shifter_4ch, entryOf('level_shifter_4ch'), scenePins(PLACED.level_shifter_4ch))
    const lb = meshBox(ls.object)
    expect(lb.min.x).toBeGreaterThan(29)
    expect(lb.max.x).toBeLessThan(36)
    expect(lb.min.z).toBeGreaterThan(5)
    expect(lb.max.z).toBeLessThan(11)
    expect((lb.min.z + lb.max.z) / 2).toBeCloseTo(8, 1)
    disposeComponentObject(ls.object)
  })

  it('off-board sources stay inside the instrument rect, under the 4-unit height', () => {
    for (const t of ['battery_9v', 'battery_aa2', 'current_source']) {
      const pins = scenePins({ id: 'B', type: t })
      const built = buildComponentObject({ id: 'B', type: t }, entryOf(t), pins)
      const box = meshBox(built.object)
      const anchor = { x: pins[0].x - 2, z: pins[0].z - 2 }
      expect(box.min.x, t).toBeGreaterThanOrEqual(anchor.x - 0.1)
      expect(box.max.x, t).toBeLessThanOrEqual(anchor.x + 6.5 + 0.1)
      expect(box.min.z, t).toBeGreaterThanOrEqual(anchor.z - 2 - 0.1)
      expect(box.max.z, t).toBeLessThanOrEqual(anchor.z + 2.5 + 0.1)
      expect(box.max.y, t).toBeLessThanOrEqual(4)
      expect(box.min.y, t).toBeGreaterThanOrEqual(-1e-6)
      disposeComponentObject(built.object)
    }
  })
})

describe('state-driven visuals', () => {
  it('RGB LED: the epoxy glows the additive mix of the lit dies; dark when off', () => {
    const comp = PLACED.rgb_led
    const entry = entryOf('rgb_led')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const glass = materialsOf(built.object).find(
      (m) => (m as THREE.MeshPhysicalMaterial).transparent && (m as THREE.MeshPhysicalMaterial).opacity === RGB_EPOXY_OPACITY,
    ) as THREE.MeshPhysicalMaterial
    expect(glass).toBeDefined()
    expect(isSharedResource(glass)).toBe(false) // per-instance: it carries the emission
    const [glow] = spritesOf(built.object)
    expect(glow.visible).toBe(false)
    // red + blue → magenta
    updateComponentVisual(built, comp, entry, tel({ leds: { R: 1, G: 0, B: 1 }, ledBrightness: 1 }))
    expect(glass.emissiveIntensity).toBeGreaterThan(0.5)
    expect(glass.emissive.r).toBeGreaterThan(0.8)
    expect(glass.emissive.b).toBeGreaterThan(0.8)
    expect(glass.emissive.g).toBeLessThan(0.2)
    // the diffused body itself takes the hue (not a white body with a glow)
    expect(glass.color.g).toBeLessThan(0.2 * glass.color.r)
    expect(glass.color.g).toBeLessThan(0.2 * glass.color.b)
    expect(glow.visible).toBe(true)
    expect((glow.material as THREE.SpriteMaterial).color.getHex()).toBe(glass.emissive.getHex())
    // green only
    updateComponentVisual(built, comp, entry, tel({ leds: { R: 0, G: 0.5, B: 0 } }))
    expect(glass.emissive.g).toBeCloseTo(1, 6)
    expect(glass.emissive.r).toBeLessThan(0.2)
    // off
    updateComponentVisual(built, comp, entry, tel({ leds: { R: 0, G: 0, B: 0 } }))
    expect(glass.emissiveIntensity).toBe(0)
    expect(glow.visible).toBe(false)
    // burned → scorched tint, restored when the engine clears it
    const base = glass.color.getHex()
    updateComponentVisual(built, comp, entry, tel({ burned: true }))
    expect(glass.color.getHex()).not.toBe(base)
    updateComponentVisual(built, comp, entry, tel({}))
    expect(glass.color.getHex()).toBe(base)
    disposeComponentObject(built.object)
  })

  it('RGB LED leads: four bent leads, the common one bowing furthest out', () => {
    // the merged lead mesh spans further toward the viewer (+z) than the pins
    const comp = PLACED.rgb_led
    const built = buildComponentObject(comp, entryOf('rgb_led'), scenePins(comp))
    const box = meshBox(built.object)
    expect(box.max.z).toBeGreaterThan(3 + 0.3)
    disposeComponentObject(built.object)
  })

  it('toggle: the bat lever points away from the connected terminal', () => {
    const comp = PLACED.toggle_switch
    const entry = entryOf('toggle_switch')
    const built = buildComponentObject(comp, entry, scenePins(comp))
    const lever = (): THREE.Object3D => {
      let found: THREE.Object3D | null = null
      built.object.traverse((o) => {
        if (o !== built.object && (o as THREE.Group).isGroup && o.rotation.z !== 0) found = o
      })
      return found!
    }
    expect(lever().rotation.z).toBeLessThan(0) // 'a' → tilts toward b (+x)
    updateComponentVisual(built, { ...comp, params: { state: 'b' } }, entry, null)
    expect(lever().rotation.z).toBeGreaterThan(0)
    disposeComponentObject(built.object)
  })

  it('relay: orientation follows the real pin holes (rotation 180 flips the body)', () => {
    const centerX = (comp: ComponentInstance) => {
      const built = buildComponentObject(comp, entryOf('relay_5v'), scenePins(comp))
      const box = meshBox(built.object)
      disposeComponentObject(built.object)
      return (box.min.x + box.max.x) / 2
    }
    expect(centerX(PLACED.relay_5v)).toBeCloseTo(21.8, 1) // coil column 20 + 1.8
    expect(centerX({ id: 'K1', type: 'relay_5v', at: 'g40', rotation: 180 })).toBeCloseTo(38.2, 1)
  })

  it('zener: DO-35 glass like the 1N4148 but a different cathode band', () => {
    const pins = [v(0, 0, 0), v(4, 0, 0)]
    const z = buildComponentObject({ id: 'Z', type: 'zener' }, entryOf('zener'), pins)
    const d = buildComponentObject({ id: 'D', type: 'diode' }, entryOf('diode'), pins)
    const colors = (o: THREE.Object3D) => materialsOf(o).map((m) => (m as THREE.MeshPhysicalMaterial).color?.getHex())
    expect(colors(d.object)).toContain(0x191310)
    expect(colors(z.object)).not.toContain(0x191310)
    expect(colors(z.object)).toContain(0x1f3c96)
    expect(meshesOf(z.object).length).toBe(meshesOf(d.object).length)
    disposeComponentObject(z.object)
    disposeComponentObject(d.object)
  })

  it('current source: CC / CV lamps follow the telemetry', () => {
    const pins = scenePins({ id: 'I1', type: 'current_source' })
    const entry = entryOf('current_source')
    const comp = { id: 'I1', type: 'current_source' }
    const built = buildComponentObject(comp, entry, pins)
    const lamps = materialsOf(built.object).filter(
      (m) => !isSharedResource(m) && (m as THREE.MeshStandardMaterial).emissive?.getHex() !== 0 && (m as THREE.MeshStandardMaterial).emissiveMap === null,
    ) as THREE.MeshStandardMaterial[]
    expect(lamps).toHaveLength(2)
    expect(lamps.every((l) => l.emissiveIntensity === 0)).toBe(true) // not running
    updateComponentVisual(built, comp, entry, tel({ values: { iout: 0.01, vout: 1, compliance: 0, iset: 0.01 } }))
    expect(lamps.filter((l) => l.emissiveIntensity > 0).map((l) => l.emissive.getHex())).toEqual([0x35d158])
    updateComponentVisual(built, comp, entry, tel({ values: { iout: 0.006, vout: 12, compliance: 1, iset: 0.01 } }))
    expect(lamps.filter((l) => l.emissiveIntensity > 0).map((l) => l.emissive.getHex())).toEqual([0xff4a3a])
    disposeComponentObject(built.object)
  })

  it('TO-220: nickel tab with its mounting hole above the molded body', () => {
    const comp = PLACED.lm7805
    const built = buildComponentObject(comp, entryOf('lm7805'), scenePins(comp))
    const box = meshBox(built.object)
    expect(box.max.y).toBeCloseTo(TO220_TOP, 3)
    // tab is plated metal, the body is epoxy
    const mats = materialsOf(built.object) as THREE.MeshPhysicalMaterial[]
    expect(mats.some((m) => m.metalness >= 0.8 && m.color.getHex() === 0xd3d6da)).toBe(true)
    expect(mats.some((m) => m.color.getHex() === 0x18181a && m.metalness === 0)).toBe(true)
    disposeComponentObject(built.object)
  })
})
