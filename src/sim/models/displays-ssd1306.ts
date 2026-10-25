/**
 * SSD1306 (Solomon Systech SSD1306 Rev 1.1) and SH1106 (Sino Wealth SH1106
 * V2.3) 128×64 OLED controllers, as used on the 0.96" / 1.3" modules, plus
 * their I²C and 4-wire SPI front ends. Everything is driven by pin edges;
 * the image the glass shows is DERIVED from GDDRAM + the programmed
 * registers, never stored separately.
 *
 * Command set (SSD1306 §9 / §10, SH1106 §"Commands"):
 *  • fundamental: 81h contrast, A4h/A5h RAM / entire display on, A6h/A7h
 *    normal / inverse, AEh/AFh display off / on;
 *  • addressing (SSD1306): 20h mode (horizontal / vertical / page), 21h
 *    column window, 22h page window, B0h–B7h page start, 00h–0Fh / 10h–1Fh
 *    column start nibbles (page mode); SH1106: page mode only (B0h–B7h,
 *    00h–0Fh, 10h–1Fh) over 132 columns — 20h/21h/22h are NOT SH1106
 *    commands, so their parameter bytes are executed as commands (the real
 *    "SSD1306 driver on an SH1106" garbage);
 *  • hardware configuration: 40h–7Fh start line, A0h/A1h segment remap,
 *    A8h multiplex ratio, C0h/C8h COM scan direction, D3h display offset,
 *    DAh COM pins configuration (sequential / alternative, left/right remap);
 *  • timing & driving: D5h clock divide / oscillator, D9h pre-charge, DBh
 *    VCOMH (stored; pre-charge and VCOMH do not change the image), E3h NOP;
 *  • charge pump (SSD1306 8Dh 14h / 10h, default OFF): the modules have no
 *    external VCC, so without 8Dh 14h the panel stays dark although the RAM
 *    holds the image — as on hardware. SH1106: ADh 8Bh / 8Ah DC-DC
 *    (default ON);
 *  • scrolling (SSD1306): 26h/27h continuous horizontal scroll, 29h/2Ah
 *    vertical + horizontal scroll, 2Eh deactivate, 2Fh activate, A3h area.
 *    Steps are scheduled from the frame rate the D5h / D9h / A8h settings
 *    give (Fosc ≈ 370 kHz at the reset value) and rotate the GDDRAM columns
 *    of the selected pages one column per step (the datasheet asks to
 *    rewrite RAM after 2Eh because scrolling moved it).
 *
 * Panel mapping (what the glass shows), applied in this order:
 *  line i (0 … MUX−1) → RAM row (i + start line [+ vertical scroll]) mod 64;
 *  COM index k shows line ((C8 ? MUX−1−k : k) + offset) mod 64 if < MUX;
 *  COM k → COM pin by DAh (alternative: even k → pin k/2, odd k → pin
 *  32 + (k−1)/2; left/right remap swaps the halves) → physical row (the
 *  128×64 glass is wired for the alternative configuration: pin p < 32 →
 *  row 2p, else row 2(p−32)+1). Segments: SSD1306 panel column x is SEG x
 *  (A1h: RAM column 127−x); SH1106 drives the 128-pixel glass from SEG2 …
 *  SEG129 (column offset 2; A1h: RAM column 129−x). The modules' glass is
 *  mounted so that the usual A1h + C8h setup shows an upright image with
 *  the header at the top (both axes mirrored relative to SEG0 / COM0).
 */
import type { DisplayTelemetry } from '../../model/types'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import { I2cSlave, InputWatch, powerUpNoise } from './displays-i2c'

export type OledKind = 'ssd1306' | 'sh1106'

export const OLED_W = 128
export const OLED_H = 64

/** SSD1306 oscillator at the reset value of D5h (datasheet Table 11-1: Fosc typ. 370 kHz). */
const FOSC_DEFAULT = 370e3

