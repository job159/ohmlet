/**
 * Communication & memory modules (src/sim/models/comm*.ts) — protocol level,
 * on a small logic rig (named nets with optional pull-ups, device drives,
 * one external driver per net, a virtual-time event queue; inputs delivered
 * on every resolved level change like DigitalDeviceHost on logic nets).
 * Electrical behavior (RS-485 / CAN differential buses, levels, module
 * sub-circuits) and real firmware are tested through the coordinator in
 * comm-circuits.test.ts / comm-firmware.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DigitalDevice, DigitalDeviceCtx, DigitalDrive, LogicLevel } from '../../src/sim/digital/api'
import { registeredDigitalDevices } from '../../src/sim/digital/api'
import { registeredChips } from '../../src/sim/chip-api'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { ComponentInstance } from '../../src/model/types'
import { UartReceiver, UartTransmitter, parityBit } from '../../src/sim/models/comm-uart'
import type { UartFrameFormat, UartRxFrame } from '../../src/sim/models/comm-uart'
import {
  Ch340Module,
  ESP_AT_BAUD,
  ESP_BOOT_S,
  ESP_ROM_BAUD,
  Esp01Module,
  HC05_AT_BAUD,
  HC05_BOOT_S,
  Hc05Module,
  Pcf8574Module,
  SdModule,
  W25qModule,
  hc05Settings,
  resetHc05,
} from '../../src/sim/models/comm.model'
import { W25Q32_SIZE, W25Q_T, eraseW25q, w25qContents } from '../../src/sim/models/comm-flash'
import {
  SD_INIT_S,
  SD_HELLO_TEXT,
  cidOf,
  crc16,
  crc7,
  csdOf,
  eraseSdImage,
  sdGeometry,
} from '../../src/sim/models/comm-sd'

// ===================================================================== rig

interface DevSlot {
  device: DigitalDevice
  pins: Record<string, string>
  inputs: string[]
  drives: Map<string, DigitalDrive>
  delivered: Map<string, LogicLevel>
  issues: string[]
  logs: string[]
}

class Rig {
  t = 0
  private seq = 0
  private ev: { at: number; seq: number; id: number; fn: () => void }[] = []
  private nextId = 1
  private nets = new Map<string, { ext: 0 | 1 | null; pullUp: boolean }>()
  readonly devs: DevSlot[] = []
  private watchers: { net: string; fn: (l: LogicLevel) => void; last: LogicLevel | undefined }[] = []
  vdd = 3.3

  net(name: string, pullUp = false): void {
    const n = this.nets.get(name)
    if (!n) this.nets.set(name, { ext: null, pullUp })
    else if (pullUp) n.pullUp = true
  }

  add(device: DigitalDevice, pins: Record<string, string>, inputs: string[], id = 'U' + (this.devs.length + 1)): DevSlot {
    for (const n of Object.values(pins)) this.net(n)
    const slot: DevSlot = { device, pins, inputs, drives: new Map(), delivered: new Map(), issues: [], logs: [] }
    const ctx: DigitalDeviceCtx = {
      componentId: id,
      now: () => this.t,
      read: (pin) => (pins[pin] ? this.level(pins[pin]) : null),
      voltage: (pin) => {
        const l = pins[pin] ? this.level(pins[pin]) : null
        return l === null ? NaN : l * this.vdd
      },
      drive: (pin, d) => {
        slot.drives.set(pin, d)
        this.notify()
      },
      schedule: (delay, fn) => this.schedule(this.t + Math.max(0, delay), fn),
      cancel: (h) => {
        this.ev = this.ev.filter((e) => e.id !== h)
      },
      supply: () => this.vdd,
      issue: (_level, msg) => slot.issues.push(msg),
      log: (msg) => slot.logs.push(msg),
    }
    this.devs.push(slot)
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
        else if (dr === 'pull-down') weak = weak === 1 ? 1 : 0
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
    this.net(net)
    this.nets.get(net)!.ext = v
    this.notify()
  }

  watch(net: string, fn: (l: LogicLevel) => void): void {
    this.watchers.push({ net, fn, last: undefined })
    this.notify()
  }

  private notify(): void {
    for (const d of this.devs) {
      for (const pin of d.inputs) {
        const l = this.level(d.pins[pin])
        if (d.delivered.has(pin) && d.delivered.get(pin) === l) continue
        d.delivered.set(pin, l)
        d.device.onPinChange?.(pin, l)
      }
    }
    for (const w of this.watchers) {
      const l = this.level(w.net)
      if (w.last === l) continue
      w.last = l
      w.fn(l)
    }
  }

  schedule(at: number, fn: () => void): number {
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

  /** a ctx for test-side engines (UART host …) driving / reading rig nets by name */
  hostCtx(): DigitalDeviceCtx {
    return {
      componentId: 'HOST',
      now: () => this.t,
      read: (net) => this.level(net),
      voltage: () => NaN,
      drive: (net, d) => this.set(net, d === 'low' ? 0 : d === 'high' ? 1 : null),
      schedule: (delay, fn) => this.schedule(this.t + Math.max(0, delay), fn),
      cancel: (h) => {
        this.ev = this.ev.filter((e) => e.id !== h)
      },
      supply: () => this.vdd,
      issue: () => {},
      log: () => {},
    }
  }
}

/** test-side UART: transmitter on net `txNet`, receiver on net `rxNet` */
class HostUart {
  fmt: UartFrameFormat
  readonly got: UartRxFrame[] = []
  private tx: UartTransmitter
  constructor(
    private rig: Rig,
    txNet: string,
    rxNet: string,
    baud: number,
  ) {
    this.fmt = { baud, dataBits: 8, parity: 'none', stopBits: 1 }
    const ctx = rig.hostCtx()
    rig.set(txNet, 1)
    this.tx = new UartTransmitter(ctx, () => this.fmt, (l) => rig.set(txNet, l))
    const rx = new UartReceiver(ctx, () => this.fmt, (f) => this.got.push(f))
    rx.reset(rig.level(rxNet))
    rig.watch(rxNet, (l) => rx.edge(l))
  }
  send(s: string | number[]): void {
    this.tx.send(typeof s === 'string' ? Array.from(s, (c) => c.charCodeAt(0)) : s)
  }
  text(): string {
    return String.fromCharCode(...this.got.map((f) => f.byte))
  }
  clear(): void {
    this.got.length = 0
  }
}

