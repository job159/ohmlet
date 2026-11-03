/**
 * Round 5 — damage: 〔換新〕, a destroyed part replaced by a new one in ONE
 * click, in place (no edit, no rebuild, no 重置模擬, its params kept).
 *
 *  - sim core: SimEngine.repairParts / AnalogDevice.repair for the LED, the
 *    resistor burned open, the vented electrolytic and the RGB LED's dies —
 *    the damage and its issue go, the part works again once the cause is
 *    gone (a runtime value changed), and burns AGAIN, honestly, with a new
 *    issue, when the cause is still there; per part; an intact or unknown
 *    part changes nothing (the solution stays identical);
 *  - the coordinator logs 「D1 已換上新的」 and the re-burn's own line; the
 *    inline host and the worker runtime publish a frame at once (a paused
 *    view updates), the worker host posts the command;
 *  - UI: the Problems row of a burned / vented part carries 〔換新〕 (a vented
 *    one 〔對調兩腳〕 first), a board's on-board LED is one row whose 〔換新〕
 *    replaces the board's LED; the inspector banner offers the button on a
 *    destroyed part only, once (not when the card above already does), and
 *    its copy says how the part comes back; classic chrome: none of it;
 *  - the 3D smoke trail stops when the damage clears.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import { SimWorkerRuntime, WorkerSimHost, type MainToWorker, type WorkerToMain } from '../src/sim/coordinator/worker-host'
import type { SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { __resetHistoryForTests, __setSimHostFactoryForTests, getSimHost, stepSimTime, useStore } from '../src/state/store'
import { SceneFx, type SceneFxHost } from '../src/three/internal/fx/scene-fx'
import { DamageBanner, cardShowsOwnDamageRow, damageText } from '../src/ui/embedded/DamageBanner'
import { useLab } from '../src/ui/embedded/lab'
import { deriveProblems, useProblems, type Problem, type ProblemsInput } from '../src/ui/embedded/problems'
import { isReplaceable, replaceDamagedWithFeedback, replaceTargetOf, replaceableParts } from '../src/ui/embedded/replace-part'
import { getToasts } from '../src/ui/kit/toasts'
import { useLessonUi } from '../src/ui/lessons/state'
import { BP, bluePill, valid } from './erc/helpers'

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __resetHistoryForTests?.()
})
afterEach(() => {
  __setLangForTests('zh-TW')
  __setSimHostFactoryForTests(null)
  vi.unstubAllGlobals()
  useStore.setState({ selection: [], telemetry: null, running: false })
  useProblems.setState({ problems: [] })
})

const PS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
/** a red LED behind 47 Ω: ≈ 210 mA at 12 V (burns at once), ≈ 25 mA at 3 V (lights) */
const ledBehind47: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 12 } },
    { id: 'R1', type: 'resistor', holes: ['top+5', 'a10'], params: { resistance: 47 } },
    { id: 'D1', type: 'led', holes: ['b10', 'top-11'], params: { color: 'red' } },
  ],
  wires: PS,
} as CircuitLayout)
/** two red LEDs straight across 5 V: both burn */
const twoLedsAcross5V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'D1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } },
    { id: 'D2', type: 'led', holes: ['top+20', 'top-21'], params: { color: 'red' } },
  ],
  wires: PS,
} as CircuitLayout)
const ledAcross5V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'LED1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } },
  ],
  wires: PS,
} as CircuitLayout)
const resistorOn12V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 12 } },
    { id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } },
  ],
  wires: PS,
} as CircuitLayout)
const reversedCap: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'C1', type: 'capacitor', holes: ['top-6', 'top+6'], params: { capacitance: 1e-4, polarized: true } },
  ],
  wires: PS,
} as CircuitLayout)
const rgbRedBurned: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    // pins [R, COM, G, B]: red through 10 Ω (≈ 300 mA — burns in a millisecond), green through 150 Ω
    { id: 'D1', type: 'rgb_led', holes: ['f6', 'f7', 'f8', 'f9'], params: { common: 'cathode' } },
    { id: 'R1', type: 'resistor', holes: ['bot+6', 'j6'], params: { resistance: 10 } },
    { id: 'R2', type: 'resistor', holes: ['bot+8', 'j8'], params: { resistance: 150 } },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'bot+0' },
    { id: 'w2', from: 'PS1:-', to: 'bot-0' },
    { id: 'w3', from: 'h7', to: 'bot-7' },
  ],
} as CircuitLayout)

