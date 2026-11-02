/**
 * fix4 (three) THREE-4: a damage look that adds or shows meshes (a
 * resistor's char shell / glow / burnt-through gap, a vented can's petals,
 * a burned LED's cracks) is a GEOMETRY change — Studio must rebuild its BVH
 * and Enhanced re-collect its pre-pass skip list — but only when the look's
 * structure key changes: a stream of telemetry frames that only move a
 * material value (the browning, the glow colour, the LED's light) never
 * invalidates the geometry.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentInstance, ComponentTelemetry, SimTelemetry } from '../src/model/types'
import { CATALOG, type CatalogEntry } from '../src/model/catalog'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../src/three/component-meshes'
import { lookStructureRevision } from '../src/three/internal/fx/registry'
import { BreadboardScene } from '../src/three/scene'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const tel = (t: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...t })

const RES: ComponentInstance = { id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 10 } }
const LED: ComponentInstance = { id: 'LED1', type: 'led', holes: ['a10', 'a12'], params: { color: 'red' } }
const CAP: ComponentInstance = { id: 'C1', type: 'capacitor', holes: ['a10', 'a12'], params: { capacitance: 1e-4, polarized: true } }

/** how many structure changes one update made */
function delta(built: ReturnType<typeof buildComponentObject>, comp: ComponentInstance, entry: CatalogEntry, t: ComponentTelemetry | null): number {
  const r0 = lookStructureRevision()
  updateComponentVisual(built, comp, entry, t)
  return lookStructureRevision() - r0
}

describe('THREE-4: the look structure key (mesh side)', () => {
  it('resistor: browning, glowing, burned and reset each change it once; heat moving inside a band does not', () => {
    const b = buildComponentObject(RES, CATALOG.resistor, [v(0, 0, 0), v(4, 0, 0)])
    const e = CATALOG.resistor
    expect(delta(b, RES, e, tel({ current: 0.01 }))).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 0.6 }))).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 1.2 }))).toBe(1) // the char shell appears
    expect(delta(b, RES, e, tel({ heat: 1.5 }))).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 1.9 }))).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 2.4 }))).toBe(1) // the glow shell (+ haze)
    expect(delta(b, RES, e, tel({ heat: 3.1 }))).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 3.9 }))).toBe(0)
    expect(delta(b, RES, e, tel({ damage: { kind: 'burned', since: 2 } }))).toBe(1) // glow off, gap on
    expect(delta(b, RES, e, tel({ damage: { kind: 'burned', since: 2 } }))).toBe(0)
    expect(delta(b, RES, e, null)).toBe(1) // 重置模擬: everything hidden
    expect(delta(b, RES, e, null)).toBe(0)
    expect(delta(b, RES, e, tel({ heat: 1.2 }))).toBe(1)
    expect(delta(b, RES, e, tel({ heat: 0.5 }))).toBe(1) // cooled
    disposeComponentObject(b.object)
  })

  it('LED: burning and the reset change it; light levels and the over-drive never do', () => {
    const b = buildComponentObject(LED, CATALOG.led, [v(0, 0, 0), v(2, 0, 0)])
    const e = CATALOG.led
    for (const light of [0, 0.1, 0.5, 1, 1.4, 0.2]) expect(delta(b, LED, e, tel({ light, ledBrightness: Math.min(1, light) }))).toBe(0)
    expect(delta(b, LED, e, tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }))).toBe(1)
    expect(delta(b, LED, e, tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }))).toBe(0)
    expect(delta(b, LED, e, null)).toBe(1)
    expect(delta(b, LED, e, tel({ light: 0.5 }))).toBe(0)
    disposeComponentObject(b.object)
  })

  it('electrolytic: venting and the reset change it', () => {
    const b = buildComponentObject(CAP, CATALOG.capacitor, [v(0, 0, 0), v(2, 0, 0)])
    const e = CATALOG.capacitor
    expect(delta(b, CAP, e, tel({}))).toBe(0)
    expect(delta(b, CAP, e, tel({ damage: { kind: 'vented', since: 1 } }))).toBe(1)
    expect(delta(b, CAP, e, tel({ damage: { kind: 'vented', since: 1 } }))).toBe(0)
    expect(delta(b, CAP, e, null)).toBe(1)
    expect(delta(b, CAP, e, null)).toBe(0)
    disposeComponentObject(b.object)
  })
})

interface Internals {
  modes: { invalidate: (kind?: 'geometry' | 'materials') => void }
  components: Map<string, unknown>
  telemetry: SimTelemetry | null
  applyTelemetryChanged(): number
}

describe('THREE-4: the scene invalidates the geometry on a look change only', () => {
  it('a telemetry stream: one geometry invalidate per look change, none per frame', () => {
    const scene = new BreadboardScene()
    const s = scene as unknown as Internals
    const invalidate = vi.fn()
    s.modes = { invalidate }
    const add = (comp: ComponentInstance, entry: CatalogEntry, pins: THREE.Vector3[]) => {
      const built = buildComponentObject(comp, entry, pins)
      s.components.set(comp.id, { comp, entry, built, signature: '', attach: pins, posts: [], slot: -1 })
      return built
    }
    const r = add(RES, CATALOG.resistor, [v(0, 0, 0), v(4, 0, 0)])
    const l = add(LED, CATALOG.led, [v(0, 0, 3), v(2, 0, 3)])
    const c = add(CAP, CATALOG.capacitor, [v(0, 0, 6), v(2, 0, 6)])
    let time = 0
    const push = (components: Record<string, ComponentTelemetry>) => {
      time += 0.01
      s.telemetry = { time, netVoltages: {}, issues: [], components }
      return s.applyTelemetryChanged()
    }
    // a normal running circuit: every frame refreshes parts, nothing structural
    for (let i = 0; i < 40; i++) {
      const n = push({ R1: tel({ heat: 0.5 + i * 0.005, current: 0.01 + i * 1e-4 }), LED1: tel({ light: 0.2 + i * 0.01 }), C1: tel({}) })
      if (i === 0) expect(n).toBeGreaterThan(0)
    }
    expect(invalidate).not.toHaveBeenCalled()
    // the resistor heats through the browning band: ONE invalidate, then none while it browns further
    for (let i = 0; i < 30; i++) push({ R1: tel({ heat: 0.9 + i * 0.03 }), LED1: tel({ light: 0.4 }), C1: tel({}) })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate.mock.calls[0]).toEqual([]) // 'geometry' (the default kind)
    // the LED burns and the can vents in the same frame: each part's look changed
    push({ R1: tel({ heat: 1.8 }), LED1: tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }), C1: tel({ damage: { kind: 'vented', since: 1 } }) })
    expect(invalidate).toHaveBeenCalledTimes(3)
    for (let i = 0; i < 20; i++) push({ R1: tel({ heat: 1.8 - i * 0.01 }), LED1: tel({ light: 0, burned: true, damage: { kind: 'burned', since: 1 } }), C1: tel({ damage: { kind: 'vented', since: 1 } }) })
    expect(invalidate).toHaveBeenCalledTimes(3)
    // 重置模擬: every damaged look goes (3 parts → 3 changes), then quiet again
    s.telemetry = null
    s.applyTelemetryChanged()
    expect(invalidate).toHaveBeenCalledTimes(6)
    s.applyTelemetryChanged()
    expect(invalidate).toHaveBeenCalledTimes(6)
    for (const b of [r, l, c]) disposeComponentObject(b.object)
  })
})
