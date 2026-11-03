/**
 * Round 5 — the seven streams together (integration): what each feature
 * promises still holds when the others run beside it, against the real store,
 * the real inline simulation host and the real watchers:
 *
 *  - auto-run × 換新 / auto-heal: a value change that brings a new part in
 *    neither reloads nor restarts the host, and keeps the learner's own
 *    pause (the toast offers 〔繼續執行〕); 〔換新〕 is not a document edit, so
 *    auto-run decides nothing for it — no restart loop, one insert sound each;
 *  - copy / paste × the sound watcher: a paste (a part AND its rail wires) is
 *    ONE insert, never N clicks or a 「load」; a cut is ONE pull; the paste is
 *    a circuit change, so it resumes a pause (auto-run 'edit');
 *  - drag-to-wire × sound × undo: the drop is ONE wire-in sound and ONE undo
 *    step (the undo is the swish, nothing else);
 *  - the status pill on phones: the learner's pause outranks the 「電路說明」
 *    line, which speaks only when nothing above it does;
 *  - library × lessons: every part a lesson tells the learner to take from
 *    the 元件庫 by name is on the first screen (常用元件).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const played = vi.hoisted(() => [] as { cue: string; opts?: Record<string, unknown> }[])
vi.mock('../src/ui/fx/sound', async (orig) => {
  const real = await orig<typeof import('../src/ui/fx/sound')>()
  return { ...real, playMech: (cue: string, opts?: Record<string, unknown>) => void played.push({ cue, opts }) }
})

import '../src/sim/models'
import { __setLangForTests } from '../src/i18n'
import { partLabel } from '../src/i18n/parts'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import { LESSONS } from '../src/lessons'
import { __resetRunGateForTests } from '../src/state/run-gate'
import * as S from '../src/state/store'
import { startAutoRun } from '../src/ui/chrome/auto-run'
import { __resetClipForTests, copySelectionWithFeedback, cutSelectionWithFeedback, pasteWithFeedback } from '../src/ui/chrome/copy-paste'
import { undoWithFeedback } from '../src/ui/chrome/edit-feedback'
import { statusPillModel, type PillInput } from '../src/ui/chrome/StatusPill'
import { startAutoHeal } from '../src/ui/embedded/auto-heal'
import { useLab } from '../src/ui/embedded/lab'
import { useLatchHolds } from '../src/ui/embedded/latch'
import { replaceDamagedWithFeedback } from '../src/ui/embedded/replace-part'
import { __setCelebrationsSuppressedForTests } from '../src/ui/fx/celebrate'
import { startMechSoundWatch } from '../src/ui/fx/mech-watch'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { COMMON_PARTS } from '../src/ui/workspace/library-order'
import { drawWire } from '../src/ui/workspace/wire-draw'
import { valid } from './erc/helpers'

const st = () => S.useStore.getState()
const heard = () => played.map((p) => p.cue)
const lastToast = () => getToasts()[getToasts().length - 1]
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** auto-run decides on a macrotask (and its ready() resolves first) */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
  { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
]

/** a red LED straight across 5 V: it burns at the first step */
const BURN: CircuitLayout = valid({
  version: 1,
  name: 'burn',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'LED1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } },
  ],
  wires: RAILS,
})

/** 5 V → rails → R1 (1 kΩ) fed by two rail wires */
const BENCH: CircuitLayout = valid({
  version: 1,
  name: 'bench',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['a10', 'a15'], params: { resistance: 1000 } },
  ],
  wires: [...RAILS, { id: 'W3', from: 'top+1', to: 'b10', color: 'red' }, { id: 'W4', from: 'top-1', to: 'b15', color: 'black' }],
})

/** the real inline host on a manual scheduler (frames only from stepSimTime), its calls counted */
const calls = { load: 0, start: 0, repair: [] as (readonly string[] | null)[] }
let stops: (() => void)[] = []

function useInlineHost(): void {
  S.__setSimHostFactoryForTests((cb: SimHostCallbacks) => {
    const h = new InlineSimHost(cb, { scheduler: { request: () => 0, cancel: () => {} }, clock: () => 0 })
    const load = h.load.bind(h)
    const start = h.start.bind(h)
    const repair = h.repairParts.bind(h)
    ;(h as SimHost).load = (layout, rev) => {
      calls.load++
      load(layout, rev)
    }
    ;(h as SimHost).start = (speed) => {
      calls.start++
      start(speed)
    }
    ;(h as SimHost).repairParts = (ids) => {
      calls.repair.push(ids)
      repair(ids)
    }
    return h
  })
}

