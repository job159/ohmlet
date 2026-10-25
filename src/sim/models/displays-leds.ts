/**
 * LED display drivers: MAX7219 (8×8 matrix module), WS2812B (8-LED strip)
 * and TM1637 (4-digit 7-segment module). All driven by pin edges only.
 */
import type { DisplayTelemetry } from '../../model/types'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import { InputWatch, powerUpNoise } from './displays-i2c'

// ============================================================== MAX7219

/**
 * MAX7219 (Maxim 19-4452 Rev 4): 16-bit shift register clocked on CLK
 * rising edges (DIN, MSB = D15 first) whatever LOAD (CS) does; LOAD's
 * rising edge latches the last 16 bits: D11–D8 address, D7–D0 data
 * (Table 2). Registers: digits 0–7 (1h–8h), decode mode (9h, Code B per
 * digit, Table 5), intensity (Ah: PWM (2n+1)/32), scan limit (Bh: digits
 * 0…n displayed), shutdown (Ch: 0 = shutdown, blanked), display test (Fh:
 * all LEDs on, overriding every other register incl. shutdown). Power-up:
 * control registers reset (shutdown, no decode, intensity 1/32, scan
 * limit 0, test off); digit registers undefined (random).
 *
 * Module wiring (DIP-24 "MAX7219 dot matrix module" with an 1088AS
 * matrix): digit n drives matrix row n (row 0 = farthest from the input
 * header), segment DP (D7) the leftmost column … G (D0) the rightmost.
 */
const CODE_B = [0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0x01, 0x4f, 0x37, 0x0e, 0x67, 0x00]

export class Max7219Device implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private shift = 0
  private clk: 0 | 1 = 0
  private load: 0 | 1 = 1
  readonly digits = new Uint8Array(8)
  decode = 0
  intensity = 0
  scanLimit = 0
  shutdown = true
  test = false
  latches = 0
  private version = 0
  private sig = ''
  private tele: DeviceTelemetry | null = null
  private watch!: InputWatch

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.watch = new InputWatch(ctx, 'MAX7219', 0.7)
  }

  powerChanged(on: boolean): void {
    this.powered = on
    if (!on) {
      this.watch.stopSupervision()
      return
    }
    // 3.3 V logic at V+ = 5 V sits between V_IL 0.8 V and V_IH 3.5 V
    this.watch.supervise(['CLK', 'CS', 'DIN'], 0.16)
    powerUpNoise(this.ctx.componentId + ':digits', this.digits)
    this.decode = 0
    this.intensity = 0
    this.scanLimit = 0
    this.shutdown = true
    this.test = false
    this.shift = 0
    this.clk = this.ctx.read('CLK') === 1 ? 1 : 0
    this.load = this.ctx.read('CS') === 0 ? 0 : 1
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (level === null) {
      this.watch.undefinedLevel(pin)
      return
    }
    if (pin === 'CLK') {
      const prev = this.clk
      this.clk = level
      if (level === 1 && prev === 0) this.shift = ((this.shift << 1) | (this.ctx.read('DIN') === 1 ? 1 : 0)) & 0xffff
      return
    }
    if (pin === 'CS') {
      const prev = this.load
      this.load = level
      if (level === 1 && prev === 0) this.latch(this.shift)
    }
  }

  private latch(w: number): void {
    this.latches++
    const addr = (w >> 8) & 0x0f
    const d = w & 0xff
    if (addr >= 1 && addr <= 8) this.digits[addr - 1] = d
    else if (addr === 0x9) this.decode = d
    else if (addr === 0xa) this.intensity = d & 0x0f
    else if (addr === 0xb) this.scanLimit = d & 0x07
    else if (addr === 0xc) this.shutdown = (d & 1) === 0
    else if (addr === 0xf) this.test = (d & 1) === 1
  }

  /** segment byte (DP A B C D E F G = D7…D0) shown on digit n */
  segments(n: number): number {
    const v = this.digits[n]
    return (this.decode >> n) & 1 ? CODE_B[v & 0x0f] | (v & 0x80) : v
  }

  /** 8×8 image, 'mono-pages' layout: byte per column (left → right), bit r = row r */
  image(): Uint8Array {
    const img = new Uint8Array(8)
    if (!this.powered) return img
    if (this.test) return img.fill(0xff)
    if (this.shutdown) return img
    for (let r = 0; r <= this.scanLimit; r++) {
      const s = this.segments(r)
      for (let c = 0; c < 8; c++) if ((s >> (7 - c)) & 1) img[c] |= 1 << r
    }
    return img
  }

  /** relative LED brightness: PWM duty × multiplex duty, 1 = 31/32 over 8 digits */
  brightness(): number {
    const pwm = this.test ? 31 / 32 : (2 * this.intensity + 1) / 32
    const digits = this.test ? 8 : this.scanLimit + 1
    return Math.min(2, (pwm / (31 / 32)) * (8 / digits))
  }

  telemetry(): DeviceTelemetry {
    const img = this.image()
    const on = this.powered && (this.test || !this.shutdown)
    const b = this.brightness()
    const sig = `${Array.from(img).join(',')}|${on ? 1 : 0}|${b.toFixed(3)}`
    if (sig !== this.sig || !this.tele) {
      this.sig = sig
      this.version++
      const display: DisplayTelemetry = { version: this.version, width: 8, height: 8, format: 'mono-pages', data: img, on, contrast: b }
      this.tele = {
        display,
        values: { intensity: this.intensity, scanLimit: this.scanLimit, shutdown: this.shutdown ? 1 : 0, test: this.test ? 1 : 0, decode: this.decode },
      }
    }
    return this.tele
  }
}

