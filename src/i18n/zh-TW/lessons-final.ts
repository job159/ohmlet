/**
 * zh-TW dictionary — lessons, final round: the one-click 「重置 MCU」 /
 * 「重置模擬」 step actions (the button words themselves are the inspector's
 * and the More sheet's keys, 'Reset MCU' / 'Reset simulation'), and the
 * runtime stimulus a measuring check performs while it runs
 * (src/lessons/engine/format.ts stimulusText, src/lessons/engine/evaluate.ts,
 * src/ui/lessons/*). Terms: 勾選 a checkbox param (a button's 'pressed' reads
 * 「按住 SW1」 / 「放開 SW1」 instead — keys in latch.ts), times in 秒 after
 * power-on (上電).
 */
const zh: Record<string, string> = {
  // ---- reset step actions ----
  'Restart {id}’s firmware from reset — the rest of the circuit keeps its state': '讓 {id} 的韌體從重置重新開始——電路的其他部分保持原狀',
  'Power the whole circuit up again from 0 s (like More → Reset simulation)': '整個電路從 0 秒重新上電（同「更多」→「重置模擬」）',
  'Simulation reset — the whole circuit powered up again': '模擬已重置——整個電路重新上電',

  // ---- runtime stimulus of a check ----
  'The check does this itself: {list}': '檢查時會自動操作：{list}',
  '{t} s: tick {id} “{param}”': '{t} 秒時勾選 {id} 的「{param}」',
  '{t} s: untick {id} “{param}”': '{t} 秒時取消勾選 {id} 的「{param}」',
  '{t} s: set {id} “{param}” to {value}': '{t} 秒時把 {id} 的「{param}」設為 {value}',
  'At power-on: tick {id} “{param}”': '一上電就勾選 {id} 的「{param}」',
  'At power-on: untick {id} “{param}”': '一上電就取消勾選 {id} 的「{param}」',
  'At power-on: set {id} “{param}” to {value}': '一上電就把 {id} 的「{param}」設為 {value}',
  '; |stimulus-list': '，',
  '{id} has no setting “{param}” that can change while the simulation runs.': '{id} 沒有可以在模擬執行中調整的「{param}」設定。',
  '{port} of {id} sent nothing between {from} s and {s} s.': '{id} 的 {port} 在第 {from} 秒到第 {s} 秒之間沒有送出任何資料。',
}

export default zh
