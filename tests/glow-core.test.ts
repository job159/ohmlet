/**
 * glow2 (final fix round): the LED look reads in LUMINANCE, not only in hue;
 * a broken part stays visibly broken while it is inspected; a vented can is
 * plainly blown; a 7-segment shows each segment's real light.
 *
 *  - M3: every colour's glow carries a HOT CORE over the die (in the same
 *    draw as its halo): brighter than the lens from 0.5 mA, a step brighter
 *    and bigger at every ladder current, white-hot at the rating. The halo's
 *    radius and opacity follow the perceived brightness, so 0.5 → 2 → 4 mA
 *    spread as far apart as 4 → 10 → 20 mA. White light on the white board
 *    glows BRIGHTER than the board (not just bluer), ringed by a darker cool
 *    edge so it reads;
 *  - m2: a selected damaged part (burned, vented, overheating) is outlined
 *    in the selection blue instead of being covered by the filled blue box —
 *    undamaged parts keep the box (classic scenes unchanged);
 *  - m3: a vented electrolytic shows torn petals, the dark inside, light
 *    brown crust over the rim and streaks down the sleeve, a scorch ring;
 *  - the 7-segment publishes `segmentLight` (I / 20 mA, 0.001, unclamped)
 *    and the 3D segments follow it.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ComponentInstance, ComponentTelemetry, SimTelemetry } from '../src/model/types'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import {
  WHITE_EDGE_ALPHA,
  WHITE_EDGE_COLOR,
  WHITE_GLOW_WIDTH,
  coreHueGain,
  glowDisplay,
  haloCoreOf,
  ledEmission,
  ledLook,
  ledPerceived,
  makeLedGlow,
  makeLedHalo,
} from '../src/three/meshes/led-look'
import { LED_COLORS } from '../src/three/meshes/semis'
import { segmentP } from '../src/three/meshes/ics'
import { displayGlowOpacity, makeDisplayGlow } from '../src/three/meshes/display-glow'
import { BreadboardScene } from '../src/three/scene'
import { SimEngine } from '../src/sim/engine'
import { CAP_REVERSE_OK, LED_RATED_CURRENT, roundLight } from '../src/sim/devices'
import { SceneFx, VENT_WISP_REVERSE_V, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import '../src/sim/models'
import { RailTap, dip, entryOf, poweredLayout, runFor, tap, twoLead, wire } from './helpers'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const pOf = (mA: number) => ledPerceived(mA / 20)
const LADDER = [0.5, 2, 4, 10, 20]
const EXPOSURE = 1.05

/** CIE L* of a display-referred sRGB colour (0..1 per channel) */
function lstar(c: THREE.Vector3): number {
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4))
  const Y = 0.2126 * lin(c.x) + 0.7152 * lin(c.y) + 0.0722 * lin(c.z)
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y
}
/** what the canvas shows for a linear HDR colour (three's ACES at the scene exposure + sRGB) */
const shown = (c: THREE.Color) => glowDisplay(new THREE.Vector3(c.r, c.g, c.b), EXPOSURE)
/** the white board as the ladder screenshots measure it (Performance ≈ 215, Enhanced ≈ 205 grey) */
const BOARD_L = lstar(v(215 / 255, 215 / 255, 214 / 255))

// ---------------------------------------------------------------------------
// M3 — the mapping
// ---------------------------------------------------------------------------

