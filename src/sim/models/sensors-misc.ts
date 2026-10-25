/**
 * Edge-timed sensors without a bus protocol:
 *
 *  hcsr04  HC-SR04 ultrasonic ranger (Elecfreaks / Cytron HC-SR04 user
 *          manual): TRIG high ≥ 10 µs → on its falling edge the module
 *          sends 8 cycles of 40 kHz and raises ECHO; ECHO stays high for the
 *          round trip 2·d / c of the sound (c = 331.3·√(1 + T/273.15) m/s);
 *          with no echo (beyond 4 m) it times out after 38 ms. ECHO is a
 *          push-pull output at the module VCC (5 V).
 *  ky040   KY-040 module with an EC11-type mechanical encoder, 20 detents
 *          and 20 pulses per turn: contacts A (CLK) and B (DT) switch to
 *          GND (the module has 10 kΩ pull-ups); both are open at a detent,
 *          one detent = one full quadrature cycle (Alps EC11 data sheet
 *          phase diagram). SW closes to GND while pressed.
 *  a3144   Allegro A3144 unipolar Hall-effect switch (A3141-A3144 data
 *          sheet): open-collector output ON (low) above B_OP, OFF below
 *          B_RP (south pole on the branded face = positive field).
 *  vs1838b 38 kHz IR receiver module output (demodulated, active low,
 *          internal pull-up) fed by a virtual NEC remote (NEC IR protocol:
 *          9 ms AGC burst, 4.5 ms space, 32 bits address / ~address /
 *          command / ~command LSB first with 562.5 µs bursts, 562.5 µs /
 *          1687.5 µs spaces, a final 562.5 µs burst; repeat code 9 ms /
 *          2.25 ms / 562.5 µs every 108 ms while a key is held).
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { boolParam, numParam } from './sensors-i2c'

// =============================================================== HC-SR04

/** minimum trigger pulse (s) */
export const HCSR04_TRIG_MIN = 10e-6
/** trigger falling edge → ECHO rising: 8 × 25 µs burst + start-up (typical measured) */
export const HCSR04_ECHO_DELAY = 0.45e-3
/** ECHO high time without an echo (s) */
export const HCSR04_TIMEOUT = 38e-3
export const HCSR04_RANGE_CM: [number, number] = [2, 400]

/** Speed of sound in air (m/s) at `tempC`. */
export function speedOfSound(tempC: number): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15)
}

/** ECHO high time (s) for an obstacle at `cm`. */
export function hcsr04EchoTime(cm: number, tempC: number): number {
  if (!(cm <= HCSR04_RANGE_CM[1])) return HCSR04_TIMEOUT
  const d = Math.max(HCSR04_RANGE_CM[0], cm) / 100
  return (2 * d) / speedOfSound(tempC)
}

export class Hcsr04 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private trigRise = NaN
  private busy = false
  private handles: number[] = []
  private measurements = 0
  private short = 0
  private lastEcho = 0
  private distanceCm: number
  private tempC: number

  constructor(comp?: ComponentInstance) {
    this.distanceCm = numParam(comp?.params?.distance, 100)
    this.tempC = numParam(comp?.params?.temperature, 20)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('ECHO', 'low')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    for (const h of this.handles) this.ctx.cancel(h)
    this.handles = []
    this.busy = false
    this.trigRise = NaN
    this.ctx.drive('ECHO', 'low')
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'distance') this.distanceCm = numParam(value, this.distanceCm)
    else if (key === 'temperature') this.tempC = numParam(value, this.tempC)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (pin !== 'TRIG' || !this.powered || level === null) return
    const now = this.ctx.now()
    if (level === 1) {
      this.trigRise = now
      return
    }
    const width = now - this.trigRise
    this.trigRise = NaN
    if (!(width >= HCSR04_TRIG_MIN)) {
      if (width > 0) this.short++
      return
    }
    if (this.busy) return // a measurement is running: ignored
    this.busy = true
    const echo = hcsr04EchoTime(this.distanceCm, this.tempC)
    this.lastEcho = echo
    this.handles = [
      this.ctx.schedule(HCSR04_ECHO_DELAY, () => this.ctx.drive('ECHO', 'high')),
      this.ctx.schedule(HCSR04_ECHO_DELAY + echo, () => {
        this.ctx.drive('ECHO', 'low')
        this.busy = false
        this.measurements++
        this.handles = []
      }),
    ]
  }

  telemetry(): DeviceTelemetry {
    return {
      values: {
        distance: this.distanceCm,
        echoUs: this.lastEcho * 1e6,
        measurements: this.measurements,
        shortTriggers: this.short,
        busy: this.busy ? 1 : 0,
      },
    }
  }
}

