/**
 * REAL firmware on REAL circuits through the SimulationCoordinator:
 * firmware/dist/hal-oled-*, hal-lcd1602*, hal-tft-st7735, hal-max7219,
 * hal-ws2812 and hal-tm1637 (ST HAL v1.1.9, clang) on a Blue Pill powered
 * from a 5 V bench supply, wired to the display modules with breadboard
 * holes and jumper wires exactly as a user would. Everything the display
 * shows travels over its pins bit by bit; the assertions read what the
 * firmware prints on USART1 and the module's display telemetry (framebuffer
 * pixels, DDRAM characters, LED colours). Wiring / configuration mistakes
 * produce the real symptoms.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import type { FirmwareImage } from '../../src/mcu/firmware'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, DisplayTelemetry, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { CATALOG } from '../../src/model/catalog'
import { validateLayout } from '../../src/model/validate'
import { runErc } from '../../src/sim/erc'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../firmware/dist')
const images = new Map<string, FirmwareImage>()
function image(name: string): FirmwareImage {
  let img = images.get(name)
  if (!img) {
    const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
    if (!res.ok) throw new Error(res.error)
    img = res.image
    images.set(name, img)
  }
  return img
}

const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
/** the free hole on the strip of a Blue Pill header pin (row a / j) */
function tap(pin: string): string {
  const entry = CATALOG[BP.type]
  const h = componentPinHoles(BP, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(pin)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

/** a free hole on the strip of a display pin (pins in row j → row f/g/h/i; row a → b/c/d/e) */
function pinHole(comp: ComponentInstance, pin: string, row = 'g'): string {
  const entry = CATALOG[comp.type]
  const h = componentPinHoles(comp, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(`${comp.id}.${pin}`)
  return formatHole({ ...h, row: row as never })
}

class World {
  private n = 0
  readonly wires: Wire[] = []
  readonly comps: ComponentInstance[] = [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP]
  constructor(volts = 5) {
    this.comps[0].params = { voltage: volts }
    // PS1 + → bottom + rail (the 5 V rail) → the board's 5V pin
    this.w('PS1:+', 'bot+0')
    this.w('bot+1', tap('5V'))
    this.w('PS1:-', 'top-0')
    this.w('top-2', 'bot-0')
    this.w(tap('GND3'), 'top-1')
    this.w(tap('3V3_1'), 'top+0')
  }
  w(from: string, to: string): this {
    this.wires.push({ id: `w${++this.n}`, from, to })
    return this
  }
  add(c: ComponentInstance): ComponentInstance {
    this.comps.push(c)
    return c
  }
  layout(): CircuitLayout {
    return { version: 1, name: 'display bench', components: this.comps, wires: this.wires }
  }
}

interface Run {
  co: SimulationCoordinator
  text: string
}

function run(layout: CircuitLayout, fw: string, until: (text: string) => boolean, limit = 2): Run {
  const v = validateLayout(layout)
  expect(v.errors, 'layout errors').toEqual([])
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', image(fw))
  let text = ''
  while (co.time < limit && !until(text)) {
    co.advance(0.01)
    for (const u of co.frame().uart) if (u.port === 'USART1') text += String.fromCharCode(...u.bytes)
  }
  return { co, text }
}

function tele(co: SimulationCoordinator, id: string): ComponentTelemetry {
  // twice: big frames refresh their snapshot when the simulation stands still
  co.frame()
  const t = co.frame().telemetry.components[id]
  if (!t) throw new Error(`no telemetry for ${id}`)
  return t
}

const pixel = (d: DisplayTelemetry, x: number, y: number): number => (d.data![(y >> 3) * d.width + x] >> (y & 7)) & 1
const litCount = (d: DisplayTelemetry): number => d.data!.reduce((n, b) => n + bitCount(b), 0)
function bitCount(b: number): number {
  let n = 0
  for (; b; b &= b - 1) n++
  return n
}

/** 5×7 font glyph columns of the firmware's font (bit 0 = top) for a few characters */
const GLYPH: Record<string, number[]> = {
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18],
}

// ====================================================================== OLED (I²C)

function oledI2cWorld(opts: { type?: 'ssd1306_i2c' | 'sh1106_i2c'; address?: string; vcc?: boolean } = {}) {
  const wd = new World()
  const type = opts.type ?? 'ssd1306_i2c'
  const oled = wd.add({ id: 'OLED1', type, at: 'j40', params: opts.address ? { address: opts.address } : undefined })
  wd.w(pinHole(oled, 'GND', 'f'), 'top-10')
  if (opts.vcc !== false) wd.w(pinHole(oled, 'VCC', 'f'), 'bot+3')
  wd.w(pinHole(oled, 'SCL'), tap('PB6'))
  wd.w(pinHole(oled, 'SDA'), tap('PB7'))
  return wd.layout()
}

describe('hal-oled-ssd1306.elf on a Blue Pill + SSD1306 I²C module', () => {
  it('draws border, text, frame counter and progress bar; the glass shows the GDDRAM image', { timeout: 180_000 }, () => {
    const { co, text } = run(oledI2cWorld(), 'hal-oled-ssd1306', (t) => t.includes('frame 10\r\n'), 3)
    expect(text).toBe('SSD1306 OLED demo\r\nSSD1306 at 0x3C ready\r\nframe 5\r\nframe 10\r\n')
    const t = tele(co, 'OLED1')
    const d = t.display!
    expect(d.on).toBe(true)
    expect(t.values!.chargePump).toBe(1)
    // border
    for (const [x, y] of [[0, 0], [127, 0], [0, 63], [127, 63], [64, 0], [0, 32]]) expect(pixel(d, x, y), `${x},${y}`).toBe(1)
    expect(pixel(d, 1, 1)).toBe(0)
    // "H" of "Hello" at (8, 6): first column = rows 6..12
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) expect(pixel(d, 8 + col, 6 + row), `H ${col},${row}`).toBe((GLYPH.H[col] >> row) & 1)
    }
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) expect(pixel(d, 14 + col, 6 + row)).toBe((GLYPH.e[col] >> row) & 1)
    }
    // progress bar outline and fill for frame N (N ≥ 10)
    expect(pixel(d, 8, 44)).toBe(1)
    expect(pixel(d, 99, 53)).toBe(1)
    expect(pixel(d, 10, 46)).toBe(1)
    expect(pixel(d, 98, 50)).toBe(0)
    // circle r = 9 at (113, 48)
    expect(pixel(d, 122, 48)).toBe(1)
    expect(pixel(d, 113, 48)).toBe(0)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
    // the I²C nets are logic-resolvable (exact-time resolution)
    expect(co.logicNets).not.toBeNull()
  })

  it('module jumper at 0x3D: the firmware probing 0x3C gets no ACK and the glass stays dark', { timeout: 120_000 }, () => {
    const { co, text } = run(oledI2cWorld({ address: '0x3D' }), 'hal-oled-ssd1306', (t) => /not found|ready/.test(t))
    expect(text).toBe('SSD1306 OLED demo\r\nSSD1306 not found at 0x3C (no ACK)\r\n')
    const d = tele(co, 'OLED1').display!
    expect(d.on).toBe(false)
    expect(litCount(d)).toBe(0)
  })

  it('VCC not wired: the module is unpowered, nothing acknowledges (pull-ups unpowered too → the bus reads busy or NACK)', { timeout: 120_000 }, () => {
    const { co, text } = run(oledI2cWorld({ vcc: false }), 'hal-oled-ssd1306', (t) => /not found|busy|ready/.test(t))
    expect(text).toMatch(/^SSD1306 OLED demo\r\n(SSD1306 not found at 0x3C \(no ACK\)|I2C bus busy: SDA\/SCL stuck low \(pull-ups\?\))\r\n$/)
    expect(tele(co, 'OLED1').display!.on).toBe(false)
  })

  it('the same SSD1306 firmware on an SH1106 1.3" module: horizontal addressing is not an SH1106 command — garbled image', { timeout: 180_000 }, () => {
    const { co, text } = run(oledI2cWorld({ type: 'sh1106_i2c' }), 'hal-oled-ssd1306', (t) => t.includes('frame 5\r\n'), 3)
    expect(text).toContain('SSD1306 at 0x3C ready\r\n')
    const d = tele(co, 'OLED1').display!
    expect(d.on).toBe(true)
    // the SSD1306 picture would have the full border; on the SH1106 the 1024 bytes all land in page 0
    const borderRight = [...Array(64).keys()].every((y) => pixel(d, 127, y) === 1)
    expect(borderRight).toBe(false)
  })
})

