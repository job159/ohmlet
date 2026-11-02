/**
 * Mesh-facing FX registry (owner: vivid). Part visuals are pure functions of
 * telemetry, refreshed only when it changes — a look that must MOVE while
 * the telemetry stands still (an over-driven LED's warning flicker, a
 * buzzer's sound rings) registers a per-frame animator here instead:
 *
 *   setFrameAnimator(owner, fn | null)   fn(t, dt) runs every frame while
 *                                        `owner` is attached to a scene
 *   fxReducedMotion()                    the mounted scene's preference
 *
 * The mounted SceneFx drives the animators from the render loop
 * (tickFrameAnimators). An animator whose owner left the scene graph (the
 * part was removed / rebuilt) is dropped on the next frame — no leaks, no
 * per-frame React work. Animators only touch per-instance materials and
 * their own FX objects (they call updateMatrix on anything they move: part
 * subtrees are frozen).
 */
import type * as THREE from 'three'

export type FrameAnimator = (t: number, dt: number) => void

const animators = new Map<THREE.Object3D, FrameAnimator>()
let reduced = false

/** Register (fn) or drop (null) the per-frame animator of a part object. */
export function setFrameAnimator(owner: THREE.Object3D, fn: FrameAnimator | null): void {
  if (fn) animators.set(owner, fn)
  else animators.delete(owner)
}

export function hasFrameAnimator(owner: THREE.Object3D): boolean {
  return animators.has(owner)
}

export function frameAnimatorCount(): number {
  return animators.size
}

/** Attached to a live scene graph (walks up to a THREE.Scene). */
function attached(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o
  while (p) {
    if ((p as THREE.Scene).isScene) return true
    p = p.parent
  }
  return false
}

/** Run every animator (SceneFx.tick); drops the ones whose part left the scene. */
export function tickFrameAnimators(t: number, dt: number): void {
  if (animators.size === 0) return
  for (const [owner, fn] of animators) {
    if (!attached(owner)) {
      animators.delete(owner)
      continue
    }
    try {
      fn(t, dt)
    } catch (err) {
      animators.delete(owner)
      console.error('fx animator failed', err)
    }
  }
}

// ------------------------------------------------- damage-look structure

let lookStructureRev = 0

/**
 * A part's updater changed WHICH of its meshes exist or show (a damage look
 * appeared or went: a resistor's char shell / glow / burnt-through gap, a
 * vented can's petals, a burned LED's cracks) — not just a material value.
 * The scene compares lookStructureRevision() around each part update and
 * then invalidates its geometry (the Studio BVH, the Enhanced pre-pass skip
 * list). Call it only when the look's structure key changes, never per frame.
 */
export function noteLookStructureChange(): void {
  lookStructureRev++
}

/** Monotonic count of noteLookStructureChange() calls (compare before / after an update). */
export function lookStructureRevision(): number {
  return lookStructureRev
}

export function setFxReducedMotion(v: boolean): void {
  reduced = v
}

/** prefers-reduced-motion of the mounted scene (sampled at mount). */
export function fxReducedMotion(): boolean {
  return reduced
}
