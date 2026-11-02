/**
 * b6 — MOSFET 控制 LED (logic-level MOSFET as a low-side switch).
 *
 * 5 V bench supply. Load: +5 V → R1 330 Ω → red LED1 → Q1 drain; Q1
 * (IRLZ44N, holes c16/c17/c18 = G/D/S) source → GND. Gate drive: slide
 * switch SW1 (c10 = a, c11 = common, c12 = b) with the common on +5 V;
 * position b drives the gate through R2 100 Ω, position a leaves the drive
 * open and R3 10 kΩ pulls the gate to GND. DMM1 (V) across drain–source.
 *
 * Simulated values (tests/lessons/beginner.test.ts runs them through the
 * lesson evaluator): SW1 = b → V_G 4.950 V, I_D = I_LED 9.70 mA, V_DS
 * 0.247 mV (R_DS(on) ≈ 25 mΩ); SW1 = a → V_G ≈ 0 V, I_LED 0.4 µA, V_DS
 * 3.73 V. Without R3 the open gate settles at ≈ 1.67 V (the open switch's
 * 1 nS leakage against the solver's tiny node-to-ground conductance), above
 * the 1.5 V threshold: the LED stays on. Drain and source swapped: the body
 * diode conducts with SW1 = a (I_LED 7.6 mA).
 *
 * Acceptance is evaluated with SW1 in position b (the label says so); the
 * off state is the step check of b6-s4 (SW1 = a), the solution keeps b.
 */
import type { Lesson } from '../types'
import { bench, bullets, doc, offboard, part, supply, supplyWires, wire } from './bench'

const DMM = offboard('DMM1', 'multimeter', { mode: 'V' })
const Q1 = part('Q1', 'irlz44n', ['c16', 'c17', 'c18']) // gate c16, drain c17, source c18 (body overhangs c15 / c19)
const LED1 = part('LED1', 'led', ['c22', 'c20'], { color: 'red' }) // anode column 22, cathode column 20
const sw = (state: 'a' | 'b') => part('SW1', 'slide_switch', ['c10', 'c11', 'c12'], { state }) // a, common, b

const START = bench('b6 MOSFET 控制 LED（起始）', [supply(5), DMM, sw('a'), Q1, LED1], supplyWires())

const SOLUTION = bench(
  'b6 MOSFET 控制 LED（解答）',
  [
    supply(5),
    DMM,
    sw('b'),
    Q1,
    LED1,
    part('R1', 'resistor', ['top+24', 'a22'], { resistance: 330 }), // current limit for LED1
    part('R2', 'resistor', ['a12', 'a16'], { resistance: 100 }), // gate resistor
    part('R3', 'resistor', ['b16', 'top-15'], { resistance: 10000 }), // gate pull-down
  ],
  [
    ...supplyWires(),
    wire('W3', 'a11', 'top+11', 'red'), // SW1 common → +5 V
    wire('W4', 'a18', 'top-19', 'black'), // source → GND
    wire('W5', 'a20', 'a17', 'blue'), // LED1 cathode → drain
    wire('W6', 'DMM1:IN', 'e17', 'red'), // meter across drain–source
    wire('W7', 'DMM1:COM', 'e18', 'black'),
  ],
)

const GND = { terminal: 'PS1:-' }
const VCC = { terminal: 'PS1:+' }
const GATE = { component: 'Q1', pin: 'gate' }
const DRAIN = { component: 'Q1', pin: 'drain' }
const SOURCE = { component: 'Q1', pin: 'source' }

