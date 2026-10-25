/**
 * Logic-net layer (src/sim/digital/nets.ts) + the generic digital-device
 * adapter (src/sim/digital/device-chip.ts), proven with TEST-ONLY devices
 * registered from this file (no concrete Phase-4 models exist yet):
 *  - an I²C target that ACKs its 7-bit address (protocol state machine on
 *    pin edges only), bit-banged by the fake MCU through open-drain pins
 *    with 4.7 kΩ pull-ups → wired-AND, synchronous ACK seen by the MCU;
 *  - missing pull-ups → floating; push-pull vs open-drain low → contention;
 *  - a 74HC595-style shift register driving LEDs (device drives on ANALOG
 *    nets are stamped into the solver);
 *  - a device scheduling its own events on the coordinator queue.
 * The catalog entries are added to the in-memory CATALOG of this test
 * process only (catalog.ts is untouched).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { CATALOG } from '../../src/model/catalog'
import type { CatalogEntry } from '../../src/model/catalog'
import { registerDigitalDevice } from '../../src/sim/digital/api'
import type { DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../../src/sim/digital/api'
import { classifyNets, kindOf, NET_ANALOG, NET_CONTENTION, NET_DRIVEN, NET_FLOATING, NET_LOGIC, NET_RAIL } from '../../src/sim/digital/nets'
import { PIN_OUT_OD, PIN_OUT_PP } from '../../src/mcu/pins'
import type { CircuitLayout, ComponentInstance } from '../../src/model/types'
import { FakeMcu, ListProgram } from './fake-mcu'
import type { PinEvent } from './fake-mcu'
import { bluePillWorld, part, PB6, PB7, PB8, PB9, tap, w } from './worlds'

const PB12 = 28

// ------------------------------------------------------ test-only devices

class I2cAckTarget implements DigitalDevice {
  ctx!: DigitalDeviceCtx
  state: 'idle' | 'addr' | 'ack' = 'idle'
  bits = 0
  count = 0
  readonly seen: { addr: number; read: boolean }[] = []
  constructor(readonly address: number) {}
  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('SDA', 'z')
  }
  onPinChange(pin: string, level: LogicLevel): void {
    const ctx = this.ctx
    if (pin === 'SDA' && ctx.read('SCL') === 1) {
      if (level === 0) {
        this.state = 'addr' // START
        this.bits = 0
        this.count = 0
      } else if (level === 1) this.state = 'idle' // STOP
      return
    }
    if (pin !== 'SCL') return
    if (level === 1 && this.state === 'addr') {
      this.bits = (this.bits << 1) | (ctx.read('SDA') === 1 ? 1 : 0)
      this.count++
    } else if (level === 0) {
      if (this.state === 'addr' && this.count === 8) {
        const addr = this.bits >> 1
        this.seen.push({ addr, read: (this.bits & 1) === 1 })
        if (addr === this.address) {
          ctx.drive('SDA', 'low') // ACK during the 9th clock
          this.state = 'ack'
        } else this.state = 'idle'
      } else if (this.state === 'ack') {
        ctx.drive('SDA', 'z')
        this.state = 'idle'
      }
    }
  }
  /** test hook */
  forceLow(): void {
    this.ctx.drive('SDA', 'low')
  }
}

const Q = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH']

class Shift595 implements DigitalDevice {
  ctx!: DigitalDeviceCtx
  readonly stages = [0, 0, 0, 0, 0, 0, 0, 0]
  latch = 0
  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    for (const q of Q) ctx.drive(q, 'low')
  }
  onPinChange(pin: string, level: LogicLevel): void {
    if (level !== 1) return
    if (pin === 'SRCLK') {
      for (let i = 7; i > 0; i--) this.stages[i] = this.stages[i - 1]
      this.stages[0] = this.ctx.read('SER') === 1 ? 1 : 0
    } else if (pin === 'RCLK') {
      this.latch = 0
      for (let i = 0; i < 8; i++) {
        this.latch |= this.stages[i] << i
        this.ctx.drive(Q[i], this.stages[i] ? 'high' : 'low')
      }
    }
  }
  telemetry() {
    return { values: { latch: this.latch } }
  }
}

