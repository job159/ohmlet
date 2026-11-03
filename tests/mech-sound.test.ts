/**
 * Mechanical sounds (owner: sound — product owner: 「各種元器件的機械聲音，
 * 插入、點擊，有爽度」):
 *
 *  - mechCuesOf: what one store step sounds like — insert (count = leads,
 *    kind = the heaviest body), pull (its wires go with it), wire-in /
 *    wire-out, a re-routed wire end, rotate, seat, a board module ('board'
 *    only, even when every hole is remapped; a new module when it lands),
 *    a whole circuit ('load'), a paste (insert, not load), an emptied board
 *    ('clear'), and the mechanical runtime params (press / latch / release,
 *    toggle, slide, DIP bits, pot steps, encoder detents, jumpers, the
 *    multimeter dial) — nothing for knobs that are not mechanical,
 *    structural values, wire colours or an unchanged value;
 *  - RelayEdges: real NO-contact edges, a settle window after every load
 *    (an unrelated edit never clicks, a drive removed clicks once), reset;
 *  - the watcher against the real store / latch / host events: one sound per
 *    change, press / release / the double-click latch / a finger on a kept
 *    button, undo / redo one swish, relay clicks only while running and
 *    visible, the classic chrome and ?shotrig silent, ref-counted;
 *  - the recipes (a recording Synth): every cue renders, peaks ≤ 1, over
 *    within MAX_CUE_S, a many-lead part longer and lower;
 *  - the engine on a stand-in AudioContext: created and resumed inside the
 *    gesture, the gate re-armed by an interruption, nothing without 音效 or
 *    a gesture, the voice cap, the per-cue spacing, QUIET_GAIN.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const played = vi.hoisted(() => [] as { cue: string; opts?: Record<string, unknown> }[])
vi.mock('../src/ui/fx/sound', async (orig) => {
  const real = await orig<typeof import('../src/ui/fx/sound')>()
  return { ...real, playMech: (cue: string, opts?: Record<string, unknown>) => void played.push({ cue, opts }) }
})

import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, ComponentInstance, SimTelemetry } from '../src/model/types'
import type { SimFrame, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { __resetHistoryForTests, __setSimHostFactoryForTests, useStore } from '../src/state/store'
import { redoWithFeedback, removeSelectedWithFeedback, undoWithFeedback } from '../src/ui/chrome/edit-feedback'
import { latchPart, pressMomentary, setLatched, useLatchHolds } from '../src/ui/embedded/latch'
import { __setCelebrationsSuppressedForTests } from '../src/ui/fx/celebrate'
import {
  LOAD_ADDITIONS,
  RELAY_SETTLE_S,
  RelayEdges,
  holdCuesOf,
  mechCuesOf,
  mechWatchCount,
  modeCuesOf,
  setSceneShowing,
  startMechSoundWatch,
  voiceSceneCue,
  withMechCause,
  type MechHit,
} from '../src/ui/fx/mech-watch'
import { MAX_CUE_S, MECH_CUES, heaviness, jitterSynth, noiseMakeup, renderMech, type Synth } from '../src/ui/fx/mech-voices'
import type { MechCue } from '../src/ui/fx/sound'

const st = () => useStore.getState()
const EMPTY: CircuitLayout = { version: 1, name: 'e', components: [], wires: [] }
const BENCH: CircuitLayout = {
  version: 1,
  name: 'bench',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'W3', from: 'a18', to: 'top-12', color: 'black' },
  ],
}

/** `base` with one more part / wire, every earlier object kept (an edit, not a load) */
const plus = (base: CircuitLayout, comps: ComponentInstance[], wires: CircuitLayout['wires'] = []): CircuitLayout => ({
  ...base,
  components: [...base.components, ...comps],
  wires: [...base.wires, ...wires],
})
/** `base` with part `id` replaced by `patch` applied to it */
const patched = (base: CircuitLayout, id: string, patch: Partial<ComponentInstance>): CircuitLayout => ({
  ...base,
  components: base.components.map((c) => (c.id === id ? { ...c, ...patch } : c)),
})
const one = (comp: ComponentInstance): CircuitLayout => ({ version: 1, name: 'one', components: [comp], wires: [] })
const cues = (hits: MechHit[]) => hits.map((h) => h.cue)
const diff = (a: CircuitLayout, b: CircuitLayout, held: string[] = []) => mechCuesOf(a, b, { held })

// ---------------------------------------------------------------- the classifier

