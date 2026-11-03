/**
 * Round 5 polish — the mechanical sounds (owner: sound; product owner:
 * 「各種元器件的機械聲音，插入、點擊，有爽度」):
 *
 *  (a) relays through the REAL inline host (the no-Worker fallback publishes
 *      the new world's first frame before 'loaded'): an unrelated edit never
 *      clicks a held relay off / on; removing its drive still clicks once;
 *  (b) a new board module: while a scene shows the board its touchdown is
 *      the only clack (never early, never twice); with no scene, at once;
 *  (c) a paste / duplicate onto an EMPTY board is ONE insert (not a 'load'
 *      cascade); its undo one swish;
 *  (d) the classic chrome and ?shotrig: no cue plays and no AudioContext is
 *      made at the first gesture; the product chrome still wakes it there;
 *  (e) the PCF8574's A2–A0 jumpers click like the other jumpers;
 *  (f) a refusal: a soft, low thunk ≤ 0.25 s unlike any success — App.tsx's
 *      refused placements and copy-paste's no room play it, a cancel never;
 *  (g) levels through sound.ts's graph (offline emulation, the WebAudio
 *      compressor curve): insert ≈ −15 dBFS, wire-in ≈ −16, press / toggle
 *      ≈ −17, pot / detent ≈ −23, aim snap ≈ −26, undo / redo ≈ −20, and six
 *      loud cues at once ≤ −3 dBFS;
 *  (h) variety: every click a different grain of the noise, at its level;
 *  (i) the placement ghost turned with R clicks like a placed part.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const played = vi.hoisted(() => [] as { cue: string; opts?: Record<string, unknown> }[])
vi.mock('../src/ui/fx/sound', async (orig) => {
  const real = await orig<typeof import('../src/ui/fx/sound')>()
  return { ...real, playMech: (cue: string, opts?: Record<string, unknown>) => void played.push({ cue, opts }) }
})

import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, ComponentInstance } from '../src/model/types'
import { InlineSimHost, type TickScheduler } from '../src/sim/coordinator/inline-host'
import '../src/sim/models'
import { __resetHistoryForTests, __setSimHostFactoryForTests, useStore } from '../src/state/store'
import { __resetClipForTests, copySelectionWithFeedback, duplicateWithFeedback, pasteWithFeedback } from '../src/ui/chrome/copy-paste'
import { undoWithFeedback } from '../src/ui/chrome/edit-feedback'
import { useLatchHolds } from '../src/ui/embedded/latch'
import { getToasts } from '../src/ui/kit'
import { __setCelebrationsSuppressedForTests } from '../src/ui/fx/celebrate'
import {
  mechCuesOf,
  modeCuesOf,
  setSceneShowing,
  soundsHere,
  startMechSoundWatch,
  voiceSceneCue,
} from '../src/ui/fx/mech-watch'
import {
  CLICK_SPAN_S,
  CUE_LEVEL_DB,
  MAX_CUE_S,
  SCRAPE_TRIM,
  clickAttack,
  clickPeak,
  clickTop,
  envelopeAt,
  fillNoise,
  jitterSynth,
  noiseMakeup,
  renderMech,
  type Synth,
} from '../src/ui/fx/mech-voices'
import type { MechCue, MechOpts } from '../src/ui/fx/sound'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const st = () => useStore.getState()
const heard = () => played.map((p) => p.cue)
const EMPTY: CircuitLayout = { version: 1, name: 'e', components: [], wires: [] }

function openLayout(layout: CircuitLayout): void {
  useStore.setState({ layout, selection: [], mode: { kind: 'select' }, hoverHole: null, running: false })
  __resetHistoryForTests()
}

let stop: () => void = () => undefined
beforeEach(() => {
  __setLangForTests('zh-TW')
  __setCelebrationsSuppressedForTests(null)
  __resetClipForTests()
  openLayout(EMPTY)
  useLatchHolds.setState({ held: [] })
  stop = startMechSoundWatch()
  played.length = 0
})
afterEach(() => {
  stop()
  stop = () => undefined
  setSceneShowing(null)
  try {
    st().resetSim()
  } catch {
    /* no host */
  }
  __setSimHostFactoryForTests(null)
  useStore.setState({ running: false })
  __setCelebrationsSuppressedForTests(null)
  __setLangForTests('zh-TW')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- (a) relays through the real inline host

