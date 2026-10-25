/**
 * zh-TW strings of the release polish (inspector): the RX pin row of an MCU
 * whose USART receives from the UART terminal — the terminal's virtual
 * USB-TTL adapter is plugged into that pin and idles it at 3.3 V
 * (McuFrameInfo.uartRx[].attached; close-sim UART-RX). Keys are the English
 * sources passed to t(). Taiwan usage (§5.4): 終端機、轉接器（USB 轉 TTL）。
 */
const zh: Record<string, string> = {
  // ---- PartInfo PinoutGroup: the RX pin the terminal's adapter drives ----
  'Driven by the UART terminal’s USB-TTL adapter (3.3 V)': '由 UART 終端機的 USB 轉 TTL 轉接器驅動（3.3 V）',
}

export default zh
