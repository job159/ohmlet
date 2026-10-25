import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'oled-ssd1306',
  order: 10,
  category: 'display',
  difficulty: 'intermediate',
  title: 'SSD1306 OLED 顯示器（I²C）',
  summary: '0.96 吋 128×64 OLED：初始化（含充電幫浦）、文字、畫框、進度條與圓形，每 200 ms 重畫一次',
  description: [
    'SSD1306 是最常見的小型 OLED 控制器。韌體以 I2C1（PB6 = SCL、PB7 = SDA，400 kHz 快速模式）送出和常見函式庫相同的初始化序列 —— 其中 8Dh 14h 開啟內部充電幫浦，少了它螢幕會一直是黑的 —— 接著在 RAM 中的 1 KB 畫面緩衝區畫出文字、外框、圓形和進度條，再以水平定址模式一次寫入顯示記憶體（`GDDRAM`）。USART1 每 5 個畫格印出 `frame N`。',
    '接線：模組的 GND、VCC 接 5 V 電源軌（模組上有 3.3 V 穩壓器），SCL → PB6、SDA → PB7。模組本身已有 4.7 kΩ 上拉電阻，所以不需要另外加。位址 0x3C（模組背面的跳線可改成 0x3D）。',
    '試試看：在邏輯分析儀上觀察 400 kHz 的 I²C 傳輸，解碼器會標出位址 0x3C 與每個資料位元組；在屬性面板把「I²C 位址（模組跳線）」改成 0x3D，韌體就找不到螢幕；把「OLED 顏色」改成黃藍雙色，看看雙色模組的效果。',
  ].join('\n\n'),
  tags: ['OLED', 'SSD1306', 'I²C', '畫面緩衝區', '400 kHz'],
  glyph: 'ssd1306_i2c',
  firmware: 'hal-oled-ssd1306',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // SSD1306 module at j40: GND j40 VCC j41 SCL j42 SDA j43 (lies over the front edge)
    b.add({ id: 'OLED1', type: 'ssd1306_i2c', at: 'j40' })
    b.toRail('f40', 'bot-')
    b.toRail('f41', 'bot+')
    b.wire('g42', tap('PB6'), 'yellow') // SCL
    b.wire('g43', tap('PB7'), 'blue') // SDA
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB6', 'PB6 SCL'), mcuChannel(1, 'PB7', 'PB7 SDA')],
    decoders: [{ id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }],
  },
  tray: 'uart',
  expect: { seconds: 1.3, uart: { USART1: 'SSD1306 OLED demo\r\nSSD1306 at 0x3C ready\r\nframe 5\r\n' } },
}
