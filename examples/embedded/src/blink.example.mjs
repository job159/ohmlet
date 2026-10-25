import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'blink',
  order: 10,
  category: 'gpio',
  difficulty: 'beginner',
  title: 'Blue Pill 閃爍 LED（HAL）',
  summary: 'HAL_Delay(500) 讓 PA5 外接 LED 與板載 PC13 LED 一起閃爍',
  description: [
    '嵌入式的第一個程式：真正的 STM32CubeIDE 風格 HAL 韌體（72 MHz，HSE 8 MHz × PLL 9）在模擬的 STM32F103 上逐條指令執行。主迴圈呼叫 HAL_GPIO_TogglePin 後 HAL_Delay(500)，PA5 與 PC13 每 501 ms 反轉一次（`HAL_Delay(n)` 實際等待 n + 1 個 SysTick 週期）。',
    '接線：PA5 → 330 Ω 電阻 → 紅色 LED 陽極，LED 陰極接 GND（高電位點亮）。板載綠色 LED 接在 PC13，經 510 Ω 接到 3.3 V（低電位點亮）。韌體讓 PC13 的電位永遠與 PA5 相反，所以兩顆 LED 會同時亮、同時暗。',
    '試試看：打開邏輯分析儀量 PA5 與 PC13 的週期（約 1.002 s），確認兩者互為反相；在屬性面板查看 MCU 狀態與腳位模式；把 R1 改成 33 Ω 後點 LED1，電流會升到約 18 mA；把 R1 換成一條導線（LED 直接接在 PA5），問題面板就會出現「LED1 沒有限流電阻」。',
  ].join('\n\n'),
  tags: ['GPIO', 'HAL_Delay', 'LED', 'PC13'],
  glyph: 'led',
  firmware: 'hal-blink',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // PA5 → 330 Ω → red LED → GND (top − rail)
    b.wire(tap('PA5'), 'e36', 'yellow')
    b.add({ id: 'R1', type: 'resistor', holes: ['a36', 'a40'], params: { resistance: 330 } })
    b.add({ id: 'LED1', type: 'led', holes: ['b40', b.rail('top-', 41)], params: { color: 'red' } })
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA5', 'PA5 LED'), mcuChannel(1, 'PC13', 'PC13 板載 LED')] },
  tray: 'logic',
  expect: { seconds: 1.2 },
}
