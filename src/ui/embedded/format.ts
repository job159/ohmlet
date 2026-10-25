/**
 * Formatting + presentation metadata shared by the embedded-lab views
 * (firmware panel, terminal, logic analyzer, log). Pure functions.
 *
 * Quantities (volts, amps, watts, percent, speed) go through the app's one
 * unit formatter (UX helper H3, src/instruments/format.ts) — the inspector
 * readings below only add what a reading may say instead of a number
 * (IN-14): 「—（求解器未收斂）」 for a voltage the solver could not compute
 * (|V| > 1 kV or not finite), 「> 2 A（短路）」 / 「—（短路）」 for a short,
 * 「0 A」 below 1 nA (never 「−0 pA」).
 */
import type { McuRunState } from '../../mcu/mcu-api'
import { t } from '../../i18n'
import { CURRENT_FLOOR_A, fmtCurrent, fmtPercent, fmtPower, fmtSpeedFactor, fmtVoltage } from '../../instruments/format'
import { inSystemMemory } from '../../sim/erc/mcu-state'

export { inSystemMemory }

/** A pin / net voltage the solver computed: 「3.30 V」, 「500 mV」; a solver artefact reads 「—（求解器未收斂）」. */
export function fmtReadingVoltage(v: number | null | undefined, opts: { precision?: 'compact' | 'reading' } = {}): string {
  if (v === undefined || v === null) return '—'
  return fmtVoltage(v, { ...opts, invalid: t('— (solver did not converge)') })
}

/** A measured current: 「9.70 mA」, 「0 A」 below 1 nA, 「> 2 A（短路）」 above 2 A. */
export function fmtReadingCurrent(i: number | null | undefined, opts: { precision?: 'compact' | 'reading' } = {}): string {
  return fmtCurrent(i, opts)
}

/** A measured power: 「31.0 mW」; 「—（短路）」 when the current says it is a short. */
export function fmtReadingPower(w: number | null | undefined, current?: number | null): string {
  return fmtPower(w, { current })
}

/** A bench supply that delivers practically nothing (below 1 µA): its readout leads with the voltage (IN-14). */
export const NO_LOAD_A = 1e-6

/** Is this supply current "no load" (|I| < 1 µA, never a negative zero)? */
export function isNoLoad(i: number | null | undefined): boolean {
  return typeof i === 'number' && Number.isFinite(i) && Math.abs(i) < NO_LOAD_A
}

/** A brightness 0…1 as a whole percentage (「97 %」). */
export function fmtBrightness(b: number): string {
  return fmtPercent(Math.max(0, Math.min(1, b)), { digits: 0 })
}

/** The achieved simulation speed (H3): 「0.2 倍速」, 「< 0.01 倍速」. */
export function fmtSpeed(r: number | undefined): string {
  return fmtSpeedFactor(r)
}

export { CURRENT_FLOOR_A }

/**
 * UI-level MCU status: the model's run states plus what the panel can say
 * honestly about them (UX wave IN-2):
 *   'no-data'     — the simulation runs but no frame reported this MCU yet
 *   'idle'        — nothing has run since the last reset (never "unpowered"
 *                   before Run: VDD is simply not computed yet)
 *   'paused'      — the core was running when the simulation was paused
 *   'boot-sysmem' — running from system memory (BOOT0 = 1): the ROM
 *                   bootloader is not simulated
 */
export type McuUiState = McuRunState | 'no-data' | 'idle' | 'paused' | 'boot-sysmem'

/**
 * McuUiState plus 'fault-handler' (QA IN-F7): the core runs its own fault
 * handler (IPSR 3–6 — HardFault, MemManage, BusFault, UsageFault), so the
 * frame says 'running' but the firmware is stuck there. Kept apart from
 * McuUiState because McuUiState is a ToneState (H6 stateColor takes it as
 * is); 'fault-handler' is shown in lockup's colour (mcuStateTone).
 */
export type McuViewState = McuUiState | 'fault-handler'

/** The shared tone state (H6 STATE_TONE) a view state is shown in: a fault handler is red like a lockup. */
export function mcuStateTone(state: McuViewState): McuUiState {
  return state === 'fault-handler' ? 'lockup' : state
}

