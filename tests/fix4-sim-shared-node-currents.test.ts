/**
 * 顯示電流 — pins of ONE device on the SAME node (review 4, SIM-1).
 *
 * The stamps name nodes, not pins, so they cannot split a node's current
 * between two pins of one device there. The tracker used to share it
 * equally — a guess: a DIP switch's seven OPEN switches drew 1.2 mA each
 * through their rail jumpers, a rheostat's dead ccw lead carried half the
 * current. Now such a device books its own terminal currents
 * (AnalogDevice.terminalCurrents, the same linearization as its stamp); a
 * device without that hook publishes unknown — never a share. Only legs the
 * catalog joins inside the part (internalBridges) are one conductor.
 *
 *  - the reviewer's DIP-switch and rheostat repros, the DIP's B side on 0 V,
 *    a diode-connected transistor (current mirror), an optocoupler with
 *    cathode and emitter on 0 V, a slide switch with a and b tied, an RGB
 *    LED with its three dies tied;
 *  - the tracker on its own: no hook → unknown, an exact 0 stays 0, bridged
 *    legs share, a hook splits the node's exact total, a partial hook's open
 *    terminal takes the remainder;
 *  - every hook IS its stamp: in every bundled circuit (with firmware) and
 *    every circuit above, each device's terminalCurrents summed per node
 *    equals what its recorded stamps put on that node.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { SimEngine } from '../src/sim/engine'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { CurrentTracker } from '../src/sim/coordinator/current-tracker'
import type { TrackedDevice } from '../src/sim/coordinator/current-tracker'
import type { StampContext } from '../src/sim/mna'
import type { AnalogDevice } from '../src/sim/devices'
import { loadFirmwareFile } from '../src/mcu/loader'
import { parseProject } from '../src/state/project'
import { validateLayout } from '../src/model/validate'
import { LESSONS } from '../src/lessons'
import { lessonCircuitInput } from '../src/lessons/engine/evaluate'
import type { CircuitLayout, SimTelemetry, Wire } from '../src/model/types'
import { buildNetlist } from '../src/sim/netlist'
import { componentPinHoles, formatHole } from '../src/model/breadboard'
import { boardConfigOf } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { altHole, dip, entryOf, layout, leads, pinHole, twoLead } from './helpers'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = (id: string, from: string, to: string): Wire => ({ id, from, to })
const supply = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }
const RAILS = [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0')]

/** Settle, then the mean currents of a fresh window (SimEngine, tracking on). */
function steady(l: CircuitLayout, settle = 0.02): SimTelemetry {
  const e = new SimEngine(l)
  e.trackCurrents = true
  e.advance(settle)
  e.telemetry()
  e.advance(0.01)
  return e.telemetry()
}

/**
 * The loops close (1 µA, flow-kcl's tolerance): every wire known, nothing
 * concealed, each part's and each net's pin currents sum to ≈ 0.
 */
function kclFailures(l: CircuitLayout, t: SimTelemetry): string[] {
  const bad: string[] = []
  for (const w of l.wires) if (!Number.isFinite(t.wireCurrents?.[w.id] ?? NaN)) bad.push(`wire ${w.id} unknown`)
  if (t.flowConcealed) bad.push(`concealed ${t.flowConcealed.join(', ')}`)
  const nl = buildNetlist(l)
  const board = boardConfigOf(l)
  const perNet = new Map<string, number>()
  for (const c of l.components) {
    const e = getEntry(c.type)
    const p = t.components[c.id]?.pinCurrents
    if (!e || !p) continue
    let sum = 0
    const holes = e.placement === 'offboard' ? null : componentPinHoles(c, e, board)
    e.pins.forEach((pin, k) => {
      const i = p[pin]
      if (typeof i !== 'number') return
      sum += i
      const key = holes ? (holes[k] ? formatHole(holes[k]!) : null) : `${c.id}:${pin}`
      const net = key ? nl.netOf(key) : null
      if (net) perNet.set(net, (perNet.get(net) ?? 0) + i)
    })
    if (Math.abs(sum) > 1e-6) bad.push(`part ${c.id}: pins sum ${sum}`)
  }
  for (const [net, s] of perNet) if (Math.abs(s) > 1e-6) bad.push(`net ${net}: pins sum ${s}`)
  return bad
}

const pc = (t: SimTelemetry, id: string): Record<string, number> => {
  const p = t.components[id]?.pinCurrents
  if (!p) throw new Error(`${id}: no pinCurrents`)
  return p
}

// ------------------------------------------------------------- circuits

