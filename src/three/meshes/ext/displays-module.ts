/**
 * Building blocks of the display-module meshes (displays.mesh.ts): the
 * module frame derived from the header pins, the PCB (soldermask art quad,
 * routed edge, bottom), a single-row 2.54 mm male header soldered from the
 * back (black plastic between the PCB and the breadboard, chamfered tinned
 * post tips in solder fillets on top — the Blue Pill's header recipe),
 * per-instance screen planes over DataTextures, and small parts.
 *
 * Module frame (all layout in millimetres, converted with MM): origin at
 * catalog pin 1 on the board surface, +x along the header (pin 1 → pin N),
 * +z toward the viewer of an upright module (the picture's "down"). It is
 * derived from where the first and last header pins ACTUALLY are, so a
 * module turned 180° renders physically turned.
 */
import * as THREE from 'three'
import type { BuildResult } from '../shared'
import { cachedGeometry, cachedMaterial, markShared, mergeStatic, metal } from '../shared'
import {
  MM,
  PcbPainter,
  boardEdgeGeometries,
  boardTopGeometry,
  flatQuadGeometry,
  fr4EdgeMaterial,
  headerPlasticMaterial,
  headerPostGeometry,
  maskMaterial,
  pcbArtMaterial,
  slabGeometry,
  solderFilletGeometry,
  solderMaterial,
} from '../pcb'
import type { PcbArtStyle } from '../pcb'

export { MM }

export const PITCH = 2.54
/** black header plastic between the breadboard and a module PCB (mm) */
export const SPACER = 2.5
/** short end of a standard male header above its plastic (mm) */
const SHORT_END = 3.0
/** every top-side part floats this far above its base (plan units: never coplanar) */
export const LIFT = 0.004

/** module frame from the header pins: origin at pin 1, yaw so local +x runs pin 1 → `last` */
export function placeModule(group: THREE.Group, pins: THREE.Vector3[], last: number): void {
  const a = pins[0] ?? new THREE.Vector3()
  const b = pins[Math.min(last, pins.length - 1)] ?? a
  let yaw = 0
  const dx = b.x - a.x
  const dz = b.z - a.z
  if (Math.hypot(dx, dz) > 1e-6) yaw = Math.atan2(-dz, dx)
  group.position.set(a.x, 0, a.z)
  group.rotation.y = yaw
}

/** Static part list in module-frame plan units (merged once per design). */
export class Parts {
  readonly list: THREE.Object3D[] = []

  /** add `geo` with `mat` at (xMm, y units, zMm) */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, xMm: number, y: number, zMm: number, rotY = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(xMm * MM, y, zMm * MM)
    m.rotation.y = rotY
    this.list.push(m)
    return m
  }

  obj(o: THREE.Object3D, xMm: number, y: number, zMm: number): THREE.Object3D {
    o.position.set(xMm * MM, y, zMm * MM)
    this.list.push(o)
    return o
  }

  /** merge into shared meshes (one per material) — page-lifetime resources */
  merged(): StaticMesh[] {
    return mergeStatic(this.list).map((m) => {
      markShared(m.geometry)
      return { geometry: m.geometry, material: m.material as THREE.Material }
    })
  }
}

