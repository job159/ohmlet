/**
 * zh-TW strings of the UX fix wave's shared helpers H1–H11
 * (scratchpad reports/ux/HELPERS.md): the unit formatter's words
 * (src/instruments/format.ts — H3), terminal names (src/i18n/parts.ts
 * terminalLabel — H1), static endpoint names and wire refusals
 * (src/ui/workspace/hole-chip.ts endpointName / wireRefusalText — H2, H8),
 * live net text (src/ui/embedded/instruments/net-activity.ts — H4) and
 * button titles with their key (src/ui/chrome/ShortcutsSheet.tsx withKey —
 * H6). Taiwan usage (UX_VERIFY.md §5.4); a number and its unit keep a space.
 */
const dict: Record<string, string> = {
  // ---- H3 units (src/instruments/format.ts) ----
  '> 2 A (short circuit)': '> 2 A（短路）',
  '— (short circuit)': '—（短路）',
  // the canonical `invalid` text for a voltage the solver could not compute (IN-14)
  '— (solver did not converge)': '—（求解器未收斂）',
  '{s} s ({clock})': '{s} s（{clock}）',

  // ---- H1 terminals (src/i18n/parts.ts terminalLabel) ----
  '{name} terminal': '{name} 端',

  // ---- H2 endpoint names (src/ui/workspace/hole-chip.ts endpointName) ----
  '{rail} hole {n}': '{rail} 第 {n} 孔',
  '{name} ({hole})': '{name}（{hole}）',
  '{hole} ({name} strip)': '{hole}（{name} 這一排）',

  // ---- H8 wire refusals (hole-chip.ts wireRefusalText) ----
  'Wire {id} no longer exists': '導線 {id} 已經不存在',
  '{hole} is not on the current breadboard': '{hole} 不在目前的麵包板上',
  '{ref} is not a terminal of a part in the circuit': '{ref} 不是電路中任何元件的端子',
  '{hole} is already the other end of this wire': '{hole} 已經接在這條導線的另一端',
  'Wire {id} already joins these two points': '這兩點之間已經有導線 {id}',
  '{hole} already holds {what}': '{hole} 已經被 {what} 佔用',
  '{hole} is already in use': '{hole} 已經被佔用',
  '{hole} is covered by the body of {id}': '{hole} 被 {id} 的本體蓋住了',
  '{hole} is covered by a part body': '{hole} 被元件本體蓋住了',

  // ---- H4 live net text (net-activity.ts netLiveText) ----
  'PWM {f} · {duty}': 'PWM {f} · {duty}',
  '{text} (average {v})': '{text}（平均 {v}）',
  'Changing (not periodic)': '訊號變化中（非週期）',
  '{v} (instantaneous)': '{v}（瞬時）',
  'Instantaneous value, updated 4 times a second': '瞬時值，每秒更新 4 次',

  // ---- H6 keys on buttons (ShortcutsSheet.tsx withKey / SHORTCUTS) ----
  '{label} ({keys})': '{label}（{keys}）',
  'Analysis layout': '分析版面',
}

export default dict
