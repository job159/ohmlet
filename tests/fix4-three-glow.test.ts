/**
 * fix4 (three):
 *  - THREE-5: Enhanced hands back the LED glow's HDR background copy (up to
 *    a full-target RGBA16F texture) when it stops owning the frame
 *    (deactivate: the switch to Performance) and on dispose — like its
 *    composer / SAO / bloom targets; the next HDR glow frame re-creates it.
 *  - THREE-6: no Object3D in a glow sprite's userData — cloning an LED (the
 *    outline hulls, lesson rims, the placement ghost) never serialises its
 *    halo sprite and glare texture; the flare still shares its halo's
 *    visibility (one sight test per LED).
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentInstance } from '../src/model/types'
import { CATALOG } from '../src/model/catalog'
import { buildComponentObject, disposeComponentObject } from '../src/three/component-meshes'
import { collectLitHalos, ledPerceived, makeLedGlow } from '../src/three/meshes/led-look'
import { disposeGlowBackground, glowUniforms, updateVisibility, visibilityOf } from '../src/three/meshes/led-glow-render'
import { applyOutline } from '../src/three/internal/hologram'
import { EnhancedPipeline } from '../src/three/render-modes/enhanced'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const pOf = (mA: number) => ledPerceived(mA / 20)

afterEach(() => {
  vi.restoreAllMocks()
  disposeGlowBackground()
})

/** light a 20 mA LED and draw it once into Enhanced's HDR target: the background copy exists */
function makeBackgroundCopy(frame: number): THREE.Texture {
  const scene = new THREE.Scene()
  const parts = new THREE.Group()
  parts.name = 'components'
  scene.add(parts)
  const part = new THREE.Group()
  parts.add(part)
  const rig = makeLedGlow({ color: 0xff2a1a, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
  part.add(rig.halo, rig.flare, rig.pool)
  rig.apply(pOf(20))
  const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 500)
  camera.position.set(0, 20, 20)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  scene.updateMatrixWorld(true)
  const renderer = {
    info: { render: { frame } },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    getRenderTarget: () => ({ width: 1600, height: 1000, texture: { type: THREE.HalfFloatType } }),
    copyFramebufferToTexture: () => {},
  }
  const geo = rig.halo.geometry
  ;(rig.halo.onBeforeRender as unknown as (...a: unknown[]) => void).call(rig.halo, renderer, scene, camera, geo, rig.halo.material, null)
  ;(rig.halo.onAfterRender as unknown as (...a: unknown[]) => void).call(rig.halo, renderer, scene, camera, geo, rig.halo.material, null)
  const tex = glowUniforms.uGlowBg.value
  expect(tex).not.toBeNull()
  rig.apply(0)
  return tex!
}

/** an EnhancedPipeline's state without a GPU (the composer / passes as disposable stubs) */
function pipelineStub(active: boolean): EnhancedPipeline {
  const rt = () => ({ dispose: vi.fn() })
  const pass = () => ({ dispose: vi.fn() })
  return Object.assign(Object.create(EnhancedPipeline.prototype) as EnhancedPipeline, {
    ctx: { scene: new THREE.Scene(), renderer: { shadowMap: { needsUpdate: false } } },
    active,
    disposed: false,
    envTexture: null,
    savedEnvironment: null,
    savedEnvIntensity: null,
    keyLight: null,
    savedShadowSize: 0,
    composer: { renderTarget1: rt(), renderTarget2: rt(), dispose: vi.fn() },
    saoPass: { saoRenderTarget: rt(), blurIntermediateRenderTarget: rt(), normalRenderTarget: rt(), dispose: vi.fn() },
    bloomPass: { renderTargetBright: rt(), renderTargetsHorizontal: [rt(), rt()], renderTargetsVertical: [rt(), rt()], dispose: vi.fn() },
    renderPass: pass(),
    outputPass: pass(),
    smaaPass: pass(),
  })
}

describe('THREE-5: Enhanced frees the glow background copy', () => {
  it('deactivate (the switch to Performance) disposes it; the next HDR glow frame re-creates it', () => {
    const tex = makeBackgroundCopy(101)
    const freed = vi.fn()
    tex.addEventListener('dispose', freed)
    const p = pipelineStub(true)
    p.deactivate()
    expect(freed).toHaveBeenCalledTimes(1)
    expect(glowUniforms.uGlowBg.value).toBeNull()
    // back in Enhanced: a fresh copy on the first lit frame
    const again = makeBackgroundCopy(102)
    expect(again).not.toBe(tex)
  })

  it('dispose (scene teardown via the mode manager) disposes it too', () => {
    const tex = makeBackgroundCopy(201)
    const freed = vi.fn()
    tex.addEventListener('dispose', freed)
    pipelineStub(true).dispose()
    expect(freed).toHaveBeenCalledTimes(1)
    expect(glowUniforms.uGlowBg.value).toBeNull()
  })
})

describe('THREE-6: no Object3D in a glow sprite’s userData', () => {
  it('the flare → halo link is not in userData (it survives JSON, no sprite inside)', () => {
    const rig = makeLedGlow({ color: 0xff2a1a, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    for (const s of [rig.halo, rig.flare, rig.pool]) {
      for (const val of Object.values(s.userData)) expect(typeof val === 'object' && val !== null).toBe(false)
      expect(JSON.stringify(s.userData).length).toBeLessThan(200)
    }
  })

  it('cloning an LED (outline hull, placement ghost) serialises no Object3D', () => {
    const comp: ComponentInstance = { id: 'LED1', type: 'led', holes: ['a10', 'a12'], params: { color: 'red' } }
    const built = buildComponentObject(comp, CATALOG.led, [v(0, 0, 0), v(2, 0, 0)])
    const toJSON = vi.spyOn(THREE.Object3D.prototype, 'toJSON')
    const clone = built.object.clone(true)
    const hull = applyOutline(built.object, 'info')
    expect(toJSON).not.toHaveBeenCalled()
    expect(clone.getObjectByName('led-flare')).toBeDefined()
    expect(hull.getObjectByName('led-flare')).toBeUndefined() // sprites are stripped from hulls
    disposeComponentObject(built.object)
  })

  it('the flare still shares its halo’s visibility (one sight test per LED)', () => {
    const scene = new THREE.Scene()
    const parts = new THREE.Group()
    parts.name = 'components'
    scene.add(parts)
    const ledPart = new THREE.Group()
    const rig = makeLedGlow({ color: 0xff2a1a, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42), new THREE.MeshStandardMaterial())
    dome.position.set(0, 1, 0)
    ledPart.add(dome, rig.halo, rig.flare, rig.pool)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.3), new THREE.MeshStandardMaterial())
    wall.position.set(0, 1, 8)
    const wallPart = new THREE.Group()
    wallPart.add(wall)
    parts.add(ledPart, wallPart)
    rig.apply(pOf(20))
    expect(rig.flare.visible).toBe(true)
    const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 500)
    camera.position.set(0, 1, 20)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    const glows: THREE.Sprite[] = []
    collectLitHalos(glows)
    expect(glows).toContain(rig.flare)
    updateVisibility(scene, camera, glows, true)
    expect(visibilityOf(rig.halo)).toBe(0)
    expect(visibilityOf(rig.flare)).toBe(0) // follows its halo, not tested on its own
    wall.position.set(0, 1, -8) // behind the LED
    scene.updateMatrixWorld(true)
    updateVisibility(scene, camera, glows, true)
    expect(visibilityOf(rig.halo)).toBe(1)
    expect(visibilityOf(rig.flare)).toBe(1)
    rig.apply(0)
  })
})
