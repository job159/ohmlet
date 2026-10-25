/**
 * zh-TW strings shared by the kit (src/ui/kit) and app-wide bits: generic
 * control words, the window title, wire color names.
 *
 * Keys are the ENGLISH source strings; `"src|context"` keys disambiguate a
 * source that means different things in different places (src/ui/format.ts
 * tc()). Taiwan usage throughout (see the team glossary).
 */
const zh: Record<string, string> = {
  // window title (src/main.tsx; index.html ships the same text)
  'ohmlet — 3D breadboard simulator': 'ohmlet — 3D 麵包板模擬器',

  // kit controls
  Actions: '動作',
  Cancel: '取消',
  Navigation: '導覽',
  Decrease: '減少',
  Increase: '增加',

  // generic words used across the chrome and sheets
  Delete: '刪除',
  Clear: '清除',
  Undo: '復原',
  Redo: '重做',
  Next: '下一步',
  Skip: '略過',
  Apply: '套用',
  Discard: '捨棄',
  Retry: '重試',
  Import: '匯入',
  Hide: '隱藏',
  Show: '顯示',
  All: '全部',
  Yes: '是',
  No: '否',
  Type: '類型',
  From: '起點',
  To: '終點',
  default: '預設',
  'unknown error': '未知錯誤',

  // wire colors (src/ui/wire-colors.ts wireColorLabel)
  'red|wire color': '紅色',
  'black|wire color': '黑色',
  'yellow|wire color': '黃色',
  'green|wire color': '綠色',
  'blue|wire color': '藍色',
  'white|wire color': '白色',
  'orange|wire color': '橘色',
  'purple|wire color': '紫色',
  'gray|wire color': '灰色',
  'grey|wire color': '灰色',
  'brown|wire color': '棕色',
  'Wire color': '導線顏色',
  '{color} wire': '{color}導線',
}
export default zh
