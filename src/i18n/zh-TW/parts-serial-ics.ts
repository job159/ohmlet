/**
 * zh-TW part texts for the serial-IC family (src/model/parts/serial-ics.parts.ts):
 * AT24C02 I²C EEPROM and 74HC595 shift register. Faithful translations of
 * the catalog doc / specs / simulated / limits (same order). Pin notes and
 * manufacturers (shown through tText → tMessage) live in messages-core.ts.
 */
import type { PartText } from '../parts'

export const PARTS_ZH: Record<string, PartText> = {
  at24c02: {
    label: 'AT24C02 I²C EEPROM（2 Kbit）',
    doc: 'AT24C02 2-Kbit I²C EEPROM（DIP-8：A0 A1 A2 GND SDA SCL WP VCC）。7 位元位址為 0x50 + A2A1A0（腳位接地或浮接 = 0x50）。SDA 與 SCL 需要上拉電阻（4.7 kΩ 接 VCC）。頁寫入最多 8 位元組；每次寫入後晶片忙碌 5 ms，期間不回應 ACK（以 HAL_I2C_IsDeviceReady 輪詢）。WP 為高時禁止寫入。斷電後內容仍會保留。',
    specs: [
      '2 Kbit（256 × 8）序列 EEPROM，I²C（100 kHz／400 kHz／1 MHz）',
      '8 位元組頁寫入，自動計時寫入週期最長 5 ms',
      '位址 0x50–0x57（1010·A2A1A0），硬體寫入保護',
      '1.7 – 5.5 V，DIP-8',
    ],
    simulated: [
      '位元層級的 I²C 從端：START/STOP 偵測、位址 1010·A2A1A0、在 SDA 上回應 ACK（開汲極）、於 SCL 正緣取樣位元',
      '位元組寫入與 8 位元組頁寫入（頁內位址循環）；5 ms 自動計時寫入週期（t_WR 最大值），期間不回應位址 ACK（可用 ACK 輪詢）',
      '目前位址讀取、隨機讀取與連續讀取（位址由 0xFF 循環到 0x00）；主端 NACK 結束讀取',
      'WP 為高：資料會回應 ACK 但不寫入；A0–A2／WP 具內部下拉（浮接 = 0）',
      '非揮發性：在本次工作階段中，內容於斷電與模擬重置後仍保留（抹除狀態讀為 0xFF）',
    ],
    limits: [
      '不檢查匯流排時序（建立／保持時間、依 VCC 而定的最高 SCL 頻率）：主端產生的任何速率都能運作',
      'SDA 輸出在 SCL 下降後固定 0.3 µs 改變（t_AA）；無輸出迴轉',
      '寫入週期中斷電會遺失該次頁寫入（實際元件可能只寫入部分頁面）',
      '未模擬耐久度（100 萬次）與資料保存期限',
    ],
  },
  '74hc595': {
    label: '74HC595 移位暫存器',
    doc: "具輸出閂鎖的 74HC595 8 位元移位暫存器（DIP-16：QB QC QD QE QF QG QH GND QH' SRCLR SRCLK RCLK OE SER QA VCC）。驅動 SER（資料）與 SRCLK（時脈，即 SPI 模式 0 的 MOSI/SCK），再對 RCLK 送出一個脈波，即可在 QA–QH 顯示該位元組（最後移入的位元出現在 QA）。SRCLR 接 VCC、OE 接 GND。將 QH' 串接到第二顆 595 的 SER 可得到 16 個輸出。每個輸出都可經電阻驅動一顆 LED。",
    specs: [
      '具儲存暫存器的 8 位元串列輸入、並列輸出移位暫存器',
      "三態輸出（OE），可串接的串列輸出 QH'",
      '2 – 6 V，標準輸出驅動 ±6 mA（每腳絕對最大 ±35 mA）',
      'DIP-16',
    ],
    simulated: [
      'SRCLK 正緣將 SER 依序移過 A…H 各級；SRCLR（低態有效）非同步清除移位暫存器',
      'RCLK 正緣載入儲存暫存器（SRCLK 與 RCLK 接在一起時會落後一個時脈）',
      "OE（低態有效）：QA–QH 為推挽輸出（50 Ω）或高阻抗；串列輸出 QH' 永遠有驅動",
      '輸出在時脈邊緣後 20 ns 跟著改變，因此串接的 595 能正確移位',
    ],
    limits: [
      '傳播延遲固定為 20 ns（4.5 V 時的典型值，不隨 VCC 變化）；不檢查建立／保持時間',
      '上電時暫存器內容為 0（實際元件為不確定）',
      '浮接的控制輸入會保持上一個準位（並會回報），而非不確定',
      '輸出電流限制（每腳 ±35 mA、總計 70 mA）只由電氣規則檢查（ERC）檢查',
    ],
  },
}
