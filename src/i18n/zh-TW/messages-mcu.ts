/**
 * zh-TW runtime messages of the MCU layer (see ../messages.ts): the
 * Cortex-M3 core and its system control space, the firmware loaders
 * (ELF / Intel HEX / raw binary), the STM32F103 SoC and every peripheral's
 * log messages, BusFault reasons — and the PERIPHERAL SUPPORT NOTES
 * (src/mcu/stm32f1/peripherals.ts, *_NOTES, TIM_SUPPORT) as exact texts.
 *
 * Register / bit / pin names, RM0008 / DS5319 / PM0075 section references,
 * hex values and HAL function names are kept verbatim.
 */
import type { MessagePattern } from '../messages'
import { polishNotes, tpl, tr, translates } from './messages-core'

// ---------------------------------------------------------------------------
// fragments
// ---------------------------------------------------------------------------

/** FirmwareImage.format → zh (the "(bin)" of the flash-programming log line) */
const FORMAT_ZH: Record<string, string> = { elf: 'ELF', hex: 'Intel HEX', bin: '原始二進位檔' }

/** A firmware file name as the loader prints it: one line, ends with an extension ("blink.elf", "fw.dat"). */
function isFileName(s: string): boolean {
  return /^[^\n:;]+\.[A-Za-z0-9]{1,8}$/.test(s)
}

/** loader chunk origins: 'line 12', 'segment 0 (LMA 0x08000000)', or a file name */
function originZh(s: string): string {
  let m = /^line (\d+)$/.exec(s)
  if (m) return `第 ${m[1]} 行`
  m = /^segment (\d+) \(LMA (0x[0-9a-fA-F]+)\)$/.exec(s)
  if (m) return `區段 ${m[1]}（LMA ${m[2]}）`
  return s
}

const UNSUPPORTED_WHAT_ZH: Record<string, string> = {
  'The RTC': 'RTC',
  'The USB full-speed device': 'USB 全速裝置',
  'The shared USB/CAN packet SRAM': 'USB/CAN 共用封包 SRAM',
  bxCAN: 'bxCAN',
}

const USART_MODE_ZH: Record<string, string> = {
  'synchronous mode (CLKEN, CK pin)': '同步模式（CLKEN、CK 腳位）',
  'LIN mode (LINEN)': 'LIN 模式（LINEN）',
  'IrDA mode (IREN)': 'IrDA 模式（IREN）',
  'half-duplex mode (HDSEL)': '半雙工模式（HDSEL）',
  'smartcard mode (SCEN)': '智慧卡模式（SCEN）',
  'RTS/CTS hardware flow control (RTSE/CTSE)': 'RTS/CTS 硬體流量控制（RTSE/CTSE）',
  'mute mode / multiprocessor wake-up (RWU, WAKE)': '靜音模式／多處理器喚醒（RWU、WAKE）',
}

const RESET_KIND_ZH: Record<string, string> = {
  'power-on': '上電',
  NRST: 'NRST',
  'software (SYSRESETREQ)': '軟體（SYSRESETREQ）',
  IWDG: 'IWDG',
  WWDG: 'WWDG',
  LPWR: '低功耗（LPWR）',
}

/** core LOCKUP context */
const LOCKUP_WHERE_ZH: Record<string, string> = {
  'NMI handler': 'NMI 處理常式',
  'HardFault handler': 'HardFault 處理常式',
  'FAULTMASK set': 'FAULTMASK 已設定',
}

function excNameZh(s: string): string {
  const m = /^exception (\d+)$/.exec(s)
  return m ? `例外 ${m[1]}` : s
}

/** BusFault / memory region descriptions (memory.ts regionName) */
function regionZh(s: string): string {
  const m = /^(0x[0-9a-fA-F]+) \((.+)\)$/.exec(s)
  if (!m) return s
  const what: Record<string, string> = {
    'beyond the 20 KiB of SRAM': '超出 20 KiB SRAM',
    'beyond the mapped 128 KiB of flash': '超出已映射的 128 KiB 快閃記憶體',
    'reserved peripheral address': '保留的周邊位址',
    'FSMC region: no external memory controller on the STM32F103C8': 'FSMC 區域：STM32F103C8 沒有外部記憶體控制器',
    unmapped: '未映射',
  }
  return `${m[1]}（${what[m[2]] ?? m[2]}）`
}

/** RCC gating hint (soc.ts gated()): 'RCC_APB2ENR.IOPAEN = 0: GPIOA is not clocked, …' */
function gatedHintZh(s: string): string {
  const m = /^(RCC_\w+)\.(\w+) = 0: (\S+) is not clocked, so the access was ignored \(reads return 0\) — exactly what silicon does\. Enable its clock first: (\S+) or (\S+) \|= (\S+)\.$/.exec(s)
  if (!m) return tr(s)
  return `${m[1]}.${m[2]} = 0：${m[3]} 沒有時脈，因此這次存取被忽略（讀取傳回 0）——與實際晶片的行為相同。請先啟用它的時脈：${m[4]} 或 ${m[5]} |= ${m[6]}。`
}

