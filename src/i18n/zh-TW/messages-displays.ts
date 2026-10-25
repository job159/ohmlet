/**
 * zh-TW runtime messages of the display-module family
 * (src/sim/models/displays.model.ts + displays-*.ts): the SSD1306 / SH1106
 * OLED command notes, the HD44780 timing / busy / contrast hints, the
 * ST7735 / ILI9341 TFT notes, the WS2812B timing hints and the input-level
 * warnings shared by the logic-level display drivers. Issues carry the
 * component id through the generic «id»: «message» wrapper of
 * messages-core ("OLED1: SSD1306 input SCL is floating …"). Chip names,
 * command bytes (8Dh, A8h, 2Fh), register mnemonics (CASET, COLMOD, RESX),
 * pin names, numbers and units stay verbatim; Chinese sentences use
 * full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- input levels shared by every logic-level display driver (displays-i2c.ts InputWatch)
  tpl('«chip!» input «pin!» is floating (CMOS inputs must be driven)', (g) => `${g.chip} 的輸入腳位 ${g.pin} 浮接（CMOS 輸入必須有驅動）`),
  tpl(
    '«chip!» input «pin!» is at «v» V, between V_IL and V_IH = «vih» V («f»·VDD): no valid logic level — power the part lower or use a level shifter',
    (g) =>
      `${g.chip} 的輸入腳位 ${g.pin} 為 ${g.v} V，介於 V_IL 與 V_IH = ${g.vih} V（${g.f}·VDD）之間：不是有效的邏輯準位——請降低元件的供電電壓，或使用電位轉換器`,
  ),

  // ---- SSD1306 / SH1106 OLED controllers (displays-ssd1306.ts)
  tpl(
    'SH1106 read-modify-write (0x«b!») is not modeled (data reads are not available on the serial interface)',
    (g) => `未模擬 SH1106 的讀取—修改—寫入（0x${g.b}）（序列介面無法讀取資料）`,
  ),
  tpl(
    'SH1106 ignored unknown command byte 0x«b!» (not an SH1106 command — an SSD1306 driver?)',
    (g) => `SH1106 已忽略未知的指令位元組 0x${g.b}（不是 SH1106 指令——是否使用了 SSD1306 的驅動程式？）`,
  ),
  tpl(
    'SSD1306 2Fh (activate scroll) without a scroll setup (26h/27h/29h/2Ah) — ignored',
    () => 'SSD1306 收到 2Fh（啟動捲動），但尚未設定捲動（26h/27h/29h/2Ah）——已忽略',
  ),
  tpl('SSD1306 ignored unknown command byte 0x«b!»', (g) => `SSD1306 已忽略未知的指令位元組 0x${g.b}`),
  tpl('SSD1306 20h: memory addressing mode 3 is invalid', () => 'SSD1306 20h：記憶體定址模式 3 無效'),
  tpl(
    '«chip!» A8h: multiplex ratio «m» is below the minimum 16 — ignored',
    (g) => `${g.chip} A8h：多工比 ${g.m} 低於最小值 16——已忽略`,
  ),
  tpl('SSD1306 «c!»h (fade / zoom) is accepted but not modeled', (g) => `SSD1306 ${g.c}h（淡出／放大）會被接受，但未模擬`),

  // ---- HD44780 character LCDs (displays-hd44780.ts)
  tpl(
    'HD44780 enable pulse «ns» ns is shorter than PW_EH = 230 ns: a real module may miss this write',
    (g) => `HD44780 的致能（E）脈波 ${g.ns} ns 短於 PW_EH = 230 ns：實際模組可能會漏掉這次寫入`,
  ),
  tpl(
    'HD44780 ignored «w=a data|an instruction» write while busy (BF = 1): poll the busy flag or wait 37 µs (1.52 ms after clear / home) between writes, and ≥ 15 ms after power-up',
    (g) =>
      `HD44780 在忙碌中（BF = 1）忽略了一次${g.w === 'a data' ? '資料' : '指令'}寫入：請輪詢忙碌旗標，或在兩次寫入之間等待 37 µs（清除／歸位後 1.52 ms），通電後至少等待 15 ms`,
  ),
  tpl(
    'HD44780 DDRAM address 0x«a!» is outside the 2-line ranges 00h–27h / 40h–67h',
    (g) => `HD44780 DDRAM 位址 0x${g.a} 不在雙行模式的範圍 00h–27h／40h–67h 內`,
  ),
  tpl(
    'LCD contrast: V_LCD = VDD − V0 = «v» V is too low to show the characters — wire V0 to the wiper of a 10 kΩ pot (≈ 0.3–1 V) or through ≈ 1 kΩ to GND',
    (g) =>
      `LCD 對比：V_LCD = VDD − V0 = ${g.v} V 太低，無法顯示字元——請把 V0 接到 10 kΩ 可變電阻的中間腳（約 0.3–1 V），或經約 1 kΩ 接到 GND`,
  ),

  // ---- ST7735 / ILI9341 TFT controllers (displays-tft.ts)
  tpl(
    '«chip!» ignored SPI bytes sent within 5 ms of a reset (wait ≥ 5 ms after RESX / SWRESET, 120 ms before SLPOUT)',
    (g) => `${g.chip} 已忽略重置後 5 ms 內送來的 SPI 位元組（RESX／SWRESET 後至少等待 5 ms，SLPOUT 前需等待 120 ms）`,
  ),
  tpl(
    '«chip!» partial mode (12h) is accepted but not modeled (the whole panel stays active)',
    (g) => `${g.chip} 的部分顯示模式（12h）會被接受，但未模擬（整個面板維持顯示）`,
  ),
  tpl(
    '«chip!» «w=CASET|RASET»: start «s» > end «e» (undefined window on the real controller)',
    (g) => `${g.chip} ${g.w}：起點 ${g.s} 大於終點 ${g.e}（實際控制器上視窗未定義）`,
  ),
  tpl(
    '«chip!» COLMOD 0x«c!»: interface format «f» is not 12/16/18-bit — treated as 18-bit',
    (g) => `${g.chip} COLMOD 0x${g.c}：介面格式 ${g.f} 不是 12／16／18 位元——以 18 位元處理`,
  ),

  // ---- WS2812B strip (displays-leds.ts)
  tpl(
    'WS2812B: a «t» low pause inside the data stream does not latch (RES needs ≥ 280 µs) — the following bits continue the same frame',
    (g) => `WS2812B：資料串中 ${g.t} 的低準位停頓不會鎖存（RES 需要 ≥ 280 µs）——後續的位元會接續同一個畫面`,
  ),
  tpl(
    'WS2812B: DIN high is «v» V, below V_IH = 0.7·VDD = «vih» V',
    (g) => `WS2812B：DIN 的高準位只有 ${g.v} V，低於 V_IH = 0.7·VDD = ${g.vih} V`,
  ),
  tpl(
    'WS2812B: «t» high pulse is outside T0H 0.25–0.55 µs / T1H 0.65–0.95 µs — read as «b» (the chip samples DIN 0.6 µs after the rising edge)',
    (g) => `WS2812B：${g.t} 的高準位脈波超出 T0H 0.25–0.55 µs／T1H 0.65–0.95 µs——讀成 ${g.b}（晶片在正緣後 0.6 µs 取樣 DIN）`,
  ),
  tpl(
    'WS2812B: reset after «n» bits (not a multiple of 24): LED «i» kept its previous colour',
    (g) => `WS2812B：在 ${g.n} 個位元後重置（不是 24 的倍數）：第 ${g.i} 顆 LED 保持原本的顏色`,
  ),
]
