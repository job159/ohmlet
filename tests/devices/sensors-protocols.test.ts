/**
 * Sensor protocol models (src/sim/models/sensors-*.ts) in isolation, on a
 * small logic-level rig: named nets with optional pull-ups, device drives
 * (strong / weak / released), an external "master" driver per net and a
 * virtual-time event queue for the devices' own timers. Inputs are
 * delivered on every resolved level change — including changes the
 * device's own drive causes — exactly like DigitalDeviceHost.
 *
 * Every protocol is exercised as a host would drive it on the wires (bit-
 * banged I²C at 100 kHz, 1-Wire slots, DHT start pulses, trigger pulses),
 * and every claim of the catalog support text is checked against the
 * datasheet numbers.
 */
import { describe, expect, it } from 'vitest'
import type { DigitalDevice, DigitalDeviceCtx, DigitalDrive, LogicLevel } from '../../src/sim/digital/api'
import { Mpu6050, MPU_REG } from '../../src/sim/models/sensors-mpu6050'
import {
  BME280_TRIM,
  BMP280_TRIM,
  Bmx280,
  bmxCompensateH,
  bmxCompensateP,
  bmxCompensateT,
  bmxRawH,
  bmxRawP,
  bmxRawT,
} from '../../src/sim/models/sensors-bmx280'
import type { BmxTrim } from '../../src/sim/models/sensors-bmx280'
import { Bh1750 } from '../../src/sim/models/sensors-bh1750'
import { DhtSensor, dhtFrame } from '../../src/sim/models/sensors-dht'
import { crc8, Ds18b20, ds18b20Raw, ds18b20Rom, eraseDs18b20 } from '../../src/sim/models/sensors-ds18b20'
import {
  A3144,
  HCSR04_ECHO_DELAY,
  HCSR04_TIMEOUT,
  Hcsr04,
  hcsr04EchoTime,
  Ky040,
  NEC_KEYS,
  NEC_T,
  Vs1838b,
  speedOfSound,
} from '../../src/sim/models/sensors-misc'
import type { ComponentInstance } from '../../src/model/types'

// ===================================================================== rig

interface DevSlot {
  device: DigitalDevice
  pins: Record<string, string>
  inputs: string[]
  drives: Map<string, DigitalDrive>
  delivered: Map<string, LogicLevel>
  logs: string[]
  issues: string[]
  supply: number
}

class Rig {
  t = 0
  private seq = 0
  private ev: { at: number; seq: number; id: number; fn: () => void }[] = []
  private nextId = 1
  private nets = new Map<string, { ext: 0 | 1 | null; pullUp: boolean }>()
  readonly devs: DevSlot[] = []
  readonly history = new Map<string, { t: number; level: LogicLevel }[]>()

  net(name: string, pullUp = false): void {
    if (!this.nets.has(name)) this.nets.set(name, { ext: null, pullUp })
    else this.nets.get(name)!.pullUp = pullUp
  }

  add(device: DigitalDevice, pins: Record<string, string>, inputs: string[], opts: { supply?: number; id?: string } = {}): DevSlot {
    for (const n of Object.values(pins)) this.net(n, this.nets.get(n)?.pullUp ?? false)
    const slot: DevSlot = { device, pins, inputs, drives: new Map(), delivered: new Map(), logs: [], issues: [], supply: opts.supply ?? 3.3 }
    this.devs.push(slot)
    const ctx: DigitalDeviceCtx = {
      componentId: opts.id ?? 'U' + this.devs.length,
      now: () => this.t,
      read: (pin) => (pins[pin] ? this.level(pins[pin]) : null),
      voltage: (pin) => {
        const l = pins[pin] ? this.level(pins[pin]) : null
        return l === null ? NaN : l * slot.supply
      },
      drive: (pin, d) => {
        slot.drives.set(pin, d)
        this.notify()
      },
      schedule: (delay, fn) => this.schedule(this.t + delay, fn),
      cancel: (h) => {
        this.ev = this.ev.filter((e) => e.id !== h)
      },
      supply: () => slot.supply,
      issue: (_level, msg) => slot.issues.push(msg),
      log: (msg) => slot.logs.push(msg),
    }
    device.init(ctx)
    device.powerChanged?.(true)
    this.notify()
    return slot
  }

  level(net: string): LogicLevel {
    const n = this.nets.get(net)
    if (!n) return null
    let strongLow = false
    let strongHigh = false
    let weak: LogicLevel = null
    for (const d of this.devs) {
      for (const [pin, nn] of Object.entries(d.pins)) {
        if (nn !== net) continue
        const dr = d.drives.get(pin) ?? 'z'
        if (dr === 'low') strongLow = true
        else if (dr === 'high') strongHigh = true
        else if (dr === 'pull-up') weak = 1
        else if (dr === 'pull-down') weak = 0
      }
    }
    if (n.ext === 0) strongLow = true
    if (n.ext === 1) strongHigh = true
    if (strongLow && strongHigh) return null
    if (strongLow) return 0
    if (strongHigh) return 1
    if (n.pullUp) return 1
    return weak
  }

  set(net: string, v: 0 | 1 | null): void {
    const n = this.nets.get(net)
    if (!n) throw new Error(`no net ${net}`)
    n.ext = v
    this.notify()
  }

  private notify(): void {
    for (const [name] of this.nets) {
      const h = this.history.get(name) ?? []
      const l = this.level(name)
      if (!h.length || h[h.length - 1].level !== l) {
        h.push({ t: this.t, level: l })
        this.history.set(name, h)
      }
    }
    for (const d of this.devs) {
      for (const pin of d.inputs) {
        const l = this.level(d.pins[pin])
        if (d.delivered.has(pin) && d.delivered.get(pin) === l) continue
        d.delivered.set(pin, l)
        d.device.onPinChange?.(pin, l)
      }
    }
  }

  private schedule(at: number, fn: () => void): number {
    const id = this.nextId++
    this.ev.push({ at, seq: this.seq++, id, fn })
    return id
  }

  run(dt: number): void {
    const end = this.t + dt
    for (;;) {
      this.ev.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const e = this.ev[0]
      if (!e || e.at > end) break
      this.ev.shift()
      this.t = Math.max(this.t, e.at)
      e.fn()
    }
    this.t = end
  }

  /** level changes of a net inside [t0, t1] */
  edges(net: string, t0 = 0, t1 = Infinity): { t: number; level: LogicLevel }[] {
    return (this.history.get(net) ?? []).filter((h) => h.t >= t0 && h.t <= t1)
  }
}

