/**
 * Round 5 drag-to-wire — the 3D side (src/three/scene.ts beginWireDraw and
 * the generalised SC-13 wire drag). The scene runs headless: a stand-in for
 * its mounted renderer / camera / groups, real three.js projections of real
 * hole positions, the private gesture steps driven by name (onPointerDown /
 * Move / Up are closures of mount(); their order is pinned by a source scan).
 *
 *  - mouse: a press in a hole's MOUTH arms a new wire at once (orbit
 *    suspended, aim deferred); between holes, with Alt / Shift / Ctrl / ⌘,
 *    in the classic chrome, without the host or zoomed far out it does not;
 *    a click without drift stays the select-mode click; a drag past 5 px
 *    aims like wire mode, a drop calls onWireDraw(from, to), a drop back on
 *    the start (from, null); a part pin starts where the host says; a
 *    selected part's pin never; ANY wire's end re-routes (onWireEndMove);
 *    a selected wire's grip never follows a NEW wire; a mouse held still on
 *    a pin keeps its draw (polish: no action sheet for a mouse); wire mode
 *    with no first end draws too;
 *  - touch: only a 500 ms long-press arms (a move before it is an orbit), a
 *    lift without a move asks for the probe sheet;
 *  - the crosshair cursor; the scene's sound cues (emitFxCue): 'wire-tip',
 *    'lift', 'snap', 'settle', 'board'.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { setFxCueSink, type FxCue } from '../src/three/internal/fx/scene-fx'
import { holePosition, parseHole } from '../src/model/breadboard'
import type { SceneCallbacks } from '../src/three/scene-api'

const W = 800
const H = 600

type Ev = Partial<PointerEvent> & { pointerType: string; clientX: number; clientY: number }

/** Scene internals the test drives (private members, reached by name). */
interface Internals {
  m: {
    container: { style: { cursor: string } }
    controls: { enabled: boolean; touches: Record<string, unknown> }
    overlayGroup: THREE.Group
    previewMat: THREE.Material
    spawnFx: { burst: (...a: unknown[]) => void }
  }
  dockedChrome: boolean | null
  viewW: number
  viewH: number
  pinOwner: Map<string, string>
  occluded: Set<string>
  wires: Map<string, { wire: { id: string; from: string; to: string }; group: THREE.Group; signature: string }>
  selectedIds: string[]
  wireEndDrag: {
    wireId: string | null
    end: 'from' | 'to'
    from: string | null
    pressed: string | null
    armed: boolean
    started: boolean
    valid: boolean
    preview: THREE.Mesh | null
  } | null
  forceWireAim: boolean
  hoverMods: boolean
  controlsSuspended: boolean
  wireHandles: { wireId: string; group: THREE.Group; ends: { end: 'from' | 'to'; sprite: THREE.Sprite; at: THREE.Vector3 }[] } | null
  downInfo: { x: number; y: number; t: number; id: number; type: string; maxDrift: number } | null
  spawnTween: unknown
  updateNdc(e: Ev): void
  beginWireDraw(e: Ev, id: string | null): boolean
  updateEditDrags(e: Ev, drift: number): void
  finishEditDrags(e: Ev): boolean
  cancelEditDrags(): void
  startLongPress(id: string | null): void
  processHover(m: unknown): void
  handleClick(e: Ev): void
  updateSpawnTween(m: unknown): void
}

function holeAt(ref: string): THREE.Vector3 {
  const p = holePosition(parseHole(ref)!)
  return new THREE.Vector3(p.x, 0, p.z)
}

