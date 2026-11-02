/**
 * Communication & memory modules (src/model/parts/comm.parts.ts) — logic-
 * level models (src/sim/digital/api.ts) driven ONLY by their pins and
 * scheduled virtual-time events, plus two engine-side helpers:
 *
 *  usb_uart_ch340   CH340G USB-to-TTL adapter: a bit-level UART on TXD/RXD
 *                   (./comm-uart) bridged to the PC's virtual COM port
 *                   (VirtualSerialPort 'COM'); baud / parity / stop bits are
 *                   the port settings the PC opened it with (params), so a
 *                   mismatch with the MCU gives the same garbage a real
 *                   adapter shows. The 3.3 V / 5 V jumper selects the
 *                   CH340's VCC — its I/O rail (CommModuleChip below).
 *  hc05_bt          HC-05 (ZS-040 board): EN high at power-up → AT command
 *                   mode at 38400 8N1 (AT, AT+RESET, AT+ORGL, AT+VERSION?,
 *                   AT+NAME?/=, AT+UART?/=, AT+ROLE?/=, AT+PSWD?/=,
 *                   AT+STATE?, error codes of the HC-05 datasheet), else
 *                   data mode at the stored UART setting bridged to the
 *                   paired phone (VirtualSerialPort 'BT'). The radio is not
 *                   simulated: the phone link is a runtime param.
 *  max485_module    MAX485 half-duplex RS-485 transceiver: driver (DE, DI →
 *                   A/B stages), receiver (|VA−VB| ≥ 200 mV, RE), the
 *                   module's 10 kΩ pull-ups, 20 kΩ bias and 120 Ω
 *                   termination (removable, param) in the analog solve;
 *                   bus contention and the termination of the bus are
 *                   diagnosed from the measured differential voltage.
 *  w25q32_flash     W25Q32JV SPI NOR flash (./comm-flash).
 *  sd_card_spi      micro-SD card in SPI mode (./comm-sd) behind the
 *                   module's 3.3 V regulator and buffer.
 *  pcf8574_module   PCF8574 I²C I/O expander: quasi-bidirectional P0–P7
 *                   (strong low, weak high), INT open drain on input change.
 *  esp01            ESP-01 (ESP8266): power / reset / boot-strap behavior,
 *                   boot ROM banner at 74880 baud, and an AT-command subset
 *                   (AT, ATE0/1, AT+GMR, AT+RST, AT+CWMODE?/=) at 115200.
 *                   NO Wi-Fi: network commands answer ERROR.
 *  can_tja1050      TJA1050 CAN transceiver: TXD → dominant / recessive on
 *                   CANH/CANL, RXD from the bus differential voltage, TXD
 *                   dominant time-out. bxCAN is not emulated.
 *
 * Engine helpers:
 *  - chip 'comm-module': the DigitalDeviceChip adapter of these parts. It
 *    records each part's params for its sub-circuit (the jumper resistor
 *    below) and, for the CH340, makes the pin the 3.3 V / 5 V jumper
 *    selects (catalog digital.outputRail.select — the output-high rail of
 *    the stage stamps and of the logic layer) the chip's supply as well.
 *    The HC-05 and SD modules declare their LDO output ('@v33') as the
 *    output rail (src/sim/digital/device-chip.ts).
 *  - device 'comm_jumper_r': a sub-circuit resistor that is fitted only
 *    while a boolean param of its part is true (the MAX485 / TJA1050
 *    120 Ω termination R7 that users desolder on mid-bus nodes).
 */
import { registerDigitalDevice } from '../digital/api'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import { DigitalDeviceChip } from '../digital/device-chip'
import { registerChip } from '../chip-api'
import { BaseDevice, bookBranch, registerDevice } from '../devices'
import type { StampContext } from '../mna'
import type { ComponentInstance, ComponentTelemetry, ParamValue } from '../../model/types'
import { paramOf } from '../../model/catalog'
import type { CatalogEntry } from '../../model/catalog'
import type { UartLineConfig } from '../../mcu/mcu-api'
import type { SerialPortDevice, VirtualSerialPort } from '../coordinator/api'
import { UartReceiver, UartTransmitter, baudOf } from './comm-uart'
import type { UartFrameFormat, UartParity, UartRxFrame } from './comm-uart'
import { W25qFlash } from './comm-flash'
import { SdCardSpi } from './comm-sd'
import type { SdKind } from './comm-sd'
import { SpiSlave } from './comm-spi'

// ================================================================ helpers

function str(v: ParamValue | undefined, fallback: string): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback
}
function bool(v: ParamValue | undefined, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'on'
  return fallback
}
function parityOf(v: ParamValue | undefined): UartParity {
  return v === 'even' || v === 'odd' ? v : 'none'
}
/**
 * A module's frame format as a UartLineConfig. UartLineConfig.dataBits is the
 * WORD length like the STM32's USART_CR1.M (8 | 9 bits INCLUDING the parity
 * bit — what the UART terminal decodes "8E1" / "7E1" from), while
 * UartFrameFormat.dataBits counts data bits only: 8 data bits + parity is a
 * 9-bit word.
 */
