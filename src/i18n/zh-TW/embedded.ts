/**
 * zh-TW strings for the embedded-lab panels (src/ui/embedded): support
 * badges, simulation status, pinout, on-board elements, firmware, MCU
 * execution + registers, peripherals table, ERC panel, simulation log and
 * the UART terminal. Keys are the English sources passed to t() / tc()
 * ("source|context" keys, src/ui/format tc(), disambiguate words with two meanings).
 * Runtime simulator messages (issues, log lines, loader warnings,
 * peripheral notes, ERC findings) are NOT here — they go through tMessage
 * (src/i18n/messages.ts, tables in messages-*.ts).
 */
const zh: Record<string, string> = {
  // ---- support level badge (PartInfo.SupportBadge; supportLevelLabel) ----
  Full: '完整模擬',
  Partial: '部分模擬',
  'Visual only': '僅視覺接線',
  'In development': '開發中',
  'Fully simulated within its documented model': '在其說明所記載的模型範圍內完整模擬',
  'A stated subset of its behavior is simulated': '僅模擬其已註明的部分行為',
  'Placement, wiring and netlist only — no behavior beyond its connections':
    '僅支援放置、接線與網路表——除連接關係外不模擬任何行為',
  'Under development — not simulated yet': '開發中——尚未模擬',
  'Simulation support: {level}': '模擬支援：{level}',

  // ---- simulation status group ----
  'Simulation|section': '模擬狀態',
  'Support|section': '支援等級',
  'No issues': '沒有問題',
  'Nothing reported for this part': '此元件沒有回報任何問題',
  error: '錯誤',
  warning: '警告',
  info: '資訊',

  // ---- pinout ----
  Pinout: '腳位圖',
  'Mode = the pin configuration programmed by firmware (GPIOx_CRL/CRH, RM0008 §9.2).':
    '模式＝韌體設定的腳位組態（GPIOx_CRL／GPIOx_CRH，RM0008 §9.2）。',
  'Placement is incomplete or invalid for this part.': '此元件的放置不完整或無效。',
  'Filter pins — A5, USART1, SPI…': '搜尋腳位：PA5、USART1…',
  'Filter pins': '篩選腳位',
  'No pin matches “{q}”': '沒有符合「{q}」的腳位',
  'Five-volt tolerant input (DS5319 Table 5, FT)': '可耐受 5 V 的輸入（DS5319 表 5，FT）',
  'Pin mode programmed by firmware: {mode}': '韌體設定的腳位模式：{mode}',
  '{fn} (remap)': '{fn}（重映射）',
  // lower-case catalog pin names (text.ts pinNameText → tc(pin, 'pin'))
  'source|pin': '源極',
  'gate|pin': '閘極',
  'drain|pin': '汲極',
  'anode|pin': '陽極',
  'cathode|pin': '陰極',
  'emitter|pin': '射極',
  'collector|pin': '集極',
  'base|pin': '基極',
  'common|pin': '共同端',
  'wiper|pin': '滑動端',
  'ccw|pin': '逆時針端',
  'tip|pin': '探棒',
  'out|pin': '輸出',
  'gnd|pin': '接地',
  'cw|pin': '順時針端',
  // motor / servo lead colors used as pin names
  'brown|pin': '棕線',
  'red|pin': '紅線',
  'orange|pin': '橙線',
  'yellow|pin': '黃線',
  'pink|pin': '粉紅線',
  'blue|pin': '藍線',
  'black|pin': '黑線',
  'green|pin': '綠線',
  // compact mode tags (telemetry.mcu.pinModes, McuBoardChip.fillTelemetry)
  'an|pin-mode': '類比',
  'in|pin-mode': '輸入',
  'in↑|pin-mode': '上拉',
  'in↓|pin-mode': '下拉',
  'out|pin-mode': '推挽',
  'od|pin-mode': '開汲極',
  'af|pin-mode': '複用推挽',
  'af-od|pin-mode': '複用開汲極',
  'rst|pin-mode': '重置',
  'gnd|pin-mode': 'GND',
  'pwr|pin-mode': '電源',
  'nc|pin-mode': 'NC',
  // full names (mode tag tooltip)
  'an|pin-mode-long': '類比輸入',
  'in|pin-mode-long': '浮接輸入',
  'in↑|pin-mode-long': '上拉輸入',
  'in↓|pin-mode-long': '下拉輸入',
  'out|pin-mode-long': '推挽輸出',
  'od|pin-mode-long': '開汲極輸出',
  'af|pin-mode-long': '複用功能推挽輸出',
  'af-od|pin-mode-long': '複用功能開汲極輸出',
  'rst|pin-mode-long': '重置腳（NRST）',
  'gnd|pin-mode-long': '接地',
  'pwr|pin-mode-long': '電源',
  'nc|pin-mode-long': '未連接（NC）',

  // ---- on-board elements (SubcircuitGroup) ----
  'On-board': '板載元件',
  'Run the simulation to see live values.': '執行模擬即可看到即時數值。',
  '{pin} pin': '{pin} 腳位',
  'ldo|model': '穩壓器（LDO）',
  'led|model': 'LED',
  'resistor|model': '電阻',
  'basic_iq|model': '靜態電流',
  'relay_srd05|model': '繼電器線圈（SRD-05）',
  'diode|model': '二極體',
  'npn|model': 'NPN 電晶體',
  'nmos_vth|model': 'N 通道 MOSFET',
  'battery|model': '電壓源',
  'comm_jumper_r|model': '跳線選用的電阻',
  'motor_dc|model': '直流馬達',
  'motor_sg90|model': '伺服馬達（SG90）',
  'motor_28byj48|model': '步進馬達（28BYJ-48）',
  'motor_nema17|model': '步進馬達（NEMA 17）',
  'drv_l298n|model': '馬達驅動晶片（L298N）',
  'drv_tb6612|model': '馬達驅動晶片（TB6612FNG）',
  'drv_drv8833|model': '馬達驅動晶片（DRV8833）',
  'drv_a4988|model': '步進馬達驅動晶片（A4988）',
  'drv_drv8825|model': '步進馬達驅動晶片（DRV8825）',
  'drv_tmc2209|model': '步進馬達驅動晶片（TMC2209）',
  // readable names of the on-board elements (PartInfo subcircuitName — QA IN-F5); values from the catalog params
  '{v} regulator (LDO)': '{v} 穩壓器（LDO）',
  'Power indicator LED': '電源指示 LED',
  'Power LED current-limiting resistor': '電源 LED 限流電阻',
  'PC13 on-board LED': 'PC13 板載 LED',
  'PC13 LED current-limiting resistor ({r})': 'PC13 LED 限流電阻（{r}）',
  'PC13 LED current-limiting resistor': 'PC13 LED 限流電阻',
  'USB D+ pull-up resistor ({r})': 'USB D+ 上拉電阻（{r}）',
  'USB D+ pull-up resistor': 'USB D+ 上拉電阻',
  'On-board {model}': '板載{model}',

  // ---- MCU state badge (format.ts MCU_STATE_META) ----
  'Running|mcu-state': '執行中',
  'Sleeping|mcu-state': '睡眠',
  'Halted|mcu-state': '核心已停住',
  'In reset|mcu-state': '重置中',
  'Fault|mcu-state': '故障（鎖死）',
  'Unpowered|mcu-state': '沒有供電',
  'No firmware|mcu-state': '還沒有韌體',
  'No data yet|mcu-state': '尚無資料',
  'Executing firmware': '正在執行韌體',
  'Core stopped in WFI/WFE until a wake-up event (ARMv7-M ARM, power management)':
    '核心停在 WFI/WFE，等待喚醒事件（ARMv7-M ARM，電源管理）',
  'Stopped by the debugger': '已由偵錯器停止',
  'NRST held low': 'NRST 維持低電位',
  'Lockup: a fault occurred while handling a fault (ARMv7-M ARM, unrecoverable exceptions)':
    '鎖死：處理故障時又發生故障（ARMv7-M ARM，不可恢復的例外）',
  'VDD below the POR/PDR threshold — held in reset (DS5319 §5.3.3)':
    'VDD 低於上電／斷電重置門檻——維持在重置狀態（DS5319 §5.3.3）',
  'Load an ELF, BIN or HEX image': '請載入 ELF、BIN 或 HEX 映像檔',
  'No simulation frame has reported this MCU yet': '模擬尚未回報此 MCU 的狀態',
  'MCU state: {state}': 'MCU 狀態：{state}',

  // ---- firmware (FirmwareGroup) ----
  Firmware: '韌體',
  'Drop another image anywhere on this card to replace it.': '將另一個映像檔拖放到此卡片上任一處即可取代。',
  'Real Cortex-M3 machine code runs in the simulator — build with STM32CubeIDE, {pio} or the repo {dir} toolchain.':
    '模擬器執行的是真實的 Cortex-M3 機器碼——可用 STM32CubeIDE、{pio} 或本專案的 {dir} 工具鏈建置。',
  '{name}: expected an .elf, .bin or .hex firmware image': '{name}：需要 .elf、.bin 或 .hex 韌體映像檔',
  'Enter a valid BIN load address (e.g. 0x08000000)': '請輸入有效的 BIN 載入位址（例如 0x08000000）',
  '{file} loaded into {id}': '已將 {file} 載入 {id}',
  ' · {n} warning': ' · {n} 個警告',
  ' · {n} warnings': ' · {n} 個警告',
  '{id}: firmware {file} loaded — MCU reset': '{id}：已載入韌體 {file}——MCU 已重置',
  'The firmware could not be loaded': '無法載入韌體',
  'Loading…': '載入中…',
  'Replace firmware…': '更換韌體…',
  'Remove firmware': '移除韌體',
  'Firmware removed from {id}': '已從 {id} 移除韌體',
  'Load firmware': '載入韌體',
  'Drop firmware here': '將韌體拖放到這裡',
  'Choose file…': '選擇檔案…',
  'BIN load address': 'BIN 載入位址',
  'Used only for raw .bin images; ELF and Intel HEX carry their own addresses.':
    '僅用於原始 .bin 映像檔；ELF 與 HEX 檔內含各自的位址。',
  'Firmware not loaded': '韌體沒有載入',
  // loader one-line description (text.ts firmwareDescriptionText)
  'ELF32 ARM{flags}, Thumb entry {addr}': 'ELF32 ARM{flags}，Thumb 進入點 {addr}',
  'ELF32 ARM{flags}, entry {addr}': 'ELF32 ARM{flags}，進入點 {addr}',
  'hard-float|elf-flag': '硬體浮點',
  'soft-float|elf-flag': '軟體浮點',
  'raw binary, {n} bytes at {addr}': '原始二進位檔，{n} 位元組，位於 {addr}',
  'Intel HEX, {n} bytes in {blocks} blocks': 'Intel HEX，{n} 位元組，共 {blocks} 個區塊',
  ', entry {addr}': '，進入點 {addr}',

  // ---- execution / debugger (McuRunGroup) ----
  'Execution|section': '執行狀態',
  '{id}: core LOCKUP — see the Simulation log': '{id}：核心鎖死（LOCKUP）——請查看模擬日誌',
  'sim paused': '模擬已暫停',
  Debugger: '偵錯器',
  'Resume core': '繼續執行核心',
  Resume: '繼續',
  'Halt core': '停住核心',
  'Halt the core (debugger)': '停住核心（偵錯器）',
  'Step one instruction': '單步執行一道指令',
  'Halt the core to single-step': '先停住核心才能單步執行',
  'Pause simulation': '暫停模擬',
  'Run simulation': '執行模擬',
  Pause: '暫停',
  Run: '執行',
  '{id} reset': '{id} 已重置',
  'Reset MCU': '重置 MCU',
  // the CPU cycle count — never the bare 週期, which is a period (1.000 ms) on the scope and the analyzer
  Cycles: '時脈週期數',
  'Core clock': '核心時脈',
  'Real time': '模擬速度',
  'Core registers': '核心暫存器',

  // ---- peripherals table (PeripheralsGroup) ----
  Peripherals: '周邊',
  'Verified = exercised by a real-firmware integration test. Unsupported blocks read 0, ignore writes and log every access.':
    '已驗證＝經真實韌體整合測試驗證。不支援的周邊讀取一律為 0、忽略寫入，並記錄每一次存取。',
  'Verified|peripheral': '已驗證',
  'Partial|peripheral': '部分',
  'Unsupported|peripheral': '不支援',
  'Memory map|periph-name': '記憶體映射',
  'Querying the MCU model…': '正在查詢 MCU 模型…',
  'No data yet — the MCU model reports its table once the simulation host has built it.':
    '尚無資料——模擬主機建立 MCU 模型後即會回報此表。',
  'tests: {list}': '測試：{list}',

  // ---- electrical rule check (ErcPanel) ----
  'Electrical rules': '電氣規則檢查',
  'Error|erc': '錯誤',
  'Risk|erc': '風險',
  'Info|erc': '提示',
  'Certain from the wiring and the part ratings': '確定錯誤：由接線與元件額定值即可確定',
  'Likely problem, or depends on firmware / component values': '可能風險：很可能有問題，或取決於韌體／元件數值',
  'Allowed, but worth knowing': '允許，但值得留意',
  '{n} error': '{n} 個錯誤',
  '{n} errors': '{n} 個錯誤',
  '{n} risk': '{n} 個風險',
  '{n} risks': '{n} 個風險',
  '{n} info': '{n} 則提示',
  'The rule check could not run on this layout': '無法對此電路執行規則檢查',
  'No problems found': '未發現問題',
  'Wiring + live readings': '接線＋即時讀數',
  // persona fix: the simulation starts by itself (auto-run) — no 「開始模擬即可…」 that asks the learner to start it
  'Wiring and ratings (start the simulation to add live readings)': '接線與額定值（模擬執行時加入即時讀數）',
  'Rule-based checks of the wiring, the parts’ datasheet ratings and the latest simulation readings — not a proof that the circuit works or is safe.':
    '依接線、元件資料手冊的額定值與最新模擬讀數進行的規則式檢查——並不能證明電路可正常運作或安全。',
  'Rule-based checks of the wiring and the parts’ datasheet ratings — not a proof that the circuit works or is safe.':
    '依接線與元件資料手冊的額定值進行的規則式檢查——並不能證明電路可正常運作或安全。',
  ' = certain from the circuit graph; ': '＝由電路圖即可確定；',
  ' = likely problem, or depends on firmware or values; ': '＝很可能有問題，或取決於韌體或數值；',
  ' = worth knowing.': '＝值得留意。',
  'Select parts': '選取元件',
  'Select parts {ids}': '選取元件 {ids}',
  'Select {ids} on the board': '在麵包板上選取 {ids}',
  // rule titles (src/sim/erc/api.ts ERC_RULES)
  'Supply short': '電源短路',
  'LED current limit': 'LED 限流',
  'GPIO overvoltage': 'GPIO 過電壓',
  'Floating input': '浮接輸入',
  'I²C pull-ups': 'I²C 上拉電阻',
  'Supply range': '電源電壓範圍',
  'Logic levels': '邏輯準位',
  'Ground reference': '共地參考',
  Unpowered: '未供電',
  // what each level means per rule (rule-title tooltips)
  'a source’s + and − (or a board’s 3V3/5V and GND) share a net, or two sources of different voltage drive one net':
    '電源的 + 與 −（或開發板的 3V3/5V 與 GND）位於同一網路，或兩個不同電壓的電源驅動同一網路',
  'they are joined only through a switch, button, transistor, inductor or an A-mode meter (a short whenever it conducts)':
    '兩者僅經由開關、按鈕、電晶體、電感或電流檔的電表相連（一導通就形成短路）',
  'an LED sits directly across a supply with nothing limiting its current, its leads are shorted together, or the simulation burned it out':
    'LED 直接跨接在電源上而沒有任何限流、兩腳短路，或已在模擬中燒毀',
  'an LED is driven by a GPIO / logic output / generator, or through a switch, transistor or potentiometer, with no fixed resistor; or the series resistor is too small':
    'LED 由 GPIO／邏輯輸出／訊號產生器驅動，或經由開關、電晶體或可變電阻驅動，卻沒有固定電阻；或串聯電阻太小',
  'an LED is wired in reverse between two rails and can never light':
    'LED 反接在兩條電源軌之間，永遠不會亮',
  'a non-5 V-tolerant MCU pin is tied to a rail above VDD + 0.3 V (or pulled there through a resistor injecting more than 5 mA), an FT pin goes above 5.5 V, or any pin below VSS − 0.3 V (DS5319 Tables 7 and 9)':
    '不耐 5 V 的 MCU 腳位接到高於 VDD + 0.3 V 的電源軌（或經電阻拉到該電位且注入電流超過 5 mA）、FT 腳位高於 5.5 V，或任何腳位低於 VSS − 0.3 V（DS5319 表 7 與表 9）',
  'the high voltage reaches the pin through a resistor within the 5 mA injection limit, an FT pin above VDD + 0.3 V has its internal pull enabled by the firmware, or the MCU is unpowered while a pin is driven':
    '高電壓經由電阻到達腳位但注入電流在 5 mA 限制內、韌體對高於 VDD + 0.3 V 的 FT 腳位啟用了內部上／下拉，或 MCU 未供電時腳位仍被驅動',
  '5 V on a 5 V-tolerant (FT) pin: allowed, but the internal pull-up/down must stay disabled (DS5319 Table 9 note 3)':
    '5 V 接到可耐受 5 V 的（FT）腳位：允許，但內部上拉／下拉必須保持停用（DS5319 表 9 註 3）',
  'a button/switch connects an input to a rail and nothing pulls it the other way while open (cleared when the running firmware enables the matching internal pull); also a pull in the same direction as the switch, or a switch on a push-pull output':
    '按鈕／開關把輸入接到電源軌，斷開時卻沒有任何元件往另一方向拉（執行中的韌體啟用對應的內部上／下拉時即解除）；也包括上／下拉方向與開關相同，或開關接在推挽輸出上',
  'an I²C SDA/SCL net with only open-drain ends and no pull-up resistor to a rail':
    'I²C SDA/SCL 網路只有開汲極端點，卻沒有接到電源軌的上拉電阻',
  'an I²C device pin on an MCU pin with no pull-up when the firmware is unknown, or SDA/SCL look swapped':
    '在韌體未知時，I²C 裝置腳位接到沒有上拉的 MCU 腳位，或 SDA/SCL 疑似接反',
  'a part’s supply is above its rated maximum or reversed, a regulator input is above its rated maximum, or a logic device gets less than its model needs to power up':
    '元件的電源電壓高於額定最大值或反接、穩壓器輸入高於額定最大值，或邏輯元件的電源低於其模型啟動所需',
  'a part’s supply is below its rated minimum, or a regulator input is too low to regulate':
    '元件的電源電壓低於額定最小值，或穩壓器輸入太低而無法穩壓',
  'a 5 V output drives a non-5 V-tolerant 3.3 V MCU pin, or a chip input is driven above its absolute-maximum input voltage':
    '5 V 輸出驅動不耐 5 V 的 3.3 V MCU 腳位，或晶片輸入被驅動到超過其絕對最大輸入電壓',
  'the same through a resistor, or a 3.3 V output drives a 5 V CMOS input whose VIH is above 3.3 V':
    '同上但經由電阻，或 3.3 V 輸出驅動 VIH 高於 3.3 V 的 5 V CMOS 輸入',
  'a 5 V output drives a 5 V-tolerant (FT) pin':
    '5 V 輸出驅動可耐受 5 V 的（FT）腳位',
  'measured power/current above the part’s rating, a regulator in current limit or dropout, or a GPIO driver above 25 mA':
    '量測到的功率／電流超過元件額定、穩壓器處於限流或壓降不足狀態，或 GPIO 驅動電流超過 25 mA',
  'a chip’s or board’s GND pin is not connected to the circuit ground':
    '晶片或開發板的 GND 腳位沒有接到電路接地',
  'a second source or the function generator has no common ground with the circuit':
    '第二個電源或函數產生器與電路沒有共地',
  'there is no power source, or a chip’s / board’s supply pin reaches no source':
    '沒有電源，或晶片／開發板的電源腳位沒有接到任何電源',
  'a supply pin is fed only through a resistor or other element':
    '電源腳位只經由電阻或其他元件供電',

  // ---- simulation log (SimLog) ----
  'Log filters': '日誌篩選',
  All: '全部',
  Warnings: '警告',
  Errors: '錯誤',
  'Level|log': '等級',
  'Source|log': '來源',
  'All sources': '全部來源',
  'Follow new entries': '自動捲動到最新項目',
  Follow: '跟隨',
  'No log entries yet': '尚無日誌項目',
  'Firmware notices, unsupported peripheral accesses and simulator events appear here once the simulation runs.':
    '模擬執行後，韌體通知、不支援的周邊存取與模擬器事件會顯示在這裡。',
  'Simulation log': '模擬日誌',
  // log source ids (text.ts logSourceText → tc(segment, 'log-source'))
  'sim|log-source': '模擬器',
  'lab|log-source': '實驗室',
  'core|log-source': '核心',
  'loader|log-source': '載入器',
  'No entries match the filter.': '沒有符合篩選條件的項目。',

  // ---- UART terminal ----
  'No line ending': '無行尾字元',
  'LF (\\n)': 'LF（\\n 換行）',
  'CR (\\r)': 'CR（\\r 歸位）',
  'CR LF': 'CR LF（\\r\\n）',
  'not configured': '尚未設定',
  disabled: '已停用',
  'Terminal options': '終端機選項',
  'Serial port': '序列埠',
  'No serial ports': '沒有序列埠',
  'Line settings programmed by the firmware': '韌體設定的傳輸參數',
  'Text|uart': '文字',
  'Hex|uart': '十六進位',
  'Display|uart': '顯示方式',
  'Time|uart': '時間',
  'Stamp lines with the simulation time they were received (≈100 ms resolution)':
    '以接收時的模擬時間標記每一行（解析度約 100 ms）',
  'Show what you send in the transcript': '在記錄中顯示你傳送的內容',
  Echo: '回顯',
  'Scroll with new output': '隨新輸出自動捲動',
  'Clear terminal': '清除終端機',
  "Clear this port's buffer": '清除此序列埠的緩衝區',
  'Place an MCU board (Library → MCU) and load firmware that prints over a USART.':
    '請放置 MCU 開發板（元件庫 → MCU），並載入會透過 USART 輸出的韌體。',
  'Received from {id} {port}': '從 {id} {port} 接收',
  'Serial output': '序列輸出',
  'no bytes yet': '尚無位元組',
  '{port} is not enabled by the firmware (yet)': '韌體（尚）未啟用 {port}',
  'no data yet': '尚無資料',
  'Send to {id} {port}…': '傳送到 {id} {port}…',
  'No port selected': '未選取序列埠',
  'Text to send': '要傳送的文字',
  'Line ending': '行尾字元',
  Send: '傳送',
}
export default zh
