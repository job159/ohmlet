/**
 * cheer: the success watcher on REAL circuits — the real simulation engine,
 * the real problems list (runErc + the live rules), the real stores — for
 * the reviewer's cases:
 *  - s29: an LED at 21 mA behind 150 Ω (「LED1 的限流電阻太小」) → no
 *    「電路正常運作 ✓」; with 330 Ω it cheers, once, after the window;
 *  - s14: a reversed electrolytic that vents → no cheer (the damage cancels it);
 *  - s26: deleting a part of a working circuit never re-cheers;
 *  - M1 (final walkthrough w14 / w13): the npn-switch example's LED lit by a
 *    ~1 s button press → no cheer over the dark LED; a FINGER holding the
 *    button past the window (1.4 s, 2.5 s, 4 s) never cheers either — the LED
 *    goes dark with the release; 保持按下 (kept pressed) past the window
 *    cheers while the LED is lit;
 *  - the visual-regression harness (?shotrig): nothing at all.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { SimEngine } from '../src/sim/engine'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { useLatchHolds } from '../src/ui/embedded/latch'
import { __resetProblemsForTests, recomputeProblems, useProblems } from '../src/ui/embedded/problems'
import { __resetCelebrationForTests, __setCelebrationsSuppressedForTests, celebrate, useCelebration } from '../src/ui/fx/celebrate'
import { CHEER_WINDOW_S, pressedInputs, startSuccessWatch, successWatchCount } from '../src/ui/fx/success-watch'
import { onSceneFx, type SceneFxEvent } from '../src/three/internal/fx/bus'
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
  for (const x of getToasts()) dismissToast(x.id)
  useLab.setState({ firmware: {}, mcus: {} })
})
afterEach(() => {
  stop?.()
  stop = null
  useLatchHolds.setState({ held: [] })
  __resetProblemsForTests()
  useStore.setState({ running: false, simTime: 0, telemetry: null, issues: [] })
})

/**
 * Run `engine` from its current time for `seconds`, pushing a snapshot into
 * the store at 10 Hz (the store's React rate) and computing the problems
 * list once per simulated second (the watcher's live rate). `offset` keeps
 * the clock running across a rebuild (the coordinator preserves it).
 */
function feed(engine: SimEngine, layout: CircuitLayout, seconds: number, offset = 0, onSnap?: (t: SimTelemetry) => void): void {
  useStore.setState({ layout, running: true })
  let nextProblems = 0
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    engine.advance(0.1, 1e-3)
    const raw = engine.telemetry()
    const tele: SimTelemetry = { ...raw, time: raw.time + offset }
    useStore.setState({ telemetry: tele, simTime: tele.time, issues: raw.issues })
    if (raw.time >= nextProblems) {
      recomputeProblems()
      nextProblems += 1
    }
    onSnap?.(tele)
  }
}

const okToasts = () => getToasts().filter((x) => x.text.startsWith('電路正常運作'))
const okCount = () => useCelebration.getState().count['circuit-ok']

const ledCircuit = (r: number): CircuitLayout =>
  valid({
    version: 1,
    components: [PS(5), { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: r } }, { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } }],
    wires: RAILS,
  })

