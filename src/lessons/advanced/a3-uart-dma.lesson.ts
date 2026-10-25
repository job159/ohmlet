/**
 * a3 — STM32 UART + DMA：環形接收緩衝區、HT／TC／IDLE 事件、CPU 在位元組進來時休息。
 *
 * Firmware: firmware/dist/lesson-a3-uart-dma (ST HAL): USART2 TX (PA2, DMA1
 * channel 7) plays the external device — one message every 200 ms, 5 / 23 /
 * 40 bytes in turn — and USART1 RX (PA10) receives it by DMA1 channel 5 in
 * CIRCULAR mode into a 32-byte ring with HAL_UARTEx_ReceiveToIdle_DMA; each
 * message is reported on USART1 TX (PA9) with its reception events, the
 * number of interrupts it cost and the time spent in them (DWT). PB0 is high
 * while a reception interrupt runs (the CPU's share, on the logic analyzer).
 * Experiment jumpers read at reset: PB12 → GND = DMA NORMAL mode never
 * re-armed (only the first message arrives), PB13 → GND = one RXNE interrupt
 * per byte. Every number below is what the simulation produces
 * (tests/lessons/advanced.test.ts).
 */
import type { Lesson } from '../types'
import { GND, TAP, bench, bullets, doc, pin, wire } from './bench'

const FW = 'lesson-a3-uart-dma'

const START = bench('a3 UART DMA（起始）', [], [])

const SOLUTION = bench('a3 UART DMA（解答）', [], [wire('W7', TAP.PA2, TAP.PA10, 'yellow')])

const RING = 'RX: DMA1 ch5 circular, 32 B ring + IDLE line detection'
const MSG1 = 'msg #1: 5 B [idle] irq=1 '
const MSG3 = 'msg #3: 40 B [tc ht tc idle] irq=4 '

