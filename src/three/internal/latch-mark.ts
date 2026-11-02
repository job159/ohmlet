/**
 * Keep-pressed latch (「保持按下」) — the scene side, kept apart from the
 * pointer code so the rule is unit-tested and the visuals stay additive:
 *
 *  - LatchGesture: the double-click rule of SceneCallbacks.onObjectLatch as
 *    a tiny pure state machine. Two quick clicks on the same pressable part
 *    (the second pressed within `windowMs` of the first's release) ask the
 *    host to keep it pressed; on a LATCHED part the first click is an
 *    ordinary momentary press — which releases it — and the second click of
 *    that double-click presses nothing (so a double-click toggles).
 *  - makeLatchMark: the small lock badge the scene floats over the corner of
 *    a latched part's top (a blue disc with a white closed padlock — the
 *    inspector toggle's colour and glyph). Static (no animation, so reduced
 *    motion has nothing to calm), never picked, drawn with the overlays.
 */
import * as THREE from 'three'
import { asFxSprite } from '../meshes/led-glow-render'

/** One press of a pressable part, from pointerdown to pointerup. */
export interface LatchPress {
  id: string
  /** the second click of a double-click on this part */
  second: boolean
  /** the part was latched when the press began */
  wasLatched: boolean
  /** the second click of a double-click whose first click released a latched part: press nothing */
  swallowed: boolean
}

/** What the scene does when a press ends. */
export type LatchPressEnd = 'latch' | 'release' | 'none'

export class LatchGesture {
  /** the last quick click on a pressable part (the first half of a double-click) */
  private last: { id: string; at: number; wasLatched: boolean } | null = null

  constructor(private readonly windowMs: number) {}

  /** pointerdown on pressable `id` at `now` (ms); `latched`: the host keeps it pressed right now. */
  down(id: string, now: number, latched: boolean): LatchPress {
    const last = this.last
    this.last = null
    const second = !!last && last.id === id && now - last.at < this.windowMs
    return { id, second, wasLatched: latched, swallowed: second && !!last?.wasLatched }
  }

  /**
   * The press ended. `click`: it was a quick click (short, no drift);
   * `canLatch`: the host takes latch requests. 'latch' = ask the host to keep
   * it pressed (no release); 'release' = let go as usual; 'none' = nothing
   * was pressed (a swallowed second click).
   */
  up(p: LatchPress, click: boolean, now: number, canLatch: boolean): LatchPressEnd {
    if (p.swallowed) return 'none'
    if (click && p.second && !p.wasLatched && canLatch) return 'latch'
    this.last = click && !p.second ? { id: p.id, at: now, wasLatched: p.wasLatched } : null
    return 'release'
  }

  /** Forget the first half of a double-click (a cancelled gesture, dispose). */
  reset(): void {
    this.last = null
  }
}

/** Badge size (world units; a hole pitch is 1) and its lift over the part's top. */
export const LATCH_MARK_SIZE = 0.95
/** …but never smaller than this on screen (CSS px) — the whole-circuit view still shows it */
export const LATCH_MARK_MIN_PX = 20
const LATCH_MARK_LIFT = 0.18
/** drawn with the overlays, under the hover chip (HOLE_LABEL_RENDER_ORDER 9) */
const LATCH_MARK_RENDER_ORDER = 7
const PX = 128

let sharedMaterial: THREE.SpriteMaterial | null = null

/** The badge texture: blue disc, white rim, white closed padlock (drawn once, shared). */
function latchMaterial(): THREE.SpriteMaterial {
  if (sharedMaterial) return sharedMaterial
  let texture: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = PX
    canvas.height = PX
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const c = PX / 2
      // soft shadow ring so the badge reads on the white board and the black part alike
      ctx.beginPath()
      ctx.arc(c, c + 2, 58, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
      ctx.fill()
      const g = ctx.createLinearGradient(0, 8, 0, PX - 8)
      g.addColorStop(0, '#3ea0ff')
      g.addColorStop(0.56, '#0a84ff')
      g.addColorStop(1, '#0875e8')
      ctx.beginPath()
      ctx.arc(c, c, 54, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.stroke()
      // closed padlock: shackle arc + rounded body with a keyhole
      ctx.lineWidth = 8
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(c, 56, 15, Math.PI, 0)
      ctx.lineTo(c + 15, 64)
      ctx.moveTo(c - 15, 56)
      ctx.lineTo(c - 15, 64)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      const bw = 50
      const bh = 36
      const bx = c - bw / 2
      const by = 60
      const r = 7
      ctx.beginPath()
      ctx.moveTo(bx + r, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
      ctx.arcTo(bx, by + bh, bx, by, r)
      ctx.arcTo(bx, by, bx + bw, by, r)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#0a84ff'
      ctx.beginPath()
      ctx.arc(c, by + 14, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(c - 2.5, by + 15, 5, 11)
      texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
    }
  }
  sharedMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false, // a small badge stays readable when a taller part stands in front
    toneMapped: false, // the inspector toggle's exact blue, not the filmic curve's
  })
  sharedMaterial.name = 'latch-mark'
  return sharedMaterial
}

/**
 * The lock badge over a latched part whose world box is `box`: anchored at
 * the back-right corner of its top, so the depressed cap / actuator stays in
 * view from the usual camera angles. The material is shared (never disposed);
 * asFxSprite keeps the badge out of override-material passes (Enhanced SAO).
 */
export function makeLatchMark(box: THREE.Box3): THREE.Sprite {
  const sprite = asFxSprite(new THREE.Sprite(latchMaterial()))
  sprite.name = 'latch-mark'
  sprite.center.set(0.5, 0) // bottom-centre anchor: position = point over the part
  sprite.scale.set(LATCH_MARK_SIZE, LATCH_MARK_SIZE, 1)
  sprite.position.set(box.max.x - LATCH_MARK_SIZE * 0.2, box.max.y + LATCH_MARK_LIFT, box.min.z + LATCH_MARK_SIZE * 0.2)
  sprite.renderOrder = LATCH_MARK_RENDER_ORDER
  sprite.raycast = () => {} // never picked: a click goes to the part under it
  return sprite
}

/**
 * Keep a badge at least LATCH_MARK_MIN_PX tall on a `viewH`-px canvas (the
 * scene calls it per frame only while badges exist: one distance each).
 * Grows in 5 % steps, so a still camera never rewrites the scale.
 */
export function sizeLatchMark(sprite: THREE.Sprite, camera: THREE.PerspectiveCamera, viewH: number): void {
  const tanV = Math.tan((camera.fov * Math.PI) / 360)
  const dist = Math.max(0.01, camera.position.distanceTo(sprite.position))
  const px = (LATCH_MARK_SIZE / (2 * dist * tanV)) * viewH
  const k = px > 0 && px < LATCH_MARK_MIN_PX ? Math.min(6, LATCH_MARK_MIN_PX / px) : 1
  const s = LATCH_MARK_SIZE * (Math.round(k * 20) / 20)
  if (sprite.scale.x !== s) sprite.scale.set(s, s, 1)
}
