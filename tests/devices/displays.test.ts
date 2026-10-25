/**
 * Display-module controller models (src/sim/models/displays-*.ts) against a
 * logic-level rig: named nets with optional pull-ups, device drives
 * (strong / weak / released), one external "master" driver per net and a
 * virtual-time event queue for the devices' own timers. Inputs are delivered
 * on every resolved level change (including those caused by the device's
 * own drive), like DigitalDeviceHost does.
 *
 * Every protocol is driven bit by bit through the pins: I²C (SSD1306,
 * SH1106, PCF8574 backpack), 4-wire SPI (SSD1306, ST7735S, ILI9341,
 * MAX7219), the HD44780 parallel bus, the WS2812B single wire and the
 * TM1637 two-wire bus.
 */
import { describe, expect, it } from 'vitest'
import type { DigitalDevice, DigitalDeviceCtx, DigitalDrive, LogicLevel } from '../../src/sim/digital/api'
import { registeredDigitalDevices } from '../../src/sim/digital/api'
import {
  HD_BLINK,
  HD_T_CLEAR,
  Hd44780ParallelDevice,
  ILI9341_PANEL,
  Lcd1602I2cDevice,
  Max7219Device,
  OledI2cDevice,
  OledSpiDevice,
  ST7735_PANEL,
  TftDevice,
  Tm1637Device,
  WS_T_RES,
  Ws2812StripDevice,
} from '../../src/sim/models/displays.model'
import { CATALOG, getEntry } from '../../src/model/catalog'
import { componentPinHoles } from '../../src/model/breadboard'
import type { DisplayTelemetry } from '../../src/model/types'

// ====================================================================== rig

interface DevSlot {
  device: DigitalDevice
  pins: Record<string, string>
  inputs: string[]
  drives: Map<string, DigitalDrive>
  delivered: Map<string, LogicLevel>
  issues: string[]
  logs: string[]
  supply: number
}

class Rig {
  t = 0
  private seq = 0
  private ev: { at: number; seq: number; id: number; fn: () => void }[] = []
  private nextId = 1
  private nets = new Map<string, { ext: 0 | 1 | null; pullUp: boolean; volts?: number }>()
  readonly devs: DevSlot[] = []
  /** resolved level history per net */
  readonly history = new Map<string, { t: number; level: LogicLevel }[]>()

  net(name: string, pullUp = false): void {
    this.nets.set(name, { ext: null, pullUp })
  }

  /** a net held at a fixed analog voltage (contrast pot wiper …) */
  analog(name: string, volts: number): void {
    this.nets.set(name, { ext: null, pullUp: false, volts })
  }

