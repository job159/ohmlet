import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'ds18b20-temp',
  order: 60,
  category: 'sensor',
  difficulty: 'advanced',
  title: 'DS18B20 數位溫度計（1-Wire）',
  summary: '開汲極 PB12 + 4.7 kΩ 上拉：讀取 64 位元 ROM 與 CRC，每秒轉換一次溫度（12 位元，750 ms）',
  description: [
    '1-Wire 匯流排只有一條資料線 DQ，所有裝置都是開汲極，靠一顆 4.7 kΩ 上拉電阻回到高電位。每個動作都從重置開始：MCU 拉低 480 µs 再放開，感測器回應存在脈波；之後以「時槽」傳送位元 —— 寫 0 拉低 60 µs、寫 1 只拉低幾 µs，讀取時 MCU 拉低 1–2 µs 後在 15 µs 內取樣。',
    '韌體以 DWT->CYCCNT 做微秒計時：開機時以 `READ ROM`（33h）讀出 64 位元 ROM 並驗證 CRC8，之後每秒 `SKIP ROM`（CCh）+ `CONVERT T`（44h），等待轉換完成（12 位元解析度約 750 ms），再以 `READ SCRATCHPAD`（BEh）讀 9 個位元組，檢查 CRC 後印出溫度與轉換時間。接線（TO-92 平面朝自己，左到右）：GND、DQ → PB12、VDD 接 3.3 V，R1 4.7 kΩ 從 DQ 接到 VDD。',
    '試試看：把 R1 拿掉 —— 匯流排永遠升不起來，韌體會回報可能少了上拉電阻；在屬性面板改變「溫度」；在邏輯分析儀上用 1-Wire 解碼器看重置、存在脈波與每個位元組。',
  ].join('\n\n'),
  tags: ['DS18B20', '1-Wire', '上拉電阻', 'CRC8', 'DWT'],
  glyph: 'ds18b20',
  firmware: 'hal-ds18b20',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // DS18B20 TO-92: GND f50, DQ f51, VDD f52; 4.7 kΩ pull-up DQ → VDD
    b.add({ id: 'TS1', type: 'ds18b20', holes: ['f50', 'f51', 'f52'], params: { temperature: 21.5 } })
    b.add({ id: 'R1', type: 'resistor', holes: ['h51', 'h54'], params: { resistance: 4700 } })
    b.wire('i54', 'i52', 'red') // pull-up to VDD
    b.toRail('j50', 'bot-')
    b.wire('j51', tap('PB12'), 'green') // DQ
    b.wire('j52', tap('3V3_2'), 'red') // VDD 3.3 V
    return b
  },
  logic: {
    channels: [mcuChannel(0, 'PB12', 'PB12 DQ')],
    decoders: [{ id: 'ow', decoder: 'onewire', channels: { data: 0 }, options: { speed: 'standard' } }],
  },
  tray: 'uart',
  expect: { seconds: 1.0, uart: { USART1: 'DS18B20 on PB12 (1-Wire, DWT timing)\r\nROM 28-' } },
}
