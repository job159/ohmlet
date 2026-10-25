/**
 * zh-TW — 效能診斷 (performance diagnostics): the More-sheet switch and the
 * overlay (src/ui/perf/PerfOverlay.tsx, src/ui/perf/view.ts).
 *
 * Reused, not redefined here: 'Real time' → 模擬速度 (the MCU panel's
 * word for the speed factor, embedded.ts), 'Simulation' → 模擬 and
 * 'Graphics' → 圖形 (sheets.ts); the board states come from the MCU panel
 * (mcuStateLabel) and speeds from the shared formatter (「1.0 倍速」).
 * Taiwan usage: 執行緒、記憶體、顯示卡、貼圖、介面; no English words in
 * labels or hover texts (MIPS stays as the unit of a figure).
 */
const dict: Record<string, string> = {
  // ---- More sheet → 設定
  'Performance diagnostics': '效能診斷',
  'Frame rate, simulation speed and each board’s MIPS in a corner of the 3D view':
    '在 3D 畫面的角落顯示畫面更新率、模擬速度與每塊板子的指令執行速度',

  // ---- overlay frame
  'Show the figures': '展開詳細數字',
  'Fold to the summary line': '收合成一行摘要',
  'Not enough room beside the circuit — enlarge the window or close a side panel to see the figures':
    '電路旁的空間不夠——放大視窗或收合側邊面板後即可展開數字',
  'Turn off performance diagnostics': '關閉效能診斷',
  'Averages over the last 2 s, refreshed twice a second': '近 2 秒的平均值，每秒更新兩次',

  // ---- 畫面
  Rendering: '畫面',
  'Frame rate': '畫面更新率',
  '{n} fps': '每秒 {n} 張',
  'How often the browser shows a new frame of the 3D view': '瀏覽器每秒顯示幾張新的 3D 畫面',
  'Frame time': '每張畫面時間',
  '{typical}, slowest {slow}': '{typical}，最慢 {slow}',
  'Time between two frames: the typical one and the slowest 5 %': '兩張畫面之間相隔的時間：一般情況，以及最慢的 5 %',
  '3D CPU time per frame': '3D 每張 CPU 時間',
  'Main-thread time the 3D view spends preparing one frame (camera, effects, draw submission)':
    '3D 畫面準備一張畫面所用的主執行緒時間（鏡頭、特效、送出繪製）',
  'Draw calls per frame': '每張繪製呼叫',
  '{calls} calls · {tris} triangles': '{calls} 次 · 三角形 {tris} 個',
  'Draw calls and triangles of the newest frame, every render pass included':
    '最新一張畫面的繪製呼叫次數與三角形數量（包含所有繪製階段）',
  'GPU resources': '顯示卡資源',
  '{geo} geometries · {tex} textures': '幾何體 {geo} 個 · 貼圖 {tex} 張',
  'Geometries and textures the renderer currently holds on the graphics card': '繪圖器目前放在顯示卡上的幾何體與貼圖數量',
  'Software rendering (no graphics card)': '軟體繪圖（沒有使用顯示卡）',
  'WebGL runs on the CPU here ({renderer}): frame figures do not represent a computer with a graphics card':
    '這裡的 WebGL 由 CPU 執行（{renderer}）：畫面的數字不代表有顯示卡的電腦',

  // ---- 介面
  Interface: '介面',
  'React updates': '介面重繪',
  'React commits per second (every interface re-render that reached the page)': '每秒有幾次介面重繪真正更新到頁面上',
  'Interface updates': '頁面更新',
  'Page change batches per second — counted from DOM changes because this browser gives React no commit hook':
    '每秒的頁面變更批次——這個瀏覽器沒有提供重繪通知，因此改以頁面元素的變更計算',
  '{n} per second': '每秒 {n} 次',
  'Main-thread long tasks': '主執行緒長任務',
  'Share of time the main thread was stuck in tasks of 50 ms or more — lower is smoother':
    '主執行緒被 50 ms 以上的工作卡住的時間比例——越低越流暢',
  'This browser does not report long tasks': '這個瀏覽器不提供長任務資訊',
  'JS memory': 'JS 記憶體',
  'JavaScript memory in use on this page': '這個頁面使用中的 JavaScript 記憶體',
  'This browser does not report memory use': '這個瀏覽器不提供記憶體用量',

  // ---- 模擬
  'Start the simulation to see its figures': '按「執行模擬」後顯示模擬的數字',
  'Simulated time per wall-clock second over the last second': '最近 1 秒內，每 1 秒實際時間模擬了多少時間',
  'Analog steps': '類比求解步數',
  '{n} steps per second': '每秒 {n} 步',
  'Circuit-solver time steps per wall-clock second': '電路求解器每秒（實際時間）完成的時間步數',
  'Simulation thread load': '模擬背景執行緒負載',
  'Simulation load (main thread)': '模擬負載（主執行緒）',
  'This browser could not start the simulation thread: the simulation shares the main thread with the interface':
    '這個瀏覽器無法啟動模擬背景執行緒：模擬與介面共用主執行緒',
  'Share of each second the simulation thread spends computing (100 % = it cannot go faster)':
    '模擬背景執行緒每秒花在計算上的時間比例（100 % 表示已經無法更快）',
  'Simulation data': '模擬結果傳送',
  '{rate} · {ms} each': '{rate} · 每次 {ms}',
  'Results the simulation sends to the page per second, and the main-thread time to show each one':
    '模擬每秒送到頁面的結果次數，以及主執行緒顯示每一筆所花的時間',
  '3D part refresh': '3D 元件更新',
  '{applied} refreshed · {skipped} unchanged · {ms}': '更新 {applied} 個 · 略過 {skipped} 個 · {ms}',
  'Per simulation result: parts whose look changed and were redrawn, parts skipped as unchanged, and the time it took':
    '每一筆模擬結果中：外觀改變而重繪的元件數、沒有變化而略過的元件數，以及所花的時間',
  '{mips} MIPS · {mhz}': '{mips} MIPS · {mhz}',
  'Instructions this board executes per wall-clock second (million), and the simulated core cycles per second':
    '這塊板子每秒（實際時間）執行幾百萬條指令，以及每秒模擬的核心時脈週期',

  // ---- QA clarity PERF-ORDER-VERDICT: the answer to 「為什麼慢？」 first ----
  'Simulation at {speed}: the simulation thread is fully loaded ({load}) — the computer cannot compute faster; the picture is not what is slow':
    '模擬 {speed}：模擬執行緒已滿載（{load}）——是電腦算不夠快，不是畫面卡',
  'the computer cannot compute faster': '電腦算不夠快',
  'Fewer than 30 frames a second: the 3D view is heavy — choose “Performance” under More → Settings → Render mode':
    '畫面每秒不到 30 張：3D 太重，可在「更多 → 設定 → 算繪模式」改選「效能」',
  'the 3D view is heavy': '3D 太重',
  'Simulation at {speed} while its thread is not fully loaded ({load}): the page’s main thread holds it back — see Rendering and Interface below':
    '模擬 {speed}，但模擬執行緒沒有滿載（{load}）：是頁面的主執行緒拖慢了它——請看下方的「畫面」與「介面」',
  'the main thread is busy': '主執行緒忙不過來',
  'All fine: the simulation keeps up with real time': '一切正常：模擬跟得上真實時間',
  'All fine: the picture is smooth (the simulation is not running)': '一切正常：畫面順暢（模擬沒有在執行）',
  'all fine': '一切正常',
}

export default dict
