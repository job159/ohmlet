/**
 * Basic-parts family meshes (src/model/parts/basic.parts.ts): 5 mm RGB LED,
 * TO-220 (LM7805 / IRLZ44N), TO-92 P-FET, BZX55 zener, AMS1117 vertical
 * module, SRD relay, HC-49/S crystal, sub-miniature toggle, MF52 NTC bead,
 * BSS138 level-shifter breakout, 9 V battery, 2×AA holder and the lab
 * current source. Registered through registerMeshBuilder (meshes/registry).
 *
 * Same standards as the built-in meshes (tests/meshes.test.ts): ≤ 4000
 * triangles, static parts merged per material, shared geometries/materials
 * cached (never disposed with an instance), per-instance materials only for
 * state (RGB epoxy + dies, screens, lamps, lever pose), NO transmission (that
 * budget belongs to the single-color LED — the RGB epoxy is alpha-blended
 * like the DO-35 glass), never a light (glow = additive sprite).
 *
 * Proportions: the leaded packages and modules are modeled at true size in
 * millimetres (MM = 1/2.54 plan units); the off-board batteries and the
 * current source are scaled into the shared 6.5 × 4.5 instrument footprint
 * (offboardBodyRect) like the bench PSU.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance, ComponentTelemetry } from '../../../model/types'
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import type { RoutedComponent } from '../../internal/wire-router'
import { TERMINAL_TOP_Y } from '../../internal/wires'
import { registerMeshBuilder } from '../registry'
import { ledLook, ledPerceived, makeLedHalo, P_DARK, setHaloColor, type LedHaloRig } from '../led-look'
import {
  BuildResult,
  HOLE_DEPTH,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  fakeLotCode,
  frameBetween,
  fromHole,
  labelMaterial,
  legMesh,
  makeWireMaterial,
  markShared,
  mergeStatic,
  metal,
  moldedEpoxy,
  noiseNormalTexture,
  plastic,
  roundedPath,
  shortLabel,
} from '../shared'
import { buildTo92 } from '../semis'
import { buildDiode } from '../passives'
import {
  MM,
  chip0603,
  fr4EdgeMaterial,
  flatQuadGeometry,
  headerPlasticMaterial,
  maskMaterial,
  pcbArtMaterial,
  pinTipGeometry,
  slabGeometry,
  solderFilletGeometry,
  solderMaterial,
  stadiumShape,
} from '../pcb'
import type { PcbPainter } from '../pcb'

type V3 = THREE.Vector3
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const isGhost = (comp: ComponentInstance) => comp.id === '__ghost__'

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/**
 * Lead path from inside a hole to `entry` (inside a body): straight up when
 * the hole is under the entry point, otherwise up to `runY`, across, and up
 * into the body.
 */
function leadPath(pin: V3, entry: V3, runY: number): V3[] {
  if (Math.hypot(entry.x - pin.x, entry.z - pin.z) < 0.03) return fromHole(pin, V(pin.x, entry.y, pin.z))
  return fromHole(pin, V(pin.x, runY, pin.z), V(entry.x, runY, entry.z), entry)
}

/**
 * A light bent lead (fewer tube segments than shared legMesh, no end caps:
 * both ends are buried — one in the hole, one inside the package). For
 * parts with many leads, where legMesh's 44-segment tubes would eat the
 * triangle budget.
 */
function lightLeg(points: V3[], radius: number, segments = 24, material: THREE.Material = metal()): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(roundedPath(points, 0.14), segments, radius, 6, false), material)
}

/** Local frame of a leaded part: centroid + yaw along pin 0 → last pin. */
function leadFrame(pins: V3[]): { c: V3; yaw: number; dir: V3; perp: V3 } {
  const c = centroidOf(pins)
  const f = frameBetween(pins[0] ?? V(0, 0, 0), pins[pins.length - 1] ?? V(1, 0, 0))
  return { c, yaw: f.angleY, dir: f.dir, perp: f.perp }
}

/** World point of a local (x, y, z) in a frame at `c` with yaw. */
function toWorld(c: V3, yaw: number, x: number, y: number, z: number): V3 {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // rotation.y = yaw maps local (x, z) → (x·cos + z·sin, −x·sin + z·cos)
  return V(c.x + x * cos + z * sin, y, c.z - x * sin + z * cos)
}

interface PrintLine {
  text: string
  /** baseline-centre height as a fraction of the canvas (0 top … 1 bottom) */
  y: number
  /** font size as a fraction of the canvas height */
  size: number
  color?: string
  weight?: number
  family?: string
}

/**
 * Cached multi-line print (pad-printed / silkscreened legend) as an unlit
 * transparent label material. Headless (no DOM) → null; builds never throw.
 */
function printMaterial(
  key: string,
  w: number,
  h: number,
  lines: PrintLine[],
  extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.MeshBasicMaterial | null {
  if (typeof document === 'undefined') return null
  return cachedMaterial(`basic-print:${key}`, () => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, w, h)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const l of lines) {
        ctx.fillStyle = l.color ?? '#f2f2f2'
        ctx.font = `${l.weight ?? 700} ${Math.round(l.size * h)}px ${l.family ?? '"Arial Narrow", Arial, "Helvetica Neue", sans-serif'}`
        ctx.fillText(l.text, w / 2, l.y * h)
      }
      extra?.(ctx, w, h)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    markShared(tex)
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  })
}

/** A plane mesh (XY plane, facing +z) of the given size with `mat`. */
function facePlane(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(
    cachedGeometry(`basic-face:${w.toFixed(3)}x${h.toFixed(3)}`, () => new THREE.PlaneGeometry(w, h)),
    mat,
  )
}

/** A plane mesh lying flat (XZ plane, facing +y). */
function topPlane(w: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(flatQuadGeometry(w, d), mat)
}

/** Clamp to 0..1 (NaN → 0). */
function unit(v: number | undefined): number {
  return v !== undefined && v > 0 ? Math.min(v, 1) : 0
}

// ---------------------------------------------------------------------------
// RGB LED — 5 mm diffused, 4 leads (R · COM · G · B)
// ---------------------------------------------------------------------------

/** Package proportions (plan units): Ø 4 mm-equivalent body, raised on its leads. */
const RGB_BASE_Y = 0.92
const RGB_R = 0.78
const RGB_FLANGE_R = 0.9
const RGB_FLANGE_H = 0.12
const RGB_CYL_H = 1.2
/** flat on the flange, local −X = the red (pin 1) side */
const RGB_FLAT_X = 0.72
/** mesh top (dome apex) — the catalog obstacleHeight must cover it */
export const RGB_LED_TOP = RGB_BASE_Y + RGB_FLANGE_H + RGB_CYL_H + RGB_R
/** lead pitch where the leads leave the package (≈ 1.27 mm) */
const RGB_EXIT_PITCH = 0.42
/**
 * Extra free length of each lead over the shortest (B), plan units: the
 * common lead is the longest, red next — pushed in to the same depth, the
 * longer leads bow out (that is how unequal leads sit in a breadboard).
 */
const RGB_LEAD_EXTRA = [0.16, 0.36, 0.08, 0]

/**
 * Emission hues of the three dies, LINEAR working-space RGB (≈ 625 / 525 /
 * 470 nm). Kept saturated on purpose: a linear 0.3 already displays as sRGB
 * ≈ 0.58, so "a little green in the blue" turned red + blue into pink.
 */
const RGB_DIE_HUES: [number, number, number][] = [
  [1.0, 0.012, 0.006],
  [0.02, 1.0, 0.025],
  [0.012, 0.07, 1.0],
]

function rgbFlangeGeometry(): THREE.BufferGeometry {
  return cachedGeometry('basic-rgb-flange', () => {
    const R = RGB_FLANGE_R
    const theta = Math.acos(RGB_FLAT_X / R)
    const shape = new THREE.Shape()
    shape.moveTo(RGB_FLAT_X, -Math.sin(theta) * R)
    shape.absarc(0, 0, R, -theta, theta - Math.PI * 2, true)
    shape.closePath()
    const g = new THREE.ExtrudeGeometry(shape, { depth: RGB_FLANGE_H, bevelEnabled: false, curveSegments: 22 })
    g.rotateX(-Math.PI / 2)
    g.rotateY(Math.PI) // flat → local −X (the red lead's side)
    return g
  })
}

/** Milky diffused epoxy: the internals only ghost through (real 5 mm diffused RGB LEDs). */
export const RGB_EPOXY_OPACITY = 0.965
const RGB_EPOXY_COLOR = 0xf1eee8

/** Ghost / unlit shared epoxy (the per-instance one carries the emission). */
function rgbEpoxySpec(): THREE.MeshPhysicalMaterialParameters {
  return {
    color: RGB_EPOXY_COLOR,
    roughness: 0.42,
    metalness: 0,
    // diffused (milky) epoxy: alpha-blended like the DO-35 glass — the
    // transmission budget is the single-color LED's alone. depthWrite stays
    // on so the board's hole-collar pass never stamps over the dome.
    transparent: true,
    opacity: RGB_EPOXY_OPACITY,
    depthWrite: true,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
  }
}

