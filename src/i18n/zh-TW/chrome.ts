/**
 * zh-TW strings for the app shell (src/App.tsx) and the classic chrome
 * (src/ui/chrome): dock, status capsule, placement hints, toasts, empty
 * state, onboarding, selection / undo pills.
 */
const zh: Record<string, string> = {
  // dock (bottom bar / desktop rail)
  Main: '主選單',
  Parts: '元件',
  Wire: '導線',
  AI: 'AI',
  Scope: '示波器',
  More: '更多',
  '{n} issues': '{n} 個問題',

  // long-press action sheet
  Properties: '屬性',
  Rotate: '旋轉',
  Duplicate: '複製',
  'Remove from Selection': '從選取中移除',
  'Add to Selection': '加入選取',
  'Wire {id}': '導線 {id}',

  // toasts
  "{id} can't rotate — no other rotation fits here": '{id} 無法旋轉——此處放不下其他方向',
  '{hole} is covered by {part} — move it or pick a clear hole': '{hole} 被 {part} 覆蓋——請移開它或改選空的孔位',
  '{hole} is covered by a component body — pick a clear hole': '{hole} 被元件本體覆蓋——請改選空的孔位',
  'Long-press a + paddle to remove a board': '長按「+」按鈕即可移除一塊麵包板',
  'Studio ray traces at reduced resolution on this device — expect battery drain':
    '攝影棚模式在此裝置上會以較低解析度進行光線追蹤——耗電量較高',
  '{part} duplicated': '已複製 {part}',
  '{id} removed': '已移除 {id}',
  'Wire removed': '已移除導線',
  'make me a circuit that displays a date': '幫我做一個顯示日期的電路',

  // status capsule
  Running: '執行中',
  Paused: '已暫停',
  'Run simulation': '執行模擬',
  'Pause simulation': '暫停模擬',
  'Simulation reset': '模擬已重置',
  'Long-press again to reset the simulation': '再長按一次即可重置模擬',
  'AI: {text}': 'AI：{text}',
  'AI circuit ready — open AI to apply': 'AI 電路已完成——開啟 AI 即可套用',
  'Studio: loading ray tracer…': '攝影棚：載入光線追蹤器…',
  'Studio: preparing scene…': '攝影棚：準備場景…',
  'Studio: rendering… {n}/{total} samples': '攝影棚：算繪中… {n}/{total} 次取樣',
  'Studio render complete · {n} samples': '攝影棚算繪完成 · {n} 次取樣',

  // empty state
  'Getting started': '開始使用',
  'Build your first circuit': '打造你的第一個電路',
  'Place parts on the breadboard, wire them up, then tap the clock to run the simulation — or let AI build something for you.':
    '把元件放到麵包板上、接好導線，再點上方的時鐘即可執行模擬——或讓 AI 幫你做一個。',
  'Browse parts': '瀏覽元件',
  'Ask AI': '問 AI',

  // onboarding
  'Welcome tour': '新手導覽',
  'Get started': '開始使用',
  'Look around': '看看四周',
  'Drag to orbit the board, pinch to zoom, two fingers to pan. Double-tap empty space to re-frame.':
    '拖曳可環繞檢視麵包板，雙指捏合可縮放，雙指拖移可平移。點兩下空白處即可重新取景。',
  'Place parts': '放置元件',
  'Open Parts in the dock, pick a component, then tap board holes to place it. Wire mode connects them.':
    '從工具列開啟「元件」並挑選一個元件，再點選麵包板的孔位即可放置。導線模式可將它們連接起來。',
  'Or just ask': '或直接問 AI',
  'Describe any circuit in the AI tab — it appears on the board, ready to run.':
    '在「AI」分頁描述任何電路——它會出現在麵包板上，隨時可以執行。',

  // rotate button / undo pill
  'Rotate part': '旋轉元件',
  'Undo and redo': '復原與重做',

  // multi-select pill
  'Selection actions': '選取操作',
  '{n} selected': '已選取 {n} 項',
  'Delete {n} selected parts': '刪除已選取的 {n} 個項目',
  'Clear the selection': '取消選取',
  'Delete {n} parts?': '要刪除 {n} 個項目嗎？',
  'Delete {n} parts': '刪除 {n} 個項目',
  'Removes every selected component and wire and disconnects them from the circuit.':
    '移除所有選取的元件與導線，並將它們從電路中斷開。',

  // placement / wire-mode hints (src/ui/chrome/hints.ts)
  'Wire from {from} — tap the second hole or terminal': '導線起點 {from}——點選第二個孔位或端子',
  'Wire mode — tap two holes or terminals to connect them': '導線模式——點選兩個孔位或端子即可連接',
  'Unknown component type "{type}"': '未知的元件類型「{type}」',
  '{part} added beside the board — wire its terminals': '{part} 已放在麵包板旁——請為它的端子接線',
  '{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel)':
    '{part}：點選 f 列中第 1 腳的孔位（DIP-{n} 跨越中央溝槽）',
  '{part}: tap the {pin} anchor hole (row {row})': '{part}：點選 {pin} 的定位孔位（{row} 列）',
  '{part}: tap a hole on the net you want to plot': '{part}：點選要量測之網路上的孔位',
  '{part}: tap a hole to place it': '{part}：點選孔位即可放置',
  '{part}: tap {n} holes — pin order {order}': '{part}：依序點選 {n} 個孔位——腳位順序 {order}',
  "Lead {i} of {n} — tap the hole for '{pin}'": '第 {i}/{n} 腳——點選「{pin}」的孔位',
}
export default zh