/** Parameter byte counts of multi-byte commands. */
const SSD1306_ARGS: Record<number, number> = {
  0x81: 1, 0x20: 1, 0x21: 2, 0x22: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0xa3: 2,
  0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1, 0x8d: 1, 0x23: 1, 0xd6: 1,
}
const SH1106_ARGS: Record<number, number> = {
  0x81: 1, 0xa8: 1, 0xad: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1,
}

/** 26h/27h/29h/2Ah frame-interval code → frames per scroll step (SSD1306 Table 9-1). */
const SCROLL_FRAMES = [5, 64, 128, 256, 3, 4, 25, 2]

export class OledController {
  readonly ramCols: number
  readonly ram: Uint8Array
  private readonly args: Record<number, number>
  // ---- registers
  contrast = 0x7f
  displayOn = false
  entireOn = false
  inverse = false
  /** SSD1306 charge pump (8Dh) / SH1106 DC-DC (ADh) enabled */
  pump = false
  mux = 64
  offset = 0
  startLine = 0
  segRemap = false
  comRemap = false
  comPins = 0x12
  clockDiv = 0x80
  precharge = 0x22
  vcomh = 0x20
  /** 0 horizontal, 1 vertical, 2 page (SSD1306 reset value: page) */
  addrMode = 2
  colStart = 0
  colEnd = 127
  pageStart = 0
  pageEnd = 7
  col = 0
  page = 0
  // ---- scrolling (SSD1306)
  private scrollSetup: { dir: 1 | -1; start: number; end: number; frames: number; vOff: number } | null = null
  scrolling = false
  private scrollHandle = 0
  private scrollV = 0
  // ---- command parsing
  private cmd = -1
  private argBuf: number[] = []
  private warned = new Set<string>()
  /** bumped on every change of what the glass could show */
  rev = 0

  constructor(
    readonly kind: OledKind,
    private readonly ctx: DigitalDeviceCtx,
  ) {
    this.ramCols = kind === 'sh1106' ? 132 : 128
    this.ram = new Uint8Array(8 * this.ramCols)
    this.args = kind === 'sh1106' ? SH1106_ARGS : SSD1306_ARGS
  }

  /** Power-up: random GDDRAM (real SRAM), every register at its reset value. */
  powerUp(): void {
    powerUpNoise(this.ctx.componentId, this.ram)
    this.reset()
  }

  /** RES# / power-on reset: registers to their reset values; GDDRAM is kept. */
  reset(): void {
    this.contrast = this.kind === 'sh1106' ? 0x80 : 0x7f
    this.displayOn = false
    this.entireOn = false
    this.inverse = false
    this.pump = this.kind === 'sh1106' // SH1106 DC-DC is ON after reset, SSD1306 charge pump OFF
    this.mux = 64
    this.offset = 0
    this.startLine = 0
    this.segRemap = false
    this.comRemap = false
    this.comPins = 0x12
    this.clockDiv = this.kind === 'sh1106' ? 0x50 : 0x80
    this.precharge = 0x22
    this.vcomh = this.kind === 'sh1106' ? 0x35 : 0x20
    this.addrMode = 2
    this.colStart = 0
    this.colEnd = 127
    this.pageStart = 0
    this.pageEnd = 7
    this.col = 0
    this.page = 0
    this.stopScroll()
    this.scrollSetup = null
    this.scrollV = 0
    this.cmd = -1
    this.argBuf = []
    this.rev++
  }

  stopScroll(): void {
    if (this.scrollHandle) this.ctx.cancel(this.scrollHandle)
    this.scrollHandle = 0
    this.scrolling = false
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.log(message)
  }

  // ================================================================ commands