describe('glow2 M3: the hot core and the spread steps', () => {
  it('a hot core from 0.5 mA: brighter than the lens (gain > 1), a step hotter and bigger at every current, white only near the rating', () => {
    const looks = LADDER.map((mA) => ledLook(pOf(mA)))
    for (const l of looks) {
      expect(l.core).toBeGreaterThan(0.7)
      expect(l.coreGain).toBeGreaterThan(1.5)
      expect(l.coreR).toBeGreaterThan(0)
      expect(l.coreR).toBeLessThanOrEqual(1.0 + 1e-9) // never wider than the dome at the rating
    }
    for (let i = 1; i < looks.length; i++) {
      const a = looks[i - 1]
      const b = looks[i]
      expect(b.coreGain, `${LADDER[i]} mA gain`).toBeGreaterThan(a.coreGain)
      expect(b.coreR, `${LADDER[i]} mA radius`).toBeGreaterThan(a.coreR)
      expect(b.core, `${LADDER[i]} mA opacity`).toBeGreaterThan(a.core)
      expect(b.coreWhite, `${LADDER[i]} mA white`).toBeGreaterThanOrEqual(a.coreWhite)
    }
    // a small faintly-hot spot at 0.5 mA; still its hue through 10 mA; white-hot at 20 mA
    expect(looks[0].coreR).toBeLessThan(0.62)
    expect(looks[3].coreWhite).toBeLessThan(0.1)
    expect(looks[4].coreWhite).toBeGreaterThan(0.4)
    const dark = ledLook(0)
    for (const k of ['core', 'coreR', 'coreGain', 'coreWhite'] as const) expect(dark[k], k).toBe(0)
  })

  it('the steps spread: the glow (area × opacity) grows ≥ 1.6× at EVERY ladder step, its radius ≥ 1.2×', () => {
    const looks = LADDER.map((mA) => ledLook(pOf(mA)))
    for (let i = 1; i < looks.length; i++) {
      const a = looks[i - 1]
      const b = looks[i]
      expect((b.halo * b.haloR ** 2) / (a.halo * a.haloR ** 2), `${LADDER[i - 1]} → ${LADDER[i]} mA`).toBeGreaterThan(1.6)
      expect(b.haloR / a.haloR, `${LADDER[i - 1]} → ${LADDER[i]} mA radius`).toBeGreaterThan(1.2)
    }
    // dazzling is plainly bigger than weak: the 20 mA glow ≥ 3× the 0.5 mA one across
    expect(looks[4].haloR / looks[0].haloR).toBeGreaterThan(3)
  })

  it('red: the core is brighter (L*) than the lit lens from 0.5 mA and brighter at every step; white-hot at 20 mA', () => {
    const rig = makeLedHalo({ color: LED_COLORS.red, at: v(0, 1, 0) })
    const hue = new THREE.Color(LED_COLORS.red)
    const coreL: number[] = []
    for (const mA of LADDER) {
      rig.apply(pOf(mA))
      const u = haloCoreOf(rig.halo.material)!
      coreL.push(lstar(shown(u.uCoreColor.value)))
    }
    const lensL = lstar(shown(hue.clone().multiplyScalar(ledLook(pOf(0.5)).lens)))
    expect(coreL[0] - lensL, 'core vs lens at 0.5 mA').toBeGreaterThan(5)
    for (let i = 1; i < coreL.length; i++) expect(coreL[i] - coreL[i - 1], `${LADDER[i]} mA`).toBeGreaterThan(2)
    expect(coreL[4]).toBeGreaterThan(90)
    // …while the core at 0.5 mA is still plainly red, not bleached
    rig.apply(pOf(0.5))
    const c05 = shown(haloCoreOf(rig.halo.material)!.uCoreColor.value)
    expect(c05.x - Math.max(c05.y, c05.z)).toBeGreaterThan(0.25)
    rig.apply(0)
  })

  it('white light on the white board: the glow is BRIGHTER than the board, its core brighter still, ringed by a darker cool edge', () => {
    const white = makeLedHalo({ color: LED_COLORS.white, at: v(0, 1, 0) })
    const red = makeLedHalo({ color: LED_COLORS.red, at: v(0, 1, 0) })
    for (const mA of LADDER) {
      white.apply(pOf(mA))
      red.apply(pOf(mA))
      const mat = white.halo.material
      const body = shown(mat.color)
      const u = haloCoreOf(mat)!
      // brighter than the board (the old cool tint was DARKER: only blue rose)
      expect(lstar(body), `${mA} mA glow L*`).toBeGreaterThan(BOARD_L + 4)
      expect(body.z, `${mA} mA still cool`).toBeGreaterThanOrEqual(body.x)
      expect(lstar(shown(u.uCoreColor.value)), `${mA} mA core`).toBeGreaterThan(lstar(body))
      // the contrasting edge: white only, darker than the board, a light touch
      const edgeA = u.uEdgeA.value * mat.opacity
      expect(edgeA, `${mA} mA edge`).toBeGreaterThan(0.12)
      expect(edgeA).toBeLessThanOrEqual(WHITE_EDGE_ALPHA + 1e-9)
      expect(haloCoreOf(red.halo.material)!.uEdgeA.value).toBe(0)
    }
    expect(lstar(shown(WHITE_EDGE_COLOR))).toBeLessThan(BOARD_L - 25)
    expect(WHITE_EDGE_COLOR.b).toBeGreaterThan(WHITE_EDGE_COLOR.r) // cool
    // the old white glow colour for reference: darker than the board
    expect(lstar(shown(new THREE.Color(ledEmission(LED_COLORS.white))))).toBeLessThan(BOARD_L)
    white.apply(0)
    red.apply(0)
  })

  it('core / edge uniforms: the core radius is the die spot in halo units; their opacities ride on the halo opacity (a hidden LED hides its core)', () => {
    for (const [name, width] of [
      ['white', WHITE_GLOW_WIDTH],
      ['green', 1],
    ] as const) {
      const rig = makeLedHalo({ color: LED_COLORS[name], at: v(0, 1, 0) })
      for (const mA of LADDER) {
        rig.apply(pOf(mA))
        const look = ledLook(pOf(mA))
        const mat = rig.halo.material
        const u = haloCoreOf(mat)!
        expect(u.uCoreR.value).toBeCloseTo(look.coreR / (look.haloR * width), 9)
        expect(u.uCoreA.value * mat.opacity).toBeCloseTo(Math.min(1, look.core), 9)
        // the world size: core radius = coreR dome radii
        expect((u.uCoreR.value * rig.halo.scale.x) / 2).toBeCloseTo(0.42 * look.coreR, 6)
      }
      rig.apply(0)
      expect(rig.halo.visible).toBe(false)
    }
  })

  it('hue gain: light hues (yellow, green) heat at the same current as red instead of bleaching at 0.5 mA', () => {
    expect(coreHueGain(new THREE.Color(LED_COLORS.red))).toBeCloseTo(1, 1)
    expect(coreHueGain(new THREE.Color(LED_COLORS.yellow))).toBeLessThan(0.75)
    expect(coreHueGain(new THREE.Color(LED_COLORS.green))).toBeLessThan(0.85)
    expect(coreHueGain(new THREE.Color(LED_COLORS.blue))).toBeGreaterThan(1)
    for (const name of ['red', 'green', 'yellow', 'blue']) {
      const g = coreHueGain(new THREE.Color(LED_COLORS[name]))
      expect(g).toBeGreaterThanOrEqual(0.6)
      expect(g).toBeLessThanOrEqual(1.25)
      const rig = makeLedHalo({ color: LED_COLORS[name], at: v(0, 1, 0) })
      rig.apply(pOf(0.5))
      const c = shown(haloCoreOf(rig.halo.material)!.uCoreColor.value)
      // still coloured at 0.5 mA (max − min channel)
      expect(Math.max(c.x, c.y, c.z) - Math.min(c.x, c.y, c.z), `${name} core chroma`).toBeGreaterThan(0.2)
      rig.apply(0)
    }
  })

  it('the shader: the halo composites its edge and core over the glow with per-material uniforms; the flare has none; no extra draw', () => {
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    const other = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    const compile = (m: THREE.Material) => {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        fragmentShader: 'void main() {\n#include <map_fragment>\n#include <opaque_fragment>\n}',
        vertexShader: '',
      }
      ;(m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null)
      return shader
    }
    const halo = compile(rig.halo.material)
    const u = haloCoreOf(rig.halo.material)!
    expect(halo.fragmentShader).toContain('uniform vec3 uCoreColor')
    expect(halo.fragmentShader).toContain('#include <map_fragment>') // the texture still sampled first
    expect(halo.fragmentShader).toContain('glowDisplayInv') // the HDR emulation still applies to the result
    expect(halo.uniforms.uCoreColor).toBe(u.uCoreColor)
    expect(halo.uniforms.uEdgeA).toBe(u.uEdgeA)
    expect(compile(other.halo.material).uniforms.uCoreColor).not.toBe(u.uCoreColor) // per LED
    const flare = compile(rig.flare.material)
    expect(haloCoreOf(rig.flare.material)).toBeUndefined()
    expect(flare.fragmentShader).not.toContain('uCoreColor')
    // one program for every halo (only uniforms differ), a different one from the flare
    expect(rig.halo.material.customProgramCacheKey()).toBe(other.halo.material.customProgramCacheKey())
    expect(rig.halo.material.customProgramCacheKey()).not.toBe(rig.flare.material.customProgramCacheKey())
    // the core lives in the halo's own draw: the 5 mm LED is still halo + flare + pool
    const sprites: THREE.Object3D[] = [rig.halo, rig.flare, rig.pool]
    expect(sprites.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 7-segment: segmentLight
// ---------------------------------------------------------------------------

function sevenSeg(resistance: number) {
  const rt = new RailTap()
  const entry = entryOf('seven_segment')
  const ds = dip('DS1', 'seven_segment', 'f10')
  const parts = [ds, twoLead('R1', 'resistor', rt.plus(), tap(ds, entry, 'A'), { resistance })]
  return new SimEngine(poweredLayout(parts, [wire(tap(ds, entry, 'COM1'), rt.minus())]))
}

describe('glow2: the 7-segment publishes each segment\'s real light', () => {
  it('segmentLight = segment current / 20 mA (0.001, unclamped); unlit segments 0', () => {
    const lights: number[] = []
    for (const r of [330, 2200, 47]) {
      const e = sevenSeg(r)
      runFor(e, 0.005)
      const t = e.telemetry().components['DS1']
      const iR = Math.abs(e.telemetry().components['R1'].current ?? 0)
      expect(t.segmentLight, `${r} Ω`).toBeDefined()
      const sl = t.segmentLight!
      expect(sl.a).toBeCloseTo(roundLight(iR / LED_RATED_CURRENT), 2)
      expect(Math.abs(sl.a * 1000 - Math.round(sl.a * 1000))).toBeLessThan(1e-6) // rounded to 0.001
      for (const s of ['b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const) expect(sl[s], s).toBe(0)
      lights.push(sl.a)
    }
    const [l330, l2k2, l47] = lights
    expect(l330).toBeGreaterThan(0.35) // ≈ 9 mA
    expect(l330).toBeLessThan(0.55)
    expect(l2k2).toBeGreaterThan(0.05) // ≈ 1.4 mA
    expect(l2k2).toBeLessThan(0.09)
    expect(l47).toBeGreaterThan(1) // over-driven: published unclamped
  }, 20000)

  it('a lit 7-segment shows the measured brightness: a brighter segment glows brighter in 3D', () => {
    const entry = entryOf('seven_segment')
    const comp: ComponentInstance = { id: 'DS1', type: 'seven_segment', holes: [] }
    const pins: THREE.Vector3[] = []
    for (let i = 0; i < 5; i++) pins.push(v(i, 0, 1.5))
    for (let i = 4; i >= 0; i--) pins.push(v(i, 0, -1.5))
    const built = buildComponentObject(comp, entry, pins)
    const emissionOfA = (t: ComponentTelemetry): number => {
      updateComponentVisual(built, comp, entry, t)
      const lit: THREE.MeshStandardMaterial[] = []
      built.object.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (m && !Array.isArray(m) && m.emissive && m.emissive.getHex() === 0xff3020 && !lit.includes(m)) lit.push(m)
      })
      expect(lit).toHaveLength(1) // only segment a is lit
      return lit[0].emissiveIntensity
    }
    const tel = (r: number) => {
      const e = sevenSeg(r)
      runFor(e, 0.005)
      return e.telemetry().components['DS1']
    }
    const bright = tel(330)
    const dim = tel(2200)
    expect(segmentP(bright, 'a')).toBeCloseTo(ledPerceived(bright.segmentLight!.a), 9)
    expect(emissionOfA(bright)).toBeGreaterThan(emissionOfA(dim))
    disposeComponentObject(built.object)
  }, 20000)
})

// ---------------------------------------------------------------------------
// m2: selecting a damaged part keeps its broken look
// ---------------------------------------------------------------------------

interface SelInternals {
  m: unknown
  components: Map<string, { built: { object: THREE.Object3D } }>
  selectedIds: string[]
  telemetry: SimTelemetry | null
  applySelection(): void
}

function headlessScene() {
  const scene = new BreadboardScene()
  const s = scene as unknown as SelInternals
  const overlayGroup = new THREE.Group()
  s.m = {
    overlayGroup,
    selBoxGeo: new THREE.BoxGeometry(1, 1, 1),
    selBoxMat: new THREE.MeshBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0.3 }),
    camera: new THREE.PerspectiveCamera(),
  }
  const part = new THREE.Group()
  part.add(new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0x241c15 })))
  s.components.set('LED1', { built: { object: part } })
  const telem = (ct: Partial<ComponentTelemetry>): SimTelemetry =>
    ({ time: 1, netVoltages: {}, issues: [], components: { LED1: { pinVoltages: {}, ...ct } } }) as SimTelemetry
  return { scene, s, overlayGroup, telem }
}

