/**
 * Sensors family meshes (src/model/parts/sensors.parts.ts): the breakout
 * modules people really buy — GY-521 (MPU-6050), GY-BMP280 / GY-BME280,
 * GY-302 (BH1750), the DHT11 / DHT22 modules, HC-SR04, KY-040 rotary
 * encoder, KY-023 joystick, ACS712 and the 0–25 V voltage sensor — plus the
 * leaded VS1838B IR receiver and the A3144 Hall switch ("UA" SIP-3). The
 * DS18B20 is a plain TO-92 and uses the built-in TO-92 model.
 * Registered through registerMeshBuilder (meshes/registry).
 *
 * Same standards as the Blue Pill (meshes/boards.ts) and the basic family
 * (ext/basic.mesh.ts): true proportions in millimetres (MM = 1/2.54 plan
 * units), boards built from the shared PCB kit (meshes/pcb.ts: one
 * soldermask + copper + pad + silkscreen art texture per board design,
 * routed FR4 edge between mask lips, chamfered header posts in solder
 * fillets, plated mounting holes punched through the board), every static
 * part merged ONCE per design into one geometry per material (shared, page
 * lifetime), ≤ 4000 triangles, no transmission, never a light (LED glow =
 * additive sprite), per-instance resources only for state (LED lenses,
 * moving parts, the load wires of the terminal-block modules) and none for
 * the '__ghost__' placement preview beyond its group.
 *
 * Module frame (all builders): local +x runs along the header from pin 0
 * to the last header pin, local −z points from the header row to the far
 * edge of the board, y up; the frame comes from where the pins REALLY are
 * (rotation already applied by footprintHoles), so a 180°-rotated module
 * renders turned round. Flat modules lie component-side up on a 2.5 mm
 * header strip (the PCB floats over the rows it covers, like the Blue
 * Pill); the HC-SR04 stands on its header with the transducers facing
 * back over rows c–e and its component side toward the viewer.
 *
 * State: the power LEDs follow telemetry.sub.LED_PWR (GY-521, DHT11
 * module, ACS712), the KY-040 shaft turns with values.angle (else the
 * 'position' param) and sinks when pressed, the KY-023 stick tilts with
 * the x / y inputs and sinks when pressed.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance, ComponentTelemetry } from '../../../model/types'
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import { registerMeshBuilder } from '../registry'
import {
  BuildResult,
  HOLE_DEPTH,
  brushedRoughnessTexture,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  etchedLabelMaterial,
  fakeLotCode,
  makeWireMaterial,
  markShared,
  mergeStatic,
  moldedEpoxy,
  plastic,
  roundedPath,
} from '../shared'
import { LED_COLORS } from '../semis'
import { applyIndicator, indicatorHalo, ledPerceived, lightOf, type LedHaloRig } from '../led-look'
import {
  MM,
  PcbPainter,
  boardEdgeGeometries,
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
  stadiumShape,
  trianglesGeometry,
} from '../pcb'
import type { PcbArtStyle } from '../pcb'

type V3 = THREE.Vector3
type Pt = readonly [number, number]
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const isGhost = (comp: ComponentInstance) => comp.id === '__ghost__'

// ---------------------------------------------------------------------------
// Module stack-up (mm): 2.5 mm header plastic on the breadboard, 1.6 mm PCB
// ---------------------------------------------------------------------------

const PITCH = 2.54
const SPACER = 2.5
const PCB_T = 1.6
const Y_BOT = SPACER * MM
const Y_TOP = (SPACER + PCB_T) * MM
/** every top-side package floats this far above the art quad (never coplanar) */
const LIFT = 0.004
const EDGE_CHAMFER = 0.15
/** short header pin ends proud of the PCB top (3.0 mm short end − 1.6 mm board) */
const PIN_PROUD = 1.4
/** plan-space top of the header posts of every flat module */
export const MODULE_HEADER_TOP = Y_TOP + PIN_PROUD * MM

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Cached metal / dielectric finish (see the metal-finish notes in boards.ts). */
function finish(key: string, color: number, roughness: number, metalness: number, brushed = false): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`sens-finish:${key}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness })
    const r = brushed ? brushedRoughnessTexture() : null
    if (r) m.roughnessMap = r
    return m
  })
}
/** tinned header posts proud of the joints (rough: small facets average the env) */
const tinnedPost = () => finish('post', 0xd8dce0, 0.7, 0.7, true)
/** matte tin: package leads, chip terminations */
const leadTin = () => finish('lead', 0x8a8f95, 0.7, 0.3, true)
/** stamped steel flats (lids, encoder frame, switch plates) */
const satinSteel = () => finish('satin', 0x9ea3a9, 0.55, 0.6, true)
/** drawn aluminium transducer cans / bright nickel */
const aluminium = () => finish('alu', 0xc4c8cd, 0.42, 1.0)
const darkRecess = () => finish('recess', 0x0c0c0e, 0.8, 0)
const ledSubstrate = () => finish('led-sub', 0xf1ede2, 0.45, 0)
const chipResistor = () => finish('0603-r', 0x16161a, 0.5, 0)
const mlcc = () => finish('0603-c', 0xa88a62, 0.62, 0)
const smdBlack = () => plastic(0x1b1b1e, 0.52)
/** thin lead ribbons are single quads: lit from both sides */
const leadRibbon = () =>
  cachedMaterial('sens-lead-ribbon', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x8a8f95, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide })
    const r = brushedRoughnessTexture()
    if (r) m.roughnessMap = r
    return m
  })
/** plated through-hole barrel, seen from inside the hole */
const barrelMaterial = () =>
  cachedMaterial('sens-barrel', () => new THREE.MeshPhysicalMaterial({ color: 0xb4b7ba, roughness: 0.6, metalness: 0.75, side: THREE.BackSide }))
/** inside walls of recesses (transducer mouths) */
const innerDark = () =>
  cachedMaterial('sens-inner-dark', () => new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.85, metalness: 0, side: THREE.BackSide }))

/**
 * Cached canvas-textured material (color map + matching bump), node-safe:
 * headless it is the plain `base` color.
 */
function canvasMaterial(
  key: string,
  w: number,
  h: number,
  base: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, bump: boolean) => void,
  opts: { roughness?: number; metalness?: number; bumpScale?: number } = {},
): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`sens-canvas:${key}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: base, roughness: opts.roughness ?? 0.5, metalness: opts.metalness ?? 0 })
    if (typeof document === 'undefined') return m
    const mk = (bump: boolean): THREE.CanvasTexture | null => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      paint(ctx, w, h, bump)
      const t = new THREE.CanvasTexture(c)
      if (!bump) t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      markShared(t)
      return t
    }
    const map = mk(false)
    const bump = mk(true)
    if (map) {
      m.map = map
      m.color.set(0xffffff)
    }
    if (bump) {
      m.bumpMap = bump
      m.bumpScale = opts.bumpScale ?? 0.6
    }
    return m
  })
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

interface Frame {
  c: V3
  yaw: number
  cos: number
  sin: number
}

/** Frame centred on the header pins `idx`, +x from the first to the last of them. */
function frameOn(pins: V3[], idx: number[]): Frame {
  const hp = idx.map((i) => pins[i]).filter((p): p is V3 => !!p)
  const c = centroidOf(hp.length ? hp : pins)
  const a = hp[0]
  const b = hp[hp.length - 1]
  let yaw = 0
  if (a && b && Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) yaw = Math.atan2(-(b.z - a.z), b.x - a.x)
  return { c: V(c.x, 0, c.z), yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Frame-local millimetre (x, z) of a world point. */
function toFrameMm(f: Frame, p: V3): [number, number] {
  const dx = p.x - f.c.x
  const dz = p.z - f.c.z
  return [(dx * f.cos - dz * f.sin) / MM, (dx * f.sin + dz * f.cos) / MM]
}

/** World point of a frame-local (x mm, y plan units, z mm). */
function toWorld(f: Frame, xMm: number, y: number, zMm: number): V3 {
  const x = xMm * MM
  const z = zMm * MM
  return V(f.c.x + x * f.cos + z * f.sin, y, f.c.z - x * f.sin + z * f.cos)
}

/** Header pin x positions (mm), centred: n pins at 2.54 mm. */
const headerXs = (n: number) => range(n).map((i) => (i - (n - 1) / 2) * PITCH)

/** (lx, lz) rotated clockwise on screen by `deg` (plan view, +z toward the viewer). */
function rot2(lx: number, lz: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [lx * Math.cos(r) - lz * Math.sin(r), lx * Math.sin(r) + lz * Math.cos(r)]
}

// ---------------------------------------------------------------------------
// Static collection + per-design cache
// ---------------------------------------------------------------------------

class Parts {
  readonly list: THREE.Object3D[] = []
  /** Mesh at frame (x mm, y units, z mm), turned `deg` clockwise in plan view. */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, xMm: number, y: number, zMm: number, deg = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(xMm * MM, y, zMm * MM)
    if (deg) m.rotation.y = (-deg * Math.PI) / 180
    this.list.push(m)
    return m
  }
  put<T extends THREE.Object3D>(o: T, xMm: number, y: number, zMm: number): T {
    o.position.set(xMm * MM, y, zMm * MM)
    this.list.push(o)
    return o
  }
}

interface StaticPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

const staticCache = new Map<string, StaticPart[]>()

/** Build + merge a design's static parts once per page (shared, never disposed). */
function statics(key: string, build: (P: Parts) => void): StaticPart[] {
  let s = staticCache.get(key)
  if (!s) {
    const P = new Parts()
    build(P)
    s = mergeStatic(P.list).map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
    staticCache.set(key, s)
  }
  return s
}

/** Instance group at the frame with the design's merged statics. */
function frameGroup(f: Frame, parts: StaticPart[]): THREE.Group {
  const g = new THREE.Group()
  g.position.copy(f.c)
  g.rotation.y = f.yaw
  for (const s of parts) g.add(new THREE.Mesh(s.geometry, s.material))
  return g
}

// ---------------------------------------------------------------------------
// Board art adapter (frame millimetres → board-centred painter)
// ---------------------------------------------------------------------------

class Art {
  constructor(
    private readonly p: PcbPainter,
    private readonly ox: number,
    private readonly oz: number,
  ) {}
  private q = (v: Pt): Pt => [v[0] - this.ox, v[1] - this.oz]
  traces(paths: Pt[][], w = 0.25): void {
    this.p.traces(paths.map((path) => path.map(this.q)), w)
  }
  copper(x: number, z: number, w: number, h: number): void {
    this.p.copperRect(x - this.ox, z - this.oz, w, h)
  }
  via(x: number, z: number, r = 0.3): void {
    this.p.via(x - this.ox, z - this.oz, r)
  }
  pad(x: number, z: number, r: number): void {
    this.p.padCircle(x - this.ox, z - this.oz, r)
  }
  padRect(x: number, z: number, w: number, h: number, rotDeg = 0): void {
    this.p.padRect(x - this.ox, z - this.oz, w, h, (rotDeg * Math.PI) / 180)
  }
  silk(
    text: string,
    x: number,
    z: number,
    size: number,
    opts: { rot?: number; align?: CanvasTextAlign; weight?: number; stroke?: number; condense?: number } = {},
  ): void {
    this.p.silkText(text, x - this.ox, z - this.oz, size, { weight: 400, stroke: 0.05, condense: 0.92, ...opts })
  }
  line(pts: Pt[], w = 0.15, closed = false): void {
    this.p.silkLine(pts.map(this.q), w, closed)
  }
  rect(x: number, z: number, w: number, h: number, lw = 0.15, rotDeg = 0): void {
    this.p.silkRect(x - this.ox, z - this.oz, w, h, lw, (rotDeg * Math.PI) / 180)
  }
  dot(x: number, z: number, r: number): void {
    this.p.silkDot(x - this.ox, z - this.oz, r)
  }
}

/** Header pads (square pin 1) + optional vertical pin legends above them. */
function headerArt(a: Art, xs: number[], labels?: string[], size = 0.82): void {
  xs.forEach((x, i) => (i === 0 ? a.padRect(x, 0, 1.7, 1.7) : a.pad(x, 0, 0.85)))
  if (labels) {
    xs.forEach((x, i) => {
      // reads bottom → top, starting just above the pad
      if (labels[i]) a.silk(labels[i], x, -1.35, size, { rot: -Math.PI / 2, align: 'left' })
    })
  }
}

/** 0603 land pattern turned `deg` clockwise. */
function chipPads(a: Art, x: number, z: number, deg: number): void {
  for (const s of [-1, 1]) {
    const [dx, dz] = rot2(s * 0.8, 0, deg)
    a.padRect(x + dx, z + dz, 0.9, 0.95, deg)
  }
}

/** SOT-23 land pattern (two leads on local −z, one on +z) turned `deg`. */
function sot23Pads(a: Art, x: number, z: number, deg: number): void {
  for (const [lx, lz] of [
    [-0.95, -1.05],
    [0.95, -1.05],
    [0, 1.05],
  ] as const) {
    const [dx, dz] = rot2(lx, lz, deg)
    a.padRect(x + dx, z + dz, 0.6, 0.9, deg)
  }
}

// ---------------------------------------------------------------------------
// Board, header and package builders (static parts, frame millimetres)
// ---------------------------------------------------------------------------

interface Hole {
  x: number
  z: number
  r: number
}

interface BoardSpec {
  key: string
  /** board size along x / z (mm) */
  w: number
  d: number
  /** board centre in the frame (mm) */
  cx: number
  cz: number
  style: PcbArtStyle
  /** the same mask seen edge-on / underneath */
  edge: number
  holes?: Hole[]
  paint: (a: Art) => void
}

/**
 * Board face with real round holes punched through (UVs registered to the
 * board's millimetre frame like boardTopGeometry). `down` = the bottom face.
 */
function holedPlate(key: string, w: number, d: number, inset: number, holes: Hole[], down: boolean): THREE.BufferGeometry {
  return cachedGeometry(`sens-plate:${key}:${down ? 'bot' : 'top'}`, () => {
    const hw = (w / 2 - inset) * MM
    const hd = (d / 2 - inset) * MM
    const s = new THREE.Shape()
    s.moveTo(-hw, -hd)
    s.lineTo(hw, -hd)
    s.lineTo(hw, hd)
    s.lineTo(-hw, hd)
    s.closePath()
    for (const h of holes) {
      const p = new THREE.Path()
      // top: shape y = −z (rotated −90° about x); bottom: shape y = +z
      p.absarc(h.x * MM, (down ? h.z : -h.z) * MM, h.r * MM, 0, Math.PI * 2, true)
      s.holes.push(p)
    }
    const g = new THREE.ShapeGeometry(s, 10)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) / MM + w / 2) / w, (pos.getY(i) / MM + d / 2) / d)
    }
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2)
    return g
  })
}

