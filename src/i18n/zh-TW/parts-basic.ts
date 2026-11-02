/**
 * zh-TW part texts for the basic-parts family (src/model/parts/basic.parts.ts):
 * label, doc, meta.specs, support.simulated / support.limits (same order as
 * the catalog), param labels and select option labels. Part numbers, pin
 * names, units and formulas stay as in the catalog. Pin notes and
 * manufacturers (shown through tText → tMessage) live in messages-core.ts.
 */
import type { PartText } from '../parts'

// shared texts (basic.parts.ts SWITCH_CONTACT / MOS_BODY / MOS_LIMITS)
const SWITCH_CONTACT = '接點：閉合 20 S（50 mΩ）／斷開 1 nS'
const MOS_BODY = '本體二極體：Shockley 接面 Is = 1 pA、n = 1.2（1 A 時約 0.86 V）'
const MOS_LIMITS = ['無閘極電容與閘極電荷（瞬間切換）', '無次臨界導通、無崩潰、無熱模型']
const NO_DISCHARGE = '無放電：未模擬容量、電量狀態與逐漸下降的放電曲線'
const SHORT_FLAG = '電流超過 2 A 持續 10 ms 才標示為可能短路（電容剛通電的充電湧浪不算）；電流回到 2 A 以下 10 ms 後警告就解除'
const SOURCE_ONLY = '輸出只能供出電流（不能吸入）'
const IQ = '由 IN 流向 GND 的靜態電流 5 mA'