/** The reviewer's repro: every nA strip jumpered to the + rail, only switch 1 on, driving 330 Ω + a red LED. */
function dipCommonsOnRail(): CircuitLayout {
  const sw = dip('S1', 'dip_switch_8', 'f10')
  const e = entryOf('dip_switch_8')
  const wires = [...RAILS]
  for (let n = 1; n <= 8; n++) wires.push(W(`w${n}A`, altHole(pinHole(sw, e, `${n}A`), 3), `bot+${n + 1}`))
  return layout(
    [
      supply,
      { ...sw, params: { on: '10000000' } },
      twoLead('R1', 'resistor', altHole(pinHole(sw, e, '1B'), 0), 'i40', { resistance: 330 }),
      twoLead('D1', 'led', 'j40', 'j44', { color: 'red' }),
    ],
    [...wires, W('wk', 'i44', 'bot-3'), W('wg', 'top-1', 'bot-1'), W('wv', 'top+1', 'bot+1')],
  )
}

/** The DIP's eight B strips on the − rail (0 V); switch 3 on, its A strip fed through 1 kΩ. */
function dipBSideOnGround(): CircuitLayout {
  const sw = dip('S1', 'dip_switch_8', 'f10')
  const e = entryOf('dip_switch_8')
  const wires = [...RAILS]
  for (let n = 1; n <= 8; n++) wires.push(W(`w${n}B`, altHole(pinHole(sw, e, `${n}B`), 0), `top-${n + 1}`))
  return layout(
    [supply, { ...sw, params: { on: '00100000' } }, twoLead('R1', 'resistor', altHole(pinHole(sw, e, '3A'), 3), 'top+3', { resistance: 1000 })],
    wires,
  )
}

/** The reviewer's rheostat: wiper jumpered to ccw, cw on +5 V, ccw feeding 100 Ω + a red LED. */
function rheostat(): CircuitLayout {
  return layout(
    [
      supply,
      leads('RV1', 'potentiometer', ['e10', 'e12', 'e14'], { resistance: 1000, position: 0.5 }),
      twoLead('R1', 'resistor', 'a10', 'a20', { resistance: 100 }),
      twoLead('D1', 'led', 'b20', 'b24', { color: 'red' }),
    ],
    [...RAILS, W('wcw', 'top+5', 'a14'), W('wj', 'c12', 'c10'), W('wk', 'c24', 'top-4')],
  )
}

/** A current mirror: Q1 diode-connected (base tied to collector) on 4.7 kΩ, Q2 mirrors it into 1 kΩ. */
function currentMirror(): CircuitLayout {
  return layout(
    [
      supply,
      leads('Q1', 'npn', ['e10', 'e11', 'e12']),
      leads('Q2', 'npn', ['e20', 'e21', 'e22']),
      twoLead('R1', 'resistor', 'top+3', 'c12', { resistance: 4700 }),
      twoLead('R2', 'resistor', 'top+4', 'c22', { resistance: 1000 }),
    ],
    [...RAILS, W('we1', 'a10', 'top-1'), W('we2', 'a20', 'top-2'), W('wbc', 'a11', 'a12'), W('wbb', 'b11', 'a21')],
  )
}

/**
 * PC817 (CTR 300 %) on the low side: LED through 1 kΩ, collector through
 * 100 Ω (active region: IC = 3·IF); cathode AND emitter on the − rail.
 */
function optoLowSide(): CircuitLayout {
  const u = { ...dip('U1', 'pc817', 'f30'), params: { ctr: 300 } }
  const e = entryOf('pc817')
  const t = (p: string) => altHole(pinHole(u, e, p), 2)
  return layout(
    [
      supply,
      u,
      twoLead('R1', 'resistor', 'top+5', t('anode'), { resistance: 1000 }),
      twoLead('R2', 'resistor', 'top+6', t('collector'), { resistance: 100 }),
    ],
    [...RAILS, W('wk', altHole(pinHole(u, e, 'cathode'), 3), 'top-5'), W('we', altHole(pinHole(u, e, 'emitter'), 3), 'top-6')],
  )
}

/** Slide switch at 'a' with a and b both on the − rail; common fed through 1 kΩ. */
function slideTied(): CircuitLayout {
  return layout(
    [supply, leads('S1', 'slide_switch', ['e40', 'e41', 'e42'], { state: 'a' }), twoLead('R1', 'resistor', 'top+7', 'c41', { resistance: 1000 })],
    [...RAILS, W('wa', 'a40', 'top-7'), W('wb', 'a42', 'top-8')],
  )
}

/** Common-cathode RGB LED with R, G and B tied together behind one 220 Ω: each die takes its own current. */
function rgbTied(): CircuitLayout {
  return layout(
    [supply, { id: 'D1', type: 'rgb_led', holes: ['e50', 'e51', 'e52', 'e53'] }, twoLead('R1', 'resistor', 'top+9', 'c50', { resistance: 220 })],
    [...RAILS, W('wc', 'a51', 'top-9'), W('wrg', 'a50', 'a52'), W('wgb', 'b52', 'a53')],
  )
}

// ---------------------------------------------------------------- exact