const messages = (e: SimEngine): string[] => e.issues.map((i) => i.message)

// ------------------------------------------------------------------ sim core
describe('SimEngine.repairParts — 換新 in place', () => {
  it('a burned LED: a new one at once (issue retracted); with the supply turned down it lights', () => {
    const e = new SimEngine(ledBehind47)
    e.advance(0.01, 1e-4)
    expect(e.telemetry().components.D1.burned).toBe(true)
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(true)
    // turning the supply down does not bring a burned LED back by itself (a real one stays burned)
    e.setRuntimeParam('PS1', 'voltage', 3)
    e.advance(0.01, 1e-4)
    expect(e.telemetry().components.D1.burned).toBe(true)
    // 換新
    expect(e.repairParts(['D1'])).toEqual(['D1'])
    const fresh = e.telemetry().components.D1
    expect(fresh.burned).toBe(false)
    expect(fresh.damage).toBeUndefined()
    expect(fresh.light).toBe(0) // not simulated yet: dark, never a stale reading
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(false)
    // the params are the part's own (47 Ω, red) — nothing was rebuilt
    e.advance(0.03, 1e-4)
    const lit = e.telemetry().components.D1
    expect(lit.burned).toBe(false)
    expect(lit.light!).toBeGreaterThan(0.8) // ≈ 25 mA / 20 mA
    expect(lit.current!).toBeGreaterThan(0.015)
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(false)
  })

  it('the cause still there: the new LED burns again — a NEW issue, a new `since`', () => {
    const e = new SimEngine(ledAcross5V)
    e.advance(0.01, 1e-4)
    const first = e.issues.find((i) => /^LED LED1 burned out/.test(i.message))!
    const since1 = e.telemetry().components.LED1.damage!.since
    expect(first).toBeDefined()
    e.repairParts(['LED1'])
    e.advance(0.01, 1e-4)
    const again = e.telemetry().components.LED1
    expect(again.burned).toBe(true)
    expect(again.damage!.since).toBeGreaterThan(since1)
    const now = e.issues.filter((i) => /^LED LED1 burned out/.test(i.message))
    expect(now).toHaveLength(1) // one standing issue …
    expect(now[0]).not.toBe(first) // … a new event
  })

  it('per part: replacing D1 leaves D2 burned (its issue too)', () => {
    const e = new SimEngine(twoLedsAcross5V)
    e.advance(0.01, 1e-4)
    expect(e.repairParts(['D1'])).toEqual(['D1'])
    const t = e.telemetry().components
    expect(t.D1.burned).toBe(false)
    expect(t.D2.burned).toBe(true)
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(false)
    expect(messages(e).some((m) => /^LED D2 burned out/.test(m))).toBe(true)
    // null = every damaged part
    expect(e.repairParts(null)).toEqual(['D2'])
    expect(e.telemetry().components.D2.burned).toBe(false)
  })

  it('an intact or unknown part: [] and the solution stays identical', () => {
    const a = new SimEngine(ledBehind47)
    const b = new SimEngine(ledBehind47)
    a.setRuntimeParam('PS1', 'voltage', 3)
    b.setRuntimeParam('PS1', 'voltage', 3)
    a.advance(0.005, 1e-4)
    b.advance(0.005, 1e-4)
    expect(b.repairParts(['D1', 'R1', 'PS1', 'NOPE'])).toEqual([])
    expect(b.repairParts(null)).toEqual([])
    a.advance(0.005, 1e-4)
    b.advance(0.005, 1e-4)
    expect(JSON.stringify(b.telemetry())).toBe(JSON.stringify(a.telemetry()))
  })

  it('a resistor burned open: a new one conducts again once the supply is lowered', () => {
    const e = new SimEngine(resistorOn12V)
    e.advance(2.5, 1e-3)
    expect(e.telemetry().components.R2.damage?.kind).toBe('burned')
    expect(messages(e).some((m) => /^R2 burned open \(/.test(m))).toBe(true)
    e.setRuntimeParam('PS1', 'voltage', 1)
    expect(e.repairParts(['R2'])).toEqual(['R2'])
    expect(e.telemetry().components.R2.damage).toBeUndefined()
    expect(messages(e).some((m) => /^R2 burned open \(/.test(m))).toBe(false)
    e.advance(0.5, 1e-3)
    const r2 = e.telemetry().components.R2
    expect(r2.damage).toBeUndefined()
    expect(Math.abs(r2.current!)).toBeCloseTo(0.1, 3) // 1 V / 10 Ω: it conducts
    expect(r2.heat).toBeUndefined() // a new part, cold (0.1 W in ¼ W, a fraction of its rise)
  })

  it('a vented electrolytic: a new one keeps the voltage (no charging spike) and vents again while still reversed', () => {
    const e = new SimEngine(reversedCap)
    e.advance(1.5, 1e-3)
    expect(e.telemetry().components.C1.damage?.kind).toBe('vented')
    const first = e.issues.find((i) => /^C1 vented: /.test(i.message))!
    expect(first).toBeDefined()
    expect(e.repairParts(['C1'])).toEqual(['C1'])
    expect(e.telemetry().components.C1.damage).toBeUndefined()
    expect(e.issues.includes(first)).toBe(false)
    e.step(1e-3)
    // vPrev kept: still −5 V across it, so no C/dt · 5 V = 0.5 A step
    expect(Math.abs(e.telemetry().components.C1.current!)).toBeLessThan(1e-3)
    e.advance(1.5, 1e-3)
    expect(e.telemetry().components.C1.damage?.kind).toBe('vented')
    const again = e.issues.filter((i) => /^C1 vented: /.test(i.message))
    expect(again).toHaveLength(1)
    expect(again[0]).not.toBe(first)
  })

  it('an RGB LED: the burned die is new (red lights once the current is sane); the intact dies carry on', () => {
    const e = new SimEngine(rgbRedBurned)
    e.advance(0.05, 1e-4)
    const before = e.telemetry().components.D1
    expect(before.burned).toBe(true)
    expect(before.values?.burnedR).toBe(1)
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(true)
    expect(e.repairParts(['D1'])).toEqual(['D1'])
    const after = e.telemetry().components.D1
    expect(after.burned).toBe(false)
    expect(after.damage).toBeUndefined()
    expect(after.values?.burnedR).toBeUndefined()
    // the green die was intact: its reading does not blink
    expect(after.values?.iG).toBe(before.values?.iG)
    expect(after.leds?.G).toBe(before.leds?.G)
    expect(messages(e).some((m) => /^LED D1 burned out/.test(m))).toBe(false)
    // ≈ 50 mA through the red die at 2.5 V: lit, never burned
    e.setRuntimeParam('PS1', 'voltage', 2.5)
    e.advance(0.05, 1e-4)
    const lit = e.telemetry().components.D1
    expect(lit.burned).toBe(false)
    expect(lit.leds?.R).toBeGreaterThan(0.5)
  })
})

// --------------------------------------------------------- coordinator + hosts
describe('SimulationCoordinator / hosts', () => {
  it('logs 「D1 已換上新的」 per part it replaced, and the re-burn gets its own line', () => {
    const co = new SimulationCoordinator()
    co.load(ledAcross5V, 1)
    co.advance(0.01)
    const f1 = co.frame()
    expect(f1.log.filter((l) => /^LED LED1 burned out/.test(l.message))).toHaveLength(1)
    expect(co.repairParts(['LED1', 'PS1'])).toEqual(['LED1'])
    const f2 = co.frame()
    expect(f2.telemetry.components.LED1.damage).toBeUndefined()
    const line = f2.log.find((l) => l.message === 'LED1 replaced with a new part')!
    expect(line).toBeDefined()
    expect(line.level).toBe('info')
    expect(line.componentId).toBe('LED1')
    expect(tMessage(line.message)).toBe('LED1 已換上新的')
    expect(f2.issues.some((i) => /^LED LED1 burned out/.test(i.message))).toBe(false)
    co.advance(0.01)
    const f3 = co.frame()
    expect(f3.log.filter((l) => /^LED LED1 burned out/.test(l.message))).toHaveLength(1)
    // nothing damaged: nothing replaced, nothing logged
    co.load(ledBehind47, 2)
    co.setRuntimeParam('PS1', 'voltage', 3)
    co.advance(0.01)
    co.frame()
    expect(co.repairParts(null)).toEqual([])
    expect(co.frame().log.some((l) => /replaced with a new part/.test(l.message))).toBe(false)
    co.dispose?.()
  })

  it('InlineSimHost publishes a frame at once (a paused view shows the new part)', () => {
    const frames: SimFrame[] = []
    const host = new InlineSimHost({ onFrame: (f) => frames.push(f) }, { scheduler: { request: () => 0, cancel: () => {} }, clock: () => 0 })
    host.load(ledAcross5V, 1)
    host.stepTime(0.01)
    expect(frames[frames.length - 1].telemetry.components.LED1.burned).toBe(true)
    const n = frames.length
    host.repairParts(['LED1'])
    expect(frames.length).toBe(n + 1)
    expect(frames[n].telemetry.components.LED1.burned).toBe(false)
    host.dispose()
  })

  it('SimWorkerRuntime: { type: "repair" } replaces and posts a frame', () => {
    const posted: WorkerToMain[] = []
    const rt = new SimWorkerRuntime({
      post: (m) => posted.push(m),
      clock: () => 0,
      setTimer: () => 0,
      clearTimer: () => {},
      yieldNow: () => {},
    })
    rt.handle({ type: 'load', layout: ledAcross5V, rev: 1 })
    rt.handle({ type: 'step', seconds: 0.01 })
    const last = (): SimFrame => (posted.filter((m) => m.type === 'frame').pop() as { frame: SimFrame }).frame
    expect(last().telemetry.components.LED1.burned).toBe(true)
    const n = posted.length
    rt.handle({ type: 'repair', ids: ['LED1'] })
    expect(posted.length).toBe(n + 1)
    expect(last().telemetry.components.LED1.burned).toBe(false)
    // null = every damaged part
    rt.handle({ type: 'step', seconds: 0.01 })
    expect(last().telemetry.components.LED1.burned).toBe(true)
    rt.handle({ type: 'repair', ids: null })
    expect(last().telemetry.components.LED1.burned).toBe(false)
    rt.handle({ type: 'dispose' })
  })

  it('WorkerSimHost posts the command (a copy of the ids)', () => {
    const sent: MainToWorker[] = []
    class FakeWorker {
      onmessage: unknown = null
      onerror: unknown = null
      onmessageerror: unknown = null
      postMessage(m: MainToWorker): void {
        sent.push(m)
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const host = new WorkerSimHost({ onFrame: () => {} })
    const ids = ['D1']
    host.repairParts(ids)
    host.repairParts(null)
    expect(sent).toEqual([
      { type: 'repair', ids: ['D1'] },
      { type: 'repair', ids: null },
    ])
    expect((sent[0] as { ids: string[] }).ids).not.toBe(ids)
    host.dispose()
  })
})

// ------------------------------------------------------------- replace-part
function run(layout: CircuitLayout, seconds: number, dt = 1e-3): SimTelemetry {
  const e = new SimEngine(layout)
  e.advance(seconds, dt)
  return e.telemetry()
}
const problemsOf = (layout: CircuitLayout, telemetry: SimTelemetry, issues = telemetry.issues) =>
  deriveProblems({
    layout,
    findings: runErc(layout, { telemetry, issues }),
    issues,
    firmware: {},
    mcus: {},
    running: true,
    simTime: telemetry.time,
  } as ProblemsInput)

/** A host that records repairParts (the store's peekSimHost returns it once created). */
function installHost(): { repaired: (readonly string[] | null)[] } {
  const rec = { repaired: [] as (readonly string[] | null)[] }
  __setSimHostFactoryForTests((cb: SimHostCallbacks) => {
    const h = new InlineSimHost(cb, { scheduler: { request: () => 0, cancel: () => {} }, clock: () => 0 })
    const repair = h.repairParts.bind(h)
    ;(h as SimHost).repairParts = (ids) => {
      rec.repaired.push(ids)
      repair(ids)
    }
    return h
  })
  getSimHost()
  return rec
}

describe('replace-part', () => {
  it('isReplaceable: latched damage only (burned, vented, an on-board LED) — overheating cools by itself', () => {
    expect(isReplaceable(run(ledAcross5V, 0.02).components.LED1)).toBe(true)
    expect(isReplaceable(run(reversedCap, 1.5).components.C1)).toBe(true)
    expect(isReplaceable(run(resistorOn12V, 2.5).components.R2)).toBe(true)
    expect(isReplaceable(run(resistorOn12V, 1).components.R2)).toBe(false) // overheating
    expect(isReplaceable({ pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, burned: true } } })).toBe(true)
    expect(isReplaceable({ pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, burned: false } } })).toBe(false)
    expect(isReplaceable(undefined)).toBe(false)
    expect(replaceableParts(run(twoLedsAcross5V, 0.02))).toEqual(['D1', 'D2'])
    expect(replaceableParts(null)).toEqual([])
  })

  it('replaceTargetOf: the part of a burned / vented fact; a board’s on-board LED → its board', () => {
    expect(replaceTargetOf('burned:LED1')).toBe('LED1')
    expect(replaceTargetOf('vented:C1')).toBe('C1')
    expect(replaceTargetOf('burned:U1.LED_PC13')).toBe('U1')
    expect(replaceTargetOf('reversed:C1')).toBeNull()
    expect(replaceTargetOf('overcurrent:U1:PA5')).toBeNull()
    expect(replaceTargetOf(undefined)).toBeNull()
  })

  it('replaceDamagedWithFeedback: the host replaces it, 「已換上新的 LED1」 (no 〔復原〕: not an edit)', () => {
    expect(replaceDamagedWithFeedback('LED1')).toBe(false) // no simulation: nothing to replace in
    const rec = installHost()
    useStore.setState({ telemetry: run(ledAcross5V, 0.02), running: true }) // the readings show LED1 burned, the sim runs
    const toasts = getToasts().length
    expect(replaceDamagedWithFeedback('LED1')).toBe(true)
    expect(rec.repaired).toEqual([['LED1']])
    const toast = getToasts()[getToasts().length - 1]
    expect(getToasts().length).toBeGreaterThanOrEqual(Math.min(toasts + 1, 2))
    expect(toast.text).toBe('已換上新的 LED1')
    expect(toast.action).toBeUndefined()
    // nothing went into the undo history
    expect(useStore.getState().canUndo).toBe(false)
  })
})

