/**
 * Aosong DHT11 / DHT22 (AM2302) single-wire temperature + humidity sensors.
 * References: DHT11 Humidity & Temperature Sensor datasheet (Aosong /
 * D-Robotics v1.3), AM2302 product manual (Aosong).
 *
 * The protocol lives entirely on the DATA pin (open drain + 10 kΩ module
 * pull-up):
 *   host:   low ≥ 18 ms (DHT11) / ≥ 0.8 ms (DHT22 T_be min), release
 *   sensor: T_go 30 µs later: 80 µs low, 80 µs high (response), then 40
 *           bits MSB first — 50 µs low, then 26–28 µs high ('0') or 70 µs
 *           high ('1') — then 50 µs low and release.
 *   frame:  DHT11  [RH int, RH dec, T int, T dec, sum]
 *           DHT22  [RH×10 hi, lo, T×10 hi (bit 7 = negative), lo, sum]
 * Real-part behavior that firmware must cope with, modeled as such:
 *   - the frame carries the PREVIOUS measurement: the sensor measures after
 *     each transmission (AM2302 manual: "the host always reads the last
 *     measured value … read twice to get a real-time value");
 *   - starts closer than the minimum sampling interval (1 s / 2 s) after
 *     the previous accepted start, or during the power-up settling time,
 *     get no response at all.
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { numParam } from './sensors-i2c'

export type DhtVariant = 'dht11' | 'dht22'

interface DhtSpec {
  name: string
  /** minimum host start (low) time (s) */
  startMin: number
  /** minimum interval between reads, and the power-up settling time (s) */
  interval: number
  tMin: number
  tMax: number
  hMin: number
  hMax: number
}

export const DHT_SPECS: Record<DhtVariant, DhtSpec> = {
  dht11: { name: 'DHT11', startMin: 18e-3, interval: 1, tMin: 0, tMax: 50, hMin: 20, hMax: 90 },
  dht22: { name: 'DHT22', startMin: 0.8e-3, interval: 2, tMin: -40, tMax: 80, hMin: 0, hMax: 100 },
}

/** protocol timing (s), datasheet typical values */
export const DHT_T_GO = 30e-6
export const DHT_T_RESP = 80e-6
export const DHT_T_BIT_LOW = 50e-6
export const DHT_T_ZERO = 27e-6
export const DHT_T_ONE = 70e-6

/** The 5 frame bytes for a measurement (checksum included). */
export function dhtFrame(variant: DhtVariant, tempC: number, rh: number): number[] {
  const s = DHT_SPECS[variant]
  const t = Math.min(s.tMax, Math.max(s.tMin, tempC))
  const h = Math.min(s.hMax, Math.max(s.hMin, rh))
  let b: number[]
  if (variant === 'dht11') {
    b = [Math.round(h), 0, Math.round(t), 0]
  } else {
    const hh = Math.round(h * 10)
    const tt = Math.round(Math.abs(t) * 10)
    const neg = t < 0 && tt > 0 ? 0x80 : 0
    b = [(hh >> 8) & 0xff, hh & 0xff, ((tt >> 8) & 0x7f) | neg, tt & 0xff]
  }
  return [...b, (b[0] + b[1] + b[2] + b[3]) & 0xff]
}

export class DhtSensor implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private readonly spec: DhtSpec
  private powered = false
  private poweredAt = 0
  private lowSince = NaN
  private lastStart = -Infinity
  private responding = false
  private handles: number[] = []
  /** the measurement the next frame will carry */
  private measured: [number, number] = [25, 50]
  private reads = 0
  private ignored = 0
  private readonly logged = new Set<string>()
  private tempC: number
  private rh: number

  constructor(
    readonly variant: DhtVariant,
    comp?: ComponentInstance,
  ) {
    this.spec = DHT_SPECS[variant]
    this.tempC = numParam(comp?.params?.temperature, 25)
    this.rh = numParam(comp?.params?.humidity, 50)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('DATA', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.abort()
    this.lowSince = NaN
    if (on) {
      this.poweredAt = this.ctx.now()
      this.lastStart = -Infinity
      // the first measurement is taken while the sensor settles after power-up
      this.measured = [this.tempC, this.rh]
    }
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'temperature') this.tempC = numParam(value, this.tempC)
    else if (key === 'humidity') this.rh = numParam(value, this.rh)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (pin !== 'DATA' || !this.powered || this.responding || level === null) return
    const now = this.ctx.now()
    if (level === 0) {
      this.lowSince = now
      return
    }
    const low = now - this.lowSince
    this.lowSince = NaN
    if (!(low >= this.spec.startMin)) return
    if (now - this.poweredAt < this.spec.interval) {
      this.ignored++
      this.logOnce('settle', `${this.spec.name}: start signal ignored — the sensor needs ${this.spec.interval} s after power-up before the first read`)
      return
    }
    if (now - this.lastStart < this.spec.interval) {
      this.ignored++
      this.logOnce('rate', `${this.spec.name}: start signal ignored — reads must be at least ${this.spec.interval} s apart`)
      return
    }
    this.lastStart = now
    this.respond()
  }

  telemetry(): DeviceTelemetry {
    return {
      values: {
        temperature: this.measured[0],
        humidity: this.measured[1],
        reads: this.reads,
        ignored: this.ignored,
        responding: this.responding ? 1 : 0,
      },
    }
  }

  private logOnce(key: string, message: string): void {
    if (this.logged.has(key)) return
    this.logged.add(key)
    this.ctx.log(message)
  }

  private abort(): void {
    for (const h of this.handles) this.ctx?.cancel(h)
    this.handles = []
    this.responding = false
    this.ctx?.drive('DATA', 'z')
  }

  /** Schedule the whole answer as drive changes at their exact offsets. */
  private respond(): void {
    const bytes = dhtFrame(this.variant, this.measured[0], this.measured[1])
    this.responding = true
    const steps: [number, 'low' | 'z'][] = []
    let t = DHT_T_GO
    const low = (d: number) => {
      steps.push([t, 'low'])
      t += d
    }
    const high = (d: number) => {
      steps.push([t, 'z'])
      t += d
    }
    low(DHT_T_RESP)
    high(DHT_T_RESP)
    for (const b of bytes) {
      for (let i = 7; i >= 0; i--) {
        low(DHT_T_BIT_LOW)
        high((b >> i) & 1 ? DHT_T_ONE : DHT_T_ZERO)
      }
    }
    low(DHT_T_BIT_LOW)
    steps.push([t, 'z'])
    const last = steps.length - 1
    this.handles = steps.map(([at, d], i) =>
      this.ctx.schedule(at, () => {
        this.ctx.drive('DATA', d)
        if (i === last) this.finish()
      }),
    )
  }

  private finish(): void {
    this.handles = []
    this.responding = false
    this.reads++
    // the sensor measures now; the NEXT read returns this value
    this.measured = [this.tempC, this.rh]
  }
}
