import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'bme280-weather',
  order: 70,
  category: 'sensor',
  difficulty: 'advanced',
  title: 'BME280 氣象站（溫度、氣壓、濕度）',
  summary: 'I²C 讀出校正參數，強制模式 ×16 過取樣，以 Bosch 整數補償公式換算 T / P / H，每 500 ms 一筆',
  description: [
    'BME280 量到的是未經補償的原始值，每顆晶片出廠時都在暫存器 0x88–0xA1 與 0xE1–0xE7 存了自己的校正參數（dig_T1…dig_H6）。韌體開機時讀晶片 ID（0xD0 = 0x60）與全部校正參數，之後每 500 ms 以強制模式啟動一次轉換：先寫 ctrl_hum（0xF2）、再寫 ctrl_meas（0xF4）—— 順序不能顛倒，濕度設定要在寫 ctrl_meas 後才生效 —— 等待狀態暫存器（0xF3）的 `measuring` 位元清除，讀 0xF7–0xFE 共 8 個位元組，最後用資料手冊附的 Bosch 整數補償程式算出溫度（0.01 °C）、氣壓（Pa）與相對濕度。',
    '接線：GY-BME280 模組只能接 3.3 V（模組上沒有穩壓器），VCC 接 Blue Pill 的 3V3 腳，SCL → PB6、SDA → PB7，模組上已有 10 kΩ 上拉電阻；SDO 在模組上接地，所以位址是 0x76。',
    '試試看：模擬執行時在屬性面板改變「溫度」、「氣壓」、「相對濕度」，下一筆讀數就會跟著變；在邏輯分析儀上看一次連續讀出的 8 個位元組。',
  ].join('\n\n'),
  tags: ['BME280', '氣壓', '濕度', 'I²C', '校正參數', '補償公式'],
  glyph: 'bme280',
  firmware: 'hal-bme280',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // GY-BME280 at f40: VCC f40 GND f41 SCL f42 SDA f43 CSB f44 SDO f45 (board over rows d–f)
    b.add({ id: 'ENV1', type: 'bme280', at: 'f40', params: { temperature: 24.5, pressure: 1009.8, humidity: 61 } })
    b.wire('j40', tap('3V3_2'), 'red') // VCC 3.3 V
    b.toRail('j41', 'bot-')
    b.wire('j42', tap('PB6'), 'yellow') // SCL
    b.wire('j43', tap('PB7'), 'blue') // SDA
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB6', 'PB6 SCL'), mcuChannel(1, 'PB7', 'PB7 SDA')],
    decoders: [{ id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }],
  },
  tray: 'uart',
  expect: { seconds: 0.8, uart: { USART1: 'BME280 on I2C1 (PB6 SCL / PB7 SDA)\r\nid=0x60 dig_T1=28159 dig_P1=36998 dig_H1=75\r\n' } },
}
