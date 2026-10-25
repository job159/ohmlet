/**
 * UX wave SC-1 — circuit-first framing math (src/three/scene.ts
 * fitCornersAlongHome): looking along the home view direction, the eight
 * corners of the framed box land INSIDE the fit window, centred in it, as
 * tight as the window allows (some corner touches an edge), with the orbit
 * target kept on the board plane.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fitCornersAlongHome, type FitWindow } from '../src/three/scene'

const HOME_DIR = new THREE.Vector3(-6, 36, 40).normalize()

function corners(min: THREE.Vector3, max: THREE.Vector3): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new THREE.Vector3(x, y, z))
  return out
}

/** Project corners with a camera at tgt + HOME_DIR·d looking at tgt → tangent-space extents. */
function extents(pts: THREE.Vector3[], tgt: THREE.Vector3, d: number) {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  cam.position.copy(HOME_DIR).multiplyScalar(d).add(tgt)
  cam.lookAt(tgt)
  cam.updateMatrixWorld()
  const inv = cam.matrixWorldInverse
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of pts) {
    const v = p.clone().applyMatrix4(inv) // camera space: looks down −z
    const sx = v.x / -v.z
    const sy = v.y / -v.z
    x0 = Math.min(x0, sx)
    x1 = Math.max(x1, sx)
    y0 = Math.min(y0, sy)
    y1 = Math.max(y1, sy)
  }
  return { x0, x1, y0, y1 }
}

describe('SC-1 fitCornersAlongHome', () => {
  const cases: { name: string; min: [number, number, number]; max: [number, number, number]; win: FitWindow }[] = [
    // a long thin circuit (bench supply on the left, LED at column 40) in a wide free rect
    { name: 'long thin, symmetric window', min: [-14, 0, -2], max: [42, 3, 9], win: { xl: -0.35, xr: 0.35, yb: -0.3, yt: 0.3 } },
    // the workspace window: capsule band reserved at the top, undo pill at the bottom
    { name: 'asymmetric window', min: [0, 0, 0], max: [30, 2.5, 12], win: { xl: -0.4, xr: 0.4, yb: -0.24, yt: 0.18 } },
    // a tall-ish compact cluster (vertical bound)
    { name: 'compact cluster', min: [5, 0, 3], max: [12, 6, 8], win: { xl: -0.5, xr: 0.5, yb: -0.2, yt: 0.2 } },
  ]
  for (const c of cases) {
    it(`${c.name}: every corner inside, centred, tight, target on the plane`, () => {
      const pts = corners(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max))
      const tgt = new THREE.Vector3((c.min[0] + c.max[0]) / 2, 0, (c.min[2] + c.max[2]) / 2)
      const d = fitCornersAlongHome(pts, c.win, tgt)
      expect(d).toBeGreaterThan(1)
      expect(tgt.y).toBe(0)
      const e = extents(pts, tgt, d)
      const eps = 1e-6
      expect(e.x0).toBeGreaterThanOrEqual(c.win.xl - eps)
      expect(e.x1).toBeLessThanOrEqual(c.win.xr + eps)
      expect(e.y0).toBeGreaterThanOrEqual(c.win.yb - eps)
      expect(e.y1).toBeLessThanOrEqual(c.win.yt + eps)
      // centred in the window (a few fixed-point steps: well under a pixel)
      expect(Math.abs((e.x0 + e.x1) / 2 - (c.win.xl + c.win.xr) / 2)).toBeLessThan(2e-3)
      expect(Math.abs((e.y0 + e.y1) / 2 - (c.win.yb + c.win.yt) / 2)).toBeLessThan(2e-3)
      // tight: the binding axis fills its window (no needless zoom-out)
      const fillX = (e.x1 - e.x0) / (c.win.xr - c.win.xl)
      const fillY = (e.y1 - e.y0) / (c.win.yt - c.win.yb)
      expect(Math.max(fillX, fillY)).toBeGreaterThan(0.985)
    })
  }

  it('a box fit beats the old bounding-sphere fit on long circuits', () => {
    const min = new THREE.Vector3(-14, 0, -2)
    const max = new THREE.Vector3(42, 3, 9)
    const win: FitWindow = { xl: -0.35, xr: 0.35, yb: -0.3, yt: 0.3 }
    const tgt = new THREE.Vector3(14, 0, 3.5)
    const d = fitCornersAlongHome(corners(min, max), win, tgt)
    const radius = min.distanceTo(max) / 2
    const sphereD = radius / Math.sin(Math.atan(0.3)) // tangent fit in the narrower field of view
    expect(d).toBeLessThan(sphereD * 0.9)
  })
})