class Blinker implements DigitalDevice {
  ctx!: DigitalDeviceCtx
  level = false
  readonly at: number[] = []
  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('OUT', 'low')
    ctx.schedule(1e-3, () => this.toggle())
  }
  toggle(): void {
    this.at.push(this.ctx.now())
    this.level = !this.level
    this.ctx.drive('OUT', this.level ? 'high' : 'low')
    this.ctx.schedule(1e-3, () => this.toggle())
  }
}

const devices = new Map<string, DigitalDevice>()

beforeAll(() => {
  const base = (type: string, pins: string[], digital: CatalogEntry['digital']): CatalogEntry => ({
    type,
    label: type,
    category: 'module',
    placement: 'leads',
    pins,
    sim: { kind: 'chip', model: 'digital-device' },
    digital,
    doc: 'test-only part',
  })
  CATALOG.test_i2c_target = base('test_i2c_target', ['VCC', 'GND', 'SCL', 'SDA'], {
    model: 'test-i2c-ack',
    supplyPin: 'VCC',
    groundPin: 'GND',
    minVdd: 1.8,
    inputs: ['SCL', 'SDA'],
    outputs: ['SDA'],
  })
  CATALOG.test_595 = base('test_595', ['VCC', 'GND', 'SER', 'SRCLK', 'RCLK', ...Q], {
    model: 'test-595',
    supplyPin: 'VCC',
    groundPin: 'GND',
    minVdd: 2,
    inputs: ['SER', 'SRCLK', 'RCLK'],
    outputs: Q,
  })
  CATALOG.test_blinker = base('test_blinker', ['VCC', 'GND', 'OUT'], {
    model: 'test-blinker',
    supplyPin: 'VCC',
    groundPin: 'GND',
    minVdd: 2,
    inputs: [],
    outputs: ['OUT'],
  })
  const keep = <T extends DigitalDevice>(id: string, d: T): T => {
    devices.set(id, d)
    return d
  }
  registerDigitalDevice('test-i2c-ack', (comp) => keep(comp.id, new I2cAckTarget(Number(comp.params?.address ?? 0x3c))))
  registerDigitalDevice('test-595', (comp) => keep(comp.id, new Shift595()))
  registerDigitalDevice('test-blinker', (comp) => keep(comp.id, new Blinker()))
})

// ---------------------------------------------------------------- worlds

/** Blue Pill PB6 = SCL, PB7 = SDA → I²C target DEV1; optional 4.7 kΩ pull-ups to 3V3. */
function i2cWorld(pullups: boolean, address = 0x3c): CircuitLayout {
  const parts: ComponentInstance[] = [
    { id: 'DEV1', type: 'test_i2c_target', holes: ['f45', 'f46', 'f47', 'f48'], params: { address } },
  ]
  if (pullups) {
    parts.push(part('RP1', 'resistor', ['h47', 'top+3'], { resistance: 4700 }))
    parts.push(part('RP2', 'resistor', ['h48', 'top+4'], { resistance: 4700 }))
  }
  return bluePillWorld(
    parts,
    [w('g45', 'top+2'), w('g46', 'top-9'), w('g47', tap('PB6')), w('g48', tap('PB7'))],
    { rail3v3: true },
  )
}

function make(layout: CircuitLayout, setup: (f: FakeMcu) => void = () => {}) {
  const fakes: FakeMcu[] = []
  const co = new SimulationCoordinator({
    createMcu: () => {
      const f = new FakeMcu()
      setup(f)
      fakes.push(f)
      return f
    },
  })
  co.load(layout, 1)
  return { co, fake: () => fakes[fakes.length - 1] }
}

