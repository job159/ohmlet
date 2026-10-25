/**
 * zh-TW strings of the instruments area's release-QA fixes (IS-F1 … IS-F18):
 * honest levels on the scope (undersampled lines, decimated averages, a
 * probe still capturing its first period), the stopped-signal readout, the
 * neutral live-net wording (週期訊號 / 序列資料), the probe-open multimeter,
 * the overwritten logic recording, the UART line under the shared cursor.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage (§5.4): 探棒、訊號、工作週期、取樣、邏輯分析儀、終端機。
 */
const zh: Record<string, string> = {
  // ---- IS-F4 / F13: the decode results ----
  'Show in the UART terminal': '在 UART 終端機中檢視',
  'Back to the newest': '回到最新',

  // ---- IS-F6: a line faster than the analog samples ----
  '— (undersampled)': '—（取樣不足）',
  'This line’s bits are only {bit} long and the simulation samples the analog value about every {dt}: the waveform and its peak-to-peak are not reliable — use the logic analyzer instead':
    '這條線的位元只有 {bit}，模擬的類比取樣約 {dt}：波形與峰對峰值不可信——請改用邏輯分析儀',
  'This line’s pulses are typically only {pulse} long and the simulation samples the analog value about every {dt}: the waveform and its peak-to-peak are not reliable — use the logic analyzer instead':
    '這條線的脈波通常只有 {pulse}，模擬的類比取樣約 {dt}：波形與峰對峰值不可信——請改用邏輯分析儀',
  'Open the logic analyzer': '開啟邏輯分析儀',
  'This is a {baud} serial signal: the scope’s samples are too coarse, so it is set to {tdiv} — use the logic analyzer to see each bit':
    '這是 {baud} 的序列訊號：示波器取樣不夠細，已設為 {tdiv}；要看每個位元請用邏輯分析儀',

  // ---- IS-F7: the averages of a decimated window ----
  '— (decimated, no average)': '—（已抽樣，無法計算平均）',
  'From the full-resolution recording of this window': '取自這個視窗的完整解析度記錄',

  // ---- IS-F10: the probe's own samples ----
  '— (capturing)': '—（擷取中）',
  'Vpp (last {span})': '峰對峰值（最近 {span}）',
  'Vavg (last {span})': '平均值（最近 {span}）',
  'Vrms (last {span})': '均方根（最近 {span}）',

  // ---- IS-F18: a short scope screen ----
  'Readings ▾': '量測 ▾',
  'Readings ▴': '量測 ▴',
  '{n} more channels': '另外 {n} 個通道',

  // ---- IS-F8: what a net is doing, in neutral words ----
  'Periodic signal {f} · {duty}': '週期訊號 {f} · {duty}',
  'Changing (serial data)': '訊號變化中（序列資料）',
  // too few edges to tell whether it repeats (a 1 Hz blink's first second): no claim either way
  'Changing|net': '訊號變化中',

  // ---- IS-F9: a signal that stopped ----
  '— (stopped low, last edge {time})': '—（已停在低電位，最後一個邊緣 {time}）',
  '— (stopped high, last edge {time})': '—（已停在高電位，最後一個邊緣 {time}）',
  '— (stopped, floating after the last edge {time})': '—（已停止，最後一個邊緣 {time} 之後浮接）',
  'The signal repeated, then stopped: no frequency since.': '訊號原本規律重複，之後就停了：此後沒有頻率可量。',

  // ---- IS-F11: a multimeter without its probes ----
  'Probe not connected ({id} {pin} terminal is not wired yet)': '探棒未接（{id} {pin} 端還沒接線）',
  'Probes not connected ({id}: neither probe is wired yet)': '探棒未接（{id} 兩支探棒都還沒接線）',
  // …and the next step, in the meter's mode
  '{what} — {next}': '{what}——{next}',
  'wire COM to GND and IN to the point to measure': '把 COM 接到 GND、IN 接到要量的點',
  'put the meter in the current’s path: current flows in at IN and out at COM': '把電表串進電流路徑：電流從 IN 流入、COM 流出',
  'wire IN and COM across the part to measure (circuit unpowered)': '把 IN 與 COM 接在要量的元件兩端（電路不通電）',

  // ---- IS-F12: an overwritten stretch of the logic recording ----
  'The recording of this stretch was overwritten (the buffer keeps only the newest 65 536 edges) — press “Auto” to go back to the newest signal':
    '這段時間的記錄已被覆寫（緩衝區只保留最新的 65 536 個邊緣）——按「自動」回到最新的訊號',
  '— (this stretch was overwritten)': '—（這段已被覆寫）',

  // ==== QA clarity round (analysis panels: simple, named, explained) ====

  // ---- LA-AXIS: an absolute anchor, then offsets ----
  'The first tick is the simulation time; the others are the time since it': '第一個刻度是模擬時間，其餘是相對它的時間差',
  'Cursor|la-foot': '游標',
  'Window|la-foot': '視窗',

  // ---- LA-FIT / LA-MEAS-NAMES: the recent recording, named ranges ----
  '(last {span})': '（最近 {span}）',
  'Measured over the last {span} of the recording: the window holds less than one period': '取自最近 {span} 的記錄：目前的視窗裡不到一個完整週期',
  'shortest–longest': '最短–最長',

  // ---- GLOSSARY-IN-INSTRUMENTS: the two terms the shared glossary lacks (InstrumentTerm.tsx) ----
  'Rise time (10–90 %)': '上升時間（10–90 %）',
  'How long the signal takes to climb from 10 % to 90 % of its swing. For an RC circuit it is about 2.2 × R × C.':
    '訊號從擺幅的 10 % 爬到 90 % 所需的時間。RC 電路約為 2.2 × R × C。',
  'I²C lane letters': 'I²C 解碼字母',
  'S = start, Sr = repeated start, P = stop, A = ACK (answered), N = NACK (no answer).':
    'S＝開始、Sr＝重複開始、P＝停止、A＝ACK（有回應）、N＝NACK（沒有回應）。',
  'Auto: show every channel’s signal (at least 2 periods of the slowest one, or the newest decoded frame)':
    '自動：讓每個通道的訊號都看得到（最慢的通道至少 2 個週期，或最新一筆解碼結果）',
  'Adjusted automatically: {n} periods of {name} (the slowest channel)': '已自動調整：顯示 {name} 的 {n} 個週期（最慢的通道）',
  '{what} — the faster channels are measured in “Every channel”': '{what}——較快的通道請看「各通道量測」',
  'High|la-level': '高電位',
  'Low|la-level': '低電位',
  'Undefined level (floating or two drivers fighting)': '準位不明（浮接，或兩個輸出互相衝突）',
  'Not recorded yet': '尚未錄到',

  // ---- FG-RAIL: a function generator's output is its setting, never a rail ----
  '{text} (function generator setting)': '{text}（函數產生器設定）',
  '{wave} {f} · {range}': '{wave} {f} · {range}',
  'Square wave': '方波',
  'Sine wave': '正弦波',
  'Triangle wave': '三角波',

  // ---- MEASURE-COHERENCE: one wording with the logic analyzer; a held net names its level ----
  'Serial data': '序列資料',
  'UART {line}': 'UART {line}',
  '{protocol} data': '{protocol} 資料',
  'Level changes': '有訊號變化',
  'Level changes (not periodic)': '有訊號變化（非週期）',
  'Now —': '目前 —',
  'Now high ({v})': '目前 高（{v}）',
  'Now low ({v})': '目前 低（{v}）',
  'Now {v}': '目前 {v}',
  '{now} · before the pause: {before}': '{now} · 暫停前：{before}',
  '{now} · before the core halted: {before}': '{now} · 核心停住前：{before}',
  'What the function generator is set to — not a measurement; the scope shows the real waveform': '函數產生器的設定值，不是量測結果；實際波形請看示波器',
  'The level now, and what the signal did before the pause': '目前的準位，以及暫停前訊號的樣子',
  'The level now, and what the signal did before the core halted': '目前的準位，以及核心停住前訊號的樣子',
  'AC (the instantaneous value jumps) — use the scope': '交流（瞬時值會跳動）——請用示波器看',
  'Setting: centre {mid} ± amplitude {amp}': '設定：中心 {mid} ± 振幅 {amp}',
  'Scope CH{n}': '示波器 CH{n}',
  'Peak-to-peak|reading': '峰對峰值',
  'Over the scope’s window (last {span})': '示波器視窗內（最近 {span}）',

  // ---- DECODE-SUMMARY: the table at a glance ----
  'Address {addr} write': '位址 {addr} 寫',
  'Address {addr} read': '位址 {addr} 讀',
  'I²C: {n} transfers': 'I²C：{n} 筆',
  '{line} {n} lines': '{line} {n} 行',
  'SPI: {n} transfers · {k} boot noise': 'SPI：{n} 筆 · {k} 筆開機雜訊',
  'SPI: {n} transfers': 'SPI：{n} 筆',
  '1-Wire: {n} exchanges': '1-Wire：{n} 筆',
  'Addresses that answered (ACK):': '回應 ACK 的位址：',
  'Show every row again': '顯示全部',
  'Show only the rows of {addr}': '只顯示 {addr} 的資料',
  'Status filter': '狀態篩選',
  'All|results-filter': '全部',
  'ACK only': '只看 ACK',
  'Errors only': '只看錯誤',
  'No row has this status — choose “All”.': '沒有符合這個狀態的資料——請選「全部」。',
  'Summary of the decoded results': '解碼結果摘要',

  // ---- SCOPE-CURSORS: the analyzer's A / B, every channel read at each cursor ----
  'Voltage 1|cursor': '電壓 1',
  'Voltage 2|cursor': '電壓 2',

  // ---- SCOPE-READOUT-TRIGGER: the readout fits the signal; one trigger chip ----
  'Not run yet — press “▶ Run simulation” (Space)': '尚未執行——按「▶ 執行模擬」（空白鍵）',
  'max|meas': '最大',
  'min|meas': '最小',
  'Rise time (10–90 %)|meas': '上升時間（10–90 %）',
  'From the sampled waveform: 10 % → 90 % of the swing': '由取樣的波形計算：擺幅的 10 % → 90 %',
  'V/div|label': 'V/格',
  'Auto|vdiv': '自動',
  'Trigger: off': '觸發：關',
  'Trigger: {what}': '觸發：{what}',
  'level {v}': '準位 {v}',
  'holdoff {time}': '抑制 {time}',
  '↑ rising edge': '↑ 上升緣',
  '↓ falling edge': '↓ 下降緣',
  'Auto|trig-short': '自動',
  'Normal|trig-short': '一般',
  'Single|trig-short': '單次',
  'Source|trigger': '來源',
  'Edge|trigger': '邊緣',
  'Level|trigger': '準位',
  'Mode|trigger': '模式',
  'Holdoff|trigger': '抑制時間',
  'Off|trigger': '關',
  'The moment the signal crosses the level on that edge is time 0 on the axis.': '訊號在這個邊緣穿過準位的那一刻，就是時間軸上的 0。',
}

export default zh
