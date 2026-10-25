/**
 * Building blocks of the communication-module meshes (comm.mesh.ts): small
 * breakout boards built to the Blue Pill standard (src/three/meshes/boards.ts
 * + pcb.ts) — one painted art quad per board design (soldermask, copper,
 * HASL pads, silkscreen), the routed FR4 edge, 2.54 mm headers with tinned
 * posts and solder fillets, SOIC / SOT-223 / QFN packages with gull-wing
 * lead ribbons, 0603 chip parts, 0603 indicator LEDs (per-instance emissive
 * lens + additive glow sprite — never a light), 2.54 mm shunt jumpers, an
 * HC-49/S SMD crystal and a USB-A plug.
 *
 * Units: layout in MILLIMETRES in a module frame (x along the pin row, +z
 * toward the module body, y up from the breadboard surface — y values are
 * plan units, like boards.ts); `MM` converts. Every static piece is merged
 * per material once per design and shared by every instance (cached
 * geometries / materials are never disposed with an instance).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance, ComponentTelemetry } from '../../../model/types'
import {
  brushedRoughnessTexture,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  markShared,
  mergeStatic,
} from '../shared'
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
  stadiumShape,
  trianglesGeometry,
} from '../pcb'
import type { PcbArtStyle, PcbPainter } from '../pcb'
import { LED_COLORS, ledGlowTexture } from '../semis'

export { MM }
export type { PcbPainter }

type V3 = THREE.Vector3
export const V = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z)
export const isGhost = (comp: ComponentInstance): boolean => comp.id === '__ghost__'

// ---------------------------------------------------------------------------
// dimensions (mm unless noted)
// ---------------------------------------------------------------------------

export const PITCH = 2.54
/** black header plastic between the breadboard and a flat module's PCB */
export const SPACER = 2.5
export const PCB_T = 1.6
/** 2.54 mm male header: 3.0 mm short end through a 1.6 mm board */
export const PIN_PROUD = 1.4
/** every top-side package floats this far above the art quad (plan units) */
export const LIFT = 0.004
/** soldermask roll-over chamfer on the routed top arris */
export const EDGE_CHAMFER = 0.15

/** y (plan units) of a flat module's PCB bottom / top faces */
export const Y_BOT = SPACER * MM
export const Y_TOP = (SPACER + PCB_T) * MM

/** Soldermask palettes (sRGB) of the module boards. */
export const MASKS = {
  blue: { mask: '#163f9a', maskCopper: '#1e4cab', pad: '#c2c5c8', silk: '#f1f1ea', drill: '#0b1a40' },
  red: { mask: '#8c1717', maskCopper: '#a32222', pad: '#c4c6c8', silk: '#f3f1ea', drill: '#2b0707' },
  purple: { mask: '#3d2770', maskCopper: '#4a3283', pad: '#c4c6c8', silk: '#f1eff4', drill: '#140b2a' },
  green: { mask: '#1d5a36', maskCopper: '#256a41', pad: '#c8c4a8', silk: '#f0f0e6', drill: '#08200f' },
  black: { mask: '#16171a', maskCopper: '#202227', pad: '#c4c6c8', silk: '#ecece6', drill: '#050506' },
} satisfies Record<string, PcbArtStyle>

/** Bottom / edge-on shade of each palette. */
export const MASK_EDGE: Record<keyof typeof MASKS, number> = {
  blue: 0x123478,
  red: 0x6d1212,
  purple: 0x2f1f58,
  green: 0x174a2c,
  black: 0x111214,
}

// ---------------------------------------------------------------------------
// materials (cached, shared)
// ---------------------------------------------------------------------------

