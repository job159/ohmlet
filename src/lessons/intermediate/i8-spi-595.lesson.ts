/**
 * 中級 i8 — SPI：模式 0、MSB 先送、74HC595 移位暫存器與 8 顆 LED 跑馬燈。
 * Firmware: hal-spi-595 (SPI1 PA5 SCK / PA7 MOSI 4.5 MHz mode 0, PA4 RCLK;
 * 1 << step every 100 ms: QA → QH); lesson-i8-lsb reproduces
 * SPI_FIRSTBIT_LSB — the chaser runs backwards (firmware/projects/lesson-i8-lsb).
 */
import type { ComponentInstance } from '../../model/types'
import type { Lesson } from '../types'
import { anchored, benchLayout, leads, tap, type WireSpec } from './bench'

const PA4 = tap('PA4') // a21 — RCLK (GPIO)
const PA5 = tap('PA5') // a20 — SPI1_SCK  → SRCLK
const PA7 = tap('PA7') // a18 — SPI1_MOSI → SER

// 74HC595 DIP-16 at f34: pins 1–8 (QB QC QD QE QF QG QH GND) on row f, cols 34–41;
// pins 9–16 (QH' SRCLR SRCLK RCLK OE SER QA VCC) on row e, cols 41–34.
const sr = anchored('U2', '74hc595', 'f34')

/** QA (e35) on the upper half; QB–QH (f34–f40) on the lower half, each LED + 220 Ω to GND */
function ledBank(): ComponentInstance[] {
  const out: ComponentInstance[] = [
    leads('R1', 'resistor', ['b35', 'b42'], { resistance: 220 }),
    leads('LED1', 'led', ['c42', 'top-33'], { color: 'red' }),
  ]
  for (let k = 0; k < 7; k++) {
    out.push(leads(`R${k + 2}`, 'resistor', [`j${34 + k}`, `j${42 + k}`], { resistance: 220 }))
    out.push(leads(`LED${k + 2}`, 'led', [`i${42 + k}`, `bot-${33 + k}`], { color: 'red' }))
  }
  return out
}

const powerWires: WireSpec[] = [
  ['a34', 'top+26', 'red'], // VCC (16) → 3.3 V
  ['j41', 'bot-32', 'black'], // GND (8)
  ['a40', 'top+31', 'red'], // SRCLR (10) → 3.3 V: never cleared
  ['a37', 'top-29', 'black'], // OE (13) → GND: outputs enabled
]
const solutionWires: WireSpec[] = [
  ...powerWires,
  ['a39', PA5, 'yellow'], // SRCLK (11) ← SPI1_SCK
  ['a36', PA7, 'blue'], // SER (14) ← SPI1_MOSI
  ['a38', PA4, 'green'], // RCLK (12) ← PA4
]

const qa = { component: 'U2', pin: 'QA' } as const

