/**
 * b1 — LED 與限流電阻 (LED + current-limiting resistor).
 *
 * 5 V bench supply → R1 330 Ω → red LED1 → GND, the multimeter DMM1 (V)
 * across the LED. Numbers below are what the simulator computes for this
 * circuit (tests/lessons/beginner.test.ts asserts them): LED model Vf(10 mA)
 * = 1.8 V (n = 2), supply 10 mΩ, meter 10 MΩ.
 */
import type { Lesson } from '../types'
import { bench, bullets, doc, offboard, part, supply, supplyWires, wire } from './bench'

const LED = part('LED1', 'led', ['c14', 'c16'], { color: 'red' })
const DMM = offboard('DMM1', 'multimeter', { mode: 'V' })

const START = bench('b1 LED 與限流電阻（起始）', [supply(5), DMM, LED], supplyWires())

const SOLUTION = bench(
  'b1 LED 與限流電阻（解答）',
  [supply(5), DMM, LED, part('R1', 'resistor', ['top+10', 'a14'], { resistance: 330 })],
  [
    ...supplyWires(),
    wire('W3', 'a16', 'top-13', 'black'),
    wire('W4', 'DMM1:IN', 'e14', 'red'),
    wire('W5', 'DMM1:COM', 'top-15', 'black'),
  ],
)