  /** One byte of the command stream (D/C# = 0). */
  command(b: number): void {
    if (this.cmd >= 0) {
      this.argBuf.push(b)
      if (this.argBuf.length >= (this.args[this.cmd] ?? 0)) {
        const c = this.cmd
        this.cmd = -1
        this.execArgs(c, this.argBuf)
        this.argBuf = []
      }
      return
    }
    if ((this.args[b] ?? 0) > 0) {
      this.cmd = b
      this.argBuf = []
      return
    }
    this.exec1(b)
  }

  private exec1(b: number): void {
    const sh = this.kind === 'sh1106'
    if (b <= 0x0f) {
      // lower column nibble (page addressing)
      if (sh || this.addrMode === 2) this.col = (this.col & 0xf0) | b
      return
    }
    if (b <= 0x1f) {
      const hi = b & 0x0f
      if (sh) this.col = ((hi & 0x0f) << 4) | (this.col & 0x0f)
      else if (this.addrMode === 2) this.col = ((hi & 0x07) << 4) | (this.col & 0x0f)
      return
    }
    if (b >= 0x40 && b <= 0x7f) {
      this.startLine = b & 0x3f
      this.rev++
      return
    }
    if (b >= 0xb0 && b <= 0xb7) {
      if (sh || this.addrMode === 2) this.page = b & 7
      return
    }
    switch (b) {
      case 0xa0:
      case 0xa1:
        this.segRemap = b === 0xa1
        this.rev++
        return
      case 0xa4:
      case 0xa5:
        this.entireOn = b === 0xa5
        this.rev++
        return
      case 0xa6:
      case 0xa7:
        this.inverse = b === 0xa7
        this.rev++
        return
      case 0xae:
      case 0xaf:
        this.displayOn = b === 0xaf
        this.rev++
        return
      case 0xc0:
      case 0xc8:
        this.comRemap = b === 0xc8
        this.rev++
        return
      case 0xe3:
        return // NOP
    }
    if (sh) {
      if (b >= 0x30 && b <= 0x33) return // pump voltage (VPP) — no visible effect
      if (b === 0xe0 || b === 0xee) {
        this.warnOnce('rmw', `SH1106 read-modify-write (0x${hex(b)}) is not modeled (data reads are not available on the serial interface)`)
        return
      }
      this.warnOnce(`cmd:${b}`, `SH1106 ignored unknown command byte 0x${hex(b)} (not an SH1106 command — an SSD1306 driver?)`)
      return
    }
    switch (b) {
      case 0x2e:
        this.stopScroll()
        return
      case 0x2f:
        if (!this.scrollSetup) {
          this.warnOnce('noscroll', 'SSD1306 2Fh (activate scroll) without a scroll setup (26h/27h/29h/2Ah) — ignored')
          return
        }
        this.startScroll()
        return
    }
    this.warnOnce(`cmd:${b}`, `SSD1306 ignored unknown command byte 0x${hex(b)}`)
  }

