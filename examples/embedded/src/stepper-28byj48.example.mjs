import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'stepper-28byj48',
  order: 40,
  category: 'motor',
  difficulty: 'beginner',
  title: '28BYJ-48 步進馬達與 ULN2003',
  summary: 'PB12–PB15 依半步順序驅動四相線圈，每 2 ms 一步；4096 個半步轉一圈，正轉後反轉',
  description: [
    '28BYJ-48 是 5 V 單極步進馬達，內部有 1:64 減速齒輪：輸出軸轉一圈需要 4096 個半步。紅線是共同端（接 5 V），橘、黃、粉紅、藍四條線依序接地就會一步一步轉動。ULN2003 是七組達靈頓電晶體陣列，負責把 MCU 的 3.3 V 訊號放大成能吸收數百 mA 的低側開關，板上的 LED A–D 顯示目前導通的相。',
    '韌體：PB12–PB15 接 IN1–IN4，依半步順序（橘、橘+黃、黃、黃+粉、粉、粉+藍、藍、藍+橘）每 2 ms 前進一步，正轉 4096 步、停 500 ms、再反轉 4096 步，USART1 每 1024 步回報一次進度（約 2 秒）。',
    '接線：ULN2003 的 VCC 接 5 V、GND 與 Blue Pill 共地，OUT1–OUT4 接橘、黃、粉、藍，馬達紅線接 VCC。試試看：把黃線和粉紅線對調，馬達只會原地抖動 —— 相序錯誤的典型症狀。',
  ].join('\n\n'),
  tags: ['步進馬達', '28BYJ-48', 'ULN2003', '半步', '相序'],
  glyph: 'stepper_28byj48',
  firmware: 'hal-stepper-uln2003',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.add({ id: 'DRV1', type: 'uln2003_board' })
    b.add({ id: 'M1', type: 'stepper_28byj48' })
    b.wire('DRV1:VCC', b.rail('bot+', 40), 'red')
    b.wire('DRV1:GND', b.rail('bot-', 40), 'black')
    b.wire('DRV1:IN1', tap('PB12'), 'blue')
    b.wire('DRV1:IN2', tap('PB13'), 'green')
    b.wire('DRV1:IN3', tap('PB14'), 'yellow')
    b.wire('DRV1:IN4', tap('PB15'), 'orange')
    b.wire('DRV1:OUT1', 'M1:ORANGE', 'orange')
    b.wire('DRV1:OUT2', 'M1:YELLOW', 'yellow')
    b.wire('DRV1:OUT3', 'M1:PINK', 'purple')
    b.wire('DRV1:OUT4', 'M1:BLUE', 'blue')
    b.wire('M1:RED', 'DRV1:VCC', 'red')
    return b
  },
  logic: {
    channels: [
      mcuChannel(0, 'PB12', 'PB12 IN1'),
      mcuChannel(1, 'PB13', 'PB13 IN2'),
      mcuChannel(2, 'PB14', 'PB14 IN3'),
      mcuChannel(3, 'PB15', 'PB15 IN4'),
    ],
  },
  tray: 'logic',
  expect: { seconds: 0.5, uart: { USART1: '28BYJ-48 half-step 1 rev each way\r\n' } },
}
