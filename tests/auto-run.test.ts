/**
 * Auto-run (round 5 — 「改了就自動模擬，不用按執行」, src/ui/chrome/auto-run.ts)
 * against the real store and a scripted fake SimHost:
 *  - the app's first start waits for the lab's firmware restore (labReady);
 *  - an empty board (wires only too) never builds a host; deleting the last
 *    part ends the session;
 *  - a structural edit / undo / firmware change resumes even the learner's
 *    own pause, using the circuit (a knob, an instrument move) does not;
 *  - a reset of a paused run stays paused at t = 0, a reset of a running one
 *    restarts it;
 *  - the run gate (lab.importProject / loadLessonCircuit) defers a load until
 *    its release; a release with nothing changed decides nothing;
 *  - a debugger halt is never resumed, a failed start never retried on the
 *    same circuit;
 *  - classic chrome / ?shotrig / ?perfwin / ?perfrig / ?autorun=0 suppression;
 *  - runStartedByAutoRun: why the current run started (null for a user start);
 *  - store.simStopReason: 'user' / 'debugger' / 'failed' / 'reset' / null;
 *  - an edit while running, and a resumed pause, never blank the telemetry
 *    (the 顯示電流 dots do not blink);
 *  - verification fixes: the boot goes ahead after BOOT_TIMEOUT_MS when the
 *    lab's restore never settles; autoRunWaiting() while a start is coming
 *    (the pill's ready line holds back); the same firmware flashed again
 *    resumes a pause; the product chrome coming up starts what is on the
 *    board ('chrome', a pause kept); a lesson step's 重置模擬 leaves the
 *    restart to auto-run (its run, so the coach does not fold).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, ParamValue, SimTelemetry } from '../src/model/types'
import type { SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import * as S from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { __resetRunGateForTests, holdAutoRun, whileAutoRunHeld } from '../src/state/run-gate'
import {
  autoRunActive,
  autoRunAllowed,
  autoRunEnabled,
  autoRunInstallCount,
  autoRunWaiting,
  runStartedByAutoRun,
  startAutoRun,
} from '../src/ui/chrome/auto-run'
import { lessonById } from '../src/lessons'
import { resetFromStep } from '../src/ui/lessons/actions'
import { runFoldsCoach } from '../src/ui/lessons/LessonOverlay'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAIL_WIRES: CircuitLayout['wires'] = [
  { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
  { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
]

/** 5 V supply → rails → R1 (1 kΩ) rail to rail. */
const CIRCUIT: CircuitLayout = {
  version: 1,
  name: 'auto-run',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['a10', 'a15'], params: { resistance: 1000 } },
  ],
  wires: [...RAIL_WIRES, { id: 'W3', from: 'top+1', to: 'b10', color: 'red' }, { id: 'W4', from: 'top-1', to: 'b15', color: 'black' }],
}

const EMPTY: CircuitLayout = { version: 1, name: 'empty', components: [], wires: [] }
/** wires only: nothing to simulate (the chrome's empty-board rule) */
const WIRES_ONLY: CircuitLayout = { version: 1, name: 'wires', components: [], wires: [{ id: 'W1', from: 'a1', to: 'a5', color: 'red' }] }

function tele(time: number): SimTelemetry {
  return { time, netVoltages: {}, components: {}, issues: [] }
}

function frame(p: Partial<SimFrame> & { rev: number; time: number }): SimFrame {
  return {
    running: true,
    telemetry: tele(p.time),
    scope: [],
    uart: [],
    mcus: [],
    log: [],
    issues: [],
    perf: { realtimeFactor: 1, stepsPerSecond: 20000, busyMs: 1 },
    ...p,
  }
}

