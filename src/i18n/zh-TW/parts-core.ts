/**
 * zh-TW part texts for the core catalog (src/model/catalog.ts): the 31
 * legacy breadboard parts plus the embedded-platform instruments and the
 * STM32 Blue Pill. Faithful translations of the catalog `doc`, meta.specs,
 * support.simulated / support.limits (same order), param labels and select
 * option labels. Part numbers, pin names, units and formulas stay as in the
 * catalog. Pin notes / manufacturers (shown through tText → tMessage) live
 * in messages-core.ts NOTES_ZH.
 */
import type { PartText } from '../parts'

// shared texts (catalog.ts LEGACY_SUPPLY_READING / LOGIC_LIMITS / LOGIC_INPUTS / SWITCH_CONTACT);
// the supply-reading note adds where the product chrome's 顯示電流 books that current
const LEGACY_SUPPLY_READING =
  '電源供應器自己的電流讀數不含這些輸出驅動的電流：求解器讓它經電路接地返回，而不是經晶片的 VCC 與 GND 腳；「顯示電流」則把它算回晶片的電源腳，光點走的是真正的迴路'
const LOGIC_LIMITS = [
  '行為模型而非電晶體層級：輸入不吸取電流，輸出也不從 VCC/VDD 汲取電源電流',
  '浮接輸入讀為 LOW（實際 TTL 浮接為 HIGH，實際 CMOS 浮接則不確定）',
  '每個類比步階（50 µs）計算一次：沒有短於此時間的傳播延遲或上升時間',
  '輸出為以電路接地（而非晶片 GND 腳位）為參考的理想 50 Ω 驅動器；沒有扇出限制',
  '電源低於 2 V 時釋放所有輸出（兩者之間沒有欠壓行為）',
  LEGACY_SUPPLY_READING,
]
const LOGIC_INPUTS = '輸入與 0.5·VCC 比較；推挽輸出（經 50 Ω 輸出 VCC／0 V）'
const SWITCH_CONTACT = '接點：閉合 20 S（50 mΩ）／斷開 1 nS'
const BJT_LIMITS = ['無爾利效應、接面電容與崩潰', '無熱模型']

