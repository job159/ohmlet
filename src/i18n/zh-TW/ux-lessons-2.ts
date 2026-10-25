/**
 * zh-TW dictionary — UX fix round, WS3 lessons (docs/ux/UX_VERIFY.md
 * LS-8…LS-15): bound vs running firmware, the guide that ends when the
 * circuit is replaced, the one-click step actions (select the placed part,
 * set a value, start wiring, add analyzer channels), the route to 驗收, the
 * button hierarchy of the lesson page, the phone coach, expected readings,
 * named receipts and the student handout (src/ui/lessons/*, src/lessons/*).
 * Canonical terms (UX_VERIFY §5.4): 已載入 for a bound firmware, 執行中 only
 * for the run phase, 在電路板上標示／取消標示, 工作週期, 探棒.
 */
const zh: Record<string, string> = {
  // ---- bound vs running (LS-8) ----
  ' (it starts running when you press ▶ Run simulation)': '（按 ▶ 執行模擬後開始執行）',
  ' (the simulation is paused — press ▶ Run simulation to continue)': '（模擬已暫停——按 ▶ 執行模擬繼續）',

  // ---- the guide follows the board (LS-9) ----
  'Stopped guiding “{title}” — the board now holds another circuit': '已結束「{title}」的步驟引導——電路板上換成了別的電路',
  'Stopped guiding “{title}” — the board was cleared': '已結束「{title}」的步驟引導——電路板已清空',

  // ---- every step's next action is a button (LS-11) ----
  'Placed {id} — its properties are open': '已放置 {id}——屬性面板已打開',
  'Start wiring ({from} → {to})': '開始接線（{from} → {to}）',
  'Wiring ({from} → {to}) — press to stop': '接線中（{from} → {to}）· 再按一次結束',
  'Press again to stop wiring': '再按一次即可結束接線',
  'Add {pins} to the logic analyzer': '把 {pins} 加到邏輯分析儀',
  '{pins} are on the logic analyzer': '{pins} 已在邏輯分析儀上',
  'Added {pins} to the logic analyzer': '已把 {pins} 加到邏輯分析儀',
  'Added {pins} to the logic analyzer — open Instruments to see them': '已把 {pins} 加到邏輯分析儀——到「儀器」查看',
  '{pins} are already on the logic analyzer': '{pins} 已經在邏輯分析儀上了',
  'Could not add {pins} to the logic analyzer': '無法把 {pins} 加到邏輯分析儀',
  'Set {id} to {value}': '把 {id} 設為 {value}',
  'Select {id}': '選取 {id}',

  // ---- the finish line where the learner looks (LS-12) ----
  'Go to acceptance · Check my circuit': '前往驗收 · 檢查我的電路',
  'Lesson complete': '課程完成',
  '{passed} of {n} acceptance checks pass': '驗收 {passed} / {n} 項通過',
  'See why': '查看原因',

  // ---- the lesson page's button hierarchy, the phone coach (LS-14) ----
  'Reload starting circuit': '重新載入起始電路',
  'More lesson actions': '更多課程動作',
  'Show solution…': '顯示解答…',
  // the phone coach stands in for the status pill: findings the run will confirm (requests round, H5)
  '{n} to confirm after the run': '{n} 項執行後確認',

  // ---- classroom: expected readings, named receipts, the student handout (LS-15) ----
  'This lesson expects {range}': '本課預期 {range}',
  'Print handout (with the solution)': '列印講義（教師版：含解答）',
  'Print handout (student copy: no solution)': '列印講義（學生版：不含解答）',
  'Student copy': '學生版',
  'Starting circuit': '起始電路',
  'Name / seat number for the receipt': '收據上的姓名／座號',
  'e.g. Wang Xiaoming 12': '例如：王小明 12',
  'Receipts are named {name}': '收據署名：{name}',
  Change: '更改',
}
export default zh
