/**
 * Printed-circuit-board building blocks for module / dev-board visuals (the
 * Blue Pill first, later breakouts): a soldermask + copper + silkscreen
 * "art" painter baked into ONE shared texture set per board design, and the
 * low-triangle geometry every board needs — the routed board edge, header
 * posts + solder fillets, an LQFP package with gull-wing leads, a micro-USB
 * receptacle (shell split into outside / socket walls), 0603 chip parts.
 *
 * Realism notes (judged against macro photos of real boards):
 *  - The soldermask is NOT a flat paint: copper traces raise it into faint
 *    ridges that catch the key light and read a shade lighter; HASL pads are
 *    bare tin (semi-metallic, lumpy); silkscreen ink is matte, slightly
 *    proud, painted as a thin stroke font.
 *    All four live in two canvases: an sRGB color map and a linear
 *    "ORM-style" map (R = relief height → bumpMap, G = roughness, B =
 *    metalness — three.js samples roughness from G and metalness from B), so
 *    a whole board top costs ONE quad and ONE material.
 *  - The 1.6 mm routed edge shows the FR4 core between hairline mask lips,
 *    with the mask rolled over the top arris (boardEdgeGeometries) — one
 *    beige face read as a thick closed slab.
 *  - Through-hole header joints: a concave tin fillet climbing the square
 *    pin, the 0.64 mm post proud of it with its stamped chamfer and flat tip.
 *  - Every package sits a hair above the board top plane (never coplanar).
 *
 * Units: plan units (1 = 2.54 mm). Layout code works in millimetres and
 * converts with `MM`. Geometries are cached (shared, page lifetime) — boards
 * merge them per material once and reuse the merged result for every
 * instance (see boards.ts).
 */

import * as THREE from 'three'
import { cachedGeometry, cachedMaterial, markShared, noiseNormalTexture } from './shared'

/** millimetres → plan units (1 unit = 0.1" = 2.54 mm) */
export const MM = 1 / 2.54

// ---------------------------------------------------------------------------
// Board art: soldermask / copper / pads / silkscreen painter
// ---------------------------------------------------------------------------

/** Colors of one board's art (sRGB hex strings). */
export interface PcbArtStyle {
  /** bare soldermask over laminate */
  mask: string
  /** soldermask over a copper trace / via ring (a shade lighter) */
  maskCopper: string
  /** HASL tinned pads */
  pad: string
  /** silkscreen ink */
  silk: string
  /** via drill / unfilled holes */
  drill: string
}

/**
 * ORM encodings: R = relief height (bump), G = roughness, B = metalness.
 * Satin LPI mask 0.55 (a copper trace lifts it into a ridge that is a hair
 * smoother — the mask flows thinner over the copper), matte ink 0.78, HASL
 * tin 0.65 rough / 0.51 metal (reflowed HASL is lumpy and oxidized, not a
 * mirror — the LQFP's fine-pitch pad rows, seen past the lead toes, bloomed
 * into rows of white bars under the Enhanced softbox at 0.55 / 0.78).
 */
const ORM = {
  mask: 'rgb(110,140,0)',
  maskCopper: 'rgb(150,128,0)',
  pad: 'rgb(122,166,130)',
  silk: 'rgb(170,199,0)',
  drill: 'rgb(55,150,0)',
} as const

type Pt = readonly [number, number]

/**
 * Paints one board's art in MILLIMETRES, board-centered: +x along the board,
 * +z toward the viewer (= canvas down; the top quad maps canvas-up onto −z).
 * Every primitive is painted twice — color + ORM — so relief, gloss and metal
 * always register exactly with the visible art.
 */
export class PcbPainter {
  constructor(
    private readonly c: CanvasRenderingContext2D,
    private readonly o: CanvasRenderingContext2D,
    readonly wMm: number,
    readonly hMm: number,
    /** canvas pixels per millimetre */
    readonly s: number,
    private readonly style: PcbArtStyle,
  ) {}

  /** canvas transform for mm drawing (optionally rotated about a point) */
  private frame(ctx: CanvasRenderingContext2D, x = 0, z = 0, rot = 0): void {
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const s = this.s
    ctx.setTransform(
      s * cos,
      s * sin,
      -s * sin,
      s * cos,
      (x + this.wMm / 2) * s,
      (z + this.hMm / 2) * s,
    )
  }