  private execArgs(c: number, a: number[]): void {
    switch (c) {
      case 0x81:
        this.contrast = a[0]
        this.rev++
        return
      case 0x20:
        this.addrMode = a[0] & 3
        if (this.addrMode === 3) {
          this.warnOnce('mode3', 'SSD1306 20h: memory addressing mode 3 is invalid')
          this.addrMode = 2
        }
        return
      case 0x21:
        this.colStart = a[0] & 0x7f
        this.colEnd = a[1] & 0x7f
        this.col = this.colStart
        return
      case 0x22:
        this.pageStart = a[0] & 7
        this.pageEnd = a[1] & 7
        this.page = this.pageStart
        return
      case 0x26:
      case 0x27:
        this.stopScroll()
        this.scrollSetup = { dir: c === 0x26 ? 1 : -1, start: a[1] & 7, frames: SCROLL_FRAMES[a[2] & 7], end: a[3] & 7, vOff: 0 }
        return
      case 0x29:
      case 0x2a:
        this.stopScroll()
        this.scrollSetup = { dir: c === 0x29 ? 1 : -1, start: a[1] & 7, frames: SCROLL_FRAMES[a[2] & 7], end: a[3] & 7, vOff: a[4] & 0x3f }
        return
      case 0xa3:
        return // vertical scroll area: stored only (the vertical offset applies to the whole panel)
      case 0xa8: {
        const m = (a[0] & 0x3f) + 1
        if (m < 16) {
          this.warnOnce('mux', `${this.kind.toUpperCase()} A8h: multiplex ratio ${m} is below the minimum 16 — ignored`)
          return
        }
        this.mux = m
        this.rev++
        return
      }
      case 0xd3:
        this.offset = a[0] & 0x3f
        this.rev++
        return
      case 0xd5:
        this.clockDiv = a[0]
        return
      case 0xd9:
        this.precharge = a[0]
        return
      case 0xda:
        this.comPins = a[0]
        this.rev++
        return
      case 0xdb:
        this.vcomh = a[0]
        return
      case 0x8d:
        this.pump = (a[0] & 0x04) !== 0
        this.rev++
        return
      case 0xad:
        // SH1106 DC-DC control: 8Bh on, 8Ah off
        this.pump = (a[0] & 0x01) !== 0
        this.rev++
        return
      case 0x23:
      case 0xd6:
        this.warnOnce(`cmd:${c}`, `SSD1306 ${hex(c)}h (fade / zoom) is accepted but not modeled`)
        return
    }
  }

  // ================================================================ GDDRAM

  /** One GDDRAM data byte (D/C# = 1). */
  data(b: number): void {
    const cols = this.ramCols
    if (this.col < cols) this.ram[this.page * cols + this.col] = b
    this.rev++
    if (this.kind === 'sh1106' || this.addrMode === 2) {
      this.col = this.col + 1 >= cols ? 0 : this.col + 1
      return
    }
    if (this.addrMode === 0) {
      if (this.col >= this.colEnd) {
        this.col = this.colStart
        this.page = this.page >= this.pageEnd ? this.pageStart : this.page + 1
      } else this.col++
      return
    }
    // vertical
    if (this.page >= this.pageEnd) {
      this.page = this.pageStart
      this.col = this.col >= this.colEnd ? this.colStart : this.col + 1
    } else this.page++
  }

  // ================================================================ scrolling

  /** Frame period from the D5h / D9h / A8h settings (s). */
  framePeriod(): number {
    const div = (this.clockDiv & 0x0f) + 1
    // oscillator setting A[7:4]: ≈ +4 % per step around the 370 kHz reset value
    const fosc = FOSC_DEFAULT * (1 + 0.04 * (((this.clockDiv >> 4) & 0x0f) - 8))
    const k = (this.precharge & 0x0f) + ((this.precharge >> 4) & 0x0f) + 50
    return (div * k * this.mux) / fosc
  }

  private startScroll(): void {
    this.stopScroll()
    this.scrolling = true
    const step = () => {
      const s = this.scrollSetup
      if (!s || !this.scrolling) return
      this.scrollStep(s)
      this.scrollHandle = this.ctx.schedule(s.frames * this.framePeriod(), step)
    }
    const s = this.scrollSetup
    if (s) this.scrollHandle = this.ctx.schedule(s.frames * this.framePeriod(), step)
  }

  private scrollStep(s: { dir: 1 | -1; start: number; end: number; vOff: number }): void {
    const cols = this.ramCols
    const last = Math.min(127, cols - 1)
    for (let p = s.start; p <= Math.max(s.start, s.end); p++) {
      const row = this.ram.subarray(p * cols, p * cols + last + 1)
      if (s.dir === 1) {
        const t = row[last]
        row.copyWithin(1, 0, last)
        row[0] = t
      } else {
        const t = row[0]
        row.copyWithin(0, 1, last + 1)
        row[last] = t
      }
    }
    if (s.vOff) this.scrollV = (this.scrollV + s.vOff) & 63
    this.rev++
  }

  // ================================================================ panel image

