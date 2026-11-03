/**
 * 中級 i4 — PWM：頻率與工作週期的計算、LED 亮度、TIM1 的 MOE 陷阱。
 * Firmware: hal-tim-pwm (solution: TIM2 CH1 PA0 1 kHz 25 %, TIM3 CH1 PA6
 * 20 kHz 50 %, TIM1 CH1 PA8 2 kHz 75 %); lesson-i4-nomoe reproduces TIM1
 * started without BDTR.MOE (firmware/projects/lesson-i4-nomoe); hal-pwm-fade
 * is the breathing-LED extension.
 */
import type { Lesson } from '../types'
import { benchLayout, leads, tap, type WireSpec } from './bench'

const PA8 = tap('PA8') // j14
const PA0 = tap('PA0') // a25

const parts = [
  // lower half: PA8 → f40, R1 g40–g44, LED1 h44 → bottom − rail
  leads('R1', 'resistor', ['g40', 'g44'], { resistance: 330 }),
  leads('LED1', 'led', ['h44', 'bot-35'], { color: 'red' }),
  // upper half: PA0 → e40, R2 d40–d44, LED2 c44 → top − rail
  leads('R2', 'resistor', ['d40', 'd44'], { resistance: 330 }),
  leads('LED2', 'led', ['c44', 'top-35'], { color: 'red' }),
]
const startWires: WireSpec[] = []
const solutionWires: WireSpec[] = [...startWires, [PA8, 'f40', 'yellow'], [PA0, 'e40', 'green']]

const pa8 = { component: 'U1', pin: 'PA8' } as const
const pa0 = { component: 'U1', pin: 'PA0' } as const

