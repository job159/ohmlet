/**
 * Round 5 — damage: the automatic 換新 (src/ui/embedded/auto-heal.ts).
 * 「燒掉的 LED 要刪掉、重放、重設參數？」 — no: change the VALUE that burned
 * it and a new part is in, AUTO_HEAL_MS after the last such change (a
 * slider drag heals once). A structural edit already rebuilds (every part
 * new — nothing to add); a mechanical control (a button, a switch, DIP
 * bits, jumpers, the multimeter's mode) uses the circuit and never heals.
 * One turn of the knob never burns a part twice: a part destroyed during
 * the turn, or by pushing a value one way, is not brought back by pushing
 * on (a drag through the burn point, stepper clicks up past it) — turning
 * it back is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, ComponentInstance } from '../src/model/types'
import type { SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import '../src/sim/models'
import { __resetHistoryForTests, __setSimHostFactoryForTests, getSimHost, stepSimTime, useStore } from '../src/state/store'
import { AUTO_HEAL_MS, changesHealingValue, isMechanicalParam, pushesOn, startAutoHeal, turnDirections } from '../src/ui/embedded/auto-heal'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { valid } from './erc/helpers'

const memory = new Map<string, string>()
let stop: (() => void) | null = null
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
  for (const t of getToasts()) dismissToast(t.id) // each test reads its own toasts
})
afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  __setSimHostFactoryForTests(null)
  vi.unstubAllGlobals()
  useStore.setState({ selection: [], telemetry: null, running: false })
})

// ----------------------------------------------------------------- pure
const L = (...components: ComponentInstance[]): CircuitLayout => ({ version: 1, components, wires: [] })
const with_ = (c: ComponentInstance, params: ComponentInstance['params']): ComponentInstance => ({ ...c, params: { ...c.params, ...params } })

describe('which changes heal', () => {
  const ps: ComponentInstance = { id: 'PS1', type: 'power_supply', params: { voltage: 12 } }
  const others: ComponentInstance[] = [
    { id: 'P1', type: 'potentiometer', holes: ['a1', 'a2', 'a3'] },
    { id: 'FG1', type: 'function_generator' },
    { id: 'B1', type: 'pushbutton', at: 'f50' },
    { id: 'SW1', type: 'slide_switch', holes: ['a40', 'a41', 'a42'] },
    { id: 'DIP1', type: 'dip_switch_8', at: 'e20' },
    { id: 'DMM1', type: 'multimeter' },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'M1', type: 'l298n_module' },
    { id: 'R1', type: 'resistor', holes: ['a5', 'a9'], params: { resistance: 220 } },
  ]
  const base = L(ps, ...others)
  const change = (id: string, params: ComponentInstance['params']): CircuitLayout => ({
    ...base,
    components: base.components.map((c) => (c.id === id ? with_(c, params) : c)),
  })

  it('a value: the supply voltage, a pot, the function generator (also its waveform)', () => {
    expect(changesHealingValue(base, change('PS1', { voltage: 3 }))).toBe(true)
    expect(changesHealingValue(base, change('P1', { position: 0.2 }))).toBe(true)
    expect(changesHealingValue(base, change('FG1', { frequency: 50 }))).toBe(true)
    expect(changesHealingValue(base, change('FG1', { waveform: 'sine' }))).toBe(true)
  })

  it('a mechanical control never: button, switch, DIP bits, multimeter mode, BOOT0, jumpers', () => {
    expect(changesHealingValue(base, change('B1', { pressed: true }))).toBe(false)
    expect(changesHealingValue(base, change('SW1', { state: 'b' }))).toBe(false)
    expect(changesHealingValue(base, change('DIP1', { on: '10000000' }))).toBe(false)
    expect(changesHealingValue(base, change('DMM1', { mode: 'A' }))).toBe(false)
    expect(changesHealingValue(base, change('U1', { boot0: '1' }))).toBe(false)
    expect(changesHealingValue(base, change('M1', { jumperEnA: false }))).toBe(false)
    expect(isMechanicalParam({ key: 'pressed', kind: 'boolean' })).toBe(true)
    expect(isMechanicalParam({ key: 'voltage', kind: 'number' })).toBe(false)
  })

  it('not its business: a structural value (rebuilds anyway), a new part, nothing changed, a value set to its default', () => {
    expect(changesHealingValue(base, change('R1', { resistance: 470 }))).toBe(false)
    expect(changesHealingValue(base, { ...base, components: [...base.components, { id: 'PS2', type: 'power_supply' }] })).toBe(false)
    expect(changesHealingValue(base, base)).toBe(false)
    expect(changesHealingValue(base, { ...base })).toBe(false)
    // P1 has no stored position: storing the default changes no value
    const def = others[0]
    expect(changesHealingValue(base, change('P1', { position: (def.params?.position as number | undefined) ?? 0.5 }))).toBe(false)
  })
})

// ---------------------------------------------------------- with the store
const PS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
/** a red LED straight across 5 V (burns at once), a switch and a resistor that do nothing */
const burnAt5V: CircuitLayout = valid({
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'LED1', type: 'led', holes: ['top+8', 'top-9'], params: { color: 'red' } },
    { id: 'SW1', type: 'slide_switch', holes: ['a40', 'a41', 'a42'] },
    { id: 'R9', type: 'resistor', holes: ['a50', 'a54'], params: { resistance: 220 } },
  ],
  wires: PS,
} as CircuitLayout)

