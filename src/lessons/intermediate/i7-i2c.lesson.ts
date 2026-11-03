/**
 * 中級 i7 — I²C：開汲極匯流排與上拉電阻、位址掃描、AT24C02 EEPROM 寫入／讀回。
 * Firmware: lesson-i7-i2c (firmware/projects/lesson-i7-i2c: I2C1 scan of
 * 0x08–0x77, then an 8-byte page write of the complement with ACK polling and
 * a verified read-back, reported on USART1). The missing pull-up symptom is
 * the same firmware on a bus without pull-ups ('bus busy at 0x08 …').
 */
import type { Lesson } from '../types'
import { anchored, benchLayout, leads, tap, type WireSpec } from './bench'

const PB6 = tap('PB6') // j23 — I2C1_SCL
const PB7 = tap('PB7') // j24 — I2C1_SDA

// AT24C02 DIP-8 at f40: A0 f40, A1 f41, A2 f42, GND f43 | SDA e43, SCL e42, WP e41, VCC e40
const eeprom = anchored('U2', 'at24c02', 'f40')
const powerWires: WireSpec[] = [
  ['a40', 'top+31', 'red'], // VCC → 3.3 V
  ['a41', 'top-32', 'black'], // WP → GND (writes allowed)
  ['j40', 'bot-31', 'black'], // A0 → GND
  ['j41', 'bot-32', 'black'], // A1 → GND
  ['j42', 'bot-33', 'black'], // A2 → GND  → address 1010 000 = 0x50
  ['j43', 'bot-34', 'black'], // GND
]
const pullups = [
  leads('R1', 'resistor', ['b42', 'top+33'], { resistance: 4700 }), // SCL pull-up
  leads('R2', 'resistor', ['b43', 'top+34'], { resistance: 4700 }), // SDA pull-up
]
const solutionWires: WireSpec[] = [
  ...powerWires,
  ['a42', PB6, 'yellow'], // SCL
  ['a43', PB7, 'blue'], // SDA
]

const pb6 = { component: 'U1', pin: 'PB6' } as const
const pb7 = { component: 'U1', pin: 'PB7' } as const
const v33 = { component: 'U1', pin: '3V3_1' } as const

