/**
 * SPI TFT controllers on the common red-PCB modules:
 *  • ST7735S (Sitronix ST7735S V1.1) — 1.8" 128×160 ("black tab": GM = 00,
 *    so the frame memory is exactly 128×160);
 *  • ILI9341 (ILITEK ILI9341 V1.11) — 2.4" 240×320.
 *
 * 4-line serial interface (ST7735S §9.4 / ILI9341 §7.6.1 "4-line SPI"):
 * while CSX is low, SDA/SDI is sampled on SCL rising edges, MSB first, and
 * D/CX is sampled with the 8th bit (0 = command, 1 = parameter / pixel
 * data). CSX high resets the bit counter. RESX low = hardware reset.
 *
 * Commands modeled: NOP, SWRESET (01h), SLPIN/SLPOUT (10h/11h), PTLON
 * (12h, accepted), NORON (13h), INVOFF/INVON (20h/21h), DISPOFF/DISPON
 * (28h/29h), CASET (2Ah), RASET/PASET (2Bh), RAMWR (2Ch), VSCRDEF /
 * SCRLAR (33h), MADCTL (36h: MY MX MV RGB/BGR), VSCRSADD / VSCSAD (37h),
 * IDMOFF/IDMON (38h/39h), COLMOD (3Ah: 12 / 16 / 18 bit). Power, gamma,
 * frame-rate and interface registers (B1h–C7h, E0h/E1h, CBh/CFh/E8h/EAh/
 * EDh/F2h/F7h …) are accepted with their parameters and have no effect on
 * the image. ILI9341 reads on SDO (MISO): RDDPM 0Ah, RDDMADCTL 0Bh,
 * RDDCOLMOD 0Ch and RDID4 D3h (dummy byte first, data shifted out on SCL
 * falling edges).
 *
 * Address mapping (MADCTL, "Memory Data Access Control" figures): the
 * window counters (column XS…XE fastest, then row YS…YE, wrapping) give
 * (c, r); MV exchanges them, then MX / MY mirror against the frame-memory
 * width / height. The glass is mounted so the usual library rotation-0
 * values show an upright portrait image with the header at the top:
 * ST7735 black tab MADCTL C0h (MX MY, RGB panel), ILI9341 48h (MX, BGR
 * panel) — any other MADCTL gives the real mirrored / rotated / red-blue
 * swapped picture. Power-up and SWRESET: sleep in, display off, COLMOD
 * 18-bit (so 16-bit pixel data without a COLMOD command is misread), MADCTL
 * 00h, window = whole memory; commands within 5 ms of a reset are ignored.
 * A display that is off / asleep shows the backlight through the normally-
 * white TN glass (white).
 */
import type { DisplayTelemetry } from '../../model/types'
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import { InputWatch, powerUpNoise } from './displays-i2c'

export interface TftPanel {
  kind: 'st7735' | 'ili9341'
  width: number
  height: number
  /** the glass shows frame-memory column W−1−x at screen x */
  mirrorX: boolean
  /** the glass shows frame-memory row H−1−y at screen y */
  mirrorY: boolean
  /** colour filter order of the glass is B-G-R */
  bgrPanel: boolean
  /** reset value of COLMOD */
  colmodReset: number
  /** pin names on the module header */
  pins: { sck: string; sda: string; dc: string; cs: string; res: string; bl: string; sdo?: string }
}

export const ST7735_PANEL: TftPanel = {
  kind: 'st7735',
  width: 128,
  height: 160,
  mirrorX: true,
  mirrorY: true,
  bgrPanel: false,
  colmodReset: 0x06,
  pins: { sck: 'SCL', sda: 'SDA', dc: 'DC', cs: 'CS', res: 'RES', bl: 'BL' },
}

export const ILI9341_PANEL: TftPanel = {
  kind: 'ili9341',
  width: 240,
  height: 320,
  mirrorX: true,
  mirrorY: false,
  bgrPanel: true,
  colmodReset: 0x66,
  pins: { sck: 'SCK', sda: 'SDI', dc: 'DC', cs: 'CS', res: 'RESET', bl: 'LED', sdo: 'SDO' },
}