export const LESSON: Lesson = {
  id: 'a3-uart-dma',
  level: 'advanced',
  order: 3,
  title: 'STM32 UART + DMA：環形緩衝區與 IDLE 偵測',
  summary:
    '用 USART2（U1 PA2）扮演外部感測器，每 200 ms 送出一筆長度不固定的訊息；USART1（U1 PA10）用 DMA1 通道 5 的環形模式把位元組收進 32 位元組的緩衝區，再靠 IDLE（線路閒置）事件知道「一筆訊息結束了」。40 個位元組只花 4 次中斷——位元組進來時 CPU 在 `__WFI()` 裡休息。',
  objectives: [
    '說明 DMA 環形模式（`DMA_CIRCULAR`）：DMA1 通道 5 把 USART1_DR 收到的每個位元組搬進 `rx_ring[32]`，寫到結尾自動回到開頭，CPU 不必重新啟動它',
    '分辨三種接收事件：半滿 HT（寫到位置 16）、全滿 TC（寫到位置 32＝繞回）、IDLE（最後一個位元組之後線路閒置一個字元的時間）',
    '知道 `HAL_UARTEx_RxEventCallback()` 的 `Size` 在環形模式是「DMA 目前寫到的位置」，要用上次讀到的位置 `rx_pos` 才能取出跨越繞回點的訊息',
    '用 UART 報告與邏輯分析儀上的 U1 PB0（板上 B0）比較兩種接收方式的 CPU 負擔：40 B 的訊息，DMA 只要 4 次中斷，每個位元組一次中斷（RXNE）要 41 次',
    '知道 DMA 一般模式（`DMA_NORMAL`）在 IDLE 之後就停了：沒有重新啟動，之後的位元組全部遺失',
  ],
  wiring: doc(
    '電源與 Blue Pill（U1）已經接好：下方 + 電源軌（bot+）是 5 V，上方 + 電源軌（top+）是 Blue Pill 的 3.3 V，兩條 − 電源軌都是 GND。韌體 `lesson-a3-uart-dma` 已經選好。',
    '本課只要接 **一條線**，讓 Blue Pill 自己的兩個 UART 對講：',
    bullets(
      '從 `a23`（U1 PA2（板上 A2）唯一的空孔，USART2_TX）拉線到 `j16`（U1 PA10（板上 A10）唯一的空孔，USART1_RX）。',
      'USART2 在這裡扮演「外部感測器」：它用 DMA1 通道 7 送出訊息，送的時候同樣不佔用 CPU。',
      'U1 PA9（板上 A9）是 USART1_TX：韌體把每一筆收到的訊息整理成一行報告，從這裡送到「UART 終端機」（115200 8N1），不需要接線。',
      'U1 PB0（板上 B0）不用接線：CPU 在接收中斷裡時它是高電位，等一下放到邏輯分析儀上看。',
    ),
    '兩個實驗用的跳線位置：U1 PB12（板上 B12）的空孔 `j10`、U1 PB13（板上 B13）的空孔 `j11`。韌體只在重置時讀它們，接上 GND 之後要按「重置 MCU」（實驗步驟下方的按鈕，或 U1 的屬性面板）。',
  ),
  theory: doc(
    '**一個字元多長**：115200 8N1 的一個字元有起始位元、8 個資料位元、停止位元共 10 個位元，10 ÷ 115200 Bd = **86.8 µs**。所以 5 B 的 `hello` 在線上約 0.43 ms，40 B 的訊息約 3.47 ms。',
    '**不用 DMA 的話**：每收到一個位元組，USART1 的 RXNE 旗標就要求一次中斷，CPU 進中斷把 USART1_DR 讀出來。40 B 就是 40 次中斷（加上最後的 IDLE 共 41 次）。在 115200 Bd 還吃得消，但到 1 Mbps 時每 10 µs 就要進一次中斷，CPU 幾乎做不了別的事。',
    '**DMA 環形模式**：DMA1 通道 5 接在 USART1_RX 的請求線上（RM0008 的 DMA1 請求對應表）。每收到一個位元組，DMA 自己把它從 USART1_DR 搬到 `rx_ring[n]`，計數暫存器 `CNDTR` 從 32 往下數；數到 0 時（環形模式）自動重新載入 32、位址回到開頭。CPU 只在兩個時間點被叫醒：',
    bullets(
      '**HT**（半滿，`Half Transfer`）：寫到位置 16',
      '**TC**（全滿，`Transfer Complete`）：寫到位置 32，也就是繞回 0',
    ),
    '**IDLE 偵測**：訊息的長度事先不知道，只靠 HT／TC 永遠等不到「最後幾個位元組」。USART 在 RX 線路閒置一個字元的時間（86.8 µs）後設定 SR 的 IDLE 旗標；`HAL_UARTEx_ReceiveToIdle_DMA()` 會打開 IDLEIE，所以一筆訊息結束後約 87 µs 就有一次 IDLE 事件。',
    '**`Size` 是位置，不是長度**：在環形模式下，回呼函式 `HAL_UARTEx_RxEventCallback(huart, Size)` 的 `Size` 是 DMA 目前寫到的位置（1～32）。韌體記住上一次處理到的位置 `rx_pos`，每次取出 `rx_ring[rx_pos]`～`rx_ring[Size − 1]`，`Size` 等於 32 時下一次從 0 開始。位置會一直延續到下一筆訊息：',
    bullets(
      '`msg #1`：5 B，位置 0 → 5，只有 IDLE → `[idle] irq=1`',
      '`msg #2`：23 B，位置 5 → 28，經過 16 → `[ht idle] irq=2`',
      '`msg #3`：40 B，位置 28 → 32（TC，4 B）→ 16（HT）→ 32（TC）→ 4（IDLE）→ `[tc ht tc idle] irq=4`',
    ),
    '**CPU 的帳**：韌體用 DWT 週期計數器量中斷裡花掉的時間。40 B 的 `msg #3` 用 DMA 時 4 次中斷共約 29 µs；改成每個位元組一次中斷（PB13 接地）是 41 次、約 73 µs，而且每 86.8 µs 就被打斷一次。主迴圈沒事時執行 `__WFI()` 休息，U1 PB0（板上 B0）只在中斷裡是高電位，邏輯分析儀上看得一清二楚。',
    '**一般模式的陷阱**：`DMA_NORMAL` 傳完（或 IDLE 被 HAL 停止）之後 DMA 就關掉了。如果沒有在回呼裡重新呼叫 `HAL_UARTEx_ReceiveToIdle_DMA()`，之後的位元組沒有人收，USART1 只會設定溢位（ORE）旗標——只收得到第一筆訊息。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART 終端機開機訊息：`UART DMA lesson a3: USART2 TX (PA2) -> USART1 RX (PA10), 115200 8N1`、`RX: DMA1 ch5 circular, 32 B ring + IDLE line detection`',
    '約 0.117 s：`msg #1: 5 B [idle] irq=1 isr=12.2 us: hello`',
    '約 0.321 s：`msg #2: 23 B [ht idle] irq=2 isr=18.7 us: T=23.5C H=45% P=1013hPa`',
    '約 0.524 s：`msg #3: 40 B [tc ht tc idle] irq=4 isr=29.3 us: 0123456789abcdefghijklmnopqrstuvwxyzABCD`；之後每 200 ms 一筆，依序循環',
    '邏輯分析儀：U1 PA10 上一筆 40 B 的訊息長約 3.47 ms（每個字元 86.8 µs），同一段時間 U1 PB0 只有 3～4 個短脈波——個數就是終端機上那一筆的 `irq=`（`msg #3` 是 4 個；緩衝區的位置每一輪都不同，之後的 40 B 訊息有時是 3 個）',
    'U1 PB13 接地並重置後：`msg #3: 40 B [idle] irq=41 isr=73.0 us: …`；U1 PB12 接地並重置後只會出現 `msg #1`',
  ],
  // `match` ties a mistake to the pass / fail pattern of the acceptance checks below
  // (0 PA2–PA10 · 1 PB12 open · 2 PB13 open · 3 firmware · 4 ring boot line · 5 msg #1
  // · 6 msg #3 · 7 contract · 8 ERC) — the check results show it as 「最可能的原因」.
  mistakes: [
    {
      symptom: 'UART 終端機只有兩行開機訊息，之後一筆 `msg` 都沒有',
      cause: 'U1 PA2（板上 A2）沒有接到 U1 PA10（板上 A10）：USART2 送出的訊息根本沒有進到 USART1 的 RX 腳，DMA 一個位元組也收不到。常見的情況是線接到了旁邊的 `j15`（U1 PA9（板上 A9），那是 USART1 的 TX）',
      fix: '從 `a23` 拉線到 `j16`，TX 一定要接 RX',
      match: { checks: [0] },
    },
    {
      symptom: '只收到 `msg #1: 5 B [idle] …`，之後再也沒有訊息，韌體也沒有當掉',
      cause:
        'DMA 設成一般模式（`DMA_NORMAL`）：IDLE 時 HAL 把 DMA 停掉，回呼裡又沒有重新呼叫 `HAL_UARTEx_ReceiveToIdle_DMA()`，之後的位元組沒有人收，只會讓 USART1 設定溢位旗標。在模擬器重現：把 U1 PB12（板上 B12）的空孔 `j10` 接到 GND，再按「重置 MCU」，開機訊息會多一行 `PB12 low: RX DMA in NORMAL mode, not re-armed after the first message`',
      fix: '接收用 `DMA_CIRCULAR`，或在回呼裡重新啟動接收；做完實驗把 `j10` 的接地線拆掉',
      match: { checks: [1] },
    },
    {
      symptom: '訊息內容正確，但 40 B 的訊息要 `irq=41`、中斷時間變成兩倍多，邏輯分析儀上 U1 PB0 密密麻麻',
      cause:
        '接收改成每個位元組一次中斷（RXNE）：CPU 每 86.8 µs 就被打斷一次。在模擬器重現：把 U1 PB13（板上 B13）的空孔 `j11` 接到 GND，再按「重置 MCU」',
      fix: '大量或長度不固定的資料用 DMA 環形接收加 IDLE 偵測；做完實驗把 `j11` 的接地線拆掉',
      match: { checks: [2] },
    },
    {
      symptom: '自己改寫的回呼裡，跨過緩衝區結尾的訊息前後顛倒、少了一段或重複一段',
      cause: '把 `Size` 當成「這次收到幾個位元組」：環形模式下它是 DMA 目前寫到的位置，訊息可能從位置 28 開始、繞回 0 之後在 4 結束',
      fix: '用上次讀到的位置 `rx_pos` 到 `Size` 取資料，`Size` 等於緩衝區大小時下一次從 0 開始；緩衝區至少要能容納兩次事件之間收到的位元組',
    },
  ],
  acceptance: [
    {
      kind: 'connected',
      a: pin('PA2'),
      b: pin('PA10'),
      label: 'U1 PA2（板上 A2，USART2_TX）接到 U1 PA10（板上 A10，USART1_RX）',
    },
    { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12（板上 B12）沒有接地（DMA 用環形模式）' },
    { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13（板上 B13）沒有接地（用 DMA 接收，不是每個位元組一次中斷）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a3-uart-dma 韌體' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: RING, seconds: 0.1, label: 'USART1 以 DMA 環形模式加 IDLE 偵測接收' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: MSG1, seconds: 0.3, label: '第一筆 5 B 的訊息只用 1 次中斷（IDLE）就收完' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: MSG3,
      seconds: 0.7,
      label: '40 B 的訊息跨過緩衝區結尾，只用 4 次中斷（TC、HT、TC、IDLE）',
    },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（腳位、開機訊息、每 200 ms 一筆訊息）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'wire',
      title: '接線：USART2_TX → USART1_RX',
      body: doc(
        '按下方的「開始接線」（或點「導線」工具），依序點 `a23`（U1 PA2（板上 A2）的空孔）與 `j16`（U1 PA10（板上 A10）的空孔）。',
        'PA2 是 USART2 的 TX，PA10 是 USART1 的 RX：一條線就讓 Blue Pill 自己對自己送資料。USART2 扮演外部裝置，每 200 ms 送一筆訊息；USART1 用 DMA 把它收下來。',
      ),
      highlight: { holes: [TAP.PA2, TAP.PA10], components: ['U1'] },
      check: { kind: 'connected', a: pin('PA2'), b: pin('PA10'), label: 'U1 PA2 接到 U1 PA10' },
    },
    {
      id: 'run',
      title: '執行：第一筆訊息只用 1 次中斷',
      body: doc(
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，打開儀器的「UART 終端機」（USART1，115200 8N1）。約 0.12 s 會出現 `msg #1: 5 B [idle] irq=1 isr=12.2 us: hello`。',
        '`hello` 的 5 個位元組全部由 DMA 搬進 `rx_ring[0]`～`rx_ring[4]`，CPU 一次都沒有被叫醒，直到最後一個位元組後線路閒置 86.8 µs，IDLE 事件才觸發唯一的一次中斷。`isr=12.2 us` 是這次中斷花掉的 CPU 時間。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: MSG1, seconds: 0.3 },
    },
    {
      id: 'ring',
      title: '環形緩衝區繞回：HT 與 TC',
      body: doc(
        '繼續看終端機：`msg #2: 23 B [ht idle] irq=2`、`msg #3: 40 B [tc ht tc idle] irq=4`。',
        'DMA 的寫入位置會延續：`msg #1` 之後在 5，`msg #2` 從 5 寫到 28（經過 16，所以有 HT），`msg #3` 從 28 開始——寫到 32 是 TC（繞回 0），再到 16 是 HT，到 32 又是 TC，最後停在 4 由 IDLE 收尾。韌體每次都從上次的位置 `rx_pos` 取到 `Size`，所以 40 個字元一個也沒有少。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: MSG3, seconds: 0.7 },
    },
    {
      id: 'analyzer',
      title: '用邏輯分析儀看 CPU 何時在工作',
      body: doc(
        '按下方的「把 PA10、PB0 加到邏輯分析儀」：邏輯分析儀會跳到最近一筆 40 B 的訊息（5 ms 的視窗，標記 A 在第一個起始位元）。U1 PA10 上是約 3.47 ms 的一串字元，U1 PB0 卻只有 3～4 個很短的高脈波——那就是 CPU 進中斷的時間，個數就是終端機上這一筆的 `irq=`。',
        '其餘時間主迴圈在 `__WFI()` 裡休息。DMA 的寫入位置每一輪往後移 4 個位元組，所以每一筆 40 B 訊息經過 HT、TC 的次數不一樣：`msg #3` 是 TC、HT、TC、IDLE 共 4 次，`msg #6` 是 HT、TC、IDLE 共 3 次——不論哪一筆，都遠少於每個位元組一次中斷的 41 次。把時間軸放大到一個字元（86.8 µs）可以看到起始位元、8 個資料位元（低位元先送）與停止位元。',
      ),
      highlight: { components: ['U1'] },
      // the button shows the message the step talks about: the latest 40 B burst on PA10 (≈ 3.47 ms) in a 5 ms window
      action: [
        { kind: 'add-logic', component: 'U1', pins: ['PA10', 'PB0'], view: { span: 0.005, burstOn: 'PA10', minBurst: 0.003, label: '40 B 訊息' } },
        { kind: 'run' },
      ],
    },
    {
      id: 'rxne',
      title: '實驗：每個位元組一次中斷',
      body: doc(
        '按下方的「開始接線」，從 `j11`（U1 PB13（板上 B13）的空孔）接到 `bot-7`（下方 − 電源軌），再按下方的「重置 MCU」：開機訊息多了 `PB13 low: RX by interrupt, RXNE for every byte + IDLE`，`msg #3` 變成 `40 B [idle] irq=41 isr=73.0 us`，U1 PB0 上是 41 個脈波。看完後請拆掉這條線，再按「重置 MCU」。',
        '收到的內容完全一樣，但 CPU 每 86.8 µs 就被打斷一次。韌體只在重置時讀這條跳線，所以拆線後要再重置一次；驗收條件要求 U1 PB13 不接地。',
      ),
      highlight: { holes: [TAP.PB13, 'bot-7'] },
      check: { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13 沒有接地' },
      action: [
        { kind: 'wire', wires: [[TAP.PB13, 'bot-7']] },
        { kind: 'reset', scope: 'mcu' },
        { kind: 'unwire', wires: [[TAP.PB13, 'bot-7']] },
        { kind: 'run' },
      ],
    },
    {
      id: 'normal',
      title: '實驗：DMA 一般模式沒有重新啟動',
      body: doc(
        '按下方的「開始接線」，從 `j10`（U1 PB12（板上 B12）的空孔）接到 `bot-6`，再按下方的「重置 MCU」：只會出現 `msg #1`，之後再也收不到任何訊息。看完後請拆掉這條線，再按「重置 MCU」。',
        '這是 DMA 接收最常見的錯誤：一般模式在 IDLE 之後就停了，沒有人重新啟動。韌體只在重置時讀這條跳線，拆線並重置後，再到「驗收」按「檢查我的電路」。',
      ),
      highlight: { holes: [TAP.PB12, 'bot-6'] },
      check: { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12 沒有接地' },
      action: [
        { kind: 'wire', wires: [[TAP.PB12, 'bot-6']] },
        { kind: 'reset', scope: 'mcu' },
        { kind: 'unwire', wires: [[TAP.PB12, 'bot-6']] },
        { kind: 'run' },
      ],
    },
  ],
  runnable: 'ready',
  requires: { parts: ['stm32_bluepill', 'power_supply'], firmware: [FW], instrument: 'uart' },
  durationMin: 35,
}
