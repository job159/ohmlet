import { bluePillBench, mcuChannel } from './lib.mjs'

export default {
  id: 'uart-hello',
  order: 10,
  category: 'serial',
  difficulty: 'beginner',
  title: 'UART 問候與回音（終端機）',
  summary: 'USART1 115200 8N1：開機問候、每秒報時，輸入的每一行文字都會被回傳',
  description: [
    'USART1 的 TX 是 PA9、RX 是 PA10。韌體開機印出 `Hello from STM32F103!`，之後以 HAL_GetTick() 排程每 1000 ms 印出 `tick N`（以截止時間累加，不會漂移）。接收用中斷：收到 CR 或 LF 視為一行結束，回傳 `echo: <內容>`。',
    '這個範例不需要外接零件：UART 終端機直接接在 USART1 的周邊上，就像 USB 轉 TTL 線接到 PA9 / PA10。',
    '試試看：在終端機輸入 `hello` 並按輸入鍵；打開邏輯分析儀，PA9 與 PA10 已設定 UART 解碼器（115200），可以看到每個位元的起始位元、資料位元與停止位元（每個字元約 86.8 µs）。',
  ].join('\n\n'),
  tags: ['USART1', '115200', '中斷接收', '終端機'],
  glyph: 'usb_uart_ch340',
  firmware: 'hal-uart-hello',
  simulation: 'full',
  build() {
    return bluePillBench()
  },
  logic: {
    channels: [mcuChannel(0, 'PA9', 'PA9 TX'), mcuChannel(1, 'PA10', 'PA10 RX')],
    decoders: [
      { id: 'uart-tx', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } },
      { id: 'uart-rx', decoder: 'uart', channels: { data: 1 }, options: { baud: '115200' } },
    ],
  },
  tray: 'uart',
  expect: { seconds: 1.2 },
}