/** The product chrome's scene looking at `target` (about 48 px per hole pitch there) — `far` from 200 units away. */
function rig(opts: { far?: boolean; docked?: boolean; target?: string } = {}) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const target = holeAt(opts.target ?? 'a25')
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000)
  if (opts.far) camera.position.set(target.x - 20, 150, target.z + 130)
  else camera.position.set(target.x - 2, 9, target.z + 12)
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
  s.dockedChrome = opts.docked ?? true
  s.viewW = W
  s.viewH = H
  const cb = {
    onHoleClick: vi.fn(),
    onObjectClick: vi.fn(),
    onTerminalClick: vi.fn(),
    onBackgroundClick: vi.fn(),
    onHoleHover: vi.fn(),
    onObjectLongPress: vi.fn(),
    onProbeRequest: vi.fn(),
    wireDrawStart: vi.fn((ref: string): string | null => ref),
    onWireDrawStarted: vi.fn(),
    onWireDrawPreview: vi.fn((_from: string, _to: string) => true),
    onWireDraw: vi.fn(),
    onWireEndPreview: vi.fn(() => true),
    onWireEndMove: vi.fn(),
  }
  scene.setCallbacks(cb as Partial<SceneCallbacks>)
  scene.setInteractionMode('select')
  /** a pointer event at the screen projection of world point `p` (or hole ref) */
  const at = (p: THREE.Vector3 | string, extra: Partial<Ev> = {}): Ev => {
    const v = (typeof p === 'string' ? holeAt(p) : p).clone().project(camera)
    return {
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
      clientX: ((v.x + 1) / 2) * W,
      clientY: ((1 - v.y) / 2) * H,
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...extra,
    }
  }
  /** pointerdown: the scene's own bookkeeping, then the drag-to-wire branch */
  const press = (e: Ev, id: string | null = null): boolean => {
    s.updateNdc(e)
    s.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId ?? 1, type: e.pointerType, maxDrift: 0 }
    return s.beginWireDraw(e, id)
  }
  /** pointermove to `e` (drift from the press) */
  const move = (e: Ev) => {
    s.updateNdc(e)
    const d = s.downInfo!
    const drift = Math.hypot(e.clientX - d.x, e.clientY - d.y)
    d.maxDrift = Math.max(d.maxDrift, drift)
    s.updateEditDrags(e, drift)
  }
  return { scene, s, cb, at, press, move, camera }
}

let cues: FxCue[] = []
beforeEach(() => {
  cues = []
  setFxCueSink((c) => cues.push(c))
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
})
afterEach(() => {
  setFxCueSink(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('drag-to-wire, mouse: what a press arms', () => {
  it('a press in a hole’s mouth arms a new wire at once — the orbit is suspended, the aim waits for the drag', () => {
    const { s, cb, at, press } = rig()
    expect(press(at('a25'))).toBe(true)
    expect(cb.wireDrawStart).toHaveBeenCalledWith('a25')
    expect(s.wireEndDrag).toMatchObject({ wireId: null, end: 'to', from: 'a25', pressed: 'a25', armed: true, started: false })
    expect(s.m.controls.enabled).toBe(false)
    expect(s.forceWireAim).toBe(false) // a plain click keeps its select-mode meaning
    expect(cb.onWireDrawStarted).not.toHaveBeenCalled()
  })

  it('between holes, with a modifier, in the classic chrome, without the host or zoomed far out: no wire — the press stays an orbit', () => {
    const between = rig()
    expect(between.press(between.at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0))))).toBe(false)
    expect(between.cb.wireDrawStart).not.toHaveBeenCalled()
    expect(between.s.m.controls.enabled).toBe(true)
    for (const mod of ['altKey', 'shiftKey', 'ctrlKey', 'metaKey'] as const) {
      const r = rig()
      expect(r.press(r.at('a25', { [mod]: true })), mod).toBe(false)
      expect(r.s.wireEndDrag).toBeNull()
    }
    const classic = rig({ docked: false })
    expect(classic.press(classic.at('a25'))).toBe(false)
    const noHost = rig()
    noHost.scene.setCallbacks({ wireDrawStart: undefined })
    expect(noHost.press(noHost.at('a25'))).toBe(false)
    const far = rig({ far: true })
    expect(far.press(far.at('a25'))).toBe(false) // a pitch of a few px: a drag there means orbit
    const refused = rig()
    refused.cb.wireDrawStart.mockReturnValue(null)
    expect(refused.press(refused.at('a25'))).toBe(false)
    expect(refused.s.m.controls.enabled).toBe(true)
  })

  it('a part pin starts where the host says (the free hole of its strip); a selected part’s pin never (it moves)', () => {
    const { s, cb, at, press } = rig({ target: 'c21' })
    s.pinOwner.set('c21', 'U1')
    cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'c21' ? 'a21' : ref))
    expect(press(at('c21'))).toBe(true)
    expect(s.wireEndDrag).toMatchObject({ from: 'a21', pressed: 'c21' })
    const sel = rig({ target: 'c21' })
    sel.s.pinOwner.set('c21', 'U1')
    sel.s.selectedIds = ['U1']
    expect(sel.press(sel.at('c21'))).toBe(false)
    expect(sel.cb.wireDrawStart).not.toHaveBeenCalled()
  })

  it('a covered hole (under a part body, no pin) starts nothing', () => {
    const { s, cb, at, press } = rig()
    s.occluded.add('a25')
    expect(press(at('a25'))).toBe(false)
    expect(cb.wireDrawStart).not.toHaveBeenCalled()
  })

  it('wire mode with no first end draws too; with a first end, or placing, it does not', () => {
    const idle = rig()
    idle.scene.setInteractionMode('wire')
    expect(idle.press(idle.at('a25'))).toBe(true)
    const started = rig()
    started.scene.setInteractionMode('wire')
    started.scene.setWirePreview('a10', null)
    expect(started.press(started.at('a25'))).toBe(false)
    const placing = rig()
    placing.scene.setInteractionMode('place')
    expect(placing.press(placing.at('a25'))).toBe(false)
  })
})