// =============================================================== KY-040

/** detents per turn (EC11 20/20) */
export const KY040_DETENTS = 20

/** Contact states (A, B: 1 = closed to GND) through one clockwise detent cycle. */
const CW_PHASES: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
]

export class Ky040 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  /** detent the shaft is at (or leaving) */
  private current: number
  private target: number
  private pressed: boolean
  private rate: number
  private handle = 0
  /** quarter-steps completed in the detent being turned (0…3) */
  private phase = 0
  private dir = 0
  private edges = 0

  constructor(comp?: ComponentInstance) {
    const p = comp?.params ?? {}
    this.current = Math.round(numParam(p.position, 0))
    this.target = this.current
    this.pressed = boolParam(p.pressed, false)
    this.rate = Math.max(1, numParam(p.turnRate, 10))
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.applyContacts(0, 0)
    ctx.drive('SW', this.pressed ? 'low' : 'z')
  }

  powerChanged(): void {
    // mechanical contacts: nothing to do (re-applied by the host)
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'pressed') {
      this.pressed = boolParam(value, this.pressed)
      this.ctx.drive('SW', this.pressed ? 'low' : 'z')
    } else if (key === 'turnRate') {
      this.rate = Math.max(1, numParam(value, this.rate))
    } else if (key === 'position') {
      this.target = Math.round(numParam(value, this.target))
      if (!this.handle) this.step()
    }
  }

  private applyContacts(a: number, b: number): void {
    this.ctx.drive('CLK', a ? 'low' : 'z')
    this.ctx.drive('DT', b ? 'low' : 'z')
  }

  /** Advance one quarter of a detent toward the target position. */
  private step(): void {
    this.handle = 0
    if (this.phase === 0) {
      if (this.current === this.target) return
      this.dir = this.target > this.current ? 1 : -1
    }
    const [a, b] = CW_PHASES[this.phase]
    // counter-clockwise swaps the roles of A and B
    if (this.dir > 0) this.applyContacts(a, b)
    else this.applyContacts(b, a)
    this.edges++
    this.phase++
    if (this.phase === 4) {
      this.phase = 0
      this.current += this.dir
    }
    if (this.phase !== 0 || this.current !== this.target) {
      this.handle = this.ctx.schedule(1 / (4 * this.rate), () => this.step())
    }
  }

  telemetry(): DeviceTelemetry {
    const frac = this.phase / 4
    return {
      values: {
        position: this.current,
        target: this.target,
        angle: ((this.current + this.dir * frac) * 360) / KY040_DETENTS,
        pressed: this.pressed ? 1 : 0,
        edges: this.edges,
      },
    }
  }
}

// =============================================================== A3144

/** operate / release points (mT), inside the A3144 limits B_OP 7–35, B_RP 5–33 */
export const A3144_BOP = 15
export const A3144_BRP = 9.5

export class A3144 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private on = false
  private field: number

  constructor(comp?: ComponentInstance) {
    this.field = numParam(comp?.params?.field, 0)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('OUT', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    // power-on: ON only above the operate point
    this.on = on && this.field >= A3144_BOP
    this.apply()
  }

  setParam(key: string, value: ParamValue): void {
    if (key !== 'field') return
    this.field = numParam(value, this.field)
    if (!this.powered) return
    if (!this.on && this.field >= A3144_BOP) this.on = true
    else if (this.on && this.field < A3144_BRP) this.on = false
    this.apply()
  }

  private apply(): void {
    this.ctx.drive('OUT', this.on ? 'low' : 'z')
  }

  telemetry(): DeviceTelemetry {
    return { values: { field: this.field, on: this.on ? 1 : 0 } }
  }
}

// =============================================================== VS1838B

/** "Car MP3" 21-key remote (NEC, address 0x00): key → command */
export const NEC_KEYS: Record<string, number> = {
  'CH-': 0x45,
  CH: 0x46,
  'CH+': 0x47,
  PREV: 0x44,
  NEXT: 0x40,
  PLAY: 0x43,
  'VOL-': 0x07,
  'VOL+': 0x15,
  EQ: 0x09,
  '0': 0x16,
  '100+': 0x19,
  '200+': 0x0d,
  '1': 0x0c,
  '2': 0x18,
  '3': 0x5e,
  '4': 0x08,
  '5': 0x1c,
  '6': 0x5a,
  '7': 0x42,
  '8': 0x52,
  '9': 0x4a,
}