describe('pins of one device on one node carry their own currents, never a share', () => {
  it('DIP switch, commons on the + rail (the review repro): only switch 1 and its jumper carry the LED current', () => {
    const l = dipCommonsOnRail()
    const t = steady(l)
    expect(t.issues.filter((i) => i.level === 'error')).toEqual([])
    const s = pc(t, 'S1')
    const iLed = -s['1B']
    expect(iLed).toBeGreaterThan(0.009) // ≈ 9.7 mA through 330 Ω + red LED
    expect(s['1A']).toBeCloseTo(iLed, 9)
    for (let n = 2; n <= 8; n++) {
      // an open switch: G_OFF leakage only (nA), not 1.2 mA
      expect(Math.abs(s[`${n}A`]), `${n}A`).toBeLessThan(1e-7)
      expect(Math.abs(s[`${n}B`]), `${n}B`).toBeLessThan(1e-7)
      expect(Math.abs(t.wireCurrents![`w${n}A`]), `w${n}A`).toBeLessThan(1e-7)
    }
    expect(Math.abs(t.wireCurrents!.w1A)).toBeCloseTo(iLed, 6)
    expect(t.flowConcealed).toBeUndefined()
    expect(kclFailures(l, t)).toEqual([])
  })

  it('DIP switch, B side on 0 V: the closed switch returns its current through its own B pin (the 0 V residual is not shared)', () => {
    const l = dipBSideOnGround()
    const t = steady(l)
    const s = pc(t, 'S1')
    expect(-s['3B']).toBeCloseTo(5 / 1000.05, 5)
    expect(s['3A']).toBeCloseTo(-s['3B'], 9)
    for (const n of [1, 2, 4, 5, 6, 7, 8]) {
      expect(Math.abs(s[`${n}B`]), `${n}B`).toBeLessThan(1e-7)
      expect(Math.abs(t.wireCurrents![`w${n}B`]), `w${n}B`).toBeLessThan(1e-7)
    }
    expect(Math.abs(t.wireCurrents!.w3B)).toBeCloseTo(5 / 1000.05, 5)
    expect(t.flowConcealed).toBeUndefined()
    expect(kclFailures(l, t)).toEqual([])
  })

  it('rheostat (the review repro): the shorted half carries nothing, the wiper jumper the whole current', () => {
    const l = rheostat()
    const t = steady(l)
    const rv = pc(t, 'RV1')
    const i = rv.cw
    expect(i).toBeGreaterThan(0.005)
    expect(rv.ccw).toBe(0) // its track half has 0 V across it
    expect(rv.wiper).toBeCloseTo(-i, 12)
    expect(t.wireCurrents!.wj).toBeCloseTo(i, 6) // c12 → c10: the whole current, not half
    expect(Math.abs(t.stripCurrents?.['c10>e10'] ?? 0)).toBeLessThan(1e-7) // the dead ccw lead
    expect(t.flowConcealed).toBeUndefined()
    expect(kclFailures(l, t)).toEqual([])
  })

  it('diode-connected transistor (current mirror): Q1’s collector and base are told apart (β = 150), the B–C jumper carries only the base currents', () => {
    const l = currentMirror()
    const t = steady(l)
    const q1 = pc(t, 'Q1')
    const q2 = pc(t, 'Q2')
    const iRef = pc(t, 'R1').p1 // into R1 from the + rail
    expect(iRef).toBeGreaterThan(0.0008)
    expect(q1.collector / q1.base).toBeGreaterThan(148)
    expect(q1.collector / q1.base).toBeLessThan(152)
    expect(q1.emitter).toBeCloseTo(-(q1.collector + q1.base), 12)
    expect(q2.base).toBeCloseTo(q1.base, 7) // the same VBE
    expect(q1.collector + q1.base + q2.base).toBeCloseTo(iRef, 8) // (GMIN: 1 nS per node)
    // the jumper base ↔ collector carries IB1 + IB2 (≈ 12 µA), not half the reference current
    expect(Math.abs(t.wireCurrents!.wbc)).toBeCloseTo(q1.base + q2.base, 8)
    expect(t.flowConcealed).toBeUndefined()
    expect(kclFailures(l, t)).toEqual([])
  })

  it('optocoupler with cathode and emitter on 0 V: the LED current returns at the cathode, the output current at the emitter', () => {
    const l = optoLowSide()
    const t = steady(l)
    const u = pc(t, 'U1')
    expect(t.issues).toEqual([])
    expect(u.anode).toBeGreaterThan(0.0035) // ≈ 3.9 mA through 1 kΩ
    expect(u.collector / u.anode).toBeCloseTo(3, 3) // CTR 300 %, active
    expect(u.cathode).toBeCloseTo(-u.anode, 12)
    expect(u.emitter).toBeCloseTo(-u.collector, 12)
    expect(t.flowConcealed).toBeUndefined()
    expect(kclFailures(l, t)).toEqual([])
  })

  it('slide switch with a and b tied to 0 V: only the closed contact returns the current', () => {
    const l = slideTied()
    const t = steady(l)
    const s = pc(t, 'S1')
    expect(-s.a).toBeCloseTo(5 / 1000.05, 5)
    expect(Math.abs(s.b)).toBeLessThan(1e-7)
    expect(s.common).toBeCloseTo(-s.a, 9)
    expect(Math.abs(t.wireCurrents!.wb)).toBeLessThan(1e-7)
    expect(kclFailures(l, t)).toEqual([])
  })

  it('relay with COM tied to COIL1: COIL1 carries the coil current, COM the load current', () => {
    const l = relayComOnCoil()
    const t = steady(l, 0.05)
    const k = pc(t, 'K1')
    const coil = t.components.K1.values!.icoil
    expect(t.components.K1.values!.no).toBe(1)
    expect(k.COIL1).toBeCloseTo(coil, 9) // ≈ 71 mA through 70 Ω
    expect(k.COIL2).toBeCloseTo(-coil, 9)
    expect(k.COM).toBeCloseTo(5 / 100.05, 4) // ≈ 50 mA through NO and 100 Ω
    expect(k.NO).toBeCloseTo(-k.COM, 7) // (the open NC contact leaks nA)
    expect(kclFailures(l, t)).toEqual([])
  })

  it('modules with pins tied to their own supply pins (joystick SW on GND, ACS712 IP− on GND, driver logic on VM / VCC): closed loops, nothing concealed', () => {
    for (const l of zooModules()) {
      const t = steady(l, 0.03)
      expect(kclFailures(l, t), l.name).toEqual([])
    }
    const [js, cs] = zooModules()
    const tj = steady(js, 0.03)
    const j = pc(tj, 'J1')
    expect(j.SW).toBe(0) // the closed SW contact has 0 V across it
    expect(j.VRX).toBeLessThan(-0.0001) // the wiper feeds its 10 kΩ load …
    expect(j.GND).toBeCloseTo(-(j.VCC + j.VRX + j.VRY), 12) // … and GND returns the rest, SW nothing
    const tc = steady(cs, 0.03)
    const a = pc(tc, 'CS1')
    expect(a['IP+']).toBeCloseTo(0.5, 2) // ≈ 0.5 A through the primary
    expect(a['IP-']).toBeCloseTo(-a['IP+'], 12) // … and out at IP−, not shared with GND
    expect(a.GND).toBeCloseTo(-(a.VCC + a.OUT), 7) // (its power LED's internal node leaks GMIN: nA)
  })

  it('RGB LED with R, G and B tied: each pin carries its own die’s current (the red die takes most)', () => {
    const l = rgbTied()
    const t = steady(l)
    const p = pc(t, 'D1')
    const v = t.components.D1.values!
    expect(p.R).toBeGreaterThan(0.005)
    expect(p.R).toBeCloseTo(v.iR, 5) // a steady die: its eye mean is its current
    expect(p.G).toBeCloseTo(v.iG, 7)
    expect(p.B).toBeCloseTo(v.iB, 7)
    expect(p.R).toBeGreaterThan(100 * p.G) // 1.95 V vs 3.1 V dies on one node
    expect(p.COM).toBeCloseTo(-(p.R + p.G + p.B), 12)
    expect(kclFailures(l, t)).toEqual([])
  })
})