export const LESSON: Lesson = {
  id: 'i8-spi-595',
  level: 'intermediate',
  order: 8,
  title: 'SPI 與 74HC595：8 顆 LED 跑馬燈',
  summary:
    '用 SPI1 以 4.5 MHz、模式 0 把一個位元組送進 74HC595 移位暫存器，再以 PA4 的上升緣鎖存到輸出，只用 3 支腳就控制 8 顆 LED，做出 10 Hz 的跑馬燈。',
  objectives: [
    '說明 SPI 的四條線（SCK、MOSI、MISO、NSS）與時脈極性／相位：模式 0 = CPOL 0、CPHA 0，在 SCK 上升緣取樣。',
    '算出 SPI1 的時脈：APB2 72 MHz ÷ 16 = 4.5 MHz，一個位元組 8 × 222 ns ≈ 1.78 µs。',
    '理解 74HC595 的兩級暫存器：SRCLK 上升緣把 SER 移入、RCLK 上升緣一次把 8 個位元鎖存到 QA～QH。',
    '推導 MSB 先送時位元組的第 0 位元最後落在 QA，因此 `1 << step` 讓 QA → QH 依序點亮。',
    '親手重現 LSB 先送的錯誤：跑馬燈變成 QH → QA 反向。',
  ],
  wiring:
    '電源已經接好（上方 + 電源軌 = 3.3 V，兩條 − 電源軌 = GND）。**74HC595（U2）** 跨在中央溝槽上，第 1 腳在 f34：\n' +
    '- 下排（f 列，第 34～41 欄）：QB、QC、QD、QE、QF、QG、QH、GND；\n' +
    '- 上排（e 列，第 41～34 欄）：QH′、SRCLR、SRCLK、RCLK、OE、SER、QA、VCC。\n\n' +
    '已經接好的部分：VCC（a34）→ 3.3 V、GND（j41）→ GND、**SRCLR**（a40）→ 3.3 V（不清除）、**OE**（a37）→ GND（輸出致能）；QA～QH 各經 220 Ω 電阻接一顆紅色 LED 到 GND（QA 的 LED1 在上半部，QB～QH 的 LED2～LED8 在下半部）。\n\n' +
    '你要接三條 SPI 線（Blue Pill 這三支腳都在 c 列，空孔在 a 列）：\n' +
    '- **SCK → SRCLK**：`a39`（a 列第 39 欄）→ `a20`（PA5 = SPI1_SCK）；\n' +
    '- **MOSI → SER**：`a36` → `a18`（PA7 = SPI1_MOSI）；\n' +
    '- **鎖存 RCLK**：`a38` → `a21`（PA4，一般 GPIO 輸出）。',
  theory:
    '**1. SPI 是同步序列介面。** 主控端提供時脈 **SCK**，每個時脈送出一個位元到 **MOSI**（主出從入）、同時從 **MISO**（主入從出）收回一個位元；**NSS**／CS 選擇要對話的裝置。因為有時脈，接收端不需要事先知道速度，SPI 可以輕鬆跑到數 MHz 以上。本課只需要送資料，MISO 不接；NSS 由軟體管理，PA4 當作 74HC595 的鎖存訊號。\n\n' +
    '**2. 時脈極性與相位。** CPOL 決定 SCK 閒置時的準位，CPHA 決定在第一個還是第二個邊緣取樣。**模式 0**（CPOL = 0、CPHA = 0）：SCK 閒置為低，資料在上升緣被取樣、在下降緣改變——正好符合 74HC595「SRCLK 上升緣移位」的時序。`hal-spi-595` 的設定：主控、8 位元、**MSB 先送**、預除頻 16 → SPI1 在 APB2（72 MHz）上，SCK = 72 MHz ÷ 16 = **4.5 MHz**（每個位元 222 ns），送出一個位元組只要約 **1.78 µs**。\n\n' +
    '**3. 74HC595 的兩級暫存器。** 每個 **SRCLK** 上升緣，移位暫存器整體往後移一格，SER 的位元進入第一格（QA 的位置），最舊的位元從 QH′ 移出（可以串接下一顆 595）。移位期間輸出不會變；**RCLK** 上升緣才把 8 個位元一次複製到儲存暫存器，出現在 QA～QH——所以 LED 不會在移位過程中閃爍。**SRCLR** 為低時清除移位暫存器，**OE** 為高時輸出變成高阻抗，所以要分別接 3.3 V 與 GND。\n\n' +
    '**4. 哪一個位元落在哪一支腳？** 送 8 個位元後，**第一個送出的位元被推到最遠的 QH**，最後一個位元留在 QA。MSB 先送時，位元 7 → QH、位元 0 → QA。韌體每 100 ms 送出 `1 << step`（`step` = 0～7）：0x01 點亮 QA、0x02 點亮 QB … 0x80 點亮 QH，跑完一輪 800 ms。所以 QA 每 800 ms 亮一次、每次 100 ms：**1.25 Hz、工作週期 12.5 %**。\n\n' +
    '**5. 一次更新的時序。** PA4（RCLK）先拉低 → `HAL_SPI_Transmit()` 送出 8 個 SCK 脈波 → PA4 拉高（上升緣鎖存）。整個過程約 5 µs，每 100 ms 一次（以期限計時，不漂移）。\n\n' +
    '**6. 電流。** 74HC595 在 3.3 V 供電時，每支輸出可以穩定提供數 mA；LED 經 220 Ω 約 4～6 mA，跑馬燈同時只亮一顆，遠低於晶片 VCC／GND 腳合計 70 mA 的絕對最大額定。',
  start: {
    layout: benchLayout(
      'i8 SPI 74HC595（起始）',
      'Blue Pill 已接電源；74HC595（U2）在 f34，電源、SRCLR、OE 與 8 組 LED 都已接好，但 SER、SRCLK、RCLK 還沒接到 Blue Pill，也還沒載入韌體。',
      [sr, ...ledBank()],
      powerWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i8 SPI 74HC595（解答）',
      'PA5（SCK）→ SRCLK、PA7（MOSI）→ SER、PA4 → RCLK；韌體 hal-spi-595：每 100 ms 送出一個只有 1 個位元為 1 的位元組，QA → QH 依序點亮。',
      [sr, ...ledBank()],
      solutionWires,
    ),
    firmware: { U1: 'hal-spi-595' },
  },
  expected: [
    'LED1（QA）→ LED2（QB）→ … → LED8（QH）每 100 ms 前進一顆，一輪 800 ms；任一時刻只有一顆亮。',
    'QA 的波形：每 800 ms 高 100 ms，頻率 1.25 Hz、工作週期 12.5 %。',
    'SCK（PA5）每次 8 個脈波、4.5 MHz（週期 222 ns），一個位元組約 1.78 µs；PA4 平時為高，每次更新有約 5 µs 的低脈波，上升緣鎖存。',
    'UART 終端機（U1 的 USART1，115200 8N1）開機時出現一次 `74HC595 chaser 10 Hz`。',
    '載入 `lesson-i8-lsb`（LSB 先送）時，跑馬燈改成 QH → QG → … → QA 反向，時間完全相同。',
  ],
  mistakes: [
    {
      symptom: '跑馬燈的方向反了：從 QH（LED8）往 QA（LED1）跑。',
      cause:
        'SPI 設成 `SPI_FIRSTBIT_LSB`：位元 0 最先送出，被推到最遠的 QH。按下方的「重現這個錯誤：載入 `lesson-i8-lsb`」即可重現。',
      fix: '用 `SPI_FIRSTBIT_MSB`（74HC595 的慣例），或保留 LSB 先送、改送 `0x80 >> step`。',
    },
    {
      symptom: 'PA5（SCK）與 PA7（MOSI）都看得到 SPI 波形，8 顆 LED 卻一直不亮。',
      cause: 'RCLK 沒有接（浮接）或沒有產生上升緣：資料已經移進移位暫存器，但從未鎖存到輸出，QA～QH 一直維持上電時的 0。',
      fix: '把 RCLK 接到 PA4，並在每次 `HAL_SPI_Transmit()` 之後把 PA4 由低拉高一次。',
    },
    {
      symptom: '所有 LED 一直不亮，即使 RCLK 與 SPI 都正確。',
      cause: 'OE（第 13 腳）接到了 3.3 V 或浮接：輸出致能是低電位有效，OE 為高時 QA～QH 都是高阻抗。SRCLR 接 GND 也會讓移位暫存器一直被清除成 0。',
      fix: 'OE 接 GND、SRCLR 接 3.3 V（本課已預先接好）；需要整體調光時可以用 PWM 驅動 OE。',
    },
    {
      symptom: 'SPI 波形正常、RCLK 也接了，8 顆 LED 還是全部不亮。',
      cause:
        'SCK 與 MOSI 接反（PA5 接到 SER、PA7 接到 SRCLK）：74HC595 拿資料線當移位時脈。`1 << step` 每個位元組只有一個 1，MOSI 只上升一次，而模式 0 下那一刻 SCK 是低準位，所以移進去的永遠是 0。',
      fix: 'PA5（SPI1_SCK）→ SRCLK（第 11 腳，a39），PA7（SPI1_MOSI）→ SER（第 14 腳，a36）。',
    },
    {
      symptom: '自己寫的程式改用 SPI 模式 1 後，所有圖樣都偏移了一個位置。',
      cause: '模式 1（CPHA = 1）在 SCK 上升緣改變資料、下降緣取樣；74HC595 卻在 SRCLK 上升緣取樣，剛好碰上資料改變的瞬間。',
      fix: '74HC595 用模式 0（或模式 3）；每顆 SPI 裝置的資料手冊都會畫出它在哪個邊緣取樣。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'hal-spi-595', label: 'U1 已載入 hal-spi-595 韌體' },
    { kind: 'connected', a: { component: 'U1', pin: 'PA5' }, b: { component: 'U2', pin: 'SRCLK' }, label: 'PA5（SPI1_SCK）接到 SRCLK' },
    { kind: 'connected', a: { component: 'U1', pin: 'PA7' }, b: { component: 'U2', pin: 'SER' }, label: 'PA7（SPI1_MOSI）接到 SER' },
    { kind: 'connected', a: { component: 'U1', pin: 'PA4' }, b: { component: 'U2', pin: 'RCLK' }, label: 'PA4 接到 RCLK（鎖存）' },
    { kind: 'measure', at: qa, quantity: 'frequency', min: 1.2, max: 1.3, seconds: 2.5, fresh: true, label: 'QA 每 800 ms 亮一次（1.25 Hz）' },
    { kind: 'measure', at: qa, quantity: 'duty', min: 11.5, max: 13.5, seconds: 2.5, fresh: true, label: 'QA 每次亮 100 ms（工作週期 12.5 %）' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: '74HC595 chaser 10 Hz', seconds: 0.5, label: '開機時印出 74HC595 跑馬燈的開機訊息' },
    { kind: 'firmware-checks', project: 'hal-spi-595', label: '韌體行為契約：SPI 時序與每 100 ms 一次鎖存' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'chip',
      title: '認識 74HC595 的腳位',
      body:
        '把游標停在 U2 上看腳位名稱（手機：點一下 U2），找出還沒接的三支控制腳：**SER**（資料）、**SRCLK**（移位時脈）、**RCLK**（鎖存時脈）。看完按「下一步」。\n\n' +
        '已經接好的有：VCC → 3.3 V、GND、**SRCLR → 3.3 V**（低電位有效的清除，保持不清除）、**OE → GND**（低電位有效的輸出致能，保持致能），以及 QA～QH 的 8 組 LED。',
      highlight: { components: ['U2'] },
    },
    {
      id: 'spi',
      title: '接上 SCK 與 MOSI',
      body:
        '用「導線」工具接 `a39`（SRCLK）→ `a20`（PA5 = SPI1_SCK），再接 `a36`（SER）→ `a18`（PA7 = SPI1_MOSI）。\n\n' +
        'SPI 的時脈直接當作 595 的移位時脈：模式 0 下資料在 SCK 上升緣穩定，595 也正好在 SRCLK 上升緣取樣。',
      highlight: { holes: ['a39', 'a36', PA5, PA7], components: ['U2'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: { component: 'U1', pin: 'PA5' }, b: { component: 'U2', pin: 'SRCLK' } },
          { kind: 'connected', a: { component: 'U1', pin: 'PA7' }, b: { component: 'U2', pin: 'SER' } },
        ],
        label: 'SCK → SRCLK、MOSI → SER',
      },
    },
    {
      id: 'latch',
      title: '接上鎖存線 RCLK',
      body: '用導線接 `a38`（RCLK）→ `a21`（PA4）。\n\nPA4 是一般的推挽輸出，韌體在送完一個位元組後把它由低拉高，上升緣把資料鎖存到 QA～QH。',
      highlight: { holes: ['a38', PA4] },
      check: { kind: 'connected', a: { component: 'U1', pin: 'PA4' }, b: { component: 'U2', pin: 'RCLK' }, label: 'PA4 → RCLK' },
    },
    {
      id: 'firmware',
      title: '載入 hal-spi-595，看跑馬燈',
      body:
        '按下方的「載入 hal-spi-595 到 U1」，再按「▶ 執行模擬」（或空白鍵）：LED1（QA）→ LED8（QH）每 100 ms 前進一顆。\n\n' +
        '終端機（USART1）開機印出 `74HC595 chaser 10 Hz`。主迴圈每 100 ms：`HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_RESET); HAL_SPI_Transmit(&hspi1, &pattern, 1, 10); HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_SET);`',
      highlight: { components: ['U2', 'LED1', 'LED8'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'hal-spi-595', label: 'U1 已載入 hal-spi-595' },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'hal-spi-595' }, { kind: 'run' }],
    },
    {
      id: 'analyzer',
      title: '用邏輯分析儀看一次傳輸',
      body:
        '打開儀器的「邏輯分析儀」，加入 **PA4**、**PA5**、**PA7** 三個通道並加上 SPI 解碼器（模式 0、MSB 先送），放大到 PA4 的低脈波：裡面有 8 個 4.5 MHz 的 SCK 脈波，解碼出 0x01、0x02、0x04 … 0x80。\n\n' +
        '再加一個通道量 U2 的 **QA**：每 800 ms 高 100 ms（1.25 Hz、12.5 %）。',
      highlight: { holes: [PA4, PA5, PA7] },
      check: { kind: 'measure', at: qa, quantity: 'frequency', min: 1.2, max: 1.3, seconds: 2.5, fresh: true, label: 'QA = 1.25 Hz' },
    },
    {
      id: 'lsb',
      title: '重現 LSB 先送的錯誤',
      body:
        '按下方的「載入 `lesson-i8-lsb` 到 U1」：跑馬燈變成從 LED8（QH）往 LED1（QA）跑。體驗完按「換回 hal-spi-595」，再到「驗收」按「檢查我的電路」。\n\n' +
        '它和 hal-spi-595 唯一的差別是 `SPI_FIRSTBIT_LSB`。用 SPI 解碼器（仍設 MSB 先送）看，送出的位元組變成 0x80、0x40 … 0x01 的鏡像。',
      highlight: { components: ['LED1', 'LED8'] },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'lesson-i8-lsb' }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', '74hc595', 'resistor', 'led'],
    firmware: ['hal-spi-595', 'lesson-i8-lsb'],
  },
  durationMin: 40,
}