export const PARTS_ZH: Record<string, PartText> = {
  rgb_led: {
    label: 'RGB LED（5 mm）',
    doc: '霧面 5 mm RGB LED，4 支接腳依序為 R、COM、G、B（COM 最長）。參數「共同端」= 共陰極（COM 接 GND，R/G/B 輸出高電位點亮）或共陽極（COM 接 +，R/G/B 拉低點亮）。每個顏色各用一顆電阻（5 V 時紅色約 150 Ω、綠／藍色約 100 Ω）；以 PWM 混色。',
    specs: [
      '20 mA 時 Vf ≈ 2.0 V（R）／3.2 V（G）／3.2 V（B）',
      '每顆晶粒連續 20 mA——每個顏色各串聯一顆電阻',
      '接腳順序 R · COM · G · B（COM 最長）',
    ],
    simulated: [
      '三個 LED 接面（Shockley，n = 2）接到共同端，依 10 mA 時的順向電壓擬合：紅 1.95 V、綠 3.1 V、藍 3.1 V（20 mA 時約 2.0／3.2／3.2 V）',
      '共陰極或共陽極（參數）',
      '亮度 = 各晶粒電流 ÷ 額定 20 mA（20 mA 時 100 %；屬性面板顯示最亮的晶粒）；3D 中各晶粒依人眼的感受發光，環氧樹脂外殼顯示混合後的顏色',
      '晶粒電流超過 150 mA（峰值額定）達 1 ms 以上即燒毀（仍會導通，但不再發光）',
    ],
    limits: [
      '無逆向崩潰',
      '沒有接面溫度模型（5 mm LED 有）：晶粒超過額定 20 mA 不會過熱，超過 150 mA 才會燒毀',
      '沒有各色發光效率：相同電流下每種顏色一樣亮',
    ],
    params: { common: '共同端' },
    options: { common: { cathode: '共陰極', anode: '共陽極' } },
  },
  pmos: {
    label: 'P 通道 MOSFET（TO-92）',
    doc: '通用小型 P 通道 MOSFET（TO-92），腳位與 N 通道 MOSFET 相同為源極／閘極／汲極。高側開關：源極接 +，汲極接負載，閘極以電阻拉到源極；閘極被拉到比源極低 2 V 以上時 FET 導通（Vth 參數，預設 −2 V）。',
    specs: ['Vth −2 V（可調）', 'S-G-D 腳位順序與元件庫中的 2N7000 相同——實際 TO-92 P-FET 的腳位各家不同'],
    simulated: [
      '平方律（SPICE 第 1 級）P 通道 MOSFET，為元件庫 N 通道 MOSFET 的鏡像：Vth = −2 V（參數）、k = 0.1 A/V²、λ = 0.01 /V',
      '汲極與源極對調時對稱導通',
      MOS_BODY,
    ],
    limits: MOS_LIMITS,
    params: { vth: '臨界電壓' },
  },
  irlz44n: {
    label: '邏輯準位 N 通道 MOSFET（IRLZ44N）',
    doc: 'IRLZ44N 邏輯準位功率 N 通道 MOSFET（TO-220），腳位為閘極／汲極／源極（正面由左至右）。用於馬達、LED 燈條、繼電器的低側開關：源極接 GND，汲極接負載，閘極直接由 3.3–5 V 的 GPIO 驅動（加下拉電阻）。寬大的本體會在兩側外接腳旁各多佔一欄。',
    specs: [
      'VDSS 55 V、ID 47 A（TC = 25 °C）',
      'VGS = 5 V 時 RDS(on) ≤ 25 mΩ，4 V 時 ≤ 35 mΩ',
      'VGS(th) 1.0–2.0 V；無散熱片時約 2.4 W（RθJA 62 °C/W）',
    ],
    simulated: [
      '依 IRLZ44N 擬合的平方律 N 通道 MOSFET：Vth = 1.5 V（參數，資料手冊為 1.0–2.0 V）、k = 11.4 A/V² → VGS = 5 V 時 RDS(on) 25 mΩ，4 V 時 35 mΩ',
      MOS_BODY,
      '汲極與源極對調時對稱導通',
    ],
    limits: [...MOS_LIMITS, '閘極驅動高於 5 V 時 RDS(on) 會持續下降（實際元件約在 22 mΩ 趨於平緩）'],
    params: { vth: '臨界電壓' },
  },
  zener: {
    label: '稽納二極體（BZX55）',
    doc: '稽納二極體（BZX55，DO-35），腳位為陽極／陰極（有色環端）。逆向偏壓（陰極為正）時箝位在 Vz（參數，預設 5 mA 時 5.1 V）；順向時與一般二極體一樣導通（約 0.7 V）。務必經串聯電阻供電：R = (Vin − Vz) / I。',
    specs: ['IZT = 5 mA 時 Vz 4.8–5.4 V（5V1）', '500 mW，DO-35 玻璃封裝'],
    simulated: [
      '順向：Shockley 接面 Is = 1 pA、n = 1.2（與元件庫的二極體相同）',
      '逆向崩潰 I = 5 mA·exp((Vr − Vz)/0.1 V)：於 5 mA 測試電流時為 Vz，動態電阻 0.1 V / I（5 mA 時 20 Ω）',
      '牛頓法收斂保護：兩個接面在每次迭代之間都有限制（SPICE pnjlim）',
    ],
    limits: [
      '所有 Vz 的膝點柔和度相同（實際低壓稽納較柔和，高壓則較陡）',
      '無溫度係數、無功率限制（額定 500 mW）',
      '無接面電容',
    ],
    params: { vz: '稽納電壓' },
  },
  pc817: {
    label: '光耦合器（PC817）',
    doc: 'PC817 光耦合器（DIP-4，跨在中央溝槽上；`at` = f 列的第 1 腳陽極）。LED 側：陽極／陰極經電阻驅動（5–20 mA）。電晶體側：集極接上拉電阻，射極接該側的接地——LED 點亮時輸出被拉低。兩側之間電氣隔離。',
    specs: ['IF = 5 mA 時 CTR 50–600 %（等級 A–D）', 'IF ≤ 50 mA、VCEO 35 V', '5 kV 隔離'],
    simulated: [
      '紅外線 LED：Shockley 接面，n = 2，20 mA 時 VF = 1.2 V',
      '光電晶體：IC = CTR · IF（參數，預設 100 %），電流控制，具 Ebers-Moll 飽和特性（IF = 20 mA、IC = 1 mA 時 VCE(sat) ≈ 0.09 V）',
      '電氣隔離：LED 側與電晶體側之間沒有任何導通',
    ],
    limits: [
      'CTR 與 IF 及溫度無關（實際 CTR 約在 IF = 5–10 mA 達到峰值）',
      '無切換延遲（tr ≈ 4 µs、tf ≈ 3 µs）——以類比步階計算',
      '無 LED 逆向崩潰（額定 6 V）',
    ],
    params: { ctr: '電流傳輸比' },
  },
  lm7805: {
    label: '5 V 穩壓器（LM7805）',
    doc: 'LM7805 固定 5 V 線性穩壓器（TO-220），腳位為 IN／GND／OUT（正面由左至右）。IN 輸入 7–35 V，GND 接地，由 OUT 取得 5 V（≤ 1.5 A）。需要 ≥ 2 V 的壓差餘裕；會以 (VIN − 5 V)·I 的功率發熱。寬大的本體會在兩側外接腳旁各多佔一欄。',
    specs: ['5 V ± 4 %、1.5 A', '壓降 2 V，輸入 ≤ 35 V', 'Iq ≈ 5 mA', 'P = (VIN − 5 V) · I——超過約 1 W 需加散熱片'],
    simulated: [
      'VIN − VOUT ≥ 2 V 壓降時，穩定輸出 5.00 V 串聯 10 mΩ（負載調整率）；低於此值時 VOUT = VIN − 2 V',
      '限流 1.5 A（準靜態，數個步階內穩定）',
      IQ,
      SOURCE_ONLY,
    ],
    limits: [
      '無熱模型：實際 7805 在無散熱片下耗散數瓦會過熱關斷——這裡會持續穩壓',
      '無漣波抑制與暫態響應',
      '壓降固定為 2 V（實際壓降隨負載電流增加）',
    ],
  },
  ams1117_33: {
    label: '3.3 V LDO 模組（AMS1117-3.3）',
    doc: '裝在小型直立轉接板上的 AMS1117-3.3 LDO，排針 IN／GND／OUT 排成一列。IN 輸入 4.5–15 V（例如 5 V 電源軌），由 OUT 取得 3.3 V（≤ 1 A）——這是從 5 V 供電給 3.3 V 感測器或 STM32 的常見做法。',
    specs: ['3.3 V、1 A', '800 mA 時壓降 1.1 V', '輸入 ≤ 15 V', '直立式 3 腳 SIP 轉接板，附 10 µF 電容'],
    simulated: [
      'VIN − VOUT ≥ 1.1 V 壓降時，穩定輸出 3.30 V 串聯 10 mΩ；低於此值時 VOUT = VIN − 1.1 V',
      '限流 1.1 A（準靜態）',
      IQ,
      SOURCE_ONLY,
    ],
    limits: [
      '無熱模型（小板上的 SOT-223：約 1 W 即過熱關斷——未模擬）',
      '壓降固定為 1.1 V（資料手冊 800 mA 時的值；輕載時較低）',
      '未模擬輸出電容 ESR 對穩定度的影響',
    ],
  },
  battery_9v: {
    label: '9 V 電池',
    doc: '置於麵包板外、附電池扣的 9 V 鹼性電池（端子 "ID:+" 紅色、"ID:-" 黑色）。端電壓 = 9 V − I·1.5 Ω，因此負載下會下降。可單獨為電路供電：其 "-" 端子即為電路接地。',
    specs: ['標稱 9 V，內阻約 1.5 Ω（全新鹼性電池）', '約 500 mAh——適合小負載'],
    simulated: ['戴維寧等效電池：開路電壓（參數，9 V）串聯內阻（參數，1.5 Ω）——端電壓隨負載下降', SHORT_FLAG],
    limits: [NO_DISCHARGE, '內阻固定（實際電池在電量減少及低溫時內阻會上升）'],
    params: { voltage: '開路電壓', rint: '內阻' },
  },
  battery_aa2: {
    label: '2×AA 電池盒（3 V）',
    doc: '置於麵包板外、兩顆 AA 電池串聯的電池盒（端子 "ID:+" 與 "ID:-"）：3 V 串聯約 0.3 Ω。足以驅動 LED，或以較低電壓供電給可承受 3.3 V 的電路。可單獨為電路供電：其 "-" 端子即為電路接地。',
    specs: ['標稱 3.0 V（2 × 1.5 V）', '總內阻約 0.3 Ω', '約 2500 mAh'],
    simulated: ['兩顆串聯電池視為一個戴維寧電源：3.0 V（參數）串聯 0.3 Ω（參數，每顆鹼性電池約 0.15 Ω）', SHORT_FLAG],
    limits: [NO_DISCHARGE, '內阻固定'],
    params: { voltage: '開路電壓', rint: '內阻' },
  },
  current_source: {
    label: '實驗室電流源',
    doc: '置於麵包板外的實驗室電流源（端子 "ID:+" 與 "ID:-"）：將設定的電流（0–100 mA，執行中可調）推過所連接的電路，最高到順從電壓（≤ 12 V）——超過後改為維持該電壓（CV）。非常適合以精確電流量測 LED 或稽納二極體。',
    specs: ['0–100 mA', '順從電壓 0.5–12 V', 'CC／CV 指示燈'],
    simulated: [
      '定電流（0–100 mA，執行中可調）由 "+" 流出、經負載流回 "−"，輸出電阻 1 MΩ',
      '順從電壓限制（≤ 12 V）：負載需要更高電壓時，輸出變成位於限制值的電壓源（CV），與實際 SMU 相同',
      '輸出開路時穩定在順從電壓',
    ],
    limits: ['單象限：只能供出電流（負載把輸出驅動為負值時不受限制）', '無迴轉與穩定時間動態'],
    params: { current: '電流', compliance: '順從電壓' },
  },
  relay_5v: {
    label: '5 V 繼電器（SRD-05VDC-SL-C）',
    doc: '跨在中央溝槽上的 SRD-05VDC-SL-C 5 V 繼電器：`at` = d 列的 COIL1；COIL2 = 同一欄的 g 列，COM = 左邊一欄的 e 列，NO = 右邊五欄的 g 列，NC = 右邊五欄的 d 列。線圈須經 NPN／N 通道 MOSFET 驅動（71 mA），並且「務必」在線圈兩端並聯二極體（陰極接 +）。靜止時 COM 接 NC，激磁時接 NO。本體蓋住第 at−1…at+5 欄的 c–h 列：請由 a/b 列與 i/j 列接線。',
    specs: ['線圈 5 V、70 Ω（約 0.36 W）', '接點 10 A 250 VAC／30 VDC，C 型（切換式）接點', '動作 ≤ 10 ms，釋放 ≤ 5 ms'],
    simulated: [
      '線圈：70 Ω 串聯 0.1 H（後向尤拉等效模型）——電流以 τ ≈ 1.4 ms 上升，線圈電流被切斷時產生 L·di/dt 反衝電壓',
      '銜鐵對線圈電流具遲滯：53.6 mA 吸合（5 V 的 75 %，資料手冊最大值），7.1 mA 釋放（10 %，資料手冊最小值）',
      '吸合後 4 ms／釋放後 2 ms 接點切換（先斷後通，0.5 ms 間隙）——5 V 時總動作時間約 6 ms',
      `C 型接點 COM–NO／COM–NC，${SWITCH_CONTACT}`,
      '線圈在沒有飛輪二極體的情況下斷電、且反衝電壓超過 30 V 時發出警告',
    ],
    limits: [
      '線圈電感為估計值（資料手冊未列出），且不隨銜鐵位置改變',
      '無接點彈跳與電弧；不檢查接點的額定電流／電壓',
      '反衝電壓幅度由求解器步階決定（無電晶體雪崩崩潰或繞組電容）',
    ],
  },
  toggle_switch: {
    label: '撥動開關（SPDT）',
    doc: '超小型 SPDT 撥動開關，3 支接腳 a／common（共同端）／b。位置「a」將共同端接到 a，「b」將共同端接到 b；與實際撥動開關一樣，撥桿指向「遠離」所連接端子的方向。可在模擬執行時切換。',
    specs: ['ON-ON、SPDT', '模擬執行時可切換'],
    simulated: [`共同端 ↔ a 或 b（滑動開關模型），${SWITCH_CONTACT}`, '執行中可切換位置'],
    limits: ['無接點彈跳；切換瞬間完成（沒有先斷後通的間隙）'],
    params: { state: '位置' },
    options: { state: { a: 'a', b: 'b' } },
  },
  ntc_10k: {
    label: 'NTC 熱敏電阻 10 kΩ',
    doc: 'NTC 熱敏電阻，25 °C 時 10 kΩ（B = 3950），2 支接腳；溫度升高時電阻下降（模擬時可設定溫度）。與 10 kΩ 電阻組成分壓電路接到 ADC 腳位，再以 B 值方程式換算。',
    specs: ['25 °C 時 10 kΩ ± 1 %', 'B = 3950 K', 'B 值方程式：0 °C 時約 33.6 kΩ，50 °C 時約 3.6 kΩ'],
    simulated: [
      'R(T) = 10 kΩ · exp(3950 · (1/T − 1/298.15 K))——25 °C 時 10 kΩ，B25/50 = 3950 K',
      '執行中可調整溫度（−40 … 125 °C）',
    ],
    limits: [
      '無自體發熱（實際使用時感測電流請維持在約 100 µA 以下）',
      '瞬間熱響應（實際珠狀熱敏電阻需數秒）',
      '遠離 25 °C 時，B 值方程式與 R–T 表會有數 % 的偏差',
    ],
    params: { temperature: '溫度' },
  },
  crystal_hc49: {
    label: '石英晶體（HC-49）',
    doc: 'HC-49/S 金屬殼石英晶體（2 支接腳，相隔兩個孔位放置）。僅視覺接線：模擬器不會讓石英晶體振盪——MCU 時脈內建於 MCU 模型中。',
    specs: ['插件式 HC-49/S 金屬殼，接腳間距 4.88 mm', '常見 8–25 MHz，負載電容 18–20 pF'],
    simulated: ['僅擺放、接線與網路表——兩個腳位皆為開路'],
    limits: [
      '類比求解器不模擬石英晶體振盪（MHz 級共振遠高於 50 µs 步階）',
      'MCU 時脈在 MCU 內部模擬——麵包板上的石英晶體不會改變它',
    ],
    params: { frequency: '頻率' },
  },
  level_shifter_4ch: {
    label: '4 通道電位轉換器（BSS138）',
    doc: '跨在中央溝槽上的 BSS138 4 通道雙向電位轉換模組：`at` = g 列的 LV1；g 列依序為 LV1 LV2 LV GND LV3 LV4（由左至右），d 列在正對面依序為 HV1 HV2 HV GND HV3 HV4。供電 LV（例如 3.3 V）、HV（例如 5 V）與 GND；LVn ↔ HVn 雙向轉換開汲極訊號（I²C、UART）。模組板蓋住其六欄的 d–g 列。',
    specs: ['4 個雙向通道', 'LV 1.8–5 V，HV ≥ LV，最高 10 V', '兩側皆有 10 kΩ 上拉', 'I²C／UART／低速 SPI'],
    simulated: [
      '每個通道皆為真實電路：BSS138 N 通道 MOSFET（閘極 = LV、源極 = LVn、汲極 = HVn；Vth 1.3 V、k 0.25 A/V²、本體二極體）+ 接到 LV 與 HV 的 10 kΩ 上拉',
      '雙向開汲極轉換：任一側拉低時另一側也被拉低（經通道或本體二極體），被釋放的一側上升到各自的電源電壓',
    ],
    limits: [
      '無閘極／汲極電容：邊緣速度只受上拉電阻與類比步階限制（實際模組最高約數百 kHz）',
      '推挽驅動也能使用，但會與上拉電阻互相抗衡，與實際模組相同',
    ],
  },
}
