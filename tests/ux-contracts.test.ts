/**
 * UX-wave cross-workstream contracts K1–K11 (docs/ux/UX_REVIEW.md §6.4):
 * the provider modules the five workstreams build on, tested against the
 * real stores (no React DOM — server rendering where a component matters):
 *   K1  src/ui/chrome/legacy.ts           isLegacyChrome / useLegacyChrome
 *   K2  src/ui/chrome/run-control.ts      simPhaseOf / useSimPhase / runOrResume / toggleRun
 *   K3  src/ui/embedded/problems.ts       deriveProblems / recompute / watcher / focusInspector / ProblemsList
 *   K4  src/ui/workspace/scene-bridge.ts  registerScene / focusInScene / clearSceneFocus / frameCircuit
 *   K5  src/ui/workspace/hole-chip.ts     holeChipText
 *   K6  src/ui/workspace/ProbeMenu.tsx    openProbeMenu / probeMenuModel
 *   K7  src/ui/embedded/probe-actions.ts  addLogicChannelFor / addScopeProbeFor / revealInLogic
 *   K8  LibraryPanel #ws-coach-slot + useLessonUi.coachRect
 *   K9  src/ui/lessons/actions.ts         startFirstLesson
 *   K10 src/ui/workspace/examples.ts      openExampleById
 *   K11 src/i18n/parts.ts                 pinDisplayName
 * plus zh-TW coverage of every new English source.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, hasTranslation, setLang, t } from '../src/i18n'
import { pinDisplayName } from '../src/i18n/parts'
import uxContracts from '../src/i18n/zh-TW/ux-contracts'
import { getEntry, type CatalogEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { getToasts, dismissToast } from '../src/ui/kit'
import { isLegacyChrome, isWorkspaceShowing, useLegacyChrome } from '../src/ui/chrome/legacy'
import { getSimPhase, runOrResume, simPhaseOf, toggleRun, useSimPhase } from '../src/ui/chrome/run-control'
import {
  FIRMWARE_GRACE_MS,
  PROBLEMS_DEBOUNCE_MS,
  ProblemsList,
  ProblemsView,
  __resetProblemsForTests,
  deriveProblems,
  focusInspector,
  locateProblem,
  openFirmwareFor,
  problemTitle,
  recomputeProblems,
  startProblemsWatcher,
  useFirmwarePickerRequest,
  useInspectorFocus,
  useProblems,
  type Problem,
} from '../src/ui/embedded/problems'
import {
  activeProblemFocus,
  clearSceneFocus,
  focusInScene,
  frameCircuit,
  registerScene,
  sceneRegistered,
  type BridgeScene,
} from '../src/ui/workspace/scene-bridge'
import { holeChipText, holeChipTextFor } from '../src/ui/workspace/hole-chip'
import { closeProbeMenu, openProbeMenu, probeMenuModel, probeMenuOpen } from '../src/ui/workspace/ProbeMenu'
import {
  addLogicChannelFor,
  addScopeProbeFor,
  netMembersFor,
  nextLogicIndex,
  nextScopeChannel,
  probeHolesNear,
  probeHolesOnNet,
  probeTargetFromScene,
  resolveProbeTarget,
  revealInLogic,
  useLogicReveal,
} from '../src/ui/embedded/probe-actions'
import { LibraryPanel } from '../src/ui/workspace/LibraryPanel'
import { useLessonUi } from '../src/ui/lessons/state'
import { firstLesson, startFirstLesson } from '../src/ui/lessons/actions'
import { useLessonProgress } from '../src/lessons/progress'
import {
  exampleMainInstrument,
  exampleRevealRequest,
  findLibraryExample,
  onExampleReveal,
  openExampleById,
} from '../src/ui/workspace/examples'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

/** U1 Blue Pill at h10 (PA5 → c20, PA6 → c19), a bench supply on the top rails, R1 a40–a44. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }

function frame(id: string, state: McuFrameInfo['state'], pc = 0x08000100): McuFrameInfo {
  return { componentId: id, state, firmware: 'x.elf', pc, hclkHz: 8e6, cycles: 1, realtime: 1, uarts: [] }
}

function setDocument(layout: CircuitLayout): void {
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

let wide = false
const storage = new MemoryStorage()
const origStore = {
  startSim: useStore.getState().startSim,
  stopSim: useStore.getState().stopSim,
}
const origLab = { mcuResume: useLab.getState().mcuResume }

function clearToasts(): void {
  for (const x of getToasts()) dismissToast(x.id)
}
const lastToast = (): string => getToasts()[getToasts().length - 1]?.text ?? ''

function stubBrowser(): void {
  storage.clear()
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: wide, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
}

beforeEach(() => {
  wide = false
  stubBrowser()
  __setLangForTests('zh-TW')
  setDocument(EMPTY)
  useLab.setState({ mcus: {}, firmware: {}, logicChannels: [] })
  useLab.getState().setWorkspace({ enabled: false })
  clearToasts()
})

afterEach(() => {
  useStore.setState({ ...origStore, running: false, simTime: 0 })
  useLab.setState({ ...origLab, mcus: {}, firmware: {} })
  registerScene(null)
  __resetProblemsForTests()
  closeProbeMenu()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  __setLangForTests('zh-TW')
})

// ---------------------------------------------------------------------------
// K1 legacy chrome
// ---------------------------------------------------------------------------

describe('K1 isLegacyChrome / useLegacyChrome', () => {
  it('is legacy exactly for English without a showing workspace', () => {
    __setLangForTests('en')
    expect(isLegacyChrome()).toBe(true)
    useLab.getState().setWorkspace({ enabled: true })
    expect(isLegacyChrome()).toBe(true) // enabled, but the viewport does not match
    wide = true
    expect(isWorkspaceShowing()).toBe(true)
    expect(isLegacyChrome()).toBe(false) // English + workspace = the new chrome
    useLab.getState().setWorkspace({ enabled: false })
    expect(isLegacyChrome()).toBe(true)
    __setLangForTests('zh-TW')
    expect(isLegacyChrome()).toBe(false)
  })

  it('the hook follows the language (server render: no workspace)', () => {
    const Probe = () => createElement('i', null, String(useLegacyChrome()))
    __setLangForTests('en')
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<i>true</i>')
    __setLangForTests('zh-TW')
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<i>false</i>')
  })
})

// ---------------------------------------------------------------------------
// K2 run control
// ---------------------------------------------------------------------------

describe('K2 run control', () => {
  it('derives the phase: fault > halted > running > paused > idle', () => {
    expect(simPhaseOf({ running: false, simTime: 0 }, {})).toBe('idle')
    expect(simPhaseOf({ running: false, simTime: 1.2 }, {})).toBe('paused')
    expect(simPhaseOf({ running: true, simTime: 1.2 }, {})).toBe('running')
    expect(simPhaseOf({ running: false, simTime: 1 }, { U1: frame('U1', 'halted') })).toBe('halted')
    expect(simPhaseOf({ running: true, simTime: 1 }, { U1: frame('U1', 'lockup') })).toBe('fault')
    expect(simPhaseOf({ running: true, simTime: 1 }, { U1: frame('U1', 'halted'), U2: frame('U2', 'lockup') })).toBe('fault')
    // only the boards in the circuit count
    expect(simPhaseOf({ running: true, simTime: 1 }, { U9: frame('U9', 'lockup') }, ['U1'])).toBe('running')
  })

  it('getSimPhase / useSimPhase read both stores and ignore boards no longer in the layout', () => {
    setDocument(LAYOUT)
    // a server render reads the stores' initial state (zustand): the hook's wiring, not the live phase
    expect(renderToStaticMarkup(createElement(() => createElement('i', null, useSimPhase())))).toBe('<i>idle</i>')
    expect(getSimPhase()).toBe('idle')
    useStore.setState({ simTime: 0.5 })
    expect(getSimPhase()).toBe('paused')
    useLab.setState({ mcus: { U1: frame('U1', 'halted') } })
    expect(getSimPhase()).toBe('halted')
    useLab.setState({ mcus: { U7: frame('U7', 'lockup') } }) // a stale frame of a deleted board
    expect(getSimPhase()).toBe('paused')
    useStore.setState({ running: true })
    expect(getSimPhase()).toBe('running')
    useLab.setState({ mcus: { U1: frame('U1', 'lockup') } })
    expect(getSimPhase()).toBe('fault')
  })

  it('runOrResume resumes every halted board AND starts the simulation', () => {
    setDocument(LAYOUT)
    const mcuResume = vi.fn()
    const startSim = vi.fn()
    useLab.setState({ mcus: { U1: frame('U1', 'halted') }, mcuResume })
    useStore.setState({ startSim, running: false })
    runOrResume()
    expect(mcuResume).toHaveBeenCalledWith('U1')
    expect(startSim).toHaveBeenCalledTimes(1)
    // already running (the resume restarted the frozen world): no second start
    useStore.setState({ running: true })
    runOrResume()
    expect(startSim).toHaveBeenCalledTimes(1)
  })

  it('toggleRun: halted → resume, running → pause, otherwise run', () => {
    setDocument(LAYOUT)
    const mcuResume = vi.fn()
    const startSim = vi.fn()
    const stopSim = vi.fn()
    useLab.setState({ mcuResume })
    useStore.setState({ startSim, stopSim, running: false })
    toggleRun()
    expect(startSim).toHaveBeenCalledTimes(1)
    useStore.setState({ running: true })
    toggleRun()
    expect(stopSim).toHaveBeenCalledTimes(1)
    useStore.setState({ running: false, simTime: 2 })
    useLab.setState({ mcus: { U1: frame('U1', 'halted') } })
    toggleRun()
    expect(mcuResume).toHaveBeenCalledWith('U1')
    expect(startSim).toHaveBeenCalledTimes(2)
    expect(stopSim).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// K3 problems
// ---------------------------------------------------------------------------

describe('K3 problems', () => {
  const base = { issues: [], firmware: {}, mcus: {}, running: false, simTime: 0 }
  const fw = { 'U1': { componentId: 'U1', name: 'hal-blink.elf', format: 'elf' as const, sha256: 'a', size: 1, loadedAt: 0, warnings: [] } }

  it('a board without firmware is a warning with a one-click "load firmware" (unless still in its grace period)', () => {
    const p = deriveProblems({ ...base, layout: LAYOUT, findings: [] })
    const nf = p.find((x) => x.id === 'mcu:no-firmware:U1')
    expect(nf).toMatchObject({ level: 'warning', source: 'mcu', title: 'U1 還沒有韌體', componentIds: ['U1'] })
    expect(nf?.action?.label).toBe('載入韌體…')
    expect(nf?.detail).toMatch(/內建韌體/)
    const graced = deriveProblems({ ...base, layout: LAYOUT, findings: [], firmwareGrace: new Set(['U1']) })
    expect(graced.some((x) => x.id === 'mcu:no-firmware:U1')).toBe(false)
  })

  it('MCU states: lockup → error, debugger halt → warning with resume, BOOT0 system memory, unpowered only after running', () => {
    const at = (state: McuFrameInfo['state'], extra: Partial<typeof base> = {}, pc?: number) =>
      deriveProblems({ ...base, ...extra, layout: LAYOUT, findings: [], firmware: fw, mcus: { U1: frame('U1', state, pc) } }).filter(
        (x) => x.source === 'mcu',
      )
    expect(at('running')).toEqual([])
    expect(at('lockup')[0]).toMatchObject({ level: 'error', title: 'U1 故障（鎖死）' })
    const halted = at('halted')[0]
    expect(halted).toMatchObject({ level: 'warning', title: 'U1 核心已停住（偵錯器）' })
    expect(halted.action?.label).toBe('繼續執行')
    expect(at('running', {}, 0x1ffff100)[0]).toMatchObject({ level: 'warning', title: 'U1 從系統記憶體開機（未模擬）' })
    expect(at('unpowered')).toEqual([]) // not run yet: "unpowered" would be a lie
    expect(at('unpowered', { running: true, simTime: 0.5 })[0]).toMatchObject({ title: 'U1 沒有供電' })
  })

  it('ERC findings and simulator issues become problems: levels mapped, first clause as title, sorted, counted', () => {
    // a Blue Pill driving an LED straight from PA5, and no supply at all
    const noPower: CircuitLayout = {
      version: 1,
      components: [
        { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
        { id: 'LED1', type: 'led', holes: ['a20', 'a24'] },
      ],
      wires: [],
    }
    const findings = runErc(noPower)
    expect(findings.length).toBeGreaterThan(0)
    const p = deriveProblems({
      ...base,
      layout: noPower,
      findings,
      issues: [{ level: 'warning', message: 'LED1 is reverse biased — swap its leads', componentId: 'LED1' }],
    })
    const erc = p.filter((x) => x.source === 'erc')
    expect(erc.length).toBe(findings.length)
    // IN-3: titles are the rules' short headlines (ErcFinding.short), the detail is the full message
    expect(erc[0]).toMatchObject({ level: 'error', rule: 'unpowered', title: '電路中沒有電源' })
    expect(erc[0].detail).toMatch(/^電路中沒有電源，因此 U1 與 LED1 無法運作/)
    expect(erc.find((x) => x.rule === 'led-current')).toMatchObject({ level: 'warning', title: 'LED1 沒有限流電阻' })
    for (const e of erc) {
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.title.length).toBeLessThanOrEqual(22)
      expect(e.detail.length).toBeGreaterThan(e.title.length)
    }
    const sim = p.find((x) => x.source === 'sim')!
    expect(sim).toMatchObject({ level: 'warning', componentIds: ['LED1'] })
    // sorted error → warning → info
    const order = { error: 0, warning: 1, info: 2 }
    for (let i = 1; i < p.length; i++) expect(order[p[i].level]).toBeGreaterThanOrEqual(order[p[i - 1].level])
    expect(problemTitle('電路中沒有電源：請接上電源供應器。')).toBe('電路中沒有電源')
    expect(problemTitle('No power source — add a supply')).toBe('No power source')
  })

  it('recomputeProblems publishes counts / top, keeps identities when nothing changed, honours the firmware grace', () => {
    setDocument(LAYOUT)
    expect(recomputeProblems(0)).toBeGreaterThan(0) // U1 just appeared: re-run when its grace ends
    expect(useProblems.getState().problems.some((p) => p.id === 'mcu:no-firmware:U1')).toBe(false)
    expect(recomputeProblems(FIRMWARE_GRACE_MS + 1)).toBeNull()
    const s1 = useProblems.getState()
    expect(s1.problems.some((p) => p.id === 'mcu:no-firmware:U1')).toBe(true)
    expect(s1.counts.warning).toBeGreaterThanOrEqual(1)
    expect(s1.top?.level === 'error' || s1.top?.level === 'warning').toBe(true)
    recomputeProblems(FIRMWARE_GRACE_MS + 2)
    expect(useProblems.getState().problems).toBe(s1.problems) // unchanged → not re-published
  })

  it('the watcher computes at once, debounces layout edits and re-computes on a language switch', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    setDocument(LAYOUT)
    const stop = startProblemsWatcher()
    const stop2 = startProblemsWatcher() // shared subscriptions
    vi.advanceTimersByTime(FIRMWARE_GRACE_MS + 50)
    expect(useProblems.getState().problems.some((p) => p.title === 'U1 還沒有韌體')).toBe(true)
    useStore.setState({ layout: EMPTY })
    vi.advanceTimersByTime(PROBLEMS_DEBOUNCE_MS - 20)
    expect(useProblems.getState().problems.some((p) => p.componentIds.includes('U1'))).toBe(true)
    vi.advanceTimersByTime(40)
    expect(useProblems.getState().problems.some((p) => p.componentIds.includes('U1'))).toBe(false)
    useStore.setState({ layout: LAYOUT })
    vi.advanceTimersByTime(PROBLEMS_DEBOUNCE_MS + FIRMWARE_GRACE_MS + 50)
    expect(useProblems.getState().problems.some((p) => p.title === 'U1 還沒有韌體')).toBe(true)
    // a language switch re-derives the texts at once
    setLang('en')
    expect(useProblems.getState().problems.some((p) => p.title === 'U1 has no firmware yet')).toBe(true)
    setLang('zh-TW')
    expect(useProblems.getState().problems.some((p) => p.title === 'U1 還沒有韌體')).toBe(true)
    stop2()
    expect(useProblems.getState().problems.length).toBeGreaterThan(0)
    useStore.setState({ layout: EMPTY }) // one starter still running: still watched
    vi.advanceTimersByTime(PROBLEMS_DEBOUNCE_MS + 10)
    expect(useProblems.getState().problems.some((p) => p.componentIds.includes('U1'))).toBe(false)
    stop()
    stop() // idempotent
    useStore.setState({ layout: LAYOUT }) // stopped: nothing recomputes any more
    vi.advanceTimersByTime(PROBLEMS_DEBOUNCE_MS + FIRMWARE_GRACE_MS + 50)
    expect(useProblems.getState().problems.some((p) => p.componentIds.includes('U1'))).toBe(false)
    vi.useRealTimers()
  })

  it('focusInspector / openFirmwareFor select the board and publish the request (workspace opens its right panel)', () => {
    setDocument(LAYOUT)
    wide = true
    useLab.getState().setWorkspace({ enabled: true, right: { open: false, width: 340 } })
    openFirmwareFor('U1')
    expect(useStore.getState().selection).toEqual(['U1'])
    expect(useLab.getState().workspace.right.open).toBe(true)
    // UX fix wave IN-19: 「載入韌體…」 opens the built-in firmware picker itself (the board's status card shows it)
    expect(useInspectorFocus.getState().request).toMatchObject({ componentId: 'U1', seq: 1 })
    expect(useFirmwarePickerRequest.getState().request).toMatchObject({ componentId: 'U1', seq: 1 })
    focusInspector('U1', { tab: 'pins', pin: 'PA5' })
    expect(useInspectorFocus.getState().request).toMatchObject({ tab: 'pins', pin: 'PA5', seq: 2 })
    focusInspector('NOPE')
    expect(useInspectorFocus.getState().request?.seq).toBe(2)
  })

  it('locateProblem frames + pulses through the scene bridge; ProblemsList renders titles and actions', () => {
    const scene = { frameTargets: vi.fn(), setProblemHighlights: vi.fn(), frameContent: vi.fn() }
    registerScene(scene)
    const p: Problem = {
      id: 'erc:x',
      level: 'error',
      source: 'erc',
      title: '電路中沒有電源',
      detail: '電路中沒有電源：請接上電源。',
      componentIds: ['R1'],
      holes: ['a40'],
      wireIds: ['W1'],
    }
    expect(locateProblem(p)).toBe(true)
    expect(scene.setProblemHighlights).toHaveBeenCalledWith({ components: ['R1', 'W1'], holes: ['a40'], level: 'error' })
    const action = vi.fn()
    const list: Problem[] = [
      p,
      { ...p, id: 'mcu:no-firmware:U1', level: 'warning', title: 'U1 還沒有韌體', componentIds: ['U1'], holes: [], action: { label: '載入韌體…', run: action } },
    ]
    const html = renderToStaticMarkup(createElement(ProblemsView, { variant: 'panel', problems: list }))
    expect(html).toContain('問題（2）')
    expect(html).toContain('電路中沒有電源')
    expect(html).toContain('載入韌體…')
    expect(html).toContain('在電路板上標示')
    const onlyU1 = renderToStaticMarkup(createElement(ProblemsView, { variant: 'compact', componentId: 'U1', problems: list }))
    expect(onlyU1).toContain('U1 還沒有韌體')
    // IN-3: compact rows carry their (clamped) explanation; only U1's own row is listed
    expect(onlyU1.match(/class="erc-title"/g)?.length).toBe(1)
    expect(onlyU1).not.toContain('erc-title">電路中沒有電源')
    expect(renderToStaticMarkup(createElement(ProblemsView, { variant: 'compact', componentId: 'R9', problems: list }))).toBe('')
    expect(renderToStaticMarkup(createElement(ProblemsView, { variant: 'panel', problems: [] }))).toContain('未發現問題')
    // the store-bound list (server render = the store's initial, empty state)
    expect(renderToStaticMarkup(createElement(ProblemsList, { variant: 'panel' }))).toContain('問題（0）')
  })
})

// ---------------------------------------------------------------------------
// K4 scene bridge
// ---------------------------------------------------------------------------

describe('K4 scene bridge', () => {
  it('is a safe no-op without a scene or without the optional methods', () => {
    expect(sceneRegistered()).toBe(false)
    expect(focusInScene({ components: ['U1'] })).toBe(false)
    frameCircuit()
    clearSceneFocus()
    registerScene({})
    expect(focusInScene({ components: ['U1'] }, { kind: 'problem' })).toBe(true)
    expect(focusInScene({ components: [], holes: [] })).toBe(false)
    frameCircuit()
  })

  it("'guide' only frames; 'problem' frames and pulses the problem layer for 6 s; the next problem replaces it", () => {
    vi.useFakeTimers()
    const scene = { frameTargets: vi.fn(), setProblemHighlights: vi.fn(), frameContent: vi.fn() } satisfies BridgeScene
    registerScene(scene)
    focusInScene({ holes: ['c20', 'c20', ''] }, { kind: 'guide', minSpanHoles: 6 })
    expect(scene.frameTargets).toHaveBeenLastCalledWith({ holes: ['c20'], components: [] }, { minSpanHoles: 6 })
    expect(scene.setProblemHighlights).not.toHaveBeenCalled()

    focusInScene({ components: ['W1'] }, { kind: 'problem', level: 'error' })
    expect(scene.setProblemHighlights).toHaveBeenLastCalledWith({ holes: [], components: ['W1'], level: 'error' })
    expect(activeProblemFocus()?.components).toEqual(['W1'])
    vi.advanceTimersByTime(3000)
    focusInScene({ components: ['R1'] }, { kind: 'problem', level: 'risk', frame: false })
    expect(scene.frameTargets).toHaveBeenCalledTimes(2) // frame:false did not move the camera
    vi.advanceTimersByTime(3500) // the first problem's timer must not clear the second
    expect(activeProblemFocus()?.level).toBe('risk')
    vi.advanceTimersByTime(3000)
    expect(activeProblemFocus()).toBeNull()
    expect(scene.setProblemHighlights).toHaveBeenLastCalledWith(null)

    focusInScene({ components: ['R1'] }, { kind: 'problem', holdMs: 0 }) // until cleared
    vi.advanceTimersByTime(60_000)
    expect(activeProblemFocus()).not.toBeNull()
    clearSceneFocus('guide')
    expect(activeProblemFocus()).not.toBeNull()
    clearSceneFocus()
    expect(activeProblemFocus()).toBeNull()
    frameCircuit()
    expect(scene.frameContent).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('a throwing scene method never breaks the caller', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerScene({
      frameTargets: () => {
        throw new Error('boom')
      },
    })
    expect(() => focusInScene({ components: ['U1'] })).not.toThrow()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// K5 hover chip
// ---------------------------------------------------------------------------

describe('K5 holeChipText', () => {
  it('names MCU pins, part pins, wire ends, strip neighbours and rail holes', () => {
    setDocument(LAYOUT)
    expect(holeChipText('c20')).toBe('U1 PA5（板上 A5）· c20')
    expect(holeChipText('a40')).toBe('R1 第 1 腳 · a40')
    expect(holeChipText('c40')).toBe('c40（R1 第 1 腳這一排）')
    expect(holeChipText('a20')).toBe('a20（U1 PA5 這一排）')
    expect(holeChipText('top+3')).toBe('導線 W1 · 上方 + 電源軌 · 第 3 孔（top+3）')
    expect(holeChipText('bot-10')).toBe('下方 − 電源軌 · 第 10 孔（bot-10）')
    expect(holeChipText('a60')).toBeNull()
    expect(holeChipText('zz9')).toBeNull()
    __setLangForTests('en')
    expect(holeChipText('c20')).toBe('U1 PA5 (board label A5) · c20')
    expect(holeChipText('c40')).toBe('c40 (R1 lead 1 strip)')
  })

  it('prefixes the board id with several MCUs and names a strip by its first part pin (H2)', () => {
    const two: CircuitLayout = {
      version: 1,
      components: [
        { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
        { id: 'U2', type: 'stm32_bluepill', at: 'h35' },
        { id: 'R1', type: 'resistor', holes: ['a5', 'b5'] },
        { id: 'R2', type: 'resistor', holes: ['c5', 'a7'] },
      ],
      wires: [{ id: 'W1', from: 'd5', to: 'top+1' }],
    }
    expect(holeChipTextFor(two, 'c20')).toBe('U1 PA5（板上 A5）· c20')
    expect(holeChipTextFor(two, 'e5')).toBe('e5（R1 第 1 腳這一排）')
    // a wire end on a strip also names what that strip connects it to (SC-4)
    expect(holeChipTextFor(two, 'd5')).toBe('導線 W1 · d5（R1 第 1 腳這一排）')
  })
})

// ---------------------------------------------------------------------------
// K6 probe menu
// ---------------------------------------------------------------------------

describe('K6 probe menu', () => {
  it('opens for scene targets, ignores empty ones, and lists the probe actions', () => {
    setDocument(LAYOUT)
    openProbeMenu({}, { x: 10, y: 10 })
    expect(probeMenuOpen()).toBe(false)
    openProbeMenu({ hole: 'c20' }, { x: 300, y: 200 })
    expect(probeMenuOpen()).toBe(true)
    closeProbeMenu()
    expect(probeMenuOpen()).toBe(false)

    const m = probeMenuModel({ kind: 'hole', ref: 'c20' })
    expect(m.header).toBe('U1 PA5（板上 A5）· c20')
    expect(m.items.map((i) => i.label)).toEqual(['加入邏輯分析儀', '放示波器探棒（CH1）', '選取接在這裡的元件', '在屬性面板查看這支腳'])
    const r = probeMenuModel({ kind: 'hole', ref: 'a40' })
    expect(r.items).toHaveLength(3) // not an MCU pin
    expect(r.items[2].disabled).toBe(false) // R1 is there
    m.items[3].run()
    expect(useStore.getState().selection).toEqual(['U1'])
    expect(useInspectorFocus.getState().request).toMatchObject({ tab: 'pins', pin: 'PA5' })
  })

  it('disables the scope item with the reason when all four channels are in use', () => {
    const probes = [1, 2, 3, 4].map((ch, i) => ({ id: `P${ch}`, type: 'scope_probe', holes: [`j${50 + i}`], params: { channel: ch } }))
    setDocument({ ...LAYOUT, components: [...LAYOUT.components, ...probes] })
    const scope = probeMenuModel({ kind: 'hole', ref: 'c20' }).items.find((i) => i.key === 'scope')!
    expect(scope.disabled).toBe(true)
    expect(scope.title).toMatch(/四個示波器通道都在使用中/)
  })
})

// ---------------------------------------------------------------------------
// K7 probe actions
// ---------------------------------------------------------------------------

describe('K7 probe actions', () => {
  it('resolves holes holding MCU pins to the pin, other points to nets, and refuses unknown targets', () => {
    setDocument(LAYOUT)
    expect(resolveProbeTarget({ kind: 'hole', ref: 'c20' })).toMatchObject({ ok: true, target: { kind: 'mcu-pin', pin: 'PA5', hole: 'c20', label: 'PA5' } })
    expect(resolveProbeTarget({ kind: 'hole', ref: 'a44' })).toMatchObject({ ok: true, target: { kind: 'net', ref: 'a44', label: 'a44' } })
    expect(resolveProbeTarget({ kind: 'terminal', ref: 'PS1:+' })).toMatchObject({ ok: true, target: { kind: 'net', ref: 'PS1:+', hole: null } })
    expect(resolveProbeTarget({ kind: 'mcu-pin', componentId: 'U1', pin: 'GND1' })).toMatchObject({ ok: true, target: { kind: 'net' } })
    const bad = resolveProbeTarget({ kind: 'mcu-pin', componentId: 'U9', pin: 'PA5' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('電路中找不到 U9 PA5')
    expect(probeTargetFromScene({ terminal: 'PS1:+' })).toEqual({ kind: 'terminal', ref: 'PS1:+' })
    expect(probeTargetFromScene({})).toBeNull()
  })

  it('addLogicChannelFor takes the lowest free index and refuses the same signal twice (same net counts)', () => {
    setDocument({ ...LAYOUT, components: [...LAYOUT.components, { id: 'R2', type: 'resistor', holes: ['a20', 'a24'] }] })
    useLab.getState().setLogicChannels([{ index: 0, label: 'X', source: { kind: 'net', ref: 'j60' } }])
    const r = addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' })
    expect(r).toEqual({ ok: true, index: 1 })
    expect(useLab.getState().logicChannels[1]).toEqual({ index: 1, label: 'PA5', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } })
    // IS-13: toasts name the channel as the analyzer shows it (H1), never 「通道 D1」;
    // no workspace tray (a phone): the 儀器 sheet is the toast's own action, not a sentence
    expect(lastToast()).toBe('已加入邏輯分析儀：PA5（板上 A5）')
    expect(getToasts()[getToasts().length - 1]?.action?.label).toBe('在儀器中查看')
    const again = addLogicChannelFor({ kind: 'hole', ref: 'c20' })
    expect(again.ok).toBe(false)
    expect(again.reason).toBe('PA5（板上 A5） 已在邏輯分析儀上')
    // R2's lead shares PA5's strip: the same electrical net
    const sameNet = addLogicChannelFor({ kind: 'hole', ref: 'a20' })
    expect(sameNet.ok).toBe(false)
    expect(lastToast()).toMatch(/已在邏輯分析儀/)
    const other = addLogicChannelFor({ kind: 'hole', ref: 'a24' }, 'R2 右腳')
    expect(other).toEqual({ ok: true, index: 2 })
    expect(useLab.getState().logicChannels.map((c) => c.label)).toEqual(['X', 'PA5', 'R2 右腳'])
    expect(nextLogicIndex(Array.from({ length: 16 }, (_, index) => ({ index, label: '', source: { kind: 'net', ref: 'a1' } })))).toBeNull()
  })

  it('opens the logic tab of the workspace tray when the workspace is showing', () => {
    setDocument(LAYOUT)
    wide = true
    useLab.getState().setWorkspace({ enabled: true, tray: { open: false, height: 240, tab: 'uart' } })
    expect(addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' }).ok).toBe(true)
    expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'logic' })
    expect(lastToast()).toBe('已加入邏輯分析儀：PC13（板上 C13）')
  })

  it('addScopeProbeFor places a real probe in a free hole of the strip on the lowest free channel', async () => {
    setDocument(LAYOUT)
    expect(probeHolesNear(useStore.getState().layout, 'c20')).toEqual(['a20']) // the board covers rows b–i
    const r1 = await addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' })
    expect(r1).toMatchObject({ ok: true, channel: 1 })
    const p1 = useStore.getState().layout.components.find((c) => c.id === r1.componentId)!
    expect(p1).toMatchObject({ type: 'scope_probe', holes: ['a20'] })
    expect(lastToast()).toBe('已在 c20 這一排放示波器探棒（CH1）')
    const r2 = await addScopeProbeFor({ kind: 'hole', ref: 'c19' })
    expect(r2).toMatchObject({ ok: true, channel: 2 })
    expect(useStore.getState().layout.components.find((c) => c.id === r2.componentId)?.params?.channel).toBe(2)
    expect(nextScopeChannel()).toBe(3)
    // IS-13: PA5's net already has a probe — that one is named (one net, one probe) …
    const dup = await addScopeProbeFor({ kind: 'hole', ref: 'c20' })
    expect(dup).toMatchObject({ ok: false, existing: { componentId: r1.componentId, channel: 1, hole: 'a20' } })
    expect(dup.reason).toBe(`這個網路已由 ${r1.componentId} 量測（CH1）`)
    // … and asked for anyway, PA5's strip is full now
    const full = await addScopeProbeFor({ kind: 'hole', ref: 'c20' }, { allowDuplicate: true })
    expect(full.ok).toBe(false)
    expect(full.reason).toBe('c20 所在的網路已經沒有空孔：請空出同一排的一個孔位，或用導線把這個網路接到空的一排')
    // a rail: the nearest free rail holes; a wired terminal reaches the board through its wire
    const rail = await addScopeProbeFor({ kind: 'terminal', ref: 'PS1:+' })
    expect(rail).toMatchObject({ ok: true, channel: 3 })
    expect(lastToast()).toBe('已在上方 + 電源軌放示波器探棒（CH3）')
  })

  it('a full strip falls back to another strip on the same net', async () => {
    // PA5's only free hole (a20) holds a wire to strip 50: the probe goes there
    setDocument({ ...LAYOUT, wires: [...LAYOUT.wires, { id: 'W3', from: 'a20', to: 'a50' }] })
    expect(probeHolesNear(useStore.getState().layout, 'c20')).toEqual([])
    expect(probeHolesOnNet(useStore.getState().layout, 'c20')).toEqual(['b50', 'c50', 'd50', 'e50'])
    const r = await addScopeProbeFor({ kind: 'hole', ref: 'c20' })
    expect(r).toMatchObject({ ok: true, channel: 1 })
    expect(useStore.getState().layout.components.find((c) => c.id === r.componentId)?.holes).toEqual(['b50'])
    expect(lastToast()).toBe('c20 這一排沒有空孔，已改放在同一個網路的 b50（CH1）')
  })

  it('refuses honestly: unwired terminal, all channels in use', async () => {
    setDocument({ ...LAYOUT, components: [...LAYOUT.components, { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }] })
    const r = await addScopeProbeFor({ kind: 'terminal', ref: 'DMM1:IN' })
    expect(r).toEqual({ ok: false, reason: 'DMM1:IN 沒有接到麵包板，探棒接不到' })
    const probes = [1, 2, 3, 4].map((ch, i) => ({ id: `P${ch}`, type: 'scope_probe', holes: [`j${50 + i}`], params: { channel: ch } }))
    setDocument({ ...LAYOUT, components: [...LAYOUT.components, ...probes] })
    const n = useStore.getState().layout.components.length
    expect((await addScopeProbeFor({ kind: 'hole', ref: 'c20' })).reason).toBe('四個示波器通道都在使用中，請先移動或移除一支探棒')
    expect(useStore.getState().layout.components.length).toBe(n)
  })

  it('netMembersFor lists the parts on the net; revealInLogic publishes requests and ignores bad input', () => {
    setDocument(LAYOUT)
    expect(netMembersFor({ kind: 'terminal', ref: 'PS1:+' })).toMatchObject({ componentIds: ['PS1'], wireIds: ['W1'] })
    expect(netMembersFor({ kind: 'hole', ref: 'a60' }).componentIds).toEqual([])
    revealInLogic(2.5)
    expect(useLogicReveal.getState().request).toMatchObject({ t: 2.5, span: 0.01 })
    const seq = useLogicReveal.getState().request!.seq
    revealInLogic(Number.NaN)
    revealInLogic(-1)
    expect(useLogicReveal.getState().request!.seq).toBe(seq)
    revealInLogic(1, 0.5)
    expect(useLogicReveal.getState().request).toMatchObject({ t: 1, span: 0.5, seq: seq + 1 })
  })
})

// ---------------------------------------------------------------------------
// K8 coach slot + coach rect
// ---------------------------------------------------------------------------

describe('K8 coach slot', () => {
  it('LibraryPanel has an empty #ws-coach-slot between the tabs and the body, on every tab', () => {
    for (const tab of ['parts', 'examples', 'lessons'] as const) {
      useLab.getState().setWorkspace({ left: { open: true, width: 300, tab } })
      const html = renderToStaticMarkup(createElement(LibraryPanel, { onCollapse: () => {} }))
      expect(html, tab).toMatch(/<\/div><div id="ws-coach-slot" class="ws-coach-slot"><\/div><div class="ws-scroll">/)
    }
    const css = read('src/ui/workspace/workspace.css')
    expect(css).toMatch(/\.ws-coach-slot:empty\s*\{\s*display:\s*none;\s*\}/)
  })

  it('useLessonUi.coachRect rounds, ignores unchanged values and clears', () => {
    const ui = () => useLessonUi.getState()
    expect(ui().coachRect).toBeNull()
    ui().setCoachRect({ top: 16.4, bottom: 120.6, height: 104.2 })
    const r = ui().coachRect
    expect(r).toEqual({ top: 16, bottom: 121, height: 104 })
    ui().setCoachRect({ top: 16.1, bottom: 120.9, height: 104.4 })
    expect(ui().coachRect).toBe(r)
    ui().setCoachRect({ top: Number.NaN, bottom: 1, height: 1 })
    expect(ui().coachRect).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// K9 first lesson
// ---------------------------------------------------------------------------

describe('K9 startFirstLesson', () => {
  afterEach(() => {
    useLessonUi.setState({ viewId: null, coachId: null, confirm: null, sheetOpen: false })
  })

  it('the first lesson is the first beginner lesson (b1)', () => {
    expect(firstLesson()?.id).toBe('b1-led-resistor')
  })

  it('on an empty board: loads the starting circuit and starts the guide on step 1', async () => {
    useLessonProgress.getState().reset('b1-led-resistor')
    expect(await startFirstLesson()).toBe('loaded')
    expect(useLessonUi.getState().coachId).toBe('b1-led-resistor')
    expect(useLessonUi.getState().viewId).toBe('b1-led-resistor')
    expect(useLessonProgress.getState().lessons['b1-led-resistor']?.step).toBe(0)
    expect(useStore.getState().layout.components.some((c) => c.id === 'LED1')).toBe(true)
    expect(useLessonUi.getState().sheetOpen).toBe(false) // phones keep the board visible
  })

  it('on a board with content: asks first, opens the lessons tab in the workspace, touches nothing', async () => {
    setDocument(LAYOUT)
    wide = true
    useLab.getState().setWorkspace({ enabled: true, left: { open: false, width: 300, tab: 'parts' } })
    expect(await startFirstLesson()).toBe('confirm')
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: 'b1-led-resistor', which: 'start' })
    expect(useLab.getState().workspace.left).toMatchObject({ open: true, tab: 'lessons' })
    expect(useStore.getState().layout).toBe(LAYOUT)
  })
})

// ---------------------------------------------------------------------------
// K10 examples by id
// ---------------------------------------------------------------------------

describe('K10 openExampleById', () => {
  it('finds entries and their main instrument (logic > scope > uart)', () => {
    expect(findLibraryExample('blink')?.title).toBe('Blue Pill 閃爍 LED（HAL）')
    expect(exampleMainInstrument(findLibraryExample('blink')!)).toBe('logic')
    expect(exampleMainInstrument(findLibraryExample('adc-pot')!)).toBe('scope')
    expect(exampleMainInstrument(findLibraryExample('lm7805-regulator')!)).toBeNull()
    expect(exampleMainInstrument({ instruments: ['uart'] })).toBe('uart')
    // …except an example about a UART link itself: its terminal (SC-2)
    expect(exampleMainInstrument(findLibraryExample('uart-hello')!)).toBe('uart')
    expect(exampleMainInstrument(findLibraryExample('i2c-scan')!)).toBe('logic')
  })

  it('an unknown id is a localized error, not an exception', async () => {
    const r = await openExampleById('nope')
    expect(r).toEqual({ ok: false, error: '找不到範例「nope」' })
    expect(lastToast()).toBe('無法開啟範例：找不到範例「nope」')
  })

  it('confirmIfNotEmpty keeps a non-empty board and reveals the card instead', async () => {
    setDocument(LAYOUT)
    wide = true
    useLab.getState().setWorkspace({ enabled: true, left: { open: false, width: 300, tab: 'parts' } })
    const seen = vi.fn()
    const off = onExampleReveal(seen)
    const r = await openExampleById('blink', { confirmIfNotEmpty: true })
    off()
    expect(r).toEqual({ ok: false, pending: 'confirm' })
    expect(useStore.getState().layout).toBe(LAYOUT)
    expect(exampleRevealRequest()?.key).toBe('blink')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(useLab.getState().workspace.left).toMatchObject({ open: true, tab: 'examples' })
  })

  it('opens the example (firmware bound) and switches the tray to its main instrument', async () => {
    // node: no `window`, so the example envelope is read from disk
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', storage)
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    try {
      useLab.getState().setWorkspace({ tray: { open: false, height: 240, tab: 'uart' } })
      const r = await openExampleById('blink')
      expect(r).toEqual({ ok: true })
      expect(useStore.getState().layout.components.some((c) => c.type === 'stm32_bluepill')).toBe(true)
      expect(Object.values(useLab.getState().firmware).map((f) => f.name)).toContain('hal-blink.elf')
      expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'logic' })
      expect(lastToast()).toBe('已開啟「Blue Pill 閃爍 LED（HAL）」')
    } finally {
      __setFirmwareBlobStoreForTests(null)
    }
  })
})

// ---------------------------------------------------------------------------
// K11 pin display names
// ---------------------------------------------------------------------------

describe('K11 pinDisplayName', () => {
  const e = (type: string): CatalogEntry => getEntry(type)!

  it('reads like a person would say it (zh-TW)', () => {
    const bp = e('stm32_bluepill')
    expect(pinDisplayName(bp, 'PA5')).toBe('PA5（板上 A5）')
    expect(pinDisplayName(bp, 'GND1')).toBe('GND（板上 G）')
    expect(pinDisplayName(bp, '3V3_2')).toBe('3V3（板上 3.3）')
    expect(pinDisplayName(bp, '5V')).toBe('5V')
    expect(pinDisplayName(bp, 'NRST')).toBe('NRST（板上 R）')
    expect(pinDisplayName(e('led'), 'anode')).toBe('陽極（長腳）')
    expect(pinDisplayName(e('led'), 'cathode')).toBe('陰極（短腳）')
    expect(pinDisplayName(e('diode'), 'cathode')).toBe('陰極（色環端）')
    expect(pinDisplayName(e('diode'), 'anode')).toBe('陽極')
    expect(pinDisplayName(e('resistor'), 'p1')).toBe('第 1 腳')
    expect(pinDisplayName(e('resistor'), 'p2')).toBe('第 2 腳')
    expect(pinDisplayName(e('power_supply'), '+')).toBe('正端')
    expect(pinDisplayName(e('power_supply'), '-')).toBe('負端')
    expect(pinDisplayName(e('potentiometer'), 'wiper')).toBe('滑動端')
    expect(pinDisplayName(e('slide_switch'), 'a')).toBe('a 端')
    expect(pinDisplayName(e('ne555'), 'VCC')).toBe('VCC')
  })

  it('English stays readable English', () => {
    __setLangForTests('en')
    expect(pinDisplayName(e('stm32_bluepill'), 'PA5')).toBe('PA5 (board label A5)')
    expect(pinDisplayName(e('led'), 'anode')).toBe('anode (long lead)')
    expect(pinDisplayName(e('resistor'), 'p2')).toBe('lead 2')
    expect(pinDisplayName(e('power_supply'), '-')).toBe('negative terminal')
  })
})

// ---------------------------------------------------------------------------
// zh-TW coverage of the contract modules
// ---------------------------------------------------------------------------

const FILES = [
  'src/i18n/parts.ts',
  'src/ui/chrome/legacy.ts',
  'src/ui/chrome/run-control.ts',
  'src/ui/embedded/problems.ts',
  'src/ui/embedded/ProblemsList.tsx',
  'src/ui/embedded/probe-actions.ts',
  'src/ui/workspace/scene-bridge.ts',
  'src/ui/workspace/hole-chip.ts',
  'src/ui/workspace/ProbeMenu.tsx',
  'src/ui/workspace/examples.ts',
  'src/ui/lessons/actions.ts',
]

function literalKeys(src: string): string[] {
  const re = /\b(t|tc)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push(m[1] === 'tc' && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

describe('zh-TW coverage of the contract modules', () => {
  it('every literal t()/tc() source has a zh-TW entry', () => {
    __setLangForTests('zh-TW')
    const missing: string[] = []
    for (const f of FILES) for (const k of literalKeys(read(f))) if (!hasTranslation(k)) missing.push(`${f}: ${k}`)
    expect(missing).toEqual([])
    // table-driven rail names
    for (const k of ['top + rail', 'top − rail', 'bottom + rail', 'bottom − rail']) expect(hasTranslation(k), k).toBe(true)
  })

  it('the ux-contracts dictionary is Taiwan-usage Chinese with intact placeholders', () => {
    const entries = Object.entries(uxContracts)
    expect(entries.length).toBeGreaterThan(40)
    for (const [en, zh] of entries) {
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${en} → ${zh} uses ${term}`).toBe(false)
      expect(halfWidthPunctuation(zh), zh).toEqual([])
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(ph(zh), en).toEqual(ph(en))
      if (en !== ', ') expect(englishLeft(zh.replace(/\{\w+\}/g, ' '), ['elf', 'bin', 'hex']), zh).toEqual([])
    }
    // the merged dictionary really uses these (no other file overrides a key)
    __setLangForTests('zh-TW')
    for (const [en, zh] of entries) expect(t(en), en).toBe(zh)
  })
})