function boardParts(P: Parts, spec: BoardSpec): void {
  const holes = spec.holes ?? []
  const local = holes.map((h) => ({ x: h.x - spec.cx, z: h.z - spec.cz, r: h.r }))
  const art = pcbArtMaterial(`sensors-${spec.key}`, spec.w, spec.d, spec.style, (p) => spec.paint(new Art(p, spec.cx, spec.cz)), {
    pxPerMm: 64,
  })
  P.add(holedPlate(spec.key, spec.w, spec.d, EDGE_CHAMFER, local, false), art, spec.cx, Y_TOP, spec.cz)
  const edge = boardEdgeGeometries(spec.w, spec.d, PCB_T, EDGE_CHAMFER)
  P.add(edge.fr4, fr4EdgeMaterial(), spec.cx, Y_BOT, spec.cz)
  P.add(edge.mask, maskMaterial(spec.edge), spec.cx, Y_BOT, spec.cz)
  P.add(holedPlate(spec.key, spec.w, spec.d, 0, local, true), maskMaterial(spec.edge), spec.cx, Y_BOT, spec.cz)
  for (const h of holes) {
    const barrel = cachedGeometry(`sens-barrel:${h.r}`, () => {
      const g = new THREE.CylinderGeometry(h.r * MM, h.r * MM, PCB_T * MM, 16, 1, true)
      g.translate(0, (PCB_T * MM) / 2, 0)
      return g
    })
    P.add(barrel, barrelMaterial(), h.x, Y_BOT, h.z)
  }
}

/** Plated ring around each mounting hole (art). */
function holeRings(a: Art, holes: Hole[]): void {
  for (const h of holes) a.pad(h.x, h.z, h.r + 0.65)
}

/**
 * Straight 2.54 mm header soldered with its plastic on the bottom: one
 * molded strip under the PCB along the row, the short pin ends proud of the
 * top in concave tin fillets (the long ends sit in the breadboard).
 */
function headerParts(P: Parts, xs: number[]): void {
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const strip = slabGeometry((x1 - x0 + PITCH) * MM - 0.004, SPACER * MM - 0.004, 2.5 * MM, { top: true, bottom: true })
  P.add(strip, headerPlasticMaterial(), (x0 + x1) / 2, (SPACER * MM) / 2 + 0.002, 0)
  const tip = headerPostGeometry(0.32 * MM, PIN_PROUD * MM, 0.16 * MM)
  const fillet = solderFilletGeometry(0.8 * MM, 0.36 * MM, 0.55 * MM)
  for (const x of xs) {
    P.add(tip, tinnedPost(), x, Y_TOP, 0)
    P.add(fillet, solderMaterial(), x, Y_TOP + 0.002, 0)
  }
}

/** 0603 chip part on the board top. */
function chip(P: Parts, x: number, z: number, deg: number, kind: 'R' | 'C', yBase = Y_TOP + LIFT): void {
  const g = new THREE.Group()
  for (const o of chip0603(kind === 'R' ? chipResistor() : mlcc(), leadTin(), kind === 'R' ? 0.45 : 0.8)) g.add(o)
  g.rotation.y = (-deg * Math.PI) / 180
  P.put(g, x, yBase, z)
}

/** 0805 chip resistor (2.0 × 1.25 mm), long axis turned `deg`. */
function chip0805(P: Parts, x: number, z: number, deg: number): void {
  const g = new THREE.Group()
  const L = 2.0 * MM
  const W = 1.25 * MM
  const H = 0.5 * MM
  const e = 0.4 * MM
  const body = new THREE.Mesh(slabGeometry(L - 2 * e + 0.02 * MM, H * 0.98, W * 0.98, { bottom: true }), chipResistor())
  body.position.y = (H * 0.98) / 2
  g.add(body)
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(slabGeometry(e, H, W, { bottom: true }), leadTin())
    cap.position.set(sx * (L / 2 - e / 2), H / 2, 0)
    g.add(cap)
  }
  g.rotation.y = (-deg * Math.PI) / 180
  P.put(g, x, Y_TOP + LIFT, z)
}

/** SOT-23 (2.9 × 1.3 × 1.0 mm) with gull-wing leads, turned `deg`. */
function sot23(P: Parts, x: number, z: number, deg: number): void {
  const g = new THREE.Group()
  const body = new THREE.Mesh(slabGeometry(2.9 * MM, 0.95 * MM, 1.3 * MM, { bottom: true }), smdBlack())
  body.position.y = 0.1 * MM
  g.add(body)
  const foot = slabGeometry(0.4 * MM, 0.12 * MM, 0.55 * MM, { bottom: true })
  const rise = slabGeometry(0.4 * MM, 0.5 * MM, 0.14 * MM, { bottom: true })
  for (const [lx, sz] of [
    [-0.95, -1],
    [0.95, -1],
    [0, 1],
  ] as const) {
    const f = new THREE.Mesh(foot, leadTin())
    f.position.set(lx * MM, 0, sz * 1.05 * MM)
    g.add(f)
    const r = new THREE.Mesh(rise, leadTin())
    r.position.set(lx * MM, 0.05 * MM, sz * 0.72 * MM)
    g.add(r)
  }
  g.rotation.y = (-deg * Math.PI) / 180
  P.put(g, x, Y_TOP + LIFT, z)
}

/** QFN body (`size` square, `h` tall) with the tin terminals showing at its foot. */
function qfn(P: Parts, x: number, z: number, size: number, h: number): void {
  P.add(slabGeometry(size * MM, h * MM, size * MM, { bottom: true }), qfpMoldMaterial(), x, Y_TOP + LIFT + (h * MM) / 2, z)
  const strip = slabGeometry(size * 0.84 * MM, 0.2 * MM, 0.1 * MM, { bottom: true })
  for (const s of [-1, 1]) {
    P.add(strip, leadTin(), x, Y_TOP + LIFT + 0.1 * MM, z + s * (size / 2 + 0.03))
    P.add(strip, leadTin(), x + s * (size / 2 + 0.03), Y_TOP + LIFT + 0.1 * MM, z, 90)
  }
}

/**
 * SOIC gull-wing lead set in the package frame (body long axis x, leads
 * exiting ±z, feet at y = 0): one bent ribbon per lead (shoulder → knee →
 * foot, 3 quads) — at 0.42 mm a full extruded leg costs 4× the triangles.
 */
function soicLeadsGeometry(n: number, bodyW: number): THREE.BufferGeometry {
  return cachedGeometry(`sens-soic-leads:${n}:${bodyW}`, () => {
    const p: number[] = []
    const hw = 0.21 * MM
    const e = (bodyW / 2) * MM
    const yS = 0.72 * MM
    const yF = 0.18 * MM
    const zs = e - 0.05 * MM
    const zk = e + 0.25 * MM
    const zf = e + 0.55 * MM
    const zt = 3.0 * MM
    const per = n / 2
    const quad = (a: number[], b: number[], c: number[], d: number[]) => p.push(...a, ...b, ...c, ...a, ...c, ...d)
    for (const s of [-1, 1]) {
      for (let k = 0; k < per; k++) {
        const x = (k - (per - 1) / 2) * 1.27 * MM
        quad([x - hw, yS, s * zs], [x + hw, yS, s * zs], [x + hw, yS, s * zk], [x - hw, yS, s * zk])
        quad([x - hw, yS, s * zk], [x + hw, yS, s * zk], [x + hw, yF, s * zf], [x - hw, yF, s * zf])
        quad([x - hw, yF, s * zf], [x + hw, yF, s * zf], [x + hw, yF, s * zt], [x - hw, yF, s * zt])
      }
    }
    return trianglesGeometry(p)
  })
}

/** SOIC-n package (long axis x, 3.9 mm body) as a detached group, feet at y = 0. */
function soicGroup(n: number, bodyL: number): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(slabGeometry(bodyL * MM, 1.45 * MM, 3.9 * MM, { bottom: true }), qfpMoldMaterial())
  body.position.y = (0.1 + 0.725) * MM
  g.add(body)
  g.add(new THREE.Mesh(soicLeadsGeometry(n, 3.9), leadRibbon()))
  const dimple = new THREE.Mesh(
    cachedGeometry('sens-soic-dimple', () => {
      const c = new THREE.CircleGeometry(0.35 * MM, 12)
      c.rotateX(-Math.PI / 2)
      return c
    }),
    darkRecess(),
  )
  dimple.position.set((-bodyL / 2 + 0.8) * MM, 1.55 * MM + 0.002, 1.0 * MM)
  g.add(dimple)
  return g
}

/** SOIC land pattern (long axis x unless `deg`). */
function soicPads(a: Art, x: number, z: number, n: number, deg = 0): void {
  const per = n / 2
  for (const s of [-1, 1]) {
    for (let k = 0; k < per; k++) {
      const [dx, dz] = rot2((k - (per - 1) / 2) * 1.27, s * 2.7, deg)
      a.padRect(x + dx, z + dz, 0.6, 1.5, deg)
    }
  }
}

/** 0603 LED body (substrate + terminations); the lens is per instance. */
function ledBody(P: Parts, x: number, z: number): void {
  P.add(slabGeometry(1.1 * MM, 0.3 * MM, 0.8 * MM, { bottom: true }), ledSubstrate(), x, Y_TOP + LIFT + 0.15 * MM, z)
  for (const s of [-1, 1]) {
    P.add(slabGeometry(0.25 * MM, 0.55 * MM, 0.8 * MM, { bottom: true }), leadTin(), x + s * 0.675, Y_TOP + LIFT + 0.275 * MM, z)
  }
}

/** KF301-type 2-position screw terminal (5.08 mm), wire entries facing −z. */
const TB_H = 10.0
const TB_D = 7.6
/** clamp screw head proud of the top step (mm) */
const TB_SCREW = 0.35
function terminalBlock(P: Parts, x: number, z: number): void {
  const blue = plastic(0x2160c4, 0.42)
  const w = 2 * 5.08 - 0.1
  // lower block (wire clamps) + stepped upper block carrying the screws
  P.add(slabGeometry(w * MM, 7.0 * MM, TB_D * MM, { bottom: true }), blue, x, Y_TOP + LIFT + 3.5 * MM, z)
  P.add(slabGeometry(w * MM, (TB_H - 7.0) * MM, 5.2 * MM, { bottom: true }), blue, x, Y_TOP + LIFT + (7.0 + (TB_H - 7.0) / 2) * MM, z + 1.2)
  for (const s of [-1, 1]) {
    const sx = x + s * 2.54
    // wire entry opening on the −z face
    const mouth = new THREE.Mesh(
      cachedGeometry('sens-tb-mouth', () => new THREE.PlaneGeometry(3.4 * MM, 3.2 * MM)),
      darkRecess(),
    )
    mouth.rotation.y = Math.PI
    P.put(mouth, sx, Y_TOP + LIFT + 3.1 * MM, z - TB_D / 2 - 0.02)
    // screw tower: dark ring around the clamp screw, the screw head proud of
    // the top step by TB_SCREW with its slot
    P.add(
      cachedGeometry('sens-tb-well', () => {
        const c = new THREE.RingGeometry(1.75 * MM, 2.15 * MM, 18)
        c.rotateX(-Math.PI / 2)
        return c
      }),
      darkRecess(),
      sx,
      Y_TOP + LIFT + TB_H * MM + 0.002,
      z + 1.2,
    )
    P.add(
      cachedGeometry('sens-tb-screw', () => {
        const c = new THREE.CylinderGeometry(1.7 * MM, 1.75 * MM, (TB_SCREW + 0.3) * MM, 18)
        c.translate(0, ((TB_SCREW + 0.3) * MM) / 2, 0)
        return c
      }),
      satinSteel(),
      sx,
      Y_TOP + LIFT + (TB_H - 0.3) * MM,
      z + 1.2,
    )
    P.add(flatQuadGeometry(3.0 * MM, 0.5 * MM), darkRecess(), sx, Y_TOP + LIFT + (TB_H + TB_SCREW) * MM + 0.003, z + 1.2, 35)
  }
}

