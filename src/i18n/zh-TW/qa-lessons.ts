/**
 * zh-TW dictionary — release QA, lessons (LS-F1…LS-F10): the wire tool the
 * coach armed leaving by itself, the analyzer step that jumps to the burst
 * it talks about, a measuring step that checks itself while the simulation
 * runs, the one-click end of a jumper experiment (「拆掉 j11 → bot-7 這條線」),
 * a passed step's sub-checks folded to one line, and a meter lead that is
 * not wired yet (src/ui/lessons/*, src/lessons/engine/evaluate.ts).
 * Terms (UX_VERIFY §5.4): 執行中 only as 「模擬執行中」 (the run phase), 導線工具,
 * 邏輯分析儀, 起始電路.
 */
const zh: Record<string, string> = {
  // ---- the coach's wire tool leaves once the step's wires are in (LS-F2) ----
  'All the wires are in — left the wire tool': '導線都接好了，已離開導線工具',

  // ---- the analyzer step shows the burst it talks about (LS-F4) ----
  'signal burst': '訊號',
  'Show the latest {what} on the logic analyzer': '在邏輯分析儀中檢視最近一筆 {what}',
  'Added {pins} to the logic analyzer and jumped to the latest {what} ({span} window)':
    '已把 {pins} 加到邏輯分析儀，並跳到最近一筆 {what}（視窗 {span}）',
  'Jumped to the latest {what} on the logic analyzer ({span} window)': '已在邏輯分析儀上跳到最近一筆 {what}（視窗 {span}）',
  'Added {pins} to the logic analyzer — press ▶ Run simulation, then press this button again to jump to the latest {what}':
    '已把 {pins} 加到邏輯分析儀——按 ▶ 執行模擬後，再按一次這個按鈕跳到最近一筆 {what}',
  '{pins} are on the logic analyzer — press ▶ Run simulation, then press this button again to jump to the latest {what}':
    '{pins} 已在邏輯分析儀上——按 ▶ 執行模擬後，再按一次這個按鈕跳到最近一筆 {what}',
  'Added {pins} to the logic analyzer — no complete {what} yet: let the simulation run a little longer, then press this button again':
    '已把 {pins} 加到邏輯分析儀——還沒有完整的 {what}：讓模擬再跑一會兒，再按一次這個按鈕',
  'No complete {what} on the logic analyzer yet — let the simulation run a little longer, then press this button again':
    '邏輯分析儀上還沒有完整的 {what}——讓模擬再跑一會兒，再按一次這個按鈕',

  // ---- a measuring step checks itself while the simulation runs (LS-F6) ----
  'Simulation running — checks itself in about {n} s…': '模擬執行中，約 {n} 秒後自動檢查…',

  // ---- the end of a jumper experiment (LS-F7) ----
  'Remove the wire {from} → {to}': '拆掉 {from} → {to} 這條線',
  'Removed the wire {from} → {to}': '已拆掉 {from} → {to} 這條線',
  'Removed {n} wires': '已拆掉 {n} 條線',

  // ---- a passed step's sub-checks, folded (LS-F3) ----
  '{passed} / {n} conditions hold': '{passed} / {n} 項條件成立',

  // ---- a meter lead with no connection (LS-F9) ----
  '{terminal} is not wired yet — no voltage to measure': '{terminal}還沒接線，量不到電壓',
}

export default zh
