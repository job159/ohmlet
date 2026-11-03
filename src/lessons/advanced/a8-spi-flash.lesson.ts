/**
 * a8 — STM32 + W25Q32 SPI Flash：JEDEC ID、扇區抹除、頁寫入、讀回，以及 BUSY 查詢。
 *
 * Firmware: firmware/dist/hal-w25q (ST HAL, SPI1 master mode 0 at 9 MHz:
 * PA5 SCK, PA6 MISO, PA7 MOSI, PA4 = CS by GPIO): 9Fh JEDEC ID, status
 * register 1, 16 bytes at 0x001000 before, 06h + 20h sector erase with
 * BUSY polled every millisecond, 06h + 02h page program of 64 bytes
 * (i × 3 + 1) with BUSY polled, read back with 03h and 0Bh, 'w25q ok'.
 * The mistake firmware lesson-a8-nobusy is the same program without the two
 * BUSY waits: the program lands inside the 45 ms erase and is ignored, the
 * page reads FF. The W25Q32 breakout (FL1 at e40: CS DO WP GND DI CLK HOLD
 * VCC = e40…e47, the PCB lies over rows e–j) is reached from rows a–d.
 * Every line and number below is what the simulation prints
 * (tests/lessons/advanced.test.ts).
 */
import type { Lesson, LessonCheck } from '../types'
import { GND, TAP, V33, anchored, bench, bullets, doc, pin, wire, wired } from './bench'

const FW = 'hal-w25q'
const NOBUSY = 'lesson-a8-nobusy'

const FL1 = anchored('FL1', 'w25q32_flash', 'e40')

const POWER = [
  wire('W7', 'a42', 'top+34', 'red'), // /WP high
  wire('W8', 'a43', 'top-34', 'black'), // GND
  wire('W9', 'a46', 'top+37', 'red'), // /HOLD high
  wire('W10', 'a47', 'top+38', 'red'), // VCC 3.3 V
]

const START = bench('a8 W25Q32 SPI 快閃記憶體（起始）', [FL1], POWER)

const SOLUTION = bench(
  'a8 W25Q32 SPI 快閃記憶體（解答）',
  [FL1],
  [
    ...POWER,
    wire('W11', 'd40', TAP.PA4, 'green'), // CS ← PA4 (GPIO)
    wire('W12', 'd45', TAP.PA5, 'yellow'), // CLK ← PA5 SPI1_SCK
    wire('W13', 'd41', TAP.PA6, 'white'), // DO → PA6 SPI1_MISO
    wire('W14', 'd44', TAP.PA7, 'blue'), // DI ← PA7 SPI1_MOSI
  ],
)

const DATA: LessonCheck[] = [wired('FL1', 'DO', pin('PA6')), wired('FL1', 'DI', pin('PA7'))]
const SUPPLY: LessonCheck[] = [
  wired('FL1', 'VCC', V33),
  wired('FL1', 'WP', V33),
  wired('FL1', 'HOLD', V33),
  wired('FL1', 'GND', GND),
]

