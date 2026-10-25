/**
 * zh-TW strings of the UX wave's instruments workstream (docs/ux/UX_REVIEW.md
 * WS5, IS-1 … IS-9): logic-analyzer auto-fit / find-the-signal / summary
 * chips + popovers / decoded-results table / smart channel picker and bus
 * helper, the scope's honest timing readout + 自動設定 + absolute time, the
 * UART terminal's stamps / separators / "show in the logic analyzer", the
 * simulation log's reveal, and the instrument tray.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage: 訊號、預設、設定、執行、記錄、通道、解碼、邊緣、鮑率。
 */
const zh: Record<string, string> = {
  // ---- logic analyzer: toolbar (IS-1, IS-5, IS-6, IS-8) ----
  '{span} ({div}/div)': '{span}（{div}/格）',
  'Visible window (time per division)': '可見視窗（每格時間）',
  'Auto|zoom': '自動',
  'Auto: zoom to the signal (4–10 periods, or the newest decoded frame)': '自動：縮放到看得到訊號（4–10 個週期，或最新的解碼訊框）',
  'Find the signal': '找訊號',
  'Show the whole recording': '顯示全部記錄',
  'Previous decoded frame': '上一個解碼訊框',
  'Next decoded frame': '下一個解碼訊框',
  'Previous edge': '上一個邊緣',
  'Next edge': '下一個邊緣',
  'No later decoded frame': '後面沒有其他解碼訊框了',
  'No earlier decoded frame': '前面沒有其他解碼訊框了',
  '{label}: no later edge': '{label}：後面沒有邊緣了',
  '{label}: no earlier edge': '{label}：前面沒有邊緣了',
  'Waiting for trigger: {cond}': '等待觸發：{cond}',
  'Triggered · {time}': '已觸發 · {time}',
  'Trigger · {cond}': '觸發 · {cond}',
  'Trigger · {cond} · {pre} % before': '觸發 · {cond} · 前 {pre} %',
  'Trigger settings: {cond} · {pre} % before': '觸發設定：{cond}，觸發前佔視窗 {pre} %',
  'Decoder settings': '解碼器設定',
  'needs a channel': '需要指定通道',
  'List every decoded frame of the recording': '列出記錄中的所有解碼結果',
  'Decoded results': '解碼結果',

  // ---- logic analyzer: plot, labels, hints ----
  'Add a pin, a bus or a net with “+ Channel…”, or right-click a pin on the board → Add to logic analyzer.':
    '用「＋通道…」加入腳位、匯流排或網路，或在電路板的腳位上按右鍵 →「加入邏輯分析儀」。',
  'Source {id} no longer exists': '來源 {id} 已不存在',
  'No data yet — press ▶ Run simulation (Space).': '還沒有資料——按「▶ 執行模擬」（空白鍵）。',
  'No signal changes on these channels yet.': '這些通道到目前為止都沒有訊號變化。',
  'These channels have no signal changes in the recording.': '記錄中這些通道都沒有訊號變化。',
  'No signal changes in this window. Press “Auto” to zoom to the signal.':
    '目前視窗內沒有訊號變化。按「自動」縮放到有訊號的範圍。',
  'Click the waveform to place marker A, click again for B — then read Δt and the frequency.':
    '點一下波形放 A 標記，再點一下放 B，就能量 Δt 與頻率。',
  'Click: marker A, then B (snaps to the nearest edge)': '點一下放 A 標記，再點一下放 B（會吸附到最近的邊緣）',
  // keyboard help line (keycaps are <kbd>, these are the words after them)
  pan: '平移',
  'zoom|keys': '縮放',
  'previous / next': '上一個／下一個',
  'place a marker': '放標記',
  'clear|keys': '清除',
  '+ click: no snapping': '＋點一下：不吸附',
  'pick a cursor': '選游標',
  'move it': '移動',
  'faster|keys': '加快',
  'reset|keys': '重設',

  // ---- markers + per-channel measurements (IS-9) ----
  'Place marker {m} with the next click on the waveform': '下一次點波形時放 {m} 標記',
  'click the waveform': '點波形放置',
  'Every channel': '各通道量測',
  'Frequency, duty and pulse widths of every channel (between A and B, or over the window)':
    '每個通道的頻率、工作週期與高／低電位脈寬（A、B 標記之間，或整個視窗）',
  'Measurements per channel': '各通道量測',
  'Measured over {region}': '量測範圍：{region}',
  'low|meas': '低電位時間',

  // ---- decoder summaries + editor (IS-5) ----
  'pick a channel': '選擇通道',
  '{baud} (auto) {format}': '{baud}（自動）{format}',
  'auto baud {format}': '自動鮑率 {format}',
  'pick SCL and SDA': '選擇 SCL 與 SDA',
  'pick SCK': '選擇 SCK',
  'mode {n}': '模式 {n}',
  '{decoder} decoder settings': '{decoder} 解碼器設定',
  'Pick a channel for {roles} to start decoding.': '請為 {roles} 選擇通道，才能開始解碼。',
  'Remove decoder': '移除解碼器',

  // ---- decoded results (IS-6) ----
  '{shown} of {n}': '{shown} / {n}',
  'Search (e.g. NACK, 0x50)': '搜尋（例如 NACK、0x50）',
  'Search the decoded results': '搜尋解碼結果',
  'Close decoded results': '關閉解碼結果',
  Time: '時間',
  Decoder: '解碼器',
  Content: '內容',
  Status: '狀態',
  'Error|decode': '錯誤',
  'Decoding the recording…': '正在解碼記錄…',
  'Nothing decoded yet — run the simulation, or check the decoder’s channels.':
    '還沒有解碼結果——請執行模擬，或檢查解碼器的通道。',
  'No result matches “{q}”.': '沒有符合「{q}」的結果。',
  'Show this frame in the waveform': '在波形中顯示這個訊框',
  'Showing the newest results only.': '只列出最新的結果。',

  // ---- channel picker + buses (IS-7) ----
  'Buses (channels + decoder)': '匯流排（通道＋解碼器）',
  'Pins in use': '使用中的腳位',
  Nets: '網路',
  wired: '已接線',
  '{id} all pins': '{id} 全部腳位',
  '{prefix}{bus} ({pins}) + {decoder} decoder {format}': '{prefix}{bus}（{pins}）＋ {decoder} 解碼器 {format}',
  '{prefix}{bus} ({pins}) + {decoder} decoder': '{prefix}{bus}（{pins}）＋ {decoder} 解碼器',
  '{bus} is already on the logic analyzer ({pins})': '{bus} 已在邏輯分析儀上（{pins}）',
  'Added {bus}: {pins} and the {decoder} decoder ({format})': '已加入 {bus}：{pins} 與 {decoder} 解碼器（{format}）',
  'Added {bus}: {pins} and the {decoder} decoder': '已加入 {bus}：{pins} 與 {decoder} 解碼器',

  // ---- scope probes (IS-4) ----
  '{id} → CH{n}': '{id} → CH{n}',
  '{id} → CH{n} — all four channels are in use, so it shares CH{n} with {other}':
    '{id} → CH{n}：四個通道都在使用中，它和 {other} 共用 CH{n}',

  // ---- oscilloscope (IS-2, IS-8) ----
  'Auto setup': '自動設定',
  'Auto setup: 2–3 periods on screen, automatic V/div, trigger on the rising edge at 50 %':
    '自動設定：畫面顯示 2–3 個週期、自動 V/格、在 50 % 準位的上升緣觸發',
  'Auto setup: {tdiv}, trigger CH{n} ↑': '已自動設定：{tdiv}、觸發 CH{n} ↑',
  'No scope probe in the circuit — place one on the net you want to see.':
    '電路中沒有示波器探棒——請在想看的網路上放一支探棒。',
  'No samples yet — press ▶ Run simulation first, then Auto setup.': '還沒有取樣——請先按「▶ 執行模擬」，再按「自動設定」。',
  'No repeating signal found on the probes — V/div set to auto, timebase unchanged.':
    '探棒上沒有找到週期訊號——已改為自動 V/格，時基不變。',
  'Timebase too slow to measure frequency — press “Auto setup”': '時基太慢，無法量頻率——按「自動設定」',
  'No complete cycle in the window — press “Auto setup”': '視窗內不到一個完整週期——按「自動設定」',
  'Too few samples (1 kHz backup feed) to measure frequency': '取樣不足（1 kHz 備援資料），無法量頻率',
  '(digital, exact)': '（數位精確）',
  'From the exact edges the logic analyzer records on this net': '由邏輯分析儀在這個網路上記錄的精確邊緣計算',
  'Cursors: drag a line, or pick one with A / B and move it with the arrow keys': '游標：拖曳線條，或按 A／B 選一條、再用方向鍵移動',
  'Absolute time': '絕對時間',
  'Label the time axis with the simulation clock (the logic analyzer’s time)': '時間軸改用模擬時鐘標示（與邏輯分析儀相同）',

  // ---- UART terminal + simulation log (IS-8) ----
  'Show when each line arrived (simulation time, to the resolution of the frame that delivered it)':
    '顯示每一行收到的模擬時間（精確度取決於模擬畫面更新的間隔）',
  'Clear on load': '載入時清除',
  'Clear this board’s transcript when new firmware is loaded (otherwise a separator line marks the load)':
    '載入新韌體時清除這塊板子的終端機內容（不勾選則插入一條分隔線）',
  '── {time} · {id} loaded {file} ({sha}) · reset ──': '── {time} · {id} 載入 {file}（{sha}）· 重置 ──',
  '── {time} · {id} reset ──': '── {time} · {id} 重置 ──',
  'Show in logic analyzer': '在邏輯分析儀中檢視',
  'Centre the logic analyzer on this line’s bytes on the TX wire, marker A on the first start bit':
    '把邏輯分析儀對準這一行在 TX 線上的波形，A 標記放在第一個起始位元',
  'Centre the logic analyzer on this moment, marker A on it': '把邏輯分析儀對準這個時間點，並放上 A 標記',
  'Showing when this line arrived (the TX pin is not readable on the analyzer)':
    '已顯示這一行收到的時段（邏輯分析儀讀不到 TX 腳的波形）',
  '{pin} was not on the logic analyzer, so this line cannot be shown — added it: lines from now on can be.':
    '{pin} 不在邏輯分析儀上，無法回看這一行——已加入 {pin}，之後收到的行就能檢視。',
  '{pin} was not on the logic analyzer': '{pin} 不在邏輯分析儀上',

  // ---- instrument tray (IS-9) ----
  'Restore the layout': '還原版面',
  'Analysis layout: a big instrument tray, side panels folded': '分析版面：放大儀器匣、收合兩側面板',
}

export default zh
