/**
 * I2C1/I2C2 (src/mcu/stm32f1/i2c.ts) against a scripted bus.
 *
 * The harness is a tiny wired-AND circuit: each bus line is a net with an
 * optional pull-up; MCU pins (from soc.pins.drive) and scripted devices pull
 * it low or release it; the resolved level is pushed back with
 * pins.setInput (MCU first, then the devices — the coordinator's order).
 * Without the pull-up a released line keeps its last level (the logic
 * layer's "held" level of a floating net).
 *
 * The register sequences below are the ones ST's HAL v1.1.9 performs
 * (stm32f1xx_hal_i2c.c), polled like firmware while simulated time runs.
 */
import { describe, expect, it } from 'vitest'
import { I2C_SR1_ADD10, I2C_SR1_ADDR, I2C_SR1_AF, I2C_SR1_ARLO, I2C_SR1_BERR, I2C_SR1_BTF, I2C_SR1_PECERR, I2C_SR1_RXNE, I2C_SR1_SB, I2C_SR1_STOPF, I2C_SR1_TXE, I2C_SR2_BUSY, I2C_SR2_GENCALL, I2C_SR2_MSL, I2C_SR2_TRA, pecUpdate } from '../../../src/mcu/stm32f1/i2c'
import { PIN_OUT_OD, PIN_OUT_PP } from '../../../src/mcu/pins'
import type { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { AFIO, clock72, GPIOB, makeSoc, r32, RCC_AHBENR, RCC_APB1ENR, RCC_APB2ENR, runFor, set32, w32 } from './helpers'

const I2C1 = 0x40005400
const I2C2 = 0x40005800
const CR1 = 0x00
const CR2 = 0x04
const OAR1 = 0x08
const DR = 0x10
const SR1 = 0x14
const SR2 = 0x18
const CCR = 0x1c
const TRISE = 0x20
const PE = 1
const START = 1 << 8
const STOP = 1 << 9
const ACK = 1 << 10
const POS = 1 << 11
const SWRST = 1 << 15
const PB6 = 22
const PB7 = 23
const PB10 = 26
const PB11 = 27

// ------------------------------------------------------------------ harness

interface Net {
  name: string
  pins: number[]
  pullUp: boolean
  level: 0 | 1
  devices: Map<string, 0 | 1>
  edges: { t: number; level: 0 | 1 }[]
}

type DevListener = (net: 'scl' | 'sda', level: 0 | 1) => void

class Bus {
  readonly scl: Net
  readonly sda: Net
  private listeners: DevListener[] = []

  constructor(
    readonly soc: Stm32f103,
    pins: { scl: number[]; sda: number[] },
    pullUp = true,
  ) {
    const mk = (name: string, p: number[]): Net => ({ name, pins: p, pullUp, level: pullUp ? 1 : 0, devices: new Map(), edges: [] })
    this.scl = mk('scl', pins.scl)
    this.sda = mk('sda', pins.sda)
    soc.pins.listener = {
      pinDriveChanged: (pin) => {
        if (this.scl.pins.includes(pin)) this.resolve(this.scl)
        if (this.sda.pins.includes(pin)) this.resolve(this.sda)
      },
    }
    for (const n of [this.scl, this.sda]) for (const p of n.pins) soc.pins.setInput(p, n.level, n.level ? 3.3 : 0)
  }

  listen(fn: DevListener): void {
    this.listeners.push(fn)
  }

  /** a scripted device pulls `net` low (0) or releases it (1) */
  drive(net: 'scl' | 'sda', who: string, level: 0 | 1): void {
    const n = net === 'scl' ? this.scl : this.sda
    n.devices.set(who, level)
    this.resolve(n)
  }

  private resolve(n: Net): void {
    let low = false
    for (const p of n.pins) {
      const d = this.soc.pins.drive(p)
      if ((d.mode === PIN_OUT_OD || d.mode === PIN_OUT_PP) && d.level === 0) low = true
    }
    for (const l of n.devices.values()) if (l === 0) low = true
    const level: 0 | 1 = low ? 0 : n.pullUp ? 1 : n.level // floating: held level
    if (level === n.level) {
      for (const p of n.pins) this.soc.pins.setInput(p, level, level ? 3.3 : NaN)
      return
    }
    n.level = level
    n.edges.push({ t: this.soc.time(), level })
    for (const p of n.pins) this.soc.pins.setInput(p, level, level ? 3.3 : 0)
    for (const fn of this.listeners) fn(n === this.scl ? 'scl' : 'sda', level)
  }

  /** run `fn` `delay` seconds from now on the SoC scheduler */
  after(delay: number, fn: () => void): void {
    const s = this.soc
    s.scheduler.schedule(s.clock.cycles + delay * s.hclkHz, () => fn())
  }
}

/**
 * A scripted 7-bit I²C slave at the bit level: samples SDA on SCL rising
 * edges, detects START/STOP, ACKs its address, records written bytes and
 * shifts out `readData` (MSB first, changing SDA after SCL falls).
 */
class Slave {
  written: number[] = []
  /** [ACK=true / NACK=false] per byte the master acknowledged in a read */
  masterAcks: boolean[] = []
  starts = 0
  stops = 0
  readData: number[] = []
  /** hold SCL low this long (s) after each acknowledged byte */
  stretch = 0
  private state: 'idle' | 'addr' | 'ackAddr' | 'rx' | 'ackRx' | 'tx' | 'ackTx' | 'ignore' = 'idle'
  private bits = 0
  private shift = 0
  private scl: 0 | 1 = 1
  private sda: 0 | 1 = 1
  private readIdx = 0
  private reading = false

  constructor(
    private bus: Bus,
    readonly address: number,
    readonly name = 'slave',
  ) {
    bus.listen((net, level) => this.edge(net, level))
  }

  private drv(level: 0 | 1): void {
    this.bus.drive('sda', this.name, level)
  }

  private edge(net: 'scl' | 'sda', level: 0 | 1): void {
    if (net === 'sda') {
      this.sda = level
      if (this.scl === 1) {
        if (level === 0) {
          this.starts++
          this.state = 'addr'
          this.bits = 0
          this.shift = 0
          this.drv(1)
        } else {
          this.stops++
          this.state = 'idle'
          this.drv(1)
        }
      }
      return
    }
    this.scl = level
    if (level === 1) {
      if (this.state === 'addr' || this.state === 'rx') {
        this.shift = ((this.shift << 1) | this.bus.sda.level) & 0xff
        this.bits++
      } else if (this.state === 'ackTx') {
        this.masterAcks.push(this.bus.sda.level === 0)
      }
      return
    }
    // SCL falling
    switch (this.state) {
      case 'addr':
        if (this.bits === 8) {
          if (this.shift >>> 1 === this.address) {
            this.reading = (this.shift & 1) === 1
            this.drv(0)
            this.state = 'ackAddr'
          } else this.state = 'ignore'
        }
        return
      case 'ackAddr':
      case 'ackRx':
        this.drv(1)
        this.bits = 0
        this.shift = 0
        this.state = this.reading ? 'tx' : 'rx'
        this.maybeStretch()
        if (this.reading) this.sendBit()
        return
      case 'rx':
        if (this.bits === 8) {
          this.written.push(this.shift)
          this.drv(0)
          this.state = 'ackRx'
        }
        return
      case 'tx':
        if (this.bits === 8) {
          this.drv(1)
          this.state = 'ackTx'
          return
        }
        this.sendBit()
        return
      case 'ackTx': {
        const acked = this.masterAcks[this.masterAcks.length - 1]
        this.bits = 0
        if (!acked) {
          this.state = 'ignore'
          return
        }
        this.state = 'tx'
        this.maybeStretch()
        this.sendBit()
        return
      }
      default:
        return
    }
  }

  private sendBit(): void {
    if (this.bits === 0) this.shift = this.readData[this.readIdx++] ?? 0xff
    const bit = ((this.shift >>> (7 - this.bits)) & 1) as 0 | 1
    this.bits++
    this.drv(bit)
  }

  private maybeStretch(): void {
    if (this.stretch <= 0) return
    this.bus.drive('scl', this.name, 0)
    this.bus.after(this.stretch, () => this.bus.drive('scl', this.name, 1))
  }
}

// ------------------------------------------------------------------ firmware-like helpers

function setupI2c1(opts: { pullUp?: boolean; fast?: boolean; init?: boolean } = {}) {
  const { soc } = makeSoc({ firmware: true })
  clock72(soc)
  set32(soc, RCC_APB2ENR, (1 << 0) | (1 << 3)) // AFIO, GPIOB
  const bus = new Bus(soc, { scl: [PB6], sda: [PB7] }, opts.pullUp ?? true)
  // HAL_I2C_MspInit: PB6/PB7 AF open-drain 50 MHz, then the I2C1 clock
  w32(soc, GPIOB + 0x00, (r32(soc, GPIOB + 0x00) & 0x00ffffff) | 0xff000000)
  set32(soc, RCC_APB1ENR, 1 << 21)
  if (opts.init !== false) halInit(soc, I2C1, opts.fast ? 400_000 : 100_000)
  return { soc, bus }
}

/** HAL_I2C_Init (v1.1.9) at register level: disable, SWRST pulse, FREQ, TRISE, CCR, CR1, OAR1, enable */
function halInit(soc: Stm32f103, base: number, speed: number, ownAddress = 0): void {
  const pclk1 = 36_000_000
  const freq = pclk1 / 1e6
  w32(soc, base + CR1, r32(soc, base + CR1) & ~PE)
  w32(soc, base + CR1, r32(soc, base + CR1) | SWRST)
  w32(soc, base + CR1, r32(soc, base + CR1) & ~SWRST)
  w32(soc, base + CR2, freq)
  if (speed <= 100_000) {
    w32(soc, base + TRISE, freq + 1)
    w32(soc, base + CCR, Math.max(Math.floor(pclk1 / (speed * 2)), 4))
  } else {
    w32(soc, base + TRISE, Math.floor((freq * 300) / 1000) + 1)
    w32(soc, base + CCR, (1 << 15) | Math.max(Math.floor(pclk1 / (speed * 3)), 1)) // DUTY = 0 (tlow/thigh = 2)
  }
  w32(soc, base + OAR1, 0x4000 | (ownAddress << 1))
  w32(soc, base + CR1, r32(soc, base + CR1) | PE)
}

const STEP = 0.25e-6

/** poll `cond` like firmware does, advancing simulated time; returns false on timeout */
function waitFor(soc: Stm32f103, cond: () => boolean, timeout = 0.01): boolean {
  const t0 = soc.time()
  while (!cond()) {
    if (soc.time() - t0 > timeout) return false
    runFor(soc, STEP)
  }
  return true
}

const sr1 = (s: Stm32f103, b = I2C1) => r32(s, b + SR1)
const sr2 = (s: Stm32f103, b = I2C1) => r32(s, b + SR2)
const flag = (s: Stm32f103, f: number, b = I2C1) => (sr1(s, b) & f) !== 0
const clearAddr = (s: Stm32f103, b = I2C1) => {
  r32(s, b + SR1)
  r32(s, b + SR2)
}
const setCr1 = (s: Stm32f103, bits: number, b = I2C1) => w32(s, b + CR1, r32(s, b + CR1) | bits)
const clrCr1 = (s: Stm32f103, bits: number, b = I2C1) => w32(s, b + CR1, r32(s, b + CR1) & ~bits)

type Status = 'OK' | 'ERROR' | 'BUSY' | 'TIMEOUT'

/** I2C_MasterRequestWrite / Read: START → SB → address → ADDR (AF → STOP, error) */
function requestAddress(soc: Stm32f103, addr7: number, read: boolean): Status {
  if (read) setCr1(soc, ACK)
  setCr1(soc, START)
  if (!waitFor(soc, () => flag(soc, I2C_SR1_SB))) return 'TIMEOUT'
  w32(soc, I2C1 + DR, (addr7 << 1) | (read ? 1 : 0))
  const ok = waitFor(soc, () => {
    if (flag(soc, I2C_SR1_AF)) return true
    return flag(soc, I2C_SR1_ADDR)
  })
  if (!ok) return 'ERROR'
  if (flag(soc, I2C_SR1_AF)) {
    setCr1(soc, STOP)
    w32(soc, I2C1 + SR1, ~I2C_SR1_AF & 0xffff)
    return 'ERROR'
  }
  return 'OK'
}

/** HAL_I2C_Master_Transmit */
function masterTransmit(soc: Stm32f103, addr7: number, data: number[]): Status {
  if (!waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY), 0.025)) return 'BUSY'
  clrCr1(soc, POS)
  const st = requestAddress(soc, addr7, false)
  if (st !== 'OK') return st
  clearAddr(soc)
  let i = 0
  while (i < data.length) {
    if (!waitFor(soc, () => flag(soc, I2C_SR1_TXE) || flag(soc, I2C_SR1_AF))) return 'TIMEOUT'
    if (flag(soc, I2C_SR1_AF)) {
      setCr1(soc, STOP)
      return 'ERROR'
    }
    w32(soc, I2C1 + DR, data[i++])
    if (flag(soc, I2C_SR1_BTF) && i < data.length) w32(soc, I2C1 + DR, data[i++])
    if (!waitFor(soc, () => flag(soc, I2C_SR1_BTF) || flag(soc, I2C_SR1_AF))) return 'TIMEOUT'
    if (flag(soc, I2C_SR1_AF)) {
      setCr1(soc, STOP)
      return 'ERROR'
    }
  }
  setCr1(soc, STOP)
  return 'OK'
}