  private both(draw: (ctx: CanvasRenderingContext2D, fill: string) => void, color: string, orm: string): void {
    draw(this.c, color)
    draw(this.o, orm)
  }

  /** Copper traces under the mask (round joints), polylines in mm. */
  traces(paths: readonly (readonly Pt[])[], widthMm = 0.25): void {
    this.both(
      (ctx, fill) => {
        this.frame(ctx)
        ctx.strokeStyle = fill
        ctx.lineWidth = widthMm
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        for (const p of paths) {
          if (p.length < 2) continue
          ctx.beginPath()
          ctx.moveTo(p[0][0], p[0][1])
          for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1])
          ctx.stroke()
        }
      },
      this.style.maskCopper,
      ORM.maskCopper,
    )
  }

  /** Copper area (pour / wide power land) under the mask. */
  copperRect(x: number, z: number, w: number, h: number): void {
    this.both(
      (ctx, fill) => {
        this.frame(ctx)
        ctx.fillStyle = fill
        ctx.fillRect(x - w / 2, z - h / 2, w, h)
      },
      this.style.maskCopper,
      ORM.maskCopper,
    )
  }

  /** Tented via: copper ring under the mask + a dark plugged drill dot. */
  via(x: number, z: number, r = 0.3): void {
    this.disc(x, z, r, this.style.maskCopper, ORM.maskCopper)
    this.disc(x, z, r * 0.45, this.style.drill, ORM.drill)
  }

  /** Round HASL pad. */
  padCircle(x: number, z: number, r: number): void {
    this.disc(x, z, r, this.style.pad, ORM.pad)
  }

  /** Rectangular HASL pad, rotated `rot` rad (clockwise on screen) about its center. */
  padRect(x: number, z: number, w: number, h: number, rot = 0): void {
    this.both(
      (ctx, fill) => {
        this.frame(ctx, x, z, rot)
        ctx.fillStyle = fill
        ctx.fillRect(-w / 2, -h / 2, w, h)
      },
      this.style.pad,
      ORM.pad,
    )
  }

  /**
   * Silkscreen text; `rot` rad clockwise on screen (−π/2 reads bottom→top).
   * `sizeMm` is the em size. Board silk is a plotted stroke font: thin,
   * even strokes and narrow glyphs — `stroke` (mm) thickens a regular-weight
   * face uniformly (round joins, like the plotter pen) and `condense` narrows
   * it, instead of a heavy bold face.
   */
  silkText(
    text: string,
    x: number,
    z: number,
    sizeMm: number,
    opts: { rot?: number; align?: CanvasTextAlign; weight?: number; stroke?: number; condense?: number } = {},
  ): void {
    const rot = opts.rot ?? 0
    const s = this.s
    const px = Math.max(6, Math.round(sizeMm * s))
    const k = opts.condense ?? 1
    this.both(
      (ctx, fill) => {
        // text renders at true pixel size (never as a scaled 1px font — that
        // would rasterize hinted at 1px and smear when scaled)
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        ctx.setTransform(k * cos, k * sin, -sin, cos, (x + this.wMm / 2) * s, (z + this.hMm / 2) * s)
        ctx.fillStyle = fill
        ctx.font = `${opts.weight ?? 700} ${px}px "Arial Narrow", Arial, "Helvetica Neue", sans-serif`
        ctx.textAlign = opts.align ?? 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, 0, px * 0.04)
        if (opts.stroke) {
          ctx.strokeStyle = fill
          ctx.lineWidth = opts.stroke * s
          ctx.lineJoin = 'round'
          ctx.strokeText(text, 0, px * 0.04)
        }
      },
      this.style.silk,
      ORM.silk,
    )
  }

  /** Silkscreen polyline (0.15 mm ink by default). */
  silkLine(pts: readonly Pt[], widthMm = 0.15, closed = false): void {
    if (pts.length < 2) return
    this.both(
      (ctx, fill) => {
        this.frame(ctx)
        ctx.strokeStyle = fill
        ctx.lineWidth = widthMm
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
        if (closed) ctx.closePath()
        ctx.stroke()
      },
      this.style.silk,
      ORM.silk,
    )
  }

  /** Silkscreen rectangle outline centered at (x, z). */
  silkRect(x: number, z: number, w: number, h: number, widthMm = 0.15, rot = 0): void {
    this.both(
      (ctx, fill) => {
        this.frame(ctx, x, z, rot)
        ctx.strokeStyle = fill
        ctx.lineWidth = widthMm
        ctx.strokeRect(-w / 2, -h / 2, w, h)
      },
      this.style.silk,
      ORM.silk,
    )
  }

  /** Silkscreen rounded-end (stadium) outline — crystal footprints. */
  silkStadium(x: number, z: number, w: number, h: number, widthMm = 0.15): void {
    const r = h / 2
    this.both(
      (ctx, fill) => {
        this.frame(ctx, x, z)
        ctx.strokeStyle = fill
        ctx.lineWidth = widthMm
        ctx.beginPath()
        ctx.moveTo(-w / 2 + r, -r)
        ctx.lineTo(w / 2 - r, -r)
        ctx.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2)
        ctx.lineTo(-w / 2 + r, r)
        ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2)
        ctx.closePath()
        ctx.stroke()
      },
      this.style.silk,
      ORM.silk,
    )
  }

  /** Filled silkscreen dot (pin-1 / polarity marks). */
  silkDot(x: number, z: number, r: number): void {
    this.disc(x, z, r, this.style.silk, ORM.silk)
  }

  private disc(x: number, z: number, r: number, color: string, orm: string): void {
    this.both(
      (ctx, fill) => {
        this.frame(ctx)
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(x, z, r, 0, Math.PI * 2)
        ctx.fill()
      },
      color,
      orm,
    )
  }
}

