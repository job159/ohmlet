/**
 * 音效 — short synthesized UI cues — CONTRACT C3 (owner: vivid; the
 * mechanical voices and this engine: sound).
 *
 *   playCue(cue)          'success' | 'burn' | 'place' | 'delete' | 'wire'
 *   playMech(cue, opts)   the mechanical sounds (MechCue) of hands-on actions
 *                         and of simulated mechanics (relay contacts)
 *   useSound              zustand { enabled; setEnabled } — the 更多 →「音效」 row
 *
 * Every cue is synthesized with WebAudio (no audio files, nothing fetched):
 * 'success' a soft bell arpeggio (the lesson / circuit celebration), 'burn'
 * a short pop with a crackle (a part the simulation destroyed); the
 * mechanical cues are the recipes of mech-voices.ts (a part zipping into the
 * board, a wire end gripped by its contact spring, a tactile dome, a toggle
 * lever, a relay armature…) — 'place' / 'wire' / 'delete' are aliases of
 * 'insert' / 'wire-in' / 'pull' for older callers. Who plays what:
 * mech-watch.ts (the board's own changes, holds, relay edges) and the 3D
 * layer's FxCue sink (CelebrationOverlay).
 *
 * Rules (product owner: 「成功喝采的感覺」 and 「有爽度的聲效」 — but never a
 * noisy app):
 *  - default ON, persisted per browser in localStorage 'bb.sound' ('0' =
 *    off; every access in try/catch). The master is QUIET (QUIET_GAIN: the
 *    chime and the burn pop); the mechanical bus is crisper — MECH_GAIN into
 *    a compressor that leaves a single cue alone and only squeezes a pile-up
 *    (MAX_LIVE_CUES voices at once stay under −3 dBFS), then MECH_MAKEUP
 *    (measured offline: an insert ≈ −15 dBFS, a pot tick ≈ −23 — loud
 *    enough for a phone speaker); the first cue of a session is as loud as
 *    any other (MECH_DRY: a dry path while the new compressor warms up);
 *  - only where the page may sound (setSoundGate — CelebrationOverlay
 *    installs mech-watch soundsHere: the product chrome, not the ?shotrig
 *    harness): elsewhere nothing plays and no AudioContext is ever made;
 *  - NEVER before a user gesture: the AudioContext is created and resumed
 *    INSIDE the first pointerdown / keydown / touchend on the page (autoplay
 *    policy; iOS / Safari unlock audio only there — with a one-sample silent
 *    buffer) — where a cue may play there at all (音效 on, the gate open),
 *    so a cue fired at boot (a restored circuit whose LED burns at once)
 *    stays silent. The gate keeps listening while the context is not
 *    running, so the next tap revives a context a tab switch or an iOS
 *    interruption suspended (or makes the first one after a switch to the
 *    product chrome); where the browser has it, the audio session is
 *    'ambient' (mixes with the user's music, follows the ringer switch);
 *  - safe anywhere: in node tests (no window / AudioContext) and when the
 *    browser refuses audio every call is a silent no-op, never a throw;
 *  - rate-limited per cue (MIN_GAP_MS, MECH_GAP_MS: a burst of burned LEDs
 *    pops once, a dragged slider ticks, it does not buzz); at most
 *    MAX_LIVE_CUES mechanical cues sound at once (more are dropped); every
 *    mechanical hit varies a little (±4 % pitch, ±1.5 dB, and each click a
 *    different grain of the noise at the same level — mech-voices clickTop —
 *    all from a seeded LCG, deterministic under test) so repeated clicks are
 *    not machine-gunned.
 *
 * The visual cues never depend on sound: a muted page shows exactly the same
 * celebration / damage / editing feedback.
 */
import { create } from 'zustand'
import {
  CLICK_SPAN_S,
  SCRAPE_TRIM,
  clickAttack,
  clickTop,
  fillNoise,
  jitterSynth,
  noiseMakeup,
  renderMech,
  type RingPartial,
  type Synth,
} from './mech-voices'