describe('mechCuesOf: one store step, one sound', () => {
  it('nothing changed → silence', () => {
    expect(diff(BENCH, BENCH)).toEqual([])
    expect(diff(BENCH, { ...BENCH })).toEqual([])
  })

  it('a placed part zips in: count = its leads, kind = its body (leads / DIP / footprint / bench)', () => {
    expect(diff(BENCH, plus(BENCH, [{ id: 'R2', type: 'resistor', holes: ['c30', 'c34'] }]))).toEqual([
      { cue: 'insert', count: 2, kind: 'leads', ids: ['R2'] },
    ])
    expect(diff(BENCH, plus(BENCH, [{ id: 'U1', type: 'ne555', at: 'f30' }]))[0]).toMatchObject({ cue: 'insert', count: 8, kind: 'dip' })
    expect(diff(BENCH, plus(BENCH, [{ id: 'SW1', type: 'pushbutton', at: 'e30' }]))[0]).toMatchObject({ cue: 'insert', count: 4, kind: 'footprint' })
    expect(diff(BENCH, plus(BENCH, [{ id: 'DMM1', type: 'multimeter' }]))[0]).toMatchObject({ cue: 'insert', count: 2, kind: 'offboard' })
  })

  it('a deleted part is pulled out — its terminal wires go with it, silently', () => {
    const noLed: CircuitLayout = { ...BENCH, components: BENCH.components.filter((c) => c.id !== 'LED1') }
    expect(diff(BENCH, noLed)).toEqual([{ cue: 'pull', count: 2, kind: 'leads', ids: ['LED1'] }])
    const noPs: CircuitLayout = { ...BENCH, components: BENCH.components.filter((c) => c.id !== 'PS1'), wires: [BENCH.wires[2]] }
    expect(diff(BENCH, noPs)).toEqual([{ cue: 'pull', count: 2, kind: 'offboard', ids: ['PS1'] }])
  })

  it('wires: in, out, a re-routed end (in), a new colour (silent)', () => {
    expect(diff(BENCH, plus(BENCH, [], [{ id: 'W4', from: 'a10', to: 'top+3' }]))).toEqual([{ cue: 'wire-in', count: 1, ids: ['W4'] }])
    expect(diff(BENCH, { ...BENCH, wires: BENCH.wires.slice(0, 2) })).toEqual([{ cue: 'wire-out', count: 1, ids: ['W3'] }])
    const rerouted = { ...BENCH, wires: BENCH.wires.map((w) => (w.id === 'W3' ? { ...w, to: 'top-14' } : w)) }
    expect(cues(diff(BENCH, rerouted))).toEqual(['wire-in'])
    const recolored = { ...BENCH, wires: BENCH.wires.map((w) => (w.id === 'W3' ? { ...w, color: 'blue' } : w)) }
    expect(diff(BENCH, recolored)).toEqual([])
  })

  it('a move seats the part in its new holes (a bench instrument thuds); a rotation clicks twice', () => {
    expect(diff(BENCH, patched(BENCH, 'R1', { holes: ['c11', 'c15'] }))).toEqual([{ cue: 'seat', count: 2, kind: 'leads', ids: ['R1'] }])
    expect(diff(BENCH, patched(BENCH, 'PS1', { pos: { x: -12, z: 3 } }))[0]).toMatchObject({ cue: 'seat', kind: 'offboard' })
    const sw = plus(BENCH, [{ id: 'SW1', type: 'pushbutton', at: 'e30' }])
    expect(cues(diff(sw, patched(sw, 'SW1', { rotation: 90 })))).toEqual(['rotate'])
  })

  it('a board module: only 「board」 — even when every hole is remapped (growGrid left / up); ONE new one is the scene’s touchdown', () => {
    const shifted: CircuitLayout = {
      ...BENCH,
      boardCount: 2,
      components: BENCH.components.map((c) => (c.holes ? { ...c, holes: c.holes.map((h) => h.replace(/\d+$/, (n) => String(Number(n) + 63))) } : c)),
      wires: BENCH.wires.map((w) => ({ ...w })),
    }
    expect(diff(BENCH, shifted)).toEqual([{ cue: 'board', ids: [], byScene: true }])
    expect(diff(BENCH, { ...BENCH, boardRows: 2 })).toEqual([{ cue: 'board', ids: [], byScene: true }])
    expect(diff(shifted, { ...shifted, boardCount: 1 })).toEqual([{ cue: 'board', ids: [] }])
    // the scene drops in only ONE module of the same size: anything else sounds at once
    expect(diff(BENCH, { ...BENCH, boardCount: 3 })).toEqual([{ cue: 'board', ids: [] }])
    expect(diff(BENCH, { ...BENCH, board: 'half', boardCount: 2 })).toEqual([{ cue: 'board', ids: [] }])
  })

  it('a whole circuit at once is ONE 「load」; a paste (earlier parts untouched) is an insert', () => {
    // an example / import: parts and wires together, fresh objects
    expect(cues(diff(EMPTY, BENCH))).toEqual(['load'])
    expect(cues(diff(BENCH, JSON.parse(JSON.stringify(plus(BENCH, [{ id: 'R2', type: 'resistor', holes: ['c30', 'c34'] }], [{ id: 'W4', from: 'a30', to: 'top+9' }])))))).toEqual(['load'])
    // parts swapped for others
    const swapped: CircuitLayout = { ...BENCH, components: [...BENCH.components.slice(0, 2), { id: 'LED2', type: 'led', holes: ['d14', 'd18'] }] }
    expect(cues(diff(BENCH, swapped))).toEqual(['load'])
    // store.loadLayout says so itself
    expect(mechCuesOf(BENCH, one({ id: 'R9', type: 'resistor', holes: ['c1', 'c5'] }), { held: [], loaded: true })[0].cue).toBe('load')
    expect(mechCuesOf(BENCH, EMPTY, { held: [], loaded: true })).toEqual([{ cue: 'clear', ids: [] }])
    // a paste: the copy's part and its wire, every earlier object identical
    const pasted = plus(BENCH, [{ id: 'R2', type: 'resistor', holes: ['c30', 'c34'] }], [{ id: 'W4', from: 'a30', to: 'top+9' }])
    expect(diff(BENCH, pasted)).toEqual([{ cue: 'insert', count: 2, kind: 'leads', ids: ['R2', 'W4'] }])
    // a big paste reads as a load
    const many = Array.from({ length: LOAD_ADDITIONS + 1 }, (_, i): ComponentInstance => ({ id: `R${10 + i}`, type: 'resistor', holes: [`c${20 + i}`, `g${20 + i}`] }))
    expect(cues(diff(BENCH, plus(BENCH, many)))).toEqual(['load'])
  })

  it('emptying the board: 「clear」 for more than three named things, a plain pull for the last part', () => {
    expect(cues(diff(BENCH, EMPTY))).toEqual(['clear'])
    expect(cues(diff(one({ id: 'R1', type: 'resistor', holes: ['c1', 'c5'] }), EMPTY))).toEqual(['pull'])
  })

  it('buttons: down with a finger = press, down without (kept) = latch, up = release; the same value again = silence', () => {
    const sw = one({ id: 'SW1', type: 'pushbutton', at: 'e30' })
    const down = patched(sw, 'SW1', { params: { pressed: true } })
    expect(diff(sw, down, ['SW1'])).toEqual([{ cue: 'press', ids: ['SW1'] }])
    expect(diff(sw, down)).toEqual([{ cue: 'latch', ids: ['SW1'] }])
    expect(diff(down, patched(down, 'SW1', { params: { pressed: false } }))).toEqual([{ cue: 'release', ids: ['SW1'] }])
    expect(diff(down, patched(down, 'SW1', { params: { pressed: true } }))).toEqual([]) // setParam always writes a new layout
    // the KY-040's push switch is a button too
    const enc = one({ id: 'ENC1', type: 'ky040_encoder', at: 'e30' })
    expect(cues(diff(enc, patched(enc, 'ENC1', { params: { pressed: true } }), ['ENC1']))).toEqual(['press'])
  })

  it('switches, DIP bits, pots, detents, jumpers, the multimeter dial', () => {
    const slide = one({ id: 'S1', type: 'slide_switch', holes: ['a1', 'a2', 'a3'] })
    expect(cues(diff(slide, patched(slide, 'S1', { params: { state: 'b' } })))).toEqual(['slide'])
    const toggle = one({ id: 'S2', type: 'toggle_switch', holes: ['a1', 'a2', 'a3'] })
    expect(cues(diff(toggle, patched(toggle, 'S2', { params: { state: 'b' } })))).toEqual(['toggle'])
    const dip = one({ id: 'DIP1', type: 'dip_switch_8', at: 'f10', params: { on: '00010000' } })
    expect(diff(dip, patched(dip, 'DIP1', { params: { on: '10000001' } }))).toEqual([{ cue: 'dip', count: 3, ids: ['DIP1'] }])
    const pot = one({ id: 'POT1', type: 'potentiometer', holes: ['a1', 'a2', 'a3'], params: { position: 0.5 } })
    expect(diff(pot, patched(pot, 'POT1', { params: { position: 0.51 } }))).toEqual([]) // inside one 1/32 step
    expect(diff(pot, patched(pot, 'POT1', { params: { position: 0.6 } }))).toEqual([{ cue: 'pot', level: 0.6, ids: ['POT1'] }])
    const lcd = one({ id: 'LCD1', type: 'lcd1602_i2c', at: 'a1' })
    expect(cues(diff(lcd, patched(lcd, 'LCD1', { params: { contrast: 0.2 } })))).toEqual(['pot'])
    const enc = one({ id: 'ENC1', type: 'ky040_encoder', at: 'e30' })
    expect(diff(enc, patched(enc, 'ENC1', { params: { position: 3 } }))).toEqual([{ cue: 'detent', count: 3, ids: ['ENC1'] }])
    expect(diff(enc, patched(enc, 'ENC1', { params: { position: -9 } }))[0].count).toBe(4)
    const bp = one({ id: 'U1', type: 'stm32_bluepill', at: 'h10' })
    expect(cues(diff(bp, patched(bp, 'U1', { params: { boot0: '1' } })))).toEqual(['jumper'])
    const drv = one({ id: 'M1', type: 'l298n_module' })
    expect(cues(diff(drv, patched(drv, 'M1', { params: { jumper5v: false } })))).toEqual(['jumper'])
    const dmm = one({ id: 'DMM1', type: 'multimeter', params: { mode: 'V' } })
    expect(cues(diff(dmm, patched(dmm, 'DMM1', { params: { mode: 'A' } })))).toEqual(['rotary'])
  })

  it('knobs that are not mechanical, structural values: silent', () => {
    expect(diff(BENCH, patched(BENCH, 'PS1', { params: { voltage: 9 } }))).toEqual([])
    expect(diff(BENCH, patched(BENCH, 'R1', { params: { resistance: 1000 } }))).toEqual([])
    const ldr = one({ id: 'LDR1', type: 'photoresistor', holes: ['a1', 'a2'] })
    expect(diff(ldr, patched(ldr, 'LDR1', { params: { light: 0.9 } }))).toEqual([])
    const joy = one({ id: 'J1', type: 'joystick_xy', at: 'a1' })
    expect(diff(joy, patched(joy, 'J1', { params: { x: 60 } }))).toEqual([])
  })

  it('modes: a first wire end or a lead tip picked ticks; the rest is silent', () => {
    expect(cues(modeCuesOf({ kind: 'wire', from: null, color: 'red' }, { kind: 'wire', from: 'a10', color: 'red' }))).toEqual(['wire-tip'])
    expect(modeCuesOf({ kind: 'wire', from: 'a10', color: 'red' }, { kind: 'wire', from: 'a10', color: 'blue' })).toEqual([])
    expect(modeCuesOf({ kind: 'wire', from: 'a10', color: 'red' }, { kind: 'wire', from: null, color: 'red' })).toEqual([])
    expect(cues(modeCuesOf({ kind: 'place', type: 'resistor', pickedHoles: [] }, { kind: 'place', type: 'resistor', pickedHoles: ['c10'] }))).toEqual(['wire-tip'])
    expect(modeCuesOf({ kind: 'select' }, { kind: 'place', type: 'resistor', pickedHoles: [] })).toEqual([])
  })

  it('holds: a finger on a kept button presses it; the latch taking a held one over locks it', () => {
    const down = one({ id: 'SW1', type: 'pushbutton', at: 'e30', params: { pressed: true } })
    expect(holdCuesOf([], ['SW1'], down)).toEqual([{ cue: 'press', ids: ['SW1'] }])
    expect(holdCuesOf(['SW1'], [], down)).toEqual([{ cue: 'latch', ids: ['SW1'] }])
    const up = one({ id: 'SW1', type: 'pushbutton', at: 'e30' })
    expect(holdCuesOf([], ['SW1'], up)).toEqual([]) // pressMomentary: the press is the param change
    expect(holdCuesOf(['SW1'], [], up)).toEqual([])
  })
})

