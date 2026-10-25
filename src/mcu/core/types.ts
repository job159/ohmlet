/**
 * MCU emulation core contracts (pure TypeScript, no DOM — runs in node tests
 * and inside the simulation Web Worker).
 *
 * CONTRACT FILE — the CPU core, the SoC models and the simulation coordinator
 * all code against these types. Change only with coordinated edits.
 *
 * Time base: every MCU counts CORE CLOCK CYCLES (HCLK on STM32) in a float64
 * `cycles` counter (exact integers up to 2^53 ≈ 3.6 years at 72 MHz). The SoC
 * maps cycles to simulation seconds (it owns the clock tree); the coordinator
 * only ever talks seconds to the analog solver.
 */

/** Width of one bus access in bytes. */
export type AccessSize = 1 | 2 | 4

/**
 * A memory-mapped register block on the system bus. `offset` is relative to
 * the block base. Reads return the zero-extended value of `size` bytes;
 * writes pass the value truncated to `size` bytes. A device decides itself
 * how sub-word accesses behave (most STM32 APB registers take 16/32-bit
 * accesses; see each model's notes).
 */
export interface MmioDevice {
  readonly name: string
  read(offset: number, size: AccessSize): number
  write(offset: number, value: number, size: AccessSize): void
}

/**
 * Thrown (as a preallocated-style plain object) by the bus for an access to
 * an unmapped address or a device that refuses the access. The CPU converts
 * it into a precise BusFault (escalated to HardFault when BusFault is
 * disabled). Never thrown for normal register accesses.
 */
export class BusFault {
  constructor(
    public addr: number,
    public write: boolean,
    public reason: string,
  ) {}
}

/** The system bus as seen by the CPU (little-endian, physical addresses). */
export interface SystemBus {
  read8(addr: number): number
  read16(addr: number): number
  read32(addr: number): number
  write8(addr: number, v: number): void
  write16(addr: number, v: number): void
  write32(addr: number, v: number): void
  /**
   * Instruction fetch of one halfword. May use a faster path than read16 and
   * may throw BusFault (→ prefetch abort semantics: IBUSERR).
   */
  fetch16(addr: number): number
  /**
   * Monotonic counter bumped whenever executable memory (flash or any region
   * code might run from) is modified, so decode caches can invalidate.
   */
  readonly codeVersion: number
  /** byte range [start, end) of the last code modification (optional, lets caches invalidate partially) */
  readonly codeWriteRange?: { start: number; end: number }
}

/**
 * Shared cycle clock. The CPU writes `cycles` before every instruction; a
 * peripheral reading a counter register (SysTick VAL, TIMx CNT, DWT CYCCNT)
 * derives the value from it lazily instead of ticking every cycle.
 */
export interface CycleClock {
  cycles: number
}

/** Handle returned by Scheduler.schedule (0 is never a valid handle). */
export type EventHandle = number

/**
 * Discrete-event queue in CORE CYCLES. Peripherals schedule their next
 * interesting instant (SysTick wrap, timer update/compare, UART bit,
 * I2C/SPI bit edge, ADC end of conversion …) instead of ticking per cycle.
 * Events at the same cycle run in scheduling order (FIFO, deterministic).
 * The CPU runs due events at instruction boundaries; an event's callback
 * receives the cycle it was SCHEDULED for (exact edge timestamps) even if the
 * boundary came a few cycles later.
 */
export interface Scheduler {
  schedule(atCycle: number, fn: (cycle: number) => void): EventHandle
  cancel(h: EventHandle): void
  /** cycle of the earliest pending event, Infinity when empty */
  nextAt(): number
  /** run every event with at <= cycle, in order (events may schedule more) */
  runDue(cycle: number): void
  clear(): void
}

/** Why `run()` returned. */
export type StopReason =
  | 'target' // reached the requested cycle
  | 'sync' // a peripheral requested an early sync (e.g. analog-coupled pin edge)
  | 'breakpoint'
  | 'halted' // debugger halt / single-step finished
  | 'lockup' // core locked up (fault inside HardFault/NMI)
  | 'sleep' // WFI/WFE with nothing pending before the target (time fast-forwarded)
