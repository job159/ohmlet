/**
 * Hitachi HD44780U (and compatible KS0066 / ST7066U) character-LCD
 * controller as on the LCD1602 / LCD2004 modules, its parallel bus adapter,
 * and the PCF8574 I²C "backpack" (NXP PCF8574 / PCF8574A).
 *
 * Bus (HD44780U datasheet ADE-207-272, "Interfacing to the MPU", Figures 25
 * / 26, AC characteristics): RS and R/W are sampled at E's rising edge;
 * writes are latched on E's FALLING edge; reads drive DB7–DB0 from t_DDR
 * after E rises until E falls. 8-bit interface (DL = 1) or 4-bit (DL = 0,
 * DB7–DB4 only, upper nibble first; DB3–DB0 unused). DB0–DB7, RS and R/W
 * have internal pull-up MOS (floating inputs read 1; an unconnected R/W
 * means READ — the classic "nothing appears" wiring mistake).
 *
 * Instruction set (Table 6): clear display (DDRAM ← 20h, AC ← 0, I/D ← 1),
 * return home (AC ← 0, shift ← 0), entry mode (I/D, S), display control
 * (D, C, B), cursor / display shift (S/C, R/L), function set (DL, N, F), set
 * CGRAM / DDRAM address, write / read data, read busy flag + address.
 * Execution times at f_OSC = 270 kHz: 1.52 ms (clear, home), 37 µs (all
 * others, data writes/reads). While busy (BF = 1) the controller does not
 * execute instructions: a write then is ignored (and reported).
 *
 * Internal reset at power-up (Figure 23 conditions): display clear,
 * function set DL = 1 (8-bit), N = 0 (1 line), F = 0, display off, cursor
 * off, blink off, entry I/D = 1 S = 0; BF stays 1 for 10 ms. CGRAM content
 * is undefined (random) after power-up.
 *
 * DDRAM: 2-line mode 00h–27h (line 1) / 40h–67h (line 2), 1-line mode
 * 00h–4Fh; AC wraps 27h→40h→67h→00h. The visible window is `cols` wide at
 * the display shift; a 20×4 panel shows line 1 on rows 0/2 (window +0 /
 * +20) and line 2 on rows 1/3.
 *
 * Contrast: the liquid-crystal drive is V_LCD = V_DD − V0. In 2-line mode
 * (1/16 duty) dots switch between ≈ 3.0 V and 4.0 V V_LCD (STN threshold
 * band of a 5 V module); in 1-line mode (1/8 duty, the reset state) the same
 * V_LCD over-drives row 1, whose OFF dots then show as dark boxes — the
 * "black boxes on line 1 of an uninitialized LCD".
 */
import type { DisplayTelemetry } from '../../model/types'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ParamValue } from '../../model/types'
import { I2cSlave, powerUpNoise } from './displays-i2c'

/** Execution times at f_OSC = 270 kHz (HD44780U Table 6). */
export const HD_T_CLEAR = 1.52e-3
export const HD_T_CMD = 37e-6
/** BF = 1 for this long after power-up (internal reset). */
export const HD_T_POWERUP = 10e-3
/** E pulse width (high) minimum, PW_EH at V_CC 4.5–5.5 V (230 ns). */
const PW_EH = 230e-9
/** data output delay after E rises (t_DDR max 360 ns at 5 V; modeled at 120 ns) and hold after E falls */
const T_DDR = 120e-9
const T_DHR = 10e-9
/** cursor / character blink half period: 409.6 ms at f_OSC = 250 kHz → 379 ms at 270 kHz */
export const HD_BLINK = 0.4096 * (250 / 270)

export interface LcdGeometry {
  cols: number
  rows: number
}