// ---------------------------------------------------------------- relays

const RELAY: CircuitLayout = { version: 1, name: 'relay', components: [{ id: 'K1', type: 'relay_5v', at: 'd20' }], wires: [] }
const relayTele = (time: number, no: number, via: 'part' | 'sub' = 'part'): SimTelemetry =>
  ({
    time,
    netVoltages: {},
    issues: [],
    components: { K1: via === 'part' ? { values: { no } } : { sub: { K: { values: { no } } } } },
  }) as unknown as SimTelemetry

describe('RelayEdges: real contact edges only', () => {
  it('rest → operated → rest: relay-on, then relay-off; one edge per change', () => {
    const r = new RelayEdges()
    r.loaded(RELAY)
    expect(r.frame(0, relayTele(0, 0))).toBeNull()
    expect(r.frame(0.03, relayTele(0.03, 0))).toBeNull()
    expect(r.frame(0.05, relayTele(0.05, 1))).toEqual({ on: 1, off: 0 })
    expect(r.frame(0.06, relayTele(0.06, 1))).toBeNull()
    expect(r.frame(0.07, relayTele(0.07, 0, 'sub'))).toEqual({ on: 0, off: 1 }) // read from the sub-circuit when the part has none
  })

  it('an unrelated edit rebuilds the world: the relay drops and re-picks inside the settle window — silent', () => {
    const r = new RelayEdges()
    r.loaded(RELAY)
    r.frame(0, relayTele(0, 0))
    r.frame(0.03, relayTele(0.03, 1))
    r.loaded(RELAY) // an edit
    expect(r.frame(1.0, relayTele(1.0, 0))).toBeNull()
    expect(r.frame(1.0 + RELAY_SETTLE_S / 2, relayTele(1.01, 1))).toBeNull()
    expect(r.frame(1.0 + RELAY_SETTLE_S * 1.5, relayTele(1.03, 1))).toBeNull()
    expect(r.frame(1.05, relayTele(1.05, 1))).toBeNull()
  })

  it('a load that really changes the contact (its drive removed) clicks once, after the settle', () => {
    const r = new RelayEdges()
    r.loaded(RELAY)
    r.frame(0, relayTele(0, 0))
    r.frame(0.03, relayTele(0.03, 1))
    r.loaded(RELAY)
    expect(r.frame(2.0, relayTele(2.0, 0))).toBeNull()
    expect(r.frame(2.0 + RELAY_SETTLE_S, relayTele(2.02, 0))).toEqual({ on: 0, off: 1 })
    expect(r.frame(2.05, relayTele(2.05, 0))).toBeNull()
  })

  it('reset: the world restarts at rest; no relays: nothing to do', () => {
    const r = new RelayEdges()
    r.loaded(RELAY)
    r.frame(0, relayTele(0, 0))
    r.frame(0.03, relayTele(0.03, 1))
    r.clear()
    expect(r.frame(0.001, relayTele(0.001, 0))).toBeNull()
    expect(r.frame(0.01, relayTele(0.01, 1))).toEqual({ on: 1, off: 0 })
    const none = new RelayEdges()
    none.loaded(BENCH)
    expect(none.frame(0, relayTele(0, 1))).toBeNull()
  })
})

