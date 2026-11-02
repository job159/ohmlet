/**
 * 顯示電流 — the 3D current-flow layer (src/three/internal/current-flow.ts):
 * perceptual scale, direction from the sign, nothing without current or
 * with unknown currents, frozen while the simulation is paused, static
 * comet tails under reduced motion, the pooled-point cap, and the
 * preference store (src/ui/fx/flow.ts) driving the simulation's tracking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { bodyTopOf, CurrentFlowLayer, FLOW_RGB, flowColor, flowGap, flowLevel, flowSpeed, MIN_SHOWN_A } from '../src/three/internal/current-flow'
import type { RoutedComponent } from '../src/three/internal/wire-router'
import type { SimTelemetry } from '../src/model/types'
import { currentTrackingDefault, registerTrackingTarget } from '../src/sim/coordinator/tracking'
import { useFlowView } from '../src/ui/fx/flow'

function tele(time: number, extra: Partial<SimTelemetry> = {}): SimTelemetry {
  return { time, netVoltages: {}, components: {}, issues: [], ...extra }
}

function heads(layer: CurrentFlowLayer): number {
  return layer.getStats().heads
}

/** x of the first drawn point (a head) */
function firstX(layer: CurrentFlowLayer): number {
  return (layer.object.geometry.getAttribute('position').array as Float32Array)[0]
}

let clock = 1000
afterEach(() => {
  vi.restoreAllMocks()
})
function useClock() {
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  // each wire's particle phase is seeded from Math.random(); a phase near the
  // wire's start can wrap within one tick and flip the direction sign
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
}

function wireLayer(current: number | undefined, reduced = false): CurrentFlowLayer {
  const layer = new CurrentFlowLayer({ reducedMotion: reduced })
  layer.setWirePath('w1', new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0), null)
  layer.setWanted(true)
  layer.setTelemetry(tele(0.1, current === undefined ? {} : { wireCurrents: { w1: current } }))
  return layer
}

