/**
 * Serial-bus ICs, logic-level models (src/sim/digital/api.ts) driven only by
 * their pins:
 *
 *  at24c02 — Microchip/Atmel AT24C02(C) 2-Kbit (256 × 8) I²C serial EEPROM,
 *    DIP-8: A0 A1 A2 GND SDA SCL WP VCC (datasheet DS20005233 / Atmel 0180).
 *    • START = SDA falling while SCL is high, STOP = SDA rising while SCL is
 *      high; bits are sampled on SCL rising edges; the EEPROM changes SDA
 *      t_AA = 0.3 µs after SCL falls (datasheet t_AA 0.05–0.9 µs), so other
 *      devices on the bus always see SCL low first.
 *    • Device address 1010·A2·A1·A0·R/W̄; A0–A2 and WP have internal
 *      pull-downs (floating = 0, AT24C02C), modelled as weak pull-down drives.
 *    • Byte write / 8-byte page write: data bytes go to the page buffer, the
 *      word address rolls over inside its 8-byte page (bytes beyond 8
 *      overwrite the first ones). A STOP right after an acknowledged data
 *      byte starts the self-timed write cycle t_WR = 5 ms (datasheet max);
 *      during it the device does not acknowledge its address (ACK polling).
 *      A STOP inside a byte or a repeated START instead of a STOP aborts the
 *      write (nothing is written).
 *    • WP high: data bytes are acknowledged but not written and no write
 *      cycle starts (datasheet: the whole array is write-protected).
 *    • Current-address, random (dummy write + repeated START) and
 *      sequential reads; during a read the address rolls over from 0xFF to
 *      0x00. The master's NACK ends a read (the device releases SDA and
 *      waits for STOP).
 *    • Non-volatile: the contents survive power cycles and simulation
 *      resets for the session (kept per component id); a fresh part reads
 *      0xFF (erased). A power loss during t_WR loses that page write.
 *
 *  74hc595 — 8-bit shift register with output latches, DIP-16:
 *    QB QC QD QE QF QG QH GND QH' SRCLR SRCLK RCLK OE SER QA VCC
 *    (TI SN74HC595 / NXP 74HC595 datasheets).
 *    • SRCLK rising: SER shifts into stage A, A→B … G→H (unless SRCLR is
 *      low). SRCLR low: shift register cleared asynchronously.
 *    • RCLK rising: the storage register takes the shift register value
 *      BEFORE a simultaneous SRCLK edge (with SRCLK and RCLK tied together
 *      the latch is one clock behind, as the datasheet notes).
 *    • OE low: QA–QH drive the storage register bits (push-pull, 50 Ω,
 *      DigitalSpec.rout); OE high: QA–QH high impedance. QH' (stage H)
 *      is always driven.
 *    • Outputs change t_pd = 20 ns after the clock edge (typical at 4.5 V;
 *      not scaled with VCC) — a daisy-chained 595 sharing SRCLK samples the
 *      old QH' level, as in hardware.
 *    • Power-up state: shift and storage registers 0 (undefined on real
 *      parts). A floating control input keeps its last level and is
 *      reported once (CMOS inputs must not float).
 */
import { registerDigitalDevice } from '../digital/api'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'

// ============================================================ AT24C02

/** EEPROM size (bytes) and page size (AT24C02: 256 × 8, 8-byte pages). */
export const AT24C02_SIZE = 256
export const AT24C02_PAGE = 8
/** self-timed write cycle t_WR (s), datasheet maximum */
export const AT24C02_TWR = 5e-3
/** clock low to data out valid t_AA (s) */
const T_AA = 0.3e-6

/** Non-volatile contents per component id — survive power cycles and coordinator resets. */
const EEPROM_STORE = new Map<string, Uint8Array>()

/** The persistent contents of an AT24C02 component (created erased = 0xFF). */
export function at24c02Contents(componentId: string): Uint8Array {
  let m = EEPROM_STORE.get(componentId)
  if (!m) {
    m = new Uint8Array(AT24C02_SIZE).fill(0xff)
    EEPROM_STORE.set(componentId, m)
  }
  return m
}

/** Forget a component's contents (tests; a brand-new part). */
export function eraseAt24c02(componentId: string): void {
  EEPROM_STORE.delete(componentId)
}

type EeState = 'idle' | 'devaddr' | 'ackDev' | 'word' | 'ackWord' | 'data' | 'ackData' | 'read' | 'readAck' | 'ignore'

