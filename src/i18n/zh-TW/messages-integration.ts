/**
 * zh-TW display translations of the messages added by the integration
 * follow-ups (Wave 3) that no other dictionary covers: the logic-analyzer
 * view settings (decoders + trigger) of the lab store and project files, and
 * the updated SPI / I²C support notes (bidirectional receive tri-states the
 * data pin; I²C LAST follows the DMA controller's EOT_1 signal). The
 * validator / engine messages of the same follow-ups (allowed rotations,
 * same-strip package pins, device issues) and the checks-bench notes are
 * translated in messages-core.ts. English stays the source text; see
 * src/i18n/messages.ts.
 */
import type { MessagePattern } from '../messages'

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- firmware-contract bench: a circuit line stating an absent part
  [
    /^"(.+)": nothing to place \(the line states the part is absent from this bench\)$/s,
    (m) => `「${m[1]}」：不需擺放元件（此行說明測試台上沒有這個元件）`,
  ],
  // ---- project files / lab store: logic-analyzer decoders + trigger (instruments.logicView)
  [
    /^(?:(instruments|logic analyzer): )?logic decoder #(\d+) is not an object — dropped$/,
    (m) => `${where(m[1])}第 ${m[2]} 個邏輯分析儀解碼器不是物件，已略過。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?"logicView\.trigger" is not an object — ignored$/,
    (m) => `${where(m[1])}邏輯分析儀的觸發設定（logicView.trigger）不是物件，已忽略。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?"logicView\.decoders" must be an array — ignored$/,
    (m) => `${where(m[1])}邏輯分析儀的解碼器清單（logicView.decoders）必須是陣列，已忽略。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?"logicView" is not an object — ignored$/,
    (m) => `${where(m[1])}邏輯分析儀的檢視設定（logicView）不是物件，已忽略。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?"logicView\.v" must be a positive integer — ignored$/,
    (m) => `${where(m[1])}邏輯分析儀檢視設定的版本（logicView.v）必須是正整數，已忽略。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?logic-analyzer settings v(\d+) come from a newer ohmlet — ignored \(decoders and trigger keep their current settings\)$/,
    (m) => `${where(m[1])}邏輯分析儀設定 v${m[2]} 來自較新版本的 ohmlet，已忽略（解碼器與觸發維持目前的設定）。`,
  ],
  [
    /^(?:(instruments|logic analyzer): )?more than (\d+) logic decoders — the rest were dropped$/,
    (m) => `${where(m[1])}邏輯分析儀解碼器超過 ${m[2]} 個，其餘已略過。`,
  ],
]

/** "instruments: " / "logic analyzer: " message prefixes → 「儀器設定：」/「邏輯分析儀：」 */
function where(prefix: string | undefined): string {
  if (prefix === 'instruments') return '儀器設定：'
  if (prefix === 'logic analyzer') return '邏輯分析儀：'
  return ''
}

/** SPI support note (src/mcu/stm32f1/spi.ts SPI_NOTES, exact text). */
const SPI_NOTES_EN =
  'Bit-level SPI on SCK/MOSI/MISO/NSS: master SCK at f_PCLK/2^(BR+1) with exact edge cycles, CPOL/CPHA modes 0–3 (MISO sampled on the right edge), 8/16-bit frames, MSB/LSB first, continuous transfers (BSY), TXE/RXNE/OVR, RXONLY and BIDIMODE/BIDIOE (bidirectional receive tri-states the data pin: AF output enable off), hardware NSS output (SSOE), software NSS (SSM/SSI), MODF, slave mode clocked by the SCK pin (NSS pin or SSI select), hardware CRC (CRCPR, TXCRCR/RXCRCR, CRCNEXT, CRCERR), interrupt and DMA request lines, AFIO SPI1 remap. Not simulated (logged): I2S (not present on the STM32F103C8).'
const SPI_NOTES_ZH =
  'SCK/MOSI/MISO/NSS 上的位元層級 SPI：主端 SCK 為 f_PCLK/2^(BR+1)，邊緣週期精確；CPOL/CPHA 模式 0–3（MISO 在正確的邊緣取樣）、8/16 位元資料框、MSB/LSB 先傳、連續傳輸（BSY）、TXE/RXNE/OVR、RXONLY 與 BIDIMODE/BIDIOE（雙向接收時資料腳位為三態高阻抗：AF 輸出致能關閉）、硬體 NSS 輸出（SSOE）、軟體 NSS（SSM/SSI）、MODF、由 SCK 腳位提供時脈的從端模式（以 NSS 腳位或 SSI 選取）、硬體 CRC（CRCPR、TXCRCR/RXCRCR、CRCNEXT、CRCERR）、中斷與 DMA 請求線、AFIO SPI1 重映射。未模擬（會記錄於日誌）：I2S（STM32F103C8 沒有此功能）。'

/** I²C support note (src/mcu/stm32f1/i2c.ts I2C_NOTES, exact text): LAST now follows the DMA controller's EOT_1 signal. */
const I2C_NOTES_EN =
  'Bit-level I²C on the SCL/SDA pins (open-drain AF outputs, wired-AND with the circuit): START / repeated START / STOP generation and detection, Sm and Fm (DUTY) SCL timing from CCR and PCLK1, clock stretching honoured through the TRISE feedback check, ACK/NACK (AF), arbitration loss (ARLO), BUSY from the line levels (a missing pull-up keeps it set), the SR1/SR2 event sequences and clearing rules ST HAL relies on (EV5–EV9, 1-/2-/N-byte reception with ACK/POS, BTF stretching, 10-bit master addressing), slave mode with 7-bit OAR1/OAR2/general call (ADDR, TxE, RxNE, STOPF, AF, SCL stretching, NOSTRETCH overrun/underrun), BERR, PEC (CRC-8 in SR2, transmission and check), event/error interrupts, DMA request lines and LAST (EOT_1 signalled by the DMA controller). Not simulated (logged): SMBus mode (SMBA pin, timeouts, ARP addresses), 10-bit slave addressing, multi-master clock synchronisation, the analog noise filter; PE = 0 takes effect at once.'
const I2C_NOTES_ZH =
  'SCL/SDA 腳位上的位元層級 I²C（開汲極 AF 輸出，與電路形成線及）：START／重複 START／STOP 的產生與偵測、由 CCR 與 PCLK1 決定的 Sm 與 Fm（DUTY）SCL 時序、透過 TRISE 回授檢查支援時脈延展、ACK/NACK（AF）、仲裁失敗（ARLO）、依線路準位判定 BUSY（缺少上拉電阻時會一直保持）、ST HAL 依賴的 SR1/SR2 事件順序與清除規則（EV5–EV9、搭配 ACK/POS 的 1／2／N 位元組接收、BTF 延展、10 位元主端定址）、支援 7 位元 OAR1/OAR2／廣播呼叫的從端模式（ADDR、TxE、RxNE、STOPF、AF、SCL 延展、NOSTRETCH 溢位／欠位）、BERR、PEC（SR2 中的 CRC-8，傳送與檢查）、事件／錯誤中斷、DMA 請求線與 LAST（由 DMA 控制器送出的 EOT_1 訊號）。未模擬（會記錄於日誌）：SMBus 模式（SMBA 腳位、逾時、ARP 位址）、10 位元從端定址、多主端時脈同步、類比雜訊濾波器；PE = 0 會立即生效。'

export const NOTES_ZH: Record<string, string> = {
  [SPI_NOTES_EN]: SPI_NOTES_ZH,
  [`${SPI_NOTES_EN} Same model as SPI1; slave mode unit-tested on SPI2.`]: `${SPI_NOTES_ZH}與 SPI1 使用相同模型；從端模式在 SPI2 上做過單元測試。`,
  [I2C_NOTES_EN]: I2C_NOTES_ZH,
  [`${I2C_NOTES_EN} Same model as I2C1; slave mode unit-tested on I2C2.`]: `${I2C_NOTES_ZH}與 I2C1 使用相同模型；從端模式在 I2C2 上做過單元測試。`,
}
