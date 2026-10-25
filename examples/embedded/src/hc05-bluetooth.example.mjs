import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'hc05-bluetooth',
  order: 80,
  category: 'serial',
  difficulty: 'intermediate',
  title: 'HC-05 藍牙序列模組（AT 指令）',
  summary: '38400 鮑的 AT 指令設定名稱與鮑率，AT+RESET 後以 9600 鮑和已配對的手機互傳文字',
  description: [
    'HC-05 開機時若 EN（又稱 `KEY`）為高電位，會進入 AT 指令模式（固定 38400 8N1）。韌體以 USART2（TX PA2、RX PA3）送出 `AT`、`AT+VERSION?`、`AT+NAME=OHMLET`、`AT+UART=9600,0,0` 等指令並檢查回應，再拉低 EN（PB0）、送 `AT+RESET` 讓模組以 9600 鮑進入資料模式。STATE（PB1）變高表示手機已連線，之後韌體向手機送出 `hello phone`，並回傳手機傳來的每一行。完整過程印在 USART1。',
    '接線：模組 VCC 接 5 V、GND 共地。HC-05 模組板上有 3.3 V 穩壓器，藍牙晶片以 3.3 V 運作：TXD 與 STATE 輸出的高電位是 3.3 V，RXD 也是 3.3 V 的輸入。所以 RXD 直接接 PA2（Blue Pill 的 TX 本來就是 3.3 V；換成 5 V 的 MCU 才需要在 RXD 前加分壓）；EN 接 PB0，並有 10 kΩ 上拉到 3.3 V，上電瞬間就是高電位。TXD 與 STATE 其實也可以直接接 PA3、PB1——這個範例讓它們先經過 BSS138 四通道電位轉換器（LS1：LV 接 Blue Pill 的 3.3 V、HV 接 5 V），練習它的接法。輸出真的會到 5 V 的模組（5 V 邏輯的序列裝置）才一定要經過它：PA3、PB1 不是 5 V 耐受腳位。',
    '試試看：在 UART 終端機選擇 BT1 的 BT 埠（手機端），輸入 `ping` 並按輸入鍵；在屬性面板取消「手機已連線（藍牙連線）」，模擬沒有手機配對的情況；在邏輯分析儀上比較 AT 模式（38400 鮑）與資料模式（9600 鮑）的位元寬度。',
  ].join('\n\n'),
  tags: ['藍牙', 'HC-05', 'AT 指令', 'USART2', '鮑率', '電位轉換'],
  glyph: 'hc05_bt',
  firmware: 'hal-hc05',
  simulation: 'partial',
  simulationNote: '藍牙無線電不模擬：已配對的手機以虛擬序列埠「BT」代替；HC-05 與 Blue Pill 之間的 AT 對話與資料仍以真實的 UART 波形傳送。',
  build() {
    const b = bluePillBench()
    // HC-05 at e44: STATE e44, RXD e45, TXD e46, GND e47, VCC e48, EN e49 (free holes a–d)
    b.add({ id: 'BT1', type: 'hc05_bt', at: 'e44', params: { phone: true } })
    // BSS138 level shifter at g34: LV1 g34 LV2 g35 LV g36 GND g37 … / HV1 d34 HV2 d35 HV d36 GND2 d37 …
    b.add({ id: 'LS1', type: 'level_shifter_4ch', at: 'g34' })
    b.wire('j36', tap('3V3_2'), 'red') // LV = 3.3 V (the board's second 3V3 pin)
    b.toRail('j37', 'bot-') // GND
    b.wire('a36', 'a48', 'red') // HV = 5 V from the module's VCC strip
    b.wire('d44', 'c34', 'green') // STATE → HV1
    b.wire('d46', 'c35', 'white') // TXD → HV2
    b.wire('j34', tap('PB1'), 'green') // LV1 → PB1 (STATE)
    b.wire('j35', tap('PA3'), 'white') // LV2 → PA3 (USART2 RX)
    b.wire('d45', tap('PA2'), 'yellow') // RXD ← PA2 (USART2 TX)
    b.toRail('d47', 'top-') // GND
    b.toRail('b48', 'bot+') // VCC 5 V
    b.wire('d49', tap('PB0'), 'blue') // EN ← PB0
    b.add({ id: 'R1', type: 'resistor', holes: ['c49', b.rail('top+', 50)], params: { resistance: 10000 } })
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PA2', 'PA2 TX'), mcuChannel(1, 'PA3', 'PA3 RX'), mcuChannel(2, 'PB0', 'PB0 EN'), mcuChannel(3, 'PB1', 'PB1 STATE')],
    decoders: [
      { id: 'uart-tx', decoder: 'uart', channels: { data: 0 }, options: { baud: 'auto' } },
      { id: 'uart-rx', decoder: 'uart', channels: { data: 1 }, options: { baud: 'auto' } },
    ],
  },
  tray: 'uart',
  expect: { seconds: 1.0, uart: { USART1: 'HC-05 test\r\nAT ok (try 1)\r\n' } },
}
