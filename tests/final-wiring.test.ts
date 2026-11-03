/**
 * Round 5 final pass, stream "wiring" — drag-to-wire edge cases the polish
 * verifier left (src/three/scene.ts, src/ui/workspace/wire-draw.ts):
 *
 *  (a) a drop on the START's own strip / rail — a part's leg or a free hole —
 *      says why it does nothing, the same way for both: the aim chip (red,
 *      beside the red route) and the toast 「這裡不能接：d40 跟起點在同一排，
 *      本來就是通的」 with the refusal sound;
 *  (b) hover and press agree on a part pin whose strip has no free hole: the
 *      hover asks the host's wireDrawStart (memoised) — no crosshair there; a
 *      press is the part's (it orbits, a hold opens the part's sheet exactly
 *      like a hold on its body);
 *  (c) a wire aimed at NOTHING hangs faint (not the red of a refused target),
 *      so the neutral start note beside it is no mixed signal;
 *  (d) a pen: a press-and-hold then a lift without a move on a hole / pin /
 *      wire end opens the probe sheet like a finger (the grip chip shows at
 *      the hold); a quick pen click and a mouse are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

vi.mock('../src/ui/fx/sound', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/ui/fx/sound')>()
  return { ...orig, playMech: vi.fn() }
})

import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip, type ChipTone } from '../src/three/internal/hole-fx'
import { setFxCueSink, type FxCue } from '../src/three/internal/fx/scene-fx'
import { holePosition, parseHole } from '../src/model/breadboard'
import type { SceneCallbacks } from '../src/three/scene-api'
import type { CircuitLayout } from '../src/model/types'
import { __setLangForTests } from '../src/i18n'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { getToasts } from '../src/ui/kit/toasts'
import { playMech } from '../src/ui/fx/sound'
import { drawWire, joinedRefusalText, landingOf, wireDrawLanding, wireDrawStart } from '../src/ui/workspace/wire-draw'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================ the scene rig

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
    previewMat: THREE.Material
    fingertipGroup: THREE.Group
  }
  layout: CircuitLayout
  dockedChrome: boolean | null
  pinOwner: Map<string, string>
  wires: Map<string, { wire: { id: string; from: string; to: string }; group: THREE.Group; signature: string }>
  wireEndDrag: {
    wireId: string | null
    from: string | null
    pressed: string | null
    armed: boolean
    held: boolean
    started: boolean
    valid: boolean
    land: string | null
    landNote: string | null
    previewKey: string
    preview: THREE.Mesh | null
  } | null
  downInfo: { x: number; y: number; t: number; id: number; type: string; maxDrift: number } | null
  tapSuppressed: boolean
  updateNdc(e: Ev): void
  beginWireDraw(e: Ev, id: string | null): boolean
  updateEditDrags(e: Ev, drift: number): void
  finishEditDrags(e: Ev): boolean
  startLongPress(id: string | null): void
  processHover(m: unknown): void
}

function holeAt(ref: string): THREE.Vector3 {
  const p = holePosition(parseHole(ref)!)
  return new THREE.Vector3(p.x, 0, p.z)
}

/** The product chrome's scene looking at `target` (≈ 48 px per hole pitch there) — tests/polish-scene.test.ts's rig. */
function rig(opts: { target?: string } = {}) {
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
  const chipTones: ChipTone[] = []
  chip.setText = (x: string) => void chipTexts.push(x)
  chip.setTone = (x: ChipTone) => void chipTones.push(x)
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
  s.dockedChrome = true
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
    wireGripText: vi.fn((ref: string, wireId: string | null) => `${ref} · ${wireId ? 'end' : 'new'}`),
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
  /** pointerdown as onPointerDown runs it for a mouse / pen: the body long-press first, then the drag-to-wire branch */
  const press = (e: Ev, id: string | null = null): boolean => {
    s.updateNdc(e)
    s.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId ?? 1, type: e.pointerType, maxDrift: 0 }
    if (id !== null) s.startLongPress(id)
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
  const box = (group: THREE.Group, p: THREE.Vector3, size: number, data: Record<string, unknown>) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial())
    mesh.position.copy(p)
    mesh.userData = data
    group.add(mesh)
    mesh.updateMatrixWorld(true)
    return mesh
  }
  return { scene, s, cb, at, press, move, hover, box, chipTexts, chipTones }
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

