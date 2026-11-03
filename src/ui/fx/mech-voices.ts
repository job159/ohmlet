/**
 * Mechanical voices (owner: sound) — the RECIPES of every MechCue, as pure
 * functions over a tiny Synth interface (four primitives), so the same
 * recipe drives WebAudio in the page (sound.ts WebSynth) and a recording
 * synth in the tests (every cue renders, peaks ≤ 1, done within MAX_CUE_S).
 *
 *   click   a resonant band-passed noise impulse — the tick of plastic or metal
 *   thock   a sine body whose pitch drops f0 → f1 — a part seating, an armature landing
 *   ring    inharmonic sine partials, each with its own decay — springs and contacts
 *   scrape  band-passed noise swept f0 → f1 — friction (a lead sliding into a contact)
 *
 * 爽度 rules (product owner: 「又有爽度的聲效」): crisp and short (every cue is
 * over within MAX_CUE_S), tactile — a transient on top, a body under it —
 * never harsh (no square waves, no sustained tone, nothing above ~7 kHz but
 * a faint tick), slightly varied per hit (the caller's `rand` spaces the lead
 * clicks and picks each click's grain of noise — clickTop keeps every grain
 * at its recipe's level; sound.ts adds ±4 % pitch / ±1.5 dB per hit through
 * jitterSynth), and the many-lead parts sound heavier: more lead clicks (at
 * most six) and a lower, longer body (heaviness). A refusal ('refuse') is
 * the one dull sound: two soft low thunks, no bright click.
 *
 * Levels (CUE_LEVEL_DB, measured offline through sound.ts's graph — round 5
 * polish, phone speakers): insert ≈ −15 dBFS, wire-in ≈ −16, press /
 * toggle ≈ −17, pot / detent ticks ≈ −23, the aim snap ≈ −26, the undo /
 * redo swish ≈ −20 (the chime is ≈ −16).
 *
 * Times are AudioContext seconds; peaks are linear amplitudes on the
 * mechanical bus (0..1 each — sound.ts carries the bus through MECH_GAIN, a
 * compressor and MECH_MAKEUP to the master's QUIET_GAIN).
 */
import type { MechCue, MechOpts } from './sound'

/** One partial of a ring: frequency (Hz), its decay to silence (s), its peak. */
export interface RingPartial {
  f: number
  decay: number
  gain: number
}

/** The four primitives every recipe is made of. */
export interface Synth {
  click(at: number, o: { freq: number; q: number; dur: number; peak: number }): void
  thock(at: number, o: { f0: number; f1: number; dur: number; peak: number }): void
  ring(at: number, partials: readonly RingPartial[]): void
  scrape(at: number, o: { f0: number; f1: number; dur: number; peak: number; q?: number }): void
}

/** What a recipe needs besides the cue: MechOpts plus the per-hit randomness (0..1). */
export interface MechVoiceOpts extends Pick<MechOpts, 'count' | 'kind' | 'level'> {
  rand?: () => number
}

/** every cue is over by then (s after its start) */
export const MAX_CUE_S = 0.6

/** Every MechCue, in the order of the type (tests, the WAV preview script). */
export const MECH_CUES: readonly MechCue[] = [
  'insert', 'pull', 'seat', 'lift', 'settle', 'snap',
  'wire-tip', 'wire-in', 'wire-out', 'rotate', 'board',
  'load', 'clear', 'undo', 'redo', 'refuse',
  'press', 'release', 'latch', 'toggle', 'slide', 'dip',
  'jumper', 'pot', 'detent', 'rotary',
  'relay-on', 'relay-off',
]

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** How heavy a part sounds by its lead count: 2 leads → 0, 16 or more → 1. */
export function heaviness(count: number): number {
  return clamp01((Math.log2(Math.max(1, count)) - 1) / 3)
}

/**
 * The shared noise of every noise primitive (and the burn pop): uniform ±1
 * from a fixed LCG, so the same index holds the same sample at any sample
 * rate — `out` is filled in place.
 */
export function fillNoise(out: Float32Array): void {
  let s = 0x2468ace
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = (s / 0xffffffff) * 2 - 1
  }
}

/**
 * Gain that brings band-passed white noise (uniform ±1) up to ≈ unit peak:
 * the band keeps π·f/(2·q) Hz of the fs/2 the noise spreads over, and a
 * short burst peaks near 2.5 σ. Without it a Q-6 click would sound at a
 * fifth of the level its recipe asks for. Clamped to 1..8.
 */
