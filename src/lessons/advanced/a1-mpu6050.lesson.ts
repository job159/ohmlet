/**
 * a1 — STM32 + MPU-6050（GY-521）：I²C 暫存器存取、喚醒、刻度因數。
 *
 * Firmware: firmware/dist/hal-mpu6050 (ST HAL, I2C1 PB6/PB7 100 kHz). The
 * GY-521 sits at f40 (header VCC GND SCL SDA XDA XCL AD0 INT = f40…f47, the
 * module body covers rows b–f), its pins are reached from row j of the same
 * strips. Numbers are what the simulation produces (tests/lessons/
 * advanced.test.ts runs the solution): the firmware prints raw counts =
 * round(g × 16384) for ±2 g.
 */
import type { Lesson } from '../types'
import { GND, TAP, V5, anchored, bench, bullets, doc, pin, wire, wired } from './bench'

const FW = 'hal-mpu6050'

/** The GY-521 as the learner finds it (flat: 0 g, 0 g, 1 g, 25 °C). */
const IMU_START = anchored('IMU1', 'mpu6050_gy521', 'f40')
/** After step 5: tilted — 0.5 g on X, −0.25 g on Y, 0.75 g on Z. */
const IMU_TILTED = anchored('IMU1', 'mpu6050_gy521', 'f40', { accelX: 0.5, accelY: -0.25, accelZ: 0.75 })

const START = bench('a1 MPU-6050（起始）', [IMU_START], [])

const SOLUTION = bench(
  'a1 MPU-6050（解答）',
  [IMU_TILTED],
  [
    wire('W7', 'j40', 'bot+31', 'red'), // VCC → 5 V (the module's own 3.3 V regulator)
    wire('W8', 'j41', 'bot-32', 'black'), // GND
    wire('W9', 'j42', 'j23', 'yellow'), // SCL → PB6
    wire('W10', 'j43', 'j24', 'green'), // SDA → PB7
  ],
)