export class At24c02 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private readonly mem: Uint8Array
  private powered = false
  private scl: 0 | 1 = 1
  private sda: 0 | 1 = 1
  private state: EeState = 'idle'
  private bits = 0
  private shift = 0
  /** internal data word address counter */
  private addr = 0
  /** page buffer of the write in progress: address → byte */
  private pageBuf = new Map<number, number>()
  private wroteData = false
  private busyUntil = -1
  private wrHandle = 0
  private outHandle = 0
  private outByte = 0
  private writes = 0
  private textCache: string[] | null = null

  constructor(readonly componentId: string) {
    this.mem = at24c02Contents(componentId)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    // internal pull-downs on the address and write-protect inputs (AT24C02C)
    for (const p of ['A0', 'A1', 'A2', 'WP']) ctx.drive(p, 'pull-down')
    ctx.drive('SDA', 'z')
    this.resync()
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.cancelOut()
    this.ctx.drive('SDA', 'z')
    this.state = 'idle'
    this.pageBuf.clear()
    if (!on && this.busy()) {
      this.ctx.cancel(this.wrHandle)
      this.wrHandle = 0
      this.busyUntil = -1
      this.ctx.issue('warning', 'power lost during the EEPROM write cycle (t_WR): that page write is lost')
    }
    if (on) {
      this.addr = 0
      this.resync()
    }
  }

  private resync(): void {
    this.scl = this.ctx.read('SCL') === 0 ? 0 : 1
    this.sda = this.ctx.read('SDA') === 0 ? 0 : 1
  }

  private busy(): boolean {
    return this.busyUntil >= 0 && this.ctx.now() < this.busyUntil
  }

  onPinChange(pin: string, level: LogicLevel): void {
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

  private start(): void {
    // a repeated START instead of a STOP aborts a pending page write
    this.pageBuf.clear()
    this.wroteData = false
    this.cancelOut()
    this.ctx.drive('SDA', 'z')
    this.state = 'devaddr'
    this.bits = 0
    this.shift = 0
  }

  private stop(): void {
    this.cancelOut()
    this.ctx.drive('SDA', 'z')
    // a STOP right after an acknowledged data byte starts the write cycle (the STOP's own SCL
    // high phase has already been counted as the first bit of a next byte: bits ≤ 1)
    if (this.state === 'data' && this.bits <= 1 && this.wroteData && this.pageBuf.size > 0) this.beginWrite()
    this.pageBuf.clear()
    this.wroteData = false
    this.state = 'idle'
  }

  private beginWrite(): void {
    const buf = new Map(this.pageBuf)
    const now = this.ctx.now()
    this.busyUntil = now + AT24C02_TWR
    this.wrHandle = this.ctx.schedule(AT24C02_TWR, () => {
      this.wrHandle = 0
      this.busyUntil = -1
      for (const [a, v] of buf) this.mem[a] = v
      this.writes++
      this.textCache = null
    })
  }

  private sclRise(): void {
    switch (this.state) {
      case 'devaddr':
      case 'word':
      case 'data':
        if (this.bits < 8) {
          this.shift = ((this.shift << 1) | (this.ctx.read('SDA') === 0 ? 0 : 1)) & 0xff
          this.bits++
        }
        return
      case 'read':
        this.bits++
        return
      case 'readAck':
        this.masterAck = this.ctx.read('SDA') === 0
        return
      default:
        return
    }
  }

  private masterAck = false

  private sclFall(): void {
    switch (this.state) {
      case 'devaddr': {
        if (this.bits < 8) return
        const b = this.shift
        const sel = ((this.pinBit('A2') << 2) | (this.pinBit('A1') << 1) | this.pinBit('A0')) & 7
        if ((b & 0xf0) !== 0xa0 || ((b >>> 1) & 7) !== sel || this.busy()) {
          // not addressed — or inside t_WR: no acknowledge (ACK polling)
          this.state = 'ignore'
          return
        }
        this.outLater(0)
        this.state = 'ackDev'
        this.reading = (b & 1) === 1
        return
      }
      case 'ackDev':
        this.bits = 0
        this.shift = 0
        if (this.reading) this.beginReadByte()
        else {
          this.outLater(1)
          this.state = 'word'
        }
        return
      case 'word':
        if (this.bits < 8) return
        this.addr = this.shift
        this.outLater(0)
        this.state = 'ackWord'
        return
      case 'ackWord':
        this.outLater(1)
        this.bits = 0
        this.shift = 0
        this.state = 'data'
        return
      case 'data': {
        if (this.bits < 8) return
        if (this.pinBit('WP') === 0) {
          this.pageBuf.set(this.addr, this.shift)
          this.wroteData = true
        }
        // the word address rolls over inside the 8-byte page
        this.addr = (this.addr & ~(AT24C02_PAGE - 1)) | ((this.addr + 1) & (AT24C02_PAGE - 1))
        this.outLater(0)
        this.state = 'ackData'
        return
      }
      case 'ackData':
        this.outLater(1)
        this.bits = 0
        this.shift = 0
        this.state = 'data'
        return
      case 'read':
        if (this.bits < 8) {
          this.outLater(((this.outByte >>> (7 - this.bits)) & 1) as 0 | 1)
          return
        }
        // byte shifted out: release SDA for the master's ACK; the counter advances (wraps at 0xFF)
        this.addr = (this.addr + 1) & (AT24C02_SIZE - 1)
        this.outLater(1)
        this.state = 'readAck'
        return
      case 'readAck':
        if (this.masterAck) this.beginReadByte()
        else this.state = 'ignore' // NACK: wait for the STOP
        return
      default:
        return
    }
  }

  private reading = false

  private beginReadByte(): void {
    this.outByte = this.mem[this.addr]
    this.bits = 0
    this.state = 'read'
    this.outLater(((this.outByte >>> 7) & 1) as 0 | 1)
  }

  /** drive SDA (0 = low, 1 = release) t_AA after the SCL falling edge */
  private outLater(level: 0 | 1): void {
    this.cancelOut()
    this.outHandle = this.ctx.schedule(T_AA, () => {
      this.outHandle = 0
      this.ctx.drive('SDA', level ? 'z' : 'low')
    })
  }

  private cancelOut(): void {
    if (this.outHandle) this.ctx.cancel(this.outHandle)
    this.outHandle = 0
  }

  private pinBit(pin: string): 0 | 1 {
    return this.ctx.read(pin) === 1 ? 1 : 0
  }

  telemetry(): DeviceTelemetry {
    if (!this.textCache) {
      const lines: string[] = []
      for (let r = 0; r < AT24C02_SIZE; r += 16) {
        let s = r.toString(16).padStart(2, '0') + ':'
        for (let i = 0; i < 16; i++) s += ' ' + this.mem[r + i].toString(16).padStart(2, '0')
        lines.push(s)
      }
      this.textCache = lines
    }
    return { values: { address: this.addr, busy: this.busy() ? 1 : 0, writeCycles: this.writes }, text: this.textCache }
  }
}

