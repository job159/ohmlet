/**
 * a4 — STM32 + FreeRTOS：任務、優先權、佇列，以及 SVC／PendSV／SysTick 在
 * 模擬的 Cortex-M3 上切換任務。
 *
 * Firmware: firmware/dist/lesson-a4-freertos — FreeRTOS-Kernel V11.1.0, port
 * GCC/ARM_CM3 built with clang, heap_4 (8 KiB), tick 1 kHz on SysTick. Tasks
 * fast (prio 3, vTaskDelayUntil 100 ms) and blink (prio 2, 250 ms, toggles
 * PA5) send to an 8-entry queue; logger (prio 1) is the only task that
 * writes USART1 (a gatekeeper) and prints one line per message plus a
 * statistics line every second (context switches counted in
 * traceTASK_SWITCHED_IN, idle share from the run-time statistics on
 * DWT->CYCCNT). PB12 (button to GND) → EXTI15_10 at NVIC priority 6 →
 * xQueueSendFromISR + portYIELD_FROM_ISR. Experiment jumpers read at reset:
 * PB13 → GND creates task hog (prio 4) that busy-loops from 1000 ms on;
 * PB14 → GND gives the button interrupt priority 2 (above
 * configMAX_SYSCALL_INTERRUPT_PRIORITY 5) — the first press ends in
 * configASSERT (vPortValidateInterruptPriority, port.c:805). Every line and
 * number below was produced by this firmware on the simulator
 * (tests/lessons/advanced.test.ts).
 */
import type { Lesson } from '../types'
import { GND, TAP, anchored, bench, bullets, doc, part, pin, wire } from './bench'

const FW = 'lesson-a4-freertos'

/** LED1 + R1 (220 Ω) on PA5 — wired in the starting circuit. */
const R1 = part('R1', 'resistor', ['a36', 'a40'], { resistance: 220 })
const LED1 = part('LED1', 'led', ['b40', 'top-32'], { color: 'red' })
/** SW1 straddles the channel: A1 f45 / A2 e45, B1 f47 / B2 e47. */
const SW1 = anchored('SW1', 'pushbutton', 'f45')

const LED_WIRE = wire('W7', TAP.PA5, 'e36', 'yellow')

const START = bench('a4 FreeRTOS（起始）', [R1, LED1, SW1], [LED_WIRE])

const SOLUTION = bench(
  'a4 FreeRTOS（解答）',
  [R1, LED1, SW1],
  [
    LED_WIRE,
    wire('W8', TAP.PB12, 'j45', 'orange'), // PB12 → SW1 A side
    wire('W9', 'j47', 'bot-38', 'black'), // SW1 B side → GND
  ],
)

const BOOT = 'heap free 5192 B, starting the scheduler'

