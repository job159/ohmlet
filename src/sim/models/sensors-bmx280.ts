/**
 * Bosch BMP280 / BME280 (GY-BMP280 / GY-BME280 modules) behind the I²C
 * target port. References: BMP280 datasheet BST-BMP280-DS001 rev 1.26,
 * BME280 datasheet BST-BME280-DS002 rev 1.6.
 *
 * The chip measures raw 20-bit (16-bit humidity) ADC values and leaves the
 * conversion to physical units to the host, using factory trimming
 * parameters stored in its NVM. This model therefore works BACKWARDS: for
 * the environment inputs (°C, hPa, %RH) it finds the raw ADC codes for
 * which the datasheet's own integer compensation (bmx280Compensate*, exact
 * ports of the datasheet C code incl. int32 wrap-around and the 64-bit
 * pressure path) returns the input — restricted to the codes the selected
 * oversampling can produce (16 bit at ×1 … 20 bit at ×16 or with the IIR
 * filter; the low bits are zero). Firmware running the Bosch formulas thus
 * recovers the input within the datasheet resolution, and wrong firmware
 * (unsigned trims, a missing t_fine, swapped bytes) gets wrong numbers, as
 * on hardware.
 *
 * Timing (datasheet §3.8.1 / §9.1): t_measure,typ = 1 + 2·T + (2·P + 0.5)
 * [+ (2·H + 0.5)] ms with the oversampling factors of the enabled
 * channels; forced mode runs one conversion and returns to sleep, normal
 * mode repeats t_measure + t_standby. The data registers are written at the
 * end of a conversion but never inside an I²C transaction (shadowing).
 * Power-on / soft reset: 2 ms start-up during which the part does not
 * acknowledge (t_startup) and status.im_update is set.
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { I2cTargetPort, numParam } from './sensors-i2c'
import type { I2cTarget } from './sensors-i2c'

export interface BmxTrim {
  T1: number
  T2: number
  T3: number
  P1: number
  P2: number
  P3: number
  P4: number
  P5: number
  P6: number
  P7: number
  P8: number
  P9: number
  H1: number
  H2: number
  H3: number
  H4: number
  H5: number
  H6: number
}

/** BMP280 datasheet §8.2 example trimming (a real part's NVM content). */
export const BMP280_TRIM: BmxTrim = {
  T1: 27504, T2: 26435, T3: -1000,
  P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000,
  H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, H6: 0,
}

/** Trimming read from a production BME280. */
export const BME280_TRIM: BmxTrim = {
  T1: 28159, T2: 26391, T3: 50,
  P1: 36998, P2: -10706, P3: 3024, P4: 7779, P5: -103, P6: -7, P7: 9900, P8: -10230, P9: 4285,
  H1: 75, H2: 352, H3: 0, H4: 337, H5: 0, H6: 30,
}

export const BMP280_CHIP_ID = 0x58
export const BME280_CHIP_ID = 0x60
/** power-on / soft-reset start-up time t_startup (s) */
export const BMX_STARTUP = 2e-3
/** t_sb codes (ms): BMP280 table 11 / BME280 table 27 (codes 6, 7 differ) */
const TSB_BMP = [0.5, 62.5, 125, 250, 500, 1000, 2000, 4000]
const TSB_BME = [0.5, 62.5, 125, 250, 500, 1000, 10, 20]
const OSR = [0, 1, 2, 4, 8, 16, 16, 16]
const FILTER = [1, 2, 4, 8, 16, 16, 16, 16]

// ----------------------------------------------------------- compensation

/** bmp280_compensate_T_int32 / BME280_compensate_T_int32: [T in 0.01 °C, t_fine]. */
export function bmxCompensateT(adcT: number, t: BmxTrim): [number, number] {
  const var1 = Math.imul((adcT >> 3) - (t.T1 << 1), t.T2) >> 11
  const d = (adcT >> 4) - t.T1
  const var2 = Math.imul(Math.imul(d, d) >> 12, t.T3) >> 14
  const tFine = (var1 + var2) | 0
  return [(Math.imul(tFine, 5) + 128) >> 8, tFine]
}

