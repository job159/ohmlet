/**
 * 中級 i6 — ADC 類比數位轉換：可變電阻分壓、12 位元、VDDA 參考、校正。
 * Firmware: hal-adc-pot (ADC1 IN0 on PA0 every 100 ms after
 * HAL_ADCEx_Calibration_Start, 'adc=<raw> mv=<mV>' on USART1 115200 8N1).
 */
import type { Lesson } from '../types'
import { benchLayout, leads, tap, type WireSpec } from './bench'

const PA0 = tap('PA0') // a25

// RV1 leads in row b (ccw b40, wiper b41, cw b42); its body overhangs rows a–c and
// columns 39–43, so the free holes of its strips are d/e40, d/e41, d/e42.
const potStart = leads('RV1', 'potentiometer', ['b40', 'b41', 'b42'], { resistance: 10000, position: 0.5 })
const potSolution = { ...potStart, params: { resistance: 10000, position: 0.75 } }
const startWires: WireSpec[] = []
const solutionWires: WireSpec[] = [
  ...startWires,
  ['e40', 'top-31', 'black'], // ccw end → GND
  ['e42', 'top+33', 'red'], // cw end → 3.3 V (top + rail)
  ['e41', PA0, 'yellow'], // wiper → PA0 (ADC1_IN0)
]

const pa0 = { component: 'U1', pin: 'PA0' } as const

