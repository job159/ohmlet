/**
 * Round 5 persona fixes, the 3D side (src/three/scene.ts):
 *
 *  (1) drag-to-wire works at the app's own framing: a hole pitch of 6 px
 *      (1280×720 with a supply beside the board) still draws — the limit is
 *      4.5 px, and a small pitch widens the mouth to 2.5 px on screen; zoomed
 *      further out a press in a hole orbits, and its drag asks the host for
 *      the zoom tip (onWireDrawTooSmall) once;
 *  (2) a SELECTED instrument's terminal post draws a wire (a supply placed
 *      from its card stays selected — its first wire lifted it instead);
 *      its body still moves it;
 *  (6) a finger's long-press on a part's raised body is that part's (its
 *      action sheet — 屬性／複製／換新／刪除), as a tap there selects it — not
 *      the probe sheet of the free hole under it; its own pin and a wire's
 *      end in the hole are still the points to measure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { setFxCueSink } from '../src/three/internal/fx/scene-fx'
import { holePosition, parseHole } from '../src/model/breadboard'
import { getEntry } from '../src/model/catalog'
import type { SceneCallbacks, SceneProbeTarget } from '../src/three/scene-api'

const W = 800
const H = 600
type Ev = Partial<PointerEvent> & { pointerType: string; clientX: number; clientY: number }

interface Internals {
  m: {
    container: { style: { cursor: string } }
    controls: { enabled: boolean }
    componentsGroup: THREE.Group
    terminalsGroup: THREE.Group
  }
  dockedChrome: boolean | null
  pinOwner: Map<string, string>
  components: Map<string, unknown>
  wires: Map<string, unknown>
  selectedIds: string[]
  wireEndDrag: { from: string | null; pressed: string | null; armed: boolean } | null
  instDrag: unknown
  downInfo: { x: number; y: number; t: number; id: number; type: string; maxDrift: number } | null
  updateNdc(e: Ev): void
  beginWireDraw(e: Ev, id: string | null): boolean
  maybeBeginEditDrag(e: Ev, id: string | null): void
  updateEditDrags(e: Ev, drift: number): void
  processHover(m: unknown): void
  probeTargetAtPointer(m: unknown, touch?: boolean): SceneProbeTarget | null
}

function holeAt(ref: string): THREE.Vector3 {
  const p = holePosition(parseHole(ref)!)
  return new THREE.Vector3(p.x, 0, p.z)
}

/** The product chrome's scene looking at `target` from `k` × the drag-wire tests' distance (k = 1 ≈ 48 px a pitch). */
function rig(opts: { k?: number; target?: string } = {}) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const target = holeAt(opts.target ?? 'a25')
  const k = opts.k ?? 1
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000)
  camera.position.set(target.x - 2 * k, 9 * k, target.z + 12 * k)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const componentsGroup = new THREE.Group()
  const wiresGroup = new THREE.Group()
  const terminalsGroup = new THREE.Group()
  s.m = {
    container: { style: { cursor: '' } },
    camera,
    renderer: {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }), setPointerCapture: () => {} },
      shadowMap: { needsUpdate: false },
    },
    board: { config: { size: 'standard', count: 1 } },
    controls: { enabled: true, touches: {} },
    terminalsGroup,
    componentsGroup,
    wiresGroup,
    overlayGroup: new THREE.Group(),
    objectPickRoots: [componentsGroup, wiresGroup],
    hoverPickRoots: [terminalsGroup, componentsGroup, wiresGroup],
    paddles: [],
    holeLabel: makeHoleLabel(),
    screenChip: makeScreenChip(),
    hoverRing: makeHoverRing(),
    fingertipGroup: new THREE.Group(),
    fingertipRingMat: new THREE.MeshBasicMaterial(),
    fingertipGlowMat: new THREE.MeshBasicMaterial(),
    fingertipCrossMat: new THREE.MeshBasicMaterial(),
    previewMat: new THREE.MeshBasicMaterial(),
    spawnFx: { burst: vi.fn() },
    clock: new THREE.Clock(),
  } as unknown as Internals['m']
  ;(s as unknown as { viewW: number; viewH: number }).viewW = W
  ;(s as unknown as { viewW: number; viewH: number }).viewH = H
  s.dockedChrome = true
  const cb = {
    onHoleClick: vi.fn(),
    onObjectClick: vi.fn(),
    onHoleHover: vi.fn(),
    onObjectLongPress: vi.fn(),
    onProbeRequest: vi.fn(),
    wireDrawStart: vi.fn((ref: string): string | null => ref),
    onWireDrawStarted: vi.fn(),
    onWireDrawPreview: vi.fn(() => true),
    onWireDraw: vi.fn(),
    onWireEndPreview: vi.fn(() => true),
    onWireEndMove: vi.fn(),
    onWireDrawTooSmall: vi.fn(),
  }
  scene.setCallbacks(cb as Partial<SceneCallbacks>)
  scene.setInteractionMode('select')
  const at = (p: THREE.Vector3 | string, extra: Partial<Ev> = {}): Ev => {
    const v = (typeof p === 'string' ? holeAt(p) : p).clone().project(camera)
    return { pointerType: 'mouse', pointerId: 1, button: 0, clientX: ((v.x + 1) / 2) * W, clientY: ((1 - v.y) / 2) * H, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...extra }
  }
  const down = (e: Ev) => {
    s.updateNdc(e)
    s.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId ?? 1, type: e.pointerType, maxDrift: 0 }
  }
  const press = (e: Ev, id: string | null = null): boolean => {
    down(e)
    return s.beginWireDraw(e, id)
  }
  const move = (e: Ev) => {
    s.updateNdc(e)
    const d = s.downInfo!
    const drift = Math.hypot(e.clientX - d.x, e.clientY - d.y)
    d.maxDrift = Math.max(d.maxDrift, drift)
    s.updateEditDrags(e, drift)
  }
  const hover = (e: Ev) => {
    s.updateNdc(e)
    ;(s as unknown as { pointerInside: boolean }).pointerInside = true
    s.processHover(s.m)
    return s.m.container.style.cursor
  }
  const box = (group: THREE.Group, p: THREE.Vector3, size: number | [number, number, number], data: Record<string, unknown>) => {
    const [x, y, z] = typeof size === 'number' ? [size, size, size] : size
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshBasicMaterial())
    mesh.position.copy(p)
    mesh.userData = data
    group.add(mesh)
    mesh.updateMatrixWorld(true)
    return mesh
  }
  /** one hole pitch on screen at `ref` (px) */
  const pitch = (ref: string) => {
    const a = at(holeAt(ref).add(new THREE.Vector3(-0.5, 0, 0)))
    const b = at(holeAt(ref).add(new THREE.Vector3(0.5, 0, 0)))
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
  }
  return { scene, s, cb, at, down, press, move, hover, box, pitch, camera }
}

