/**
 * Keep-pressed latch 「保持按下」 — the 3D side:
 *  - LatchGesture (src/three/internal/latch-mark.ts): a double-click on a
 *    pressable part asks to keep it pressed; on a latched part the first
 *    click releases it and the second presses nothing; slow clicks, drags
 *    and a host without latch support stay momentary;
 *  - the scene (headless): endPress reports onObjectLatch instead of the
 *    release, setLatchedParts floats a lock badge over the part and drops it;
 *  - the hover chip (hole-chip.ts): 「按住即可按下 · 雙擊保持按下」, and
 *    「已保持按下 · 按一下放開」 while kept pressed — on the pin and the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { useStore } from '../src/state/store'
import { BreadboardScene } from '../src/three/scene'
import { LATCH_MARK_MIN_PX, LATCH_MARK_SIZE, LatchGesture, makeLatchMark, sizeLatchMark } from '../src/three/internal/latch-mark'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { holeChipTextFor, objectChipText, pressHintText } from '../src/ui/workspace/hole-chip'
import { setLatched, useLatchHolds, pressMomentary } from '../src/ui/embedded/latch'
import { getEntry } from '../src/model/catalog'

const W = 450

describe('LatchGesture — the double-click rule', () => {
  it('two quick clicks on an unlatched part: the second asks to latch', () => {
    const g = new LatchGesture(W)
    const a = g.down('SW1', 0, false)
    expect(a).toEqual({ id: 'SW1', second: false, wasLatched: false, swallowed: false })
    expect(g.up(a, true, 100, true)).toBe('release')
    const b = g.down('SW1', 300, false)
    expect(b.second).toBe(true)
    expect(g.up(b, true, 380, true)).toBe('latch')
    // a third quick click starts afresh: an ordinary press of the (now latched) part
    const c = g.down('SW1', 500, true)
    expect(c.second).toBe(false)
    expect(g.up(c, true, 560, true)).toBe('release')
  })

  it('a double-click on a latched part: the first click releases it, the second presses nothing', () => {
    const g = new LatchGesture(W)
    const a = g.down('SW1', 0, true)
    expect(g.up(a, true, 90, true)).toBe('release')
    const b = g.down('SW1', 250, false) // released by the first click
    expect(b.swallowed).toBe(true)
    expect(g.up(b, true, 320, true)).toBe('none')
  })

  it('stays momentary: a slow second click, another part, a held (not quick) press, a drag, no host support', () => {
    const slow = new LatchGesture(W)
    slow.up(slow.down('SW1', 0, false), true, 100, true)
    expect(slow.down('SW1', 100 + W + 1, false).second).toBe(false)

    const other = new LatchGesture(W)
    other.up(other.down('SW1', 0, false), true, 100, true)
    expect(other.down('SW2', 200, false).second).toBe(false)

    const held = new LatchGesture(W)
    held.up(held.down('SW1', 0, false), false, 900, true) // a press-and-hold is not half of a double-click
    expect(held.down('SW1', 1000, false).second).toBe(false)

    const drag = new LatchGesture(W)
    drag.up(drag.down('SW1', 0, false), true, 100, true)
    const d = drag.down('SW1', 200, false)
    expect(drag.up(d, false, 260, true)).toBe('release') // the second press moved / lasted: momentary

    const none = new LatchGesture(W)
    none.up(none.down('SW1', 0, false), true, 100, true)
    const n = none.down('SW1', 200, false)
    expect(none.up(n, true, 260, false)).toBe('release')
  })

  it('reset forgets the first half of a double-click', () => {
    const g = new LatchGesture(W)
    g.up(g.down('SW1', 0, false), true, 100, true)
    g.reset()
    expect(g.down('SW1', 200, false).second).toBe(false)
  })
})

describe('the lock badge', () => {
  it('sits over the back-right corner of the part top, never picked, drawn over the board', () => {
    const box = new THREE.Box3(new THREE.Vector3(10, 0, 4), new THREE.Vector3(13, 1.2, 7))
    const s = makeLatchMark(box)
    expect(s.name).toBe('latch-mark')
    expect(s.position.y).toBeGreaterThan(1.2)
    expect(s.position.x).toBeGreaterThan(11.5)
    expect(s.position.z).toBeLessThan(5.5)
    expect(s.scale.x).toBeCloseTo(LATCH_MARK_SIZE)
    const hits: THREE.Intersection[] = []
    s.raycast(new THREE.Raycaster(), hits)
    expect(hits).toEqual([])
    expect((s.material as THREE.SpriteMaterial).depthTest).toBe(false)
    // one shared material for every badge
    expect(makeLatchMark(box).material).toBe(s.material)
  })

  it('keeps at least LATCH_MARK_MIN_PX on screen from afar, its world size up close', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 1.2, 3))
    const s = makeLatchMark(box)
    const cam = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 1000)
    const px = () => (s.scale.y / (2 * cam.position.distanceTo(s.position) * Math.tan((45 * Math.PI) / 360))) * 900
    cam.position.set(0, 120, 120) // the whole-circuit view
    sizeLatchMark(s, cam, 900)
    expect(px()).toBeGreaterThanOrEqual(LATCH_MARK_MIN_PX - 0.5)
    cam.position.set(2, 8, 8) // a close-up
    sizeLatchMark(s, cam, 900)
    expect(s.scale.x).toBeCloseTo(LATCH_MARK_SIZE)
  })
})

// ---------------------------------------------------------------------------
// the scene (headless: a stand-in for its mounted camera / groups)
// ---------------------------------------------------------------------------

interface Internals {
  m: unknown
  press: unknown
  downInfo: unknown
  latchGesture: LatchGesture
  components: Map<string, unknown>
  endPress(e: { pointerId: number; clientX: number; clientY: number }): void
}

function headless() {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 1000)
  camera.position.set(14, 40, 48)
  camera.lookAt(new THREE.Vector3(30, 0, 8))
  camera.updateMatrixWorld()
  const overlayGroup = new THREE.Group()
  s.m = {
    container: { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 },
    camera,
    controls: { target: new THREE.Vector3(30, 0, 8), update: () => {}, touches: {} },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) } },
    overlayGroup,
    componentsGroup: new THREE.Group(),
    wiresGroup: new THREE.Group(),
    terminalsGroup: new THREE.Group(),
    objectPickRoots: [],
    hoverPickRoots: [],
    paddles: [],
    holeLabel: makeHoleLabel(),
    screenChip: makeScreenChip(),
    hoverRing: makeHoverRing(),
    clock: new THREE.Clock(),
  }
  // a pushbutton record: its built object is a 3 × 1.2 × 3 box at x 10..13, z 4..7
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 3))
  body.position.set(11.5, 0.6, 5.5)
  const object = new THREE.Group()
  object.add(body)
  object.updateMatrixWorld(true)
  s.components.set('SW1', {
    comp: { id: 'SW1', type: 'pushbutton', at: 'f50' },
    entry: getEntry('pushbutton'),
    built: { object },
    signature: 'sw1@f50',
  })
  return { scene, s, overlayGroup }
}

/** One mouse click on SW1 at `at` ms: pointerdown (the scene's press branch) then pointerup. */
function click(s: Internals, latched: boolean, at: number, now: { t: number }) {
  now.t = at
  s.downInfo = { x: 100, y: 100, t: at, id: 1, type: 'mouse', maxDrift: 0 }
  const g = s.latchGesture.down('SW1', at, latched)
  s.press = { id: 'SW1', pointerId: 1, t0: null, g }
  now.t = at + 60
  s.endPress({ pointerId: 1, clientX: 100, clientY: 100 })
  return g
}

