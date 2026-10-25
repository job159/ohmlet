/**
 * zh-TW strings of the UX fix wave's inspector workstream (docs/ux/UX_VERIFY.md
 * §7.2 IN-13 … IN-21): one fact per problem row and its canonical wording,
 * readings that cannot be trusted folded under their root cause, the live
 * rules' honest MCU states, transient warnings the live readings retracted,
 * reversed LEDs / floating rails, the problem → part links and the MCU
 * panel's keys, tab and PWM readings.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage (UX_VERIFY.md §5.4): 韌體、程式、檔案、記憶體、預設、訊號、
 * 執行、設定、網路、腳位、電源軌、工作週期、在電路板上標示、還沒有韌體、探棒。
 */
const zh: Record<string, string> = {
  // ---- one fact, one row (problems.ts IN-13) ----
  'Until then the board is simulated electrically only.': '在那之前，開發板只以電氣方式模擬。',
  '{id} has no firmware yet — pick a built-in firmware or load one from your computer': '{id} 還沒有韌體——請選一個內建韌體或從電腦載入',
  'and {n} more': '另 {n} 個',
  'See every problem': '查看全部問題',

  // ---- readings that cannot be trusted (IN-14) ----
  'Hidden readings': '已隱藏的讀數',
  'Because {id}’s GND is not connected, the circuit has no reference point, so the pin voltages cannot be computed ({n} pin readings hidden).':
    '因為 {id} 的 GND 沒接，電路沒有參考點，各腳位電壓無法計算（已隱藏 {n} 則腳位讀數）。',
  'Because {id} has no power, its pin voltages cannot be computed ({n} pin readings hidden).': '因為 {id} 沒有供電，各腳位電壓無法計算（已隱藏 {n} 則腳位讀數）。',
  'With no power source the circuit has no reference point, so the pin voltages cannot be computed ({n} pin readings hidden).':
    '電路中沒有電源，也就沒有參考點，各腳位電壓無法計算（已隱藏 {n} 則腳位讀數）。',
  'The pin voltages cannot be computed ({n} pin readings hidden).': '各腳位電壓無法計算（已隱藏 {n} 則腳位讀數）。',
  'The simulator cannot solve the circuit while this fault is there, so its readings are hidden ({n}).':
    '這個錯誤存在時，模擬器無法求解電路，相關讀數已隱藏（{n} 則）。',
  'The simulator cannot solve the circuit while this fault is there, so its readings may be wrong.': '這個錯誤存在時，模擬器無法求解電路，讀數可能不正確。',
  '≈ 0 A (no load)': '≈ 0 A（未接負載）',
  '≈ 0 W': '≈ 0 W',
  'Output voltage · no load': '輸出電壓 · 未接負載',

  // ---- live rules know the MCU's state (IN-15) ----
  'Consequences (fix first: {what})': '連帶影響（先解決：{what}）',
  'Show in the simulation log': '在模擬日誌中檢視',
  '{tim} outputs are off (MOE = 0) — {pins} has no PWM': '{tim} 的輸出被關閉（MOE = 0）——{pins} 沒有 PWM',
  '{tim} outputs are off (MOE = 0) — no PWM': '{tim} 的輸出被關閉（MOE = 0）——沒有 PWM 輸出',
  '{p} has no clock — its pins ignore the firmware': '{p} 沒有開時脈——它的腳位不理會韌體的寫入',
  '{p} has no clock — the firmware cannot use it': '{p} 沒有開時脈——韌體無法使用它',
  '{clk} is {f}, above its {max} MHz limit': '{clk} 為 {f}，超過 {max} MHz 上限',
  'Two peripherals drive {pin}': '兩個周邊同時驅動 {pin}',

  // ---- transient / run-dependent findings (IN-16) ----
  '{id} {pin} floated briefly at start-up (the MCU pins are high-impedance during reset); {by} drives it since.':
    '開機時 {id} {pin} 短暫浮接（MCU 重置期間腳位為高阻抗），之後已被 {by} 驅動。',
  '{id} {pin} floated briefly at start-up; it has a signal since.': '開機時 {id} {pin} 短暫浮接，之後已有訊號。',
  'Confirm after running ({n})': '執行後確認（{n}）',
  'Depends on how the firmware sets up its pins: run the simulation to check.': '要看韌體怎麼設定腳位：執行模擬後再確認。',

  // ---- the problem → the part (IN-19) ----
  'See the problem above': '見上方 1 則問題',
  'See the {n} problems above': '見上方 {n} 則問題',

  // ---- the classic chrome's inspector (IN-18 — shown in English; the entry keeps the coverage test whole) ----
  'Burned out — replace this LED and add a series resistor.': '已燒毀——請更換這顆 LED，並串聯一個限流電阻。',

  // ---- pins, endpoints, readings (IN-20 / IN-21) ----
  'instantaneous|reading': '瞬時',
  'Stop the core where it is': '讓核心停在目前的位置',
  'Simulation paused (PC {pc})': '模擬暫停中（PC {pc}）',
  'Load|bin': '載入',
  '{name} was not loaded ({id} keeps {current}): it needs an .elf, .bin or .hex file': '{name} 沒有載入（{id} 仍使用 {current}）：需要 .elf、.bin 或 .hex 檔',
  '{name} was not loaded: it needs an .elf, .bin or .hex file': '{name} 沒有載入：需要 .elf、.bin 或 .hex 檔',
  'Duty cycle (also called duty ratio)': '工作週期（又稱佔空比）',
  'The share of each period the signal is high: 25 % means high for a quarter of the period. PWM sets an LED’s brightness or a motor’s speed this way.':
    '每個週期裡訊號為高電位的比例：25 % 表示高電位占四分之一個週期。PWM 就是用它來調整 LED 的亮度或馬達的速度。',

  // ---- reversed LED, floating rail (IN-17) ----
  'Swap the leads': '對調兩腳',
  'Swap the two leads (one undo step)': '把兩支腳的孔位互換（可以復原）',
  'Unpowered rail': '電源軌沒有接電源',
  'a power rail carries parts or wires, but no supply feeds it': '電源軌上接了元件或導線，卻沒有任何電源供電',
  'an LED sits directly across a supply with nothing limiting its current, its leads are shorted together, the simulation burned it out, or the running simulation shows its cathode above its anode with no current (reversed)':
    'LED 直接跨接在電源上而沒有任何限流、兩支接腳被短路、在模擬中已燒毀，或執行中的模擬顯示陰極比陽極高且沒有電流（接反了）',
  'an LED is driven by a GPIO / logic output / generator, or through a switch, transistor or potentiometer, with no fixed resistor; the series resistor is too small; or an LED is wired in reverse between two rails and can never light':
    'LED 由 GPIO／邏輯輸出／訊號產生器驅動，或經由開關、電晶體、可變電阻驅動，而沒有固定電阻；串聯電阻太小；或 LED 反接在兩條電源軌之間，永遠不會亮',
  'an LED faces a GPIO pin the wrong way round (confirmed once the simulation shows the pin driving it)':
    'LED 朝向 GPIO 腳位的方向接反了（模擬顯示腳位驅動它時即確認）',

  // ---- requests round 2: the lesson's expectation under a reading (LS-15) ----
  'Within the expected range': '在預期範圍內',
  'Outside the expected range': '超出預期範圍',

  // ---- glossary: the instruments' jargon (glossary.ts — QA clarity GLOSSARY-ENTRIES) ----
  'Peak-to-peak voltage (Vpp)': '峰對峰值（Vpp）',
  'The voltage between the highest and the lowest point of the waveform.': '波形最高點減最低點的電壓差。',
  'Average voltage|glossary': '平均值',
  'The voltage averaged over time. For PWM the average ≈ duty cycle × the high-level voltage — what a multimeter’s DC range reads.':
    '一段時間內電壓的平均；PWM 的平均值 ≈ 工作週期 × 高電位電壓，萬用電表直流檔量到的就是它。',
  'RMS (root mean square)': '均方根（RMS）',
  'The equivalent DC value, used to work out power; for a sine wave ≈ peak × 0.707.': '換算成等效直流的值，用來算功率；正弦波 ≈ 峰值 × 0.707。',
  'Period|glossary': '週期',
  'The time the signal takes to repeat once = 1 ÷ frequency.': '訊號重複一次的時間＝1 ÷ 頻率。',
  'Trigger|glossary': '觸發',
  'Makes every sweep start at the same place: the moment the signal crosses the trigger level going up (↑) or down (↓) is time 0.':
    '讓波形每次從同一處開始畫：訊號往上（↑）或往下（↓）穿過觸發準位的那一刻是時間 0。',
  // the scope's own control is 「觸發抑制時間」 (instruments.ts 'Trigger holdoff'): the same name here
  'Trigger holdoff|glossary': '觸發抑制時間',
  'After one trigger the scope waits this long before it accepts the next, so a complex waveform does not jump around.':
    '觸發一次後等這段時間才允許下一次，讓複雜波形不亂跳。',
  'Volts per division (V/div)': '每格電壓（V/格）',
  'How many volts one grid square stands for vertically; squares × V/div = the voltage difference.':
    '垂直方向一格代表幾伏特；格數 × V/格＝電壓差。',
  'Time per division (time/div)': '每格時間（時間/格）',
  'How much time one grid square stands for horizontally; the screen is 10 squares wide, so 10 × time/div is the time it shows.':
    '水平方向一格代表的時間；畫面寬 10 格，所以 10 × 時間/格就是畫面顯示的總時間。',
  'Baud rate (Bd)': '鮑率（Bd）',
  'How many bits are sent per second; at 115 200 Bd one bit lasts about 8.68 µs. Both ends must use the same rate.':
    '每秒傳幾個位元；115 200 Bd 每位元約 8.68 µs，兩端要設成一樣。',
  '8N1 (frame format)': '8N1（資料格式）',
  '8 data bits, no parity, 1 stop bit.': '8 個資料位元、無同位、1 個停止位元。',
  'Edges|glossary': '邊緣數',
  'How many times the signal switched between low and high in the window; with too few edges no frequency can be measured.':
    '這段時間內訊號在高、低電位之間切換的次數；邊緣太少就量不出頻率。',
  'Burst|glossary': '突發',
  'A clock that appears only while data is sent (I²C, SPI).': '只在傳資料時才出現的時脈（I²C、SPI）。',
  'ACK / NACK': 'ACK／NACK（應答）',
  'ACK = the receiver pulls SDA low to say it got the byte; NACK = nobody answered. When scanning I²C, a NACK from most addresses is normal.':
    'ACK＝接收端拉低 SDA 表示收到；NACK＝沒人回應。掃描 I²C 時大多數位址回 NACK 是正常的。',
  'Δt (time between the markers)': 'Δt（標記時間差）',
  'The time between markers A and B; 1/Δt is the frequency if that stretch is one period.': 'A、B 兩標記之間的時間差；1/Δt 是把它當一個週期時的頻率。',

  // ---- glossary: the register grid (McuPanel RegisterRows — QA clarity GLOSSARY-ENTRIES) ----
  'SP (stack pointer)': 'SP（堆疊指標）',
  'The address of the top of the stack. Function calls and interrupts push data onto the stack and SP moves down; at reset it is loaded from the first word of the vector table.':
    '堆疊頂端的位址。呼叫函式或進入中斷時會把資料推入堆疊，SP 就往下移；重置時從向量表的第一個值載入。',
  'LR (return address)': 'LR（返回位址）',
  'Where the current function returns to. Inside an exception handler it holds an EXC_RETURN value (0xFFFFFFF9 …) instead.':
    '目前的函式執行完要回到的位址。在例外處理常式裡則是 EXC_RETURN 值（0xFFFFFFF9 等）。',
  'xPSR (program status)': 'xPSR（程式狀態）',
  'The program status register: the top 4 bits are the condition flags N, Z, C and V, the lowest bits the current exception number (IPSR); bit 24 (T) must be 1.':
    '程式狀態暫存器：最高 4 個位元是條件旗標 N、Z、C、V，最低幾個位元是目前的例外編號（IPSR）；位元 24（T）一定要是 1。',
  'IPSR (current exception number)': 'IPSR（目前的例外編號）',
  '0 = the normal program; 3 = HardFault; 15 = SysTick; 16 and up are peripheral interrupts (IRQ number = IPSR − 16).':
    '0＝一般程式；3＝HardFault；15＝SysTick；16 以上是周邊中斷（IRQ 編號＝IPSR − 16）。',
}
export default zh
