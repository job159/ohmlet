import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'dc-motor-l298n',
  order: 20,
  category: 'motor',
  difficulty: 'intermediate',
  title: '直流馬達與 L298N H 橋',
  summary: 'ENA 接 TIM2 1 kHz PWM 調速、IN1 / IN2 決定方向：正轉 25→100 %、煞車、反轉、滑行',
  description: [
    'H 橋用四個開關讓馬達兩端的電壓可以正反切換。L298N 的 A 通道：ENA 高電位時致能，IN1 / IN2 = 1 / 0 正轉、0 / 1 反轉、相同時兩端短路「煞車」；ENA 低電位時輸出全部關閉，馬達「滑行」慢慢停下。對 ENA 送 PWM，就能以工作週期控制平均電壓與轉速。',
    '韌體：TIM2 CH1（PA0）輸出 1 kHz PWM 到 ENA（屬性面板中「ENA 跳線帽（接 +5V）」已拿掉），PB0 / PB1 控制 IN1 / IN2，依序正轉 25 %、50 %、75 %、100 %，煞車，反轉 50 %、100 %，滑行，每段 400 ms，USART1 印出每個階段。',
    '接線：馬達使用獨立的 7.5 V 電源 PS2，接到 L298N 的 +12V 端子；L298N 的 GND 必須和 Blue Pill 共地，否則控制訊號沒有共同參考。模組的「5V-EN 穩壓器跳線帽」已拔掉，邏輯電源 +5V 改由麵包板的 5 V 電源軌供應 —— 馬達電源高於 12 V 時一定要這樣接；這裡雖然只有 7.5 V，也採用同樣的接法。L298N 是雙極性電晶體 H 橋，輸出會比電源低約 2 V。試試看：在屬性面板加大馬達的「負載轉矩」，看轉速下降；比較「煞車」與「滑行」的減速差異。',
  ].join('\n\n'),
  tags: ['直流馬達', 'L298N', 'H 橋', 'PWM', '調速', '共地'],
  glyph: 'l298n_module',
  firmware: 'hal-dc-motor',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.add({ id: 'PS2', type: 'power_supply', params: { voltage: 7.5 } })
    b.add({ id: 'DRV1', type: 'l298n_module', params: { jumperEnA: false, jumper5v: false } })
    b.add({ id: 'M1', type: 'dc_motor' })
    b.wire('PS2:+', 'DRV1:+12V', 'red')
    b.wire('PS2:-', b.rail('bot-', 45), 'black')
    b.wire('DRV1:GND', b.rail('bot-', 46), 'black')
    b.wire('DRV1:+5V', b.rail('bot+', 46), 'red') // logic supply from the 5 V rail (5V-EN jumper removed)
    b.wire('DRV1:ENA', tap('PA0'), 'purple')
    b.wire('DRV1:IN1', tap('PB0'), 'yellow')
    b.wire('DRV1:IN2', tap('PB1'), 'green')
    b.wire('DRV1:OUT1', 'M1:M+', 'red')
    b.wire('DRV1:OUT2', 'M1:M-', 'black')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA0', 'PA0 ENA'), mcuChannel(1, 'PB0', 'PB0 IN1'), mcuChannel(2, 'PB1', 'PB1 IN2')] },
  tray: 'uart',
  expect: { seconds: 0.6, uart: { USART1: 'L298N DC motor demo\r\nfwd 25%\r\nfwd 50%\r\n' } },
}