/** HAL_I2C_Master_Receive — the 1-, 2-, 3-last and N-byte procedures */
function masterReceive(soc: Stm32f103, addr7: number, n: number): { st: Status; data: number[] } {
  const data: number[] = []
  if (!waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY), 0.025)) return { st: 'BUSY', data }
  clrCr1(soc, POS)
  const st = requestAddress(soc, addr7, true)
  if (st !== 'OK') return { st, data }
  const rd = () => data.push(r32(soc, I2C1 + DR) & 0xff)
  let size = n
  if (size === 0) {
    clearAddr(soc)
    setCr1(soc, STOP)
  } else if (size === 1) {
    clrCr1(soc, ACK)
    clearAddr(soc)
    setCr1(soc, STOP)
  } else if (size === 2) {
    setCr1(soc, POS)
    clearAddr(soc)
    clrCr1(soc, ACK)
  } else {
    setCr1(soc, ACK)
    clearAddr(soc)
  }
  while (size > 0) {
    if (size <= 3) {
      if (size === 1) {
        if (!waitFor(soc, () => flag(soc, I2C_SR1_RXNE))) return { st: 'TIMEOUT', data }
        rd()
        size--
      } else if (size === 2) {
        if (!waitFor(soc, () => flag(soc, I2C_SR1_BTF))) return { st: 'TIMEOUT', data }
        setCr1(soc, STOP)
        rd()
        rd()
        size -= 2
      } else {
        if (!waitFor(soc, () => flag(soc, I2C_SR1_BTF))) return { st: 'TIMEOUT', data }
        clrCr1(soc, ACK)
        rd()
        size--
        if (!waitFor(soc, () => flag(soc, I2C_SR1_BTF))) return { st: 'TIMEOUT', data }
        setCr1(soc, STOP)
        rd()
        rd()
        size -= 2
      }
    } else {
      if (!waitFor(soc, () => flag(soc, I2C_SR1_RXNE))) return { st: 'TIMEOUT', data }
      rd()
      size--
      if (flag(soc, I2C_SR1_BTF)) {
        if (size === 3) clrCr1(soc, ACK)
        rd()
        size--
      }
    }
  }
  return { st: 'OK', data }
}