export type SoundCue = 'success' | 'burn' | 'place' | 'delete' | 'wire'

export const LS_SOUND = 'bb.sound'

/** master volume of every cue (quiet: a celebration, not an alarm) */
export const QUIET_GAIN = 0.16

/**
 * The mechanical bus into its compressor (relative to the recipes' peaks):
 * a single cue reaches at most ≈ −7.5 dB there, under MECH_COMP's threshold,
 * so the compressor touches only a pile-up of cues.
 */
export const MECH_GAIN = 0.5

/**
 * The bus compressor (DynamicsCompressorNode): a hard-ish knee above every
 * single cue, so six cues at once stay under −3 dBFS at the output (measured
 * offline with the WebAudio compressor curve) while one cue passes untouched.
 */
export const MECH_COMP = { threshold: -6, knee: 3, ratio: 8, attack: 0.002, release: 0.08 } as const

/**
 * The bus after its compressor, up to the 爽度 level (the compressor's own
 * automatic make-up gain included in the measurement): with QUIET_GAIN an
 * insert peaks at ≈ −15 dBFS (CUE_LEVEL_DB sets the others).
 */
export const MECH_MAKEUP = 2.6

/**
 * The compressor's cold start. A new DynamicsCompressorNode (Chromium's
 * DynamicsCompressorKernel; Firefox and WebKit carry the same kernel) starts
 * at FULL attenuation and recovers over ≈ 85 ms (release 0.08 s), so the first cue
 * played in the gesture that makes the context came out up to 12.8 dB quieter
 * (a press at +0 ms −28.3 dBFS vs −15.5 settled; measured in Edge on this
 * graph) — the very first press, R on the ghost or Ctrl+V of a session.
 * For `hold` s after the context is made the bus goes round the compressor
 * instead — through the compressor's own static curve as a waveshaper (an
 * instant compressor: a single cue, under the threshold, passes exactly; a
 * pile-up is capped, never above ≈ −9.3 dBFS), at its automatic make-up gain,
 * delayed by its look-ahead (so the two paths line up sample for sample) —
 * then cross-fades to the by-then settled compressor over `fade` s. No cue
 * waits: the first one sounds at once, at its settled level.
 */
export const MECH_DRY = { hold: 0.1, fade: 0.04 } as const

/** DynamicsCompressorKernel's fixed look-ahead (s; whole frames: floor(0.006 × sampleRate) — measured 288 at 48 kHz, 264 at 44.1 kHz) */
export const COMP_LOOKAHEAD_S = 0.006

/**
 * DynamicsCompressorKernel's static curve (KneeCurve / Saturate, its knee
 * sharpness k found by KAtSlope's 15-step search) for these settings: input →
 * output level, linear, for x ≥ 0. Linear up to the threshold.
 */
export function compressorCurve(c: { threshold: number; knee: number; ratio: number }): (x: number) => number {
  const lin = (db: number): number => Math.pow(10, db / 20)
  const dB = (x: number): number => 20 * Math.log10(Math.max(1e-12, x))
  const thr = lin(c.threshold)
  const kneeDb = c.threshold + c.knee
  const kneeLin = lin(kneeDb)
  const kneeCurve = (x: number, k: number): number => (x < thr ? x : thr + (1 - Math.exp(-k * (x - thr))) / k)
  const slopeAt = (x: number, k: number): number => (x < thr ? 1 : (dB(kneeCurve(x * 1.001, k)) - dB(kneeCurve(x, k))) / (dB(x * 1.001) - dB(x)))
  let lo = 0.1
  let hi = 10000
  let k = 5
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeLin, k) < 1 / c.ratio) hi = k
    else lo = k
    k = Math.sqrt(lo * hi)
  }
  const yKneeDb = dB(kneeCurve(kneeLin, k))
  return (x) => (x < kneeLin ? kneeCurve(x, k) : lin(yKneeDb + (dB(x) - kneeDb) / c.ratio))
}