const comp = (type: string, id: string, params?: ComponentInstance['params']): ComponentInstance => ({ id, type, params })
const entryOf = (type: string) => {
  const e = getEntry(type)
  if (!e) throw new Error(`no catalog entry ${type}`)
  return e
}
/** time for n frames of 10 bits */
const frames = (n: number, baud: number) => (n * 10) / baud

// ============================================================ UART engine

describe('UART engine (comm-uart)', () => {
  function loop(txFmt: UartFrameFormat, rxFmt: UartFrameFormat, bytes: number[]): UartRxFrame[] {
    const rig = new Rig()
    const ctx = rig.hostCtx()
    rig.set('L', 1)
    const got: UartRxFrame[] = []
    const rx = new UartReceiver(ctx, () => rxFmt, (f) => got.push(f))
    rx.reset(1)
    rig.watch('L', (l) => rx.edge(l))
    const tx = new UartTransmitter(ctx, () => txFmt, (l) => rig.set('L', l))
    tx.send(bytes)
    rig.run((bytes.length * 13) / Math.min(txFmt.baud, rxFmt.baud) + 1e-3)
    return got
  }
  const f8n1 = (baud: number): UartFrameFormat => ({ baud, dataBits: 8, parity: 'none', stopBits: 1 })

  it('decodes back-to-back 8N1 frames at the same baud', () => {
    const data = [...'Hello, UART!\r\n'].map((c) => c.charCodeAt(0)).concat([0x00, 0xff, 0x55, 0xaa])
    const got = loop(f8n1(115200), f8n1(115200), data)
    expect(got.map((f) => f.byte)).toEqual(data)
    expect(got.every((f) => !f.framingError && !f.parityError)).toBe(true)
  })

  it('parity and two stop bits are produced and checked; a parity mismatch is flagged', () => {
    const even: UartFrameFormat = { baud: 9600, dataBits: 8, parity: 'even', stopBits: 2 }
    expect(loop(even, even, [0x31, 0x32]).map((f) => [f.byte, f.parityError])).toEqual([
      [0x31, false],
      [0x32, false],
    ])
    const odd: UartFrameFormat = { ...even, parity: 'odd' }
    const got = loop(even, odd, [0x31])
    expect(got[0].parityError).toBe(true)
    expect(parityBit(0x31, 8, 'even')).toBe(1) // 0x31 has three 1-bits
  })

  it('a baud mismatch yields garbage and framing errors, exactly like a real adapter', () => {
    const data = Array.from('ohmlet', (c) => c.charCodeAt(0))
    const fast = loop(f8n1(115200), f8n1(9600), data)
    expect(fast.map((f) => f.byte)).not.toEqual(data)
    const slow = loop(f8n1(9600), f8n1(115200), data)
    expect(slow.length).toBeGreaterThan(data.length) // one slow bit looks like several fast frames
    expect(slow.some((f) => f.framingError)).toBe(true)
  })

  it('a line held low is a break (framing error, all zeros) and the receiver waits for the line to rise', () => {
    const rig = new Rig()
    const ctx = rig.hostCtx()
    rig.set('L', 1)
    const got: UartRxFrame[] = []
    const rx = new UartReceiver(ctx, () => f8n1(9600), (f) => got.push(f))
    rx.reset(1)
    rig.watch('L', (l) => rx.edge(l))
    rig.set('L', 0)
    rig.run(5e-3)
    expect(got.length).toBe(1)
    expect(got[0]).toMatchObject({ byte: 0, framingError: true, isBreak: true })
    rig.set('L', 1)
    rig.run(1e-3)
    expect(got.length).toBe(1)
  })

  it('a glitch shorter than half a bit is a false start', () => {
    const rig = new Rig()
    const ctx = rig.hostCtx()
    rig.set('L', 1)
    const got: UartRxFrame[] = []
    const rx = new UartReceiver(ctx, () => f8n1(9600), (f) => got.push(f))
    rx.reset(1)
    rig.watch('L', (l) => rx.edge(l))
    rig.set('L', 0)
    rig.run(10e-6)
    rig.set('L', 1)
    rig.run(3e-3)
    expect(got).toEqual([])
  })
})

// ================================================================= CH340

