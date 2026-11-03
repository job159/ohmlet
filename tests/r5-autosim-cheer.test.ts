/**
 * Auto-run and the cheer (round 5): a circuit auto-run started on OPENING it
 * — the app's restored board ('boot'), an example / a lesson circuit / a
 * project ('load') — never cheers 「電路正常運作」: the learner did not build
 * it. A user edit that newly makes something work does cheer, once. What
 * the opened circuit does counts as done (cleanSeen) — it is not marked as
 * cheered: once the learner USES it (a switch, a button, a knob, the
 * supply) what newly works cheers as before auto-run (verification fix).
 * Real engine, real problems list, real stores (the cheer-watch.test.ts rig).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { SimEngine } from '../src/sim/engine'
import { useStore } from '../src/state/store'
import { __resetRunGateForTests, noteAutoStart, type AutoRunReason } from '../src/state/run-gate'
import { useLab } from '../src/ui/embedded/lab'
import { useLatchHolds } from '../src/ui/embedded/latch'
import { __resetProblemsForTests, recomputeProblems } from '../src/ui/embedded/problems'
import { __resetCelebrationForTests, useCelebration } from '../src/ui/fx/celebrate'
import { CheerJudge, circuitRevision, startSuccessWatch, valuesChanged, type Activity } from '../src/ui/fx/success-watch'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { valid } from './erc/helpers'

const PS = (v: number) => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]

let stop: (() => void) | null = null

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetCelebrationForTests()
  __resetProblemsForTests()
  __resetRunGateForTests()
  for (const x of getToasts()) dismissToast(x.id)
  useLab.setState({ firmware: {}, mcus: {} })
})
afterEach(() => {
  stop?.()
  stop = null
  useLatchHolds.setState({ held: [] })
  __resetProblemsForTests()
  __resetRunGateForTests()
  useStore.setState({ running: false, simTime: 0, telemetry: null, issues: [] })
})

/** Run `engine` for `seconds`, pushing 10 Hz snapshots into the store (cheer-watch.test.ts's feed). */
function feed(engine: SimEngine, layout: CircuitLayout, seconds: number, offset = 0): void {
  useStore.setState({ layout, running: true })
  let nextProblems = 0
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    engine.advance(0.1, 1e-3)
    const raw = engine.telemetry()
    useStore.setState({ telemetry: { ...raw, time: raw.time + offset }, simTime: raw.time + offset, issues: raw.issues })
    if (raw.time >= nextProblems) {
      recomputeProblems()
      nextProblems += 1
    }
  }
}

/** auto-run's record for a run it started on `layout` (as decide() notes it). */
function autoStarted(reason: AutoRunReason, layout: CircuitLayout): void {
  noteAutoStart({ reason, layout, rev: circuitRevision(layout, useLab.getState().firmware) })
}

const okToasts = () => getToasts().filter((x) => x.text.startsWith('電路正常運作'))
const okCount = () => useCelebration.getState().count['circuit-ok']

const oneLed = (v = 5): CircuitLayout =>
  valid({
    version: 1,
    components: [PS(v), { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } }, { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } }],
    wires: RAILS,
  })
const twoLeds = (): CircuitLayout =>
  valid({
    ...oneLed(),
    components: [
      ...oneLed().components,
      { id: 'R2', type: 'resistor', holes: ['top+8', 'a16'], params: { resistance: 330 } },
      { id: 'LED2', type: 'led', holes: ['b16', 'top-9'], params: { color: 'green' } },
    ],
  })

describe('cheer: what auto-run opened is not the learner’s doing', () => {
  it('an opened circuit (auto-run "load") that works does not cheer; a user edit that newly lights LED2 does, once', () => {
    stop = startSuccessWatch()
    const opened = oneLed()
    autoStarted('load', opened)
    feed(new SimEngine(opened), opened, 3)
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)

    const edited = twoLeds() // the learner adds LED2 — auto-run resumes for the edit
    autoStarted('edit', edited)
    feed(new SimEngine(edited), edited, 3, 3)
    expect(okCount()).toBe(1)
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED2 亮了'])
  })

  it('the app’s restored board (auto-run "boot") does not cheer either; a run auto-run started for an edit does', () => {
    stop = startSuccessWatch()
    const restored = oneLed()
    autoStarted('boot', restored)
    feed(new SimEngine(restored), restored, 3)
    expect(okCount()).toBe(0)

    __resetCelebrationForTests()
    const built = twoLeds()
    autoStarted('edit', built)
    feed(new SimEngine(built), built, 3, 3)
    expect(okCount()).toBe(1)
  })

  it('using an opened circuit (a runtime value: the supply raised 0 → 5 V) and LED1 newly lights: it cheers', () => {
    stop = startSuccessWatch()
    const off = oneLed(0)
    const on = oneLed(5)
    expect(circuitRevision(on)).toBe(circuitRevision(off)) // the supply voltage is a runtime value
    autoStarted('load', off)
    feed(new SimEngine(off), off, 3)
    expect(okCount()).toBe(0) // the opened circuit does nothing yet
    feed(new SimEngine(on), on, 4, 3) // the learner turns the supply up
    expect(okCount()).toBe(1)
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED1 亮了'])
  })

  it('using an opened circuit that already worked cheers nothing: what it did by itself counts as done', () => {
    stop = startSuccessWatch()
    const opened = oneLed(5)
    autoStarted('load', opened)
    feed(new SimEngine(opened), opened, 3)
    const used = oneLed(4.5) // the learner turns the supply down a little: LED1 stays lit
    feed(new SimEngine(used), used, 3, 3)
    expect(okCount()).toBe(0)
  })

  it('a language switch that brought the product chrome up over the board ("chrome") is quiet like an opening', () => {
    stop = startSuccessWatch()
    const there = oneLed()
    autoStarted('chrome', there)
    feed(new SimEngine(there), there, 3)
    expect(okCount()).toBe(0)
  })

  it('a run the learner started on a circuit they built still cheers (the rule before auto-run)', () => {
    stop = startSuccessWatch()
    const built = oneLed()
    noteAutoStart(null)
    feed(new SimEngine(built), built, 3)
    expect(okCount()).toBe(1)
  })
})

