/**
 * zh-TW strings of the UX-wave "scene" workstream (docs/ux/UX_REVIEW.md §6,
 * SC-1…SC-8): the live hover chip (src/ui/workspace/hole-chip.ts), the
 * library / example cards (src/ui/workspace/LibraryPanel.tsx, the phone
 * Parts sheet) and the workspace's scene affordances.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage: 程式、韌體、電源軌、孔位、麵包板、元件庫、範例、課程。
 */
const zh: Record<string, string> = {
  // ---- hover chip: live values (holeChipText, SC-4) ----
  'hold to press': '按住即可按下',
  // GPIO modes — the same words as the inspector's mode tooltips ('pin-mode-long')
  'floating input': '浮接輸入',
  'pull-up input': '上拉輸入',
  'pull-down input': '下拉輸入',
  'analog input': '類比輸入',
  'push-pull output': '推挽輸出',
  'open-drain output': '開汲極輸出',
  'alternate-function push-pull': '複用功能推挽輸出',
  'alternate-function open-drain': '複用功能開汲極輸出',

  // ---- grow paddles (growPaddleText, SC-8) ----
  'Add a breadboard here': '加接一塊麵包板',
  'Remove the breadboard on this side': '移除這一側的麵包板',

  // ---- library cards (LibraryPanel.tsx, SC-7) ----
  'Click the card again to stop placing': '再點一次卡片即可結束放置',
  'Click a breadboard hole to place it · Esc to stop': '點麵包板孔位放置 · Esc 結束',
  // phone Parts sheet, under the title while a part is armed
  'Placing {part} · tap its card again to stop': '放置中：{part} · 再點一次卡片即可結束',
  'Open|example': '開啟',
  'Related lesson': '相關課程',
  'Open this lesson in the Lessons tab': '在「課程」分頁開啟這堂課',
  '{title} ({level} {n})': '{title}（{level} {n}）',

  // ---- room for the circuit (examples.ts, SC-8) ----
  'Collapsed the library to give the circuit more room (the handle on the left opens it)':
    '已收合元件庫，讓電路有更多空間（左側把手可展開）',
}
export default zh