/**
 * The board-top material for one board DESIGN: soldermask + copper + pads +
 * silkscreen painted once into a shared color/ORM canvas pair (cached by
 * `key`, page lifetime — every instance of the design shares it). Headless
 * (no DOM) it degrades to plain soldermask so builds never throw in node.
 */
export function pcbArtMaterial(
  key: string,
  wMm: number,
  hMm: number,
  style: PcbArtStyle,
  paint: (p: PcbPainter) => void,
  opts: { pxPerMm?: number; bumpScale?: number } = {},
): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`pcb-art:${key}`, () => {
    const mask = new THREE.Color(style.mask)
    // LPI soldermask is a satin epoxy: specularIntensity < 1 caps its
    // grazing-angle Fresnel (F90). At 1.0 a board seen edge-on mirrors the
    // Enhanced HDRI softbox past the bloom threshold and hazes white — and
    // the milky sheen is what washed the deep blue out to a pale azure.
    const m = new THREE.MeshPhysicalMaterial({
      color: mask,
      roughness: 0.55,
      metalness: 0,
      specularIntensity: 0.22,
    })
    if (typeof document === 'undefined') return m
    const s = opts.pxPerMm ?? 2048 / wMm
    const W = Math.round(wMm * s)
    const H = Math.round(hMm * s)
    const colorCanvas = document.createElement('canvas')
    const ormCanvas = document.createElement('canvas')
    colorCanvas.width = ormCanvas.width = W
    colorCanvas.height = ormCanvas.height = H
    const c = colorCanvas.getContext('2d')
    const o = ormCanvas.getContext('2d')
    if (!c || !o) return m
    c.fillStyle = style.mask
    c.fillRect(0, 0, W, H)
    o.fillStyle = ORM.mask
    o.fillRect(0, 0, W, H)
    paint(new PcbPainter(c, o, wMm, hMm, s, style))

    const map = new THREE.CanvasTexture(colorCanvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8 // the board top is viewed at grazing angles
    markShared(map)
    const orm = new THREE.CanvasTexture(ormCanvas)
    orm.anisotropy = 8
    markShared(orm)

    m.color.set(0xffffff)
    m.map = map
    // multipliers of 1: the ORM channels carry the absolute values
    m.roughness = 1
    m.metalness = 1
    m.roughnessMap = orm
    m.metalnessMap = orm
    m.bumpMap = orm
    m.bumpScale = opts.bumpScale ?? 0.5
    return m
  })
}

/**
 * The art quad of a `wMm` × `hMm` board, inset `insetMm` on every side (the
 * routed edge's mask roll-over chamfer takes that rim — see
 * boardEdgeGeometries) with its UVs cropped to the same sub-rectangle, so
 * the painted art stays registered to the board's millimetre frame.
 */