describe('CH340 USB-to-TTL module', () => {
  function ch340(params?: ComponentInstance['params']) {
    const rig = new Rig()
    const dev = new Ch340Module(comp('usb_uart_ch340', 'CH1', params), entryOf('usb_uart_ch340'))
    const slot = rig.add(dev, { TXD: 'TXD', RXD: 'RXD', DTR: 'DTR' }, ['RXD'], 'CH1')
    const pc: { byte: number; t: number }[] = []
    dev.port.onHostRx = (byte, t) => pc.push({ byte, t })
    return { rig, dev, slot, pc }
  }

  it('COM port → TXD at the port baud; MCU TX on RXD → COM port with exact timestamps', () => {
    const { rig, dev, pc } = ch340({ baud: '9600' })
    const mcu = new HostUart(rig, 'RXD', 'TXD', 9600)
    dev.port.hostSend(new Uint8Array([0x68, 0x69]))
    rig.run(frames(2, 9600) + 1e-4)
    expect(mcu.text()).toBe('hi')
    const t0 = rig.t
    mcu.send('OK')
    rig.run(frames(2, 9600) + 1e-4)
    expect(pc.map((p) => p.byte)).toEqual([0x4f, 0x4b])
    // first byte decoded at the middle of its stop bit: 9.5 bit times after its start
    expect(pc[0].t - t0).toBeCloseTo(9.5 / 9600, 7)
    expect(dev.telemetry().values).toMatchObject({ rxBytes: 2, txBytes: 2, framingErrors: 0 })
  })

  it('a port opened at the wrong baud receives garbage with framing errors', () => {
    const { rig, dev, pc } = ch340({ baud: '115200' })
    const mcu = new HostUart(rig, 'RXD', 'TXD', 9600)
    mcu.send('Hello')
    rig.run(frames(5, 9600) + 1e-3)
    expect(String.fromCharCode(...pc.map((p) => p.byte))).not.toBe('Hello')
    expect(dev.framingErrors).toBeGreaterThan(0)
    // the user fixes the terminal setting at run time: clean bytes from then on
    dev.setParam('baud', '9600')
    pc.length = 0
    mcu.send('Hello')
    rig.run(frames(5, 9600) + 1e-3)
    expect(String.fromCharCode(...pc.map((p) => p.byte))).toBe('Hello')
  })

  it('DTR follows the "DTR asserted" param (active low); RXD idles high on its pull-up', () => {
    const { rig, dev, slot } = ch340()
    expect(rig.level('DTR')).toBe(1)
    dev.setParam('dtr', true)
    expect(rig.level('DTR')).toBe(0)
    expect(slot.drives.get('RXD')).toBe('pull-up')
    expect(rig.level('TXD')).toBe(1)
  })
})

// ================================================================= HC-05

describe('HC-05 Bluetooth module', () => {
  beforeEach(() => {
    for (const id of ['BT1', 'BT2', 'BT3']) resetHc05(id)
  })

  function hc05(en: 0 | 1 | null, id = 'BT1', phone = true) {
    const rig = new Rig()
    rig.net('TXD', true) // the module's 1 kΩ pull-up to its 3.3 V rail
    rig.net('STATE', true)
    rig.set('EN', en)
    const dev = new Hc05Module(comp('hc05_bt', id, { phone }), entryOf('hc05_bt'))
    rig.add(dev, { RXD: 'RXD', TXD: 'TXD', STATE: 'STATE', EN: 'EN' }, ['RXD', 'EN'], id)
    const phoneRx: number[] = []
    dev.port.onHostRx = (b) => phoneRx.push(b)
    return { rig, dev, phoneRx }
  }

  async function at(rig: Rig, u: HostUart, cmd: string): Promise<string> {
    u.clear()
    u.send(cmd + '\r\n')
    rig.run(frames(cmd.length + 2, u.fmt.baud) + frames(40, u.fmt.baud))
    return u.text()
  }

  it('EN high at power-up: AT mode at 38400 8N1 with the datasheet answers', async () => {
    const { rig, dev } = hc05(1)
    rig.run(HC05_BOOT_S + 1e-3)
    expect(dev.mode).toBe('at')
    const u = new HostUart(rig, 'RXD', 'TXD', HC05_AT_BAUD)
    expect(await at(rig, u, 'AT')).toBe('OK\r\n')
    expect(await at(rig, u, 'AT+VERSION?')).toBe('+VERSION:2.0-20100601\r\nOK\r\n')
    expect(await at(rig, u, 'AT+NAME?')).toBe('+NAME:HC-05\r\nOK\r\n')
    expect(await at(rig, u, 'AT+NAME=OHMLET')).toBe('OK\r\n')
    expect(await at(rig, u, 'AT+NAME?')).toBe('+NAME:OHMLET\r\nOK\r\n')
    expect(await at(rig, u, 'AT+UART?')).toBe('+UART:9600,0,0\r\nOK\r\n')
    expect(await at(rig, u, 'AT+UART=12345,0,0')).toBe('ERROR:(12)\r\n')
    expect(await at(rig, u, 'AT+UART=115200,1,0')).toBe('OK\r\n')
    expect(await at(rig, u, 'AT+UART?')).toBe('+UART:115200,1,0\r\nOK\r\n')
    expect(await at(rig, u, 'AT+ROLE?')).toBe('+ROLE:0\r\nOK\r\n')
    expect(await at(rig, u, 'AT+ROLE=5')).toBe('ERROR:(11)\r\n')
    expect(await at(rig, u, 'AT+PSWD?')).toBe('+PSWD:1234\r\nOK\r\n')
    expect(await at(rig, u, 'AT+FOO')).toBe('ERROR:(0)\r\n')
    expect(await at(rig, u, 'hello')).toBe('ERROR:(0)\r\n')
    expect(rig.level('STATE')).toBe(0)
  })

  it('AT commands at the wrong baud get no answer', async () => {
    const { rig } = hc05(1)
    rig.run(HC05_BOOT_S + 1e-3)
    const u = new HostUart(rig, 'RXD', 'TXD', 9600)
    expect(await at(rig, u, 'AT')).not.toContain('OK')
  })

  it('AT+RESET with EN low restarts in data mode at the stored baud, bridged to the phone (BT port)', async () => {
    const { rig, dev, phoneRx } = hc05(1)
    rig.run(HC05_BOOT_S + 1e-3)
    const u = new HostUart(rig, 'RXD', 'TXD', HC05_AT_BAUD)
    expect(await at(rig, u, 'AT+UART=57600,0,0')).toBe('OK\r\n')
    rig.set('EN', 0)
    expect(await at(rig, u, 'AT+RESET')).toBe('OK\r\n')
    rig.run(HC05_BOOT_S + 1e-3)
    expect(dev.mode).toBe('data')
    expect(rig.level('STATE')).toBe(1)
    const d = new HostUart(rig, 'RXD', 'TXD', 57600)
    d.send('ping')
    rig.run(frames(4, 57600) + 1e-4)
    expect(String.fromCharCode(...phoneRx)).toBe('ping')
    dev.port.hostSend(new Uint8Array([0x70, 0x6f, 0x6e, 0x67]))
    rig.run(frames(4, 57600) + 1e-4)
    expect(d.text()).toBe('pong')
    expect(dev.port.config()).toMatchObject({ enabled: true, baud: 57600 })
  })

  it('settings live in the module flash: they survive a power cycle', async () => {
    {
      const { rig } = hc05(1, 'BT2')
      rig.run(HC05_BOOT_S + 1e-3)
      const u = new HostUart(rig, 'RXD', 'TXD', HC05_AT_BAUD)
      expect(await at(rig, u, 'AT+NAME=ROBOT')).toBe('OK\r\n')
    }
    expect(hc05Settings('BT2').name).toBe('ROBOT')
    const { rig, dev } = hc05(0, 'BT2')
    rig.run(HC05_BOOT_S + 1e-3)
    expect(dev.mode).toBe('data')
    expect(dev.settings.name).toBe('ROBOT')
  })

  it('without a phone link: STATE low, serial data discarded, phone bytes dropped (logged)', () => {
    const { rig, dev, phoneRx } = hc05(0, 'BT3', false)
    rig.run(HC05_BOOT_S + 1e-3)
    expect(dev.mode).toBe('data')
    expect(rig.level('STATE')).toBe(0)
    const d = new HostUart(rig, 'RXD', 'TXD', 9600)
    d.send('x')
    rig.run(frames(1, 9600) + 1e-4)
    expect(phoneRx).toEqual([])
    dev.port.hostSend(new Uint8Array([0x41]))
    rig.run(frames(1, 9600) + 1e-4)
    expect(d.got).toEqual([])
    dev.setParam('phone', true)
    expect(rig.level('STATE')).toBe(1)
  })
})

