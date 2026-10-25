import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'lcd1602-i2c',
  order: 20,
  category: 'display',
  difficulty: 'intermediate',
  title: 'LCD1602 液晶（I²C 轉接板）',
  summary: 'PCF8574 轉接板把 HD44780 的 4 位元並列介面變成兩條線：歡迎文字與每秒更新的開機時間',
  description: [
    'LCD1602 背面焊上 PCF8574 I²C 擴充晶片後，只要 SDA、SCL 兩條線就能控制。PCF8574 的 8 支輸出腳接到 LCD：P0 = RS、P1 = RW、P2 = E、P3 = 背光、P4–P7 = D4–D7。韌體（I2C1，100 kHz）每送出一個 4 位元半位元組都要寫兩次 PCF8574 —— 一次 E 為高、一次 E 為低 —— 用 I²C 模擬出 HD44780 需要的致能脈波，再依照資料手冊的 4 位元初始化步驟設定顯示器。',
    '接線：GND、VCC 接 5 V 電源軌；SDA → PB7、SCL → PB6。轉接板上的上拉電阻接到 5 V，PB6、PB7 是 5 V 容忍（FT）腳位，所以可以直接相連。位址 0x27（PCF8574A 轉接板是 0x3F）。',
    '試試看：在屬性面板轉動「對比微調電阻」，文字會淡到看不見 —— 實際焊好的模組最常見的「沒有字」原因就是這個；把「I²C 位址」改成 0x3F，韌體會回報找不到 PCF8574。',
  ].join('\n\n'),
  tags: ['LCD1602', 'HD44780', 'PCF8574', 'I²C', '背光'],
  glyph: 'lcd1602_i2c',
  firmware: 'hal-lcd1602-i2c',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // LCD1602 + PCF8574 backpack at j34: GND j34 VCC j35 SDA j36 SCL j37 (the LCD lies over the front edge)
    b.add({ id: 'LCD1', type: 'lcd1602_i2c', at: 'j34' })
    b.toRail('f34', 'bot-')
    b.toRail('f35', 'bot+')
    b.wire('g36', tap('PB7'), 'blue') // SDA
    b.wire('g37', tap('PB6'), 'yellow') // SCL
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB6', 'PB6 SCL'), mcuChannel(1, 'PB7', 'PB7 SDA')],
    decoders: [{ id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }],
  },
  tray: 'uart',
  expect: { seconds: 1.3, uart: { USART1: 'LCD1602 I2C demo\r\nLCD ready at 0x27\r\nuptime 1 s\r\n' } },
}