export function boardTopGeometry(wMm: number, hMm: number, insetMm: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-top:${wMm}x${hMm}:${insetMm}`, () => {
    const g = new THREE.PlaneGeometry((wMm - 2 * insetMm) * MM, (hMm - 2 * insetMm) * MM)
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    const iu = insetMm / wMm
    const iv = insetMm / hMm
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, iu + uv.getX(i) * (1 - 2 * iu), iv + uv.getY(i) * (1 - 2 * iv))
    }
    g.rotateX(-Math.PI / 2)
    return g
  })
}

/**
 * Push one open rectangular band (4 outward-facing quads) from the w0 × d0
 * rectangle at y0 up to the w1 × d1 rectangle at y1 (both centered).
 */
function rectBand(out: number[], w0: number, d0: number, y0: number, w1: number, d1: number, y1: number): void {
  // corners walk front-left → front-right → back-right → back-left: each
  // side quad (bottom a→b, top c→d) is then CCW seen from outside
  const c0 = [
    [-w0 / 2, d0 / 2],
    [w0 / 2, d0 / 2],
    [w0 / 2, -d0 / 2],
    [-w0 / 2, -d0 / 2],
  ]
  const c1 = [
    [-w1 / 2, d1 / 2],
    [w1 / 2, d1 / 2],
    [w1 / 2, -d1 / 2],
    [-w1 / 2, -d1 / 2],
  ]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(out, [c0[i][0], y0, c0[i][1]], [c0[j][0], y0, c0[j][1]], [c1[j][0], y1, c1[j][1]], [c1[i][0], y1, c1[i][1]])
  }
}

/**
 * The routed edge of a `wMm` × `dMm` × `tMm` board, origin at the board
 * BOTTOM center (plan units out). A real 1.6 mm edge is NOT one beige face:
 * the glass-epoxy core shows between two hairline soldermask lips, and the
 * mask rolls over the top arris in a tiny chamfer that catches the key light
 * as a thin bright line. Returned as the FR4 core band and the mask parts
 * (top chamfer + both lips) — 8 triangles per band, the art quad
 * (boardTopGeometry, same `chamferMm` inset) and the bottom quad close it.
 */
export function boardEdgeGeometries(
  wMm: number,
  dMm: number,
  tMm: number,
  chamferMm = 0.15,
  lipMm = 0.07,
): { fr4: THREE.BufferGeometry; mask: THREE.BufferGeometry } {
  const key = `${wMm}x${dMm}x${tMm}:${chamferMm}:${lipMm}`
  const w = wMm * MM
  const d = dMm * MM
  const ch = chamferMm * MM
  const yTop = tMm * MM
  const yLipTop = yTop - ch - lipMm * MM
  const yLipBot = lipMm * MM
  const fr4 = cachedGeometry(`pcb-edge-fr4:${key}`, () => {
    const p: number[] = []
    rectBand(p, w, d, yLipBot, w, d, yLipTop)
    return trianglesGeometry(p)
  })
  const mask = cachedGeometry(`pcb-edge-mask:${key}`, () => {
    const p: number[] = []
    rectBand(p, w, d, 0, w, d, yLipBot)
    rectBand(p, w, d, yLipTop, w, d, yTop - ch)
    rectBand(p, w, d, yTop - ch, w - 2 * ch, d - 2 * ch, yTop)
    return trianglesGeometry(p)
  })
  return { fr4, mask }
}

// ---------------------------------------------------------------------------
// Shared board materials
// ---------------------------------------------------------------------------

/**
 * Glass-epoxy laminate as seen on a routed board edge (FR4 core): a muted
 * olive-tan, matte from the router's cut glass weave. Deliberately darker
 * than the breadboard's white ABS — a light beige edge merged with the board
 * below and read as a thick closed slab.
 */
export function fr4EdgeMaterial(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('pcb-fr4-edge', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x9a9470, roughness: 0.82, metalness: 0 }),
  )
}

/** Plain soldermask (board bottom / untextured faces). */
export function maskMaterial(color: number): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`pcb-mask:${color}`, () =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0 }),
  )
}

/**
 * Bright reflowed solder (the joint fillets): glossy and a touch whiter than
 * the header posts — but not mirror-glossy: at 0.42 the cones' upper bands
 * bloomed under the Enhanced softbox. (No envMapIntensity lift: with the
 * environment coming from scene.environment three r170 ignores it.)
 */
export function solderMaterial(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('pcb-solder', () =>
    new THREE.MeshPhysicalMaterial({ color: 0xd2d5d8, metalness: 1.0, roughness: 0.46 }),
  )
}

/** Glass-filled nylon (PA6T) header / connector housings — black, satin. */
export function headerPlasticMaterial(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('pcb-header-plastic', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x151517, roughness: 0.5, metalness: 0 })
    const n = noiseNormalTexture()
    if (n) {
      m.normalMap = n
      m.normalScale.set(0.15, 0.15)
    }
    return m
  })
}

/**
 * Transfer-molded IC epoxy for fine-pitch QFPs: dark charcoal, matte with a
 * faint sheen (a laser-marked LQFP top is clearly lighter and duller than a
 * glossy DIP body).
 */
export function qfpMoldMaterial(): THREE.MeshPhysicalMaterial {
  return cachedMaterial('pcb-qfp-mold', () => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x222226,
      roughness: 0.6,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.5,
    })
    const n = noiseNormalTexture()
    if (n) {
      m.normalMap = n
      m.normalScale.set(0.14, 0.14)
    }
    return m
  })
}

// ---------------------------------------------------------------------------
// Low-level geometry helpers
// ---------------------------------------------------------------------------

/**
 * Non-indexed flat-shaded geometry from a raw triangle list (CCW = front).
 * Adds a zero UV channel so it merges with the stock three geometries
 * (mergeGeometries refuses mismatched attribute sets).
 */
export function trianglesGeometry(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2))
  g.computeVertexNormals() // non-indexed → per-face (flat) normals
  return g
}

/**
 * Split a geometry into its up-facing flats (face normal y ≥ `minY`) and
 * everything else, keeping every source attribute (smooth normals, UVs) —
 * so one part can carry two finishes (satin flats vs polished walls). Both
 * halves are cached under `key` (shared, page lifetime).
 */
export function splitUpFacing(
  key: string,
  src: THREE.BufferGeometry,
  minY = 0.95,
): { up: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const build = (wantUp: boolean): THREE.BufferGeometry => {
    const g = src.index ? src.toNonIndexed() : src
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const names = Object.keys(g.attributes)
    const out: Record<string, number[]> = {}
    for (const n of names) out[n] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i)
      b.fromBufferAttribute(pos, i + 1)
      c.fromBufferAttribute(pos, i + 2)
      THREE.Triangle.getNormal(a, b, c, n)
      if (n.y >= minY !== wantUp) continue
      for (const name of names) {
        const attr = g.getAttribute(name) as THREE.BufferAttribute
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < attr.itemSize; j++) out[name].push(attr.getComponent(i + k, j))
        }
      }
    }
    if (g !== src) g.dispose()
    const res = new THREE.BufferGeometry()
    for (const name of names) {
      res.setAttribute(name, new THREE.Float32BufferAttribute(out[name], src.getAttribute(name).itemSize))
    }
    return res
  }
  return {
    up: cachedGeometry(`split-up:${key}:${minY}`, () => build(true)),
    rest: cachedGeometry(`split-rest:${key}:${minY}`, () => build(false)),
  }
}

/** Push quad a-b-c-d (CCW seen from the front) as two triangles. */
function quad(out: number[], a: number[], b: number[], c: number[], d: number[]): void {
  out.push(...a, ...b, ...c, ...a, ...c, ...d)
}

/**
 * Axis-aligned box with optionally omitted top/bottom faces (hidden faces
 * cost triangles: a header strip's bottom sits on the breadboard, its top
 * under the PCB). Origin at the box center.
 */
export function slabGeometry(
  w: number,
  h: number,
  d: number,
  omit: { top?: boolean; bottom?: boolean } = {},
): THREE.BufferGeometry {
  const key = `pcb-slab:${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}:${omit.top ? 1 : 0}${omit.bottom ? 1 : 0}`
  return cachedGeometry(key, () => {
    const g = new THREE.BoxGeometry(w, h, d)
    if (!omit.top && !omit.bottom) return g
    // BoxGeometry face groups: +x, −x, +y, −y, +z, −z
    const idx = g.index!.array
    const keep: number[] = []
    g.groups.forEach((gr, i) => {
      if ((i === 2 && omit.top) || (i === 3 && omit.bottom)) return
      for (let k = gr.start; k < gr.start + gr.count; k++) keep.push(idx[k])
    })
    g.setIndex(keep)
    g.clearGroups()
    return g
  })
}

/** Flat quad lying in the XZ plane facing +y (labels, board tops). */
export function flatQuadGeometry(w: number, d: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-flatquad:${w.toFixed(4)}x${d.toFixed(4)}`, () => {
    const g = new THREE.PlaneGeometry(w, d)
    g.rotateX(-Math.PI / 2)
    return g
  })
}

