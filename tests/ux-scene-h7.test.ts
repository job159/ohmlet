/**
 * UX fix wave H7 (SC-11) — the scene side of the highlight API:
 *  - the problem layer draws level 'info' (problemHighlightLevels lists it):
 *    --ios-blue rings without beams + a thin rim; the bridge's
 *    focusInScene({kind:'problem', level:'info', includeHoles}) frames the
 *    fix target too and marks only the problem;
 *  - setSourceHighlight / highlightSource: a hover-only neutral marker that
 *    adds rings and removes them on null — the camera never moves;
 *  - frameTargets(spec, { minElevationDeg }) frames from at least that
 *    elevation (a wiring step from 60°), the default keeps the home angle.
 * The scene runs headless: a stand-in for its mounted camera / controls /
 * groups.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { focusInScene, highlightSource, problemLevelSupported, registerScene } from '../src/ui/workspace/scene-bridge'

interface Internals {
  m: unknown
  camTween: { endPos: THREE.Vector3; endTgt: THREE.Vector3 } | null
}

function headless() {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 1000)
  camera.position.set(14, 40, 48)
  const target = new THREE.Vector3(30, 0, 8)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  const overlayGroup = new THREE.Group()
  s.m = {
    container: { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 },
    camera,
    controls: { target, minDistance: 6, maxDistance: 180, update: () => {}, touches: {} },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) } },
    overlayGroup,
    componentsGroup: new THREE.Group(),
    wiresGroup: new THREE.Group(),
    terminalsGroup: new THREE.Group(),
    objectPickRoots: [],
    hoverPickRoots: [],
    paddles: [],
    holeLabel: makeHoleLabel(),
    screenChip: makeScreenChip(),
    hoverRing: makeHoverRing(),
    clock: new THREE.Clock(),
  }
  return { scene, s, camera, overlayGroup }
}

const named = (g: THREE.Group, name: string) => g.children.find((c) => c.name === name)
const ringMaterials = (o: THREE.Object3D | undefined) => {
  const out: string[] = []
  o?.traverse((c) => {
    const mesh = c as THREE.Mesh
    if (mesh.isMesh) out.push((mesh.material as THREE.Material).name)
  })
  return out
}

beforeEach(() => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
})
afterEach(() => {
  registerScene(null)
  vi.unstubAllGlobals()
})

describe('H7 info level on the problem layer', () => {
  it('the scene declares info; an info spec adds blue rings (no beams) and nothing red', () => {
    const { scene, overlayGroup } = headless()
    expect(scene.problemHighlightLevels).toContain('info')
    scene.setProblemHighlights({ holes: ['f37', 'top-37'], components: [], level: 'info' })
    const mats = ringMaterials(named(overlayGroup, 'problem-highlights'))
    expect(mats.length).toBe(2)
    expect(mats.every((n) => n === 'pin-marker-ring-info')).toBe(true)
    scene.setProblemHighlights(null)
    expect(named(overlayGroup, 'problem-highlights')).toBeUndefined()
    // errors keep their red rings and beams
    scene.setProblemHighlights({ holes: ['f37'], components: [], level: 'error' })
    expect(ringMaterials(named(overlayGroup, 'problem-highlights')).sort()).toEqual(['pin-marker-beam-error', 'pin-marker-ring-error'])
  })

  it('the bridge: an info locate marks the problem hole and frames the fix target with it', () => {
    const { scene, s, overlayGroup } = headless()
    const frame = vi.spyOn(scene, 'frameTargets')
    registerScene(scene)
    expect(problemLevelSupported('info')).toBe(true)
    expect(focusInScene({ holes: ['f37'], components: [] }, { kind: 'problem', level: 'info', includeHoles: ['top-37'], minSpanHoles: 12 })).toBe(true)
    expect(frame).toHaveBeenCalledWith({ holes: ['f37', 'top-37'], components: [] }, { minSpanHoles: 12 })
    // marked: only the problem hole
    expect(ringMaterials(named(overlayGroup, 'problem-highlights'))).toEqual(['pin-marker-ring-info'])
    // the framed box holds both holes (the camera heads for it)
    expect(s.camTween).not.toBeNull()
  })
})

describe('H7 highlightSource: hover-only, never moves the camera', () => {
  it('adds rings + rims and removes them on null', () => {
    const { scene, camera, overlayGroup, s } = headless()
    registerScene(scene)
    const pos = camera.position.clone()
    expect(highlightSource({ holes: ['c20', 'PS1:+'], components: [] })).toBe(true)
    // PS1 is not in the (empty) layout: only the hole resolves
    expect(ringMaterials(named(overlayGroup, 'source-highlight'))).toEqual(['pin-marker-ring-source'])
    expect(camera.position.equals(pos)).toBe(true)
    expect(s.camTween).toBeNull()
    expect(highlightSource(null)).toBe(true)
    expect(named(overlayGroup, 'source-highlight')).toBeUndefined()
    expect(camera.position.equals(pos)).toBe(true)
  })
})

describe('H7 frameTargets minElevationDeg', () => {
  const elevation = (s: Internals) => {
    const tw = s.camTween!
    const d = tw.endPos.clone().sub(tw.endTgt)
    return THREE.MathUtils.radToDeg(Math.asin(d.y / d.length()))
  }
  it('default: the home angle (≈ 41.7°); minElevationDeg 60 frames from 60°, same azimuth', () => {
    const a = headless()
    a.scene.frameTargets({ holes: ['a20', 'e36'] })
    const home = elevation(a.s)
    expect(home).toBeCloseTo(41.7, 0)
    const b = headless()
    b.scene.frameTargets({ holes: ['a20', 'e36'] }, { minElevationDeg: 60 })
    expect(elevation(b.s)).toBeCloseTo(60, 3)
    const az = (s: Internals) => {
      const d = s.camTween!.endPos.clone().sub(s.camTween!.endTgt)
      return Math.atan2(d.x, d.z)
    }
    expect(az(b.s)).toBeCloseTo(az(a.s), 6)
    // a lower minimum than the home angle changes nothing
    const c = headless()
    c.scene.frameTargets({ holes: ['a20', 'e36'] }, { minElevationDeg: 30 })
    expect(c.s.camTween!.endPos.distanceTo(a.s.camTween!.endPos)).toBeLessThan(1e-9)
  })

  it('the 60° framing still fits both holes in view', () => {
    const b = headless()
    b.scene.frameTargets({ holes: ['a20', 'e36'] }, { minElevationDeg: 60 })
    const cam = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 1000)
    cam.position.copy(b.s.camTween!.endPos)
    cam.lookAt(b.s.camTween!.endTgt)
    cam.updateMatrixWorld()
    for (const p of [new THREE.Vector3(20, 0, 3), new THREE.Vector3(36, 0, 7)]) {
      const v = p.project(cam)
      expect(Math.abs(v.x)).toBeLessThan(1)
      expect(Math.abs(v.y)).toBeLessThan(1)
    }
  })
})
