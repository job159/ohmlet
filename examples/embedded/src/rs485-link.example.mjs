import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'rs485-link',
  order: 60,
  category: 'serial',
  difficulty: 'advanced',
  title: 'RS-485 半雙工連線（MAX485 ×2）',
  summary: '兩個 MAX485 模組共用一對差動匯流排：USART1 發問、USART3 回應，結果印在 USART2',
  description: [
    'RS-485 用 A / B 兩條線傳送差動訊號，抗雜訊、可拉到上千公尺，多個節點共用一對線，因此同一時間只能有一個節點發送（半雙工）。每個 MAX485 的 DE（發送致能）與 RE（接收致能，低電位有效）接在一起，由一支 GPIO 切換方向：高電位發送、低電位接收。',
    '同一塊 Blue Pill 扮演兩個節點：節點 A 用 USART1（TX PA9、RX PA10、方向 PA8），節點 B 用 USART3（TX PB10、RX PB11、方向 PB12）。韌體跑 3 回合 `PING` / `PONG` 問答：發送前拉高 DE，等最後一個位元組的停止位元送完（TC 旗標）才放開匯流排。結果印在 USART2（PA2）—— 終端機請選 USART2。',
    'MAX485 需要 5 V，所以這個範例把上方電源軌也接到 5 V 電源。RO 輸出 5 V 進 PA10 / PB11，兩者都是 5 V 容忍（FT）腳位。兩個模組板上的 120 Ω 終端電阻（R7）都保留，匯流排兩端各一顆。試試看：在屬性面板取消兩個模組的「已裝 120 Ω 終端電阻（R7）」，連線仍然成功，但模擬日誌會提醒匯流排沒有終端。',
  ].join('\n\n'),
  tags: ['RS-485', 'MAX485', '半雙工', 'USART3', '差動訊號', '終端電阻'],
  glyph: 'max485_module',
  firmware: 'hal-rs485',
  simulation: 'full',
  build() {
    const b = bluePillBench({ top: 'supply' })
    // node A: MAX485 at h34 — RO h34, RE h35, DE h36, DI h37 / VCC c34, B c35, A c36, GND c37
    b.add({ id: 'M1', type: 'max485_module', at: 'h34', params: { termination: true } })
    b.wire('j34', tap('PA10'), 'white') // RO → USART1 RX
    b.wire('i35', 'i36', 'green') // RE + DE together
    b.wire('j36', tap('PA8'), 'green') // DE/RE ← PA8
    b.wire('j37', tap('PA9'), 'yellow') // DI ← USART1 TX
    b.toRail('a34', 'top+')
    b.toRail('a37', 'top-')
    // node B: MAX485 at h40
    b.add({ id: 'M2', type: 'max485_module', at: 'h40', params: { termination: true } })
    b.wire('j40', tap('PB11'), 'white') // RO → USART3 RX
    b.wire('i41', 'i42', 'green')
    b.wire('j42', tap('PB12'), 'green') // DE/RE ← PB12
    b.wire('j43', tap('PB10'), 'yellow') // DI ← USART3 TX
    b.toRail('a40', 'top+')
    b.toRail('a43', 'top-')
    // the bus: A–A and B–B
    b.wire('b36', 'b42', 'blue')
    b.wire('b35', 'b41', 'white')
    return b
  },
  logic: {
    channels: [
      mcuChannel(0, 'PA9', 'A TX'),
      mcuChannel(1, 'PA8', 'A DE'),
      mcuChannel(2, 'PB10', 'B TX'),
      mcuChannel(3, 'PB12', 'B DE'),
    ],
    decoders: [
      { id: 'uart-a', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } },
      { id: 'uart-b', decoder: 'uart', channels: { data: 2 }, options: { baud: '115200' } },
    ],
  },
  tray: 'uart',
  expect: {
    seconds: 0.5,
    uart: {
      USART2:
        'RS-485 ping-pong: A=USART1 (DE PA8) <-> B=USART3 (DE PB12), 115200 8N1\r\n' +
        "round 1: B got 'PING 1', A got 'PONG 1'\r\n" +
        "round 2: B got 'PING 2', A got 'PONG 2'\r\n" +
        "round 3: B got 'PING 3', A got 'PONG 3'\r\n" +
        'rs485 ok\r\n',
    },
  },
}
