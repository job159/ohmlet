/**
 * zh-TW strings of auto-run (owner: autosim — round 5 「改了就自動模擬，不用按
 * 執行」; src/ui/chrome/auto-run.ts): the status pill's line for a pause the
 * learner made (StatusPill.tsx), the empty board's way in (EmptyState.tsx)
 * and the 顯示電流 toasts that no longer send anyone to a Run button
 * (FlowToggle.tsx). Keys are the English sources passed to t()
 * ("source|context" — new keys only: a redefined key would lose to a
 * later-sorted dictionary). Taiwan usage; full-width punctuation; the run
 * control is 「執行模擬」, a resume is 「繼續執行」.
 */
const zh: Record<string, string> = {
  // the status pill while the learner's own pause holds (〔繼續執行〕 resumes; an edit of parts or
  // wires does too — turning a knob or pressing a button is using the circuit and keeps the pause)
  'Simulation paused — editing parts or wires resumes it|autosim': '模擬已暫停——改動接線或元件就會自動繼續',
  // the empty board's path card: nothing to press after opening something (\n: one sentence per
  // line, so the card never splits a word like 電｜路 — .app-empty-body keeps it with pre-line)
  'Follow a lesson step by step, or open a ready-made example — it starts simulating by itself.|autosim':
    '跟著課程一步一步做，或開啟現成的範例。\n電路會自動開始模擬。',
  // 顯示電流 turned on while nothing runs: paused by the learner / no circuit simulating yet
  'Current flow on — resume the simulation to see it|autosim': '已開啟電流顯示——模擬繼續後就會看到電流流動',
  'Current flow on — the dots show while the simulation runs|autosim': '已開啟電流顯示——模擬執行時就會看到電流流動',
}

export default zh
