/**
 * zh-TW strings of the release polish round, instruments / state (owner:
 * polish-instr). Keys are the English sources passed to t(). Taiwan usage
 * (docs/ux/UX_VERIFY.md §5.4): 邏輯分析儀、終端機、訊框、起始位元、標記、導線。
 *
 *  - 「在邏輯分析儀中檢視」 on a line the terminal SENT (its local echo): the
 *    frames its USB-TTL adapter put on the RX pin (uart-reveal.ts);
 *  - the analyzer's auto-fit while the recorder holds a few edges but no
 *    period yet (la-no-signal.ts) needs no new text: it shows them.
 */
const zh: Record<string, string> = {
  // ---- 「在邏輯分析儀中檢視」 on a sent line (the RX wire)
  'Centre the logic analyzer on the frames this line went out as on {pin} (RX), marker A on the first start bit':
    '把邏輯分析儀對準這一行送上 {pin}（RX）的訊框，A 標記放在第一個起始位元',
  'Showing when this line was sent (the RX pin is not readable on the analyzer)': '已顯示這一行送出的時間（邏輯分析儀讀不到 RX 腳的波形）',
  'Showing when this line was sent (its frames are not in the {pin} recording)': '已顯示這一行送出的時間（{pin} 的記錄中找不到它的訊框）',
  'This line is not on {pin} yet — let the simulation run a moment, then try again': '這一行還沒有送上 {pin}——讓模擬再跑一下，然後再試一次',
  '{pin} was not on the logic analyzer, so this line cannot be shown — added it: lines you send from now on can be.':
    '{pin} 不在邏輯分析儀上，無法回看這一行——已加入 {pin}，之後送出的行就能檢視。',
}

export default zh
