/**
 * b7 — NPN 電晶體開關 (NPN BJT as a saturated low-side switch).
 *
 * 5 V bench supply. Load: +5 V → R1 330 Ω → red LED1 → Q1 collector; Q1
 * (2N3904, holes c16/c17/c18 = E/B/C) emitter → GND. Base drive: slide
 * switch SW1 (c10 = a, c11 = common, c12 = b), common on +5 V, b → R2
 * 4.7 kΩ → base. DMM1 (V) across collector–emitter.
 *
 * Simulated values (Ebers-Moll βF = 150, βR = 3; tests/lessons/
 * beginner.test.ts runs them through the lesson evaluator): SW1 = b →
 * V_BE 0.721 V, I_B 0.910 mA, I_C 9.57 mA, V_CE(sat) 42.6 mV (forced
 * β ≈ 10.5). R2 = 1 kΩ → V_CE 19 mV; 10 kΩ → 60 mV; 100 kΩ → I_B 43 µA,
 * I_C 6.45 mA (active, β·I_B), V_CE 1.10 V; 1 MΩ → I_C 0.65 mA, V_CE 3.1 V.
 * SW1 = a (base open) → I_C 0.5 µA, V_CE 3.68 V. No base resistor → the
 * supply delivers > 2 A (ERC over-rating). Emitter and collector swapped →
 * reverse-active (βR = 3): I_LED 2.76 mA.
 *
 * Acceptance is evaluated with SW1 in position b (the labels say so).
 */
import type { Lesson } from '../types'
import { bench, bullets, doc, offboard, part, supply, supplyWires, wire } from './bench'

const DMM = offboard('DMM1', 'multimeter', { mode: 'V' })
const Q1 = part('Q1', 'npn', ['c16', 'c17', 'c18']) // emitter c16, base c17, collector c18
const LED1 = part('LED1', 'led', ['c22', 'c20'], { color: 'red' }) // anode column 22, cathode column 20
const sw = (state: 'a' | 'b') => part('SW1', 'slide_switch', ['c10', 'c11', 'c12'], { state }) // a, common, b

const START = bench('b7 NPN 電晶體開關（起始）', [supply(5), DMM, sw('a'), Q1, LED1], supplyWires())

const SOLUTION = bench(
  'b7 NPN 電晶體開關（解答）',
  [
    supply(5),
    DMM,
    sw('b'),
    Q1,
    LED1,
    part('R1', 'resistor', ['top+24', 'a22'], { resistance: 330 }), // LED current limit
    part('R2', 'resistor', ['a12', 'a17'], { resistance: 4700 }), // base resistor
  ],
  [
    ...supplyWires(),
    wire('W3', 'a11', 'top+11', 'red'), // SW1 common → +5 V
    wire('W4', 'a16', 'top-15', 'black'), // emitter → GND
    wire('W5', 'a20', 'a18', 'blue'), // LED1 cathode → collector
    wire('W6', 'DMM1:IN', 'e18', 'red'), // meter across collector–emitter
    wire('W7', 'DMM1:COM', 'e16', 'black'),
  ],
)

const GND = { terminal: 'PS1:-' }
const VCC = { terminal: 'PS1:+' }
const BASE = { component: 'Q1', pin: 'base' }
const COLLECTOR = { component: 'Q1', pin: 'collector' }
const EMITTER = { component: 'Q1', pin: 'emitter' }

