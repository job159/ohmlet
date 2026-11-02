/**
 * 顯示電流 — closed loops everywhere (F5). Every bundled circuit — the four
 * legacy examples (examples/*.json), every embedded example with its real
 * firmware (examples/embedded/*.ohmlet.json) and every lesson's reference
 * solution — runs with current tracking on; in three averaging windows (the
 * blink / 555 examples are lit in one and dark in another) the published
 * currents must satisfy Kirchhoff's current law where the learner looks:
 *
 *  - every wire's current is known (no net was hidden: all chip currents in
 *    bundled content are attributable);
 *  - per net, the pin currents sum to ≈ 0 (no current created or swallowed
 *    by a part — the old Norton bookkeeping made a 555's OUT current appear
 *    from nowhere);
 *  - per node (a used hole / an off-board terminal; a part's internally
 *    bridged pins count as one node), wires + strip metal + pins sum to ≈ 0;
 *  - per part, its pin currents sum to ≈ 0;
 *  - every supply's + wires carry exactly what its − wires carry back.
 *
 * TOLERANCE 1 µA: the solver's only unbooked current is its GMIN leak
 * (1 nS from every node to 0 V, mna.ts) — at most 0.1 µA in any bundled
 * circuit (measured) — plus float rounding. 1 µA is 5× below the flow
 * layer's visibility floor (MIN_SHOWN_A = 5 µA), so any loop break that
 * could show a particle fails, while the real chip loops are mA.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { loadFirmwareFile } from '../src/mcu/loader'
import { parseProject } from '../src/state/project'
import { validateLayout } from '../src/model/validate'
import { componentPinHoles, formatHole, parseHole, parseTerminalRef } from '../src/model/breadboard'
import { getEntry } from '../src/model/catalog'
import { boardConfigOf } from '../src/model/types'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { buildNetlist } from '../src/sim/netlist'
import { LESSONS } from '../src/lessons'
import { lessonCircuitInput } from '../src/lessons/engine/evaluate'
import { MIN_SHOWN_A } from '../src/three/internal/current-flow'
import { SimEngine } from '../src/sim/engine'
import { CurrentTracker, KCL_HIDE_A, nortonReturnPins } from '../src/sim/coordinator/current-tracker'
import type { TrackedChipDrives } from '../src/sim/coordinator/current-tracker'
import { CATALOG } from '../src/model/catalog'
import type { ComponentInstance, Wire } from '../src/model/types'
import { dip, dipPinHole, layout, supply5, twoLead } from './helpers'
import { bluePillWorld, tap } from './coordinator/worlds'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOL = 1e-6
/** The averaging windows [start, end] (s of simulated time): the 555 and the blink examples are lit in one and dark in another. */
const WINDOWS: [number, number][] = [
  [0.13, 0.15],
  [0.38, 0.4],
  [0.58, 0.6],
]

interface Case {
  name: string
  layout: CircuitLayout
  firmware: { id: string; name: string; bytes: Uint8Array }[]
}

/** Node key of an endpoint ref: canonical hole, or "ID:pin" for a terminal. */
function nodeKey(ref: string): string | null {
  const h = parseHole(ref)
  if (h) return formatHole(h)
  return parseTerminalRef(ref) ? ref : null
}

/** Every part pin of the layout: part, pin, node key. */
function pinNodes(l: CircuitLayout): { id: string; pin: string; key: string }[] {
  const out: { id: string; pin: string; key: string }[] = []
  const board = boardConfigOf(l)
  for (const c of l.components) {
    const e = getEntry(c.type)
    if (!e) continue
    if (e.placement === 'offboard') {
      for (const p of e.pins) out.push({ id: c.id, pin: p, key: `${c.id}:${p}` })
      continue
    }
    const holes = componentPinHoles(c, e, board)
    if (!holes) continue
    e.pins.forEach((p, i) => {
      const h = holes[i]
      if (h) out.push({ id: c.id, pin: p, key: formatHole(h) })
    })
  }
  return out
}