export const LESSON: Lesson = {
  id: 'i6-adc',
  level: 'intermediate',
  order: 6,
  title: 'ADC 類比數位轉換：讀取可變電阻',
  summary:
    '把 10 kΩ 可變電阻接成 0～3.3 V 的分壓器，用 ADC1 的 IN0（PA0）每 100 ms 轉換一次，透過 UART 讀出 12 位元的原始值與毫伏數，並理解 VDDA 參考電壓、取樣時間與校正。',
  objectives: [
    '說明 12 位元 ADC 的換算：讀值 = V ÷ VDDA × 4095，1 LSB = 3.3 V ÷ 4096 ≈ 0.806 mV。',
    '把可變電阻接成分壓器（一端 GND、一端 3.3 V、中間腳接 PA0），並算出旋鈕在 75 % 時 PA0 = 2.475 V、讀值 3071、2475 mV。',
    '知道 ADCCLK 不能超過 14 MHz：72 MHz ÷ 6 = 12 MHz，取樣 55.5 + 轉換 12.5 = 68 個週期 = 5.67 µs。',
    '理解 `HAL_ADCEx_Calibration_Start()` 的作用，以及 PA0 必須設成類比模式。',
    '知道類比輸入腳不耐 5 V：可變電阻要接 3.3 V，不能接 5 V 電源軌。',
  ],
  wiring:
    '電源已經接好：**上方 + 電源軌是 3.3 V**（來自 Blue Pill 的 3V3 腳），**下方 + 電源軌是 5 V**（PS1）；兩條 − 電源軌都是 GND。\n\n' +
    '麵包板上已經放好 **10 kΩ 可變電阻 RV1**，三支腳在 b 列：**逆時針端 `ccw`（b40）**、**中間腳 `wiper`（b41）**、**順時針端 `cw`（b42）**。它的方形本體會蓋住第 39～43 欄的 a～c 列，所以接線請用 d、e 列的孔。\n\n' +
    '你要接三條線：\n' +
    '- `e40`（e 列第 40 欄，逆時針端）→ 上方 − 電源軌（GND），例如 `top-31`（上方 − 電源軌第 31 孔）；\n' +
    '- `e42`（順時針端）→ 上方 + 電源軌（**3.3 V**），例如 `top+33`；\n' +
    '- `e41`（中間腳）→ **a25**（PA0 唯一的空孔，PA0 = ADC1_IN0）。\n\n' +
    '最後把 RV1 的旋鈕轉到 **75 %**（屬性面板的「位置」= 0.75）。',
  theory:
    '**1. 可變電阻分壓。** 10 kΩ 可變電阻的兩端接 GND 與 3.3 V，中間腳（滑動端）在電阻體上滑動，輸出 V = 位置 × 3.3 V。旋鈕在 75 % 時 V = 0.75 × 3.3 V = **2.475 V**；整條電阻只流過 3.3 V ÷ 10 kΩ = 0.33 mA。從中間腳看進去的等效電阻是 10 kΩ × 0.75 × 0.25 ≈ 1.9 kΩ，遠低於 ADC 在 55.5 個取樣週期下允許的訊號源阻抗。\n\n' +
    '**2. 12 位元逐次逼近 ADC。** STM32F103 的 ADC 把 0～VREF+ 的電壓轉成 0～4095 的整數。48 腳包裝（Blue Pill）沒有獨立的 VREF+ 腳，參考電壓就是類比電源 **VDDA = 3.3 V**：\n' +
    '- 讀值 = V ÷ VDDA × 4095，1 LSB ≈ 3.3 V ÷ 4096 ≈ **0.806 mV**；\n' +
    '- 2.475 V → 讀值 = 0.75 × 4095 = 3071.25 → **3071**；\n' +
    '- 韌體換算毫伏：mV = (讀值 × 3300 + 2047) ÷ 4095 = (3071 × 3300 + 2047) ÷ 4095 ≈ **2475**。\n' +
    '注意：VDDA 若不是 3.3 V（例如 USB 供電只有 3.2 V），換算出來的毫伏數就會跟著偏差——ADC 量的是「與 VDDA 的比例」。\n\n' +
    '**3. 時脈與取樣時間。** ADCCLK 由 PCLK2 預除頻而來，上限 **14 MHz**：72 MHz ÷ 6 = **12 MHz**（÷ 4 = 18 MHz 就超規了）。一次轉換 = 取樣時間 + 12.5 個週期：`ADC_SAMPLETIME_55CYCLES_5` → 68 個週期 = **5.67 µs**。取樣時間越長，內部取樣電容越能充飽，可以接受越高的訊號源阻抗。\n\n' +
    '**4. 校正。** ADC 內部電容陣列的不匹配會造成數個 LSB 的偏移誤差。上電後先呼叫 `HAL_ADCEx_Calibration_Start()`（RSTCAL 再 CAL，約 83 個 ADCCLK），硬體量出修正值並在之後的轉換中自動扣除。模擬器會真實執行這個校正流程（沒校正就轉換會在日誌中提示），但模擬的 ADC 本身是理想的：沒有偏移誤差、雜訊，也沒有訊號源阻抗造成的取樣誤差。\n\n' +
    '**5. hal-adc-pot 做了什麼。** PA0 設成類比模式（`GPIO_MODE_ANALOG`，關閉數位輸入與上下拉），ADC1 單次轉換通道 0、軟體觸發、右對齊。校正後每 100 ms（以期限計時，不漂移）：`HAL_ADC_Start()` → `HAL_ADC_PollForConversion()` → `HAL_ADC_GetValue()`，再以 USART1（115200 8N1）印出 `adc=<raw> mv=<mV>`。\n\n' +
    '**6. 不要接 5 V。** 有類比功能的腳位（PA0～PA7、PB0、PB1）**不耐 5 V**，輸入電壓不可超過 VDD + 0.3 V ≈ 3.6 V。把可變電阻接在 5 V 電源軌上，旋鈕轉過約 66 % 後 PA0 就超過 3.3 V，讀值卡在 4095，而且會損壞腳位。',
  start: {
    layout: benchLayout(
      'i6 ADC（起始）',
      'Blue Pill 已接電源；10 kΩ 可變電阻 RV1 已放在 b40～b42（旋鈕在 50 %），還沒接線，也還沒載入韌體。',
      [potStart],
      startWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i6 ADC（解答）',
      'RV1 逆時針端 → GND、順時針端 → 3.3 V、中間腳 → PA0（a25），旋鈕 75 %；韌體 hal-adc-pot：每 100 ms 由 USART1 回報讀值 3071、2475 mV。',
      [potSolution],
      solutionWires,
    ),
    firmware: { U1: 'hal-adc-pot' },
  },
  expected: [
    '旋鈕在 75 % 時 PA0 = 0.75 × 3.3 V ≈ 2.475 V，UART 終端機（U1 的 USART1，115200 8N1）每 100 ms 出現一行約 `adc=3071 mv=2475`。',
    '旋鈕轉到 0 % 時讀到 `adc=0 mv=0`，轉到 100 % 時讀到 `adc=4095 mv=3300`，50 % 時約 `adc=2048 mv=1650`。',
    '每次轉換 68 個 ADCCLK = 5.67 µs；兩行輸出的間隔正好 100 ms。',
    '可變電阻本身只流過 3.3 V ÷ 10 kΩ = 0.33 mA；PA0 的腳位模式顯示為「類比」。',
    '可變電阻改接 5 V 時，旋鈕超過約 66 % 讀值就卡在 4095，電氣規則檢查會警告 PA0 過電壓。',
  ],
  mistakes: [
    {
      symptom: '旋鈕轉到一半以上讀值就一直是 4095，電氣規則檢查出現過電壓警告。',
      cause:
        '可變電阻的一端接到了下方 + 電源軌（5 V）而不是 3.3 V：PA0 超過 VDDA 後 ADC 飽和，且已超過腳位的絕對最大額定 VDD + 0.3 V。類比腳位不耐 5 V。',
      fix: '可變電阻的順時針端改接上方 + 電源軌（3.3 V）。量測 5 V 訊號時要先用電阻分壓到 3.3 V 以下。',
    },
    {
      symptom: '不管旋鈕怎麼轉，讀值都固定在 4095（或 0）。',
      cause:
        '接錯腳：把 3.3 V（或 GND）接到了中間腳，PA0 卻接到某一端。PA0 只經過一段電阻接到固定電位，ADC 的輸入幾乎不吸電流，所以永遠讀到那個電位。',
      fix: '中間腳（`wiper`，b41）才是輸出，接 PA0；兩端（b40、b42）分別接 GND 與 3.3 V。',
    },
    {
      symptom: '讀值在 0～4095 之間亂跳，與旋鈕位置無關。',
      cause:
        '量到的不是你接線的那支腳：例如韌體設定的是 `ADC_CHANNEL_1`（PA1），PA1 卻浮接；或可變電阻的中間腳根本沒接上 PA0。浮接的類比輸入會拾取雜訊與鄰近訊號。',
      fix: '對照資料手冊的腳位表確認通道：PA0 = IN0、PA1 = IN1 … PB1 = IN9；並確認導線確實接在 PA0 的空孔 a25。',
    },
    {
      symptom: '實機上同一個電壓讀起來比預期多或少十幾個 LSB。',
      cause:
        '沒有在開始轉換前執行 `HAL_ADCEx_Calibration_Start()`，或 VDDA 不是 3.3 V（換算時卻假設 3.3 V）。模擬器的 ADC 沒有偏移誤差，所以這個現象只會在實機出現；沒有校正時，模擬日誌會提示。',
      fix: '上電後、第一次轉換前先校正；需要準確的毫伏數時，用內部參考電壓 VREFINT（通道 17，約 1.20 V）反推實際的 VDDA。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-adc-pot', label: 'U1 已載入 hal-adc-pot 韌體' },
    { kind: 'connected', a: { component: 'RV1', pin: 'ccw' }, b: { terminal: 'PS1:-' }, label: '可變電阻的逆時針端接 GND' },
    { kind: 'connected', a: { component: 'RV1', pin: 'cw' }, b: { component: 'U1', pin: '3V3_1' }, label: '可變電阻的順時針端接 3.3 V（不是 5 V）' },
    { kind: 'connected', a: { component: 'RV1', pin: 'wiper' }, b: pa0, label: '可變電阻的中間腳接 PA0（ADC1_IN0）' },
    { kind: 'measure', at: pa0, quantity: 'voltage', min: 2.4, max: 2.55, seconds: 0.3, fresh: true, label: '旋鈕在 75 %：PA0 ≈ 2.475 V' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'mv=24',
      seconds: 0.5,
      label: 'UART 回報 2400～2499 mV（旋鈕約在 75 %）',
    },
    { kind: 'firmware-checks', project: 'hal-adc-pot', label: '韌體行為契約：每 100 ms 一次轉換，0 V → 0、3.3 V → 4095' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'divider',
      title: '把可變電阻接成分壓器',
      body:
        '用「導線」工具接 `e40`（逆時針端）→ `top-31`（上方 − 電源軌），再接 `e42`（順時針端）→ `top+33`（上方 + 電源軌，**3.3 V**）。\n\n' +
        '注意：下方 + 電源軌是 5 V，類比腳位不耐 5 V，千萬別接錯。',
      highlight: { holes: ['e40', 'e42'], components: ['RV1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { component: 'RV1', pin: 'ccw' }, b: { terminal: 'PS1:-' } },
          { kind: 'connected', a: { component: 'RV1', pin: 'cw' }, b: { component: 'U1', pin: '3V3_1' } },
        ],
        label: 'RV1 兩端接 GND 與 3.3 V',
      },
    },
    {
      id: 'wiper',
      title: '中間腳接到 PA0',
      body: '用導線接 `e41`（中間腳）→ `a25`（PA0 唯一的空孔）。\n\nPA0 就是 ADC1 的通道 0（IN0）。',
      highlight: { holes: ['e41', PA0], components: ['RV1'] },
      check: { kind: 'connected', a: { component: 'RV1', pin: 'wiper' }, b: pa0, label: '中間腳接到 PA0' },
    },
    {
      id: 'firmware',
      title: '載入 hal-adc-pot，打開終端機',
      body:
        '按下方的「載入 hal-adc-pot 到 U1」，再按「▶ 執行模擬」（或空白鍵）；打開儀器的「UART 終端機」，選 U1 的 **USART1**（115200 8N1）：每 100 ms 一行 `adc=… mv=…`。\n\n' +
        '旋鈕現在在 50 %：約 `adc=2048 mv=1650`。',
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-adc-pot', label: 'U1 已載入 hal-adc-pot' },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'hal-adc-pot' }, { kind: 'run' }],
    },
    {
      id: 'turn',
      title: '把旋鈕轉到 75 %',
      body:
        '點一下 RV1，在屬性面板把「位置」改成 **0.75**（模擬執行中也可以直接轉動旋鈕），終端機的數字立刻跟著變：約 `adc=3071 mv=2475`。\n\n' +
        '驗算：0.75 × 3.3 V = 2.475 V；2.475 ÷ 3.3 × 4095 = 3071.25 → 3071。',
      highlight: { components: ['RV1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'mv=24', seconds: 0.5, label: 'UART 回報約 2475 mV' },
    },
    {
      id: 'explore',
      title: '探索：兩個極端與 5 V 的危險',
      body:
        '把旋鈕轉到 0 與 1，看讀值變成 `adc=0 mv=0` 與 `adc=4095 mv=3300`；體驗完把旋鈕轉回 75 %，再到「驗收」按「檢查我的電路」。\n\n' +
        'ADC 的範圍正好是 0～VDDA。想看看接錯 5 V 的後果，可以把順時針端的導線改接到下方 + 電源軌：旋鈕超過約 66 % 就卡在 4095，電氣規則檢查也會警告（體驗完記得改回 3.3 V）。',
      highlight: { components: ['RV1', 'U1'] },
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'potentiometer'],
    firmware: ['hal-adc-pot'],
  },
  durationMin: 30,
}
