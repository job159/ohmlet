/**
 * zh-TW strings for the desktop workspace (src/ui/workspace): panel frames,
 * resize / collapsed handles, the instrument-tray tabs, the inspector frame,
 * the Library / Examples / Lessons tabs and the library cards.
 * Keys are the English sources passed to t() / tc() ("source|context").
 */
const zh: Record<string, string> = {
  // ---- panels, resize + collapsed handles (Workspace.tsx) ----
  Library: '元件庫',
  'Resize library panel': '調整元件庫面板寬度',
  'Show library panel': '顯示元件庫面板',
  'Show library': '顯示元件庫',
  Inspector: '屬性',
  'Resize inspector': '調整屬性面板寬度',
  'Show inspector': '顯示屬性面板',
  Instruments: '儀器',
  'Resize instrument tray': '調整儀器面板高度',

  // ---- instrument tray (Tray.tsx) ----
  'UART Terminal': 'UART 終端機',
  'Logic Analyzer': '邏輯分析儀',
  Oscilloscope: '示波器',
  'Simulation Log': '模擬日誌',
  'Collapse instrument tray': '收合儀器面板',
  'Expand instrument tray': '展開儀器面板',

  // ---- inspector frame (Inspector.tsx) ----
  'Hide inspector': '隱藏屬性面板',
  'Nothing selected': '尚未選取任何項目',
  'Click a part or wire on the board to inspect it. Hover a pin to see its name.':
    '點選麵包板上的元件或導線即可檢視其屬性；將游標移到腳位上可顯示腳位名稱。',
  Wire: '導線',

  // ---- left panel tabs (LibraryPanel.tsx) ----
  Examples: '範例',
  Lessons: '課程',
  'Left panel': '左側面板',
  'Hide library panel': '隱藏元件庫面板',

  // ---- library: categories (tc(…, 'category')) ----
  'Passives|category': '被動元件',
  'Semis|category': '半導體',
  'Switches|category': '開關',
  'Displays|category': '顯示',
  'ICs|category': 'IC',
  'Power|category': '電源',
  'Instruments|category': '儀器',
  'MCU|category': '微控制器（MCU）',
  'Sensors|category': '感測器',
  'Modules|category': '模組',
  'Motors|category': '馬達',

  // ---- library: search, filters, sections ----
  'Search parts and tags': '搜尋元件與標籤',
  'Search the component library': '搜尋元件庫',
  'Clear search': '清除搜尋',
  Filters: '篩選',
  Category: '分類',
  'All parts': '全部分類',
  'Simulation support': '模擬支援等級',
  'Any support': '任何支援等級',
  'Show favorites only': '僅顯示收藏',
  'Favorites only': '僅收藏',
  'No favorites yet — star a part to pin it here.': '尚無收藏——為元件加上星號即可釘選在這裡。',
  'No parts match “{q}”.': '沒有符合「{q}」的元件。',
  'No parts match these filters.': '沒有符合這些篩選條件的元件。',
  '{n} part': '{n} 個元件',
  '{n} parts': '{n} 個元件',
  Favorites: '收藏',

  // ---- library cards ----
  'fully simulated': '完整模擬',
  'partially simulated': '部分模擬',
  'visual only, not simulated': '僅視覺接線，不模擬',
  'in development, not placeable': '開發中，無法放置',
  '{part}, {meta}, {support}, placing — click again to cancel': '{part}，{meta}，{support}，放置中——再按一次即可取消',
  '{part}, {meta}, {support}, click to place': '{part}，{meta}，{support}，點選即可放置',
  Placing: '放置中',
  'Remove {part} from favorites': '將「{part}」從收藏移除',
  'Add {part} to favorites': '將「{part}」加入收藏',
  Unfavorite: '取消收藏',
  Favorite: '加入收藏',
  'Hide {part} details': '隱藏「{part}」的詳細資訊',
  'Show {part} details': '顯示「{part}」的詳細資訊',
  Details: '詳細資訊',
  Specs: '規格',
  Simulated: '已模擬',
  'Not modeled': '未模擬',
  // placement meta (text.ts placementText)
  '{n} leads': '{n} 腳',
  '{n}-pin': '{n} 腳',
  'off-board': '板外',
  probe: '探棒',

  // ---- examples tab ----
  'Example circuits': '範例電路',
  // one verb per action (release QA SC-F4): 開啟範例
  'Loading an example replaces the current circuit (undoable).': '開啟範例會取代目前的電路（可復原）。',
  '{parts} parts · {wires} wires': '{parts} 個元件 · {wires} 條導線',
  'Loaded “{title}”': '已載入「{title}」',
  'Couldn’t load example: {error}': '無法開啟範例：{error}',
  'unknown error': '未知錯誤',
  // bundled examples (src/ui/workspace/examples.ts titles)
  '555 LED blinker': '555 LED 閃爍電路',
  'Date display': '日期顯示器',
  '0–9 counter': '0–9 計數器',
  'Night light': '小夜燈',

  // ---- lessons tab ----
  'No lessons yet': '尚無課程',
  'Guided builds — blink an LED from real firmware, read a sensor over I²C, decode UART on the logic analyzer — will appear here, each checked against the live simulation.':
    '引導式實作課程——以真實韌體讓 LED 閃爍、透過 I²C 讀取感測器、在邏輯分析儀上解碼 UART——將陸續出現在這裡，每一步都會以即時模擬結果檢核。',
  '{level} · {minutes} min — {summary}': '{level} · {minutes} 分鐘——{summary}',
  Beginner: '初級',
  Intermediate: '中級',
  Advanced: '進階',
}
export default zh