// ============================================================== WS2812B

/**
 * WS2812B (Worldsemi datasheet): single-wire NRZ data, 24 bits per LED in
 * G-R-B order, MSB first. Each bit starts with a rising edge; the chip
 * samples DIN a fixed time after it (modeled at 0.6 µs, between T0H max
 * 0.55 µs and T1H min 0.65 µs): high → 1, low → 0. The first 24 bits stay
 * in the first LED, later bits are regenerated on its DOUT for the next
 * LED (here: the next of the 8 LEDs on the strip, then the strip's DOUT
 * pin, re-timed to T0H 0.4 µs / T1H 0.8 µs from the sample point). A low
 * level held ≥ 280 µs (RES) latches every LED's 24 bits into its PWM
 * outputs and restarts the bit count. Measured high times outside T0H /
 * T1H (± 150 ns) are reported once — they are read exactly as the sampling
 * point says (e.g. 0.45 µs highs at an 8 MHz SPI clock all read as 0).
 */
export const WS_T_SAMPLE = 0.6e-6
export const WS_T_RES = 280e-6
const WS_T0H = [0.25e-6, 0.55e-6]
const WS_T1H = [0.65e-6, 0.95e-6]

export class Ws2812StripDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private din: 0 | 1 = 0
  private riseAt = -1
  private fallAt = -1
  private bitCount = 0
  /** shift registers being received, one 24-bit word per LED */
  private readonly rx: Uint32Array
  /** latched PWM values (0xGGRRBB as received) */
  readonly latched: Uint32Array
  private resHandle = 0
  frames = 0
  forwarded = 0
  private version = 0
  private sig = ''
  private tele: DeviceTelemetry | null = null
  private hinted = new Set<string>()
  private watch!: InputWatch

  constructor(readonly count: number) {
    this.rx = new Uint32Array(count)
    this.latched = new Uint32Array(count)
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.watch = new InputWatch(ctx, 'WS2812B', 0.7)
    ctx.drive('DOUT', 'low')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    // DIN held between V_IL 0.3·VDD and V_IH 0.7·VDD (3.3 V data at 5 V) never makes an edge
    if (on) this.watch.supervise(['DIN'], 0.3)
    else this.watch.stopSupervision()
    this.latched.fill(0)
    this.rx.fill(0)
    this.bitCount = 0
    this.din = this.ctx.read('DIN') === 1 ? 1 : 0
    this.ctx.drive('DOUT', 'low')
  }

  private hint(key: string, message: string): void {
    if (this.hinted.has(key)) return
    this.hinted.add(key)
    this.ctx.log(message)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered || pin !== 'DIN' || level === null || level === this.din) return
    this.din = level
    const now = this.ctx.now()
    if (level === 1) {
      if (this.resHandle) {
        this.ctx.cancel(this.resHandle)
        this.resHandle = 0
      }
      if (this.fallAt >= 0) {
        const low = now - this.fallAt
        if (low > 50e-6 && low < WS_T_RES && this.bitCount > 0) {
          this.hint('gap', `WS2812B: a ${fmtUs(low)} low pause inside the data stream does not latch (RES needs ≥ 280 µs) — the following bits continue the same frame`)
        }
      }
      this.riseAt = now
      const v = this.ctx.voltage('DIN')
      const vdd = this.ctx.supply()
      if (Number.isFinite(v) && v < 0.7 * vdd - 0.01) {
        this.hint('vih', `WS2812B: DIN high is ${v.toFixed(2)} V, below V_IH = 0.7·VDD = ${(0.7 * vdd).toFixed(2)} V`)
      }
      this.ctx.schedule(WS_T_SAMPLE, () => this.sample())
      return
    }
    // falling: measure the high time (diagnostics only)
    this.fallAt = now
    if (this.riseAt >= 0) {
      const h = now - this.riseAt
      const ok = (h >= WS_T0H[0] && h <= WS_T0H[1]) || (h >= WS_T1H[0] && h <= WS_T1H[1])
      if (!ok) {
        this.hint(
          'th',
          `WS2812B: ${fmtUs(h)} high pulse is outside T0H 0.25–0.55 µs / T1H 0.65–0.95 µs — read as ${h >= WS_T_SAMPLE ? '1' : '0'} (the chip samples DIN 0.6 µs after the rising edge)`,
        )
      }
    }
    this.resHandle = this.ctx.schedule(WS_T_RES, () => {
      this.resHandle = 0
      this.latch()
    })
  }

  private sample(): void {
    if (!this.powered) return
    const bit = this.din
    const n = this.bitCount++
    const led = Math.floor(n / 24)
    if (led < this.count) {
      this.rx[led] = ((this.rx[led] << 1) | bit) & 0xffffff
      return
    }
    // forwarded: regenerate the bit on DOUT
    this.forwarded++
    this.ctx.drive('DOUT', 'high')
    this.ctx.schedule(bit ? 0.8e-6 : 0.4e-6, () => this.ctx.drive('DOUT', 'low'))
  }

  private latch(): void {
    const full = Math.min(this.count, Math.floor(this.bitCount / 24))
    for (let i = 0; i < full; i++) this.latched[i] = this.rx[i]
    if (this.bitCount > 0 && this.bitCount % 24 !== 0 && this.bitCount < 24 * this.count) {
      this.hint('partial', `WS2812B: reset after ${this.bitCount} bits (not a multiple of 24): LED ${full + 1} kept its previous colour`)
    }
    if (this.bitCount > 0) this.frames++
    this.bitCount = 0
  }

  /** packed 0xRRGGBB per LED */
  colors(): number[] {
    const out: number[] = []
    for (let i = 0; i < this.count; i++) {
      const w = this.powered ? this.latched[i] : 0
      const g = (w >> 16) & 0xff
      const r = (w >> 8) & 0xff
      const b = w & 0xff
      out.push((r << 16) | (g << 8) | b)
    }
    return out
  }

  telemetry(): DeviceTelemetry {
    const rgb = this.colors()
    const sig = rgb.join(',')
    if (sig !== this.sig || !this.tele) {
      this.sig = sig
      this.version++
      this.tele = { rgb, values: { frames: this.frames, version: this.version } }
    } else if (this.tele.values) this.tele.values.frames = this.frames
    return this.tele
  }
}