function lineConfig(f: UartFrameFormat, enabled = true): UartLineConfig {
  const word = f.dataBits + (f.parity !== 'none' ? 1 : 0)
  return { enabled, baud: f.baud, dataBits: word >= 9 ? 9 : 8, parity: f.parity, stopBits: f.stopBits }
}
function bytesOf(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

/** Activity LED persistence (s): a UART LED flickers too fast to see — it reads lit this long after a frame. */
const LED_PERSIST = 0.02

// ============================================== engine-side helpers

/** Params of every comm part built in the current engine (for 'comm_jumper_r'). */
const PART_PARAMS = new Map<string, (key: string) => ParamValue | undefined>()

/**
 * Parts whose rail jumper (catalog digital.outputRail.select) connects the
 * chip's own VCC: the selected pin is its supply (thresholds, power-up) as
 * well as its output-high rail.
 */
const JUMPERED_VCC = new Set(['usb_uart_ch340'])

/** DigitalDeviceChip of the comm modules (see the file header). */
export class CommModuleChip extends DigitalDeviceChip {
  constructor(comp: ComponentInstance) {
    super(comp)
    const entry = this.entry
    if (!entry) return
    const params = comp.params
    PART_PARAMS.set(comp.id, (key) => paramOf(params, entry, key))
    const out = entry.digital?.outputs[0]
    const idx = JUMPERED_VCC.has(entry.type) && out !== undefined ? this.pinIndex.get(out) : undefined
    const rail = idx !== undefined ? this.railPin[idx] : -1
    // the chip's VCC = the pin the jumper selects (DigitalDeviceChip resolved it as the output rail)
    if (rail >= 0) (this as { supplyIdx: number }).supplyIdx = rail
  }
}
registerChip('comm-module', (comp) => new CommModuleChip(comp))

/**
 * A resistor that is fitted while the boolean param `param` of its part is
 * true (sub-circuit element params: { resistance, param }).
 */
export class JumperResistorDevice extends BaseDevice {
  readonly fitted: boolean
  private readonly g: number
  private i = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry, nodes: number[]) {
    super(comp, entry, nodes)
    const r = this.num('resistance', 120)
    this.g = 1 / Math.min(Math.max(r, 1e-3), 1e12)
    const key = this.str('param', '')
    const dot = comp.id.lastIndexOf('.')
    const parent = dot > 0 ? comp.id.slice(0, dot) : ''
    const get = PART_PARAMS.get(parent)
    this.fitted = key ? bool(get?.(key), true) : true
  }

  stamp(ctx: StampContext): void {
    if (this.fitted) ctx.addConductance(this.nodes[0], this.nodes[1], this.g)
  }

  terminalCurrents(x: Float64Array, out: Float64Array, off: number): void {
    if (this.fitted) bookBranch(out, off, this.nodes, x, 0, 1, this.g)
  }

  endStep(x: Float64Array): void {
    const va = this.nodes[0] >= 0 ? x[this.nodes[0]] : 0
    const vb = this.nodes[1] >= 0 ? x[this.nodes[1]] : 0
    this.i = this.fitted ? (va - vb) * this.g : 0
  }

  fillTelemetry(t: ComponentTelemetry): void {
    t.current = this.i
    t.values = { fitted: this.fitted ? 1 : 0 }
  }
}
registerDevice('comm_jumper_r', (c, e, n) => new JumperResistorDevice(c, e, n))

// ================================================================ CH340

/** One virtual serial port backed by a module's methods. */
function makePort(
  name: string,
  send: (bytes: Uint8Array) => void,
  config: () => UartLineConfig,
): VirtualSerialPort {
  return { name, onHostRx: null, hostSend: send, config }
}

export class Ch340Module implements DigitalDevice, SerialPortDevice {
  readonly serialPorts: VirtualSerialPort[]
  readonly port: VirtualSerialPort
  private ctx!: DigitalDeviceCtx
  private rx!: UartReceiver
  private tx!: UartTransmitter
  private fmt: UartFrameFormat
  private dtr: boolean
  private powered = false
  rxBytes = 0
  txBytes = 0
  framingErrors = 0
  parityErrors = 0
  private lastRx = -1
  private lastTx = -1

  constructor(comp: ComponentInstance, entry: CatalogEntry) {
    const p = (k: string) => paramOf(comp.params, entry, k)
    this.fmt = {
      baud: baudOf(p('baud')) || 115200,
      dataBits: 8,
      parity: parityOf(p('parity')),
      stopBits: str(p('stopBits'), '1') === '2' ? 2 : 1,
    }
    this.dtr = bool(p('dtr'), false)
    this.port = makePort('COM', (b) => this.hostSend(b), () => lineConfig(this.fmt))
    this.serialPorts = [this.port]
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.rx = new UartReceiver(ctx, () => this.fmt, (f) => this.received(f))
    this.tx = new UartTransmitter(
      ctx,
      () => this.fmt,
      (l) => ctx.drive('TXD', l ? 'high' : 'low'),
      () => {
        this.txBytes++
        this.lastTx = ctx.now()
      },
    )
    ctx.drive('TXD', 'high')
    ctx.drive('RXD', 'pull-up') // CH340G inputs carry weak pull-ups
    ctx.drive('DTR', this.dtr ? 'low' : 'high') // modem outputs are active low
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (!on) {
      this.tx.cancel()
      this.rx.cancel()
      return
    }
    this.rx.reset(this.ctx.read('RXD'))
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (pin === 'RXD' && this.powered) this.rx.edge(level)
  }

  setParam(key: string, value: ParamValue): void {
    switch (key) {
      case 'baud': {
        const b = baudOf(value)
        if (b) this.fmt = { ...this.fmt, baud: b }
        return
      }
      case 'parity':
        this.fmt = { ...this.fmt, parity: parityOf(value) }
        return
      case 'stopBits':
        this.fmt = { ...this.fmt, stopBits: str(value, '1') === '2' ? 2 : 1 }
        return
      case 'dtr':
        this.dtr = bool(value, false)
        this.ctx?.drive('DTR', this.dtr ? 'low' : 'high')
        return
      default:
        return
    }
  }

  private received(f: UartRxFrame): void {
    this.rxBytes++
    this.lastRx = f.t
    if (f.framingError) this.framingErrors++
    if (f.parityError) this.parityErrors++
    // like the CH340 + its driver, a frame with errors still reaches the PC (as garbage)
    this.port.onHostRx?.(f.byte & 0xff, f.t)
  }

  private hostSend(bytes: Uint8Array): void {
    if (!this.ctx) return
    if (!this.powered) {
      this.ctx.log(`CH340: ${bytes.length} byte(s) from the COM port dropped — the module is unpowered`)
      return
    }
    this.tx.send(bytes)
  }

  telemetry(): DeviceTelemetry {
    const now = this.ctx ? this.ctx.now() : 0
    const lit = (t: number) => (t >= 0 && now - t <= LED_PERSIST ? 1 : 0)
    return {
      values: {
        baud: this.fmt.baud,
        rxBytes: this.rxBytes,
        txBytes: this.txBytes,
        framingErrors: this.framingErrors,
        parityErrors: this.parityErrors,
        pendingTx: this.tx ? this.tx.pending : 0,
      },
      leds: {
        TX: this.tx && this.tx.busy ? 1 : lit(this.lastTx),
        RX: this.rx && this.rx.active ? 1 : lit(this.lastRx),
      },
    }
  }
}
registerDigitalDevice('comm-ch340', (comp, entry) => new Ch340Module(comp, entry))

// ================================================================ HC-05

