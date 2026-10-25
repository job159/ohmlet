import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'dht22-climate',
  order: 50,
  category: 'sensor',
  difficulty: 'intermediate',
  title: 'DHT22 溫濕度感測器',
  summary: '單線協定：開汲極 PB12 送出起始脈波，以 DWT 週期計數器量測 40 個位元，每 2.5 秒印出濕度與溫度',
  description: [
    'DHT22（AM2302）只用一條資料線：MCU 先把線拉低至少 1 ms 再放開，感測器回應 80 µs 低 + 80 µs 高，接著送出 40 個位元 —— 每個位元以約 50 µs 低開頭，之後高約 27 µs 代表 0、約 70 µs 代表 1。前兩個位元組是濕度 ×10、接著兩個是溫度 ×10（最高位元是負號），最後是檢查碼。',
    '韌體把 PB12 設成開汲極輸出（放開時就能讀取線上的電位），用 Cortex-M3 內建的 DWT->CYCCNT（72 MHz 週期計數器）做微秒計時，讀取期間關閉中斷避免時序被打斷。感測器上電後 2 秒內不理會匯流排，所以開機 2.5 秒後才第一次讀取，之後每 2.5 秒一次。接線：VCC 接 3.3 V，DATA → PB12，GND；資料線的 10 kΩ 上拉電阻已焊在模組上。',
    '試試看：在屬性面板改變「溫度」與「相對濕度」 —— 讀數會晚一次才更新，因為 DHT22 每次送出的是「上一次」量測的結果；在邏輯分析儀上量起始脈波與 0 / 1 位元的高電位寬度。',
  ].join('\n\n'),
  tags: ['DHT22', 'AM2302', '溫濕度', '單線協定', 'DWT', '開汲極'],
  glyph: 'dht22',
  firmware: 'hal-dht',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // DHT22 module at f40: VCC f40 DATA f41 GND f42 (the board covers rows a–f)
    b.add({ id: 'DHT1', type: 'dht22', at: 'f40', params: { temperature: 23.4, humidity: 56.7 } })
    b.wire('j40', tap('3V3_2'), 'red') // VCC 3.3 V
    b.wire('j41', tap('PB12'), 'green') // DATA
    b.toRail('j42', 'bot-')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PB12', 'PB12 DATA')] },
  tray: 'uart',
  expect: { seconds: 0.5 },
}
