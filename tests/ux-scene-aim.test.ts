/**
 * UX fix wave SC-9 — in place / wire mode a click always lands on the hole
 * the hover chip names (src/three/scene.ts resolveAimTarget): a part body
 * nearer to the camera than the hole no longer swallows the click
 * (onObjectClick), a covered hole is rejected loudly (locked chip +
 * onHoleOcclusionRejected), a click on a tall part's top lands on the
 * nearest hole within twice the snap radius, and select mode still selects
 * the body. The scene runs headless here: a stand-in for its mounted
 * renderer / camera / groups, real three.js raycasts against a real box.
 */
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { holePosition, parseHole } from '../src/model/breadboard'
import type { SceneCallbacks } from '../src/three/scene-api'

const W = 800
const H = 600

/** Scene internals the test drives (private members, reached by name). */
interface Internals {
  m: unknown
  occluded: Set<string>
  handleClick(e: PointerEvent): void
  processHover(m: unknown): void
}

function holeAt(ref: string): THREE.Vector3 {
  const p = holePosition(parseHole(ref)!)
  return new THREE.Vector3(p.x, 0, p.z)
}

/**
 * A scene with a camera looking down at `target` from the front-top (the
 * lesson's oblique view) and, when `body`, a part body (box, componentId
 * 'U1') sitting ON the ray halfway between the camera and the target.
 */
function rig(target: THREE.Vector3, body: boolean) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000)
  camera.position.set(target.x - 2, 9, target.z + 12)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const componentsGroup = new THREE.Group()
  const wiresGroup = new THREE.Group()
  const terminalsGroup = new THREE.Group()
  if (body) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    box.position.lerpVectors(camera.position, target, 0.5)
    box.userData.componentId = 'U1'
    componentsGroup.add(box)
  }
  componentsGroup.updateMatrixWorld(true)
  const container = { style: { cursor: '' }, clientWidth: W, clientHeight: H }
  s.m = {
    container,
    camera,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } },
    controls: { touches: {} },
    terminalsGroup,
    componentsGroup,
    wiresGroup,
    objectPickRoots: [componentsGroup, wiresGroup],
    hoverPickRoots: [terminalsGroup, componentsGroup, wiresGroup],
    paddles: [],
    holeLabel: makeHoleLabel(),
    screenChip: makeScreenChip(),
    hoverRing: makeHoverRing(),
    fingertipGroup: new THREE.Group(),
    clock: new THREE.Clock(),
  }
  const cb = {
    onHoleClick: vi.fn(),
    onObjectClick: vi.fn(),
    onTerminalClick: vi.fn(),
    onBackgroundClick: vi.fn(),
    onHoleOcclusionRejected: vi.fn(),
    onHoleHover: vi.fn(),
    holeLabelText: vi.fn((h: string) => `${h} → 同一排：U1 PA5`),
  }
  scene.setCallbacks(cb as Partial<SceneCallbacks>)
  /** a real click at the screen projection of world point `p` */
  const clickAt = (p: THREE.Vector3) => {
    const v = p.clone().project(camera)
    const e = { clientX: ((v.x + 1) / 2) * W, clientY: ((1 - v.y) / 2) * H, pointerType: 'mouse', shiftKey: false, metaKey: false, ctrlKey: false }
    s.handleClick(e as unknown as PointerEvent)
  }
  return { scene, s, cb, clickAt, camera }
}

describe('SC-9 aim resolver: the click lands on the hole the chip names', () => {
  it('a part body nearer to the camera than an unoccluded hole: wire mode → onHoleClick(hole), never onObjectClick', () => {
    const a20 = holeAt('a20')
    const { scene, cb, clickAt, camera } = rig(a20, true)
    // the ray really does hit the body first (the precondition of the bug)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(...(a20.clone().project(camera).toArray().slice(0, 2) as [number, number])), camera)
    const hits = ray.intersectObjects((scene as unknown as { m: { componentsGroup: THREE.Group } }).m.componentsGroup.children, true)
    expect(hits.length).toBeGreaterThan(0)
    scene.setInteractionMode('wire')
    clickAt(a20)
    expect(cb.onHoleClick).toHaveBeenCalledWith('a20')
    expect(cb.onObjectClick).not.toHaveBeenCalled()
    expect(cb.onBackgroundClick).not.toHaveBeenCalled()
  })

  it('place mode behaves the same (the hole wins over the body)', () => {
    const a16 = holeAt('a16')
    const { scene, cb, clickAt } = rig(a16, true)
    scene.setInteractionMode('place')
    clickAt(a16)
    expect(cb.onHoleClick).toHaveBeenCalledWith('a16')
    expect(cb.onObjectClick).not.toHaveBeenCalled()
  })

  it('select mode is unchanged: a click on the body selects it', () => {
    const a20 = holeAt('a20')
    const { scene, cb, clickAt } = rig(a20, true)
    scene.setInteractionMode('select')
    clickAt(a20)
    expect(cb.onObjectClick).toHaveBeenCalledWith('U1', false)
    expect(cb.onHoleClick).not.toHaveBeenCalled()
  })

  it('a covered hole is rejected loudly: the locked chip pins and the host explains why', () => {
    const e20 = holeAt('e20')
    const { scene, s, cb, clickAt } = rig(e20, true)
    s.occluded.add('e20')
    scene.setInteractionMode('wire')
    clickAt(e20)
    expect(cb.onHoleOcclusionRejected).toHaveBeenCalledWith('e20')
    expect(cb.onHoleClick).not.toHaveBeenCalled()
    expect(cb.onObjectClick).not.toHaveBeenCalled()
    expect(((s.m as { holeLabel: { object: THREE.Object3D } }).holeLabel.object).visible).toBe(true)
  })

  it('no hole in the snap radius but a body under the ray: the nearest hole within twice the radius', () => {
    // the channel between rows e (z 7) and f (z 9): 0.8 from e20 — beyond the 0.55 snap, inside 1.1
    const p = new THREE.Vector3(20, 0, 7.8)
    const { scene, cb, clickAt } = rig(p, true)
    scene.setInteractionMode('wire')
    clickAt(p)
    expect(cb.onHoleClick).toHaveBeenCalledWith('e20')
    // …and without a body there, the same click is empty space (a started wire is cancelled there)
    const bare = rig(p, false)
    bare.scene.setInteractionMode('wire')
    bare.clickAt(p)
    expect(bare.cb.onHoleClick).not.toHaveBeenCalled()
    expect(bare.cb.onBackgroundClick).toHaveBeenCalled()
  })

  it('the hover pass names the same hole the click commits (chip text + onHoleHover)', () => {
    const a25 = holeAt('a25')
    const { scene, s, cb, camera } = rig(a25, true)
    scene.setInteractionMode('wire')
    const v = a25.clone().project(camera)
    ;(scene as unknown as { pointerNdc: THREE.Vector2 }).pointerNdc.set(v.x, v.y)
    s.processHover(s.m)
    expect(cb.onHoleHover).toHaveBeenLastCalledWith('a25')
    expect(cb.holeLabelText).toHaveBeenLastCalledWith('a25')
  })
})