export interface Hc05Settings {
  name: string
  baud: number
  /** AT+UART stop field: 0 = 1 stop bit, 1 = 2 stop bits */
  stop: number
  /** AT+UART parity field: 0 none, 1 odd, 2 even */
  parity: number
  role: number
  pswd: string
}

export const HC05_DEFAULTS: Readonly<Hc05Settings> = {
  name: 'HC-05',
  baud: 9600,
  stop: 0,
  parity: 0,
  role: 0,
  pswd: '1234',
}
/** HC-05 v2.0 firmware version string (AT+VERSION?) */
export const HC05_VERSION = '2.0-20100601'
/** AT mode line settings (fixed, HC-05 datasheet) */
export const HC05_AT_BAUD = 38400
/** Module start-up time (s) — not specified by the datasheet; an estimate. */
export const HC05_BOOT_S = 0.1
const HC05_BAUDS = [4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1382400]

/** Settings stored in the module's flash (survive power cycles; per component). */
const HC05_FLASH = new Map<string, Hc05Settings>()

export function hc05Settings(componentId: string): Hc05Settings {
  let s = HC05_FLASH.get(componentId)
  if (!s) {
    s = { ...HC05_DEFAULTS }
    HC05_FLASH.set(componentId, s)
  }
  return s
}

export function resetHc05(componentId: string): void {
  HC05_FLASH.delete(componentId)
}

export class Hc05Module implements DigitalDevice, SerialPortDevice {
  readonly serialPorts: VirtualSerialPort[]
  readonly port: VirtualSerialPort
  readonly settings: Hc05Settings
  private ctx!: DigitalDeviceCtx
  private rx!: UartReceiver
  private tx!: UartTransmitter
  mode: 'off' | 'boot' | 'at' | 'data' = 'off'
  private atAtBoot = false
  private bootHandle = 0
  private phone: boolean
  private line: number[] = []
  private resetAfterTx = false
  private bootedAt = 0
  commands = 0
  dataToPhone = 0
  dataFromPhone = 0
  private droppedLogged = false

  constructor(comp: ComponentInstance, entry: CatalogEntry) {
    this.settings = hc05Settings(comp.id)
    this.phone = bool(paramOf(comp.params, entry, 'phone'), true)
    this.port = makePort('BT', (b) => this.fromPhone(b), () => lineConfig(this.dataFormat(), this.mode === 'data'))
    this.serialPorts = [this.port]
  }

  /** UART format on the pins right now. */
  format(): UartFrameFormat {
    return this.mode === 'at' || (this.mode === 'boot' && this.atAtBoot)
      ? { baud: HC05_AT_BAUD, dataBits: 8, parity: 'none', stopBits: 1 }
      : this.dataFormat()
  }

  dataFormat(): UartFrameFormat {
    const s = this.settings
    return {
      baud: s.baud,
      dataBits: 8,
      parity: s.parity === 1 ? 'odd' : s.parity === 2 ? 'even' : 'none',
      stopBits: s.stop === 1 ? 2 : 1,
    }
  }

  get connected(): boolean {
    return this.mode === 'data' && this.phone
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.rx = new UartReceiver(ctx, () => this.format(), (f) => this.received(f))
    this.tx = new UartTransmitter(ctx, () => this.format(), (l) => ctx.drive('TXD', l ? 'z' : 'low'), () => this.sent())
    // TXD / STATE: strong low or released to the module's 3.3 V pull-ups; EN: key line pull-down
    ctx.drive('TXD', 'z')
    ctx.drive('STATE', 'low')
    ctx.drive('EN', 'pull-down')
  }

  powerChanged(on: boolean): void {
    if (!on) {
      this.halt()
      this.mode = 'off'
      return
    }
    this.boot()
  }

  /** Start-up: the key line (EN) decides AT vs data mode (sampled now). */
  private boot(): void {
    this.halt()
    this.atAtBoot = this.ctx.read('EN') === 1
    this.mode = 'boot'
    this.bootedAt = this.ctx.now()
    this.bootHandle = this.ctx.schedule(HC05_BOOT_S, () => {
      this.bootHandle = 0
      this.mode = this.atAtBoot ? 'at' : 'data'
      this.line = []
      this.rx.reset(this.ctx.read('RXD'))
      this.updateState()
      this.ctx.log(
        this.atAtBoot
          ? `HC-05: AT command mode (EN high at power-up), ${HC05_AT_BAUD} 8N1`
          : `HC-05: data mode, ${this.settings.baud} baud${this.phone ? ', phone connected' : ', waiting for a phone'}`,
      )
    })
  }

  private halt(): void {
    if (this.bootHandle) this.ctx.cancel(this.bootHandle)
    this.bootHandle = 0
    this.tx?.cancel()
    this.rx?.cancel()
    this.resetAfterTx = false
    this.line = []
    this.ctx.drive('STATE', 'low')
    this.ctx.drive('TXD', 'z')
  }

  private updateState(): void {
    this.ctx.drive('STATE', this.connected ? 'z' : 'low')
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (pin === 'RXD' && (this.mode === 'at' || this.mode === 'data')) this.rx.edge(level)
  }

  setParam(key: string, value: ParamValue): void {
    if (key !== 'phone') return
    this.phone = bool(value, true)
    if (this.ctx && this.mode === 'data') {
      this.updateState()
      this.ctx.log(this.phone ? 'HC-05: phone connected' : 'HC-05: phone disconnected')
    }
  }

  private received(f: UartRxFrame): void {
    if (this.mode === 'data') {
      if (!this.phone) return // not connected: the HC-05 discards serial input
      this.dataToPhone++
      this.port.onHostRx?.(f.byte & 0xff, f.t)
      return
    }
    if (this.mode !== 'at') return
    if (f.framingError) return
    const c = f.byte & 0xff
    this.line.push(c)
    if (this.line.length > 80) this.line = this.line.slice(-80)
    const n = this.line.length
    if (n >= 2 && this.line[n - 2] === 0x0d && this.line[n - 1] === 0x0a) {
      const cmd = String.fromCharCode(...this.line.slice(0, n - 2))
      this.line = []
      this.at(cmd)
    }
  }

  private reply(text: string): void {
    this.tx.send(bytesOf(text))
  }