describe('perceptual scale (log, 10 µA … 200 mA)', () => {
  it('0.5 mA and 20 mA look clearly different: speed and spacing (F15: ONE colour, never red)', () => {
    expect(flowLevel(1e-5)).toBe(0)
    expect(flowLevel(0.2)).toBe(1)
    expect(flowLevel(2)).toBe(1)
    const lo = 0.5e-3
    const hi = 20e-3
    expect(flowSpeed(hi) / flowSpeed(lo)).toBeGreaterThan(1.6)
    expect(flowGap(lo) / flowGap(hi)).toBeGreaterThan(1.3)
    // one hue at every current: magnitude is speed and density only
    const a = { r: 0, g: 0, b: 0 }
    const b = { r: 0, g: 0, b: 0 }
    flowColor(flowLevel(lo), a)
    flowColor(flowLevel(hi), b)
    expect(a).toEqual(b)
    flowColor(1, b)
    expect(a).toEqual(b)
    // not red (red = supply wire / damage): a blue-green hue, bright
    expect(FLOW_RGB.r).toBeLessThan(0.3)
    expect(FLOW_RGB.g).toBeGreaterThan(0.7)
    expect(FLOW_RGB.b).toBeGreaterThan(0.7)
    // monotonic speed over the whole range
    let prev = 0
    for (let e = -5; e <= -0.7; e += 0.1) {
      const s = flowSpeed(10 ** e)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })
})

describe('particles follow the real currents', () => {
  it('no current, a sub-threshold leak or an unknown current → no particles', () => {
    useClock()
    for (const i of [0, MIN_SHOWN_A / 10, undefined]) {
      const layer = wireLayer(i)
      for (let k = 0; k < 5; k++) layer.tick(0.016)
      expect(heads(layer), String(i)).toBe(0)
      expect(layer.object.visible).toBe(false)
    }
  })

  it('direction = the sign of the current (from → to when positive)', () => {
    useClock()
    for (const [i, sign] of [
      [0.01, 1],
      [-0.01, -1],
    ] as const) {
      const layer = wireLayer(i)
      layer.tick(0.016)
      const x0 = firstX(layer)
      clock += 16
      layer.tick(0.016)
      const x1 = firstX(layer)
      const dx = x1 - x0
      expect(Math.sign(dx), `I = ${i}`).toBe(sign)
      expect(Math.abs(dx)).toBeCloseTo(flowSpeed(0.01) * 0.016, 3)
      // every point lies on the wire
      const pos = layer.object.geometry.getAttribute('position').array as Float32Array
      for (let p = 0; p < layer.getStats().points; p++) {
        expect(pos[p * 3 + 1]).toBe(0)
        expect(pos[p * 3]).toBeGreaterThanOrEqual(0)
        expect(pos[p * 3]).toBeLessThanOrEqual(20)
      }
    }
  })

  it('more current → more and faster particles', () => {
    useClock()
    const small = wireLayer(0.5e-3)
    const big = wireLayer(20e-3)
    small.tick(0.016)
    big.tick(0.016)
    expect(heads(big)).toBeGreaterThan(heads(small))
  })

  it('a paused simulation (time stops advancing) freezes the particles in place', () => {
    useClock()
    const layer = wireLayer(0.01)
    layer.tick(0.016)
    clock += 1000 // no new telemetry for a second: paused
    layer.tick(0.016)
    const x0 = firstX(layer)
    clock += 16
    layer.tick(0.016)
    expect(firstX(layer)).toBe(x0)
    expect(heads(layer)).toBeGreaterThan(0) // still shown, just not moving
    // the simulation runs again
    layer.setTelemetry(tele(0.2, { wireCurrents: { w1: 0.01 } }))
    clock += 16
    layer.tick(0.016)
    expect(firstX(layer)).not.toBe(x0)
  })

  it('reduced motion: particles stand still, each head keeps a tail behind it', () => {
    useClock()
    const layer = wireLayer(0.01, true)
    layer.tick(0.016)
    const x0 = firstX(layer)
    clock += 16
    layer.tick(0.016)
    expect(firstX(layer)).toBe(x0)
    const st = layer.getStats()
    expect(st.points).toBeGreaterThan(st.heads * 2) // head + tail points
  })

  it('a 2-terminal part: current through its body follows pinCurrents of pin 0', () => {
    useClock()
    const layer = new CurrentFlowLayer({ reducedMotion: false })
    layer.setPartPath('D1', ['anode', 'cathode'], new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0), 1)
    layer.setWanted(true)
    layer.setTelemetry(tele(0.1, { wireCurrents: {}, components: { D1: { pinVoltages: {}, pinCurrents: { anode: 0.008, cathode: -0.008 } } } }))
    layer.tick(0.016)
    expect(heads(layer)).toBeGreaterThan(0)
    // the path rises over the body (y above the part top)
    const pos = layer.object.geometry.getAttribute('position').array as Float32Array
    let maxY = 0
    for (let p = 0; p < layer.getStats().points; p++) maxY = Math.max(maxY, pos[p * 3 + 1])
    expect(maxY).toBeGreaterThan(1)
  })

  it('F10: a routed part — particles go up its legs and over its body, never a box through the air', () => {
    useClock()
    const layer = new CurrentFlowLayer({ reducedMotion: false })
    // pin 0 at x = 0, pin 1 at x = 4; each lead rises out of its hole and
    // bends inward to the body ends at x = 1 / x = 3, y = 1 (body top 1.3)
    const routed: RoutedComponent = {
      pose: 'span',
      bodyCenter: { x: 2, y: 1, z: 0 },
      bodyDir: { x: 1, y: 0, z: 0 },
      waypoints: [
        [
          { x: 0, y: -0.18, z: 0 },
          { x: 0, y: 0.5, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        [
          { x: 4, y: -0.18, z: 0 },
          { x: 4, y: 0.5, z: 0 },
          { x: 3, y: 1, z: 0 },
        ],
      ],
    }
    layer.setPartPath('R1', ['p1', 'p2'], new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0), 1.3, routed)
    layer.setWanted(true)
    layer.setTelemetry(tele(0.1, { wireCurrents: {}, components: { R1: { pinVoltages: {}, pinCurrents: { p1: 0.02, p2: -0.02 } } } }))
    const route = [
      [0, 0],
      [0, 0.5],
      [1, 1],
      [1, 1.4],
      [3, 1.4],
      [3, 1],
      [4, 0.5],
      [4, 0],
    ] // (x, y) in the z = 0 plane: hole → leg → over the body → leg → hole
    const distToRoute = (x: number, y: number) => {
      let best = Infinity
      for (let i = 1; i < route.length; i++) {
        const [ax, ay] = route[i - 1]
        const [bx, by] = route[i]
        const dx = bx - ax
        const dy = by - ay
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
      }
      return best
    }
    let seen = 0
    let overBody = 0
    for (let f = 0; f < 30; f++) {
      clock += 16
      layer.setTelemetry(tele(0.1 + f * 0.016, { wireCurrents: {}, components: { R1: { pinVoltages: {}, pinCurrents: { p1: 0.02, p2: -0.02 } } } }))
      layer.tick(0.016)
      const pos = layer.object.geometry.getAttribute('position').array as Float32Array
      for (let p = 0; p < layer.getStats().points; p++) {
        const x = pos[p * 3]
        const y = pos[p * 3 + 1]
        expect(Math.abs(pos[p * 3 + 2])).toBeLessThan(1e-6)
        expect(distToRoute(x, y)).toBeLessThan(1e-3)
        // the old path rose straight out of the hole to above the body (x = 0, y > 1)
        expect(x < 0.05 && y > 0.6).toBe(false)
        seen++
        if (y > 1.35) overBody++
      }
    }
    expect(seen).toBeGreaterThan(30)
    expect(overBody).toBeGreaterThan(0)
  })

  it('bodyTopOf: the solid body only — an LED halo / flare sprite is not part of it', () => {
    const root = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    body.position.y = 0.5
    root.add(body)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial())
    halo.scale.setScalar(6)
    halo.position.y = 1
    root.add(halo)
    const flare = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }))
    flare.rotation.x = Math.PI / 2
    flare.position.y = 3
    root.add(flare)
    expect(bodyTopOf(root)).toBeCloseTo(1, 6)
    expect(new THREE.Box3().setFromObject(root).max.y).toBeGreaterThan(3) // what the layer used to take
  })

  it('F15: every particle has the same colour and size — only speed and density change with the current', () => {
    useClock()
    const look = (amps: number) => {
      const layer = wireLayer(amps)
      layer.tick(0.016)
      const n = layer.getStats().points
      const col = layer.object.geometry.getAttribute('aColor').array as Float32Array
      const size = layer.object.geometry.getAttribute('aSize').array as Float32Array
      return { rgb: [col[0], col[1], col[2]], head: size[0], heads: layer.getStats().heads, n }
    }
    const lo = look(0.3e-3)
    const hi = look(60e-3)
    expect(lo.rgb).toEqual(hi.rgb)
    expect(lo.head).toBe(hi.head)
    expect(hi.heads).toBeGreaterThan(lo.heads) // denser at 60 mA
  })

  it('strip metal between two holes gets particles from stripCurrents', () => {
    useClock()
    const layer = new CurrentFlowLayer({ reducedMotion: false })
    layer.setWanted(true)
    layer.setTelemetry(tele(0.1, { wireCurrents: {}, stripCurrents: { 'a10>e10': 0.005 } }))
    layer.tick(0.016)
    expect(heads(layer)).toBeGreaterThan(0)
    const pos = layer.object.geometry.getAttribute('position').array as Float32Array
    expect(pos[0]).toBeCloseTo(10, 5) // column 10
    expect(pos[2]).toBeGreaterThanOrEqual(3) // between row a (z 3) …
    expect(pos[2]).toBeLessThanOrEqual(7) // … and row e (z 7)
  })

  it('the preference off or the session over hides everything', () => {
    useClock()
    const layer = wireLayer(0.01)
    layer.tick(0.016)
    expect(layer.object.visible).toBe(true)
    layer.setWanted(false)
    layer.tick(0.016)
    expect(layer.object.visible).toBe(false)
    expect(layer.object.geometry.drawRange.count).toBe(0)
    layer.setWanted(true)
    layer.setTelemetry(null)
    layer.tick(0.016)
    expect(layer.object.visible).toBe(false)
  })

  it('one pooled Points object, capped point count however much current flows', () => {
    useClock()
    const layer = new CurrentFlowLayer({ reducedMotion: false })
    const wires: Record<string, number> = {}
    for (let k = 0; k < 200; k++) {
      layer.setWirePath(`w${k}`, new THREE.Vector3(0, 0, k), new THREE.Vector3(120, 0, k), null)
      wires[`w${k}`] = 0.2
    }
    layer.setWanted(true)
    layer.setTelemetry(tele(0.1, { wireCurrents: wires }))
    layer.tick(0.016)
    expect(layer.object).toBeInstanceOf(THREE.Points)
    expect(layer.getStats().heads).toBeLessThanOrEqual(2000)
    expect(layer.getStats().points).toBeLessThanOrEqual(6000)
    expect(layer.object.geometry.getAttribute('position').count).toBe(6000)
  })
})

describe('the preference (contract C2) drives the simulation hosts', () => {
  it('useFlowView.visible → every registered host tracks currents (and later hosts start that way)', () => {
    const calls: boolean[] = []
    const leave = registerTrackingTarget({ setCurrentTracking: (on) => calls.push(on) })
    useFlowView.getState().setVisible(true)
    expect(currentTrackingDefault()).toBe(true)
    expect(calls).toEqual([true])
    const late: boolean[] = []
    const leave2 = registerTrackingTarget({ setCurrentTracking: (on) => late.push(on) })
    expect(late).toEqual([true])
    useFlowView.getState().setVisible(false)
    expect(calls).toEqual([true, false])
    expect(currentTrackingDefault()).toBe(false)
    leave()
    leave2()
  })
})