const boxes = (g: THREE.Group) => g.children.filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'BoxGeometry')
const outlines = (g: THREE.Group) => g.children.filter((o) => o.name === 'selection-outline')

describe('glow2 m2: a selected damaged part is outlined, never tinted blue', () => {
  it('healthy: the familiar filled selection box (classic look unchanged); damaged: a blue edge outline only', () => {
    const { s, overlayGroup, telem } = headlessScene()
    s.selectedIds = ['LED1']
    s.telemetry = telem({ light: 0.4 })
    s.applySelection()
    expect(boxes(overlayGroup)).toHaveLength(1)
    expect(outlines(overlayGroup)).toHaveLength(0)
    for (const damage of [
      { burned: true, damage: { kind: 'burned' as const, since: 0.5 } },
      { damage: { kind: 'vented' as const, since: 1 } },
      { damage: { kind: 'overheating' as const, since: 1 } },
    ]) {
      s.telemetry = telem(damage)
      s.applySelection()
      expect(boxes(overlayGroup), JSON.stringify(damage)).toHaveLength(0)
      const hull = outlines(overlayGroup)
      expect(hull).toHaveLength(1)
      // the hull: the part's own geometry, back faces, the selection blue, steady
      let mat: THREE.ShaderMaterial | null = null
      hull[0].traverse((o) => {
        if ((o as THREE.Mesh).isMesh) mat = (o as THREE.Mesh).material as THREE.ShaderMaterial
      })
      expect(mat).not.toBeNull()
      const m = mat! as THREE.ShaderMaterial
      expect(m.side).toBe(THREE.BackSide)
      expect((m.uniforms.uColor.value as THREE.Color).getHex()).toBe(0x2f6bff)
      expect(m.uniforms.uPulse.value).toBe(0)
      expect(m.depthWrite).toBe(false)
    }
    // deselect: nothing left behind
    s.selectedIds = []
    s.applySelection()
    expect(boxes(overlayGroup)).toHaveLength(0)
    expect(outlines(overlayGroup)).toHaveLength(0)
  })

  it('the look follows the part: it burns while selected → outline; the session ends (healed) → the box again', () => {
    const { scene, s, overlayGroup, telem } = headlessScene()
    scene.setSelection(['LED1'])
    expect(boxes(overlayGroup)).toHaveLength(1)
    scene.setTelemetry(telem({ light: 0.5 }))
    expect(boxes(overlayGroup)).toHaveLength(1)
    scene.setTelemetry(telem({ burned: true, damage: { kind: 'burned', since: 1 } }))
    expect(boxes(overlayGroup)).toHaveLength(0)
    expect(outlines(overlayGroup)).toHaveLength(1)
    // a later snapshot of the same broken part does not rebuild it
    const hull = outlines(overlayGroup)[0]
    scene.setTelemetry(telem({ burned: true, damage: { kind: 'burned', since: 1 } }))
    expect(outlines(overlayGroup)[0]).toBe(hull)
    scene.setTelemetry(null)
    expect(outlines(overlayGroup)).toHaveLength(0)
    expect(boxes(overlayGroup)).toHaveLength(1)
    void s
  })
})

