/**
 * a7 — STM32 + I²C 多裝置：一條匯流排三個裝置、位址規劃、共用的上拉電阻。
 *
 * Firmware: firmware/dist/lesson-a7-i2c-multi (ST HAL, I2C1 PB6/PB7 100 kHz):
 * once per second it scans 0x08–0x77, sets up every device whose address
 * answers (AT24C02 page write + ACK polling + read back, MPU-6050 WHO_AM_I +
 * wake-up, BME280 chip id + trimming) when the set of addresses changes,
 * and prints the sensor readings; a busy bus (no pull-up: SDA / SCL never
 * high) is reported once and retried after an I2C1 reset, so the bus comes
 * back by itself as soon as it is fixed — no MCU reset needed.
 * Bus: the AT24C02 (U2, DIP at f33: A0 A1 A2 GND f33–f36, VCC WP SCL SDA
 * e33–e36) is wired to PB6 / PB7 in the starting circuit and has NO pull-up
 * resistors — the bus is dead (ERC i2c-pullup) until a module with on-board
 * pull-ups joins it: the GY-521 (IMU1 at f42, 4.7 kΩ) and the GY-BME280
 * (ENV1 at f54, 10 kΩ) reach the bus on the EEPROM's SCL / SDA strips
 * (columns 35 / 36, rows b–d). Every line below is what the simulation
 * prints (tests/lessons/advanced.test.ts).
 */
import type { Lesson, LessonCheck } from '../types'
import { GND, TAP, V33, V5, anchored, bench, bullets, doc, pin, pinOf, wire, wired } from './bench'

const FW = 'lesson-a7-i2c-multi'

const U2 = anchored('U2', 'at24c02', 'f33')
const IMU1 = anchored('IMU1', 'mpu6050_gy521', 'f42')
const ENV1 = anchored('ENV1', 'bme280', 'f54')

/** The AT24C02 and its connection to I2C1 — in the starting circuit. */
const EEPROM = [
  wire('W7', 'a33', 'top+26', 'red'), // VCC 3.3 V
  wire('W8', 'a34', 'top-27', 'black'), // WP → GND (writable)
  wire('W9', 'j33', 'bot-26', 'black'), // A0 → GND
  wire('W10', 'j34', 'bot-27', 'black'), // A1 → GND
  wire('W11', 'j35', 'bot-28', 'black'), // A2 → GND: 1010 000 = 0x50
  wire('W12', 'j36', 'bot-29', 'black'), // GND
  wire('W13', 'a35', TAP.PB6, 'yellow'), // SCL → PB6
  wire('W14', 'a36', TAP.PB7, 'blue'), // SDA → PB7
]

const START = bench('a7 I²C 多裝置（起始）', [U2, IMU1, ENV1], EEPROM)

const SOLUTION = bench(
  'a7 I²C 多裝置（解答）',
  [U2, IMU1, ENV1],
  [
    ...EEPROM,
    wire('W15', 'j42', 'bot+34', 'red'), // IMU1 VCC → 5 V (module regulator)
    wire('W16', 'j43', 'bot-34', 'black'), // IMU1 GND
    wire('W17', 'j44', 'b35', 'yellow'), // IMU1 SCL → the bus (column 35)
    wire('W18', 'j45', 'b36', 'blue'), // IMU1 SDA → the bus (column 36)
    wire('W19', 'j54', 'top+43', 'red'), // ENV1 VCC → 3.3 V (no regulator)
    wire('W20', 'j55', 'bot-44', 'black'), // ENV1 GND
    wire('W21', 'j56', 'c35', 'yellow'), // ENV1 SCL → the bus
    wire('W22', 'j57', 'c36', 'blue'), // ENV1 SDA → the bus
  ],
)

const IMU_POWER: LessonCheck[] = [wired('IMU1', 'VCC', V5), wired('IMU1', 'GND', GND)]
const IMU_BUS: LessonCheck[] = [wired('IMU1', 'SCL', pin('PB6')), wired('IMU1', 'SDA', pin('PB7'))]
const ENV_POWER: LessonCheck[] = [wired('ENV1', 'VCC', V33), wired('ENV1', 'GND', GND)]
const ENV_BUS: LessonCheck[] = [wired('ENV1', 'SCL', pin('PB6')), wired('ENV1', 'SDA', pin('PB7'))]