// ====================================================================== OLED (SPI)

describe('hal-oled-spi.elf on a Blue Pill + 7-pin SPI SSD1306 module', () => {
  it('SPI1 at 9 MHz with CS / DC / RES GPIOs draws the same picture', { timeout: 180_000 }, () => {
    const wd = new World()
    const oled = wd.add({ id: 'OLED2', type: 'ssd1306_spi', at: 'j40' })
    wd.w(pinHole(oled, 'GND', 'f'), 'top-10')
    wd.w(pinHole(oled, 'VCC', 'f'), 'bot+3')
    wd.w(pinHole(oled, 'D0'), tap('PA5'))
    wd.w(pinHole(oled, 'D1'), tap('PA7'))
    wd.w(pinHole(oled, 'RES'), tap('PB1'))
    wd.w(pinHole(oled, 'DC'), tap('PB0'))
    wd.w(pinHole(oled, 'CS'), tap('PA4'))
    const { co, text } = run(wd.layout(), 'hal-oled-spi', (t) => t.includes('frame 5\r\n'), 3)
    expect(text).toBe('SSD1306 SPI OLED demo\r\nSSD1306 SPI ready\r\nframe 5\r\n')
    const d = tele(co, 'OLED2').display!
    expect(d.on).toBe(true)
    for (const [x, y] of [[0, 0], [127, 63], [8, 44]]) expect(pixel(d, x, y)).toBe(1)
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) expect(pixel(d, 8 + col, 6 + row)).toBe((GLYPH.H[col] >> row) & 1)
    }
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })
})

