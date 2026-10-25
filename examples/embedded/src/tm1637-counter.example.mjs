import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'tm1637-counter',
  order: 60,
  category: 'display',
  difficulty: 'intermediate',
  title: 'TM1637 四位數七段顯示器計數',
  summary: '以開汲極 GPIO 模擬 TM1637 的兩線協定：0000–9999 每 100 ms 加一，冒號每秒閃爍',
  description: [
    'TM1637 的兩線介面看起來像 I²C，但沒有位址、而且位元組是 LSB 先送，所以韌體用 GPIO 自己一個位元一個位元產生波形：PB6 = CLK、PB7 = DIO，設定為開汲極輸出，靠模組上的 10 kΩ 上拉電阻回到高電位。每個位元組送完後的第 9 個時脈，TM1637 會把 DIO 拉低表示 ACK，韌體逐一檢查。命令順序：40h（位址自動加一）→ C0h + 四個字的段碼 → 88h–8Fh（開顯示 + 亮度）。',
    '接線：CLK → PB6、DIO → PB7，VCC 接 5 V、GND 接地。為什麼要用開汲極？TM1637 在 5 V 供電時，輸入高電位門檻是 3.5 V，推挽輸出的 3.3 V 不夠；開汲極輸出只負責拉低，高電位由模組的上拉電阻拉到 5 V。PB6、PB7 是 5 V 容忍（FT）腳位，承受得了。ERC 會以「風險」提醒這件事（它無法得知韌體設定的是推挽還是開汲極）—— 這正是本範例要說明的重點。',
    '試試看：把 CLK 與 DIO 兩條線對調，韌體收不到 ACK，終端機會印出接線檢查提示；在邏輯分析儀上看 START（CLK 高時 DIO 下降）與第 9 個時脈的 ACK。',
  ].join('\n\n'),
  tags: ['TM1637', '七段顯示器', 'GPIO 模擬協定', '開汲極', 'ACK'],
  glyph: 'tm1637_4digit',
  firmware: 'hal-tm1637',
  simulation: 'full',
  // CLK / DIO at 5 V vs. a 3.3 V push-pull high: the firmware uses open drain (explained above)
  ercRisks: ['logic-level'],
  build() {
    const b = bluePillBench()
    // TM1637 module at j40: CLK j40 DIO j41 VCC j42 GND j43 (lies over the front edge)
    b.add({ id: 'TM1', type: 'tm1637_4digit', at: 'j40' })
    b.wire('g40', tap('PB6'), 'yellow') // CLK
    b.wire('g41', tap('PB7'), 'blue') // DIO
    b.toRail('f42', 'bot+')
    b.toRail('f43', 'bot-')
    return b
  },
  logic: { channels: [mcuChannel(0, 'PB6', 'PB6 CLK'), mcuChannel(1, 'PB7', 'PB7 DIO')] },
  tray: 'uart',
  expect: { seconds: 1.2, uart: { USART1: 'TM1637 counter demo\r\nTM1637 ready\r\ncount 10\r\n' } },
}