describe('the scene: double-click → onObjectLatch, lock badges', () => {
  let now: { t: number }
  beforeEach(() => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    now = { t: 0 }
    vi.spyOn(performance, 'now').mockImplementation(() => now.t)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('the second quick click asks the host to keep the part pressed instead of letting go', () => {
    const { scene, s } = headless()
    const onObjectPress = vi.fn()
    const onObjectLatch = vi.fn(() => true)
    scene.setCallbacks({ onObjectPress, onObjectLatch })
    click(s, false, 1000, now)
    expect(onObjectPress).toHaveBeenLastCalledWith('SW1', false) // the first click: momentary
    onObjectPress.mockClear()
    click(s, false, 1300, now)
    expect(onObjectLatch).toHaveBeenCalledWith('SW1')
    expect(onObjectPress).not.toHaveBeenCalled() // no release: it stays pressed
    expect(s.press).toBeNull()
  })

  it('a host that declines the latch gets the ordinary release', () => {
    const { scene, s } = headless()
    const onObjectPress = vi.fn()
    scene.setCallbacks({ onObjectPress, onObjectLatch: () => false })
    click(s, false, 1000, now)
    onObjectPress.mockClear()
    click(s, false, 1300, now)
    expect(onObjectPress).toHaveBeenCalledWith('SW1', false)
  })

  it('a latched part: the first click releases it, the swallowed second click reports nothing', () => {
    const { scene, s } = headless()
    const onObjectPress = vi.fn()
    const onObjectLatch = vi.fn(() => true)
    scene.setCallbacks({ onObjectPress, onObjectLatch })
    scene.setLatchedParts(['SW1'])
    click(s, true, 1000, now)
    expect(onObjectPress).toHaveBeenLastCalledWith('SW1', false)
    scene.setLatchedParts([]) // the host let it go
    onObjectPress.mockClear()
    const g = click(s, false, 1250, now)
    expect(g.swallowed).toBe(true)
    expect(onObjectPress).not.toHaveBeenCalled()
    expect(onObjectLatch).not.toHaveBeenCalled()
  })

  it('setLatchedParts floats one badge over the latched part and drops it on release', () => {
    const { scene, overlayGroup } = headless()
    scene.setLatchedParts(['SW1', 'GONE']) // an id without a part draws nothing
    const group = overlayGroup.children.find((c) => c.name === 'latch-marks')
    expect(group).toBeDefined()
    expect(group!.children.map((c) => c.name)).toEqual(['latch-mark'])
    const mark = group!.children[0]
    expect(mark.position.y).toBeGreaterThan(1.2) // over the part's top
    scene.setLatchedParts(['SW1', 'GONE']) // same set: nothing rebuilt
    expect(overlayGroup.children.filter((c) => c.name === 'latch-marks')).toHaveLength(1)
    scene.setLatchedParts([])
    expect(overlayGroup.children.find((c) => c.name === 'latch-marks')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// the hover chip
// ---------------------------------------------------------------------------

const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'SW1', type: 'pushbutton', at: 'f50' },
    { id: 'R1', type: 'resistor', holes: ['a36', 'a40'] },
  ],
  wires: [],
}
const SESSION: SimTelemetry = { time: 1, netVoltages: {}, components: {}, issues: [] }

describe('the hover chip says how to keep it pressed', () => {
  beforeEach(() => {
    __setLangForTests('zh-TW')
    useLatchHolds.setState({ held: [] })
    useStore.setState({ layout: LAYOUT, selection: [], telemetry: null })
  })
  afterEach(() => {
    __setLangForTests('zh-TW')
    useStore.setState({ telemetry: null })
    useLatchHolds.setState({ held: [] })
  })

  it('on a pin: 按住即可按下 · 雙擊保持按下, then 已保持按下 · 按一下放開', () => {
    expect(holeChipTextFor(LAYOUT, 'f50', SESSION)).toMatch(/^SW1 .+ · f50 · 按住即可按下 · 雙擊保持按下$/)
    expect(holeChipTextFor(LAYOUT, 'f50')).not.toMatch(/按住|保持/) // no session: no press hint
    const kept: CircuitLayout = { ...LAYOUT, components: [{ ...LAYOUT.components[0], params: { pressed: true } }, LAYOUT.components[1]] }
    expect(holeChipTextFor(kept, 'f50', SESSION)).toMatch(/^SW1 .+ · f50 · 已保持按下 · 按一下放開$/)
    expect(pressHintText(kept, 'SW1')).toBe('已保持按下 · 按一下放開')
  })

  it('on the body (object chip): the press hint replaces 點一下選取 during a session', () => {
    expect(objectChipText('SW1')).toMatch(/^SW1 · .+ ?· 點一下選取$/) // no session
    useStore.setState({ telemetry: SESSION })
    expect(objectChipText('SW1')).toMatch(/^SW1 · .+ ?· 按住即可按下 · 雙擊保持按下$/)
    useStore.getState().select('SW1')
    expect(objectChipText('SW1')).toMatch(/^SW1 · .+ ?· 已選取 · 按住即可按下 · 雙擊保持按下$/)
    setLatched('SW1', true)
    expect(objectChipText('SW1')).toMatch(/^SW1 · .+ ?· 已選取 · 已保持按下 · 按一下放開$/)
    pressMomentary('SW1', true) // a finger on it: the hint is the momentary one again
    expect(objectChipText('SW1')).toMatch(/按住即可按下 · 雙擊保持按下$/)
    pressMomentary('SW1', false)
    // a part that cannot be pressed keeps the plain chip
    expect(objectChipText('R1')).toMatch(/^R1 · .+ ?· 點一下選取$/)
  })

  it('English: hold to press · double-click to keep pressed', () => {
    __setLangForTests('en')
    expect(pressHintText(LAYOUT, 'SW1')).toBe('hold to press · double-click to keep pressed')
  })
})
