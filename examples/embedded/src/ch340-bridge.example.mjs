import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'ch340-bridge',
  order: 70,
  category: 'serial',
  difficulty: 'intermediate',
  title: 'CH340 USB 轉 UART（電腦 COM 埠）',
  summary: 'USART2 經 CH340 模組連到電腦的虛擬 COM 埠：開機訊息，輸入一行文字就附上行號回傳',
  description: [
    'CH340 是常見的 USB 轉 TTL 序列模組。接線要「交叉」：模組的 TXD 接 MCU 的 RX（PA3），模組的 RXD 接 MCU 的 TX（PA2），兩邊 GND 相連。韌體使用 USART2（115200 8N1），開機印出 `CH340 echo on USART2`，之後每收到一行就回傳 `echo N: <內容>`。',
    '模組上的電壓跳線已設在 3.3 V（屬性面板的「邏輯準位跳線帽」）：PA2 / PA3 不是 5 V 容忍腳位，若跳線在 5 V，模組的 TXD 會以 5 V 驅動 PA3 —— 把跳線帽改成 5 V，ERC 與模擬都會提出過壓警告。',
    '試試看：在 UART 終端機選擇 CH1 的 COM 埠（電腦端），輸入文字並按輸入鍵；也可以把 COM 埠的鮑率改成 9600，看看鮑率不符時收到的亂碼。',
  ].join('\n\n'),
  tags: ['UART', 'USART2', 'CH340', 'COM 埠', '交叉接線'],
  glyph: 'usb_uart_ch340',
  firmware: 'hal-ch340',
  simulation: 'partial',
  simulationNote: 'USB 通訊本身不模擬：電腦端以虛擬 COM 埠代替；CH340 與 Blue Pill 之間的 TXD / RXD 仍以真實的 UART 波形傳送。',
  build() {
    const b = bluePillBench()
    // CH340 module at a35: GND 3V3 5V TXD RXD DTR (row a), free holes b–e
    b.add({ id: 'CH1', type: 'usb_uart_ch340', at: 'a35', params: { logic: '3.3V', baud: '115200' } })
    b.toRail('e35', 'top-')
    b.wire('e38', tap('PA3'), 'white') // module TXD → MCU RX
    b.wire('e39', tap('PA2'), 'yellow') // module RXD ← MCU TX
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PA2', 'PA2 TX'), mcuChannel(1, 'PA3', 'PA3 RX')],
    decoders: [
      { id: 'uart-tx', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } },
      { id: 'uart-rx', decoder: 'uart', channels: { data: 1 }, options: { baud: '115200' } },
    ],
  },
  tray: 'uart',
  expect: { seconds: 0.5, uart: { 'CH1/COM': 'CH340 echo on USART2 (115200 8N1)\r\n' } },
}