const RELAY_ON: CircuitLayout = {
  version: 1,
  name: 'relay',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'K1', type: 'relay_5v', at: 'd20' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'a20', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'j20', color: 'black' },
  ],
}

describe('(a) relays through the REAL inline host', () => {
  function runInline(layout: CircuitLayout): (n: number) => void {
    let now = 0
    const queued: (() => void)[] = []
    const sched: TickScheduler = { request: (cb) => (queued.push(cb), queued.length), cancel: () => undefined }
    __setSimHostFactoryForTests((cb) => new InlineSimHost(cb, { scheduler: sched, clock: () => now }))
    useStore.setState({ layout })
    st().startSim()
    return (n) => {
      for (let i = 0; i < n; i++) {
        now += 16
        for (const f of queued.splice(0)) f()
      }
    }
  }

  it('an unrelated edit while an energized relay is held: no relay-off / relay-on, only the insert', () => {
    const pump = runInline(RELAY_ON)
    pump(30)
    expect(heard()).toContain('relay-on') // the coil really picked
    played.length = 0
    st().addComponent('resistor', { holes: ['c40', 'c44'] }) // far away from the relay
    pump(30)
    expect(heard()).toEqual(['insert'])
  })

  it('removing its drive wire: one relay-off, after the new world settles', () => {
    const pump = runInline(RELAY_ON)
    pump(30)
    played.length = 0
    st().select('W1')
    st().removeSelected()
    pump(30)
    expect(heard().filter((c) => c.startsWith('relay'))).toEqual(['relay-off'])
  })
})

// ---------------------------------------------------------------- (b) a new board module