export const LESSON: Lesson = {
  id: 'i7-i2c',
  level: 'intermediate',
  order: 7,
  title: 'I²C 匯流排：上拉電阻、位址掃描與 EEPROM',
  summary:
    '把 AT24C02 EEPROM 接到 I2C1（PB6 SCL／PB7 SDA），加上 4.7 kΩ 上拉電阻，用真正的 HAL 韌體掃描 0x08～0x77 找到 0x50，再寫入一頁 8 個位元組、用 ACK 查詢等待寫入週期並讀回驗證。',
  objectives: [
    '說明 I²C 的 SCL、SDA 都是開汲極線路：裝置只能拉低，高準位全靠上拉電阻。',
    '依上升時間與灌入電流估算上拉電阻範圍（約 1 kΩ～10 kΩ），並知道少了上拉時匯流排永遠是「忙碌」。',
    '理解 7 位元位址：AT24C02 是 1010 A2 A1 A0，A2～A0 接 GND 時為 0x50；HAL 函式要傳入左移一位的 0xA0。',
    '用位址掃描（`HAL_I2C_IsDeviceReady()`）找出匯流排上的裝置，並看懂 START、位址、ACK／NACK、STOP。',
    '理解 EEPROM 的分頁寫入（每頁 8 個位元組）、5 ms 自計時寫入週期，以及用 ACK 查詢等待它完成。',
  ],
  wiring:
    '電源已經接好（上方 + 電源軌 = 3.3 V，兩條 − 電源軌 = GND）。**AT24C02（U2）** 跨在中央溝槽上，第 1 腳在 f40：\n' +
    '- 下排（f 列）：A0 f40、A1 f41、A2 f42、GND f43——都已經用導線接到下方 − 電源軌，所以位址是 **0x50**；\n' +
    '- 上排（e 列）：VCC e40（已接 3.3 V）、WP e41（已接 GND，允許寫入）、**SCL e42**、**SDA e43**。\n\n' +
    '你要完成 I²C 匯流排：\n' +
    '- **SCL**：從 `a42`（a 列第 42 欄）拉線到 **j23**（PB6 = I2C1_SCL 唯一的空孔）；\n' +
    '- **SDA**：從 `a43` 拉線到 **j24**（PB7 = I2C1_SDA）；\n' +
    '- **上拉電阻**：放兩顆 **4.7 kΩ** 電阻，R1 從 `b42` 到上方 + 電源軌（例如 `top+33`，上方 + 電源軌第 33 孔），R2 從 `b43` 到 `top+34`。',
  theory:
    '**1. 兩條線、多個裝置。** I²C 只用 SCL（時脈）與 SDA（資料）兩條線，就能讓一個主控端與許多裝置溝通。兩條線都是**開汲極**：每個裝置只能把線拉到 GND 或放開，從不主動輸出高準位。放開時由**上拉電阻**拉回 3.3 V，因此任何一方拉低都會贏（「線及」），多個裝置同時說話也不會短路。STM32 的 PB6／PB7 因此設成 `GPIO_MODE_AF_OD`（複用開汲極）。\n\n' +
    '**2. 上拉電阻怎麼選？** 太大：匯流排電容（導線與腳位，約 100 pF）充電太慢，標準模式要求上升時間 ≤ 1000 ns，R ≤ 1000 ns ÷ (0.8473 × 100 pF) ≈ 11.8 kΩ。太小：裝置拉低時要灌入的電流太大，規格要求 3 mA 時低準位 ≤ 0.4 V，R ≥ (3.3 − 0.4) V ÷ 3 mA ≈ 0.97 kΩ。**4.7 kΩ** 是常用的折衷：拉低時只流 3.3 V ÷ 4.7 kΩ ≈ 0.70 mA，上升時間約 0.8473 × 4.7 kΩ × 100 pF ≈ 0.40 µs。\n\n' +
    '**3. 一次傳輸。** 閒置時兩條線都是高準位。**START**：SCL 為高時 SDA 由高變低；接著主控端送出 7 位元位址 + 1 位元讀寫方向（0 = 寫、1 = 讀），在第 9 個時脈由被選中的裝置把 SDA 拉低回應 **ACK**（沒人回應就是 NACK）；之後每個資料位元組也都有 ACK；最後 **STOP**：SCL 為高時 SDA 由低變高。100 kHz 標準模式：I2C1 的 FREQ = 36（PCLK1 = 36 MHz）、CCR = 180 → 高、低各 180 × 27.8 ns = **5 µs**，TRISE = 37。\n\n' +
    '**4. 位址。** AT24C02 的 7 位元位址是 `1010 A2 A1 A0`：A2～A0 都接 GND 時為 1010000b = **0x50**，所以同一條匯流排最多可以掛 8 顆（0x50～0x57）。HAL 的函式要傳入「左移一位」的 8 位元形式：`HAL_I2C_IsDeviceReady(&hi2c1, 0x50 << 1, 1, 2)`。\n\n' +
    '**5. 位址掃描。** `lesson-i7-i2c` 對 0x08～0x77 每個位址送出 START + 位址 + 寫入位元：有 ACK 就印出 `found 0xNN`。一次沒有回應的探測約 115 µs，掃完 112 個位址約 13 ms。若匯流排沒有上拉電阻，SDA／SCL 一直讀到低準位，I2C 硬體的 BUSY 旗標不會清除：HAL 等 25 ms 後回傳 HAL_BUSY，韌體印出 `bus busy at 0x08: SDA/SCL stuck low (pull-ups?)`。\n\n' +
    '**6. EEPROM 寫入。** AT24C02 有 256 個位元組，分成 32 頁、每頁 8 個位元組。韌體先讀出位址 0x10 的 8 個位元組（全新的晶片是 FF），把它們**逐位元反相**後一次寫入整頁（所以資料一定會改變），EEPROM 收到 STOP 後進入最長 **5 ms** 的自計時寫入週期，期間不回應自己的位址。韌體用 ACK 查詢（約 45 次、每次約 112 µs）等它完成，再讀回比較：全部一致就印出 `eeprom ok`。EEPROM 斷電不會遺失資料，所以第二次執行會讀到上次寫入的 00。',
  start: {
    layout: benchLayout(
      'i7 I²C（起始）',
      'Blue Pill 已接電源；AT24C02（U2）已插在 f40，電源、WP 與位址腳已接好（位址 0x50），但 SCL／SDA 還沒接、也沒有上拉電阻，還沒載入韌體。',
      [eeprom],
      powerWires,
    ),
  },
  solution: {
    layout: benchLayout(
      'i7 I²C（解答）',
      'PB6（j23）→ SCL、PB7（j24）→ SDA，兩條線各以 4.7 kΩ 上拉到 3.3 V；韌體 lesson-i7-i2c.elf：掃描到 0x50，寫入 8 個位元組並讀回驗證成功。',
      [eeprom, ...pullups],
      solutionWires,
    ),
    firmware: { U1: 'lesson-i7-i2c' },
  },
  expected: [
    'UART 終端機（U1 的 USART1，115200 8N1）依序出現：`I2C1 scan 0x08-0x77`、`found 0x50`、`scan done 1`。',
    '接著 `before: FF FF FF FF FF FF FF FF`（全新晶片），`wrote 8 bytes at 0x10, ready after 45 polls`（約 45 次，5 ms 寫入週期），`read 8 bytes ok`、`eeprom ok`。',
    '邏輯分析儀上 SCL 為 100 kHz：高、低各 5 µs；閒置時 SCL、SDA 都是 3.3 V。',
    '每條上拉電阻在線路被拉低時流過 3.3 V ÷ 4.7 kΩ ≈ 0.70 mA。',
    '拿掉兩顆上拉電阻時，約 25 ms 後印出 `bus busy at 0x08: SDA/SCL stuck low (pull-ups?)` 與 `scan done 0`。',
  ],
  mistakes: [
    {
      symptom: '終端機只印出 `bus busy at 0x08: SDA/SCL stuck low (pull-ups?)` 與 `scan done 0`，什麼裝置都找不到。',
      cause:
        '沒有上拉電阻：SCL、SDA 是開汲極，沒有東西把它們拉回高準位，I2C 硬體一開始就認為匯流排被別人佔用（SR2.BUSY = 1）。拿掉 R1、R2 即可在模擬器重現，電氣規則檢查也會指出 SCL、SDA 缺少上拉電阻。',
      fix: 'SCL、SDA 各接一顆 1 kΩ～10 kΩ（常用 4.7 kΩ）的上拉電阻到 3.3 V。許多模組板上已經有上拉，多個模組並聯時要注意總電阻不要太小。',
    },
    {
      symptom: '掃描結束顯示 `scan done 0` 與 `eeprom not found at 0x50`，但上拉電阻都有接。',
      cause: 'SCL 與 SDA 接反了（PB6 接到 SDA、PB7 接到 SCL），EEPROM 收不到正確的 START 與時脈，永遠不會回應 ACK。電氣規則檢查會提示「SDA 與 SCL 看起來接反了」。',
      fix: 'PB6 = I2C1_SCL 接 EEPROM 的第 6 腳 SCL（e42），PB7 = I2C1_SDA 接第 5 腳 SDA（e43）。',
    },
    {
      symptom: '掃描找到的是 `found 0x51`（或其他 0x5X），接著印出 `eeprom not found at 0x50`。',
      cause: 'A0～A2 位址腳沒有全部接 GND：例如 A0 接到了 3.3 V，位址就變成 1010001b = 0x51。位址腳浮接時，實機的位址甚至會不固定。',
      fix: '把 A2～A0 接到 GND（本課已預先接好），或修改韌體中的 EEPROM 位址，讓兩者一致。',
    },
    {
      symptom: '`ready after 0 polls`，接著 `mismatch at 0x10 …` 與 `eeprom write failed`。',
      cause: 'WP（寫入保護，第 7 腳）接到了 3.3 V：EEPROM 照樣回應 ACK，但不會真的寫入，所以沒有寫入週期、讀回的仍是舊資料。',
      fix: 'WP 接 GND 才能寫入；需要保護資料時再把它拉高。',
    },
    {
      symptom: '自己寫的程式寫入後馬上讀取，讀取函式回傳 HAL_ERROR（ErrorCode 0x4 = AF，沒有 ACK）。',
      cause: 'EEPROM 還在最長 5 ms 的內部寫入週期中，這段時間它不回應自己的位址。',
      fix: '寫入後用 `HAL_I2C_IsDeviceReady()` 做 ACK 查詢，等到裝置回應 ACK 再讀取（本課韌體的做法），或至少等 5 ms。',
    },
  ],
  acceptance: [
    { kind: 'firmware-loaded', component: 'U1', project: 'lesson-i7-i2c', label: 'U1 已載入 lesson-i7-i2c.elf 韌體' },
    { kind: 'connected', a: pb6, b: { component: 'U2', pin: 'SCL' }, label: 'PB6（I2C1_SCL）接到 EEPROM 的 SCL' },
    { kind: 'connected', a: pb7, b: { component: 'U2', pin: 'SDA' }, label: 'PB7（I2C1_SDA）接到 EEPROM 的 SDA' },
    {
      kind: 'connected',
      a: pb6,
      b: v33,
      via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 },
      label: 'SCL 有 1 kΩ～10 kΩ 的上拉電阻接到 3.3 V',
    },
    {
      kind: 'connected',
      a: pb7,
      b: v33,
      via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 },
      label: 'SDA 有 1 kΩ～10 kΩ 的上拉電阻接到 3.3 V',
    },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'found 0x50', seconds: 1, label: '位址掃描找到 0x50' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'eeprom ok', seconds: 1, label: 'EEPROM 寫入並讀回成功' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'bus',
      title: '接上 SCL 與 SDA',
      body:
        '用「導線」工具接 `a42`（EEPROM 的 SCL）→ `j23`（PB6），再接 `a43`（SDA）→ `j24`（PB7）。\n\n' +
        'I2C1 的預設腳位是 PB6 = SCL、PB7 = SDA（也可以用 AFIO 重新對應到 PB8／PB9）。',
      highlight: { holes: ['a42', 'a43', PB6, PB7], components: ['U2'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: pb6, b: { component: 'U2', pin: 'SCL' } },
          { kind: 'connected', a: pb7, b: { component: 'U2', pin: 'SDA' } },
        ],
        label: 'SCL、SDA 都已接好',
      },
    },
    {
      id: 'no-pullup',
      title: '先不加上拉電阻，載入韌體',
      body:
        '按下方的「載入 `lesson-i7-i2c` 到 U1」，載入後模擬會自動執行，打開儀器的「UART 終端機」（U1 的 USART1，115200 8N1）。\n\n' +
        '沒有上拉電阻，終端機會印出 `bus busy at 0x08: SDA/SCL stuck low (pull-ups?)` 與 `scan done 0`——開汲極線路沒有東西把它們拉回高準位。',
      highlight: { components: ['U1'] },
      check: { kind: 'firmware-loaded', component: 'U1', project: 'lesson-i7-i2c', label: 'U1 已載入 lesson-i7-i2c.elf' },
      action: [{ kind: 'load-firmware', component: 'U1', project: 'lesson-i7-i2c' }, { kind: 'run' }],
    },
    {
      id: 'pullups',
      title: '加上兩顆 4.7 kΩ 上拉電阻',
      body:
        '按下方的「拿一顆電阻」（或在「元件庫」點一下「電阻」），依序點 `b42` 與 `top+33` 放上 R1；再拿一顆，依序點 `b43` 與 `top+34` 放上 R2。兩顆都在「屬性」面板設為 `4700` Ω（4.7 kΩ）。\n\n' +
        '線路被拉低時，每顆電阻只流過 3.3 V ÷ 4.7 kΩ ≈ 0.70 mA。',
      highlight: { holes: ['b42', 'b43'] },
      check: {
        kind: 'all',
        checks: [
          { kind: 'connected', a: pb6, b: v33, via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 } },
          { kind: 'connected', a: pb7, b: v33, via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 } },
        ],
        label: 'SCL、SDA 都有上拉電阻',
      },
    },
    {
      id: 'scan',
      title: '重新執行：掃描到 0x50',
      body:
        '按下方的「重置 MCU」，讓韌體重新掃描（模擬暫停了的話，再按「▶ 執行模擬」）：終端機出現 `I2C1 scan 0x08-0x77`、`found 0x50`、`scan done 1`。\n\n' +
        '把邏輯分析儀接到 PB6、PB7 並加上 I²C 解碼器：每個沒有回應的位址是 START、位址、NACK、STOP；0x50 的那一次在第 9 個時脈看得到 EEPROM 把 SDA 拉低（ACK）。',
      highlight: { components: ['U2'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'found 0x50', seconds: 1, label: '掃描到 0x50' },
      action: [{ kind: 'reset', scope: 'mcu' }, { kind: 'run' }],
    },
    {
      id: 'eeprom',
      title: '看 EEPROM 的寫入與讀回',
      body:
        '看終端機接下來的輸出：`before: FF …`（全新晶片）→ 寫入反相資料 → `wrote 8 bytes at 0x10, ready after 45 polls`（約 45 次 ACK 查詢 ≈ 5 ms 寫入週期）→ `read 8 bytes ok` → **`eeprom ok`**。\n\n' +
        '再按一次下方的「重置 MCU」：這次 `before:` 讀到的是 `00 …`——上次寫入的資料還在，EEPROM 是非揮發性記憶體。',
      highlight: { components: ['U2'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'eeprom ok', seconds: 1, label: 'EEPROM 寫入並讀回成功' },
      action: [{ kind: 'run' }, { kind: 'reset', scope: 'mcu' }],
    },
    {
      id: 'erc',
      title: '電氣規則檢查',
      body:
        '按「檢查此步驟」，或看電氣規則檢查的結果（「問題」清單）：上拉電阻、EEPROM 的電源與位址腳都接好時，不應該有任何錯誤。\n\n' +
        '想多試一點：把 WP（`a41` 那條線）改接到 3.3 V，重置後會看到 `ready after 0 polls` 與 `eeprom write failed`。試完記得接回 GND。',
      check: { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'at24c02', 'resistor'],
    firmware: ['lesson-i7-i2c'],
  },
  durationMin: 40,
}