// ====================================================================== LCD1602 (parallel)

function lcdWorld(opts: { type?: 'lcd1602' | 'lcd2004'; pot?: boolean; rw?: boolean } = {}) {
  const wd = new World()
  const lcd = wd.add({ id: 'LCD1', type: opts.type ?? 'lcd1602', at: 'j34' })
  wd.w(pinHole(lcd, 'VSS', 'f'), 'top-10')
  wd.w(pinHole(lcd, 'VDD', 'f'), 'bot+3')
  wd.w(pinHole(lcd, 'RS'), tap('PB10'))
  if (opts.rw !== false) wd.w(pinHole(lcd, 'RW'), tap('PB11'))
  wd.w(pinHole(lcd, 'E'), tap('PB1'))
  for (const [d, p] of [['D4', 'PB12'], ['D5', 'PB13'], ['D6', 'PB14'], ['D7', 'PB15']]) wd.w(pinHole(lcd, d), tap(p))
  wd.w(pinHole(lcd, 'A', 'f'), 'bot+4')
  wd.w(pinHole(lcd, 'K', 'f'), 'top-11')
  if (opts.pot !== false) {
    // 10 kΩ contrast trimmer: ccw = GND, cw = 3.3 V, wiper → V0 (≈ 0.5 V)
    wd.add({ id: 'RV1', type: 'potentiometer', holes: ['c52', 'c53', 'c54'], params: { resistance: 10000, position: 0.15 } })
    wd.w('a52', 'top-12')
    wd.w('a54', 'top+12')
    wd.w('e53', pinHole(lcd, 'V0'))
  }
  return wd.layout()
}

