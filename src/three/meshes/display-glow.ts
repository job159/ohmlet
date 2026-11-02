/**
 * LED displays in the LEDs' brightness language (owner: glow; led-look.ts):
 * the 7-segment, the TM1637 4-digit module and the MAX7219 8×8 matrix.
 *
 *  - A lit segment / dot is the LED lens: its own saturated hue, brighter
 *    with the drive (emission ≤ 1.1 linear — past that ACES bleaches red
 *    to salmon), the diffuser's albedo pulled down so it reads as light.
 *  - The glow follows the lit SHAPES: a flat plane over the display face
 *    whose texture is the lit segments / dots blurred (a canvas, repainted
 *    only when the lit pattern or the level changes), laid on additively —
 *    the black face takes the light, an unlit segment beside it stays a
 *    readable grey (a halo per digit would tint the unlit segments and blur
 *    the digit). Its opacity and spread follow ledLook(p) like an LED halo,
 *    sized for SMD. Depth-tested on the face (a part in front hides it),
 *    drawn after the pools and before every UI overlay (renderOrder 2.6),
 *    point-bounded (never widens the part's box), one draw while lit, none
 *    while dark; headless / ghost builds have no plane.
 *
 * The drive comes from the model: a segment's real current where the model
 * publishes it, the driver's programmed duty level (TM1637 pulse width,
 * MAX7219 intensity) × the driver's typical average segment drive
 * (DISPLAY_FULL_LIGHT), or — for a model that only says ON / OFF — the
 * honest typical-indicator ON (INDICATOR_ON_LIGHT).
 */
import * as THREE from 'three'
import { pointBounds } from './led-glow-render'
import { GLOW_RENDER_ORDER, LED_LENS_R, SMD_GLOW_SIZE, ledGlowColor, ledLook, type LedLook } from './led-look'

/**
 * The relative intensity (I / 20 mA, averaged) of a driver IC's lit segment
 * at its top brightness setting: ≈ 20 mA peak × the pulse width × the digit
 * multiplex ≈ 5 mA average. The programmed level scales it.
 */
export const DISPLAY_FULL_LIGHT = 0.25

/** A segment / dot lens's emission at perceived brightness p (× its hue; 0 dark; ≤ 1.1 at the rating). */
export function displayLensIntensity(look: LedLook): number {
  return look.drive > 0 ? 0.3 + 0.8 * look.drive + 0.3 * look.over : 0
}

/**
 * The display glow's density at a drive: the drive's own curve (glow2:
 * decoupled from the 5 mm LED halo, whose opacity now rises from 0.46 —
 * laid on additively over the lit segments, that would bleach them towards
 * salmon at a real 8 mA).
 */
export function displayGlowOpacity(look: LedLook): number {
  return look.drive > 0 ? Math.min(1, (0.32 + 0.5 * look.drive + 0.1 * look.over) * 1.05) : 0
}

/** a lit shape of the display, in the glow plane's (x, z) coordinates */
export type GlowShape = { pts: [number, number][] } | { cx: number; cz: number; r: number }

export interface DisplayGlowOptions {
  /** the face rectangle the glow plane covers (plane x / z, scene units) */
  x0: number
  x1: number
  z0: number
  z1: number
  /** the plane's height (scene units, in the parent's frame) */
  y: number
  shapes: GlowShape[]
  /** the light's colour (sRGB hex) */
  color: number
  /** canvas resolution (px per scene unit) */
  pxPerUnit?: number
}

export interface DisplayGlow {
  /** the glow plane (null headless: no canvas) */
  mesh: THREE.Mesh | null
  /**
   * Show shape i at relative level levels[i] (0 dark … 1 the brightest) and
   * the brightest at perceived brightness p. Repaints only on change.
   */
  apply(levels: ArrayLike<number>, p: number): void
}

const OFF = 4096 // shapes are drawn off-canvas; only their blurred shadow lands on it

