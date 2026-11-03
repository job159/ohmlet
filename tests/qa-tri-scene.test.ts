/**
 * Release-check triage (scene + lessons replay, 'tri-scene'):
 *
 *  - LS-9 re-run: the 「已結束「…」的步驟引導——電路板上換成了別的電路」 toast
 *    counts its time on screen from the frame that first paints it. Opening
 *    an example holds the main thread for seconds after the store change on
 *    a slow machine (the new circuit's meshes, its firmware); the example's
 *    own toasts then evict the reason ~0.1 s after it was first drawn — it
 *    must come back after that burst instead of being judged "already read"
 *    by the wall clock.
 *  - SC-9 re-run (phone): after 對準電路 the whole i1 / i4 circuit is on
 *    screen at a ~6 px hole pitch; picking 導線 from the dock then ran the
 *    touch arming framing (SC-F1), which cut the whole circuit down about its
 *    centre to reach 14 px and pushed the step's far end (e36 / e40) to
 *    x ≈ 470 on a 390-px screen. While the coach guides a wiring step, the
 *    arming frames that step's targets with the step's own framing (the view
 *    「開始接線」 gives) — both ends on screen; place-arming, no guide and the
 *    desktop are unchanged.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import type { CircuitLayout } from '../src/model/types'
import { parseProject } from '../src/state/project'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import * as THREE from 'three'
import { dismissToast, getToasts, showToast } from '../src/ui/kit'
import {
  guidedWiringFocus,
  loadLessonCircuit,
  provideArmFocus,
  stopGuide,
  watchCircuitChanges,
} from '../src/ui/lessons/actions'
import { useLessonUi } from '../src/ui/lessons/state'
import { useLessonProgress } from '../src/lessons/progress'
import {
  TOUCH_PITCH_TARGET_PX,
  __resetArmFramingForTests,
  armFramingSpec,
  partsSheetCover,
  registerScene,
  setArmFocusSource,
  type BridgeScene,
} from '../src/ui/workspace/scene-bridge'
import type { FrameTargetsOptions, HighlightSpec } from '../src/three/scene-api'
import type { InteractionMode } from '../src/state/types'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'

const LONG = { timeout: 120_000 }
const ENDED = '已結束「LED 與限流電阻」的步驟引導——電路板上換成了別的電路'
const memory = new Map<string, string>()
const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }
const toasts = (): string[] => getToasts().map((x) => x.text)

function blinkExample(): CircuitLayout {
  const raw = readFileSync(path.resolve(__dirname, '../examples/embedded/blink.ohmlet.json'), 'utf8')
  const parsed = parseProject(raw)
  if (!parsed.ok) throw new Error('blink example does not parse')
  return parsed.project.layout
}

/** Manual animation frames: nothing is painted until the test runs them. */
let frames: FrameRequestCallback[] = []
function paintFrames(n = 2): void {
  for (let i = 0; i < n; i++) {
    const run = frames
    frames = []
    for (const cb of run) cb(0)
  }
}

let unwatch: (() => void) | null = null

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __setFirmwareBlobStoreForTests(createMemoryBlobStore())
  reloadLessonProgress()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: EMPTY, selection: [], mode: { kind: 'select' } })
  useLab.setState({ firmware: {}, mcus: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
  for (const x of getToasts()) dismissToast(x.id)
  unwatch = watchCircuitChanges()
})