export const LESSON: Lesson = {
  id: 'b7-npn-switch',
  level: 'beginner',
  order: 7,
  title: 'NPN 電晶體開關',
  summary:
    '用 2N3904 NPN 電晶體當開關驅動 LED：依負載電流算出基極電阻（4.7 kΩ），讓電晶體進入飽和，V_CE 只剩約 43 mV。再把基極電阻換成 100 kΩ，看看「沒飽和」的電晶體會怎樣。',
  objectives: [
    '說明 NPN 電晶體是「電流控制」的元件：放大區 I_C = β × I_B，飽和時 I_C 由負載決定',
    '依負載電流與最小 β 計算基極電阻：I_C ≈ 9.5 mA，取強迫 β = 10 → I_B ≈ 0.95 mA → R_B = (5 V − 0.7 V) ÷ 0.95 mA ≈ 4.5 kΩ，選 4.7 kΩ',
    '量測飽和電壓 V_CE_sat（約 43 mV），並說明為什麼開關電路要讓電晶體飽和',
    '比較基極電阻太大（100 kΩ：放大區，V_CE ≈ 1.1 V）與沒有基極電阻（基極電流失控）的後果',
  ],
  wiring: doc(
    '上方電源軌 **top+** = +5 V、**top−** = 接地（PS1 已接好）。滑動開關 SW1、電晶體 Q1、LED1 與電表 DMM1 都已放好。',
    bullets(
      'Q1 是 2N3904（TO-92 封裝）：平面朝向自己時，由左至右是 **射極 E**（`c16`）、**基極 B**（`c17`）、**集極 C**（`c18`）。',
      'SW1（滑動開關）：`c10` 是 a 端、`c11` 是共同端、`c12` 是 b 端。導線 `a11`（a 列第 11 欄）→ `top+11`（上方 + 電源軌第 11 孔）讓共同端接 +5 V；a 端不接，開關在 a 時基極沒有驅動。',
      'R2（基極電阻 4.7 kΩ，黃紫紅）：`a12` → `a17`，SW1 的 b 端接到基極。',
      '導線 `a16` → `top-15`：射極接地。',
      'R1（330 Ω）：`top+24` → `a22`；LED1（紅）已插在 `c22`（陽極）與 `c20`（陰極）；導線 `a20` → `a18` 把 LED 陰極接到集極。',
      'DMM1（V 檔）：`DMM1:IN` 接 `e18`（集極）、`DMM1:COM` 接 `e16`（射極），讀數就是 V_CE。',
    ),
  ),
  theory: doc(
    '**NPN 電晶體是電流控制的元件**：基極–射極接面像一顆二極體，導通時 V_BE ≈ 0.7 V。流進基極的小電流 I_B 讓集極流過大電流：在**放大區** I_C = β × I_B。模擬器的 2N3904 β = 150（資料手冊在 I_C = 10 mA 時 h_FE 為 100–300）。',
    '**飽和**：如果 β × I_B 大於負載允許的電流，I_C 就不再由基極決定，而是被負載限制；這時集極–射極之間只剩很小的**飽和電壓 V_CE_sat**，電晶體就像一個閉合的開關。2N3904 資料手冊保證 I_C = 10 mA、I_B = 1 mA 時 V_CE_sat ≤ 0.2 V。',
    '**設計基極電阻**（負載：5 V、330 Ω、紅色 LED）：',
    bullets(
      '負載電流：I_C ≈ (5 V − 1.8 V − 0.05 V) ÷ 330 Ω ≈ **9.5 mA**',
      '最少需要的基極電流：I_B_min = I_C ÷ β = 9.5 mA ÷ 150 ≈ 63 µA。但 β 隨個體、溫度變化很大，只給剛好的電流會停在放大區邊緣。',
      '開關電路的慣例是取**強迫 β = 10**：I_B = 9.5 mA ÷ 10 = 0.95 mA',
      'R_B = (V_驅動 − V_BE) ÷ I_B = (5 V − 0.7 V) ÷ 0.95 mA ≈ 4.5 kΩ，取標準值 **4.7 kΩ**：I_B = (5 V − 0.72 V) ÷ 4.7 kΩ ≈ 0.91 mA',
      '如果改用 3.3 V 的 GPIO 驅動：R_B = (3.3 V − 0.7 V) ÷ 0.95 mA ≈ 2.7 kΩ，腳位只需要供應約 1 mA，遠低於 STM32 每腳 25 mA 的上限。',
    ),
    '**為什麼一定要飽和**：電晶體消耗的功率 P = V_CE × I_C。飽和時 V_CE ≈ 43 mV，P ≈ 43 mV × 9.57 mA ≈ 0.4 mW；如果停在放大區（例如 R_B = 100 kΩ 時 V_CE ≈ 1.1 V、I_C ≈ 6.4 mA），P ≈ 7 mW，是 17 倍，負載也拿不到全部的電壓。負載電流越大，差別越明顯。',
    '**基極電阻不可省略**：基極–射極是二極體，直接接 5 V 時電流只受導線與接點電阻限制，會燒毀電晶體（2N3904 最大集極電流 200 mA），也可能拉垮電源或燒壞驅動它的腳位。',
    '**和 MOSFET 比較**：BJT 導通時需要持續的基極電流（本課約 0.9 mA），但只要約 0.7 V 就能開啟；MOSFET 的閘極沒有直流電流，但需要足夠的 V_GS。小電流負載兩者都適用，大電流負載通常選 MOSFET。',
    '**基極下拉**：開關在 a 時基極沒有驅動，模擬中幾乎沒有基極電流，I_C 只有約 0.5 µA。實務上常在基極與射極之間加 10–100 kΩ，讓漏電流或雜訊無法讓電晶體導通（驅動端是微控制器時尤其重要）。',
    '**模擬器的限制**：模擬器的電晶體是 βF = 150、βR = 3 的大訊號傳輸模型，沒有接面電容與爾利效應，所以看不到飽和電晶體關閉時的儲存時間（2N3904 約 200 ns）；直流的放大區、飽和與截止都是完整模擬。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    'SW1 在 b：V_BE ≈ 0.72 V，I_B ≈ 0.91 mA，I_C = LED1 電流 ≈ 9.57 mA',
    'SW1 在 b：DMM1（V_CE）約 43 mV（飽和；驗收要求小於 0.3 V），強迫 β ≈ 9.57 mA ÷ 0.91 mA ≈ 10.5',
    'SW1 在 a：基極沒有驅動，I_C 約 0.5 µA，LED1 熄滅，DMM1 約 3.7 V',
    'R2 改成 1 kΩ：V_CE ≈ 19 mV；10 kΩ：V_CE ≈ 60 mV；100 kΩ：I_C ≈ 6.4 mA、V_CE ≈ 1.1 V（放大區）',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  mistakes: [
    {
      symptom: 'LED 有亮但偏暗（約 6.4 mA），DMM1 讀到 V_CE ≈ 1.1 V，驗收的 V_CE 條件不通過',
      cause: '基極電阻太大（100 kΩ）：I_B = 4.3 V ÷ 100 kΩ = 43 µA，β × I_B = 150 × 43 µA ≈ 6.4 mA，小於負載需要的 9.5 mA，電晶體停在放大區，沒有飽和',
      fix: '依強迫 β = 10 計算，把 R2 換成 4.7 kΩ',
    },
    {
      symptom: '電氣規則檢查出現「電源電流超過 2 A」的風險，模擬記錄出現可能短路的警告',
      cause: '省略了基極電阻，SW1 的 b 端直接接到基極：基極–射極二極體直接跨在 5 V 上，電流只受導線與開關接點電阻限制',
      fix: '在 SW1 的 b 端與基極之間串聯 4.7 kΩ 基極電阻',
    },
    {
      symptom: 'LED 很暗（約 2.8 mA），DMM1 讀到約 2.4 V',
      cause: '電晶體插反，射極與集極對調：電晶體工作在反向放大區，反向 β 只有約 3（模擬器 βR = 3），I_C 被限制在約 3 × I_B',
      fix: '平面朝向自己，由左至右 E-B-C：射極接地、集極接 LED',
    },
    {
      symptom: 'LED 一直亮，開關沒有作用',
      cause: 'LED 陰極直接接到接地軌，電晶體被旁路，不在電流路徑上',
      fix: 'LED 陰極接到集極（第 18 欄），射極再接地',
    },
  ],
  acceptance: [
    {
      kind: 'connected',
      a: VCC,
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 220, max: 1000 },
      label: 'LED1 陽極經 220 Ω–1 kΩ 限流電阻接到 +5 V',
    },
    { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: COLLECTOR, label: 'LED1 陰極接到 Q1 集極' },
    { kind: 'connected', a: EMITTER, b: GND, label: 'Q1 射極接地' },
    { kind: 'not-connected', a: COLLECTOR, b: EMITTER, label: 'Q1 集極與射極沒有被導線短路（電流必須經過電晶體）' },
    { kind: 'connected', a: { component: 'SW1', pin: 'common' }, b: VCC, label: 'SW1 共同端接 +5 V' },
    {
      kind: 'connected',
      a: { component: 'SW1', pin: 'b' },
      b: BASE,
      via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 },
      label: 'SW1 的 b 端經 1–10 kΩ 基極電阻接到 Q1 基極',
    },
    {
      kind: 'measure',
      at: { component: 'LED1', pin: 'anode' },
      quantity: 'current',
      component: 'LED1',
      min: 0.005,
      max: 0.015,
      seconds: 0.05,
      fresh: true,
      label: 'SW1 在 b 時 LED1 亮，電流 5–15 mA',
    },
    {
      kind: 'measure',
      at: COLLECTOR,
      quantity: 'voltage',
      min: 0,
      max: 0.3,
      seconds: 0.05,
      fresh: true,
      label: 'SW1 在 b 時 V_CE < 0.3 V（電晶體飽和）',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
  ],
  steps: [
    {
      id: 'b7-s1',
      title: '認識 2N3904 的腳位',
      body: doc(
        '先認識 Q1（電路板上已標示出來）：平面朝向自己時，由左至右是射極 E（`c16`）、基極 B（`c17`）、集極 C（`c18`）。看完按「下一步」。',
        '把它想成一個由基極電流控制的開關：電流從基極流進、射極流出時，集極到射極之間就能流過約 β 倍的電流。',
      ),
      highlight: { holes: ['c16', 'c17', 'c18'], components: ['Q1'] },
    },
    {
      id: 'b7-s2',
      title: '算出基極電阻',
      body: doc(
        '算一算：基極電阻 R_B = (5 V − 0.7 V) ÷ 0.95 mA ≈ 4.5 kΩ，取標準值 **4.7 kΩ**（色碼：黃、紫、紅）。',
        '負載電流 I_C ≈ (5 V − 1.8 V − 0.05 V) ÷ 330 Ω ≈ 9.5 mA。取強迫 β = 10：I_B = 0.95 mA。即使 β 只有 100，4.7 kΩ 給的 0.91 mA 也遠超過需要的 95 µA，保證飽和。',
      ),
      highlight: { components: ['Q1'] },
    },
    {
      id: 'b7-s3',
      title: '接上 LED 負載',
      body: doc(
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `top+24` 與 `a22` 放上 R1 並設為 `330` Ω；再用「導線」工具接 `a20` → `a18`（LED1 陰極接集極）與 `a16` → `top-15`（射極接地）。',
        '電流路徑：+5 V → R1 → LED1 → Q1（集極 → 射極）→ 接地。',
      ),
      highlight: { holes: ['top+24', 'a22', 'a20', 'a18', 'a16', 'top-15'], components: ['LED1', 'Q1'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: VCC,
            b: { component: 'LED1', pin: 'anode' },
            via: { type: 'resistor', param: 'resistance', min: 220, max: 1000 },
          },
          { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: COLLECTOR },
          { kind: 'connected', a: EMITTER, b: GND },
        ],
        label: '+5 V → 電阻 → LED1 → Q1 集極，射極接地',
      },
    },
    {
      id: 'b7-s4',
      title: '接上基極驅動',
      body: doc(
        '用導線接 `a11` → `top+11`（SW1 共同端接 +5 V）；再拿一顆電阻，依序點 `a12` 與 `a17` 放上 R2（b 端到基極），並設為 `4700` Ω。',
        '開關在 b 時，基極電流 I_B = (5 V − 0.72 V) ÷ 4.7 kΩ ≈ 0.91 mA。',
      ),
      highlight: { holes: ['a11', 'top+11', 'a12', 'a17'], components: ['SW1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { component: 'SW1', pin: 'common' }, b: VCC },
          {
            kind: 'connected',
            a: { component: 'SW1', pin: 'b' },
            b: BASE,
            via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 },
          },
        ],
        label: 'SW1 經 1–10 kΩ 基極電阻接到 Q1 基極',
      },
    },
    {
      id: 'b7-s5',
      title: '切換開關：截止與飽和',
      body: doc(
        '模擬會自動執行，在屬性面板把 SW1 從 **a** 切到 **b**（或在麵包板上撥動滑桿）：LED1 從不亮變成亮起，電流約 **9.57 mA**。',
        '滑桿在 a 時基極沒有電流，電晶體截止；在 b 時基極有約 0.91 mA，電晶體飽和。點一下 Q1，屬性面板顯示 V_BE ≈ 0.72 V。',
      ),
      highlight: { components: ['SW1', 'Q1', 'LED1'] },
      check: {
        kind: 'measure',
        at: { component: 'LED1', pin: 'anode' },
        quantity: 'current',
        component: 'LED1',
        min: 0.005,
        max: 0.015,
        seconds: 0.05,
        label: 'SW1 在 b 時 LED1 電流 5–15 mA',
      },
    },
    {
      id: 'b7-s6',
      title: '用電表量飽和電壓 V_CE_sat',
      body: doc(
        '用「導線」工具把 `DMM1:IN` 接 `e18`（集極）、`DMM1:COM` 接 `e16`（射極）。SW1 在 b 時，DMM1 約 **43 mV**——電晶體飽和了。',
        '強迫 β = I_C ÷ I_B ≈ 9.57 mA ÷ 0.91 mA ≈ 10.5，遠小於電晶體本身的 β = 150，這正是飽和的特徵。',
      ),
      highlight: { holes: ['e18', 'e16'], components: ['DMM1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { terminal: 'DMM1:IN' }, b: COLLECTOR },
          { kind: 'connected', a: { terminal: 'DMM1:COM' }, b: EMITTER },
          { kind: 'measure', at: { terminal: 'DMM1:IN' }, quantity: 'voltage', min: 0, max: 0.3, seconds: 0.05 },
        ],
        label: 'DMM1 接在集極–射極之間，讀數小於 0.3 V',
      },
    },
    {
      id: 'b7-s7',
      title: '選做：基極電阻太大會怎樣',
      body: doc(
        '在屬性面板把 R2 改成 **100 kΩ**，看 LED 變暗、DMM1 升到約 **1.1 V**；觀察完請把 R2 改回 4.7 kΩ，保持 SW1 在 b，再到「驗收」按「檢查我的電路」。',
        'I_B 只剩 43 µA，β × I_B ≈ 6.4 mA 不夠負載需要的 9.5 mA，所以 LED 只有約 6.4 mA——電晶體停在放大區。',
      ),
      highlight: { components: ['R2', 'DMM1'] },
    },
  ],
  runnable: 'ready',
  requires: { parts: ['power_supply', 'multimeter', 'slide_switch', 'npn', 'led', 'resistor'] },
  durationMin: 20,
}
