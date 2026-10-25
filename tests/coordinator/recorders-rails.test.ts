/**
 * Wave-3 integration follow-ups in the coordinator's logic layer and
 * recorders:
 *  5. DigitalNets.rail() no longer marks a rail "seen": a single-net
 *     resolution between two analog solves cannot mask a rail move from the
 *     other nets; refreshRails re-resolves everything above 10 µV
 *     (RAIL_REFRESH_V) — the coordinator's own rail watch is gone;
 *  6. recorders: a logic channel's edge ring is cleared when its source
 *     changes (LogicTrace.since = bind time), LogicCapture.tNow,
 *     ScopeTrace.decimated, scope rings of removed probes are dropped, and
 *     the server-side 'scope-trigger' query searches the full-resolution
 *     recording.
 */
import { describe, expect, it } from 'vitest'
import { DigitalNets, NET_ANALOG, NET_LOGIC, NET_RAIL, RAIL_REFRESH_V } from '../../src/sim/digital/nets'
import type { NetClassification } from '../../src/sim/digital/nets'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { SampleRing } from '../../src/sim/coordinator/recorders'
import { findScopeTriggers } from '../../src/instruments/trigger'
import type { CircuitLayout, ComponentInstance } from '../../src/model/types'
import type { LogicChannelConfig } from '../../src/sim/coordinator/api'

// ------------------------------------------------------------- 5. rails

/** Two logic nets (nodes 0, 1), each pulled up by 10 kΩ to rail node 2. */
function twoPulledNets(rails: Record<number, number>): DigitalNets {
  const kind = new Uint8Array(4)
  kind[0] = NET_RAIL // ground
  kind[1] = NET_LOGIC
  kind[2] = NET_LOGIC
  kind[3] = NET_RAIL
  const cls: NetClassification = {
    nodeCount: 3,
    kind,
    attachments: new Uint16Array(4),
    pulls: [
      { node: 0, railNode: 2, g: 1e-4, label: 'R1' },
      { node: 1, railNode: 2, g: 1e-4, label: 'R2' },
    ],
  }
  return new DigitalNets(cls, (n) => (n === -1 ? 0 : rails[n] ?? NaN), () => {})
}

describe('DigitalNets rail refresh (railUsed only written by full resolutions)', () => {
  it('a drive change on one net between solves does not hide a rail move from the other nets', () => {
    const rails: Record<number, number> = { 2: 3.3 }
    const nets = twoPulledNets(rails)
    const slot = nets.addSlot(0, 2, -1, 'U1.PB6')
    nets.initDrive(slot, 0, 0)
    nets.resolveAll()
    expect(nets.voltage(0)).toBeCloseTo(3.3, 12)
    expect(nets.voltage(1)).toBeCloseTo(3.3, 12)

    rails[2] = 3.0 // e.g. the regulator output sagged in this solve
    // net 0 is resolved on its own (a pin drive changed) and sees the new rail …
    nets.setDrive(slot, 0, 1e-6)
    expect(nets.voltage(0)).toBeCloseTo((3.0 * 1e-4) / (1e-4 + 1e-6), 12)
    // … net 1 still holds the old value until the post-solve refresh — which
    // must notice the move (previously rail() marked the rail seen: net 1 stayed at 3.3 V)
    expect(nets.voltage(1)).toBeCloseTo(3.3, 12)
    expect(nets.refreshRails()).toBe(true)
    expect(nets.voltage(1)).toBeCloseTo(3.0, 12)
  })

  it('re-resolves above RAIL_REFRESH_V (10 µV) and not below', () => {
    expect(RAIL_REFRESH_V).toBeLessThanOrEqual(10e-6)
    const rails: Record<number, number> = { 2: 3.3 }
    const nets = twoPulledNets(rails)
    nets.resolveAll()
    rails[2] = 3.3 + 5e-6
    expect(nets.refreshRails()).toBe(false)
    expect(nets.voltage(1)).toBeCloseTo(3.3, 12)
    rails[2] = 3.3 + 20e-6
    expect(nets.refreshRails()).toBe(true)
    expect(nets.voltage(1)).toBeCloseTo(3.3 + 20e-6, 12)
    expect(nets.refreshRails()).toBe(false) // re-armed at the new level
  })

  it('an unconnected rail (NaN every time) is not a move', () => {
    const nets = twoPulledNets({})
    nets.resolveAll()
    expect(nets.refreshRails()).toBe(false)
    expect(NET_ANALOG).toBe(0)
  })
})