export const LESSON: Lesson = {
  id: 'a8-spi-flash',
  level: 'advanced',
  order: 8,
  title: 'STM32 + W25Q32 SPI 快閃記憶體：抹除、寫入與 BUSY 查詢',
  summary:
    '把 4 MB 的 W25Q32 NOR 快閃記憶體（FL1）接到 SPI1，執行真正的 HAL 韌體：讀晶片識別碼（`9Fh` 回應 EF 40 16）、抹除一個 4 KiB 扇區並查詢 BUSY 約 46 ms、寫入一頁 64 個位元組、再用兩種讀取指令讀回比對。最後換上「忘了等 BUSY」的韌體，親眼看寫入的資料憑空消失。',
  objectives: [
    '接好 SPI 模式 0 的四條線：SCK、MOSI → DI、DO → MISO、CS（低電位選取），並知道 /WP、/HOLD 要接到 VCC',
    '解讀 JEDEC ID 9Fh 的回應 EF 40 16：製造商華邦電子、記憶體類型、容量 2²² 位元組 = 4 MiB',
    '說明 NOR 快閃記憶體的寫入規則：寫入只能把 1 變成 0，所以要先抹除（整個 4 KiB 扇區變回 FF），再以最多 256 位元組的頁寫入',
    '每次抹除或寫入前先送寫入致能（06h），之後反覆讀狀態暫存器 1（05h）直到 BUSY（位元 0）清除',
    '說明晶片 BUSY 時會忽略讀取狀態以外的所有指令：不等待就送下一個命令，資料就消失了',
  ],
  wiring: doc(
    '電源與 Blue Pill（U1）已經接好：上方 + 電源軌（top+）是 3.3 V，− 電源軌是 GND。W25Q32 模組（FL1）插在 `e40`，排針由左到右是 **CS、DO、WP、GND、DI、CLK、HOLD、VCC**（`e40`～`e47`），模組板子蓋住 e～j 列，請從同一欄的 **a～d 列**拉線。',
    '已經接好：VCC（`a47`）、/WP（`a42`）、/HOLD（`a46`）接 3.3 V，GND（`a43`）接 GND。W25Q32 **只能用 3.3 V**（最高 3.6 V）。',
    '你要接 SPI1 的四條線：',
    bullets(
      'CS：`d40` → `a21`（U1 PA4（板上 A4），一般 GPIO，閒置時高電位）',
      'CLK：`d45` → `a20`（U1 PA5（板上 A5），SPI1_SCK）',
      'DO：`d41` → `a19`（U1 PA6（板上 A6），SPI1_MISO：快閃記憶體送出、MCU 接收）',
      'DI：`d44` → `a18`（U1 PA7（板上 A7），SPI1_MOSI：MCU 送出、快閃記憶體接收）',
    ),
    '韌體 `hal-w25q` 已經選好，USART1（U1 PA9（板上 A9），115200 8N1）的報告在「UART 終端機」。',
  ),
  theory: doc(
    '**SPI 模式 0**：SCK 閒置時是低電位（CPOL = 0），資料在 SCK 的上升緣取樣（CPHA = 0），高位元先送。SPI1 掛在 APB2（72 MHz），除以 8 得到 **9 MHz** 的 SCK。主機每送出一個位元組，同時也收到一個位元組；要讀資料時，主機送出任意的位元組（HAL 送 0）把資料「換」回來。CS 由韌體用 GPIO 控制：拉低開始一個指令，拉高結束。',
    '**JEDEC ID（9Fh）**：送出 9Fh 之後再讀 3 個位元組：**EF**（製造商華邦電子）、**40**（記憶體類型）、**16**（容量代碼，2²² = 4 194 304 位元組 = 4 MiB = 32 Mbit）。讀到 FF FF FF 表示 MISO 一直是高電位——沒有晶片在回應（CS 沒接、MISO／MOSI 接反、沒供電）。',
    '**NOR 快閃記憶體的寫入規則**：',
    bullets(
      '抹除把位元變成 1：最小單位是 4 KiB 的扇區（20h），約 45 ms；64 KiB 區塊（D8h）約 150 ms；整顆晶片（C7h）約 10 s',
      '頁寫入（02h）只能把 1 變成 0，一次最多一頁 256 位元組，約 0.4 ms；超過頁尾會繞回同一頁的開頭',
      '每次抹除或寫入之前都要送**寫入致能 06h**（設定狀態暫存器的 WEL 位元），否則晶片直接忽略',
    ),
    '**BUSY 查詢**：抹除與寫入在晶片內部進行，期間狀態暫存器 1 的位元 0（BUSY）為 1。這段時間晶片**忽略讀取狀態（05h）以外的所有指令**。韌體在抹除後每 1 ms 讀一次 05h，量到 **46 ms**；寫入 64 個位元組後不延遲地連續讀，約 **39 次**（每次約 10 µs）BUSY 才清除。',
    '**讀回**：03h（一般讀取）送 3 個位址位元組後就開始輸出資料；0Bh（快速讀取）多送一個空位元組，讓晶片在高時脈下有時間準備。兩種讀法都要讀到寫入的 01 04 07 0A …（i × 3 + 1）才算成功。快閃記憶體的內容在斷電後保留：重置 MCU 之後再跑一次，`before:` 就會印出上一次寫入的資料。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART（全新、已抹除的晶片）：`W25Q32 test (SPI1 9 MHz mode 0, CS PA4)`、`JEDEC ID EF 40 16`、`SR1 0x00`、`before: FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF`',
    '約 0.062 s：`sector erase: busy 46 ms`（典型的扇區抹除時間 45 ms）',
    '約 0.067 s：`page program 64 bytes: busy for 39 status reads`，接著 `read back ok`、`w25q ok`（約 0.069 s）',
    '邏輯分析儀：SCK（U1 PA5）9 MHz；抹除期間每 1 ms 一次 CS 拉低、送出 05h 讀狀態',
    '按「重置 MCU」再跑一次：`before: 01 04 07 0A 0D 10 13 16 19 1C 1F 22 25 28 2B 2E`（資料保留在快閃記憶體裡）',
    '換成 `lesson-a8-nobusy`：`sector erase: sent, BUSY not polled`、`page program 64 bytes: sent, BUSY not polled`、`mismatch at 0x001000: wrote 01 read FF`、`w25q FAILED`',
  ],
  // acceptance indices: 0 CS · 1 CLK · 2 DO/DI · 3 supply · 4 firmware · 5 JEDEC · 6 erase · 7 read back · 8 w25q ok · 9 contract · 10 ERC
  mistakes: [
    {
      symptom: '晶片識別碼正確，讀回的資料卻全是 FF，終端機回報測試失敗',
      cause:
        '終端機印出 `mismatch at 0x001000: wrote 01 read FF` 與 `w25q FAILED`——沒有等 BUSY：送出扇區抹除後立刻送寫入致能與頁寫入，晶片還在抹除（約 45 ms），把這些指令全部忽略，讀回的是抹除後的 FF。按下方的「重現這個錯誤：載入 `lesson-a8-nobusy`」即可重現',
      fix: '每次抹除或寫入之後反覆讀 05h，直到 BUSY（位元 0）為 0，才送下一個指令；重現完記得換回原本的韌體',
      match: { checks: [7], passes: [5] },
    },
    {
      symptom: '終端機印出 `no W25Q32: JEDEC ID FF FF FF`，之後就停了',
      cause: 'DO 與 DI 接反：MCU 的 MOSI 送到了快閃記憶體的 DO（輸出腳），快閃記憶體收不到 9Fh，也就不回應；MISO 只靠內部上拉讀到 FF',
      fix: '快閃記憶體的 DO（`d41`）接 MISO（U1 PA6），DI（`d44`）接 MOSI（U1 PA7）——「出」接「入」',
      match: { checks: [2], passes: [0, 1] },
    },
    {
      symptom: '終端機印出 `no W25Q32: JEDEC ID FF FF FF`，資料線看起來都對',
      cause: 'CS 沒有接到 U1 PA4（板上 A4）：晶片從來沒有被選取，DO 一直是高阻抗，MISO 被內部上拉讀成 FF',
      fix: 'CS（`d40`）接 `a21`（PA4）。CS 是低電位選取，每個指令都要先拉低、結束後拉高',
      match: { checks: [0], passes: [1, 2] },
    },
    {
      symptom: '電氣規則檢查指出 FL1 的供電超過額定，而且 MISO 被推到 5 V',
      cause: 'W25Q32 的 VCC 接到了 5 V：這顆晶片最高只能 3.6 V，它的 DO 也會輸出 5 V，而 U1 PA6 不耐 5 V',
      fix: 'VCC（`a47`）接 3.3 V（上方 + 電源軌）',
      match: { checks: [3], ercRules: ['supply-range'] },
    },
    {
      symptom: '自己寫的程式讀回全是 FF，抹除卻好像有作用',
      cause: '頁寫入之前忘了送寫入致能 06h：WEL 位元是 0，晶片忽略 02h；每次抹除或寫入完成後 WEL 會自動清除，所以每一次都要重新送',
      fix: '每個 20h、D8h、C7h、02h 之前都先送 06h，必要時讀 05h 確認 WEL（位元 1）為 1',
    },
    {
      symptom: '終端機印出 `no W25Q32: JEDEC ID FF FF FF`，之後就停了（剛開始做本課時就是這樣）',
      cause: 'SPI 的四條線（CS、CLK、DO、DI）還沒有全部接好：快閃記憶體沒有被選取或收不到指令，MISO 只靠內部上拉讀到 FF',
      fix: '依步驟 1 接好 `d40` → `a21`、`d45` → `a20`、`d41` → `a19`、`d44` → `a18`，再按「重置 MCU」或重新執行',
      match: { checks: [5], passes: [3, 4] },
    },
  ],
  acceptance: [
    wired('FL1', 'CS', pin('PA4'), 'FL1 CS 接到 U1 PA4（板上 A4）'),
    wired('FL1', 'CLK', pin('PA5'), 'FL1 CLK 接到 U1 PA5（板上 A5，SPI1_SCK）'),
    { kind: 'all', checks: DATA, label: 'FL1 DO 接 U1 PA6（板上 A6，MISO）、DI 接 U1 PA7（板上 A7，MOSI）' },
    { kind: 'all', checks: SUPPLY, label: 'FL1 的 VCC、/WP、/HOLD 接 3.3 V，GND 接 GND' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 hal-w25q 韌體' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'JEDEC ID EF 40 16', seconds: 0.1, label: '讀到 JEDEC ID EF 40 16（華邦電子、4 MiB）' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'sector erase: busy ', seconds: 0.15, label: '扇區抹除，查詢 BUSY 直到完成' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'read back ok', seconds: 0.15, label: '64 個位元組寫入後以 03h 與 0Bh 讀回一致' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'w25q ok', seconds: 0.15, label: '整個測試通過' },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（腳位、沒有晶片時的開機訊息）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'spi',
      title: '接上 SPI1 的四條線',
      body: doc(
        '按下方的「開始接線」，依序接 `d40` → `a21`（CS → U1 PA4）、`d45` → `a20`（CLK → U1 PA5）、`d41` → `a19`（DO → U1 PA6）、`d44` → `a18`（DI → U1 PA7）。',
        '記法：快閃記憶體的 DO（資料輸出）接 MCU 的 MISO（主機輸入），快閃記憶體的 DI 接 MOSI。CS 不用 SPI 的硬體 NSS，而是一般的 GPIO，由韌體控制每個指令的開始與結束。',
      ),
      highlight: { holes: ['d40', TAP.PA4, 'd45', TAP.PA5, 'd41', TAP.PA6, 'd44', TAP.PA7], components: ['FL1', 'U1'] },
      check: {
        kind: 'all',
        checks: [wired('FL1', 'CS', pin('PA4')), wired('FL1', 'CLK', pin('PA5')), ...DATA],
        label: 'CS、CLK、DO、DI 都接好',
      },
    },
    {
      id: 'jedec',
      title: '執行：讀 JEDEC ID',
      body: doc(
        '模擬會自動執行，打開「UART 終端機」：`JEDEC ID EF 40 16`、`SR1 0x00`、`before: FF FF …`。',
        '韌體拉低 CS、送出 9Fh，再送 3 個位元組把 EF、40、16 換回來，最後拉高 CS。EF 是華邦電子，16 代表 2²² 位元組 = 4 MiB。新的快閃記憶體每個位元組都是 FF（已抹除）。',
      ),
      highlight: { components: ['FL1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'JEDEC ID EF 40 16', seconds: 0.1 },
    },
    {
      id: 'erase',
      title: '扇區抹除與 BUSY 查詢',
      body: doc(
        '看終端機：`sector erase: busy 46 ms`。韌體送 06h（寫入致能）與 20h 00 10 00（抹除位址 0x001000 所在的 4 KiB 扇區），接著每 1 ms 讀一次狀態暫存器 05h，直到 BUSY 變成 0。',
        '這 46 ms 裡晶片只理會 05h，其他指令一律忽略。如果用 `HAL_Delay(50)` 代替查詢，在較慢的晶片上（最長 400 ms）就會出錯——查詢 BUSY 才是可靠的做法。',
      ),
      highlight: { components: ['FL1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'sector erase: busy ', seconds: 0.15 },
    },
    {
      id: 'program',
      title: '頁寫入與讀回',
      body: doc(
        '接著是 `page program 64 bytes: busy for 39 status reads`、`read back ok`、`w25q ok`。韌體再送一次 06h，然後 02h 加 3 個位址位元組與 64 個資料（01 04 07 0A …），寫入約 0.4 ms，連續讀 05h 約 39 次才完成；最後用 03h 與 0Bh 各讀一次比對。',
        '按下方的「重置 MCU」讓程式再跑一次：`before:` 變成 `01 04 07 0A 0D 10 13 16 19 1C 1F 22 25 28 2B 2E`——快閃記憶體是非揮發性記憶體，資料一直在。',
      ),
      highlight: { components: ['FL1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'w25q ok', seconds: 0.15 },
      action: [{ kind: 'run' }, { kind: 'reset', scope: 'mcu' }],
    },
    {
      id: 'analyzer',
      title: '用邏輯分析儀看 SPI 指令',
      body: doc(
        '按下方的「把 PA4、PA5、PA6、PA7 加到邏輯分析儀」：CS（PA4）每拉低一次就是一個指令。放大第一個：SCK（PA5）9 MHz，MOSI（PA7）送出 9F，MISO（PA6）在接下來的 24 個時脈換回 EF 40 16。',
        '抹除期間每 1 ms 有一個很短的 CS 脈波——那就是 05h 的 BUSY 查詢，總共約 46 次。',
      ),
      highlight: { components: ['U1', 'FL1'] },
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PA4', 'PA5', 'PA6', 'PA7'] }, { kind: 'run' }],
    },
    {
      id: 'nobusy',
      title: '實驗：忘了等 BUSY',
      body: doc(
        '按下方的「載入 lesson-a8-nobusy 到 U1」再執行：`sector erase: sent, BUSY not polled`、`page program 64 bytes: sent, BUSY not polled`、`mismatch at 0x001000: wrote 01 read FF`、`w25q FAILED`。',
        '頁寫入在抹除進行中就送出，被晶片忽略了；讀回的是抹除後的 FF。按「換回 hal-w25q」再執行一次，`before:` 也是 FF——那次寫入真的不見了。然後到「驗收」按「檢查我的電路」。',
      ),
      highlight: { components: ['U1', 'FL1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 hal-w25q' },
      action: [{ kind: 'load-firmware', component: 'U1', project: NOBUSY }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: { parts: ['stm32_bluepill', 'power_supply', 'w25q32_flash'], firmware: [FW, NOBUSY], instrument: 'uart' },
  durationMin: 40,
}
