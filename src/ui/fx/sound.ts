/**
 * 音效 — short synthesized UI cues — CONTRACT C3 (owner: vivid).
 *
 *   playCue(cue)          'success' | 'burn' | 'place' | 'delete' | 'wire'
 *   useSound              zustand { enabled; setEnabled } — the 更多 →「音效」 row
 *
 * Every cue is synthesized with WebAudio (no audio files, nothing fetched):
 * 'success' a soft bell arpeggio (the lesson / circuit celebration), 'burn'
 * a short pop with a crackle (a part the simulation destroyed), 'place' /
 * 'wire' a quiet tick, 'delete' a short falling blip.
 *
 * Rules (product owner: 「成功喝采的感覺」 — but never a noisy app):
 *  - default ON and QUIET (master gain QUIET_GAIN), persisted per browser in
 *    localStorage 'bb.sound' ('0' = off; every access in try/catch);
 *  - NEVER before a user gesture: the AudioContext is created only after the
 *    first pointerdown / keydown / touchend on the page (autoplay policy —
 *    and a page that beeps on load is hostile), so a cue fired at boot (a
 *    restored circuit whose LED burns at once) stays silent;
 *  - safe anywhere: in node tests (no window / AudioContext) and when the
 *    browser refuses audio every call is a silent no-op, never a throw;
 *  - rate-limited per cue (a burst of burned LEDs pops once, not ten times).
 *
 * The visual cues never depend on sound: a muted page shows exactly the same
 * celebration / damage feedback.
 */
import { create } from 'zustand'

export type SoundCue = 'success' | 'burn' | 'place' | 'delete' | 'wire'

export const LS_SOUND = 'bb.sound'

/** master volume of every cue (quiet: a celebration, not an alarm) */
export const QUIET_GAIN = 0.16

/** minimum spacing of two cues of the same kind (ms) */
const MIN_GAP_MS: Record<SoundCue, number> = {
  success: 900,
  burn: 350,
  place: 60,
  delete: 80,
  wire: 60,
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

// ------------------------------------------------------------ gesture gate

let gestured = false
let gateInstalled = false

/** The page has seen a user gesture (cues may sound). */
export function soundUnlocked(): boolean {
  return gestured
}

function installGestureGate(): void {
  if (gateInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  gateInstalled = true
  const unlock = (): void => {
    gestured = true
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
    window.removeEventListener('touchend', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
  window.addEventListener('touchend', unlock, true)
}
installGestureGate()

// ------------------------------------------------------------ audio graph

type Ctx = AudioContext
let ctx: Ctx | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
const lastAt: Partial<Record<SoundCue, number>> = {}

function audio(): Ctx | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = QUIET_GAIN
    master.connect(ctx.destination)
  } catch {
    ctx = null
    master = null
  }
  return ctx
}

function noise(c: Ctx): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.4)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  // deterministic LCG noise: the same pop every time
  let s = 0x2468ace
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    d[i] = (s / 0xffffffff) * 2 - 1
  }
  noiseBuf = buf
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

function render(c: Ctx, out: AudioNode, cue: SoundCue, short: boolean): void {
  const t0 = c.currentTime + 0.01
  switch (cue) {
    case 'success': {
      // a soft bell arpeggio C6 · E6 · G6 (· C7): each note a sine with a
      // quiet octave partial — the 「完成！」 chime; the short variant is the
      // circuit-ok sparkle (two notes)
      const notes = short ? [1318.5, 1975.5] : [1046.5, 1318.5, 1568.0, 2093.0]
      const step = short ? 0.075 : 0.095
      notes.forEach((f, i) => {
        const at = t0 + i * step
        const dur = short ? 0.45 : i === notes.length - 1 ? 1.1 : 0.7
        tone(c, out, at, { f0: f, dur, peak: 0.55, attack: 0.008 })
        tone(c, out, at, { f0: f * 2, dur: dur * 0.6, peak: 0.12, attack: 0.008 })
      })
      break
    }
    case 'burn': {
      // a small electrical 'pop': a sharp mid noise crack, a low thump, then
      // a few dying crackles
      burst(c, out, t0, { dur: 0.07, peak: 0.9, freq: 1800, q: 0.7 })
      tone(c, out, t0, { f0: 150, f1: 48, type: 'sine', dur: 0.14, peak: 0.8, attack: 0.002 })
      for (let i = 0; i < 4; i++) burst(c, out, t0 + 0.09 + i * 0.055 + Math.random() * 0.02, { dur: 0.018, peak: 0.25 - i * 0.05, freq: 3200, q: 2 })
      break
    }
    case 'place':
      tone(c, out, t0, { f0: 940, f1: 700, type: 'sine', dur: 0.05, peak: 0.35, attack: 0.002 })
      break
    case 'wire':
      tone(c, out, t0, { f0: 1500, f1: 1250, type: 'triangle', dur: 0.035, peak: 0.28, attack: 0.002 })
      break
    case 'delete':
      tone(c, out, t0, { f0: 520, f1: 240, type: 'triangle', dur: 0.11, peak: 0.32, attack: 0.003 })
      break
  }
}

/**
 * Play one cue (silent when 音效 is off, before the first user gesture, or
 * where the browser has no audio). `opts.short` picks the lighter variant
 * of 'success' (the circuit-ok sparkle). Never throws.
 */
export function playCue(cue: SoundCue, opts?: { short?: boolean }): void {
  if (!gestured || !useSound.getState().enabled) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const last = lastAt[cue]
  if (last !== undefined && now - last < MIN_GAP_MS[cue]) return
  lastAt[cue] = now
  try {
    const c = audio()
    if (!c || !master) return
    if (c.state === 'suspended') void c.resume().catch(() => undefined)
    render(c, master, cue, opts?.short === true)
  } catch {
    /* audio must never break an interaction */
  }
}

/** Tests: forget the gesture gate and the rate limiter. */
export function __resetSoundForTests(opts: { gestured?: boolean } = {}): void {
  gestured = opts.gestured ?? false
  for (const k of Object.keys(lastAt) as SoundCue[]) delete lastAt[k]
}