export interface StaticMesh {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Lazily merged statics of one module design (shared by every instance and the ghost). */
export function staticsOnce(build: () => Parts): () => StaticMesh[] {
  let cache: StaticMesh[] | null = null
  return () => (cache ??= build().merged())
}

export function addStatics(group: THREE.Group, statics: StaticMesh[]): void {
  for (const s of statics) group.add(new THREE.Mesh(s.geometry, s.material))
}

// ------------------------------------------------------------------- PCB

export interface PcbSpec {
  key: string
  wMm: number
  hMm: number
  tMm: number
  /** PCB centre in the module frame (mm) */
  cx: number
  cz: number
  /** height of the PCB bottom above the board (mm) */
  yBotMm: number
  style: PcbArtStyle
  /** soldermask seen on the edge / underside */
  edge: number
  /** painter in BOARD-centred mm (+x right, +z toward the viewer); `at` converts module-frame mm */
  paint: (p: PcbPainter, at: (xMm: number, zMm: number) => [number, number]) => void
  pxPerMm?: number
}

const EDGE_CHAMFER = 0.15

/** PCB slab: painted top, routed edge (FR4 core between mask lips), plain bottom. */
export function addPcb(parts: Parts, s: PcbSpec): void {
  const at = (x: number, z: number): [number, number] => [x - s.cx, z - s.cz]
  const art = pcbArtMaterial(`displays-${s.key}`, s.wMm, s.hMm, s.style, (p) => s.paint(p, at), {
    pxPerMm: s.pxPerMm ?? Math.min(36, 1400 / s.wMm),
    bumpScale: 0.45,
  })
  const yBot = s.yBotMm * MM
  const yTop = (s.yBotMm + s.tMm) * MM
  parts.add(boardTopGeometry(s.wMm, s.hMm, EDGE_CHAMFER), art, s.cx, yTop, s.cz)
  const edge = boardEdgeGeometries(s.wMm, s.hMm, s.tMm, EDGE_CHAMFER)
  parts.add(edge.fr4, fr4EdgeMaterial(), s.cx, yBot, s.cz)
  parts.add(edge.mask, maskMaterial(s.edge), s.cx, yBot, s.cz)
  const bottom = new THREE.Mesh(flatQuadGeometry(s.wMm * MM, s.hMm * MM), maskMaterial(s.edge))
  bottom.rotation.x = Math.PI
  parts.obj(bottom, s.cx, yBot, s.cz)
}

/** Tinned header post (HASL-coated brass). */
export function tinnedPost(): THREE.MeshPhysicalMaterial {
  return metal(0xd0d3d6, 0.36)
}

/**
 * Single-row male header soldered from the back: one black plastic strip
 * per run of adjacent pins between the breadboard (y = 0) and the PCB
 * bottom, the short ends proud of the PCB top (`proudMm`, default the 3 mm
 * short end minus the board thickness) in concave solder fillets. The long
 * ends are hidden in the breadboard sockets.
 */
export function addHeader(
  parts: Parts,
  xs: number[],
  zMm: number,
  pcbBotMm: number,
  pcbTopMm: number,
  opts: { proudMm?: number; plasticFromMm?: number } = {},
): void {
  const from = opts.plasticFromMm ?? 0
  const h = pcbBotMm - from
  if (h > 0.05) {
    // contiguous runs (WS2812: 3 + 1 pins)
    const sorted = [...xs].sort((a, b) => a - b)
    let start = 0
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] - sorted[i - 1] < PITCH * 1.01) continue
      const x0 = sorted[start]
      const x1 = sorted[i - 1]
      const len = x1 - x0 + PITCH
      parts.add(
        slabGeometry(len * MM - 0.004, h * MM - 0.004, 2.5 * MM, { top: true, bottom: true }),
        headerPlasticMaterial(),
        (x0 + x1) / 2,
        ((from + pcbBotMm) / 2) * MM,
        zMm,
      )
      start = i
    }
  }
  const proud = opts.proudMm ?? SHORT_END - (pcbTopMm - pcbBotMm)
  const tip = headerPostGeometry(0.32 * MM, proud * MM, 0.16 * MM)
  const fillet = solderFilletGeometry(0.8 * MM, 0.36 * MM, 0.5 * MM)
  for (const x of xs) {
    parts.add(tip, tinnedPost(), x, pcbTopMm * MM, zMm)
    parts.add(fillet, solderMaterial(), x, pcbTopMm * MM + 0.002, zMm)
  }
}

/** Header pin x positions (mm) of pins 0 … n−1 in the module frame. */
export function pinXs(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i * PITCH)
}

/** Mounting hole on the art: the drill (dark) in its copper ring under the mask. */
export function paintHole(p: PcbPainter, x: number, z: number, dMm: number): void {
  p.via(x, z, dMm / 2 / 0.45)
}

/** Header pads (square pin 1) + optional silk labels below/above the pads. */
export function paintHeaderPads(
  p: PcbPainter,
  at: (x: number, z: number) => [number, number],
  xs: number[],
  zMm: number,
  labels?: { text: string[]; dz: number; size?: number },
): void {
  xs.forEach((x, i) => {
    const [bx, bz] = at(x, zMm)
    if (i === 0) p.padRect(bx, bz, 1.7, 1.7)
    else p.padCircle(bx, bz, 0.85)
  })
  if (labels) {
    xs.forEach((x, i) => {
      const t = labels.text[i]
      if (!t) return
      const [bx, bz] = at(x, zMm + labels.dz)
      p.silkText(t, bx, bz, labels.size ?? 0.95, { stroke: 0.04, condense: t.length > 3 ? 0.78 : 0.9 })
    })
  }
}