/** Scripted SimHost: records every call; the test pushes frames. */
class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  readonly calls: string[] = []
  lastRev = 0
  startError: string | null = null
  constructor(readonly cb: SimHostCallbacks) {}
  count(method: string): number {
    return this.calls.filter((c) => c === method).length
  }
  emit(p: Partial<SimFrame> & { time: number }): void {
    this.cb.onFrame(frame({ rev: this.lastRev, ...p }))
  }
  load(_layout: CircuitLayout, rev: number): void {
    this.lastRev = rev
    this.calls.push('load')
  }
  setFirmware(): void {
    this.calls.push('setFirmware')
  }
  start(): void {
    this.calls.push('start')
    if (this.startError) this.cb.onError?.(this.startError)
  }
  pause(): void {
    this.calls.push('pause')
  }
  reset(): void {
    this.calls.push('reset')
  }
  setSpeed(): void {
    this.calls.push('setSpeed')
  }
  stepTime(): void {
    this.calls.push('stepTime')
  }
  mcuReset(): void {}
  mcuHalt(): void {}
  mcuResume(): void {}
  mcuStep(): void {}
  setRuntimeParam(_id: string, _key: string, _value: ParamValue): void {
    this.calls.push('setRuntimeParam')
  }
  uartSend(): void {}
  setLogicChannels(): void {}
  async query(): Promise<never> {
    throw new Error('not scripted')
  }
  dispose(): void {
    this.calls.push('dispose')
  }
}

const st = () => S.useStore.getState()
let hosts: FakeHost[] = []
const host = (): FakeHost => hosts[hosts.length - 1]
let stop: (() => void) | null = null