  /** Execute one AT command line (without CR LF). */
  at(cmd: string): void {
    this.commands++
    const s = this.settings
    const ok = '\r\nOK\r\n'
    const m = /^AT(?:\+([A-Z]+)(\?|=(.*))?)?$/i.exec(cmd.trim())
    if (!m) {
      this.reply('ERROR:(0)\r\n')
      return
    }
    const name = (m[1] ?? '').toUpperCase()
    const query = m[2] === '?'
    const arg = m[3]
    if (name === '' && m[2] === undefined) {
      this.reply('OK\r\n')
      return
    }
    switch (name) {
      case 'RESET':
        if (m[2] !== undefined) break
        this.reply('OK\r\n')
        this.resetAfterTx = true
        return
      case 'ORGL':
        if (m[2] !== undefined) break
        Object.assign(s, HC05_DEFAULTS)
        this.reply('OK\r\n')
        return
      case 'VERSION':
        if (!query) break
        this.reply(`+VERSION:${HC05_VERSION}${ok}`)
        return
      case 'NAME':
        if (query) {
          this.reply(`+NAME:${s.name}${ok}`)
          return
        }
        if (arg === undefined) break
        if (arg.length === 0) {
          this.reply('ERROR:(4)\r\n')
          return
        }
        if (arg.length > 32) {
          this.reply('ERROR:(3)\r\n')
          return
        }
        s.name = arg
        this.reply('OK\r\n')
        return
      case 'UART': {
        if (query) {
          this.reply(`+UART:${s.baud},${s.stop},${s.parity}${ok}`)
          return
        }
        if (arg === undefined) break
        const parts = arg.split(',')
        const baud = Number(parts[0])
        const stop = parts.length > 1 ? Number(parts[1]) : 0
        const parity = parts.length > 2 ? Number(parts[2]) : 0
        if (!HC05_BAUDS.includes(baud)) {
          this.reply('ERROR:(12)\r\n')
          return
        }
        if (!(stop === 0 || stop === 1)) {
          this.reply('ERROR:(13)\r\n')
          return
        }
        if (!(parity === 0 || parity === 1 || parity === 2)) {
          this.reply('ERROR:(14)\r\n')
          return
        }
        s.baud = baud
        s.stop = stop
        s.parity = parity
        this.reply('OK\r\n')
        return
      }
      case 'ROLE': {
        if (query) {
          this.reply(`+ROLE:${s.role}${ok}`)
          return
        }
        if (arg === undefined) break
        const r = Number(arg)
        if (!(r === 0 || r === 1 || r === 2)) {
          this.reply('ERROR:(11)\r\n')
          return
        }
        s.role = r
        this.reply('OK\r\n')
        return
      }
      case 'PSWD': {
        if (query) {
          this.reply(`+PSWD:${s.pswd}${ok}`)
          return
        }
        if (arg === undefined) break
        if (arg.length === 0) {
          this.reply('ERROR:(F)\r\n')
          return
        }
        if (arg.length > 16) {
          this.reply('ERROR:(10)\r\n')
          return
        }
        s.pswd = arg
        this.reply('OK\r\n')
        return
      }
      case 'STATE':
        if (!query) break
        this.reply(`+STATE:INITIALIZED${ok}`)
        return
      default:
        break
    }
    this.reply('ERROR:(0)\r\n')
  }

  private sent(): void {
    if (this.resetAfterTx && this.tx.pending === 0) {
      this.resetAfterTx = false
      this.ctx.log('HC-05: AT+RESET — restarting')
      this.boot()
    }
  }

  private fromPhone(bytes: Uint8Array): void {
    if (!this.ctx) return
    if (!this.connected) {
      if (!this.droppedLogged) {
        this.droppedLogged = true
        this.ctx.log('HC-05: no phone link (the module is not in data mode or the phone is disconnected) — bytes from the phone dropped')
      }
      return
    }
    this.dataFromPhone += bytes.length
    this.tx.send(bytes)
  }

  /** On-board LED pattern of the HC-05 firmware (time-based, telemetry only). */
  private ledAt(t: number): number {
    const dt = t - this.bootedAt
    switch (this.mode) {
      case 'at':
        return dt % 2 < 1 ? 1 : 0 // slow blink: 1 s on / 1 s off
      case 'data':
        if (!this.phone) return dt % 0.2 < 0.1 ? 1 : 0 // fast blink: waiting for a connection
        {
          const p = dt % 2 // double flash every 2 s
          return p < 0.1 || (p >= 0.2 && p < 0.3) ? 1 : 0
        }
      case 'boot':
        return 1
      default:
        return 0
    }
  }

  telemetry(): DeviceTelemetry {
    const now = this.ctx ? this.ctx.now() : 0
    const modeCode = { off: 0, boot: 1, at: 2, data: 3 }[this.mode]
    return {
      values: {
        mode: modeCode,
        connected: this.connected ? 1 : 0,
        baud: this.format().baud,
        commands: this.commands,
        toPhone: this.dataToPhone,
        fromPhone: this.dataFromPhone,
      },
      leds: { LED: this.ledAt(now) },
    }
  }
}
registerDigitalDevice('comm-hc05', (comp, entry) => new Hc05Module(comp, entry))

// =============================================================== MAX485

/** Receiver input thresholds (V): |VA − VB| ≥ 200 mV (MAX485 datasheet VTH). */
export const RS485_VTH = 0.2
/** Driver output resistance of the model (Ω per output, catalog digital.rout). */
export const RS485_ROUT = 35
/**
 * DI edges of one transmit burst (DE high) before the termination is judged.
 * At power-up the module pull-ups enable EVERY driver on the bus (DE and DI
 * float high until the MCU configures its pins): two drivers in parallel
 * look like half the load, so the first edges of a burst are not judged.
 */
export const RS485_JUDGE_EDGES = 4