/**
 * Open-drain bit-bang of one I²C address byte at 100 kHz (8 MHz core:
 * 80 cycles per bit). Returns the events and the cycle of the 9th SCL rise.
 */
function i2cAddressScript(byte: number, start = 8000): { events: PinEvent[]; ackSample: number } {
  const ev: PinEvent[] = []
  const od = (cycle: number, pin: number, level: 0 | 1) => ev.push({ cycle, pin, mode: PIN_OUT_OD, level })
  od(start - 100, PB6, 1)
  od(start - 100, PB7, 1)
  od(start, PB7, 0) // START: SDA falls while SCL high
  let c = start + 40
  od(c, PB6, 0)
  for (let i = 7; i >= 0; i--) {
    od(c + 10, PB7, ((byte >> i) & 1) as 0 | 1)
    od(c + 40, PB6, 1)
    od(c + 80, PB6, 0)
    c += 80
  }
  od(c + 10, PB7, 1) // release SDA for the ACK bit
  od(c + 40, PB6, 1) // 9th clock: MCU samples SDA here
  const ackSample = c + 40
  od(c + 80, PB6, 0)
  od(c + 90, PB7, 0)
  od(c + 120, PB6, 1)
  od(c + 160, PB7, 1) // STOP
  return { events: ev, ackSample }
}

// ----------------------------------------------------------------- tests

describe('net classification', () => {
  it('classifies MCU pins with pull-ups as LOGIC, rails as RAIL, LED nets as ANALOG', () => {
    const layout = i2cWorld(true)
    layout.components.push(part('R9', 'resistor', ['a55', 'a58'], { resistance: 330 }))
    layout.components.push(part('D9', 'led', ['b58', 'top-12'], {}))
    layout.wires.push(w(tap('PA5'), 'e55'))
    const { co } = make(layout)
    const e = co.engine!
    const cls = classifyNets(e, layout.components)
    expect(kindOf(cls, e.nodeOf(tap('PB6')))).toBe(NET_LOGIC)
    expect(kindOf(cls, e.nodeOf(tap('PB7')))).toBe(NET_LOGIC)
    expect(kindOf(cls, e.nodeOf('top+0'))).toBe(NET_RAIL) // board 3V3
    expect(kindOf(cls, e.nodeOf(tap('5V')))).toBe(NET_RAIL)
    expect(kindOf(cls, -1)).toBe(NET_RAIL) // ground
    expect(kindOf(cls, e.nodeOf(tap('PA5')))).toBe(NET_ANALOG) // series R to an LED
    expect(kindOf(cls, e.nodeOf(tap('PC13')))).toBe(NET_ANALOG) // on-board LED via 510 Ω
    expect(kindOf(cls, e.nodeOf(tap('PA12')))).toBe(NET_LOGIC) // on-board 10 kΩ pull-up only
    expect(cls.pulls.filter((p) => p.label === 'RP1' || p.label === 'RP2').length).toBe(2)
  })
})