describe('cheer: the success watcher on real circuits', () => {
  it('s29: an LED at 21 mA (warning on LED1) never cheers; with 330 Ω it cheers once, only after the window', () => {
    stop = startSuccessWatch()
    const hot = ledCircuit(150)
    feed(new SimEngine(hot), hot, 4)
    const titles = useProblems.getState().problems.filter((p) => p.level === 'warning').map((p) => p.title)
    expect(titles.join(' ')).toMatch(/LED1/) // the pill names LED1
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)

    const ok = ledCircuit(330) // a new resistor value: a new revision
    let firedAt = -1
    feed(new SimEngine(ok), ok, 3, 4, (t) => {
      if (firedAt < 0 && okCount() > 0) firedAt = t.time
    })
    expect(okCount()).toBe(1)
    expect(firedAt - 4).toBeGreaterThanOrEqual(CHEER_WINDOW_S)
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED1 亮了'])
  })

  it('s14: a reversed electrolytic that vents: no cheer — Problems says 「C1 反接爆開」', () => {
    stop = startSuccessWatch()
    const l = valid({
      version: 1,
      components: [
        PS(12),
        { id: 'R2', type: 'resistor', holes: ['top+13', 'a20'], params: { resistance: 1000 } },
        { id: 'LED1', type: 'led', holes: ['b20', 'top-24'], params: { color: 'green' } },
        { id: 'C1', type: 'capacitor', holes: ['top-30', 'top+31'], params: { polarized: true, capacitance: 0.0001 } },
      ],
      wires: RAILS,
    })
    let litAt = -1
    let ventAt = -1
    feed(new SimEngine(l), l, 6, 0, (t) => {
      if (litAt < 0 && (t.components.LED1?.light ?? 0) >= 0.05) litAt = t.time
      if (ventAt < 0 && t.components.C1?.damage) ventAt = t.time
    })
    expect(litAt).toBeGreaterThanOrEqual(0) // the LED really lit: there was something to cheer about
    expect(ventAt).toBeGreaterThan(litAt)
    expect(ventAt - litAt).toBeLessThan(CHEER_WINDOW_S) // the vent lands inside the window
    expect(useProblems.getState().problems.some((p) => p.fact === 'vented:C1')).toBe(true)
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)
  })

  it('s26: deleting a part of a working circuit (R2 left dangling) never re-cheers', () => {
    stop = startSuccessWatch()
    const both = valid({
      version: 1,
      components: [
        PS(5),
        { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
        { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
        { id: 'R2', type: 'resistor', holes: ['top+8', 'a16'], params: { resistance: 330 } },
        { id: 'LED2', type: 'led', holes: ['b16', 'top-9'], params: { color: 'green' } },
      ],
      wires: RAILS,
    })
    feed(new SimEngine(both), both, 2.5)
    expect(okCount()).toBe(1)
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED1 亮了 · LED2 亮了'])
    for (const x of getToasts()) dismissToast(x.id)
    __resetCelebrationForTests() // forget the dedupe clock: only the watcher's rules may hold the cheer back
    const one: CircuitLayout = { ...both, components: both.components.filter((c) => c.id !== 'LED2') }
    feed(new SimEngine(one), one, 4, 2.5)
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)
    // … and the undo (the very same circuit as before) does not either
    feed(new SimEngine(both), both, 3, 6.5)
    expect(okCount()).toBe(0)
  })

  it('s26 inside the first window: Delete 0.7 s after Run (both LEDs lit, not cheered yet) → no cheer after it, nor after Ctrl+Z', () => {
    stop = startSuccessWatch()
    const both = valid({
      version: 1,
      components: [
        PS(5),
        { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
        { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
        { id: 'R2', type: 'resistor', holes: ['top+8', 'a16'], params: { resistance: 330 } },
        { id: 'LED2', type: 'led', holes: ['b16', 'top-9'], params: { color: 'green' } },
      ],
      wires: RAILS,
    })
    let lit = 0
    feed(new SimEngine(both), both, 0.7, 0, (t) => {
      if ((t.components.LED1?.light ?? 0) >= 0.05 && (t.components.LED2?.light ?? 0) >= 0.05) lit++
    })
    expect(lit).toBeGreaterThan(0) // both really lit before the delete
    expect(okCount()).toBe(0) // … but the window had not finished
    const one: CircuitLayout = { ...both, components: both.components.filter((c) => c.id !== 'LED2') }
    feed(new SimEngine(one), one, 4, 0.7)
    expect(useProblems.getState().problems.some((p) => p.componentIds.includes('R2'))).toBe(true) // the pill: R2 dangles
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)
    feed(new SimEngine(both), both, 4, 4.7) // Ctrl+Z
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)
  })

  it('a pause and a resume of a working circuit: no repeat; a reset of the same circuit: no repeat', () => {
    stop = startSuccessWatch()
    const ok = ledCircuit(330)
    const e = new SimEngine(ok)
    feed(e, ok, 2)
    expect(okCount()).toBe(1)
    __resetCelebrationForTests()
    useStore.setState({ running: false })
    feed(e, ok, 2) // resumed
    expect(okCount()).toBe(0)
  })
})