/** commands are ignored for this long after a reset (ILI9341 / ST7735S: 5 ms) */
export const TFT_T_RESET = 5e-3
/** telemetry snapshots of the (large) frame are refreshed at most every 33 ms of virtual time */
const SNAPSHOT_INTERVAL = 1 / 30

export class TftController {
  readonly ram: Uint16Array
  sleep = true
  dispOn = false
  invert = false
  idle = false
  madctl = 0
  colmod: number
  xs = 0
  xe: number
  ys = 0
  ye: number
  private cx = 0
  private cy = 0
  private cmd = -1
  private argi = 0
  private args: number[] = []
  private pix: number[] = []
  private scroll: { tfa: number; vsa: number; bfa: number } | null = null
  vsp = 0
  scrolling = false
  resetUntil = 0
  /** bumped on every change of the image */
  rev = 0
  pixelsWritten = 0
  private warned = new Set<string>()
  /** pending SDO read: bytes to shift out */
  readBytes: number[] | null = null

  constructor(
    readonly panel: TftPanel,
    private readonly ctx: DigitalDeviceCtx,
  ) {
    this.ram = new Uint16Array(panel.width * panel.height)
    this.colmod = panel.colmodReset
    this.xe = panel.width - 1
    this.ye = panel.height - 1
  }

  private log(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.log(message)
  }

  powerUp(): void {
    const noise = new Uint8Array(this.ram.length * 2)
    powerUpNoise(this.ctx.componentId + ':gram', noise)
    for (let i = 0; i < this.ram.length; i++) this.ram[i] = noise[2 * i] | (noise[2 * i + 1] << 8)
    this.reset()
  }

  /** hardware reset / SWRESET: registers to their reset values (frame memory kept) */
  reset(): void {
    this.sleep = true
    this.dispOn = false
    this.invert = false
    this.idle = false
    this.madctl = 0
    this.colmod = this.panel.colmodReset
    this.xs = 0
    this.ys = 0
    this.xe = this.panel.width - 1
    this.ye = this.panel.height - 1
    this.cmd = -1
    this.pix = []
    this.scroll = null
    this.scrolling = false
    this.vsp = 0
    this.readBytes = null
    this.resetUntil = this.ctx.now() + TFT_T_RESET
    this.rev++
  }

  /** One received byte with its D/CX level. */
  byte(dc: 0 | 1, b: number): void {
    if (this.ctx.now() < this.resetUntil) {
      this.log('early', `${this.name()} ignored SPI bytes sent within 5 ms of a reset (wait ≥ 5 ms after RESX / SWRESET, 120 ms before SLPOUT)`)
      return
    }
    if (dc === 0) this.command(b)
    else this.param(b)
  }

  name(): string {
    return this.panel.kind === 'st7735' ? 'ST7735' : 'ILI9341'
  }

  private command(b: number): void {
    this.cmd = b
    this.argi = 0
    this.args = []
    this.pix = []
    this.readBytes = null
    switch (b) {
      case 0x00:
        return
      case 0x01:
        this.reset()
        return
      case 0x10:
        this.sleep = true
        this.rev++
        return
      case 0x11:
        this.sleep = false
        this.rev++
        return
      case 0x12:
        this.log('ptl', `${this.name()} partial mode (12h) is accepted but not modeled (the whole panel stays active)`)
        return
      case 0x13:
        this.scrolling = false
        this.rev++
        return
      case 0x20:
      case 0x21:
        this.invert = b === 0x21
        this.rev++
        return
      case 0x28:
      case 0x29:
        this.dispOn = b === 0x29
        this.rev++
        return
      case 0x2c:
        this.cx = this.xs
        this.cy = this.ys
        return
      case 0x38:
      case 0x39:
        this.idle = b === 0x39
        this.rev++
        return
      case 0x0a:
        this.startRead([(this.sleep ? 0 : 0x10) | (this.dispOn ? 0x04 : 0) | 0x80 | (this.idle ? 0x40 : 0) | 0x08])
        return
      case 0x0b:
        this.startRead([this.madctl])
        return
      case 0x0c:
        this.startRead([this.colmod])
        return
      case 0xd3:
        if (this.panel.kind === 'ili9341') this.startRead([0x00, 0x93, 0x41])
        return
      default:
        return
    }
  }

