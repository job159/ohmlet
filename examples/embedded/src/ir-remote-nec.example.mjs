import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'ir-remote-nec',
  order: 30,
  category: 'sensor',
  difficulty: 'intermediate',
  title: '紅外線遙控器解碼（VS1838B）',
  summary: 'EXTI 雙緣中斷 + 1 MHz 計時器量測脈波寬度：解出遙控器的位址、指令與重複碼',
  description: [
    'VS1838B 接收 38 kHz 調變的紅外線，收到載波時輸出低電位。常見的 `NEC` 協定一個訊框是：9 ms 低 + 4.5 ms 高的引導碼，接著 32 個位元（位址、位址反相、指令、指令反相，LSB 先送），每個位元以 562 µs 低開頭，之後高 562 µs 代表 0、高 1687 µs 代表 1；按住不放時每 108 ms 送一次重複碼（9 ms 低 + 2.25 ms 高）。',
    '韌體在 PB12 開啟 EXTI 雙緣中斷，每個邊緣讀 TIM2（1 MHz 自由計數）算出脈波寬度，用狀態機解出位元並檢查反相位元組，最後印出 `NEC addr=0x.. cmd=0x..` 或 `NEC repeat`。接線：OUT → PB12、GND、VCC 接 3.3 V。',
    '試試看：模擬執行時在屬性面板的「遙控器按鍵」選一個按鍵（例如 CH- 會送出指令碼 0x45），勾選「按住按鍵（送出重複碼）」看重複碼；在邏輯分析儀上量引導碼與每個位元的寬度。',
  ].join('\n\n'),
  tags: ['紅外線', '遙控器', 'VS1838B', 'EXTI', 'TIM2', '脈波寬度'],
  glyph: 'ir_receiver_vs1838b',
  firmware: 'hal-ir-nec',
  simulation: 'partial',
  simulationNote: '紅外線光學與 38 kHz 載波不模擬：內建的虛擬遙控器直接產生接收頭解調後的 OUT 波形（時序依協定規格）；Blue Pill 端的中斷、計時器與解碼程式完整執行。',
  build() {
    const b = bluePillBench()
    // VS1838B leads OUT f50, GND f51, VCC f52
    b.add({ id: 'IR1', type: 'ir_receiver_vs1838b', holes: ['f50', 'f51', 'f52'] })
    b.wire('j50', tap('PB12'), 'green') // OUT → PB12
    b.toRail('j51', 'bot-')
    b.wire('j52', tap('3V3_2'), 'red') // VCC 3.3 V
    return b
  },
  logic: { channels: [mcuChannel(0, 'PB12', 'PB12 IR OUT')] },
  tray: 'uart',
  expect: { seconds: 0.5 },
}