/** bit-banged I²C master (open drain), 100 kHz */
class I2cMaster {
  readonly h = 5e-6
  constructor(
    private rig: Rig,
    private sclNet = 'SCL',
    private sdaNet = 'SDA',
  ) {}
  private scl(v: 0 | 1) {
    this.rig.set(this.sclNet, v ? null : 0)
  }
  private sda(v: 0 | 1) {
    this.rig.set(this.sdaNet, v ? null : 0)
  }
  start(): void {
    this.sda(1)
    this.scl(1)
    this.rig.run(this.h)
    this.sda(0)
    this.rig.run(this.h)
    this.scl(0)
  }
  stop(): void {
    this.sda(0)
    this.rig.run(this.h / 2)
    this.scl(1)
    this.rig.run(this.h)
    this.sda(1)
    this.rig.run(this.h)
  }
  private clock(): LogicLevel {
    this.rig.run(this.h / 2)
    this.scl(1)
    this.rig.run(this.h / 2)
    const v = this.rig.level(this.sdaNet)
    this.rig.run(this.h / 2)
    this.scl(0)
    this.rig.run(this.h / 2)
    return v
  }
  write(b: number): boolean {
    for (let i = 7; i >= 0; i--) {
      this.sda(((b >> i) & 1) as 0 | 1)
      this.clock()
    }
    this.sda(1)
    return this.clock() === 0
  }
  read(ack: boolean): number {
    this.sda(1)
    let v = 0
    for (let i = 0; i < 8; i++) v = (v << 1) | (this.clock() === 1 ? 1 : 0)
    this.sda(ack ? 0 : 1)
    this.clock()
    this.sda(1)
    return v
  }
  /** write bytes; false when the address or a byte is NACKed */
  tx(dev: number, bytes: number[]): boolean {
    this.start()
    if (!this.write(dev << 1)) {
      this.stop()
      return false
    }
    let ok = true
    for (const b of bytes) ok = this.write(b) && ok
    this.stop()
    return ok
  }
  /** register read: write reg, repeated START, read n */
  readRegs(dev: number, reg: number, n: number): number[] | null {
    this.start()
    if (!this.write(dev << 1)) {
      this.stop()
      return null
    }
    this.write(reg)
    this.start()
    if (!this.write((dev << 1) | 1)) {
      this.stop()
      return null
    }
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(this.read(i < n - 1))
    this.stop()
    return out
  }
  /** plain read of n bytes */
  rx(dev: number, n: number): number[] | null {
    this.start()
    if (!this.write((dev << 1) | 1)) {
      this.stop()
      return null
    }
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(this.read(i < n - 1))
    this.stop()
    return out
  }
  ping(dev: number): boolean {
    this.start()
    const ack = this.write(dev << 1)
    this.stop()
    return ack
  }
}

const comp = (type: string, params: Record<string, number | string | boolean> = {}, id = 'S1'): ComponentInstance => ({ id, type, params })
const s16 = (hi: number, lo: number) => {
  const v = (hi << 8) | lo
  return v >= 0x8000 ? v - 0x10000 : v
}

// ================================================================= MPU-6050

function mpuRig(params: Record<string, number> = {}, ad0Net = 'AD0') {
  const rig = new Rig()
  rig.net('SCL', true)
  rig.net('SDA', true)
  rig.net(ad0Net)
  const dev = new Mpu6050(comp('mpu6050_gy521', params))
  const slot = rig.add(dev, { SCL: 'SCL', SDA: 'SDA', AD0: ad0Net, INT: 'INT' }, ['SCL', 'SDA', 'AD0'])
  return { rig, dev, slot, m: new I2cMaster(rig) }
}