/** The compressor's automatic make-up gain: (1 / curve(1))^0.6 — what a settled compressor applies to a signal under its threshold (MECH_COMP: 1.3471, measured in Edge 1.34712). */
export function compressorMakeup(c: { threshold: number; knee: number; ratio: number }): number {
  return Math.pow(1 / compressorCurve(c)(1), 0.6)
}

/** The dry path's waveshaper curve over −1…1 (beyond ±1 a WaveShaperNode holds the ends): the static curve, odd-symmetric. */
export function compressorShape(c: { threshold: number; knee: number; ratio: number }, points = 4097): Float32Array<ArrayBuffer> {
  const sat = compressorCurve(c)
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (2 * i) / (points - 1) - 1
    curve[i] = Math.sign(x) * sat(Math.abs(x))
  }
  return curve
}

/** at most this many mechanical cues sound at once; more are dropped (a burst stays a click, not a roar) */
export const MAX_LIVE_CUES = 6

/** cues start this long after "now" (s): enough for the scheduler, too little to feel late */
const LEAD_S = 0.005
/** per-hit variation: ± pitch factor, ± level (dB) */
const PITCH_JITTER = 0.04
const GAIN_JITTER_DB = 1.5
const JITTER_SEED = 0x5eed1234

/** minimum spacing of two cues of the same kind (ms) */
const MIN_GAP_MS: Record<'success' | 'burn', number> = {
  success: 900,
  burn: 350,
}

/**
 * Mechanical sounds of hands-on actions and of simulated mechanics (relay
 * contacts). `count` = leads / bits involved, `kind` = the body that makes
 * the sound, `level` 0..1 (e.g. a pot position), `gain` a relative trim.
 */
export type MechCue =
  | 'insert' | 'pull' | 'seat' | 'lift' | 'settle' | 'snap'
  | 'wire-tip' | 'wire-in' | 'wire-out' | 'rotate' | 'board'
  | 'load' | 'clear' | 'undo' | 'redo' | 'refuse'
  | 'press' | 'release' | 'latch' | 'toggle' | 'slide' | 'dip'
  | 'jumper' | 'pot' | 'detent' | 'rotary'
  | 'relay-on' | 'relay-off'

export interface MechOpts {
  count?: number
  kind?: 'leads' | 'dip' | 'footprint' | 'offboard' | 'probe'
  level?: number
  gain?: number
}

/** minimum spacing of two mechanical cues of the same kind (ms) */
export const MECH_GAP_MS: Record<MechCue, number> = {
  press: 25,
  release: 25,
  latch: 80,
  toggle: 50,
  slide: 50,
  dip: 30,
  pot: 30,
  detent: 18,
  jumper: 50,
  rotary: 50,
  insert: 45,
  pull: 60,
  seat: 45,
  rotate: 60,
  'wire-tip': 40,
  'wire-in': 40,
  'wire-out': 50,
  lift: 80,
  settle: 60,
  snap: 30,
  refuse: 120,
  'relay-on': 35,
  'relay-off': 35,
  board: 150,
  load: 400,
  clear: 400,
  undo: 90,
  redo: 90,
}

/** the older edit cues are the mechanical voices now */
const LEGACY_MECH: Record<'place' | 'wire' | 'delete', readonly [MechCue, MechOpts]> = {
  place: ['insert', { count: 2 }],
  wire: ['wire-in', {}],
  delete: ['pull', {}],
}

function loadEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(LS_SOUND) !== '0'
  } catch {
    return true
  }
}

export interface SoundState {
  /** cues audible (default on) */
  enabled: boolean
  setEnabled(v: boolean): void
}

