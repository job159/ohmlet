/**
 * a5 — STM32 + A4988 步進馬達驅動器：STEP／DIR、微步、梯形加減速、限流與失步。
 *
 * Firmware: firmware/dist/hal-stepper-a4988 (ST HAL): TIM2 CH1 (PA0) puts out
 * one 10 µs STEP pulse per timer period, the update interrupt rewrites ARR
 * for the next step (linear frequency ramp → cruise → ramp down); DIR = PB0,
 * MS1–MS3 = PB12–PB14, EN = PB15. Moves: +1600 steps at 1/8 (one turn,
 * 400 → 3200 steps/s), −100 full steps (half a turn back), −800 at 1/8
 * (back to the start), each logged on USART1. The A4988 carrier (DRV1,
 * StepStick at g40: row g EN MS1 MS2 MS3 RST SLP STEP DIR, row d VMOT GND 2B
 * 2A 1A 1B VDD GND) drives a NEMA 17 (M1) from a 12 V bench supply (PS2).
 * The firmware only COUNTS the pulses it sent (open loop): the motor's real
 * position is its own telemetry (M1 position / turns in the inspector), which
 * the acceptance cannot read yet — the holding-current measurement stands in
 * for a correctly powered and current-limited driver. Every number below is
 * what the simulation produces (tests/lessons/advanced.test.ts).
 */
import type { Lesson } from '../types'
import { GND, TAP, anchored, bench, bullets, doc, offboard, pin, pinOf, wire, wired } from './bench'

const FW = 'hal-stepper-a4988'

const PS2 = offboard('PS2', 'power_supply', { voltage: 12 })
const DRV1 = anchored('DRV1', 'a4988_driver', 'g40', { vref: 0.5 })
const M1 = offboard('M1', 'nema17_stepper')

/** Pre-wired: motor supply, logic supply, the two coils, EN and MS1–MS3. */
const PREWIRED = [
  wire('W7', 'PS2:+', 'a40', 'red'), // VMOT 12 V
  wire('W8', 'PS2:-', 'top-32', 'black'), // PS2 − to the common ground
  wire('W9', 'a41', 'top-33', 'black'), // GND (motor side)
  wire('W10', 'a46', 'top+37', 'red'), // VDD 3.3 V
  wire('W11', 'a47', 'top-38', 'black'), // GND (logic side)
  wire('W12', 'a44', 'M1:A+', 'green'), // 1A → coil A
  wire('W13', 'a45', 'M1:A-', 'black'), // 1B → coil A
  wire('W14', 'a43', 'M1:B+', 'red'), // 2A → coil B
  wire('W15', 'a42', 'M1:B-', 'blue'), // 2B → coil B
  wire('W16', 'j40', TAP.PB15, 'white'), // EN ← PB15 (low = enabled)
  wire('W17', 'j41', TAP.PB12, 'gray'), // MS1 ← PB12
  wire('W18', 'j42', TAP.PB13, 'gray'), // MS2 ← PB13
  wire('W19', 'j43', TAP.PB14, 'gray'), // MS3 ← PB14
]

const START = bench('a5 A4988 步進馬達（起始）', [PS2, DRV1, M1], PREWIRED)

const SOLUTION = bench(
  'a5 A4988 步進馬達（解答）',
  [PS2, DRV1, M1],
  [
    ...PREWIRED,
    wire('W20', 'j46', TAP.PA0, 'yellow'), // STEP ← PA0 (TIM2_CH1)
    wire('W21', 'j47', TAP.PB0, 'green'), // DIR ← PB0
    wire('W22', 'i44', 'i45', 'orange'), // RST ↔ SLP
  ],
)

const STEP_WIRED = wired('DRV1', 'STEP', pin('PA0'))
const DIR_WIRED = wired('DRV1', 'DIR', pin('PB0'))
const RST_SLP = { kind: 'connected', a: pinOf('DRV1', 'RST'), b: pinOf('DRV1', 'SLP') } as const
const HOLD = {
  kind: 'measure',
  at: pinOf('M1', 'A+'),
  quantity: 'current',
  component: 'M1',
  min: 0.55,
  max: 0.75,
  seconds: 0.25,
  fresh: true,
} as const