afterEach(() => {
  vi.useRealTimers()
  registerScene(null)
  setArmFocusSource(null)
  __resetArmFramingForTests()
  useStore.setState({ mode: { kind: 'select' }, selection: [] })
  unwatch?.()
  unwatch = null
  stopGuide()
  for (const x of getToasts()) dismissToast(x.id)
  __setFirmwareBlobStoreForTests(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  frames = []
})

/** b1 guiding, then the clock and the frames under the test's control. */
async function guideB1ThenFreezeFrames(): Promise<void> {
  expect(await loadLessonCircuit(lessonById('b1-led-resistor')!, 'start')).toBe(true)
  expect(useLessonUi.getState().coachId).toBe('b1-led-resistor')
  for (const x of getToasts()) dismissToast(x.id)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
}

describe('the "guide ended" toast survives a slow replacement (LS-9 re-run)', () => {
  it('the main thread held 5 s before the first paint, then the example burst evicts it: it comes back', LONG, async () => {
    await guideB1ThenFreezeFrames()
    expect(useStore.getState().loadLayout(blinkExample()).ok).toBe(true)
    expect(useLessonUi.getState().coachId).toBeNull()
    expect(toasts()).toContain(ENDED)
    // the replacement's work: 5 s with no frame (longer than the toast's own 4.8 s)
    vi.setSystemTime(Date.now() + 5000)
    paintFrames() // first frame after the long task: the toast is drawn now
    vi.advanceTimersByTime(100)
    // the example's own toasts right behind it (the kit keeps the newest two)
    showToast('已開啟「Blue Pill 閃爍 LED（HAL）」')
    showToast('已收合元件庫，讓電路有更多空間（左側把手可展開）')
    expect(toasts()).not.toContain(ENDED)
    vi.advanceTimersByTime(500)
    expect(toasts()).toContain(ENDED)
    // …for most of its time, not a token flash
    const again = getToasts().find((x) => x.text === ENDED)!
    expect(again.duration).toBeGreaterThanOrEqual(4000)
  })

  it('evicted before any frame could draw it: it comes back with its whole time', LONG, async () => {
    await guideB1ThenFreezeFrames()
    useStore.getState().loadLayout(blinkExample())
    vi.setSystemTime(Date.now() + 8000)
    showToast('已開啟「Blue Pill 閃爍 LED（HAL）」')
    showToast('已收合元件庫，讓電路有更多空間（左側把手可展開）')
    vi.advanceTimersByTime(500)
    expect(getToasts().find((x) => x.text === ENDED)?.duration).toBe(4800)
  })

  it('evicted after it was really on screen for its time: it stays gone', LONG, async () => {
    await guideB1ThenFreezeFrames()
    useStore.getState().loadLayout(blinkExample())
    paintFrames()
    vi.advanceTimersByTime(4500)
    showToast('甲')
    showToast('乙')
    vi.advanceTimersByTime(1000)
    expect(toasts()).not.toContain(ENDED)
  })

  it('dismissed by the learner (no newer toast): it stays gone', LONG, async () => {
    await guideB1ThenFreezeFrames()
    useStore.getState().loadLayout(blinkExample())
    paintFrames()
    const id = getToasts().find((x) => x.text === ENDED)!.id
    dismissToast(id)
    vi.advanceTimersByTime(1000)
    expect(toasts()).not.toContain(ENDED)
  })
})

// ---------------------------------------------------------------------------
// SC-9 re-run — the touch arming frames the guided wiring step
// ---------------------------------------------------------------------------

const WIRE: InteractionMode = { kind: 'wire', from: null, color: 'red' }
const PLACE_R: InteractionMode = { kind: 'place', type: 'resistor', pickedHoles: [] }

/** A phone (coarse pointer) or a desktop (fine pointer); the workspace never showing. */
function stubDevice(coarse: boolean): void {
  vi.stubGlobal('window', {
    innerWidth: coarse ? 390 : 1440,
    innerHeight: coarse ? 844 : 900,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {} }),
  })
}

function stubScene(pitch: number) {
  const frames: { spec: HighlightSpec; opts: FrameTargetsOptions | undefined }[] = []
  const scene: BridgeScene = {
    frameContent: () => {},
    frameTargets: (spec, opts) => void frames.push({ spec, opts }),
    setProblemHighlights: () => {},
    holePitchPx: () => pitch,
  }
  return { scene, frames }
}

/** The board holds `id`'s starting circuit and the coach guides step `step` (0-based). */
function guide(id: string, step: number): void {
  const lesson = lessonById(id)!
  expect(useStore.getState().loadLayout(lesson.start.layout).ok).toBe(true)
  useLessonProgress.getState().setStep(id, step)
  useLessonUi.setState({ coachId: id })
}

describe('SC-9 re-run: the wire tool armed on a phone frames the guided wiring step', () => {
  it('i1 step 2 and i4 step 3: the step’s own targets and framing (the view 「開始接線」 gives), never cut down', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(6.2) // the whole circuit after 對準電路
    registerScene(scene)
    partsSheetCover(0)
    const off = provideArmFocus()
    guide('i1-gpio-output', 1)
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(1)
    expect(frames[0].spec).toEqual({ holes: ['a20', 'e36'], components: ['R1', 'LED1'] })
    // no minPitchPx: the 14-px cut about the box centre could drop either end of the step's wire
    expect(frames[0].opts).toEqual({ minSpanHoles: 16, minElevationDeg: 60 })
    useStore.setState({ mode: { kind: 'select' } })
    guide('i4-pwm', 2)
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(2)
    expect(frames[1].spec).toEqual({ holes: ['a25', 'e40'], components: ['R2', 'LED2'] })
    expect(frames[1].opts).toEqual({ minSpanHoles: 16, minElevationDeg: 60 })
    off()
  })

  it('without a guided wiring step (no coach, an observe step, its wire drawn) the arming frames the circuit as before', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(6.2)
    registerScene(scene)
    partsSheetCover(0)
    provideArmFocus()
    // no coach
    const i1 = lessonById('i1-gpio-output')!
    useStore.getState().loadLayout(i1.start.layout)
    expect(guidedWiringFocus()).toBeNull()
    useStore.setState({ mode: WIRE })
    expect(frames[0].spec).toEqual(armFramingSpec(useStore.getState().layout, []))
    expect(frames[0].opts).toEqual({ minSpanHoles: 16, minPitchPx: TOUCH_PITCH_TARGET_PX })
    useStore.setState({ mode: { kind: 'select' } })
    // an observe step (no wire to draw)
    guide('i1-gpio-output', 3)
    expect(guidedWiringFocus()).toBeNull()
    // the step's wire already on the board: nothing left to guide
    guide('i1-gpio-output', 1)
    expect(guidedWiringFocus()).not.toBeNull()
    expect(useStore.getState().loadLayout(i1.solution.layout).ok).toBe(true)
    useLessonUi.setState({ coachId: 'i1-gpio-output' })
    expect(guidedWiringFocus()).toBeNull()
  })

  it('arming a part keeps the circuit framing; a broken source falls back; the desktop never frames', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(6.2)
    registerScene(scene)
    partsSheetCover(0)
    provideArmFocus()
    guide('i1-gpio-output', 1)
    useStore.setState({ mode: PLACE_R })
    expect(frames[0].opts?.minPitchPx).toBe(TOUCH_PITCH_TARGET_PX)
    // a part that goes into the board frames the board's part of the circuit (persona fix: no off-board supply)
    expect(frames[0].spec).toEqual(armFramingSpec(useStore.getState().layout, [], { board: true }))
    useStore.setState({ mode: { kind: 'select' } })
    setArmFocusSource(() => {
      throw new Error('broken')
    })
    useStore.setState({ mode: WIRE })
    expect(frames[1].opts?.minPitchPx).toBe(TOUCH_PITCH_TARGET_PX)
    useStore.setState({ mode: { kind: 'select' } })
    // desktop: fine pointer — no arming framing at all
    stubDevice(false)
    provideArmFocus()
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(2)
  })
})