export const useSound = create<SoundState>()((set) => ({
  enabled: loadEnabled(),
  setEnabled(v) {
    set({ enabled: v })
    try {
      if (v) window.localStorage.removeItem(LS_SOUND)
      else window.localStorage.setItem(LS_SOUND, '0')
    } catch {
      /* storage unavailable: the switch still works for this page */
    }
  },
}))

// ------------------------------------------------------------ where it may sound

/** where the page may sound at all (default: anywhere — tests); CelebrationOverlay installs mech-watch soundsHere */
let soundGate: () => boolean = () => true

/**
 * Where the page may sound: the product chrome, not the classic chrome or the
 * ?shotrig harness (CelebrationOverlay installs mech-watch soundsHere; null =
 * anywhere). Where it says no, nothing plays and no AudioContext is made — not
 * even at the first gesture.
 */
export function setSoundGate(gate: (() => boolean) | null): void {
  soundGate = gate ?? (() => true)
}

/** a cue may sound here and now: 音效 on and the gate open */
function voicing(): boolean {
  if (!useSound.getState().enabled) return false
  try {
    return soundGate()
  } catch {
    return false
  }
}

// ------------------------------------------------------------ gesture gate

let gestured = false
/** the gate's listeners are on the window */
let gateOn = false
const GATE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const

/** The page has seen a user gesture (cues may sound). */
export function soundUnlocked(): boolean {
  return gestured
}

function listenForGesture(on: boolean): void {
  if (on === gateOn || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  gateOn = on
  for (const type of GATE_EVENTS) {
    if (on) window.addEventListener(type, onGesture, true)
    else window.removeEventListener(type, onGesture, true)
  }
}

/**
 * A user gesture: cues may sound from now on — and where one may sound here
 * (音效 on, the gate open: the product chrome), wake the audio right here.
 * Elsewhere (the classic chrome, ?shotrig, 音效 off) no context is made; the
 * gate keeps listening, so the first gesture after that changes wakes it. A
 * key that activates nothing (a lone Ctrl / Shift, Esc) waits for the next
 * one, where the browser says so (navigator.userActivation): a context made
 * there would only start suspended, with a console warning.
 */
function onGesture(): void {
  try {
    const ua = typeof navigator !== 'undefined' ? (navigator as unknown as { userActivation?: { isActive?: boolean } }).userActivation : undefined
    if (ua && ua.isActive === false) return
  } catch {
    /* no activation API: every gesture counts */
  }
  gestured = true
  if (voicing()) wake()
}

/**
 * Inside a gesture: create the context if needed, resume it and start a
 * one-sample silent buffer (iOS / Safari unlock audio only from a gesture).
 * The gate keeps listening until the context runs.
 */
function wake(): void {
  try {
    const c = audio()
    if (!c) {
      listenForGesture(false) // no WebAudio here: nothing will ever wake
      return
    }
    if (c.state === 'running') {
      listenForGesture(false)
      return
    }
    resume(c)
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, c.sampleRate)
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* audio must never break a gesture */
  }
}
listenForGesture(true)

// ------------------------------------------------------------ audio graph

type Ctx = AudioContext
let ctx: Ctx | null = null
let master: GainNode | null = null
let mechBus: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
/** noiseBuf's samples (each click measures its own grain of them) */
let noiseData: Float32Array | null = null
const lastAt = new Map<string, number>()
/** context times at which the sounding cues end (the voice cap) */
let liveEnds: number[] = []
/** cues started since the context was made (tests) */
let started = 0
let seed = JITTER_SEED

/** the per-hit randomness: a seeded LCG, 0..1 */
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

/** iOS 17+ Safari: UI sounds mix with the user's music and follow the ringer switch. */
function ambientSession(): void {
  try {
    const s = typeof navigator !== 'undefined' ? (navigator as unknown as { audioSession?: { type?: string } }).audioSession : undefined
    if (s && typeof s === 'object' && 'type' in s) s.type = 'ambient'
  } catch {
    /* not supported: the browser's default session */
  }
}

