/**
 * a2 — STM32 + SSD1306 OLED：畫面緩衝區、初始化序列與充電幫浦。
 *
 * Firmware: firmware/dist/lesson-a2-oled (ST HAL, I2C1 PB6/PB7 400 kHz):
 * a 1 KiB frame buffer redrawn every 200 ms and written to GDDRAM with one
 * 1026-byte transfer; PB12 tied to GND at reset leaves the charge-pump
 * command 8Dh 14h out of the init sequence. The OLED module (ssd1306_i2c,
 * header GND VCC SCL SDA in row j, the PCB lies over the front edge) sits at
 * j40, its pins are reached from rows f–i of the same strips. Numbers are
 * what the simulation produces (tests/lessons/advanced.test.ts also reads
 * the panel's own telemetry: display on, the same lit-pixel count).
 */
import type { Lesson } from '../types'
import { GND, TAP, V5, anchored, bench, bullets, doc, pin, wire, wired } from './bench'

const FW = 'lesson-a2-oled'

const OLED = anchored('OLED', 'ssd1306_i2c', 'j40')

const START = bench('a2 SSD1306 OLED（起始）', [OLED], [])

const SOLUTION = bench(
  'a2 SSD1306 OLED（解答）',
  [OLED],
  [
    wire('W7', 'f40', 'bot-31', 'black'), // GND
    wire('W8', 'f41', 'bot+32', 'red'), // VCC → 5 V (module LDO → 3.3 V)
    wire('W9', 'g42', 'j23', 'yellow'), // SCL → PB6
    wire('W10', 'g43', 'j24', 'blue'), // SDA → PB7
  ],
)

const READY = 'SSD1306 at 0x3C ready (charge pump on)'

