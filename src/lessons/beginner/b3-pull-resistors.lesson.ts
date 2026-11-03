/**
 * b3 — 上拉與下拉電阻 (pull-up and pull-down resistors).
 *
 * A Blue Pill (U1 at h10, powered from PS1 5 V into its 5V pin; its 3.3 V
 * output on the top+ rail) runs firmware/projects/lesson-b3-pull: PA0 and
 * PA1 are FLOATING inputs (GPIO_NOPULL), PC13 (on-board LED) follows PA0,
 * USART1 prints "PA0=x PA1=y" every 100 ms. The starting circuit has the
 * two push-buttons wired WITHOUT pull resistors, so the electrical rule
 * checker reports both inputs as floating; the learner adds R1 (10 kΩ
 * pull-up to 3.3 V) and R2 (10 kΩ pull-down to GND).
 *
 * The pressed-button checks press the button themselves (final round: a
 * runtime stimulus on SW1 / SW2 'pressed', the runtime-param path the 3D
 * press and the inspector's 按住 / 保持按下 use), so 「檢查此步驟」 never
 * depends on a button the learner left kept pressed, and the
 * acceptance reads the firmware's PA0=0 / PA1=1 while the check holds them.
 *
 * Header taps on this bench (Blue Pill at h10, one free hole per pin):
 * PA0 a25, PA1 a24, 3V3 a12, GND a10/a11, 5V j27, GND3 j28.
 */
import type { Lesson } from '../types'
import type { ComponentInstance, Wire } from '../../model/types'
import { anchored, bench, bullets, doc, part, supply, wire } from './bench'

const FIRMWARE = 'lesson-b3-pull'

const PARTS: ComponentInstance[] = [
  supply(5),
  anchored('U1', 'stm32_bluepill', 'h10'),
  anchored('SW1', 'pushbutton', 'f40'),
  anchored('SW2', 'pushbutton', 'f48'),
]

const WIRES: Wire[] = [
  wire('W1', 'PS1:+', 'j27', 'red'), // 5 V into the Blue Pill 5V pin (on-board regulator)
  wire('W2', 'PS1:-', 'top-0', 'black'),
  wire('W3', 'j28', 'top-1', 'black'), // GND3 → ground rail
  wire('W4', 'a12', 'top+0', 'orange'), // 3V3 → top+ rail (3.3 V)
  wire('W5', 'a25', 'a40', 'yellow'), // PA0 → SW1 A side
  wire('W6', 'a42', 'top-31', 'black'), // SW1 B side → GND
  wire('W7', 'a24', 'a48', 'green'), // PA1 → SW2 A side
  wire('W8', 'a50', 'top+39', 'orange'), // SW2 B side → 3.3 V
]

const START = bench('b3 上拉與下拉電阻（起始）', PARTS, WIRES)

const SOLUTION = bench(
  'b3 上拉與下拉電阻（解答）',
  [
    ...PARTS,
    part('R1', 'resistor', ['top+30', 'b40'], { resistance: 10000 }), // PA0 pull-up
    part('R2', 'resistor', ['b48', 'top-38'], { resistance: 10000 }), // PA1 pull-down
  ],
  WIRES,
)

const PA0 = { component: 'U1', pin: 'PA0' }
const PA1 = { component: 'U1', pin: 'PA1' }
const V33 = { component: 'U1', pin: '3V3_1' }
const GND = { terminal: 'PS1:-' }

