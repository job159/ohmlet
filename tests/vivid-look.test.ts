/**
 * vivid: the 3D realism driven by the parts' own telemetry —
 *  - led-look: the perceptual scale (20 mA ≫ 5 mA ≫ 1 mA ≫ 0.1 mA ≫ 0) and
 *    the 5 mm LED's halo / flare / pool following it; over-drive registers
 *    the flicker animator (not under reduced motion); burnout = charred,
 *    soot + cracks, no light; reset restores;
 *  - resistor: browning from heat 0.8, the red→orange glow from heat 2,
 *    charred + burnt-through gap when burned open; cool = no extra objects;
 *  - electrolytic: the vented top only while the model says vented;
 *  - Blue Pill indicator LEDs on the same scale;
 *  - SceneFx: fresh burn → particles + one 'burn' cue (an old burn: none),
 *    heat smoke / sound-ring emitters follow the telemetry, pin-damage
 *    markers from the latched issues, celebrations spawn (reduced motion:
 *    static glows only), the animator registry drops detached parts.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentInstance, ComponentTelemetry, SimTelemetry } from '../src/model/types'
import { CATALOG } from '../src/model/catalog'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import { ledPerceived, lightOf, P_DARK, PERCEIVED_EXP } from '../src/three/meshes/led-look'
import {
  frameAnimatorCount,
  hasFrameAnimator,
  setFrameAnimator,
  setFxReducedMotion,
  tickFrameAnimators,
} from '../src/three/internal/fx/registry'
import { SceneFx, setFxCueSink, FRESH_DAMAGE_S, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import { emitSceneFx, onSceneFx, sceneFxListenerCount } from '../src/three/internal/fx/bus'
import { pinDamageFromIssues } from '../src/sim/erc/rules-damage'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const tel = (t: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...t })

function named(root: THREE.Object3D, name: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  root.traverse((o) => {
    if (o.name === name && !found) found = o
  })
  expect(found, name).not.toBeNull()
  return found!
}
const opacityOf = (o: THREE.Object3D) => ((o as THREE.Mesh).material as THREE.Material).opacity

afterEach(() => setFxReducedMotion(false))

describe('vivid: the perceptual LED scale', () => {
  it('p = light^0.45: 20 mA dazzling, 5 mA clearly dimmer, 1 mA faint, 0.1 mA barely, 0 dark', () => {
    expect(PERCEIVED_EXP).toBe(0.45)
    const p = (mA: number) => ledPerceived(mA / 20)
    expect(p(20)).toBeCloseTo(1, 6)
    expect(p(5)).toBeGreaterThan(0.5)
    expect(p(5)).toBeLessThan(0.6)
    expect(p(1)).toBeGreaterThan(0.2)
    expect(p(1)).toBeLessThan(0.3)
    expect(p(0.1)).toBeGreaterThan(P_DARK)
    expect(p(0.1)).toBeLessThan(0.12)
    expect(p(0)).toBe(0)
    expect(p(30)).toBeGreaterThan(1) // over-driven reads brighter still
    // each step is plainly different (≥ 2× apart down to 1 mA)
    expect(p(20) / p(5)).toBeGreaterThan(1.8)
    expect(p(5) / p(1)).toBeGreaterThan(2)
  })

  it('lightOf: the model’s light, else ledBrightness (I / 10 mA) / 2', () => {
    expect(lightOf(tel({ light: 0.42, ledBrightness: 1 }))).toBe(0.42)
    expect(lightOf(tel({ ledBrightness: 0.6 }))).toBeCloseTo(0.3, 9)
    expect(lightOf(null)).toBe(0)
  })
})

describe('vivid: 5 mm LED look', () => {
  const entry = CATALOG.led
  const comp: ComponentInstance = { id: 'LED1', type: 'led', holes: ['a10', 'a12'], params: { color: 'red' } }
  const pins = [v(0, 0, 0), v(2, 0, 0)]

  it('halo, flare and pool follow the real current; dark at 0', () => {
    const built = buildComponentObject(comp, entry, pins)
    const halo = named(built.object, 'led-halo')
    const flare = named(built.object, 'led-flare')
    const pool = named(built.object, 'led-pool')
    const look: Record<number, { halo: number; scale: number; pool: number; flare: boolean }> = {}
    for (const mA of [20, 10, 5, 1, 0.1]) {
      updateComponentVisual(built, comp, entry, tel({ light: mA / 20 }))
      expect(halo.visible, `${mA} mA`).toBe(true)
      look[mA] = { halo: opacityOf(halo), scale: halo.scale.x, pool: opacityOf(pool), flare: flare.visible }
    }
    // glow: the star flare marks BRIGHT (10 mA) and dazzling (20 mA); a
    // 5 mA GPIO LED reads clearly lit through its halo, without the star
    expect(look[20].flare).toBe(true) // the dazzling star flare
    expect(look[10].flare).toBe(true)
    expect(look[5].flare).toBe(false)
    expect(look[1].flare).toBe(false)
    for (const [hi, lo] of [
      [20, 10],
      [10, 5],
      [5, 1],
      [1, 0.1],
    ]) {
      expect(look[hi].halo).toBeGreaterThan(look[lo].halo)
      expect(look[hi].scale).toBeGreaterThan(look[lo].scale)
      expect(look[hi].pool).toBeGreaterThan(look[lo].pool)
    }
    updateComponentVisual(built, comp, entry, tel({ light: 0 }))
    expect(halo.visible).toBe(false)
    expect(flare.visible).toBe(false)
    expect(pool.visible).toBe(false)
    // the light never takes part in picking (the legacy pick proxy stays the only sprite that can)
    const hits: THREE.Intersection[] = []
    const rc = new THREE.Raycaster(v(0, 10, 0), v(0, -1, 0))
    rc.camera = new THREE.PerspectiveCamera()
    for (const o of [halo, flare, pool]) o.raycast(rc, hits)
    expect(hits).toHaveLength(0)
    disposeComponentObject(built.object)
  })

  it('over-driven (> 20 mA): the warning flicker animator runs; reduced motion: none', () => {
    const built = buildComponentObject(comp, entry, pins)
    const scene = new THREE.Scene()
    scene.add(built.object)
    updateComponentVisual(built, comp, entry, tel({ light: 1.3 }))
    expect(hasFrameAnimator(built.object)).toBe(true)
    const halo = named(built.object, 'led-halo')
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) {
      tickFrameAnimators(i * 0.031, 0.016)
      seen.add(Math.round(opacityOf(halo) * 1000))
    }
    expect(seen.size).toBeGreaterThan(3) // it really flickers
    updateComponentVisual(built, comp, entry, tel({ light: 0.8 }))
    expect(hasFrameAnimator(built.object)).toBe(false)
    setFxReducedMotion(true)
    updateComponentVisual(built, comp, entry, tel({ light: 1.3 }))
    expect(hasFrameAnimator(built.object)).toBe(false)
    disposeComponentObject(built.object)
  })

  it('burned: charred, soot + cracks, no light; reset restores', () => {
    const built = buildComponentObject(comp, entry, pins)
    const halo = named(built.object, 'led-halo')
    updateComponentVisual(built, comp, entry, tel({ light: 0, burned: true, damage: { kind: 'burned', since: 0.001 } }))
    let soot = 0
    let cracks = 0
    built.object.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && ((o as THREE.Sprite).material.color.getHex() === 0) && o.visible) soot++
      if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).geometry as THREE.BufferGeometry).getAttribute('position')?.count > 0 && o.visible && ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color?.getHex?.() === 0x0a0806) cracks++
    })
    expect(soot).toBe(1)
    expect(cracks).toBe(1)
    expect(halo.visible).toBe(false)
    updateComponentVisual(built, comp, entry, tel({ light: 0.5 }))
    let visibleDark = 0
    built.object.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && (o as THREE.Sprite).material.color.getHex() === 0 && o.visible) visibleDark++
    })
    expect(visibleDark).toBe(0)
    expect(halo.visible).toBe(true)
    disposeComponentObject(built.object)
  })
})

describe('vivid: resistor heat / burn and the vented electrolytic', () => {
  it('cool = no extra objects; browning from 0.8; glow from 2; burned = charred + gap', () => {
    const comp: ComponentInstance = { id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 10 } }
    const built = buildComponentObject(comp, CATALOG.resistor, [v(0, 0, 0), v(4, 0, 0)])
    const count = () => {
      let n = 0
      built.object.traverse(() => n++)
      return n
    }
    const n0 = count()
    updateComponentVisual(built, comp, CATALOG.resistor, tel({ current: 0.01 }))
    expect(count()).toBe(n0)
    updateComponentVisual(built, comp, CATALOG.resistor, tel({ heat: 1.5, damage: { kind: 'overheating', since: 1 } }))
    const char = named(built.object, 'res-char')
    expect(char.visible).toBe(true)
    expect(opacityOf(char)).toBeGreaterThan(0.1)
    expect(built.object.getObjectByName('res-glow')).toBeUndefined() // hot, not yet glowing
    updateComponentVisual(built, comp, CATALOG.resistor, tel({ heat: 3.5, damage: { kind: 'overheating', since: 1 } }))
    const glow = named(built.object, 'res-glow')
    expect(glow.visible).toBe(true)
    const c35 = ((glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.clone()
    updateComponentVisual(built, comp, CATALOG.resistor, tel({ heat: 2.1, damage: { kind: 'overheating', since: 1 } }))
    const c21 = ((glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.clone()
    expect(c35.g).toBeGreaterThan(c21.g) // hotter → more orange-yellow
    updateComponentVisual(built, comp, CATALOG.resistor, tel({ damage: { kind: 'burned', since: 1.5 } }))
    expect(glow.visible).toBe(false)
    expect(opacityOf(char)).toBe(1)
    expect(named(built.object, 'res-gap').visible).toBe(true)
    updateComponentVisual(built, comp, CATALOG.resistor, null)
    expect(char.visible).toBe(false)
    expect(named(built.object, 'res-gap').visible).toBe(false)
    disposeComponentObject(built.object)
  })

  it('electrolytic: the vented top only while vented', () => {
    const comp: ComponentInstance = { id: 'C1', type: 'capacitor', holes: ['a10', 'a12'], params: { capacitance: 1e-4, polarized: true } }
    const built = buildComponentObject(comp, CATALOG.capacitor, [v(0, 0, 0), v(2, 0, 0)])
    updateComponentVisual(built, comp, CATALOG.capacitor, tel({}))
    expect(built.object.getObjectByName('cap-vented')).toBeUndefined()
    updateComponentVisual(built, comp, CATALOG.capacitor, tel({ damage: { kind: 'vented', since: 1 } }))
    expect(named(built.object, 'cap-vented').visible).toBe(true)
    updateComponentVisual(built, comp, CATALOG.capacitor, null)
    expect(named(built.object, 'cap-vented').visible).toBe(false)
    disposeComponentObject(built.object)
  })
})

// ---------------------------------------------------------------------------
// SceneFx
// ---------------------------------------------------------------------------

function fxHost(ids: string[]): SceneFxHost {
  return {
    bounds: (id, out) => {
      const i = ids.indexOf(id)
      if (i < 0) return false
      out.set(v(i * 3, 0, 0), v(i * 3 + 1, 1, 1))
      return true
    },
    pinWorld: (id, pin) => (ids.includes(id) && pin === 'PA0' ? v(5, 0, 5) : null),
    ids: () => ids,
  }
}
const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
const renderer = { getDrawingBufferSize: (t: THREE.Vector2) => t.set(800, 600) } as unknown as THREE.WebGLRenderer
const snap = (time: number, components: Record<string, ComponentTelemetry>, issues: SimTelemetry['issues'] = []): SimTelemetry => ({
  time,
  netVoltages: {},
  components,
  issues,
})

describe('vivid: SceneFx', () => {
  afterEach(() => setFxCueSink(null))

  it('a fresh burn: particles + ONE burn cue; an old burn (rebuilt / re-seen): nothing', () => {
    const cues: string[] = []
    setFxCueSink((c) => cues.push(c))
    const fx = new SceneFx(fxHost(['LED1', 'LED2']), false)
    fx.setTelemetry(snap(0.002, { LED1: tel({ burned: true, damage: { kind: 'burned', since: 0.001 } }) }))
    expect(cues).toEqual(['burn'])
    expect(fx.particleCount).toBeGreaterThan(10)
    expect(fx.emitterCount).toBe(1) // the thin smoke trail
    // the same damage again (next frame): no second pop
    fx.setTelemetry(snap(0.004, { LED1: tel({ burned: true, damage: { kind: 'burned', since: 0.001 } }) }))
    expect(cues).toEqual(['burn'])
    // a part already burned long ago when first seen (rebuild): no pop
    const fx2 = new SceneFx(fxHost(['LED1']), false)
    fx2.setTelemetry(snap(5, { LED1: tel({ burned: true, damage: { kind: 'burned', since: 5 - FRESH_DAMAGE_S - 0.5 } }) }))
    expect(cues).toEqual(['burn'])
    expect(fx2.particleCount).toBe(0)
    // particles live, then die out
    for (let i = 0; i < 660; i++) fx.tick(i / 60, 1 / 60, cam, renderer) // the 7 s trail + its last particles
    expect(fx.particleCount).toBe(0)
    expect(fx.emitterCount).toBe(0)
    fx.dispose()
    fx2.dispose()
  })

  it('heat smoke and buzzer rings follow the telemetry; session end clears everything', () => {
    const fx = new SceneFx(fxHost(['R1', 'BZ1']), false)
    fx.setTelemetry(snap(1, { R1: tel({ heat: 0.7 }), BZ1: tel({ sounding: false }) }))
    expect(fx.emitterCount).toBe(0)
    fx.setTelemetry(snap(2, { R1: tel({ heat: 2.4, damage: { kind: 'overheating', since: 1.2 } }), BZ1: tel({ sounding: true }) }))
    expect(fx.emitterCount).toBe(2)
    for (let i = 0; i < 30; i++) fx.tick(i / 60, 1 / 60, cam, renderer)
    expect(fx.particleCount).toBeGreaterThan(0)
    fx.setTelemetry(snap(3, { R1: tel({ heat: 0.6 }), BZ1: tel({ sounding: false }) }))
    expect(fx.emitterCount).toBe(0)
    fx.setTelemetry(snap(4, { R1: tel({ heat: 2.4 }) }))
    expect(fx.emitterCount).toBe(1)
    fx.setTelemetry(null)
    expect(fx.emitterCount).toBe(0)
    fx.dispose()
  })

  it('reduced motion: a burn shows static glows only (no sparks, no trail particles)', () => {
    const fx = new SceneFx(fxHost(['LED1']), true)
    fx.setTelemetry(snap(0.002, { LED1: tel({ burned: true, damage: { kind: 'burned', since: 0.001 } }) }))
    expect(fx.particleCount).toBe(2)
    const before = fx.particleCount
    for (let i = 0; i < 60; i++) fx.tick(i / 60, 1 / 60, cam, renderer)
    expect(fx.particleCount).toBeLessThanOrEqual(before) // the trail emits nothing
    fx.dispose()
  })

  it('pin damage markers from the latched issues (plausible measurements only)', () => {
    const fx = new SceneFx(fxHost(['U1']), false)
    const over = { level: 'warning' as const, message: 'U1 PA0: 5.20 V exceeds VDD + 0.3 V (3.60 V) — PA0 is not 5 V tolerant' }
    fx.setTelemetry(snap(1, { U1: tel({}) }, [over]))
    expect(fx.markerCount).toBe(1)
    fx.setTelemetry(snap(2, { U1: tel({}) }, [over, { level: 'warning', message: 'U1 PB12: -1261957.64 V is below VSS − 0.3 V' }]))
    expect(fx.markerCount).toBe(1) // a solver garbage reading is not a measurement
    fx.setTelemetry(null)
    expect(fx.markerCount).toBe(0)
    expect(pinDamageFromIssues([over])).toEqual([{ componentId: 'U1', pin: 'PA0', kind: 'overvoltage', measured: '5.20 V' }])
    expect(
      pinDamageFromIssues([{ level: 'warning', message: 'U1 PA5: driver sources 41.3 mA (> 25 mA) — short circuit or missing series resistor' }]),
    ).toEqual([{ componentId: 'U1', pin: 'PA5', kind: 'overcurrent', measured: '41.3 mA' }])
    fx.dispose()
  })

  it('celebrations: confetti + sparkles for a lesson, sparkles for a working circuit; the bus reaches mounted layers only', () => {
    const fx = new SceneFx(fxHost(['LED1', 'R1']), false)
    const off = onSceneFx((e) => fx.handle(e))
    expect(sceneFxListenerCount()).toBeGreaterThanOrEqual(1)
    emitSceneFx({ type: 'celebrate', kind: 'circuit-ok', componentIds: ['LED1'] })
    const sparkles = fx.particleCount
    expect(sparkles).toBeGreaterThan(3)
    emitSceneFx({ type: 'celebrate', kind: 'lesson-pass', componentIds: [] })
    expect(fx.particleCount - sparkles).toBeGreaterThan(100) // confetti
    off()
    const n = fx.particleCount
    emitSceneFx({ type: 'celebrate', kind: 'circuit-ok', componentIds: ['LED1'] })
    expect(fx.particleCount).toBe(n)
    const calm = new SceneFx(fxHost(['LED1', 'R1']), true)
    calm.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [] })
    expect(calm.particleCount).toBeLessThanOrEqual(3) // one glow + a still star per part
    fx.dispose()
    calm.dispose()
  })

  it('the animator registry runs attached parts and drops detached ones', () => {
    const scene = new THREE.Scene()
    const a = new THREE.Group()
    const b = new THREE.Group()
    scene.add(a)
    let ran = 0
    setFrameAnimator(a, () => ran++)
    setFrameAnimator(b, () => ran++)
    tickFrameAnimators(0, 0.016)
    expect(ran).toBe(1)
    expect(hasFrameAnimator(b)).toBe(false)
    scene.remove(a)
    tickFrameAnimators(0.016, 0.016)
    expect(ran).toBe(1)
    expect(hasFrameAnimator(a)).toBe(false)
    expect(frameAnimatorCount()).toBe(0)
  })
})