describe('hal-lcd1602.elf on a Blue Pill + LCD1602 (4-bit, busy flag)', () => {
  it('initializes by instruction, polls BF during the clear, shows text, CGRAM glyphs and the counter', { timeout: 180_000 }, () => {
    const { co, text } = run(lcdWorld(), 'hal-lcd1602', (t) => t.includes('count 8\r\n'), 3)
    const m = /^LCD1602 4-bit demo\r\nLCD ready, BF polls during clear: (\d+)\r\ncount 0\r\ncount 4\r\ncount 8\r\n$/.exec(text)
    expect(m, JSON.stringify(text)).not.toBeNull()
    // the 1.52 ms clear is busy for many polls (each read ≈ 2 µs + HAL_GetTick)
    expect(Number(m![1])).toBeGreaterThan(50)
    const t = tele(co, 'LCD1')
    const d = t.display!
    expect(d.on).toBe(true)
    expect(d.text![0]).toBe('Hello, ohmlet!  ')
    expect(d.text![1]).toMatch(/^\u0000 count:    (8|9) \u0001 $/)
    expect(Array.from(d.data!.slice(0, 16))).toEqual([0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00, 0x00, 0x00, 0x0a, 0x0a, 0x00, 0x11, 0x0e, 0x00, 0x00])
    expect(d.contrast).toBeGreaterThan(0.9)
    expect(t.values!.lines).toBe(2)
    expect(t.values!.cursor).toBe(0)
    // backlight: the module LED (A = 5 V through its 100 Ω) is lit
    expect(t.sub?.LED_BL?.ledBrightness ?? 0).toBeGreaterThan(0.5)
    // no write was ignored for being too early or while busy
    expect(co.issues().filter((i) => /HD44780/.test(i.message))).toEqual([])
  })

  it('LCD2004 with the same firmware: rows 0 and 1 hold the text, rows 2/3 the rest of the DDRAM lines', { timeout: 180_000 }, () => {
    const { co } = run(lcdWorld({ type: 'lcd2004' }), 'hal-lcd1602', (t) => t.includes('count 4\r\n'), 3)
    const d = tele(co, 'LCD1').display!
    expect(d.text!.map((r) => r.length)).toEqual([20, 20, 20, 20])
    expect(d.text![0]).toBe('Hello, ohmlet!      ')
    expect(d.text![1].slice(0, 7)).toBe('\u0000 count')
    expect(d.text![2]).toBe(' '.repeat(20))
  })

  it('contrast pot missing (V0 open): DDRAM is right but the characters are invisible', { timeout: 180_000 }, () => {
    const { co } = run(lcdWorld({ pot: false }), 'hal-lcd1602', (t) => t.includes('count 0\r\n'), 3)
    const d = tele(co, 'LCD1').display!
    expect(d.text![0]).toBe('Hello, ohmlet!  ')
    expect(d.contrast).toBe(0)
    // the open V0 floats up to VDD through the module's bias divider
    expect(tele(co, 'LCD1').values!.vlcd).toBeLessThan(0.1)
  })

  it('RW not wired: the LCD pulls RW high itself, every write becomes a read — blank screen with the row-1 boxes', { timeout: 180_000 }, () => {
    const { co, text } = run(lcdWorld({ rw: false }), 'hal-lcd1602', (t) => t.includes('count 0\r\n'), 3)
    expect(text).toMatch(/^LCD1602 4-bit demo\r\nLCD ready, BF polls during clear: 0\r\n/)
    const t = tele(co, 'LCD1')
    expect(t.display!.on).toBe(false)
    expect(t.display!.text![0]).toBe(' '.repeat(16))
    expect(t.values!.lines).toBe(1)
    expect(t.values!.ghostRow1).toBeGreaterThan(0.5)
  })
})

// ====================================================================== LCD1602 + PCF8574

function lcdI2cWorld(address?: string) {
  const wd = new World()
  const lcd = wd.add({ id: 'LCD2', type: 'lcd1602_i2c', at: 'j34', params: address ? { address } : undefined })
  wd.w(pinHole(lcd, 'GND', 'f'), 'top-10')
  wd.w(pinHole(lcd, 'VCC', 'f'), 'bot+3')
  wd.w(pinHole(lcd, 'SDA'), tap('PB7'))
  wd.w(pinHole(lcd, 'SCL'), tap('PB6'))
  return wd.layout()
}

describe('hal-lcd1602-i2c.elf on a Blue Pill + LCD1602 with PCF8574 backpack', () => {
  it('4-bit init through the expander, text and the uptime counter; backlight on', { timeout: 180_000 }, () => {
    const { co, text } = run(lcdI2cWorld(), 'hal-lcd1602-i2c', (t) => t.includes('uptime 2 s\r\n'), 3)
    expect(text).toBe('LCD1602 I2C demo\r\nLCD ready at 0x27\r\nuptime 1 s\r\nuptime 2 s\r\n')
    const t = tele(co, 'LCD2')
    expect(t.display!.on).toBe(true)
    expect(t.display!.backlight).toBe(1)
    expect(t.display!.text).toEqual(['Hello via I2C!  ', 'uptime         2'])
    expect(t.display!.contrast).toBeGreaterThan(0.9)
    expect(co.issues().filter((i) => i.level === 'error' || /HD44780/.test(i.message))).toEqual([])
  })

  it('a PCF8574A backpack (0x3F) does not answer the firmware at 0x27', { timeout: 120_000 }, () => {
    const { co, text } = run(lcdI2cWorld('0x3F'), 'hal-lcd1602-i2c', (t) => /not found|ready/.test(t))
    expect(text).toBe('LCD1602 I2C demo\r\nPCF8574 not found at 0x27 (no ACK)\r\n')
    // power-up state: 1-line mode boxes, backlight on (port FFh)
    const t = tele(co, 'LCD2')
    expect(t.display!.on).toBe(false)
    expect(t.values!.lines).toBe(1)
    expect(t.display!.backlight).toBe(1)
  })
})

// ====================================================================== ST7735 TFT

