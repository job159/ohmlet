import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'ws2812-strip',
  order: 50,
  category: 'display',
  difficulty: 'advanced',
  title: 'WS2812B 全彩 LED 燈條（SPI + DMA）',
  summary: '8 顆可定址 RGB LED：以 SPI1 MOSI 編碼單線時序，DMA 一次送出整條燈條，八色調色盤每 100 ms 輪轉',
  description: [
    'WS2812B 只有一條資料線，每顆 LED 需要 24 位元（G-R-B，MSB 先送），用脈波寬度表示 0 與 1：0 = 0.4 µs 高 + 0.85 µs 低，1 = 0.8 µs 高 + 0.45 µs 低，低電位超過 280 µs 就鎖存。在 72 MHz 的 STM32 上用 GPIO 硬湊這種時序很不可靠，常見的穩定做法是借用 SPI：SPI1 以 2.25 MHz 輸出（每位元 0.44 µs），3 個 SPI 位元代表 1 個 WS 位元（100 = 0、110 = 1），再由 DMA1 通道 3 把整個緩衝區送出，CPU 完全不用管時序。',
    '電源 4.5 V 的原因：WS2812B 的 DIN 需要 0.7 × VDD 以上才算高電位，5 V 供電時是 3.5 V，3.3 V 的 PA7 不夠，燈條會完全不亮。把電路電源調到 4.5 V（門檻 3.15 V）就能直接驅動；正式作品則常用 74AHCT125 之類的電位轉換晶片。',
    '試試看：把 PS1 改成 5 V 看燈條熄滅，ERC 也會標示 DIN 的邏輯準位風險；在邏輯分析儀上量 PA7 的高電位寬度，分辨 0 與 1 的編碼。',
  ].join('\n\n'),
  tags: ['WS2812B', 'NeoPixel', 'SPI', 'DMA', 'RGB', '邏輯準位'],
  glyph: 'ws2812b_strip8',
  firmware: 'hal-ws2812',
  simulation: 'full',
  build() {
    const b = bluePillBench({ supply: 4.5 })
    // strip at j34: 5V j34 GND j35 DIN j36 (DOUT j57); the strip covers rows i–j to its right
    b.add({ id: 'LED1', type: 'ws2812b_strip8', at: 'j34' })
    b.toRail('f34', 'bot+', 'red')
    b.toRail('f35', 'bot-')
    b.wire('g36', tap('PA7'), 'green') // DIN ← SPI1 MOSI
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA7', 'PA7 DIN')] },
  tray: 'uart',
  expect: { seconds: 1.2, uart: { USART1: 'WS2812 demo (SPI1 + DMA, 2.25 MHz)\r\nframe 0\r\nframe 10\r\n' } },
}