describe('MPU-6050 (GY-521)', () => {
  it('answers at 0x68 (AD0 low) / 0x69 (AD0 high); WHO_AM_I = 0x68; powers up asleep with zero outputs', () => {
    const { rig, m } = mpuRig()
    rig.set('AD0', 0)
    expect(m.ping(0x68)).toBe(true)
    expect(m.ping(0x69)).toBe(false)
    expect(m.readRegs(0x68, MPU_REG.WHO_AM_I, 1)).toEqual([0x68])
    expect(m.readRegs(0x68, MPU_REG.PWR_MGMT_1, 1)).toEqual([0x40])
    rig.run(20e-3)
    // SLEEP set: nothing was ever sampled
    expect(m.readRegs(0x68, MPU_REG.ACCEL_XOUT_H, 14)).toEqual(new Array(14).fill(0))
    rig.set('AD0', 1)
    expect(m.ping(0x69)).toBe(true)
    expect(m.ping(0x68)).toBe(false)
    expect(m.readRegs(0x69, MPU_REG.WHO_AM_I, 1)).toEqual([0x68])
  })

  it('after wake-up a 14-byte burst returns accel / temp / gyro with the ±2 g / ±250 °/s scale factors', () => {
    const { rig, m } = mpuRig({ accelX: 0.5, accelY: -0.25, accelZ: 1, gyroX: 10, gyroY: -100, gyroZ: 0.5, temperature: 25 })
    rig.set('AD0', 0)
    expect(m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])).toBe(true)
    rig.run(2e-3)
    const b = m.readRegs(0x68, MPU_REG.ACCEL_XOUT_H, 14)!
    const w = Array.from({ length: 7 }, (_, i) => s16(b[2 * i], b[2 * i + 1]))
    expect(w).toEqual([8192, -4096, 16384, Math.round((25 - 36.53) * 340), 1310, -13100, Math.round(0.5 * 131)])
    // datasheet temperature formula recovers the input
    expect(w[3] / 340 + 36.53).toBeCloseTo(25, 2)
  })

  it('full-scale ranges change the scale factors; outputs saturate at ±32767', () => {
    const { rig, m, dev } = mpuRig({ accelX: 3, gyroZ: 2500 })
    rig.set('AD0', 0)
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])
    rig.run(2e-3)
    let b = m.readRegs(0x68, MPU_REG.ACCEL_XOUT_H, 14)!
    expect(s16(b[0], b[1])).toBe(32767) // 3 g at ±2 g
    expect(s16(b[12], b[13])).toBe(32767)
    m.tx(0x68, [MPU_REG.ACCEL_CONFIG, 0x10]) // ±8 g
    m.tx(0x68, [MPU_REG.GYRO_CONFIG, 0x18]) // ±2000 °/s
    dev.setParam('gyroZ', -1000)
    rig.run(2e-3)
    b = m.readRegs(0x68, MPU_REG.ACCEL_XOUT_H, 14)!
    expect(s16(b[0], b[1])).toBe(3 * 4096)
    expect(s16(b[12], b[13])).toBe(Math.round(-1000 * 16.4))
  })

  it('sample rate = gyro rate / (1 + SMPLRT_DIV): data-ready INT pulses of 50 µs at 100 Hz with DLPF_CFG = 3, SMPLRT_DIV = 9', () => {
    const { rig, m } = mpuRig()
    rig.set('AD0', 0)
    m.tx(0x68, [MPU_REG.CONFIG, 0x03, MPU_REG.SMPLRT_DIV, 9])
    expect(m.tx(0x68, [MPU_REG.SMPLRT_DIV, 9])).toBe(true)
    m.tx(0x68, [MPU_REG.CONFIG, 3])
    m.tx(0x68, [MPU_REG.INT_ENABLE, 0x01])
    const t0 = rig.t
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])
    rig.run(0.1005)
    const rises = rig.edges('INT', t0).filter((e) => e.level === 1)
    const falls = rig.edges('INT', t0).filter((e) => e.level === 0)
    expect(rises.length).toBe(10)
    for (let i = 1; i < rises.length; i++) expect(rises[i].t - rises[i - 1].t).toBeCloseTo(0.01, 9)
    expect(falls[0].t - rises[0].t).toBeCloseTo(50e-6, 9)
    // INT_STATUS.DATA_RDY set, cleared by reading it
    expect(m.readRegs(0x68, MPU_REG.INT_STATUS, 1)).toEqual([0x01])
    expect(m.readRegs(0x68, MPU_REG.INT_STATUS, 1)).toEqual([0x00])
  })

  it('latched, active-low, open-drain INT is held until INT_STATUS is read', () => {
    const { rig, m } = mpuRig()
    rig.net('INT', true) // external pull-up for the open drain
    rig.set('AD0', 0)
    m.tx(0x68, [MPU_REG.INT_PIN_CFG, 0xe0]) // active low, open drain, latched
    m.tx(0x68, [MPU_REG.INT_ENABLE, 0x01])
    m.tx(0x68, [MPU_REG.CONFIG, 0x01])
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])
    expect(rig.level('INT')).toBe(1)
    rig.run(1.5e-3)
    expect(rig.level('INT')).toBe(0)
    rig.run(5e-3)
    expect(rig.level('INT')).toBe(0)
    m.readRegs(0x68, MPU_REG.INT_STATUS, 1)
    expect(rig.level('INT')).toBe(1)
  })

  it('sensor registers do not change in the middle of a burst read (one sampling instant)', () => {
    const { rig, m, dev } = mpuRig({ accelX: 0.25 })
    rig.set('AD0', 0)
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])
    rig.run(2e-3)
    m.start()
    m.write(0x68 << 1)
    m.write(MPU_REG.ACCEL_XOUT_H)
    m.start()
    m.write((0x68 << 1) | 1)
    const hi = m.read(true)
    dev.setParam('accelX', -0.5)
    rig.run(5e-3) // 40 samples at 8 kHz while the bus is busy
    const lo = m.read(false)
    m.stop()
    expect(s16(hi, lo)).toBe(4096)
    rig.run(1e-3)
    const b = m.readRegs(0x68, MPU_REG.ACCEL_XOUT_H, 2)!
    expect(s16(b[0], b[1])).toBe(-8192)
  })

  it('FIFO: accelerometer words pushed per sample, FIFO_COUNT, FIFO_R_W pops; DEVICE_RESET sends it back to sleep', () => {
    const { rig, m } = mpuRig({ accelX: 1, accelY: 0, accelZ: -1 })
    rig.set('AD0', 0)
    m.tx(0x68, [MPU_REG.CONFIG, 0x01]) // 1 kHz
    m.tx(0x68, [MPU_REG.SMPLRT_DIV, 9]) // 100 Hz
    m.tx(0x68, [MPU_REG.FIFO_EN, 0x08])
    m.tx(0x68, [MPU_REG.USER_CTRL, 0x40])
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x00])
    rig.run(0.0505)
    const cnt = m.readRegs(0x68, MPU_REG.FIFO_COUNTH, 2)!
    expect((cnt[0] << 8) | cnt[1]).toBe(5 * 6)
    const words = m.readRegs(0x68, MPU_REG.FIFO_R_W, 6)!
    expect([s16(words[0], words[1]), s16(words[2], words[3]), s16(words[4], words[5])]).toEqual([16384, 0, -16384])
    const cnt2 = m.readRegs(0x68, MPU_REG.FIFO_COUNTH, 2)!
    expect((cnt2[0] << 8) | cnt2[1]).toBe(4 * 6)
    m.tx(0x68, [MPU_REG.PWR_MGMT_1, 0x80])
    expect(m.readRegs(0x68, MPU_REG.PWR_MGMT_1, 1)).toEqual([0x40])
    expect(m.readRegs(0x68, MPU_REG.FIFO_COUNTH, 2)).toEqual([0, 0])
  })

  it('logs the unmodeled DMP / auxiliary master instead of pretending', () => {
    const { rig, m, slot } = mpuRig()
    rig.set('AD0', 0)
    m.tx(0x68, [0x6d, 0x07])
    m.tx(0x68, [MPU_REG.INT_PIN_CFG, 0x02])
    expect(slot.logs.some((l) => /DMP/.test(l))).toBe(true)
    expect(slot.logs.some((l) => /bypass/.test(l))).toBe(true)
  })
})

// ================================================================ BMP280 / BME280

function compT(raw: number, t: BmxTrim) {
  return bmxCompensateT(raw, t)
}

