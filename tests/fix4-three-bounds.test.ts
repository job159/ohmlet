/**
 * fix4 (three): a part's box is its body, not its light / damage sprites.
 *
 *  - THREE-1: a resistor that was red-hot (heat ≥ 2 lazily adds its haze
 *    sprite) and then cooled or was reset has EXACTLY its never-hot box —
 *    the box the selection box, framing and chip avoidance use; while hot,
 *    only its body-hugging shell widens it. The SceneFx burst / smoke start
 *    at the part's real top (the scene's fxBoundsOf: visible solid meshes),
 *    never ~1.5 units above an LED (its invisible legacy pick-proxy sprite)
 *    or a hot resistor (its haze). The LED's own Box3 stays the one it had
 *    before today's look (the pick proxy keeps classic picking and the
 *    classic selection box) — the new halo / flare / pool / soot / cracks
 *    add nothing to it.
 *  - THREE-7: the haze, the soot and SceneFx's pin-damage markers are never
 *    drawn in an override-material pass (the Enhanced SAO normal/depth
 *    pre-pass), and drawn as before otherwise.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentInstance, ComponentTelemetry, SimTelemetry } from '../src/model/types'
import { CATALOG } from '../src/model/catalog'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import { SceneFx, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import { ParticleSystem, type SpawnSpec } from '../src/three/internal/fx/particles'
import { bodyTopOf } from '../src/three/internal/current-flow'
import { BreadboardScene } from '../src/three/scene'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const tel = (t: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...t })
const snap = (time: number, components: Record<string, ComponentTelemetry>, issues: SimTelemetry['issues'] = []): SimTelemetry => ({
  time,
  netVoltages: {},
  components,
  issues,
})

const RES: ComponentInstance = { id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 10 } }
const LED: ComponentInstance = { id: 'LED1', type: 'led', holes: ['a10', 'a12'], params: { color: 'red' } }

function buildRes() {
  return buildComponentObject(RES, CATALOG.resistor, [v(0, 0, 0), v(4, 0, 0)])
}
function buildLed() {
  return buildComponentObject(LED, CATALOG.led, [v(0, 0, 0), v(2, 0, 0)])
}

/** what the scene does after each applied update: recompose the frozen subtree */
function fresh(o: THREE.Object3D): THREE.Object3D {
  o.traverse((x) => x.updateMatrix())
  o.updateWorldMatrix(true, true)
  return o
}
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(fresh(o))

function expectSameBox(a: THREE.Box3, b: THREE.Box3) {
  for (const k of ['x', 'y', 'z'] as const) {
    expect(a.min[k]).toBeCloseTo(b.min[k], 9)
    expect(a.max[k]).toBeCloseTo(b.max[k], 9)
  }
}

function named(root: THREE.Object3D, name: string): THREE.Object3D {
  const o = root.getObjectByName(name)
  expect(o, name).toBeDefined()
  return o!
}

/** the LED's soot sprite (black) and hairline cracks (0x0a0806) */
function sootOf(root: THREE.Object3D): THREE.Sprite {
  let s: THREE.Sprite | null = null
  root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite && (o as THREE.Sprite).material.color.getHex() === 0 && o.name === '') s = o as THREE.Sprite
  })
  expect(s).not.toBeNull()
  return s!
}
function cracksOf(root: THREE.Object3D): THREE.Mesh {
  let c: THREE.Mesh | null = null
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && (m.material as THREE.MeshBasicMaterial).color?.getHex?.() === 0x0a0806) c = m
  })
  expect(c).not.toBeNull()
  return c!
}

/** Box3.setFromObject semantics, leaving out `skip` (and their subtrees) */
function boxWithout(root: THREE.Object3D, skip: Set<THREE.Object3D>): THREE.Box3 {
  fresh(root)
  const out = new THREE.Box3()
  const b = new THREE.Box3()
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o)) return
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (g) {
      if (!g.boundingBox) g.computeBoundingBox()
      out.union(b.copy(g.boundingBox!).applyMatrix4(o.matrixWorld))
    }
    for (const c of o.children) visit(c)
  }
  visit(root)
  return out
}

