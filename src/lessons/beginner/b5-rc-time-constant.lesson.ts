/**
 * b5 — RC 充放電 (RC charge / discharge, the time constant τ = RC).
 *
 * Function generator FG1: 10 Hz square, 0–5 V (amplitude 2.5 V, offset
 * 2.5 V, 50 Ω output) → R1 10 kΩ → C1 1 µF → GND. Scope CH1 on the
 * generator output, CH2 on the capacitor. τ = (10 kΩ + 50 Ω) × 1 µF =
 * 10.05 ms; a half period (50 ms) is 5 τ. The FG square starts HIGH at t = 0
 * and C1 starts discharged, so a run from power-on charges C1 from 0 V:
 * V(τ) = 63.2 % of 5 V.
 * PS1 only provides the circuit ground the generator and probes share.
 *
 * The τ acceptance check reads V_C at one time constant: two non-fresh
 * measurements share the evaluator's power-on session — the first spans
 * 0–9.5 ms (and checks the generator is in its 5 V half period), the second
 * 9.5–10.5 ms (the evaluator's 1 ms minimum window), whose voltage is the
 * average over its second half, 10.0–10.5 ms. For a charge from 0 V that
 * average is 5 V × (1 − (τ/0.5 ms)(e^(−10/τ) − e^(−10.5/τ))): 3.03–3.40 V
 * ⇔ τ = 9–11 ms (10 ms ±10 %); nominal τ = 10.05 ms gives 3.20 V. It is the
 * FIRST acceptance check that uses the shared session (every other
 * measurement is `fresh`), so its timing never depends on the checks before
 * it.
 */
import type { Lesson, LessonCheck } from '../types'
import { bench, bullets, doc, offboard, part, supply, supplyWires, wire } from './bench'

const FG1 = offboard('FG1', 'function_generator', { waveform: 'square', frequency: 10, amplitude: 2.5, offset: 2.5 })
const C1 = part('C1', 'capacitor', ['c16', 'c18'], { capacitance: 1e-6 }) // p1 = RC node (column 16)
const PRB1 = part('PRB1', 'scope_probe', ['d10'], { channel: 1 }) // generator output (column 10)
const PRB2 = part('PRB2', 'scope_probe', ['d16'], { channel: 2 }) // capacitor voltage

const START = bench('b5 RC 充放電（起始）', [supply(5), FG1, C1, PRB1, PRB2], supplyWires())

const SOLUTION = bench(
  'b5 RC 充放電（解答）',
  [supply(5), FG1, C1, PRB1, PRB2, part('R1', 'resistor', ['b10', 'b16'], { resistance: 10000 })],
  [
    ...supplyWires(),
    wire('W3', 'FG1:out', 'a10', 'yellow'),
    wire('W4', 'FG1:gnd', 'top-2', 'black'),
    wire('W5', 'a18', 'top-15', 'black'),
  ],
)

const NODE = { component: 'C1', pin: 'p1' }

/** V_C one time constant after the first rising edge (see the header). */
const TAU_CHECK: LessonCheck = {
  kind: 'all',
  label: 'τ = 10 ms ±10 %：上升緣後約 1 τ（10.0–10.5 ms），V_C 充到 5 V 的約 63 %（3.03–3.40 V）',
  checks: [
    {
      kind: 'measure',
      at: { terminal: 'FG1:out' },
      quantity: 'voltage',
      min: 4.9,
      max: 5.1,
      seconds: 0.0095,
      label: '0–9.5 ms：方波在高準位，FG1 輸出約 5 V（4.9–5.1 V）',
    },
    {
      kind: 'measure',
      at: NODE,
      quantity: 'voltage',
      min: 3.03,
      max: 3.4,
      seconds: 0.001,
      label: '10.0–10.5 ms：V_C 平均 3.03–3.40 V（對應 τ = 9–11 ms）',
    },
  ],
}

