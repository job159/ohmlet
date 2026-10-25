/**
 * Firmware image contract (output of the ELF/BIN/HEX loaders, input of every
 * MCU model). CONTRACT FILE.
 *
 * Load semantics mirror a real programmer (ST-Link / STM32CubeProgrammer):
 * only bytes whose LOAD address (ELF p_paddr / LMA) falls inside the target's
 * non-volatile memory are programmed. RAM-only segments (e.g. .bss, a
 * ._user_heap_stack reservation) are NOT loaded — startup code initialises
 * RAM, exactly as on hardware. The MCU model reports anything it skipped.
 */

export type FirmwareFormat = 'elf' | 'bin' | 'hex'

export interface FirmwareSegment {
  /** physical load address (LMA) */
  addr: number
  data: Uint8Array
}

export interface FirmwareSymbol {
  name: string
  addr: number
  size: number
  kind: 'func' | 'object' | 'other'
}

export interface FirmwareImage {
  /** display name (usually the file name) */
  name: string
  format: FirmwareFormat
  /** loadable bytes by physical address, sorted, non-overlapping */
  segments: FirmwareSegment[]
  /** ELF e_entry (Thumb bit included as stored); null for BIN/HEX without start address */
  entry: number | null
  /** symbol table (ELF only; empty otherwise) — used by the debug UI and tests */
  symbols: FirmwareSymbol[]
  /** lowercase hex SHA-256 of the ORIGINAL file bytes */
  sha256: string
  /** size of the original file in bytes */
  fileSize: number
  /** non-fatal loader findings (e.g. "segment at 0x2000000c is RAM-only — not programmed") */
  warnings: string[]
  /** ELF machine/class/flags summary for the UI, e.g. "ELF32 ARM, EABI5, Thumb entry 0x08000131" */
  description?: string
}

/** Result of parsing a file. */
export type LoadResult = { ok: true; image: FirmwareImage } | { ok: false; error: string }

/** Lookup helper shared by tests and the debug UI. */
export function findSymbol(img: FirmwareImage, name: string): FirmwareSymbol | undefined {
  return img.symbols.find((s) => s.name === name)
}