export function noiseMakeup(freq: number, q: number, sampleRate: number): number {
  const sigma = Math.sqrt((Math.PI * Math.max(20, freq)) / (3 * Math.max(0.1, q) * Math.max(8000, sampleRate)))
  return Math.min(8, Math.max(1, 1 / (2.5 * sigma)))
}

/** a click's attack (s): sharp, at most a third of the click */
export const clickAttack = (dur: number): number => Math.min(0.0006, dur / 3)

/**
 * sound.ts envelope() `x` s after its start (the same curve, so a click's
 * level is computed here exactly as the page plays it): an exponential rise
 * from 1e-4 to `top` over `attack`, an exponential fall to min(0.001, top/2)
 * at `dur`, then a 4 ms linear fade.
 */
export function envelopeAt(x: number, attack: number, dur: number, top: number): number {
  const p = Math.max(0.002, top)
  const floor = Math.min(0.001, p / 2)
  if (x < 0) return 0
  if (x < attack) return 0.0001 * Math.pow(p / 0.0001, x / attack)
  if (x < dur) return p * Math.pow(floor / p, (x - attack) / (dur - attack))
  if (x < dur + 0.004) return floor * (1 - (x - dur) / 0.004)
  return 0
}

/**
 * The peak of a click made from `noise` at sample `start`: through the
 * band-pass WebAudio's BiquadFilterNode 'bandpass' is (RBJ, 0 dB peak),
 * under the click's envelope of top `top`. A few hundred multiply-adds.
 */
export function clickPeak(noise: ArrayLike<number>, sampleRate: number, start: number, freq: number, q: number, dur: number, top: number): number {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate
  const alpha = Math.sin(w0) / (2 * Math.max(1e-3, q))
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const a1 = (-2 * Math.cos(w0)) / a0
  const a2 = (1 - alpha) / a0
  const attack = clickAttack(dur)
  const n = Math.min(noise.length - start, Math.ceil((dur + 0.004) * sampleRate))
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    const x = noise[start + i]
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    const v = Math.abs(y * envelopeAt(i / sampleRate, attack, dur, top))
    if (v > peak) peak = v
  }
  return peak
}

/**
 * The envelope top that makes a click drawn from `noise` at sample `start`
 * peak at its recipe's `peak`. A few ms of noise through a narrow band can
 * peak anywhere within ±10 dB, so each click measures its own grain (two
 * passes: the envelope's fall depends a little on its top): every click is
 * a different grain — ten presses never sound identical — and every one at
 * its level. Bounded to ¼…8× the band's statistical estimate (noiseMakeup).
 */
export function clickTop(
  noise: ArrayLike<number>,
  sampleRate: number,
  start: number,
  o: { freq: number; q: number; dur: number; peak: number },
): number {
  const guess = o.peak * noiseMakeup(o.freq, o.q, sampleRate)
  let top = guess
  for (let pass = 0; pass < 2; pass++) {
    const got = clickPeak(noise, sampleRate, start, o.freq, o.q, o.dur, top)
    if (!(got > 1e-9)) return guess
    top *= o.peak / got
  }
  return Math.min(guess * 8, Math.max(guess / 4, top))
}

/** the noise a click spans (s): its sound plus the filter's ring-out */
export const CLICK_SPAN_S = 0.016

/** a scrape (random excitation, longer) peaks at ≈ 0.75 × noiseMakeup on average */
export const SCRAPE_TRIM = 1.3

/**
 * A synth whose every hit is shifted by `pitch` (a frequency factor) and
 * `gain` (a level factor) — the per-hit variation and the caller's trim.
 * Peaks stay ≤ 1 whatever the factors.
 */
export function jitterSynth(s: Synth, pitch: number, gain: number): Synth {
  const p = (x: number): number => Math.min(1, Math.max(0, x * gain))
  return {
    click: (at, o) => s.click(at, { ...o, freq: o.freq * pitch, peak: p(o.peak) }),
    thock: (at, o) => s.thock(at, { ...o, f0: o.f0 * pitch, f1: o.f1 * pitch, peak: p(o.peak) }),
    ring: (at, parts) => s.ring(at, parts.map((x) => ({ ...x, f: x.f * pitch, gain: p(x.gain) }))),
    scrape: (at, o) => s.scrape(at, { ...o, f0: o.f0 * pitch, f1: o.f1 * pitch, peak: p(o.peak) }),
  }
}

