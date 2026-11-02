/**
 * Motors & drivers family meshes (src/model/parts/motors.parts.ts):
 *
 *  off-board (bench) units — anchor = top-left of the part's body rect,
 *  terminal i at anchor + (ox + pitch·i, oz) from the part's own bench
 *  geometry (CatalogEntry.offboard; legacy 6.5 × 4.5 rect, (2 + 2.5·i, 2)
 *  when absent — src/model/breadboard.ts):
 *   'motor_dc'        130-size brushed motor lying on a flat, red/white
 *                     indicator disc on the shaft (spins from telemetry
 *                     `angle`, a motion-blurred disc above ~600 rpm)
 *   'servo_sg90'      TowerPro SG90 standing upright, single-arm horn posed
 *                     from telemetry `angle` (0–180°)
 *   'stepper_28byj48' silver can + blue wire cover + ears, red pointer on
 *                     the output shaft (telemetry `angle`, output side)
 *   'stepper_nema17'  NEMA 17 lying on its side: brushed caps, black stator
 *                     stack, D-cut shaft with an indicator disc (`angle`)
 *   'uln2003_board'   green ULN2003 board, DIP-16, JST-XH socket, LEDs A–D
 *                     lit from telemetry leds (sub-circuit LED_A … LED_D)
 *   'l298n_module'    red HW-095 board, finned heatsink over the Multiwatt
 *                     L298, blue screw terminals, logic header with the
 *                     ENA / ENB / 5V-EN jumpers posed from the params, power
 *                     LED from telemetry leds.PWR
 *  on-board carriers ('footprint', straddling the channel, rotations 0/180):
 *   'tb6612_module'   SparkFun-style red TB6612FNG breakout (rows h / c)
 *   'drv8833_module'  blue DRV8833 breakout (rows g / d)
 *   'stepstick'       A4988 (green) / DRV8825 (purple) / TMC2209 (black,
 *                     finned heatsink) StepStick carriers (rows g / d) —
 *                     entry.visual.color picks the variant
 *
 * Proportions: every part is modeled at its real size in millimetres (local
 * frames in plan units = mm · MM). The breadboard carriers render 1:1; the
 * bench units are scaled uniformly into the instrument footprint (like the
 * bench PSU and the batteries of basic.mesh.ts): their bodies stay inside
 * the part's declared body rect (CatalogEntry.offboard) and under the 4-unit
 * router height; a unit deeper than the legacy rect takes extra default-shelf
 * slots (offboardSlotSpan), so the shelf still leaves the legacy 2.5 of bench
 * in front of every terminal row. Leads run from the part's real connection
 * points (solder tabs, cable exits, screw-terminal clamps, header pins) along
 * the desk to tinned tips standing on the terminal positions (the wire
 * attach points); the multi-terminal units declare a finer terminal pitch
 * and a body rect that holds the whole unit — body, leads and terminal row
 * (motors.parts.ts `offboard`; tests/offboard-geometry.test.ts keeps every
 * mesh inside it).
 *
 * Standards (tests/devices/motors-mesh.test.ts): ≤ 4000 triangles, static
 * parts merged per material ONCE per design in the part's own frame (shared,
 * never disposed with an instance — the placement ghost costs no geometry
 * work), per-instance only the leads (they follow the real pins), moving
 * parts and lit LED lenses; pose updates are numeric only; no transmission,
 * never a light (LED glow = additive sprite), no canvases for the ghost.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance, ComponentTelemetry } from '../../../model/types'
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import { offboardGeometryOf } from '../../../model/breadboard'
import { TERMINAL_TOP_Y } from '../../internal/wires'
import { registerMeshBuilder } from '../registry'
import {
  BuildResult,
  brushedRoughnessTexture,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  etchedLabelMaterial,
  fakeLotCode,
  makeWireMaterial,
  markShared,
  mergeStatic,
  plastic,
  roundedPath,
} from '../shared'
import { LED_COLORS } from '../semis'
import { SMD_GLOW_SIZE, applyIndicator, ledPerceived, lightOf, makeLedHalo, type LedHaloRig } from '../led-look'
import {
  MM,
  boardEdgeGeometries,
  boardTopGeometry,
  chip0603,
  flatQuadGeometry,
  fr4EdgeMaterial,
  headerPlasticMaterial,
  headerPostGeometry,
  maskMaterial,
  pcbArtMaterial,
  qfpMoldMaterial,
  slabGeometry,
  solderFilletGeometry,
  solderMaterial,
} from '../pcb'
import type { PcbArtStyle, PcbPainter } from '../pcb'

type V3 = THREE.Vector3
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const isGhost = (comp: ComponentInstance) => comp.id === '__ghost__'
/** millimetres → plan units */
const mm = (v: number) => v * MM
const PITCH = 2.54
const DEG = Math.PI / 180

// ===========================================================================
// shared toolkit
// ===========================================================================

interface StaticPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

const staticsCache = new Map<string, StaticPart[]>()

/**
 * Merge a design's static parts once (one geometry per material, in the
 * part's own frame) and keep the result for the page lifetime.
 */
function designStatics(key: string, build: () => THREE.Object3D[]): StaticPart[] {
  let s = staticsCache.get(key)
  if (!s) {
    s = mergeStatic(build()).map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
    staticsCache.set(key, s)
  }
  return s
}

function addStatics(group: THREE.Object3D, statics: StaticPart[]): void {
  for (const s of statics) group.add(new THREE.Mesh(s.geometry, s.material))
}

/** Place a (detached) object; returns it for chaining into a parts list. */
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0): T {
  o.position.set(x, y, z)
  if (ry) o.rotation.y = ry
  return o
}

/** Mesh helper: geometry + material at a position. */
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}

/** Box in plan units with its BOTTOM at y (omits the buried bottom face). */
function boxOn(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, bottom = true): THREE.Mesh {
  return mesh(slabGeometry(w, h, d, { bottom }), mat, x, y + h / 2, z)
}

function cylGeo(key: string, rTop: number, rBot: number, h: number, seg: number, open = false): THREE.BufferGeometry {
  return cachedGeometry(`mot-cyl:${key}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open))
}

function metalMat(key: string, color: number, roughness: number, metalness = 1, brushed = false): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`mot-metal:${key}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness })
    const r = brushed ? brushedRoughnessTexture() : null
    if (r) m.roughnessMap = r
    return m
  })
}

/** polished drawn-steel can walls (130 motor, 28BYJ-48) */
const canSteel = () => metalMat('can', 0xbfc4ca, 0.3)
/** satin up-facing steel flats (can ends, flange plates) */
const satinSteel = () => metalMat('satin', 0x9ba0a6, 0.55, 0.6)
/** machined / brushed aluminium (NEMA 17 end caps, heatsinks' bare cuts) */
const aluminium = () => metalMat('alu', 0xc6cacf, 0.42, 0.9, true)
/** ground steel shafts */
const shaftSteel = () => metalMat('shaft', 0xd4d7db, 0.28)
/** brass solder tabs / terminal screws */
const brass = () => metalMat('brass', 0xc8a557, 0.38)
/** zinc-plated screw heads / clamps */
const zinc = () => metalMat('zinc', 0xb9bcc0, 0.45, 0.85)
/** matte tin: IC leads, chip terminations */
const leadTin = () => metalMat('tin', 0x8d9298, 0.68, 0.35)
/** tinned header posts proud of the joints (Blue Pill finish) */
const tinnedPost = () => metalMat('post', 0xd8dce0, 0.7, 0.7)
const blackAnodized = () =>
  cachedMaterial('mot-black-anod', () => new THREE.MeshPhysicalMaterial({ color: 0x18191c, roughness: 0.48, metalness: 0.55 }))
const darkRecess = () =>
  cachedMaterial('mot-recess', () => new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.8, metalness: 0 }))
const icMold = () => qfpMoldMaterial()
const mlcc = () =>
  cachedMaterial('mot-mlcc', () => new THREE.MeshPhysicalMaterial({ color: 0xa88a62, roughness: 0.62, metalness: 0 }))
const chipRes = () =>
  cachedMaterial('mot-chipres', () => new THREE.MeshPhysicalMaterial({ color: 0x16161a, roughness: 0.5, metalness: 0 }))

/** Cached unlit print (pad print / sticker / silkscreen) as a transparent label. Headless → null. */
function printMaterial(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  lit = false,
): THREE.Material | null {
  if (typeof document === 'undefined') return null
  return cachedMaterial(`mot-print:${key}`, () => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, w, h)
      draw(ctx, w, h)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    markShared(tex)
    return lit
      ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0 })
      : new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  })
}

