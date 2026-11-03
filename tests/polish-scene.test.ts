/**
 * Round 5 polish, stream "scene" — drag-to-wire and the quiet re-burn:
 *
 *  (a) the classic chrome keeps Alt + drag on a selected part as a move;
 *  (b) the crosshair never promises a wire where a press does something
 *      else (a pressable part's leg while a session runs, a selected
 *      instrument's post);
 *  (c) a press on the bare desk beside a terminal post orbits, as the hover
 *      there promises nothing;
 *  (d) (tests/dragwire-scene.test.ts) a mouse held still keeps its draw;
 *  (e) a drop on a part's LEG lands on the free hole of the same strip —
 *      the route, ring and chip show that hole, the toast says where it went;
 *      only a full strip refuses;
 *  (f) a start a pin's press moved is named: the chip while aiming at
 *      nothing, the toast after;
 *  (g) a re-routed wire end's toast carries 〔復原〕;
 *  (h) the wire mode hint is short; a one-time tip the first time the mouse
 *      rests on a free hole (once per browser, never under ?shotrig);
 *  (i) a finger's grip says what a lift and a drag do;
 *  (j) a part that burns again for the same reason after an edit shows its
 *      burned look without the burst and the pop;
 *  (k) a refused drop plays the refusal sound; a drop on nothing is silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

vi.mock('../src/ui/fx/sound', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/ui/fx/sound')>()
  return { ...orig, playMech: vi.fn() }
})

import { BreadboardScene, fxPartKey } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { SceneFx, setFxCueSink, type FxCue, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import { holePosition, parseHole } from '../src/model/breadboard'
import type { SceneCallbacks } from '../src/three/scene-api'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { __setLangForTests, t } from '../src/i18n'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { getToasts } from '../src/ui/kit/toasts'
import { playMech } from '../src/ui/fx/sound'
import { hintForMode } from '../src/ui/chrome/hints'
import {
  WIRE_DRAW_TIP_KEY,
  __resetWireDrawTipForTests,
  drawWire,
  landingOf,
  wireDrawHint,
  wireDrawLanding,
  wireDrawStartText,
  wireGripText,
} from '../src/ui/workspace/wire-draw'
import { moveWireEndTo } from '../src/ui/workspace/wire-ends'

// ============================================================ the scene

const W = 800
const H = 600
type Ev = Partial<PointerEvent> & { pointerType: string; clientX: number; clientY: number }

/** Scene internals the test drives (private members, reached by name). */
interface Internals {
  m: {
    container: { style: { cursor: string } }
    controls: { enabled: boolean; touches: Record<string, unknown> }
    overlayGroup: THREE.Group
    componentsGroup: THREE.Group
    terminalsGroup: THREE.Group
    previewMat: THREE.Material
    hoverRing: { object: THREE.Object3D }
    fingertipGroup: THREE.Group
  }
  dockedChrome: boolean | null
  telemetry: unknown
  pinOwner: Map<string, string>
  components: Map<string, unknown>
  wires: Map<string, { wire: { id: string; from: string; to: string }; group: THREE.Group; signature: string }>
  selectedIds: string[]
  wireEndDrag: {
    wireId: string | null
    from: string | null
    pressed: string | null
    armed: boolean
    started: boolean
    valid: boolean
    land: string | null
    landNote: string | null
    previewKey: string
    preview: THREE.Mesh | null
  } | null
  moveDrag: unknown
  downInfo: { x: number; y: number; t: number; id: number; type: string; maxDrift: number } | null
  updateNdc(e: Ev): void
  beginWireDraw(e: Ev, id: string | null): boolean
  beginWireEndDrag(e: Ev): boolean
  maybeBeginEditDrag(e: Ev, id: string | null): void
  updateEditDrags(e: Ev, drift: number): void
  finishEditDrags(e: Ev): boolean
  processHover(m: unknown): void
}

function holeAt(ref: string): THREE.Vector3 {
  const p = holePosition(parseHole(ref)!)
  return new THREE.Vector3(p.x, 0, p.z)
}

