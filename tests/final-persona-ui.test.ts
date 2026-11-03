/**
 * Round 5 persona fixes, the host side:
 *
 *  (3) 電路說明 never reads the host's load frame (the circuit before its
 *      first solve: every voltage and current 0) as 「LED1 沒亮：沒有電流流過
 *      ／找不到明確原因」 or 「PS1 輸出 0 V」 — at boot, after an edit, after a
 *      reset; it waits for a snapshot whose clock moved past it
 *      (useExplanation settle). The not-started stand-in says the run starts
 *      by itself when auto-run will start it;
 *  (4) the phone's arm-zoom for a part that goes INTO the board frames the
 *      board, not a lone off-board supply beside it (armFramingSpec board);
 *  (5) closing the phone's parts sheet ends placing (endPlacingOnPartsClose).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { useProblems } from '../src/ui/embedded/problems'
import { EXPLAIN_REFRESH_MS, EXPLAIN_STALE_MS, startExplainWatcher, useExplainView } from '../src/ui/chrome/useExplanation'
import { explainCircuit } from '../src/ui/chrome/explain'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { FrameTargetsOptions, HighlightSpec } from '../src/three/scene-api'
import type { InteractionMode } from '../src/state/types'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import '../src/sim/models'
import { dismissToast, getToasts } from '../src/ui/kit'
import { TOUCH_PITCH_TARGET_PX, __resetArmFramingForTests, armFramingSpec, partsSheetCover, registerScene, type BridgeScene } from '../src/ui/workspace/scene-bridge'
import { endPlacingOnPartsClose } from '../src/ui/sheets/PartsSheet'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+1' },
  { id: 'W2', from: 'PS1:-', to: 'top-1' },
]
/** PS1 → R1 330 Ω (top+3 → a10) → LED1 (b10 → top-4): lit at about 9.7 mA */
const LED_CIRCUIT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
  ],
  wires: RAILS,
}

// ---------------------------------------------------------------------------
// (3) the explanation and the host's load frame
// ---------------------------------------------------------------------------

