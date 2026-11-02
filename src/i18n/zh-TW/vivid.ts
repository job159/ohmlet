/**
 * zh-TW strings of the component-realism and feedback work (owner: vivid):
 * the celebration badge / toast (src/ui/fx/celebrate.ts, success-watch.ts),
 * the 更多 →「音效」 row (src/ui/fx/SoundSettingRow.tsx) and the damage
 * honesty sentence of the problems list (src/ui/embedded/problems.ts).
 * Keys are the English sources passed to t(). Terms follow the canonical
 * table (docs/ux/UX_VERIFY.md §5.4): 重置模擬, 在電路板上標示.
 */
const zh: Record<string, string> = {
  // ---- celebration (C3) ----
  'Done!': '完成！',
  'Circuit working ✓': '電路正常運作 ✓',
  '“{title}” — all {n} acceptance checks pass': '「{title}」驗收 {n} 項全部通過',
  'All {n} acceptance checks pass': '驗收 {n} 項全部通過',
  'Close|celebration': '關閉',

  // ---- what the circuit-ok cue saw (real activity only) ----
  '{id} lit': '{id} 亮了',
  '{id} on-board LED lit': '{id} 板上 LED 亮了',
  '{id} turning': '{id} 在轉',
  '{id} sounding': '{id} 在響',
  '{id} display on': '{id} 螢幕亮了',
  '{id} toggles {pin}': '{id} 的 {pin} 在切換',
  '{id} sends serial data': '{id} 送出序列資料',

  // ---- 更多 → 音效 ----
  Sound: '音效',
  'A chime when a lesson passes or a circuit works, a pop when a part burns, quiet clicks while building':
    '課程通過或電路正常運作時的提示音、元件燒毀的爆裂聲，以及接線時的輕響',

  // ---- problems: a pin measured beyond its absolute maximum ----
  'Beyond its absolute maximum rating a real chip’s pin may already be damaged — from here on the simulation no longer guarantees how {id} behaves. Fix the cause, then reset the simulation.':
    '這已超過絕對最大額定：實際晶片的這支腳可能已經損壞，之後模擬不再保證 {id} 的行為。請先排除原因，再重置模擬。',
}
export default zh
