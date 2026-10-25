import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'mpu6050-imu',
  order: 80,
  category: 'sensor',
  difficulty: 'intermediate',
  title: 'MPU-6050 六軸加速度計與陀螺儀',
  summary: 'GY-521 模組：讀 WHO_AM_I、喚醒、設定 ±2 g / ±250 °/s，每 100 ms 讀 14 個位元組並印出原始值與溫度',
  description: [
    'MPU-6050 上電後處於睡眠模式，第一件事是把 PWR_MGMT_1（0x6B）寫成 0 喚醒它 —— 忘了這一步，所有讀數都是 0。韌體先讀 WHO_AM_I（0x75，應為 0x68）確認晶片存在，設定取樣率、低通濾波與量程，之後每 100 ms 從 ACCEL_XOUT_H（0x3B）連續讀 14 個位元組（大端序）：三軸加速度、溫度、三軸角速度。±2 g 時 1 g = 16384，±250 °/s 時 1 °/s = 131，溫度 = 原始值 / 340 + 36.53 °C。',
    '接線：VCC 接 5 V —— GY-521 板上有 3.3 V 穩壓器，接 3.3 V 反而會因壓降不足而讓晶片電壓偏低（ERC 會提醒）—— GND 共地，SCL → PB6、SDA → PB7；模組上已有 4.7 kΩ 上拉電阻（拉到模組的 3.3 V），AD0 在模組上接了下拉電阻，所以位址是 0x68。',
    '試試看：模擬執行時在屬性面板改變「加速度 X / Y / Z」與「角速度 X / Y / Z」，讀數會在下一筆更新；把 PB12 接地，韌體就不會寫 PWR_MGMT_1 —— 重現「讀數全是 0」的經典錯誤。',
  ].join('\n\n'),
  tags: ['MPU-6050', 'GY-521', '慣性量測', '加速度計', '陀螺儀', 'I²C'],
  glyph: 'mpu6050_gy521',
  firmware: 'hal-mpu6050',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // GY-521 at f40: VCC f40 GND f41 SCL f42 SDA f43 XDA f44 XCL f45 AD0 f46 INT f47 (board over rows b–f)
    b.add({ id: 'IMU1', type: 'mpu6050_gy521', at: 'f40' })
    b.toRail('j40', 'bot+') // VCC 5 V (on-board 3.3 V regulator)
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
  expect: { seconds: 0.5, uart: { USART1: 'MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)\r\nWHO_AM_I=0x68\r\nawake: +-2 g, +-250 dps, 100 Hz\r\n' } },
}
