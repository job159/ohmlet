/**
 * Honest supply over-current (walkthrough M2): 'supply PS1 current > 2A
 * (possible short circuit)' — and the ERC finding 「PS1 輸出超過 2 A——短路…」
 * built from it — only for a SUSTAINED over-current, and only while it lasts.
 *
 *  - a bulk capacitor across the supply charges in one step: never a short;
 *  - an LED straight across the supply burns open within 1 ms: the burn is
 *    reported, no stale supply short;
 *  - a dead short is reported within 20 ms and stays while it lasts;
 *  - when the over-current ends (lower voltage, a part burned open) the
 *    issue is retracted, and it can be raised again.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DT, SimEngine, SUPPLY_OVERCURRENT_HOLD_S } from '../src/sim/engine'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { runErc } from '../src/sim/erc'
import type { CircuitLayout, ComponentInstance, Wire } from '../src/model/types'
import { layout, twoLead } from './helpers'

const W = (id: string, from: string, to: string): Wire => ({ id, from, to })
const OVER = /^supply PS1 current > 2A/

/** A bench supply (`volts`) on the top rails: PS1:+ → top+0, PS1:- → top-0. */
function bench(parts: ComponentInstance[], wires: Wire[] = [], volts = 5): CircuitLayout {
  return layout(
    [{ id: 'PS1', type: 'power_supply', params: { voltage: volts } }, ...parts],
    [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), ...wires],
  )
}
const cap = (uF: number) => twoLead('C1', 'capacitor', 'top+3', 'top-3', { capacitance: uF * 1e-6, polarized: true })
const ledBranch = [
  twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 330 }),
  twoLead('D1', 'led', 'b10', 'b14', { color: 'red' }),
]
const ledReturn = [W('wk', 'c14', 'top-2')]

const supplyIssues = (e: SimEngine) => e.issues.filter((i) => OVER.test(i.message))
/** The live ERC run the Problems panel makes from a running coordinator. */
function liveSupplyFindings(co: SimulationCoordinator, l: CircuitLayout) {
  return runErc(l, { telemetry: co.telemetry(), issues: co.issues() }).filter((f) => f.fact === 'overcurrent-supply:PS1')
}

describe('a start-up surge is not a short circuit', () => {
  for (const [uF, volts] of [
    [100, 5],
    [100, 12],
    [2200, 12],
  ] as const) {
    it(`${uF} µF electrolytic across a ${volts} V supply (+ to the + rail): no PS1 issue, no PS1 finding`, () => {
      const l = bench([cap(uF), ...ledBranch], ledReturn, volts)
      // the surge is real: the first step draws far more than 2 A
      const e = new SimEngine(l)
      e.step()
      expect(Math.abs(e.telemetry().components.PS1.current ?? 0)).toBeGreaterThan(2)
      e.advance(0.5)
      expect(supplyIssues(e)).toEqual([])
      // the coordinator / ERC path the status pill and Problems read
      const co = new SimulationCoordinator()
      co.load(l, 1)
      co.advance(0.5)
      expect(co.issues().filter((i) => OVER.test(i.message))).toEqual([])
      expect(liveSupplyFindings(co, l)).toEqual([])
      // the LED beside it really works (nothing blocks the cheer on PS1's account)
      expect(co.telemetry().components.D1.light).toBeGreaterThan(0.4)
    })
  }
})

describe('an LED straight across the supply burns open: no stale supply warning', () => {
  it('the burn is reported, the supply short never is, and nothing flows afterwards', () => {
    const l = bench([twoLead('D1', 'led', 'top+1', 'top-1', { color: 'red' })])
    const e = new SimEngine(l)
    e.advance(0.002)
    expect(e.telemetry().components.D1.burned).toBe(true)
    e.advance(0.5)
    const t = e.telemetry()
    expect(Math.abs(t.components.PS1.current ?? 1)).toBeLessThan(1e-6)
    expect(e.issues.some((i) => /^LED D1 burned out/.test(i.message))).toBe(true)
    expect(supplyIssues(e)).toEqual([])
    const co = new SimulationCoordinator()
    co.load(l, 1)
    co.advance(0.5)
    expect(liveSupplyFindings(co, l)).toEqual([])
  })
})