/** A text line for printMaterial: centred at (x, y) fractions of the canvas. */
function textLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 700,
  family = '"Helvetica Neue", Arial, sans-serif',
): void {
  ctx.fillStyle = color
  ctx.font = `${weight} ${Math.round(size * h)}px ${family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x * w, y * h)
}

/** Label quad facing +y (lying on a top face), w along x, d along z. */
function topQuad(w: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(flatQuadGeometry(w, d), mat)
}

/** Label quad facing +z (on a front face), w along x, h along y. */
function frontQuad(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const geo = cachedGeometry(`mot-frontquad:${w.toFixed(4)}x${h.toFixed(4)}`, () => new THREE.PlaneGeometry(w, h))
  return new THREE.Mesh(geo, mat)
}

// ---------------------------------------------------------------------------
// bench leads
// ---------------------------------------------------------------------------

/** height of insulated leads lying on the desk (centerline) */
const DESK_Y = 0.06

/**
 * A light insulated lead (few tube segments, 5-sided): the many-terminal
 * modules would spend the whole triangle budget on legMesh's 44-segment
 * tubes.
 */
function leadTube(points: V3[], radius: number, material: THREE.Material, segments = 12): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(roundedPath(points, 0.22), segments, radius, 4, false), material)
}

/**
 * Lead from a connection point `from` on the part to the bench terminal at
 * `pin` (plan position, any y): leaves `from` along `out` (unit vector,
 * horizontal), drops to the desk, runs to just behind the terminal and
 * rises into a tinned tip whose top is the wire attach point
 * (pin.x, TERMINAL_TOP_Y, pin.z). Pushed into `out`.
 */
function benchLead(
  from: V3,
  dir: V3,
  pin: V3,
  color: number,
  parts: THREE.Object3D[],
  opts: { radius?: number; reach?: number; via?: V3[]; rise?: number } = {},
): void {
  const r = opts.radius ?? 0.055
  const reach = opts.reach ?? 0.35
  const tipBase = TERMINAL_TOP_Y - 0.26
  // a lead leaving a Dupont housing first rises out of its top
  const start = opts.rise ? [from.clone(), V(from.x, from.y + opts.rise, from.z)] : [from.clone()]
  const p1 = start[start.length - 1].clone().addScaledVector(dir, reach)
  const drop = V(p1.x + dir.x * 0.25, DESK_Y, p1.z + dir.z * 0.25)
  const pts: V3[] = [...start, p1, drop, ...(opts.via ?? [])]
  const last = pts[pts.length - 1]
  const behind = V(pin.x, DESK_Y, pin.z - 0.45)
  if (Math.hypot(behind.x - last.x, behind.z - last.z) > 0.05) pts.push(behind)
  pts.push(V(pin.x, DESK_Y + 0.08, pin.z), V(pin.x, tipBase, pin.z))
  const segs = Math.min(16, 6 + Math.round(pts.length * 1.5))
  parts.push(leadTube(pts, r, makeWireMaterial(color), segs))
  // tinned stranded end up to the attach point (open tube: its foot sits in
  // the insulation, its top under the dome)
  const tipGeo = cylGeo(`tip:${r}`, r * 0.8, r * 0.8, 0.28, 6, true)
  parts.push(mesh(tipGeo, metalMat('tinned-end', 0xd8d2c4, 0.42), pin.x, tipBase + 0.13, pin.z))
  const capGeo = cachedGeometry(`mot-tipcap:${r}`, () => {
    const g = new THREE.CircleGeometry(r * 0.8, 6)
    g.rotateX(-Math.PI / 2)
    return g
  })
  parts.push(mesh(capGeo, metalMat('tinned-end', 0xd8d2c4, 0.42), pin.x, tipBase + 0.27, pin.z))
}

/**
 * Anchor (top-left of the part's body rect) from the first terminal and the
 * part's terminal offset (CatalogEntry.offboard; legacy (2, 2)).
 */
function anchorOf(pins: V3[], entry: CatalogEntry): { ax: number; az: number } {
  const p = pins[0] ?? V(0, 0, 0)
  const g = offboardGeometryOf(entry.offboard)
  return { ax: p.x - g.ox, az: p.z - g.oz }
}

/** Off-board pinWorld: the terminal tops. */
function terminalTops(pins: V3[]): V3[] {
  return pins.map((p) => V(p.x, TERMINAL_TOP_Y, p.z))
}

// ---------------------------------------------------------------------------
// LED lens + glow (Blue Pill rig: emissive lens + additive sprite, never a light)
// ---------------------------------------------------------------------------

interface LedRig {
  lens: THREE.MeshPhysicalMaterial | null
  /** the shared LED glow halo (led-look.ts), null on a ghost */
  halo: LedHaloRig | null
  /** the unlit lens tint */
  tint: number
}

const LED_LENS_TINT = 0xf4d2cc

function ledRig(parent: THREE.Object3D, geo: THREE.BufferGeometry, pos: V3, ghost: boolean, glowScale: number): LedRig {
  if (ghost) {
    parent.add(
      mesh(
        geo,
        cachedMaterial('mot-led-lens', () => new THREE.MeshPhysicalMaterial({ color: LED_LENS_TINT, roughness: 0.3, metalness: 0 })),
        pos.x,
        pos.y,
        pos.z,
      ),
    )
    return { lens: null, halo: null, tint: LED_LENS_TINT }
  }
  const lens = new THREE.MeshPhysicalMaterial({
    color: LED_LENS_TINT,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
    emissive: new THREE.Color(LED_COLORS.red),
    emissiveIntensity: 0,
  })
  parent.add(mesh(geo, lens, pos.x, pos.y, pos.z))
  // the shared glow halo (led-look.ts), above the lens like the Blue Pill's
  // (sized to the bench module's scale)
  const halo = makeLedHalo({ color: LED_COLORS.red, at: new THREE.Vector3(pos.x, pos.y + mm(1.2), pos.z), size: (SMD_GLOW_SIZE * glowScale) / 1.1, onBoard: true })
  parent.add(halo.halo)
  return { lens, halo, tint: LED_LENS_TINT }
}

/**
 * The indicator's REAL current / 20 mA (its sub-circuit LED; a snapshot
 * with only the engine's 0..1 ledBrightness = I / 10 mA falls back to
 * half of it) in the one brightness language of every LED (led-look.ts).
 */
function applyLed(rig: LedRig, light: number | undefined): void {
  if (!rig.lens) return
  applyIndicator(rig as LedRig & { lens: THREE.MeshPhysicalMaterial }, ledPerceived(Math.min(1.6, Math.max(0, light ?? 0))))
}

/** relative intensity of a module's indicator LED `LED_<n>` (I / 20 mA) */
function moduleLedLight(t: ComponentTelemetry | null, n: string): number {
  const sub = t?.sub?.[`LED_${n}`]
  if (sub) return lightOf(sub)
  const b = t?.leds?.[n]
  return typeof b === 'number' ? Math.max(0, b) * 0.5 : 0
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

// ---------------------------------------------------------------------------
// rotation indicator disc (DC motor, NEMA 17): white disc + red sector, and
// a motion-blur disc shown instead above ~600 rpm (a sampled angle at frame
// rate would strobe)
// ---------------------------------------------------------------------------

const BLUR_RPM = 600

interface Spinner {
  rotor: THREE.Group
  sharp: THREE.Object3D[]
  blur: THREE.Object3D | null
}

/**
 * Indicator disc in the y-z plane (axis = local +x), radius r, thickness t
 * (plan units), centred on the rotor origin. Shared geometry/materials.
 */
function indicatorDisc(rotor: THREE.Group, key: string, r: number, t: number, ghost: boolean): Spinner {
  const white = plastic(0xf1f0ea, 0.5)
  const red = plastic(0xd8261e, 0.45)
  const disc = new THREE.Mesh(
    cachedGeometry(`mot-disc:${key}`, () => {
      const g = new THREE.CylinderGeometry(r, r, t, 28)
      g.rotateZ(Math.PI / 2)
      return g
    }),
    white,
  )
  rotor.add(disc)
  // red sector (90°) on both faces, a hair proud
  const sectorGeo = cachedGeometry(`mot-sector:${key}`, () => {
    const g = new THREE.CircleGeometry(r * 0.97, 8, -Math.PI / 4, Math.PI / 2)
    g.rotateY(Math.PI / 2) // face +x
    return g
  })
  const sharp: THREE.Object3D[] = []
  for (const s of [1, -1]) {
    // the back face is the mirror image (scale.x = −1 flips the facing and
    // keeps the sector at the same angle; three flips the cull side)
    const sec = new THREE.Mesh(sectorGeo, red)
    sec.position.x = s * (t / 2 + 0.01)
    sec.scale.x = s
    rotor.add(sec)
    sharp.push(sec)
  }
  let blur: THREE.Object3D | null = null
  if (!ghost) {
    // a spinning 90° red sector reads as a pale pink disc
    const blurMat = cachedMaterial('mot-disc-blur', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xe9a29b, roughness: 0.5, metalness: 0 }),
    )
    const b = new THREE.Group()
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(
        cachedGeometry(`mot-blur:${key}`, () => {
          const g = new THREE.RingGeometry(r * 0.3, r * 0.97, 28)
          g.rotateY(Math.PI / 2)
          return g
        }),
        blurMat,
      )
      m.position.x = s * (t / 2 + 0.012)
      m.scale.x = s
      b.add(m)
    }
    b.visible = false
    rotor.add(b)
    blur = b
  }
  return { rotor, sharp, blur }
}

function spin(sp: Spinner, angleDeg: number, rpm: number): void {
  // + angle = clockwise looking at the shaft end (from +x toward −x)
  sp.rotor.rotation.x = -angleDeg * DEG
  const fast = Math.abs(rpm) > BLUR_RPM && !!sp.blur
  for (const s of sp.sharp) s.visible = !fast
  if (sp.blur) sp.blur.visible = fast
}

// ===========================================================================
// 130-size DC motor (off-board) — local frame: x = shaft axis (+x = shaft),
// y up from the desk, z toward the viewer; origin on the desk under the
// can's centre. Real mm, then scaled by DC_S.
// ===========================================================================

const DC_S = 0.43
/** can: Ø20.1 mm with flats 15.1 mm apart (lying on a flat) */
const DC_R = 10.05
const DC_FLAT = 7.55
const DC_AXIS_Y = DC_FLAT
const DC_CAN_X0 = -10
const DC_CAN_X1 = 11
const DC_BELL_X0 = -14
const DC_SHAFT_X1 = 20.5
const DC_DISC_X = 17.2
const DC_DISC_R = 7.15
/**
 * the motor centre sits this far right of the anchor (keeps tabs → disc
 * inside the rect; the part's rect — motors.parts.ts `offboard`, terminal 0
 * at anchor + 2.5 — starts 0.5 left of the legacy one so the leads curling
 * off the solder tabs stay inside it too)
 */
const DC_CX = 0.6 + 16.5 * DC_S * MM
const DC_CZ = -0.3

/** Obround can cross-section (circle Ø2R clipped by flats at ±f), in the (z, y) plane. */
function obroundShape(r: number, f: number): THREE.Shape {
  const a = Math.asin(f / r)
  const s = new THREE.Shape()
  const zf = r * Math.cos(a)
  s.moveTo(zf, f)
  s.lineTo(-zf, f)
  s.absarc(0, 0, r, Math.PI - a, Math.PI + a, false)
  s.lineTo(zf, -f)
  s.absarc(0, 0, r, -a, a, false)
  return s
}

/** Extrude a (z, y)-plane profile along +x from x0 to x1, plan units. */
function extrudeAlongX(key: string, shape: () => THREE.Shape, x0: number, x1: number, curveSegments = 8): THREE.BufferGeometry {
  return cachedGeometry(`mot-extx:${key}`, () => {
    const g = new THREE.ExtrudeGeometry(shape(), { depth: x1 - x0, bevelEnabled: false, curveSegments })
    // shape x → world z, shape y → world y, extrusion (+z) → world +x
    g.rotateY(Math.PI / 2)
    g.translate(x0, 0, 0)
    return g
  })
}

function dcMotorStatics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(DC_S)
  const k = MM
  const parts: THREE.Object3D[] = []
  // steel can (axis at DC_AXIS_Y)
  const can = new THREE.Mesh(
    extrudeAlongX('dc-can', () => scaleShape(obroundShape(DC_R, DC_FLAT), k), DC_CAN_X0 * k, DC_CAN_X1 * k, 10),
    canSteel(),
  )
  can.position.y = DC_AXIS_Y * k
  parts.push(can)
  // two stamped vent windows on each flat side + the magnet crimp lines (dark)
  for (const zs of [-1, 1]) {
    parts.push(mesh(slabGeometry(mm(4.2), mm(0.06), mm(1.4)), darkRecess(), mm(-3.5), (DC_AXIS_Y + DC_FLAT + 0.02) * k, zs * mm(3.6)))
  }
  // plastic end bell with the brush holder boss
  const bell = new THREE.Mesh(
    extrudeAlongX('dc-bell', () => scaleShape(obroundShape(DC_R - 0.25, DC_FLAT - 0.2), k), DC_BELL_X0 * k, DC_CAN_X0 * k, 10),
    plastic(0xe9e5da, 0.55),
  )
  bell.position.y = DC_AXIS_Y * k
  parts.push(bell)
  parts.push(
    mesh(
      cachedGeometry('mot-dc-bellboss', () => {
        const g = new THREE.CylinderGeometry(mm(3.4), mm(3.6), mm(1.4), 16)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      plastic(0xe9e5da, 0.55),
      mm(DC_BELL_X0 - 0.7),
      mm(DC_AXIS_Y),
      0,
    ),
  )
  // brass solder tabs (with their holes painted dark) on both sides of the bell
  for (const zs of [-1, 1]) {
    const tab = boxOn(mm(2.6), mm(3.2), mm(0.35), brass(), mm(DC_BELL_X0 - 1.1), mm(DC_AXIS_Y + 0.6), zs * mm(6.2))
    parts.push(tab)
    parts.push(mesh(slabGeometry(mm(1.0), mm(1.0), mm(0.37)), darkRecess(), mm(DC_BELL_X0 - 1.5), mm(DC_AXIS_Y + 2.6), zs * mm(6.2)))
  }
  // red polarity dot by the + tab (front, +z)
  parts.push(
    mesh(
      cachedGeometry('mot-dc-dot', () => {
        const g = new THREE.CircleGeometry(mm(0.9), 10)
        g.rotateY(-Math.PI / 2)
        return g
      }),
      plastic(0xd0241c, 0.5),
      mm(DC_BELL_X0 - 0.02),
      mm(DC_AXIS_Y + 3.6),
      mm(4.2),
    ),
  )
  // front: bearing boss + shaft
  parts.push(
    mesh(
      cachedGeometry('mot-dc-boss', () => {
        const g = new THREE.CylinderGeometry(mm(3.1), mm(3.1), mm(1.6), 18)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      satinSteel(),
      mm(DC_CAN_X1 + 0.8),
      mm(DC_AXIS_Y),
      0,
    ),
  )
  parts.push(
    mesh(
      cachedGeometry('mot-dc-shaft', () => {
        const g = new THREE.CylinderGeometry(mm(1.0), mm(1.0), mm(DC_SHAFT_X1 - DC_CAN_X1), 10)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      shaftSteel(),
      mm((DC_CAN_X1 + DC_SHAFT_X1) / 2),
      mm(DC_AXIS_Y),
      0,
    ),
  )
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(DC_CX, 0, DC_CZ)
  frame.add(body)
  return [frame]
}

/** Uniformly scale a shape's points (shapes are authored in mm). */
function scaleShape(s: THREE.Shape, k: number): THREE.Shape {
  const pts = s.getPoints(12).map((p) => new THREE.Vector2(p.x * k, p.y * k))
  return new THREE.Shape(pts)
}

function buildDcMotor(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('dc-motor', dcMotorStatics))
  // rotor: hub + indicator disc on the shaft (per-instance pose)
  const live = new THREE.Group()
  live.position.set(DC_CX, 0, DC_CZ)
  live.scale.setScalar(DC_S)
  anchor.add(live)
  const rotor = new THREE.Group()
  rotor.position.set(mm(DC_DISC_X), mm(DC_AXIS_Y), 0)
  live.add(rotor)
  rotor.add(
    new THREE.Mesh(
      cachedGeometry('mot-dc-hub', () => {
        const g = new THREE.CylinderGeometry(mm(2.2), mm(2.2), mm(3.2), 12)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      plastic(0xd8261e, 0.45),
    ),
  )
  const spinner = indicatorDisc(rotor, 'dc', mm(DC_DISC_R), mm(0.9), ghost)

  // red / black leads from the solder tabs to the two terminals
  const leads: THREE.Object3D[] = []
  const toWorld = (x: number, y: number, z: number) => V(ax + DC_CX + mm(x) * DC_S, mm(y) * DC_S, az + DC_CZ + mm(z) * DC_S)
  const tabFront = toWorld(DC_BELL_X0 - 2.3, DC_AXIS_Y + 2.4, 6.2)
  const tabBack = toWorld(DC_BELL_X0 - 2.3, DC_AXIS_Y + 2.4, -6.2)
  if (pins[0]) benchLead(tabFront, V(-1, 0, 0), pins[0], 0xc62828, leads, { reach: 0.25, via: [V(tabFront.x - 0.4, DESK_Y, pins[0].z - 0.9)] })
  if (pins[1]) {
    benchLead(tabBack, V(-1, 0, 0), pins[1], 0x1d1d1f, leads, {
      reach: 0.25,
      via: [V(tabBack.x - 0.55, DESK_Y, pins[1].z - 0.6), V(pins[1].x - 1.2, DESK_Y, pins[1].z - 0.45)],
    })
  }
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (t: ComponentTelemetry | null) => {
    const v = t?.values
    spin(spinner, num(v?.angle, 0), num(v?.rpm, 0))
  }
  pose(null)
  return { object: group, pinWorld: terminalTops(pins), update: (_c, _e, t) => pose(t) }
}

// ===========================================================================
// SG90 micro servo (off-board), standing; local mm: x along the case (the
// output shaft at +x), y up, z toward the viewer.
// ===========================================================================

const SG_S = 0.32
const SG_L = 22.5
const SG_D = 11.8
const SG_H = 22.7
const SG_SHAFT_X = SG_L / 2 - 5.9
const SG_HORN_Y = 29.6
const SG_CZ = -0.35

function sg90Statics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(SG_S)
  const blue = cachedMaterial('mot-sg90-case', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x2f63c9, roughness: 0.32, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
  )
  const parts: THREE.Object3D[] = []
  // main case (lower shell + upper shell share the colour; seam at the ears)
  parts.push(
    mesh(
      cachedGeometry('mot-sg90-case', () => new RoundedBoxGeometry(mm(SG_L), mm(SG_H), mm(SG_D), 2, mm(0.8))),
      blue,
      0,
      mm(SG_H / 2),
      0,
    ),
  )
  // mounting ears with their screw slots (dark)
  for (const s of [-1, 1]) {
    parts.push(
      mesh(
        cachedGeometry('mot-sg90-ear', () => new RoundedBoxGeometry(mm(5.2), mm(2.5), mm(SG_D), 1, mm(0.5))),
        blue,
        s * mm(SG_L / 2 + 2.4),
        mm(16.4),
        0,
      ),
    )
    parts.push(mesh(cylGeo('sg90-ear-hole', mm(1.0), mm(1.0), mm(2.56), 10), darkRecess(), s * mm(SG_L / 2 + 2.9), mm(16.4), 0))
  }
  // seam groove around the case just under the ears
  parts.push(mesh(slabGeometry(mm(SG_L + 0.05), mm(0.25), mm(SG_D + 0.05)), cachedMaterial('mot-sg90-seam', () => new THREE.MeshPhysicalMaterial({ color: 0x1d3f86, roughness: 0.5, metalness: 0 })), 0, mm(15.0), 0))
  // gear housing: boss around the output shaft + the small second bump
  parts.push(mesh(cylGeo('sg90-boss', mm(5.9), mm(5.9), mm(4.0), 24), blue, mm(SG_SHAFT_X), mm(SG_H + 2.0), 0))
  parts.push(mesh(cylGeo('sg90-bump', mm(2.9), mm(2.9), mm(2.0), 16), blue, mm(SG_SHAFT_X - 8.0), mm(SG_H + 1.0), 0))
  // output spline (white nylon)
  parts.push(mesh(cylGeo('sg90-spline', mm(2.4), mm(2.4), mm(3.0), 14), plastic(0xf0efe9, 0.5), mm(SG_SHAFT_X), mm(SG_H + 5.5), 0))
  // cable exit (strain relief) at the bottom of the −x end
  parts.push(boxOn(mm(1.6), mm(2.6), mm(4.6), plastic(0x234e9f, 0.4), mm(-SG_L / 2 - 0.6), mm(1.0), 0))
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(3.25, 0, SG_CZ)
  frame.add(body)
  return [frame]
}

/** single-arm horn, axis at the origin, arm along +x (white nylon) */
function sg90HornGeometry(): THREE.BufferGeometry {
  return cachedGeometry('mot-sg90-horn', () => {
    const s = new THREE.Shape()
    const rHub = mm(3.6)
    const rTip = mm(2.0)
    const L = mm(15.5)
    s.absarc(0, 0, rHub, Math.PI / 2, (3 * Math.PI) / 2, false)
    s.lineTo(L, -rTip)
    s.absarc(L, 0, rTip, -Math.PI / 2, Math.PI / 2, false)
    s.lineTo(0, rHub)
    const g = new THREE.ExtrudeGeometry(s, { depth: mm(1.8), bevelEnabled: false, curveSegments: 6 })
    g.rotateX(-Math.PI / 2) // shape y → −z, extrusion → +y
    return g
  })
}

function buildSg90(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('sg90', sg90Statics))
  const live = new THREE.Group()
  live.position.set(3.25, 0, SG_CZ)
  live.scale.setScalar(SG_S)
  anchor.add(live)
  const horn = new THREE.Group()
  horn.position.set(mm(SG_SHAFT_X), mm(SG_HORN_Y), 0)
  live.add(horn)
  const white = plastic(0xf2f1ec, 0.5)
  horn.add(new THREE.Mesh(sg90HornGeometry(), white))
  // horn holes along the arm + the hub screw
  for (const d of [7.0, 9.5, 12.0, 14.5]) horn.add(mesh(cylGeo('sg90-hornhole', mm(0.5), mm(0.5), mm(0.06), 8), darkRecess(), mm(d), mm(1.83), 0))
  horn.add(mesh(cylGeo('sg90-screw', mm(1.3), mm(1.3), mm(0.4), 12), zinc(), 0, mm(1.95), 0))
  if (!ghost) {
    const label = printMaterial('sg90-side', 512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#16181d'
      ctx.fillRect(w * 0.04, h * 0.08, w * 0.92, h * 0.84)
      textLine(ctx, w, h, 'TowerPro', 0.5, 0.27, 0.2, '#e9e9e9', 800)
      textLine(ctx, w, h, 'MICRO SERVO 99', 0.5, 0.5, 0.15, '#d7d7d7', 700)
      textLine(ctx, w, h, 'SG90  9g', 0.5, 0.74, 0.2, '#f2f2f2', 800)
    }, true)
    if (label) {
      const q = frontQuad(mm(17), mm(8.5), label)
      q.position.set(0, mm(7.0), mm(SG_D / 2) + 0.02)
      live.add(q)
    }
  }

  // brown / red / orange ribbon from the cable exit to GND, VCC, SIG
  const leads: THREE.Object3D[] = []
  const exitX = ax + 3.25 + mm(-SG_L / 2 - 1.4) * SG_S
  const colors = [0x6b3a1e, 0xc62828, 0xf08a1c]
  pins.slice(0, 3).forEach((pin, i) => {
    const from = V(exitX, mm(2.3) * SG_S, az + SG_CZ + mm((i - 1) * 1.1) * SG_S)
    benchLead(from, V(-1, 0, 0), pin, colors[i], leads, {
      radius: 0.045,
      reach: 0.2,
      via: [V(exitX - 0.45 - 0.08 * i, DESK_Y, az + SG_CZ + 0.9 + 0.12 * i)],
    })
  })
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (t: ComponentTelemetry | null) => {
    const a = THREE.MathUtils.clamp(num(t?.values?.angle, 90), -5, 185)
    // 0° = arm toward −x, 90° = toward the viewer (+z), 180° = toward +x
    horn.rotation.y = Math.PI + a * DEG
  }
  pose(null)
  return { object: group, pinWorld: terminalTops(pins), update: (_c, _e, t) => pose(t) }
}

// ===========================================================================
// 28BYJ-48 geared stepper (off-board), shaft up; local mm: can centre on the
// desk, the blue wire cover toward the viewer (+z), the off-centre output
// shaft toward the back.
// ===========================================================================

const BYJ_S = 0.33
const BYJ_R = 14
const BYJ_H = 19
const BYJ_SHAFT_Z = -8
const BYJ_CZ = -1.3

function byjStatics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(BYJ_S)
  const parts: THREE.Object3D[] = []
  // drawn steel can (walls polished); its top is the flange plate
  parts.push(mesh(cylGeo('byj-can', mm(BYJ_R), mm(BYJ_R), mm(BYJ_H), 32, true), canSteel(), 0, mm(BYJ_H / 2), 0))
  // stamped top plate: the Ø28 lid with the two ears (42 mm over the ear
  // ends, Ø4.2 holes 35 mm apart)
  const flangeGeo = cachedGeometry('mot-byj-flange', () => {
    const r = mm(BYJ_R)
    const e = mm(3.5)
    const L = mm(17.5)
    const xi = Math.sqrt(r * r - e * e)
    const b = Math.asin(e / r)
    const s = new THREE.Shape()
    s.moveTo(xi, e)
    s.lineTo(L, e)
    s.absarc(L, 0, e, Math.PI / 2, -Math.PI / 2, true)
    s.lineTo(xi, -e)
    s.absarc(0, 0, r, -b, -Math.PI + b, true)
    s.lineTo(-L, -e)
    s.absarc(-L, 0, e, -Math.PI / 2, (-3 * Math.PI) / 2, true)
    s.lineTo(-xi, e)
    s.absarc(0, 0, r, Math.PI - b, b, true)
    for (const sx of [-1, 1]) {
      const h = new THREE.Path()
      h.absarc(sx * L, 0, mm(2.1), 0, Math.PI * 2, false)
      s.holes.push(h)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: mm(0.8), bevelEnabled: false, curveSegments: 8 })
    g.rotateX(-Math.PI / 2)
    return g
  })
  parts.push(mesh(flangeGeo, satinSteel(), 0, mm(BYJ_H - 0.6), 0))
  // gearbox cover boss + output shaft (two flats) on the back
  parts.push(mesh(cylGeo('byj-boss', mm(4.6), mm(4.8), mm(1.6), 18), satinSteel(), 0, mm(BYJ_H + 0.8), mm(BYJ_SHAFT_Z)))
  parts.push(
    mesh(
      cachedGeometry('mot-byj-shaft', () => {
        // Ø5 shaft with two flats 3 mm apart
        const s = new THREE.Shape()
        const r = mm(2.5)
        const f = mm(1.5)
        const b = Math.asin(f / r)
        const c = r * Math.cos(b)
        s.moveTo(c, -f)
        s.absarc(0, 0, r, -b, b, false)
        s.lineTo(-c, f)
        s.absarc(0, 0, r, Math.PI - b, Math.PI + b, false)
        s.lineTo(c, -f)
        const g = new THREE.ExtrudeGeometry(s, { depth: mm(8.5), bevelEnabled: false, curveSegments: 4 })
        g.rotateX(-Math.PI / 2)
        return g
      }),
      metalMat('byj-shaft', 0xcfc4a2, 0.32),
      0,
      mm(BYJ_H + 1.6),
      mm(BYJ_SHAFT_Z),
    ),
  )
  // blue plastic wire cover on the front, with its moulded rib
  const blue = cachedMaterial('mot-byj-cover', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x2c58c4, roughness: 0.42, metalness: 0, clearcoat: 0.2 }),
  )
  parts.push(
    mesh(
      cachedGeometry('mot-byj-cover', () => new RoundedBoxGeometry(mm(17), mm(16), mm(9.5), 2, mm(0.8))),
      blue,
      0,
      mm(8.6),
      mm(BYJ_R + 0.4),
    ),
  )
  parts.push(boxOn(mm(12), mm(1.0), mm(2.0), blue, 0, mm(16.4), mm(BYJ_R + 3.3)))
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(3.25, 0, BYJ_CZ)
  frame.add(body)
  return [frame]
}

/** flat red pointer (arrow) at the origin pointing +x, 2 mm thick */
function pointerGeometry(): THREE.BufferGeometry {
  return cachedGeometry('mot-pointer', () => {
    const s = new THREE.Shape()
    const w = mm(1.8)
    s.moveTo(-mm(4), -w)
    s.lineTo(mm(8.5), -w)
    s.lineTo(mm(8.5), -mm(3.0))
    s.lineTo(mm(13), 0)
    s.lineTo(mm(8.5), mm(3.0))
    s.lineTo(mm(8.5), w)
    s.lineTo(-mm(4), w)
    s.lineTo(-mm(4), -w)
    const g = new THREE.ExtrudeGeometry(s, { depth: mm(2), bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  })
}

function buildByj48(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('byj48', byjStatics))
  const live = new THREE.Group()
  live.position.set(3.25, 0, BYJ_CZ)
  live.scale.setScalar(BYJ_S)
  anchor.add(live)
  const pointer = new THREE.Group()
  pointer.position.set(0, mm(BYJ_H + 7.8), mm(BYJ_SHAFT_Z))
  live.add(pointer)
  pointer.add(new THREE.Mesh(pointerGeometry(), plastic(0xd8261e, 0.45)))
  if (!ghost) {
    const sticker = printMaterial('byj-top', 512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#e9e7e0'
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2)
      ctx.fill()
      textLine(ctx, w, h, '28BYJ-48', 0.5, 0.58, 0.12, '#1d2a6b', 800)
      textLine(ctx, w, h, '5V DC', 0.5, 0.72, 0.1, '#1d2a6b', 700)
      textLine(ctx, w, h, fakeLotCode('28BYJ48'), 0.5, 0.84, 0.065, '#555', 600)
    }, true)
    if (sticker) {
      const q = topQuad(mm(18), mm(18), sticker)
      q.position.set(0, mm(BYJ_H + 0.2) + 0.02, mm(3.0))
      live.add(q)
    }
  }
  // five leads out of the cover's bottom edge: ORANGE YELLOW PINK BLUE RED
  const leads: THREE.Object3D[] = []
  const colors = [0xf08a1c, 0xf2cf1d, 0xf28cb2, 0x2c62d6, 0xc62828]
  pins.slice(0, 5).forEach((pin, i) => {
    const from = V(ax + 3.25 + mm((i - 2) * 1.6) * BYJ_S, mm(2.2) * BYJ_S, az + BYJ_CZ + mm(BYJ_R + 5.0) * BYJ_S)
    benchLead(from, V(0, 0, 1), pin, colors[i], leads, { radius: 0.045, reach: 0.12 })
  })
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (t: ComponentTelemetry | null) => {
    // + = clockwise looking down at the shaft
    // 0° = toward the viewer (+z)
    pointer.rotation.y = -Math.PI / 2 - num(t?.values?.angle, 0) * DEG
  }
  pose(null)
  return { object: group, pinWorld: terminalTops(pins), update: (_c, _e, t) => pose(t) }
}

// ===========================================================================
// NEMA 17 (17HS4401) lying on its side, shaft toward +x; local mm: origin on
// the desk under the motor's mid-length, axis at NEMA_AXIS.
// ===========================================================================

const NEMA_S = 0.24
const NEMA_A = 42.3
const NEMA_AXIS = NEMA_A / 2
const NEMA_CX = 0.15 + 20 * NEMA_S * MM
const NEMA_CZ = -0.45
const NEMA_DISC_X = 40
const NEMA_DISC_R = 18

function chamferedSquare(a: number, c: number): THREE.Shape {
  const h = a / 2
  const s = new THREE.Shape()
  s.moveTo(-h + c, -h)
  s.lineTo(h - c, -h)
  s.lineTo(h, -h + c)
  s.lineTo(h, h - c)
  s.lineTo(h - c, h)
  s.lineTo(-h + c, h)
  s.lineTo(-h, h - c)
  s.lineTo(-h, -h + c)
  s.lineTo(-h + c, -h)
  return s
}

function nemaStatics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(NEMA_S)
  const k = MM
  const parts: THREE.Object3D[] = []
  const caps = aluminium()
  const stackMat = cachedMaterial('mot-nema-stack', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.55, metalness: 0.35 }),
  )
  const capShape = () => scaleShape(chamferedSquare(NEMA_A, 4.5), k)
  for (const [x0, x1] of [
    [-20, -12],
    [12, 20],
  ] as const) {
    const cap = new THREE.Mesh(extrudeAlongX(`nema-cap:${x0}`, capShape, x0 * k, x1 * k, 1), caps)
    cap.position.y = NEMA_AXIS * k
    parts.push(cap)
  }
  // stator stack (slightly inset) with lamination grooves
  const stack = new THREE.Mesh(extrudeAlongX('nema-stack', () => scaleShape(chamferedSquare(NEMA_A - 0.6, 4.8), k), -12 * k, 12 * k, 1), stackMat)
  stack.position.y = NEMA_AXIS * k
  parts.push(stack)
  for (const x of [-8, -4, 0, 4, 8]) {
    parts.push(mesh(slabGeometry(mm(0.35), mm(0.08), mm(NEMA_A - 10)), darkRecess(), mm(x), mm(NEMA_A - 0.28), 0))
  }
  // front: pilot boss Ø22, four screw heads in the corners
  parts.push(
    mesh(
      cachedGeometry('mot-nema-boss', () => {
        const g = new THREE.CylinderGeometry(mm(11), mm(11), mm(2), 28)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      caps,
      mm(21),
      mm(NEMA_AXIS),
      0,
    ),
  )
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        mesh(
          cachedGeometry('mot-nema-screw', () => {
            const g = new THREE.CylinderGeometry(mm(2.6), mm(2.6), mm(0.6), 10)
            g.rotateZ(Math.PI / 2)
            return g
          }),
          darkRecess(),
          mm(20.3),
          mm(NEMA_AXIS + sy * 15.5),
          sz * mm(15.5),
        ),
      )
    }
  }
  // D-cut shaft Ø5 × 24
  parts.push(
    mesh(
      cachedGeometry('mot-nema-shaft', () => {
        const g = new THREE.CylinderGeometry(mm(2.5), mm(2.5), mm(24), 12)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      shaftSteel(),
      mm(34),
      mm(NEMA_AXIS),
      0,
    ),
  )
  // 6-pin JST-PH socket on the rear cap, facing the viewer
  parts.push(boxOn(mm(12.5), mm(5.5), mm(4.5), plastic(0xf1eee4, 0.55), mm(-13.5), mm(NEMA_AXIS - 5.5), mm(NEMA_A / 2 + 1.6)))
  parts.push(mesh(slabGeometry(mm(10.5), mm(2.6), mm(0.1)), darkRecess(), mm(-13.5), mm(NEMA_AXIS - 2.75), mm(NEMA_A / 2 + 3.86)))
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(NEMA_CX, 0, NEMA_CZ)
  frame.add(body)
  return [frame]
}

function buildNema17(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('nema17', nemaStatics))
  const live = new THREE.Group()
  live.position.set(NEMA_CX, 0, NEMA_CZ)
  live.scale.setScalar(NEMA_S)
  anchor.add(live)
  const rotor = new THREE.Group()
  rotor.position.set(mm(NEMA_DISC_X), mm(NEMA_AXIS), 0)
  live.add(rotor)
  rotor.add(
    new THREE.Mesh(
      cachedGeometry('mot-nema-hub', () => {
        const g = new THREE.CylinderGeometry(mm(5), mm(5), mm(6), 14)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      aluminium(),
    ),
  )
  const spinner = indicatorDisc(rotor, 'nema', mm(NEMA_DISC_R), mm(1.6), ghost)
  if (!ghost) {
    const label = printMaterial('nema-top', 512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#e8e6df'
      ctx.fillRect(0, 0, w, h)
      textLine(ctx, w, h, '17HS4401', 0.5, 0.3, 0.26, '#141414', 800)
      textLine(ctx, w, h, '1.8° 1.7A', 0.5, 0.62, 0.2, '#222', 700)
      textLine(ctx, w, h, fakeLotCode('17HS4401'), 0.5, 0.85, 0.12, '#555', 600)
    }, true)
    if (label) {
      const q = topQuad(mm(20), mm(10), label)
      q.position.set(0, mm(NEMA_A) + 0.02, 0)
      live.add(q)
    }
  }
  // black / green / red / blue leads out of the JST socket
  const leads: THREE.Object3D[] = []
  const colors = [0x1d1d1f, 0x2e9b45, 0xc62828, 0x2c62d6]
  pins.slice(0, 4).forEach((pin, i) => {
    const from = V(ax + NEMA_CX + mm(-13.5 + (i - 1.5) * 2) * NEMA_S, mm(NEMA_AXIS - 3) * NEMA_S, az + NEMA_CZ + mm(NEMA_A / 2 + 3.9) * NEMA_S)
    benchLead(from, V(0, 0, 1), pin, colors[i], leads, { radius: 0.045, reach: 0.1 })
  })
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (t: ComponentTelemetry | null) => {
    const v = t?.values
    spin(spinner, num(v?.angle, 0), num(v?.rpm, 0))
  }
  pose(null)
  return { object: group, pinWorld: terminalTops(pins), update: (_c, _e, t) => pose(t) }
}

// ===========================================================================
// PCB module toolkit (local frames in plan units at real size)
// ===========================================================================

const EDGE_CHAMFER = 0.15

/** Board slab: art top, routed edge, plain-mask bottom; PCB bottom at yBot. */
function pcbSlab(parts: THREE.Object3D[], wMm: number, dMm: number, tMm: number, art: THREE.Material, maskColor: number, yBot: number, x = 0, z = 0): void {
  const top = new THREE.Mesh(boardTopGeometry(wMm, dMm, EDGE_CHAMFER), art)
  top.position.set(x, yBot + mm(tMm), z)
  parts.push(top)
  const edges = boardEdgeGeometries(wMm, dMm, tMm, EDGE_CHAMFER)
  parts.push(mesh(edges.fr4, fr4EdgeMaterial(), x, yBot, z))
  parts.push(mesh(edges.mask, maskMaterial(maskColor), x, yBot, z))
  const bottom = new THREE.Mesh(flatQuadGeometry(mm(wMm), mm(dMm)), maskMaterial(maskColor))
  bottom.rotation.x = Math.PI
  bottom.position.set(x, yBot, z)
  parts.push(bottom)
}

/** Mounting hole: tinned ring + dark drill (painted). */
function paintMountHole(p: PcbPainter, x: number, z: number, r = 1.6): void {
  p.padCircle(x, z, r + 0.7)
  p.via(x, z, r)
}

/** SMD IC body (mold) + lead rows along its long sides; long axis local x, turned `ry`. */
function soic(parts: THREE.Object3D[], key: string, x: number, y: number, z: number, lenMm: number, widMm: number, hMm: number, perSide: number, pitchMm: number, ry = 0): void {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  g.rotation.y = ry
  g.add(
    mesh(
      cachedGeometry(`mot-soic:${key}`, () => new RoundedBoxGeometry(mm(lenMm), mm(hMm), mm(widMm), 1, mm(0.15))),
      icMold(),
      0,
      mm(hMm / 2 + 0.1),
      0,
    ),
  )
  const leadGeo = slabGeometry(mm(pitchMm * 0.45), mm(0.2), mm(1.0), { bottom: true })
  for (let i = 0; i < perSide; i++) {
    const lx = mm((i - (perSide - 1) / 2) * pitchMm)
    for (const s of [-1, 1]) g.add(mesh(leadGeo, leadTin(), lx, mm(0.1), s * mm(widMm / 2 + 0.45)))
  }
  parts.push(g)
}

/** 0603/0805/1206 chip part at (x, z) on the PCB top `y`, rotated `ry`. */
function chipPart(parts: THREE.Object3D[], body: THREE.Material, x: number, y: number, z: number, ry = 0, scale = 1, h = 0.8): void {
  const g = new THREE.Group()
  for (const o of chip0603(body, leadTin(), h)) g.add(o)
  g.scale.setScalar(scale)
  g.rotation.y = ry
  g.position.set(x, y, z)
  parts.push(g)
}

/**
 * Two header rows of a breadboard carrier (board frame: row 1 = pins 0..n−1
 * at +zRow, row 2 = pins n..2n−1 at −zRow, both left → right): black spacer
 * strips under the PCB, chamfered post tips + fillets above it.
 */
function carrierHeaders(parts: THREE.Object3D[], n: number, zRowMm: number, ySpacer: number, yTop: number): void {
  const stripGeo = slabGeometry(mm(n * PITCH) - 0.004, ySpacer - 0.004, mm(2.5), { top: true, bottom: true })
  for (const s of [-1, 1]) parts.push(mesh(stripGeo, headerPlasticMaterial(), 0, ySpacer / 2 + 0.002, s * mm(zRowMm)))
  const tipGeo = headerPostGeometry(mm(0.32), mm(1.4), mm(0.16))
  const filletGeo = solderFilletGeometry(mm(0.8), mm(0.36), mm(0.55))
  for (let k = 0; k < n; k++) {
    const x = mm((k - (n - 1) / 2) * PITCH)
    for (const s of [-1, 1]) {
      parts.push(mesh(tipGeo, tinnedPost(), x, yTop, s * mm(zRowMm)))
      parts.push(mesh(filletGeo, solderMaterial(), x, yTop + 0.002, s * mm(zRowMm)))
    }
  }
}

/** Header pads + silkscreen pin labels (row 1 labels below the row, row 2 above). */
function paintCarrierPins(p: PcbPainter, labels: string[], n: number, zRowMm: number, inside: boolean, sizeMm = 0.85): void {
  const silk = { weight: 400, stroke: 0.04, condense: 0.86 }
  labels.forEach((text, i) => {
    const row = i < n ? 1 : -1
    const k = i < n ? i : i - n
    const x = (k - (n - 1) / 2) * PITCH
    const z = row * zRowMm
    if (i === 0) p.padRect(x, z, 1.6, 1.6)
    else p.padCircle(x, z, 0.8)
    const dz = (inside ? -row : row) * 1.55
    p.silkText(text, x, z + dz, sizeMm, silk)
  })
}

/** Frame of a two-row carrier from where its pins really are (rotation-aware). */
function carrierFrame(pins: V3[], n: number): { c: V3; yaw: number } {
  const a = pins[0]
  const b = pins[Math.min(n - 1, pins.length - 1)]
  let yaw = 0
  if (a && b) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    if (Math.hypot(dx, dz) > 1e-6) yaw = Math.atan2(-dz, dx)
  }
  return { c: centroidOf(pins), yaw }
}

const pinLabelsOf = (entry: CatalogEntry): string[] =>
  entry.pins.map((pin) => entry.pinInfo?.find((pi) => pi.pin === pin)?.label ?? pin)

/** female Dupont housing: 2.54 mm square black nylon sleeve over a header post (short-body style) */
const DUPONT_H = 9
function dupontHousing(x: number, y: number, z: number): THREE.Mesh {
  return mesh(
    cachedGeometry('mot-dupont', () => {
      const g = new THREE.BoxGeometry(mm(2.5), mm(DUPONT_H), mm(2.5))
      g.translate(0, mm(DUPONT_H / 2), 0)
      return g
    }),
    plastic(0x1f1f23, 0.5),
    x,
    y,
    z,
  )
}

// carrier stack heights (mm): 2.5 mm header plastic, 1.6 mm PCB
const CAR_SPACER = 2.5
const CAR_T = 1.6
const CAR_Y_TOP = mm(CAR_SPACER + CAR_T)
const LIFT = 0.004

// ===========================================================================
// StepStick carriers: A4988 / DRV8825 / TMC2209 (rows g / d → ±5.08 mm)
// ===========================================================================

const SS_W = 20.32
const SS_D = 14.99
const SS_ROW = 5.08

interface StepStickLook {
  style: PcbArtStyle
  edge: number
}

const SS_LOOKS: Record<string, StepStickLook> = {
  a4988: { style: { mask: '#135c2e', maskCopper: '#1a6c38', pad: '#c9cbcd', silk: '#f1f1ea', drill: '#062612' }, edge: 0x0f4a25 },
  drv8825: { style: { mask: '#43246f', maskCopper: '#512e82', pad: '#d6c27a', silk: '#f1f1ea', drill: '#1b0d30' }, edge: 0x351c58 },
  tmc2209: { style: { mask: '#16171b', maskCopper: '#202228', pad: '#d6c27a', silk: '#f1f1ea', drill: '#060607' }, edge: 0x111215 },
}

/** TMC2209 finned heatsink top (mm): 12 × 12 base, 3.4 mm tall */
const TMC_SINK_H = 3.6

function stepStickStatics(variant: string, entry: CatalogEntry): THREE.Object3D[] {
  const look = SS_LOOKS[variant] ?? SS_LOOKS.a4988
  const labels = pinLabelsOf(entry)
  const art = pcbArtMaterial(
    `mot-stepstick-${variant}`,
    SS_W,
    SS_D,
    look.style,
    (p) => {
      // copper: wide VMOT / GND runs from the motor-side header toward the
      // bridge area, the logic pins' short runs, a few vias
      p.traces(
        [
          [
            [-8.89, -SS_ROW],
            [-8.89, -3.6],
            [-4.5, -3.6],
          ],
          [
            [-6.35, -SS_ROW],
            [-6.35, -4.0],
            [3.0, -4.0],
          ],
        ],
        0.8,
      )
      const sig: [number, number][][] = []
      for (let k = 0; k < 8; k++) sig.push([[(k - 3.5) * PITCH, SS_ROW], [(k - 3.5) * PITCH, 3.4]])
      p.traces(sig, 0.25)
      for (const [x, z] of [
        [-7.6, 0.6],
        [7.9, -0.8],
        [-1.2, -3.0],
      ] as const) p.via(x, z, 0.3)
      // pin legends outside the rows (the band between them carries the parts)
      paintCarrierPins(p, labels, 8, SS_ROW, false, 0.78)
      if (variant === 'tmc2209') p.silkText('TMC2209', -8.0, -1.0, 0.8, { weight: 400, stroke: 0.04, rot: -Math.PI / 2 })
    },
    { pxPerMm: 72 },
  )
  const parts: THREE.Object3D[] = []
  pcbSlab(parts, SS_W, SS_D, CAR_T, art, look.edge, mm(CAR_SPACER))
  carrierHeaders(parts, 8, SS_ROW, mm(CAR_SPACER), CAR_Y_TOP)
  const y = CAR_Y_TOP + LIFT
  const sense = chipRes()
  let caps: [number, number][]
  let pot: [number, number]
  if (variant === 'a4988') {
    // QFN-28 5 × 5 × 0.9 mm with its exposed lead ring
    parts.push(boxOn(mm(5), mm(0.9), mm(5), icMold(), mm(-2.0), y, 0))
    for (let i = 0; i < 7; i++) {
      for (const s of [-1, 1]) {
        parts.push(boxOn(mm(0.25), mm(0.08), mm(0.5), leadTin(), mm(-2.0 + (i - 3) * 0.5), y, s * mm(2.6)))
        parts.push(boxOn(mm(0.5), mm(0.08), mm(0.25), leadTin(), mm(-2.0) + s * mm(2.6), y, mm((i - 3) * 0.5)))
      }
    }
    // the two 1206 current-sense resistors next to the bridge pins
    chipPart(parts, sense, mm(3.6), y, mm(-1.5), 0, 2.0, 0.55)
    chipPart(parts, sense, mm(3.6), y, mm(1.5), 0, 2.0, 0.55)
    caps = [
      [-7.6, -2.4],
      [-7.6, 2.4],
      [3.6, 3.4],
    ]
    pot = [7.4, 0]
  } else if (variant === 'drv8825') {
    soic(parts, 'htssop28', mm(-2.2), y, 0, 9.7, 4.4, 1.0, 14, 0.65)
    chipPart(parts, sense, mm(4.4), y, mm(-2.2), 0, 2.0, 0.55)
    chipPart(parts, sense, mm(4.4), y, mm(-0.3), 0, 2.0, 0.55)
    caps = [
      [-8.7, -2.6],
      [-8.7, 2.6],
      [4.4, 2.6],
    ]
    pot = [7.6, 2.0]
  } else {
    // TMC2209: the chip sits on the bottom side; the top carries the finned
    // heatsink on its thermal pad, between the two header rows
    const pad = cachedMaterial('mot-thermal-pad', () => new THREE.MeshPhysicalMaterial({ color: 0x8b8f96, roughness: 0.8, metalness: 0 }))
    parts.push(boxOn(mm(10.4), mm(0.25), mm(6.8), pad, mm(-0.4), y, 0))
    parts.push(boxOn(mm(11), mm(1.2), mm(7.2), blackAnodized(), mm(-0.4), y + mm(0.25), 0))
    for (let k = 0; k < 6; k++) {
      parts.push(boxOn(mm(0.9), mm(TMC_SINK_H - 1.45), mm(7.2), blackAnodized(), mm(-0.4 + (k - 2.5) * 2.02), y + mm(1.45), 0))
    }
    caps = [
      [7.6, 2.6],
      [-8.4, 2.6],
    ]
    pot = [7.6, -1.2]
  }
  for (const [x, z] of caps) chipPart(parts, mlcc(), mm(x), y, mm(z), 0, 1.25, 0.8)
  // Vref trimmer: 3 × 3 mm body, slotted rotor
  const [potX, potZ] = pot
  parts.push(boxOn(mm(3.2), mm(1.1), mm(3.2), plastic(0xf1efe8, 0.5), mm(potX), y, mm(potZ)))
  parts.push(mesh(cylGeo('ss-pot-rotor', mm(1.25), mm(1.3), mm(0.4), 14), zinc(), mm(potX), y + mm(1.3), mm(potZ)))
  parts.push(boxOn(mm(2.2), mm(0.06), mm(0.35), darkRecess(), mm(potX), y + mm(1.48), mm(potZ)))
  parts.push(boxOn(mm(0.35), mm(0.06), mm(2.2), darkRecess(), mm(potX), y + mm(1.48), mm(potZ)))
  return parts
}

function buildStepStick(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const variant = entry.visual?.color ?? 'a4988'
  const { c, yaw } = carrierFrame(pins, 8)
  group.position.set(c.x, 0, c.z)
  group.rotation.y = yaw
  addStatics(group, designStatics(`stepstick:${variant}`, () => stepStickStatics(variant, entry)))
  if (!isGhost(comp)) {
    const y = CAR_Y_TOP + LIFT
    if (variant === 'a4988') {
      const mark = etchedLabelMaterial(['A4988', fakeLotCode('A4988').slice(0, 6)], 1.4)
      if (mark) group.add(at(topQuad(mm(4.2), mm(3.0), mark), mm(-2.0), y + mm(0.9) + 0.003, 0))
    } else if (variant === 'drv8825') {
      const mark = etchedLabelMaterial(['DRV8825', fakeLotCode('DRV8825').slice(0, 6)], 2.6)
      if (mark) group.add(at(topQuad(mm(8.4), mm(3.2), mark), mm(-2.2), y + mm(1.1) + 0.003, 0))
    }
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

/** Highest point of a StepStick carrier above the breadboard (plan units). */
export const STEPSTICK_TOP = CAR_Y_TOP + LIFT + mm(1.56)
export const TMC2209_TOP = CAR_Y_TOP + LIFT + mm(TMC_SINK_H + 0.25)

// ===========================================================================
// TB6612FNG breakout (SparkFun style, rows h / c → ±7.62 mm)
// ===========================================================================

const TB_W = 20.32
const TB_D = 19.9
const TB_ROW = 7.62

function tb6612Statics(entry: CatalogEntry): THREE.Object3D[] {
  const labels = pinLabelsOf(entry)
  const art = pcbArtMaterial(
    'mot-tb6612',
    TB_W,
    TB_D,
    { mask: '#9e1218', maskCopper: '#b01d22', pad: '#d6c27a', silk: '#f4f1e8', drill: '#3a0508' },
    (p) => {
      const tr: [number, number][][] = []
      for (let k = 0; k < 8; k++) {
        const x = (k - 3.5) * PITCH
        tr.push([[x, TB_ROW], [x, 4.6], [x * 0.55, 3.4]])
        tr.push([[x, -TB_ROW], [x, -4.6], [x * 0.55, -3.4]])
      }
      p.traces(tr, 0.3)
      p.copperRect(-6.5, 5.2, 4.5, 1.2)
      for (const [x, z] of [
        [-7.8, 0],
        [7.8, 0.4],
        [6.9, -1.6],
      ] as const) p.via(x, z, 0.32)
      paintCarrierPins(p, labels, 8, TB_ROW, true, 0.9)
      p.silkText('TB6612FNG', 0, -4.6, 0.9, { weight: 400, stroke: 0.045 })
      p.silkRect(0, 0, TB_W - 1.0, TB_D - 1.0, 0.12)
    },
    { pxPerMm: 72 },
  )
  const parts: THREE.Object3D[] = []
  pcbSlab(parts, TB_W, TB_D, CAR_T, art, 0x7d0d12, mm(CAR_SPACER))
  carrierHeaders(parts, 8, TB_ROW, mm(CAR_SPACER), CAR_Y_TOP)
  const y = CAR_Y_TOP + LIFT
  soic(parts, 'ssop24', 0, y, mm(0.4), 7.8, 5.3, 1.45, 12, 0.65)
  chipPart(parts, mlcc(), mm(-7.4), y, mm(2.4), Math.PI / 2, 1.3, 0.9)
  chipPart(parts, mlcc(), mm(7.4), y, mm(2.4), Math.PI / 2, 1.3, 0.9)
  chipPart(parts, mlcc(), mm(6.6), y, mm(-2.0), 0, 1.0, 0.8)
  return parts
}

function buildTb6612(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = carrierFrame(pins, 8)
  group.position.set(c.x, 0, c.z)
  group.rotation.y = yaw
  addStatics(group, designStatics('tb6612', () => tb6612Statics(entry)))
  if (!isGhost(comp)) {
    const mark = etchedLabelMaterial(['TB6612', 'FNG ' + fakeLotCode('TB6612').slice(0, 4)], 1.9)
    if (mark) group.add(at(topQuad(mm(6.2), mm(3.4), mark), 0, CAR_Y_TOP + LIFT + mm(1.55) + 0.003, mm(0.4)))
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

export const TB6612_TOP = CAR_Y_TOP + LIFT + mm(1.56)

// ===========================================================================
// DRV8833 breakout (rows g / d → ±5.08 mm, 6 pins each)
// ===========================================================================

const D33_W = 15.24
const D33_D = 12.6
const D33_ROW = 5.08

function drv8833Statics(entry: CatalogEntry): THREE.Object3D[] {
  const labels = pinLabelsOf(entry)
  const art = pcbArtMaterial(
    'mot-drv8833',
    D33_W,
    D33_D,
    { mask: '#173d8c', maskCopper: '#1f4a9e', pad: '#c9cbcd', silk: '#f1f1ea', drill: '#07173a' },
    (p) => {
      const tr: [number, number][][] = []
      for (let k = 0; k < 6; k++) {
        const x = (k - 2.5) * PITCH
        tr.push([[x, D33_ROW], [x, 3.2], [x * 0.5, 2.4]])
        tr.push([[x, -D33_ROW], [x, -3.2], [x * 0.5, -2.4]])
      }
      p.traces(tr, 0.28)
      for (const [x, z] of [
        [-5.6, 0.2],
        [5.6, -0.3],
      ] as const) p.via(x, z, 0.3)
      paintCarrierPins(p, labels, 6, D33_ROW, true, 0.78)
      p.silkRect(0, 0, D33_W - 0.9, D33_D - 0.9, 0.12)
    },
    { pxPerMm: 80 },
  )
  const parts: THREE.Object3D[] = []
  pcbSlab(parts, D33_W, D33_D, CAR_T, art, 0x10306f, mm(CAR_SPACER))
  carrierHeaders(parts, 6, D33_ROW, mm(CAR_SPACER), CAR_Y_TOP)
  const y = CAR_Y_TOP + LIFT
  soic(parts, 'htssop16', 0, y, 0, 5.0, 4.4, 1.0, 8, 0.65, Math.PI / 2)
  chipPart(parts, mlcc(), mm(-5.6), y, mm(1.0), Math.PI / 2, 1.3, 0.9)
  chipPart(parts, mlcc(), mm(5.6), y, mm(-1.0), Math.PI / 2, 1.0, 0.8)
  return parts
}

function buildDrv8833(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const { c, yaw } = carrierFrame(pins, 6)
  group.position.set(c.x, 0, c.z)
  group.rotation.y = yaw
  addStatics(group, designStatics('drv8833', () => drv8833Statics(entry)))
  if (!isGhost(comp)) {
    const mark = etchedLabelMaterial(['DRV8833', fakeLotCode('DRV8833').slice(0, 5)], 1.3)
    if (mark) group.add(at(topQuad(mm(3.0), mm(2.4), mark), 0, CAR_Y_TOP + LIFT + mm(1.1) + 0.003, 0))
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

/** the header post tips (1.4 mm proud) stand above the HTSSOP */
export const DRV8833_TOP = CAR_Y_TOP + mm(1.4) + 0.002

// ===========================================================================
// ULN2003 stepper driver board (off-board); local mm frame: board centre on
// the desk, x right, z toward the viewer (the header edge).
// ===========================================================================

const ULN_S = 0.45
const ULN_W = 35
const ULN_D = 32
const ULN_YB = 1.6
const ULN_CZ = -1.6
const ULN_LED_X = 12.2
const ULN_LED_Z = [-7.5, -2.5, 2.5, 7.5]
const ULN_IN_X = [-10.16, -7.62, -5.08, -2.54]
const ULN_PWR_X = [3.81, 6.35]
const ULN_JMP_X = [9.0, 11.54]
const ULN_HDR_Z = 13.2
const ULN_JST_X = -4
const ULN_JST_Z = -12.3

function ulnStatics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(ULN_S)
  const art = pcbArtMaterial(
    'mot-uln2003',
    ULN_W,
    ULN_D,
    { mask: '#0d5a31', maskCopper: '#146b3c', pad: '#c9cbcd', silk: '#f2f2ea', drill: '#052614' },
    (p) => {
      // DIP-16 pads, JST pads, header pads and the traces between them
      const tr: [number, number][][] = []
      for (let i = 0; i < 4; i++) {
        tr.push([[ULN_IN_X[i], ULN_HDR_Z], [ULN_IN_X[i], 6.5], [-12.9 + i * 2.54, 3.2]])
        tr.push([[-12.9 + i * 2.54, -3.2], [-12.9 + i * 2.54, -7.5], [ULN_JST_X - 5 + i * 2.5, -9.5], [ULN_JST_X - 5 + i * 2.5, ULN_JST_Z]])
        tr.push([[-12.9 + i * 2.54, -3.2], [ULN_LED_X - 3.5, ULN_LED_Z[i]], [ULN_LED_X - 1.2, ULN_LED_Z[i]]])
      }
      p.traces(tr, 0.35)
      p.traces([[[ULN_PWR_X[1], ULN_HDR_Z], [ULN_PWR_X[1], 9.5], [15.5, 9.5], [15.5, -10.5], [ULN_JST_X + 5, -10.5], [ULN_JST_X + 5, ULN_JST_Z]]], 0.8)
      p.traces([[[ULN_PWR_X[0], ULN_HDR_Z], [ULN_PWR_X[0], 7.5], [-3.8, 7.5], [-3.8, 3.2]]], 0.8)
      for (let i = 0; i < 8; i++) {
        p.padCircle(-12.9 + i * 2.54, 3.81, 0.7)
        p.padCircle(-12.9 + i * 2.54, -3.81, 0.7)
      }
      for (let i = 0; i < 5; i++) p.padCircle(ULN_JST_X + (i - 2) * 2.5, ULN_JST_Z, 0.75)
      ULN_IN_X.forEach((x, i) => (i === 0 ? p.padRect(x, ULN_HDR_Z, 1.6, 1.6) : p.padCircle(x, ULN_HDR_Z, 0.8)))
      for (const x of [...ULN_PWR_X, ...ULN_JMP_X]) p.padCircle(x, ULN_HDR_Z, 0.8)
      for (const z of ULN_LED_Z) {
        p.padRect(ULN_LED_X - 1.0, z, 0.9, 1.1)
        p.padRect(ULN_LED_X + 1.0, z, 0.9, 1.1)
        p.padRect(ULN_LED_X - 4.2, z, 0.9, 1.1)
        p.padRect(ULN_LED_X - 2.4, z, 0.9, 1.1)
      }
      for (const [x, z] of [
        [-15, -13.5],
        [15, -13.5],
        [-15, 13.5],
        [15, 13.5],
      ] as const) paintMountHole(p, x, z, 1.4)
      const silk = { weight: 400, stroke: 0.06, condense: 0.9 }
      ;['IN1', 'IN2', 'IN3', 'IN4'].forEach((t, i) => p.silkText(t, ULN_IN_X[i], ULN_HDR_Z - 2.2, 1.0, silk))
      p.silkText('-', ULN_PWR_X[0], ULN_HDR_Z - 2.2, 1.4, silk)
      p.silkText('+', ULN_PWR_X[1], ULN_HDR_Z - 2.2, 1.4, silk)
      p.silkText('5-12V', 5.1, ULN_HDR_Z - 4.0, 1.0, silk)
      p.silkText('ON  OFF', (ULN_JMP_X[0] + ULN_JMP_X[1]) / 2, ULN_HDR_Z - 2.2, 0.9, silk)
      ;['A', 'B', 'C', 'D'].forEach((t, i) => p.silkText(t, ULN_LED_X + 2.6, ULN_LED_Z[i], 1.2, silk))
      p.silkRect(-4.0, 0, 21.6, 8.6, 0.15)
      p.silkText('ULN2003', -4.0, 6.0, 1.3, silk)
      p.silkRect(ULN_JST_X, ULN_JST_Z, 15.5, 6.2, 0.15)
      p.silkRect(0, 0, ULN_W - 1.2, ULN_D - 1.2, 0.15)
    },
    { pxPerMm: 40 },
  )
  const parts: THREE.Object3D[] = []
  const yb = mm(ULN_YB)
  pcbSlab(parts, ULN_W, ULN_D, 1.6, art, 0x0b4a28, yb)
  const y = yb + mm(1.6) + LIFT
  // ULN2003AN DIP-16 (19.3 × 6.35 × 3.3 mm) with its 16 shoulder legs
  parts.push(
    mesh(
      cachedGeometry('mot-uln-dip', () => new RoundedBoxGeometry(mm(19.3), mm(3.3), mm(6.35), 1, mm(0.3))),
      cachedMaterial('mot-dip-epoxy', () =>
        new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, roughness: 0.45, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
      ),
      mm(-4.0),
      y + mm(0.6 + 1.65),
      0,
    ),
  )
  for (let i = 0; i < 8; i++) {
    for (const s of [-1, 1]) {
      parts.push(boxOn(mm(0.55), mm(1.4), mm(0.6), leadTin(), mm(-12.9 + i * 2.54), y, s * mm(3.6)))
    }
  }
  parts.push(
    mesh(
      cachedGeometry('mot-uln-notch', () => {
        const g = new THREE.CircleGeometry(mm(0.8), 10, -Math.PI / 2, Math.PI)
        g.rotateX(-Math.PI / 2)
        return g
      }),
      darkRecess(),
      mm(-4.0 - 9.64),
      y + mm(3.9) + 0.002,
      0,
    ),
  )
  // JST-XH 5-pin socket (white nylon), opening toward the back edge
  const nylon = plastic(0xf0ede3, 0.52)
  parts.push(boxOn(mm(14.9), mm(7.0), mm(5.75), nylon, mm(ULN_JST_X), y, mm(ULN_JST_Z)))
  parts.push(boxOn(mm(13.0), mm(0.1), mm(3.6), darkRecess(), mm(ULN_JST_X), y + mm(7.0), mm(ULN_JST_Z - 0.4)))
  for (let i = 0; i < 5; i++) parts.push(boxOn(mm(0.64), mm(5.0), mm(0.64), tinnedPost(), mm(ULN_JST_X + (i - 2) * 2.5), y + mm(2.1), mm(ULN_JST_Z - 0.4)))
  // input header 1×4, power 1×2, ON/OFF jumper 1×2 (+ cap): black bases + posts
  const hdrPins = [...ULN_IN_X, ...ULN_PWR_X, ...ULN_JMP_X]
  for (const x of hdrPins) {
    parts.push(boxOn(mm(2.5), mm(2.5), mm(2.5), headerPlasticMaterial(), mm(x), y, mm(ULN_HDR_Z)))
    parts.push(mesh(headerPostGeometry(mm(0.32), mm(5.5), mm(0.18)), tinnedPost(), mm(x), y + mm(2.5), mm(ULN_HDR_Z)))
  }
  // ON/OFF shunt fitted; female Dupont housings on the six wired pins
  parts.push(boxOn(mm(5.0), mm(6.0), mm(2.5), plastic(0x1d1d20, 0.5), mm((ULN_JMP_X[0] + ULN_JMP_X[1]) / 2), y + mm(2.6), mm(ULN_HDR_Z)))
  for (const x of [...ULN_IN_X, ...ULN_PWR_X]) parts.push(dupontHousing(mm(x), y + mm(2.55), mm(ULN_HDR_Z)))
  // 0805 LEDs (substrate + terminations; the lens is per-instance) and 1 kΩ resistors
  const sub = cachedMaterial('mot-led-substrate', () => new THREE.MeshPhysicalMaterial({ color: 0xf1ede2, roughness: 0.45, metalness: 0 }))
  for (const z of ULN_LED_Z) {
    parts.push(boxOn(mm(1.4), mm(0.35), mm(1.2), sub, mm(ULN_LED_X), y, mm(z)))
    for (const s of [-1, 1]) parts.push(boxOn(mm(0.3), mm(0.6), mm(1.2), leadTin(), mm(ULN_LED_X + s * 0.9), y, mm(z)))
    chipPart(parts, chipRes(), mm(ULN_LED_X - 3.3), y, mm(z), 0, 1.25, 0.5)
  }
  // 100 nF ceramic by the power header
  chipPart(parts, mlcc(), mm(1.0), y, mm(9.0), 0, 1.25, 0.8)
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(3.25, 0, ULN_CZ)
  frame.add(body)
  return [frame]
}

function buildUln2003(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('uln2003', ulnStatics))
  const live = new THREE.Group()
  live.position.set(3.25, 0, ULN_CZ)
  live.scale.setScalar(ULN_S)
  anchor.add(live)
  const y = mm(ULN_YB + 1.6) + LIFT
  const lensGeo = slabGeometry(mm(1.0), mm(0.4), mm(1.0), { bottom: true })
  const leds = ULN_LED_Z.map((z) => ledRig(live, lensGeo, V(mm(ULN_LED_X), y + mm(0.35 + 0.2), mm(z)), ghost, 1.6))
  if (!ghost) {
    const mark = etchedLabelMaterial(['ULN2003AN', fakeLotCode('ULN2003')], 3.4)
    if (mark) live.add(at(topQuad(mm(13), mm(3.8), mark), mm(-4.0), y + mm(3.9) + 0.003, 0))
  }

  // leads: IN1..IN4 / GND / VCC from the headers (Dupont colours), OUT1..OUT4
  // from the JST socket in the motor's lead colours around the right side
  const w = (x: number, yy: number, z: number) => V(ax + 3.25 + mm(x) * ULN_S, mm(yy) * ULN_S, az + ULN_CZ + mm(z) * ULN_S)
  const leads: THREE.Object3D[] = []
  const inColors = [0xf2f2f2, 0x8e44ad, 0x3a7bd5, 0x2e9b45]
  const hdrTop = ULN_YB + 1.6 + 2.55 + DUPONT_H
  const dupont = { radius: 0.04, reach: 0.18, rise: 0.12 }
  for (let i = 0; i < 4; i++) {
    if (pins[i]) benchLead(w(ULN_IN_X[i], hdrTop, ULN_HDR_Z), V(0, 0, 1), pins[i], inColors[i], leads, dupont)
  }
  if (pins[4]) benchLead(w(ULN_PWR_X[0], hdrTop, ULN_HDR_Z), V(0, 0, 1), pins[4], 0x1d1d1f, leads, dupont)
  if (pins[5]) benchLead(w(ULN_PWR_X[1], hdrTop, ULN_HDR_Z), V(0, 0, 1), pins[5], 0xc62828, leads, dupont)
  const outColors = [0xf08a1c, 0xf2cf1d, 0xf28cb2, 0x2c62d6]
  const rightX = ax + 3.25 + mm(ULN_W / 2) * ULN_S
  for (let i = 0; i < 4; i++) {
    const pin = pins[6 + i]
    if (!pin) continue
    const from = w(ULN_JST_X + (i - 2) * 2.5, ULN_YB + 1.6 + 5.5, ULN_JST_Z - 2.0)
    const bend = V(rightX + 0.25 + 0.14 * i, DESK_Y, az + ULN_CZ - mm(13) * ULN_S + 0.1 * i)
    // tucked under the PCB's back edge: the part's rect (7 deep, the shelf
    // pitch) ends 2.5 behind the legacy instrument rect — so do the leads
    benchLead(from, V(0, 0, -1), pin, outColors[i], leads, {
      radius: 0.04,
      reach: 0.05,
      via: [V(from.x + 0.3, DESK_Y, from.z - 0.3 + 0.1 * i), bend, V(bend.x, DESK_Y, pin.z - 1.0 + 0.12 * i)],
    })
  }
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (t: ComponentTelemetry | null) => {
    ;['A', 'B', 'C', 'D'].forEach((n, i) => applyLed(leds[i], moduleLedLight(t, n)))
  }
  pose(null)
  return { object: group, pinWorld: terminalTops(pins), update: (_c, _e, t) => pose(t) }
}

// ===========================================================================
// L298N dual H-bridge module (HW-095, off-board); local mm: board centre on
// the desk, x right, z toward the viewer (power terminal + logic header).
// ===========================================================================

const L298_S = 0.36
const L298_W = 43
const L298_YB = 2.0
/**
 * module centre from the anchor: the part's rect (motors.parts.ts
 * `offboard`, terminal 0 at anchor + 2.5) starts 0.5 left of the legacy
 * one, so the OUT1/OUT2 leads leaving the left screw terminal stay inside it
 */
const L298_CX = 3.75
const L298_CZ = -1.45
/** heatsink (black anodized), base plate front at z = −4 */
const HS = { w: 23, h: 24, base: 3, fin: 12 }
const L298_TERM_SIDE_Z = [-8.5, -3.5]
const L298_PWR_X = [-12, -7, -2]
const L298_TERM_Z = 17.8
const L298_HDR_X = [2.5, 5.04, 7.58, 10.12, 12.66, 15.2]
const L298_HDR_Z = 18.0
const L298_JMP_Z = 15.46
const L298_5V = { x: -17.6, z: 10.5 }
const L298_LED = { x: -19.3, z: 14.0 }

const termBlue = () =>
  cachedMaterial('mot-term-blue', () => new THREE.MeshPhysicalMaterial({ color: 0x1f63c6, roughness: 0.45, metalness: 0, clearcoat: 0.15 }))

/**
 * Screw-terminal block (5.0 mm pitch), `n` positions along local +x, wire
 * entries facing local +z; origin = block centre on the PCB top.
 */
function screwTerminal(parts: THREE.Object3D[], n: number, x: number, y: number, z: number, ry: number): void {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  g.rotation.y = ry
  const W = n * 5.0
  g.add(boxOn(mm(W - 0.1), mm(10), mm(7.6), termBlue(), 0, 0, 0))
  for (let i = 0; i < n; i++) {
    const cx = mm((i - (n - 1) / 2) * 5.0)
    // screw well + slotted screw head on top
    g.add(
      mesh(
        cachedGeometry('mot-term-well', () => {
          const c = new THREE.CircleGeometry(mm(1.8), 10)
          c.rotateX(-Math.PI / 2)
          return c
        }),
        darkRecess(),
        cx,
        mm(10.01),
        mm(-0.8),
      ),
    )
    g.add(mesh(cylGeo('term-screw', mm(1.45), mm(1.45), mm(0.6), 10, true), zinc(), cx, mm(9.75), mm(-0.8)))
    g.add(
      mesh(
        cachedGeometry('mot-term-screwtop', () => {
          const c = new THREE.CircleGeometry(mm(1.45), 10)
          c.rotateX(-Math.PI / 2)
          return c
        }),
        zinc(),
        cx,
        mm(10.05),
        mm(-0.8),
      ),
    )
    g.add(boxOn(mm(2.4), mm(0.12), mm(0.45), darkRecess(), cx, mm(10.03), mm(-0.8)))
    // wire entry with its clamp
    g.add(mesh(slabGeometry(mm(3.3), mm(3.2), mm(0.12)), darkRecess(), cx, mm(3.0), mm(3.82)))
    g.add(mesh(slabGeometry(mm(3.0), mm(0.5), mm(0.14)), zinc(), cx, mm(4.3), mm(3.84)))
  }
  parts.push(g)
}

function l298Statics(): THREE.Object3D[] {
  const body = new THREE.Group()
  body.scale.setScalar(L298_S)
  const art = pcbArtMaterial(
    'mot-l298n',
    L298_W,
    L298_W,
    { mask: '#b3141a', maskCopper: '#c32022', pad: '#d0d2d4', silk: '#f6f3ea', drill: '#3e0507' },
    (p) => {
      // wide motor-current pours and the logic traces
      p.copperRect(-15, -6, 6, 9)
      p.copperRect(15, -6, 6, 9)
      p.copperRect(-7, 13, 15, 4)
      p.traces(
        L298_HDR_X.map((x, i) => [
          [x, L298_HDR_Z],
          [x, 11.5 - i * 0.6],
          [-6 + i * 2.3, 5.5],
          [-6 + i * 2.3, 3.0],
        ]),
        0.4,
      )
      for (let i = 0; i < 15; i++) p.padCircle(-8.9 + i * 1.27, i % 2 === 0 ? 1.6 : 3.4, 0.55)
      for (const x of L298_PWR_X) p.padCircle(x, L298_TERM_Z - 1, 1.1)
      for (const z of L298_TERM_SIDE_Z) {
        p.padCircle(-19, z, 1.1)
        p.padCircle(19, z, 1.1)
      }
      for (const x of L298_HDR_X) {
        p.padCircle(x, L298_HDR_Z, 0.8)
      }
      p.padCircle(L298_HDR_X[0], L298_JMP_Z, 0.8)
      p.padCircle(L298_HDR_X[5], L298_JMP_Z, 0.8)
      for (const [x, z] of [
        [-18.5, -18.5],
        [18.5, -18.5],
        [-18.5, 18.5],
        [18.5, 18.5],
      ] as const) paintMountHole(p, x, z)
      const silk = { weight: 400, stroke: 0.07, condense: 0.9 }
      p.silkText('OUT1', -14.5, -12.6, 1.3, silk)
      p.silkText('OUT2', -14.5, 0.2, 1.3, silk)
      p.silkText('OUT3', 14.5, 0.2, 1.3, silk)
      p.silkText('OUT4', 14.5, -12.6, 1.3, silk)
      p.silkText('+12V', L298_PWR_X[0], 11.6, 1.2, silk)
      p.silkText('GND', L298_PWR_X[1], 11.6, 1.2, silk)
      p.silkText('+5V', L298_PWR_X[2], 11.6, 1.2, silk)
      ;['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].forEach((t, i) => p.silkText(t, L298_HDR_X[i], 12.2, 0.95, { ...silk, rot: -Math.PI / 2 }))
      p.silkText('5V-EN', L298_5V.x + 1.3, L298_5V.z - 2.2, 1.0, silk)
      p.silkText('HW-095', 3.5, 8.6, 1.2, silk)
      p.silkRect(0, 0, L298_W - 1.4, L298_W - 1.4, 0.16)
    },
    { pxPerMm: 32 },
  )
  const parts: THREE.Object3D[] = []
  const yb = mm(L298_YB)
  pcbSlab(parts, L298_W, L298_W, 1.6, art, 0x8c0e13, yb)
  const y = yb + mm(1.6) + LIFT
  // heatsink: base plate + 7 fins toward the back
  const hsZ = -4 - HS.base / 2
  parts.push(boxOn(mm(HS.w), mm(HS.h), mm(HS.base), blackAnodized(), 0, y, mm(hsZ)))
  for (let k = 0; k < 7; k++) {
    parts.push(boxOn(mm(1.3), mm(HS.h - 0.6), mm(HS.fin), blackAnodized(), mm((k - 3) * (HS.w - 1.3) / 6), y, mm(hsZ - HS.base / 2 - HS.fin / 2)))
  }
  parts.push(boxOn(mm(HS.w), mm(1.6), mm(HS.fin), blackAnodized(), 0, y, mm(hsZ - HS.base / 2 - HS.fin / 2)))
  // Multiwatt15 L298N: moulded body, its copper tab up the heatsink plate
  // with the bolt through it, 15 staggered legs into the PCB
  parts.push(boxOn(mm(19.6), mm(10.0), mm(4.6), icMold(), 0, y + mm(5.0), mm(-1.7)))
  parts.push(boxOn(mm(19.6), mm(6.6), mm(1.6), metalMat('l298-tab', 0xb8b2a6, 0.5, 0.8), 0, y + mm(15.0), mm(-3.2)))
  parts.push(
    mesh(
      cachedGeometry('mot-l298-bolt', () => {
        const g = new THREE.CylinderGeometry(mm(2.1), mm(2.1), mm(1.2), 12)
        g.rotateX(Math.PI / 2)
        return g
      }),
      zinc(),
      0,
      y + mm(18.3),
      mm(-1.9),
    ),
  )
  for (let i = 0; i < 15; i++) {
    const lx = mm(-8.9 + i * 1.27)
    const lz = i % 2 === 0 ? 1.6 : 3.4
    // out of the package bottom edge, bent forward, then down into the PCB
    parts.push(boxOn(mm(0.55), mm(0.4), mm(lz + 0.7), leadTin(), lx, y + mm(4.8), mm((lz - 0.5) / 2)))
    parts.push(boxOn(mm(0.55), mm(4.9), mm(0.4), leadTin(), lx, y, mm(lz)))
  }
  // screw terminals: OUT1/OUT2 (left, entries −x), OUT3/OUT4 (right, entries +x), power (front)
  screwTerminal(parts, 2, mm(-18), y, mm(-6), -Math.PI / 2)
  screwTerminal(parts, 2, mm(18), y, mm(-6), Math.PI / 2)
  screwTerminal(parts, 3, mm(-7), y, mm(L298_TERM_Z), 0)
  // logic header 1×6 + the ENA / ENB jumper posts behind ENA and ENB
  for (const [x, z] of [...L298_HDR_X.map((x) => [x, L298_HDR_Z] as const), [L298_HDR_X[0], L298_JMP_Z] as const, [L298_HDR_X[5], L298_JMP_Z] as const]) {
    parts.push(boxOn(mm(2.5), mm(2.5), mm(2.5), headerPlasticMaterial(), mm(x), y, mm(z)))
    parts.push(mesh(headerPostGeometry(mm(0.32), mm(6.0), mm(0.18)), tinnedPost(), mm(x), y + mm(2.5), mm(z)))
  }
  // 5V-EN jumper posts (along x)
  for (const dx of [0, 2.54]) {
    parts.push(boxOn(mm(2.5), mm(2.5), mm(2.5), headerPlasticMaterial(), mm(L298_5V.x + dx), y, mm(L298_5V.z)))
    parts.push(mesh(headerPostGeometry(mm(0.32), mm(6.0), mm(0.18)), tinnedPost(), mm(L298_5V.x + dx), y + mm(2.5), mm(L298_5V.z)))
  }
  // 78M05 (DPAK) with its tab
  parts.push(boxOn(mm(6.6), mm(2.3), mm(6.1), icMold(), mm(-9.5), y, mm(6.0)))
  parts.push(boxOn(mm(5.2), mm(0.5), mm(1.6), leadTin(), mm(-9.5), y, mm(2.4)))
  for (const dx of [-2.28, 2.28]) parts.push(boxOn(mm(0.7), mm(0.5), mm(2.2), leadTin(), mm(-9.5 + dx), y, mm(10.0)))
  // 220 µF / 35 V electrolytics (black sleeve, aluminium top with the vent cross)
  const sleeve = cachedMaterial('mot-ecap-sleeve', () => new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0, clearcoat: 0.5 }))
  for (const [x, z] of [
    [-17.2, 3.4],
    [17.2, 3.4],
  ] as const) {
    parts.push(mesh(cylGeo('l298-cap', mm(4), mm(4), mm(11), 18, true), sleeve, mm(x), y + mm(5.5), mm(z)))
    parts.push(
      mesh(
        cachedGeometry('mot-l298-captop', () => {
          const g = new THREE.CircleGeometry(mm(3.85), 18)
          g.rotateX(-Math.PI / 2)
          return g
        }),
        satinSteel(),
        mm(x),
        y + mm(11),
        mm(z),
      ),
    )
    // polarity stripe down the sleeve's outboard side
    parts.push(boxOn(mm(0.1), mm(9.6), mm(1.8), cachedMaterial('mot-ecap-stripe', () => new THREE.MeshPhysicalMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0 })), mm(x + Math.sign(x) * 4.02), y + mm(0.8), mm(z)))
  }
  // eight M7 (SMA) flyback diodes in front of the bridge
  const diodeBody = cachedMaterial('mot-sma', () => new THREE.MeshPhysicalMaterial({ color: 0x1c1c1f, roughness: 0.55, metalness: 0 }))
  const band = cachedMaterial('mot-sma-band', () => new THREE.MeshPhysicalMaterial({ color: 0xb9bcc0, roughness: 0.5, metalness: 0 }))
  for (const z of [6.4, 10.0]) {
    for (const x of [-2.0, 2.5, 7.0, 11.5]) {
      parts.push(boxOn(mm(4.3), mm(2.1), mm(2.6), diodeBody, mm(x), y, mm(z)))
      parts.push(boxOn(mm(0.6), mm(0.04), mm(2.62), band, mm(x - 1.5), y + mm(2.1), mm(z)))
    }
  }
  // power LED (0805, lens per-instance) + its resistor
  const sub = cachedMaterial('mot-led-substrate', () => new THREE.MeshPhysicalMaterial({ color: 0xf1ede2, roughness: 0.45, metalness: 0 }))
  parts.push(boxOn(mm(1.4), mm(0.35), mm(1.2), sub, mm(L298_LED.x), y, mm(L298_LED.z)))
  chipPart(parts, chipRes(), mm(L298_LED.x + 2.6), y, mm(L298_LED.z), 0, 1.25, 0.5)
  // female Dupont housings on IN1..IN4 (ENA / ENB carry their shunts)
  for (let i = 1; i <= 4; i++) parts.push(dupontHousing(mm(L298_HDR_X[i]), y + mm(2.55), mm(L298_HDR_Z)))
  body.add(...parts)
  const frame = new THREE.Group()
  frame.position.set(L298_CX, 0, L298_CZ)
  frame.add(body)
  return [frame]
}

/** jumper shunt: black cap 2.5 × 5.0 × 6 mm spanning two posts along local x */
function jumperCapGeometry(): THREE.BufferGeometry {
  return cachedGeometry('mot-jumper-cap', () => new RoundedBoxGeometry(mm(5.0), mm(6.0), mm(2.5), 1, mm(0.3)))
}

function buildL298n(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  const ghost = isGhost(comp)
  const { ax, az } = anchorOf(pins, entry)
  const anchor = new THREE.Group()
  anchor.position.set(ax, 0, az)
  group.add(anchor)
  addStatics(anchor, designStatics('l298n', l298Statics))
  const live = new THREE.Group()
  live.position.set(L298_CX, 0, L298_CZ)
  live.scale.setScalar(L298_S)
  anchor.add(live)
  const y = mm(L298_YB + 1.6) + LIFT
  const capMat = plastic(0x18181b, 0.5)
  const capGeo = jumperCapGeometry()
  // ENA / ENB shunts span the EN pin and the +5V post behind it (along z)
  const jEnA = mesh(capGeo, capMat, mm(L298_HDR_X[0]), y + mm(2.6 + 3.0), mm((L298_HDR_Z + L298_JMP_Z) / 2))
  jEnA.rotation.y = Math.PI / 2
  const jEnB = mesh(capGeo, capMat, mm(L298_HDR_X[5]), y + mm(2.6 + 3.0), mm((L298_HDR_Z + L298_JMP_Z) / 2))
  jEnB.rotation.y = Math.PI / 2
  const j5v = mesh(capGeo, capMat, mm(L298_5V.x + 1.27), y + mm(2.6 + 3.0), mm(L298_5V.z))
  live.add(jEnA, jEnB, j5v)
  const led = ledRig(live, slabGeometry(mm(1.0), mm(0.4), mm(1.0), { bottom: true }), V(mm(L298_LED.x), y + mm(0.55), mm(L298_LED.z)), ghost, 1.4)
  if (!ghost) {
    const mark = etchedLabelMaterial(['L298N', fakeLotCode('L298N')], 2.4)
    if (mark) live.add(at(frontQuad(mm(12), mm(5), mark), 0, y + mm(10.0), mm(0.6) + 0.02))
  }

  // leads: OUT1/OUT2 out of the left terminal, power out of the front block,
  // logic jumpers off the header, OUT3/OUT4 out of the right terminal
  const w = (x: number, yy: number, z: number) => V(ax + L298_CX + mm(x) * L298_S, mm(yy) * L298_S, az + L298_CZ + mm(z) * L298_S)
  const leads: THREE.Object3D[] = []
  const termY = L298_YB + 1.6 + 3.0
  const left = [w(-21.9, termY, L298_TERM_SIDE_Z[0]), w(-21.9, termY, L298_TERM_SIDE_Z[1])]
  const right = [w(21.9, termY, L298_TERM_SIDE_Z[1]), w(21.9, termY, L298_TERM_SIDE_Z[0])]
  const cOut = [0xf2cf1d, 0x2e9b45, 0x3a7bd5, 0xf2f2f2]
  if (pins[0]) benchLead(left[0], V(-1, 0, 0), pins[0], cOut[0], leads, { radius: 0.05, reach: 0.2, via: [V(left[0].x - 0.5, DESK_Y, pins[0].z - 1.1)] })
  if (pins[1]) benchLead(left[1], V(-1, 0, 0), pins[1], cOut[1], leads, { radius: 0.05, reach: 0.2, via: [V(left[1].x - 0.3, DESK_Y, pins[1].z - 0.8)] })
  const cPwr = [0xc62828, 0x1d1d1f, 0xf08a1c]
  for (let i = 0; i < 3; i++) {
    const pin = pins[2 + i]
    if (pin) benchLead(w(L298_PWR_X[i], termY, L298_TERM_Z + 3.9), V(0, 0, 1), pin, cPwr[i], leads, { radius: 0.05, reach: 0.15 })
  }
  const cLogic = [0x8e44ad, 0xf2f2f2, 0x9aa0a6, 0x6b3a1e, 0x2e9b45, 0x3a7bd5]
  const dupTop = L298_YB + 1.6 + 2.55 + DUPONT_H
  for (let i = 0; i < 6; i++) {
    const pin = pins[5 + i]
    if (!pin) continue
    if (i >= 1 && i <= 4) {
      benchLead(w(L298_HDR_X[i], dupTop, L298_HDR_Z), V(0, 0, 1), pin, cLogic[i], leads, { radius: 0.04, reach: 0.18, rise: 0.12 })
    } else {
      // ENA / ENB: a lead soldered to the pin root in front of its shunt
      benchLead(w(L298_HDR_X[i], L298_YB + 1.6 + 1.2, L298_HDR_Z + 1.3), V(0, 0, 1), pin, cLogic[i], leads, { radius: 0.04, reach: 0.12 })
    }
  }
  for (let i = 0; i < 2; i++) {
    const pin = pins[11 + i]
    if (!pin) continue
    benchLead(right[i], V(1, 0, 0), pin, cOut[2 + i], leads, {
      radius: 0.05,
      reach: 0.2,
      via: [V(right[i].x + 0.35 + 0.15 * i, DESK_Y, right[i].z + 0.3), V(right[i].x + 0.35 + 0.15 * i, DESK_Y, pin.z - 0.9 + 0.15 * i)],
    })
  }
  for (const m of mergeStatic(leads)) group.add(m)

  const pose = (c: ComponentInstance, t: ComponentTelemetry | null) => {
    jEnA.visible = paramOf(c.params, entry, 'jumperEnA') !== false
    jEnB.visible = paramOf(c.params, entry, 'jumperEnB') !== false
    j5v.visible = paramOf(c.params, entry, 'jumper5v') !== false
    applyLed(led, moduleLedLight(t, 'PWR'))
  }
  pose(comp, null)
  return { object: group, pinWorld: terminalTops(pins), update: (c, _e, t) => pose(c, t) }
}

// ===========================================================================

registerMeshBuilder('motor_dc', 1, buildDcMotor)
registerMeshBuilder('servo_sg90', 1, buildSg90)
registerMeshBuilder('stepper_28byj48', 1, buildByj48)
registerMeshBuilder('stepper_nema17', 1, buildNema17)
registerMeshBuilder('uln2003_board', 1, buildUln2003)
registerMeshBuilder('l298n_module', 1, buildL298n)
registerMeshBuilder('tb6612_module', 2, buildTb6612)
registerMeshBuilder('drv8833_module', 2, buildDrv8833)
registerMeshBuilder('stepstick', 2, buildStepStick)