describe('drag-to-wire, mouse: click, drag, drop', () => {
  it('a click without drift: no wire, the controls come back and the select-mode click still lands on the hole', () => {
    const { s, cb, at, press } = rig()
    const e = at('a25')
    press(e)
    expect(s.finishEditDrags(e)).toBe(false)
    expect(s.wireEndDrag).toBeNull()
    expect(s.m.controls.enabled).toBe(true)
    expect(cb.onWireDraw).not.toHaveBeenCalled()
    s.handleClick(e)
    expect(cb.onHoleClick).toHaveBeenCalledWith('a25')
    expect(cues).toEqual([])
  })

  it('past 5 px the wire leaves its start (aims like wire mode, wire-tip, the host’s haptic); the drop adds from → to', () => {
    const { s, cb, at, press, move } = rig()
    press(at('a25'))
    move(at('a25', {}))
    expect(s.wireEndDrag!.started).toBe(false)
    move(at('a27'))
    expect(s.wireEndDrag!.started).toBe(true)
    expect(s.forceWireAim).toBe(true)
    expect(cb.onWireDrawStarted).toHaveBeenCalledTimes(1)
    expect(cb.onWireDrawStarted).toHaveBeenCalledWith('a25')
    expect(cb.onWireDrawPreview).toHaveBeenLastCalledWith('a25', 'a27')
    expect(cues).toEqual(['wire-tip']) // its first aim makes no snap
    move(at('a30'))
    expect(cb.onWireDrawPreview).toHaveBeenLastCalledWith('a25', 'a30')
    expect(cues).toEqual(['wire-tip', 'snap'])
    const preview = s.wireEndDrag!.preview
    expect(preview).not.toBeNull()
    expect(s.m.overlayGroup.children).toContain(preview)
    expect(preview!.material).toBe(s.m.previewMat)
    // the same target again: validity is not asked again, the route is not rebuilt
    const asked = cb.onWireDrawPreview.mock.calls.length
    move(at('a30'))
    expect(cb.onWireDrawPreview.mock.calls.length).toBe(asked)
    expect(s.wireEndDrag!.preview).toBe(preview)
    const up = at('a30')
    expect(s.finishEditDrags(up)).toBe(true) // the drop consumed the gesture: no tap
    expect(cb.onWireDraw).toHaveBeenCalledWith('a25', 'a30')
    expect(s.wireEndDrag).toBeNull()
    expect(s.forceWireAim).toBe(false)
    expect(s.m.controls.enabled).toBe(true)
    expect(s.m.overlayGroup.children).not.toContain(preview)
    expect(cues).toEqual(['wire-tip', 'snap']) // a wire that lands: the store's watcher voices it
  })

  it('a drop back on the start — or away from any hole — is a silent cancel (to = null): no sound at all (polish)', () => {
    const { s, cb, at, press, move } = rig()
    press(at('a25'))
    move(at('a28'))
    move(at('a25'))
    s.finishEditDrags(at('a25'))
    expect(cb.onWireDraw).toHaveBeenCalledWith('a25', null)
    expect(cues).not.toContain('settle')
  })

  it('a target the host refuses: red route, the drop still asks (the host says why)', () => {
    const { s, cb, at, press, move } = rig()
    cb.onWireDrawPreview.mockImplementation((_f: string, to: string) => to !== 'a28')
    press(at('a25'))
    move(at('a28'))
    expect(s.wireEndDrag!.valid).toBe(false)
    expect(s.wireEndDrag!.preview!.material).not.toBe(s.m.previewMat)
    s.finishEditDrags(at('a28'))
    expect(cb.onWireDraw).toHaveBeenCalledWith('a25', 'a28')
    expect(cues).not.toContain('settle') // the host voices the refusal (playMech 'refuse' — polish)
  })

  it('a selected wire’s grip never follows a NEW wire', () => {
    const { s, at, press, move } = rig()
    const sprite = new THREE.Sprite()
    sprite.position.set(1, 2, 3)
    s.wireHandles = { wireId: 'W9', group: new THREE.Group(), ends: [{ end: 'to', sprite, at: new THREE.Vector3(1, 2, 3) }] }
    press(at('a25'))
    move(at('a30'))
    expect(sprite.position.toArray()).toEqual([1, 2, 3])
  })

  it('a pointer cancel abandons a running drag (no wire) and settles', () => {
    const { s, cb, at, press, move } = rig()
    press(at('a25'))
    move(at('a30'))
    s.cancelEditDrags()
    expect(s.wireEndDrag).toBeNull()
    expect(cb.onWireDraw).not.toHaveBeenCalled()
    expect(cues.at(-1)).toBe('settle')
  })

  it('a mouse held still on a part pin keeps the wire in hand — the long-press sheet is a finger’s gesture (polish)', () => {
    vi.useFakeTimers()
    const { s, cb, at, press, move } = rig()
    s.pinOwner.set('a25', 'R1')
    s.startLongPress('R1') // onPointerDown starts it first; the armed draw stops it
    press(at('a25'), 'R1')
    vi.advanceTimersByTime(900)
    expect(cb.onObjectLongPress).not.toHaveBeenCalled()
    expect(cb.onProbeRequest).not.toHaveBeenCalled()
    expect(s.wireEndDrag).toMatchObject({ armed: true, started: false })
    move(at('a30'))
    expect(s.wireEndDrag!.started).toBe(true)
    expect(s.finishEditDrags(at('a30'))).toBe(true)
    expect(cb.onWireDraw).toHaveBeenCalledWith('a25', 'a30')
    expect(s.m.controls.enabled).toBe(true)
  })
})

