/**
 * cheer: the lesson-pass confetti reads as a celebration, not pixel noise —
 *  - tumbling paper quads: 11–16 CSS px sprites (the quad 9–13 px long) at
 *    any zoom (negative = pixel sizes), gravity, a roll in the view plane and
 *    a flutter, opaque until the last 30 % of a 1–1.5 s life;
 *  - a crisp ring per burst, no big blurry halo;
 *  - bursting from the working parts, never from behind the 「完成！」 badge
 *    (the event's `avoid` rect, projected through the last rendered camera);
 *    the rect is the badge's REAL layout box, measured one frame after it
 *    goes up (not a 288 px guess that skipped visible parts);
 *  - from the visible parts only: points on the circuit's rim (bare wood,
 *    empty holes) stand in only when the badge hides every part;
 *  - reduced motion: a still glow per visible part, nothing that moves.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { onSceneFx, type SceneFxEvent } from '../src/three/internal/fx/bus'
import { ParticleSystem, SHAPE_CRISP_RING, SHAPE_FLAKE, SHAPE_RING } from '../src/three/internal/fx/particles'
import { SceneFx, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import { __resetCelebrationForTests, __setCelebrationsSuppressedForTests, badgeRect, celebrate, useCelebration } from '../src/ui/fx/celebrate'

type Pool = { live: number; pos: Float32Array; vel: Float32Array; size: Float32Array; s0: Float32Array; baseShape: Float32Array; grav: Float32Array; life: Float32Array; roll: Float32Array; spin: Float32Array; color: Float32Array; rot: Float32Array }
const pools = (fx: SceneFx) => {
  const f = fx as unknown as { soft: Pool; glow: Pool }
  return { soft: f.soft, glow: f.glow }
}

function host(parts: Record<string, [number, number]>): SceneFxHost {
  return {
    bounds: (id, out) => {
      const p = parts[id]
      if (!p) return false
      out.set(new THREE.Vector3(p[0] - 0.5, 0, p[1] - 0.5), new THREE.Vector3(p[0] + 0.5, 1, p[1] + 0.5))
      return true
    },
    pinWorld: () => null,
    ids: () => Object.keys(parts),
  }
}

/** a camera over the origin and a renderer whose 800×600 canvas starts at the page's top-left */
function view() {
  const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000)
  cam.position.set(0, 30, 30)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  const dom = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
    contains: () => true,
  }
  const renderer = {
    getDrawingBufferSize: (t: THREE.Vector2) => t.set(800, 600),
    getPixelRatio: () => 1,
    domElement: dom,
  } as unknown as THREE.WebGLRenderer
  return { cam, renderer }
}

const screen = (cam: THREE.PerspectiveCamera, x: number, y: number, z: number) => {
  const v = new THREE.Vector3(x, y, z).project(cam)
  return { x: ((v.x + 1) / 2) * 800, y: ((1 - v.y) / 2) * 600 }
}

describe('cheer: particles', () => {
  it('negative sizes are CSS pixels; a held quad stays opaque until its last fade-out share; it rolls', () => {
    const ps = new ParticleSystem(8, THREE.NormalBlending)
    ps.spawn({ x: 0, y: 0, z: 0, life: 1, size0: -12, r: 1, g: 0, b: 0, alpha: 1, shape: SHAPE_FLAKE + 0.5, spin: 8, roll: 4, rot: 0, fadeIn: 0.02, fadeOut: 0.3 })
    const p = ps as unknown as Pool
    for (let i = 0; i < 30; i++) ps.update(1 / 60, i / 60) // half a second in
    expect(p.size[0]).toBe(-12)
    expect(p.color[3]).toBeCloseTo(1, 5) // still fully opaque at 50 % of its life
    expect(p.rot[0]).toBeGreaterThan(1.5) // rolled ≈ 2 rad
    for (let i = 0; i < 24; i++) ps.update(1 / 60, 0.5 + i / 60) // 90 % of its life
    expect(p.color[3]).toBeGreaterThan(0.2)
    expect(p.color[3]).toBeLessThan(0.5)
    ps.dispose()
  })
})

