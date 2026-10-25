import { Bench } from './lib.mjs'

export default {
  id: 'opamp-amplifier',
  order: 30,
  category: 'analog',
  difficulty: 'intermediate',
  title: '運算放大器非反相放大（LM358）',
  summary: '增益 = 1 + Rf ÷ Rg = 3：1 kHz 正弦波從 1.0 ± 0.5 V 放大成 3.0 ± 1.5 V，示波器雙通道比較',
  description: [
    '非反相放大器把訊號接到運算放大器的 + 輸入，輸出經 Rf、Rg 分壓回授到 − 輸入。負回授讓兩個輸入電壓幾乎相等，於是 Vout × Rg ÷ (Rf + Rg) = Vin，增益 = 1 + Rf ÷ Rg。這裡 Rf = 20 kΩ、Rg = 10 kΩ，增益 3 倍，輸入阻抗很高、輸出和輸入同相位。',
    'LM358 是單電源運算放大器，以 9 V 供電，輸出大約只能擺到 0 V 與 VCC − 1.2 V 之間，所以輸入訊號帶有 1 V 直流偏移，放大後落在 1.5–4.5 V，不會被截掉。同一顆晶片的第二組運放沒有用到：好習慣是把它接成電壓隨耦器，+ 輸入接地，避免浮接振盪。',
    '試試看：把 FG1 的振幅調到 1.5 V，輸出頂到約 7.8 V 時被削平（飽和）；把 Rf 改成 90 kΩ（增益 10）；把頻率調高到 100 kHz 以上，觀察 LM358 有限的頻寬與迴轉率讓輸出變小、變形。',
  ].join('\n\n'),
  tags: ['運算放大器', 'LM358', '非反相放大', '負回授', '增益', '示波器'],
  glyph: 'lm358',
  firmware: null,
  simulation: 'full',
  build() {
    const b = new Bench()
    b.add({ id: 'PS1', type: 'power_supply', params: { voltage: 9 } })
    b.wire('PS1:+', b.takeRail('top+0'), 'red')
    b.wire('PS1:-', b.takeRail('top-0'), 'black')
    b.wire('PS1:-', b.takeRail('bot-0'), 'black')
    // LM358 at f30: OUT1 f30 IN1- f31 IN1+ f32 GND f33 / IN2+ e33 IN2- e32 OUT2 e31 VCC e30
    b.add({ id: 'U1', type: 'lm358', at: 'f30' })
    b.toRail('a30', 'top+') // VCC 9 V
    b.toRail('j33', 'bot-') // GND
    // unused second op-amp: voltage follower with IN2+ grounded
    b.wire('c31', 'c32', 'white') // OUT2 → IN2-
    b.toRail('a33', 'top-') // IN2+ → GND
    // feedback: Rf 20 kΩ OUT1 → node (strip 36), node → IN1-, Rg 10 kΩ node → GND
    b.add({ id: 'RF', type: 'resistor', holes: ['g30', 'g36'], params: { resistance: 20000 } })
    b.wire('h31', 'h36', 'blue')
    b.add({ id: 'RG', type: 'resistor', holes: ['i36', b.rail('bot-', 38)], params: { resistance: 10000 } })
    // input
    b.add({ id: 'FG1', type: 'function_generator', params: { waveform: 'sine', frequency: 1000, amplitude: 0.5, offset: 1.0 } })
    b.wire('FG1:out', 'j32', 'yellow')
    b.wire('FG1:gnd', b.rail('bot-', 30), 'black')
    b.add({ id: 'PRB1', type: 'scope_probe', holes: ['i32'], params: { channel: 1 } })
    b.add({ id: 'PRB2', type: 'scope_probe', holes: ['i30'], params: { channel: 2 } })
    return b
  },
  tray: 'scope',
  // two scope channels and their measurement rows: a tray tall enough for a ≥ 160 px plot (UX QA IS-F18)
  trayHeight: 340,
  expect: { seconds: 0.5 },
}
