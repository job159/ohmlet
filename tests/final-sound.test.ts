/**
 * final-sound — the FIRST mechanical cue of a session is as loud as any other.
 *
 * A new DynamicsCompressorNode starts at full attenuation and recovers over
 * ≈ 85 ms, so before this fix the cue played in the very gesture that makes
 * the AudioContext (the first press, R on the ghost, Ctrl+V…) came out up to
 * 12.8 dB quieter (Edge, the real sound.ts graph in an OfflineAudioContext:
 * press −28.3 dBFS at +0 ms vs −15.5 settled; the same in a real-time
 * context). sound.ts now carries the bus round the compressor for MECH_DRY.hold
 * s — the compressor's look-ahead delay → its static curve (a waveshaper) →
 * its automatic make-up — then cross-fades to the settled compressor.
 *
 *  - the port of DynamicsCompressorKernel's curve / make-up matches what Edge
 *    measured (1.34712 at 22.05…96 kHz; look-ahead floor(0.006·sr) frames);
 *  - the graph on a stand-in context: both paths, the delay, the curve, the
 *    hold-then-fade automation from the context's own clock;
 *  - the first cue's level through that graph with the compressor's MEASURED
 *    cold recovery: within 1.5 dB of settled at every moment (−12.8 dB
 *    without the dry path);
 *  - a pile-up in the dry window stays under −3 dBFS (the curve caps it);
 *  - a browser without DelayNode / WaveShaperNode keeps the old graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMP_LOOKAHEAD_S,
  MECH_COMP,
  MECH_DRY,
  MECH_GAIN,
  MECH_MAKEUP,
  QUIET_GAIN,
  __resetSoundForTests,
  __soundStatsForTests,
  compressorCurve,
  compressorMakeup,
  compressorShape,
  playMech,
  useSound,
} from '../src/ui/fx/sound'

// ---------------------------------------------------------------- a stand-in context that keeps the graph

type Ev = { kind: 'set' | 'linear'; v: number; t: number }

class Param {
  events: Ev[] = []
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'set', v, t })
    return this
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'linear', v, t })
    return this
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'linear', v, t }) // the cue envelopes: not looked at here
    return this
  }
  /** the value at context time t (WebAudio semantics for set / linear ramps) */
  at(t: number): number {
    let v = this.value
    let prevT = Number.NEGATIVE_INFINITY
    for (const e of this.events) {
      if (e.t <= t) {
        v = e.v
        prevT = e.t
        continue
      }
      if (e.kind === 'linear' && Number.isFinite(prevT)) return v + ((e.v - v) * (t - prevT)) / (e.t - prevT)
      break
    }
    return v
  }
}

class Node {
  out: Node[] = []
  constructor(public kind: string) {}
  connect<T extends Node>(n: T): T {
    this.out.push(n)
    return n
  }
  disconnect(): void {}
}

class GainN extends Node {
  gain = new Param(1)
  constructor() {
    super('gain')
  }
}

const made: Ctx[] = []