describe('(b) a new board module: one clack, when it lands', () => {
  it('with a scene: only the scene’s touchdown — none from the store side, however slow the rebuild (no timer at all)', () => {
    vi.useFakeTimers()
    setSceneShowing(() => true)
    st().growGrid('right')
    expect(heard()).toEqual([]) // the board is still in the air
    vi.advanceTimersByTime(10_000) // a phone rebuilding a large rig for seconds
    expect(heard()).toEqual([])
    voiceSceneCue('board') // the spawn tween lands
    expect(heard()).toEqual(['board'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reduced motion (the scene voices it inside the same store change): still once', () => {
    setSceneShowing(() => true)
    const unsub = useStore.subscribe((s, prev) => {
      if (s.layout !== prev.layout && (s.layout.boardCount ?? 1) > (prev.layout.boardCount ?? 1)) voiceSceneCue('board')
    })
    st().growGrid('right')
    unsub()
    expect(heard()).toEqual(['board'])
  })

  it('no scene: at once, once', () => {
    vi.useFakeTimers()
    st().growGrid('down')
    expect(heard()).toEqual(['board'])
    vi.advanceTimersByTime(10_000)
    expect(heard()).toEqual(['board'])
  })
})

// ---------------------------------------------------------------- (c) paste onto an empty board

const BENCH: CircuitLayout = {
  version: 1,
  name: 'bench',
  components: [
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
  ],
  wires: [
    { id: 'W1', from: 'a10', to: 'top+0', color: 'red' },
    { id: 'W3', from: 'a18', to: 'top-12', color: 'black' },
  ],
}

describe('(c) a paste is one insert — even onto an empty board', () => {
  it('copy R1 + LED1 + their rail wires, empty the board, paste: ONE insert (4 leads), its undo ONE swish', () => {
    openLayout(BENCH)
    st().marqueeSelect(['R1', 'LED1', 'W1', 'W3'])
    expect(copySelectionWithFeedback()).toBe(true)
    openLayout(EMPTY)
    played.length = 0
    expect(pasteWithFeedback()).toBe(true)
    expect(st().layout.components).toHaveLength(2)
    expect(st().layout.wires.length).toBeGreaterThan(0)
    expect(played).toEqual([{ cue: 'insert', opts: { count: 4, kind: 'leads' } }])
    played.length = 0
    undoWithFeedback()
    expect(heard()).toEqual(['undo'])
  })

  it('the paste mark is the classifier’s: without it the same change is a whole circuit (a load / an example)', () => {
    const pasted = { ...BENCH, components: BENCH.components.map((c) => ({ ...c, id: c.id + 'b' })), wires: BENCH.wires.map((w) => ({ ...w, id: w.id + 'b' })) }
    expect(mechCuesOf(EMPTY, pasted, { held: [] }).map((h) => h.cue)).toEqual(['load'])
    expect(mechCuesOf(EMPTY, pasted, { held: [], pasted: true })).toEqual([
      { cue: 'insert', count: 4, kind: 'leads', ids: ['R1b', 'LED1b', 'W1b', 'W3b'] },
    ])
    // wires alone: one wire-in
    const wiresOnly = { ...EMPTY, wires: pasted.wires }
    expect(mechCuesOf(EMPTY, wiresOnly, { held: [], pasted: true })).toEqual([{ cue: 'wire-in', count: 2, ids: ['W1b', 'W3b'] }])
  })

  it('a duplicate (Ctrl+D) is one insert too', () => {
    openLayout(BENCH)
    played.length = 0
    expect(duplicateWithFeedback(['R1'])).toBe(true)
    expect(heard()).toEqual(['insert'])
  })
})

// ---------------------------------------------------------------- (d) classic chrome / ?shotrig: silent, no AudioContext

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
  /** every buffer source's start(at, offset) */
  sourceStarts: { at: number; offset: number }[] = []
  constructor() {
    contexts.push(this)
  }
  addEventListener(): void {}
  resume(): Promise<void> {
    this.state = 'running'
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
    return Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), start() {}, stop() {} })
  }
  createBufferSource() {
    const starts = this.sourceStarts
    return Object.assign(new FakeNode(), {
      buffer: null as unknown,
      start: (at: number, offset = 0) => void starts.push({ at, offset }),
      stop() {},
    })
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
}

describe('(d) the classic chrome and ?shotrig: no sound, no AudioContext', () => {
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
    real.setSoundGate(soundsHere) // what CelebrationOverlay installs
  })
  afterEach(() => {
    real.setSoundGate(null)
    vi.unstubAllGlobals()
    real.__resetSoundForTests({ dropContext: true })
  })

  it('soundsHere: the product chrome yes; the classic chrome and ?shotrig no', () => {
    expect(soundsHere()).toBe(true)
    __setLangForTests('en')
    expect(soundsHere()).toBe(false)
    __setLangForTests('zh-TW')
    __setCelebrationsSuppressedForTests(true)
    expect(soundsHere()).toBe(false)
  })

  it('the classic chrome: the first gesture makes no AudioContext and nothing plays; switching to the product chrome wakes it at the next gesture', () => {
    __setLangForTests('en')
    gesture()
    real.playMech('insert', { count: 2 })
    real.playCue('success')
    real.playCue('burn')
    expect(contexts).toHaveLength(0)
    expect(real.__soundStatsForTests().listening).toBe(true) // still waiting
    __setLangForTests('zh-TW')
    gesture()
    expect(contexts).toHaveLength(1)
    real.playMech('press')
    expect(real.__soundStatsForTests().started).toBe(1)
  })

  it('?shotrig: no AudioContext, no cue, no scene cue', () => {
    __setCelebrationsSuppressedForTests(true)
    gesture()
    real.playMech('board')
    real.playCue('burn')
    expect(contexts).toHaveLength(0)
    expect(real.__soundStatsForTests().started).toBe(0)
    played.length = 0
    voiceSceneCue('snap') // the FxCue sink's route (mocked playMech): nothing
    expect(played).toEqual([])
  })

  it('CelebrationOverlay installs the gate and routes the scene sink through soundsHere', () => {
    const src = read('src/ui/fx/CelebrationOverlay.tsx')
    expect(src).toMatch(/setSoundGate\(soundsHere\)/)
    expect(src).toMatch(/setFxCueSink\(\(cue\) => \{\s*if \(!soundsHere\(\)\) return/)
    expect(src).toMatch(/setSceneShowing\(sceneRegistered\)/)
  })

  // ------------------------------------------------------------ (h) variety, on the same stand-in context
  it('(h) ten presses never draw the same grain: every click starts somewhere else in the noise', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    real.__resetSoundForTests({ gestured: true, dropContext: true })
    for (let i = 0; i < 10; i++) {
      real.playMech('press')
      contexts[0].currentTime += 1 // the voice cap frees up
      now += 100
    }
    const offsets = contexts[0].sourceStarts.map((s) => s.offset)
    expect(offsets.length).toBeGreaterThanOrEqual(20) // two clicks per press
    expect(new Set(offsets).size).toBe(offsets.length)
    // and each click starts on a sample frame (the filter sees the grain clickTop measured)
    for (const s of contexts[0].sourceStarts) expect(Math.abs(s.at * 48000 - Math.round(s.at * 48000))).toBeLessThan(1e-6)
  })
})