function kitMetal(key: string, color: number, roughness: number, metalness = 1.0, brushed = true): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`comm-metal:${key}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color, metalness, roughness })
    const r = brushed ? brushedRoughnessTexture() : null
    if (r) m.roughnessMap = r
    return m
  })
}
/** tinned header posts proud of the joints (rough: small facets average the environment) */
export const tinnedPost = (): THREE.MeshPhysicalMaterial => kitMetal('post', 0xd8dce0, 0.7, 0.7)
/** gold-flash posts of top-mounted jumper headers */
export const goldPost = (): THREE.MeshPhysicalMaterial => kitMetal('gold', 0xdcb05a, 0.55, 0.6)
/** matte tin: gull-wing leads, chip terminations */
export const leadTin = (): THREE.MeshPhysicalMaterial => kitMetal('lead', 0x8a8f95, 0.7, 0.3)
/** drawn steel shells (USB plug, SD socket), polished walls */
export const steel = (): THREE.MeshPhysicalMaterial => kitMetal('steel', 0xb4b8bd, 0.36)
/** satin up-facing metal flats (crystal can tops) */
export const satinMetal = (): THREE.MeshPhysicalMaterial => kitMetal('satin', 0x8d9298, 0.62, 0.5)
/** polished nickel crystal can walls */
export const canMetal = (): THREE.MeshPhysicalMaterial => kitMetal('can', 0xb8bdc3, 0.3, 1.0, false)
/** gold contact fingers */
export const goldContact = (): THREE.MeshPhysicalMaterial => kitMetal('contact', 0xd4a84a, 0.4, 0.9, false)
/** near-black occluded cavities (socket mouths) */
export const cavity = (): THREE.MeshStandardMaterial =>
  cachedMaterial('comm-cavity', () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9, metalness: 0 }))
/** black molded epoxy of SMD packages (shared with the Blue Pill LQFP look) */
export const mold = (): THREE.MeshPhysicalMaterial => qfpMoldMaterial()
/** 0603 resistor body (black film side up) */
export const resistorBody = (): THREE.MeshPhysicalMaterial =>
  cachedMaterial('comm-res', () => new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.5, metalness: 0 }))
/** 0603 MLCC body (tan ceramic) */
export const capBody = (): THREE.MeshPhysicalMaterial =>
  cachedMaterial('comm-cap', () => new THREE.MeshPhysicalMaterial({ color: 0xb59a6a, roughness: 0.55, metalness: 0 }))
/** white LED substrate under the lens */
export const ledSubstrate = (): THREE.MeshPhysicalMaterial =>
  cachedMaterial('comm-led-sub', () => new THREE.MeshPhysicalMaterial({ color: 0xe9e6dc, roughness: 0.5, metalness: 0 }))
/** colored jumper shunt plastic */
export const shuntPlastic = (color: number): THREE.MeshPhysicalMaterial =>
  cachedMaterial(`comm-shunt:${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, metalness: 0, clearcoat: 0.15 }))
