import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'i2c-scan',
  order: 20,
  category: 'serial',
  difficulty: 'intermediate',
  title: 'I²C 匯流排掃描',
  summary: '掃描 0x08–0x77：找出 AT24C02（0x50）、SSD1306（0x3C）與 BME280（0x76）',
  description: [
    'I2C1（PB6 = SCL、PB7 = SDA，100 kHz）上掛了三個裝置：AT24C02 EEPROM、SSD1306 OLED 模組與 GY-BME280 感測器。韌體對每個 7 位元位址呼叫 HAL_I2C_IsDeviceReady，有回應 ACK 的就印出 `found 0xNN`，最後印出 `scan done N`。',
    'I²C 是開汲極匯流排：SCL 與 SDA 都需要上拉電阻到 3.3 V。麵包板上的 R1、R2（4.7 kΩ）之外，OLED 與 BME280 模組板上也各有一組 4.7 kΩ 上拉，三組並聯後約 1.6 kΩ —— 實務上很常見，掛的模組越多，上拉越強。AT24C02 的 A2–A0 接地，所以位址是 0x50；WP 接地允許寫入。BME280 只能接 3.3 V（由 Blue Pill 的 3V3 腳供電），OLED 模組自帶穩壓，接 5 V。',
    '試試看：在屬性面板把 OLED 的「I²C 位址（模組跳線）」改成 0x3D 再重新執行，掃描結果會跟著變；在邏輯分析儀上看每個位址的 START、位址位元組與 ACK / NACK（沒有裝置的位址會收到 NACK）。',
  ].join('\n\n'),
  tags: ['I²C', 'I2C1', '上拉電阻', 'ACK', 'AT24C02', 'BME280', 'SSD1306'],
  glyph: 'at24c02',
  firmware: 'hal-i2c-scan',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // AT24C02 (DIP-8 at f36): A0 f36, A1 f37, A2 f38, GND f39 / VCC e36, WP e37, SCL e38, SDA e39
    b.add({ id: 'U2', type: 'at24c02', at: 'f36' })
    b.toRail('a36', 'top+') // VCC 3.3 V
    b.toRail('a37', 'top-') // WP low: writable
    for (const c of [36, 37, 38]) b.toRail(`j${c}`, 'bot-') // A0–A2 low: 0x50
    b.toRail('j39', 'bot-') // GND
    b.wire('a38', tap('PB6'), 'yellow') // SCL
    b.wire('a39', tap('PB7'), 'blue') // SDA
    b.add({ id: 'R1', type: 'resistor', holes: ['b38', b.rail('top+', 38)], params: { resistance: 4700 } })
    b.add({ id: 'R2', type: 'resistor', holes: ['b39', b.rail('top+', 39)], params: { resistance: 4700 } })
    // GY-BME280 (3.3 V only) at f46: VCC GND SCL SDA CSB SDO
    b.add({ id: 'ENV', type: 'bme280', at: 'f46', params: { temperature: 24.5, pressure: 1009.8, humidity: 61 } })
    b.wire(tap('3V3_2'), 'j46', 'red')
    b.toRail('j47', 'bot-')
    b.wire('j48', 'c38', 'yellow')
    b.wire('j49', 'c39', 'blue')
    // SSD1306 OLED module (5 V, own regulator) at j56: GND VCC SCL SDA
    b.add({ id: 'OLED1', type: 'ssd1306_i2c', at: 'j56' })
    b.toRail('f56', 'bot-')
    b.toRail('f57', 'bot+')
    b.wire('h48', 'h58', 'yellow')
    b.wire('h49', 'h59', 'blue')
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB6', 'PB6 SCL'), mcuChannel(1, 'PB7', 'PB7 SDA')],
    decoders: [{ id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: { addressFormat: '7bit' } }],
  },
  tray: 'uart',
  expect: { seconds: 0.8, uart: { USART1: 'I2C1 scan 0x08-0x77\r\nfound 0x3C\r\nfound 0x50\r\nfound 0x76\r\nscan done 3\r\n' } },
}
