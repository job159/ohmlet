/**
 * Round 5 — damage: how 換新 feels and what it promises.
 *
 *  - 〔換新〕 on a row or banner a moment stale (the part is whole again):
 *    no replacement announced, no sound — 「D1 沒有損壞，不用換新」;
 *  - paused: the new part gets no power until the simulation runs, so the
 *    toast says the simulation is paused and offers 〔繼續執行〕;
 *  - the automatic 換新 (auto-heal.ts) sounds and feels like the button: the
 *    insert sound and a haptic tick, not just a toast;
 *  - the English texts the classic chrome also shows (catalog support lines,
 *    ERC sentences) never promise a 〔Replace〕 button or an automatic
 *    replace it does not have there; the zh-TW product copy is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { CATALOG } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import { runErc, type ErcFinding } from '../src/sim/erc'
import { buildCircuit } from '../src/sim/erc/graph'
import { checkLive } from '../src/sim/erc/rules-live'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { __resetHistoryForTests, __setSimHostFactoryForTests, getSimHost, stepSimTime, useStore } from '../src/state/store'
import { playMech } from '../src/ui/fx/sound'
import { AUTO_HEAL_MS, startAutoHeal } from '../src/ui/embedded/auto-heal'
import { replaceDamagedWithFeedback } from '../src/ui/embedded/replace-part'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { valid } from './erc/helpers'

vi.mock('../src/ui/fx/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/fx/sound')>()),
  playMech: vi.fn(),
}))

const memory = new Map<string, string>()
const vibrate = vi.fn()
let stop: (() => void) | null = null
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  vi.stubGlobal('navigator', { vibrate })
  vibrate.mockClear()
  vi.mocked(playMech).mockClear()
  __setLangForTests('zh-TW')
  __resetHistoryForTests?.()
  for (const t of getToasts()) dismissToast(t.id)
})
afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  __setSimHostFactoryForTests(null)
  vi.unstubAllGlobals()
  useStore.setState({ selection: [], telemetry: null, running: false })
})

const PS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
/** a red LED behind 47 Ω: lights at 3 V, burns at 12 V */
const ledBehind47 = (v: number): CircuitLayout =>
  valid({
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: v } },
      { id: 'R1', type: 'resistor', holes: ['top+5', 'a10'], params: { resistance: 47 } },
      { id: 'D1', type: 'led', holes: ['b10', 'top-11'], params: { color: 'red' } },
    ],
    wires: PS,
  } as CircuitLayout)

/** The real store on an inline host (manual ticks: paused), its repairParts calls recorded. */
function sessionOf(layout: CircuitLayout): { repaired: (readonly string[] | null)[] } {
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
  useStore.setState({ layout })
  getSimHost()
  stepSimTime(0.02)
  return rec
}
const lastToast = () => getToasts()[getToasts().length - 1]
const d1 = () => useStore.getState().telemetry?.components.D1

describe('〔換新〕 tells the truth about what it did', () => {
  it('a stale row / banner (the readings show the part whole): no replacement announced, no sound', () => {
    const rec = sessionOf(ledBehind47(3))
    expect(d1()?.burned).toBe(false)
    expect(replaceDamagedWithFeedback('D1')).toBe(false)
    expect(rec.repaired).toEqual([])
    expect(playMech).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    expect(getToasts().map((t) => t.text)).toEqual(['D1 沒有損壞，不用換新'])
  })

  it('a destroyed part: replaced, with the insert sound and a haptic tick', () => {
    const rec = sessionOf(ledBehind47(12))
    expect(d1()?.burned).toBe(true)
    expect(replaceDamagedWithFeedback('D1')).toBe(true)
    expect(rec.repaired).toEqual([['D1']])
    expect(d1()?.burned).toBe(false)
    expect(playMech).toHaveBeenCalledWith('insert', { count: 2 })
    expect(vibrate).toHaveBeenCalled()
  })

  it('paused: the toast says so and offers 〔繼續執行〕 — the new part gets power once it runs', () => {
    sessionOf(ledBehind47(12))
    expect(useStore.getState().running).toBe(false)
    expect(replaceDamagedWithFeedback('D1')).toBe(true)
    const toast = lastToast()
    expect(toast.text).toBe('已換上新的 D1——模擬已暫停')
    expect(toast.action?.label).toBe('繼續執行')
    toast.action!.run()
    expect(useStore.getState().running).toBe(true)
    useStore.getState().stopSim()
  })

  it('running: the plain toast, no action', () => {
    sessionOf(ledBehind47(12))
    useStore.setState({ running: true })
    expect(replaceDamagedWithFeedback('D1')).toBe(true)
    expect(lastToast().text).toBe('已換上新的 D1')
    expect(lastToast().action).toBeUndefined()
  })
})