// ---------------------------------------------------------------- (e) the PCF8574's jumpers

describe('(e) the PCF8574 A2–A0 address jumpers click like the other jumpers', () => {
  const pcf: CircuitLayout = { version: 1, name: 'p', components: [{ id: 'U1', type: 'pcf8574_module', at: 'h10' }], wires: [] }
  const addr = (a: string): CircuitLayout => ({ ...pcf, components: [{ ...pcf.components[0], params: { address: a } } as ComponentInstance] })
  it('one click per jumper moved; the same address again is silent', () => {
    expect(mechCuesOf(pcf, addr('0x21'), { held: [] })).toEqual([{ cue: 'jumper', count: 1, ids: ['U1'] }])
    expect(mechCuesOf(addr('0x21'), addr('0x26'), { held: [] })).toEqual([{ cue: 'jumper', count: 3, ids: ['U1'] }])
    expect(mechCuesOf(addr('0x24'), addr('0x24'), { held: [] })).toEqual([])
    const clicks = (count: number) => record('jumper', { count }).filter((e) => e.type === 'click').length
    expect(clicks(2)).toBe(2 * clicks(1))
  })
  it('through the store (the inspector’s select)', () => {
    openLayout(pcf)
    played.length = 0
    st().setParam('U1', 'address', '0x23')
    expect(played).toEqual([{ cue: 'jumper', opts: { count: 2 } }])
  })
})

// ---------------------------------------------------------------- (f) a refusal

interface Ev {
  type: 'click' | 'thock' | 'ring' | 'scrape'
  at: number
  end: number
  peak: number
  freqs: number[]
}
function record(cue: MechCue, opts: MechOpts = {}): Ev[] {
  const events: Ev[] = []
  const synth: Synth = {
    click: (at, o) => void events.push({ type: 'click', at, end: at + o.dur, peak: o.peak, freqs: [o.freq] }),
    thock: (at, o) => void events.push({ type: 'thock', at, end: at + o.dur, peak: o.peak, freqs: [o.f0, o.f1] }),
    ring: (at, parts) => {
      for (const p of parts) events.push({ type: 'ring', at, end: at + p.decay, peak: p.gain, freqs: [p.f] })
    },
    scrape: (at, o) => void events.push({ type: 'scrape', at, end: at + o.dur, peak: o.peak, freqs: [o.f0, o.f1] }),
  }
  renderMech(synth, cue, 0, opts)
  return events
}