const SCAN3 = 'scan: 0x50 0x68 0x76 (3 devices)'
const ALL_OK = 'all 3 devices ok'

export const LESSON: Lesson = {
  id: 'a7-i2c-multi',
  level: 'advanced',
  order: 7,
  title: 'STM32 + I²C 多裝置：位址規劃與共用上拉電阻',
  summary:
    '把 AT24C02 EEPROM（U2）、MPU-6050（GY-521，IMU1）與 BME280（GY-BME280，ENV1）三個裝置接在同一條 I2C1 匯流排上。先看只有 EEPROM 時匯流排為什麼「忙碌」——它沒有上拉電阻；接上模組後，模組板上的上拉電阻讓整條匯流排活過來。每個裝置靠不同的 7 位元位址區分：0x50、0x68、0x76。',
  objectives: [
    '說明 I²C 匯流排上所有裝置的 SCL、SDA 都並聯在一起，靠 7 位元位址（0x50、0x68、0x76）區分',
    '規劃位址：AT24C02 是 1010 A2 A1 A0（0x50～0x57）、MPU-6050 由 AD0 選 0x68／0x69、BME280 由 SDO 選 0x76／0x77，同一條匯流排上不能重複',
    '知道上拉電阻屬於「匯流排」而不是某個裝置：AT24C02 沒有上拉，只接它時匯流排永遠是低電位（忙碌）；GY-521 的 4.7 kΩ 與 GY-BME280 的 10 kΩ 並聯後約 3.2 kΩ',
    '估算上拉電阻的範圍：拉低時灌入電流不超過 3 mA（3.3 V ÷ 3 mA = 1.1 kΩ 以上），模組越多並聯越小',
    '用位址掃描（`HAL_I2C_IsDeviceReady()`）找出匯流排上的裝置，並分辨「沒有 ACK」與「匯流排忙碌」',
  ],
  wiring: doc(
    '電源與 Blue Pill（U1）已經接好：下方 + 電源軌（bot+）是 5 V，上方 + 電源軌（top+）是 3.3 V，兩條 − 電源軌都是 GND。韌體 `lesson-a7-i2c-multi` 已經選好。',
    '**AT24C02（U2）已經接好**：它跨在中央溝槽上（第 1 腳在 `f33`），A0～A2 與 WP 接 GND（位址 0x50、可寫入），VCC 接 3.3 V，**SCL（`e35`）經 `a35` 接到 U1 PB6（板上 B6）**、**SDA（`e36`）經 `a36` 接到 U1 PB7（板上 B7）**。所以第 35 欄的 a～e 就是整條 SCL 匯流排、第 36 欄的 a～e 是 SDA 匯流排，`b35`～`d35`、`b36`～`d36` 都還空著，給其他裝置接上來。',
    '你要把兩個模組接到匯流排上（模組本體蓋住前幾列，從同一欄的 **j 列**拉線）：',
    bullets(
      'GY-521（IMU1，排針 `f42`～`f49`：VCC GND SCL SDA XDA XCL AD0 INT）：VCC `j42` → `bot+34`（5 V，模組上有 3.3 V 穩壓器）、GND `j43` → `bot-34`、SCL `j44` → `b35`、SDA `j45` → `b36`',
      'GY-BME280（ENV1，排針 `f54`～`f59`：VCC GND SCL SDA CSB SDO）：VCC `j54` → `top+43`（**3.3 V**，這塊模組沒有穩壓器，最高 3.6 V）、GND `j55` → `bot-44`、SCL `j56` → `c35`、SDA `j57` → `c36`',
    ),
    'IMU1 的 AD0 與 ENV1 的 SDO 不接：模組上各有下拉電阻，位址分別是 0x68 與 0x76。USART1（U1 PA9（板上 A9），115200 8N1）的報告在「UART 終端機」。',
  ),
  theory: doc(
    '**一條匯流排、很多裝置**：I²C 只有 SCL、SDA 兩條線，所有裝置的 SCL 接在一起、SDA 接在一起。每次傳輸的第一個位元組是 7 位元位址加讀寫位元，只有位址相符的裝置在第 9 個時脈把 SDA 拉低回 ACK，其他裝置保持沉默。',
    '**位址規劃**（7 位元）：',
    bullets(
      'AT24C02：`1010 A2 A1 A0` → A2～A0 接 GND 是 **0x50**，最多 8 顆（0x50～0x57）',
      'MPU-6050：`110100 AD0` → AD0 = 0 是 **0x68**，AD0 = 1 是 0x69（兩顆 MPU-6050 就靠 AD0 分開）',
      'BME280：`111011 SDO` → SDO = 0 是 **0x76**，SDO = 1 是 0x77',
      '同一條匯流排上的位址不能重複；例如 DS3231 RTC 模組也是 0x68，就會和 AD0 = 0 的 MPU-6050 撞在一起',
    ),
    '**上拉電阻是匯流排的**：SCL、SDA 都是開汲極，裝置只能把線拉低，放開時要靠上拉電阻拉回高電位。STM32 的 I²C 腳位設成 `GPIO_MODE_AF_OD`，沒有內部上拉。AT24C02 這顆晶片本身也沒有上拉——只有它在匯流排上時，線路永遠讀到低電位，I2C1 的 BUSY 旗標不會清除，`HAL_I2C_IsDeviceReady()` 等 25 ms 後回傳 `HAL_BUSY`。韌體每秒重試一次（先重置 I2C1），所以匯流排修好後會自己恢復。',
    '**模組的上拉並聯**：GY-521 的 SCL、SDA 各有 4.7 kΩ 上拉到它自己的 3.3 V，GY-BME280 各有 10 kΩ。三個裝置都接上後，每條線的上拉是 4.7 kΩ ∥ 10 kΩ ≈ **3.2 kΩ**，線被拉低時灌入約 3.3 V ÷ 3.2 kΩ ≈ 1.0 mA。I²C 標準模式規定灌入電流最多 3 mA，所以上拉不能小於 3.3 V ÷ 3 mA ≈ 1.1 kΩ；上升時間（100 kHz 時最多 1 µs）則限制它不能太大。接了 5 塊各帶 4.7 kΩ 的模組，並聯只剩 940 Ω——太強了，要拆掉部分模組上的上拉電阻。',
    '**掃描**：`HAL_I2C_IsDeviceReady()` 對每個位址送 START、位址、STOP。沒有裝置回 ACK 的探測約 115 µs，掃完 0x08～0x77 共 112 個位址約 25 ms。回 `HAL_ERROR`（沒有 ACK）只代表那個位址沒有裝置；回 `HAL_BUSY` 代表整條匯流排卡住了。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    '起始電路（只有 AT24C02）：開機 `I2C1 multi-device bus, lesson a7 (PB6 SCL / PB7 SDA, 100 kHz)`，約 0.048 s `bus busy: SDA/SCL stuck low (no pull-up on the bus?)`；電氣規則檢查：SCL、SDA 沒有上拉電阻（錯誤）',
    '接上 GY-521 後的下一秒：`scan: 0x50 0x68 (2 devices)`、`AT24C02 @0x50: page write 8 B, ready after 45 polls, read back ok`、`MPU-6050 @0x68: WHO_AM_I=0x68, awake`、`BME280 @0x76: no ACK`、`2 of 3 devices ok`',
    '三個裝置都接好（上電即全部正常）：約 0.033 s `scan: 0x50 0x68 0x76 (3 devices)`，約 0.062 s `all 3 devices ok`',
    '每秒一行讀數（GY-521 平放、ENV1 為 25 °C／1013.25 hPa／50 %RH）：`read: ax=0 ay=0 az=16384 | T=25.00 C P=1013.24 hPa H=49.99 %`',
    '每條線的上拉：4.7 kΩ ∥ 10 kΩ ≈ 3.2 kΩ，拉低時約 1.0 mA；掃描 112 個位址約 25 ms',
    'IMU1 的 AD0 接 3.3 V：`scan: 0x50 0x69 0x76 (3 devices)`、`MPU-6050 @0x68: no ACK (0x69 answers: AD0 is high)`、`2 of 3 devices ok`',
  ],
  // acceptance indices: 0 IMU1 power · 1 IMU1 bus · 2 ENV1 power · 3 ENV1 bus · 4 AD0 open · 5 firmware
  // · 6 scan · 7 all devices · 8 readings · 9 contract · 10 ERC
  mistakes: [
    {
      symptom: '終端機停在 `bus busy: SDA/SCL stuck low (no pull-up on the bus?)`，電氣規則檢查指出 I²C 的 SCL、SDA 沒有上拉電阻',
      cause: '匯流排上只有 AT24C02：這顆晶片沒有上拉電阻，STM32 的開汲極腳位也沒有，SCL、SDA 放開後沒有東西把它們拉高，I2C1 一直認為匯流排忙碌',
      fix: '把帶有上拉電阻的模組（GY-521 的 4.7 kΩ）接上匯流排，或在 SCL、SDA 各加一顆 4.7 kΩ 電阻到 3.3 V；韌體每秒重試，接好後不必重置',
      match: { ercRules: ['i2c-pullup'], checks: [1, 3] },
    },
    {
      symptom: '接上 GY-521 的 SCL、SDA 之後還是 `bus busy`，電氣規則檢查說 IMU1 沒有供電',
      cause: 'GY-521 的 VCC 沒有接：模組上的 4.7 kΩ 上拉接在它自己的 3.3 V 穩壓器輸出上，穩壓器沒電時這兩顆電阻反而把 SCL、SDA 拉向 0 V',
      fix: '先接 VCC（`j42` → `bot+34`）與 GND，再接 SCL、SDA',
      match: { checks: [0], passes: [1] },
    },
    {
      symptom: '`scan:` 裡沒有 0x68，出現 `MPU-6050 @0x68: no ACK`',
      cause: 'GY-521 的 SCL、SDA 沒有接到匯流排，或兩條線接反了（電氣規則檢查會提示「SDA 與 SCL 看起來接反」）',
      fix: 'SCL（`j44`）接到 SCL 匯流排（第 35 欄，例如 `b35`），SDA（`j45`）接到第 36 欄',
      match: { checks: [1], passes: [0] },
    },
    {
      symptom: '`scan: 0x50 0x69 0x76 (3 devices)`，接著 `MPU-6050 @0x68: no ACK (0x69 answers: AD0 is high)`',
      cause: 'GY-521 的 AD0 被接到 3.3 V：位址變成 0x69，韌體卻呼叫 0x68',
      fix: 'AD0 不接（模組上有下拉）或接 GND；若真的需要兩顆 MPU-6050，一顆 AD0 = 0、一顆 AD0 = 1，程式裡分別用 0x68 與 0x69',
      match: { checks: [4] },
    },
    {
      symptom: '`BME280 @0x76: no ACK`，電氣規則檢查說 ENV1 的供電超過額定',
      cause: 'GY-BME280 的 VCC 接到了 5 V：這塊模組沒有穩壓器，BME280 最高只能 3.6 V，而且它的 10 kΩ 上拉會把匯流排拉到 5 V',
      fix: 'ENV1 的 VCC（`j54`）接 3.3 V（上方 + 電源軌，例如 `top+43`）',
      match: { checks: [2], ercRules: ['supply-range'] },
    },
    {
      symptom: '`scan:` 裡沒有 0x76，出現 `BME280 @0x76: no ACK`，其他裝置正常',
      cause: 'GY-BME280 的 SCL、SDA 沒有接到匯流排或接反，或 GND 沒接',
      fix: 'SCL（`j56`）接第 35 欄（例如 `c35`），SDA（`j57`）接第 36 欄，GND（`j55`）接 − 電源軌',
      match: { checks: [3], passes: [2] },
    },
    {
      symptom: '接了很多個模組之後，偶爾讀到錯誤的資料或沒有 ACK',
      cause: '每塊模組都帶上拉電阻，並聯起來太小：5 塊 4.7 kΩ 只剩 940 Ω，裝置拉低時要灌 3.5 mA，超過 I²C 規定的 3 mA，低電位拉不夠低',
      fix: '整條匯流排只保留一組上拉（約 2.2～4.7 kΩ），把其他模組上的上拉電阻拆掉或切斷焊接跳線',
    },
  ],
  acceptance: [
    { kind: 'all', checks: IMU_POWER, label: 'IMU1（GY-521）的 VCC 接 5 V、GND 接 GND' },
    { kind: 'all', checks: IMU_BUS, label: 'IMU1 的 SCL 接 U1 PB6（板上 B6）、SDA 接 U1 PB7（板上 B7）' },
    { kind: 'all', checks: ENV_POWER, label: 'ENV1（GY-BME280）的 VCC 接 3.3 V、GND 接 GND' },
    { kind: 'all', checks: ENV_BUS, label: 'ENV1 的 SCL 接 U1 PB6（板上 B6）、SDA 接 U1 PB7（板上 B7）' },
    { kind: 'not-connected', a: pinOf('IMU1', 'AD0'), b: V33, label: 'IMU1 的 AD0 沒有接 3.3 V（位址 0x68）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 lesson-a7-i2c-multi 韌體' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: SCAN3, seconds: 0.2, label: '掃描找到 0x50、0x68、0x76 三個裝置' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: ALL_OK, seconds: 0.2, label: '三個裝置都設定成功（EEPROM 寫入並讀回、IMU1 喚醒、BME280 校正值讀出）' },
    {
      kind: 'all',
      label: '每秒讀到 IMU1 的加速度與 ENV1 的溫度、氣壓、濕度',
      checks: [
        { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'read: ax=', seconds: 0.2 },
        { kind: 'uart-contains', component: 'U1', port: 'USART1', text: ' | T=', seconds: 0.2 },
      ],
    },
    { kind: 'firmware-checks', project: FW, label: '韌體行為合約（腳位、只有 AT24C02 時的掃描與讀寫）通過' },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'busy',
      title: '執行：只有 EEPROM 的匯流排',
      body: doc(
        '模擬會自動執行，打開「UART 終端機」：開機訊息之後是 `bus busy: SDA/SCL stuck low (no pull-up on the bus?)`。再看狀態列與「問題」清單：電氣規則檢查指出 SCL、SDA 沒有上拉電阻（另外幾則是 IMU1、ENV1 還沒接線，接下來的步驟就會接上）。',
        '目前匯流排上只有 AT24C02，它沒有上拉電阻，STM32 的開汲極腳位也沒有。把游標停在 `a35` 上看：SCL 一直是 0 V。看完按「下一步」。',
      ),
      highlight: { holes: ['a35', 'a36'], components: ['U2', 'U1'] },
      action: { kind: 'run' },
    },
    {
      id: 'imu',
      title: '接上 GY-521：它的上拉救活整條匯流排',
      body: doc(
        '按下方的「開始接線」，依序接 `j42` → `bot+34`（VCC 5 V）、`j43` → `bot-34`（GND）、`j44` → `b35`（SCL 匯流排）、`j45` → `b36`（SDA 匯流排）。',
        '先接電源再接訊號線：GY-521 的 4.7 kΩ 上拉接在它自己的 3.3 V 穩壓器上，模組有電後，這兩顆電阻就成了整條匯流排的上拉。韌體每秒重試一次，不必重置——下一秒終端機就會出現 `scan: 0x50 0x68 (2 devices)`。',
      ),
      highlight: { holes: ['j42', 'bot+34', 'j43', 'bot-34', 'j44', 'b35', 'j45', 'b36'], components: ['IMU1'] },
      check: { kind: 'all', checks: [...IMU_POWER, ...IMU_BUS], label: 'IMU1 的電源與 SCL、SDA 接好' },
    },
    {
      id: 'imu-run',
      title: '兩個裝置：EEPROM 與 MPU-6050',
      body: doc(
        '看終端機：`AT24C02 @0x50: page write 8 B, ready after 45 polls, read back ok`、`MPU-6050 @0x68: WHO_AM_I=0x68, awake`、`BME280 @0x76: no ACK`、`2 of 3 devices ok`，之後每秒一行 `read: ax=0 ay=0 az=16384`。',
        'EEPROM 寫入 8 個位元組後要 5 ms 才寫完，這段時間它不回 ACK；韌體一直探測它的位址（ACK 查詢），約 45 次後才回應。MPU-6050 上電時處於睡眠模式，要先寫 PWR_MGMT_1 = 0 才會開始量測。',
      ),
      highlight: { components: ['U2', 'IMU1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'MPU-6050 @0x68: WHO_AM_I=0x68, awake', seconds: 0.2 },
    },
    {
      id: 'env',
      title: '接上 GY-BME280（3.3 V）',
      body: doc(
        '按下方的「開始接線」，依序接 `j54` → `top+43`（VCC，**3.3 V**）、`j55` → `bot-44`（GND）、`j56` → `c35`（SCL）、`j57` → `c36`（SDA）。',
        'GY-BME280 沒有穩壓器，VCC 只能接 3.3 V。它的 SCL、SDA 也各有 10 kΩ 上拉，和 GY-521 的 4.7 kΩ 並聯：4.7 kΩ ∥ 10 kΩ ≈ 3.2 kΩ。',
      ),
      highlight: { holes: ['j54', 'top+43', 'j55', 'bot-44', 'j56', 'c35', 'j57', 'c36'], components: ['ENV1'] },
      check: { kind: 'all', checks: [...ENV_POWER, ...ENV_BUS], label: 'ENV1 的電源與 SCL、SDA 接好' },
    },
    {
      id: 'all',
      title: '三個裝置都正常',
      body: doc(
        '下一秒終端機出現 `scan: 0x50 0x68 0x76 (3 devices)`、三行設定結果與 `all 3 devices ok`，之後每秒一行 `read: ax=0 ay=0 az=16384 | T=25.00 C P=1013.24 hPa H=49.99 %`。',
        '點 ENV1 把「溫度」改成 30 °C、或點 IMU1 把「加速度 X」改成 0.5 g，下一行讀數就跟著變（0.5 g × 16384 = 8192）。三個裝置共用同兩條線，靠位址各自回應。',
      ),
      highlight: { components: ['U2', 'IMU1', 'ENV1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: ALL_OK, seconds: 0.2 },
    },
    {
      id: 'bus',
      title: '用邏輯分析儀看掃描',
      body: doc(
        '按下方的「把 PB6、PB7 加到邏輯分析儀」：每秒開頭有一段約 25 ms 的密集時脈——那是對 0x08～0x77 共 112 個位址的探測，每個沒有回應的位址約 115 µs；接著是 BME280 的轉換與讀取，以及 MPU-6050 的 6 位元組連續讀取。',
        '放大其中一次探測：START、7 位元位址 + 寫入位元、第 9 個時脈 SDA 留在高電位（NACK）、STOP。有裝置的位址在第 9 個時脈會被拉低（ACK）。',
      ),
      highlight: { components: ['U1'] },
      action: [{ kind: 'add-logic', component: 'U1', pins: ['PB6', 'PB7'] }, { kind: 'run' }],
    },
    {
      id: 'address',
      title: '實驗：改變 MPU-6050 的位址',
      body: doc(
        '按下方的「開始接線」，從 `j48`（IMU1 的 AD0）接到 `top+39`（3.3 V）：下一秒出現 `scan: 0x50 0x69 0x76 (3 devices)` 與 `MPU-6050 @0x68: no ACK (0x69 answers: AD0 is high)`。',
        'AD0 = 1 讓 MPU-6050 的位址變成 0x69。這正是在同一條匯流排上放兩顆 MPU-6050 的方法；但程式也要改用 0x69。做完實驗**把這條線拆掉**，下一秒又恢復 `all 3 devices ok`，然後到「驗收」按「檢查我的電路」。',
      ),
      highlight: { holes: ['j48', 'top+39'], components: ['IMU1'] },
      check: { kind: 'not-connected', a: pinOf('IMU1', 'AD0'), b: V33, label: 'IMU1 的 AD0 沒有接 3.3 V' },
      action: [{ kind: 'wire', wires: [['j48', 'top+39']] }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: {
    parts: ['stm32_bluepill', 'power_supply', 'at24c02', 'mpu6050_gy521', 'bme280'],
    firmware: [FW],
    instrument: 'uart',
  },
  durationMin: 45,
}
