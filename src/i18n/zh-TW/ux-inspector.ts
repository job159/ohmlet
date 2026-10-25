/**
 * zh-TW strings of the UX-wave inspector workstream (WS4, docs/ux/UX_REVIEW.md
 * §6.3): the MCU panel's honest state + reason lines, the built-in firmware
 * picker (src/ui/embedded/BundledFirmwarePicker.tsx — incl. the titles and
 * summaries of the firmware/dist projects no example describes), the
 * glossary (src/ui/embedded/glossary.ts), the problems panel
 * (src/ui/embedded/ErcPanel.tsx, problems.ts), meter readouts, pin-row
 * probe actions, the MCU sub-navigation and the wire net group
 * (src/ui/sheets/PropertiesSheet.tsx).
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage: 韌體、程式、檔案、記憶體、預設、訊號、執行、設定、網路、
 * 腳位、電源軌、孔位、偵錯、快閃記憶體。
 */
const zh: Record<string, string> = {
  // ---- MCU state chip (format.ts MCU_STATE_META) ----
  'Not run yet|mcu-state': '尚未執行',
  'Paused|mcu-state': '已暫停',
  'System-memory boot (not simulated)|mcu-state': '系統記憶體開機（未模擬）',
  'The simulation has not run since the last reset': '重置後模擬還沒有執行過',
  'The simulation is paused; the core resumes where it stopped': '模擬已暫停；繼續執行時，核心會從停下的地方接著跑',
  'PC is in system memory 0x1FFFF000–0x1FFFF7FF: BOOT0 = 1 starts the ROM bootloader (RM0008 §3.4), which is not simulated':
    'PC 位於系統記憶體 0x1FFFF000–0x1FFFF7FF：BOOT0 = 1 會啟動 ROM 內建開機程式（RM0008 §3.4），這部分沒有模擬',

  // ---- MCU reason line (McuPanel StateReason) ----
  'Press “▶ Run” or the Space bar to start the simulation.': '按「▶ 執行模擬」或空白鍵開始模擬。',
  'Press “▶ Run” to start the simulation.': '按「▶ 執行模擬」開始模擬。',
  'Waiting for the first report from the simulation…': '正在等待模擬的第一筆回報…',
  'The MCU has no program to run until it gets firmware: pick one below.': '載入韌體後，MCU 才有程式可以執行：請從下方選一個。',
  'The core stopped at {pc}': '核心停在 {pc}',
  'VDD {v}: the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.':
    'VDD {v}：MCU 停在重置。請把 5V 或 3V3 腳接到電源，並把 G 腳接到 − 電源軌。',
  'No supply voltage: the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.':
    '沒有電源電壓：MCU 停在重置。請把 5V 或 3V3 腳接到電源，並把 G 腳接到 − 電源軌。',
  'Show the power pins on the board': '在電路板上標示電源腳',
  'NRST is held low, so the MCU stays in reset. Make sure the R pin is not wired to GND.':
    'NRST 被拉到低電位，MCU 停在重置。請確認 R 腳沒有接到 GND。',
  'Open the simulation log': '查看模擬日誌',
  'The core waits in WFI / WFE for an interrupt — normal for low-power firmware.': '核心在 WFI／WFE 等待中斷——省電韌體的正常行為。',

  // ---- run controls + debugger row (McuRunGroup) ----
  'Resume the halted core and the simulation': '讓停住的核心與模擬繼續執行',
  'Debug|section': '偵錯',
  'Stop the core where it is (the whole simulation waits)': '讓核心停在目前的位置（整個模擬一起等待）',
  '■ Halt core': '■ 停住核心',
  Step: '單步',

  // ---- firmware card (FirmwareGroup) ----
  'This board has no firmware yet': '這塊板子還沒有韌體',
  'Choose built-in firmware': '選擇內建韌體',
  'Choose a file on this computer…': '從電腦選擇檔案…',
  'You can also drop an .elf / .bin / .hex onto this card.': '也可以把 .elf／.bin／.hex 拖到這張卡片上',
  'Use built-in firmware…': '改用內建韌體…',
  'Raw binary: choose where it goes in flash': '原始二進位檔：請選擇要燒到快閃記憶體的哪個位址',
  'Load {file}': '載入 {file}',
  'Not the default address: the vector table must be at 0x08000000.': '非預設位址：向量表必須位於 0x08000000。',
  'Load the .bin at 0x08000000, or use the ELF file.': '請把 .bin 燒到 0x08000000，或改用 ELF 檔。',
  'Firmware image': '韌體映像檔',
  'Reload {file} from disk': '重新載入 {file}',
  'Reload when the file changes': '檔案變更時自動重新載入',
  'Checks the file once a second while this window is visible': '視窗顯示時，每秒檢查一次檔案',

  // ---- built-in firmware picker ----
  'Built-in firmware': '內建韌體',
  'Built-in firmware for {id}': '{id} 的內建韌體',
  'Search firmware or examples': '搜尋韌體或範例',
  'No built-in firmware matches “{q}”': '沒有符合「{q}」的內建韌體',
  'Used in this lesson': '本課使用',
  'Example firmware': '範例韌體',
  'Other firmware': '其他',
  'Mistake demo': '錯誤示範',
  // firmware/dist projects without an example (BundledFirmwarePicker FIRMWARE_TEXT)
  'Register-level blink (no HAL)': '暫存器層級閃爍（不用 HAL）',
  'PA5 and PC13 toggle every 250 ms on the 8 MHz HSI clock, SysTick 1 ms.': 'PA5 與 PC13 在 8 MHz HSI 時脈下每 250 ms 切換一次，SysTick 1 ms。',
  'Register-level button mirror': '暫存器層級按鈕鏡像',
  'While the PA0 button (internal pull-up) is pressed, PA5 and the PC13 LED turn on.': 'PA0 按鈕（內部上拉）按下時，PA5 與 PC13 LED 點亮。',
  'CPU benchmark': 'CPU 效能測試',
  'Runs the self-test workload 60 times (about 41 M instructions), then stops on BKPT.': '把自我測試重複執行 60 次（約 4100 萬道指令），最後停在 BKPT。',
  'CPU self-test': 'CPU 自我測試',
  'CRC32, sorting, 64-bit math and recursion; the result stays in RAM, then BKPT.': 'CRC32、排序、64 位元運算與遞迴；結果留在 RAM，最後停在 BKPT。',
  'CPU self-test (-O0)': 'CPU 自我測試（-O0）',
  'The same self-test, built without optimization.': '同一份自我測試，以不最佳化（-O0）編譯。',
  'CPU self-test (-Os)': 'CPU 自我測試（-Os）',
  'The same self-test, optimized for size.': '同一份自我測試，以最小程式碼（-Os）編譯。',
  'ACS712 current sensor': 'ACS712 電流感測器',
  'Averages the ADC on PA0 every 200 ms and prints the current in mA on USART1.': '每 200 ms 平均 PA0 的 ADC 讀值，並在 USART1 印出電流（mA）。',
  'ADC scan with DMA': 'ADC 掃描＋DMA',
  'DMA copies IN0–IN3, the temperature sensor and VREFINT to RAM; printed every 200 ms.': 'DMA 把 IN0–IN3、溫度感測器與 VREFINT 搬到 RAM，每 200 ms 印出一次。',
  'BH1750 light sensor (I²C)': 'BH1750 光度感測器（I²C）',
  'Reads the light level over I2C1 (PB6 / PB7) every 200 ms and prints it on USART1.': '透過 I2C1（PB6／PB7）每 200 ms 讀取照度，並印在 USART1。',
  'DMA memory-to-memory copy': 'DMA 記憶體對記憶體複製',
  'DMA1 copies 1 KiB, the result is checked and the cycle count printed every 500 ms.': 'DMA1 複製 1 KiB 並驗證結果，每 500 ms 印出耗費的時脈週期數。',
  'ESP-01 AT commands': 'ESP-01 AT 指令',
  'Talks to an ESP8266 over USART2 at 115200; joining Wi-Fi fails (the lab has no Wi-Fi).': '經 USART2（115200）與 ESP8266 對話；連線 Wi-Fi 會失敗（實驗室沒有 Wi-Fi）。',
  'GPIO modes demo': 'GPIO 模式示範',
  'PB6 / PB7 open-drain at 10 Hz; PA1 pull-up, PA2 pull-down, PA3 floating, reported on USART1.':
    'PB6／PB7 以開汲極 10 Hz 切換；PA1 上拉、PA2 下拉、PA3 浮接，狀態印在 USART1。',
  'A3144 Hall switch': 'A3144 霍爾開關',
  'A PB12 interrupt on every magnet change, mirrored on the PC13 LED.': '磁鐵靠近或離開都會觸發 PB12 中斷，並同步顯示在 PC13 LED。',
  'KY-023 joystick': 'KY-023 搖桿',
  'ADC on PA0 / PA1 and the push switch on PB12, printed every 100 ms.': 'PA0／PA1 讀 ADC、PB12 讀按鍵，每 100 ms 印出一次。',
  'LCD1602 (4-bit parallel)': 'LCD1602（4 位元並列）',
  'HD44780 in 4-bit mode with busy-flag polling: text, custom characters and a counter.': 'HD44780 4 位元模式＋忙碌旗標輪詢：文字、自訂字元與計數器。',
  'SSD1306 OLED (SPI)': 'SSD1306 OLED（SPI）',
  'Text, a frame counter and a progress bar redrawn over SPI1 every 200 ms.': '透過 SPI1 每 200 ms 重畫文字、畫面計數與進度條。',
  'PCF8574 I/O expander': 'PCF8574 I/O 擴充晶片',
  'An LED chaser on P0–P6 and a button on P7, over I²C at 0x20.': '透過 I²C（0x20）在 P0–P6 跑馬燈，P7 讀取按鈕。',
  'micro-SD card (SPI)': 'microSD 記憶卡（SPI）',
  'SPI-mode start-up, then the card size and the FAT boot sector on USART1.': 'SPI 模式初始化，再把容量與 FAT16／FAT32 開機磁區印在 USART1。',
  'Servo signal (TIM2 CH2)': '伺服訊號（TIM2 CH2）',
  '50 Hz on PA1 with the pulse sweeping between 1.0 and 2.0 ms.': 'PA1 輸出 50 Hz，脈寬在 1.0 與 2.0 ms 之間來回。',
  'SPI loopback test': 'SPI 迴路測試',
  'Wire PA7 MOSI to PA6 MISO: four SPI set-ups are checked, the result goes to USART1.': '把 PA7 MOSI 接到 PA6 MISO：測試四種 SPI 設定，結果印在 USART1。',
  'SysTick timing probe': 'SysTick 時序探測',
  'PB13 toggles in the SysTick handler (500 Hz), PB14 around HAL_Delay(100).': 'PB13 在 SysTick 中斷裡切換（500 Hz），PB14 圍繞 HAL_Delay(100) 切換。',
  'TB6612FNG motor driver': 'TB6612FNG 馬達驅動器',
  'PWM on PA0 plus direction pins: forward, brake, reverse and standby.': 'PA0 輸出 PWM，加上方向腳：正轉、煞車、反轉與待機。',
  'Timer input capture (PWM input)': '計時器輸入捕捉（PWM 輸入）',
  'PA6 makes a PWM signal and PA0 measures it (wire PA6 → PA0); prints frequency and duty.': 'PA6 產生 PWM、PA0 量測它（請接 PA6 → PA0），印出頻率與工作週期。',
  'Quadrature encoder (TIM4)': '正交編碼器（TIM4）',
  'Encoder mode on PB6 / PB7; prints the count on every change.': 'PB6／PB7 使用編碼器模式，數值一改變就印出。',
  'Timer interrupt: 1 kHz time base': '計時器中斷：1 kHz 時基',
  'The TIM4 update interrupt toggles PB12 every 1 ms; PC13 blinks at 1 Hz.': 'TIM4 更新中斷每 1 ms 切換 PB12；PC13 以 1 Hz 閃爍。',
  'PWM on three timers': '三組計時器 PWM',
  'Three PWM outputs: PA0 1 kHz 25 %, PA6 20 kHz 50 %, PA8 2 kHz 75 %.': '三路 PWM 輸出：PA0 1 kHz 25 %、PA6 20 kHz 50 %、PA8 2 kHz 75 %。',
  'UART with DMA': 'UART＋DMA',
  'Sends and receives by DMA with idle-line detection; every received chunk is echoed.': '收發都使用 DMA 與閒置偵測，收到的每一段資料都會回傳。',
  'Lab demo: button modes': '實驗室示範：按鈕切換模式',
  'The PB12 button steps the PA5 LED through 2 Hz, 5 Hz, on and off; the mode goes to USART1.': 'PB12 按鈕依序切換 PA5 LED：2 Hz、5 Hz、常亮、熄滅，模式印在 USART1。',
  'Lesson a2: OLED frame buffer': '課程 a2：OLED 畫面緩衝區',
  'An I²C SSD1306 redrawn every 200 ms; PB12 low at reset leaves out the charge pump (the panel stays dark).':
    'I²C 介面的 SSD1306 每 200 ms 重畫；重置時若 PB12 接地，就不會開啟充電幫浦（面板保持全黑）。',
  'Lesson a3: UART reception by DMA': '課程 a3：以 DMA 接收 UART',
  'Circular DMA and idle-line detection on USART1; wire PA2 → PA10.': 'USART1 使用循環 DMA 與閒置偵測；請接 PA2 → PA10。',
  'Lesson a4: FreeRTOS tasks and queues': '課程 a4：FreeRTOS 工作與佇列',
  'Two tasks send to a queue and a logger task prints; the PB12 interrupt sends from its ISR.': '兩個工作把訊息送進佇列，記錄工作負責印出；PB12 中斷從 ISR 送出訊息。',
  'Lesson a6: rotary encoder (TIM4)': '課程 a6：旋轉編碼器（TIM4）',
  'KY-040 on TIM4 encoder mode (PB6 / PB7), 4 counts per detent, pos=<n> on USART1; PB13 low at reset also prints the raw count.':
    'KY-040 接 TIM4 編碼器模式（PB6／PB7），每一格 4 個計數，USART1 印出目前的位置；重置時若 PB13 接地，也會印出原始計數。',
  'Lesson a7: three devices on one I²C bus': '課程 a7：一條 I²C 匯流排上的三個裝置',
  'AT24C02, MPU-6050 and BME280 on I2C1 (PB6 / PB7); scans every second and prints each reading; a bus without pull-ups is reported.':
    'AT24C02、MPU-6050 與 BME280 共用 I2C1（PB6／PB7）；每秒掃描一次並印出各裝置的讀數；匯流排沒有上拉電阻時會回報。',
  'Forgot to wait for BUSY': '忘了等 BUSY',
  'The page program is sent during the sector erase; the flash ignores it and reads back FF.':
    '在磁區抹除期間就送出頁面寫入；快閃記憶體忽略這次寫入，讀回來全是 FF。',
  'Lesson b3: pull-up and pull-down': '課程 b3：上拉與下拉',
  'PA0 / PA1 are floating inputs with external pulls; the PC13 LED follows PA0, reported every 100 ms.':
    'PA0／PA1 為浮接輸入（外接上下拉電阻）；PC13 LED 跟著 PA0，每 100 ms 回報一次。',
  'GPIOA clock never enabled': '忘了開 GPIOA 時脈',
  'PA5 never becomes an output; only PC13 blinks.': 'PA5 永遠不會變成輸出，只有 PC13 在閃。',
  'PA5 set to open-drain': 'PA5 設成開汲極',
  'PA5 can only pull low, so an LED to GND stays dark.': 'PA5 只能往下拉，接到 GND 的 LED 不會亮。',
  'EXTI interrupt not enabled in the NVIC': '沒在 NVIC 開啟 EXTI 中斷',
  'The EXTI line goes pending, but the interrupt never runs.': 'EXTI 線已經觸發，中斷卻從來沒有執行。',
  'Timer off by one': '計時器差一',
  'PSC 72 / ARR 1000 without the “− 1”: PB12 runs at 492.66 Hz instead of 500 Hz.': 'PSC 72／ARR 1000 忘了減 1：PB12 變成 492.66 Hz，而不是 500 Hz。',
  'TIM1 MOE never set': 'TIM1 沒有設定 MOE',
  'PWM on PA0 and PA6 works, PA8 stays silent.': 'PA0、PA6 有 PWM，PA8 卻一直沒有輸出。',
  'Lesson i7: I²C scan and EEPROM': '課程 i7：I²C 掃描與 EEPROM',
  'Scans I2C1, then writes and verifies a page of an AT24C02; the report goes to USART1.': '先掃描 I2C1，再寫入並驗證 AT24C02 的一頁，結果印在 USART1。',
  'SPI sends the LSB first': 'SPI 先送最低位元',
  'The 74HC595 chaser runs backwards (QH … QA).': '74HC595 跑馬燈反方向跑（QH … QA）。',
  'Clock switching': '時脈切換',
  'HSI 8 MHz → PLL 72 MHz → HSI, printing SystemCoreClock on USART1.': 'HSI 8 MHz → PLL 72 MHz → HSI，並在 USART1 印出 SystemCoreClock。',
  'EXTI with WFI sleep': 'EXTI＋WFI 省電等待',
  'A PB12 falling edge toggles PA5; the core sleeps in WFI between interrupts.': 'PB12 下降緣切換 PA5；中斷之間核心在 WFI 中休眠。',
  'Independent watchdog reset': '獨立看門狗重置',
  'Counts boots in a backup register: two watchdog resets, then done.': '用備份暫存器計算開機次數：看門狗重置兩次後結束。',
  'UART echo (minimal)': 'UART 回音（精簡版）',
  'USART1 115200 8N1: prints a greeting, then echoes every byte.': 'USART1 115200 8N1：先印出問候，再回傳收到的每個位元組。',

  // ---- glossary (glossary.ts) ----
  'PC (program counter)': 'PC（程式計數器）',
  'The address of the instruction the core runs next. The name after it is the function it is in.':
    '核心下一道要執行的指令位址；後面的名稱是它所在的函式。',
  'Cycles (CPU clock cycles)': '時脈週期數（CPU 時脈週期）',
  'Core clock cycles since the last reset. It climbs while firmware runs and stands still while the core is halted or held in reset.':
    '重置後經過的核心時脈週期數。韌體執行時會一直增加；核心停住或停在重置時不會動。',
  'Core clock (HCLK)': '核心時脈 HCLK',
  'The clock the firmware set up for the core: 8 MHz after reset, usually 72 MHz once the HAL clock setup has run.':
    '韌體為核心設定的時脈：重置後是 8 MHz，HAL 時脈設定執行後通常是 72 MHz。',
  '1× means the simulation keeps up with real time; 0.5× means one simulated second takes two real seconds.':
    '1 倍速表示模擬跟真實時間一樣快；0.5 倍速表示模擬 1 秒要花真實的 2 秒。',
  'Chooses what starts after a reset: 0 = your program in flash (normal); 1 = the ROM bootloader in system memory, which is not simulated. A change takes effect at the next reset.':
    '決定重置後從哪裡開始：0＝快閃記憶體裡你的程式（一般情況）；1＝系統記憶體裡的 ROM 開機程式，這部分沒有模擬。改變後要到下次重置才生效。',
  'FT (5 V tolerant pin)': 'FT（5 V 容忍腳）',
  'This pin’s input survives up to 5 V. Pins without FT take at most 3.6 V — feeding them 5 V can damage the chip.':
    '這支腳的輸入最高可以承受 5 V。沒有 FT 標示的腳最多只能接 3.6 V——接 5 V 可能燒壞晶片。',
  'Push-pull output': '推挽輸出',
  'The pin actively drives both levels: 3.3 V for 1 and 0 V for 0. The usual mode for driving an LED.':
    '腳位主動輸出兩種準位：1 是 3.3 V、0 是 0 V。驅動 LED 最常用的模式。',
  'Open-drain output': '開汲極輸出',
  'The pin can only pull the line low; for 1 it lets go. A pull-up resistor has to make the high level — I²C works this way.':
    '腳位只能把線路往下拉；輸出 1 時會放開，要靠上拉電阻產生高準位——I²C 就是這樣運作。',
  'Alternate function (AF)': '複用功能（AF）',
  'A peripheral (USART, SPI, a timer…) drives this pin instead of your code writing it directly.':
    '由周邊（USART、SPI、計時器…）控制這支腳，而不是由你的程式直接寫入。',
  'Pull-up / pull-down': '上拉／下拉',
  'A resistor that holds an input at a known level (high or low) while nothing drives it. The STM32 has internal ones of about 40 kΩ.':
    '在沒有東西驅動時，把輸入固定在已知準位（高或低）的電阻。STM32 內建約 40 kΩ 的上下拉電阻。',
  'An input connected to nothing: it picks up noise and reads random levels. Add a pull-up or pull-down resistor.':
    '什麼都沒接的輸入：會拾取雜訊、讀到隨機的準位。請加上拉或下拉電阻。',
  'Electrical rule check (ERC)': '電氣規則檢查（ERC）',
  'Automatic checks of the wiring and the parts’ ratings — and, while the simulation runs, of the live readings. It points out likely mistakes; it cannot prove the circuit is right.':
    '自動檢查接線與元件額定值——模擬執行時也會檢查即時讀數。它會指出可能的錯誤，但無法證明電路一定正確。',

  // ---- problems panel (ErcPanel.tsx, ProblemsList.tsx) ----
  Problems: '問題',
  'What is this?': '這是什麼？',
  'certain from the wiring and the part ratings': '由接線與元件額定值即可確定',
  'a likely problem, or it depends on the firmware or part values': '很可能有問題，或取決於韌體或元件數值',
  'allowed, but worth knowing': '允許，但值得留意',
  'Problems found while the simulation runs and the MCU’s state are listed here too.': '模擬執行時發現的問題與 MCU 的狀態也會列在這裡。',
  '1 cause · affects {n} places': '1 個原因 · 影響 {n} 處',
  'Cleared by the live readings ({n})': '已由即時讀數排除（{n}）',
  'The live readings show this is not a problem right now.': '即時讀數顯示目前沒有這個問題。',
  'Reference: {ref}': '參考資料：{ref}',
  Less: '收合',
  'Details|problem': '詳細',
  '{rule}: {meaning}': '{rule}：{meaning}',

  // ---- part header subtitle (PropertiesSheet partKindText) ----
  'Passive component|part-kind': '被動元件',
  'Semiconductor|part-kind': '半導體',
  'Switch|part-kind': '開關',
  'Display|part-kind': '顯示元件',
  'Integrated circuit|part-kind': '積體電路',
  'Power source|part-kind': '電源',
  'Instrument|part-kind': '儀器',
  'Microcontroller|part-kind': '微控制器',
  'Sensor|part-kind': '感測器',
  'Module|part-kind': '模組',
  'Motor / actuator|part-kind': '馬達與致動器',
  'Component|part-kind': '元件',
  '{n} pins|count': '{n} 腳',

  // ---- meter readout (PropertiesSheet ReadoutGroup) ----
  Reading: '讀數',
  'DC voltage (IN − COM)': '直流電壓（IN − COM）',
  'DC current (IN → COM)': '直流電流（IN → COM）',
  'Resistance (IN − COM)': '電阻（IN − COM）',
  'OL (over range)': 'OL（超出量程）',
  'Output current': '輸出電流',
  'Output current · output {v}': '輸出電流 · 輸出電壓 {v}',
  '{what} · paused (last reading)': '{what} · 已暫停（最後讀數）',
  'Shown once you press “▶ Run simulation” above': '按上方「▶ 執行模擬」後顯示讀數',
  'Waiting for the first reading…': '正在等待第一筆讀數…',

  // ---- MCU sub-navigation (PropertiesSheet McuInspector) ----
  'Overview|mcu-tab': '概況',
  'Pins|mcu-tab': '腳位',
  'Firmware|mcu-tab': '韌體',
  'Peripherals|mcu-tab': '周邊',
  '{id} sections': '{id} 的分頁',
  'Core|section': '核心',
  'Firmware details': '韌體詳情',
  'Sampled when the MCU resets': 'MCU 重置時才會讀取',
  // peripheral families (McuPanel PERIPH_FAMILIES)
  'Clock and power|periph-group': '時脈與電源',
  'GPIO|periph-group': 'GPIO',
  'Timers|periph-group': '計時器',
  'Communication|periph-group': '通訊',
  'Analog|periph-group': '類比',
  'Other|periph-group': '其他',
  'takes effect at the next reset': '下次重置生效',

  // ---- pinout rows (PartInfo PinoutGroup, PropertiesSheet PinsGroup) ----
  'Pins in use': '使用中的腳位',
  'Mode = how the firmware set up the pin:': '模式＝韌體設定的腳位組態：',
  'Only pins that are wired to something': '只列出有接到東西的腳位',
  'Wired pins only': '只看有接線的腳',
  'No pin is wired or driven yet.': '還沒有接線或由韌體驅動的腳位。',
  'No pin is wired yet.': '還沒有接線的腳位。',
  'board {silk}': '板上 {silk}',
  'Show {pin} on the board': '在電路板上標示 {pin}',
  'In use by the firmware': '韌體正在使用',
  'The pin is in alternate-function mode: possibly this one': '這支腳處於複用模式：可能是這個功能',
  'Add {pin} to the logic analyzer': '把 {pin} 加到邏輯分析儀',
  'Place a scope probe on {pin}': '在 {pin} 放示波器探棒',

  // ---- wire net (PropertiesSheet WireNetGroup) ----
  Net: '網路',
  'Connected here': '接在這裡的',
  'Nothing else is connected to this wire yet': '這條導線還沒有接到其他東西',
  'paused (last reading)': '已暫停（最後讀數）',

  // ---- registers: flags + decoded fault bits (McuPanel RegisterRows, format.ts) ----
  'Condition flags (xPSR)': '條件旗標（xPSR）',
  Flags: '旗標',
  'Fault causes': '錯誤原因',
  'N — the last result was negative': 'N——上一個運算結果為負',
  'Z — the last result was zero': 'Z——上一個運算結果為零',
  'C — carry / no borrow': 'C——進位／沒有借位',
  'V — signed overflow': 'V——有號數溢位',
  'instruction access violation': '指令存取違規',
  'data access violation': '資料存取違規',
  'MPU fault while unstacking on exception return': '例外返回取回堆疊時發生 MPU 錯誤',
  'MPU fault while stacking on exception entry': '進入例外存入堆疊時發生 MPU 錯誤',
  'instruction bus error': '指令匯流排錯誤',
  'precise data bus error': '精確資料匯流排錯誤',
  'imprecise data bus error': '非精確資料匯流排錯誤',
  'bus fault while unstacking on exception return': '例外返回取回堆疊時發生匯流排錯誤',
  'bus fault while stacking on exception entry': '進入例外存入堆疊時發生匯流排錯誤',
  'undefined instruction': '未定義指令',
  'invalid state (Thumb bit clear)': '無效狀態（Thumb 位元為 0）',
  'invalid PC load on exception return': '例外返回時載入無效的 PC',
  'no coprocessor': '沒有協同處理器',
  'unaligned access': '未對齊存取',
  'divide by zero': '除以零',
  'vector table read failed': '讀取向量表失敗',
  'escalated to HardFault': '升級為 HardFault',
  'debug event': '偵錯事件',

  // ---- ERC rules added by this wave (ERC_RULES titles + level semantics) ----
  'Unconnected lead': '腳沒接',
  'one lead of a two-terminal part connects to nothing while the other is wired, or only to a power rail that no supply feeds (risk while the simulation runs)':
    '兩腳元件的一支腳沒有接到任何東西（或只接到沒有電源的電源軌），另一支卻有接線（模擬執行中為風險）',
  'the same before running, or a part placed but not wired yet': '執行前的同一情況，或元件已放上但還沒接線',
  'Pin not driven (live)': '腳位沒有被驅動（即時）',
  'an LED, buzzer or transistor base hangs only on an MCU pin that the running firmware left as an input':
    'LED、蜂鳴器或電晶體基極只接在一支 MCU 腳位上，而執行中的韌體把這支腳設成輸入',
}
export default zh