// ================================================================ ESP-01

describe('ESP-01 (AT subset, no Wi-Fi)', () => {
  function esp(chpd: 0 | 1 | null, gpio0: 0 | 1 | null = null) {
    const rig = new Rig()
    rig.set('CH_PD', chpd)
    rig.set('GPIO0', gpio0)
    rig.set('RST', 1)
    const dev = new Esp01Module()
    const slot = rig.add(dev, { RXD: 'RXD', TXD: 'TXD', CH_PD: 'CH_PD', RST: 'RST', GPIO0: 'GPIO0', GPIO2: 'GPIO2' }, ['RXD', 'CH_PD', 'RST', 'GPIO0', 'GPIO2'])
    return { rig, dev, slot }
  }

  it('CH_PD open: the chip stays off (TXD released)', () => {
    const { rig, dev, slot } = esp(null)
    rig.run(0.5)
    expect(dev.mode).toBe('off')
    expect(slot.drives.get('TXD')).toBe('z')
  })

  it('boot: ROM banner at 74880 baud, then "ready" and AT commands at 115200', () => {
    const { rig } = esp(null)
    const rom = new HostUart(rig, 'RXD', 'TXD', ESP_ROM_BAUD)
    rig.set('CH_PD', 1)
    rig.run(0.01)
    expect(rom.text()).toContain('ets Jan  8 2013,rst cause:1, boot mode:(3,7)')
    const u = new HostUart(rig, 'RXD', 'TXD', ESP_AT_BAUD)
    rig.run(ESP_BOOT_S)
    expect(u.text()).toBe('\r\nready\r\n')
    u.clear()
    u.send('AT\r\n')
    rig.run(frames(12, ESP_AT_BAUD))
    expect(u.text()).toBe('AT\r\n\r\nOK\r\n') // echo + answer
    u.clear()
    u.send('ATE0\r\n')
    rig.run(frames(16, ESP_AT_BAUD))
    u.clear()
    u.send('AT+GMR\r\n')
    rig.run(frames(200, ESP_AT_BAUD))
    expect(u.text()).toMatch(/^AT version:1\.7\.4\.0.*\r\nOK\r\n$/s)
    u.clear()
    u.send('AT+CWMODE?\r\n')
    rig.run(frames(30, ESP_AT_BAUD))
    expect(u.text()).toBe('+CWMODE:1\r\n\r\nOK\r\n')
  })

  it('network commands answer ERROR (Wi-Fi is not simulated) and log it once', () => {
    const { rig, slot } = esp(1)
    rig.run(ESP_BOOT_S + 0.01)
    const u = new HostUart(rig, 'RXD', 'TXD', ESP_AT_BAUD)
    u.send('AT+CWJAP="lab","secret"\r\n')
    rig.run(frames(60, ESP_AT_BAUD))
    expect(u.text().endsWith('\r\nERROR\r\n')).toBe(true)
    expect(slot.logs.some((l) => /Wi-Fi is not simulated/.test(l))).toBe(true)
  })

  it('GPIO0 low at reset: UART download mode — the AT firmware never says ready', () => {
    const { rig, dev } = esp(null, 0)
    const rom = new HostUart(rig, 'RXD', 'TXD', ESP_ROM_BAUD)
    rig.set('CH_PD', 1)
    rig.run(0.5)
    expect(dev.mode).toBe('download')
    expect(rom.text()).toContain('boot mode:(1,7)')
    expect(rom.text()).toContain('waiting for host')
  })
})

// ================================================================ W25Q32