// ------------------------------------------------------------------ Problems
describe('Problems: 〔換新〕 on the rows of destroyed parts', () => {
  it('a burned LED / resistor: the row’s one-click action is 〔換新〕 — it replaces that part', () => {
    const rec = installHost()
    const tele = run(ledAcross5V, 0.02)
    const led = problemsOf(ledAcross5V, tele).find((p) => p.fact === 'burned:LED1')!
    expect(led.action?.label).toBe('換新')
    useStore.setState({ telemetry: tele }) // the readings the row was derived from
    led.action!.run()
    expect(rec.repaired).toEqual([['LED1']])
    const res = problemsOf(resistorOn12V, run(resistorOn12V, 2.5)).find((p) => p.fact === 'burned:R2')!
    expect(res.action?.label).toBe('換新')
    // the detail says how it comes back: 〔換新〕, or by itself once fixed
    expect(res.detail).toContain('再按〔換新〕；改好電路或數值時也會自動換新')
    expect(res.detail).not.toContain('重置模擬')
  })

  it('a vented electrolytic: 〔對調兩腳〕 first (fixes the cause and brings a new one), then 〔換新〕', () => {
    const row = problemsOf(reversedCap, run(reversedCap, 1.5)).find((p) => p.fact === 'vented:C1')!
    expect(row.action?.label).toBe('對調兩腳')
    expect(row.extraActions?.map((a) => a.label)).toEqual(['換新'])
  })

  it('a board’s on-board LED: one row (the ERC finding and the simulator’s issue state one fact), 〔換新〕 replaces the board’s LED', () => {
    const l = valid(bluePill())
    const e = new SimEngine(l)
    e.advance(0.01)
    const telemetry = e.telemetry()
    const u1 = telemetry.components[BP.id]
    u1.sub!.LED_PC13 = { ...u1.sub!.LED_PC13, burned: true }
    const issues = [...telemetry.issues, { level: 'error' as const, message: 'LED U1.LED_PC13 burned out (current 212mA — add a series resistor)', componentId: 'U1' }]
    const rows = problemsOf(l, { ...telemetry, issues }, issues).filter((p) => p.fact === 'burned:U1.LED_PC13')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('erc')
    expect(rows[0].action?.label).toBe('換新')
    const rec = installHost()
    useStore.setState({ telemetry: { ...telemetry, issues } })
    rows[0].action!.run()
    expect(rec.repaired).toEqual([['U1']])
  })

  it('classic chrome: no 〔換新〕 (its rows keep what they had)', () => {
    __setLangForTests('en')
    const led = problemsOf(ledAcross5V, run(ledAcross5V, 0.02)).find((p) => p.fact === 'burned:LED1')!
    expect(led.action).toBeUndefined()
    expect(led.extraActions).toBeUndefined()
  })
})

