/**
 * zh-TW strings of the simulation-fidelity wave: the MCU inspector's register
 * rows (the function LR returns into / an EXC_RETURN value) and the 周邊 tab's
 * 「只看韌體用到的」 filter (src/ui/embedded/McuPanel.tsx). Taiwan usage
 * (docs/ux/UX_VERIFY.md §5.4 term table).
 */
const dict: Record<string, string> = {
  // ---- register rows: LR ----
  'Return address (LR) is in {fn}': '返回位址（LR）位於 {fn}',
  'exception return': '例外返回',
  'EXC_RETURN: the core is in an exception handler; returning loads this value into PC and unstacks the registers':
    'EXC_RETURN：核心正在例外處理常式中；返回時把這個值載入 PC，再從堆疊取回暫存器',

  // ---- 周邊 tab filter ----
  'Only what the firmware uses': '只看韌體用到的',
  '{n} of {total} — clock enabled in RCC, or started by the firmware': '{n}／{total} 個：已在 RCC 開啟時脈，或已由韌體啟動',
}

export default dict
