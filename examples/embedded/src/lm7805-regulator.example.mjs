import { Bench } from './lib.mjs'

export default {
  id: 'lm7805-regulator',
  order: 40,
  category: 'analog',
  difficulty: 'beginner',
  title: 'LM7805 線性穩壓電源',
  summary: '9 V 電池經 LM7805 穩壓成 5 V：輸入、輸出電容、指示 LED，電錶量測輸出電壓',
  description: [
    'LM7805 是最經典的三端線性穩壓器：IN 輸入 7–35 V，OUT 輸出穩定的 5 V，GND 接地。它像一個自動調整的可變電阻，把多出來的電壓 (VIN − 5 V) × I 變成熱量散掉，所以輸入至少要比輸出高約 2 V（壓降），電流大時還需要散熱片。',
    '電路：9 V 電池接 IN，IN 與 GND 之間並 0.33 µF、OUT 與 GND 之間並 0.1 µF —— 資料手冊建議的電容，讓穩壓器在負載變化時保持穩定。輸出經 330 Ω 點亮綠色 LED（約 9 mA），數位電錶 DMM1 切在電壓檔，量測輸出端對地的電壓。',
    '試試看：在屬性面板把電池電壓往下調，低於約 7 V 時輸出開始跟著下降（壓降不足）；把 LED 的限流電阻改小，看電池電流與穩壓器的功率損耗增加。',
  ].join('\n\n'),
  tags: ['穩壓器', 'LM7805', '線性穩壓', '壓降', '電錶', '電池'],
  glyph: 'lm7805',
  firmware: null,
  simulation: 'full',
  build() {
    const b = new Bench()
    b.add({ id: 'BAT1', type: 'battery_9v' })
    b.wire('BAT1:-', b.takeRail('top-0'), 'black')
    b.wire('BAT1:+', 'a40', 'red') // IN
    // LM7805 TO-220: IN c40, GND c41, OUT c42 (its body overhangs c39 / c43)
    b.add({ id: 'U1', type: 'lm7805', holes: ['c40', 'c41', 'c42'] })
    b.toRail('a41', 'top-') // GND
    b.add({ id: 'C1', type: 'capacitor', holes: ['d40', 'd41'], params: { capacitance: 3.3e-7 } }) // input 0.33 µF
    b.add({ id: 'C2', type: 'capacitor', holes: ['b42', 'b41'], params: { capacitance: 1e-7 } }) // output 0.1 µF
    b.toRail('a42', 'top+') // OUT → top + rail = regulated 5 V
    b.add({ id: 'R1', type: 'resistor', holes: [b.rail('top+', 48), 'a50'], params: { resistance: 330 } })
    b.add({ id: 'LED1', type: 'led', holes: ['b50', b.rail('top-', 50)], params: { color: 'green' } })
    b.add({ id: 'DMM1', type: 'multimeter', params: { mode: 'V' } })
    b.wire('DMM1:IN', 'e42', 'red')
    b.wire('DMM1:COM', b.rail('top-', 44), 'black')
    return b
  },
  expect: { seconds: 0.5 },
}