export interface McuStateMeta {
  label: string
  /** CSS color (kit palette token) — the same as UX helper H6 STATE_TONE (the badge reads stateColor()) */
  color: string
  /** one-line explanation for tooltips / a11y (datasheet references live here only) */
  hint: string
}

export const MCU_STATE_META: Record<McuUiState, McuStateMeta> = {
  idle: { label: 'Not run yet', color: 'var(--label-2)', hint: 'The simulation has not run since the last reset' },
  paused: { label: 'Paused', color: 'var(--ios-blue)', hint: 'The simulation is paused; the core resumes where it stopped' },
  'boot-sysmem': {
    label: 'System-memory boot (not simulated)',
    color: 'var(--ios-orange)',
    hint: 'PC is in system memory 0x1FFFF000–0x1FFFF7FF: BOOT0 = 1 starts the ROM bootloader (RM0008 §3.4), which is not simulated',
  },
  running: { label: 'Running', color: 'var(--ios-green)', hint: 'Executing firmware' },
  sleeping: {
    label: 'Sleeping',
    color: 'var(--ios-teal)',
    hint: 'Core stopped in WFI/WFE until a wake-up event (ARMv7-M ARM, power management)',
  },
  halted: { label: 'Halted', color: 'var(--ios-orange)', hint: 'Stopped by the debugger' },
  reset: { label: 'In reset', color: 'var(--ios-yellow)', hint: 'NRST held low' },
  lockup: {
    label: 'Fault',
    color: 'var(--ios-red)',
    hint: 'Lockup: a fault occurred while handling a fault (ARMv7-M ARM, unrecoverable exceptions)',
  },
  unpowered: {
    label: 'Unpowered',
    color: 'var(--ios-red)',
    hint: 'VDD below the POR/PDR threshold — held in reset (DS5319 §5.3.3)',
  },
  'no-firmware': { label: 'No firmware', color: 'var(--ios-orange)', hint: 'Load an ELF, BIN or HEX image' },
  'no-data': {
    label: 'No data yet',
    color: 'var(--label-3)',
    hint: 'No simulation frame has reported this MCU yet',
  },
}

/**
 * The 'fault-handler' view state (QA IN-F7) — beside MCU_STATE_META, whose
 * keys are exactly the H6 tone states; shown in lockup's red. The badge names
 * the handler (faultHandlerLabel): 「在 HardFault 處理常式中」.
 */
export const FAULT_HANDLER_META: McuStateMeta = {
  label: 'In a fault handler',
  color: 'var(--ios-red)',
  hint: 'A fault exception is active (IPSR 3–6): the core runs the fault handler instead of the program (ARMv7-M ARM, fault handling)',
}

/** The meta of any view state (MCU_STATE_META, or FAULT_HANDLER_META). */
export function mcuStateMeta(state: McuViewState): McuStateMeta {
  return state === 'fault-handler' ? FAULT_HANDLER_META : MCU_STATE_META[state]
}

/**
 * Simulated seconds after a start before an 'unpowered' frame is a reading:
 * the first frames of a run come before the board's supply was evaluated
 * (the model starts unpowered), so a board fed 5 V would flash 「沒有供電」
 * on every ▶ (QA follow-up). The problems list waits the same time before it
 * files 「U1 沒有供電」 — the badge and the list agree.
 */
export const POWER_UP_GRACE_S = 0.05

export interface McuStateInput {
  /** a firmware image is bound to this board (lab firmware record) */
  hasFirmware: boolean
  running: boolean
  simTime: number
  /**
   * the simulation is past POWER_UP_GRACE_S since its start; false → an
   * 'unpowered' frame is the start-up, shown as 'no-data' (正在等待模擬的第一筆回報).
   * Omitted: every frame is taken as it is.
   */
  powerSettled?: boolean
  /** the newest frame of this MCU (lab snapshot, telemetry fallback); null = none since the last reset */
  frame: { state: McuRunState; pc: number } | null
}

/**
 * McuStateInput whose frame also says which exception is active (IN-F7):
 * `exception` = the IPSR exception number (McuFrameInfo.exception — 0 =
 * thread mode; undefined / null = not reported). The key is required (it may
 * hold undefined) so this overload is chosen only by callers that read it.
 */
export interface McuFaultStateInput extends Omit<McuStateInput, 'frame'> {
  frame: { state: McuRunState; pc: number; exception: number | null | undefined } | null
}