describe('Bosch compensation inversion', () => {
  for (const [name, trim, hum] of [
    ['BMP280', BMP280_TRIM, false],
    ['BME280', BME280_TRIM, true],
  ] as const) {
    it(`${name}: the datasheet integer formulas recover T (0.01 °C), P and H at 20-bit over the whole range`, () => {
      for (let tc = -40; tc <= 85; tc += 6.37) {
        const rawT = bmxRawT(tc, trim)
        expect(rawT).toBeGreaterThan(0)
        expect(rawT).toBeLessThan(1 << 20)
        const [t100, tFine] = compT(rawT, trim)
        expect(Math.abs(t100 / 100 - tc)).toBeLessThanOrEqual(0.0051)
        for (let pa = 30000; pa <= 110000; pa += 9137) {
          const rawP = bmxRawP(pa, tFine, trim)
          const p = bmxCompensateP(rawP, tFine, trim) / 256
          expect(Math.abs(p - pa), `${tc} °C ${pa} Pa`).toBeLessThan(0.2)
        }
        if (hum) {
          for (let rh = 0; rh <= 100; rh += 7.3) {
            const rawH = bmxRawH(rh, tFine, trim)
            const h = bmxCompensateH(rawH, tFine, trim) / 1024
            expect(Math.abs(h - rh), `${tc} °C ${rh} %`).toBeLessThan(0.01)
          }
        }
      }
    })
  }

  it('datasheet worked example (BMP280 §8.2): adc_T 519888 → 25.08 °C, adc_P 415148 → 100653.27 Pa', () => {
    const [t100, tFine] = bmxCompensateT(519888, BMP280_TRIM)
    expect(t100).toBe(2508)
    expect(tFine).toBe(128422)
    expect(bmxCompensateP(415148, tFine, BMP280_TRIM) / 256).toBeCloseTo(100653.27, 0)
  })

  it('16-bit resolution (×1 oversampling): codes on the 16-bit grid, still within 0.01 °C', () => {
    for (let tc = -10; tc <= 40; tc += 1.23) {
      const raw = bmxRawT(tc, BME280_TRIM, 16)
      expect(raw & 0xf).toBe(0)
      expect(Math.abs(bmxCompensateT(raw, BME280_TRIM)[0] / 100 - tc)).toBeLessThan(0.01)
    }
  })
})

function bmxRig(hum: boolean, params: Record<string, number> = {}) {
  const rig = new Rig()
  rig.net('SCL', true)
  rig.net('SDA', true)
  rig.net('SDO')
  rig.net('CSB', true)
  const dev = new Bmx280(hum, comp(hum ? 'bme280' : 'bmp280', params))
  const slot = rig.add(dev, { SCL: 'SCL', SDA: 'SDA', SDO: 'SDO', CSB: 'CSB' }, ['SCL', 'SDA', 'SDO', 'CSB'])
  rig.set('SDO', 0)
  return { rig, dev, slot, m: new I2cMaster(rig) }
}

/** Read the trimming NVM like a driver does (little-endian words). */
function readTrim(m: I2cMaster, addr: number, hum: boolean): BmxTrim {
  const c = m.readRegs(addr, 0x88, 24)!
  const u = (i: number) => c[i] | (c[i + 1] << 8)
  const s = (i: number) => s16(c[i + 1], c[i])
  const t: BmxTrim = {
    T1: u(0), T2: s(2), T3: s(4), P1: u(6), P2: s(8), P3: s(10), P4: s(12), P5: s(14), P6: s(16), P7: s(18), P8: s(20), P9: s(22),
    H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, H6: 0,
  }
  if (hum) {
    t.H1 = m.readRegs(addr, 0xa1, 1)![0]
    const h = m.readRegs(addr, 0xe1, 7)!
    t.H2 = s16(h[1], h[0])
    t.H3 = h[2]
    t.H4 = ((h[3] << 24) >> 20) | (h[4] & 0x0f)
    t.H5 = ((h[5] << 24) >> 20) | (h[4] >> 4)
    t.H6 = (h[6] << 24) >> 24
  }
  return t
}

describe('BMP280 / BME280 modules', () => {
  it('chip id, 0x76 / 0x77 from SDO, no acknowledge during the 2 ms start-up', () => {
    const { rig, m } = bmxRig(true)
    expect(m.ping(0x76)).toBe(false) // t_startup
    rig.run(2e-3)
    expect(m.ping(0x76)).toBe(true)
    expect(m.ping(0x77)).toBe(false)
    expect(m.readRegs(0x76, 0xd0, 1)).toEqual([0x60])
    rig.set('SDO', 1)
    expect(m.ping(0x77)).toBe(true)
    const p = bmxRig(false)
    p.rig.run(3e-3)
    expect(p.m.readRegs(0x76, 0xd0, 1)).toEqual([0x58])
  })

  it('forced mode: measuring for t_meas (typ formula), then the data registers + sleep; the firmware path recovers all three inputs', () => {
    const { rig, m } = bmxRig(true, { temperature: 23.47, pressure: 1002.31, humidity: 61.8 })
    rig.run(3e-3)
    // reset values: skipped / never-measured channels
    expect(m.readRegs(0x76, 0xf7, 8)).toEqual([0x80, 0, 0, 0x80, 0, 0, 0x80, 0])
    const trim = readTrim(m, 0x76, true)
    expect(trim).toEqual(BME280_TRIM)
    m.tx(0x76, [0xf2, 0x05]) // osrs_h ×16
    const t0 = rig.t
    m.tx(0x76, [0xf4, (5 << 5) | (5 << 2) | 1]) // osrs_t ×16, osrs_p ×16, forced
    // t_meas = 1 + 2·16 + (2·16 + 0.5) + (2·16 + 0.5) = 98 ms
    rig.run(50e-3)
    expect(m.readRegs(0x76, 0xf3, 1)![0] & 0x08).toBe(0x08)
    rig.run(0.0985 - (rig.t - t0))
    expect(m.readRegs(0x76, 0xf3, 1)![0] & 0x08).toBe(0)
    expect(m.readRegs(0x76, 0xf4, 1)![0] & 3).toBe(0) // back to sleep
    const d = m.readRegs(0x76, 0xf7, 8)!
    const adcP = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
    const adcT = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
    const adcH = (d[6] << 8) | d[7]
    const [t100, tFine] = bmxCompensateT(adcT, trim)
    expect(Math.abs(t100 / 100 - 23.47)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(bmxCompensateP(adcP, tFine, trim) / 256 - 100231)).toBeLessThan(0.2)
    expect(Math.abs(bmxCompensateH(adcH, tFine, trim) / 1024 - 61.8)).toBeLessThan(0.01)
  })

  it('×1 oversampling yields 16-bit codes (xlsb 0); a skipped pressure channel reads 0x80000; ctrl_hum waits for ctrl_meas', () => {
    const { rig, m } = bmxRig(true, { temperature: 30 })
    rig.run(3e-3)
    m.tx(0x76, [0xf2, 0x01])
    m.tx(0x76, [0xf4, (1 << 5) | (0 << 2) | 1])
    rig.run(10e-3)
    const d = m.readRegs(0x76, 0xf7, 8)!
    expect(d.slice(0, 3)).toEqual([0x80, 0, 0])
    expect(d[5]).toBe(0) // 16-bit temperature: xlsb zero
    const adcT = (d[3] << 12) | (d[4] << 4)
    expect(Math.abs(bmxCompensateT(adcT, BME280_TRIM)[0] / 100 - 30)).toBeLessThan(0.01)
    // ctrl_hum written alone does not take effect: humidity stays as measured with ×1
    m.tx(0x76, [0xf2, 0x00])
    m.tx(0x76, [0xf4, (1 << 5) | 1])
    rig.run(10e-3)
    expect(m.readRegs(0x76, 0xfd, 2)).toEqual([0x80, 0x00])
  })

  it('register writes are (address, data) pairs; normal mode repeats every t_meas + t_standby; soft reset', () => {
    const { rig, m, dev } = bmxRig(false)
    rig.run(3e-3)
    expect(m.tx(0x76, [0xf5, 0x20, 0xf4, (1 << 5) | (1 << 2) | 3])).toBe(true) // t_sb 62.5 ms, ×1/×1 normal
    expect(m.readRegs(0x76, 0xf4, 2)).toEqual([(1 << 5) | (1 << 2) | 3, 0x20])
    rig.run(1.0)
    const n = dev.telemetry().values!.conversions
    // period 5.5 ms + 62.5 ms = 68 ms → 14 conversions in 1 s
    expect(n).toBe(Math.floor(1.0 / 0.068) + (1.0 % 0.068 >= 0.0055 ? 1 : 0))
    m.tx(0x76, [0xe0, 0xb6])
    expect(m.ping(0x76)).toBe(false)
    rig.run(2.5e-3)
    expect(m.readRegs(0x76, 0xf4, 2)).toEqual([0, 0])
  })

  it('CSB low (SPI) is logged as not simulated', () => {
    const { rig, slot } = bmxRig(false)
    rig.set('CSB', 0)
    expect(slot.logs.some((l) => /SPI/.test(l))).toBe(true)
  })
})