// ---------------------------------------------------------------------------
// Per-instance LED (emissive lens + the shared glow halo, like the Blue Pill)
// ---------------------------------------------------------------------------

interface LedRig {
  lens: THREE.MeshPhysicalMaterial
  /** the shared LED glow halo (led-look.ts), null on a ghost */
  halo: LedHaloRig | null
  tint: number
  burned: boolean
}

const LENS_TINT: Record<string, number> = { red: 0xf4d2cc, green: 0xd6efd4 }

function addLed(group: THREE.Group, ghost: boolean, xMm: number, zMm: number, colorName: 'red' | 'green', yTop = Y_TOP): LedRig {
  const color = LED_COLORS[colorName]
  const tint = LENS_TINT[colorName]
  const lens = ghost
    ? (cachedMaterial(`sens-led-lens:${colorName}`, () => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.15, metalness: 0 })) as THREE.MeshPhysicalMaterial)
    : new THREE.MeshPhysicalMaterial({
        color: tint,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.28,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0,
      })
  const lensMesh = new THREE.Mesh(
    slabGeometry(1.1 * MM, 0.32 * MM, 0.78 * MM, { bottom: true }),
    lens,
  )
  lensMesh.position.set(xMm * MM, yTop + LIFT + 0.46 * MM, zMm * MM)
  group.add(lensMesh)
  const halo = indicatorHalo(color, new THREE.Vector3(xMm * MM, yTop + 0.3, zMm * MM), ghost)
  if (halo) group.add(halo.halo)
  return { lens, halo, tint, burned: false }
}

function applyLed(rig: LedRig, t: ComponentTelemetry | undefined, ghost: boolean): void {
  if (ghost) return
  if (t?.burned) {
    if (!rig.burned) {
      rig.burned = true
      rig.lens.color.setHex(0x3a3631)
      rig.lens.emissiveIntensity = 0
      rig.halo?.apply(0)
    }
    return
  }
  if (rig.burned) {
    rig.burned = false
    rig.lens.color.setHex(rig.tint)
  }
  // the REAL LED current / 20 mA (indicator LEDs run at 1–3 mA) in the one
  // brightness language of every LED (led-look.ts)
  applyIndicator(rig, Math.min(ledPerceived(lightOf(t)), 1.3))
}

/** Etched marking quad on a package top (shared material, per-instance mesh). */
function marking(group: THREE.Group, lines: string[], aspect: number, wMm: number, hMm: number, xMm: number, y: number, zMm: number, deg = 0): void {
  const mat = etchedLabelMaterial(lines, aspect)
  if (!mat) return
  const m = new THREE.Mesh(flatQuadGeometry(wMm * MM, hMm * MM), mat)
  m.position.set(xMm * MM, y, zMm * MM)
  if (deg) m.rotation.y = (-deg * Math.PI) / 180
  group.add(m)
}

// ===========================================================================
// GY-521 (MPU-6050): 21.2 × 16.4 mm blue board, 8-pin header on a long edge
// ===========================================================================

const GY521 = { w: 21.2, d: 16.4, near: 1.5 }
const GY521_XS = headerXs(8)
const GY521_LABELS = ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT']
const GY521_CZ = GY521.near - GY521.d / 2
const GY521_HOLES: Hole[] = [
  { x: -7.9, z: -12.4, r: 1.5 },
  { x: 7.9, z: -12.4, r: 1.5 },
]
const MPU = { x: 0.6, z: -8.6 }
const GY521_LDO = { x: -5.4, z: -8.2 }
const GY521_LED = { x: 4.4, z: -13.4 }
const GY521_CHIPS: { x: number; z: number; deg: number; kind: 'R' | 'C' }[] = [
  { x: -6.35, z: -5.6, deg: 90, kind: 'R' }, // SCL pull-up
  { x: -4.45, z: -5.6, deg: 90, kind: 'R' }, // SDA pull-up
  { x: 4.45, z: -5.6, deg: 90, kind: 'R' }, // XDA / XCL pull-ups
  { x: 6.35, z: -5.6, deg: 90, kind: 'R' },
  { x: 8.25, z: -5.6, deg: 90, kind: 'R' }, // AD0 pull-down
  { x: -2.4, z: -11.6, deg: 0, kind: 'C' }, // VDD / REGOUT / CPOUT caps
  { x: 3.6, z: -9.6, deg: 90, kind: 'C' },
  { x: -2.6, z: -6.2, deg: 0, kind: 'C' },
  { x: -7.6, z: -9.0, deg: 90, kind: 'C' }, // LDO in / out
  { x: -3.4, z: -9.0, deg: 90, kind: 'C' },
  { x: 4.4, z: -11.7, deg: 0, kind: 'R' }, // LED series resistor
]

function paintGy521(a: Art): void {
  // copper: header lanes between the legends up to the pull-up row, the I²C
  // pair into the QFN, VCC to the LDO, a GND stub with stitching vias
  const lanes: Pt[][] = []
  GY521_XS.forEach((x, i) => {
    if (i === 1) return
    lanes.push([
      [x, 0],
      [x + 0.6, -0.9],
      [x + 0.6, -3.9],
    ])
  })
  lanes.push([[GY521_XS[2] + 0.6, -3.9], [-6.35, -4.6]])
  lanes.push([[GY521_XS[3] + 0.6, -3.9], [-4.45, -4.6]])
  lanes.push([[-6.35, -6.6], [-6.35, -7.0], [MPU.x - 2.6, -7.6], [MPU.x - 2.4, MPU.z]])
  lanes.push([[-4.45, -6.6], [MPU.x - 1.6, -6.9], [MPU.x - 0.25, -6.4]])
  lanes.push([[GY521_XS[0] + 0.6, -3.9], [GY521_LDO.x - 1.6, -6.4], [GY521_LDO.x - 1.05, GY521_LDO.z - 0.95]])
  lanes.push([[GY521_XS[7] + 0.6, -3.9], [9.4, -5.0], [9.4, -9.0], [MPU.x + 2.4, -9.0]])
  lanes.push([[GY521_XS[6] + 0.6, -3.9], [8.25, -4.6]])
  lanes.push([[GY521_XS[4] + 0.6, -3.9], [4.45, -4.6]])
  lanes.push([[GY521_XS[5] + 0.6, -3.9], [6.35, -4.6]])
  lanes.push([[GY521_LDO.x + 1.05, GY521_LDO.z], [-3.4, -9.8], [MPU.x - 2.4, -9.6]])
  lanes.push([[GY521_LED.x, -12.5], [GY521_LED.x, -12.6]])
  a.traces(lanes, 0.25)
  a.copper(GY521_XS[1], -2.2, 1.2, 4.4)
  for (const z of [-3.4, -4.4]) a.via(GY521_XS[1], z, 0.3)
  for (const [x, z] of [
    [-1.6, -12.8],
    [2.4, -12.9],
    [-8.9, -7.0],
    [9.6, -11.0],
  ] as const) {
    a.via(x, z, 0.3)
  }
  headerArt(a, GY521_XS, GY521_LABELS)
  holeRings(a, GY521_HOLES)
  // QFN24 land pattern (0.5 mm pitch) + thermal pad
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < 6; k++) {
      const off = (k - 2.5) * 0.5
      const [lx, lz] = side === 0 ? [-2.05, off] : side === 1 ? [off, 2.05] : side === 2 ? [2.05, -off] : [-off, -2.05]
      a.padRect(MPU.x + lx, MPU.z + lz, side % 2 === 0 ? 0.75 : 0.28, side % 2 === 0 ? 0.28 : 0.75)
    }
  }
  sot23Pads(a, GY521_LDO.x, GY521_LDO.z, 90)
  for (const c of GY521_CHIPS) chipPads(a, c.x, c.z, c.deg)
  for (const s of [-1, 1]) a.padRect(GY521_LED.x + s * 0.8, GY521_LED.z, 0.9, 0.95)
  // silkscreen: board name, chip outline corner marks, accelerometer axes
  a.silk('GY-521', -3.2, -13.9, 1.15)
  a.dot(MPU.x - 2.7, MPU.z - 2.7, 0.22)
  const ax = 6.2
  const az = -12.6
  a.line([
    [ax, az],
    [ax + 2.6, az],
  ])
  a.line([
    [ax + 2.0, az - 0.5],
    [ax + 2.6, az],
    [ax + 2.0, az + 0.5],
  ])
  a.line([
    [ax, az],
    [ax, az - 2.6],
  ])
  a.line([
    [ax - 0.5, az - 2.0],
    [ax, az - 2.6],
    [ax + 0.5, az - 2.0],
  ])
  a.silk('X', ax + 3.2, az, 0.8)
  a.silk('Y', ax, az - 3.2, 0.8)
  a.rect(GY521_LED.x, GY521_LED.z, 2.6, 1.4, 0.12)
}

function gy521Statics(): StaticPart[] {
  return statics('gy521', (P) => {
    boardParts(P, {
      key: 'gy521',
      w: GY521.w,
      d: GY521.d,
      cx: 0,
      cz: GY521_CZ,
      style: { mask: '#13388a', maskCopper: '#1a4299', pad: '#b4b7ba', silk: '#ecebe2', drill: '#0a1a3d' },
      edge: 0x0e2a66,
      holes: GY521_HOLES,
      paint: paintGy521,
    })
    headerParts(P, GY521_XS)
    qfn(P, MPU.x, MPU.z, 4.0, 0.9)
    sot23(P, GY521_LDO.x, GY521_LDO.z, 90)
    for (const c of GY521_CHIPS) chip(P, c.x, c.z, c.deg, c.kind)
    ledBody(P, GY521_LED.x, GY521_LED.z)
  })
}

function buildGy521(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const ghost = isGhost(comp)
  const f = frameOn(pins, range(8))
  const group = frameGroup(f, gy521Statics())
  if (!ghost) {
    marking(group, ['MPU-6050', fakeLotCode('MPU6050')], 1.9, 3.3, 1.75, MPU.x, Y_TOP + LIFT + 0.9 * MM + 0.004, MPU.z)
    marking(group, ['662K'], 2.2, 2.2, 1.0, GY521_LDO.x, Y_TOP + LIFT + 1.05 * MM + 0.004, GY521_LDO.z, 90)
  }
  const led = addLed(group, ghost, GY521_LED.x, GY521_LED.z, 'red')
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (_c, _e, t) => applyLed(led, t?.sub?.LED_PWR, ghost),
  }
}

// ===========================================================================
// GY-BMP280 / GY-BME280: 15.0 × 11.4 mm purple board, 6-pin header
// ===========================================================================

const BMX = { w: 15.0, d: 11.4, near: 1.4 }
const BMX_XS = headerXs(6)
const BMX_CZ = BMX.near - BMX.d / 2
const BMX_HOLES: Hole[] = [
  { x: -5.5, z: -7.3, r: 1.1 },
  { x: 5.5, z: -7.3, r: 1.1 },
]
const BMX_SENSOR = { x: 0, z: -6.7 }
const BMX_CHIPS: { x: number; z: number; deg: number; kind: 'R' | 'C' }[] = [
  { x: -5.1, z: -4.2, deg: 90, kind: 'R' },
  { x: -2.55, z: -4.2, deg: 90, kind: 'R' },
  { x: 2.55, z: -4.2, deg: 90, kind: 'R' },
  { x: 5.1, z: -4.2, deg: 90, kind: 'R' },
  { x: -2.6, z: -6.7, deg: 90, kind: 'C' },
  { x: 2.6, z: -6.7, deg: 90, kind: 'C' },
]