/**
 * The honest UI state of one MCU board (IN-2), in this order:
 * no firmware bound → 'no-firmware'; a debugger halt / lockup as reported;
 * not running and nothing run since the last reset → 'idle' (VDD is not
 * computed before Run, so this is never "unpowered"); running but no frame
 * yet, or an 'unpowered' frame within POWER_UP_GRACE_S of the start (when the
 * caller says so: powerSettled false) → 'no-data'; PC in system memory → 'boot-sysmem'; a running core in
 * its own fault handler (exception 3–6, when the frame reports it) →
 * 'fault-handler' (also while the simulation is paused: the fault is the
 * news); a running core of a paused simulation → 'paused'; otherwise the
 * frame's own state.
 */
export function mcuUiStateOf(i: McuFaultStateInput): McuViewState
export function mcuUiStateOf(i: McuStateInput): McuUiState
export function mcuUiStateOf(i: McuStateInput | McuFaultStateInput): McuViewState {
  if (!i.hasFirmware) return 'no-firmware'
  const f = i.frame
  if (f?.state === 'lockup') return 'lockup'
  if (f?.state === 'halted') return 'halted'
  if (!i.running && (i.simTime === 0 || !f)) return 'idle'
  if (!f) return 'no-data'
  // the run's first frames, before the supply was evaluated: not a reading (POWER_UP_GRACE_S)
  if (f.state === 'unpowered' && i.powerSettled === false) return 'no-data'
  const executing = f.state === 'running' || f.state === 'sleeping'
  if (executing && inSystemMemory(f.pc)) return 'boot-sysmem'
  if (executing && 'exception' in f && faultExceptionName(f.exception) !== null) return 'fault-handler'
  if (executing && !i.running) return 'paused'
  return f.state
}

/** States in which PC / cycles / clock / speed mean nothing: the panel shows 「—」. */
export function mcuReadoutsHidden(state: McuViewState): boolean {
  return state === 'idle' || state === 'no-firmware' || state === 'unpowered' || state === 'reset' || state === 'no-data'
}

/**
 * Fault status bits (ARMv7-M ARM B3.2.15 CFSR = MMFSR | BFSR << 8 | UFSR << 16,
 * B3.2.16 HFSR): bit → register field name + what it means (English source,
 * shown through t()). Only the "something happened" bits — MMARVALID /
 * BFARVALID merely say the address registers are valid.
 */
export const CFSR_BITS: readonly (readonly [number, string, string])[] = [
  [0, 'IACCVIOL', 'instruction access violation'],
  [1, 'DACCVIOL', 'data access violation'],
  [3, 'MUNSTKERR', 'MPU fault while unstacking on exception return'],
  [4, 'MSTKERR', 'MPU fault while stacking on exception entry'],
  [8, 'IBUSERR', 'instruction bus error'],
  [9, 'PRECISERR', 'precise data bus error'],
  [10, 'IMPRECISERR', 'imprecise data bus error'],
  [11, 'UNSTKERR', 'bus fault while unstacking on exception return'],
  [12, 'STKERR', 'bus fault while stacking on exception entry'],
  [16, 'UNDEFINSTR', 'undefined instruction'],
  [17, 'INVSTATE', 'invalid state (Thumb bit clear)'],
  [18, 'INVPC', 'invalid PC load on exception return'],
  [19, 'NOCP', 'no coprocessor'],
  [24, 'UNALIGNED', 'unaligned access'],
  [25, 'DIVBYZERO', 'divide by zero'],
]
export const HFSR_BITS: readonly (readonly [number, string, string])[] = [
  [1, 'VECTTBL', 'vector table read failed'],
  [30, 'FORCED', 'escalated to HardFault'],
  [31, 'DEBUGEVT', 'debug event'],
]

/** The set fault bits of CFSR / HFSR, in register order: { name: 'IACCVIOL', text: English source }. */
export function decodeFaultBits(cfsr: number, hfsr: number): { reg: 'CFSR' | 'HFSR'; name: string; text: string }[] {
  const out: { reg: 'CFSR' | 'HFSR'; name: string; text: string }[] = []
  for (const [bit, name, text] of CFSR_BITS) if (((cfsr >>> bit) & 1) === 1) out.push({ reg: 'CFSR', name, text })
  for (const [bit, name, text] of HFSR_BITS) if (((hfsr >>> bit) & 1) === 1) out.push({ reg: 'HFSR', name, text })
  return out
}