interface Internals {
  m: unknown
  viewInsets: { left: number; right: number; top: number; bottom: number }
  camTween: { endPos: THREE.Vector3; endTgt: THREE.Vector3 } | null
}

/** A headless portrait phone scene (390 × 844) at the classic home pose, below a coach card, above the dock. */
function headlessPhone(w = 390, h = 844) {
  const scene = new BreadboardScene()
  const s = scene as unknown as Internals
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
  const target = new THREE.Vector3(32, 0, 8.25)
  const dir = new THREE.Vector3(-6, 36, 40).normalize()
  camera.position.copy(dir.clone().multiplyScalar(230).add(target))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  s.m = {
    container: { style: { cursor: '' }, clientWidth: w, clientHeight: h },
    camera,
    controls: { target, minDistance: 6, maxDistance: 400, update: () => {}, touches: {} },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) } },
    overlayGroup: new THREE.Group(),
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
  s.viewInsets = { left: 0, right: 0, top: 421, bottom: 82 } // the coach card's bottom + 8, the dock
  return { scene, s, camera }
}

/** Resting-camera screen x of a board-plane point. */
function screenX(s: Internals, camera: THREE.PerspectiveCamera, p: THREE.Vector3, w = 390): number {
  const cam = camera.clone()
  cam.position.copy(s.camTween!.endPos)
  cam.lookAt(s.camTween!.endTgt)
  cam.updateMatrixWorld()
  const v = p.clone().project(cam)
  return ((v.x + 1) / 2) * w
}

/** a hole this close to the screen's side edge is not one a finger lands on */
const EDGE_AIR_PX = 8

describe('SC-9 re-run: the two framings on a portrait phone (scene)', () => {
  beforeEach(() => stubDevice(true))

  it('the circuit cut to 14 px pushes i1’s e36 to the edge of a 390-px screen; the step framing keeps a20 and e36 on it', () => {
    const layout = lessonById('i1-gpio-output')!.start.layout
    // the bench's board extent: every on-board pin and wire end (the supply's rail wires at the left end, LED1 at 41)
    const circuit = armFramingSpec(layout, [...layout.components.map((c) => c.id), ...layout.wires.map((w) => w.id)])
    expect(circuit.holes?.length ?? 0).toBeGreaterThan(40) // U1's 40 pins, the parts' leads, the wire ends
    const a = headlessPhone()
    const ends = a.scene as unknown as { resolveEndpoint(r: string): THREE.Vector3 | null }
    const at20 = ends.resolveEndpoint('a20')!.clone()
    const at36 = ends.resolveEndpoint('e36')!.clone()
    // the arming before the fix: the whole circuit, cut down about its centre to 14 px
    a.scene.frameTargets(circuit, { minSpanHoles: 16, minPitchPx: 14, coverBottomPx: 150 })
    // (headless: pins and wire ends only — the live scene also boxes the part bodies and the supply, and put e36 at x ≈ 470)
    expect(screenX(a.s, a.camera, at36)).toBeGreaterThan(390 - EDGE_AIR_PX)
    // the guided step's framing: both ends of a20 → e36 on screen, with air
    const b = headlessPhone()
    b.scene.frameTargets({ holes: ['a20', 'e36'] }, { minSpanHoles: 16, minElevationDeg: 60, coverBottomPx: 150 })
    for (const p of [at20, at36]) {
      const x = screenX(b.s, b.camera, p)
      expect(x).toBeGreaterThan(EDGE_AIR_PX)
      expect(x).toBeLessThan(390 - EDGE_AIR_PX)
    }
    // …at a pitch a finger tells apart (SC-F1's floor), not the whole bench's ~6 px
    expect(b.scene.holePitchPx({ x: (at20.x + at36.x) / 2, z: (at20.z + at36.z) / 2 })!).toBeGreaterThanOrEqual(12)
  })
})