/** The controller's view of its data-bus outputs (DB7–DB0). */
export interface Hd44780Port {
  /** drive DB7–DB0 to `value` (8-bit mode) or DB7–DB4 to value[7:4] (4-bit mode); null = release */
  driveData(value: number | null, fourBit: boolean): void
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class Hd44780 {
  readonly ddram = new Uint8Array(0x80).fill(0x20)
  readonly cgram = new Uint8Array(64)
  ac = 0
  /** AC addresses CGRAM (after a set-CGRAM-address) instead of DDRAM */
  cg = false
  id = 1
  sh = 0
  d = 0
  c = 0
  b = 0
  dl = 1
  n = 0
  f = 0
  /** display shift (positions, 0 … 39 in 2-line mode) */
  shift = 0
  busyUntil = 0
  rev = 0
  writes = 0
  private e: 0 | 1 = 0
  private rs: 0 | 1 = 0
  private rw: 0 | 1 = 0
  private eRise = 0
  /** 4-bit interface: the next nibble is the upper one */
  private upper = true
  private hiNibble = 0
  private reading = false
  private readLatch = 0
  private outHandle = 0
  private warned = new Set<string>()

  constructor(
    readonly geom: LcdGeometry,
    private readonly ctx: DigitalDeviceCtx,
    private readonly port: Hd44780Port,
  ) {}

  private warnOnce(key: string, level: 'warning' | 'log', message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    if (level === 'warning') this.ctx.issue('warning', message)
    else this.ctx.log(message)
  }

  busy(): boolean {
    return this.ctx.now() < this.busyUntil
  }

  /** Internal reset at power-up (HD44780U "Initializing by Internal Reset Circuit"). */
  powerUp(): void {
    this.ddram.fill(0x20)
    powerUpNoise(this.ctx.componentId + ':cgram', this.cgram)
    for (let i = 0; i < 64; i++) this.cgram[i] &= 0x1f
    this.ac = 0
    this.cg = false
    this.id = 1
    this.sh = 0
    this.d = this.c = this.b = 0
    this.dl = 1
    this.n = 0
    this.f = 0
    this.shift = 0
    this.upper = true
    this.reading = false
    this.cancelOut()
    this.port.driveData(null, false)
    this.busyUntil = this.ctx.now() + HD_T_POWERUP
    this.rev++
  }

  powerDown(): void {
    this.cancelOut()
    this.reading = false
    this.port.driveData(null, false)
  }

  /**
   * New input levels (RS, R/W, E, DB7–DB0 with floating pulled-up lines
   * already read as 1). Only E edges act.
   */
  inputs(rs: 0 | 1, rw: 0 | 1, e: 0 | 1 | null, data: number): void {
    if (e === null || e === this.e) {
      if (this.e === 0) {
        this.rs = rs
        this.rw = rw
      }
      return
    }
    this.e = e
    if (e === 1) {
      this.rs = rs
      this.rw = rw
      this.eRise = this.ctx.now()
      if (rw === 1) this.beginRead()
      return
    }
    // E falling
    if (this.reading) {
      this.endRead()
      return
    }
    if (this.rw === 1) return
    const w = this.ctx.now() - this.eRise
    if (w < PW_EH) {
      this.warnOnce(
        'pweh',
        'log',
        `HD44780 enable pulse ${(w * 1e9).toFixed(0)} ns is shorter than PW_EH = 230 ns: a real module may miss this write`,
      )
    }
    if (this.dl === 1) {
      this.execute(this.rs, data & 0xff)
      return
    }
    const nib = (data >> 4) & 0x0f
    if (this.upper) {
      this.hiNibble = nib
      this.upper = false
      return
    }
    this.upper = true
    this.execute(this.rs, (this.hiNibble << 4) | nib)
  }

  // ------------------------------------------------------------- reads

  private beginRead(): void {
    this.reading = true
    let v: number
    if (this.dl === 1 || this.upper) {
      v = this.rs === 0 ? (this.busy() ? 0x80 : 0) | (this.ac & 0x7f) : this.cg ? this.cgram[this.ac & 0x3f] : this.ddram[this.ac & 0x7f]
      this.readLatch = v
      if (this.dl === 0) v = v & 0xf0
    } else v = (this.readLatch << 4) & 0xf0
    const four = this.dl === 0
    this.cancelOut()
    this.outHandle = this.ctx.schedule(T_DDR, () => {
      this.outHandle = 0
      this.port.driveData(v, four)
    })
  }

  private endRead(): void {
    this.reading = false
    this.cancelOut()
    this.outHandle = this.ctx.schedule(T_DHR, () => {
      this.outHandle = 0
      this.port.driveData(null, false)
    })
    let complete = true
    if (this.dl === 0) {
      complete = !this.upper
      this.upper = !this.upper
    }
    if (complete && this.rs === 1) {
      // a data read moves the address counter like a write (no display shift)
      this.stepAc()
      this.busyUntil = Math.max(this.busyUntil, this.ctx.now() + HD_T_CMD)
      this.rev++
    }
  }

  private cancelOut(): void {
    if (this.outHandle) this.ctx.cancel(this.outHandle)
    this.outHandle = 0
  }

  // ------------------------------------------------------------- execution

  private execute(rs: 0 | 1, v: number): void {
    if (this.busy()) {
      this.warnOnce(
        'busy',
        'warning',
        `HD44780 ignored ${rs ? 'a data' : 'an instruction'} write while busy (BF = 1): poll the busy flag or wait 37 µs (1.52 ms after clear / home) between writes, and ≥ 15 ms after power-up`,
      )
      return
    }
    this.writes++
    this.rev++
    if (rs === 1) {
      this.writeData(v)
      this.busyUntil = this.ctx.now() + HD_T_CMD
      return
    }
    let t = HD_T_CMD
    if (v === 0x01) {
      this.ddram.fill(0x20)
      this.ac = 0
      this.cg = false
      this.id = 1
      this.shift = 0
      t = HD_T_CLEAR
    } else if ((v & 0xfe) === 0x02) {
      this.ac = 0
      this.cg = false
      this.shift = 0
      t = HD_T_CLEAR
    } else if ((v & 0xfc) === 0x04) {
      this.id = (v >> 1) & 1
      this.sh = v & 1
    } else if ((v & 0xf8) === 0x08) {
      this.d = (v >> 2) & 1
      this.c = (v >> 1) & 1
      this.b = v & 1
    } else if ((v & 0xf0) === 0x10) {
      const right = (v & 0x04) !== 0
      if (v & 0x08) this.shiftDisplay(right ? 1 : -1)
      else {
        const save = this.id
        this.id = right ? 1 : 0
        this.stepAc()
        this.id = save
      }
    } else if ((v & 0xe0) === 0x20) {
      this.dl = (v >> 4) & 1
      this.n = (v >> 3) & 1
      this.f = (v >> 2) & 1
      this.upper = true
      if (this.n === 0) this.shift %= 80
      else this.shift %= 40
    } else if ((v & 0xc0) === 0x40) {
      this.ac = v & 0x3f
      this.cg = true
    } else {
      this.ac = v & 0x7f
      this.cg = false
      if (this.n === 1 && ((this.ac > 0x27 && this.ac < 0x40) || this.ac > 0x67)) {
        this.warnOnce('ddaddr', 'log', `HD44780 DDRAM address 0x${this.ac.toString(16).toUpperCase()} is outside the 2-line ranges 00h–27h / 40h–67h`)
      }
    }
    this.busyUntil = this.ctx.now() + t
  }

  private writeData(v: number): void {
    if (this.cg) {
      this.cgram[this.ac & 0x3f] = v & 0x1f
      this.stepAc()
      return
    }
    this.ddram[this.ac & 0x7f] = v
    this.stepAc()
    // S = 1: the display shifts with every DDRAM write (left for I/D = 1, right for I/D = 0)
    if (this.sh) this.shiftDisplay(this.id ? -1 : 1)
  }

  /** move AC by ±1 (I/D) with the DDRAM / CGRAM wrap rules */
  private stepAc(): void {
    if (this.cg) {
      this.ac = (this.ac + (this.id ? 1 : -1)) & 0x3f
      return
    }
    let a = this.ac
    if (this.n === 1) {
      if (this.id) a = a === 0x27 ? 0x40 : a >= 0x67 ? 0x00 : a + 1
      else a = a === 0x00 ? 0x67 : a === 0x40 ? 0x27 : a - 1
    } else {
      a = this.id ? (a >= 0x4f ? 0 : a + 1) : a === 0 ? 0x4f : a - 1
    }
    this.ac = a & 0x7f
  }

  /** dir +1 = shift the display right (content moves right), −1 = left */
  private shiftDisplay(dir: 1 | -1): void {
    const len = this.n === 1 ? 40 : 80
    this.shift = (this.shift - dir + len) % len
  }

  // ------------------------------------------------------------- view

  /** DDRAM address shown at visible (row, col), or −1 when the row is not driven. */
  addrAt(row: number, col: number): number {
    const { cols, rows } = this.geom
    if (this.n === 0) {
      // 1-line mode: one 80-character line; only the first display row is driven
      if (row !== 0) return -1
      const p = (this.shift + col) % 80
      return p < 40 ? p : 0x40 + (p - 40)
    }
    const line = rows === 4 ? row & 1 : row
    const half = rows === 4 ? row >> 1 : 0
    const p = (this.shift + half * cols + col) % 40
    return (line ? 0x40 : 0) + p
  }

  /** Visible character codes per row. */
  rowsText(): string[] {
    const out: string[] = []
    for (let r = 0; r < this.geom.rows; r++) {
      let s = ''
      for (let c = 0; c < this.geom.cols; c++) {
        const a = this.addrAt(r, c)
        s += String.fromCharCode(a < 0 ? 0x20 : this.ddram[a])
      }
      out.push(s)
    }
    return out
  }

  /** Visible cursor cell [row, col] or null. */
  cursorCell(): [number, number] | null {
    if (this.cg) return null
    for (let r = 0; r < this.geom.rows; r++) {
      for (let c = 0; c < this.geom.cols; c++) if (this.addrAt(r, c) === this.ac) return [r, c]
    }
    return null
  }

  /**
   * Telemetry for a module. `vlcd` = V_DD − V0 (NaN when V0 is unconnected),
   * `backlight` 0..1 or undefined (the module LED is a sub-circuit element).
   */
  telemetry(powered: boolean, vlcd: number, backlight: number | undefined, cache: LcdTelemetryCache): DeviceTelemetry {
    const rows = this.rowsText()
    const cur = this.cursorCell()
    const v = Number.isFinite(vlcd) ? vlcd : 0
    // ON dots (2-line, 1/16 duty): invisible below ≈ 3.0 V, full contrast from ≈ 4.0 V
    const onLevel = powered ? smooth(v, 3.0, 4.0) : 0
    // OFF dots: 1-line mode (1/8 duty) over-drives row 1 → dark boxes; 2-line mode only ghosts at an extreme V_LCD
    const ghost1 = powered ? (this.n === 0 ? 0.85 * smooth(v, 3.2, 4.2) : 0.35 * smooth(v, 4.6, 5.2)) : 0
    const ghost2 = powered && this.n === 1 ? 0.35 * smooth(v, 4.6, 5.2) : 0
    const blinkPhase = Math.floor(this.ctx.now() / HD_BLINK) & 1
    const on = powered && this.d === 1
    const sig =
      rows.join('\u0001') +
      String.fromCharCode(...this.cgram) +
      [on ? 1 : 0, onLevel.toFixed(3), ghost1.toFixed(3), ghost2.toFixed(3), backlight ?? -1, cur ? cur[0] * 64 + cur[1] : -1, this.c, this.b, this.b ? blinkPhase : 0, this.n].join(',')
    if (sig !== cache.sig || !cache.tele) {
      cache.sig = sig
      cache.version++
      const display: DisplayTelemetry = {
        version: cache.version,
        width: this.geom.cols,
        height: this.geom.rows,
        format: 'chars',
        text: rows,
        data: this.cgram.slice(),
        on,
        contrast: onLevel,
      }
      if (backlight !== undefined) display.backlight = backlight
      cache.tele = {
        display,
        values: {
          cursorRow: cur ? cur[0] : -1,
          cursorCol: cur ? cur[1] : -1,
          cursor: this.c,
          blink: this.b,
          blinkPhase,
          ghostRow1: ghost1,
          ghostOther: ghost2,
          lines: this.n ? 2 : 1,
          vlcd: v,
        },
      }
    }
    if (cache.tele.values) {
      cache.tele.values.busy = this.busy() ? 1 : 0
      cache.tele.values.ac = this.ac
    }
    return cache.tele
  }
}

export interface LcdTelemetryCache {
  sig: string
  version: number
  tele: DeviceTelemetry | null
}

const newCache = (): LcdTelemetryCache => ({ sig: '', version: 0, tele: null })

const DATA_PINS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'] as const

/**
 * LCD1602 / LCD2004 module with the 16-pin parallel header
 * (VSS VDD V0 RS RW E D0–D7 A K). V0 is sensed (the contrast pot's wiper);
 * the backlight LED (A/K + the module's series resistor) is a catalog
 * sub-circuit, so its brightness is the real LED current.
 */
export class Hd44780ParallelDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  lcd!: Hd44780
  private powered = false
  private readonly cache = newCache()
  private fourBit = false