// ================================================================ BH1750

function bhRig(lux: number) {
  const rig = new Rig()
  rig.net('SCL', true)
  rig.net('SDA', true)
  rig.net('ADDR')
  const dev = new Bh1750(comp('bh1750', { illuminance: lux }))
  rig.add(dev, { SCL: 'SCL', SDA: 'SDA', ADDR: 'ADDR' }, ['SCL', 'SDA', 'ADDR'])
  rig.set('ADDR', 0)
  return { rig, dev, m: new I2cMaster(rig) }
}
const word = (b: number[] | null) => (b ? (b[0] << 8) | b[1] : -1)

describe('BH1750 (GY-302)', () => {
  it('0x23 / 0x5C from ADDR; continuous H mode: 120 ms per measurement, count = lx × 1.2', () => {
    const { rig, m } = bhRig(500)
    expect(m.ping(0x23)).toBe(true)
    expect(m.ping(0x5c)).toBe(false)
    m.tx(0x23, [0x01])
    m.tx(0x23, [0x10])
    rig.run(0.119)
    expect(word(m.rx(0x23, 2))).toBe(0) // first measurement not finished
    rig.run(0.002)
    expect(word(m.rx(0x23, 2))).toBe(600)
    rig.set('ADDR', 1)
    expect(m.ping(0x5c)).toBe(true)
  })

  it('H2 doubles the count; one-time L is 16 ms, 4-count steps, then powers down; MTreg scales count and time', () => {
    const { rig, m, dev } = bhRig(123.4)
    m.tx(0x23, [0x01, 0x11])
    rig.run(0.121)
    expect(word(m.rx(0x23, 2))).toBe(Math.floor(123.4 * 2.4))
    m.tx(0x23, [0x23])
    rig.run(0.017)
    expect(word(m.rx(0x23, 2))).toBe(Math.floor(Math.floor(123.4 * 1.2) / 4) * 4)
    expect(dev.telemetry().values!.powerOn).toBe(0)
    // MTreg = 138 (×2): 01000_100, 011_01010
    m.tx(0x23, [0x01, 0x44, 0x6a, 0x10])
    rig.run(0.239)
    expect(dev.telemetry().values!.mtreg).toBe(138)
    expect(dev.telemetry().values!.measurements).toBe(2)
    rig.run(0.002)
    expect(word(m.rx(0x23, 2))).toBe(Math.floor(123.4 * 1.2 * 2))
  })

  it('saturates at 65535; reset clears the data register only while powered on', () => {
    const { rig, m } = bhRig(80000)
    m.tx(0x23, [0x10])
    rig.run(0.121)
    expect(word(m.rx(0x23, 2))).toBe(0xffff)
    m.tx(0x23, [0x07])
    expect(word(m.rx(0x23, 2))).toBe(0)
  })
})

// ================================================================ DHT11 / DHT22

/** Host start + capture of the sensor's answer: decoded bytes or null (no response). */
function dhtRead(rig: Rig, lowMs: number): { bytes: number[]; highs: number[]; lows: number[] } | null {
  const t0 = rig.t
  rig.set('DATA', 0)
  rig.run(lowMs / 1000)
  rig.set('DATA', null)
  rig.run(6e-3)
  const ed = rig.edges('DATA', t0 + lowMs / 1000 + 1e-9)
  if (ed.length < 4) return null
  // ed[0] = sensor pulls low (response), then alternating
  const dur: number[] = []
  for (let i = 1; i < ed.length; i++) dur.push(ed[i].t - ed[i - 1].t)
  const lows = dur.filter((_, i) => i % 2 === 0)
  const highs = dur.filter((_, i) => i % 2 === 1)
  // highs[0] = response high, then 40 bit highs
  const bits: number[] = highs.slice(1, 41).map((h) => (h > 50e-6 ? 1 : 0))
  const bytes = [0, 1, 2, 3, 4].map((k) => bits.slice(k * 8, k * 8 + 8).reduce((v: number, b) => (v << 1) | b, 0))
  return { bytes, highs, lows }
}

function dhtRig(variant: 'dht11' | 'dht22', params: Record<string, number>) {
  const rig = new Rig()
  rig.net('DATA', true)
  const dev = new DhtSensor(variant, comp(variant, params))
  const slot = rig.add(dev, { DATA: 'DATA' }, ['DATA'], { supply: 3.3 })
  return { rig, dev, slot }
}