/** white / natural nylon (USB tongue, SD card print area) */
export const nylon = (color = 0xeceae4): THREE.MeshPhysicalMaterial =>
  cachedMaterial(`comm-nylon:${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0 }))

// ---------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------

export interface ModuleFrame {
  /** world centroid of the pins (the module frame origin) */
  c: V3
  /** rotation about +y (module +x → world direction pin a → pin b) */
  yaw: number
}

/**
 * Module frame from the real pin holes: +x runs from pins[a] to pins[b]
 * (rotation-aware — a 180° placement turns the whole module), the origin is
 * the centroid of every pin. Degenerate inputs (coincident / missing pins)
 * fall back to yaw 0.
 */
export function moduleFrame(pins: V3[], a: number, b: number): ModuleFrame {
  const pa = pins[a]
  const pb = pins[Math.min(b, pins.length - 1)]
  let yaw = 0
  if (pa && pb) {
    const dx = pb.x - pa.x
    const dz = pb.z - pa.z
    if (Math.hypot(dx, dz) > 1e-6) yaw = Math.atan2(-dz, dx)
  }
  return { c: pins.length > 0 ? centroidOf(pins) : V(0, 0, 0), yaw }
}

/** The group every builder fills: origin at the frame, turned by its yaw. */
export function frameGroup(f: ModuleFrame): THREE.Group {
  const g = new THREE.Group()
  g.position.set(f.c.x, 0, f.c.z)
  g.rotation.y = f.yaw
  return g
}

/** Centroid (mm) of a pin layout — subtracted so the frame origin is the pin centroid. */
export function layoutCentroid(pts: readonly (readonly [number, number])[]): [number, number] {
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p[0]
    z += p[1]
  }
  return pts.length ? [x / pts.length, z / pts.length] : [0, 0]
}

/** Place `o` at (xMm, y plan units, zMm) and collect it. */
export function put(parts: THREE.Object3D[], o: THREE.Object3D, xMm: number, y: number, zMm: number, rotY = 0): THREE.Object3D {
  o.position.set(xMm * MM, y, zMm * MM)
  if (rotY) o.rotation.y = rotY
  parts.push(o)
  return o
}

export interface StaticPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Merge collected statics per material; the merged geometries are shared (page lifetime). */
export function mergeParts(parts: THREE.Object3D[]): StaticPart[] {
  return mergeStatic(parts).map((m) => {
    markShared(m.geometry)
    return { geometry: m.geometry, material: m.material as THREE.Material }
  })
}

export function addStatics(group: THREE.Object3D, statics: StaticPart[]): void {
  for (const s of statics) {
    const m = new THREE.Mesh(s.geometry, s.material)
    m.matrixAutoUpdate = false
    m.updateMatrix()
    group.add(m)
  }
}

// ---------------------------------------------------------------------------
// boards
// ---------------------------------------------------------------------------

export interface BoardSpec {
  /** art cache key (one per board design) */
  key: string
  /** board size (mm): along x, along z */
  w: number
  d: number
  /** board center in the module frame (mm) */
  x: number
  z: number
  /** bottom face y (plan units) */
  y0: number
  palette: keyof typeof MASKS
  paint: (p: PcbPainter) => void
  thickness?: number
  pxPerMm?: number
}

/**
 * A flat board: painted art quad on top (inset by the mask roll-over), the
 * routed edge (FR4 core between mask lips) and the soldermask bottom.
 * The painter works board-centered (x right, z toward +z of the module).
 */
export function flatBoard(parts: THREE.Object3D[], b: BoardSpec): void {
  const t = b.thickness ?? PCB_T
  const art = pcbArtMaterial(`comm-${b.key}`, b.w, b.d, MASKS[b.palette], b.paint, { pxPerMm: b.pxPerMm ?? 48 })
  put(parts, new THREE.Mesh(boardTopGeometry(b.w, b.d, EDGE_CHAMFER), art), b.x, b.y0 + t * MM, b.z)
  const edge = boardEdgeGeometries(b.w, b.d, t, EDGE_CHAMFER)
  put(parts, new THREE.Mesh(edge.fr4, fr4EdgeMaterial()), b.x, b.y0, b.z)
  put(parts, new THREE.Mesh(edge.mask, maskMaterial(MASK_EDGE[b.palette])), b.x, b.y0, b.z)
  const bottom = new THREE.Mesh(flatQuadGeometry(b.w * MM, b.d * MM), maskMaterial(MASK_EDGE[b.palette]))
  bottom.rotation.x = Math.PI
  put(parts, bottom, b.x, b.y0, b.z)
}

/**
 * Header strips UNDER a flat board (black plastic between breadboard and
 * PCB along each run of pins) + the tinned post tips and solder fillets
 * proud of the top. `rows` = runs of pin centers (mm) in one straight line.
 */
export function underHeader(parts: THREE.Object3D[], rows: (readonly [number, number])[][], yTop = Y_TOP): void {
  const tipGeo = headerPostGeometry(0.32 * MM, PIN_PROUD * MM, 0.16 * MM)
  const filletGeo = solderFilletGeometry(0.8 * MM, 0.36 * MM, 0.55 * MM)
  for (const run of rows) {
    if (run.length === 0) continue
    const [x0, z0] = run[0]
    const [x1, z1] = run[run.length - 1]
    const len = Math.hypot(x1 - x0, z1 - z0) + PITCH
    const strip = new THREE.Mesh(slabGeometry(len * MM - 0.004, SPACER * MM - 0.004, 2.5 * MM, { top: true, bottom: true }), headerPlasticMaterial())
    const rot = Math.abs(z1 - z0) > Math.abs(x1 - x0) ? Math.PI / 2 : 0
    put(parts, strip, (x0 + x1) / 2, (SPACER * MM) / 2 + 0.002, (z0 + z1) / 2, rot)
    for (const [x, z] of run) {
      put(parts, new THREE.Mesh(tipGeo, tinnedPost()), x, yTop, z)
      put(parts, new THREE.Mesh(filletGeo, solderMaterial()), x, yTop + 0.002, z)
    }
  }
}

/**
 * A 1×n header standing ON the board (jumper / config headers): plastic
 * strip on the top face, gold posts rising out of it. Run along x from
 * (x0, z), `n` pins.
 */
export function topHeader(parts: THREE.Object3D[], x0: number, z: number, n: number, yTop: number, along: 'x' | 'z' = 'x'): void {
  const len = n * PITCH
  const strip = new THREE.Mesh(slabGeometry(len * MM - 0.01, 2.5 * MM, 2.5 * MM, { bottom: true }), headerPlasticMaterial())
  const cx = along === 'x' ? x0 + ((n - 1) * PITCH) / 2 : x0
  const cz = along === 'x' ? z : z + ((n - 1) * PITCH) / 2
  put(parts, strip, cx, yTop + (2.5 * MM) / 2, cz, along === 'z' ? Math.PI / 2 : 0)
  const post = headerPostGeometry(0.32 * MM, 5.8 * MM, 0.2 * MM)
  for (let i = 0; i < n; i++) {
    const x = along === 'x' ? x0 + i * PITCH : x0
    const zz = along === 'x' ? z : z + i * PITCH
    put(parts, new THREE.Mesh(post, goldPost()), x, yTop + 2.5 * MM, zz)
  }
}

/** 2.54 mm shunt (5.0 × 2.5 × 6.0 mm), bottom at y = 0, long axis along x. */
export function shuntGeometry(): THREE.BufferGeometry {
  return cachedGeometry('comm-shunt', () => {
    const g = new RoundedBoxGeometry(4.95 * MM, 6.0 * MM, 2.3 * MM, 1, 0.32 * MM)
    g.translate(0, 3.0 * MM, 0)
    return g
  })
}

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

/** one quad (a, b, c, d CCW seen from the front) */
function quad(out: number[], a: number[], b: number[], c: number[], d: number[]): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2])
}

/**
 * Gull-wing lead ribbons of a dual-row SMD package (SOIC / SOP / SOT-23-x):
 * `perSide` leads on the ±x sides at `pitch`, body edge at ±bodyW/2, toes
 * at ±span/2, feet on y = 0. 4 lit quads per lead.
 */
export function gullWingGeometry(bodyW: number, span: number, perSide: number, pitch: number, leadW: number, shoulderMm: number): THREE.BufferGeometry {
  return cachedGeometry(`comm-gull:${bodyW}:${span}:${perSide}:${pitch}:${leadW}:${shoulderMm}`, () => {
    const p: number[] = []
    const hw = (leadW / 2) * MM
    const e = (bodyW / 2) * MM
    const t = (span / 2) * MM
    const yS = shoulderMm * MM
    const yF = 0.18 * MM
    const xs = e - 0.05 * MM
    const reach = t - e
    const xk = e + reach * 0.22
    const xf = e + reach * 0.5
    const lead: number[] = []
    quad(lead, [xs, yS, hw], [xk, yS, hw], [xk, yS, -hw], [xs, yS, -hw])
    quad(lead, [xk, yS, hw], [xf, yF, hw], [xf, yF, -hw], [xk, yS, -hw])
    quad(lead, [xf, yF, hw], [t, yF, hw], [t, yF, -hw], [xf, yF, -hw])
    quad(lead, [t, yF, hw], [t, 0, hw], [t, 0, -hw], [t, yF, -hw])
    for (const side of [1, -1]) {
      for (let k = 0; k < perSide; k++) {
        const off = (k - (perSide - 1) / 2) * pitch * MM
        for (let i = 0; i < lead.length; i += 3) p.push(side * lead[i], lead[i + 1], lead[i + 2] + off)
      }
    }
    // the mirrored copy (side −1) flips the winding: rebuild it CCW
    const out: number[] = []
    const half = (p.length / 2) | 0
    for (let i = 0; i < p.length; i += 9) {
      if (i < half) out.push(...p.slice(i, i + 9))
      else out.push(p[i], p[i + 1], p[i + 2], p[i + 6], p[i + 7], p[i + 8], p[i + 3], p[i + 4], p[i + 5])
    }
    return trianglesGeometry(out)
  })
}

export interface SoicSpec {
  /** leads per side */
  n: number
  pitch: number
  /** body length (along the lead rows) × width (across) × height, mm */
  L: number
  W: number
  H: number
  /** toe-to-toe span */
  span: number
  leadW?: number
}

export const SOIC8: SoicSpec = { n: 4, pitch: 1.27, L: 4.9, W: 3.9, H: 1.45, span: 6.0, leadW: 0.42 }
/** 208-mil SOIC-8 (W25Q32JVSSIQ) */
export const SOIC8W: SoicSpec = { n: 4, pitch: 1.27, L: 5.28, W: 5.28, H: 1.8, span: 7.9, leadW: 0.42 }
export const SOIC14: SoicSpec = { n: 7, pitch: 1.27, L: 8.65, W: 3.9, H: 1.45, span: 6.0, leadW: 0.42 }
export const SOIC16: SoicSpec = { n: 8, pitch: 1.27, L: 9.9, W: 3.9, H: 1.45, span: 6.0, leadW: 0.42 }
/** 300-mil wide SO-16 (PCF8574T) */
export const SOIC16W: SoicSpec = { n: 8, pitch: 1.27, L: 10.3, W: 7.5, H: 2.35, span: 10.3, leadW: 0.42 }

/**
 * A dual-row SMD package on the board top at (x, z): drafted body + lead
 * ribbons + pin-1 dimple. `rot` = 0 → the lead rows run along z (leads exit
 * ±x); π/2 → rows along x. Returns the body's top y (plan units).
 */
export function soic(parts: THREE.Object3D[], s: SoicSpec, x: number, z: number, rot: number, yTop = Y_TOP): number {
  const g = new THREE.Group()
  const standoff = 0.12
  const body = new THREE.Mesh(
    cachedGeometry(`comm-soic-body:${s.W}:${s.H}:${s.L}`, () => {
      const geo = new RoundedBoxGeometry(s.W * MM, s.H * MM, s.L * MM, 1, 0.12 * MM)
      geo.translate(0, (s.H / 2 + standoff) * MM, 0)
      return geo
    }),
    mold(),
  )
  g.add(body)
  const leads = new THREE.Mesh(gullWingGeometry(s.W, s.span, s.n, s.pitch, s.leadW ?? 0.42, s.H * 0.45 + standoff), leadTin())
  g.add(leads)
  const dimple = new THREE.Mesh(
    cachedGeometry('comm-dimple', () => {
      const c = new THREE.CircleGeometry(0.35 * MM, 10)
      c.rotateX(-Math.PI / 2)
      return c
    }),
    cavity(),
  )
  dimple.position.set((-s.W / 2 + 0.75) * MM, (s.H + standoff) * MM + 0.002, (-s.L / 2 + 0.8) * MM)
  g.add(dimple)
  put(parts, g, x, yTop + LIFT, z, rot)
  return yTop + LIFT + (s.H + standoff) * MM
}

/** QFN body (no visible leads beyond the side pads): w × w × h mm. */
export function qfn(parts: THREE.Object3D[], w: number, h: number, x: number, z: number, yTop = Y_TOP): number {
  const body = new THREE.Mesh(slabGeometry(w * MM, h * MM, w * MM, { bottom: true }), mold())
  put(parts, body, x, yTop + LIFT + (h * MM) / 2, z)
  // side pads (wettable flanks) as thin tin strips on each face
  const pad = slabGeometry(w * 0.86 * MM, 0.2 * MM, 0.08 * MM, { bottom: true })
  for (const [dx, dz, r] of [
    [0, w / 2 + 0.02, 0],
    [0, -w / 2 - 0.02, 0],
    [w / 2 + 0.02, 0, Math.PI / 2],
    [-w / 2 - 0.02, 0, Math.PI / 2],
  ] as const) {
    put(parts, new THREE.Mesh(pad, leadTin()), x + dx, yTop + LIFT + 0.1 * MM, z + dz, r)
  }
  return yTop + LIFT + h * MM
}

/** SOT-223 regulator (6.5 × 3.5 × 1.6 mm), tab toward −z, 3 leads toward +z (rot about y). */
export function sot223(parts: THREE.Object3D[], x: number, z: number, rot: number, yTop = Y_TOP): number {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    cachedGeometry('comm-sot223', () => {
      const geo = new RoundedBoxGeometry(6.5 * MM, 1.6 * MM, 3.5 * MM, 1, 0.12 * MM)
      geo.translate(0, 0.9 * MM, 0)
      return geo
    }),
    mold(),
  )
  g.add(body)
  const tab = new THREE.Mesh(slabGeometry(3.0 * MM, 0.3 * MM, 1.9 * MM, { bottom: true }), leadTin())
  tab.position.set(0, 0.15 * MM, -2.6 * MM)
  g.add(tab)
  for (const lx of [-2.3, 0, 2.3]) {
    const lead = new THREE.Mesh(slabGeometry(0.7 * MM, 0.26 * MM, 1.7 * MM, { bottom: true }), leadTin())
    lead.position.set(lx * MM, 0.13 * MM, 2.55 * MM)
    g.add(lead)
  }
  put(parts, g, x, yTop + LIFT, z, rot)
  return yTop + LIFT + 1.7 * MM
}

/** SOT-23 (2.9 × 1.3 × 1.0 mm, 3 leads), long axis along x before `rot`. */
export function sot23(parts: THREE.Object3D[], x: number, z: number, rot: number, yTop = Y_TOP): void {
  const g = new THREE.Group()
  const body = new THREE.Mesh(slabGeometry(2.9 * MM, 0.95 * MM, 1.3 * MM, { bottom: true }), mold())
  body.position.y = 0.58 * MM
  g.add(body)
  const foot = slabGeometry(0.4 * MM, 0.12 * MM, 0.55 * MM, { bottom: true })
  for (const [lx, lz] of [
    [-0.95, 1.0],
    [0.95, 1.0],
    [0, -1.0],
  ] as const) {
    const m = new THREE.Mesh(foot, leadTin())
    m.position.set(lx * MM, 0.06 * MM, lz * MM)
    g.add(m)
  }
  put(parts, g, x, yTop + LIFT, z, rot)
}

/** 0603 chip resistor / capacitor at (x, z), long axis along x rotated by `rotDeg`. */
export function chip(parts: THREE.Object3D[], kind: 'R' | 'C', x: number, z: number, rotDeg = 0, yTop = Y_TOP): void {
  const g = new THREE.Group()
  for (const m of chip0603(kind === 'R' ? resistorBody() : capBody(), solderMaterial(), kind === 'R' ? 0.45 : 0.8)) g.add(m)
  put(parts, g, x, yTop + LIFT, z, (-rotDeg * Math.PI) / 180)
}

/** HC-49/S SMD crystal: black base plate + drawn stadium can, long axis along x (rot about y). */
export function crystalHc49Smd(parts: THREE.Object3D[], x: number, z: number, rot: number, yTop = Y_TOP): number {
  const g = new THREE.Group()
  const base = new THREE.Mesh(slabGeometry(11.4 * MM, 0.5 * MM, 4.9 * MM, { bottom: true }), mold())
  base.position.y = 0.25 * MM
  g.add(base)
  const can = new THREE.Mesh(
    cachedGeometry('comm-hc49-can', () => {
      const geo = new THREE.ExtrudeGeometry(stadiumShape(10.6 * MM, 4.3 * MM), {
        depth: 3.0 * MM,
        bevelEnabled: true,
        bevelThickness: 0.2 * MM,
        bevelSize: 0.2 * MM,
        bevelSegments: 1,
        curveSegments: 5,
      })
      geo.rotateX(-Math.PI / 2) // extrude along +y
      geo.translate(0, 0.5 * MM, 0)
      return geo
    }),
    canMetal(),
  )
  g.add(can)
  // the two solder tabs at the ends
  for (const s of [-1, 1]) {
    const tab = new THREE.Mesh(slabGeometry(1.4 * MM, 0.2 * MM, 1.6 * MM, { bottom: true }), leadTin())
    tab.position.set(s * 6.1 * MM, 0.1 * MM, 0)
    g.add(tab)
  }
  put(parts, g, x, yTop + LIFT, z, rot)
  return yTop + LIFT + 3.9 * MM
}

/** Small SMD crystal / oscillator (3.2 × 2.5 mm seam-sealed lid on a ceramic base). */
export function crystal3225(parts: THREE.Object3D[], x: number, z: number, yTop = Y_TOP): void {
  const base = new THREE.Mesh(slabGeometry(3.2 * MM, 0.35 * MM, 2.5 * MM, { bottom: true }), nylon(0xc9b48c))
  put(parts, base, x, yTop + LIFT + 0.175 * MM, z)
  const lid = new THREE.Mesh(slabGeometry(2.9 * MM, 0.35 * MM, 2.2 * MM, { bottom: true }), satinMetal())
  put(parts, lid, x, yTop + LIFT + 0.525 * MM, z)
}

/** Tactile switch (SMD 3 × 4 mm body, round plunger) — e.g. the HC-05 KEY button. */
export function tactSwitch(parts: THREE.Object3D[], x: number, z: number, yTop = Y_TOP): void {
  const body = new THREE.Mesh(slabGeometry(4.0 * MM, 1.5 * MM, 3.0 * MM, { bottom: true }), nylon(0x1d1d1f))
  put(parts, body, x, yTop + LIFT + 0.75 * MM, z)
  const plate = new THREE.Mesh(slabGeometry(3.6 * MM, 0.15 * MM, 2.6 * MM, { bottom: true }), satinMetal())
  put(parts, plate, x, yTop + LIFT + 1.55 * MM, z)
  const plunger = new THREE.Mesh(
    cachedGeometry('comm-plunger', () => {
      const g = new THREE.CylinderGeometry(0.8 * MM, 0.8 * MM, 0.5 * MM, 10, 1, false)
      g.translate(0, 0.25 * MM, 0)
      return g
    }),
    nylon(0x2a2a2d),
  )
  put(parts, plunger, x, yTop + LIFT + 1.6 * MM, z)
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(slabGeometry(0.6 * MM, 0.2 * MM, 1.0 * MM, { bottom: true }), leadTin())
    put(parts, leg, x + s * 2.3, yTop + LIFT + 0.1 * MM, z)
  }
}

/**
 * USB-A plug in its own frame: mating face toward −z, shell bottom at
 * y = 0, centered on x; `len` mm of drawn steel shell. The opening is a
 * true hole into a dark cavity; the white tongue carries the four gold
 * contacts in the upper half (USB 2.0 §6.5 plug: 12.0 × 4.5 mm shell).
 */
export function usbAPlug(parts: THREE.Object3D[], x: number, zMouth: number, len: number, y0: number): number {
  const W = 12.0
  const H = 4.5
  const t = 0.3
  const shell = cachedGeometry(`comm-usba-shell:${len}`, () => {
    const outer = new THREE.Shape()
    const r = 0.5
    outer.moveTo((-W / 2 + r) * MM, 0)
    outer.lineTo((W / 2 - r) * MM, 0)
    outer.quadraticCurveTo((W / 2) * MM, 0, (W / 2) * MM, r * MM)
    outer.lineTo((W / 2) * MM, (H - r) * MM)
    outer.quadraticCurveTo((W / 2) * MM, H * MM, (W / 2 - r) * MM, H * MM)
    outer.lineTo((-W / 2 + r) * MM, H * MM)
    outer.quadraticCurveTo((-W / 2) * MM, H * MM, (-W / 2) * MM, (H - r) * MM)
    outer.lineTo((-W / 2) * MM, r * MM)
    outer.quadraticCurveTo((-W / 2) * MM, 0, (-W / 2 + r) * MM, 0)
    const hole = new THREE.Path()
    hole.moveTo((-W / 2 + t) * MM, t * MM)
    hole.lineTo((W / 2 - t) * MM, t * MM)
    hole.lineTo((W / 2 - t) * MM, (H - t) * MM)
    hole.lineTo((-W / 2 + t) * MM, (H - t) * MM)
    hole.closePath()
    outer.holes.push(hole)
    // extruded along +z from the mouth (z = 0) back over `len`
    return new THREE.ExtrudeGeometry(outer, { depth: len * MM, bevelEnabled: false, curveSegments: 2 })
  })
  put(parts, new THREE.Mesh(shell, steel()), x, y0, zMouth)
  // dark back wall inside the shell, just behind the tongue's root
  const back = new THREE.Mesh(slabGeometry((W - 2 * t) * MM, (H - 2 * t) * MM, 0.2 * MM), cavity())
  put(parts, back, x, y0 + (H / 2) * MM, zMouth + 8.6)
  // the drawn shell is closed at the rear (crimped over the plug body)
  const rear = new THREE.Mesh(slabGeometry((W - 0.1) * MM, (H - 0.1) * MM, 0.3 * MM), steel())
  put(parts, rear, x, y0 + (H / 2) * MM, zMouth + len - 0.15)
  // the tongue (upper half), contacts on its lower face
  const tongue = new THREE.Mesh(slabGeometry(11.0 * MM, 1.9 * MM, 8.4 * MM), nylon())
  put(parts, tongue, x, y0 + (H - t - 0.95) * MM, zMouth + 4.4)
  for (const cx of [-3.5, -1.0, 1.0, 3.5]) {
    const len2 = cx === -3.5 || cx === 3.5 ? 7.4 : 6.6
    const contact = new THREE.Mesh(slabGeometry(1.0 * MM, 0.08 * MM, len2 * MM), goldContact())
    put(parts, contact, x + cx, y0 + (H - t - 1.94) * MM, zMouth + 0.9 + len2 / 2)
  }
  return y0 + H * MM
}

// ---------------------------------------------------------------------------
// indicator LEDs (per instance)
// ---------------------------------------------------------------------------

const LENS_TINT: Record<string, number> = { red: 0xf4d2cc, green: 0xd6efd4, blue: 0xd2dcf5, yellow: 0xf3ecc8, white: 0xf1f1ee }

export interface LedRig {
  lens: THREE.MeshPhysicalMaterial
  glow: THREE.Sprite | null
  tint: number
  level: number
}

/** 0603 LED substrate (static) for an LED at (x, z) with its long axis along x rotated `rotDeg`. */
export function ledBase(parts: THREE.Object3D[], x: number, z: number, rotDeg = 0, yTop = Y_TOP): void {
  const g = new THREE.Group()
  const sub = new THREE.Mesh(slabGeometry(1.6 * MM, 0.28 * MM, 0.8 * MM, { bottom: true }), ledSubstrate())
  sub.position.y = 0.14 * MM
  g.add(sub)
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(slabGeometry(0.3 * MM, 0.3 * MM, 0.8 * MM, { bottom: true }), solderMaterial())
    cap.position.set(s * 0.65 * MM, 0.15 * MM, 0)
    g.add(cap)
  }
  put(parts, g, x, yTop + LIFT, z, (-rotDeg * Math.PI) / 180)
}

/**
 * The lit lens of an 0603 LED (per instance: emissive) + its additive halo
 * sprite. Ghost previews share one unlit lens and get no sprite. Add the
 * returned objects with `group.add(...)` — or into `parent` (a face group).
 */
export function ledLens(
  parent: THREE.Object3D,
  color: keyof typeof LENS_TINT,
  x: number,
  z: number,
  ghost: boolean,
  yTop = Y_TOP,
  rotDeg = 0,
): LedRig {
  const tint = LENS_TINT[color]
  const lit = LED_COLORS[color] ?? 0xffffff
  const lens = ghost
    ? cachedMaterial(`comm-led-lens:${color}`, () => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.3, metalness: 0 }))
    : new THREE.MeshPhysicalMaterial({
        color: tint,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.28,
        emissive: new THREE.Color(lit),
        emissiveIntensity: 0,
      })
  const mesh = new THREE.Mesh(slabGeometry(1.0 * MM, 0.3 * MM, 0.7 * MM, { bottom: true }), lens)
  mesh.position.set(x * MM, yTop + LIFT + 0.43 * MM, z * MM)
  mesh.rotation.y = (-rotDeg * Math.PI) / 180
  parent.add(mesh)
  let glow: THREE.Sprite | null = null
  if (!ghost) {
    glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ledGlowTexture(),
        color: lit,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    glow.position.set(x * MM, yTop + 0.3, z * MM)
    glow.scale.setScalar(1.1)
    glow.visible = false
    parent.add(glow)
  }
  return { lens, glow, tint, level: -1 }
}

/**
 * Light an indicator LED: `br` 0..1 (engine I / 10 mA, or a logic channel's
 * 0/1). Perceptual √ curve like the Blue Pill; only numeric mutations.
 */
export function applyLed(rig: LedRig | null, br: number | undefined): void {
  if (!rig) return
  const b = br !== undefined && br > 0 ? Math.min(br, 1) : 0
  if (Math.abs(b - rig.level) < 1e-3) return
  rig.level = b
  const perceived = Math.sqrt(b)
  rig.lens.emissiveIntensity = b <= 0.001 ? 0 : 1.2 + 4.0 * perceived
  if (rig.glow) {
    const mat = rig.glow.material
    if (b > 0.002) {
      rig.glow.visible = true
      mat.opacity = Math.min(1, 0.35 + 0.65 * perceived)
      rig.glow.scale.setScalar(0.8 + 1.0 * perceived)
    } else {
      rig.glow.visible = false
      mat.opacity = 0
    }
  }
}

/** ledBrightness of a sub-circuit LED (e.g. 'LED_PWR'), else undefined. */
export function subLed(t: ComponentTelemetry | null, id: string): number | undefined {
  return t?.sub?.[id]?.ledBrightness
}

// ---------------------------------------------------------------------------
// prints (package markings, card labels)
// ---------------------------------------------------------------------------

export interface PrintLine {
  text: string
  /** baseline-centre height as a fraction of the canvas (0 top … 1 bottom) */
  y: number
  /** font size as a fraction of the canvas height */
  size: number
  color?: string
  weight?: number
}

/**
 * Cached print (laser marking / pad print) as an unlit transparent
 * material; headless (no DOM) → null so builds never throw in node.
 */
export function printMaterial(key: string, w: number, h: number, lines: PrintLine[], bg?: string): THREE.MeshBasicMaterial | null {
  if (typeof document === 'undefined') return null
  return cachedMaterial(`comm-print:${key}`, () => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, w, h)
      if (bg) {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const l of lines) {
        ctx.fillStyle = l.color ?? '#cfcfd3'
        const font = (px: number) => `${l.weight ?? 700} ${px}px "Arial Narrow", Arial, "Helvetica Neue", sans-serif`
        let px = Math.round(l.size * h)
        ctx.font = font(px)
        // a marking never runs past its package: shrink the line to 90 % of the width
        const tw = ctx.measureText(l.text).width
        if (tw > 0.9 * w) {
          px = Math.max(6, Math.floor((px * 0.9 * w) / tw))
          ctx.font = font(px)
        }
        ctx.fillText(l.text, w / 2, l.y * h)
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    markShared(tex)
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 })
  })
}

/** A flat label quad (XZ plane, facing +y) at (x, y, z) in the module frame. */
export function topLabel(parent: THREE.Object3D, mat: THREE.Material | null, wMm: number, dMm: number, x: number, y: number, z: number, rotY = 0): void {
  if (!mat) return
  const m = new THREE.Mesh(flatQuadGeometry(wMm * MM, dMm * MM), mat)
  m.position.set(x * MM, y, z * MM)
  m.rotation.y = rotY
  parent.add(m)
}