// ---------------------------------------------------------------- the watcher

describe('startMechSoundWatch: the store, the holds and the host, one sound per change', () => {
  let stop: () => void = () => undefined
  const heard = () => played.map((p) => p.cue)
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __setCelebrationsSuppressedForTests(null)
    __resetHistoryForTests()
    useStore.setState({ layout: EMPTY, selection: [], mode: { kind: 'select' }, running: false })
    useLatchHolds.setState({ held: [] })
    stop = startMechSoundWatch()
    played.length = 0
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __setSimHostFactoryForTests(null)
    useStore.setState({ running: false })
  })

  it('load, insert (with its leads), the Delete key pulls once', () => {
    st().loadLayout(BENCH)
    st().addComponent('resistor', { holes: ['c30', 'c34'] })
    expect(played).toEqual([{ cue: 'load', opts: {} }, { cue: 'insert', opts: { count: 2, kind: 'leads' } }])
    st().select('LED1')
    removeSelectedWithFeedback()
    expect(heard()).toEqual(['load', 'insert', 'pull'])
  })

  it('a button: press / release, the double-click latch, a finger on the kept button', () => {
    useStore.setState({ layout: one({ id: 'SW1', type: 'pushbutton', at: 'e30' }) })
    played.length = 0
    pressMomentary('SW1', true)
    pressMomentary('SW1', false)
    expect(heard()).toEqual(['press', 'release'])
    // the double-click: press, release, press, and the second press stays (latchPart); its up is ignored
    played.length = 0
    pressMomentary('SW1', true)
    pressMomentary('SW1', false)
    pressMomentary('SW1', true)
    latchPart('SW1')
    pressMomentary('SW1', false)
    expect(heard()).toEqual(['press', 'release', 'press', 'latch'])
    // a finger presses the kept button, lets go (that releases it)
    played.length = 0
    pressMomentary('SW1', true)
    pressMomentary('SW1', false)
    expect(heard()).toEqual(['press', 'release'])
    // the inspector's 保持按下 switch
    played.length = 0
    setLatched('SW1', true)
    setLatched('SW1', false)
    expect(heard()).toEqual(['latch', 'release'])
  })

  it('undo / redo: one distinct swish, never the inverse edit; withMechCause restores after a throw', () => {
    st().addComponent('resistor', { holes: ['c30', 'c34'] })
    undoWithFeedback()
    redoWithFeedback()
    expect(heard()).toEqual(['insert', 'undo', 'redo'])
    expect(() => withMechCause('undo', () => {
      throw new Error('x')
    })).toThrow('x')
    st().addComponent('resistor', { holes: ['c40', 'c44'] })
    expect(heard().at(-1)).toBe('insert')
  })

  it('the wire mode: the first end ticks, the finished wire clicks in; hovering is silent', () => {
    st().setMode({ kind: 'wire', from: null, color: 'red' })
    st().setHoverHole('a10')
    st().setMode({ kind: 'wire', from: 'a10', color: 'red' })
    st().addWire('a10', 'top+3')
    expect(heard()).toEqual(['wire-tip', 'wire-in'])
  })

  it('a new board module: the scene’s touchdown clack, once — the store-side one only with no scene', () => {
    vi.useFakeTimers()
    st().growGrid('right')
    expect(heard()).toEqual(['board']) // no scene shows the board: at once
    played.length = 0
    setSceneShowing(() => true)
    try {
      st().growGrid('right')
      vi.advanceTimersByTime(5000) // however slow the rebuild: nothing from the store side
      expect(heard()).toEqual([])
      voiceSceneCue('board') // the scene's drop lands
      expect(heard()).toEqual(['board'])
    } finally {
      setSceneShowing(null)
    }
    // a board taken away: at once
    played.length = 0
    st().setBoardCount(1)
    expect(heard()).toEqual(['board'])
  })

  it('relays click from the host frames — only while running and visible; an unrelated edit is silent', () => {
    const hosts: { cb: SimHostCallbacks; rev: number }[] = []
    __setSimHostFactoryForTests((cb) => {
      const h = { cb, rev: 0 }
      hosts.push(h)
      const base: Record<string, unknown> = {
        kind: 'inline',
        load: (_l: CircuitLayout, rev: number) => void (h.rev = rev),
        query: () => new Promise(() => undefined),
      }
      return new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : () => undefined) }) as unknown as SimHost
    })
    useStore.setState({ layout: RELAY })
    st().startSim()
    const host = hosts[hosts.length - 1]
    const frame = (time: number, no: number) =>
      host.cb.onFrame({
        rev: host.rev,
        time,
        running: true,
        telemetry: relayTele(time, no),
        scope: [],
        uart: [],
        mcus: [],
        log: [],
        issues: [],
        perf: { realtimeFactor: 1, stepsPerSecond: 1, busyMs: 1 },
      } as SimFrame)
    played.length = 0
    frame(0, 0)
    frame(0.03, 0)
    frame(0.05, 1)
    frame(0.06, 1)
    expect(played).toEqual([{ cue: 'relay-on', opts: { count: 1 } }])
    // an edit rebuilds the world: drop + re-pick inside the settle window — no click
    st().addComponent('resistor', { holes: ['c40', 'c44'] })
    played.length = 0
    frame(0.07, 0)
    frame(0.08, 1)
    frame(0.1, 1)
    expect(heard()).toEqual([])
    // a hidden tab: the state is followed, nothing sounds
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    frame(0.11, 0)
    expect(heard()).toEqual([])
    vi.unstubAllGlobals()
    frame(0.12, 1)
    expect(heard()).toEqual(['relay-on'])
    // paused: silent too
    st().stopSim()
    frame(0.13, 0)
    expect(heard()).toEqual(['relay-on'])
  })

  it('the classic chrome is silent; ?shotrig installs nothing; ref-counted, one sound per change', () => {
    __setLangForTests('en')
    st().loadLayout(BENCH)
    st().addComponent('resistor', { holes: ['c30', 'c34'] })
    expect(heard()).toEqual([])
    __setLangForTests('zh-TW')
    // a second caller (StrictMode's double mount): still one sound
    const second = startMechSoundWatch()
    expect(mechWatchCount()).toBe(2)
    st().addComponent('resistor', { holes: ['c40', 'c44'] })
    expect(heard()).toEqual(['insert'])
    second()
    second() // stopping twice is harmless
    expect(mechWatchCount()).toBe(1)
    stop()
    stop = () => undefined
    expect(mechWatchCount()).toBe(0)
    st().addComponent('resistor', { holes: ['c50', 'c54'] })
    expect(heard()).toEqual(['insert'])
    // the visual-regression harness
    __setCelebrationsSuppressedForTests(true)
    stop = startMechSoundWatch()
    st().addComponent('resistor', { holes: ['c60', 'c64'] })
    expect(heard()).toEqual(['insert'])
    __setCelebrationsSuppressedForTests(null)
  })
})

