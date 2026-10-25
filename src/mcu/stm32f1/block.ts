/**
 * Internal plumbing shared by the STM32F103 blocks (not a contract file —
 * plug-in peripherals talk to the SoC only through periph-api.ts).
 *
 *  - `RegisterBlock`: turns the bus's (offset, size) accesses into 32-bit
 *    register accesses with a BYTE-LANE mask, so every block implements one
 *    `read32/write32` pair and sub-word accesses behave like AHB byte enables
 *    (a byte write to bits 15:8 touches only those bits; write-1-to-clear and
 *    set/reset registers only see the lanes actually written).
 *  - `SocBlock` / `BlockSpec`: how a block is described in the peripheral
 *    list (peripherals.ts) — adding a block is one file + one list line.
 */
import type { AccessSize } from '../core/types'
import type { SupportStatus } from '../mcu-api'
import type { RccGate, SocContext } from './periph-api'

/** Byte-lane mask of a `size`-byte access at `offset` within its 32-bit word. */
export function laneMask(offset: number, size: AccessSize): number {
  if (size === 4) return 0xffffffff
  const sh = (offset & 3) * 8
  return ((size === 2 ? 0xffff : 0xff) << sh) >>> 0
}

/** Bit position of a sub-word access within its 32-bit word. */
export const laneShift = (offset: number): number => (offset & 3) * 8

/**
 * Base for register-mapped blocks. Subclasses implement `read32(off)` (off
 * word-aligned) and `write32(off, value, mask)` where `mask` has 1s on the
 * bits the access actually wrote; `value` is already shifted into its lane.
 */
export abstract class RegisterBlock {
  abstract readonly name: string
  abstract read32(off: number): number
  abstract write32(off: number, value: number, mask: number): void

  read(offset: number, size: AccessSize): number {
    const w = this.read32(offset & ~3) >>> 0
    if (size === 4) return w
    return (w >>> laneShift(offset)) & (size === 2 ? 0xffff : 0xff)
  }

  write(offset: number, value: number, size: AccessSize): void {
    if (size === 4) this.write32(offset & ~3, value >>> 0, 0xffffffff)
    else this.write32(offset & ~3, (value << laneShift(offset)) >>> 0, laneMask(offset, size))
  }
}

/** Merge the written lanes of `value` into `old`, restricted to `writable` bits. */
export function merge(old: number, value: number, mask: number, writable: number): number {
  const m = mask & writable
  return ((old & ~m) | (value & m)) >>> 0
}

/** Reset sources recorded in RCC_CSR (RM0008 §7.3.10). */
export type ResetCause = 'POR' | 'PIN' | 'SFT' | 'IWDG' | 'WWDG' | 'LPWR'

/**
 * A register block as the SoC drives it. `Stm32Peripheral` (periph-api.ts)
 * is structurally a SocBlock, so contract plug-ins drop in unchanged.
 */
export interface SocBlock {
  readonly name: string
  read(offset: number, size: AccessSize): number
  write(offset: number, value: number, size: AccessSize): void
  /** system reset / RCC xxxRST: registers to reset values, events cancelled, pins & IRQs released */
  reset(): void
  attach?(ctx: SocContext): void
  clockEnabled?(on: boolean): void
  clockChanged?(): void
  remapChanged?(): void
  dmaAck?(channel: number): void
  debugHalt?(halted: boolean): void
  /** Backup-domain state (BKP data, RTC): cleared only by power-on or RCC_BDCR.BDRST, not by system reset. */
  backupReset?(): void
  /**
   * DMA controller only: a peripheral request line changed (RM0008 §13.3.7,
   * Table 78). Not part of periph-api yet — see the integration notes.
   */
  dmaRequestChanged?(channel: number, active: boolean): void
}

/**
 * SoC services beyond SocContext that a few system blocks need (watchdog
 * resets, the LSI force-on by IWDG, the PWR_CR.DBP backup write protection).
 */
export interface SocEnv {
  /** the block's own contract context (the same object `attach` receives) */
  readonly ctx: SocContext
  /** simulation time (s) now */
  time(): number
  /** request a system reset with the given RCC_CSR cause */
  systemReset(cause: ResetCause): void
  /** IWDG start forces the LSI on (RM0008 §19.3.1); it cannot be stopped until reset */
  forceLsi(): void
  /** PWR_CR.DBP: write access to the backup domain (RM0008 §5.4.1) */
  backupWritable(): boolean
  /**
   * Absolute-time event, kept exact across HCLK changes (for blocks clocked
   * from LSI/LSE or the flash interface's HSI, not from HCLK).
   */
  atTime(t: number, fn: (cycle: number) => void): number
  cancelTime(handle: number): void
}

/** One line of the peripheral list. */
export interface BlockSpec {
  name: string
  base: number
  /** bytes (default 0x400 — every STM32F1 APB/AHB block slot) */
  size?: number
  /** RCC enable bit; null = always clocked (EXTI, IWDG, RTC interface…) */
  gate: RccGate | null
  /** DBGMCU_CR bit that freezes this block while the core is halted (RM0008 §31.16.3) */
  dbgFreezeBit?: number
  make(env: SocEnv): SocBlock
  /** honest status today ('partial' for implemented blocks until firmware-verified) */
  status: SupportStatus
  /** every documented function implemented: may become 'verified' once its firmware tests pass */
  complete?: boolean
  notes: string
  verifiedBy?: string[]
}

export const AHB = (bit: number): RccGate => ({ bus: 'AHB', bit })
export const APB1 = (bit: number): RccGate => ({ bus: 'APB1', bit })
export const APB2 = (bit: number): RccGate => ({ bus: 'APB2', bit })

export const hex8 = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(8, '0')