const I64 = (v: bigint) => BigInt.asIntN(64, v)

/** bmp280_compensate_P_int64: pressure in Pa as Q24.8 (unsigned 32-bit, as the datasheet returns it). */
export function bmxCompensateP(adcP: number, tFine: number, t: BmxTrim): number {
  return Number(BigInt.asUintN(32, compensateP64(adcP, tFine, t)))
}

/** The datasheet's 64-bit pressure path before its final unsigned cast. */
function compensateP64(adcP: number, tFine: number, t: BmxTrim): bigint {
  let var1 = I64(BigInt(tFine) - 128000n)
  let var2 = I64(var1 * var1 * BigInt(t.P6))
  var2 = I64(var2 + I64(I64(var1 * BigInt(t.P5)) << 17n))
  var2 = I64(var2 + I64(BigInt(t.P4) << 35n))
  var1 = I64(I64(I64(var1 * var1 * BigInt(t.P3)) >> 8n) + I64(I64(var1 * BigInt(t.P2)) << 12n))
  var1 = I64(I64(I64((1n << 47n) + var1) * BigInt(t.P1)) >> 33n)
  if (var1 === 0n) return 0n
  let p = I64(1048576n - BigInt(adcP))
  p = I64(I64(I64(I64(p << 31n) - var2) * 3125n) / var1)
  var1 = I64(I64(BigInt(t.P9) * (p >> 13n) * (p >> 13n)) >> 25n)
  var2 = I64(I64(BigInt(t.P8) * p) >> 19n)
  return I64(I64(I64(p + var1 + var2) >> 8n) + I64(BigInt(t.P7) << 4n))
}

/** bme280_compensate_H_int32: humidity in %RH as Q22.10. */
export function bmxCompensateH(adcH: number, tFine: number, t: BmxTrim): number {
  let v = (tFine - 76800) | 0
  const a = ((((adcH << 14) - (t.H4 << 20) - Math.imul(t.H5, v)) | 0) + 16384) >> 15
  const b =
    (Math.imul(
      (((Math.imul((Math.imul(v, t.H6) >> 10), ((Math.imul(v, t.H3) >> 11) + 32768) | 0) >> 10) + 2097152) | 0),
      t.H2,
    ) +
      8192) >>
    14
  v = Math.imul(a, b)
  v = (v - (Math.imul(Math.imul(v >> 15, v >> 15) >> 7, t.H1) >> 4)) | 0
  if (v < 0) v = 0
  if (v > 419430400) v = 419430400
  return v >>> 12
}

/**
 * The raw code on the `bits`-resolution grid (20-bit codes, low bits zero)
 * whose compensated value is closest to `target`. `f` must be monotonic
 * over the grid (increasing when `rising`).
 */
function invert(f: (adc: number) => number, target: number, bits: number, totalBits: number, rising: boolean): number {
  const step = 2 ** (totalBits - bits)
  const n = 2 ** bits
  let lo = 0
  let hi = n - 1
  const g = (k: number) => (rising ? f(k * step) : -f(k * step))
  const tg = rising ? target : -target
  // smallest k with g(k) ≥ tg
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (g(mid) >= tg) hi = mid
    else lo = mid + 1
  }
  let best = lo
  if (lo > 0 && Math.abs(g(lo - 1) - tg) <= Math.abs(g(lo) - tg)) best = lo - 1
  return best * step
}

/** Raw temperature code for `tempC` at `bits` resolution. */
export function bmxRawT(tempC: number, t: BmxTrim, bits = 20): number {
  return invert((adc) => bmxCompensateT(adc, t)[0], tempC * 100, bits, 20, true)
}