/** HAL_I2C_IsDeviceReady with one trial */
function isDeviceReady(soc: Stm32f103, addr7: number): Status {
  if (!waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY), 0.025)) return 'BUSY'
  clrCr1(soc, POS)
  setCr1(soc, START)
  if (!waitFor(soc, () => flag(soc, I2C_SR1_SB))) return 'TIMEOUT'
  w32(soc, I2C1 + DR, addr7 << 1)
  waitFor(soc, () => flag(soc, I2C_SR1_ADDR) || flag(soc, I2C_SR1_AF))
  if (flag(soc, I2C_SR1_ADDR)) {
    setCr1(soc, STOP)
    clearAddr(soc)
    if (!waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY), 0.025)) return 'ERROR'
    return 'OK'
  }
  setCr1(soc, STOP)
  w32(soc, I2C1 + SR1, ~I2C_SR1_AF & 0xffff)
  if (!waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY), 0.025)) return 'ERROR'
  return 'ERROR'
}

function rising(n: Net): number[] {
  return n.edges.filter((e) => e.level === 1).map((e) => e.t)
}
function falling(n: Net): number[] {
  return n.edges.filter((e) => e.level === 0).map((e) => e.t)
}

// ------------------------------------------------------------------ tests

describe('I2C1 master (HAL sequences, bit level)', () => {
  it('HAL_I2C_Init releases the lines (SCL first: the bus sees a STOP) and leaves BUSY = 0', () => {
    const { soc, bus } = setupI2c1()
    expect(sr2(soc) & I2C_SR2_BUSY).toBe(0)
    expect(bus.scl.level).toBe(1)
    expect(bus.sda.level).toBe(1)
    // AF OD with PE = 0 pulled the lines low (GPIO AF default); PE = 1 released SCL, then SDA
    const lastScl = bus.scl.edges[bus.scl.edges.length - 1]
    const lastSda = bus.sda.edges[bus.sda.edges.length - 1]
    expect(lastScl.level).toBe(1)
    expect(lastSda.level).toBe(1)
  })

  it('Master_Transmit: EV5/EV6/EV8/EV8_2 flags, bytes on the wire, 100 kHz SCL (5 µs / 5 µs)', () => {
    const { soc, bus } = setupI2c1()
    const slave = new Slave(bus, 0x50)
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    // EV5: SR1 = SB, SR2 = MSL | BUSY (SPL I2C_EVENT_MASTER_MODE_SELECT 0x00030001)
    expect(sr1(soc)).toBe(I2C_SR1_SB)
    expect(sr2(soc) & 0xff).toBe(I2C_SR2_MSL | I2C_SR2_BUSY)
    w32(soc, I2C1 + DR, 0x50 << 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR))).toBe(true)
    // EV6 transmitter: SR1 = ADDR | TXE, SR2 = MSL | BUSY | TRA (0x00070082)
    expect(sr1(soc)).toBe(I2C_SR1_ADDR | I2C_SR1_TXE)
    expect(sr2(soc) & 0xff).toBe(I2C_SR2_MSL | I2C_SR2_BUSY | I2C_SR2_TRA) // this SR2 read (after SR1) clears ADDR
    expect(sr1(soc) & I2C_SR1_ADDR).toBe(0)
    // EV8_1: shift register idle → the first byte goes straight in, TxE stays 1
    w32(soc, I2C1 + DR, 0xa5)
    expect(sr1(soc) & I2C_SR1_TXE).toBe(I2C_SR1_TXE)
    w32(soc, I2C1 + DR, 0x3c)
    expect(sr1(soc) & I2C_SR1_TXE).toBe(0)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    // EV8_2: TxE | BTF (0x00070084)
    expect(sr1(soc)).toBe(I2C_SR1_TXE | I2C_SR1_BTF)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(sr2(soc) & 0xff).toBe(0)
    expect(sr1(soc)).toBe(0)
    expect(r32(soc, I2C1 + CR1) & STOP).toBe(0)
    expect(slave.written).toEqual([0xa5, 0x3c])
    expect(slave.starts).toBe(1)
    expect(slave.stops).toBe(1)
    // SCL timing: CCR = 180 at PCLK1 36 MHz → 5 µs high / 5 µs low; the 27 clocks (3 bytes × 9)
    // lie between the START (first SCL fall) and the STOP (last SCL rise)
    const f = falling(bus.scl)
    const clocks = rising(bus.scl).filter((t) => t > f[0]).slice(0, -1)
    expect(clocks.length).toBe(27)
    for (const t of clocks) expect((f.find((x) => x > t) ?? NaN) - t).toBeCloseTo(5e-6, 9)
    // inside a byte (no software in the loop) the period is exactly 10 µs
    const periods = clocks.map((t, i) => (i ? t - clocks[i - 1] : NaN)).filter((x) => x < 10.1e-6)
    expect(periods.length).toBeGreaterThanOrEqual(24)
    for (const p of periods) expect(p).toBeCloseTo(10e-6, 9)
  })

  it('START condition timing: SDA falls, SCL falls Thigh later; STOP: SDA rises Thigh after SCL rises', () => {
    const { soc, bus } = setupI2c1()
    new Slave(bus, 0x50)
    bus.scl.edges.length = 0
    bus.sda.edges.length = 0
    expect(masterTransmit(soc, 0x50, [0x00])).toBe('OK')
    waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))
    const sdaFall = bus.sda.edges[0]
    const sclFall = bus.scl.edges[0]
    expect(sdaFall.level).toBe(0)
    expect(sclFall.level).toBe(0)
    expect(sclFall.t - sdaFall.t).toBeCloseTo(5e-6, 9)
    const lastSda = bus.sda.edges[bus.sda.edges.length - 1]
    const lastScl = bus.scl.edges[bus.scl.edges.length - 1]
    expect(lastSda.level).toBe(1)
    expect(lastScl.level).toBe(1)
    expect(lastSda.t - lastScl.t).toBeCloseTo(5e-6, 9)
  })

  it('IsDeviceReady: ACK → ADDR, NACK → AF; STOP releases BUSY; no device → AF on every address', () => {
    const { soc, bus } = setupI2c1()
    new Slave(bus, 0x50)
    new Slave(bus, 0x68, 'rtc')
    const found: number[] = []
    for (let a = 0x08; a <= 0x77; a++) if (isDeviceReady(soc, a) === 'OK') found.push(a)
    expect(found).toEqual([0x50, 0x68])
    expect(sr2(soc) & I2C_SR2_BUSY).toBe(0)
  })

  it('Master_Receive N = 1, 2, 3, 5: data in order, ACK on all but the last byte, NACK last', () => {
    for (const n of [1, 2, 3, 5]) {
      const { soc, bus } = setupI2c1()
      const slave = new Slave(bus, 0x50)
      slave.readData = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66]
      const res = masterReceive(soc, 0x50, n)
      expect(res.st, `N=${n}`).toBe('OK')
      expect(res.data, `N=${n}`).toEqual(slave.readData.slice(0, n))
      expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
      expect(slave.masterAcks, `N=${n}`).toEqual([...new Array(n - 1).fill(true), false])
      expect(slave.stops).toBe(1)
      expect(sr1(soc) & (I2C_SR1_RXNE | I2C_SR1_BTF)).toBe(0)
    }
  })

  it('Mem_Read: write the memory address, repeated START, read 4 bytes', () => {
    const { soc, bus } = setupI2c1()
    const slave = new Slave(bus, 0x50)
    slave.readData = [1, 2, 3, 4]
    // I2C_RequestMemoryRead
    setCr1(soc, ACK)
    expect(requestAddress(soc, 0x50, false)).toBe('OK')
    clearAddr(soc)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_TXE))).toBe(true)
    w32(soc, I2C1 + DR, 0x10)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_TXE))).toBe(true)
    setCr1(soc, START) // restart after the current byte
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    expect(sr2(soc) & I2C_SR2_TRA).toBe(0) // TRA cleared by the repeated START
    w32(soc, I2C1 + DR, (0x50 << 1) | 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR))).toBe(true)
    // EV6 receiver: SR1 = ADDR, SR2 = MSL | BUSY (0x00030002)
    expect(sr1(soc)).toBe(I2C_SR1_ADDR)
    expect(sr2(soc) & 0xff).toBe(I2C_SR2_MSL | I2C_SR2_BUSY)
    const data: number[] = []
    // N = 4 → the RXNE loop then the 3-last-bytes procedure
    expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE))).toBe(true)
    data.push(r32(soc, I2C1 + DR))
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    clrCr1(soc, ACK)
    data.push(r32(soc, I2C1 + DR))
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    setCr1(soc, STOP)
    data.push(r32(soc, I2C1 + DR), r32(soc, I2C1 + DR))
    expect(data).toEqual([1, 2, 3, 4])
    expect(slave.written).toEqual([0x10])
    expect(slave.starts).toBe(2)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    // the repeated START: SDA falls while SCL is high, without a STOP before it
    expect(slave.stops).toBe(1)
  })

  it('clock stretching: the master waits for SCL and keeps Thigh − TRISE after the slave releases it', () => {
    const { soc, bus } = setupI2c1()
    const slave = new Slave(bus, 0x50)
    slave.stretch = 40e-6
    const t0 = soc.time()
    expect(masterTransmit(soc, 0x50, [0x12, 0x34])).toBe('OK')
    waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))
    expect(slave.written).toEqual([0x12, 0x34])
    // 3 bytes ≈ 3 × 90 µs + START/STOP; each stretch adds 40 − 5 µs of SCL low
    const dur = soc.time() - t0
    expect(dur).toBeGreaterThan(3 * 35e-6 + 270e-6)
    // after a stretch the high phase lasts Thigh − TRISE·TPCLK1 = 5 µs − 37/36 µs
    const r = rising(bus.scl)
    const f = falling(bus.scl)
    const highs = r.map((t) => (f.find((x) => x > t) ?? NaN) - t).filter((x) => Number.isFinite(x))
    // stretches after the address and the first data byte end in a clock; the one after the
    // last byte ends in the STOP (SDA rises Thigh − TRISE after SCL)
    const short = highs.filter((h) => h < 4.5e-6)
    expect(short.length).toBe(2)
    for (const h of short) expect(h).toBeCloseTo(5e-6 - 37 / 36e6, 9)
    const lastScl = bus.scl.edges[bus.scl.edges.length - 1]
    const lastSda = bus.sda.edges[bus.sda.edges.length - 1]
    expect(lastSda.t - lastScl.t).toBeCloseTo(5e-6 - 37 / 36e6, 9)
  })

  it('NACK on data: AF, no BTF; software STOP ends the transfer', () => {
    const { soc, bus } = setupI2c1()
    // a slave that ACKs its address and NACKs every data byte
    let state = 0
    let bits = 0
    let addr = 0
    let scl = 1
    bus.listen((net, level) => {
      if (net === 'sda' && scl === 1 && level === 0) {
        state = 1
        bits = 0
        addr = 0
      }
      if (net !== 'scl') return
      scl = level
      if (level === 1 && state === 1 && bits < 8) {
        addr = (addr << 1) | bus.sda.level
        bits++
      } else if (level === 0 && state === 1 && bits === 8) {
        if (addr >>> 1 === 0x2a) {
          bus.drive('sda', 'nacker', 0)
          state = 2
        } else state = 0
      } else if (level === 0 && state === 2) {
        bus.drive('sda', 'nacker', 1)
        state = 3
      }
    })
    expect(masterTransmit(soc, 0x2a, [0x01, 0x02])).toBe('ERROR')
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(sr1(soc) & I2C_SR1_AF).toBe(I2C_SR1_AF)
    expect(sr1(soc) & I2C_SR1_BTF).toBe(0)
    w32(soc, I2C1 + SR1, ~I2C_SR1_AF & 0xffff)
    expect(sr1(soc) & I2C_SR1_AF).toBe(0)
  })

  it('arbitration lost: another master pulls SDA low while we send a 1 → ARLO, MSL = 0, lines released', () => {
    const { soc, bus } = setupI2c1()
    // the other master holds SDA low from the 2nd SCL rising edge on (our address 0x7f has a 1 there)
    let rises = 0
    bus.listen((net, level) => {
      if (net === 'scl' && level === 0 && rises === 1) bus.drive('sda', 'other', 0)
      if (net === 'scl' && level === 1) rises++
    })
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0x7f << 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ARLO))).toBe(true)
    expect(sr2(soc) & I2C_SR2_MSL).toBe(0)
    expect(sr1(soc) & (I2C_SR1_ADDR | I2C_SR1_AF)).toBe(0)
    runFor(soc, 20e-6)
    expect(bus.scl.level).toBe(1) // our SCL released: nothing else clocks
    expect(soc.pins.drive(PB6).level).toBe(1)
    expect(soc.pins.drive(PB7).level).toBe(1)
    expect(sr2(soc) & I2C_SR2_BUSY).toBe(I2C_SR2_BUSY) // the other master owns the bus
  })

  it('no pull-ups: the lines never read high → BUSY stays set and HAL gives up with HAL_BUSY (no START)', () => {
    const { soc, bus } = setupI2c1({ pullUp: false })
    new Slave(bus, 0x50)
    expect(sr2(soc) & I2C_SR2_BUSY).toBe(I2C_SR2_BUSY)
    expect(isDeviceReady(soc, 0x50)).toBe('BUSY')
    // forcing START anyway: it waits for a bus-free STOP that never comes → no SB
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB), 0.002)).toBe(false)
    expect(bus.sda.edges.filter((e) => e.level === 1)).toEqual([])
  })

  it('a slave that never releases SCL: the master waits forever (HAL timeout), no ADDR', () => {
    const { soc, bus } = setupI2c1()
    bus.listen((net, level) => {
      if (net === 'scl' && level === 0) bus.drive('scl', 'stuck', 0)
    })
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0x50 << 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR) || flag(soc, I2C_SR1_AF), 0.003)).toBe(false)
    expect(soc.block('I2C1')).toBeDefined()
  })

  it('fast mode 400 kHz (CCR FS, DUTY = 0): Tlow = 2·Thigh', () => {
    const { soc, bus } = setupI2c1({ fast: true })
    new Slave(bus, 0x50)
    expect(masterTransmit(soc, 0x50, [0x55])).toBe('OK')
    waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))
    // CCR = 36 MHz / (3 · 400 kHz) = 30 → Thigh 0.833 µs, Tlow 1.667 µs
    // the 18 clocks between the START (first SCL fall) and the STOP (last SCL rise)
    const f = falling(bus.scl)
    const r = rising(bus.scl).filter((t) => t > f[0])
    const clocks = r.slice(0, -1)
    expect(clocks.length).toBe(18)
    for (const t of clocks) expect((f.find((x) => x > t) ?? NaN) - t).toBeCloseTo(30 / 36e6, 10)
    // low phases inside a byte (between the address/data clocks software is not involved)
    const lows = f.slice(1).map((t) => (r.find((x) => x > t) ?? NaN) - t).filter((x) => x < 1.7e-6)
    expect(lows.length).toBeGreaterThanOrEqual(15)
    for (const l of lows) expect(l).toBeCloseTo(60 / 36e6, 10)
  })

  it('event and error interrupt lines (ITEVTEN / ITBUFEN / ITERREN)', () => {
    const { soc, bus } = setupI2c1()
    new Slave(bus, 0x50)
    const core = soc.core as unknown as { irqLines: Uint8Array }
    w32(soc, I2C1 + CR2, 36 | (1 << 8) | (1 << 9)) // ITERREN | ITEVTEN
    setCr1(soc, START)
    expect(waitFor(soc, () => core.irqLines[31] === 1)).toBe(true)
    expect(flag(soc, I2C_SR1_SB)).toBe(true)
    w32(soc, I2C1 + DR, 0x51 << 1) // nobody at 0x51
    expect(core.irqLines[31]).toBe(0)
    expect(waitFor(soc, () => core.irqLines[32] === 1)).toBe(true)
    expect(flag(soc, I2C_SR1_AF)).toBe(true)
    setCr1(soc, STOP)
    w32(soc, I2C1 + SR1, ~I2C_SR1_AF & 0xffff)
    expect(core.irqLines[32]).toBe(0)
  })

  it('PEC: SR2[15:8] holds the CRC-8 of every byte of the transfer (address included)', () => {
    const { soc, bus } = setupI2c1()
    new Slave(bus, 0x50)
    setCr1(soc, 1 << 5) // ENPEC
    expect(masterTransmit(soc, 0x50, [0x01, 0x02])).toBe('OK')
    waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))
    let crc = 0
    for (const b of [0xa0, 0x01, 0x02]) crc = pecUpdate(crc, b)
    expect((sr2(soc) >>> 8) & 0xff).toBe(crc)
  })
})

