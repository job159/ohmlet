import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'tft-st7735',
  order: 30,
  category: 'display',
  difficulty: 'advanced',
  title: 'ST7735 彩色 TFT（SPI）',
  summary: '1.8 吋 128×160 TFT：重置、初始化、八條彩色色帶與文字，SPI1 以 9 MHz 傳送 RGB565 像素',
  description: [
    'ST7735S 是常見的小尺寸彩色 TFT 控制器。韌體用 SPI1（PA5 = SCL/SCK、PA7 = SDA/MOSI，模式 0，9 MHz）傳送指令與資料，另外三支 GPIO：CS（PA4）選取晶片、DC（PB0）區分指令（低）與資料（高）、RES（PB1）硬體重置；PB10 打開背光。初始化：重置脈波 → `SWRESET` → `SLPOUT` → `COLMOD` 05h（16 位元色彩）→ `MADCTL` → `DISPON`，之後以 `CASET` / `RASET` 設定視窗、`RAMWR` 寫入大端序的 RGB565 像素，畫出八條色帶與白色、黃色文字，每 500 ms 更新一次畫格計數。',
    '接線：GND、VCC 接 5 V 電源軌（模組上有穩壓器），其餘六條訊號線依上面的腳位連接。SPI 只用到 MOSI —— 這個模組沒有 MISO，所以韌體不會讀回任何資料。',
    '試試看：在邏輯分析儀上用 SPI 解碼器看 DC 腳位切換時指令與資料的分界；把 DC 線拔掉，螢幕會把資料當成指令而一片混亂；拔掉 BL，背光熄滅。',
  ].join('\n\n'),
  tags: ['TFT', 'ST7735', 'SPI', 'RGB565', '背光'],
  glyph: 'st7735',
  firmware: 'hal-tft-st7735',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // ST7735 at j34: GND j34 VCC j35 SCL j36 SDA j37 RES j38 DC j39 CS j40 BL j41 (lies over the front edge)
    b.add({ id: 'TFT1', type: 'st7735', at: 'j34' })
    b.toRail('f34', 'bot-')
    b.toRail('f35', 'bot+')
    b.wire('g36', tap('PA5'), 'yellow') // SCL = SCK
    b.wire('g37', tap('PA7'), 'blue') // SDA = MOSI
    b.wire('g38', tap('PB1'), 'white') // RES
    b.wire('g39', tap('PB0'), 'green') // DC
    b.wire('g40', tap('PA4'), 'orange') // CS
    b.wire('g41', tap('PB10'), 'purple') // BL
    return b
  },
  logic: {
    channels: [
      mcuChannel(0, 'PA5', 'PA5 SCK'),
      mcuChannel(1, 'PA7', 'PA7 MOSI'),
      mcuChannel(2, 'PA4', 'PA4 CS'),
      mcuChannel(3, 'PB0', 'PB0 DC'),
    ],
    decoders: [{ id: 'spi1', decoder: 'spi', channels: { sck: 0, mosi: 1, cs: 2 }, options: {} }],
  },
  tray: 'uart',
  expect: { seconds: 1.5, uart: { USART1: 'ST7735 TFT demo\r\nST7735 ready\r\ncolour bars drawn\r\n' } },
}
