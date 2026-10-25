/**
 * MCU model ↔ simulation coordinator contract. CONTRACT FILE.
 *
 * An `McuDevice` is a complete microcontroller (core + memories + vendor
 * peripherals + pins) executing real firmware instructions. The coordinator
 * runs it in lockstep with the circuit solver in VIRTUAL time:
 *
 *   - MCU time == simulation time (seconds since the simulation started).
 *     `runUntil(t)` executes instructions until the MCU clock reaches `t`.
 *   - The MCU converts seconds ↔ core cycles through its own clock tree
 *     (which firmware may reconfigure, e.g. HSI 8 MHz → PLL 72 MHz).
 *   - Pin drive changes are reported synchronously through
 *     `pins.listener.pinDriveChanged(pin, cycle)`; `timeOfCycle(cycle)` maps
 *     the exact edge to seconds. The coordinator may call `requestSync()`
 *     from inside that callback to stop `runUntil` at the next instruction
 *     boundary (used for pins coupled to the analog solver).
 *   - Inputs are pushed with `pins.setInput(...)`.
 *
 * Nothing here may depend on the DOM: models run in node tests and inside
 * the simulation Web Worker.
 */
import type { StopReason } from './core/types'
import type { CoreFaultInfo, CoreRegisters } from './core/cpu-api'
import type { FirmwareImage } from './firmware'
import type { McuPinPort } from './pins'

/** Per-peripheral honesty table shown in the UI and docs. */
export type SupportStatus =
  | 'verified' // implemented AND exercised by a real-firmware integration test
  | 'partial' // implemented subset (see notes); tested where stated
  | 'unsupported' // registers read 0 / ignore writes, every access logged

export interface PeripheralSupport {
  /** e.g. 'GPIO', 'USART1', 'TIM2', 'I2C1' */
  name: string
  status: SupportStatus
  /** what works / what does not — plain sentences */
  notes: string
  /** ids of integration tests (firmware names) that verify this block */
  verifiedBy?: string[]
}

/** A peripheral-level serial port tap (virtual terminal / USB-serial bridge). */
export interface UartTap {
  /** 'USART1' … */
  readonly name: string
  /**
   * Called for every byte the firmware's USART shifts out (at the cycle the
   * STOP bit completes). For 9-bit frames without parity the 9-bit value is
   * passed. Set by the coordinator.
   */
  onTx: ((byte: number, cycle: number) => void) | null
  /**
   * Host → MCU: queue bytes for reception. They are delivered to RX at the
   * USART's configured baud rate (one frame time per byte), setting RXNE /
   * ORE exactly as a wire would. Bytes sent while the receiver is disabled
   * are dropped (and logged).
   */
  send(bytes: Uint8Array): void
  /** current line configuration as programmed by firmware */
  config(): UartLineConfig
}

export interface UartLineConfig {
  enabled: boolean
  baud: number // 0 when unknown/disabled
  dataBits: 8 | 9
  parity: 'none' | 'even' | 'odd'
  stopBits: 0.5 | 1 | 1.5 | 2
}

export interface McuLogEvent {
  /** simulation time (s) */
  time: number
  level: 'info' | 'warning' | 'error'
  /** 'core', 'RCC', 'GPIOA', 'USART1', 'loader' … */
  source: string
  message: string
}

export type McuRunState =
  | 'no-firmware'
  | 'unpowered' // VDD below the brown-out threshold: held in reset
  | 'reset' // NRST held low
  | 'running'
  | 'sleeping' // WFI/WFE
  | 'halted' // debugger
  | 'lockup' // fault escalation failed

export interface McuDebugState {
  state: McuRunState
  registers: CoreRegisters
  faults: CoreFaultInfo
  cycles: number
  instructions: number
  /** current core clock (Hz) as configured by firmware */
  hclkHz: number
  /** active exception number (0 = thread mode) */
  ipsr: number
  /** name of the function containing PC, when symbols are available */
  pcSymbol?: string
  /**
   * Name of the function LR returns into, when symbols are available and LR
   * holds a return address — absent for an EXC_RETURN value (0xFFFFFFF1 /
   * 0xFFFFFFF9 / 0xFFFFFFFD: inside an exception handler LR only says how to
   * return) and for the reset value 0xFFFFFFFF. Additive.
   */
  lrSymbol?: string
  /**
   * Peripherals the firmware has switched on, by their support-table names
   * (`McuDevice.support[].name`, table order): bus-gated blocks whose RCC
   * enable bit is set (AHBENR / APB2ENR / APB1ENR), blocks on their own
   * clock once enabled (e.g. an unmasked EXTI line, a started watchdog),
   * plus the always-used core ('Memory map', 'RCC', 'FLASH'). Additive; models
   * without clock gating omit it.
   */
  clocked?: readonly string[]
  /**
   * The pin-remap register as firmware programmed it (STM32F1: AFIO_MAPR,
   * SWJ_CFG reading 0) — which pins the remappable peripherals use. Additive.
   */
  afioMapr?: number
}

export interface McuDevice {
  /** e.g. 'stm32f103c8' */
  readonly model: string
  readonly pins: McuPinPort
  readonly uarts: readonly UartTap[]
  readonly support: readonly PeripheralSupport[]

  /** Program the firmware (does NOT reset; callers reset afterwards). */
  loadFirmware(img: FirmwareImage): { ok: boolean; errors: string[]; warnings: string[] }
  readonly firmware: FirmwareImage | null

  /**
   * 'power-on': every register/peripheral/RAM to reset state (RAM contents
   * are NOT preserved), reset flags PORRSTF|PINRSTF.
   * 'pin': NRST pulse (RAM preserved, PINRSTF).
   */
  reset(kind: 'power-on' | 'pin'): void
  /**
   * Supply supervision. `false` (VDD under the POR/PDR threshold) holds the
   * MCU in reset and releases every pin to high-Z; the rising edge performs a
   * power-on reset.
   */
  setPowered(on: boolean): void
  readonly powered: boolean
  /** NRST pin level as seen by the reset circuit (true = held in reset). */
  setResetPin(asserted: boolean): void
  /** BOOT0/BOOT1 strap levels, sampled at the next reset (optional per model). */
  setBootPins?(boot0: 0 | 1, boot1?: 0 | 1): void

  /** MCU virtual time (s) — equals simulation time. */
  time(): number
  /** Seconds of the given core cycle (exact; used for pin-edge timestamps). */
  timeOfCycle(cycle: number): number
  /**
   * Run until `time() >= t`, or earlier on requestSync / a breakpoint
   * ('breakpoint'). With no firmware / unpowered / in reset, time simply
   * advances. While halted (debugger) or locked up, time and peripheral
   * events STILL advance to t (DBGMCU freezes applied) and the call returns
   * 'halted' / 'lockup' — callers must not treat those as "no progress".
   */
  runUntil(t: number): StopReason
  requestSync(): void

  /** Take log events produced since the last call. */
  drainLog(): McuLogEvent[]
  debugState(): McuDebugState

  // ---- debugger ----
  halt(): void
  resume(): void
  /** one instruction (only while halted) */
  stepInstruction(): void
  setBreakpoints(addrs: number[]): void
  /** raw memory read through the bus (no side effects on read-clear registers is NOT guaranteed for MMIO) */
  readMemory(addr: number, length: number): Uint8Array
}