/** Resume a suspended / interrupted context (a promise where the browser gives one). */
function resume(c: Ctx): void {
  try {
    const p = c.resume() as Promise<void> | undefined
    if (p && typeof p.then === 'function') {
      p.then(
        () => {
          if (c === ctx && c.state === 'running') listenForGesture(false)
        },
        () => undefined,
      )
    }
  } catch {
    /* the next gesture tries again */
  }
}

/** A context that stops running (iOS interruption, a suspended tab) re-arms the gate. */
function watchState(c: Ctx): void {
  const onState = (): void => {
    if (c === ctx) listenForGesture(c.state !== 'running')
  }
  try {
    if (typeof c.addEventListener === 'function') c.addEventListener('statechange', onState)
    else c.onstatechange = onState
  } catch {
    /* no state events: the gate re-arms only from playCue / playMech */
  }
}

function audio(): Ctx | null {
  if (ctx && ctx.state !== 'closed') return ctx
  ctx = null
  master = null
  mechBus = null
  noiseBuf = null
  noiseData = null
  if (typeof window === 'undefined') return null
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ambientSession()
    let c: Ctx
    try {
      c = new AC({ latencyHint: 'interactive' })
    } catch {
      c = new AC()
    }
    const m = c.createGain()
    m.gain.value = QUIET_GAIN
    m.connect(c.destination)
    // the mechanical bus: MECH_GAIN → a compressor that only a pile-up of
    // cues reaches (a single cue stays under its threshold — measured
    // offline; for its first ≈ 0.1 s a dry path stands in while it warms
    // up: MECH_DRY) → MECH_MAKEUP → the master
    const bus = c.createGain()
    bus.gain.value = MECH_GAIN
    const out = c.createGain()
    out.gain.value = MECH_MAKEUP
    const comp = typeof c.createDynamicsCompressor === 'function' ? c.createDynamicsCompressor() : null
    if (comp) {
      comp.threshold.value = MECH_COMP.threshold
      comp.knee.value = MECH_COMP.knee
      comp.ratio.value = MECH_COMP.ratio
      comp.attack.value = MECH_COMP.attack
      comp.release.value = MECH_COMP.release
      bus.connect(comp)
      // the compressor starts cold (full attenuation): round it at first (MECH_DRY)
      if (!bypassColdStart(c, bus, comp, out)) comp.connect(out)
    } else {
      bus.connect(out)
    }
    out.connect(m)
    ctx = c
    master = m
    mechBus = bus
    watchState(c)
  } catch {
    ctx = null
    master = null
    mechBus = null
  }
  return ctx
}

/**
 * The first MECH_DRY.hold s of a new context: the bus also runs through a
 * dry path (the compressor's look-ahead delay → its static curve → its
 * make-up gain) that carries the cues while the compressor's detector
 * recovers, then cross-fades (MECH_DRY.fade, equal-gain: the two paths are
 * the same signal, aligned) to the compressor for good. False where the
 * browser has no DelayNode / WaveShaperNode: the compressor alone (as before).
 */
function bypassColdStart(c: Ctx, bus: GainNode, comp: DynamicsCompressorNode, out: GainNode): boolean {
  if (typeof c.createDelay !== 'function' || typeof c.createWaveShaper !== 'function') return false
  try {
    const t0 = c.currentTime
    const holdEnd = t0 + MECH_DRY.hold
    const fadeEnd = holdEnd + MECH_DRY.fade
    const delay = c.createDelay(0.05)
    delay.delayTime.value = Math.floor(COMP_LOOKAHEAD_S * c.sampleRate) / c.sampleRate
    const shaper = c.createWaveShaper()
    shaper.curve = compressorShape(MECH_COMP)
    const dry = c.createGain()
    const makeup = compressorMakeup(MECH_COMP)
    dry.gain.setValueAtTime(makeup, t0)
    dry.gain.setValueAtTime(makeup, holdEnd)
    dry.gain.linearRampToValueAtTime(0, fadeEnd)
    const wet = c.createGain()
    wet.gain.setValueAtTime(0, t0)
    wet.gain.setValueAtTime(0, holdEnd)
    wet.gain.linearRampToValueAtTime(1, fadeEnd)
    // every node made (nothing connected yet): wire both paths into the make-up
    bus.connect(delay)
    delay.connect(shaper)
    shaper.connect(dry)
    dry.connect(out)
    comp.connect(wet)
    wet.connect(out)
    return true
  } catch {
    return false
  }
}