describe('hal-tft-st7735.elf on a Blue Pill + 1.8" ST7735S TFT', () => {
  it('black-tab init, eight colour bars, white and yellow text, backlight on', { timeout: 240_000 }, () => {
    const wd = new World()
    const tft = wd.add({ id: 'TFT1', type: 'st7735', at: 'j34' })
    wd.w(pinHole(tft, 'GND', 'f'), 'top-10')
    wd.w(pinHole(tft, 'VCC', 'f'), 'bot+3')
    wd.w(pinHole(tft, 'SCL'), tap('PA5'))
    wd.w(pinHole(tft, 'SDA'), tap('PA7'))
    wd.w(pinHole(tft, 'RES'), tap('PB1'))
    wd.w(pinHole(tft, 'DC'), tap('PB0'))
    wd.w(pinHole(tft, 'CS'), tap('PA4'))
    wd.w(pinHole(tft, 'BL'), tap('PB10'))
    const { co, text } = run(wd.layout(), 'hal-tft-st7735', (t) => t.includes('frame 2\r\n'), 3)
    expect(text).toBe('ST7735 TFT demo\r\nST7735 ready\r\ncolour bars drawn\r\nframe 2\r\n')
    const t = tele(co, 'TFT1')
    const d = t.display!
    expect(d.on).toBe(true)
    expect(d.backlight).toBeCloseTo(1, 2)
    const px = (x: number, y: number) => d.data![(y * d.width + x) * 2] | (d.data![(y * d.width + x) * 2 + 1] << 8)
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => px(i * 16 + 8, 50))).toEqual([0xffff, 0xffe0, 0x07ff, 0x07e0, 0xf81f, 0xf800, 0x001f, 0x0000])
    expect(px(0, 0)).toBe(0xffff)
    expect(px(127, 99)).toBe(0x0000)
    // 'S' of "ST7735" at (4, 108): column 0 lights rows 1, 2 and 6 of the glyph
    expect([0, 1, 2, 3, 6].map((r) => px(4, 108 + r))).toEqual([0x0000, 0xffff, 0xffff, 0x0000, 0xffff])
    // "frame N" in yellow at (4, 124): 'f' column 1 is lit on rows 1..6
    expect(px(5, 126)).toBe(0xffe0)
    expect(t.values!.colmod).toBe(0x05)
    expect(t.values!.madctl).toBe(0xc0)
  })
})

// ====================================================================== MAX7219

/** firmware text column i of "OHM " (5×7 font, 6 px per character) as a column byte (bit r = row r) */
function ohmColumn(i: number, rom: Uint8Array): number {
  const ch = 'OHM '.charCodeAt(Math.floor(i / 6) % 4)
  const col = i % 6
  if (col === 5) return 0
  let b = 0
  for (let r = 0; r < 7; r++) if ((rom[ch * 8 + r] >> (4 - col)) & 1) b |= 1 << r
  return b
}

function maxWorld(volts: number) {
  const wd = new World(volts)
  const mx = wd.add({ id: 'MX1', type: 'max7219_8x8', at: 'a40' })
  wd.w(pinHole(mx, 'VCC', 'e'), 'bot+3')
  wd.w(pinHole(mx, 'GND', 'e'), 'top-10')
  wd.w(pinHole(mx, 'DIN', 'e'), tap('PA7'))
  wd.w(pinHole(mx, 'CS', 'e'), tap('PA4'))
  wd.w(pinHole(mx, 'CLK', 'e'), tap('PA5'))
  return wd.layout()
}

describe('hal-max7219.elf on a Blue Pill + MAX7219 8×8 matrix', () => {
  it('module at 4.5 V (VIH 3.15 V): "OHM " scrolls one column per 100 ms', { timeout: 180_000 }, async () => {
    const { HD44780_ROM } = await import('../../src/three/meshes/ext/displays-font')
    const { co, text } = run(maxWorld(4.5), 'hal-max7219', (t) => t.includes('step 10\r\n'), 3)
    expect(text).toBe('MAX7219 scroll demo\r\nMAX7219 ready\r\nstep 0\r\nstep 10\r\n')
    const d = tele(co, 'MX1').display!
    expect(d.on).toBe(true)
    for (let c = 0; c < 8; c++) expect(d.data![c], `column ${c}`).toBe(ohmColumn((10 + c) % 24, HD44780_ROM))
    expect(d.contrast).toBeCloseTo(9 / 31, 3)
  })

  it('module at 5 V: 3.3 V CLK/DIN/CS never reach VIH = 3.5 V, nothing is latched, the matrix stays dark', { timeout: 120_000 }, () => {
    // run past the init and ten scroll steps: every frame was sent, none latched
    const { co, text } = run(maxWorld(5), 'hal-max7219', (t) => t.includes('step 10\r\n'), 2)
    expect(text).toBe('MAX7219 scroll demo\r\nMAX7219 ready\r\nstep 0\r\nstep 10\r\n')
    const t = tele(co, 'MX1')
    expect(t.display!.on).toBe(false)
    expect(t.values!.shutdown).toBe(1)
    expect(co.issues().some((i) => /MAX7219 input (CLK|CS|DIN) is at 3\.\d\d V, between V_IL and V_IH = 3\.50 V/.test(i.message))).toBe(true)
  })
})

