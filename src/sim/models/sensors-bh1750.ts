/**
 * ROHM BH1750FVI ambient light sensor (GY-302 module) behind the I²C target
 * port. Reference: BH1750FVI datasheet (ROHM 2011.11 rev. D).
 *
 *  - Address 0x23 with ADDR ≤ 0.3·VCC, 0x5C with ADDR ≥ 0.7·VCC.
 *  - Write = one instruction byte: 0x00 power down, 0x01 power on, 0x07
 *    reset (clears the data register; ignored while powered down),
 *    0x10 / 0x11 / 0x13 continuous H / H2 / L resolution, 0x20 / 0x21 /
 *    0x23 one-time H / H2 / L (power down after the measurement),
 *    01000_MT[7:5] and 011_MT[4:0] set the measurement-time register MTreg
 *    (31…254, default 69). Unknown opcodes are acknowledged and ignored.
 *  - Measurement time 120 ms (H, H2) / 16 ms (L) typical at MTreg = 69,
 *    proportional to MTreg; the data register changes at the end of each
 *    measurement and keeps its value otherwise (also while powered down).
 *  - Result: count = lx × 1.2 × MTreg/69 (H; × 2 in H2), saturating at
 *    0xFFFF; read MSB first (further bytes repeat the pair).
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { I2cTargetPort, numParam } from './sensors-i2c'
import type { I2cTarget } from './sensors-i2c'

export const BH1750_T_H = 0.12
export const BH1750_T_L = 0.016
export const BH1750_MT_DEFAULT = 69

type Res = 'H' | 'H2' | 'L'

export class Bh1750 implements DigitalDevice, I2cTarget {
  private ctx!: DigitalDeviceCtx
  private readonly port: I2cTargetPort
  private powered = false
  private on = false
  private mode: { res: Res; continuous: boolean } | null = null
  private mt = BH1750_MT_DEFAULT
  private data = 0
  private measHandle = 0
  private measurements = 0
  private lux: number

  constructor(comp?: ComponentInstance) {
    this.lux = numParam(comp?.params?.illuminance, 300)
    this.port = new I2cTargetPort(this)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.port.attach(ctx)
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.port.reset()
    this.cancel()
    // power-up state: power down, data register 0, MTreg default
    this.on = false
    this.mode = null
    this.mt = BH1750_MT_DEFAULT
    this.data = 0
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'SDA' || pin === 'SCL') this.port.onPinChange(pin, level)
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'illuminance') this.lux = Math.max(0, numParam(value, this.lux))
  }

  telemetry(): DeviceTelemetry {
    return {
      values: {
        powerOn: this.on ? 1 : 0,
        measuring: this.measHandle ? 1 : 0,
        count: this.data,
        mtreg: this.mt,
        measurements: this.measurements,
      },
    }
  }

  matches(addr7: number): boolean {
    return addr7 === (this.ctx.read('ADDR') === 1 ? 0x5c : 0x23)
  }

  write(_index: number, op: number): boolean {
    if (op === 0x00) {
      this.on = false
      this.mode = null
      this.cancel()
    } else if (op === 0x01) {
      this.on = true
    } else if (op === 0x07) {
      if (this.on) this.data = 0
    } else if ((op & 0xf8) === 0x40) {
      this.mt = (this.mt & 0x1f) | ((op & 0x07) << 5)
    } else if ((op & 0xe0) === 0x60) {
      this.mt = (this.mt & 0xe0) | (op & 0x1f)
    } else {
      const res: Res | null = (op & 0x0f) === 0 ? 'H' : (op & 0x0f) === 1 ? 'H2' : (op & 0x0f) === 3 ? 'L' : null
      const kind = op & 0xf0
      if (res && (kind === 0x10 || kind === 0x20)) {
        this.on = true
        this.mode = { res, continuous: kind === 0x10 }
        this.startMeasurement()
      }
    }
    return true
  }

  read(index: number): number {
    return index % 2 === 0 ? (this.data >> 8) & 0xff : this.data & 0xff
  }

  private mtClamped(): number {
    return Math.min(254, Math.max(31, this.mt))
  }

  private cancel(): void {
    if (this.measHandle && this.ctx) this.ctx.cancel(this.measHandle)
    this.measHandle = 0
  }

  private startMeasurement(): void {
    this.cancel()
    if (!this.mode) return
    const base = this.mode.res === 'L' ? BH1750_T_L : BH1750_T_H
    this.measHandle = this.ctx.schedule((base * this.mtClamped()) / BH1750_MT_DEFAULT, () => this.finish())
  }

  private finish(): void {
    this.measHandle = 0
    const m = this.mode
    if (!m) return
    this.measurements++
    let count = this.lux * 1.2 * (this.mtClamped() / BH1750_MT_DEFAULT) * (m.res === 'H2' ? 2 : 1)
    count = Math.floor(count)
    if (m.res === 'L') count = Math.floor(count / 4) * 4
    this.data = Math.min(0xffff, Math.max(0, count))
    if (m.continuous) this.startMeasurement()
    else {
      // one-time modes power down after the measurement
      this.on = false
      this.mode = null
    }
  }
}
