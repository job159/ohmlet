/**
 * AT24C02 EEPROM and 74HC595 models (src/sim/models/serial-ics.model.ts)
 * against a small logic-level rig: named nets with optional pull-ups,
 * device drives (strong / weak / released), an external driver per net
 * (the "master"), and a virtual-time event queue for the devices' own
 * timers. Inputs are delivered on every resolved level change — including
 * changes caused by the device's own drive — like DigitalDeviceHost does.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DigitalDevice, DigitalDeviceCtx, DigitalDrive, LogicLevel } from '../../src/sim/digital/api'
import { AT24C02_TWR, At24c02, at24c02Contents, eraseAt24c02, Hc595 } from '../../src/sim/models/serial-ics.model'
import { CATALOG, getEntry } from '../../src/model/catalog'
import { registeredDigitalDevices } from '../../src/sim/digital/api'

interface DevSlot {
  device: DigitalDevice
  pins: Record<string, string>
  inputs: string[]
  drives: Map<string, DigitalDrive>
  delivered: Map<string, LogicLevel>
  issues: string[]
}

class Rig {
  t = 0
  private seq = 0
  private ev: { at: number; seq: number; id: number; fn: () => void }[] = []
  private nextId = 1
  private nets = new Map<string, { ext: 0 | 1 | null; pullUp: boolean }>()
  readonly devs: DevSlot[] = []
  /** resolved level history per net */
  readonly history = new Map<string, { t: number; level: LogicLevel }[]>()

  net(name: string, pullUp = false): void {
    this.nets.set(name, { ext: null, pullUp })
  }

  add(device: DigitalDevice, pins: Record<string, string>, inputs: string[]): DevSlot {
    for (const n of Object.values(pins)) if (!this.nets.has(n)) this.net(n)
    const slot: DevSlot = { device, pins, inputs, drives: new Map(), delivered: new Map(), issues: [] }
    this.devs.push(slot)
    const ctx: DigitalDeviceCtx = {
      componentId: 'U' + this.devs.length,
      now: () => this.t,
      read: (pin) => this.level(pins[pin]),
      voltage: (pin) => {
        const l = this.level(pins[pin])
        return l === null ? NaN : l * 3.3
      },
      drive: (pin, d) => {
        slot.drives.set(pin, d)
        this.notify()
      },
      schedule: (delay, fn) => this.schedule(this.t + delay, fn),
      cancel: (h) => {
        this.ev = this.ev.filter((e) => e.id !== h)
      },
      supply: () => 3.3,
      issue: (_level, msg) => slot.issues.push(msg),
      log: () => {},
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

  /** external driver on a net: 0 / 1 strong, null released */
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

  /** advance virtual time by dt, running due device events in order */
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

/** bit-banged I²C master on nets SCL/SDA (open drain: drive 0 or release), 100 kHz */
class Master {
  readonly h = 5e-6
  constructor(private rig: Rig) {}
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
  /** returns true when ACKed */
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
  /** HAL_I2C_Mem_Write-style transaction; false when not acknowledged */
  memWrite(dev: number, addr: number, data: number[]): boolean {
    this.start()
    if (!this.write(dev << 1)) {
      this.stop()
      return false
    }
    let ok = this.write(addr)
    for (const d of data) ok = this.write(d) && ok
    this.stop()
    return ok
  }
  memRead(dev: number, addr: number, n: number): number[] | null {
    this.start()
    if (!this.write(dev << 1)) {
      this.stop()
      return null
    }
    this.write(addr)
    this.start() // repeated START
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

function eepromRig(id = 'EE', pinsTo: Partial<Record<'A0' | 'A1' | 'A2' | 'WP', string>> = {}) {
  const rig = new Rig()
  rig.net('SCL', true)
  rig.net('SDA', true)
  const ee = new At24c02(id)
  const pins: Record<string, string> = { SDA: 'SDA', SCL: 'SCL', A0: pinsTo.A0 ?? 'nA0', A1: pinsTo.A1 ?? 'nA1', A2: pinsTo.A2 ?? 'nA2', WP: pinsTo.WP ?? 'nWP' }
  for (const n of Object.values(pins)) if (n !== 'SDA' && n !== 'SCL') rig.net(n)
  rig.add(ee, pins, ['A0', 'A1', 'A2', 'SDA', 'SCL', 'WP'])
  return { rig, ee, m: new Master(rig) }
}

describe('AT24C02 EEPROM', () => {
  beforeEach(() => {
    for (const id of ['EE', 'EE2', 'P', 'WPID', 'PWR']) eraseAt24c02(id)
  })

  it('a fresh part reads 0xFF; byte write, then random read', () => {
    const { rig, m } = eepromRig()
    expect(m.memRead(0x50, 0x10, 2)).toEqual([0xff, 0xff])
    expect(m.memWrite(0x50, 0x10, [0x42])).toBe(true)
    rig.run(AT24C02_TWR)
    expect(m.memRead(0x50, 0x10, 1)).toEqual([0x42])
  })

  it('the write cycle (t_WR 5 ms): address NACKed while busy — ACK polling succeeds after 5 ms', () => {
    const { rig, m } = eepromRig()
    const t0 = rig.t
    expect(m.memWrite(0x50, 0x00, [1, 2, 3])).toBe(true)
    const tStop = rig.t
    let polls = 0
    while (!m.ping(0x50)) {
      polls++
      expect(polls).toBeLessThan(1000)
    }
    expect(polls).toBeGreaterThan(40) // one poll ≈ 112 µs
    // the first ACKed poll starts after the 5 ms cycle
    expect(rig.t - tStop).toBeGreaterThanOrEqual(AT24C02_TWR)
    expect(rig.t - tStop).toBeLessThan(AT24C02_TWR + 200e-6)
    expect(rig.t).toBeGreaterThan(t0)
    expect(m.memRead(0x50, 0x00, 3)).toEqual([1, 2, 3])
  })

  it('page write rolls over inside the 8-byte page; later bytes overwrite the first ones', () => {
    const { rig, m } = eepromRig('P')
    const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    expect(m.memWrite(0x50, 0x06, data)).toBe(true) // 0x06,0x07,0x00…0x05,0x06,0x07
    rig.run(AT24C02_TWR)
    expect(m.memRead(0x50, 0x00, 9)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 0xff])
  })

  it('a page boundary needs two writes: 16 bytes from 0x05 written as 3 + 8 + 5', () => {
    const { rig, m } = eepromRig()
    const data = Array.from({ length: 16 }, (_, i) => 0xa0 + i)
    let addr = 0x05
    let i = 0
    while (i < data.length) {
      const n = Math.min(8 - (addr % 8), data.length - i)
      expect(m.memWrite(0x50, addr, data.slice(i, i + n))).toBe(true)
      while (!m.ping(0x50));
      addr += n
      i += n
    }
    expect(m.memRead(0x50, 0x05, 16)).toEqual(data)
    expect(at24c02Contents('EE')[0x14]).toBe(0xaf)
  })

  it('sequential read rolls over from 0xFF to 0x00; current-address read continues from the counter', () => {
    const { rig, m } = eepromRig()
    expect(m.memWrite(0x50, 0xfe, [0x01, 0x02])).toBe(true)
    rig.run(AT24C02_TWR)
    expect(m.memWrite(0x50, 0x00, [0x03])).toBe(true)
    rig.run(AT24C02_TWR)
    expect(m.memRead(0x50, 0xfe, 3)).toEqual([0x01, 0x02, 0x03])
    // the counter now points at 0x01: a current-address read returns it
    m.start()
    expect(m.write((0x50 << 1) | 1)).toBe(true)
    expect(m.read(false)).toBe(0xff)
    m.stop()
  })

  it('A0–A2 select the address (internal pull-downs: floating = 0)', () => {
    const { rig, m } = eepromRig('EE2', { A0: 'nA0' })
    expect(m.ping(0x50)).toBe(true)
    expect(m.ping(0x51)).toBe(false)
    rig.set('nA0', 1)
    expect(m.ping(0x51)).toBe(true)
    expect(m.ping(0x50)).toBe(false)
    expect(m.ping(0x68)).toBe(false)
  })

  it('WP high: data are acknowledged but not written, no write cycle', () => {
    const { rig, m } = eepromRig('WPID')
    rig.set('nWP', 1)
    expect(m.memWrite(0x50, 0x20, [0x55])).toBe(true)
    expect(m.ping(0x50)).toBe(true) // not busy
    rig.set('nWP', 0)
    expect(m.memRead(0x50, 0x20, 1)).toEqual([0xff])
  })

  it('a repeated START instead of a STOP aborts the write', () => {
    const { rig, m } = eepromRig()
    m.start()
    m.write(0x50 << 1)
    m.write(0x30)
    m.write(0x99)
    m.start()
    m.write(0x50 << 1)
    m.stop()
    rig.run(AT24C02_TWR)
    expect(m.memRead(0x50, 0x30, 1)).toEqual([0xff])
  })

  it('contents are non-volatile: a new instance of the same component sees them; power loss during t_WR loses the write', () => {
    const a = eepromRig('PWR')
    expect(a.m.memWrite(0x50, 0x40, [7])).toBe(true)
    a.rig.run(AT24C02_TWR)
    expect(a.m.memWrite(0x50, 0x41, [8])).toBe(true)
    a.ee.powerChanged(false) // VCC lost inside the write cycle
    a.rig.run(AT24C02_TWR)
    const b = eepromRig('PWR')
    expect(b.m.memRead(0x50, 0x40, 2)).toEqual([7, 0xff])
  })
})

describe('74HC595', () => {
  const Q = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH']
  function rig595() {
    const rig = new Rig()
    const pins: Record<string, string> = { SER: 'SER', SRCLK: 'SRCLK', RCLK: 'RCLK', SRCLR: 'SRCLR', OE: 'OE', "QH'": 'QH1' }
    for (const q of Q) pins[q] = q
    for (const n of ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE']) rig.net(n)
    rig.set('SRCLR', 1)
    rig.set('OE', 0)
    rig.set('SRCLK', 0)
    rig.set('RCLK', 0)
    rig.set('SER', 0)
    const dev = new Hc595()
    const slot = rig.add(dev, pins, ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE'])
    return { rig, dev, slot }
  }
  const shiftByte = (rig: Rig, b: number, clk = 'SRCLK', ser = 'SER') => {
    for (let i = 7; i >= 0; i--) {
      rig.set(ser, ((b >> i) & 1) as 0 | 1)
      rig.run(50e-9)
      rig.set(clk, 1)
      rig.run(50e-9)
      rig.set(clk, 0)
      rig.run(50e-9)
    }
  }
  const outputs = (rig: Rig) => Q.map((q) => rig.level(q))
  const pulse = (rig: Rig, net: string) => {
    rig.set(net, 1)
    rig.run(50e-9)
    rig.set(net, 0)
    rig.run(50e-9)
  }

  it('shifts on SRCLK, shows the byte on QA–QH only after RCLK (QA = last bit in)', () => {
    const { rig } = rig595()
    shiftByte(rig, 0b10110001)
    expect(outputs(rig)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    pulse(rig, 'RCLK')
    expect(outputs(rig)).toEqual([1, 0, 0, 0, 1, 1, 0, 1])
    expect(rig.level('QH1')).toBe(1) // QH' = stage H = first bit shifted in
  })

  it('outputs change t_pd = 20 ns after the clock edge', () => {
    const { rig } = rig595()
    shiftByte(rig, 0xff)
    rig.set('RCLK', 1)
    expect(rig.level('QA')).toBe(0)
    rig.run(19e-9)
    expect(rig.level('QA')).toBe(0)
    rig.run(2e-9)
    expect(rig.level('QA')).toBe(1)
  })

  it('OE high puts QA–QH in high impedance (QH\' still driven); low drives them again', () => {
    const { rig } = rig595()
    shiftByte(rig, 0x0f)
    pulse(rig, 'RCLK')
    rig.set('OE', 1)
    rig.run(50e-9)
    expect(outputs(rig)).toEqual([null, null, null, null, null, null, null, null])
    expect(rig.level('QH1')).toBe(0)
    rig.set('OE', 0)
    rig.run(50e-9)
    expect(outputs(rig)).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
  })

  it('SRCLR low clears the shift register (not the latch); clocks are ignored while it is low', () => {
    const { rig } = rig595()
    shiftByte(rig, 0xaa)
    pulse(rig, 'RCLK')
    rig.set('SRCLR', 0)
    rig.run(50e-9)
    shiftByte(rig, 0xff)
    expect(outputs(rig)).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
    rig.set('SRCLR', 1)
    pulse(rig, 'RCLK')
    expect(outputs(rig)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('SRCLK and RCLK tied together: the latch is one clock behind the shift register', () => {
    const { rig } = rig595()
    shiftByte(rig, 0xff, 'SRCLK') // shift register = 0xFF, latch 0
    // now clock with both tied (drive both nets from the same edge)
    rig.set('SER', 0)
    rig.set('SRCLK', 1)
    rig.set('RCLK', 1)
    rig.run(50e-9)
    // the latch got 0xFF (before the shift), the shift register is now 0xFE
    expect(outputs(rig)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('two daisy-chained 595s sharing SRCLK/RCLK hold 16 bits (QH\' → SER with propagation delay)', () => {
    const rig = new Rig()
    for (const n of ['SER', 'SRCLK', 'RCLK', 'VH', 'VL', 'CH']) rig.net(n)
    rig.set('VH', 1)
    rig.set('VL', 0)
    rig.set('SRCLK', 0)
    rig.set('RCLK', 0)
    const mk = (prefix: string, ser: string, qh: string) => {
      const pins: Record<string, string> = { SER: ser, SRCLK: 'SRCLK', RCLK: 'RCLK', SRCLR: 'VH', OE: 'VL', "QH'": qh }
      for (const q of Q) pins[q] = prefix + q
      return rig.add(new Hc595(), pins, ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE'])
    }
    mk('A', 'SER', 'CH')
    mk('B', 'CH', 'OUT')
    shiftByte(rig, 0x12) // ends in the second chip
    shiftByte(rig, 0x34) // first chip
    pulse(rig, 'RCLK')
    const byte = (p: string) => Q.reduce((v, q, i) => v | ((rig.level(p + q) === 1 ? 1 : 0) << i), 0)
    expect(byte('A')).toBe(0x34)
    expect(byte('B')).toBe(0x12)
  })

  it('a floating control input is reported once and keeps its level', () => {
    const { rig, slot } = rig595()
    rig.set('OE', null)
    rig.run(50e-9)
    expect(slot.issues.length).toBe(1)
    expect(slot.issues[0]).toMatch(/OE is floating/)
    expect(outputs(rig)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // still enabled
  })
})

describe('catalog entries', () => {
  it('at24c02 and 74hc595 are DIP digital devices with registered models', () => {
    for (const type of ['at24c02', '74hc595']) {
      const e = getEntry(type)
      expect(e, type).toBeDefined()
      expect(CATALOG[type]).toBe(e)
      expect(e!.placement).toBe('dip')
      expect(e!.visual?.shape).toBe('dip')
      expect(e!.sim).toEqual({ kind: 'chip', model: 'digital-device' })
      expect(registeredDigitalDevices()).toContain(e!.digital!.model)
      for (const p of [...e!.digital!.inputs, ...e!.digital!.outputs]) expect(e!.pins).toContain(p)
      for (const info of e!.pinInfo ?? []) expect(e!.pins).toContain(info.pin)
      expect(e!.pinInfo!.length).toBe(e!.pins.length)
    }
    expect(getEntry('at24c02')!.pins).toEqual(['A0', 'A1', 'A2', 'GND', 'SDA', 'SCL', 'WP', 'VCC'])
    expect(getEntry('74hc595')!.pins).toEqual(['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'])
  })
})