/** The product chrome's scene looking at `target` (≈ 48 px per hole pitch there) — tests/dragwire-scene.test.ts's rig. */
function rig(opts: { docked?: boolean; target?: string } = {}) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const target = holeAt(opts.target ?? 'a25')
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000)
  camera.position.set(target.x - 2, 9, target.z + 12)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const componentsGroup = new THREE.Group()
  const wiresGroup = new THREE.Group()
  const terminalsGroup = new THREE.Group()
  const chip = makeScreenChip()
  const chipTexts: string[] = []
  chip.setText = (x: string) => void chipTexts.push(x)
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
    screenChip: chip,
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
  s.dockedChrome = opts.docked ?? true
  const cb = {
    onHoleClick: vi.fn(),
    onObjectClick: vi.fn(),
    onHoleHover: vi.fn(),
    onObjectLongPress: vi.fn(),
    onProbeRequest: vi.fn(),
    wireDrawStart: vi.fn((ref: string): string | null => ref),
    onWireDrawStarted: vi.fn(),
    onWireDrawPreview: vi.fn((_from: string, _to: string) => true),
    onWireDraw: vi.fn(),
    onWireEndPreview: vi.fn((_id: string, _end: string, _ref: string) => true),
    onWireEndMove: vi.fn(),
  }
  scene.setCallbacks(cb as Partial<SceneCallbacks>)
  scene.setInteractionMode('select')
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
  const press = (e: Ev, id: string | null = null): boolean => {
    s.updateNdc(e)
    s.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId ?? 1, type: e.pointerType, maxDrift: 0 }
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
  /** a pickable box for part / wire `id` at world point `p` (in `group`) */
  const box = (group: THREE.Group, p: THREE.Vector3, size: number, data: Record<string, unknown>) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial())
    mesh.position.copy(p)
    mesh.userData = data
    group.add(mesh)
    mesh.updateMatrixWorld(true)
    return mesh
  }
  return { scene, s, cb, at, press, move, hover, box, camera, chipTexts }
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

describe('(a) Alt + drag on a selected part', () => {
  const selectedR1 = (r: ReturnType<typeof rig>) => {
    r.s.components.set('R1', {
      comp: { id: 'R1', type: 'resistor', holes: ['a20', 'a25'] },
      entry: { placement: 'leads', pins: ['1', '2'] },
      posts: [],
      built: { object: new THREE.Group() },
    })
    r.s.selectedIds = ['R1']
  }

  it('the classic chrome still moves it (no drag-to-wire there, nothing to escape from)', () => {
    const r = rig({ docked: false })
    selectedR1(r)
    const e = r.at('a25', { altKey: true })
    r.s.updateNdc(e)
    r.s.maybeBeginEditDrag(e, 'R1')
    expect(r.s.moveDrag).not.toBeNull()
  })

  it('the product chrome: Alt + drag orbits (drag-to-wire’s escape hatch)', () => {
    const r = rig()
    selectedR1(r)
    const e = r.at('a25', { altKey: true })
    r.s.updateNdc(e)
    r.s.maybeBeginEditDrag(e, 'R1')
    expect(r.s.moveDrag).toBeNull()
  })
})