// ----------------------------------------------------------- the tracker alone

/** A stamp target that ignores everything (the tracker only reads its recorder). */
const SINK: StampContext = {
  nodeCount: 2,
  addElement() {},
  addConductance() {},
  addCurrent() {},
  addNorton() {},
}

/**
 * Device A: pins p0, p1 on node 0 (or 0 V), p2 on node 1; two branches
 * p0→p2 (3 mS) and p1→p2 (1 mS) at 1 V. Device B closes the loop with an
 * equal and opposite current, so every node satisfies KCL.
 */
function twoBranches(a: Partial<TrackedDevice>, stampA?: (rec: StampContext) => void, nodesA = [0, 0, 1]): number[] {
  const devA: TrackedDevice = { nodes: nodesA, slots: [0, 1, 2], ...a }
  const nB0 = nodesA[0]
  const devB: TrackedDevice = { nodes: [nB0, 1], slots: [3, 4] }
  const tr = new CurrentTracker(SINK, [devA, devB], [], 5)
  const x = Float64Array.of(nB0 === 0 ? 1 : 0, nB0 === 0 ? 0 : -1)
  const rec = tr.recorder
  rec.begin(SINK)
  rec.owner = 0
  if (stampA) stampA(rec)
  else {
    rec.addConductance(nodesA[0], 1, 0.003)
    rec.addConductance(nodesA[1], 1, 0.001)
  }
  rec.owner = 1
  rec.addCurrent(1, -0.004) // B pushes the 4 mA back
  if (nB0 >= 0) rec.addCurrent(nB0, 0.004)
  rec.owner = -1
  tr.accumulate(x, 1e-3)
  return Array.from(tr.drain()!.pins)
}