// ---------------------------------------------------------- 6. recorders

let wseq = 0
const w = (from: string, to: string) => ({ id: `w${++wseq}`, from, to })

/** FG1 sine (100 Hz, 2.5 ± 2.5 V) on top+ through R1 to ground; PS1 5 V on bot+. */
function bench(probes: ComponentInstance[]): CircuitLayout {
  return {
    version: 1,
    components: [
      { id: 'FG1', type: 'function_generator', params: { waveform: 'sine', frequency: 100, amplitude: 2.5, offset: 2.5 } },
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['top+3', 'top-3'], params: { resistance: 10000 } },
      { id: 'R2', type: 'resistor', holes: ['bot+3', 'bot-3'], params: { resistance: 10000 } },
      ...probes,
    ],
    wires: [w('FG1:out', 'top+0'), w('FG1:gnd', 'top-0'), w('PS1:+', 'bot+0'), w('PS1:-', 'bot-0'), w('top-1', 'bot-1')],
  }
}
const probe = (id: string, hole: string, channel = 1): ComponentInstance => ({
  id,
  type: 'scope_probe',
  holes: [hole],
  params: { channel },
})

function scope(co: SimulationCoordinator, t0 = 0, t1 = co.time, maxPoints?: number) {
  const q = co.query(maxPoints === undefined ? { kind: 'scope', t0, t1 } : { kind: 'scope', t0, t1, maxPoints })
  if (q.kind !== 'scope') throw new Error('query')
  return q.capture
}
function logic(co: SimulationCoordinator, t0 = 0, t1 = co.time) {
  const q = co.query({ kind: 'logic', t0, t1 })
  if (q.kind !== 'logic') throw new Error('query')
  return q.capture
}

describe('scope recorder: probe sources, decimation flag, server-side trigger', () => {
  it('drops the ring of a removed probe and clears it when the probe moves', () => {
    const co = new SimulationCoordinator()
    co.load(bench([probe('P1', 'top+5')]), 1)
    co.advance(0.02)
    const a = scope(co).traces
    expect(a.map((t) => t.index)).toEqual([0])
    expect(a[0].t.length).toBeGreaterThan(300)
    expect(a[0].decimated).toBe(false)
    // an unrelated edit keeps the history (same probe, same hole)
    co.load(bench([probe('P1', 'top+5'), { id: 'R9', type: 'resistor', holes: ['a40', 'a44'] }]), 2)
    co.advance(0.001)
    expect(scope(co).traces[0].t[0]).toBe(a[0].t[0])
    // the probe moved to the 5 V rail: the old samples are not this source
    const tMove = co.time
    co.load(bench([probe('P1', 'bot+5')]), 3)
    co.advance(0.005)
    const b = scope(co).traces[0]
    expect(b.t[0]).toBeGreaterThan(tMove)
    for (const v of b.v) expect(v).toBeCloseTo(5, 3)
    // removed: no trace at all (nothing stale is drawn for an unattached channel)
    co.load(bench([]), 4)
    co.advance(0.002)
    expect(scope(co).traces).toEqual([])
    co.dispose()
  })

  it('flags min/max decimation per trace', () => {
    const co = new SimulationCoordinator()
    co.load(bench([probe('P1', 'top+5')]), 1)
    co.advance(0.05)
    expect(scope(co, 0, co.time, 64).traces[0].decimated).toBe(true)
    expect(scope(co, 0, co.time, 1e6).traces[0].decimated).toBe(false)
    const ring = new SampleRing(16)
    for (let i = 0; i < 10; i++) ring.push(i, i)
    expect(ring.capture(0, 9, 4).decimated).toBe(true)
    expect(ring.capture(0, 9).decimated).toBe(false)
    co.dispose()
  })

  it("'scope-trigger' finds the crossing on the full-resolution recording (not on a decimated capture)", () => {
    const co = new SimulationCoordinator()
    co.load(bench([probe('P1', 'top+5', 2)]), 1)
    co.advance(0.035)
    const full = scope(co).traces.find((t) => t.index === 1)!
    const expectedAll = findScopeTriggers(full.t, full.v, { level: 2.5, slope: 'rising', from: 0, to: co.time })
    // a 100 Hz sine rising through its offset every 10 ms (sampled at 50 µs steps;
    // the start at t = 0 is not a crossing: the first sample is already above)
    expect(expectedAll.length).toBe(3)
    for (let k = 1; k < expectedAll.length; k++) expect(expectedAll[k] - expectedAll[k - 1]).toBeCloseTo(0.01, 6)
    const last = co.query({ kind: 'scope-trigger', channel: 1, level: 2.5, slope: 'rising', t0: 0, t1: co.time })
    expect(last).toEqual({ kind: 'scope-trigger', t: expectedAll[expectedAll.length - 1], tNow: co.time })
    const first = co.query({ kind: 'scope-trigger', channel: 1, level: 2.5, slope: 'rising', t0: 0, t1: co.time, pick: 'first' })
    expect(first.kind === 'scope-trigger' && first.t).toBe(expectedAll[0])
    // holdoff longer than the period: every other crossing
    const held = co.query({ kind: 'scope-trigger', channel: 1, level: 2.5, slope: 'rising', t0: 0, t1: co.time, holdoff: 0.015, pick: 'last' })
    expect(held.kind === 'scope-trigger' && held.t).toBe(expectedAll[2])
    // nothing to trigger on: an absent probe channel, or a level the sine never reaches
    expect(co.query({ kind: 'scope-trigger', channel: 3, level: 2.5, slope: 'rising', t0: 0, t1: co.time })).toMatchObject({ t: null })
    expect(co.query({ kind: 'scope-trigger', channel: 1, level: 7, slope: 'rising', t0: 0, t1: co.time })).toMatchObject({ t: null })
    co.dispose()
  })
})

