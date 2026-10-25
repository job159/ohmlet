/**
 * 中級 i2 — EXTI 外部中斷：PB12 按鈕（內部上拉、下降緣）、NVIC、軟體去彈跳。
 * Firmware: hal-button-exti (solution); lesson-i2-nonvic reproduces the
 * missing HAL_NVIC_EnableIRQ() (firmware/projects/lesson-i2-nonvic).
 * The press checks press SW1 themselves (final round: a runtime stimulus on
 * 「按下」, the inspector's runtime-param path): one press → 「press 1」 on
 * USART1 after the 20 ms debounce, and LED1 toggles on.
 */
import type { Lesson, LessonCheck } from '../types'
import { anchored, benchLayout, leads, tap, type WireSpec } from './bench'

const PA5 = tap('PA5') // a20
const PB12 = tap('PB12') // j10

const ledParts = [
  leads('R1', 'resistor', ['a36', 'a40'], { resistance: 330 }),
  leads('LED1', 'led', ['b40', 'top-32'], { color: 'red' }),
]
const startWires: WireSpec[] = [[PA5, 'e36', 'yellow']]
// SW1 at f45: A1 f45 / A2 e45 (one side), B1 f47 / B2 e47 (other side)
const button = anchored('SW1', 'pushbutton', 'f45')
const solutionWires: WireSpec[] = [...startWires, [PB12, 'j45', 'orange'], ['j47', 'bot-47', 'black']]

const pb12 = { component: 'U1', pin: 'PB12' } as const
const gnd = { terminal: 'PS1:-' } as const

/** The check presses SW1 once itself (0.3 s → 0.4 s): the firmware counts one debounced press. */
const PRESS_ONCE: LessonCheck = {
  kind: 'uart-contains',
  component: 'U1',
  port: 'USART1',
  text: 'press 1',
  seconds: 0.5,
  stimulus: [
    { at: 0.3, component: 'SW1', param: 'pressed', value: true },
    { at: 0.4, component: 'SW1', param: 'pressed', value: false },
  ],
  label: '按一下 SW1：終端機印出第 1 次按下',
}