function openCircuit(layout: CircuitLayout): void {
  st().resetSim()
  S.__resetHistoryForTests()
  S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, hoverHole: null, canUndo: false, canRedo: false, issues: [] })
}

/** auto-run (enabled, the lab ready at once), the automatic 換新 (short quiet time) and the sound watcher */
async function bootProductChrome(layout: CircuitLayout, healMs = 20): Promise<void> {
  openCircuit(layout)
  stops.push(startAutoRun({ ready: () => Promise.resolve(), enabled: () => true }))
  stops.push(startAutoHeal({ delayMs: healMs }))
  stops.push(startMechSoundWatch())
  await flush()
  played.length = 0
  calls.load = 0
  calls.start = 0
  calls.repair = []
}

beforeEach(() => {
  __setLangForTests('zh-TW')
  __setCelebrationsSuppressedForTests(null)
  __resetRunGateForTests()
  __resetClipForTests()
  useLab.setState({ mcus: {} })
  useLatchHolds.setState({ held: [] })
  for (const t of getToasts()) dismissToast(t.id)
  played.length = 0
  useInlineHost()
})

afterEach(() => {
  for (const s of stops.reverse()) s()
  stops = []
  openCircuit({ version: 1, components: [], wires: [] })
  S.__setSimHostFactoryForTests(null)
  __resetRunGateForTests()
  __setCelebrationsSuppressedForTests(null)
})

describe('auto-run × 換新 (the automatic one and the button)', () => {
  it('a supply turned down while paused: ONE new LED, no reload, no restart, the pause kept and offered back', async () => {
    await bootProductChrome(BURN)
    expect(st().running).toBe(true) // the opened circuit runs by itself
    st().stopSim() // the learner pauses
    S.stepSimTime(0.01)
    expect(st().telemetry?.components.LED1?.burned).toBe(true)
    played.length = 0

    st().setParam('PS1', 'voltage', 0) // a value, not a structural edit
    await flush()
    expect(st().running).toBe(false) // using the circuit keeps the learner's pause
    await sleep(60)
    expect(calls.repair).toEqual([['LED1']]) // one turn of the knob, one 換新
    expect(calls.load).toBe(0) // no rebuild
    expect(calls.start).toBe(0) // no restart (no loop)
    expect(heard().filter((c) => c === 'insert')).toHaveLength(1) // the new part goes in once
    const toast = lastToast()
    expect(toast?.text).toBe('已自動換上新的 LED1——模擬已暫停')
    expect(toast?.action?.label).toBe('繼續執行')

    S.stepSimTime(0.01)
    expect(st().telemetry?.components.LED1?.burned).not.toBe(true) // 0 V: the new LED lives
    toast!.action!.run()
    expect(st().running).toBe(true)
    await flush()
    expect(calls.start).toBe(1) // the resume, once — auto-run adds nothing
  })

  it('〔換新〕 is not a document edit: auto-run decides nothing, the host is not reloaded, one insert sound', async () => {
    await bootProductChrome(BURN)
    st().stopSim()
    S.stepSimTime(0.01)
    played.length = 0
    const layout = st().layout
    expect(replaceDamagedWithFeedback('LED1')).toBe(true)
    await flush()
    expect(st().layout).toBe(layout)
    expect(calls.repair).toEqual([['LED1']])
    expect(calls.load).toBe(0)
    expect(calls.start).toBe(0)
    expect(st().running).toBe(false)
    expect(played).toEqual([{ cue: 'insert', opts: { count: 2 } }])
    // nothing pending: the automatic 換新 has no turn to end
    await sleep(60)
    expect(calls.repair).toHaveLength(1)
  })
})

