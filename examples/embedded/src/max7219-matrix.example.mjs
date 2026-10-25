import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'max7219-matrix',
  order: 40,
  category: 'display',
  difficulty: 'intermediate',
  title: 'MAX7219 8×8 LED 點陣跑馬字',
  summary: 'SPI1 以 16 位元訊框驅動 MAX7219：文字每 100 ms 向左捲動一行',
  description: [
    'MAX7219 一顆晶片就能掃描 64 顆 LED。每個命令是 16 位元：高位元組是暫存器位址、低位元組是資料，CS（LOAD）拉低後送出、CS 上升緣鎖存。韌體把 SPI1 設成 16 位元資料框（DFF = 1，PA5 = CLK、PA7 = DIN、PA4 = CS，4.5 MHz），設定時先送 0x0C00 進入關機模式，再設定不解碼 0x0900、亮度 0x0A04、掃描全部 8 列 0x0B07，最後 0x0C01 恢復正常運作；之後每 100 ms 把字型緩衝區的 8 個欄位寫進 0x01–0x08。',
    '為什麼電源是 4.5 V？MAX7219 的輸入高電位門檻 VIH = 0.7 × VCC：5 V 供電時需要 3.5 V，Blue Pill 的 3.3 V 輸出永遠達不到，點陣會一片漆黑（模擬也會提出警告）。把整個電路的電源調到 4.5 V，VIH 降為 3.15 V，3.3 V 訊號就夠了 —— 這是業餘專題常用的解法；正式產品則會加電位轉換器。Blue Pill 的 3.3 V 穩壓器在 4.5 V 輸入下仍正常工作。',
    '試試看：把 PS1 的電壓改回 5 V，點陣立刻停止更新（模擬日誌會指出 CLK / DIN / CS 的電壓卡在 VIL 與 VIH 之間）；邏輯分析儀的 SPI 解碼器已設為 16 位元字組，可以直接看每個暫存器命令。',
  ].join('\n\n'),
  tags: ['MAX7219', 'LED 點陣', 'SPI', '16 位元訊框', '邏輯準位'],
  glyph: 'max7219_8x8',
  firmware: 'hal-max7219',
  simulation: 'full',
  build() {
    const b = bluePillBench({ supply: 4.5 })
    // MAX7219 module at a40: VCC a40 GND a41 DIN a42 CS a43 CLK a44 (extends behind the board)
    b.add({ id: 'MX1', type: 'max7219_8x8', at: 'a40' })
    b.toRail('e40', 'bot+', 'red') // VCC = 4.5 V supply rail
    b.toRail('e41', 'top-')
    b.wire('e42', tap('PA7'), 'blue') // DIN = MOSI
    b.wire('d43', tap('PA4'), 'orange') // CS
    b.wire('e44', tap('PA5'), 'yellow') // CLK = SCK
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PA5', 'PA5 CLK'), mcuChannel(1, 'PA7', 'PA7 DIN'), mcuChannel(2, 'PA4', 'PA4 CS')],
    decoders: [{ id: 'spi1', decoder: 'spi', channels: { sck: 0, mosi: 1, cs: 2 }, options: { mode: '0', bitOrder: 'msb', wordSize: '16', csActive: 'low' } }],
  },
  tray: 'logic',
  expect: { seconds: 1.2, uart: { USART1: 'MAX7219 scroll demo\r\nMAX7219 ready\r\nstep 0\r\nstep 10\r\n' } },
}