function buildRgbLed(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { c, yaw, perp } = leadFrame(pins)

  const glass = ghost
    ? cachedMaterial('basic-rgb-epoxy', () => new THREE.MeshPhysicalMaterial(rgbEpoxySpec()))
    : new THREE.MeshPhysicalMaterial({ ...rgbEpoxySpec(), emissive: 0x000000, emissiveIntensity: 0 })

  const body = new THREE.Group()
  body.position.set(c.x, 0, c.z)
  body.rotation.y = yaw

  // internals (opaque pass, softly visible through the milky epoxy): four
  // lead-frame posts, the common post widening into the reflector cup
  const frameMetal = cachedMaterial('basic-rgb-frame', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x9aa0a6, metalness: 1.0, roughness: 0.35 }),
  )
  const internals: THREE.Object3D[] = []
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * RGB_EXIT_PITCH
    const h = i === 1 ? 0.7 : 0.5
    const post = new THREE.Mesh(slabGeometry(0.12, h, 0.14), frameMetal)
    post.position.set(x, RGB_BASE_Y + h / 2 - 0.02, 0)
    internals.push(post)
  }
  const cup = new THREE.Mesh(
    cachedGeometry('basic-rgb-cup', () => new THREE.CylinderGeometry(0.3, 0.16, 0.16, 16, 1, true)),
    cachedMaterial('basic-rgb-cup-mat', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xc8ccd0, metalness: 1.0, roughness: 0.25, side: THREE.DoubleSide }),
    ),
  )
  cup.position.set(-RGB_EXIT_PITCH / 2, RGB_BASE_Y + 0.74, 0)
  internals.push(cup)
  for (const m of mergeStatic(internals)) body.add(m)

  // the three dies in the cup: per-instance emissive (they light per channel)
  const dieGeo = cachedGeometry('basic-rgb-die', () => new THREE.BoxGeometry(0.08, 0.05, 0.08))
  const dies: THREE.MeshStandardMaterial[] = []
  for (let ch = 0; ch < 3; ch++) {
    const [r, g, b] = RGB_DIE_HUES[ch]
    const mat = ghost
      ? cachedMaterial(`basic-rgb-die-${ch}`, () => new THREE.MeshStandardMaterial({ color: 0x5a564c, roughness: 0.4 }))
      : new THREE.MeshStandardMaterial({ color: 0x5a564c, roughness: 0.4, emissive: new THREE.Color(r, g, b), emissiveIntensity: 0 })
    dies.push(mat)
    const die = new THREE.Mesh(dieGeo, mat)
    die.position.set(-RGB_EXIT_PITCH / 2 + (ch - 1) * 0.11, RGB_BASE_Y + 0.72, ch === 1 ? 0.06 : -0.03)
    body.add(die)
  }

  // epoxy: flange (flat on the red side) + cylinder + dome, merged into one
  // blended mesh (one draw in the transparent pass)
  const flange = new THREE.Mesh(rgbFlangeGeometry(), glass)
  flange.position.y = RGB_BASE_Y
  const cyl = new THREE.Mesh(
    cachedGeometry('basic-rgb-cyl', () => new THREE.CylinderGeometry(RGB_R, RGB_R, RGB_CYL_H, 24, 1, true)),
    glass,
  )
  cyl.position.y = RGB_BASE_Y + RGB_FLANGE_H + RGB_CYL_H / 2 - 0.01
  const dome = new THREE.Mesh(
    cachedGeometry('basic-rgb-dome', () => new THREE.SphereGeometry(RGB_R, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
    glass,
  )
  dome.position.y = RGB_BASE_Y + RGB_FLANGE_H + RGB_CYL_H - 0.01
  for (const m of mergeStatic([flange, cyl, dome])) body.add(m)
  group.add(body)

  // leads: leave the package bottom on a 1.27 mm pitch, spread to the holes;
  // the longer leads bow out toward the viewer side (−perp) by their extra
  // length — the common lead most
  const legStatics: THREE.Object3D[] = []
  const bottomY = RGB_BASE_Y
  pins.slice(0, 4).forEach((pin, i) => {
    const entry = toWorld(c, yaw, (i - 1.5) * RGB_EXIT_PITCH, bottomY + 0.3, 0)
    const under = toWorld(c, yaw, (i - 1.5) * RGB_EXIT_PITCH, bottomY - 0.14, 0)
    const a = RGB_LEAD_EXTRA[i] ?? 0
    const midY = (bottomY - 0.14) * 0.5
    const bow = V(
      (pin.x + under.x) / 2 - perp.x * a,
      midY,
      (pin.z + under.z) / 2 - perp.z * a,
    )
    const pts = fromHole(pin, V(pin.x, 0.08, pin.z), bow, under, entry)
    legStatics.push(lightLeg(pts, 0.05))
  })
  for (const m of mergeStatic(legStatics)) group.add(m)

  // mixed-color glow halo: the shared LED glow (led-look.ts — one brightness
  // language with the 5 mm LED; a billboard, never a light)
  let glow: LedHaloRig | null = null
  if (!ghost) {
    // (the hue is the dies' mix, set per update; a saturated placeholder keeps
    // the white-light boost off — it belongs to a phosphor white LED)
    glow = makeLedHalo({ color: 0xff0000, at: new THREE.Vector3(c.x, RGB_LED_TOP - 0.35, c.z) })
    group.add(glow.halo)
  }

  const mixed = new THREE.Color()
  const tint = new THREE.Color()
  const state = { burned: false }
  const update: BuildResult['update'] = (_c2, _e2, t) => {
    if (ghost) return
    const lv = t?.leds
    // vivid: each die's REAL current / 20 mA, shown perceptually (led-look.ts);
    // a snapshot without the currents falls back to the 0..1 channel levels
    const v = t?.values
    const br =
      v && typeof v.iR === 'number' && typeof v.iG === 'number' && typeof v.iB === 'number'
        ? [v.iR, v.iG, v.iB].map((i, ch) => (unit([lv?.R, lv?.G, lv?.B][ch]) > 0 ? ledPerceived(Math.max(0, i) / 0.02) : 0))
        : [unit(lv?.R), unit(lv?.G), unit(lv?.B)].map((b) => ledPerceived(b * 0.5))
    const max = Math.max(br[0], br[1], br[2])
    if (t?.burned && !state.burned) state.burned = true
    else if (!t?.burned && state.burned) state.burned = false
    // unlit body color: milky white, charred brown after a burn-out
    glass.color.setHex(state.burned ? 0x4a4036 : RGB_EPOXY_COLOR)
    for (let ch = 0; ch < 3; ch++) dies[ch].emissiveIntensity = br[ch] <= P_DARK ? 0 : ledLook(Math.min(1.3, br[ch])).die
    if (max <= P_DARK) {
      glass.emissiveIntensity = 0
      glow?.apply(0)
      return
    }
    // additive mix of the die hues, normalized to the brightest component
    mixed.setRGB(0, 0, 0)
    for (let ch = 0; ch < 3; ch++) {
      const [r, g, b] = RGB_DIE_HUES[ch]
      mixed.r += r * br[ch]
      mixed.g += g * br[ch]
      mixed.b += b * br[ch]
    }
    const m = Math.max(mixed.r, mixed.g, mixed.b)
    mixed.multiplyScalar(1 / m)
    // perceived brightness of the brightest die (led-look.ts: light^0.45)
    const perceived = Math.min(1, max)
    const look = ledLook(Math.min(1.3, max))
    glass.emissive.copy(mixed)
    // moderate emission (the shared lens curve, ≤ 1.1 at the rating): past
    // that the tone mapper bleaches a saturated hue to white — the color
    // comes from the tinted body, the brightness from the dies and the halo
    glass.emissiveIntensity = look.lens
    // the light scatters through the whole diffused body: its diffuse color
    // takes the mixed hue, a little darker than the emission so the key
    // light does not wash a magenta glow out to pink
    tint.copy(mixed).multiplyScalar(0.55)
    glass.color.lerp(tint, Math.min(1, 0.6 + 0.6 * perceived))
    if (glow) {
      setHaloColor(glow, mixed)
      glow.apply(Math.min(1.3, max))
    }
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()), update }
}

// ---------------------------------------------------------------------------
// TO-220 (LM7805, IRLZ44N): molded body, nickel tab with Ø3.7 hole, 3 leads
// ---------------------------------------------------------------------------

const T220_W = 10.0 * MM
const T220_PL_H = 9.2 * MM
const T220_TAB_H = 15.6 * MM
const T220_PL_T = 3.2 * MM
const T220_TAB_T = 1.3 * MM
/** plastic front face (local +Z); the lead plane is z = 0 */
const T220_FRONT_Z = 2.1 * MM
/** body bottom: the wide lead shoulders stop insertion this high */
const T220_BASE_Y = 0.75
const T220_SHOULDER = 1.6 * MM
/** mesh top (tab top) — the catalog obstacleHeight must cover it */
export const TO220_TOP = T220_BASE_Y + T220_TAB_H

function to220TabGeometry(): THREE.BufferGeometry {
  return cachedGeometry('basic-to220-tab', () => {
    const w = T220_W / 2
    const h = T220_TAB_H
    const ch = 0.7 * MM
    const s = new THREE.Shape()
    s.moveTo(-w, 0)
    s.lineTo(w, 0)
    s.lineTo(w, h - ch)
    s.lineTo(w - ch, h)
    s.lineTo(-w + ch, h)
    s.lineTo(-w, h - ch)
    s.closePath()
    const hole = new THREE.Path()
    hole.absarc(0, h - 2.9 * MM, 1.85 * MM, 0, Math.PI * 2, true)
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth: T220_TAB_T, bevelEnabled: false, curveSegments: 20 })
    g.translate(0, T220_BASE_Y, T220_FRONT_Z - T220_PL_T - T220_TAB_T)
    return g
  })
}

function to220Statics(): THREE.Mesh[] {
  const parts: THREE.Object3D[] = []
  const body = new THREE.Mesh(
    cachedGeometry('basic-to220-body', () => new RoundedBoxGeometry(T220_W - 0.02, T220_PL_H, T220_PL_T, 2, 0.06)),
    moldedEpoxy(0x18181a, 0.5),
  )
  body.position.set(0, T220_BASE_Y + T220_PL_H / 2, T220_FRONT_Z - T220_PL_T / 2)
  parts.push(body)
  parts.push(new THREE.Mesh(to220TabGeometry(), to220TabMaterial()))
  // wide lead shoulders under the body (they stop the insertion)
  for (let i = 0; i < 3; i++) {
    const sh = new THREE.Mesh(slabGeometry(1.4 * MM, T220_SHOULDER + 0.05, 0.5 * MM), metal())
    sh.position.set((i - 1) * 1.0, T220_BASE_Y - T220_SHOULDER / 2 + 0.02, 0)
    parts.push(sh)
  }
  return mergeStatic(parts)
}