registerDigitalDevice('at24c02', (comp) => new At24c02(comp.id))

// ============================================================ 74HC595

/** propagation delay clock → outputs (s), typical at VCC = 4.5 V */
const T_PD_595 = 20e-9
const Q_PINS = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'] as const

export class Hc595 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  /** stage A = bit 0 … stage H = bit 7 */
  private shift = 0
  private latch = 0
  private prevShift = 0
  private lastShiftAt = -1
  private lv: Record<string, 0 | 1> = { SER: 0, SRCLK: 0, RCLK: 0, SRCLR: 1, OE: 1 }
  private floatWarned = new Set<string>()
  private powered = false

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.readInputs()
    this.applyOutputs(this.latch, this.shift, this.lv.OE)
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (on) {
      this.shift = 0
      this.latch = 0
      this.readInputs()
      this.applyOutputs(0, 0, this.lv.OE)
    }
  }

  private readInputs(): void {
    for (const p of Object.keys(this.lv)) {
      const l = this.ctx.read(p)
      if (l !== null) this.lv[p] = l
    }
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!(pin in this.lv)) return
    if (level === null) {
      if (this.powered && !this.floatWarned.has(pin)) {
        this.floatWarned.add(pin)
        this.ctx.issue('warning', `74HC595 input ${pin} is floating (CMOS inputs must be driven): it keeps its last level`)
      }
      return
    }
    const prev = this.lv[pin]
    this.lv[pin] = level
    if (prev === level) return
    const now = this.ctx.now()
    switch (pin) {
      case 'SRCLK':
        if (level === 1 && this.lv.SRCLR === 1) {
          this.prevShift = this.shift
          this.lastShiftAt = now
          this.shift = ((this.shift << 1) | this.lv.SER) & 0xff
          this.scheduleOutputs()
        }
        return
      case 'SRCLR':
        if (level === 0) {
          this.prevShift = this.shift
          this.lastShiftAt = now
          this.shift = 0
          this.scheduleOutputs()
        }
        return
      case 'RCLK':
        if (level === 1) {
          // a shift at this very instant has not propagated yet: the latch takes the old stages
          this.latch = this.lastShiftAt === now ? this.prevShift : this.shift
          this.scheduleOutputs()
        }
        return
      case 'OE':
        this.scheduleOutputs()
        return
      default:
        return
    }
  }

  private scheduleOutputs(): void {
    const latch = this.latch
    const shift = this.shift
    const oe = this.lv.OE
    this.ctx.schedule(T_PD_595, () => this.applyOutputs(latch, shift, oe))
  }

  private applyOutputs(latch: number, shift: number, oe: 0 | 1): void {
    for (let i = 0; i < 8; i++) this.ctx.drive(Q_PINS[i], oe === 1 ? 'z' : (latch >>> i) & 1 ? 'high' : 'low')
    this.ctx.drive("QH'", (shift >>> 7) & 1 ? 'high' : 'low')
  }

  telemetry(): DeviceTelemetry {
    return { values: { shift: this.shift, latch: this.latch, outputsEnabled: this.lv.OE === 0 ? 1 : 0 } }
  }
}

registerDigitalDevice('74hc595', () => new Hc595())