interface Internals {
  m: unknown
  components: Map<string, { built: { object: THREE.Object3D } }>
  selectedIds: string[]
  telemetry: SimTelemetry | null
  applySelection(): void
  fxBoundsOf(id: string, out: THREE.Box3): boolean
}

function headless(id: string, object: THREE.Object3D) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const overlayGroup = new THREE.Group()
  s.m = {
    overlayGroup,
    selBoxGeo: new THREE.BoxGeometry(1, 1, 1),
    selBoxMat: new THREE.MeshBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0.3 }),
    camera: new THREE.PerspectiveCamera(),
  }
  s.components.set(id, { built: { object } })
  return { s, overlayGroup }
}

afterEach(() => vi.restoreAllMocks())

describe('THREE-1: a resistor that was hot keeps its body box', () => {
  it('heat ≥ 2 then cool / reset: exactly the never-hot box (the haze and the hidden shells add nothing)', () => {
    const built = buildRes()
    const o = built.object
    const never = boxOf(o)
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ heat: 3.9, damage: { kind: 'overheating', since: 1 } }))
    const hot = boxOf(o)
    const haze = named(o, 'res-haze') as THREE.Sprite
    expect(haze.visible).toBe(true)
    // only the body-hugging shells widen it (≤ 0.11 × the body), never the 4-unit haze
    expect(hot.max.y - never.max.y).toBeLessThan(0.06)
    expect(never.min.y - hot.min.y).toBeLessThan(0.06)
    // cools down
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ heat: 0.5 }))
    expectSameBox(boxOf(o), never)
    // hot again, then 重置模擬 (telemetry cleared, the part is not rebuilt)
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ heat: 2.6, damage: { kind: 'overheating', since: 1 } }))
    updateComponentVisual(built, RES, CATALOG.resistor, null)
    expectSameBox(boxOf(o), never)
    // burned (charred shell + gap), then reset
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ heat: 3.9, damage: { kind: 'overheating', since: 1 } }))
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ damage: { kind: 'burned', since: 2 } }))
    expect(boxOf(o).max.y - never.max.y).toBeLessThan(0.06)
    updateComponentVisual(built, RES, CATALOG.resistor, null)
    expectSameBox(boxOf(o), never)
    disposeComponentObject(o)
  })

  it('the selection box of a reset resistor is the never-hot one (classic box, no 3–4.6-unit slab)', () => {
    const built = buildRes()
    const never = boxOf(built.object).getSize(new THREE.Vector3())
    updateComponentVisual(built, RES, CATALOG.resistor, tel({ heat: 3.9, damage: { kind: 'overheating', since: 1 } }))
    updateComponentVisual(built, RES, CATALOG.resistor, null)
    fresh(built.object)
    const { s, overlayGroup } = headless('R1', built.object)
    s.selectedIds = ['R1']
    s.telemetry = null
    s.applySelection()
    const sel = overlayGroup.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[]
    expect(sel).toHaveLength(1)
    const pad = sel[0].scale.y - never.y
    expect(sel[0].scale.x - never.x).toBeCloseTo(pad, 9)
    expect(sel[0].scale.z - never.z).toBeCloseTo(pad, 9)
    expect(pad).toBeLessThan(0.5)
    disposeComponentObject(built.object)
  })

  it('a vented can that was reset has its never-vented box (the hidden petals collapse)', () => {
    const CAP: ComponentInstance = { id: 'C1', type: 'capacitor', holes: ['a10', 'a12'], params: { capacitance: 1e-4, polarized: true } }
    const built = buildComponentObject(CAP, CATALOG.capacitor, [v(0, 0, 0), v(2, 0, 0)])
    const never = boxOf(built.object)
    updateComponentVisual(built, CAP, CATALOG.capacitor, tel({ damage: { kind: 'vented', since: 1 } }))
    expect(boxOf(built.object).max.y - never.max.y).toBeGreaterThan(0.1) // the torn top shows
    updateComponentVisual(built, CAP, CATALOG.capacitor, null)
    expect(named(built.object, 'cap-vented').visible).toBe(false)
    expectSameBox(boxOf(built.object), never)
    updateComponentVisual(built, CAP, CATALOG.capacitor, tel({ damage: { kind: 'vented', since: 3 } }))
    expect(named(built.object, 'cap-vented').visible).toBe(true)
    expect(boxOf(built.object).max.y - never.max.y).toBeGreaterThan(0.1) // vents again: shown at full size
    disposeComponentObject(built.object)
  })

  it('the haze and the soot are point-bounded sprites (their box is their centre)', () => {
    const r = buildRes()
    updateComponentVisual(r, RES, CATALOG.resistor, tel({ heat: 3.9 }))
    const led = buildLed()
    for (const s of [named(r.object, 'res-haze') as THREE.Sprite, sootOf(led.object)]) {
      const bb = s.geometry.boundingBox!
      expect(bb).not.toBeNull()
      expect(bb.getSize(new THREE.Vector3()).length()).toBe(0)
      expect(s.raycast).not.toBe(THREE.Sprite.prototype.raycast) // still never picked
      expect(s.userData.bbNoStudio).toBe(true)
    }
    disposeComponentObject(r.object)
    disposeComponentObject(led.object)
  })
})

