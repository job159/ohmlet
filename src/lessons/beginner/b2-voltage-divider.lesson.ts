/**
 * b2 — 電阻分壓 (resistive voltage divider).
 *
 * Two dividers from the 5 V rail: A = 10 kΩ / 10 kΩ (node: column 12) read
 * by DMM1, B = 10 kΩ / 4.7 kΩ (node: column 26) read by DMM2, both meters
 * in the V range (10 MΩ input). Simulated readings: 2.4988 V and 1.5981 V
 * (ideal 2.5000 V / 1.5986 V; the meters' 10 MΩ load is the difference).
 */
import type { Lesson } from '../types'
import { bench, bullets, doc, offboard, part, supply, supplyWires, wire } from './bench'

const DMM1 = offboard('DMM1', 'multimeter', { mode: 'V' })
const DMM2 = offboard('DMM2', 'multimeter', { mode: 'V' })

const START = bench('b2 電阻分壓（起始）', [supply(5), DMM1, DMM2], supplyWires())

const SOLUTION = bench(
  'b2 電阻分壓（解答）',
  [
    supply(5),
    DMM1,
    DMM2,
    part('R1', 'resistor', ['top+8', 'a12'], { resistance: 10000 }),
    part('R2', 'resistor', ['b12', 'top-10'], { resistance: 10000 }),
    part('R3', 'resistor', ['top+20', 'a26'], { resistance: 10000 }),
    part('R4', 'resistor', ['b26', 'top-22'], { resistance: 4700 }),
  ],
  [
    ...supplyWires(),
    wire('W3', 'DMM1:IN', 'e12', 'red'),
    wire('W4', 'DMM1:COM', 'top-12', 'black'),
    wire('W5', 'DMM2:IN', 'e26', 'red'),
    wire('W6', 'DMM2:COM', 'top-24', 'black'),
  ],
)

