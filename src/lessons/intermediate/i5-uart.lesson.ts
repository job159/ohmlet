/**
 * 中級 i5 — UART 序列通訊：115200 8N1、BRR 計算、USB 轉 TTL 轉接器、終端機與回顯。
 * Firmware: hal-uart-hello (USART1 PA9/PA10: banner, 'tick N' every second,
 * interrupt-driven line echo). The CH340 adapter's COM port is the PC side:
 * the acceptance reads what the PC actually received through the wiring.
 */
import type { Lesson } from '../types'
import { anchored, benchLayout, tap, type WireSpec } from './bench'

const PA9 = tap('PA9') // j15 — USART1_TX
const PA10 = tap('PA10') // j16 — USART1_RX

// CH340 USB-to-TTL adapter: header in row a, cols 35–40 (GND 3V3 5V TXD RXD DTR),
// so the free holes of its strips are b–e: GND e35, TXD e38, RXD e39.
const adapter = anchored('X1', 'usb_uart_ch340', 'a35', { logic: '3.3V', baud: '115200' })
const startWires: WireSpec[] = []
const solutionWires: WireSpec[] = [
  ...startWires,
  [PA9, 'e39', 'yellow'], // MCU TX → adapter RXD
  [PA10, 'e38', 'white'], // MCU RX ← adapter TXD
  ['e35', 'top-27', 'black'], // common ground
]

const pa9 = { component: 'U1', pin: 'PA9' } as const
const pa10 = { component: 'U1', pin: 'PA10' } as const

