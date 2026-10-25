/**
 * 中級 i1 — STM32 GPIO 輸出：RCC 時脈致能、推挽與開汲極、PC13 低電位點亮。
 * Firmware: hal-blink (solution); lesson-i1-noclk and lesson-i1-od reproduce
 * the two classic mistakes (firmware/projects/lesson-i1-*).
 */
import type { Lesson } from '../types'
import { benchLayout, leads, tap, type WireSpec } from './bench'

const PA5 = tap('PA5') // a20

const startParts = [
  leads('R1', 'resistor', ['a36', 'a40'], { resistance: 330 }),
  leads('LED1', 'led', ['b40', 'top-32'], { color: 'red' }),
]
const startWires: WireSpec[] = []
const solutionWires: WireSpec[] = [...startWires, [PA5, 'e36', 'yellow']]

const pa5 = { component: 'U1', pin: 'PA5' } as const

export const LESSON: Lesson = {
  id: 'i1-gpio-output',
  level: 'intermediate',
  order: 1,
  title: 'STM32 GPIO 輸出：點亮外接 LED',
  summary:
    '用真正的 STM32 HAL 韌體讓 PA5 推挽輸出點亮 LED，弄懂 RCC 時脈致能、推挽與開汲極的差別，以及低電位點亮的 PC13 板載 LED。',
  objectives: [
    '說明 GPIO 在使用前為什麼必須先以 `__HAL_RCC_GPIOA_CLK_ENABLE()` 打開 RCC_APB2ENR 的 IOPAEN 時脈位元。',
    '分辨推挽與開汲極輸出：推挽能輸出高、低兩種準位；開汲極只能把腳位拉到 GND。',
    '算出 LED 電流：(3.3 − 1.75) V ÷ (330 + 50) Ω ≈ 4.1 mA，並知道 50 Ω 是 GPIO 輸出級的內阻。',
    '理解 PC13 板載 LED 是低電位點亮，而且 PC13 最多只能吸入約 3 mA。',
    '用邏輯分析儀量到 `HAL_Delay(500)` 實際產生 501 ms 的半週期（頻率 ≈ 0.998 Hz）。',
  ],
  wiring:
    '電源已經接好：直流電源供應器 PS1（5 V）→ 下方 + 電源軌 → Blue Pill 的 **5V** 腳（板上 3.3 V 穩壓器的輸入）；板子的 **3V3** 腳接到上方 + 電源軌，兩條 − 電源軌都是 GND。\n\n' +
    '麵包板上已經放好 **R1（330 Ω）** 與紅色 **LED1**：\n' +
    '- R1 一端在 a36、另一端在 a40；\n' +
    '- LED1 的陽極（長腳）在 b40，與 R1 同一個 5 孔組（第 40 欄的 a–e），陰極插在上方 − 電源軌（GND）。\n\n' +
    '你只需要接一條線：**PA5 → R1**。Blue Pill 跨在中央溝槽上，PA5 位於 c 列第 20 欄；電路板蓋住 b–i 列，所以每支腳只剩一個空孔——PA5 的空孔是 **a20**（a 列第 20 欄）。從 `a20` 拉一條線到 `e36`（R1 所在的第 36 欄）。\n\n' +
    '完成後的電流路徑：PA5 → R1 → LED1 → GND。板載的綠色 LED 已經在板子上接好：3.3 V → 510 Ω → LED → PC13。',
  theory:
    '**1. 先開時脈，周邊才會動。** STM32F103 為了省電，重置後幾乎所有周邊的時脈都是關閉的。GPIOA 的時脈由 `RCC_APB2ENR` 的 **IOPAEN**（位元 2）控制；`__HAL_RCC_GPIOA_CLK_ENABLE()` 就是把這個位元設為 1。時脈關閉時，對 GPIOA 暫存器的寫入會被忽略、讀出一律為 0（RM0008 §7.3.7）——`HAL_GPIO_Init()` 看似執行了，腳位卻還停在重置狀態（浮接輸入，`GPIOA_CRL` = 0x44444444）。\n\n' +
    '**2. 腳位組態。** 每支腳在 `GPIOx_CRL`／`GPIOx_CRH` 中有 4 個位元：MODE 決定輸入或輸出速度，CNF 決定型態。PA5 設成 2 MHz 推挽輸出時，CRL[23:20] = `0010`；設成開汲極時為 `0110`。輸出值寫在 `ODR`，HAL 的 `HAL_GPIO_TogglePin()` 透過 `BSRR` 一次完成置位／清除，不會被中斷打斷。\n\n' +
    '**3. 推挽與開汲極。** 推挽輸出有上、下兩顆 MOSFET：ODR = 1 時上管導通把腳位推到 VDD，ODR = 0 時下管導通把腳位拉到 GND。開汲極只有下管：ODR = 0 拉到 GND，ODR = 1 時腳位「放開」成高阻抗，需要外部上拉電阻才會變成高準位。所以開汲極接「LED 到 GND」永遠不會亮，但接「3.3 V → 電阻 → LED → 腳位」就會在 ODR = 0 時亮（腳位吸入電流）。I²C 匯流排正是利用開汲極讓多個裝置共用同一條線。\n\n' +
    '**4. LED 電流計算。** 模擬器把 GPIO 輸出級視為約 50 Ω 的內阻。紅色 LED 在 4 mA 左右的順向電壓約 1.75 V：\n' +
    '- I = (3.3 − 1.75) V ÷ (330 + 50) Ω ≈ **4.1 mA**；\n' +
    '- PA5 腳位上的電壓 = 3.3 V − 4.1 mA × 50 Ω ≈ **3.10 V**（輸出級本身也有壓降）；\n' +
    '- 這遠低於資料手冊（DS5319）規定的每支 I/O 絕對最大電流 ±25 mA。\n\n' +
    '**5. PC13 是低電位點亮。** 板載 LED 的陽極經 510 Ω 接到 3.3 V，陰極接 PC13，所以 PC13 = 0 時 LED 才亮：I ≈ (3.3 − 2.1 − 0.1) V ÷ 510 Ω ≈ 2.1 mA。PC13～PC15 由內部電源開關供電，只能吸入約 3 mA、速度限 2 MHz，不要拿來推大負載。`hal-blink` 每次同時反轉 PA5 與 PC13，而 PC13 從 1（熄滅）開始，所以 PA5 = 1 時兩顆 LED 一起亮——準位相反，看起來卻同步。\n\n' +
    '**6. HAL_Delay 的「+1」。** HAL v1.1.9 的 `HAL_Delay(n)` 為了保證「至少」等 n ms，實際等到 `HAL_GetTick()` 的差值達 n + 1 才返回。`HAL_Delay(500)` 因此是 501 ms：一個週期 1.002 s，頻率 = 1 ÷ 1.002 s ≈ **0.998 Hz**。',
  start: {
    layout: benchLayout(
      'i1 GPIO 輸出（起始）',
      'Blue Pill 已接電源；R1（330 Ω）與 LED1 已放好，但還沒接到 PA5，也還沒載入韌體。',
      startParts,
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i1 GPIO 輸出（解答）',
      'PA5（a20）→ e36 → R1 330 Ω → LED1 → GND，韌體 hal-blink：PA5 與 PC13 每 501 ms 反轉一次。',
      startParts,
      solutionWires,
    ),
    firmware: { U1: 'hal-blink' },
  },
  expected: [
    '邏輯分析儀上 PA5 是 501 ms 高、501 ms 低的方波：週期 1.002 s，頻率 ≈ 0.998 Hz，工作週期 50 %。',
    'PC13 與 PA5 的波形完全反相（PC13 = !PA5），兩顆 LED 卻同時亮、同時滅。',
    'LED1 點亮時電流約 4.1 mA，PA5 腳位電壓約 3.10 V，LED1 兩端約 1.75 V。',
    '板載 PC13 LED 點亮時電流約 2.1 mA，PC13 腳位約 0.1 V。',
    '屬性面板的腳位模式：PA5 與 PC13 都是「推挽」（推挽輸出）。電氣規則檢查沒有錯誤。',
  ],
  // `match` ties a mistake to the pass / fail pattern of the acceptance checks
  // below (0 hal-blink · 1 PA5 via resistor · 2 cathode to GND · 3 frequency
  // · 4 duty · 5 ERC) — the check results show it as 「最可能的原因」.
  mistakes: [
    {
      symptom: 'LED1 不閃，檢查顯示「U1 已載入 hal-blink 韌體」沒有通過。',
      cause: 'U1 還沒有載入韌體，或載入的不是 hal-blink（例如還停在錯誤示範的韌體）。沒有程式時，GPIO 停在重置後的浮接輸入，什麼都不會動。',
      fix: '按「步驟」第 3 步的「載入 hal-blink 到 U1」（或「接線」裡 hal-blink 旁的「載入到 U1」），再按上方的「▶ 執行模擬」。',
      match: { checks: [0] },
    },
    {
      symptom: '板載 PC13 LED 正常閃爍，但 PA5 的 LED1 完全不亮；邏輯分析儀上 PA5 是一條平線。',
      cause:
        '忘了 `__HAL_RCC_GPIOA_CLK_ENABLE()`：RCC_APB2ENR.IOPAEN 仍為 0，GPIOA 的暫存器寫入全被忽略，PA5 停在重置後的浮接輸入。按下方的「重現這個錯誤：載入 `lesson-i1-noclk`」即可重現，模擬日誌也會提示 GPIOA 沒有時脈。',
      fix: '在 `MX_GPIO_Init()` 一開始加上每個用到的埠的時脈致能（`__HAL_RCC_GPIOA_CLK_ENABLE()`、`__HAL_RCC_GPIOC_CLK_ENABLE()`…），再呼叫 `HAL_GPIO_Init()`。',
    },
    {
      symptom: '韌體在跑、PA5 也在「反轉」，LED1 卻永遠不亮；把 LED 改接成 3.3 V → 電阻 → LED → PA5 反而會亮。',
      cause:
        'PA5 被設成 `GPIO_MODE_OUTPUT_OD`（開汲極）：ODR = 1 時腳位只是放開，沒有東西把它推到高準位，接到 GND 的 LED 不會有電流。按下方的「重現這個錯誤：載入 `lesson-i1-od`」即可重現。',
      fix: '要「推」電流給負載時用 `GPIO_MODE_OUTPUT_PP`；若一定要用開汲極，就把負載接成由 3.3 V 流入腳位（腳位為 0 時點亮），或加上拉電阻。',
    },
    {
      symptom: '接線看起來都對，LED1 卻不亮，PA5 有在變化。',
      cause: 'LED 插反了：陽極（長腳）必須在高電位那一側（R1 那端），陰極接 GND。反接時 LED 承受逆向電壓，不導通。',
      fix: '把 LED1 的兩支腳對調：陽極在 b40、陰極在 GND 電源軌。',
      match: { checks: [1, 2], passes: [0] },
    },
    {
      symptom: '把 R1 換成導線（或 10 Ω）後 LED 非常亮，電氣規則檢查出現過電流警告。',
      cause:
        '少了限流電阻，電流只剩 GPIO 輸出級的 50 Ω 在限制：(3.3 − 2.0) V ÷ 50 Ω ≈ 26 mA，已超過 LED 的 20 mA 額定與 GPIO 每腳 25 mA 的上限。',
      fix: 'LED 一定要串聯電阻；3.3 V 系統用 220 Ω～1 kΩ（約 1.3～6 mA）即可清楚看見。',
      match: { checks: [1], ercRules: ['led-current'] },
    },
    {
      symptom: 'LED1 不亮，但板載的綠色 LED（PC13）照常閃爍。',
      cause: 'PA5 沒有接到 R1：導線還沒接，或接到了旁邊的腳（`a19` 是 PA6、`a21` 是 PA4）。',
      fix: '從 `a20`（PA5 唯一的空孔）拉一條導線到 `e36`。',
      match: { checks: [1], passes: [0, 2] },
    },
    {
      symptom: '想讓板載 LED 亮，寫了 `HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET)`，結果 LED 反而熄滅。',
      cause: 'PC13 板載 LED 是低電位點亮：LED 接在 3.3 V 與 PC13 之間，PC13 = 1 時兩端沒有電位差。',
      fix: '用 `GPIO_PIN_RESET` 點亮、`GPIO_PIN_SET` 熄滅；並記得 PC13 只能吸入約 3 mA，不要用它直接驅動外部負載。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-blink', label: 'U1 已載入 hal-blink 韌體' },
    {
      kind: 'connected',
      a: pa5,
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
      label: 'PA5 經 150 Ω～1 kΩ 的限流電阻接到 LED1 陽極',
    },
    { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: { terminal: 'PS1:-' }, label: 'LED1 陰極接 GND' },
    {
      kind: 'measure',
      at: pa5,
      quantity: 'frequency',
      min: 0.95,
      max: 1.05,
      seconds: 3,
      fresh: true,
      label: 'PA5 的閃爍頻率約 0.998 Hz（每 501 ms 反轉一次）',
    },
    { kind: 'measure', at: pa5, quantity: 'duty', min: 49, max: 51, seconds: 3, fresh: true, label: 'PA5 的工作週期為 50 %' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'tour',
      title: '認識 Blue Pill 與起始電路',
      body:
        '{滑鼠：把游標停在 Blue Pill 上，找到｜觸控：點一下 Blue Pill 上的 A5 腳，找到} **PA5**（板上印 A5，`c20`，空孔 `a20`）與 **PC13**（`c28`）。看完按「下一步」。\n\n' +
        'Blue Pill 跨在麵包板中央溝槽上：上排排針在 h 列（第 10～29 欄，PB12 … 3V3），下排排針在 c 列（第 29～10 欄，VBAT … GND）。電路板蓋住 b–i 列，**每支腳只剩一個空孔**：c 列的腳用 a 列、h 列的腳用 j 列。\n\n' +
        '電源已經接好：PS1 的 5 V 進入 5V 腳，板上的穩壓器產生 3.3 V。R1 與 LED1 也已放在第 36～40 欄。',
      highlight: { components: ['U1'], holes: [PA5] },
    },
    {
      id: 'wire',
      title: '把 PA5 接到限流電阻',
      body:
        '按下方的「開始接線」（或點「導線」工具），再依序點 `a20`（PA5 唯一的空孔）與 `e36`，把 PA5 接到 R1。\n\n' +
        '第 36 欄的 a–e 五個孔是同一個網路，所以導線與 R1 的左腳接在一起。\n\n' +
        '想一想：PA5 輸出 3.3 V 時，LED1 的電流 I = (3.3 − 1.75) V ÷ (330 + 50) Ω ≈ **4.1 mA**。',
      highlight: { holes: [PA5, 'e36'], components: ['R1', 'LED1'] },
      check: {
        kind: 'connected',
        a: pa5,
        b: { component: 'LED1', pin: 'anode' },
        via: { type: 'resistor', param: 'resistance', min: 150, max: 1000 },
        label: 'PA5 經 R1 接到 LED1 陽極',
      },
    },
    {
      id: 'firmware',
      title: '載入 hal-blink 韌體',
      body:
        '按下方的「載入 hal-blink 到 U1」，把內建的 **hal-blink** 韌體燒進 U1（也可以選取 U1，在屬性面板的「韌體」區挑選內建韌體）。\n\n' +
        '這是標準的 STM32CubeIDE 專案：`SystemClock_Config()` 把時脈設為 72 MHz（HSE 8 MHz × PLL 9），`MX_GPIO_Init()` 先打開 GPIOA／GPIOC 的時脈，再把 PA5、PC13 設成推挽輸出，主迴圈則是：\n\n' +
        '`HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5); HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13); HAL_Delay(500);`',
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-blink', label: 'U1 已載入 hal-blink' },
    },
    {
      id: 'run',
      title: '執行並觀察兩顆 LED',
      body:
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，看 LED1 與板載綠色 LED（PC13，在 USB 接頭旁）一起亮、一起滅。\n\n' +
        '它們的腳位準位剛好相反：PA5 = 1 點亮 LED1，PC13 = 0 才點亮板載 LED（低電位點亮）。在屬性面板查看腳位模式：PA5、PC13 都顯示 **推挽**（推挽輸出）。',
      // the step compares LED1 with the board's own PC13 LED: the camera keeps the board in view (LS-12)
      highlight: { components: ['LED1', 'U1'], watch: ['U1'] },
      check: {
        kind: 'measure',
        at: pa5,
        quantity: 'frequency',
        min: 0.95,
        max: 1.05,
        seconds: 3,
        fresh: true,
        label: 'PA5 以約 1 Hz 閃爍',
      },
    },
    {
      id: 'analyzer',
      title: '用邏輯分析儀量出 501 ms',
      body:
        '按下方的「把 PA5、PC13 加到邏輯分析儀」，量相鄰兩個邊緣的間隔：是 **501 ms**，不是 500 ms。\n\n' +
        'HAL v1.1.9 的 `HAL_Delay(n)` 會多等 1 ms 以保證「至少 n ms」。週期 = 2 × 501 ms = 1.002 s，頻率 ≈ 0.998 Hz，工作週期 50 %。需要精準週期時，改用 `HAL_GetTick()` 的期限寫法，或下一課的計時器中斷。',
      highlight: { components: ['U1'] },
      check: { kind: 'measure', at: pa5, quantity: 'duty', min: 49, max: 51, seconds: 3, fresh: true, label: 'PA5 工作週期 50 %' },
      // the text asks for both channels: one click puts PA5 and PC13 on the analyzer (LS-11)
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PA5', 'PC13'] }, { kind: 'run' }],
    },
    {
      id: 'mistakes',
      title: '親手重現兩個經典錯誤',
      body:
        '按下方的按鈕依序換上兩個錯誤示範韌體，各執行一下看看；體驗完按「換回 hal-blink」，再到「驗收」按「檢查我的電路」完成本課。\n\n' +
        '1. `lesson-i1-noclk`（忘了開 GPIOA 時脈）：PC13 照樣閃，LED1 卻不亮，PA5 的腳位模式停在浮接輸入，模擬日誌提示 GPIOA 沒有時脈。\n\n' +
        '2. `lesson-i1-od`（PA5 設成開汲極）：LED1 不亮。試著把 LED1 改接成「上方 + 電源軌 → R1 → LED1 → PA5」，它就會在 PA5 = 0 時亮起（體驗完把線路恢復原狀）。',
      // 「PC13 照樣閃，LED1 卻不亮」: both LEDs in view
      highlight: { components: ['U1', 'LED1'], watch: ['U1'] },
      action: [
        { kind: 'load-firmware', component: 'U1', project: 'lesson-i1-noclk' },
        { kind: 'load-firmware', component: 'U1', project: 'lesson-i1-od' },
        { kind: 'run' },
      ],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'resistor', 'led'],
    firmware: ['hal-blink', 'lesson-i1-noclk', 'lesson-i1-od'],
  },
  durationMin: 25,
}
