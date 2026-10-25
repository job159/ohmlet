/**
 * zh-TW strings of the release close-out (UI): the capsule's detail line
 * that runs its action on a tap (「U1 故障（鎖死）——查看原因」 opens the
 * 執行狀態 card), and the 即時讀數 row of a waveform source (a function
 * generator's current and power are AC). Keys are the English sources
 * passed to t() ("source|context"). Taiwan usage.
 */
const zh: Record<string, string> = {
  // ---- StatusBar: a detail line with an action (LOCKUP-CAUSE) ----
  'Tap: {action} · long-press to reset': '點一下：{action} · 長按重置',

  // ---- PropertiesSheet LiveGroup: a waveform source's 電流 / 功率 (FG-RAIL (3)) ----
  '{a} and {b}|quantities': '{a}與{b}',
}

export default zh