export const LESSON: Lesson = {
  id: 'i2-exti-button',
  level: 'intermediate',
  order: 2,
  title: 'EXTI 外部中斷：按鈕與去彈跳',
  summary:
    '把按鈕接到 PB12，用內部上拉電阻與 EXTI 下降緣中斷偵測按下，弄懂 AFIO 的 EXTI 選擇、NVIC 致能與 20 ms 軟體去彈跳。',
  objectives: [
    '說明 PB12 如何經由 AFIO_EXTICR4 接到 EXTI12，並在下降緣（FTSR）觸發中斷。',
    '知道 EXTI10～15 共用同一個中斷向量 `EXTI15_10_IRQn`，而且必須以 `HAL_NVIC_EnableIRQ()` 在 NVIC 中致能。',
    '理解內部上拉電阻（約 40 kΩ）讓放開時讀到 3.3 V、按下時讀到 0 V，按下時只流過約 83 µA。',
    '說明為什麼按鈕需要去彈跳，以及「最後一次下降緣後 20 ms 仍為低準位才算一次按下」的演算法。',
    '用 UART 終端機觀察 `press N` 計數，並用韌體行為契約驗證去彈跳。',
  ],
  wiring:
    '起始電路沿用上一課：PA5（a20）→ e36 → R1 330 Ω → LED1 → GND，電源也已接好。\n\n' +
    '本課要加上按鈕：\n' +
    '- 在「元件庫」點一下「按鈕（輕觸開關）」，再點 **f45**（f 列第 45 欄）放下，A1 腳就在 f45（它會自動命名為 **SW1**）。按鈕跨在中央溝槽上，佔用第 45 欄與第 47 欄的 e、f 列；**A1/A2（第 45 欄）在內部相連，B1/B2（第 47 欄）在內部相連**，按下時 A 側與 B 側導通。\n' +
    '- PB12 在 h 列第 10 欄，唯一的空孔是 **j10**：從 `j10` 拉線到 `j45`（按鈕 A 側）。\n' +
    '- 從 `j47`（按鈕 B 側）拉線到下方 − 電源軌（GND），例如 `bot-47`（下方 − 電源軌第 47 孔）。\n\n' +
    '不需要外接上拉電阻：韌體會打開 PB12 的內部上拉。',
  theory:
    '**1. 從腳位到 EXTI。** STM32F103 有 16 條 GPIO 外部中斷線 EXTI0～EXTI15，第 n 條線可以選 PAn、PBn、PCn… 其中之一，選擇寫在 AFIO 的 `AFIO_EXTICR1`～`4`。PB12 對應 **EXTI12**，`AFIO_EXTICR4` 的 EXTI12[3:0] = `0001`（B 埠）。所以要用 EXTI，AFIO 的時脈也必須打開（CubeMX 產生的 `HAL_MspInit()` 已經呼叫 `__HAL_RCC_AFIO_CLK_ENABLE()`）。\n\n' +
    '**2. 邊緣與旗標。** `GPIO_MODE_IT_FALLING` 讓 HAL 設定 `EXTI_IMR` 的第 12 位元（不遮罩）與 `EXTI_FTSR` 的第 12 位元（下降緣觸發）。PB12 由 1 變 0 時，`EXTI_PR` 的 PR12 被設為 1，並送出中斷請求。\n\n' +
    '**3. NVIC。** EXTI10～15 共用一個中斷 `EXTI15_10_IRQn`（IRQ 40）。只有在 NVIC 中致能（`HAL_NVIC_EnableIRQ()` 會設定 `NVIC_ISER1` 的第 8 位元）時，CPU 才會跳進 `EXTI15_10_IRQHandler()`。處理函式呼叫 `HAL_GPIO_EXTI_IRQHandler(GPIO_PIN_12)`：先寫 1 清除 PR12，再呼叫你的 `HAL_GPIO_EXTI_Callback()`。若忘了清除 PR12，中斷會一再重入。\n\n' +
    '**4. 內部上拉。** 輸入上拉模式下，PB12 經約 40 kΩ（資料手冊 30～50 kΩ）接到 3.3 V。按鈕放開時 PB12 = 3.3 V（邏輯 1）；按下時 PB12 直接接地 = 0 V，流過上拉電阻的電流只有 3.3 V ÷ 40 kΩ ≈ **83 µA**。\n\n' +
    '**5. 機械彈跳與去彈跳。** 真實按鈕的金屬接點在按下與放開的 0.1～10 ms 內會反覆彈開，產生一串邊緣；若每個下降緣都算一次，按一次可能被數成好幾次。`hal-button-exti` 的做法：中斷只記下 `HAL_GetTick()` 並重新開始 20 ms 的觀察期；主迴圈在「距離最後一次下降緣已滿 20 ms 且 PB12 仍為 0」時才接受這次按下，然後反轉 PA5 並以 USART1（115200 8N1）印出 `press N`。因為邊緣可能落在 1 ms 計時週期中的任何位置，按下會在最後一次下降緣後 **19～20 ms** 被接受；放開時的彈跳（之後腳位回到 1）永遠不會被算到。\n\n' +
    '**6. 中斷要短。** 在中斷裡呼叫 `HAL_Delay()` 或印出字串會卡住其他中斷（包括驅動 `HAL_GetTick()` 的 SysTick）。把耗時的工作留給主迴圈，是嵌入式程式的基本守則。',
  start: {
    layout: benchLayout(
      'i2 EXTI 按鈕（起始）',
      'Blue Pill 已接電源，PA5 → R1 330 Ω → LED1 → GND 已接好；還沒有按鈕，也還沒載入韌體。',
      ledParts,
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i2 EXTI 按鈕（解答）',
      '按鈕 SW1 跨在第 45／47 欄：PB12（j10）→ j45（A 側），j47（B 側）→ GND；韌體 hal-button-exti：每按一次 PA5 反轉，並由 USART1 印出按壓次數。',
      [...ledParts, button],
      solutionWires,
    ),
    firmware: { U1: 'hal-button-exti' },
  },
  expected: [
    '按鈕放開時 PB12 ≈ 3.3 V（內部上拉），按下時 0 V；按下時上拉電阻只流過約 83 µA。',
    '每按一次（按住多久都一樣）LED1 反轉一次，UART 終端機（USART1，115200 8N1）依序出現 `press 1`、`press 2`…；開機時不會印出任何字。',
    '一次按下在最後一次下降緣後 19～20 ms 被接受，PA5 反轉後約 0.08～0.15 ms 送出第一個字元。',
    '韌體行為契約 hal-button-exti 的 4 次執行全部通過：彈跳的按下只算 1 次、放開時的彈跳與短於 19 ms 的低脈衝不算。',
    '屬性面板的腳位模式：PB12 為「上拉」（上拉輸入）、PA5 為「推挽」。',
  ],
  mistakes: [
    {
      symptom: '按鈕怎麼按都沒有反應，PB12 一直是 3.3 V。',
      cause:
        '按鈕的另一側接到了 3.3 V（上方 + 電源軌）而不是 GND。PB12 本來就被內部上拉到 3.3 V，按下時只是把 3.3 V 接到 3.3 V，不會出現下降緣。',
      fix: '按鈕一側接 PB12、另一側接 GND（− 電源軌），搭配內部上拉；若改用下拉輸入，按鈕才接 3.3 V，並改成上升緣觸發。',
    },
    {
      symptom: '開機後就一次也偵測不到按下，量 PB12 一直是 0 V。',
      cause:
        '兩條線都接到按鈕的同一側（例如 j45 與 e45 都屬於 A1/A2）：A1 與 A2 在按鈕內部本來就相連，PB12 因此一直被接地，永遠不會再出現下降緣。',
      fix: 'PB12 接 A 側（第 45 欄），GND 接 B 側（第 47 欄）。不確定時用萬用電表量：放開時兩條線之間應該是斷路。',
      // acceptance: 0 firmware · 1 button · 2 PB12 via the button to GND · 5 PB12 ≈ 3.3 V released
      match: { checks: [2, 5], passes: [0, 1] },
    },
    {
      symptom: '接線與韌體看似正確，按下按鈕時 LED1 不反轉、終端機也沒有任何輸出。',
      cause:
        'EXTI 已設定、PR12 也被設為 1，但 NVIC 沒有致能 `EXTI15_10_IRQn`，中斷永遠進不了 CPU。按下方的「重現這個錯誤：載入 `lesson-i2-nonvic`」即可重現（它少了 `HAL_NVIC_EnableIRQ(EXTI15_10_IRQn)`）。',
      fix: '在 `MX_GPIO_Init()` 最後加上 `HAL_NVIC_SetPriority(EXTI15_10_IRQn, 0, 0); HAL_NVIC_EnableIRQ(EXTI15_10_IRQn);`，並確認 `stm32f1xx_it.c` 中有 `EXTI15_10_IRQHandler()`。',
      // acceptance: 1 button · 2 PB12 via the button to GND · 5 PB12 ≈ 3.3 V released · 8 one press counted (the check presses SW1)
      match: { checks: [8], passes: [1, 2, 5] },
    },
    {
      symptom: '自己寫的程式在中斷裡直接計數，實機上按一次常常跳 2～5 次，但在模擬器裡怎麼按都只算 1 次。',
      cause:
        '機械彈跳：每次彈開都是一個新的下降緣。模擬器的按鈕是理想開關，不會彈跳，所以手按重現不了；韌體行為契約則用 0.3～0.5 ms 的刺激脈衝模擬彈跳（hal-button-exti 行為契約中的彈跳按壓情境）。',
      fix: '中斷只記錄時間，由主迴圈在最後一次邊緣後等滿 20 ms 且腳位仍為低準位時才接受；或用硬體 RC 濾波（例如 10 kΩ + 100 nF，時間常數 1 ms）。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-button-exti', label: 'U1 已載入 hal-button-exti 韌體' },
    { kind: 'has-part', type: 'pushbutton', label: '電路中有一顆按鈕' },
    { kind: 'connected', a: pb12, b: gnd, via: { type: 'pushbutton' }, label: 'PB12 經按鈕接到 GND' },
    { kind: 'not-connected', a: pb12, b: { hole: 'top+0' }, label: 'PB12 沒有接到 3.3 V' },
    {
      kind: 'connected',
      a: { component: 'U1', pin: 'PA5' },
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'PA5 經限流電阻接到 LED1',
    },
    {
      kind: 'measure',
      at: pb12,
      quantity: 'voltage',
      min: 3.0,
      max: 3.4,
      seconds: 0.3,
      fresh: true,
      label: '按鈕放開時 PB12 ≈ 3.3 V（內部上拉已啟用）',
    },
    { kind: 'firmware-checks', project: 'hal-button-exti', label: '韌體行為契約：EXTI 下降緣與 20 ms 去彈跳' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
    {
      kind: 'all',
      label: '按一下 SW1：中斷計數一次，LED1 反轉成亮',
      checks: [
        PRESS_ONCE,
        {
          kind: 'measure',
          at: { component: 'LED1', pin: 'anode' },
          quantity: 'current',
          component: 'LED1',
          min: 0.002,
          max: 0.015,
          seconds: 0.4,
          fresh: true,
          stimulus: [
            { at: 0.1, component: 'SW1', param: 'pressed', value: true },
            { at: 0.15, component: 'SW1', param: 'pressed', value: false },
          ],
          label: '放開後 LED1 保持亮著（PA5 反轉成高電位）',
        },
      ],
    },
  ],
  steps: [
    {
      id: 'place',
      title: '放上按鈕',
      body:
        '按下方的「拿一顆按鈕（輕觸開關）」（或在「元件庫」點一下「按鈕（輕觸開關）」），再點 `f45`，讓 A1 腳落在 f45。\n\n' +
        '按鈕會跨在中央溝槽上：A1/A2 在第 45 欄，B1/B2 在第 47 欄，中間的第 46 欄被按鈕本體蓋住。記住：**同一側的兩腳在內部是相連的**，按下時才讓 A 側與 B 側導通。',
      highlight: { holes: ['f45', 'e45', 'f47', 'e47'] },
      check: { kind: 'has-part', type: 'pushbutton', label: '已放上按鈕' },
    },
    {
      id: 'wire',
      title: '把按鈕接在 PB12 與 GND 之間',
      body:
        '用「導線」工具從 `j10`（PB12 唯一的空孔）接到 `j45`（A 側），再從 `j47`（B 側）接到下方 − 電源軌，例如 `bot-47`。\n\n' +
        '不需要外接電阻——韌體會把 PB12 設成 `GPIO_PULLUP`，由晶片內約 40 kΩ 的上拉電阻把它拉到 3.3 V。',
      highlight: { holes: [PB12, 'j45', 'j47', 'bot-47'], components: ['SW1'] },
      check: { kind: 'connected', a: pb12, b: gnd, via: { type: 'pushbutton' }, label: 'PB12 經按鈕接到 GND' },
      // the button was placed in the previous step: only its two wires here (開始接線 marks each end)
      action: [
        {
          kind: 'wire',
          wires: [
            [PB12, 'j45'],
            ['j47', 'bot-47'],
          ],
        },
      ],
    },
    {
      id: 'firmware',
      title: '載入 hal-button-exti',
      body:
        '按下方的「載入 hal-button-exti 到 U1」，把內建韌體 **hal-button-exti** 燒進 U1。\n\n' +
        '`MX_GPIO_Init()` 的重點：\n\n' +
        '- `GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING; GPIO_InitStruct.Pull = GPIO_PULLUP;`\n' +
        '- `HAL_NVIC_SetPriority(EXTI15_10_IRQn, 0, 0); HAL_NVIC_EnableIRQ(EXTI15_10_IRQn);`\n\n' +
        '中斷回呼 `HAL_GPIO_EXTI_Callback()` 只記下時間，判斷交給主迴圈。',
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-button-exti', label: 'U1 已載入 hal-button-exti' },
    },
    {
      id: 'pullup',
      title: '確認內部上拉',
      body:
        '按上方的「▶ 執行模擬」（或空白鍵），把游標停在 PB12 上看電壓（或用萬用電表量；手機：點一下 PB12）：放開時約 **3.3 V**。\n\n' +
        '在屬性面板看 PB12 的腳位模式：**上拉**（上拉輸入）。按住按鈕時變成 0 V——上拉電阻只流過 3.3 V ÷ 40 kΩ ≈ 83 µA。',
      highlight: { holes: [PB12], components: ['SW1'] },
      check: { kind: 'measure', at: pb12, quantity: 'voltage', min: 3.0, max: 3.4, seconds: 0.3, fresh: true, label: 'PB12 ≈ 3.3 V' },
    },
    {
      id: 'press',
      title: '按下按鈕，看中斷計數',
      body:
        '打開儀器的「UART 終端機」，選 U1 的 **USART1**（115200 8N1），然後按幾下按鈕（在麵包板上按，或在屬性面板勾選 SW1 的「按下」）：每按一次 LED1 反轉，終端機印出 `press 1`、`press 2`…。\n\n' +
        '按住不放也只算一次，因為只有下降緣會觸發。把邏輯分析儀接到 PB12 與 PA5：PA5 的邊緣出現在 PB12 下降緣之後約 19～20 ms，這就是去彈跳的觀察期。',
      highlight: { components: ['SW1', 'LED1'] },
      check: PRESS_ONCE,
      action: { kind: 'run' },
    },
    {
      id: 'contract',
      title: '用行為契約驗證去彈跳',
      body:
        '按「檢查此步驟」，用韌體行為契約驗證去彈跳；想重現 NVIC 沒致能的錯誤，可按下方的「載入 `lesson-i2-nonvic` 到 U1」：按鈕怎麼按都沒反應，體驗後按「換回 hal-button-exti」。\n\n' +
        '模擬器的按鈕不會彈跳，所以去彈跳要用「韌體行為契約」驗證：它在 hal-button-exti 自己的測試台上，以 0.3～0.5 ms 的刺激脈衝模擬彈跳的按下與放開，以及 15 ms 的短脈衝，檢查 PA5 與 UART 的每一個邊緣與時間窗。',
      check: { kind: 'firmware-checks', project: 'hal-button-exti', label: 'hal-button-exti 行為契約' },
      action: { kind: 'load-firmware', component: 'U1', project: 'lesson-i2-nonvic' },
    },
  ],
  runnable: 'partial',
  runnableNote:
    '按鈕元件是理想開關，按下與放開時不會產生機械彈跳；去彈跳演算法改由韌體行為契約以 0.3～0.5 ms 的刺激脈衝在模擬中驗證。其餘（EXTI、NVIC、內部上拉、UART 輸出）皆為真實模擬。',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'resistor', 'led', 'pushbutton'],
    firmware: ['hal-button-exti', 'lesson-i2-nonvic'],
  },
  durationMin: 30,
}
