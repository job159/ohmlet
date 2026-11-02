/**
 * a6 — STM32 + KY-040 旋轉編碼器：TIM4 編碼器模式、輸入濾波、按鍵去彈跳。
 *
 * Firmware: firmware/dist/lesson-a6-encoder (ST HAL, hal-ky040 plus the
 * lesson's raw-count jumper): TIM4 encoder mode 3 on PB6 (CLK, TIM4_CH1) /
 * PB7 (DT, TIM4_CH2) with IC1F = IC2F = 15, 4 counts per detent, 'pos=<n>'
 * at every new detent; the push switch on PB12 (internal pull-up) debounced
 * for 20 ms; PB13 → GND at reset also prints every raw count 'cnt=<n>'.
 * The KY-040 (ENC1, at f40: CLK DT SW + GND = f40…f44, the board covers rows
 * a–f, so its pins are reached from rows g–j) turns when its 「位置」 param
 * changes, at 「轉動速度」 detents per second (20 here: one detent = 50 ms).
 * The acceptance turns the knob itself (final round: a runtime stimulus on
 * ENC1's 「位置」 / 「按下」 through the coordinator's runtime-param path,
 * exactly what the inspector does): 0 → 5 must print pos=5, back to 2 must
 * print pos=2 (counting down), a press / release must print 「SW pressed」 /
 * 「SW released」 after the 20 ms debounce. The simulated encoder has ideal
 * contacts (no bounce), so the input filter and the debounce against
 * bouncing contacts are verified by the firmware contract's stimulus pulses
 * on the same pins — runnable 'partial' for that reason only (runnableNote).
 */
import type { Lesson, LessonCheck } from '../types'
import { GND, TAP, anchored, bench, bullets, doc, pin, wire, wired } from './bench'

const FW = 'lesson-a6-encoder'

const ENC1 = anchored('ENC1', 'ky040_encoder', 'f40', { turnRate: 20 })

const POWER = [
  wire('W7', 'j43', TAP['3V3_2'], 'red'), // + → the Blue Pill's 3.3 V (pull-ups of CLK / DT)
  wire('W8', 'j44', 'bot-35', 'black'), // GND
]

const START = bench('a6 KY-040 旋轉編碼器（起始）', [ENC1], POWER)

const SOLUTION = bench(
  'a6 KY-040 旋轉編碼器（解答）',
  [ENC1],
  [
    ...POWER,
    wire('W9', 'j40', TAP.PB6, 'yellow'), // CLK → PB6 (TIM4_CH1)
    wire('W10', 'j41', TAP.PB7, 'blue'), // DT → PB7 (TIM4_CH2)
    wire('W11', 'j42', TAP.PB12, 'green'), // SW → PB12
  ],
)

const BOOT = 'KY-040 lesson a6: TIM4 encoder CLK PB6 / DT PB7, filter 15, SW PB12'

/** The check turns the knob itself (ENC1 「位置」 0 → 5 at 0.1 s): one line per detent, the last one pos=5. */
const TURN_TO_5: LessonCheck = {
  kind: 'uart-contains',
  component: 'U1',
  port: 'USART1',
  text: 'pos=5',
  seconds: 0.5,
  stimulus: [{ at: 0.1, component: 'ENC1', param: 'position', value: 5 }],
  label: '「位置」改成 5：終端機一格一格印到「pos=5」',
}