describe('open-drain I²C with a test target device', () => {
  it('wired-AND: pull-up high when released, low when either side pulls down', () => {
    const { co, fake } = make(i2cWorld(true))
    co.advance(0.0005)
    const nets = co.logicNets!
    const sda = co.engine!.nodeOf(tap('PB7'))
    expect(nets.state(sda)).toBe(NET_DRIVEN)
    expect(nets.voltage(sda)).toBeCloseTo(3.3, 2)
    fake().setDrive(PB7, PIN_OUT_OD, 0)
    expect(nets.voltage(sda)).toBeCloseTo((3.3 * (1 / 4700)) / (1 / 4700 + 1 / 50), 3) // ≈ 35 mV
    expect(fake().pins.lastInput[PB7]).toBe(0) // pushed synchronously
    fake().setDrive(PB7, PIN_OUT_OD, 1)
    expect(fake().pins.lastInput[PB7]).toBe(1)
    ;(devices.get('DEV1') as I2cAckTarget).forceLow()
    expect(nets.voltage(sda)).toBeLessThan(0.1)
    expect(fake().pins.lastInput[PB7]).toBe(0)
  })

  it('the target ACKs its address inside the 9th clock, at the exact cycle', () => {
    const { events, ackSample } = i2cAddressScript((0x3c << 1) | 0)
    const { co, fake } = make(i2cWorld(true), (f) => f.addProgram(new ListProgram(events)))
    co.advance(0.002)
    const dev = devices.get('DEV1') as I2cAckTarget
    expect(dev.seen).toEqual([{ addr: 0x3c, read: false }])
    // SDA low (ACK) as seen by the MCU when it raises SCL for the 9th time
    expect(fake().pins.inputAt(PB7, ackSample)).toBe(0)
    // the ACK began exactly at the 8th SCL falling edge (synchronous listeners)
    const ackStart = fake().pins.inputs.find((e) => e.pin === PB7 && e.cycle > ackSample - 80 && e.level === 0)
    expect(ackStart?.cycle).toBe(ackSample - 40)
    // logic nets never forced an analog step boundary
    expect(fake().syncStops).toBe(0)
    expect(co.issues().some((i) => i.message.includes('contention'))).toBe(false)
  })

  it('a wrong address is NACKed (SDA stays high on the 9th clock)', () => {
    const { events, ackSample } = i2cAddressScript((0x3d << 1) | 1)
    const { co, fake } = make(i2cWorld(true), (f) => f.addProgram(new ListProgram(events)))
    co.advance(0.002)
    expect((devices.get('DEV1') as I2cAckTarget).seen).toEqual([{ addr: 0x3d, read: true }])
    expect(fake().pins.inputAt(PB7, ackSample)).toBe(1)
  })

  it('missing pull-ups: released bus is FLOATING (undefined level for the device)', () => {
    const { co } = make(i2cWorld(false))
    co.advance(0.0005)
    const nets = co.logicNets!
    const sda = co.engine!.nodeOf(tap('PB7'))
    expect(nets.state(sda)).toBe(NET_FLOATING)
    expect(Number.isNaN(nets.voltage(sda))).toBe(true)
    const dev = devices.get('DEV1') as I2cAckTarget
    expect(dev.ctx.read('SDA')).toBeNull()
    expect(Number.isNaN(dev.ctx.voltage('SDA'))).toBe(true)
  })

  it('push-pull high against an open-drain low is contention: undefined level + issue', () => {
    const { co, fake } = make(i2cWorld(true))
    co.advance(0.0005)
    fake().setDrive(PB7, PIN_OUT_PP, 1)
    ;(devices.get('DEV1') as I2cAckTarget).forceLow()
    const nets = co.logicNets!
    const sda = co.engine!.nodeOf(tap('PB7'))
    expect(nets.state(sda)).toBe(NET_CONTENTION)
    expect((devices.get('DEV1') as I2cAckTarget).ctx.read('SDA')).toBeNull()
    expect(co.issues().map((i) => i.message)).toContain(
      'logic contention: U1.PB7 drives high while DEV1.SDA drives low (level undefined)',
    )
    // the drives are also in the analog solve: the short is visible there too
    co.advance(0.0002)
    const v = co.engine!.netVoltage(tap('PB7'))
    expect(v).toBeGreaterThan(1.4)
    expect(v).toBeLessThan(1.8)
    expect(co.issues().some((i) => i.message.includes('PB7: driver sources'))).toBe(true)
  })
})

