/**
 * zh-TW part texts for the display-module family
 * (src/model/parts/displays.parts.ts): SSD1306 / SH1106 OLEDs, HD44780
 * character LCDs (parallel and PCF8574 I²C backpack), ST7735S / ILI9341
 * SPI TFTs, the MAX7219 8×8 matrix, the WS2812B strip and the TM1637
 * 4-digit display. Faithful translations of the catalog doc / specs /
 * simulated / limits (same order and item counts). Pin notes, part numbers
 * and manufacturers (shown through tText) live in catalog-text-displays.ts.
 */
import type { PartText } from '../parts'

const OLED_COLOR = { white: '白色', blue: '藍色', 'yellow-blue': '黃藍雙色' }
const PANEL_COLOR = { blue: '藍底白字', 'yellow-green': '黃綠底黑字' }

/** OLED_SSD1306_SIM (5 items) */
const OLED_SSD1306_SIM = [
  'SSD1306 指令集：顯示開／關、對比、正常／反相、全部點亮、多工比、顯示偏移、起始行、區段重映射、COM 掃描方向、COM 腳位設定（循序／交替、左右重映射），時脈分頻／預充電／VCOMH（只儲存）',
  'GDDRAM 128 × 64，支援水平、垂直與頁定址，行／頁視窗以及頁模式的行位址半位元組',
  '電荷泵（8Dh）：沒有送出 8Dh 14h 時，即使 RAM 中已有影像，面板仍維持全暗（模組上沒有外部 VCC）',
  '連續水平捲動（26h/27h）與垂直加水平捲動（29h/2Ah），依 D5h/D9h/A8h 的畫面更新率計時；捲動會像實際晶片一樣旋轉 GDDRAM',
  '通電時 GDDRAM 為亂數內容（每個元件固定種子），暫存器為重置值；玻璃上的影像由 RAM 與暫存器推導而來',
]
/** OLED_LIMITS (5 items) */
const OLED_LIMITS = [
  '不回應讀取傳輸（狀態／資料讀取）',
  '淡出／放大（23h、D6h）會被接受但未模擬；未使用 A3h 垂直捲動區域（垂直偏移會移動整個面板）',
  '畫面更新率以振盪器設定（D5h）的線性近似計算；預充電／VCOMH 不會改變影像亮度',
  '面板本身不消耗電源電流（只有穩壓器與上拉電阻是電氣模型）',
  '不檢查匯流排時序（建立／保持時間、最高時脈）',
]
const OLED_THRESHOLDS =
  '輸入臨界值是以 VCC 的比例表示，依 VCC = 5 V 時 3.3 V 穩壓輸出擬合（VIL 0.66 V、VIH 2.64 V）；VCC = 3.3 V 時模型的 VIH（1.74 V）低於實際的 2.6 V'

/** LCD_SIM (6 items) */
const LCD_SIM = [
  'HD44780U 指令集：清除、歸位、輸入模式（I/D、S）、顯示／游標／閃爍、游標與畫面移位、功能設定（DL、N、F）、CGRAM 與 DDRAM 位址、資料寫入與讀取、忙碌旗標與位址讀取',
  '8 位元與 4 位元介面（先送高半位元組），寫入在 E 下降緣鎖存，讀取時於 E 為高期間驅動輸出；RS、R/W 與 DB0–DB7 具內部上拉',
  '執行時間 37 µs／1.52 ms（清除、歸位），通電後忙碌 10 ms：BF = 1 時的寫入會被忽略並回報',
  '8 個 CGRAM 自訂字元，雙行 DDRAM 定址與畫面移位；內部通電重置（8 位元、單行、顯示關閉）',
  '對比由 V_LCD = VDD − V0 決定，VDD 到 V0 之間有約 10 kΩ 的偏壓分壓（V0 浮接時會被拉到 VDD：完全看不見）：低於約 3 V 時字元逐漸消失；單行模式（未初始化）會顯示一排深色方塊',
  '背光 = 模組上的 LED（A/K + 100 Ω），以電氣子電路模擬；會顯示游標與閃爍（270 kHz 時週期 379 ms）',
]
/** LCD_LIMITS (4 items) */
const LCD_LIMITS = [
  '不檢查匯流排建立／保持時間（太短的 E 脈波只會回報）',
  '5×10 字型（F = 1）以 5×8 繪製；字元 ROM 為 A00 字碼頁（ASCII + 日文）',
  '偏壓分壓以單一 10 kΩ 電阻表示（未模擬實際的分壓階梯抽頭）；對比與 V_LCD 的關係是依 5 V STN 模組擬合的曲線',
  '輸入臨界值採 5 V 時的數值（VIH 2.2 V、VIL 0.6 V），以 VDD 的比例表示',
]