describe('I2C slave mode (I2C2 slave, I2C1 master on the same bus)', () => {
  function setupPair() {
    const { soc } = makeSoc({ firmware: true })
    clock72(soc)
    set32(soc, RCC_APB2ENR, (1 << 0) | (1 << 3))
    const bus = new Bus(soc, { scl: [PB6, PB10], sda: [PB7, PB11] }, true)
    w32(soc, GPIOB + 0x00, (r32(soc, GPIOB + 0x00) & 0x00ffffff) | 0xff000000) // PB6/7
    w32(soc, GPIOB + 0x04, (r32(soc, GPIOB + 0x04) & 0xffff00ff) | 0x0000ff00) // PB10/11
    set32(soc, RCC_APB1ENR, (1 << 21) | (1 << 22))
    halInit(soc, I2C1, 100_000)
    halInit(soc, I2C2, 100_000, 0x3c)
    setCr1(soc, ACK, I2C2) // HAL_I2C_Slave_*: enable acknowledge
    return { soc, bus }
  }

  it('slave receiver: ADDR (SR2 TRA = 0), RxNE per byte, STOPF after the STOP', () => {
    const { soc } = setupPair()
    const got: number[] = []
    // master side runs as events; the slave side is polled in between
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0x3c << 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR, I2C2))).toBe(true)
    expect(sr2(soc, I2C2) & (I2C_SR2_TRA | I2C_SR2_MSL)).toBe(0)
    expect(sr2(soc, I2C2) & I2C_SR2_BUSY).toBe(I2C_SR2_BUSY)
    // the master waits for its own ADDR while the slave stretches (EV1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR), 0.0005)).toBe(true)
    clearAddr(soc)
    w32(soc, I2C1 + DR, 0xde)
    w32(soc, I2C1 + DR, 0xad)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE, I2C2))).toBe(true)
    got.push(r32(soc, I2C2 + DR))
    expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE, I2C2))).toBe(true)
    got.push(r32(soc, I2C2 + DR))
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_STOPF, I2C2))).toBe(true)
    expect(got).toEqual([0xde, 0xad])
    // STOPF: SR1 read then CR1 write
    r32(soc, I2C2 + SR1)
    w32(soc, I2C2 + CR1, r32(soc, I2C2 + CR1))
    expect(sr1(soc, I2C2) & I2C_SR1_STOPF).toBe(0)
  })

  it('slave transmitter: ADDR + TxE, bytes from DR, master NACK → AF (no STOPF)', () => {
    const { soc } = setupPair()
    setCr1(soc, ACK)
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, (0x3c << 1) | 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR, I2C2))).toBe(true)
    // EV1 slave transmitter: SR1 = ADDR | TXE, SR2 = BUSY | TRA (0x00060082)
    expect(sr1(soc, I2C2)).toBe(I2C_SR1_ADDR | I2C_SR1_TXE)
    expect(sr2(soc, I2C2) & 0xff).toBe(I2C_SR2_BUSY | I2C_SR2_TRA)
    expect(sr1(soc, I2C2) & I2C_SR1_ADDR).toBe(0)
    w32(soc, I2C2 + DR, 0x5a)
    // master: N = 2 procedure
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR))).toBe(true)
    setCr1(soc, POS)
    clearAddr(soc)
    clrCr1(soc, ACK)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_TXE, I2C2))).toBe(true)
    w32(soc, I2C2 + DR, 0xc3)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    setCr1(soc, STOP)
    const a = r32(soc, I2C1 + DR)
    const b = r32(soc, I2C1 + DR)
    expect([a, b]).toEqual([0x5a, 0xc3])
    expect(waitFor(soc, () => flag(soc, I2C_SR1_AF, I2C2))).toBe(true)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(sr1(soc, I2C2) & I2C_SR1_STOPF).toBe(0)
  })

  it('a non-matching address is ignored (master sees AF); a matching one stretches SCL until the slave clears ADDR', () => {
    const { soc, bus } = setupPair()
    expect(isDeviceReady(soc, 0x3d)).toBe('ERROR')
    expect(sr1(soc, I2C2) & I2C_SR1_ADDR).toBe(0)
    // matching address: ACK → ADDR in both; the master's STOP waits while the slave holds SCL (EV1)
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0x3c << 1)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR))).toBe(true)
    setCr1(soc, STOP)
    clearAddr(soc)
    runFor(soc, 100e-6)
    expect(bus.scl.level).toBe(0)
    expect(sr2(soc) & I2C_SR2_BUSY).toBe(I2C_SR2_BUSY)
    expect(sr1(soc, I2C2) & I2C_SR1_ADDR).toBe(I2C_SR1_ADDR)
    clearAddr(soc, I2C2) // slave software: EV1 done → SCL released → the STOP completes
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(sr1(soc, I2C2) & I2C_SR1_STOPF).toBe(I2C_SR1_STOPF)
  })
})

