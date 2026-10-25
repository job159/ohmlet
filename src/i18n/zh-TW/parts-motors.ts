/**
 * zh-TW part texts for the motors & drivers family
 * (src/model/parts/motors.parts.ts): DC motor, SG90 servo, 28BYJ-48 and
 * NEMA 17 steppers, ULN2003 / L298N boards, TB6612FNG and DRV8833
 * breakouts, A4988 / DRV8825 / TMC2209 StepStick carriers. Faithful
 * translations of the catalog doc / specs / simulated / limits (same order);
 * pin notes, part numbers and manufacturers live in catalog-text.ts.
 */
import type { PartText } from '../parts'

const LOAD = { loadTorque: '負載轉矩' }

export const PARTS_ZH: Record<string, PartText> = {
  dc_motor: {
    label: '直流馬達（130 型，3–6 V）',
    doc: '小型有刷直流馬達（130 型，3–6 V），放在桌面上，以端子「ID:M+」與「ID:M-」接線。切勿直接由微控制器（MCU）腳位驅動：請使用 H 橋（L298N、TB6612FNG、DRV8833），或電晶體加飛輪二極體。電壓反接即反轉；轉速 ≈（V − I·3 Ω）÷ 0.004 V·s/弧度（6 V 時約 13 400 轉/分）；堵轉電流為 V ÷ 3 Ω。執行中可調參數 loadTorque（mN·m）會對轉軸施加煞車轉矩。',
    specs: ['3–6 V 有刷永磁馬達', '無負載約 6 400 轉/分（3 V）／13 400 轉/分（6 V），約 0.1 A', '堵轉 2.0 A／8 mN·m（6 V）', '機械時間常數約 22 ms'],
    simulated: [
      '電樞 R 3 Ω + L 0.2 mH + 反電動勢 Ke·ω（Ke = Kt = 0.004 V·s/弧度）',
      '轉子 J·dω/dt = Kt·i − b·ω − 摩擦 − 負載，每個類比步階與電樞方程式一起求解',
      '電刷／軸承摩擦 0.4 mN·m（無負載約 0.1 A），以及執行中可調、靜止時也能保持轉軸的負載轉矩',
      '堵轉：流過完整的 V/R 電流（6 V 時 2.0 A），0.2 秒後記錄警告',
      '轉向依電流方向而定：M+ 為正時，轉軸順時針轉動（由軸端看）',
    ],
    limits: ['只有一種通用馬達（6 V 無負載約 13 400 轉/分）；不模擬電刷火花、換向漣波或電氣雜訊', '沒有發熱模型：堵轉的馬達永遠不會燒毀'],
    params: LOAD,
  },

  sg90_servo: {
    label: 'SG90 微型伺服機',
    doc: 'TowerPro SG90 微型伺服機，放在桌面上，端子為「ID:GND」（棕線）、「ID:VCC」（紅線，由 5 V 電源供應 4.8–6 V——最多約 0.7 A）、「ID:SIG」（橙線）。約每 20 ms 送出一個 0.5–2.5 ms 的高電位脈波（例如 50 Hz 的計時器 PWM）：0.5 ms = 0°、1.5 ms = 90°、2.5 ms = 180°。伺服機電源與微控制器（MCU）必須共地。',
    specs: ['4.8–6 V，4.8 V 時 0.1 秒/60°', '堵轉轉矩 1.8 kg·cm（約 0.18 N·m）', '50 Hz、0.5–2.5 ms 脈波對應 0–180°', '死區 5 µs，重 9 g'],
    simulated: [
      '由腳位量測 SIG 脈寬（臨界值 0.8 V／2.0 V）：0.5 ms → 0°、2.5 ms → 180°，接受 0.3–3 ms 的脈波',
      '位置迴路：以比例方式驅動馬達與齒輪組模型（誤差超過 ±6° 時全速，死區 0.45°）——4.8 V 時 0.1 秒/60°，速度與轉矩隨 VCC 變化',
      'VCC 汲取 6 mA 加上馬達電流（4.8 V 堵轉時約 0.7 A）：轉動中的伺服機會拉低 5 V 電源軌',
      '機械止檔在 −3°／183°；執行中可調的舵角負載轉矩',
    ],
    limits: [
      '沒有脈波時保持最後位置（主動保持，如同持續收到訊號）——實際的 SG90 會停止驅動，只靠齒輪摩擦維持',
      '控制迴路為理想化（沒有脈波間抖動，也沒有實際控制晶片的過衝）',
      '沒有熱模型；電源低於 3 V 時電路關閉',
    ],
    params: LOAD,
  },

  stepper_28byj48: {
    label: '28BYJ-48 步進馬達（5 V）',
    doc: '28BYJ-48 5 V 減速單極步進馬達，放在桌面上，引線為「ID:ORANGE」、「ID:YELLOW」、「ID:PINK」、「ID:BLUE」及共同端「ID:RED」（+5 V）。以低側開關驅動四條引線（ULN2003 驅動板 OUT1–OUT4 依序接 ORANGE、YELLOW、PINK、BLUE）。順時針序列：ORANGE、YELLOW、PINK、BLUE（半步：O、O+Y、Y、Y+P、P、P+B、B、B+O）；輸出軸每圈 4096 個半步；每個半步約 1–2 ms。',
    specs: ['5 V 單極、4 相、每相 50 Ω', '步距角 5.625°/64：輸出軸每圈 4096 個半步', '64:1 減速，牽入轉矩 ≥ 34.3 mN·m', '使用 ULN2003 驅動板驅動'],
    simulated: [
      '四個半繞組（50 Ω、25 mH）由 RED 接到各引線，各自帶有反電動勢',
      '永磁轉子，馬達每圈 32 個全步，轉矩來自磁極電流（ORANGE−PINK、YELLOW−BLUE）加上定位轉矩',
      '64:1 齒輪組：輸出軸每圈 2048 個全步（4096 個半步）；負載轉矩施加在輸出軸',
      '激磁順序錯誤時轉子會來回抖動或停住不動，步進太快會失步',
    ],
    limits: ['模型中同一磁極的兩個半繞組沒有磁耦合', '齒輪比固定為 64:1（實際約 63.68:1），沒有齒隙'],
    params: LOAD,
  },

  nema17_stepper: {
    label: 'NEMA 17 步進馬達（1.7 A）',
    doc: 'NEMA 17 雙極步進馬達（1.8°、1.7 A、1.5 Ω），放在桌面上，端子「ID:A+」、「ID:A-」（A 線圈）與「ID:B+」、「ID:B-」（B 線圈）。A 線圈接 1A/1B（A4988）、A1/A2（DRV8825）、M1A/M1B（TMC2209）或 OUT1/OUT2（L298N），B 線圈接另一組。每圈 200 個全步；驅動器的限流（VREF）請設定在馬達額定值以下。',
    specs: ['雙極，每步 1.8°（每圈 200 步）', '每相 1.7 A、1.5 Ω、2.8 mH', '保持轉矩 0.40 N·m', '可用 A4988／DRV8825／TMC2209／L298N 驅動'],
    simulated: [
      '兩組 1.5 Ω／2.8 mH 線圈，含反電動勢（Ke = Kt = 0.166 V·s/弧度）',
      '50 齒混合式轉子（每圈 200 個全步）：轉矩來自兩相電流加上 0.022 N·m 定位轉矩，轉動慣量 54 g·cm²，含摩擦與執行中可調負載',
      '微步進依驅動器電流而定；步進太快、共振或電流太小都會失步',
    ],
    limits: ['沒有磁飽和（超過額定電流時轉矩仍與電流成正比）', '沒有熱模型'],
    params: LOAD,
  },

  uln2003_board: {
    label: 'ULN2003 步進馬達驅動板',
    doc: 'ULN2003 步進馬達驅動板（放在桌面上）：輸入「ID:IN1」至「ID:IN4」接微控制器（MCU）腳位，電源「ID:VCC」（28BYJ-48 用 +5 V）與「ID:GND」（與 MCU 共地）。輸入為高電位時，對應的輸出「ID:OUT1」至「ID:OUT4」會灌入電流——依序接到 28BYJ-48 的 ORANGE、YELLOW、PINK、BLUE 引線，馬達紅線接 VCC。LED A–D 顯示作用中的通道。',
    specs: ['ULN2003A：7 組達林頓灌電流開關，各 500 mA、50 V', '使用 4 個通道，LED A–D', '5–12 V 電源', '相容 3.3 V／5 V 邏輯輸入'],
    simulated: [
      '每個通道都是資料手冊電路圖中的 ULN2003A 達林頓對（2.7 kΩ 輸入、7.2 kΩ／3 kΩ 基極電阻、兩顆 Ebers-Moll 電晶體）——100–200 mA 時飽和電壓約 0.9–1 V；3.3 V 輸入即可驅動',
      '每個輸出到 VCC（馬達共同端）的箝位二極體吸收線圈反衝',
      '指示 LED A–D（由 VCC 經 1 kΩ 接到各輸出）在通道灌入電流時發亮',
    ],
    limits: [
      '電晶體使用通用小訊號模型（沒有 500 mA 電流限制與熱限制——超過 0.5 A 由電氣規則檢查標示）',
      '箝位二極體以一般矽二極體模擬（約 0.8 V；ULN2003A 規格為 350 mA 時 1.7 V）',
      '電源跳線帽固定插上；馬達接頭即四個 OUT 端子加上 VCC',
    ],
  },

  l298n_module: {
    label: 'L298N 雙 H 橋模組',
    doc: 'L298N 雙 H 橋模組（放在桌面上，13 個端子）。電源：「ID:+12V」為馬達電源（7–12 V 時可使用 5V-EN 穩壓器跳線帽），「ID:GND」與微控制器（MCU）共地，「ID:+5V」為 5 V 輸出（插上跳線帽時）或邏輯電源輸入。馬達 A 接 OUT1/OUT2，馬達 B 接 OUT3/OUT4。H 橋 A：ENA 為高時致能，IN1/IN2 = 1/0 正轉、0/1 反轉、相同則煞車；ENA 為低則滑行。ENA/ENB 跳線帽把致能腳接到 +5V——要用 PWM 驅動 ENA 控制速度，請把參數 jumperEnA 關閉（拔掉跳線帽）。馬達端電壓約比 VS 低 2 V。',
    specs: ['雙全橋，每通道 2 A，VS 最高 35 V（L298 晶片為 46 V）', '雙極達林頓輸出：壓降約 2–3 V', '板載 78M05 5 V 穩壓器（跳線帽）、8 顆飛輪二極體', '邏輯輸入相容 3.3 V／5 V'],
    simulated: [
      'L298 的 H 橋以達林頓開關模擬，採用資料手冊的飽和電壓（0.5 A 時總壓降約 2 V、1 A 時 2.55 V）：馬達得到 VS 減去壓降',
      '由腳位讀取 ENx 與 INx 真值表（VIL 1.5 V／VIH 2.3 V：3.3 V 邏輯可用）；EN 為低時兩個輸出都關閉，電流經八顆飛輪二極體續流（快速衰減）',
      '5V-EN 跳線帽 → 板載 78M05 穩壓器（需要 VS ≥ 7 V）供應邏輯與 +5V 端子；ENA／ENB 跳線帽把致能腳接到 +5V（使用 PWM 時請拔掉）',
      '電源 LED、靜態電流；警告：沒有邏輯電源、插著穩壓器跳線帽時 VS > 12 V、每通道 > 2 A、EN 腳被跳線帽接住卻仍被驅動',
    ],
    limits: ['沒有熱模型（L298 沒有過電流保護——實際會過熱）', '不模擬切換延遲（約 1–2 µs）；兩顆 220 µF 大電容未模擬'],
    params: { jumper5v: '5V-EN 穩壓器跳線帽', jumperEnA: 'ENA 跳線帽（接 +5V）', jumperEnB: 'ENB 跳線帽（接 +5V）' },
  },

  tb6612fng_module: {
    label: 'TB6612FNG 雙馬達驅動器',
    doc: 'TB6612FNG 雙馬達驅動擴充板，跨在中央溝槽上（h 列與 c 列，`at` = h 列的 VM；只能旋轉 0/180）。h 列：VM VCC GND AO1 AO2 BO2 BO1 GND；c 列：PWMA AIN2 AIN1 STBY BIN1 BIN2 PWMB GND。VM 為馬達電源，VCC 接 3.3 V 邏輯電源，STBY 必須為高。馬達 A 接 AO1/AO2：AIN1=1 AIN2=0 → 順時針，0/1 → 逆時針，PWMA = 速度（PWM，低電位時煞車）。',
    specs: ['雙 MOSFET H 橋，每通道平均 1.2 A／峰值 3.2 A', 'VM 2.5–13.5 V，VCC 2.7–5.5 V', '順時針／逆時針／短路煞車／停止、待機', 'PWM 最高 100 kHz'],
    simulated: [
      'MOSFET H 橋，上下臂導通電阻合計 0.5 Ω，含本體二極體',
      '每通道真值表：IN1/IN2/PWM → 順時針、逆時針、短路煞車、停止；STBY 為低 = 待機（全部關閉）；輸入臨界值 0.3／0.7·VCC，內建 200 kΩ 下拉',
      'PWMx 上的 PWM 會在驅動與短路煞車之間切換（慢速衰減）：馬達電壓約為責任週期 × VM',
      '警告：VM > 15 V、VCC > 6 V、VM 有電但 VCC 沒有、每通道 > 3.2 A',
    ],
    limits: ['不模擬熱關斷與欠壓遲滯的細節', '不模擬切換延遲與死區時間'],
  },

  drv8833_module: {
    label: 'DRV8833 雙馬達驅動器',
    doc: 'DRV8833 雙 H 橋擴充板，跨在中央溝槽上（g 列與 d 列，`at` = g 列的 SLP；只能旋轉 0/180）。g 列：SLP AIN1 AIN2 BIN1 BIN2 FLT；d 列：VM GND AOUT1 AOUT2 BOUT2 BOUT1（其他廠商的擴充板排針順序可能不同——請依絲印標示接線）。VM 2.7–10.8 V。SLP 必須為高。馬達 A 接 AOUT1/AOUT2：AIN1=1 AIN2=0 正轉、0/1 反轉、1/1 煞車、0/0 滑行。',
    specs: ['雙 MOSFET H 橋，每橋 1.5 A 有效值／2 A 峰值', 'VM 2.7–10.8 V，不需另接邏輯電源', '滑行／煞車，快速或慢速衰減 PWM', '睡眠、欠壓鎖定、過電流保護'],
    simulated: [
      'MOSFET H 橋（高側 200 mΩ + 低側 160 mΩ），含本體二極體',
      'xIN1/xIN2：00 滑行（經本體二極體快速衰減）、10 正轉、01 反轉、11 煞車（慢速衰減）——在一個輸入加 PWM、另一個為低是快速衰減，另一個為高則是慢速衰減',
      'SLP（nSLEEP）為低 = 睡眠，拉高後 1 ms 才啟動；VM 欠壓鎖定 2.6 V；輸入 VIL 0.7 V／VIH 2 V，內建下拉',
      '過電流保護：超過 3.3 A 持續 4 µs 時關閉該 H 橋並把 FLT 拉低 1.35 ms，之後自動重試',
    ],
    limits: ['此擴充板的 xISEN 直接接地：沒有電流調節', '沒有熱關斷'],
  },

  a4988_driver: {
    label: 'A4988 步進馬達驅動器（StepStick）',
    doc: 'A4988 StepStick 載板，跨在中央溝槽上（g 列與 d 列，`at` = g 列的 EN；只能旋轉 0/180）。g 列：EN MS1 MS2 MS3 RST SLP STEP DIR；d 列：VMOT GND 2B 2A 1A 1B VDD GND。VMOT 8–35 V，VDD 由開發板的 3.3 V 供應，RST 接到 SLP（RESET 為浮接）。STEP 正緣 = 走一個微步（高電位 ≥ 1 µs），DIR = 方向，MS1–MS3 = 全步／½／¼／⅛／1/16。馬達線圈 1 接 1A/1B，線圈 2 接 2A/2B。限流 = VREF ÷ 0.544 Ω（可調參數「限流 VREF」）。',
    specs: ['雙極步進馬達驅動器，每線圈最高 2 A（無散熱約 1 A）', 'VMOT 8–35 V，VDD 3–5.5 V', '全步到 1/16 微步進', '限流 I = VREF ÷ 0.544 Ω（RS = 0.068 Ω）'],
    simulated: [
      '步進序列器：STEP 正緣依 DIR 方向前進一個微步；MS1–MS3 設定全步／½／¼／⅛／1/16（資料手冊表 1），於邊緣取樣，原點在 45°',
      '線圈電流依資料手冊正弦表，滿刻度 I = VREF ÷（8 × 0.068 Ω）',
      '電流截波以週期平均模擬：只要 H 橋（0.64 Ω 路徑，含本體二極體）的電壓足夠，線圈電流就跟隨目標——高步進速率時受 L、R 與反電動勢限制；電流上升時慢速衰減（1 µs 最短導通時間造成 +VMOT/31），下降時混合衰減（30 µs 關閉時間中 31.25% 為快速衰減）',
      'ENABLE（輸出關閉，序列器繼續計數）、RESET（回原點、輸出關閉）、SLEEP（1 ms 喚醒）、VDD 2.8 V 與 VMOT 8 V 欠壓鎖定',
      '輸入臨界值 0.3／0.7·VDD（3.3 V 微控制器需要 VDD = 3.3 V）；MS1/MS3 100 kΩ、MS2 50 kΩ 下拉，載板上 10 kΩ SLEEP 上拉；STEP 脈波太短、DIR 建立時間不足與 STEP 準位不確定時會警告',
    ],
    limits: [
      '約 30 kHz 的截波以平均值表示：沒有電流漣波，輸出顯示的是平均電壓（以 VMOT/2 為中心）而非 PWM 邊緣',
      '不模擬過電流／對地短路保護與熱關斷',
      'RESET 沒有上下拉電阻：浮接時讀為低，驅動器保持在重置狀態（與實際載板相同——請把 RST 接到 SLP）',
    ],
    params: { vref: '限流 VREF' },
  },

  drv8825_driver: {
    label: 'DRV8825 步進馬達驅動器（StepStick）',
    doc: 'DRV8825 StepStick 載板，跨在中央溝槽上（g 列與 d 列，`at` = g 列的 EN；只能旋轉 0/180）。g 列：EN M0 M1 M2 RST SLP STEP DIR；d 列：VMOT GND B2 B1 A1 A2 FAULT GND。RST 與 SLP 都要拉高（兩者都有下拉電阻）。STEP 正緣 = 走一個微步（高電位 ≥ 1.9 µs），M0–M2 = 全步到 1/32。A 線圈接 A1/A2，B 線圈接 B1/B2。限流 = 2·VREF（可調參數「限流 VREF」）。',
    specs: ['雙極步進馬達驅動器，加散熱時每線圈 2.2 A', 'VMOT 8.2–45 V，3.3／5 V 邏輯，沒有 VDD 腳', '全步到 1/32 微步進', '限流 I = 2·VREF（RS = 0.1 Ω）'],
    simulated: [
      '序列器：STEP 正緣 = 走一個微步，M0–M2 設定全步到 1/32（資料手冊表 1），電流依表 2 取整數百分比（全步 71%），原點 45°',
      '滿刻度電流 I = VREF ÷（5 × 0.1 Ω）= 2·VREF；30 kHz 截波以週期平均模擬（0.5 Ω 路徑，含本體二極體）：電流上升時慢速衰減（3.75 µs 遮沒時間造成 +0.11·VMOT），下降時混合衰減（週期前 75% 為快速衰減）',
      'nENBL／nRESET／nSLEEP（約 1 ms 喚醒），依資料手冊內建下拉；邏輯由 VMOT 供電（欠壓鎖定 7.8 V）；輸入 VIL 0.7 V／VIH 2.2 V；載板上 FAULT → SLEEP 電阻',
    ],
    limits: ['截波以平均值表示：沒有電流漣波，輸出顯示平均電壓而非 PWM 邊緣', 'DECAY 腳沒有引出：固定為混合衰減', '不模擬過電流保護（nFAULT）與熱關斷：FAULT 保持釋放'],
    params: { vref: '限流 VREF' },
  },

  tmc2209_driver: {
    label: 'TMC2209 步進馬達驅動器（StepStick）',
    doc: 'TMC2209 StepStick 模組，跨在中央溝槽上（g 列與 d 列，`at` = g 列的 EN；只能旋轉 0/180）。g 列：EN MS1 MS2 SPREAD UART PDN STEP DIR；d 列：VM GND M2B M2A M1A M1B VIO GND。獨立模式：EN 為低時致能，MS2/MS1 = 00 1/8、01 1/32、10 1/64、11 1/16（內插到 1/256）。A 線圈接 M1A/M1B，B 線圈接 M2A/M2B。VIO = 3.3 V。未模擬 UART 設定。',
    specs: ['雙極步進馬達驅動器，有效值 2 A（峰值 2.8 A）', 'VM 4.75–28 V，VIO 3–5 V', '1/8–1/64 步，內插到 1/256', 'StealthChop2／SpreadCycle，UART 設定'],
    simulated: [
      '獨立 STEP/DIR 模式：MS2/MS1 = 00 → 1/8、01 → 1/32、10 → 1/64、11 → 1/16，每一步依上一個步進週期內插到 1/256（MicroPlyer）',
      '峰值電流 =（VREF ÷ 2.5 V）× 0.325 V ÷（0.11 Ω + 20 mΩ），正弦表，週期平均的電流調節（0.45 Ω 路徑，含本體二極體）；EN 低態致能',
      'VIO／VM 欠壓重置',
    ],
    limits: [
      '不模擬 UART 暫存器介面（PDN_UART）——偵測到訊號活動時記錄一次；驅動器維持獨立模式',
      'StealthChop（電壓模式 PWM）與 SpreadCycle 都以相同的電流截波模擬：沒有 StealthChop 的靜音效果或自動調校，也沒有 StallGuard／CoolStep',
      '沒有靜止時自動降低電流，沒有短路／過溫保護，沒有 DIAG／INDEX 輸出（未引出到排針）',
    ],
    params: { vref: '限流 VREF' },
  },
}