describe('the automatic 換新 feels like the button', () => {
  it('turning the supply down: the insert sound, a haptic tick and the toast (paused: with 〔繼續執行〕)', () => {
    const rec = sessionOf(ledBehind47(12))
    expect(d1()?.burned).toBe(true)
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 3)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['D1']])
    expect(playMech).toHaveBeenCalledWith('insert', { count: 2 })
    expect(vibrate).toHaveBeenCalled()
    expect(lastToast().text).toBe('已自動換上新的 D1——模擬已暫停')
    expect(lastToast().action?.label).toBe('繼續執行')
  })
})

// ------------------------------------------------------- classic honesty
const LATCHED = ['resistor', 'capacitor', 'led'] as const
const RECOVERY_EN = /a circuit edit (?:or a reset )?puts (?:in a new one|one in)[^.]*in the workspace, “Replace” and a value change do too/

function findingsOf(layout: CircuitLayout, seconds: number): string[] {
  const e = new SimEngine(layout)
  e.advance(seconds, 1e-3)
  const telemetry = e.telemetry()
  return runErc(layout, { telemetry, issues: telemetry.issues }).map((f) => f.message)
}
/** the live rule's own sentence for a burned LED (rules-led words most burned LEDs; this one an LED it did not report) */
function liveLedSentence(layout: CircuitLayout, id: string): string[] {
  const e = new SimEngine(layout)
  e.advance(0.02, 1e-3)
  const telemetry = e.telemetry()
  const out: ErcFinding[] = []
  checkLive(buildCircuit(layout, telemetry, e.issues), out, new Set())
  return out.filter((f) => f.id === `over-rating:${id}`).map((f) => f.message)
}
const across = (part: CircuitLayout['components'][number], v: number): CircuitLayout =>
  valid({ version: 1, components: [{ id: 'PS1', type: 'power_supply', params: { voltage: v } }, part], wires: PS } as CircuitLayout)

describe('English (the classic chrome shows it too): “Replace” and the value change are the workspace’s', () => {
  it('catalog support lines: a circuit edit or a reset puts a new one in; “Replace” and a value change only in the workspace', () => {
    for (const type of LATCHED) {
      const lines = CATALOG[type].support?.simulated ?? []
      const latch = lines.filter((l) => /latched/.test(l))
      expect(latch, type).toHaveLength(1)
      expect(latch[0], type).toMatch(RECOVERY_EN)
      for (const l of lines) if (l.includes('“Replace”')) expect(l, type).toContain('in the workspace, “Replace”')
    }
  })

  it('ERC sentences (a burned LED, a resistor burned open, a vented electrolytic): no bare “press Replace”; zh-TW still says 再按〔換新〕', () => {
    const cases: [string, string[]][] = [
      ['LED1', liveLedSentence(across({ id: 'LED1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } }, 5), 'LED1')],
      ['R2', findingsOf(across({ id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } }, 12), 2.5)],
      ['C1', findingsOf(across({ id: 'C1', type: 'capacitor', holes: ['top-6', 'top+6'], params: { capacitance: 1e-4, polarized: true } }, 5), 1.5)],
    ]
    for (const [id, messages] of cases) {
      const damage = messages.filter((m) => m.startsWith(id) && /burned|vented/.test(m) && /“Replace”/.test(m))
      expect(damage.length, id).toBeGreaterThan(0)
      for (const m of damage) {
        expect(m, id).not.toMatch(/press “Replace”/)
        expect(m, id).toMatch(RECOVERY_EN)
        expect(tMessage(m), id).toMatch(/再按〔換新〕；改好電路或數值時也會自動換新。$/)
      }
    }
  })
})
