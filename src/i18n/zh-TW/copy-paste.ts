/**
 * zh-TW strings of copy / paste (round 5, owner: copypaste —
 * src/ui/chrome/copy-paste.ts, the 「鍵盤快速鍵」 rows, the selection pill's
 * 複製): Ctrl+C／V／X／D copy placed parts WITH their settings, and a Blue
 * Pill's copy runs the same firmware. Keys are the English sources passed
 * to t() ("source|context"). Taiwan usage: 複製、剪下、貼上、復原、韌體、
 * 麵包板、參數。
 */
const zh: Record<string, string> = {
  // ---- the toasts (copy-paste.ts) ----
  '{names} copied — {keys} pastes|copy-paste': '已複製 {names}——按 {keys} 貼上',
  '{names} cut — {keys} pastes|copy-paste': '已剪下 {names}——按 {keys} 貼上',
  '{names} copied ({wires} not copied) — {keys} pastes|copy-paste': '已複製 {names}（{wires} 沒有一起複製）——按 {keys} 貼上',
  '{names} cut ({wires} will not be pasted) — {keys} pastes|copy-paste': '已剪下 {names}（{wires} 不會一起貼上）——按 {keys} 貼上',
  '{text} ({wires} not copied)|copy-paste': '{text}（{wires} 沒有一起複製）',
  '{text} — it did not fit where the mouse points|copy-paste': '{text}——滑鼠指的地方放不下',
  'Nothing to copy — wires come along with the parts they join|copy-paste': '沒有可複製的元件——導線會跟著它接的元件一起複製',
  'Nothing copied yet — select parts, then press {keys}|copy-paste': '還沒有複製元件——先選取元件，再按 {keys}',
  '{names} pasted|copy-paste': '已貼上 {names}',
  'Duplicated: {names}|copy-paste': '已複製一份：{names}',
  '{text} (with the firmware {file})|copy-paste': '{text}（連同韌體 {file}）',
  // the wires a paste / duplicate brought along with the parts (persona fix)
  'with wire {ids}|copy-paste': '連同導線 {ids}',
  'with {n} wires|copy-paste': '連同 {n} 條導線',
  '{text} ({brought})|copy-paste': '{text}（{brought}）',
  '{text} ({brought}; {wires} not copied)|copy-paste': '{text}（{brought}；{wires} 沒有一起複製）',
  '{text} (with their firmware)|copy-paste': '{text}（連同韌體）',
  '{text} (the firmware did not come along)|copy-paste': '{text}（韌體沒有一起複製）',
  'No free spot on the breadboard for a copy of {names}|copy-paste': '麵包板上沒有空位放 {names} 的複本',
  'Add a breadboard|copy-paste': '加一塊麵包板',
  'The breadboard cannot grow any further — clear a few columns first|copy-paste': '麵包板已經不能再加了——先清出幾排空孔',

  // ---- the selection pill (SelectionPill.tsx) ----
  'Duplicate the {n} selected items|copy-paste': '複製這 {n} 項',

  // ---- 「鍵盤快速鍵」 (ShortcutsSheet.tsx) ----
  'Copy the selection with its settings': '複製選取的元件（連同參數）',
  'Cut the selection': '剪下選取的元件',
  'Paste at the pointer or beside the original': '貼上（滑鼠所指處或原件旁）',
  'Duplicate the selection beside it': '在旁邊複製一份',
  'Space, F5, F10 and Shift+F5 work wherever the focus is (Space not while you type in a field); copy and paste work anywhere but a text field; the other editing keys work on the 3D view.':
    '空白鍵、F5、F10、Shift+F5 在任何地方都能用（在輸入框打字時空白鍵除外）；複製、貼上在輸入框以外都能用；其他編輯用的按鍵要在 3D 畫面上使用。',
}

export default zh