/** The real store on an inline host (manual ticks), its repairParts calls recorded; LED1 burned. */
function burnedSession(): { repaired: (readonly string[] | null)[] } {
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
  useStore.setState({ layout: burnAt5V })
  getSimHost()
  stepSimTime(0.01)
  expect(useStore.getState().telemetry?.components.LED1.burned).toBe(true)
  return rec
}

describe('startAutoHeal', () => {
  it('turning the supply down: one 換新 of the destroyed parts 400 ms after the LAST change — the LED lives', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    const { setParam } = useStore.getState()
    setParam('PS1', 'voltage', 2)
    vi.advanceTimersByTime(AUTO_HEAL_MS - 100)
    setParam('PS1', 'voltage', 1.5) // the drag goes on: the wait starts over
    vi.advanceTimersByTime(AUTO_HEAL_MS - 1)
    expect(rec.repaired).toEqual([])
    vi.advanceTimersByTime(1)
    expect(rec.repaired).toEqual([['LED1']])
    // the paused view shows the new LED at once, and says so (paused: it gets power once the simulation runs)
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(false)
    expect(getToasts().map((t) => t.text)).toContain('已自動換上新的 LED1——模擬已暫停')
    // 1.5 V across a red LED: a few µA — it stays whole
    stepSimTime(0.05)
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(false)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
  })

  it('the value still too high: the new LED burns again (honest) — the next value change brings another', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 4)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
    stepSimTime(0.01)
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(true)
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1'], ['LED1']])
  })

  it('a value change that itself destroys a part does not bring it back (no second burn for one turn of the knob)', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
    stepSimTime(0.01)
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(false)
    // turned up again: the LED burns BECAUSE of this change — it stays burned (a real one would)
    useStore.getState().setParam('PS1', 'voltage', 5)
    stepSimTime(0.01)
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(true)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(true)
    // the fix (turned down): now it comes back
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1'], ['LED1']])
  })

  it('a mechanical control never heals (a switch flipped, a button pressed)', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('SW1', 'state', 'b')
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
    expect(useStore.getState().telemetry?.components.LED1.burned).toBe(true)
  })

  it('a structural edit rebuilds (every part new) — no extra 換新, and it cancels a pending one', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('R9', 'resistance', 470)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
    stepSimTime(0.01) // burned again (5 V straight across it)
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    useStore.getState().setParam('R9', 'resistance', 1000) // rebuilt inside the wait
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
  })

  it('nothing destroyed: a value change costs no 換新 (no frame)', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
    useStore.getState().setParam('PS1', 'voltage', 1.2)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
  })

  it('stopped: nothing more', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    stop()
    stop = null
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
  })
})

// ------------------------------------------------- one turn, one outcome
/** a red LED behind 47 Ω: lights at 3 V (≈ 25 mA), burns at once from about 9 V; FG1 sits unwired */
const ledBehind47 = (v: number): CircuitLayout =>
  valid({
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: v } },
      { id: 'R1', type: 'resistor', holes: ['top+5', 'a10'], params: { resistance: 47 } },
      { id: 'D1', type: 'led', holes: ['b10', 'top-11'], params: { color: 'red' } },
      { id: 'FG1', type: 'function_generator' },
    ],
    wires: PS,
  } as CircuitLayout)
/** 10 Ω straight across the supply: 0.9 W at 3 V (warm), 14.4 W at 12 V (burns open ≈ 2 s later) */
const resistorAcross = (v: number): CircuitLayout =>
  valid({
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: v } },
      { id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } },
    ],
    wires: PS,
  } as CircuitLayout)

/** The real store on an inline host (manual ticks), its repairParts calls recorded. */
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
  stepSimTime(0.01)
  return rec
}
const part = (id: string) => useStore.getState().telemetry?.components[id]
const autoToasts = () => getToasts().filter((t) => t.text.startsWith('已自動換上新的'))