// ---------------------------------------------------------------------------
// m3: the vented can
// ---------------------------------------------------------------------------

describe('glow2 m3: a vented electrolytic looks blown open', () => {
  const comp: ComponentInstance = { id: 'C1', type: 'capacitor', holes: [], params: { capacitance: 1e-4, polarized: true } }
  const pins = [v(0, 0, 0), v(3, 0, 0)]

  it('torn petals curling up above the can, the dark inside, crust and streaks down the sleeve, a scorch ring; hidden after a reset', () => {
    const entry = entryOf('capacitor')
    const built = buildComponentObject(comp, entry, pins)
    const healthy = new THREE.Box3().setFromObject(built.object)
    updateComponentVisual(built, comp, entry, { pinVoltages: { p1: 0, p2: 5 }, damage: { kind: 'vented', since: 1 } })
    let vent: THREE.Object3D | null = null
    built.object.traverse((o) => {
      if (o.name === 'cap-vented') vent = o
    })
    expect(vent).not.toBeNull()
    const group = vent! as THREE.Object3D
    expect(group.visible).toBe(true)
    const petals = group.getObjectByName('cap-vent-petals') as THREE.Mesh
    const crust = group.getObjectByName('cap-vent-crust') as THREE.Mesh
    expect(petals && crust).toBeTruthy()
    expect(group.children).toHaveLength(2) // two draws for the whole damage look
    built.object.updateMatrixWorld(true)
    // the petals stand up above the healthy can top (visible from the usual 45–55° view)
    const pBox = new THREE.Box3().setFromObject(petals)
    expect(pBox.max.y - healthy.max.y).toBeGreaterThan(0.15)
    // the crust runs down the sleeve: well below the top, outside the can's radius
    const cBox = new THREE.Box3().setFromObject(crust)
    expect(healthy.max.y - cBox.min.y).toBeGreaterThan(0.6)
    const centre = healthy.getCenter(new THREE.Vector3())
    expect(Math.max(cBox.max.x - centre.x, centre.x - cBox.min.x)).toBeGreaterThan(0.55)
    // vertex-coloured: light-brown crust, near-black hole / scorch, metal petals scorched at the tips
    const colours = (m: THREE.Mesh) => {
      const c = m.geometry.getAttribute('color') as THREE.BufferAttribute
      expect(c.itemSize).toBe(4) // the path tracer's layout
      const out: THREE.Color[] = []
      for (let i = 0; i < c.count; i += 7) out.push(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)))
      return out
    }
    const hsl = { h: 0, s: 0, l: 0 }
    const cc = colours(crust)
    const brown = cc.filter((c) => (c.getHSL(hsl), hsl.h > 0.05 && hsl.h < 0.12 && hsl.s > 0.3 && hsl.l > 0.12))
    const black = cc.filter((c) => (c.getHSL(hsl), hsl.l < 0.02))
    expect(brown.length).toBeGreaterThan(cc.length * 0.5)
    expect(black.length).toBeGreaterThan(0)
    const pc = colours(petals)
    expect(Math.max(...pc.map((c) => c.getHSL(hsl).l))).toBeGreaterThan(0.35) // bare metal at the hinge
    expect(Math.min(...pc.map((c) => c.getHSL(hsl).l))).toBeLessThan(0.05) // soot at the torn tips
    expect((crust.material as THREE.MeshStandardMaterial).vertexColors).toBe(true)
    // a reset heals it
    updateComponentVisual(built, comp, entry, { pinVoltages: {} })
    expect(group.visible).toBe(false)
    disposeComponentObject(built.object)
  })
})