describe('CurrentTracker: a node holding two terminals of one device', () => {
  const hook = (p0: number, p1: number): TrackedDevice['terminalCurrents'] => (_x, out, off) => {
    out[off] += p0
    out[off + 1] += p1
    out[off + 2] -= (Number.isFinite(p0) ? p0 : 0) + (Number.isFinite(p1) ? p1 : 0)
  }

  it('without a hook its pins there are unknown (never an equal share)', () => {
    const pins = twoBranches({})
    expect(pins[0]).toBeNaN()
    expect(pins[1]).toBeNaN()
  })

  it('without a hook an exact 0 stays 0 (a part shorted by its own strip carries nothing)', () => {
    expect(twoBranchesBalanced()).toEqual([0, 0, 0, 0, 0])
  })

  it('legs of one internal conductor (internalBridges) share it — one terminal, no hook needed', () => {
    const pins = twoBranches({ terminal: [0, 0, 2] })
    expect(pins[0]).toBeCloseTo(0.002, 15)
    expect(pins[1]).toBeCloseTo(0.002, 15)
    expect(pins[2]).toBeCloseTo(-0.004, 15)
  })

  it('a hook splits the node’s exact total', () => {
    const pins = twoBranches({ terminalCurrents: hook(0.003, 0.001) })
    expect(pins[0]).toBeCloseTo(0.003, 15)
    expect(pins[1]).toBeCloseTo(0.001, 15)
    expect(pins[2]).toBeCloseTo(-0.004, 15)
    expect(pins[3]).toBeCloseTo(-0.004, 15)
  })

  it('a partial hook: its one open terminal takes the rest of the node (KCL); two open terminals are unknown', () => {
    const one = twoBranches({ terminalCurrents: hook(0.003, NaN) })
    expect(one[0]).toBeCloseTo(0.003, 15)
    expect(one[1]).toBeCloseTo(0.001, 15)
    const two = twoBranches({ terminalCurrents: hook(NaN, NaN) })
    expect(two[0]).toBeNaN()
    expect(two[1]).toBeNaN()
  })

  it('on the 0 V node: without a hook unknown, with one exact', () => {
    const noHook = twoBranches({}, undefined, [-1, -1, 1])
    expect(noHook[0]).toBeNaN()
    expect(noHook[1]).toBeNaN()
    const withHook = twoBranches({ terminalCurrents: hook(0.003, 0.001) }, undefined, [-1, -1, 1])
    expect(withHook[0]).toBeCloseTo(0.003, 15)
    expect(withHook[1]).toBeCloseTo(0.001, 15)
    expect(withHook[2]).toBeCloseTo(-0.004, 15)
    expect(withHook[3]).toBeCloseTo(-0.004, 15)
  })
})

/** Device A with both ends of a conductance on node 0 (carries nothing); B idle: every pin is an exact 0. */
function twoBranchesBalanced(): number[] {
  const devA: TrackedDevice = { nodes: [0, 0, 1], slots: [0, 1, 2] }
  const devB: TrackedDevice = { nodes: [0, 1], slots: [3, 4] }
  const tr = new CurrentTracker(SINK, [devA, devB], [], 5)
  const rec = tr.recorder
  rec.begin(SINK)
  rec.owner = 0
  rec.addConductance(0, 0, 5)
  rec.owner = -1
  tr.accumulate(Float64Array.of(1, 0), 1e-3)
  return Array.from(tr.drain()!.pins)
}

// --------------------------------------------------- every hook is its stamp

const K_ELEMENT = 0
const K_CONDUCT = 1
const K_CURRENT = 2

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Compare, at every `every`-th tracked step, each device's terminalCurrents
 * (summed per node) with what its recorded stamps put on that node.
 * Mismatches go to `bad`; `seen` collects the device classes checked.
 */
function watchHooks(engine: any, bad: string[], seen: Set<string>, every = 5): void {
  const tr = engine.tracker
  const devices = engine.devices as AnalogDevice[]
  const orig = tr.accumulate.bind(tr)
  let step = 0
  tr.accumulate = (x: Float64Array, dt: number) => {
    if (step++ % every === 0) compareHooks(tr, devices, x, bad, seen)
    orig(x, dt)
  }
}