function paintBmx(a: Art, name: string): void {
  const lanes: Pt[][] = []
  BMX_XS.forEach((x, i) => {
    if (i === 1) return
    lanes.push([
      [x, 0],
      [x + 0.55, -0.9],
      [x + 0.55, -2.8],
    ])
  })
  lanes.push([[-5.1, -5.0], [-1.6, -5.6], [-0.9, BMX_SENSOR.z]])
  lanes.push([[5.1, -5.0], [1.6, -5.6], [0.9, BMX_SENSOR.z]])
  lanes.push([[-2.6, -7.5], [-1.8, -8.4], [-0.4, -8.4], [-0.3, BMX_SENSOR.z - 1.0]])
  a.traces(lanes, 0.25)
  a.copper(BMX_XS[1], -1.9, 1.1, 3.8)
  a.via(BMX_XS[1], -3.4, 0.3)
  headerArt(a, BMX_XS)
  holeRings(a, BMX_HOLES)
  // LGA-8 lands under the lid
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) a.padRect(BMX_SENSOR.x + s * 0.95, BMX_SENSOR.z + (k - 1.5) * 0.65, 0.45, 0.35)
  for (const c of BMX_CHIPS) chipPads(a, c.x, c.z, c.deg)
  // pin legends between the pads and the resistor row, board name at the far edge
  const labels = ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO']
  BMX_XS.forEach((x, i) => a.silk(labels[i], x, -2.45, 0.66))
  a.silk(name, 0, -9.25, 0.72)
}

function bmxStatics(type: string): StaticPart[] {
  const bme = type === 'bme280'
  return statics(`bmx:${bme ? 'e' : 'p'}`, (P) => {
    boardParts(P, {
      key: bme ? 'gy-bme280' : 'gy-bmp280',
      w: BMX.w,
      d: BMX.d,
      cx: 0,
      cz: BMX_CZ,
      style: { mask: '#4a1d78', maskCopper: '#55258a', pad: '#c0c2c4', silk: '#f1eff4', drill: '#1c0a30' },
      edge: 0x3a1460,
      holes: BMX_HOLES,
      paint: (a) => paintBmx(a, bme ? 'GY-BME280' : 'GY-BMP280-3.3'),
    })
    headerParts(P, BMX_XS)
    // Bosch LGA: ceramic base + stamped steel lid with the vent hole
    const w = bme ? 2.5 : 2.0
    const d = 2.5
    P.add(slabGeometry(w * MM, 0.28 * MM, d * MM, { bottom: true }), finish('lga-base', 0x3a3530, 0.6, 0), BMX_SENSOR.x, Y_TOP + LIFT + 0.14 * MM, BMX_SENSOR.z)
    P.add(slabGeometry((w - 0.12) * MM, 0.66 * MM, (d - 0.12) * MM, { bottom: true }), satinSteel(), BMX_SENSOR.x, Y_TOP + LIFT + (0.28 + 0.33) * MM, BMX_SENSOR.z)
    P.add(
      cachedGeometry('sens-bmx-vent', () => {
        const c = new THREE.CircleGeometry(0.22 * MM, 10)
        c.rotateX(-Math.PI / 2)
        return c
      }),
      darkRecess(),
      BMX_SENSOR.x + w / 2 - 0.55,
      Y_TOP + LIFT + 0.94 * MM + 0.002,
      BMX_SENSOR.z - d / 2 + 0.55,
    )
    for (const c of BMX_CHIPS) chip(P, c.x, c.z, c.deg, c.kind)
  })
}

function buildBmx280(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, range(6))
  return { object: frameGroup(f, bmxStatics(entry.type)), pinWorld: pins.map((p) => p.clone()) }
}

// ===========================================================================
// GY-302 (BH1750FVI): 13.9 × 18.5 mm blue board, 5-pin header on a short edge
// ===========================================================================

const GY302 = { w: 13.9, d: 18.5, near: 1.4 }
const GY302_XS = headerXs(5)
const GY302_CZ = GY302.near - GY302.d / 2
const GY302_HOLES: Hole[] = [{ x: 0, z: -14.3, r: 1.5 }]
const BH = { x: 0, z: -9.4 }
const GY302_LDO = { x: -3.9, z: -5.4 }
const GY302_CHIPS: { x: number; z: number; deg: number; kind: 'R' | 'C' }[] = [
  { x: -4.2, z: -9.0, deg: 90, kind: 'C' },
  { x: 4.2, z: -5.6, deg: 90, kind: 'C' },
  { x: 1.6, z: -5.2, deg: 0, kind: 'R' },
  { x: 4.2, z: -9.4, deg: 90, kind: 'R' },
  { x: 2.6, z: -11.9, deg: 0, kind: 'R' },
  { x: -2.6, z: -11.9, deg: 0, kind: 'C' },
]

function paintGy302(a: Art): void {
  const lanes: Pt[][] = []
  GY302_XS.forEach((x, i) => {
    if (i === 1) return
    lanes.push([
      [x, 0],
      [x + 0.6, -0.9],
      [x + 0.6, -3.2],
    ])
  })
  lanes.push([[GY302_XS[0] + 0.6, -3.2], [GY302_LDO.x - 0.95, GY302_LDO.z - 1.05]])
  lanes.push([[GY302_XS[2] + 0.6, -3.2], [-1.0, -7.0], [BH.x - 0.65, BH.z - 0.9]])
  lanes.push([[GY302_XS[3] + 0.6, -3.2], [1.9, -7.0], [BH.x + 0.65, BH.z - 0.9]])
  lanes.push([[GY302_XS[4] + 0.6, -3.2], [5.6, -4.0], [5.6, -10.6], [BH.x + 1.3, BH.z + 0.9]])
  lanes.push([[GY302_LDO.x, GY302_LDO.z + 1.05], [-4.2, -8.2], [BH.x - 1.3, BH.z + 0.9]])
  a.traces(lanes, 0.25)
  a.copper(GY302_XS[1], -2.0, 1.1, 4.0)
  for (const z of [-3.3]) a.via(GY302_XS[1], z, 0.3)
  a.via(-5.6, -12.5, 0.3)
  a.via(5.0, -13.6, 0.3)
  headerArt(a, GY302_XS, ['VCC', 'GND', 'SCL', 'SDA', 'ADDR'], 0.8)
  holeRings(a, GY302_HOLES)
  // WSOF6: three leads each long side
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) a.padRect(BH.x + (k - 1) * 0.65, BH.z + s * 1.05, 0.38, 0.7)
  sot23Pads(a, GY302_LDO.x, GY302_LDO.z, 0)
  for (const c of GY302_CHIPS) chipPads(a, c.x, c.z, c.deg)
  a.silk('GY-302', -4.1, -15.9, 0.9)
  a.rect(BH.x, BH.z, 4.2, 2.9, 0.12)
}

function gy302Statics(): StaticPart[] {
  return statics('gy302', (P) => {
    boardParts(P, {
      key: 'gy302',
      w: GY302.w,
      d: GY302.d,
      cx: 0,
      cz: GY302_CZ,
      style: { mask: '#15398a', maskCopper: '#1c4398', pad: '#b4b7ba', silk: '#ecebe2', drill: '#0a1a3d' },
      edge: 0x0e2a66,
      holes: GY302_HOLES,
      paint: paintGy302,
    })
    headerParts(P, GY302_XS)
    // BH1750FVI WSOF6I (3.0 × 1.6 × 0.7 mm): dark glossy mold with the
    // photodiode window, gull leads on the long sides
    P.add(slabGeometry(3.0 * MM, 0.62 * MM, 1.6 * MM, { bottom: true }), moldedEpoxy(0x18171a, 0.28), BH.x, Y_TOP + LIFT + 0.08 * MM + 0.31 * MM, BH.z)
    P.add(flatQuadGeometry(0.9 * MM, 0.75 * MM), finish('bh-window', 0x5b4a2e, 0.25, 0.2), BH.x - 0.45, Y_TOP + LIFT + 0.7 * MM + 0.002, BH.z)
    const leg = slabGeometry(0.3 * MM, 0.12 * MM, 0.5 * MM, { bottom: true })
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) P.add(leg, leadTin(), BH.x + (k - 1) * 0.65, Y_TOP + LIFT, BH.z + s * 0.98)
    sot23(P, GY302_LDO.x, GY302_LDO.z, 0)
    for (const c of GY302_CHIPS) chip(P, c.x, c.z, c.deg, c.kind)
  })
}

function buildGy302(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, range(5))
  const group = frameGroup(f, gy302Statics())
  if (!isGhost(comp)) marking(group, ['662K'], 2.2, 2.2, 1.0, GY302_LDO.x, Y_TOP + LIFT + 1.05 * MM + 0.004, GY302_LDO.z)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ===========================================================================
// DHT11 / DHT22 modules: 3-pin header (+ OUT −), the sensor lying on the
// board with its grille up and its legs bent down into the board
// ===========================================================================

interface DhtSpec {
  w: number
  d: number
  near: number
  /** sensor body: width (x), height (y), length (z) */
  body: [number, number, number]
  /** body near end (z) and the leg row (z) */
  bodyZ: number
  legsZ: number
  color: number
  led: boolean
  name: string
}

const DHT: Record<string, DhtSpec> = {
  dht11: { w: 14.0, d: 23.4, near: 1.3, body: [12.0, 5.5, 15.5], bodyZ: -6.4, legsZ: -5.0, color: 0x4b86d6, led: true, name: 'DHT11' },
  dht22: { w: 18.0, d: 30.3, near: 1.3, body: [15.1, 7.7, 25.0], bodyZ: -5.0, legsZ: -3.6, color: 0xeceae3, led: false, name: 'DHT22' },
}
const DHT_XS = headerXs(3)
const DHT_LED = { x: 3.9, z: -2.9 }
/** the 10 kΩ data pull-up */
const DHT_R = { x: -5.6, z: -2.6 }

/** plan-space tops of the DHT modules (the sensor body) */
export const DHT11_TOP = Y_TOP + LIFT + DHT.dht11.body[1] * MM + 0.002
export const DHT22_TOP = Y_TOP + LIFT + DHT.dht22.body[1] * MM + 0.002

function dhtGrilleMaterial(type: string): THREE.MeshPhysicalMaterial {
  const s = DHT[type]
  const dht11 = type === 'dht11'
  return canvasMaterial(
    `dht-grille:${type}`,
    256,
    Math.round((256 * (s.body[2] - 1.2)) / (s.body[0] - 1.2)),
    s.color,
    (ctx, w, h, bump) => {
      const body = bump ? '#b8b8b8' : dht11 ? '#4b86d6' : '#eceae3'
      const hole = bump ? '#222222' : dht11 ? '#0f1d33' : '#2a2a2c'
      ctx.fillStyle = body
      ctx.fillRect(0, 0, w, h)
      if (dht11) {
        // DHT11 front: a matrix of square openings over the humidity element
        const cols = 6
        const rows = 8
        const mx = w * 0.12
        const my = h * 0.12
        const cw = (w - 2 * mx) / cols
        const ch = (h - 2 * my) / rows
        ctx.fillStyle = hole
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ctx.fillRect(mx + c * cw + cw * 0.18, my + r * ch + ch * 0.18, cw * 0.64, ch * 0.64)
      } else {
        // AM2302 front: staggered narrow slots, the mounting hole at the far end
        const cols = 4
        const rows = 11
        const mx = w * 0.1
        const top = h * 0.2
        const bot = h * 0.05
        const cw = (w - 2 * mx) / cols
        const ch = (h - top - bot) / rows
        ctx.fillStyle = hole
        for (let r = 0; r < rows; r++) {
          const off = r % 2 ? cw * 0.5 : 0
          for (let c = 0; c < cols - (r % 2); c++) ctx.fillRect(mx + off + c * cw + cw * 0.12, top + r * ch + ch * 0.3, cw * 0.76, ch * 0.4)
        }
        ctx.beginPath()
        ctx.arc(w / 2, h * 0.085, w * 0.1, 0, Math.PI * 2)
        ctx.fill()
      }
    },
    { roughness: dht11 ? 0.5 : 0.55, bumpScale: 0.8 },
  )
}

function paintDht(a: Art, s: DhtSpec): void {
  const lanes: Pt[][] = [
    [
      [DHT_XS[0], 0],
      [DHT_XS[0] - 0.9, -1.6],
      [-3.81, s.legsZ],
    ],
    [
      [DHT_XS[1], 0],
      [-1.27, s.legsZ],
    ],
    [
      [DHT_XS[2], 0],
      [3.81, s.legsZ],
    ],
  ]
  if (s.led) lanes.push([[DHT_XS[0], 0], [-4.4, -2.0]], [[DHT_LED.x + 0.8, DHT_LED.z], [DHT_XS[2] + 0.6, -1.2]])
  a.traces(lanes, 0.3)
  headerArt(a, DHT_XS)
  // labels outside the outer pads (the inner area carries the parts)
  a.silk('+', DHT_XS[0] - 1.7, -0.1, 1.2)
  a.silk('OUT', DHT_XS[1], -1.6, 0.62)
  a.silk('−', DHT_XS[2] + 1.7, -0.1, 1.2)
  for (let k = 0; k < 4; k++) a.pad((k - 1.5) * PITCH, s.legsZ, 0.55)
  chipPads(a, DHT_R.x, DHT_R.z, 90)
  if (s.led) {
    for (const sx of [-1, 1]) a.padRect(DHT_LED.x + sx * 0.8, DHT_LED.z, 0.9, 0.95)
    chipPads(a, 1.7, -2.9, 0)
  }
}