// ---------------------------------------------------------------- building blocks

type Kind = NonNullable<MechOpts['kind']>

/** an instrument set down on the bench: rubber feet, a soft body thud */
function benchThud(s: Synth, t: number, level: number): void {
  s.scrape(t, { f0: 380, f1: 260, dur: 0.035, peak: 0.16 * level, q: 1.2 })
  s.click(t + 0.018, { freq: 1300, q: 2, dur: 0.005, peak: 0.25 * level })
  s.thock(t + 0.018, { f0: 150, f1: 70, dur: 0.09, peak: 0.55 * level })
}

/** a probe clip snapping onto a lead */
function clipSnap(s: Synth, t: number, level: number): void {
  s.click(t, { freq: 3400, q: 5, dur: 0.003, peak: 0.6 * level })
  s.ring(t, [
    { f: 4100, decay: 0.025, gain: 0.1 * level },
    { f: 6300, decay: 0.018, gain: 0.05 * level },
  ])
  s.thock(t, { f0: 380, f1: 200, dur: 0.02, peak: 0.3 * level })
}

/**
 * A part pushed into the board: the leads scrape into the contact springs,
 * click home one after another (a zip of min(count, 6) clicks), then the
 * body seats with a thock — lower and longer for a heavier part.
 */
function insert(s: Synth, t: number, count: number, kind: Kind, r: () => number, level = 1): number {
  if (kind === 'offboard') {
    benchThud(s, t, level)
    return t + 0.11
  }
  if (kind === 'probe') {
    clipSnap(s, t, level)
    return t + 0.03
  }
  const n = Math.max(1, Math.min(16, Math.round(count)))
  const h = heaviness(n)
  const heavy = kind === 'dip' || kind === 'footprint'
  const scrapeDur = 0.022 + 0.01 * h
  s.scrape(t, { f0: 1800, f1: 3200, dur: scrapeDur, peak: 0.25 * level, q: 1.6 })
  let at = t + scrapeDur * 0.6
  const zips = Math.min(n, 6)
  for (let i = 0; i < zips; i++) {
    s.click(at, { freq: 3500 * (1 - 0.1 * h) * (0.97 + 0.06 * r()), q: 6, dur: 0.006, peak: 0.75 * level * (0.85 + 0.15 * r()) })
    at += 0.007 + 0.005 * r()
  }
  const body = heavy
    ? { f0: lerp(180, 140, h), f1: lerp(70, 55, h), dur: lerp(0.07, 0.09, h), peak: lerp(0.7, 0.8, h) * level }
    : { f0: lerp(260, 170, h), f1: lerp(120, 75, h), dur: lerp(0.045, 0.07, h), peak: lerp(0.5, 0.62, h) * level }
  s.thock(at, body)
  return at + body.dur
}

/** A part pulled out: the unseat click, the leads scraping out, a tiny spring ring. */
function pull(s: Synth, t: number, count: number, kind: Kind, level = 1): number {
  if (kind === 'offboard') {
    s.scrape(t, { f0: 300, f1: 520, dur: 0.03, peak: 0.12 * level, q: 1.2 })
    s.click(t, { freq: 1400, q: 2, dur: 0.003, peak: 0.22 * level })
    return t + 0.04
  }
  const h = heaviness(count)
  if (kind === 'dip' || kind === 'footprint') s.thock(t, { f0: lerp(170, 130, h), f1: lerp(95, 80, h), dur: 0.04, peak: 0.35 * level })
  s.click(t, { freq: 3000, q: 5, dur: 0.004, peak: 0.55 * level })
  s.scrape(t + 0.003, { f0: 3000, f1: 1400, dur: 0.035 + 0.015 * h, peak: 0.3 * level, q: 1.6 })
  s.ring(t + 0.005, [{ f: 5200, decay: 0.03, gain: 0.12 * level }])
  return t + 0.055
}

/** a light tactile dome: the snap, the plunger body, a tiny high tick */
function press(s: Synth, t: number): void {
  s.click(t, { freq: 3200, q: 4, dur: 0.003, peak: 0.9 })
  s.thock(t, { f0: 420, f1: 200, dur: 0.018, peak: 0.5 })
  s.click(t + 0.001, { freq: 5600, q: 8, dur: 0.002, peak: 0.3 })
}