export const LESSON: Lesson = {
  id: 'b1-led-resistor',
  level: 'beginner',
  order: 1,
  title: 'LED 與限流電阻',
  summary:
    '用歐姆定律算出 LED 的限流電阻：5 V 電源、紅色 LED、目標電流 10 mA。實際接好線、開始模擬，再用數位萬用電表量出 LED 的順向電壓並推算電流。',
  objectives: [
    '說明 LED 的順向電壓 V_F（紅色約 1.8 V）是什麼，以及為什麼 LED 一定要串聯限流電阻',
    '用歐姆定律 R = (V電源 − V_F) ÷ I 算出 10 mA 所需的電阻 320 Ω，並選用最接近的標準值 330 Ω',
    '在麵包板上接出「+5 V → 電阻 → LED 陽極 → LED 陰極 → 接地」的串聯迴路',
    '用數位萬用電表的 V 檔量測 LED 兩端電壓，並由 (5 V − V_F) ÷ R 推算迴路電流',
  ],
  wiring: doc(
    '本課只用麵包板上方的兩條電源軌：**top+** 是 +5 V，**top−** 是接地（GND）。電源軌整條相連，同一條軌上任何一個孔位都是同一個網路。孔位代號 `top+10` 指「上方 + 電源軌第 10 孔」，`a14` 指「a 列第 14 欄」。',
    bullets(
      '直流電源供應器 PS1 設為 5 V：PS1 正端接 `top+0`（上方 + 電源軌第 0 孔），PS1 負端接 `top-0`（上方 − 電源軌第 0 孔），起始電路已接好。',
      '紅色 LED（LED1）已插好：陽極（長腳，+）在 `c14`，陰極（短腳、外殼平邊那側，−）在 `c16`。',
      '電阻 R1（330 Ω，色碼橙橙棕金）：一腳插 `top+10`（+5 V），另一腳插 `a14`。第 14 欄的 a–e 五個孔位在麵包板內部相連，所以 R1 與 LED 陽極接在一起。',
      '導線：`a16` → `top-13`，把 LED 陰極接到接地軌。',
      '數位萬用電表 DMM1（V 檔）：`DMM1:IN` 接 `e14`（LED 陽極），`DMM1:COM` 接 `top-15`（接地），讀數就是 LED 兩端的電壓。',
    ),
  ),
  theory: doc(
    '**LED 是一種二極體**：電流只能從陽極（A）流向陰極（K），而且兩端電壓要達到**順向電壓 V_F** 才會明顯導通。模擬器中的 LED 在 10 mA 時 V_F 為：紅 1.8 V、黃 2.0 V、綠 2.2 V、藍 3.0 V、白 3.2 V。',
    '**為什麼一定要限流電阻**：二極體的電流隨電壓呈指數變化——模擬器的 LED 模型中，電壓每多約 0.06 V，電流就變成約 3 倍。若把 LED 直接接在 5 V 與接地之間，沒有任何元件限制電流，電流會衝到數百 mA 以上；模擬器的 LED 在電流超過 30 mA 持續 1 ms 就會燒毀（仍會導通，但不再發光），真實的 5 mm LED 連續額定電流通常只有 20 mA。',
    '**計算限流電阻**（串聯迴路中電流處處相同）：',
    bullets(
      '電阻兩端電壓：V_R = V電源 − V_F = 5 V − 1.8 V = 3.2 V',
      '目標電流 10 mA：R = V_R ÷ I = 3.2 V ÷ 0.010 A = 320 Ω',
      '取最接近的 E12 標準值 **330 Ω**：I = 3.2 V ÷ 330 Ω ≈ 9.7 mA',
    ),
    '**功率**：電阻消耗 P = V_R × I = 3.2 V × 9.7 mA ≈ 31 mW，遠低於常見 1/4 W（250 mW）電阻的額定值；LED 消耗約 1.8 V × 9.7 mA ≈ 17 mW。',
    '**電阻放在哪一側都可以**：放在陽極側或陰極側，串聯電流完全相同。本課的自動驗收檢查「LED 陽極經電阻接到 +5 V」，所以請把電阻放在陽極側。',
    '**量電流的兩種方法**：',
    bullets(
      '方法一（本課）：用電表 V 檔量出 V_F，再算 I = (5 V − V_F) ÷ R。V 檔的輸入阻抗是 10 MΩ，幾乎不影響電路。',
      '方法二：把電表切到 A 檔並**串聯**接進迴路（電表內部只有 0.1 Ω 的分流電阻），直接讀出電流。千萬不要把 A 檔電表並聯在電源兩端——那等於把電源短路。',
    ),
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    'LED1 電流約 9.7 mA（驗收範圍 5–15 mA），亮度約 97 %',
    'DMM1 讀數（LED1 兩端電壓）約 1.80 V',
    'R1 兩端電壓約 3.20 V，消耗功率約 31 mW',
    '換成 220 Ω：約 14.5 mA；換成 560 Ω：約 5.8 mA——兩者都還在 5–15 mA 的驗收範圍內',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  // `match` ties a mistake to the pass / fail pattern of the acceptance checks
  // below (0 resistor · 1 anode via 220–560 Ω · 2 cathode grounded · 3 current
  // · 4 brightness · 5 ERC) — the check results show it as 「最可能的原因」.
  mistakes: [
    {
      symptom: 'LED 完全不亮，DMM1 讀數接近 5 V',
      cause: 'LED 插反了：陰極接在高電位那側，二極體被逆向偏壓，迴路中沒有電流，所以電阻上沒有壓降，陽極那一欄停在 5 V',
      fix: '把 LED 的兩支接腳對調：長腳（陽極）接電阻那一欄，短腳（陰極）接往接地',
      match: { ercRules: ['led-current:reversed'] },
    },
    {
      symptom: 'LED 不亮，ERC 報告 LED 的兩支接腳在同一個網路',
      cause: 'LED 的兩支接腳插在同一欄（例如 c14 與 d14）。同一欄 a–e 的 5 個孔位在麵包板內部相連，LED 被短路',
      fix: '讓兩支接腳分別插在不同欄，例如 c14 與 c16',
      match: { ercRules: ['led-current:shorted'] },
    },
    {
      symptom: 'LED 亮一下就熄滅，屬性面板顯示已燒毀，ERC 出現錯誤',
      cause: '沒有串聯電阻，或用了太小的電阻（例如 100 Ω：(5 − 1.8) ÷ 100 ≈ 32 mA，超過 30 mA）',
      fix: '串聯 330 Ω。修改電路後模擬器會重建，LED 恢復正常；真實的 LED 燒毀後無法復原，只能更換',
      match: { checks: [1, 4], ercRules: ['led-current'] },
    },
    {
      symptom: 'ERC 顯示 LED 電流超過 20 mA 額定值的風險（建議至少串聯 180 Ω），LED 電流約 21 mA',
      cause: '用了 150 Ω：(5 − 1.84) ÷ 150 ≈ 21 mA，超過 LED 20 mA 的連續額定電流（還沒燒毀，但長時間使用會縮短壽命）',
      fix: '改用 220 Ω 以上的電阻',
      match: { checks: [1], passes: [4], ercRules: ['led-current'] },
    },
    {
      symptom: 'LED 幾乎不亮（亮度約 3 %），電流只有約 0.3 mA',
      cause: '電阻值選錯，例如把 10 kΩ（棕黑橙）當成 330 Ω（橙橙棕）：(5 − 1.8) ÷ 10 kΩ ≈ 0.32 mA',
      fix: '在屬性面板把 R1 的電阻值改成 330 Ω',
      match: { checks: [1, 3], passes: [0] },
    },
    {
      symptom: 'LED 不亮，電流 0 mA，DMM1 讀數約 5 V',
      cause: 'LED 陰極那一欄沒有接到接地軌：迴路沒有閉合，電流無處可流，電阻上也就沒有壓降',
      fix: '用一條導線把 `a16`（LED 陰極那一欄）接到上方 − 電源軌，例如 `top-13`',
      match: { checks: [2], passes: [0, 1] },
    },
  ],
  acceptance: [
    { kind: 'has-part', type: 'resistor', label: '電路中有限流電阻' },
    {
      kind: 'connected',
      a: { terminal: 'PS1:+' },
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 220, max: 560 },
      label: 'LED1 陽極經一顆 220–560 Ω 的電阻接到 +5 V',
    },
    {
      kind: 'connected',
      a: { component: 'LED1', pin: 'cathode' },
      b: { terminal: 'PS1:-' },
      label: 'LED1 陰極接地',
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
      label: 'LED1 電流在 5–15 mA 之間',
    },
    {
      kind: 'measure',
      at: { component: 'LED1', pin: 'anode' },
      quantity: 'led-brightness',
      component: 'LED1',
      min: 0.5,
      max: 1,
      seconds: 0.05,
      fresh: true,
      label: 'LED1 正常發光（沒有燒毀）',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
  ],
  steps: [
    {
      id: 'b1-s1',
      title: '認識電源與電源軌',
      body: [
        '先看看起始電路（電路板上已標示出來）：直流電源供應器 **PS1** 設為 5 V，PS1 正端接 `top+0`（上方 + 電源軌第 0 孔），PS1 負端接 `top-0`（上方 − 電源軌第 0 孔）；紅色 **LED1** 插在 `c14`（陽極，長腳）與 `c16`（陰極，短腳）。看完按「下一步」。',
        '麵包板上方的 **top+** 與 **top−** 兩條電源軌各自整條相連：之後只要把元件插進 top+ 的任一孔位就接到 +5 V，插進 top− 就接地。',
      ].join('\n\n'),
      highlight: { holes: ['top+0', 'top-0', 'c14', 'c16'], components: ['PS1', 'LED1'] },
    },
    {
      id: 'b1-s2',
      title: '算出限流電阻',
      body: [
        '算一算：要讓 LED 電流約 10 mA，電阻 R = (5 V − 1.8 V) ÷ 0.010 A = **320 Ω**，取最接近的標準值 **330 Ω**（色碼：橙、橙、棕）。',
        '紅色 LED 的順向電壓 V_F ≈ 1.8 V，所以電阻要承受 5 V − 1.8 V = 3.2 V。換成 330 Ω 後，預估電流 3.2 V ÷ 330 Ω ≈ 9.7 mA。',
      ].join('\n\n'),
      highlight: { components: ['LED1'] },
    },
    {
      id: 'b1-s3',
      title: '插上 330 Ω 電阻',
      body: [
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），再依序點 `top+10` 與 `a14` 兩個孔位；放好後 R1 會被選取，在「屬性」面板把電阻值設為 `330` Ω（也可以按「把 R1 設為 330 Ω」）。',
        '`a14` 和 LED 陽極在同一欄：第 14 欄的 a–e 五個孔位在麵包板內部相連，所以電阻的這一腳就接到了 LED 陽極。新放的電阻預設是 1 kΩ，電流只有約 3 mA，所以要改成 330 Ω。',
      ].join('\n\n'),
      highlight: { holes: ['top+10', 'a14'] },
      check: {
        kind: 'connected',
        a: { terminal: 'PS1:+' },
        b: { component: 'LED1', pin: 'anode' },
        via: { type: 'resistor', param: 'resistance', min: 220, max: 560 },
        label: 'LED1 陽極經 220–560 Ω 電阻接到 +5 V',
      },
    },
    {
      id: 'b1-s4',
      title: '把 LED 陰極接地',
      body: [
        '按下方的「開始接線」（或點「導線」工具），再依序點 `a16` 與 `top-13`（上方 − 電源軌第 13 孔），用一條導線把 LED 陰極接地。',
        '這樣電流就能從 +5 V 經過 R1、LED1 流回接地，形成完整的迴路。',
      ].join('\n\n'),
      highlight: { holes: ['a16', 'top-13'] },
      check: {
        kind: 'connected',
        a: { component: 'LED1', pin: 'cathode' },
        b: { terminal: 'PS1:-' },
        label: 'LED1 陰極接地',
      },
    },
    {
      id: 'b1-s5',
      title: '開始模擬，確認電流',
      body: [
        '按上方的「▶ 執行模擬」（或空白鍵），LED1 應該亮起；再點一下 LED1，屬性面板會顯示流過它的電流，約 **9.7 mA**。',
        '試試看：把 R1 改成 220 Ω 與 560 Ω，電流分別約 14.5 mA 與 5.8 mA，亮度跟著改變。最後請改回 330 Ω。',
      ].join('\n\n'),
      highlight: { components: ['LED1', 'R1'] },
      check: {
        kind: 'measure',
        at: { component: 'LED1', pin: 'anode' },
        quantity: 'current',
        component: 'LED1',
        min: 0.005,
        max: 0.015,
        seconds: 0.05,
        label: 'LED1 電流在 5–15 mA 之間',
      },
    },
    {
      id: 'b1-s6',
      title: '用電表量 LED 電壓',
      body: [
        '按下方的「開始接線」，用兩條導線接上數位萬用電表 DMM1（V 檔）：`DMM1:IN` 接 `e14`，`DMM1:COM` 接 `top-15`。',
        '讀數約 **1.80 V**，就是 LED 的順向電壓 V_F。用歐姆定律驗算：I = (5 V − 1.80 V) ÷ 330 Ω ≈ 9.7 mA，與屬性面板顯示的電流一致。',
      ].join('\n\n'),
      highlight: { holes: ['e14', 'top-15'], components: ['DMM1'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { terminal: 'DMM1:IN' }, b: { component: 'LED1', pin: 'anode' } },
          { kind: 'connected', a: { terminal: 'DMM1:COM' }, b: { terminal: 'PS1:-' } },
          // the reading itself: an open cathode reads 5 V here, not the LED's 1.8 V (UX LS-15)
          { kind: 'measure', at: { terminal: 'DMM1:IN' }, quantity: 'voltage', min: 1.7, max: 1.9, label: 'DMM1 讀數約 1.8 V' },
        ],
        label: 'DMM1 的 IN 接 LED1 陽極、COM 接地，讀數約 1.8 V',
      },
    },
  ],
  runnable: 'ready',
  requires: { parts: ['power_supply', 'multimeter', 'led', 'resistor'] },
  durationMin: 15,
}
