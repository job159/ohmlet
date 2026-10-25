import { Bench } from './lib.mjs'

export default {
  id: 'npn-switch',
  order: 10,
  category: 'analog',
  difficulty: 'beginner',
  title: '電晶體開關（NPN）',
  summary: '小小的基極電流控制大一些的集極電流：按下按鈕，NPN 電晶體導通點亮 LED',
  description: [
    'MCU 的腳位或按鈕只能提供幾 mA，要開關較大的負載（LED 陣列、繼電器、蜂鳴器）就得靠電晶體。NPN 電晶體當開關時：基極電流 IB 流入，集極到射極就導通；只要 IB 大於 IC ÷ β（β 是電流放大率），電晶體就進入飽和，C-E 之間只剩約 0.1–0.2 V 的壓降。',
    '電路：按鈕按下時，5 V 經 R1（10 kΩ）送入基極，IB ≈ (5 − 0.7) ÷ 10 kΩ ≈ 0.43 mA；集極接 LED 與 R3（330 Ω），IC ≈ (5 − 2 − 0.2) ÷ 330 ≈ 8.5 mA，只需要 β ≥ 20 就會飽和，一般小訊號電晶體綽綽有餘。R2（100 kΩ）把基極拉到地，按鈕放開時電晶體確實關閉，不會因為基極浮接而亂亮。',
    '試試看：模擬執行時按住按鈕（屬性面板的「按下」），LED 亮起；把 R1 改成 1 MΩ，基極電流太小、電晶體進不了飽和，LED 會變暗；在屬性面板查看電晶體各腳的電壓。',
  ].join('\n\n'),
  tags: ['NPN', '電晶體', '開關', '飽和', '基極電阻'],
  glyph: 'npn',
  firmware: null,
  simulation: 'full',
  build() {
    const b = new Bench()
    b.add({ id: 'PS1', type: 'power_supply', params: { voltage: 5 } })
    b.wire('PS1:+', b.takeRail('top+0'), 'red')
    b.wire('PS1:-', b.takeRail('top-0'), 'black')
    // push-button at f20: A1 f20 / A2 e20 (A side), B1 f22 / B2 e22 (B side)
    b.add({ id: 'SW1', type: 'pushbutton', at: 'f20' })
    b.toRail('a20', 'top+') // A side → 5 V
    b.add({ id: 'R1', type: 'resistor', holes: ['c22', 'c27'], params: { resistance: 10000 } }) // base resistor
    // Q1: emitter d26, base d27, collector d28
    b.add({ id: 'Q1', type: 'npn', holes: ['d26', 'd27', 'd28'] })
    b.add({ id: 'R2', type: 'resistor', holes: ['b27', b.rail('top-', 30)], params: { resistance: 100000 } }) // base pull-down
    b.toRail('a26', 'top-') // emitter → GND
    b.add({ id: 'LED1', type: 'led', holes: ['b34', 'b28'], params: { color: 'green' } }) // anode strip 34, cathode → collector
    b.add({ id: 'R3', type: 'resistor', holes: ['c34', b.rail('top+', 36)], params: { resistance: 330 } })
    return b
  },
  expect: { seconds: 0.5 },
}