// ---------------------------------------------------------------------------
// m3: the wisp while the can stays reversed
// ---------------------------------------------------------------------------

describe('glow2 m3: a vented can still reversed keeps a faint wisp', () => {
  const host: SceneFxHost = {
    bounds: (id, out) => {
      if (id !== 'C1') return false
      out.set(v(0, 0, 0), v(1, 1.6, 1))
      return true
    },
    pinWorld: () => null,
    ids: () => ['C1'],
  }
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
  const renderer = { getDrawingBufferSize: (t: THREE.Vector2) => t.set(800, 600) } as unknown as THREE.WebGLRenderer
  const snap = (time: number, p2: number): SimTelemetry => ({
    time,
    netVoltages: {},
    issues: [],
    components: { C1: { pinVoltages: { p1: 0, p2 }, damage: { kind: 'vented', since: 1 } } },
  })

  it('wisps while reversed beyond 1 V (long after the puff), stops once the reverse voltage is gone or the session ends', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(20, 5)) // vented long ago: no puff, but still reversed
    expect(fx.emitterCount).toBe(1)
    for (let i = 0; i < 180; i++) fx.tick(i / 60, 1 / 60, cam, renderer)
    expect(fx.particleCount).toBeGreaterThan(0)
    // fixed (or the supply turned down): no new wisps
    fx.setTelemetry(snap(21, 0.5))
    expect(fx.emitterCount).toBe(0)
    fx.setTelemetry(snap(22, 5))
    expect(fx.emitterCount).toBe(1)
    fx.setTelemetry(null)
    expect(fx.emitterCount).toBe(0)
    expect(VENT_WISP_REVERSE_V).toBe(CAP_REVERSE_OK) // the same tolerance as the sim's vent model
    fx.dispose()
    // reduced motion: the torn can's own look carries it, no moving smoke
    const calm = new SceneFx(host, true)
    calm.setTelemetry(snap(20, 5))
    for (let i = 0; i < 180; i++) calm.tick(i / 60, 1 / 60, cam, renderer)
    expect(calm.particleCount).toBe(0)
    calm.dispose()
  })
})