class Ctx {
  state = 'suspended'
  sampleRate = 48000
  destination = new Node('destination')
  nodes: Node[] = []
  starts = 0
  /** the context's clock when it is made (a subclass starts it later) */
  currentTime = Ctx.startAt
  static startAt = 0
  constructor(readonly options?: unknown) {
    made.push(this)
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
  private keep<T extends Node>(n: T): T {
    this.nodes.push(n)
    return n
  }
  createGain() {
    return this.keep(new GainN())
  }
  createBiquadFilter() {
    return this.keep(Object.assign(new Node('biquad'), { type: '', frequency: new Param(), Q: new Param() }))
  }
  createDynamicsCompressor() {
    return this.keep(
      Object.assign(new Node('compressor'), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() }),
    )
  }
  createDelay(max?: number) {
    return this.keep(Object.assign(new Node('delay'), { max, delayTime: new Param() }))
  }
  createWaveShaper() {
    return this.keep(Object.assign(new Node('shaper'), { curve: null as Float32Array | null }))
  }
  createOscillator() {
    const starts = () => void this.starts++
    return this.keep(Object.assign(new Node('osc'), { type: 'sine', frequency: new Param(), start: starts, stop() {} }))
  }
  createBufferSource() {
    const starts = () => void this.starts++
    return this.keep(Object.assign(new Node('source'), { buffer: null as unknown, start: starts, stop() {} }))
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
}

/** a browser without DelayNode / WaveShaperNode */
class OldCtx extends Ctx {}
Object.defineProperty(OldCtx.prototype, 'createDelay', { value: undefined })
Object.defineProperty(OldCtx.prototype, 'createWaveShaper', { value: undefined })

let listeners: Map<string, Set<() => void>>
const gesture = () => {
  for (const fn of [...(listeners.get('pointerdown') ?? [])]) fn()
}
function stubWindow(AC: unknown): void {
  listeners = new Map()
  vi.stubGlobal('window', {
    AudioContext: AC,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  })
}

/** the mechanical bus of the made graph: MECH_GAIN → compressor …→ MECH_MAKEUP */
function graph(c: Ctx) {
  const comp = c.nodes.find((n) => n.kind === 'compressor')!
  const bus = c.nodes.find((n) => n instanceof GainN && n.out.includes(comp)) as GainN
  const out = c.nodes.find((n) => n instanceof GainN && n.gain.value === MECH_MAKEUP) as GainN
  return { comp, bus, out }
}

/** every path from `from` to `to` (not through `avoid`), as the nodes strictly between them */
function paths(from: Node, to: Node, avoid?: Node, seen: Node[] = []): Node[][] {
  const found: Node[][] = []
  for (const n of from.out) {
    if (n === to) found.push(seen)
    else if (n !== avoid && !seen.includes(n)) found.push(...paths(n, to, avoid, [...seen, n]))
  }
  return found
}
const gainAt = (path: Node[], t: number) => path.reduce((g, n) => (n instanceof GainN ? g * n.gain.at(t) : g), 1)

/**
 * The compressor's cold start as Edge measured it on this graph before the
 * fix (a press, the first cue N ms after the context is made; dB re settled).
 */
const COLD_DB: readonly (readonly [number, number])[] = [
  [0, -12.8],
  [5.3, -10.0],
  [10.7, -7.7],
  [21.3, -4.7],
  [42.7, -1.7],
  [85.3, 0],
]
function coldDb(ms: number): number {
  for (let i = 1; i < COLD_DB.length; i++) {
    const [t1, d1] = COLD_DB[i]
    const [t0, d0] = COLD_DB[i - 1]
    if (ms <= t1) return d0 + ((d1 - d0) * (ms - t0)) / (t1 - t0)
  }
  return 0
}

beforeEach(() => {
  made.length = 0
  stubWindow(Ctx)
  useSound.getState().setEnabled(true)
  __resetSoundForTests({ gestured: false, dropContext: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  __resetSoundForTests({ dropContext: true })
})

// ---------------------------------------------------------------- the port of the kernel's curve

describe('DynamicsCompressorKernel’s curve and make-up (as Edge measured them)', () => {
  it('make-up 1.3471 for MECH_COMP (Edge: 1.34710…1.34713 at 22.05–96 kHz)', () => {
    expect(compressorMakeup(MECH_COMP)).toBeCloseTo(1.34712, 3)
  })
  it('the curve: linear up to the threshold, then under the input, rising, its 0 dB point 0.6086', () => {
    const sat = compressorCurve(MECH_COMP)
    const thr = Math.pow(10, MECH_COMP.threshold / 20)
    for (const x of [0, 0.01, 0.1, 0.3, thr * 0.999]) expect(sat(x)).toBeCloseTo(x, 12)
    let prev = sat(thr)
    for (let x = thr * 1.01; x <= 1; x += 0.01) {
      expect(sat(x)).toBeLessThan(x)
      expect(sat(x)).toBeGreaterThan(prev)
      prev = sat(x)
    }
    expect(sat(1)).toBeCloseTo(0.6086, 3)
  })
  it('the waveshaper curve: odd, identity on every grid point under the threshold, capped at curve(1)', () => {
    const shape = compressorShape(MECH_COMP)
    const n = shape.length
    const thr = Math.pow(10, MECH_COMP.threshold / 20)
    for (let i = 0; i < n; i++) {
      const x = (2 * i) / (n - 1) - 1
      expect(shape[i]).toBeCloseTo(-shape[n - 1 - i], 6)
      if (Math.abs(x) < thr) expect(shape[i]).toBeCloseTo(x, 6)
    }
    expect(Math.max(...shape)).toBeCloseTo(compressorCurve(MECH_COMP)(1), 6)
  })
  it('a pile-up in the dry window can never pass −3 dBFS (the curve’s ceiling through the make-up: ≈ −9.3)', () => {
    const ceiling = compressorCurve(MECH_COMP)(1) * compressorMakeup(MECH_COMP) * MECH_MAKEUP * QUIET_GAIN
    expect(20 * Math.log10(ceiling)).toBeLessThan(-3)
    expect(20 * Math.log10(ceiling)).toBeCloseTo(-9.3, 1)
  })
  it('the dry window covers the compressor’s recovery (≈ 85 ms with release 0.08 s) and stays short', () => {
    expect(MECH_DRY.hold).toBeGreaterThanOrEqual(MECH_COMP.release * 1.2)
    expect(MECH_DRY.fade).toBeGreaterThan(0)
    expect(MECH_DRY.hold + MECH_DRY.fade).toBeLessThanOrEqual(0.2)
  })
})

// ---------------------------------------------------------------- the graph

describe('the mechanical bus goes round the cold compressor at first', () => {
  it('the gesture makes both paths: bus → compressor → wet → make-up, and bus → look-ahead delay → static curve → dry → make-up', () => {
    gesture()
    expect(made).toHaveLength(1)
    const c = made[0]
    const { comp, bus, out } = graph(c)
    expect(bus.gain.value).toBe(MECH_GAIN)
    const wet = paths(comp, out)
    expect(wet).toHaveLength(1)
    expect(wet[0].map((n) => n.kind)).toEqual(['gain'])
    const dry = paths(bus, out, comp)
    expect(dry).toHaveLength(1)
    expect(dry[0].map((n) => n.kind)).toEqual(['delay', 'shaper', 'gain'])
    const [delay, shaper] = dry[0] as unknown as [{ delayTime: Param }, { curve: Float32Array }]
    expect(delay.delayTime.value).toBe(Math.floor(COMP_LOOKAHEAD_S * 48000) / 48000) // 288 frames: the kernel's own
    expect(Array.from(shaper.curve)).toEqual(Array.from(compressorShape(MECH_COMP)))
  })

  it('the hold and the cross-fade: the dry path at the make-up until MECH_DRY.hold, then an equal-gain fade to the compressor', () => {
    gesture()
    const c = made[0]
    const { comp, bus, out } = graph(c)
    const [wet] = paths(comp, out)
    const [dry] = paths(bus, out, comp)
    const m = compressorMakeup(MECH_COMP)
    const { hold, fade } = MECH_DRY
    for (const t of [0, 0.01, hold / 2, hold]) {
      expect(gainAt(dry, t)).toBeCloseTo(m, 9)
      expect(gainAt(wet, t)).toBe(0)
    }
    for (const x of [0.25, 0.5, 0.75]) {
      const t = hold + x * fade
      expect(gainAt(wet, t)).toBeCloseTo(x, 9)
      expect(gainAt(dry, t) / m + gainAt(wet, t)).toBeCloseTo(1, 9) // a settled compressor: the sum stays put
    }
    for (const t of [hold + fade, 1, 60]) {
      expect(gainAt(dry, t)).toBe(0)
      expect(gainAt(wet, t)).toBe(1)
    }
  })

  it('the schedule runs on the context’s own clock (a context made late starts its window then)', () => {
    Ctx.startAt = 42.5
    try {
      __resetSoundForTests({ gestured: false, dropContext: true })
      gesture()
    } finally {
      Ctx.startAt = 0
    }
    const c = made[0]
    const { comp, bus, out } = graph(c)
    const [wet] = paths(comp, out)
    const [dry] = paths(bus, out, comp)
    expect(gainAt(wet, 42.5 + MECH_DRY.hold / 2)).toBe(0)
    expect(gainAt(dry, 42.5 + MECH_DRY.hold / 2)).toBeCloseTo(compressorMakeup(MECH_COMP), 9)
    expect(gainAt(wet, 42.5 + MECH_DRY.hold + MECH_DRY.fade)).toBe(1)
  })

  it('the first cue at any moment after the context is made sounds within 1.5 dB of a settled one (−12.8 dB at +0 ms without the dry path)', () => {
    gesture()
    const c = made[0]
    const { comp, bus, out } = graph(c)
    const wet = paths(comp, out)
    const dry = paths(bus, out, comp)
    const m = compressorMakeup(MECH_COMP)
    let worst = 0
    for (let ms = 0; ms <= 400; ms += 0.5) {
      // the cue starts LEAD (5 ms) after it is played and leaves both paths one look-ahead later
      const t = (ms + 5) / 1000 + COMP_LOOKAHEAD_S
      const viaComp = wet.reduce((s, p) => s + gainAt(p, t), 0) * Math.pow(10, coldDb(ms) / 20)
      const viaDry = dry.reduce((s, p) => s + gainAt(p, t), 0) / m
      worst = Math.max(worst, Math.abs(20 * Math.log10(viaComp + viaDry)))
    }
    expect(worst).toBeLessThan(1.5)
  })

  it('cues play through it at once — no cue waits for the compressor', () => {
    gesture()
    const c = made[0]
    const before = c.starts
    playMech('press')
    expect(__soundStatsForTests().started).toBe(1)
    expect(c.starts).toBeGreaterThan(before)
  })

  it('a browser without DelayNode / WaveShaperNode keeps the compressor alone (the old graph), and still sounds', () => {
    stubWindow(OldCtx)
    __resetSoundForTests({ gestured: false, dropContext: true })
    gesture()
    const c = made[0]
    const { comp, bus, out } = graph(c)
    expect(comp.out).toEqual([out])
    expect(paths(bus, out, comp)).toHaveLength(0)
    playMech('press')
    expect(__soundStatsForTests().started).toBe(1)
  })

  it('音效 off: still no context at all', () => {
    useSound.getState().setEnabled(false)
    gesture()
    playMech('press')
    expect(made).toHaveLength(0)
  })
})