describe('74HC595-style shift register driving LEDs', () => {
  function world(): CircuitLayout {
    const holes = ['f50', 'f51', 'f52', 'f53', 'f54', 'f55', 'f56', 'f57', 'f58', 'f59', 'f60', 'f61', 'f62']
    return bluePillWorld(
      [
        { id: 'SR1', type: 'test_595', holes },
        part('RA', 'resistor', ['h55', 'h40'], { resistance: 1000 }),
        part('LA', 'led', ['i40', 'bot-1'], { color: 'green' }),
        part('RH', 'resistor', ['h62', 'h42'], { resistance: 1000 }),
        part('LH', 'led', ['i42', 'bot-2'], { color: 'green' }),
      ],
      [
        w('g50', 'top+5'),
        w('g51', 'top-10'),
        w('bot-0', 'top-11'),
        w('g52', tap('PB8')), // SER
        w('g53', tap('PB9')), // SRCLK
        w('g54', tap('PB12')), // RCLK
      ],
      { rail3v3: true },
    )
  }

  /** bits[0] is shifted first (ends in QH). */
  function shiftScript(bits: number[], start: number): PinEvent[] {
    const ev: PinEvent[] = []
    const pp = (cycle: number, pin: number, level: 0 | 1) => ev.push({ cycle, pin, mode: PIN_OUT_PP, level })
    pp(start - 10, PB9, 0)
    pp(start - 10, PB12, 0)
    let c = start
    for (const b of bits) {
      pp(c, PB8, b as 0 | 1)
      pp(c + 20, PB9, 1)
      pp(c + 40, PB9, 0)
      c += 40
    }
    pp(c + 20, PB12, 1)
    pp(c + 40, PB12, 0)
    return ev
  }

  it('shifts, latches and lights the LEDs on QA / QH', () => {
    const first = [1, 0, 1, 1, 0, 0, 0, 1] // QH=1 … QA=1
    const second = [0, 0, 0, 0, 0, 0, 0, 0]
    const { co, fake } = make(world(), (f) =>
      f.addProgram(new ListProgram([...shiftScript(first, 8000), ...shiftScript(second, 16000)])),
    )
    co.advance(0.0015)
    const sr = devices.get('SR1') as Shift595
    // stages[i] = Q[i]; QA = last bit shifted
    expect(sr.stages).toEqual([1, 0, 0, 0, 1, 1, 0, 1])
    expect(co.telemetry().components.SR1.values).toEqual({ latch: 0b10110001 })
    const t = co.telemetry().components
    expect(t.LA.ledBrightness).toBeGreaterThan(0.05)
    expect(t.LH.ledBrightness).toBeGreaterThan(0.05)
    // the LED nets are ANALOG: the latch edges ended analog steps exactly
    expect(fake().syncStops).toBeGreaterThanOrEqual(1)
    co.advance(0.0015)
    const t2 = co.telemetry().components
    expect(t2.LA.ledBrightness).toBeLessThan(1e-6)
    expect(t2.LH.ledBrightness).toBeLessThan(1e-6)
  })
})

describe('device-scheduled events (no MCU)', () => {
  it('toggles at exact virtual times through the coordinator event queue', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 3.3 } },
        { id: 'B1', type: 'test_blinker', holes: ['f20', 'f21', 'f22'] },
        { id: 'L1', type: 'logic_probe', holes: ['j22'], params: { channel: 'D3' } },
      ],
      wires: [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('g20', 'top+1'), w('g21', 'top-1')],
    }
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.advance(0.0055)
    const b = devices.get('B1') as Blinker
    let t = 0
    const want: number[] = []
    for (let k = 0; k < 5; k++) want.push((t = t + 1e-3))
    expect(b.at).toEqual(want)
    const r = co.query({ kind: 'logic', t0: 0.0005, t1: 0.0055 })
    if (r.kind !== 'logic') throw new Error('query')
    const tr = r.capture.traces.find((x) => x.index === 3)!
    expect(tr.exact).toBe(true)
    expect(tr.initial).toBe(0)
    expect(Array.from(tr.times)).toEqual(want)
    expect(Array.from(tr.levels)).toEqual([1, 0, 1, 0, 1])
    // the logic drive is stamped into the analog solve as well
    expect(co.engine!.netVoltage('j22')).toBeCloseTo(3.3, 1)
  })
})
