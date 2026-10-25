import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'pwm-fade',
  order: 40,
  category: 'gpio',
  difficulty: 'beginner',
  title: 'PWM 呼吸燈（TIM3）',
  summary: 'TIM3 CH1 在 PA6 輸出 1 kHz PWM，工作週期 0 → 100 → 0 % 每 2 秒循環',
  description: [
    'TIM3 以 1 kHz 產生 PWM，更新中斷每 10 個週期把預載的 CCR1 加減 1 %，LED 的平均電流隨工作週期變化，看起來就像在「呼吸」。PA6 設為 AF 推挽輸出，由計時器硬體直接驅動，CPU 不需要切換腳位。',
    '接線：PA6 → 330 Ω → 紅色 LED → GND。示波器 CH1 探棒接在 PA6，邏輯分析儀也在 PA6 上。',
    '試試看：在邏輯分析儀放大單一週期，量高電位時間（工作週期 × 1 ms）；用示波器觀察 0 / 3.3 V 方波的寬度如何隨時間改變。',
  ].join('\n\n'),
  tags: ['TIM3', 'PWM', 'CCR', '中斷', 'LED'],
  glyph: 'led',
  firmware: 'hal-pwm-fade',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.wire(tap('PA6'), 'e40', 'yellow')
    b.add({ id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } })
    b.add({ id: 'LED1', type: 'led', holes: ['b44', b.rail('top-', 45)], params: { color: 'red' } })
    b.add({ id: 'PRB1', type: 'scope_probe', holes: ['c40'], params: { channel: 1 } })
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA6', 'PA6 PWM')] },
  // oscilloscope front panel on open (UX IS-2): 500 µs/div shows 5 periods of
  // the 1 kHz PWM, triggered on CH1's rising edge (the envelope's
  // instruments.scope, written by scripts/build-examples.mjs).
  scope: { tdiv: 0.0005, vdiv: 'auto', trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'auto' },
  tray: 'logic',
  expect: { seconds: 0.6 },
}