describe('logic recorder: source changes clear the ring; since / tNow', () => {
  const ch = (source: LogicChannelConfig['source'], index = 0): LogicChannelConfig => ({ index, label: `D${index}`, source })

  it('a new source starts a fresh history at its bind time; the same source keeps it', () => {
    const co = new SimulationCoordinator()
    co.load(bench([]), 1)
    co.setLogicChannels([ch({ kind: 'net', ref: 'bot+0' })]) // 5 V → 1
    co.advance(0.004)
    let cap = logic(co)
    expect(cap.tNow).toBe(co.time)
    expect(cap.traces[0].since).toBe(0)
    expect(cap.traces[0].levels[0]).toBe(1)
    const firstEdge = cap.traces[0].times[0]

    // re-sending the same configuration (e.g. after an unrelated edit) keeps the history
    co.setLogicChannels([ch({ kind: 'net', ref: 'bot+0' })])
    co.load(bench([]), 2)
    co.advance(0.002)
    cap = logic(co)
    expect(cap.traces[0].since).toBe(0)
    expect(cap.traces[0].times[0]).toBe(firstEdge)

    // another net: the history of the old net is gone, since = bind time
    const tBind = co.time
    co.setLogicChannels([ch({ kind: 'net', ref: 'bot-0' })]) // ground → 0
    co.advance(0.002)
    cap = logic(co)
    const tr = cap.traces[0]
    expect(tr.since).toBeCloseTo(tBind, 12)
    expect(tr.initial).toBe(2) // nothing known before the bind
    expect(tr.times.length).toBe(1)
    expect(tr.times[0]).toBe(tr.since) // the new source's level from its bind time on
    expect(Array.from(tr.levels)).toEqual([0])
    expect(cap.tNow).toBe(co.time)
    co.dispose()
  })

  it('a removed channel forgets its source; a power cycle re-binds every channel at t = 0', () => {
    const co = new SimulationCoordinator()
    co.load(bench([]), 1)
    co.setLogicChannels([ch({ kind: 'net', ref: 'bot+0' })])
    co.advance(0.002)
    co.setLogicChannels([])
    co.advance(0.001)
    const tBack = co.time
    co.setLogicChannels([ch({ kind: 'net', ref: 'bot+0' })])
    // (pure analog worlds step in whole DEFAULT_DT steps: the solver clock may sit 1 ulp past tNow)
    const back = logic(co, 0, co.time + 1e-12).traces[0]
    expect(back.since).toBeCloseTo(tBack, 12)
    expect(back.times.length).toBe(1) // only the bind-time level, the earlier history is gone
    co.reset()
    co.advance(0.001)
    const tr = logic(co).traces[0]
    expect(tr.since).toBe(0)
    for (const t of tr.times) expect(t).toBeLessThan(0.001) // a fresh history from t = 0
    expect(tr.levels[tr.levels.length - 1]).toBe(1)
    co.dispose()
  })
})
