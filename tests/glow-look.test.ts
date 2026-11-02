/**
 * glow (F1 / F13): ONE brightness language for every LED-like emitter.
 *
 *  - the mapping: light (I / 20 mA) → perceived p → visual drive d with a
 *    low-end floor; monotonic; every ladder step (0.5 / 2 / 4 / 10 / 20 mA)
 *    a perceptible change; dark at 0;
 *  - the lens keeps its hue: its emission through three's ACES never
 *    bleaches a coloured lens (the old ×3 emission turned red to salmon);
 *    only the die core whitens, and only near the rating;
 *  - the glow is visible OUTSIDE the dome (alpha ≥ 0.35 at the dome rim
 *    from 0.5 mA, radius ≥ 2.2 domes) and is glare: no depth test, never
 *    picked, never in Studio; white light glows cool and denser;
 *  - how it is drawn (led-glow-render.ts): in the scene pass under every UI
 *    overlay; never through another part (sight lines); never widening the
 *    part's box; in Enhanced's HDR target the shader reproduces the canvas
 *    blend after tone mapping (one background copy per frame); skipped in
 *    the SAO pre-pass and LDR targets; the pool is a multiply tint;
 *  - F13: the Blue Pill / sensor-module / comm / motor-driver indicators,
 *    the WS2812 pixels, the RGB LED, the LCD backlight and the LED displays
 *    (7-segment, TM1637, MAX7219: saturated lenses on the same curve, a
 *    shape-following glow) speak the same language (real current where the
 *    model has one, the programmed duty level for a driver IC; a logic
 *    level stays an honest on/off).
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ComponentInstance, ComponentTelemetry } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { componentPinHoles, holePosition, offboardTerminalPosition } from '../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import {
  COOL_WHITE,
  DRIVE_FLOOR,
  GLOW_RENDER_ORDER,
  GLOW_CORE,
  INDICATOR_ON_LIGHT,
  LED_LENS_R,
  SMD_GLOW_SIZE,
  collectLitHalos,
  glowDisplay,
  glowDisplayInv,
  indicatorLevelP,
  ledDrive,
  ledEmission,
  ledGlowProfile,
  ledLook,
  ledPerceived,
  litHaloCount,
  makeLedGlow,
  makeLedHalo,
} from '../src/three/meshes/led-look'
import { disposeGlowBackground, glowUniforms, updateVisibility, visibilityOf } from '../src/three/meshes/led-glow-render'
import { HOLE_LABEL_RENDER_ORDER, HOVER_RING_RENDER_ORDER } from '../src/three/internal/hole-fx'
import { OUTLINE_RENDER_ORDER, PIN_MARKER_RENDER_ORDER } from '../src/three/internal/hologram'
import { LED_COLORS } from '../src/three/meshes/semis'
import { applyLed, ledLens, logicLed, subLed } from '../src/three/meshes/ext/comm-kit'
import { DISPLAY_FULL_LIGHT, displayGlowOpacity, displayLensIntensity, makeDisplayGlow } from '../src/three/meshes/display-glow'
import { segmentP } from '../src/three/meshes/ics'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const tel = (t: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...t })
const pOf = (mA: number) => ledPerceived(mA / 20)
const LADDER = [0.5, 2, 4, 10, 20]

function entryOf(type: string) {
  const e = getEntry(type)
  if (!e) throw new Error(type)
  return e
}
function pinsOf(comp: ComponentInstance): THREE.Vector3[] {
  const entry = entryOf(comp.type)
  if (entry.placement === 'offboard') return entry.pins.map((_, i) => {
    const p = offboardTerminalPosition(0, i, comp.pos, entry.offboard)
    return v(p.x, 0, p.z)
  })
  const holes = componentPinHoles(comp, entry)
  if (!holes) throw new Error(comp.id)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}
function named(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o.name === name) out.push(o)
  })
  return out
}
const spriteMat = (o: THREE.Object3D) => (o as THREE.Sprite).material

// three's fitted ACES (ACESFilmicToneMapping) at the scene's exposure → sRGB 0..1
const EXPOSURE = 1.05
function aces(rgb: [number, number, number]): [number, number, number] {
  const fit = (x: number) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081)
  const [r, g, b] = rgb.map((c) => (c * EXPOSURE) / 0.6)
  const R = fit(0.59719 * r + 0.35458 * g + 0.04823 * b)
  const G = fit(0.076 * r + 0.90834 * g + 0.01566 * b)
  const B = fit(0.0284 * r + 0.13383 * g + 0.83777 * b)
  const o = [1.60475 * R - 0.53108 * G - 0.07367 * B, -0.10208 * R + 1.10813 * G - 0.00605 * B, -0.00327 * R - 0.07276 * G + 1.07602 * B]
  const enc = (x: number) => {
    const c = Math.min(1, Math.max(0, x))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  }
  return [enc(o[0]), enc(o[1]), enc(o[2])]
}
function hsv(rgb: [number, number, number]): { h: number; s: number } {
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2])
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  const mx = Math.max(...rgb)
  const mn = Math.min(...rgb)
  return { h: hsl.h * 360, s: mx > 0 ? (mx - mn) / mx : 0 }
}

// ---------------------------------------------------------------------------
// the mapping
// ---------------------------------------------------------------------------

describe('glow: the brightness mapping', () => {
  it('drive: dark at 0, a visible floor for any real current, 1 at the rating, monotonic', () => {
    expect(ledDrive(0)).toBe(0)
    expect(ledDrive(pOf(0.0005))).toBeLessThan(0.08) // 0.5 µA leakage: (practically) dark
    expect(ledDrive(pOf(0.5))).toBeGreaterThan(0.3) // 0.5 mA: obviously on
    expect(ledDrive(pOf(0.5))).toBeLessThan(0.45) // …and obviously weak
    expect(ledDrive(pOf(20))).toBeCloseTo(1, 6)
    expect(ledDrive(pOf(0.5))).toBeGreaterThanOrEqual(DRIVE_FLOOR + 0.1)
    let prev = -1
    for (let uA = 0; uA <= 40_000; uA += 25) {
      const d = ledDrive(pOf(uA / 1000))
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
    expect(ledDrive(NaN)).toBe(0)
    expect(ledDrive(-1)).toBe(0)
  })

  it('every ladder step changes the look perceptibly (the glow area × opacity grows ≥ 25 %)', () => {
    const looks = LADDER.map((mA) => ledLook(pOf(mA)))
    for (let i = 1; i < looks.length; i++) {
      const a = looks[i - 1]
      const b = looks[i]
      for (const k of ['drive', 'lens', 'die', 'halo', 'haloR', 'pool', 'poolR'] as const) expect(b[k], `${LADDER[i]} mA ${k}`).toBeGreaterThan(a[k])
      expect((b.halo * b.haloR ** 2) / (a.halo * a.haloR ** 2), `${LADDER[i - 1]} → ${LADDER[i]} mA`).toBeGreaterThan(1.25)
    }
    const dark = ledLook(0)
    for (const k of ['drive', 'lens', 'die', 'halo', 'haloR', 'flare', 'pool', 'poolR'] as const) expect(dark[k], k).toBe(0)
  })

  it('the glow shows outside the dome from 0.5 mA: rim alpha ≥ 0.35, radius ≥ 2.2 domes', () => {
    for (const mA of LADDER) {
      const l = ledLook(pOf(mA))
      expect(l.haloR, `${mA} mA`).toBeGreaterThanOrEqual(2.2)
      expect(l.halo * ledGlowProfile(1 / l.haloR), `${mA} mA rim alpha`).toBeGreaterThanOrEqual(0.35)
    }
    // the profile: held low over the lens (the dome keeps its own look under
    // the glare), full near the 4 mA rim, then a soft fall to 0 at the edge
    expect(ledGlowProfile(0)).toBeCloseTo(GLOW_CORE, 9)
    expect(ledGlowProfile(0.3)).toBeGreaterThan(0.8)
    expect(ledGlowProfile(1)).toBe(0)
    for (let u = 0.35; u < 1; u += 0.05) expect(ledGlowProfile(u)).toBeLessThan(ledGlowProfile(u - 0.05))
    for (let u = 0.05; u <= 0.25; u += 0.05) expect(ledGlowProfile(u)).toBeGreaterThan(ledGlowProfile(u - 0.05))
  })

  it('the star flare marks bright (10 mA) and dazzling (20 mA) only; the die whitens only near the rating', () => {
    expect(ledLook(pOf(4)).flare).toBe(0)
    expect(ledLook(pOf(10)).flare).toBeGreaterThan(0.2)
    expect(ledLook(pOf(20)).flare).toBeGreaterThan(0.9)
    expect(ledLook(pOf(4)).dieWhite).toBe(0)
    expect(ledLook(pOf(10)).dieWhite).toBe(0)
    expect(ledLook(pOf(20)).dieWhite).toBeGreaterThan(0.6)
    // over-driven: harsher still (bigger, whiter), never less
    const r = ledLook(pOf(20))
    const o = ledLook(pOf(30))
    expect(o.over).toBeGreaterThan(0)
    expect(o.haloR).toBeGreaterThan(r.haloR)
    expect(o.haloWhite).toBeGreaterThan(0)
  })

  it('the lens keeps its hue through ACES (no salmon), gets brighter, and beats the old bleaching curve', () => {
    for (const name of ['red', 'green', 'yellow', 'blue']) {
      const hue = new THREE.Color(ledEmission(LED_COLORS[name]))
      const lensOut = (e: number) => aces([hue.r * e, hue.g * e, hue.b * e])
      const s0 = hsv(lensOut(ledLook(pOf(0.5)).lens))
      let lastMax = 0
      for (const mA of LADDER) {
        const out = lensOut(ledLook(pOf(mA)).lens)
        const c = hsv(out)
        // the GPIO range keeps its saturation; even the dazzling 20 mA keeps most of it
        expect(c.s, `${name} ${mA} mA saturation`).toBeGreaterThan(mA <= 10 ? Math.max(0.5, 0.65 * s0.s) : 0.4)
        expect(Math.abs(((c.h - s0.h + 540) % 360) - 180), `${name} ${mA} mA hue shift`).toBeLessThan(20)
        expect(Math.max(...out), `${name} ${mA} mA brighter`).toBeGreaterThanOrEqual(lastMax - 1e-9)
        lastMax = Math.max(...out)
      }
      // the old curve (0.25 + 3 q — F1: "the lit LED looks paler than the unlit one")
      const old = hsv(lensOut(0.25 + 3 * pOf(4))).s
      expect(hsv(lensOut(ledLook(pOf(4)).lens)).s - old, `${name}: saturation regained at 4 mA`).toBeGreaterThan(0.1)
    }
  })

  it('a logic-level indicator shows an honest ON (a typical 2 mA indicator), never more', () => {
    expect(indicatorLevelP(0)).toBe(0)
    expect(indicatorLevelP(undefined)).toBe(0)
    expect(indicatorLevelP(1)).toBeCloseTo(ledPerceived(INDICATOR_ON_LIGHT), 9)
    expect(indicatorLevelP(7)).toBeCloseTo(ledPerceived(INDICATOR_ON_LIGHT), 9) // clamped
    expect(logicLed(1)).toBe(INDICATOR_ON_LIGHT)
    expect(logicLed(0)).toBe(0)
    expect(logicLed(undefined)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// the rigs
// ---------------------------------------------------------------------------

describe('glow: the halo / flare / pool rig', () => {
  it('glare: no depth test, never picked, not in Studio; the pool is a multiply tint on the board', () => {
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1.6, 0), poolAt: v(0, 0, 0) })
    for (const s of [rig.halo, rig.flare]) {
      expect(s.material.depthTest).toBe(false)
      expect(s.material.depthWrite).toBe(false)
      expect(s.userData.bbNoStudio).toBe(true)
      const hits: THREE.Intersection[] = []
      const rc = new THREE.Raycaster(v(0, 10, 0), v(0, -1, 0))
      rc.camera = new THREE.PerspectiveCamera()
      s.raycast(rc, hits)
      expect(hits).toHaveLength(0)
    }
    const pool = rig.pool.material as THREE.MeshBasicMaterial
    expect(pool.blending).toBe(THREE.MultiplyBlending)
    expect(pool.toneMapped).toBe(false)
    expect(pool.depthTest).toBe(true)
    rig.apply(pOf(4))
    expect(rig.halo.visible && rig.pool.visible).toBe(true)
    expect(rig.flare.visible).toBe(false)
    // world size: radius = haloR dome radii
    expect(rig.halo.scale.x / 2).toBeCloseTo(LED_LENS_R * ledLook(pOf(4)).haloR, 6)
    rig.apply(0)
    expect(rig.halo.visible || rig.flare.visible || rig.pool.visible).toBe(false)
  })

  it('white light glows cool blue-white, denser and wider than a coloured LED at the same current', () => {
    expect(ledEmission(LED_COLORS.white)).toBe(COOL_WHITE)
    expect(ledEmission(LED_COLORS.red)).toBe(LED_COLORS.red)
    const white = makeLedHalo({ color: LED_COLORS.white, at: v(0, 0, 0) })
    const red = makeLedHalo({ color: LED_COLORS.red, at: v(0, 0, 0) })
    expect(white.color.b).toBeGreaterThan(white.color.r)
    for (const mA of LADDER) {
      white.apply(pOf(mA))
      red.apply(pOf(mA))
      expect(spriteMat(white.halo).opacity, `${mA} mA`).toBeGreaterThan(spriteMat(red.halo).opacity)
      expect(white.halo.scale.x).toBeGreaterThan(red.halo.scale.x)
    }
    white.apply(0)
    red.apply(0)
  })

  it('the shader: the canvas path untouched; in an HDR target the display-space emulation; the flare adds', () => {
    const rig = makeLedGlow({ color: LED_COLORS.green, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    const compile = (m: THREE.Material) => {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        fragmentShader: 'void main() {\n#include <opaque_fragment>\n}',
        vertexShader: '',
      }
      ;(m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null)
      return shader
    }
    const halo = compile(spriteMat(rig.halo))
    expect(halo.fragmentShader).toContain('glowDisplayInv')
    expect(halo.fragmentShader).toContain('uGlowBg')
    expect(halo.fragmentShader).toContain('#include <opaque_fragment>') // the canvas path (pass 0)
    expect(halo.uniforms.uGlowPass).toBe(glowUniforms.uGlowPass)
    expect(halo.uniforms.uGlowBgRect).toBe(glowUniforms.uGlowBgRect)
    expect(spriteMat(rig.flare).defines?.GLOW_ADDITIVE).toBe('')
    expect(spriteMat(rig.halo).defines?.GLOW_ADDITIVE).toBeUndefined()
    expect(spriteMat(rig.halo).customProgramCacheKey()).not.toBe(spriteMat(rig.flare).customProgramCacheKey())
    expect(spriteMat(rig.halo).customProgramCacheKey()).not.toBe(new THREE.SpriteMaterial().customProgramCacheKey())
    const pool = { uniforms: {} as Record<string, { value: number }>, fragmentShader: '#include <opaque_fragment>', vertexShader: '' }
    ;((rig.pool.material as THREE.Material).onBeforeCompile as (s: unknown, r: unknown) => void)(pool, null)
    expect(pool.fragmentShader).toContain('mix( vec3( 1.0 ), outgoingLight')
    expect(pool.fragmentShader).not.toContain('#include <opaque_fragment>')
  })

  it('the HDR emulation reproduces the canvas blend after tone mapping, and tints the HDR-white board', () => {
    // D = three's ACES (exposure) + sRGB OETF, exactly what OutputPass applies
    const D = (c: THREE.Vector3) => glowDisplay(c, EXPOSURE)
    const Dinv = (d: THREE.Vector3) => glowDisplayInv(d, EXPOSURE)
    for (const d of [v(0.2, 0.5, 0.8), v(0.9, 0.3, 0.25), v(0.05, 0.05, 0.05), v(0.95, 0.95, 0.95), v(0.4, 0.85, 0.5)]) {
      expect(D(Dinv(d)).distanceTo(d), `round trip ${d.toArray()}`).toBeLessThan(2 / 255)
    }
    const backgrounds: Record<string, THREE.Vector3> = {
      'white board': v(1.25, 1.22, 1.18),
      'hot board': v(3.2, 3.1, 3.0),
      'dark hole': v(0.02, 0.02, 0.025),
    }
    for (const name of ['red', 'blue', 'white']) {
      const c = new THREE.Color(ledEmission(LED_COLORS[name]))
      const cD = D(v(c.r, c.g, c.b))
      for (const [bgName, B] of Object.entries(backgrounds)) {
        for (const a of [0.2, 0.5, 0.8]) {
          // the canvas: mix(D(B), D(c), a) in display space. The HDR target:
          // the halo writes X with alpha a, the blend gives X·a + B·(1 − a), OutputPass shows D(…)
          const T = D(B.clone()).lerp(cD, a)
          const X = Dinv(T.clone()).sub(B.clone().multiplyScalar(1 - a)).divideScalar(a)
          const shown = D(X.multiplyScalar(a).add(B.clone().multiplyScalar(1 - a)))
          expect(shown.distanceTo(T), `${name} over ${bgName}, a ${a}`).toBeLessThan(4 / 255)
        }
      }
    }
    // why it exists: a plain alpha tint of the HDR-white board washes out, the emulation does not
    const B = backgrounds['hot board']
    const red = new THREE.Color(LED_COLORS.red)
    const naive = D(B.clone().lerp(v(red.r, red.g, red.b), 0.5))
    const emulated = D(B.clone()).lerp(D(v(red.r, red.g, red.b)), 0.5)
    expect(D(B.clone()).y - naive.y).toBeLessThan(0.1) // washed out
    expect(D(B.clone()).y - emulated.y).toBeGreaterThan(0.3) // the board plainly takes the red
  })

  it('draw control: skipped in override / LDR passes; an HDR target copies the background once a frame; opacity = light × visibility', () => {
    const scene = new THREE.Scene()
    const parts = new THREE.Group()
    parts.name = 'components'
    scene.add(parts)
    const part = new THREE.Group()
    parts.add(part)
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    part.add(rig.halo, rig.flare, rig.pool)
    rig.apply(pOf(20))
    const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 500)
    camera.position.set(0, 20, 20)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    const copies: { w: number; h: number; x: number; y: number }[] = []
    let target: unknown = null
    const renderer = {
      info: { render: { frame: 1 } },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: EXPOSURE,
      getRenderTarget: () => target,
      copyFramebufferToTexture: (t: THREE.Texture, pos: THREE.Vector2) =>
        copies.push({ w: t.image.width, h: t.image.height, x: pos.x, y: pos.y }),
    }
    const geo = rig.halo.geometry
    const draw = (s: THREE.Sprite, sc: THREE.Scene = scene) => {
      ;(s.onBeforeRender as unknown as (...a: unknown[]) => void).call(s, renderer, sc, camera, geo, s.material, null)
      const drawn = geo.drawRange.count !== -1
      ;(s.onAfterRender as unknown as (...a: unknown[]) => void).call(s, renderer, sc, camera, geo, s.material, null)
      expect(geo.drawRange.count).toBe(Infinity) // always restored
      return drawn
    }
    // the canvas (Performance): three's own path, full light, no copy
    expect(draw(rig.halo)).toBe(true)
    expect(glowUniforms.uGlowPass.value).toBe(0)
    expect(spriteMat(rig.halo).opacity).toBeCloseTo(rig.halo.userData.glowA as number, 9)
    expect(copies).toHaveLength(0)
    // the SAO normal/depth pre-pass (an override material): never drawn
    const pre = new THREE.Scene()
    pre.overrideMaterial = new THREE.MeshNormalMaterial()
    expect(draw(rig.halo, pre)).toBe(false)
    // an LDR render target: skipped
    target = { width: 800, height: 500, texture: { type: THREE.UnsignedByteType } }
    renderer.info.render.frame = 2
    expect(draw(rig.halo)).toBe(false)
    // Enhanced's HDR target: the emulation, ONE copy for the frame, covering the glows
    target = { width: 800, height: 500, texture: { type: THREE.HalfFloatType } }
    renderer.info.render.frame = 3
    expect(draw(rig.halo)).toBe(true)
    expect(draw(rig.flare)).toBe(true)
    expect(glowUniforms.uGlowPass.value).toBe(1)
    expect(copies).toHaveLength(1)
    const r = glowUniforms.uGlowBgRect.value
    expect([r.x, r.y]).toEqual([copies[0].x, copies[0].y])
    const centre = v(0, 1, 0).project(camera)
    const cx = (centre.x * 0.5 + 0.5) * 800
    const cy = (centre.y * 0.5 + 0.5) * 500
    expect(cx).toBeGreaterThan(r.x)
    expect(cx).toBeLessThan(r.x + r.z)
    expect(cy).toBeGreaterThan(r.y)
    expect(cy).toBeLessThan(r.y + r.w)
    expect((glowUniforms.uGlowBg.value as THREE.Texture).type).toBe(THREE.HalfFloatType)
    renderer.info.render.frame = 4
    draw(rig.halo)
    expect(copies).toHaveLength(2) // the next frame copies again
    rig.apply(0)
    disposeGlowBackground()
  })

  it('a hidden LED casts no glare: the visibility is the share of sight lines no other part blocks', () => {
    const scene = new THREE.Scene()
    const parts = new THREE.Group()
    parts.name = 'components'
    scene.add(parts)
    const ledPart = new THREE.Group()
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    // the LED's own body never hides its own light
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42), new THREE.MeshStandardMaterial())
    dome.position.set(0, 1, 0)
    ledPart.add(dome, rig.halo, rig.flare, rig.pool)
    const wallMat = new THREE.MeshStandardMaterial()
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.3), wallMat)
    const wallPart = new THREE.Group()
    wallPart.add(wall)
    parts.add(ledPart, wallPart)
    rig.apply(pOf(20))
    const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 500)
    camera.position.set(0, 1, 20)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    const glows: THREE.Sprite[] = []
    const seen = (z: number, x = 0, transparent = false) => {
      wall.position.set(x, 1, z)
      wallMat.transparent = transparent
      wallMat.opacity = transparent ? 0.4 : 1
      scene.updateMatrixWorld(true)
      collectLitHalos(glows)
      updateVisibility(scene, camera, glows, true)
      return visibilityOf(rig.halo)
    }
    expect(seen(8)).toBe(0) // a module between the camera and the LED: no glare at all
    expect(visibilityOf(rig.flare)).toBe(0) // the flare follows its halo
    expect(seen(-8)).toBe(1) // behind the LED: in full view
    expect(seen(8, 30)).toBe(1) // beside the sight line
    expect(seen(8, 0, true)).toBe(1) // a smoked / clear cover does not hide the light
    // the wall's edge between the light's centre and its right-hand sight line
    // (it crosses the wall at 0.6 × its offset): only some sight lines are blocked
    const r = LED_LENS_R * 0.55 * 0.3
    const partly = seen(8, -3 + r)
    expect(partly).toBeGreaterThan(0)
    expect(partly).toBeLessThan(1)
    rig.apply(0)
  })

  it('the glow never widens the part: point-bounded, its scale back to a point when dark', () => {
    const comp: ComponentInstance = { id: 'LED1', type: 'led', holes: ['b20', 'b21'], params: { color: 'red' } }
    const entry = entryOf(comp.type)
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const glowsOf = () => [...named(built.object, 'led-halo'), ...named(built.object, 'led-flare'), ...named(built.object, 'led-pool')]
    const boxOf = () => new THREE.Box3().setFromObject(built.object)
    const withoutGlow = () => {
      const glows = glowsOf()
      const parents = glows.map((g) => g.parent!)
      glows.forEach((g) => g.removeFromParent())
      const b = boxOf()
      glows.forEach((g, i) => parents[i].add(g))
      return b
    }
    const dark = boxOf()
    updateComponentVisual(built, comp, entry, tel({ light: 1.0 })) // 20 mA: the biggest halo, the flare, the pool
    const [halo] = named(built.object, 'led-halo') as THREE.Sprite[]
    expect(halo.visible).toBe(true)
    expect(halo.scale.x).toBeGreaterThan(3)
    const lit = boxOf()
    expect(lit.equals(withoutGlow())).toBe(true)
    expect(lit.equals(dark)).toBe(true)
    updateComponentVisual(built, comp, entry, tel({ light: 0 }))
    for (const o of glowsOf()) expect(o.scale.x, o.name).toBeLessThanOrEqual(1e-3)
    expect(boxOf().equals(dark)).toBe(true)
    disposeComponentObject(built.object)
  })

  it('draw order: after the pools of light, before every UI overlay (highlight rim, pin markers, labels)', () => {
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(0, 1, 0), poolAt: v(0, 0, 0) })
    expect(rig.pool.renderOrder).toBeLessThan(rig.halo.renderOrder)
    expect(rig.halo.renderOrder).toBeLessThan(rig.flare.renderOrder)
    // 8: the live LED label the lesson highlight adds (scene.ts)
    for (const overlay of [OUTLINE_RENDER_ORDER, HOVER_RING_RENDER_ORDER, PIN_MARKER_RENDER_ORDER, HOLE_LABEL_RENDER_ORDER, 8])
      expect(rig.flare.renderOrder).toBeLessThan(overlay)
  })

  it('the lit registry: only attached, visible, lit glows', () => {
    const scene = new THREE.Scene()
    const part = new THREE.Group()
    scene.add(part)
    const rig = makeLedGlow({ color: LED_COLORS.red, at: v(1, 1.6, 2), poolAt: v(1, 0, 2) })
    part.add(rig.halo, rig.flare, rig.pool)
    const out: THREE.Sprite[] = []
    const mine = () => {
      collectLitHalos(out)
      return out.filter((s) => s === rig.halo || s === rig.flare).length
    }
    rig.apply(0)
    expect(mine()).toBe(0)
    rig.apply(pOf(20)) // halo + star flare
    expect(mine()).toBe(2)
    part.visible = false
    expect(mine()).toBe(0) // hidden part: not drawn
    part.visible = true
    // detached (the part was rebuilt / deleted): leaves the registry
    scene.remove(part)
    const before = litHaloCount()
    expect(mine()).toBe(0)
    expect(litHaloCount()).toBe(before - 2)
  })
})

// ---------------------------------------------------------------------------
// F13: every LED-like emitter
// ---------------------------------------------------------------------------

function halosOf(root: THREE.Object3D): THREE.Sprite[] {
  return named(root, 'led-halo') as THREE.Sprite[]
}

describe('glow F13: one language for every LED-like emitter', () => {
  it('Blue Pill PWR / PC13: the real current, the shared halo (SMD-sized), monotonic, saturated lit lens', () => {
    const comp: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
    const entry = entryOf(comp.type)
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const halos = halosOf(built.object)
    expect(halos).toHaveLength(2)
    for (const h of halos) expect(h.material.depthTest).toBe(false)
    const ref = makeLedHalo({ color: LED_COLORS.red, at: v(0, 0, 0) })
    let last = 0
    for (const mA of [0.5, 1.5, 4]) {
      updateComponentVisual(built, comp, entry, tel({ sub: { LED_PWR: tel({ light: mA / 20 }), LED_PC13: tel({ light: 0 }) } }))
      const lit = halos.filter((h) => h.visible)
      expect(lit, `${mA} mA`).toHaveLength(1)
      // the same opacity as a 5 mm LED at the same current, SMD_GLOW_SIZE × its size
      ref.apply(pOf(mA))
      expect(spriteMat(lit[0]).opacity).toBeCloseTo(spriteMat(ref.halo).opacity, 6)
      expect(lit[0].scale.x / ref.halo.scale.x).toBeCloseTo(SMD_GLOW_SIZE, 6)
      expect(lit[0].scale.x).toBeGreaterThan(last)
      last = lit[0].scale.x
    }
    // the lit lens: the hue (darkened), not the pale unlit tint
    const lens = (built.object.children as THREE.Object3D[])
      .flatMap((c) => (c as THREE.Mesh).material ? [(c as THREE.Mesh).material as THREE.MeshPhysicalMaterial] : [])
      .find((m) => m.emissive?.getHex() === LED_COLORS.red && m.emissiveIntensity > 0)
    expect(lens).toBeDefined()
    expect(lens!.color.g).toBeLessThan(0.1 * lens!.color.r)
    updateComponentVisual(built, comp, entry, null)
    expect(halosOf(built.object).every((h) => !h.visible)).toBe(true)
    expect(lens!.emissiveIntensity).toBe(0)
    ref.apply(0)
    disposeComponentObject(built.object)
  })

  it('a sensor module power LED and a motor-driver indicator use the sub-circuit LED current', () => {
    const gy: ComponentInstance = { id: 'S1', type: 'mpu6050_gy521', at: 'f20' }
    const built = buildComponentObject(gy, entryOf(gy.type), pinsOf(gy))
    const [h] = halosOf(built.object)
    updateComponentVisual(built, gy, entryOf(gy.type), tel({ sub: { LED_PWR: tel({ light: 0.025 }) } }))
    const dim = h.scale.x
    expect(h.visible).toBe(true)
    updateComponentVisual(built, gy, entryOf(gy.type), tel({ sub: { LED_PWR: tel({ light: 0.15 }) } }))
    expect(h.scale.x).toBeGreaterThan(dim)
    disposeComponentObject(built.object)

    const uln: ComponentInstance = { id: 'M1', type: 'uln2003_board' }
    const b2 = buildComponentObject(uln, entryOf(uln.type), pinsOf(uln))
    const halos = halosOf(b2.object)
    expect(halos).toHaveLength(4)
    updateComponentVisual(b2, uln, entryOf(uln.type), tel({ sub: { LED_A: tel({ light: 0.1 }), LED_B: tel({ light: 0 }), LED_C: tel({ light: 0.02 }), LED_D: tel({ light: 0 }) } }))
    expect(halos.map((x) => x.visible)).toEqual([true, false, true, false])
    expect(halos[0].scale.x).toBeGreaterThan(halos[2].scale.x) // 2 mA vs 0.4 mA
    disposeComponentObject(b2.object)
  })

  it('comm-kit indicators: subLed is the real light; a logic channel is an honest on/off', () => {
    expect(subLed(tel({ sub: { LED_PWR: tel({ light: 0.07 }) } }), 'LED_PWR')).toBeCloseTo(0.07, 9)
    expect(subLed(tel({ sub: { LED_PWR: tel({ ledBrightness: 0.3 }) } }), 'LED_PWR')).toBeCloseTo(0.15, 9)
    expect(subLed(null, 'LED_PWR')).toBeUndefined()
    const g = new THREE.Group()
    const rig = ledLens(g, 'blue', 0, 0, false)
    applyLed(rig, logicLed(1))
    expect(rig.halo!.halo.visible).toBe(true)
    const on = rig.halo!.halo.scale.x
    applyLed(rig, logicLed(0.5))
    expect(rig.halo!.halo.scale.x).toBeLessThan(on)
    applyLed(rig, logicLed(0))
    expect(rig.halo!.halo.visible).toBe(false)
    expect(rig.lens.emissiveIntensity).toBe(0)
    // a ghost preview: no halo, the shared lens is never touched
    const ghost = ledLens(g, 'red', 0, 0, true)
    const before = ghost.lens.color.getHex()
    applyLed(ghost, 0.5)
    expect(ghost.halo).toBeNull()
    expect(ghost.lens.color.getHex()).toBe(before)
  })

  it('WS2812 pixels: the latched level and hue drive the shared halo', () => {
    const comp: ComponentInstance = { id: 'LED1', type: 'ws2812b_strip8', at: 'j10' }
    const entry = entryOf(comp.type)
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const halos = halosOf(built.object)
    expect(halos).toHaveLength(8)
    updateComponentVisual(built, comp, entry, tel({ rgb: [0xff0000, 0x400000, 0x0000ff, 0, 0, 0, 0, 0] }))
    expect(halos[0].visible && halos[1].visible && halos[2].visible).toBe(true)
    expect(halos[3].visible).toBe(false)
    expect(halos[0].scale.x).toBeGreaterThan(halos[1].scale.x) // full vs a quarter level
    const red = spriteMat(halos[1]).color
    expect(red.r).toBeGreaterThan(0.9) // a dim pixel keeps its full hue (brightness is the size / opacity)
    expect(spriteMat(halos[2]).color.b).toBeGreaterThan(spriteMat(halos[2]).color.r)
    disposeComponentObject(built.object)
  })

  it('RGB LED: the mixed hue on the same halo language as the 5 mm LED', () => {
    const comp: ComponentInstance = { id: 'RGB1', type: 'rgb_led', holes: ['a10', 'a11', 'a12', 'a13'] }
    const entry = entryOf(comp.type)
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const [h] = halosOf(built.object)
    updateComponentVisual(built, comp, entry, tel({ leds: { R: 1, G: 0, B: 0 }, values: { iR: 0.004, iG: 0, iB: 0 } }))
    const ref = makeLedHalo({ color: LED_COLORS.red, at: v(0, 0, 0) })
    ref.apply(pOf(4))
    expect(h.visible).toBe(true)
    expect(h.scale.x).toBeCloseTo(ref.halo.scale.x, 6)
    expect(spriteMat(h).opacity).toBeCloseTo(spriteMat(ref.halo).opacity, 6)
    ref.apply(0)
    updateComponentVisual(built, comp, entry, tel({ leds: { R: 0, G: 0, B: 0 } }))
    expect(h.visible).toBe(false)
    disposeComponentObject(built.object)
  })

  it('LCD backlight: the backlight LED current through the same perceptual curve', () => {
    const comp: ComponentInstance = { id: 'LCD1', type: 'lcd1602', at: 'j10' }
    const entry = entryOf(comp.type)
    const built = buildComponentObject(comp, entry, pinsOf(comp))
    const screen = (() => {
      let m: THREE.MeshPhysicalMaterial | null = null
      built.object.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
        if (mm && mm.emissiveMap) m = mm
      })
      return m as unknown as THREE.MeshPhysicalMaterial
    })()
    const disp = { version: 1, width: 16, height: 2, format: 'chars' as const, text: ['HI'.padEnd(16), ' '.repeat(16)], on: true, contrast: 1 }
    const at = (light: number, version: number) => {
      updateComponentVisual(built, comp, entry, tel({ display: { ...disp, version }, sub: { LED_BL: tel({ light }) } }))
      return screen.emissiveIntensity
    }
    const e5 = at(0.25, 2)
    const e20 = at(1, 3)
    expect(e20).toBeGreaterThan(e5)
    expect(e5).toBeCloseTo(0.12 + 0.9 * ledPerceived(0.25), 6)
    expect(at(0, 4)).toBe(0)
    disposeComponentObject(built.object)
  })
})

// ---------------------------------------------------------------------------
// F13: the LED displays (7-segment, TM1637, MAX7219)
// ---------------------------------------------------------------------------

/** a minimal 2D canvas for the shape-following glow (node has no DOM) */
function withFakeCanvas<T>(run: (fills: { n: number }) => T): T {
  const fills = { n: 0 }
  const ctx = {
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '',
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: () => {},
    fill: () => {
      fills.n++
    },
  }
  const g = globalThis as unknown as { document?: unknown }
  const had = 'document' in g
  const prev = g.document
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
  try {
    return run(fills)
  } finally {
    if (had) g.document = prev
    else delete g.document
  }
}

