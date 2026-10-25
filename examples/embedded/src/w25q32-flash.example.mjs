import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'w25q32-flash',
  order: 50,
  category: 'serial',
  difficulty: 'advanced',
  title: 'SPI NOR 快閃記憶體（W25Q32）抹除與燒寫',
  summary: '讀晶片 ID、4 KiB 磁區抹除（輪詢 BUSY）、64 位元組頁燒寫，再以 03h / 0Bh 讀回',
  description: [
    'W25Q32 是 4 MB 的 SPI NOR 快閃記憶體。SPI1 以 9 MHz、模式 0 通訊，CS 用 PA4 手動控制。韌體依序：讀 `JEDEC` 晶片 ID（EF 40 16）與狀態暫存器 SR1、寫入致能（06h）後抹除 0x1000 的 4 KiB 磁區並輪詢 BUSY（約 45 ms）、燒寫 64 位元組（02h 頁燒寫），最後分別用一般讀取 03h 與快速讀取 0Bh 讀回比對，成功印出 `w25q ok`。',
    'NOR 快閃記憶體的關鍵觀念：燒寫只能把位元從 1 變成 0，所以要先抹除（全部變回 FFh）才能寫新資料。模擬的快閃記憶體內容在同一個瀏覽器分頁中會保留。',
    '接線：CS → PA4、DO（MISO）→ PA6、DI（MOSI）→ PA7、CLK → PA5；WP 與 HOLD 接 3.3 V（不使用），VCC 接 3.3 V（W25Q32 最高 3.6 V，不能接 5 V）。邏輯分析儀已設定 SPI 解碼（四條線）。',
  ].join('\n\n'),
  tags: ['SPI', '快閃記憶體', 'W25Q32', '晶片 ID', '抹除', '頁燒寫'],
  glyph: 'w25q32_flash',
  firmware: 'hal-w25q',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // W25Q32 module at e40: CS DO WP GND DI CLK HOLD VCC (row e), free holes a–d
    b.add({ id: 'F1', type: 'w25q32_flash', at: 'e40' })
    b.wire('d40', tap('PA4'), 'green') // CS
    b.wire('d41', tap('PA6'), 'white') // DO → MISO
    b.toRail('d42', 'top+') // WP high
    b.toRail('d43', 'top-') // GND
    b.wire('d44', tap('PA7'), 'blue') // DI ← MOSI
    b.wire('d45', tap('PA5'), 'yellow') // CLK ← SCK
    b.toRail('d46', 'top+') // HOLD high
    b.toRail('d47', 'top+') // VCC 3.3 V
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PA5', 'PA5 SCK'), mcuChannel(1, 'PA7', 'PA7 MOSI'), mcuChannel(2, 'PA6', 'PA6 MISO'), mcuChannel(3, 'PA4', 'PA4 CS')],
    decoders: [{ id: 'spi1', decoder: 'spi', channels: { sck: 0, mosi: 1, miso: 2, cs: 3 }, options: { mode: '0', bitOrder: 'msb', wordSize: '8', csActive: 'low' } }],
  },
  tray: 'uart',
  expect: { seconds: 0.5, uart: { USART1: 'W25Q32 test (SPI1 9 MHz mode 0, CS PA4)\r\nJEDEC ID EF 40 16\r\nSR1 0x00\r\n' } },
}