describe('DHT11 / DHT22', () => {
  it('DHT22: ≥ 1 ms start → 80 µs / 80 µs answer, 50 µs lows, 27 / 70 µs highs, checksum; values ×10', () => {
    const { rig } = dhtRig('dht22', { temperature: 23.4, humidity: 56.7 })
    rig.run(2.1)
    const r = dhtRead(rig, 1)!
    expect(r).not.toBeNull()
    expect(r.lows[0]).toBeCloseTo(80e-6, 9)
    expect(r.highs[0]).toBeCloseTo(80e-6, 9)
    for (const l of r.lows.slice(1, 41)) expect(l).toBeCloseTo(50e-6, 9)
    for (const h of r.highs.slice(1, 41)) expect([27e-6, 70e-6].some((v) => Math.abs(v - h) < 1e-9)).toBe(true)
    expect(r.bytes).toEqual(dhtFrame('dht22', 23.4, 56.7))
    expect(((r.bytes[0] << 8) | r.bytes[1]) / 10).toBe(56.7)
    expect(((r.bytes[2] << 8) | r.bytes[3]) / 10).toBe(23.4)
    expect((r.bytes[0] + r.bytes[1] + r.bytes[2] + r.bytes[3]) & 0xff).toBe(r.bytes[4])
  })

  it('negative DHT22 temperature sets bit 15', () => {
    const f = dhtFrame('dht22', -12.3, 40)
    expect(f[2] & 0x80).toBe(0x80)
    expect((((f[2] & 0x7f) << 8) | f[3]) / 10).toBe(12.3)
  })

  it('DHT11: a 10 ms start is too short (needs ≥ 18 ms); 20 ms works; integer frame', () => {
    const { rig } = dhtRig('dht11', { temperature: 21.6, humidity: 44.2 })
    rig.run(1.1)
    expect(dhtRead(rig, 10)).toBeNull()
    rig.run(1.1)
    const r = dhtRead(rig, 20)!
    expect(r.bytes).toEqual([44, 0, 22, 0, 66])
  })

  it('reads within the power-up time or faster than the minimum interval get no answer; the frame holds the PREVIOUS measurement', () => {
    const { rig, dev, slot } = dhtRig('dht22', { temperature: 20, humidity: 50 })
    rig.run(1.0)
    expect(dhtRead(rig, 1)).toBeNull() // still settling (2 s)
    rig.run(1.2)
    dev.setParam('temperature', 30)
    let r = dhtRead(rig, 1)!
    expect(((r.bytes[2] << 8) | r.bytes[3]) / 10).toBe(20) // measured at power-up
    rig.run(1.0)
    expect(dhtRead(rig, 1)).toBeNull() // < 2 s after the previous read
    rig.run(1.2)
    r = dhtRead(rig, 1)!
    expect(((r.bytes[2] << 8) | r.bytes[3]) / 10).toBe(30)
    expect(slot.logs.some((l) => /2 s/.test(l))).toBe(true)
  })
})

// ================================================================ DS18B20

/** 1-Wire master with standard slot timing (Maxim AN126 "standard speed"). */
class OneWireMaster {
  constructor(
    private rig: Rig,
    private net = 'DQ',
  ) {}
  reset(): boolean {
    this.rig.set(this.net, 0)
    this.rig.run(500e-6)
    this.rig.set(this.net, null)
    this.rig.run(70e-6)
    const presence = this.rig.level(this.net) === 0
    this.rig.run(430e-6)
    return presence
  }
  writeBit(b: number): void {
    this.rig.set(this.net, 0)
    if (b) {
      this.rig.run(6e-6)
      this.rig.set(this.net, null)
      this.rig.run(64e-6)
    } else {
      this.rig.run(60e-6)
      this.rig.set(this.net, null)
      this.rig.run(10e-6)
    }
  }
  readBit(): number {
    this.rig.set(this.net, 0)
    this.rig.run(3e-6)
    this.rig.set(this.net, null)
    this.rig.run(10e-6)
    const v = this.rig.level(this.net) === 0 ? 0 : 1
    this.rig.run(53e-6)
    return v
  }
  write(b: number): void {
    for (let i = 0; i < 8; i++) this.writeBit((b >> i) & 1)
  }
  read(): number {
    let v = 0
    for (let i = 0; i < 8; i++) v |= this.readBit() << i
    return v
  }
  /** Maxim AN187 search algorithm: every ROM on the bus */
  search(): number[][] {
    const roms: number[][] = []
    let lastDiscrepancy = -1
    let rom = new Array(64).fill(0)
    for (;;) {
      if (!this.reset()) return roms
      this.write(0xf0)
      let lastZero = -1
      for (let i = 0; i < 64; i++) {
        const a = this.readBit()
        const b = this.readBit()
        if (a && b) return roms
        let dir: number
        if (a !== b) dir = a
        else {
          dir = i < lastDiscrepancy ? rom[i] : i === lastDiscrepancy ? 1 : 0
          if (dir === 0) lastZero = i
        }
        rom[i] = dir
        this.writeBit(dir)
      }
      roms.push(Array.from({ length: 8 }, (_, k) => rom.slice(k * 8, k * 8 + 8).reduce((v, bit, j) => v | (bit << j), 0)))
      lastDiscrepancy = lastZero
      if (lastDiscrepancy < 0) return roms
      rom = rom.slice()
    }
  }
}

function dsRig(ids: string[], temps: number[], pullUp = true) {
  const rig = new Rig()
  rig.net('DQ', pullUp)
  const devs = ids.map((id, i) => {
    eraseDs18b20(id)
    const d = new Ds18b20(id, comp('ds18b20', { temperature: temps[i] }, id))
    rig.add(d, { DQ: 'DQ' }, ['DQ'], { id, supply: 3.3 })
    return d
  })
  return { rig, devs, ow: new OneWireMaster(rig) }
}

