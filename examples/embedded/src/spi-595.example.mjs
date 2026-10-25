import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'spi-595',
  order: 40,
  category: 'serial',
  difficulty: 'intermediate',
  title: 'SPI 74HC595 跑馬燈',
  summary: 'SPI1 每 100 ms 送出一個位元組到 74HC595，8 顆 LED 依序點亮',
  description: [
    '74HC595 是「串列輸入、並列輸出」的移位暫存器：SPI1 的 SCK（PA5）接 SRCLK、MOSI（PA7）接 SER，8 個時脈把一個位元組移進去；PA4 接 RCLK，拉高的瞬間把移位暫存器鎖存到 QA–QH 輸出。每顆輸出接 220 Ω 與 LED。',
    '韌體以 4.5 MHz（模式 0）每 100 ms 送出 `1 << step`，所以 LED 從 QA 到 QH 一顆接一顆亮。SRCLR 接 3.3 V（不清除）、OE 接地（輸出致能）。',
    '試試看：在邏輯分析儀放大一次傳輸，SPI 解碼器（CS = PA4，低電位有效）會顯示每個位元組；把 OE 改接 3.3 V，所有 LED 都會熄滅但 SPI 傳輸照常。',
  ].join('\n\n'),
  tags: ['SPI', 'SPI1', '74HC595', '移位暫存器', 'LED'],
  glyph: '74hc595',
  firmware: 'hal-spi-595',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    const c = 34
    // DIP-16 at f34: QB…QH f34…f40, GND f41; QH' e41, SRCLR e40, SRCLK e39, RCLK e38, OE e37, SER e36, QA e35, VCC e34
    b.add({ id: 'U2', type: '74hc595', at: `f${c}` })
    b.toRail(`a${c}`, 'top+') // VCC 3.3 V
    b.toRail(`j${c + 7}`, 'bot-') // GND
    b.toRail(`a${c + 6}`, 'top+') // SRCLR high
    b.toRail(`a${c + 3}`, 'top-') // OE low
    b.wire(`a${c + 5}`, tap('PA5'), 'yellow') // SRCLK ← SCK
    b.wire(`a${c + 2}`, tap('PA7'), 'blue') // SER ← MOSI
    b.wire(`a${c + 4}`, tap('PA4'), 'green') // RCLK ← PA4
    const j0 = c + 8
    // QA (upper strip c+1): 220 Ω to column j0, LED to the top − rail
    b.add({ id: 'R1', type: 'resistor', holes: [`b${c + 1}`, `b${j0}`], params: { resistance: 220 } })
    b.add({ id: 'LED1', type: 'led', holes: [`c${j0}`, b.rail('top-', j0)], params: { color: 'red' } })
    // QB…QH (lower strips c…c+6): 220 Ω to columns j0…j0+6, LEDs to the bottom − rail
    for (let k = 0; k < 7; k++) {
      b.add({ id: `R${k + 2}`, type: 'resistor', holes: [`j${c + k}`, `j${j0 + k}`], params: { resistance: 220 } })
      b.add({ id: `LED${k + 2}`, type: 'led', holes: [`i${j0 + k}`, b.rail('bot-', j0 + k)], params: { color: 'red' } })
    }
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PA5', 'PA5 SCK'), mcuChannel(1, 'PA7', 'PA7 MOSI'), mcuChannel(2, 'PA4', 'PA4 RCLK')],
    decoders: [{ id: 'spi1', decoder: 'spi', channels: { sck: 0, mosi: 1, cs: 2 }, options: { mode: '0', bitOrder: 'msb', wordSize: '8', csActive: 'low' } }],
  },
  tray: 'logic',
  expect: { seconds: 1.0 },
}
