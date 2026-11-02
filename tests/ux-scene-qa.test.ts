/**
 * Release-QA fixes, scene area (SC-F1 … SC-F5):
 *  - SC-F1 the phone frames the working area when a part or the wire tool
 *    is armed and a hole pitch reads under 12 px: the bridge's store watch
 *    (once per arming, coarse pointer + new chrome only, one toast per
 *    session) and the scene's minPitchPx / coverBottomPx fit (≥ 14 px,
 *    above the Parts sheet's peek);
 *  - SC-F2 the part-body chip says 「已選取」 for a selected part and the
 *    scene re-asks it when the selection changes; endpointName's strip form
 *    is tidy zh-TW;
 *  - SC-F3 the Parts sheet's 範例 segment: the segment request, the opened
 *    example's instrument, the shared example list;
 *  - SC-F4 one verb per action (檢視, 開啟範例：…);
 *  - SC-F5 tray tabs sized to their labels, the library filters 1 : 1.3.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { __setLangForTests, t } from '../src/i18n'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import type { FrameTargetsOptions, HighlightSpec } from '../src/three/scene-api'
import type { CircuitLayout } from '../src/model/types'
import type { InteractionMode } from '../src/state/types'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  TOUCH_PITCH_TARGET_PX,
  __resetArmFramingForTests,
  armFramingSpec,
  focusInScene,
  partsSheetCover,
  registerScene,
  type BridgeScene,
} from '../src/ui/workspace/scene-bridge'
import { endpointName, objectChipText } from '../src/ui/workspace/hole-chip'
import { afterExampleOpened, showPartsSheetSegment, takePartsSheetSegment } from '../src/ui/sheets/PartsSheet'
import { ExampleLibrary } from '../src/ui/workspace/LibraryPanel'
import { useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'
import { findLibraryExample } from '../src/ui/workspace/examples'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }
const BLINK: CircuitLayout = {
  version: 1,
  components: [
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a33', 'a37'] },
    { id: 'LED1', type: 'led', holes: ['b37', 'b38'] },
  ],
  wires: [{ id: 'W1', from: 'a20', to: 'e33' }],
}

const SELECT: InteractionMode = { kind: 'select' }
const PLACE_BP: InteractionMode = { kind: 'place', type: 'stm32_bluepill', pickedHoles: [] }
const PLACE_R: InteractionMode = { kind: 'place', type: 'resistor', pickedHoles: [] }
const WIRE: InteractionMode = { kind: 'wire', from: null, color: 'red' }

/** A phone (coarse pointer) or a desktop (fine pointer), the workspace never showing. */
function stubDevice(coarse: boolean): void {
  vi.stubGlobal('window', {
    innerWidth: coarse ? 390 : 1440,
    innerHeight: coarse ? 844 : 900,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {} }),
  })
}

function stubScene(pitch: number | null) {
  const frames: { spec: HighlightSpec; opts: FrameTargetsOptions | undefined }[] = []
  const scene: BridgeScene = {
    frameContent: () => {},
    frameTargets: (spec, opts) => void frames.push({ spec, opts }),
    setProblemHighlights: () => {},
    holePitchPx: () => pitch,
  }
  return { scene, frames }
}

const toastTexts = () => getToasts().map((x) => x.text)

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetArmFramingForTests()
  for (const x of getToasts()) dismissToast(x.id)
  useStore.setState({ layout: EMPTY, mode: SELECT, selection: [] })
})
afterEach(() => {
  registerScene(null)
  useStore.setState({ mode: SELECT, selection: [], layout: EMPTY })
  vi.unstubAllGlobals()
  __setLangForTests('zh-TW')
})

// ---------------------------------------------------------------------------
// SC-F1 — the bridge
// ---------------------------------------------------------------------------