beforeEach(() => {
  setFxCueSink(() => {})
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
})
afterEach(() => {
  setFxCueSink(null)
  vi.unstubAllGlobals()
})

describe('(1) drag-to-wire at the app’s own framing (a 5–7 px hole pitch)', () => {
  it('a 6 px pitch: a press in a hole draws (was: the 8 px limit made it an orbit), the crosshair says so', () => {
    const r = rig({ k: 8 })
    expect(r.pitch('a25')).toBeGreaterThan(5.5)
    expect(r.pitch('a25')).toBeLessThan(6.5)
    expect(r.hover(r.at('a25'))).toBe('crosshair')
    expect(r.press(r.at('a25'))).toBe(true)
    expect(r.s.wireEndDrag).toMatchObject({ from: 'a25', pressed: 'a25', armed: true })
    expect(r.s.m.controls.enabled).toBe(false)
  })

  it('a small pitch widens the mouth to 2.5 px on screen (0.36 of a pitch would be a 2.2 px target at 6 px)', () => {
    const r = rig({ k: 8 })
    const off = r.at(holeAt('a25').add(new THREE.Vector3(0.4, 0, 0))) // 0.4 of a pitch ≈ 2.4 px from the centre
    expect(r.press(off)).toBe(true)
    // the plastic between two holes still orbits
    const between = rig({ k: 8 })
    expect(between.press(between.at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0))))).toBe(false)
    // at a comfortable pitch the mouth is the hole's own (0.36)
    const near = rig()
    expect(near.press(near.at(holeAt('a25').add(new THREE.Vector3(0.4, 0, 0))))).toBe(false)
  })

  it('zoomed further out (≈ 3.5 px): the press orbits, and its drag asks for the zoom tip once', () => {
    const r = rig({ k: 14 })
    expect(r.pitch('a25')).toBeLessThan(4.5)
    expect(r.hover(r.at('a25'))).not.toBe('crosshair')
    const e = r.at('a25')
    expect(r.press(e)).toBe(false)
    expect(r.s.m.controls.enabled).toBe(true)
    r.move({ ...e, clientX: e.clientX + 3 })
    expect(r.cb.onWireDrawTooSmall).not.toHaveBeenCalled() // not a drag yet
    r.move({ ...e, clientX: e.clientX + 30 })
    r.move({ ...e, clientX: e.clientX + 60 })
    expect(r.cb.onWireDrawTooSmall).toHaveBeenCalledTimes(1)
    // a press between holes, or a click without a drag, says nothing
    const q = rig({ k: 14 })
    const b = q.at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0)))
    expect(q.press(b)).toBe(false)
    q.move({ ...b, clientX: b.clientX + 30 })
    expect(q.cb.onWireDrawTooSmall).not.toHaveBeenCalled()
  })
})