/** The shape-following glow of an LED display. */
export function makeDisplayGlow(o: DisplayGlowOptions): DisplayGlow {
  const ppu = o.pxPerUnit ?? 14
  const W = Math.max(8, Math.round((o.x1 - o.x0) * ppu))
  const H = Math.max(8, Math.round((o.z1 - o.z0) * ppu))
  let ctx: CanvasRenderingContext2D | null = null
  let tex: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    ctx = cv.getContext('2d')
    if (ctx) tex = new THREE.CanvasTexture(cv)
  }
  if (!ctx || !tex) return { mesh: null, apply: () => {} }
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: ledGlowColor(o.color),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })
  const geo = pointBounds(new THREE.PlaneGeometry(o.x1 - o.x0, o.z1 - o.z0).rotateX(-Math.PI / 2))
  // the bounds point sits on the face centre (inside the part's own box)
  geo.boundingBox!.min.set(0, 0, 0)
  geo.boundingBox!.max.set(0, 0, 0)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set((o.x0 + o.x1) / 2, o.y, (o.z0 + o.z1) / 2)
  mesh.renderOrder = GLOW_RENDER_ORDER
  mesh.raycast = () => {}
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.bbNoStudio = true
  mesh.name = 'display-glow'
  mesh.visible = false
  const c = ctx
  const px = (x: number): number => (x - o.x0) * ppu
  const pz = (z: number): number => (z - o.z0) * ppu
  let sig = ''
  /** a shape's path, drawn `dx` px across (−OFF: off-canvas for the shadow trick; 0: on the canvas) */
  const trace = (s: GlowShape, dx = -OFF): void => {
    c.beginPath()
    if ('pts' in s) {
      s.pts.forEach(([x, z], i) => (i === 0 ? c.moveTo(px(x) + dx, pz(z)) : c.lineTo(px(x) + dx, pz(z))))
      c.closePath()
    } else c.arc(px(s.cx) + dx, pz(s.cz), s.r * ppu, 0, Math.PI * 2)
  }
  const apply = (levels: ArrayLike<number>, p: number): void => {
    const look = ledLook(p)
    let any = false
    let key = look.drive > 0 ? `${p.toFixed(3)}|` : 'off'
    if (look.drive > 0)
      for (let i = 0; i < o.shapes.length; i++) {
        const l = Math.min(1, Math.max(0, levels[i] ?? 0))
        if (l > 0.004) any = true
        key += Math.round(l * 64).toString(36) + ','
      }
    if (!any) {
      mesh.visible = false
      mat.opacity = 0
      sig = 'off'
      return
    }
    // an SMD-sized halo of the same drive: its spread and its density
    const spread = LED_LENS_R * SMD_GLOW_SIZE * look.haloR * ppu
    mat.opacity = displayGlowOpacity(look)
    mesh.visible = true
    if (key === sig) return
    sig = key
    c.clearRect(0, 0, W, H)
    c.save()
    c.shadowOffsetX = OFF
    c.shadowOffsetY = 0
    // a tight bright bleed + the wide soft glow
    for (const [blur, k] of [
      [Math.max(1.5, spread * 0.22), 0.85],
      [Math.max(3, spread * 0.6), 0.55],
    ] as [number, number][]) {
      c.shadowBlur = blur
      for (let i = 0; i < o.shapes.length; i++) {
        const l = Math.min(1, Math.max(0, levels[i] ?? 0))
        if (!(l > 0.004)) continue
        c.shadowColor = `rgba(255,255,255,${(k * l).toFixed(3)})`
        c.fillStyle = '#fff'
        trace(o.shapes[i])
        c.fill()
      }
    }
    c.restore()
    // glow2: the glow is the light spilling onto the FACE — not laid over the
    // lit lens itself, which shows its own saturated light (at a real 8 mA the
    // additive glow over it, under the cover's sheen, read salmon)
    c.save()
    c.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < o.shapes.length; i++) {
      const l = Math.min(1, Math.max(0, levels[i] ?? 0))
      if (!(l > 0.004)) continue
      c.fillStyle = 'rgba(0,0,0,0.85)'
      trace(o.shapes[i], 0)
      c.fill()
    }
    c.restore()
    tex!.needsUpdate = true
  }
  return { mesh, apply }
}