export const LESSON: Lesson = {
  id: 'a5-stepper-a4988',
  level: 'advanced',
  order: 5,
  title: 'STM32 + A4988：步進馬達、微步與加減速',
  summary:
    '用 A4988 驅動器（DRV1）推動 NEMA 17 步進馬達（M1）：STM32 只送 STEP 脈波與 DIR 方向，用 MS1～MS3 選全步或 1/8 微步，TIM2 在每一步的更新中斷裡重新計算週期，做出 400 → 3200 步/s 的梯形加減速。再用限流 VREF 親手做出「失步」：韌體說轉了一圈，馬達其實沒有。',
  objectives: [
    '說明 STEP／DIR 介面：STEP 每個上升緣走一個（微）步，DIR 決定方向；A4988 依 MS1～MS3 把一個全步（1.8°）切成 1、2、4、8 或 16 份',
    '計算步數與角度：NEMA 17 一圈 200 個全步，1/8 微步要 1600 個 STEP 脈波；3200 步/s 在 1/8 微步就是每秒 2 圈',
    '說明梯形加減速：用計時器的自動重載值（ARR）逐步縮短 STEP 週期，從 2.5 ms（400 步/s）加速到 312 µs（3200 步/s）再減速停下',
    '由 VREF 算出線圈電流：I = VREF ÷ (8 × 0.068 Ω)，VREF 0.5 V → 滿刻度 0.919 A，停在 45° 時每相約 0.65 A',
    '理解開迴路控制：韌體只數自己送出幾個脈波，扭力不足而失步時它完全不知道',
  ],
  wiring: doc(
    '電源與 Blue Pill（U1）已經接好：下方 + 電源軌（bot+）是 5 V，上方 + 電源軌（top+）是 3.3 V，兩條 − 電源軌都是 GND。A4988 載板（DRV1）跨在中央溝槽上：g 列是 EN、MS1、MS2、MS3、RST、SLP、STEP、DIR（`g40`～`g47`，空孔在 j 列），d 列是 VMOT、GND、2B、2A、1A、1B、VDD、GND（`d40`～`d47`，空孔在 a 列）。',
    '起始電路已經接好的部分：',
    bullets(
      '馬達電源：PS2（12 V）正端 → `a40`（VMOT），PS2 負端與兩個 GND 腳都接到上方 − 電源軌（和 Blue Pill 共地）',
      '邏輯電源：`a46`（VDD）→ 上方 + 電源軌 3.3 V，輸入門檻才會和 STM32 的 3.3 V 輸出相配',
      '線圈：1A／1B → M1 的 A+／A−，2A／2B → M1 的 B+／B−',
      'EN ← U1 PB15（板上 B15，低電位致能）；MS1、MS2、MS3 ← U1 PB12、PB13、PB14（板上 B12～B14）',
    ),
    '你要接 **三條線**：',
    bullets(
      'STEP：`j46` → `a25`（U1 PA0（板上 A0），TIM2_CH1）',
      'DIR：`j47` → `a17`（U1 PB0（板上 B0））',
      'RST ↔ SLP：`i44` → `i45`。A4988 的 RESET 沒有上拉電阻，空著會讀成低電位、驅動器一直停在重置；接到 SLP 就跟著載板上 10 kΩ 的 SLEEP 上拉一起變成高電位。',
    ),
  ),
  theory: doc(
    '**步進馬達怎麼轉**：NEMA 17 的轉子有 50 齒，兩組線圈 A、B 輪流通電，每換一次電流方向轉子就前進一個全步 1.8°（一圈 200 步）。A4988 把每一步的兩相電流換成正弦表上的值，就能把一個全步切成更細的**微步**：',
    bullets(
      'MS1 MS2 MS3 = 000 → 全步；100 → 1/2；010 → 1/4；**110 → 1/8**；111 → 1/16',
      '1/8 微步時一圈要 200 × 8 = **1600** 個 STEP 脈波，轉動更平順、低速時不會一格一格地跳',
      'STEP 的每個上升緣走一步（高電位至少 1 µs，韌體給 10 µs）；DIR 與 MSx 要在第一個 STEP 之前設好（韌體提前 1 ms）',
    ),
    '**限流與 VREF**：A4988 用 0.068 Ω 的感測電阻量線圈電流，滿刻度電流 I = VREF ÷ (8 × 0.068 Ω) = VREF ÷ 0.544 Ω。本課 VREF = 0.5 V → **0.919 A**。馬達停著時停在 45° 電角度，兩相各是 0.919 × 0.707 ≈ **0.65 A**——這就是「保持電流」，讓轉子被磁力鎖住。電流越大扭力越大，但馬達與驅動器也越熱。',
    '**為什麼要加減速**：馬達的扭力在轉速越高時越小（線圈電感與反電動勢讓電流來不及建立），轉子還有慣量。一開始就用最高速送脈波，轉子跟不上就會**失步**。韌體在 TIM2 的更新中斷裡算下一步的週期：',
    bullets(
      '前 400 步線性加速：f = 400 + (3200 − 400) × n ÷ 400 步/s，週期從 1/400 s = **2.5 ms** 縮短到 1/3200 s ≈ **312 µs**',
      '中間 800 步等速 3200 步/s（1/8 微步 = 400 全步/s = 每秒 2 圈）',
      '最後 400 步對稱減速；最後一個週期把 CCR1 設成 0，剛好送出 1600 個脈波',
    ),
    '`ARR` 有預載，新的週期在更新事件時才生效，所以每一步的長度都精確。本課的模擬馬達沒有接負載慣量，從靜止直接跳到 3200 步/s 也跟得上；真正裝上皮帶、滑台時就會失步——所以加減速是必要的習慣。',
    '**開迴路**：韌體印出的 `position` 只是「我送出了幾個脈波」，它沒有任何感測器知道馬達真正轉到哪裡。扭力不足（VREF 太低、負載太重）時馬達少走幾步，韌體照樣報告正確的位置。要確定位置，得靠開機時的歸零開關，或加裝編碼器做閉迴路控制。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART：`A4988 stepper demo`；約 0.31 s `move +1600 steps 1/8 (1 rev)`，約 1.16 s `done, position 1600/8 full steps`（M1 轉了 1.003 圈）',
    '約 1.46 s `move -100 steps full (1/2 rev)`，約 1.81 s `done, position 800/8 full steps`；約 2.12 s `move -800 steps 1/8 (1/2 rev)`，約 2.72 s 回到原點印出 `done, position 0/8 full steps`',
    '邏輯分析儀 U1 PA0：第一個 STEP 週期約 2.5 ms（400 步/s），加速 400 步後縮短到約 312 µs（3200 步/s），每個脈波高電位 10 µs；U1 PB0 在每次換方向時改變',
    'M1 的線圈保持電流：VREF 0.5 V → 每相約 0.65 A（滿刻度 0.919 A）；轉動中最大 0.919 A',
    'DRV1 的 VREF 改成 0.08 V：UART 一樣印 `done, position 1600/8 full steps`，M1 卻只轉到 172.9 個全步（0.865 圈）——失步了',
  ],
  // acceptance indices: 0 STEP · 1 DIR · 2 RST–SLP · 3 coils · 4 VMOT · 5 firmware · 6 holding current
  // · 7 first move · 8 one turn done · 9 back home · 10 contract · 11 ERC
  mistakes: [
    {
      symptom: '馬達完全不轉（或只抖一下），UART 的訊息卻都正常',
      cause: 'STEP、DIR 還沒接到 U1 PA0／PB0，或兩條線接反了：步進脈波送到了 DIR 腳，STEP 腳只在每次換方向時才變化一次',
      fix: 'STEP（`j46`）接 U1 PA0（TIM2_CH1 的輸出），DIR（`j47`）接 U1 PB0',
      match: { checks: [0, 1] },
    },
    {
      symptom: 'UART 照樣印出 `done, position 1600/8 full steps`，馬達卻一動也不動，也沒有保持電流',
      cause: 'RST 沒有接到 SLP：A4988 的 RESET 腳沒有上拉電阻，空著會讀成低電位，驅動器一直停在重置、輸出全部關閉。韌體不知道，照樣數脈波',
      fix: '用一條線把 `i44`（RST）接到 `i45`（SLP），或把 RST 接到 VDD',
      match: { checks: [2], passes: [0, 1] },
    },
    {
      symptom: 'UART 說轉了一圈，3D 畫面裡的 M1 卻少轉了一截（屬性面板的位置只有 172.9 個全步，約 0.865 圈），每次來回都偏得更多',
      cause:
        '失步：VREF 太低，線圈電流不夠，高速時扭力不足，轉子跟不上 STEP 脈波。在模擬器重現：把 DRV1 的「限流 VREF」改成 0.08 V（滿刻度只有 0.147 A），保持電流也降到約 0.10 A',
      fix: '依馬達規格設定 VREF（I = VREF ÷ 0.544 Ω）：本課 0.5 V；仍然失步時降低最高速度、拉長加速段，或在機構上加歸零開關定期校正',
      match: { checks: [6], passes: [0, 1, 2, 3, 4] },
    },
    {
      symptom: '馬達來回抖動、發出嗡嗡聲，轉不到一圈（約 11 個全步就停住）',
      cause: '線圈配對錯了：1A／1B 必須接同一組線圈（A+／A−），2A／2B 接另一組。把兩組線圈各拆一條交叉接，電流就不會形成旋轉磁場',
      fix: '先用電表找出導通的兩條線（同一組線圈約幾歐姆），1A／1B 接一組、2A／2B 接另一組',
      match: { checks: [3] },
    },
    {
      symptom: '馬達完全沒有電流，電氣規則檢查提示馬達電源有問題',
      cause: 'VMOT 沒有接到 12 V：A4988 的功率級低於 8 V 時鎖定（欠壓保護），只有 VDD 的 3.3 V 不能推動馬達',
      fix: 'PS2 正端（12 V）接 `a40`（VMOT），PS2 負端接 GND，並和 Blue Pill 共地',
      match: { checks: [4] },
    },
    {
      symptom: '加上負載之後，UART 說轉了一圈，馬達卻幾乎沒動',
      cause: '負載轉矩大過馬達在這個電流下的扭力。在模擬器重現：把 M1 的「負載轉矩」改成 15 N·cm（VREF 0.5 V 時馬達撐不住）',
      fix: '提高 VREF（在馬達額定電流以內）、降低速度與加速度，或換扭力更大的馬達；並用歸零開關確認位置',
    },
  ],
  acceptance: [
    wired('DRV1', 'STEP', pin('PA0'), 'DRV1 STEP 接到 U1 PA0（板上 A0，TIM2_CH1）'),
    wired('DRV1', 'DIR', pin('PB0'), 'DRV1 DIR 接到 U1 PB0（板上 B0）'),
    { ...RST_SLP, label: 'DRV1 RST 接到 DRV1 SLP（離開重置）' },
    {
      kind: 'all',
      label: 'M1 線圈 A 接 1A／1B、線圈 B 接 2A／2B',
      checks: [
        wired('DRV1', '1A', pinOf('M1', 'A+')),
        wired('DRV1', '1B', pinOf('M1', 'A-')),
        wired('DRV1', '2A', pinOf('M1', 'B+')),
        wired('DRV1', '2B', pinOf('M1', 'B-')),
      ],
    },
    { kind: 'connected', a: pinOf('DRV1', 'VMOT'), b: { terminal: 'PS2:+' }, label: 'DRV1 VMOT 接到 PS2 正端（12 V）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 hal-stepper-a4988 韌體' },
    { ...HOLD, label: 'M1 每相的保持電流約 0.65 A（VREF 0.5 V，驅動器已致能）' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'move +1600 steps 1/8 (1 rev)',
      seconds: 0.5,
      label: '開始第一段：1/8 微步正轉 1600 步（一圈）',
    },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'done, position 1600/8 full steps',
      seconds: 1.4,
      label: '加速、等速、減速走完 1600 個脈波',
    },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'done, position 0/8 full steps',
      seconds: 3.2,
      label: '全步反轉半圈、1/8 微步再反轉半圈，回到原點',
    },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（腳位、開機訊息）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'step-dir',
      title: '接上 STEP 與 DIR',
      body: doc(
        '按下方的「開始接線」，接 `j46`（DRV1 STEP）→ `a25`（U1 PA0（板上 A0）），再接 `j47`（DRV1 DIR）→ `a17`（U1 PB0（板上 B0））。',
        'PA0 是 TIM2 第 1 通道的輸出：計時器每個週期自動送出一個 10 µs 的脈波，CPU 不必自己翻轉腳位。DIR 只是一般的推挽輸出，高電位正轉、低電位反轉。',
      ),
      highlight: { holes: ['j46', TAP.PA0, 'j47', TAP.PB0], components: ['DRV1', 'U1'] },
      check: { kind: 'all', checks: [STEP_WIRED, DIR_WIRED], label: 'STEP 接 U1 PA0、DIR 接 U1 PB0' },
    },
    {
      id: 'rst-slp',
      title: '讓驅動器離開重置：RST 接 SLP',
      body: doc(
        '按下方的「開始接線」，用一條短線接 `i44`（RST）→ `i45`（SLP）。',
        'A4988 的 SLEEP 在載板上有 10 kΩ 上拉，但 RESET 沒有：空著時讀成低電位，驅動器一直在重置、輸出關閉。把兩腳接在一起，它們就一起被拉到 VDD。',
      ),
      highlight: { holes: ['i44', 'i45'], components: ['DRV1'] },
      check: { ...RST_SLP, label: 'DRV1 RST 接到 DRV1 SLP' },
    },
    {
      id: 'run',
      title: '執行：1/8 微步轉一圈',
      body: doc(
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，打開「UART 終端機」：約 0.31 s 出現 `move +1600 steps 1/8 (1 rev)`，約 1.16 s 出現 `done, position 1600/8 full steps`，M1 的軸剛好轉一圈。',
        '點一下 M1 看屬性面板：位置約 200 個全步、轉了 1.003 圈（多出的 0.5 步是開機時停在 45° 電角度）。MS1 = MS2 = 1、MS3 = 0 選 1/8 微步，所以 1600 個脈波 ÷ 8 = 200 個全步。',
      ),
      highlight: { components: ['M1', 'DRV1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'done, position 1600/8 full steps', seconds: 1.4 },
    },
    {
      id: 'ramp',
      title: '用邏輯分析儀看加減速',
      body: doc(
        '按下方的「把 PA0、PB0 加到邏輯分析儀」，放大第一段移動的開頭：相鄰兩個 STEP 脈波的間隔從約 2.5 ms 逐漸縮短，約 0.12 s 後穩定在約 312 µs（3200 步/s），結束前再對稱地拉長。',
        '每一步結束時 TIM2 的更新中斷算出下一個週期寫進 `ARR`；因為 `ARR` 有預載，新的週期剛好從下一步開始生效。U1 PB0（DIR）在第二段移動前變成低電位：反轉。',
      ),
      highlight: { components: ['U1', 'DRV1'] },
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PA0', 'PB0'] }, { kind: 'run' }],
    },
    {
      id: 'full-step',
      title: '全步與 1/8 微步',
      body: doc(
        '第二段 `move -100 steps full (1/2 rev)` 把 MS1～MS3 都設成 0：每個脈波是一個完整的 1.8°，100 個脈波轉半圈，約 1.81 s 印出 `done, position 800/8 full steps`。',
        '全步時每一步的電流變化最大，轉子一格一格地跳，3D 畫面裡看得到它比 1/8 微步時抖。第三段再用 1/8 微步反轉 800 步回到原點：`done, position 0/8 full steps`。',
      ),
      highlight: { components: ['M1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'done, position 800/8 full steps', seconds: 2.0 },
    },
    {
      id: 'vref',
      title: '限流 VREF 與失步實驗',
      body: doc(
        '按「檢查此步驟」量 M1 的保持電流：每相約 0.65 A（VREF 0.5 V → 滿刻度 0.919 A，停在 45° 時乘以 0.707）。',
        '接著點 DRV1，把「限流 VREF」改成 **0.08 V**（滿刻度只剩 0.147 A），再按下方的「重置模擬」讓韌體與馬達都從頭開始：UART 一樣印出 `done, position 1600/8 full steps`，M1 的屬性面板卻只有約 172.9 個全步——高速段扭力不足，轉子失步了，而韌體完全不知道。也可以試試把 M1 的「負載轉矩」改成 15 N·cm。做完實驗**把 VREF 改回 0.5 V、負載轉矩改回 0**，再到「驗收」按「檢查我的電路」。',
      ),
      highlight: { components: ['DRV1', 'M1'] },
      check: { ...HOLD, label: 'M1 保持電流約 0.65 A' },
      action: [{ kind: 'run' }, { kind: 'reset', scope: 'circuit' }],
    },
  ],
  runnable: 'ready',
  requires: { parts: ['stm32_bluepill', 'power_supply', 'a4988_driver', 'nema17_stepper'], firmware: [FW], instrument: 'uart' },
  durationMin: 45,
}
