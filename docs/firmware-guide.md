# 韌體指南：從 STM32CubeIDE 到模擬器

本指南說明如何把自己寫的 STM32F103 韌體放進 ohmlet 執行：在 STM32CubeIDE 建立與設定專案、取得 ELF、載入 Blue Pill、
了解哪些 HAL 功能可以在模擬器中運作、如何偵錯，以及如何用本專案內建的 clang 工具鏈建置範例韌體、撰寫可自動驗證的 `checks` 行為契約。

> **先說清楚模擬器做什麼、不做什麼。** ohmlet 執行的是韌體檔案裡**真正的 Cortex-M3 機器碼**：每一道指令都由
> TypeScript 寫成的 ARMv7-M 核心逐條執行，周邊暫存器由 STM32F103 模型回應，腳位電壓由電路求解器算出。
> 沒有任何「預先錄好的行為」，也不會替你的程式碼做任何假設。沒有模擬的周邊會**明確標示為不支援**，
> 存取時暫存器讀為 0、忽略寫入，並在「模擬日誌」記錄每一次存取。完整清單見[模擬支援矩陣](support-matrix.md)。

## 目錄

1. [快速流程（五分鐘）](#1-快速流程五分鐘)
2. [在 STM32CubeIDE 建立專案](#2-在-stm32cubeide-建立專案)
3. [時脈設定](#3-時脈設定)
4. [Blue Pill 腳位對照](#4-blue-pill-腳位對照)
5. [載入韌體](#5-載入韌體)
6. [哪些 HAL 功能可以運作](#6-哪些-hal-功能可以運作)
7. [FreeRTOS](#7-freertos)
8. [偵錯：狀態、偵錯器、模擬日誌與常見問題](#8-偵錯狀態偵錯器模擬日誌與常見問題)
9. [用本專案的 clang 工具鏈建置範例韌體](#9-用本專案的-clang-工具鏈建置範例韌體)
10. [`checks` 行為契約](#10-checks-行為契約)

---

## 1. 快速流程（五分鐘）

1. 在 STM32CubeIDE 新增專案，晶片選 **STM32F103C8Tx**。
2. `SYS → Debug` 設為 **Serial Wire**；`RCC → High Speed Clock (HSE)` 設為 **Crystal/Ceramic Resonator**。
3. 時脈樹設為 72 MHz（HSE 8 MHz × PLL 9）。
4. 把 `PC13`（板載 LED）設為 `GPIO_Output`，在 `main()` 的 `while (1)` 裡寫：

   ```c
   /* USER CODE BEGIN 3 */
   HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
   HAL_Delay(500);
   /* USER CODE END 3 */
   ```

5. `Project → Build Project`，產生 `<工作區>/<專案>/Debug/<專案>.elf`。
6. 在 ohmlet 打開範例「Blue Pill 閃爍 LED（HAL）」（它已經接好電源），把你的 `.elf` **拖到 3D 畫面上**，放開即載入 U1。
   要從空白麵包板開始時，放一塊「STM32F103C8T6 Blue Pill 開發板」並接上電源（見[使用手冊 §3–§4](user-guide.md#3-放置元件)）。
7. 按膠囊的 **▶ 執行模擬**。板載的 PC13 LED 每 501 ms 切換一次（`HAL_Delay(n)` 會等待 n + 1 個 tick，見 [§6](#hal-版本與行為細節)）。

---

## 2. 在 STM32CubeIDE 建立專案

| 設定 | 建議值 | 原因 |
|---|---|---|
| 晶片 | STM32F103C8Tx（LQFP48） | 模擬的 MCU 型號是 `stm32f103c8`，只有 LQFP48 引出的腳位存在 |
| `SYS → Debug` | **Serial Wire** | CubeMX 會產生 `__HAL_AFIO_REMAP_SWJ_NOJTAG()`，釋放 PA15、PB3、PB4 當一般 GPIO。選「No Debug」會產生 `__HAL_AFIO_REMAP_SWJ_DISABLE()`，實體板子之後就無法再接偵錯器 |
| `RCC → HSE` | Crystal/Ceramic Resonator | Blue Pill 板上有 8 MHz 石英晶體；模擬的 HSE 在 HSEON 之後 1 ms 就緒 |
| `RCC → LSE` | 視需要 | 板上有 32.768 kHz 晶體；LSE 就緒時間 500 ms。注意 **RTC 不支援** |
| USART RX 腳位 | 建議設為 Pull-up | CubeMX 預設 No pull；RX 浮接時可能收到框架錯誤。本專案的範例全部改用上拉 |
| 專案類型 | 一般 STM32Cube 專案（C） | 模擬器不在意語言或函式庫：HAL、LL、直接操作暫存器都一樣是機器碼 |

**輸出檔案。** 建置後的映像檔在 `Debug/<專案>.elf`（Release 組態則在 `Release/<專案>.elf`）。
ELF 檔內含載入位址與符號表，**請優先使用 ELF**：偵錯器會用符號表把 PC 與 LR 對應到函式名稱。
若需要 `.bin` 或 `.hex`：`Project Properties → C/C++ Build → Settings → MCU Post build outputs`，
勾選「Convert to binary file (-O binary)」或「Convert to Intel Hex file (-O ihex)」。

---

## 3. 時脈設定

Blue Pill 的標準時脈樹（本專案的 HAL 範例都使用這組設定）：

| 項目 | 設定 | 結果 |
|---|---|---|
| PLL 來源 | HSE（8 MHz），不除頻 | |
| PLLMUL | × 9 | SYSCLK = 72 MHz |
| AHB 預除頻 | ÷1 | HCLK = 72 MHz（SysTick 1 kHz：`LOAD` = 71999） |
| APB1 預除頻 | ÷2 | PCLK1 = 36 MHz（TIM2–4 的時脈 ×2 = 72 MHz） |
| APB2 預除頻 | ÷1 | PCLK2 = 72 MHz（USART1 115200 Bd：`BRR` = 0x271） |
| ADC 預除頻 | ÷6 | ADCCLK = 12 MHz（上限 14 MHz） |
| `FLASH_LATENCY` | 2 | 模擬器會檢查，等待週期過少時發出警告 |

模擬器實際做的事（細節見[支援矩陣](support-matrix.md#微控制器周邊stm32f103c8)的 RCC／FLASH 列）：

- 重置後由 HSI 8 MHz 執行；HSE 在 `HSEON` 後 1 ms 就緒、PLL 鎖定 200 µs、LSI 85 µs、LSE 500 ms。
- `SW → SWS` 只會切換到已就緒的時脈源；HAL 會輪詢 `SWS`，所以時脈切換流程與實機一致。
- 時脈樹超出資料手冊限制時（例如 PCLK1 超過 36 MHz）會在模擬日誌發出警告，問題面板也會指出是哪個時脈超過上限，但不會阻止執行。
- 每次 HCLK 改變時，週期與時間的換算會精確地重新定基：計時器、UART 鮑率與 SysTick 都以新的時脈計算。
- **未模擬**：時脈安全系統（CSS，模擬的晶體不會故障）、MCO 輸出、快閃記憶體等待週期造成的 CPU 停頓。

只用 HSI 的專案也可以執行（例如 `bare-blink` 在 8 MHz HSI 下運作）。MCU「概況」分頁的「核心時脈」顯示韌體目前設定的 HCLK。

**時序準確度。** 指令週期依 Cortex-M3 TRM 的表格近似，**沒有模擬快閃記憶體等待週期與匯流排競爭**，所以在 72 MHz、2 個等待週期的實機上，
純計算的迴圈會比模擬器稍慢。周邊時序（計時器、UART 位元時間、I²C／SPI 時脈、SysTick）則以設定的時脈精確計算。
模擬時間是**虛擬時間**：電腦跑不動即時速度時，膠囊與「模擬速度」會顯示低於 1 的倍速，但韌體看到的時間與波形完全相同、可以重現。

---

## 4. Blue Pill 腳位對照

開發板以 `PB12` 為定位點，跨在麵包板中央溝槽上（例：定位在 `h10`），兩排排針分別落在 **h 列**與 **c 列**；
板子本體蓋住 b–i 列，所以**每支排針只剩一個空孔**（a 列或 j 列）可以接線。

| 排針 | 腳位（由 USB 端往外） |
|---|---|
| h 列（近側，腳 1–20） | PB12 PB13 PB14 PB15 PA8 PA9 PA10 PA11 PA12 PA15 PB3 PB4 PB5 PB6 PB7 PB8 PB9 **5V** **GND** **3V3** |
| c 列（遠側，腳 21–40） | VBAT PC13 PC14 PC15 PA0 PA1 PA2 PA3 PA4 PA5 PA6 PA7 PB0 PB1 PB10 PB11 **NRST** **3V3** **GND** **GND** |

- **板載元件**（以電路元件模擬）：電源 LED、接在 PC13 的綠色 LED（**低電位點亮**，經 510 Ω 接到 3.3 V）、
  3.3 V 穩壓器（5V 腳輸入）、PA12 的 10 kΩ USB D+ 上拉電阻。它們的即時數值在 MCU「腳位」分頁的「板載元件」。
- **可耐受 5 V（FT）的腳位**：PA8–PA15、PB3、PB4、PB6–PB15。其他腳位接到 5 V 會被電氣規則檢查標示為錯誤。
- **PC13–PC15** 是低電流腳位（灌電流 ≤ 3 mA、≤ 2 MHz）。
- **沒有引出的腳位**：PA13／PA14（SWD 接頭）、PB2（BOOT1 跳線）、PD0／PD1（HSE 晶體）。
- **BOOT0 跳線**是開發板的參數（「概況」分頁 → 參數 → BOOT0 跳線），改變後要到下次重置才生效。BOOT0 = 1 時 ST 的系統記憶體開機載入程式**沒有模擬**：
  MCU 狀態顯示「系統記憶體開機（未模擬）」並記錄一則錯誤，不會假裝在跑。
- 腳位名稱在介面上一律寫成「U1 PA5（板上 A5）」；「腳位」分頁列出每支腳的絲印、可能的複用功能（例如 `USART1_TX`、`TIM1_CH2`）、FT 標記、
  麵包板孔位、即時電壓，以及**韌體目前設定的腳位模式**（推挽、開汲極、上拉輸入、類比、複用推挽…）。

**GPIO 電氣模型**：推挽輸出 50 Ω、上拉／下拉 40 kΩ、輸入以資料手冊的 VIL／VIH 公式加遲滯判定；
過電壓、驅動電流超過 25 mA、浮接輸入、MCU 未供電都會在模擬日誌與問題面板中警告。

---

## 5. 載入韌體

選取開發板，在「屬性」面板的「**韌體**」分頁（或執行狀態卡片的韌體列）操作；也可以直接把檔案**拖到 3D 畫面**或韌體卡片上。
UI 接受 `.elf`、`.bin`、`.hex` 三種副檔名；載入器**先依內容判斷格式**（ELF 魔術數字、Intel HEX 紀錄語法），副檔名與內容不符時會說明原因並拒絕載入。

| 格式 | 位址來源 | 備註 |
|---|---|---|
| ELF | 檔案內的程式標頭（LMA） | 推薦。同時帶入符號表 |
| Intel HEX | 檔案內的位址紀錄 | |
| BIN | 載入前確認，**預設 0x08000000** | 純二進位沒有位址；一般 CubeIDE 映像檔必須燒在主快閃記憶體起點（RM0008 §3.3.3），其他位址會被警告 |

- 成功後卡片顯示檔名、格式、大小、SHA-256、進入點與載入器警告，MCU 會**重新上電重置**，UART 終端機插入一條載入分隔線。
- **改了程式就自動換上**：在 Edge／Chrome 中用「從電腦選擇檔案…」選檔，卡片上會出現「重新載入」與「**檔案變更時自動重新載入**」。
  打開後，視窗顯示時每秒檢查一次檔案；在 CubeIDE 按 Build 之後，新的 ELF 就會自動載入並重置 MCU（`.bin` 會沿用原本的燒錄位址）。
- **沒有自己的映像檔時**，用「選擇內建韌體」：隨附的 76 個映像檔可以搜尋，課程用到的排在最前面。

**載入規則與燒錄器（ST-Link／CubeProgrammer）相同**：

- 只有載入位址落在快閃記憶體內的位元組會被燒錄。只存在於 RAM 的區段（`.bss`、堆積／堆疊保留區）不會載入——
  由你的啟動程式碼初始化，與實機相同（載入器會以警告說明）。
- 映像檔超過 64 KiB 時會載入但發出警告：STM32F103C8 資料手冊標示 64 KiB，許多實際晶片有 128 KiB 可用；模擬器映射 128 KiB。
- 連結在開機載入程式偏移位址的映像檔（例如 STM32duino／Maple 的 0x08002000）**無法啟動**：沒有模擬任何開機載入程式，
  核心從 0x08000000 讀取堆疊指標與重置向量，就像 BOOT0 = 0 的實機。
- 韌體會連同專案一起儲存：「儲存專案」產生的 `.ohmlet.json` 內含每塊開發板的韌體檔案（含 SHA-256 與大小，`.bin` 另記燒錄位址）；
  瀏覽器本身也會記住目前的韌體（存在 IndexedDB），重新整理頁面後會重新解析、驗證雜湊後才綁定。

---

## 6. 哪些 HAL 功能可以運作

下表依 MCU 模型自己回報的支援表整理（[完整說明](support-matrix.md#微控制器周邊stm32f103c8)；應用程式中是開發板的「周邊」分頁）。
「驗證用韌體」都在 `firmware/projects/` 中，由真實的 ST HAL v1.1.9 編譯，並在測試中逐項檢查行為。

| 功能 | 狀態 | 用 HAL 驗證過的情境（韌體專案） |
|---|---|---|
| GPIO（所有模式、上拉／下拉、BSRR／BRR、LCKR） | 已驗證 | `hal-blink`、`bare-blink`、`hal-gpio-modes` |
| EXTI 外部中斷（上升／下降緣、軟體觸發） | 已驗證 | `soc-exti`、`hal-button-exti`、`hal-traffic-light` |
| SysTick、`HAL_Delay`、`HAL_GetTick`、NVIC、例外處理 | 核心功能 | 所有 HAL 範例；`hal-systick-timing` 量測 tick 時序 |
| RCC 時脈切換、FLASH 等待週期設定 | 部分 | `hal-blink`、`soc-clock` |
| IWDG 獨立看門狗（含重置旗標） | 已驗證 | `soc-iwdg` |
| USART1–3 非同步模式（輪詢、中斷、DMA） | 部分 | `soc-uart`、`hal-uart-hello`、`hal-uart-dma`；USART2 由 `hal-ch340`、`hal-hc05`、`hal-esp01`、`hal-rs485` 驅動，USART3 由 `hal-rs485` 驅動 |
| TIM1–4：PWM、輸出比較、輸入捕捉、PWM 輸入、編碼器模式、更新中斷 | 部分 | `hal-tim-pwm`、`hal-pwm-fade`、`hal-servo`、`hal-tim-capture`、`hal-tim-encoder`、`hal-tim-irq` |
| I2C1／I2C2 主端（含 `HAL_I2C_IsDeviceReady`、Mem 讀寫、中斷） | 部分 | `hal-i2c-scan`、`hal-i2c-eeprom`，以及各感測器與顯示器範例 |
| SPI1／SPI2 主端（模式 0–3、8／16 位元、硬體 CRC） | 部分 | `hal-spi-595`、`hal-spi-loopback` |
| ADC1／ADC2（校準、單次／連續／掃描、溫度感測器、VREFINT、DMA） | 部分 | `hal-adc-pot`、`hal-adc-dma` |
| DMA1 七個通道（記憶體↔周邊、循環模式、HT／TC 中斷） | 部分 | `hal-dma-m2m`、`hal-adc-dma`、`hal-uart-dma` |
| WWDG、CRC、BKP、PWR、AFIO 重映射、DBGMCU | 部分 | 多為單元測試；細節見支援矩陣 |
| **USB、CAN、RTC** | **不支援** | 暫存器讀為 0、忽略寫入、每次存取都會記錄 |

各裝置模組（OLED、LCD、MPU-6050、BME280、DHT22、DS18B20、HC-SR04、步進馬達驅動器…）也都有對應的 HAL 韌體，
例如 `hal-oled-ssd1306`、`hal-bme280`、`hal-dht`、`hal-stepper-a4988`；`npm run fw:list` 會列出全部專案與一行說明。

### HAL 版本與行為細節

- **`HAL_Delay(n)` 會等待 n + 1 個 tick。** HAL v1.1.9 為了「保證最短等待時間」會多等一個 tick：
  `toggle; HAL_Delay(500);` 的迴圈實際每 **501 ms** 切換一次。需要精確週期時，請用 `HAL_GetTick()` 的截止時間（`next += period`）。
- **`printf`**：透過 `_write()`／`__io_putchar()` 轉到 `HAL_UART_Transmit` 可以運作（模擬器只看到 USART 暫存器寫入，輸出出現在 UART 終端機）。
- **接收**：UART 終端機送出的文字經由 RX 腳以真實的 UART 訊框進入 USART（就像接了一個 3.3 V 的 USB 轉 TTL 轉接器），
  所以 `HAL_UART_Receive`、`HAL_UART_Receive_IT`、`HAL_UART_Receive_DMA` 與 IDLE 偵測看到的時序、旗標與錯誤（FE、ORE…）都和實機一樣；
  RX 腳建議設為上拉（見 [§2](#2-在-stm32cubeide-建立專案)）：終端機第一次送出之前，那條線只靠這個上拉維持在高電位（接上之後由轉接器維持）。
  **半主機（semihosting）不支援**：`initialise_monitor_handles`／`rdimon.specs` 會執行 `BKPT 0xAB` 等待偵錯器處理，
  模擬器在 BKPT 停住核心（實機沒有偵錯器時會升級為 HardFault）。`printf("%f")` 需要 newlib 的浮點支援（`-u _printf_float`）。
- **GCC 與 clang**：CubeIDE 用 arm-none-eabi-gcc 與 newlib-nano 編譯；本專案的範例是 clang 編譯。兩者都產生一般的 Thumb-2 機器碼，
  但指令序列不同。模擬器不連結任何東西，只執行 ELF 內的機器碼，所以任何版本的 CubeF1 HAL、LL 驅動或直接操作暫存器的程式碼都以相同方式執行。
  如果你的 CubeIDE ELF 行為與實機不同，那正是值得回報的輸入。
- **逾時**：若程式依賴的 USART 功能不支援，阻塞式 HAL 呼叫會以 `HAL_TIMEOUT` 結束；HAL 的 `UART_WaitOnFlagUntilTimeout` 在逾時時也會停用 RX 中斷並重設 `RxState`。
- **時脈等不到就緒**：HAL 以逾時等待 HSERDY／PLLRDY（`HSE_STARTUP_TIMEOUT` 100 ms）；時脈永遠不就緒時會進入 `Error_Handler()`，與實機相同。
- **周邊時脈**：沒有開時脈（`__HAL_RCC_GPIOx_CLK_ENABLE()` 等）的周邊不理會韌體的寫入，問題面板會寫例如「GPIOA 沒有開時脈——它的腳位不理會韌體的寫入」。
- **低功耗**：`WFI`／`WFE` 睡眠有模擬（MCU 狀態「睡眠」）；停止模式與待機模式以睡眠模式近似（會記錄於日誌）。

---

## 7. FreeRTOS

FreeRTOS 專案可以執行：核心排程用的是真實的 SysTick、SVC 與 PendSV 例外，模擬器沒有任何 RTOS 特例。
課程「進階 4 · STM32 + FreeRTOS：任務、優先權與佇列」與它的韌體 `lesson-a4-freertos` 是完整的例子：
FreeRTOS Kernel V11.1.0（連接埠 `GCC/ARM_CM3`、`heap_4`），三個不同優先權的任務、一個佇列、從 EXTI 中斷呼叫 `xQueueSendFromISR`，
並用 `DWT->CYCCNT` 做執行期統計（閒置比例）。它的 `checks` 契約逐行驗證每個任務的輸出時間。

自己的 CubeIDE FreeRTOS 專案要注意：CubeMX 會把 HAL 時基從 SysTick 改到某個計時器（`TIMx_IRQHandler` 呼叫 `HAL_IncTick`）；
STM32F103C8 只有 TIM1–TIM4，都屬「部分」支援（更新中斷已由 `hal-tim-irq` 驗證）。中斷優先權高於 `configMAX_SYSCALL_INTERRUPT_PRIORITY`
卻呼叫 FreeRTOS API 時，`configASSERT` 會像實機一樣觸發（`lesson-a4-freertos` 的錯誤實驗就是這個情況）。

本專案以 clang 建置 FreeRTOS 的方式（`project.json` 的 `"freertos": { "port": "GCC/ARM_CM3", "heap": 4 }`）見 [§9](#9-用本專案的-clang-工具鏈建置範例韌體)。

---

## 8. 偵錯：狀態、偵錯器、模擬日誌與常見問題

**先看狀態提示列與問題面板。** 開發板不動時，最根本的原因會排在最前面，順序是：沒有供電 → 還沒有韌體 → 故障（鎖死）→ 核心已停住 → 系統記憶體開機。
每一則都附修正按鈕（「在電路板上標示」電源腳、「載入韌體…」、「查看原因」、「繼續執行」）。

**MCU 的狀態**（執行狀態卡片的徽章）：尚未執行、執行中、睡眠（WFI／WFE）、已暫停、核心已停住、重置中（NRST 被拉低）、故障（鎖死）、沒有供電、
還沒有韌體、系統記憶體開機（未模擬）。沒有供電或還沒執行時，PC、週期等讀數一律顯示「—」並寫出原因。

**偵錯器**（「概況」分頁的「偵錯」列，或快速鍵）：

| 動作 | 快速鍵 | 說明 |
|---|---|---|
| ■ 停住核心 | F5 | 核心停在目前的指令，**整個模擬（電路與其他元件）一起暫停** |
| 單步 | F10 | 執行一道指令；模擬暫停中按 F10 會先停住核心再單步 |
| 繼續 | F5、空白鍵、膠囊 | 核心與模擬一起繼續 |
| 重置 MCU | Shift+F5 | 只重置這顆 MCU（NRST 脈衝），不影響電路其他部分 |

- 停住或鎖死時顯示核心暫存器 `r0`–`r12`、`sp`、`lr`、`pc`、`xpsr`、`ipsr` 與條件旗標 N／Z／C／V。
- **PC 與 LR 都對應到函式名稱**（ELF 有符號表時，例如 PC 在 `HAL_Delay`、LR 返回 `main`）；LR 是 EXC_RETURN（0xFFFFFFF1／F9／FD）時標示「例外返回」，表示核心正在例外處理常式中。
- 發生錯誤時列出 CFSR／HFSR 解讀出的**錯誤原因**：指令存取違規、未定義指令、無效狀態（Thumb 位元為 0）、除以零、未對齊存取、精確／非精確資料匯流排錯誤、讀取向量表失敗、升級為 HardFault…
- 執行中的讀數：PC（附函式名稱）、週期數、核心時脈、模擬速度。
- 「周邊」分頁的「**只看韌體用到的**」列出韌體已在 RCC 開時脈或已啟動的周邊，可以很快看出程式用到了哪些區塊、它們的支援狀態。

> 目前介面**沒有中斷點設定、記憶體檢視器與時脈樹檢視**。

**模擬日誌**（儀器匣的「模擬日誌」分頁）記錄韌體通知、不支援周邊的存取、載入器訊息、時脈與燒錄警告、電氣警告，可依等級與來源篩選。

| 現象 | 可能原因 | 解法 |
|---|---|---|
| 狀態一直是「沒有供電」 | 5V 或 3V3 腳沒有接到電源，或 GND 沒接 | 用電源供應器接 5V 腳（經板載穩壓器）或 3V3 腳，G 腳接到 − 電源軌；按提示列的「在電路板上標示」看電源腳 |
| LED 不亮，問題面板寫「GPIOA 沒有開時脈」 | 寫 GPIO 之前沒有開啟該埠的 RCC 時脈 | 呼叫 `__HAL_RCC_GPIOx_CLK_ENABLE()`（CubeMX 產生的 `MX_GPIO_Init` 會做）；課程 中級 1 的錯誤示範就是這個 |
| PA15／PB3／PB4 不動作 | 重置後屬於 JTAG | `SYS → Debug` 選 Serial Wire（產生 NOJTAG 重映射） |
| UART 終端機沒有輸出 | 鮑率／腳位不符，或選錯序列埠 | 終端機的綠色標籤顯示韌體實際設定的參數（例如「115 200 Bd · 8N1」）；確認 TX 腳位與 AFIO 重映射；開發板「周邊」分頁的「開啟 UART 終端機」會直接選好韌體用的那個 USART |
| 韌體收不到終端機送出的文字 | RX 腳已經由別的輸出驅動（例如 CH340 的 TXD），或韌體還沒設定鮑率、把 RX 腳當成一般輸出 | 終端機輸入框下方寫出原因（例如「PA3 已由 CH1 的 TXD 驅動，終端機不另外送出」，並提供「改用 CH1 的 COM 埠」）；終端機的文字以真實的 UART 訊框送上 RX 腳，用邏輯分析儀量 RX 腳就看得到 |
| I²C 掃描回報 bus busy 或全部 NACK | SDA／SCL 沒有上拉電阻，或接反 | 加 4.7 kΩ 上拉到 3.3 V（很多模組板上已經有）；ERC 會提示；用邏輯分析儀的 I²C 解碼看實際波形 |
| TIM1 的 PWM 沒有輸出 | 沒有設定 MOE | 用 `HAL_TIM_PWM_Start`（會設定 MOE），問題面板會寫「TIM1 的輸出被關閉（MOE = 0）」 |
| 狀態變成「故障（鎖死）」 | 在處理錯誤時又發生錯誤 | 執行狀態卡片能從映像檔看出原因時直接寫出（例如 `.bin` 載入在 0x08001000，0x08000000 沒有向量表），並附「改用 0x08000000 重新載入」；其他情況看暫存器與錯誤原因，常見原因是 0x08000000 沒有向量表、堆疊指標錯誤或存取未映射位址 |
| 核心停在 BKPT | 程式使用半主機（semihosting）或 `__BKPT()` | 移除半主機，`printf` 改經由 UART |
| 程式停在啟動階段 | 映像檔連結在 0x08002000 等偏移位址，或 BOOT0 = 1 | 用標準的 0x08000000 連結腳本；BOOT0 跳線設為 0 後按「重置 MCU」 |

---

## 9. 用本專案的 clang 工具鏈建置範例韌體

`firmware/` 收錄 74 個 CubeIDE 風格的專案（`firmware/projects/<名稱>/`），建置好的映像檔已提交在 `firmware/dist/`，
所以**一般使用與執行測試都不需要工具鏈**。要修改或新增範例時才需要建置。

**需求**：LLVM ≥ 17（含 ARM 後端、`ld.lld`、`llvm-objcopy`）；`firmware/dist/` 目前的映像檔以 LLVM 21.1.8（llvm-mingw）建置。
不需要 arm-none-eabi-gcc。工具從環境變數 `OHMLET_CLANG_DIR` 指定的資料夾取得，否則從 `PATH` 尋找。

```sh
npm run fw:vendor            # 取得 ST HAL v1.1.9、CMSIS、FreeRTOS Kernel V11.1.0（固定版本）到 firmware/vendor/（不入庫）
npm run fw:build             # 建置全部專案 → firmware/dist/<名稱>.elf .bin .hex + manifest.json
npm run fw:build -- hal-blink hal-uart-hello   # 只建置指定專案
npm run fw:list              # 列出全部專案與一行說明
```

（等同於 `node firmware/scripts/fetch-vendor.mjs` 與 `node firmware/build.mjs [專案…]`。）

編譯參數：`--target=thumbv7m-none-eabi -mcpu=cortex-m3 -mthumb -mfloat-abi=soft -std=gnu11 -O2 -ffunction-sections -fdata-sections -ffreestanding`，
HAL 專案另加 `-DUSE_HAL_DRIVER -DSTM32F103xB`，連結使用 CubeIDE 風格的 `STM32F103C8TX_FLASH.ld` 與 ST 官方的 GCC 啟動檔
`startup_stm32f103xb.s`。沒有 libc：`firmware/common/lib/` 提供 `mem*` 函式、64 位元除法與 `mini_printf`。

每個專案的 `project.json`：

```jsonc
{
  "kind": "hal",                 // "bare" = 只用 CMSIS 暫存器標頭，"hal" = ST HAL
  "sources": ["main.c", "stm32f1xx_it.c", "stm32f1xx_hal_msp.c"],
  "hal": ["uart"],               // 額外的 HAL 模組（cortex、rcc、gpio、exti、dma、flash、pwr 一律連結）
  "freertos": { "port": "GCC/ARM_CM3", "heap": 4 },   // 選用：連結 FreeRTOS 核心，專案資料夾提供 FreeRTOSConfig.h
  "description": "…",            // 一行說明（--list 與介面顯示）
  "expect": "…",                 // 可觀察行為的文字描述
  "checks": { … }                // 同樣的行為，可自動驗證（見下一節）
}
```

HAL 專案的檔案配置與 CubeIDE 產生的一致：`main.c`（`SystemClock_Config`、`MX_GPIO_Init`、`USER CODE BEGIN/END` 區塊）、
`main.h`、`stm32f1xx_it.c`、`stm32f1xx_hal_msp.c`。完整的工具鏈與專案說明見 [`firmware/README.md`](../firmware/README.md)。

**可重現性。** 在相同的 LLVM 版本下，`.bin`／`.hex`（實際燒錄的位元組）與 `manifest.json` 可以逐位元組重現（以 LLVM 21.1.8 重新建置全部 74 個專案，
76 個 `.bin`、76 個 `.hex` 與 `manifest.json` 都與提交的內容相同）；`.elf` 含有偵錯資訊中的絕對路徑，不同機器建置會不同。
CI 的選用工作 `firmware` 會用 LLVM 21 重新建置並比對 `.bin`、`.hex` 與 `manifest.json`（見[開發者指南 §13](developer-guide.md#13-持續整合ci)）。

---

## 10. `checks` 行為契約

每個範例專案在 `project.json` 中除了文字的 `expect`，還有一份**機器可驗證**的 `checks`。
測試執行器（`src/sim/coordinator/checks.ts`）會在模擬的麵包板上依 `circuit` 描述**實際接好電路**、
上電執行真實韌體，再用邏輯記錄器與 UART 監聽器量測，逐條比對：

```jsonc
"checks": {
  "hclkHz": 72000000,                       // 初始化後的核心時脈
  "settleMs": 150,                          // 從重置後這個時間點開始檢查靜態條件
  "t0": "settle",                           // 或 "uart:USART1"：以該埠送出第一個位元組的時刻為時間原點
  "circuit": ["PA5: LED + 220 ohm to GND", "PB12: push-button to GND"],
  "pins": { "PA5": "output-pp", "PB12": "input-pullup" },
  "uart": { "USART1": { "tx": "PA9", "rx": "PA10", "baud": 115200, "dataBits": 8, "parity": "none", "stopBits": 1 } },
  "boot": { "USART1": "Hello from STM32F103!\r\n" },
  "signals": [ { "pin": "PA5", "square": [501, 501], "tolUs": 20 } ],
  "scenarios": [
    {
      "name": "one press",
      "durationMs": 400,
      "drive": [ { "at": 0, "pin": "PB12", "level": 0 }, { "at": 100, "pin": "PB12", "level": "open" } ],
      "expect": [ { "id": "p1", "at": [19, 20.02], "pin": "PA5", "edge": 1 },
                  { "from": "p1", "at": [0.08, 0.15], "uart": "press 1\r\n" } ],
      "quiet": ["PA5", "USART1"]
    }
  ]
}
```

- **`circuit`** 不只是說明：執行器會照著放元件（LED＋電阻、上拉／下拉、AT24C02 EEPROM、74HC595、跳線…）。
  看不懂或放不下的那一行會讓整份契約**失敗**——契約絕不在與描述不同的電路上默默執行。
- **`drive`** 以 50 Ω 的測試激勵源作用在**網路**上（就像用手按按鈕），從不直接改 MCU 暫存器。
- 時間單位為毫秒（鍵名以 `Us` 結尾者為微秒）；所有時間窗都已包含 tick 相位的不確定性，不假設指令時序或快閃記憶體等待週期。
- 結果會列出每一條規則的**預期值與量測值**。

執行方式：

```sh
npm run test:firmware      # = vitest run tests/firmware-checks.test.ts，逐一驗證 manifest 中每個有 checks 的專案
```

`firmware/dist/manifest.json` 在測試執行時逐一讀取，所以新增一個附 `checks` 的專案不需要改測試檔。
課程也可以引用同一份契約（課程檢核 `firmware-checks`，見[開發者指南 §7](developer-guide.md#7-新增課程)）——例如沒有接點彈跳模型的按鈕，
去彈跳演算法就是用契約的短刺激脈衝驗證的。完整的欄位定義（`signals` 的 `square`／`invertOf`／`edgesAfter`／`oneHot`／週期性 UART 行、
`expect` 的 `every`、`quiet` 的計算方式等）見 [`firmware/README.md`〈The expect contract〉](../firmware/README.md#the-expect-contract)。
