/**
 * zh-TW strings of the instruments workstream's fix wave (docs/ux/UX_VERIFY.md
 * §7.2 WS5, IS-10 … IS-20): honest timing readouts (baud line, burst clock,
 * 非週期訊號), channels that lead back to the circuit, empty states with their
 * real reason, the analysis flow, the analog-threshold hint, the 量測 tab.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage (§5.4): 工作週期、探棒、在電路板上標示、訊號、設定、執行、鮑率。
 */
const zh: Record<string, string> = {
  // ---- IS-11: timing readouts (logic analyzer footer / column, scope readout) ----
  'baud|meas': '鮑率',
  'clock|meas': '時脈',
  '{line} (set by {usart})': '{line}（由 {usart} 設定）',
  '{line} (UART decoder setting)': '{line}（UART 解碼器設定）',
  '{line} (measured by the UART decoder)': '{line}（UART 解碼器實測）',
  'A serial line has no frequency — this is its baud rate.': '序列線路沒有頻率可言，這裡顯示的是它的鮑率。',
  'Some periods had no pulse (0 % or 100 % duty) — the frequency is that of the periods that had one.':
    '有些週期沒有脈波（工作週期 0 % 或 100 %），頻率以有脈波的週期計算。',
  '{f} (burst)': '{f}（突發）',
  'A clock in bursts: the median period inside the bursts. The gaps between them are not periods.':
    '突發的時脈：取突發內週期的中位數；突發之間的空檔不算週期。',
  '— (not periodic: serial data)': '—（非週期訊號：序列資料）',
  '— (not periodic)': '—（非週期訊號）',
  'The edges do not repeat, so there is no frequency or duty to measure.': '邊緣沒有規律重複，所以沒有頻率或工作週期可量。',
  'From the exact edges the logic analyzer recorded on this net in the last {span}':
    '取自邏輯分析儀在這個網路上最近 {span} 記錄的精確邊緣',
  'duty (last {span})': '工作週期（最近 {span}）',
  'No change in the window': '視窗內訊號沒有變化',
  'Not enough samples in this window': '這個視窗內的取樣不足',
  'Waiting for the exact edges of this net': '正在等待這個網路的精確邊緣',
  'Estimated from the sampled waveform (mean crossings)': '由取樣波形估算（穿越平均值的時刻）',

  // ---- IS-17 / IS-20: one time format (H3) ----
  'Start bit time; line end {time}': '起始位元時間；行尾 {time}',

  // ---- IS-15: the analysis flow is not interrupted ----
  'Stopped following — press “Auto” or “Live” to resume': '已停止跟隨——按「自動」或「即時」恢復',
  'on an edge': '已對齊邊緣',
  '(not on an edge)': '（未對齊邊緣）',
  'Alt + click places a marker exactly where you click; a plain click snaps it to the nearest edge':
    'Alt＋點一下：標記放在點的位置；直接點一下：對齊最近的邊緣',
  'Less than one full period between A and B — the readings are for the whole window':
    'A–B 之間不到一個完整週期——下方仍是整個視窗的量測',

  // ---- IS-13: channels lead back to the circuit ----
  'net|channel': '網路',
  '{label} is already on the logic analyzer': '{label} 已在邏輯分析儀上',
  'This net is already measured by {id} (CH{n})': '這個網路已由 {id} 量測（CH{n}）',
  '{name}: show it on the board': '{name}：在電路板上標示',
  'Channel {name}': '通道 {name}',
  'Channel': '通道',
  'Channel name': '通道名稱',
  'Rename': '重新命名',
  'Rename…': '重新命名…',
  'Show on the board': '在電路板上標示',
  'See this pin in the inspector': '在屬性面板查看這支腳',
  'Remove channel': '移除通道',
  'Analog net turned into logic levels at the 0.8 / 2.0 V thresholds': '類比網路以 0.8／2.0 V 門檻轉成邏輯準位',
  '{name} net': '{name} 網路',
  'CH{n}: probe {id} at {hole} — click to show it on the board; right-click for more':
    'CH{n}：探棒 {id}，在 {hole}——點一下在電路板上標示；按右鍵看更多',
  'Show {id} ({hole}) on the board': '在電路板上標示 {id}（{hole}）',
  'Remove probe {id}': '移除探棒 {id}',

  // ---- IS-16: an analog net the thresholds hide ----
  'Signal {range}, never reaches the {vih} high threshold': '訊號 {range}，未達高電位門檻 {vih}',
  'Signal {range}, never falls below the {vil} low threshold': '訊號 {range}，沒有低於低電位門檻 {vil}',
  'Use the scope': '改用示波器',
  'Place a scope probe on this net to see its real voltage': '在這個網路放示波器探棒，看它真正的電壓',

  // ---- IS-14: decoder texts in the UI language ----
  'SCK idle ≠ CPOL {cpol}': 'SCK 閒置準位 ≠ CPOL {cpol}',
  'undefined level|decode': '準位不明',
  'incomplete word ({n} bits)': '不完整字組（{n} 位元）',
  'boot noise': '開機雜訊',
  'SCK idle level does not match CPOL {cpol} (the MCU’s pins may be floating during a reset)':
    'SCK 閒置準位與 CPOL {cpol} 不符（可能是 MCU 重置中的高阻抗）',
  'Before the first valid transfer: the pins settling while the MCU boots': '第一筆有效傳輸之前：MCU 開機時腳位尚未穩定',

  // ---- IS-14: empty and blocked states give the real reason ----
  '{id} has no power, so these channels have no signal': '{id} 沒有供電，所以這些通道沒有訊號',
  '{id} has no power, so this port sends nothing': '{id} 沒有供電，所以這個序列埠不會有資料',
  '{id} has no power, so the probed net has no signal': '{id} 沒有供電，所以探棒量不到訊號',
  '{id} has no firmware yet': '{id} 還沒有韌體',
  '{id} core halted (debugger)': '{id} 核心已停住（偵錯器）',
  'Long-press the hole or pin to measure, then choose “Place a scope probe”': '長按要量測的孔位或腳位，選「放示波器探棒」',
  'No scope probe in the circuit — right-click a pin → “Place a scope probe”': '電路中沒有示波器探棒——在腳位上按右鍵 →「放示波器探棒」',
  'Press “▶ Run simulation” (Space)': '按「▶ 執行模擬」（空白鍵）',
  'This timebase is faster than the simulation’s sample interval (about {dt}) — press “Auto setup”':
    '這個時基比模擬的取樣間隔（約 {dt}）還快——按「自動設定」',
  'This timebase is faster than the simulation’s sample interval — press “Auto setup”': '這個時基比模擬的取樣間隔還快——按「自動設定」',

  // ---- IS-19: the 量測 tab ----
  'Readings|tray': '量測',
  'Readings': '讀數',
  'No readings yet': '還沒有讀數',
  'Place a multimeter or a bench supply (Library → Instruments): their readings stay here, without selecting them.':
    '放一台萬用電表或電源供應器（元件庫 → 儀器）：讀數會一直顯示在這裡，不必先選取。',
  'Show {id} on the board': '在電路板上標示 {id}',
  'Nets on the logic analyzer': '邏輯分析儀上的網路',

  // ---- IS-20: narrow toolbars ----
  'More terminal options': '更多終端機選項',
  'More analyzer options': '更多分析儀選項',
  'Activity of the whole recording — click to zoom there': '整段記錄的訊號活動——點一下放大到那裡',

  // ---- requests round: toast actions (a phone's 儀器 sheet one tap away; a deliberate second probe) ----
  'View in Instruments': '在儀器中查看',
  'Place another probe anyway': '仍要再放一支',
}

export default zh