describe('cheer: CheerJudge.quiet', () => {
  const act = (...ids: string[]): Activity => ({
    componentIds: ids,
    phrases: ids.map((id) => `${id} 亮了`),
    items: ids.map((id) => ({ key: `${id}:lit`, id, phrase: `${id} 亮了` })),
  })

  it('a quiet revision never cheers, and what it did counts as done after a change', () => {
    const j = new CheerJudge()
    j.quiet('A')
    const steps = (rev: string, t0: number, t1: number, a: Activity) => {
      const out: unknown[] = []
      for (let t = t0; t <= t1 + 1e-9; t += 0.1) {
        const d = j.step({ rev, time: +t.toFixed(3), activity: a, damaged: false }, [], () => [], (ids) => new Set(ids))
        if (d) out.push(d)
      }
      return out
    }
    expect(steps('A', 0, 3, act('LED1'))).toEqual([])
    expect(steps('B', 3.1, 6, act('LED1'))).toEqual([]) // LED1 already worked: nothing new
    expect(steps('C', 6.1, 9, act('LED1', 'LED2'))).toEqual([{ componentIds: ['LED2'], message: 'LED2 亮了' }])
  })

  const run = (j: CheerJudge, rev: string, t0: number, t1: number, a: Activity) => {
    const out: unknown[] = []
    for (let t = t0; t <= t1 + 1e-9; t += 0.1) {
      const d = j.step({ rev, time: +t.toFixed(3), activity: a, damaged: false }, [], () => [], (ids) => new Set(ids))
      if (d) out.push(d)
    }
    return out
  }

  it('quiet seeds what the opened revision does; after wake what NEWLY works on the same revision cheers', () => {
    const j = new CheerJudge()
    j.quiet('A')
    expect(run(j, 'A', 0, 3, act('LED1'))).toEqual([])
    expect(j.quietNow).toBe(true)
    j.wake() // the learner flips a switch
    expect(j.quietNow).toBe(false)
    expect(run(j, 'A', 3.1, 6, act('LED1', 'LED2'))).toEqual([{ componentIds: ['LED2'], message: 'LED2 亮了' }])
  })

  it('wake inside the opened circuit’s first window: what it already did counts as done (never cheered later)', () => {
    const j = new CheerJudge()
    j.quiet('A')
    expect(run(j, 'A', 0, 0.5, act('LED1'))).toEqual([]) // its window has not finished yet
    j.wake()
    expect(run(j, 'A', 0.6, 4, act('LED1'))).toEqual([])
    expect(run(j, 'A', 4.1, 7, act('LED1', 'LED2'))).toEqual([{ componentIds: ['LED2'], message: 'LED2 亮了' }])
  })

  it('a power cycle (reset) of the opened circuit is quiet again, even after it was used', () => {
    const j = new CheerJudge()
    j.quiet('A')
    expect(run(j, 'A', 0, 3, act('LED1'))).toEqual([])
    j.wake()
    j.reset()
    expect(j.quietNow).toBe(true)
    expect(run(j, 'A', 0, 3, act('LED1'))).toEqual([])
  })

  it('wake does nothing to a circuit that was not opened (the rules before auto-run stand)', () => {
    const j = new CheerJudge()
    expect(run(j, 'A', 0, 0.5, act('LED1'))).toEqual([])
    j.wake()
    expect(run(j, 'A', 0.6, 3, act('LED1'))).toEqual([{ componentIds: ['LED1'], message: 'LED1 亮了' }])
  })

  it('using the circuit = a part’s value changed; an instrument moved is not', () => {
    const a = oneLed(5)
    expect(valuesChanged(a, a)).toBe(false)
    const moved: CircuitLayout = { ...a, components: a.components.map((c) => (c.id === 'PS1' ? { ...c, pos: { x: -20, z: 30 } } : c)) }
    expect(valuesChanged(a, moved)).toBe(false)
    const turned: CircuitLayout = { ...a, components: a.components.map((c) => (c.id === 'PS1' ? { ...c, params: { voltage: 3.3 } } : c)) }
    expect(valuesChanged(a, turned)).toBe(true)
  })
})
