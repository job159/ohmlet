/**
 * b4 — 按鈕輸入（無 MCU）(push-button input without a microcontroller).
 *
 * Part 1: +5 V → SW1 → R1 330 Ω → red LED1 → GND (the LED lights while the
 * button is held). Part 2: the classic RC debounce — R2 10 kΩ pull-up on
 * node X (SW1-style button SW2 to GND), R3 10 kΩ from X to Y, C1 1 µF from
 * Y to GND; scope CH1 on Y (filtered), CH2 on X (raw). τ_press = R3·C1 =
 * 10 ms, τ_release = (R2 + R3)·C1 = 20 ms.
 *
 * Honesty: the pushbutton model has NO contact bounce (catalog support
 * text), so the scope shows the RC edges but never the bounce itself —
 * runnable 'partial'. The pressed-button checks press the button themselves
 * (final round: a runtime stimulus on 'pressed', the runtime-param path the
 * 3D press and the inspector's 按住 / 保持按下 use) — LED1 lights while SW1 is held, Y discharges through R3 while SW2 is.
 */
import type { Lesson } from '../types'
import { anchored, bench, bullets, doc, part, supply, supplyWires, wire } from './bench'

const SW1 = anchored('SW1', 'pushbutton', 'f10') // A side column 10, B side column 12
const LED1 = part('LED1', 'led', ['c16', 'c18'], { color: 'red' })
const SW2 = anchored('SW2', 'pushbutton', 'f30') // A side column 30 (node X), B side column 32
const C1 = part('C1', 'capacitor', ['c36', 'c38'], { capacitance: 1e-6 }) // p1 = node Y (column 36)
const PRB1 = part('PRB1', 'scope_probe', ['d36'], { channel: 1 }) // Y (filtered)
const PRB2 = part('PRB2', 'scope_probe', ['c30'], { channel: 2 }) // X (raw button node)

const START = bench('b4 按鈕輸入（起始）', [supply(5), SW1, LED1, SW2, C1, PRB1, PRB2], supplyWires())

const SOLUTION = bench(
  'b4 按鈕輸入（解答）',
  [
    supply(5),
    SW1,
    LED1,
    SW2,
    C1,
    PRB1,
    PRB2,
    part('R1', 'resistor', ['a12', 'a16'], { resistance: 330 }),
    part('R2', 'resistor', ['top+26', 'a30'], { resistance: 10000 }),
    part('R3', 'resistor', ['b30', 'b36'], { resistance: 10000 }),
  ],
  [
    ...supplyWires(),
    wire('W3', 'top+7', 'a10', 'red'), // +5 V → SW1 A side
    wire('W4', 'a18', 'top-15', 'black'), // LED1 cathode → GND
    wire('W5', 'a32', 'top-29', 'black'), // SW2 B side → GND
    wire('W6', 'a38', 'top-34', 'black'), // C1 → GND
  ],
)

const GND = { terminal: 'PS1:-' }
const VCC = { terminal: 'PS1:+' }