function dhtStatics(type: string): StaticPart[] {
  const s = DHT[type] ?? DHT.dht22
  return statics(`dht:${type}`, (P) => {
    boardParts(P, {
      key: `dht-${type}`,
      w: s.w,
      d: s.d,
      cx: 0,
      cz: s.near - s.d / 2,
      style: { mask: '#1d1f24', maskCopper: '#25282e', pad: '#c0c3c6', silk: '#eeeeea', drill: '#08090b' },
      edge: 0x15161a,
      paint: (a) => paintDht(a, s),
    })
    headerParts(P, DHT_XS)
    chip(P, DHT_R.x, DHT_R.z, 90, 'R')
    if (s.led) {
      ledBody(P, DHT_LED.x, DHT_LED.z)
      chip(P, 1.7, -2.9, 0, 'R')
    }
    // sensor body lying on the board, grille up
    const [bw, bh, bl] = s.body
    const r = 0.5
    const body = cachedGeometry(`sens-dht-body:${type}`, () => new RoundedBoxGeometry(bw * MM, bh * MM, bl * MM, 2, r * MM))
    P.add(body, plastic(s.color, type === 'dht11' ? 0.5 : 0.55), 0, Y_TOP + LIFT + (bh * MM) / 2, s.bodyZ - bl / 2)
    P.add(flatQuadGeometry((bw - 1.2) * MM, (bl - 1.2) * MM), dhtGrilleMaterial(type), 0, Y_TOP + LIFT + bh * MM + 0.002, s.bodyZ - bl / 2)
    // four legs out of the near end face, bent down into the board
    // from 0.3 mm inside the body's near face out to the leg row
    const run = s.legsZ + 0.125 - (s.bodyZ - 0.3)
    const legH = Math.min(1.4, bh * 0.22)
    const horiz = slabGeometry(0.5 * MM, 0.25 * MM, run * MM)
    const vert = slabGeometry(0.5 * MM, legH * MM, 0.25 * MM, { bottom: true })
    const fillet = solderFilletGeometry(0.5 * MM, 0.3 * MM, 0.35 * MM)
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * PITCH
      P.add(horiz, leadTin(), x, Y_TOP + LIFT + legH * MM, (s.legsZ + 0.125 + s.bodyZ - 0.3) / 2)
      P.add(vert, leadTin(), x, Y_TOP + LIFT, s.legsZ)
      P.add(fillet, solderMaterial(), x, Y_TOP + 0.002, s.legsZ)
    }
  })
}

function buildDht(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const ghost = isGhost(comp)
  const type = DHT[entry.type] ? entry.type : 'dht22'
  const f = frameOn(pins, range(3))
  const group = frameGroup(f, dhtStatics(type))
  const led = DHT[type].led ? addLed(group, ghost, DHT_LED.x, DHT_LED.z, 'red') : null
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: led ? (_c, _e, t) => applyLed(led, t?.sub?.LED_PWR, ghost) : undefined,
  }
}

// ===========================================================================
// HC-SR04: 45 × 20 mm board standing on its 4-pin header, transducers facing
// back (−z), component side toward the viewer; pins GND ECHO TRIG VCC along +x
// ===========================================================================

const HC = { w: 45.0, h: 20.0, y0: 2.5 }
const HC_XS = headerXs(4)
/** plan-space top of the HC-SR04 board */
export const HCSR04_TOP = (HC.y0 + HC.h) * MM
const HC_YC = HC.y0 + HC.h / 2
const HC_CAN = { x: 13.2, y: HC.y0 + 10.4, r: 8.0, len: 11.5, rim: 0.7 }
/** IC-side packages (x, height above the breadboard in mm) */
const HC_U1 = { x: -10.5, y: 15.6, n: 16, l: 9.9 }
const HC_U2 = { x: 10.2, y: 15.6, n: 14, l: 8.65 }
const HC_U3 = { x: -0.6, y: 10.6, n: 8, l: 4.9 }
const HC_CHIPS: { x: number; y: number; deg: number; kind: 'R' | 'C' }[] = [
  { x: -17.6, y: 8.4, deg: 0, kind: 'C' },
  { x: -14.2, y: 8.4, deg: 0, kind: 'C' },
  { x: -10.8, y: 8.4, deg: 0, kind: 'C' },
  { x: -7.4, y: 8.4, deg: 0, kind: 'C' },
  { x: 5.4, y: 9.4, deg: 90, kind: 'R' },
  { x: 7.4, y: 9.4, deg: 90, kind: 'R' },
  { x: 9.4, y: 9.4, deg: 90, kind: 'R' },
  { x: 11.4, y: 9.4, deg: 90, kind: 'C' },
  { x: 13.4, y: 9.4, deg: 90, kind: 'R' },
  { x: 16.6, y: 9.0, deg: 0, kind: 'C' },
  { x: 4.0, y: 18.6, deg: 0, kind: 'R' },
  { x: -3.6, y: 18.6, deg: 0, kind: 'C' },
]

/** painter z for a height above the breadboard (mm) on the vertical board */
const hcZ = (yMm: number) => HC_YC - yMm

function paintHcComponentSide(p: PcbPainter): void {
  // component side (+z, toward the viewer): painter x = frame x
  const a = new Art(p, 0, 0)
  const lanes: Pt[][] = []
  HC_XS.forEach((x) => lanes.push([[x, hcZ(4.2)], [x, hcZ(6.2)]]))
  lanes.push([[HC_XS[0], hcZ(6.2)], [-6.0, hcZ(7.0)], [-17.6, hcZ(7.0)]])
  lanes.push([[HC_XS[1], hcZ(6.2)], [-1.27, hcZ(6.6)], [HC_U3.x - 1.9, hcZ(HC_U3.y - 2.7)]])
  lanes.push([[HC_XS[2], hcZ(6.2)], [1.27, hcZ(6.6)], [HC_U3.x + 1.9, hcZ(HC_U3.y - 2.7)]])
  lanes.push([[HC_XS[3], hcZ(6.2)], [6.0, hcZ(7.0)], [18.6, hcZ(7.0)], [18.6, hcZ(13.4)]])
  lanes.push([[HC_U3.x + 1.9, hcZ(HC_U3.y + 2.7)], [HC_U3.x + 1.9, hcZ(12.0)], [HC_U2.x - 2.0, hcZ(12.0)], [HC_U2.x - 2.0, hcZ(HC_U2.y - 2.7)]])
  lanes.push([[HC_U3.x - 1.9, hcZ(HC_U3.y + 2.7)], [HC_U3.x - 1.9, hcZ(12.2)], [HC_U1.x + 2.5, hcZ(12.2)], [HC_U1.x + 2.5, hcZ(HC_U1.y - 2.7)]])
  for (const c of HC_CHIPS) if (c.kind === 'R') lanes.push([[c.x, hcZ(c.y + 0.8)], [c.x, hcZ(c.y + 2.6)]])
  a.traces(lanes, 0.25)
  a.copper(0, hcZ(1.6), 40, 1.4)
  for (const [x, y] of [
    [-20.5, 3.4],
    [20.5, 3.4],
    [-2.6, 13.6],
    [3.4, 14.2],
    [-20.0, 18.6],
    [20.0, 18.6],
    [16.0, 13.6],
  ] as const) {
    a.via(x, hcZ(y), 0.32)
  }
  // header lands at the bottom edge, legends above them
  HC_XS.forEach((x) => a.padRect(x, hcZ(3.6), 1.5, 2.2))
  ;['Gnd', 'Echo', 'Trig', 'Vcc'].forEach((t, i) => a.silk(t, HC_XS[i], hcZ(6.6), 0.85, { condense: 0.85 }))
  soicPads(a, HC_U1.x, hcZ(HC_U1.y), HC_U1.n)
  soicPads(a, HC_U2.x, hcZ(HC_U2.y), HC_U2.n)
  soicPads(a, HC_U3.x, hcZ(HC_U3.y), HC_U3.n)
  for (const c of HC_CHIPS) chipPads(a, c.x, hcZ(c.y), c.deg)
  a.silk('U1', HC_U1.x - 6.4, hcZ(HC_U1.y), 0.9)
  a.silk('U2', HC_U2.x + 5.9, hcZ(HC_U2.y), 0.9)
  a.silk('U3', HC_U3.x + 3.9, hcZ(HC_U3.y), 0.9)
  a.rect(0, 0, HC.w - 1.0, HC.h - 1.0, 0.15)
}

function paintHcTransducerSide(p: PcbPainter): void {
  // transducer side (−z): the face is turned round, painter x = −frame x
  const a = new Art(p, 0, 0)
  const X = (x: number) => -x
  a.copper(0, hcZ(HC.y0 + 0.9), 42, 1.2)
  for (const s of [-1, 1]) {
    a.pad(X(s * HC_CAN.x), hcZ(HC_CAN.y), HC_CAN.r + 0.6)
    for (const d of [-1, 1]) a.pad(X(s * HC_CAN.x + d * 2.0), hcZ(HC_CAN.y), 0.7)
  }
  a.silk('T', X(HC_CAN.x), hcZ(HC.y0 + 1.3), 1.4, { weight: 700, stroke: 0.08 })
  a.silk('R', X(-HC_CAN.x), hcZ(HC.y0 + 1.3), 1.4, { weight: 700, stroke: 0.08 })
  a.silk('HC-SR04', 0, hcZ(11.4), 1.55, { weight: 700, stroke: 0.06 })
  ;['Gnd', 'Echo', 'Trig', 'Vcc'].forEach((t, i) => a.silk(t, X(HC_XS[i]), hcZ(6.4), 0.95, { condense: 0.85 }))
  for (const x of HC_XS) a.padRect(X(x), hcZ(3.6), 1.5, 2.2)
  a.rect(0, hcZ(19.4), 13.0, 5.6, 0.15)
}

/** HC-49S can (shared with the Blue Pill proportions) lying on its side, axis +y = out of the face. */
function hc49Lying(): THREE.Group {
  const g = new THREE.Group()
  const bevel = 0.28 * MM
  const can = cachedGeometry('sens-hc49-can', () => {
    const geo = new THREE.ExtrudeGeometry(stadiumShape(11.05 * MM - 2 * bevel, 4.65 * MM - 2 * bevel), {
      depth: 3.3 * MM - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 5,
    })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, bevel + 0.45 * MM, 0)
    return geo
  })
  g.add(new THREE.Mesh(can, aluminium()))
  const base = cachedGeometry('sens-hc49-base', () => {
    const geo = new THREE.ExtrudeGeometry(stadiumShape(11.35 * MM, 4.95 * MM), { depth: 0.45 * MM, bevelEnabled: false, curveSegments: 5 })
    geo.rotateX(-Math.PI / 2)
    return geo
  })
  g.add(new THREE.Mesh(base, satinSteel()))
  return g
}

