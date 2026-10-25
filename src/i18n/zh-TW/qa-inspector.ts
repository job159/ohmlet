/**
 * zh-TW strings of the release-QA fixes of the inspector area (IN-F1 … IN-F8):
 * a core stuck in its fault handler (the MCU badge, the problem row and its
 * decoded CFSR / BFAR cause), board states that are not risks (「目前狀態」),
 * runtime rows that the wiring does not prove, one place for a board-state
 * sentence (「見下方執行狀態」), off-board terminal locations and the
 * 「對調兩腳」 answer. On-board element names live in embedded.ts.
 * The clarity round adds the register grid in words (ipsr 「3（HardFault）」,
 * mmfar 「—（無效）」), the known cause of a lockup with its one-click fix and
 * 「韌體目前的設定」 in the 周邊 tab.
 * Keys are the English sources passed to t() / tc() ("source|context").
 * Taiwan usage (UX_VERIFY.md §5.4): 韌體、程式、處理常式、暫存器、模擬日誌、
 * 執行、電源軌、在電路板上標示、還沒有韌體。
 */
const zh: Record<string, string> = {
  // ---- a core in its own fault handler (format.ts / problems.ts / McuPanel — IN-F7) ----
  'In a fault handler|mcu-state': '在故障處理常式中',
  'A fault exception is active (IPSR 3–6): the core runs the fault handler instead of the program (ARMv7-M ARM, fault handling)':
    '故障例外正在處理中（IPSR 3–6）：核心執行的是故障處理常式，而不是程式本身（ARMv7-M ARM，故障處理）',
  'In the {fault} handler': '在 {fault} 處理常式中',
  ' (pc {pc})': '（pc {pc}）',
  'Precise BusFault: the access to {addr} failed': '精確 BusFault：存取 {addr} 時出錯',
  'Precise BusFault: a data access failed': '精確 BusFault：資料存取出錯',
  'MemManage: access to {addr} not allowed': 'MemManage：不允許存取 {addr}',
  'MemManage: data access violation': 'MemManage：資料存取違規',
  'HardFault: a fault escalated to HardFault': 'HardFault：其他故障升級成 HardFault',
  '{kind}: {cause}': '{kind}：{cause}',
  '{text}.': '{text}。',
  'The core is in {handler} (the default handler is an endless loop), so the program does not go on.':
    '核心停在 {handler}（預設的處理常式是無窮迴圈），程式不會再往下執行。',
  '{id} hit a {fault} — the firmware is stuck in {handler}': '{id} 發生 {fault}——韌體停在 {handler}',
  'See the registers': '查看暫存器',
  // what usually sets a fault bit — the next thing to check (format.ts FAULT_HINTS)
  'Common cause: a pointer to an address where nothing is (an uninitialised or miscalculated pointer).':
    '常見原因：指標指向不存在的位址（沒有初始化或算錯的指標）。',
  'Common cause: a write through a pointer to an address where nothing is (writes are buffered, so the pc shown is past the store).':
    '常見原因：透過指標寫入不存在的位址（寫入有緩衝，所以顯示的 pc 已在寫入指令之後）。',
  'Common cause: a jump to an address with no program (a wrong function pointer, or a return address overwritten on the stack).':
    '常見原因：跳到沒有程式的位址執行（函式指標錯誤，或堆疊上的返回位址被覆寫）。',
  'Common cause: a jump into a region that cannot run code (peripherals or the system area), usually a wrong function pointer.':
    '常見原因：跳到不能執行程式的區域（周邊或系統區），通常是函式指標錯誤。',
  'Common cause: the stack ran out (a stack overflow past the end of RAM).': '常見原因：堆疊用盡（堆疊溢位，超出 RAM 範圍）。',
  'Common cause: the stack was overwritten (for example a local array written past its end).':
    '常見原因：堆疊內容被覆寫（例如區域陣列寫超過範圍）。',
  'Common cause: a jump to an address that holds no code (a wrong function pointer), or data run as instructions.':
    '常見原因：跳到不是程式碼的位址執行（函式指標錯誤），或把資料當成指令執行。',
  'Common cause: a jump to an even address (Thumb bit clear), for example a function pointer without |1.':
    '常見原因：跳到偶數位址（Thumb 位元為 0），例如函式指標少了 |1。',
  'Common cause: the exception return value (LR) was corrupted, usually because the stack was overwritten.':
    '常見原因：例外返回值（LR）被破壞，通常是堆疊被覆寫。',
  'Common cause: the firmware uses floating-point unit (FPU) instructions, but the Cortex-M3 has no FPU; build it with software floating point.':
    '常見原因：韌體用了浮點運算器（FPU）的指令，但 Cortex-M3 沒有浮點運算器；請改用軟體浮點編譯。',
  'Check that the divisor is not 0 before dividing (the firmware turned on the divide-by-zero trap).':
    '除法前請先檢查除數是否為 0（韌體開啟了除以零陷阱）。',
  'Common cause: a byte array cast to a 32-bit pointer and read at an unaligned address (the firmware turned on the unaligned-access trap).':
    '常見原因：把位元組陣列轉型成 32 位元指標後，在未對齊的位址存取（韌體開啟了未對齊存取陷阱）。',
  'Common cause: no vector table where VTOR points (for example the image is not at 0x08000000).':
    '常見原因：VTOR 指向的位置沒有向量表（例如映像檔沒有放在 0x08000000）。',

  // ---- board states are not risks; runtime rows (ErcPanel / ProblemsList — IN-F3) ----
  'Current state|problem': '目前狀態',
  'Runtime state: reported by the chip in the simulation': '執行時狀態：由模擬中的晶片回報',
  'See the execution state below': '見下方執行狀態',
  'No other problems found ({id}: see its execution state above)': '沒有發現其他問題（{id} 的狀態見上方「執行狀態」）',
  'what a board is doing right now (e.g. the debugger halted its core) — not counted as a problem':
    '開發板此刻的狀態（例如偵錯器停住了核心），不算是問題',
  'Rows the running chip or the simulator reports are runtime states, not conclusions from the wiring.':
    '由執行中的晶片或模擬器回報的項目是執行時狀態，不是從接線推論出的結論。',

  // ---- a floating MCU pin folded under its gpio-mode finding (problems.ts — IN-F2) ----
  '{n} more related': '另 {n} 個相關',

  // ---- 「對調兩腳」 answers (problems.ts — IN-F8) ----
  'Swapped the leads of {id}': '已對調 {id} 的兩腳',
  'Could not swap the leads of {id}': '無法對調 {id} 的兩腳',

  // ---- where an off-board terminal's wire goes (PartInfo / PropertiesSheet — IN-F4) ----
  'not wired|terminal': '未接線',
  '→ {where}': '→ {where}',
  '{first} and {n} more places': '{first} 等 {n} 處',

  // ---- the register grid in words (McuPanel RegisterRows / format.ts — QA clarity GLOSSARY-ENTRIES) ----
  'normal program|ipsr': '一般程式',
  'reserved|ipsr': '保留',
  '{name} interrupt': '{name} 中斷',
  '{n} ({name})|ipsr': '{n}（{name}）',
  '— (not valid)|fault-address': '—（無效）',
  'Not valid: CFSR.MMARVALID (bit 7) is 0, so MMFAR holds no fault address': '無效：CFSR.MMARVALID（位元 7）為 0，MMFAR 裡不是故障位址',
  'Not valid: CFSR.BFARVALID (bit 15) is 0, so BFAR holds no fault address': '無效：CFSR.BFARVALID（位元 15）為 0，BFAR 裡不是故障位址',

  // ---- why the core locked up, and the fix (format.ts lockupCauseText / McuPanel — QA clarity LOCKUP-CAUSE) ----
  '{file} is loaded at {addr}, so there is no vector table at 0x08000000 and the core faults as soon as it starts.':
    '{file} 載入在 {addr}，所以 0x08000000 沒有向量表，核心一開機就出錯。',
  '{file} puts nothing at 0x08000000, so there is no vector table there and the core faults as soon as it starts.':
    '{file} 沒有放到 0x08000000，所以那裡沒有向量表，核心一開機就出錯。',
  'The first word of {file}’s vector table (the initial stack pointer {sp}) is not inside SRAM (0x20000000–0x20005000), so the core faults as soon as it starts.':
    '{file} 向量表的第一個值（初始堆疊指標 {sp}）不在 SRAM（0x20000000–0x20005000）裡，所以核心一開機就出錯。',
  'The reset vector of {file} ({addr}) has the Thumb bit clear, so the core faults as soon as it starts.':
    '{file} 的重置向量（{addr}）Thumb 位元是 0，所以核心一開機就出錯。',
  'The reset vector of {file} ({addr}) does not point into flash, so the core faults as soon as it starts.':
    '{file} 的重置向量（{addr}）沒有指向快閃記憶體，所以核心一開機就出錯。',
  'Reload at 0x08000000': '改用 0x08000000 重新載入',
  'The bytes of {file} are no longer available — choose the file again and load it at 0x08000000.':
    '已經找不到 {file} 的內容——請重新選擇這個檔案，並載入到 0x08000000。',
  // the capsule in the pill's words, with the pill's target (「查看原因」)
  '{id} fault (lockup) — see why': '{id} 故障（鎖死）——查看原因',

  // ---- 韌體目前的設定 (McuPanel FirmwareSetupGroup / mcu-setup.ts — QA clarity PERIPH-LIVE-CONFIG) ----
  'What the firmware set up': '韌體目前的設定',
  'Load a firmware and run it: its serial ports, buses, PWM outputs and analog inputs are listed here.':
    '載入韌體並執行後，這裡會列出它設定的序列埠、匯流排、PWM 輸出與類比輸入。',
  'Press “▶ Run simulation”: the serial ports, buses, PWM outputs and analog inputs the firmware sets up are listed here.':
    '按「▶ 執行模擬」後，這裡會列出韌體設定的序列埠、匯流排、PWM 輸出與類比輸入。',
  'The firmware uses no peripheral with pins of its own — every pin it uses is a plain GPIO.':
    '韌體沒有使用帶腳位的周邊——它用到的腳位都是一般 GPIO。',
  'See the pins': '查看腳位',
  'Also switched on: {list}': '另外也開啟了：{list}',
  'clock on, not enabled yet': '已開啟時脈，尚未啟用',
  ' / |pins': '／',
  ' (remapped)': '（重映射）',
  'remapped to pins this board does not bring out': '已重映射到這塊板子沒有引出的腳位',
  '{ch} → {pin} (PWM)': '{ch} → {pin}（PWM）',
  '{ch} ← {pin}': '{ch} ← {pin}',
  'no channel drives a pin (it only counts or keeps time)': '沒有通道輸出到腳位（只用來計時或計數）',
  'no analog input pin set up yet': '還沒有設定類比輸入腳位',
  'Open the UART terminal': '開啟 UART 終端機',
  'Add to logic analyzer (with decoder)': '加入邏輯分析儀（含解碼器）',
}
export default zh