describe('copy / paste × the sound watcher × auto-run', () => {
  it('a paste of a part with its rail wires is ONE insert (not N clicks, not a load) and resumes the pause', async () => {
    await bootProductChrome(BENCH)
    expect(st().running).toBe(true)
    st().stopSim()
    st().select('R1')
    expect(copySelectionWithFeedback()).toBe(true)
    const loads = S.layoutLoadCount()
    const before = st().layout
    expect(pasteWithFeedback()).toBe(true)
    const after = st().layout
    expect(after.components.length).toBe(before.components.length + 1)
    expect(after.wires.length).toBe(before.wires.length + 2) // the copy's own rail feeds came along
    expect(S.layoutLoadCount()).toBe(loads) // not a load: the history and auto-run see an edit
    expect(heard()).toEqual(['insert'])
    expect(played[0].opts?.count).toBe(2) // the resistor's two leads
    await flush()
    expect(st().running).toBe(true) // a circuit change resumes the learner's pause
    expect(calls.load).toBe(1) // heal-on-edit: the paste reached the host
    played.length = 0
    undoWithFeedback()
    expect(st().layout.components.map((c) => c.id)).toEqual(before.components.map((c) => c.id))
    expect(heard()).toEqual(['undo']) // one swish, not a pull
  })

  it('a cut is ONE pull, and the paste after it ONE insert', async () => {
    await bootProductChrome(BENCH)
    st().select('R1')
    expect(cutSelectionWithFeedback()).toBe(true)
    expect(st().layout.components.map((c) => c.id)).toEqual(['PS1'])
    expect(heard()).toEqual(['pull'])
    played.length = 0
    expect(pasteWithFeedback()).toBe(true)
    expect(heard()).toEqual(['insert'])
    await flush()
    expect(st().running).toBe(true)
  })
})

describe('drag-to-wire × sound × undo × auto-run', () => {
  it('a drop is ONE wire-in and ONE undo step; it resumes a pause; the undo is the swish', async () => {
    await bootProductChrome(BENCH)
    st().stopSim()
    const before = st().layout
    drawWire('c20', 'top+5') // a free strip fed from the + rail
    expect(st().layout.wires.length).toBe(before.wires.length + 1)
    expect(st().selection).toEqual([]) // the new wire is not selected
    expect(heard()).toEqual(['wire-in'])
    expect(lastToast()?.action?.label).toBe('復原')
    await flush()
    expect(st().running).toBe(true)
    played.length = 0
    undoWithFeedback()
    expect(st().layout.wires).toEqual(before.wires)
    expect(st().canUndo).toBe(false) // exactly one step
    expect(heard()).toEqual(['undo'])
  })

  it('a drop back on its own start (or nowhere) changes nothing and says nothing', async () => {
    await bootProductChrome(BENCH)
    const layout = st().layout
    drawWire('a15', null)
    drawWire('a15', 'a15')
    expect(st().layout).toBe(layout)
    expect(heard()).toEqual([])
  })
})

describe('the phone pill: the learner’s pause above 「電路說明」', () => {
  const base: PillInput = {
    problems: [],
    counts: { error: 0, warning: 0, info: 0 },
    phase: 'running',
    haltedId: null,
    boardEmpty: false,
    explain: { text: 'LED1 亮著：49 %（9.70 mA）', detail: 'LED1 亮著：49 %（9.70 mA）\n由 5.00 V 經 R1 330 Ω 供電' },
  }
  it('running: the explanation speaks; paused by the learner: the pause line with 〔繼續執行〕', () => {
    expect(statusPillModel(base)?.tone).toBe('explain')
    const paused = statusPillModel({ ...base, phase: 'paused', userPaused: true })
    expect(paused?.tone).toBe('paused')
    expect(paused?.text).toBe('模擬已暫停——改動接線或元件就會自動繼續')
    expect(paused?.action?.label).toBe('繼續執行')
    // a stop that is not the learner's (auto-run off, a reset) leaves the line to the explanation
    expect(statusPillModel({ ...base, phase: 'paused', userPaused: false })?.tone).toBe('explain')
  })
})

describe('library × lessons', () => {
  it('every part a lesson says to take from the 元件庫 by name is one of the 常用元件 (the first screen)', () => {
    const common = new Map(COMMON_PARTS.map((type) => [partLabel(getEntry(type)!), type]))
    const named = new Set<string>()
    for (const lesson of LESSONS) {
      const text = JSON.stringify(lesson)
      for (const m of text.matchAll(/在「元件庫」點一下「([^」]+(?:（[^）]*）)?)」/g)) named.add(m[1])
    }
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) expect(common.has(name), `「${name}」 is not among the 常用元件`).toBe(true)
  })
})