function hcsr04Statics(): StaticPart[] {
  return statics('hcsr04', (P) => {
    const t = PCB_T * MM
    // FR4 core + the two painted faces
    P.add(slabGeometry(HC.w * MM, HC.h * MM, t), fr4EdgeMaterial(), 0, HC_YC * MM, 0)
    const face = cachedGeometry('sens-hc-face', () => new THREE.PlaneGeometry(HC.w * MM, HC.h * MM))
    const style = { mask: '#163f8f', maskCopper: '#1d499e', pad: '#b9bcbf', silk: '#eeeee6', drill: '#0a1a3d' }
    P.add(face, pcbArtMaterial('sensors-hcsr04-ic', HC.w, HC.h, style, paintHcComponentSide, { pxPerMm: 40 }), 0, HC_YC * MM, PCB_T / 2 + 0.006)
    const front = new THREE.Mesh(face, pcbArtMaterial('sensors-hcsr04-tx', HC.w, HC.h, style, paintHcTransducerSide, { pxPerMm: 40 }))
    front.rotation.y = Math.PI
    P.put(front, 0, HC_YC * MM, -(PCB_T / 2 + 0.006))
    // header: molded block on the breadboard, the pins rising along the
    // component face into their pads (soldered edge-mount style)
    P.add(slabGeometry(4 * PITCH * MM - 0.02, HC.y0 * MM, 2.5 * MM), headerPlasticMaterial(), 0, (HC.y0 * MM) / 2, 0)
    const pin = slabGeometry(0.64 * MM, 3.2 * MM, 0.64 * MM)
    const blob = cachedGeometry('sens-hc-blob', () => {
      const g = new THREE.SphereGeometry(0.85 * MM, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
      g.rotateX(Math.PI / 2)
      g.scale(1, 1.35, 0.55)
      return g
    })
    for (const x of HC_XS) {
      P.add(pin, tinnedPost(), x, (HC.y0 + 1.5) * MM, PCB_T / 2 + 0.33)
      P.add(blob, solderMaterial(), x, 3.7 * MM, PCB_T / 2)
    }
    // component side packages (+z face)
    const onFace = (o: THREE.Object3D, x: number, yMm: number, front: boolean) => {
      const g = new THREE.Group()
      g.add(o)
      g.rotation.x = front ? -Math.PI / 2 : Math.PI / 2
      g.position.set(x * MM, yMm * MM, (front ? -1 : 1) * (t / 2 + LIFT))
      P.list.push(g)
    }
    for (const u of [HC_U1, HC_U2, HC_U3]) onFace(soicGroup(u.n, u.l), u.x, u.y, false)
    for (const c of HC_CHIPS) {
      const g = new THREE.Group()
      for (const o of chip0603(c.kind === 'R' ? chipResistor() : mlcc(), leadTin(), c.kind === 'R' ? 0.45 : 0.8)) g.add(o)
      g.rotation.y = (-c.deg * Math.PI) / 180
      onFace(g, c.x, c.y, false)
    }
    // transducer side: crystal between the cans, the two transducers
    onFace(hc49Lying(), 0, 19.4, true)
    const L = HC_CAN.len
    const wall = cachedGeometry('sens-hc-can-wall', () => {
      const g = new THREE.CylinderGeometry(HC_CAN.r * MM, HC_CAN.r * MM, L * MM, 32, 1, true)
      g.translate(0, (L * MM) / 2, 0)
      g.rotateX(-Math.PI / 2)
      return g
    })
    const rim = cachedGeometry('sens-hc-can-rim', () => {
      const g = new THREE.RingGeometry((HC_CAN.r - HC_CAN.rim) * MM, HC_CAN.r * MM, 32, 1)
      g.rotateY(Math.PI)
      return g
    })
    const inner = cachedGeometry('sens-hc-can-inner', () => {
      const g = new THREE.CylinderGeometry((HC_CAN.r - HC_CAN.rim) * MM, (HC_CAN.r - HC_CAN.rim) * MM, 0.9 * MM, 32, 1, true)
      g.rotateX(-Math.PI / 2)
      return g
    })
    const grille = cachedGeometry('sens-hc-can-grille', () => {
      const g = new THREE.CircleGeometry((HC_CAN.r - HC_CAN.rim) * MM, 32)
      g.rotateY(Math.PI)
      return g
    })
    const grilleMat = canvasMaterial(
      'hc-grille',
      128,
      128,
      0x2a2b2e,
      (ctx, w, h, bump) => {
        ctx.fillStyle = bump ? '#3a3a3a' : '#1e1f22'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = bump ? '#c8c8c8' : '#4a4c51'
        ctx.lineWidth = 1.4
        for (let i = -h; i < w + h; i += 5) {
          ctx.beginPath()
          ctx.moveTo(i, 0)
          ctx.lineTo(i + h, h)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(i + h, 0)
          ctx.lineTo(i, h)
          ctx.stroke()
        }
      },
      { roughness: 0.8, bumpScale: 1.0 },
    )
    const z0 = -t / 2
    for (const s of [-1, 1]) {
      const x = s * HC_CAN.x
      P.add(wall, aluminium(), x, HC_CAN.y * MM, z0 / MM)
      P.add(rim, aluminium(), x, HC_CAN.y * MM, z0 / MM - L)
      P.add(inner, innerDark(), x, HC_CAN.y * MM, z0 / MM - L + 0.45)
      P.add(grille, grilleMat, x, HC_CAN.y * MM, z0 / MM - L + 0.9)
    }
  })
}

function buildHcsr04(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  // catalog pin order VCC TRIG ECHO GND runs toward −x: the frame runs GND → VCC
  const f = frameOn(pins, [3, 2, 1, 0])
  const group = frameGroup(f, hcsr04Statics())
  if (!isGhost(comp)) {
    const t = PCB_T * MM
    for (const [u, text] of [
      [HC_U1, 'MAX232'],
      [HC_U2, 'TL074'],
    ] as const) {
      const mat = etchedLabelMaterial([text, fakeLotCode(text)], 2.6)
      if (!mat) continue
      const m = new THREE.Mesh(
        cachedGeometry('sens-hc-mark', () => new THREE.PlaneGeometry(5.6 * MM, 2.15 * MM)),
        mat,
      )
      m.position.set(u.x * MM, u.y * MM, t / 2 + LIFT + 1.56 * MM + 0.003)
      group.add(m)
    }
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ===========================================================================
// KY-040 rotary encoder: 19 × 26 mm board, EC11 encoder with a bare
// knurled, slotted shaft
// ===========================================================================

const KY040 = { w: 19.0, d: 26.0, near: 1.3 }
const KY040_XS = headerXs(5)
const KY040_CZ = KY040.near - KY040.d / 2
const KY040_HOLES: Hole[] = [
  { x: -6.9, z: -22.4, r: 1.5 },
  { x: 6.9, z: -22.4, r: 1.5 },
]
const ENC = { x: 0, z: -13.6 }
/** encoder heights above the board top (mm) */
const ENC_BASE_H = 2.6
const ENC_FRAME_TOP = 6.6
const ENC_BUSH_TOP = 11.6
const ENC_SHAFT_TOP = 25.0
const ENC_PRESS = 0.5
export const KY040_TOP = Y_TOP + LIFT + ENC_SHAFT_TOP * MM + 0.003
/** R2 / R3 (CLK / DT pull-ups) fitted, R1 (SW pull-up) left empty like the module */
const KY040_RES: [number, string][] = [
  [-7.9, 'R2'],
  [-6.3, 'R3'],
  [7.6, 'R1'],
]

function paintKy040(a: Art): void {
  // CLK → contact A, DT → contact B, GND → common C and the switch, + → the pull-ups
  const lanes: Pt[][] = [
    [[KY040_XS[0], 0], [KY040_XS[0] - 0.6, -1.0], [-6.2, -4.0], [-6.2, -4.8]],
    [[KY040_XS[0] - 0.6, -1.0], [-3.8, -4.4], [-2.5, ENC.z + 7.0]],
    [[KY040_XS[1], 0], [KY040_XS[1] + 0.6, -1.0], [KY040_XS[1] + 0.6, -3.8], [-8.2, -3.8], [-8.2, -4.8]],
    [[KY040_XS[1] + 0.6, -3.8], [1.2, -4.4], [2.5, ENC.z + 7.0]],
    [[KY040_XS[2], 0], [KY040_XS[2] + 0.6, -1.0], [7.4, -4.8]],
    [[KY040_XS[2] + 0.6, -1.0], [8.4, -7.0], [8.4, -20.6], [2.5, ENC.z - 7.0]],
    [[KY040_XS[3], 0], [KY040_XS[3] + 0.6, -1.0], [3.6, -2.4], [-7.2, -2.4]],
    [[KY040_XS[4], 0], [KY040_XS[4] - 0.6, -1.0], [0, ENC.z + 7.0]],
    [[0, ENC.z + 7.0], [-1.2, ENC.z - 4.0], [-2.5, ENC.z - 7.0]],
  ]
  a.traces(lanes, 0.3)
  headerArt(a, KY040_XS, ['CLK', 'DT', 'SW', '+', 'GND'], 0.78)
  holeRings(a, KY040_HOLES)
  // encoder footprint: A C B on the near side, the switch pair on the far side,
  // slotted mounting-tab lands left and right
  for (const x of [-2.5, 0, 2.5]) a.pad(ENC.x + x, ENC.z + 7.0, 0.7)
  for (const x of [-2.5, 2.5]) a.pad(ENC.x + x, ENC.z - 7.0, 0.7)
  for (const s of [-1, 1]) a.padRect(ENC.x + s * 5.9, ENC.z, 1.4, 3.2)
  // R2 / R3 (CLK / DT pull-ups) fitted, R1 (SW pull-up) left empty like the module
  for (const [x, label] of KY040_RES) {
    chipPads(a, x, -5.6, 90)
    a.silk(label, x, -3.4, 0.62)
  }
  a.rect(ENC.x, ENC.z, 12.8, 13.6, 0.15)
}

function ky040Statics(): StaticPart[] {
  return statics('ky040', (P) => {
    boardParts(P, {
      key: 'ky040',
      w: KY040.w,
      d: KY040.d,
      cx: 0,
      cz: KY040_CZ,
      style: { mask: '#16224a', maskCopper: '#1d2c5a', pad: '#bfc2c5', silk: '#ecebe2', drill: '#06091a' },
      edge: 0x111a3a,
      holes: KY040_HOLES,
      paint: paintKy040,
    })
    headerParts(P, KY040_XS)
    for (const [x, label] of KY040_RES) if (label !== 'R1') chip(P, x, -5.6, 90, 'R')
    // EC11: black base, stamped steel frame with its side tabs, threaded bushing
    P.add(slabGeometry(12.4 * MM, ENC_BASE_H * MM, 13.2 * MM, { bottom: true }), plastic(0x161618, 0.55), ENC.x, Y_TOP + LIFT + (ENC_BASE_H * MM) / 2, ENC.z)
    const fh = ENC_FRAME_TOP - ENC_BASE_H
    P.add(slabGeometry(12.0 * MM, fh * MM, 12.0 * MM, { bottom: true }), satinSteel(), ENC.x, Y_TOP + LIFT + (ENC_BASE_H + fh / 2) * MM, ENC.z)
    for (const s of [-1, 1]) {
      P.add(slabGeometry(0.3 * MM, (ENC_FRAME_TOP - 0.4) * MM, 2.6 * MM, { bottom: true }), satinSteel(), ENC.x + s * 6.15, Y_TOP + LIFT + ((ENC_FRAME_TOP - 0.4) * MM) / 2, ENC.z)
    }
    P.add(
      cachedGeometry('sens-enc-bush', () => {
        const g = new THREE.CylinderGeometry(3.5 * MM, 3.5 * MM, (ENC_BUSH_TOP - ENC_FRAME_TOP) * MM, 24, 1, false)
        return g
      }),
      finish('bushing', 0xc0c3c7, 0.42, 1.0, true),
      ENC.x,
      Y_TOP + LIFT + ((ENC_FRAME_TOP + ENC_BUSH_TOP) / 2) * MM,
      ENC.z,
    )
    // the flat washer and the hex nut the module ships threaded on the bushing
    P.add(
      cachedGeometry('sens-enc-washer', () => new THREE.CylinderGeometry(5.0 * MM, 5.0 * MM, 0.4 * MM, 24)),
      satinSteel(),
      ENC.x,
      Y_TOP + LIFT + (ENC_FRAME_TOP + 0.2) * MM,
      ENC.z,
    )
    P.add(
      cachedGeometry('sens-enc-nut', () => {
        const g = new THREE.CylinderGeometry(4.8 * MM, 4.8 * MM, 1.8 * MM, 6).toNonIndexed()
        g.computeVertexNormals() // flat hex faces
        return g
      }),
      finish('nut', 0xb4b8bd, 0.4, 1.0, true),
      ENC.x,
      Y_TOP + LIFT + (ENC_FRAME_TOP + 0.4 + 0.9) * MM,
      ENC.z,
    )
  })
}

/** EC11 shaft (smooth lower part, 18-tooth knurl, slot) about its own axis, base at y = 0. */
function encoderShaft(): THREE.Group {
  const g = new THREE.Group()
  const h = ENC_SHAFT_TOP - ENC_BUSH_TOP
  const smooth = 5.6
  const steel = finish('shaft', 0xc3c6ca, 0.4, 1.0, true)
  const lower = new THREE.Mesh(
    cachedGeometry('sens-enc-shaft-lo', () => {
      const c = new THREE.CylinderGeometry(3.0 * MM, 3.0 * MM, smooth * MM, 20, 1, true)
      c.translate(0, (smooth * MM) / 2, 0)
      return c
    }),
    steel,
  )
  g.add(lower)
  const knurl = new THREE.Mesh(
    cachedGeometry('sens-enc-shaft-knurl', () => {
      const c = new THREE.CylinderGeometry(3.0 * MM, 3.0 * MM, (h - smooth) * MM, 18, 1, false).toNonIndexed()
      c.computeVertexNormals() // flat facets: the knurl reads as teeth
      c.translate(0, (smooth + (h - smooth) / 2) * MM, 0)
      return c
    }),
    steel,
  )
  g.add(knurl)
  const slot = new THREE.Mesh(flatQuadGeometry(6.1 * MM, 0.9 * MM), darkRecess())
  slot.position.y = h * MM + 0.003
  g.add(slot)
  return g
}

function buildKy040(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, range(5))
  const group = frameGroup(f, ky040Statics())
  // the shaft turns and sinks — per instance (shared geometry, transform only)
  const shaft = encoderShaft()
  const baseY = Y_TOP + LIFT + ENC_BUSH_TOP * MM
  shaft.position.set(ENC.x * MM, baseY, ENC.z * MM)
  group.add(shaft)
  const pose = (c: ComponentInstance, e: CatalogEntry, t: ComponentTelemetry | null) => {
    const v = t?.values
    const angle = v?.angle ?? Number(paramOf(c.params, e, 'position') ?? 0) * 18
    const pressed = v?.pressed !== undefined ? v.pressed > 0 : paramOf(c.params, e, 'pressed') === true
    // clockwise seen from above = negative yaw
    shaft.rotation.y = (-(Number.isFinite(angle) ? angle : 0) * Math.PI) / 180
    shaft.position.y = baseY - (pressed ? ENC_PRESS * MM : 0)
  }
  pose(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: pose }
}

// ===========================================================================
// KY-023 joystick: 26 × 34 mm board, PS2-style thumbstick (two pots + push)
// ===========================================================================

const KY023 = { w: 26.0, d: 34.0, near: 1.3 }
const KY023_XS = headerXs(5)
const KY023_CZ = KY023.near - KY023.d / 2
const KY023_HOLES: Hole[] = [
  { x: -10.3, z: -3.6, r: 1.6 },
  { x: 10.3, z: -3.6, r: 1.6 },
  { x: -10.3, z: -29.8, r: 1.6 },
  { x: 10.3, z: -29.8, r: 1.6 },
]
const JOY = { x: 0, z: -17.6 }
const JOY_HOUSING_H = 6.2
const JOY_PLATE_T = 0.5
/** gimbal pivot above the board top (mm) */
const JOY_PIVOT = JOY_HOUSING_H + JOY_PLATE_T - 1.2
const JOY_STICK = 9.6
const JOY_CAP_H = 7.6
const JOY_CAP_R = 10.0
const JOY_MAX_TILT = (25 * Math.PI) / 180
const JOY_PRESS = 0.6
/** stick tilt in a corner of the travel (both axes at full deflection) */
const JOY_CORNER_TILT = Math.acos(Math.cos(JOY_MAX_TILT) ** 2)
/** plan-space top reachable by the cap rim at full (corner) tilt */
export const KY023_TOP =
  Y_TOP + LIFT + (JOY_PIVOT + (JOY_STICK + JOY_CAP_H) * Math.cos(JOY_CORNER_TILT) + JOY_CAP_R * Math.sin(JOY_CORNER_TILT)) * MM

function paintKy023(a: Art): void {
  const lanes: Pt[][] = [
    [[KY023_XS[0], 0], [KY023_XS[0] - 0.6, -1.0], [-7.6, -6.0], [-7.6, -26.0], [-4.0, -27.6]],
    [[KY023_XS[1], 0], [KY023_XS[1] + 0.6, -1.0], [-1.9, -6.6], [8.6, -9.8], [11.2, -14.6]],
    [[KY023_XS[2], 0], [KY023_XS[2] + 0.6, -1.0], [0.6, -6.0], [9.8, -10.6], [12.0, -17.6]],
    [[KY023_XS[3], 0], [KY023_XS[3] + 0.6, -1.0], [3.1, -6.0], [-3.0, -26.4]],
    [[KY023_XS[4], 0], [KY023_XS[4] + 0.6, -1.0], [5.7, -5.0], [-8.4, -12.0], [-8.4, -18.0]],
  ]
  a.traces(lanes, 0.3)
  headerArt(a, KY023_XS, ['GND', '+5V', 'VRx', 'VRy', 'SW'], 0.8)
  holeRings(a, KY023_HOLES)
  for (let k = 0; k < 3; k++) {
    a.pad(JOY.x + 11.6, JOY.z + (k - 1) * 2.5, 0.75)
    a.pad(JOY.x + (k - 1) * 2.5, JOY.z - 11.6, 0.75)
  }
  for (const s of [-1, 1]) a.pad(JOY.x - 8.4, JOY.z + s * 2.2, 0.75)
  a.rect(JOY.x, JOY.z, 17.0, 17.0, 0.15)
  a.silk('KY-023', -6.2, -31.6, 1.0)
}

function ky023Statics(): StaticPart[] {
  return statics('ky023', (P) => {
    boardParts(P, {
      key: 'ky023',
      w: KY023.w,
      d: KY023.d,
      cx: 0,
      cz: KY023_CZ,
      style: { mask: '#14141a', maskCopper: '#1c1d25', pad: '#c3c6c9', silk: '#efeeea', drill: '#060608' },
      edge: 0x101015,
      holes: KY023_HOLES,
      paint: paintKy023,
    })
    headerParts(P, KY023_XS)
    const black = plastic(0x18181b, 0.5)
    // housing + steel top plate with the round opening
    P.add(slabGeometry(15.6 * MM, JOY_HOUSING_H * MM, 15.6 * MM, { bottom: true }), black, JOY.x, Y_TOP + LIFT + (JOY_HOUSING_H * MM) / 2, JOY.z)
    P.add(
      cachedGeometry('sens-joy-plate', () => {
        const s = new THREE.Shape()
        const h = 8.2 * MM
        s.moveTo(-h, -h)
        s.lineTo(h, -h)
        s.lineTo(h, h)
        s.lineTo(-h, h)
        s.closePath()
        const hole = new THREE.Path()
        hole.absarc(0, 0, 6.2 * MM, 0, Math.PI * 2, true)
        s.holes.push(hole)
        const g = new THREE.ExtrudeGeometry(s, { depth: JOY_PLATE_T * MM, bevelEnabled: false, curveSegments: 20 })
        g.rotateX(-Math.PI / 2)
        return g
      }),
      satinSteel(),
      JOY.x,
      Y_TOP + LIFT + JOY_HOUSING_H * MM,
      JOY.z,
    )
    // the two 10 kΩ pots (X on +x, Y on the far side) with their steel clips
    const potBody = slabGeometry(3.4 * MM, 9.6 * MM, 9.6 * MM, { bottom: true })
    const clip = slabGeometry(0.3 * MM, 8.0 * MM, 8.6 * MM, { bottom: true })
    P.add(potBody, plastic(0x1e2f6e, 0.5), JOY.x + 9.5, Y_TOP + LIFT + 4.8 * MM, JOY.z)
    P.add(clip, satinSteel(), JOY.x + 11.3, Y_TOP + LIFT + 4.0 * MM, JOY.z)
    P.add(potBody, plastic(0x1e2f6e, 0.5), JOY.x, Y_TOP + LIFT + 4.8 * MM, JOY.z - 9.5, 90)
    P.add(clip, satinSteel(), JOY.x, Y_TOP + LIFT + 4.0 * MM, JOY.z - 11.3, 90)
    // push switch on the −x side
    P.add(slabGeometry(3.6 * MM, 3.4 * MM, 6.0 * MM, { bottom: true }), plastic(0x2a2a2e, 0.5), JOY.x - 9.4, Y_TOP + LIFT + 1.7 * MM, JOY.z)
  })
}

/** Gimbal dome, stick and thumb cap about the pivot (y = 0 at the pivot). */
function joystickHead(): THREE.Group {
  const g = new THREE.Group()
  const black = plastic(0x161618, 0.48)
  const dome = new THREE.Mesh(
    cachedGeometry('sens-joy-dome', () => new THREE.SphereGeometry(6.0 * MM, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    black,
  )
  g.add(dome)
  const stick = new THREE.Mesh(
    cachedGeometry('sens-joy-stick', () => {
      const c = new THREE.CylinderGeometry(1.9 * MM, 2.2 * MM, JOY_STICK * MM, 14, 1, true)
      c.translate(0, (JOY_STICK * MM) / 2, 0)
      return c
    }),
    black,
  )
  g.add(stick)
  const cap = new THREE.Mesh(
    cachedGeometry('sens-joy-cap', () => {
      const pts = [
        [1.9, 0],
        [7.6, 0.4],
        [9.3, 1.6],
        [JOY_CAP_R, 4.0],
        [9.9, 6.6],
        [9.3, JOY_CAP_H],
        [8.3, JOY_CAP_H - 0.05],
        [5.5, JOY_CAP_H - 1.1],
        [2.4, JOY_CAP_H - 1.5],
        [0, JOY_CAP_H - 1.55],
      ].map(([r, y]) => new THREE.Vector2(r * MM, y * MM))
      const lathe = new THREE.LatheGeometry(pts, 26)
      lathe.translate(0, JOY_STICK * MM, 0)
      return lathe
    }),
    plastic(0x1b1b1e, 0.62),
  )
  g.add(cap)
  return g
}

function buildKy023(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, range(5))
  const group = frameGroup(f, ky023Statics())
  const head = joystickHead()
  const pivotY = Y_TOP + LIFT + JOY_PIVOT * MM
  head.position.set(JOY.x * MM, pivotY, JOY.z * MM)
  head.rotation.order = 'XZY'
  group.add(head)
  const pose = (c: ComponentInstance, e: CatalogEntry, t: ComponentTelemetry | null) => {
    const v = t?.values
    const num = (key: 'x' | 'y') => {
      const n = v?.[key] ?? Number(paramOf(c.params, e, key) ?? 0)
      return Number.isFinite(n) ? THREE.MathUtils.clamp(n, -100, 100) : 0
    }
    const pressed = v?.pressed !== undefined ? v.pressed > 0 : paramOf(c.params, e, 'pressed') === true
    // +x leans the stick toward +x, +y away from the header (−z)
    head.rotation.z = (-num('x') / 100) * JOY_MAX_TILT
    head.rotation.x = (-num('y') / 100) * JOY_MAX_TILT
    head.position.y = pivotY - (pressed ? JOY_PRESS * MM : 0)
  }
  pose(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: pose }
}

// ===========================================================================
// ACS712 current sensor / 0–25 V voltage sensor: narrow red boards with the
// 3-pin header at the near end, a screw terminal at the far end and the two
// load / input wires looping back into the breadboard beside the board
// ===========================================================================

interface TermSpec {
  key: string
  w: number
  d: number
  near: number
  name: string
}

const ACS = { key: 'acs712', w: 13.0, d: 31.0, near: 1.3, name: 'ACS712' }
const VSENS = { key: 'vsens', w: 14.0, d: 26.0, near: 1.3, name: 'VOLTAGE' }
const TERM_XS = headerXs(3)
/** plan-space top of the terminal-block modules (the terminal block) */
export const TERMINAL_MODULE_TOP = Y_TOP + LIFT + (TB_H + TB_SCREW) * MM + 0.003
const termZ = (s: TermSpec) => s.near - s.d + TB_D / 2 + 0.1
const ACS_IC = { x: 0, z: -14.0 }
const ACS_LED = { x: -4.1, z: -5.6 }

function paintAcs(a: Art): void {
  const tz = termZ(ACS)
  // the primary path: wide copper from each terminal to IP+ / IP− (pins 1-2 / 3-4)
  a.copper(-2.54, (tz + ACS_IC.z) / 2 - 1.0, 3.4, Math.abs(tz - ACS_IC.z) - 2.0)
  a.copper(2.54, (tz + ACS_IC.z) / 2 - 1.0, 3.4, Math.abs(tz - ACS_IC.z) - 2.0)
  for (const s of [-1, 1]) a.copper(s * 2.2, ACS_IC.z - 2.4, 2.4, 2.0)
  const lanes: Pt[][] = [
    [[TERM_XS[0], 0], [TERM_XS[0], -2.2], [ACS_LED.x, -4.6]],
    [[TERM_XS[1], 0], [0.8, -2.4], [1.9, ACS_IC.z + 2.6]],
    [[TERM_XS[2], 0], [TERM_XS[2] + 1.2, -2.4], [4.4, -7.0]],
    [[TERM_XS[0], -2.2], [-0.6, -8.2], [-0.6, ACS_IC.z + 2.6]],
  ]
  a.traces(lanes, 0.3)
  headerArt(a, TERM_XS, ['VCC', 'OUT', 'GND'], 0.8)
  soicPads(a, ACS_IC.x, ACS_IC.z, 8, 90)
  for (const s of [-1, 1]) a.padRect(ACS_LED.x + s * 0.8, ACS_LED.z, 0.9, 0.95)
  chipPads(a, ACS_LED.x, -7.6, 0)
  chipPads(a, 4.2, -6.0, 90)
  chipPads(a, 4.2, -9.6, 90)
  for (const s of [-1, 1]) a.pad(s * 2.54, tz, 1.1)
  a.silk('IP+', -2.54, tz + TB_D / 2 + 1.0, 0.8)
  a.silk('IP−', 2.54, tz + TB_D / 2 + 1.0, 0.8)
  a.silk('ACS712ELC-05B', -5.1, ACS_IC.z, 0.75, { rot: -Math.PI / 2 })
  a.rect(ACS_LED.x, ACS_LED.z, 2.6, 1.4, 0.12)
}

function paintVsens(a: Art): void {
  const tz = termZ(VSENS)
  const lanes: Pt[][] = [
    [[TERM_XS[0], 0], [TERM_XS[0], -3.0], [-1.6, -8.8]],
    [[-1.6, -12.4], [-2.54, tz + 3.0], [-2.54, tz]],
    [[-1.6, -10.6], [1.6, -10.6], [1.6, -8.8]],
    [[TERM_XS[2], 0], [TERM_XS[2], -3.0], [1.6, -12.4], [2.54, tz + 3.0], [2.54, tz]],
  ]
  a.traces(lanes, 0.45)
  headerArt(a, TERM_XS)
  a.silk('S', TERM_XS[0] - 1.6, -0.1, 1.0)
  a.silk('+', TERM_XS[1], -1.9, 1.1)
  a.silk('−', TERM_XS[2] + 1.6, -0.1, 1.1)
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) a.padRect(s * 1.6, -10.6 + e * 1.8, 1.4, 1.1)
  }
  for (const s of [-1, 1]) a.pad(s * 2.54, tz, 1.1)
  a.silk('VCC', -2.54, tz + TB_D / 2 + 1.0, 0.8)
  a.silk('GND', 2.54, tz + TB_D / 2 + 1.0, 0.8)
  a.silk('R1', -4.4, -10.6, 0.7)
  a.silk('R2', 4.4, -10.6, 0.7)
}

function termStatics(spec: TermSpec): StaticPart[] {
  return statics(`term:${spec.key}`, (P) => {
    const acs = spec.key === 'acs712'
    boardParts(P, {
      key: spec.key,
      w: spec.w,
      d: spec.d,
      cx: 0,
      cz: spec.near - spec.d / 2,
      style: { mask: '#a3181d', maskCopper: '#b42228', pad: '#c3c4c6', silk: '#f5f2ee', drill: '#3a0608' },
      edge: 0x7e1216,
      paint: acs ? paintAcs : paintVsens,
    })
    headerParts(P, TERM_XS)
    terminalBlock(P, 0, termZ(spec))
    if (acs) {
      const ic = soicGroup(8, 4.9)
      ic.rotation.y = -Math.PI / 2
      P.put(ic, ACS_IC.x, Y_TOP + LIFT, ACS_IC.z)
      ledBody(P, ACS_LED.x, ACS_LED.z)
      chip(P, ACS_LED.x, -7.6, 0, 'R')
      chip(P, 4.2, -6.0, 90, 'C')
      chip(P, 4.2, -9.6, 90, 'C')
    } else {
      chip0805(P, -1.6, -10.6, 90)
      chip0805(P, 1.6, -10.6, 90)
    }
  })
}

/**
 * One load / input wire: out of the terminal mouth, a loop down past the
 * board's far end, back along the board side lying on the breadboard, and
 * the tinned end down into its hole. Per instance (follows the pin).
 */
function loopWire(f: Frame, spec: TermSpec, xTerm: number, pin: V3, color: number, out: THREE.Object3D[]): void {
  const [hx, hz] = toFrameMm(f, pin)
  const zMouth = termZ(spec) - TB_D / 2
  const yMouth = Y_TOP + LIFT + 3.1 * MM
  const lie = 0.95 * MM
  const side = Math.sign(hx - xTerm) || Math.sign(xTerm) || 1
  const pts = [
    toWorld(f, xTerm, yMouth, zMouth + 1.6),
    toWorld(f, xTerm, yMouth, zMouth - 2.5),
    toWorld(f, xTerm + side * 1.6, yMouth - 1.0 * MM, zMouth - 5.6),
    toWorld(f, hx, lie + 1.2 * MM, zMouth - 4.2),
    toWorld(f, hx, lie, zMouth - 0.8),
    toWorld(f, hx, lie, hz - 1.6),
    V(pin.x, lie + 0.4 * MM, pin.z),
  ]
  const ins = new THREE.Mesh(new THREE.TubeGeometry(roundedPath(pts, 0.5), 44, 0.2, 7, false), makeWireMaterial(color))
  out.push(ins)
  // insulation end cap, then the tinned strands into the hole
  const end = pts[pts.length - 1]
  const cap = new THREE.Mesh(
    cachedGeometry('sens-wire-cap', () => new THREE.SphereGeometry(0.2, 8, 6)),
    makeWireMaterial(color),
  )
  cap.position.copy(end)
  out.push(cap)
  const tip = new THREE.Mesh(
    new THREE.TubeGeometry(roundedPath([end.clone(), V(pin.x, HOLE_DEPTH, pin.z)], 0.1), 2, 0.07, 6, false),
    finish('strands', 0xd8d2c4, 0.42, 1.0),
  )
  out.push(tip)
}

function buildTermModule(spec: TermSpec): (comp: ComponentInstance, entry: CatalogEntry, pins: V3[]) => BuildResult {
  return (comp, _entry, pins) => {
    const ghost = isGhost(comp)
    const f = frameOn(pins, [0, 1, 2])
    const group = frameGroup(f, termStatics(spec))
    const acs = spec.key === 'acs712'
    const led = acs ? addLed(group, ghost, ACS_LED.x, ACS_LED.z, 'red') : null
    if (!ghost && acs) {
      marking(group, ['ACS712', 'ELC-05B'], 2.0, 3.6, 1.8, ACS_IC.x, Y_TOP + LIFT + 1.56 * MM + 0.003, ACS_IC.z, 90)
    }
    // wires live in world space (they end in whatever holes the pins are in)
    const wires: THREE.Object3D[] = []
    if (pins[3]) loopWire(f, spec, -2.54, pins[3], 0xc23b32, wires)
    if (pins[4]) loopWire(f, spec, 2.54, pins[4], 0x33353a, wires)
    const root = new THREE.Group()
    root.add(group)
    for (const w of wires) root.add(w)
    return {
      object: root,
      pinWorld: pins.map((p) => p.clone()),
      update: led ? (_c, _e, t) => applyLed(led, t?.sub?.LED_PWR, ghost) : undefined,
    }
  }
}

// ===========================================================================
// Leaded parts: VS1838B IR receiver, A3144 Hall switch ("UA" SIP-3)
// ===========================================================================

/** Lead from inside the hole up to `entry` (bent when the hole is not under it). */
function leadPoints(pin: V3, entry: V3, runY: number): V3[] {
  if (Math.hypot(entry.x - pin.x, entry.z - pin.z) < 0.03) return [V(pin.x, HOLE_DEPTH, pin.z), V(pin.x, entry.y, pin.z)]
  return [V(pin.x, HOLE_DEPTH, pin.z), V(pin.x, runY, pin.z), V(entry.x, runY + 0.12, entry.z), entry]
}

function leadTube(points: V3[], radius: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(roundedPath(points, 0.12), Math.max(4, points.length * 6), radius, 6, false), finish('leg', 0xd5d8dc, 0.4, 1.0, true))
}