// ---------------------------------------------------------------------------
// a core in its own fault handler (QA IN-F7)
// ---------------------------------------------------------------------------

/** The fault exceptions by IPSR number (ARMv7-M ARM B1.5.2): the handlers a core can get stuck in. */
const FAULT_EXCEPTIONS: Readonly<Record<number, 'HardFault' | 'MemManage' | 'BusFault' | 'UsageFault'>> = {
  3: 'HardFault',
  4: 'MemManage',
  5: 'BusFault',
  6: 'UsageFault',
}

/** IPSR 3–6 → 'HardFault' / 'MemManage' / 'BusFault' / 'UsageFault'; anything else (thread mode, an IRQ) → null. */
export function faultExceptionName(exception: number | null | undefined): 'HardFault' | 'MemManage' | 'BusFault' | 'UsageFault' | null {
  return typeof exception === 'number' ? (FAULT_EXCEPTIONS[exception] ?? null) : null
}

/** The fault status registers a frame may carry (McuFrameInfo.fault; CoreFaultInfo + the faulting PC when known). */
export interface FaultRegisters {
  cfsr: number
  hfsr: number
  mmfar?: number
  bfar?: number
  /** PC of the instruction that faulted (the stacked return address), when the model reports it */
  pc?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * The active exception and fault registers of an MCU frame — McuFrameInfo
 * `exception` (IPSR) and `fault` (SIM-F2). Read structurally, so a frame
 * without them (older hosts, the telemetry fallback) gives nulls — the board
 * is then never called "in a fault handler" (no guessing).
 */
export function frameFaultOf(frame: object | null | undefined): { exception: number | null; fault: FaultRegisters | null } {
  if (!frame) return { exception: null, fault: null }
  const f = frame as { exception?: unknown; fault?: unknown }
  const exception = num(f.exception) ?? null
  const raw = f.fault && typeof f.fault === 'object' ? (f.fault as Record<string, unknown>) : null
  const cfsr = num(raw?.cfsr)
  const hfsr = num(raw?.hfsr)
  if (!raw || cfsr === undefined || hfsr === undefined) return { exception, fault: null }
  const fault: FaultRegisters = { cfsr, hfsr }
  const mmfar = num(raw.mmfar)
  const bfar = num(raw.bfar)
  const pc = num(raw.pc) ?? num(raw.faultPc) ?? num(raw.stackedPc)
  if (mmfar !== undefined) fault.mmfar = mmfar
  if (bfar !== undefined) fault.bfar = bfar
  if (pc !== undefined) fault.pc = pc
  return { exception, fault }
}

/** 「在 HardFault 處理常式中」 — the MCU badge / 執行狀態 card of a core in its fault handler. */
export function faultHandlerLabel(exception: number | null | undefined): string {
  const name = faultExceptionName(exception)
  return name ? t('In the {fault} handler', { fault: name }) : t(`${FAULT_HANDLER_META.label}|mcu-state`)
}

/** CFSR.MMARVALID (bit 7) / CFSR.BFARVALID (bit 15): the address register holds the faulting address. */
const MMARVALID = 1 << 7
const BFARVALID = 1 << 15

/**
 * What the fault registers say, as one clause (decoded CFSR / HFSR,
 * ARMv7-M ARM B3.2.15–B3.2.18): 「精確 BusFault：存取 0x30000000 時出錯（pc
 * 0x08000042）」, 「UsageFault：未定義指令」, 「HardFault：讀取向量表失敗」.
 * Only the bits that are set are named (the address only when its VALID bit
 * says so, the PC only when the frame reports it); null without registers or
 * set bits.
 */
export function faultCauseText(fault: FaultRegisters | null | undefined): string | null {
  if (!fault) return null
  const pcPart = fault.pc !== undefined ? t(' (pc {pc})', { pc: fmtAddr(fault.pc) }) : ''
  const cfsr = fault.cfsr >>> 0
  const bfar = (cfsr & BFARVALID) !== 0 && fault.bfar !== undefined ? fmtAddr(fault.bfar) : null
  const mmar = (cfsr & MMARVALID) !== 0 && fault.mmfar !== undefined ? fmtAddr(fault.mmfar) : null
  if (cfsr & (1 << 9)) {
    return (bfar ? t('Precise BusFault: the access to {addr} failed', { addr: bfar }) : t('Precise BusFault: a data access failed')) + pcPart
  }
  if (cfsr & (1 << 1)) {
    return (mmar ? t('MemManage: access to {addr} not allowed', { addr: mmar }) : t('MemManage: data access violation')) + pcPart
  }
  const bits = decodeFaultBits(cfsr, fault.hfsr >>> 0).filter((b) => b.name !== 'FORCED' && b.name !== 'DEBUGEVT')
  const first = bits[0]
  if (!first) return (fault.hfsr >>> 30) & 1 ? t('HardFault: a fault escalated to HardFault') + pcPart : null
  const bit = first.reg === 'HFSR' ? -1 : (CFSR_BITS.find((b) => b[1] === first.name)?.[0] ?? -1)
  const kind = first.reg === 'HFSR' ? 'HardFault' : bit < 8 ? 'MemManage' : bit < 16 ? 'BusFault' : 'UsageFault'
  return t('{kind}: {cause}', { kind, cause: t(first.text) }) + pcPart
}

/**
 * What usually sets a fault bit, as the next thing to check (one plain
 * sentence per bit; English sources, zh-TW in qa-inspector.ts). Only bits a
 * Blue Pill's Cortex-M3 raises without an MPU; FORCED / DEBUGEVT say nothing
 * about the cause.
 */
const FAULT_HINTS: Readonly<Record<string, string>> = {
  PRECISERR: 'Common cause: a pointer to an address where nothing is (an uninitialised or miscalculated pointer).',
  IMPRECISERR:
    'Common cause: a write through a pointer to an address where nothing is (writes are buffered, so the pc shown is past the store).',
  IBUSERR: 'Common cause: a jump to an address with no program (a wrong function pointer, or a return address overwritten on the stack).',
  IACCVIOL: 'Common cause: a jump into a region that cannot run code (peripherals or the system area), usually a wrong function pointer.',
  STKERR: 'Common cause: the stack ran out (a stack overflow past the end of RAM).',
  UNSTKERR: 'Common cause: the stack was overwritten (for example a local array written past its end).',
  UNDEFINSTR: 'Common cause: a jump to an address that holds no code (a wrong function pointer), or data run as instructions.',
  INVSTATE: 'Common cause: a jump to an even address (Thumb bit clear), for example a function pointer without |1.',
  INVPC: 'Common cause: the exception return value (LR) was corrupted, usually because the stack was overwritten.',
  NOCP: 'Common cause: the firmware uses floating-point unit (FPU) instructions, but the Cortex-M3 has no FPU; build it with software floating point.',
  DIVBYZERO: 'Check that the divisor is not 0 before dividing (the firmware turned on the divide-by-zero trap).',
  UNALIGNED:
    'Common cause: a byte array cast to a 32-bit pointer and read at an unaligned address (the firmware turned on the unaligned-access trap).',
  VECTTBL: 'Common cause: no vector table where VTOR points (for example the image is not at 0x08000000).',
}

/** The bit faultCauseText names, in its order: PRECISERR, DACCVIOL, else the first set bit but FORCED / DEBUGEVT. */
function leadingFaultBit(fault: FaultRegisters): string | null {
  const cfsr = fault.cfsr >>> 0
  if (cfsr & (1 << 9)) return 'PRECISERR'
  if (cfsr & (1 << 1)) return 'DACCVIOL'
  return decodeFaultBits(cfsr, fault.hfsr >>> 0).find((b) => b.name !== 'FORCED' && b.name !== 'DEBUGEVT')?.name ?? null
}

/** 「常見原因：指標指向不存在的位址…」 — what to check for the fault the registers name; null when they name none. */
export function faultHintText(fault: FaultRegisters | null | undefined): string | null {
  const bit = fault ? leadingFaultBit(fault) : null
  const hint = bit ? FAULT_HINTS[bit] : undefined
  return hint ? t(hint) : null
}

/** Sentences in a row: Chinese ones follow each other directly, English ones after a space. */
function sentences(parts: readonly string[]): string {
  return parts.reduce((out, s) => (out === '' ? s : /[。！？]$/.test(out) ? `${out}${s}` : `${out} ${s}`), '')
}

/**
 * The full explanation of a core stuck in its fault handler (the problem row
 * and the 執行狀態 card say it with these very words): the decoded cause, what
 * it means, and what usually causes it — 「精確 BusFault：存取 0x30000000 時出錯
 * （pc 0x08000042）。核心停在 HardFault_Handler（預設的處理常式是無窮迴圈），
 * 程式不會再往下執行。常見原因：指標指向不存在的位址（…）。」
 */
export function faultHandlerDetail(exception: number | null | undefined, fault: FaultRegisters | null | undefined): string {
  const name = faultExceptionName(exception) ?? 'HardFault'
  const cause = faultCauseText(fault)
  const stuck = t('The core is in {handler} (the default handler is an endless loop), so the program does not go on.', { handler: `${name}_Handler` })
  const hint = faultHintText(fault)
  return sentences([...(cause ? [t('{text}.', { text: cause })] : []), stuck, ...(hint ? [hint] : [])])
}

// ---------------------------------------------------------------------------
// the register grid in words (QA clarity GLOSSARY-ENTRIES)
// ---------------------------------------------------------------------------

/**
 * STM32F103 (medium density) interrupt names by IRQ number (RM0008 Table 63,
 * "other STM32F10xxx devices"): IPSR = 16 + IRQ.
 */
const F103_IRQS: readonly string[] = [
  'WWDG', 'PVD', 'TAMPER', 'RTC', 'FLASH', 'RCC', 'EXTI0', 'EXTI1', 'EXTI2', 'EXTI3', 'EXTI4',
  'DMA1_Channel1', 'DMA1_Channel2', 'DMA1_Channel3', 'DMA1_Channel4', 'DMA1_Channel5', 'DMA1_Channel6', 'DMA1_Channel7',
  'ADC1_2', 'USB_HP_CAN_TX', 'USB_LP_CAN_RX0', 'CAN_RX1', 'CAN_SCE', 'EXTI9_5',
  'TIM1_BRK', 'TIM1_UP', 'TIM1_TRG_COM', 'TIM1_CC', 'TIM2', 'TIM3', 'TIM4',
  'I2C1_EV', 'I2C1_ER', 'I2C2_EV', 'I2C2_ER', 'SPI1', 'SPI2', 'USART1', 'USART2', 'USART3',
  'EXTI15_10', 'RTCAlarm', 'USBWakeup',
]

/** The Cortex-M3 system exceptions by number (ARMv7-M ARM B1.5.2). */
const SYSTEM_EXCEPTIONS: Readonly<Record<number, string>> = {
  1: 'Reset',
  2: 'NMI',
  3: 'HardFault',
  4: 'MemManage',
  5: 'BusFault',
  6: 'UsageFault',
  11: 'SVCall',
  12: 'DebugMonitor',
  14: 'PendSV',
  15: 'SysTick',
}

/**
 * What an IPSR value means, in words: 0 → 「一般程式」 (thread mode), 3 →
 * 'HardFault', 15 → 'SysTick', 53 → 「USART1 中斷」 (IRQ 37); an IRQ the
 * table does not name → 「IRQ 50」. null for a value that is not a number.
 */
export function exceptionName(ipsr: number | null | undefined): string | null {
  if (typeof ipsr !== 'number' || !Number.isFinite(ipsr) || ipsr < 0) return null
  const n = Math.trunc(ipsr)
  if (n === 0) return t('normal program|ipsr')
  if (n < 16) return SYSTEM_EXCEPTIONS[n] ?? t('reserved|ipsr')
  const irq = F103_IRQS[n - 16]
  return irq ? t('{name} interrupt', { name: irq }) : `IRQ ${n - 16}`
}

/** The ipsr cell of the register grid: 「3（HardFault）」, 「0（一般程式）」, 「53（USART1 中斷）」. */
export function fmtIpsr(ipsr: number | null | undefined): string {
  if (typeof ipsr !== 'number' || !Number.isFinite(ipsr)) return '—'
  const name = exceptionName(ipsr)
  return name ? t('{n} ({name})|ipsr', { n: Math.trunc(ipsr), name }) : String(ipsr)
}

/**
 * MMFAR / BFAR hold a faulting address only while CFSR.MMARVALID (bit 7) /
 * CFSR.BFARVALID (bit 15) says so (ARMv7-M ARM B3.2.17 / B3.2.18); otherwise
 * their content means nothing and the grid shows 「—（無效）」.
 */
export function faultAddressValid(cfsr: number, which: 'mmfar' | 'bfar'): boolean {
  return ((cfsr >>> 0) & (which === 'mmfar' ? MMARVALID : BFARVALID)) !== 0
}

/** The mmfar / bfar cell: the address while it is valid, else 「—（無效）」. */
export function fmtFaultAddress(value: number | undefined, cfsr: number, which: 'mmfar' | 'bfar'): string {
  return faultAddressValid(cfsr, which) && value !== undefined ? fmtAddr(value) : t('— (not valid)|fault-address')
}

// ---------------------------------------------------------------------------
// why the core locked up, when the app knows (QA clarity LOCKUP-CAUSE)
// ---------------------------------------------------------------------------

/** STM32F1 main flash base — the default load address of a raw .bin (RM0008 §3.3.3). */
export const DEFAULT_BIN_BASE = 0x08000000

/** "raw binary, 1234 bytes at 0x08004000" → 0x08004000 (the address a bound .bin was loaded at); null otherwise. */
export function boundBinBase(record: { format: string; description?: string } | null | undefined): number | null {
  if (!record || record.format !== 'bin') return null
  const m = /at (0x[0-9a-f]+)$/i.exec(record.description ?? '')
  return m ? parseInt(m[1].slice(2), 16) : null
}

/**
 * What the app knows about why a core locked up right at start-up — from the
 * bound image itself, never a guess:
 *   'bin-base'      a .bin loaded somewhere else than 0x08000000 (the flash is
 *                   erased before programming, so 0x08000000 holds no vector table)
 *   'no-vectors'    the loader found 0x08000000 erased (an ELF / HEX linked elsewhere)
 *   'bad-sp'        the vector table's first word (initial SP) is not in SRAM
 *   'reset-thumb'   the reset vector has the Thumb bit clear
 *   'reset-outside' the reset vector does not point into flash
 * The loader's warnings (Stm32f103.loadFirmware — the record's own and the
 * `<id>/loader` log lines) name the last four.
 */
export type LockupCause =
  | { kind: 'bin-base'; file: string; base: number }
  | { kind: 'no-vectors'; file: string }
  | { kind: 'bad-sp'; file: string; sp: string }
  | { kind: 'reset-thumb'; file: string; vector: string }
  | { kind: 'reset-outside'; file: string; vector: string }

/** The vector-table warnings of the STM32F1 loader (src/mcu/stm32f1/soc.ts loadFirmware). */
const VECTOR_WARNINGS: readonly [RegExp, (m: RegExpExecArray, file: string) => LockupCause][] = [
  [/^no vector table at 0x08000000\b/, (_m, file) => ({ kind: 'no-vectors', file })],
  [/^initial stack pointer (0x[0-9a-f]+) is not inside/i, (m, file) => ({ kind: 'bad-sp', file, sp: fmtAddr(parseInt(m[1].slice(2), 16)) })],
  [/^reset vector (0x[0-9a-f]+) has the Thumb bit clear/i, (m, file) => ({ kind: 'reset-thumb', file, vector: fmtAddr(parseInt(m[1].slice(2), 16)) })],
  [/^reset vector (0x[0-9a-f]+) does not point into flash/i, (m, file) => ({ kind: 'reset-outside', file, vector: fmtAddr(parseInt(m[1].slice(2), 16)) })],
]

/**
 * The known cause of a lockup (null = the app does not know): a .bin at
 * another base first (its fix is one click — reload at 0x08000000), then the
 * loader's vector-table warnings in the order above.
 */
export function lockupCauseOf(
  record: { name: string; format: string; description?: string; warnings?: readonly string[] } | null | undefined,
  loaderWarnings: readonly string[] = [],
): LockupCause | null {
  if (!record) return null
  const base = boundBinBase(record)
  if (base !== null && base !== DEFAULT_BIN_BASE) return { kind: 'bin-base', file: record.name, base }
  const warnings = [...(record.warnings ?? []), ...loaderWarnings]
  for (const [re, make] of VECTOR_WARNINGS) {
    for (const w of warnings) {
      const m = re.exec(w)
      if (m) return make(m, record.name)
    }
  }
  return null
}

/**
 * The cause as the sentence the 執行狀態 card and the problem row say:
 * 「bare-blink.bin 載入在 0x08001000，所以 0x08000000 沒有向量表，核心一開機就出錯。」
 */
export function lockupCauseText(c: LockupCause): string {
  switch (c.kind) {
    case 'bin-base':
      return t('{file} is loaded at {addr}, so there is no vector table at 0x08000000 and the core faults as soon as it starts.', {
        file: c.file,
        addr: fmtAddr(c.base),
      })
    case 'no-vectors':
      return t('{file} puts nothing at 0x08000000, so there is no vector table there and the core faults as soon as it starts.', { file: c.file })
    case 'bad-sp':
      return t('The first word of {file}’s vector table (the initial stack pointer {sp}) is not inside SRAM (0x20000000–0x20005000), so the core faults as soon as it starts.', {
        file: c.file,
        sp: c.sp,
      })
    case 'reset-thumb':
      return t('The reset vector of {file} ({addr}) has the Thumb bit clear, so the core faults as soon as it starts.', { file: c.file, addr: c.vector })
    case 'reset-outside':
      return t('The reset vector of {file} ({addr}) does not point into flash, so the core faults as soon as it starts.', { file: c.file, addr: c.vector })
  }
}

/**
 * Every 32-bit address (0x + 5–8 hex digits) in a loader text in the one
 * address form of the inspector (fmtAddr — upper-case, 8 digits): 「Thumb
 * 進入點 0x08000B45」 beside 「PC 0x0800074A」. Short hex values stay as written.
 */
export function upperAddresses(text: string): string {
  return text.replace(/\b0x([0-9a-fA-F]{5,8})\b/g, (_m, hex: string) => fmtAddr(parseInt(hex, 16)))
}

/** The APSR condition flags of xPSR (bits 31..28). */
export function xpsrFlags(xpsr: number): { N: boolean; Z: boolean; C: boolean; V: boolean } {
  return { N: ((xpsr >>> 31) & 1) === 1, Z: ((xpsr >>> 30) & 1) === 1, C: ((xpsr >>> 29) & 1) === 1, V: ((xpsr >>> 28) & 1) === 1 }
}

/** 32-bit address as 0x08000131 (upper-case digits, fixed width). */
export function fmtAddr(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

/** Cycle / byte counts with thin grouping: 12 345 678. */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

/** Core clock: 72 MHz, 8 MHz, 36.864 MHz. */
export function fmtMHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—'
  const mhz = hz / 1e6
  const s = Number.isInteger(mhz) ? String(mhz) : parseFloat(mhz.toFixed(3)).toString()
  return `${s} MHz`
}

/** Real-time factor as a percentage (1 → 100 %). */
export function fmtRealtime(r: number | undefined): string {
  if (r === undefined || !Number.isFinite(r)) return '—'
  const pct = r * 100
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)} %`
}

/** File size: 1.2 KiB / 18.4 KiB / 312 B. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

/**
 * Simulation time with a unit that keeps ~4 significant digits:
 * 1.234 s · 12.35 ms · 8.68 µs · 120 ns.
 */
export function fmtSimTime(t: number): string {
  if (!Number.isFinite(t)) return '—'
  const a = Math.abs(t)
  if (a === 0) return '0 s'
  if (a >= 1) return `${t.toFixed(a >= 100 ? 1 : 3)} s`
  if (a >= 1e-3) return `${(t * 1e3).toFixed(a >= 0.1 ? 1 : 2)} ms`
  if (a >= 1e-6) return `${(t * 1e6).toFixed(a >= 1e-4 ? 1 : 2)} µs`
  return `${(t * 1e9).toFixed(0)} ns`
}

/** Log/terminal timestamp: fixed 6 decimals of seconds (µs resolution). */
export function fmtStamp(t: number): string {
  if (!Number.isFinite(t)) return '—'
  return t.toFixed(6)
}

/** Parse "0x08000000" / "134217728" → number, or null when invalid. */
export function parseAddress(text: string): number | null {
  const s = text.trim().replace(/_/g, '')
  if (s === '') return null
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s.slice(2), 16) : /^\d+$/.test(s) ? Number(s) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null
  return n
}