describe('(b) the crosshair never promises a wire a press would not draw', () => {
  it('a pressable part’s leg: a crosshair while no session runs, none while one does (the press presses it — SC-6)', () => {
    const r = rig()
    r.s.components.set('SW1', {
      comp: { id: 'SW1', type: 'pushbutton', holes: ['a25', 'a27'] },
      entry: { placement: 'leads', pins: ['1', '2'], params: [{ key: 'pressed', runtime: true }] },
      posts: [],
      built: { object: new THREE.Group() },
    })
    r.s.pinOwner.set('a25', 'SW1')
    r.box(r.s.m.componentsGroup, holeAt('a25').setY(0.1), 0.3, { componentId: 'SW1' }) // its leg, in the hole
    expect(r.hover(r.at('a25'))).toBe('crosshair')
    r.s.telemetry = { time: 1, netVoltages: {}, components: {}, issues: [] }
    expect(r.hover(r.at('a25'))).toBe('pointer')
  })

  it('a terminal post: a crosshair, also while its instrument is SELECTED (persona fix — the body moves it)', () => {
    const r = rig()
    const p = holeAt('a25').add(new THREE.Vector3(0, 0.6, -8)) // on the desk, off the board
    const post = r.box(r.s.m.terminalsGroup, p, 0.2, { terminalRef: 'PS1:+' })
    r.box(r.s.m.componentsGroup, p.clone().add(new THREE.Vector3(0, 0, -0.6)), 1.6, { componentId: 'PS1' })
    r.s.components.set('PS1', {
      comp: { id: 'PS1', type: 'power_supply' },
      entry: { placement: 'offboard', pins: ['+', '-'] },
      posts: [post],
      attach: [p.clone()],
      built: { object: new THREE.Group() },
    })
    expect(r.hover(r.at(p))).toBe('crosshair')
    r.s.selectedIds = ['PS1']
    // was 'pointer' (the bench drag won): a supply placed from its card stays selected, and its first wire lifted it
    expect(r.hover(r.at(p))).toBe('crosshair')
    // the selected instrument's body, away from its posts: no crosshair (a drag there moves it)
    expect(r.hover(r.at(p.clone().add(new THREE.Vector3(0.7, 0.8, -1.2))))).toBe('pointer')
  })
})

describe('(c) the bare desk beside a terminal post: hover and press agree — an orbit', () => {
  it('no crosshair and no wire within the post’s slop when nothing is under the pointer; on the post, both', () => {
    const r = rig()
    const p = holeAt('a25').add(new THREE.Vector3(0, 0.6, -8))
    r.s.components.set('PS1', {
      comp: { id: 'PS1', type: 'power_supply' },
      entry: { placement: 'offboard', pins: ['+', '-'] },
      posts: [{ userData: { terminalRef: 'PS1:+' } }], // not pickable: the pointer is beside it
      attach: [p.clone()],
      built: { object: new THREE.Group() },
    })
    const beside = r.at(p)
    beside.clientX += 8 // within TERMINAL_HOVER_SLOP_PX (14 px)
    expect(r.hover(beside)).toBe('')
    expect(r.press(beside)).toBe(false) // was: a wire from PS1:+ nobody was shown
    expect(r.cb.wireDrawStart).not.toHaveBeenCalled()
    expect(r.s.m.controls.enabled).toBe(true)
    // the post itself (pickable): crosshair and a wire
    const r2 = rig()
    const post = r2.box(r2.s.m.terminalsGroup, p, 0.3, { terminalRef: 'PS1:+' })
    r2.s.components.set('PS1', { comp: { id: 'PS1', type: 'power_supply' }, entry: { placement: 'offboard', pins: ['+'] }, posts: [post], attach: [p.clone()], built: { object: new THREE.Group() } })
    expect(r2.hover(r2.at(p))).toBe('crosshair')
    expect(r2.press(r2.at(p))).toBe(true)
    expect(r2.cb.wireDrawStart).toHaveBeenCalledWith('PS1:+')
  })
})