export const LESSON: Lesson = {
  id: 'b6-mosfet-led',
  level: 'beginner',
  order: 6,
  title: 'MOSFET 控制 LED',
  summary:
    '用邏輯準位 MOSFET（IRLZ44N）當作「低側開關」控制 LED：開關把 5 V 送到閘極時 LED 亮，斷開時 10 kΩ 下拉電阻讓 MOSFET 確實關閉。用電表量出導通時汲極–源極之間只剩約 0.25 mV。',
  objectives: [
    '說明 N 通道 MOSFET 是「電壓控制」的開關：V_GS 超過臨界電壓 V_th 就導通，閘極幾乎不吃直流電流',
    '接出低側開關：負載（330 Ω + LED）接在 +5 V 與汲極之間，源極接地，所以 V_GS 就等於閘極對地的電壓',
    '說明閘極電阻（100 Ω）與閘極下拉電阻（10 kΩ）各自的用途，並算出 V_G = 5 V × 10 kΩ ÷ 10.1 kΩ ≈ 4.95 V',
    '用 R_DS(on) 算出導通壓降：V_DS = 9.7 mA × 25 mΩ ≈ 0.25 mV，並用電表驗證',
    '認識 MOSFET 的本體二極體，知道汲極與源極接反時為什麼關不掉',
  ],
  wiring: doc(
    '上方電源軌 **top+** = +5 V、**top−** = 接地（PS1 已接好）。滑動開關 SW1、MOSFET Q1、LED1 與電表 DMM1 都已放好，你要加上三顆電阻與導線。',
    bullets(
      'Q1 是 IRLZ44N（TO-220 封裝）：印字面朝向自己時，由左至右是 **閘極 G**（`c16`）、**汲極 D**（`c17`）、**源極 S**（`c18`）；金屬散熱片和汲極相連。它的本體比腳位寬，`c15` 與 `c19` 被蓋住，不要插東西。',
      'SW1（滑動開關）：`c10` 是 a 端、`c11` 是共同端、`c12` 是 b 端。滑桿在 b 時共同端接到 b，在 a 時接到 a。',
      '導線 `a11`（a 列第 11 欄）→ `top+11`（上方 + 電源軌第 11 孔）：SW1 共同端接 +5 V。a 端（第 10 欄）**刻意不接**——開關在 a 時，閘極的驅動就斷開了，就像微控制器的腳位在重置期間不輸出任何電壓。',
      'R2（閘極電阻 100 Ω）：`a12` → `a16`，SW1 的 b 端接到閘極。',
      'R3（閘極下拉 10 kΩ）：`b16` → `top-15`，閘極接地。',
      '導線 `a18` → `top-19`：源極接地。',
      'R1（330 Ω）：`top+24` → `a22`；LED1（紅）已插在 `c22`（陽極）與 `c20`（陰極）；導線 `a20` → `a17` 把 LED 陰極接到汲極。',
      'DMM1（V 檔）：`DMM1:IN` 接 `e17`（汲極）、`DMM1:COM` 接 `e18`（源極），讀數就是 V_DS。',
    ),
  ),
  theory: doc(
    '**MOSFET 是電壓控制的開關**：閘極和通道之間隔著一層很薄的氧化層，直流電流幾乎為零。當閘極–源極電壓 V_GS 超過**臨界電壓 V_th**，汲極與源極之間形成導電通道；V_GS 越高，導通電阻 **R_DS(on)** 越小。',
    '**邏輯準位 MOSFET**：IRLZ44N 的 V_th 是 1.0–2.0 V（模擬器使用 1.5 V），資料手冊保證 V_GS = 5 V 時 R_DS(on) ≤ 25 mΩ、4 V 時 ≤ 35 mΩ，所以 5 V 或 3.3 V 的邏輯訊號就能讓它完全導通。外型相同的 IRFZ44N 是一般功率 MOSFET，R_DS(on) 規格在 V_GS = 10 V，用 3.3 V 驅動不保證能完全導通——選料時要看清楚。',
    '**低側開關**：MOSFET 放在負載和接地之間（汲極接負載、源極接地）。源極固定在 0 V，所以 V_GS 就是閘極對地的電壓，驅動最簡單。',
    '**本課的數字**：',
    bullets(
      '閘極：R2（100 Ω）與 R3（10 kΩ）形成分壓，V_G = 5 V × 10 kΩ ÷ (10 kΩ + 100 Ω) ≈ **4.95 V**；開關要供應 4.95 V ÷ 10 kΩ ≈ 0.5 mA 給下拉電阻，MOSFET 本身不吃閘極電流。',
      '負載電流：I_D = (5 V − 1.8 V − V_DS) ÷ 330 Ω ≈ **9.7 mA**。',
      '導通壓降：V_DS = I_D × R_DS(on) = 9.7 mA × 25 mΩ ≈ **0.25 mV**；MOSFET 消耗 P = I_D² × R_DS(on) ≈ 2.4 µW，幾乎不發熱。',
      '同一顆 IRLZ44N 控制 10 A 的馬達時：V_DS = 10 A × 25 mΩ = 0.25 V，P = 10² × 0.025 = 2.5 W，已超過不加散熱片時約 2.4 W 的能力，要加散熱片。',
    ),
    '**為什麼要閘極下拉電阻**：開關切到 a（或微控制器重置、腳位還沒設定成輸出）時，閘極沒有任何東西驅動，處於**浮接**狀態。真實 MOSFET 的閘極像一顆約 1.7 nF 的電容，浮接時會保留上一次的電荷（繼續導通），或被雜訊感應而半導通——半導通的 MOSFET 工作在線性區，會大量發熱。10 kΩ 下拉電阻在沒有驅動時把閘極放電到 0 V，保證關閉。',
    '**為什麼要閘極電阻**：切換瞬間，驅動端要對閘極電容充放電，100 Ω 限制這個突波電流（5 V ÷ 100 Ω = 50 mA 以內），保護微控制器的腳位並減少振鈴。',
    '**本體二極體**：功率 MOSFET 內部有一顆從源極指向汲極的二極體。正常接法下它被逆向偏壓、不導通；如果汲極與源極接反，這顆二極體就會順向導通，負載永遠有電流，MOSFET 關不掉。',
    '**模擬器的限制**：模擬器的 MOSFET 沒有閘極電容，切換是瞬間完成的，所以看不到閘極電阻減緩切換邊緣的效果；直流的導通／截止、R_DS(on)、下拉電阻與本體二極體都是完整模擬。另外，模擬中浮接的閘極會被開關斷開時的漏電（約 1 GΩ）帶到約 1.7 V，而不是保留電荷——結果同樣是「關不掉」。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    'SW1 在 b：Q1 閘極約 4.95 V，LED1 亮，電流約 9.7 mA（亮度約 49 %，以額定 20 mA 為 100 %）',
    'SW1 在 b：DMM1（V_DS）約 0.25 mV，對應 R_DS(on) ≈ 0.25 mV ÷ 9.7 mA ≈ 25 mΩ',
    'SW1 在 a：閘極被 R3 拉到約 0 V，LED1 熄滅（電流小於 1 µA），DMM1 約 3.7 V',
    'R3 流過約 0.5 mA（4.95 V ÷ 10 kΩ），閘極本身沒有直流電流',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  mistakes: [
    {
      symptom: '開關切到 a 之後 LED 仍然亮著（約 9.7 mA），閘極電壓停在約 1.7 V',
      cause: '沒有接下拉電阻 R3：開關斷開時閘極浮接，沒有任何東西把它拉回 0 V。模擬中閘極被開關斷開時的漏電帶到約 1.7 V，高於 1.5 V 的臨界電壓；真實電路則會保留閘極電荷或被雜訊觸發',
      fix: '在閘極與接地之間加 10 kΩ 下拉電阻（`b16` → `top-15`）',
    },
    {
      symptom: '不論開關在哪個位置 LED 都亮；開關在 a 時電流約 7.6 mA，第 17 欄（LED 陰極那一欄）約 0.7 V',
      cause: 'Q1 的汲極與源極接反（汲極接地、源極接 LED）：內部本體二極體從源極指向汲極，此時順向導通，電流繞過通道流到地',
      fix: '依 G-D-S 的順序插回：汲極（中間腳）接 LED 陰極，源極（右腳）接地',
    },
    {
      symptom: '開關的動作相反：切到 b 時 LED 熄滅，切到 a 時才亮',
      cause: 'R2 接到了 SW1 的 a 端（第 10 欄）而不是 b 端（第 12 欄）',
      fix: '把 R2 改插 `a12` → `a16`，讓 b 端驅動閘極',
    },
    {
      symptom: 'LED 一直亮，開關完全沒有作用',
      cause: 'LED 陰極直接接到接地軌（例如導線接到 top− 而不是 `a17`），MOSFET 被旁路，不在電流路徑上',
      fix: 'LED 陰極要接到 Q1 的汲極（第 17 欄），電流必須經過 MOSFET 才能回到地',
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
    { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: DRAIN, label: 'LED1 陰極接到 Q1 汲極（低側開關）' },
    { kind: 'connected', a: SOURCE, b: GND, label: 'Q1 源極接地' },
    { kind: 'not-connected', a: DRAIN, b: SOURCE, label: 'Q1 汲極與源極沒有被導線短路（電流必須經過 MOSFET）' },
    { kind: 'connected', a: { component: 'SW1', pin: 'common' }, b: VCC, label: 'SW1 共同端接 +5 V' },
    {
      kind: 'connected',
      a: { component: 'SW1', pin: 'b' },
      b: GATE,
      via: { type: 'resistor', param: 'resistance', min: 22, max: 1000 },
      label: 'SW1 的 b 端經 22 Ω–1 kΩ 閘極電阻接到 Q1 閘極',
    },
    {
      kind: 'connected',
      a: GATE,
      b: GND,
      via: { type: 'resistor', param: 'resistance', min: 4700, max: 100000 },
      label: 'Q1 閘極經 4.7–100 kΩ 下拉電阻接地',
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
      at: DRAIN,
      quantity: 'voltage',
      min: 0,
      max: 0.05,
      seconds: 0.05,
      fresh: true,
      label: 'SW1 在 b 時 V_DS < 50 mV（Q1 完全導通）',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
  ],
  steps: [
    {
      id: 'b6-s1',
      title: '認識 IRLZ44N 與滑動開關',
      body: doc(
        '先認識兩個元件（電路板上已標示出來）：Q1 的三支腳由左至右是閘極（`c16`）、汲極（`c17`）、源極（`c18`）；SW1 的中間腳是共同端，滑桿在 b 時接到右腳（`c12`），在 a 時接到左腳（`c10`）。看完按「下一步」。',
        '閘極控制汲極與源極之間的通道：V_GS 高於約 1.5 V 開始導通，到 4–5 V 時完全導通（R_DS(on) ≈ 25 mΩ）。',
      ),
      highlight: { holes: ['c16', 'c17', 'c18', 'c10', 'c11', 'c12'], components: ['Q1', 'SW1'] },
    },
    {
      id: 'b6-s2',
      title: '接上 LED 負載（低側）',
      body: doc(
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `top+24` 與 `a22` 放上 R1 並設為 `330` Ω；再用「導線」工具接 `a20` → `a17`（LED1 陰極接汲極）與 `a18` → `top-19`（源極接地）。',
        '電流路徑：+5 V → R1 → LED1 → Q1（汲極 → 源極）→ 接地。MOSFET 在負載的「下方」，所以叫低側開關。',
      ),
      highlight: { holes: ['top+24', 'a22', 'a20', 'a17', 'a18', 'top-19'], components: ['LED1', 'Q1'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: VCC,
            b: { component: 'LED1', pin: 'anode' },
            via: { type: 'resistor', param: 'resistance', min: 220, max: 1000 },
          },
          { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: DRAIN },
          { kind: 'connected', a: SOURCE, b: GND },
        ],
        label: '+5 V → 電阻 → LED1 → Q1 汲極，源極接地',
      },
    },
    {
      id: 'b6-s3',
      title: '接上閘極驅動',
      body: doc(
        '用導線接 `a11` → `top+11`（SW1 共同端接 +5 V）；再拿兩顆電阻：R2 依序點 `a12` 與 `a16`（b 端到閘極，設為 `100` Ω），R3 依序點 `b16` 與 `top-15`（閘極下拉到地，設為 `10000` Ω）。',
        'R2 與 R3 構成分壓：開關在 b 時 V_G = 5 V × 10 kΩ ÷ 10.1 kΩ ≈ 4.95 V，足以讓 IRLZ44N 完全導通。',
      ),
      highlight: { holes: ['a11', 'top+11', 'a12', 'a16', 'b16', 'top-15'], components: ['SW1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { component: 'SW1', pin: 'common' }, b: VCC },
          {
            kind: 'connected',
            a: { component: 'SW1', pin: 'b' },
            b: GATE,
            via: { type: 'resistor', param: 'resistance', min: 22, max: 1000 },
          },
          { kind: 'connected', a: GATE, b: GND, via: { type: 'resistor', param: 'resistance', min: 4700, max: 100000 } },
        ],
        label: 'SW1 → 閘極電阻 → 閘極，閘極有下拉電阻',
      },
    },
    {
      id: 'b6-s4',
      title: '開關在 a：LED 不亮',
      body: doc(
        '滑桿留在 **a**，按上方的「▶ 執行模擬」（或空白鍵）：LED1 不亮。點一下 Q1 看屬性面板：閘極約 0 V，汲極約 3.7 V。',
        '閘極的驅動斷開了，R3 把閘極拉到 0 V，V_GS = 0 V 低於臨界電壓，MOSFET 截止。幾乎沒有電流，所以 LED 兩端只剩約 1.3 V。',
      ),
      highlight: { components: ['SW1', 'Q1', 'LED1'] },
      check: {
        kind: 'measure',
        at: { component: 'LED1', pin: 'anode' },
        quantity: 'current',
        component: 'LED1',
        min: 0,
        max: 0.0001,
        seconds: 0.05,
        label: 'SW1 在 a 時 LED1 電流小於 0.1 mA',
      },
    },
    {
      id: 'b6-s5',
      title: '切到 b：LED 亮起',
      body: doc(
        '在屬性面板把 SW1 的位置切到 **b**（或在麵包板上撥動滑桿）。閘極升到約 4.95 V，MOSFET 導通，LED1 亮起，電流約 **9.7 mA**。',
        '來回切換幾次：開關只負責 0.5 mA 的閘極下拉電流，真正的負載電流由 MOSFET 承擔——這就是用小訊號控制大電流的方法。',
      ),
      highlight: { components: ['SW1', 'LED1'] },
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
      id: 'b6-s6',
      title: '用電表量 V_DS(on)',
      body: doc(
        '用「導線」工具把 `DMM1:IN` 接 `e17`（汲極）、`DMM1:COM` 接 `e18`（源極）。SW1 在 b 時，DMM1 約 **0.25 mV**。保持 SW1 在 b，再到「驗收」按「檢查我的電路」。',
        '驗算：R_DS(on) = V_DS ÷ I_D ≈ 0.25 mV ÷ 9.7 mA ≈ 25 mΩ，與資料手冊在 V_GS = 5 V 的規格一致。',
      ),
      highlight: { holes: ['e17', 'e18'], components: ['DMM1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { terminal: 'DMM1:IN' }, b: DRAIN },
          { kind: 'connected', a: { terminal: 'DMM1:COM' }, b: SOURCE },
          { kind: 'measure', at: { terminal: 'DMM1:IN' }, quantity: 'voltage', min: 0, max: 0.05, seconds: 0.05 },
        ],
        label: 'DMM1 接在汲極–源極之間，讀數小於 50 mV',
      },
    },
  ],
  runnable: 'ready',
  requires: { parts: ['power_supply', 'multimeter', 'slide_switch', 'irlz44n', 'led', 'resistor'] },
  durationMin: 20,
}