export class Max485Module implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private de: 0 | 1 = 0
  private re: 0 | 1 = 1
  private di: 0 | 1 = 1
  /** receiver output while enabled (held inside the ±200 mV window) */
  ro: 0 | 1 = 1
  private powered = false
  private checkHandle = 0
  private measureLoad = false
  /** DI edges since DE last rose (see RS485_JUDGE_EDGES) */
  private burstEdges = 0
  private reported = new Set<string>()
  /** last measured differential load seen by the driver (Ω, NaN = unknown) */
  loadOhms = NaN
  lastVod = NaN
  private readonly id: string

  constructor(comp: ComponentInstance) {
    this.id = comp.id
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('A', 'z')
    ctx.drive('B', 'z')
    ctx.drive('RO', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (!on) {
      if (this.checkHandle) this.ctx.cancel(this.checkHandle)
      this.checkHandle = 0
      return
    }
    this.de = this.ctx.read('DE') === 1 ? 1 : 0
    this.re = this.ctx.read('RE') === 0 ? 0 : 1
    this.di = this.ctx.read('DI') === 0 ? 0 : 1
    this.burstEdges = 0
    this.driver(false)
    this.receiver()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    switch (pin) {
      case 'DI':
        if (level === null || level === this.di) return
        this.di = level
        if (this.de === 1) this.burstEdges++
        this.driver(this.burstEdges >= RS485_JUDGE_EDGES)
        return
      case 'DE':
        if (level === null) return
        if (level === 1 && this.de === 0) this.burstEdges = 0
        this.de = level
        this.driver(false)
        return
      case 'RE':
        if (level === null) return
        this.re = level
        this.receiver()
        return
      case 'A':
      case 'B':
        this.receiver()
        return
      default:
        return
    }
  }

  /**
   * Driver stage from DE / DI. data = a DI edge of an established transmit
   * burst (RS485_JUDGE_EDGES): only then is the termination judged (at
   * power-up the module pull-ups enable every driver with DI high — parallel
   * drivers would look like a lighter load).
   */
  private driver(data: boolean): void {
    if (this.de === 1) {
      this.ctx.drive('A', this.di ? 'high' : 'low')
      this.ctx.drive('B', this.di ? 'low' : 'high')
      // measure the bus once the analog solve shows the new drive (post-edge settle step)
      this.measureLoad ||= data
      if (!this.checkHandle) {
        this.checkHandle = this.ctx.schedule(1e-6, () => {
          this.checkHandle = 0
          const load = this.measureLoad
          this.measureLoad = false
          this.measure(load)
        })
      }
    } else {
      this.ctx.drive('A', 'z')
      this.ctx.drive('B', 'z')
    }
  }

  private receiver(): void {
    if (this.re === 1) {
      this.ctx.drive('RO', 'z') // receiver disabled: RO high-Z (the module pull-up holds it high)
      return
    }
    const vid = this.ctx.voltage('A') - this.ctx.voltage('B')
    if (Number.isFinite(vid)) {
      if (vid >= RS485_VTH) this.ro = 1
      else if (vid <= -RS485_VTH) this.ro = 0
      // inside ±200 mV the real output is undefined: the model holds its last level
    }
    this.ctx.drive('RO', this.ro ? 'high' : 'low')
  }

  /** Driver self-check from the solved bus voltages (contention; termination when load). */
  private measure(load: boolean): void {
    if (!this.powered || this.de !== 1) return
    const vod = this.ctx.voltage('A') - this.ctx.voltage('B')
    const vcc = this.ctx.supply()
    if (!Number.isFinite(vod) || !(vcc > 0)) return
    const want = this.di ? 1 : -1
    const v = vod * want
    this.lastVod = vod
    if (v < RS485_VTH) {
      this.once(
        'contention',
        `RS-485 bus contention: another driver holds A/B against this one (VA − VB = ${vod.toFixed(2)} V while DI = ${this.di}) — only one node may enable its driver (DE) at a time`,
      )
      return
    }
    if (!load) return
    // load across A–B from the divider the two driver outputs form with it
    const r = (2 * RS485_ROUT * v) / Math.max(vcc - v, 1e-3)
    this.loadOhms = r
    if (r > 600) {
      this.once(
        'unterminated',
        `RS-485 bus is not terminated (A–B load ≈ ${r >= 10000 ? (r / 1000).toFixed(0) + ' kΩ' : r.toFixed(0) + ' Ω'}): fit 120 Ω at both ends of the cable — reflections are not simulated, so short breadboard wiring still works`,
      )
    } else if (r > 90) {
      this.once(
        'one-end',
        `RS-485 bus is terminated at one end only (A–B load ≈ ${r.toFixed(0)} Ω): fit 120 Ω at the other end too`,
      )
    } else if (r < 45) {
      this.once(
        'over',
        `RS-485 bus is over-terminated (A–B load ≈ ${r.toFixed(0)} Ω, more than two 120 Ω resistors): remove the termination from the nodes between the two ends`,
      )
    }
  }

  private once(key: string, message: string): void {
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.ctx.issue('warning', message)
  }

  telemetry(): DeviceTelemetry {
    return {
      values: {
        de: this.de,
        re: this.re,
        di: this.di,
        ro: this.re === 0 ? this.ro : 1,
        vod: Number.isFinite(this.lastVod) ? this.lastVod : 0,
        load: Number.isFinite(this.loadOhms) ? this.loadOhms : 0,
      },
      leds: { TX: this.de === 1 && this.di === 0 ? 1 : 0 },
    }
  }
}
registerDigitalDevice('comm-max485', (comp) => new Max485Module(comp))

// ============================================================== W25Q32

export class W25qModule implements DigitalDevice {
  flash!: W25qFlash
  private ctx!: DigitalDeviceCtx
  private powered = false

  constructor(readonly componentId: string) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.flash = new W25qFlash(this.componentId, ctx, (d) => ctx.drive('DO', d))
    ctx.drive('DO', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (on) this.flash.powerUp()
    else this.flash.powerOff()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'WP') return // sampled when a status register write executes
    this.flash.onPin(pin, level)
  }

  telemetry(): DeviceTelemetry {
    const f = this.flash
    if (!f) return {}
    return {
      values: {
        status1: f.status1(),
        busy: f.busy() ? 1 : 0,
        programs: f.programs,
        erases: f.erases,
      },
    }
  }
}
registerDigitalDevice('comm-w25q32', (comp) => new W25qModule(comp.id))

// ============================================================== SD card

export class SdModule implements DigitalDevice {
  card!: SdCardSpi
  private spi!: SpiSlave
  private ctx!: DigitalDeviceCtx
  private powered = false
  private readonly kind: SdKind
  private cs: 0 | 1 = 1

