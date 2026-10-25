import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'traffic-light',
  order: 30,
  category: 'gpio',
  difficulty: 'beginner',
  title: '紅綠燈與行人按鈕',
  summary: '綠 3 s → 黃 1 s → 紅 3 s 的狀態機，PB0 行人按鈕可提早結束綠燈',
  description: [
    '三顆 LED 各串 330 Ω：PA1 紅、PA2 黃、PA3 綠。韌體是一個以 HAL_GetTick() 計時的狀態機，每次換燈都在 USART1 印出 `light=GREEN`、`light=YELLOW`、`light=RED`。',
    '行人按鈕接在 PB0 與 GND 之間（內部上拉、EXTI0 下降緣）。綠燈期間按下，綠燈會在「已亮滿 1 秒」或「立即」兩者較晚的時間結束，並印出 `light=YELLOW (walk)`；黃燈與紅燈期間的按壓會被忽略。',
    '試試看：在綠燈剛亮時按 SW1，再在紅燈時按一次，比較 UART 輸出；用邏輯分析儀確認任何時刻只有一顆燈亮。',
    'ERC 提醒：PB0 只靠韌體開啟的內部上拉，靜態檢查會標示「浮接輸入」風險。',
  ].join('\n\n'),
  tags: ['狀態機', 'HAL_GetTick', 'EXTI', 'LED'],
  glyph: 'led',
  firmware: 'hal-traffic-light',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    const lamp = (n, pin, col, color) => {
      b.wire(tap(pin), `e${col}`, color === 'red' ? 'white' : color === 'yellow' ? 'yellow' : 'green')
      b.add({ id: `R${n}`, type: 'resistor', holes: [`a${col}`, `a${col + 3}`], params: { resistance: 330 } })
      b.add({ id: `LED${n}`, type: 'led', holes: [`b${col + 3}`, b.rail('top-', col + 4)], params: { color } })
    }
    lamp(1, 'PA1', 34, 'red')
    lamp(2, 'PA2', 39, 'yellow')
    lamp(3, 'PA3', 44, 'green')
    // pedestrian button: A side column 52 (PB0), B side column 54 (GND)
    b.add({ id: 'SW1', type: 'pushbutton', at: 'f52', params: { pressed: false } })
    b.wire(tap('PB0'), 'a52', 'blue')
    b.toRail('j54', 'bot-')
    return b
  },
  logic: {
    channels: [
      mcuChannel(0, 'PA3', 'PA3 綠'),
      mcuChannel(1, 'PA2', 'PA2 黃'),
      mcuChannel(2, 'PA1', 'PA1 紅'),
      mcuChannel(3, 'PB0', 'PB0 行人'),
      mcuChannel(4, 'PA9', 'PA9 TX'),
    ],
    decoders: [{ id: 'uart1', decoder: 'uart', channels: { data: 4 }, options: { baud: '115200' } }],
  },
  tray: 'uart',
  ercRisks: ['floating-input'],
  expect: { seconds: 0.5 },
}
