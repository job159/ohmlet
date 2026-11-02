/**
 * 顯示電流 contract items (flow2 → sim, fix round 3):
 *  - buildTracker hands every device its model, so a chip's return current
 *    is routed through a regulator: battery → LM7805 → 555 → LED shows a
 *    CLOSED loop (it used to stay dark);
 *  - publishCurrents writes only finite pin currents — unknown stays ABSENT
 *    (never a guessed 0) — and names the parts whose loop cannot be closed
 *    in SimTelemetry.flowConcealed, the cause (the chip) first;
 *  - FlowToggle says so once per run while 顯示電流 is on:
 *    「U1 的電流迴路無法完整追蹤，暫不顯示它的光點」.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { SimEngine } from '../src/sim/engine'
import { validateLayout } from '../src/model/validate'
import type { CircuitLayout, SimTelemetry, Wire } from '../src/model/types'
import { __setLangForTests } from '../src/i18n'
import { getToasts } from '../src/ui/kit'
import { useFlowView } from '../src/ui/fx/flow'
import { useStore } from '../src/state/store'
import { concealedNames, flowConcealedNote, watchFlowConcealed } from '../src/ui/chrome/FlowToggle'
import { dip, dipPinHole, layout, supply5, twoLead } from './helpers'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = (id: string, from: string, to: string): Wire => ({ id, from, to })

/** blinky-555 on a 9 V battery behind an LM7805 (the classic beginner build). */
function regulated555(): CircuitLayout {
  const res = validateLayout(JSON.parse(readFileSync(join(ROOT, 'examples/blinky-555.json'), 'utf8')))
  const L = structuredClone(res.layout!)
  L.components = L.components.filter((c) => c.id !== 'PS1')
  L.components.push({ id: 'BAT1', type: 'battery_9v' }, { id: 'U2', type: 'lm7805', holes: ['c40', 'c41', 'c42'] })
  L.wires = L.wires.filter((x) => !x.from.startsWith('PS1'))
  L.wires.push(W('b1', 'BAT1:-', 'top-0'), W('b2', 'BAT1:+', 'a40'), W('r1', 'a41', 'top-38'), W('r2', 'a42', 'top+39'))
  return L
}

/** A 7404 at f20 whose VCC comes through 10 Ω: 1Y (floating input → high) sources a 470 Ω load to the − rail. */
function resistorFed7404(): CircuitLayout {
  const AT = 'f20'
  const pin = (n: number) => dipPinHole(AT, 14, n)
  const row = (h: string, r: string) => `${r}${h.slice(1)}`
  return layout(
    [supply5(), twoLead('RF', 'resistor', 'top+5', 'a50', { resistance: 10 }), dip('U1', 'sn7404', AT), twoLead('RL', 'resistor', row(pin(2), 'j'), 'top-6', { resistance: 470 })],
    [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), W('vcc', row(pin(14), 'a'), 'b50'), W('gnd', row(pin(7), 'j'), 'top-3')],
  )
}

/** A fresh averaging window [t0, t1] of a tracked coordinator. */
function windowAt(co: SimulationCoordinator, t0: number, t1: number): SimTelemetry {
  while (co.time < t0 - 1e-12) co.advance(Math.min(0.005, t0 - co.time))
  co.frame()
  while (co.time < t1 - 1e-12) co.advance(Math.min(0.005, t1 - co.time))
  return co.telemetry()
}

const allFinite = (t: SimTelemetry) =>
  Object.values(t.components).every((c) => Object.values(c.pinCurrents ?? {}).every((i) => Number.isFinite(i)))

