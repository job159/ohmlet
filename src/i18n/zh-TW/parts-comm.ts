/**
 * zh-TW part texts for the communication & memory family
 * (src/model/parts/comm.parts.ts): CH340G USB 轉 TTL、HC-05 藍牙、MAX485
 * RS-485、W25Q32 SPI 快閃記憶體、microSD 模組、PCF8574 I/O 擴充、ESP-01、
 * TJA1050 CAN 收發器。Faithful translations of the catalog doc / specs /
 * simulated / limits (same order). Pin notes and descriptive part numbers
 * live in catalog-text.ts.
 */
import type { PartText } from '../parts'

const PARITY = { none: '無', even: '偶同位', odd: '奇同位' }

export const PARTS_ZH: Record<string, PartText> = {
  usb_uart_ch340: {
    label: 'USB 轉 TTL 轉接器（CH340G）',
    doc: 'CH340G USB 轉 TTL 序列轉接器（6 腳排針 GND 3V3 5V TXD RXD DTR 排成一列；`at` = GND 位於 a 列，電路板與 USB 插頭伸出麵包板邊緣；放在 j 列時旋轉 180）。它插在電腦上：TXD／RXD 橋接到 UART 終端機中的虛擬 COM 埠「COM」。接線：TXD → MCU 的 RX，RXD ← MCU 的 TX，GND ↔ GND。COM 埠的鮑率／同位檢查要設成與韌體相同。「邏輯準位跳線帽」選擇 5 V 或 3.3 V 訊號準位——接到不耐 5 V 的腳位（例如 PA3）時請用 3.3V。5V 腳位可以供電給 Blue Pill。',
    specs: [
      'CH340G USB 2.0 全速轉 UART 橋接晶片，12 MHz 石英晶體',
      '鮑率 50 … 2 M，5–8 個資料位元，同位檢查，1／2 個停止位元',
      '3.3 V／5 V 邏輯準位跳線帽',
      'USB-A 插頭；5 V 與 3.3 V 輸出',
    ],
    simulated: [
      'TXD／RXD 上位元層級的 UART，依 COM 埠設定（鮑率、同位檢查、停止位元——參數）運作：與 MCU 不一致時，會像真的轉接器一樣收到亂碼與訊框錯誤',
      'UART 終端機中的虛擬 COM 埠「COM」：收到的位元組顯示在那裡，輸入的位元組由 TXD 送出',
      '邏輯準位跳線帽：TXD／DTR 擺幅為 5 V 或 3.3 V；RXD 的臨界值隨之調整',
      'USB 供電：5V 腳位為 5 V（0.3 Ω 電源內阻），3V3 腳位為 3.3 V 穩壓輸出（≤ 100 mA），附電源指示 LED',
      'DTR 輸出（低態有效），由「DTR 已拉起」參數控制',
    ],
    limits: [
      '不模擬 USB 本身：模組永遠視為已插在電腦上',
      '此模組沒有引出 RTS／CTS 等其他交握控制線，也未模擬',
      'TX／RX 活動 LED 依線路狀態顯示（未以電氣方式模擬）',
      'RXD 臨界值為 0.2／0.45 × VIO（CH340G 規格書只給出 5 V 時的 TTL 準位）',
    ],
    params: {
      logic: '邏輯準位跳線帽',
      baud: 'COM 埠鮑率',
      parity: 'COM 埠同位檢查',
      stopBits: 'COM 埠停止位元',
      dtr: 'DTR 已拉起',
    },
    options: { parity: PARITY },
  },

  hc05_bt: {
    label: 'HC-05 藍牙模組',
    doc: 'HC-05 藍牙序列模組（ZS-040 底板，直立插在麵包板上；排針 STATE RXD TXD GND VCC EN 排成一列，`at` = STATE 位於 e 列）。VCC 供電 3.6–6 V。接線：TXD → MCU 的 RX，RXD ← MCU 的 TX，GND。通電時 EN 為高準位（例如接 10 kΩ 上拉電阻）就進入 AT 指令模式，鮑率 38400（AT、AT+NAME?、AT+UART=9600,0,0 …，每一行以 CR LF 結尾）；EN 為低準位或浮接則以儲存的鮑率（預設 9600）進入資料模式，橋接到已配對的手機——即 UART 終端機中的「BT」埠。EN 為低準位時下 AT+RESET 會切換到資料模式。手機連線後 STATE 變成高準位。不模擬無線電。',
    specs: [
      '藍牙 2.0 + EDR SPP 模組（CSR BC417），可當主端／從端',
      'AT 模式 38400 8N1（通電時 EN 為高準位）；資料模式預設 9600 8N1',
      'VCC 3.6–6 V，3.3 V 邏輯準位',
      'STATE 輸出、狀態 LED',
    ],
    simulated: [
      '通電時 EN 為高準位 → AT 指令模式，38400 8N1；EN 為低準位／浮接 → 依儲存的 UART 設定進入資料模式',
      'AT、AT+RESET、AT+ORGL、AT+VERSION?、AT+NAME?/=、AT+UART?/=、AT+ROLE?/=、AT+PSWD?/=、AT+STATE?，回應 OK／ERROR:(代碼)；設定存在模組的快閃記憶體中（本次工作階段內不會遺失）',
      '資料模式橋接到已配對的手機：UART 終端機中的虛擬序列埠「BT」',
      '手機連線時 STATE 為高準位；板上 LED 閃爍模式（AT 模式慢閃、等待連線快閃、已連線雙閃）',
      '板上有 3.3 V 穩壓器：不論 VCC 為多少，TXD／STATE 的高準位都是 3.3 V',
    ],
    limits: [
      '不模擬藍牙無線電：配對、查詢與連線都由「手機已連線」參數取代',
      '與無線電相關的 AT 指令（查詢、配對、連線、位址）未實作，一律回應 ERROR:(0)',
      '啟動時間 100 ms 與立即回應 AT 指令皆為估計值（規格書未規定）',
      'TXD／STATE 的高準位端以 1 kΩ 接到模組 3.3 V 電源軌來模擬（實際輸出為推挽式）',
    ],
    params: { phone: '手機已連線（藍牙連線）' },
  },

  max485_module: {
    label: 'RS-485 模組（MAX485）',
    doc: 'MAX485 RS-485 收發器模組，跨在中央溝槽上：邏輯端排針 RO RE DE DI 位於 h 列（`at` = RO），匯流排端排針 VCC B A GND 位於 c 列（VCC 在 RO 上方）。供電 5 V。MCU 的 TX → DI，RO → MCU 的 RX（RO 為 5 V：請用耐 5 V 的腳位，例如 PA10 或 PB11），DE 與 RE 接在一起接到同一支 GPIO（高準位 = 傳送，低準位 = 接收）。各節點的 A 接 A、B 接 B。每個模組都有 120 Ω 終端電阻（R7）：只保留匯流排兩端的節點上的（參數）。同一時間只能有一個節點驅動匯流排——模擬器會回報匯流排衝突與終端電阻問題。（實際的電路板長 44 mm，兩端各有排針並有 A/B 螺絲端子；這裡以精簡的電路板跨在溝槽上。）',
    specs: [
      'MAX485 半雙工 RS-485／RS-422 收發器，最高 2.5 Mb/s',
      '5 V 供電，32 個單位負載',
      '120 Ω 終端電阻（R7），A/B 偏壓 20 kΩ，邏輯腳位 10 kΩ 上拉',
      '邏輯端排針 RO RE DE DI，匯流排端排針 VCC B A GND',
    ],
    simulated: [
      '驅動器：DE 為高準位 → A/B 由 DI 驅動，每個輸出 35 Ω（接兩個 120 Ω 終端電阻時 VOD ≈ 2.3 V）；DE 為低準位 → 釋放',
      '接收器：VA − VB ≥ +200 mV 時 RO 為高準位，≤ −200 mV 時為低準位，介於兩者之間則保持；RE 為高準位 → RO 釋放（由模組上拉電阻拉高）',
      'A 與 B 是兩個類比網路：模組的 10 kΩ 上拉電阻（RO RE DE DI）、20 kΩ 偏壓（A 上拉、B 下拉）、電源 LED 與 120 Ω 終端電阻 R7（參數）都納入求解',
      '由量測到的差動電壓回報匯流排衝突（另一個驅動器與本驅動器相抗），以及終端電阻缺少／只接一端／過多',
    ],
    limits: [
      '未模擬驅動器／接收器延遲（30–60 ns）、迴轉率與 12 kΩ 的接收器輸入負載',
      '未模擬纜線反射：沒有終端電阻的匯流排仍可運作（只會回報）',
      '在 ±200 mV 之間實際輸出為不確定；模型保持上一個準位（閒置且有終端電阻的匯流排在實際硬體上並非故障安全）',
      '邏輯輸入切換點為 0.45／0.55 × VCC（規格書 TTL 為 0.8／2.0 V）',
    ],
    params: { termination: '已裝 120 Ω 終端電阻（R7）' },
  },

  w25q32_flash: {
    label: 'SPI 快閃記憶體 W25Q32（4 MB）',
    doc: 'W25Q32 4 MB SPI NOR 快閃記憶體分線板，8 支腳位排成一列 CS DO WP GND DI CLK HOLD VCC（`at` = CS 位於 e 列；電路板覆蓋中央溝槽與 f–j 列）。供電 3.3 V（絕不能接 5 V）。SPI 模式 0：CLK ← SCK，DI ← MOSI，DO → MISO，CS ← 一支 GPIO。WP 與 HOLD 接到 VCC。每次頁燒錄（02h）或抹除（20h 磁區 4 KB）之前都要先送 06h（寫入致能）；接著輪詢狀態暫存器 05h，直到 BUSY（位元 0）清除——磁區抹除約需 45 ms。JEDEC ID 9Fh 回傳 EF 40 16。抹除後的位元組讀出為 FFh；內容會保留。',
    specs: [
      '32 Mb（4 MiB）序列 NOR 快閃記憶體，256 位元組頁，4 KiB 磁區',
      'SPI 最高 133 MHz，模式 0 與 3',
      'JEDEC ID EF 40 16',
      '2.7–3.6 V，可燒錄／抹除 10 萬次',
    ],
    simulated: [
      '任何時脈速率的 SPI 模式 0／3：JEDEC ID 9Fh（EF 40 16）、90h、ABh、讀取 03h、快速讀取 0Bh、寫入致能／禁能、狀態暫存器 1–3（輪詢 BUSY／WEL）、寫入狀態暫存器',
      '頁燒錄 02h（256 位元組頁，位址在頁內循環，只能把位元清為 0）、磁區 20h／區塊 52h、D8h／整片抹除 C7h、60h——只有在 CS 於位元組邊界拉高時才執行，BUSY 持續規格書的典型時間（tPP 0.4 ms、tSE 45 ms、tBE 120／150 ms、tCE 10 s）',
      '區塊保護（BP2–0、TB、SEC，CMP = 0），SRP + /WP 鎖定狀態暫存器，/HOLD 暫停，省電 B9h／喚醒 ABh',
      '本次工作階段內為非揮發性（抹除狀態 = FFh）',
    ],
    limits: [
      '未模擬雙線／四線 I/O、安全暫存器、唯一 ID、SFDP 與暫停／恢復（會記錄並忽略）',
      '時間為典型值（實際元件可能達到最大值，例如 tSE 400 ms）',
      '浮接的 /WP 或 /HOLD 讀為高準位（實際硬體請將兩者接到 VCC）；未模擬耐久度',
    ],
  },

  sd_card_spi: {
    label: 'microSD 記憶卡模組（SPI）',
    doc: 'microSD 記憶卡模組（SPI），6 腳排針 GND VCC MISO MOSI SCK CS 排成一列（`at` = GND 位於 e 列；電路板覆蓋中央溝槽）。供電 5 V（板上有 3.3 V 穩壓器）。SPI 模式 0，完成初始化之前 ≤ 400 kHz：先在 CS 為高準位時送出 ≥ 74 個時脈，再送 CMD0（CRC 0x95）、CMD8（0x1AA，CRC 0x87），接著重複 CMD55 + ACMD41（HCS）直到 R1 = 0，再以 CMD58 讀取 OCR（CCS = SDHC 以區塊為位址）。以 CMD17／CMD24 讀寫 512 位元組區塊。模擬的記憶卡含有 MBR 與 FAT32 磁碟區「OHMLET SD」（SDHC 4 GB），或 FAT16（SDSC 128 MB）。',
    specs: ['microSD 卡座，SPI 模式', 'AMS1117-3.3 穩壓器、74LVC125A 準位轉換：5 V 供電與邏輯', '虛擬記憶卡：SDHC 4 GB FAT32 或 SDSC 128 MB FAT16'],
    simulated: [
      'SD 的 SPI 模式：上電 74 個時脈、CMD0（CRC 95h）、CMD8、CMD55 + ACMD41 初始化（就緒前維持閒置）、CMD58 OCR（CCS）、CMD59 開／關 CRC、CMD9／CMD10 讀取 CSD／CID、CMD13、CMD16',
      '單一與多區塊讀寫（CMD17／18 + CMD12、CMD24／25），含資料標記、CRC16 與忙碌狀態',
      '記憶卡映像：SDHC 4 GB（MBR + FAT32 磁碟區）或 SDSC 128 MB（FAT16）（參數），由模擬器格式化（磁碟區標籤 OHMLET SD，檔案 HELLO.TXT）；寫入的區塊在本次工作階段內保留',
      '模組：AMS1117 3.3 V 穩壓器與 3.3 V 的 MISO 準位（高準位端以 1 kΩ 接到 3.3 V 電源軌）',
    ],
    limits: [
      '不支援 SD 匯流排（4 位元）模式、抹除／鎖定／切換功能等指令以及 ACMD41 以外的 ACMD（回應非法指令）',
      '只支援 512 位元組區塊（CMD16 指定其他長度 → 參數錯誤）',
      '時間：初始化 25 ms、讀取存取 0.25 ms、寫入忙碌 1.5 ms（實際記憶卡差異很大）',
      '指令必須從位元組邊界開始；CS 拉高時記憶卡立即釋放 MISO',
    ],
    params: { card: '記憶卡' },
    options: { card: { sdhc: 'SDHC 4 GB（FAT32）', sdsc: 'SDSC 128 MB（FAT16）' } },
  },

  pcf8574_module: {
    label: 'I/O 擴充模組 PCF8574（I²C）',
    doc: 'PCF8574 I²C 8 位元 I/O 擴充模組，跨在中央溝槽上：埠排針 P0–P7 位於 h 列（`at` = P0），匯流排排針 GND VCC SDA SCL INT 位於 c 列（GND 在 P1 上方）。供電 2.5–6 V；模組上的 SDA／SCL 有 10 kΩ 上拉電阻。位址為 0x20 + A2A1A0（跳線帽參數）。寫入一個位元組會設定埠閂鎖：0 位元會把腳位強力拉低（LED 從 VCC 經 330 Ω 接到該腳位即可點亮），1 位元是弱上拉，也可當輸入使用（按鈕從腳位接到 GND，按下讀為 0）。輸入改變時 INT 拉低。',
    specs: ['經 I²C（100 kHz）的 8 位元準雙向 I/O', '位址 0x20–0x27（A2–A0 跳線帽）', '埠可灌入 25 mA，拉出約 100 µA', '開汲極中斷輸出'],
    simulated: [
      '位元層級的 I²C 從端：位址 0100·A2A1A0（0x20–0x27，跳線帽參數）、ACK，寫入 = 埠閂鎖，讀取 = 在回應時取樣的埠腳位準位',
      '準雙向 P0–P7：閂鎖 0 = 強低準位（40 Ω，25 mA），閂鎖 1 = 弱上拉（約 100 µA），因此腳位可當輸入',
      'INT 開汲極：輸入與上次讀寫時不同就拉低，埠被存取或輸入恢復時釋放',
      '模組上 SDA 與 SCL 的 10 kΩ 上拉電阻；上電狀態：所有埠為高準位',
    ],
    limits: [
      '未模擬寫入後短暫的強上拉（加速上升緣）與 t_pv／t_iv 延遲；SDA 在 SCL 下降後 0.3 µs 改變',
      '不檢查匯流排時序：主端產生的任何 SCL 速率都能運作',
      '埠除了 40 Ω 驅動器外沒有電流限制（由電氣規則檢查（ERC）檢查額定值）',
    ],
    params: { address: 'I²C 位址（A2–A0 跳線帽）' },
  },

  esp01: {
    label: 'Wi-Fi 模組 ESP-01（ESP8266）',
    doc: 'ESP-01（ESP8266）Wi-Fi 模組，裝在 1×8 麵包板轉接板上，腳位 GND GPIO2 GPIO0 RXD TXD CH_PD RST VCC 排成一列（`at` = GND 位於 e 列）；模組平躺在轉接板的插座上，位於 f–j 列上方 15 mm。只能用 3.3 V：VCC 與 CH_PD 接 3.3 V（CH_PD 沒有上拉電阻），接 GND，TXD → MCU 的 RX，RXD ← MCU 的 TX。重置後先以鮑率 74880 印出 ROM 開機訊息，再以鮑率 115200 印出 "ready"，並回應 AT 指令（AT、AT+GMR、AT+RST、AT+CWMODE?）。未模擬 Wi-Fi：網路相關指令一律回應 ERROR。',
    specs: ['ESP8266EX、1 MB SPI 快閃記憶體、PCB 天線', 'AT 韌體，115200 8N1（開機 ROM 為 74880）', '只能用 3.3 V，不耐 5 V', '本實驗室未模擬 Wi-Fi'],
    simulated: [
      '電源、CH_PD（致能）與 RST：只有 CH_PD 為高準位且 RST 不為低準位時晶片才運作',
      '開機設定腳：重置時 GPIO0 為低準位 → UART 下載模式，否則執行 AT 韌體；以 74880 鮑率印出開機 ROM 訊息，再以 115200 8N1 印出 "ready"',
      '帶回顯的 AT 指令子集：AT、ATE0／ATE1、AT+GMR、AT+RST、AT+CWMODE?／AT+CWMODE=',
    ],
    limits: [
      '沒有 Wi-Fi：沒有無線電也沒有網路——掃描、連線、TCP／UDP 與其他所有網路指令都回應 ERROR',
      'AT 韌體版本固定（AT 1.7.4）；AT+UART 與其他設定指令未實作',
      '開機時間 0.25 s 為估計值；GPIO0／GPIO2 只作為開機設定腳（不執行使用者韌體）',
      '未模擬供電電流峰值（無線電運作時最高 300 mA）',
    ],
  },

  can_tja1050: {
    label: 'CAN 收發器模組（TJA1050）',
    doc: 'TJA1050 CAN 收發器模組，跨在中央溝槽上：TX RX VCC GND 位於 h 列（`at` = TX），CANH CANL 位於 c 列（在 RX 與 VCC 上方）。供電 5 V。各節點的 CANH 接 CANH、CANL 接 CANL；TX ← CAN_TX（PA12），RX → CAN_RX（PA11）。未模擬 STM32 的 CAN 控制器（bxCAN），因此只有匯流排準位會動作：TX 為低準位時把匯流排驅動為顯性，RX 跟隨匯流排。TX 保持低準位超過約 450 µs 會觸發顯性逾時保護。',
    specs: ['TJA1050 高速 CAN 收發器，最高 1 Mb/s', '5 V 供電，板上有 120 Ω 終端電阻', 'TXD 顯性逾時保護', '只有收發器——需要 CAN 控制器（未模擬 bxCAN）'],
    simulated: [
      '只有收發器：TX 為低準位 → 顯性（接 60 Ω 時 CANH ≈ 3.5 V、CANL ≈ 1.5 V），TX 為高準位／浮接 → 隱性（兩者經內部偏壓約 2.5 V）',
      'VCANH − VCANL > 0.9 V 時 RX 為低準位，低於 0.5 V 時為高準位（之間為遲滯）；線及匯流排：任何一個顯性節點都會勝出',
      '回報 TXD 顯性逾時（450 µs）以及低於 0.7·VCC 的 TX 高準位',
      '模組上的 120 Ω 終端電阻（參數），偏壓網路納入類比求解',
    ],
    limits: [
      '未模擬 STM32 的 bxCAN 控制器：沒有 CAN 訊框、位元時序、仲裁或錯誤處理——收發器只傳遞準位',
      '未模擬傳播延遲、斜率控制與 S（靜音）腳位',
      'TX 臨界值模擬為 0.55–0.6·VCC（3.3 V 的 MCU 在這裡可以運作；規格書只保證 ≥ 0.7·VCC）',
    ],
    params: { termination: '已裝 120 Ω 終端電阻' },
  },
}
