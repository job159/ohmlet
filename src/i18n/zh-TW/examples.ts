/**
 * zh-TW strings for the example library (src/ui/workspace/examples.ts, the
 * desktop Examples tab in LibraryPanel and the phone More sheet's Examples
 * groups): section names, difficulty and instrument names, the library UI,
 * and the legacy example circuits' summaries / descriptions. The generated
 * examples (examples/embedded) carry their zh-TW content themselves.
 * Keys are the English sources passed to t() / tc() ("source|context").
 */
const zh: Record<string, string> = {
  // ---- sections (EXAMPLE_CATEGORY_NAMES, tc(…, 'example category')) ----
  'GPIO, timers & PWM|example category': 'GPIO、計時器與 PWM',
  'Serial buses & links|example category': '序列匯流排與通訊',
  'Displays|example category': '顯示器',
  'Sensors & input|example category': '感測器與輸入',
  'Motors & actuators|example category': '馬達與致動器',
  'Analog & logic classics|example category': '經典類比與邏輯電路',

  // ---- difficulty (EXAMPLE_DIFFICULTY_NAMES, tc(…, 'difficulty')) ----
  'Beginner|difficulty': '初級',
  'Intermediate|difficulty': '中級',
  'Advanced|difficulty': '進階',

  // ---- instruments (EXAMPLE_INSTRUMENT_NAMES, tc(…, 'example instrument')) ----
  'UART terminal|example instrument': 'UART 終端機',
  'Logic analyzer|example instrument': '邏輯分析儀',
  'Oscilloscope|example instrument': '示波器',

  // ---- library UI (LibraryPanel Examples tab, MoreSheet Examples groups) ----
  'Search examples, chips and tags': '搜尋範例、晶片或標籤',
  'Search the example library': '搜尋範例庫',
  'Example category': '範例分類',
  'All categories': '全部分類',
  'Example difficulty': '範例難度',
  'Any difficulty': '任何難度',
  '{n} example': '{n} 個範例',
  '{n} examples': '{n} 個範例',
  'No examples match “{q}”.': '沒有符合「{q}」的範例。',
  'No examples match these filters.': '沒有符合篩選條件的範例。',
  'Show details of “{title}”': '顯示「{title}」的說明',
  'Hide details of “{title}”': '隱藏「{title}」的說明',
  'Open example': '開啟範例',
  'Open “{title}”': '開啟「{title}」',
  'Opening…': '開啟中…',
  'Opened “{title}”': '已開啟「{title}」',
  'Opened “{title}” — firmware not loaded: {error}': '已開啟「{title}」，但韌體沒有載入：{error}',
  'Couldn’t open example: {error}': '無法開啟範例：{error}',
  'Replace the current circuit?': '要取代目前的電路嗎？',
  '“{title}” replaces the circuit on the board (undo brings it back) and the loaded firmware.':
    '「{title}」會取代麵包板上目前的電路（可用「復原」找回）以及已載入的韌體。',
  'Opening an example replaces the current circuit and its firmware. Every example runs on the real simulation; the firmware examples carry the exact ELF built from their CubeIDE-style projects.':
    '開啟範例會取代目前的電路與韌體。每個範例都在真實的模擬中執行；韌體範例內含由對應的 CubeIDE 風格專案建置出來的 ELF 檔。',
  'Difficulty: {level}': '難度：{level}',
  '{difficulty} · {summary}': '{difficulty} · {summary}',
  'Firmware: {file} · {size} KB': '韌體：{file} · {size} KB',
  'No firmware — analog circuit': '不需要韌體（類比電路）',
  'Instruments': '儀器',
  'Not simulated': '未模擬的部分',
  'Tags': '標籤',
  '{parts} parts · {wires} wires': '{parts} 個元件 · {wires} 條導線',

  // ---- legacy example circuits (examples/*.json; LEGACY_META) ----
  'An NE555 astable flashes an LED at about 1.5 Hz.': 'NE555 無穩態振盪讓 LED 以約 1.5 Hz 閃爍。',
  'The classic first IC circuit: two resistors and a capacitor set the 555 astable frequency, its output drives an LED through a series resistor. A scope probe sits on the output — open the oscilloscope to see the square wave and measure its period.':
    '最經典的第一個 IC 電路：兩顆電阻和一顆電容決定 555 無穩態振盪的頻率，輸出經串聯電阻驅動 LED。輸出端已放好示波器探棒 —— 打開示波器就能看到方波並量測週期。',
  'DIP switches and CD4511 decoders spell a date on four 7-segment displays.': '指撥開關與 CD4511 解碼器在四個七段顯示器上顯示日期。',
  'Each digit is a BCD code set on DIP switches, decoded by a CD4511 into segment drive for a common-cathode display. Flip the switches while the simulation runs and watch the digits change.':
    '每一位數字都是用指撥開關設定的 BCD 碼，由 CD4511 解碼成共陰極七段顯示器的段驅動訊號。模擬執行時切換開關，看數字跟著改變。',
  'A 555 clock drives a CD4026 counter and its 7-segment display; a button resets it.': '555 時脈驅動 CD4026 計數器與七段顯示器；按鈕可以歸零。',
  'The 555 produces about 2 pulses per second, the CD4026 counts them and decodes the count straight to the display segments. Hold the reset button to return to 0.':
    '555 每秒產生約 2 個脈波，CD4026 計數並直接解碼成顯示器的各段。按住重置按鈕就會回到 0。',
  'A photoresistor divider and an LM358 comparator switch an LED on in the dark.': '光敏電阻分壓與 LM358 比較器：天黑時點亮 LED。',
  'The LDR and a 10 kΩ resistor form a divider that rises in the dark; the LM358 compares it with the threshold set by a potentiometer and lights the LED. Drag the light slider of the LDR and turn the pot to move the trip point.':
    '光敏電阻與 10 kΩ 電阻組成分壓器，光線越暗電壓越高；LM358 把它和可變電阻設定的門檻比較，超過門檻就點亮 LED。拖動光敏電阻的亮度滑桿、轉動可變電阻來調整切換點。',
}

export default zh