function segmentMats(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && !Array.isArray(m) && m.emissive && (m.emissive.getHex() === 0xff3020 || m.emissive.getHex() === 0x550000)) out.push(m)
  })
  return out
}

describe('glow F13: the LED displays speak the same language', () => {
  const dip = (n: number) => {
    const half = n / 2
    const pins: THREE.Vector3[] = []
    for (let i = 0; i < half; i++) pins.push(v(i, 0, 1.5))
    for (let i = half - 1; i >= 0; i--) pins.push(v(i, 0, -1.5))
    return pins
  }

  it('7-segment: a lit segment is a saturated lens on the LED curve (real light when published, else an honest ON)', () => {
    expect(segmentP(tel({ segments: { a: true, b: false } }), 'a')).toBeCloseTo(ledPerceived(INDICATOR_ON_LIGHT), 9)
    expect(segmentP(tel({ segments: { a: true, b: false } }), 'b')).toBe(0)
    expect(segmentP(null, 'a')).toBe(0)
    // a model that publishes each segment's light (I / 20 mA) is shown as measured
    const measured = { ...tel({ segments: { a: true, b: true } }), segmentLight: { a: 0.5, b: 0.05 } } as ComponentTelemetry
    expect(segmentP(measured, 'a')).toBeCloseTo(ledPerceived(0.5), 9)
    expect(segmentP(measured, 'b')).toBeLessThan(segmentP(measured, 'a'))

    const comp: ComponentInstance = { id: 'DS1', type: 'seven_segment', holes: [] }
    const entry = entryOf('seven_segment')
    const built = buildComponentObject(comp, entry, dip(10))
    updateComponentVisual(built, comp, entry, tel({ segments: { a: true, b: true } }))
    const lit = segmentMats(built.object).filter((m) => m.emissive.getHex() === 0xff3020)
    expect(lit).toHaveLength(2)
    const look = ledLook(ledPerceived(INDICATOR_ON_LIGHT))
    for (const m of lit) {
      expect(m.emissiveIntensity).toBeCloseTo(displayLensIntensity(look), 9)
      // its own light, not a mirror of the studio (the HDRI turned a lit segment pink)
      expect(m.envMapIntensity).toBeLessThan(0.5)
    }
    const unlit = segmentMats(built.object).filter((m) => m.emissive.getHex() === 0x550000)
    expect(unlit.every((m) => m.envMapIntensity === 1 && m.roughness === 0.32)).toBe(true)
    // through ACES the lit segment keeps its red (the old ×1.4 emission read salmon)
    const hue = new THREE.Color(0xff3020)
    const out = (e: number) => aces([hue.r * e, hue.g * e, hue.b * e])
    expect(hsv(out(lit[0].emissiveIntensity)).s).toBeGreaterThan(0.85)
    expect(hsv(out(lit[0].emissiveIntensity)).s).toBeGreaterThan(hsv(out(1.4)).s + 0.05)
    // measured light: the brighter segment glows brighter
    updateComponentVisual(built, comp, entry, measured)
    const [a, b] = segmentMats(built.object).filter((m) => m.emissive.getHex() === 0xff3020)
    expect(Math.max(a.emissiveIntensity, b.emissiveIntensity)).toBeGreaterThan(Math.min(a.emissiveIntensity, b.emissiveIntensity))
    updateComponentVisual(built, comp, entry, null)
    expect(segmentMats(built.object).every((m) => m.emissive.getHex() === 0x550000)).toBe(true)
    disposeComponentObject(built.object)
  })

  it('TM1637 / MAX7219: the programmed brightness drives the emission through the LED curve, step by step', () => {
    const emissionAt = (type: string, t: (k: number) => Partial<ComponentTelemetry>, levels: number[]) => {
      const comp: ComponentInstance = { id: 'D1', type, at: type === 'max7219_8x8' ? 'a20' : 'j20' }
      const entry = entryOf(type)
      const built = buildComponentObject(comp, entry, pinsOf(comp))
      let mat: THREE.MeshPhysicalMaterial | null = null
      built.object.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
        if (m && m.emissiveMap) mat = m
      })
      const m = mat as unknown as THREE.MeshPhysicalMaterial
      // a lit lens drops its specular with its albedo (no pale-pink softbox reflection)
      expect(m.specularIntensityMap).toBe(m.map)
      const out = levels.map((k) => {
        updateComponentVisual(built, comp, entry, tel(t(k)))
        return m.emissiveIntensity
      })
      const emi = (m.emissiveMap as THREE.DataTexture).image.data as Uint8Array
      const lit = Array.from({ length: emi.length / 4 }, (_, i) => emi[i * 4]).filter((x) => x > 0)
      expect(lit.every((x) => x === 255), `${type}: a lit mask`).toBe(true)
      const alb = (m.map as THREE.DataTexture).image.data as Uint8Array
      const litTexel = Array.from({ length: emi.length / 4 }, (_, i) => i).find((i) => emi[i * 4] > 0)!
      expect(alb[litTexel * 4 + 3]).toBe(alb[litTexel * 4])
      disposeComponentObject(built.object)
      return out
    }
    const tm = emissionAt(
      'tm1637_4digit',
      (k) => ({ values: { seg0: 0x3f, seg1: 0x06, seg2: 0x5b, seg3: 0x4f, brightness: k, on: k > 0 ? 1 : 0, version: Math.round(k * 100) } }),
      [1 / 14, 4 / 14, 11 / 14, 1, 0],
    )
    const data = new Uint8Array([0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81])
    const mx = emissionAt(
      'max7219_8x8',
      (k) => ({ display: { version: Math.round(k * 1000) + 1, width: 8, height: 8, format: 'mono-pages', data, on: k > 0, contrast: k } }),
      [1 / 31, 0.25, 1, 2, 0],
    )
    for (const [name, seq] of [['TM1637', tm], ['MAX7219', mx]] as const) {
      // every setting a step up (the top pulse widths differ little — 11/16 vs 14/16 — and so do they here)
      for (let i = 1; i < 4; i++) expect(seq[i], `${name} step ${i}`).toBeGreaterThan(seq[i - 1] + 0.02)
      expect(seq[3] / seq[0], `${name}: lowest → highest`).toBeGreaterThan(1.4)
      expect(seq[0], `${name}: the lowest setting is plainly on`).toBeGreaterThan(0.45)
      expect(seq[3], `${name}: never past the no-salmon bound`).toBeLessThanOrEqual(1.3)
      expect(seq[4], `${name}: off is dark`).toBe(0)
    }
    expect(tm[3]).toBeCloseTo(displayLensIntensity(ledLook(ledPerceived(DISPLAY_FULL_LIGHT))), 9)
  })

  it('the glow follows the lit shapes: on the face, under the overlays, point-bounded, repainted only on change', () => {
    withFakeCanvas((fills) => {
      const glow = makeDisplayGlow({
        x0: 0,
        x1: 4,
        z0: 0,
        z1: 2,
        y: 1,
        shapes: [{ pts: [[0.5, 0.5], [1.5, 0.5], [1.5, 0.8], [0.5, 0.8]] }, { cx: 3, cz: 1, r: 0.3 }],
        color: LED_COLORS.red,
      })
      const mesh = glow.mesh!
      expect(mesh).not.toBeNull()
      const mat = mesh.material as THREE.MeshBasicMaterial
      expect(mat.blending).toBe(THREE.AdditiveBlending)
      expect(mat.depthTest).toBe(true) // on the face: a part in front hides it
      expect(mat.depthWrite).toBe(false)
      expect(mesh.renderOrder).toBe(GLOW_RENDER_ORDER)
      expect(mesh.userData.bbNoStudio).toBe(true)
      const g = new THREE.Group()
      g.add(mesh)
      const box = new THREE.Box3().setFromObject(g)
      expect(box.min.equals(box.max)).toBe(true) // never widens the part
      glow.apply([0, 0], ledPerceived(0.1))
      expect(mesh.visible).toBe(false)
      let last = 0
      for (const mA of [0.5, 2, 5, 20]) {
        const p = pOf(mA)
        glow.apply([1, 0], p)
        expect(mesh.visible).toBe(true)
        // glow2: the drive's own curve (decoupled from the 5 mm LED halo's opacity, see displayGlowOpacity)
        const l = ledLook(p)
        expect(mat.opacity).toBeCloseTo(displayGlowOpacity(l), 9)
        expect(mat.opacity).toBeCloseTo(Math.min(1, (0.32 + 0.5 * l.drive + 0.1 * l.over) * 1.05), 9)
        expect(mat.opacity).toBeGreaterThan(last)
        last = mat.opacity
      }
      const n = fills.n
      glow.apply([1, 0], pOf(20))
      expect(fills.n).toBe(n) // unchanged: no repaint
      glow.apply([1, 1], pOf(20))
      expect(fills.n).toBeGreaterThan(n) // a new lit shape: repainted
      glow.apply([0, 0], pOf(20))
      expect(mesh.visible).toBe(false)
    })
    // headless (no canvas): no plane, nothing to draw
    expect(makeDisplayGlow({ x0: 0, x1: 1, z0: 0, z1: 1, y: 0, shapes: [], color: 0xff0000 }).mesh).toBeNull()
  })
})
