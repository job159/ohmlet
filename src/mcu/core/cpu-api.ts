/**
 * Cortex-M core ↔ SoC contract.
 *
 * CONTRACT FILE. `src/mcu/core/cpu.ts` implements `CortexMCore`; SoC models
 * (src/mcu/stm32f1/…) construct it and drive it through this surface only.
 *
 * The core owns everything ARM defines inside the processor: registers, the
 * Thumb-2 (ARMv7-M) instruction set without FP/DSP extensions, the exception
 * model, and the System Control Space (SCS) at 0xE000E000 — NVIC, SCB,
 * SysTick — plus DWT.CYCCNT / DEMCR and ITM stimulus ports. The SoC owns the
 * system bus outside the PPB, the clock tree and all vendor peripherals.
 *
 * Address routing done INSIDE the core (never reaches SystemBus):
 *  - 0xE0000000–0xE003FFFF internal PPB (ITM, DWT, FPB, SCS). Unimplemented
 *    PPB registers read as zero / ignore writes and are logged once.
 *  - bit-band aliases 0x22000000–0x23FFFFFF → SRAM 0x20000000 and
 *    0x42000000–0x43FFFFFF → peripherals 0x40000000: the core turns an alias
 *    word access into a read(-modify-write) of the containing byte/word on
 *    the SystemBus (Cortex-M3 bit-banding).
 * Everything else, including the external PPB 0xE0040000–0xE00FFFFF (e.g.
 * STM32 DBGMCU at 0xE0042000), goes to SystemBus.
 */
import type { CycleClock, Scheduler, StopReason, SystemBus } from './types'

/** Static configuration of an implemented core. */
export interface CoreConfig {
  /** CPUID register value (STM32F103: 0x411FC231 = Cortex-M3 r1p1) */
  cpuid: number
  /** number of external interrupt lines (STM32F103xB: 43, IRQ 0..42) */
  numIrq: number
  /** implemented priority bits (STM32: 4 → priorities in steps of 16) */
  priorityBits: number
  /** SysTick CALIB register value (STM32F103: 0x00002328 → TENMS=9000 @ 9 MHz) */
  systickCalib: number
}

/** Callbacks from the core to its SoC. */
export interface CoreHooks {
  /** AIRCR.SYSRESETREQ written with a valid VECTKEY: the SoC resets the whole MCU. */
  systemResetRequest(): void
  /**
   * SysTick external reference clock, in core cycles per reference tick
   * (STM32F1: SysTick CLKSOURCE=0 → HCLK/8 → returns 8). CLKSOURCE=1 counts
   * every core cycle.
   */
  systickRefDivider(): number
  /** ITM stimulus port write (byte-sized payload as written by firmware). */
  itmWrite?(port: number, value: number, size: 1 | 2 | 4): void
  /** Sleep-state changes (WFI/WFE entry/exit) — power stats / UI only. */
  sleepChanged?(sleeping: boolean, deep: boolean): void
  /** Simulation log (faults, lockup, unpredictable encodings, unsupported features). */
  log?(level: 'info' | 'warning' | 'error', message: string): void
}

/** Snapshot of the architectural state (debug UI, tests). */
export interface CoreRegisters {
  r: number[] // r0..r15 (r13 = active SP, r15 = address of the NEXT instruction to execute)
  xpsr: number
  msp: number
  psp: number
  primask: number
  basemask: number // BASEPRI
  faultmask: number
  control: number
}

export interface CoreFaultInfo {
  cfsr: number
  hfsr: number
  mmfar: number
  bfar: number
}

export interface CortexMCore {
  readonly config: CoreConfig
  readonly clock: CycleClock

  /** Core reset: SCS registers to reset values, MSP/PC loaded from the vector table at VTOR=0. */
  reset(): void

  /**
   * Execute until `clock.cycles >= untilCycle`, or earlier on: requestSync(),
   * a breakpoint, halt/lockup. While sleeping (WFI/WFE) with no pending
   * wake-up, time jumps directly to the next scheduled event (or the target).
   * Due scheduler events run at instruction boundaries.
   */
  run(untilCycle: number): StopReason
  /** Make the current/next run() return at the next instruction boundary with 'sync'. */
  requestSync(): void

  /**
   * External interrupt line level (level-sensitive, as on STM32: a
   * peripheral holds its IRQ asserted while its enabled flag is set).
   * Asserting sets NVIC pending (unless the IRQ is active); a still-asserted
   * line re-pends when its handler returns; ICPR cannot clear an asserted line.
   */
  setIrqLine(irq: number, asserted: boolean): void
  /** Pulse an IRQ pending bit (edge-style, e.g. a software event). */
  pendIrq(irq: number): void
  /** System exception pending (NMI = 2). */
  pendNmi(): void
  /** External event input (SEV from another source) — wakes WFE. */
  signalEvent(): void

  readonly sleeping: boolean
  readonly lockedUp: boolean
  /** debugger halt state */
  halted: boolean

  /** Execute exactly one instruction (or take one pending exception entry) while halted. */
  stepInstruction(): void
  readonly breakpoints: Set<number>

  registers(): CoreRegisters
  /** write a general register (debugger); 15 = PC */
  setRegister(n: number, value: number): void
  faultInfo(): CoreFaultInfo
  /** retired instruction count (performance stats) */
  readonly instructions: number
}

/** Factory signature implemented by cpu.ts. */
export type CreateCortexM3 = (
  bus: SystemBus,
  scheduler: Scheduler,
  clock: CycleClock,
  hooks: CoreHooks,
  config: CoreConfig,
) => CortexMCore
