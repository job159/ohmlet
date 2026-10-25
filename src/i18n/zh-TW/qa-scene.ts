/**
 * zh-TW strings of the release-QA fix round, scene area (SC-F1 … SC-F5):
 * the phone's place / wire framing toast (src/ui/workspace/scene-bridge.ts),
 * the part-body chip's selected state (src/ui/workspace/hole-chip.ts), the
 * Parts sheet's 「元件庫｜範例」 segments (src/ui/sheets/PartsSheet.tsx) and
 * the example rows' accessible names (src/ui/workspace/LibraryPanel.tsx).
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Terms follow the canonical table (docs/ux/UX_VERIFY.md §5.4).
 */
const zh: Record<string, string> = {
  // ---- phone framing on arming (SC-F1) ----
  'Zoomed in on the breadboard — pinch to zoom again': '已放大麵包板，雙指可再縮放',

  // ---- part-body chip (SC-F2) ----
  'Selected|object chip': '已選取',

  // ---- Parts sheet segments (SC-F3) ----
  'Parts sheet view': '顯示元件庫或範例',

  // ---- example rows: one verb per action (SC-F4) ----
  'Open example: {title}': '開啟範例：{title}',
}
export default zh