  /** read commands: a dummy byte, then the data, shifted out on SDO */
  private startRead(data: number[]): void {
    if (!this.panel.pins.sdo) return
    this.readBytes = [0x00, ...data]
  }

  private param(b: number): void {
    const i = this.argi++
    switch (this.cmd) {
      case 0x2a:
      case 0x2b: {
        this.args.push(b)
        if (this.args.length === 4) {
          const s = (this.args[0] << 8) | this.args[1]
          const e = (this.args[2] << 8) | this.args[3]
          if (this.cmd === 0x2a) {
            this.xs = s
            this.xe = e
          } else {
            this.ys = s
            this.ye = e
          }
          if (s > e) this.log('win', `${this.name()} ${this.cmd === 0x2a ? 'CASET' : 'RASET'}: start ${s} > end ${e} (undefined window on the real controller)`)
        }
        return
      }
      case 0x2c:
        this.pixelByte(b)
        return
      case 0x33:
        this.args.push(b)
        if (this.args.length === 6) {
          this.scroll = {
            tfa: (this.args[0] << 8) | this.args[1],
            vsa: (this.args[2] << 8) | this.args[3],
            bfa: (this.args[4] << 8) | this.args[5],
          }
        }
        return
      case 0x36:
        if (i === 0) {
          this.madctl = b
          this.rev++
        }
        return
      case 0x37:
        this.args.push(b)
        if (this.args.length === 2) {
          this.vsp = (this.args[0] << 8) | this.args[1]
          this.scrolling = true
          this.rev++
        }
        return
      case 0x3a:
        if (i === 0) {
          this.colmod = b
          this.rev++
        }
        return
      default:
        return // power / gamma / timing registers: accepted, no effect on the image
    }
  }

  /** bits per pixel of the MCU interface (COLMOD low bits) */
  private bpp(): 12 | 16 | 18 {
    const f = this.colmod & 0x07
    if (f === 0x03) return 12
    if (f === 0x05) return 16
    if (f !== 0x06) this.log(`colmod:${f}`, `${this.name()} COLMOD 0x${this.colmod.toString(16).padStart(2, '0')}: interface format ${f} is not 12/16/18-bit — treated as 18-bit`)
    return 18
  }

  private pixelByte(b: number): void {
    const bpp = this.bpp()
    this.pix.push(b)
    if (bpp === 16) {
      if (this.pix.length < 2) return
      this.writePixel((this.pix[0] << 8) | this.pix[1])
      this.pix = []
      return
    }
    if (bpp === 18) {
      if (this.pix.length < 3) return
      const [r, g, bl] = this.pix
      this.writePixel(((r >> 3) << 11) | ((g >> 2) << 5) | (bl >> 3))
      this.pix = []
      return
    }
    // 12-bit: 3 bytes carry two pixels R1G1 B1R2 G2B2
    if (this.pix.length < 3) return
    const [a, c, d] = this.pix
    const px = (r4: number, g4: number, b4: number) => ((r4 << 1 | r4 >> 3) << 11) | ((g4 << 2 | g4 >> 2) << 5) | (b4 << 1 | b4 >> 3)
    this.writePixel(px(a >> 4, a & 15, c >> 4))
    this.writePixel(px(c & 15, d >> 4, d & 15))
    this.pix = []
  }