describe('THREE-1: the LED keeps its classic box; FX use its real body', () => {
  it("the LED's Box3 (selection box, framing) is unchanged by today's halo / flare / pool / soot / cracks", () => {
    const built = buildLed()
    const o = built.object
    const added = new Set<THREE.Object3D>([named(o, 'led-halo'), named(o, 'led-flare'), named(o, 'led-pool'), sootOf(o), cracksOf(o)])
    const states: (ComponentTelemetry | null)[] = [
      null,
      tel({ light: 0.5, ledBrightness: 0.5, current: 0.01 }),
      tel({ light: 3, ledBrightness: 1, current: 0.06 }),
      tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }),
      tel({ light: 0.2, ledBrightness: 0.2, current: 0.004 }),
    ]
    for (const t of states) {
      updateComponentVisual(built, LED, CATALOG.led, t)
      expectSameBox(boxOf(o), boxWithout(o, added))
    }
    disposeComponentObject(o)
  })

  it('fxBoundsOf: the top of the dome / the body, not the pick proxy or the haze', () => {
    const led = buildLed()
    fresh(led.object)
    const { s } = headless('LED1', led.object)
    const box = new THREE.Box3()
    for (const t of [null, tel({ light: 3, ledBrightness: 1, current: 0.06 }), tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } })]) {
      updateComponentVisual(led, LED, CATALOG.led, t)
      fresh(led.object)
      expect(s.fxBoundsOf('LED1', box)).toBe(true)
      expect(box.max.y).toBeCloseTo(bodyTopOf(led.object), 6)
      expect(boxOf(led.object).max.y - box.max.y).toBeGreaterThan(0.5) // the classic box is the pick proxy's
    }
    expect(s.fxBoundsOf('nope', box)).toBe(false)

    const res = buildRes()
    const r = headless('R1', res.object).s
    const cool = boxOf(res.object).max.y
    updateComponentVisual(res, RES, CATALOG.resistor, tel({ heat: 3.9, damage: { kind: 'overheating', since: 1 } }))
    fresh(res.object)
    expect(r.fxBoundsOf('R1', box)).toBe(true)
    expect(box.max.y).toBeCloseTo(bodyTopOf(res.object), 6) // the browned shell, not the glow or haze
    expect(box.max.y - cool).toBeLessThan(0.06)
    disposeComponentObject(led.object)
    disposeComponentObject(res.object)
  })

  it('a burn flashes, sparks and smokes from the top of the part (scene order: FX before the visuals)', () => {
    const spawns: SpawnSpec[] = []
    const orig = ParticleSystem.prototype.spawn
    vi.spyOn(ParticleSystem.prototype, 'spawn').mockImplementation(function (this: ParticleSystem, sp: SpawnSpec) {
      spawns.push({ ...sp })
      return orig.call(this, sp)
    })
    const led = buildLed()
    const res = buildRes()
    const scene = new BreadboardScene()
    const s = scene as unknown as Internals
    s.components.set('LED1', { built: { object: led.object } })
    s.components.set('R1', { built: { object: res.object } })
    const host: SceneFxHost = { bounds: (id, out) => s.fxBoundsOf(id, out), pinWorld: () => null, ids: () => ['LED1', 'R1'] }
    const fx = new SceneFx(host, false)
    // over-driven LED, red-hot resistor: the frame before they burn
    updateComponentVisual(led, LED, CATALOG.led, tel({ light: 3, ledBrightness: 1, current: 0.06 }))
    updateComponentVisual(res, RES, CATALOG.resistor, tel({ heat: 3.9, damage: { kind: 'overheating', since: 1 } }))
    fresh(led.object)
    fresh(res.object)
    const ledTop = bodyTopOf(led.object)
    const resTop = bodyTopOf(res.object)
    fx.setTelemetry(snap(2, { LED1: tel({ burned: true, damage: { kind: 'burned', since: 1.999 } }) }))
    expect(spawns.length).toBeGreaterThan(5)
    // the flash, sparks and puff start at the dome (+0.05), never in the air above it
    for (const sp of spawns) expect(sp.y).toBeLessThan(ledTop + 0.8)
    expect(spawns[0].y).toBeCloseTo(ledTop + 0.05, 6)
    spawns.length = 0
    fx.setTelemetry(snap(3, { R1: tel({ damage: { kind: 'burned', since: 2.999 } }) }))
    expect(spawns.length).toBeGreaterThan(5)
    expect(spawns[0].y).toBeCloseTo(resTop + 0.05, 6)
    fx.dispose()
    disposeComponentObject(led.object)
    disposeComponentObject(res.object)
  })
})