describe('drag-to-wire, mouse: ANY wire’s end re-routes (SC-13)', () => {
  it('a press on an unselected wire’s end in its hole drags that end; the drop asks onWireEndMove', () => {
    const { s, cb, at, press, move } = rig()
    s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    s.pinOwner.set('a25', 'W1')
    expect(press(at('a25'), 'W1')).toBe(true)
    expect(cb.wireDrawStart).not.toHaveBeenCalled()
    expect(s.wireEndDrag).toMatchObject({ wireId: 'W1', end: 'to', armed: true, started: false })
    expect(s.forceWireAim).toBe(false)
    move(at('a30'))
    expect(cues).toEqual(['lift'])
    expect(cb.onWireEndPreview).toHaveBeenLastCalledWith('W1', 'to', 'a30')
    s.finishEditDrags(at('a30'))
    expect(cb.onWireEndMove).toHaveBeenCalledWith('W1', 'to', 'a30')
    expect(cb.onWireDraw).not.toHaveBeenCalled()
  })

  it('…in wire mode a wire’s end starts nothing (the click there still says why)', () => {
    const { s, scene, at, press } = rig()
    scene.setInteractionMode('wire')
    s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    s.pinOwner.set('a25', 'W1')
    expect(press(at('a25'))).toBe(false)
  })
})