describe('W25Q32 SPI flash', () => {
  beforeEach(() => {
    for (const id of ['F1', 'F2', 'F3']) eraseW25q(id)
  })

  function flash(id = 'F1') {
    const rig = new Rig()
    rig.set('WP', 1)
    rig.set('HOLD', 1)
    const dev = new W25qModule(id)
    const slot = rig.add(dev, { CS: 'CS', CLK: 'SCK', DI: 'MOSI', DO: 'MISO', WP: 'WP', HOLD: 'HOLD' }, ['CS', 'CLK', 'DI', 'WP', 'HOLD'], id)
    const m = new SpiMaster(rig)
    return { rig, dev, slot, m }
  }
  const addr = (a: number) => [(a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff]
  const status = (m: SpiMaster) => m.tx([0x05], 1)[1]

  it('JEDEC ID EF 40 16, manufacturer / device ID EF 15, erased array reads FF', () => {
    const { m } = flash()
    expect(m.tx([0x9f], 3).slice(1)).toEqual([0xef, 0x40, 0x16])
    expect(m.tx([0x90, 0, 0, 0], 2).slice(4)).toEqual([0xef, 0x15])
    expect(m.tx([0x03, ...addr(0x123456)], 4).slice(4)).toEqual([0xff, 0xff, 0xff, 0xff])
    // DO is released while the instruction / address are clocked in
    expect(m.tx([0x03, ...addr(0)]).every((b) => b === 0xff)).toBe(true)
  })

  it('page program needs WEL, is BUSY ≈ tPP, clears WEL, then reads back (03h and 0Bh)', () => {
    const { rig, m, dev } = flash()
    m.tx([0x02, ...addr(0x1000), 1, 2, 3]) // no WREN: ignored
    expect(status(m) & 0x03).toBe(0)
    expect(m.tx([0x03, ...addr(0x1000)], 3).slice(4)).toEqual([0xff, 0xff, 0xff])
    m.tx([0x06])
    expect(status(m)).toBe(0x02) // WEL
    m.tx([0x02, ...addr(0x1000), 0xde, 0xad, 0xbe, 0xef])
    expect(status(m) & 0x01).toBe(1) // BUSY
    // commands other than status reads are ignored while busy
    expect(m.tx([0x9f], 3).slice(1)).toEqual([0xff, 0xff, 0xff])
    rig.run(W25Q_T.pp)
    expect(status(m)).toBe(0x00)
    expect(m.tx([0x03, ...addr(0x1000)], 4).slice(4)).toEqual([0xde, 0xad, 0xbe, 0xef])
    expect(m.tx([0x0b, ...addr(0x1001), 0x00], 2).slice(5)).toEqual([0xad, 0xbe])
    expect(dev.flash.programs).toBe(1)
  })

  it('page wrap: data past the 256-byte page boundary wraps to the page start; programming only clears bits', () => {
    const { rig, m } = flash()
    m.tx([0x06])
    m.tx([0x02, ...addr(0x20fe), 0x11, 0x22, 0x33, 0x44])
    rig.run(W25Q_T.pp)
    expect(m.tx([0x03, ...addr(0x20fe)], 2).slice(4)).toEqual([0x11, 0x22])
    expect(m.tx([0x03, ...addr(0x2000)], 2).slice(4)).toEqual([0x33, 0x44])
    m.tx([0x06])
    m.tx([0x02, ...addr(0x2000), 0xf0])
    rig.run(W25Q_T.pp)
    expect(m.tx([0x03, ...addr(0x2000)], 1)[4]).toBe(0x33 & 0xf0)
  })

  it('sector erase: BUSY for tSE (45 ms), erases exactly 4 KiB; a CS rise inside a byte cancels it', () => {
    const { rig, m } = flash()
    const mem = w25qContents('F1')
    mem.fill(0x00, 0x3000, 0x5000)
    // CS rising mid-byte: not executed
    m.tx([0x06])
    m.select()
    for (const b of [0x20, ...addr(0x3000)]) m.xfer(b)
    // two extra clocks of a 5th byte
    m.partial(2)
    m.deselect()
    expect(status(m) & 0x01).toBe(0)
    m.tx([0x06])
    m.tx([0x20, ...addr(0x3abc)])
    let polls = 0
    const t0 = rig.t
    while (status(m) & 0x01) {
      rig.run(1e-3)
      polls++
      expect(polls).toBeLessThan(100)
    }
    expect(rig.t - t0).toBeGreaterThanOrEqual(W25Q_T.se - 1e-3)
    expect(rig.t - t0).toBeLessThan(W25Q_T.se + 2e-3)
    expect(mem[0x2fff]).toBe(0xff)
    expect(mem[0x3000]).toBe(0xff)
    expect(mem[0x3fff]).toBe(0xff)
    expect(mem[0x4000]).toBe(0x00) // next sector untouched
  })

  it('block protection (BP bits) blocks program / erase of the protected range; SRP + /WP lock the status register', () => {
    const { rig, m, slot } = flash('F2')
    m.tx([0x06])
    m.tx([0x01, 0x04]) // BP0 = 1, TB = 0: upper 64 KiB protected
    rig.run(W25Q_T.w)
    expect(status(m) & 0x1c).toBe(0x04)
    m.tx([0x06])
    m.tx([0x02, ...addr(W25Q32_SIZE - 16), 0x00])
    rig.run(W25Q_T.pp)
    expect(m.tx([0x03, ...addr(W25Q32_SIZE - 16)], 1)[4]).toBe(0xff)
    expect(slot.logs.some((l) => /block-protected/.test(l))).toBe(true)
    m.tx([0x06])
    m.tx([0x02, ...addr(0x100), 0x00])
    rig.run(W25Q_T.pp)
    expect(m.tx([0x03, ...addr(0x100)], 1)[4]).toBe(0x00)
    // SRP = 1 and /WP low: status register hardware-protected
    m.tx([0x06])
    m.tx([0x01, 0x84])
    rig.run(W25Q_T.w)
    rig.set('WP', 0)
    m.tx([0x06])
    m.tx([0x01, 0x00])
    rig.run(W25Q_T.w)
    expect(status(m) & 0x9c).toBe(0x84)
  })

  it('power-down ignores everything but ABh; ABh releases after tRES1; /HOLD pauses the interface', () => {
    const { rig, m } = flash('F3')
    m.tx([0xb9])
    rig.run(W25Q_T.dp)
    expect(m.tx([0x9f], 3).slice(1)).toEqual([0xff, 0xff, 0xff])
    expect(m.tx([0xab, 0, 0, 0], 1)[4]).toBe(0x15)
    rig.run(W25Q_T.res1)
    expect(m.tx([0x9f], 3).slice(1)).toEqual([0xef, 0x40, 0x16])
    // /HOLD low mid-transfer: clocks ignored, DO released
    m.select()
    m.xfer(0x9f)
    rig.set('HOLD', 0)
    expect(m.xfer(0xff)).toBe(0xff) // floating DO, clocks ignored
    rig.set('HOLD', 1)
    expect(m.xfer(0xff)).toBe(0xef)
    m.deselect()
  })
})

// =============================================================== SD card

describe('micro-SD card (SPI mode)', () => {
  beforeEach(() => {
    for (const id of ['SD1', 'SD2', 'SD3', 'SD4']) eraseSdImage(id)
  })

  function sd(id = 'SD1', card = 'sdhc') {
    const rig = new Rig()
    rig.net('MISO', true) // the module's pull-up to its 3.3 V rail
    const dev = new SdModule(id, comp('sd_card_spi', id, { card }), entryOf('sd_card_spi'))
    const slot = rig.add(dev, { CS: 'CS', SCK: 'SCK', MOSI: 'MOSI', MISO: 'MISO' }, ['CS', 'SCK', 'MOSI'], id)
    const m = new SpiMaster(rig)
    m.half = 1.25e-6 // 400 kHz
    return { rig, dev, slot, m }
  }

  /** send one command, return R1 and `extra` following bytes */
  function cmd(m: SpiMaster, index: number, arg: number, extra = 0, crc?: number): number[] {
    const b = [0x40 | index, (arg >>> 24) & 0xff, (arg >>> 16) & 0xff, (arg >>> 8) & 0xff, arg & 0xff]
    b.push(crc ?? ((crc7(b) << 1) | 1))
    m.select()
    for (const x of b) m.xfer(x)
    let r1 = 0xff
    for (let i = 0; i < 8 && r1 === 0xff; i++) r1 = m.xfer(0xff)
    const out = [r1]
    for (let i = 0; i < extra; i++) out.push(m.xfer(0xff))
    m.deselect()
    return out
  }

  function init(rig: Rig, m: SpiMaster, hcs = true): number {
    m.idleClocks(80)
    expect(cmd(m, 0, 0)[0]).toBe(0x01)
    expect(cmd(m, 8, 0x1aa, 4)).toEqual([0x01, 0x00, 0x00, 0x01, 0xaa])
    let tries = 0
    for (;;) {
      cmd(m, 55, 0)
      const r = cmd(m, 41, hcs ? 0x40000000 : 0)[0]
      tries++
      if (r === 0x00) break
      rig.run(1e-3)
      if (tries > 200) throw new Error('ACMD41 never ready')
    }
    return tries
  }

  /** CMD17 + wait for the data token: [block, crcOk] */
  function readBlock(m: SpiMaster, arg: number): { data: number[]; crcOk: boolean; waits: number } {
    m.select()
    const b = [0x51, (arg >>> 24) & 0xff, (arg >>> 16) & 0xff, (arg >>> 8) & 0xff, arg & 0xff, 0xff]
    for (const x of b) m.xfer(x)
    let r1 = 0xff
    while (r1 === 0xff) r1 = m.xfer(0xff)
    expect(r1).toBe(0x00)
    let tok = 0xff
    let waits = 0
    while (tok === 0xff) {
      tok = m.xfer(0xff)
      waits++
      expect(waits).toBeLessThan(5000)
    }
    expect(tok).toBe(0xfe)
    const data: number[] = []
    for (let i = 0; i < 512; i++) data.push(m.xfer(0xff))
    const c = (m.xfer(0xff) << 8) | m.xfer(0xff)
    m.deselect()
    return { data, crcOk: c === crc16(data), waits }
  }

  it('CRC7 / CRC16 reference values (CMD0 → 95h, CMD8(1AAh) → 87h, 512 × FFh → 7FA1h)', () => {
    expect((crc7([0x40, 0, 0, 0, 0]) << 1) | 1).toBe(0x95)
    expect((crc7([0x48, 0, 0, 1, 0xaa]) << 1) | 1).toBe(0x87)
    expect(crc16(new Uint8Array(512).fill(0xff))).toBe(0x7fa1)
  })

  it('without ≥ 74 clocks after power-up CMD0 gets no answer (and an issue says why)', () => {
    const { m, slot } = sd()
    m.idleClocks(10)
    expect(cmd(m, 0, 0)[0]).toBe(0xff)
    expect(slot.issues.some((i) => /74 clocks/.test(i))).toBe(true)
    m.idleClocks(80)
    expect(cmd(m, 0, 0)[0]).toBe(0x01)
  })

  it('CMD0 needs a valid CRC in SD mode; idle state answers illegal command to data commands', () => {
    const { m } = sd()
    m.idleClocks(80)
    expect(cmd(m, 0, 0, 0, 0x01)[0]).toBe(0xff) // bad CRC: no response, still SD mode
    expect(cmd(m, 0, 0)[0]).toBe(0x01)
    expect(cmd(m, 17, 0)[0]).toBe(0x05) // idle + illegal
    expect(cmd(m, 8, 0x1aa, 0, 0x01)[0]).toBe(0x09) // CMD8 CRC is always checked
  })

  it('ACMD41 initialization: idle for SD_INIT_S, then ready; OCR busy / CCS bits; SDHC stays idle without HCS', () => {
    const a = sd('SD1')
    a.m.idleClocks(80)
    cmd(a.m, 0, 0)
    expect(cmd(a.m, 58, 0, 4)).toEqual([0x01, 0x00, 0xff, 0x80, 0x00])
    const t0 = a.rig.t
    const tries = init(a.rig, a.m)
    expect(a.rig.t - t0).toBeGreaterThanOrEqual(SD_INIT_S - 2e-3)
    expect(tries).toBeGreaterThan(10)
    expect(cmd(a.m, 58, 0, 4)).toEqual([0x00, 0xc0, 0xff, 0x80, 0x00])
    const b = sd('SD2')
    b.m.idleClocks(80)
    cmd(b.m, 0, 0)
    cmd(b.m, 8, 0x1aa, 4)
    for (let i = 0; i < 60; i++) {
      cmd(b.m, 55, 0)
      expect(cmd(b.m, 41, 0)[0]).toBe(0x01)
      b.rig.run(1e-3)
    }
  })

  it('reads the MBR, the FAT32 boot sector, the root directory and HELLO.TXT of the formatted SDHC image', () => {
    const { rig, m } = sd()
    init(rig, m)
    const g = sdGeometry('sdhc', 'SD1')
    const mbr = readBlock(m, 0)
    expect(mbr.crcOk).toBe(true)
    expect(mbr.waits).toBeGreaterThan(2) // Nac: the token comes after the read access time
    expect([mbr.data[510], mbr.data[511]]).toEqual([0x55, 0xaa])
    expect(mbr.data[446 + 4]).toBe(0x0c)
    const lba = mbr.data[454] | (mbr.data[455] << 8) | (mbr.data[456] << 16) | (mbr.data[457] << 24)
    expect(lba).toBe(8192)
    const vbr = readBlock(m, lba).data // SDHC: block address
    const s = (o: number, n: number) => String.fromCharCode(...vbr.slice(o, o + n))
    expect(s(82, 8)).toBe('FAT32   ')
    expect(s(71, 11)).toBe('OHMLET SD  ')
    expect(vbr[13]).toBe(64)
    expect(vbr[11] | (vbr[12] << 8)).toBe(512)
    const fatSz = vbr[36] | (vbr[37] << 8) | (vbr[38] << 16)
    expect(fatSz).toBe(g.fatSz)
    const rsvd = vbr[14] | (vbr[15] << 8)
    const root = lba + rsvd + 2 * fatSz
    const dir = readBlock(m, root).data
    expect(String.fromCharCode(...dir.slice(32, 43))).toBe('HELLO   TXT')
    const cl = dir[32 + 26] | (dir[32 + 27] << 8)
    const size = dir[32 + 28] | (dir[32 + 29] << 8)
    const file = readBlock(m, root + (cl - 2) * 64).data
    expect(String.fromCharCode(...file.slice(0, size))).toBe(SD_HELLO_TEXT)
  })

  it('CMD24 write: data response 05h, busy (DO low) while programming, then reads back; CRC on rejects a bad block (0Bh)', () => {
    const { rig, m, dev } = sd('SD3')
    init(rig, m)
    const data = Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff)
    const write = (crcByte?: number) => {
      m.select()
      const b = [0x58, 0, 0, 0x10, 0x00]
      b.push((crc7(b) << 1) | 1)
      for (const x of b) m.xfer(x)
      let r1 = 0xff
      while (r1 === 0xff) r1 = m.xfer(0xff)
      expect(r1).toBe(0x00)
      m.xfer(0xff)
      m.xfer(0xfe)
      for (const x of data) m.xfer(x)
      const c = crc16(data)
      m.xfer(crcByte ?? c >>> 8)
      m.xfer(c & 0xff)
      const resp = m.xfer(0xff) & 0x1f
      let busy = 0
      while (m.xfer(0xff) === 0x00) busy++
      m.deselect()
      return { resp, busy }
    }
    const w = write()
    expect(w.resp).toBe(0x05)
    expect(w.busy).toBeGreaterThan(10)
    expect(readBlock(m, 0x1000).data).toEqual(data)
    expect(dev.card.blocksWritten).toBe(1)
    expect(cmd(m, 59, 1)[0]).toBe(0x00) // CRC on
    expect(write(0x00).resp).toBe(0x0b)
    // a command with a bad CRC is now rejected with the COM CRC bit
    expect(cmd(m, 13, 0, 0, 0x01)[0]).toBe(0x08)
  })

  it('CSD / CID: capacity from C_SIZE, CRC7 valid; SDSC uses byte addresses and FAT16', () => {
    const g = sdGeometry('sdhc', 'X')
    const csd = csdOf(g)
    expect(csd[0] >> 6).toBe(1)
    const cSize = ((csd[7] & 0x3f) << 16) | (csd[8] << 8) | csd[9]
    expect((cSize + 1) * 512 * 1024).toBe(4 * 1024 ** 3)
    expect(csd[15]).toBe((crc7(csd, 15) << 1) | 1)
    const cid = cidOf('SD1')
    expect(String.fromCharCode(...cid.slice(3, 8))).toBe('OHMLT')
    expect(cid[15]).toBe((crc7(cid, 15) << 1) | 1)

    const { rig, m } = sd('SD4', 'sdsc')
    init(rig, m, false)
    expect(cmd(m, 58, 0, 4)).toEqual([0x00, 0x80, 0xff, 0x80, 0x00]) // CCS = 0
    expect(cmd(m, 17, 100)[0]).toBe(0x20) // misaligned byte address
    const mbr = readBlock(m, 0).data
    const lba = mbr[454] | (mbr[455] << 8)
    expect(mbr[446 + 4]).toBe(0x06)
    const vbr = readBlock(m, lba * 512).data
    expect(String.fromCharCode(...vbr.slice(54, 62))).toBe('FAT16   ')
    const csd1 = csdOf(sdGeometry('sdsc', 'SD4'))
    expect(csd1[0] >> 6).toBe(0)
  })
})