function compareHooks(tr: any, devices: AnalogDevice[], x: Float64Array, bad: string[], seen: Set<string>): void {
  const rec = tr.recorder
  const sum = new Map<string, number>()
  const mag = new Map<string, number>()
  const add = (e: number, node: number, i: number) => {
    if (node < 0) return
    const k = `${e}:${node}`
    sum.set(k, (sum.get(k) ?? 0) + i)
    mag.set(k, (mag.get(k) ?? 0) + Math.abs(i))
  }
  for (let j = 0; j < rec.count; j++) {
    const e = rec.own[j]
    const r = rec.row[j]
    const c = rec.col[j]
    const v = rec.val[j]
    if (rec.kind[j] === K_ELEMENT) add(e, r, v * (c >= 0 ? x[c] : 0))
    else if (rec.kind[j] === K_CURRENT) add(e, r, -v)
    else if (rec.kind[j] === K_CONDUCT) {
      const i = v * ((r >= 0 ? x[r] : 0) - (c >= 0 ? x[c] : 0))
      add(e, r, i)
      add(e, c, -i)
    }
  }
  for (let e = 0; e < devices.length; e++) {
    const d = devices[e]
    if (typeof d.terminalCurrents !== 'function') continue
    seen.add(d.constructor.name)
    const s = tr.devStart[e]
    const n = tr.devStart[e + 1] - s
    const out = new Float64Array(n)
    d.terminalCurrents(x, out, 0)
    const hook = new Map<number, number>()
    for (let p = 0; p < n; p++) {
      const node = tr.devNode[s + p]
      if (node < 0) continue
      hook.set(node, (hook.get(node) ?? 0) + out[p])
    }
    const nodes = new Set<number>(hook.keys())
    for (const k of sum.keys()) if (k.startsWith(`${e}:`)) nodes.add(Number(k.slice(k.indexOf(':') + 1)))
    for (const node of nodes) {
      const a = hook.get(node) ?? 0
      const b = sum.get(`${e}:${node}`) ?? 0
      const tol = 1e-12 + 1e-9 * (mag.get(`${e}:${node}`) ?? 0)
      if (!(Math.abs(a - b) <= tol)) bad.push(`${d.comp.id} (${d.constructor.name}) node ${node}: hook ${a} vs stamps ${b}`)
    }
  }
}

interface Case {
  name: string
  layout: CircuitLayout
  firmware: { id: string; name: string; bytes: Uint8Array }[]
}

/** A free hole on a footprint pin's strip, away from the body (row a / j; `second` → b / i). */
function far(comp: { id: string; type: string; at?: string }, pin: string, second = false): string {
  const h = pinHole(comp as never, entryOf(comp.type), pin)
  const top = h[0] <= 'e'
  return `${top ? (second ? 'b' : 'a') : second ? 'i' : 'j'}${h.slice(1)}`
}

/** A footprint part anchored at its pin-1 row, column `col`. */
function at(id: string, type: string, col: number): { id: string; type: string; at: string } {
  const row = entryOf(type).footprintOffsets?.[0]?.row ?? 'f'
  return { id, type, at: `${row}${col}` }
}

/** Every leaded / off-board device model the bundled content lacks, each at a real operating point. */
function zooLeads(): CircuitLayout {
  const R = (id: string, a: string, b: string, ohms: number) => twoLead(id, 'resistor', a, b, { resistance: ohms })
  const dmm = (id: string, mode: string) => ({ id, type: 'multimeter', params: { mode } })
  return layout(
    [
      supply,
      leads('N1', 'nmos', ['e10', 'e11', 'e12']),
      R('RG1', 'top+1', 'c11', 10_000),
      R('RD1', 'top+2', 'c12', 1000),
      leads('P1', 'pmos', ['e15', 'e16', 'e17']),
      R('RD2', 'c17', 'top-3', 1000),
      leads('M1', 'irlz44n', ['e20', 'e21', 'e22']),
      R('RG3', 'top+4', 'c20', 1000),
      R('RD3', 'top+5', 'c21', 100),
      leads('Q1', 'pnp', ['e25', 'e26', 'e27']),
      R('RB4', 'c26', 'top-5', 10_000),
      R('RC4', 'c27', 'top-6', 1000),
      leads('Z1', 'zener', ['e30', 'e31']),
      R('RZ', 'top+7', 'c31', 330),
      leads('L1', 'inductor', ['e33', 'e34']),
      R('RL', 'top+8', 'c33', 100),
      leads('BZ1', 'buzzer', ['e36', 'e37']),
      leads('TH1', 'ntc_10k', ['e39', 'e40']),
      R('RT', 'c40', 'top-10', 10_000),
      leads('D1', 'diode', ['e42', 'e43']),
      R('RDd', 'top+11', 'c42', 1000),
      { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1000, amplitude: 2.5, offset: 2.5 } },
      R('RF', 'c45', 'top-12', 1000),
      dmm('DMMV', 'V'),
      { id: 'BAT1', type: 'battery_9v' },
      R('RB', 'c50', 'c52', 1000),
      dmm('DMMA', 'A'),
      R('RO', 'e55', 'e57', 1000),
      dmm('DMMO', 'Ω'),
      { id: 'IS1', type: 'current_source' },
      R('RI', 'c59', 'top-17', 1000),
      { id: 'MOT1', type: 'dc_motor' },
      leads('U7', 'lm7805', ['f10', 'f11', 'f12']),
      R('RU', 'i12', 'top-21', 100),
      leads('LDR1', 'photoresistor', ['f20', 'f21']),
      R('RLD', 'i21', 'top-22', 10_000),
    ],
    [
      ...RAILS,
      W('n1s', 'a10', 'top-1'),
      W('p1s', 'a15', 'top+3'),
      W('p1g', 'a16', 'top-2'),
      W('m1s', 'a22', 'top-4'),
      W('q1e', 'a25', 'top+6'),
      W('z1a', 'a30', 'top-7'),
      W('l1b', 'a34', 'top-8'),
      W('bz+', 'a36', 'top+9'),
      W('bz-', 'a37', 'top-9'),
      W('th+', 'a39', 'top+10'),
      W('d1k', 'a43', 'top-11'),
      W('fgo', 'FG1:out', 'a45'),
      W('fgg', 'FG1:gnd', 'top-13'),
      W('dvi', 'DMMV:IN', 'b31'),
      W('dvc', 'DMMV:COM', 'top-14'),
      W('bat+', 'BAT1:+', 'a50'),
      W('bat-', 'BAT1:-', 'top-16'),
      W('dai', 'DMMA:IN', 'a52'),
      W('dac', 'DMMA:COM', 'top-15'),
      W('doi', 'DMMO:IN', 'a55'),
      W('doc', 'DMMO:COM', 'a57'),
      W('is+', 'IS1:+', 'a59'),
      W('is-', 'IS1:-', 'top-18'),
      W('m+', 'MOT1:M+', 'top+12'),
      W('m-', 'MOT1:M-', 'top-19'),
      W('u7i', 'j10', 'top+13'),
      W('u7g', 'j11', 'top-20'),
      W('ldr', 'j20', 'top+14'),
    ],
  )
}