function noise(c: Ctx): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.4)
  const buf = c.createBuffer(1, len, c.sampleRate)
  // deterministic LCG noise (mech-voices fillNoise): each click measures its own grain of it
  const data = buf.getChannelData(0)
  fillNoise(data)
  noiseBuf = buf
  noiseData = data
  return buf
}

/** One enveloped oscillator note into the master bus. */
function tone(
  c: Ctx,
  out: AudioNode,
  at: number,
  opts: { f0: number; f1?: number; type?: OscillatorType; dur: number; peak: number; attack?: number },
): void {
  const o = c.createOscillator()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(opts.f0, at)
  if (opts.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), at + opts.dur)
  const g = c.createGain()
  const a = opts.attack ?? 0.006
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(opts.peak, at + a)
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur)
  o.connect(g)
  g.connect(out)
  o.start(at)
  o.stop(at + opts.dur + 0.02)
}

/** A filtered noise burst (pops, crackles). */
function burst(c: Ctx, out: AudioNode, at: number, opts: { dur: number; peak: number; freq: number; q?: number }): void {
  const src = c.createBufferSource()
  src.buffer = noise(c)
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = opts.freq
  f.Q.value = opts.q ?? 0.9
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(opts.peak, at + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur)
  src.connect(f)
  f.connect(g)
  g.connect(out)
  src.start(at, Math.random() * 0.2)
  src.stop(at + opts.dur + 0.02)
}

/** The celebration and damage cues; returns when the cue ends (context time). */
function render(c: Ctx, out: AudioNode, cue: 'success' | 'burn', short: boolean): number {
  const t0 = c.currentTime + 0.01
  switch (cue) {
    case 'success': {
      // a soft bell arpeggio C6 · E6 · G6 (· C7): each note a sine with a
      // quiet octave partial — the 「完成！」 chime; the short variant is the
      // circuit-ok sparkle (two notes)
      const notes = short ? [1318.5, 1975.5] : [1046.5, 1318.5, 1568.0, 2093.0]
      const step = short ? 0.075 : 0.095
      let end = t0
      notes.forEach((f, i) => {
        const at = t0 + i * step
        const dur = short ? 0.45 : i === notes.length - 1 ? 1.1 : 0.7
        tone(c, out, at, { f0: f, dur, peak: 0.55, attack: 0.008 })
        tone(c, out, at, { f0: f * 2, dur: dur * 0.6, peak: 0.12, attack: 0.008 })
        end = Math.max(end, at + dur + 0.02)
      })
      return end
    }
    case 'burn': {
      // a small electrical 'pop': a sharp mid noise crack, a low thump, then
      // a few dying crackles
      burst(c, out, t0, { dur: 0.07, peak: 0.9, freq: 1800, q: 0.7 })
      tone(c, out, t0, { f0: 150, f1: 48, type: 'sine', dur: 0.14, peak: 0.8, attack: 0.002 })
      for (let i = 0; i < 4; i++) burst(c, out, t0 + 0.09 + i * 0.055 + Math.random() * 0.02, { dur: 0.018, peak: 0.25 - i * 0.05, freq: 3200, q: 2 })
      return t0 + 0.36
    }
  }
}