describe('I2C registers', () => {
  it('reset values, SWRST, PE = 0 clears ACK/POS/START', () => {
    const { soc } = setupI2c1({ init: false })
    expect(r32(soc, I2C1 + TRISE)).toBe(2)
    w32(soc, I2C1 + CR1, PE | ACK | POS)
    expect(r32(soc, I2C1 + CR1)).toBe(PE | ACK | POS)
    w32(soc, I2C1 + CR1, ACK | POS)
    expect(r32(soc, I2C1 + CR1)).toBe(0)
    w32(soc, I2C1 + CCR, 180)
    w32(soc, I2C1 + CR1, SWRST)
    expect(r32(soc, I2C1 + CCR)).toBe(0)
    w32(soc, I2C1 + CCR, 180) // ignored under reset
    expect(r32(soc, I2C1 + CCR)).toBe(0)
    w32(soc, I2C1 + CR1, 0)
    w32(soc, I2C1 + CCR, 180)
    expect(r32(soc, I2C1 + CCR)).toBe(180)
  })

  it('remap (AFIO_MAPR.I2C1_REMAP) moves SCL/SDA to PB8/PB9', () => {
    const { soc } = setupI2c1({ init: false })
    set32(soc, AFIO + 0x04, 1 << 1)
    w32(soc, GPIOB + 0x04, (r32(soc, GPIOB + 0x04) & 0xffffff00) | 0xff) // PB8/PB9 AF OD
    halInit(soc, I2C1, 100_000)
    expect(soc.pins.drive(24).af).toBe(true)
    expect(soc.pins.drive(24).level).toBe(1)
    setCr1(soc, START)
    waitFor(soc, () => flag(soc, I2C_SR1_SB))
    expect(soc.pins.drive(24).level).toBe(0) // SCL low after the START
    expect(soc.pins.drive(25).level).toBe(0)
  })
})