function fmtUs(s: number): string {
  return `${(s * 1e6).toFixed(s < 10e-6 ? 2 : 0)} µs`
}

// ============================================================== TM1637

/**
 * TM1637 (Titan Micro TM1637 V2.4): two-wire serial, LSB first. START =
 * DIO falling while CLK is high, STOP = DIO rising while CLK is high; DIO
 * is read on CLK rising edges. After the 8th bit the chip pulls DIO low
 * from the 8th CLK falling edge to the 9th (ACK). The first byte after
 * START is a command: 40h–7Fh data command (bit 1 read keys, bit 2 fixed
 * address), C0h–C5h address (display data bytes follow), 80h–8Fh display
 * control (bit 3 on, bits 2–0 pulse width 1/16, 2/16, 4/16, 10/16 … 14/16).
 * A key read (42h) shifts the key byte out on DIO (no keys on the module:
 * FFh). Module: grids 1–4 = digits left → right, segment bits a…g = bit
 * 0…6, the colon is bit 7 of grid 2. DIO is open drain.
 */
const TM_PWM = [1, 2, 4, 10, 11, 12, 13, 14].map((x) => x / 16)

export class Tm1637Device implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  private powered = false
  private clk: 0 | 1 = 1
  private dio: 0 | 1 = 1
  private state: 'idle' | 'byte' | 'ack' | 'read' = 'idle'
  private bits = 0
  private shift = 0
  private first = true
  private addr = 0
  private fixed = false
  private readKeys = false
  private keyByte = 0xff
  readonly grids = new Uint8Array(6)
  displayOn = false
  pulse = 0
  acks = 0
  private version = 0
  private sig = ''
  private tele: DeviceTelemetry | null = null
  private outHandle = 0

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('DIO', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.state = 'idle'
    this.ctx.drive('DIO', 'z')
    if (!on) return
    powerUpNoise(this.ctx.componentId + ':grids', this.grids)
    this.displayOn = false
    this.pulse = 0
    this.clk = this.ctx.read('CLK') === 0 ? 0 : 1
    this.dio = this.ctx.read('DIO') === 0 ? 0 : 1
  }

  private out(level: 0 | 1): void {
    if (this.outHandle) this.ctx.cancel(this.outHandle)
    this.outHandle = this.ctx.schedule(0.1e-6, () => {
      this.outHandle = 0
      this.ctx.drive('DIO', level ? 'z' : 'low')
    })
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered || level === null) return
    if (pin === 'DIO') {
      const prev = this.dio
      this.dio = level
      if (this.clk === 1 && prev !== level && this.state !== 'read') {
        if (level === 0) {
          // START
          this.state = 'byte'
          this.bits = 0
          this.shift = 0
          this.first = true
          this.readKeys = false
        } else {
          this.state = 'idle'
        }
      }
      return
    }
    if (pin !== 'CLK' || level === this.clk) return
    this.clk = level
    if (level === 1) {
      if (this.state === 'byte' && this.bits < 8) {
        this.shift |= this.dio << this.bits
        this.bits++
      }
      return
    }
    // CLK falling
    if (this.state === 'byte' && this.bits === 8) {
      this.out(0)
      this.acks++
      this.handle(this.shift & 0xff)
      this.state = 'ack'
      return
    }
    if (this.state === 'ack') {
      this.bits = 0
      this.shift = 0
      if (this.readKeys) {
        this.state = 'read'
        this.out((this.keyByte & 1) as 0 | 1)
        this.bits = 1
      } else {
        this.out(1)
        this.state = 'byte'
      }
      return
    }
    if (this.state === 'read') {
      if (this.bits < 8) {
        this.out(((this.keyByte >> this.bits) & 1) as 0 | 1)
        this.bits++
      } else {
        this.out(1)
        this.state = 'idle'
      }
    }
  }

  private handle(b: number): void {
    if (this.first) {
      this.first = false
      const kind = b & 0xc0
      if (kind === 0x40) {
        this.readKeys = (b & 0x02) !== 0
        this.fixed = (b & 0x04) !== 0
      } else if (kind === 0xc0) {
        this.addr = b & 0x07
      } else if (kind === 0x80) {
        this.displayOn = (b & 0x08) !== 0
        this.pulse = b & 0x07
      }
      return
    }
    // display data after an address command
    if (this.addr < 6) this.grids[this.addr] = b
    if (!this.fixed) this.addr = (this.addr + 1) & 7
  }

  /** brightness 0..1 of a lit segment (pulse width) */
  brightness(): number {
    return this.powered && this.displayOn ? TM_PWM[this.pulse] / TM_PWM[7] : 0
  }

  telemetry(): DeviceTelemetry {
    const b = this.brightness()
    const segs = [0, 1, 2, 3].map((i) => (this.powered ? this.grids[i] : 0))
    const sig = `${segs.join(',')}|${b.toFixed(3)}`
    if (sig !== this.sig || !this.tele) {
      this.sig = sig
      this.version++
      this.tele = {
        values: {
          seg0: segs[0],
          seg1: segs[1],
          seg2: segs[2],
          seg3: segs[3],
          brightness: b,
          pulse: this.pulse,
          on: this.powered && this.displayOn ? 1 : 0,
          version: this.version,
        },
      }
    }
    return this.tele
  }
}