// ------------------------------------------------------------------- banner
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi, useProblems] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}
const banner = (id: string, type: string, tele: SimTelemetry['components'][string]) =>
  renderLive(createElement(DamageBanner, { id, entry: CATALOG[type], tele }))

describe('the inspector banner: 〔換新〕 on a destroyed part, once', () => {
  it('a burned LED: the button (「把 LED1 換成新的」) and how it comes back — no 「更換」', () => {
    const tele = run(ledAcross5V, 0.02).components.LED1
    const html = banner('LED1', 'led', tele)
    expect(html).toContain('dmg-banner-actions')
    expect(html).toContain('aria-label="把 LED1 換成新的"')
    expect(html).toContain('>換新<')
    const body = damageText('LED1', CATALOG.led, tele)!.body
    expect(body).toContain('按〔換新〕就換上新的；改好電路或數值時也會自動換新')
    expect(body).not.toContain('更換')
    expect(body).not.toContain('重置模擬')
  })

  it('a burned resistor, a vented capacitor, an RGB die: the button and the same recovery sentence', () => {
    for (const [layout, id, type, s] of [
      [resistorOn12V, 'R2', 'resistor', 2.5],
      [reversedCap, 'C1', 'capacitor', 1.5],
      [rgbRedBurned, 'D1', 'rgb_led', 0.05],
    ] as const) {
      const tele = run(layout, s, type === 'rgb_led' ? 1e-4 : 1e-3).components[id]
      expect(banner(id, type, tele), id).toContain('>換新<')
      expect(damageText(id, CATALOG[type], tele)!.body, id).toContain('按〔換新〕就換上新的；改好電路或數值時也會自動換新')
    }
  })

  it('an overheating part (a warning — not latched): no button', () => {
    const hot = run(resistorOn12V, 1).components.R2
    expect(hot.damage?.kind).toBe('overheating')
    const html = banner('R2', 'resistor', hot)
    expect(html).toContain('dmg-banner is-warn')
    expect(html).not.toContain('換新')
  })

  it('the card above shows this part’s own burned row (it has 〔換新〕): the banner leaves its button out', () => {
    const telemetry = run(ledAcross5V, 0.02)
    const problems = problemsOf(ledAcross5V, telemetry)
    expect(cardShowsOwnDamageRow(problems, 'LED1')).toBe(true)
    useProblems.setState({ problems })
    const html = banner('LED1', 'led', telemetry.components.LED1)
    expect(html).toContain('dmg-banner')
    expect(html).not.toContain('dmg-banner-actions')
    // a row about the part that is not its damage row: the banner keeps its button
    const other: Pick<Problem, 'componentIds' | 'fact'>[] = [{ componentIds: ['LED1'], fact: 'reversed:LED1' }]
    expect(cardShowsOwnDamageRow(other, 'LED1')).toBe(false)
    expect(cardShowsOwnDamageRow([{ componentIds: ['R1', 'LED1'], fact: 'burned:R1' }], 'LED1')).toBe(false)
    expect(cardShowsOwnDamageRow([], 'LED1')).toBe(false)
  })
})