/**
 * Each cue's level (dB on its recipe as written below), so that through
 * sound.ts's graph (MECH_GAIN → compressor → MECH_MAKEUP → QUIET_GAIN) the
 * cues land where the product owner's 「有爽度」 wants them on a phone
 * speaker — measured offline (scratchpad round5/polish/sound/render.ts):
 * the moves that build the circuit loudest (insert ≈ −15 dBFS, a board
 * module ≈ −14, wire-in ≈ −16), the controls a little under them (press /
 * toggle ≈ −17), the small ticks of a turning knob well under (pot /
 * detent ≈ −23, the drag's aim snap ≈ −26), undo / redo a clear swish
 * (≈ −20), a refusal soft (≈ −20).
 */
export const CUE_LEVEL_DB: Readonly<Record<MechCue, number>> = {
  insert: -0.7, // ≈ −15 dBFS
  pull: -0.4, // ≈ −17
  seat: 1, // ≈ −18
  lift: 0.9, // ≈ −21
  settle: 1.7, // ≈ −21
  snap: 3, // ≈ −26
  'wire-tip': 0.3, // ≈ −20
  'wire-in': -2.3, // ≈ −16
  'wire-out': -1.4, // ≈ −18
  rotate: -0.8, // ≈ −18
  board: -1.2, // ≈ −14
  load: 0.9, // ≈ −17
  clear: 1.6, // ≈ −19
  undo: 2, // ≈ −20
  redo: 3.3, // ≈ −20
  refuse: -3.5, // ≈ −20
  press: -4.4, // ≈ −17
  release: -3.3, // ≈ −19
  latch: -4.5, // ≈ −17
  toggle: -5.6, // ≈ −17
  slide: -2.9, // ≈ −18
  dip: -2.5, // ≈ −20
  jumper: -2.4, // ≈ −18
  pot: 3.3, // ≈ −23
  detent: -3.6, // ≈ −23
  rotary: -3.6, // ≈ −18
  'relay-on': -4, // ≈ −16
  'relay-off': -3.6, // ≈ −19
}

/**
 * Render `cue` from time `t` onto `s` at its level (CUE_LEVEL_DB). `o.count`
 * = leads / bits / detents / jumpers / relays involved, `o.kind` = the body
 * that sounds (MechOpts), `o.level` 0..1 (a pot's position), `o.rand` = the
 * per-hit randomness (a fixed 0.5 when absent — deterministic).
 */
export function renderMech(s: Synth, cue: MechCue, t: number, o: MechVoiceOpts = {}): void {
  const db = CUE_LEVEL_DB[cue] ?? 0
  voice(db === 0 ? s : jitterSynth(s, 1, Math.pow(10, db / 20)), cue, t, o)
}