describe('(f) a refusal sounds — softly, unlike any success', () => {
  it('the recipe: short (≤ 0.25 s), low (every part under 1 kHz), no bright click — every success has one', () => {
    const ev = record('refuse')
    expect(Math.max(...ev.map((e) => e.end))).toBeLessThanOrEqual(0.25)
    for (const e of ev) for (const f of e.freqs) expect(f).toBeLessThan(1000)
    for (const ok of ['insert', 'wire-in', 'press', 'toggle', 'seat', 'latch'] as const) {
      expect(record(ok).some((e) => e.type === 'click' && e.freqs[0] >= 2000), ok).toBe(true)
    }
    expect(CUE_LEVEL_DB.refuse).toBeLessThan(CUE_LEVEL_DB.insert) // softer than the success it stands for
  })

  it('copy-paste: no room for the copy → the refusal thunk (with the toast), no insert', () => {
    openLayout({ version: 1, name: 'full', board: 'half', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h5' }], wires: [] })
    played.length = 0
    expect(duplicateWithFeedback(['U1'])).toBe(false)
    expect(getToasts().at(-1)?.text).toMatch(/沒有空位/)
    expect(heard()).toEqual(['refuse'])
  })

  it('App.tsx: both refused-placement branches play it (product chrome); the cancel keys never do', () => {
    const src = read('src/App.tsx')
    const hole = src.slice(src.indexOf('function handleHoleClick('), src.indexOf('function handleHoleClick(') + 4000)
    expect(hole.match(/playMech\('refuse'\)/g)).toHaveLength(2)
    // a dip / footprint that does not fit (the 「這裡放不下…」 toast) and a refused leads hole
    expect(hole).toMatch(/else if \(!isLegacyChrome\(\)\) \{[\s\S]{0,400}playMech\('refuse'\)[\s\S]{0,200}placementRefusedHint/)
    expect(hole).toMatch(/if \(!placementValid\([^)]*\)\) \{\s*if \(!isLegacyChrome\(\)\) \{\s*playMech\('refuse'\)/)
    expect(src.match(/playMech\('refuse'\)/g)).toHaveLength(2) // nowhere else (Escape / cancel stay silent)
  })
})

// ---------------------------------------------------------------- (i) the ghost turned

describe('(i) R while placing: the ghost clicks like a placed part turning', () => {
  it('modeCuesOf: the same placement turned → rotate; a fresh arming → silent', () => {
    const picked: string[] = []
    expect(modeCuesOf({ kind: 'place', type: 'ne555', pickedHoles: picked }, { kind: 'place', type: 'ne555', pickedHoles: picked, rotation: 180 })).toEqual([
      { cue: 'rotate', ids: [] },
    ])
    expect(modeCuesOf({ kind: 'place', type: 'ne555', pickedHoles: picked, rotation: 180 }, { kind: 'place', type: 'ne555', pickedHoles: [] })).toEqual([])
  })
  it('through the store: rotateArmed', () => {
    st().setMode({ kind: 'place', type: 'ne555', pickedHoles: [] })
    played.length = 0
    st().rotateArmed()
    expect(heard()).toEqual(['rotate'])
  })
})

// ---------------------------------------------------------------- (g) levels, offline

describe('(g) levels through sound.ts’s graph (offline emulation, Chromium’s compressor curve)', () => {
  const FS = 48000
  let real: typeof import('../src/ui/fx/sound')
  beforeAll(async () => {
    real = await vi.importActual<typeof import('../src/ui/fx/sound')>('../src/ui/fx/sound')
  })
  const NOISE = new Float32Array(Math.floor(FS * 0.4))
  fillNoise(NOISE)
  let seed = 0x5eed1234
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const ramp = (t: number, at: number, dur: number, f0: number, f1: number) => (t <= at ? f0 : t >= at + dur ? f1 : f0 * Math.pow(f1 / f0, (t - at) / dur))

  class Offline implements Synth {
    out = new Float64Array(Math.floor(FS * 0.7))
    private band(at: number, dur: number, f0: number, f1: number, q: number, top: number, attack: number, start: number): void {
      let x1 = 0
      let x2 = 0
      let y1 = 0
      let y2 = 0
      const i0 = Math.ceil(at * FS - 1e-9)
      const i1 = Math.min(this.out.length, Math.ceil((at + dur + 0.01) * FS))
      for (let i = i0; i < i1; i++) {
        const t = i / FS
        const w0 = (2 * Math.PI * ramp(t, at, dur, f0, f1)) / FS
        const alpha = Math.sin(w0) / (2 * q)
        const a0 = 1 + alpha
        const b0 = alpha / a0
        const a1 = (-2 * Math.cos(w0)) / a0
        const a2 = (1 - alpha) / a0
        const x = NOISE[(start + i - i0) % NOISE.length]
        const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        this.out[i] += y * envelopeAt(t - at, attack, dur, top)
      }
    }
    private sine(at: number, f0: number, f1: number, dur: number, peak: number, attack: number): void {
      let ph = 0
      for (let i = Math.floor(at * FS); i < Math.min(this.out.length, Math.ceil((at + dur + 0.01) * FS)); i++) {
        const t = i / FS
        ph += (2 * Math.PI * ramp(t, at, dur, f0, f1)) / FS
        this.out[i] += Math.sin(ph) * envelopeAt(t - at, attack, dur, peak)
      }
    }
    click(at: number, o: { freq: number; q: number; dur: number; peak: number }): void {
      const start = Math.floor(rand() * (NOISE.length - Math.ceil(CLICK_SPAN_S * FS)))
      this.band(Math.ceil(at * FS) / FS, o.dur, o.freq, o.freq, o.q, clickTop(NOISE, FS, start, o), clickAttack(o.dur), start)
    }
    scrape(at: number, o: { f0: number; f1: number; dur: number; peak: number; q?: number }): void {
      const q = o.q ?? 1.4
      this.band(at, o.dur, o.f0, o.f1, q, o.peak * SCRAPE_TRIM * noiseMakeup(Math.sqrt(o.f0 * o.f1), q, FS), o.dur * 0.35, Math.floor(rand() * 0.3 * FS))
    }
    thock(at: number, o: { f0: number; f1: number; dur: number; peak: number }): void {
      this.sine(at, o.f0, o.f1, o.dur, o.peak, 0.0015)
    }
    ring(at: number, parts: readonly { f: number; decay: number; gain: number }[]): void {
      for (const p of parts) this.sine(at, p.f, p.f, p.decay, p.gain, 0.0008)
    }
  }
  const hit = (s: Synth, cue: MechCue, at: number, opts: MechOpts = {}) =>
    renderMech(jitterSynth(s, 1 + (rand() * 2 - 1) * 0.04, Math.pow(10, ((rand() * 2 - 1) * 1.5) / 20)), cue, at, { ...opts, rand })

  // Chromium DynamicsCompressorKernel: the static curve, its automatic make-up, a 6 ms look-ahead
  function chain(raw: Float64Array): Float64Array {
    const C = real.MECH_COMP
    const lin = (db: number) => Math.pow(10, db / 20)
    const dB = (x: number) => 20 * Math.log10(Math.max(1e-12, x))
    const thr = lin(C.threshold)
    const kneeDb = C.threshold + C.knee
    const knee = (x: number, k: number) => (x < thr ? x : thr + (1 - Math.exp(-k * (x - thr))) / k)
    const slope = (x: number, k: number) => (x < thr ? 1 : (dB(knee(x * 1.001, k)) - dB(knee(x, k))) / (dB(x * 1.001) - dB(x)))
    let lo = 0.1
    let hi = 10000
    let k = 5
    for (let i = 0; i < 15; i++) {
      if (slope(lin(kneeDb), k) < 1 / C.ratio) hi = k
      else lo = k
      k = Math.sqrt(lo * hi)
    }
    const yKnee = dB(knee(lin(kneeDb), k))
    const sat = (x: number) => (x < lin(kneeDb) ? knee(x, k) : lin(yKnee + (dB(x) - kneeDb) / C.ratio))
    const makeup = Math.pow(1 / sat(1), 0.6)
    const pre = Math.round(0.006 * FS)
    const aC = Math.exp(-1 / (C.attack * FS))
    const rC = Math.exp(-1 / (C.release * FS))
    const out = new Float64Array(raw.length)
    let level = 0
    let g = 1
    for (let n = 0; n < raw.length; n++) {
      const v = Math.abs(raw[n] * real.MECH_GAIN)
      level = Math.max(v, level * rC)
      const want = level > 1e-9 ? sat(level) / level : 1
      g = want < g ? want + (g - want) * aC : want + (g - want) * rC
      out[n] = (n >= pre ? raw[n - pre] * real.MECH_GAIN : 0) * g * makeup * real.MECH_MAKEUP * real.QUIET_GAIN
    }
    return out
  }
  const peakDb = (a: Float64Array) => 20 * Math.log10(a.reduce((m, v) => Math.max(m, Math.abs(v)), 0))
  const level = (cue: MechCue, opts: MechOpts = {}, hits = 6) => {
    let sum = 0
    for (let i = 0; i < hits; i++) {
      const s = new Offline()
      hit(s, cue, 0.01, opts)
      sum += peakDb(chain(s.out))
    }
    return sum / hits
  }

  it('each cue lands near its level (±1.5 dB of the mean peak over six hits)', () => {
    const want: [MechCue, number][] = [
      ['insert', -15],
      ['wire-in', -16],
      ['press', -17],
      ['toggle', -17],
      ['pot', -23],
      ['detent', -23],
      ['snap', -26],
      ['undo', -20],
      ['redo', -20],
      ['refuse', -20],
    ]
    for (const [cue, db] of want) {
      seed = 0x5eed1234
      const got = level(cue)
      expect(got, `${cue} ${got.toFixed(1)} dBFS`).toBeGreaterThan(db - 1.5)
      expect(got, `${cue} ${got.toFixed(1)} dBFS`).toBeLessThan(db + 1.5)
    }
  })

  it('six loud cues at once (the voice cap) stay under −3 dBFS; a single cue never reaches the compressor’s threshold', () => {
    const loud: [MechCue, MechOpts][] = [
      ['insert', { count: 16, kind: 'dip' }],
      ['board', {}],
      ['wire-in', { count: 3 }],
      ['relay-on', { count: 3 }],
      ['toggle', {}],
      ['press', {}],
    ]
    let worst = -Infinity
    for (let trial = 0; trial < 8; trial++) {
      const s = new Offline()
      for (const [cue, opts] of loud) hit(s, cue, 0.01 + (trial === 0 ? 0 : rand() * 0.012), opts)
      worst = Math.max(worst, peakDb(chain(s.out)))
    }
    expect(worst).toBeLessThanOrEqual(-3)
    for (const [cue, opts] of loud) {
      const s = new Offline()
      renderMech(s, cue, 0.01, { ...opts, rand })
      expect(peakDb(s.out.map((v) => v * real.MECH_GAIN)), cue).toBeLessThan(real.MECH_COMP.threshold)
    }
  })

  it('(h) a click from any grain of the noise peaks at its recipe’s peak (±0.5 dB)', () => {
    for (const o of [
      { freq: 3200, q: 4, dur: 0.003, peak: 0.9 },
      { freq: 3500, q: 6, dur: 0.006, peak: 0.6 },
      { freq: 4200, q: 9, dur: 0.0025, peak: 0.4 },
      { freq: 620, q: 1.4, dur: 0.008, peak: 0.3 },
    ]) {
      for (let k = 0; k < 12; k++) {
        const start = Math.floor(rand() * (NOISE.length - Math.ceil(CLICK_SPAN_S * FS)))
        const got = clickPeak(NOISE, FS, start, o.freq, o.q, o.dur, clickTop(NOISE, FS, start, o))
        expect(Math.abs(20 * Math.log10(got / o.peak)), `${o.freq} Hz @${start}`).toBeLessThan(0.5)
      }
    }
  })

  it('every cue still ends within MAX_CUE_S (0.6 s)', () => {
    expect(MAX_CUE_S).toBeLessThanOrEqual(0.6)
  })
})