/** The relay's COM tied to COIL1 on +5 V (one supply for coil and load): NO switches 100 Ω. */
function relayComOnCoil(): CircuitLayout {
  const k = at('K1', 'relay_5v', 20)
  return layout(
    [supply, k, twoLead('RN', 'resistor', far(k, 'NO'), 'top-2', { resistance: 100 })],
    [...RAILS, W('c1', far(k, 'COIL1'), 'top+1'), W('c2', far(k, 'COIL2'), 'top-1'), W('com', far(k, 'COM'), 'top+2')],
  )
}

/** The driver / sensor modules, each with logic or sense pins tied to its own supply pins. */
function zooModules(): CircuitLayout[] {
  const R = (id: string, a: string, b: string, ohms: number) => twoLead(id, 'resistor', a, b, { resistance: ohms })
  const js = { ...at('J1', 'joystick_xy', 30), params: { pressed: true } }
  const cs = at('CS1', 'acs712_5a', 30)
  const tb = at('TB1', 'tb6612fng_module', 30)
  const dv = at('DV1', 'drv8833_module', 30)
  const ss = at('SS1', 'seven_segment', 30)
  return [
    layout(
      [supply, js, R('RX', far(js, 'VRX'), 'top-2', 10_000)],
      [...RAILS, W('g', far(js, 'GND'), 'top-1'), W('v', far(js, 'VCC'), 'top+1'), W('sw', far(js, 'SW'), 'top-3')],
      'joystick SW on GND',
    ),
    layout(
      [supply, cs, R('RP', 'top+2', far(cs, 'IP+'), 10), R('RO', far(cs, 'OUT'), 'top-3', 10_000)],
      [...RAILS, W('v', far(cs, 'VCC'), 'top+1'), W('g', far(cs, 'GND'), 'top-1'), W('ipm', far(cs, 'IP-'), 'top-2')],
      'ACS712 on the low side',
    ),
    layout(
      [supply, tb, R('RM', far(tb, 'AO1', true), far(tb, 'AO2', true), 100)],
      [
        ...RAILS,
        W('vm', far(tb, 'VM'), 'top+1'),
        W('vcc', far(tb, 'VCC'), 'top+2'),
        W('g', far(tb, 'GND'), 'top-1'),
        W('pwma', far(tb, 'PWMA'), 'top+3'),
        W('ain1', far(tb, 'AIN1'), 'top+4'),
        W('stby', far(tb, 'STBY'), 'top+5'),
        W('ain2', far(tb, 'AIN2'), 'top-3'),
      ],
      'TB6612 driving 100 Ω',
    ),
    layout(
      [supply, dv, R('RM', far(dv, 'AOUT1', true), far(dv, 'AOUT2', true), 100)],
      [
        ...RAILS,
        W('vm', far(dv, 'VM'), 'top+1'),
        W('g', far(dv, 'GND'), 'top-1'),
        W('slp', far(dv, 'SLP'), 'top+2'),
        W('ain1', far(dv, 'AIN1'), 'top+3'),
        W('ain2', far(dv, 'AIN2'), 'top-2'),
      ],
      'DRV8833 driving 100 Ω',
    ),
    layout(
      [supply, ss, R('RS', 'top+1', far(ss, 'A', true), 330)],
      [...RAILS, W('com', far(ss, 'COM1'), 'top-1'), W('ab', far(ss, 'A'), far(ss, 'B'))],
      '7-segment A and B tied',
    ),
  ]
}