// ------------------------------------------------------------------ 3D smoke
describe('SceneFx: the smoke trail stops when the damage clears', () => {
  const host: SceneFxHost = {
    bounds: (_id, out) => {
      out.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1))
      return true
    },
    pinWorld: () => null,
    ids: () => ['LED1', 'U1'],
  }
  const snap = (time: number, components: SimTelemetry['components']): SimTelemetry => ({ time, netVoltages: {}, components, issues: [] })

  it('換新 (damage gone): the burned part’s trail is dropped; a re-burn starts a new one', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(1, { LED1: { pinVoltages: {}, burned: true, damage: { kind: 'burned', since: 0.999 } } }))
    expect(fx.emitterCount).toBe(1) // the smoke trail
    fx.setTelemetry(snap(1.2, { LED1: { pinVoltages: {}, burned: false } }))
    expect(fx.emitterCount).toBe(0)
    fx.setTelemetry(snap(1.3, { LED1: { pinVoltages: {}, burned: true, damage: { kind: 'burned', since: 1.29 } } }))
    expect(fx.emitterCount).toBe(1)
    fx.dispose()
  })

  it('a board’s on-board LED: its trail stops when the board’s LED is replaced', () => {
    const fx = new SceneFx(host, false)
    fx.setTelemetry(snap(1, { U1: { pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, burned: true, damage: { kind: 'burned', since: 0.99 } } } } }))
    expect(fx.emitterCount).toBe(1)
    fx.setTelemetry(snap(1.2, { U1: { pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, burned: false } } } }))
    expect(fx.emitterCount).toBe(0)
    fx.dispose()
  })
})
