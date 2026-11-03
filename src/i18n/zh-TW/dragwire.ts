/**
 * zh-TW strings of drag-to-wire (round 5 — 「拖曳拉線，不必先切到導線模式」;
 * src/three/scene.ts beginWireDraw, src/ui/workspace/wire-draw.ts): the
 * onboarding's 「看看四周」 card, which says what a drag from a hole does.
 * The drop's own words are the wire mode's (「已接上 …」, 「這裡不能接：…」).
 * The polish round (stream "scene", src/ui/workspace/wire-draw.ts) adds:
 *  - a drop on a part's LEG lands on the free hole of the same strip / rail
 *    (the start's own rule) — the aim chip says so while dragging, the
 *    toast names where it went;
 *  - a start a pin's press moved is named in the toast too (the chip uses
 *    the wire mode's 「c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線」);
 *  - a finger's long-press grip says what a lift and a drag do;
 *  - the one-time tip the first time the mouse rests on a free hole (the
 *    wire mode hint no longer carries a long tail about the gesture).
 * The final round adds the one reason a drop on the start's own strip /
 * rail does nothing: 「d40 跟起點在同一排，本來就是通的」.
 * Keys are the English sources passed to t(). Taiwan usage: 孔位、拖曳、
 * 長按、旋轉、取景、拉線、探測選單、電源軌、改接；full-width punctuation.
 */
const zh: Record<string, string> = {
  // onboarding 「看看四周」 (Onboarding.tsx STEPS): touch / mouse
  'Drag with one finger to orbit, pinch to zoom, drag with two fingers to pan; long-press a hole and drag to another hole to wire them. Double-tap empty space to re-frame.':
    '單指拖曳旋轉、雙指捏合縮放、雙指拖移平移；長按孔位再拖到另一個孔位就能接線。點兩下空白處可重新取景。',
  'Left-drag off the holes to orbit (with Alt / Option held, drag anywhere to orbit), scroll to zoom, right-drag to pan; drag from one hole to another to wire them. Double-click empty space to re-frame.':
    '在孔位以外的地方按左鍵拖曳旋轉（按住 Alt／Option 鍵則哪裡都能拖曳旋轉）、滾輪縮放、右鍵拖曳平移；從一個孔位拖到另一個孔位就能接線。在空白處點兩下可重新取景。',

  // the aim chip while a drop would move along the strip (wire-draw.ts wireDrawLanding)
  '{hole} is taken by {pin} → lands on {free} in the same row': '{hole} 被 {pin} 佔用 → 接到同一排的 {free}',
  '{hole} is taken by {pin} → lands on {free} on the same rail': '{hole} 被 {pin} 佔用 → 接到同一條電源軌的 {free}',

  // a drop on the START's own strip / rail (a free hole or a leg — final round,
  // wire-draw.ts landingOf 'joined'): the aim chip, and after 「這裡不能接：」 the toast
  '{hole} is in the same row as the start — they are already connected': '{hole} 跟起點在同一排，本來就是通的',
  '{hole} is on the same rail as the start — they are already connected': '{hole} 跟起點在同一條電源軌上，本來就是通的',

  // the 「已接上 …」 toast naming an end a redirect moved (wire-draw.ts drawWire)
  '{free} ({hole} is taken by {pin}, so it lands in the same row)': '{free}（{hole} 被 {pin} 佔用，改接同一排）',
  '{free} ({hole} is taken by {pin}, so it lands on the same rail)': '{free}（{hole} 被 {pin} 佔用，改接同一條電源軌）',
  '{free} ({hole} is taken by {pin}, so it starts in the same row)': '{free}（{hole} 被 {pin} 佔用，改從同一排接出）',
  '{free} ({hole} is taken by {pin}, so it starts on the same rail)': '{free}（{hole} 被 {pin} 佔用，改從同一條電源軌接出）',

  // a finger's long-press grip (wire-draw.ts wireGripText)
  '{point} · lift: probe menu / drag: draw a wire': '{point} · 放開：探測選單／拖曳：拉線',
  '{point} · lift: probe menu / drag: move this end': '{point} · 放開：探測選單／拖曳：改接這一端',

  // the one-time tip (wire-draw.ts wireDrawHint)
  'Tip: hold a hole and drag to another hole to draw a wire': '小提示：按住孔位拖到另一個孔位，就能拉線',
  // zoomed too far out: a press in a hole orbited (persona fix — wire-draw.ts wireDrawTooSmall)
  'Zoom in a little (scroll, or press F to frame the circuit) to draw wires from the holes': '放大一點（滾輪，或按 F 對準電路）就能從孔位拉線',
}

export default zh