function voice(s: Synth, cue: MechCue, t: number, o: MechVoiceOpts): void {
  const r = o.rand ?? ((): number => 0.5)
  const count = o.count ?? 0
  const kind: Kind = o.kind ?? 'leads'
  switch (cue) {
    case 'insert':
      insert(s, t, count || 2, kind, r)
      return
    case 'pull':
      pull(s, t, count || 2, kind)
      return
    case 'seat': {
      // a moved part pressed back into its new holes (or set down on the bench)
      if (kind === 'offboard') {
        benchThud(s, t, 0.75)
        return
      }
      const h = heaviness(count || 2)
      const heavy = kind === 'dip' || kind === 'footprint'
      s.click(t, { freq: 3200, q: 5, dur: 0.004, peak: 0.4 })
      s.thock(t + 0.002, heavy ? { f0: lerp(180, 140, h), f1: 80, dur: 0.05, peak: 0.5 } : { f0: 240, f1: 130, dur: 0.035, peak: 0.4 })
      return
    }
    case 'lift':
      // unseated: a soft release click and a short slide out
      s.click(t, { freq: 2800, q: 4, dur: 0.003, peak: 0.3 })
      s.scrape(t + 0.002, { f0: 2200, f1: 3000, dur: 0.02, peak: 0.12, q: 1.6 })
      return
    case 'settle':
      // a drag that ended where it started: the part drops back
      s.click(t, { freq: 2400, q: 4, dur: 0.003, peak: 0.25 })
      s.thock(t, { f0: 260, f1: 160, dur: 0.02, peak: 0.2 })
      return
    case 'snap':
      // the aimed hole changed during a drag: barely there
      s.click(t, { freq: 4500, q: 6, dur: 0.003, peak: 0.12 })
      return
    case 'wire-tip':
      // a wire end (or a lead) touches its first hole
      s.click(t, { freq: 5000, q: 8, dur: 0.004, peak: 0.35 })
      s.ring(t, [{ f: 6200, decay: 0.02, gain: 0.1 }])
      return
    case 'wire-in': {
      // a jumper end slides in, the contact spring grips it: click + ring + a small body
      const n = Math.max(1, Math.min(3, count || 1))
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.045
        s.scrape(at, { f0: 2500, f1: 4000, dur: 0.015, peak: 0.18, q: 1.8 })
        s.click(at + 0.012, { freq: 4200, q: 7, dur: 0.005, peak: 0.7 })
        s.ring(at + 0.012, [
          { f: 3100, decay: 0.06, gain: 0.14 },
          { f: 4900, decay: 0.045, gain: 0.1 },
          { f: 7300, decay: 0.03, gain: 0.05 },
        ])
        s.thock(at + 0.012, { f0: 300, f1: 150, dur: 0.025, peak: 0.3 })
      }
      return
    }
    case 'wire-out':
      s.click(t, { freq: 3600, q: 5, dur: 0.004, peak: 0.5 })
      s.scrape(t + 0.003, { f0: 4000, f1: 1800, dur: 0.03, peak: 0.22, q: 1.6 })
      return
    case 'rotate':
      // two quick clicks: out of the holes, back in turned
      s.click(t, { freq: 3000, q: 5, dur: 0.003, peak: 0.45 })
      s.scrape(t + 0.004, { f0: 1600, f1: 2400, dur: 0.03, peak: 0.1, q: 1.4 })
      s.click(t + 0.04, { freq: 3400, q: 5, dur: 0.003, peak: 0.5 })
      s.thock(t + 0.04, { f0: 300, f1: 180, dur: 0.02, peak: 0.25 })
      return
    case 'board':
      // a breadboard module's plastic dovetail sliding home
      s.scrape(t, { f0: 900, f1: 1600, dur: 0.04, peak: 0.25, q: 1.2 })
      s.click(t + 0.04, { freq: 1800, q: 3, dur: 0.005, peak: 0.7 })
      s.thock(t + 0.04, { f0: 120, f1: 55, dur: 0.08, peak: 0.75 })
      return
    case 'load':
    case 'clear':
      // a whole circuit at once: a quick cascade of four light inserts / pulls
      for (let i = 0; i < 4; i++) {
        const at = t + i * 0.065 + 0.012 * r()
        if (cue === 'load') insert(s, at, 2 + i, 'leads', r, 0.6)
        else pull(s, at, 2, 'leads', 0.6)
      }
      return
    case 'undo':
    case 'redo': {
      // a soft swish back (falling) or forward (rising) in time, and a light landing click
      const back = cue === 'undo'
      s.scrape(t, { f0: back ? 2400 : 600, f1: back ? 600 : 2400, dur: 0.11, peak: 0.22, q: 1.2 })
      s.click(t + 0.1, { freq: back ? 1600 : 2600, q: 3, dur: 0.003, peak: 0.25 })
      return
    }
    case 'refuse':
      // that did not go in: two soft, low, falling thunks — a muffled tap
      // (audible on a phone speaker) on a low body, and no bright click, so
      // it never sounds like a success; no buzzer. Over in ≈ 0.18 s.
      s.thock(t, { f0: 230, f1: 150, dur: 0.055, peak: 0.55 })
      s.click(t, { freq: 620, q: 1.4, dur: 0.008, peak: 0.3 })
      s.thock(t + 0.09, { f0: 180, f1: 110, dur: 0.075, peak: 0.45 })
      s.click(t + 0.09, { freq: 480, q: 1.4, dur: 0.008, peak: 0.22 })
      return
    case 'press':
      press(s, t)
      return
    case 'release':
      s.click(t, { freq: 3800, q: 4, dur: 0.003, peak: 0.55 })
      s.thock(t, { f0: 520, f1: 260, dur: 0.015, peak: 0.35 })
      s.click(t + 0.001, { freq: 6200, q: 8, dur: 0.002, peak: 0.2 })
      return
    case 'latch':
      // pressed, and 28 ms later the mechanism locks it down
      press(s, t)
      s.click(t + 0.028, { freq: 2200, q: 4, dur: 0.004, peak: 0.6 })
      s.thock(t + 0.028, { f0: 300, f1: 120, dur: 0.03, peak: 0.5 })
      return
    case 'toggle':
      // a bat lever snapping over centre: hard click, low body, a little metal
      s.click(t, { freq: 2600, q: 3, dur: 0.004, peak: 1 })
      s.thock(t, { f0: 180, f1: 70, dur: 0.045, peak: 0.8 })
      s.ring(t, [
        { f: 1900, decay: 0.05, gain: 0.12 },
        { f: 3400, decay: 0.05, gain: 0.08 },
      ])
      return
    case 'slide':
      // a slide actuator dragged across, then the detent catches
      s.scrape(t, { f0: 1200, f1: 2600, dur: 0.03, peak: 0.3, q: 1.6 })
      s.click(t + 0.028, { freq: 3000, q: 5, dur: 0.003, peak: 0.6 })
      s.thock(t + 0.028, { f0: 300, f1: 180, dur: 0.015, peak: 0.25 })
      return
    case 'dip': {
      // each flipped DIP bit a tiny crisp click, 35 ms apart
      const n = Math.max(1, Math.min(8, count || 1))
      for (let i = 0; i < n; i++) {
        s.click(t + i * 0.035, { freq: 4800, q: 6, dur: 0.003, peak: 0.45 })
        s.thock(t + i * 0.035, { f0: 600, f1: 350, dur: 0.01, peak: 0.15 })
      }
      return
    }
    case 'jumper': {
      // a jumper cap pushed onto its pins — one per cap moved (the PCF8574's
      // A2–A0), 40 ms apart
      const n = Math.max(1, Math.min(3, count || 1))
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.04
        s.scrape(at, { f0: 2000, f1: 2800, dur: 0.012, peak: 0.1, q: 1.6 })
        s.click(at + 0.01, { freq: 3800, q: 5, dur: 0.003, peak: 0.6 })
        s.thock(at + 0.01, { f0: 350, f1: 160, dur: 0.025, peak: 0.45 })
      }
      return
    }
    case 'pot': {
      // the wiper's grain: a soft tick whose pitch follows the position
      const level = clamp01(o.level ?? 0.5)
      s.click(t, { freq: 2600 * (0.9 + 0.2 * level), q: 3, dur: 0.002, peak: 0.18 })
      return
    }
    case 'detent': {
      // a rotary encoder's detents: crisp, one per step (at most four)
      const n = Math.max(1, Math.min(4, count || 1))
      for (let i = 0; i < n; i++) {
        s.click(t + i * 0.022, { freq: 4200, q: 9, dur: 0.0025, peak: 0.4 })
        s.thock(t + i * 0.022, { f0: 900, f1: 600, dur: 0.006, peak: 0.1 })
      }
      return
    }
    case 'rotary':
      // a multimeter range dial: a heavier detent
      s.click(t, { freq: 2800, q: 5, dur: 0.004, peak: 0.7 })
      s.thock(t, { f0: 260, f1: 140, dur: 0.03, peak: 0.5 })
      s.ring(t, [{ f: 2100, decay: 0.04, gain: 0.08 }])
      return
    case 'relay-on': {
      // the armature slams onto the core, the NO contact rings and bounces once
      const n = Math.max(1, Math.min(3, count || 1))
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.006
        const k = i === 0 ? 1 : 0.6
        s.click(at, { freq: 2400, q: 2.5, dur: 0.004, peak: 0.9 * k })
        s.thock(at, { f0: 140, f1: 60, dur: 0.05, peak: 0.7 * k })
        s.ring(at + 0.001, [
          { f: 2900, decay: 0.05, gain: 0.12 * k },
          { f: 4400, decay: 0.04, gain: 0.09 * k },
          { f: 6100, decay: 0.03, gain: 0.06 * k },
        ])
        s.click(at + 0.003, { freq: 3600, q: 5, dur: 0.002, peak: 0.35 * k })
      }
      return
    }
    case 'relay-off': {
      // the spring pulls the armature back: lighter, higher
      const n = Math.max(1, Math.min(3, count || 1))
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.006
        const k = i === 0 ? 1 : 0.6
        s.click(at, { freq: 3200, q: 4, dur: 0.003, peak: 0.6 * k })
        s.thock(at, { f0: 200, f1: 100, dur: 0.035, peak: 0.45 * k })
        s.ring(at, [{ f: 3600, decay: 0.04, gain: 0.1 * k }])
      }
      return
    }
  }
}