describe('cheer: a button press is not a working circuit (M1, the npn-switch example)', () => {
  const NPN: CircuitLayout = valid(JSON.parse(readFileSync(path.join(__dirname, '..', 'examples/embedded/npn-switch.ohmlet.json'), 'utf8')).layout)
  const withSw = (pressed: boolean): CircuitLayout => ({
    ...NPN,
    components: NPN.components.map((c) => (c.id === 'SW1' ? { ...c, params: { ...(c.params ?? {}), pressed } } : c)),
  })
  /** press (or release) SW1 the way the app does: the runtime param in the engine and in the document */
  const setSw = (e: SimEngine, pressed: boolean): CircuitLayout => {
    e.setRuntimeParam('SW1', 'pressed', pressed)
    return withSw(pressed)
  }

  it('pressedInputs: the momentary inputs a hand holds (a pushbutton’s runtime pressed), sorted', () => {
    expect(pressedInputs(NPN)).toBe('')
    expect(pressedInputs(withSw(true))).toBe('SW1')
    expect(pressedInputs({ ...NPN, components: NPN.components.map((c) => (c.id === 'R1' ? { ...c, params: { ...c.params, pressed: true } } : c)) })).toBe('')
  })

  it('w14: SW1 held ~1 s lights LED1 only while held → no 「電路正常運作 ✓」 over the dark LED, then or later', () => {
    stop = startSuccessWatch()
    const e = new SimEngine(NPN)
    feed(e, NPN, 1.2)
    expect(e.telemetry().components.LED1?.light ?? 0).toBeLessThan(0.05) // dark until pressed
    let litDuringPress = 0
    feed(e, setSw(e, true), 1.0, 0, (t) => {
      if ((t.components.LED1?.light ?? 0) >= 0.05) litDuringPress++
    })
    expect(litDuringPress).toBeGreaterThan(5) // the press really lit it
    let lightAtCue: number | null = null
    feed(e, setSw(e, false), 5, 0, (t) => {
      if (lightAtCue === null && okCount() > 0) lightAtCue = t.components.LED1?.light ?? 0
    })
    expect(lightAtCue).toBeNull()
    expect(okCount()).toBe(0)
    expect(okToasts()).toHaveLength(0)
  })

  /** a finger on SW1 the way the app holds it (latch.ts pressMomentary: held while pressed) */
  const finger = (e: SimEngine, down: boolean): CircuitLayout => {
    if (down) useLatchHolds.setState({ held: ['SW1'] })
    const l = setSw(e, down)
    useStore.setState({ layout: l })
    if (!down) useLatchHolds.setState({ held: [] })
    return l
  }

  it('M1 verification: a FINGER holding SW1 just past the window (1.4 s, 2.5 s) or long (4 s): no cheer while held, none after the release', () => {
    for (const hold of [1.4, 2.5, 4]) {
      stop?.()
      __resetCelebrationForTests()
      for (const x of getToasts()) dismissToast(x.id)
      stop = startSuccessWatch()
      const e = new SimEngine(NPN)
      feed(e, NPN, 1.2)
      let litWhileHeld = 0
      feed(e, finger(e, true), hold, 0, (t) => {
        if ((t.components.LED1?.light ?? 0) >= 0.05) litWhileHeld++
      })
      expect(litWhileHeld).toBeGreaterThan(5) // the finger really lit it
      expect({ hold, cheersWhileHeld: okCount() }).toEqual({ hold, cheersWhileHeld: 0 })
      feed(e, finger(e, false), 4)
      expect(e.telemetry().components.LED1?.light ?? 0).toBeLessThan(0.05) // dark again
      expect({ hold, cheers: okCount(), toasts: okToasts().length }).toEqual({ hold, cheers: 0, toasts: 0 })
    }
  })

  it('… a finger, then 保持按下 (the long-press sheet): the cheer plays once, while LED1 is lit and stays lit', () => {
    stop = startSuccessWatch()
    const e = new SimEngine(NPN)
    feed(e, NPN, 1.2)
    feed(e, finger(e, true), 0.9)
    expect(okCount()).toBe(0)
    useLatchHolds.setState({ held: [] }) // 保持按下: the button stays pressed, the finger is off (setLatched → endHold)
    let lightAtCue: number | null = null
    feed(e, withSw(true), 4, 0, (t) => {
      if (lightAtCue === null && okCount() > 0) lightAtCue = t.components.LED1?.light ?? 0
    })
    expect(okCount()).toBe(1)
    expect(lightAtCue!).toBeGreaterThanOrEqual(0.05)
    expect(e.telemetry().components.LED1?.light ?? 0).toBeGreaterThanOrEqual(0.05) // still lit after the toast
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED1 亮了'])
  })

  it('… the same button KEPT pressed (保持按下) past the window: the cheer plays while LED1 is lit', () => {
    stop = startSuccessWatch()
    const e = new SimEngine(NPN)
    feed(e, NPN, 1.2)
    let lightAtCue: number | null = null
    feed(e, setSw(e, true), 3, 0, (t) => {
      if (lightAtCue === null && okCount() > 0) lightAtCue = t.components.LED1?.light ?? 0
    })
    expect(okCount()).toBe(1)
    expect(lightAtCue).not.toBeNull()
    expect(lightAtCue!).toBeGreaterThanOrEqual(0.05)
    expect(okToasts().map((x) => x.text)).toEqual(['電路正常運作 ✓ · LED1 亮了'])
  })
})