describe('(3) 電路說明 never explains the host’s unsolved load frame', () => {
  /** The real coordinator: what the host posts right after a load (worker-host 'load' → postFrame), then after a run. */
  function frames(layout: CircuitLayout, at = 0) {
    const co = new SimulationCoordinator()
    if (at > 0) {
      co.load(LED_CIRCUIT, 1)
      co.advance(at)
    }
    co.load(layout, 2)
    const load = co.frame(true).telemetry
    co.advance(0.1)
    const solved = co.frame(true).telemetry
    return { load, solved }
  }
  const view = () => useExplainView.getState()
  const text = () => (view().explanation?.lines ?? []).join(' / ')
  const push = (t: SimTelemetry) => useStore.setState({ telemetry: t, simTime: t.time })
  let stop: (() => void) | null = null

  beforeEach(() => {
    __setLangForTests('zh-TW')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    useLab.setState({ firmware: {}, mcus: {} })
    useProblems.setState({ problems: [], layout: LED_CIRCUIT, findings: [] })
  })
  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
    useStore.setState({ running: false, simTime: 0, telemetry: null, selection: [] })
  })

  it('the premise: the host’s first frame after a load is the circuit before its first solve (all zeros)', () => {
    const { load, solved } = frames(LED_CIRCUIT)
    expect(load.components.LED1.light ?? 0).toBe(0)
    expect(load.components.PS1.pinVoltages['+'] ?? 0).toBe(0)
    expect(solved.components.LED1.light).toBeGreaterThan(0.3)
    expect(solved.components.PS1.pinVoltages['+']).toBeCloseTo(5, 2)
  })

  it('boot: 「電路模擬中」 until the first solved snapshot — never 「沒亮：沒有電流流過」, even when the next frame is late', () => {
    const { load, solved } = frames(LED_CIRCUIT)
    useStore.setState({ layout: LED_CIRCUIT, telemetry: null, running: true, simTime: 0, selection: [] })
    stop = startExplainWatcher()
    expect(text()).toBe('電路模擬中')
    const seen: string[] = []
    const off = useExplainView.subscribe((s) => seen.push((s.explanation?.lines ?? []).join(' / ')))
    push(load)
    vi.advanceTimersByTime(EXPLAIN_STALE_MS + 200) // a cold worker: 1.4 s before its next frame
    expect(text()).toBe('電路模擬中')
    push(solved)
    expect(view().explanation?.key).toBe('5:LED1:lit') // at once, no 2 Hz slot
    off()
    expect(seen.filter((x) => /沒亮|沒有電流|找不到/.test(x))).toEqual([])
  })

  it('an edit while running: the old lines stay dimmed through the load frame; then the new circuit’s at once', () => {
    const before = frames(LED_CIRCUIT)
    useStore.setState({ layout: LED_CIRCUIT, telemetry: before.solved, running: true, simTime: before.solved.time, selection: [] })
    stop = startExplainWatcher()
    expect(view().explanation?.key).toBe('5:LED1:lit')
    const L2: CircuitLayout = { ...LED_CIRCUIT, wires: [...RAILS, { id: 'W3', from: 'f30', to: 'f35' }] }
    const after = frames(L2, before.solved.time)
    const seen: string[] = []
    const off = useExplainView.subscribe((s) => seen.push((s.explanation?.lines ?? []).join(' / ')))
    useStore.setState({ layout: L2 })
    useProblems.setState({ problems: [], layout: L2, findings: [] })
    push(after.load)
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().stale).toBe(true)
    push(after.solved)
    expect(view().stale).toBe(false)
    expect(view().explanation?.key).toBe('5:LED1:lit')
    off()
    expect(seen.filter((x) => /沒亮|沒有電流|找不到/.test(x))).toEqual([])
  })

  it('a lone supply: 「PS1 輸出 0 V」 is never printed from the load frame after a part is added', () => {
    const PS_ONLY: CircuitLayout = { version: 1, components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }], wires: [] }
    const before = frames(PS_ONLY)
    useProblems.setState({ problems: [], layout: PS_ONLY, findings: [] })
    useStore.setState({ layout: PS_ONLY, telemetry: before.solved, running: true, simTime: before.solved.time, selection: [] })
    stop = startExplainWatcher()
    expect(text()).toContain('PS1 輸出 5.00 V')
    const L2: CircuitLayout = { ...PS_ONLY, components: [...PS_ONLY.components, { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } }] }
    const after = frames(L2, before.solved.time)
    const seen: string[] = []
    const off = useExplainView.subscribe((s) => seen.push((s.explanation?.lines ?? []).join(' / ')))
    useStore.setState({ layout: L2 })
    useProblems.setState({ problems: [], layout: L2, findings: [] })
    push(after.load)
    vi.advanceTimersByTime(EXPLAIN_STALE_MS + 200)
    push(after.solved)
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    off()
    expect(seen.filter((x) => /輸出 0 V/.test(x))).toEqual([])
    expect(text()).toContain('PS1 輸出 5.00 V')
  })

  it('paused at t = 0 after a reset (idle): the snapshot is shown as it is — no wait', () => {
    const { load } = frames(LED_CIRCUIT)
    useStore.setState({ layout: LED_CIRCUIT, telemetry: null, running: false, simTime: 0, selection: [] })
    stop = startExplainWatcher()
    push(load)
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().explanation?.placeholder).not.toBe(true)
  })

  it('the not-started stand-in: 「模擬即將自動開始」 when auto-run will start it, 「模擬還沒開始」 otherwise', () => {
    const base = { layout: LED_CIRCUIT, telemetry: null, phase: 'idle' as const, problems: [] }
    expect(explainCircuit({ ...base, autoStart: true }).lines).toEqual(['模擬即將自動開始', '接著這裡會說明電路正在做什麼'])
    expect(explainCircuit(base).lines).toEqual(['模擬還沒開始', '開始模擬後，這裡會說明電路正在做什麼'])
    // the watcher asks auto-run (and the store's stop reason) for it
    const src = read('src/ui/chrome/useExplanation.ts')
    expect(src).toMatch(/autoStart: autoStartComing\(\)/)
    expect(src).toMatch(/why === null \|\| why === 'reset'\) && autoRunEnabled\(\)/)
  })
})

// ---------------------------------------------------------------------------
// (4) the phone's arm-zoom with a supply placed first
// ---------------------------------------------------------------------------

const SELECT: InteractionMode = { kind: 'select' }
const PLACE_R: InteractionMode = { kind: 'place', type: 'resistor', pickedHoles: [] }
const PLACE_PS: InteractionMode = { kind: 'place', type: 'power_supply', pickedHoles: [] }
const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }
const PS_FIRST: CircuitLayout = { version: 1, components: [{ id: 'PS1', type: 'power_supply' }], wires: [{ id: 'W1', from: 'PS1:+', to: 'top+1' }] }