describe('cheer: lesson-pass confetti', () => {
  it('tumbling 11–16 px quads with gravity and roll, a crisp ring per burst, no blurry halo; gone after 1.5 s', () => {
    const fx = new SceneFx(host({ LED1: [0, 0], R1: [4, 0] }), false)
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [] })
    const { soft, glow } = pools(fx)
    const quads: number[] = []
    let rings = 0
    for (let i = 0; i < soft.live; i++) {
      const sh = soft.baseShape[i]
      if (sh >= SHAPE_FLAKE && sh < SHAPE_FLAKE + 1) {
        quads.push(i)
        expect(-soft.s0[i]).toBeGreaterThanOrEqual(11)
        expect(-soft.s0[i]).toBeLessThanOrEqual(16)
        expect(soft.grav[i]).toBeGreaterThan(5)
        expect(soft.life[i]).toBeGreaterThanOrEqual(1)
        expect(soft.life[i]).toBeLessThanOrEqual(1.5)
        expect(Math.abs(soft.roll[i]) + soft.spin[i]).toBeGreaterThan(0)
      } else if (sh === SHAPE_CRISP_RING) rings++
    }
    expect(quads.length).toBeGreaterThanOrEqual(100)
    expect(rings).toBe(2) // one per burst
    for (let i = 0; i < glow.live; i++) expect(glow.baseShape[i]).not.toBe(SHAPE_RING) // the old soft halo ring is gone
    const { cam, renderer } = view()
    for (let i = 0; i < 96; i++) fx.tick(i / 60, 1 / 60, cam, renderer)
    expect(fx.particleCount).toBe(0)
    fx.dispose()
  })

  it('never bursts from behind the badge: a part the badge hides gives way to clear parts / the circuit’s rim', () => {
    const fx = new SceneFx(host({ LED1: [-8, 0], R1: [8, 0] }), false)
    const { cam, renderer } = view()
    fx.tick(0, 1 / 60, cam, renderer) // the first frame: the layer knows its camera and canvas
    const led = screen(cam, -8, 1.1, 0)
    expect(led.x).toBeLessThan(400) // LED1 is on the left half
    const avoid = { x0: 0, y0: 0, x1: 400, y1: 600 } // the badge over the left half
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [], avoid })
    const { soft } = pools(fx)
    let n = 0
    for (let i = 0; i < soft.live; i++) {
      if (!(soft.baseShape[i] >= SHAPE_FLAKE && soft.baseShape[i] < SHAPE_FLAKE + 1)) continue
      const q = screen(cam, soft.pos[i * 3], soft.pos[i * 3 + 1], soft.pos[i * 3 + 2])
      expect(q.x).toBeGreaterThan(avoid.x1) // born right of the badge
      n++
    }
    expect(n).toBeGreaterThanOrEqual(100)
    fx.dispose()
  })

  it('bursts from the visible working parts only — no fountain from bare wood / empty holes while a part is in view', () => {
    // three parts; the badge hides LED1 only: every quad is born at R1 or PS1, none on the circuit's rim
    const parts: Record<string, [number, number]> = { LED1: [-8, -6], R1: [6, 0], PS1: [-2, 6] }
    const fx = new SceneFx(host(parts), false)
    const { cam, renderer } = view()
    fx.tick(0, 1 / 60, cam, renderer)
    const led = screen(cam, -8, 1.1, -6)
    const avoid = { x0: led.x - 40, y0: led.y - 40, x1: led.x + 40, y1: led.y + 40 }
    for (const id of ['R1', 'PS1']) {
      const p = screen(cam, parts[id][0], 1.1, parts[id][1])
      expect(p.x < avoid.x0 - 28 || p.x > avoid.x1 + 28 || p.y < avoid.y0 - 28 || p.y > avoid.y1 + 28).toBe(true) // clear of it
    }
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: ['LED1', 'R1', 'PS1'], avoid })
    const { soft } = pools(fx)
    const near = { R1: 0, PS1: 0 }
    let n = 0
    let rings = 0
    for (let i = 0; i < soft.live; i++) {
      const sh = soft.baseShape[i]
      if (sh === SHAPE_CRISP_RING) rings++
      if (!(sh >= SHAPE_FLAKE && sh < SHAPE_FLAKE + 1)) continue
      n++
      const x = soft.pos[i * 3]
      const z = soft.pos[i * 3 + 2]
      const at = (Object.keys(near) as (keyof typeof near)[]).find((id) => Math.hypot(x - parts[id][0], z - parts[id][1]) < 0.3)
      expect(at, `quad born at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeDefined()
      near[at!]++
    }
    expect(rings).toBe(2) // one per visible part
    expect(n).toBeGreaterThanOrEqual(100)
    expect(near.R1).toBeGreaterThanOrEqual(40)
    expect(near.PS1).toBeGreaterThanOrEqual(40)
    fx.dispose()
  })

  it('only when the badge hides EVERY part do points on the circuit’s rim stand in (clear of the badge)', () => {
    // a wide board (its top centre under the badge) and an LED on it: both hidden, the board's edges in view
    const wide: SceneFxHost = {
      bounds: (id, out) => {
        if (id === 'BB1') out.set(new THREE.Vector3(-10, 0, -3), new THREE.Vector3(10, 1, 3))
        else if (id === 'LED1') out.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
        else return false
        return true
      },
      pinWorld: () => null,
      ids: () => ['BB1', 'LED1'],
    }
    const fx = new SceneFx(wide, false)
    const { cam, renderer } = view()
    fx.tick(0, 1 / 60, cam, renderer)
    const c = screen(cam, 0, 1.1, 0)
    const avoid = { x0: c.x - 60, y0: c.y - 40, x1: c.x + 60, y1: c.y + 40 } // over both parts' tops
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [], avoid })
    const { soft } = pools(fx)
    let n = 0
    for (let i = 0; i < soft.live; i++) {
      if (!(soft.baseShape[i] >= SHAPE_FLAKE && soft.baseShape[i] < SHAPE_FLAKE + 1)) continue
      const q = screen(cam, soft.pos[i * 3], soft.pos[i * 3 + 1], soft.pos[i * 3 + 2])
      expect(q.x < avoid.x0 || q.x > avoid.x1 || q.y < avoid.y0 || q.y > avoid.y1).toBe(true)
      n++
    }
    expect(n).toBeGreaterThanOrEqual(100)
    fx.dispose()
  })

  it('reduced motion: the still glow marks the visible parts only — never a rim point', () => {
    const parts: Record<string, [number, number]> = { LED1: [-8, -6], R1: [6, 0], PS1: [-2, 6] }
    const fx = new SceneFx(host(parts), true)
    const { cam, renderer } = view()
    fx.tick(0, 1 / 60, cam, renderer)
    const led = screen(cam, -8, 1.1, -6)
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [], avoid: { x0: led.x - 40, y0: led.y - 40, x1: led.x + 40, y1: led.y + 40 } })
    const { soft, glow } = pools(fx)
    expect(fx.particleCount).toBe(2) // R1 and PS1
    for (const pool of [soft, glow]) {
      for (let i = 0; i < pool.live; i++) {
        const x = pool.pos[i * 3]
        const z = pool.pos[i * 3 + 2]
        expect(['R1', 'PS1'].some((id) => Math.hypot(x - parts[id][0], z - parts[id][1]) < 1e-6)).toBe(true)
      }
    }
    fx.dispose()
  })

  it('reduced motion: one still glow per part — no quad, no ring, nothing moves', () => {
    const fx = new SceneFx(host({ LED1: [0, 0], R1: [4, 0] }), true)
    fx.handle({ type: 'celebrate', kind: 'lesson-pass', componentIds: [] })
    const { soft, glow } = pools(fx)
    expect(fx.particleCount).toBe(2)
    for (const pool of [soft, glow]) {
      for (let i = 0; i < pool.live; i++) {
        expect(pool.baseShape[i] >= SHAPE_FLAKE && pool.baseShape[i] < SHAPE_FLAKE + 1).toBe(false)
        expect(pool.baseShape[i]).not.toBe(SHAPE_CRISP_RING)
        expect(Math.hypot(pool.vel[i * 3], pool.vel[i * 3 + 1], pool.vel[i * 3 + 2])).toBe(0)
        expect(pool.grav[i]).toBe(0)
      }
    }
    fx.dispose()
  })
})

describe('cheer: the burst is aimed with the badge’s real box', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetCelebrationForTests()
  })

  function page(badge: { left: number; top: number; width: number; height: number } | null) {
    const frames: (() => void)[] = []
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, requestAnimationFrame: (cb: () => void) => (frames.push(cb), frames.length) })
    const el = badge && {
      offsetParent: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      offsetLeft: badge.left,
      offsetTop: badge.top,
      offsetWidth: badge.width,
      offsetHeight: badge.height,
    }
    vi.stubGlobal('document', { hidden: false, querySelector: (sel: string) => (sel === '.fx-cele-badge' ? el : null) })
    return frames
  }

  it('the 3D burst waits one frame for the badge, then avoids its measured layout box (176 px tall, not a 288 px guess)', () => {
    __setLangForTests('zh-TW')
    __resetCelebrationForTests()
    __setCelebrationsSuppressedForTests(false)
    const frames = page({ left: 563, top: 64, width: 314, height: 176 })
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('lesson-pass', { componentIds: ['LED1', 'R1'], message: '「LED 與限流電阻」驗收 6 項全部通過' })
    expect(useCelebration.getState().badge?.title).toBe('完成！') // the badge goes up first …
    expect(events).toHaveLength(0) // … the burst waits for it to be on the page
    for (const f of frames.splice(0)) f()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'lesson-pass', componentIds: ['LED1', 'R1'], avoid: { x0: 563, y0: 64, x1: 877, y1: 240 } })
    off()
  })

  it('no badge on the page to measure: the fx.css estimate (one or two message lines), never the old 288 px', () => {
    __setLangForTests('zh-TW')
    __resetCelebrationForTests()
    __setCelebrationsSuppressedForTests(false)
    const frames = page(null)
    const est = badgeRect()!
    expect(est.y1 - est.y0).toBeGreaterThanOrEqual(176)
    expect(est.y1 - est.y0).toBeLessThanOrEqual(200)
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('lesson-pass', { componentIds: ['LED1'] })
    for (const f of frames.splice(0)) f()
    expect(events[0]?.avoid).toEqual(est)
    off()
  })

  it('circuit-ok (a toast, no badge) fires at once and avoids nothing', () => {
    __setLangForTests('zh-TW')
    __resetCelebrationForTests()
    __setCelebrationsSuppressedForTests(false)
    page({ left: 563, top: 64, width: 314, height: 176 })
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('circuit-ok', { componentIds: ['LED1'], message: 'LED1 亮了' })
    expect(events).toHaveLength(1)
    expect(events[0].avoid).toBeUndefined()
    off()
  })
})