/** Raw pressure code for `pa` (Pa) at `bits` resolution, given t_fine. */
export function bmxRawP(pa: number, tFine: number, t: BmxTrim, bits = 20): number {
  // signed result: at the very top of the code range the formula goes below
  // 0 Pa (the unsigned cast would wrap) — keep the search monotonic there
  return invert((adc) => Number(compensateP64(adc, tFine, t)), pa * 256, bits, 20, false)
}

/** Raw humidity code for `rh` (%RH), given t_fine (always 16 bit). */
export function bmxRawH(rh: number, tFine: number, t: BmxTrim): number {
  return invert((adc) => bmxCompensateH(adc, tFine, t), rh * 1024, 16, 16, true)
}

// ----------------------------------------------------------------- model

const REG_ID = 0xd0
const REG_RESET = 0xe0
const REG_CTRL_HUM = 0xf2
const REG_STATUS = 0xf3
const REG_CTRL_MEAS = 0xf4
const REG_CONFIG = 0xf5
const REG_DATA = 0xf7

export class Bmx280 implements DigitalDevice, I2cTarget {
  private ctx!: DigitalDeviceCtx
  readonly regs = new Uint8Array(256)
  private readonly port: I2cTargetPort
  private readonly trim: BmxTrim
  private powered = false
  private readyAt = 0
  private ptr = 0
  private regPtr = 0
  /** ctrl_hum value latched by the last ctrl_meas write (BME280) */
  private osrsH = 0
  private convHandle = 0
  private measuring = false
  private filtT = NaN
  private filtP = NaN
  private pendingData: number[] | null = null
  private conversions = 0
  private readonly logged = new Set<string>()
  private tempC: number
  private pressureHpa: number
  private humidity: number