export const NEC_T = 562.5e-6
export const NEC_PERIOD = 108e-3

/** Mark / space durations (s) of a NEC frame, starting with a mark. */
export function necFrame(address: number, command: number): number[] {
  const out = [16 * NEC_T, 8 * NEC_T]
  const bytes = [address & 0xff, ~address & 0xff, command & 0xff, ~command & 0xff]
  for (const b of bytes) {
    for (let i = 0; i < 8; i++) out.push(NEC_T, (b >> i) & 1 ? 3 * NEC_T : NEC_T)
  }
  out.push(NEC_T)
  return out
}

/** NEC repeat code: 9 ms mark, 2.25 ms space, 562.5 µs mark. */
export function necRepeat(): number[] {
  return [16 * NEC_T, 4 * NEC_T, NEC_T]
}

export class Vs1838b implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private key = 'none'
  private hold = false
  private address: number
  private handles: number[] = []
  private sending = false
  private frameStart = 0
  private repeatHandle = 0
  private queued: string | null = null
  private frames = 0
  private repeats = 0

  constructor(comp?: ComponentInstance) {
    const p = comp?.params ?? {}
    this.address = Math.round(numParam(p.address, 0)) & 0xff
    this.hold = boolParam(p.hold, false)
    // a key already selected in the saved layout is not "pressed" at start
    this.key = typeof p.remoteButton === 'string' ? p.remoteButton : 'none'
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('OUT', 'pull-up')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.stopAll()
    this.ctx.drive('OUT', 'pull-up')
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'address') {
      this.address = Math.round(numParam(value, this.address)) & 0xff
      return
    }
    if (key === 'hold') {
      this.hold = boolParam(value, this.hold)
      if (!this.hold) this.cancelRepeat()
      else if (!this.sending && this.key !== 'none' && this.powered) this.scheduleRepeat()
      return
    }
    if (key !== 'remoteButton') return
    const k = String(value)
    if (k === this.key) return
    this.key = k
    this.cancelRepeat()
    if (k === 'none' || NEC_KEYS[k] === undefined || !this.powered) return
    if (this.sending) this.queued = k
    else this.sendFrame(k)
  }

  private stopAll(): void {
    for (const h of this.handles) this.ctx?.cancel(h)
    this.handles = []
    this.cancelRepeat()
    this.sending = false
    this.queued = null
  }

  private cancelRepeat(): void {
    if (this.repeatHandle) this.ctx.cancel(this.repeatHandle)
    this.repeatHandle = 0
  }

  private play(durations: number[], done: () => void): void {
    this.sending = true
    this.frameStart = this.ctx.now()
    let t = 0
    const hs: number[] = []
    durations.forEach((d, i) => {
      const mark = i % 2 === 0
      hs.push(this.ctx.schedule(t, () => this.ctx.drive('OUT', mark ? 'low' : 'pull-up')))
      t += d
    })
    hs.push(
      this.ctx.schedule(t, () => {
        this.ctx.drive('OUT', 'pull-up')
        this.handles = []
        this.sending = false
        done()
      }),
    )
    this.handles = hs
  }

  private sendFrame(k: string): void {
    this.play(necFrame(this.address, NEC_KEYS[k]), () => {
      this.frames++
      if (this.queued) {
        const q = this.queued
        this.queued = null
        // the next frame starts one message period after this one
        this.repeatHandle = this.ctx.schedule(Math.max(0, this.frameStart + NEC_PERIOD - this.ctx.now()), () => {
          this.repeatHandle = 0
          if (this.key === q) this.sendFrame(q)
        })
        return
      }
      if (this.hold) this.scheduleRepeat()
    })
  }

  private scheduleRepeat(): void {
    this.cancelRepeat()
    const wait = Math.max(0, this.frameStart + NEC_PERIOD - this.ctx.now())
    this.repeatHandle = this.ctx.schedule(wait, () => {
      this.repeatHandle = 0
      if (!this.hold || this.key === 'none' || !this.powered) return
      this.play(necRepeat(), () => {
        this.repeats++
        if (this.hold && this.key !== 'none') this.scheduleRepeat()
      })
    })
  }

  telemetry(): DeviceTelemetry {
    return { values: { frames: this.frames, repeats: this.repeats, sending: this.sending ? 1 : 0 } }
  }
}