/** decode.ts UNPREDICTABLE reasons — phrase table, longest first; mnemonics / registers stay */
const UNPRED_PHRASES: [RegExp, string][] = [
  [/^ADD\/SUB SP, SP, Rm with a shift other than LSL #0-3$/, 'ADD/SUB SP, SP, Rm 的移位不是 LSL #0-3'],
  [/^special data opcode 0100$/, '特殊資料處理運算碼 0100'],
  [/^IT condition$/, 'IT 條件'],
  [/^MSR mask$/, 'MSR 遮罩'],
  [/^CMP \(high registers\) operands$/, 'CMP（高暫存器）運算元'],
  [/^CPS with no I\/F bit$/, 'CPS 沒有指定 I/F 位元'],
  [/^modified immediate with imm8 = 0$/, '修改立即值的 imm8 = 0'],
  [/^misc operation with mismatched Rm copies$/, '雜項運算的兩份 Rm 不一致'],
  [/^long multiply with RdLo = RdHi$/, '長乘法的 RdLo = RdHi'],
  [/^(LDM|STM|PUSH|POP) with empty register list$/, '$1 的暫存器清單為空'],
  [/^(LDM|STM) register list$/, '$1 暫存器清單'],
  [/^LDM loading both PC and LR$/, 'LDM 同時載入 PC 與 LR'],
  [/^(LDM|STM) writeback with Rn in list$/, '$1 寫回且 Rn 在清單中'],
  [/^LDRD literal with writeback$/, 'LDRD literal 帶有寫回'],
  [/^(LDRD|STRD) writeback overlaps Rt$/, '$1 寫回與 Rt 重疊'],
  [/^(\S+) registers$/, '$1 暫存器'],
  [/^(\S+) with nonzero \(0\) bits$/, '$1 的 (0) 位元不為零'],
  [/^(\S+) with the \(0\) A bit set$/, '$1 的 (0) A 位元被設定'],
  [/^(.+) \((1|0|1\)\/\(0)\) bits?(?: set)?$/, '$1 的 ($2) 位元'],
  [/^(.+) \((1|0)\) bit (\d+)$/, '$1 的 ($2) 位元 $3'],
  [/^(.+) with the \(0\) bit (\d+) set$/, '$1 的 (0) 位元 $2 被設定'],
  [/^(.+) with (\S+ = \S+)$/, '$1，且 $2'],
  [/^(.+) with (SP\/PC) operand$/, '$1 使用 $2 運算元'],
  [/^(.+) operands?$/, '$1 運算元'],
]
const UNPRED_WORDS: [RegExp, string][] = [
  [/\bdata-processing \(immediate\)/, '資料處理（立即值）'],
  [/\bdata-processing \(register\)/, '資料處理（暫存器）'],
  [/\bplain-immediate data-processing/, '一般立即值資料處理'],
  [/\btest\/compare \(immediate\)/, '測試／比較（立即值）'],
  [/\btest\/compare \(register\)/, '測試／比較（暫存器）'],
  [/\bshift \(register\)/, '移位（暫存器）'],
  [/\bbyte\/halfword load to PC with writeback/, '位元組／半字組載入到 PC 並寫回'],
  [/\bbyte\/halfword load/, '位元組／半字組載入'],
  [/\bload register offset/, '暫存器偏移載入'],
  [/\bstore register offset/, '暫存器偏移儲存'],
  [/\bload writeback/, '載入寫回'],
  [/\bstore writeback/, '儲存寫回'],
  [/\bLDRT-class load/, 'LDRT 類載入'],
  [/\blong multiply/, '長乘法'],
  [/\bmultiply/, '乘法'],
  [/\bdivide/, '除法'],
  [/\bextend/, '延伸'],
  [/\bmisc operation/, '雜項運算'],
  [/\bsaturate\/bit-field/, '飽和／位元欄位'],
  [/\bhint\/barrier/, '提示／屏障'],
  [/\bbarrier/, '屏障'],
  [/\bhint/, '提示'],
  [/\bstore/, '儲存'],
]

export function unpredictableZh(s: string): string {
  for (const [re, zh] of UNPRED_PHRASES) {
    if (re.test(s)) {
      let out = s.replace(re, zh)
      for (const [w, z] of UNPRED_WORDS) out = out.replace(w, z)
      return out
    }
  }
  let out = s
  for (const [w, z] of UNPRED_WORDS) out = out.replace(w, z)
  return out
}

/** loader one-line descriptions (FirmwareImage.description) */
function elfFlagsZh(s: string): string {
  if (!s) return ''
  const flags = s
    .slice(2)
    .split(', ')
    .map((f) => (f === 'hard-float' ? '硬體浮點' : f === 'soft-float' ? '軟體浮點' : f))
  return `（${flags.join('、')}）`
}

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------

export const MESSAGES_ZH: MessagePattern[] = [
  // ------------------------------------------------------------- core / SCS
  tpl('reset: vector table at 0x00000000 is not readable («r»)', (g) => `重置：位於 0x00000000 的向量表無法讀取（${tr(g.r)}）`),
  tpl(
    'reset: initial SP «a» is not word aligned; SP_main[1:0] are RAZ, so SP = «b»',
    (g) => `重置：初始 SP ${g.a} 未對齊字組；SP_main[1:0] 讀為零（RAZ），因此 SP = ${g.b}`,
  ),
  tpl('reset vector «a» has bit 0 clear: the first instruction raises INVSTATE', (g) => `重置向量 ${g.a} 的位元 0 為 0：第一道指令就會引發 INVSTATE`),
  tpl('setIrqLine: IRQ «n» does not exist (numIrq = «m»)', (g) => `setIrqLine：IRQ ${g.n} 不存在（numIrq = ${g.m}）`),
  tpl('setRegister: no register r«n»', (g) => `setRegister：沒有暫存器 r${g.n}`),
  tpl('instruction fetch from execute-never address «a» → MemManage IACCVIOL', (g) => `從禁止執行的位址 ${g.a} 擷取指令 → MemManage IACCVIOL`),
  tpl(
    'UNPREDICTABLE instruction «e» at «a» («why»); executed per the ARM ARM pseudocode',
    (g) => `位於 ${g.a} 的 UNPREDICTABLE 指令 ${g.e}（${unpredictableZh(g.why)}）；依 ARM ARM 虛擬碼執行`,
  ),
  tpl(
    'core LOCKUP: «x» at «a» while executing at priority «p» («w»); CFSR=«c» HFSR=«h»',
    (g) => `核心鎖死（LOCKUP）：在優先權 ${g.p}（${LOCKUP_WHERE_ZH[g.w] ?? g.w}）執行時於 ${g.a} 發生 ${excNameZh(g.x)}；CFSR=${g.c} HFSR=${g.h}`,
  ),
  tpl('BKPT #«n» at «a»: core halted', (g) => `${g.a} 處的 BKPT #${g.n}：核心已停止`),
  tpl('instruction fetch BusFault at «a»: «r»', (g) => `在 ${g.a} 擷取指令時發生 BusFault：${tr(g.r)}`),
  tpl(
    'precise BusFault: «d=write to|read from» «a» at pc «pc» («r»)',
    (g) => `精確 BusFault：在 pc ${g.pc} ${g.d === 'write to' ? '寫入' : '讀取'} ${g.a}（${tr(g.r)}）`,
  ),
  tpl('BusFault while stacking an exception frame at «a» (STKERR)', (g) => `在 ${g.a} 堆疊例外框架時發生 BusFault（STKERR）`),
  tpl('vector table read for exception «n» at «a» failed: «r»', (g) => `讀取例外 ${g.n} 的向量表（位於 ${g.a}）失敗：${tr(g.r)}`),
  tpl(
    'EXC_RETURN «a» has bits[27:4] not all ones (UNPREDICTABLE); decoded by bits[3:0]',
    (g) => `EXC_RETURN ${g.a} 的位元 [27:4] 並非全為 1（UNPREDICTABLE）；依位元 [3:0] 解碼`,
  ),
  tpl('BusFault while unstacking an exception frame at «a» (UNSTKERR)', (g) => `在 ${g.a} 取回例外框架時發生 BusFault（UNSTKERR）`),
  tpl('exception return to an odd address «a» (UNPREDICTABLE); bit 0 ignored', (g) => `例外返回到奇數位址 ${g.a}（UNPREDICTABLE）；忽略位元 0`),
  tpl('exception return with EPSR.ICI = «n»: the multiple load/store restarts', (g) => `例外返回時 EPSR.ICI = ${g.n}：多重載入／儲存指令重新開始`),
  tpl(
    'exception return: stacked IPSR «n» does not match EXC_RETURN «a» (INVPC)',
    (g) => `例外返回：堆疊中的 IPSR ${g.n} 與 EXC_RETURN ${g.a} 不符（INVPC）`,
  ),
  tpl('illegal exception return «a» from exception «n» (INVPC)', (g) => `從例外 ${g.n} 的非法例外返回 ${g.a}（INVPC）`),
  tpl(
    'PPB register 0x«a» is not implemented («w=write ignored|reads as 0»)',
    (g) => `PPB 暫存器 0x${g.a} 未實作（${g.w === 'write ignored' ? '寫入已忽略' : '讀為 0'}）`,
  ),

  // ---------------------------------------------------------------- loaders
  // "<file>: <message>" (loader fail(), SoC programming errors joined by '; ')
  tpl(
    '«f»: «m*»',
    (g) => {
      const body = translates(g.m) ? tr(g.m) : g.m.split('; ').map(tr).join('；')
      // "第 2 行：…" reads as part of the file reference
      return `${g.f}${body.startsWith('第 ') ? ' ' : '：'}${body}`
    },
    (g) => isFileName(g.f) && (translates(g.m) || g.m.split('; ').every(translates)),
  ),
  tpl('truncated ELF: «n#» bytes, the identification block alone is 16', (g) => `ELF 檔不完整：只有 ${g.n} 個位元組，光是識別區塊就需要 16 個`),
  tpl('invalid ELF class EI_CLASS=«n» (expected 1 = ELF32)', (g) => `無效的 ELF 類別 EI_CLASS=${g.n}（應為 1 = ELF32）`),
  tpl('invalid ELF data encoding EI_DATA=«n» (expected 1 = little-endian)', (g) => `無效的 ELF 資料編碼 EI_DATA=${g.n}（應為 1 = 小端序）`),
  tpl('truncated ELF: «n#» bytes, the ELF32 header is 52', (g) => `ELF 檔不完整：只有 ${g.n} 個位元組，ELF32 標頭需要 52 個`),
  tpl(
    'built for «m» (e_machine=«n»), not ARM (e_machine=40) — this is not STM32 firmware',
    (g) => `此檔案是為 ${machineZh(g.m)} 建置（e_machine=${g.n}），不是 ARM（e_machine=40）——這不是 STM32 韌體`,
  ),
  tpl('unsupported ELF type «n» (expected ET_EXEC)', (g) => `不支援的 ELF 類型 ${g.n}（應為 ET_EXEC）`),
  tpl('invalid program header size e_phentsize=«n» (ELF32 needs 32)', (g) => `無效的程式標頭大小 e_phentsize=${g.n}（ELF32 需要 32）`),
  tpl(
    'truncated ELF: program header table («a»×«b» bytes at offset «c») extends past the end of the file («d» bytes)',
    (g) => `ELF 檔不完整：程式標頭表（${g.a}×${g.b} 位元組，位於偏移 ${g.c}）超出檔案結尾（檔案 ${g.d} 位元組）`,
  ),
  tpl(
    'truncated ELF: segment «n» («a» bytes at file offset «b») extends past the end of the file («c» bytes)',
    (g) => `ELF 檔不完整：區段 ${g.n}（${g.a} 位元組，位於檔案偏移 ${g.b}）超出檔案結尾（檔案 ${g.c} 位元組）`,
  ),
  tpl('segment «n»: p_memsz («a») < p_filesz («b»)', (g) => `區段 ${g.n}：p_memsz（${g.a}）< p_filesz（${g.b}）`),
  tpl(
    'section header table out of bounds (offset «a», «b»×«c»): symbols skipped',
    (g) => `區段標頭表超出範圍（偏移 ${g.a}，${g.b}×${g.c}）：已略過符號`,
  ),
  tpl('entry point «a» has the Thumb bit clear: Cortex-M only executes Thumb code', (g) => `進入點 ${g.a} 的 Thumb 位元為 0：Cortex-M 只能執行 Thumb 程式碼`),
  tpl('«w»: data after the end-of-file record ignored', (g) => `${originZh(g.w)}：檔案結尾記錄之後的資料已忽略`),
  tpl("«w»: expected a record starting with ':' (got «x»)", (g) => `${originZh(g.w)}：記錄應以 ':' 開頭（實際為 ${g.x}）`),
  tpl("«w»: invalid character in record (only hex digits allowed after ':')", (g) => `${originZh(g.w)}：記錄中有無效字元（':' 之後只允許十六進位數字）`),
  tpl('«w»: odd number of hex digits — record truncated?', (g) => `${originZh(g.w)}：十六進位數字的個數為奇數——記錄被截斷了嗎？`),
  tpl('«w»: record too short («n#» bytes, minimum 5)', (g) => `${originZh(g.w)}：記錄太短（${g.n} 位元組，最少 5）`),
  tpl(
    '«w»: byte count field says «a#» data bytes but the record holds «b#» — record truncated or corrupted',
    (g) => `${originZh(g.w)}：位元組計數欄位為 ${g.a} 個資料位元組，但記錄中有 ${g.b} 個——記錄被截斷或已損毀`,
  ),
  tpl('«w»: checksum mismatch (expected «a», found «b»)', (g) => `${originZh(g.w)}：檢查碼不符（應為 ${g.a}，實際為 ${g.b}）`),
  tpl('«w»: end-of-file record must have no data', (g) => `${originZh(g.w)}：檔案結尾記錄不能有資料`),
  tpl('«w»: extended segment address record needs 2 data bytes', (g) => `${originZh(g.w)}：延伸區段位址記錄需要 2 個資料位元組`),
  tpl('«w»: start segment address record needs 4 data bytes', (g) => `${originZh(g.w)}：起始區段位址記錄需要 4 個資料位元組`),
  tpl('«w»: extended linear address record needs 2 data bytes', (g) => `${originZh(g.w)}：延伸線性位址記錄需要 2 個資料位元組`),
  tpl('«w»: start linear address record needs 4 data bytes', (g) => `${originZh(g.w)}：起始線性位址記錄需要 4 個資料位元組`),
  tpl('«w»: unknown record type «t» (valid: 00–05)', (g) => `${originZh(g.w)}：未知的記錄類型 ${g.t}（有效值：00–05）`),
  tpl('«w»: overlaps earlier data at «a» (identical bytes, ignored)', (g) => `${originZh(g.w)}：與先前位於 ${g.a} 的資料重疊（位元組相同，已忽略）`),
  tpl('«w»: overlaps earlier data at «a» with different contents', (g) => `${originZh(g.w)}：與先前位於 ${g.a} 的資料重疊，且內容不同`),
  tpl('«w»: data at «a» runs past the 4 GiB address space', (g) => `${originZh(g.w)}：位於 ${g.a} 的資料超出 4 GiB 位址空間`),
  tpl('«f»: empty file — nothing to program', (g) => `${g.f}：空檔案——沒有可燒錄的內容`),
  tpl('«f»: invalid load address «a»', (g) => `${g.f}：無效的載入位址 ${g.a}`),
  tpl('«f»: empty file', (g) => `${g.f}：空檔案`),
  tpl('«f»: has an ELF extension but does not start with the ELF magic (7F 45 4C 46)', (g) => `${g.f}：副檔名是 ELF，但檔案開頭不是 ELF 魔術數字（7F 45 4C 46）`),
  tpl("«f»: has an Intel HEX extension but is not Intel HEX text (records start with ':')", (g) => `${g.f}：副檔名是 Intel HEX，但內容不是 Intel HEX 文字（記錄以 ':' 開頭）`),
  tpl(
    '«f»: unrecognised firmware format — expected an ELF (.elf/.axf), Intel HEX (.hex) or raw binary (.bin) file',
    (g) => `${g.f}：無法辨識的韌體格式——應為 ELF（.elf/.axf）、Intel HEX（.hex）或原始二進位（.bin）檔案`,
  ),
  // FirmwareImage.description
  tpl('ELF32 ARM«fl?», «k=Thumb entry|entry» «a»', (g) => `ELF32 ARM${elfFlagsZh(g.fl)}，${g.k === 'Thumb entry' ? 'Thumb 進入點' : '進入點'} ${g.a}`),
  tpl('raw binary, «n#» bytes at «a»', (g) => `原始二進位檔，${g.n} 位元組，位於 ${g.a}`),
  tpl(
    'Intel HEX, «n#» bytes in «b#» block«s=s?»«e=(?:, entry 0x[0-9A-Fa-f]+)?»',
    (g) => `Intel HEX，${g.n} 位元組，共 ${g.b} 個區塊${g.e ? g.e.replace(/^, entry (0x[0-9A-Fa-f]+)$/, '，進入點 $1') : ''}`,
  ),

  // ------------------------------------------------------------------ SoC
  tpl('segment at «a» is linked at the boot alias 0x00000000: programmed at «b» (main flash)', (g) => `位於 ${g.a} 的區段連結到開機別名 0x00000000：已燒錄到 ${g.b}（主快閃記憶體）`),
  tpl('segment at «a» («n#» bytes) runs past the end of flash («e»): the image does not fit', (g) => `位於 ${g.a} 的區段（${g.n} 位元組）超出快閃記憶體結尾（${g.e}）：映像檔放不下`),
  tpl('segment at «a» («n#» bytes) is RAM-only — not programmed (startup code initialises RAM)', (g) => `位於 ${g.a} 的區段（${g.n} 位元組）只在 RAM 中——不燒錄（啟動程式碼會初始化 RAM）`),
  tpl('segment at «a» targets the option bytes: not programmed, the factory option bytes are kept', (g) => `位於 ${g.a} 的區段指向選項位元組：不燒錄，保留出廠選項位元組`),
  tpl('segment at «a» targets system memory (ROM): not programmed', (g) => `位於 ${g.a} 的區段指向系統記憶體（ROM）：不燒錄`),
  tpl(
    "segment at «a» («n#» bytes) is outside the STM32F103C8's non-volatile memory — not programmed",
    (g) => `位於 ${g.a} 的區段（${g.n} 位元組）不在 STM32F103C8 的非揮發性記憶體內——不燒錄`,
  ),
  tpl('no bytes fall inside main flash («a»–«b»): nothing to program', (g) => `沒有任何位元組落在主快閃記憶體（${g.a}–${g.b}）內：沒有可燒錄的內容`),
  tpl(
    'firmware uses «n» KiB of flash: exceeds the STM32F103C8 datasheet flash size (64 KiB); most parts have 128 KiB',
    (g) => `韌體使用 ${g.n} KiB 快閃記憶體：超過 STM32F103C8 資料手冊的快閃記憶體容量（64 KiB）；多數晶片實際有 128 KiB`,
  ),
  tpl('initial stack pointer «a» is not inside the 20 KiB of SRAM (0x20000000–0x20005000)', (g) => `初始堆疊指標 ${g.a} 不在 20 KiB SRAM（0x20000000–0x20005000）內`),
  tpl('reset vector «a» has the Thumb bit clear: the core will take a UsageFault (INVSTATE)', (g) => `重置向量 ${g.a} 的 Thumb 位元為 0：核心會進入 UsageFault（INVSTATE）`),
  tpl('reset vector «a» does not point into flash', (g) => `重置向量 ${g.a} 沒有指向快閃記憶體`),
  tpl(
    'ELF entry «a» differs from the reset vector «b»: the core starts at the reset vector, like the hardware',
    (g) => `ELF 進入點 ${g.a} 與重置向量 ${g.b} 不同：核心會從重置向量開始執行，與實際硬體相同`,
  ),
  tpl('«f»: «n#» bytes programmed into flash («d»)', (g) => `${g.f}：已將 ${g.n} 位元組燒錄到快閃記憶體（${FORMAT_ZH[g.d] ?? tr(g.d)}）`),
  tpl(
    'core locked up (fault during HardFault/NMI) at «a»«s?»: execution stopped; peripherals (and a running IWDG) keep going',
    (g) => `核心在 ${g.a}${g.s ? g.s.replace(/^ in /, '（') + '）' : ''}鎖死（在 HardFault/NMI 期間又發生錯誤）：停止執行；周邊（以及執行中的 IWDG）繼續運作`,
  ),
  tpl('«w» reset #«n» (RCC_CSR = «c»)', (g) => `${RESET_KIND_ZH[g.w] ?? g.w}重置 #${g.n}（RCC_CSR = ${g.c}）`),
  tpl(
    'FLASH_ACR.LATENCY = «l» is too low for SYSCLK «f» MHz (needs «n» wait state«s?», PM0075 §3.1): real silicon would fetch corrupted instructions',
    (g) => `FLASH_ACR.LATENCY = ${g.l} 對 SYSCLK ${g.f} MHz 而言太低（需要 ${g.n} 個等待週期，PM0075 §3.1）：實際晶片會擷取到錯誤的指令`,
  ),
  tpl(
    '«p» raised DMA1 channel «n» request, but DMA1 is not implemented: the transfer will not happen',
    (g) => `${g.p} 發出 DMA1 通道 ${g.n} 請求，但 DMA1 未實作：不會進行傳輸`,
  ),
  tpl('read of «p» returned 0: «h»', (g) => `讀取 ${g.p} 傳回 0：${gatedHintZh(g.h)}`),
  tpl('write to «p» ignored: «h»', (g) => `寫入 ${g.p} 已忽略：${gatedHintZh(g.h)}`),
  tpl(
    '«w» is not simulated: firmware «d=wrote|read» offset 0x«o» — registers read as 0 and writes are ignored (unsupported)',
    (g) => `${UNSUPPORTED_WHAT_ZH[g.w] ?? g.w} 未模擬：韌體${g.d === 'wrote' ? '寫入' : '讀取'}偏移 0x${g.o}——暫存器讀為 0，寫入會被忽略（不支援）`,
  ),
  tpl('«n#» log messages suppressed (more than «m#» per simulated second)', (g) => `已略過 ${g.n} 則日誌訊息（每模擬秒超過 ${g.m} 則）`),

  // ----------------------------------------------------------------- ADC
  tpl('VDDA = «v» V is below the ADC operating range (2.4 V, DS5319 Table 46): silicon conversions are not specified', (g) => `VDDA = ${g.v} V 低於 ADC 工作範圍（2.4 V，DS5319 Table 46）：實際晶片的轉換結果沒有規格保證`),
  tpl(
    '«a» clock disabled (RCC_APB2ENR) during a «w=calibration|conversion»: it is abandoned',
    (g) => `${g.a} 在${g.w === 'calibration' ? '校正' : '轉換'}期間關閉時脈（RCC_APB2ENR）：已放棄該次${g.w === 'calibration' ? '校正' : '轉換'}`,
  ),
  tpl(
    '«a»_CR2.DMA = 1 has no effect: only ADC1 generates DMA requests (RM0008 §11.8); ADC2 data reach the DMA only through ADC1 in dual mode, which is not simulated',
    (g) => `${g.a}_CR2.DMA = 1 沒有作用：只有 ADC1 會產生 DMA 請求（RM0008 §11.8）；ADC2 的資料只能在雙 ADC 模式下經由 ADC1 送到 DMA，而雙 ADC 模式未模擬`,
  ),
  tpl(
    '«a» powered down (ADON = 0) during «w=calibration|calibration reset»: it is abandoned',
    (g) => `${g.a} 在${g.w === 'calibration' ? '校正' : '校正重置'}期間斷電（ADON = 0）：已放棄`,
  ),
  tpl(
    '«a»_CR2.«b» set while ADON = 0: calibration needs the ADC powered on for at least 2 ADCCLK cycles (RM0008 §11.4) — nothing happens and «c» stays set',
    (g) => `ADON = 0 時設定了 ${g.a}_CR2.${g.b}：校正需要 ADC 先上電至少 2 個 ADCCLK 週期（RM0008 §11.4）——不會有任何動作，且 ${g.c} 保持為 1`,
  ),
  tpl(
    '«a» calibration started «n#» ADCCLK cycles after power-up: RM0008 §11.4 requires ADON = 1 for at least 2 ADCCLK cycles first',
    (g) => `${g.a} 在上電後 ${g.n} 個 ADCCLK 週期就開始校正：RM0008 §11.4 要求先維持 ADON = 1 至少 2 個 ADCCLK 週期`,
  ),
  tpl('«a»_CR2.«b» set during a conversion: the conversion is abandoned', (g) => `轉換期間設定了 ${g.a}_CR2.${g.b}：已放棄該次轉換`),
  tpl(
    '«a»_CR2.«f» selects EXTI line «n» as the «g=regular|injected» trigger: EXTI → ADC trigger routing is not simulated, no conversion will start from it',
    (g) => `${g.a}_CR2.${g.f} 選擇 EXTI 線 ${g.n} 作為${g.g === 'regular' ? '規則' : '注入'}群組觸發：未模擬 EXTI → ADC 觸發路由，不會因此開始轉換`,
  ),
  tpl(
    '«a» «g=regular|injected» trigger «s»: this SoC model does not route peripheral triggers, no conversion will start from it',
    (g) => `${g.a} ${g.g === 'regular' ? '規則' : '注入'}群組觸發 ${g.s}：此 SoC 模型不路由周邊觸發，不會因此開始轉換`,
  ),
  tpl('«a» «s» trigger ignored: the ADC is powered down (CR2.ADON = 0)', (g) => `${g.a} 的 ${g.s} 觸發已忽略：ADC 已斷電（CR2.ADON = 0）`),
  tpl('«a» «s» trigger during calibration ignored', (g) => `${g.a} 在校正期間的 ${g.s} 觸發已忽略`),
  tpl(
    '«a» injected trigger «s» ignored: with CR1.JAUTO = 1 the injected group follows the regular one and its external trigger must be disabled (RM0008 §11.3.9)',
    (g) => `${g.a} 的注入群組觸發 ${g.s} 已忽略：CR1.JAUTO = 1 時注入群組跟隨規則群組，其外部觸發必須停用（RM0008 §11.3.9）`,
  ),
  tpl('«a» channel «n» does not exist (channels 0–17): it converts 0', (g) => `${g.a} 通道 ${g.n} 不存在（通道 0–17）：轉換結果為 0`),
  tpl(
    '«a» IN«n» («w») converted with CR2.TSVREFE = 0: the sensor and VREFINT are powered down (RM0008 §11.10) — the simulated input is 0 V, silicon reads an undefined value',
    (g) => `${g.a} IN${g.n}（${g.w === 'temperature sensor' ? '溫度感測器' : g.w}）在 CR2.TSVREFE = 0 時轉換：感測器與 VREFINT 已斷電（RM0008 §11.10）——模擬輸入為 0 V，實際晶片會讀到不確定的值`,
  ),
  tpl(
    '«a» IN«n» («w») sampled «t» µs after TSVREFE was set: the start-up time is up to 10 µs (DS5319 Table 50 tSTART), silicon output is not settled yet — the simulated one is',
    (g) => `${g.a} IN${g.n}（${g.w === 'temperature sensor' ? '溫度感測器' : g.w}）在設定 TSVREFE 後 ${g.t} µs 就取樣：啟動時間最長 10 µs（DS5319 Table 50 tSTART），實際晶片的輸出尚未穩定——模擬的已穩定`,
  ),
  tpl(
    '«a» temperature sensor sampled for «t» µs: RM0008 §11.10 / DS5319 Table 50 require 17.1 µs (SMP16 = 239.5 cycles at ADCCLK ≤ 14 MHz) — silicon reads too low, the simulated sensor is ideal',
    (g) => `${g.a} 溫度感測器只取樣 ${g.t} µs：RM0008 §11.10／DS5319 Table 50 要求 17.1 µs（ADCCLK ≤ 14 MHz 時 SMP16 = 239.5 週期）——實際晶片會讀得偏低，模擬的感測器則是理想的`,
  ),
  tpl(
    '«a» IN«n» is «p», which is not bonded out on the STM32F103C8 (LQFP48, DS5319 Table 5): it converts 0',
    (g) => `${g.a} IN${g.n} 是 ${g.p}，在 STM32F103C8 上未引出（LQFP48，DS5319 Table 5）：轉換結果為 0`,
  ),
  tpl(
    '«a» IN«n» («p»): the pin voltage is unknown (nothing drives it) — converted as 0 V; silicon converts whatever charge is left on the pin',
    (g) => `${g.a} IN${g.n}（${g.p}）：腳位電壓不確定（沒有任何東西驅動）——以 0 V 轉換；實際晶片會轉換腳位上殘留的電荷`,
  ),
  tpl(
    '«a» IN«n»: «p» is not in analog mode («r» CNF/MODE = 0b«b»). The ADC still converts the pin voltage, but RM0008 §9.1.11 requires analog mode for ADC inputs (GPIO_MODE_ANALOG): the input Schmitt trigger and any pull or output stay connected',
    (g) => `${g.a} IN${g.n}：${g.p} 不是類比模式（${g.r} CNF/MODE = 0b${g.b}）。ADC 仍會轉換腳位電壓，但 RM0008 §9.1.11 要求 ADC 輸入使用類比模式（GPIO_MODE_ANALOG）：輸入施密特觸發器以及任何上拉／下拉或輸出仍然連接著`,
  ),
  tpl(
    '«a» converting with ADCCLK = «f» MHz, outside 0.6–14 MHz (DS5319 Table 46 fADC): silicon accuracy is not guaranteed — set RCC_CFGR.ADCPRE (PCLK2/6 at 72 MHz)',
    (g) => `${g.a} 以 ADCCLK = ${g.f} MHz 轉換，超出 0.6–14 MHz（DS5319 Table 46 fADC）：實際晶片的精確度沒有保證——請設定 RCC_CFGR.ADCPRE（72 MHz 時用 PCLK2/6）`,
  ),
  tpl(
    '«a» conversion started «t» µs after power-up (ADON): the ADC needs tSTAB = 1 µs first (DS5319 Table 46) — silicon results are not guaranteed',
    (g) => `${g.a} 在上電（ADON）後 ${g.t} µs 就開始轉換：ADC 需要先經過 tSTAB = 1 µs（DS5319 Table 46）——實際晶片的結果沒有保證`,
  ),
  tpl(
    '«a» converting without a calibration since reset (RM0008 §11.4 recommends HAL_ADCEx_Calibration_Start after each power-up); the simulated converter has no mismatch to calibrate, so results are unaffected',
    (g) => `${g.a} 自重置後未校正就開始轉換（RM0008 §11.4 建議每次上電後呼叫 HAL_ADCEx_Calibration_Start）；模擬的轉換器沒有需要校正的誤差，因此結果不受影響`,
  ),
  tpl(
    'ADC1_CR1.DUALMOD = «n»: dual ADC modes are not simulated — ADC1 and ADC2 keep converting independently (ADC1_DR[31:16] stays 0)',
    (g) => `ADC1_CR1.DUALMOD = ${g.n}：未模擬雙 ADC 模式——ADC1 與 ADC2 繼續各自獨立轉換（ADC1_DR[31:16] 保持為 0）`,
  ),
  tpl(
    '«a»: discontinuous mode (DISCEN) together with continuous mode (CONT) is not allowed (RM0008 §11.3.10) — the model converts discontinuous bursts and ignores CONT',
    (g) => `${g.a}：不連續模式（DISCEN）不能與連續模式（CONT）同時使用（RM0008 §11.3.10）——模型以不連續的批次轉換並忽略 CONT`,
  ),
  tpl(
    '«a»: auto-injection (JAUTO) cannot be combined with discontinuous mode (RM0008 §11.3.9) — results are not specified',
    (g) => `${g.a}：自動注入（JAUTO）不能與不連續模式同時使用（RM0008 §11.3.9）——結果沒有規格定義`,
  ),

  // --------------------------------------------------- AFIO / CRC / DBGMCU
  tpl('EXTICR selects port «p» for EXTI«n»: only ports A–E exist (values 0–4)', (g) => `EXTICR 為 EXTI${g.n} 選擇了埠 ${g.p}：只有埠 A–E（數值 0–4）`),
  tpl(
    '«n#»-bit write to CRC_DR: the STM32F1 CRC unit only processes 32-bit words (processed as a zero-extended word)',
    (g) => `對 CRC_DR 做 ${g.n} 位元寫入：STM32F1 的 CRC 單元只處理 32 位元字組（以補零延伸後的字組處理）`,
  ),
  tpl(
    '«w» access at 0x«a»: debug component not simulated (reads 0, writes ignored)',
    (g) => `存取 ${g.w === 'ROM table' ? 'ROM 表' : g.w === 'external PPB' ? '外部 PPB' : g.w}（0x${g.a}）：未模擬此除錯元件（讀為 0，寫入會被忽略）`,
  ),

  // ----------------------------------------------------------------- DMA
  tpl(
    'DMA1_CNDTR«n» written while channel «c» is enabled: ignored (writable only with EN = 0, RM0008 §13.4.4)',
    (g) => `通道 ${g.c} 致能時寫入 DMA1_CNDTR${g.n}：已忽略（只有 EN = 0 時才能寫入，RM0008 §13.4.4）`,
  ),
  tpl(
    'DMA1_«r»«n» written while channel «c» is enabled (RM0008 §13.4.5–6: must not be): the transfer in progress keeps its current address, the new base applies from the next reload',
    (g) => `通道 ${g.c} 致能時寫入 DMA1_${g.r}${g.n}（RM0008 §13.4.5–6：不得如此）：進行中的傳輸保持目前位址，新的基底位址從下次重新載入開始套用`,
  ),
  tpl(
    'DMA1 clock disabled (RCC_AHBENR.DMA1EN = 0) during a channel «c» transfer: the transfer is dropped',
    (g) => `通道 ${g.c} 傳輸期間關閉了 DMA1 時脈（RCC_AHBENR.DMA1EN = 0）：該次傳輸已捨棄`,
  ),
  tpl('DMA1 channel «c» enabled with CNDTR = 0: no transfer can be served (RM0008 §13.4.4)', (g) => `DMA1 通道 ${g.c} 在 CNDTR = 0 時致能：無法進行任何傳輸（RM0008 §13.4.4）`),
  tpl('DMA1_CCR«c»: PSIZE/MSIZE = 11 is reserved (RM0008 §13.4.3) — the model uses 32 bits', (g) => `DMA1_CCR${g.c}：PSIZE/MSIZE = 11 為保留值（RM0008 §13.4.3）——模型以 32 位元處理`),
  tpl(
    'DMA1_CCR«c»: memory-to-memory mode may not be used together with circular mode (RM0008 §13.3.3) — the model stops at CNDTR = 0',
    (g) => `DMA1_CCR${g.c}：記憶體到記憶體模式不能與循環模式同時使用（RM0008 §13.3.3）——模型在 CNDTR = 0 時停止`,
  ),
  tpl(
    'DMA1 channel «c» transfer error: «p» of «a» failed («r») — TEIF«n» set, channel disabled (RM0008 §13.3.5)',
    (g) => `DMA1 通道 ${g.c} 傳輸錯誤：${g.p === 'read' ? '讀取' : g.p === 'write' ? '寫入' : g.p} ${g.a} 失敗（${tr(g.r)}）——TEIF${g.n} 已設定，通道已停用（RM0008 §13.3.5）`,
  ),

  // --------------------------------------------------------------- FLASH
  tpl(
    'wrong «k=KEYR|OPTKEYR» key 0x«v»: the flash interface is locked until the next reset (bus error)',
    (g) => `${g.k} 金鑰 0x${g.v} 錯誤：快閃記憶體介面會鎖定到下次重置（匯流排錯誤）`,
  ),
  tpl('page erase of «a»: FLASH_AR is not a main-flash address — nothing erased', (g) => `頁抹除 ${g.a}：FLASH_AR 不是主快閃記憶體位址——沒有抹除任何內容`),
  tpl(
    'write to flash «a» without FLASH_CR.PG: bus error (unlock with HAL_FLASH_Unlock(), then program through the FPEC)',
    (g) => `在沒有 FLASH_CR.PG 的情況下寫入快閃記憶體 ${g.a}：匯流排錯誤（請先以 HAL_FLASH_Unlock() 解鎖，再透過 FPEC 燒寫）`,
  ),
  tpl('«n#»-bit flash programming (only half-words can be programmed)', (g) => `${g.n} 位元的快閃記憶體燒寫（只能以半字組燒寫）`),
  tpl('mass erase started (BSY for «t» ms)', (g) => `整片抹除已開始（BSY ${g.t} ms）`),
  tpl('«w» started (BSY for «t» ms)', (g) => `${g.w} 已開始（BSY ${g.t} ms）`, (g) => !/ /.test(g.w)),
  tpl('page erase «a» started (BSY for «t» ms)', (g) => `頁抹除 ${g.a} 已開始（BSY ${g.t} ms）`),

  // ---------------------------------------------------------------- GPIO
  tpl('«p»_«r=CRL|CRH» write to a locked pin ignored (GPIOx_LCKR is active until reset)', (g) => `寫入 ${g.p}_${g.r} 中已鎖定的腳位已忽略（GPIOx_LCKR 在重置前一直有效）`),
  tpl(
    '«a» both drive «p» as an alternate function: conflicting AF outputs (the low level wins)',
    (g) => `${listAndZh(g.a)} 同時以複用功能驅動 ${g.p.replace(/^pin (\d+)$/, '腳位 $1')}：AF 輸出衝突（低準位優先）`,
  ),
  tpl('«p»: input CNF=11 is reserved (RM0008 Table 20) — treated as floating', (g) => `${g.p}：輸入 CNF=11 為保留值（RM0008 Table 20）——視為浮接輸入`),
  tpl('«p» is configured as an output but is not bonded out on the STM32F103C8 (LQFP48)', (g) => `${g.p} 被設定為輸出，但在 STM32F103C8 上未引出（LQFP48）`),

  // ----------------------------------------------------------------- I2C
  tpl(
    '«a»_CCR written while PE = 1: the CCR register must be configured only when the I2C is disabled (RM0008 §26.6.8)',
    (g) => `PE = 1 時寫入 ${g.a}_CCR：CCR 暫存器只能在 I2C 停用時設定（RM0008 §26.6.8）`,
  ),
  tpl(
    '«a»_TRISE written while PE = 1: TRISE must be configured only when the I2C is disabled (RM0008 §26.6.9)',
    (g) => `PE = 1 時寫入 ${g.a}_TRISE：TRISE 只能在 I2C 停用時設定（RM0008 §26.6.9）`,
  ),
  tpl('«a» clock disabled during a transfer: the transfer is aborted (lines stay as they are)', (g) => `${g.a} 在傳輸期間關閉時脈：傳輸中止（線路維持現狀）`),
  tpl(
    'SMBus mode (SMBUS/SMBTYPE/ENARP) is not simulated: «a» keeps working as a plain I²C interface (no SMBA pin, no 25 ms timeout, no ARP / host / alert-response addresses)',
    (g) => `未模擬 SMBus 模式（SMBUS/SMBTYPE/ENARP）：${g.a} 繼續以一般 I²C 介面運作（沒有 SMBA 腳位、沒有 25 ms 逾時、沒有 ARP／主機／警報回應位址）`,
  ),
  tpl('«a» CR1.ALERT: the SMBA pin is not simulated', (g) => `${g.a} CR1.ALERT：未模擬 SMBA 腳位`),
  tpl(
    '«a»: 10-bit slave addressing (OAR1.ADDMODE = 1) is not simulated — the slave does not answer 10-bit headers (10-bit MASTER addressing works)',
    (g) => `${g.a}：未模擬 10 位元從端定址（OAR1.ADDMODE = 1）——從端不會回應 10 位元標頭（10 位元「主端」定址可正常運作）`,
  ),
  tpl(
    '«a»: PE cleared during a transfer — the transfer is abandoned at once (RM0008 §26.6.1: silicon finishes the current communication first)',
    (g) => `${g.a}：傳輸期間清除了 PE——傳輸立即放棄（RM0008 §26.6.1：實際晶片會先完成目前的通訊）`,
  ),
  tpl(
    '«a»: DR written while SB = 1 without reading SR1 first — EV5 is cleared by SR1 read followed by the DR write (RM0008 §26.3.3); the address is not sent',
    (g) => `${g.a}：SB = 1 時未先讀取 SR1 就寫入 DR——EV5 要先讀 SR1 再寫 DR 才會清除（RM0008 §26.3.3）；位址不會送出`,
  ),
  tpl('«a»_CR2.FREQ = «f»: must be the APB1 clock in MHz, 2…36 (RM0008 §26.6.2)', (g) => `${g.a}_CR2.FREQ = ${g.f}：必須是以 MHz 表示的 APB1 時脈，2…36（RM0008 §26.6.2）`),
  tpl(
    '«a»_CR2.FREQ = «f» MHz but PCLK1 is «p» MHz: setup/hold times are generated from FREQ, SCL timing from the real PCLK1 (RM0008 §26.6.2)',
    (g) => `${g.a}_CR2.FREQ = ${g.f} MHz，但 PCLK1 是 ${g.p} MHz：建立／保持時間依 FREQ 產生，SCL 時序則依實際的 PCLK1（RM0008 §26.6.2）`,
  ),
  tpl(
    '«a»_CCR = «c» is below the minimum (0x04, 0x01 in fast duty mode, RM0008 §26.6.8): clamped',
    (g) => `${g.a}_CCR = ${g.c} 低於最小值（0x04，快速工作週期模式為 0x01，RM0008 §26.6.8）：已限制為最小值`,
  ),
  tpl('«a»: Fm mode needs PCLK1 ≥ 4 MHz (RM0008 §26.3.3)', (g) => `${g.a}：Fm 模式需要 PCLK1 ≥ 4 MHz（RM0008 §26.3.3）`),
  tpl('«a»: Sm mode needs PCLK1 ≥ 2 MHz (RM0008 §26.3.3)', (g) => `${g.a}：Sm 模式需要 PCLK1 ≥ 2 MHz（RM0008 §26.3.3）`),
  tpl(
    '«a»: CCR gives SCL ≈ «f» kHz, above the «l=400 kHz Fm|100 kHz Sm» limit of the I²C specification',
    (g) => `${g.a}：CCR 使 SCL ≈ ${g.f} kHz，超過 I²C 規格 ${g.l} 的上限`,
  ),

  // ------------------------------------------------------- IWDG / WWDG
  tpl('independent watchdog started (timeout «t» ms until the first reload)', (g) => `獨立看門狗已啟動（到第一次重新載入前的逾時為 ${g.t} ms）`),
  tpl('window watchdog reset: «w» (RCC_CSR.WWDGRSTF)', (g) => `視窗看門狗重置：${wwdgWhyZh(g.w)}（RCC_CSR.WWDGRSTF）`),

  // ----------------------------------------------------------------- RCC
  tpl('PLL input «f» is outside 1–25 MHz (DS5319 Table 34)', (g) => `PLL 輸入 ${g.f} 超出 1–25 MHz（DS5319 Table 34）`),
  tpl('PLL output «f» is outside 16–72 MHz (DS5319 Table 34, fPLL_OUT)', (g) => `PLL 輸出 ${g.f} 超出 16–72 MHz（DS5319 Table 34，fPLL_OUT）`),
  tpl('SYSCLK «f» exceeds the 72 MHz maximum (DS5319 §5.3.1)', (g) => `SYSCLK ${g.f} 超過 72 MHz 上限（DS5319 §5.3.1）`),
  tpl('HCLK «f» exceeds the 72 MHz maximum', (g) => `HCLK ${g.f} 超過 72 MHz 上限`),
  tpl(
    'PCLK1 «f» exceeds the 36 MHz APB1 maximum — set PPRE1 (HAL: APB1CLKDivider = RCC_HCLK_DIV2)',
    (g) => `PCLK1 ${g.f} 超過 APB1 的 36 MHz 上限——請設定 PPRE1（HAL：APB1CLKDivider = RCC_HCLK_DIV2）`,
  ),
  tpl('PCLK2 «f» exceeds the 72 MHz APB2 maximum', (g) => `PCLK2 ${g.f} 超過 APB2 的 72 MHz 上限`),
  tpl(
    'ADCCLK «f» exceeds the 14 MHz maximum (DS5319 Table 46) — raise ADCPRE (RCC_PCLK2_DIV6 at 72 MHz)',
    (g) => `ADCCLK ${g.f} 超過 14 MHz 上限（DS5319 Table 46）——請加大 ADCPRE（72 MHz 時用 RCC_PCLK2_DIV6）`,
  ),
  tpl(
    'USB clock «f» is not 48 MHz (RM0008 §7.2.3: PLL must be 72 MHz with USBPRE=0 or 48 MHz with USBPRE=1)',
    (g) => `USB 時脈 ${g.f} 不是 48 MHz（RM0008 §7.2.3：PLL 必須是 72 MHz 搭配 USBPRE=0，或 48 MHz 搭配 USBPRE=1）`,
  ),

  // ----------------------------------------------------------------- SPI
  tpl('«a»_CRCPR = 0: not a valid CRC polynomial', (g) => `${g.a}_CRCPR = 0：不是有效的 CRC 多項式`),
  tpl(
    'I2S is not available on the STM32F103C8 (medium-density, RM0008 §25.1): «a»_«r» write ignored',
    (g) => `STM32F103C8 沒有 I2S（中密度產品，RM0008 §25.1）：寫入 ${g.a}_${g.r} 已忽略`,
  ),
  tpl('«a» clock disabled during a frame: the frame is lost', (g) => `${g.a} 在資料框傳輸期間關閉時脈：該資料框遺失`),
  tpl(
    '«a»_CR1 mode/format bits changed during a transfer (RM0008 §25.5.1: change them only while SPE = 0)',
    (g) => `傳輸期間變更了 ${g.a}_CR1 的模式／格式位元（RM0008 §25.5.1：只能在 SPE = 0 時變更）`,
  ),
  tpl(
    '«a» bidirectional receive mode: the data pin («p») is released by the SPI, but the simulated GPIO keeps an AF push-pull pin driven — configure that pin as an input',
    (g) => `${g.a} 雙向接收模式：SPI 釋放了資料腳位（${g.p}），但模擬的 GPIO 會持續驅動 AF 推挽腳位——請把該腳位設為輸入`,
  ),
  tpl(
    '«a»: SPE cleared during a frame — the frame is cut (RM0008 §25.3.8: wait for TXE = 1 and BSY = 0 first)',
    (g) => `${g.a}：資料框傳輸期間清除了 SPE——資料框被截斷（RM0008 §25.3.8：請先等待 TXE = 1 且 BSY = 0）`,
  ),
  tpl(
    '«a» master mode fault (MODF): NSS is low («w») — SPE and MSTR cleared (RM0008 §25.3.10)',
    (g) => `${g.a} 主端模式錯誤（MODF）：NSS 為低（${nssWhyZh(g.w)}）——已清除 SPE 與 MSTR（RM0008 §25.3.10）`,
  ),

  // ----------------------------------------------------------------- TIM
  tpl('«a»_CR1.CKD = 11 is reserved (RM0008 §15.4.1): t_DTS is taken as 4 × t_CK_INT', (g) => `${g.a}_CR1.CKD = 11 為保留值（RM0008 §15.4.1）：t_DTS 以 4 × t_CK_INT 計算`),
  tpl(
    '«a»: switching from edge-aligned to center-aligned mode while the counter is enabled is not allowed (RM0008 §15.4.1 CMS)',
    (g) => `${g.a}：計數器致能時不能從邊緣對齊模式切換為中央對齊模式（RM0008 §15.4.1 CMS）`,
  ),
  tpl(
    '«a» OC«n»CE (OC«m»REF clear on ETRF) is not simulated: the reference is never cleared by ETR',
    (g) => `${g.a} 未模擬 OC${g.n}CE（由 ETRF 清除 OC${g.m}REF）：參考訊號永遠不會被 ETR 清除`,
  ),
  tpl(
    '«a» OC«n»FE (output-compare fast enable) is not simulated: a trigger does not force OC«m»REF early',
    (g) => `${g.a} 未模擬 OC${g.n}FE（輸出比較快速致能）：觸發不會提早強制 OC${g.m}REF`,
  ),
  tpl(
    '«a»_«c» is mapped to «p» in the current AFIO remap, which is not bonded out on the STM32F103C8 (LQFP48): the output goes nowhere',
    (g) => `在目前的 AFIO 重映射中，${g.a}_${g.c} 對應到 ${g.p}，但它在 STM32F103C8 上未引出（LQFP48）：輸出不會送到任何地方`,
  ),
  tpl(
    '«a»_ETR is on «p», which is not bonded out on the STM32F103C8 (LQFP48): ETR stays low',
    (g) => `${g.a}_ETR 位於 ${g.p}，但它在 STM32F103C8 上未引出（LQFP48）：ETR 保持為低`,
  ),
  tpl(
    '«a» ITR«n» is not connected on the STM32F103C8 (its master would be TIM5 or TIM8, which this device does not have): no trigger will arrive',
    (g) => `${g.a} ITR${g.n} 在 STM32F103C8 上沒有連接（它的主端應為 TIM5 或 TIM8，而此元件沒有）：不會收到任何觸發`,
  ),
  tpl(
    '«a» slave mode on ITR«n» («m»_TRGO) needs inter-peripheral trigger routing, which this SoC model does not provide',
    (g) => `${g.a} 在 ITR${g.n}（${g.m}_TRGO）上的從端模式需要周邊間的觸發路由，而此 SoC 模型未提供`,
  ),
  tpl(
    '«a» is counting with CCxE/CCxNE set but BDTR.MOE = 0: an advanced-control timer keeps its outputs disabled until the main output enable is set (RM0008 §14.4.18). HAL_TIM_PWM_Start() sets it; register-level code needs TIM1->BDTR |= TIM_BDTR_MOE.',
    (g) => `${g.a} 在設定 CCxE/CCxNE 但 BDTR.MOE = 0 的情況下計數：進階控制計時器在設定主輸出致能前會保持輸出停用（RM0008 §14.4.18）。HAL_TIM_PWM_Start() 會設定它；暫存器層級的程式碼需要 TIM1->BDTR |= TIM_BDTR_MOE。`,
  ),
  tpl(
    '«a»: trigger chain deeper than «n» timers (a master/slave loop?) — further triggers in this cycle are dropped',
    (g) => `${g.a}：觸發鏈超過 ${g.n} 個計時器（主從迴圈？）——本週期中之後的觸發已捨棄`,
  ),

  // --------------------------------------------------------------- USART
  tpl('«n#» byte(s) sent to «a» dropped: the receiver is disabled (UE/RE = 0)', (g) => `傳送到 ${g.a} 的 ${g.n} 個位元組已捨棄：接收器已停用（UE/RE = 0）`),
  tpl('«n#» byte(s) sent to «a» dropped: BRR is not programmed', (g) => `傳送到 ${g.a} 的 ${g.n} 個位元組已捨棄：BRR 尚未設定`),
  tpl('BRR = «b»: USARTDIV must be ≥ 1 (BRR ≥ 16)', (g) => `BRR = ${g.b}：USARTDIV 必須 ≥ 1（BRR ≥ 16）`),
  tpl(
    '«w» is not simulated: the USART keeps working as a plain asynchronous UART',
    (g) => `未模擬${USART_MODE_ZH[g.w] ?? g.w}：USART 繼續以一般非同步 UART 運作`,
  ),
  tpl('«a» TX is mapped to «p», which is not bonded out on the STM32F103C8 (LQFP48)', (g) => `${g.a} TX 對應到 ${g.p}，但它在 STM32F103C8 上未引出（LQFP48）`),
  tpl('«a» RX is mapped to «p», which is not bonded out on the STM32F103C8 (LQFP48)', (g) => `${g.a} RX 對應到 ${g.p}，但它在 STM32F103C8 上未引出（LQFP48）`),
  tpl(
    '«a» transmitter enabled with BRR = «b»: nothing can be sent until BRR is programmed',
    (g) => `${g.a} 的傳送器在 BRR = ${g.b} 時致能：設定 BRR 之前無法傳送任何資料`,
  ),
  tpl('«n#» queued byte(s) dropped: the receiver was disabled', (g) => `已捨棄 ${g.n} 個佇列中的位元組：接收器已停用`),

  // ------------------------------------- memory (BusFault reasons; regionName() shapes)
  tpl('instruction fetch from «r»', (g) => `從 ${regionZh(g.r)} 擷取指令`, (g) => isRegion(g.r)),
  tpl('unaligned «n#»-bit peripheral read', (g) => `未對齊的 ${g.n} 位元周邊讀取`),
  tpl('unaligned «n#»-bit peripheral write', (g) => `未對齊的 ${g.n} 位元周邊寫入`),
  tpl('read from «r»', (g) => `讀取 ${regionZh(g.r)}`, (g) => isRegion(g.r)),
  tpl('write to «r»', (g) => `寫入 ${regionZh(g.r)}`, (g) => isRegion(g.r)),

  // --------------------------------------- composed peripheral support notes
  tpl('«b» Same model as SPI1; slave mode unit-tested on SPI2.', (g) => `${tr(g.b)}與 SPI1 使用相同模型；從端模式在 SPI2 上做過單元測試。`, (g) => translates(g.b)),
  tpl('«b» Same model as I2C1; slave mode unit-tested on I2C2.', (g) => `${tr(g.b)}與 I2C1 使用相同模型；從端模式在 I2C2 上做過單元測試。`, (g) => translates(g.b)),
  tpl(
    '«b» Same model as ADC1 (unit-tested through ADC1): IN16/IN17 are VSS, no DMA request.',
    (g) => `${tr(g.b)}與 ADC1 使用相同模型（透過 ADC1 做單元測試）：IN16/IN17 接 VSS，沒有 DMA 請求。`,
    (g) => translates(g.b),
  ),
  tpl(
    '«b» Real-firmware verification pending (needs the Cortex-M3 core).',
    (g) => `${tr(g.b)}真實韌體驗證尚待進行（需要 Cortex-M3 核心）。`,
    (g) => translates(g.b),
  ),
]

/** regionName() output ("0x…  (…)") or a bare token */
function isRegion(s: string): boolean {
  return /^0x[0-9a-fA-F]+ [(]/.test(s) || !/ /.test(s)
}

function machineZh(s: string): string {
  const m = /^unknown machine (\d+)$/.exec(s)
  return m ? `未知的機器 ${m[1]}` : s
}

function listAndZh(s: string): string {
  return s.replace(/ and /g, ' 與 ')
}

function wwdgWhyZh(s: string): string {
  if (s === 'T6 written as 0') return 'T6 被寫為 0'
  if (s === 'counter reached 0x3F (T6 cleared)') return '計數器到達 0x3F（T6 被清除）'
  const m = /^counter reloaded outside the window \(T = (0x[0-9a-f]+) > W = (0x[0-9a-f]+)\)$/.exec(s)
  return m ? `在視窗外重新載入計數器（T = ${m[1]} > W = ${m[2]}）` : s
}

function nssWhyZh(s: string): string {
  if (s === 'SSI = 0') return 'SSI = 0'
  const p = / pin$/.exec(s)
  if (p) return `${s.slice(0, -4)} 腳位`
  const m = /^pin (\S+)$/.exec(s)
  return m ? `腳位 ${m[1]}` : s
}

// ---------------------------------------------------------------------------
// exact texts
// ---------------------------------------------------------------------------

const GP_A_EN =
  'Lazy 16-bit counter (events only at relevant steps, never per tick): edge-aligned up/down, center-aligned 1–3, PSC/ARR/CCRx preloads, UG/UDIS/URS, one-pulse mode; output compare (frozen, active/inactive/toggle on match, forced, PWM 1/2, CCxP) with exact edge cycles on the AFIO-remapped LQFP48 pins; input capture (direct/indirect/TRC, edge polarity, ICxPSC, CCxOF; the ICxF/ETF digital filter is approximated as an N-sample hold), PWM input via slave reset, encoder modes 1–3, slave reset/gated/trigger/external clock 1 (TI1F_ED, TI1FP1, TI2FP2, ETRF, ITRx via TRGO), external clock mode 2 (ETR, ETPS, ETF), TRGO (reset/enable/update/compare pulse/OCxREF) and TIMx_CCx trigger events, level interrupts, DMA requests per RM0008 Table 78, DBG_TIMx_STOP. '
const GP_A_ZH =
  '延遲計算的 16 位元計數器（只在相關時刻產生事件，從不逐一計數）：邊緣對齊上數／下數、中央對齊 1–3、PSC/ARR/CCRx 預載、UG/UDIS/URS、單脈衝模式；輸出比較（凍結、比對時設為有效／無效／翻轉、強制、PWM 1/2、CCxP），在經 AFIO 重映射的 LQFP48 腳位上具精確的邊緣週期；輸入捕捉（直接／間接／TRC、邊緣極性、ICxPSC、CCxOF；ICxF/ETF 數位濾波器以 N 次取樣保持近似）、以從端重置實現的 PWM 輸入、編碼器模式 1–3、從端重置／閘控／觸發／外部時脈 1（TI1F_ED、TI1FP1、TI2FP2、ETRF、經 TRGO 的 ITRx）、外部時脈模式 2（ETR、ETPS、ETF）、TRGO（重置／致能／更新／比較脈波／OCxREF）與 TIMx_CCx 觸發事件、準位中斷、依 RM0008 Table 78 的 DMA 請求、DBG_TIMx_STOP。'
const GP_B_EN =
  'Unit-tested only (no firmware yet): center-aligned and down-counting, one-pulse, gated/trigger/external-clock slave modes, ITR chaining, ETR, Hall-sensor XOR + TRC capture, update DMA through DMA1. '
const GP_B_ZH =
  '僅做過單元測試（尚無韌體驗證）：中央對齊與下數、單脈衝、閘控／觸發／外部時脈從端模式、ITR 串接、ETR、霍爾感測器 XOR + TRC 捕捉、經 DMA1 的更新 DMA。'
const GP_C_EN =
  'Partial: DMA burst (DMAR walks DBA…DBA+DBL, no multi-transfer sequencing); OCxCE (OCxREF clear on ETRF) and OCxFE are not simulated (logged); the 1-cycle CNT_EN and input-resynchronisation latencies are not modelled; a frozen-mode channel without CCxIE/CCxDE emits no TIMx_CCx trigger; a gated slave on ITRx assumes the master TRGO low until its next edge.'
const GP_C_ZH =
  '部分支援：DMA 突發傳輸（DMAR 依序走訪 DBA…DBA+DBL，沒有多次傳輸的排序）；未模擬 OCxCE（由 ETRF 清除 OCxREF）與 OCxFE（會記錄於日誌）；未模擬 1 個週期的 CNT_EN 與輸入重新同步延遲；凍結模式下未設定 CCxIE/CCxDE 的通道不會產生 TIMx_CCx 觸發；ITRx 上的閘控從端在主端下一個邊緣出現前，假設其 TRGO 為低。'
const GP_EN = GP_A_EN + GP_B_EN + GP_C_EN
const GP_ZH = GP_A_ZH + GP_B_ZH + GP_C_ZH

export const NOTES_ZH: Record<string, string> = polishNotes({
  // ---- core / SCS / loader / memory (fixed texts)
  'undecoded slot executed': '執行了未解碼的指令槽',
  'NMI taken: leaving lockup': '進入 NMI：離開鎖死狀態',
  'CCR.BFHFNMIGN is set but not modeled: the BusFault at priority < 0 is not ignored': 'CCR.BFHFNMIGN 已設定但未模擬：優先權 < 0 時的 BusFault 不會被忽略',
  'unaligned exception frame': '例外框架未對齊',
  'outside the bytes read': '超出已讀取的位元組',
  'unprivileged access to the PPB': '非特權模式存取 PPB',
  'DWT_CTRL: only CYCCNTENA is modeled (profiling counters, PC sampling and comparators are not)': 'DWT_CTRL：只模擬 CYCCNTENA（效能計數器、PC 取樣與比較器均未模擬）',
  'DHCSR write ignored: halting debug is driven by the simulator, not by firmware': '寫入 DHCSR 已忽略：停止除錯由模擬器控制，而非韌體',
  'AIRCR write without VECTKEY 0x05FA (or not a word write) ignored': '沒有 VECTKEY 0x05FA（或不是字組寫入）的 AIRCR 寫入已忽略',
  'AIRCR.VECTCLRACTIVE (debug-only, UNPREDICTABLE when not halted): all active state cleared': 'AIRCR.VECTCLRACTIVE（僅供除錯，未停止時為 UNPREDICTABLE）：已清除所有作用中狀態',
  'AIRCR.SYSRESETREQ: system reset requested': 'AIRCR.SYSRESETREQ：已要求系統重置',
  'AIRCR.VECTRESET (debug-only): core-only reset performed, peripherals keep their state': 'AIRCR.VECTRESET（僅供除錯）：只重置核心，周邊保持原狀態',
  'unprivileged access to the ITM control registers': '非特權模式存取 ITM 控制暫存器',
  'ITM control register write ignored: ITM is locked (write 0xC5ACCE55 to ITM_LAR first)': '寫入 ITM 控制暫存器已忽略：ITM 已鎖定（請先把 0xC5ACCE55 寫入 ITM_LAR）',
  'file starts with the ELF magic: this looks like an ELF, not a raw binary': '檔案以 ELF 魔術數字開頭：看起來是 ELF，而不是原始二進位檔',
  'not an ELF file (missing 7F 45 4C 46 magic)': '不是 ELF 檔（缺少 7F 45 4C 46 魔術數字）',
  'ELF64 file (EI_CLASS=2): STM32 firmware must be a 32-bit ARM ELF (ELF32)': 'ELF64 檔（EI_CLASS=2）：STM32 韌體必須是 32 位元 ARM ELF（ELF32）',
  'big-endian ELF (EI_DATA=2): Cortex-M3 firmware must be little-endian': '大端序 ELF（EI_DATA=2）：Cortex-M3 韌體必須是小端序',
  'relocatable object file (ET_REL, a .o): link it into an executable first': '可重定位目的檔（ET_REL，即 .o 檔）：請先連結成可執行檔',
  'position-independent executable (ET_DYN): loaded at its link addresses, no relocation is applied': '位置無關可執行檔（ET_DYN）：載入到其連結位址，不做重定位',
  'no program headers: nothing to load (was the file linked?)': '沒有程式標頭：沒有可載入的內容（檔案有經過連結嗎？）',
  'no PT_LOAD segments: nothing to program': '沒有 PT_LOAD 區段：沒有可燒錄的內容',
  'every PT_LOAD segment is empty (p_filesz = 0): nothing to program': '所有 PT_LOAD 區段都是空的（p_filesz = 0）：沒有可燒錄的內容',
  'no section headers: symbol table unavailable (stripped ELF)': '沒有區段標頭：無法取得符號表（已移除符號的 ELF）',
  'no .symtab section: symbol table unavailable (stripped ELF)': '沒有 .symtab 區段：無法取得符號表（已移除符號的 ELF）',
  'built for the hard-float ABI (EF_ARM_ABI_FLOAT_HARD): the Cortex-M3 has no FPU — floating-point instructions will fault':
    '以硬體浮點 ABI 建置（EF_ARM_ABI_FLOAT_HARD）：Cortex-M3 沒有 FPU——浮點指令會引發錯誤',
  '.symtab out of bounds: symbols skipped': '.symtab 超出範圍：已略過符號',
  '.strtab out of bounds: symbols skipped': '.strtab 超出範圍：已略過符號',
  'no Intel HEX records found': '找不到任何 Intel HEX 記錄',
  'missing end-of-file record (:00000001FF) — file truncated?': '缺少檔案結尾記錄（:00000001FF）——檔案被截斷了嗎？',
  'no data records: nothing to program': '沒有資料記錄：沒有可燒錄的內容',
  'boot alias beyond system memory (BOOT0 = 1)': '開機別名超出系統記憶體範圍（BOOT0 = 1）',
  'flash is not writable': '快閃記憶體無法直接寫入',
  'system memory / option bytes are read-only on the bus': '系統記憶體／選項位元組在匯流排上為唯讀',
  'FPEC locked until reset after a wrong key sequence': '金鑰順序錯誤後 FPEC 會鎖定到重置',
  'wrong flash key sequence': '快閃記憶體金鑰順序錯誤',
  'flash write without FLASH_CR.PG': '在沒有 FLASH_CR.PG 的情況下寫入快閃記憶體',

  // ---- SoC / peripherals (fixed log texts)
  'no vector table at 0x08000000 (erased): the core will fault right after reset': '0x08000000 沒有向量表（已抹除）：核心會在重置後立即發生錯誤',
  'VDD below the POR/PDR threshold: MCU held in reset, all pins high-Z': 'VDD 低於 POR/PDR 臨界值：MCU 保持在重置狀態，所有腳位為高阻抗',
  'BOOT0 = 1: the MCU boots the ST system-memory bootloader, which is not emulated — the core idles in a stub loop. Move the BOOT0 jumper to 0 to run the firmware in flash.':
    'BOOT0 = 1：MCU 會從 ST 系統記憶體開機載入程式開機，但此程式未模擬——核心會在空迴圈中閒置。請把 BOOT0 跳線移到 0，以執行快閃記憶體中的韌體。',
  'BOOT0 = 1, BOOT1 = 1: boot from SRAM is not emulated — the core idles in a stub loop.': 'BOOT0 = 1、BOOT1 = 1：未模擬從 SRAM 開機——核心會在空迴圈中閒置。',
  'backup domain reset (RCC_BDCR.BDRST)': '備份域重置（RCC_BDCR.BDRST）',
  'AFIO_EVCR.EVOE: the Cortex EVENTOUT pin output is not simulated (unsupported)': 'AFIO_EVCR.EVOE：未模擬 Cortex EVENTOUT 腳位輸出（不支援）',
  'CAN remap set: bxCAN is not implemented (unsupported)': '已設定 CAN 重映射：bxCAN 未實作（不支援）',
  'AFIO_MAPR2 remaps exist only on XL-density / value-line devices: no effect on the STM32F103C8': 'AFIO_MAPR2 重映射只存在於 XL 密度／超值系列元件：對 STM32F103C8 沒有作用',
  'backup register write ignored: the backup domain is write-protected — set PWR_CR.DBP first (HAL_PWR_EnableBkUpAccess())': '寫入備份暫存器已忽略：備份域受寫入保護——請先設定 PWR_CR.DBP（HAL_PWR_EnableBkUpAccess()）',
  'BKP_RTCCR CCO/ASOE outputs on PC13 need the RTC, which is not implemented (unsupported)': 'PC13 上的 BKP_RTCCR CCO/ASOE 輸出需要 RTC，而 RTC 未實作（不支援）',
  'tamper event on PC13: backup data registers cleared': 'PC13 發生竄改事件：已清除備份資料暫存器',
  'DBGMCU_CR.TRACE_IOEN: trace output (TRACESWO / TRACEDATA) is not simulated': 'DBGMCU_CR.TRACE_IOEN：未模擬追蹤輸出（TRACESWO／TRACEDATA）',
  'FLASH_CR write ignored: the flash interface is locked (HAL_FLASH_Unlock() first)': '寫入 FLASH_CR 已忽略：快閃記憶體介面已鎖定（請先呼叫 HAL_FLASH_Unlock()）',
  'option-byte programming/erase (OPTPG/OPTER) is not supported: ignored, the option bytes keep their factory values': '不支援選項位元組燒寫／抹除（OPTPG/OPTER）：已忽略，選項位元組保持出廠值',
  'flash programmed with the HSI off: PM0075 §2.3 requires the HSI for program/erase': 'HSI 關閉時燒寫了快閃記憶體：PM0075 §2.3 要求燒寫／抹除時 HSI 必須開啟',
  'flash erased with the HSI off: PM0075 §2.3 requires the HSI for program/erase': 'HSI 關閉時抹除了快閃記憶體：PM0075 §2.3 要求燒寫／抹除時 HSI 必須開啟',
  'independent watchdog timeout: MCU reset (RCC_CSR.IWDGRSTF)': '獨立看門狗逾時：MCU 重置（RCC_CSR.IWDGRSTF）',
  'Standby mode (SLEEPDEEP + PDDS) is approximated as Sleep: clocks keep running, SRAM is kept and wake-up does not reset the MCU':
    '待機模式（SLEEPDEEP + PDDS）以睡眠模式近似：時脈持續運作、SRAM 內容保留，且喚醒時不會重置 MCU',
  'Stop mode (SLEEPDEEP, PDDS = 0) is approximated as Sleep: HSE/PLL keep running and the wake-up does not switch SYSCLK back to the HSI':
    '停止模式（SLEEPDEEP，PDDS = 0）以睡眠模式近似：HSE/PLL 持續運作，且喚醒時 SYSCLK 不會切回 HSI',
  'PVD enabled: VDD is taken as nominal (3.3 V), so PVDO stays 0 and EXTI line 16 never fires': '已啟用 PVD：VDD 視為標稱值（3.3 V），因此 PVDO 保持為 0，EXTI 線 16 永遠不會觸發',
  'HSEBYP ignored: it can only be changed while HSEON = 0': 'HSEBYP 已忽略：只能在 HSEON = 0 時變更',
  'clock security system enabled (CSSON): the simulated HSE never fails, so CSS never triggers': '已啟用時脈安全系統（CSSON）：模擬的 HSE 不會故障，因此 CSS 永遠不會觸發',
  'HSION cannot be cleared while the HSI is (or is selected to be) the system clock or the PLL input': 'HSI 是（或被選為）系統時脈或 PLL 輸入時，不能清除 HSION',
  'HSEON cannot be cleared while the HSE is (or is selected to be) the system clock or the PLL input': 'HSE 是（或被選為）系統時脈或 PLL 輸入時，不能清除 HSEON',
  'PLLON cannot be cleared while the PLL is (or is selected to be) the system clock': 'PLL 是（或被選為）系統時脈時，不能清除 PLLON',
  'PLLSRC/PLLXTPRE/PLLMUL write ignored: the PLL configuration can only be changed while PLLON = 0': '寫入 PLLSRC/PLLXTPRE/PLLMUL 已忽略：PLL 設定只能在 PLLON = 0 時變更',
  'MCO clock output on PA8 is not simulated (a MHz-rate square wave cannot be represented on the circuit time step): PA8 stays at its AF default':
    '未模擬 PA8 上的 MCO 時脈輸出（MHz 級方波無法在電路時間步階上呈現）：PA8 維持 AF 預設狀態',
  'SW = 11 is "not allowed" (RM0008 §7.3.2): ignored': 'SW = 11「不允許」（RM0008 §7.3.2）：已忽略',
  'RCC_BDCR write ignored: the backup domain is write-protected — set PWR_CR.DBP first (HAL_PWR_EnableBkUpAccess())': '寫入 RCC_BDCR 已忽略：備份域受寫入保護——請先設定 PWR_CR.DBP（HAL_PWR_EnableBkUpAccess()）',
  'RTCSEL is fixed until a backup-domain reset (RCC_BDCR.BDRST)': 'RTCSEL 在備份域重置（RCC_BDCR.BDRST）前固定不變',
  'RTCEN set: the RTC is not implemented (unsupported)': '已設定 RTCEN：RTC 未實作（不支援）',

  // ---- peripheral support table: block names that are words
  'Memory map': '記憶體映射',

  // ---- PERIPHERAL SUPPORT NOTES (src/mcu/stm32f1/peripherals.ts, *_NOTES, TIM_SUPPORT) — exact texts
  '128 KiB flash at 0x08000000 (C8 datasheet: 64 KiB — larger images load with a warning), boot alias by BOOT0, 20 KiB SRAM, F_SIZE = 64, fixed 96-bit UID, factory option bytes, BusFault on unmapped / reserved addresses. The ST system-memory bootloader (BOOT0 = 1) is not emulated: the core parks in a stub loop and an error is logged.':
    '位於 0x08000000 的 128 KiB 快閃記憶體（C8 資料手冊：64 KiB——較大的映像檔載入時會出現警告）、依 BOOT0 決定的開機別名、20 KiB SRAM、F_SIZE = 64、固定的 96 位元 UID、出廠選項位元組、存取未映射／保留位址時產生 BusFault。未模擬 ST 系統記憶體開機載入程式（BOOT0 = 1）：核心會停在空迴圈中，並記錄一則錯誤。',
  'All F103 registers. HSI ready at reset; HSE 8 MHz ready 1 ms after HSEON; PLL lock 200 µs; LSI 85 µs; LSE 500 ms. SW → SWS only to ready sources; protected HSION/HSEON/PLLON; PLL config only while PLLON = 0; full clock tree (PLLSRC/PLLXTPRE/PLLMUL, HPRE, PPRE1/2, ADCPRE, TIMxCLK ×2) with datasheet-limit warnings; exact cycle↔time rebase on every HCLK change; APBxRSTR resets; CSR reset flags (POR/PIN/SFT/IWDG/WWDG/LPWR); ready interrupts. CSS never triggers (the simulated crystal cannot fail); MCO is not output.':
    'F103 的所有暫存器。重置時 HSI 已就緒；HSE 8 MHz 在 HSEON 後 1 ms 就緒；PLL 鎖定 200 µs；LSI 85 µs；LSE 500 ms。SW → SWS 只會切換到已就緒的時脈源；HSION/HSEON/PLLON 受保護；PLL 設定只能在 PLLON = 0 時變更；完整時脈樹（PLLSRC/PLLXTPRE/PLLMUL、HPRE、PPRE1/2、ADCPRE、TIMxCLK ×2），超出資料手冊限制時發出警告；每次 HCLK 變更時精確換算週期↔時間；APBxRSTR 重置；CSR 重置旗標（POR/PIN/SFT/IWDG/WWDG/LPWR）；就緒中斷。CSS 永遠不會觸發（模擬的石英晶體不會故障）；不輸出 MCO。',
  'ACR (latency-too-low warning), KEYR unlock (wrong key = bus error + lock-out), half-word programming with PGERR, page / mass erase, BSY timing (52.5 µs / 20 ms), EOP and interrupts. Not modelled: the CPU stall while BSY, option-byte programming, write protection.':
    'ACR（等待週期過少時發出警告）、KEYR 解鎖（錯誤金鑰 = 匯流排錯誤 + 鎖定）、含 PGERR 的半字組燒寫、頁抹除／整片抹除、BSY 時序（52.5 µs／20 ms）、EOP 與中斷。未模擬：BSY 期間的 CPU 停頓、選項位元組燒寫、寫入保護。',
  'GPIOA–D on the LQFP48 bonding (PA0–15, PB0–15, PC13–15, PD0–1): CRL/CRH/IDR/ODR/BSRR/BRR/LCKR incl. the lock key sequence; all MODE × CNF combinations; pull-up/down via ODR; RCC gating (writes with IOPxEN = 0 are ignored, with a hint); JTAG/SWD pins owned by the debug port until SWJ_CFG releases them; oscillator pins. Port E registers exist but have no pins.':
    '依 LQFP48 引出腳位的 GPIOA–D（PA0–15、PB0–15、PC13–15、PD0–1）：CRL/CRH/IDR/ODR/BSRR/BRR/LCKR（含鎖定金鑰順序）；所有 MODE × CNF 組合；透過 ODR 設定上拉／下拉；RCC 時脈閘控（IOPxEN = 0 時的寫入會被忽略，並提示）；JTAG/SWD 腳位在 SWJ_CFG 釋放前歸除錯埠所有；振盪器腳位。埠 E 的暫存器存在但沒有腳位。',
  'MAPR remaps (USART/SPI/I2C/TIM/CAN fields, PD01), SWJ_CFG write-only semantics, EXTICR1–4, MAPR2 (no effect on this device). EVCR EVENTOUT is stored but not driven onto a pin.':
    'MAPR 重映射（USART/SPI/I2C/TIM/CAN 欄位、PD01）、SWJ_CFG 唯寫語意、EXTICR1–4、MAPR2（對此元件沒有作用）。EVCR EVENTOUT 會被儲存，但不會輸出到腳位。',
  'All registers; rising/falling edges at the exact cycle (pin inputs and own outputs), SWIER, PR write-1-to-clear, IRQ lines 6–10/23/40, events (EMR) to the core. Lines 16–18 (PVD, RTC alarm, USB wake-up) have no source.':
    '所有暫存器；在精確的週期偵測正緣／負緣（腳位輸入與自身輸出）、SWIER、PR 寫 1 清除、IRQ 線 6–10/23/40、送往核心的事件（EMR）。線 16–18（PVD、RTC 警報、USB 喚醒）沒有來源。',
  'CR/CSR incl. DBP backup-domain protection and EWUP (PA0 pull-down). Stop / Standby are approximated as Sleep (logged); PVD output constant (VDD nominal).':
    'CR/CSR，含 DBP 備份域保護與 EWUP（PA0 下拉）。停止模式／待機模式以睡眠模式近似（會記錄於日誌）；PVD 輸出固定（VDD 為標稱值）。',
  'Not implemented: registers read 0, writes ignored. RCC_BDCR (LSE, RTCSEL, RTCEN) itself works.': '未實作：暫存器讀為 0，寫入會被忽略。RCC_BDCR（LSE、RTCSEL、RTCEN）本身可正常運作。',
  'Not implemented: registers read 0, writes ignored.': '未實作：暫存器讀為 0，寫入會被忽略。',
  'Not implemented: reads 0, writes ignored.': '未實作：讀取為 0，寫入會被忽略。',
  'Full register model: free-running 7-bit counter at PCLK1/4096/2^WDGTB, window check, T6 reset, early-wakeup interrupt (IRQ 0), WWDGRSTF, DBG_WWDG_STOP freeze. The prescaler phase restarts on each CR write (≤ 1 tick difference from silicon). Unit-tested only.':
    '完整暫存器模型：以 PCLK1/4096/2^WDGTB 自由運行的 7 位元計數器、視窗檢查、T6 重置、提早喚醒中斷（IRQ 0）、WWDGRSTF、DBG_WWDG_STOP 凍結。每次寫入 CR 時預除頻器相位會重新開始（與實際晶片相差 ≤ 1 個計數）。僅做過單元測試。',
  'Full register model: KR keys, PR/RLR write protection, PVU/RVU update delay, LSI 40 kHz timing, reset with IWDGRSTF (+PINRSTF), DBG_IWDG_STOP freeze. Hardware-watchdog option byte not modelled (factory default = software watchdog).':
    '完整暫存器模型：KR 金鑰、PR/RLR 寫入保護、PVU/RVU 更新延遲、LSI 40 kHz 計時、以 IWDGRSTF（+PINRSTF）重置、DBG_IWDG_STOP 凍結。未模擬硬體看門狗選項位元組（出廠預設 = 軟體看門狗）。',
  'DR1–DR10 with PWR_CR.DBP write protection, kept across system resets, cleared by power-on / BDRST; tamper detection on PC13 (TEF/TIF, IRQ 2). RTC calibration/alarm outputs (RTCCR CCO/ASOE) need the RTC (unsupported).':
    'DR1–DR10，具 PWR_CR.DBP 寫入保護，系統重置後保留，上電／BDRST 時清除；PC13 上的竄改偵測（TEF/TIF、IRQ 2）。RTC 校正／警報輸出（RTCCR CCO/ASOE）需要 RTC（不支援）。',
  'Full: CRC-32/0x04C11DB7 on 32-bit words, IDR, CR.RESET. The 4-cycle computation latency is not timed (reads see the result at once, as a stalled read would). Unit-tested only.':
    '完整：以 32 位元字組計算 CRC-32/0x04C11DB7、IDR、CR.RESET。未模擬 4 個週期的計算延遲（讀取會立即得到結果，等同被停頓的讀取）。僅做過單元測試。',
  'Asynchronous mode: BRR baud from PCLK, 8/9-bit words, parity, 0.5/1/1.5/2 stop bits, bit-exact TX waveform on the AF pin (incl. the TE idle preamble and SBK breaks), RX from pin edges with 3-sample majority (NE), FE/PE/ORE/IDLE and the SR→DR clear sequences, TXE/TC/RXNE/IDLE/PE/error interrupts, DMA request lines, AFIO remaps (remaps onto pins the LQFP48 does not bond are reported). Not simulated (logged): synchronous/CK, LIN, IrDA, smartcard, half-duplex, RTS/CTS, mute mode.':
    '非同步模式：由 PCLK 與 BRR 決定鮑率、8/9 位元字組、同位檢查、0.5/1/1.5/2 停止位元、AF 腳位上逐位元精確的 TX 波形（含 TE 閒置前導與 SBK 中斷字元）、依腳位邊緣以 3 次取樣多數決接收 RX（NE）、FE/PE/ORE/IDLE 與 SR→DR 清除順序、TXE/TC/RXNE/IDLE/PE/錯誤中斷、DMA 請求線、AFIO 重映射（重映射到 LQFP48 未引出的腳位時會回報）。未模擬（會記錄於日誌）：同步模式／CK、LIN、IrDA、智慧卡、半雙工、RTS/CTS、靜音模式。',
  'Bit-level SPI on SCK/MOSI/MISO/NSS: master SCK at f_PCLK/2^(BR+1) with exact edge cycles, CPOL/CPHA modes 0–3 (MISO sampled on the right edge), 8/16-bit frames, MSB/LSB first, continuous transfers (BSY), TXE/RXNE/OVR, RXONLY and BIDIMODE/BIDIOE, hardware NSS output (SSOE), software NSS (SSM/SSI), MODF, slave mode clocked by the SCK pin (NSS pin or SSI select), hardware CRC (CRCPR, TXCRCR/RXCRCR, CRCNEXT, CRCERR), interrupt and DMA request lines, AFIO SPI1 remap. Not simulated (logged): I2S (not present on the STM32F103C8), tri-stating the data line in bidirectional receive mode (GPIO model limitation: configure that pin as input).':
    'SCK/MOSI/MISO/NSS 上的位元層級 SPI：主端 SCK 為 f_PCLK/2^(BR+1)，邊緣週期精確；CPOL/CPHA 模式 0–3（MISO 在正確的邊緣取樣）、8/16 位元資料框、MSB/LSB 先傳、連續傳輸（BSY）、TXE/RXNE/OVR、RXONLY 與 BIDIMODE/BIDIOE、硬體 NSS 輸出（SSOE）、軟體 NSS（SSM/SSI）、MODF、由 SCK 腳位提供時脈的從端模式（以 NSS 腳位或 SSI 選取）、硬體 CRC（CRCPR、TXCRCR/RXCRCR、CRCNEXT、CRCERR）、中斷與 DMA 請求線、AFIO SPI1 重映射。未模擬（會記錄於日誌）：I2S（STM32F103C8 沒有此功能）、雙向接收模式下將資料線設為三態（GPIO 模型限制：請把該腳位設為輸入）。',
  'Bit-level I²C on the SCL/SDA pins (open-drain AF outputs, wired-AND with the circuit): START / repeated START / STOP generation and detection, Sm and Fm (DUTY) SCL timing from CCR and PCLK1, clock stretching honoured through the TRISE feedback check, ACK/NACK (AF), arbitration loss (ARLO), BUSY from the line levels (a missing pull-up keeps it set), the SR1/SR2 event sequences and clearing rules ST HAL relies on (EV5–EV9, 1-/2-/N-byte reception with ACK/POS, BTF stretching, 10-bit master addressing), slave mode with 7-bit OAR1/OAR2/general call (ADDR, TxE, RxNE, STOPF, AF, SCL stretching, NOSTRETCH overrun/underrun), BERR, PEC (CRC-8 in SR2, transmission and check), event/error interrupts, DMA request lines and LAST (EOT_1 read from the DMA counter). Not simulated (logged): SMBus mode (SMBA pin, timeouts, ARP addresses), 10-bit slave addressing, multi-master clock synchronisation, the analog noise filter; PE = 0 takes effect at once.':
    'SCL/SDA 腳位上的位元層級 I²C（開汲極 AF 輸出，與電路形成線及）：START／重複 START／STOP 的產生與偵測、由 CCR 與 PCLK1 決定的 Sm 與 Fm（DUTY）SCL 時序、透過 TRISE 回授檢查支援時脈延展、ACK/NACK（AF）、仲裁失敗（ARLO）、依線路準位判定 BUSY（缺少上拉電阻時會一直保持）、ST HAL 依賴的 SR1/SR2 事件順序與清除規則（EV5–EV9、搭配 ACK/POS 的 1／2／N 位元組接收、BTF 延展、10 位元主端定址）、支援 7 位元 OAR1/OAR2／廣播呼叫的從端模式（ADDR、TxE、RxNE、STOPF、AF、SCL 延展、NOSTRETCH 溢位／欠位）、BERR、PEC（SR2 中的 CRC-8，傳送與檢查）、事件／錯誤中斷、DMA 請求線與 LAST（由 DMA 計數器讀取 EOT_1）。未模擬（會記錄於日誌）：SMBus 模式（SMBA 腳位、逾時、ARP 位址）、10 位元從端定址、多主端時脈同步、類比雜訊濾波器；PE = 0 會立即生效。',
  'Independent mode: ADON power-up (tSTAB 1 µs) and the second-ADON-write start quirk, RSTCAL/CAL with timed self-clearing (tCAL 83 ADCCLK), (SMPx + 12.5) ADCCLK conversions with trigger latency, sampling of the pin voltage at the end of the sampling window, code = Vin/VDDA × 4095 (VDDA = MCU supply), IN0–IN9 on PA0–PA7/PB0–PB1, temperature sensor (V25 1.43 V, 4.3 mV/°C, settable die temperature) and VREFINT 1.20 V on ADC1 IN16/IN17, single / continuous / scan / discontinuous regular groups, injected groups (triggered, JAUTO, JDISCEN, JOFRx offsets, sign extension), left/right alignment, analog watchdog, EOC/JEOC/AWD interrupts on IRQ 18, SWSTART/JSWSTART and timer triggers (TRGO/CCx via the SoC trigger routing), ADC1 DMA requests. Real HAL firmware exercises calibration, single and continuous scan conversions, software start, DMA and the internal channels (hal-adc-pot, hal-adc-dma); the injected group, discontinuous mode, the analog watchdog and timer triggers are unit-tested only. Not simulated (logged): dual modes (DUALMOD), EXTI line 11/15 triggers, sample-and-hold source-impedance error; IN10–IN15 are not bonded on the LQFP48.':
    '獨立模式：ADON 上電（tSTAB 1 µs）與「第二次寫入 ADON 才啟動」的特性、具計時自動清除的 RSTCAL/CAL（tCAL 83 ADCCLK）、含觸發延遲的 (SMPx + 12.5) ADCCLK 轉換、在取樣窗結束時取樣腳位電壓、轉換值 = Vin/VDDA × 4095（VDDA = MCU 電源）、PA0–PA7/PB0–PB1 上的 IN0–IN9、ADC1 IN16/IN17 上的溫度感測器（V25 1.43 V、4.3 mV/°C、可設定晶粒溫度）與 VREFINT 1.20 V、單次／連續／掃描／不連續的規則群組、注入群組（觸發、JAUTO、JDISCEN、JOFRx 偏移、符號延伸）、左／右對齊、類比看門狗、IRQ 18 上的 EOC/JEOC/AWD 中斷、SWSTART/JSWSTART 與計時器觸發（經 SoC 觸發路由的 TRGO/CCx）、ADC1 DMA 請求。真實 HAL 韌體驗證了校正、單次與連續掃描轉換、軟體啟動、DMA 與內部通道（hal-adc-pot、hal-adc-dma）；注入群組、不連續模式、類比看門狗與計時器觸發僅做過單元測試。未模擬（會記錄於日誌）：雙 ADC 模式（DUALMOD）、EXTI 線 11/15 觸發、取樣保持的訊號源阻抗誤差；IN10–IN15 在 LQFP48 上未引出。',
  '7 channels: CCR/CNDTR/CPAR/CMAR, ISR/IFCR, peripheral requests per Table 78 (OR-ed by the SoC, level-driven, acknowledged after each transfer), priority arbitration (PL, then channel number) re-taken after every transfer, peripheral↔memory and memory-to-memory, PSIZE/MSIZE packing per Table 76, APB byte/half-word write replication (§13.3.5), PINC/MINC, circular mode, HT/TC/TE flags and IRQs 11–17, transfer error on bus faults (TEIF, EN cleared). Real HAL firmware exercises memory-to-memory, ADC1 → memory circular, USART1 TX (memory → peripheral) and circular RX with HT/TC/IDLE handling (hal-dma-m2m, hal-adc-dma, hal-uart-dma); priorities, packing, lane replication and transfer errors are unit-tested only. Timing approximation: 2 HCLK arbitration + 2 HCLK per memory access, 2 HCLK + 1 APB clock per APB access (6–8 HCLK per transfer); CPU stalls from bus-matrix contention and flash wait states on DMA reads are not modelled.':
    '7 個通道：CCR/CNDTR/CPAR/CMAR、ISR/IFCR、依 Table 78 的周邊請求（由 SoC 以 OR 合併、準位觸發、每次傳輸後確認）、每次傳輸後重新進行的優先權仲裁（先比 PL，再比通道編號）、周邊↔記憶體與記憶體到記憶體、依 Table 76 的 PSIZE/MSIZE 打包、APB 位元組／半字組寫入複製（§13.3.5）、PINC/MINC、循環模式、HT/TC/TE 旗標與 IRQ 11–17、匯流排錯誤時的傳輸錯誤（TEIF，清除 EN）。真實 HAL 韌體驗證了記憶體到記憶體、ADC1 → 記憶體循環、USART1 TX（記憶體 → 周邊）以及含 HT/TC/IDLE 處理的循環 RX（hal-dma-m2m、hal-adc-dma、hal-uart-dma）；優先權、打包、通道複製與傳輸錯誤僅做過單元測試。時序近似：仲裁 2 HCLK + 每次記憶體存取 2 HCLK，每次 APB 存取 2 HCLK + 1 個 APB 時脈（每次傳輸 6–8 HCLK）；未模擬匯流排矩陣競爭造成的 CPU 停頓，以及 DMA 讀取時的快閃記憶體等待週期。',
  // timers: GP_NOTES + per-timer suffix (tim.ts TIM_SUPPORT)
  [GP_EN +
  ' Firmware-verified on TIM2: PWM output (hal-tim-pwm 1 kHz on PA0; hal-servo 50 Hz on PA1 with preloaded CCR2 steps) and PWM input capture with slave reset mode and URS (hal-tim-capture on PA0).']:
    GP_ZH +
    '在 TIM2 上經韌體驗證：PWM 輸出（hal-tim-pwm 在 PA0 輸出 1 kHz；hal-servo 在 PA1 輸出 50 Hz，以預載的 CCR2 步進）以及搭配從端重置模式與 URS 的 PWM 輸入捕捉（hal-tim-capture，PA0）。',
  [GP_EN +
  ' Firmware-verified on TIM3: PWM output (hal-tim-pwm 20 kHz on PA6, also through the circuit coordinator driving an LED; hal-pwm-fade with the update interrupt and preloaded CCR1; hal-tim-capture generator with preloaded ARR/CCR1 changes). TIM3_ETR (PD2) and the full remap (PC6–PC9) are not bonded on the LQFP48 (reported).']:
    GP_ZH +
    '在 TIM3 上經韌體驗證：PWM 輸出（hal-tim-pwm 在 PA6 輸出 20 kHz，也透過電路協調器驅動 LED；hal-pwm-fade 使用更新中斷與預載的 CCR1；hal-tim-capture 的訊號產生端使用預載的 ARR/CCR1 變更）。TIM3_ETR（PD2）與完全重映射（PC6–PC9）在 LQFP48 上未引出（會回報）。',
  [GP_EN +
  ' Firmware-verified on TIM4: update-interrupt time base (hal-tim-irq) and encoder mode 3 with the input filter (hal-tim-encoder on PB6/PB7). TIM4_ETR (PE0) and the remap (PD12–PD15) are not bonded on the LQFP48 (reported).']:
    GP_ZH +
    '在 TIM4 上經韌體驗證：更新中斷時基（hal-tim-irq）與搭配輸入濾波器的編碼器模式 3（hal-tim-encoder，PB6/PB7）。TIM4_ETR（PE0）與重映射（PD12–PD15）在 LQFP48 上未引出（會回報）。',
  ['Advanced-control timer: everything listed for TIM2–4, plus the repetition counter, BDTR (MOE/AOE — a hint is logged when TIM1 counts with outputs enabled but MOE = 0; complementary CHxN outputs with DTG/CKD dead time; OSSR/OSSI off-states and OISx/OISxN idle levels, applied at once without the asynchronous CCxP phase; break input BKIN on PB12 / PA6 and BG, level-sensitive; LOCK 1–3, write-once), COM preload (CCPC, COMG, CCUS) and outputs disabled during the debug freeze. ' +
  'Firmware-verified: PWM on PA8 with MOE set by HAL_TIM_PWM_Start (hal-tim-pwm). Unit-tested only: repetition counter, dead time, break, AOE, COM, LOCK. ' +
  GP_C_EN +
  ' The full remap (port E) is not bonded on the LQFP48 (reported).']:
    '進階控制計時器：包含 TIM2–4 所列的所有功能，另有重複計數器、BDTR（MOE/AOE——TIM1 在輸出已致能但 MOE = 0 時計數會記錄提示；具 DTG/CKD 死區時間的互補 CHxN 輸出；OSSR/OSSI 關閉狀態與 OISx/OISxN 閒置準位，立即套用而沒有非同步的 CCxP 相位；PB12／PA6 上的煞車輸入 BKIN 與 BG，準位觸發；LOCK 1–3，只能寫入一次）、COM 預載（CCPC、COMG、CCUS），以及除錯凍結期間停用輸出。' +
    '韌體驗證：由 HAL_TIM_PWM_Start 設定 MOE，在 PA8 上輸出 PWM（hal-tim-pwm）。僅做過單元測試：重複計數器、死區時間、煞車、AOE、COM、LOCK。' +
    GP_C_ZH +
    '完全重映射（埠 E）在 LQFP48 上未引出（會回報）。',
})