/**
 * Tin-plated copper tab: bright and smooth, NOT a pure mirror — metalness 1
 * reflects only the (deliberately dim) raster-mode environment and the tab
 * read as dark brushed steel in Enhanced; 0.85 + an env lift keeps a diffuse
 * response under the key light (same reasoning as the instrument faceplates).
 */
function to220TabMaterial(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('basic-to220-tab-mat', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xd3d6da, metalness: 0.85, roughness: 0.3 })
    m.envMapIntensity = 1.8
    return m
  })
}

let to220Cache: { geometry: THREE.BufferGeometry; material: THREE.Material }[] | null = null

function buildTo220(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = leadFrame(pins)
  const frame = new THREE.Group()
  frame.position.set(c.x, 0, c.z)
  frame.rotation.y = yaw
  if (!to220Cache) {
    to220Cache = to220Statics().map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
  }
  for (const s of to220Cache) frame.add(new THREE.Mesh(s.geometry, s.material))

  // pad-printed marking on the front face
  if (!isGhost(comp)) {
    const code = shortLabel(entry)
    const mark = printMaterial(`to220:${code}`, 512, 256, [
      { text: code, y: 0.36, size: 0.3, color: '#dcdcde' },
      { text: fakeLotCode(code), y: 0.7, size: 0.2, color: '#a9a9ad', weight: 600 },
    ])
    if (mark) {
      const lbl = facePlane(T220_W * 0.86, T220_W * 0.43, mark)
      lbl.position.set(0, T220_BASE_Y + T220_PL_H * 0.6, T220_FRONT_Z + 0.004)
      frame.add(lbl)
    }
  }
  group.add(frame)

  // narrow leads: straight flat leads into the holes (nominal pitch), or bent
  // round-wire runs when the holes are spread
  const statics: THREE.Object3D[] = []
  const exitY = T220_BASE_Y - T220_SHOULDER + 0.04
  pins.slice(0, 3).forEach((pin, i) => {
    const exit = toWorld(c, yaw, (i - 1) * 1.0, exitY, 0)
    if (Math.hypot(exit.x - pin.x, exit.z - pin.z) < 0.05) {
      const h = exitY - HOLE_DEPTH
      const lead = new THREE.Mesh(slabGeometry(0.8 * MM, h, 0.5 * MM), metal())
      lead.position.set(pin.x, HOLE_DEPTH + h / 2, pin.z)
      lead.rotation.y = yaw
      statics.push(lead)
    } else {
      statics.push(legMesh(fromHole(pin, V(pin.x, 0.05, pin.z), exit, V(exit.x, exitY + 0.12, exit.z)), 0.075))
    }
  })
  for (const m of mergeStatic(statics)) group.add(m)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// Zener (DO-35 like the 1N4148, distinct band) and the TO-92 P-FET
// ---------------------------------------------------------------------------

/** Zener cathode band: deep blue lacquer (the 1N4148's is black). */
function zenerBand(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('basic-zener-band', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x1f3c96, roughness: 0.35, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  )
}

function buildZener(comp: ComponentInstance, entry: CatalogEntry, pins: V3[], routed?: RoutedComponent): BuildResult {
  const r = buildDiode(comp, entry, pins, routed)
  r.object.traverse((o) => {
    const m = o as THREE.Mesh
    const mat = m.isMesh ? (m.material as THREE.MeshPhysicalMaterial) : null
    if (mat && !Array.isArray(mat) && mat.color?.getHex() === 0x191310) m.material = zenerBand()
  })
  return r
}

function buildPmos(comp: ComponentInstance, entry: CatalogEntry, pins: V3[], routed?: RoutedComponent): BuildResult {
  // the TO-92 builder prints shortLabel(entry): a generic P-channel FET
  return buildTo92(comp, { ...entry, label: 'P-MOSFET (P-FET)' }, pins, routed)
}

// ---------------------------------------------------------------------------
// HC-49/S crystal (standing can) and MF52 NTC bead
// ---------------------------------------------------------------------------

const HC49_BASE_Y = 0.2
export const HC49_TOP = HC49_BASE_Y + (0.45 + 3.3) * MM

function hc49Statics(): THREE.Mesh[] {
  const can = metal(0xd9dce0, 0.24)
  const base = new THREE.Mesh(
    cachedGeometry('basic-hc49-base', () => {
      const g = new THREE.ExtrudeGeometry(stadiumShape(11.35 * MM, 4.95 * MM), { depth: 0.45 * MM, bevelEnabled: false, curveSegments: 6 })
      g.rotateX(-Math.PI / 2)
      return g
    }),
    metal(0xbfc3c8, 0.32),
  )
  base.position.y = HC49_BASE_Y
  const body = new THREE.Mesh(
    cachedGeometry('basic-hc49-can', () => {
      const bevel = 0.28 * MM
      const g = new THREE.ExtrudeGeometry(stadiumShape(11.05 * MM - 2 * bevel, 4.65 * MM - 2 * bevel), {
        depth: 3.3 * MM - 2 * bevel,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 6,
      })
      g.rotateX(-Math.PI / 2)
      g.translate(0, bevel, 0)
      return g
    }),
    can,
  )
  body.position.y = HC49_BASE_Y + 0.44 * MM
  return mergeStatic([base, body])
}

function buildHc49(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = leadFrame(pins)
  const frame = new THREE.Group()
  frame.position.set(c.x, 0, c.z)
  frame.rotation.y = yaw
  for (const m of hc49Statics()) frame.add(m)
  if (!isGhost(comp)) {
    const f = Number(paramOf(comp.params, entry, 'frequency') ?? 8)
    const text = Number.isFinite(f) ? (f < 1 ? `${(f * 1000).toFixed(3)}K` : f.toFixed(3)) : '?'
    const ink = printMaterial(`hc49:${text}`, 512, 128, [{ text, y: 0.52, size: 0.62, color: '#2b2d31' }])
    if (ink) {
      const lbl = topPlane(7.0 * MM, 1.75 * MM, ink)
      lbl.position.set(0, HC49_TOP + 0.004, 0)
      frame.add(lbl)
    }
  }
  group.add(frame)
  const statics: THREE.Object3D[] = []
  pins.slice(0, 2).forEach((pin, i) => {
    const entryPt = toWorld(c, yaw, (i === 0 ? -1 : 1) * 2.44 * MM, HC49_BASE_Y + 0.1, 0)
    statics.push(legMesh(leadPath(pin, entryPt, 0.08), 0.045))
  })
  for (const m of mergeStatic(statics)) group.add(m)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

const NTC_NECK_Y = 0.95
export const NTC_TOP = NTC_NECK_Y + 1.0

function buildNtc(_comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = leadFrame(pins)
  // teardrop epoxy bead (MF52): a lathe profile, neck down on the leads
  const bead = new THREE.Mesh(
    cachedGeometry('basic-ntc-bead', () => {
      const pts: THREE.Vector2[] = []
      const N = 14
      for (let i = 0; i <= N; i++) {
        const t = i / N // 0 bottom … 1 top
        const y = t * 1.0
        // narrow neck widening to Ø 1.1 just above mid-height, round top
        const r = t < 0.62 ? 0.1 + 0.46 * Math.sin((t / 0.62) * (Math.PI / 2)) : 0.56 * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2))
        pts.push(new THREE.Vector2(Math.max(r, 0.001), y))
      }
      return new THREE.LatheGeometry(pts, 20)
    }),
    moldedEpoxy(0x151517, 0.32),
  )
  bead.position.set(c.x, NTC_NECK_Y, c.z)
  bead.rotation.y = yaw
  group.add(bead)
  const statics: THREE.Object3D[] = []
  pins.slice(0, 2).forEach((pin, i) => {
    const entryPt = toWorld(c, yaw, (i === 0 ? -1 : 1) * 0.07, NTC_NECK_Y + 0.25, 0)
    const spread = toWorld(c, yaw, (i === 0 ? -1 : 1) * 0.16, NTC_NECK_Y - 0.25, 0)
    statics.push(legMesh(fromHole(pin, V(pin.x, 0.25, pin.z), spread, entryPt), 0.04))
  })
  for (const m of mergeStatic(statics)) group.add(m)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// Sub-miniature SPDT toggle (2.54 mm pins): base + metal frame, threaded
// bushing with hex nut, chrome bat lever posed by the runtime state
// ---------------------------------------------------------------------------

const TGL_BASE_Y = 0.25
const TGL_BODY_H = 1.7
const TGL_BUSH_H = 0.8
const TGL_LEVER_L = 2.0
const TGL_TILT = 0.38
const TGL_PIVOT_Y = TGL_BASE_Y + TGL_BODY_H + TGL_BUSH_H
export const TOGGLE_TOP = TGL_PIVOT_Y + Math.cos(TGL_TILT) * (TGL_LEVER_L + 0.2) + 0.2

function toggleStatics(): THREE.Mesh[] {
  const parts: THREE.Object3D[] = []
  const base = new THREE.Mesh(
    cachedGeometry('basic-tgl-base', () => new RoundedBoxGeometry(3.0, 0.62, 2.2, 1, 0.06)),
    plastic(0x1a1a1c, 0.6),
  )
  base.position.y = TGL_BASE_Y + 0.31
  parts.push(base)
  const frameMat = metal(0xbfc3c9, 0.32)
  const caseBox = new THREE.Mesh(
    cachedGeometry('basic-tgl-case', () => new RoundedBoxGeometry(3.0, TGL_BODY_H - 0.6, 2.2, 1, 0.05)),
    frameMat,
  )
  caseBox.position.y = TGL_BASE_Y + 0.6 + (TGL_BODY_H - 0.6) / 2
  parts.push(caseBox)
  // threaded bushing: core + thread crests
  const bushTop = TGL_BASE_Y + TGL_BODY_H
  const core = new THREE.Mesh(
    cachedGeometry('basic-tgl-bush', () => new THREE.CylinderGeometry(0.78, 0.78, TGL_BUSH_H, 20)),
    frameMat,
  )
  core.position.y = bushTop + TGL_BUSH_H / 2
  parts.push(core)
  const crest = cachedGeometry('basic-tgl-thread', () => {
    const g = new THREE.TorusGeometry(0.8, 0.035, 4, 20)
    g.rotateX(Math.PI / 2)
    return g
  })
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(crest, frameMat)
    t.position.y = bushTop + 0.42 + k * 0.11
    parts.push(t)
  }
  const nut = new THREE.Mesh(
    cachedGeometry('basic-tgl-nut', () => new THREE.CylinderGeometry(1.08, 1.08, 0.28, 6)),
    metal(0xd2d5d9, 0.28),
  )
  nut.position.y = bushTop + 0.14
  parts.push(nut)
  return mergeStatic(parts)
}

