/**
 * Display-module family (src/model/parts/displays.parts.ts): logic-level
 * models run by the Simulation Coordinator through the 'digital-device'
 * chip adapter. Each part's behaviour lives in a helper module:
 *
 *  displays-i2c.ts      bit-level I²C target shared by the I²C modules
 *  displays-ssd1306.ts  SSD1306 / SH1106 OLED controllers (I²C + 4-wire SPI)
 *  displays-hd44780.ts  HD44780 character LCD (parallel) + PCF8574 backpack
 *  displays-tft.ts      ST7735S / ILI9341 SPI TFT controllers
 *  displays-leds.ts     MAX7219 matrix, WS2812B strip, TM1637 4-digit
 *
 * Every model is driven by pin edges and scheduled virtual-time events only
 * (no canned frames); unmodeled features are logged and listed in the
 * catalog `support.limits`.
 */
import { registerDigitalDevice } from '../digital/api'
import type { CatalogEntry } from '../../model/catalog'
import { paramOf } from '../../model/catalog'
import type { ComponentInstance } from '../../model/types'
import { OledI2cDevice, OledSpiDevice } from './displays-ssd1306'
import { Hd44780ParallelDevice, Lcd1602I2cDevice } from './displays-hd44780'
import { ILI9341_PANEL, ST7735_PANEL, TftDevice } from './displays-tft'
import { Max7219Device, Tm1637Device, Ws2812StripDevice } from './displays-leds'

export { OledController, OledI2cDevice, OledSpiDevice, OLED_W, OLED_H } from './displays-ssd1306'
export { Hd44780, Hd44780ParallelDevice, Lcd1602I2cDevice, HD_T_CLEAR, HD_T_CMD, HD_T_POWERUP, HD_BLINK } from './displays-hd44780'
export { TftController, TftDevice, ST7735_PANEL, ILI9341_PANEL, TFT_T_RESET } from './displays-tft'
export { Max7219Device, Tm1637Device, Ws2812StripDevice, WS_T_RES, WS_T_SAMPLE } from './displays-leds'
export { I2cSlave } from './displays-i2c'

/** "0x3C" / "0x27" / 60 → 7-bit address (fallback when unparsable) */
function addressParam(comp: ComponentInstance, entry: CatalogEntry, fallback: number): number {
  const v = paramOf(comp.params, entry, 'address')
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 16) : NaN
  return Number.isFinite(n) && n > 0 && n < 0x80 ? n : fallback
}

function numParam(comp: ComponentInstance, entry: CatalogEntry, key: string, fallback: number): number {
  const v = paramOf(comp.params, entry, key)
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

registerDigitalDevice('ssd1306_i2c', (c, e) => new OledI2cDevice('ssd1306', addressParam(c, e, 0x3c)))
registerDigitalDevice('sh1106_i2c', (c, e) => new OledI2cDevice('sh1106', addressParam(c, e, 0x3c)))
registerDigitalDevice('ssd1306_spi', () => new OledSpiDevice('ssd1306'))
registerDigitalDevice('hd44780_1602', () => new Hd44780ParallelDevice({ cols: 16, rows: 2 }))
registerDigitalDevice('hd44780_2004', () => new Hd44780ParallelDevice({ cols: 20, rows: 4 }))
registerDigitalDevice(
  'lcd1602_pcf8574',
  (c, e) => new Lcd1602I2cDevice({ cols: 16, rows: 2 }, addressParam(c, e, 0x27), numParam(c, e, 'contrast', 0.85)),
)
registerDigitalDevice('st7735', () => new TftDevice(ST7735_PANEL))
registerDigitalDevice('ili9341', () => new TftDevice(ILI9341_PANEL))
registerDigitalDevice('max7219', () => new Max7219Device())
registerDigitalDevice('ws2812b_strip', () => new Ws2812StripDevice(8))
registerDigitalDevice('tm1637', () => new Tm1637Device())