describe('(2) a SELECTED instrument’s terminal post draws its first wire', () => {
  function supply(r: ReturnType<typeof rig>) {
    const p = holeAt('a25').add(new THREE.Vector3(0, 0.6, -8)) // on the desk, off the board
    const post = r.box(r.s.m.terminalsGroup, p, 0.2, { terminalRef: 'PS1:+' })
    r.box(r.s.m.componentsGroup, p.clone().add(new THREE.Vector3(0, 0, -0.6)), 1.6, { componentId: 'PS1' })
    r.s.components.set('PS1', {
      comp: { id: 'PS1', type: 'power_supply', pos: { x: p.x, z: p.z - 0.6 } },
      entry: { placement: 'offboard', pins: ['+', '-'] },
      posts: [post],
      attach: [p.clone()],
      built: { object: new THREE.Group() },
    })
    r.s.selectedIds = ['PS1']
    return p
  }

  it('a press on the post: no bench drag — the drag-to-wire takes it from PS1:+', () => {
    const r = rig()
    const p = supply(r)
    const e = r.at(p)
    r.down(e)
    r.s.maybeBeginEditDrag(e, 'PS1')
    expect(r.s.instDrag).toBeNull() // was: the bench drag (the supply lifted, no wire)
    expect(r.s.beginWireDraw(e, 'PS1')).toBe(true)
    expect(r.s.wireEndDrag).toMatchObject({ from: 'PS1:+', pressed: 'PS1:+', armed: true })
    expect(r.cb.wireDrawStart).toHaveBeenCalledWith('PS1:+')
  })

  it('a press on its body away from the posts still moves it; the classic chrome keeps the bench drag on the post', () => {
    const r = rig()
    const p = supply(r)
    const body = r.at(p.clone().add(new THREE.Vector3(0.7, 0.8, -1.2)))
    r.down(body)
    r.s.maybeBeginEditDrag(body, 'PS1')
    expect(r.s.instDrag).not.toBeNull()
    const c = rig()
    const q = supply(c)
    c.s.dockedChrome = false
    const e = c.at(q)
    c.down(e)
    c.s.maybeBeginEditDrag(e, 'PS1')
    expect(c.s.instDrag).not.toBeNull()
  })

  it('a host that refuses the post (no wire starts there): the bench drag as before', () => {
    const r = rig()
    const p = supply(r)
    r.cb.wireDrawStart.mockReturnValue(null)
    const e = r.at(p)
    r.down(e)
    r.s.maybeBeginEditDrag(e, 'PS1')
    expect(r.s.instDrag).not.toBeNull()
  })
})

describe('(6) a finger’s long-press on a part’s raised body is that part’s', () => {
  function resistor(r: ReturnType<typeof rig>) {
    const entry = getEntry('resistor')!
    r.s.components.set('R1', { comp: { id: 'R1', type: 'resistor', holes: ['a23', 'a27'] }, entry, posts: [], attach: [], built: { object: new THREE.Group() } })
    r.s.pinOwner.set('a23', 'R1')
    r.s.pinOwner.set('a27', 'R1')
    // the body, raised over a24…a26 (its leads bend down into a23 / a27)
    const top = holeAt('a25').add(new THREE.Vector3(0, 0.45, 0))
    r.box(r.s.m.componentsGroup, top, [2.4, 0.5, 0.5], { componentId: 'R1' })
    return top
  }
  const touchAt = (r: ReturnType<typeof rig>, p: THREE.Vector3 | string) => {
    const e = r.at(p, { pointerType: 'touch' })
    r.down(e)
    return r.s.probeTargetAtPointer(r.s.m, true)
  }

  it('the middle of the body (over a free hole): no probe target — the long-press falls to R1’s own sheet', () => {
    const r = rig({ target: 'a25' })
    const top = resistor(r)
    expect(touchAt(r, top)).toBeNull() // was { hole: 'a25' }-ish: 「a25 這裡還沒有接任何元件」
  })

  it('its own pin, a free hole beside it and a wire’s end under it are still the points to measure', () => {
    const r = rig({ target: 'a25' })
    resistor(r)
    expect(touchAt(r, 'a23')).toEqual({ hole: 'a23' })
    expect(touchAt(r, 'e25')).toEqual({ hole: 'e25' })
    // a wire's end in the hole under the body
    const w = rig({ target: 'a25' })
    const top = resistor(w)
    w.s.wires.set('W9', { wire: { id: 'W9', from: 'top+3', to: 'a25' }, group: new THREE.Group(), signature: '' })
    for (const h of ['a24', 'a25', 'a26', 'b24', 'b25', 'b26', 'c25']) w.s.pinOwner.set(h, 'W9')
    const t = touchAt(w, top)
    expect(t && 'hole' in t ? w.s.pinOwner.get(t.hole!) : null).toBe('W9')
  })
})