export const LESSON: Lesson = {
  id: 'b4-button-debounce',
  level: 'beginner',
  order: 4,
  title: '按鈕輸入（無 MCU）',
  summary:
    '先用按鈕直接控制 LED，認識四腳輕觸開關的內部接法；再接出經典的 RC 去彈跳電路（10 kΩ 上拉 + 10 kΩ + 1 µF），用示波器比較按鈕原始訊號與濾波後的訊號。',
  objectives: [
    '說明四腳輕觸按鈕的內部接法：A1–A2 相通、B1–B2 相通，按下時 A 側與 B 側導通',
    '接出「+5 V → 按鈕 → 330 Ω → LED → 接地」的按鈕控制迴路（按下時約 9.7 mA）',
    '說明機械接點彈跳會讓數位電路把一次按壓誤判成好幾次',
    '接出 RC 去彈跳電路，並算出按下時 τ = R3·C1 = 10 ms、放開時 τ = (R2 + R3)·C1 = 20 ms',
    '用示波器的兩個通道同時觀察按鈕原始訊號（X 點）與濾波後的訊號（Y 點）',
  ],
  wiring: doc(
    '上方電源軌 **top+** = +5 V、**top−** = 接地（PS1 已接好）。按鈕、LED、電容與兩支示波器探棒都已放好，你要加上電阻與導線。',
    '**第一部分：按鈕點亮 LED**',
    bullets(
      '按鈕 SW1（定位點 f10）跨在中央溝槽上：A 側在第 10 欄，B 側在第 12 欄。',
      '導線 `top+7`（上方 + 電源軌第 7 孔）→ `a10`（a 列第 10 欄）：A 側接 +5 V。',
      'R1（330 Ω）：`a12` → `a16`，從 B 側接到 LED1 陽極那一欄。',
      'LED1（紅）已插在 `c16`（陽極）與 `c18`（陰極）；導線 `a18` → `top-15` 把陰極接地。',
    ),
    '**第二部分：RC 去彈跳**',
    bullets(
      '按鈕 SW2（定位點 f30）：A 側第 30 欄（稱為 **X 點**），B 側第 32 欄。',
      'R2（10 kΩ 上拉）：`top+26` → `a30`；導線 `a32` → `top-29` 讓 B 側接地。',
      'R3（10 kΩ）：`b30` → `b36`，把 X 點接到第 36 欄（稱為 **Y 點**）。',
      'C1（1 µF）已插在 `c36`（Y 點）與 `c38`；導線 `a38` → `top-34` 把 C1 另一端接地。',
      '示波器探棒：PRB1（通道 1）在 `d36` 量 Y 點，PRB2（通道 2）在 `c30` 量 X 點。',
    ),
  ),
  theory: doc(
    '**四腳輕觸按鈕**：四支腳兩兩在內部相連（A1–A2、B1–B2），所以它其實只是一個開關。按鈕跨在麵包板中央溝槽上，A 側的兩支腳分別接到第 10 欄的上半部（e10）與下半部（f10），B 側同理在第 12 欄。按下時 A 側與 B 側導通（模擬器中接觸電阻 50 mΩ），放開時斷開。',
    '**第一部分的電流**：與第 b1 課相同，I = (5 V − 1.8 V) ÷ 330 Ω ≈ 9.7 mA，只是多了一個串聯的開關。',
    '**接點彈跳**：真實按鈕的金屬接點在按下與放開的瞬間會反覆彈開、碰上，持續約 0.1–10 ms。人眼看不出 LED 閃爍，但 MCU 或計數器會把一次按壓計成好幾次。',
    '**RC 去彈跳**：在按鈕節點 X 與輸入 Y 之間加上 R3 與 C1 組成的低通濾波器，電容電壓不能瞬間改變：',
    bullets(
      '按下：X 立刻變成 0 V，C1 經 R3 放電，τ_按 = R3 × C1 = 10 kΩ × 1 µF = **10 ms**。Y 從 5 V 降到 1.5 V（CMOS 輸入的低準位門檻 0.3 × 5 V）需要 τ × ln(5 ÷ 1.5) ≈ 12 ms。',
      '放開：C1 經 R2 + R3 充電，τ_放 = (R2 + R3) × C1 = **20 ms**。放開瞬間 X 只跳到約 2.5 V（R2 與 R3 對 0 V 的電容分壓），再和 Y 一起緩緩上升；Y 到達 3.5 V 約需 20 ms × ln(5 ÷ 1.5) ≈ 24 ms。',
      '一個 1 ms 的彈跳脈衝只能讓電容電壓改變約 1 − e^(−1 ms ÷ 10 ms) ≈ 10 %，離邏輯門檻還很遠，所以被濾掉了。',
    ),
    '**τ 怎麼選**：要比彈跳時間長（> 5 ms），又要比人的反應時間短（< 約 50 ms），10–20 ms 是常見的選擇。',
    '**Y 點要接施密特觸發輸入**：Y 的邊緣很慢，一般邏輯閘在門檻附近可能來回切換；實務上 Y 會接到 74HC14 這類施密特觸發反相器，或 MCU 的 GPIO（STM32 的輸入本身就有施密特觸發）。',
    '**模擬器的限制**：模擬器的按鈕是理想開關，**沒有接點彈跳**。示波器上看得到 RC 造成的緩降與緩升，但看不到真實的彈跳脈衝。',
  ),
  start: { layout: START },
  solution: { layout: SOLUTION },
  expected: [
    '按住 SW1：LED1 亮起，電流約 9.7 mA；放開：0 mA',
    'SW2 放開時：X 點與 Y 點都是 5.00 V（上拉電阻沒有電流流過，沒有壓降）',
    '按住 SW2：X 點立刻變成約 0 V；Y 點以 τ = 10 ms 指數下降，10 ms 後約 1.84 V（37 %）、約 12 ms 後低於 1.5 V',
    '放開 SW2：X 點先跳到約 2.5 V，再與 Y 點一起以 τ = 20 ms 上升；20 ms 後 Y 點約 3.16 V（63 %）',
    '電氣規則檢查（ERC）：0 個錯誤、0 個風險',
  ],
  mistakes: [
    {
      symptom: '不管按不按，LED 都一直亮著',
      cause: '+5 V 與 R1 接在按鈕的同一側（例如導線接到第 12 欄的 `b12`，而不是第 10 欄的 `a10`），按鈕被旁路，根本沒有串在迴路中',
      fix: '+5 V 接 A 側（第 10 欄）、R1 接 B 側（第 12 欄），讓電流必須經過按鈕',
    },
    {
      symptom: '按下時 LED 很暗（亮度約 1.7 %，電流約 0.34 mA）',
      cause: 'R1 用了 10 kΩ 而不是 330 Ω：(5 − 1.62) ÷ 10 kΩ ≈ 0.34 mA（電流這麼小時，LED 的順向電壓只有約 1.62 V）',
      fix: '把 R1 改成 330 Ω',
    },
    {
      symptom: '示波器上 X 點與 Y 點在按下時一起瞬間掉到 0 V，只有放開時是緩升',
      cause: '省略了 R3，C1 直接接在按鈕上：按下時電容經按鈕瞬間放電（真實電路中是數安培的突波，會損傷接點），按下的邊緣完全沒有濾波',
      fix: '在 X 點與 C1 之間串聯 R3（10 kΩ）',
    },
    {
      symptom: 'Y 點幾乎不動，按下後要好幾秒才降下來',
      cause: '電容值設錯，例如設成 1 mF（0.001 F）而不是 1 µF（0.000001 F）：τ 變成 10 s',
      fix: '在屬性面板把 C1 設為 1 µF（1e-6 F）',
    },
    {
      symptom: '示波器上看不到任何彈跳脈衝',
      cause: '模擬器的按鈕是理想開關，沒有接點彈跳模型——這是模擬器的限制，不是你的電路有問題',
      fix: '在真實麵包板上用示波器的單次觸發才看得到彈跳；本課在模擬器中只能觀察 RC 濾波的時間常數',
    },
  ],
  acceptance: [
    { kind: 'connected', a: VCC, b: { component: 'SW1', pin: 'A1' }, label: '按鈕 SW1 的 A 側接 +5 V' },
    {
      kind: 'connected',
      a: { component: 'SW1', pin: 'B1' },
      b: { component: 'LED1', pin: 'anode' },
      via: { type: 'resistor', param: 'resistance', min: 220, max: 1000 },
      label: 'SW1 的 B 側經 220 Ω–1 kΩ 電阻接到 LED1 陽極',
    },
    { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: GND, label: 'LED1 陰極接地' },
    {
      kind: 'measure',
      at: { component: 'LED1', pin: 'anode' },
      quantity: 'led-brightness',
      component: 'LED1',
      // brightness = I / rated 20 mA (F4: the app's one scale) — the same 0.1 mA as the old 1 % of 10 mA
      min: 0,
      max: 0.005,
      seconds: 0.05,
      fresh: true,
      label: 'SW1 放開時 LED1 不亮（按鈕確實串在迴路中）',
    },
    {
      kind: 'connected',
      a: VCC,
      b: { component: 'SW2', pin: 'A1' },
      via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
      label: 'X 點（SW2 的 A 側）經 4.7–47 kΩ 上拉電阻接 +5 V',
    },
    { kind: 'connected', a: { component: 'SW2', pin: 'B1' }, b: GND, label: 'SW2 的 B 側接地' },
    {
      kind: 'connected',
      a: { component: 'SW2', pin: 'A1' },
      b: { component: 'C1', pin: 'p1' },
      via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
      label: 'X 點經 4.7–47 kΩ 電阻接到 C1（Y 點）',
    },
    { kind: 'connected', a: { component: 'C1', pin: 'p2' }, b: GND, label: 'C1 另一端接地' },
    {
      kind: 'measure',
      at: { component: 'C1', pin: 'p1' },
      quantity: 'voltage',
      min: 4.5,
      max: 5.05,
      seconds: 0.3,
      fresh: true,
      label: 'SW2 放開時 Y 點充電到高準位（4.5 V 以上）',
    },
    {
      kind: 'connected',
      a: { component: 'PRB1', pin: 'tip' },
      b: { component: 'C1', pin: 'p1' },
      label: '示波器通道 1 量測 Y 點',
    },
    { kind: 'erc-clean', level: 'risk', label: '電氣規則檢查（ERC）沒有錯誤或風險' },
    {
      kind: 'measure',
      at: { component: 'LED1', pin: 'anode' },
      quantity: 'current',
      component: 'LED1',
      // 220 Ω – 1 kΩ (the series-resistor check's range) gives 14.5 mA – 3.3 mA
      min: 0.002,
      max: 0.015,
      seconds: 0.05,
      fresh: true,
      stimulus: [{ at: 0, component: 'SW1', param: 'pressed', value: true }],
      label: '按住 SW1 時 LED1 亮起（電流 2–15 mA）',
    },
    {
      kind: 'measure',
      at: { component: 'C1', pin: 'p1' },
      quantity: 'voltage',
      min: 0,
      max: 0.5,
      seconds: 0.3,
      fresh: true,
      stimulus: [{ at: 0.1, component: 'SW2', param: 'pressed', value: true }],
      label: '按住 SW2 時 Y 點經 R3 放電到 0.5 V 以下',
    },
  ],
  steps: [
    {
      id: 'b4-s1',
      title: '認識四腳按鈕',
      body: doc(
        '先認識四腳按鈕 SW1（電路板上已標示出來）：A1（`f10`）與 A2（`e10`）在內部相連，B1（`f12`）與 B2（`e12`）在內部相連，按下時 A 側與 B 側導通。看完按「下一步」。',
        '所以第 10 欄的上下兩半在按鈕內部已經接在一起，第 12 欄也是；中間的第 11 欄被按鈕本體蓋住，不要插東西。',
      ),
      highlight: { holes: ['e10', 'f10', 'e12', 'f12'], components: ['SW1'] },
    },
    {
      id: 'b4-s2',
      title: '接出按鈕 + LED 迴路',
      body: doc(
        '用「導線」工具接 `top+7` → `a10`；按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `a12` 與 `a16` 放上 R1 並設為 `330` Ω；再用導線接 `a18` → `top-15`。',
        '電流路徑：+5 V → SW1（A → B）→ R1 → LED1 → 接地。',
      ),
      highlight: { holes: ['top+7', 'a10', 'a12', 'a16', 'a18', 'top-15'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: VCC, b: { component: 'SW1', pin: 'A1' } },
          {
            kind: 'connected',
            a: { component: 'SW1', pin: 'B1' },
            b: { component: 'LED1', pin: 'anode' },
            // the step asks for 330 Ω: a new 1 kΩ resistor gets 「把 R1 設為 330 Ω」 here, so step 3 reads ≈ 9.7 mA
            via: { type: 'resistor', param: 'resistance', min: 220, max: 560 },
          },
          { kind: 'connected', a: { component: 'LED1', pin: 'cathode' }, b: GND },
        ],
        label: '按鈕、電阻與 LED 串成完整迴路',
      },
    },
    {
      id: 'b4-s3',
      title: '按下按鈕點亮 LED',
      body: doc(
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，然後在麵包板上按住 SW1（想讓它一直按著：{滑鼠：雙擊｜觸控：點兩下} SW1，或在屬性面板打開「保持按下」）：LED1 亮起，電流約 9.7 mA。',
        '放開後 LED 熄滅：按鈕斷開時迴路中沒有電流（保持按下的話，關掉「保持按下」或在麵包板上點一下 SW1 就會放開）。「檢查此步驟」會自己按住 SW1 再量 LED1 的電流。',
      ),
      highlight: { components: ['SW1', 'LED1'] },
      check: {
        kind: 'measure',
        at: { component: 'LED1', pin: 'anode' },
        quantity: 'current',
        component: 'LED1',
        min: 0.005,
        max: 0.015,
        seconds: 0.02,
        stimulus: [{ at: 0, component: 'SW1', param: 'pressed', value: true }],
        label: '按住 SW1 時 LED1 電流 5–15 mA',
      },
    },
    {
      id: 'b4-s4',
      title: '接出上拉 + 按鈕（X 點）',
      body: doc(
        '再拿一顆電阻，依序點 `top+26` 與 `a30` 放上 R2 並設為 `10000` Ω（10 kΩ）；再用導線接 `a32` → `top-29`。',
        '放開 SW2 時 X 點被 R2 拉到 5 V；按下時 X 點接地，R2 流過 5 V ÷ 10 kΩ = 0.5 mA。',
      ),
      highlight: { holes: ['top+26', 'a30', 'a32', 'top-29'], components: ['SW2'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: VCC,
            b: { component: 'SW2', pin: 'A1' },
            via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
          },
          { kind: 'connected', a: { component: 'SW2', pin: 'B1' }, b: GND },
        ],
        label: 'X 點有上拉電阻，SW2 的 B 側接地',
      },
    },
    {
      id: 'b4-s5',
      title: '加上 RC 濾波（Y 點）',
      body: doc(
        '再拿一顆電阻，依序點 `b30` 與 `b36` 放上 R3 並設為 `10000` Ω（10 kΩ）；再用導線接 `a38` → `top-34`，讓 C1 另一端接地。',
        '現在 Y 點（第 36 欄）就是 X 點經過 R3、C1 低通濾波後的訊號。',
      ),
      highlight: { holes: ['b30', 'b36', 'a38', 'top-34'], components: ['C1'] },
      check: {
        kind: 'all',
        checks: [
          {
            kind: 'connected',
            a: { component: 'SW2', pin: 'A1' },
            b: { component: 'C1', pin: 'p1' },
            via: { type: 'resistor', param: 'resistance', min: 4700, max: 47000 },
          },
          { kind: 'connected', a: { component: 'C1', pin: 'p2' }, b: GND },
        ],
        label: 'R3 與 C1 組成 RC 濾波器',
      },
    },
    {
      id: 'b4-s6',
      title: '用示波器比較 X 與 Y',
      body: doc(
        '按上方的「▶ 執行模擬」（或空白鍵），打開儀器的「示波器」（通道 1 = Y、通道 2 = X），時基設為每格 10 ms 左右、觸發來源選 CH2，然後按住 SW2 再放開，比較兩條波形；最後放開 SW2，讓 Y 點回到 5 V。',
        '按住 SW2：通道 2 瞬間掉到 0 V，通道 1 以 τ = 10 ms 緩慢下降。放開：通道 2 先跳到約 2.5 V，再與通道 1 一起以 τ = 20 ms 上升。用時間游標量量看，Y 點從 5 V 降到 1.84 V（37 %）大約要 10 ms。',
      ),
      highlight: { components: ['PRB1', 'PRB2', 'SW2'] },
      check: {
        kind: 'measure',
        at: { component: 'C1', pin: 'p1' },
        quantity: 'voltage',
        min: 4.5,
        max: 5.05,
        seconds: 0.2,
        label: 'SW2 放開後 Y 點回到 4.5 V 以上',
      },
    },
  ],
  runnable: 'partial',
  runnableNote:
    '模擬器的按鈕是理想開關，沒有接點彈跳模型：示波器上看得到 RC 濾波造成的緩降與緩升，以及 10 ms／20 ms 的時間常數，但看不到真實按鈕按下與放開瞬間數毫秒的彈跳脈衝。LED 迴路與 RC 濾波本身都是完整模擬。',
  requires: { parts: ['power_supply', 'pushbutton', 'led', 'resistor', 'capacitor', 'scope_probe'] },
  durationMin: 20,
}