  constructor(
    readonly componentId: string,
    comp: ComponentInstance,
    entry: CatalogEntry,
  ) {
    this.kind = str(paramOf(comp.params, entry, 'card'), 'sdhc') === 'sdsc' ? 'sdsc' : 'sdhc'
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.card = new SdCardSpi(this.componentId, this.kind, ctx)
    // MISO through the module buffer: 0-bits pull low, 1-bits / released leave it to the 3.3 V pull-up
    this.spi = new SpiSlave(ctx, { cs: 'CS', sck: 'SCK', mosi: 'MOSI', miso: 'MISO' }, this.card, (b) =>
      ctx.drive('MISO', b === 0 ? 'low' : 'z'),
    )
    ctx.drive('MISO', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (on) {
      this.card.powerUp()
      this.spi.sync()
      this.cs = this.ctx.read('CS') === 0 ? 0 : 1
    } else this.ctx.drive('MISO', 'z')
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'CS') this.cs = level === 0 ? 0 : 1
    if (pin === 'SCK' && level === 1 && this.cs === 1) this.card.clockDeselected()
    this.spi.onPin(pin, level)
  }

  telemetry(): DeviceTelemetry {
    const c = this.card
    if (!c) return {}
    return {
      values: {
        spiMode: c.mode === 'spi' ? 1 : 0,
        ready: c.state === 'ready' ? 1 : 0,
        crc: c.crcOn ? 1 : 0,
        blocksRead: c.blocksRead,
        blocksWritten: c.blocksWritten,
        lastCmd: c.lastCmd,
      },
      leds: { ACT: this.spi && this.spi.isSelected ? 1 : 0 },
    }
  }
}
registerDigitalDevice('comm-sdcard', (comp, entry) => new SdModule(comp.id, comp, entry))

// ============================================================== PCF8574

const P_PINS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const
/** SDA changes this long after SCL falls (data hold), so every bus device sees SCL low first. */
const PCF_T_DAT = 0.3e-6

type I2cState = 'idle' | 'addr' | 'ackAddr' | 'wdata' | 'ackW' | 'rdata' | 'ackR' | 'ignore'

export class Pcf8574Module implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  /** output latch (1 = quasi-input: weak pull-up) */
  latch = 0xff
  private address: number
  private scl: 0 | 1 = 1
  private sda: 0 | 1 = 1
  private state: I2cState = 'idle'
  private bits = 0
  private shift = 0
  private reading = false
  private outByte = 0xff
  private masterAck = false
  /** port levels at the last read / write (interrupt reference) */
  private snapshot = 0xff
  private intLow = false
  private sdaHandle = 0
  writes = 0
  reads = 0

  constructor(comp: ComponentInstance, entry: CatalogEntry) {
    this.address = parseAddress(paramOf(comp.params, entry, 'address'))
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('SDA', 'z')
    ctx.drive('INT', 'z')
    this.applyLatch()
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (!on) return
    // power-on reset: all ports high (quasi-inputs), interrupt released
    this.latch = 0xff
    this.state = 'idle'
    this.intLow = false
    this.ctx.drive('INT', 'z')
    this.ctx.drive('SDA', 'z')
    this.applyLatch()
    this.scl = this.ctx.read('SCL') === 0 ? 0 : 1
    this.sda = this.ctx.read('SDA') === 0 ? 0 : 1
    this.snapshot = this.portLevels()
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'address') this.address = parseAddress(value)
  }

  private applyLatch(): void {
    for (let i = 0; i < 8; i++) this.ctx.drive(P_PINS[i], (this.latch >>> i) & 1 ? 'pull-up' : 'low')
  }

  portLevels(): number {
    let v = 0
    for (let i = 0; i < 8; i++) if (this.ctx.read(P_PINS[i]) === 1) v |= 1 << i
    return v
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin.length === 2 && pin[0] === 'P') {
      this.checkInterrupt()
      return
    }
    if (level === null) return
    if (pin === 'SDA') {
      const prev = this.sda
      this.sda = level
      if (this.scl === 1 && prev !== level) {
        if (level === 0) this.start()
        else this.stop()
      }
      return
    }
    if (pin !== 'SCL' || level === this.scl) return
    this.scl = level
    if (level === 1) this.sclRise()
    else this.sclFall()
  }

  /** INT (open drain) is low while an input differs from the last read / written state. */
  private checkInterrupt(): void {
    const inputs = this.latch // only quasi-inputs (latch = 1) can change by themselves
    const diff = (this.portLevels() ^ this.snapshot) & inputs
    const low = diff !== 0
    if (low === this.intLow) return
    this.intLow = low
    this.ctx.drive('INT', low ? 'low' : 'z')
  }

  /** A read or write of the port resets the interrupt (datasheet §8.3.2). */
  private portAccessed(): void {
    this.snapshot = this.portLevels()
    if (this.intLow) {
      this.intLow = false
      this.ctx.drive('INT', 'z')
    }
  }

  /** drive SDA (low / released) t_DAT after the SCL falling edge */
  private sdaLater(d: 'low' | 'z'): void {
    if (this.sdaHandle) this.ctx.cancel(this.sdaHandle)
    this.sdaHandle = this.ctx.schedule(PCF_T_DAT, () => {
      this.sdaHandle = 0
      this.ctx.drive('SDA', d)
    })
  }

  private sdaNow(d: 'low' | 'z'): void {
    if (this.sdaHandle) this.ctx.cancel(this.sdaHandle)
    this.sdaHandle = 0
    this.ctx.drive('SDA', d)
  }

  private start(): void {
    this.sdaNow('z')
    this.state = 'addr'
    this.bits = 0
    this.shift = 0
  }

  private stop(): void {
    this.sdaNow('z')
    this.state = 'idle'
  }

  private sclRise(): void {
    switch (this.state) {
      case 'addr':
      case 'wdata':
        if (this.bits < 8) {
          this.shift = ((this.shift << 1) | (this.ctx.read('SDA') === 0 ? 0 : 1)) & 0xff
          this.bits++
        }
        return
      case 'rdata':
        this.bits++
        return
      case 'ackR':
        this.masterAck = this.ctx.read('SDA') === 0
        return
      default:
        return
    }
  }

  private sclFall(): void {
    switch (this.state) {
      case 'addr': {
        if (this.bits < 8) return
        if (this.shift >>> 1 !== this.address) {
          this.state = 'ignore'
          return
        }
        this.reading = (this.shift & 1) === 1
        this.sdaLater('low') // ACK
        this.state = 'ackAddr'
        return
      }
      case 'ackAddr':
        this.sdaLater('z')
        this.bits = 0
        this.shift = 0
        if (this.reading) this.beginRead()
        else this.state = 'wdata'
        return
      case 'wdata':
        if (this.bits < 8) return
        this.sdaLater('low') // ACK
        this.state = 'ackW'
        return
      case 'ackW':
        // the written byte reaches the port at the end of the acknowledge clock
        this.sdaLater('z')
        this.latch = this.shift
        this.writes++
        this.applyLatch()
        this.portAccessed()
        this.bits = 0
        this.shift = 0
        this.state = 'wdata'
        return
      case 'rdata':
        if (this.bits < 8) {
          this.sdaLater((this.outByte >>> (7 - this.bits)) & 1 ? 'z' : 'low')
          return
        }
        this.sdaLater('z') // release for the master's ACK
        this.state = 'ackR'
        return
      case 'ackR':
        if (this.masterAck) this.beginRead()
        else this.state = 'ignore' // NACK: wait for the STOP
        return
      default:
        return
    }
  }

  /** Port levels are captured at the acknowledge clock and shifted out MSB first. */
  private beginRead(): void {
    this.outByte = this.portLevels()
    this.reads++
    this.portAccessed()
    this.bits = 0
    this.state = 'rdata'
    this.sdaLater((this.outByte >>> 7) & 1 ? 'z' : 'low')
  }

  telemetry(): DeviceTelemetry {
    const leds: Record<string, number> = {}
    for (let i = 0; i < 8; i++) leds[P_PINS[i]] = (this.latch >>> i) & 1
    return {
      values: { address: this.address, latch: this.latch, int: this.intLow ? 1 : 0, writes: this.writes, reads: this.reads },
      leds,
    }
  }
}