export const LESSON: Lesson = {
  id: 'a1-mpu6050',
  level: 'advanced',
  order: 1,
  title: 'STM32 + MPU-6050：I²C 暫存器存取與刻度因數',
  summary:
    '把 GY-521（MPU-6050 六軸感測器）接到 Blue Pill 的 I2C1，執行真正的 HAL 韌體：讀 WHO_AM_I、清除 `SLEEP` 位元讓晶片離開睡眠模式、設定 ±2 g / ±250 °/s，再用 14 位元組連續讀取取得加速度、溫度與角速度，並用 16384 LSB/g 的刻度因數換算成 g。',
  objectives: [
    '說明 I²C 的開汲極（`open-drain`）匯流排、上拉電阻與 7 位元位址 0x68（AD0 = 0）',
    '解讀一次「暫存器讀取」在線上的位元組順序：START、0xD0、暫存器位址、重複 START、0xD1、資料、NACK、STOP',
    '知道 MPU-6050 上電後處於睡眠模式（PWR_MGMT_1 = 0x40），必須寫 0x00 才會開始取樣',
    '用刻度因數把原始值換算成物理量：±2 g → 16384 LSB/g，±250 °/s → 131 LSB/(°/s)，溫度 = 原始值 ÷ 340 + 36.53 °C',
    '改變感測器的加速度參數，確認韌體印出的原始值完全符合 g × 16384',
  ],
  wiring: doc(
    '本課的麵包板已經放好 Blue Pill（U1）與電源：PS1 的 5 V 經 **下方 + 軌**（bot+）送進 Blue Pill 的 5V 腳，板上 3.3 V 穩壓器的輸出接到 **上方 + 軌**（top+），兩條 − 軌都是 GND。GY-521 模組（IMU1）已插在 `f40`，排針由左到右是 VCC、GND、SCL、SDA、XDA、XCL、AD0、INT（`f40`～`f47`）；模組本體蓋住 b–f 列，請從同一欄的 **j 列** 拉線。',
    bullets(
      'VCC：`j40`（j 列第 40 欄）→ `bot+31`（下方 + 電源軌第 31 孔，5 V）。GY-521 板上有 662K（XC6206）3.3 V 穩壓器，壓降約 0.25 V：VCC 接 5 V，晶片才能得到完整的 3.3 V；若 VCC 只接 3.3 V，穩壓器輸出只剩約 3.05 V（仍可工作，但電氣規則檢查會提示風險）。',
      'GND：`j41` → `bot-32`。',
      'SCL：`j42` → `j23`（**U1 PB6（板上 B6）** = I2C1_SCL）。建議用黃色線。',
      'SDA：`j43` → `j24`（**U1 PB7（板上 B7）** = I2C1_SDA）。建議用綠色線。',
      'XDA、XCL、AD0、INT 不接：AD0 在模組上經 4.7 kΩ 下拉到 GND，所以位址是 0x68。',
    ),
    '不需要另外加上拉電阻：GY-521 板上已有 SCL、SDA 各一顆 4.7 kΩ 上拉到它自己的 3.3 V。開發板的韌體已選好 `hal-mpu6050`；USART1（U1 PA9（板上 A9），115200 8N1）的輸出可在「UART 終端機」看到。',
  ),
  theory: doc(
    '**I²C 匯流排**：SCL（時脈）與 SDA（資料）兩條線都是開汲極——任何裝置只能把線「拉低」，放開時由上拉電阻拉回高電位。所以線上一定要有上拉電阻（本課由 GY-521 提供 4.7 kΩ），STM32 的腳位也設成 `GPIO_MODE_AF_OD`。100 kHz 標準模式下一個位元 10 µs，一個位元組加上 ACK 共 9 個時脈，約 90 µs。',
    '**位址**：MPU-6050 的 7 位元位址是 0b110100X，X = AD0 腳。AD0 = 0 → **0x68**；AD0 = 1 → 0x69。線上傳送的第一個位元組是「位址 << 1 | R/W」：寫入 0xD0、讀取 0xD1。HAL 的 `HAL_I2C_Mem_Read(&hi2c1, 0x68 << 1, …)` 要傳入左移後的位址。',
    '**讀一個暫存器**（例如 WHO_AM_I = 0x75）：',
    bullets(
      'START → 0xD0（寫）→ ACK → 0x75（暫存器位址）→ ACK',
      '重複 START → 0xD1（讀）→ ACK → 晶片送出 0x68 → 主機回 NACK（表示只要一個位元組）→ STOP',
      '共 3 個位元組 × 9 位元 ≈ 27 個時脈，加上 START/STOP，約 0.3 ms',
    ),
    '**上電即睡眠**：MPU-6050 重置後 PWR_MGMT_1（0x6B）= 0x40，`SLEEP` 位元為 1，所有量測暫存器保持 0。韌體必須寫入 0x00 清除 `SLEEP`。接著設定：CONFIG（0x1A）= 0x03（數位低通 44 Hz，陀螺儀輸出率 1 kHz）、SMPLRT_DIV（0x19）= 9（取樣率 = 1 kHz ÷ (1 + 9) = 100 Hz）、GYRO_CONFIG（0x1B）= 0（±250 °/s）、ACCEL_CONFIG（0x1C）= 0（±2 g）。',
    '**刻度因數**：16 位元有號整數 −32768～+32767 對應整個量程。',
    bullets(
      '加速度：±2 g → 32768 ÷ 2 = **16384 LSB/g**；±4 g → 8192、±8 g → 4096、±16 g → 2048 LSB/g',
      '角速度：±250 °/s → **131 LSB/(°/s)**；±500 → 65.5、±1000 → 32.8、±2000 → 16.4',
      '溫度：T = 原始值 ÷ 340 + 36.53 °C；25 °C → 原始值 = (25 − 36.53) × 340 ≈ −3920',
    ),
    '**連續讀取**：從 ACCEL_XOUT_H（0x3B）一次讀 14 個位元組，依序是 AX、AY、AZ、TEMP、GX、GY、GZ，每個都是高位元組在前（`big-endian`）。一次讀取保證 7 個值來自同一個取樣時刻。在 100 kHz 下：位址 + 暫存器 + 位址 + 14 個資料 = 17 個位元組 × 9 位元 ≈ 153 個時脈，約 1.6 ms。',
    '**換算範例**：模組平放時只有 Z 軸受 1 g → az = 16384。把 X 軸設為 0.5 g、Y 軸 −0.25 g、Z 軸 0.75 g：ax = 0.5 × 16384 = 8192，ay = −4096，az = 12288。由 ax、az 可算出俯仰角 `atan(8192 ÷ 12288)` ≈ 33.7°。',
  ),
  start: { layout: START, firmware: { U1: FW } },
  solution: { layout: SOLUTION, firmware: { U1: FW } },
  expected: [
    'UART 開機訊息：`MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)`、`WHO_AM_I=0x68`、`awake: +-2 g, +-250 dps, 100 Hz`',
    '平放（0 g、0 g、1 g、25 °C）：每 100 ms 一行 `ax=0 ay=0 az=16384 gx=0 gy=0 gz=0 t=25.00`',
    '加速度 X = 0.5 g、加速度 Y = −0.25 g、加速度 Z = 0.75 g：`ax=8192 ay=-4096 az=12288`（誤差在 1 LSB 以內）',
    '角速度 Z = 90 °/s：gz = 90 × 131 = 11790',
    '邏輯分析儀接 U1 PB6（板上 B6）：SCL 時脈週期 10 µs（100 kHz），每 100 ms 出現一串約 1.6 ms 的連續讀取',
  ],
  // `match` ties a mistake to the pass / fail pattern of the acceptance checks below
  // (0 GY-521 · 1 VCC · 2 GND · 3 SCL · 4 SDA · 5 PB12 open · 6 firmware · 7 WHO_AM_I
  // · 8 awake · 9 tilted raw values · 10 ERC) — the check results show it as 「最可能的原因」.
  mistakes: [
    {
      symptom: 'UART 顯示 `MPU-6050 not found at 0x68`，模組的電源燈是亮的',
      cause: 'SCL、SDA 沒有接到 U1 PB6／PB7，或兩條線接反了（電氣規則檢查會提示「SDA 與 SCL 看起來接反」）：STM32 在 SDA 線上送時脈，晶片永遠等不到正確的位址位元組，第 9 個時脈沒有 ACK，HAL 回傳錯誤',
      fix: '`j42`（SCL）接 `j23`（U1 PB6（板上 B6）），`j43`（SDA）接 `j24`（U1 PB7（板上 B7）），然後重新執行',
      match: { checks: [3, 4], passes: [1, 2] },
    },
    {
      symptom: '每行都是 `ax=0 ay=0 az=0 gx=0 gy=0 gz=0 t=36.53`，改加速度參數也沒反應',
      cause: '感測器還在睡眠：PWR_MGMT_1 沒被寫成 0x00。可以在模擬器重現——把 U1 PB12（板上 B12）的空孔 `j10` 接到 GND，再用「更多」→「重置模擬」讓整個電路重新上電，這個韌體就會跳過喚醒步驟，印出 `PB12 low: PWR_MGMT_1 not written, the sensor stays asleep`',
      fix: '初始化時寫 PWR_MGMT_1 = 0x00；在本課拆掉 `j10` 的接地線並再「重置模擬」一次',
      match: { checks: [5] },
    },
    {
      symptom: '`MPU-6050 not found at 0x68`，但接線看起來都對',
      cause: 'AD0 被接到 3.3 V，晶片位址變成 0x69，韌體卻呼叫 0x68',
      fix: 'AD0 保持不接（模組內建下拉）或接 GND；若需要兩顆 MPU-6050 共用匯流排，第二顆接 AD0 = 1 並在程式中使用 0x69',
      match: { checks: [7], passes: [1, 2, 3, 4, 5, 6] },
    },
    {
      symptom: 'UART 顯示 `MPU-6050 not found at 0x68`，之後沒有任何資料',
      cause: 'VCC、GND、SCL 或 SDA 有一條沒接好：模組沒電或匯流排斷了，晶片不會在第 9 個時脈把 SDA 拉低（沒有 ACK），HAL 回傳錯誤',
      fix: '確認 VCC（`j40`）接 5 V、GND（`j41`）接 GND、`j42` 接 U1 PB6、`j43` 接 U1 PB7，然後重新執行',
      match: { checks: [7], passes: [6] },
    },
    {
      symptom: '換算出的加速度是正確值的 4 倍或 1/4',
      cause: '刻度因數和 ACCEL_CONFIG 不一致：例如設成 ±8 g（4096 LSB/g）卻仍除以 16384',
      fix: '依 AFS_SEL 選擇刻度因數：0 → 16384、1 → 8192、2 → 4096、3 → 2048 LSB/g',
    },
  ],
  acceptance: [
    { kind: 'has-part', type: 'mpu6050_gy521', label: '電路中有 GY-521（MPU-6050）模組' },
    wired('IMU1', 'VCC', V5, 'IMU1 的 VCC 接到 5 V'),
    wired('IMU1', 'GND', GND, 'IMU1 的 GND 接到 GND'),
    wired('IMU1', 'SCL', pin('PB6'), 'IMU1 SCL 接到 U1 PB6（板上 B6，I2C1_SCL）'),
    wired('IMU1', 'SDA', pin('PB7'), 'IMU1 SDA 接到 U1 PB7（板上 B7，I2C1_SDA）'),
    { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12（板上 B12）沒有接地（感測器會被喚醒）' },
    { kind: 'firmware-loaded', component: 'U1', project: FW, label: 'U1 已載入 hal-mpu6050 韌體' },
    { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'WHO_AM_I=0x68', seconds: 1, label: '讀到 WHO_AM_I = 0x68' },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'awake: +-2 g, +-250 dps, 100 Hz',
      seconds: 1,
      label: '感測器已喚醒並設定為 ±2 g / ±250 °/s / 100 Hz',
    },
    {
      kind: 'uart-contains',
      component: 'U1',
      port: 'USART1',
      text: 'ax=8192 ay=-4096 az=12288 ',
      seconds: 1.5,
      label: '加速度原始值等於 0.5 g、−0.25 g、0.75 g × 16384',
    },
    { kind: 'erc-clean', label: '電氣規則檢查沒有錯誤' },
  ],
  steps: [
    {
      id: 'power',
      title: '幫 GY-521 供電',
      body: doc(
        '用「導線」工具接 `j40`（VCC）→ `bot+31`（下方 + 電源軌第 31 孔 = 5 V），再接 `j41`（GND）→ `bot-32`（下方 − 電源軌 = GND）。',
        'GY-521 的排針在 `f40`～`f47`，模組本體蓋住了 b–f 列，所以從同一欄的 **j 列**接線。模組上的電源 LED 會亮起。GY-521 內建 662K 穩壓器把 5 V 降成 3.3 V 給 MPU-6050，SCL/SDA 的 4.7 kΩ 上拉也接在這個 3.3 V 上——所以匯流排是 3.3 V 準位，可以直接接 STM32。',
      ),
      // the module too: the phone coach folds while 「開始接線」 runs, so the framing keeps the rail holes above the wire-mode chrome
      highlight: { holes: ['j40', 'j41', 'bot+31', 'bot-32'], components: ['IMU1'] },
      check: { kind: 'all', checks: [wired('IMU1', 'VCC', V5), wired('IMU1', 'GND', GND)], label: 'IMU1 的 VCC 接 5 V、GND 接 GND' },
    },
    {
      id: 'i2c',
      title: '接上 I²C：SCL → U1 PB6、SDA → U1 PB7',
      body: doc(
        '按下方的「開始接線」，接 `j42`（SCL）→ `j23`（U1 PB6（板上 B6）），再接 `j43`（SDA）→ `j24`（U1 PB7（板上 B7））。',
        'STM32F103 的 I2C1 預設腳位是 **PB6 = SCL**、**PB7 = SDA**（RM0008 表 33）。在 Blue Pill 上它們位於 `h23`、`h24`，可用的空孔是 `j23`、`j24`。兩條線上都已經有 GY-521 的 4.7 kΩ 上拉電阻，不要再接到 5 V——STM32 的 PB6/PB7 雖然耐 5 V，但 MPU-6050 的 I/O 最高只能 VDD + 0.5 V。',
      ),
      highlight: { holes: ['j42', 'j43', 'j23', 'j24'], components: ['IMU1', 'U1'] },
      check: {
        kind: 'all',
        checks: [wired('IMU1', 'SCL', pin('PB6')), wired('IMU1', 'SDA', pin('PB7'))],
        label: 'SCL 接 U1 PB6、SDA 接 U1 PB7',
      },
    },
    {
      id: 'who-am-i',
      title: '執行：讀 WHO_AM_I 並喚醒晶片',
      body: doc(
        '按上方的「▶ 執行模擬」（或空白鍵），打開儀器的「UART 終端機」，看到 `WHO_AM_I=0x68` → `awake: +-2 g, +-250 dps, 100 Hz`。',
        '韌體會先用 `HAL_I2C_Mem_Read` 讀暫存器 0x75，晶片回 0x68，再寫 PWR_MGMT_1 = 0x00 讓它離開睡眠。接著每 100 ms 會出現一行 `ax=0 ay=0 az=16384 …`：平放時只有 Z 軸感受到 1 g = 16384 LSB。按下方的「把 PB6、PB7 加到邏輯分析儀」，可以觀察一次 14 位元組的連續讀取。',
      ),
      highlight: { components: ['U1', 'IMU1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'WHO_AM_I=0x68', seconds: 1 },
      action: [{ kind: 'run' }, { kind: 'add-logic', component: 'U1', pins: ['PB6', 'PB7'] }],
    },
    {
      id: 'scale',
      title: '傾斜感測器：驗證刻度因數',
      body: doc(
        '點一下 IMU1，在屬性面板把 **加速度 X** 設為 0.5 g、**加速度 Y** 設為 −0.25 g、**加速度 Z** 設為 0.75 g，終端機的下一行就應該出現 `ax=8192 ay=-4096 az=12288`。',
        '韌體印出的是原始值，換算：0.5 × 16384 = **8192**、−0.25 × 16384 = **−4096**、0.75 × 16384 = **12288**。再試試 **角速度 Z** = 90 °/s：gz 應為 90 × 131 = 11790。',
      ),
      highlight: { components: ['IMU1'] },
      check: { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'ax=8192 ay=-4096 az=12288 ', seconds: 1.5 },
    },
    {
      id: 'sleep-experiment',
      title: '實驗：忘記喚醒會怎樣？',
      body: doc(
        '按下方的「開始接線」，接 `j10`（U1 PB12（板上 B12）的空孔）→ `bot-6`，再按下方的「重置模擬」讓整個電路重新上電：所有讀數都變成 0。做完實驗後**把這條線拆掉，再按一次「重置模擬」**，驗收條件要求 U1 PB12 不接地。',
        '為什麼不能只按「重置 MCU」？那只重新啟動 STM32，MPU-6050 沒有斷電，還記得上一次被寫入的 PWR_MGMT_1 = 0x00，照樣醒著送資料——實際電路也一樣。所以可靠的初始化程式會先寫 PWR_MGMT_1 = 0x80（`DEVICE_RESET`），讓感測器自己回到上電狀態。',
        '這個韌體在開機時讀 U1 PB12：如果它被接地，就**不寫** PWR_MGMT_1，晶片一直停在睡眠模式。溫度固定是 36.53 °C（原始值 = 0 → 0 ÷ 340 + 36.53）。這正是實際專案中最常見的「讀得到 WHO_AM_I，但資料全是 0」。',
      ),
      highlight: { holes: ['j10', 'bot-6'] },
      check: { kind: 'not-connected', a: pin('PB12'), b: GND, label: 'U1 PB12 沒有接地' },
      action: [{ kind: 'wire', wires: [[TAP.PB12, 'bot-6']] }, { kind: 'reset', scope: 'circuit' }, { kind: 'run' }],
    },
  ],
  runnable: 'ready',
  requires: { parts: ['mpu6050_gy521', 'stm32_bluepill', 'power_supply'], firmware: [FW], instrument: 'uart' },
  durationMin: 40,
}