// ---------------------------------------------------------------- the recipes

interface Ev {
  type: 'click' | 'thock' | 'ring' | 'scrape'
  at: number
  end: number
  peak: number
  freqs: number[]
}

function recorder(): { synth: Synth; events: Ev[] } {
  const events: Ev[] = []
  const synth: Synth = {
    click: (at, o) => void events.push({ type: 'click', at, end: at + o.dur, peak: o.peak, freqs: [o.freq] }),
    thock: (at, o) => void events.push({ type: 'thock', at, end: at + o.dur, peak: o.peak, freqs: [o.f0, o.f1] }),
    ring: (at, parts) => {
      for (const p of parts) events.push({ type: 'ring', at, end: at + p.decay, peak: p.gain, freqs: [p.f] })
    },
    scrape: (at, o) => void events.push({ type: 'scrape', at, end: at + o.dur, peak: o.peak, freqs: [o.f0, o.f1] }),
  }
  return { synth, events }
}

function rendered(cue: MechCue, opts: Parameters<typeof renderMech>[3] = {}, wrap?: (s: Synth) => Synth): Ev[] {
  const rec = recorder()
  renderMech(wrap ? wrap(rec.synth) : rec.synth, cue, 0, opts)
  return rec.events
}

describe('mech-voices: every recipe is short, bounded and tactile', () => {
  const variants: Parameters<typeof renderMech>[3][] = [
    {},
    { count: 1 },
    { count: 16, kind: 'dip' },
    { count: 4, kind: 'footprint' },
    { count: 2, kind: 'offboard' },
    { count: 1, kind: 'probe' },
    { count: 8, level: 0 },
    { count: 3, level: 1, rand: () => 0.999 },
  ]

  it('every MechCue renders, peaks in (0, 1], audible frequencies, over within MAX_CUE_S', () => {
    expect(MECH_CUES).toHaveLength(28)
    for (const cue of MECH_CUES) {
      for (const v of variants) {
        for (const wrap of [undefined, (s: Synth) => jitterSynth(s, 1.04, 1.19), (s: Synth) => jitterSynth(s, 0.96, 0.84)]) {
          const ev = rendered(cue, v, wrap)
          expect(ev.length, cue).toBeGreaterThan(0)
          for (const e of ev) {
            expect(e.peak, `${cue} ${e.type}`).toBeGreaterThan(0)
            expect(e.peak, `${cue} ${e.type}`).toBeLessThanOrEqual(1)
            expect(e.at, cue).toBeGreaterThanOrEqual(0)
            expect(e.end, `${cue} ${JSON.stringify(v)}`).toBeLessThanOrEqual(MAX_CUE_S)
            for (const f of e.freqs) {
              expect(f, cue).toBeGreaterThanOrEqual(40)
              expect(f, cue).toBeLessThanOrEqual(8000)
            }
          }
          // layered: a transient (click) on top of a body, or a ring / friction
          expect(new Set(ev.map((e) => e.type)).size, cue).toBeGreaterThanOrEqual(cue === 'snap' || cue === 'pot' ? 1 : 2)
        }
      }
    }
  })

  it('a many-lead part sounds longer and lower; a DIP thocks lower than two leads', () => {
    const end = (ev: Ev[]) => Math.max(...ev.map((e) => e.end))
    const low = (ev: Ev[]) => Math.min(...ev.filter((e) => e.type === 'thock').map((e) => e.freqs[0]))
    const two = rendered('insert', { count: 2 })
    const sixteen = rendered('insert', { count: 16 })
    expect(end(sixteen)).toBeGreaterThan(end(two))
    expect(low(sixteen)).toBeLessThan(low(two))
    expect(sixteen.filter((e) => e.type === 'click')).toHaveLength(6) // the zip: at most six clicks
    expect(two.filter((e) => e.type === 'click')).toHaveLength(2)
    expect(low(rendered('insert', { count: 8, kind: 'dip' }))).toBeLessThan(low(two))
    expect(heaviness(2)).toBe(0)
    expect(heaviness(16)).toBe(1)
  })

  it('varied per hit: the zip spacing follows the per-hit randomness; a pot ticks higher at the top of its travel', () => {
    const times = (r: number) => rendered('insert', { count: 4, rand: () => r }).filter((e) => e.type === 'click').map((e) => e.at)
    expect(times(0.1)).not.toEqual(times(0.9))
    const f = (level: number) => rendered('pot', { level })[0].freqs[0]
    expect(f(1)).toBeGreaterThan(f(0))
    expect(cues2('undo')).not.toEqual(cues2('redo'))
  })

  it('noiseMakeup brings band-passed noise to unit peak: more for a narrower band, never below 1 or above 8', () => {
    expect(noiseMakeup(3500, 6, 48000)).toBeGreaterThan(noiseMakeup(3500, 1, 48000))
    expect(noiseMakeup(3500, 6, 48000)).toBeGreaterThan(2)
    expect(noiseMakeup(100, 0.1, 8000)).toBeGreaterThanOrEqual(1)
    expect(noiseMakeup(20000, 100, 192000)).toBeLessThanOrEqual(8)
  })
})