describe('SC-F1 armFramingSpec: what an arming frames', () => {
  it('an empty standard board: the centre third, rail to rail', () => {
    expect(armFramingSpec(EMPTY, [])).toEqual({ holes: ['a22', 'j42', 'top+16', 'bot+33'], components: [] })
    // the rail holes sit at the third's two ends (rail x = 2.5 + i + ⌊i / 5⌋)
    expect(2.5 + 16 + Math.floor(16 / 5)).toBeCloseTo(21.5)
    expect(2.5 + 33 + Math.floor(33 / 5)).toBeCloseTo(41.5)
  })

  it('a circuit: every part and wire; a selection: its pins and wire ends', () => {
    expect(armFramingSpec(BLINK, [])).toEqual({ holes: [], components: ['U1', 'R1', 'LED1', 'W1'] })
    const r1 = armFramingSpec(BLINK, ['R1', 'W1'])
    expect(r1.components).toEqual([])
    expect(r1.holes).toEqual(['a33', 'a37', 'a20', 'e33'])
    // a board package: all 40 header pins
    expect(armFramingSpec(BLINK, ['U1']).holes).toHaveLength(40)
  })
})

describe('SC-F1 the arming watch (scene-bridge)', () => {
  it('phone, empty board, a pitch of 4.6 px: arming a part frames the centre third ≥ 14 px above the peek, once', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(4.6)
    registerScene(scene)
    partsSheetCover(236) // the Parts sheet dropped to its peek (0.28 × 844)
    useStore.setState({ mode: PLACE_BP })
    expect(frames).toHaveLength(1)
    expect(frames[0].spec).toEqual({ holes: ['a22', 'j42', 'top+16', 'bot+33'], components: [] })
    expect(frames[0].opts).toEqual({ minSpanHoles: 16, minPitchPx: TOUCH_PITCH_TARGET_PX, coverBottomPx: 244 })
    expect(toastTexts()).toContain('已放大麵包板，雙指可再縮放')
    // another card while armed is the same arming: no second framing
    useStore.setState({ mode: PLACE_R })
    expect(frames).toHaveLength(1)
    // the wire tool is a new arming — framed again, but the toast was once per session
    for (const x of getToasts()) dismissToast(x.id)
    partsSheetCover(0)
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(2)
    expect(frames[1].opts).toEqual({ minSpanHoles: 16, minPitchPx: TOUCH_PITCH_TARGET_PX })
    expect(toastTexts()).not.toContain('已放大麵包板，雙指可再縮放')
  })

  it('waits three frames and yields to a framing asked for meanwhile (the coach’s 「開始接線」 frames its step)', () => {
    stubDevice(true)
    const queue: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => queue.push(cb))
    const flush = () => {
      for (let i = 0; i < 5 && queue.length > 0; i++) queue.splice(0).forEach((cb) => cb())
    }
    const { scene, frames } = stubScene(4.6)
    registerScene(scene)
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(0) // not yet: a lesson step may still frame
    focusInScene({ holes: ['a16', 'top+13'] }, { kind: 'guide', minSpanHoles: 16, minElevationDeg: 60 })
    flush()
    expect(frames).toHaveLength(1) // only the coach's own framing
    expect(frames[0].spec.holes).toEqual(['a16', 'top+13'])
    // a plain arming frames after its three frames
    useStore.setState({ mode: SELECT })
    useStore.setState({ mode: PLACE_BP })
    flush()
    expect(frames).toHaveLength(2)
    expect(frames[1].opts?.minPitchPx).toBe(TOUCH_PITCH_TARGET_PX)
  })

  it('a readable pitch (≥ 12 px, e.g. after the user pinched in or a lesson step framed) is left alone', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(12.5)
    registerScene(scene)
    useStore.setState({ mode: WIRE })
    expect(frames).toHaveLength(0)
    expect(toastTexts()).toEqual([])
  })

  it('the selected part leads the framing; the circuit when nothing is selected', () => {
    stubDevice(true)
    const { scene, frames } = stubScene(5)
    registerScene(scene)
    useStore.setState({ layout: BLINK, selection: ['R1'] })
    useStore.setState({ mode: WIRE })
    expect(frames[0].spec).toEqual({ holes: ['a33', 'a37'], components: [] })
    useStore.setState({ mode: SELECT, selection: [] })
    useStore.setState({ mode: PLACE_R })
    expect(frames[1].spec).toEqual({ holes: [], components: ['U1', 'R1', 'LED1', 'W1'] })
  })

  it('desktop (fine pointer), the classic chrome and a scene without holePitchPx never frame', () => {
    stubDevice(false)
    const a = stubScene(4.6)
    registerScene(a.scene)
    useStore.setState({ mode: PLACE_BP })
    expect(a.frames).toHaveLength(0)
    useStore.setState({ mode: SELECT })
    // classic chrome: English without the workspace
    stubDevice(true)
    __setLangForTests('en')
    useStore.setState({ mode: WIRE })
    expect(a.frames).toHaveLength(0)
    useStore.setState({ mode: SELECT })
    __setLangForTests('zh-TW')
    const b: BridgeScene = { frameContent: () => {}, frameTargets: vi.fn(), setProblemHighlights: () => {} }
    registerScene(b)
    useStore.setState({ mode: WIRE })
    expect(b.frameTargets).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// SC-F1 — the scene's fit
// ---------------------------------------------------------------------------

interface Internals {
  m: unknown
  viewInsets: { left: number; right: number; top: number; bottom: number }
  camTween: { endPos: THREE.Vector3; endTgt: THREE.Vector3 } | null
  chipKey: string
  pointerInside: boolean
  pointerDirty: boolean
  lastPointerType: string
}

/** A headless phone scene (portrait 390 × 844 by default) at the classic home pose, with the phone's view insets. */
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
  // the phone's insets (capsule + pill slot above, the dock below — App phoneChromeInsets)
  s.viewInsets = { left: 0, right: 0, top: 106, bottom: 82 }
  return { scene, s, camera }
}

/** Screen point of a plan point for the scene's resting camera (the glide's destination). */
function project(s: Internals, camera: THREE.PerspectiveCamera, x: number, z: number): { x: number; y: number } {
  const cam = camera.clone()
  cam.position.copy(s.camTween!.endPos)
  cam.lookAt(s.camTween!.endTgt)
  cam.updateMatrixWorld()
  const v = new THREE.Vector3(x, 0, z).project(cam)
  return { x: ((v.x + 1) / 2) * 390, y: ((1 - v.y) / 2) * 844 }
}

describe('SC-F1 frameTargets minPitchPx / coverBottomPx (scene)', () => {
  beforeEach(() => stubDevice(true))

  it('the whole-board home pose reads under 12 px; the framed centre third reads ≥ 14 px at a10 → a11 and above the peek', () => {
    const { scene, s, camera } = headlessPhone()
    const home = scene.holePitchPx()!
    expect(home).toBeGreaterThan(2)
    expect(home).toBeLessThan(12)
    scene.frameTargets({ holes: ['a22', 'j42', 'top+16', 'bot+33'] }, { minSpanHoles: 16, minPitchPx: 14, coverBottomPx: 244 })
    expect(s.camTween).not.toBeNull()
    // the resting pose (the glide's destination) counts
    expect(scene.holePitchPx()!).toBeGreaterThanOrEqual(14 * 0.99)
    expect(scene.holePitchPx({ x: 10.5, z: 3 })!).toBeGreaterThanOrEqual(14) // a10 → a11 (the acceptance pair)
    expect(scene.holePitchPx({ x: 32, z: 3 })!).toBeGreaterThanOrEqual(14 * 0.99) // the far row at the centre column
    // the framed rows sit between the top chrome and the Parts sheet's peek
    for (const [x, z] of [[32, 3], [32, 13], [32, 0], [32, 16]]) {
      const p = project(s, camera, x, z)
      expect(p.y, `${x},${z}`).toBeGreaterThan(106)
      expect(p.y, `${x},${z}`).toBeLessThan(844 - 244)
    }
  })

  it('a circuit spanning the whole board is cut down about its centre to keep 14 px', () => {
    const { scene } = headlessPhone()
    scene.frameTargets({ holes: ['a2', 'j62', 'top+0', 'bot+49'] }, { minSpanHoles: 16, minPitchPx: 14 })
    expect(scene.holePitchPx({ x: 32, z: 3 })!).toBeGreaterThanOrEqual(14 * 0.99)
    expect(scene.holePitchPx({ x: 32, z: 13 })!).toBeGreaterThanOrEqual(14 * 0.99)
  })

  it('a short landscape window: the rows are cut once cutting columns stops helping', () => {
    const { scene } = headlessPhone(844, 390)
    scene.frameTargets({ holes: ['a22', 'j42', 'top+16', 'bot+33'] }, { minSpanHoles: 16, minPitchPx: 14 })
    expect(scene.holePitchPx({ x: 32, z: 8 })!).toBeGreaterThanOrEqual(14 * 0.99)
  })

  it('without the new options the fit is exactly the previous one', () => {
    const a = headlessPhone()
    a.scene.frameTargets({ holes: ['a22', 'j42'] }, { minSpanHoles: 16 })
    const b = headlessPhone()
    b.scene.frameTargets({ holes: ['a22', 'j42'] }, { minSpanHoles: 16, minPitchPx: 1 }) // already met: no cut
    expect(b.s.camTween!.endPos.distanceTo(a.s.camTween!.endPos)).toBeLessThan(1e-9)
    expect(b.s.camTween!.endTgt.distanceTo(a.s.camTween!.endTgt)).toBeLessThan(1e-9)
  })

  it('holePitchPx is null before mount', () => {
    expect(new BreadboardScene().holePitchPx()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SC-F2
// ---------------------------------------------------------------------------

describe('SC-F2 the part-body chip and the strip name', () => {
  it('a selected part or wire says 「已選取」 instead of 「點一下選取」', () => {
    useStore.setState({ layout: BLINK, selection: [] })
    expect(objectChipText('U1')).toBe('U1 · STM32F103C8T6 Blue Pill 開發板 · 點一下選取')
    useStore.setState({ selection: ['U1', 'W1'] })
    expect(objectChipText('U1')).toBe('U1 · STM32F103C8T6 Blue Pill 開發板 · 已選取')
    // a wire names its automatic colour and role (F16, purple-first signal palette) before 已選取
    expect(objectChipText('W1')).toBe('導線 W1 · 紫色：訊號（U1 PA5）· 已選取')
    expect(objectChipText('R1')).toBe('R1 · 電阻 · 點一下選取')
    __setLangForTests('en')
    expect(objectChipText('W1')).toBe('Wire W1 · Selected')
  })

  it('the scene re-asks a part-body chip when the selection changes (mouse hover)', () => {
    const { scene, s } = headlessPhone()
    s.chipKey = 'o:U1'
    s.pointerInside = true
    s.lastPointerType = 'mouse'
    s.pointerDirty = false
    scene.setSelection(['U1'])
    expect(s.chipKey).not.toBe('o:U1')
    expect(s.pointerDirty).toBe(true)
    // a hole chip is not touched
    s.chipKey = 'h:c20:0:0'
    s.pointerDirty = false
    scene.setSelection([])
    expect(s.chipKey).toBe('h:c20:0:0')
    expect(s.pointerDirty).toBe(false)
  })

  it('endpointName: no space between two Chinese words, Latin spacing kept', () => {
    expect(endpointName(BLINK, 'b33')).toBe('b33（R1 第 1 腳這一排）')
    expect(endpointName(BLINK, 'c38')).toBe('c38（LED1 陰極這一排）')
    expect(endpointName(BLINK, 'b20')).toBe('b20（U1 PA5 這一排）')
    __setLangForTests('en')
    expect(endpointName(BLINK, 'b33')).toBe('b33 (R1 lead 1 strip)')
  })
})

// ---------------------------------------------------------------------------
// SC-F3
// ---------------------------------------------------------------------------

describe('SC-F3 the Parts sheet 範例 segment', () => {
  it('opens on 元件庫 unless 範例 was asked for; a request is used once', () => {
    expect(takePartsSheetSegment()).toBe('parts')
    showPartsSheetSegment('examples')
    expect(takePartsSheetSegment()).toBe('examples')
    expect(takePartsSheetSegment()).toBe('parts')
  })

  it('an opened example brings its instrument up (the 儀器 sheet), an analog one gives the board back', () => {
    stubDevice(true)
    useLab.getState().setWorkspace({ tray: { open: false, height: 240, tab: 'uart' } })
    const before = useInstrumentRequest.getState().request?.seq ?? 0
    const dismiss = vi.fn()
    afterExampleOpened(findLibraryExample('blink')!, dismiss)
    expect(dismiss).not.toHaveBeenCalled()
    expect(useInstrumentRequest.getState().request).toMatchObject({ view: 'logic', seq: before + 1 })
    expect(useLab.getState().workspace.tray.tab).toBe('logic')
    afterExampleOpened(findLibraryExample('lm7805-regulator')!, dismiss)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('the sheet shows the workspace’s own example list (same sections, same 開啟範例 names)', () => {
    const sheet = renderToStaticMarkup(createElement(ExampleLibrary, { sheet: true, desktop: false }))
    const panel = renderToStaticMarkup(createElement(ExampleLibrary))
    expect(sheet).toContain('psh-examples')
    const keys = (html: string) => [...html.matchAll(/data-example="([^"]+)"/g)].map((m) => m[1])
    expect(keys(sheet)).toEqual(keys(panel))
    expect(keys(sheet).length).toBeGreaterThanOrEqual(34)
    expect(sheet).toContain('aria-label="開啟範例：Blue Pill 閃爍 LED（HAL）"')
  })

  it('PartsSheet heads the new chrome with 「元件庫｜範例」 and keeps the classic title', () => {
    const src = read('src/ui/sheets/PartsSheet.tsx')
    expect(src).toMatch(/legacy \? \(\s*<div className="psh-title lg-headline">\{t\('Parts'\)\}<\/div>/)
    expect(src).toContain("{ value: 'parts', label: 'Library' }")
    expect(src).toContain("{ value: 'examples', label: 'Examples' }")
    expect([t('Library'), t('Examples')]).toEqual(['元件庫', '範例'])
  })
})

// ---------------------------------------------------------------------------
// SC-F4 / SC-F5
// ---------------------------------------------------------------------------

describe('SC-F4 one verb per action', () => {
  it('the probe menu shows an instrument with 檢視, like the UART terminal and the log', () => {
    expect(t('Show in the logic analyzer ({name})', { name: 'PA5 LED' })).toBe('在邏輯分析儀中檢視（PA5 LED）')
    expect(t('Show in the oscilloscope (CH{n})', { n: 1 })).toBe('在示波器中檢視（CH1）')
    expect(t('Show in logic analyzer')).toBe('在邏輯分析儀中檢視')
    expect(t('Show in the simulation log')).toBe('在模擬日誌中檢視')
  })

  it('an example row’s 「開啟」 pill is named 「開啟範例：{title}」 (it does not fit as 開啟範例 at 1366 px)', () => {
    const html = renderToStaticMarkup(createElement(ExampleLibrary))
    expect(html).toMatch(/class="ws-open-pill"[^>]*aria-label="開啟範例：Blue Pill 閃爍 LED（HAL）"[^>]*title="開啟範例：Blue Pill 閃爍 LED（HAL）"/)
    expect(html).not.toContain('開啟「')
  })
})

describe('SC-F5 labels never ellipsized at 1366 / 1440 px', () => {
  const css = read('src/ui/workspace/workspace.css')
  it('the tray tabs size to their labels', () => {
    expect(css).toMatch(/\.ws-tray-tabs \{[^}]*flex: 0 1 auto;[^}]*\}/)
    expect(css).toMatch(/\.ws-tray-tabs \.lg-seg-item \{[^}]*flex: 0 1 auto;/)
    expect(css).not.toMatch(/\.ws-tray-tabs \{[^}]*max-width: 640px/)
  })
  it('the library’s category and support filters split 1 : 1.3', () => {
    expect(css).toMatch(/\.ws-filters \.ws-filter-cat \{\s*flex: 1 1 0;\s*\}/)
    expect(css).toMatch(/\.ws-filters \.ws-filter-cat ~ \.ws-filter-level \{\s*flex: 1\.3 1 0;\s*\}/)
  })
})