function parseAddress(v: ParamValue | undefined): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, v.startsWith('0x') ? 16 : 10) : 0x20
  return Number.isFinite(n) && n >= 0x20 && n <= 0x27 ? n : 0x20
}
registerDigitalDevice('comm-pcf8574', (comp, entry) => new Pcf8574Module(comp, entry))

// ================================================================ ESP-01

/** Boot ROM baud of the ESP8266 (26 MHz crystal: 74880). */
export const ESP_ROM_BAUD = 74880
/** AT firmware default baud. */
export const ESP_AT_BAUD = 115200
/** Time from reset release to the AT firmware's "ready" (s) — an estimate (≈ 0.2 – 0.5 s on real modules). */
export const ESP_BOOT_S = 0.25
export const ESP_GMR = [
  'AT version:1.7.4.0(May 11 2020 19:13:04)',
  'SDK version:3.0.4(9532ceb)',
  'compile time:May 27 2020 10:12:17',
  'Bin version(Wroom 02):1.7.4',
]
const ESP_WIFI_CMDS = /^AT\+(CW|CIP|PING|CIFSR|SMART|WPS|MDNS|HTTP|MQTT|SNTP)/i

export class Esp01Module implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private rx!: UartReceiver
  private tx!: UartTransmitter
  private powered = false
  mode: 'off' | 'rom' | 'at' | 'download' = 'off'
  private baud = ESP_ROM_BAUD
  private echo = true
  private cwmode = 1
  private line: number[] = []
  private bootHandle = 0
  private rstCause = 1
  private wifiLogged = false
  commands = 0

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.rx = new UartReceiver(ctx, () => this.fmt(), (f) => this.received(f))
    this.tx = new UartTransmitter(ctx, () => this.fmt(), (l) => ctx.drive('TXD', l ? 'high' : 'low'))
    ctx.drive('TXD', 'z')
    // GPIO0 / GPIO2 carry the chip's weak pull-ups (boot straps)
    ctx.drive('GPIO0', 'pull-up')
    ctx.drive('GPIO2', 'pull-up')
  }

  private fmt(): UartFrameFormat {
    return { baud: this.baud, dataBits: 8, parity: 'none', stopBits: 1 }
  }

  /** CH_PD high and RST high: the chip runs. */
  private enabled(): boolean {
    return this.powered && this.ctx.read('CH_PD') === 1 && this.ctx.read('RST') !== 0
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.rstCause = 1
    this.update()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'CH_PD' || pin === 'RST') {
      if (pin === 'RST' && level === 0) this.rstCause = 2
      this.update()
      return
    }
    if (pin === 'RXD' && this.mode === 'at') this.rx.edge(level)
  }

  /** Follow CH_PD / RST: off (pins released) or a fresh boot. */
  private update(): void {
    const run = this.enabled()
    if (!run) {
      if (this.mode !== 'off') this.stopChip()
      return
    }
    if (this.mode === 'off') this.boot()
  }

  private stopChip(): void {
    if (this.bootHandle) this.ctx.cancel(this.bootHandle)
    this.bootHandle = 0
    this.tx.cancel()
    this.rx.cancel()
    this.mode = 'off'
    this.ctx.drive('TXD', 'z')
  }

  private boot(): void {
    // boot mode from the straps (GPIO15 is pulled low on the ESP-01): GPIO0 low = UART download
    const gpio0 = this.ctx.read('GPIO0') === 0 ? 0 : 1
    const gpio2 = this.ctx.read('GPIO2') === 0 ? 0 : 1
    const download = gpio0 === 0
    this.mode = download ? 'download' : 'rom'
    this.baud = ESP_ROM_BAUD
    this.ctx.drive('TXD', 'high')
    const bootMode = download ? `(1,${gpio2 ? 7 : 6})` : `(3,${gpio2 ? 7 : 6})`
    this.tx.send(bytesOf(`\r\n ets Jan  8 2013,rst cause:${this.rstCause}, boot mode:${bootMode}\r\n\r\n`))
    if (download) {
      this.tx.send(bytesOf('waiting for host\r\n'))
      this.ctx.log('ESP-01: GPIO0 low at reset — UART download mode (the AT firmware does not start)')
      return
    }
    this.bootHandle = this.ctx.schedule(ESP_BOOT_S, () => {
      this.bootHandle = 0
      this.tx.cancel()
      this.mode = 'at'
      this.baud = ESP_AT_BAUD
      this.line = []
      this.rx.reset(this.ctx.read('RXD'))
      this.tx.send(bytesOf('\r\nready\r\n'))
    })
  }

  private received(f: UartRxFrame): void {
    if (this.mode !== 'at' || f.framingError) return
    const c = f.byte & 0xff
    if (this.echo) this.tx.send([c])
    this.line.push(c)
    if (this.line.length > 256) this.line = this.line.slice(-256)
    const n = this.line.length
    if (n >= 2 && this.line[n - 2] === 0x0d && this.line[n - 1] === 0x0a) {
      const cmd = String.fromCharCode(...this.line.slice(0, n - 2)).trim()
      this.line = []
      this.at(cmd)
    }
  }

  private reply(text: string): void {
    this.tx.send(bytesOf(text))
  }

  at(cmd: string): void {
    this.commands++
    const u = cmd.toUpperCase()
    if (u === 'AT') return this.reply('\r\nOK\r\n')
    if (u === 'ATE0' || u === 'ATE1') {
      this.echo = u === 'ATE1'
      return this.reply('\r\nOK\r\n')
    }
    if (u === 'AT+GMR') return this.reply(`${ESP_GMR.join('\r\n')}\r\nOK\r\n`)
    if (u === 'AT+RST') {
      this.reply('\r\nOK\r\n')
      // restart once the answer is out (software reset: rst cause 2)
      const wait = (this.tx.pending * 10) / this.baud
      this.bootHandle = this.ctx.schedule(wait + 1e-3, () => {
        this.bootHandle = 0
        this.tx.cancel()
        this.rx.cancel()
        this.rstCause = 2
        this.mode = 'off'
        this.update()
      })
      return
    }
    if (u === 'AT+CWMODE?') return this.reply(`+CWMODE:${this.cwmode}\r\n\r\nOK\r\n`)
    const m = /^AT\+CWMODE=(\d)$/.exec(u)
    if (m) {
      const v = Number(m[1])
      if (v >= 1 && v <= 3) {
        this.cwmode = v
        return this.reply('\r\nOK\r\n')
      }
      return this.reply('\r\nERROR\r\n')
    }
    if (ESP_WIFI_CMDS.test(u) && !this.wifiLogged) {
      this.wifiLogged = true
      this.ctx.log('ESP-01: Wi-Fi is not simulated — network AT commands answer ERROR')
    }
    this.reply('\r\nERROR\r\n')
  }

  telemetry(): DeviceTelemetry {
    const modeCode = { off: 0, rom: 1, at: 2, download: 3 }[this.mode]
    return {
      values: { mode: modeCode, baud: this.baud, commands: this.commands },
      leds: { TX: this.tx && this.tx.low ? 1 : 0 },
    }
  }
}
registerDigitalDevice('comm-esp01', () => new Esp01Module())