  constructor(
    readonly humidityChannel: boolean,
    comp?: ComponentInstance,
  ) {
    const p = comp?.params ?? {}
    this.tempC = numParam(p.temperature, 25)
    this.pressureHpa = numParam(p.pressure, 1013.25)
    this.humidity = numParam(p.humidity, 50)
    this.trim = humidityChannel ? BME280_TRIM : BMP280_TRIM
    this.port = new I2cTargetPort(this)
    this.loadNvm()
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.port.attach(ctx)
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.port.reset()
    this.cancelConversion()
    if (on) this.powerOnReset()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'CSB') {
      if (level === 0) this.logOnce('spi', `${this.name()}: CSB low selects SPI, which is not simulated — use I²C (CSB high)`)
      return
    }
    if (pin === 'SDA' || pin === 'SCL') this.port.onPinChange(pin, level)
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'temperature') this.tempC = numParam(value, this.tempC)
    else if (key === 'pressure') this.pressureHpa = numParam(value, this.pressureHpa)
    else if (key === 'humidity') this.humidity = numParam(value, this.humidity)
  }

  telemetry(): DeviceTelemetry {
    return {
      values: {
        mode: this.regs[REG_CTRL_MEAS] & 3,
        measuring: this.measuring ? 1 : 0,
        conversions: this.conversions,
        rawT: (this.regs[0xfa] << 12) | (this.regs[0xfb] << 4) | (this.regs[0xfc] >> 4),
        rawP: (this.regs[0xf7] << 12) | (this.regs[0xf8] << 4) | (this.regs[0xf9] >> 4),
        ...(this.humidityChannel ? { rawH: (this.regs[0xfd] << 8) | this.regs[0xfe] } : {}),
      },
    }
  }

  private name(): string {
    return this.humidityChannel ? 'BME280' : 'BMP280'
  }

  private logOnce(key: string, message: string): void {
    if (this.logged.has(key)) return
    this.logged.add(key)
    this.ctx.log(message)
  }

  // ------------------------------------------------------------ registers

  /** Trimming NVM image (little-endian words, datasheet Table 17 / 16). */
  private loadNvm(): void {
    const t = this.trim
    const w16 = (a: number, v: number) => {
      this.regs[a] = v & 0xff
      this.regs[a + 1] = (v >> 8) & 0xff
    }
    const words = [t.T1, t.T2, t.T3, t.P1, t.P2, t.P3, t.P4, t.P5, t.P6, t.P7, t.P8, t.P9]
    words.forEach((v, i) => w16(0x88 + i * 2, v))
    this.regs[REG_ID] = this.humidityChannel ? BME280_CHIP_ID : BMP280_CHIP_ID
    if (this.humidityChannel) {
      this.regs[0xa1] = t.H1 & 0xff
      w16(0xe1, t.H2)
      this.regs[0xe3] = t.H3 & 0xff
      this.regs[0xe4] = (t.H4 >> 4) & 0xff
      this.regs[0xe5] = ((t.H5 & 0x0f) << 4) | (t.H4 & 0x0f)
      this.regs[0xe6] = (t.H5 >> 4) & 0xff
      this.regs[0xe7] = t.H6 & 0xff
    }
  }

  private powerOnReset(): void {
    this.cancelConversion()
    this.regs[REG_CTRL_HUM] = 0
    this.regs[REG_STATUS] = 0x01 // im_update while the NVM is copied
    this.regs[REG_CTRL_MEAS] = 0
    this.regs[REG_CONFIG] = 0
    this.regs.set([0x80, 0x00, 0x00, 0x80, 0x00, 0x00], REG_DATA)
    if (this.humidityChannel) this.regs.set([0x80, 0x00], 0xfd)
    this.osrsH = 0
    this.filtT = NaN
    this.filtP = NaN
    this.pendingData = null
    const now = this.ctx ? this.ctx.now() : 0
    this.readyAt = now + BMX_STARTUP
    if (this.ctx) {
      this.ctx.schedule(BMX_STARTUP, () => {
        this.regs[REG_STATUS] &= ~0x01
      })
    }
  }

  matches(addr7: number): boolean {
    if (this.ctx.now() < this.readyAt) return false // t_startup: not yet communicating
    const sdo = this.ctx.read('SDO') === 1 ? 1 : 0
    return addr7 === (0x76 | sdo)
  }

  started(): void {
    this.regPtr = 0
  }

  stopped(): void {
    if (this.pendingData && !this.port.busy) this.commitData()
  }

  /** Writes are (register address, data) pairs — no auto-increment on writes (§5.2.1). */
  write(index: number, value: number): boolean {
    if (index % 2 === 0) {
      this.regPtr = value
      this.ptr = value
      return true
    }
    this.writeRegister(this.regPtr, value)
    return true
  }

  read(_index: number): number {
    const v = this.regs[this.ptr]
    this.ptr = (this.ptr + 1) & 0xff
    return v
  }

  private writeRegister(reg: number, value: number): void {
    switch (reg) {
      case REG_RESET:
        if (value === 0xb6) this.powerOnReset()
        return
      case REG_CTRL_HUM:
        if (this.humidityChannel) this.regs[reg] = value & 0x07
        return
      case REG_CTRL_MEAS: {
        this.regs[reg] = value
        // "changes to ctrl_hum only become effective after a write to ctrl_meas" (BME280 §5.4.3)
        this.osrsH = OSR[this.regs[REG_CTRL_HUM] & 7]
        const mode = value & 3
        if (mode === 0) this.cancelConversion()
        else if (!this.measuring) this.startConversion()
        return
      }
      case REG_CONFIG:
        if (value & 0x01) this.logOnce('spi3w', `${this.name()}: 3-wire SPI (spi3w_en) is not simulated`)
        this.regs[reg] = value & 0xfd
        return
      default:
        return // trimming, id, status and data registers are read-only
    }
  }

  // ----------------------------------------------------------- conversion

  private measureTimeMs(): number {
    const cm = this.regs[REG_CTRL_MEAS]
    const t = OSR[(cm >> 5) & 7]
    const p = OSR[(cm >> 2) & 7]
    const h = this.humidityChannel ? this.osrsH : 0
    return 1 + 2 * t + (p ? 2 * p + 0.5 : 0) + (h ? 2 * h + 0.5 : 0)
  }

  private cancelConversion(): void {
    if (this.convHandle && this.ctx) this.ctx.cancel(this.convHandle)
    this.convHandle = 0
    this.measuring = false
    if (this.ctx) this.regs[REG_STATUS] &= ~0x08
  }

  private startConversion(): void {
    this.measuring = true
    this.regs[REG_STATUS] |= 0x08
    this.convHandle = this.ctx.schedule(this.measureTimeMs() / 1000, () => this.endConversion())
  }

  private endConversion(): void {
    this.convHandle = 0
    this.conversions++
    const cm = this.regs[REG_CTRL_MEAS]
    const cfg = this.regs[REG_CONFIG]
    const osrsT = (cm >> 5) & 7
    const osrsP = (cm >> 2) & 7
    const coef = FILTER[(cfg >> 2) & 7]
    const t = this.trim
    const data = Array.from(this.regs.slice(REG_DATA, REG_DATA + (this.humidityChannel ? 8 : 6)))
    let tFine = 0
    if (osrsT) {
      const bits = coef > 1 ? 20 : 15 + osrsT
      let raw = bmxRawT(Math.min(85, Math.max(-40, this.tempC)), t, bits)
      if (coef > 1) {
        this.filtT = Number.isNaN(this.filtT) ? raw : Math.floor((this.filtT * (coef - 1) + raw) / coef)
        raw = this.filtT
      }
      tFine = bmxCompensateT(raw, t)[1]
      data[3] = (raw >> 12) & 0xff
      data[4] = (raw >> 4) & 0xff
      data[5] = (raw & 0x0f) << 4
    } else {
      data.splice(3, 3, 0x80, 0x00, 0x00)
      tFine = bmxCompensateT(0x80000, t)[1]
    }
    if (osrsP) {
      const bits = coef > 1 ? 20 : 15 + osrsP
      let raw = bmxRawP(Math.min(110000, Math.max(30000, this.pressureHpa * 100)), tFine, t, bits)
      if (coef > 1) {
        this.filtP = Number.isNaN(this.filtP) ? raw : Math.floor((this.filtP * (coef - 1) + raw) / coef)
        raw = this.filtP
      }
      data[0] = (raw >> 12) & 0xff
      data[1] = (raw >> 4) & 0xff
      data[2] = (raw & 0x0f) << 4
    } else {
      data.splice(0, 3, 0x80, 0x00, 0x00)
    }
    if (this.humidityChannel) {
      if (this.osrsH) {
        const raw = bmxRawH(Math.min(100, Math.max(0, this.humidity)), tFine, t)
        data[6] = (raw >> 8) & 0xff
        data[7] = raw & 0xff
      } else {
        data[6] = 0x80
        data[7] = 0x00
      }
    }
    this.pendingData = data
    if (!this.port.busy) this.commitData()
    this.measuring = false
    this.regs[REG_STATUS] &= ~0x08
    const mode = cm & 3
    if (mode === 3) {
      // normal mode: standby, then the next conversion
      const tsb = (this.humidityChannel ? TSB_BME : TSB_BMP)[(cfg >> 5) & 7]
      this.convHandle = this.ctx.schedule(tsb / 1000, () => {
        this.convHandle = 0
        if ((this.regs[REG_CTRL_MEAS] & 3) === 3) this.startConversion()
      })
    } else {
      // forced mode: back to sleep
      this.regs[REG_CTRL_MEAS] = cm & ~3
    }
  }

  private commitData(): void {
    if (!this.pendingData) return
    this.regs.set(this.pendingData, REG_DATA)
    this.pendingData = null
  }
}
