import { Bench } from './lib.mjs'

export default {
  id: 'rc-lowpass',
  order: 20,
  category: 'analog',
  difficulty: 'beginner',
  title: 'RC 低通濾波與時間常數',
  summary: '10 kΩ + 100 nF：τ = 1 ms、截止頻率約 159 Hz；用示波器同時看方波輸入與電容的充放電曲線',
  description: [
    '電阻與電容串聯，從電容兩端取出電壓，就是最簡單的低通濾波器。輸入突然升高時，電容經電阻充電，電壓依指數曲線上升：經過一個時間常數 τ = R × C 到達 63 %，5τ 後超過 99 %。頻率越高，電容來不及充放電，輸出振幅就越小；截止頻率 fc = 1 ÷ (2π R C)，這裡約 159 Hz。',
    '電路：函數產生器 FG1 輸出 100 Hz、0–5 V 方波（振幅 2.5 V、直流偏移 2.5 V），經 R1（10 kΩ）接 C1（100 nF）到地。示波器 CH1 量輸入、CH2 量電容電壓。直流電源 PS1 只提供電路的接地參考點（函數產生器與示波器共地），正端不需要接任何東西。',
    '試試看：在屬性面板把 FG1 的頻率調到 1 kHz，CH2 變成小振幅的三角波；改成 10 Hz 則幾乎和輸入一樣；把波形改成正弦波，比較 159 Hz 時輸出振幅約為輸入的 71 %（−3 dB）。',
  ].join('\n\n'),
  tags: ['RC 電路', '低通濾波', '時間常數', '截止頻率', '示波器'],
  glyph: 'capacitor',
  firmware: null,
  simulation: 'full',
  build() {
    const b = new Bench()
    b.add({ id: 'PS1', type: 'power_supply', params: { voltage: 5 } })
    b.wire('PS1:-', b.takeRail('top-0'), 'black')
    b.add({ id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 100, amplitude: 2.5, offset: 2.5 } })
    b.wire('FG1:out', 'a10', 'yellow')
    b.wire('FG1:gnd', b.rail('top-', 4), 'black')
    b.add({ id: 'R1', type: 'resistor', holes: ['b10', 'b20'], params: { resistance: 10000 } })
    b.add({ id: 'C1', type: 'capacitor', holes: ['c20', b.rail('top-', 22)], params: { capacitance: 1e-7 } })
    b.add({ id: 'PRB1', type: 'scope_probe', holes: ['e10'], params: { channel: 1 } })
    b.add({ id: 'PRB2', type: 'scope_probe', holes: ['e20'], params: { channel: 2 } })
    return b
  },
  tray: 'scope',
  // two scope channels and their measurement rows: a tray tall enough for a ≥ 160 px plot (UX QA IS-F18)
  trayHeight: 340,
  expect: { seconds: 0.5 },
}