describe('startAutoHeal: one turn of the knob never burns a part twice', () => {
  it('a drag UP through the burn point: the LED that burned during the drag stays burned — no second pop, no toast', () => {
    const rec = sessionOf(ledBehind47(3))
    expect(part('D1')?.burned).toBe(false)
    vi.useFakeTimers()
    stop = startAutoHeal()
    let burnedAt = -1
    for (let i = 0; i <= 18; i++) {
      useStore.getState().setParam('PS1', 'voltage', 3 + i * 0.5) // 3 → 12 V, one step every 30 ms
      stepSimTime(0.02)
      vi.advanceTimersByTime(30)
      if (burnedAt < 0 && part('D1')?.burned) burnedAt = i
    }
    expect(burnedAt).toBeGreaterThan(0) // it burned mid-drag, and the drag went on
    expect(burnedAt).toBeLessThan(18)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
    expect(part('D1')?.burned).toBe(true)
    expect(autoToasts()).toEqual([])
  })

  it('stepper clicks UP past the burn point, each after the quiet time: no new LED for a step further up — a step down brings one', () => {
    const rec = sessionOf(ledBehind47(3))
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 12) // this click burns it
    stepSimTime(0.02)
    expect(part('D1')?.burned).toBe(true)
    vi.advanceTimersByTime(AUTO_HEAL_MS + 100)
    for (const v of [12.5, 13, 13.5]) {
      useStore.getState().setParam('PS1', 'voltage', v) // pushing on: it cannot be the fix
      stepSimTime(0.02)
      vi.advanceTimersByTime(AUTO_HEAL_MS + 100)
    }
    expect(rec.repaired).toEqual([])
    expect(part('D1')?.burned).toBe(true)
    expect(autoToasts()).toEqual([])
    useStore.getState().setParam('PS1', 'voltage', 3) // turned back: the fix
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['D1']])
    stepSimTime(0.05)
    expect(part('D1')?.burned).toBe(false)
    expect(part('D1')?.light ?? 0).toBeGreaterThan(0.5)
  })

  it('a slow burn (the resistor burns open ≈ 2 s after the click): the next click up does not replace it either', () => {
    const rec = sessionOf(resistorAcross(3))
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 12)
    vi.advanceTimersByTime(AUTO_HEAL_MS + 100) // the turn ends while R2 still conducts
    stepSimTime(3)
    expect(part('R2')?.damage?.kind).toBe('burned')
    useStore.getState().setParam('PS1', 'voltage', 13)
    vi.advanceTimersByTime(AUTO_HEAL_MS + 100)
    expect(rec.repaired).toEqual([])
    useStore.getState().setParam('PS1', 'voltage', 3)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['R2']])
    stepSimTime(0.5)
    expect(part('R2')?.damage?.kind).not.toBe('burned') // 0.9 W: warm, whole
  })

  it('a turn that ends where it began brings nothing back (the value is where it burned the part)', () => {
    const rec = burnedSession()
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 2)
    vi.advanceTimersByTime(100)
    useStore.getState().setParam('PS1', 'voltage', 5)
    vi.advanceTimersByTime(5 * AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([])
    useStore.getState().setParam('PS1', 'voltage', 1.5)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['LED1']])
  })

  it('pushing on one value while changing another: the other may be the fix — a new one goes in', () => {
    const rec = sessionOf(ledBehind47(3))
    vi.useFakeTimers()
    stop = startAutoHeal()
    useStore.getState().setParam('PS1', 'voltage', 12)
    stepSimTime(0.02)
    vi.advanceTimersByTime(AUTO_HEAL_MS + 100)
    expect(part('D1')?.burned).toBe(true)
    useStore.getState().setParam('PS1', 'voltage', 12.5)
    useStore.getState().setParam('FG1', 'frequency', 50)
    vi.advanceTimersByTime(AUTO_HEAL_MS)
    expect(rec.repaired).toEqual([['D1']])
  })
})

describe('turnDirections / pushesOn', () => {
  const lay = (v: number, w?: string): CircuitLayout =>
    L({ id: 'PS1', type: 'power_supply', params: { voltage: v } }, { id: 'FG1', type: 'function_generator', params: w ? { waveform: w } : {} })
  const V = 'PS1\u0000voltage'
  const W = 'FG1\u0000waveform'
  it('up / down / back where it began / no direction', () => {
    expect([...turnDirections(new Map([[V, 3]]), lay(12))]).toEqual([[V, 1]])
    expect([...turnDirections(new Map([[V, 12]]), lay(3))]).toEqual([[V, -1]])
    expect([...turnDirections(new Map([[V, 5]]), lay(5))]).toEqual([])
    expect([...turnDirections(new Map<string, unknown>([[W, 'square']]), lay(5, 'sine'))]).toEqual([[W, 0]])
  })
  it('only pushing on, the same way, counts', () => {
    const up = new Map([[V, 1 as const]])
    expect(pushesOn(up, new Map([[V, 1 as const]]))).toBe(true)
    expect(pushesOn(up, new Map([[V, -1 as const]]))).toBe(false)
    expect(pushesOn(up, new Map<string, -1 | 0 | 1>([[V, 1], [W, 0]]))).toBe(false)
    expect(pushesOn(undefined, new Map([[V, 1 as const]]))).toBe(false)
    expect(pushesOn(new Map(), new Map([[V, 1 as const]]))).toBe(false)
  })
})