/**
 * Square header pin from the given base up `h`, finished with the stamped
 * pyramid point (`tip` tall). Half-width `a`. 12 triangles; the base face is
 * always buried (in solder / plastic) and omitted.
 */
export function pinTipGeometry(a: number, h: number, tip: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-pintip:${a.toFixed(4)}:${h.toFixed(4)}:${tip.toFixed(4)}`, () => {
    const p: number[] = []
    const c = [
      [-a, -a],
      [a, -a],
      [a, a],
      [-a, a],
    ]
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i]
      const [x1, z1] = c[(i + 1) % 4]
      // side quads, outward-facing (corners walk clockwise seen from +y)
      quad(p, [x0, 0, z0], [x0, h, z0], [x1, h, z1], [x1, 0, z1])
      // pyramid facet
      p.push(x0, h, z0, 0, h + tip, 0, x1, h, z1)
    }
    return trianglesGeometry(p)
  })
}

/**
 * Square header post (half-width `a`) from its buried base at y = 0 up to a
 * FLAT tip at `h`, finished with the stamped 45° chamfer (`chamfer` mm in
 * plan units) — real 2.54 mm header pins are chamfered, not pointed (a full
 * pyramid read as a dark spike under the HDRI). 18 triangles; the base face
 * is always buried (solder / plastic) and omitted.
 */
export function headerPostGeometry(a: number, h: number, chamfer: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-post:${a.toFixed(4)}:${h.toFixed(4)}:${chamfer.toFixed(4)}`, () => {
    const p: number[] = []
    const b = a - chamfer
    const yc = h - chamfer
    const c = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ]
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i]
      const [x1, z1] = c[(i + 1) % 4]
      // side quad then its chamfer facet (same outward winding as rectBand)
      quad(p, [x0 * a, 0, z0 * a], [x1 * a, 0, z1 * a], [x1 * a, yc, z1 * a], [x0 * a, yc, z0 * a])
      quad(p, [x0 * a, yc, z0 * a], [x1 * a, yc, z1 * a], [x1 * b, h, z1 * b], [x0 * b, h, z0 * b])
    }
    // flat top (CCW seen from +y)
    quad(p, [-b, h, b], [b, h, b], [b, h, -b], [-b, h, -b])
    return trianglesGeometry(p)
  })
}