  private writePixel(v: number): void {
    const { width: W, height: H } = this.panel
    let x = this.cx
    let y = this.cy
    if (this.madctl & 0x20) {
      const t = x
      x = y
      y = t
    }
    if (this.madctl & 0x40) x = W - 1 - x
    if (this.madctl & 0x80) y = H - 1 - y
    if (x >= 0 && x < W && y >= 0 && y < H) {
      this.ram[y * W + x] = v
      this.rev++
    }
    this.pixelsWritten++
    // window counters: column fastest, then row; both wrap
    if (this.cx >= this.xe) {
      this.cx = this.xs
      this.cy = this.cy >= this.ye ? this.ys : this.cy + 1
    } else this.cx++
  }

  /** the panel shows an image (not off / asleep) */
  lit(): boolean {
    return !this.sleep && this.dispOn
  }

  /** Render the glass image (portrait, RGB565, row-major) into `out`. */
  render(out: Uint16Array): void {
    const { width: W, height: H, mirrorX, mirrorY } = this.panel
    const swapRB = ((this.madctl & 0x08) !== 0) !== this.panel.bgrPanel
    const inv = this.invert
    const idle = this.idle
    const sc = this.scrolling ? this.scroll : null
    for (let sy = 0; sy < H; sy++) {
      let y = mirrorY ? H - 1 - sy : sy
      if (sc && sc.vsa > 0 && y >= sc.tfa && y < sc.tfa + sc.vsa) {
        y = sc.tfa + ((((y - sc.tfa + this.vsp - sc.tfa) % sc.vsa) + sc.vsa) % sc.vsa)
      }
      const row = y * W
      const o = sy * W
      for (let sx = 0; sx < W; sx++) {
        let v = this.ram[row + (mirrorX ? W - 1 - sx : sx)]
        if (swapRB) v = ((v & 0x1f) << 11) | (v & 0x07e0) | (v >> 11)
        if (inv) v ^= 0xffff
        if (idle) v = (v & 0x8000 ? 0xf800 : 0) | (v & 0x0400 ? 0x07e0 : 0) | (v & 0x0010 ? 0x001f : 0)
        out[o + sx] = v
      }
    }
  }
}

/**
 * TFT module device: SPI receiver, optional SDO read-out, RESX, and the
 * backlight input (a transistor switch on the module: brightness = the
 * duty cycle of the BL/LED pin, averaged like the eye does).
 */