describe('DS18B20', () => {
  it('ROM code: family 0x28 + 48-bit serial + valid CRC8; READ ROM returns it', () => {
    const rom = ds18b20Rom('T1')
    expect(rom[0]).toBe(0x28)
    expect(crc8(rom.slice(0, 7))).toBe(rom[7])
    expect(crc8(rom)).toBe(0)
    const { ow } = dsRig(['T1'], [25])
    expect(ow.reset()).toBe(true)
    ow.write(0x33)
    expect(Array.from({ length: 8 }, () => ow.read())).toEqual(rom)
  })

  it('presence pulse 30 µs after the reset ends, 120 µs long', () => {
    const { rig } = dsRig(['T2'], [25])
    rig.set('DQ', 0)
    rig.run(500e-6)
    const tRel = rig.t
    rig.set('DQ', null)
    rig.run(300e-6)
    const e = rig.edges('DQ', tRel + 1e-9)
    expect(e[0].level).toBe(0)
    expect(e[0].t - tRel).toBeCloseTo(30e-6, 9)
    expect(e[1].t - e[0].t).toBeCloseTo(120e-6, 9)
  })

  it('power-up scratchpad = 50 05 4B 46 7F FF 0C 10 1C (85 °C, the datasheet default)', () => {
    const { ow } = dsRig(['T3'], [25])
    ow.reset()
    ow.write(0xcc)
    ow.write(0xbe)
    expect(Array.from({ length: 9 }, () => ow.read())).toEqual([0x50, 0x05, 0x4b, 0x46, 0x7f, 0xff, 0x0c, 0x10, 0x1c])
  })

  it('CONVERT T: busy (read slots 0) for 750 ms at 12 bit, then the temperature within 1/16 °C', () => {
    const { rig, ow } = dsRig(['T4'], [23.5625 + 0.01])
    ow.reset()
    ow.write(0xcc)
    ow.write(0x44)
    const t0 = rig.t
    let polls = 0
    while (ow.readBit() === 0) polls++
    expect(rig.t - t0).toBeGreaterThanOrEqual(0.75)
    expect(rig.t - t0).toBeLessThan(0.7502)
    expect(polls).toBeGreaterThan(10000)
    ow.reset()
    ow.write(0xcc)
    ow.write(0xbe)
    const sp = Array.from({ length: 9 }, () => ow.read())
    expect(crc8(sp)).toBe(0)
    expect(s16(sp[1], sp[0]) / 16).toBe(23.5625)
  })

  it('9-bit resolution: 93.75 ms conversion, 0.5 °C steps; negative temperatures in two\'s complement', () => {
    const { rig, ow } = dsRig(['T5'], [-10.3])
    ow.reset()
    ow.write(0xcc)
    ow.write(0x4e)
    ow.write(0x55)
    ow.write(0x00)
    ow.write(0x1f) // 9 bit
    ow.reset()
    ow.write(0xcc)
    ow.write(0x44)
    const t0 = rig.t
    while (ow.readBit() === 0);
    expect(rig.t - t0).toBeCloseTo(0.09375, 3)
    ow.reset()
    ow.write(0xcc)
    ow.write(0xbe)
    const sp = Array.from({ length: 9 }, () => ow.read())
    expect(sp[4]).toBe(0x1f)
    expect(s16(sp[1], sp[0]) / 16).toBe(-10.5)
    expect(ds18b20Raw(-10.125, 12)).toBe(0xff5e)
  })

  it('two sensors on one bus: SEARCH ROM finds both, MATCH ROM addresses one', () => {
    const { rig, ow } = dsRig(['TA', 'TB'], [10, 30])
    const found = ow.search()
    expect(found.map((r) => r.join(',')).sort()).toEqual([ds18b20Rom('TA'), ds18b20Rom('TB')].map((r) => r.join(',')).sort())
    ow.reset()
    ow.write(0xcc)
    ow.write(0x44)
    rig.run(0.8)
    for (const [id, t] of [
      ['TA', 10],
      ['TB', 30],
    ] as const) {
      ow.reset()
      ow.write(0x55)
      for (const b of ds18b20Rom(id)) ow.write(b)
      ow.write(0xbe)
      const sp = Array.from({ length: 9 }, () => ow.read())
      expect(crc8(sp)).toBe(0)
      expect(s16(sp[1], sp[0]) / 16).toBe(t)
    }
  })

  it('without the pull-up the bus never rises: no reset edge, no presence pulse', () => {
    const { rig, devs, ow } = dsRig(['T6'], [25], false)
    expect(ow.reset()).toBe(false)
    expect(devs[0].telemetry().values!.presences).toBe(0)
    expect(rig.edges('DQ').every((e) => e.level !== 1)).toBe(true)
  })
})

// ================================================================ HC-SR04

describe('HC-SR04', () => {
  function srRig(params: Record<string, number>) {
    const rig = new Rig()
    rig.net('TRIG')
    rig.set('TRIG', 0)
    const dev = new Hcsr04(comp('hcsr04', params))
    rig.add(dev, { TRIG: 'TRIG', ECHO: 'ECHO' }, ['TRIG'], { supply: 5 })
    return { rig, dev }
  }
  const pulse = (rig: Rig, us: number) => {
    rig.set('TRIG', 1)
    rig.run(us * 1e-6)
    rig.set('TRIG', 0)
  }

  it('10 µs trigger → ECHO rises 0.45 ms later, high for 2·d / c (100 cm, 20 °C ≈ 5.827 ms)', () => {
    const { rig } = srRig({ distance: 100, temperature: 20 })
    rig.run(1e-3)
    const t0 = rig.t
    pulse(rig, 10)
    const tf = rig.t
    rig.run(10e-3)
    const e = rig.edges('ECHO', t0)
    const rise = e.find((x) => x.level === 1)!
    const fall = e.find((x) => x.level === 0 && x.t > rise.t)!
    expect(rise.t - tf).toBeCloseTo(HCSR04_ECHO_DELAY, 9)
    expect(fall.t - rise.t).toBeCloseTo(2 / speedOfSound(20), 9)
    expect(speedOfSound(20)).toBeCloseTo(343.2, 1)
    expect((fall.t - rise.t) * 1e6 * 0.0343 / 2).toBeCloseTo(100, 0)
  })

  it('a 5 µs trigger is ignored; out of range → 38 ms; air temperature changes the echo time', () => {
    const { rig, dev } = srRig({ distance: 450 })
    pulse(rig, 5)
    rig.run(5e-3)
    expect(rig.edges('ECHO').some((e) => e.level === 1)).toBe(false)
    const t0 = rig.t
    pulse(rig, 12)
    rig.run(50e-3)
    const e = rig.edges('ECHO', t0)
    expect(e[1].t - e[0].t).toBeCloseTo(HCSR04_TIMEOUT, 9)
    expect(hcsr04EchoTime(200, 0)).toBeGreaterThan(hcsr04EchoTime(200, 40))
    dev.setParam('distance', 1)
    expect(hcsr04EchoTime(1, 20)).toBeCloseTo(hcsr04EchoTime(2, 20), 12)
  })

  it('triggers while ECHO is high are ignored', () => {
    const { rig, dev } = srRig({ distance: 300 })
    pulse(rig, 10)
    rig.run(2e-3)
    pulse(rig, 10)
    rig.run(40e-3)
    expect(dev.telemetry().values!.measurements).toBe(1)
  })
})