/**
 * Concave tin fillet around a through-hole pin: an open cone from the pad
 * (`rBase`) up the pin (`rTop`, `h` tall). 8 sides → 16 triangles. The
 * silhouette is a straight cone, but its NORMALS bend from nearly vertical
 * at the pad (the meniscus flattens out onto it) to nearly horizontal where
 * the solder wets the pin — the shading of a concave fillet at the triangle
 * cost of a cone (two lathe bands would double it, ×40 joints per board).
 */
export function solderFilletGeometry(rBase: number, rTop: number, h: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-fillet:${rBase.toFixed(4)}:${rTop.toFixed(4)}:${h.toFixed(4)}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBase, h, 8, 1, true)
    g.rotateY(Math.PI / 8) // flats face the pin flats
    g.translate(0, h / 2, 0)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z) || 1
      const t = THREE.MathUtils.clamp(pos.getY(i) / h, 0, 1)
      const tilt = THREE.MathUtils.degToRad(22 + 60 * t) // from vertical
      nrm.setXYZ(i, (Math.sin(tilt) * x) / r, Math.cos(tilt), (Math.sin(tilt) * z) / r)
    }
    return g
  })
}

/**
 * Four-sided frustum (square, axis-aligned) — the drafted body walls of
 * molded packages. Flat-shaded; `size` = bottom edge, `top` = top edge.
 */