describe('a regulator closes a chip’s loop (buildTracker passes each device’s model)', () => {
  it('battery → LM7805 → 555 → LED: the lit window shows the whole loop, the battery wires carry it', () => {
    const co = new SimulationCoordinator()
    co.setCurrentTracking(true)
    co.load(regulated555(), 1)
    const t = windowAt(co, 0.3, 0.32) // OUT high: the LED is lit
    const led = t.components.D1
    expect((led.pinCurrents?.anode ?? 0)).toBeGreaterThan(1e-3)
    expect(t.flowConcealed).toBeUndefined()
    expect(allFinite(t)).toBe(true)
    // the battery's + wire carries what its − wire carries back — and at least the LED's current
    const plus = t.wireCurrents?.b2
    const minus = t.wireCurrents?.b1
    expect(typeof plus === 'number' && typeof minus === 'number').toBe(true)
    expect(Math.abs(Math.abs(plus!) - Math.abs(minus!))).toBeLessThan(1e-6)
    expect(Math.abs(plus!)).toBeGreaterThan(led.pinCurrents!.anode)
    // the 555's OUT current enters at its VCC and comes out of the 7805, fed by the battery
    const u1 = t.components.U1.pinCurrents!
    expect(Object.values(u1).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6)
    const u2 = t.components.U2.pinCurrents!
    expect(u2.OUT).toBeLessThan(-led.pinCurrents!.anode * 0.99)
    expect(Math.abs(u2.IN + u2.OUT + u2.GND)).toBeLessThan(1e-6)
  })
})

describe('unknown is absent, and named (publishCurrents / flowConcealed)', () => {
  it('a 7404 fed through a resistor: no pin current is a guessed 0; flowConcealed names the chip first', () => {
    const e = new SimEngine(resistorFed7404())
    e.trackCurrents = true
    e.advance(0.002)
    e.telemetry()
    e.advance(0.002)
    const t = e.telemetry()
    expect(allFinite(t)).toBe(true)
    const u1 = t.components.U1.pinCurrents!
    expect('VCC' in u1).toBe(false)
    expect('GND' in u1).toBe(false)
    expect('1Y' in u1).toBe(false)
    expect(t.components.RL.pinCurrents).toEqual({})
    expect(t.flowConcealed?.[0]).toBe('U1')
    expect(t.flowConcealed).toContain('RL')
    // a closed circuit names nothing
    const ok = new SimEngine(layout([supply5(), twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1000 })], [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0')]))
    ok.trackCurrents = true
    ok.advance(0.002)
    expect(ok.telemetry().flowConcealed).toBeUndefined()
  })
})

describe('FlowToggle: the 「無法完整追蹤」 note', () => {
  beforeEach(() => {
    __setLangForTests('zh-TW')
    useFlowView.getState().setVisible(true)
  })
  afterEach(() => {
    useFlowView.getState().setVisible(false)
    useStore.setState({ running: false, telemetry: null })
  })

  it('names the chip (the cause), in zh-TW', () => {
    const l = resistorFed7404()
    expect(concealedNames(['U1', 'RL', 'RF', 'PS1'], l)).toEqual(['U1'])
    expect(concealedNames(['RL'], l)).toEqual(['RL'])
    expect(concealedNames(undefined, l)).toEqual([])
    expect(flowConcealedNote(['U1'])).toBe('U1 的電流迴路無法完整追蹤，暫不顯示它的光點')
    expect(flowConcealedNote(['U1', 'U2'])).toBe('U1、U2 的電流迴路無法完整追蹤，暫不顯示它們的光點')
    expect(flowConcealedNote([])).toBeNull()
  })

  it('shown once per run while 顯示電流 is on and the simulation runs — never when it is off', () => {
    const l = resistorFed7404()
    const tele = (time: number): SimTelemetry => ({ time, netVoltages: {}, components: {}, issues: [], flowConcealed: ['U1', 'RL'] })
    const notes = () => getToasts().filter((x) => x.text.includes('無法完整追蹤')).length
    useStore.setState({ layout: l, running: true, telemetry: null })
    const stop = watchFlowConcealed()
    try {
      const before = notes()
      useStore.setState({ telemetry: tele(0.1) })
      expect(notes()).toBe(before + 1)
      useStore.setState({ telemetry: tele(0.2) })
      useStore.setState({ telemetry: tele(0.3) })
      expect(notes()).toBe(before + 1) // once per run
    } finally {
      stop()
    }
    // a new run (FlowToggle watches once per simulation session) with the view OFF: nothing
    useFlowView.getState().setVisible(false)
    const stop2 = watchFlowConcealed()
    try {
      const before = notes()
      useStore.setState({ telemetry: tele(0.4) })
      expect(notes()).toBe(before)
    } finally {
      stop2()
    }
  })
})