// ====================================================================== WS2812B

const PALETTE = [0x400000, 0x401800, 0x404000, 0x004000, 0x004040, 0x000040, 0x200040, 0x303030]

function wsWorld(volts: number) {
  const wd = new World(volts)
  const strip = wd.add({ id: 'LED1', type: 'ws2812b_strip8', at: 'j34' })
  wd.w(pinHole(strip, '5V', 'f'), 'bot+3')
  wd.w(pinHole(strip, 'GND', 'f'), 'top-10')
  wd.w(pinHole(strip, 'DIN', 'f'), tap('PA7'))
  return wd.layout()
}

describe('hal-ws2812.elf on a Blue Pill + 8-LED WS2812B strip', () => {
  it('strip at 4.5 V: SPI-encoded bits (0.44 / 0.89 µs) latch the rotating palette', { timeout: 180_000 }, () => {
    const { co, text } = run(wsWorld(4.5), 'hal-ws2812', (t) => t.includes('frame 10\r\n'), 3)
    expect(text).toBe('WS2812 demo (SPI1 + DMA, 2.25 MHz)\r\nframe 0\r\nframe 10\r\n')
    const t = tele(co, 'LED1')
    expect(t.rgb).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => PALETTE[(i + 10) % 8]))
    expect(t.values!.frames).toBeGreaterThanOrEqual(11)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })

  it('strip at 5 V: 3.3 V data stays below VIH = 3.5 V and the LEDs stay dark', { timeout: 120_000 }, () => {
    const layout = wsWorld(5)
    const { co } = run(layout, 'hal-ws2812', (t) => t.includes('frame 10\r\n'), 2)
    expect(tele(co, 'LED1').rgb).toEqual(new Array(8).fill(0))
    // the electrical rule check names the cause: a 3.3 V output on a 0.7·VDD input
    const erc = runErc(layout).filter((f) => f.rule === 'logic-level' && f.componentIds.includes('LED1'))
    expect(erc.map((f) => f.level)).toEqual(['risk'])
    expect(erc[0].message).toMatch(/DIN/)
  })
})

// ====================================================================== TM1637

const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f]

function tmWorld(swapped = false) {
  const wd = new World()
  const tm = wd.add({ id: 'TM1', type: 'tm1637_4digit', at: 'j40' })
  wd.w(pinHole(tm, 'CLK'), tap(swapped ? 'PB7' : 'PB6'))
  wd.w(pinHole(tm, 'DIO'), tap(swapped ? 'PB6' : 'PB7'))
  wd.w(pinHole(tm, 'VCC', 'f'), 'bot+3')
  wd.w(pinHole(tm, 'GND', 'f'), 'top-10')
  return wd.layout()
}

describe('hal-tm1637.elf on a Blue Pill + TM1637 4-digit module', () => {
  it('ACKed frames: the counter digits, the 1 Hz colon and pulse width 11/16', { timeout: 180_000 }, () => {
    const { co, text } = run(tmWorld(), 'hal-tm1637', (t) => t.includes('count 20\r\n'), 3)
    expect(text).toBe('TM1637 counter demo\r\nTM1637 ready\r\ncount 10\r\ncount 20\r\n')
    const v = tele(co, 'TM1').values!
    expect([v.seg0, v.seg1, v.seg2, v.seg3]).toEqual([SEG7[0], SEG7[0] | 0x80, SEG7[2], SEG7[0]])
    expect(v.on).toBe(1)
    expect(v.brightness).toBeCloseTo(11 / 14, 5)
  })

  it('CLK and DIO swapped: the module never acknowledges', { timeout: 120_000 }, () => {
    const { text } = run(tmWorld(true), 'hal-tm1637', (t) => /no ACK|ready/.test(t))
    expect(text).toBe('TM1637 counter demo\r\nTM1637: no ACK (check CLK/DIO wiring and power)\r\n')
  })
})
