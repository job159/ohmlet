/**
 * UX wave scene FX (src/three/internal/hologram.ts, hole-fx.ts):
 *  - SC-1 problem layer: red 'error' / amber 'risk' pin markers that throb
 *    harder than the placement markers, and outline hulls that leave the
 *    part itself fully visible (back faces only, depth-tested, no pickable
 *    clone, no sprites / invisible pick proxies).
 *  - SC-3 lesson rim: the same hull in the hologram cyan.
 *  - SC-4 hover chip card: classic coordinates keep the classic card; long
 *    Chinese chips widen (then wrap once at a ' · '); the scene's size
 *    multiplier scales the sprite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { applyOutline, makeOutlineMaterial, makePinMarkers } from '../src/three/internal/hologram'
import { makeHoleLabel } from '../src/three/internal/hole-fx'

function hex(m: THREE.ShaderMaterial): number {
  return (m.uniforms.uColor.value as THREE.Color).getHex()
}

describe('problem / lesson markers and outline hulls', () => {
  it('error markers are red, risk markers amber, both pulse harder than placement markers', () => {
    const calm = makePinMarkers([{ x: 0, y: 0, z: 0 }], 'valid')
    const err = makePinMarkers([{ x: 0, y: 0, z: 0 }], 'error')
    const risk = makePinMarkers([{ x: 1, y: 0, z: 0 }], 'risk')
    const ring = (mk: ReturnType<typeof makePinMarkers>) => (mk.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial
    expect(hex(ring(err))).toBe(new THREE.Color(0xff453a).getHex())
    expect(hex(ring(risk))).toBe(new THREE.Color(0xff9f0a).getHex())
    expect(ring(err).uniforms.uPulse.value).toBeGreaterThan(ring(calm).uniforms.uPulse.value)
    // one ring program for every tint: identical shader source
    expect(ring(err).fragmentShader).toBe(ring(calm).fragmentShader)
    for (const mk of [calm, err, risk]) mk.dispose()
  })

  it('applyOutline clones geometry by reference, draws back faces only and drops sprites / hidden proxies', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const part = new THREE.Group()
    part.userData.componentId = 'DMM1'
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial())
    const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    proxy.visible = false
    const glow = new THREE.Sprite(new THREE.SpriteMaterial())
    part.add(body, proxy, glow)
    const hull = applyOutline(part, 'valid')
    const meshes: THREE.Mesh[] = []
    let sprites = 0
    hull.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
      if ((o as THREE.Sprite).isSprite) sprites++
      expect(o.userData.componentId).toBeUndefined()
    })
    expect(sprites).toBe(0)
    expect(meshes).toHaveLength(1)
    const mat = meshes[0].material as THREE.ShaderMaterial
    expect(meshes[0].geometry).toBe(geo)
    expect(mat).toBe(makeOutlineMaterial('valid'))
    expect(mat.side).toBe(THREE.BackSide)
    expect(mat.depthTest).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(meshes[0].castShadow).toBe(false)
    // the source part is untouched
    expect(body.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(part.userData.componentId).toBe('DMM1')
    // no raycast hits on the hull
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(rc.intersectObject(hull, true)).toHaveLength(0)
    // tints share one program
    expect(makeOutlineMaterial('error').vertexShader).toBe(mat.vertexShader)
    expect(hex(makeOutlineMaterial('risk'))).toBe(new THREE.Color(0xff9f0a).getHex())
  })
})

/** A fake 2D canvas: ASCII ≈ 0.6 em, CJK / full-width = 1 em (good enough to size cards). */
function stubCanvas(): void {
  const ctx = {
    font: '600 78px x',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'center',
    textBaseline: 'middle',
    measureText(s: string) {
      const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 78)
      let em = 0
      for (const ch of s) em += /[⺀-鿿＀-￯]/.test(ch) ? 1 : 0.6
      return { width: em * px }
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    clearRect() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    arc() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillText: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  })
}

describe('hover chip card (makeHoleLabel)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a coordinate or the classic pin chip keeps the classic 2.2 × 0.8 card', () => {
    stubCanvas()
    const label = makeHoleLabel()
    const sprite = label.object as THREE.Sprite
    for (const text of ['e23', 'top+49', 'U1 · A5 · c20']) {
      label.setText(text)
      expect(sprite.scale.x).toBeCloseTo(2.2, 6)
      expect(sprite.scale.y).toBeCloseTo(0.8, 6)
    }
    label.dispose()
  })

  it('a Chinese chip widens the card; a very long one wraps once into two lines', () => {
    stubCanvas()
    const label = makeHoleLabel()
    const sprite = label.object as THREE.Sprite
    label.setText('PA5（板上 A5）· c20')
    expect(sprite.scale.x).toBeGreaterThan(2.2)
    expect(sprite.scale.y).toBeCloseTo(0.8, 6)
    label.setText('D1 · 陰極（短腳）· 0.00 V · 上方 − 電源軌 · 第 32 孔（top-32）')
    expect(sprite.scale.y).toBeCloseTo(0.8 * (260 / 160), 6) // two lines
    expect(sprite.scale.x).toBeLessThanOrEqual(2.2 * 3.5 + 1e-9)
    // back to a coordinate: the classic card again
    label.setText('e23')
    expect(sprite.scale.x).toBeCloseTo(2.2, 6)
    expect(sprite.scale.y).toBeCloseTo(0.8, 6)
    label.dispose()
  })

  it('setScale multiplies the card uniformly (the scene keeps it readable on screen)', () => {
    stubCanvas()
    const label = makeHoleLabel()
    const sprite = label.object as THREE.Sprite
    label.setText('PA5（板上 A5）· c20')
    const w = sprite.scale.x
    label.setScale(2.5)
    expect(sprite.scale.x).toBeCloseTo(w * 2.5, 6)
    expect(sprite.scale.y).toBeCloseTo(0.8 * 2.5, 6)
    label.setScale(Number.NaN)
    expect(sprite.scale.y).toBeCloseTo(0.8, 6)
    expect(label.baseHeight).toBe(0.8)
    label.dispose()
  })
})