/** the first and last frequency of a cue's sweep (undo falls, redo rises) */
function cues2(cue: MechCue): number[] {
  return rendered(cue).find((e) => e.type === 'scrape')!.freqs
}

// ---------------------------------------------------------------- the engine

class FakeParam {
  value = 0
  setValueAtTime(): this {
    return this
  }
  linearRampToValueAtTime(): this {
    return this
  }
  exponentialRampToValueAtTime(): this {
    return this
  }
}

class FakeNode {
  connect<T>(n: T): T {
    return n
  }
  disconnect(): void {}
}

const contexts: FakeAC[] = []

class FakeAC {
  state = 'suspended'
  currentTime = 0
  sampleRate = 48000
  destination = new FakeNode()
  /** sources + oscillators started */
  starts = 0
  resumes = 0
  /** resume() makes it run (false: a browser that refuses outside a real gesture) */
  resumable = true
  private readonly onState: (() => void)[] = []
  constructor(readonly options?: unknown) {
    contexts.push(this)
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.onState.push(fn)
  }
  setState(s: string): void {
    this.state = s
    for (const f of this.onState) f()
  }
  resume(): Promise<void> {
    this.resumes++
    if (this.resumable) this.setState('running')
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() })
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() })
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    })
  }
  createOscillator() {
    const starts = () => void this.starts++
    return Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), start: starts, stop() {} })
  }
  createBufferSource() {
    const starts = () => void this.starts++
    return Object.assign(new FakeNode(), { buffer: null as unknown, start: starts, stop() {} })
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
}