export const LESSON: Lesson = {
  id: 'b3-pull-resistors',
  level: 'beginner',
  order: 3,
  title: '上拉與下拉電阻',
  summary:
    '按鈕只能「接通」或「斷開」，斷開時輸入腳沒有確定的電壓——這就是浮接。用真實韌體讀取 STM32 的 PA0、PA1，親手加上 10 kΩ 上拉與下拉電阻，讓電氣規則檢查的「浮接輸入」風險消失。',
  objectives: [
    '說明數位輸入為什麼會「浮接」，以及浮接輸入在真實硬體上會隨機讀值',
    '接出上拉電阻（放開 = 1、按下 = 0，低態有效）與下拉電阻（放開 = 0、按下 = 1，高態有效）',
    '用 STM32F103 在 3.3 V 時的輸入門檻（V_IL ≤ 1.16 V、V_IH ≥ 1.83 V）判斷邏輯準位',
    '算出按下按鈕時流過上拉電阻的電流（3.3 V ÷ 10 kΩ = 0.33 mA），並說明 4.7 kΩ–47 kΩ 的選用理由',
    '看懂電氣規則檢查（ERC）的「浮接輸入」風險，並用外部電阻排除',
  ],
  wiring: doc(
    '本課使用 STM32F103C8T6 Blue Pill 開發板 U1（定位點 h10）。開發板本體蓋住 b–i 列，所以每支腳位只剩 a 列（或 j 列）一個空孔可以接線。',
    bullets(
      '電源（起始電路已接好）：PS1 正端（5 V）接 `j27`（j 列第 27 欄，5V 腳位，經板上穩壓器產生 3.3 V）；PS1 負端接 `top-0`（上方 − 電源軌第 0 孔）；`j28`（G 腳位）接 `top-1`；`a12`（3.3 腳位）接 `top+0`。**本課的 top+ 電源軌是 3.3 V，不是 5 V。**',
      '按鈕 SW1（定位點 f40）：A 側在第 40 欄、B 側在第 42 欄。導線 `a25`（PA0）→ `a40`，`a42` → `top-31`（接地）。',
      '按鈕 SW2（定位點 f48）：A 側在第 48 欄、B 側在第 50 欄。導線 `a24`（PA1）→ `a48`，`a50` → `top+39`（3.3 V）。',
      '**你要加的**：R1（10 kΩ 上拉）從 `top+30` 插到 `b40`；R2（10 kΩ 下拉）從 `b48` 插到 `top-38`。',
    ),
    'U1 已載入韌體 `lesson-b3-pull`：PA0、PA1 設為**沒有內部上下拉**的浮接輸入（GPIO_NOPULL）；板上 PC13 LED 跟著 PA0（PA0 = 0 時亮）；USART1（PA9，115200 8N1）每 100 ms 印出一行 `PA0=x PA1=y`。',
  ),
  theory: doc(
    '**數位輸入幾乎不吃電流**：MCU 的輸入腳是 CMOS 閘極，漏電流在 ±1 µA 以下，本身不會決定電壓。按鈕閉合時把腳位接到 GND 或 3.3 V；但按鈕**斷開**時，腳位與任何東西都不相連，電壓就由雜訊、手指靜電、相鄰訊號的耦合決定——這叫**浮接**，讀值會隨機跳動。',
    '**上拉電阻（PA0）**：電阻接到 3.3 V，按鈕接到 GND。',
    bullets(
      '放開：輸入不吃電流，電阻上沒有壓降，PA0 = 3.3 V → 讀到 1。',
      '按下：按鈕（接觸電阻約 50 mΩ）把 PA0 拉到 0 V → 讀到 0；此時電阻流過 I = 3.3 V ÷ 10 kΩ = 0.33 mA。',
      '「按下 = 0」稱為**低態有效**，是 MCU 按鈕最常見的接法。',
    ),
    '**下拉電阻（PA1）**：電阻接到 GND，按鈕接到 3.3 V。放開 = 0、按下 = 1（高態有效），按下時同樣流過 0.33 mA。',
    '**邏輯門檻**：STM32F103 在 V_DD = 3.3 V 時，輸入低於 V_IL = 0.28 × (V_DD − 2) + 0.8 ≈ **1.16 V** 保證讀成 0，高於 V_IH = 0.41 × (V_DD − 2) + 1.3 ≈ **1.83 V** 保證讀成 1（DS5319 資料手冊）；兩者之間是不確定區，輸入端的施密特觸發器遲滯讓讀值不會在邊界抖動。',
    '**電阻值怎麼選**：太小（例如 100 Ω）按下時要 33 mA，白白耗電；太大（例如 1 MΩ）時，1 µA 的漏電流就會造成 1 V 的壓降，雜訊邊限被吃掉。一般使用 4.7 kΩ–47 kΩ，**10 kΩ** 是最常見的折衷。',
    '**內部上拉／下拉**：STM32 每支 GPIO 都有約 40 kΩ（30–50 kΩ）的內部上拉與下拉，韌體可用 `GPIO_PULLUP`／`GPIO_PULLDOWN` 開啟，就不必外接電阻。本課的韌體刻意設定 `GPIO_NOPULL`，讓你親手接外部電阻。',
    '**為什麼上拉接 3.3 V 而不是 5 V**：PA0、PA1 不是 5 V 容忍（FT）腳位，絕對最大額定是 V_DD + 0.3 V = 3.6 V。',
    '**模擬器的限制**：模擬器沒有雜訊與漏電流模型。浮接的輸入會維持上一次確定的讀值，並在模擬記錄中提出「浮接輸入」警告；真實晶片則會隨機讀到 0 或 1。',
  ),
  start: { layout: START, firmware: { U1: FIRMWARE } },
  solution: { layout: SOLUTION, firmware: { U1: FIRMWARE } },
  expected: [
    '兩個按鈕都放開：PA0 ≈ 3.30 V（讀到 1）、PA1 ≈ 0 V（讀到 0），UART 終端機每 100 ms 顯示 `PA0=1 PA1=0`，PC13 LED 不亮',
    '按住 SW1：PA0 降到約 0 V，PC13 LED 亮起，終端機顯示 `PA0=0 PA1=0`；R1 流過約 0.33 mA',
    '按住 SW2：PA1 升到約 3.30 V，終端機顯示 `PA0=1 PA1=1`；R2 流過約 0.33 mA',
    '加上 R1、R2 之後，電氣規則檢查的兩個「浮接輸入」風險消失，沒有任何錯誤或風險',
  ],
  mistakes: [
    {
      symptom: '電氣規則檢查顯示 PA0／PA1「浮接輸入」風險，模擬記錄出現浮接警告，讀值與按鈕狀態對不上',
      cause: '只接了按鈕，沒有上拉／下拉電阻：按鈕放開時輸入腳沒有任何東西決定電壓',
      fix: 'PA0 加 10 kΩ 到 3.3 V（上拉）、PA1 加 10 kΩ 到 GND（下拉）',
    },
    {
      symptom: '按下 SW1 時 PA0 的讀值不變，ERC 指出按鈕與電阻把 PA0 接到同一邊',
      cause: 'R1 誤插到 top−（變成下拉電阻），而 SW1 也接地：放開與按下時 PA0 都是 0',
      fix: '上拉電阻的另一端要接 top+（3.3 V），按鈕接 GND；兩者必須接往相反的方向',
    },
    {
      symptom: '電氣規則檢查出現 GPIO 過電壓的風險',
      cause: '上拉電阻接到 5 V（例如接到 PS1 正端或 j27 的 5V 腳位）。PA0 不耐 5 V，放開時會被拉到超過 3.6 V 的絕對最大額定',
      fix: '上拉電阻一律接開發板的 3.3 V（本課的 top+ 電源軌）',
    },
    {
      symptom: '按下 SW2 時 3.3 V 電源軌被拉低，ERC 顯示電源短路風險',
      cause: 'SW2 的 A 側接 3.3 V、B 側卻接到 top−（接地）：按下按鈕等於把電源直接短路',
      fix: '按鈕一側接輸入腳，另一側接電源軌；電阻負責把輸入拉到另一邊',
    },
    {
      symptom: '改用 1 MΩ 上拉，模擬中仍然一切正常',
      cause: '模擬器沒有漏電流與雜訊模型，所以看不出問題；真實電路中 1 µA 漏電流在 1 MΩ 上就有 1 V 壓降，長導線上的雜訊也會讓讀值跳動',
      fix: '實際電路請使用 4.7 kΩ–47 kΩ（建議 10 kΩ）',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: FIRMWARE, label: 'U1 已載入 lesson-b3-pull 韌體' },
    {
      kind: 'connected',
      a: PA0,
      b: V33,
      via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
      label: 'PA0 經 4.7–47 kΩ 上拉電阻接到 3.3 V',
    },
    { kind: 'connected', a: PA0, b: GND, via: { type: 'pushbutton' }, label: 'PA0 經按鈕接地' },
    {
      kind: 'connected',
      a: PA1,
      b: GND,
      via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
      label: 'PA1 經 4.7–47 kΩ 下拉電阻接地',
    },
    { kind: 'connected', a: PA1, b: V33, via: { type: 'pushbutton' }, label: 'PA1 經按鈕接到 3.3 V' },
    {
      kind: 'measure',
      at: PA0,
      quantity: 'voltage',
      min: 2.9,
      max: 3.4,
      seconds: 0.05,
      fresh: true,
      label: '按鈕放開時 PA0 為高準位（2.9–3.4 V）',
    },
    {
      kind: 'measure',
      at: PA1,
      quantity: 'voltage',
      min: 0,
      max: 0.3,
      seconds: 0.05,
      fresh: true,
      label: '按鈕放開時 PA1 為低準位（0–0.3 V）',
    },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'PA0=1 PA1=0',
      seconds: 0.3,
      label: '韌體讀到 PA0=1、PA1=0（UART 輸出）',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險（沒有浮接輸入）' },
    {
      kind: 'all',
      label: '按下按鈕時韌體讀到相反的值：按住 SW1 → PA0=0，按住 SW2 → PA1=1',
      checks: [
        {
          kind: 'uart-contains',
          component: 'U1',
          port: 'USART1',
          text: 'PA0=0 PA1=0',
          seconds: 0.6,
          stimulus: [
            { at: 0.35, component: 'SW1', param: 'pressed', value: true },
            { at: 0.5, component: 'SW1', param: 'pressed', value: false },
          ],
          label: '按住 SW1：韌體讀到 PA0=0',
        },
        {
          kind: 'uart-contains',
          component: 'U1',
          port: 'USART1',
          text: 'PA0=1 PA1=1',
          seconds: 0.85,
          stimulus: [
            { at: 0.6, component: 'SW2', param: 'pressed', value: true },
            { at: 0.75, component: 'SW2', param: 'pressed', value: false },
          ],
          label: '按住 SW2：韌體讀到 PA1=1',
        },
      ],
    },
  ],
  steps: [
    {
      id: 'b3-s1',
      title: '觀察浮接的輸入',
      body: doc(
        '模擬會自動執行，打開儀器的 **UART 終端機**（U1、USART1），再看**電氣規則檢查**的結果（「問題」清單）。',
        '起始電路中，SW1 把 PA0 接到 GND、SW2 把 PA1 接到 3.3 V，但沒有任何電阻。電氣規則檢查會對 PA0 與 PA1 各報告一個「浮接輸入」風險：按鈕放開時，沒有任何東西決定這兩支腳位的電壓。',
      ),
      highlight: { holes: ['a25', 'a24'], components: ['U1', 'SW1', 'SW2'] },
      action: { kind: 'run' },
    },
    {
      id: 'b3-s2',
      title: '為 PA0 加上上拉電阻',
      body: doc(
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `top+30` 與 `b40` 放上 R1，並在「屬性」面板設為 `10000` Ω（10 kΩ）。',
        '`top+30` 是 3.3 V，`b40` 是 SW1 的 A 側，也就是 PA0 那一欄。放開 SW1 時，R1 把 PA0 拉到 3.3 V；按下時，SW1 把 PA0 直接接地。',
      ),
      highlight: { holes: ['top+30', 'b40'], components: ['SW1'] },
      check: {
        kind: 'connected',
        a: PA0,
        b: V33,
        via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
        label: 'PA0 經 4.7–47 kΩ 電阻接到 3.3 V',
      },
    },
    {
      id: 'b3-s3',
      title: '按住 SW1：PA0 變成 0',
      body: doc(
        '模擬執行中（暫停了的話按上方的「▶ 執行模擬」），在麵包板上按住 SW1（想讓它一直按著：{滑鼠：雙擊｜觸控：點兩下} SW1，或在屬性面板打開「保持按下」）：PA0 降到約 0 V，板上 PC13 LED 亮起，終端機顯示 `PA0=0`。',
        '放開時終端機顯示 `PA0=1`。按下時 R1 兩端是 3.3 V，流過 3.3 V ÷ 10 kΩ = 0.33 mA。觀察完請放開 SW1（關掉「保持按下」，或在麵包板上點一下 SW1）。「檢查此步驟」會自己按住 SW1 再量 PA0，不必一直按著。',
      ),
      highlight: { components: ['SW1', 'U1'] },
      check: {
        kind: 'measure',
        at: PA0,
        quantity: 'voltage',
        min: 0,
        max: 0.3,
        seconds: 0.02,
        stimulus: [{ at: 0, component: 'SW1', param: 'pressed', value: true }],
        label: '按住 SW1 時 PA0 低於 0.3 V',
      },
    },
    {
      id: 'b3-s4',
      title: '為 PA1 加上下拉電阻',
      body: doc(
        '再拿一顆電阻，依序點 `b48` 與 `top-38` 放上 R2，並設為 `10000` Ω（10 kΩ）。',
        '`b48` 是 SW2 的 A 側，也就是 PA1 那一欄；`top-38` 接地。放開 SW2 時，R2 把 PA1 拉到 0 V。',
      ),
      highlight: { holes: ['b48', 'top-38'], components: ['SW2'] },
      check: {
        kind: 'connected',
        a: PA1,
        b: GND,
        via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
        label: 'PA1 經 4.7–47 kΩ 電阻接地',
      },
    },
    {
      id: 'b3-s5',
      title: '按住 SW2：PA1 變成 1',
      body: doc(
        '在麵包板上按住 SW2（想讓它一直按著：{滑鼠：雙擊｜觸控：點兩下} SW2，或在屬性面板打開「保持按下」）：PA1 升到約 3.30 V，終端機顯示 `PA1=1`。',
        '下拉的接法是「按下 = 1」（高態有效），正好與上拉相反。觀察完請放開 SW2（關掉「保持按下」，或在麵包板上點一下 SW2）。「檢查此步驟」會自己按住 SW2 再量 PA1。',
      ),
      highlight: { components: ['SW2', 'U1'] },
      check: {
        kind: 'measure',
        at: PA1,
        quantity: 'voltage',
        min: 2.9,
        max: 3.4,
        seconds: 0.02,
        stimulus: [{ at: 0, component: 'SW2', param: 'pressed', value: true }],
        label: '按住 SW2 時 PA1 高於 2.9 V',
      },
    },
    {
      id: 'b3-s6',
      title: '放開按鈕，確認沒有浮接',
      body: '兩個按鈕都放開後，終端機應穩定顯示 `PA0=1 PA1=0`，電氣規則檢查不再有任何「浮接輸入」風險。',
      highlight: { components: ['U1'] },
      check: { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查沒有錯誤或風險' },
    },
  ],
  runnable: 'ready',
  requires: { parts: ['power_supply', 'stm32_bluepill', 'pushbutton', 'resistor'], firmware: [FIRMWARE] },
  durationMin: 20,
}
