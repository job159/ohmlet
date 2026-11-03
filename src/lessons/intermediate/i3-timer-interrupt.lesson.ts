/**
 * 中級 i3 — Timer 計時器中斷：72 MHz 下的 PSC／ARR 計算、更新中斷、NVIC。
 * Firmware: hal-tim-irq (solution: TIM4 1 kHz update interrupt toggles PB12,
 * every 500th toggles PC13); lesson-i3-offby1 reproduces the forgotten "− 1"
 * (firmware/projects/lesson-i3-offby1).
 */
import type { Lesson } from '../types'
import { benchLayout, leads, tap, type WireSpec } from './bench'

const PB12 = tap('PB12') // j10

// LED on the lower half: PB12 (j10) → f40, R1 g40–g44, LED1 h44 → bottom − rail (GND)
const parts = [
  leads('R1', 'resistor', ['g40', 'g44'], { resistance: 330 }),
  leads('LED1', 'led', ['h44', 'bot-35'], { color: 'red' }),
]
const startWires: WireSpec[] = []
const solutionWires: WireSpec[] = [...startWires, [PB12, 'f40', 'yellow']]

const pb12 = { component: 'U1', pin: 'PB12' } as const
const pc13 = { component: 'U1', pin: 'PC13' } as const

export const LESSON: Lesson = {
  id: 'i3-timer-interrupt',
  level: 'intermediate',
  order: 3,
  title: '計時器中斷：精準的 1 ms 時基',
  summary:
    '用 TIM4 的更新中斷產生精準的 1 kHz 時基：在 72 MHz 下算出 PSC 與 ARR，讓 PB12 輸出 500 Hz 方波、PC13 以 1 Hz 閃爍，並找出最常見的「少減 1」錯誤。',
  objectives: [
    '說明 APB1 預除頻為 2 時，TIM2～TIM4 的計時器時脈 TIMXCLK1 會倍頻回 72 MHz（而不是 PCLK1 的 36 MHz）。',
    '用 f_UEV = 72 MHz ÷ ((PSC + 1) × (ARR + 1)) 算出 PSC = 71、ARR = 999 → 每 1.000 ms 一次更新事件。',
    '理解更新中斷的路徑：UIF 旗標 → DIER.UIE → NVIC 的 TIM4_IRQn（IRQ 30）→ `HAL_TIM_PeriodElapsedCallback()`。',
    '用邏輯分析儀量出 PB12 = 500 Hz、工作週期 50 %，PC13 = 1.000 Hz，並與 `HAL_Delay()` 的 0.998 Hz 比較。',
    '親手重現 PSC = 72、ARR = 1000 的「少減 1」錯誤：頻率變成 492.66 Hz（−1.47 %）。',
  ],
  wiring:
    '電源與上一課相同：PS1（5 V）→ 下方 + 電源軌 → Blue Pill 的 5V 腳；3V3 腳接上方 + 電源軌；兩條 − 電源軌都是 GND。\n\n' +
    '麵包板下半部已經放好 **R1（330 Ω）** 與紅色 **LED1**：\n' +
    '- R1 一端在 g40、另一端在 g44；\n' +
    '- LED1 的陽極（長腳）在 h44，與 R1 的右腳同一個 5 孔組（第 44 欄的 f–j），陰極插在下方 − 電源軌（GND）。\n\n' +
    '你只需要接一條線：**PB12 → R1**。PB12 位於 h 列第 10 欄，唯一的空孔是 **j10**（j 列第 10 欄）；從 `j10` 拉線到 `f40`（R1 左腳所在的第 40 欄）。\n\n' +
    '完成後的電流路徑：PB12 → R1 → LED1 → GND。板載 LED 接在 PC13（低電位點亮），不需要接線。',
  theory:
    '**1. 計時器時脈從哪裡來？** `SystemClock_Config()` 讓 SYSCLK = HCLK = 72 MHz，APB1 除以 2 得到 PCLK1 = 36 MHz（APB1 上限 36 MHz）。RM0008 的時脈樹規定：APB 預除頻不是 1 時，該匯流排上的計時器時脈要 **× 2**，所以 TIM2、TIM3、TIM4 的 TIMXCLK1 = 2 × 36 MHz = **72 MHz**。用 36 MHz 去算，結果會差兩倍。\n\n' +
    '**2. PSC 與 ARR。** 計數器先經過 16 位元預除頻器 PSC（除以 PSC + 1），再從 0 數到自動重載值 ARR，下一個時脈回到 0 並產生**更新事件**，所以一個週期有 ARR + 1 個計數：\n' +
    '- 更新事件頻率 f_UEV = TIMXCLK ÷ ((PSC + 1) × (ARR + 1))；\n' +
    '- `hal-tim-irq`：PSC = 71 → 72 MHz ÷ 72 = 1 MHz（每計數 1 µs）；ARR = 999 → 1000 個計數 = **1.000 ms**，f_UEV = 1000 Hz；\n' +
    '- PSC 與 ARR 都是 16 位元（最大 65535），72 MHz 下最長的更新週期是 65536 × 65536 ÷ 72 MHz ≈ 59.65 s。\n\n' +
    '**3. 更新中斷。** 每次更新事件，`TIM4_SR` 的 UIF 被設為 1；`HAL_TIM_Base_Start_IT()` 會設定 `TIM4_DIER` 的 UIE 並啟動計數器（CR1.CEN）。NVIC 中 TIM4_IRQn（IRQ 30）致能後，CPU 進入 `TIM4_IRQHandler()` → `HAL_TIM_IRQHandler()` 清除 UIF → 呼叫 `HAL_TIM_PeriodElapsedCallback()`。\n\n' +
    '**4. 本課的韌體。** 回呼函式每次反轉 PB12：1 ms 高、1 ms 低 → **500 Hz**、工作週期 50 %；每第 500 次中斷再反轉 PC13：500 ms 亮、500 ms 滅 → **1.000 Hz**。主迴圈只執行 `__WFI()`（等待中斷時讓 CPU 休眠），時間完全由硬體計時器決定，不會像 `HAL_Delay(500)` 那樣多出 1 ms（上一課量到的 0.998 Hz），也不會因為主迴圈多做事而漂移。\n\n' +
    '**5. 為什麼 LED1 看起來是「半亮」？** 500 Hz 遠高於人眼約 50～60 Hz 的閃爍融合頻率，所以 LED1 看起來是穩定的半亮。點亮時電流 I = (3.3 − 1.75) V ÷ (330 + 50) Ω ≈ 4.1 mA，平均只有 50 % × 4.1 mA ≈ **2.0 mA**——這正是下一課 PWM 調光的原理。\n\n' +
    '**6. 啟動時的小陷阱。** `HAL_TIM_Base_Init()` 會設定 EGR.UG 讓 PSC 立即生效，同時也把 UIF 設為 1。若不先 `__HAL_TIM_CLEAR_FLAG(&htim4, TIM_FLAG_UPDATE)`，一啟動中斷就會立刻進來一次，第一個週期變短。`hal-tim-irq` 已經處理好這一點。',
  start: {
    layout: benchLayout(
      'i3 計時器中斷（起始）',
      'Blue Pill 已接電源；R1（330 Ω）與 LED1 已放在下半部，但還沒接到 PB12，也還沒載入韌體。',
      parts,
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i3 計時器中斷（解答）',
      'PB12（j10）→ f40 → R1 330 Ω → LED1 → GND；韌體 hal-tim-irq：TIM4 每 1 ms 中斷一次，PB12 = 500 Hz 方波，PC13 = 1 Hz。',
      parts,
      solutionWires,
    ),
    firmware: { U1: 'hal-tim-irq' },
  },
  expected: [
    'PB12：1.000 ms 高、1.000 ms 低的方波，頻率 500 Hz、工作週期 50 %，邊緣只有約 ±0.2 µs 的中斷延遲抖動，長時間也不漂移。',
    'PC13：500 ms 亮、500 ms 滅，頻率 1.000 Hz（用 HAL_Delay(500) 時是 0.998 Hz），每個 PC13 邊緣都落在 PB12 邊緣之後 2 µs 以內。',
    'LED1 看起來穩定半亮：點亮時約 4.1 mA，平均約 2.0 mA。',
    '載入 `lesson-i3-offby1`（PSC = 72、ARR = 1000）時：每 73 × 1001 = 73073 個時脈才中斷一次（1.014903 ms），PB12 只有 492.66 Hz，PC13 半週期 507.45 ms。',
    '屬性面板的腳位模式：PB12 與 PC13 都是「推挽」（推挽輸出）；電氣規則檢查沒有錯誤。',
  ],
  mistakes: [
    {
      symptom: 'PB12 的頻率是 492.66 Hz 而不是 500 Hz，PC13 的半週期是 507 ms。',
      cause:
        '直接把「除以 72」「數 1000 下」寫成 PSC = 72、ARR = 1000，忘了暫存器的值要減 1：實際是除以 (72 + 1) × (1000 + 1) = 73073，更新週期 1.014903 ms（慢了 1.49 %）。按下方的「重現這個錯誤：載入 `lesson-i3-offby1`」即可重現。',
      fix: '一律寫成 `Prescaler = 72 - 1`、`Period = 1000 - 1`，讓程式本身表達「除以 72、數 1000 個」，並用邏輯分析儀量一次確認。',
    },
    {
      symptom: 'PB12 的頻率剛好是預期的兩倍（或一半）。',
      cause:
        '用 PCLK1 = 36 MHz 去算 TIM4，卻忘了 APB1 預除頻為 2 時計時器時脈會倍頻成 72 MHz（或反過來）。例如以 36 MHz 算出 PSC = 35，實際計數器是 72 MHz ÷ 36 = 2 MHz，中斷每 0.5 ms 一次，PB12 變成 1000 Hz。',
      fix: '查 RM0008 的時脈樹：APBx 預除頻 ≠ 1 時，TIMXCLK = 2 × PCLKx。也可以在程式中用 `HAL_RCC_GetPCLK1Freq() * 2` 計算，或在 CubeMX 的 時脈設定（`Clock Configuration`）頁面直接看 APB1 計時器時脈（`APB1 Timer clocks`）。',
    },
    {
      symptom: '計數器在跑（在記憶體檢視中看到 TIM4_CNT 一直變化），PB12 卻一直不動。',
      cause:
        '用了 `HAL_TIM_Base_Start()`（只設 CEN）而不是 `HAL_TIM_Base_Start_IT()`（同時設 DIER.UIE）；或沒有在 `HAL_TIM_Base_MspInit()` 裡呼叫 `HAL_NVIC_EnableIRQ(TIM4_IRQn)`。UIF 會被設為 1，但中斷永遠不會進入 CPU。',
      fix: '確認三件事都做了：DIER.UIE（`HAL_TIM_Base_Start_IT()`）、NVIC 致能 TIM4_IRQn、`stm32f1xx_it.c` 中有 `TIM4_IRQHandler()` 呼叫 `HAL_TIM_IRQHandler(&htim4)`。',
    },
    {
      symptom: '第一個中斷在啟動計時器後馬上出現，第一個週期明顯比 1 ms 短。',
      cause: '`HAL_TIM_Base_Init()` 產生的 UG 事件已經把 UIF 設為 1，一致能中斷就立即觸發。',
      fix: '在 `HAL_TIM_Base_Start_IT()` 之前呼叫 `__HAL_TIM_CLEAR_FLAG(&htim4, TIM_FLAG_UPDATE)`，第一次中斷就會在一個完整週期後出現。',
    },
    {
      symptom: '在回呼函式裡加了 `printf()` 或 `HAL_Delay()` 之後，PB12 的週期變得不規則，PC13 的 1 Hz 也不準了。',
      cause:
        '中斷處理時間超過 1 ms 的中斷週期：下一次更新事件來時上一次還沒結束，中斷被合併或延後，時基因此遺失。`HAL_Delay()` 在中斷中更可能因為 SysTick 優先權較低而卡死。',
      fix: '回呼只做最短的事（反轉腳位、設旗標、計數），把耗時工作交給主迴圈。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-tim-irq', label: 'U1 已載入 hal-tim-irq 韌體' },
    {
      kind: 'connected',
      a: pb12,
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'PB12 經 150 Ω～1 kΩ 的限流電阻接到 LED1 陽極',
    },
    { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: { terminal: 'PS1:-' }, label: 'LED1 陰極接 GND' },
    {
      kind: 'measure',
      at: pb12,
      quantity: 'frequency',
      min: 495,
      max: 505,
      seconds: 0.5,
      fresh: true,
      label: 'PB12 的頻率為 500 Hz（±1 %）',
    },
    { kind: 'measure', at: pb12, quantity: 'duty', min: 49, max: 51, seconds: 0.5, fresh: true, label: 'PB12 的工作週期為 50 %' },
    {
      kind: 'measure',
      at: pc13,
      quantity: 'frequency',
      min: 0.99,
      max: 1.01,
      seconds: 3,
      fresh: true,
      label: 'PC13 心跳 LED 的頻率為 1.00 Hz（±1 %）',
    },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'math',
      title: '先算出 PSC 與 ARR',
      body:
        '算一算：要每 **1 ms** 產生一次更新中斷，選 PSC = 71、ARR = 999（72 MHz ÷ 72 ÷ 1000 = 1000 Hz）。看懂後按「下一步」。\n\n' +
        '- TIM4 在 APB1 上，PCLK1 = 36 MHz，但 APB1 預除頻為 2，所以計時器時脈 TIMXCLK1 = 2 × 36 MHz = **72 MHz**。\n' +
        '- 選 PSC = 71：72 MHz ÷ (71 + 1) = 1 MHz，每個計數 1 µs。\n' +
        '- 選 ARR = 999：數 0～999 共 1000 個計數 = 1 ms。\n\n' +
        '驗算：f_UEV = 72 000 000 ÷ (72 × 1000) = **1000 Hz**。PB12 每次中斷反轉一次，所以是 500 Hz 的方波。',
      highlight: { components: ['U1'] },
    },
    {
      id: 'wire',
      title: '把 PB12 接到 LED',
      body:
        '點「導線」工具，再依序點 `j10`（PB12 唯一的空孔）與 `f40`，把 PB12 接到 R1。\n\n' +
        '第 40 欄的 f–j 五個孔是同一個網路，導線因此接上 R1 的左腳；R1 的右腳與 LED1 陽極在第 44 欄，LED1 陰極在下方 − 電源軌。',
      highlight: { holes: [PB12, 'f40'], components: ['R1', 'LED1'] },
      check: {
        kind: 'connected',
        a: pb12,
        b: { component: 'LED1', pin: 'anode' },
        via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
        label: 'PB12 經 R1 接到 LED1 陽極',
      },
    },
    {
      id: 'firmware',
      title: '載入 hal-tim-irq 韌體',
      body:
        '按下方的「載入 hal-tim-irq 到 U1」，把內建韌體 **hal-tim-irq** 燒進 U1。\n\n' +
        '重點程式：\n\n' +
        '- `htim4.Init.Prescaler = 71; htim4.Init.Period = 999;`\n' +
        '- `__HAL_TIM_CLEAR_FLAG(&htim4, TIM_FLAG_UPDATE); HAL_TIM_Base_Start_IT(&htim4);`\n' +
        '- 主迴圈只有 `__WFI();`，所有工作都在 `HAL_TIM_PeriodElapsedCallback()` 裡完成。',
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-tim-irq', label: 'U1 已載入 hal-tim-irq' },
    },
    {
      id: 'measure',
      title: '用邏輯分析儀量 PB12',
      body:
        '模擬會自動執行，打開儀器的「邏輯分析儀」，加入 U1 的 **PB12** 通道。放大到毫秒尺度：高、低各 **1.000 ms**，頻率 500 Hz。\n\n' +
        '再看 LED1：它看起來是穩定的半亮，因為 500 Hz 的閃爍太快，人眼只看到平均值（約 2.0 mA）。',
      highlight: { components: ['LED1'], holes: [PB12] },
      check: {
        kind: 'measure',
        at: pb12,
        quantity: 'frequency',
        min: 495,
        max: 505,
        seconds: 0.5,
        fresh: true,
        label: 'PB12 = 500 Hz',
      },
    },
    {
      id: 'heartbeat',
      title: '比較 PC13 的 1 Hz 心跳',
      body:
        '再加一個通道 **PC13**：板載 LED 500 ms 亮、500 ms 滅，頻率 **1.000 Hz**。對照第一課用 `HAL_Delay(500)` 量到的 0.998 Hz——計時器中斷沒有「+1 ms」，也不受主迴圈影響。\n\n' +
        '把時間軸放大到 PC13 的邊緣附近：它總是落在某個 PB12 邊緣之後 2 µs 以內，因為兩者在同一次中斷中反轉。',
      highlight: { components: ['U1'] },
      check: { kind: 'measure', at: pc13, quantity: 'frequency', min: 0.99, max: 1.01, seconds: 3, fresh: true, label: 'PC13 = 1 Hz' },
    },
    {
      id: 'offby1',
      title: '重現「少減 1」的錯誤',
      body:
        '按下方的「載入 `lesson-i3-offby1` 到 U1」：它把 PSC 寫成 72、ARR 寫成 1000。重新量 PB12，頻率變成 **492.66 Hz**；體驗完按「換回 hal-tim-irq」，再到「驗收」按「檢查我的電路」。\n\n' +
        '算算看：72 MHz ÷ (73 × 1001) = 985.31 Hz 的更新頻率，週期 2 × 1.014903 ms，差了 1.47 %——一天下來會慢約 21 分鐘。',
      highlight: { components: ['U1'] },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'lesson-i3-offby1' }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'resistor', 'led'],
    firmware: ['hal-tim-irq', 'lesson-i3-offby1'],
  },
  durationMin: 30,
}