  /** The light-emitting state: display ON with the charge pump / DC-DC running. */
  lit(): boolean {
    return this.displayOn && this.pump
  }

  /** Render the 128×64 glass image (pages × 128, LSB = top row of the page) into `out`. */
  render(out: Uint8Array): void {
    out.fill(0)
    if (!this.lit()) return
    const cols = this.ramCols
    const mux = this.mux
    const alt = (this.comPins & 0x10) !== 0
    const lr = (this.comPins & 0x20) !== 0
    for (let k = 0; k < 64; k++) {
      // COM index k → line → RAM row
      const base = this.comRemap ? mux - 1 - k : k
      const line = (((base + this.offset) % 64) + 64) % 64
      if (k >= mux || line >= mux) continue
      const ramRow = (line + this.startLine + this.scrollV) & 63
      // COM k → pin → physical glass row
      let pin = alt ? (k % 2 === 0 ? k >> 1 : 32 + ((k - 1) >> 1)) : k
      if (lr) pin = (pin + 32) & 63
      const phys = pin < 32 ? 2 * pin : 2 * (pin - 32) + 1
      const sy = OLED_H - 1 - phys
      const page = ramRow >> 3
      const bit = 1 << (ramRow & 7)
      const outBit = 1 << (sy & 7)
      const outBase = (sy >> 3) * OLED_W
      for (let x = 0; x < OLED_W; x++) {
        let on: boolean
        if (this.entireOn) on = true
        else {
          const seg = this.kind === 'sh1106' ? x + 2 : x
          const c = this.segRemap ? cols - 1 - seg : seg
          on = ((this.ram[page * cols + c] & bit) !== 0) !== this.inverse
        }
        if (on) out[outBase + (OLED_W - 1 - x)] |= outBit
      }
    }
  }

  /** Relative panel brightness from the contrast register (segment current ∝ contrast + 1). */
  brightness(): number {
    return (this.contrast + 1) / 256
  }
}

function hex(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0')
}

/** Shared telemetry snapshot cache for OLED modules. */
export class OledTelemetry {
  private image = new Uint8Array((OLED_W * OLED_H) / 8)
  private lastRev = -1
  private lastOn = false
  private lastPowered = false
  private version = 0
  private tele: DisplayTelemetry | null = null

  snapshot(ctl: OledController, powered: boolean): DisplayTelemetry {
    const on = powered && ctl.lit()
    if (!this.tele || ctl.rev !== this.lastRev || on !== this.lastOn || powered !== this.lastPowered) {
      const img = new Uint8Array(this.image.length)
      if (powered) ctl.render(img)
      // bump the version only when the glass really changed
      let changed = !this.tele || on !== this.lastOn
      if (!changed) for (let i = 0; i < img.length; i++) if (img[i] !== this.image[i]) { changed = true; break }
      this.lastRev = ctl.rev
      this.lastOn = on
      this.lastPowered = powered
      if (changed || !this.tele) {
        this.image = img
        this.version++
        this.tele = {
          version: this.version,
          width: OLED_W,
          height: OLED_H,
          format: 'mono-pages',
          data: img,
          on,
          contrast: ctl.brightness(),
        }
      } else if (this.tele.contrast !== ctl.brightness()) {
        this.version++
        this.tele = { ...this.tele, version: this.version, contrast: ctl.brightness() }
      }
    }
    return this.tele
  }
}

// ====================================================================== modules

/**
 * I²C OLED module (SSD1306 0.96" / SH1106 1.3"): SA0 strapped by the
 * module's address resistor (0x3C or 0x3D), RES# held by the module's
 * power-on RC. After the address byte every transfer starts with a control
 * byte Co·D/C#·000000 (SSD1306 §8.1.5.2): Co = 0 → the rest of the transfer
 * is a stream (D/C# = 0: commands, 1: GDDRAM data); Co = 1 → one byte, then
 * another control byte. Read transfers (R/W# = 1) are not acknowledged.
 */
