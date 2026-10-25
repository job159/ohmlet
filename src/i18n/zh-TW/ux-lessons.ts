/**
 * zh-TW dictionary — UX wave, WS3 lessons (docs/ux/UX_REVIEW.md LS-1…LS-7):
 * the steps' one-click actions, the coach card (docked / floating, 為什麼？),
 * not-yet-attempted step checks, "root cause first" in check results, the
 * next-lesson pass state, the resumed guide, hole / terminal chips, lesson
 * codes, the printable handout and the acceptance receipt
 * (src/ui/lessons/*, src/lessons/engine/format.ts).
 * Taiwan usage (程式、檔案、韌體、執行、列印、孔位、電源軌).
 */
const zh: Record<string, string> = {
  // ---- step actions (LS-1) ----
  'Load {project} into {id}': '載入 {project} 到 {id}',
  'Load into {id}': '載入到 {id}',
  // 已載入 = bound; the run phase is appended separately (LS-8: 「✓ 已載入 · 執行中」)
  '{id} has {project} loaded': '{id} 已載入 {project}',
  'loaded|firmware pill': '已載入',
  'Switch back to {project}': '換回 {project}',
  'Reproduce this mistake: load {project}': '重現這個錯誤：載入 {project}',
  'Take a {part}': '拿一顆{part}',
  'Placing — click the holes on the board': '放置中——點麵包板上的孔位',
  'Press again to stop placing': '再按一次即可取消放置',
  'Loaded {file} into {id}': '已將 {file} 載入 {id}',
  'Couldn’t load {project}: {error}': '無法載入 {project}：{error}',
  '{id} is not on the board — load the starting circuit first': '電路中沒有 {id}——請先按「載入起始電路」',

  // ---- coach card, steps (LS-3, LS-4) ----
  'Step {n}/{m} · {title}': '步驟 {n}/{m} · {title}',
  'Why?': '為什麼？',
  'In the guide above': '在上方引導卡',
  'Showing it on the board.': '已在電路板上標示。',
  'Continuing “{title}”, step {n}': '繼續「{title}」步驟 {n}',
  'Not done yet': '尚未完成',
  'not done yet': '尚未完成',

  // ---- root cause first (LS-5) ----
  'Most likely cause': '最可能的原因',
  'Hide on the board': '取消標示',
  'Compare with a common mistake:': '對照常見錯誤：',
  'Fix:': '解法：',
  '{n} more fail because of this': '另外 {n} 項因此未通過',
  'The board does not hold this lesson’s starting circuit — load it first.': '麵包板上沒有本課的起始電路——請先按「載入起始電路」。',

  // ---- pass, next lesson (LS-4) ----
  'Next lesson: {title} →': '下一課：{title} →',
  'Jump to {level}: {title}': '跳到{level}：{title}',
  'This pass used the loaded solution. Load the starting circuit and build it yourself to earn the lesson.':
    '這次通過用的是載入的解答。載入起始電路、自己接一次，才算真正完成本課。',

  // ---- completion state, header (LS-7) ----
  'Completed with the solution': '以解答完成',
  'Completed after loading the solution — load the starting circuit and build it yourself to earn it.':
    '這次是載入解答後完成的——載入起始電路、自己接一次，才會記錄為「已完成」。',
  'Last check {p}/{n}': '上次檢查 {p}/{n}',
  'The last acceptance check on this device': '這台裝置上最近一次的驗收結果',

  // ---- hole / terminal chips (LS-7) ----
  '{rail}, hole {n}': '{rail}第 {n} 孔',
  'row {row}, column {col}': '{row} 列第 {col} 欄',
  '{gloss} — show on the board': '{gloss}——點一下在電路板上標示',

  // ---- print handout, receipt (LS-7) ----
  'Print handout': '列印講義',
  'A printable handout: steps, wiring, mistakes and an acceptance checklist': '可列印的講義：步驟、接線、常見錯誤與驗收清單',
  'Export results': '匯出驗收結果',
  'Download the results (JSON) and open a printable receipt': '下載驗收結果（JSON），並開啟可列印的收據',
  'ohmlet STM32 electronics lab': 'ohmlet STM32 電子實驗室',
  'Student name|handout': '姓名',
  'Date|handout': '日期',
  'Reference circuit': '參考電路（解答）',
  'Part|handout': '元件',
  'Part name|handout': '名稱',
  'Holes|handout': '孔位',
  'Color|handout': '顏色',
  'off the board': '板外',
  'Symptom|handout': '現象',
  'Acceptance checklist': '驗收清單',
  'Done|handout': '完成',
  'Condition|handout': '條件',
  'Expected|handout': '預期',
  'Measured|handout': '實測',
  'Result|handout': '結果',
  'Acceptance receipt': '驗收收據',
  'Checked {time}': '檢查時間：{time}',
  '{passed} of {n} conditions pass': '{passed} / {n} 項條件通過',
  'Circuit SHA-256': '電路 SHA-256',
}
export default zh