/** The KCL failures of one telemetry frame (empty = every loop closes). */
export function kclFailures(l: CircuitLayout, t: SimTelemetry, tol = TOL): string[] {
  const bad: string[] = []
  const fmt = (a: number) => `${(a * 1e3).toFixed(4)} mA`
  const wc = t.wireCurrents
  if (!wc) return ['no wireCurrents published']
  // every wire known
  for (const w of l.wires) {
    const a = nodeKey(w.from)
    const b = nodeKey(w.to)
    if (!a || !b) continue
    if (!(typeof wc[w.id] === 'number' && Number.isFinite(wc[w.id]))) bad.push(`wire ${w.id}: current unknown`)
  }
  const pins = pinNodes(l)
  // per part
  const perPart = new Map<string, number>()
  for (const p of pins) {
    const i = t.components[p.id]?.pinCurrents?.[p.pin]
    if (typeof i !== 'number') continue
    if (!Number.isFinite(i)) bad.push(`${p.id}.${p.pin}: non-finite`)
    perPart.set(p.id, (perPart.get(p.id) ?? 0) + i)
  }
  for (const [id, s] of perPart) if (Math.abs(s) > tol) bad.push(`part ${id}: pins sum ${fmt(s)}`)
  // per net (pins only)
  const nl = buildNetlist(l)
  const perNet = new Map<string, number>()
  for (const p of pins) {
    const i = t.components[p.id]?.pinCurrents?.[p.pin]
    const net = nl.netOf(p.key)
    if (typeof i !== 'number' || !net) continue
    perNet.set(net, (perNet.get(net) ?? 0) + i)
  }
  for (const [net, s] of perNet) if (Math.abs(s) > tol) bad.push(`net ${net}${net === nl.ground ? ' (0 V)' : ''}: pins sum ${fmt(s)}`)
  // per node: wires + strips + pins (a part's internally bridged pins are one node)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const c of l.components) {
    const e = getEntry(c.type)
    for (const [pa, pb] of e?.internalBridges ?? []) {
      const ka = pins.find((p) => p.id === c.id && p.pin === pa)?.key
      const kb = pins.find((p) => p.id === c.id && p.pin === pb)?.key
      if (ka && kb && find(ka) !== find(kb)) parent.set(find(ka), find(kb))
    }
  }
  const out = new Map<string, number>() // current LEAVING each node
  const add = (k: string, i: number) => {
    const r = find(k)
    out.set(r, (out.get(r) ?? 0) + i)
  }
  for (const w of l.wires) {
    const a = nodeKey(w.from)
    const b = nodeKey(w.to)
    const i = wc[w.id]
    if (!a || !b || typeof i !== 'number') continue
    add(a, i)
    add(b, -i)
  }
  for (const [key, i] of Object.entries(t.stripCurrents ?? {})) {
    const gt = key.indexOf('>')
    add(key.slice(0, gt), i)
    add(key.slice(gt + 1), -i)
  }
  for (const p of pins) {
    const i = t.components[p.id]?.pinCurrents?.[p.pin]
    if (typeof i === 'number') add(p.key, i)
  }
  for (const [k, s] of out) if (Math.abs(s) > tol) bad.push(`node ${k}: wires + strips + pins ${fmt(s)}`)
  // supplies: the + wires carry what the − wires carry back
  for (const c of l.components) {
    const e = getEntry(c.type)
    if (!e || e.placement !== 'offboard') continue
    const pair: [string, string] | null =
      c.type === 'power_supply' ? ['+', '-'] : c.type === 'function_generator' ? ['out', 'gnd'] : e.source ? [e.source.plus, e.source.minus] : null
    if (!pair) continue
    const [plus, minus] = pair
    let outPlus = 0
    let inMinus = 0
    for (const w of l.wires) {
      const i = wc[w.id]
      if (typeof i !== 'number') continue
      if (w.from === `${c.id}:${plus}`) outPlus += i
      if (w.to === `${c.id}:${plus}`) outPlus -= i
      if (w.to === `${c.id}:${minus}`) inMinus += i
      if (w.from === `${c.id}:${minus}`) inMinus -= i
    }
    if (Math.abs(outPlus - inMinus) > tol) bad.push(`supply ${c.id}: + wires ${fmt(outPlus)} out, − wires ${fmt(inMinus)} back`)
  }
  return bad
}

/**
 * The loops the flow layer would draw BROKEN in one frame: a node (used hole
 * / terminal; bridged pins are one node) where the SHOWN currents — known
 * wires, listed strips, published pins — do not balance while something
 * there is drawn (≥ MIN_SHOWN_A), i.e. particles appearing from or
 * vanishing into a dark rail; and a supply whose + wires and − wires are
 * not both shown and equal. Hidden (unknown) currents are simply not drawn.
 */
export function brokenLoops(l: CircuitLayout, t: SimTelemetry): string[] {
  const bad: string[] = []
  const fmt = (a: number) => `${(a * 1e3).toFixed(4)} mA`
  const wc = t.wireCurrents ?? {}
  const pins = pinNodes(l)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const c of l.components) {
    for (const [pa, pb] of getEntry(c.type)?.internalBridges ?? []) {
      const ka = pins.find((p) => p.id === c.id && p.pin === pa)?.key
      const kb = pins.find((p) => p.id === c.id && p.pin === pb)?.key
      if (ka && kb && find(ka) !== find(kb)) parent.set(find(ka), find(kb))
    }
  }
  const sum = new Map<string, number>()
  const peak = new Map<string, number>()
  const add = (k: string, i: number) => {
    if (!Number.isFinite(i)) return
    const r = find(k)
    sum.set(r, (sum.get(r) ?? 0) + i)
    peak.set(r, Math.max(peak.get(r) ?? 0, Math.abs(i)))
  }
  for (const w of l.wires) {
    const a = nodeKey(w.from)
    const b = nodeKey(w.to)
    const i = wc[w.id]
    if (!a || !b || typeof i !== 'number') continue
    add(a, i)
    add(b, -i)
  }
  for (const [key, i] of Object.entries(t.stripCurrents ?? {})) {
    const gt = key.indexOf('>')
    add(key.slice(0, gt), i)
    add(key.slice(gt + 1), -i)
  }
  for (const p of pins) {
    const i = t.components[p.id]?.pinCurrents?.[p.pin]
    if (typeof i === 'number') add(p.key, i)
  }
  for (const [k, s] of sum) {
    if ((peak.get(k) ?? 0) >= MIN_SHOWN_A && Math.abs(s) > MIN_SHOWN_A / 2) bad.push(`node ${k}: shown currents miss ${fmt(s)}`)
  }
  for (const c of l.components) {
    const e = getEntry(c.type)
    if (!e || e.placement !== 'offboard') continue
    const pair = c.type === 'power_supply' ? ['+', '-'] : e.source ? [e.source.plus, e.source.minus] : null
    if (!pair) continue
    const shown = (pin: string) => l.wires.filter((w) => w.from === `${c.id}:${pin}` || w.to === `${c.id}:${pin}`).map((w) => wc[w.id])
    const plus = shown(pair[0])
    const minus = shown(pair[1])
    const lit = [...plus, ...minus].some((i) => typeof i === 'number' && Math.abs(i) >= MIN_SHOWN_A)
    if (lit && [...plus, ...minus].some((i) => typeof i !== 'number')) bad.push(`supply ${c.id}: one side shown, the other hidden`)
  }
  return bad
}

