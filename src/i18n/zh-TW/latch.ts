/**
 * zh-TW strings of the keep-pressed latch (owner: latch — the product
 * owner's 「按鍵可以保持按下」; src/ui/embedded/latch.ts): the inspector's
 * 「保持按下」 toggle beside 按住, its footer 「SW1 保持按下中…」, and the 3D
 * hover chip 「按住即可按下 · 雙擊保持按下」 / 「已保持按下 · 按一下放開」.
 * Keys are the English sources passed to t() ("source|context"). Taiwan
 * usage: 按住、按下、放開、接點、導通。
 */
const zh: Record<string, string> = {
  // the inspector toggle (controls.tsx LatchToggle)
  'Keep pressed|latch': '保持按下',
  'Keep it pressed until you turn this off|latch': '一直按著，直到再關掉這個開關',
  'Kept pressed — turn off to release|latch': '保持按下中——關掉即可放開',
  // the 按住 group's footer (PropertiesSheet HoldGroup)
  '{id} is kept pressed: the contacts stay closed until you turn “Keep pressed” off or press “HOLD” once.|latch':
    '{id} 保持按下中：接點一直導通，直到關掉「保持按下」或按一下「按住」。',
  'The contacts stay closed while you hold the button; “Keep pressed” keeps them closed.|latch':
    '按住按鈕期間接點導通；打開「保持按下」就會一直按著。',
  // the 3D hover chip (hole-chip.ts pressHintText; 'hold to press' is ux-scene's)
  'double-click to keep pressed|latch': '雙擊保持按下',
  'kept pressed|latch': '已保持按下',
  'click to release|latch': '按一下放開',
  // latchedSummary (for the status pill / other surfaces)
  '{ids} kept pressed|latch': '{ids} 保持按下中',
  ', |list-separator': '、',
  // the status pill's and the long-press sheet's way back (releaseLatched / setLatched)
  'Release|latch': '放開',
  // a lesson step that looks at the circuit as it is now failed while a part is kept pressed (actions.ts runStepCheck)
  '{ids} is kept pressed — this step checks the circuit as it is now|latch': '{ids} 保持按下中——這一步檢查的是目前的電路',
  // what a lesson check does with a button itself (src/lessons/engine/format.ts stimulusText): the
  // English keeps its words (the classic chrome unchanged), zh-TW names the press, not a checkbox
  'At power-on: tick {id} “{param}”|press': '一上電就按住 {id}',
  'At power-on: untick {id} “{param}”|press': '一上電就放開 {id}',
  '{t} s: tick {id} “{param}”|press': '{t} 秒時按住 {id}',
  '{t} s: untick {id} “{param}”|press': '{t} 秒時放開 {id}',
}

export default zh
