import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'hcsr04-distance',
  order: 40,
  category: 'sensor',
  difficulty: 'intermediate',
  title: 'HC-SR04 超音波測距',
  summary: 'PB12 送出 12 µs 觸發脈波，TIM4 輸入捕捉量 ECHO 高電位寬度，每 100 ms 印出距離',
  description: [
    'HC-SR04 收到 10 µs 以上的 TRIG 脈波後發出 8 個 40 kHz 超音波脈衝，ECHO 腳隨即變高，直到收到回波才變低；高電位的時間就是聲波來回的時間。距離（cm）= 時間（µs）× 0.0343 ÷ 2，大約是 t ÷ 58。',
    '韌體用 TIM4 以 1 MHz 計數，CH1 在上升緣、CH2 在下降緣捕捉同一支腳（PB6，CH2 設為間接輸入 TI1），兩者相減就是脈寬，硬體量測不受中斷延遲影響。接線：VCC 接 5 V，TRIG ← PB12，ECHO → PB6，GND。ECHO 是 5 V 訊號，PB6 是 5 V 容忍（FT）腳位，所以可以直接相連 —— 改接 PA0 這類非 FT 腳位，ERC 會提出錯誤。',
    '試試看：模擬執行時在屬性面板改變「與障礙物距離」與「空氣溫度」（氣溫會影響音速），看讀數的變化；超過 4 m 時韌體會回報 `out of range`。',
  ].join('\n\n'),
  tags: ['超音波', 'HC-SR04', '輸入捕捉', 'TIM4', '5 V 容忍'],
  glyph: 'hcsr04',
  firmware: 'hal-hcsr04',
  simulation: 'partial',
  simulationNote: '聲波傳播不模擬：模組依屬性面板的距離與氣溫計算回波時間，再以真實的 TRIG / ECHO 時序與 Blue Pill 互動。',
  build() {
    const b = bluePillBench()
    // HC-SR04 standing at f40: VCC f40 TRIG f39 ECHO f38 GND f37 (transducers over rows c–f)
    b.add({ id: 'US1', type: 'hcsr04', at: 'f40', params: { distance: 100, temperature: 20 } })
    b.toRail('j40', 'bot+') // VCC 5 V
    b.wire('j39', tap('PB12'), 'green') // TRIG
    b.wire('j38', tap('PB6'), 'yellow') // ECHO
    b.toRail('j37', 'bot-')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PB12', 'PB12 TRIG'), mcuChannel(1, 'PB6', 'PB6 ECHO')] },
  tray: 'uart',
  expect: { seconds: 0.5, uart: { USART1: 'HC-SR04: TRIG PB12, ECHO PB6 (TIM4 CH1/CH2 capture)\r\nd=99.9 cm' } },
}