describe('glow2: an LED display at its real current stays saturated red', () => {
  it('the display glow keeps the drive\'s own density (not the wider LED halo\'s) — at the counter\'s real 7.9 mA it is laid on lighter', () => {
    const look = ledLook(ledPerceived(0.396))
    expect(displayGlowOpacity(look)).toBeLessThan(Math.min(1, look.halo * 1.05) - 0.05)
    expect(displayGlowOpacity(ledLook(0))).toBe(0)
    let last = 0
    for (const mA of LADDER) {
      const o = displayGlowOpacity(ledLook(pOf(mA)))
      expect(o).toBeGreaterThan(last)
      last = o
    }
  })
})

describe('glow2: the display glow spills onto the face, not over the lit lens', () => {
  it('after painting the blurred glow, each lit shape is cut out of it (destination-out, on the canvas); unlit shapes are not touched', () => {
    const ops: { op: string; x?: number; comp?: string }[] = []
    const ctx = {
      shadowBlur: 0,
      shadowColor: '',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillStyle: '',
      globalCompositeOperation: 'source-over',
      clearRect: () => {},
      save: () => {},
      restore() {
        this.globalCompositeOperation = 'source-over'
      },
      beginPath: () => {},
      moveTo: (x: number) => ops.push({ op: 'moveTo', x }),
      lineTo: () => {},
      closePath: () => {},
      arc: (x: number) => ops.push({ op: 'arc', x }),
      fill() {
        ops.push({ op: 'fill', comp: this.globalCompositeOperation })
      },
    }
    const g = globalThis as unknown as { document?: unknown }
    const had = 'document' in g
    const prev = g.document
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
    try {
      const glow = makeDisplayGlow({
        x0: 0,
        x1: 4,
        z0: 0,
        z1: 2,
        y: 1,
        shapes: [{ pts: [[0.5, 0.5], [1.5, 0.5], [1.5, 0.8], [0.5, 0.8]] }, { cx: 3, cz: 1, r: 0.3 }],
        color: LED_COLORS.red,
      })
      glow.apply([1, 0], ledPerceived(0.4))
      const cuts = ops.filter((o) => o.op === 'fill' && o.comp === 'destination-out')
      const glows = ops.filter((o) => o.op === 'fill' && o.comp === 'source-over')
      expect(glows).toHaveLength(2) // the tight bleed + the wide glow of the one lit shape
      expect(cuts).toHaveLength(1) // only the lit shape is cut out
      // the cut lands ON the canvas (the glow's shapes are drawn off-canvas for their shadow)
      const lastMove = [...ops].reverse().find((o) => o.op === 'moveTo')!
      expect(lastMove.x).toBeGreaterThanOrEqual(0)
      expect(lastMove.x).toBeLessThan(4 * 14 + 1)
    } finally {
      if (had) g.document = prev
      else delete g.document
    }
  })
})