  add(device: DigitalDevice, pins: Record<string, string>, inputs: string[], supply = 5, id = 'U' + (this.devs.length + 1)): DevSlot {
    for (const n of Object.values(pins)) if (!this.nets.has(n)) this.net(n)
    const slot: DevSlot = { device, pins, inputs, drives: new Map(), delivered: new Map(), issues: [], logs: [], supply }
    this.devs.push(slot)
    const ctx: DigitalDeviceCtx = {
      componentId: id,
      now: () => this.t,
      read: (pin) => (pins[pin] ? this.level(pins[pin]) : null),
      voltage: (pin) => {
        if (!pins[pin]) return NaN
        const n = this.nets.get(pins[pin])
        if (n?.volts !== undefined) return n.volts
        const l = this.level(pins[pin])
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
    if (n.volts !== undefined) return n.volts > 2.5 ? 1 : 0
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
}

/** bit-banged I²C master on nets SCL/SDA (open drain), half period h */
class I2cMaster {
  constructor(
    private rig: Rig,
    readonly h = 1.25e-6,
  ) {}
  private scl(v: 0 | 1) {
    this.rig.set('SCL', v ? null : 0)
  }
  private sda(v: 0 | 1) {
    this.rig.set('SDA', v ? null : 0)
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
    const v = this.rig.level('SDA')
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
  /** START, address+W, bytes, STOP; returns per-byte ACKs (address first) */
  tx(addr: number, bytes: number[]): boolean[] {
    this.start()
    const acks = [this.write(addr << 1)]
    if (acks[0]) for (const b of bytes) acks.push(this.write(b))
    this.stop()
    return acks
  }
  rx(addr: number, n: number): number[] | null {
    this.start()
    if (!this.write((addr << 1) | 1)) {
      this.stop()
      return null
    }
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(this.read(i < n - 1))
    this.stop()
    return out
  }
}

/** bit-banged SPI master (mode 0) on SCK / MOSI with chip select and D/C nets */
class SpiMaster {
  constructor(
    private rig: Rig,
    private n: { sck: string; mosi: string; cs: string; dc?: string; miso?: string },
    readonly h = 50e-9,
  ) {
    rig.set(n.sck, 0)
    rig.set(n.cs, 1)
    if (n.dc) rig.set(n.dc, 0)
    rig.set(n.mosi, 0)
  }
  select(on: boolean): void {
    this.rig.set(this.n.cs, on ? 0 : 1)
    this.rig.run(this.h)
  }
  byte(b: number, bits = 8): number {
    let rx = 0
    for (let i = bits - 1; i >= 0; i--) {
      this.rig.set(this.n.mosi, ((b >> i) & 1) as 0 | 1)
      this.rig.run(this.h)
      this.rig.set(this.n.sck, 1)
      if (this.n.miso) rx = (rx << 1) | (this.rig.level(this.n.miso) === 1 ? 1 : 0)
      this.rig.run(this.h)
      this.rig.set(this.n.sck, 0)
    }
    return rx
  }
  cmd(c: number, ...data: number[]): void {
    this.select(true)
    if (this.n.dc) this.rig.set(this.n.dc, 0)
    this.byte(c)
    if (this.n.dc) this.rig.set(this.n.dc, 1)
    for (const d of data) this.byte(d)
    this.select(false)
  }
}

const pixel = (d: DisplayTelemetry, x: number, y: number): number => ((d.data![(y >> 3) * d.width + x] >> (y & 7)) & 1)
const litCount = (d: DisplayTelemetry): number => d.data!.reduce((n, b) => n + popcount(b), 0)
function popcount(b: number): number {
  let n = 0
  for (; b; b &= b - 1) n++
  return n
}

/** the common library init sequence (Adafruit SSD1306 128×64) */
const SSD1306_INIT = [0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40, 0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12, 0x81, 0xcf, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0x2e, 0xaf]

function oledI2cRig(kind: 'ssd1306' | 'sh1106' = 'ssd1306', address = 0x3c) {
  const rig = new Rig()
  rig.net('SCL', true)
  rig.net('SDA', true)
  const dev = new OledI2cDevice(kind, address)
  const slot = rig.add(dev, { SCL: 'SCL', SDA: 'SDA' }, ['SCL', 'SDA'], 5, 'OLED1')
  return { rig, dev, slot, m: new I2cMaster(rig) }
}

// ====================================================================== SSD1306

describe('SSD1306 I²C OLED', () => {
  it('acknowledges 0x3C only (the 0x3D jumper moves it); reads are not acknowledged', () => {
    const a = oledI2cRig()
    expect(a.m.tx(0x3c, [])).toEqual([true])
    expect(a.m.tx(0x3d, [])).toEqual([false])
    expect(a.m.rx(0x3c, 1)).toBeNull()
    const b = oledI2cRig('ssd1306', 0x3d)
    expect(b.m.tx(0x3c, [])).toEqual([false])
    expect(b.m.tx(0x3d, [])).toEqual([true])
  })

  it('library init + one horizontal-mode frame: RAM (page 0, column 0, bit 0) is the top-left pixel', () => {
    const { m, dev } = oledI2cRig()
    expect(m.tx(0x3c, [0x00, ...SSD1306_INIT]).every(Boolean)).toBe(true)
    const frame = new Array(1024).fill(0)
    frame[0] = 0x01 // (0, 0)
    frame[127] = 0x80 // page 0, col 127, bit 7 → (127, 7)
    frame[7 * 128 + 5] = 0x80 // page 7, col 5, bit 7 → (5, 63)
    m.tx(0x3c, [0x21, 0, 127].flatMap((b) => [0x80, b]))
    m.tx(0x3c, [0x40, ...frame])
    const d = dev.telemetry().display!
    expect(d.on).toBe(true)
    expect(d.format).toBe('mono-pages')
    expect(litCount(d)).toBe(3)
    expect(pixel(d, 0, 0)).toBe(1)
    expect(pixel(d, 127, 7)).toBe(1)
    expect(pixel(d, 5, 63)).toBe(1)
    expect(d.contrast).toBeCloseTo(0xd0 / 256, 5)
  })

  it('without the charge pump (8Dh 14h) the panel stays dark although GDDRAM holds the image', () => {
    const { m, dev } = oledI2cRig()
    const noPump = SSD1306_INIT.filter((_, i) => i !== 8 && i !== 9)
    m.tx(0x3c, [0x00, ...noPump])
    m.tx(0x3c, [0x40, ...new Array(1024).fill(0xff)])
    expect(dev.ctl.ram.every((b) => b === 0xff)).toBe(true)
    const d = dev.telemetry().display!
    expect(d.on).toBe(false)
    expect(litCount(d)).toBe(0)
    // enabling the pump lights the stored image
    m.tx(0x3c, [0x00, 0x8d, 0x14])
    const d2 = dev.telemetry().display!
    expect(d2.on).toBe(true)
    expect(litCount(d2)).toBe(128 * 64)
    expect(d2.version).toBeGreaterThan(d.version)
  })

  it('reset orientation (A0h / C0h) shows the image rotated 180°; DAh 02h interleaves the rows', () => {
    const { m, dev } = oledI2cRig()
    const init = SSD1306_INIT.map((b) => (b === 0xa1 ? 0xa0 : b === 0xc8 ? 0xc0 : b))
    m.tx(0x3c, [0x00, ...init])
    const frame = new Array(1024).fill(0)
    frame[0] = 0x01
    m.tx(0x3c, [0x40, ...frame])
    expect(pixel(dev.telemetry().display!, 127, 63)).toBe(1)
    // sequential COM pins on the alternative-wired 128×64 glass: RAM row 1 lands two rows down
    m.tx(0x3c, [0x00, 0xa1, 0xc8, 0xda, 0x02])
    frame[0] = 0x02 // RAM row 1
    m.tx(0x3c, [0x00, 0x21, 0, 127, 0x22, 0, 7])
    m.tx(0x3c, [0x40, ...frame])
    const d = dev.telemetry().display!
    expect(litCount(d)).toBe(1)
    expect(pixel(d, 0, 1)).toBe(0)
    expect(pixel(d, 0, 2)).toBe(1)
  })

  it('page and vertical addressing, inverse and entire-display-on', () => {
    const { m, dev } = oledI2cRig()
    m.tx(0x3c, [0x00, ...SSD1306_INIT])
    m.tx(0x3c, [0x40, ...new Array(1024).fill(0)])
    // page mode: page 3, column 0x25
    m.tx(0x3c, [0x00, 0x20, 0x02, 0xb3, 0x05, 0x12])
    m.tx(0x3c, [0x40, 0xff, 0x01])
    expect(dev.ctl.ram[3 * 128 + 0x25]).toBe(0xff)
    expect(dev.ctl.ram[3 * 128 + 0x26]).toBe(0x01)
    // vertical mode: column 10..11, pages 6..7 → page advances first
    m.tx(0x3c, [0x00, 0x20, 0x01, 0x21, 10, 11, 0x22, 6, 7])
    m.tx(0x3c, [0x40, 0xa1, 0xa2, 0xa3])
    expect([dev.ctl.ram[6 * 128 + 10], dev.ctl.ram[7 * 128 + 10], dev.ctl.ram[6 * 128 + 11]]).toEqual([0xa1, 0xa2, 0xa3])
    const lit = litCount(dev.telemetry().display!)
    m.tx(0x3c, [0x00, 0xa7])
    expect(litCount(dev.telemetry().display!)).toBe(128 * 64 - lit)
    m.tx(0x3c, [0x00, 0xa6, 0xa5])
    expect(litCount(dev.telemetry().display!)).toBe(128 * 64)
    m.tx(0x3c, [0x00, 0xae])
    expect(dev.telemetry().display!.on).toBe(false)
  })

  it('Co = 1 control bytes interleave single commands and data in one transfer', () => {
    const { m, dev } = oledI2cRig()
    m.tx(0x3c, [0x00, ...SSD1306_INIT])
    m.tx(0x3c, [0x80, 0xb2, 0x80, 0x00, 0x80, 0x10, 0xc0, 0x5a, 0xc0, 0xa5])
    // page mode was set? init chose horizontal; B2h only works in page mode
    m.tx(0x3c, [0x80, 0x20, 0x80, 0x02, 0x80, 0xb2, 0x80, 0x03, 0x80, 0x10, 0xc0, 0x5a])
    expect(dev.ctl.ram[2 * 128 + 3]).toBe(0x5a)
  })

  it('power-up GDDRAM is random (not blank), and horizontal scroll rotates the RAM one column per step', () => {
    const { m, dev, rig } = oledI2cRig()
    const ones = Array.from(dev.ctl.ram).filter((b) => b !== 0).length
    expect(ones).toBeGreaterThan(500)
    m.tx(0x3c, [0x00, ...SSD1306_INIT])
    const frame = new Array(1024).fill(0)
    frame[0] = 0xff
    m.tx(0x3c, [0x40, ...frame])
    // right scroll pages 0..0, 5 frames per step
    m.tx(0x3c, [0x00, 0x26, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x2f])
    const step = 5 * dev.ctl.framePeriod()
    expect(step).toBeGreaterThan(0.03)
    expect(step).toBeLessThan(0.07)
    rig.run(step * 3 + step / 2)
    expect(dev.ctl.ram[3]).toBe(0xff)
    expect(dev.ctl.ram[0]).toBe(0)
    m.tx(0x3c, [0x00, 0x2e])
    rig.run(step * 4)
    expect(dev.ctl.ram[3]).toBe(0xff)
  })
})

// ====================================================================== SH1106

describe('SH1106 I²C OLED', () => {
  it('page addressing over 132 columns: column 2 is the leftmost visible pixel; DC-DC on after reset', () => {
    const { m, dev } = oledI2cRig('sh1106')
    // u8g2-style SH1106 init (no 8Dh), then page 0 written from column 2
    m.tx(0x3c, [0x00, 0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40, 0xad, 0x8b, 0xa1, 0xc8, 0xda, 0x12, 0x81, 0xcf, 0xa4, 0xa6, 0xaf])
    for (let p = 0; p < 8; p++) {
      m.tx(0x3c, [0x00, 0xb0 + p, 0x02, 0x10])
      m.tx(0x3c, [0x40, ...new Array(128).fill(0).map((_, i) => (p === 0 && i === 0 ? 1 : 0))])
    }
    const d = dev.telemetry().display!
    expect(d.on).toBe(true)
    expect(litCount(d)).toBe(1)
    expect(pixel(d, 0, 0)).toBe(1)
  })

  it('an SSD1306 driver (horizontal mode, 21h/22h windows, 8Dh) garbles an SH1106: data pile up on page 0, start line 63', () => {
    const { m, dev, slot } = oledI2cRig('sh1106')
    const before = dev.ctl.ram.slice(128 * 3, 128 * 4)
    m.tx(0x3c, [0x00, ...SSD1306_INIT])
    m.tx(0x3c, [0x00, 0x21, 0x00, 0x7f, 0x22, 0x00, 0x07])
    m.tx(0x3c, [0x40, ...new Array(1024).fill(0xaa)])
    expect(dev.ctl.startLine).toBe(63)
    // every byte went to page 0 (the column wraps at 131); page 3 still holds power-up noise
    expect(dev.ctl.ram.slice(0, 132).every((b) => b === 0xaa)).toBe(true)
    expect(Array.from(dev.ctl.ram.slice(128 * 3, 128 * 4))).toEqual(Array.from(before))
    expect(slot.logs.some((l) => /SH1106 ignored unknown command byte 0x20/.test(l))).toBe(true)
  })
})

// ====================================================================== SSD1306 SPI

describe('SSD1306 4-wire SPI OLED', () => {
  function spiRig() {
    const rig = new Rig()
    const dev = new OledSpiDevice('ssd1306')
    const pins = { D0: 'SCK', D1: 'MOSI', RES: 'RES', DC: 'DC', CS: 'CS' }
    rig.net('RES')
    rig.set('RES', 1)
    const slot = rig.add(dev, pins, ['D0', 'D1', 'RES', 'DC', 'CS'], 3.3, 'OLED2')
    const spi = new SpiMaster(rig, { sck: 'SCK', mosi: 'MOSI', cs: 'CS', dc: 'DC' })
    return { rig, dev, slot, spi }
  }

  it('commands with DC low, GDDRAM with DC high; CS high resets the bit counter', () => {
    const { rig, dev, spi } = spiRig()
    spi.cmd(SSD1306_INIT[0])
    for (const b of SSD1306_INIT.slice(1)) spi.cmd(b)
    expect(dev.ctl.displayOn).toBe(true)
    expect(dev.ctl.pump).toBe(true)
    // half a byte, then CS high: discarded
    spi.select(true)
    rig.set('DC', 1)
    spi.byte(0xf, 4)
    spi.select(false)
    spi.select(true)
    spi.byte(0x81)
    spi.select(false)
    expect(dev.ctl.ram[0]).toBe(0x81)
    expect(pixel(dev.telemetry().display!, 0, 0)).toBe(1)
  })

  it('RES low resets the registers but keeps GDDRAM', () => {
    const { rig, dev, spi } = spiRig()
    for (const b of SSD1306_INIT) spi.cmd(b)
    spi.select(true)
    rig.set('DC', 1)
    spi.byte(0x3c)
    spi.select(false)
    rig.set('RES', 0)
    rig.run(5e-6)
    rig.set('RES', 1)
    expect(dev.ctl.displayOn).toBe(false)
    expect(dev.ctl.pump).toBe(false)
    expect(dev.ctl.ram[0]).toBe(0x3c)
  })
})

// ====================================================================== HD44780

const LCD_PINS = { RS: 'RS', RW: 'RW', E: 'E', D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4', D5: 'D5', D6: 'D6', D7: 'D7', V0: 'V0', VSS: 'VSS' }
const LCD_INPUTS = ['RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']

class LcdBus {
  constructor(
    private rig: Rig,
    private four = true,
  ) {}
  private put(v: number, bits: string[]) {
    bits.forEach((pin, i) => this.rig.set(pin, ((v >> i) & 1) as 0 | 1))
  }
  /** one E pulse writing `nibbleOrByte` (4-bit: D4–D7) */
  pulse(rs: 0 | 1, v: number, ew = 500e-9): void {
    this.rig.set('RS', rs)
    this.rig.set('RW', 0)
    if (this.four) this.put(v & 0x0f, ['D4', 'D5', 'D6', 'D7'])
    else this.put(v & 0xff, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'])
    this.rig.run(100e-9)
    this.rig.set('E', 1)
    this.rig.run(ew)
    this.rig.set('E', 0)
    this.rig.run(100e-9)
  }
  write(rs: 0 | 1, b: number, wait = 50e-6): void {
    if (this.four) {
      this.pulse(rs, b >> 4)
      this.pulse(rs, b & 0x0f)
    } else this.pulse(rs, b)
    this.rig.run(wait)
  }
  text(s: string): void {
    for (const ch of s) this.write(1, ch.charCodeAt(0))
  }
  /** read BF + AC (4-bit: two E pulses, data lines released by the master) */
  readStatus(): number {
    const pins = this.four ? ['D4', 'D5', 'D6', 'D7'] : ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
    for (const p of pins) this.rig.set(p, null)
    this.rig.set('RS', 0)
    this.rig.set('RW', 1)
    let v = 0
    const pulses = this.four ? 2 : 1
    for (let k = 0; k < pulses; k++) {
      this.rig.run(100e-9)
      this.rig.set('E', 1)
      this.rig.run(500e-9)
      let n = 0
      pins.forEach((p, i) => (n |= (this.rig.level(p) === 1 ? 1 : 0) << i))
      v = this.four ? (v << 4) | n : n
      this.rig.set('E', 0)
    }
    this.rig.set('RW', 0)
    this.rig.run(100e-9)
    return v
  }
  /** datasheet 4-bit initialization by instruction */
  init4(): void {
    this.rig.run(50e-3)
    this.pulse(0, 0x3)
    this.rig.run(4.5e-3)
    this.pulse(0, 0x3)
    this.rig.run(150e-6)
    this.pulse(0, 0x3)
    this.rig.run(150e-6)
    this.pulse(0, 0x2)
    this.rig.run(150e-6)
    this.write(0, 0x28)
    this.write(0, 0x08)
    this.write(0, 0x01, 2e-3)
    this.write(0, 0x06)
    this.write(0, 0x0c)
  }
}

function lcdRig(rows = 2, opts: { v0?: number; rwFloating?: boolean } = {}) {
  const rig = new Rig()
  for (const n of ['RS', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) rig.net(n)
  rig.net('RW')
  rig.analog('VSS', 0)
  if (opts.v0 !== undefined) rig.analog('V0', opts.v0)
  const pins: Record<string, string> = { ...LCD_PINS }
  if (opts.v0 === undefined) delete pins.V0
  const dev = new Hd44780ParallelDevice(rows === 4 ? { cols: 20, rows: 4 } : { cols: 16, rows: 2 })
  rig.set('E', 0)
  if (!opts.rwFloating) rig.set('RW', 0)
  const slot = rig.add(dev, pins, LCD_INPUTS, 5, 'LCD1')
  return { rig, dev, slot, bus: new LcdBus(rig) }
}

describe('HD44780 character LCD (parallel)', () => {
  it('power-up: BF = 1 for 10 ms — a write at 1 ms is ignored and reported; 1-line mode shows the row-1 boxes', () => {
    const { rig, dev, slot, bus } = lcdRig(2, { v0: 0.6 })
    rig.run(1e-3)
    bus.write(0, 0x01)
    expect(dev.lcd.writes).toBe(0)
    expect(slot.issues.some((i) => /ignored an instruction write while busy/.test(i))).toBe(true)
    const t = dev.telemetry()
    expect(t.values!.lines).toBe(1)
    expect(t.values!.ghostRow1).toBeGreaterThan(0.6)
    expect(t.display!.on).toBe(false)
  })

  it('4-bit initialization by instruction, then text, CGRAM glyph and DDRAM line 2', () => {
    const { dev, bus } = lcdRig(2, { v0: 0.6 })
    bus.init4()
    expect(dev.lcd.dl).toBe(0)
    expect(dev.lcd.n).toBe(1)
    // custom character 0: a heart
    const heart = [0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00, 0x00]
    bus.write(0, 0x40)
    for (const r of heart) bus.write(1, r)
    bus.write(0, 0x80)
    bus.text('Hello, ohmlet!')
    bus.write(0, 0xc0)
    bus.write(1, 0x00)
    bus.text(' 42')
    const t = dev.telemetry()
    const d = t.display!
    expect(d.format).toBe('chars')
    expect(d.on).toBe(true)
    expect(d.text![0]).toBe('Hello, ohmlet!  ')
    expect(d.text![1]).toBe('\u0000 42            ')
    expect(Array.from(d.data!.slice(0, 8))).toEqual(heart)
    expect(d.contrast).toBeGreaterThan(0.9)
    expect(t.values!.ghostRow1).toBe(0)
  })

  it('busy flag + address counter read in 4-bit mode: BF = 1 right after clear, 0 after 1.52 ms', () => {
    const { rig, bus } = lcdRig(2, { v0: 0.6 })
    bus.init4()
    bus.write(0, 0x80 | 0x05)
    expect(bus.readStatus()).toBe(0x05)
    bus.write(0, 0x01, 0)
    expect(bus.readStatus() & 0x80).toBe(0x80)
    rig.run(HD_T_CLEAR)
    expect(bus.readStatus()).toBe(0x00)
  })

  it('8-bit interface: entry mode decrement, cursor / display shift and the visible window', () => {
    const { rig, dev } = lcdRig(2, { v0: 0.6 })
    const bus = new LcdBus(rig, false)
    rig.run(20e-3)
    bus.write(0, 0x38)
    bus.write(0, 0x0f)
    bus.write(0, 0x01, 2e-3)
    bus.write(0, 0x06)
    bus.text('ABC')
    bus.write(0, 0x18) // shift display left
    expect(dev.telemetry().display!.text![0].slice(0, 3)).toBe('BC ')
    bus.write(0, 0x1c) // and back
    bus.write(0, 0x04) // decrement
    bus.write(0, 0x80 | 0x0f)
    bus.text('xy')
    const d = dev.telemetry()
    expect(d.display!.text![0]).toBe('ABC           yx')
    expect(d.values!.cursorCol).toBe(13)
    expect(d.values!.cursor).toBe(1)
    expect(d.values!.blink).toBe(1)
    rig.run(HD_BLINK)
    expect(dev.telemetry().values!.blinkPhase).not.toBe(d.values!.blinkPhase)
  })

  it('R/W left open floats high (internal pull-up): every "write" is a read, nothing is stored', () => {
    const { rig, dev } = lcdRig(2, { v0: 0.6, rwFloating: true })
    rig.run(20e-3)
    // the master drives RS/E/data only — RW unconnected
    const put = (v: number) => ['D4', 'D5', 'D6', 'D7'].forEach((p, i) => rig.set(p, ((v >> i) & 1) as 0 | 1))
    for (const nib of [0x3, 0x3, 0x3, 0x2, 0x2, 0x8, 0x0, 0xc]) {
      rig.set('RS', 0)
      put(nib)
      rig.set('E', 1)
      rig.run(1e-6)
      rig.set('E', 0)
      rig.run(100e-6)
    }
    expect(dev.lcd.writes).toBe(0)
    expect(dev.lcd.dl).toBe(1)
    expect(dev.lcd.n).toBe(0)
    expect(dev.telemetry().values!.ghostRow1).toBeGreaterThan(0.6)
  })

  it('contrast follows V_LCD = VDD − V0: invisible at V0 = 2.5 V and with V0 unconnected (hint logged)', () => {
    const a = lcdRig(2, { v0: 2.5 })
    a.bus.init4()
    expect(a.dev.telemetry().display!.contrast).toBe(0)
    const b = lcdRig(2)
    b.bus.init4()
    expect(b.dev.telemetry().display!.contrast).toBe(0)
    expect(b.slot.logs.some((l) => /LCD contrast: V_LCD = VDD − V0 = \? V is too low/.test(l))).toBe(true)
  })

  it('LCD2004: rows 0–3 show DDRAM 00h, 40h, 14h, 54h', () => {
    const { dev, bus } = lcdRig(4, { v0: 0.6 })
    bus.init4()
    for (const [addr, s] of [
      [0x00, 'row0'],
      [0x40, 'row1'],
      [0x14, 'row2'],
      [0x54, 'row3'],
    ] as const) {
      bus.write(0, 0x80 | addr)
      bus.text(s)
    }
    const rows = dev.telemetry().display!.text!
    expect(rows.map((r) => r.slice(0, 4))).toEqual(['row0', 'row1', 'row2', 'row3'])
    expect(rows[0]).toHaveLength(20)
  })
})

// ====================================================================== PCF8574 backpack

describe('LCD1602 + PCF8574 I²C backpack', () => {
  function backpackRig(address = 0x27) {
    const rig = new Rig()
    rig.net('SCL', true)
    rig.net('SDA', true)
    const dev = new Lcd1602I2cDevice({ cols: 16, rows: 2 }, address, 0.85)
    const slot = rig.add(dev, { SCL: 'SCL', SDA: 'SDA' }, ['SCL', 'SDA'], 5, 'LCD2')
    return { rig, dev, slot, m: new I2cMaster(rig, 5e-6) }
  }
  const BL = 0x08
  /** one nibble with E pulsed high then low (LiquidCrystal_I2C style) */
  const nib = (n: number, rs: number) => [(n << 4) | BL | rs | 0x04, (n << 4) | BL | rs]
  const byte = (b: number, rs: number) => [...nib(b >> 4, rs), ...nib(b & 15, rs)]

  it('0x27 acknowledges (0x3F does not); the port powers up at FFh (backlight on)', () => {
    const { m, dev } = backpackRig()
    expect(m.tx(0x3f, [])).toEqual([false])
    expect(m.tx(0x27, [])).toEqual([true])
    expect(dev.latch).toBe(0xff)
    expect(dev.telemetry().display!.backlight).toBe(1)
    const b = backpackRig(0x3f)
    expect(b.m.tx(0x27, [])).toEqual([false])
  })

  it('4-bit init and text through the expander; P3 switches the backlight; BF read back through the port', () => {
    const { rig, m, dev } = backpackRig()
    rig.run(50e-3)
    m.tx(0x27, [BL])
    for (const n of [3, 3, 3, 2]) {
      m.tx(0x27, nib(n, 0))
      rig.run(5e-3)
    }
    for (const c of [0x28, 0x0c, 0x01, 0x06]) {
      m.tx(0x27, byte(c, 0))
      rig.run(2e-3)
    }
    m.tx(0x27, [...'Hi I2C'].flatMap((ch) => byte(ch.charCodeAt(0), 1)))
    rig.run(1e-3)
    const t = dev.telemetry()
    expect(t.display!.text![0]).toBe('Hi I2C          ')
    expect(t.display!.on).toBe(true)
    // busy-flag read: D4–D7 high (quasi inputs), RW = 1, E = 1 → read the port
    m.tx(0x27, [0xf0 | BL | 0x02 | 0x04])
    const port = m.rx(0x27, 1)!
    expect(port[0] & 0x80).toBe(0) // BF = 0
    expect((port[0] >> 4) & 0x07).toBe(0) // AC[6:4] of address 06h
    m.tx(0x27, [0xf0 | BL | 0x02])
    m.tx(0x27, [0x00])
    expect(dev.telemetry().display!.backlight).toBe(0)
  })
})

// ====================================================================== TFT

function tftRig(panel = ST7735_PANEL) {
  const rig = new Rig()
  const p = panel.pins
  const pins: Record<string, string> = { [p.sck]: 'SCK', [p.sda]: 'MOSI', [p.dc]: 'DC', [p.cs]: 'CS', [p.res]: 'RES', [p.bl]: 'BL' }
  if (p.sdo) pins[p.sdo] = 'MISO'
  rig.net('RES')
  rig.set('RES', 1)
  rig.net('BL')
  rig.set('BL', 1)
  const dev = new TftDevice(panel)
  const slot = rig.add(dev, pins, [p.sck, p.sda, p.dc, p.cs, p.res, p.bl], 3.3, 'TFT1')
  const spi = new SpiMaster(rig, { sck: 'SCK', mosi: 'MOSI', cs: 'CS', dc: 'DC', miso: p.sdo ? 'MISO' : undefined }, 20e-9)
  return { rig, dev, slot, spi }
}

const rgb565 = (d: DisplayTelemetry, x: number, y: number) => d.data![(y * d.width + x) * 2] | (d.data![(y * d.width + x) * 2 + 1] << 8)

function tftInit(rig: Rig, spi: SpiMaster, madctl: number, colmod = 0x05) {
  spi.cmd(0x01)
  rig.run(6e-3)
  spi.cmd(0x11)
  spi.cmd(0x3a, colmod)
  spi.cmd(0x36, madctl)
  spi.cmd(0x29)
}

function fillRect(spi: SpiMaster, x0: number, y0: number, x1: number, y1: number, color: number) {
  spi.cmd(0x2a, x0 >> 8, x0 & 0xff, x1 >> 8, x1 & 0xff)
  spi.cmd(0x2b, y0 >> 8, y0 & 0xff, y1 >> 8, y1 & 0xff)
  const n = (x1 - x0 + 1) * (y1 - y0 + 1)
  const px: number[] = []
  for (let i = 0; i < n; i++) px.push(color >> 8, color & 0xff)
  spi.cmd(0x2c, ...px)
}

describe('ST7735S 1.8" TFT', () => {
  it('MADCTL C0h (black tab): window (0,0)… is the top-left of the upright glass, colours RGB565', () => {
    const { rig, dev, spi } = tftRig()
    tftInit(rig, spi, 0xc0)
    fillRect(spi, 0, 0, 1, 1, 0xf800)
    fillRect(spi, 126, 158, 127, 159, 0x001f)
    const d = dev.telemetry().display!
    expect(d.on).toBe(true)
    expect(d.format).toBe('rgb565')
    expect([d.width, d.height]).toEqual([128, 160])
    expect(rgb565(d, 0, 0)).toBe(0xf800)
    expect(rgb565(d, 1, 1)).toBe(0xf800)
    expect(rgb565(d, 127, 159)).toBe(0x001f)
    expect(dev.tft.pixelsWritten).toBe(8)
  })

  it('BGR bit on an RGB glass swaps red and blue; MADCTL 00h mirrors both axes; INVON inverts', () => {
    const { rig, dev, spi } = tftRig()
    tftInit(rig, spi, 0xc8)
    fillRect(spi, 0, 0, 0, 0, 0xf800)
    let d = dev.telemetry().display!
    expect(rgb565(d, 0, 0)).toBe(0x001f)
    spi.cmd(0x36, 0x00)
    fillRect(spi, 0, 0, 0, 0, 0x07e0)
    rig.run(0.05)
    d = dev.telemetry().display!
    expect(rgb565(d, 127, 159)).toBe(0x07e0)
    spi.cmd(0x21)
    rig.run(0.05)
    expect(rgb565(dev.telemetry().display!, 127, 159)).toBe(0xffff ^ 0x07e0)
  })

  it('COLMOD left at its 18-bit reset value misreads 16-bit pixel data (3 bytes per pixel)', () => {
    const { rig, dev, spi } = tftRig()
    spi.cmd(0x01)
    rig.run(6e-3)
    spi.cmd(0x11)
    spi.cmd(0x36, 0xc0)
    spi.cmd(0x29)
    fillRect(spi, 0, 0, 2, 0, 0xf800) // 6 bytes = 2 pixels in 18-bit mode
    expect(dev.tft.pixelsWritten).toBe(2)
    const d = dev.telemetry().display!
    expect(rgb565(d, 0, 0)).not.toBe(0xf800)
  })

  it('commands within 5 ms of SWRESET are ignored (logged); sleep / display off shows the white backlight state', () => {
    const { rig, dev, slot, spi } = tftRig()
    spi.cmd(0x01)
    spi.cmd(0x11)
    expect(dev.tft.sleep).toBe(true)
    expect(slot.logs.some((l) => /within 5 ms of a reset/.test(l))).toBe(true)
    rig.run(6e-3)
    spi.cmd(0x11)
    spi.cmd(0x29)
    expect(dev.telemetry().display!.on).toBe(true)
    spi.cmd(0x28)
    rig.run(0.05)
    expect(dev.telemetry().display!.on).toBe(false)
  })

  it('backlight = duty cycle of BL (PWM)', () => {
    const { rig, dev } = tftRig()
    dev.telemetry()
    for (let i = 0; i < 50; i++) {
      rig.set('BL', 1)
      rig.run(250e-6)
      rig.set('BL', 0)
      rig.run(750e-6)
    }
    expect(dev.telemetry().display!.backlight).toBeCloseTo(0.25, 1)
  })
})

describe('ILI9341 2.4" TFT', () => {
  it('RDID4 (D3h) reads 00 93 41 on SDO after a dummy byte', () => {
    const { rig, spi } = tftRig(ILI9341_PANEL)
    rig.run(6e-3)
    spi.select(true)
    rig.set('DC', 0)
    spi.byte(0xd3)
    rig.set('DC', 1)
    const id = [spi.byte(0), spi.byte(0), spi.byte(0), spi.byte(0)]
    spi.select(false)
    expect(id).toEqual([0x00, 0x00, 0x93, 0x41])
  })

  it('MADCTL 48h (MX, BGR) is upright portrait with correct colours; 28h (MV, BGR) turns it to landscape', () => {
    const { rig, dev, spi } = tftRig(ILI9341_PANEL)
    tftInit(rig, spi, 0x48)
    fillRect(spi, 0, 0, 0, 0, 0xf800)
    let d = dev.telemetry().display!
    expect([d.width, d.height]).toEqual([240, 320])
    expect(rgb565(d, 0, 0)).toBe(0xf800)
    spi.cmd(0x36, 0x28)
    fillRect(spi, 319, 0, 319, 0, 0x07e0) // landscape: column 319, row 0
    rig.run(0.05)
    d = dev.telemetry().display!
    // MV: x = row 0, y = col 319 → glass mirrorX: screen (239, 319)
    expect(rgb565(d, 239, 319)).toBe(0x07e0)
  })
})

// ====================================================================== MAX7219

describe('MAX7219 8×8 matrix', () => {
  function maxRig() {
    const rig = new Rig()
    const dev = new Max7219Device()
    rig.net('CS')
    rig.set('CS', 1)
    const slot = rig.add(dev, { DIN: 'DIN', CS: 'CS', CLK: 'CLK' }, ['DIN', 'CS', 'CLK'], 5, 'MX1')
    const spi = new SpiMaster(rig, { sck: 'CLK', mosi: 'DIN', cs: 'CS' }, 100e-9)
    const send = (addr: number, data: number) => {
      spi.select(true)
      spi.byte((addr << 8) | data, 16)
      spi.select(false)
    }
    return { rig, dev, slot, send }
  }

  it('power-up is shutdown (dark); configured, rows show the digit registers (bit 7 = left column)', () => {
    const { dev, send } = maxRig()
    expect(dev.telemetry().display!.on).toBe(false)
    send(0x0f, 0)
    send(0x09, 0)
    send(0x0b, 7)
    send(0x0a, 8)
    for (let r = 0; r < 8; r++) send(r + 1, 0)
    send(0x0c, 1)
    send(0x01, 0b10000001) // row 0: leftmost + rightmost
    send(0x08, 0b00011000) // row 7: the two middle columns
    const d = dev.telemetry().display!
    expect(d.on).toBe(true)
    expect([d.width, d.height]).toEqual([8, 8])
    expect(pixel(d, 0, 0)).toBe(1)
    expect(pixel(d, 7, 0)).toBe(1)
    expect(pixel(d, 3, 7) + pixel(d, 4, 7)).toBe(2)
    expect(litCount(d)).toBe(4)
    expect(d.contrast).toBeCloseTo(17 / 31, 3)
  })

  it('scan limit blanks the rows beyond it (and brightens the rest); Code-B decode; display test overrides shutdown', () => {
    const { dev, send } = maxRig()
    send(0x0c, 1)
    send(0x0a, 15)
    send(0x0b, 1)
    send(0x09, 0x01)
    send(0x01, 0x08) // decode: '8' = all segments a–g
    send(0x02, 0x80)
    send(0x03, 0xff) // row 2 not scanned
    let d = dev.telemetry().display!
    expect(litCount(d)).toBe(7 + 1)
    expect(d.contrast).toBeCloseTo(2, 3)
    send(0x0c, 0)
    send(0x0f, 1)
    d = dev.telemetry().display!
    expect(d.on).toBe(true)
    expect(litCount(d)).toBe(64)
  })

  it('no latch without a LOAD (CS) rising edge', () => {
    const { rig, dev } = maxRig()
    const spi = new SpiMaster(rig, { sck: 'CLK', mosi: 'DIN', cs: 'CS' }, 100e-9)
    spi.byte(0x0c01, 16)
    expect(dev.latches).toBe(0)
    expect(dev.shutdown).toBe(true)
  })
})

// ====================================================================== WS2812B

/** drive DIN with a WS2812 bit stream: per bit high t1/t0, period T */
function wsSend(rig: Rig, bytes: number[], t: { t0h: number; t1h: number; period: number }) {
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      const one = (b >> i) & 1
      const h = one ? t.t1h : t.t0h
      rig.set('DIN', 1)
      rig.run(h)
      rig.set('DIN', 0)
      rig.run(t.period - h)
    }
  }
}
const SPI_TIMING = { t0h: 1 / 2.25e6, t1h: 2 / 2.25e6, period: 3 / 2.25e6 }

describe('WS2812B strip', () => {
  function wsRig(supply = 4.5) {
    const rig = new Rig()
    rig.net('DIN')
    rig.set('DIN', 0)
    const dev = new Ws2812StripDevice(8)
    const slot = rig.add(dev, { DIN: 'DIN', DOUT: 'DOUT' }, ['DIN'], supply, 'LED1')
    return { rig, dev, slot }
  }

  it('GRB bytes at SPI-encoded timing (0.44 / 0.89 µs highs) latch after ≥ 280 µs low', () => {
    const { rig, dev } = wsRig()
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0x800000, 0x000080, 0x010203, 0xffffff]
    const grb = colors.flatMap((c) => [(c >> 8) & 0xff, (c >> 16) & 0xff, c & 0xff])
    wsSend(rig, grb, SPI_TIMING)
    expect(dev.telemetry().rgb).toEqual(new Array(8).fill(0)) // not latched yet
    rig.run(WS_T_RES * 0.9)
    expect(dev.telemetry().rgb![0]).toBe(0)
    rig.run(WS_T_RES * 0.2)
    expect(dev.telemetry().rgb).toEqual(colors)
    expect(dev.frames).toBe(1)
  })

  it('bits after the 8th LED are regenerated on DOUT', () => {
    const { rig, dev } = wsRig()
    wsSend(rig, new Array(24).fill(0), SPI_TIMING)
    wsSend(rig, [0b10100000], SPI_TIMING)
    rig.run(1e-6)
    expect(dev.forwarded).toBe(8)
    const h = rig.history.get('DOUT')!.filter((e) => e.level === 1)
    expect(h.length).toBe(8)
  })

  it('out-of-spec timing is misread like the chip does: 4.5 MHz SPI encoding (0.22 / 0.44 µs) reads every bit as 0 (+ log hint)', () => {
    const { rig, dev, slot } = wsRig()
    wsSend(rig, new Array(24).fill(0xaa), { t0h: 1 / 4.5e6, t1h: 2 / 4.5e6, period: 3 / 4.5e6 })
    rig.run(WS_T_RES * 1.1)
    expect(dev.telemetry().rgb).toEqual(new Array(8).fill(0))
    expect(slot.logs.some((l) => /outside T0H .* read as 0/.test(l))).toBe(true)
  })

  it('3.3 V data on a 5 V strip is below VIH = 0.7·VDD: reported in the log', () => {
    const rig = new Rig()
    rig.analog('DIN3V3', 3.3)
    const dev = new Ws2812StripDevice(8)
    const slot = rig.add(dev, { DIN: 'DIN3V3', DOUT: 'DOUT' }, ['DIN'], 5, 'LED2')
    // a fixed 3.3 V net never toggles in the rig: deliver one low → high edge by hand
    dev.onPinChange?.('DIN', 0)
    dev.onPinChange?.('DIN', 1)
    expect(slot.logs.some((l) => /DIN high is 3\.30 V, below V_IH = 0\.7·VDD = 3\.50 V/.test(l))).toBe(true)
  })
})

// ====================================================================== TM1637

describe('TM1637 4-digit display', () => {
  function tmRig() {
    const rig = new Rig()
    rig.net('CLK', true)
    rig.net('DIO', true)
    const dev = new Tm1637Device()
    const slot = rig.add(dev, { CLK: 'CLK', DIO: 'DIO' }, ['CLK', 'DIO'], 5, 'TM1')
    const h = 5e-6
    const clk = (v: 0 | 1) => rig.set('CLK', v ? null : 0)
    const dio = (v: 0 | 1) => rig.set('DIO', v ? null : 0)
    const start = () => {
      clk(1)
      dio(1)
      rig.run(h)
      dio(0)
      rig.run(h)
    }
    const stop = () => {
      clk(0)
      rig.run(h)
      dio(0)
      rig.run(h)
      clk(1)
      rig.run(h)
      dio(1)
      rig.run(h)
    }
    const write = (b: number): boolean => {
      for (let i = 0; i < 8; i++) {
        clk(0)
        rig.run(h / 2)
        dio(((b >> i) & 1) as 0 | 1)
        rig.run(h / 2)
        clk(1)
        rig.run(h)
      }
      clk(0)
      dio(1)
      rig.run(h)
      clk(1)
      rig.run(h / 2)
      const ack = rig.level('DIO') === 0
      rig.run(h / 2)
      clk(0)
      return ack
    }
    const frame = (bytes: number[]) => {
      start()
      const acks = bytes.map(write)
      stop()
      return acks
    }
    return { rig, dev, slot, frame }
  }

  it('data / address / display-control commands with ACK per byte; digits, colon and brightness', () => {
    const { dev, frame } = tmRig()
    expect(frame([0x40])).toEqual([true])
    expect(frame([0xc0, 0x3f, 0x06 | 0x80, 0x5b, 0x4f])).toEqual([true, true, true, true, true])
    expect(frame([0x8a])).toEqual([true])
    const v = dev.telemetry().values!
    expect([v.seg0, v.seg1, v.seg2, v.seg3]).toEqual([0x3f, 0x86, 0x5b, 0x4f])
    expect(v.on).toBe(1)
    expect(v.brightness).toBeCloseTo(4 / 14, 5)
  })

  it('fixed-address mode writes one grid', () => {
    const { dev, frame } = tmRig()
    frame([0x44])
    frame([0xc2, 0x7f])
    frame([0x8f])
    expect(dev.grids[2]).toBe(0x7f)
    expect(dev.telemetry().values!.brightness).toBe(1)
  })
})

// ====================================================================== catalog

describe('display catalog entries', () => {
  const TYPES = ['ssd1306_i2c', 'ssd1306_spi', 'sh1106_i2c', 'lcd1602', 'lcd2004', 'lcd1602_i2c', 'st7735', 'ili9341', 'max7219_8x8', 'ws2812b_strip8', 'tm1637_4digit']

  it('every display part is a footprint digital device with a registered model, full pin info and honest support', () => {
    for (const type of TYPES) {
      const e = getEntry(type)
      expect(e, type).toBeDefined()
      expect(CATALOG[type]).toBe(e)
      expect(e!.category).toBe('display')
      expect(e!.placement).toBe('footprint')
      expect(e!.allowedRotations).toEqual([0, 180])
      expect(e!.sim).toEqual({ kind: 'chip', model: 'digital-device' })
      expect(registeredDigitalDevices()).toContain(e!.digital!.model)
      for (const p of [...e!.digital!.inputs, ...e!.digital!.outputs, e!.digital!.supplyPin, e!.digital!.groundPin]) expect(e!.pins).toContain(p)
      expect(e!.pinInfo!.map((p) => p.pin)).toEqual(e!.pins)
      expect(e!.support!.level).toBe('partial')
      expect(e!.support!.limits!.length).toBeGreaterThan(0)
      expect(e!.footprintOffsets!.length).toBe(e!.pins.length)
      expect(e!.meta?.specs?.length).toBeGreaterThan(0)
    }
  })

  it('pins sit on one strip row, each in its own strip, at rotation 0 and 180', () => {
    for (const type of TYPES) {
      const e = getEntry(type)!
      const row = e.footprintOffsets![0].row
      for (const rotation of [0, 180] as const) {
        const at = rotation === 0 ? `${row}40` : `${row === 'j' ? 'a' : 'j'}60`
        const holes = componentPinHoles({ id: 'X', type, at, rotation }, e, { size: 'labxl', count: 1, rows: 1 })
        expect(holes, `${type} @${rotation}`).not.toBeNull()
        const strips = new Set(holes!.map((h) => (h!.kind === 'strip' ? `${h!.col}${'abcde'.includes(h!.row) ? 'T' : 'B'}` : '?')))
        expect(strips.size, type).toBe(e.pins.length)
      }
    }
  })
})
