/**
 * zh-TW strings of the shell's release-QA fixes (SH-F1 … SH-F11): the wire
 * start that moves to a free hole or is refused at once, the refused hole of
 * a leads part, the undo / redo / delete confirmations, the 「電路已就緒」
 * line next to the 「執行模擬」 button, the 範例 row of the 更多 sheet and the
 * speed options. Keys are the English sources passed to t() ("source|context").
 * Taiwan usage: 孔位、導線、拉線、復原、重做、倍速。
 */
const zh: Record<string, string> = {
  // ---- SH-F1 a wire start that can never be completed is never stored ----
  '{hole} is taken by {pin} — wiring from {free} in the same row instead': '{hole} 被 {pin} 佔用，已改從同一排的 {free} 拉線',
  '{hole} is taken by {pin} — wiring from {free} on the same rail instead': '{hole} 被 {pin} 佔用，已改從同一條電源軌的 {free} 拉線',
  'Can’t wire here: {reason} — tap a free hole in the same row': '這裡不能接：{reason}——請點同一排的空孔',
  'Can’t wire here: {reason} — tap a free hole on the same rail': '這裡不能接：{reason}——請點同一條電源軌上的空孔',
  'Can’t wire here: {reason} — this row has no free hole left': '這裡不能接：{reason}——這一排已經沒有空孔',
  'Can’t wire here: {reason} — this rail has no free hole left': '這裡不能接：{reason}——這條電源軌已經沒有空孔',

  // ---- SH-F6 a leads / probe part's refused hole says why ----
  'Can’t place here: {reason}': '這裡不能放：{reason}',
  '{hole} is already picked': '{hole} 已經選過了',
  'the body of {part} would cover {hole}, which is already in use': '{part} 的本體會蓋住已經在用的 {hole}',

  // ---- SH-F9 undo / redo / delete name what changed ----
  'Undone: {what}': '已復原：{what}',
  'Redone: {what}': '已重做：{what}',
  'Undone|history': '已復原',
  'Redone|history': '已重做',
  'Place {names}|history': '放上 {names}',
  'Connect {names}|history': '接上 {names}',
  'Delete {names}|history': '刪除 {names}',
  'Move {names}|history': '移動 {names}',
  'Rotate {names}|history': '旋轉 {names}',
  'Adjust {names}|history': '調整 {names}',
  'Rewire {names}|history': '改接 {names}',
  'Recolor {names}|history': '更改 {names} 的顏色',
  'Clear the board|history': '清空麵包板',
  'Load a circuit|history': '載入電路',
  'Change the breadboard|history': '變更麵包板',
  '{names} ({n} in all)|history': '{names} 等 {n} 項',
  '{names} deleted — {keys} undoes it': '已刪除 {names}——{keys} 可復原',
  '{names} deleted — tap ↶ to undo': '已刪除 {names}——點 ↶ 可復原',

  // ---- SH-F10 one verb: the pill's button says 「執行模擬」, the line says why ----
  'Circuit ready (Space)': '電路已就緒（空白鍵）',
  'Circuit ready': '電路已就緒',
  'Circuit ready (Space) · {n} to confirm after the run': '電路已就緒（空白鍵）· {n} 項執行後確認',
  'Circuit ready · {n} to confirm after the run': '電路已就緒 · {n} 項執行後確認',
  'Simulation speed (× real time)': '模擬速度（倍速）',
  '{x}×|speed option': '{x} 倍',

  // ---- SH-F7 / SH-F10 the 更多 sheet ----
  'Ready-made circuits to open and run': '開啟現成的電路並執行',
}
export default zh
