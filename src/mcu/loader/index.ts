/**
 * Firmware file loaders: ELF / raw BIN / Intel HEX → FirmwareImage.
 *
 * `loadFirmwareFile` picks the format by content first (ELF magic, Intel HEX
 * record syntax) and only then by file extension, so a misnamed file still
 * loads — and a file whose extension promises a format its bytes do not have
 * fails with an explanation instead of being programmed as garbage.
 */
import type { FirmwareFormat, LoadResult } from '../firmware'
import { loadBin, STM32_FLASH_BASE } from './bin'
import { isElf, loadElf } from './elf'
import { loadHex, looksLikeHex } from './ihex'

export { loadElf, isElf } from './elf'
export { loadBin, STM32_FLASH_BASE } from './bin'
export { loadHex, looksLikeHex } from './ihex'
export { sha256, sha256Hex } from './sha256'

export interface LoadOptions {
  /** force a format instead of detecting it */
  format?: FirmwareFormat
  /** load address for raw binaries (default 0x08000000) */
  binBase?: number
}

const EXT: Record<string, FirmwareFormat> = {
  elf: 'elf',
  axf: 'elf',
  out: 'elf',
  hex: 'hex',
  ihex: 'hex',
  ihx: 'hex',
  bin: 'bin',
}

export function detectFormat(name: string, bytes: Uint8Array): FirmwareFormat | null {
  if (isElf(bytes)) return 'elf'
  if (looksLikeHex(bytes)) return 'hex'
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext ? (EXT[ext] ?? null) : null
}

export function loadFirmwareFile(name: string, bytes: Uint8Array, opts: LoadOptions = {}): LoadResult {
  if (bytes.length === 0) return { ok: false, error: `${name}: empty file` }
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  const byExt = ext ? EXT[ext] : undefined
  if (!opts.format && byExt === 'elf' && !isElf(bytes)) {
    return { ok: false, error: `${name}: has an ELF extension but does not start with the ELF magic (7F 45 4C 46)` }
  }
  if (!opts.format && byExt === 'hex' && !isElf(bytes) && !looksLikeHex(bytes)) {
    return { ok: false, error: `${name}: has an Intel HEX extension but is not Intel HEX text (records start with ':')` }
  }
  const fmt = opts.format ?? detectFormat(name, bytes)
  if (fmt === null) {
    return {
      ok: false,
      error: `${name}: unrecognised firmware format — expected an ELF (.elf/.axf), Intel HEX (.hex) or raw binary (.bin) file`,
    }
  }
  switch (fmt) {
    case 'elf':
      return loadElf(bytes, name)
    case 'hex':
      return loadHex(bytes, name)
    case 'bin':
      return loadBin(bytes, name, opts.binBase ?? STM32_FLASH_BASE)
  }
}