function bundled(): Case[] {
  const out: Case[] = []
  for (const f of readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).sort()) {
    const res = validateLayout(JSON.parse(readFileSync(join(ROOT, 'examples', f), 'utf8')))
    if (res.layout) out.push({ name: f, layout: res.layout, firmware: [] })
  }
  const dir = join(ROOT, 'examples/embedded')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ohmlet.json')).sort()) {
    const p = parseProject(readFileSync(join(dir, f), 'utf8'))
    if (!p.ok) throw new Error(`${f}: ${p.errors.join('; ')}`)
    out.push({ name: f, layout: p.project.layout, firmware: p.project.firmware.map((x) => ({ id: x.componentId, name: x.name, bytes: x.bytes })) })
  }
  return out
}

function runWatched(c: Case, seconds: number, bad: string[], seen: Set<string>): void {
  const co = new SimulationCoordinator()
  co.setCurrentTracking(true)
  co.load(c.layout, 1)
  for (const f of c.firmware) {
    const img = loadFirmwareFile(f.name, f.bytes)
    if (!img.ok) throw new Error(`${c.name}: ${img.error}`)
    co.setFirmware(f.id, img.image)
  }
  const engine = (co as any).eng
  expect(engine, c.name).toBeTruthy()
  const before = bad.length
  watchHooks(engine, bad, seen)
  while (co.time < seconds - 1e-12) co.advance(Math.min(0.005, seconds - co.time))
  co.frame()
  for (let k = before; k < bad.length; k++) bad[k] = `${c.name}: ${bad[k]}`
  co.dispose?.()
}

describe('every terminalCurrents hook is exactly its own stamp', () => {
  it('the shared-node circuits above', () => {
    const bad: string[] = []
    const seen = new Set<string>()
    for (const l of [dipCommonsOnRail(), dipBSideOnGround(), rheostat(), currentMirror(), optoLowSide(), slideTied(), rgbTied()]) {
      runWatched({ name: l.name ?? 'circuit', layout: l, firmware: [] }, 0.03, bad, seen)
    }
    expect(bad.slice(0, 20)).toEqual([])
    for (const cls of ['DipSwitch8Device', 'PotentiometerDevice', 'BjtDevice', 'OptocouplerDevice', 'SlideSwitchDevice', 'RgbLedDevice', 'LedDevice', 'ResistorDevice', 'PowerSupplyDevice']) {
      expect(seen.has(cls), cls).toBe(true)
    }
  })

  it('every other device model, at a real operating point (MOSFETs, PNP, zener, sources, meters, regulator, relay, modules)', () => {
    const bad: string[] = []
    const seen = new Set<string>()
    for (const l of [zooLeads(), relayComOnCoil(), ...zooModules()]) {
      const before = bad.length
      runWatched({ name: l.name ?? 'circuit', layout: l, firmware: [] }, 0.05, bad, seen)
      expect(bad.length, l.name).toBe(before)
    }
    expect(bad.slice(0, 20)).toEqual([])
    const want = [
      'NmosDevice',
      'MosfetDevice',
      'BjtDevice',
      'ZenerDevice',
      'InductorDevice',
      'BuzzerDevice',
      'NtcDevice',
      'DiodeDevice',
      'FunctionGeneratorDevice',
      'MultimeterDevice',
      'BatteryDevice',
      'CurrentSourceDevice',
      'DcMotorDevice',
      'QuiescentDevice',
      'LdoDevice',
      'RelayDevice',
      'JoystickDevice',
      'Acs712Device',
      'Tb6612Device',
      'Drv8833Device',
      'SevenSegmentDevice',
      'PhotoresistorDevice',
    ]
    for (const cls of want) expect(seen.has(cls), `${cls} (seen: ${[...seen].sort().join(', ')})`).toBe(true)
  })

  it('every bundled example and lesson solution, with its firmware', { timeout: 600_000 }, async () => {
    const bad: string[] = []
    const seen = new Set<string>()
    const cases = bundled()
    for (const lesson of LESSONS) {
      const input = await lessonCircuitInput(lesson.solution)
      cases.push({ name: `lesson ${lesson.id}`, layout: input.layout, firmware: Object.entries(input.firmware).map(([id, f]) => ({ id, name: f.name, bytes: f.bytes })) })
    }
    expect(cases.length).toBeGreaterThan(50)
    for (const c of cases) runWatched(c, 0.25, bad, seen)
    expect(bad.slice(0, 20)).toEqual([])
    // the hooks the bundled content exercises (the rest: the shared-node circuits above)
    for (const cls of ['LdoDevice', 'StepStickDevice', 'L298nDevice', 'Sg90Device', 'StepperDevice', 'CapacitorDevice', 'DiodeDevice', 'PushbuttonDevice', 'JumperResistorDevice']) {
      expect(seen.has(cls), `${cls} (seen: ${[...seen].sort().join(', ')})`).toBe(true)
    }
  })
})