  constructor(readonly geom: LcdGeometry) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.lcd = new Hd44780(this.geom, ctx, {
      driveData: (value, four) => {
        this.fourBit = four
        for (let i = 0; i < 8; i++) {
          const pin = DATA_PINS[i]
          if (value === null || (four && i < 4)) ctx.drive(pin, 'pull-up')
          else ctx.drive(pin, (value >> i) & 1 ? 'high' : 'low')
        }
      },
    })
    for (const p of ['RS', 'RW', ...DATA_PINS]) ctx.drive(p, 'pull-up')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (on) this.lcd.powerUp()
    else this.lcd.powerDown()
  }

  /** pulled-up input: floating reads 1 */
  private bit(pin: string): 0 | 1 {
    return this.ctx.read(pin) === 0 ? 0 : 1
  }

  onPinChange(_pin: string, _level: LogicLevel): void {
    if (!this.powered) return
    let data = 0
    for (let i = 0; i < 8; i++) data |= this.bit(DATA_PINS[i]) << i
    this.lcd.inputs(this.bit('RS'), this.bit('RW'), this.ctx.read('E'), data)
  }

  telemetry(): DeviceTelemetry {
    const vdd = this.ctx.supply()
    const vss = this.ctx.voltage('VSS')
    const v0 = this.ctx.voltage('V0') - (Number.isFinite(vss) ? vss : 0)
    const vlcd = Number.isFinite(v0) ? vdd - v0 : NaN
    const t = this.lcd.telemetry(this.powered, vlcd, undefined, this.cache)
    if (this.powered && this.lcd.d === 1 && !this.v0Warned && (t.display?.contrast ?? 0) < 0.05) {
      this.v0Warned = true
      this.ctx.log(
        `LCD contrast: V_LCD = VDD − V0 = ${Number.isFinite(vlcd) ? vlcd.toFixed(2) : '?'} V is too low to show the characters — wire V0 to the wiper of a 10 kΩ pot (≈ 0.3–1 V) or through ≈ 1 kΩ to GND`,
      )
    }
    return t
  }

  private v0Warned = false
}