export const LESSON: Lesson = {
  id: 'a6-rotary-encoder',
  level: 'advanced',
  order: 6,
  title: 'STM32 + KY-040：計時器編碼器模式與去彈跳',
  summary:
    '把 KY-040 旋轉編碼器（ENC1）接到 TIM4 的兩個輸入通道，讓計時器硬體自己數正交訊號：順時針加、逆時針減，每一格 4 個計數，CPU 只要讀 `TIM4->CNT`。再看輸入濾波器怎麼擋掉 2 µs 的接點突波、按鍵怎麼用 20 ms 去彈跳，並用實驗跳線印出每一個原始計數。',
  objectives: [
    '說明正交訊號：A（CLK）與 B（DT）相差 90°，順時針時 CLK 先下降；由哪一相領先判斷方向',
    '設定 STM32 計時器的編碼器模式 3（`TIM_ENCODERMODE_TI12`）：CH1、CH2 的每個邊緣都計數，KY-040 每一格是一個完整的正交週期 = 4 個計數',
    '只有 TIMx_CH1、TIMx_CH2 能接編碼器：TIM4 的 CH1、CH2 是 U1 PB6（板上 B6）與 U1 PB7（板上 B7）',
    '用輸入濾波器 IC1F = 15 擋掉短於 256 個計時器時脈（72 MHz 時約 3.6 µs）的突波；按鍵則在軟體裡等 20 ms 穩定才算數',
    '理解 16 位元計數器的有號解讀：`(int16_t)CNT` 讓 0 往回轉一格變成 −4，而不是 65532',
  ],
  wiring: doc(
    'Blue Pill（U1）與電源已經接好。KY-040（ENC1）插在 `f40`，排針由左到右是 **CLK、DT、SW、+、GND**（`f40`～`f44`），模組本體蓋住 a～f 列，請從同一欄的 **j 列**拉線。',
    bullets(
      '已接好：+（`j43`）→ `j29`（U1 3V3（板上 3.3）的空孔），GND（`j44`）→ `bot-35`。模組上 CLK、DT 各有一顆 10 kΩ 上拉電阻接到 +，所以 + 一定要接 3.3 V，訊號才會是 3.3 V 準位。',
      'CLK：`j40` → `j23`（U1 PB6（板上 B6），TIM4_CH1）',
      'DT：`j41` → `j24`（U1 PB7（板上 B7），TIM4_CH2）',
      'SW：`j42` → `j10`（U1 PB12（板上 B12））。按鍵按下時接到 GND，模組上**沒有**上拉電阻，韌體會打開 PB12 的內部上拉。',
    ),
    '韌體 `lesson-a6-encoder` 已經選好，USART1（U1 PA9（板上 A9），115200 8N1）的輸出在「UART 終端機」。要轉動旋鈕時，點 ENC1 在屬性面板改「位置」（單位是格）；「轉動速度」設為每秒 20 格，所以每一格約 50 ms。',
  ),
  theory: doc(
    '**正交訊號**：KY-040 裡的 EC11 編碼器有兩個接點 A（CLK）與 B（DT），轉動時輪流接到 GND。每轉一格（一圈 20 格），兩相各完成一次「接通→放開」，而且相差四分之一個週期（90°）：',
    bullets(
      '順時針：CLK 下降 → DT 下降 → CLK 上升 → DT 上升（CLK 領先）',
      '逆時針：DT 下降 → CLK 下降 → DT 上升 → CLK 上升（DT 領先）',
      '停在格位上時兩個接點都放開，CLK 與 DT 經 10 kΩ 上拉都是高電位',
    ),
    '**計時器編碼器模式**：TIM4 的時脈不再來自內部，而是 CH1（PB6）與 CH2（PB7）的邊緣。模式 3（`TIM_ENCODERMODE_TI12`）在兩個通道的每個邊緣都依另一相的準位決定加或減（RM0008 表 87），所以一格 = **4 個計數**。整個過程由硬體完成，CPU 不需要任何中斷，主迴圈每 1 ms（SysTick 叫醒 `__WFI()`）讀一次 `CNT`，計數是 4 的倍數而且和上次不同時印出 `pos=CNT÷4`。',
    '**有號計數**：`CNT` 是 0～65535 的 16 位元計數器，從 0 往回轉一格會變成 65532。轉成 `int16_t` 之後就是 −4，除以 4 得到 −1。只轉半格又轉回來（+2 −2），計數回到 4 的倍數但位置沒變，所以不印出任何東西。',
    '**輸入濾波器**：機械接點在切換的瞬間會彈跳。`IC1F` = `IC2F` = 15 讓計時器以 f_DTS ÷ 32 取樣、連續 8 次相同才承認一個邊緣：8 × 32 = 256 個時脈，72 MHz 時約 **3.6 µs**。比這短的突波（例如 2 µs）完全不會計數。注意：模擬器的 KY-040 是理想接點，不會彈跳，濾波器的效果由韌體行為合約用 2 µs 的刺激脈衝驗證。',
    '**按鍵去彈跳**：SW 沒有接計時器，韌體每 1 ms 讀一次 PB12：準位一改變就重新開始計時，連續 20 ms 不變才印出 `SW pressed` 或 `SW released`。所以按下後約 19～20 ms 才看到訊息，彈跳期間的抖動都被吸收。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART 開機：`KY-040 lesson a6: TIM4 encoder CLK PB6 / DT PB7, filter 15, SW PB12`、`pos=0`',
    'ENC1 的「位置」從 0 改成 5（每秒 20 格）：約每 50 ms 一行，依序 `pos=1`～`pos=5`，共約 0.25 s；再改成 2：`pos=4`、`pos=3`、`pos=2`',
    '邏輯分析儀 U1 PB6、PB7：順時針時 CLK 先下降，兩相相差約 12.5 ms（一格 50 ms 的四分之一）',
    '打開 ENC1 的「保持按下」（或在麵包板上按住旋鈕）：約 0.02 s 後 `SW pressed`；放開後約 0.02 s `SW released`',
    'U1 PB13 接地並重置後轉一格：`cnt=1`、`cnt=2`、`cnt=3`、`cnt=4`，然後 `pos=1`',
  ],
  // acceptance indices: 0 CLK · 1 DT · 2 SW · 3 power · 4 PB13 open · 5 firmware · 6 boot · 7 contract · 8 ERC
  //                     · 9 the count follows the knob turned by the check · 10 the press / release turned by the check
  mistakes: [
    {
      symptom: '旋鈕往順時針轉（「位置」增加），終端機卻印出 `pos=-1`、`pos=-2`…',
      cause: 'CLK 與 DT 接反了：CLK 接到 PB7、DT 接到 PB6，計時器看到的是 DT 領先，於是往下數',
      fix: 'CLK（`j40`）接 `j23`（PB6），DT（`j41`）接 `j24`（PB7）；或在韌體把其中一個通道的極性反相（`TIM_ICPOLARITY_FALLING`）',
      match: { checks: [0, 1], passes: [2] },
    },
    {
      symptom: '怎麼轉都停在 `pos=0`，按鍵卻正常',
      cause: 'CLK 接到了不是 TIM4_CH1 的腳（例如旁邊的 `j25` 是 U1 PB8（板上 B8），TIM4_CH3）：編碼器模式只用 CH1 與 CH2，只剩 DT 一相在變化，計數加一又減一',
      fix: '編碼器一定要接同一個計時器的 CH1 與 CH2：TIM4 是 PB6／PB7（TIM2 是 PA0／PA1，TIM3 是 PA6／PA7）',
      match: { checks: [0], passes: [1] },
    },
    {
      symptom: '電氣規則檢查說 ENC1 沒有供電，轉動旋鈕沒有任何計數',
      cause: 'KY-040 的 + 沒有接：CLK 與 DT 的 10 kΩ 上拉電阻沒有電源，接點放開時線路浮接，計時器看不到乾淨的邊緣',
      fix: '把 +（`j43`）接到 3.3 V（`j29` 或上方 + 電源軌），GND 接 GND',
      match: { checks: [3] },
    },
    {
      symptom: '轉一格，數字就跳 4（或終端機出現一串 `cnt=1`、`cnt=2`…）',
      cause:
        '直接印出 `CNT`，忘了編碼器模式 3 每一格是 4 個計數。在模擬器可以看到原始計數：把 U1 PB13（板上 B13）的空孔 `j11` 接到 GND 再按「重置 MCU」，韌體會印出每一個 `cnt`',
      fix: '位置 = `(int16_t)CNT ÷ 4`，只在計數是 4 的倍數時更新；做完實驗把 `j11` 的接地線拆掉並重置',
      match: { checks: [4] },
    },
    {
      symptom: '按下旋鈕沒有 `SW pressed`，旋轉卻正常',
      cause: 'SW 沒有接到 U1 PB12（板上 B12）。另一個常見的原因是自己的韌體忘了開內部上拉：KY-040 的 SW 沒有上拉電阻，放開時腳位浮接，讀到的值不固定',
      fix: 'SW（`j42`）接 `j10`，並把 PB12 設成 `GPIO_PULLUP`',
      match: { checks: [2], passes: [0, 1] },
    },
    {
      symptom: '終端機只有開機訊息與 `pos=0`，轉動或按下旋鈕都沒有反應',
      cause: 'CLK、DT、SW 都還沒接到 Blue Pill：計時器的兩個輸入通道與 PB12 都只有內部的上拉或浮接，看不到任何邊緣',
      fix: '依步驟 1、2 接上 `j40` → `j23`、`j41` → `j24`、`j42` → `j10`',
      match: { checks: [0, 1, 2] },
    },
  ],
  acceptance: [
    wired('ENC1', 'CLK', pin('PB6'), 'ENC1 CLK 接到 U1 PB6（板上 B6，TIM4_CH1）'),
    wired('ENC1', 'DT', pin('PB7'), 'ENC1 DT 接到 U1 PB7（板上 B7，TIM4_CH2）'),
    wired('ENC1', 'SW', pin('PB12'), 'ENC1 SW 接到 U1 PB12（板上 B12）'),
    {
      kind: 'all',
      label: 'ENC1 的 + 接 3.3 V、GND 接 GND',
      checks: [wired('ENC1', 'VCC', pin('3V3_2')), wired('ENC1', 'GND', GND)],
    },
    { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13（板上 B13）沒有接地（不印原始計數）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a6-encoder 韌體' },
    {
      kind: 'all',
      label: 'TIM4 編碼器模式啟動，位置從 0 開始',
      checks: [
        { kind: 'uart-contains', component: 'U1', port: 'USART1', text: BOOT, seconds: 0.1 },
        { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'pos=0', seconds: 0.1 },
      ],
    },
    {
      kind: 'firmware-checks',
      project: FW,
      label: '韌體行為合約：正轉一格印「pos=1」、反轉一格印「pos=-1」、半格不計、2 µs 突波被濾掉、按鍵去彈跳',
    },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
    {
      kind: 'all',
      label: '計數跟著旋鈕走：「位置」0 → 5 印到「pos=5」，再轉回 2 印到「pos=2」',
      checks: [
        TURN_TO_5,
        {
          kind: 'uart-contains',
          component: 'U1',
          port: 'USART1',
          text: 'pos=2',
          seconds: 0.9,
          stimulus: [{ at: 0.5, component: 'ENC1', param: 'position', value: 2 }],
          label: '「位置」改回 2：往下數到「pos=2」',
        },
      ],
    },
    {
      kind: 'all',
      label: '按下再放開旋鈕：去彈跳後印出「SW pressed」與「SW released」',
      checks: [
        {
          kind: 'uart-contains',
          component: 'U1',
          port: 'USART1',
          text: 'SW pressed',
          seconds: 1.0,
          stimulus: [{ at: 0.9, component: 'ENC1', param: 'pressed', value: true }],
          label: '按下：約 20 ms 後印出「SW pressed」',
        },
        {
          kind: 'uart-contains',
          component: 'U1',
          port: 'USART1',
          text: 'SW released',
          seconds: 1.1,
          stimulus: [{ at: 1.0, component: 'ENC1', param: 'pressed', value: false }],
          label: '放開：約 20 ms 後印出「SW released」',
        },
      ],
    },
  ],
  steps: [
    {
      id: 'wire-ab',
      title: '接上 CLK 與 DT：TIM4 的兩個通道',
      body: doc(
        '按下方的「開始接線」，接 `j40`（ENC1 CLK）→ `j23`（U1 PB6（板上 B6）），再接 `j41`（ENC1 DT）→ `j24`（U1 PB7（板上 B7））。',
        'PB6、PB7 是 TIM4 的 CH1、CH2。韌體把它們設成浮接輸入（模組已有 10 kΩ 上拉），計時器設成編碼器模式 3，濾波器 IC1F = IC2F = 15。',
      ),
      highlight: { holes: ['j40', TAP.PB6, 'j41', TAP.PB7], components: ['ENC1', 'U1'] },
      check: { kind: 'all', checks: [wired('ENC1', 'CLK', pin('PB6')), wired('ENC1', 'DT', pin('PB7'))], label: 'CLK 接 U1 PB6、DT 接 U1 PB7' },
    },
    {
      id: 'wire-sw',
      title: '接上按鍵 SW',
      body: doc(
        '按下方的「開始接線」，接 `j42`（ENC1 SW）→ `j10`（U1 PB12（板上 B12））。',
        '按下旋鈕時 SW 接到 GND。KY-040 的 SW 沒有上拉電阻，所以韌體打開 PB12 的內部上拉（約 40 kΩ）：放開時讀到 1，按下時讀到 0。',
      ),
      highlight: { holes: ['j42', TAP.PB12], components: ['ENC1', 'U1'] },
      check: { ...wired('ENC1', 'SW', pin('PB12')), label: 'SW 接 U1 PB12' },
    },
    {
      id: 'turn',
      title: '執行並轉動旋鈕',
      body: doc(
        '按上方的「▶ 執行模擬」{滑鼠：（或空白鍵）｜觸控：}，打開「UART 終端機」：開機印出 `pos=0`。接著點 ENC1，在屬性面板把「位置」改成 **5**：約每 50 ms 一行，`pos=1`～`pos=5`。再改成 2，看到 `pos=4`、`pos=3`、`pos=2`。',
        '打開「保持按下」再關掉（或在麵包板上按住旋鈕再放開）：約 20 ms 後各出現 `SW pressed`、`SW released`。計數完全由 TIM4 的硬體完成，主迴圈每 1 ms 醒來讀一次 `CNT`。',
      ),
      highlight: { components: ['ENC1'] },
      // the check turns the knob itself (0 → 5), whatever the learner did on the live board
      check: TURN_TO_5,
      action: { kind: 'run' },
    },
    {
      id: 'quadrature',
      title: '用邏輯分析儀看正交訊號',
      body: doc(
        '按下方的「把 PB6、PB7 加到邏輯分析儀」，再把 ENC1 的「位置」加 1：順時針時 U1 PB6（CLK）先下降，約 12.5 ms 後 PB7（DT）下降，再依序上升——一格 50 ms 被分成 4 段，每個邊緣計數一次。',
        '把「位置」減 1 比較：這次是 DT 先下降。計時器就是靠「誰先動」決定往上數或往下數。',
      ),
      highlight: { components: ['ENC1', 'U1'] },
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PB6', 'PB7'] }, { kind: 'run' }],
    },
    {
      id: 'raw',
      title: '實驗：一格有 4 個計數',
      body: doc(
        '按下方的「開始接線」，從 `j11`（U1 PB13（板上 B13）的空孔）接到 `bot-8`，按下方的「重置 MCU」，再把 ENC1 的「位置」加 1：終端機依序印出 `cnt=1`、`cnt=2`、`cnt=3`、`cnt=4`，最後才是 `pos=1`。',
        '這就是忘了除以 4 時會看到的「轉一格跳 4」。做完實驗**把這條線拆掉，再按一次「重置 MCU」**，驗收條件要求 U1 PB13 不接地。',
      ),
      highlight: { holes: [TAP.PB13, 'bot-8'] },
      check: { kind: 'not-connected', a: pin('PB13'), b: GND, label: 'U1 PB13 沒有接地' },
      action: [{ kind: 'wire', wires: [[TAP.PB13, 'bot-8']] }, { kind: 'reset', scope: 'mcu' }, { kind: 'run' }],
    },
    {
      id: 'filter',
      title: '輸入濾波器與去彈跳：用行為合約驗證',
      body: doc(
        '按「檢查此步驟」：韌體行為合約在 `lesson-a6-encoder` 自己的測試台上，直接驅動 PB6、PB7、PB12 的電壓，檢查正轉一格印 `pos=1`、反轉一格印 `pos=-1`、只轉半格不印、**2 µs 的突波被濾波器擋掉**，以及會彈跳的按鍵只算一次。',
        '為什麼要用合約？模擬器的 KY-040 是理想接點，旋鈕怎麼轉都不會彈跳；實際的 EC11 接點會彈跳好幾毫秒，所以濾波器與去彈跳一定要做。「計數跟著旋鈕走」則由驗收自己轉動旋鈕確認：它把 ENC1 的「位置」從 0 改成 5、再改回 2，並按下、放開旋鈕，檢查終端機的每一行。',
      ),
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-checks', project: FW, label: 'lesson-a6-encoder 行為合約' },
    },
  ],
  runnable: 'partial',
  runnableNote:
    'KY-040 模型是理想接點，旋轉與按下時都不會產生接點彈跳，所以在旋鈕上看不到輸入濾波器（IC1F = 15）與按鍵去彈跳擋掉了什麼；這兩項改由韌體行為合約以 2 µs 與 0.3 ms 的刺激脈衝在模擬中驗證。旋轉計數與按鍵本身是真實模擬：驗收會自己把 ENC1 的「位置」從 0 改成 5、再改回 2，並按下、放開旋鈕，確認終端機的計數與訊息跟著走。',
  requires: { parts: ['stm32_bluepill', 'power_supply', 'ky040_encoder'], firmware: [FW], instrument: 'uart' },
  durationMin: 35,
}