let toggleCache: { geometry: THREE.BufferGeometry; material: THREE.Material }[] | null = null

function buildToggle(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = leadFrame(pins)
  const frame = new THREE.Group()
  frame.position.set(c.x, 0, c.z)
  frame.rotation.y = yaw
  if (!toggleCache) {
    toggleCache = toggleStatics().map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
  }
  for (const s of toggleCache) frame.add(new THREE.Mesh(s.geometry, s.material))

  // the bat lever: a separate posed group pivoting in the bushing
  const lever = new THREE.Group()
  lever.position.y = TGL_PIVOT_Y - 0.1
  const chrome = metal(0xe6e8eb, 0.16)
  const shaft = new THREE.Mesh(
    cachedGeometry('basic-tgl-lever', () => {
      const g = new THREE.CylinderGeometry(0.14, 0.2, TGL_LEVER_L, 14)
      g.translate(0, TGL_LEVER_L / 2, 0)
      return g
    }),
    chrome,
  )
  const tip = new THREE.Mesh(cachedGeometry('basic-tgl-tip', () => new THREE.SphereGeometry(0.2, 14, 10)), chrome)
  tip.position.y = TGL_LEVER_L
  for (const m of mergeStatic([shaft, tip])) lever.add(m)
  frame.add(lever)
  group.add(frame)

  const statics: THREE.Object3D[] = []
  pins.slice(0, 3).forEach((pin, i) => {
    const entryPt = toWorld(c, yaw, (i - 1) * 1.0, TGL_BASE_Y + 0.2, 0)
    statics.push(legMesh(leadPath(pin, entryPt, 0.1), 0.055))
  })
  for (const m of mergeStatic(statics)) group.add(m)

  // position "a" joins common to a: the lever points AWAY from a (toward b, +X)
  const apply = (state: unknown) => {
    lever.rotation.z = String(state ?? 'a') === 'b' ? TGL_TILT : -TGL_TILT
  }
  apply(paramOf(comp.params, entry, 'state'))
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (c2, e2) => apply(paramOf(c2.params, e2, 'state')),
  }
}

// ---------------------------------------------------------------------------
// SRD-05VDC-SL-C relay: sealed blue case on a black base, printed top
// ---------------------------------------------------------------------------

const RLY_L = 19.0 * MM
const RLY_W = 15.5 * MM
const RLY_H = 15.3 * MM
/** body center offset from the coil-pin midpoint toward the contacts (units) */
const RLY_CX = 1.8
const RLY_BASE_H = 1.0 * MM
export const RELAY_TOP = 0.05 + RLY_H

function relayStatics(): THREE.Mesh[] {
  const parts: THREE.Object3D[] = []
  const shell = new THREE.Mesh(
    cachedGeometry('basic-relay-shell', () => new RoundedBoxGeometry(RLY_L, RLY_H - RLY_BASE_H, RLY_W, 2, 0.1)),
    cachedMaterial('basic-relay-blue', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0x0b3fb0, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 })
      const n = noiseNormalTexture()
      if (n) {
        m.normalMap = n // faint molded-ABS texture
        m.normalScale.set(0.12, 0.12)
      }
      return m
    }),
  )
  shell.position.y = 0.05 + RLY_BASE_H + (RLY_H - RLY_BASE_H) / 2
  parts.push(shell)
  const base = new THREE.Mesh(slabGeometry(RLY_L - 0.12, RLY_BASE_H + 0.02, RLY_W - 0.12), plastic(0x121214, 0.7))
  base.position.y = 0.05 + RLY_BASE_H / 2
  parts.push(base)
  return mergeStatic(parts)
}

let relayCache: { geometry: THREE.BufferGeometry; material: THREE.Material }[] | null = null