describe('I2C1 with DMA1 (Table 78: I2C1_RX = channel 7, I2C1_TX = channel 6)', () => {
  const DMA = 0x40020000
  const ccr = (ch: number) => DMA + 0x08 + 20 * (ch - 1)
  function channel(soc: Stm32f103, ch: number, n: number, mem: number, toPeriph: boolean): void {
    w32(soc, ccr(ch) + 4, n) // CNDTR
    w32(soc, ccr(ch) + 8, I2C1 + DR) // CPAR
    w32(soc, ccr(ch) + 12, mem) // CMAR
    w32(soc, ccr(ch), (1 << 7) | (toPeriph ? 1 << 4 : 0) | 1) // MINC | DIR | EN, 8-bit
  }
  const tcif = (soc: Stm32f103, ch: number) => (r32(soc, DMA) >>> (4 * (ch - 1) + 1)) & 1

  it('master receiver: DMA reads every byte, LAST makes the byte after EOT_1 a NACK', () => {
    const { soc, bus } = setupI2c1()
    set32(soc, RCC_AHBENR, 1)
    const slave = new Slave(bus, 0x50)
    slave.readData = [9, 8, 7, 6, 5]
    channel(soc, 7, 5, 0x20001000, false)
    w32(soc, I2C1 + CR2, 36 | (1 << 11) | (1 << 12)) // DMAEN | LAST
    setCr1(soc, ACK)
    expect(requestAddress(soc, 0x50, true)).toBe('OK')
    clearAddr(soc)
    expect(waitFor(soc, () => tcif(soc, 7) === 1)).toBe(true)
    setCr1(soc, STOP) // HAL: STOP in the DMA transfer-complete callback
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(Array.from(soc.readMemory(0x20001000, 5))).toEqual([9, 8, 7, 6, 5])
    expect(slave.masterAcks).toEqual([true, true, true, true, false])
  })

  it('master transmitter: DMA feeds DR on TxE (not during the address phase); BTF after the last byte', () => {
    const { soc, bus } = setupI2c1()
    set32(soc, RCC_AHBENR, 1)
    const slave = new Slave(bus, 0x50)
    for (let i = 0; i < 4; i++) soc.bus.write8(0x20001100 + i, 0x10 + i)
    channel(soc, 6, 4, 0x20001100, true)
    w32(soc, I2C1 + CR2, 36 | (1 << 11)) // DMAEN
    expect(requestAddress(soc, 0x50, false)).toBe('OK')
    expect(r32(soc, ccr(6) + 4)).toBe(4) // nothing moved while ADDR was pending
    clearAddr(soc)
    expect(waitFor(soc, () => tcif(soc, 6) === 1)).toBe(true)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(slave.written).toEqual([0x10, 0x11, 0x12, 0x13])
  })
})

