/**
 * InvenSense MPU-6050 (GY-521 module) — logic-level model behind the I²C
 * target port. References: MPU-6000/MPU-6050 Product Specification
 * (PS-MPU-6000A-00 rev 3.4) and Register Map (RM-MPU-6000A-00 rev 4.2).
 *
 *  - Power-on: every register 0x00 except PWR_MGMT_1 = 0x40 (SLEEP) and
 *    WHO_AM_I = 0x68. While SLEEP is set nothing is sampled, so the output
 *    registers read 0 — the classic "all zeros" symptom of firmware that
 *    never wakes the chip.
 *  - Sample rate = gyroscope output rate / (1 + SMPLRT_DIV), the gyro
 *    output rate being 8 kHz with DLPF_CFG = 0 or 7 and 1 kHz otherwise
 *    (RM §4.2). CYCLE = 1 (with SLEEP = 0) wakes for single accelerometer
 *    samples at LP_WAKE_CTRL = 1.25 / 5 / 20 / 40 Hz (RM §4.29).
 *  - Each sample converts the environment inputs with the selected
 *    full-scale range: 16384 / 8192 / 4096 / 2048 LSB/g (AFS_SEL),
 *    131 / 65.5 / 32.8 / 16.4 LSB/(°/s) (FS_SEL), temperature
 *    TEMP_OUT = (T − 36.53) × 340 (RM §4.18); int16 big-endian, saturating.
 *  - The sensor registers are only written while the serial interface is
 *    idle (RM §4.17: "The data within the sensor registers is only updated
 *    when the serial interface is idle"), so a burst read sees one sample.
 *  - FIFO (RM §4.6, §4.30–4.31): the words selected in FIFO_EN are pushed
 *    in register order at the sample rate when USER_CTRL.FIFO_EN is set;
 *    1024 bytes, on overflow the oldest data are lost and FIFO_OFLOW_INT
 *    is raised; reading an empty FIFO returns the last byte read.
 *  - INT pin (RM §4.14–4.16): active high / low, push-pull / open drain,
 *    50 µs pulse or latched until INT_STATUS is read (or any read with
 *    INT_RD_CLEAR).
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { I2cTargetPort, numParam } from './sensors-i2c'
import type { I2cTarget } from './sensors-i2c'

export const MPU_WHO_AM_I = 0x68
export const MPU_FIFO_SIZE = 1024
/** INT pulse width when LATCH_INT_EN = 0 (RM §4.15) */
export const MPU_INT_PULSE = 50e-6

// register addresses (RM-MPU-6000A rev 4.2)
export const MPU_REG = {
  SELF_TEST_X: 0x0d,
  SMPLRT_DIV: 0x19,
  CONFIG: 0x1a,
  GYRO_CONFIG: 0x1b,
  ACCEL_CONFIG: 0x1c,
  FIFO_EN: 0x23,
  I2C_MST_CTRL: 0x24,
  INT_PIN_CFG: 0x37,
  INT_ENABLE: 0x38,
  INT_STATUS: 0x3a,
  ACCEL_XOUT_H: 0x3b,
  TEMP_OUT_H: 0x41,
  GYRO_XOUT_H: 0x43,
  EXT_SENS_DATA_00: 0x49,
  SIGNAL_PATH_RESET: 0x68,
  USER_CTRL: 0x6a,
  PWR_MGMT_1: 0x6b,
  PWR_MGMT_2: 0x6c,
  FIFO_COUNTH: 0x72,
  FIFO_COUNTL: 0x73,
  FIFO_R_W: 0x74,
  WHO_AM_I: 0x75,
} as const

const ACCEL_LSB = [16384, 8192, 4096, 2048]
const GYRO_LSB = [131, 65.5, 32.8, 16.4]
const LP_WAKE_HZ = [1.25, 5, 20, 40]

function int16(v: number): number {
  const r = Math.round(v)
  return r > 32767 ? 32767 : r < -32768 ? -32768 : r
}

export class Mpu6050 implements DigitalDevice, I2cTarget {
  private ctx!: DigitalDeviceCtx
  readonly regs = new Uint8Array(256)
  private readonly port: I2cTargetPort
  private powered = false
  private ptr = 0
  /** first write byte = register pointer */
  private writeIndex = 0
  private readonly fifo: number[] = []
  private fifoLast = 0
  private sampleHandle = 0
  private pulseHandle = 0
  private intAsserted = false
  /** latest sample not yet copied into the (shadowed) sensor registers */
  private pending: Uint8Array | null = null
  private samples = 0
  private readonly logged = new Set<string>()
  // environment
  private accel = [0, 0, 1]
  private gyro = [0, 0, 0]
  private tempC = 25

