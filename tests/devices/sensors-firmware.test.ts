/**
 * REAL firmware on REAL circuits through the SimulationCoordinator: the
 * firmware/projects/hal-<sensor> images (ST HAL v1.1.9, clang) run on a Blue
 * Pill powered from a 5 V bench supply, wired to the sensor modules exactly
 * as a user would place them (header pins in breadboard holes, jumper wires
 * from the free holes of the strips to the Blue Pill header strips, pull-ups
 * where the real module needs them). Everything the firmware learns travels
 * over the pins: I²C bits, 1-Wire slots, DHT pulses, ECHO pulse widths,
 * quadrature edges, NEC bursts, ADC voltages. The environment inputs are
 * swept with setRuntimeParam (the inspector path) and the values the
 * firmware PRINTS over USART1 are checked against them.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import type { FirmwareImage } from '../../src/mcu/firmware'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { CATALOG } from '../../src/model/catalog'
import { validateLayout } from '../../src/model/validate'
import { eraseDs18b20 } from '../../src/sim/models/sensors-ds18b20'
import { runErc } from '../../src/sim/erc'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../firmware/dist')

const images = new Map<string, FirmwareImage>()
function image(name: string): FirmwareImage {
  let img = images.get(name)
  if (!img) {
    const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
    if (!res.ok) throw new Error(res.error)
    img = res.image
    images.set(name, img)
  }
  return img
}

const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }

/** The free hole on the strip of a Blue Pill header pin (row a / j). */
function tap(pin: string): string {
  const entry = CATALOG[BP.type]
  const h = componentPinHoles(BP, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(pin)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

/** The free hole in row j of the strip a module pin sits on (module header in row f). */
function below(comp: ComponentInstance, pin: string, row = 'j'): string {
  const entry = CATALOG[comp.type]
  const h = componentPinHoles(comp, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(`${comp.id}.${pin}`)
  return formatHole({ ...h, row: row as 'j' })
}

class World {
  private n = 0
  readonly comps: ComponentInstance[] = [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP]
  readonly wires: Wire[] = []
  constructor() {
    this.w('PS1:+', tap('5V'))
    this.w('PS1:-', 'top-0')
    this.w(tap('GND3'), 'top-1')
    this.w(tap('3V3_1'), 'top+0') // board 3.3 V on the top + rail
    this.w('top-48', 'bot-48') // ground on the bottom − rail too
    this.w('PS1:+', 'bot+48') // 5 V on the bottom + rail
  }
  w(from: string, to: string): this {
    this.wires.push({ id: `w${++this.n}`, from, to })
    return this
  }
  add(c: ComponentInstance): ComponentInstance {
    this.comps.push(c)
    return c
  }
  layout(): CircuitLayout {
    return { version: 1, name: 'sensor bench', components: this.comps, wires: this.wires }
  }
}

class Bench {
  readonly co = new SimulationCoordinator()
  text = ''
  constructor(layout: CircuitLayout, fw: string) {
    const v = validateLayout(layout)
    expect(v.errors, 'layout must be valid').toEqual([])
    this.co.load(layout, 1)
    this.co.setFirmware('U1', image(fw))
  }
  /** advance until `until(text)` or the time limit (s, absolute) */
  run(until: (t: string) => boolean, limit: number): string {
    while (this.co.time < limit && !until(this.text)) {
      this.co.advance(0.01)
      for (const u of this.co.frame().uart) if (u.port === 'USART1') this.text += String.fromCharCode(...u.bytes)
    }
    return this.text
  }
  /** wait for `count` more lines matching `re`, return the last one's match */
  next(re: RegExp, count = 1, timeout = 3): RegExpMatchArray {
    const g = new RegExp(re.source, 'g')
    const have = [...this.text.matchAll(g)].length
    const t0 = this.co.time
    this.run((t) => [...t.matchAll(g)].length >= have + count, t0 + timeout)
    const all = [...this.text.matchAll(g)]
    if (all.length < have + count) throw new Error(`timeout waiting for ${re}: ${JSON.stringify(this.text.slice(-400))}`)
    return all[all.length - 1]
  }
  set(id: string, key: string, value: ParamValue): void {
    this.co.setRuntimeParam(id, key, value)
  }
  errors(): string[] {
    return this.co.issues().filter((i) => i.level === 'error').map((i) => i.message)
  }
}

// =================================================================== MPU-6050

function mpuWorld(opts: { imu?: boolean; noWake?: boolean; params?: Record<string, number> } = {}) {
  const wd = new World()
  if (opts.imu !== false) {
    const imu = wd.add({ id: 'IMU', type: 'mpu6050_gy521', at: 'f40', params: opts.params })
    wd.w(below(imu, 'VCC'), 'top+5') // GY-521 from the board's 3.3 V
      .w(below(imu, 'GND'), 'top-5')
      .w(below(imu, 'SCL'), tap('PB6'))
      .w(below(imu, 'SDA'), tap('PB7'))
  }
  if (opts.noWake) wd.w(tap('PB12'), 'top-6')
  return wd.layout()
}

const MPU_LINE = /ax=(-?\d+) ay=(-?\d+) az=(-?\d+) gx=(-?\d+) gy=(-?\d+) gz=(-?\d+) t=(-?\d+\.\d\d)\r\n/

describe('hal-mpu6050 on a Blue Pill + GY-521', () => {
  it('reads WHO_AM_I, wakes the chip and prints the raw accelerometer within 1 LSB of g × 16384 while the inputs are swept', { timeout: 300_000 }, () => {
    const b = new Bench(mpuWorld(), 'hal-mpu6050')
    b.run((t) => t.includes('100 Hz\r\n'), 1)
    expect(b.text).toBe('MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)\r\nWHO_AM_I=0x68\r\nawake: +-2 g, +-250 dps, 100 Hz\r\n')
    // the module rests flat: 1 g on Z, 25 °C
    let m = b.next(MPU_LINE)
    expect(m.slice(1, 7).map(Number)).toEqual([0, 0, 16384, 0, 0, 0])
    expect(Math.abs(Number(m[7]) - 25)).toBeLessThanOrEqual(0.01 + 1 / 340)
    for (const [ax, ay, az] of [
      [0.5, -0.25, 0.8],
      [-1.5, 1.2, -0.333],
      [1.99, -1.99, 0.0001],
    ]) {
      b.set('IMU', 'accelX', ax)
      b.set('IMU', 'accelY', ay)
      b.set('IMU', 'accelZ', az)
      b.next(MPU_LINE) // a line may already be in flight
      m = b.next(MPU_LINE)
      expect(Math.abs(Number(m[1]) - ax * 16384), `ax ${ax}`).toBeLessThanOrEqual(1)
      expect(Math.abs(Number(m[2]) - ay * 16384), `ay ${ay}`).toBeLessThanOrEqual(1)
      expect(Math.abs(Number(m[3]) - az * 16384), `az ${az}`).toBeLessThanOrEqual(1)
    }
    b.set('IMU', 'gyroX', 100)
    b.set('IMU', 'gyroY', -42.5)
    b.set('IMU', 'gyroZ', 249)
    b.set('IMU', 'temperature', -5.25)
    b.next(MPU_LINE)
    m = b.next(MPU_LINE)
    expect(m.slice(4, 7).map(Number)).toEqual([13100, Math.round(-42.5 * 131), Math.round(249 * 131)])
    expect(Math.abs(Number(m[7]) - -5.25)).toBeLessThanOrEqual(0.01 + 1 / 340) // 0.01 C truncation + 1 LSB
    expect(b.errors()).toEqual([])
  })

  it('SLEEP never cleared (PB12 jumper to GND): the outputs stay zero, t = 36.53', { timeout: 120_000 }, () => {
    const b = new Bench(mpuWorld({ noWake: true, params: { accelX: 0.7 } }), 'hal-mpu6050')
    const m = b.next(MPU_LINE, 3)
    expect(b.text).toContain('PB12 low: PWR_MGMT_1 not written, the sensor stays asleep\r\n')
    expect(m.slice(1, 7).map(Number)).toEqual([0, 0, 0, 0, 0, 0])
    expect(m[7]).toBe('36.53')
  })

  it('no module on the bus: "MPU-6050 not found at 0x68"', { timeout: 120_000 }, () => {
    const wd = mpuWorld({ imu: false })
    // the bus still has pull-ups (as a module would bring)
    wd.components.push({ id: 'R1', type: 'resistor', holes: ['a44', 'top+20'], params: { resistance: 4700 } })
    wd.components.push({ id: 'R2', type: 'resistor', holes: ['a46', 'top+21'], params: { resistance: 4700 } })
    wd.wires.push({ id: 'x1', from: 'b44', to: tap('PB6') }, { id: 'x2', from: 'b46', to: tap('PB7') })
    const b = new Bench(wd, 'hal-mpu6050')
    b.run((t) => t.includes('not found'), 1)
    expect(b.text).toBe('MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)\r\nMPU-6050 not found at 0x68\r\n')
  })
})

// =================================================================== BME280 / BMP280

function bmxWorld(type: 'bme280' | 'bmp280', params: Record<string, number>) {
  const wd = new World()
  const s = wd.add({ id: 'ENV', type, at: 'f40', params })
  wd.w(below(s, 'VCC'), 'top+5') // 3.3 V module
    .w(below(s, 'GND'), 'top-5')
    .w(below(s, 'SCL'), tap('PB6'))
    .w(below(s, 'SDA'), tap('PB7'))
  return wd.layout()
}

const BMX_LINE = /T=(-?\d+\.\d\d) P=(\d+\.\d\d)(?: H=(\d+\.\d\d))?\r\n/

describe('hal-bme280 on a Blue Pill + GY-BME280 / GY-BMP280', () => {
  it('BME280: the Bosch compensation in the firmware recovers T within 0.01 °C, P within 0.2 Pa, H within 0.02 %RH', { timeout: 300_000 }, () => {
    const b = new Bench(bmxWorld('bme280', { temperature: 21.37, pressure: 1003.42, humidity: 47.3 }), 'hal-bme280')
    b.run((t) => /dig_H1=\d+\r\n/.test(t), 1)
    expect(b.text).toBe('BME280 on I2C1 (PB6 SCL / PB7 SDA)\r\nid=0x60 dig_T1=28159 dig_P1=36998 dig_H1=75\r\n')
    let m = b.next(BMX_LINE)
    const check = (t: number, pHpa: number, h: number) => {
      expect(Math.abs(Number(m[1]) - t), `T ${t}`).toBeLessThanOrEqual(0.01)
      expect(Math.abs(Number(m[2]) - pHpa * 100), `P ${pHpa}`).toBeLessThan(0.2)
      expect(Math.abs(Number(m[3]) - h), `H ${h}`).toBeLessThanOrEqual(0.02)
    }
    check(21.37, 1003.42, 47.3)
    for (const [t, p, h] of [
      [-12.34, 875.55, 12.5],
      [38.9, 1090.01, 88.8],
      [0.42, 1013.25, 0],
    ]) {
      b.set('ENV', 'temperature', t)
      b.set('ENV', 'pressure', p)
      b.set('ENV', 'humidity', h)
      b.next(BMX_LINE) // a conversion may already be running
      m = b.next(BMX_LINE)
      check(t, p, h)
    }
    expect(b.errors()).toEqual([])
  })

  it('BMP280 (id 0x58): same firmware, no humidity, datasheet trimming', { timeout: 300_000 }, () => {
    const b = new Bench(bmxWorld('bmp280', { temperature: 25.08, pressure: 1006.53 }), 'hal-bme280')
    const m = b.next(BMX_LINE)
    expect(b.text).toContain('id=0x58 dig_T1=27504 dig_P1=36477 dig_H1=0\r\n')
    expect(m[3]).toBeUndefined()
    expect(Math.abs(Number(m[1]) - 25.08)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(Number(m[2]) - 100653)).toBeLessThan(0.2)
  })
})

// =================================================================== BH1750

describe('hal-bh1750 on a Blue Pill + GY-302 (5 V module supply through its regulator)', () => {
  it('prints lux = count / 1.2 following the illuminance input', { timeout: 300_000 }, () => {
    const wd = new World()
    const s = wd.add({ id: 'LUX', type: 'bh1750', at: 'f40', params: { illuminance: 500 } })
    wd.w(below(s, 'VCC'), 'bot+5').w(below(s, 'GND'), 'top-5').w(below(s, 'SCL'), tap('PB6')).w(below(s, 'SDA'), tap('PB7'))
    const b = new Bench(wd.layout(), 'hal-bh1750')
    const LUX = /lux=(\d+)\.(\d) \(count (\d+)\)\r\n/
    let m = b.next(LUX)
    expect(b.text.startsWith('BH1750 on I2C1 (PB6 SCL / PB7 SDA)\r\ncontinuous H-resolution mode\r\n')).toBe(true)
    expect(m[3]).toBe('600')
    expect(`${m[1]}.${m[2]}`).toBe('500.0')
    for (const lux of [0.5, 12.3, 1234.5, 40000]) {
      b.set('LUX', 'illuminance', lux)
      b.next(LUX, 2)
      m = b.next(LUX)
      expect(Number(m[3])).toBe(Math.floor(lux * 1.2))
      expect(Math.abs(Number(`${m[1]}.${m[2]}`) - lux)).toBeLessThanOrEqual(0.9) // 1 count = 0.83 lx
    }
  })
})

// =================================================================== DHT22

describe('hal-dht on a Blue Pill + DHT22 module', () => {
  it('reads within 0.1 of the inputs; a change appears one read later (the sensor sends its previous measurement)', { timeout: 300_000 }, () => {
    const wd = new World()
    const s = wd.add({ id: 'DHT', type: 'dht22', at: 'f40', params: { temperature: 23.4, humidity: 56.7 } })
    wd.w(below(s, 'VCC'), 'top+5').w(below(s, 'GND'), 'top-5').w(below(s, 'DATA'), tap('PB12'))
    const b = new Bench(wd.layout(), 'hal-dht')
    const DHT = /RH=(\d+\.\d) T=(-?\d+\.\d)\r\n/
    let m = b.next(DHT, 1, 4)
    expect(b.text.startsWith('DHT22 on PB12 (DWT timing)\r\n')).toBe(true)
    expect([Number(m[1]), Number(m[2])]).toEqual([56.7, 23.4])
    for (const [t, h] of [
      [-12.3, 30.1],
      [79.9, 99.9],
      [0.1, 0],
    ]) {
      b.set('DHT', 'temperature', t)
      b.set('DHT', 'humidity', h)
      m = b.next(DHT, 1, 4)
      expect(Number(m[2]), 'one read late').not.toBe(t)
      m = b.next(DHT, 1, 4)
      expect(Math.abs(Number(m[2]) - t)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(Number(m[1]) - h)).toBeLessThanOrEqual(0.1)
    }
    expect(b.text).not.toMatch(/no response|timeout|checksum/)
  })

  it('without the module the firmware reports "no response"', { timeout: 120_000 }, () => {
    const wd = new World()
    wd.add({ id: 'RP', type: 'resistor', holes: ['a44', 'top+20'], params: { resistance: 10000 } })
    wd.w('b44', tap('PB12'))
    const b = new Bench(wd.layout(), 'hal-dht')
    b.next(/DHT22: no response\r\n/, 1, 4)
  })
})

// =================================================================== DS18B20

function dsWorld(opts: { pullUp: boolean; sensor?: boolean; temperature?: number }) {
  const wd = new World()
  if (opts.sensor !== false) {
    wd.add({ id: 'TS', type: 'ds18b20', holes: ['f50', 'f51', 'f52'], params: { temperature: opts.temperature ?? 25 } })
    wd.w('j50', 'top-5').w('j52', 'top+5')
  }
  wd.w('j51', tap('PB12'))
  if (opts.pullUp) wd.add({ id: 'RPU', type: 'resistor', holes: ['h51', 'h53'], params: { resistance: 4700 } }).holes && wd.w('j53', 'top+6')
  return wd.layout()
}

const DS_LINE = /T=(-?\d+\.\d{4}) C \(conv (\d+) ms\)\r\n/

describe('hal-ds18b20 on a Blue Pill + DS18B20 (TO-92) + 4.7 kΩ pull-up', () => {
  it('ROM with a valid CRC, then the temperature within 1/16 °C and the 750 ms conversion, while swept', { timeout: 300_000 }, () => {
    eraseDs18b20('TS')
    const b = new Bench(dsWorld({ pullUp: true, temperature: 21.3 }), 'hal-ds18b20')
    let m = b.next(DS_LINE)
    expect(b.text).toMatch(/^DS18B20 on PB12 \(1-Wire, DWT timing\)\r\nROM 28(-[0-9A-F]{2}){7} CRC ok\r\n/)
    expect(Math.abs(Number(m[1]) - 21.3)).toBeLessThanOrEqual(0.0625)
    expect(Number(m[2])).toBeGreaterThanOrEqual(750)
    expect(Number(m[2])).toBeLessThanOrEqual(752)
    for (const t of [-10.125, 0.0625, 85.5, 124.9]) {
      b.set('TS', 'temperature', t)
      b.next(DS_LINE) // a conversion may already be under way
      m = b.next(DS_LINE)
      expect(Math.abs(Number(m[1]) - t), `${t} °C`).toBeLessThanOrEqual(0.0625)
    }
    expect(b.text).not.toMatch(/CRC error|no DS18B20|bus low/)
  })

  it('WITHOUT the pull-up the bus never rises: no presence pulse ever, the firmware reports the missing pull-up', { timeout: 120_000 }, () => {
    eraseDs18b20('TS')
    const b = new Bench(dsWorld({ pullUp: false }), 'hal-ds18b20')
    b.next(/1-Wire bus low: missing 4\.7k pull-up\?\r\n/, 3, 4)
    const dev = b.co.digitalDevice('TS')!
    expect(dev.telemetry!()!.values!.presences).toBe(0)
  })

  it('a pulled-up bus without a sensor: "no DS18B20 (no presence pulse)"', { timeout: 120_000 }, () => {
    const b = new Bench(dsWorld({ pullUp: true, sensor: false }), 'hal-ds18b20')
    b.next(/no DS18B20 \(no presence pulse\)\r\n/, 2, 3)
  })
})

// =================================================================== HC-SR04

function srWorld(echoPin: string, params: Record<string, number>) {
  const wd = new World()
  const s = wd.add({ id: 'US', type: 'hcsr04', at: 'f40', params })
  wd.w(below(s, 'VCC'), 'bot+5').w(below(s, 'GND'), 'top-5').w(below(s, 'TRIG'), tap('PB12')).w(below(s, 'ECHO'), tap(echoPin))
  return wd.layout()
}

const SR_LINE = /d=(\d+\.\d) cm \(echo (\d+) us\)\r\n/

describe('hal-hcsr04 on a Blue Pill + HC-SR04 (5 V, ECHO on the 5 V-tolerant PB6)', () => {
  it('measures the distance within 1 cm across 2–400 cm and the air temperature; beyond 4 m: out of range', { timeout: 300_000 }, () => {
    const layout = srWorld('PB6', { distance: 100, temperature: 20 })
    // ECHO into an FT pin: legal (info), never an error
    expect(runErc(layout).filter((f) => f.level === 'error')).toEqual([])
    const b = new Bench(layout, 'hal-hcsr04')
    let m = b.next(SR_LINE)
    expect(b.text.startsWith('HC-SR04: TRIG PB12, ECHO PB6 (TIM4 CH1/CH2 capture)\r\n')).toBe(true)
    expect(Math.abs(Number(m[1]) - 100)).toBeLessThanOrEqual(1)
    for (const [d, t] of [
      [2, 20],
      [23.4, 20],
      [250, 20],
      [399, 20],
      [150, -10],
      [150, 40],
    ]) {
      b.set('US', 'distance', d)
      b.set('US', 'temperature', t)
      b.next(SR_LINE)
      m = b.next(SR_LINE)
      // the firmware assumes 343 m/s: at 20 °C within 1 cm; other air temperatures shift it physically
      const expected = t === 20 ? d : (d * 343) / (331.3 * Math.sqrt(1 + t / 273.15))
      expect(Math.abs(Number(m[1]) - expected), `${d} cm at ${t} °C`).toBeLessThanOrEqual(1)
    }
    b.set('US', 'distance', 450)
    b.next(/out of range \(echo \d+ us\)\r\n/, 2)
    expect(b.errors()).toEqual([])
  })

  it('ECHO wired to the non-5 V-tolerant PA0: the ERC flags it and the run-time pin check warns', { timeout: 120_000 }, () => {
    const layout = srWorld('PA0', { distance: 50 })
    const erc = runErc(layout)
    const f = erc.find((x) => x.componentIds.includes('U1') && /PA0 is not 5 V tolerant/.test(x.message))
    expect(f, JSON.stringify(erc.map((x) => x.message))).toBeDefined()
    expect(f!.level).toBe('error')
    // run it: the firmware triggers on PB12, the 5 V echo lands on PA0
    const b = new Bench(layout, 'hal-hcsr04')
    b.next(/no echo/, 2)
    const issues = b.co.issues().map((i) => i.message)
    expect(issues.some((m) => /PA0/.test(m)), JSON.stringify(issues)).toBe(true)
  })
})

// =================================================================== KY-023 joystick

describe('hal-joystick on a Blue Pill + KY-023 (fed from 3.3 V)', () => {
  it('the two ADC channels follow the stick (≈ 2048 at rest, 0 / 4095 at the stops); SW reads the button', { timeout: 300_000 }, () => {
    const wd = new World()
    const s = wd.add({ id: 'JS', type: 'joystick_xy', at: 'f40' })
    wd.w(below(s, 'GND'), 'top-5').w(below(s, 'VCC'), 'top+5').w(below(s, 'VRX'), tap('PA0')).w(below(s, 'VRY'), tap('PA1')).w(below(s, 'SW'), tap('PB12'))
    const b = new Bench(wd.layout(), 'hal-joystick')
    const JS = /x=(\d+) y=(\d+) sw=(\d)\r\n/
    let m = b.next(JS, 2)
    expect(Math.abs(Number(m[1]) - 2048)).toBeLessThanOrEqual(3)
    expect(Math.abs(Number(m[2]) - 2048)).toBeLessThanOrEqual(3)
    expect(m[3]).toBe('0')
    for (const [x, y] of [
      [100, -100],
      [-50, 25],
      [10, 90],
    ]) {
      b.set('JS', 'x', x)
      b.set('JS', 'y', y)
      m = b.next(JS, 2)
      expect(Math.abs(Number(m[1]) - (0.5 + x / 200) * 4095), `x ${x}`).toBeLessThanOrEqual(3)
      expect(Math.abs(Number(m[2]) - (0.5 + y / 200) * 4095), `y ${y}`).toBeLessThanOrEqual(3)
    }
    b.set('JS', 'pressed', true)
    m = b.next(JS, 2)
    expect(m[3]).toBe('1')
  })
})

// =================================================================== ACS712

function acsWorld(r: number, reversed = false) {
  const wd = new World()
  const s = wd.add({ id: 'CS', type: 'acs712_5a', at: 'f40' })
  wd.add({ id: 'PS2', type: 'power_supply', params: { voltage: 0 } })
  wd.add({ id: 'RL', type: 'resistor', holes: ['i44', 'i47'], params: { resistance: r } })
  wd.w(below(s, 'VCC'), 'bot+5').w(below(s, 'GND'), 'top-5').w(below(s, 'OUT'), tap('PA0'))
  // load loop: PS2+ → IP+ (col 38) → sensor → IP− (col 44) → RL → col 47 → PS2−
  // reversed: PS2+ → col 47 → RL → IP− → sensor → IP+ → PS2−
  if (!reversed) wd.w('PS2:+', 'j38').w('PS2:-', 'j47')
  else wd.w('PS2:+', 'j47').w('PS2:-', 'j38')
  wd.w('PS2:-', 'top-7')
  return wd.layout()
}

describe('hal-acs712 on a Blue Pill + ACS712-05B in a load loop', () => {
  it('reports the load current within 15 mA (185 mV/A around 2.5 V), both directions', { timeout: 300_000 }, () => {
    const b = new Bench(acsWorld(4.7), 'hal-acs712')
    const I = /I=(-?\d+) mA \(out (\d+) mV\)(?: \(ADC full scale\))?\r\n/
    let m = b.next(I, 2)
    expect(Math.abs(Number(m[1]))).toBeLessThanOrEqual(15)
    expect(Math.abs(Number(m[2]) - 2500)).toBeLessThanOrEqual(3)
    for (const v of [1, 4.7, 9.4]) {
      b.set('PS2', 'voltage', v)
      b.next(I)
      m = b.next(I)
      const ima = (v / (4.7 + 0.0012 + 0.01)) * 1000 // load + primary + supply output resistance
      expect(Math.abs(Number(m[1]) - ima), `${v} V`).toBeLessThanOrEqual(15)
    }
    const r = new Bench(acsWorld(4.7, true), 'hal-acs712')
    r.set('PS2', 'voltage', 4.7)
    m = r.next(I, 3)
    expect(Math.abs(Number(m[1]) + 1000)).toBeLessThanOrEqual(15)
  })
})

// =================================================================== voltage sensor (with the stock hal-adc-pot firmware)

describe('voltage sensor module + hal-adc-pot', () => {
  it('S = VIN / 5: 12 V reads 2400 mV, 15 V reads 3000 mV', { timeout: 300_000 }, () => {
    const wd = new World()
    const s = wd.add({ id: 'VS', type: 'voltage_sensor', at: 'f40' })
    wd.add({ id: 'PS2', type: 'power_supply', params: { voltage: 12 } })
    wd.w(below(s, 'S'), tap('PA0')).w(below(s, 'GND'), 'top-5').w('PS2:+', 'j38').w('PS2:-', 'j44')
    const b = new Bench(wd.layout(), 'hal-adc-pot')
    const A = /adc=(\d+) mv=(\d+)\r\n/
    let m = b.next(A, 2)
    expect(Math.abs(Number(m[2]) - 2400)).toBeLessThanOrEqual(3)
    b.set('PS2', 'voltage', 15)
    b.next(A)
    m = b.next(A)
    expect(Math.abs(Number(m[2]) - 3000)).toBeLessThanOrEqual(3)
  })
})

// =================================================================== KY-040

describe('hal-ky040 on a Blue Pill + KY-040 (TIM4 encoder mode)', () => {
  it('turning the shaft counts detents both ways; the push switch is reported', { timeout: 300_000 }, () => {
    const wd = new World()
    const s = wd.add({ id: 'ENC', type: 'ky040_encoder', at: 'f40', params: { turnRate: 20 } })
    wd.w(below(s, 'VCC'), 'top+5').w(below(s, 'GND'), 'top-5').w(below(s, 'CLK'), tap('PB6')).w(below(s, 'DT'), tap('PB7')).w(below(s, 'SW'), tap('PB12'))
    const b = new Bench(wd.layout(), 'hal-ky040')
    b.run((t) => t.includes('pos=0\r\n'), 1)
    b.set('ENC', 'position', 3)
    b.next(/pos=3\r\n/, 1, 2)
    expect(b.text).toContain('pos=1\r\npos=2\r\npos=3\r\n')
    b.set('ENC', 'position', -2)
    b.next(/pos=-2\r\n/, 1, 2)
    expect(b.text).toContain('pos=3\r\npos=2\r\npos=1\r\npos=0\r\npos=-1\r\npos=-2\r\n')
    b.set('ENC', 'pressed', true)
    b.next(/SW pressed\r\n/)
    b.set('ENC', 'pressed', false)
    b.next(/SW released\r\n/)
  })
})

// =================================================================== VS1838B

describe('hal-ir-nec on a Blue Pill + VS1838B (virtual NEC remote)', () => {
  it('decodes the address / command of the selected key and the repeat codes while held', { timeout: 300_000 }, () => {
    const wd = new World()
    wd.add({ id: 'IR', type: 'ir_receiver_vs1838b', holes: ['f50', 'f51', 'f52'] })
    wd.w('j50', tap('PB12')).w('j51', 'top-5').w('j52', 'top+5')
    const b = new Bench(wd.layout(), 'hal-ir-nec')
    b.run((t) => t.includes('TIM2 1 MHz)\r\n'), 1)
    b.set('IR', 'remoteButton', 'CH-')
    b.next(/NEC addr=0x00 cmd=0x45\r\n/)
    b.set('IR', 'remoteButton', 'none')
    b.set('IR', 'address', 0x12)
    b.set('IR', 'hold', true)
    b.set('IR', 'remoteButton', 'VOL+')
    b.next(/NEC addr=0x12 cmd=0x15\r\n/)
    b.next(/NEC repeat\r\n/, 3)
    expect(b.text).not.toMatch(/frame error/)
  })
})

// =================================================================== A3144

describe('hal-hall on a Blue Pill + A3144 (5 V, open collector to the PB12 pull-up)', () => {
  it('reports the magnet with hysteresis; fed from 3.3 V the switch never operates', { timeout: 300_000 }, () => {
    const wd = new World()
    wd.add({ id: 'HS', type: 'hall_a3144', holes: ['f50', 'f51', 'f52'] })
    wd.w('j50', 'bot+5').w('j51', 'top-5').w('j52', tap('PB12'))
    const b = new Bench(wd.layout(), 'hal-hall')
    b.next(/no magnet \(OUT high\)\r\n/)
    b.set('HS', 'field', 20)
    b.next(/magnet \(OUT low\)\r\n/)
    b.set('HS', 'field', 12) // inside the hysteresis: still on
    b.run(() => false, b.co.time + 0.05)
    expect(b.text.endsWith('\r\nmagnet (OUT low)\r\n')).toBe(true)
    b.set('HS', 'field', 5)
    b.next(/no magnet \(OUT high\)\r\n/)
    // the same part fed from 3.3 V stays off whatever the field
    const wd2 = new World()
    wd2.add({ id: 'HS', type: 'hall_a3144', holes: ['f50', 'f51', 'f52'], params: { field: 50 } })
    wd2.w('j50', 'top+5').w('j51', 'top-5').w('j52', tap('PB12'))
    const b2 = new Bench(wd2.layout(), 'hal-hall')
    b2.run(() => false, 0.3)
    expect(b2.text).toBe('A3144 on PB12 (pull-up, EXTI12)\r\nno magnet (OUT high)\r\n')
  })
})