/** an attack to `peak`, then an exponential fall to −60 dB at `at + dur`, then silence */
function envelope(p: AudioParam, at: number, attack: number, dur: number, peak: number): void {
  const top = Math.max(0.002, peak)
  p.setValueAtTime(0.0001, at)
  p.exponentialRampToValueAtTime(top, at + attack)
  p.exponentialRampToValueAtTime(Math.min(0.001, top / 2), at + dur)
  p.linearRampToValueAtTime(0, at + dur + 0.004)
}

/** The mechanical voices' primitives (mech-voices.ts Synth) on WebAudio, into the mechanical bus. */
class WebSynth implements Synth {
  /** when this cue's last sound ends (context time) */
  end = 0

  constructor(
    private readonly c: Ctx,
    private readonly out: AudioNode,
  ) {}

  /** noise from `offset` (s into the shared buffer) through a band-pass f0 → f1, enveloped */
  private noiseBand(at: number, dur: number, f0: number, f1: number, q: number, peak: number, attack: number, offset: number): void {
    const c = this.c
    const src = c.createBufferSource()
    src.buffer = noise(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(f0, at)
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur)
    f.Q.value = q
    const g = c.createGain()
    envelope(g.gain, at, attack, dur, peak)
    src.connect(f)
    f.connect(g)
    g.connect(this.out)
    src.start(at, offset)
    src.stop(at + dur + 0.01)
    this.end = Math.max(this.end, at + dur + 0.01)
  }