export const LESSON: Lesson = {
  id: 'b2-voltage-divider',
  level: 'beginner',
  order: 2,
  title: '電阻分壓',
  summary:
    '兩顆串聯電阻就能從 5 V 得到較低的電壓。組出 10 kΩ/10 kΩ 與 10 kΩ/4.7 kΩ 兩組分壓電路，用數位萬用電表量出 2.50 V 與 1.60 V，並認識電表輸入阻抗與負載效應。',
  objectives: [
    '由歐姆定律推導分壓公式 V_out = V_in × R2 ÷ (R1 + R2)',
    '組出 10 kΩ/10 kΩ（2.50 V）與 10 kΩ/4.7 kΩ（1.60 V）兩組分壓電路',
    '正確使用數位萬用電表的 V 檔：與被測元件「並聯」，IN 接被測點、COM 接地',
    '說明負載效應：分壓器的輸出阻抗 R1 ∥ R2，以及負載如何把輸出電壓拉低',
  ],
  wiring: doc(
    '兩組分壓器都從上方電源軌取電：**top+** = +5 V，**top−** = 接地。電源供應器 PS1 已接好，兩台數位萬用電表 DMM1、DMM2 已放在桌上（V 檔），尚未接線。',
    bullets(
      '分壓器 A：R1（10 kΩ，棕黑橙）從 `top+8`（上方 + 電源軌第 8 孔）插到 `a12`（a 列第 12 欄）；R2（10 kΩ）從 `b12` 插到 `top-10`。兩顆電阻在第 12 欄（a12–e12）相接，這一欄就是分壓點。',
      '分壓器 B：R3（10 kΩ）從 `top+20` 插到 `a26`；R4（4.7 kΩ，黃紫紅）從 `b26` 插到 `top-22`。分壓點是第 26 欄。',
      'DMM1：`DMM1:IN` 接 `e12`，`DMM1:COM` 接 `top-12`。',
      'DMM2：`DMM2:IN` 接 `e26`，`DMM2:COM` 接 `top-24`。',
    ),
    '電表量電壓時是**並聯**在被測兩點之間：紅色測試線（IN）接要量的點，黑色測試線（COM）接參考點（接地）。',
  ),
  theory: doc(
    '**分壓公式**：R1 與 R2 串聯，流過同一個電流 I = V_in ÷ (R1 + R2)。下半部 R2 兩端的電壓就是輸出：',
    'V_out = I × R2 = V_in × R2 ÷ (R1 + R2)',
    bullets(
      '分壓器 A：I = 5 V ÷ 20 kΩ = 0.25 mA，V_out = 0.25 mA × 10 kΩ = **2.50 V**',
      '分壓器 B：I = 5 V ÷ 14.7 kΩ ≈ 0.340 mA，V_out = 0.340 mA × 4.7 kΩ ≈ **1.599 V**',
    ),
    '**只跟比例有關**：兩顆都換成 1 kΩ，輸出仍是 2.50 V，但電流變成 2.5 mA、耗電是 10 倍；都換成 1 MΩ 幾乎不耗電，但輸出很容易被負載拉低。實務上常用 10 kΩ 等級。',
    '**輸出阻抗與負載效應**：從分壓點往回看，分壓器等效成一個電壓源 V_th（就是上面算出的 V_out）串聯一個電阻 R_th = R1 ∥ R2 = R1 × R2 ÷ (R1 + R2)。分壓器 A 的 R_th = 5 kΩ，B 的 R_th ≈ 3.2 kΩ。接上負載 R_L 後，輸出變成 V_th × R_L ÷ (R_th + R_L)：',
    bullets(
      '數位萬用電表 V 檔的輸入阻抗 R_L = 10 MΩ：分壓器 A 讀數 2.5 V × 10 MΩ ÷ 10.005 MΩ ≈ 2.4988 V，只少約 1.2 mV（−0.05 %），可以忽略。',
      '若在分壓器 A 的分壓點再接一顆 10 kΩ 到地：下半部變成 10 kΩ ∥ 10 kΩ = 5 kΩ，輸出掉到 5 V × 5 kΩ ÷ 15 kΩ ≈ 1.67 V（−33 %）。',
    ),
    '經驗法則：負載電阻至少要比 R_th 大 10 倍以上，誤差才會小於約 10 %；要驅動真正的負載時，應使用穩壓器或運算放大器緩衝，而不是分壓器。',
    '**實際應用**：分壓器常用來把較高的電壓縮小到 ADC 可量測的範圍（例如把 9 V 電池電壓縮到 3.3 V 以下），或產生比較器的參考電壓。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    'DMM1（分壓器 A）讀數約 2.499 V（理想值 2.500 V；電表 10 MΩ 輸入阻抗使讀數低約 1 mV）',
    'DMM2（分壓器 B）讀數約 1.598 V（理想值 1.599 V）',
    '分壓器 A 電流 0.25 mA、分壓器 B 電流約 0.34 mA；每顆電阻的功率都在 1 mW 以下',
    '驗收容許誤差 ±2 %：DMM1 需在 2.45–2.55 V，DMM2 需在 1.567–1.631 V',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  mistakes: [
    {
      symptom: '電表讀數一直是 0.000 V',
      cause: '電表的 COM 沒有接地：電表只量 IN 與 COM 之間的電壓差，COM 浮接時沒有參考點',
      fix: '把 `DMM1:COM` 接到 top− 電源軌',
    },
    {
      symptom: '讀數是負的，例如 −2.499 V',
      cause: 'IN 與 COM 接反了：電表顯示的是 V(IN) − V(COM)',
      fix: 'IN（紅）接分壓點，COM（黑）接地',
    },
    {
      symptom: '讀數變成 0 V，而且 R1 的電流變成 0.5 mA',
      cause: '電表被切到 A 檔：A 檔內部只有 0.1 Ω，並聯在 R2 上等於把 R2 短路，5 V 全落在 R1 上',
      fix: '量電壓一定要用 V 檔；A 檔只能串聯進迴路量電流',
    },
    {
      symptom: '分壓點讀到 5 V',
      cause: '下半部電阻沒有接到地，例如 R2 的下端插進了 top+ 而不是 top−，或插在沒有接線的孔位，迴路中沒有電流，所以 R1 上沒有壓降',
      fix: '確認 R2 一端在第 12 欄、另一端在 top− 電源軌',
    },
    {
      symptom: '在分壓點加接其他電路後，電壓大幅下降（例如從 2.50 V 掉到 1.67 V）',
      cause: '負載效應：分壓器的輸出阻抗是 R1 ∥ R2 = 5 kΩ，10 kΩ 的負載與 R2 並聯後下半部只剩 5 kΩ',
      fix: '負載電阻要比 R1 ∥ R2 大很多（10 倍以上），或改用穩壓器／運算放大器緩衝',
    },
  ],
  acceptance: [
    {
      kind: 'measure',
      at: { terminal: 'DMM1:IN' },
      quantity: 'voltage',
      min: 2.45,
      max: 2.55,
      seconds: 0.02,
      fresh: true,
      label: 'DMM1 量到 2.50 V ±2 %（2.45–2.55 V）',
    },
    {
      kind: 'measure',
      at: { terminal: 'DMM2:IN' },
      quantity: 'voltage',
      min: 1.567,
      max: 1.631,
      seconds: 0.02,
      fresh: true,
      label: 'DMM2 量到 1.60 V ±2 %（1.567–1.631 V）',
    },
    {
      kind: 'connected',
      a: { terminal: 'PS1:+' },
      b: { terminal: 'DMM1:IN' },
      via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
      label: '分壓器 A 上半部是 10 kΩ',
    },
    {
      kind: 'connected',
      a: { terminal: 'DMM1:IN' },
      b: { terminal: 'PS1:-' },
      via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
      label: '分壓器 A 下半部是 10 kΩ',
    },
    {
      kind: 'connected',
      a: { terminal: 'PS1:+' },
      b: { terminal: 'DMM2:IN' },
      via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
      label: '分壓器 B 上半部是 10 kΩ',
    },
    {
      kind: 'connected',
      a: { terminal: 'DMM2:IN' },
      b: { terminal: 'PS1:-' },
      via: { type: 'resistor', param: 'resistance', min: 4400, max: 5000 },
      label: '分壓器 B 下半部是 4.7 kΩ',
    },
    {
      kind: 'all',
      checks: [
        { kind: 'connected', a: { terminal: 'DMM1:COM' }, b: { terminal: 'PS1:-' } },
        { kind: 'connected', a: { terminal: 'DMM2:COM' }, b: { terminal: 'PS1:-' } },
      ],
      label: '兩台電表的 COM 都接地',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
  ],
  steps: [
    {
      id: 'b2-s1',
      title: '分壓器 A：兩顆 10 kΩ',
      body: doc(
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `top+8` 與 `a12` 放上 R1；再拿一顆，依序點 `b12` 與 `top-10` 放上 R2。兩顆都在「屬性」面板設為 `10000` Ω（10 kΩ）。',
        '兩顆電阻串聯在 +5 V 與接地之間，第 12 欄是它們的接點（分壓點）。預估：V = 5 V × 10 kΩ ÷ 20 kΩ = 2.50 V。',
      ),
      highlight: { holes: ['top+8', 'a12', 'b12', 'top-10'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: { terminal: 'PS1:+' },
            b: { hole: 'a12' },
            via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
          },
          {
            kind: 'connected',
            a: { hole: 'a12' },
            b: { terminal: 'PS1:-' },
            via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
          },
        ],
        label: '第 12 欄經 10 kΩ 接 +5 V、經 10 kΩ 接地',
      },
    },
    {
      id: 'b2-s2',
      title: '用 DMM1 量分壓點',
      body: doc(
        '按下方的「開始接線」（或用「導線」工具）把 DMM1 IN 端接到 `e12`、DMM1 COM 端接到 `top-12`，再按「▶ 執行模擬」（或空白鍵）。',
        'DMM1 應顯示約 **2.499 V**。比 2.500 V 少的那 1 mV，是電表 10 MΩ 輸入阻抗與 R2 並聯造成的。',
      ),
      highlight: { holes: ['e12', 'top-12'], components: ['DMM1'] },
      action: [
        {
          kind: 'wire',
          wires: [
            ['DMM1:IN', 'e12'],
            ['DMM1:COM', 'top-12'],
          ],
        },
        { kind: 'run' },
      ],
      check: {
        kind: 'measure',
        at: { terminal: 'DMM1:IN' },
        quantity: 'voltage',
        min: 2.45,
        max: 2.55,
        seconds: 0.02,
        label: 'DMM1 量到 2.45–2.55 V',
      },
    },
    {
      id: 'b2-s3',
      title: '分壓器 B：10 kΩ 與 4.7 kΩ',
      body: doc(
        '再拿兩顆電阻：R3 依序點 `top+20` 與 `a26`，R4 依序點 `b26` 與 `top-22`；在「屬性」面板把 R3 設為 `10000` Ω、R4 設為 `4700` Ω。',
        '預估：V = 5 V × 4.7 kΩ ÷ 14.7 kΩ ≈ 1.599 V。',
      ),
      highlight: { holes: ['top+20', 'a26', 'b26', 'top-22'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: { terminal: 'PS1:+' },
            b: { hole: 'a26' },
            via: { type: 'resistor', param: 'resistance', min: 9500, max: 10500 },
          },
          {
            kind: 'connected',
            a: { hole: 'a26' },
            b: { terminal: 'PS1:-' },
            via: { type: 'resistor', param: 'resistance', min: 4400, max: 5000 },
          },
        ],
        label: '第 26 欄經 10 kΩ 接 +5 V、經 4.7 kΩ 接地',
      },
    },
    {
      id: 'b2-s4',
      title: '用 DMM2 量分壓點 B',
      body: doc(
        '按下方的「開始接線」（或用「導線」工具）把 DMM2 IN 端接到 `e26`、DMM2 COM 端接到 `top-24`，DMM2 應顯示約 **1.598 V**。',
        '比較兩組：電阻比 1:1 得到一半的電壓；4.7 kΩ ÷ 14.7 kΩ ≈ 0.32，得到約三分之一的電壓。',
      ),
      highlight: { holes: ['e26', 'top-24'], components: ['DMM2'] },
      action: [
        {
          kind: 'wire',
          wires: [
            ['DMM2:IN', 'e26'],
            ['DMM2:COM', 'top-24'],
          ],
        },
        { kind: 'run' },
      ],
      check: {
        kind: 'measure',
        at: { terminal: 'DMM2:IN' },
        quantity: 'voltage',
        min: 1.567,
        max: 1.631,
        seconds: 0.02,
        label: 'DMM2 量到 1.567–1.631 V',
      },
    },
    {
      id: 'b2-s5',
      title: '選做：觀察負載效應',
      body: doc(
        '暫時再拿一顆 10 kΩ 電阻當負載，依序點 `d12` 與 `top-11`，看 DMM1 從 2.50 V 掉到約 **1.67 V**。',
        '分壓器的輸出阻抗 5 kΩ 與負載分壓了。觀察完請把這顆負載電阻刪除（選取後按刪除鍵），DMM1 回到 2.499 V 後，再到「驗收」按「檢查我的電路」。',
      ),
      highlight: { holes: ['d12', 'top-11'] },
    },
  ],
  runnable: 'ready',
  requires: { parts: ['power_supply', 'multimeter', 'resistor'] },
  durationMin: 15,
}