export const LESSON: Lesson = {
  id: 'a4-freertos',
  level: 'advanced',
  order: 4,
  title: 'STM32 + FreeRTOS：任務、優先權與佇列',
  summary:
    '在模擬的 Cortex-M3 上執行真正的 `FreeRTOS-Kernel V11.1.0`：兩個週期性任務把訊息送進佇列，最低優先權的 `logger` 任務負責印出；按鈕中斷用 `xQueueSendFromISR()` 叫醒它。看懂 SVC 啟動第一個任務、SysTick 每 1 ms 一個 `tick`、PendSV 切換任務，再親手重現兩個即時作業系統的經典錯誤：不讓出 CPU 的高優先權任務，以及優先權設錯的中斷。',
  objectives: [
    '說明任務（`task`）、優先權與阻塞：`vTaskDelayUntil()` 讓任務睡到下一個週期，就緒的任務裡優先權最高的那個才會執行',
    '用佇列（`queue`）在任務之間、以及中斷與任務之間傳遞資料，並說明「只有一個任務碰 UART」（守門任務）為什麼不需要互斥鎖',
    '說明 Cortex-M3 移植層的三個例外：SVC 啟動第一個任務、SysTick 每 1 ms 推進 `tick`、PendSV（最低優先權）保存與還原 R4–R11 完成任務切換',
    '從 UART 的時間戳與每秒統計算出任務切換次數（每秒 38 次）與 CPU 閒置比例（約 96 %～97 %）',
    '理解 `configMAX_SYSCALL_INTERRUPT_PRIORITY`：數值比 5 小（更緊急）的中斷不能呼叫 `…FromISR()` 函式，否則 `configASSERT` 會停下整個系統',
  ],
  wiring: doc(
    '電源與 Blue Pill（U1）已經接好：下方 + 電源軌（bot+）是 5 V，上方 + 電源軌（top+）是 3.3 V，兩條 − 電源軌都是 GND。',
    bullets(
      '**LED1 已經接好**：U1 PA5（板上 A5）的空孔 `a20` → `e36` → R1（220 Ω）→ LED1 陽極（`b40`）→ LED1 陰極插在上方 − 電源軌。`blink` 任務每 250 ms 反轉一次 PA5。',
      '**按鈕 SW1 已經放好**（跨在中央溝槽上，A 側在第 45 欄、B 側在第 47 欄），但還沒接線：等一下從 `j10`（U1 PB12（板上 B12）的空孔）接到 `j45`，再從 `j47` 接到下方 − 電源軌。韌體會打開 PB12 的內部上拉並設定下降緣中斷。',
      'USART1（U1 PA9（板上 A9），115200 8N1）只由 `logger` 任務輸出，在「UART 終端機」查看，不需要接線。',
    ),
    '兩個實驗用的跳線位置：U1 PB13（板上 B13）的空孔 `j11`、U1 PB14（板上 B14）的空孔 `j12`。韌體只在重置時讀它們：接上 GND 之後要按「重置 MCU」（實驗步驟下方的按鈕，或 U1 的屬性面板）。',
  ),
  theory: doc(
    '**任務與優先權**：FreeRTOS 的排程器永遠執行「就緒」任務中優先權最高的那一個（數字越大越優先，閒置任務是 0）。本課有三個任務：',
    bullets(
      '**`fast`**（優先權 3）：`vTaskDelayUntil()` 每 100 ms 醒來一次，把 {序號、`tick`} 送進佇列',
      '**`blink`**（優先權 2）：每 250 ms 反轉 U1 PA5（板上 A5）一次（LED1 亮 250 ms、滅 250 ms，2 Hz），也送一筆訊息',
      '**`logger`**（優先權 1）：在 `xQueueReceive(q, &m, portMAX_DELAY)` 上阻塞，收到一筆就印一行；每 4 筆 `blink`（1 秒）多印一行統計',
    ),
    '`vTaskDelayUntil()` 以「上一次預定醒來的時間」為基準，週期不會因為任務本身花的時間而漂移；`vTaskDelay()` 則是從呼叫當下開始算。',
    '**佇列與守門任務**：佇列長 8、每筆 8 個位元組（`msg_t`）。`fast` 與 `blink` 的優先權都比 `logger` 高，所以送進佇列時不會立刻切換——訊息在佇列裡等到它們都阻塞了，`logger` 才依序印出。`tick` 500 時 `fast` 先醒（印出 `[   500] fast  #5`），`blink` 接著醒（`[   500] blink #2 LED off`）；統計裡的 `queue peak 2/8` 就是這個時刻佇列裡同時有 2 筆。UART 只有 `logger` 會用，所以輸出永遠不會交錯，也不需要互斥鎖。',
    '**三個例外撐起整個 RTOS**（`GCC/ARM_CM3` 移植層）：',
    bullets(
      '**SVC**：`vTaskStartScheduler()` 以 `svc 0` 進入 `vPortSVCHandler`，從第一個任務的堆疊還原暫存器，切到 PSP 後回到執行緒模式——從此每個任務有自己的堆疊',
      '**SysTick**：每 1 ms 一次（72 MHz ÷ 72000），`xPortSysTickHandler()` 推進 `tick`；如果有更高優先權的任務因此醒來，就把 PendSV 設為待處理（本課的 `SysTick_Handler` 也同時呼叫 `HAL_IncTick()`）',
      '**PendSV**：優先權最低（15），等所有中斷都處理完才執行：把目前任務的 R4–R11 推到它的 PSP 堆疊、呼叫 `vTaskSwitchContext()` 選出下一個任務、再從新任務的堆疊還原——這就是「任務切換」',
    ),
    '**每秒 38 次任務切換**：只有 `fast` 醒的 `tick`（100、200、300、400、600、700、800、900，共 8 次）各是 閒置 → `fast` → `logger` → 閒置 = 3 次；只有 `blink` 醒的 `tick`（250、750）也各 3 次；兩個同時醒的 `tick`（500、1000）是 閒置 → `fast` → `blink` → `logger` → 閒置 = 4 次。8 × 3 + 2 × 3 + 2 × 4 = **38**。`logger` 用輪流查詢方式送 UART（每個字元 86.8 µs），一秒約印 15 行，所以 CPU 約 3 % 的時間在工作、**96 %～97 % 在閒置任務**。',
    '**中斷優先權的界線**：STM32F1 的 NVIC 有 4 個優先權位元（0 最緊急、15 最不緊急）。本課設定 `configMAX_SYSCALL_INTERRUPT_PRIORITY` = 5：核心進入臨界區時把 BASEPRI 設成 0x50（優先權 5 左移 4 位元），優先權 5～15 的中斷暫時被擋住，0～4 永遠不會被 RTOS 延遲，但也**不可以**呼叫任何 FreeRTOS 函式。按鈕中斷設為 6，可以安全地呼叫 `xQueueSendFromISR()`；`portYIELD_FROM_ISR(woken)` 讓 `logger` 在中斷結束時立刻執行。',
    '**看得到的數字**：`heap free 5192 B` 是 heap_4 的 8192 B 建立 1 個佇列與 3 個任務後剩下的量（三個任務的堆疊就佔了 160 + 160 + 320 個字 = 2560 B）；統計行最後的 `stack free … words` 是各任務堆疊從來沒被用到的字數（高水位），數字太小就要加大堆疊。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    '開機（約 0.02 s 內）：`FreeRTOS V11.1.0 on STM32F103C8, 72 MHz, tick 1000 Hz`、`tasks: fast prio 3 every 100 ms, blink prio 2 every 250 ms, logger prio 1; queue 8 x 8 B`、`heap free 5192 B, starting the scheduler`',
    '排程器約在上電後 0.022 s 啟動（`tick` 0）：約 0.122 s 出現 `[   100] fast  #1`，約 0.273 s 出現 `[   250] blink #1 LED on`，LED1 亮起',
    '`tick` 500 時先 `[   500] fast  #5`（0.522 s）再 `[   500] blink #2 LED off`（0.524 s）：高優先權的任務先執行',
    '邏輯分析儀：U1 PA5 是 250 ms 高、250 ms 低的方波，頻率 2 Hz、工作週期 50 %',
    '約 1.035 s：`[  1000] stats: 38 context switches, idle 97.3%, queue peak 2/8, stack free fast 132 blink 132 logger 209 words`；之後每秒一行，閒置約 96.1 %',
    '按一下 SW1：約 0.2 ms 後開始印出 `[ <tick>] button #1 (EXTI ISR -> queue)`；50 ms 內的接點彈跳只算一次',
    'U1 PB13 接地並重置：印到 `[   900] fast  #9` 之後再也沒有輸出，LED1 停在亮；U1 PB14 接地並重置後按 SW1：`configASSERT failed: port.c:805`，系統停住',
  ],
  // acceptance indices: 0 firmware · 1 PA5 → LED1 · 2 PB12 → SW1 → GND · 3 PB13 open · 4 PB14 open
  // · 5 scheduler started · 6 blink task · 7 statistics · 8 PA5 2 Hz · 9 contract · 10 ERC
  mistakes: [
    {
      symptom: '約 0.9 s 之後 UART 終端機就再也沒有新的一行，LED1 停在亮的狀態，按 SW1 也沒有反應',
      cause:
        '有一個優先權最高的任務一直在跑、從不阻塞（沒有呼叫 `vTaskDelay()`、沒有等佇列）：排程器永遠選它，`fast`、`blink`、`logger` 與閒置任務全部餓死。SysTick 與中斷照樣在跑——按鈕的訊息其實進了佇列，只是 `logger` 永遠輪不到。在模擬器重現：把 U1 PB13（板上 B13）的空孔 `j11` 接到 GND 再按「重置 MCU」，韌體會建立優先權 4 的 `hog` 任務，1 s 後開始空轉',
      fix: '每個任務的迴圈裡都要有會阻塞的呼叫（`vTaskDelay()`、`vTaskDelayUntil()`、`xQueueReceive()`…）；需要一直計算的工作放在最低優先權。做完實驗把 `j11` 的接地線拆掉並重置',
      match: { checks: [3] },
    },
    {
      symptom: '開機正常，第一次按 SW1 就出現 `configASSERT failed: port.c:805`，之後整個系統停住',
      cause:
        '按鈕中斷的 NVIC 優先權是 2，比 `configMAX_SYSCALL_INTERRUPT_PRIORITY`（5）更緊急：這種中斷不會被核心的臨界區擋住，卻在裡面呼叫了 `xQueueSendFromISR()`，可能破壞核心的資料結構，所以 `vPortValidateInterruptPriority()` 的 `configASSERT` 直接停下系統。在模擬器重現：把 U1 PB14（板上 B14）的空孔 `j12` 接到 GND 再按「重置 MCU」，然後按 SW1',
      fix: '會呼叫 FreeRTOS 函式的中斷，優先權數值必須大於或等於 5（本課用 6）；做完實驗把 `j12` 的接地線拆掉並重置',
      match: { checks: [4] },
    },
    {
      symptom: '按「▶ 執行模擬」之後 UART 終端機一片空白，LED1 也不閃',
      cause: 'U1 還沒有韌體，或載入的不是 lesson-a4-freertos',
      fix: '按步驟 1 的「載入 lesson-a4-freertos 到 U1」，再執行',
      match: { checks: [0] },
    },
    {
      symptom: '任務的輸出都正常，按 SW1 卻從來沒有 `button #` 那一行',
      cause: '按鈕沒有接在 U1 PB12（板上 B12）與 GND 之間：例如兩條線都接到按鈕的同一側（第 45 欄的 A1／A2 在內部本來就相連），或另一側接到了 3.3 V',
      fix: '`j10` 接 `j45`（A 側），`j47`（B 側）接下方 − 電源軌',
      match: { checks: [2], passes: [0] },
    },
    {
      symptom: '自己的專案裡兩個任務都直接呼叫 `printf()`，終端機上的字元互相穿插',
      cause: 'UART 是共用資源：一個任務印到一半被更高優先權的任務搶走 CPU，另一個任務接著印',
      fix: '像本課一樣只讓一個守門任務碰 UART，其他任務把資料送進佇列；或用互斥鎖（`xSemaphoreCreateMutex()`）保護整行輸出',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a4-freertos 韌體' },
    {
      kind: 'connected',
      a: pin('PA5'),
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'U1 PA5（板上 A5）經限流電阻接到 LED1 陽極',
    },
    { kind: 'connected', a: pin('PB12'), b: GND, via: { type: 'pushbutton' }, label: 'U1 PB12（板上 B12）經按鈕 SW1 接到 GND' },
    { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13（板上 B13）沒有接地（沒有空轉的 `hog` 任務）' },
    { kind: 'not-connected', a: pin('PB14'), b: GND, label: 'U1 PB14（板上 B14）沒有接地（按鈕中斷的優先權合法）' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: BOOT, seconds: 0.1, label: '佇列與三個任務建立完成，排程器啟動' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: '[   250] blink #1 LED on',
      seconds: 0.4,
      label: '`blink` 任務在 `tick` 250 反轉 LED，`logger` 印出它的訊息',
    },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: '[  1000] stats: ', seconds: 1.2, label: '第 1 秒的統計（任務切換次數、閒置比例）印出' },
    {
      kind: 'measure',
      at: pin('PA5'),
      quantity: 'frequency',
      min: 1.95,
      max: 2.05,
      seconds: 2.5,
      fresh: true,
      label: 'U1 PA5 的 LED 以 2 Hz 閃爍（vTaskDelayUntil 每 250 ms）',
    },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（任務時序、統計、按鈕中斷與彈跳）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'firmware',
      title: '載入 FreeRTOS 韌體',
      body: doc(
        '按下方的「載入 lesson-a4-freertos 到 U1」，把內建的 FreeRTOS 韌體燒進 U1。',
        '`main()` 先用 HAL 設好 72 MHz 時脈、GPIO 與 USART1，接著 `xQueueCreate()` 建立佇列、`xTaskCreate()` 建立 `fast`、`blink`、`logger` 三個任務，最後呼叫 `vTaskStartScheduler()`——這個函式不會回來，之後 CPU 的時間全由排程器分配。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a4-freertos' },
    },
    {
      id: 'boot',
      title: '執行：排程器啟動',
      body: doc(
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，打開儀器的「UART 終端機」：三行開機訊息的最後一行是 `heap free 5192 B, starting the scheduler`。',
        '`vTaskStartScheduler()` 建立閒置任務、把 SysTick 設成每 1 ms 一次，再執行 `svc 0`：SVC 例外從 `fast` 任務（就緒任務中優先權最高）的堆疊還原暫存器並切換到 PSP，第一個任務就此開始。約 0.1 s 後第一行任務輸出是 `[   100] fast  #1`——方括號裡是 `tick`。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: BOOT, seconds: 0.1 },
    },
    {
      id: 'priorities',
      title: '讀懂時間線：優先權決定順序',
      body: doc(
        '在終端機找 `tick` 500 的兩行：先 `[   500] fast  #5`，再 `[   500] blink #2 LED off`。',
        '同一個 `tick` 裡 `fast`（優先權 3）與 `blink`（優先權 2）同時醒來，排程器先跑 `fast`；它們送進佇列的訊息要等兩個都阻塞了，最低優先權的 `logger` 才印出來。`fast` 每 100 ms、`blink` 每 250 ms，都用 `vTaskDelayUntil()`，所以週期不會漂移。',
      ),
      highlight: { components: ['U1', 'LED1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: '[   500] blink #2 LED off', seconds: 0.6 },
    },
    {
      id: 'analyzer',
      title: '用邏輯分析儀量 `blink` 任務',
      body: doc(
        '按下方的「把 PA5 加到邏輯分析儀」：U1 PA5 是 250 ms 高、250 ms 低的方波，頻率 2 Hz、工作週期 50 %，第一個上升緣約在上電後 0.27 s（`tick` 250）。',
        '每一個邊緣背後都是一次完整的任務切換：SysTick 推進 `tick` 到 250 → `blink` 從延遲清單移到就緒清單 → PendSV 保存閒置任務的 R4–R11、還原 `blink` 的暫存器 → `blink` 寫 PA5。',
      ),
      highlight: { components: ['LED1', 'R1'] },
      check: {
        kind: 'measure',
        at: pin('PA5'),
        quantity: 'frequency',
        min: 1.95,
        max: 2.05,
        seconds: 2.5,
        fresh: true,
        label: 'U1 PA5 以 2 Hz 閃爍',
      },
    },
    {
      id: 'stats',
      title: '每秒統計：任務切換與閒置時間',
      body: doc(
        '約 1.035 s 出現第一行統計：`[  1000] stats: 38 context switches, idle 97.3%, queue peak 2/8, stack free fast 132 blink 132 logger 209 words`。',
        '38 次切換可以自己算：只有 `fast` 醒的 8 個 `tick` 各 3 次（閒置 → `fast` → `logger` → 閒置）、只有 `blink` 醒的 2 個 `tick` 各 3 次、兩個一起醒的 `tick` 500 與 1000 各 4 次，8 × 3 + 2 × 3 + 2 × 4 = 38。閒置比例來自核心的執行時間統計（DWT 週期計數器）：`logger` 一秒約印 15 行，CPU 其餘約 97 % 的時間都在閒置任務。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: '[  1000] stats: ', seconds: 1.2 },
    },
    {
      id: 'button',
      title: '接上按鈕：中斷把訊息送進佇列',
      body: doc(
        '按下方的「開始接線」，從 `j10`（U1 PB12（板上 B12）的空孔）接到 `j45`（SW1 的 A 側），再從 `j47`（B 側）接到 `bot-38`（下方 − 電源軌）。接好後按幾下 SW1（{滑鼠：在麵包板上點按鈕｜觸控：點一下按鈕}，或在屬性面板勾選 SW1 的「按下」），終端機出現 `button #1 (EXTI ISR -> queue)`。',
        'EXTI15_10 中斷的優先權是 6：它在中斷裡呼叫 `xQueueSendFromISR()`，若 `logger` 因此醒來（比被打斷的閒置任務優先），`portYIELD_FROM_ISR()` 就讓 PendSV 在中斷結束時直接切到 `logger`，所以按下後約 0.2 ms 就開始印出。50 ms 內的接點彈跳只算一次。',
      ),
      highlight: { holes: [TAP.PB12, 'j45', 'j47', 'bot-38'], components: ['SW1'] },
      check: { kind: 'connected', a: pin('PB12'), b: GND, via: { type: 'pushbutton' }, label: 'U1 PB12 經 SW1 接到 GND' },
    },
    {
      id: 'hog',
      title: '實驗：不讓出 CPU 的任務',
      body: doc(
        '按下方的「開始接線」，從 `j11`（U1 PB13（板上 B13）的空孔）接到 `bot-8`，再按下方的「重置 MCU」：開機訊息多了 `PB13 low: task hog prio 4 busy-loops from 1000 ms on`，印到 `[   900] fast  #9` 之後就再也沒有輸出，LED1 停在亮。',
        '`hog` 任務的優先權最高、而且從不阻塞，其他任務全部餓死；SysTick 與按鈕中斷照樣在跑，只是沒有任務輪得到。做完實驗**把這條線拆掉，再按一次「重置 MCU」**，驗收條件要求 U1 PB13 不接地。',
      ),
      // the jumper's two holes only: the wire step frames them close enough to tap on a phone
      highlight: { holes: [TAP.PB13, 'bot-8'] },
      check: { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13 沒有接地' },
      action: [{ kind: 'wire', wires: [[TAP.PB13, 'bot-8']] }, { kind: 'reset', scope: 'mcu' }, { kind: 'run' }],
    },
    {
      id: 'bad-priority',
      title: '實驗：中斷優先權高過系統呼叫上限',
      body: doc(
        '按下方的「開始接線」，從 `j12`（U1 PB14（板上 B14）的空孔）接到 `bot-9`，按下方的「重置 MCU」，再按一下 SW1：終端機出現 `configASSERT failed: port.c:805`，系統停住。',
        '按鈕中斷的優先權被設成 2，比上限 5 更緊急：核心不能保證它呼叫 `xQueueSendFromISR()` 時資料結構是一致的，`vPortValidateInterruptPriority()` 檢查到就以 `configASSERT` 停下。做完實驗**把這條線拆掉，再按一次「重置 MCU」**，然後到「驗收」按「檢查我的電路」。',
      ),
      highlight: { holes: [TAP.PB14, 'bot-9'] },
      check: { kind: 'not-connected', a: pin('PB14'), b: GND, label: 'U1 PB14 沒有接地' },
      action: [{ kind: 'wire', wires: [[TAP.PB14, 'bot-9']] }, { kind: 'reset', scope: 'mcu' }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'resistor', 'led', 'pushbutton'],
    firmware: [FW],
    instrument: 'uart',
  },
  durationMin: 45,
}