  private sine(at: number, f0: number, f1: number, dur: number, peak: number, attack: number): void {
    const c = this.c
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, at)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur)
    const g = c.createGain()
    envelope(g.gain, at, attack, dur, peak)
    o.connect(g)
    g.connect(this.out)
    o.start(at)
    o.stop(at + dur + 0.01)
    this.end = Math.max(this.end, at + dur + 0.01)
  }

  /**
   * A click from a random grain of the shared noise (the seeded LCG), its
   * envelope set so this grain peaks at the recipe's peak (mech-voices
   * clickTop): every click a little different, every one at its level. It
   * starts on a sample frame, so the filter sees the grain clickTop measured.
   */
  click(at: number, o: { freq: number; q: number; dur: number; peak: number }): void {
    const c = this.c
    const sr = c.sampleRate
    noise(c)
    const data = noiseData
    if (!data) return
    const start = Math.floor(rand() * Math.max(1, data.length - Math.ceil(CLICK_SPAN_S * sr)))
    const top = clickTop(data, sr, start, o)
    this.noiseBand(Math.ceil(at * sr) / sr, o.dur, o.freq, o.freq, o.q, top, clickAttack(o.dur), start / sr)
  }

  scrape(at: number, o: { f0: number; f1: number; dur: number; peak: number; q?: number }): void {
    const q = o.q ?? 1.4
    const peak = o.peak * SCRAPE_TRIM * noiseMakeup(Math.sqrt(o.f0 * o.f1), q, this.c.sampleRate)
    this.noiseBand(at, o.dur, o.f0, o.f1, q, peak, o.dur * 0.35, rand() * 0.3)
  }

  thock(at: number, o: { f0: number; f1: number; dur: number; peak: number }): void {
    this.sine(at, o.f0, o.f1, o.dur, o.peak, 0.0015)
  }

  ring(at: number, partials: readonly RingPartial[]): void {
    for (const x of partials) this.sine(at, x.f, x.f, x.decay, x.gain, 0.0008)
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** the same cue sounded less than `gap` ms ago (only cues that really started count: soundedNow) */
function tooSoon(key: string, gap: number): boolean {
  const last = lastAt.get(key)
  return last !== undefined && nowMs() - last < gap
}

function soundedNow(key: string): void {
  lastAt.set(key, nowMs())
}

/** room for one more mechanical cue (the voice cap) */
function voiceFree(c: Ctx): boolean {
  const now = c.currentTime
  if (liveEnds.length > 0) liveEnds = liveEnds.filter((e) => e > now)
  return liveEnds.length < MAX_LIVE_CUES
}

/**
 * Play one cue (silent when 音效 is off, before the first user gesture, or
 * where the browser has no audio). `opts.short` picks the lighter variant
 * of 'success' (the circuit-ok sparkle). 'place' / 'wire' / 'delete' play
 * the mechanical 'insert' / 'wire-in' / 'pull'. Never throws.
 */
export function playCue(cue: SoundCue, opts?: { short?: boolean }): void {
  if (cue === 'place' || cue === 'wire' || cue === 'delete') {
    const [mech, mechOpts] = LEGACY_MECH[cue]
    playMech(mech, mechOpts)
    return
  }
  if (!gestured || !voicing()) return
  const key = `cue:${cue}`
  if (tooSoon(key, MIN_GAP_MS[cue])) return
  try {
    const c = audio()
    if (!c || !master) return
    if (c.state !== 'running') resume(c)
    soundedNow(key)
    // the cheer and the burn always sound (they are rare); they count as live
    liveEnds.push(render(c, master, cue, opts?.short === true))
    started++
  } catch {
    /* audio must never break an interaction */
  }
}

/**
 * Play a mechanical cue (same gates as playCue: 音效 on, after a gesture,
 * where the page may sound — setSoundGate —, never throws). The recipe is
 * mech-voices.ts renderMech (at its CUE_LEVEL_DB); this adds the per-hit
 * variation, the per-cue spacing (MECH_GAP_MS) and the voice cap
 * (MAX_LIVE_CUES).
 */
export function playMech(cue: MechCue, opts?: MechOpts): void {
  if (!gestured || !voicing()) return
  const key = `mech:${cue}`
  if (tooSoon(key, MECH_GAP_MS[cue])) return
  try {
    const c = audio()
    if (!c || !mechBus || !voiceFree(c)) return
    if (c.state !== 'running') resume(c)
    soundedNow(key)
    const synth = new WebSynth(c, mechBus)
    const pitch = 1 + (rand() * 2 - 1) * PITCH_JITTER
    const trim = Math.min(1, Math.max(0, opts?.gain ?? 1))
    const gain = Math.pow(10, ((rand() * 2 - 1) * GAIN_JITTER_DB) / 20) * trim
    renderMech(jitterSynth(synth, pitch, gain), cue, c.currentTime + LEAD_S, {
      count: opts?.count,
      kind: opts?.kind,
      level: opts?.level,
      rand,
    })
    if (synth.end > 0) {
      liveEnds.push(synth.end)
      started++
    }
  } catch {
    /* audio must never break an interaction */
  }
}

/**
 * Tests: forget the gesture gate and the rate limiter; `dropContext` also
 * forgets the AudioContext and its buses, the noise buffer, the live cues
 * and the jitter seed (so a test can stub window.AudioContext), and re-arms
 * the gate on the current window.
 */
export function __resetSoundForTests(opts: { gestured?: boolean; dropContext?: boolean } = {}): void {
  gestured = opts.gestured ?? false
  lastAt.clear()
  if (opts.dropContext) {
    try {
      const closing = ctx?.close?.()
      if (closing && typeof closing.catch === 'function') closing.catch(() => undefined)
    } catch {
      /* a stub without close */
    }
    ctx = null
    master = null
    mechBus = null
    noiseBuf = null
    noiseData = null
    liveEnds = []
    started = 0
    seed = JITTER_SEED
    gateOn = false // the listeners belonged to the previous (stubbed) window
  }
  if (!gestured) listenForGesture(true)
}

/** Tests: cues started since the last context drop, cues counted live, a context exists, the gate listens. */
export function __soundStatsForTests(): { started: number; live: number; context: boolean; listening: boolean } {
  return { started, live: liveEnds.length, context: ctx !== null, listening: gateOn }
}
