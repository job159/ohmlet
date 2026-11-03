/**
 * zh-TW strings of the effortless recovery of destroyed parts (round 5 —
 * damage, owner: damage): the 〔換新〕 button (the inspector's damage banner,
 * a burned / vented Problems row, the part's long-press sheet —
 * src/ui/embedded/replace-part.ts) and the toast of the automatic 換新 after
 * a value change (src/ui/embedded/auto-heal.ts). The banners' own sentences
 * live with the banners (truth.ts). Keys are the English sources passed to
 * t(); full-width punctuation.
 */
const zh: Record<string, string> = {
  // the button (a ChipButton / an action-sheet row): a new part in place of the destroyed one
  'Replace|damaged': '換新',
  'Replace {id} with a new one': '把 {id} 換成新的',
  'Replaced {id} with a new one': '已換上新的 {id}',
  // the new part burned again at once — the fault is still there (persona fix, replace-part.ts sayReburned)
  'The new {id} burned out again: {fix}|damage': '新的 {id} 又燒掉了：{fix}',
  'The new {id} burned out again: the fault that burned it is still in the circuit|damage': '新的 {id} 又燒掉了：讓它燒掉的問題還在電路裡',
  'The new {ids} burned out again: the fault that burned them is still in the circuit|damage': '新的 {ids} 又燒掉了：讓它們燒掉的問題還在電路裡',
  // a click on a row / banner a moment stale: the readings show the part whole
  '{id} is not damaged — nothing to replace': '{id} 沒有損壞，不用換新',
  // paused: the new part gets no power until the simulation runs (the toast's action: 〔繼續執行〕)
  '{text} — the simulation is paused|damage': '{text}——模擬已暫停',
  // a value change brought new parts in (auto-heal.ts): 「已自動換上新的 LED1、R2」
  'Replaced with new parts automatically: {ids}': '已自動換上新的 {ids}',
  ', |damage-list': '、',
  // several parts in one click (the selection pill, 〔全部換新〕 in the Problems list header): one toast
  'Replaced {ids} with new ones|damage': '已換上新的 {ids}',
  'Replace {ids} with new ones|damage': '把 {ids} 換成新的',
  'Replace all|damaged': '全部換新',
  'Replace every destroyed part ({ids}) with a new one|damage': '把損壞的 {ids} 全部換成新的',
  // a stale 〔全部換新〕 / pill: the readings show every part whole
  'Nothing is damaged — nothing to replace|damage': '沒有損壞的元件，不用換新',
}
export default zh
