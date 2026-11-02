import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'ky040-encoder',
  order: 20,
  category: 'sensor',
  difficulty: 'intermediate',
  title: 'KY-040 旋轉編碼器（計時器編碼器模式）',
  summary: 'TIM4 以硬體解碼正交訊號：每轉一格印出目前位置，按下旋鈕也會回報',
  description: [
    '旋轉編碼器的 CLK、DT 兩個接點輪流導通，形成相位差 90° 的兩組方波（正交訊號）：順時針時 CLK 先變化，逆時針時 DT 先變化。STM32 的通用計時器內建編碼器模式，韌體把 TIM4 設成 TI12 模式（PB6 = CH1 = CLK、PB7 = CH2 = DT，加上輸入濾波），計數器會自動加減 —— 每一格是完整的一個週期、計數 4 次。主迴圈讀 TIM4->CNT，換算成格數有變化就印出 `pos=N`；PB12 讀按鍵（內部上拉、20 ms 去彈跳）。',
    '接線：模組 + 接 3.3 V（CLK、DT 的上拉電阻在模組上），GND 接地，CLK → PB6、DT → PB7、SW → PB12。',
    '試試看：模擬執行時在屬性面板把「位置」改成 5 或 −3，模組會以真實的正交波形轉過去；打開「保持按下」讓旋鈕一直按著（或在 3D 畫面按住旋鈕）；在邏輯分析儀上比較順時針與逆時針時 CLK 與 DT 的先後。',
  ].join('\n\n'),
  tags: ['旋轉編碼器', 'KY-040', 'TIM4', '編碼器模式', '正交訊號'],
  glyph: 'ky040_encoder',
  firmware: 'hal-ky040',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // KY-040 at f40: CLK f40 DT f41 SW f42 + f43 GND f44 (the board covers rows a–e)
    b.add({ id: 'ENC1', type: 'ky040_encoder', at: 'f40', params: { turnRate: 20 } })
    b.wire('j40', tap('PB6'), 'yellow') // CLK
    b.wire('j41', tap('PB7'), 'blue') // DT
    b.wire('j42', tap('PB12'), 'green') // SW
    b.wire('j43', tap('3V3_2'), 'red') // + 3.3 V
    b.toRail('i44', 'bot-')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PB6', 'PB6 CLK'), mcuChannel(1, 'PB7', 'PB7 DT'), mcuChannel(2, 'PB12', 'PB12 SW')] },
  tray: 'uart',
  expect: { seconds: 0.5 },
}