export const PARTS_ZH: Record<string, PartText> = {
  // ------------------------------------------------------------- OLEDs
  ssd1306_i2c: {
    label: 'OLED 0.96" 128×64 I²C（SSD1306）',
    doc: 'SSD1306 0.96" 128×64 OLED 模組，I²C 介面，排針 GND VCC SCL SDA（4 腳，`at` = 第 j 列的 GND；模組會蓋在麵包板前緣——其下方的底部電源軌孔位請保持空著；旋轉 180 並把定位點放在第 a 列，模組就會位於麵包板後方）。I²C 位址 0x3C（參數「I²C 位址」設為 0x3D = 另一個跳線位置）。上拉電阻與 3.3 V 穩壓器都在模組上：VCC 可接 3.3 V 或 5 V，SCL/SDA 直接接到 I2C1（PB6/PB7）。初始化方式與常見函式庫相同：AEh、D5h 80h、A8h 3Fh、D3h 00h、40h、8Dh 14h（電荷泵——少了它螢幕會維持全暗）、20h 00h、A1h、C8h、DAh 12h、81h CFh、D9h F1h、DBh 40h、A4h、A6h、AFh；之後以控制位元組 40h 送出 GDDRAM 資料。',
    specs: [
      '128 × 64 單色 OLED，0.96"（有效顯示區 21.7 × 10.9 mm）',
      'SSD1306 控制器，I²C 位址 0x3C（設定位址跳線後為 0x3D）',
      'VCC 3.3–5 V（板載 3.3 V LDO），板載 4.7 kΩ 上拉電阻',
      '必須啟用電荷泵（8Dh 14h）才會發光',
    ],
    simulated: [
      '位元層級的 I²C 從端：START/STOP、7 位元位址 0x3C（或依模組跳線為 0x3D）、ACK、控制位元組 Co／D/C# 資料串',
      ...OLED_SSD1306_SIM,
      '模組：662K 3.3 V 穩壓器與 4.7 kΩ SCL/SDA 上拉電阻，以電氣子電路模擬',
    ],
    limits: [...OLED_LIMITS, OLED_THRESHOLDS],
    params: { address: 'I²C 位址（模組跳線）', color: 'OLED 顏色' },
    options: { color: OLED_COLOR },
  },
  ssd1306_spi: {
    label: 'OLED 0.96" 128×64 SPI（SSD1306，7 腳）',
    doc: 'SSD1306 0.96" 128×64 OLED 模組，4 線式 SPI，排針 GND VCC D0 D1 RES DC CS（`at` = 第 j 列的 GND，模組蓋在麵包板前緣；旋轉 180 = 位於麵包板後方）。D0 = SCK、D1 = MOSI（SPI1：PA5／PA7，模式 0），DC = 資料／指令 GPIO，CS = 晶片選擇 GPIO（低態有效），RES = 重置 GPIO（拉低 ≥ 3 µs 後再拉高）。指令集與 I²C 模組相同（DC 為低時送指令，DC 為高時送 GDDRAM 資料）；8Dh 14h 啟用電荷泵。',
    specs: [
      '128 × 64 單色 OLED，0.96"',
      'SSD1306 控制器，4 線式 SPI，最高 10 MHz（模式 0 或 3）',
      'VCC 3.3–5 V（板載 3.3 V LDO）；3.3 V 邏輯',
    ],
    simulated: [
      '4 線式 SPI：CS# 為低時於 SCLK 正緣取樣 SDIN，D/C# 在第 8 個位元時取樣，CS# 拉高會重設位元計數；RES# 為低時重置暫存器',
      ...OLED_SSD1306_SIM,
      '模組：662K 3.3 V 穩壓器，以電氣子電路模擬',
    ],
    limits: [
      ...OLED_LIMITS,
      '不強制最高 SCLK 速率（10 MHz）',
      '通電時即使沒有 RES# 脈波，暫存器也會重置',
      OLED_THRESHOLDS,
    ],
    params: { color: 'OLED 顏色' },
    options: { color: OLED_COLOR },
  },
  sh1106_i2c: {
    label: 'OLED 1.3" 128×64 I²C（SH1106）',
    doc: 'SH1106 1.3" 128×64 OLED 模組，I²C 介面，排針 VCC GND SCL SDA（VCC 在第一腳！`at` = 第 j 列的 VCC，模組蓋在麵包板前緣；旋轉 180 = 位於麵包板後方）。位址 0x3C。SH1106 的 RAM 有 132 行，而且只有頁定址：每一頁先送 B0h+頁碼、行位址 02h/10h（玻璃從第 2 行開始），再送 128 個資料位元組。使用水平模式（20h）的 SSD1306 驅動程式會顯示偏移、錯亂的影像。重置後 DC-DC 就已開啟（不需要 8Dh）。',
    specs: [
      '128 × 64 單色 OLED，1.3"（有效顯示區 29.4 × 14.7 mm）',
      'SH1106 控制器：132 × 64 RAM，只有頁定址，玻璃對應第 2–129 行',
      'I²C 位址 0x3C，VCC 3.3–5 V（板載 LDO 與上拉電阻）',
    ],
    simulated: [
      '位元層級的 I²C 從端：START/STOP、7 位元位址 0x3C（跳線為 0x3D）、ACK、控制位元組 Co／D/C#',
      'SH1106 指令集：涵蓋 132 行的頁定址（玻璃顯示第 2–129 行）、對比、顯示開／關、反相、全部點亮、區段重映射、COM 掃描、多工比、偏移、起始行、COM 腳位、DC-DC（ADh，重置後即開啟）',
      '未知的位元組會像實際晶片一樣被忽略，因此 SSD1306 專用指令（20h、21h、22h、8Dh）的參數會變成誤送的指令——也就是 SSD1306 驅動程式用在 SH1106 上時那種偏移、錯亂的畫面',
      '通電時 GDDRAM 為亂數內容（每個元件固定種子）',
      '模組：662K 3.3 V 穩壓器與 4.7 kΩ SCL/SDA 上拉電阻，以電氣子電路模擬',
    ],
    limits: [
      '未模擬讀取傳輸與讀取—修改—寫入（E0h/EEh）',
      '行位址從 131 循環回 0',
      ...OLED_LIMITS.slice(2),
      OLED_THRESHOLDS,
    ],
    params: { address: 'I²C 位址（模組跳線）', color: 'OLED 顏色' },
    options: { color: { white: '白色', blue: '藍色' } },
  },

  // ------------------------------------------------------ character LCDs
  lcd1602: {
    label: 'LCD1602 16×2 字元型 LCD（HD44780）',
    doc: 'LCD1602 16×2 字元型 LCD（HD44780），16 腳排針 VSS VDD V0 RS RW E D0–D7 A K（`at` = 第 j 列的 VSS；模組蓋在麵包板前緣，其下方的底部電源軌孔位請保持空著）。電源：VSS→GND、VDD→5 V；背光 A→5 V（板上有 100 Ω）、K→GND；V0 接到跨在 5 V 與 GND 之間的 10 kΩ 可變電阻中間腳（或經約 1 kΩ 接 GND）。4 位元模式：RS、E 與 D4–D7 接 GPIO（若要讀取忙碌旗標，請用 PB10–PB15 這類 FT 腳位），RW 接 GND（或接 GPIO），D0–D3 空接。初始化：等待 50 ms，送半位元組 3h 三次（間隔 ≥ 4.1 ms、100 µs），再送 2h，之後 28h、08h、01h（1.52 ms）、06h、0Ch。第 1 行出現一排深色方塊表示尚未初始化。',
    specs: [
      '16 × 2 字元，5 × 8 點，STN 面板附 LED 背光',
      '相容 HD44780 的控制器，8 位元或 4 位元並列匯流排',
      '5 V 模組：VDD 4.5–5.5 V，V0 接對比可變電阻',
      '8 個使用者自訂字元（CGRAM）',
    ],
    simulated: LCD_SIM,
    limits: LCD_LIMITS,
    params: { panel: '面板顏色' },
    options: { panel: PANEL_COLOR },
  },
  lcd2004: {
    label: 'LCD2004 20×4 字元型 LCD（HD44780）',
    doc: 'LCD2004 20×4 字元型 LCD（HD44780），16 腳排針與接線都和 LCD1602 相同（VSS VDD V0 RS RW E D0–D7 A K，`at` = 第 j 列的 VSS，模組蓋在麵包板前緣）。各行起始的 DDRAM 位址：第 0 行 = 00h、第 1 行 = 40h、第 2 行 = 14h、第 3 行 = 54h（設定 DDRAM 位址：80h | 位址）。初始化流程與 LCD1602 相同（功能設定 28h，即兩「行」模式）。',
    specs: [
      '20 × 4 字元，5 × 8 點，STN 面板附 LED 背光',
      '相容 HD44780 的控制器，8 位元或 4 位元並列匯流排',
      '各行起始位址 00h、40h、14h、54h',
      '5 V 模組：VDD 4.5–5.5 V，V0 接對比可變電阻',
    ],
    simulated: [...LCD_SIM, '20 × 4 版面：第 0／2 行顯示 DDRAM 00h–13h／14h–27h，第 1／3 行顯示 40h–53h／54h–67h'],
    limits: LCD_LIMITS,
    params: { panel: '面板顏色' },
    options: { panel: PANEL_COLOR },
  },
  lcd1602_i2c: {
    label: 'LCD1602 + PCF8574 I²C 轉接板',
    doc: '加裝 PCF8574 I²C 轉接板的 LCD1602：排針 GND VCC SDA SCL（`at` = 第 j 列的 GND；LCD 蓋在麵包板前緣）。使用 5 V 供電；SDA/SCL 接 I2C1 的 PB7/PB6（可耐 5 V），100 kHz；轉接板上已有上拉電阻。位址 0x27（PCF8574A 版本為 0x3F）。每個 PCF8574 位元組設定 P0 = RS、P1 = RW、P2 = E、P3 = 背光、P4–P7 = D4–D7：每個半位元組送兩次（先 E 為高，再 E 為低），並保持背光位元為 1（例如 0x08）。4 位元初始化方式與並列 HD44780 相同。若看不到文字，請轉動對比微調電阻（執行中可調參數）。',
    specs: [
      '經 PCF8574 8 位元 I/O 擴充器驅動的 16 × 2 字元型 LCD',
      'I²C 位址 0x27（PCF8574T）／0x3F（PCF8574AT），100 kHz',
      '背光由 P3 開關，轉接板上有對比微調電阻',
      '5 V 模組，附 4.7 kΩ 上拉電阻',
    ],
    simulated: [
      '位元層級的 PCF8574 I²C 從端：位址 0x27（PCF8574T）或 0x3F（PCF8574AT），埠輸出在 ACK 時脈後鎖存，可讀回準雙向腳位的埠狀態',
      '轉接板接線 P0 = RS、P1 = R/W、P2 = E、P3 = 背光、P4–P7 = D4–D7（只能用 4 位元模式），通電時埠為 FFh',
      ...LCD_SIM.slice(0, 5),
      '背光由 P3 開／關；對比由轉接板的微調電阻決定（執行中可調參數：V_LCD = 位置 × VCC）',
      '轉接板的 4.7 kΩ SDA／SCL 上拉電阻（接 VCC），以電氣子電路模擬',
    ],
    limits: [
      '不強制 PCF8574 的最高 SCL 速率 100 kHz',
      '背光 LED 與 LCD 不消耗電源電流；讀回 P3 時得到的是它的鎖存位元',
      ...LCD_LIMITS.slice(0, 3),
      '以平放方式呈現：轉接板在 LCD 下方，其 I²C 排針垂直向下插入麵包板',
    ],
    params: { address: 'I²C 位址', contrast: '對比微調電阻', panel: '面板顏色' },
    options: { panel: PANEL_COLOR },
  },

  // ------------------------------------------------------------- TFTs
  st7735: {
    label: 'TFT 1.8" 128×160 SPI（ST7735S）',
    doc: 'ST7735S 1.8" 128×160 彩色 TFT，SPI 介面，排針 GND VCC SCL SDA RES DC CS BL（`at` = 第 j 列的 GND；模組蓋在麵包板前緣）。SCL/SDA = SPI1 的 SCK/MOSI（PA5/PA7，模式 0，≤ 15 MHz），RES、DC、CS 接 GPIO，BL 為高（或 PWM）時開啟背光。初始化：RES 脈波、SWRESET（01h，等待 150 ms）、SLPOUT（11h，等待 120 ms）、COLMOD 05h（16 位元）、MADCTL C0h（正向、RGB）、DISPON（29h）；之後以 CASET/RASET 設定視窗，再以 RAMWR（2Ch）送出大端序的 RGB565 像素。',
    specs: [
      '1.8" TFT，128 × 160 RGB，65k／262k 色',
      'ST7735S 控制器，4 線式 SPI（此模組只能寫入）',
      'VCC 3.3–5 V（LDO），3.3 V 邏輯，背光輸入 BL',
    ],
    simulated: [
      '4 線式 SPI（CS 為低時於 SCL 正緣取樣 SDA，D/C 在第 8 個位元時取樣）、RES 硬體重置、SWRESET；重置後 5 ms 內的指令會被忽略',
      'SLPIN/SLPOUT、DISPON/DISPOFF、INVON/INVOFF、NORON、IDMON/IDMOFF、CASET、RASET、RAMWR、MADCTL（MY MX MV RGB/BGR）、COLMOD 12／16／18 位元（重置後為 18 位元）、垂直捲動（33h/37h）',
      '128 × 160 畫面記憶體（黑標版模組，GM = 00）；玻璃為 RGB，安裝方向使 MADCTL C0h = 正向直式',
      '背光亮度 = BL 輸入的工作週期（可用 PWM 調光）',
      '通電時畫面記憶體為亂數內容；關閉或睡眠中的面板只顯示白色背光',
    ],
    limits: [
      '此模組沒有 MISO：無法讀取',
      '電源／伽瑪／畫面更新率暫存器（B1h–C5h、E0h/E1h…）會被接受，但不會改變影像；未模擬部分顯示模式',
      '18 位元色彩以 RGB565 儲存',
      '不強制 15 MHz 寫入時脈上限與 SPI 時序；不強制 SLPOUT 後的 120 ms 等待',
      '臨界值以 VCC 的比例表示，依 VCC = 5 V 時的 3.3 V 邏輯擬合',
      '背面的 SD 卡座未連接',
    ],
  },
  ili9341: {
    label: 'TFT 2.4" 240×320 SPI（ILI9341）',
    doc: 'ILI9341 2.4" 240×320 彩色 TFT，SPI 介面，14 腳排針 VCC GND CS RESET DC SDI SCK LED SDO T_CLK T_CS T_DIN T_DO T_IRQ（`at` = 第 j 列的 VCC；模組蓋在麵包板前緣）。SCK/SDI/SDO = SPI1 的 PA5/PA7/PA6，CS/DC/RESET 接 GPIO，LED 為高時開啟背光。邏輯只能用 3.3 V。初始化：硬體重置、SWRESET、SLPOUT（120 ms）、COLMOD 55h（16 位元）、MADCTL 48h（正向、BGR）、DISPON；以 CASET（2Ah）／PASET（2Bh）設定視窗，再以 RAMWR（2Ch）送出大端序的 RGB565。RDID4（D3h）在一個虛擬位元組之後讀到 00 93 41。觸控腳位未模擬。',
    specs: [
      '2.4" TFT，240 × 320 RGB，65k／262k 色',
      'ILI9341 控制器，4 線式 SPI，可由 SDO 讀回',
      'VCC 3.3–5 V（LDO），3.3 V 邏輯，背光輸入 LED',
      '附觸控排針（未模擬 XPT2046）',
    ],
    simulated: [
      '4 線式 SPI（CS 為低時於 SCK 正緣取樣 SDI，D/C 在第 8 個位元時取樣）、RESET 硬體重置、SWRESET；重置後 5 ms 內的指令會被忽略',
      'SLPIN/SLPOUT、DISPON/DISPOFF、INVON/INVOFF、NORON、IDMON/IDMOFF、CASET、PASET、RAMWR、MADCTL（MY MX MV BGR）、COLMOD 16／18 位元（重置後為 18 位元）、垂直捲動（VSCRDEF 33h／VSCRSADD 37h）',
      'SDO 讀取：RDDPM（0Ah）、RDDMADCTL（0Bh）、RDDCOLMOD（0Ch）與 RDID4（D3h → 00h 93h 41h），皆在一個虛擬位元組之後',
      '240 × 320 畫面記憶體；玻璃為 BGR，安裝方向使 MADCTL 48h = 正向直式',
      '背光亮度 = LED 輸入的工作週期（可用 PWM 調光）；關閉或睡眠中的面板只顯示白色背光',
    ],
    limits: [
      '未模擬 XPT2046 觸控控制器：T_CLK T_CS T_DIN T_DO T_IRQ 為開路',
      '電源／伽瑪／時序暫存器會被接受，但不會改變影像；未模擬部分顯示模式與 RAMRD',
      '18 位元色彩以 RGB565 儲存',
      '不強制 SPI 時序限制與 SLPOUT 後的 120 ms 等待',
      '臨界值以 VCC 的比例表示，依 VCC = 5 V 時的 3.3 V 邏輯擬合',
    ],
  },

  // ----------------------------------------------------------- LED displays
  max7219_8x8: {
    label: 'MAX7219 8×8 LED 點矩陣模組',
    doc: 'MAX7219 8×8 紅色 LED 點矩陣模組，輸入排針 VCC GND DIN CS CLK（`at` = 第 a 列的 VCC；模組延伸到麵包板後方，其下方的頂部電源軌孔位請保持空著）。CS 為低時以 MSB 優先送出 16 位元訊框（SPI1 模式 0，DFF 16 位元，≤ 10 MHz），CS 正緣鎖存：位址 0x0C01 正常運作、0x0B07 掃描全部 8 列、0x0900 不解碼、0x0Axx 亮度、0x0F00 關閉測試，之後 0x01dd…0x08dd = 第 0–7 列（位元 7 = 最左行）。5 V 時 VIH 為 3.5 V：若由 3.3 V 的 MCU 驅動，請以 4.5 V 供電給模組，或使用電位轉換器。',
    specs: [
      '由 MAX7219 驅動的 8 × 8 紅色 LED 點矩陣（32 × 32 mm）',
      '類 SPI 的 16 位元訊框：位址 + 資料，於 LOAD 時鎖存',
      '16 段亮度、掃描範圍、關機模式、顯示測試',
      'V+ 4.0–5.5 V；5 V 時邏輯高準位需 ≥ 3.5 V',
    ],
    simulated: [
      '16 位元移位暫存器在 CLK 正緣移位，由 LOAD（CS）正緣鎖存；位址 D11–D8，資料 D7–D0',
      '位數暫存器、解碼模式（B 碼）、亮度（PWM (2n+1)/32）、掃描範圍（位數越少越亮，未掃描的列不亮）、關機模式、顯示測試（優先於其他所有設定）',
      '通電時：關機模式、不解碼、最低亮度、掃描範圍 0；位數暫存器為亂數內容',
      '採資料手冊的輸入臨界值（5 V 時 VIH 3.5 V）：3.3 V 邏輯需要模組供電 ≤ 4.7 V，或使用電位轉換器',
    ],
    limits: [
      '沒有 DOUT：模組的輸出排針（串接用）不在麵包板上',
      '亮度為相對的 LED 亮度（未模擬段電流／ISET）；不消耗電源電流',
      '不檢查 SPI 時序（最高 10 MHz、建立／保持時間）',
    ],
  },
  ws2812b_strip8: {
    label: 'WS2812B RGB LED 燈條（8 顆）',
    doc: '8 顆 RGB LED 的 WS2812B 燈條：輸入腳位 5V GND DIN 在左端（`at` = 第 j 列的 5V），DOUT 在其右側 23 行處（可串接另一條燈條）。資料：每顆 LED 24 位元，G-R-B 順序，MSB 優先；「0」= 高 0.4 µs + 低 0.85 µs，「1」= 高 0.8 µs + 低 0.45 µs；低準位維持 ≥ 280 µs 即鎖存。STM32 上穩定的作法：SPI1 MOSI（PA7）以 2.25 MHz（72 MHz／32）搭配 DMA，每個 WS 位元用 3 個 SPI 位元表示（100 = 0、110 = 1）。DIN 需要 ≥ 0.7·VDD：若使用 3.3 V 的 MCU，請以 4.5 V 供電給燈條，或使用電位轉換器。',
    specs: [
      '8 顆內建驅動器的 WS2812B 5050 RGB LED',
      '800 kHz 單線資料，每顆 LED 24 位元 G-R-B 色彩',
      '重置／鎖存需低準位 ≥ 280 µs',
      'VDD 3.5–5.3 V，VIH 0.7·VDD',
    ],
    simulated: [
      '在虛擬時間中由 DIN 邊緣解碼單線協定：每個位元在其正緣後 0.6 µs 取樣，每顆 LED 24 位元，G-R-B 順序，MSB 優先',
      'DIN 維持低準位 ≥ 280 µs 後重置／鎖存；LED 會保持顏色直到下一次鎖存',
      '第 8 顆 LED 之後的位元會在 DOUT 上重新產生（T0H 0.4 µs／T1H 0.8 µs），供下一條燈條使用',
      '超出規格的高準位時間、停頓與不完整訊框，完全依取樣點的結果讀取，並在日誌中回報一次',
      '採資料手冊的輸入臨界值 VIH = 0.7·VDD（5 V 時為 3.5 V）：若使用 3.3 V 邏輯，請以 ≤ 4.7 V 供電給燈條，或對 DIN 做電位轉換',
    ],
    limits: [
      '不消耗電源電流（全白時每顆 LED 60 mA，不會從電源軌汲取）',
      '未模擬 PWM：顏色為每個通道鎖存的 8 位元數值',
      '未模擬每顆 LED 內部的傳播延遲',
    ],
  },
  tm1637_4digit: {
    label: 'TM1637 四位數七段顯示器',
    doc: 'TM1637 四位數七段顯示模組，排針 CLK DIO VCC GND（`at` = 第 j 列的 CLK；模組蓋在麵包板前緣）。使用 5 V 供電。以開汲極 GPIO 位元操控 CLK 與 DIO（例如可耐 5 V 的 PB6/PB7；模組上有 10 kΩ 上拉電阻），速度 ≤ 250 kHz：START（CLK 為高時 DIO 下降）、LSB 優先送出位元組（DIO 在 CLK 為低時改變）、TM1637 在第 9 個時脈回應每個位元組的 ACK、STOP。流程：40h（自動遞增）／C0h + 4 個段碼位元組（a = 位元 0 … g = 位元 6，第 2 位數的位元 7 = 冒號）／88h–8Fh（顯示開啟 + 亮度）。',
    specs: [
      '4 位數紅色七段顯示器，附時鐘冒號，0.36"',
      'TM1637 驅動器：2 線式序列介面（CLK、DIO），LSB 優先，每個位元組都有 ACK',
      '8 段亮度，顯示開／關',
      'CLK／DIO 上有 10 kΩ 上拉電阻',
    ],
    simulated: [
      'TM1637 2 線式協定：START/STOP、在 CLK 正緣讀取 LSB 優先的位元組、ACK（從第 8 個到第 9 個下降緣把 DIO 拉低）',
      '資料指令（自動遞增／固定位址、按鍵讀取）、位址指令 C0h–C5h、顯示控制（開／關、8 種脈寬）',
      '四個位數 + 冒號（第 2 位數的位元 7）；按鍵讀取回傳 FFh（模組上沒有按鍵）',
      '模組的 10 kΩ CLK／DIO 上拉電阻以電氣子電路模擬；通電時顯示資料為亂數內容，顯示為關閉',
    ],
    limits: [
      '未模擬常見模組在 CLK／DIO 上的 100 pF 濾波電容',
      '不檢查最高時脈速率（約 250 kHz）',
      '不消耗電源電流；此模組的小數點沒有接線',
    ],
  },
}
