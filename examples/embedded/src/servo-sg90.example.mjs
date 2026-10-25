import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'servo-sg90',
  order: 10,
  category: 'motor',
  difficulty: 'beginner',
  title: 'SG90 伺服馬達掃動',
  summary: 'TIM2 CH1（PA0）輸出 50 Hz PWM，脈寬 0.5–2.5 ms 對應 0°–180°，每 500 ms 轉動 30°',
  description: [
    '伺服馬達看的是脈波寬度而不是工作週期：每 20 ms 一個高電位脈波，0.5 ms = 0°、1.5 ms = 90°、2.5 ms = 180°。韌體把 TIM2 的預除器設為 PSC = 71（72 MHz ÷ 72 = 1 MHz，每格 1 µs）、ARR = 19999（週期 20 ms），PA0 輸出 CH1 PWM，改變 CCR1 就是改變脈寬（單位 µs）。角度從 0° 以 30° 為一步掃到 180° 再掃回來，每一步停 500 ms，並在 USART1 印出角度與脈寬。',
    '接線：伺服馬達的紅線（VCC）接 5 V 電源軌、棕線（GND）接地、橘線（SIG）接 PA0。伺服馬達轉動時電流可達數百 mA，不能由 Blue Pill 的 3.3 V 供電；訊號線的 3.3 V 高電位足以被 SG90 辨識。',
    '試試看：在邏輯分析儀上量 PA0 的脈寬；在屬性面板加大「負載轉矩」，看伺服馬達變慢；觀察擺臂從 90° 轉到 120° 所需的時間（SG90 約 0.1 s 轉 60°）。',
  ].join('\n\n'),
  tags: ['伺服馬達', 'SG90', 'PWM', 'TIM2', '脈波寬度'],
  glyph: 'sg90_servo',
  firmware: 'hal-sg90',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.add({ id: 'SV1', type: 'sg90_servo' })
    b.wire('SV1:VCC', b.rail('bot+', 40), 'red')
    b.wire('SV1:GND', b.rail('bot-', 40), 'black')
    b.wire('SV1:SIG', tap('PA0'), 'orange')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA0', 'PA0 SIG')] },
  tray: 'uart',
  expect: { seconds: 0.6, uart: { USART1: 'SG90 sweep 0-180 deg\r\nservo 0 deg (500 us)\r\nservo 30 deg (833 us)\r\n' } },
}