export class OledI2cDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  ctl!: OledController
  private bus!: I2cSlave
  private powered = false
  private readonly tele = new OledTelemetry()
  private expectControl = true
  private co = false
  private dc = false

  constructor(
    readonly kind: OledKind,
    readonly address: number,
  ) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.ctl = new OledController(this.kind, ctx)
    this.bus = new I2cSlave(ctx, {
      matches: (a, read) => a === this.address && !read,
      start: () => {
        this.expectControl = true
      },
      write: (b) => {
        if (this.expectControl) {
          this.co = (b & 0x80) !== 0
          this.dc = (b & 0x40) !== 0
          this.expectControl = false
          return true
        }
        if (this.dc) this.ctl.data(b)
        else this.ctl.command(b)
        if (this.co) this.expectControl = true
        return true
      },
      read: () => 0xff,
    })
    ctx.drive('SDA', 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.bus.reset()
    if (on) this.ctl.powerUp()
    else this.ctl.stopScroll()
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    this.bus.onPinChange(pin, level)
  }

  telemetry(): DeviceTelemetry {
    return {
      display: this.tele.snapshot(this.ctl, this.powered),
      values: { address: this.address, scrolling: this.ctl.scrolling ? 1 : 0, chargePump: this.ctl.pump ? 1 : 0 },
    }
  }
}

/**
 * 7-pin 4-wire SPI SSD1306 module (D0 = SCLK, D1 = SDIN, RES, DC, CS):
 * while CS# is low, SDIN is shifted in MSB first on SCLK rising edges
 * (mode 0 / mode 3) and D/C# is sampled with the 8th bit (§8.1.3). CS# high
 * resets the bit counter; RES# low resets the registers (not the GDDRAM)
 * and blocks the interface while held.
 */
export class OledSpiDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  ctl!: OledController
  private powered = false
  private readonly tele = new OledTelemetry()
  private bits = 0
  private shift = 0
  private sck: 0 | 1 = 0
  private inReset = false
  private watch!: InputWatch

  constructor(readonly kind: OledKind) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.ctl = new OledController(this.kind, ctx)
    this.watch = new InputWatch(ctx, 'SSD1306', 0.528)
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.bits = 0
    this.shift = 0
    if (on) {
      this.ctl.powerUp()
      this.sck = this.ctx.read('D0') === 1 ? 1 : 0
      this.inReset = this.ctx.read('RES') === 0
    } else this.ctl.stopScroll()
  }

  private warnFloating(pin: string): void {
    this.watch.undefinedLevel(pin)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    if (level === null) {
      if (pin === 'CS' || pin === 'RES' || pin === 'D0') this.warnFloating(pin)
      return
    }
    switch (pin) {
      case 'RES':
        if (level === 0) {
          this.inReset = true
          this.ctl.reset()
          this.bits = 0
        } else this.inReset = false
        return
      case 'CS':
        if (level === 1) {
          this.bits = 0
          this.shift = 0
        }
        return
      case 'D0': {
        const prev = this.sck
        this.sck = level
        if (level !== 1 || prev === 1 || this.inReset) return
        if (this.ctx.read('CS') !== 0) return
        this.shift = ((this.shift << 1) | (this.ctx.read('D1') === 1 ? 1 : 0)) & 0xff
        if (++this.bits < 8) return
        this.bits = 0
        const dc = this.ctx.read('DC')
        if (dc === null) this.warnFloating('DC')
        if (dc === 1) this.ctl.data(this.shift)
        else this.ctl.command(this.shift)
        return
      }
      default:
        return
    }
  }

  telemetry(): DeviceTelemetry {
    return {
      display: this.tele.snapshot(this.ctl, this.powered),
      values: { scrolling: this.ctl.scrolling ? 1 : 0, chargePump: this.ctl.pump ? 1 : 0 },
    }
  }
}