/**
 * LCD1602 + PCF8574 I²C backpack (GND VCC SDA SCL). PCF8574 (NXP
 * PCF8574 rev. 5): 7-bit address 0100·A2A1A0 (0x20–0x27; PCF8574A
 * 0x38–0x3F), A2–A0 pulled up on the backpack → 0x27 / 0x3F. A write sets
 * the quasi-bidirectional port latch (outputs valid after the ACK clock);
 * a read returns the port pin levels (a latch 1 pin is a weak pull-up the
 * LCD can pull low). Backpack wiring: P0 = RS, P1 = R/W, P2 = E, P3 =
 * backlight transistor, P4–P7 = DB4–DB7; DB0–DB3 unconnected (pulled up).
 * Power-up: port latch FFh (backlight on, E high).
 */
export class Lcd1602I2cDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  lcd!: Hd44780
  private bus!: I2cSlave
  private powered = false
  latch = 0xff
  /** LCD drive on DB7–DB4: value bits / null */
  private lcdDrive: number | null = null
  private readonly cache = newCache()

  constructor(
    readonly geom: LcdGeometry,
    readonly address: number,
    private contrast: number,
  ) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.lcd = new Hd44780(this.geom, ctx, {
      driveData: (value) => {
        this.lcdDrive = value
      },
    })
    this.bus = new I2cSlave(ctx, {
      matches: (a) => a === this.address,
      write: (b) => {
        this.pending = b
        return true
      },
      afterWriteAck: () => {
        this.latch = this.pending
        this.applyPort()
      },
      read: () => this.portPins(),
    })
    ctx.drive('SDA', 'z')
  }

  private pending = 0xff

  powerChanged(on: boolean): void {
    this.powered = on
    this.bus.reset()
    if (on) {
      this.latch = 0xff
      this.lcdDrive = null
      this.lcd.powerUp()
      this.applyPort()
    } else this.lcd.powerDown()
  }

  /** PCF8574 pin levels as read back (quasi-bidirectional: latch AND external pull-down) */
  portPins(): number {
    let v = this.latch
    if (this.lcdDrive !== null) v &= (this.lcdDrive & 0xf0) | 0x0f
    return v & 0xff
  }

  private applyPort(): void {
    const p = this.portPins()
    const data = (p & 0xf0) | 0x0f
    this.lcd.inputs((p & 1) as 0 | 1, ((p >> 1) & 1) as 0 | 1, ((p >> 2) & 1) as 0 | 1, data)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    this.bus.onPinChange(pin, level)
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'contrast' && typeof value === 'number' && Number.isFinite(value)) this.contrast = Math.min(1, Math.max(0, value))
  }

  telemetry(): DeviceTelemetry {
    const vdd = this.ctx.supply()
    // backpack trimmer (10 kΩ) from VDD to GND, wiper on V0: V_LCD = position × V_DD
    const vlcd = this.contrast * vdd
    const bl = this.powered && (this.latch & 0x08) !== 0 ? 1 : 0
    const t = this.lcd.telemetry(this.powered, vlcd, bl, this.cache)
    if (t.values) t.values.port = this.latch
    return t
  }
}