describe('sound.ts engine on a stand-in AudioContext', () => {
  let real: typeof import('../src/ui/fx/sound')
  let listeners: Map<string, Set<() => void>>
  const gesture = () => {
    for (const fn of [...(listeners.get('pointerdown') ?? [])]) fn()
  }
  beforeAll(async () => {
    real = await vi.importActual<typeof import('../src/ui/fx/sound')>('../src/ui/fx/sound')
  })
  beforeEach(() => {
    contexts.length = 0
    listeners = new Map()
    vi.stubGlobal('window', {
      AudioContext: FakeAC,
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
    })
    real.useSound.getState().setEnabled(true)
    real.__resetSoundForTests({ gestured: false, dropContext: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    real.useSound.getState().setEnabled(true)
    real.__resetSoundForTests({ dropContext: true })
  })

  it('quiet: QUIET_GAIN ≤ 0.2, the mechanical bus below it; every cue has a spacing', () => {
    expect(real.QUIET_GAIN).toBeLessThanOrEqual(0.2)
    expect(real.MECH_GAIN).toBeLessThanOrEqual(1)
    expect(Object.keys(real.MECH_GAP_MS).sort()).toEqual([...MECH_CUES].sort())
    expect(real.MAX_LIVE_CUES).toBeGreaterThanOrEqual(4)
  })

  it('nothing before a gesture; the gesture itself creates and resumes the context and plays one silent sample', () => {
    real.playMech('press')
    expect(contexts).toHaveLength(0)
    expect(real.__soundStatsForTests().listening).toBe(true)
    gesture()
    expect(real.soundUnlocked()).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resumes).toBe(1)
    expect(contexts[0].starts).toBe(1) // the silent unlock buffer
    expect(real.__soundStatsForTests().listening).toBe(false) // running: the gate rests
    real.playMech('press')
    expect(real.__soundStatsForTests().started).toBe(1)
    expect(contexts[0].starts).toBeGreaterThan(1)
  })

  it('a key that activates nothing (a lone Ctrl, Esc) waits for a real gesture — no suspended context, no console warning', () => {
    const activation = { isActive: false }
    vi.stubGlobal('navigator', { userActivation: activation })
    gesture()
    expect(real.soundUnlocked()).toBe(false)
    expect(contexts).toHaveLength(0)
    expect(real.__soundStatsForTests().listening).toBe(true)
    activation.isActive = true
    gesture()
    expect(real.soundUnlocked()).toBe(true)
    expect(contexts).toHaveLength(1)
  })

  it('a context the browser keeps suspended keeps the gate listening; an interruption re-arms it', () => {
    gesture()
    const ac = contexts[0]
    ac.setState('interrupted') // iOS: a call, another app
    expect(real.__soundStatsForTests().listening).toBe(true)
    ac.resumable = false
    gesture()
    expect(ac.resumes).toBe(2)
    expect(real.__soundStatsForTests().listening).toBe(true)
    ac.resumable = true
    gesture()
    expect(real.__soundStatsForTests().listening).toBe(false)
    expect(contexts).toHaveLength(1) // the same context, revived
  })

  it('音效 off: no context, no nodes — even after a gesture', () => {
    real.useSound.getState().setEnabled(false)
    gesture()
    real.playMech('insert', { count: 4 })
    real.playCue('success')
    expect(contexts).toHaveLength(0)
    expect(real.__soundStatsForTests().started).toBe(0)
  })

  it('the voice cap: a burst of different cues starts at most MAX_LIVE_CUES; room again once they end', () => {
    real.__resetSoundForTests({ gestured: true, dropContext: true })
    for (const cue of MECH_CUES) real.playMech(cue)
    expect(real.__soundStatsForTests().started).toBe(real.MAX_LIVE_CUES)
    contexts[0].currentTime = 10
    real.playMech('pull', { count: 3 }) // it sounded in the burst: still inside its spacing
    real.playMech('rotary') // dropped by the cap, so not spaced
    real.playMech('wire-in')
    expect(real.__soundStatsForTests().started).toBe(real.MAX_LIVE_CUES + 2)
  })

  it('the per-cue spacing drops a second press within 25 ms, not one after', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    real.__resetSoundForTests({ gestured: true, dropContext: true })
    real.playMech('press')
    now += 10
    real.playMech('press')
    expect(real.__soundStatsForTests().started).toBe(1)
    real.playMech('release') // another cue is not held back
    expect(real.__soundStatsForTests().started).toBe(2)
    now += real.MECH_GAP_MS.press
    real.playMech('press')
    expect(real.__soundStatsForTests().started).toBe(3)
  })

  it('the older edit cues play the mechanical voices; never a throw', () => {
    real.__resetSoundForTests({ gestured: true, dropContext: true })
    for (const cue of ['place', 'wire', 'delete'] as const) expect(() => real.playCue(cue)).not.toThrow()
    expect(real.__soundStatsForTests().started).toBe(3)
    expect(() => real.playMech('relay-on', { count: 2, gain: 5 })).not.toThrow()
    expect(() => real.playMech('pot', { level: Number.NaN })).not.toThrow()
  })
})