describe('(e) a drop on a part’s leg lands on the free hole of its strip', () => {
  const note = 'c27 被 R1 第 2 腳佔用 → 接到同一排的 a27'
  const withLanding = () => {
    const r = rig()
    const landing = vi.fn((_from: string, to: string) => (to === 'c27' ? { to: 'a27', note } : to === 'c29' ? null : { to, note: null }))
    r.scene.setCallbacks({ wireDrawLanding: landing })
    return { ...r, landing }
  }

  it('the route, the ring and the chip go to the hole the wire will use; the drop asks with the aimed leg', () => {
    const { s, cb, at, press, move, landing, chipTexts } = withLanding()
    press(at('a25'))
    move(at('c27'))
    expect(landing).toHaveBeenLastCalledWith('a25', 'c27')
    expect(cb.onWireDrawPreview).not.toHaveBeenCalled() // the landing question replaces it
    expect(s.wireEndDrag).toMatchObject({ valid: true, land: 'a27', landNote: note, previewKey: 'a27' })
    expect(s.wireEndDrag!.preview!.material).toBe(s.m.previewMat) // a green-light route, not the red one
    expect(chipTexts.at(-1)).toBe(note)
    const ring = s.m.hoverRing.object.position
    expect([ring.x, ring.z]).toEqual([holeAt('a27').x, holeAt('a27').z])
    // a plain hole again: the aim pass’s own chip
    move(at('a29'))
    expect(s.wireEndDrag).toMatchObject({ land: 'a29', landNote: null, previewKey: 'a29' })
    expect(chipTexts.at(-1)).toBe('a29')
    move(at('c27'))
    s.finishEditDrags(at('c27'))
    expect(cb.onWireDraw).toHaveBeenCalledWith('a25', 'c27')
    expect(cues).not.toContain('settle')
  })

  it('no landing (a full strip): the red route to the aimed point', () => {
    const { s, at, press, move } = withLanding()
    press(at('a25'))
    move(at('c29'))
    expect(s.wireEndDrag).toMatchObject({ valid: false, land: null, previewKey: 'c29!' })
    expect(s.wireEndDrag!.preview!.material).not.toBe(s.m.previewMat)
  })
})

describe('(f) a start a pin’s press moved is named', () => {
  it('while the wire aims at nothing the chip says where it starts; the drop tells the host the pin pressed', () => {
    const { s, scene, cb, at, press, move, chipTexts } = rig({ target: 'c21' })
    const note = 'c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線'
    const startText = vi.fn(() => note)
    scene.setCallbacks({ wireDrawStartText: startText })
    s.pinOwner.set('c21', 'U1')
    cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'c21' ? 'a21' : ref))
    press(at('c21'))
    move(at(holeAt('c21').add(new THREE.Vector3(0, 0, -9)))) // off the board: no target
    expect(s.wireEndDrag!.started).toBe(true)
    expect(startText).toHaveBeenCalledWith('c21', 'a21')
    expect(chipTexts.at(-1)).toBe(note)
    move(at('a24'))
    expect(chipTexts.at(-1)).toBe('a24')
    s.finishEditDrags(at('a24'))
    expect(cb.onWireDraw).toHaveBeenCalledWith('a21', 'a24', 'c21')
  })
})

describe('(h) the one-time tip: the scene asks on the crosshair’s off → on over a free hole', () => {
  it('a free hole asks once while the pointer stays; leaving and coming back asks again (the host keeps it once)', () => {
    const { scene, s, at, hover } = rig()
    const hint = vi.fn()
    scene.setCallbacks({ onWireDrawHint: hint })
    expect(hover(at('a25'))).toBe('crosshair')
    hover(at('a25'))
    expect(hint).toHaveBeenCalledTimes(1)
    hover(at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0.5))))
    hover(at('a26'))
    expect(hint).toHaveBeenCalledTimes(2)
    // a part's pin or a wire's end: a crosshair, but not the free-hole tip
    s.pinOwner.set('a28', 'R1')
    hover(at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0.5))))
    hover(at('a28'))
    expect(hint).toHaveBeenCalledTimes(2)
  })
})

describe('(i) a finger’s grip says what a lift and a drag do', () => {
  it('a new wire’s grip and a wire end’s grip show the host’s words on the pressed point', () => {
    vi.useFakeTimers()
    const touch = { pointerType: 'touch' } as const
    const r = rig()
    const grip = vi.fn((ref: string, wireId: string | null) => `${ref} · ${wireId ? 'end' : 'new'}`)
    r.scene.setCallbacks({ wireGripText: grip })
    r.press(r.at('a25', touch))
    vi.advanceTimersByTime(510)
    expect(grip).toHaveBeenCalledWith('a25', null)
    expect(r.chipTexts.at(-1)).toBe('a25 · new')
    r.s.finishEditDrags(r.at('a25', touch))
    // a wire end (SC-13's touch grip)
    const w = rig()
    w.scene.setCallbacks({ wireGripText: grip })
    w.s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    w.s.pinOwner.set('a25', 'W1')
    const e = w.at('a25', touch)
    w.s.updateNdc(e)
    w.s.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: 1, type: 'touch', maxDrift: 0 }
    expect(w.s.beginWireEndDrag(e)).toBe(true)
    vi.advanceTimersByTime(510)
    expect(grip).toHaveBeenLastCalledWith('a25', 'W1')
    expect(w.chipTexts.at(-1)).toBe('a25 · end')
  })
})

