/**
 * zh-TW strings of the UX-wave shell (WS1 — docs/ux/UX_REVIEW.md §6.3):
 * the run capsule, the status pill, onboarding + the empty state, mode
 * hints, the wire strip / undo pill additions, the More sheet rows, the
 * keyboard shortcuts and their toasts. Keys are the English sources passed
 * to t() / tc() ("source|context"). The classic chrome's own strings stay
 * in chrome.ts.
 * Taiwan usage: 執行、模擬、韌體、孔位、電源軌、程式、檢視。
 */
const zh: Record<string, string> = {
  // ---- run capsule (StatusBar, SH-1 / SH-8) ----
  'Run simulation (Space) · long-press to reset': '執行模擬（空白鍵）· 長按重置',
  'Pause simulation (Space) · long-press to reset': '暫停模擬（空白鍵）· 長按重置',
  '{x}× speed': '{x} 倍速',
  'The simulation cannot keep up with the {n}× speed setting': '模擬跟不上設定的 {n} 倍速',
  'The simulation runs slower than real time': '模擬比實際時間慢',
  'Core halted': '核心已停住',
  'Resume|capsule': '繼續執行', // one verb with the pill / problems 「繼續執行」 (release QA SH-F3)
  'Resume the {id} core': '繼續執行 {id} 核心',
  'Resume the {id} core (Space / F5)': '繼續執行 {id} 核心（空白鍵／F5）',
  '{id} fault': '{id} 故障',
  '{id} locked up — see the status bar below for why': '{id} 鎖死——原因見狀態提示列',

  // ---- status pill (StatusPill, SH-2) ----
  'Circuit ready — press ▶ Run simulation (Space)': '電路已就緒——按 ▶ 執行模擬（空白鍵）',
  'Circuit ready — tap ▶ Run simulation': '電路已就緒——點 ▶ 執行模擬',
  'Run|pill': '執行',
  '· {n} more': '· 另 {n} 個',
  'See all problems': '查看所有問題',

  // ---- onboarding (SH-3) ----
  'This is an STM32 electronics lab': '這是 STM32 電子實驗室',
  'Wire circuits on a 3D breadboard, flash real STM32 firmware, then watch the signals with a logic analyzer, an oscilloscope and a multimeter.':
    '在 3D 麵包板上接電路、燒入真正的 STM32 韌體，再用邏輯分析儀、示波器和萬用電表觀察訊號。',
  'Drag with one finger to orbit, pinch to zoom, drag with two fingers to pan. Double-tap empty space to re-frame.':
    '單指拖曳旋轉、雙指捏合縮放、雙指拖移平移；點兩下空白處可重新取景。',
  'Left-drag to orbit, scroll to zoom, right-drag to pan. Double-click empty space to re-frame.':
    '左鍵拖曳旋轉、滾輪縮放、右鍵拖曳平移；在空白處點兩下可重新取景。',
  'Start with lesson 1': '從第一課開始',
  '{n} guided lessons, from an LED and its resistor to STM32 GPIO, interrupts and I²C. Every step is checked against the live simulation.':
    '{n} 堂引導式課程，從 LED 與限流電阻一路到 STM32 GPIO、中斷與 I²C；每一步都用真實模擬自動檢查。',
  'Start lesson 1': '開始第一課',
  'See an example first: Blue Pill blinking LED': '先看範例：Blue Pill 閃爍 LED',

  // ---- empty state (SH-3) ----
  'Where to start?': '從哪裡開始？',
  'Follow a lesson step by step, or open a ready-made example and press “▶ Run simulation” to see it work.':
    '跟著課程一步一步做，或開啟現成的範例，按「▶ 執行模擬」看它動起來。',
  'Start lesson 1 (recommended)': '從第一課開始（推薦）',
  'Open an example': '開啟範例',
  'Place parts yourself': '自己放元件',
  'Ask AI to wire it': '問 AI 幫你接',

  // ---- placement / wire hints (hints.ts, SH-5) ----
  'Wire mode: tap two holes or terminals in turn · Esc to finish': '導線模式：依序點兩個孔位或端子 · Esc 結束',
  'Wire from {from}: tap the second hole · Esc cancels this one': '從 {from} 拉線：點第二個孔位 · Esc 取消這條',
  '{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel) · Esc to cancel':
    '{part}：點 f 列中第 1 腳的孔位（DIP-{n} 跨在中央溝槽上）· Esc 取消',
  '{part}: tap a hole in row {row} to drop it ({pin} lands on that hole) · R rotates · Esc to cancel':
    '{part}：點 {row} 列的孔位放下（{pin} 對齊那個孔）· R 旋轉 · Esc 取消',
  '{part}: tap a hole on the net you want to plot · Esc to cancel': '{part}：點要量測的網路上的孔位 · Esc 取消',
  '{part}: tap a hole to place it · Esc to cancel': '{part}：點一個孔位放下 · Esc 取消',
  '{part}: tap {n} holes in turn ({pins}) · Esc to cancel': '{part}：依序點 {n} 個孔位（{pins}）· Esc 取消',
  'Lead {i}/{n}: tap the hole for “{pin}” · Esc to cancel': '第 {i}/{n} 腳：點「{pin}」的孔位 · Esc 取消',
  'Placed {id} — keep tapping holes to place another · Esc to finish': '已放置 {id}——繼續點孔位可再放一顆 · Esc 結束',
  // touch (coarse pointer): the on-screen way out instead of a key
  'Wire mode: tap two holes or terminals in turn · tap “Done” to finish': '導線模式：依序點兩個孔位或端子 · 點「完成」結束',
  'Wire from {from}: tap the second hole · tap empty space to cancel this one': '從 {from} 拉線：點第二個孔位 · 點空白處取消這條',
  '{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel) · tap the card again to cancel':
    '{part}：點 f 列中第 1 腳的孔位（DIP-{n} 跨在中央溝槽上）· 再點一次卡片可取消',
  '{part}: tap a hole in row {row} to drop it ({pin} lands on that hole) · tap the card again to cancel':
    '{part}：點 {row} 列的孔位放下（{pin} 對齊那個孔）· 再點一次卡片可取消',
  '{part}: tap a hole on the net you want to plot · tap the card again to cancel': '{part}：點要量測的網路上的孔位 · 再點一次卡片可取消',
  '{part}: tap a hole to place it · tap the card again to cancel': '{part}：點一個孔位放下 · 再點一次卡片可取消',
  '{part}: tap {n} holes in turn ({pins}) · tap the card again to cancel': '{part}：依序點 {n} 個孔位（{pins}）· 再點一次卡片可取消',
  'Lead {i}/{n}: tap the hole for “{pin}” · tap the card again to cancel': '第 {i}/{n} 腳：點「{pin}」的孔位 · 再點一次卡片可取消',
  'Placed {id} — keep tapping holes to place another · tap the card again to finish':
    '已放置 {id}——繼續點孔位可再放一顆 · 再點一次卡片即可結束',
  '{part} doesn’t fit here: {reason}': '這裡放不下 {part}：{reason}',
  '{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row}':
    '這裡放不下 {part}：需要跨在中央溝槽上，請點 {row} 列的孔位',

  // ---- wire strip / undo pill (SH-5 / SH-7) ----
  'Done|wire': '完成',
  'Leave wire mode': '離開導線模式',
  'Frame the circuit': '對準電路',

  // ---- More sheet rows (SH-6) ----
  'AI circuit assistant': 'AI 電路助手',
  'Describe a circuit and AI builds it on the board': '描述想要的電路，AI 幫你接到麵包板上',
  'Keyboard shortcuts': '鍵盤快速鍵',

  // ---- keyboard shortcuts sheet + debugger keys (SH-7) ----
  'Close|shortcuts': '關閉',
  'Space|key': '空白鍵',
  'Arrow keys|key': '方向鍵',
  'Simulation|shortcuts': '模擬',
  'View|shortcuts': '檢視',
  'Editing|shortcuts': '編輯',
  'Run / pause': '執行／暫停',
  'Halt / resume the core': '停住／繼續核心',
  'Step one instruction': '單步執行一道指令',
  'Reset the MCU': '重置 MCU',
  'Show this list': '顯示這份清單',
  'Nudge the selection': '微移選取的元件',
  'Cancel / clear the selection': '取消／取消選取',
  'Select the MCU to reset first': '請先選取要重置的 MCU',
  '{id} reset': '已重置 {id}',
  'Select the MCU to halt first': '請先選取要停住的 MCU',
  '{id} core halted — F10 steps, F5 resumes': '已停住 {id} 核心——F10 單步、F5 繼續',
  'Halt the core first (F5), then step with F10': '請先按 F5 停住核心，再用 F10 單步',

  // ==== fix wave (docs/ux/UX_VERIFY.md §7.2 WS1) ====
  // ---- SH-9 keys wherever the focus is ----
  'Space, F5, F10 and Shift+F5 work wherever the focus is (Space not while you type in a field); the editing keys work on the 3D view.':
    '空白鍵、F5、F10、Shift+F5 在任何地方都能用（在輸入框打字時空白鍵除外）；編輯用的按鍵要在 3D 畫面上使用。',
  '{id} core halted and stepped one instruction — F5 resumes': '已停住 {id} 核心並單步一道指令——F5 繼續',
  'Select the MCU to step first': '請先選取要單步的 MCU',
  'Start the simulation first (Space or F5) — then F5 halts the core and F10 steps':
    '模擬還沒開始——先按空白鍵或 F5 執行，再按 F5 停住核心、F10 單步',

  // ---- SH-11 a refused drop names the real reason ----
  '{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row} (marked in blue) ({pin} lands on that hole)':
    '這裡放不下 {part}：它要跨在中央溝槽上——請點 {row} 列（藍色標示）的孔位（{pin} 對齊那個孔）',
  '{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row} (marked in blue)':
    '這裡放不下 {part}：它要跨在中央溝槽上——請點 {row} 列（藍色標示）的孔位',
  '{part} doesn’t fit here: it runs off the right edge of the board — move it left, or switch to the {xl} board (More → Board size)':
    '這裡放不下 {part}：右邊超出麵包板——請往左移，或在「更多 → 麵包板尺寸」改用{xl}',
  '{part} doesn’t fit here: it runs off the left edge of the board — move it right':
    '這裡放不下 {part}：左邊超出麵包板——請往右移',
  '{part} doesn’t fit here: it runs off the board — pick a hole nearer the middle':
    '這裡放不下 {part}：超出麵包板——請點靠中間一點的孔位',

  // ---- SH-12 wires name both ends; the coach's 「放置中」 is the way out ----
  'Connected {ends}': '已接上 {ends}',
  'Can’t wire here: {reason}': '這裡不能接：{reason}',
  // fragments of the touch hints above (must stay word-for-word inside them)
  'tap the card again to cancel|exit': '再點一次卡片可取消',
  'tap the card again to finish|exit': '再點一次卡片即可結束',
  'press “Placing” again to cancel|exit': '再按一次「放置中」即可取消',
  'press “Placing” again to finish|exit': '再按一次「放置中」即可結束',

  // ---- SH-13 the status pill never says something false ----
  'Circuit ready — press ▶ Run simulation (Space) · {n} to confirm after the run':
    '電路已就緒——按 ▶ 執行模擬（空白鍵）· {n} 項執行後確認',
  'Circuit ready — tap ▶ Run simulation · {n} to confirm after the run': '電路已就緒——點 ▶ 執行模擬 · {n} 項執行後確認',
  'The breadboard is empty — open an example or place parts first': '麵包板是空的——先開啟範例或放元件',
  'Problems ({n}) · {m} hints': '問題（{n}）· 提示 {m}',

  // ---- SH-16 keyboard: F6 between the window's regions ----
  'Move between panels': '在面板之間移動',
}
export default zh