export class TftDevice implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  tft!: TftController
  private powered = false
  private bits = 0
  private shift = 0
  private sck: 0 | 1 = 0
  private inReset = false
  private readBit = 0
  private watch!: InputWatch
  // backlight duty
  private blLevel: 0 | 1 = 0
  private blSince = 0
  private blHigh = 0
  private blWin = 0
  private blDuty = 0
  // snapshot
  private snapRev = -1
  private snapAt = -Infinity
  private lastCall = -1
  private version = 0
  private tele: DisplayTelemetry | null = null
  private lastOn = false

  constructor(readonly panel: TftPanel) {}

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    this.tft = new TftController(this.panel, ctx)
    this.watch = new InputWatch(ctx, this.tft.name(), 0.462)
    if (this.panel.pins.sdo) ctx.drive(this.panel.pins.sdo, 'z')
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.bits = 0
    this.shift = 0
    if (this.panel.pins.sdo) this.ctx.drive(this.panel.pins.sdo, 'z')
    const p = this.panel.pins
    if (on) {
      this.tft.powerUp()
      this.sck = this.ctx.read(p.sck) === 1 ? 1 : 0
      this.inReset = this.ctx.read(p.res) === 0
      this.blLevel = this.ctx.read(p.bl) === 1 ? 1 : 0
      this.blSince = this.ctx.now()
      this.blWin = this.ctx.now()
      this.blHigh = 0
      this.blDuty = this.blLevel
    }
  }

  private warnFloating(pin: string): void {
    this.watch.undefinedLevel(pin)
  }

  onPinChange(pin: string, level: LogicLevel): void {
    if (!this.powered) return
    const p = this.panel.pins
    if (pin === p.bl) {
      const l: 0 | 1 = level === 1 ? 1 : 0
      if (l !== this.blLevel) {
        const now = this.ctx.now()
        if (this.blLevel === 1) this.blHigh += now - this.blSince
        this.blSince = now
        this.blLevel = l
      }
      return
    }
    if (level === null) {
      if (pin === p.cs || pin === p.res || pin === p.sck) this.warnFloating(pin)
      return
    }
    if (pin === p.res) {
      if (level === 0) {
        this.inReset = true
        this.tft.reset()
        this.bits = 0
      } else this.inReset = false
      return
    }
    if (pin === p.cs) {
      if (level === 1) {
        this.bits = 0
        this.shift = 0
        this.tft.readBytes = null
        if (p.sdo) this.ctx.drive(p.sdo, 'z')
      }
      return
    }
    if (pin !== p.sck) return
    const prev = this.sck
    this.sck = level
    if (prev === level || this.inReset || this.ctx.read(p.cs) !== 0) return
    if (level === 0) {
      // falling edge: shift the next read-out bit onto SDO
      const rb = this.tft.readBytes
      if (rb && p.sdo) {
        if (rb.length === 0) {
          this.tft.readBytes = null
          this.ctx.drive(p.sdo, 'z')
          return
        }
        const bit = (rb[0] >> (7 - this.readBit)) & 1
        this.ctx.drive(p.sdo, bit ? 'high' : 'low')
        if (++this.readBit === 8) {
          this.readBit = 0
          rb.shift()
        }
      }
      return
    }
    this.shift = ((this.shift << 1) | (this.ctx.read(p.sda) === 1 ? 1 : 0)) & 0xff
    if (++this.bits < 8) return
    this.bits = 0
    const dc = this.ctx.read(p.dc)
    if (dc === null) this.warnFloating(p.dc)
    const reading = this.tft.readBytes !== null
    if (reading && dc === 1) return // dummy clocks of a read
    this.tft.byte(dc === 1 ? 1 : 0, this.shift)
    if (this.tft.readBytes) this.readBit = 0
  }

  /** Backlight duty over the window since the previous call (eye-averaged). */
  private backlight(): number {
    const now = this.ctx.now()
    const win = now - this.blWin
    if (win >= 2e-3) {
      let high = this.blHigh
      if (this.blLevel === 1) high += now - this.blSince
      this.blDuty = Math.min(1, Math.max(0, high / win))
      this.blHigh = 0
      this.blSince = now
      this.blWin = now
    } else if (win <= 0) this.blDuty = this.blLevel
    return this.powered ? this.blDuty : 0
  }

  telemetry(): DeviceTelemetry {
    const now = this.ctx.now()
    const on = this.powered && this.tft.lit()
    // big frames: refresh at most every 33 ms of virtual time, but always when the simulation stands still
    const stale = this.tft.rev !== this.snapRev || on !== this.lastOn
    if (!this.tele || (stale && (now - this.snapAt >= SNAPSHOT_INTERVAL || now === this.lastCall))) {
      const { width: W, height: H } = this.panel
      const img = new Uint16Array(W * H)
      this.tft.render(img)
      this.snapRev = this.tft.rev
      this.snapAt = now
      this.lastOn = on
      this.version++
      this.tele = {
        version: this.version,
        width: W,
        height: H,
        format: 'rgb565',
        data: new Uint8Array(img.buffer),
        on,
      }
    }
    this.lastCall = now
    const bl = this.backlight()
    if (this.tele.backlight === undefined || Math.abs(this.tele.backlight - bl) > 0.004) {
      this.version++
      this.tele = { ...this.tele, version: this.version, backlight: bl }
    }
    return {
      display: this.tele,
      values: {
        madctl: this.tft.madctl,
        colmod: this.tft.colmod,
        sleep: this.tft.sleep ? 1 : 0,
        pixels: this.tft.pixelsWritten,
      },
    }
  }
}