describe('(k) the drop’s sounds in the scene', () => {
  it('a refused re-route leaves the sound to the host; released away it springs back (settle)', () => {
    const r = rig()
    r.s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    r.s.pinOwner.set('a25', 'W1')
    r.cb.onWireEndPreview.mockImplementation((_i: string, _e: string, ref: string) => ref !== 'a28')
    r.press(r.at('a25'), 'W1')
    r.move(r.at('a28'))
    expect(r.s.wireEndDrag!.valid).toBe(false)
    r.s.finishEditDrags(r.at('a28'))
    expect(r.cb.onWireEndMove).toHaveBeenCalledWith('W1', 'to', 'a28')
    expect(cues).not.toContain('settle')
    // released on nothing: the end springs back audibly
    r.press(r.at('a25'), 'W1')
    r.move(r.at(holeAt('a25').add(new THREE.Vector3(0, 0, -9))))
    r.s.finishEditDrags(r.at(holeAt('a25').add(new THREE.Vector3(0, 0, -9))))
    expect(cues.at(-1)).toBe('settle')
  })
})

// ============================================================ the host

/** R2 at d40–d44, W3 / W8 on other strips, PS1 off the board. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R2', type: 'resistor', holes: ['d40', 'd44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W3', from: 'a20', to: 'e30', color: 'yellow' },
    { id: 'W8', from: 'a25', to: 'e50', color: 'green' },
  ],
}
const lastToast = () => getToasts().at(-1)
const wires = () => useStore.getState().layout.wires

describe('host: the leg drop, the start note, the grip, the re-route undo, the refusal sound', () => {
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetHistoryForTests()
    useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, telemetry: null })
    vi.mocked(playMech).mockClear()
  })
  afterEach(() => __setLangForTests('zh-TW'))

  it('(e) a drop on R2’s leg lands on the free hole of its strip nearest the leg, and says so', () => {
    expect(landingOf(LAYOUT, 'a60', 'd44')).toMatchObject({ kind: 'redirect', to: 'c44', hole: 'd44', rail: false })
    const land = wireDrawLanding('a60', 'd44')
    expect(land).toEqual({ to: 'c44', note: expect.stringMatching(/^d44 被 R2 .+佔用 → 接到同一排的 c44$/) })
    expect(wireDrawLanding('a60', 'a61')).toEqual({ to: 'a61', note: null })
    drawWire('a60', 'd44')
    const w = wires().at(-1)!
    expect([w.from, w.to]).toEqual(['a60', 'c44'])
    expect(lastToast()!.text).toMatch(/^已接上 a60 → c44（d44 被 R2 .+佔用，改接同一排）$/)
    expect(lastToast()!.action?.label).toBe(t('Undo'))
    expect(playMech).not.toHaveBeenCalled()
  })

  it('(e) a leg on the start’s own strip, or a strip with no free hole: refused, with the refusal sound', () => {
    // c40 → b40 would join the strip to itself — final round: its own reason (tests/final-wiring.test.ts)
    expect(landingOf(LAYOUT, 'c40', 'd40')).toMatchObject({ kind: 'joined', hole: 'd40', rail: false })
    const full: CircuitLayout = {
      ...LAYOUT,
      wires: [
        ...LAYOUT.wires,
        { id: 'W4', from: 'a44', to: 'a62', color: 'yellow' },
        { id: 'W5', from: 'b44', to: 'b62', color: 'yellow' },
        { id: 'W6', from: 'c44', to: 'c62', color: 'yellow' },
        { id: 'W7', from: 'e44', to: 'e62', color: 'yellow' },
      ],
    }
    useStore.setState({ layout: full })
    expect(wireDrawLanding('a60', 'd44')).toBeNull()
    drawWire('a60', 'd44')
    expect(wires()).toEqual(full.wires)
    expect(lastToast()!.text).toMatch(/^這裡不能接：d44 已經被 R2 .+佔用——這一排已經沒有空孔$/)
    expect(playMech).toHaveBeenCalledWith('refuse')
  })

  it('(k) a refused drop sounds; released on nothing is silent', () => {
    drawWire('c40', 'a20') // W3's end: refused
    expect(playMech).toHaveBeenCalledTimes(1)
    expect(playMech).toHaveBeenCalledWith('refuse')
    drawWire('c40', null)
    expect(playMech).toHaveBeenCalledTimes(1)
  })

  it('(f) a start moved off R2’s leg: the chip’s words and the toast name it', () => {
    expect(wireDrawStartText('d40', 'c40')).toMatch(/^d40 被 R2 .+佔用，已改從同一排的 c40 拉線$/)
    expect(wireDrawStartText('a60', 'a60')).toBeNull()
    drawWire('c40', 'a60', 'd40')
    expect(lastToast()!.text).toMatch(/^已接上 c40（d40 被 R2 .+佔用，改從同一排接出）→ a60$/)
  })

  it('(i) the grip’s words: the point, then what a lift and a drag do', () => {
    expect(wireGripText('a60', null)).toBe('a60 · 放開：探測選單／拖曳：拉線')
    expect(wireGripText('a25', 'W8')).toBe('a25 · 放開：探測選單／拖曳：改接這一端')
  })

  it('(g) a re-routed end: 「已改接導線 …」 with 〔復原〕 (one tap takes it back); a refusal sounds', () => {
    moveWireEndTo('W8', 'to', 'e55')
    expect(wires().find((w) => w.id === 'W8')?.to).toBe('e55')
    const toast = lastToast()!
    expect(toast.text).toMatch(/^已改接導線 W8：/)
    expect(toast.action?.label).toBe(t('Undo'))
    toast.action!.run()
    expect(wires().find((w) => w.id === 'W8')?.to).toBe('e50')
    moveWireEndTo('W8', 'to', 'a20') // W3's end
    expect(playMech).toHaveBeenCalledWith('refuse')
  })

  it('(h) the wire mode hint is short again', () => {
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' }, false)).toBe('導線模式：依序點兩個孔位或端子 · Esc 結束')
  })
})

describe('host (h): the one-time tip', () => {
  let store: Map<string, string>
  let search = ''
  let coarse = false
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetWireDrawTipForTests()
    store = new Map([['bb.onboarded', '1']])
    search = ''
    coarse = false
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q.includes('coarse') ? coarse : false }),
      location: {
        get search() {
          return search
        },
      },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    })
  })
  const tips = () => getToasts().filter((x) => x.text === '小提示：按住孔位拖到另一個孔位，就能拉線').length

  it('once per browser: the first rest on a free hole shows it and remembers', () => {
    const n = tips()
    wireDrawHint()
    expect(tips()).toBe(n + 1)
    expect(store.get(WIRE_DRAW_TIP_KEY)).toBe('1')
    wireDrawHint()
    expect(tips()).toBe(n + 1)
    __resetWireDrawTipForTests() // a new page: the flag answers
    wireDrawHint()
    expect(tips()).toBe(n + 1)
  })

  it('never under ?shotrig, on a finger, in the classic chrome, or before the tour is done (then later)', () => {
    const n = tips()
    search = '?e2e&shotrig'
    wireDrawHint()
    coarse = true
    search = ''
    __resetWireDrawTipForTests()
    wireDrawHint()
    coarse = false
    __setLangForTests('en')
    __resetWireDrawTipForTests()
    wireDrawHint()
    __setLangForTests('zh-TW')
    store.delete('bb.onboarded')
    __resetWireDrawTipForTests()
    wireDrawHint()
    expect(tips()).toBe(n)
    expect(store.has(WIRE_DRAW_TIP_KEY)).toBe(false)
    store.set('bb.onboarded', '1')
    wireDrawHint()
    expect(tips()).toBe(n + 1)
  })
})

// ============================================================ (j) quiet re-burn

describe('(j) a part that burns again for the same reason after an edit: no burst, no pop', () => {
  const comp = { id: 'LED1', type: 'led', holes: ['a10', 'a11'], params: { color: 'red' } }
  let circuit: object = {}
  let part: string | null = fxPartKey(comp)
  const host: SceneFxHost = {
    bounds: (_id, out) => {
      out.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1))
      return true
    },
    pinWorld: () => null,
    ids: () => ['LED1'],
    partKey: () => part,
    circuit: () => circuit,
  }
  const snap = (time: number, burnedSince: number | null): SimTelemetry => ({
    time,
    netVoltages: {},
    issues: [],
    components: { LED1: burnedSince === null ? { pinVoltages: {}, burned: false } : { pinVoltages: {}, burned: true, damage: { kind: 'burned', since: burnedSince } } },
  })
  const burns = () => cues.filter((c) => c === 'burn').length
  beforeEach(() => {
    circuit = {}
    part = fxPartKey(comp)
  })

  it('edit → heal → the same burn again: the burned look only, every time', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(1, 0.999))
    expect(burns()).toBe(1)
    const particles = fx.particleCount
    expect(particles).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) {
      circuit = {} // an edit elsewhere (a wire added): the circuit rebuilds and heals
      fx.setTelemetry(snap(2 + i, null))
      fx.setTelemetry(snap(2.01 + i, 2.005 + i))
    }
    expect(burns()).toBe(1)
    fx.dispose()
  })

  it('…and with no healthy frame between (the reload re-burns at once), or a stopped session between', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(1, 0.999))
    circuit = {}
    fx.setTelemetry(snap(1.2, 1.19))
    expect(burns()).toBe(1)
    circuit = {}
    fx.setTelemetry(null)
    fx.setTelemetry(snap(0.01, 0.005))
    expect(burns()).toBe(1)
    fx.dispose()
  })

  it('news again: the part itself changed, 換新 without an edit, or fixed (healthy across an edit) then broken', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(1, 0.999))
    // the LED moved / re-valued: a different part in this place
    circuit = {}
    part = fxPartKey({ ...comp, holes: ['a12', 'a13'] })
    fx.setTelemetry(snap(2, null))
    fx.setTelemetry(snap(2.01, 2.005))
    expect(burns()).toBe(2)
    // 換新 (no edit): the same circuit, the same part — it burns again, visibly
    fx.setTelemetry(snap(3, null))
    fx.setTelemetry(snap(3.01, 3.005))
    expect(burns()).toBe(3)
    // fixed (healthy) — then another edit breaks it again
    circuit = {}
    fx.setTelemetry(snap(4, null))
    fx.setTelemetry(snap(5, null))
    circuit = {}
    fx.setTelemetry(snap(6, null))
    fx.setTelemetry(snap(6.01, 6.005))
    expect(burns()).toBe(4)
    fx.dispose()
  })

  it('the part key: id, type, holes and every param (sorted) — runtime ones too', () => {
    expect(fxPartKey({ id: 'R1', type: 'resistor', holes: ['a1', 'a5'], params: { b: 1, a: 2 } })).toBe(
      fxPartKey({ id: 'R1', type: 'resistor', holes: ['a1', 'a5'], params: { a: 2, b: 1 } }),
    )
    expect(fxPartKey({ id: 'R1', type: 'resistor', holes: ['a1', 'a5'], params: { a: 2 } })).not.toBe(
      fxPartKey({ id: 'R1', type: 'resistor', holes: ['a1', 'a5'], params: { a: 3 } }),
    )
    expect(fxPartKey(undefined)).toBeNull()
  })
})