// ---------------------------------------------------------------------------
// THREE-7: never in the SAO normal/depth pre-pass
// ---------------------------------------------------------------------------

/** run a sprite's draw hooks as three's renderObject does; true = it would draw */
function draws(s: THREE.Sprite, scene: THREE.Scene): boolean {
  const renderer = {} as THREE.WebGLRenderer
  const cam = new THREE.PerspectiveCamera()
  const geo = s.geometry
  s.onBeforeRender(renderer, scene, cam, geo, s.material, null as unknown as THREE.Group)
  const drawn = geo.drawRange.count !== -1
  s.onAfterRender(renderer, scene, cam, geo, s.material, null as unknown as THREE.Group)
  expect(geo.drawRange.count).toBe(Infinity) // always restored
  return drawn
}

describe('THREE-7: haze, soot and pin-damage markers stay out of override-material passes', () => {
  it('skipped in the pre-pass (scene.overrideMaterial), drawn in the beauty pass', () => {
    const prepass = new THREE.Scene()
    prepass.overrideMaterial = new THREE.MeshNormalMaterial()
    const beauty = new THREE.Scene()

    const r = buildRes()
    updateComponentVisual(r, RES, CATALOG.resistor, tel({ heat: 3.9 }))
    const led = buildLed()
    updateComponentVisual(led, LED, CATALOG.led, tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }))
    const fx = new SceneFx(
      {
        bounds: (_id, out) => {
          out.set(v(0, 0, 0), v(1, 1, 1))
          return true
        },
        pinWorld: (_id, pin) => (pin === 'PA0' ? v(5, 0, 5) : null),
        ids: () => ['U1'],
      },
      false,
    )
    fx.setTelemetry(
      snap(1, { U1: tel({}) }, [{ level: 'warning', message: 'U1 PA0: 5.20 V exceeds VDD + 0.3 V (3.60 V) — PA0 is not 5 V tolerant' }]),
    )
    const marker = fx.group.children.find((c) => c.name.startsWith('fx-pin-damage')) as THREE.Sprite
    expect(marker).toBeDefined()

    for (const s of [named(r.object, 'res-haze') as THREE.Sprite, sootOf(led.object), marker]) {
      expect(s.visible).toBe(true)
      expect(draws(s, prepass)).toBe(false)
      expect(draws(s, beauty)).toBe(true)
    }
    fx.dispose()
    disposeComponentObject(r.object)
    disposeComponentObject(led.object)
  })
})