export const PARTS_ZH: Record<string, PartText> = {
  // ----------------------------------------------------------- passives
  resistor: {
    label: '電阻',
    doc: '基本電阻。兩支接腳，各插入任一孔位。每顆 LED 都務必串聯 220Ω–1kΩ 的電阻。',
    simulated: [
      '理想線性電阻（歐姆定律）',
      '支路電流與功率即時讀值',
      '依 ¼ W 額定功率模擬自體發熱（一階熱模型，τ 約 10 秒）：超過額定會過熱冒煙；持續嚴重過載（本體溫升達額定的 10 倍——10 Ω 接 12 V、14.4 W 約 2 秒）會燒斷成開路，直到重置模擬或修改電路（模擬引擎重建）',
    ],
    limits: ['無誤差與溫度係數：發熱時電阻值不變', '電阻值限制在 1 mΩ … 1 TΩ'],
    params: { resistance: '電阻值' },
  },
  capacitor: {
    label: '電容',
    doc: '電容。有極性（電解）電容的 p1 為 +、p2 為 −。用於 555 計時：t ≈ 1.1·R·C。',
    simulated: [
      '理想電容（類比步階的後向尤拉等效模型）',
      '模擬執行期間保留電荷',
      '有極性（電解）電容反接超過 1 V 會洩壓爆開，直到重置模擬或修改電路（反接 5 V 約 1 秒、2 V 約 4 秒，1 V 以下不會）',
    ],
    limits: [
      '爆開後模擬仍沿用原本的容值（實際的電容會失去容量，還可能短路）',
      '無 ESR、漏電流與耐壓',
      '每次編輯電路時電荷都會重置（模擬引擎重建）',
    ],
    params: { capacitance: '電容值', polarized: '有極性（電解）' },
  },
  inductor: {
    label: '電感',
    doc: '電感（線圈）。兩支接腳。',
    simulated: ['理想電感（後向尤拉等效模型）', '支路電流即時讀值'],
    limits: ['無繞線電阻、飽和與鐵芯損耗', '無互感耦合'],
    params: { inductance: '電感值' },
  },
  potentiometer: {
    label: '可變電阻',
    doc: '可變電阻，3 支接腳：ccw（逆時針）端、wiper（滑臂）、cw（順時針）端。模擬執行時可轉動旋鈕。寬大的本體會蓋住相鄰孔位（外側接腳左右各一欄、上下各一列）——這些孔位請保持空著。',
    simulated: ['在滑臂處分成兩段串聯電阻（線性變化）', '執行中可調整旋鈕位置'],
    limits: ['僅有線性變化特性', '每一半電阻不低於 0.5 Ω（端點電阻）', '無額定功率'],
    params: { resistance: '總電阻值', position: '旋鈕位置' },
  },
  photoresistor: {
    label: '光敏電阻（LDR）',
    doc: '光敏電阻：黑暗中約 200kΩ，強光下降至約 200Ω。模擬時可拖動光照強度滑桿——非常適合小夜燈電路。',
    simulated: ['R = 200 Ω·10^(3·(1 − 光照))：強光約 200 Ω … 黑暗約 200 kΩ', '執行中可調整光照強度'],
    limits: ['瞬間響應（實際 CdS 光敏電阻需數十 ms，且受先前光照影響）', '無光譜響應'],
    params: { light: '光照強度' },
  },

  // ------------------------------------------------------ semiconductors
  diode: {
    label: '二極體（1N4148）',
    doc: '小訊號矽二極體。由陽極→陰極導通，壓降約 0.7V。',
    simulated: ['Shockley 接面模型，Is = 1 pA，n = 1.2（1 mA 時約 0.66 V）'],
    limits: ['無逆向崩潰', '無接面電容與逆向恢復', '無熱限制'],
  },
  led: {
    label: '發光二極體 LED',
    doc: 'LED。陽極（+）經串聯電阻（220Ω–1kΩ）接到較高電位；陰極（−）接往接地。額定電流 20 mA；電流遠大於額定會過熱而燒毀（完全沒有電阻時會立刻燒毀）。',
    simulated: [
      'Shockley 接面（n = 2），依顏色擬合 10 mA 時的順向電壓：紅 1.8 V、黃 2.0 V、綠 2.2 V、藍 3.0 V、白 3.2 V',
      '亮度 = 電流 ÷ 額定 20 mA：20 mA 時 100 %，超過 100 % 為過載（會閃爍）；電流與亮度是最近 20 ms（模擬時間）的平均，和眼睛看到的一樣：PWM 調光的 LED 平順地變亮變暗，讀數寫「平均」，導通時的電流寫「峰值」',
      '由 P = Vf · I 計算接面溫度（一階：350 K/W，τ 約 5 秒）：超過 100 °C 會過熱；達 150 °C 燒斷成開路（直到重置模擬或修改電路）；電流超過 150 mA 達 1 ms 以上立刻燒毀（5 V 串 100 Ω 的 31 mA 不會燒毀）',
      '3D 外觀依人眼的感受呈現這個亮度：0 mA 全暗，約 0.5 mA 起有比燈殼更亮的亮核與柔和的光暈，每增加一級（2、4、10 mA）都更亮、更大；接近 20 mA 時亮核轉為白熱，出現光芒與刺眼的星芒；白色 LED 的光比白色麵包板更亮，邊緣帶較深的冷色；燒毀的 LED 焦黑不亮',
    ],
    limits: ['無逆向崩潰', '發光量與電流呈線性（無效率衰減，發熱時也不會變暗）'],
    params: { color: '顏色' },
    options: { color: { red: '紅色', green: '綠色', yellow: '黃色', blue: '藍色', white: '白色' } },
  },
  npn: {
    label: 'NPN 電晶體（2N3904）',
    doc: 'NPN 雙極性電晶體（BJT），腳位順序為射極／基極／集極（2N3904 平面朝向自己時：E-B-C）。基極須經電阻（1k–10k）驅動。',
    simulated: ['Ebers-Moll 傳輸模型，βF = 150、βR = 3、Is = 10 fA'],
    limits: BJT_LIMITS,
  },
  pnp: {
    label: 'PNP 電晶體（2N3906）',
    doc: 'PNP 雙極性電晶體（BJT），腳位順序為射極／基極／集極。',
    simulated: ['Ebers-Moll 傳輸模型（PNP），βF = 150、βR = 3、Is = 10 fA'],
    limits: BJT_LIMITS,
  },
  nmos: {
    label: 'N 通道 MOSFET（2N7000）',
    doc: '小型 N 通道 MOSFET，腳位順序為源極／閘極／汲極。Vth ≈ 2V。',
    simulated: ['平方律（SPICE 第 1 級）MOSFET：Vth = 2 V、k = 0.1 A/V²、λ = 0.01 /V', '汲極與源極對調時對稱導通'],
    limits: ['無本體二極體', '無閘極電容（瞬間切換）', '無次臨界導通'],
  },

  // ------------------------------------------------------------ switches
  pushbutton: {
    label: '按鈕（輕觸開關）',
    doc: '跨在中央溝槽上的瞬時型輕觸按鈕。`at` = 腳位 A1 的孔位（f 列）。佔用 e、f 兩列的第 at 與 at+2 欄。按下時 A 側與 B 側導通。A1/A2 在內部相連，B1/B2 亦同。本體也蓋住中間一欄（at+1 的 e、f 列）——這兩個孔位請保持空著。',
    // the product chrome's words for a press and the keep-pressed latch (inspector 按住 / 保持按下, 3D double-click)
    simulated: [`A 側 ↔ B 側，${SWITCH_CONTACT}`, '執行中可按住，或雙擊／打開「保持按下」讓它一直按著'],
    limits: ['無接點彈跳'],
    params: { pressed: '按下' },
  },
  slide_switch: {
    label: '滑動開關（SPDT）',
    doc: 'SPDT 滑動開關，3 支接腳：依滑桿位置，共同端（common）連接到接腳 a 或接腳 b。模擬期間可切換。',
    simulated: [`共同端 ↔ a 或 b，${SWITCH_CONTACT}`, '執行中可切換位置'],
    limits: ['無接點彈跳；切換瞬間完成（沒有先斷後通的間隙）'],
    params: { state: '位置' },
    options: { state: { a: 'a', b: 'b' } },
  },
  dip_switch_8: {
    label: '指撥開關 ×8',
    doc: 'DIP-16 封裝中的八個獨立開關。第 n 個開關導通時連接腳位 nA 與 nB。很適合手動設定 BCD 數字輸入。',
    simulated: [`八個獨立開關 nA ↔ nB，${SWITCH_CONTACT}`, '執行中可切換各開關狀態'],
    limits: ['無接點彈跳'],
    params: { on: '開關狀態（1=導通）' },
  },

  // ----------------------------------------------------- power / sources
  power_supply: {
    label: '直流電源供應器',
    doc: '可調式桌上型直流電源，置於麵包板外。將其端子（"ID:+" 與 "ID:-"）接到電源軌，例如 {"from":"PS1:+","to":"top+0"}。其 "-" 端子定義電路接地。每個電路都需要恰好一台。',
    simulated: ['理想電壓源串聯 10 mΩ', '執行中可調整電壓', '電流超過 2 A 持續 10 ms 才標示為可能短路（電容剛通電的充電湧浪不算）；電流回到 2 A 以下 10 ms 後警告就解除'],
    limits: [
      '無限流或折返保護：短路只會被標示，不會被限制',
      '無漣波與穩壓動態',
      '電流讀數不含行為模型晶片（555、74xx、CD40xx、LM358）輸出的電流：求解器讓它經電路接地返回；「顯示電流」的光點則照真正的迴路流動',
    ],
    params: { voltage: '電壓' },
  },
  function_generator: {
    label: '函數產生器',
    doc: '置於麵包板外的訊號源：out = 偏移 + 振幅 × 波形 (2π·f·t)。連接 "ID:out" 與 "ID:gnd"，並將 gnd 接到電源的接地軌。',
    simulated: ['正弦波／方波／三角波訊號源串聯 50 Ω', '執行中可調整波形、頻率、振幅與偏移'],
    limits: ['每個類比步階（50 µs）計算一次：約 1 kHz 以上的訊號取樣較粗略', '無上升時間限制，也無法調整工作週期'],
    params: { waveform: '波形', frequency: '頻率', amplitude: '振幅（峰值）', offset: '直流偏移' },
    options: { waveform: { sine: '正弦波', square: '方波', triangle: '三角波' } },
  },

  // ----------------------------------------------------------- displays
  seven_segment: {
    label: '七段顯示器',
    doc: '共陰極單位數七段顯示器（DIP-10，跨在中央溝槽上；`at` = 腳位 E 在 f 列的孔位）。段腳位 A–G 與 DP 為 LED 陽極（順向約 2V）；將 COM1 或 COM2 接地。各段線路請串聯電阻，或使用 CD4511／CD4026 驅動。',
    simulated: ['八個 LED 接面（a–g、dp）接到共陰極，10 mA 時約 2.0 V', '電流超過 1 mA 的段視為點亮'],
    limits: ['各段只有亮／滅（無亮度等級）', '各段不會燒毀', '僅支援共陰極'],
  },
  buzzer: {
    label: '蜂鳴器',
    doc: '簡易蜂鳴器（約 300Ω 負載）。施加超過約 1V 的電壓時發聲（p1 為正）。',
    simulated: ['300 Ω 電阻性負載', '|V| > 1 V 時視為「發聲中」'],
    limits: ['電氣上僅為 300 Ω 電阻：無線圈電感與反電動勢', '任一極性都會發聲（實際蜂鳴器需要 p1 為正）；不會產生聲音'],
  },

  // ----------------------------------------------------------------- ICs
  ne555: {
    label: 'NE555 計時器',
    doc: '經典 555 計時器（DIP-8）。無穩態閃爍電路：R_A 接在 VCC 與 DISCH 之間，R_B 接在 DISCH 與 THRES 之間，C 接在 THRES 與 GND 之間，TRIG 接 THRES，RESET 接 VCC。f ≈ 1.44/((R_A+2·R_B)·C)。OUT 可直接驅動負載。',
    simulated: [
      '位於 2/3·VCC 與 1/3·VCC 的行為比較器（可由 CTRL 調整）、RS 閂鎖器、非同步低態有效 RESET',
      '推挽 OUT（經 10 Ω 輸出 VCC − 0.5 V／0.1 V）、開汲極 DISCH（25 Ω）',
    ],
    limits: LOGIC_LIMITS,
  },
  lm358: {
    label: 'LM358 雙運算放大器',
    doc: '雙路單電源運算放大器（DIP-8）。輸出擺幅從 0V 到約 VCC−1.2V。可作為比較器或放大器。',
    simulated: [
      '行為模型運算放大器：開迴路增益 100 000，經 50 Ω 輸出 20 mV … VCC − 1.2 V',
      '迴轉率 0.5 V/µs；考量回授的步進計算，使隨耦器／放大器能穩定收斂',
    ],
    limits: [
      '無輸入偏壓電流與偏移電壓，除迴轉率限制外也沒有頻率響應',
      '浮接輸入讀為 0 V',
      '每個類比步階（50 µs）計算一次：帶延遲的緊密迴路會在正確平均值附近振盪',
      LEGACY_SUPPLY_READING,
    ],
  },
  sn7400: {
    label: '7400 四組 NAND 閘',
    doc: '四組 2 輸入 NAND 閘（DIP-14）。第 n 組閘：輸入 nA、nB → 輸出 nY。必須接上電源 VCC（第 14 腳）與 GND（第 7 腳）。',
    simulated: [LOGIC_INPUTS, '四組 2 輸入 NAND 閘'],
    limits: LOGIC_LIMITS,
  },
  sn7404: {
    label: '7404 六反相器',
    doc: '六個獨立反相器（DIP-14）。nY = NOT nA。',
    simulated: [LOGIC_INPUTS, '六個反相器'],
    limits: LOGIC_LIMITS,
  },
  sn7408: {
    label: '7408 四組 AND 閘',
    doc: '四組 2 輸入 AND 閘（DIP-14）。',
    simulated: [LOGIC_INPUTS, '四組 2 輸入 AND 閘'],
    limits: LOGIC_LIMITS,
  },
  sn7432: {
    label: '7432 四組 OR 閘',
    doc: '四組 2 輸入 OR 閘（DIP-14）。',
    simulated: [LOGIC_INPUTS, '四組 2 輸入 OR 閘'],
    limits: LOGIC_LIMITS,
  },
  sn7486: {
    label: '7486 四組 XOR 閘',
    doc: '四組 2 輸入 XOR 閘（DIP-14）。',
    simulated: [LOGIC_INPUTS, '四組 2 輸入 XOR 閘'],
    limits: LOGIC_LIMITS,
  },
  sn7474: {
    label: '7474 雙 D 型正反器',
    doc: '具非同步預設／清除、正緣觸發時脈的雙 D 型正反器（DIP-14）。CLR 與 PRE 為低態有效——不使用時請接 VCC。將 QN 接回 D 即成為除 2 的翻轉電路。',
    simulated: [LOGIC_INPUTS, '兩個正緣觸發的 D 型正反器，具非同步低態有效 CLR／PRE'],
    limits: [...LOGIC_LIMITS, 'CLR 與 PRE 同時為低：CLR 優先（實際元件會強制 Q = QN = 高）'],
  },
  cd4017: {
    label: 'CD4017 十進位計數器',
    doc: '強森十進位計數器（DIP-16）：每個 CLK 正緣時，Q0–Q9 依序其中一個變為高電位。將 INH 與 RST 接 GND 即可自由計數。很適合做 LED 跑馬燈。',
    simulated: [LOGIC_INPUTS, '強森十進位計數器：CLK 正緣受 INH 閘控、非同步 RST、計數 0–4 時 CO 為高'],
    limits: LOGIC_LIMITS,
  },
  cd4026: {
    label: 'CD4026 計數器＋七段驅動',
    doc: '具七段直接輸出 A–G 的十進位計數器（DIP-16）——經約 330Ω 電阻驅動共陰極顯示器。CO 每計數 10 次輸出一個脈波（串接到下一位數的 CLK）。DEI 接 VDD，INH 與 RST 接 GND。',
    simulated: [LOGIC_INPUTS, '具七段解碼輸出的十進位計數器、DEI/DEO 顯示致能、CO 與 UCS'],
    limits: LOGIC_LIMITS,
  },
  cd4511: {
    label: 'CD4511 BCD→七段閂鎖／解碼器',
    doc: '用於共陰極顯示器的 BCD 轉七段閂鎖／解碼／驅動器（DIP-16）。BCD 由 A（LSB）、B、C、D（MSB）輸入；段輸出 *_SEG 經約 330Ω 電阻驅動顯示器。LT 與 BL 接 VDD、LE 接 GND 即為直通顯示。要顯示固定數字，將 A–D 依其 BCD 碼接到 VDD／GND——非常適合固定接線的日期顯示。',
    simulated: [LOGIC_INPUTS, 'BCD 閂鎖／七段解碼器，具 LT、BL 與 LE；大於 9 的代碼不顯示'],
    limits: LOGIC_LIMITS,
  },
  sn74193: {
    label: '74193 4 位元上／下數計數器',
    doc: '可預設的 4 位元二進位上／下數計數器（DIP-16）。UP 正緣時上數（DOWN 保持高電位），DOWN 正緣時下數（UP 保持高電位）。LOAD（低態有效）由輸入 A–D 預設 QA–QD；CLR 為高時歸零。',
    simulated: [LOGIC_INPUTS, '可預設的 4 位元上／下數計數器：UP/DOWN 時脈、非同步 LOAD 與 CLR、CO/BO'],
    limits: LOGIC_LIMITS,
  },
  cd4040: {
    label: 'CD4040 12 位元漣波計數器',
    doc: '12 級二進位漣波計數器（DIP-16），在 CLK 的「負緣」前進。Qn 以 CLK/2^n 翻轉——接在 555 之後可將快速時脈除頻到約 1Hz。RST 為高時清除。',
    simulated: [LOGIC_INPUTS, '在 CLK 負緣前進的 12 級漣波計數器，非同步 RST'],
    limits: [...LOGIC_LIMITS, '所有級在同一步階更新（級間沒有漣波延遲）'],
  },

  // -------------------------------------------------------- instruments
  scope_probe: {
    label: '示波器探棒',
    doc: '示波器探棒：將它的單一孔位放在任一網路上，即可在示波器面板繪出該電壓（通道 1–4）。',
    simulated: ['為示波器面板記錄所接觸網路的電壓（通道 1–4）'],
    limits: ['理想探棒：無負載效應、無頻寬限制'],
    params: { channel: '通道' },
  },

  // ------------------------------------------------- embedded platform
  logic_probe: {
    label: '邏輯分析儀探棒',
    doc: '邏輯分析儀探棒：將它的單一孔位放在網路上，即可在邏輯分析儀面板中記錄為通道 D0–D15（UART／I²C／SPI 解碼、VCD 匯出）。不吸取電流。',
    simulated: [
      '網路由 MCU 驅動或可由邏輯層解析時，以精確的時間戳記記錄其邏輯邊緣',
      '否則以類比步階的解析度對類比網路做臨界判定（VIL 0.8 V／VIH 2.0 V，具遲滯）',
    ],
    limits: ['不對被測網路造成負載（理想探棒）'],
    params: { channel: '通道' },
  },
  multimeter: {
    label: '數位萬用電表',
    doc: '桌上型數位萬用電表（置於麵包板外，端子 COM 與 IN）。V 檔量測 IN−COM 電壓（10 MΩ），A 檔量測流經電表的電流（0.1 Ω——須串聯接入），Ω 檔量測兩探棒之間的電阻（僅限未通電的電路）。',
    simulated: [
      'V：IN 與 COM 之間 10 MΩ 輸入阻抗',
      'A：串聯 0.1 Ω 分流電阻（電表須與負載「串聯」）',
      'Ω：1 V／10 kΩ 歐姆計電源——讀取兩探棒之間的電阻',
      '顯示值是約 100 ms（模擬時間）內的平均，與積分式電表相同：PWM 訊號讀到的是平均值（工作週期 × 高電位）',
    ],
    limits: ['僅量測直流（無交流 RMS）', '與實際電表相同，通電電路中的 Ω 讀值無效', '無保險絲模型：A 檔電表跨接在電源上即形成短路'],
    params: { mode: '檔位' },
  },
  stm32_bluepill: {
    label: 'STM32F103C8T6 Blue Pill 開發板',
    doc: 'STM32F103C8T6「Blue Pill」開發板，執行真實韌體（在屬性面板中載入 ELF/BIN）。跨在中央溝槽上放置，腳位位於 h 列與 c 列（定位點 = h 列的 PB12）。電源：5V 腳位（板載 3.3 V 穩壓器）或 3V3 腳位，以及 GND。PC13 上的板載 LED 為低態有效。GPIO 為 3.3 V；PA8–PA15 與 PB3、PB4、PB6–PB15 可耐受 5 V。',
    specs: [
      'Cortex-M3 最高 72 MHz、64 KiB 快閃記憶體、20 KiB SRAM',
      '8 MHz HSE 石英晶體、32.768 kHz LSE 石英晶體',
      '3× USART、2× I²C、2× SPI、4 個計時器（TIM1 為進階型）、2× 12 位元 ADC、7 通道 DMA',
      '由 5 V（板載 LDO）或 3.3 V 腳位供電',
    ],
    simulated: [
      '執行真實韌體：ARMv7-M（Cortex-M3）指令集、NVIC、SysTick、例外處理',
      '周邊依 MCU 支援表（屬性 → 周邊）；存取不支援的區塊時會記錄於日誌',
      'GPIO 電氣模型：50 Ω 驅動、40 kΩ 上拉／下拉、依資料手冊的 VIL/VIH 與遲滯、過電壓／短路警告',
      '板載電源 LED、PC13 LED（510 Ω）、3.3 V LDO、PA12 10 kΩ 上拉',
    ],
    limits: [
      '未模擬 USB、CAN 與系統記憶體開機載入程式（BOOT0 = 1）',
      '指令時序近似 Cortex-M3 TRM（未模擬快閃記憶體等待週期）',
      '晶片本身的耗電（72 MHz 時約 20–36 mA）未模擬：電源供應器讀到的電流不含晶片本身',
    ],
    params: { boot0: 'BOOT0 跳線' },
  },
}