/** Top-face artwork: part number, contact ratings and the form-C symbol. */
function relayPrint(): THREE.MeshBasicMaterial | null {
  return printMaterial(
    'relay-top',
    768,
    640,
    [
      { text: 'SRD-05VDC-SL-C', y: 0.17, size: 0.105, color: '#f4f6fb' },
      { text: '10A 250VAC  10A 125VAC', y: 0.33, size: 0.068, color: '#e8ecf6', weight: 600 },
      { text: '10A 30VDC   10A 28VDC', y: 0.44, size: 0.068, color: '#e8ecf6', weight: 600 },
    ],
    (ctx, w, h) => {
      // coil + changeover contact symbol (as printed on the case)
      ctx.strokeStyle = '#eef1f8'
      ctx.lineWidth = 5
      const x0 = w * 0.22
      const y0 = h * 0.62
      ctx.strokeRect(x0, y0, w * 0.13, h * 0.2) // coil box
      ctx.beginPath()
      ctx.moveTo(x0 + w * 0.13, y0 + h * 0.1)
      ctx.lineTo(x0 + w * 0.22, y0 + h * 0.1)
      ctx.setLineDash([10, 8])
      ctx.lineTo(x0 + w * 0.36, y0 + h * 0.1)
      ctx.setLineDash([])
      ctx.stroke()
      // COM pivot + blade toward NC, NO / NC contacts
      const px = x0 + w * 0.42
      const py = y0 + h * 0.2
      ctx.beginPath()
      ctx.arc(px, py, 7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + w * 0.15, y0 + h * 0.03)
      ctx.moveTo(px + w * 0.17, y0)
      ctx.lineTo(px + w * 0.27, y0)
      ctx.moveTo(px + w * 0.17, y0 + h * 0.18)
      ctx.lineTo(px + w * 0.27, y0 + h * 0.18)
      ctx.stroke()
      ctx.fillStyle = '#eef1f8'
      ctx.font = `600 ${Math.round(h * 0.05)}px Arial, sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText('NC', px + w * 0.29, y0 + h * 0.005)
      ctx.fillText('NO', px + w * 0.29, y0 + h * 0.185)
      ctx.fillText('COM', px - w * 0.04, py + h * 0.08)
    },
  )
}

function buildRelay(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  // frame from the real pin holes (rotation-aware): +X from the coil pins
  // toward the NO/NC pair, centered between COIL1 and COIL2
  const coil1 = pins[0] ?? V(0, 0, 0)
  const coil2 = pins[1] ?? coil1
  const no = pins[3] ?? coil2
  const nc = pins[4] ?? no
  const coilMid = coil1.clone().add(coil2).multiplyScalar(0.5)
  const contactMid = no.clone().add(nc).multiplyScalar(0.5)
  const ax = contactMid.clone().sub(coilMid)
  ax.y = 0
  const dir = ax.lengthSq() > 1e-8 ? ax.normalize() : V(1, 0, 0)
  const yaw = Math.atan2(-dir.z, dir.x)
  const frame = new THREE.Group()
  frame.position.set(coilMid.x + dir.x * RLY_CX, 0, coilMid.z + dir.z * RLY_CX)
  frame.rotation.y = yaw
  if (!relayCache) {
    relayCache = relayStatics().map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
  }
  for (const s of relayCache) frame.add(new THREE.Mesh(s.geometry, s.material))
  if (!isGhost(comp)) {
    const art = relayPrint()
    if (art) {
      const lbl = topPlane(RLY_L * 0.92, RLY_W * 0.9, art)
      lbl.position.y = RELAY_TOP + 0.004
      frame.add(lbl)
    }
  }
  group.add(frame)
  // the flat pins between the base and the board (mostly hidden)
  const statics: THREE.Object3D[] = []
  for (const pin of pins.slice(0, 5)) {
    const h = 0.12 - HOLE_DEPTH
    const p = new THREE.Mesh(slabGeometry(1.0 * MM, h, 0.5 * MM), metal())
    p.position.set(pin.x, HOLE_DEPTH + h / 2, pin.z)
    p.rotation.y = yaw
    statics.push(p)
  }
  for (const m of mergeStatic(statics)) group.add(m)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// BSS138 level shifter breakout (board frame in mm: +x LV1 → LV4, +z toward
// the LV header row; headers 0.4" apart straddling the channel)
// ---------------------------------------------------------------------------

const LS_L = 15.2
const LS_W = 13.5
const LS_T = 1.6
const LS_SPACER = 2.5
const LS_PITCH = 2.54
const LS_ROW_Z = 2 * LS_PITCH
const LS_Y_BOT = LS_SPACER * MM
const LS_Y_TOP = (LS_SPACER + LS_T) * MM
const LS_LIFT = 0.004
export const LEVEL_SHIFTER_TOP = LS_Y_TOP + (1.12 + 0.3) * MM

const LS_LV = ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4']
const LS_HV = ['HV1', 'HV2', 'HV', 'GND', 'HV3', 'HV4']
/** channel columns (header index) of channels 1–4 */
const LS_CH_COL = [0, 1, 4, 5]

function lsPinMm(col: number, lv: boolean): [number, number] {
  return [(col - 2.5) * LS_PITCH, lv ? LS_ROW_Z : -LS_ROW_Z]
}

function paintLevelShifter(p: PcbPainter): void {
  // power planes: LV rail along the LV row inside, HV rail along the HV row
  const traces: [number, number][][] = []
  for (const col of LS_CH_COL) {
    const [x] = lsPinMm(col, true)
    // LVn pad → source / RL ; HVn pad → drain / RH
    traces.push([
      [x, LS_ROW_Z],
      [x, 0.9],
    ])
    traces.push([
      [x, -LS_ROW_Z],
      [x, -0.9],
    ])
    // gate + pull-up commons
    traces.push([
      [x - 0.95, 0.4],
      [x - 0.95, 1.2],
    ])
  }
  // LV bus (gates + RL tops) and HV bus (RH tops)
  traces.push([
    [lsPinMm(0, true)[0] - 0.95, 1.2],
    [lsPinMm(5, true)[0] - 0.95, 1.2],
  ])
  traces.push([
    [lsPinMm(2, true)[0], LS_ROW_Z],
    [lsPinMm(2, true)[0], 1.2],
  ])
  traces.push([
    [lsPinMm(2, false)[0], -LS_ROW_Z],
    [lsPinMm(2, false)[0], -3.4],
    [lsPinMm(0, false)[0], -3.4],
  ])
  traces.push([
    [lsPinMm(2, false)[0], -3.4],
    [lsPinMm(5, false)[0], -3.4],
  ])
  p.traces(traces, 0.3)
  // GND pour between the GND pads
  p.copperRect(lsPinMm(3, true)[0], 0, 1.2, 2 * LS_ROW_Z)
  // header pads
  for (let col = 0; col < 6; col++) {
    for (const lv of [true, false]) {
      const [x, z] = lsPinMm(col, lv)
      if (col === 0 && lv) p.padRect(x, z, 1.6, 1.6)
      else p.padCircle(x, z, 0.8)
    }
  }
  // SOT-23 + 0603 land patterns
  for (const col of LS_CH_COL) {
    const [x] = lsPinMm(col, true)
    for (const [dx, dz] of [
      [-1.0, -0.95],
      [-1.0, 0.95],
      [1.0, 0],
    ] as const) {
      p.padRect(x + dx, dz, 0.8, 0.7)
    }
    for (const s of [1, -1]) {
      p.padRect(x - 0.75, s * 2.3, 0.7, 0.8)
      p.padRect(x + 0.75, s * 2.3, 0.7, 0.8)
    }
  }
  // silkscreen: pin labels inside the rows, channel outlines, board legend
  for (let col = 0; col < 6; col++) {
    const [x, z] = lsPinMm(col, true)
    p.silkText(LS_LV[col], x, z - 1.5, 0.82)
    p.silkText(LS_HV[col], x, -z + 1.5, 0.82)
  }
  const cx = (lsPinMm(2, true)[0] + lsPinMm(3, true)[0]) / 2
  p.silkText('LV', cx, 0.95, 1.3)
  p.silkText('HV', cx, -0.95, 1.3)
  p.silkLine([
    [cx - 1.8, 0],
    [cx + 1.8, 0],
  ], 0.15)
  p.silkRect(0, 0, LS_L - 0.8, LS_W - 0.8, 0.15)
}

function levelShifterStatics(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const parts: THREE.Object3D[] = []
  const at = (o: THREE.Object3D, xMm: number, y: number, zMm: number) => {
    o.position.set(xMm * MM, y, zMm * MM)
    parts.push(o)
    return o
  }
  const art = pcbArtMaterial(
    'basic-level-shifter',
    LS_L,
    LS_W,
    { mask: '#1d4fae', maskCopper: '#2a5fc2', pad: '#c4c7ca', silk: '#f3f4ee', drill: '#0c1d44' },
    paintLevelShifter,
    { pxPerMm: 64 },
  )
  at(new THREE.Mesh(flatQuadGeometry(LS_L * MM, LS_W * MM), art), 0, LS_Y_TOP, 0)
  at(new THREE.Mesh(slabGeometry(LS_L * MM, LS_T * MM, LS_W * MM, { top: true, bottom: true }), fr4EdgeMaterial()), 0, (LS_Y_BOT + LS_Y_TOP) / 2, 0)
  const bottom = new THREE.Mesh(flatQuadGeometry(LS_L * MM, LS_W * MM), maskMaterial(0x1b4699))
  bottom.rotation.x = Math.PI
  at(bottom, 0, LS_Y_BOT, 0)

  // 2 × 6 header: plastic cells under the board, tin tips + fillets on top
  const cellGeo = slabGeometry((LS_PITCH - 0.07) * MM, LS_SPACER * MM - 0.004, 2.5 * MM, { top: true, bottom: true })
  const tipGeo = pinTipGeometry(0.32 * MM, 1.12 * MM, 0.3 * MM)
  const filletGeo = solderFilletGeometry(0.68 * MM, 0.36 * MM, 0.42 * MM)
  const pinMetal = metal(0xd5d8dc, 0.38)
  for (let col = 0; col < 6; col++) {
    for (const lv of [true, false]) {
      const [x, z] = lsPinMm(col, lv)
      at(new THREE.Mesh(cellGeo, headerPlasticMaterial()), x, (LS_SPACER * MM) / 2 + 0.002, z)
      at(new THREE.Mesh(tipGeo, pinMetal), x, LS_Y_TOP, z)
      at(new THREE.Mesh(filletGeo, solderMaterial()), x, LS_Y_TOP + 0.002, z)
    }
  }

  // 4 × BSS138 (SOT-23: 2.9 × 1.3 × 1.0 mm, gull-wing leads) + 8 × 10 kΩ 0603
  // SOT-23 long axis along z so each FET fits its 2.54 mm channel column
  const sotBody = slabGeometry(1.3 * MM, 0.95 * MM, 2.9 * MM, { bottom: true })
  const sotMat = plastic(0x1b1b1e, 0.5)
  const leadFoot = slabGeometry(0.55 * MM, 0.12 * MM, 0.4 * MM, { bottom: true })
  const leadRise = slabGeometry(0.14 * MM, 0.5 * MM, 0.4 * MM, { bottom: true })
  const resBody = cachedMaterial('basic-ls-res', () => new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.5, metalness: 0 }))
  for (const col of LS_CH_COL) {
    const [x] = lsPinMm(col, true)
    at(new THREE.Mesh(sotBody, sotMat), x, LS_Y_TOP + LS_LIFT + 0.1 * MM, 0)
    for (const [sx, dz] of [
      [-1, -0.95],
      [-1, 0.95],
      [1, 0],
    ] as const) {
      at(new THREE.Mesh(leadFoot, metal()), x + sx * 1.0, LS_Y_TOP + LS_LIFT, dz)
      at(new THREE.Mesh(leadRise, metal()), x + sx * 0.72, LS_Y_TOP + LS_LIFT + 0.05 * MM, dz)
    }
    for (const s of [1, -1]) {
      const g = new THREE.Group()
      for (const m of chip0603(resBody, solderMaterial())) g.add(m)
      at(g, x, LS_Y_TOP + LS_LIFT, s * 2.3) // long axis along x
    }
  }
  return mergeStatic(parts).map((m) => {
    markShared(m.geometry)
    return { geometry: m.geometry, material: m.material as THREE.Material }
  })
}

let lsCache: { geometry: THREE.BufferGeometry; material: THREE.Material }[] | null = null

function buildLevelShifter(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const a = pins[0]
  const b = pins[Math.min(5, pins.length - 1)]
  let yaw = 0
  if (a && b && Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) yaw = Math.atan2(-(b.z - a.z), b.x - a.x)
  const c = centroidOf(pins)
  group.position.set(c.x, 0, c.z)
  group.rotation.y = yaw
  if (!lsCache) lsCache = levelShifterStatics()
  for (const s of lsCache) group.add(new THREE.Mesh(s.geometry, s.material))
  if (!isGhost(comp)) {
    // laser marking on the SOT-23s ("J1" is the BSS138 SOT-23 code)
    const mark = printMaterial('sot23-j1', 128, 64, [{ text: 'J1', y: 0.55, size: 0.62, color: '#c9c9cd' }])
    if (mark) {
      for (const col of LS_CH_COL) {
        const [x] = lsPinMm(col, true)
        const lbl = topPlane(1.4 * MM, 0.7 * MM, mark)
        lbl.rotation.y = -Math.PI / 2 // reads along the package's long axis
        lbl.position.set(x * MM, LS_Y_TOP + LS_LIFT + 1.05 * MM + 0.003, 0)
        group.add(lbl)
      }
    }
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// AMS1117-3.3 vertical SIP module (board frame in mm: +x IN → OUT, +y up,
// +z the component side; the 1×3 header block stands on the breadboard)
// ---------------------------------------------------------------------------

const AMS_W = 10.2
const AMS_H = 9.6
const AMS_T = 1.2
const AMS_HDR_H = 2.5
export const AMS1117_TOP = (AMS_HDR_H + AMS_H) * MM

function paintAms1117(p: PcbPainter): void {
  // painter frame: x right, z DOWN the board face (z = −H/2 top … +H/2 bottom)
  const yToZ = (yMm: number) => AMS_H / 2 - yMm
  // header pads + traces up to the chip
  const xs = [-2.54, 0, 2.54]
  p.traces(
    [
      [
        [-2.54, yToZ(1.2)],
        [-2.54, yToZ(2.6)],
        [-3.8, yToZ(3.6)],
        [-3.8, yToZ(8.4)],
        [2.3, yToZ(8.4)],
      ],
      [
        [0, yToZ(1.2)],
        [0, yToZ(2.6)],
      ],
      [
        [2.54, yToZ(1.2)],
        [2.54, yToZ(2.7)],
      ],
    ],
    0.45,
  )
  for (const x of xs) p.padRect(x, yToZ(1.1), 1.5, 1.7)
  // SOT-223 land pattern (tab down toward the header): tab land + 3 leads up
  p.padRect(0, yToZ(3.4), 3.4, 2.0)
  for (const x of [-2.3, 0, 2.3]) p.padRect(x, yToZ(8.1), 0.95, 1.6)
  // capacitor lands
  for (const s of [-1, 1]) {
    p.padRect(s * 4.15, yToZ(5.0), 0.8, 0.7)
    p.padRect(s * 4.15, yToZ(6.5), 0.8, 0.7)
  }
  p.silkText('IN', -2.54, yToZ(2.55), 0.95)
  p.silkText('GND', 0, yToZ(2.55) + 0.05, 0.9)
  p.silkText('OUT', 2.54, yToZ(2.55), 0.95)
  p.silkText('3.3V', -3.75, yToZ(9.05), 0.85)
  p.silkRect(0, 0, AMS_W - 0.6, AMS_H - 0.6, 0.15)
}

function amsStatics(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const parts: THREE.Object3D[] = []
  const y0 = AMS_HDR_H * MM // board bottom edge
  const zf = (AMS_T / 2) * MM // component face
  const art = pcbArtMaterial(
    'basic-ams1117',
    AMS_W,
    AMS_H,
    { mask: '#1b4ea8', maskCopper: '#285db8', pad: '#c4c7ca', silk: '#f3f4ee', drill: '#0c1d44' },
    paintAms1117,
    { pxPerMm: 64 },
  )
  const front = facePlane(AMS_W * MM, AMS_H * MM, art)
  front.position.set(0, y0 + (AMS_H * MM) / 2, zf + 0.001)
  parts.push(front)
  const core = new THREE.Mesh(slabGeometry(AMS_W * MM, AMS_H * MM, AMS_T * MM), fr4EdgeMaterial())
  core.position.set(0, y0 + (AMS_H * MM) / 2, 0)
  parts.push(core)
  const back = facePlane(AMS_W * MM, AMS_H * MM, maskMaterial(0x1a4699))
  back.rotation.y = Math.PI
  back.position.set(0, y0 + (AMS_H * MM) / 2, -zf - 0.001)
  parts.push(back)
  // 1×3 header block standing on the breadboard
  const block = new THREE.Mesh(slabGeometry(3 * 2.54 * MM - 0.04, AMS_HDR_H * MM, 2.5 * MM), headerPlasticMaterial())
  block.position.set(0, (AMS_HDR_H * MM) / 2, 0)
  parts.push(block)
  // pins rising out of the block along the board face, soldered to the pads
  const pinGeo = slabGeometry(0.64 * MM, 2.2 * MM, 0.64 * MM)
  for (const x of [-2.54, 0, 2.54]) {
    const pin = new THREE.Mesh(pinGeo, metal(0xd5d8dc, 0.38))
    pin.position.set(x * MM, y0 + 1.0 * MM, zf + 0.33 * MM)
    parts.push(pin)
    const blob = new THREE.Mesh(
      cachedGeometry('basic-ams-blob', () => {
        const g = new THREE.SphereGeometry(0.75 * MM, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        g.rotateX(Math.PI / 2) // dome faces +z
        g.scale(1, 1.3, 0.55)
        return g
      }),
      solderMaterial(),
    )
    blob.position.set(x * MM, y0 + 1.15 * MM, zf)
    parts.push(blob)
  }
  // SOT-223: body 6.5 × 3.5 × 1.6 mm, tab toward the header, 3 leads up
  const chipY = y0 + 5.75 * MM
  const body = new THREE.Mesh(
    cachedGeometry('basic-sot223', () => new RoundedBoxGeometry(6.5 * MM, 3.5 * MM, 1.6 * MM, 1, 0.12 * MM)),
    cachedMaterial('basic-sot223-mold', () => new THREE.MeshPhysicalMaterial({ color: 0x1d1d20, roughness: 0.58, metalness: 0, clearcoat: 0.08 })),
  )
  body.position.set(0, chipY, zf + 0.8 * MM + 0.002)
  parts.push(body)
  const tab = new THREE.Mesh(slabGeometry(3.0 * MM, 1.9 * MM, 0.3 * MM), metal(0xcfd2d6, 0.3))
  tab.position.set(0, chipY - 2.55 * MM, zf + 0.15 * MM + 0.002)
  parts.push(tab)
  for (const x of [-2.3, 0, 2.3]) {
    const lead = new THREE.Mesh(slabGeometry(0.7 * MM, 1.6 * MM, 0.26 * MM), metal(0xcfd2d6, 0.3))
    lead.position.set(x * MM, chipY + 2.45 * MM, zf + 0.13 * MM + 0.002)
    parts.push(lead)
  }
  // 10 µF input / output caps (0603, standing on the face)
  const capBody = cachedMaterial('basic-ams-cap', () => new THREE.MeshPhysicalMaterial({ color: 0xb59a6a, roughness: 0.55, metalness: 0 }))
  for (const s of [-1, 1]) {
    const g = new THREE.Group()
    for (const m of chip0603(capBody, solderMaterial(), 0.8)) g.add(m)
    // top face +y → +z first, then the long axis x → y (Euler order ZYX applies X first)
    g.rotation.set(Math.PI / 2, 0, Math.PI / 2, 'ZYX')
    g.position.set(s * 4.15 * MM, y0 + 5.75 * MM, zf + 0.002)
    parts.push(g)
  }
  return mergeStatic(parts).map((m) => {
    markShared(m.geometry)
    return { geometry: m.geometry, material: m.material as THREE.Material }
  })
}

let amsCache: { geometry: THREE.BufferGeometry; material: THREE.Material }[] | null = null

function buildAms1117(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = leadFrame(pins)
  const frame = new THREE.Group()
  frame.position.set(c.x, 0, c.z)
  frame.rotation.y = yaw
  if (!amsCache) amsCache = amsStatics()
  for (const s of amsCache) frame.add(new THREE.Mesh(s.geometry, s.material))
  if (!isGhost(comp)) {
    const mark = printMaterial('ams1117-mark', 512, 256, [
      { text: 'AMS1117', y: 0.36, size: 0.3, color: '#cfcfd3' },
      { text: '3.3  ' + fakeLotCode('AMS1117'), y: 0.7, size: 0.2, color: '#a3a3a8', weight: 600 },
    ])
    if (mark) {
      const lbl = facePlane(5.6 * MM, 2.8 * MM, mark)
      lbl.position.set(0, (AMS_HDR_H + 5.75) * MM, ((AMS_T / 2 + 1.6) * MM) + 0.006)
      frame.add(lbl)
    }
  }
  group.add(frame)
  // header pin tails into the holes (bent when the holes are not in a row)
  const statics: THREE.Object3D[] = []
  pins.slice(0, 3).forEach((pin, i) => {
    const entryPt = toWorld(c, yaw, (i - 1) * 1.0, 0.25, 0)
    statics.push(legMesh(leadPath(pin, entryPt, 0.06), 0.05, metal(0xd5d8dc, 0.38)))
  })
  for (const m of mergeStatic(statics)) group.add(m)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// Off-board sources (anchor = top-left of the 6.5 × 4.5 instrument rect)
// ---------------------------------------------------------------------------

/** Instrument anchor from the first terminal (pin i sits at anchor + (2 + 2.5·i, 2)). */
function anchorOf(pins: V3[]): { ax: number; az: number } {
  const p = pins[0] ?? V(0, 0, 0)
  return { ax: p.x - 2, az: p.z - 2 }
}

/**
 * A battery lead ending at an off-board terminal: insulated wire from `from`
 * down to the desk, along it, rising into a tinned tip whose top is the wire
 * attach point (p.x, TERMINAL_TOP_Y, p.z).
 */
function batteryLead(from: V3, pin: V3, color: number, statics: THREE.Object3D[]): void {
  const ins = makeWireMaterial(color)
  const deskY = 0.07
  const tipBase = TERMINAL_TOP_Y - 0.26
  const pts = [
    from,
    V(from.x, Math.max(deskY, from.y - 0.4), from.z + 0.35),
    V(from.x + Math.sign(pin.x - from.x) * 0.3, deskY, Math.min(pin.z - 0.2, from.z + 0.9)),
    V(pin.x, deskY, pin.z - 0.35),
    V(pin.x, deskY + 0.1, pin.z),
    V(pin.x, tipBase, pin.z),
  ]
  statics.push(legMesh(pts, 0.07, ins))
  // tinned stranded end (bare) up to the attach point
  statics.push(legMesh([V(pin.x, tipBase - 0.04, pin.z), V(pin.x, TERMINAL_TOP_Y - 0.02, pin.z)], 0.045, metal(0xd8d2c4, 0.42)))
}

// ---- 9 V battery (PP3) lying on its broad face, snap clip on the −x end ----

const B9_L = 5.0
const B9_W = 2.73
const B9_H = 1.8

function buildBattery9v(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { ax, az } = anchorOf(pins)
  const cx = ax + 0.95 + B9_L / 2
  const cz = az - 1.85 + B9_W / 2
  const statics: THREE.Object3D[] = []
  // drawn steel jacket: navy with a brushed band toward the terminal end
  const jacket = new THREE.Mesh(
    cachedGeometry('basic-b9-body', () => new RoundedBoxGeometry(B9_L, B9_H, B9_W, 2, 0.12)),
    cachedMaterial('basic-b9-jacket', () => new THREE.MeshPhysicalMaterial({ color: 0x1d2b46, roughness: 0.32, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
  )
  jacket.position.set(cx, B9_H / 2 + 0.01, cz)
  statics.push(jacket)
  const band = new THREE.Mesh(
    cachedGeometry('basic-b9-band', () => new RoundedBoxGeometry(0.9, B9_H + 0.02, B9_W + 0.02, 2, 0.12)),
    metal(0xb8a27a, 0.3),
  )
  band.position.set(cx - B9_L / 2 + 0.9, B9_H / 2 + 0.01, cz)
  statics.push(band)
  // snap clip (black PVC cap) over the terminal end
  const clip = new THREE.Mesh(
    cachedGeometry('basic-b9-clip', () => new RoundedBoxGeometry(0.8, 1.15, 2.3, 2, 0.14)),
    plastic(0x111113, 0.55),
  )
  clip.position.set(cx - B9_L / 2 - 0.36, B9_H / 2 + 0.01, cz)
  statics.push(clip)
  // leads out of the clip's front-bottom corner to the lead ends
  const fromR = V(cx - B9_L / 2 - 0.36, 0.45, cz + 0.85)
  const fromB = V(cx - B9_L / 2 - 0.36, 0.33, cz + 0.85)
  if (pins[0]) batteryLead(fromR, pins[0], 0xc62828, statics)
  if (pins[1]) batteryLead(fromB, pins[1], 0x1d1d1f, statics)
  for (const m of mergeStatic(statics)) group.add(m)
  if (!isGhost(comp)) {
    const label = printMaterial('b9-top', 512, 280, [
      { text: '9V', y: 0.42, size: 0.5, color: '#f3f0e6', weight: 800 },
      { text: 'ALKALINE · 6LR61', y: 0.8, size: 0.13, color: '#d8c79e', weight: 700 },
    ])
    if (label) {
      const top = topPlane(3.0, 1.64, label)
      top.position.set(cx + 0.5, B9_H + 0.015, cz)
      group.add(top)
    }
  }
  return { object: group, pinWorld: pins.map((p) => V(p.x, TERMINAL_TOP_Y, p.z)) }
}

// ---- 2 × AA holder: open black tray, two cells in series ----

const AA_L = 6.2
const AA_W = 3.4
const AA_WALL_H = 1.05
const AA_CELL_R = 0.77
const AA_CELL_L = 5.4

function aaCellParts(cx: number, cy: number, cz: number, plusRight: boolean, out: THREE.Object3D[]): void {
  const jacket = new THREE.Mesh(
    cachedGeometry('basic-aa-jacket', () => {
      const g = new THREE.CylinderGeometry(AA_CELL_R, AA_CELL_R, AA_CELL_L - 0.16, 28, 1, true)
      g.rotateZ(Math.PI / 2)
      return g
    }),
    cachedMaterial('basic-aa-jacket-mat', () => new THREE.MeshPhysicalMaterial({ color: 0x2c5fa8, roughness: 0.3, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.15 })),
  )
  jacket.position.set(cx, cy, cz)
  out.push(jacket)
  // silver band at the + end
  const band = new THREE.Mesh(
    cachedGeometry('basic-aa-band', () => {
      const g = new THREE.CylinderGeometry(AA_CELL_R + 0.004, AA_CELL_R + 0.004, 0.9, 28, 1, true)
      g.rotateZ(Math.PI / 2)
      return g
    }),
    metal(0xc9ccd0, 0.3),
  )
  const s = plusRight ? 1 : -1
  band.position.set(cx + s * (AA_CELL_L / 2 - 0.08 - 0.45), cy, cz)
  out.push(band)
  // end caps: + with the button, − flat
  const capGeo = cachedGeometry('basic-aa-cap', () => {
    const g = new THREE.CylinderGeometry(AA_CELL_R * 0.97, AA_CELL_R * 0.97, 0.08, 28)
    g.rotateZ(Math.PI / 2)
    return g
  })
  for (const e of [1, -1]) {
    const cap = new THREE.Mesh(capGeo, metal(0xb9bdc2, 0.3))
    cap.position.set(cx + e * (AA_CELL_L / 2 - 0.04), cy, cz)
    out.push(cap)
  }
  const nub = new THREE.Mesh(
    cachedGeometry('basic-aa-nub', () => {
      const g = new THREE.CylinderGeometry(0.27, 0.27, 0.1, 18)
      g.rotateZ(Math.PI / 2)
      return g
    }),
    metal(0xd0d3d7, 0.25),
  )
  nub.position.set(cx + s * (AA_CELL_L / 2 + 0.05), cy, cz)
  out.push(nub)
}

function buildBatteryAa2(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { ax, az } = anchorOf(pins)
  const cx = ax + 0.15 + AA_L / 2
  const cz = az - 1.9 + AA_W / 2
  const statics: THREE.Object3D[] = []
  const tray = plastic(0x161618, 0.6)
  const floor = new THREE.Mesh(slabGeometry(AA_L, 0.12, AA_W), tray)
  floor.position.set(cx, 0.06, cz)
  statics.push(floor)
  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(slabGeometry(AA_L, AA_WALL_H, 0.12), tray)
    wall.position.set(cx, AA_WALL_H / 2, cz + sz * (AA_W / 2 - 0.06))
    statics.push(wall)
  }
  for (const sx of [-1, 1]) {
    const end = new THREE.Mesh(slabGeometry(0.16, AA_WALL_H + 0.2, AA_W), tray)
    end.position.set(cx + sx * (AA_L / 2 - 0.08), (AA_WALL_H + 0.2) / 2, cz)
    statics.push(end)
    // nickel contact plates on the end walls
    for (const sz of [-1, 1]) {
      const plate = new THREE.Mesh(slabGeometry(0.03, 0.9, 0.9), metal(0xc7cacf, 0.35))
      plate.position.set(cx + sx * (AA_L / 2 - 0.17), 0.85, cz + sz * 0.8)
      statics.push(plate)
    }
  }
  // center divider rib
  const rib = new THREE.Mesh(slabGeometry(AA_L - 0.3, 0.5, 0.08), tray)
  rib.position.set(cx, 0.3, cz)
  statics.push(rib)
  const cy = 0.12 + AA_CELL_R
  aaCellParts(cx, cy, cz - 0.8, true, statics)
  aaCellParts(cx, cy, cz + 0.8, false, statics)
  const fromR = V(cx - AA_L / 2 - 0.05, 0.5, cz + 1.1)
  const fromB = V(cx - AA_L / 2 - 0.05, 0.36, cz + 1.25)
  if (pins[0]) batteryLead(fromR, pins[0], 0xc62828, statics)
  if (pins[1]) batteryLead(fromB, pins[1], 0x1d1d1f, statics)
  for (const m of mergeStatic(statics)) group.add(m)
  if (!isGhost(comp)) {
    const label = printMaterial('aa-cell', 512, 128, [{ text: 'AA  1.5V  LR6', y: 0.52, size: 0.5, color: '#f1f3f7', weight: 800 }])
    if (label) {
      for (const sz of [-0.8, 0.8]) {
        const lbl = topPlane(3.0, 0.75, label)
        lbl.position.set(cx - 0.3, cy + AA_CELL_R + 0.012, cz + sz)
        if (sz > 0) lbl.rotation.y = Math.PI
        group.add(lbl)
      }
    }
  }
  return { object: group, pinWorld: pins.map((p) => V(p.x, TERMINAL_TOP_Y, p.z)) }
}

// ---- lab current source (bench enclosure like the PSU) ----

const CS_SCREEN_W = 256
const CS_SCREEN_H = 128

function drawCurrentScreen(ctx: CanvasRenderingContext2D, iSetMa: number, vc: number, iOutMa: number | null, vOut: number | null, cv: boolean): void {
  ctx.fillStyle = '#0a1219'
  ctx.fillRect(0, 0, CS_SCREEN_W, CS_SCREEN_H)
  ctx.strokeStyle = '#25445a'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, CS_SCREEN_W - 4, CS_SCREEN_H - 4)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#d29a3a'
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillText('CONST CURRENT', CS_SCREEN_W / 2, 18)
  ctx.fillStyle = '#ffc56a'
  ctx.font = 'bold 44px "Courier New", monospace'
  ctx.fillText(`${iSetMa.toFixed(iSetMa < 10 ? 2 : 1)} mA`, CS_SCREEN_W / 2, 58)
  ctx.font = 'bold 17px "Courier New", monospace'
  ctx.fillStyle = '#b8894a'
  const meas = iOutMa === null || vOut === null ? '— mA  — V' : `${iOutMa.toFixed(2)} mA  ${vOut.toFixed(2)} V`
  ctx.fillText(meas, CS_SCREEN_W / 2, 92)
  ctx.font = 'bold 14px Arial, sans-serif'
  ctx.fillStyle = cv ? '#ff6a5a' : '#7a6440'
  ctx.fillText(`LIMIT ${vc.toFixed(1)} V`, CS_SCREEN_W / 2, 113)
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  for (let y = 0; y < CS_SCREEN_H; y += 4) ctx.fillRect(0, y, CS_SCREEN_W, 1)
}

function buildCurrentSource(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const c = centroidOf(pins)
  const bodyW = 6.5
  const bodyH = 3.2
  const bodyD = 3.2
  const frontZ = c.z - 0.8 // posts stand 0.8 in front of the face, like the PSU
  const statics: THREE.Object3D[] = []

  const shell = new THREE.Mesh(
    cachedGeometry('basic-cs-shell', () => new RoundedBoxGeometry(bodyW, bodyH, bodyD, 2, 0.12)),
    cachedMaterial('basic-cs-shell-mat', () => new THREE.MeshPhysicalMaterial({ color: 0x2b2a27, roughness: 0.55, metalness: 0.25 })),
  )
  shell.position.set(c.x, bodyH / 2, frontZ - bodyD / 2)
  statics.push(shell)
  const plate = new THREE.Mesh(
    slabGeometry(6.2, 2.96, 0.08),
    cachedMaterial('basic-cs-plate', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0xc9c5bd, metalness: 0.8, roughness: 0.38 })
      m.envMapIntensity = 1.9
      return m
    }),
  )
  plate.position.set(c.x, bodyH / 2, frontZ + 0.04)
  statics.push(plate)
  const faceZ = frontZ + 0.1
  const rubber = cachedMaterial('basic-cs-rubber', () => new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.9, metalness: 0 }))
  const bumperGeo = cachedGeometry('basic-cs-bumper', () => new RoundedBoxGeometry(0.62, 0.62, 0.4, 1, 0.14))
  for (const sx of [-1, 1]) {
    for (const sy of [0, 1]) {
      for (const zPos of [frontZ + 0.04, frontZ - bodyD + 0.12]) {
        const b = new THREE.Mesh(bumperGeo, rubber)
        b.position.set(c.x + sx * (bodyW / 2 - 0.3), sy === 0 ? 0.31 : bodyH - 0.31, zPos)
        statics.push(b)
      }
    }
  }
  // screen bezel
  const bezel = cachedMaterial('basic-cs-bezel', () => new THREE.MeshPhysicalMaterial({ color: 0x101114, roughness: 0.6, metalness: 0 }))
  const screenY = 2.05
  for (const sy of [-1, 1]) {
    const rail = new THREE.Mesh(slabGeometry(4.0, 0.15, 0.16), bezel)
    rail.position.set(c.x - 0.35, screenY + sy * 1.02, faceZ + 0.06)
    statics.push(rail)
  }
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(slabGeometry(0.15, 1.6, 0.16), bezel)
    rail.position.set(c.x - 0.35 + sx * 1.925, screenY, faceZ + 0.06)
    statics.push(rail)
  }
  // knob (current set) + its base
  const knobX = c.x + 2.45
  const knobBase = new THREE.Mesh(
    cachedGeometry('basic-cs-knob-base', () => {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24)
      g.rotateX(Math.PI / 2)
      return g
    }),
    bezel,
  )
  knobBase.position.set(knobX, 2.05, faceZ + 0.03)
  statics.push(knobBase)
  const knob = new THREE.Mesh(
    cachedGeometry('basic-cs-knob', () => {
      const g = new THREE.CylinderGeometry(0.42, 0.44, 0.42, 24)
      g.rotateX(Math.PI / 2)
      return g
    }),
    metal(0xb9bec5, 0.3),
  )
  knob.position.set(knobX, 2.05, faceZ + 0.26)
  statics.push(knob)
  // binding posts (red +, black −), the cross-drilled stud top = attach point
  const studR = 0.1
  const axisY = TERMINAL_TOP_Y - studR
  const plateFront = frontZ + 0.08
  const hexGeo = cachedGeometry('basic-cs-hex', () => {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 6)
    g.rotateX(Math.PI / 2)
    return g
  })
  const barrelGeo = cachedGeometry('basic-cs-barrel', () => {
    const g = new THREE.CylinderGeometry(0.21, 0.21, 0.48, 18)
    g.rotateX(Math.PI / 2)
    return g
  })
  const studGeo = cachedGeometry('basic-cs-stud', () => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.29, 14)
    g.rotateX(Math.PI / 2)
    return g
  })
  const domeGeo = cachedGeometry('basic-cs-dome', () => {
    const g = new THREE.CylinderGeometry(0.13, 0.16, 0.12, 14)
    g.rotateX(Math.PI / 2)
    return g
  })
  const bore = cachedMaterial('basic-cs-bore', () => new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.8, metalness: 0 }))
  const boreGeo = cachedGeometry('basic-cs-boregeo', () => new THREE.CylinderGeometry(0.045, 0.045, 0.26, 8))
  pins.slice(0, 2).forEach((p, i) => {
    const ins = plastic(i === 0 ? 0xc02020 : 0x1a1a1d, 0.32)
    const hex = new THREE.Mesh(hexGeo, metal(0xc9ccd1, 0.28))
    hex.position.set(p.x, axisY, plateFront + 0.06)
    statics.push(hex)
    const barrel = new THREE.Mesh(barrelGeo, ins)
    barrel.position.set(p.x, axisY, plateFront + 0.38)
    statics.push(barrel)
    const stud = new THREE.Mesh(studGeo, metal(0xd8dadd, 0.25))
    stud.position.set(p.x, axisY, p.z - 0.025)
    statics.push(stud)
    const b = new THREE.Mesh(boreGeo, bore)
    b.position.set(p.x, axisY, p.z)
    statics.push(b)
    const dome = new THREE.Mesh(domeGeo, metal(0xd8dadd, 0.25))
    dome.position.set(p.x, axisY, p.z + 0.16)
    statics.push(dome)
  })
  for (const m of mergeStatic(statics)) group.add(m)

  // CC / CV indicator lamps (per instance: lit from telemetry)
  const lampGeo = cachedGeometry('basic-cs-lamp', () => {
    const g = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12)
    g.rotateX(Math.PI / 2)
    return g
  })
  const mkLamp = (color: number, x: number): THREE.MeshStandardMaterial => {
    const mat = ghost
      ? (cachedMaterial(`basic-cs-lamp:${color}`, () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 })) as THREE.MeshStandardMaterial)
      : new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, emissive: color, emissiveIntensity: 0 })
    const lamp = new THREE.Mesh(lampGeo, mat)
    lamp.position.set(x, 1.0, faceZ + 0.02)
    group.add(lamp)
    return mat
  }
  const ccLamp = mkLamp(0x35d158, c.x + 1.45)
  const cvLamp = mkLamp(0xff4a3a, c.x + 1.85)

  // printed legends
  if (!ghost) {
    const legend = printMaterial('cs-legend', 512, 64, [{ text: 'CC     CV', y: 0.5, size: 0.62, color: '#2a2d31' }])
    if (legend) {
      const l = facePlane(0.9, 0.12, legend)
      l.position.set(c.x + 1.65, 0.8, faceZ)
      group.add(l)
    }
    const model = printMaterial('cs-model', 512, 64, [{ text: 'CS-100  CURRENT SOURCE', y: 0.5, size: 0.6, color: '#2a2d31' }])
    if (model) {
      const l = facePlane(1.2, 0.15, model)
      l.position.set(c.x - 2.0, 0.9, faceZ)
      group.add(l)
    }
    for (const [i, t] of ['+', '−'].entries()) {
      const lbl = labelMaterial(t, { w: 64, h: 64, fg: i === 0 ? '#8c1f1f' : '#2b2e33' })
      const p = pins[i]
      if (lbl && p) {
        const m = facePlane(0.34, 0.34, lbl)
        m.position.set(p.x + (i === 0 ? 0.62 : -0.62), axisY, faceZ)
        group.add(m)
      }
    }
  }

  // per-instance screen, redrawn on param / reading changes only
  let redraw: ((c2: ComponentInstance, e2: CatalogEntry, t: ComponentTelemetry | null) => void) | null = null
  if (!ghost && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = CS_SCREEN_W
    canvas.height = CS_SCREEN_H
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0 }),
      )
      screen.position.set(c.x - 0.35, screenY, faceZ + 0.01)
      group.add(screen)
      let last = ''
      redraw = (c2, e2, t) => {
        const iSet = Number(paramOf(c2.params, e2, 'current') ?? 10)
        const vc = Number(paramOf(c2.params, e2, 'compliance') ?? 12)
        const iOut = t?.values?.iout
        const vOut = t?.values?.vout
        const cv = t?.values?.compliance === 1
        const key = `${iSet}|${vc}|${iOut === undefined ? '-' : (iOut * 1000).toFixed(2)}|${vOut === undefined ? '-' : vOut.toFixed(2)}|${cv}`
        if (key === last) return
        last = key
        drawCurrentScreen(ctx, iSet, vc, iOut === undefined ? null : iOut * 1000, vOut ?? null, cv)
        tex.needsUpdate = true
      }
      redraw(comp, entry, null)
    }
  }
  const update: BuildResult['update'] = (c2, e2, t) => {
    redraw?.(c2, e2, t)
    if (ghost) return
    const running = t?.values?.iout !== undefined
    const cv = t?.values?.compliance === 1
    ccLamp.emissiveIntensity = running && !cv ? 1.6 : 0
    cvLamp.emissiveIntensity = running && cv ? 1.8 : 0
  }
  return { object: group, pinWorld: pins.map((p) => V(p.x, TERMINAL_TOP_Y, p.z)), update }
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

registerMeshBuilder('rgb_led', 4, buildRgbLed)
registerMeshBuilder('to220', 3, buildTo220)
registerMeshBuilder('to92_pmos', 2, buildPmos)
registerMeshBuilder('zener', 2, buildZener)
registerMeshBuilder('hc49', 2, buildHc49)
registerMeshBuilder('ntc', 2, buildNtc)
registerMeshBuilder('toggle', 3, buildToggle)
registerMeshBuilder('relay', 5, buildRelay)
registerMeshBuilder('level_shifter', 2, buildLevelShifter)
registerMeshBuilder('ams1117_module', 3, buildAms1117)
registerMeshBuilder('battery_9v', 1, buildBattery9v)
registerMeshBuilder('battery_aa2', 1, buildBatteryAa2)
registerMeshBuilder('current_source', 1, buildCurrentSource)