/** Let auto-run's macrotask decision (and a resolved ready()) land. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

function resetStoreTo(layout: CircuitLayout): void {
  st().resetSim()
  S.__resetHistoryForTests()
  S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false, simSpeed: 1, issues: [] })
}

/** Install auto-run (enabled, the lab "ready" at once unless `ready` is given). */
function install(ready: () => Promise<void> = () => Promise.resolve(), enabled: () => boolean = () => true, bootTimeoutMs?: number): void {
  stop = startAutoRun({ ready, enabled, bootTimeoutMs })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

beforeEach(() => {
  __setLangForTests('zh-TW')
  hosts = []
  S.__setSimHostFactoryForTests((cb) => {
    const h = new FakeHost(cb)
    hosts.push(h)
    return h
  })
  __resetRunGateForTests()
  useLab.setState({ mcus: {} })
  resetStoreTo(CIRCUIT)
})

afterEach(() => {
  stop?.()
  stop = null
  S.setTelemetrySink(null)
  S.__setSimHostFactoryForTests(null)
  __resetRunGateForTests()
  resetStoreTo(EMPTY)
  __setLangForTests('zh-TW')
})

// ---------------------------------------------------------------------------
// store.simStopReason
// ---------------------------------------------------------------------------

describe('store.simStopReason (why the simulation stands still)', () => {
  it('null while running; user on a pause, kept through a reset of that pause; reset otherwise', () => {
    expect(S.simStopReason()).not.toBe('user') // beforeEach's reset of a session that never ran
    st().startSim()
    expect(S.simStopReason()).toBeNull()
    st().stopSim()
    expect(S.simStopReason()).toBe('user')
    st().resetSim()
    expect(S.simStopReason()).toBe('user') // a paused simulation that is reset stays paused
    st().startSim()
    expect(S.simStopReason()).toBeNull()
    st().resetSim()
    expect(S.simStopReason()).toBe('reset') // a running one's session just ended
  })

  it('debugger on a halt that froze the world, failed on a host failure', () => {
    st().startSim()
    host().emit({ time: 0.1 })
    host().emit({
      time: 0.12,
      running: false,
      mcus: [{ componentId: 'U1', state: 'halted', firmware: null, pc: 0, hclkHz: 8e6, cycles: 0, realtime: 0, uarts: [] }],
    })
    expect(st().running).toBe(false)
    expect(S.simStopReason()).toBe('debugger')
    S.resumeAfterDebugHalt()
    expect(S.simStopReason()).toBeNull()
    host().cb.onError?.('worker crashed')
    expect(S.simStopReason()).toBe('failed')
    S.__setSimHostFactoryForTests(null)
    expect(S.simStopReason()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// auto-run
// ---------------------------------------------------------------------------

describe('auto-run: when the simulation starts by itself', () => {
  it('the first start waits for the lab (labReady); then it is a boot start', async () => {
    let open!: () => void
    const ready = new Promise<void>((r) => (open = r))
    install(() => ready)
    await flush()
    expect(hosts).toHaveLength(0)
    st().addComponent('resistor', { holes: ['a20', 'a24'] }) // an edit before the lab is ready waits too
    await flush()
    expect(hosts).toHaveLength(0)
    open()
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('boot')
    expect(runStartedByAutoRun()?.layout).toBe(st().layout)
    expect(autoRunInstallCount()).toBe(1)
  })

  it('an empty board (wires only too) never builds a host; the first part starts it', async () => {
    resetStoreTo(WIRES_ONLY)
    install()
    await flush()
    expect(hosts).toHaveLength(0)
    expect(st().running).toBe(false)
    st().addComponent('resistor', { holes: ['a20', 'a24'] })
    await flush()
    expect(hosts).toHaveLength(1)
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('edit')
  })

  it('deleting the last part ends the session (resetSim): time 0, nothing running, no new start', async () => {
    resetStoreTo({ ...CIRCUIT, components: [CIRCUIT.components[1]], wires: [] })
    install()
    await flush()
    expect(st().running).toBe(true)
    host().emit({ time: 0.5 })
    expect(st().simTime).toBe(0.5)
    st().removeComponent('R1')
    await flush()
    expect(st().running).toBe(false)
    expect(st().simTime).toBe(0)
    expect(host().count('reset')).toBe(1)
    expect(host().count('start')).toBe(1)
    expect(S.simStopReason()).toBe('reset')
  })

  it('the learner’s pause: a knob or an instrument move keeps it, a structural edit / undo resumes it', async () => {
    install()
    await flush()
    expect(st().running).toBe(true)
    host().emit({ time: 0.4 })
    st().stopSim()
    expect(S.simStopReason()).toBe('user')
    expect(runStartedByAutoRun()).toBeNull() // the record ends with the run

    st().setParam('PS1', 'voltage', 3.3) // a runtime param: using the circuit
    await flush()
    expect(st().running).toBe(false)
    expect(st().setInstrumentPos('PS1', { x: -20, z: 30 }).ok).toBe(true) // visual only
    await flush()
    expect(st().running).toBe(false)

    st().setParam('R1', 'resistance', 2200) // structural: the circuit changed
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('edit')

    st().stopSim()
    st().undo() // undo of the structural edit is a change of the circuit too
    await flush()
    expect(st().running).toBe(true)
  })

  it('a firmware change resumes the learner’s pause', async () => {
    install()
    await flush()
    st().stopSim()
    const rec = { componentId: 'R1', name: 'x.elf', format: 'elf' as const, sha256: 'ab'.repeat(32), size: 1, loadedAt: 0, warnings: [] }
    useLab.setState({ firmware: { R1: rec } })
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('firmware')
    useLab.setState({ firmware: {} })
  })

  it('重置模擬: a paused simulation stays paused at t = 0, a running one powers up again', async () => {
    install()
    await flush()
    host().emit({ time: 0.3 })
    st().stopSim()
    st().resetSim()
    await flush()
    expect(st().running).toBe(false)
    expect(st().simTime).toBe(0)

    st().startSim() // the learner runs it again
    expect(runStartedByAutoRun()).toBeNull() // a user start is not auto-run's
    host().emit({ time: 0.3 })
    st().resetSim()
    expect(st().running).toBe(false)
    await flush()
    expect(st().running).toBe(true)
    expect(st().simTime).toBe(0)
    expect(runStartedByAutoRun()?.reason).toBe('reset')
  })

  it('a load (example / AI / JSON) starts the new circuit; the run gate defers it until the release', async () => {
    install()
    await flush()
    st().stopSim() // even a paused run: a new circuit runs
    const release = holdAutoRun()
    expect(st().loadLayout({ ...CIRCUIT, name: 'loaded' }).ok).toBe(true)
    await flush()
    expect(st().running).toBe(false)
    const second = holdAutoRun() // ref-counted
    release()
    await flush()
    expect(st().running).toBe(false)
    second()
    second() // idempotent
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('load')
  })

  it('a held call that changed nothing (an import that failed to parse) leaves the pause alone', async () => {
    install()
    await flush()
    st().stopSim()
    const failing = whileAutoRunHeld(async () => {
      await Promise.resolve()
      return { ok: false }
    })
    await failing()
    await flush()
    expect(st().running).toBe(false)
    expect(S.simStopReason()).toBe('user')
  })

  it('a debugger halt is never resumed by an edit (F5 / 〔繼續執行〕 do that)', async () => {
    install()
    await flush()
    host().emit({ time: 0.1 })
    host().emit({
      time: 0.12,
      running: false,
      mcus: [{ componentId: 'U1', state: 'halted', firmware: null, pc: 0, hclkHz: 8e6, cycles: 0, realtime: 0, uarts: [] }],
    })
    expect(S.simStopReason()).toBe('debugger')
    const starts = host().count('start')
    st().setParam('R1', 'resistance', 2200)
    await flush()
    expect(st().running).toBe(false)
    expect(host().count('start')).toBe(starts)
  })

  it('a failed start is not retried on the same circuit; the next change of the circuit retries', async () => {
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      if (hosts.length === 0) h.startError = 'worker crashed'
      hosts.push(h)
      return h
    })
    install()
    await flush()
    expect(st().running).toBe(false)
    expect(S.simStopReason()).toBe('failed')
    expect(runStartedByAutoRun()).toBeNull()
    expect(hosts).toHaveLength(1)
    st().setParam('PS1', 'voltage', 3.3) // using the circuit: same circuit, no retry
    await flush()
    expect(hosts).toHaveLength(1)
    st().setParam('R1', 'resistance', 2200) // a new circuit: one fresh try
    await flush()
    expect(hosts).toHaveLength(2)
    expect(st().running).toBe(true)
  })

  it('a host that cannot even be built: one try per change of the circuit, never a retry on the same one', async () => {
    let builds = 0
    S.__setSimHostFactoryForTests(() => {
      builds++
      throw new Error('no Worker')
    })
    install()
    await flush()
    expect(builds).toBe(1)
    expect(S.simStopReason()).toBe('failed')
    st().setParam('R1', 'resistance', 2200) // a new circuit: one fresh try (fails again)
    await flush()
    expect(builds).toBe(2)
    st().setParam('PS1', 'voltage', 3.3) // using the failed circuit: no retry
    await flush()
    expect(builds).toBe(2)
    expect(st().running).toBe(false)
  })

  it('an edit while running never blanks the telemetry, nor does resuming a pause (no 顯示電流 blink)', async () => {
    const seen: (SimTelemetry | null)[] = []
    install()
    await flush()
    host().emit({ time: 0.2 })
    S.setTelemetrySink((t) => seen.push(t))
    seen.length = 0
    st().setParam('R1', 'resistance', 2200)
    await flush()
    host().emit({ time: 0.3 })
    st().stopSim()
    st().addComponent('resistor', { holes: ['a20', 'a24'] })
    await flush()
    expect(st().running).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t !== null)).toBe(true)
    expect(host().count('reset')).toBe(0) // one session throughout
  })

  it('off when not enabled (classic chrome / harness flags): nothing starts', async () => {
    install(undefined, () => false)
    await flush()
    st().addComponent('resistor', { holes: ['a20', 'a24'] })
    await flush()
    expect(hosts).toHaveLength(0)
    expect(st().running).toBe(false)
  })

  it('uninstalling stops it', async () => {
    install()
    stop?.()
    stop = null
    await flush()
    expect(hosts).toHaveLength(0)
    expect(autoRunInstallCount()).toBe(0)
  })
})

describe('auto-run: where it is allowed', () => {
  it('product chrome on a plain page; never in the classic chrome', () => {
    expect(autoRunAllowed('', false)).toBe(true)
    expect(autoRunAllowed('?lang=zh-TW', false)).toBe(true)
    expect(autoRunAllowed('', true)).toBe(false)
    expect(autoRunAllowed('?autorun', true)).toBe(false)
  })

  it('the harness flags turn it off unless &autorun; ?autorun=0 turns it off anywhere', () => {
    for (const flag of ['shotrig', 'perfwin', 'perfrig']) {
      expect(autoRunAllowed(`?${flag}`, false), flag).toBe(false)
      expect(autoRunAllowed(`?e2e&${flag}`, false), flag).toBe(false)
      expect(autoRunAllowed(`?e2e&${flag}&autorun`, false), flag).toBe(true)
    }
    expect(autoRunAllowed('?autorun=0', false)).toBe(false)
    expect(autoRunAllowed('?shotrig&autorun=0', false)).toBe(false)
  })

  it('autoRunEnabled follows the chrome: English without the workspace is the classic chrome', () => {
    __setLangForTests('zh-TW')
    expect(autoRunEnabled()).toBe(true)
    __setLangForTests('en')
    expect(autoRunEnabled()).toBe(false)
  })
})

describe('auto-run: verification fixes (round 5)', () => {
  const rec = (loadedAt: number) => ({
    componentId: 'R1',
    name: 'x.elf',
    format: 'elf' as const,
    sha256: 'cd'.repeat(32),
    size: 1,
    loadedAt,
    warnings: [],
  })
  afterEach(() => useLab.setState({ firmware: {} }))

  it('a lab restore that never settles (a blocked IndexedDB) does not leave auto-run dead: the boot goes ahead after the timeout', async () => {
    install(() => new Promise<void>(() => {}), () => true, 400)
    expect(autoRunWaiting()).toBe(true) // a start is coming
    await flush()
    expect(hosts).toHaveLength(0)
    await sleep(600)
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('boot')
    expect(autoRunWaiting()).toBe(false)
  })

  it('autoRunWaiting: while the boot waits for the lab and while a load holds the gate — never otherwise', async () => {
    let open!: () => void
    install(() => new Promise<void>((r) => (open = r)))
    expect(autoRunWaiting()).toBe(true)
    open()
    await flush()
    expect(autoRunWaiting()).toBe(false)
    st().stopSim()
    const release = holdAutoRun()
    expect(autoRunWaiting()).toBe(true)
    release()
    expect(autoRunWaiting()).toBe(false)
    stop?.()
    stop = null
    holdAutoRun() // nothing installed: nobody is about to start anything
    expect(autoRunWaiting()).toBe(false)
  })

  it('not waiting where auto-run is off (classic chrome / harness flags)', async () => {
    install(() => new Promise<void>(() => {}), () => false)
    expect(autoRunWaiting()).toBe(false)
  })

  it('the same firmware flashed again resumes the learner’s pause (the board was just power-on-reset to run it)', async () => {
    useLab.setState({ firmware: { R1: rec(1) } })
    install()
    await flush()
    st().stopSim()
    useLab.setState({ firmware: { R1: { ...rec(1) } } }) // a record's copy, nothing flashed: stays paused
    await flush()
    expect(st().running).toBe(false)
    useLab.setState({ firmware: { R1: rec(2) } }) // flashed again (same image, a new load)
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('firmware')
  })

  it('the product chrome coming up (a language switch from the classic chrome) starts the circuit on the board', async () => {
    let on = false
    install(undefined, () => on)
    await flush()
    expect(hosts).toHaveLength(0)
    on = true
    useLab.setState({ workspace: { ...useLab.getState().workspace } }) // the chrome inputs changed
    await flush()
    expect(st().running).toBe(true)
    expect(runStartedByAutoRun()?.reason).toBe('chrome')
  })

  it('… but keeps a pause the learner made in the classic chrome', async () => {
    let on = true
    install(undefined, () => on)
    await flush()
    on = false
    useLab.setState({ workspace: { ...useLab.getState().workspace } })
    st().stopSim() // paused in the classic chrome
    await flush()
    on = true
    useLab.setState({ workspace: { ...useLab.getState().workspace } })
    await flush()
    expect(st().running).toBe(false)
    expect(S.simStopReason()).toBe('user')
  })

  it('a lesson step’s 重置模擬 of a running simulation: auto-run restarts it (its run — the floating coach does not fold)', async () => {
    install()
    await flush()
    st().stopSim()
    st().startSim() // the learner's own run
    expect(runStartedByAutoRun()).toBeNull()
    expect(autoRunActive()).toBe(true)
    expect(resetFromStep({ kind: 'reset', scope: 'circuit' }, lessonById('b1-led-resistor')!)).toBe(true)
    await flush()
    expect(st().running).toBe(true)
    expect(st().simTime).toBe(0)
    expect(runStartedByAutoRun()?.reason).toBe('reset')
    expect(runFoldsCoach(true, false)).toBe(false)
    stop?.()
    stop = null
    expect(autoRunActive()).toBe(false)
  })
})