// =============================================================== PCF8574

describe('PCF8574 I/O expander', () => {
  /** bit-banged I²C master on SCL / SDA (open drain), 100 kHz */
  class I2c {
    h = 5e-6
    constructor(private rig: Rig) {}
    private scl(v: 0 | 1) {
      this.rig.set('SCL', v ? null : 0)
    }
    private sda(v: 0 | 1) {
      this.rig.set('SDA', v ? null : 0)
    }
    start() {
      this.sda(1)
      this.scl(1)
      this.rig.run(this.h)
      this.sda(0)
      this.rig.run(this.h)
      this.scl(0)
    }
    stop() {
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
  }

  function pcf(address = '0x20') {
    const rig = new Rig()
    rig.net('SCL', true)
    rig.net('SDA', true)
    const dev = new Pcf8574Module(comp('pcf8574_module', 'X1', { address }), entryOf('pcf8574_module'))
    const pins: Record<string, string> = { SCL: 'SCL', SDA: 'SDA', INT: 'INT' }
    for (let i = 0; i < 8; i++) pins[`P${i}`] = `P${i}`
    rig.net('INT', true)
    rig.add(dev, pins, ['SCL', 'SDA', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'], 'X1')
    return { rig, dev, bus: new I2c(rig) }
  }

  it('power-on: all ports weakly high; a write sets the latch (0 = strong low, 1 = weak high)', () => {
    const { rig, bus, dev } = pcf()
    for (let i = 0; i < 8; i++) expect(rig.level(`P${i}`)).toBe(1)
    bus.start()
    expect(bus.write(0x40)).toBe(true)
    expect(bus.write(0xa5)).toBe(true)
    bus.stop()
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => rig.level(`P${i}`))).toEqual([1, 0, 1, 0, 0, 1, 0, 1])
    expect(dev.latch).toBe(0xa5)
    // a weak-high pin can be pulled low from outside (input use); the read returns pin levels
    rig.set('P7', 0)
    bus.start()
    expect(bus.write(0x41)).toBe(true)
    expect(bus.read(false)).toBe(0x25)
    bus.stop()
  })

  it('only answers its own address (A2–A0 jumpers)', () => {
    const { bus, dev } = pcf('0x23')
    bus.start()
    expect(bus.write(0x40)).toBe(false)
    bus.stop()
    bus.start()
    expect(bus.write(0x46)).toBe(true)
    bus.stop()
    dev.setParam('address', '0x20')
    bus.start()
    expect(bus.write(0x40)).toBe(true)
    bus.stop()
  })

  it('INT goes low when an input changes and is released by a read (or when the input returns)', () => {
    const { rig, bus } = pcf()
    expect(rig.level('INT')).toBe(1)
    rig.set('P3', 0)
    expect(rig.level('INT')).toBe(0)
    rig.set('P3', null)
    expect(rig.level('INT')).toBe(1) // back to the original state
    rig.set('P3', 0)
    expect(rig.level('INT')).toBe(0)
    bus.start()
    bus.write(0x41)
    expect(bus.read(false)).toBe(0xf7)
    bus.stop()
    expect(rig.level('INT')).toBe(1)
  })
})

// =============================================================== catalog

describe('comm catalog entries', () => {
  const TYPES = ['usb_uart_ch340', 'hc05_bt', 'max485_module', 'w25q32_flash', 'sd_card_spi', 'pcf8574_module', 'esp01', 'can_tja1050']
  it('every comm part is a footprint module with registered models, honest support and complete pin docs', () => {
    for (const type of TYPES) {
      const e = getEntry(type)
      expect(e, type).toBeDefined()
      expect(CATALOG[type]).toBe(e)
      expect(e!.category).toBe('module')
      expect(e!.placement).toBe('footprint')
      expect(e!.allowedRotations).toEqual([0, 180])
      expect(e!.footprintOffsets!.length).toBe(e!.pins.length)
      expect(e!.sim).toEqual({ kind: 'chip', model: 'comm-module' })
      expect(registeredChips()).toContain('comm-module')
      expect(registeredDigitalDevices()).toContain(e!.digital!.model)
      for (const p of [...e!.digital!.inputs, ...e!.digital!.outputs, e!.digital!.supplyPin, e!.digital!.groundPin]) expect(e!.pins, `${type}.${p}`).toContain(p)
      expect(e!.pinInfo!.map((p) => p.pin).sort()).toEqual([...e!.pins].sort())
      expect(['partial', 'visual']).toContain(e!.support!.level)
      expect(e!.support!.limits!.length).toBeGreaterThan(0)
      // no two pins in one strip, in both allowed rotations (distinct holes per pin)
      const holes = new Set(e!.footprintOffsets!.map((o) => `${o.row}${o.dCol}`))
      expect(holes.size).toBe(e!.pins.length)
      for (const el of e!.subcircuit ?? []) for (const p of el.pins) if (!p.startsWith('@')) expect(e!.pins).toContain(p)
    }
  })
})

// --------------------------------------------------------------- helpers

/** bit-banged SPI master (mode 0) on nets CS / SCK / MOSI / MISO */
class SpiMaster {
  half = 0.25e-6
  constructor(private rig: Rig) {
    rig.set('CS', 1)
    rig.set('SCK', 0)
    rig.set('MOSI', 1)
  }
  select(): void {
    this.rig.set('CS', 0)
    this.rig.run(this.half)
  }
  deselect(): void {
    this.rig.run(this.half)
    this.rig.set('CS', 1)
    this.rig.run(this.half)
  }
  xfer(b: number): number {
    let v = 0
    for (let i = 7; i >= 0; i--) {
      this.rig.set('MOSI', ((b >> i) & 1) as 0 | 1)
      this.rig.run(this.half)
      this.rig.set('SCK', 1)
      v = (v << 1) | (this.rig.level('MISO') === 0 ? 0 : 1)
      this.rig.run(this.half)
      this.rig.set('SCK', 0)
    }
    this.rig.set('MOSI', 1)
    return v
  }
  /** `n` clocks of an unfinished byte */
  partial(n: number): void {
    for (let i = 0; i < n; i++) {
      this.rig.run(this.half)
      this.rig.set('SCK', 1)
      this.rig.run(this.half)
      this.rig.set('SCK', 0)
    }
  }
  idleClocks(n: number): void {
    this.rig.set('CS', 1)
    this.partial(n)
  }
  tx(bytes: number[], readN = 0): number[] {
    this.select()
    const out: number[] = []
    for (const b of bytes) out.push(this.xfer(b))
    for (let i = 0; i < readN; i++) out.push(this.xfer(0xff))
    this.deselect()
    return out
  }
}