export const LESSON: Lesson = {
  id: 'i5-uart',
  level: 'intermediate',
  order: 5,
  title: 'UART 序列通訊：115200 8N1 與回顯',
  summary:
    '用 USB 轉 TTL 轉接器（CH340）把 Blue Pill 的 USART1 接到電腦的 COM 埠：交叉連接 TX／RX、共地、算出 BRR，看開機訊息與每秒一行的計數訊息，並用中斷接收做出回顯。',
  objectives: [
    '說明 UART 的 8N1 訊框：1 個起始位元、8 個資料位元（LSB 先送）、無同位、1 個停止位元，115200 鮑率下每個位元組 86.8 µs。',
    '算出 USART1 的鮑率暫存器：72 MHz ÷ (16 × 115200) = 39.0625 → BRR = 0x271，誤差 0 %。',
    '正確接線：MCU 的 TX 接轉接器的 RXD、MCU 的 RX 接轉接器的 TXD，兩邊共地。',
    '在 UART 終端機看到開機訊息與 `tick N`，並理解收發雙方的鮑率、資料格式必須一致。',
    '理解 `HAL_UART_Receive_IT()` 逐位元組中斷接收、以 CR／LF 斷行後回顯的寫法。',
  ],
  wiring:
    '電源已經接好（PS1 5 V → Blue Pill 5V 腳；3V3 → 上方 + 電源軌；兩條 − 電源軌為 GND）。\n\n' +
    '麵包板上方已經插好 **USB 轉 TTL 轉接器 X1（CH340G）**，它的 6 腳排針在 a 列第 35～40 欄：GND、3V3、5V、**TXD**、**RXD**、DTR，所以 GND 的空孔是 e35、TXD 是 e38、RXD 是 e39。轉接器的 USB 插頭接在電腦上（由 USB 供電），邏輯準位跳線帽設在 **3.3V**，電腦端的 COM 埠以 115200 8N1 開啟。\n\n' +
    '你要接三條線：\n' +
    '- **TX → RXD**：PA9（USART1_TX）在 h 列第 15 欄，空孔 **j15**（j 列第 15 欄）→ `e39`（X1 的 RXD）；\n' +
    '- **RX ← TXD**：PA10（USART1_RX）在 h 列第 16 欄，空孔 **j16** → `e38`（X1 的 TXD）；\n' +
    '- **共地**：`e35`（X1 的 GND）→ 上方 − 電源軌，例如 `top-27`（上方 − 電源軌第 27 孔）。',
  theory:
    '**1. 非同步序列傳輸。** UART 沒有時脈線，收發雙方事先約定好鮑率（每秒的位元數）與訊框格式。閒置時線路為高準位；一個 8N1 訊框是：起始位元（低）→ 8 個資料位元（**LSB 先送**）→ 停止位元（高）。115200 鮑率下每個位元 8.68 µs，一個位元組 10 個位元 = **86.8 µs**，最高約 11 520 位元組／秒。開機訊息 `Hello from STM32F103!\\r\\n` 有 23 個位元組，傳完需要約 2.0 ms。\n\n' +
    '**2. 鮑率暫存器 BRR。** USART1 掛在 APB2（PCLK2 = 72 MHz）上，USARTDIV = PCLK ÷ (16 × 鮑率) = 72 000 000 ÷ (16 × 115 200) = **39.0625**：整數部分 39 = 0x27 寫入 DIV_Mantissa，小數 0.0625 × 16 = 1 寫入 DIV_Fraction，所以 **BRR = 0x271**，實際鮑率剛好 115 200（誤差 0 %）。同樣設定放在 APB1（36 MHz）的 USART2 上，USARTDIV = 19.53，只能寫成 19 + 8/16，實際 115 384.6 鮑（+0.16 %）。收發雙方的誤差總和一般要小於約 ±2 %，否則取樣點會滑出位元，出現亂碼。\n\n' +
    '**3. 交叉接線與共地。** 一方的 TX（輸出）必須接到另一方的 RX（輸入）：PA9（TX）→ CH340 的 RXD，CH340 的 TXD → PA10（RX）。兩邊的 GND 也要相連，否則「高、低準位」沒有共同的參考點。PA9／PA10 是可耐 5 V 的腳位，但本課仍把轉接器設在 3.3 V，養成好習慣。\n\n' +
    '**4. hal-uart-hello 做了什麼。** `MX_USART1_UART_Init()` 設定 115200、8 位元、無同位、1 個停止位元；PA9 為複用推挽輸出、PA10 為上拉輸入。開機先送出 `Hello from STM32F103!`，之後每 1000 ms 送一行 `tick 1`、`tick 2`…（以期限計時，不會漂移）。接收用 `HAL_UART_Receive_IT()` 一次收 1 個位元組，在 `HAL_UART_RxCpltCallback()` 中存進行緩衝區並重新啟動接收；收到 CR 或 LF 代表一行結束，主迴圈回覆 `echo: <該行>`，空行會被忽略，每行最多保留 63 個字元。\n\n' +
    '**5. 為什麼用中斷接收？** 用 `HAL_UART_Receive()` 以查詢方式接收時，CPU 在等待期間什麼都不能做；而且只要主迴圈忙著做別的事超過 1 個位元組的時間（86.8 µs），硬體只有 1 個位元組的接收暫存器，下一個位元組就會覆蓋它（溢位錯誤 ORE）。',
  start: {
    layout: benchLayout(
      'i5 UART（起始）',
      'Blue Pill 已接電源；USB 轉 TTL 轉接器 X1（CH340G，3.3V）已插在 a35～a40，但還沒有任何訊號線，也還沒載入韌體。',
      [adapter],
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i5 UART（解答）',
      'PA9（TX，j15）→ X1 RXD（e39），PA10（RX，j16）← X1 TXD（e38），X1 GND（e35）→ GND；韌體 hal-uart-hello：115200 8N1 開機訊息、每秒一行計數、行回顯。',
      [adapter],
      solutionWires,
    ),
    firmware: { U1: 'hal-uart-hello' },
  },
  expected: [
    '電腦端 COM 埠（115200 8N1）在上電後約 3 ms 就收到 `Hello from STM32F103!`（23 個位元組，傳送本身約 2.0 ms）。',
    '之後每 1.000 s 出現一行 `tick 1`、`tick 2`…（第一行在開機訊息後 999～1000 ms）。',
    '在終端機輸入 `abc` 並以 CR 結尾送出，0.5 ms 內回覆 `echo: abc`。',
    '用邏輯分析儀加上 UART 解碼器看 PA9：每個位元 8.68 µs，每個位元組 86.8 µs；閒置時為高準位。',
    '把 COM 埠的鮑率改成 9600 時只會看到亂碼——收發鮑率差了 12 倍。',
  ],
  mistakes: [
    {
      symptom: 'UART 終端機（COM 埠）一片空白，什麼都收不到；電氣規則檢查還警告 PA9 的電流超過 25 mA。',
      cause:
        'TX 接到 TX、RX 接到 RX：兩個輸入接在一起，沒有任何訊號送到對方的接收端；兩個輸出（PA9 與 X1 的 TXD）則互相拉扯——一個輸出低準位、一個輸出高準位，PA9 被灌入約 26 mA，超過每支腳 25 mA 的上限。',
      fix: '交叉連接：PA9（TX）→ X1 的 RXD，X1 的 TXD → PA10（RX）。記法：「我說話的嘴（TX）對著你的耳朵（RX）」。',
    },
    {
      symptom: '終端機收到一串看不懂的亂碼與奇怪的符號。',
      cause: '兩邊的鮑率不同：例如韌體是 115200，COM 埠卻用 9600 開啟。接收端用錯誤的位元寬度取樣，每個位元組都被拆錯。',
      fix: '把 X1 的「COM 埠鮑率」設成與韌體相同的 115200，同位與停止位元也要一致（8N1）。',
    },
    {
      symptom: '開機訊息與每秒的 `tick N` 都正常，但在終端機打字時沒有任何回顯。',
      cause: 'MCU 的 RX（PA10）沒有接到轉接器的 TXD，或終端機送出的字串沒有行結尾——韌體要收到 CR 或 LF 才會回顯一整行。',
      fix: '確認 X1 的 TXD（e38）→ PA10（j16）這條線，並讓終端機在送出時附加 CR 或 CR+LF。',
    },
    {
      symptom: '偶爾少收幾個字元，尤其是一次貼上一長串文字時。',
      cause:
        '用查詢式的 `HAL_UART_Receive()` 或在主迴圈中處理太久：USART 只有 1 個位元組的接收暫存器，下一個位元組在 86.8 µs 後到達就會覆蓋它（ORE 溢位錯誤）。',
      fix: '用 `HAL_UART_Receive_IT()`（本課）或 DMA 接收，回呼函式只把位元組放進緩衝區，處理留給主迴圈。',
    },
    {
      symptom: 'TX、RX 都接對了，COM 埠卻收不到任何東西；電氣規則檢查提示 X1 的 GND 沒有接地。',
      cause:
        '兩邊沒有共地：訊號的高、低準位是相對於各自的 GND，轉接器的訊號沒有回流路徑。實機上有時看起來「勉強能用」（電流經由 USB 線與電腦的接地繞回來），卻會時好時壞、收到錯字。',
      fix: '一定要接 GND ↔ GND：`e35`（X1 的 GND）→ − 電源軌。本課的驗收也會檢查這一點。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-uart-hello', label: 'U1 已載入 hal-uart-hello 韌體' },
    { kind: 'connected', a: pa9, b: { component: 'X1', pin: 'RXD' }, label: 'PA9（TX）接到轉接器的 RXD' },
    { kind: 'connected', a: pa10, b: { component: 'X1', pin: 'TXD' }, label: 'PA10（RX）接到轉接器的 TXD' },
    { kind: 'connected', a: { component: 'X1', pin: 'GND' }, b: { terminal: 'PS1:-' }, label: '轉接器與電路共地' },
    {
      kind: 'uart-contains',
      component: 'X1',
      port: 'COM',
      text: 'Hello from STM32F103!',
      seconds: 0.5,
      label: '電腦端 COM 埠收到開機訊息',
    },
    { kind: 'uart-contains', component: 'X1', port: 'COM', text: 'tick 2', seconds: 2.5, label: '電腦端每秒收到一行計數訊息（已收到第 2 行）' },
    { kind: 'firmware-checks', project: 'hal-uart-hello', label: '韌體行為契約：115200 8N1、每秒計數與行回顯' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'frame',
      title: '認識 8N1 訊框與 BRR',
      body:
        '先弄懂訊框：115200 8N1 = 每秒 115 200 個位元、8 個資料位元、無同位、1 個停止位元，一個位元組（起始 + 8 資料 + 停止 = 10 個位元）要 **86.8 µs**。看懂後按「下一步」。\n\n' +
        'USART1 的時脈是 PCLK2 = 72 MHz：USARTDIV = 72 000 000 ÷ (16 × 115 200) = 39.0625 → **BRR = 0x271**（39 << 4 | 1）。HAL 的 `HAL_UART_Init()` 會幫你算好。',
      highlight: { components: ['U1', 'X1'] },
    },
    {
      id: 'tx',
      title: '接 TX → RXD',
      body: '點「導線」工具，再依序點 `j15`（PA9 = USART1_TX）與 `e39`（X1 的 RXD）。\n\n這是 MCU 說話、電腦聆聽的方向。',
      highlight: { holes: [PA9, 'e39'], components: ['X1'] },
      check: { kind: 'connected', a: pa9, b: { component: 'X1', pin: 'RXD' }, label: 'PA9 接到 X1 RXD' },
    },
    {
      id: 'rx-gnd',
      title: '接 RX ← TXD 與共地',
      body:
        '用導線接 `j16`（PA10 = USART1_RX）→ `e38`（X1 的 TXD），再接 `e35`（X1 的 GND）→ 上方 − 電源軌（例如 `top-27`）。\n\n' +
        '沒有共地，兩邊的「0」與「1」就沒有共同的參考電位。',
      highlight: { holes: [PA10, 'e38', 'e35'], components: ['X1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: pa10, b: { component: 'X1', pin: 'TXD' } },
          { kind: 'connected', a: { component: 'X1', pin: 'GND' }, b: { terminal: 'PS1:-' } },
        ],
        label: 'PA10 接到 X1 TXD，且 X1 共地',
      },
    },
    {
      id: 'firmware',
      title: '載入 hal-uart-hello，看開機訊息',
      body:
        '按下方的「載入 hal-uart-hello 到 U1」，再按「▶ 執行模擬」（或空白鍵）；打開儀器的「UART 終端機」，選擇 **X1 的 COM 埠**：開機就會出現 `Hello from STM32F103!`，之後每秒一行 `tick 1`、`tick 2`…\n\n' +
        '這些字元真的經過你接的 PA9 → RXD 這條線，才到達電腦端。',
      highlight: { components: ['X1', 'U1'] },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'hal-uart-hello' }, { kind: 'run' }],
      check: {
        kind: 'uart-contains',
        component: 'X1',
        port: 'COM',
        text: 'Hello from STM32F103!',
        seconds: 0.5,
        label: 'COM 埠收到開機訊息',
      },
    },
    {
      id: 'echo',
      title: '在終端機打字，看回顯',
      body:
        '在終端機輸入 `abc` 並送出（結尾附加 CR）：韌體回覆 `echo: abc`。\n\n' +
        '接收用 `HAL_UART_Receive_IT()` 一次收 1 個位元組，回呼函式把它放進緩衝區、遇到 CR 或 LF 才交給主迴圈回覆。\n\n' +
        '把邏輯分析儀接到 PA9、PA10 並加上 UART 解碼器（115200），可以看到每個位元組的起始位元、8 個資料位元（LSB 先送）與停止位元。',
      highlight: { holes: [PA9, PA10] },
      check: { kind: 'firmware-checks', project: 'hal-uart-hello', label: 'hal-uart-hello 行為契約（含回顯）' },
    },
    {
      id: 'baud',
      title: '試試鮑率不一致',
      body:
        '點一下 X1，在屬性面板把「COM 埠鮑率」改成 **9600**，看終端機出現亂碼；改回 **115200** 後恢復正常。體驗完記得恢復設定與接線，再到「驗收」按「檢查我的電路」。\n\n' +
        '差 12 倍的鮑率讓接收端在錯誤的時間點取樣。也可以試試把 TX、RX 兩條線對調：終端機會完全沒有輸出。',
      highlight: { components: ['X1'] },
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'usb_uart_ch340'],
    firmware: ['hal-uart-hello'],
  },
  durationMin: 30,
}