describe('a real short is reported promptly and only while it lasts', () => {
  it('a wire across the supply: the issue appears within 20 ms (not before the 10 ms hold)', () => {
    const e = new SimEngine(bench([], [W('ws', 'top+1', 'top-1')]))
    e.advance(SUPPLY_OVERCURRENT_HOLD_S * 0.9)
    expect(supplyIssues(e)).toEqual([])
    e.advance(0.02 - SUPPLY_OVERCURRENT_HOLD_S * 0.9)
    expect(supplyIssues(e)).toEqual([{ level: 'warning', message: 'supply PS1 current > 2A (possible short circuit)', componentId: 'PS1' }])
    e.advance(0.5)
    expect(supplyIssues(e).length).toBe(1) // stays while the short is there
  })

  it('the ERC finding (「PS1 輸出超過 2 A」) follows: present with the short, gone without it', () => {
    const l = bench([], [W('ws', 'top+1', 'top-1')])
    const co = new SimulationCoordinator()
    co.load(l, 1)
    co.advance(0.02)
    expect(liveSupplyFindings(co, l).map((f) => f.short)).toEqual(['PS1 supplies more than 2 A'])
  })

  it('the over-current ends (the supply turned down): the issue is retracted — and comes back with it', () => {
    // 1 Ω across the supply: 5 A at 5 V, 1 A at 1 V
    const e = new SimEngine(bench([twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1 })]))
    e.advance(0.02)
    expect(supplyIssues(e).length).toBe(1)
    e.setRuntimeParam('PS1', 'voltage', 1)
    e.advance(SUPPLY_OVERCURRENT_HOLD_S * 0.5)
    expect(supplyIssues(e).length).toBe(1) // not before it has stayed below for the hold
    e.advance(SUPPLY_OVERCURRENT_HOLD_S)
    expect(supplyIssues(e)).toEqual([])
    expect(e.telemetry().issues.filter((i) => OVER.test(i.message))).toEqual([])
    // raised again when it returns
    e.setRuntimeParam('PS1', 'voltage', 5)
    e.advance(0.02)
    expect(supplyIssues(e).length).toBe(1)
  })

  it('a part that burns open under the over-current: the stale short is retracted, the burn stays', () => {
    // 1 Ω (¼ W) across 5 V dissipates 25 W: its thermal model burns it open after about a second
    const e = new SimEngine(bench([twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1 })]))
    e.advance(0.05)
    expect(supplyIssues(e).length).toBe(1)
    e.advance(2)
    const t = e.telemetry()
    expect(t.components.R1.damage?.kind).toBe('burned')
    expect(Math.abs(t.components.PS1.current ?? 1)).toBeLessThan(1e-3)
    expect(supplyIssues(e)).toEqual([])
    expect(e.issues.some((i) => /^R1 burned open/.test(i.message))).toBe(true)
  })

  it('a pulsed short (50 % duty, 1 kHz) still adds up and is reported', () => {
    const e = new SimEngine(bench([twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1 })]))
    const half = 0.0005
    let on = true
    for (let k = 0; k < 120 && supplyIssues(e).length === 0; k++) {
      e.setRuntimeParam('PS1', 'voltage', on ? 5 : 0)
      e.advance(half, DEFAULT_DT)
      on = !on
    }
    expect(supplyIssues(e).length).toBe(1)
    expect(e.time).toBeLessThan(0.04) // ≈ 27 ms of a 50 % short
  })

  it('the simulation log keeps every new issue after a retraction (it never skips the next one)', () => {
    // 1 Ω across PS1 (a short), and an LED straight across PS2, powered only later
    const l = layout(
      [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1 }),
        { id: 'PS2', type: 'power_supply', params: { voltage: 0 } },
        twoLead('D1', 'led', 'bot+1', 'bot-1', { color: 'red' }),
      ],
      [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), W('wp2', 'PS2:+', 'bot+0'), W('wn2', 'PS2:-', 'bot-0')],
    )
    const co = new SimulationCoordinator()
    co.load(l, 1)
    const simLog = () => co.frame().log.filter((e) => e.source === 'sim').map((e) => e.message)
    const logged: string[] = []
    co.advance(0.03)
    logged.push(...simLog())
    expect(logged.filter((m) => OVER.test(m))).toHaveLength(1)
    // the short ends (PS1 turned down to 1 V: 1 A) — the warning is retracted from the issues
    co.setRuntimeParam('PS1', 'voltage', 1)
    co.advance(0.03)
    logged.push(...simLog())
    expect(co.issues().filter((i) => OVER.test(i.message))).toEqual([])
    // a NEW issue afterwards (the LED burns on PS2) is still written to the log, once
    co.setRuntimeParam('PS2', 'voltage', 5)
    co.advance(0.03)
    logged.push(...simLog())
    co.advance(0.01)
    logged.push(...simLog())
    expect(co.issues().some((i) => /^LED D1 burned out/.test(i.message))).toBe(true)
    expect(logged.filter((m) => /^LED D1 burned out/.test(m))).toHaveLength(1)
    // the short, raised again later, is a new event: logged again
    co.setRuntimeParam('PS1', 'voltage', 5)
    co.advance(0.03)
    logged.push(...simLog())
    expect(logged.filter((m) => OVER.test(m))).toHaveLength(2)
  })

  it('separate surges (a capacitor switched in again and again) never add up to a short', () => {
    const e = new SimEngine(bench([cap(1000)]))
    for (let k = 0; k < 40; k++) {
      e.setRuntimeParam('PS1', 'voltage', k % 2 === 0 ? 5 : 0) // charge, discharge: a ≈ 10 A surge each time
      e.advance(0.002)
    }
    expect(supplyIssues(e)).toEqual([])
  })
})