export const LESSON: Lesson = {
  id: 'i4-pwm',
  level: 'intermediate',
  order: 4,
  title: 'PWM 脈寬調變：頻率、工作週期與 LED 亮度',
  summary:
    '用三個計時器的硬體 PWM 輸出控制 LED 亮度：算出 f_PWM 與工作週期，量到 PA8 = 2 kHz／75 %、PA0 = 1 kHz／25 %，並踩一次進階計時器 TIM1 的 MOE 陷阱。',
  objectives: [
    '用 f_PWM = TIMXCLK ÷ ((PSC + 1) × (ARR + 1)) 與工作週期 = CCR ÷ (ARR + 1) 設計任意 PWM。',
    '說明 PWM 模式 1（向上計數）：CNT < CCR 時輸出高準位，否則低準位；CCR ≥ ARR + 1 時恆為高。',
    '理解頻率與解析度的取捨：72 MHz 下 20 kHz 只剩 3600 階（約 11.8 位元）。',
    '知道 TIM1 是進階控制計時器，輸出還要經過 BDTR.MOE（主輸出致能）這道閘門。',
    '用邏輯分析儀量出頻率與工作週期誤差都在 ±1 % 以內，並用 LED 平均電流解釋亮度。',
  ],
  wiring:
    '電源已經接好（PS1 5 V → Blue Pill 5V 腳；3V3 → 上方 + 電源軌；兩條 − 電源軌為 GND）。麵包板上已經放好兩組 330 Ω 電阻與紅色 LED：\n' +
    '- 下半部：**R1** 在 g40–g44，**LED1** 陽極 h44、陰極在下方 − 電源軌；\n' +
    '- 上半部：**R2** 在 d40–d44，**LED2** 陽極 c44、陰極在上方 − 電源軌。\n\n' +
    '你要接兩條線：\n' +
    '- **PA8 → R1**：PA8（TIM1_CH1）位於 h 列第 14 欄，空孔是 **j14**（j 列第 14 欄）；從 `j14` 拉線到 `f40`。\n' +
    '- **PA0 → R2**：PA0（TIM2_CH1）位於 c 列第 25 欄，空孔是 **a25**；從 `a25` 拉線到 `e40`。\n\n' +
    'PA6（TIM3_CH1，20 kHz）不接負載，直接用邏輯分析儀觀察即可。',
  theory:
    '**1. PWM 是什麼？** 脈寬調變（PWM）用固定頻率的方波，改變每個週期中「高準位」所佔的比例（工作週期）。負載（LED、馬達、加熱器）或人眼只感受到平均值：工作週期 75 % 的 3.3 V 方波，平均就是 0.75 × 3.3 V ≈ 2.5 V。\n\n' +
    '**2. 計時器怎麼產生 PWM？** 計數器從 0 數到 ARR 再歸零（一個 PWM 週期 = ARR + 1 個計數）。在 **PWM 模式 1**（`TIM_OCMODE_PWM1`，極性高）中，CNT < CCR 時輸出高準位，CNT ≥ CCR 時輸出低準位：\n' +
    '- f_PWM = TIMXCLK ÷ ((PSC + 1) × (ARR + 1))；\n' +
    '- 工作週期 = CCR ÷ (ARR + 1)；CCR = 0 恆為低，CCR ≥ ARR + 1 恆為高。\n\n' +
    '**3. hal-tim-pwm 的三組設定（TIMXCLK 皆為 72 MHz）。**\n' +
    '- TIM1 CH1 → **PA8**：PSC 71、ARR 499、CCR1 375 → 72 MHz ÷ (72 × 500) = **2 kHz**，375 ÷ 500 = **75 %**（375 µs 高、125 µs 低）；\n' +
    '- TIM2 CH1 → **PA0**：PSC 71、ARR 999、CCR1 250 → **1 kHz**、**25 %**（250 µs 高、750 µs 低）；\n' +
    '- TIM3 CH1 → **PA6**：PSC 0、ARR 3599、CCR1 1800 → 72 MHz ÷ 3600 = **20 kHz**、**50 %**。\n\n' +
    '**4. 頻率與解析度的取捨。** 計數器每秒最多數 72 M 次，所以 f_PWM × (ARR + 1) ≤ 72 MHz：要 20 kHz（超過人耳聽得到的範圍，馬達不會嗡嗡叫）就只剩 3600 階；要 16 位元的 65536 階，頻率最高只有 72 MHz ÷ 65536 ≈ 1.1 kHz。\n\n' +
    '**5. LED 亮度。** LED 點亮時電流 I = (3.3 − 1.75) V ÷ (330 + 50) Ω ≈ 4.1 mA。2 kHz 遠快於人眼，看到的是平均：LED1（75 %）≈ 0.75 × 4.1 mA ≈ **3.1 mA**，LED2（25 %）≈ **1.0 mA**。人眼對亮度的感受接近對數，所以 25 % 看起來並不是「四分之一亮」。\n\n' +
    '**6. TIM1 的 MOE。** TIM1 是給馬達、電源轉換器用的進階控制計時器，有互補輸出、死區時間與煞車輸入。它的 OCx 輸出除了 CCER.CCxE 之外，還要 **BDTR.MOE = 1**（主輸出致能）才會送到腳位（RM0008 §14.4.18）；煞車訊號會清除 MOE，讓所有輸出立刻進入安全狀態。`HAL_TIM_PWM_Start()` 會自動設定 MOE，但自己寫暫存器時很容易漏掉。另外，腳位必須設成 **複用推挽輸出**（`GPIO_MODE_AF_PP`），計時器的輸出才能控制這支腳。',
  start: {
    layout: benchLayout(
      'i4 PWM（起始）',
      'Blue Pill 已接電源；R1／LED1 放在下半部、R2／LED2 放在上半部，還沒接到 PA8、PA0，也還沒載入韌體。',
      parts,
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i4 PWM（解答）',
      'PA8（j14）→ f40 → R1 → LED1；PA0（a25）→ e40 → R2 → LED2；韌體 hal-tim-pwm：PA8 2 kHz 75 %、PA0 1 kHz 25 %、PA6 20 kHz 50 %。',
      parts,
      solutionWires,
    ),
    firmware: { U1: 'hal-tim-pwm' },
  },
  expected: [
    'PA8（TIM1 CH1）：2.000 kHz，375 µs 高、125 µs 低，工作週期 75.0 %。',
    'PA0（TIM2 CH1）：1.000 kHz，250 µs 高、750 µs 低，工作週期 25.0 %。',
    'PA6（TIM3 CH1）：20.00 kHz，25 µs 高、25 µs 低，工作週期 50.0 %；所有邊緣都落在 13.9 ns（1 ÷ 72 MHz）的整數倍上，沒有抖動。',
    'LED1 明顯比 LED2 亮：平均電流約 3.1 mA 對 1.0 mA（點亮時都是約 4.1 mA）。',
    '用萬用電表的直流電壓檔量 PA8 會讀到約 2.3 V 的平均值，而不是 3.3 V 或 0 V。',
    '載入 `lesson-i4-nomoe` 時：PA0、PA6 照常輸出，PA8 一直是 0 V（工作週期 0 %），模擬日誌提示 TIM1 的 MOE = 0。',
  ],
  mistakes: [
    {
      symptom: 'PA0 與 PA6 的 PWM 都正常，只有 PA8（TIM1）完全沒有輸出，LED1 不亮。',
      cause:
        '用暫存器直接啟動 TIM1（只設 `CCER.CC1E` 與 `CR1.CEN`），漏了進階計時器特有的 `BDTR.MOE`：計數器在跑、比較也成立，但輸出閘門是關的。按下方的「重現這個錯誤：載入 `lesson-i4-nomoe`」即可重現，模擬日誌會提示 MOE = 0。',
      fix: '用 `HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1)`（它會呼叫 `__HAL_TIM_MOE_ENABLE()`），或自己加上 `TIM1->BDTR |= TIM_BDTR_MOE;`。',
    },
    {
      symptom: '頻率對了，工作週期卻是 74.85 %，或頻率變成 1.996 kHz。',
      cause:
        '把 ARR 寫成 500（而不是 500 − 1 = 499）：一個週期變成 501 個計數，f = 72 MHz ÷ (72 × 501) ≈ 1.996 kHz，375 ÷ 501 ≈ 74.85 %。',
      fix: '週期要 N 個計數就寫 `Period = N - 1`；工作週期用 CCR ÷ N 計算。',
    },
    {
      symptom: '用萬用電表量 PA8 只有約 2.3 V，以為腳位壞了或供電不足。',
      cause: '萬用電表的直流檔顯示的是平均值：75 % × 約 3.1 V（有 LED 負載時的高準位）≈ 2.3 V。PWM 的瞬間值只有「高」與「低」兩種。',
      fix: '用示波器或邏輯分析儀看波形；萬用電表的讀數可以當作「工作週期 × 高準位」的驗算。',
    },
    {
      symptom: '腳位一直是 0 V 或停在固定準位，雖然計時器設定都正確。',
      cause: 'GPIO 被設成一般輸出 `GPIO_MODE_OUTPUT_PP`（由 ODR 控制）而不是複用輸出 `GPIO_MODE_AF_PP`，計時器的 OC1 訊號沒有接到腳位上。',
      fix: '在 `HAL_TIM_MspPostInit()` 中把 PWM 腳位設成 `GPIO_MODE_AF_PP`；CubeMX 選擇 TIMx_CHy 時會自動產生這段程式。',
    },
    {
      symptom: 'LED 調光時看得到閃爍，或馬達發出刺耳的嗡嗡聲。',
      cause: 'PWM 頻率太低：低於約 100 Hz 時人眼會察覺閃爍；落在 20 Hz～20 kHz 時，馬達線圈會發出聽得到的聲音。',
      fix: 'LED 用 1 kHz 以上，馬達用 20 kHz 以上（例如本課的 TIM3：PSC 0、ARR 3599），再依需要在解析度與頻率之間取捨。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-tim-pwm', label: 'U1 已載入 hal-tim-pwm 韌體' },
    {
      kind: 'connected',
      a: pa8,
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'PA8 經限流電阻接到 LED1 陽極',
    },
    {
      kind: 'connected',
      a: pa0,
      b: { component: 'LED2', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'PA0 經限流電阻接到 LED2 陽極',
    },
    { kind: 'measure', at: pa8, quantity: 'frequency', min: 1980, max: 2020, seconds: 0.1, fresh: true, label: 'PA8 的 PWM 頻率為 2 kHz（±1 %）' },
    { kind: 'measure', at: pa8, quantity: 'duty', min: 74, max: 76, seconds: 0.1, fresh: true, label: 'PA8 的工作週期為 75 %（±1 %）' },
    { kind: 'measure', at: pa0, quantity: 'frequency', min: 990, max: 1010, seconds: 0.1, fresh: true, label: 'PA0 的 PWM 頻率為 1 kHz（±1 %）' },
    { kind: 'measure', at: pa0, quantity: 'duty', min: 24, max: 26, seconds: 0.1, fresh: true, label: 'PA0 的工作週期為 25 %（±1 %）' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'math',
      title: '設計 PWM：算出 PSC、ARR、CCR',
      body:
        '算一算：要讓 PA8 輸出 **2 kHz、75 %** 的 PWM，選 PSC = 71、ARR = 499、CCR1 = 375。看懂後按「下一步」。\n\n' +
        '- 選 PSC = 71：計數器 1 MHz（每計數 1 µs）。\n' +
        '- 2 kHz 的週期是 500 µs → ARR + 1 = 500 → **ARR = 499**。\n' +
        '- 75 % × 500 = **CCR1 = 375**：CNT = 0～374 時輸出高（375 µs），375～499 時輸出低（125 µs）。\n\n' +
        '自己練習：PA0 要 1 kHz、25 %，PSC = 71 時 ARR 與 CCR1 各是多少？（答案：999 與 250）',
      highlight: { components: ['U1'] },
    },
    {
      id: 'wire-pa8',
      title: '把 PA8 接到 LED1',
      body: '點「導線」工具，再依序點 `j14`（PA8 唯一的空孔）與 `f40`，接上 R1 的左腳。',
      highlight: { holes: [PA8, 'f40'], components: ['R1', 'LED1'] },
      check: {
        kind: 'connected',
        a: pa8,
        b: { component: 'LED1', pin: 'anode' },
        via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
        label: 'PA8 經 R1 接到 LED1',
      },
    },
    {
      id: 'wire-pa0',
      title: '把 PA0 接到 LED2',
      body: '用「導線」工具依序點 `a25`（PA0 唯一的空孔）與 `e40`，接上 R2 的左腳。\n\nPA0 在 c 列，所以它的空孔在 a 列。',
      highlight: { holes: [PA0, 'e40'], components: ['R2', 'LED2'] },
      check: {
        kind: 'connected',
        a: pa0,
        b: { component: 'LED2', pin: 'anode' },
        via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
        label: 'PA0 經 R2 接到 LED2',
      },
    },
    {
      id: 'firmware',
      title: '載入 hal-tim-pwm 韌體',
      body:
        '按下方的「載入 hal-tim-pwm 到 U1」，載入後模擬會自動執行：LED1（75 %）明顯比 LED2（25 %）亮。\n\n' +
        '韌體對三個計時器各呼叫一次 `HAL_TIM_PWM_Start()`；之後 CPU 只執行 `__WFI()`，PWM 完全由硬體產生，不佔用任何 CPU 時間。',
      highlight: { components: ['U1', 'LED1', 'LED2'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-tim-pwm', label: 'U1 已載入 hal-tim-pwm' },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'hal-tim-pwm' }, { kind: 'run' }],
    },
    {
      id: 'measure',
      title: '量頻率與工作週期',
      body:
        '按下方的「把 PA8、PA0、PA6 加到邏輯分析儀」，量出各自的頻率與工作週期。\n\n' +
        '- PA8：週期 500 µs，高 375 µs → 2 kHz、75 %；\n' +
        '- PA0：週期 1 ms，高 250 µs → 1 kHz、25 %；\n' +
        '- PA6：週期 50 µs → 20 kHz、50 %。\n\n' +
        '萬用電表量 PWM 腳讀到的是平均值：在 PA8 量直流電壓約 2.3 V，正是「工作週期 × 高準位」（0.75 × 約 3.1 V）。本課的電路沒有放萬用電表，這一步用邏輯分析儀就夠了。',
      highlight: { holes: [PA8, PA0] },
      check: { kind: 'measure', at: pa8, quantity: 'duty', min: 74, max: 76, seconds: 0.1, fresh: true, label: 'PA8 工作週期 75 %' },
      // the three channels the text names, in one click (LS-11)
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PA8', 'PA0', 'PA6'] }, { kind: 'run' }],
    },
    {
      id: 'moe',
      title: '踩一次 TIM1 的 MOE 陷阱',
      body:
        '按下方的「載入 `lesson-i4-nomoe` 到 U1」：PA0、PA6 照常輸出，**PA8 卻完全沒有 PWM**，LED1 熄滅，模擬日誌提示 TIM1 的 MOE = 0。體驗完按「換回 hal-tim-pwm」。\n\n' +
        '這個韌體用暫存器啟動 TIM1，只設了 `CC1E` 與 `CEN`。修正方法：`TIM1->BDTR |= TIM_BDTR_MOE;` 或改用 `HAL_TIM_PWM_Start()`。',
      highlight: { components: ['U1', 'LED1'] },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'lesson-i4-nomoe' }, { kind: 'run' }],
    },
    {
      id: 'fade',
      title: '延伸：呼吸燈',
      body:
        '想試試看：{滑鼠：選取 R2 的導線，把 `a25` 那一端拖到 `a19`｜觸控：長按 R2 導線在 `a25` 的那一端，再拖到 `a19`}（PA6；也可以刪掉這條線，從 `a19` 重新接到 `e40`），再按下方的「載入 hal-pwm-fade 到 U1」，觀察 LED2 由暗漸亮再漸暗。完成後把導線改回 `a25`、按「換回 hal-tim-pwm」，再到「驗收」按「檢查我的電路」。\n\n' +
        '內建韌體 **hal-pwm-fade** 用 TIM3 CH1（PA6）輸出 1 kHz PWM，並在每次更新中斷調整 CCR1：工作週期以 1 % 為一階，0 → 100 → 0 %，2 秒一個循環。',
      highlight: { holes: [PA0, tap('PA6')] },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'hal-pwm-fade' }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'resistor', 'led'],
    firmware: ['hal-tim-pwm', 'lesson-i4-nomoe', 'hal-pwm-fade'],
  },
  durationMin: 35,
}
