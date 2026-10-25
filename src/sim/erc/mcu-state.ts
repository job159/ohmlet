/**
 * What the ERC may conclude from an MCU board's live pin modes (IN-15).
 *
 * A board's telemetry pin modes are the FIRMWARE's choice only once the
 * firmware has actually run: right after a Reset MCU or a (re-)flash every
 * GPIO is back to its reset state (floating input), and a board that boots
 * from system memory (BOOT0 = 1) runs the ROM bootloader, not the firmware.
 * Rules that read pin modes ask `firmwareModesSettled()` first, so they
 * never blame the firmware for the reset state.
 *
 * Pure, no UI imports (the inspector's state chip shares inSystemMemory).
 */
import type { McuTelemetry } from '../../model/types'

/** System memory (the ROM bootloader BOOT0 = 1 starts): 0x1FFFF000–0x1FFFF7FF (RM0008 §3.4). */
export function inSystemMemory(pc: number): boolean {
  return pc >= 0x1ffff000 && pc <= 0x1ffff7ff
}

/** HAL init runs in the first milliseconds; a pin mode counts after this much run time since the board's reset (s). */
export const MODE_SETTLE_S = 0.5

export interface SettleContext {
  /** simulation time of the snapshot (s) */
  time: number
  /** simulation time of the board's last reset / firmware load (s), when known */
  resetAt?: number
  /** the PC the board starts from after a reset (its firmware's entry point), when known */
  resetPc?: number
}

/**
 * Has `mcu`'s firmware been running long enough since the board's last
 * reset that its pin modes are the firmware's own choice?
 *  - not while the PC is in system memory (BOOT0 = 1: the bootloader runs);
 *  - not while the PC still equals the reset entry point (nothing ran yet);
 *  - not before `settle` seconds of simulation time since the last reset /
 *    load (a mark in the future — from an earlier session — is ignored).
 */
export function firmwareModesSettled(mcu: McuTelemetry, ctx: SettleContext, settle = 0): boolean {
  if (inSystemMemory(mcu.pc)) return false
  if (ctx.resetPc !== undefined && (mcu.pc & ~1) >>> 0 === (ctx.resetPc & ~1) >>> 0) return false
  const since = ctx.resetAt !== undefined && ctx.resetAt <= ctx.time ? ctx.time - ctx.resetAt : ctx.time
  return since >= settle
}
