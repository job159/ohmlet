/**
 * zh-TW strings of the UX fix wave's "scene" workstream (docs/ux/UX_VERIFY.md
 * §7.2 WS2, SC-9…SC-17): the screen-space hover chip and its terminal / part
 * texts (src/ui/workspace/hole-chip.ts), the wire-end handles, the touch
 * probe sheet (src/ui/workspace/ProbeMenu.tsx), the firmware drop overlay
 * (src/ui/workspace/Workspace.tsx) and the live LED labels.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Terms follow the canonical table (UX_VERIFY.md §5.4): 韌體、孔位、端子、
 * 工作週期、在電路板上標示、探棒。
 */
const zh: Record<string, string> = {
  // ---- hover chip (SC-12) ----
  'Click to select': '點一下選取',

  // ---- wire end handles (wire-ends.ts, SC-13) ----
  'Re-routed wire {id}: {a} → {b}': '已改接導線 {id}：{a} → {b}',
  'Can’t connect here: {reason}': '這裡不能接：{reason}',
  'Released away from a hole or terminal — wire {id} stays as it was': '沒有放在孔位或端子上——導線 {id} 維持原樣',

  // ---- probe menu / sheet (ProbeMenu.tsx, SC-14) ----
  // 檢視 — the verb of every "show it in that instrument" row (UART terminal, log; release QA SC-F4)
  'Show in the logic analyzer ({name})': '在邏輯分析儀中檢視（{name}）',
  'Show in the oscilloscope (CH{n})': '在示波器中檢視（CH{n}）',
  // requests round: a deliberate second probe on a net the scope already measures
  'Place another scope probe (CH{n})': '再放一支示波器探棒（CH{n}）',
  '{id} already measures this net on CH{n} — this adds a second probe': '{id} 已經在 CH{n} 量這個網路——這會再放一支探棒',
  // the touch sheet's one-line reason for a greyed-out row (the desktop menu shows the full one as a tooltip)
  'No free hole left on the net of {hole}': '{hole} 所在的網路已經沒有空孔',
  'All four scope channels are in use': '四個示波器通道都在使用中',

  // ---- firmware drop on the canvas (FirmwareDrop.tsx, SC-15) ----
  'Release to load it into {id} ({name})': '放開以載入到 {id}（{name}）',
  'Release to load it into {id}': '放開以載入到 {id}',
  'Drop {name} on the board that should run it': '把 {name} 放到要執行它的開發板上',
  'Drop it on the board that should run it': '放到要執行它的開發板上',
  'Drop it on the board that should run it: {ids}': '請放到要執行它的開發板上：{ids}',
  'Only .elf, .bin or .hex firmware files are accepted': '只接受 .elf、.bin 或 .hex 韌體檔',
  'No microcontroller in the circuit — place a Blue Pill first': '電路中沒有微控制器——先放一塊 Blue Pill 開發板',
}
export default zh