export const LESSON: Lesson = {
  id: 'b5-rc-time-constant',
  level: 'beginner',
  order: 5,
  title: 'RC 充放電',
  summary:
    '用函數產生器的 10 Hz 方波反覆對 10 kΩ + 1 µF 充放電，在示波器上量出時間常數 τ = RC ≈ 10 ms：充電一個 τ 到達 63 %，放電一個 τ 剩下 37 %。',
  objectives: [
    '寫出電容充電 V_C(t) = V_S × (1 − e^(−t/τ)) 與放電 V_C(t) = V_0 × e^(−t/τ) 的公式，τ = R × C',
    '算出 10 kΩ × 1 µF = 10 ms，並記住 1 τ = 63.2 %、3 τ = 95 %、5 τ = 99.3 % 這幾個關鍵數字',
    '設定函數產生器輸出 0–5 V、10 Hz 的方波（振幅 2.5 V、偏移 2.5 V）',
    '用示波器的觸發與時間游標量出 τ，誤差在 ±10 % 以內',
    '說明為什麼方波的半週期要大於 5 τ，電容才能完全充放電',
  ],
  wiring: doc(
    '函數產生器 FG1 已設為 **方波、10 Hz、振幅 2.5 V、偏移 2.5 V**，輸出在 0 V 與 5 V 之間切換。電源供應器 PS1 在本課只提供共同的接地參考（top− 電源軌）。',
    bullets(
      '導線 `FG1:out` → `a10`（a 列第 10 欄）：訊號進入第 10 欄。',
      '導線 `FG1:gnd` → `top-2`（上方 − 電源軌第 2 孔）：函數產生器的地接到電路的接地軌（**共地**）。',
      'R1（10 kΩ）：`b10` → `b16`。',
      'C1（1 µF）已插在 `c16` 與 `c18`；導線 `a18` → `top-15` 把 C1 另一端接地。第 16 欄就是 RC 節點（電容電壓）。',
      '示波器探棒：PRB1（通道 1）在 `d10` 量輸入方波，PRB2（通道 2）在 `d16` 量電容電壓。',
    ),
  ),
  theory: doc(
    '**電容的基本關係**：電容儲存電荷 Q = C × V，流過電容的電流 i = C × dV/dt——電壓變化越快，電流越大，所以電容電壓**不能瞬間改變**。',
    '**充電**：方波從 0 V 跳到 5 V 時，電容經 R 充電，一開始電流最大（5 V ÷ 10 kΩ = 0.5 mA），隨著電容電壓上升，R 兩端的電壓變小，電流也越來越小：',
    'V_C(t) = 5 V × (1 − e^(−t/τ))，τ = R × C',
    '**放電**：方波回到 0 V 時，電容經 R 放電：V_C(t) = V_0 × e^(−t/τ)。',
    '**本課的 τ**：τ = 10 kΩ × 1 µF = 10 ms。函數產生器有 50 Ω 的輸出阻抗與 R 串聯，所以精確值是 (10 kΩ + 50 Ω) × 1 µF = 10.05 ms，差 0.5 %。',
    bullets(
      '1 τ（10 ms）：充到 63.2 % → 3.16 V；放電剩 36.8 % → 1.84 V',
      '2 τ（20 ms）：86.5 % → 4.32 V',
      '3 τ（30 ms）：95.0 % → 4.75 V',
      '5 τ（50 ms）：99.3 % → 4.97 V，工程上視為「充滿」',
    ),
    '**為什麼選 10 Hz**：週期 100 ms，每個半週期 50 ms = 5 τ，電容每次都能幾乎完全充飽、放光，波形就是漂亮的指數曲線。頻率太高時半週期比 τ 短，電容來不及充放電，波形變成在 2.5 V 附近小幅擺動的三角形。',
    '**用示波器量 τ**：觸發來源設 CH1、上升緣，觸發準位 2.5 V；用時間游標一條對準方波上升緣、另一條對準 CH2 升到 3.16 V（63.2 %）的位置，兩者時間差就是 τ。也可以看示波器的「上升時間 10–90 %」量測：t_r = τ × ln 9 ≈ 2.2 τ ≈ 22 ms。',
    '**低通濾波器**：同一個 RC 也是低通濾波器，截止頻率 f_c = 1 ÷ (2π × R × C) ≈ 15.9 Hz。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    '通道 1：0 V 與 5 V 之間切換的 10 Hz 方波（高 50 ms、低 50 ms）',
    '通道 2：上升緣後 10 ms 時約 3.16 V（63 %），50 ms 時約 4.97 V；下降緣後 10 ms 時約 1.84 V（37 %）',
    '量到的 τ ≈ 10.05 ms（容許 9–11 ms，±10 %；自動驗收讀取上升緣後 10.0–10.5 ms 的 V_C 平均，解答約 3.20 V，需在 3.03–3.40 V 之間）；10–90 % 上升時間約 22 ms',
    '充電起始電流 5 V ÷ 10.05 kΩ ≈ 0.50 mA',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  mistakes: [
    {
      symptom: '電容電壓一直是 0 V，電氣規則檢查顯示 FG1 沒有共同接地的風險',
      cause: '`FG1:gnd` 沒有接到接地軌：函數產生器的輸出沒有回流路徑，電流無法經 R、C 流回產生器',
      fix: '把 `FG1:gnd` 接到 top− 電源軌',
    },
    {
      symptom: '電容電壓變成在 2.5 V 附近小幅擺動的三角形波',
      cause: '頻率太高，例如 100 Hz：半週期 5 ms 只有 0.5 τ，電容來不及充放電',
      fix: '把頻率調回 10 Hz（半週期 50 ms = 5 τ）',
    },
    {
      symptom: '電容電壓幾乎不動',
      cause: '電容值設錯，例如設成 1 mF（0.001 F）：τ = 10 s，在 50 ms 的半週期內只充到約 0.5 %',
      fix: '在屬性面板把 C1 設為 1 µF（1e-6 F）',
    },
    {
      symptom: '方波在 −2.5 V 與 +2.5 V 之間擺動，電容電壓也變成負的',
      cause: '函數產生器的直流偏移設成 0 V：方波 = 偏移 ± 振幅',
      fix: '振幅 2.5 V、偏移 2.5 V，輸出才會是 0–5 V',
    },
    {
      symptom: '通道 2 也是方波，看不到指數曲線',
      cause: '探棒 PRB2 插在 R1 的輸入端（第 10 欄），量到的是函數產生器的輸出，而不是電容電壓',
      fix: '把 PRB2 移到第 16 欄（R1 與 C1 的接點）',
    },
  ],
  acceptance: [
    TAU_CHECK,
    {
      kind: 'connected',
      a: { terminal: 'FG1:out' },
      b: NODE,
      via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
      label: 'FG1 輸出經 10 kΩ 電阻接到 C1',
    },
    {
      kind: 'connected',
      a: NODE,
      b: { terminal: 'PS1:-' },
      via: { type: 'capacitor', param: 'capacitance', min: 0.95e-6, max: 1.05e-6 },
      label: 'C1（1 µF）接在 RC 節點與接地之間',
    },
    { kind: 'connected', a: { terminal: 'FG1:gnd' }, b: { terminal: 'PS1:-' }, label: 'FG1:gnd 接到電路接地（共地）' },
    {
      kind: 'all',
      checks: [
        { kind: 'connected', a: { component: 'PRB1', pin: 'tip' }, b: { terminal: 'FG1:out' } },
        { kind: 'connected', a: { component: 'PRB2', pin: 'tip' }, b: NODE },
      ],
      label: '示波器通道 1 量輸入方波、通道 2 量電容電壓',
    },
    {
      kind: 'measure',
      at: { terminal: 'FG1:out' },
      quantity: 'frequency',
      min: 9.5,
      max: 10.5,
      seconds: 0.5,
      fresh: true,
      label: '輸入方波 10 Hz（半週期 50 ms = 5 τ，電容能完全充放電）',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
  ],
  steps: [
    {
      id: 'b5-s1',
      title: '設定函數產生器',
      body: doc(
        '點一下函數產生器 FG1，在屬性面板確認：波形 = 方波、頻率 = 10 Hz、振幅 = 2.5 V、偏移 = 2.5 V。',
        '輸出 = 偏移 ± 振幅 = 2.5 V ± 2.5 V，也就是在 0 V 與 5 V 之間切換，高、低各 50 ms。',
      ),
      highlight: { components: ['FG1'] },
    },
    {
      id: 'b5-s2',
      title: '接上 R1 與共地',
      body: doc(
        '用「導線」工具接 `FG1:out` → `a10`、`FG1:gnd` → `top-2`；按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `b10` 與 `b16` 放上 R1 並設為 `10000` Ω（10 kΩ）；最後用導線接 `a18` → `top-15`。',
        '「共地」很重要：函數產生器、電路與示波器量的都是相對於同一個接地的電壓。',
      ),
      highlight: { holes: ['a10', 'top-2', 'b10', 'b16', 'a18', 'top-15'], components: ['FG1', 'C1'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: { terminal: 'FG1:out' },
            b: NODE,
            via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
          },
          { kind: 'connected', a: { terminal: 'FG1:gnd' }, b: { terminal: 'PS1:-' } },
          { kind: 'connected', a: { component: 'C1', pin: 'p2' }, b: { terminal: 'PS1:-' } },
        ],
        label: 'FG1 → 10 kΩ → C1 → 接地，且 FG1 共地',
      },
    },
    {
      id: 'b5-s3',
      title: '在示波器上看充放電',
      body: doc(
        '模擬會自動執行，打開儀器的「示波器」：時基設為每格 10 ms，觸發來源 CH1、準位 2.5 V。',
        '通道 1 是方波，通道 2 是一段段的指數曲線：上升緣後快速上升、越來越慢地接近 5 V；下降緣後同樣地衰減到 0 V。',
      ),
      highlight: { components: ['PRB1', 'PRB2'] },
      check: {
        kind: 'measure',
        at: { terminal: 'FG1:out' },
        quantity: 'frequency',
        min: 9.5,
        max: 10.5,
        seconds: 0.5,
        label: '輸入方波頻率約 10 Hz',
      },
    },
    {
      id: 'b5-s4',
      title: '用游標量出 τ',
      body: doc(
        '在示波器開啟時間游標：第一條對準 CH1 的上升緣，第二條移到 CH2 升到 **3.16 V**（5 V 的 63.2 %）的位置。兩條游標的時間差就是 τ，應約為 **10 ms**。',
        '再量一次放電：從下降緣到 CH2 降到 **1.84 V**（36.8 %）也是約 10 ms。',
        '自動檢查用同樣的方法：從通電（方波的第一個上升緣）開始模擬，讀取 10.0–10.5 ms 之間 V_C 的平均值（約 1 τ 的位置）。τ = 10 ms 時約 3.20 V；3.03–3.40 V 對應 τ = 9–11 ms（±10 %）。',
      ),
      highlight: { components: ['PRB2'] },
      check: TAU_CHECK,
    },
    {
      id: 'b5-s5',
      title: '選做：改變 R 或 C',
      body: doc(
        '在屬性面板把 R1 改成 4.7 kΩ，或把 FG1 的頻率調到 100 Hz，看曲線怎麼變；觀察完請改回 R1 = 10 kΩ、頻率 10 Hz，再到「驗收」按「檢查我的電路」。',
        'R1 = 4.7 kΩ：τ ≈ 4.75 ms，曲線變陡。頻率 100 Hz：半週期只剩 5 ms，電容來不及充放電，波形變成三角形。',
      ),
      highlight: { components: ['R1', 'FG1'] },
    },
  ],
  runnable: 'ready',
  // the RC curve is read on the oscilloscope (its frequency check is an analog net, not a logic channel)
  requires: { parts: ['power_supply', 'function_generator', 'resistor', 'capacitor', 'scope_probe'], instrument: 'scope' },
  durationMin: 20,
}
