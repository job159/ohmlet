/**
 * zh-TW strings of the UX-wave contract modules (docs/ux/UX_REVIEW.md §6.4):
 * pin display names (src/i18n/parts.ts pinDisplayName), the hover chip
 * (src/ui/workspace/hole-chip.ts), probe actions + the probe menu
 * (src/ui/embedded/probe-actions.ts, src/ui/workspace/ProbeMenu.tsx), the
 * problems store + list (src/ui/embedded/problems.ts, ProblemsList.tsx) and
 * openExampleById (src/ui/workspace/examples.ts).
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage: 韌體、程式、檔案、電源軌、孔位、檢視、偵錯器。
 */
const zh: Record<string, string> = {
  // ---- pin display names (pinDisplayName, K11) ----
  '{pin} (board label {silk})': '{pin}（板上 {silk}）',
  'anode (long lead)': '陽極（長腳）',
  'cathode (short lead)': '陰極（短腳）',
  'cathode (banded end)': '陰極（色環端）',
  'lead {n}': '第 {n} 腳',
  'positive terminal': '正端',
  'negative terminal': '負端',
  'terminal {pin}': '{pin} 端',

  // ---- hover chip (holeChipText, K5) ----
  'top + rail': '上方 + 電源軌',
  'top − rail': '上方 − 電源軌',
  'bottom + rail': '下方 + 電源軌',
  'bottom − rail': '下方 − 電源軌',
  '{rail} · hole {n} ({ref})': '{rail} · 第 {n} 孔（{ref}）',
  '{hole} → same strip: {names}': '{hole} → 同一排：{names}',
  ', ': '、',

  // ---- probe actions (K7) ----
  '{target} was not found in the circuit': '電路中找不到 {target}',
  '{label} is already on the logic analyzer (channel D{n})': '{label} 已在邏輯分析儀（通道 D{n}）',
  'All 16 logic analyzer channels are in use — remove one first': '邏輯分析儀的 16 個通道都在使用中，請先移除一個',
  'Added {label} to the logic analyzer': '已加入邏輯分析儀：{label}',
  'Added {label} to the logic analyzer — open Instruments to see it': '已加入邏輯分析儀：{label}——到「儀器」查看',
  'All four scope channels are in use — move or remove a probe first': '四個示波器通道都在使用中，請先移動或移除一支探棒',
  '{target} is not wired to the breadboard, so a probe cannot reach it': '{target} 沒有接到麵包板，探棒接不到',
  'The net of {hole} has no free hole — free a hole on its strip, or wire the net to an empty strip':
    '{hole} 所在的網路已經沒有空孔：請空出同一排的一個孔位，或用導線把這個網路接到空的一排',
  'The strip of {target} is full — placed the scope probe at {hole} on the same net (CH{n})':
    '{target} 這一排沒有空孔，已改放在同一個網路的 {hole}（CH{n}）',
  'Couldn’t place a scope probe at {hole}': '無法在 {hole} 放示波器探棒',
  'Placed a scope probe on the {rail} (CH{n})': '已在{rail}放示波器探棒（CH{n}）',
  'Placed a scope probe on the strip of {hole} (CH{n})': '已在 {hole} 這一排放示波器探棒（CH{n}）',

  // ---- probe menu (K6) ----
  'Measure {what}': '量測 {what}',
  'Add to logic analyzer': '加入邏輯分析儀',
  'Place a scope probe': '放示波器探棒',
  'Place a scope probe (CH{n})': '放示波器探棒（CH{n}）',
  'Select the parts connected here': '選取接在這裡的元件',
  'Nothing else is connected to this point yet': '這裡還沒有接任何元件',
  'Show this pin in the inspector': '在屬性面板查看這支腳',

  // ---- problems (K3) ----
  '{id} has no firmware yet': '{id} 還沒有韌體',
  'This board has no program to run. Pick a built-in firmware (for example hal-blink) or load an .elf / .bin / .hex file from your computer.':
    '這塊板子沒有可以執行的程式。請選擇內建韌體（例如 hal-blink），或從電腦載入 .elf／.bin／.hex 檔案。',
  'Load firmware…': '載入韌體…',
  '{id} fault (lockup)': '{id} 故障（鎖死）',
  'The core hit a fault while handling a fault and stopped. Common causes: no vector table at 0x08000000, or a bad stack pointer.':
    '核心在處理錯誤時又發生錯誤而停止。常見原因：0x08000000 沒有向量表，或堆疊指標錯誤。',
  'See why': '查看原因',
  '{id} core halted (debugger)': '{id} 核心已停住（偵錯器）',
  'The debugger stopped the core, so the whole simulation is frozen. Resume to keep running.':
    '偵錯器停住了核心，整個模擬也隨之暫停。按「繼續執行」即可繼續。',
  'Resume running': '繼續執行',
  '{id} boots from system memory (not simulated)': '{id} 從系統記憶體開機（未模擬）',
  'BOOT0 = 1: the MCU starts the built-in bootloader, which is not simulated. Set the BOOT0 jumper back to 0, then press Reset MCU.':
    'BOOT0 = 1：MCU 從內建開機程式啟動，這部分沒有模擬。請把 BOOT0 跳線設回 0，再按「重置 MCU」。',
  '{id} has no power': '{id} 沒有供電',
  'VDD is below 2.0 V, so the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.':
    'VDD 低於 2.0 V，MCU 停在重置。請把 5V 或 3V3 腳接到電源，並把 G 腳接到 − 電源軌。',

  // ---- problems list (ProblemsList.tsx) ----
  'Problems ({n})': '問題（{n}）',
  'Error|problem': '錯誤',
  'Warning|problem': '風險',
  'Info|problem': '提示',
  'Show on the board': '在電路板上標示',
  'Show {what} on the board': '在電路板上標示「{what}」',

  // ---- examples by id (openExampleById, K10) ----
  'Example “{id}” was not found': '找不到範例「{id}」',
}
export default zh