// ============================================================ (a) host

/** R2 at d40–d44, W3 on other strips, PS1 off the board. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R2', type: 'resistor', holes: ['d40', 'd44'], params: { resistance: 330 } },
  ],
  wires: [{ id: 'W3', from: 'a20', to: 'e30', color: 'yellow' }],
}
const lastToast = () => getToasts().at(-1)
const wires = () => useStore.getState().layout.wires

describe('(a) a drop on the start’s own strip / rail: one rule, one reason', () => {
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetHistoryForTests()
    useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, telemetry: null })
    vi.mocked(playMech).mockClear()
  })
  afterEach(() => __setLangForTests('zh-TW'))

  it('a leg on the start’s strip: 「這裡不能接：d40 跟起點在同一排，本來就是通的」 (was the bare 「…已經被 R2 第 1 腳佔用」)', () => {
    expect(landingOf(LAYOUT, 'c40', 'd40')).toEqual({ kind: 'joined', hole: 'd40', rail: false })
    expect(wireDrawLanding('c40', 'd40')).toEqual({ to: null, note: 'd40 跟起點在同一排，本來就是通的' })
    drawWire('c40', 'd40')
    expect(wires()).toEqual(LAYOUT.wires)
    expect(lastToast()!.text).toBe('這裡不能接：d40 跟起點在同一排，本來就是通的')
    expect(playMech).toHaveBeenCalledWith('refuse')
  })

  it('a FREE hole on the start’s strip says the same (it used to add a wire that joined the strip to itself)', () => {
    expect(landingOf(LAYOUT, 'c40', 'a40')).toEqual({ kind: 'joined', hole: 'a40', rail: false })
    expect(wireDrawLanding('c40', 'a40')).toEqual({ to: null, note: 'a40 跟起點在同一排，本來就是通的' })
    drawWire('c40', 'a40')
    expect(wires()).toEqual(LAYOUT.wires)
    expect(lastToast()!.text).toBe('這裡不能接：a40 跟起點在同一排，本來就是通的')
    expect(playMech).toHaveBeenCalledWith('refuse')
  })

  it('a start a leg’s press moved (d40 → c40), dropped on the same strip: the same reason', () => {
    expect(wireDrawStart('d40')).toBe('c40')
    drawWire('c40', 'e40', 'd40')
    expect(wires()).toEqual(LAYOUT.wires)
    expect(lastToast()!.text).toBe('這裡不能接：e40 跟起點在同一排，本來就是通的')
  })

  it('the same rail: 「…跟起點在同一條電源軌上，本來就是通的」', () => {
    expect(landingOf(LAYOUT, 'top-5', 'top-9')).toMatchObject({ kind: 'joined', rail: true })
    drawWire('top-5', 'top-9')
    expect(wires()).toEqual(LAYOUT.wires)
    // a rail hole goes by its tidy name, like the 「已接上 …」 toast and the hover chip (integrator)
    expect(lastToast()!.text).toBe('這裡不能接：上方 − 電源軌第 9 孔跟起點在同一條電源軌上，本來就是通的')
  })

  it('wire mode’s click-click keeps the same rule (App.tsx wireEndpointClick → joinedRefusalText)', () => {
    expect(joinedRefusalText(LAYOUT, 'c40', 'e40')).toBe('這裡不能接：e40 跟起點在同一排，本來就是通的')
    expect(joinedRefusalText(LAYOUT, 'top-5', 'top-9')).toBe('這裡不能接：上方 − 電源軌第 9 孔跟起點在同一條電源軌上，本來就是通的')
    // other nets are none of its business: the store's own checks follow
    expect(joinedRefusalText(LAYOUT, 'c40', 'f40')).toBeNull()
    expect(joinedRefusalText(LAYOUT, 'c40', 'c41')).toBeNull()
    expect(joinedRefusalText(LAYOUT, 'c40', 'c40')).toBeNull()
    const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8')
    const click = app.slice(app.indexOf('function wireEndpointClick('), app.indexOf('function pushWireColors('))
    expect(click).toMatch(/const joined = joinedRefusalText\(st\.layout, from, endpoint\)\s+if \(joined\) \{\s+showWireRefusalToast\(joined\)\s+return/)
    expect(click.indexOf('joinedRefusalText')).toBeLessThan(click.indexOf('st.addWire(from, endpoint, color)'))
  })

  it('the other half of the column, another column, the other rail and a terminal are other nets: they still connect', () => {
    expect(wireDrawLanding('c40', 'f40')).toEqual({ to: 'f40', note: null })
    expect(wireDrawLanding('c40', 'c41')).toEqual({ to: 'c41', note: null })
    expect(wireDrawLanding('top-5', 'top+5')).toEqual({ to: 'top+5', note: null })
    expect(wireDrawLanding('PS1:+', 'c40')).toEqual({ to: 'c40', note: null })
    drawWire('c40', 'f40')
    expect(wires()).toHaveLength(LAYOUT.wires.length + 1)
  })
})

// ============================================================ (a) scene

describe('(a) the scene: the host’s reason rides the red chip beside the red route', () => {
  it('a landing with `to: null` and a note: red route, a red (locked) chip with the note on the aimed hole; the drop still asks', () => {
    const r = rig()
    const note = 'a27 跟起點在同一排，本來就是通的'
    r.scene.setCallbacks({ wireDrawLanding: vi.fn((_f: string, to: string) => (to === 'a27' ? { to: null, note } : { to, note: null })) })
    r.press(r.at('a25'))
    r.move(r.at('a27'))
    expect(r.s.wireEndDrag).toMatchObject({ valid: false, land: null, landNote: note, previewKey: 'a27!' })
    expect(r.s.wireEndDrag!.preview!.material).not.toBe(r.s.m.previewMat)
    expect(r.chipTexts.at(-1)).toBe(note)
    expect(r.chipTones.at(-1)).toBe('locked')
    // another target: the aim pass's own chip again
    r.move(r.at('a30'))
    expect(r.s.wireEndDrag).toMatchObject({ valid: true, landNote: null })
    expect(r.chipTexts.at(-1)).toBe('a30')
    r.move(r.at('a27'))
    r.s.finishEditDrags(r.at('a27'))
    expect(r.cb.onWireDraw).toHaveBeenCalledWith('a25', 'a27')
  })
})

// ============================================================ (b)

describe('(b) a pin whose strip has no free hole: hover and press agree — it is part of its part', () => {
  const fullPin = () => {
    const r = rig()
    r.s.pinOwner.set('a25', 'R1')
    r.box(r.s.m.componentsGroup, holeAt('a25').setY(0.1), 0.3, { componentId: 'R1' }) // its leg, in the hole
    r.cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'a25' ? null : ref))
    return r
  }

  it('no crosshair (the part’s pointer); a free hole beside it still has one', () => {
    const r = fullPin()
    expect(r.hover(r.at('a25'))).toBe('pointer') // was 'crosshair' (the hover never asked the host)
    expect(r.cb.wireDrawStart).toHaveBeenCalledWith('a25')
    expect(r.hover(r.at('a27'))).toBe('crosshair')
  })

  it('the host is asked once per point and layout — not per hover pass; a new layout asks again', () => {
    const r = fullPin()
    r.hover(r.at('a25'))
    r.hover(r.at('a25'))
    r.hover(r.at(holeAt('a25').add(new THREE.Vector3(0.05, 0, 0.05))))
    expect(r.cb.wireDrawStart.mock.calls.filter((c) => c[0] === 'a25')).toHaveLength(1)
    r.s.layout = { version: 1, components: [], wires: [] } // the strip freed up (a wire removed)
    r.cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'a25' ? 'b25' : ref))
    expect(r.hover(r.at('a25'))).toBe('crosshair')
    expect(r.cb.wireDrawStart.mock.calls.filter((c) => c[0] === 'a25')).toHaveLength(2)
  })

  it('a mouse press there draws nothing (an orbit) and a hold opens the part’s sheet — exactly as on its body', async () => {
    vi.useFakeTimers()
    const r = fullPin()
    expect(r.press(r.at('a25'), 'R1')).toBe(false)
    expect(r.s.wireEndDrag).toBeNull()
    expect(r.s.m.controls.enabled).toBe(true)
    vi.advanceTimersByTime(510)
    expect(r.cb.onObjectLongPress).toHaveBeenCalledWith('R1')
    // the body: the same press, the same hold
    const body = rig()
    expect(body.press(body.at(holeAt('a25').add(new THREE.Vector3(0.5, 0, 0.5))), 'R1')).toBe(false)
    vi.advanceTimersByTime(510)
    expect(body.cb.onObjectLongPress).toHaveBeenCalledWith('R1')
  })

  it('a pin whose strip has room keeps the polish rule: a crosshair, and a hold keeps the wire in hand (no sheet)', () => {
    vi.useFakeTimers()
    const r = rig()
    r.s.pinOwner.set('a25', 'R1')
    r.box(r.s.m.componentsGroup, holeAt('a25').setY(0.1), 0.3, { componentId: 'R1' })
    r.cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'a25' ? 'b25' : ref))
    expect(r.hover(r.at('a25'))).toBe('crosshair')
    expect(r.press(r.at('a25'), 'R1')).toBe(true)
    vi.advanceTimersByTime(900)
    expect(r.cb.onObjectLongPress).not.toHaveBeenCalled()
  })
})

// ============================================================ (c)

describe('(c) aimed at nothing: the wire in hand hangs faint — red is a target that refuses', () => {
  it('a new wire off the board: neither the preview yellow nor the red; a refused hole: red; a good one: the yellow', () => {
    const r = rig({ target: 'c21' })
    r.cb.onWireDrawPreview.mockImplementation((_f: string, to: string) => to !== 'a28')
    r.press(r.at('a25'))
    r.move(r.at(holeAt('a25').add(new THREE.Vector3(0, 0, -9)))) // off the board: no target
    const d = r.s.wireEndDrag!
    expect(d.started).toBe(true)
    expect(d.previewKey.endsWith('~')).toBe(true)
    const loose = d.preview!.material as THREE.MeshBasicMaterial
    expect(loose).not.toBe(r.s.m.previewMat)
    expect(loose.opacity).toBeLessThan(0.6) // the solid preview is 0.85
    expect(loose.color.getHex()).toBe(0xffd84d) // the preview's yellow, faint — not the refusal red
    r.move(r.at('a28'))
    const red = d.preview!.material as THREE.MeshBasicMaterial
    expect(red).not.toBe(loose)
    expect(red.color.getHex()).toBe(0xff453a)
    r.move(r.at('a30'))
    expect(d.preview!.material).toBe(r.s.m.previewMat)
    r.s.finishEditDrags(r.at('a30'))
  })

  it('a start a pin’s press moved, aiming at nothing: the neutral start note beside a faint route (no red)', () => {
    const r = rig({ target: 'c21' })
    const note = 'c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線'
    r.scene.setCallbacks({ wireDrawStartText: vi.fn(() => note) })
    r.s.pinOwner.set('c21', 'U1')
    r.cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'c21' ? 'a21' : ref))
    r.press(r.at('c21'))
    r.move(r.at(holeAt('c21').add(new THREE.Vector3(0, 0, -9))))
    expect(r.chipTexts.at(-1)).toBe(note)
    expect(r.chipTones.at(-1)).toBe('normal')
    expect((r.s.wireEndDrag!.preview!.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xff453a)
  })

  it('a re-routed wire end aimed at nothing hangs faint too (it springs back on the drop)', () => {
    const r = rig()
    r.s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    r.s.pinOwner.set('a25', 'W1')
    r.press(r.at('a25'), 'W1')
    r.move(r.at(holeAt('a25').add(new THREE.Vector3(0, 0, -9))))
    expect(r.s.wireEndDrag!.previewKey.endsWith('~')).toBe(true)
    r.s.finishEditDrags(r.at(holeAt('a25').add(new THREE.Vector3(0, 0, -9))))
    expect(cues.at(-1)).toBe('settle')
  })
})

// ============================================================ (d)

describe('(d) a pen: hold then lift on a wire point opens the probe sheet, like a finger', () => {
  const pen = { pointerType: 'pen' } as const

  it('a free hole: the hold shows the grip chip; the lift without a move asks for the probe sheet (as a sheet)', () => {
    vi.useFakeTimers()
    const r = rig()
    expect(r.press(r.at('a25', pen))).toBe(true)
    expect(r.s.wireEndDrag).toMatchObject({ armed: true, held: false })
    vi.advanceTimersByTime(510)
    expect(r.s.wireEndDrag!.held).toBe(true)
    expect(r.cb.wireGripText).toHaveBeenCalledWith('a25', null)
    expect(r.chipTexts.at(-1)).toBe('a25 · new')
    // the hover pass leaves the grip chip alone while the pen holds still
    const shown = r.chipTexts.length
    r.hover(r.at('a25', pen))
    expect(r.chipTexts.length).toBe(shown)
    expect(r.s.finishEditDrags(r.at('a25', pen))).toBe(true) // consumed: no click after it
    expect(r.cb.onProbeRequest).toHaveBeenCalledWith({ hole: 'a25' }, expect.anything(), { pointer: 'touch' })
    expect(r.cb.onWireDraw).not.toHaveBeenCalled()
  })

  it('a part pin (the wire would start elsewhere): the sheet measures the pin it pressed', () => {
    vi.useFakeTimers()
    const r = rig({ target: 'c21' })
    r.s.pinOwner.set('c21', 'U1')
    r.cb.wireDrawStart.mockImplementation((ref: string) => (ref === 'c21' ? 'a21' : ref))
    r.press(r.at('c21', pen), 'U1')
    vi.advanceTimersByTime(510)
    expect(r.s.finishEditDrags(r.at('c21', pen))).toBe(true)
    expect(r.cb.onProbeRequest).toHaveBeenCalledWith({ hole: 'c21' }, expect.anything(), { pointer: 'touch' })
    expect(r.cb.onObjectLongPress).not.toHaveBeenCalled() // the part's own sheet stays a body's
  })

  it('a wire’s end: the sheet measures that end', () => {
    vi.useFakeTimers()
    const r = rig()
    r.s.wires.set('W1', { wire: { id: 'W1', from: 'a10', to: 'a25' }, group: new THREE.Group(), signature: '' })
    r.s.pinOwner.set('a25', 'W1')
    expect(r.press(r.at('a25', pen), 'W1')).toBe(true)
    vi.advanceTimersByTime(510)
    expect(r.cb.wireGripText).toHaveBeenLastCalledWith('a25', 'W1')
    expect(r.s.finishEditDrags(r.at('a25', pen))).toBe(true)
    expect(r.cb.onProbeRequest).toHaveBeenCalledWith({ hole: 'a25' }, expect.anything(), { pointer: 'touch' })
    expect(r.cb.onWireEndMove).not.toHaveBeenCalled()
  })

  it('held, then dragged: the wire as before', () => {
    vi.useFakeTimers()
    const r = rig()
    r.press(r.at('a25', pen))
    vi.advanceTimersByTime(510)
    r.move(r.at('a30', pen))
    expect(r.s.wireEndDrag!.started).toBe(true)
    expect(r.s.finishEditDrags(r.at('a30', pen))).toBe(true)
    expect(r.cb.onWireDraw).toHaveBeenCalledWith('a25', 'a30')
    expect(r.cb.onProbeRequest).not.toHaveBeenCalled()
  })

  it('a quick pen click, and a mouse held still, open nothing (the click / the wire in hand as before)', () => {
    vi.useFakeTimers()
    const quick = rig()
    quick.press(quick.at('a25', pen))
    vi.advanceTimersByTime(200)
    expect(quick.s.finishEditDrags(quick.at('a25', pen))).toBe(false)
    expect(quick.cb.onProbeRequest).not.toHaveBeenCalled()
    const mouse = rig()
    mouse.press(mouse.at('a25'))
    vi.advanceTimersByTime(900)
    expect(mouse.s.wireEndDrag!.held).toBe(false)
    expect(mouse.s.finishEditDrags(mouse.at('a25'))).toBe(false)
    expect(mouse.cb.onProbeRequest).not.toHaveBeenCalled()
  })
})
