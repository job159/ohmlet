/**
 * zh-TW strings of the honesty-of-numbers fixes (owner: truth):
 *  - the app's ONE LED brightness scale (F4, src/instruments/led-light.ts):
 *    brightness = I / the rated 20 mA, always with the LED current —
 *    「20 %（4.07 mA）」, 「106 %（21.1 mA，超過額定 20 mA）」 — in the
 *    inspector, the 3D LED labels and the lesson checks;
 *  - the inspector's damage banners (src/ui/embedded/DamageBanner.tsx),
 *    titled like the Problems rows (「R2 燒斷了」, 「C1 反接爆開」,
 *    「R1 功率超過額定」) and the 「溫度（相對額定）」 live value; an RGB LED's
 *    burned die (「紅色晶粒電流太大燒毀了：燒毀的晶粒仍會導通…」).
 * Keys are the English sources passed to t(). Terms follow the canonical
 * table (docs/ux/UX_VERIFY.md §5.4): 重置模擬; full-width punctuation.
 */
const zh: Record<string, string> = {
  // ---- LED brightness with its current (F4) ----
  '{light} ({current})|led': '{light}（{current}）',
  '{light} ({current}, above the rated {rated})|led': '{light}（{current}，超過額定 {rated}）',
  '0 % (burned out)|led': '0 %（已燒毀）',
  // an RGB LED that emits nothing while one of its dies is burned (a burned die still conducts)
  '0 % (a die burned out)|led': '0 %（有晶粒燒毀）',
  'above the rated {rated}|led': '超過額定 {rated}',
  // a lesson check's expected brightness with the currents it means: 「25 % – 150 %，即 5 mA – 30 mA」
  '{range}, i.e. {currents}|led-range': '{range}，即 {currents}',

  // ---- live values ----
  'Temperature (relative to rated)': '溫度（相對額定）',
  '{x}× rated|heat': '{x} 倍',

  // ---- damage banners ----
  '{id} burned out|banner': '{id} 已燒毀', // = the Problems row 「LED1 已燒毀」
  'Too much current overheated its junction and burned it open: it no longer conducts or lights. Add a series resistor that keeps the current under {rated}; after you change the circuit or press “Reset simulation”, the simulated LED works again.':
    '電流太大，接面過熱燒斷，現在不導電也不會亮。請串聯限流電阻，讓電流低於 {rated}；修改電路或按「重置模擬」後，模擬中的 LED 就會恢復。',
  // an RGB LED: a burned die keeps conducting but stays dark, the others still light
  'red|die': '紅色',
  'green|die': '綠色',
  'blue|die': '藍色',
  '{a} and {b}|die-list': '{a}與{b}',
  ', |die-list': '、',
  'Its {dies} die burned out from too much current: a burned die still conducts but no longer lights; the other dies still work. Give each die its own series resistor that keeps its current under {rated}; after you change the circuit or press “Reset simulation”, the simulated LED works again.':
    '{dies}晶粒電流太大燒毀了：燒毀的晶粒仍會導通，但不再發光；其他晶粒照常發光。請替每個晶粒串聯各自的限流電阻，讓電流低於 {rated}；修改電路或按「重置模擬」後，模擬中的 LED 就會恢復。',
  'One of its dies burned out from too much current: a burned die still conducts but no longer lights; the other dies still work. Give each die its own series resistor that keeps its current under {rated}; after you change the circuit or press “Reset simulation”, the simulated LED works again.':
    '有晶粒電流太大燒毀了：燒毀的晶粒仍會導通，但不再發光；其他晶粒照常發光。請替每個晶粒串聯各自的限流電阻，讓電流低於 {rated}；修改電路或按「重置模擬」後，模擬中的 LED 就會恢復。',
  '{id} is overheating|banner': '{id} 正在過熱',
  '{current} is far above its rated {rated}: its junction is hotter than 100 °C, and at about 150 °C it burns out. Use a larger series resistor.':
    '電流 {current} 遠超過額定 {rated}：接面溫度已超過 100 °C，到約 150 °C 就會燒毀。請加大串聯電阻。',
  'rated|power': '額定',
  '{id} burned open|banner': '{id} 燒斷了',
  'It dissipated many times its {max} rating until its film overheated and burned through: it no longer conducts. Use a larger resistance or a higher-wattage resistor; after you change the circuit or press “Reset simulation”, the simulated resistor works again (a real one has to be replaced).':
    '它承受了好幾倍於額定 {max} 的功率，電阻膜過熱燒穿，現在不導電。請改用阻值更大或瓦數更高的電阻；修改電路或按「重置模擬」後，模擬中的電阻就會恢復（真實的電阻只能更換）。',
  '{id} power above its rating|banner': '{id} 功率超過額定',
  'It dissipates {p}, above its {max} rating, and keeps heating up — it smokes; a sustained gross overload burns it open. Use a larger resistance or a higher-wattage resistor.':
    '它消耗 {p}，超過額定 {max}，正在發熱冒煙；持續嚴重過載會燒斷。請改用阻值更大或瓦數更高的電阻。',
  '{id} vented (reversed)|banner': '{id} 反接爆開',
  'Its + lead sat more than 1 V below its − lead, and a reversed electrolytic capacitor heats up until its pressure vent opens. A real one is ruined (it loses capacitance and may short); the simulation keeps its value. Turn it around so + goes to the higher voltage; after you change the circuit or press “Reset simulation”, the simulated capacitor works again.':
    '它的 + 腳比 − 腳低了超過 1 V，反接的電解電容會發熱，直到頂部的洩壓閥爆開。實際的電容已經損壞（容量流失，還可能短路），模擬仍沿用原本的容值。請把它轉過來讓 + 腳接較高的電壓；修改電路或按「重置模擬」後，模擬中的電容就會恢復。',
}
export default zh