describe('I2C master: 10-bit addressing, bus errors', () => {
  /** acknowledges every byte that follows a START (address or data) and records them */
  function ackAll(bus: Bus): number[] {
    const seen: number[] = []
    let bits = 0
    let v = 0
    let scl = 1
    let acking = false
    let active = false
    bus.listen((net, level) => {
      if (net === 'sda' && scl === 1) {
        active = level === 0 // START (or a STOP ends it)
        bits = 0
        v = 0
        return
      }
      if (net !== 'scl') return
      scl = level
      if (!active) return
      if (level === 1 && !acking) {
        v = ((v << 1) | bus.sda.level) & 0xff
        bits++
      } else if (level === 0 && bits === 8 && !acking) {
        seen.push(v)
        bus.drive('sda', 'ackall', 0)
        acking = true
      } else if (level === 0 && acking) {
        bus.drive('sda', 'ackall', 1)
        acking = false
        bits = 0
        v = 0
      }
    })
    return seen
  }

  it('OAR1.ADDMODE = 1: header 11110xx0 → ADD10 (EV9), second address byte → ADDR, TRA = 1', () => {
    const { soc, bus } = setupI2c1()
    const seen = ackAll(bus)
    w32(soc, I2C1 + OAR1, 0xc000) // ADDMODE (10-bit) | bit 14
    const addr10 = 0x2a5
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0xf0 | ((addr10 >> 7) & 6))
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADD10))).toBe(true)
    expect(sr1(soc) & I2C_SR1_ADDR).toBe(0)
    w32(soc, I2C1 + DR, addr10 & 0xff) // SR1 was read: EV9 cleared by the DR write
    expect(sr1(soc) & I2C_SR1_ADD10).toBe(0)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR))).toBe(true)
    expect(sr2(soc) & I2C_SR2_TRA).toBe(I2C_SR2_TRA)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(seen).toEqual([0xf4, 0xa5])
  })

  it('a slave that moves SDA while SCL is high (misplaced START + STOP) → BERR; the master keeps clocking', () => {
    const { soc, bus } = setupI2c1()
    const slave = new Slave(bus, 0x50)
    slave.readData = [0xff]
    // glitch SDA low → high during the 3rd SCL high phase of the data byte
    let rises = 0
    let reading = false
    bus.listen((net, level) => {
      if (net !== 'scl' || level !== 1 || !reading) return
      if (++rises === 3) {
        bus.after(2.5e-6, () => bus.drive('sda', 'glitch', 0)) // after the master's sample point (TRISE)
        bus.after(3.5e-6, () => bus.drive('sda', 'glitch', 1))
      }
    })
    setCr1(soc, ACK)
    expect(requestAddress(soc, 0x50, true)).toBe('OK')
    clrCr1(soc, ACK)
    reading = true
    clearAddr(soc)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE))).toBe(true)
    expect(sr1(soc) & I2C_SR1_BERR).toBe(I2C_SR1_BERR)
    expect(r32(soc, I2C1 + DR)).toBe(0xff)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    w32(soc, I2C1 + SR1, ~I2C_SR1_BERR & 0xffff)
    expect(sr1(soc) & I2C_SR1_BERR).toBe(0)
  })
})

