import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'button-exti',
  order: 20,
  category: 'gpio',
  difficulty: 'beginner',
  title: '按鈕中斷（EXTI）與軟體去彈跳',
  summary: 'PB12 按鈕觸發 EXTI 下降緣中斷，20 ms 去彈跳後切換 PA5 LED 並印出按壓次數',
  description: [
    '按鈕一端接 PB12、另一端接 GND，沒有外接電阻：韌體把 PB12 設成「輸入＋內部上拉」，放開時讀到 1、按下時讀到 0。EXTI12 在下降緣觸發中斷，中斷只記錄時間；主迴圈確認 20 ms 後腳位仍為低電位，才算一次有效按壓 —— 這就是軟體去彈跳。',
    '每次有效按壓，PA5 的 LED 反轉，並在 USART1（115200 8N1）印出 `press 1`、`press 2`…。開機時不會印任何東西。',
    '試試看：模擬執行時在 3D 畫面點一下 SW1 就是按一次；想讓它一直按著，就雙擊 SW1，或在屬性面板打開 SW1 的「保持按下」（再點一下 SW1 或關掉「保持按下」就放開）。打開邏輯分析儀，對照 PB12、PA5 與 UART 解碼的時間差（約 19–20 ms）。',
    'ERC 提醒：靜態檢查看不到韌體會開啟內部上拉，因此會標示 PB12 為「浮接輸入」風險 —— 這正是本範例要說明的重點；若韌體沒開上拉，放開按鈕時 PB12 就真的會浮接。',
  ].join('\n\n'),
  tags: ['EXTI', 'NVIC', '內部上拉', '去彈跳', 'UART'],
  glyph: 'pushbutton',
  firmware: 'hal-button-exti',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // push-button straddling the channel: A side = column 40, B side = column 42
    b.add({ id: 'SW1', type: 'pushbutton', at: 'f40', params: { pressed: false } })
    b.wire(tap('PB12'), 'j40', 'blue')
    b.toRail('j42', 'bot-')
    // PA5 → 330 Ω → LED → GND
    b.wire(tap('PA5'), 'e46', 'yellow')
    b.add({ id: 'R1', type: 'resistor', holes: ['a46', 'a50'], params: { resistance: 330 } })
    b.add({ id: 'LED1', type: 'led', holes: ['b50', b.rail('top-', 51)], params: { color: 'green' } })
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB12', 'PB12 按鈕'), mcuChannel(1, 'PA5', 'PA5 LED'), mcuChannel(2, 'PA9', 'PA9 TX')],
    decoders: [{ id: 'uart1', decoder: 'uart', channels: { data: 2 }, options: { baud: '115200' } }],
  },
  tray: 'uart',
  ercRisks: ['floating-input'],
  expect: { seconds: 0.6, uart: { USART1: '' } },
}