// ================================================================ KY-040

describe('KY-040 rotary encoder', () => {
  function encRig(params: Record<string, number | boolean> = {}) {
    const rig = new Rig()
    rig.net('CLK', true)
    rig.net('DT', true)
    rig.net('SW')
    const dev = new Ky040(comp('ky040_encoder', { turnRate: 10, ...params }))
    rig.add(dev, { CLK: 'CLK', DT: 'DT', SW: 'SW' }, [])
    return { rig, dev }
  }

  it('clockwise detents: CLK falls first, full quadrature cycle per detent, both open at each detent', () => {
    const { rig, dev } = encRig()
    rig.run(1e-3)
    const t0 = rig.t
    dev.setParam('position', 2)
    rig.run(0.25)
    const seq = [...rig.edges('CLK', t0).map((e) => ({ ...e, n: 'CLK' })), ...rig.edges('DT', t0).map((e) => ({ ...e, n: 'DT' }))].sort((a, b) => a.t - b.t)
    expect(seq.map((e) => `${e.n}${e.level}`)).toEqual(['CLK0', 'DT0', 'CLK1', 'DT1', 'CLK0', 'DT0', 'CLK1', 'DT1'])
    for (let i = 1; i < seq.length; i++) expect(seq[i].t - seq[i - 1].t).toBeCloseTo(0.025, 9)
    expect(dev.telemetry().values!.position).toBe(2)
    expect(rig.level('CLK')).toBe(1)
    expect(rig.level('DT')).toBe(1)
  })

  it('counter-clockwise: DT falls first; SW pulls low while pressed', () => {
    const { rig, dev } = encRig({ position: 5 })
    rig.run(1e-3)
    const t0 = rig.t
    dev.setParam('position', 4)
    rig.run(0.2)
    const first = [...rig.edges('CLK', t0), ...rig.edges('DT', t0)].length
    expect(first).toBe(4)
    expect(rig.edges('DT', t0)[rig.edges('DT', t0).length - 2].t).toBeLessThan(rig.edges('CLK', t0)[rig.edges('CLK', t0).length - 2].t)
    expect(rig.level('SW')).toBe(null)
    dev.setParam('pressed', true)
    expect(rig.level('SW')).toBe(0)
  })
})

// ================================================================ A3144

describe('A3144 Hall switch', () => {
  it('operates above 15 mT, releases below 9.5 mT (hysteresis), north pole never operates, unpowered = off', () => {
    const rig = new Rig()
    rig.net('OUT', true)
    const dev = new A3144(comp('hall_a3144', { field: 0 }))
    rig.add(dev, { OUT: 'OUT' }, [], { supply: 5 })
    expect(rig.level('OUT')).toBe(1)
    dev.setParam('field', 16)
    expect(rig.level('OUT')).toBe(0)
    dev.setParam('field', 12)
    expect(rig.level('OUT')).toBe(0)
    dev.setParam('field', 9)
    expect(rig.level('OUT')).toBe(1)
    dev.setParam('field', -50)
    expect(rig.level('OUT')).toBe(1)
    dev.setParam('field', 40)
    dev.powerChanged(false)
    expect(rig.level('OUT')).toBe(1)
  })
})

// ================================================================ VS1838B

function decodeNec(rig: Rig, t0: number): { address: number; command: number; frame: number[] } | null {
  const e = rig.edges('OUT', t0)
  if (e.length < 4) return null
  const d: number[] = []
  for (let i = 1; i < e.length; i++) d.push(e[i].t - e[i - 1].t)
  // d[0] = 9 ms mark, d[1] = 4.5 ms space, then mark/space pairs
  if (Math.abs(d[0] - 9e-3) > 1e-6 || Math.abs(d[1] - 4.5e-3) > 1e-6) return null
  const bits: number[] = []
  for (let i = 0; i < 32; i++) bits.push(d[3 + 2 * i] > 1e-3 ? 1 : 0)
  const frame = [0, 1, 2, 3].map((k) => bits.slice(k * 8, k * 8 + 8).reduce((v, b, j) => v | (b << j), 0))
  return { address: frame[0], command: frame[2], frame }
}

describe('VS1838B + virtual NEC remote', () => {
  function irRig() {
    const rig = new Rig()
    rig.net('OUT')
    const dev = new Vs1838b(comp('ir_receiver_vs1838b'))
    rig.add(dev, { OUT: 'OUT' }, [], { supply: 3.3 })
    return { rig, dev }
  }

  it('selecting a key sends its NEC frame: 9 ms + 4.5 ms leader, address, ~address, command, ~command, LSB first', () => {
    const { rig, dev } = irRig()
    expect(rig.level('OUT')).toBe(1) // idle high (internal pull-up)
    rig.run(1e-3)
    const t0 = rig.t
    dev.setParam('remoteButton', 'CH-')
    rig.run(0.1)
    const f = decodeNec(rig, t0)!
    expect(f.frame).toEqual([0x00, 0xff, NEC_KEYS['CH-'], ~NEC_KEYS['CH-'] & 0xff])
    // bursts are 562.5 µs
    const e = rig.edges('OUT', t0)
    expect(e[3].t - e[2].t).toBeCloseTo(NEC_T, 9)
    expect(rig.level('OUT')).toBe(1)
  })

  it('holding a key sends repeat codes every 108 ms; a new key sends a new frame with the set address', () => {
    const { rig, dev } = irRig()
    dev.setParam('hold', true)
    rig.run(1e-3)
    const t0 = rig.t
    dev.setParam('remoteButton', 'VOL+')
    rig.run(0.5)
    expect(dev.telemetry().values!.repeats).toBe(4)
    const marks = rig.edges('OUT', t0).filter((x) => x.level === 0)
    const leaders = marks.filter((m, i) => {
      const next = rig.edges('OUT', m.t + 1e-12)[0]
      return next && Math.abs(next.t - m.t - 9e-3) < 1e-6 && i >= 0
    })
    expect(leaders.length).toBe(5)
    expect(leaders[1].t - leaders[0].t).toBeCloseTo(0.108, 6)
    dev.setParam('hold', false)
    dev.setParam('address', 0x12)
    const t1 = rig.t
    dev.setParam('remoteButton', '7')
    rig.run(0.15)
    const f = decodeNec(rig, t1)!
    expect(f.frame).toEqual([0x12, 0xed, 0x42, 0xbd])
  })
})