// =============================================================== TJA1050

/** Receiver thresholds (V): dominant above 0.9 V, recessive below 0.5 V (TJA1050 Vi(dif)). */
export const CAN_VTH_DOM = 0.9
export const CAN_VTH_REC = 0.5
/** TXD dominant time-out (s): TJA1050 t_dom(TXD) 250 … 750 µs — typical 450 µs. */
export const CAN_TDOM = 450e-6

export class Tja1050Module implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private tx: 0 | 1 = 1
  dominantDriven = false
  rxLevel: 0 | 1 = 1
  private domHandle = 0
  private timedOut = false
  private reported = new Set<string>()

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('TX', 'pull-up') // TXD internal pull-up: floating = recessive
    ctx.drive('CANH', 'z')
    ctx.drive('CANL', 'z')
    ctx.drive('RX', 'high')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (!on) {
      this.cancelDom()
      return
    }
    this.tx = this.ctx.read('TX') === 0 ? 0 : 1
    this.timedOut = false
    this.transmit()
    this.receive()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (pin === 'TX') {
      if (level === null) return
      const rising = this.tx === 0 && level === 1
      this.tx = level
      if (rising) {
        this.timedOut = false
        this.checkTxLevel()
      }
      this.transmit()
      return
    }
    if (pin === 'CANH' || pin === 'CANL') this.receive()
  }

  private transmit(): void {
    const dom = this.tx === 0 && !this.timedOut
    if (dom !== this.dominantDriven) {
      this.dominantDriven = dom
      this.ctx.drive('CANH', dom ? 'high' : 'z')
      this.ctx.drive('CANL', dom ? 'low' : 'z')
    }
    if (dom && !this.domHandle) {
      this.domHandle = this.ctx.schedule(CAN_TDOM, () => {
        this.domHandle = 0
        if (this.tx !== 0) return
        this.timedOut = true
        this.once(
          'tdom',
          `CAN transceiver TXD held dominant longer than ${Math.round(CAN_TDOM * 1e6)} µs: the TJA1050 time-out disabled its driver until TXD goes high (TXD stuck low?)`,
        )
        this.transmit()
      })
    }
    if (!dom) this.cancelDom()
  }

  private cancelDom(): void {
    if (this.domHandle) this.ctx.cancel(this.domHandle)
    this.domHandle = 0
  }

  private receive(): void {
    const vid = this.ctx.voltage('CANH') - this.ctx.voltage('CANL')
    if (Number.isFinite(vid)) {
      if (vid > CAN_VTH_DOM) this.rxLevel = 0
      else if (vid < CAN_VTH_REC) this.rxLevel = 1
    }
    this.ctx.drive('RX', this.rxLevel ? 'high' : 'low')
  }

  /** TXD high must reach 0.7·VCC (TJA1050 VIH): a 3.3 V MCU is outside the guaranteed range. */
  private checkTxLevel(): void {
    const v = this.ctx.voltage('TX')
    const vcc = this.ctx.supply()
    if (!Number.isFinite(v) || !(vcc > 0)) return
    if (v < 0.7 * vcc) {
      this.once(
        'vih',
        `TX high level ${v.toFixed(2)} V is below the TJA1050 minimum VIH of 0.7·VCC = ${(0.7 * vcc).toFixed(2)} V: outside the datasheet guarantee (it switches here, as on most benches)`,
      )
    }
  }

  private once(key: string, message: string): void {
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.ctx.issue('warning', message)
  }

  telemetry(): DeviceTelemetry {
    return {
      values: { tx: this.tx, dominant: this.dominantDriven ? 1 : 0, rx: this.rxLevel, timedOut: this.timedOut ? 1 : 0 },
    }
  }
}
registerDigitalDevice('comm-tja1050', () => new Tja1050Module())
