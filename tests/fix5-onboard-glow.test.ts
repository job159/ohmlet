/**
 * An on-board indicator (a board's or module's SMD LED: indicatorHalo,
 * makeLedHalo({ onBoard })) is hidden by its own board's other meshes too —
 * the Blue Pill's BOOT jumper caps hide its PWR LED from the
 * displays-tft-closeup-enhanced camera; the LED's own lens never hides it.
 * A 5 mm LED's own dome still never hides its light.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ComponentInstance, ComponentTelemetry } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { componentPinHoles, holePosition } from '../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import { collectLitHalos, indicatorHalo, ledPerceived, makeLedGlow } from '../src/three/meshes/led-look'
import { updateVisibility, visibilityOf } from '../src/three/meshes/led-glow-render'
import { LED_COLORS } from '../src/three/meshes/semis'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const tel = (t: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...t })

function pinsOf(comp: ComponentInstance): THREE.Vector3[] {
  const entry = getEntry(comp.type)!
  const holes = componentPinHoles(comp, entry)
  if (!holes) throw new Error(comp.id)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}

function cameraAt(c: number[]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 500)
  camera.position.set(c[0], c[1], c[2])
  camera.lookAt(c[3], c[4], c[5])
  camera.updateMatrixWorld()
  return camera
}

function sceneWith(...objects: THREE.Object3D[]): THREE.Scene {
  const scene = new THREE.Scene()
  const parts = new THREE.Group()
  parts.name = 'components'
  scene.add(parts)
  parts.add(...objects)
  scene.updateMatrixWorld(true)
  return scene
}

function seen(scene: THREE.Scene, camera: THREE.Camera, halo: THREE.Sprite): number {
  const glows: THREE.Sprite[] = []
  collectLitHalos(glows)
  updateVisibility(scene, camera, glows, true)
  return visibilityOf(halo)
}

describe('an on-board indicator is hidden by its own board', () => {
  it('a tall mesh of the same part on the sight line hides it; its own lens and a clear line do not', () => {
    const board = new THREE.Group()
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.3), new THREE.MeshStandardMaterial())
    lens.position.set(0, 0.15, 0)
    const rig = indicatorHalo(LED_COLORS.red, v(0, 0.35, 0))!
    const jumperMat = new THREE.MeshStandardMaterial()
    const jumper = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), jumperMat)
    board.add(lens, rig.halo, jumper)
    // the board alone on the scene: still tested (its own meshes can hide it)
    const scene = sceneWith(board)
    rig.apply(ledPerceived(0.15))
    const camera = cameraAt([0, 4, 20, 0, 0.35, 0])
    jumper.position.set(0, 1.5, 6) // between the camera and the LED
    scene.updateMatrixWorld(true)
    expect(seen(scene, camera, rig.halo)).toBe(0)
    jumper.position.set(8, 1.5, 6) // beside the sight line
    scene.updateMatrixWorld(true)
    expect(seen(scene, camera, rig.halo)).toBe(1) // the LED's own lens never hides it
    rig.apply(0)
  })

  it('a 5 mm LED keeps ignoring its own body', () => {
    const ledPart = new THREE.Group()
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42), new THREE.MeshStandardMaterial())
    dome.position.set(0, 1, 0)
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2), new THREE.MeshStandardMaterial())
    flange.position.set(0, 0.6, 0)
    ledPart.add(dome, flange, rig.halo, rig.flare, rig.pool)
    const other = new THREE.Group()
    other.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
    other.position.set(30, 0, 0)
    const scene = sceneWith(ledPart, other)
    rig.apply(ledPerceived(0.5))
    for (const cam of [
      [0, 1, 20, 0, 1, 0],
      [0, 12, 12, 0, 1, 0],
      [10, 0.7, 4, 0, 1, 0],
    ]) {
      expect(seen(scene, cameraAt(cam), rig.halo), cam.join(',')).toBe(1)
    }
    rig.apply(0)
  })

  it('the real Blue Pill: the BOOT jumpers hide PWR from the TFT close-up camera; other views still see it', () => {
    const comp: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
    const entry = getEntry(comp.type)!
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const scene = sceneWith(built.object)
    updateComponentVisual(built, comp, entry, tel({ sub: { LED_PWR: tel({ light: 0.15 }), LED_PC13: tel({ light: 0 }) } }))
    scene.updateMatrixWorld(true)
    const pwr: THREE.Sprite[] = []
    built.object.traverse((o) => {
      if (o.name === 'led-halo' && o.visible) pwr.push(o as THREE.Sprite)
    })
    expect(pwr).toHaveLength(1)
    expect(pwr[0].userData.glowOnBoard).toBe(true)
    // displays-tft-closeup-enhanced: the sight line ends on the jumper cap's front face
    expect(seen(scene, cameraAt([44, 30, 56, 44, 2, 26]), pwr[0])).toBe(0)
    // extra-bp-wired-running-enhanced: PWR in plain view
    expect(seen(scene, cameraAt([11.5, 7.5, 19.5, 15.0, 1.4, 9.0]), pwr[0])).toBeGreaterThan(0.5)
    // straight above the LED: nothing of the board is in the way
    const at = new THREE.Vector3().setFromMatrixPosition(pwr[0].matrixWorld)
    expect(seen(scene, cameraAt([at.x, at.y + 20, at.z + 0.01, at.x, at.y, at.z]), pwr[0])).toBe(1)
    updateComponentVisual(built, comp, entry, null)
    disposeComponentObject(built.object)
  })
})