const IR = { w: 5.8, h: 6.8, d: 4.0, base: 3.4, domeR: 2.0, domeY: 4.4 }
/** plan-space top of the VS1838B */
export const VS1838B_TOP = (IR.base + IR.h) * MM

function buildVs1838b(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, [0, 1, 2])
  const group = new THREE.Group()
  const body = new THREE.Group()
  body.position.copy(f.c)
  body.rotation.y = f.yaw
  const epoxy = moldedEpoxy(0x141416, 0.42)
  const box = new THREE.Mesh(
    cachedGeometry('sens-ir-body', () => {
      const g = new RoundedBoxGeometry(IR.w * MM, IR.h * MM, IR.d * MM, 2, 0.45 * MM)
      g.translate(0, (IR.base + IR.h / 2) * MM, 0)
      return g
    }),
    epoxy,
  )
  body.add(box)
  const dome = new THREE.Mesh(
    cachedGeometry('sens-ir-dome', () => {
      const g = new THREE.SphereGeometry(IR.domeR * MM, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      g.rotateX(Math.PI / 2) // bulges toward +z (the lens faces the viewer)
      g.scale(1, 1, 0.8)
      g.translate(0, (IR.base + IR.domeY) * MM, (IR.d / 2 - 0.05) * MM)
      return g
    }),
    moldedEpoxy(0x0b0b0e, 0.22),
  )
  body.add(dome)
  // a flat shoulder strip under the lens (the molded IC bay)
  const shoulder = new THREE.Mesh(
    cachedGeometry('sens-ir-bay', () => {
      const g = new THREE.BoxGeometry(IR.w * 0.7 * MM, 0.9 * MM, 0.3 * MM)
      g.translate(0, (IR.base + 1.2) * MM, (IR.d / 2 + 0.1) * MM)
      return g
    }),
    epoxy,
  )
  body.add(shoulder)
  group.add(body)
  const legs: THREE.Object3D[] = []
  pins.slice(0, 3).forEach((pin, i) => {
    const entry = toWorld(f, (i - 1) * PITCH, (IR.base + 0.4) * MM, 0)
    legs.push(leadTube(leadPoints(pin, entry, 0.32), 0.075))
  })
  for (const m of mergeStatic(legs)) group.add(m)
  for (const l of legs) (l as THREE.Mesh).geometry.dispose()
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

const UA = { w: 4.06, h: 3.05, d: 1.52, base: 2.4, chamfer: 0.55 }
/** plan-space top of the A3144 */
export const A3144_TOP = (UA.base + UA.h) * MM

function buildA3144(comp: ComponentInstance, _entry: CatalogEntry, pins: V3[]): BuildResult {
  const f = frameOn(pins, [0, 1, 2])
  const group = new THREE.Group()
  const body = new THREE.Group()
  body.position.copy(f.c)
  body.rotation.y = f.yaw
  body.add(
    new THREE.Mesh(
      cachedGeometry('sens-ua-body', () => {
        // front outline with the chamfered shoulders of the branded face
        const w = UA.w * MM
        const h = UA.h * MM
        const c = UA.chamfer * MM
        const s = new THREE.Shape()
        s.moveTo(-w / 2, 0)
        s.lineTo(w / 2, 0)
        s.lineTo(w / 2, h - c)
        s.lineTo(w / 2 - c, h)
        s.lineTo(-w / 2 + c, h)
        s.lineTo(-w / 2, h - c)
        s.closePath()
        const g = new THREE.ExtrudeGeometry(s, {
          depth: UA.d * MM - 0.12 * MM,
          bevelEnabled: true,
          bevelThickness: 0.06 * MM,
          bevelSize: 0.06 * MM,
          bevelSegments: 1,
        })
        g.translate(0, UA.base * MM, -(UA.d / 2) * MM + 0.06 * MM)
        return g
      }),
      moldedEpoxy(0x18181a, 0.45),
    ),
  )
  if (!isGhost(comp)) {
    const mat = etchedLabelMaterial(['3144', 'EUA'], 1.6)
    if (mat) {
      const lbl = new THREE.Mesh(
        cachedGeometry('sens-ua-mark', () => new THREE.PlaneGeometry(2.6 * MM, 1.6 * MM)),
        mat,
      )
      lbl.position.set(0, (UA.base + 1.45) * MM, (UA.d / 2) * MM + 0.004)
      body.add(lbl)
    }
  }
  group.add(body)
  // 1.27 mm package pitch spread out to the 2.54 mm holes
  const legs: THREE.Object3D[] = []
  pins.slice(0, 3).forEach((pin, i) => {
    const exit = toWorld(f, (i - 1) * 1.27, (UA.base + 0.3) * MM, 0)
    const knee = toWorld(f, (i - 1) * 1.27, (UA.base - 0.9) * MM, 0)
    const pts =
      Math.hypot(knee.x - pin.x, knee.z - pin.z) < 0.03
        ? [V(pin.x, HOLE_DEPTH, pin.z), exit]
        : [V(pin.x, HOLE_DEPTH, pin.z), V(pin.x, 0.3, pin.z), knee, exit]
    legs.push(leadTube(pts, 0.07))
  })
  for (const m of mergeStatic(legs)) group.add(m)
  for (const l of legs) (l as THREE.Mesh).geometry.dispose()
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------

registerMeshBuilder('gy521', 8, buildGy521)
registerMeshBuilder('gy_bmx280', 6, buildBmx280)
registerMeshBuilder('gy302', 5, buildGy302)
registerMeshBuilder('dht_module', 3, buildDht)
registerMeshBuilder('hcsr04', 4, buildHcsr04)
registerMeshBuilder('ky040', 5, buildKy040)
registerMeshBuilder('ky023', 5, buildKy023)
registerMeshBuilder('acs712', 5, buildTermModule(ACS))
registerMeshBuilder('voltage_sensor', 5, buildTermModule(VSENS))
registerMeshBuilder('vs1838b', 3, buildVs1838b)
registerMeshBuilder('hall_ua', 3, buildA3144)
