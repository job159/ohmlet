/**
 * zh-TW strings of the release close-out UART-RX fix (owner: close-sim):
 * the UART terminal's virtual USB-TTL adapter puts typed bytes on the MCU's
 * RX pin as real UART frames. The sentence under the terminal's send box
 * (src/ui/embedded/instruments/uart-sent.ts rxWireNote) and the logic
 * analyzer's note on a quiet RX lane. Keys are the English sources passed
 * to t(). Taiwan usage (§5.4): 終端機、轉接器（USB 轉 TTL）、訊框、鮑率、導線。
 */
const zh: Record<string, string> = {
  // ---- who drives the RX net
  '{id}’s {pin}': '{id} 的 {pin}',
  '{id}’s {pin} (through {via})': '{id} 的 {pin}（經 {via}）',
  '{pin} is driven by {driver} — the terminal does not send on it': '{pin} 已由 {driver} 驅動，終端機不另外送出',
  '{pin} is driven by another output — the terminal does not send on it': '{pin} 已由其他輸出驅動，終端機不另外送出',
  'Use {id}’s {port} port': '改用 {id} 的 {port} 埠',
  '{pin} is wired straight to a supply rail or GND — the terminal does not send on it': '{pin} 直接接在電源或 GND 上，終端機不另外送出',
  '{pin} is an output of {id} right now (the firmware does not use it as the {port} RX) — the terminal does not send on it':
    '{pin} 目前是 {id} 的輸出腳（韌體沒有把它當成 {port} 的 RX），終端機不另外送出',
  '{port} RX is on {pin}, which this board does not bring out — the terminal cannot send': '{port} 的 RX 在 {pin}，這塊板子沒有引出這支腳，終端機無法送出',
  '{pin} is not connected to anything — the terminal cannot send': '{pin} 沒有接到任何地方，終端機無法送出',
  '{id} has not set the {port} baud rate yet — the terminal does not know how fast to send': '{id} 還沒有設定 {port} 的鮑率，終端機不知道要用多快的速度送出',

  // ---- how the bytes travel
  'Typed text goes out on {pin} as UART frames ({line}) through the terminal’s USB-TTL adapter (3.3 V)':
    '輸入的文字會經 USB 轉 TTL 轉接器（3.3 V），以 UART 訊框送上 {pin}（{line}）',
  'Sending on {pin}… {n} bytes to go ({line})': '正在送上 {pin}……還有 {n} 個位元組（{line}）',

  // ---- the logic analyzer: an RX lane with nothing on it yet
  'No frames on {pin} yet — send text from the UART terminal: its USB-TTL adapter puts it on this wire as UART frames':
    '{pin} 上還沒有訊框——在 UART 終端機送出文字，USB 轉 TTL 轉接器就會把它以 UART 訊框送上這條導線',
}

export default zh