function legacyCases(): Case[] {
  return readdirSync(join(ROOT, 'examples'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const res = validateLayout(JSON.parse(readFileSync(join(ROOT, 'examples', f), 'utf8')))
      if (!res.layout) throw new Error(`${f}: ${res.errors.join('; ')}`)
      return { name: `examples/${f}`, layout: res.layout, firmware: [] }
    })
}

function embeddedCases(): Case[] {
  const dir = join(ROOT, 'examples/embedded')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ohmlet.json'))
    .sort()
    .map((f) => {
      const p = parseProject(readFileSync(join(dir, f), 'utf8'))
      if (!p.ok) throw new Error(`${f}: ${p.errors.join('; ')}`)
      const firmware = p.project.firmware.map((x) => ({ id: x.componentId, name: x.name, bytes: x.bytes }))
      return { name: `examples/embedded/${f}`, layout: p.project.layout, firmware }
    })
}

/** Run a case and return the telemetry of each averaging window. */
function run(c: Case, windows: [number, number][] = WINDOWS): SimTelemetry[] {
  const co = new SimulationCoordinator()
  co.setCurrentTracking(true)
  co.load(c.layout, 1)
  for (const f of c.firmware) {
    const img = loadFirmwareFile(f.name, f.bytes)
    if (!img.ok) throw new Error(`${c.name}: ${img.error}`)
    co.setFirmware(f.id, img.image)
  }
  const frames: SimTelemetry[] = []
  for (const [t0, t1] of windows) {
    while (co.time < t0 - 1e-12) co.advance(Math.min(0.005, t0 - co.time))
    co.frame() // start a fresh averaging window
    while (co.time < t1 - 1e-12) co.advance(Math.min(0.005, t1 - co.time))
    frames.push(co.frame().telemetry)
  }
  co.dispose?.()
  return frames
}

function check(c: Case): SimTelemetry[] {
  const frames = run(c)
  frames.forEach((t, k) => {
    const bad = kclFailures(c.layout, t)
    expect(bad, `${c.name} window ${k} (${WINDOWS[k].join('–')} s):\n${bad.join('\n')}`).toEqual([])
    expect(brokenLoops(c.layout, t), `${c.name} window ${k}: broken loops`).toEqual([])
  })
  return frames
}

const LONG = { timeout: 300_000 }

describe('KCL over every bundled circuit (examples, embedded examples, lesson solutions)', () => {
  it('the four legacy examples: closed loops, and a chip output current enters through its supply pin', LONG, () => {
    const cases = legacyCases()
    expect(cases.length).toBeGreaterThanOrEqual(4)
    for (const c of cases) {
      const frames = check(c)
      if (c.name.endsWith('blinky-555.json')) {
        // the loop the reviewer saw broken: OUT sources the LED from VCC, so
        // the + wire carries the LED current plus the RC timing current
        const t = frames.find((f) => (f.components.D1?.pinCurrents?.anode ?? 0) > 1e-3)
        expect(t, `the LED is lit in one window: ${frames.map((f) => JSON.stringify(f.components.D1?.pinCurrents))}`).toBeDefined()
        const led = t!.components.D1.pinCurrents!.anode
        const u1 = t!.components.U1.pinCurrents!
        expect(u1.OUT).toBeLessThan(-0.9 * led) // the chip sources it at OUT …
        expect(u1.VCC).toBeGreaterThan(0.9 * led) // … and takes it in at VCC
        const ps = t!.components.PS1.pinCurrents!
        expect(-ps['+']).toBeGreaterThan(led) // the bench supply really delivers it
        expect(Math.abs(ps['+'] + ps['-'])).toBeLessThan(TOL)
      }
    }
  })

  it('every embedded example with its real firmware', { timeout: 600_000 }, () => {
    const cases = embeddedCases()
    expect(cases.length).toBeGreaterThanOrEqual(30)
    for (const c of cases) check(c)
  })

  it('every lesson solution with its firmware', { timeout: 600_000 }, async () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(20)
    for (const lesson of LESSONS) {
      const input = await lessonCircuitInput(lesson.solution)
      const firmware = Object.entries(input.firmware).map(([id, f]) => ({ id, name: f.name, bytes: f.bytes }))
      check({ name: `lesson ${lesson.id}`, layout: input.layout, firmware })
    }
  })

  it('the tolerance stays below what the flow layer can show', () => {
    expect(TOL).toBeLessThan(MIN_SHOWN_A)
  })
})