export function squareFrustumGeometry(size: number, top: number, h: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-sqfrustum:${size.toFixed(4)}:${top.toFixed(4)}:${h.toFixed(4)}`, () => {
    const g = new THREE.CylinderGeometry(top / Math.SQRT2, size / Math.SQRT2, h, 4, 1, false)
    g.rotateY(Math.PI / 4)
    const flat = g.toNonIndexed()
    flat.computeVertexNormals()
    return flat
  })
}

/** Rounded-end (stadium) outline in the XY plane, centered. */
export function stadiumShape(w: number, h: number): THREE.Shape {
  const r = h / 2
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -r)
  s.lineTo(w / 2 - r, -r)
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false)
  s.lineTo(-w / 2 + r, r)
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false)
  return s
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

/**
 * LQFP gull-wing lead set (JEDEC MS-026: 0.22 mm wide, 0.5 mm pitch, 1.0 mm
 * from body edge to foot tip), in the package frame: body centered at the
 * origin, `body` mm square, `pins` per side, bottom of the feet at y = 0.
 * Each lead is a bent RIBBON (shoulder → knee → foot: 3 lit quads, 6 tris) —
 * at 0.22 mm a full extruded leg would cost 4× the triangles for edges no
 * camera can resolve.
 */
export function qfpLeadsGeometry(bodyMm: number, perSide: number, pitchMm: number): THREE.BufferGeometry {
  return cachedGeometry(`pcb-qfp-leads:${bodyMm}:${perSide}:${pitchMm}`, () => {
    const p: number[] = []
    const hw = 0.11 * MM // half lead width
    const e = (bodyMm / 2) * MM // body edge
    const yS = 0.62 * MM // shoulder (exits the mold at mid-height)
    const yF = 0.13 * MM // foot top (lead thickness on the pad)
    const xs = e - 0.05 * MM // starts inside the body (no seam)
    const xk = e + 0.22 * MM // knee start
    const xf = e + 0.48 * MM // foot start
    const xt = e + 1.0 * MM // toe
    // one lead along +x, centered on z = 0
    const lead: number[] = []
    quad(lead, [xs, yS, hw], [xk, yS, hw], [xk, yS, -hw], [xs, yS, -hw])
    quad(lead, [xk, yS, hw], [xf, yF, hw], [xf, yF, -hw], [xk, yS, -hw])
    quad(lead, [xf, yF, hw], [xt, yF, hw], [xt, yF, -hw], [xf, yF, -hw])
    // toe end face (the cut lead end catches a glint)
    quad(lead, [xt, yF, hw], [xt, 0, hw], [xt, 0, -hw], [xt, yF, -hw])
    const v = new THREE.Vector3()
    const m = new THREE.Matrix4()
    for (let side = 0; side < 4; side++) {
      m.makeRotationY((side * Math.PI) / 2)
      for (let k = 0; k < perSide; k++) {
        const off = (k - (perSide - 1) / 2) * pitchMm * MM
        for (let i = 0; i < lead.length; i += 3) {
          v.set(lead[i], lead[i + 1], lead[i + 2] + off).applyMatrix4(m)
          p.push(v.x, v.y, v.z)
        }
      }
    }
    return trianglesGeometry(p)
  })
}

/**
 * Drafted LQFP body: two square frustums meeting at the mold parting line
 * (the classic double draft), bottom at y = standoff, `heightMm` tall.
 */
export function qfpBodyParts(bodyMm: number, heightMm: number, standoffMm: number): THREE.BufferGeometry[] {
  const b = bodyMm * MM
  const h = heightMm * MM
  const lower = squareFrustumGeometry(b - 0.16 * MM, b, h * 0.42).clone()
  lower.translate(0, standoffMm * MM + (h * 0.42) / 2, 0)
  const upper = squareFrustumGeometry(b, b - 0.3 * MM, h * 0.58).clone()
  upper.translate(0, standoffMm * MM + h * 0.42 + (h * 0.58) / 2, 0)
  return [lower, upper]
}

/**
 * Micro-USB B receptacle shell (SMD, mid-mount style) in its own frame: the
 * mating face points −x, bottom on y = 0. The drawn steel shell is an
 * extrusion of the real trapezoid profile WITH the plug opening punched
 * through, so the mouth is a true hole into a dark cavity.
 */
export function microUsbShellGeometry(depthMm = 5.6): THREE.BufferGeometry {
  return cachedGeometry(`pcb-microusb-shell:${depthMm}`, () => {
    const g = microUsbExtrusion(depthMm)
    g.rotateY(Math.PI / 2)
    g.translate((-depthMm * MM) / 2, 0, 0)
    return g
  })
}

/** micro-B shell outline (USB 2.0 Micro-USB Cables and Connectors spec 1.01: 7.5 × 2.45 mm trapezoid) */
const USB_W = 7.5 * MM
const USB_H = 2.45 * MM
/** lower chamfers of the trapezoid */
const USB_CH = 0.85 * MM
/** drawn sheet thickness */
const USB_T = 0.22 * MM

/** The shell profile WITH the plug opening, extruded `depthMm` along +z (shape frame). */
function microUsbExtrusion(depthMm: number): THREE.BufferGeometry {
  const W = USB_W
  const H = USB_H
  const ch = USB_CH
  const t = USB_T
  // the drawn sheet's top corners are bent, not cut: a 0.4 mm radius in
  // three facets catches the light as the bright edge lines that make a
  // stamped shell read as metal rather than a grey block
  const r = 0.4 * MM
  const outer = new THREE.Shape()
  outer.moveTo(-W / 2 + ch, 0)
  outer.lineTo(W / 2 - ch, 0)
  outer.lineTo(W / 2, ch)
  outer.lineTo(W / 2, H - r)
  outer.quadraticCurveTo(W / 2, H, W / 2 - r, H)
  outer.lineTo(-W / 2 + r, H)
  outer.quadraticCurveTo(-W / 2, H, -W / 2, H - r)
  outer.lineTo(-W / 2, ch)
  outer.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-W / 2 + ch + t * 0.6, t)
  hole.lineTo(-W / 2 + t, ch + t * 0.4)
  hole.lineTo(-W / 2 + t, H - t)
  hole.lineTo(W / 2 - t, H - t)
  hole.lineTo(W / 2 - t, ch + t * 0.4)
  hole.lineTo(W / 2 - ch - t * 0.6, t)
  hole.closePath()
  outer.holes.push(hole)
  return new THREE.ExtrudeGeometry(outer, { depth: depthMm * MM, bevelEnabled: false, curveSegments: 3 })
}

/**
 * Micro-USB B receptacle shell split for shading, in its own frame (mating
 * face −x, bottom on y = 0, `depthMm` deep): `shell` = the outside of the
 * drawn steel plus the thin rim around the mouth, `cavity` = the walls
 * INSIDE the plug opening. Inside a real receptacle those walls sit in deep
 * occlusion — lit like the outside (no AO in Performance) the mouth read as
 * a bright frame instead of a dark socket, so they take a near-black finish.
 */
export function microUsbShellParts(depthMm = 5.0): { shell: THREE.BufferGeometry; cavity: THREE.BufferGeometry } {
  const shell = cachedGeometry(`pcb-microusb-outer:${depthMm}`, () => splitMicroUsb(depthMm, false))
  const cavity = cachedGeometry(`pcb-microusb-cavity:${depthMm}`, () => splitMicroUsb(depthMm, true))
  return { shell, cavity }
}

function splitMicroUsb(depthMm: number, inner: boolean): THREE.BufferGeometry {
  const src = microUsbExtrusion(depthMm)
  const g = src.index ? src.toNonIndexed() : src
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const out: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const cy = USB_H * 0.55 // opening center (shape frame)
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, i + 1)
    c.fromBufferAttribute(pos, i + 2)
    THREE.Triangle.getNormal(a, b, c, n)
    // ExtrudeGeometry orients every wall outward from the SOLID: an outer
    // wall faces away from the opening's center, a hole wall faces into it
    // (the two end caps face ±z and belong to the shell)
    const mx = (a.x + b.x + c.x) / 3
    const my = (a.y + b.y + c.y) / 3
    const isInner = Math.abs(n.z) < 0.5 && -mx * n.x + (cy - my) * n.y > 0
    if (isInner !== inner) continue
    for (const v of [a, b, c]) out.push(v.x, v.y, v.z)
  }
  src.dispose()
  const geo = trianglesGeometry(out)
  geo.rotateY(Math.PI / 2)
  geo.translate((-depthMm * MM) / 2, 0, 0)
  return geo
}

/**
 * 0603 (1608 metric) chip part: body + two tinned terminations, centered,
 * long axis along x, bottom on y = 0. Returns detached meshes for the
 * caller's static merge.
 */
export function chip0603(
  bodyMat: THREE.Material,
  endMat: THREE.Material,
  heightMm = 0.45,
): THREE.Object3D[] {
  const L = 1.6 * MM
  const W = 0.8 * MM
  const H = heightMm * MM
  const e = 0.3 * MM
  const body = new THREE.Mesh(slabGeometry(L - 2 * e + 0.02 * MM, H * 0.98, W * 0.98, { bottom: true }), bodyMat)
  body.position.y = (H * 0.98) / 2
  const out: THREE.Object3D[] = [body]
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(slabGeometry(e, H, W, { bottom: true }), endMat)
    cap.position.set(sx * (L / 2 - e / 2), H / 2, 0)
    out.push(cap)
  }
  return out
}