describe('cheer: the visual-regression harness (?shotrig) gets no celebration', () => {
  it('celebrate() does nothing — no toast, badge, 3D event or sound — and the watcher installs nothing', () => {
    __setCelebrationsSuppressedForTests(true)
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('lesson-pass', { message: 'x' })
    celebrate('circuit-ok', { componentIds: ['LED1'], message: 'LED1 亮了' })
    expect(useCelebration.getState().badge).toBeNull()
    expect(useCelebration.getState().count).toEqual({ 'lesson-pass': 0, 'circuit-ok': 0 })
    expect(useCelebration.getState().suppressed).toBe(2)
    expect(getToasts()).toHaveLength(0)
    expect(events).toHaveLength(0)
    off()

    const before = successWatchCount()
    stop = startSuccessWatch()
    expect(successWatchCount()).toBe(before + 1)
    const ok = ledCircuit(330)
    let recomputed = 0
    const unsub = useProblems.subscribe(() => recomputed++)
    useStore.setState({ layout: ok, running: true })
    const e = new SimEngine(ok)
    for (let i = 0; i < 25; i++) {
      e.advance(0.1, 1e-3)
      useStore.setState({ telemetry: e.telemetry(), simTime: e.telemetry().time })
    }
    unsub()
    expect(recomputed).toBe(0) // the harness's problems timing is untouched
    expect(useCelebration.getState().suppressed).toBe(2)
    expect(okToasts()).toHaveLength(0)
  })

  it('the harness flag is read from the URL: ?shotrig suppresses, ?shotrig&cheer (e2e) does not', async () => {
    const { celebrationsSuppressed } = await import('../src/ui/fx/celebrate')
    const g = globalThis as unknown as { window?: unknown }
    const had = 'window' in g
    const prev = g.window
    try {
      g.window = { location: { search: '?e2e&shotrig' } }
      expect(celebrationsSuppressed()).toBe(true)
      g.window = { location: { search: '?e2e&shotrig&cheer' } }
      expect(celebrationsSuppressed()).toBe(false)
      g.window = { location: { search: '?e2e' } }
      expect(celebrationsSuppressed()).toBe(false)
    } finally {
      if (had) g.window = prev
      else delete g.window
    }
  })
})