// ---------------------------------------------------------------- routing units

const W = (id: string, from: string, to: string): Wire => ({ id, from, to })
const AT = 'f20'
const pin = (n: number) => dipPinHole(AT, 14, n)
const row = (h: string, r: string) => `${r}${h.slice(1)}`

/** Settle, then the mean currents of a steady window (SimEngine, tracking on). */
function steady(l: CircuitLayout): SimTelemetry {
  const e = new SimEngine(l)
  e.trackCurrents = true
  e.advance(0.002)
  e.telemetry()
  e.advance(0.002)
  return e.telemetry()
}

/**
 * A 7404 at f20 whose 1A floats (1Y high): 1Y sources a 470 Ω load to the
 * − rail (a resistor, not an LED: no coupling to the LED model).
 */
function sourcing(extra: ComponentInstance[], wires: Wire[], vccTo = 'top+3'): CircuitLayout {
  return layout(
    [dip('U1', 'sn7404', AT), twoLead('RL', 'resistor', row(pin(2), 'j'), 'top-6', { resistance: 470 }), ...extra],
    [W('vcc', row(pin(14), 'a'), vccTo), W('gnd', row(pin(7), 'j'), 'top-3'), ...wires],
  )
}

describe('a Norton output closes its loop through the chip and its supply (display bookkeeping)', () => {
  it('sourcing from a bench supply: VCC takes in what 1Y gives out; the + and − wires carry it', () => {
    const l = sourcing([supply5()], [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0')])
    const t = steady(l)
    const u1 = t.components.U1.pinCurrents!
    const I = -u1['1Y']
    expect(I).toBeGreaterThan(0.008) // ≈ 5 V / (470 + 50) Ω
    expect(Math.abs(u1.VCC - I)).toBeLessThan(TOL) // + the GMIN loads of the other high outputs (nA)
    expect(Math.abs(u1.GND)).toBeLessThan(1e-9)
    expect(Math.abs(t.wireCurrents!.wp - I)).toBeLessThan(TOL)
    expect(Math.abs(t.wireCurrents!.wn + I)).toBeLessThan(TOL)
    expect(kclFailures(l, t)).toEqual([])
  })

  it('sinking with an input tied to 0 V: the return leaves through GND only, never through the grounded input', () => {
    // 1A tied to the − rail; 2A tied high → 2Y low sinks RS from the + rail
    const l = layout(
      [supply5(), dip('U1', 'sn7404', AT), twoLead('RS', 'resistor', 'top+7', row(pin(4), 'j'), { resistance: 330 })],
      [
        W('wp', 'PS1:+', 'top+0'),
        W('wn', 'PS1:-', 'top-0'),
        W('vcc', row(pin(14), 'a'), 'top+3'),
        W('gnd', row(pin(7), 'j'), 'top-3'),
        W('lo', row(pin(1), 'j'), 'top-8'),
        W('hi', row(pin(3), 'j'), 'top+8'),
      ],
    )
    const t = steady(l)
    const u1 = t.components.U1.pinCurrents!
    const Is = u1['2Y']
    expect(Is).toBeGreaterThan(0.01)
    expect(Math.abs(u1.GND + Is)).toBeLessThan(TOL)
    expect(Math.abs(u1['1A'])).toBeLessThan(1e-9) // the old split sent half of it out through 1A
    expect(kclFailures(l, t)).toEqual([])
  })

  it('a battery-powered chip: the current runs through the battery (an off-board source)', () => {
    const l = sourcing(
      [{ id: 'BAT1', type: 'battery_9v', params: { voltage: 5, rint: 0.5 } }],
      [W('bp', 'BAT1:+', 'top+0'), W('bn', 'BAT1:-', 'top-0')],
    )
    const t = steady(l)
    const I = -t.components.U1.pinCurrents!['1Y']
    expect(I).toBeGreaterThan(0.008)
    const bat = t.components.BAT1.pinCurrents!
    expect(Math.abs(bat['+'] + I)).toBeLessThan(TOL)
    expect(Math.abs(bat['-'] - I)).toBeLessThan(TOL)
    expect(kclFailures(l, t)).toEqual([])
  })

  it('two supplies in parallel share it by their conductance (equal supplies: half each)', () => {
    const l = sourcing(
      [supply5(), supply5('PS2')],
      [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), W('wp2', 'PS2:+', 'top+1'), W('wn2', 'PS2:-', 'top-1')],
    )
    const t = steady(l)
    const I = -t.components.U1.pinCurrents!['1Y']
    const p1 = t.components.PS1.pinCurrents!['+']
    const p2 = t.components.PS2.pinCurrents!['+']
    expect(Math.abs(p1 - p2)).toBeLessThan(1e-9)
    expect(Math.abs(p1 + p2 + I)).toBeLessThan(TOL)
    expect(kclFailures(l, t)).toEqual([])
  })

  it('stacked supplies (a 10 V rail from PS2 on top of PS1): the chain carries it through both', () => {
    // PS2 − on the 5 V rail, PS2 + on the bottom + rail (10 V); the chip's VCC on that rail
    const l = sourcing(
      [supply5(), supply5('PS2')],
      [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), W('s2n', 'PS2:-', 'top+1'), W('s2p', 'PS2:+', 'bot+0')],
      'bot+3',
    )
    const t = steady(l)
    const I = -t.components.U1.pinCurrents!['1Y']
    expect(I).toBeGreaterThan(0.008)
    expect(Math.abs(t.components.PS2.pinCurrents!['+'] + I)).toBeLessThan(TOL)
    expect(Math.abs(t.components.PS1.pinCurrents!['+'] + I)).toBeLessThan(TOL) // nothing else on the 5 V rail
    expect(kclFailures(l, t)).toEqual([])
  })

  it('no honest path (VCC fed through a resistor): NOTHING around the chip shows — no current leaving 1Y into a dark rail', () => {
    // the verifier's q10: a 7404 whose VCC comes through 10 Ω, 1Y sourcing a load to the − rail
    const l = sourcing(
      [supply5(), twoLead('RF', 'resistor', 'top+5', 'a50', { resistance: 10 })],
      [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0')],
      'b50',
    )
    const t = steady(l)
    const unknown = (i: number | undefined) => i === undefined // unknown is ABSENT, never a guessed 0 (types.ts pinCurrents)
    const u1 = t.components.U1.pinCurrents!
    // VCC / GND unknown — never a guessed path — and the output the loop cannot close for
    expect(unknown(u1.VCC) && unknown(u1.GND) && unknown(u1['1Y'])).toBe(true)
    // the load 1Y drives pushes its current into the dark 0 V net: hidden too (both pins absent)
    expect(t.components.RL.pinCurrents).toEqual({})
    // …and named, the chip first (SimTelemetry.flowConcealed)
    expect(t.flowConcealed?.[0]).toBe('U1')
    expect(t.flowConcealed).toContain('RL')
    // the feed resistor and the supply carry nothing in the solver (the 7404 draws no supply current
    // there): hidden, or shown as the nothing they carry — never a particle
    for (const id of ['RF', 'PS1']) {
      for (const i of Object.values(t.components[id].pinCurrents ?? {})) expect(unknown(i) || Math.abs(i) < KCL_HIDE_A, id).toBe(true)
    }
    const wc = t.wireCurrents!
    for (const id of ['vcc', 'gnd', 'wn']) expect(wc[id], id).toBeUndefined()
    expect(wc.wp === undefined || Math.abs(wc.wp) < MIN_SHOWN_A).toBe(true)
    expect(Object.values(t.stripCurrents ?? {}).filter((i) => Math.abs(i) >= MIN_SHOWN_A)).toEqual([])
    expect(brokenLoops(l, t)).toEqual([])
  })
})

/** blinky-555 on a 9 V battery behind an LM7805 (the verifier's q11: the classic beginner build). */
function regulated555(): CircuitLayout {
  const res = validateLayout(JSON.parse(readFileSync(join(ROOT, 'examples/blinky-555.json'), 'utf8')))
  const L = structuredClone(res.layout!)
  L.components = L.components.filter((c) => c.id !== 'PS1')
  L.components.push({ id: 'BAT1', type: 'battery_9v' }, { id: 'U2', type: 'lm7805', holes: ['c40', 'c41', 'c42'] })
  L.wires = L.wires.filter((x) => !x.from.startsWith('PS1'))
  L.wires.push(W('b1', 'BAT1:-', 'top-0'), W('b2', 'BAT1:+', 'a40'), W('r1', 'a41', 'top-38'), W('r2', 'a42', 'top+39'))
  return L
}

describe('never a broken loop where a chip current cannot be closed (conceal)', () => {
  it('a 555 behind an LM7805: every window is either closed or dark — never current vanishing into a hidden rail', LONG, () => {
    const c: Case = { name: 'battery → 7805 → 555', layout: regulated555(), firmware: [] }
    // OUT high 0 → 0.58 s (C1 charging from 0), low 0.58 → 0.88 s, high again to ~1.25 s
    const frames = run(c, [
      [0.3, 0.32],
      [0.7, 0.72],
      [1.0, 1.02],
    ])
    const lit = frames.map((t) => (t.components.D1?.current ?? 0) > 1e-3)
    expect(lit).toEqual([true, false, true])
    frames.forEach((t, k) => {
      expect(brokenLoops(c.layout, t), `window ${k}`).toEqual([])
      // a shown battery wire means the whole loop is shown: then it closes exactly
      if (typeof t.wireCurrents?.b2 === 'number') expect(kclFailures(c.layout, t), `window ${k}`).toEqual([])
    })
    // lit LED: OUT sources it, and the engine does not yet tell the tracker that U2 is a
    // regulator (contract request) — closed through the 7805 once it does, dark (never broken)
    // until then; dark LED: the hold keeps it dark too (particles only while the LED is OFF
    // would say the opposite of what happens)
    const shown = frames.map((t) => typeof t.wireCurrents?.b2 === 'number')
    if (shown[0]) {
      expect(shown).toEqual([true, true, true])
      for (const k of [0, 2]) expect(frames[k].components.U2.pinCurrents!.OUT).toBeLessThan(-(frames[k].components.D1.current ?? 0))
    } else {
      expect(shown).toEqual([false, false, false])
      for (const t of frames) expect(Object.keys(t.wireCurrents ?? {})).toEqual([])
    }
  })

  it('a regulator the tracker knows (TrackedDevice.model = ldo): the 555 loop closes through the 7805 and the battery', () => {
    // the engine does not tag device runtimes yet (contract request); emulate it on a tracker of our own
    const Q = 1e-3
    const target = { nodeCount: 3, addElement() {}, addConductance() {}, addCurrent() {}, addNorton() {} }
    // nodes: 0 = battery + (9 V), 1 = regulated 5 V (chip VCC), 2 = chip OUT; the 0 V net is −1
    const devices = [
      { nodes: [0, -1], slots: [0, 1] }, // BAT1 +, −
      { nodes: [0, 1, -1], slots: [2, 3, 4], model: 'ldo' }, // U2 IN, OUT, GND
      { nodes: [2, -1], slots: [8, 9] }, // RL from OUT to 0 V
    ]
    const chip = {
      drives: {
        pinNodes: Int32Array.from([1, 2, -1]),
        driveG: Float64Array.from([0, 1, 0]),
        driveV: Float64Array.from([0, 5, 0]),
        stageUp: null,
        stageDown: null,
        railHiNode: -2,
        railLoNode: -2,
        railHiIdx: -1,
        railLoIdx: -1,
        entry: { pins: ['VCC', 'OUT', 'GND'] },
      },
      base: 5,
    }
    const tr = new CurrentTracker(target, devices, [chip], 10)
    const rec = tr.recorder
    const x = Float64Array.from([9, 5, 5 - Q]) // OUT sources Q through its 1 S drive
    rec.begin(target)
    rec.owner = 0
    rec.addNorton(0, -1, 9, 0.5) // the battery: 9 V behind 0.5 Ω, unloaded in the solver
    rec.owner = 1 // the LDO, unloaded in the solver (its own stamps evaluate to 0 here)
    rec.owner = 2
    rec.addConductance(2, -1, Q / (5 - Q)) // the load: carries Q
    rec.owner = -1
    tr.accumulate(x, 1e-3)
    const m = tr.drain()!
    const p = Array.from(m.pins)
    expect(p[6]).toBeCloseTo(-Q, 9) // OUT sources Q …
    expect(p[5]).toBeCloseTo(Q, 9) // … taken in at VCC
    expect(p[3]).toBeCloseTo(-Q, 9) // out of the regulator at OUT …
    expect(p[2]).toBeCloseTo(Q, 9) // … into it at IN
    expect(p[0]).toBeCloseTo(-Q, 9) // out of the battery at + …
    expect(p[1]).toBeCloseTo(Q, 9) // … back in at −
    expect(p[9]).toBeCloseTo(-Q, 9) // the load returns it to the 0 V net
    expect(p.every((i) => Number.isFinite(i))).toBe(true)
    expect(Math.abs(m.ref)).toBeLessThan(1e-12)
  })

  it('a regulator only sources: a SINKING return is never carried backwards through it (dark instead)', () => {
    const Q = 1e-3
    const target = { nodeCount: 3, addElement() {}, addConductance() {}, addCurrent() {}, addNorton() {} }
    // the chip's GND pin on the regulator's output net: its sinking current cannot flow back through the LDO
    const devices = [
      { nodes: [0, -1], slots: [0, 1] },
      { nodes: [0, 1, -1], slots: [2, 3, 4], model: 'ldo' },
      { nodes: [0, 2], slots: [8, 9] }, // RL from the + net into OUT
    ]
    const chip = {
      drives: {
        pinNodes: Int32Array.from([0, 2, 1]),
        driveG: Float64Array.from([0, 1, 0]),
        driveV: Float64Array.from([0, 0, 0]),
        stageUp: null,
        stageDown: null,
        railHiNode: -2,
        railLoNode: -2,
        railHiIdx: -1,
        railLoIdx: -1,
        entry: { pins: ['VCC', 'OUT', 'GND'] },
      },
      base: 5,
    }
    const tr = new CurrentTracker(target, devices, [chip], 10)
    const rec = tr.recorder
    rec.begin(target)
    rec.owner = 0
    rec.addNorton(0, -1, 9, 0.5) // the battery delivers Q into the + net (9 − 0.5·Q volts)
    rec.owner = 2
    rec.addConductance(0, 2, Q / (9 - 0.5 * Q - Q))
    rec.owner = -1
    tr.accumulate(Float64Array.from([9 - 0.5 * Q, 5, Q]), 1e-3) // OUT sinks Q
    const p = Array.from(tr.drain()!.pins)
    // GND (slot 7) and VCC (slot 5) unknown; everything pushing current into those nets concealed
    expect(Number.isNaN(p[7]) && Number.isNaN(p[5])).toBe(true)
    expect(Number.isNaN(p[6])).toBe(true) // OUT: the chip is hidden whole
    expect(Number.isNaN(p[8]) && Number.isNaN(p[9])).toBe(true) // the load
    expect(Number.isNaN(p[0]) && Number.isNaN(p[1])).toBe(true) // the battery
    expect(p[3]).toBe(0) // the regulator carries nothing: nothing to hide
  })

  it('a stray nA leak of an idle output (no path) is no reason to go dark: below KCL_HIDE_A it stays on the reference', () => {
    const target = { nodeCount: 2, addElement() {}, addConductance() {}, addCurrent() {}, addNorton() {} }
    const devices = [
      { nodes: [0, -1], slots: [0, 1] }, // a supply on node 0
      { nodes: [0, -1], slots: [2, 3] }, // its 1 mA load
    ]
    const chip = {
      drives: {
        pinNodes: Int32Array.from([1, 1, -1]), // VCC on an undriven node 1, OUT idling there too
        driveG: Float64Array.from([0, 1e-9, 0]),
        driveV: Float64Array.from([0, 1, 0]), // 1 nA leaking out of OUT
        stageUp: null,
        stageDown: null,
        railHiNode: -2,
        railLoNode: -2,
        railHiIdx: -1,
        railLoIdx: -1,
        entry: { pins: ['VCC', 'OUT', 'GND'] },
      },
      base: 4,
    }
    const tr = new CurrentTracker(target, devices, [chip], 7)
    const rec = tr.recorder
    rec.begin(target)
    rec.owner = 0
    rec.addNorton(0, -1, 5, 1)
    rec.owner = 1
    rec.addConductance(0, -1, 1e-3 / (5 - 1e-3))
    rec.owner = -1
    tr.accumulate(Float64Array.from([5 - 1e-3, 0]), 1e-3)
    const p = Array.from(tr.drain()!.pins)
    expect(p.every((i) => Number.isFinite(i))).toBe(true)
    expect(p[0]).toBeCloseTo(-1e-3, 9) // the supply's loop shows
  })

  it('a chip that could not be closed stays dark for HOLD_S of simulated time (no flicker in step with its output)', () => {
    const target = { nodeCount: 2, addElement() {}, addConductance() {}, addCurrent() {}, addNorton() {} }
    const devices = [{ nodes: [0, -1], slots: [0, 1] }] // the load OUT drives to 0 V
    const drives = {
      pinNodes: Int32Array.from([1, 0, -1]), // VCC on an undriven node: no path while OUT sources
      driveG: Float64Array.from([0, 1, 0]),
      driveV: Float64Array.from([0, 5, 0]),
      stageUp: null,
      stageDown: null,
      railHiNode: -2,
      railLoNode: -2,
      railHiIdx: -1,
      railLoIdx: -1,
      entry: { pins: ['VCC', 'OUT', 'GND'] },
    }
    const tr = new CurrentTracker(target, devices, [{ drives, base: 2 }], 5)
    const step = (out: number, dt: number) => {
      tr.recorder.begin(target)
      tr.recorder.owner = 0
      tr.recorder.addConductance(0, -1, 1e-3)
      tr.recorder.owner = -1
      drives.driveV[1] = out
      tr.accumulate(Float64Array.from([out === 5 ? 5 - 5e-3 / 1.001 : 0, 0]), dt)
      return Array.from(tr.drain()!.pins)
    }
    expect(Number.isNaN(step(5, 0.2)[2])).toBe(true) // OUT high, sourcing: no path → dark
    expect(Number.isNaN(step(0, 0.5)[2])).toBe(true) // OUT low, nothing to route: still held dark
    expect(Number.isNaN(step(0, 2)[2])).toBe(true)
    expect(step(0, 1).every((i) => Number.isFinite(i))).toBe(true) // 3 s quiet: shown again
  })

  it('conceal stops at pins that carry nothing: an unrelated circuit on the same supply stays visible', () => {
    const target = { nodeCount: 4, addElement() {}, addConductance() {}, addCurrent() {}, addNorton() {} }
    // two separate supplies: node 0 (+ of S1) / node 1 (+ of S2); the 0 V net is shared — but S2's
    // loop runs to its own minus node 2 (floating island), so nothing of it touches the dark 0 V net
    const devices = [
      { nodes: [0, -1], slots: [0, 1] }, // S1
      { nodes: [1, 2], slots: [2, 3] }, // S2
      { nodes: [1, 2], slots: [4, 5] }, // R across S2
    ]
    const chip = {
      drives: {
        pinNodes: Int32Array.from([3, 0, -1]), // VCC on an undriven node 3: no path
        driveG: Float64Array.from([0, 1, 0]),
        driveV: Float64Array.from([0, 5.2, 0]), // OUT sources 0.1 A into S1 (which absorbs it)
        stageUp: null,
        stageDown: null,
        railHiNode: -2,
        railLoNode: -2,
        railHiIdx: -1,
        railLoIdx: -1,
        entry: { pins: ['VCC', 'OUT', 'GND'] },
      },
      base: 6,
    }
    const tr = new CurrentTracker(target, devices, [chip], 9)
    const rec = tr.recorder
    rec.begin(target)
    rec.owner = 0
    rec.addNorton(0, -1, 5, 1)
    rec.owner = 1
    rec.addNorton(1, 2, 3, 1)
    rec.owner = 2
    rec.addConductance(1, 2, 1e-3)
    rec.owner = -1
    tr.accumulate(Float64Array.from([5.1, 3 / 1.001, 0, 0]), 1e-3)
    const p = Array.from(tr.drain()!.pins)
    expect(Number.isNaN(p[6]) && Number.isNaN(p[7]) && Number.isNaN(p[8])).toBe(true) // the chip
    expect(Number.isNaN(p[0]) && Number.isNaN(p[1])).toBe(true) // S1 feeds OUT's net: dark
    expect(p.slice(2, 6).every((i) => Number.isFinite(i) && Math.abs(i) > 1e-3)).toBe(true) // S2's loop shows
  })
})

describe('a regulator inside a chip part: the Blue Pill 3V3 pin', () => {
  it('a 7404 powered from the Blue Pill 3V3 pin: its output current runs back through the board REG and the bench supply', LONG, () => {
    const at = 'f40'
    const p = (n: number) => dipPinHole(at, 14, n)
    const l = bluePillWorld(
      [dip('U2', 'sn7404', at), twoLead('RL', 'resistor', row(p(2), 'j'), 'top-46', { resistance: 330 })],
      [W('v33', tap('3V3_1'), row(p(14), 'a')), W('g7', row(p(7), 'j'), 'top-44')],
    )
    const co = new SimulationCoordinator()
    co.setCurrentTracking(true)
    co.load(l, 1)
    for (let i = 0; i < 20; i++) co.advance(0.001)
    co.frame()
    for (let i = 0; i < 10; i++) co.advance(0.001)
    const t = co.frame().telemetry
    co.dispose?.()
    const I = -(t.components.U2.pinCurrents!['1Y'] ?? 0)
    expect(I).toBeGreaterThan(1e-3) // 1Y high (1A floats) into 330 Ω
    expect(t.components.U2.pinCurrents!.VCC).toBeGreaterThan(0.99 * I)
    expect(kclFailures(l, t)).toEqual([])
    expect(brokenLoops(l, t)).toEqual([])
    // the board's 5V pin takes it in from the supply, and the supply's − wire carries it back
    const ps = t.components.PS1.pinCurrents!
    expect(-ps['+']).toBeGreaterThan(I)
  })
})

describe('nortonReturnPins', () => {
  const drives = (type: string, chip?: unknown): TrackedChipDrives => ({
    pinNodes: new Int32Array(CATALOG[type].pins.length),
    driveG: new Float64Array(0),
    driveV: new Float64Array(0),
    stageUp: null,
    stageDown: null,
    railHiNode: -2,
    railLoNode: -2,
    railHiIdx: -1,
    railLoIdx: -1,
    entry: CATALOG[type],
    chip,
  })
  const idx = (type: string, p: string) => CATALOG[type].pins.indexOf(p)

  it('a legacy chip: sourcing through VCC / VDD, sinking through GND / VSS', () => {
    expect(nortonReturnPins(drives('ne555'))).toEqual([idx('ne555', 'VCC'), idx('ne555', 'GND')])
    expect(nortonReturnPins(drives('cd4511'))).toEqual([idx('cd4511', 'VDD'), idx('cd4511', 'VSS')])
    expect(nortonReturnPins(drives('lm358'))).toEqual([idx('lm358', 'VCC'), idx('lm358', 'GND')])
  })

  it("an MCU board: the USB-TTL adapter's current enters and leaves at the board's GND", () => {
    const g = idx('stm32_bluepill', 'GND1')
    expect(nortonReturnPins(drives('stm32_bluepill', { gndIdx: g, vddIdx: idx('stm32_bluepill', '3V3_1') }))).toEqual([g, g])
    expect(nortonReturnPins(drives('stm32_bluepill'))).toEqual([g, g]) // from entry.mcu.gndPin
  })

  it('a module behind its own regulator: its supply pin (as the chip model resolved it) and its ground', () => {
    const t = 'mpu6050_gy521'
    expect(nortonReturnPins(drives(t, { supplyIdx: idx(t, 'VCC'), groundIdx: idx(t, 'GND') }))).toEqual([idx(t, 'VCC'), idx(t, 'GND')])
    // a jumpered supply (the CH340's 3V3 / 5V jumper) wins over the catalog
    const c = 'usb_uart_ch340'
    expect(nortonReturnPins(drives(c, { supplyIdx: idx(c, '3V3'), groundIdx: idx(c, 'GND') }))[0]).toBe(idx(c, '3V3'))
  })
})