// --------------------------------------------------------------- materials

/**
 * Cover glass (OLED / TFT): near-black, glossy — but with a capped Fresnel
 * (specularIntensity < 1) and a soft clearcoat: a mirror finish blew the
 * Enhanced softbox up into a white blob over the picture.
 */
export function coverGlass(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-cover-glass', () =>
    new THREE.MeshPhysicalMaterial({
      color: 0x050607,
      roughness: 0.38,
      metalness: 0,
      specularIntensity: 0.45,
    }),
  )
}

/** The display glass substrate (cut edges, the bare COG ledge): very dark green-gray, glossy. */
export function glassEdge(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-glass-edge', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x111716, roughness: 0.34, metalness: 0, specularIntensity: 0.45 }),
  )
}

/** Polyimide flex (FPC): amber, semi-gloss. */
export function polyimide(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-polyimide', () =>
    new THREE.MeshPhysicalMaterial({ color: 0xb8701c, roughness: 0.38, metalness: 0, clearcoat: 0.35 }),
  )
}

/** Black SMD package / COG driver. */
export function smdBlack(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-smd-black', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x1a1a1d, roughness: 0.55, metalness: 0 }),
  )
}

/**
 * Tin-plated steel of the LCD bezel: satin, not polished — a large flat
 * metal face at roughness 0.3 mirrors the Enhanced softbox into a white
 * sheet (and the shared brushed map streaks a 7 mm wall into "stacked
 * plates"), so the bezel keeps its own plain satin finish.
 */
export function tinPlate(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-tin-plate', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xb4b8bc, roughness: 0.52, metalness: 1 })
    m.envMapIntensity = 1.15
    return m
  })
}

/** Dark matte black (bezel window walls, black glass print, recesses). */
export function matteBlack(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-matte-black', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.8, metalness: 0 }),
  )
}

/** 0603 chip resistor top / MLCC body. */
export function chipRes(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-chip-res', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x161618, roughness: 0.5, metalness: 0 }),
  )
}
export function mlcc(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('displays-mlcc', () =>
    new THREE.MeshPhysicalMaterial({ color: 0xb79a6c, roughness: 0.55, metalness: 0 }),
  )
}

// ------------------------------------------------------------- geometry

/** Outward band from a w0 × d0 rectangle at y = 0 up to a w1 × d1 rectangle at y = h (chamfers, bends). */
export function bandGeometry(w0Mm: number, d0Mm: number, w1Mm: number, d1Mm: number, hMm: number): THREE.BufferGeometry {
  return cachedGeometry(`displays-band:${w0Mm}:${d0Mm}:${w1Mm}:${d1Mm}:${hMm}`, () => {
    const h = hMm * MM
    const c = (w: number, d: number) => [
      [(-w * MM) / 2, (d * MM) / 2],
      [(w * MM) / 2, (d * MM) / 2],
      [(w * MM) / 2, (-d * MM) / 2],
      [(-w * MM) / 2, (-d * MM) / 2],
    ]
    const b = c(w0Mm, d0Mm)
    const t = c(w1Mm, d1Mm)
    const p: number[] = []
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      // bottom a→b, top c→d: (a, b, c), (a, c, d) face outward
      p.push(b[i][0], 0, b[i][1], b[j][0], 0, b[j][1], t[j][0], h, t[j][1])
      p.push(b[i][0], 0, b[i][1], t[j][0], h, t[j][1], t[i][0], h, t[i][1])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((p.length / 3) * 2).fill(0), 2))
    g.computeVertexNormals()
    return g
  })
}

/** Open-top hollow rectangle band (bezel inner walls, frames): 4 inward faces from y0 to y1. */
export function innerWallsGeometry(wMm: number, dMm: number, hMm: number): THREE.BufferGeometry {
  return cachedGeometry(`displays-innerwalls:${wMm}:${dMm}:${hMm}`, () => {
    const w = (wMm * MM) / 2
    const d = (dMm * MM) / 2
    const h = hMm * MM
    const p: number[] = []
    const c = [
      [-w, d],
      [w, d],
      [w, -d],
      [-w, -d],
    ]
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i]
      const [x1, z1] = c[(i + 1) % 4]
      // inward-facing: reverse winding of an outward band
      p.push(x0, 0, z0, x1, h, z1, x1, 0, z1, x0, 0, z0, x0, h, z0, x1, h, z1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((p.length / 3) * 2).fill(0), 2))
    g.computeVertexNormals()
    return g
  })
}