export const LESSON: Lesson = {
  id: 'a2-ssd1306',
  level: 'advanced',
  order: 2,
  title: 'STM32 + SSD1306 OLED：畫面緩衝區與充電幫浦',
  summary:
    '把 0.96 吋 128×64 OLED 模組接到 I2C1，執行真正的 HAL 韌體：在 RAM 裡維護 1 KiB 的畫面緩衝區（8 頁 × 128 欄），每 200 ms 重畫一次並以 400 kHz 一次寫入 1024 個位元組；再用實驗跳線重現最經典的陷阱——初始化少了充電幫浦命令 8Dh 14h，每個位元組都有 ACK，螢幕卻一片黑。',
  objectives: [
    '說明 SSD1306 的顯示記憶體（GDDRAM）結構：8 頁 × 128 欄，每個位元組是直立的 8 個像素，位元 0 在最上面',
    '用 `fb[(y >> 3) * 128 + x] |= 1 << (y & 7)` 在畫面緩衝區畫點，理解為什麼要先在 RAM 畫好再整片送出',
    '分辨 I²C 控制位元組：00h 之後是命令串、40h 之後是顯示資料',
    '說明充電幫浦（8Dh 14h）的作用：模組沒有外接 7～15 V 的面板電壓，必須由晶片內部升壓，少了它面板不會發光',
    '估算傳輸時間：400 kHz 下一個位元組 9 個時脈 = 22.5 µs，1034 個位元組約 23.3 ms，並與韌體量到的時間比對',
  ],
  wiring: doc(
    'Blue Pill（U1）與電源已經接好：下方 + 軌（bot+）是 5 V，上方 + 軌（top+）是 Blue Pill 的 3.3 V，兩條 − 軌都是 GND。OLED 模組（OLED）插在 `j40`，排針由左到右是 **GND、VCC、SCL、SDA**（`j40`～`j43`），模組本體平躺在麵包板前緣外面，所以請從同一欄的 f～i 列拉線：',
    bullets(
      'GND：`f40`（f 列第 40 欄）→ `bot-31`（下方 − 電源軌第 31 孔）。',
      'VCC：`f41` → `bot+32`（5 V）。模組上有 662K 3.3 V 穩壓器，SSD1306 的 VDD 與 SCL／SDA 上拉都在它的 3.3 V 上，所以 VCC 接 3.3～5 V 都可以。',
      'SCL：`g42` → `j23`（**U1 PB6（板上 B6）** = I2C1_SCL）。',
      'SDA：`g43` → `j24`（**U1 PB7（板上 B7）** = I2C1_SDA）。',
    ),
    '模組本身已有 SCL、SDA 各一顆 4.7 kΩ 上拉電阻，不需另外加。位址是 **0x3C**（模組背面的跳線可改成 0x3D）。韌體 `lesson-a2-oled` 已經選好，USART1（U1 PA9（板上 A9），115200 8N1）的報告可以在「UART 終端機」看到。',
  ),
  theory: doc(
    '**顯示記憶體的形狀**：SSD1306 有 128 × 64 = 8192 個像素，存在 1024 個位元組的 GDDRAM 裡。螢幕被橫切成 8 個「頁」（`page`），每頁 8 列高；一個位元組對應某一頁、某一欄的 **直立 8 個像素**，位元 0 在最上面。所以像素 (x, y) 位於第 `y >> 3` 頁、第 x 欄、第 `y & 7` 個位元。',
    '**為什麼需要畫面緩衝區**：I²C 介面只能寫、不能讀回 GDDRAM。要在已有的畫面上多畫一個點，必須知道那個位元組其他 7 個位元原本是什麼——所以韌體在 RAM 裡保留一份完整的 1 KiB 影像（Blue Pill 20 KiB SRAM 的 5 %），先在 RAM 裡清除、畫框、寫字、畫圓，再整片送出。',
    '**I²C 上的格式**：每次傳輸是 START → 0x78（0x3C << 1，寫入）→ **控制位元組** → 資料 → STOP。控制位元組 00h 表示後面全是命令，40h 表示後面全是要寫進 GDDRAM 的顯示資料。韌體的 `HAL_I2C_Mem_Write(&hi2c1, 0x78, 0x40, …, fb, 1024, …)` 正是把 40h 當成「記憶體位址」送出。',
    '**初始化序列**（一次傳輸，控制位元組 00h）：',
    bullets(
      'AEh 關閉顯示；D5h 80h 時脈；A8h 3Fh 多工比 64；D3h 00h 顯示偏移；40h 起始列 0',
      '**8Dh 14h 開啟充電幫浦**',
      '20h 00h 水平定址（寫滿一頁自動跳到下一頁）；A1h、C8h 左右／上下翻轉成模組的正確方向；DAh 12h 128×64 面板的 COM 接法',
      '81h CFh 對比；D9h F1h 預充電；DBh 40h VCOMH；A4h 顯示跟隨 RAM；A6h 正常（不反白）；2Eh 停止捲動；**AFh 開啟顯示**',
    ),
    '**充電幫浦**：OLED 面板發光需要 7～15 V 的 VCC。便宜的模組只有 3.3 V，靠 SSD1306 內建的充電幫浦（電容倍壓電路）把 3.3 V 升到約 7.5 V。重置後充電幫浦是**關閉**的；如果初始化漏掉 8Dh 14h，AFh 照樣被接受、每個位元組都有 ACK、GDDRAM 也寫得進去，但面板沒有高壓——螢幕一片黑。這是 SSD1306 最常見的「程式看起來都對」的故障。',
    '**傳輸時間**：400 kHz 快速模式（PCLK1 36 MHz，DUTY 2，CCR 30 → SCL 週期 3 × 30 ÷ 36 MHz = 2.5 µs）。一個位元組加 ACK 是 9 個時脈 = 22.5 µs。一個畫格送兩次：視窗命令（位址 + 控制 + 6 個位元組 = 8 個）與畫面（位址 + 40h + 1024 = 1026 個），共 1034 × 22.5 µs ≈ **23.3 ms**。韌體用 DWT 週期計數器量到 23275 µs。若改用 100 kHz 就要約 93 ms，每秒最多只能更新約 10 次。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART：`SSD1306 lesson a2 (I2C1 400 kHz, PB6 SCL / PB7 SDA)`，約 0.1 s 後 `SSD1306 at 0x3C ready (charge pump on)`',
    '第 1 個畫格：`frame 1: 1024 B in 23275 us, 860 px lit`（理論值 1034 × 22.5 µs ≈ 23.3 ms）',
    '約 0.93 s：`frame 5: 899 px lit`；之後每 5 個畫格（1 s）回報一次，進度條每畫格長 1 px',
    'OLED 顯示外框、`STM32 + SSD1306`、`frame N`、進度條與圓形；每 200 ms 更新一次',
    '邏輯分析儀接 U1 PB6（板上 B6）：SCL 週期 2.5 µs（400 kHz），每 200 ms 出現約 23 ms 的連續傳輸',
  ],
  // `match` ties a mistake to the pass / fail pattern of the acceptance checks below
  // (0 OLED · 1 GND · 2 VCC · 3 SCL · 4 SDA · 5 PB12 open · 6 firmware · 7 ready · 8 frame 1
  // · 9 frame 5 · 10 contract · 11 ERC) — the check results show it as 「最可能的原因」.
  mistakes: [
    {
      symptom: 'UART 顯示 `ready`、每個位元組都有 ACK，OLED 卻完全不亮',
      cause:
        '初始化少了 8Dh 14h，充電幫浦沒有開啟，面板沒有發光所需的高壓。可在模擬器重現：把 U1 PB12（板上 B12）的空孔 `j10` 接到 GND，再用「更多」→「重置模擬」讓整個電路重新上電，韌體會省略這個命令並印出 `charge pump OFF: 8Dh 14h left out`',
      fix: '在 AFh 之前送 8Dh 14h；本課實驗完把 `j10` 的接地線拆掉，再「重置模擬」一次',
      match: { checks: [5] },
    },
    {
      symptom: 'UART 顯示 `SSD1306 not found at 0x3C (no ACK)`，模組有電、位址也對',
      cause: 'SCL、SDA 沒有接到 U1 PB6／PB7，或兩條線接反了（電氣規則檢查會提示「SDA 與 SCL 看起來接反」）：STM32 在 SDA 線上送出時脈，晶片把它當資料，永遠等不到正確的位址位元組',
      fix: '模組的 SCL（`g42`）接 U1 PB6（板上 B6）、SDA（`g43`）接 U1 PB7（板上 B7）',
      match: { checks: [3, 4], passes: [1, 2] },
    },
    {
      symptom: 'UART 顯示 `SSD1306 not found at 0x3C (no ACK)`',
      cause: '模組背面的位址跳線改成 0x3D（屬性面板的「I²C 位址」），或 VCC／GND 沒接，晶片不會在位址位元組之後回 ACK',
      fix: '確認 VCC、GND 接好，位址跳線與程式一致（0x3C ↔ 0x78、0x3D ↔ 0x7A）',
      match: { checks: [7], passes: [6] },
    },
    {
      symptom: '文字上下顛倒或左右相反',
      cause: 'A0h／A1h（左右）與 C0h／C8h（上下）設定與模組的面板方向不一致',
      fix: '一般 0.96 吋模組用 A1h + C8h；需要旋轉 180° 時改成 A0h + C0h',
    },
  ],
  acceptance: [
    { kind: 'has-part', type: 'ssd1306_i2c', label: '電路中有 SSD1306 OLED 模組' },
    wired('OLED', 'GND', GND, 'OLED 的 GND 接到 GND'),
    wired('OLED', 'VCC', V5, 'OLED 的 VCC 接到 5 V'),
    wired('OLED', 'SCL', pin('PB6'), 'OLED SCL 接到 U1 PB6（板上 B6，I2C1_SCL）'),
    wired('OLED', 'SDA', pin('PB7'), 'OLED SDA 接到 U1 PB7（板上 B7，I2C1_SDA）'),
    { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12（板上 B12）沒有接地（充電幫浦命令會送出）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a2-oled 韌體' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: READY, seconds: 0.5, label: 'OLED 回應位址 0x3C，充電幫浦已開啟' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'frame 1: 1024 B in ',
      seconds: 0.5,
      label: '第一個畫格的 1024 個位元組全部送出',
    },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'frame 5: ', seconds: 1.2, label: '畫面每 200 ms 持續更新' },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（腳位、開機訊息）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'power',
      title: '幫 OLED 模組供電',
      body: doc(
        '用「導線」工具接 `f40`（GND）→ `bot-31`（下方 − 電源軌第 31 孔），再接 `f41`（VCC）→ `bot+32`（下方 + 電源軌 = 5 V）。',
        'OLED 的排針在 `j40`～`j43`（GND、VCC、SCL、SDA），所以從同一欄的 f 列拉線。模組上的 662K 穩壓器把 5 V 降成 3.3 V 給 SSD1306，SCL／SDA 的 4.7 kΩ 上拉也接在 3.3 V，所以匯流排是 3.3 V 準位。',
      ),
      highlight: { holes: ['f40', 'f41', 'bot-31', 'bot+32'], components: ['OLED'] },
      check: { kind: 'all', checks: [wired('OLED', 'GND', GND), wired('OLED', 'VCC', V5)], label: 'OLED 的 GND 接 GND、VCC 接 5 V' },
    },
    {
      id: 'i2c',
      title: '接上 I²C：SCL → U1 PB6、SDA → U1 PB7',
      body: doc(
        '按下方的「開始接線」，接 `g42`（SCL）→ `j23`（U1 PB6（板上 B6）），再接 `g43`（SDA）→ `j24`（U1 PB7（板上 B7））。',
        'I2C1 的預設腳位是 PB6／PB7。腳位必須設成 `GPIO_MODE_AF_OD`（替代功能、開汲極）：STM32 只把線拉低，高電位交給模組上的上拉電阻。',
      ),
      highlight: { holes: ['g42', 'g43', 'j23', 'j24'], components: ['OLED', 'U1'] },
      check: {
        kind: 'all',
        checks: [wired('OLED', 'SCL', pin('PB6')), wired('OLED', 'SDA', pin('PB7'))],
        label: 'SCL 接 U1 PB6、SDA 接 U1 PB7',
      },
    },
    {
      id: 'run',
      title: '執行：初始化與第一個畫格',
      body: doc(
        '按上方的「▶ 執行模擬」（或空白鍵），打開儀器的「UART 終端機」，看到 `SSD1306 at 0x3C ready (charge pump on)`，螢幕亮起第一個畫格。',
        '韌體先等 100 ms 讓模組電源穩定，用 `HAL_I2C_IsDeviceReady()` 確認 0x3C 有 ACK，接著在一次傳輸裡送出控制位元組 00h 與 26 個命令位元組的初始化序列，然後畫第一個畫格並量傳輸時間：`frame 1: 1024 B in 23275 us, 860 px lit`。和理論值比較：1034 個位元組 × 9 個時脈 × 2.5 µs = 23.27 ms。',
      ),
      highlight: { components: ['U1', 'OLED'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: READY, seconds: 0.5 },
    },
    {
      id: 'framebuffer',
      title: '觀察畫面緩衝區',
      body: doc(
        '看 OLED 上的進度條與終端機：進度條每個畫格多 1 px，所以每 5 個畫格回報的亮點數會增加，例如 `frame 5: 899 px lit`。',
        'OLED 上的外框是 (0, 0)～(127, 63)，文字用 5×7 字型、每個字元前進 6 px。每 200 ms 韌體把 1024 個位元組清成 0、重新畫、再整片送出。',
        '想一想：如果只想改進度條那一小塊，可以用 21h／22h 把視窗縮小到第 5～6 頁、第 8～73 欄，只送 2 × 66 = 132 個位元組，傳輸時間就從 23 ms 降到約 3 ms。',
      ),
      highlight: { components: ['OLED'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'frame 5: ', seconds: 1.2 },
    },
    {
      id: 'charge-pump',
      title: '實驗：拿掉充電幫浦命令',
      body: doc(
        '按下方的「開始接線」，接 `j10`（U1 PB12（板上 B12）的空孔）→ `bot-6`，再按下方的「重置模擬」讓整個電路重新上電：UART 依然顯示 `ready (charge pump OFF: 8Dh 14h left out)`，**螢幕卻全黑**。做完實驗後**把這條線拆掉，再按一次「重置模擬」**，驗收條件要求 U1 PB12 不接地。',
        '只按「重置 MCU」看不到效果：SSD1306 沒有斷電，充電幫浦還保持上一次開啟的狀態——實際模組也一樣，所以這個錯誤常常要到冷開機才出現。',
        '韌體在開機時讀 U1 PB12：若它接地，就從初始化序列中**省略 8Dh 14h**。畫格照常送出——每個位元組都有 ACK，GDDRAM 裡的影像完全正確，但面板沒有 7.5 V 的驅動電壓。按下方的「把 PB6、PB7 加到邏輯分析儀」比較兩次的初始化傳輸：少了兩個位元組。',
      ),
      highlight: { holes: ['j10', 'bot-6'] },
      check: { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12 沒有接地' },
      action: [
        { kind: 'wire', wires: [[TAP.PB12, 'bot-6']] },
        { kind: 'reset', scope: 'circuit' },
        { kind: 'run' },
        { kind: 'add-logic', component: 'U1', pins: ['PB6', 'PB7'] },
      ],
    },
  ],
  runnable: 'ready',
  requires: { parts: ['ssd1306_i2c', 'stm32_bluepill', 'power_supply'], firmware: [FW], instrument: 'uart' },
  durationMin: 40,
}
