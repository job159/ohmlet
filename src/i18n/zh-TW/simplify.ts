/**
 * zh-TW strings of the operation simplification (owner: simplify): wires
 * coloured by their net's role (contract C1 — src/ui/wire-roles.ts: 紅＝電源正、
 * 黑＝地、其他顏色＝訊號; the wire strip's legend, the wire inspector's
 * 「紅色：電源正極（5 V 網路）」), deletes and loads that act at once with a
 * 〔復原〕 toast, 「載入完整答案」 in the lesson header and coach card, and
 * the inspector's one-tap common values. Keys are the English sources
 * passed to t() ("source|context"). Taiwan usage: 導線、電源軌、接地、韌體、復原。
 */
const zh: Record<string, string> = {
  // ---- C1 the wire's role, in words ----
  '{color}: {meaning}|wire-role': '{color}：{meaning}',
  'supply positive ({v} net)|wire-role': '電源正極（{v} 網路）',
  'supply positive (+ rail)|wire-role': '電源正極（+ 電源軌）',
  'supply positive ({by})|wire-role': '電源正極（{by}）',
  'supply positive|wire-role': '電源正極',
  'ground (− rail)|wire-role': '接地（− 電源軌）',
  'ground ({by})|wire-role': '接地（{by}）',
  'ground|wire-role': '接地',
  'I²C data line SDA ({by})|wire-role': 'I²C 資料線 SDA（{by}）',
  'I²C clock line SCL ({by})|wire-role': 'I²C 時脈線 SCL（{by}）',
  'UART line the MCU sends on ({by} → {peer})|wire-role': 'UART 傳送線（{by} → {peer}）',
  'UART line the MCU sends on|wire-role': 'UART 傳送線（MCU 送出）',
  'UART line the MCU receives on ({peer} → {by})|wire-role': 'UART 接收線（{peer} → {by}）',
  'UART line the MCU receives on|wire-role': 'UART 接收線（MCU 接收）',
  'PWM control signal ({by})|wire-role': 'PWM 控制訊號（{by}）',
  'signal ({by})|wire-role': '訊號（{by}）',
  // F16: a line the MCU pin's own function names, and one line across a level shifter
  'UART line the MCU sends on ({by})|wire-role': 'UART 傳送線（{by}）',
  'UART line the MCU receives on ({by})|wire-role': 'UART 接收線（{by}）',
  'UART line the MCU sends on ({by} → {peer}, via {via})|wire-role': 'UART 傳送線（{by} → {peer}，經 {via} 準位轉換）',
  'UART line the MCU receives on ({peer} → {by}, via {via})|wire-role': 'UART 接收線（{peer} → {by}，經 {via} 準位轉換）',
  'I²C data line SDA ({by}, via {via})|wire-role': 'I²C 資料線 SDA（{by}，經 {via} 準位轉換）',
  'I²C clock line SCL ({by}, via {via})|wire-role': 'I²C 時脈線 SCL（{by}，經 {via} 準位轉換）',
  'PWM control signal ({by}, via {via})|wire-role': 'PWM 控制訊號（{by}，經 {via} 準位轉換）',
  'signal ({by}, via {via})|wire-role': '訊號（{by}，經 {via} 準位轉換）',
  'signal|wire-role': '訊號',
  'meter test lead ({by})|wire-role': '電表表筆（{by}）',
  'Red = supply +   Black = ground   Other colours = signals|wire-legend': '紅＝電源正　黑＝地　其他顏色＝訊號',

  // ---- the wire strip: a legend instead of swatches ----
  'Red = supply +|wire-legend': '紅＝電源正',
  'Black = ground|wire-legend': '黑＝地',
  'Other colours = signals|wire-legend': '其他顏色＝訊號',
  // the phone row (F8): the dot shows the colour, the word says what it means
  'supply +|wire-legend-short': '電源正',
  'ground|wire-legend-short': '地',
  'signals|wire-legend-short': '訊號',
  'Wire colours follow the circuit': '導線顏色依電路自動決定',
  'Every wire takes the colour of what it carries — nothing to pick': '每條導線依它接的電路自動上色，不必挑顏色',

  // the signal palette's colour names (wire-colors.ts wireColorLabel)
  'teal|wire color': '青綠色',
  'cyan|wire color': '青綠色',
  'pink|wire color': '粉紅色',
  'violet|wire color': '紫色',

  // ---- deletes / loads act at once, the toast carries 〔復原〕 ----
  'The board changed since — step back with ↶': '之後又有新的變更——請用 ↶ 一步步復原',
  'The board is already empty': '麵包板已經是空的',

  // ---- the inspector's one-tap common values and header delete ----
  'Common values': '常用值',
  'Delete {name}|header': '刪除 {name}',
  'Delete {name} — undo brings it back|header': '刪除 {name}（可復原）',

  // ---- 「載入完整答案」 ----
  'Load the full answer': '載入完整答案',
  'Stuck? Load the full answer': '卡住了？載入完整答案',
  'Show the solution: loads the lesson’s finished circuit and firmware — ↶ undoes it': '顯示解答：載入本課完成的電路與韌體——按 ↶ 可復原',
  'Loaded the full answer of “{title}”': '已載入「{title}」的完整答案',

  // ---- F7: board-replacing loads act at once; only overwritten firmware asks, by name ----
  'Replace the circuit and the firmware of {boards}?': '要取代電路和 {boards} 的韌體嗎？',
  '“{title}” replaces the circuit (↶ brings it back) and the loaded firmware: {list} (the firmware cannot be undone).':
    '「{title}」會取代目前的電路（按 ↶ 可復原），也會取代已載入的韌體：{list}（韌體無法復原）。',
  '{file} on {id}|firmware at risk': '{id} 的 {file}',
  'Opening an example replaces the current circuit — ↶ brings it back.': '開啟範例會取代目前的電路（按 ↶ 可復原）。',
  'The firmware loaded on {boards} cannot be undone — opening asks first.': '{boards} 已載入的韌體無法復原，開啟前會先詢問。',
  'Every example runs on the real simulation; the firmware examples carry the exact ELF built from their CubeIDE-style projects.':
    '每個範例都在真實的模擬中執行；韌體範例內含由對應的 CubeIDE 風格專案建置出來的 ELF 檔。',
  'Show the solution: loads the lesson’s finished circuit — ↶ undoes it': '顯示解答：載入本課完成的電路——按 ↶ 可復原',
}
export default zh