/** Flat frame (rectangle with a rectangular window) extruded `tMm` thick, bottom at y = 0. */
export function frameGeometry(
  key: string,
  wMm: number,
  dMm: number,
  tMm: number,
  win: { w: number; d: number; dx?: number; dz?: number },
): THREE.BufferGeometry {
  return cachedGeometry(`displays-frame:${key}`, () => {
    const w = (wMm * MM) / 2
    const d = (dMm * MM) / 2
    const s = new THREE.Shape()
    s.moveTo(-w, -d)
    s.lineTo(w, -d)
    s.lineTo(w, d)
    s.lineTo(-w, d)
    s.closePath()
    const ww = (win.w * MM) / 2
    const wd = (win.d * MM) / 2
    const ox = (win.dx ?? 0) * MM
    const oz = (win.dz ?? 0) * MM
    const hole = new THREE.Path()
    hole.moveTo(ox - ww, oz - wd)
    hole.lineTo(ox - ww, oz + wd)
    hole.lineTo(ox + ww, oz + wd)
    hole.lineTo(ox + ww, oz - wd)
    hole.closePath()
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth: tMm * MM, bevelEnabled: false, curveSegments: 1 })
    // shape plane XY → XZ: (x, y, e) → (x, −e, y), so shape y = module z and
    // the e = 0 cap (normal −e) becomes the top face; then lift to y ∈ [0, t]
    g.rotateX(Math.PI / 2)
    g.translate(0, tMm * MM, 0)
    return g
  })
}

/** Half-pipe bend of a flex cable around a board edge (axis along x, opening toward −z). */
export function flexBendGeometry(widthMm: number, radiusMm: number): THREE.BufferGeometry {
  return cachedGeometry(`displays-flexbend:${widthMm}:${radiusMm}`, () => {
    // θ ∈ [−π/2, π/2]: the half with z ≥ 0; rotateZ maps the axis (y) onto x
    const g = new THREE.CylinderGeometry(radiusMm * MM, radiusMm * MM, widthMm * MM, 8, 1, true, -Math.PI / 2, Math.PI)
    g.rotateZ(Math.PI / 2)
    return g
  })
}

// ----------------------------------------------------------- live screens

/** A per-instance DataTexture (RGBA8, sRGB) with NearestFilter magnification. */
export function screenTexture(w: number, h: number, mipmaps = true): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.generateMipmaps = mipmaps
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/**
 * A screen plane (XZ, facing +y; v toward −z = the picture's top) of
 * wMm × dMm with an emissive per-instance texture. The base colour is the
 * unlit glass; `reflect` lets the albedo carry the texture too (a
 * transflective LCD is readable without its backlight).
 */
export function screenPlane(
  wMm: number,
  dMm: number,
  tex: THREE.DataTexture | null,
  opts: { base?: number; reflect?: number; roughness?: number; clearcoat?: number } = {},
): { mesh: THREE.Mesh; material: THREE.MeshPhysicalMaterial } {
  const material = new THREE.MeshPhysicalMaterial({
    color: opts.base ?? 0x000000,
    roughness: opts.roughness ?? 0.12,
    metalness: 0,
    clearcoat: opts.clearcoat ?? 0.8,
    clearcoatRoughness: 0.06,
    // a screen's own light must win over the room it mirrors (anti-glare
    // polarizer: a few % reflectance) — at full specular the Enhanced
    // softbox laid a grey veil over every picture
    specularIntensity: 0.2,
    emissive: 0xffffff,
    emissiveIntensity: 0,
  })
  if (tex) {
    material.emissiveMap = tex
    if (opts.reflect) {
      material.map = tex
      material.color.setScalar(opts.reflect)
    }
  }
  const mesh = new THREE.Mesh(flatQuadGeometry(wMm * MM, dMm * MM), material)
  return { mesh, material }
}

/** Unlit screen material for the ghost preview / headless builds (shared). */
export function ghostScreen(key: string, color: number): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`displays-ghost-screen:${key}`, () =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.06 }),
  )
}

export type { BuildResult }