describe('I2C slave: general call', () => {
  it('ENGC = 1: address 0x00 is acknowledged with SR2.GENCALL; ENGC = 0: NACK', () => {
    const { soc } = makeSoc({ firmware: true })
    clock72(soc)
    set32(soc, RCC_APB2ENR, (1 << 0) | (1 << 3))
    new Bus(soc, { scl: [PB6, PB10], sda: [PB7, PB11] }, true)
    w32(soc, GPIOB + 0x00, (r32(soc, GPIOB + 0x00) & 0x00ffffff) | 0xff000000)
    w32(soc, GPIOB + 0x04, (r32(soc, GPIOB + 0x04) & 0xffff00ff) | 0x0000ff00)
    set32(soc, RCC_APB1ENR, (1 << 21) | (1 << 22))
    halInit(soc, I2C1, 100_000)
    halInit(soc, I2C2, 100_000, 0x3c)
    setCr1(soc, ACK, I2C2)
    expect(isDeviceReady(soc, 0x00)).toBe('ERROR')
    setCr1(soc, 1 << 6, I2C2) // ENGC
    setCr1(soc, START)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_SB))).toBe(true)
    w32(soc, I2C1 + DR, 0x00)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_ADDR, I2C2))).toBe(true)
    expect(sr2(soc, I2C2) & I2C_SR2_GENCALL).toBe(I2C_SR2_GENCALL)
  })
})

describe('I2C PEC (ENPEC, CR1.PEC)', () => {
  const ENPEC = 1 << 5
  const PEC = 1 << 12
  it('transmitter: PEC set after the last data byte → the CRC-8 goes out as an extra byte', () => {
    const { soc, bus } = setupI2c1()
    const slave = new Slave(bus, 0x50)
    setCr1(soc, ENPEC)
    expect(requestAddress(soc, 0x50, false)).toBe('OK')
    clearAddr(soc)
    w32(soc, I2C1 + DR, 0x5a) // last (only) data byte
    setCr1(soc, PEC)
    expect(waitFor(soc, () => flag(soc, I2C_SR1_BTF))).toBe(true)
    setCr1(soc, STOP)
    expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
    expect(slave.written).toEqual([0x5a, pecUpdate(pecUpdate(0, 0xa0), 0x5a)])
    expect(r32(soc, I2C1 + CR1) & PEC).toBe(0) // cleared when the PEC was transferred
  })

  for (const good of [true, false]) {
    it(`receiver: PEC set after the last data byte's RxNE checks the next byte (${good ? 'match: ACK' : 'mismatch: PECERR + NACK'})`, () => {
      const { soc, bus } = setupI2c1()
      const slave = new Slave(bus, 0x50)
      const crc = pecUpdate(pecUpdate(0, 0xa1), 0x33)
      slave.readData = [0x33, good ? crc : crc ^ 0x01, 0x99]
      setCr1(soc, ENPEC)
      expect(requestAddress(soc, 0x50, true)).toBe('OK')
      clearAddr(soc)
      expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE))).toBe(true)
      setCr1(soc, PEC) // the PEC byte is already being clocked in
      expect(r32(soc, I2C1 + DR)).toBe(0x33)
      expect(waitFor(soc, () => flag(soc, I2C_SR1_RXNE))).toBe(true)
      setCr1(soc, STOP)
      r32(soc, I2C1 + DR)
      expect(waitFor(soc, () => !(sr2(soc) & I2C_SR2_BUSY))).toBe(true)
      expect(sr1(soc) & I2C_SR1_PECERR).toBe(good ? 0 : I2C_SR1_PECERR)
      expect(slave.masterAcks[1]).toBe(good)
    })
  }
})