  constructor(comp?: ComponentInstance) {
    const p = comp?.params ?? {}
    this.accel = [numParam(p.accelX, 0), numParam(p.accelY, 0), numParam(p.accelZ, 1)]
    this.gyro = [numParam(p.gyroX, 0), numParam(p.gyroY, 0), numParam(p.gyroZ, 0)]
    this.tempC = numParam(p.temperature, 25)
    this.port = new I2cTargetPort(this)
    this.resetRegisters()
  }

  // ------------------------------------------------------------ device

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.port.attach(ctx)
    this.applyInt()
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.port.reset()
    this.cancelSampling()
    this.cancelPulse()
    if (on) {
      // power-on reset
      this.resetRegisters()
      this.intAsserted = false
      this.applyInt()
      this.reschedule()
    }
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'SDA' || pin === 'SCL') this.port.onPinChange(pin, level)
  }

  setParam(key: string, value: ParamValue): void {
    switch (key) {
      case 'accelX':
        this.accel[0] = numParam(value, this.accel[0])
        return
      case 'accelY':
        this.accel[1] = numParam(value, this.accel[1])
        return
      case 'accelZ':
        this.accel[2] = numParam(value, this.accel[2])
        return
      case 'gyroX':
        this.gyro[0] = numParam(value, this.gyro[0])
        return
      case 'gyroY':
        this.gyro[1] = numParam(value, this.gyro[1])
        return
      case 'gyroZ':
        this.gyro[2] = numParam(value, this.gyro[2])
        return
      case 'temperature':
        this.tempC = numParam(value, this.tempC)
        return
      default:
        return
    }
  }

  telemetry(): DeviceTelemetry {
    const s16 = (hi: number) => {
      const v = (this.regs[hi] << 8) | this.regs[hi + 1]
      return v >= 0x8000 ? v - 0x10000 : v
    }
    return {
      values: {
        awake: this.sampling() ? 1 : 0,
        sampleRate: this.sampleRateHz(),
        samples: this.samples,
        accelXRaw: s16(MPU_REG.ACCEL_XOUT_H),
        accelYRaw: s16(MPU_REG.ACCEL_XOUT_H + 2),
        accelZRaw: s16(MPU_REG.ACCEL_XOUT_H + 4),
        tempRaw: s16(MPU_REG.TEMP_OUT_H),
        gyroXRaw: s16(MPU_REG.GYRO_XOUT_H),
        gyroYRaw: s16(MPU_REG.GYRO_XOUT_H + 2),
        gyroZRaw: s16(MPU_REG.GYRO_XOUT_H + 4),
        fifoCount: this.fifo.length,
        int: this.intAsserted ? 1 : 0,
      },
    }
  }

  // ------------------------------------------------------------ I²C target

  matches(addr7: number): boolean {
    // AD0 selects bit 0 (module pull-down: open = 0x68)
    const ad0 = this.ctx.read('AD0') === 1 ? 1 : 0
    return addr7 === (0x68 | ad0)
  }

  started(): void {
    this.writeIndex = 0
  }

  stopped(): void {
    // the interface is idle again: a sample taken meanwhile reaches the registers now
    if (this.pending && !this.port.busy) this.commitSample()
  }

  write(index: number, value: number): boolean {
    if (index === 0) {
      this.ptr = value
      return true
    }
    this.writeRegister(this.ptr, value)
    this.ptr = (this.ptr + 1) & 0xff
    return true
  }

  read(_index: number): number {
    const reg = this.ptr
    let v: number
    if (reg === MPU_REG.FIFO_R_W) {
      v = this.fifo.length > 0 ? (this.fifoLast = this.fifo.shift()!) : this.fifoLast
    } else if (reg === MPU_REG.FIFO_COUNTH) {
      v = (this.fifo.length >> 8) & 0xff
    } else if (reg === MPU_REG.FIFO_COUNTL) {
      v = this.fifo.length & 0xff
    } else {
      v = this.regs[reg]
    }
    const rdClear = (this.regs[MPU_REG.INT_PIN_CFG] & 0x10) !== 0
    if (reg === MPU_REG.INT_STATUS || rdClear) this.clearStatus()
    // FIFO_R_W does not auto-increment (successive reads pop the FIFO)
    if (reg !== MPU_REG.FIFO_R_W) this.ptr = (this.ptr + 1) & 0xff
    return v
  }

  // ------------------------------------------------------------ registers

  private resetRegisters(): void {
    this.regs.fill(0)
    this.regs[MPU_REG.PWR_MGMT_1] = 0x40
    this.regs[MPU_REG.WHO_AM_I] = MPU_WHO_AM_I
    this.fifo.length = 0
    this.fifoLast = 0
    this.pending = null
  }

  private writeRegister(reg: number, value: number): void {
    const R = MPU_REG
    switch (reg) {
      case R.INT_STATUS:
      case R.FIFO_COUNTH:
      case R.FIFO_COUNTL:
      case R.WHO_AM_I:
        return // read-only
      case R.PWR_MGMT_1:
        if (value & 0x80) {
          // DEVICE_RESET: every register to its default (SLEEP set again); self-clearing
          this.resetRegisters()
          this.clearStatus()
          this.reschedule()
          return
        }
        this.regs[reg] = value & 0x7f
        this.reschedule()
        return
      case R.PWR_MGMT_2:
      case R.SMPLRT_DIV:
        this.regs[reg] = value
        this.reschedule()
        return
      case R.CONFIG:
        this.regs[reg] = value & 0x3f
        if (value & 0x38) this.logOnce('fsync', 'MPU-6050: FSYNC (EXT_SYNC_SET) is not simulated')
        this.reschedule()
        return
      case R.GYRO_CONFIG:
      case R.ACCEL_CONFIG:
        this.regs[reg] = value
        if (value & 0xe0) this.logOnce('selftest', 'MPU-6050: self-test is not simulated — outputs unchanged')
        return
      case R.FIFO_EN:
        this.regs[reg] = value
        if (value & 0x07) this.logOnce('extfifo', 'MPU-6050: external-sensor FIFO words are not simulated')
        return
      case R.INT_PIN_CFG:
        this.regs[reg] = value
        if (value & 0x02) this.logOnce('bypass', 'MPU-6050: the auxiliary I²C master / bypass mode is not simulated')
        if (value & 0x0c) this.logOnce('fsync', 'MPU-6050: FSYNC (EXT_SYNC_SET) is not simulated')
        // leaving latched mode releases a held interrupt (the status bits stay until read)
        if (!(value & 0x20) && this.intAsserted && !this.pulseHandle) this.intAsserted = false
        this.applyInt()
        return
      case R.INT_ENABLE:
        this.regs[reg] = value & 0x19
        return
      case R.SIGNAL_PATH_RESET:
        return // resets the analog / digital signal paths only (self-clearing)
      case R.USER_CTRL:
        if (value & 0x04) {
          this.fifo.length = 0 // FIFO_RESET (self-clearing)
          this.fifoLast = 0
        }
        if (value & 0x01) {
          // SIG_COND_RESET: signal paths reset AND the sensor registers cleared
          this.regs.fill(0, MPU_REG.ACCEL_XOUT_H, MPU_REG.GYRO_XOUT_H + 6)
          this.pending = null
        }
        if (value & 0x20) this.logOnce('bypass', 'MPU-6050: the auxiliary I²C master / bypass mode is not simulated')
        if (value & 0x10) this.logOnce('ifdis', 'MPU-6050: I2C_IF_DIS must be 0 on the MPU-6050 (SPI exists only on the MPU-6000)')
        this.regs[reg] = value & 0x60
        return
      case R.FIFO_R_W:
        this.logOnce('fifowrite', 'MPU-6050: writes to FIFO_R_W are ignored')
        return
      default:
        if (reg >= 0x6d && reg <= 0x70) {
          this.logOnce('dmp', 'MPU-6050: DMP (registers 0x6D–0x70) is not simulated — writes ignored')
          return
        }
        if (reg >= R.I2C_MST_CTRL && reg <= 0x36) this.logOnce('bypass', 'MPU-6050: the auxiliary I²C master / bypass mode is not simulated')
        if (reg >= R.INT_STATUS && reg < R.EXT_SENS_DATA_00 + 24) return // sensor / external data: read-only
        this.regs[reg] = value
        return
    }
  }

  private logOnce(key: string, message: string): void {
    if (this.logged.has(key)) return
    this.logged.add(key)
    this.ctx.log(message)
  }

  // ------------------------------------------------------------ sampling

  /** Sampling is running: powered, SLEEP clear, clock not stopped. */
  private sampling(): boolean {
    const p1 = this.regs[MPU_REG.PWR_MGMT_1]
    return this.powered && (p1 & 0x40) === 0 && (p1 & 0x07) !== 7
  }

  private cycleMode(): boolean {
    return (this.regs[MPU_REG.PWR_MGMT_1] & 0x20) !== 0
  }

  /** Current sample rate (Hz), 0 when not sampling. */
  sampleRateHz(): number {
    if (!this.sampling()) return 0
    if (this.cycleMode()) return LP_WAKE_HZ[(this.regs[MPU_REG.PWR_MGMT_2] >> 6) & 3]
    const dlpf = this.regs[MPU_REG.CONFIG] & 7
    const gyroRate = dlpf === 0 || dlpf === 7 ? 8000 : 1000
    return gyroRate / (1 + this.regs[MPU_REG.SMPLRT_DIV])
  }

  private cancelSampling(): void {
    if (this.sampleHandle && this.ctx) this.ctx.cancel(this.sampleHandle)
    this.sampleHandle = 0
  }

  /** Restart the sample clock after a rate / power-state change. */
  private reschedule(): void {
    this.cancelSampling()
    if (!this.ctx) return
    const hz = this.sampleRateHz()
    if (hz > 0) this.sampleHandle = this.ctx.schedule(1 / hz, () => this.sample())
  }

  private sample(): void {
    this.sampleHandle = 0
    const hz = this.sampleRateHz()
    if (hz <= 0) return
    this.sampleHandle = this.ctx.schedule(1 / hz, () => this.sample())
    this.samples++

    const R = MPU_REG
    const out = this.pending ?? this.regs.slice(R.ACCEL_XOUT_H, R.GYRO_XOUT_H + 6)
    const stby = this.cycleMode() ? 0x07 : this.regs[R.PWR_MGMT_2] & 0x3f
    const afs = (this.regs[R.ACCEL_CONFIG] >> 3) & 3
    const fs = (this.regs[R.GYRO_CONFIG] >> 3) & 3
    const put = (off: number, v: number) => {
      out[off] = (v >> 8) & 0xff
      out[off + 1] = v & 0xff
    }
    for (let i = 0; i < 3; i++) {
      if (!(stby & (0x20 >> i))) put(i * 2, int16(this.accel[i] * ACCEL_LSB[afs]))
      if (!(stby & (0x04 >> i))) put(8 + i * 2, int16(this.gyro[i] * GYRO_LSB[fs]))
    }
    if (!(this.regs[R.PWR_MGMT_1] & 0x08)) put(6, int16((this.tempC - 36.53) * 340))
    this.pending = out
    if (!this.port.busy) this.commitSample()

    // FIFO words in register order (accel, temp, gyro x/y/z)
    if (this.regs[R.USER_CTRL] & 0x40) {
      const en = this.regs[R.FIFO_EN]
      const words: number[] = []
      if (en & 0x08) words.push(0, 1, 2, 3, 4, 5)
      if (en & 0x80) words.push(6, 7)
      if (en & 0x40) words.push(8, 9)
      if (en & 0x20) words.push(10, 11)
      if (en & 0x10) words.push(12, 13)
      let overflow = false
      for (const k of words) {
        if (this.fifo.length >= MPU_FIFO_SIZE) {
          this.fifo.shift()
          overflow = true
        }
        this.fifo.push(out[k])
      }
      if (overflow && this.regs[R.INT_ENABLE] & 0x10) this.raise(0x10)
    }
    if (this.regs[R.INT_ENABLE] & 0x01) this.raise(0x01)
  }

  private commitSample(): void {
    if (!this.pending) return
    this.regs.set(this.pending, MPU_REG.ACCEL_XOUT_H)
    this.pending = null
  }

  // ------------------------------------------------------------ interrupt

  private raise(bits: number): void {
    this.regs[MPU_REG.INT_STATUS] |= bits
    this.intAsserted = true
    this.applyInt()
    if (!(this.regs[MPU_REG.INT_PIN_CFG] & 0x20)) {
      // 50 µs pulse; the status bit stays until read
      this.cancelPulse()
      this.pulseHandle = this.ctx.schedule(MPU_INT_PULSE, () => {
        this.pulseHandle = 0
        this.intAsserted = false
        this.applyInt()
      })
    }
  }

  private clearStatus(): void {
    this.regs[MPU_REG.INT_STATUS] = 0
    if (this.regs[MPU_REG.INT_PIN_CFG] & 0x20) {
      this.intAsserted = false
      this.applyInt()
    }
  }

  private cancelPulse(): void {
    if (this.pulseHandle && this.ctx) this.ctx.cancel(this.pulseHandle)
    this.pulseHandle = 0
  }

  private applyInt(): void {
    if (!this.ctx) return
    const cfg = this.regs[MPU_REG.INT_PIN_CFG]
    const activeLow = (cfg & 0x80) !== 0
    const openDrain = (cfg & 0x40) !== 0
    const level = this.intAsserted !== activeLow ? 1 : 0
    this.ctx.drive('INT', level === 0 ? 'low' : openDrain ? 'z' : 'high')
  }
}
