import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'i2c-eeprom',
  order: 30,
  category: 'serial',
  difficulty: 'intermediate',
  title: 'I²C EEPROM 讀寫（AT24C02）',
  summary: '跨頁寫入 16 位元組、以 ACK 輪詢等待 5 ms 寫入週期，再用阻塞與中斷模式讀回比對',
  description: [
    'AT24C02 是 256 位元組的 I²C EEPROM，一頁 8 位元組。韌體在位址 0x1C 起寫入 16 位元組，刻意跨過兩個頁邊界，所以拆成 4 + 8 + 4 三次寫入；每次寫入後晶片進入約 5 ms 的內部寫入週期，期間不回應 ACK，韌體以「ACK 輪詢」計算等了幾次（約 45 次）。',
    '接著用 HAL_I2C_Mem_Read 分別以 16、1、2 個位元組讀回，再用中斷模式（_IT）讀一次，全部比對正確後印出 `eeprom ok`。EEPROM 的內容在模擬中會保留：第二次執行時 `before:` 那一行就會顯示上次寫入的資料。',
    '接線：A2–A0 與 WP 接地（位址 0x50、允許寫入），VCC 接 3.3 V，SCL / SDA 各一顆 4.7 kΩ 上拉。',
    '試試看：在邏輯分析儀找出寫入週期中一連串被 NACK 的輪詢；把 WP 改接 3.3 V（寫入保護）—— 晶片仍會回 ACK，但資料不會寫進去，只要記憶體原本不是這組資料，讀回比對就會出現 `mismatch`。',
  ].join('\n\n'),
  tags: ['I²C', 'EEPROM', 'AT24C02', 'ACK 輪詢', '頁寫入', '中斷'],
  glyph: 'at24c02',
  firmware: 'hal-i2c-eeprom',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.add({ id: 'U2', type: 'at24c02', at: 'f40' })
    b.toRail('a40', 'top+') // VCC 3.3 V
    b.toRail('a41', 'top-') // WP low: writable
    for (const c of [40, 41, 42]) b.toRail(`j${c}`, 'bot-') // A0–A2 low: 0x50
    b.toRail('j43', 'bot-') // GND
    b.wire('a42', tap('PB6'), 'yellow') // SCL
    b.wire('a43', tap('PB7'), 'blue') // SDA
    b.add({ id: 'R1', type: 'resistor', holes: ['b42', b.rail('top+', 42)], params: { resistance: 4700 } })
    b.add({ id: 'R2', type: 'resistor', holes: ['b43', b.rail('top+', 43)], params: { resistance: 4700 } })
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB6', 'PB6 SCL'), mcuChannel(1, 'PB7', 'PB7 SDA')],
    decoders: [{ id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }],
  },
  tray: 'uart',
  expect: { seconds: 0.6 },
}