describe('drag-to-wire, touch: a long-press arms the grip', () => {
  const touch = { pointerType: 'touch' } as const

  it('nothing at the press (a one-finger orbit); after 500 ms the grip is in hand; a drag draws the wire', () => {
    vi.useFakeTimers()
    const { s, cb, at, press, move } = rig()
    expect(press(at('a25', touch))).toBe(true)
    expect(s.wireEndDrag).toMatchObject({ from: 'a25', armed: false })
    expect(s.m.controls.enabled).toBe(true)
    vi.advanceTimersByTime(510)
    expect(s.wireEndDrag!.armed).toBe(true)
    expect(s.m.controls.enabled).toBe(false)
    expect(s.forceWireAim).toBe(true)
    expect(cb.onWireDrawStarted).toHaveBeenCalledWith('a25')
    move(at('a30', touch))
    expect(s.wireEndDrag!.started).toBe(true)
    expect(cb.onWireDrawStarted).toHaveBeenCalledTimes(1) // its haptic came at the arm
    expect(cues).toEqual(['wire-tip'])
    s.finishEditDrags(at('a30', touch))
    expect(cb.onWireDraw).toHaveBeenCalledTimes(1)
    expect(cb.onWireDraw.mock.calls[0][0]).toBe('a25')
  })

  it('a lift without a move asks for the probe sheet of the pressed point (as SC-14 did, on the lift)', () => {
    vi.useFakeTimers()
    const { s, cb, at, press } = rig()
    press(at('a25', touch))
    vi.advanceTimersByTime(510)
    expect(cb.onProbeRequest).not.toHaveBeenCalled()
    expect(s.finishEditDrags(at('a25', touch))).toBe(true)
    expect(cb.onProbeRequest).toHaveBeenCalledWith({ hole: 'a25' }, expect.anything(), { pointer: 'touch' })
    expect(cb.onWireDraw).not.toHaveBeenCalled()
  })

  it('a move before the 500 ms is the orbit it always was', () => {
    vi.useFakeTimers()
    const { s, cb, at, press, move } = rig()
    press(at('a25', touch))
    // onPointerMove cancels the long-press past 10 px before it drives the drags
    ;(s as unknown as { cancelLongPress(): void }).cancelLongPress()
    move(at('a30', touch))
    expect(s.wireEndDrag).toBeNull()
    vi.advanceTimersByTime(600)
    expect(s.m.controls.enabled).toBe(true)
    expect(cb.onWireDrawStarted).not.toHaveBeenCalled()
  })

  it('a finger on a selected part moves it instead', () => {
    const { s, at, press } = rig()
    s.selectedIds = ['R1']
    expect(press(at('a25', touch), 'R1')).toBe(false)
  })
})

describe('the crosshair says where a press draws', () => {
  it('select mode: over a hole’s mouth (not between holes, not with a modifier, not in the classic chrome)', () => {
    const { s, at } = rig()
    const hover = (e: Ev) => {
      s.updateNdc(e)
      ;(s as unknown as { pointerInside: boolean }).pointerInside = true
      s.processHover(s.m)
      return s.m.container.style.cursor
    }
    expect(hover(at('a25'))).toBe('crosshair')
    expect(hover(at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0))))).toBe('')
    s.hoverMods = true
    expect(hover(at('a25'))).toBe('')
    s.hoverMods = false
    s.dockedChrome = false
    expect(hover(at('a25'))).toBe('')
  })
})

describe('the scene’s sound cues (emitFxCue)', () => {
  it('a new board’s touchdown clacks once', () => {
    const { s } = rig()
    s.spawnTween = { entries: [], axis: 'x', tilt: 0, rect: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, t0: performance.now() - 300, landed: false }
    s.updateSpawnTween(s.m)
    s.updateSpawnTween(s.m)
    expect(cues).toEqual(['board'])
    expect(s.m.spawnFx.burst).toHaveBeenCalledTimes(1)
  })

  it('a repeat of the same cue inside its gap is dropped', () => {
    const { s, at, press, move } = rig()
    press(at('a25'))
    move(at('a27'))
    move(at('a28'))
    move(at('a29')) // three holes within a few ms: one snap
    expect(cues.filter((c) => c === 'snap')).toEqual(['snap'])
    s.cancelEditDrags()
  })
})

describe('wiring in onPointerDown (source order)', () => {
  const src = readFileSync(path.resolve(__dirname, '../src/three/scene.ts'), 'utf8').replace(/\r\n/g, '\n')
  const down = src.slice(src.indexOf('const onPointerDown = (e: PointerEvent) => {'), src.indexOf('const onPointerUp = (e: PointerEvent) => {'))

  it('SC-13 grips and the 3D press keep precedence; touch arms before the probe long-press; the mouse after a move / marquee', () => {
    const at = (s: string) => {
      const i = down.indexOf(s)
      expect(i, s).toBeGreaterThan(0)
      return i
    }
    expect(at('this.beginWireEndDrag(e)')).toBeLessThan(at('this.pressable(id)'))
    expect(at('this.pressable(id)')).toBeLessThan(at("e.pointerType === 'touch' && this.beginWireDraw(e, id)"))
    expect(at("e.pointerType === 'touch' && this.beginWireDraw(e, id)")).toBeLessThan(at('else if (id !== null) this.startLongPress(id)'))
    expect(at('this.maybeBeginEditDrag(e, id)')).toBeLessThan(
      at("if (e.pointerType !== 'touch' && !this.moveDrag && !this.instDrag && !this.marquee) this.beginWireDraw(e, id)"),
    )
  })
})