function stubPhone(): void {
  vi.stubGlobal('window', {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }),
  })
}
function stubScene(pitch: number) {
  const frames: { spec: HighlightSpec; opts: FrameTargetsOptions | undefined }[] = []
  const scene: BridgeScene = { frameContent: () => {}, frameTargets: (spec, opts) => void frames.push({ spec, opts }), setProblemHighlights: () => {}, holePitchPx: () => pitch }
  return { scene, frames }
}

describe('(4) arming a board part frames the board, not a lone supply beside it', () => {
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetArmFramingForTests()
    for (const x of getToasts()) dismissToast(x.id)
    useStore.setState({ layout: EMPTY, mode: SELECT, selection: [] })
  })
  afterEach(() => {
    registerScene(null)
    partsSheetCover(0)
    useStore.setState({ mode: SELECT, selection: [], layout: EMPTY })
    vi.unstubAllGlobals()
  })

  it('armFramingSpec board: a circuit of only off-board parts (and the wires to them) frames as an empty board', () => {
    const emptyBoard = armFramingSpec(EMPTY, [])
    expect(armFramingSpec(PS_FIRST, [], { board: true })).toEqual(emptyBoard)
    expect(armFramingSpec(PS_FIRST, ['PS1'], { board: true })).toEqual(emptyBoard) // a selected supply too
    // without `board` (the wire tool, an instrument's arming): the whole circuit as before
    expect(armFramingSpec(PS_FIRST, [])).toEqual({ holes: [], components: ['PS1', 'W1'] })
    // board parts and board-only wires stay
    const mixed: CircuitLayout = {
      version: 1,
      components: [...PS_FIRST.components, { id: 'R1', type: 'resistor', holes: ['a20', 'a24'] }],
      wires: [...PS_FIRST.wires, { id: 'W2', from: 'e24', to: 'f30' }],
    }
    expect(armFramingSpec(mixed, [], { board: true })).toEqual({ holes: [], components: ['R1', 'W2'] })
  })

  it('phone, PS1 placed first, then 電阻 armed: the bridge frames the board’s centre third (was: PS1 alone)', () => {
    stubPhone()
    const { scene, frames } = stubScene(4.6)
    registerScene(scene)
    useStore.setState({ layout: PS_FIRST, selection: [] })
    useStore.setState({ mode: PLACE_R })
    expect(frames).toHaveLength(1)
    expect(frames[0].spec).toEqual(armFramingSpec(EMPTY, []))
    expect(frames[0].opts?.minPitchPx).toBe(TOUCH_PITCH_TARGET_PX)
    // arming another supply still frames the circuit as before
    useStore.setState({ mode: SELECT })
    __resetArmFramingForTests()
    useStore.setState({ mode: PLACE_PS })
    expect(frames[1].spec).toEqual({ holes: [], components: ['PS1', 'W1'] })
  })
})

// ---------------------------------------------------------------------------
// (5) closing the phone's parts sheet ends placing
// ---------------------------------------------------------------------------

describe('(5) closing the phone’s parts sheet ends placing', () => {
  afterEach(() => useStore.setState({ mode: SELECT }))

  it('open → closed on a phone (product chrome): back to select', () => {
    useStore.setState({ mode: { kind: 'place', type: 'resistor', pickedHoles: ['a20'] } })
    endPlacingOnPartsClose(true, false, { desktop: false, legacy: false })
    expect(useStore.getState().mode.kind).toBe('select')
  })

  it('the desktop panel, the classic chrome, an opening or a sheet already closed keep placing', () => {
    for (const [was, open, desktop, legacy] of [
      [true, false, true, false],
      [true, false, false, true],
      [false, true, false, false],
      [false, false, false, false],
      [true, true, false, false],
    ] as const) {
      useStore.setState({ mode: PLACE_R })
      endPlacingOnPartsClose(was, open, { desktop, legacy })
      expect(useStore.getState().mode.kind, `${was}→${open} desktop ${desktop} legacy ${legacy}`).toBe('place')
    }
  })

  it('the sheet runs it on every open → closed change (a swipe, the dock’s 元件, the scrim)', () => {
    const src = read('src/ui/sheets/PartsSheet.tsx')
    expect(src).toMatch(/const wasOpen = useRef\(open\)[\s\S]{0,200}endPlacingOnPartsClose\(was, open, \{ desktop, legacy \}\)[\s\S]{0,40}\}, \[open, desktop, legacy\]\)/)
  })
})
